'use strict';

const NotificationTemplates = require('../../interfaces/whatsapp-bot/notification-templates');

describe('NotificationTemplates', () => {

  // ── runAcknowledgment() ─────────────────────────────────────────────

  describe('runAcknowledgment()', () => {
    test('includes mode label when mode provided', () => {
      const result = NotificationTemplates.runAcknowledgment({
        mode: 'smoke', agents: [], appId: 'brainstormy'
      });
      expect(result).toContain('smoke tests');
    });

    test('says "all tests" when mode is null', () => {
      const result = NotificationTemplates.runAcknowledgment({
        mode: null, agents: [], appId: 'brainstormy'
      });
      expect(result).toContain('all tests');
    });

    test('lists specific agent names when provided', () => {
      const result = NotificationTemplates.runAcknowledgment({
        mode: null, agents: ['healer', 'sentinel'], appId: 'brainstormy'
      });
      expect(result).toContain('Healer, Sentinel');
    });

    test('says "all enabled agents" when agents empty', () => {
      const result = NotificationTemplates.runAcknowledgment({
        mode: null, agents: [], appId: 'brainstormy'
      });
      expect(result).toContain('all enabled agents');
    });

    test('includes app ID', () => {
      const result = NotificationTemplates.runAcknowledgment({
        mode: null, agents: [], appId: 'brainstormy'
      });
      expect(result).toContain('App: brainstormy');
    });
  });

  // ── runComplete() ───────────────────────────────────────────────────

  describe('runComplete()', () => {
    test('✅ icon when all passed', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 15, failed: 0, agents: [], durationMs: 60000, bugsCreated: 0
      });
      expect(result).toContain('✅');
    });

    test('❌ icon when failures exist', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 12, failed: 3, agents: [], durationMs: 60000, bugsCreated: 3
      });
      expect(result).toContain('❌');
    });

    test('includes pass/total counts', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 12, failed: 3, agents: [], durationMs: 60000, bugsCreated: 3
      });
      expect(result).toContain('12/15 tests passed');
    });

    test('includes per-agent breakdown', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 15, failed: 0,
        agents: [
          { name: 'Healer', passed: 8, total: 8, failed: 0 },
          { name: 'Sentinel', passed: 7, total: 7, failed: 0 }
        ],
        durationMs: 60000, bugsCreated: 0
      });
      expect(result).toContain('Healer (8/8 ✅)');
      expect(result).toContain('Sentinel (7/7 ✅)');
    });

    test('formats duration correctly', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 15, failed: 0, agents: [], durationMs: 222000, bugsCreated: 0
      });
      expect(result).toContain('Duration: 3m 42s');
    });

    test('shows bug count when bugs detected', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 12, failed: 3, agents: [], durationMs: 60000, bugsCreated: 3
      });
      expect(result).toContain('🐛 3 bugs detected.');
    });

    test('says "No bugs detected" when none', () => {
      const result = NotificationTemplates.runComplete({
        totalTests: 15, passed: 15, failed: 0, agents: [], durationMs: 60000, bugsCreated: 0
      });
      expect(result).toContain('No bugs detected.');
    });
  });

  // ── statusReport() ─────────────────────────────────────────────────

  describe('statusReport()', () => {
    test('shows "No runs in progress" when no active runs', () => {
      const result = NotificationTemplates.statusReport({
        activeRuns: [], recentRuns: []
      });
      expect(result).toContain('No runs in progress');
    });

    test('shows active run count and details', () => {
      const result = NotificationTemplates.statusReport({
        activeRuns: [
          { mode: 'smoke', agents: ['healer', 'sentinel'], progress: 67 }
        ],
        recentRuns: []
      });
      expect(result).toContain('1 run in progress');
      expect(result).toContain('smoke');
      expect(result).toContain('67% complete');
    });

    test('shows recent runs with icons', () => {
      const result = NotificationTemplates.statusReport({
        activeRuns: [],
        recentRuns: [
          { failed: 0, completed_at: '2026-02-12T20:00:00Z', mode: 'Full', passed: 15, total: 15 },
          { failed: 3, completed_at: '2026-02-12T14:00:00Z', mode: 'Smoke', passed: 12, total: 15 }
        ]
      });
      expect(result).toContain('✅');
      expect(result).toContain('❌');
      expect(result).toContain('15/15 passed');
      expect(result).toContain('12/15 passed');
    });

    test('handles empty recent runs', () => {
      const result = NotificationTemplates.statusReport({
        activeRuns: [], recentRuns: []
      });
      expect(result).not.toContain('Recent runs');
    });
  });

  // ── bugsList() ──────────────────────────────────────────────────────

  describe('bugsList()', () => {
    test('shows "No bugs found" when empty', () => {
      const result = NotificationTemplates.bugsList([], 'open');
      expect(result).toContain('No open bugs found.');
    });

    test('formats bug entries with severity and status', () => {
      const result = NotificationTemplates.bugsList([
        { bug_id: 'BUG-248', title: 'Memory recall failed', severity: 'medium', auto_fixable: true, approval_status: 'pending' }
      ], 'open');
      expect(result).toContain('BUG-248: Memory recall failed');
      expect(result).toContain('Severity: medium');
      expect(result).toContain('fix pending approval');
    });

    test('truncates at 10 bugs', () => {
      const bugs = Array.from({ length: 12 }, (_, i) => ({
        bug_id: `BUG-${i}`, title: `Bug ${i}`, severity: 'low', auto_fixable: false
      }));
      const result = NotificationTemplates.bugsList(bugs, 'all');
      // Should contain bug 0-9 but not 10 and 11 as entries
      expect(result).toContain('BUG-9');
      expect(result).not.toContain('BUG-10:');
    });

    test('shows overflow count when > 10 bugs', () => {
      const bugs = Array.from({ length: 12 }, (_, i) => ({
        bug_id: `BUG-${i}`, title: `Bug ${i}`, severity: 'low', auto_fixable: false
      }));
      const result = NotificationTemplates.bugsList(bugs, 'all');
      expect(result).toContain('... and 2 more');
    });

    test('includes filter label in header', () => {
      const result = NotificationTemplates.bugsList([
        { bug_id: 'BUG-1', title: 'Test', severity: 'low', auto_fixable: false }
      ], 'open');
      expect(result).toContain('Open Bugs');
    });
  });

  // ── approvalRequest() ──────────────────────────────────────────────

  describe('approvalRequest()', () => {
    const bug = {
      bug_id: 'BUG-248',
      title: 'Memory recall failed',
      severity: 'medium',
      detected_by: 'sentinel',
      root_cause: 'Search query not matching',
      approval_id: 'ABC-248'
    };

    test('includes bug ID and title', () => {
      const result = NotificationTemplates.approvalRequest(bug);
      expect(result).toContain('BUG-248: Memory recall failed');
    });

    test('includes YES/NO/INFO options with approval ID', () => {
      const result = NotificationTemplates.approvalRequest(bug);
      expect(result).toContain('YES-ABC-248');
      expect(result).toContain('NO-ABC-248');
      expect(result).toContain('INFO-ABC-248');
    });

    test('includes severity and agent', () => {
      const result = NotificationTemplates.approvalRequest(bug);
      expect(result).toContain('Severity: medium');
      expect(result).toContain('Agent: sentinel');
    });
  });

  // ── approvalConfirmation() ─────────────────────────────────────────

  describe('approvalConfirmation()', () => {
    test('approved → ✅ message with fix in progress', () => {
      const result = NotificationTemplates.approvalConfirmation('ABC-248', 'approved');
      expect(result).toContain('✅ Approved: ABC-248');
      expect(result).toContain('Generating and applying fix');
    });

    test('rejected → 🚫 message with manual fix note', () => {
      const result = NotificationTemplates.approvalConfirmation('ABC-248', 'rejected');
      expect(result).toContain('🚫 Rejected: ABC-248');
      expect(result).toContain('needs-manual-fix');
    });
  });

  // ── bugDetail() ─────────────────────────────────────────────────────

  describe('bugDetail()', () => {
    const baseBug = {
      bug_id: 'BUG-248',
      title: 'Memory recall failed',
      severity: 'medium',
      category: 'memory',
      detected_by: 'sentinel',
      created_at: '2026-02-12T14:15:00Z',
      root_cause: 'Search query not matching',
      affected_component: 'services/semantic-search.js',
      fix_approach: 'Update query weighting'
    };

    test('includes all bug fields', () => {
      const result = NotificationTemplates.bugDetail(baseBug);
      expect(result).toContain('BUG-248');
      expect(result).toContain('Memory recall failed');
      expect(result).toContain('medium');
      expect(result).toContain('memory');
      expect(result).toContain('sentinel');
      expect(result).toContain('Search query not matching');
      expect(result).toContain('services/semantic-search.js');
      expect(result).toContain('Update query weighting');
    });

    test('includes evidence summary', () => {
      const bug = {
        ...baseBug,
        evidence: {
          screenshots: ['shot1.png'],
          console_logs: [
            { level: 'error', message: 'fail' },
            { level: 'info', message: 'ok' }
          ],
          network_requests: [
            { url: '/api', failed: true },
            { url: '/api2', failed: false }
          ]
        }
      };
      const result = NotificationTemplates.bugDetail(bug);
      expect(result).toContain('Screenshots: 1');
      expect(result).toContain('Console errors: 1');
      expect(result).toContain('Network failures: 1');
    });

    test('includes Linear link when available', () => {
      const bug = { ...baseBug, external_issue_url: 'https://linear.app/LIN-248' };
      const result = NotificationTemplates.bugDetail(bug);
      expect(result).toContain('Linear: https://linear.app/LIN-248');
    });

    test('handles missing optional fields', () => {
      const result = NotificationTemplates.bugDetail(baseBug);
      expect(result).not.toContain('Linear:');
      expect(result).not.toContain('Evidence:');
    });
  });

  // ── helpMenu() ──────────────────────────────────────────────────────

  describe('helpMenu()', () => {
    test('includes all command categories', () => {
      const result = NotificationTemplates.helpMenu();
      expect(result).toContain('Run tests:');
      expect(result).toContain('Check status:');
      expect(result).toContain('Approvals:');
    });

    test('includes approval syntax examples', () => {
      const result = NotificationTemplates.helpMenu();
      expect(result).toContain('YES-ABC-247');
      expect(result).toContain('NO-ABC-247');
      expect(result).toContain('INFO-ABC-247');
    });
  });

  // ── unknownCommand() ────────────────────────────────────────────────

  describe('unknownCommand()', () => {
    test('includes truncated original text', () => {
      const result = NotificationTemplates.unknownCommand('hello there');
      expect(result).toContain('hello there');
    });

    test('truncates long messages at 30 chars', () => {
      const longText = 'a'.repeat(50);
      const result = NotificationTemplates.unknownCommand(longText);
      expect(result).toContain('a'.repeat(30) + '...');
      expect(result).not.toContain('a'.repeat(50));
    });

    test('suggests help command', () => {
      const result = NotificationTemplates.unknownCommand('xyz');
      expect(result).toContain('Send "help"');
    });
  });

  // ── utility methods ─────────────────────────────────────────────────

  describe('utility methods', () => {
    test('_formatDuration — seconds only', () => {
      expect(NotificationTemplates._formatDuration(5000)).toBe('5s');
    });

    test('_formatDuration — minutes and seconds', () => {
      expect(NotificationTemplates._formatDuration(222000)).toBe('3m 42s');
    });

    test('_formatDuration — handles 0 and negative', () => {
      expect(NotificationTemplates._formatDuration(0)).toBe('0s');
      expect(NotificationTemplates._formatDuration(-1000)).toBe('0s');
    });

    test('_formatTime — formats Date object', () => {
      const date = new Date('2026-02-12T14:15:00Z');
      const result = NotificationTemplates._formatTime(date);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('unknown');
    });

    test('_formatTime — formats ISO string', () => {
      const result = NotificationTemplates._formatTime('2026-02-12T14:15:00Z');
      expect(typeof result).toBe('string');
      expect(result).not.toBe('unknown');
    });

    test('_formatTime — handles null', () => {
      expect(NotificationTemplates._formatTime(null)).toBe('unknown');
    });
  });
});
