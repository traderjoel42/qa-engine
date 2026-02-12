'use strict';

const AutoFixer = require('../../core/engine/auto-fixer');
const { FixError } = require('../../core/engine/errors');

// ═══════════════════════════════════════════════════════════
// MOCK FACTORIES (from spec)
// ═══════════════════════════════════════════════════════════

function createMockLLM(overrides = {}) {
  return {
    complete: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        files_to_modify: [
          {
            path: 'services/search.py',
            changes: [
              {
                type: 'replace',
                line: 42,
                old_code: 'threshold = 0.7',
                new_code: 'threshold = 0.6'
              }
            ]
          }
        ],
        regression_test: {
          file: 'tests/test_search.py',
          test_code: 'def test_lower_threshold(): assert True'
        },
        explanation: 'Lowered similarity threshold from 0.7 to 0.6'
      }),
      usage: { inputTokens: 800, outputTokens: 400 },
      model: 'claude-sonnet-4-5-20250929'
    }),
    streamComplete: jest.fn(),
    ...overrides
  };
}

function createMockCodeExecutor(overrides = {}) {
  return {
    createBranch: jest.fn().mockResolvedValue({ name: 'auto-fix/BUG-1', created: true }),
    applyChanges: jest.fn().mockResolvedValue({ applied: true, filesModified: 1 }),
    rollback: jest.fn().mockResolvedValue({ rolledBack: true }),
    ...overrides
  };
}

function createMockTestRunner(overrides = {}) {
  return {
    runTest: jest.fn().mockResolvedValue({ passed: true, details: 'Test passed' }),
    runSuite: jest.fn().mockResolvedValue({ passed: true, total: 5, failures: 0 }),
    ...overrides
  };
}

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

function createTestApp(overrides = {}) {
  return {
    id: 'brainstormy',
    name: 'Brainstormy',
    ...overrides
  };
}

function createValidFix(overrides = {}) {
  return {
    files_to_modify: [
      {
        path: 'services/search.py',
        changes: [
          {
            type: 'replace',
            line: 42,
            old_code: 'threshold = 0.7',
            new_code: 'threshold = 0.6'
          }
        ]
      }
    ],
    regression_test: {
      file: 'tests/test_search.py',
      test_code: 'def test_lower_threshold(): assert True'
    },
    explanation: 'Lowered similarity threshold from 0.7 to 0.6',
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

describe('AutoFixer', () => {

  // ─────────────────────────────────────────────────────────
  // Group 1: Constructor Validation (~5 tests)
  // ─────────────────────────────────────────────────────────
  describe('Constructor Validation', () => {
    test('requires options.llm — throws FixError if missing', () => {
      expect(() => new AutoFixer()).toThrow(FixError);
      expect(() => new AutoFixer()).toThrow('AutoFixer requires options.llm adapter');
    });

    test('accepts optional codeExecutor, testRunner, storage, bugTracker, notifier', () => {
      const fixer = new AutoFixer({
        llm: createMockLLM(),
        codeExecutor: createMockCodeExecutor(),
        testRunner: createMockTestRunner(),
        storage: createMockFixStorage(),
        bugTracker: {},
        notifier: {}
      });
      expect(fixer).toBeInstanceOf(AutoFixer);
    });

    test('default codeExecutor is no-op (returns success)', async () => {
      const fixer = new AutoFixer({ llm: createMockLLM() });
      const result = await fixer._codeExecutor.applyChanges([]);
      expect(result.applied).toBe(true);
    });

    test('default testRunner is no-op (returns passed)', async () => {
      const fixer = new AutoFixer({ llm: createMockLLM() });
      const result = await fixer._testRunner.runTest('test-1');
      expect(result.passed).toBe(true);
    });

    test('default storage is no-op', async () => {
      const fixer = new AutoFixer({ llm: createMockLLM() });
      const result = await fixer._storage.saveFix({ id: 'fix-1' });
      expect(result).toEqual({ id: 'fix-1' });
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 2: reviewFix() Safety Checks (~25 tests)
  // ─────────────────────────────────────────────────────────
  describe('reviewFix() Safety Checks', () => {
    let fixer;
    let bug;

    beforeEach(() => {
      fixer = new AutoFixer({ llm: createMockLLM() });
      bug = createTestBug();
    });

    test('returns { safe: true } for valid fix within allowed paths', () => {
      const fix = createValidFix();
      const result = fixer.reviewFix(bug, fix);
      expect(result).toEqual({ safe: true, reason: null });
    });

    test('rejects null fix', () => {
      const result = fixer.reviewFix(bug, null);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('no files_to_modify');
    });

    test('rejects fix without files_to_modify', () => {
      const result = fixer.reviewFix(bug, { explanation: 'no files' });
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('no files_to_modify');
    });

    test('rejects fix with non-array files_to_modify', () => {
      const result = fixer.reviewFix(bug, { files_to_modify: 'not-an-array' });
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('no files_to_modify');
    });

    test('rejects file outside allowed paths for memory category', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: '/etc/passwd', changes: [{ new_code: 'hack' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('unexpected file');
    });

    test('allows file in services/ for memory category', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/memory.py', changes: [{ new_code: 'ok' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(true);
    });

    test('allows file in config/ for memory category', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'config/thresholds.json', changes: [{ new_code: '0.6' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(true);
    });

    // Test each dangerous pattern individually
    test('rm -rf → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/clean.py', changes: [{ new_code: 'os.system("rm -rf /")' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Dangerous pattern');
    });

    test('DROP TABLE → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/db.py', changes: [{ new_code: 'DROP TABLE users' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('DELETE FROM users → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/db.py', changes: [{ new_code: 'DELETE FROM users WHERE 1=1' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('TRUNCATE TABLE → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/db.py', changes: [{ new_code: 'TRUNCATE TABLE sessions' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('system( → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/cmd.py', changes: [{ new_code: 'system("ls")' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('exec( → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/run.py', changes: [{ new_code: 'exec("code")' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('eval( → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/run.js', changes: [{ new_code: 'eval("code")' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('Function( → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/run.js', changes: [{ new_code: 'new Function("return 1")' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('child_process → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/run.js', changes: [{ new_code: "require('child_process')" }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('.env → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/config.js', changes: [{ new_code: "fs.readFile('.env')" }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('process.env.SECRET → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/config.js', changes: [{ new_code: 'const key = process.env.SECRET' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('secret|password|token|api_key → unsafe', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/auth.js', changes: [{ new_code: 'const password = "abc123"' }] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
    });

    test('rejects fix with > 10 total changes', () => {
      const changes = [];
      for (let i = 0; i < 11; i++) {
        changes.push({ type: 'replace', line: i, old_code: 'old', new_code: 'new' });
      }
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/big.py', changes }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Too many changes');
      expect(result.reason).toContain('11');
      expect(result.reason).toContain('max 10');
    });

    test('allows fix with exactly 10 changes', () => {
      const changes = [];
      for (let i = 0; i < 10; i++) {
        changes.push({ type: 'replace', line: i, old_code: 'old', new_code: 'new' });
      }
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/big.py', changes }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(true);
    });

    test('rejects fix with 0 changes', () => {
      const fix = createValidFix({
        files_to_modify: [{ path: 'services/empty.py', changes: [] }]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('no changes');
    });

    test('multiple files: checks all files for path + pattern violations', () => {
      const fix = createValidFix({
        files_to_modify: [
          { path: 'services/safe.py', changes: [{ new_code: 'ok' }] },
          { path: '/etc/passwd', changes: [{ new_code: 'hack' }] }
        ]
      });
      const result = fixer.reviewFix(bug, fix);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('/etc/passwd');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 3: generateFix() (~8 tests)
  // ─────────────────────────────────────────────────────────
  describe('generateFix()', () => {
    let fixer;
    let llm;
    let app;
    let bug;
    let context;

    beforeEach(() => {
      llm = createMockLLM();
      fixer = new AutoFixer({ llm });
      app = createTestApp();
      bug = createTestBug();
      context = {
        relevant_code: '// code here',
        file_path: 'services/search.py',
        surrounding_files: [],
        language: 'python'
      };
    });

    test('calls llm.complete with correct prompt', async () => {
      await fixer.generateFix(app, bug, context);
      expect(llm.complete).toHaveBeenCalledTimes(1);
      const [prompt] = llm.complete.mock.calls[0];
      expect(prompt).toContain('Brainstormy');
      expect(prompt).toContain(bug.bug_id);
      expect(prompt).toContain(bug.root_cause);
    });

    test('passes correct model, maxTokens, temperature', async () => {
      await fixer.generateFix(app, bug, context);
      const [, options] = llm.complete.mock.calls[0];
      expect(options.model).toBe('claude-sonnet-4-5-20250929');
      expect(options.maxTokens).toBe(2048);
      expect(options.temperature).toBe(0.1);
    });

    test('parses valid JSON response', async () => {
      const fix = await fixer.generateFix(app, bug, context);
      expect(fix.files_to_modify).toBeInstanceOf(Array);
      expect(fix.files_to_modify[0].path).toBe('services/search.py');
    });

    test('strips markdown code fences', async () => {
      llm.complete.mockResolvedValue({
        content: '```json\n{"files_to_modify": [{"path": "services/x.py", "changes": [{"new_code": "ok"}]}], "explanation": "test"}\n```'
      });
      const fix = await fixer.generateFix(app, bug, context);
      expect(fix.files_to_modify[0].path).toBe('services/x.py');
    });

    test('throws FixError on invalid JSON', async () => {
      llm.complete.mockResolvedValue({ content: 'not json at all' });
      await expect(fixer.generateFix(app, bug, context)).rejects.toThrow(FixError);
      await expect(fixer.generateFix(app, bug, context)).rejects.toThrow('Failed to parse fix response');
    });

    test('returns files_to_modify array with correct structure', async () => {
      const fix = await fixer.generateFix(app, bug, context);
      expect(fix.files_to_modify).toHaveLength(1);
      expect(fix.files_to_modify[0]).toHaveProperty('path');
      expect(fix.files_to_modify[0]).toHaveProperty('changes');
      expect(fix.files_to_modify[0].changes[0]).toHaveProperty('type');
      expect(fix.files_to_modify[0].changes[0]).toHaveProperty('line');
      expect(fix.files_to_modify[0].changes[0]).toHaveProperty('old_code');
      expect(fix.files_to_modify[0].changes[0]).toHaveProperty('new_code');
    });

    test('returns regression_test when present', async () => {
      const fix = await fixer.generateFix(app, bug, context);
      expect(fix.regression_test).toBeTruthy();
      expect(fix.regression_test.file).toBe('tests/test_search.py');
    });

    test('returns explanation', async () => {
      const fix = await fixer.generateFix(app, bug, context);
      expect(fix.explanation).toContain('threshold');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 4: loadBugContext() (~4 tests)
  // ─────────────────────────────────────────────────────────
  describe('loadBugContext()', () => {
    let fixer;

    beforeEach(() => {
      fixer = new AutoFixer({ llm: createMockLLM() });
    });

    test('extracts file path from services/search.py:retrieve_context()', async () => {
      const bug = createTestBug({ likely_location: 'services/search.py:retrieve_context()' });
      const context = await fixer.loadBugContext(bug);
      expect(context.file_path).toBe('services/search.py');
    });

    test('returns stub code context (Phase 1)', async () => {
      const bug = createTestBug();
      const context = await fixer.loadBugContext(bug);
      expect(context.relevant_code).toContain('would be loaded here in production');
    });

    test('detects language from file extension', async () => {
      const pyBug = createTestBug({ likely_location: 'services/search.py' });
      const jsBug = createTestBug({ likely_location: 'services/search.js' });
      const tsBug = createTestBug({ likely_location: 'services/search.ts' });

      expect((await fixer.loadBugContext(pyBug)).language).toBe('python');
      expect((await fixer.loadBugContext(jsBug)).language).toBe('javascript');
      expect((await fixer.loadBugContext(tsBug)).language).toBe('typescript');
    });

    test('handles unknown location', async () => {
      const bug = createTestBug({ likely_location: 'unknown' });
      const context = await fixer.loadBugContext(bug);
      expect(context.file_path).toBe('unknown');
      expect(context.language).toBe('unknown');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 5: getAllowedPathsForBug() (~6 tests)
  // ─────────────────────────────────────────────────────────
  describe('getAllowedPathsForBug()', () => {
    let fixer;

    beforeEach(() => {
      fixer = new AutoFixer({ llm: createMockLLM() });
    });

    test('returns memory-specific paths for memory category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'memory' });
      expect(paths).toContain('services/');
      expect(paths).toContain('src/memory/');
      expect(paths).toContain('src/search/');
      expect(paths).toContain('config/');
    });

    test('returns data-accuracy paths for data-accuracy category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'data-accuracy' });
      expect(paths).toContain('services/');
      expect(paths).toContain('src/citations/');
      expect(paths).toContain('src/bible/');
    });

    test('returns ui paths for ui category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'ui' });
      expect(paths).toContain('frontend/');
      expect(paths).toContain('src/components/');
      expect(paths).toContain('src/pages/');
      expect(paths).toContain('public/');
    });

    test('returns backend paths for backend category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'backend' });
      expect(paths).toContain('backend/');
      expect(paths).toContain('services/');
      expect(paths).toContain('src/');
      expect(paths).toContain('lib/');
    });

    test('returns performance paths for performance category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'performance' });
      expect(paths).toContain('services/');
      expect(paths).toContain('src/');
      expect(paths).toContain('config/');
    });

    test('returns base paths for unknown category', () => {
      const paths = fixer.getAllowedPathsForBug({ category: 'something-else' });
      expect(paths).toContain('src/');
      expect(paths).toContain('lib/');
      expect(paths).toContain('services/');
      expect(paths).toContain('config/');
      expect(paths).toContain('backend/');
      expect(paths).toContain('frontend/');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 6: applyFix() (~5 tests)
  // ─────────────────────────────────────────────────────────
  describe('applyFix()', () => {
    let fixer;
    let codeExecutor;
    let app;

    beforeEach(() => {
      codeExecutor = createMockCodeExecutor();
      fixer = new AutoFixer({ llm: createMockLLM(), codeExecutor });
      app = createTestApp();
    });

    test('calls codeExecutor.applyChanges with flattened changes', async () => {
      const fix = createValidFix();
      await fixer.applyFix(app, fix);
      expect(codeExecutor.applyChanges).toHaveBeenCalledTimes(1);
      const changes = codeExecutor.applyChanges.mock.calls[0][0];
      // 1 code change + 1 regression test = 2
      expect(changes).toHaveLength(2);
      expect(changes[0].file).toBe('services/search.py');
      expect(changes[0].type).toBe('replace');
    });

    test('includes regression test as insert change', async () => {
      const fix = createValidFix();
      await fixer.applyFix(app, fix);
      const changes = codeExecutor.applyChanges.mock.calls[0][0];
      const testChange = changes[changes.length - 1];
      expect(testChange.type).toBe('insert');
      expect(testChange.file).toBe('tests/test_search.py');
    });

    test('handles fix with no regression test', async () => {
      const fix = createValidFix({ regression_test: null });
      await fixer.applyFix(app, fix);
      const changes = codeExecutor.applyChanges.mock.calls[0][0];
      expect(changes).toHaveLength(1);
    });

    test('handles fix with multiple files', async () => {
      const fix = createValidFix({
        files_to_modify: [
          { path: 'services/a.py', changes: [{ type: 'replace', new_code: 'a' }] },
          { path: 'services/b.py', changes: [{ type: 'replace', new_code: 'b' }] }
        ],
        regression_test: null
      });
      await fixer.applyFix(app, fix);
      const changes = codeExecutor.applyChanges.mock.calls[0][0];
      expect(changes).toHaveLength(2);
      expect(changes[0].file).toBe('services/a.py');
      expect(changes[1].file).toBe('services/b.py');
    });

    test('propagates codeExecutor errors', async () => {
      codeExecutor.applyChanges.mockRejectedValue(new Error('Disk full'));
      const fix = createValidFix();
      await expect(fixer.applyFix(app, fix)).rejects.toThrow('Disk full');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 7: verifyFix() (~5 tests)
  // ─────────────────────────────────────────────────────────
  describe('verifyFix()', () => {
    let fixer;
    let testRunner;
    let app;
    let bug;

    beforeEach(() => {
      testRunner = createMockTestRunner();
      fixer = new AutoFixer({ llm: createMockLLM(), testRunner });
      app = createTestApp();
      bug = createTestBug();
    });

    test('calls testRunner.runTest with test_id from evidence', async () => {
      await fixer.verifyFix(app, bug);
      expect(testRunner.runTest).toHaveBeenCalledWith('sentinel-memory-001');
    });

    test('calls testRunner.runSuite with healer-regression', async () => {
      await fixer.verifyFix(app, bug);
      expect(testRunner.runSuite).toHaveBeenCalledWith('healer-regression');
    });

    test('returns passed=true when both pass', async () => {
      const result = await fixer.verifyFix(app, bug);
      expect(result.passed).toBe(true);
      expect(result.originalTest.passed).toBe(true);
      expect(result.regressionTests.passed).toBe(true);
    });

    test('returns passed=false when original test fails', async () => {
      testRunner.runTest.mockResolvedValue({ passed: false, details: 'Still failing' });
      const result = await fixer.verifyFix(app, bug);
      expect(result.passed).toBe(false);
    });

    test('returns passed=false when regression suite fails', async () => {
      testRunner.runSuite.mockResolvedValue({ passed: false, total: 5, failures: 2 });
      const result = await fixer.verifyFix(app, bug);
      expect(result.passed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 8: rollbackFix() (~3 tests)
  // ─────────────────────────────────────────────────────────
  describe('rollbackFix()', () => {
    let fixer;
    let codeExecutor;
    let app;

    beforeEach(() => {
      codeExecutor = createMockCodeExecutor();
      fixer = new AutoFixer({ llm: createMockLLM(), codeExecutor });
      app = createTestApp();
    });

    test('calls codeExecutor.rollback', async () => {
      await fixer.rollbackFix(app, createValidFix());
      expect(codeExecutor.rollback).toHaveBeenCalledTimes(1);
    });

    test('throws FixError on rollback failure', async () => {
      codeExecutor.rollback.mockRejectedValue(new Error('Branch locked'));
      await expect(fixer.rollbackFix(app, createValidFix())).rejects.toThrow(FixError);
      await expect(fixer.rollbackFix(app, createValidFix())).rejects.toThrow('Rollback failed');
    });

    test('handles empty fix object', async () => {
      await fixer.rollbackFix(app, {});
      expect(codeExecutor.rollback).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 9: generateAndApplyFix() Full Pipeline (~20 tests)
  // ─────────────────────────────────────────────────────────
  describe('generateAndApplyFix() Full Pipeline', () => {
    let fixer;
    let llm;
    let codeExecutor;
    let testRunner;
    let storage;
    let app;
    let bug;
    let approval;

    beforeEach(() => {
      llm = createMockLLM();
      codeExecutor = createMockCodeExecutor();
      testRunner = createMockTestRunner();
      storage = createMockFixStorage();
      fixer = new AutoFixer({ llm, codeExecutor, testRunner, storage });
      app = createTestApp();
      bug = createTestBug();
      approval = createTestApproval();
    });

    test('happy path: approved → generate → safe → apply → verify passes → returns verified', async () => {
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('verified');
      expect(result.fix).toBeTruthy();
      expect(result.safetyCheck.safe).toBe(true);
      expect(result.verification.passed).toBe(true);
      expect(result.bugId).toBe('BUG-1');
    });

    test('throws FixError on unapproved status', async () => {
      const pendingApproval = createTestApproval({ status: 'pending' });
      await expect(fixer.generateAndApplyFix(app, bug, pendingApproval)).rejects.toThrow(FixError);
      await expect(fixer.generateAndApplyFix(app, bug, pendingApproval)).rejects.toThrow('Fix not approved');
    });

    test('throws on missing app', async () => {
      await expect(fixer.generateAndApplyFix(null, bug, approval)).rejects.toThrow(FixError);
    });

    test('throws on missing bug', async () => {
      await expect(fixer.generateAndApplyFix(app, null, approval)).rejects.toThrow(FixError);
    });

    test('throws on missing approval', async () => {
      await expect(fixer.generateAndApplyFix(app, bug, null)).rejects.toThrow(FixError);
    });

    test('generation failure: returns status=failed with error', async () => {
      llm.complete.mockRejectedValue(new Error('LLM unavailable'));
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('failed');
      expect(result.explanation).toContain('Fix generation failed');
    });

    test('safety failure: returns status=safety-rejected, does NOT apply', async () => {
      llm.complete.mockResolvedValue({
        content: JSON.stringify({
          files_to_modify: [{ path: '/etc/passwd', changes: [{ new_code: 'hack' }] }],
          explanation: 'bad fix'
        })
      });
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('safety-rejected');
      expect(codeExecutor.applyChanges).not.toHaveBeenCalled();
    });

    test('apply failure: returns status=apply-error, triggers rollback', async () => {
      codeExecutor.applyChanges.mockRejectedValue(new Error('Write failed'));
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('apply-error');
      expect(codeExecutor.rollback).toHaveBeenCalled();
    });

    test('verify failure (test still fails): returns status=rolled-back, triggers rollback', async () => {
      testRunner.runTest.mockResolvedValue({ passed: false, details: 'Still failing' });
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('rolled-back');
      expect(codeExecutor.rollback).toHaveBeenCalled();
      expect(result.explanation).toContain('rolled back');
    });

    test('verify exception: returns status=verify-failed, triggers rollback', async () => {
      testRunner.runTest.mockRejectedValue(new Error('Test runner crashed'));
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.status).toBe('verify-failed');
      expect(codeExecutor.rollback).toHaveBeenCalled();
    });

    test('saves fix record at start (in-progress)', async () => {
      await fixer.generateAndApplyFix(app, bug, approval);
      expect(storage.saveFix).toHaveBeenCalledTimes(1);
      const saved = storage.saveFix.mock.calls[0][0];
      expect(saved.status).toBe('in-progress');
      expect(saved.bug_id).toBe('BUG-1');
    });

    test('updates fix record on success (verified)', async () => {
      await fixer.generateAndApplyFix(app, bug, approval);
      const updateCalls = storage.updateFix.mock.calls;
      const verifiedCall = updateCalls.find(c => c[1].status === 'verified');
      expect(verifiedCall).toBeTruthy();
    });

    test('updates fix record on failure', async () => {
      llm.complete.mockRejectedValue(new Error('LLM down'));
      await fixer.generateAndApplyFix(app, bug, approval);
      const updateCalls = storage.updateFix.mock.calls;
      const failedCall = updateCalls.find(c => c[1].status === 'failed');
      expect(failedCall).toBeTruthy();
    });

    test('unexpected error: rolls back and throws FixError', async () => {
      // Force an unexpected error by making loadBugContext throw
      fixer.loadBugContext = jest.fn().mockRejectedValue(new Error('Unexpected'));
      await expect(fixer.generateAndApplyFix(app, bug, approval)).rejects.toThrow(FixError);
      await expect(
        fixer.generateAndApplyFix(app, bug, approval)
      ).rejects.toThrow('Auto-fix failed unexpectedly');
    });

    test('full FixResult shape validation (all fields present)', async () => {
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('fix');
      expect(result).toHaveProperty('safetyCheck');
      expect(result).toHaveProperty('verification');
      expect(result).toHaveProperty('bugId');
      expect(result).toHaveProperty('startedAt');
      expect(result).toHaveProperty('completedAt');
      expect(result).toHaveProperty('explanation');
    });

    test('creates branch with auto-fix/BUG-ID naming', async () => {
      await fixer.generateAndApplyFix(app, bug, approval);
      expect(codeExecutor.createBranch).toHaveBeenCalledWith('auto-fix/BUG-1');
    });

    test('safety-rejected status includes fix and safetyCheck', async () => {
      llm.complete.mockResolvedValue({
        content: JSON.stringify({
          files_to_modify: [{ path: '/etc/passwd', changes: [{ new_code: 'hack' }] }],
          explanation: 'bad fix'
        })
      });
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.fix).toBeTruthy();
      expect(result.safetyCheck.safe).toBe(false);
      expect(result.verification).toBeNull();
    });

    test('apply-error includes explanation with error message', async () => {
      codeExecutor.applyChanges.mockRejectedValue(new Error('Permission denied'));
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.explanation).toContain('Permission denied');
    });

    test('rolled-back status includes verification result', async () => {
      testRunner.runTest.mockResolvedValue({ passed: false, details: 'Still broken' });
      const result = await fixer.generateAndApplyFix(app, bug, approval);
      expect(result.verification).toBeTruthy();
      expect(result.verification.passed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 10: _parseFixResponse() (~6 tests)
  // ─────────────────────────────────────────────────────────
  describe('_parseFixResponse()', () => {
    let fixer;

    beforeEach(() => {
      fixer = new AutoFixer({ llm: createMockLLM() });
    });

    test('valid JSON string', () => {
      const json = JSON.stringify({
        files_to_modify: [{ path: 'a.py', changes: [{ type: 'replace', line: 1, old_code: 'x', new_code: 'y' }] }],
        explanation: 'test'
      });
      const result = fixer._parseFixResponse(json);
      expect(result.files_to_modify).toHaveLength(1);
    });

    test('JSON wrapped in code fences', () => {
      const json = '```json\n{"files_to_modify": [{"path": "a.py", "changes": [{"new_code": "y"}]}], "explanation": "test"}\n```';
      const result = fixer._parseFixResponse(json);
      expect(result.files_to_modify[0].path).toBe('a.py');
    });

    test('missing files_to_modify → throws FixError', () => {
      const json = JSON.stringify({ explanation: 'no files' });
      expect(() => fixer._parseFixResponse(json)).toThrow(FixError);
    });

    test('non-array files_to_modify → throws FixError', () => {
      const json = JSON.stringify({ files_to_modify: 'not-array', explanation: 'bad' });
      expect(() => fixer._parseFixResponse(json)).toThrow(FixError);
    });

    test('missing change fields → defaults applied', () => {
      const json = JSON.stringify({
        files_to_modify: [{ path: 'a.py', changes: [{}] }],
        explanation: 'test'
      });
      const result = fixer._parseFixResponse(json);
      const change = result.files_to_modify[0].changes[0];
      expect(change.type).toBe('replace');
      expect(change.line).toBe(0);
      expect(change.old_code).toBe('');
      expect(change.new_code).toBe('');
    });

    test('missing explanation → defaults to "No explanation provided"', () => {
      const json = JSON.stringify({
        files_to_modify: [{ path: 'a.py', changes: [{ new_code: 'y' }] }]
      });
      const result = fixer._parseFixResponse(json);
      expect(result.explanation).toBe('No explanation provided');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 11: _isPathAllowed() (~4 tests)
  // ─────────────────────────────────────────────────────────
  describe('_isPathAllowed()', () => {
    let fixer;

    beforeEach(() => {
      fixer = new AutoFixer({ llm: createMockLLM() });
    });

    test('returns true for path starting with allowed prefix', () => {
      expect(fixer._isPathAllowed('services/search.py', ['services/', 'src/'])).toBe(true);
    });

    test('returns false for path outside all prefixes', () => {
      expect(fixer._isPathAllowed('/etc/passwd', ['services/', 'src/'])).toBe(false);
    });

    test('returns false for null path', () => {
      expect(fixer._isPathAllowed(null, ['services/'])).toBe(false);
    });

    test('handles trailing slash in allowed paths', () => {
      expect(fixer._isPathAllowed('services/search.py', ['services/'])).toBe(true);
    });
  });
});
