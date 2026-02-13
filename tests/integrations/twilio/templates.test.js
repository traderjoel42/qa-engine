'use strict';

const {
  SEVERITY_EMOJI,
  STATUS_EMOJI,
  approvalRequestMessage,
  testRunSummaryMessage,
  fixResultMessage,
  bugInfoMessage
} = require('../../../core/integrations/twilio/templates');

describe('Message Templates', () => {
  describe('approvalRequestMessage', () => {
    const defaultBug = {
      title: 'Login button broken',
      bug_id: 'BUG-042',
      severity: 'high',
      affected_component: 'Auth module',
      root_cause: 'CSS selector changed',
      fix_approach: 'Update selector',
      external_issue_url: 'https://linear.app/issue/ENG-42'
    };

    it('includes severity emoji', () => {
      const result = approvalRequestMessage({ bug: defaultBug, approvalId: 'ABC-042' });
      expect(result).toContain(SEVERITY_EMOJI.high);
    });

    it('includes bug title and bug_id', () => {
      const result = approvalRequestMessage({ bug: defaultBug, approvalId: 'ABC-042' });
      expect(result).toContain('Login button broken');
      expect(result).toContain('BUG-042');
    });

    it('includes YES/NO/INFO with approval ID', () => {
      const result = approvalRequestMessage({ bug: defaultBug, approvalId: 'ABC-042' });
      expect(result).toContain('YES-ABC-042');
      expect(result).toContain('NO-ABC-042');
      expect(result).toContain('INFO-ABC-042');
    });

    it('includes external issue URL when present', () => {
      const result = approvalRequestMessage({ bug: defaultBug, approvalId: 'ABC-042' });
      expect(result).toContain('https://linear.app/issue/ENG-42');
    });

    it('omits external issue URL when absent', () => {
      const bug = { ...defaultBug, external_issue_url: null };
      const result = approvalRequestMessage({ bug, approvalId: 'ABC-042' });
      expect(result).not.toContain('Details:');
    });

    it('includes root cause and affected component', () => {
      const result = approvalRequestMessage({ bug: defaultBug, approvalId: 'ABC-042' });
      expect(result).toContain('CSS selector changed');
      expect(result).toContain('Auth module');
    });
  });

  describe('testRunSummaryMessage', () => {
    it('shows passed emoji when no failures', () => {
      const result = testRunSummaryMessage({
        appName: 'TestApp',
        summary: { total: 10, passed: 10, failed: 0, pass_rate: 100, duration_ms: 5000 }
      });
      expect(result).toContain(STATUS_EMOJI.passed);
    });

    it('shows failed emoji when failures exist', () => {
      const result = testRunSummaryMessage({
        appName: 'TestApp',
        summary: { total: 10, passed: 8, failed: 2, pass_rate: 80, duration_ms: 5000 }
      });
      expect(result).toContain(STATUS_EMOJI.failed);
    });

    it('includes all summary fields', () => {
      const result = testRunSummaryMessage({
        appName: 'Brainstormy',
        summary: { total: 50, passed: 45, failed: 5, pass_rate: 90, duration_ms: 12500 }
      });
      expect(result).toContain('Brainstormy');
      expect(result).toContain('Total: 50');
      expect(result).toContain('Passed: 45');
      expect(result).toContain('Failed: 5');
      expect(result).toContain('Pass Rate: 90.0%');
      expect(result).toContain('Duration: 12.5s');
    });

    it('includes bug count when bugs_created > 0', () => {
      const result = testRunSummaryMessage({
        appName: 'App',
        summary: { total: 10, passed: 8, failed: 2, pass_rate: 80, duration_ms: 1000, bugs_created: 3 }
      });
      expect(result).toContain('3 bug(s) created');
    });

    it('omits bug line when bugs_created is 0', () => {
      const result = testRunSummaryMessage({
        appName: 'App',
        summary: { total: 10, passed: 10, failed: 0, pass_rate: 100, duration_ms: 1000, bugs_created: 0 }
      });
      expect(result).not.toContain('bug(s) created');
    });
  });

  describe('fixResultMessage', () => {
    const bug = { title: 'Broken login', bug_id: 'BUG-001', external_issue_url: 'https://linear.app/ENG-1' };

    it('success case includes check emoji and verification message', () => {
      const result = fixResultMessage({ bug, success: true });
      expect(result).toContain('\u2705');
      expect(result).toContain('Bug Fixed');
      expect(result).toContain('verified and applied successfully');
    });

    it('failure case includes X emoji and error message', () => {
      const result = fixResultMessage({ bug, success: false, error: 'Compilation failed' });
      expect(result).toContain('\u274C');
      expect(result).toContain('Auto-Fix Failed');
      expect(result).toContain('Compilation failed');
    });

    it('failure case includes external issue URL when present', () => {
      const result = fixResultMessage({ bug, success: false, error: 'error' });
      expect(result).toContain('https://linear.app/ENG-1');
    });
  });

  describe('bugInfoMessage', () => {
    const bug = {
      title: 'Memory leak in worker',
      bug_id: 'BUG-007',
      severity: 'critical',
      category: 'memory',
      status: 'open',
      root_cause: 'Unbounded cache growth',
      affected_component: 'Worker pool',
      likely_location: 'src/workers/pool.js',
      fix_approach: 'Add LRU eviction',
      auto_fixable: true,
      external_issue_url: 'https://linear.app/ENG-7'
    };

    it('includes all bug fields', () => {
      const result = bugInfoMessage({ bug });
      expect(result).toContain('BUG-007');
      expect(result).toContain('Memory leak in worker');
      expect(result).toContain('memory');
      expect(result).toContain('open');
      expect(result).toContain('Unbounded cache growth');
      expect(result).toContain('Worker pool');
      expect(result).toContain('src/workers/pool.js');
      expect(result).toContain('Add LRU eviction');
      expect(result).toContain('Auto-fixable: Yes');
    });

    it('uses correct severity emoji', () => {
      const result = bugInfoMessage({ bug });
      expect(result).toContain(SEVERITY_EMOJI.critical);
    });

    it('handles missing optional fields gracefully', () => {
      const minBug = {
        title: 'Simple bug',
        bug_id: 'BUG-001',
        severity: 'low',
        category: 'ui',
        status: 'open',
        auto_fixable: false
      };
      const result = bugInfoMessage({ bug: minBug });
      expect(result).toContain('Root Cause: Unknown');
      expect(result).toContain('Component: Unknown');
      expect(result).toContain('Location: Unknown');
      expect(result).toContain('Fix Approach: N/A');
      expect(result).toContain('Auto-fixable: No');
      expect(result).not.toContain('Linear:');
    });
  });
});
