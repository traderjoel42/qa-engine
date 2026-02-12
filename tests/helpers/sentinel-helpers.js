'use strict';

const { createMockConnector, createAgentConfig } = require('./mock-connector');

/**
 * Create a mock connector with overridable action handlers.
 * Delegates to base mock for unoverridden actions.
 */
function createMemoryMockConnector(overrides = {}) {
  const mock = createMockConnector();
  const originalPerformAction = mock.performAction.bind(mock);

  mock.performAction = jest.fn(async (action, params) => {
    if (overrides[action]) {
      return overrides[action](params);
    }
    return originalPerformAction(action, params);
  });

  return mock;
}

/**
 * Create a minimal SentinelAgent config.
 * Uses config.id (not agentId) for getAgentId() compatibility.
 */
function createSentinelConfig(overrides = {}) {
  return {
    id: 'sentinel',
    description: 'Memory persistence validation',
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    scenarios: overrides.scenarios || [createMemoryScenario()],
    ...overrides
  };
}

/**
 * Create a minimal memory scenario with 1 fact.
 * Steps: setup -> establish (with fact) -> wait -> recall query -> recall response.
 * Assertions: recall_contains + no_contradiction at scenario level.
 */
function createMemoryScenario(overrides = {}) {
  const steps = overrides.steps || [
    {
      action: 'create_session',
      params: { type: 'explore' },
      phase: 'setup'
    },
    {
      action: 'send_message',
      params: { text: 'The protagonist is Marcus, a detective.' },
      phase: 'establish',
      fact: {
        factId: 'fact-marcus',
        keywords: ['Marcus', 'detective'],
        contradictions: ['teacher', 'lawyer'],
        category: 'character'
      }
    },
    {
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'establish'
    },
    {
      action: 'send_message',
      params: { text: 'Who is the protagonist?' },
      phase: 'recall'
    },
    {
      action: 'wait_for_response',
      params: { timeout: 30000 },
      description: 'Recall response (step 4 — assertion target)',
      phase: 'recall'
    }
  ];

  const assertions = overrides.assertions || [
    {
      type: 'recall_contains',
      stepIndex: 4,
      factId: 'fact-marcus',
      keywords: ['Marcus', 'detective']
    },
    {
      type: 'no_contradiction',
      stepIndex: 4,
      factId: 'fact-marcus',
      contradictions: ['teacher', 'lawyer']
    }
  ];

  return {
    id: overrides.id || 'test-memory-scenario',
    name: overrides.name || 'Test Memory Scenario',
    timeout: overrides.timeout || 120000,
    recallThreshold: overrides.recallThreshold,
    contradictionThreshold: overrides.contradictionThreshold,
    steps,
    assertions
  };
}

/**
 * Create a multi-fact scenario for recall accuracy testing.
 * All facts go in one establish phase, one distance step, then all recalls.
 * Assertions: recall_contains + no_contradiction for each fact.
 *
 * NOTE: stepIndex targets the wait_for_response step (the AI's answer),
 * not the send_message step (the user's query).
 *
 * @param {object} opts - { factCount, recallThreshold }
 */
function createMultiFactScenario({ factCount = 3, recallThreshold = 0.85 } = {}) {
  const steps = [
    // Step 0: setup
    {
      action: 'create_session',
      params: { type: 'explore' },
      phase: 'setup'
    }
  ];

  let stepIdx = 1;
  const assertionConfigs = [];

  // Establish facts: each is send_message + wait_for_response
  for (let i = 0; i < factCount; i++) {
    steps.push({
      action: 'send_message',
      params: { text: `Fact ${i}: keyword-${i} is established.` },
      phase: 'establish',
      fact: {
        factId: `fact-${i}`,
        keywords: [`keyword-${i}`],
        contradictions: [`contra-${i}`],
        category: i % 2 === 0 ? 'character' : 'plot'
      }
    });
    stepIdx++;

    steps.push({
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'establish'
    });
    stepIdx++;
  }

  // Distance: one intervening session
  steps.push({
    action: 'create_session',
    params: { type: 'explore' },
    phase: 'distance'
  });
  stepIdx++;

  // Recall: send_message + wait_for_response per fact
  for (let i = 0; i < factCount; i++) {
    steps.push({
      action: 'send_message',
      params: { text: `Recall query for fact ${i}` },
      phase: 'recall'
    });
    stepIdx++;

    steps.push({
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'recall'
    });
    const responseIdx = stepIdx;
    stepIdx++;

    // Assertions target the wait_for_response step (has the AI response)
    // responseIdx is the correct index of the wait_for_response step
    assertionConfigs.push({
      type: 'recall_contains',
      stepIndex: responseIdx,
      factId: `fact-${i}`,
      keywords: [`keyword-${i}`]
    });
    assertionConfigs.push({
      type: 'no_contradiction',
      stepIndex: responseIdx,
      factId: `fact-${i}`,
      contradictions: [`contra-${i}`]
    });
  }

  return {
    id: `multi-fact-${factCount}`,
    name: `${factCount}-Fact Memory Test`,
    recallThreshold,
    steps,
    assertions: assertionConfigs
  };
}

/**
 * Create a mock testRunResult for analyzeResults() testing.
 *
 * @param {object[]} scenarioResults - [{ scenarioId, status, steps, assertions }]
 * @returns {object} testRunResult compatible with BaseAgent.analyzeResults
 */
function createMockTestRunResult(scenarioResults) {
  const total = scenarioResults.length;
  const passed = scenarioResults.filter(s => s.status === 'passed').length;
  const failed = total - passed;

  return {
    summary: { total, passed, failed },
    scenarios: scenarioResults,
    durationMs: 1000
  };
}

/**
 * Create mock assertion results with _factId and _assertionType already merged.
 * For testing _classifyFactResult directly (pre-merged format).
 *
 * @param {Array} results - [{ type, factId, passed }]
 * @returns {object[]} formatted for _classifyFactResult
 */
function createMockMergedAssertionResults(results) {
  return results.map(r => ({
    type: r.type,
    passed: r.passed,
    message: r.passed ? 'passed' : 'failed',
    expected: '',
    actual: '',
    durationMs: 1,
    _factId: r.factId || null,
    _assertionType: r.type
  }));
}

module.exports = {
  createMemoryMockConnector,
  createSentinelConfig,
  createMemoryScenario,
  createMultiFactScenario,
  createMockTestRunResult,
  createMockMergedAssertionResults
};
