'use strict';

const BugDetector = require('../../core/engine/bug-detector');
const { BugDetectorError } = require('../../core/engine/errors');

// ═══════════════════════════════════════════════════════════
// MOCK FACTORIES (from spec)
// ═══════════════════════════════════════════════════════════

function createMockLLM(overrides = {}) {
  return {
    complete: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        root_cause: 'Test root cause',
        affected_component: 'Memory service',
        likely_location: 'services/search.py:retrieve_context()',
        fix_approach: 'Adjust threshold from 0.7 to 0.6',
        confidence: 0.85,
        impact_assessment: 'High impact - memory recall broken'
      }),
      usage: { inputTokens: 500, outputTokens: 200 },
      model: 'claude-sonnet-4-5-20250929'
    }),
    streamComplete: jest.fn(),
    ...overrides
  };
}

function createMockBugTracker(overrides = {}) {
  return {
    createIssue: jest.fn().mockResolvedValue({
      id: 'linear-issue-123',
      key: 'ENG-247',
      url: 'https://linear.app/team/ENG-247'
    }),
    updateIssue: jest.fn().mockResolvedValue({ id: 'linear-issue-123', url: '...' }),
    addComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
    getIssue: jest.fn().mockResolvedValue({ id: 'linear-issue-123', title: 'Bug' }),
    ...overrides
  };
}

function createMockStorage(overrides = {}) {
  const bugs = new Map();
  return {
    saveBug: jest.fn().mockImplementation(async (bug) => { bugs.set(bug.id, bug); return bug; }),
    updateBug: jest.fn().mockImplementation(async (id, updates) => {
      const bug = bugs.get(id);
      if (bug) Object.assign(bug, updates);
      return bug;
    }),
    getNextBugNumber: jest.fn().mockResolvedValue(1),
    _bugs: bugs,
    ...overrides
  };
}

function createMockApprovalManager(overrides = {}) {
  return {
    requestApproval: jest.fn().mockResolvedValue({ approval_id: 'ABC-1', status: 'pending' }),
    handleResponse: jest.fn().mockResolvedValue({ message: 'Done' }),
    ...overrides
  };
}

function createTestFailure(overrides = {}) {
  return {
    test_id: 'sentinel-memory-001',
    test_name: 'Multi-session memory recall',
    scenario: 'establish-recall-3-facts',
    step: 'recall_check',
    error: new Error('Expected Marcus, got undefined'),
    evidence: {
      screenshots: ['evidence/screenshots/sentinel-001-step3.png'],
      console_logs: [
        { level: 'error', message: 'Memory retrieval returned empty', timestamp: '2026-02-12T10:00:00Z' }
      ],
      network_requests: [
        { url: '/api/search', method: 'POST', status: 200, failed: false },
        { url: '/api/generate', method: 'POST', status: 500, failed: true }
      ]
    },
    state: { url: 'https://brainstormy.app/story/abc/session/xyz' },
    timestamp: '2026-02-12T10:00:05Z',
    startedAt: '2026-02-12T09:59:00Z',
    ...overrides
  };
}

function createTestApp(overrides = {}) {
  return {
    id: 'brainstormy',
    name: 'Brainstormy',
    url: 'https://brainstormy.app',
    integrations: {
      bug_tracker: { type: 'linear', team_id: 'team-123' },
      notifications: { type: 'whatsapp', recipients: ['+1234567890'] }
    },
    ...overrides
  };
}

function createDetector(overrides = {}) {
  return new BugDetector({
    llm: createMockLLM(),
    ...overrides
  });
}

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

describe('BugDetector', () => {

  // ── Group 1: Constructor Validation ──

  describe('Constructor', () => {
    it('requires options.llm — throws BugDetectorError if missing', () => {
      expect(() => new BugDetector({})).toThrow(BugDetectorError);
    });

    it('throws BugDetectorError with phase construction', () => {
      try {
        new BugDetector({});
      } catch (err) {
        expect(err.phase).toBe('construction');
      }
    });

    it('accepts llm + optional bugTracker, notifier, storage, approvalManager', () => {
      const detector = new BugDetector({
        llm: createMockLLM(),
        bugTracker: createMockBugTracker(),
        notifier: { send: jest.fn() },
        storage: createMockStorage(),
        approvalManager: createMockApprovalManager()
      });
      expect(detector).toBeInstanceOf(BugDetector);
    });

    it('default storage provides no-op methods', async () => {
      const detector = createDetector();
      // Default storage should not throw
      const result = await detector._storage.saveBug({ id: 'test' });
      expect(result).toBeDefined();
    });

    it('sets initial bug counter to 1', () => {
      const detector = createDetector();
      expect(detector._bugCounter).toBe(1);
    });

    it('stores null for optional dependencies when not provided', () => {
      const detector = createDetector();
      expect(detector._bugTracker).toBeNull();
      expect(detector._notifier).toBeNull();
      expect(detector._approvalManager).toBeNull();
    });

    it('accepts llm only (minimal valid config)', () => {
      const detector = new BugDetector({ llm: createMockLLM() });
      expect(detector).toBeInstanceOf(BugDetector);
    });

    it('throws with no arguments', () => {
      expect(() => new BugDetector()).toThrow(BugDetectorError);
    });
  });

  // ── Group 2: gatherEvidence() ──

  describe('gatherEvidence()', () => {
    let detector;

    beforeEach(() => {
      detector = createDetector();
    });

    it('extracts error from Error instance (message + stack)', () => {
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.error_message).toBe('Expected Marcus, got undefined');
      expect(evidence.error_stack).toBeTruthy();
    });

    it('extracts error from string', () => {
      const failure = createTestFailure({ error: 'string error message' });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.error_message).toBe('string error message');
      expect(evidence.error_stack).toBeNull();
    });

    it('extracts error from plain object', () => {
      const failure = createTestFailure({ error: { message: 'obj error', stack: 'at line 1' } });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.error_message).toBe('obj error');
      expect(evidence.error_stack).toBe('at line 1');
    });

    it('extracts error from object without message — uses JSON.stringify', () => {
      const failure = createTestFailure({ error: { code: 42 } });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.error_message).toBe('{"code":42}');
    });

    it('handles missing error gracefully', () => {
      const failure = createTestFailure({ error: undefined });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.error_message).toBeNull();
      expect(evidence.error_stack).toBeNull();
    });

    it('extracts screenshots from failure.evidence.screenshots', () => {
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.screenshots).toEqual(['evidence/screenshots/sentinel-001-step3.png']);
    });

    it('extracts console_logs with snake_case key', () => {
      const failure = createTestFailure({
        evidence: { console_logs: [{ level: 'warn', message: 'warn msg' }] }
      });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.console_logs).toEqual([{ level: 'warn', message: 'warn msg' }]);
    });

    it('extracts console_logs with camelCase key (consoleLogs)', () => {
      const failure = createTestFailure({
        evidence: { consoleLogs: [{ level: 'error', message: 'err' }] }
      });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.console_logs).toEqual([{ level: 'error', message: 'err' }]);
    });

    it('extracts network_requests with snake_case key', () => {
      const failure = createTestFailure({
        evidence: { network_requests: [{ url: '/api', failed: true }] }
      });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.network_requests).toEqual([{ url: '/api', failed: true }]);
    });

    it('extracts network_requests with camelCase key (networkRequests)', () => {
      const failure = createTestFailure({
        evidence: { networkRequests: [{ url: '/api', failed: false }] }
      });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.network_requests).toEqual([{ url: '/api', failed: false }]);
    });

    it('handles missing evidence object', () => {
      const failure = createTestFailure({ evidence: undefined });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.screenshots).toEqual([]);
      expect(evidence.console_logs).toEqual([]);
      expect(evidence.network_requests).toEqual([]);
    });

    it('extracts URL from failure.state.url', () => {
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.url).toBe('https://brainstormy.app/story/abc/session/xyz');
    });

    it('sets occurred_at from failure.timestamp', () => {
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.occurred_at).toBe('2026-02-12T10:00:05Z');
    });

    it('defaults occurred_at to now when no timestamp', () => {
      const failure = createTestFailure({ timestamp: undefined });
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.occurred_at).toBeTruthy();
      // Should be a recent ISO string
      expect(new Date(evidence.occurred_at).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('sets test_name from fallback chain: test_name > scenarioName > name', () => {
      expect(detector.gatherEvidence({ test_name: 'a' }).test_name).toBe('a');
      expect(detector.gatherEvidence({ scenarioName: 'b' }).test_name).toBe('b');
      expect(detector.gatherEvidence({ name: 'c' }).test_name).toBe('c');
    });

    it('defaults test_name to "unknown" when all fallbacks missing', () => {
      const evidence = detector.gatherEvidence({});
      expect(evidence.test_name).toBe('unknown');
    });

    it('handles completely empty failure (no crash, returns skeleton)', () => {
      const evidence = detector.gatherEvidence({});
      expect(evidence.test_id).toBeNull();
      expect(evidence.test_name).toBe('unknown');
      expect(evidence.scenario).toBeNull();
      expect(evidence.step_failed).toBeNull();
      expect(evidence.error_message).toBeNull();
      expect(evidence.screenshots).toEqual([]);
      expect(evidence.url).toBeNull();
    });

    it('extracts test_started_at from failure.startedAt', () => {
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);
      expect(evidence.test_started_at).toBe('2026-02-12T09:59:00Z');
    });
  });

  // ── Group 3: analyzeBug() ──

  describe('analyzeBug()', () => {
    it('calls llm.complete with correct prompt structure', async () => {
      const llm = createMockLLM();
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);

      expect(llm.complete).toHaveBeenCalledTimes(1);
      const [prompt] = llm.complete.mock.calls[0];
      expect(prompt).toContain('Brainstormy');
      expect(prompt).toContain('sentinel');
      expect(prompt).toContain('Multi-session memory recall');
    });

    it('passes correct model, maxTokens, temperature options', async () => {
      const llm = createMockLLM();
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);

      const [, options] = llm.complete.mock.calls[0];
      expect(options.model).toBe('claude-sonnet-4-5-20250929');
      expect(options.maxTokens).toBe(1024);
      expect(options.temperature).toBe(0.2);
      expect(options.systemPrompt).toBeTruthy();
    });

    it('parses valid JSON response', async () => {
      const detector = createDetector();
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      const result = await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);
      expect(result.root_cause).toBe('Test root cause');
      expect(result.confidence).toBe(0.85);
    });

    it('strips markdown code fences from response', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: '```json\n{"root_cause":"fenced","affected_component":"test","likely_location":"x","fix_approach":"y","confidence":0.5,"impact_assessment":"z"}\n```',
          usage: {}, model: 'test'
        })
      });
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      const result = await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);
      expect(result.root_cause).toBe('fenced');
    });

    it('handles missing fields in JSON (fills defaults)', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: '{}',
          usage: {}, model: 'test'
        })
      });
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      const result = await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);
      expect(result.root_cause).toBe('Unable to determine');
      expect(result.affected_component).toBe('unknown');
      expect(result.confidence).toBe(0.5); // default
    });

    it('clamps confidence to 0-1 range', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: '{"confidence": 5.0}',
          usage: {}, model: 'test'
        })
      });
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      const result = await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);
      expect(result.confidence).toBe(1.0);
    });

    it('returns degraded analysis on JSON parse failure', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: 'not valid json at all',
          usage: {}, model: 'test'
        })
      });
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      const result = await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);
      expect(result.root_cause).toBe('LLM analysis returned unparseable response');
      expect(result.confidence).toBe(0);
    });

    it('throws on LLM adapter error (propagates up to detectAndReport)', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockRejectedValue(new Error('LLM down'))
      });
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      await expect(detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence))
        .rejects.toThrow('LLM down');
    });

    it('includes console errors and network failures in prompt', async () => {
      const llm = createMockLLM();
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);

      const [prompt] = llm.complete.mock.calls[0];
      expect(prompt).toContain('Memory retrieval returned empty');
      expect(prompt).toContain('/api/generate');
    });

    it('includes error stack in prompt when present', async () => {
      const llm = createMockLLM();
      const detector = createDetector({ llm });
      const failure = createTestFailure();
      const evidence = detector.gatherEvidence(failure);

      await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);

      const [prompt] = llm.complete.mock.calls[0];
      expect(prompt).toContain('STACK TRACE');
    });

    it('handles evidence with no console errors or network failures', async () => {
      const llm = createMockLLM();
      const detector = createDetector({ llm });
      const failure = createTestFailure({ evidence: {} });
      const evidence = detector.gatherEvidence(failure);

      await detector.analyzeBug(createTestApp(), 'sentinel', failure, evidence);

      const [prompt] = llm.complete.mock.calls[0];
      expect(prompt).toContain('None');
    });
  });

  // ── Group 4: classifyBug() ──

  describe('classifyBug()', () => {
    let detector;

    beforeEach(() => {
      detector = createDetector();
    });

    // Category detection
    it('category: memory for memory/recall/search components', () => {
      expect(detector.classifyBug({ affected_component: 'Memory service', confidence: 0.5, impact_assessment: '' }).category).toBe('memory');
      expect(detector.classifyBug({ affected_component: 'Recall engine', confidence: 0.5, impact_assessment: '' }).category).toBe('memory');
      expect(detector.classifyBug({ affected_component: 'Search index', confidence: 0.5, impact_assessment: '' }).category).toBe('memory');
    });

    it('category: data-accuracy for citation/accuracy/bible components', () => {
      expect(detector.classifyBug({ affected_component: 'Citation checker', confidence: 0.5, impact_assessment: '' }).category).toBe('data-accuracy');
      expect(detector.classifyBug({ affected_component: 'Data accuracy module', confidence: 0.5, impact_assessment: '' }).category).toBe('data-accuracy');
      expect(detector.classifyBug({ affected_component: 'Bible reference', confidence: 0.5, impact_assessment: '' }).category).toBe('data-accuracy');
    });

    it('category: ui for ui/frontend/display components', () => {
      expect(detector.classifyBug({ affected_component: 'UI renderer', confidence: 0.5, impact_assessment: '' }).category).toBe('ui');
      expect(detector.classifyBug({ affected_component: 'Frontend app', confidence: 0.5, impact_assessment: '' }).category).toBe('ui');
      expect(detector.classifyBug({ affected_component: 'Display manager', confidence: 0.5, impact_assessment: '' }).category).toBe('ui');
    });

    it('category: performance for performance/latency/speed components', () => {
      expect(detector.classifyBug({ affected_component: 'Performance monitor', confidence: 0.5, impact_assessment: '' }).category).toBe('performance');
      expect(detector.classifyBug({ affected_component: 'Latency tracker', confidence: 0.5, impact_assessment: '' }).category).toBe('performance');
      expect(detector.classifyBug({ affected_component: 'Speed optimizer', confidence: 0.5, impact_assessment: '' }).category).toBe('performance');
    });

    it('category: backend (default) for unrecognized components', () => {
      expect(detector.classifyBug({ affected_component: 'Authentication', confidence: 0.5, impact_assessment: '' }).category).toBe('backend');
      expect(detector.classifyBug({ affected_component: 'Database layer', confidence: 0.5, impact_assessment: '' }).category).toBe('backend');
      expect(detector.classifyBug({ affected_component: '', confidence: 0.5, impact_assessment: '' }).category).toBe('backend');
    });

    // Severity detection
    it('severity: critical when confidence >= 0.8 AND impact mentions critical', () => {
      const result = detector.classifyBug({
        affected_component: 'x', confidence: 0.9, impact_assessment: 'Critical failure in production'
      });
      expect(result.severity).toBe('critical');
    });

    it('severity: critical when confidence >= 0.8 AND impact mentions data loss', () => {
      const result = detector.classifyBug({
        affected_component: 'x', confidence: 0.85, impact_assessment: 'Potential data loss'
      });
      expect(result.severity).toBe('critical');
    });

    it('severity: critical when confidence >= 0.8 AND impact mentions crash', () => {
      const result = detector.classifyBug({
        affected_component: 'x', confidence: 0.8, impact_assessment: 'App crash on load'
      });
      expect(result.severity).toBe('critical');
    });

    it('severity: high when confidence >= 0.6 AND impact mentions high/broken/fail', () => {
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.7, impact_assessment: 'High impact' }).severity).toBe('high');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.6, impact_assessment: 'Feature broken' }).severity).toBe('high');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.65, impact_assessment: 'Test will fail' }).severity).toBe('high');
    });

    it('severity: low when confidence < 0.4', () => {
      const result = detector.classifyBug({
        affected_component: 'x', confidence: 0.3, impact_assessment: 'Something happened'
      });
      expect(result.severity).toBe('low');
    });

    it('severity: low when impact mentions minor or cosmetic', () => {
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.5, impact_assessment: 'Minor visual glitch' }).severity).toBe('low');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.5, impact_assessment: 'Cosmetic issue only' }).severity).toBe('low');
    });

    it('severity: medium (default) when no other rule matches', () => {
      const result = detector.classifyBug({
        affected_component: 'x', confidence: 0.5, impact_assessment: 'Some impact'
      });
      expect(result.severity).toBe('medium');
    });

    // Priority mapping
    it('priority maps: critical→urgent, high→high, medium→normal, low→low', () => {
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.9, impact_assessment: 'Critical crash' }).priority).toBe('urgent');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.7, impact_assessment: 'High broken' }).priority).toBe('high');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.5, impact_assessment: 'Moderate' }).priority).toBe('normal');
      expect(detector.classifyBug({ affected_component: 'x', confidence: 0.3, impact_assessment: 'Low' }).priority).toBe('low');
    });

    it('returns object with severity, category, priority', () => {
      const result = detector.classifyBug({ affected_component: 'Memory', confidence: 0.85, impact_assessment: 'High' });
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('priority');
    });
  });

  // ── Group 5: isAutoFixable() ──

  describe('isAutoFixable()', () => {
    let detector;

    beforeEach(() => {
      detector = createDetector();
    });

    it('returns true when all three conditions pass', () => {
      const analysis = { fix_approach: 'Adjust threshold to 0.5', likely_location: 'services/search.py' };
      const classification = { category: 'memory' };
      expect(detector.isAutoFixable(analysis, classification)).toBe(true);
    });

    it('returns false when fix_approach has no simple pattern match', () => {
      const analysis = { fix_approach: 'Rewrite the entire module', likely_location: 'x.py' };
      const classification = { category: 'memory' };
      expect(detector.isAutoFixable(analysis, classification)).toBe(false);
    });

    it('returns false when likely_location is "unknown"', () => {
      const analysis = { fix_approach: 'Adjust threshold', likely_location: 'unknown' };
      const classification = { category: 'memory' };
      expect(detector.isAutoFixable(analysis, classification)).toBe(false);
    });

    it('returns false when likely_location is null/undefined', () => {
      expect(detector.isAutoFixable({ fix_approach: 'Adjust threshold', likely_location: null }, { category: 'memory' })).toBe(false);
      expect(detector.isAutoFixable({ fix_approach: 'Adjust threshold' }, { category: 'memory' })).toBe(false);
    });

    it('returns false when category is ui', () => {
      const analysis = { fix_approach: 'Update selector to fix', likely_location: 'ui/comp.js' };
      expect(detector.isAutoFixable(analysis, { category: 'ui' })).toBe(false);
    });

    it('returns false when category is backend', () => {
      const analysis = { fix_approach: 'Add null check', likely_location: 'api/handler.js' };
      expect(detector.isAutoFixable(analysis, { category: 'backend' })).toBe(false);
    });

    it('returns true for category memory with valid pattern + location', () => {
      const analysis = { fix_approach: 'Adjust threshold', likely_location: 'x.py' };
      expect(detector.isAutoFixable(analysis, { category: 'memory' })).toBe(true);
    });

    it('returns true for category data-accuracy with valid pattern + location', () => {
      const analysis = { fix_approach: 'Modify prompt template', likely_location: 'prompts/x.py' };
      expect(detector.isAutoFixable(analysis, { category: 'data-accuracy' })).toBe(true);
    });

    it('returns true for category performance with valid pattern + location', () => {
      const analysis = { fix_approach: 'Fix timeout value', likely_location: 'config.js' };
      expect(detector.isAutoFixable(analysis, { category: 'performance' })).toBe(true);
    });

    it('pattern matching is case-insensitive', () => {
      const analysis = { fix_approach: 'ADJUST THRESHOLD to fix', likely_location: 'x.py' };
      expect(detector.isAutoFixable(analysis, { category: 'memory' })).toBe(true);
    });

    // Test each simple fix pattern
    const patterns = [
      'adjust threshold', 'update selector', 'fix timeout', 'add null check',
      'update config', 'change parameter', 'modify prompt', 'fix off-by-one'
    ];
    patterns.forEach(pattern => {
      it(`recognizes pattern: "${pattern}"`, () => {
        const analysis = { fix_approach: `Need to ${pattern} in the code`, likely_location: 'file.js' };
        expect(detector.isAutoFixable(analysis, { category: 'memory' })).toBe(true);
      });
    });
  });

  // ── Group 6: createBugRecord() ──

  describe('createBugRecord()', () => {
    let detector;
    let storage;

    beforeEach(() => {
      storage = createMockStorage();
      detector = createDetector({ storage });
    });

    it('generates incrementing BUG-{n} IDs', async () => {
      const app = createTestApp();
      const analysis = { root_cause: 'RC', affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0.5, impact_assessment: '' };
      const classification = { severity: 'medium', category: 'backend', priority: 'normal' };
      const evidence = { test_name: 't', scenario: 's', screenshots: [], console_logs: [], network_requests: [] };

      const bug1 = await detector.createBugRecord(app, 'agent1', {}, analysis, classification, false, evidence);
      const bug2 = await detector.createBugRecord(app, 'agent1', {}, analysis, classification, false, evidence);
      const bug3 = await detector.createBugRecord(app, 'agent1', {}, analysis, classification, false, evidence);

      expect(bug1.bug_id).toBe('BUG-1');
      expect(bug2.bug_id).toBe('BUG-2');
      expect(bug3.bug_id).toBe('BUG-3');
    });

    it('calls storage.saveBug with full record', async () => {
      const app = createTestApp();
      const analysis = { root_cause: 'Root cause', affected_component: 'Memory', likely_location: 'x.py', fix_approach: 'fix', confidence: 0.8, impact_assessment: 'High' };
      const classification = { severity: 'high', category: 'memory', priority: 'high' };
      const evidence = { test_name: 'test', scenario: 'scen', screenshots: [], console_logs: [], network_requests: [] };

      await detector.createBugRecord(app, 'sentinel', {}, analysis, classification, true, evidence);
      expect(storage.saveBug).toHaveBeenCalledTimes(1);

      const saved = storage.saveBug.mock.calls[0][0];
      expect(saved.severity).toBe('high');
      expect(saved.detected_by).toBe('sentinel');
      expect(saved.auto_fixable).toBe(true);
    });

    it('record includes all fields from analysis + classification + evidence', async () => {
      const app = createTestApp();
      const analysis = { root_cause: 'RC', affected_component: 'AC', likely_location: 'LL', fix_approach: 'FA', confidence: 0.7, impact_assessment: 'IA' };
      const classification = { severity: 'medium', category: 'backend', priority: 'normal' };
      const evidence = { test_name: 'TN', scenario: 'SC', screenshots: [], console_logs: [], network_requests: [] };

      const bug = await detector.createBugRecord(app, 'a', {}, analysis, classification, false, evidence);

      expect(bug.root_cause).toBe('RC');
      expect(bug.affected_component).toBe('AC');
      expect(bug.category).toBe('backend');
      expect(bug.test_name).toBe('TN');
      expect(bug.evidence).toBe(evidence);
    });

    it('title generated from root_cause first sentence (capped at 80 chars)', async () => {
      const analysis = { root_cause: 'Short root cause.', affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0.5, impact_assessment: '' };
      const bug = await detector.createBugRecord(createTestApp(), 'a', {}, analysis, { severity: 'm', category: 'b', priority: 'n' }, false, { test_name: 't', scenario: 's', screenshots: [], console_logs: [], network_requests: [] });
      expect(bug.title).toBe('Short root cause');
    });

    it('title capped at 80 chars for long root causes', async () => {
      const longCause = 'A'.repeat(100) + '. Second sentence.';
      const analysis = { root_cause: longCause, affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0.5, impact_assessment: '' };
      const bug = await detector.createBugRecord(createTestApp(), 'a', {}, analysis, { severity: 'm', category: 'b', priority: 'n' }, false, { test_name: 't', scenario: 's', screenshots: [], console_logs: [], network_requests: [] });
      expect(bug.title.length).toBeLessThanOrEqual(80);
      expect(bug.title).toContain('...');
    });

    it('title fallback to error message when root_cause is "LLM analysis failed"', async () => {
      const analysis = { root_cause: 'LLM analysis failed', affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0, impact_assessment: '' };
      const evidence = { test_name: 't', scenario: 's', error_message: 'Original error', screenshots: [], console_logs: [], network_requests: [] };
      const bug = await detector.createBugRecord(createTestApp(), 'sentinel', {}, analysis, { severity: 'm', category: 'b', priority: 'n' }, false, evidence);
      expect(bug.title).toContain('sentinel');
      expect(bug.title).toContain('Original error');
    });

    it('status defaults to open', async () => {
      const analysis = { root_cause: 'x', affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0.5, impact_assessment: '' };
      const bug = await detector.createBugRecord(createTestApp(), 'a', {}, analysis, { severity: 'm', category: 'b', priority: 'n' }, false, { test_name: 't', scenario: 's', screenshots: [], console_logs: [], network_requests: [] });
      expect(bug.status).toBe('open');
    });

    it('timestamps populated', async () => {
      const analysis = { root_cause: 'x', affected_component: 'x', likely_location: 'y', fix_approach: 'z', confidence: 0.5, impact_assessment: '' };
      const bug = await detector.createBugRecord(createTestApp(), 'a', {}, analysis, { severity: 'm', category: 'b', priority: 'n' }, false, { test_name: 't', scenario: 's', screenshots: [], console_logs: [], network_requests: [] });
      expect(bug.created_at).toBeTruthy();
      expect(bug.updated_at).toBeTruthy();
    });
  });

  // ── Group 7: createExternalIssue() ──

  describe('createExternalIssue()', () => {
    it('calls bugTracker.createIssue with formatted data', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'Test Bug', bug_id: 'BUG-1', detected_by: 'sentinel', severity: 'high',
        auto_fixable: true, test_name: 'test', scenario: 'scen',
        root_cause: 'RC', affected_component: 'AC', likely_location: 'LL', fix_approach: 'FA',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), bug);
      expect(bugTracker.createIssue).toHaveBeenCalledTimes(1);
    });

    it('title prefixed with [QA]', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'My Bug', bug_id: 'BUG-1', detected_by: 'a', severity: 'high',
        auto_fixable: false, test_name: 't', scenario: 's',
        root_cause: 'r', affected_component: 'a', likely_location: 'l', fix_approach: 'f',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), bug);
      const call = bugTracker.createIssue.mock.calls[0][0];
      expect(call.title).toBe('[QA] My Bug');
    });

    it('labels include: qa-detected, auto-fixable/needs-manual-fix, agent:{id}, severity:{level}', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });

      const autoFixBug = {
        title: 'B', bug_id: 'BUG-1', detected_by: 'sentinel', severity: 'high',
        auto_fixable: true, test_name: 't', scenario: 's',
        root_cause: 'r', affected_component: 'a', likely_location: 'l', fix_approach: 'f',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), autoFixBug);
      const labels = bugTracker.createIssue.mock.calls[0][0].labels;
      expect(labels).toContain('qa-detected');
      expect(labels).toContain('auto-fixable');
      expect(labels).toContain('agent:sentinel');
      expect(labels).toContain('severity:high');
    });

    it('uses needs-manual-fix label when not auto-fixable', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'B', bug_id: 'BUG-1', detected_by: 'a', severity: 'low',
        auto_fixable: false, test_name: 't', scenario: 's',
        root_cause: 'r', affected_component: 'a', likely_location: 'l', fix_approach: 'f',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), bug);
      const labels = bugTracker.createIssue.mock.calls[0][0].labels;
      expect(labels).toContain('needs-manual-fix');
    });

    it('description includes all sections (Test Info, Root Cause, etc.)', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'B', bug_id: 'BUG-1', detected_by: 'sentinel', severity: 'high',
        auto_fixable: false, test_name: 'Memory test', scenario: 'recall',
        root_cause: 'Bad search', affected_component: 'Search', likely_location: 'x.py', fix_approach: 'Fix it',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), bug);
      const desc = bugTracker.createIssue.mock.calls[0][0].description;
      expect(desc).toContain('## Test Information');
      expect(desc).toContain('## Root Cause');
      expect(desc).toContain('## Affected Component');
      expect(desc).toContain('## Fix Approach');
    });

    it('custom fields include test_id and bug_id', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'B', bug_id: 'BUG-42', detected_by: 'a', severity: 'low',
        auto_fixable: false, test_name: 't', scenario: 's',
        root_cause: 'r', affected_component: 'a', likely_location: 'l', fix_approach: 'f',
        evidence: { test_id: 'tid-99', screenshots: [], console_logs: [], network_requests: [] }
      };

      await detector.createExternalIssue(createTestApp(), bug);
      const cf = bugTracker.createIssue.mock.calls[0][0].custom_fields;
      expect(cf.test_id).toBe('tid-99');
      expect(cf.bug_id).toBe('BUG-42');
    });

    it('returns the bug tracker response', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });
      const bug = {
        title: 'B', bug_id: 'BUG-1', detected_by: 'a', severity: 'h',
        auto_fixable: false, test_name: 't', scenario: 's',
        root_cause: 'r', affected_component: 'a', likely_location: 'l', fix_approach: 'f',
        evidence: { test_id: 'tid', screenshots: [], console_logs: [], network_requests: [] }
      };

      const result = await detector.createExternalIssue(createTestApp(), bug);
      expect(result.id).toBe('linear-issue-123');
      expect(result.key).toBe('ENG-247');
    });
  });

  // ── Group 8: formatIssueDescription() ──

  describe('formatIssueDescription()', () => {
    let detector;

    beforeEach(() => {
      detector = createDetector();
    });

    const baseBug = {
      detected_by: 'sentinel', test_name: 'Memory test', scenario: 'recall',
      root_cause: 'Bad search', affected_component: 'Search', likely_location: 'x.py', fix_approach: 'Fix it',
      auto_fixable: false,
      evidence: { screenshots: [], console_logs: [], network_requests: [] }
    };

    it('includes all required Markdown sections', () => {
      const desc = detector.formatIssueDescription(baseBug);
      expect(desc).toContain('## Test Information');
      expect(desc).toContain('## Root Cause');
      expect(desc).toContain('## Affected Component');
      expect(desc).toContain('## Likely Location');
      expect(desc).toContain('## Fix Approach');
      expect(desc).toContain('## Evidence');
      expect(desc).toContain('## Auto-Fix Status');
    });

    it('screenshot link uses last screenshot in array', () => {
      const bug = { ...baseBug, evidence: { ...baseBug.evidence, screenshots: ['a.png', 'b.png', 'c.png'] } };
      const desc = detector.formatIssueDescription(bug);
      expect(desc).toContain('[Screenshot](c.png)');
    });

    it('shows "No screenshots captured" when empty', () => {
      const desc = detector.formatIssueDescription(baseBug);
      expect(desc).toContain('No screenshots captured');
    });

    it('console error count calculated correctly', () => {
      const bug = {
        ...baseBug,
        evidence: {
          ...baseBug.evidence,
          console_logs: [
            { level: 'error', message: 'e1' },
            { level: 'warn', message: 'w1' },
            { level: 'error', message: 'e2' }
          ]
        }
      };
      const desc = detector.formatIssueDescription(bug);
      expect(desc).toContain('Console Errors: 2');
    });

    it('network failure count calculated correctly', () => {
      const bug = {
        ...baseBug,
        evidence: {
          ...baseBug.evidence,
          network_requests: [
            { url: '/a', failed: true },
            { url: '/b', failed: false },
            { url: '/c', failed: true }
          ]
        }
      };
      const desc = detector.formatIssueDescription(bug);
      expect(desc).toContain('Network Failures: 2');
    });

    it('auto-fix status shows correct text for auto-fixable', () => {
      const bug = { ...baseBug, auto_fixable: true };
      const desc = detector.formatIssueDescription(bug);
      expect(desc).toContain('Auto-fixable');
    });

    it('auto-fix status shows correct text for non-auto-fixable', () => {
      const desc = detector.formatIssueDescription(baseBug);
      expect(desc).toContain('Requires manual fix');
    });
  });

  // ── Group 9: detectAndReport() Full Pipeline ──

  describe('detectAndReport()', () => {
    it('happy path: all steps succeed, returns complete bug record', async () => {
      const bugTracker = createMockBugTracker();
      const storage = createMockStorage();
      const detector = createDetector({ bugTracker, storage });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.bug_id).toBe('BUG-1');
      expect(bug.status).toBe('open');
      expect(bug.detected_by).toBe('sentinel');
      expect(bug.root_cause).toBeTruthy();
      expect(bug.external_issue_id).toBe('linear-issue-123');
      expect(bug.external_issue_url).toBe('https://linear.app/team/ENG-247');
    });

    it('throws on missing app', async () => {
      const detector = createDetector();
      await expect(detector.detectAndReport(null, 'a', {})).rejects.toThrow(BugDetectorError);
    });

    it('throws on missing agentId', async () => {
      const detector = createDetector();
      await expect(detector.detectAndReport({}, null, {})).rejects.toThrow(BugDetectorError);
      await expect(detector.detectAndReport({}, '', {})).rejects.toThrow(BugDetectorError);
    });

    it('throws on missing failure', async () => {
      const detector = createDetector();
      await expect(detector.detectAndReport({}, 'a', null)).rejects.toThrow(BugDetectorError);
    });

    it('LLM failure: creates bug with degraded analysis (auto_fixable=false)', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockRejectedValue(new Error('LLM timeout'))
      });
      const detector = new BugDetector({ llm });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.root_cause).toBe('LLM analysis failed');
      expect(bug.auto_fixable).toBe(false);
      expect(bug.bug_id).toBe('BUG-1');
    });

    it('bug tracker failure: bug created but external_issue_id is null, _issueCreationError set', async () => {
      const bugTracker = createMockBugTracker({
        createIssue: jest.fn().mockRejectedValue(new Error('Tracker down'))
      });
      const detector = createDetector({ bugTracker });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.external_issue_id).toBeNull();
      expect(bug._issueCreationError).toBe('Tracker down');
    });

    it('bug tracker not configured: skips issue creation entirely', async () => {
      const detector = createDetector(); // no bugTracker
      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.external_issue_id).toBeNull();
      expect(bug._issueCreationError).toBeUndefined();
    });

    it('approval manager configured + auto-fixable: calls requestApproval', async () => {
      // Need an auto-fixable scenario: memory category + simple pattern + known location
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            root_cause: 'Threshold too high',
            affected_component: 'Memory service',
            likely_location: 'services/search.py',
            fix_approach: 'Adjust threshold from 0.7 to 0.6',
            confidence: 0.85,
            impact_assessment: 'High impact'
          }),
          usage: {}, model: 'test'
        })
      });
      const approvalManager = createMockApprovalManager();
      const detector = new BugDetector({ llm, approvalManager });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.auto_fixable).toBe(true);
      expect(approvalManager.requestApproval).toHaveBeenCalledTimes(1);
      expect(bug.approval_id).toBe('ABC-1');
    });

    it('approval manager failure: bug created, _approvalError set', async () => {
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            root_cause: 'Threshold too high',
            affected_component: 'Memory service',
            likely_location: 'services/search.py',
            fix_approach: 'Adjust threshold from 0.7 to 0.6',
            confidence: 0.85,
            impact_assessment: 'High impact'
          }),
          usage: {}, model: 'test'
        })
      });
      const approvalManager = createMockApprovalManager({
        requestApproval: jest.fn().mockRejectedValue(new Error('Approval service down'))
      });
      const detector = new BugDetector({ llm, approvalManager });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.auto_fixable).toBe(true);
      expect(bug._approvalError).toBe('Approval service down');
    });

    it('approval manager not configured: skips approval', async () => {
      const detector = createDetector(); // no approvalManager
      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.approval_id).toBeUndefined();
      expect(bug._approvalError).toBeUndefined();
    });

    it('non-auto-fixable bug: skips approval even with manager configured', async () => {
      // Default mock LLM returns memory category but we need backend for non-auto-fixable
      const llm = createMockLLM({
        complete: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            root_cause: 'Database connection error',
            affected_component: 'Database layer',
            likely_location: 'db/pool.js',
            fix_approach: 'Restart connection pool',
            confidence: 0.7,
            impact_assessment: 'High - connections failing'
          }),
          usage: {}, model: 'test'
        })
      });
      const approvalManager = createMockApprovalManager();
      const detector = new BugDetector({ llm, approvalManager });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.auto_fixable).toBe(false);
      expect(approvalManager.requestApproval).not.toHaveBeenCalled();
    });

    it('sequential bug IDs: BUG-1, BUG-2, BUG-3 across multiple calls', async () => {
      const detector = createDetector();

      const bug1 = await detector.detectAndReport(createTestApp(), 'a1', createTestFailure());
      const bug2 = await detector.detectAndReport(createTestApp(), 'a2', createTestFailure());
      const bug3 = await detector.detectAndReport(createTestApp(), 'a3', createTestFailure());

      expect(bug1.bug_id).toBe('BUG-1');
      expect(bug2.bug_id).toBe('BUG-2');
      expect(bug3.bug_id).toBe('BUG-3');
    });

    it('evidence correctly passed through pipeline', async () => {
      const storage = createMockStorage();
      const detector = createDetector({ storage });

      const failure = createTestFailure();
      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', failure);

      expect(bug.evidence.test_id).toBe('sentinel-memory-001');
      expect(bug.evidence.screenshots).toEqual(['evidence/screenshots/sentinel-001-step3.png']);
    });

    it('classification correctly passed through pipeline', async () => {
      const detector = createDetector();
      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      // Default mock returns Memory service → memory category, confidence 0.85 + High impact → high severity
      expect(bug.category).toBe('memory');
      expect(bug.severity).toBe('high');
      expect(bug.priority).toBe('high');
    });

    it('storage.updateBug called after external issue creation', async () => {
      const storage = createMockStorage();
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ storage, bugTracker });

      await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(storage.updateBug).toHaveBeenCalledTimes(1);
      const [id, updates] = storage.updateBug.mock.calls[0];
      expect(updates.external_issue_id).toBe('linear-issue-123');
      expect(updates.external_issue_url).toBe('https://linear.app/team/ENG-247');
    });

    it('external_issue_key set on bug after tracker creation', async () => {
      const bugTracker = createMockBugTracker();
      const detector = createDetector({ bugTracker });

      const bug = await detector.detectAndReport(createTestApp(), 'sentinel', createTestFailure());

      expect(bug.external_issue_key).toBe('ENG-247');
    });

    it('app_id extracted from app.id', async () => {
      const detector = createDetector();
      const bug = await detector.detectAndReport({ id: 'my-app' }, 'sentinel', createTestFailure());
      expect(bug.app_id).toBe('my-app');
    });

    it('app_id falls back to app.name', async () => {
      const detector = createDetector();
      const bug = await detector.detectAndReport({ name: 'My App' }, 'sentinel', createTestFailure());
      expect(bug.app_id).toBe('My App');
    });

    it('app_id defaults to unknown', async () => {
      const detector = createDetector();
      const bug = await detector.detectAndReport({}, 'sentinel', createTestFailure());
      expect(bug.app_id).toBe('unknown');
    });
  });

  // ── Group 10: _parseAnalysisResponse() Edge Cases ──

  describe('_parseAnalysisResponse()', () => {
    let detector;

    beforeEach(() => {
      detector = createDetector();
    });

    it('valid JSON string', () => {
      const result = detector._parseAnalysisResponse('{"root_cause":"test","confidence":0.8}');
      expect(result.root_cause).toBe('test');
      expect(result.confidence).toBe(0.8);
    });

    it('JSON wrapped in ```json fences', () => {
      const result = detector._parseAnalysisResponse('```json\n{"root_cause":"fenced"}\n```');
      expect(result.root_cause).toBe('fenced');
    });

    it('JSON wrapped in ``` fences (no language tag)', () => {
      const result = detector._parseAnalysisResponse('```\n{"root_cause":"plain fenced"}\n```');
      expect(result.root_cause).toBe('plain fenced');
    });

    it('invalid JSON → degraded result', () => {
      const result = detector._parseAnalysisResponse('not json');
      expect(result.root_cause).toBe('LLM analysis returned unparseable response');
      expect(result.confidence).toBe(0);
    });

    it('empty string → degraded result', () => {
      const result = detector._parseAnalysisResponse('');
      expect(result.root_cause).toBe('LLM analysis returned unparseable response');
    });

    it('missing confidence → defaults to 0.5', () => {
      const result = detector._parseAnalysisResponse('{"root_cause":"x"}');
      expect(result.confidence).toBe(0.5);
    });

    it('confidence > 1 → clamped to 1.0', () => {
      const result = detector._parseAnalysisResponse('{"confidence":5.0}');
      expect(result.confidence).toBe(1.0);
    });

    it('confidence < 0 → clamped to 0.0', () => {
      const result = detector._parseAnalysisResponse('{"confidence":-2.0}');
      expect(result.confidence).toBe(0.0);
    });
  });
});
