'use strict';

const { ApprovalError } = require('./errors');

class ApprovalManager {
  /**
   * @param {Object} options
   * @param {import('../integrations/adapters/notification')} options.notifier - Notification adapter
   * @param {Object} [options.storage] - Storage interface { saveApproval, updateApproval, getApproval }
   * @param {number} [options.timeoutMs] - Approval timeout in ms (default: 3600000 = 1 hour)
   * @param {string|string[]} [options.recipients] - Default notification recipients
   */
  constructor(options = {}) {
    if (!options.notifier) {
      throw new ApprovalError('ApprovalManager requires options.notifier adapter', {
        approvalId: null
      });
    }

    this._notifier = options.notifier;
    this._timeoutMs = options.timeoutMs || 3600000; // 1 hour
    this._recipients = options.recipients || [];

    // Storage with no-op defaults + in-memory fallback
    this._approvals = new Map();
    this._storage = options.storage || {
      saveApproval: async (approval) => { this._approvals.set(approval.approval_id, approval); return approval; },
      updateApproval: async (approvalId, updates) => {
        const approval = this._approvals.get(approvalId);
        if (approval) Object.assign(approval, updates);
        return approval;
      },
      getApproval: async (approvalId) => this._approvals.get(approvalId) || null
    };
  }

  /**
   * Create an approval record and send notification.
   *
   * @param {Object} app - App configuration (used for recipients override)
   * @param {Object} bug - BugRecord from Bug Detector
   * @returns {Promise<Object>} ApprovalRecord
   */
  async requestApproval(app, bug) {
    if (!app) {
      throw new ApprovalError('requestApproval requires app config');
    }
    if (!bug || !bug.bug_id) {
      throw new ApprovalError('requestApproval requires bug with bug_id');
    }

    // 1. Generate approval ID
    const approvalId = this.generateApprovalId(bug.bug_id);

    // 2. Create approval record
    const now = new Date();
    const approval = {
      approval_id: approvalId,
      bug_id: bug.bug_id,
      bug: bug,
      status: 'pending',
      requested_at: now.toISOString(),
      timeout_at: new Date(now.getTime() + this._timeoutMs).toISOString(),
      responded_at: null,
      responded_via: null,
      notification_sent: false
    };

    await this._storage.saveApproval(approval);

    // 3. Format and send notification
    const message = this.formatApprovalRequest(bug, approvalId);
    const recipients = this._getRecipients(app);

    try {
      await this._notifier.sendWithActions(recipients, message, [
        { id: `YES-${approvalId}`, label: 'Approve Fix' },
        { id: `NO-${approvalId}`, label: 'Reject Fix' },
        { id: `INFO-${approvalId}`, label: 'More Info' }
      ]);
      approval.notification_sent = true;
      await this._storage.updateApproval(approvalId, { notification_sent: true });
    } catch (err) {
      // Notification failure is non-fatal — approval record exists
      approval._notificationError = err.message;
    }

    return approval;
  }

  /**
   * Parse and handle an incoming response string.
   *
   * @param {string} response - Raw response text (e.g., "YES-ABC-247")
   * @returns {Promise<Object>} ResponseResult
   */
  async handleResponse(response) {
    if (!response || typeof response !== 'string') {
      return { action: 'error', message: 'Invalid response format', approval_id: null };
    }

    // Parse the response
    const parsed = this.parseResponse(response.trim());

    if (!parsed) {
      return { action: 'error', message: 'Invalid response format. Expected: YES-XXX-NNN, NO-XXX-NNN, or INFO-XXX-NNN', approval_id: null };
    }

    // Look up the approval
    const approval = await this._storage.getApproval(parsed.id);

    if (!approval) {
      return { action: 'error', message: `Approval ${parsed.id} not found`, approval_id: parsed.id };
    }

    // Check if already responded
    if (approval.status !== 'pending') {
      return {
        action: 'error',
        message: `Approval ${parsed.id} already ${approval.status}`,
        approval_id: parsed.id,
        approval
      };
    }

    // Check timeout
    if (new Date() > new Date(approval.timeout_at)) {
      await this._storage.updateApproval(parsed.id, {
        status: 'timed-out',
        responded_at: new Date().toISOString()
      });
      return {
        action: 'timed-out',
        message: `Approval ${parsed.id} has timed out`,
        approval_id: parsed.id,
        approval: { ...approval, status: 'timed-out' }
      };
    }

    const now = new Date().toISOString();

    if (parsed.action === 'YES') {
      await this._storage.updateApproval(parsed.id, {
        status: 'approved',
        responded_at: now,
        responded_via: 'message'
      });
      return {
        action: 'approved',
        approval_id: parsed.id,
        message: '\u2705 Fix approved. Working on it now...',
        bug: approval.bug,
        approval: { ...approval, status: 'approved', responded_at: now }
      };
    } else if (parsed.action === 'NO') {
      await this._storage.updateApproval(parsed.id, {
        status: 'rejected',
        responded_at: now,
        responded_via: 'message'
      });
      return {
        action: 'rejected',
        approval_id: parsed.id,
        message: '\u274C Fix rejected. Marked as needs-manual-fix.',
        approval: { ...approval, status: 'rejected', responded_at: now }
      };
    } else if (parsed.action === 'INFO') {
      return {
        action: 'info',
        approval_id: parsed.id,
        message: this.formatDetailedInfo(approval.bug),
        bug: approval.bug,
        approval
      };
    }

    return { action: 'error', message: 'Unknown action', approval_id: parsed.id };
  }

  /**
   * Check if an approval has timed out. If so, mark it and return true.
   *
   * @param {string} approvalId
   * @returns {Promise<boolean>} true if timed out
   */
  async checkTimeout(approvalId) {
    const approval = await this._storage.getApproval(approvalId);

    if (!approval) return false;
    if (approval.status !== 'pending') return false;

    if (new Date() > new Date(approval.timeout_at)) {
      await this._storage.updateApproval(approvalId, {
        status: 'timed-out',
        responded_at: new Date().toISOString(),
        responded_via: 'timeout'
      });
      return true;
    }

    return false;
  }

  /**
   * Retrieve an approval record.
   */
  async getApproval(approvalId) {
    return await this._storage.getApproval(approvalId);
  }

  /**
   * Generate a short approval ID from a bug ID.
   * BUG-247 → ABC-247 (random 3-letter prefix)
   */
  generateApprovalId(bugId) {
    if (!bugId || typeof bugId !== 'string') {
      throw new ApprovalError('generateApprovalId requires a bugId string');
    }

    // Extract number from BUG-247 → 247
    const parts = bugId.split('-');
    const bugNumber = parts[parts.length - 1];

    if (!bugNumber || !/^\d+$/.test(bugNumber)) {
      throw new ApprovalError(`Cannot extract bug number from: ${bugId}`);
    }

    // Generate 3 random uppercase letters
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let prefix = '';
    for (let i = 0; i < 3; i++) {
      prefix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${prefix}-${bugNumber}`;
  }

  /**
   * Parse a response string into action + approval ID.
   * Expected: "YES-ABC-247", "NO-ABC-247", "INFO-ABC-247"
   *
   * @param {string} response
   * @returns {{action: string, id: string}|null}
   */
  parseResponse(response) {
    if (!response || typeof response !== 'string') return null;

    const match = response.match(/^(YES|NO|INFO)-([A-Z]{3}-\d+)$/);
    if (!match) return null;

    return {
      action: match[1],
      id: match[2]
    };
  }

  /**
   * Format the approval request notification message.
   */
  formatApprovalRequest(bug, approvalId) {
    const severityEmoji = {
      'critical': '\uD83D\uDD34',
      'high': '\uD83D\uDFE0',
      'medium': '\uD83D\uDFE1',
      'low': '\uD83D\uDFE2'
    };

    const emoji = severityEmoji[bug.severity] || '\u26AA';

    return `${emoji} Bug Detected: ${bug.title}

**Component:** ${bug.affected_component || 'Unknown'}
**Root Cause:** ${bug.root_cause || 'Unknown'}
**Fix Approach:** ${bug.fix_approach || 'Unknown'}

Approve auto-fix?
\u2022 YES-${approvalId}
\u2022 NO-${approvalId}
\u2022 INFO-${approvalId}${bug.external_issue_url ? `\n\n[View Details](${bug.external_issue_url})` : ''}`.trim();
  }

  /**
   * Format detailed bug information for INFO responses.
   */
  formatDetailedInfo(bug) {
    if (!bug) return 'No bug details available.';

    const lines = [
      `\uD83D\uDCCB Bug Details: ${bug.bug_id}`,
      '',
      `**Title:** ${bug.title}`,
      `**Severity:** ${bug.severity}`,
      `**Category:** ${bug.category}`,
      `**Status:** ${bug.status}`,
      '',
      `**Agent:** ${bug.detected_by}`,
      `**Test:** ${bug.test_name}`,
      `**Scenario:** ${bug.scenario || 'N/A'}`,
      '',
      `**Root Cause:** ${bug.root_cause}`,
      `**Affected Component:** ${bug.affected_component}`,
      `**Likely Location:** ${bug.likely_location}`,
      `**Fix Approach:** ${bug.fix_approach}`,
      `**Confidence:** ${Math.round((bug.confidence || 0) * 100)}%`
    ];

    if (bug.evidence) {
      const consoleErrors = (bug.evidence.console_logs || []).filter(l => l.level === 'error').length;
      const networkFailures = (bug.evidence.network_requests || []).filter(r => r.failed).length;
      lines.push('', `**Evidence:** ${bug.evidence.screenshots?.length || 0} screenshots, ${consoleErrors} console errors, ${networkFailures} network failures`);
    }

    if (bug.external_issue_url) {
      lines.push('', `[View in Linear](${bug.external_issue_url})`);
    }

    return lines.join('\n');
  }

  // --- Private helpers ---

  _getRecipients(app) {
    // App config recipients override defaults
    if (app.integrations?.notifications?.recipients) {
      return app.integrations.notifications.recipients;
    }
    return this._recipients;
  }
}

module.exports = ApprovalManager;
