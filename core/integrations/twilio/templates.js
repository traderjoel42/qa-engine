'use strict';

const SEVERITY_EMOJI = {
  critical: '\u{1F534}',
  high: '\u{1F7E0}',
  medium: '\u{1F7E1}',
  low: '\u{1F7E2}'
};

const STATUS_EMOJI = {
  passed: '\u2705',
  failed: '\u274C',
  error: '\u26A0\uFE0F'
};

function approvalRequestMessage({ bug, approvalId }) {
  const emoji = SEVERITY_EMOJI[bug.severity] || '\u26AA';
  return [
    `${emoji} Bug Detected: ${bug.title}`,
    '',
    `ID: ${bug.bug_id}`,
    `Severity: ${bug.severity}`,
    `Component: ${bug.affected_component || 'Unknown'}`,
    `Root Cause: ${bug.root_cause || 'Under analysis'}`,
    '',
    `Fix Approach: ${bug.fix_approach || 'N/A'}`,
    '',
    `Approve auto-fix?`,
    `\u2022 YES-${approvalId}`,
    `\u2022 NO-${approvalId}`,
    `\u2022 INFO-${approvalId}`,
    '',
    bug.external_issue_url ? `Details: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

function testRunSummaryMessage({ appName, summary, testRunId }) {
  const emoji = summary.failed === 0 ? STATUS_EMOJI.passed : STATUS_EMOJI.failed;
  const lines = [
    `${emoji} Test Run Complete: ${appName}`,
    '',
    `Total: ${summary.total_tests || summary.total || 0}`,
    `Passed: ${summary.passed || 0}`,
    `Failed: ${summary.failed || 0}`,
    `Pass Rate: ${(summary.pass_rate || 0).toFixed(1)}%`,
    `Duration: ${((summary.duration_ms || 0) / 1000).toFixed(1)}s`
  ];

  if (summary.bugs_created > 0) {
    lines.push('', `\u{1F41B} ${summary.bugs_created} bug(s) created`);
  }

  return lines.join('\n');
}

function fixResultMessage({ bug, success, error }) {
  if (success) {
    return [
      `\u2705 Bug Fixed: ${bug.title}`,
      '',
      `ID: ${bug.bug_id}`,
      `Fix verified and applied successfully.`
    ].join('\n');
  }

  return [
    `\u274C Auto-Fix Failed: ${bug.title}`,
    '',
    `ID: ${bug.bug_id}`,
    `Error: ${error || 'Unknown error'}`,
    '',
    `Marked as needs-manual-fix.`,
    bug.external_issue_url ? `Details: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

function bugInfoMessage({ bug }) {
  const emoji = SEVERITY_EMOJI[bug.severity] || '\u26AA';
  return [
    `${emoji} ${bug.bug_id}: ${bug.title}`,
    '',
    `Severity: ${bug.severity}`,
    `Category: ${bug.category}`,
    `Status: ${bug.status}`,
    '',
    `Root Cause: ${bug.root_cause || 'Unknown'}`,
    `Component: ${bug.affected_component || 'Unknown'}`,
    `Location: ${bug.likely_location || 'Unknown'}`,
    '',
    `Fix Approach: ${bug.fix_approach || 'N/A'}`,
    `Auto-fixable: ${bug.auto_fixable ? 'Yes' : 'No'}`,
    '',
    bug.external_issue_url ? `Linear: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  SEVERITY_EMOJI,
  STATUS_EMOJI,
  approvalRequestMessage,
  testRunSummaryMessage,
  fixResultMessage,
  bugInfoMessage
};
