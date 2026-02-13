'use strict';

const crypto = require('crypto');
const DatabaseConnection = require('../../core/database/connection');
const Migrator = require('../../core/database/migrator');
const AppRepository = require('../../core/database/repositories/app-repository');
const TestRunRepository = require('../../core/database/repositories/test-run-repository');
const TestResultRepository = require('../../core/database/repositories/test-result-repository');
const BugRepository = require('../../core/database/repositories/bug-repository');
const ApprovalRepository = require('../../core/database/repositories/approval-repository');
const FixRepository = require('../../core/database/repositories/fix-repository');
const EvidenceMetadataRepository = require('../../core/database/repositories/evidence-metadata-repository');

describe('Concrete Repositories', () => {
  let conn;
  let appRepo, testRunRepo, testResultRepo, bugRepo, approvalRepo, fixRepo, evidenceRepo;

  beforeEach(async () => {
    conn = new DatabaseConnection();
    conn.open();
    const migrator = new Migrator(conn);
    await migrator.migrate();

    appRepo = new AppRepository(conn);
    testRunRepo = new TestRunRepository(conn);
    testResultRepo = new TestResultRepository(conn);
    bugRepo = new BugRepository(conn);
    approvalRepo = new ApprovalRepository(conn);
    fixRepo = new FixRepository(conn);
    evidenceRepo = new EvidenceMetadataRepository(conn);
  });

  afterEach(() => {
    try { conn.close(); } catch {}
  });

  // Shared helper: create an app and return it
  function seedApp(overrides = {}) {
    return appRepo.create({
      name: 'Test App',
      type: 'web',
      config: { url: 'http://test.com' },
      ...overrides
    });
  }

  // Shared helper: create a test run for an app
  function seedTestRun(appId, overrides = {}) {
    return testRunRepo.create({
      app_id: appId,
      agents: ['sentinel', 'healer'],
      ...overrides
    });
  }

  // Shared helper: create a bug for an app
  function seedBug(appId, bugId, overrides = {}) {
    return bugRepo.create({
      app_id: appId,
      bug_id: bugId,
      title: `Bug ${bugId}`,
      severity: 'high',
      priority: 'high',
      category: 'functional',
      detected_by: 'sentinel',
      ...overrides
    });
  }

  describe('AppRepository', () => {
    it('serializes/deserializes config JSON', () => {
      const config = { url: 'http://test.com', port: 3000, features: ['auth'] };
      const app = appRepo.create({ name: 'App', type: 'web', config });
      const found = appRepo.findById(app.id);
      expect(found.config).toEqual(config);
    });

    it('findByName() returns matching app', () => {
      appRepo.create({ name: 'Brainstormy', type: 'ai-chat' });
      const found = appRepo.findByName('Brainstormy');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Brainstormy');
    });

    it('findActive() returns only active apps', () => {
      appRepo.create({ name: 'Active', type: 'web' });
      appRepo.create({ name: 'Inactive', type: 'web', status: 'inactive' });
      const active = appRepo.findActive();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Active');
    });

    it('updateLastTestRun() sets timestamp', () => {
      const app = seedApp();
      const ts = new Date().toISOString();
      const updated = appRepo.updateLastTestRun(app.id, ts);
      expect(updated.last_test_run_at).toBe(ts);
    });
  });

  describe('TestRunRepository', () => {
    let app;

    beforeEach(() => {
      app = seedApp();
    });

    it('serializes/deserializes agents and summary JSON', () => {
      const agents = ['sentinel', 'healer'];
      const run = testRunRepo.create({ app_id: app.id, agents });
      const found = testRunRepo.findById(run.id);
      expect(found.agents).toEqual(agents);
    });

    it('findByApp() returns runs for specific app', () => {
      seedTestRun(app.id);
      seedTestRun(app.id);
      const app2 = seedApp({ name: 'Other' });
      seedTestRun(app2.id);

      const runs = testRunRepo.findByApp(app.id);
      expect(runs).toHaveLength(2);
    });

    it('findActive() returns running test runs', () => {
      seedTestRun(app.id);
      seedTestRun(app.id, { status: 'completed' });
      const active = testRunRepo.findActive();
      expect(active).toHaveLength(1);
    });

    it('findRecent() returns N most recent runs ordered by started_at DESC', () => {
      for (let i = 0; i < 5; i++) {
        seedTestRun(app.id);
      }
      const recent = testRunRepo.findRecent(app.id, 3);
      expect(recent).toHaveLength(3);
    });

    it('complete() sets status, summary, and completed_at', () => {
      const run = seedTestRun(app.id);
      const summary = { total: 10, passed: 8, failed: 2 };
      const completed = testRunRepo.complete(run.id, summary);
      expect(completed.status).toBe('completed');
      expect(completed.summary).toEqual(summary);
      expect(completed.completed_at).toBeDefined();
    });

    it('getPassRate() calculates correctly from summary JSON', () => {
      // Create completed runs with summaries
      const run1 = testRunRepo.create({
        app_id: app.id,
        status: 'completed',
        summary: { total: 10, passed: 8, failed: 2 }
      });
      const run2 = testRunRepo.create({
        app_id: app.id,
        status: 'completed',
        summary: { total: 10, passed: 10, failed: 0 }
      });

      const rate = testRunRepo.getPassRate(app.id);
      // (8 + 10) / (10 + 10) = 0.9
      expect(rate).toBe(0.9);
    });

    it('getPassRate() returns null when no completed runs', () => {
      expect(testRunRepo.getPassRate(app.id)).toBeNull();
    });
  });

  describe('TestResultRepository', () => {
    let app, run;

    beforeEach(() => {
      app = seedApp();
      run = seedTestRun(app.id);
    });

    it('serializes/deserializes details and evidence JSON', () => {
      const details = { steps: ['click', 'verify'] };
      const evidence = { screenshot: '/path/to/img.png' };
      const result = testResultRepo.create({
        test_run_id: run.id,
        app_id: app.id,
        agent_id: 'sentinel',
        test_id: 'test-1',
        test_name: 'Login Test',
        status: 'passed',
        details,
        evidence
      });
      const found = testResultRepo.findById(result.id);
      expect(found.details).toEqual(details);
      expect(found.evidence).toEqual(evidence);
    });

    it('findByTestRun() returns results for specific run', () => {
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't1', test_name: 'Test 1', status: 'passed'
      });
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't2', test_name: 'Test 2', status: 'failed'
      });
      const results = testResultRepo.findByTestRun(run.id);
      expect(results).toHaveLength(2);
    });

    it('findByAgent() returns results for specific agent', () => {
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't1', test_name: 'Test 1', status: 'passed'
      });
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'healer',
        test_id: 't2', test_name: 'Test 2', status: 'passed'
      });
      const results = testResultRepo.findByAgent(app.id, 'sentinel');
      expect(results).toHaveLength(1);
    });

    it('findFailed() returns only failed results for app', () => {
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't1', test_name: 'Test 1', status: 'passed'
      });
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't2', test_name: 'Test 2', status: 'failed'
      });
      const failed = testResultRepo.findFailed(app.id);
      expect(failed).toHaveLength(1);
      expect(failed[0].status).toBe('failed');
    });
  });

  describe('BugRepository', () => {
    let app;

    beforeEach(() => {
      app = seedApp();
    });

    it('serializes/deserializes evidence, fix_details, related_bugs JSON', () => {
      const evidence = { screenshot: '/img.png', logs: ['error1'] };
      const bug = seedBug(app.id, 'BUG-001', { evidence });
      const found = bugRepo.findById(bug.id);
      expect(found.evidence).toEqual(evidence);
    });

    it('findByApp() returns bugs for specific app', () => {
      seedBug(app.id, 'BUG-001');
      seedBug(app.id, 'BUG-002');
      const bugs = bugRepo.findByApp(app.id);
      expect(bugs).toHaveLength(2);
    });

    it('findOpen() returns open and in-progress bugs', () => {
      seedBug(app.id, 'BUG-001', { status: 'open' });
      seedBug(app.id, 'BUG-002', { status: 'in-progress' });
      seedBug(app.id, 'BUG-003', { status: 'fixed' });
      const open = bugRepo.findOpen(app.id);
      expect(open).toHaveLength(2);
    });

    it('findBySeverity() returns bugs with specific severity', () => {
      seedBug(app.id, 'BUG-001', { severity: 'high' });
      seedBug(app.id, 'BUG-002', { severity: 'low' });
      const high = bugRepo.findBySeverity(app.id, 'high');
      expect(high).toHaveLength(1);
    });

    it('findByBugId() returns bug by human-readable BUG-NNN id', () => {
      seedBug(app.id, 'BUG-042');
      const found = bugRepo.findByBugId('BUG-042');
      expect(found).not.toBeNull();
      expect(found.bug_id).toBe('BUG-042');
    });

    it('nextBugNumber() returns 1 when no bugs exist', () => {
      expect(bugRepo.nextBugNumber(app.id)).toBe(1);
    });

    it('nextBugNumber() returns correct next number with existing bugs', () => {
      seedBug(app.id, 'BUG-001');
      seedBug(app.id, 'BUG-005');
      seedBug(app.id, 'BUG-003');
      expect(bugRepo.nextBugNumber(app.id)).toBe(6);
    });

    it('updateStatus() updates status and extra fields', () => {
      const bug = seedBug(app.id, 'BUG-001');
      const fixedAt = new Date().toISOString();
      const updated = bugRepo.updateStatus(bug.id, 'fixed', { fixed_at: fixedAt });
      expect(updated.status).toBe('fixed');
      expect(updated.fixed_at).toBe(fixedAt);
    });
  });

  describe('ApprovalRepository', () => {
    let app, bug;

    beforeEach(() => {
      app = seedApp();
      bug = seedBug(app.id, 'BUG-001');
    });

    function seedApproval(overrides = {}) {
      return approvalRepo.create({
        bug_ref_id: bug.id,
        approval_id: `APR-${crypto.randomUUID().slice(0, 8)}`,
        timeout_at: new Date(Date.now() + 3600000).toISOString(),
        ...overrides
      });
    }

    it('findByApprovalId() returns approval by approval_id', () => {
      const approval = seedApproval({ approval_id: 'APR-TEST-001' });
      const found = approvalRepo.findByApprovalId('APR-TEST-001');
      expect(found).not.toBeNull();
      expect(found.id).toBe(approval.id);
    });

    it('findPending() returns only pending approvals', () => {
      seedApproval();
      seedApproval({ status: 'approved' });
      const pending = approvalRepo.findPending();
      expect(pending).toHaveLength(1);
    });

    it('findExpired() correctly identifies timed-out approvals', () => {
      // Create an approval that's already expired
      seedApproval({ timeout_at: '2020-01-01T00:00:00.000Z' });
      // Create one that's still valid
      seedApproval({ timeout_at: new Date(Date.now() + 3600000).toISOString() });

      const expired = approvalRepo.findExpired();
      expect(expired).toHaveLength(1);
    });

    it('findByBug() returns approvals for specific bug', () => {
      seedApproval();
      const bug2 = seedBug(app.id, 'BUG-002');
      approvalRepo.create({
        bug_ref_id: bug2.id,
        approval_id: 'APR-OTHER',
        timeout_at: new Date(Date.now() + 3600000).toISOString()
      });

      const approvals = approvalRepo.findByBug(bug.id);
      expect(approvals).toHaveLength(1);
    });

    it('respond() sets status, responded_at, and responded_via', () => {
      const approval = seedApproval();
      const responded = approvalRepo.respond(approval.id, 'approved', 'slack');
      expect(responded.status).toBe('approved');
      expect(responded.responded_at).toBeDefined();
      expect(responded.responded_via).toBe('slack');
    });
  });

  describe('FixRepository', () => {
    let app, bug;

    beforeEach(() => {
      app = seedApp();
      bug = seedBug(app.id, 'BUG-001');
    });

    function seedFix(overrides = {}) {
      return fixRepo.create({
        bug_ref_id: bug.id,
        app_id: app.id,
        fix_type: 'code_change',
        ...overrides
      });
    }

    it('serializes/deserializes generated_fix, safety_review, verification_result JSON', () => {
      const generatedFix = { file: 'app.js', changes: [{ line: 10, content: 'fix' }] };
      const safetyReview = { safe: true, concerns: [] };
      const fix = seedFix({ generated_fix: generatedFix, safety_review: safetyReview });
      const found = fixRepo.findById(fix.id);
      expect(found.generated_fix).toEqual(generatedFix);
      expect(found.safety_review).toEqual(safetyReview);
    });

    it('findByBug() returns fixes for specific bug', () => {
      seedFix();
      seedFix();
      const fixes = fixRepo.findByBug(bug.id);
      expect(fixes).toHaveLength(2);
    });

    it('findByApp() returns fixes for specific app', () => {
      seedFix();
      const app2 = seedApp({ name: 'Other' });
      const bug2 = seedBug(app2.id, 'BUG-002');
      fixRepo.create({ bug_ref_id: bug2.id, app_id: app2.id, fix_type: 'code_change' });

      const fixes = fixRepo.findByApp(app.id);
      expect(fixes).toHaveLength(1);
    });

    it('findInProgress() returns only in-progress fixes', () => {
      seedFix({ status: 'in-progress' });
      seedFix({ status: 'completed' });
      const inProgress = fixRepo.findInProgress();
      expect(inProgress).toHaveLength(1);
    });
  });

  describe('EvidenceMetadataRepository', () => {
    let app, run;

    beforeEach(() => {
      app = seedApp();
      run = seedTestRun(app.id);
    });

    function seedEvidence(overrides = {}) {
      return evidenceRepo.create({
        app_id: app.id,
        test_run_id: run.id,
        type: 'screenshot',
        file_path: '/evidence/img.png',
        file_size: 1024,
        ...overrides
      });
    }

    it('serializes/deserializes metadata JSON', () => {
      const metadata = { width: 1920, height: 1080, format: 'png' };
      const ev = seedEvidence({ metadata });
      const found = evidenceRepo.findById(ev.id);
      expect(found.metadata).toEqual(metadata);
    });

    it('findByTestRun() returns evidence for specific run', () => {
      seedEvidence();
      seedEvidence();
      const evidence = evidenceRepo.findByTestRun(run.id);
      expect(evidence).toHaveLength(2);
    });

    it('findByBug() returns evidence linked to specific bug', () => {
      const bug = seedBug(app.id, 'BUG-001');
      seedEvidence({ bug_ref_id: bug.id });
      seedEvidence(); // No bug link
      const evidence = evidenceRepo.findByBug(bug.id);
      expect(evidence).toHaveLength(1);
    });

    it('findByType() returns evidence of specific type for app', () => {
      seedEvidence({ type: 'screenshot' });
      seedEvidence({ type: 'log' });
      const screenshots = evidenceRepo.findByType(app.id, 'screenshot');
      expect(screenshots).toHaveLength(1);
    });

    it('getStorageUsage() sums file_size correctly', () => {
      seedEvidence({ file_size: 1000 });
      seedEvidence({ file_size: 2500 });
      seedEvidence({ file_size: 500 });
      expect(evidenceRepo.getStorageUsage(app.id)).toBe(4000);
    });

    it('getStorageUsage() returns 0 when no evidence exists', () => {
      const app2 = seedApp({ name: 'Empty App' });
      expect(evidenceRepo.getStorageUsage(app2.id)).toBe(0);
    });
  });

  describe('Cascade deletes through repositories', () => {
    it('deleting app cascades to test_runs, bugs, approvals, fixes, evidence', () => {
      const app = seedApp();
      const run = seedTestRun(app.id);
      testResultRepo.create({
        test_run_id: run.id, app_id: app.id, agent_id: 'sentinel',
        test_id: 't1', test_name: 'Test 1', status: 'passed'
      });
      const bug = seedBug(app.id, 'BUG-001');
      approvalRepo.create({
        bug_ref_id: bug.id, approval_id: 'APR-001',
        timeout_at: new Date(Date.now() + 3600000).toISOString()
      });
      fixRepo.create({
        bug_ref_id: bug.id, app_id: app.id, fix_type: 'code_change'
      });
      evidenceRepo.create({
        app_id: app.id, test_run_id: run.id, type: 'screenshot',
        file_path: '/evidence/img.png'
      });

      // Delete the app
      appRepo.delete(app.id);

      expect(testRunRepo.findByApp(app.id)).toHaveLength(0);
      expect(bugRepo.findByApp(app.id)).toHaveLength(0);
      expect(testResultRepo.findByTestRun(run.id)).toHaveLength(0);
    });
  });
});
