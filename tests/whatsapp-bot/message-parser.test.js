'use strict';

const MessageParser = require('../../interfaces/whatsapp-bot/message-parser');

describe('MessageParser', () => {
  let parser;

  beforeEach(() => {
    parser = new MessageParser();
  });

  // ── parse() — routing priority ──────────────────────────────────────

  describe('parse() — routing priority', () => {
    test('empty string → unknown', () => {
      expect(parser.parse('')).toEqual({ type: 'unknown', params: { originalText: '' } });
    });

    test('null → unknown', () => {
      expect(parser.parse(null)).toEqual({ type: 'unknown', params: { originalText: '' } });
    });

    test('whitespace only → unknown', () => {
      expect(parser.parse('   ')).toEqual({ type: 'unknown', params: { originalText: '' } });
    });

    test('approval response checked before run command', () => {
      // "YES-ABC-247" could theoretically match something else, but approval takes priority
      const result = parser.parse('YES-ABC-247');
      expect(result.type).toBe('approve');
    });

    test('help checked before run command', () => {
      // "help" is checked before run
      const result = parser.parse('help');
      expect(result.type).toBe('help');
    });
  });

  // ── parseApprovalResponse() ─────────────────────────────────────────

  describe('parseApprovalResponse()', () => {
    test('YES-ABC-247 → approve with approvalId ABC-247', () => {
      const result = parser.parseApprovalResponse('YES-ABC-247');
      expect(result).toEqual({ action: 'YES', approvalId: 'ABC-247' });
    });

    test('NO-ABC-247 → reject with approvalId ABC-247', () => {
      const result = parser.parseApprovalResponse('NO-ABC-247');
      expect(result).toEqual({ action: 'NO', approvalId: 'ABC-247' });
    });

    test('INFO-ABC-247 → info with approvalId ABC-247', () => {
      const result = parser.parseApprovalResponse('INFO-ABC-247');
      expect(result).toEqual({ action: 'INFO', approvalId: 'ABC-247' });
    });

    test('yes-abc-247 → case-insensitive match, approvalId uppercased', () => {
      const result = parser.parseApprovalResponse('yes-abc-247');
      expect(result).toEqual({ action: 'YES', approvalId: 'ABC-247' });
    });

    test('YES-XYZ-1 → single digit ID', () => {
      const result = parser.parseApprovalResponse('YES-XYZ-1');
      expect(result).toEqual({ action: 'YES', approvalId: 'XYZ-1' });
    });

    test('YES-ABC-12345 → multi-digit ID', () => {
      const result = parser.parseApprovalResponse('YES-ABC-12345');
      expect(result).toEqual({ action: 'YES', approvalId: 'ABC-12345' });
    });

    test('YES-ABC → missing number, returns null', () => {
      expect(parser.parseApprovalResponse('YES-ABC')).toBeNull();
    });

    test('YES-AB-247 → only 2 letters, returns null', () => {
      expect(parser.parseApprovalResponse('YES-AB-247')).toBeNull();
    });

    test('YES-ABCD-247 → 4 letters, returns null', () => {
      expect(parser.parseApprovalResponse('YES-ABCD-247')).toBeNull();
    });

    test('YESABC247 → no dashes, returns null', () => {
      expect(parser.parseApprovalResponse('YESABC247')).toBeNull();
    });

    test('YES- → incomplete, returns null', () => {
      expect(parser.parseApprovalResponse('YES-')).toBeNull();
    });

    test('MAYBE-ABC-247 → unknown action, returns null', () => {
      expect(parser.parseApprovalResponse('MAYBE-ABC-247')).toBeNull();
    });
  });

  // ── parseRunCommand() ───────────────────────────────────────────────

  describe('parseRunCommand()', () => {
    test('run → mode null, agents empty', () => {
      const result = parser.parseRunCommand('run');
      expect(result).toEqual({ mode: null, agents: [] });
    });

    test('Run → case-insensitive', () => {
      const result = parser.parseRunCommand('Run');
      expect(result).toEqual({ mode: null, agents: [] });
    });

    test('test → alias for run', () => {
      const result = parser.parseRunCommand('test');
      expect(result).toEqual({ mode: null, agents: [] });
    });

    test('run smoke → mode smoke', () => {
      const result = parser.parseRunCommand('run smoke');
      expect(result).toEqual({ mode: 'smoke', agents: [] });
    });

    test('run smoke tests → mode smoke, strips "tests"', () => {
      const result = parser.parseRunCommand('run smoke tests');
      expect(result).toEqual({ mode: 'smoke', agents: [] });
    });

    test('run full → mode full', () => {
      const result = parser.parseRunCommand('run full');
      expect(result).toEqual({ mode: 'full', agents: [] });
    });

    test('run regression → mode regression', () => {
      const result = parser.parseRunCommand('run regression');
      expect(result).toEqual({ mode: 'regression', agents: [] });
    });

    test('run healer → agents [healer]', () => {
      const result = parser.parseRunCommand('run healer');
      expect(result).toEqual({ mode: null, agents: ['healer'] });
    });

    test('run sentinel → agents [sentinel]', () => {
      const result = parser.parseRunCommand('run sentinel');
      expect(result).toEqual({ mode: null, agents: ['sentinel'] });
    });

    test('run healer sentinel → agents [healer, sentinel]', () => {
      const result = parser.parseRunCommand('run healer sentinel');
      expect(result).toEqual({ mode: null, agents: ['healer', 'sentinel'] });
    });

    test('run smoke healer → mode smoke, agents [healer]', () => {
      const result = parser.parseRunCommand('run smoke healer');
      expect(result).toEqual({ mode: 'smoke', agents: ['healer'] });
    });

    test('test regression librarian → mode regression, agents [librarian]', () => {
      const result = parser.parseRunCommand('test regression librarian');
      expect(result).toEqual({ mode: 'regression', agents: ['librarian'] });
    });

    test('run unknown_thing → ignores unrecognized args', () => {
      const result = parser.parseRunCommand('run unknown_thing');
      expect(result).toEqual({ mode: null, agents: [] });
    });

    test('running → does not match (not exact prefix)', () => {
      const result = parser.parseRunCommand('running');
      expect(result).toBeNull();
    });

    test('run → trailing space handled', () => {
      const result = parser.parseRunCommand('run ');
      expect(result).toEqual({ mode: null, agents: [] });
    });
  });

  // ── isStatusQuery() ─────────────────────────────────────────────────

  describe('isStatusQuery()', () => {
    test('status → true', () => {
      expect(parser.isStatusQuery('status')).toBe(true);
    });

    test('Status → case-insensitive', () => {
      expect(parser.isStatusQuery('Status')).toBe(true);
    });

    test("what's running → true", () => {
      expect(parser.isStatusQuery("what's running")).toBe(true);
    });

    test('whats running → true (without apostrophe)', () => {
      expect(parser.isStatusQuery('whats running')).toBe(true);
    });

    test("what's running? → true (with question mark)", () => {
      expect(parser.isStatusQuery("what's running?")).toBe(true);
    });

    test('progress → true', () => {
      expect(parser.isStatusQuery('progress')).toBe(true);
    });

    test('status update → false (extra words)', () => {
      expect(parser.isStatusQuery('status update')).toBe(false);
    });
  });

  // ── parseBugsQuery() ────────────────────────────────────────────────

  describe('parseBugsQuery()', () => {
    test('bugs → status open (default)', () => {
      expect(parser.parseBugsQuery('bugs')).toEqual({ status: 'open' });
    });

    test('open bugs → status open', () => {
      expect(parser.parseBugsQuery('open bugs')).toEqual({ status: 'open' });
    });

    test('fixed bugs → status fixed', () => {
      expect(parser.parseBugsQuery('fixed bugs')).toEqual({ status: 'fixed' });
    });

    test('all bugs → status all', () => {
      expect(parser.parseBugsQuery('all bugs')).toEqual({ status: 'all' });
    });

    test('what failed → status open', () => {
      expect(parser.parseBugsQuery('what failed')).toEqual({ status: 'open' });
    });

    test('what failed? → status open (with question mark)', () => {
      expect(parser.parseBugsQuery('what failed?')).toEqual({ status: 'open' });
    });

    test('Bugs → case-insensitive', () => {
      expect(parser.parseBugsQuery('Bugs')).toEqual({ status: 'open' });
    });

    test('my bugs → null (unrecognized prefix)', () => {
      expect(parser.parseBugsQuery('my bugs')).toBeNull();
    });
  });

  // ── isHelpRequest() ─────────────────────────────────────────────────

  describe('isHelpRequest()', () => {
    test('help → true', () => {
      expect(parser.isHelpRequest('help')).toBe(true);
    });

    test('commands → true', () => {
      expect(parser.isHelpRequest('commands')).toBe(true);
    });

    test('? → true', () => {
      expect(parser.isHelpRequest('?')).toBe(true);
    });

    test('menu → true', () => {
      expect(parser.isHelpRequest('menu')).toBe(true);
    });

    test('Help → case-insensitive', () => {
      expect(parser.isHelpRequest('Help')).toBe(true);
    });

    test('help me → false (extra words)', () => {
      expect(parser.isHelpRequest('help me')).toBe(false);
    });
  });

  // ── parse() — full integration ──────────────────────────────────────

  describe('parse() — full integration', () => {
    test('YES-ABC-247 → {type: approve, params: {approvalId: ABC-247}}', () => {
      expect(parser.parse('YES-ABC-247')).toEqual({
        type: 'approve',
        params: { approvalId: 'ABC-247' }
      });
    });

    test('run smoke → {type: run, params: {mode: smoke, agents: []}}', () => {
      expect(parser.parse('run smoke')).toEqual({
        type: 'run',
        params: { mode: 'smoke', agents: [] }
      });
    });

    test('bugs → {type: bugs, params: {status: open}}', () => {
      expect(parser.parse('bugs')).toEqual({
        type: 'bugs',
        params: { status: 'open' }
      });
    });

    test('status → {type: status, params: {}}', () => {
      expect(parser.parse('status')).toEqual({
        type: 'status',
        params: {}
      });
    });

    test('help → {type: help, params: {}}', () => {
      expect(parser.parse('help')).toEqual({
        type: 'help',
        params: {}
      });
    });

    test('hello there → {type: unknown, params: {originalText: "hello there"}}', () => {
      expect(parser.parse('hello there')).toEqual({
        type: 'unknown',
        params: { originalText: 'hello there' }
      });
    });
  });
});
