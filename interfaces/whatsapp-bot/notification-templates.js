'use strict';

class NotificationTemplates {
  static runAcknowledgment({ mode, agents, appId }) {
    const modeLabel = mode ? `${mode} tests` : 'all tests';
    const agentLabel = agents.length > 0
      ? agents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
      : 'all enabled agents';

    return [
      `🚀 Starting ${modeLabel}...`,
      `Agents: ${agentLabel}`,
      `App: ${appId}`,
      '',
      "I'll notify you when results are ready."
    ].join('\n');
  }

  static runComplete(summary) {
    const { totalTests, passed, failed, agents, durationMs, bugsCreated } = summary;
    const icon = failed === 0 ? '✅' : '❌';
    const duration = NotificationTemplates._formatDuration(durationMs);

    const lines = [
      `${icon} Test Run Complete`,
      '',
      `${passed}/${totalTests} tests passed${failed > 0 ? `, ${failed} failed` : ''}`,
    ];

    if (agents && agents.length > 0) {
      const agentSummaries = agents.map(a => {
        const agentIcon = a.failed === 0 ? '✅' : '❌';
        return `${a.name} (${a.passed}/${a.total} ${agentIcon})`;
      });
      lines.push(`Agents: ${agentSummaries.join(', ')}`);
    }

    lines.push(`Duration: ${duration}`);

    if (failed === 0) {
      lines.push('', 'No bugs detected.');
    } else if (bugsCreated > 0) {
      lines.push('', `🐛 ${bugsCreated} bug${bugsCreated !== 1 ? 's' : ''} detected.`);
    }

    return lines.join('\n');
  }

  static statusReport({ activeRuns, recentRuns }) {
    const lines = ['📊 QA Engine Status', ''];

    if (activeRuns.length === 0) {
      lines.push('Active: No runs in progress');
    } else {
      lines.push(`Active: ${activeRuns.length} run${activeRuns.length !== 1 ? 's' : ''} in progress`);
      for (const run of activeRuns) {
        const progress = run.progress ? ` — ${run.progress}% complete` : '';
        lines.push(`  └ ${run.mode || 'Full'} (${run.agents.join(', ')})${progress}`);
      }
    }

    if (recentRuns.length > 0) {
      lines.push('', `Recent runs (last 24h):`);
      for (const run of recentRuns) {
        const icon = run.failed === 0 ? '✅' : '❌';
        const time = NotificationTemplates._formatTime(run.completed_at);
        lines.push(`  ${icon} ${time} — ${run.mode || 'Full'} (${run.passed}/${run.total} passed)`);
      }
    }

    return lines.join('\n');
  }

  static bugsList(bugs, filter) {
    if (bugs.length === 0) {
      return `🐛 No ${filter === 'all' ? '' : filter + ' '}bugs found.`;
    }

    const lines = [`🐛 ${filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)} Bugs (${bugs.length})`, ''];

    for (const bug of bugs.slice(0, 10)) { // Max 10 in list
      const statusLabel = bug.auto_fixable
        ? (bug.approval_status === 'pending' ? 'fix pending approval' : `fix ${bug.approval_status}`)
        : 'manual fix needed';
      lines.push(`• ${bug.bug_id}: ${bug.title}`);
      lines.push(`  Severity: ${bug.severity} | ${statusLabel}`);
      lines.push('');
    }

    if (bugs.length > 10) {
      lines.push(`... and ${bugs.length - 10} more. Check Linear for full list.`);
    }

    return lines.join('\n').trim();
  }

  static approvalRequest(bug) {
    return [
      '🔴 Auto-Fix Available',
      '',
      `${bug.bug_id}: ${bug.title}`,
      `Severity: ${bug.severity} | Agent: ${bug.detected_by}`,
      `Root cause: ${bug.root_cause}`,
      '',
      'Approve fix?',
      `  YES-${bug.approval_id}`,
      `  NO-${bug.approval_id}`,
      `  INFO-${bug.approval_id} (details)`
    ].join('\n');
  }

  static approvalConfirmation(approvalId, action) {
    if (action === 'approved') {
      return [
        `✅ Approved: ${approvalId}`,
        '',
        'Generating and applying fix...',
        "I'll notify you when verification completes."
      ].join('\n');
    }

    return [
      `🚫 Rejected: ${approvalId}`,
      '',
      'Bug marked as needs-manual-fix.',
      'Linear issue updated.'
    ].join('\n');
  }

  static bugDetail(bug) {
    const lines = [
      `📋 Bug Detail: ${bug.bug_id}`,
      '',
      `Title: ${bug.title}`,
      `Severity: ${bug.severity}`,
      `Category: ${bug.category}`,
      `Agent: ${bug.detected_by}`,
      `Detected: ${NotificationTemplates._formatTime(bug.created_at)}`,
      '',
      'Root Cause:',
      bug.root_cause,
      '',
      `Affected Component: ${bug.affected_component}`,
      `Likely Fix: ${bug.fix_approach}`,
    ];

    if (bug.evidence) {
      lines.push('', 'Evidence:');
      if (bug.evidence.screenshots && bug.evidence.screenshots.length > 0) {
        lines.push(`• Screenshots: ${bug.evidence.screenshots.length}`);
      }
      // Evidence stores raw arrays — derive counts on the fly
      const consoleErrors = (bug.evidence.console_logs || []).filter(l => l.level === 'error').length;
      const networkFailures = (bug.evidence.network_requests || []).filter(r => r.failed).length;
      lines.push(`• Console errors: ${consoleErrors}`);
      lines.push(`• Network failures: ${networkFailures}`);
    }

    if (bug.external_issue_url) {
      lines.push('', `Linear: ${bug.external_issue_url}`);
    }

    if (bug.approval_id) {
      lines.push(`Status: ${bug.approval_status || 'pending'} (${bug.approval_id})`);
    }

    return lines.join('\n');
  }

  static fixComplete(bug, fix) {
    const icon = fix.verified ? '✅' : '❌';
    const lines = [
      `${icon} Fix ${fix.verified ? 'Verified' : 'Applied'}: ${bug.bug_id}`,
      '',
      bug.title,
      `Fix: ${fix.explanation || 'Applied automated fix'}`,
    ];

    if (fix.verified) {
      lines.push(`Verification: Re-ran failing test → passed`);
      if (fix.regressionPassed) {
        lines.push(`Regression: ${fix.regressionTotal}/${fix.regressionTotal} tests still passing`);
      }
    }

    if (bug.external_issue_url) {
      lines.push('', `Linear issue updated: ${bug.external_issue_id} → Done`);
    }

    return lines.join('\n');
  }

  static fixFailed(bug, reason) {
    return [
      `❌ Fix Failed: ${bug.bug_id}`,
      '',
      bug.title,
      `Reason: ${reason}`,
      'Action: Escalated to manual fix',
      '',
      bug.external_issue_url
        ? `Linear issue updated: ${bug.external_issue_id} → Needs Manual Fix`
        : 'Please fix manually.'
    ].join('\n');
  }

  static helpMenu() {
    return [
      '📖 QA Engine Commands',
      '',
      'Run tests:',
      '  run — run all enabled agents',
      '  run smoke — smoke tests only',
      '  run healer — specific agent',
      '  test regression — regression suite',
      '',
      'Check status:',
      '  status — active and recent runs',
      '  bugs — open bugs',
      '  all bugs — all bugs including fixed',
      '',
      'Approvals:',
      '  YES-ABC-247 — approve auto-fix',
      '  NO-ABC-247 — reject auto-fix',
      '  INFO-ABC-247 — detailed bug info',
      '',
      'help — show this menu'
    ].join('\n');
  }

  static unknownCommand(originalText) {
    const preview = originalText.length > 30
      ? originalText.substring(0, 30) + '...'
      : originalText;
    return [
      `🤔 I didn't understand "${preview}".`,
      '',
      'Send "help" to see available commands.'
    ].join('\n');
  }

  static unauthorized() {
    return '⛔ Unauthorized. This number is not registered with QA Engine.';
  }

  static internalError() {
    return [
      '⚠️ Something went wrong processing your request. Please try again.',
      '',
      'If the issue persists, check the server logs.'
    ].join('\n');
  }

  // --- Private Helpers ---

  static _formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0) return `${remainingSeconds}s`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  static _formatTime(dateOrString) {
    if (!dateOrString) return 'unknown';
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).toLowerCase();
  }
}

module.exports = NotificationTemplates;
