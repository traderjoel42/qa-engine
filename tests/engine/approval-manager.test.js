'use strict';

const ApprovalManager = require('../../core/engine/approval-manager');
const { ApprovalError } = require('../../core/engine/errors');

// ═══════════════════════════════════════════════════════════
// MOCK FACTORIES (from spec)
// ═══════════════════════════════════════════════════════════

function createMockNotifier(overrides = {}) {
  return {
    send: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' }),
    sendWithActions: jest.fn().mockResolvedValue({ id: 'msg-2', status: 'sent' }),
    ...overrides
  };
}

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
    external_issue_url: null,
    auto_fixable: true,
    created_at: '2026-02-12T10:00:00Z',
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

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

describe('ApprovalManager', () => {

  // ─────────────────────────────────────────────────────────
  // Group 1: Constructor Validation (~5 tests)
  // ─────────────────────────────────────────────────────────
  describe('Constructor Validation', () => {
    test('requires options.notifier — throws ApprovalError if missing', () => {
      expect(() => new ApprovalManager()).toThrow(ApprovalError);
      expect(() => new ApprovalManager()).toThrow('ApprovalManager requires options.notifier adapter');
    });

    test('throws ApprovalError if notifier is explicitly null', () => {
      expect(() => new ApprovalManager({ notifier: null })).toThrow(ApprovalError);
    });

    test('accepts optional storage, timeoutMs, recipients', () => {
      const notifier = createMockNotifier();
      const storage = createMockApprovalStorage();
      const manager = new ApprovalManager({
        notifier,
        storage,
        timeoutMs: 7200000,
        recipients: ['+1234567890']
      });
      expect(manager).toBeInstanceOf(ApprovalManager);
    });

    test('default timeoutMs is 3600000 (1 hour)', () => {
      const notifier = createMockNotifier();
      const manager = new ApprovalManager({ notifier });
      expect(manager._timeoutMs).toBe(3600000);
    });

    test('default storage uses in-memory Map', async () => {
      const notifier = createMockNotifier();
      const manager = new ApprovalManager({ notifier });
      // Verify in-memory storage works
      const testApproval = { approval_id: 'TEST-1', status: 'pending' };
      await manager._storage.saveApproval(testApproval);
      const retrieved = await manager._storage.getApproval('TEST-1');
      expect(retrieved).toBeTruthy();
      expect(retrieved.approval_id).toBe('TEST-1');
    });

    test('recipients can be string or array', () => {
      const notifier = createMockNotifier();
      const m1 = new ApprovalManager({ notifier, recipients: '+1234567890' });
      expect(m1._recipients).toBe('+1234567890');

      const m2 = new ApprovalManager({ notifier, recipients: ['+1234567890', '+0987654321'] });
      expect(m2._recipients).toEqual(['+1234567890', '+0987654321']);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 2: generateApprovalId() (~8 tests)
  // ─────────────────────────────────────────────────────────
  describe('generateApprovalId()', () => {
    let manager;

    beforeEach(() => {
      manager = new ApprovalManager({ notifier: createMockNotifier() });
    });

    test('generates format XXX-NNN (3 uppercase letters + dash + number)', () => {
      const id = manager.generateApprovalId('BUG-247');
      expect(id).toMatch(/^[A-Z]{3}-\d+$/);
    });

    test('extracts number from BUG-247 → XXX-247', () => {
      const id = manager.generateApprovalId('BUG-247');
      expect(id).toMatch(/-247$/);
    });

    test('extracts number from BUG-1 → XXX-1', () => {
      const id = manager.generateApprovalId('BUG-1');
      expect(id).toMatch(/-1$/);
    });

    test('throws ApprovalError on null input', () => {
      expect(() => manager.generateApprovalId(null)).toThrow(ApprovalError);
      expect(() => manager.generateApprovalId(null)).toThrow('generateApprovalId requires a bugId string');
    });

    test('throws ApprovalError on undefined input', () => {
      expect(() => manager.generateApprovalId(undefined)).toThrow(ApprovalError);
    });

    test('throws ApprovalError on non-string input', () => {
      expect(() => manager.generateApprovalId(123)).toThrow(ApprovalError);
    });

    test('throws ApprovalError on malformed bugId (no number part)', () => {
      expect(() => manager.generateApprovalId('BUG-abc')).toThrow(ApprovalError);
      expect(() => manager.generateApprovalId('BUG-abc')).toThrow('Cannot extract bug number from');
    });

    test('two calls with same bugId produce different prefixes (random)', () => {
      const ids = new Set();
      // Generate many IDs — at least 2 should differ (statistically near-certain)
      for (let i = 0; i < 20; i++) {
        ids.add(manager.generateApprovalId('BUG-1').split('-')[0]);
      }
      expect(ids.size).toBeGreaterThan(1);
    });

    test('prefix is always exactly 3 uppercase letters', () => {
      for (let i = 0; i < 10; i++) {
        const id = manager.generateApprovalId('BUG-42');
        const prefix = id.split('-')[0];
        expect(prefix).toMatch(/^[A-Z]{3}$/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 3: parseResponse() (~12 tests)
  // ─────────────────────────────────────────────────────────
  describe('parseResponse()', () => {
    let manager;

    beforeEach(() => {
      manager = new ApprovalManager({ notifier: createMockNotifier() });
    });

    test('parses YES-ABC-247 → { action: "YES", id: "ABC-247" }', () => {
      const result = manager.parseResponse('YES-ABC-247');
      expect(result).toEqual({ action: 'YES', id: 'ABC-247' });
    });

    test('parses NO-XYZ-1 → { action: "NO", id: "XYZ-1" }', () => {
      const result = manager.parseResponse('NO-XYZ-1');
      expect(result).toEqual({ action: 'NO', id: 'XYZ-1' });
    });

    test('parses INFO-DEF-999 → { action: "INFO", id: "DEF-999" }', () => {
      const result = manager.parseResponse('INFO-DEF-999');
      expect(result).toEqual({ action: 'INFO', id: 'DEF-999' });
    });

    test('returns null for empty string', () => {
      expect(manager.parseResponse('')).toBeNull();
    });

    test('returns null for null', () => {
      expect(manager.parseResponse(null)).toBeNull();
    });

    test('returns null for non-string', () => {
      expect(manager.parseResponse(123)).toBeNull();
    });

    test('returns null for MAYBE-ABC-247 (invalid action)', () => {
      expect(manager.parseResponse('MAYBE-ABC-247')).toBeNull();
    });

    test('returns null for YES-ab-247 (lowercase prefix)', () => {
      expect(manager.parseResponse('YES-ab-247')).toBeNull();
    });

    test('returns null for YES-ABCD-247 (4-letter prefix)', () => {
      expect(manager.parseResponse('YES-ABCD-247')).toBeNull();
    });

    test('returns null for YES-AB-247 (2-letter prefix)', () => {
      expect(manager.parseResponse('YES-AB-247')).toBeNull();
    });

    test('returns null for YES-ABC- (no number)', () => {
      expect(manager.parseResponse('YES-ABC-')).toBeNull();
    });

    test('returns null for YES-ABC (missing number entirely)', () => {
      expect(manager.parseResponse('YES-ABC')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 4: formatApprovalRequest() (~6 tests)
  // ─────────────────────────────────────────────────────────
  describe('formatApprovalRequest()', () => {
    let manager;

    beforeEach(() => {
      manager = new ApprovalManager({ notifier: createMockNotifier() });
    });

    test('includes severity emoji (critical=red, high=orange, medium=yellow, low=green)', () => {
      const criticalBug = createTestBug({ severity: 'critical' });
      const highBug = createTestBug({ severity: 'high' });
      const mediumBug = createTestBug({ severity: 'medium' });
      const lowBug = createTestBug({ severity: 'low' });

      expect(manager.formatApprovalRequest(criticalBug, 'ABC-1')).toContain('\uD83D\uDD34');
      expect(manager.formatApprovalRequest(highBug, 'ABC-1')).toContain('\uD83D\uDFE0');
      expect(manager.formatApprovalRequest(mediumBug, 'ABC-1')).toContain('\uD83D\uDFE1');
      expect(manager.formatApprovalRequest(lowBug, 'ABC-1')).toContain('\uD83D\uDFE2');
    });

    test('includes bug title, component, root cause, fix approach', () => {
      const bug = createTestBug();
      const msg = manager.formatApprovalRequest(bug, 'ABC-1');
      expect(msg).toContain(bug.title);
      expect(msg).toContain(bug.affected_component);
      expect(msg).toContain(bug.root_cause);
      expect(msg).toContain(bug.fix_approach);
    });

    test('includes YES/NO/INFO action strings with approval ID', () => {
      const bug = createTestBug();
      const msg = manager.formatApprovalRequest(bug, 'XYZ-42');
      expect(msg).toContain('YES-XYZ-42');
      expect(msg).toContain('NO-XYZ-42');
      expect(msg).toContain('INFO-XYZ-42');
    });

    test('includes external issue URL link when present', () => {
      const bug = createTestBug({ external_issue_url: 'https://linear.app/team/ENG-1' });
      const msg = manager.formatApprovalRequest(bug, 'ABC-1');
      expect(msg).toContain('[View Details](https://linear.app/team/ENG-1)');
    });

    test('omits link when external_issue_url is null', () => {
      const bug = createTestBug({ external_issue_url: null });
      const msg = manager.formatApprovalRequest(bug, 'ABC-1');
      expect(msg).not.toContain('[View Details]');
    });

    test('default emoji for unknown severity', () => {
      const bug = createTestBug({ severity: 'unknown-level' });
      const msg = manager.formatApprovalRequest(bug, 'ABC-1');
      expect(msg).toContain('\u26AA');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 5: formatDetailedInfo() (~4 tests)
  // ─────────────────────────────────────────────────────────
  describe('formatDetailedInfo()', () => {
    let manager;

    beforeEach(() => {
      manager = new ApprovalManager({ notifier: createMockNotifier() });
    });

    test('includes all bug fields (title, severity, category, agent, etc.)', () => {
      const bug = createTestBug();
      const info = manager.formatDetailedInfo(bug);
      expect(info).toContain(bug.title);
      expect(info).toContain(bug.severity);
      expect(info).toContain(bug.category);
      expect(info).toContain(bug.detected_by);
      expect(info).toContain(bug.test_name);
      expect(info).toContain(bug.root_cause);
      expect(info).toContain(bug.affected_component);
      expect(info).toContain(bug.likely_location);
      expect(info).toContain(bug.fix_approach);
      expect(info).toContain('85%'); // confidence 0.85 → 85%
    });

    test('includes evidence summary (screenshot count, error count)', () => {
      const bug = createTestBug({
        evidence: {
          screenshots: ['s1.png', 's2.png'],
          console_logs: [{ level: 'error', message: 'err' }, { level: 'warn', message: 'warn' }],
          network_requests: [{ failed: true }, { failed: false }]
        }
      });
      const info = manager.formatDetailedInfo(bug);
      expect(info).toContain('2 screenshots');
      expect(info).toContain('1 console errors');
      expect(info).toContain('1 network failures');
    });

    test('includes Linear link when present', () => {
      const bug = createTestBug({ external_issue_url: 'https://linear.app/team/ENG-1' });
      const info = manager.formatDetailedInfo(bug);
      expect(info).toContain('[View in Linear](https://linear.app/team/ENG-1)');
    });

    test('returns fallback message when bug is null', () => {
      const info = manager.formatDetailedInfo(null);
      expect(info).toBe('No bug details available.');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 6: requestApproval() (~14 tests)
  // ─────────────────────────────────────────────────────────
  describe('requestApproval()', () => {
    let manager;
    let notifier;
    let storage;
    let app;
    let bug;

    beforeEach(() => {
      notifier = createMockNotifier();
      storage = createMockApprovalStorage();
      manager = new ApprovalManager({ notifier, storage, recipients: ['+1234567890'] });
      app = createTestApp();
      bug = createTestBug();
    });

    test('generates approval ID from bug.bug_id', async () => {
      const approval = await manager.requestApproval(app, bug);
      expect(approval.approval_id).toMatch(/^[A-Z]{3}-1$/);
    });

    test('creates approval record with pending status', async () => {
      const approval = await manager.requestApproval(app, bug);
      expect(approval.status).toBe('pending');
    });

    test('calls storage.saveApproval with record', async () => {
      await manager.requestApproval(app, bug);
      expect(storage.saveApproval).toHaveBeenCalledTimes(1);
      const savedApproval = storage.saveApproval.mock.calls[0][0];
      expect(savedApproval.approval_id).toMatch(/^[A-Z]{3}-1$/);
      expect(savedApproval.bug_id).toBe('BUG-1');
    });

    test('calls notifier.sendWithActions with formatted message', async () => {
      await manager.requestApproval(app, bug);
      expect(notifier.sendWithActions).toHaveBeenCalledTimes(1);
      const [recipients, message, actions] = notifier.sendWithActions.mock.calls[0];
      expect(message).toContain('Bug Detected');
      expect(message).toContain(bug.title);
    });

    test('passes correct actions array (YES/NO/INFO)', async () => {
      const approval = await manager.requestApproval(app, bug);
      const [, , actions] = notifier.sendWithActions.mock.calls[0];
      expect(actions).toHaveLength(3);
      expect(actions[0].id).toBe(`YES-${approval.approval_id}`);
      expect(actions[0].label).toBe('Approve Fix');
      expect(actions[1].id).toBe(`NO-${approval.approval_id}`);
      expect(actions[1].label).toBe('Reject Fix');
      expect(actions[2].id).toBe(`INFO-${approval.approval_id}`);
      expect(actions[2].label).toBe('More Info');
    });

    test('sets notification_sent=true on success', async () => {
      const approval = await manager.requestApproval(app, bug);
      expect(approval.notification_sent).toBe(true);
    });

    test('sets _notificationError on notifier failure (non-fatal)', async () => {
      const failNotifier = createMockNotifier({
        sendWithActions: jest.fn().mockRejectedValue(new Error('WhatsApp down'))
      });
      const m = new ApprovalManager({ notifier: failNotifier, storage });
      const approval = await m.requestApproval(app, bug);
      expect(approval._notificationError).toBe('WhatsApp down');
      expect(approval.notification_sent).toBe(false);
    });

    test('uses app.integrations.notifications.recipients', async () => {
      const appWithRecipients = createTestApp({
        integrations: { notifications: { recipients: ['+9999999999'] } }
      });
      await manager.requestApproval(appWithRecipients, bug);
      const [recipients] = notifier.sendWithActions.mock.calls[0];
      expect(recipients).toEqual(['+9999999999']);
    });

    test('falls back to constructor recipients', async () => {
      await manager.requestApproval(app, bug);
      const [recipients] = notifier.sendWithActions.mock.calls[0];
      expect(recipients).toEqual(['+1234567890']);
    });

    test('sets timeout_at = requested_at + timeoutMs', async () => {
      const m = new ApprovalManager({ notifier, storage, timeoutMs: 7200000 });
      const approval = await m.requestApproval(app, bug);
      const requested = new Date(approval.requested_at).getTime();
      const timeout = new Date(approval.timeout_at).getTime();
      expect(timeout - requested).toBe(7200000);
    });

    test('throws on missing app', async () => {
      await expect(manager.requestApproval(null, bug)).rejects.toThrow(ApprovalError);
      await expect(manager.requestApproval(null, bug)).rejects.toThrow('requestApproval requires app config');
    });

    test('throws on missing bug', async () => {
      await expect(manager.requestApproval(app, null)).rejects.toThrow(ApprovalError);
      await expect(manager.requestApproval(app, null)).rejects.toThrow('requestApproval requires bug with bug_id');
    });

    test('throws on bug without bug_id', async () => {
      const noBugId = createTestBug({ bug_id: undefined });
      delete noBugId.bug_id;
      await expect(manager.requestApproval(app, noBugId)).rejects.toThrow(ApprovalError);
    });

    test('returns complete ApprovalRecord', async () => {
      const approval = await manager.requestApproval(app, bug);
      expect(approval).toHaveProperty('approval_id');
      expect(approval).toHaveProperty('bug_id', 'BUG-1');
      expect(approval).toHaveProperty('bug');
      expect(approval).toHaveProperty('status', 'pending');
      expect(approval).toHaveProperty('requested_at');
      expect(approval).toHaveProperty('timeout_at');
      expect(approval).toHaveProperty('responded_at', null);
      expect(approval).toHaveProperty('responded_via', null);
      expect(approval).toHaveProperty('notification_sent', true);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 7: handleResponse() (~16 tests)
  // ─────────────────────────────────────────────────────────
  describe('handleResponse()', () => {
    let manager;
    let notifier;
    let storage;
    let app;
    let bug;

    beforeEach(async () => {
      notifier = createMockNotifier();
      storage = createMockApprovalStorage();
      manager = new ApprovalManager({ notifier, storage });
      app = createTestApp();
      bug = createTestBug();
    });

    async function createPendingApproval() {
      const approval = await manager.requestApproval(app, bug);
      return approval;
    }

    test('YES response: updates status to approved, returns action=approved with message', async () => {
      const approval = await createPendingApproval();
      const result = await manager.handleResponse(`YES-${approval.approval_id}`);
      expect(result.action).toBe('approved');
      expect(result.message).toContain('Fix approved');
      expect(result.approval.status).toBe('approved');
    });

    test('NO response: updates status to rejected, returns action=rejected with message', async () => {
      const approval = await createPendingApproval();
      const result = await manager.handleResponse(`NO-${approval.approval_id}`);
      expect(result.action).toBe('rejected');
      expect(result.message).toContain('Fix rejected');
      expect(result.approval.status).toBe('rejected');
    });

    test('INFO response: returns action=info with detailed bug info, does not update status', async () => {
      const approval = await createPendingApproval();
      const result = await manager.handleResponse(`INFO-${approval.approval_id}`);
      expect(result.action).toBe('info');
      expect(result.message).toContain('Bug Details');
      expect(result.bug).toBeTruthy();
      expect(result.approval.status).toBe('pending'); // Not changed
    });

    test('invalid format: returns action=error with message', async () => {
      const result = await manager.handleResponse('INVALID-FORMAT');
      expect(result.action).toBe('error');
      expect(result.message).toContain('Invalid response format');
    });

    test('unknown approval ID: returns action=error with not found message', async () => {
      const result = await manager.handleResponse('YES-ZZZ-999');
      expect(result.action).toBe('error');
      expect(result.message).toContain('not found');
    });

    test('already approved: returns action=error with already approved message', async () => {
      const approval = await createPendingApproval();
      await manager.handleResponse(`YES-${approval.approval_id}`);
      const result = await manager.handleResponse(`YES-${approval.approval_id}`);
      expect(result.action).toBe('error');
      expect(result.message).toContain('already approved');
    });

    test('already rejected: returns action=error with already rejected message', async () => {
      const approval = await createPendingApproval();
      await manager.handleResponse(`NO-${approval.approval_id}`);
      const result = await manager.handleResponse(`YES-${approval.approval_id}`);
      expect(result.action).toBe('error');
      expect(result.message).toContain('already rejected');
    });

    test('timed-out approval: returns action=timed-out, updates status', async () => {
      // Create approval with very short timeout
      const shortManager = new ApprovalManager({ notifier, storage, timeoutMs: 1 });
      const approval = await shortManager.requestApproval(app, bug);
      // Wait a tick for timeout to pass
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = await shortManager.handleResponse(`YES-${approval.approval_id}`);
      expect(result.action).toBe('timed-out');
      expect(result.message).toContain('timed out');
    });

    test('null response: returns action=error', async () => {
      const result = await manager.handleResponse(null);
      expect(result.action).toBe('error');
      expect(result.approval_id).toBeNull();
    });

    test('empty string: returns action=error', async () => {
      const result = await manager.handleResponse('');
      expect(result.action).toBe('error');
    });

    test('non-string: returns action=error', async () => {
      const result = await manager.handleResponse(123);
      expect(result.action).toBe('error');
    });

    test('calls storage.updateApproval for YES', async () => {
      const approval = await createPendingApproval();
      storage.updateApproval.mockClear();
      await manager.handleResponse(`YES-${approval.approval_id}`);
      expect(storage.updateApproval).toHaveBeenCalledWith(
        approval.approval_id,
        expect.objectContaining({ status: 'approved', responded_via: 'message' })
      );
    });

    test('calls storage.updateApproval for NO', async () => {
      const approval = await createPendingApproval();
      storage.updateApproval.mockClear();
      await manager.handleResponse(`NO-${approval.approval_id}`);
      expect(storage.updateApproval).toHaveBeenCalledWith(
        approval.approval_id,
        expect.objectContaining({ status: 'rejected', responded_via: 'message' })
      );
    });

    test('does NOT call storage.updateApproval for INFO', async () => {
      const approval = await createPendingApproval();
      storage.updateApproval.mockClear();
      await manager.handleResponse(`INFO-${approval.approval_id}`);
      expect(storage.updateApproval).not.toHaveBeenCalled();
    });

    test('sets responded_at timestamp on YES/NO', async () => {
      const approval = await createPendingApproval();
      const result = await manager.handleResponse(`YES-${approval.approval_id}`);
      expect(result.approval.responded_at).toBeTruthy();
      expect(new Date(result.approval.responded_at).getTime()).toBeGreaterThan(0);
    });

    test('sets responded_via=message on YES/NO', async () => {
      const approval = await createPendingApproval();
      storage.updateApproval.mockClear();
      await manager.handleResponse(`NO-${approval.approval_id}`);
      expect(storage.updateApproval).toHaveBeenCalledWith(
        approval.approval_id,
        expect.objectContaining({ responded_via: 'message' })
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 8: checkTimeout() (~6 tests)
  // ─────────────────────────────────────────────────────────
  describe('checkTimeout()', () => {
    let manager;
    let notifier;
    let storage;
    let app;
    let bug;

    beforeEach(() => {
      notifier = createMockNotifier();
      storage = createMockApprovalStorage();
      app = createTestApp();
      bug = createTestBug();
    });

    test('returns false for unknown approvalId', async () => {
      manager = new ApprovalManager({ notifier, storage });
      const result = await manager.checkTimeout('UNKNOWN-999');
      expect(result).toBe(false);
    });

    test('returns false for non-pending approval', async () => {
      manager = new ApprovalManager({ notifier, storage });
      const approval = await manager.requestApproval(app, bug);
      // Approve it first
      await manager.handleResponse(`YES-${approval.approval_id}`);
      const result = await manager.checkTimeout(approval.approval_id);
      expect(result).toBe(false);
    });

    test('returns false when not yet timed out', async () => {
      manager = new ApprovalManager({ notifier, storage, timeoutMs: 3600000 });
      const approval = await manager.requestApproval(app, bug);
      const result = await manager.checkTimeout(approval.approval_id);
      expect(result).toBe(false);
    });

    test('returns true when past timeout_at', async () => {
      manager = new ApprovalManager({ notifier, storage, timeoutMs: 1 });
      const approval = await manager.requestApproval(app, bug);
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = await manager.checkTimeout(approval.approval_id);
      expect(result).toBe(true);
    });

    test('updates status to timed-out when timed out', async () => {
      manager = new ApprovalManager({ notifier, storage, timeoutMs: 1 });
      const approval = await manager.requestApproval(app, bug);
      await new Promise(resolve => setTimeout(resolve, 10));
      storage.updateApproval.mockClear();
      await manager.checkTimeout(approval.approval_id);
      expect(storage.updateApproval).toHaveBeenCalledWith(
        approval.approval_id,
        expect.objectContaining({ status: 'timed-out' })
      );
    });

    test('sets responded_via=timeout', async () => {
      manager = new ApprovalManager({ notifier, storage, timeoutMs: 1 });
      const approval = await manager.requestApproval(app, bug);
      await new Promise(resolve => setTimeout(resolve, 10));
      storage.updateApproval.mockClear();
      await manager.checkTimeout(approval.approval_id);
      expect(storage.updateApproval).toHaveBeenCalledWith(
        approval.approval_id,
        expect.objectContaining({ responded_via: 'timeout' })
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Group 9: getApproval() (~4 tests)
  // ─────────────────────────────────────────────────────────
  describe('getApproval()', () => {
    let manager;
    let notifier;
    let storage;
    let app;
    let bug;

    beforeEach(() => {
      notifier = createMockNotifier();
      storage = createMockApprovalStorage();
      manager = new ApprovalManager({ notifier, storage });
      app = createTestApp();
      bug = createTestBug();
    });

    test('returns approval by ID', async () => {
      const approval = await manager.requestApproval(app, bug);
      const retrieved = await manager.getApproval(approval.approval_id);
      expect(retrieved).toBeTruthy();
      expect(retrieved.approval_id).toBe(approval.approval_id);
    });

    test('returns null for unknown ID', async () => {
      const result = await manager.getApproval('UNKNOWN-999');
      expect(result).toBeNull();
    });

    test('returns updated approval after handleResponse', async () => {
      const approval = await manager.requestApproval(app, bug);
      await manager.handleResponse(`YES-${approval.approval_id}`);
      const retrieved = await manager.getApproval(approval.approval_id);
      expect(retrieved.status).toBe('approved');
    });

    test('returns approval created by requestApproval', async () => {
      const approval = await manager.requestApproval(app, bug);
      const retrieved = await manager.getApproval(approval.approval_id);
      expect(retrieved.bug_id).toBe('BUG-1');
      expect(retrieved.status).toBe('pending');
    });
  });
});
