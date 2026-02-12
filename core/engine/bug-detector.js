'use strict';

const { BugDetectorError } = require('./errors');

class BugDetector {
  /**
   * @param {Object} options
   * @param {import('../integrations/adapters/llm')} options.llm - LLM adapter for bug analysis
   * @param {import('../integrations/adapters/bug-tracker')} [options.bugTracker] - Bug tracker adapter (default: no-op)
   * @param {import('../integrations/adapters/notification')} [options.notifier] - Notification adapter (default: no-op)
   * @param {Object} [options.storage] - Storage interface { saveBug, updateBug, getNextBugNumber }
   * @param {Object} [options.approvalManager] - Approval manager instance (wired in Days 3-4)
   */
  constructor(options = {}) {
    if (!options.llm) {
      throw new BugDetectorError('BugDetector requires options.llm adapter', {
        phase: 'construction'
      });
    }

    this._llm = options.llm;
    this._bugTracker = options.bugTracker || null;
    this._notifier = options.notifier || null;
    this._approvalManager = options.approvalManager || null;

    // Storage with no-op defaults
    this._storage = options.storage || {
      saveBug: async (bug) => bug,
      updateBug: async (id, updates) => ({ id, ...updates }),
      getNextBugNumber: async () => this._bugCounter
    };

    // In-memory bug ID counter (Phase 1)
    this._bugCounter = 1;
  }

  /**
   * Main pipeline: analyze failure → classify → create issue → maybe trigger approval.
   *
   * @param {Object} app - App configuration
   * @param {string} agentId - Agent that detected the failure
   * @param {Object} failure - Failure data from agent test run (scenario result with error)
   * @returns {Promise<Object>} BugRecord
   */
  async detectAndReport(app, agentId, failure) {
    if (!app) {
      throw new BugDetectorError('detectAndReport requires app config', { phase: 'evidence' });
    }
    if (!agentId) {
      throw new BugDetectorError('detectAndReport requires agentId', { phase: 'evidence' });
    }
    if (!failure) {
      throw new BugDetectorError('detectAndReport requires failure data', { phase: 'evidence' });
    }

    // 1. Gather evidence
    let evidence;
    try {
      evidence = this.gatherEvidence(failure);
    } catch (err) {
      throw new BugDetectorError(`Evidence gathering failed: ${err.message}`, {
        phase: 'evidence',
        details: { originalError: err.message }
      });
    }

    // 2. LLM analysis
    let analysis;
    try {
      analysis = await this.analyzeBug(app, agentId, failure, evidence);
    } catch (err) {
      // Degraded mode — create bug without LLM enrichment
      analysis = {
        root_cause: 'LLM analysis failed',
        affected_component: 'unknown',
        likely_location: 'unknown',
        fix_approach: 'Manual investigation required',
        confidence: 0,
        impact_assessment: 'Unable to assess — LLM analysis failed'
      };
    }

    // 3. Classify
    const classification = this.classifyBug(analysis);

    // 4. Determine auto-fixability
    const autoFixable = this.isAutoFixable(analysis, classification);

    // 5. Create bug record
    const bug = await this.createBugRecord(
      app, agentId, failure, analysis, classification, autoFixable, evidence
    );

    // 6. Create external issue (if bug tracker configured)
    if (this._bugTracker) {
      try {
        const externalIssue = await this.createExternalIssue(app, bug);
        bug.external_issue_id = externalIssue.id;
        bug.external_issue_url = externalIssue.url;
        bug.external_issue_key = externalIssue.key;
        await this._storage.updateBug(bug.id, {
          external_issue_id: externalIssue.id,
          external_issue_url: externalIssue.url
        });
      } catch (err) {
        // Non-fatal: bug is tracked internally even if external creation fails
        bug._issueCreationError = err.message;
      }
    }

    // 7. Initiate approval if auto-fixable and approval manager exists
    if (autoFixable && this._approvalManager) {
      try {
        const approval = await this._approvalManager.requestApproval(app, bug);
        bug.approval_id = approval.approval_id;
      } catch (err) {
        // Non-fatal: bug exists, approval just didn't send
        bug._approvalError = err.message;
      }
    }

    return bug;
  }

  /**
   * Assemble evidence from the failure object.
   * Normalizes the shape regardless of which agent produced the failure.
   */
  gatherEvidence(failure) {
    const evidence = {
      test_id: failure.test_id || failure.scenarioId || null,
      test_name: failure.test_name || failure.scenarioName || failure.name || 'unknown',
      scenario: failure.scenario || failure.scenarioId || null,
      step_failed: failure.step || failure.stepIndex || null,
      error_message: null,
      error_stack: null,
      screenshots: [],
      console_logs: [],
      network_requests: [],
      url: null,
      occurred_at: failure.timestamp || new Date().toISOString(),
      test_started_at: failure.startedAt || null
    };

    // Extract error info
    if (failure.error) {
      if (failure.error instanceof Error) {
        evidence.error_message = failure.error.message;
        evidence.error_stack = failure.error.stack;
      } else if (typeof failure.error === 'string') {
        evidence.error_message = failure.error;
      } else if (typeof failure.error === 'object') {
        evidence.error_message = failure.error.message || JSON.stringify(failure.error);
        evidence.error_stack = failure.error.stack || null;
      }
    }

    // Extract evidence attachments
    if (failure.evidence) {
      evidence.screenshots = failure.evidence.screenshots || [];
      evidence.console_logs = failure.evidence.console_logs || failure.evidence.consoleLogs || [];
      evidence.network_requests = failure.evidence.network_requests || failure.evidence.networkRequests || [];
    }

    // Extract state/URL
    if (failure.state) {
      evidence.url = failure.state.url || null;
    }

    return evidence;
  }

  /**
   * Send failure + evidence to LLM for root cause analysis.
   */
  async analyzeBug(app, agentId, failure, evidence) {
    const prompt = this._buildAnalysisPrompt(app, agentId, failure, evidence);

    const response = await this._llm.complete(prompt, {
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1024,
      temperature: 0.2,
      systemPrompt: 'You are a QA engineer analyzing test failures. Return your analysis as valid JSON only, with no markdown fencing or extra text.'
    });

    return this._parseAnalysisResponse(response.content);
  }

  /**
   * Classify a bug based on LLM analysis.
   * Maps analysis fields to severity/category/priority.
   */
  classifyBug(analysis) {
    // Determine category from affected_component
    let category = 'backend'; // default
    const component = (analysis.affected_component || '').toLowerCase();
    if (component.includes('memory') || component.includes('recall') || component.includes('search')) {
      category = 'memory';
    } else if (component.includes('citation') || component.includes('accuracy') || component.includes('bible')) {
      category = 'data-accuracy';
    } else if (component.includes('ui') || component.includes('frontend') || component.includes('display')) {
      category = 'ui';
    } else if (component.includes('performance') || component.includes('latency') || component.includes('speed')) {
      category = 'performance';
    }

    // Determine severity from confidence + impact
    let severity = 'medium'; // default
    const impact = (analysis.impact_assessment || '').toLowerCase();
    if (analysis.confidence >= 0.8 && (impact.includes('critical') || impact.includes('data loss') || impact.includes('crash'))) {
      severity = 'critical';
    } else if (analysis.confidence >= 0.6 && (impact.includes('high') || impact.includes('broken') || impact.includes('fail'))) {
      severity = 'high';
    } else if (analysis.confidence < 0.4 || impact.includes('minor') || impact.includes('cosmetic')) {
      severity = 'low';
    }

    const priority = this._mapSeverityToPriority(severity);

    return { severity, category, priority };
  }

  /**
   * Determine if a bug can be auto-fixed.
   * Conservative — all three conditions must pass.
   */
  isAutoFixable(analysis, classification) {
    // Condition 1: Fix approach matches known simple patterns
    const simpleFixPatterns = [
      'adjust threshold',
      'update selector',
      'fix timeout',
      'add null check',
      'update config',
      'change parameter',
      'modify prompt',
      'fix off-by-one'
    ];

    const fixApproach = (analysis.fix_approach || '').toLowerCase();
    const hasSimplePattern = simpleFixPatterns.some(pattern =>
      fixApproach.includes(pattern)
    );

    if (!hasSimplePattern) {
      return false;
    }

    // Condition 2: Likely location is determinable
    if (!analysis.likely_location || analysis.likely_location === 'unknown') {
      return false;
    }

    // Condition 3: Category allows auto-fix
    const categoryRules = {
      'memory': true,
      'data-accuracy': true,
      'ui': false,
      'backend': false,
      'performance': true
    };

    return categoryRules[classification.category] === true;
  }

  /**
   * Create and persist a bug record.
   */
  async createBugRecord(app, agentId, failure, analysis, classification, autoFixable, evidence) {
    const bugId = this._generateBugId();

    const bug = {
      id: `bug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bug_id: bugId,
      app_id: app.id || app.name || 'unknown',
      title: this._generateTitle(agentId, analysis, evidence),
      description: analysis.impact_assessment || '',

      severity: classification.severity,
      priority: classification.priority,
      category: classification.category,
      status: 'open',

      detected_by: agentId,
      test_name: evidence.test_name,
      scenario: evidence.scenario,

      root_cause: analysis.root_cause,
      affected_component: analysis.affected_component,
      likely_location: analysis.likely_location,
      fix_approach: analysis.fix_approach,
      confidence: analysis.confidence,

      evidence: evidence,

      external_issue_id: null,
      external_issue_url: null,

      auto_fixable: autoFixable,

      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await this._storage.saveBug(bug);
    return bug;
  }

  /**
   * Create an issue in the external bug tracker.
   */
  async createExternalIssue(app, bug) {
    const description = this.formatIssueDescription(bug);

    const labels = [
      'qa-detected',
      bug.auto_fixable ? 'auto-fixable' : 'needs-manual-fix',
      `agent:${bug.detected_by}`,
      `severity:${bug.severity}`
    ];

    return await this._bugTracker.createIssue({
      title: `[QA] ${bug.title}`,
      description,
      priority: bug.priority,
      labels,
      custom_fields: {
        test_id: bug.evidence.test_id,
        bug_id: bug.bug_id
      }
    });
  }

  /**
   * Format a Markdown description for the external issue.
   */
  formatIssueDescription(bug) {
    const screenshotSection = bug.evidence.screenshots.length > 0
      ? `- [Screenshot](${bug.evidence.screenshots[bug.evidence.screenshots.length - 1]})`
      : '- No screenshots captured';

    const consoleErrors = (bug.evidence.console_logs || []).filter(l => l.level === 'error').length;
    const networkFailures = (bug.evidence.network_requests || []).filter(r => r.failed).length;

    return `## Test Information
- **Agent:** ${bug.detected_by}
- **Test:** ${bug.test_name}
- **Scenario:** ${bug.scenario || 'N/A'}

## Root Cause
${bug.root_cause}

## Affected Component
${bug.affected_component}

## Likely Location
\`${bug.likely_location}\`

## Fix Approach
${bug.fix_approach}

## Evidence
${screenshotSection}
- Console Errors: ${consoleErrors}
- Network Failures: ${networkFailures}

## Auto-Fix Status
${bug.auto_fixable ? '\u2705 Auto-fixable \u2014 approval initiated' : '\u274C Requires manual fix'}`.trim();
  }

  // --- Private helpers ---

  _generateBugId() {
    const id = `BUG-${this._bugCounter}`;
    this._bugCounter++;
    return id;
  }

  _generateTitle(agentId, analysis, evidence) {
    if (analysis.root_cause && analysis.root_cause !== 'LLM analysis failed') {
      // Use first sentence of root cause, capped at 80 chars
      const firstSentence = analysis.root_cause.split('.')[0].trim();
      return firstSentence.length > 80 ? firstSentence.substring(0, 77) + '...' : firstSentence;
    }
    // Fallback: use error message
    const errorMsg = evidence.error_message || 'Unknown failure';
    const prefix = `[${agentId}] `;
    const maxLen = 80 - prefix.length;
    return prefix + (errorMsg.length > maxLen ? errorMsg.substring(0, maxLen - 3) + '...' : errorMsg);
  }

  _buildAnalysisPrompt(app, agentId, failure, evidence) {
    const appName = app.name || app.id || 'Application';
    const consoleErrors = (evidence.console_logs || [])
      .filter(l => l.level === 'error')
      .slice(0, 5)
      .map(l => `  - ${l.message}`)
      .join('\n');
    const networkFailures = (evidence.network_requests || [])
      .filter(r => r.failed)
      .slice(0, 5)
      .map(r => `  - ${r.method || 'GET'} ${r.url} \u2192 ${r.status || 'failed'}`)
      .join('\n');

    return `You are analyzing a test failure for ${appName}.

TEST INFORMATION:
- Agent: ${agentId}
- Test: ${evidence.test_name}
- Scenario: ${evidence.scenario || 'N/A'}
- Step that failed: ${evidence.step_failed || 'N/A'}

ERROR:
${evidence.error_message || 'No error message'}

${evidence.error_stack ? `STACK TRACE:\n${evidence.error_stack}\n` : ''}EVIDENCE:
- Console errors: ${consoleErrors || '  None'}
- Network failures: ${networkFailures || '  None'}
- URL at failure: ${evidence.url || 'N/A'}

Analyze and return JSON (no markdown fencing):
{
  "root_cause": "What actually broke (1-2 sentences)",
  "affected_component": "Which part of the app (e.g., 'Search service', 'UI renderer')",
  "likely_location": "File/function if determinable (e.g., 'services/search.py:retrieve_context()'), or 'unknown'",
  "fix_approach": "High-level fix strategy (e.g., 'adjust threshold', 'add null check')",
  "confidence": 0.85,
  "impact_assessment": "How severe \u2014 mention 'critical', 'high', 'minor', etc."
}`;
  }

  _parseAnalysisResponse(content) {
    // Try to extract JSON from response (might have markdown fencing)
    let jsonStr = content.trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate required fields, providing defaults
      return {
        root_cause: parsed.root_cause || 'Unable to determine',
        affected_component: parsed.affected_component || 'unknown',
        likely_location: parsed.likely_location || 'unknown',
        fix_approach: parsed.fix_approach || 'Manual investigation required',
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
        impact_assessment: parsed.impact_assessment || 'Unable to assess'
      };
    } catch (err) {
      // Degraded analysis — JSON parse failed
      return {
        root_cause: 'LLM analysis returned unparseable response',
        affected_component: 'unknown',
        likely_location: 'unknown',
        fix_approach: 'Manual investigation required',
        confidence: 0,
        impact_assessment: 'Unable to assess'
      };
    }
  }

  _mapSeverityToPriority(severity) {
    const map = {
      'critical': 'urgent',
      'high': 'high',
      'medium': 'normal',
      'low': 'low'
    };
    return map[severity] || 'normal';
  }
}

module.exports = BugDetector;
