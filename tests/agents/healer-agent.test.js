'use strict';

const HealerAgent = require('../../agents/healer/agent');
const BaseAgent = require('../../agents/base-agent');
const { ScenarioError } = require('../../agents/errors');
const { createMockConnector, createHealerConfig } = require('../helpers/mock-connector');

describe('HealerAgent', () => {

  describe('extends BaseAgent', () => {
    test('is an instance of BaseAgent', () => {
      const agent = new HealerAgent(createHealerConfig(), createMockConnector());
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    test('constructor stores config and connector', () => {
      const config = createHealerConfig();
      const connector = createMockConnector();
      const agent = new HealerAgent(config, connector);
      expect(agent.config).toBe(config);
      expect(agent.connector).toBe(connector);
    });
  });

  describe('initialize', () => {
    test('calls connector.healthCheck()', async () => {
      const connector = createMockConnector();
      const agent = new HealerAgent(createHealerConfig(), connector);
      await agent.initialize();
      expect(connector.healthCheck).toHaveBeenCalled();
    });

    test('succeeds when connector is healthy', async () => {
      const connector = createMockConnector({ healthy: true });
      const agent = new HealerAgent(createHealerConfig(), connector);
      await expect(agent.initialize()).resolves.toBeUndefined();
    });

    test('throws ScenarioError when connector is not healthy', async () => {
      const connector = createMockConnector({ healthy: false });
      const agent = new HealerAgent(createHealerConfig(), connector);
      await expect(agent.initialize()).rejects.toThrow(ScenarioError);
    });

    test('includes health details in error message', async () => {
      const connector = createMockConnector({ healthy: false });
      const agent = new HealerAgent(createHealerConfig(), connector);
      await expect(agent.initialize()).rejects.toThrow('Connector health check failed');
    });
  });

  describe('analyzeResults', () => {
    let agent, connector;

    function makeTestRunResult(overrides = {}) {
      return {
        agentId: 'healer',
        scenarios: [],
        summary: { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0 },
        durationMs: 1000,
        ...overrides
      };
    }

    beforeEach(() => {
      connector = createMockConnector();
      agent = new HealerAgent(createHealerConfig(), connector);
    });

    test('computes healthScore as passed/total', async () => {
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 's1', status: 'passed' },
          { scenarioId: 's2', status: 'failed', failedSteps: [], failedAssertions: [{}] }
        ],
        summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.healthScore).toBe(0.5);
    });

    test('healthScore is 0 when no scenarios', async () => {
      const analysis = await agent.analyzeResults(makeTestRunResult());
      expect(analysis.healthScore).toBe(0);
    });

    test('healthScore is 1.0 when all pass', async () => {
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 's1', status: 'passed' },
          { scenarioId: 's2', status: 'passed' }
        ],
        summary: { total: 2, passed: 2, failed: 0, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.healthScore).toBe(1.0);
    });

    test('classifies failures not in knownIssues as regressions', async () => {
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'new-failure', scenarioName: 'New Failure', status: 'failed', failedSteps: [], failedAssertions: [{}], evidence: null }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.regressions).toHaveLength(1);
      expect(analysis.regressions[0].scenarioId).toBe('new-failure');
      expect(analysis.regressions[0].isRegression).toBe(true);
    });

    test('classifies failures in knownIssues as knownFailures', async () => {
      agent.config.knownIssues = [
        { scenarioId: 'known-fail', issueId: 'KNOWN-001', description: 'Known bug' }
      ];
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'known-fail', scenarioName: 'Known Fail', status: 'failed', failedSteps: [], failedAssertions: [{}] }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.knownFailures).toHaveLength(1);
      expect(analysis.regressions).toHaveLength(0);
    });

    test('hasRegressions is true when regressions exist', async () => {
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'new-fail', scenarioName: 'NF', status: 'failed', failedSteps: [], failedAssertions: [], evidence: null }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.hasRegressions).toBe(true);
    });

    test('hasRegressions is false when all failures are known', async () => {
      agent.config.knownIssues = [
        { scenarioId: 'known', issueId: 'K1', description: 'Known' }
      ];
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'known', scenarioName: 'Known', status: 'failed', failedSteps: [], failedAssertions: [] }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.hasRegressions).toBe(false);
    });

    test('includes knownIssueId and description in knownFailures', async () => {
      agent.config.knownIssues = [
        { scenarioId: 'kf', issueId: 'BUG-42', description: 'Flaky test' }
      ];
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'kf', scenarioName: 'KF', status: 'failed', failedSteps: [], failedAssertions: [] }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.knownFailures[0].knownIssueId).toBe('BUG-42');
      expect(analysis.knownFailures[0].description).toBe('Flaky test');
    });

    test('includes failedSteps and failedAssertions in regressions', async () => {
      const failedSteps = [{ stepIndex: 0, action: 'click', status: 'failed' }];
      const failedAssertions = [{ type: 'state_exists', passed: false }];
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'reg', scenarioName: 'Reg', status: 'failed', failedSteps, failedAssertions, evidence: { screenshot: '/x.png' } }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.regressions[0].failedSteps).toBe(failedSteps);
      expect(analysis.regressions[0].failedAssertions).toBe(failedAssertions);
      expect(analysis.regressions[0].evidence).toEqual({ screenshot: '/x.png' });
    });

    test('uses default healthThreshold of 0.9', async () => {
      delete agent.config.healthThreshold;
      const result = makeTestRunResult({
        scenarios: [{ scenarioId: 's1', status: 'passed' }],
        summary: { total: 1, passed: 1, failed: 0, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.healthThreshold).toBe(0.9);
    });

    test('uses config.healthThreshold when provided', async () => {
      agent.config.healthThreshold = 0.8;
      const result = makeTestRunResult({
        scenarios: [{ scenarioId: 's1', status: 'passed' }],
        summary: { total: 1, passed: 1, failed: 0, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.healthThreshold).toBe(0.8);
    });

    test('isHealthy is true when healthScore >= threshold', async () => {
      agent.config.healthThreshold = 0.5;
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 's1', status: 'passed' },
          { scenarioId: 's2', status: 'failed', failedSteps: [], failedAssertions: [], evidence: null }
        ],
        summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.isHealthy).toBe(true);
    });

    test('isHealthy is false when healthScore < threshold', async () => {
      agent.config.healthThreshold = 0.9;
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 's1', status: 'passed' },
          { scenarioId: 's2', status: 'failed', failedSteps: [], failedAssertions: [], evidence: null }
        ],
        summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.isHealthy).toBe(false);
    });

    test('handles empty knownIssues list', async () => {
      agent.config.knownIssues = [];
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'f1', scenarioName: 'F1', status: 'failed', failedSteps: [], failedAssertions: [], evidence: null }
        ],
        summary: { total: 1, passed: 0, failed: 1, errors: 0, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.regressions).toHaveLength(1);
      expect(analysis.knownFailures).toHaveLength(0);
    });

    test('handles scenario with status "error" as failure', async () => {
      const result = makeTestRunResult({
        scenarios: [
          { scenarioId: 'err', scenarioName: 'Err', status: 'error', failedSteps: [], failedAssertions: [], evidence: null }
        ],
        summary: { total: 1, passed: 0, failed: 0, errors: 1, skipped: 0 }
      });
      const analysis = await agent.analyzeResults(result);
      expect(analysis.regressions).toHaveLength(1);
      expect(analysis.regressions[0].scenarioId).toBe('err');
    });
  });

  describe('generateReport', () => {
    let agent;

    beforeEach(() => {
      agent = new HealerAgent(createHealerConfig(), createMockConnector());
    });

    function makeAnalysis(overrides = {}) {
      return {
        summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 },
        durationMs: 5000,
        passRate: 0.5,
        healthScore: 0.5,
        healthThreshold: 0.9,
        isHealthy: false,
        regressions: [{
          scenarioId: 'reg1',
          scenarioName: 'Regression 1',
          failedSteps: [{ stepIndex: 0 }],
          failedAssertions: [{ type: 'state_exists' }, { type: 'state_truthy' }],
          evidence: null,
          isRegression: true
        }],
        knownFailures: [],
        hasRegressions: true,
        regressionCount: 1,
        knownFailureCount: 0,
        ...overrides
      };
    }

    test('includes healerSummary in report', async () => {
      const report = await agent.generateReport(makeAnalysis());
      expect(report.healerSummary).toBeDefined();
    });

    test('healerSummary contains healthScore and isHealthy', async () => {
      const report = await agent.generateReport(makeAnalysis());
      expect(report.healerSummary.healthScore).toBe(0.5);
      expect(report.healerSummary.isHealthy).toBe(false);
    });

    test('healerSummary lists regressions with counts', async () => {
      const report = await agent.generateReport(makeAnalysis());
      expect(report.healerSummary.regressionCount).toBe(1);
      expect(report.healerSummary.regressions).toHaveLength(1);
      expect(report.healerSummary.regressions[0]).toEqual({
        scenarioId: 'reg1',
        scenarioName: 'Regression 1',
        failedAssertionCount: 2,
        failedStepCount: 1
      });
    });

    test('healerSummary lists knownFailures with issueId', async () => {
      const analysis = makeAnalysis({
        knownFailures: [{
          scenarioId: 'kf1',
          knownIssueId: 'BUG-99',
          description: 'Known flaky',
          isRegression: false
        }],
        knownFailureCount: 1
      });
      const report = await agent.generateReport(analysis);
      expect(report.healerSummary.knownFailureCount).toBe(1);
      expect(report.healerSummary.knownFailures).toHaveLength(1);
      expect(report.healerSummary.knownFailures[0]).toEqual({
        scenarioId: 'kf1',
        knownIssueId: 'BUG-99',
        description: 'Known flaky'
      });
    });

    test('preserves base report fields', async () => {
      const report = await agent.generateReport(makeAnalysis());
      expect(report.agentId).toBe('healer');
      expect(report.agentType).toBe('HealerAgent');
      expect(report.timestamp).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.metadata).toBeDefined();
    });
  });

  describe('end-to-end scenario execution', () => {
    test('runs smoke test scenarios through full lifecycle', async () => {
      const connector = createMockConnector({
        actionResults: {
          navigate: { success: true },
          authenticate: (params) => {
            connector._state.set('authenticated', true);
            return { success: true };
          },
          create_project: (params) => {
            connector._state.set('current_project_id', 'proj_123');
            return { success: true, id: 'proj_123' };
          }
        }
      });
      const agent = new HealerAgent(createHealerConfig(), connector);
      await agent.initialize();
      const result = await agent.runTests();
      const analysis = await agent.analyzeResults(result);
      const report = await agent.generateReport(analysis);

      expect(result.scenarios).toHaveLength(2);
      expect(report.healerSummary).toBeDefined();
      expect(report.agentType).toBe('HealerAgent');
    });

    test('detects regression when new scenario fails', async () => {
      const connector = createMockConnector({
        actionResults: {
          navigate: { success: true },
          authenticate: (params) => {
            connector._state.set('authenticated', true);
            return { success: true };
          }
        },
        actionErrors: {
          create_project: Object.assign(new Error('Element not found'), { recoverable: true })
        }
      });
      const agent = new HealerAgent(createHealerConfig(), connector);
      const result = await agent.runTests();
      const analysis = await agent.analyzeResults(result);

      expect(analysis.hasRegressions).toBe(true);
      expect(analysis.regressions.some(r => r.scenarioId === 'create-project')).toBe(true);
    });

    test('ignores known issue when known scenario fails', async () => {
      const connector = createMockConnector({
        actionResults: {
          navigate: { success: true },
          authenticate: (params) => {
            connector._state.set('authenticated', true);
            return { success: true };
          }
        },
        actionErrors: {
          create_project: Object.assign(new Error('Known bug'), { recoverable: true })
        }
      });
      const config = createHealerConfig({
        knownIssues: [
          { scenarioId: 'create-project', issueId: 'BUG-1', description: 'Known create bug' }
        ]
      });
      const agent = new HealerAgent(config, connector);
      const result = await agent.runTests();
      const analysis = await agent.analyzeResults(result);

      expect(analysis.hasRegressions).toBe(false);
      expect(analysis.knownFailures).toHaveLength(1);
      expect(analysis.knownFailures[0].knownIssueId).toBe('BUG-1');
    });

    test('reports healthy when all scenarios pass', async () => {
      const connector = createMockConnector({
        actionResults: {
          navigate: { success: true },
          authenticate: (params) => {
            connector._state.set('authenticated', true);
            return { success: true };
          },
          create_project: (params) => {
            connector._state.set('current_project_id', 'proj_123');
            return { success: true };
          }
        }
      });
      const agent = new HealerAgent(createHealerConfig(), connector);
      const result = await agent.runTests();
      const analysis = await agent.analyzeResults(result);

      expect(analysis.healthScore).toBe(1.0);
      expect(analysis.isHealthy).toBe(true);
      expect(analysis.hasRegressions).toBe(false);
    });

    test('reports unhealthy when health score drops below threshold', async () => {
      const connector = createMockConnector({
        actionErrors: {
          navigate: Object.assign(new Error('nav failed'), { recoverable: true }),
          authenticate: Object.assign(new Error('auth failed'), { recoverable: true }),
          create_project: Object.assign(new Error('create failed'), { recoverable: true })
        }
      });
      const agent = new HealerAgent(createHealerConfig({ healthThreshold: 0.9 }), connector);
      const result = await agent.runTests();
      const analysis = await agent.analyzeResults(result);

      expect(analysis.healthScore).toBe(0);
      expect(analysis.isHealthy).toBe(false);
    });
  });
});
