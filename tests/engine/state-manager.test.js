'use strict';

const { createDatabase } = require('../../core/database');
const StateManager = require('../../core/engine/state-manager');

describe('StateManager', () => {
  let db;
  let sm;

  beforeEach(async () => {
    db = await createDatabase();
    sm = new StateManager({ db });
  });

  afterEach(async () => {
    try { await sm.shutdown(); } catch {}
    try { db.close(); } catch {}
  });

  // Helper: seed an app in the DB
  function seedApp(overrides = {}) {
    return db.apps.create({
      name: 'Test App',
      type: 'web',
      config: { url: 'http://test.com' },
      ...overrides
    });
  }

  // Helper: seed a bug in the DB
  function seedBug(appId, bugId = 'BUG-001') {
    return db.bugs.create({
      app_id: appId,
      bug_id: bugId,
      title: `Bug ${bugId}`,
      severity: 'high',
      priority: 'high',
      category: 'functional',
      detected_by: 'sentinel'
    });
  }

  describe('Test Run Lifecycle', () => {
    it('createTestRun adds to active map', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel', 'healer']);
      expect(sm.getActiveTestRuns()).toHaveLength(1);
      expect(sm.getActiveTestRuns()[0].id).toBe(run.id);
    });

    it('createTestRun persists to DB when db provided', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      const dbRun = db.testRuns.findById(run.id);
      expect(dbRun).not.toBeNull();
      expect(dbRun.app_id).toBe(app.id);
    });

    it('createTestRun generates UUID for id', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      expect(run.id).toMatch(/^[0-9a-f]{8}-/);
    });

    it('createTestRun sets status = running', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      expect(run.status).toBe('running');
    });

    it('createTestRun populates progress with agent count', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel', 'healer', 'librarian']);
      expect(run.progress.total_agents).toBe(3);
      expect(run.progress.completed_agents).toBe(0);
      expect(run.progress.current_agent).toBe('sentinel');
    });

    it('updateTestRunProgress increments completed_agents', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel', 'healer']);
      await sm.updateTestRunProgress(run.id, 'sentinel', { status: 'completed' });
      const updated = sm.getTestRun(run.id);
      expect(updated.progress.completed_agents).toBe(1);
    });

    it('updateTestRunProgress advances current_agent', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel', 'healer']);
      await sm.updateTestRunProgress(run.id, 'sentinel', { status: 'completed' });
      const updated = sm.getTestRun(run.id);
      expect(updated.progress.current_agent).toBe('healer');
    });

    it('updateTestRunProgress persists to DB', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.updateTestRunProgress(run.id, 'sentinel', { status: 'completed', summary: { passed: 5 } });
      const dbRun = db.testRuns.findById(run.id);
      expect(dbRun.summary).toBeDefined();
    });

    it('updateTestRunProgress no-ops for unknown testRunId', async () => {
      await expect(sm.updateTestRunProgress('nonexistent', 'sentinel', { status: 'completed' }))
        .resolves.not.toThrow();
    });

    it('completeTestRun removes from active map', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run.id, { total: 5, passed: 5, failed: 0 });
      expect(sm.getActiveTestRuns()).toHaveLength(0);
    });

    it('completeTestRun sets completed status based on failures', async () => {
      const app = seedApp();
      const run1 = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run1.id, { total: 5, passed: 5, failed: 0 });
      const dbRun1 = db.testRuns.findById(run1.id);
      expect(dbRun1.status).toBe('completed');

      const run2 = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run2.id, { total: 5, passed: 3, failed: 2 });
      const dbRun2 = db.testRuns.findById(run2.id);
      expect(dbRun2.status).toBe('failed');
    });

    it('completeTestRun sets completed_at timestamp', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run.id, { total: 5, passed: 5, failed: 0 });
      const dbRun = db.testRuns.findById(run.id);
      expect(dbRun.completed_at).toBeDefined();
    });

    it('completeTestRun updates app.last_test_run_at', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run.id, { total: 5, passed: 5, failed: 0 });
      const updatedApp = db.apps.findById(app.id);
      expect(updatedApp.last_test_run_at).toBeDefined();
    });

    it('completeTestRun persists summary to DB', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      const summary = { total: 10, passed: 8, failed: 2, duration_ms: 5000 };
      await sm.completeTestRun(run.id, summary);
      const dbRun = db.testRuns.findById(run.id);
      expect(dbRun.summary).toEqual(summary);
    });

    it('getActiveTestRuns returns only running tests', async () => {
      const app = seedApp();
      await sm.createTestRun(app.id, ['sentinel']);
      const run2 = await sm.createTestRun(app.id, ['healer']);
      await sm.completeTestRun(run2.id, { total: 5, passed: 5, failed: 0 });
      expect(sm.getActiveTestRuns()).toHaveLength(1);
    });

    it('getTestRun finds from memory first', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      const found = sm.getTestRun(run.id);
      expect(found).toBe(run); // Same reference — from memory
    });

    it('getTestRun falls back to DB', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.completeTestRun(run.id, { total: 5, passed: 5, failed: 0 });
      // No longer in memory, should fall back to DB
      const found = sm.getTestRun(run.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(run.id);
    });

    it('getRecentTestRuns queries DB with limit', async () => {
      const app = seedApp();
      for (let i = 0; i < 5; i++) {
        const run = await sm.createTestRun(app.id, ['sentinel']);
        await sm.completeTestRun(run.id, { total: 1, passed: 1, failed: 0 });
      }
      const recent = await sm.getRecentTestRuns(app.id, 3);
      expect(recent).toHaveLength(3);
    });
  });

  describe('Approval Lifecycle', () => {
    let app, bug;

    beforeEach(() => {
      app = seedApp();
      bug = seedBug(app.id);
    });

    it('trackApproval adds to pending map', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      expect(sm.getPendingApprovals()).toHaveLength(1);
    });

    it('trackApproval persists to DB', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      const dbApproval = db.approvals.findByApprovalId('APR-001');
      expect(dbApproval).not.toBeNull();
    });

    it('trackApproval calculates timeout_at from timeoutMs', async () => {
      const before = Date.now();
      const approval = await sm.trackApproval(bug.id, 'APR-001', { timeoutMs: 7200000 });
      const timeoutMs = new Date(approval.timeout_at).getTime() - before;
      // Should be roughly 2 hours (7200000ms), allow 5s tolerance
      expect(timeoutMs).toBeGreaterThan(7195000);
      expect(timeoutMs).toBeLessThan(7205000);
    });

    it('trackApproval defaults to 1 hour timeout', async () => {
      const before = Date.now();
      const approval = await sm.trackApproval(bug.id, 'APR-001');
      const timeoutMs = new Date(approval.timeout_at).getTime() - before;
      expect(timeoutMs).toBeGreaterThan(3595000);
      expect(timeoutMs).toBeLessThan(3605000);
    });

    it('updateApproval removes from pending map', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      await sm.updateApproval('APR-001', 'approved', 'slack');
      expect(sm.getPendingApprovals()).toHaveLength(0);
    });

    it('updateApproval sets responded_at and responded_via', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      await sm.updateApproval('APR-001', 'approved', 'slack');
      const dbApproval = db.approvals.findByApprovalId('APR-001');
      expect(dbApproval.responded_at).toBeDefined();
      expect(dbApproval.responded_via).toBe('slack');
    });

    it('updateApproval persists to DB', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      await sm.updateApproval('APR-001', 'approved', 'slack');
      const dbApproval = db.approvals.findByApprovalId('APR-001');
      expect(dbApproval.status).toBe('approved');
    });

    it('updateApproval no-ops for unknown approvalId', async () => {
      await expect(sm.updateApproval('nonexistent', 'approved', 'slack'))
        .resolves.not.toThrow();
    });

    it('checkTimeouts returns empty array when nothing expired', async () => {
      await sm.trackApproval(bug.id, 'APR-001', { timeoutMs: 3600000 });
      expect(sm.checkTimeouts()).toEqual([]);
    });

    it('checkTimeouts returns expired approvalIds', async () => {
      await sm.trackApproval(bug.id, 'APR-001', { timeoutMs: -1000 }); // Already expired
      const expired = sm.checkTimeouts();
      expect(expired).toEqual(['APR-001']);
    });

    it('checkTimeouts does not auto-update status', async () => {
      await sm.trackApproval(bug.id, 'APR-001', { timeoutMs: -1000 });
      sm.checkTimeouts();
      // Approval should still be in pending map
      expect(sm.getPendingApprovals()).toHaveLength(1);
    });

    it('getPendingApprovals returns only pending', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      const bug2 = seedBug(app.id, 'BUG-002');
      await sm.trackApproval(bug2.id, 'APR-002');
      await sm.updateApproval('APR-002', 'approved', 'slack');
      expect(sm.getPendingApprovals()).toHaveLength(1);
    });

    it('getApproval finds from memory first, DB fallback', async () => {
      const approval = await sm.trackApproval(bug.id, 'APR-001');
      // Memory hit
      const fromMemory = sm.getApproval('APR-001');
      expect(fromMemory).toBe(approval);

      // After update, falls back to DB
      await sm.updateApproval('APR-001', 'approved', 'slack');
      const fromDb = sm.getApproval('APR-001');
      expect(fromDb).not.toBeNull();
      expect(fromDb.status).toBe('approved');
    });

    it('getApprovalsByBug queries DB', async () => {
      await sm.trackApproval(bug.id, 'APR-001');
      await sm.trackApproval(bug.id, 'APR-002');
      const approvals = await sm.getApprovalsByBug(bug.id);
      expect(approvals).toHaveLength(2);
    });
  });

  describe('Fix Lifecycle', () => {
    let app, bug;

    beforeEach(() => {
      app = seedApp();
      bug = seedBug(app.id);
    });

    it('trackFix adds to active map', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      expect(sm.getActiveFixes()).toHaveLength(1);
    });

    it('trackFix persists to DB', async () => {
      const fix = await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      const dbFix = db.fixes.findById(fix.id);
      expect(dbFix).not.toBeNull();
    });

    it('trackFix sets status = in-progress', async () => {
      const fix = await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      expect(fix.status).toBe('in-progress');
    });

    it('updateFixStatus updates status', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'applied', { applied_at: new Date().toISOString() });
      const fix = sm.getFix(bug.id);
      expect(fix.status).toBe('applied');
    });

    it('updateFixStatus removes from map on terminal status (verified)', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'verified', { verified_at: new Date().toISOString() });
      expect(sm.getActiveFixes()).toHaveLength(0);
    });

    it('updateFixStatus removes from map on terminal status (failed)', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'failed', { error: 'compilation error' });
      expect(sm.getActiveFixes()).toHaveLength(0);
    });

    it('updateFixStatus removes from map on terminal status (rolled-back)', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'rolled-back', { rolled_back_at: new Date().toISOString() });
      expect(sm.getActiveFixes()).toHaveLength(0);
    });

    it('updateFixStatus keeps in map on non-terminal status (applied)', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'applied', { applied_at: new Date().toISOString() });
      expect(sm.getActiveFixes()).toHaveLength(1);
    });

    it('updateFixStatus persists to DB', async () => {
      const fix = await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug.id, 'verified', { verified_at: new Date().toISOString() });
      const dbFix = db.fixes.findById(fix.id);
      expect(dbFix.status).toBe('verified');
    });

    it('getActiveFixes returns only in-progress', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      const bug2 = seedBug(app.id, 'BUG-002');
      await sm.trackFix(bug2.id, app.id, { fix_type: 'code_change' });
      await sm.updateFixStatus(bug2.id, 'verified');
      expect(sm.getActiveFixes()).toHaveLength(1);
    });

    it('getFix finds from memory first, DB fallback', async () => {
      const fix = await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      // Memory hit
      expect(sm.getFix(bug.id)).toBe(fix);

      // After terminal status, falls back to DB
      await sm.updateFixStatus(bug.id, 'verified');
      const fromDb = sm.getFix(bug.id);
      expect(fromDb).not.toBeNull();
      expect(fromDb.status).toBe('verified');
    });

    it('getFixesByApp queries DB', async () => {
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      const fixes = await sm.getFixesByApp(app.id);
      expect(fixes).toHaveLength(1);
    });
  });

  describe('Agent Health Tracking', () => {
    it('trackAgentHealth stores in map', () => {
      sm.trackAgentHealth('sentinel', { status: 'healthy', error_count: 0 });
      expect(sm.getAgentHealth('sentinel')).not.toBeNull();
    });

    it('trackAgentHealth updates existing entry', () => {
      sm.trackAgentHealth('sentinel', { status: 'healthy', error_count: 0 });
      sm.trackAgentHealth('sentinel', { status: 'degraded', error_count: 3 });
      const health = sm.getAgentHealth('sentinel');
      expect(health.status).toBe('degraded');
      expect(health.error_count).toBe(3);
    });

    it('getAgentHealth returns health object', () => {
      sm.trackAgentHealth('sentinel', { status: 'healthy', error_count: 0 });
      const health = sm.getAgentHealth('sentinel');
      expect(health.status).toBe('healthy');
      expect(health.updated_at).toBeDefined();
    });

    it('getAgentHealth returns null for unknown agent', () => {
      expect(sm.getAgentHealth('nonexistent')).toBeNull();
    });

    it('getAllAgentHealth returns full map', () => {
      sm.trackAgentHealth('sentinel', { status: 'healthy' });
      sm.trackAgentHealth('healer', { status: 'degraded' });
      const all = sm.getAllAgentHealth();
      expect(all.size).toBe(2);
      expect(all.get('sentinel').status).toBe('healthy');
    });

    it('agent health is NOT persisted to DB', () => {
      sm.trackAgentHealth('sentinel', { status: 'healthy', error_count: 0 });
      // No agent health table in DB — this is purely in-memory
      // Verify by creating a new StateManager with the same DB
      const sm2 = new StateManager({ db });
      expect(sm2.getAgentHealth('sentinel')).toBeNull();
    });
  });

  describe('Recovery', () => {
    it('recover loads running test_runs from DB', async () => {
      const app = seedApp();
      // Create a test run directly in DB as "running" (simulating interrupted process)
      db.testRuns.create({
        id: 'run-1',
        app_id: app.id,
        agents: ['sentinel'],
        status: 'running'
      });

      const sm2 = new StateManager({ db });
      await sm2.recover();
      expect(sm2.getActiveTestRuns()).toHaveLength(1);
    });

    it('recover marks loaded test_runs as interrupted', async () => {
      const app = seedApp();
      db.testRuns.create({
        id: 'run-1',
        app_id: app.id,
        agents: ['sentinel'],
        status: 'running'
      });

      const sm2 = new StateManager({ db });
      await sm2.recover();
      const run = sm2.getTestRun('run-1');
      expect(run.status).toBe('interrupted');
      const dbRun = db.testRuns.findById('run-1');
      expect(dbRun.status).toBe('interrupted');
    });

    it('recover loads pending approvals from DB', async () => {
      const app = seedApp();
      const bug = seedBug(app.id);
      db.approvals.create({
        bug_ref_id: bug.id,
        approval_id: 'APR-001',
        status: 'pending',
        timeout_at: new Date(Date.now() + 3600000).toISOString()
      });

      const sm2 = new StateManager({ db });
      await sm2.recover();
      expect(sm2.getPendingApprovals()).toHaveLength(1);
    });

    it('recover loads in-progress fixes from DB', async () => {
      const app = seedApp();
      const bug = seedBug(app.id);
      db.fixes.create({
        bug_ref_id: bug.id,
        app_id: app.id,
        fix_type: 'code_change',
        status: 'in-progress'
      });

      const sm2 = new StateManager({ db });
      await sm2.recover();
      expect(sm2.getActiveFixes()).toHaveLength(1);
    });

    it('recover returns count summary', async () => {
      const app = seedApp();
      const bug = seedBug(app.id);
      db.testRuns.create({ id: 'run-1', app_id: app.id, agents: ['sentinel'], status: 'running' });
      db.approvals.create({
        bug_ref_id: bug.id, approval_id: 'APR-001', status: 'pending',
        timeout_at: new Date(Date.now() + 3600000).toISOString()
      });
      db.fixes.create({
        bug_ref_id: bug.id, app_id: app.id, fix_type: 'code_change', status: 'in-progress'
      });

      const sm2 = new StateManager({ db });
      const result = await sm2.recover();
      expect(result).toEqual({
        recoveredTestRuns: 1,
        recoveredApprovals: 1,
        recoveredFixes: 1
      });
    });

    it('recover handles empty DB gracefully', async () => {
      const sm2 = new StateManager({ db });
      const result = await sm2.recover();
      expect(result).toEqual({
        recoveredTestRuns: 0,
        recoveredApprovals: 0,
        recoveredFixes: 0
      });
    });

    it('recover in no-db mode returns empty summary', async () => {
      const smNoDb = new StateManager();
      const result = await smNoDb.recover();
      expect(result).toEqual({
        recoveredTestRuns: 0,
        recoveredApprovals: 0,
        recoveredFixes: 0
      });
    });

    it('recover does not duplicate already-loaded state', async () => {
      const app = seedApp();
      db.testRuns.create({ id: 'run-1', app_id: app.id, agents: ['sentinel'], status: 'running' });

      const sm2 = new StateManager({ db });
      await sm2.recover();
      await sm2.recover(); // Second call
      expect(sm2.getActiveTestRuns()).toHaveLength(1);
    });
  });

  describe('Degraded Mode', () => {
    it('all methods work with db = null (pure in-memory)', async () => {
      const smNoDb = new StateManager();

      // Test run lifecycle
      const run = await smNoDb.createTestRun('app-1', ['sentinel']);
      expect(run.id).toBeDefined();
      await smNoDb.updateTestRunProgress(run.id, 'sentinel', { status: 'completed' });
      await smNoDb.completeTestRun(run.id, { total: 1, passed: 1, failed: 0 });

      // Approval lifecycle
      const approval = await smNoDb.trackApproval('bug-1', 'APR-001');
      expect(approval.id).toBeDefined();
      await smNoDb.updateApproval('APR-001', 'approved', 'slack');

      // Fix lifecycle
      const fix = await smNoDb.trackFix('bug-1', 'app-1', { fix_type: 'code_change' });
      expect(fix.id).toBeDefined();
      await smNoDb.updateFixStatus('bug-1', 'verified');

      // Agent health
      smNoDb.trackAgentHealth('sentinel', { status: 'healthy' });
      expect(smNoDb.getAgentHealth('sentinel').status).toBe('healthy');

      // DB queries return empty
      expect(await smNoDb.getRecentTestRuns('app-1')).toEqual([]);
      expect(await smNoDb.getApprovalsByBug('bug-1')).toEqual([]);
      expect(await smNoDb.getFixesByApp('app-1')).toEqual([]);
    });

    it('DB write failure does not throw', async () => {
      const brokenDb = {
        testRuns: { create: () => { throw new Error('DB broken'); } },
        apps: {}
      };
      const smBroken = new StateManager({ db: brokenDb });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(smBroken.createTestRun('app-1', ['sentinel']))
        .resolves.not.toThrow();

      warnSpy.mockRestore();
    });

    it('DB write failure logs warning', async () => {
      const brokenDb = {
        testRuns: { create: () => { throw new Error('DB broken'); } },
        apps: {}
      };
      const smBroken = new StateManager({ db: brokenDb });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await smBroken.createTestRun('app-1', ['sentinel']);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DB broken'));

      warnSpy.mockRestore();
    });

    it('DB read failure returns null/empty', () => {
      const smNoDb = new StateManager();
      expect(smNoDb.getTestRun('nonexistent')).toBeNull();
      expect(smNoDb.getApproval('nonexistent')).toBeNull();
      expect(smNoDb.getFix('nonexistent')).toBeNull();
    });

    it('in-memory state survives DB failure', async () => {
      const brokenDb = {
        testRuns: { create: () => { throw new Error('DB broken'); } },
        apps: {}
      };
      const smBroken = new StateManager({ db: brokenDb });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const run = await smBroken.createTestRun('app-1', ['sentinel']);
      expect(smBroken.getActiveTestRuns()).toHaveLength(1);
      expect(smBroken.getTestRun(run.id)).toBeDefined();

      warnSpy.mockRestore();
    });

    it('shutdown works with no DB', async () => {
      const smNoDb = new StateManager();
      await smNoDb.createTestRun('app-1', ['sentinel']);
      await expect(smNoDb.shutdown()).resolves.not.toThrow();
      expect(smNoDb.getActiveTestRuns()).toHaveLength(0);
    });

    it('shutdown is idempotent', async () => {
      const smNoDb = new StateManager();
      await smNoDb.shutdown();
      await expect(smNoDb.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Shutdown', () => {
    it('shutdown persists dirty state to DB', async () => {
      const app = seedApp();
      const run = await sm.createTestRun(app.id, ['sentinel']);
      await sm.shutdown();
      const dbRun = db.testRuns.findById(run.id);
      expect(dbRun.status).toBe('interrupted');
    });

    it('shutdown marks active runs as interrupted', async () => {
      const app = seedApp();
      await sm.createTestRun(app.id, ['sentinel']);
      await sm.createTestRun(app.id, ['healer']);
      await sm.shutdown();

      const runs = db.testRuns.findActive();
      // All should be interrupted, not running
      expect(runs).toHaveLength(0);
    });

    it('shutdown clears all Maps', async () => {
      const app = seedApp();
      const bug = seedBug(app.id);
      await sm.createTestRun(app.id, ['sentinel']);
      await sm.trackApproval(bug.id, 'APR-001');
      await sm.trackFix(bug.id, app.id, { fix_type: 'code_change' });
      sm.trackAgentHealth('sentinel', { status: 'healthy' });

      await sm.shutdown();
      expect(sm.getActiveTestRuns()).toHaveLength(0);
      expect(sm.getPendingApprovals()).toHaveLength(0);
      expect(sm.getActiveFixes()).toHaveLength(0);
      expect(sm.getAllAgentHealth().size).toBe(0);
    });
  });
});
