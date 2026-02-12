'use strict';

const BaseAgent = require('../base-agent');
const { ScenarioError } = require('../errors');

/**
 * Healer Agent — Smoke tests and regression detection.
 *
 * Runs configured smoke test scenarios against the app, then:
 * 1. Computes a health score (passed / total)
 * 2. Classifies failures as regressions (new) or known issues (expected)
 * 3. Reports regressions separately for priority triage
 *
 * Configuration:
 * - scenarios: Array of smoke test scenario definitions
 * - knownIssues: Array of { scenarioId, issueId, description } for expected failures
 * - healthThreshold: Minimum health score to consider the app "healthy" (default: 0.9)
 *
 * @extends BaseAgent
 */
class HealerAgent extends BaseAgent {
  /**
   * Verify connector health before running smoke tests.
   * If the connector can't even health-check, there's no point running tests.
   */
  async initialize() {
    const health = await this.connector.healthCheck();
    if (!health.healthy) {
      throw new ScenarioError(
        `Connector health check failed: ${JSON.stringify(health.details)}`,
        { agentId: this.getAgentId(), phase: 'initialize' }
      );
    }
  }

  /**
   * Analyze results with regression detection.
   *
   * Compares failed scenarios against the knownIssues list in config.
   * Failures NOT in knownIssues are classified as regressions.
   *
   * @param {TestRunResult} testRunResult
   * @returns {Promise<HealerAnalysis>}
   */
  async analyzeResults(testRunResult) {
    const baseAnalysis = await super.analyzeResults(testRunResult);
    const knownIssues = this.config.knownIssues || [];
    const knownScenarioIds = new Set(knownIssues.map(ki => ki.scenarioId));

    const failedScenarios = testRunResult.scenarios.filter(
      s => s.status === 'failed' || s.status === 'error'
    );

    const regressions = [];
    const knownFailures = [];

    for (const scenario of failedScenarios) {
      if (knownScenarioIds.has(scenario.scenarioId)) {
        const knownIssue = knownIssues.find(ki => ki.scenarioId === scenario.scenarioId);
        knownFailures.push({
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName,
          knownIssueId: knownIssue.issueId,
          description: knownIssue.description,
          isRegression: false
        });
      } else {
        regressions.push({
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName,
          failedSteps: scenario.failedSteps,
          failedAssertions: scenario.failedAssertions,
          evidence: scenario.evidence,
          isRegression: true
        });
      }
    }

    const healthScore = testRunResult.summary.total > 0
      ? testRunResult.summary.passed / testRunResult.summary.total
      : 0;

    const healthThreshold = this.config.healthThreshold ?? 0.9;

    return {
      ...baseAnalysis,
      healthScore,
      healthThreshold,
      isHealthy: healthScore >= healthThreshold,
      regressions,
      knownFailures,
      hasRegressions: regressions.length > 0,
      regressionCount: regressions.length,
      knownFailureCount: knownFailures.length
    };
  }

  /**
   * Generate report with regression summary.
   *
   * @param {HealerAnalysis} analysis
   * @returns {Promise<HealerReport>}
   */
  async generateReport(analysis) {
    const baseReport = await super.generateReport(analysis);

    return {
      ...baseReport,
      healerSummary: {
        healthScore: analysis.healthScore,
        healthThreshold: analysis.healthThreshold,
        isHealthy: analysis.isHealthy,
        regressionCount: analysis.regressionCount,
        knownFailureCount: analysis.knownFailureCount,
        regressions: analysis.regressions.map(r => ({
          scenarioId: r.scenarioId,
          scenarioName: r.scenarioName,
          failedAssertionCount: r.failedAssertions?.length || 0,
          failedStepCount: r.failedSteps?.length || 0
        })),
        knownFailures: analysis.knownFailures.map(kf => ({
          scenarioId: kf.scenarioId,
          knownIssueId: kf.knownIssueId,
          description: kf.description
        }))
      }
    };
  }
}

module.exports = HealerAgent;
