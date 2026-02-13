'use strict';

const BugDetector = require('../../core/engine/bug-detector');
const ApprovalManager = require('../../core/engine/approval-manager');
const AutoFixer = require('../../core/engine/auto-fixer');
const { BugDetectorError, FixError, ApprovalError, AdapterError } = require('../../core/engine/errors');
const BugTrackerAdapter = require('../../core/integrations/adapters/bug-tracker');

// ═══════════════════════════════════════════════════════════
// DEFAULT RESPONSE DATA
// ═══════════════════════════════════════════════════════════

const DEFAULT_ANALYSIS = {
  root_cause: 'Memory retrieval threshold too low causing irrelevant results',
  affected_component: 'Memory search service',
  likely_location: 'services/search.py:retrieve_context()',
  fix_approach: 'adjust threshold from 0.3 to 0.5',
  confidence: 0.85,
  impact_assessment: 'High — incorrect memories returned to users'
};

const DEFAULT_FIX = {
  files_to_modify: [{
    path: 'services/search.py',
    changes: [{
      type: 'replace',
      line: 42,
      old_code: 'threshold = 0.3',
      new_code: 'threshold = 0.5  // Fixed: was too low'
    }]
  }],
  regression_test: {
    file: 'tests/test_search.py',
    test_code: 'def test_threshold(): assert get_threshold() >= 0.5'
  },
  explanation: 'Raised memory retrieval threshold from 0.3 to 0.5'
};

// ═══════════════════════════════════════════════════════════
// MOCK FACTORIES
// ═══════════════════════════════════════════════════════════

function createMockLLM() {
  return {
    complete: jest.fn().mockResolvedValue({
      content: JSON.stringify(DEFAULT_ANALYSIS)
    })
  };
}

function createMockBugTracker() {
  return {
    createIssue: jest.fn().mockResolvedValue({
      id: 'LIN-123', url: 'https://linear.app/issue/LIN-123', key: 'LIN-123'
    }),
    updateIssue: jest.fn().mockResolvedValue({ id: 'LIN-123', url: 'https://linear.app/issue/LIN-123' }),
    addComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
    getIssue: jest.fn().mockResolvedValue({})
  };
}

function createMockNotifier() {
  return {
    send: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' }),
    sendWithActions: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' })
  };
}

function createMockCodeExecutor() {
  return {
    createBranch: jest.fn().mockResolvedValue({ name: 'auto-fix/BUG-1', created: true }),
    applyChanges: jest.fn().mockResolvedValue({ applied: true, filesModified: 1 }),
    rollback: jest.fn().mockResolvedValue({ rolledBack: true })
  };
}

function createMockTestRunner() {
  return {
    runTest: jest.fn().mockResolvedValue({ passed: true, details: 'Test passed' }),
    runSuite: jest.fn().mockResolvedValue({ passed: true, total: 10, failures: 0 })
  };
}

function createMockBugStorage() {
  const bugs = new Map();
  return {
    saveBug: jest.fn(async (bug) => { bugs.set(bug.id, bug); return bug; }),
    updateBug: jest.fn(async (id, updates) => {
      const bug = bugs.get(id);
      if (bug) Object.assign(bug, updates);
      return bug;
    }),
    getNextBugNumber: jest.fn(async () => bugs.size + 1),
    _bugs: bugs
  };
}

function createMockApprovalStorage() {
  const approvals = new Map();
  return {
    saveApproval: jest.fn(async (approval) => {
      approvals.set(approval.approval_id, approval);
      return approval;
    }),
    updateApproval: jest.fn(async (approvalId, updates) => {
      const approval = approvals.get(approvalId);
      if (approval) Object.assign(approval, updates);
      return approval;
    }),
    getApproval: jest.fn(async (approvalId) => approvals.get(approvalId) || null),
    _approvals: approvals
  };
}

function createMockFixStorage() {
  const fixes = new Map();
  return {
    saveFix: jest.fn(async (fix) => { fixes.set(fix.id, fix); return fix; }),
    updateFix: jest.fn(async (id, updates) => {
      const fix = fixes.get(id);
      if (fix) Object.assign(fix, updates);
      return fix;
    }),
    _fixes: fixes
  };
}

// ═══════════════════════════════════════════════════════════
// TEST DATA FACTORIES
// ═══════════════════════════════════════════════════════════

function createTestApp(overrides = {}) {
  return { id: 'brainstormy', name: 'Brainstormy', ...overrides };
}

function createTestFailure(overrides = {}) {
  return {
    test_id: 'test-memory-001',
    scenarioId: 'scenario-memory-recall',
    scenarioName: 'Memory Recall Accuracy',
    name: 'Memory Recall Accuracy',
    status: 'failed',
    error: {
      message: 'Expected recall accuracy >= 0.8 but got 0.45',
      stack: 'Error: Expected recall accuracy\n    at MemoryTest.verify (tests/memory.js:42:5)'
    },
    evidence: {
      screenshots: ['screenshots/memory-fail-001.png'],
      console_logs: [
        { level: 'error', message: 'SearchService: Low relevance score 0.32' },
        { level: 'error', message: 'MemoryStore: Cache miss for context_id=ctx-789' }
      ],
      network_requests: [
        { url: '/api/memory/search', method: 'POST', status: 500, failed: true },
        { url: '/api/memory/context', method: 'GET', status: 200, failed: false }
      ]
    },
    state: { url: 'https://brainstormy.app/editor' },
    timestamp: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════
// INTEGRATION STACK
// ═══════════════════════════════════════════════════════════

function createIntegrationStack(overrides = {}) {
  const llm = createMockLLM();
  const bugTracker = createMockBugTracker();
  const notifier = createMockNotifier();
  const codeExecutor = createMockCodeExecutor();
  const testRunner = createMockTestRunner();
  const bugStorage = createMockBugStorage();
  const approvalStorage = createMockApprovalStorage();
  const fixStorage = createMockFixStorage();

  const approvalManager = new ApprovalManager({
    notifier,
    storage: approvalStorage,
    timeoutMs: overrides.timeoutMs || 3600000,
    recipients: ['+1234567890']
  });

  const autoFixer = new AutoFixer({
    llm, codeExecutor, testRunner,
    storage: fixStorage, bugTracker, notifier
  });

  const bugDetector = new BugDetector({
    llm, bugTracker, notifier,
    storage: bugStorage, approvalManager
  });

  return {
    bugDetector, approvalManager, autoFixer,
    llm, bugTracker, notifier, codeExecutor, testRunner,
    bugStorage, approvalStorage, fixStorage
  };
}

// ═══════════════════════════════════════════════════════════
// GROUP 1: Full Happy-Path Workflow
// ═══════════════════════════════════════════════════════════

describe('Group 1: Full Happy-Path Workflow', () => {
  test('Complete bug detection → approval → fix workflow', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });

    // Step 1: Bug detection
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    expect(bug.bug_id).toBe('BUG-1');
    expect(bug.category).toBe('memory');
    expect(bug.auto_fixable).toBe(true);
    expect(stack.bugTracker.createIssue).toHaveBeenCalledTimes(1);
    expect(bug.external_issue_id).toBe('LIN-123');
    expect(stack.notifier.sendWithActions).toHaveBeenCalledTimes(1);
    const approvalId = bug.approval_id;
    expect(approvalId).toBeTruthy();

    // Step 2: Approve
    const response = await stack.approvalManager.handleResponse(`YES-${approvalId}`);
    expect(response.action).toBe('approved');

    // Step 3: Auto-fix
    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, response.approval);
    expect(fixResult.status).toBe('verified');

    // Verify adapter call order
    expect(stack.llm.complete).toHaveBeenCalledTimes(2);
    expect(stack.codeExecutor.createBranch).toHaveBeenCalledTimes(1);
    expect(stack.codeExecutor.applyChanges).toHaveBeenCalledTimes(1);
    expect(stack.testRunner.runTest).toHaveBeenCalledTimes(1);
    expect(stack.testRunner.runSuite).toHaveBeenCalledTimes(1);
  });

  test('Full workflow with NO response', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`NO-${bug.approval_id}`);
    expect(response.action).toBe('rejected');
    expect(response.approval.status).toBe('rejected');
    expect(stack.codeExecutor.applyChanges).not.toHaveBeenCalled();
  });

  test('Full workflow with INFO then YES response', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });

    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const approvalId = bug.approval_id;

    const infoResponse = await stack.approvalManager.handleResponse(`INFO-${approvalId}`);
    expect(infoResponse.action).toBe('info');
    expect(infoResponse.message).toContain(bug.bug_id);

    const yesResponse = await stack.approvalManager.handleResponse(`YES-${approvalId}`);
    expect(yesResponse.action).toBe('approved');

    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, yesResponse.approval);
    expect(fixResult.status).toBe('verified');
  });

  test('Full workflow with timeout', async () => {
    const stack = createIntegrationStack({ timeoutMs: 1 });
    const app = createTestApp();

    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    await new Promise(resolve => setTimeout(resolve, 10));

    const timedOut = await stack.approvalManager.checkTimeout(bug.approval_id);
    expect(timedOut).toBe(true);

    const approval = await stack.approvalManager.getApproval(bug.approval_id);
    expect(approval.status).toBe('timed-out');
  });

  test('Non-auto-fixable bug skips approval entirely', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.llm.complete.mockResolvedValueOnce({
      content: JSON.stringify({
        ...DEFAULT_ANALYSIS,
        fix_approach: 'redesign architecture to support async memory retrieval'
      })
    });

    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    expect(bug.auto_fixable).toBe(false);
    expect(stack.notifier.sendWithActions).not.toHaveBeenCalled();
    expect(stack.bugTracker.createIssue).toHaveBeenCalledTimes(1);
    const issueArgs = stack.bugTracker.createIssue.mock.calls[0][0];
    expect(issueArgs.labels).toContain('needs-manual-fix');
  });

  test('Multiple bugs generate sequential IDs', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    const bug1 = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const bug2 = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const bug3 = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());

    expect(bug1.bug_id).toBe('BUG-1');
    expect(bug2.bug_id).toBe('BUG-2');
    expect(bug3.bug_id).toBe('BUG-3');
  });

  test("Bug tracker failure doesn't block bug creation", async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.bugTracker.createIssue.mockRejectedValueOnce(new Error('Linear API down'));
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());

    expect(bug.bug_id).toBe('BUG-1');
    expect(bug.external_issue_id).toBeNull();
    expect(bug._issueCreationError).toBe('Linear API down');
  });

  test('LLM failure produces degraded but valid bug', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.llm.complete.mockRejectedValueOnce(new Error('LLM service unavailable'));
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());

    expect(bug.bug_id).toBe('BUG-1');
    expect(bug.root_cause).toBe('LLM analysis failed');
    expect(bug.auto_fixable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// GROUP 2: Auto-Fixer Safety Integration
// ═══════════════════════════════════════════════════════════

describe('Group 2: Auto-Fixer Safety Integration', () => {
  async function createApprovedBugAndApproval(stack, llmFixResponse) {
    const app = createTestApp();
    stack.llm.complete.mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) });
    if (llmFixResponse) {
      stack.llm.complete.mockResolvedValueOnce({ content: JSON.stringify(llmFixResponse) });
    }
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    return { app, bug, approval: response.approval };
  }

  test('Safety review rejects dangerous fix — entire pipeline returns safety-rejected', async () => {
    const stack = createIntegrationStack();
    const dangerousFix = {
      files_to_modify: [{
        path: 'services/search.py',
        changes: [{ type: 'replace', line: 42, old_code: 'pass', new_code: 'eval("dangerous")' }]
      }],
      explanation: 'Fix with eval'
    };
    const { app, bug, approval } = await createApprovedBugAndApproval(stack, dangerousFix);
    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, approval);

    expect(fixResult.status).toBe('safety-rejected');
    expect(stack.codeExecutor.applyChanges).not.toHaveBeenCalled();
  });

  test('Safety review rejects too many changes', async () => {
    const stack = createIntegrationStack();
    const changes = Array.from({ length: 15 }, (_, i) => ({
      type: 'replace', line: i + 1, old_code: `old_${i}`, new_code: `new_${i}`
    }));
    const bigFix = {
      files_to_modify: [{ path: 'services/search.py', changes }],
      explanation: 'Too many changes'
    };
    const { app, bug, approval } = await createApprovedBugAndApproval(stack, bigFix);
    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, approval);

    expect(fixResult.status).toBe('safety-rejected');
  });

  test('Fix application failure triggers rollback', async () => {
    const stack = createIntegrationStack();
    const { app, bug, approval } = await createApprovedBugAndApproval(stack, DEFAULT_FIX);
    stack.codeExecutor.applyChanges.mockRejectedValueOnce(new Error('Permission denied'));

    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, approval);
    expect(fixResult.status).toBe('apply-error');
    expect(stack.codeExecutor.rollback).toHaveBeenCalled();
  });

  test('Verification failure triggers rollback', async () => {
    const stack = createIntegrationStack();
    const { app, bug, approval } = await createApprovedBugAndApproval(stack, DEFAULT_FIX);
    stack.testRunner.runTest.mockResolvedValueOnce({ passed: false, details: 'Still failing' });

    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, approval);
    expect(fixResult.status).toBe('rolled-back');
    expect(stack.codeExecutor.rollback).toHaveBeenCalled();
  });

  test('Regression suite failure triggers rollback even if original test passes', async () => {
    const stack = createIntegrationStack();
    const { app, bug, approval } = await createApprovedBugAndApproval(stack, DEFAULT_FIX);
    stack.testRunner.runTest.mockResolvedValueOnce({ passed: true, details: 'Original passes' });
    stack.testRunner.runSuite.mockResolvedValueOnce({ passed: false, total: 10, failures: 2 });

    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, approval);
    expect(fixResult.status).toBe('rolled-back');
    expect(stack.codeExecutor.rollback).toHaveBeenCalled();
  });

  test('Unapproved fix throws FixError', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const approval = { approval_id: 'ABC-1', status: 'pending', bug_id: bug.bug_id };

    await expect(
      stack.autoFixer.generateAndApplyFix(app, bug, approval)
    ).rejects.toThrow(FixError);
  });

  test('Rejected fix throws FixError', async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const approval = { approval_id: 'ABC-1', status: 'rejected', bug_id: bug.bug_id };

    await expect(
      stack.autoFixer.generateAndApplyFix(app, bug, approval)
    ).rejects.toThrow(FixError);
  });
});

// ═══════════════════════════════════════════════════════════
// GROUP 3: Cross-Component Data Flow
// ═══════════════════════════════════════════════════════════

describe('Group 3: Cross-Component Data Flow', () => {
  test('Bug record from detector contains all fields needed by auto-fixer', async () => {
    const stack = createIntegrationStack();
    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

    expect(bug.bug_id).toBeDefined();
    expect(bug.likely_location).toBeDefined();
    expect(bug.fix_approach).toBeDefined();
    expect(bug.category).toBeDefined();
    expect(bug.evidence).toBeDefined();
    expect(bug.evidence.test_id).toBeDefined();
    expect(bug.title).toBeDefined();
    expect(bug.root_cause).toBeDefined();
    expect(bug.affected_component).toBeDefined();
  });

  test('Approval record from manager contains all fields needed by auto-fixer', async () => {
    const stack = createIntegrationStack();
    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

    const approval = await stack.approvalManager.getApproval(bug.approval_id);
    expect(approval.approval_id).toBeDefined();
    expect(approval.status).toBe('pending');
    expect(approval.bug_id).toBe(bug.bug_id);
    expect(approval.bug).toBeDefined();

    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    expect(response.approval.status).toBe('approved');
    expect(response.approval.responded_at).toBeDefined();
  });

  test('Evidence flows from failure through bug to issue description', async () => {
    const stack = createIntegrationStack();
    const failure = createTestFailure({
      evidence: {
        screenshots: ['shot.png'],
        console_logs: [
          { level: 'error', message: 'Connection timeout' },
          { level: 'error', message: 'Null pointer' },
          { level: 'warn', message: 'Slow query' }
        ],
        network_requests: [
          { url: '/api/search', method: 'POST', status: 500, failed: true },
          { url: '/api/health', method: 'GET', status: 200, failed: false }
        ]
      }
    });

    await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', failure);
    const issueArgs = stack.bugTracker.createIssue.mock.calls[0][0];
    expect(issueArgs.description).toContain('Console Errors: 2');
    expect(issueArgs.description).toContain('Network Failures: 1');
  });

  test('Classification affects auto-fixability → affects labels', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete.mockResolvedValueOnce({
      content: JSON.stringify({
        ...DEFAULT_ANALYSIS,
        affected_component: 'UI renderer component',
        fix_approach: 'update selector to fix mobile layout'
      })
    });

    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());
    expect(bug.category).toBe('ui');
    expect(bug.auto_fixable).toBe(false);
    const issueArgs = stack.bugTracker.createIssue.mock.calls[0][0];
    expect(issueArgs.labels).toContain('needs-manual-fix');
  });

  test('Classification affects auto-fixability → affects approval flow', async () => {
    const stack = createIntegrationStack();
    // Default analysis = memory category + simple pattern → auto-fixable
    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

    expect(bug.category).toBe('memory');
    expect(bug.auto_fixable).toBe(true);
    expect(stack.notifier.sendWithActions).toHaveBeenCalledTimes(1);
  });

  test('FixResult contains enough info for bug status update', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });

    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, response.approval);

    expect(fixResult.status).toBeDefined();
    expect(fixResult.bugId).toBe(bug.bug_id);
    expect(fixResult.explanation).toBeDefined();
    expect(fixResult.startedAt).toBeDefined();
    expect(fixResult.completedAt).toBeDefined();
  });

  test('LLM prompt includes evidence from failure', async () => {
    const stack = createIntegrationStack();
    const failure = createTestFailure({
      evidence: {
        screenshots: [],
        console_logs: [{ level: 'error', message: 'UNIQUE_ERROR_STRING_12345' }],
        network_requests: []
      }
    });

    await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', failure);
    const llmPrompt = stack.llm.complete.mock.calls[0][0];
    expect(llmPrompt).toContain('UNIQUE_ERROR_STRING_12345');
  });

  test('Fix prompt includes bug analysis data', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });

    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    await stack.autoFixer.generateAndApplyFix(app, bug, response.approval);

    const fixPrompt = stack.llm.complete.mock.calls[1][0];
    expect(fixPrompt).toContain(bug.root_cause);
    expect(fixPrompt).toContain(bug.likely_location);
    expect(fixPrompt).toContain(bug.fix_approach);
  });

  test("Multiple sequential bug workflows don't interfere", async () => {
    const stack = createIntegrationStack();
    const app = createTestApp();

    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });

    const bug1 = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const resp1 = await stack.approvalManager.handleResponse(`YES-${bug1.approval_id}`);
    const fix1 = await stack.autoFixer.generateAndApplyFix(app, bug1, resp1.approval);

    const bug2 = await stack.bugDetector.detectAndReport(app, 'healer', createTestFailure());
    const resp2 = await stack.approvalManager.handleResponse(`YES-${bug2.approval_id}`);
    const fix2 = await stack.autoFixer.generateAndApplyFix(app, bug2, resp2.approval);

    expect(bug1.bug_id).toBe('BUG-1');
    expect(bug2.bug_id).toBe('BUG-2');
    expect(bug1.approval_id).not.toBe(bug2.approval_id);
    expect(fix1.status).toBe('verified');
    expect(fix2.status).toBe('verified');
  });

  test('Approval lookup after request finds the correct bug', async () => {
    const stack = createIntegrationStack();
    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

    const approval = await stack.approvalManager.getApproval(bug.approval_id);
    expect(approval.bug_id).toBe(bug.bug_id);

    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    expect(response.bug.bug_id).toBe(bug.bug_id);
  });
});

// ═══════════════════════════════════════════════════════════
// GROUP 4: Error Isolation
// ═══════════════════════════════════════════════════════════

describe('Group 4: Error Isolation', () => {
  test("Bug tracker error during detection doesn't prevent approval", async () => {
    const stack = createIntegrationStack();
    stack.bugTracker.createIssue.mockRejectedValueOnce(new Error('Linear API error'));

    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());
    expect(bug.bug_id).toBe('BUG-1');
    expect(bug._issueCreationError).toBe('Linear API error');
    expect(stack.notifier.sendWithActions).toHaveBeenCalledTimes(1);
    expect(bug.approval_id).toBeTruthy();
  });

  test("Notifier error during approval doesn't prevent record creation", async () => {
    const stack = createIntegrationStack();
    stack.notifier.sendWithActions.mockRejectedValueOnce(new Error('WhatsApp API down'));

    const bug = await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());
    expect(bug.approval_id).toBeTruthy();

    const approval = await stack.approvalManager.getApproval(bug.approval_id);
    expect(approval).toBeTruthy();
    expect(approval.status).toBe('pending');
    expect(approval._notificationError).toBe('WhatsApp API down');
  });

  test('Fix generation LLM error returns clean FixResult', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockRejectedValueOnce(new Error('LLM rate limited'));

    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);
    const fixResult = await stack.autoFixer.generateAndApplyFix(app, bug, response.approval);

    expect(fixResult.status).toBe('failed');
    expect(stack.fixStorage.updateFix).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed' })
    );
  });

  test('Rollback error during apply-error throws FixError', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) })
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_FIX) });
    stack.codeExecutor.applyChanges.mockRejectedValue(new Error('Disk full'));
    stack.codeExecutor.rollback.mockRejectedValue(new Error('Cannot rollback'));

    const app = createTestApp();
    const bug = await stack.bugDetector.detectAndReport(app, 'sentinel', createTestFailure());
    const response = await stack.approvalManager.handleResponse(`YES-${bug.approval_id}`);

    await expect(
      stack.autoFixer.generateAndApplyFix(app, bug, response.approval)
    ).rejects.toThrow(FixError);

    expect(stack.fixStorage.updateFix).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed' })
    );
  });

  test('BugDetectorError has correct phase on evidence failure', async () => {
    const stack = createIntegrationStack();
    try {
      await stack.bugDetector.detectAndReport(createTestApp(), 'sentinel', null);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(BugDetectorError);
      expect(err.phase).toBe('evidence');
    }
  });

  test('FixError has correct phase on generation failure', async () => {
    const stack = createIntegrationStack();
    stack.llm.complete.mockResolvedValue({ content: 'not valid json {{{}}}' });

    const bug = {
      bug_id: 'BUG-1', title: 'Test', root_cause: 'test',
      affected_component: 'test', likely_location: 'test.js:1',
      fix_approach: 'test fix', category: 'memory',
      evidence: { test_id: 'test-1' }
    };
    const context = { relevant_code: 'code', file_path: 'test.js', surrounding_files: [], language: 'javascript' };

    try {
      await stack.autoFixer.generateFix(createTestApp(), bug, context);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(FixError);
      expect(err.phase).toBe('generation');
    }
  });

  test('ApprovalError on bad bugId', () => {
    const stack = createIntegrationStack();
    expect(() => {
      stack.approvalManager.generateApprovalId('invalid');
    }).toThrow(ApprovalError);
  });

  test('AdapterError from base classes', async () => {
    const adapter = new BugTrackerAdapter();
    try {
      await adapter.createIssue({});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('bug_tracker');
      expect(err.operation).toBe('createIssue');
    }
  });
});

// ═══════════════════════════════════════════════════════════
// GROUP 5: Orchestrator Wiring
// ═══════════════════════════════════════════════════════════

describe('Group 5: Orchestrator Wiring', () => {
  function createFailureHandler(bugDetector, appConfig) {
    return {
      handle: async (result) => {
        for (const agentResult of result.agentResults) {
          for (const scenario of agentResult.scenarios) {
            if (scenario.status === 'failed' || scenario.status === 'error') {
              await bugDetector.detectAndReport(appConfig, agentResult.agentId, scenario);
            }
          }
        }
      }
    };
  }

  function createScenario(id, status) {
    return {
      test_id: id, scenarioId: id, scenarioName: `Scenario ${id}`,
      name: `Scenario ${id}`, status,
      error: status !== 'passed' ? { message: `${status}: something went wrong` } : null,
      evidence: {
        screenshots: [],
        console_logs: status !== 'passed' ? [{ level: 'error', message: `Error in ${id}` }] : [],
        network_requests: []
      },
      state: { url: 'https://brainstormy.app' },
      timestamp: new Date().toISOString()
    };
  }

  function createMockOrchestratorResult(agentResults) {
    return {
      runId: 'run-123-abcd', appId: 'brainstormy',
      agentResults,
      summary: {
        totalAgents: agentResults.length, passedAgents: 0,
        failedAgents: agentResults.length, errorAgents: 0,
        totalScenarios: agentResults.reduce((s, a) => s + a.scenarios.length, 0),
        passedScenarios: 0,
        failedScenarios: agentResults.reduce((s, a) => s + a.scenarios.filter(sc => sc.status === 'failed').length, 0),
        errorScenarios: agentResults.reduce((s, a) => s + a.scenarios.filter(sc => sc.status === 'error').length, 0),
        skippedScenarios: 0
      },
      overallStatus: 'failed', durationMs: 5000,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      trigger: 'test'
    };
  }

  test('Bug Detector wraps as failureHandler object with handle() method', async () => {
    const stack = createIntegrationStack();
    const failureHandler = createFailureHandler(stack.bugDetector, createTestApp());

    const result = createMockOrchestratorResult([{
      agentId: 'sentinel',
      scenarios: [createScenario('sc-1', 'failed'), createScenario('sc-2', 'failed')],
      summary: { total: 2, passed: 0, failed: 2, errors: 0, skipped: 0 }
    }]);

    await failureHandler.handle(result);
    expect(stack.llm.complete).toHaveBeenCalledTimes(2);
    expect(stack.bugStorage.saveBug).toHaveBeenCalledTimes(2);
  });

  test('failureHandler.handle() processes multiple agent results sequentially', async () => {
    const stack = createIntegrationStack();
    const failureHandler = createFailureHandler(stack.bugDetector, createTestApp());

    const result = createMockOrchestratorResult([
      { agentId: 'sentinel', scenarios: [createScenario('sc-1', 'failed')], summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 } },
      { agentId: 'healer', scenarios: [createScenario('sc-2', 'failed')], summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 } }
    ]);

    await failureHandler.handle(result);
    expect(stack.bugStorage.saveBug).toHaveBeenCalledTimes(2);
    const savedBugs = stack.bugStorage.saveBug.mock.calls.map(c => c[0]);
    expect(savedBugs[0].bug_id).toBe('BUG-1');
    expect(savedBugs[1].bug_id).toBe('BUG-2');
  });

  test('failureHandler.handle() skips passed scenarios', async () => {
    const stack = createIntegrationStack();
    const failureHandler = createFailureHandler(stack.bugDetector, createTestApp());

    const result = createMockOrchestratorResult([{
      agentId: 'sentinel',
      scenarios: [createScenario('sc-1', 'passed'), createScenario('sc-2', 'failed'), createScenario('sc-3', 'error')],
      summary: { total: 3, passed: 1, failed: 1, errors: 1, skipped: 0 }
    }]);

    await failureHandler.handle(result);
    expect(stack.bugStorage.saveBug).toHaveBeenCalledTimes(2);
  });

  test('failureHandler.handle() continues after one detection error', async () => {
    const stack = createIntegrationStack();
    const failureHandler = createFailureHandler(stack.bugDetector, createTestApp());

    stack.llm.complete
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce({ content: JSON.stringify(DEFAULT_ANALYSIS) });

    const result = createMockOrchestratorResult([{
      agentId: 'sentinel',
      scenarios: [createScenario('sc-1', 'failed'), createScenario('sc-2', 'failed')],
      summary: { total: 2, passed: 0, failed: 2, errors: 0, skipped: 0 }
    }]);

    await failureHandler.handle(result);
    expect(stack.bugStorage.saveBug).toHaveBeenCalledTimes(2);
    const bugs = stack.bugStorage.saveBug.mock.calls.map(c => c[0]);
    expect(bugs[0].root_cause).toBe('LLM analysis failed');
    expect(bugs[1].root_cause).toBe(DEFAULT_ANALYSIS.root_cause);
  });

  test('No-op failureHandler matches TestOrchestrator default', async () => {
    const noopHandler = { handle: async () => {} };
    const result = createMockOrchestratorResult([{
      agentId: 'sentinel',
      scenarios: [createScenario('sc-1', 'failed')],
      summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
    }]);

    await expect(noopHandler.handle(result)).resolves.toBeUndefined();
  });
});
