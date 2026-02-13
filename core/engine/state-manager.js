'use strict';

const crypto = require('crypto');
const { StateManagerError } = require('./errors');

class StateManager {
  constructor(options = {}) {
    this._db = options.db || null;

    // In-memory active state
    this._activeTestRuns = new Map();
    this._pendingApprovals = new Map();
    this._activeFixes = new Map();
    this._agentHealth = new Map();
  }

  // --- Test Run Lifecycle ---

  async createTestRun(appId, agents, options = {}) {
    const testRun = {
      id: crypto.randomUUID(),
      app_id: appId,
      agents: agents || [],
      environment: options.environment || 'staging',
      triggered_by: options.triggeredBy || 'manual',
      triggered_via: options.triggeredVia || null,
      status: 'running',
      progress: {
        total_agents: (agents || []).length,
        completed_agents: 0,
        current_agent: (agents || [])[0] || null,
        results: {}
      },
      started_at: new Date().toISOString()
    };

    this._activeTestRuns.set(testRun.id, testRun);

    await this._persistToDb(() => {
      this._db.testRuns.create({
        id: testRun.id,
        app_id: testRun.app_id,
        agents: testRun.agents,
        environment: testRun.environment,
        triggered_by: testRun.triggered_by,
        triggered_via: testRun.triggered_via,
        status: testRun.status,
        started_at: testRun.started_at
      });
    });

    return testRun;
  }

  async updateTestRunProgress(testRunId, agentId, result) {
    const testRun = this._activeTestRuns.get(testRunId);
    if (!testRun) return;

    testRun.progress.completed_agents += 1;
    testRun.progress.results[agentId] = result;

    // Advance current_agent to next uncompleted agent
    const completedAgents = Object.keys(testRun.progress.results);
    const nextAgent = testRun.agents.find(a => !completedAgents.includes(a));
    testRun.progress.current_agent = nextAgent || null;

    await this._persistToDb(() => {
      this._db.testRuns.update(testRunId, {
        summary: testRun.progress
      });
    });
  }

  async completeTestRun(testRunId, summary) {
    const testRun = this._activeTestRuns.get(testRunId);
    if (!testRun) return;

    const status = summary.failed === 0 ? 'completed' : 'failed';
    const completedAt = new Date().toISOString();

    this._activeTestRuns.delete(testRunId);

    await this._persistToDb(() => {
      this._db.testRuns.update(testRunId, {
        status,
        summary,
        completed_at: completedAt
      });
      this._db.apps.updateLastTestRun(testRun.app_id, completedAt);
    });
  }

  getActiveTestRuns() {
    return Array.from(this._activeTestRuns.values());
  }

  getTestRun(testRunId) {
    const active = this._activeTestRuns.get(testRunId);
    if (active) return active;

    if (this._db) {
      return this._db.testRuns.findById(testRunId);
    }
    return null;
  }

  async getRecentTestRuns(appId, limit = 10) {
    if (!this._db) return [];
    return this._db.testRuns.findRecent(appId, limit);
  }

  // --- Approval Lifecycle ---

  async trackApproval(bugId, approvalId, options = {}) {
    const timeoutMs = options.timeoutMs || 3600000;
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

    const approval = {
      id: crypto.randomUUID(),
      bug_ref_id: bugId,
      approval_id: approvalId,
      status: 'pending',
      notification_channel: options.channel || null,
      timeout_at: timeoutAt,
      created_at: new Date().toISOString()
    };

    this._pendingApprovals.set(approvalId, approval);

    await this._persistToDb(() => {
      this._db.approvals.create({
        id: approval.id,
        bug_ref_id: approval.bug_ref_id,
        approval_id: approval.approval_id,
        status: approval.status,
        notification_channel: approval.notification_channel,
        timeout_at: approval.timeout_at,
        created_at: approval.created_at
      });
    });

    return approval;
  }

  async updateApproval(approvalId, status, respondedVia) {
    const approval = this._pendingApprovals.get(approvalId);
    if (!approval) return;

    this._pendingApprovals.delete(approvalId);

    await this._persistToDb(() => {
      const dbApproval = this._db.approvals.findByApprovalId(approvalId);
      if (dbApproval) {
        this._db.approvals.respond(dbApproval.id, status, respondedVia);
      }
    });
  }

  checkTimeouts() {
    const now = new Date();
    const expired = [];

    for (const [approvalId, approval] of this._pendingApprovals) {
      if (new Date(approval.timeout_at) < now) {
        expired.push(approvalId);
      }
    }

    return expired;
  }

  getPendingApprovals() {
    return Array.from(this._pendingApprovals.values());
  }

  getApproval(approvalId) {
    const pending = this._pendingApprovals.get(approvalId);
    if (pending) return pending;

    if (this._db) {
      return this._db.approvals.findByApprovalId(approvalId);
    }
    return null;
  }

  async getApprovalsByBug(bugId) {
    if (!this._db) return [];
    return this._db.approvals.findByBug(bugId);
  }

  // --- Fix Lifecycle ---

  async trackFix(bugId, appId, fixData) {
    const fix = {
      id: crypto.randomUUID(),
      bug_ref_id: bugId,
      app_id: appId,
      status: 'in-progress',
      fix_type: fixData.fix_type,
      generated_fix: fixData.generated_fix || null,
      created_at: new Date().toISOString()
    };

    this._activeFixes.set(bugId, fix);

    await this._persistToDb(() => {
      this._db.fixes.create({
        id: fix.id,
        bug_ref_id: fix.bug_ref_id,
        app_id: fix.app_id,
        status: fix.status,
        fix_type: fix.fix_type,
        generated_fix: fix.generated_fix,
        created_at: fix.created_at
      });
    });

    return fix;
  }

  async updateFixStatus(bugId, status, details = {}) {
    const fix = this._activeFixes.get(bugId);
    if (!fix) return;

    fix.status = status;
    Object.assign(fix, details);

    const terminalStatuses = ['verified', 'failed', 'rolled-back'];
    if (terminalStatuses.includes(status)) {
      this._activeFixes.delete(bugId);
    }

    await this._persistToDb(() => {
      this._db.fixes.update(fix.id, { status, ...details });
    });
  }

  getActiveFixes() {
    return Array.from(this._activeFixes.values());
  }

  getFix(bugId) {
    const active = this._activeFixes.get(bugId);
    if (active) return active;

    if (this._db) {
      const fixes = this._db.fixes.findByBug(bugId);
      return fixes.length > 0 ? fixes[0] : null;
    }
    return null;
  }

  async getFixesByApp(appId) {
    if (!this._db) return [];
    return this._db.fixes.findByApp(appId);
  }

  // --- Agent Health Tracking ---

  trackAgentHealth(agentId, health) {
    this._agentHealth.set(agentId, {
      ...health,
      updated_at: new Date().toISOString()
    });
  }

  getAgentHealth(agentId) {
    return this._agentHealth.get(agentId) || null;
  }

  getAllAgentHealth() {
    return new Map(this._agentHealth);
  }

  // --- State Recovery ---

  async recover() {
    if (!this._db) {
      return { recoveredTestRuns: 0, recoveredApprovals: 0, recoveredFixes: 0 };
    }

    // 1. Load running test runs, mark as interrupted
    const runningRuns = this._db.testRuns.findActive();
    for (const run of runningRuns) {
      if (!this._activeTestRuns.has(run.id)) {
        run.status = 'interrupted';
        this._activeTestRuns.set(run.id, run);
        this._db.testRuns.update(run.id, { status: 'interrupted' });
      }
    }

    // 2. Load pending approvals
    const pendingApprovals = this._db.approvals.findPending();
    for (const approval of pendingApprovals) {
      if (!this._pendingApprovals.has(approval.approval_id)) {
        this._pendingApprovals.set(approval.approval_id, approval);
      }
    }

    // 3. Load in-progress fixes
    const inProgressFixes = this._db.fixes.findInProgress();
    for (const fix of inProgressFixes) {
      if (!this._activeFixes.has(fix.bug_ref_id)) {
        this._activeFixes.set(fix.bug_ref_id, fix);
      }
    }

    return {
      recoveredTestRuns: runningRuns.length,
      recoveredApprovals: pendingApprovals.length,
      recoveredFixes: inProgressFixes.length
    };
  }

  // --- Graceful Shutdown ---

  async shutdown() {
    if (this._db) {
      // Mark active test runs as interrupted
      for (const [id, run] of this._activeTestRuns) {
        try {
          this._db.testRuns.update(id, { status: 'interrupted' });
        } catch {
          // Best-effort during shutdown
        }
      }
    }

    this._activeTestRuns.clear();
    this._pendingApprovals.clear();
    this._activeFixes.clear();
    this._agentHealth.clear();
  }

  // --- Internal Helpers ---

  async _persistToDb(operation, fallbackValue) {
    if (!this._db) return fallbackValue;
    try {
      return operation();
    } catch (error) {
      console.warn(`StateManager DB persistence failed: ${error.message}`);
      return fallbackValue;
    }
  }
}

module.exports = StateManager;
