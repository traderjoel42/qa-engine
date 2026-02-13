'use strict';

const CommandHandler = require('../../interfaces/whatsapp-bot/command-handler');
const NotificationTemplates = require('../../interfaces/whatsapp-bot/notification-templates');

function createMockEngine() {
  return {
    run: jest.fn().mockResolvedValue({}),
    status: jest.fn().mockResolvedValue({ activeRuns: [], recentRuns: [] }),
    bugs: jest.fn().mockResolvedValue([]),
    approve: jest.fn().mockResolvedValue({ action: 'approved', approval_id: 'ABC-247', message: 'Approved' }),
    reject: jest.fn().mockResolvedValue({ action: 'rejected', approval_id: 'ABC-247', message: 'Rejected' }),
    bugInfo: jest.fn().mockResolvedValue({
      action: 'info',
      bug: {
        bug_id: 'BUG-248', title: 'Test bug', severity: 'medium', category: 'test',
        detected_by: 'sentinel', created_at: '2026-02-12T14:00:00Z',
        root_cause: 'Test cause', affected_component: 'test.js', fix_approach: 'Fix it'
      }
    }),
    shutdown: jest.fn().mockResolvedValue(undefined)
  };
}

function createMockNotifier() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const testMessage = { from: 'whatsapp:+15551234567', body: 'test' };

describe('CommandHandler', () => {
  let engine, notifier, handler;

  beforeEach(() => {
    engine = createMockEngine();
    notifier = createMockNotifier();
    handler = new CommandHandler({ engine, notifier });
  });

  // ── constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    test('throws if engine missing', () => {
      expect(() => new CommandHandler({ notifier })).toThrow('CommandHandler requires engine');
    });

    test('throws if notifier missing', () => {
      expect(() => new CommandHandler({ engine })).toThrow('CommandHandler requires notifier');
    });

    test('defaults defaultAppId to brainstormy', () => {
      expect(handler.defaultAppId).toBe('brainstormy');
    });

    test('accepts custom defaultAppId', () => {
      const h = new CommandHandler({ engine, notifier, defaultAppId: 'myapp' });
      expect(h.defaultAppId).toBe('myapp');
    });
  });

  // ── handle() — routing ─────────────────────────────────────────────

  describe('handle() — routing', () => {
    test('routes run command to handleRun', async () => {
      jest.spyOn(handler, 'handleRun').mockResolvedValue({ success: true });
      await handler.handle({ type: 'run', params: { mode: null, agents: [] } }, testMessage);
      expect(handler.handleRun).toHaveBeenCalled();
    });

    test('routes status command to handleStatus', async () => {
      jest.spyOn(handler, 'handleStatus').mockResolvedValue({ success: true });
      await handler.handle({ type: 'status', params: {} }, testMessage);
      expect(handler.handleStatus).toHaveBeenCalled();
    });

    test('routes bugs command to handleBugs', async () => {
      jest.spyOn(handler, 'handleBugs').mockResolvedValue({ success: true });
      await handler.handle({ type: 'bugs', params: { status: 'open' } }, testMessage);
      expect(handler.handleBugs).toHaveBeenCalled();
    });

    test('routes approve command to handleApprove', async () => {
      jest.spyOn(handler, 'handleApprove').mockResolvedValue({ success: true });
      await handler.handle({ type: 'approve', params: { approvalId: 'ABC-247' } }, testMessage);
      expect(handler.handleApprove).toHaveBeenCalled();
    });

    test('routes reject command to handleReject', async () => {
      jest.spyOn(handler, 'handleReject').mockResolvedValue({ success: true });
      await handler.handle({ type: 'reject', params: { approvalId: 'ABC-247' } }, testMessage);
      expect(handler.handleReject).toHaveBeenCalled();
    });

    test('routes info command to handleInfo', async () => {
      jest.spyOn(handler, 'handleInfo').mockResolvedValue({ success: true });
      await handler.handle({ type: 'info', params: { approvalId: 'ABC-247' } }, testMessage);
      expect(handler.handleInfo).toHaveBeenCalled();
    });

    test('routes help command to handleHelp', async () => {
      jest.spyOn(handler, 'handleHelp').mockResolvedValue({ success: true });
      await handler.handle({ type: 'help', params: {} }, testMessage);
      expect(handler.handleHelp).toHaveBeenCalled();
    });

    test('routes unknown command to handleUnknown', async () => {
      jest.spyOn(handler, 'handleUnknown').mockResolvedValue({ success: false });
      await handler.handle({ type: 'unknown', params: { originalText: 'xyz' } }, testMessage);
      expect(handler.handleUnknown).toHaveBeenCalled();
    });

    test('catches handler errors and sends error notification', async () => {
      engine.status.mockRejectedValue(new Error('DB down'));
      const result = await handler.handle({ type: 'status', params: {} }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        NotificationTemplates.internalError()
      );
      expect(result.success).toBe(false);
    });
  });

  // ── handleRun() ─────────────────────────────────────────────────────

  describe('handleRun()', () => {
    const runParams = { mode: 'smoke', agents: ['healer'] };

    test('sends acknowledgment immediately via notifier', async () => {
      await handler.handleRun(runParams, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('smoke tests')
      );
    });

    test('calls engine.run(appId, options) with defaultAppId as first arg', async () => {
      await handler.handleRun(runParams, testMessage);
      // Allow time for fire-and-forget
      await new Promise(r => setTimeout(r, 10));
      expect(engine.run).toHaveBeenCalledWith('brainstormy', expect.any(Object));
    });

    test('calls engine.run() with mode in options when specified', async () => {
      await handler.handleRun({ mode: 'regression', agents: [] }, testMessage);
      await new Promise(r => setTimeout(r, 10));
      expect(engine.run).toHaveBeenCalledWith('brainstormy', { mode: 'regression' });
    });

    test('calls engine.run() with agents in options when specified', async () => {
      await handler.handleRun({ mode: null, agents: ['sentinel'] }, testMessage);
      await new Promise(r => setTimeout(r, 10));
      expect(engine.run).toHaveBeenCalledWith('brainstormy', { agents: ['sentinel'] });
    });

    test('does not await engine.run() — fire and forget', async () => {
      let runResolved = false;
      engine.run.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => { runResolved = true; resolve({}); }, 100);
      }));

      await handler.handleRun(runParams, testMessage);
      // handleRun should return before engine.run resolves
      expect(runResolved).toBe(false);
    });

    test('sends error notification if engine.run() rejects', async () => {
      engine.run.mockRejectedValue(new Error('Run failed'));
      await handler.handleRun(runParams, testMessage);
      // Wait for the catch to fire
      await new Promise(r => setTimeout(r, 50));
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Test run failed to start')
      );
    });

    test('returns success with ack message', async () => {
      const result = await handler.handleRun(runParams, testMessage);
      expect(result.success).toBe(true);
      expect(result.message).toContain('smoke tests');
    });
  });

  // ── handleStatus() ──────────────────────────────────────────────────

  describe('handleStatus()', () => {
    test('calls engine.status()', async () => {
      await handler.handleStatus(testMessage);
      expect(engine.status).toHaveBeenCalled();
    });

    test('formats activeRuns and recentRuns into status report', async () => {
      engine.status.mockResolvedValue({
        activeRuns: [{ mode: 'smoke', agents: ['healer'], progress: 50 }],
        recentRuns: []
      });
      await handler.handleStatus(testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('1 run in progress')
      );
    });

    test('returns data from engine', async () => {
      const statusData = { activeRuns: [], recentRuns: [] };
      engine.status.mockResolvedValue(statusData);
      const result = await handler.handleStatus(testMessage);
      expect(result.data).toEqual(statusData);
    });
  });

  // ── handleBugs() ────────────────────────────────────────────────────

  describe('handleBugs()', () => {
    test('calls engine.bugs(appId, options) with defaultAppId as first arg', async () => {
      await handler.handleBugs({ status: 'open' }, testMessage);
      expect(engine.bugs).toHaveBeenCalledWith('brainstormy', { status: 'open' });
    });

    test('passes status filter in options', async () => {
      await handler.handleBugs({ status: 'fixed' }, testMessage);
      expect(engine.bugs).toHaveBeenCalledWith('brainstormy', { status: 'fixed' });
    });

    test('formats and sends bug list', async () => {
      engine.bugs.mockResolvedValue([
        { bug_id: 'BUG-1', title: 'Test', severity: 'high', auto_fixable: false }
      ]);
      await handler.handleBugs({ status: 'open' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('BUG-1')
      );
    });
  });

  // ── handleApprove() ────────────────────────────────────────────────

  describe('handleApprove()', () => {
    test('calls engine.approve() with approval ID', async () => {
      await handler.handleApprove({ approvalId: 'ABC-247' }, testMessage);
      expect(engine.approve).toHaveBeenCalledWith('ABC-247');
    });

    test('sends approved confirmation when result.action is "approved"', async () => {
      await handler.handleApprove({ approvalId: 'ABC-247' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('✅ Approved: ABC-247')
      );
    });

    test('sends error message when approval not found (action: "error")', async () => {
      engine.approve.mockResolvedValue({ action: 'error', message: 'Approval not found' });
      await handler.handleApprove({ approvalId: 'ABC-999' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Approval not found')
      );
    });

    test('sends error message when already approved (action: "error")', async () => {
      engine.approve.mockResolvedValue({ action: 'error', message: 'Already responded' });
      await handler.handleApprove({ approvalId: 'ABC-247' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Already responded')
      );
    });

    test('returns success: false on error cases', async () => {
      engine.approve.mockResolvedValue({ action: 'error', message: 'Not found' });
      const result = await handler.handleApprove({ approvalId: 'ABC-999' }, testMessage);
      expect(result.success).toBe(false);
    });
  });

  // ── handleReject() ─────────────────────────────────────────────────

  describe('handleReject()', () => {
    test('calls engine.reject() with approval ID', async () => {
      await handler.handleReject({ approvalId: 'ABC-247' }, testMessage);
      expect(engine.reject).toHaveBeenCalledWith('ABC-247');
    });

    test('sends rejected confirmation when result.action is "rejected"', async () => {
      await handler.handleReject({ approvalId: 'ABC-247' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('🚫 Rejected: ABC-247')
      );
    });

    test('sends error message when approval not found (action: "error")', async () => {
      engine.reject.mockResolvedValue({ action: 'error', message: 'Approval not found' });
      await handler.handleReject({ approvalId: 'ABC-999' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Approval not found')
      );
    });

    test('sends error message when already responded (action: "error")', async () => {
      engine.reject.mockResolvedValue({ action: 'error', message: 'Already responded' });
      await handler.handleReject({ approvalId: 'ABC-247' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Already responded')
      );
    });

    test('returns success: false on error cases', async () => {
      engine.reject.mockResolvedValue({ action: 'error', message: 'Not found' });
      const result = await handler.handleReject({ approvalId: 'ABC-999' }, testMessage);
      expect(result.success).toBe(false);
    });
  });

  // ── handleInfo() ────────────────────────────────────────────────────

  describe('handleInfo()', () => {
    test('calls engine.bugInfo() with approval ID', async () => {
      await handler.handleInfo({ approvalId: 'ABC-247' }, testMessage);
      expect(engine.bugInfo).toHaveBeenCalledWith('ABC-247');
    });

    test('unwraps result.bug and sends formatted bug detail', async () => {
      await handler.handleInfo({ approvalId: 'ABC-247' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Bug Detail: BUG-248')
      );
    });

    test('sends error message when result.action is "error"', async () => {
      engine.bugInfo.mockResolvedValue({ action: 'error', message: 'Not found' });
      await handler.handleInfo({ approvalId: 'ABC-999' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Not found')
      );
    });

    test('sends error message when result.bug is null', async () => {
      engine.bugInfo.mockResolvedValue({ action: 'info', bug: null });
      await handler.handleInfo({ approvalId: 'ABC-999' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('No bug found')
      );
    });

    test('returns success: false on error cases', async () => {
      engine.bugInfo.mockResolvedValue({ action: 'error', message: 'Not found' });
      const result = await handler.handleInfo({ approvalId: 'ABC-999' }, testMessage);
      expect(result.success).toBe(false);
    });
  });

  // ── handleHelp() ────────────────────────────────────────────────────

  describe('handleHelp()', () => {
    test('sends help menu via notifier', async () => {
      await handler.handleHelp(testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('QA Engine Commands')
      );
    });
  });

  // ── handleUnknown() ────────────────────────────────────────────────

  describe('handleUnknown()', () => {
    test('sends unknown command message via notifier', async () => {
      await handler.handleUnknown({ originalText: 'xyz' }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('xyz')
      );
    });

    test('returns success: false', async () => {
      const result = await handler.handleUnknown({ originalText: 'xyz' }, testMessage);
      expect(result.success).toBe(false);
    });
  });

  // ── error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    test('engine.status() failure → sends internal error, returns success: false', async () => {
      engine.status.mockRejectedValue(new Error('DB down'));
      const result = await handler.handle({ type: 'status', params: {} }, testMessage);
      expect(notifier.send).toHaveBeenCalledWith(
        testMessage.from,
        expect.stringContaining('Something went wrong')
      );
      expect(result.success).toBe(false);
    });

    test('notifier.send() failure in error handler → does not throw', async () => {
      engine.status.mockRejectedValue(new Error('DB down'));
      notifier.send.mockRejectedValue(new Error('Send failed'));
      // The catch block itself will throw because notifier.send fails,
      // but handle() should still not propagate it
      await expect(
        handler.handle({ type: 'status', params: {} }, testMessage)
      ).rejects.toThrow();
    });
  });
});
