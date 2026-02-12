# Auto-Fixer + Approval Manager — Implementation Spec

**QA Engine Phase 1 · Week 3 · Days 3-4**
**Version:** 1.0
**Date:** February 12, 2026
**Builds on:** bug-detector-adapters-implementation-spec.md (Week 3 Days 1-2)

---

## Overview

This spec covers two tightly-coupled components:

1. **Approval Manager** — Generates approval IDs, sends notifications, parses responses, handles timeouts
2. **Auto-Fixer** — Generates fixes via LLM, runs safety review, applies changes, verifies fix, rolls back on failure

**Interaction flow:**
```
BugDetector.detectAndReport()
  └── autoFixable=true → ApprovalManager.requestApproval(app, bug)
                              └── sends WhatsApp notification with YES/NO/INFO actions
                                    └── (async) user responds → ApprovalManager.handleResponse()
                                          └── YES → AutoFixer.generateAndApplyFix(app, bug, approval)
                                          └── NO → mark needs-manual-fix
                                          └── INFO → return detailed bug info
```

**Files to create:**
- `core/engine/approval-manager.js`
- `core/engine/auto-fixer.js`
- `tests/engine/approval-manager.test.js`
- `tests/engine/auto-fixer.test.js`

**Files referenced (already exist from Days 1-2):**
- `core/engine/errors.js` — FixError, ApprovalError
- `core/integrations/adapters/notification.js` — NotificationAdapter interface
- `core/integrations/adapters/llm.js` — LLMAdapter interface
- `core/integrations/adapters/bug-tracker.js` — BugTrackerAdapter interface

---

## Design Decisions

### D1: Approval Manager Owns ID Generation and Response Parsing — Nothing Else

The Approval Manager is deliberately thin. It:
- Generates short approval IDs (e.g., `ABC-247`)
- Formats and sends approval request messages via NotificationAdapter
- Parses incoming response strings (`YES-ABC-247`, `NO-ABC-247`, `INFO-ABC-247`)
- Routes parsed responses to appropriate handlers

It does NOT:
- Store approvals in a database (delegates to `storage` injectable)
- Trigger the Auto-Fixer directly (returns result, caller decides)
- Manage timeout timers internally (provides `checkTimeout()` for external schedulers)

**Why:** Keeping it thin makes it testable without async timer complexity. The orchestration layer (or a scheduler) calls `checkTimeout()` periodically rather than the Approval Manager spawning its own timers.

### D2: Approval ID Format Is `{3-letter-code}-{bug-number}`

From the core spec: `generateApprovalId(bugId)` extracts the number from `BUG-247` and prepends a random 3-letter code. The format `ABC-247` is:
- Short enough to type on a phone
- Unique enough to avoid collisions (26³ × bug number space)
- Parseable by regex: `/^(YES|NO|INFO)-([A-Z]{3}-\d+)$/`

### D3: Auto-Fixer Uses Two-Phase Safety Review

**Phase 1: Static checks** (no LLM needed)
- Modified files are within allowed paths
- No dangerous patterns (rm -rf, DROP TABLE, eval, etc.)
- Change count ≤ 10

**Phase 2: Not implemented in Phase 1**
The core spec mentions LLM-powered review as a future enhancement. For MVP, static checks are sufficient — they catch the most dangerous categories.

### D4: Auto-Fixer Does Not Execute Real File Operations in Phase 1

The Auto-Fixer generates fix plans and validates them, but actual file modification, git branching, and commit operations require integration with Claude Code or a real filesystem. For Phase 1:
- `applyFix()` delegates to a `codeExecutor` injectable (default: no-op that returns success)
- `verifyFix()` delegates to a `testRunner` injectable (default: no-op that returns passed)
- `rollbackFix()` delegates to `codeExecutor.rollback()` (default: no-op)

This lets us test the full workflow logic without needing a real repository.

### D5: Approval Timeout Is Configuration — Not Hardcoded

The core spec uses a 1-hour timeout. We make this configurable via `options.timeoutMs` (default: 3600000). The Approval Manager records `timeout_at` on each approval and provides `checkTimeout(approvalId)` that checks if `Date.now() > timeout_at`.

### D6: Auto-Fixer Reports Fix Result — Does Not Update Bug Status Directly

The Auto-Fixer returns a `FixResult` object. The calling code (Bug Detector or orchestration layer) uses the result to update bug status, send notifications, etc. This keeps the Auto-Fixer focused on fix generation/verification.

**Exception:** The Auto-Fixer does call `storage.saveFix()` and `storage.updateFix()` to track fix attempts, since this is its own domain data.

---

## Approval Manager Implementation

### File: `core/engine/approval-manager.js`

### Constructor + Method Inventory

| Method | Visibility | Signature | Purpose |
|--------|-----------|-----------|---------|
| `constructor(options)` | public | `(options: Object) → ApprovalManager` | Accept injectable deps |
| `requestApproval(app, bug)` | public | `async (Object, BugRecord) → ApprovalRecord` | Generate ID, store record, send notification |
| `handleResponse(response)` | public | `async (string) → ResponseResult` | Parse response string, update record, return action |
| `checkTimeout(approvalId)` | public | `async (string) → boolean` | Check if approval has timed out, mark if so |
| `getApproval(approvalId)` | public | `async (string) → ApprovalRecord\|null` | Retrieve approval record |
| `formatApprovalRequest(bug, approvalId)` | public | `(BugRecord, string) → string` | Format notification message |
| `formatDetailedInfo(bug)` | public | `(BugRecord) → string` | Format detailed bug info for INFO response |
| `generateApprovalId(bugId)` | public | `(string) → string` | Generate ABC-247 format ID |
| `parseResponse(response)` | public | `(string) → {action, id}\|null` | Parse YES/NO/INFO-ABC-247 format |

### Data Structures

#### ApprovalRecord
```javascript
{
  approval_id: 'ABC-247',       // Short format for WhatsApp
  bug_id: 'BUG-247',            // Reference to bug
  bug: { /* full BugRecord */ }, // Cached for INFO lookups
  status: 'pending',            // 'pending' | 'approved' | 'rejected' | 'timed-out'
  requested_at: '2026-02-12T...', 
  timeout_at: '2026-02-12T...',  // requested_at + timeoutMs
  responded_at: null,            // Set when response received
  responded_via: null,           // 'whatsapp', 'api', etc.
  notification_sent: true        // Whether notification was successfully sent
}
```

#### ResponseResult
```javascript
{
  action: 'approved',            // 'approved' | 'rejected' | 'info' | 'error' | 'timed-out'
  approval_id: 'ABC-247',
  message: '✅ Fix approved. Working on it now...',
  bug: { /* BugRecord if action=info */ },
  approval: { /* updated ApprovalRecord */ }
}
```

### Full Implementation

```javascript
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
        message: '✅ Fix approved. Working on it now...',
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
        message: '❌ Fix rejected. Marked as needs-manual-fix.',
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
      'critical': '🔴',
      'high': '🟠',
      'medium': '🟡',
      'low': '🟢'
    };

    const emoji = severityEmoji[bug.severity] || '⚪';

    return `${emoji} Bug Detected: ${bug.title}

**Component:** ${bug.affected_component || 'Unknown'}
**Root Cause:** ${bug.root_cause || 'Unknown'}
**Fix Approach:** ${bug.fix_approach || 'Unknown'}

Approve auto-fix?
• YES-${approvalId}
• NO-${approvalId}
• INFO-${approvalId}${bug.external_issue_url ? `\n\n[View Details](${bug.external_issue_url})` : ''}`.trim();
  }

  /**
   * Format detailed bug information for INFO responses.
   */
  formatDetailedInfo(bug) {
    if (!bug) return 'No bug details available.';

    const lines = [
      `📋 Bug Details: ${bug.bug_id}`,
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
```

---

## Auto-Fixer Implementation

### File: `core/engine/auto-fixer.js`

### Constructor + Method Inventory

| Method | Visibility | Signature | Purpose |
|--------|-----------|-----------|---------|
| `constructor(options)` | public | `(options: Object) → AutoFixer` | Accept injectable deps |
| `generateAndApplyFix(app, bug, approval)` | public | `async (Object, BugRecord, ApprovalRecord) → FixResult` | Full fix workflow |
| `generateFix(app, bug, context)` | public | `async (Object, BugRecord, Object) → FixPlan` | LLM-powered fix generation |
| `reviewFix(bug, fix)` | public | `(BugRecord, FixPlan) → SafetyResult` | Static safety checks |
| `applyFix(app, fix)` | public | `async (Object, FixPlan) → ApplyResult` | Apply changes via code executor |
| `verifyFix(app, bug)` | public | `async (Object, BugRecord) → VerifyResult` | Re-run failing test |
| `rollbackFix(app, fix)` | public | `async (Object, FixPlan) → void` | Revert changes |
| `loadBugContext(bug)` | public | `async (BugRecord) → BugContext` | Load relevant code around bug location |
| `getAllowedPathsForBug(bug)` | public | `(BugRecord) → string[]` | Determine safe file paths |
| `_buildFixPrompt(app, bug, context)` | private | `(Object, BugRecord, Object) → string` | Build LLM prompt |
| `_parseFixResponse(content)` | private | `(string) → FixPlan` | Parse LLM JSON |
| `_isPathAllowed(path, allowedPaths)` | private | `(string, string[]) → boolean` | Path safety check |

### Data Structures

#### FixPlan (from LLM)
```javascript
{
  files_to_modify: [
    {
      path: 'services/search.py',
      changes: [
        {
          type: 'replace',        // 'replace' | 'insert' | 'delete'
          line: 42,
          old_code: 'threshold = 0.7',
          new_code: 'threshold = 0.6'
        }
      ]
    }
  ],
  regression_test: {
    file: 'tests/test_search.py',
    test_code: 'def test_lower_threshold(): ...'
  },
  explanation: 'Lowered similarity threshold from 0.7 to 0.6 to improve recall'
}
```

#### SafetyResult
```javascript
{
  safe: true,         // or false
  reason: null        // string explaining why unsafe, if safe=false
}
```

#### FixResult
```javascript
{
  status: 'verified',  // 'verified' | 'failed' | 'safety-rejected' | 'apply-error' | 'verify-failed' | 'rolled-back'
  fix: { /* FixPlan */ },
  safetyCheck: { /* SafetyResult */ },
  verification: { /* VerifyResult */ },  // null if fix was rejected/failed
  explanation: 'string',
  bugId: 'BUG-247',
  startedAt: '...',
  completedAt: '...'
}
```

#### VerifyResult
```javascript
{
  passed: true,
  originalTest: { passed: true, details: '...' },
  regressionTests: { passed: true, total: 5, failures: 0 }
}
```

#### BugContext
```javascript
{
  relevant_code: 'string',      // Code around the bug location
  file_path: 'string',          // Primary file
  surrounding_files: ['...'],   // Related files
  language: 'python'            // Detected language
}
```

### Full Implementation

```javascript
'use strict';

const { FixError } = require('./errors');

/**
 * Dangerous patterns that auto-fixes must never contain.
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM\s+users/i,
  /TRUNCATE\s+TABLE/i,
  /system\s*\(/,
  /exec\s*\(/,
  /eval\s*\(/,
  /Function\s*\(/,
  /child_process/,
  /\.env/,
  /process\.env\./,
  /secret|password|token|api_key/i
];

/**
 * Maximum number of individual changes allowed in an auto-fix.
 */
const MAX_CHANGES = 10;

class AutoFixer {
  /**
   * @param {Object} options
   * @param {import('../integrations/adapters/llm')} options.llm - LLM adapter for fix generation
   * @param {Object} [options.codeExecutor] - Code execution interface { applyChanges, rollback, createBranch }
   * @param {Object} [options.testRunner] - Test runner interface { runTest, runSuite }
   * @param {Object} [options.storage] - Storage interface { saveFix, updateFix }
   * @param {Object} [options.bugTracker] - Bug tracker for status updates
   * @param {import('../integrations/adapters/notification')} [options.notifier] - For success/failure notifications
   */
  constructor(options = {}) {
    if (!options.llm) {
      throw new FixError('AutoFixer requires options.llm adapter', {
        phase: 'construction'
      });
    }

    this._llm = options.llm;
    this._bugTracker = options.bugTracker || null;
    this._notifier = options.notifier || null;

    // Code executor with no-op defaults (Phase 1: no real file ops)
    this._codeExecutor = options.codeExecutor || {
      createBranch: async (name) => ({ name, created: true }),
      applyChanges: async (changes) => ({ applied: true, filesModified: changes.length }),
      rollback: async () => ({ rolledBack: true })
    };

    // Test runner with no-op defaults
    this._testRunner = options.testRunner || {
      runTest: async (testId) => ({ passed: true, details: 'No-op test runner' }),
      runSuite: async (suiteId) => ({ passed: true, total: 0, failures: 0 })
    };

    // Storage with no-op defaults
    this._storage = options.storage || {
      saveFix: async (fix) => fix,
      updateFix: async (id, updates) => ({ id, ...updates })
    };
  }

  /**
   * Full fix workflow: verify approval → generate → safety review → apply → verify → report.
   *
   * @param {Object} app - App configuration
   * @param {Object} bug - BugRecord
   * @param {Object} approval - ApprovalRecord (must have status 'approved')
   * @returns {Promise<Object>} FixResult
   */
  async generateAndApplyFix(app, bug, approval) {
    if (!app) {
      throw new FixError('generateAndApplyFix requires app config', { phase: 'generation' });
    }
    if (!bug) {
      throw new FixError('generateAndApplyFix requires bug record', { phase: 'generation' });
    }
    if (!approval) {
      throw new FixError('generateAndApplyFix requires approval record', { phase: 'generation' });
    }

    const startedAt = new Date().toISOString();

    // 1. Verify approval status
    if (approval.status !== 'approved') {
      throw new FixError(`Fix not approved. Current status: ${approval.status}`, {
        phase: 'generation',
        bugId: bug.bug_id
      });
    }

    // Save fix tracking record
    const fixRecord = {
      id: `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bug_id: bug.bug_id,
      status: 'in-progress',
      started_at: startedAt
    };
    await this._storage.saveFix(fixRecord);

    try {
      // 2. Load bug context
      const context = await this.loadBugContext(bug);

      // 3. Generate fix via LLM
      let fix;
      try {
        fix = await this.generateFix(app, bug, context);
      } catch (err) {
        await this._storage.updateFix(fixRecord.id, { status: 'failed', error: err.message });
        return this._buildFixResult('failed', null, null, null, bug.bug_id, startedAt, `Fix generation failed: ${err.message}`);
      }

      // 4. Safety review
      const safetyCheck = this.reviewFix(bug, fix);
      if (!safetyCheck.safe) {
        await this._storage.updateFix(fixRecord.id, { status: 'safety-rejected', reason: safetyCheck.reason });
        return this._buildFixResult('safety-rejected', fix, safetyCheck, null, bug.bug_id, startedAt, `Safety review failed: ${safetyCheck.reason}`);
      }

      // 5. Apply fix
      try {
        await this._codeExecutor.createBranch(`auto-fix/${bug.bug_id}`);
        await this.applyFix(app, fix);
      } catch (err) {
        await this._storage.updateFix(fixRecord.id, { status: 'apply-error', error: err.message });
        await this.rollbackFix(app, fix);
        return this._buildFixResult('apply-error', fix, safetyCheck, null, bug.bug_id, startedAt, `Fix application failed: ${err.message}`);
      }

      // 6. Verify fix
      let verification;
      try {
        verification = await this.verifyFix(app, bug);
      } catch (err) {
        await this.rollbackFix(app, fix);
        await this._storage.updateFix(fixRecord.id, { status: 'verify-failed', error: err.message });
        return this._buildFixResult('verify-failed', fix, safetyCheck, null, bug.bug_id, startedAt, `Verification failed: ${err.message}`);
      }

      // 7. Handle verification result
      if (verification.passed) {
        await this._storage.updateFix(fixRecord.id, {
          status: 'verified',
          fix_data: fix,
          verification_result: verification,
          completed_at: new Date().toISOString()
        });

        return this._buildFixResult('verified', fix, safetyCheck, verification, bug.bug_id, startedAt, fix.explanation);
      } else {
        // Verification failed — rollback
        await this.rollbackFix(app, fix);
        await this._storage.updateFix(fixRecord.id, {
          status: 'rolled-back',
          verification_result: verification,
          completed_at: new Date().toISOString()
        });

        return this._buildFixResult('rolled-back', fix, safetyCheck, verification, bug.bug_id, startedAt, 'Fix applied but verification failed — rolled back');
      }

    } catch (err) {
      // Unexpected error — ensure cleanup
      await this._storage.updateFix(fixRecord.id, { status: 'failed', error: err.message });
      try { await this.rollbackFix(app, {}); } catch (_) { /* best effort */ }
      throw new FixError(`Auto-fix failed unexpectedly: ${err.message}`, {
        phase: 'unknown',
        bugId: bug.bug_id,
        details: { originalError: err.message }
      });
    }
  }

  /**
   * Generate a fix plan via LLM.
   */
  async generateFix(app, bug, context) {
    const prompt = this._buildFixPrompt(app, bug, context);

    const response = await this._llm.complete(prompt, {
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2048,
      temperature: 0.1,
      systemPrompt: 'You are a senior developer fixing a bug. Return your fix as valid JSON only, with no markdown fencing or extra text. Make minimal, targeted changes.'
    });

    return this._parseFixResponse(response.content);
  }

  /**
   * Static safety review of a fix plan.
   * Returns { safe: boolean, reason: string|null }.
   */
  reviewFix(bug, fix) {
    if (!fix || !fix.files_to_modify || !Array.isArray(fix.files_to_modify)) {
      return { safe: false, reason: 'Fix has no files_to_modify array' };
    }

    // Check 1: Files are within allowed paths
    const allowedPaths = this.getAllowedPathsForBug(bug);
    for (const file of fix.files_to_modify) {
      if (!this._isPathAllowed(file.path, allowedPaths)) {
        return { safe: false, reason: `Fix modifies unexpected file: ${file.path}` };
      }
    }

    // Check 2: No dangerous patterns in new code
    for (const file of fix.files_to_modify) {
      for (const change of (file.changes || [])) {
        const newCode = change.new_code || '';
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(newCode)) {
            return { safe: false, reason: `Dangerous pattern detected in ${file.path}: ${pattern}` };
          }
        }
      }
    }

    // Check 3: Reasonable change count
    const totalChanges = fix.files_to_modify.reduce(
      (sum, f) => sum + (f.changes || []).length,
      0
    );

    if (totalChanges > MAX_CHANGES) {
      return { safe: false, reason: `Too many changes for auto-fix: ${totalChanges} (max ${MAX_CHANGES})` };
    }

    // Check 4: At least one change
    if (totalChanges === 0) {
      return { safe: false, reason: 'Fix contains no changes' };
    }

    return { safe: true, reason: null };
  }

  /**
   * Apply a fix plan via the code executor.
   */
  async applyFix(app, fix) {
    const changes = [];

    for (const file of fix.files_to_modify) {
      for (const change of (file.changes || [])) {
        changes.push({
          file: file.path,
          type: change.type,
          line: change.line,
          old_code: change.old_code,
          new_code: change.new_code
        });
      }
    }

    // Apply regression test if present
    if (fix.regression_test) {
      changes.push({
        file: fix.regression_test.file,
        type: 'insert',
        new_code: fix.regression_test.test_code
      });
    }

    return await this._codeExecutor.applyChanges(changes);
  }

  /**
   * Verify the fix by re-running the original failing test.
   */
  async verifyFix(app, bug) {
    // Run the original failing test
    const originalResult = await this._testRunner.runTest(bug.evidence?.test_id || bug.test_name);

    // Run regression suite (healer agent tests)
    const regressionResult = await this._testRunner.runSuite('healer-regression');

    return {
      passed: originalResult.passed && regressionResult.passed,
      originalTest: originalResult,
      regressionTests: regressionResult
    };
  }

  /**
   * Rollback a fix via the code executor.
   */
  async rollbackFix(app, fix) {
    try {
      await this._codeExecutor.rollback();
    } catch (err) {
      throw new FixError(`Rollback failed: ${err.message}`, {
        phase: 'rollback',
        details: { originalError: err.message }
      });
    }
  }

  /**
   * Load code context around the bug's likely location.
   * In Phase 1, this returns a stub — real implementation needs file system access.
   */
  async loadBugContext(bug) {
    const location = bug.likely_location || 'unknown';
    const filePath = location.includes(':') ? location.split(':')[0] : location;

    return {
      relevant_code: `// Code around ${location} would be loaded here in production`,
      file_path: filePath,
      surrounding_files: [],
      language: this._detectLanguage(filePath)
    };
  }

  /**
   * Determine which file paths are allowed for modification based on bug category.
   */
  getAllowedPathsForBug(bug) {
    const basePaths = ['src/', 'lib/', 'services/', 'config/', 'backend/', 'frontend/'];
    const categoryPaths = {
      'memory': ['services/', 'src/memory/', 'src/search/', 'backend/services/', 'config/'],
      'data-accuracy': ['services/', 'src/citations/', 'src/bible/', 'backend/services/', 'config/'],
      'ui': ['frontend/', 'src/components/', 'src/pages/', 'public/'],
      'backend': ['backend/', 'services/', 'src/', 'lib/'],
      'performance': ['services/', 'src/', 'backend/', 'config/']
    };

    return categoryPaths[bug.category] || basePaths;
  }

  // --- Private helpers ---

  _buildFixPrompt(app, bug, context) {
    const appName = app.name || app.id || 'Application';

    return `You are fixing a bug in ${appName}.

BUG INFORMATION:
- Bug ID: ${bug.bug_id}
- Title: ${bug.title}
- Root cause: ${bug.root_cause}
- Affected component: ${bug.affected_component}
- Likely location: ${bug.likely_location}
- Fix approach: ${bug.fix_approach}

RELEVANT CODE:
${context.relevant_code}

CONSTRAINTS:
- Make minimal changes (as few files and lines as possible)
- Don't break existing functionality
- Add comments explaining the fix
- Include a regression test if possible

Return JSON (no markdown fencing):
{
  "files_to_modify": [
    {
      "path": "file/path.ext",
      "changes": [
        {
          "type": "replace",
          "line": 42,
          "old_code": "original code",
          "new_code": "fixed code"
        }
      ]
    }
  ],
  "regression_test": {
    "file": "tests/test_file.ext",
    "test_code": "test function code"
  },
  "explanation": "Brief explanation of the fix"
}`;
  }

  _parseFixResponse(content) {
    let jsonStr = content.trim();

    // Strip markdown code fences
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.files_to_modify || !Array.isArray(parsed.files_to_modify)) {
        throw new Error('Missing or invalid files_to_modify array');
      }

      return {
        files_to_modify: parsed.files_to_modify.map(f => ({
          path: f.path,
          changes: (f.changes || []).map(c => ({
            type: c.type || 'replace',
            line: c.line || 0,
            old_code: c.old_code || '',
            new_code: c.new_code || ''
          }))
        })),
        regression_test: parsed.regression_test || null,
        explanation: parsed.explanation || 'No explanation provided'
      };
    } catch (err) {
      throw new FixError(`Failed to parse fix response: ${err.message}`, {
        phase: 'generation',
        details: { raw: content.substring(0, 500) }
      });
    }
  }

  _isPathAllowed(path, allowedPaths) {
    if (!path) return false;
    return allowedPaths.some(allowed => path.startsWith(allowed));
  }

  _detectLanguage(filePath) {
    if (!filePath) return 'unknown';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.js')) return 'javascript';
    if (filePath.endsWith('.ts')) return 'typescript';
    if (filePath.endsWith('.jsx') || filePath.endsWith('.tsx')) return 'react';
    return 'unknown';
  }

  _buildFixResult(status, fix, safetyCheck, verification, bugId, startedAt, explanation) {
    return {
      status,
      fix: fix || null,
      safetyCheck: safetyCheck || null,
      verification: verification || null,
      bugId,
      startedAt,
      completedAt: new Date().toISOString(),
      explanation
    };
  }
}

module.exports = AutoFixer;
```

---

## Test Specifications

### File: `tests/engine/approval-manager.test.js`

Target: **~75 tests**

#### Test Groups

**Group 1: Constructor Validation (~5 tests)**
- Requires `options.notifier` — throws ApprovalError if missing
- Accepts optional storage, timeoutMs, recipients
- Default timeoutMs is 3600000 (1 hour)
- Default storage uses in-memory Map
- Recipients can be string or array

**Group 2: generateApprovalId() (~8 tests)**
- Generates format `XXX-NNN` (3 uppercase letters + dash + number)
- Extracts number from `BUG-247` → `XXX-247`
- Extracts number from `BUG-1` → `XXX-1`
- Throws ApprovalError on null/undefined input
- Throws ApprovalError on non-string input
- Throws ApprovalError on malformed bugId (no number part)
- Two calls with same bugId produce different prefixes (random)
- Prefix is always exactly 3 uppercase letters

**Group 3: parseResponse() (~12 tests)**
- Parses `YES-ABC-247` → `{ action: 'YES', id: 'ABC-247' }`
- Parses `NO-XYZ-1` → `{ action: 'NO', id: 'XYZ-1' }`
- Parses `INFO-DEF-999` → `{ action: 'INFO', id: 'DEF-999' }`
- Returns null for empty string
- Returns null for null
- Returns null for non-string
- Returns null for `MAYBE-ABC-247` (invalid action)
- Returns null for `YES-ab-247` (lowercase prefix)
- Returns null for `YES-ABCD-247` (4-letter prefix)
- Returns null for `YES-AB-247` (2-letter prefix)
- Returns null for `YES-ABC-` (no number)
- Returns null for `YES-ABC` (missing number entirely)

**Group 4: formatApprovalRequest() (~6 tests)**
- Includes severity emoji (🔴 critical, 🟠 high, 🟡 medium, 🟢 low)
- Includes bug title, component, root cause, fix approach
- Includes YES/NO/INFO action strings with approval ID
- Includes external issue URL link when present
- Omits link when external_issue_url is null
- Default emoji (⚪) for unknown severity

**Group 5: formatDetailedInfo() (~4 tests)**
- Includes all bug fields (title, severity, category, agent, etc.)
- Includes evidence summary (screenshot count, error count)
- Includes Linear link when present
- Returns fallback message when bug is null

**Group 6: requestApproval() (~14 tests)**
- Generates approval ID from bug.bug_id
- Creates approval record with pending status
- Calls storage.saveApproval with record
- Calls notifier.sendWithActions with formatted message
- Passes correct actions array (YES/NO/INFO)
- Sets notification_sent=true on success
- Sets _notificationError on notifier failure (non-fatal)
- Uses app.integrations.notifications.recipients
- Falls back to constructor recipients
- Sets timeout_at = requested_at + timeoutMs
- Throws on missing app
- Throws on missing bug
- Throws on bug without bug_id
- Returns complete ApprovalRecord

**Group 7: handleResponse() (~16 tests)**
- YES response: updates status to 'approved', returns action='approved' with message
- NO response: updates status to 'rejected', returns action='rejected' with message
- INFO response: returns action='info' with detailed bug info, doesn't update status
- Invalid format: returns action='error' with message
- Unknown approval ID: returns action='error' with 'not found' message
- Already approved: returns action='error' with 'already approved' message
- Already rejected: returns action='error' with 'already rejected' message
- Timed-out approval: returns action='timed-out', updates status
- Null response: returns action='error'
- Empty string: returns action='error'
- Non-string: returns action='error'
- Calls storage.updateApproval for YES
- Calls storage.updateApproval for NO
- Does NOT call storage.updateApproval for INFO
- Sets responded_at timestamp on YES/NO
- Sets responded_via='message' on YES/NO

**Group 8: checkTimeout() (~6 tests)**
- Returns false for unknown approvalId
- Returns false for non-pending approval
- Returns false when not yet timed out
- Returns true when past timeout_at
- Updates status to 'timed-out' when timed out
- Sets responded_via='timeout'

**Group 9: getApproval() (~4 tests)**
- Returns approval by ID
- Returns null for unknown ID
- Returns updated approval after handleResponse
- Returns approval created by requestApproval

### File: `tests/engine/auto-fixer.test.js`

Target: **~85 tests**

#### Test Groups

**Group 1: Constructor Validation (~5 tests)**
- Requires `options.llm` — throws FixError if missing
- Accepts optional codeExecutor, testRunner, storage, bugTracker, notifier
- Default codeExecutor is no-op (returns success)
- Default testRunner is no-op (returns passed)
- Default storage is no-op

**Group 2: reviewFix() Safety Checks (~25 tests)**
- Returns `{ safe: true }` for valid fix within allowed paths
- Rejects null fix
- Rejects fix without files_to_modify
- Rejects fix with non-array files_to_modify
- Rejects file outside allowed paths for 'memory' category
- Allows file in 'services/' for 'memory' category
- Allows file in 'config/' for 'memory' category
- Tests each dangerous pattern individually:
  - `rm -rf` → unsafe
  - `DROP TABLE` → unsafe
  - `DELETE FROM users` → unsafe
  - `TRUNCATE TABLE` → unsafe
  - `system(` → unsafe
  - `exec(` → unsafe
  - `eval(` → unsafe
  - `Function(` → unsafe
  - `child_process` → unsafe
  - `.env` → unsafe
  - `process.env.SECRET` → unsafe
- Rejects fix with > 10 total changes
- Allows fix with exactly 10 changes
- Rejects fix with 0 changes
- Multiple files: checks all files for path + pattern violations

**Group 3: generateFix() (~8 tests)**
- Calls llm.complete with correct prompt
- Passes correct model, maxTokens, temperature
- Parses valid JSON response
- Strips markdown code fences
- Throws FixError on invalid JSON
- Returns files_to_modify array with correct structure
- Returns regression_test when present
- Returns explanation

**Group 4: loadBugContext() (~4 tests)**
- Extracts file path from `services/search.py:retrieve_context()`
- Returns stub code context (Phase 1)
- Detects language from file extension
- Handles 'unknown' location

**Group 5: getAllowedPathsForBug() (~6 tests)**
- Returns memory-specific paths for memory category
- Returns data-accuracy paths for data-accuracy category
- Returns ui paths for ui category
- Returns backend paths for backend category
- Returns performance paths for performance category
- Returns base paths for unknown category

**Group 6: applyFix() (~5 tests)**
- Calls codeExecutor.applyChanges with flattened changes
- Includes regression test as insert change
- Handles fix with no regression test
- Handles fix with multiple files
- Propagates codeExecutor errors

**Group 7: verifyFix() (~5 tests)**
- Calls testRunner.runTest with test_id from evidence
- Calls testRunner.runSuite with 'healer-regression'
- Returns passed=true when both pass
- Returns passed=false when original test fails
- Returns passed=false when regression suite fails

**Group 8: rollbackFix() (~3 tests)**
- Calls codeExecutor.rollback
- Throws FixError on rollback failure
- Handles empty fix object

**Group 9: generateAndApplyFix() Full Pipeline (~20 tests)**
- Happy path: approved → generate → safe → apply → verify passes → returns 'verified'
- Throws FixError on unapproved status
- Throws on missing app, bug, approval
- Generation failure: returns status='failed' with error
- Safety failure: returns status='safety-rejected', does NOT apply
- Apply failure: returns status='apply-error', triggers rollback
- Verify failure (test still fails): returns status='rolled-back', triggers rollback
- Verify exception: returns status='verify-failed', triggers rollback
- Saves fix record at start (in-progress)
- Updates fix record on success (verified)
- Updates fix record on failure
- Unexpected error: rolls back and throws FixError
- Full FixResult shape validation (all fields present)

**Group 10: _parseFixResponse() (~6 tests)**
- Valid JSON string
- JSON wrapped in code fences
- Missing files_to_modify → throws FixError
- Non-array files_to_modify → throws FixError
- Missing change fields → defaults applied
- Missing explanation → defaults to 'No explanation provided'

**Group 11: _isPathAllowed() (~4 tests)**
- Returns true for path starting with allowed prefix
- Returns false for path outside all prefixes
- Returns false for null path
- Handles trailing slash in allowed paths

---

## Mock Patterns

### Mock Notifier (Reuse from Days 1-2 spec)

```javascript
function createMockNotifier(overrides = {}) {
  return {
    send: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' }),
    sendWithActions: jest.fn().mockResolvedValue({ id: 'msg-2', status: 'sent' }),
    ...overrides
  };
}
```

### Mock Approval Storage

```javascript
function createMockApprovalStorage() {
  const approvals = new Map();
  return {
    saveApproval: jest.fn().mockImplementation(async (a) => { approvals.set(a.approval_id, { ...a }); return a; }),
    updateApproval: jest.fn().mockImplementation(async (id, updates) => {
      const a = approvals.get(id);
      if (a) Object.assign(a, updates);
      return a;
    }),
    getApproval: jest.fn().mockImplementation(async (id) => approvals.get(id) || null),
    _approvals: approvals
  };
}
```

### Mock Code Executor

```javascript
function createMockCodeExecutor(overrides = {}) {
  return {
    createBranch: jest.fn().mockResolvedValue({ name: 'auto-fix/BUG-1', created: true }),
    applyChanges: jest.fn().mockResolvedValue({ applied: true, filesModified: 1 }),
    rollback: jest.fn().mockResolvedValue({ rolledBack: true }),
    ...overrides
  };
}
```

### Mock Test Runner

```javascript
function createMockTestRunner(overrides = {}) {
  return {
    runTest: jest.fn().mockResolvedValue({ passed: true, details: 'Test passed' }),
    runSuite: jest.fn().mockResolvedValue({ passed: true, total: 5, failures: 0 }),
    ...overrides
  };
}
```

### Mock Fix Storage

```javascript
function createMockFixStorage() {
  const fixes = new Map();
  return {
    saveFix: jest.fn().mockImplementation(async (f) => { fixes.set(f.id, { ...f }); return f; }),
    updateFix: jest.fn().mockImplementation(async (id, updates) => {
      const f = fixes.get(id);
      if (f) Object.assign(f, updates);
      return f;
    }),
    _fixes: fixes
  };
}
```

### Standard Bug Fixture (for Auto-Fixer tests)

```javascript
function createTestBug(overrides = {}) {
  return {
    id: 'bug-test-123',
    bug_id: 'BUG-1',
    app_id: 'brainstormy',
    title: 'Memory recall failed',
    severity: 'high',
    priority: 'high',
    category: 'memory',
    status: 'open',
    detected_by: 'sentinel',
    test_name: 'Multi-session memory recall',
    scenario: 'establish-recall-3-facts',
    root_cause: 'Similarity threshold too high',
    affected_component: 'Memory service - search',
    likely_location: 'services/search.py:retrieve_context()',
    fix_approach: 'Adjust threshold from 0.7 to 0.6',
    confidence: 0.85,
    evidence: {
      test_id: 'sentinel-memory-001',
      screenshots: ['evidence/shot1.png'],
      console_logs: [],
      network_requests: []
    },
    auto_fixable: true,
    created_at: '2026-02-12T10:00:00Z',
    ...overrides
  };
}
```

### Standard Approval Fixture

```javascript
function createTestApproval(overrides = {}) {
  return {
    approval_id: 'ABC-1',
    bug_id: 'BUG-1',
    bug: createTestBug(),
    status: 'approved',
    requested_at: '2026-02-12T10:00:00Z',
    timeout_at: '2026-02-12T11:00:00Z',
    responded_at: '2026-02-12T10:05:00Z',
    responded_via: 'message',
    notification_sent: true,
    ...overrides
  };
}
```

---

## Claude Code Implementation Steps

### Step 1: Create Approval Manager
```
File: core/engine/approval-manager.js
Test: tests/engine/approval-manager.test.js (~75 tests)
Key: Uses mock notifier + mock storage. Test parseResponse extensively.
Verify: All response paths tested (YES/NO/INFO/invalid/timed-out/already-responded).
```

### Step 2: Create Auto-Fixer
```
File: core/engine/auto-fixer.js
Test: tests/engine/auto-fixer.test.js (~85 tests)
Key: Use mock LLM, codeExecutor, testRunner. Test safety review exhaustively.
Verify: Every dangerous pattern is caught. Full pipeline handles all failure modes.
```

### Step 3: Wire Approval Manager into Bug Detector
```
Update tests/engine/bug-detector.test.js — add tests for:
- BugDetector with real ApprovalManager instance (mock notifier)
- Auto-fixable bug triggers requestApproval
- Non-auto-fixable bug skips approval
Verify: Existing bug detector tests still pass.
```

### Step 4: Verify no regressions
```
Run full test suite. Expected: ~1033 (after Days 1-2) + ~160 (new) = ~1193 tests passing.
```

---

## Validation Criteria

**Days 3-4 are complete when:**
- [ ] `core/engine/approval-manager.js` exists with full implementation
- [ ] `core/engine/auto-fixer.js` exists with full implementation
- [ ] ~75 Approval Manager tests passing
- [ ] ~85 Auto-Fixer tests passing
- [ ] Safety review catches all 11 dangerous patterns
- [ ] Full fix pipeline handles all status paths (verified, failed, safety-rejected, apply-error, verify-failed, rolled-back)
- [ ] Approval ID generation produces correct format
- [ ] Response parsing handles all valid + invalid inputs
- [ ] Total project tests: ~1033 + ~160 = ~1193 passing
- [ ] No regressions in existing test suites
- [ ] All injectable dependencies have no-op defaults
