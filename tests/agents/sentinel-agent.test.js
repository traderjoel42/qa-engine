'use strict';

const SentinelAgent = require('../../agents/sentinel/agent');
const BaseAgent = require('../../agents/base-agent');
const { ConfigurationError } = require('../../agents/errors');
const {
  createMemoryMockConnector,
  createSentinelConfig,
  createMemoryScenario,
  createMultiFactScenario,
  createMockTestRunResult,
  createMockMergedAssertionResults
} = require('../helpers/sentinel-helpers');

// ===================================================================
// 8.1 Constructor & Initialization
// ===================================================================

describe('SentinelAgent', () => {
  describe('constructor', () => {
    test('accepts config and connector', () => {
      const connector = createMemoryMockConnector();
      const config = createSentinelConfig();
      const agent = new SentinelAgent(config, connector);
      expect(agent.config).toBe(config);
      expect(agent.connector).toBe(connector);
    });

    test('is instanceof BaseAgent', () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      expect(agent).toBeInstanceOf(BaseAgent);
    });
  });

  describe('initialize()', () => {
    test('calls super.initialize()', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      const superInit = jest.spyOn(BaseAgent.prototype, 'initialize');
      await agent.initialize();
      expect(superInit).toHaveBeenCalled();
      superInit.mockRestore();
    });

    test('builds fact registries from scenario configs', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
      expect(agent._factRegistries).toBeInstanceOf(Map);
      expect(agent._factRegistries.size).toBe(1);
    });

    test('creates registry entry for each step with fact declaration', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
      const registry = agent._factRegistries.get('test-memory-scenario');
      expect(registry.size).toBe(1);
      expect(registry.has('fact-marcus')).toBe(true);
      const fact = registry.get('fact-marcus');
      expect(fact.keywords).toEqual(['Marcus', 'detective']);
      expect(fact.contradictions).toEqual(['teacher', 'lawyer']);
      expect(fact.category).toBe('character');
      expect(fact.establishedAtStepIndex).toBe(1);
    });

    test('handles scenario with no facts (empty registry, no error)', async () => {
      const scenario = {
        id: 'no-facts',
        name: 'No Facts',
        steps: [
          { action: 'navigate', params: { path: '/' } }
        ],
        assertions: [
          { type: 'state_exists', key: 'loaded' }
        ]
      };
      const config = createSentinelConfig({ scenarios: [scenario] });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
      const registry = agent._factRegistries.get('no-facts');
      expect(registry.size).toBe(0);
    });

    test('throws ConfigurationError if scenario has facts but no memory assertions', async () => {
      const scenario = {
        id: 'bad-scenario',
        name: 'Bad Scenario',
        steps: [
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-1', keywords: ['test'] }
          }
        ],
        assertions: [
          { type: 'state_exists', key: 'loaded' }
        ]
      };
      const config = createSentinelConfig({ scenarios: [scenario] });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
    });

    test('uses getScenarios() to respect tag filtering', async () => {
      const scenario1 = createMemoryScenario({ id: 'scenario-1', tags: ['memory'] });
      scenario1.tags = ['memory'];
      const scenario2 = {
        id: 'scenario-2',
        name: 'Not Memory',
        tags: ['smoke'],
        steps: [{ action: 'navigate', params: { path: '/' } }],
        assertions: [{ type: 'state_exists', key: 'x' }]
      };
      const config = createSentinelConfig({
        scenarios: [scenario1, scenario2],
        tagFilter: ['memory']
      });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
      // Only scenario-1 matched the tag filter, so only it has a registry
      expect(agent._factRegistries.has('scenario-1')).toBe(true);
      expect(agent._factRegistries.has('scenario-2')).toBe(false);
    });
  });

  // ===================================================================
  // 8.2 Fact Registry Building
  // ===================================================================

  describe('_buildFactRegistryForScenario()', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    test('extracts factId, keywords, contradictions, category from step.fact', () => {
      const scenario = createMemoryScenario();
      const registry = agent._buildFactRegistryForScenario(scenario);
      const fact = registry.get('fact-marcus');
      expect(fact.factId).toBe('fact-marcus');
      expect(fact.keywords).toEqual(['Marcus', 'detective']);
      expect(fact.contradictions).toEqual(['teacher', 'lawyer']);
      expect(fact.category).toBe('character');
    });

    test('records establishedAtStepIndex as numeric array index', () => {
      const scenario = createMemoryScenario();
      const registry = agent._buildFactRegistryForScenario(scenario);
      const fact = registry.get('fact-marcus');
      expect(fact.establishedAtStepIndex).toBe(1);
      expect(typeof fact.establishedAtStepIndex).toBe('number');
    });

    test('handles multiple facts in one scenario', () => {
      const scenario = createMultiFactScenario({ factCount: 3 });
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.size).toBe(3);
      expect(registry.has('fact-0')).toBe(true);
      expect(registry.has('fact-1')).toBe(true);
      expect(registry.has('fact-2')).toBe(true);
    });

    test('handles fact with no contradictions (defaults to [])', () => {
      const scenario = {
        id: 'no-contra',
        name: 'No Contradictions',
        steps: [
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-x', keywords: ['x'] }
          }
        ],
        assertions: [
          { type: 'recall_contains', stepIndex: 0, factId: 'fact-x', keywords: ['x'] }
        ]
      };
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.get('fact-x').contradictions).toEqual([]);
    });

    test('handles fact with no category (defaults to uncategorized)', () => {
      const scenario = {
        id: 'no-cat',
        name: 'No Category',
        steps: [
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-y', keywords: ['y'] }
          }
        ],
        assertions: [
          { type: 'recall_contains', stepIndex: 0, factId: 'fact-y', keywords: ['y'] }
        ]
      };
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.get('fact-y').category).toBe('uncategorized');
    });

    test('ignores steps without fact declarations', () => {
      const scenario = createMemoryScenario();
      const registry = agent._buildFactRegistryForScenario(scenario);
      // 5 steps, only 1 has a fact declaration
      expect(registry.size).toBe(1);
    });

    test('handles steps without phase field (no error)', () => {
      const scenario = {
        id: 'no-phase',
        name: 'No Phase',
        steps: [
          { action: 'navigate', params: { path: '/' } },
          {
            action: 'send_message',
            fact: { factId: 'fact-z', keywords: ['z'] }
          }
        ],
        assertions: [
          { type: 'recall_contains', stepIndex: 1, factId: 'fact-z', keywords: ['z'] }
        ]
      };
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.size).toBe(1);
    });

    test('throws ConfigurationError: facts exist but no memory assertions', () => {
      const scenario = {
        id: 'bad',
        name: 'Bad',
        steps: [
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-a', keywords: ['a'] }
          }
        ],
        assertions: [
          { type: 'state_exists', key: 'something' }
        ]
      };
      expect(() => agent._buildFactRegistryForScenario(scenario)).toThrow(ConfigurationError);
      expect(() => agent._buildFactRegistryForScenario(scenario)).toThrow(/no memory assertions/);
    });

    test('does not throw when zero facts and zero memory assertions', () => {
      const scenario = {
        id: 'empty',
        name: 'Empty',
        steps: [{ action: 'navigate', params: { path: '/' } }],
        assertions: [{ type: 'state_exists', key: 'x' }]
      };
      expect(() => agent._buildFactRegistryForScenario(scenario)).not.toThrow();
    });

    test('does not throw when zero facts but has standard assertions', () => {
      const scenario = {
        id: 'standard',
        name: 'Standard',
        steps: [{ action: 'navigate', params: { path: '/' } }],
        assertions: [
          { type: 'state_exists', key: 'x' },
          { type: 'url_contains', value: '/dashboard' }
        ]
      };
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.size).toBe(0);
    });

    test('handles duplicate factIds (last one wins by Map behavior)', () => {
      const scenario = {
        id: 'dupes',
        name: 'Duplicates',
        steps: [
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-dup', keywords: ['first'], category: 'cat-a' }
          },
          {
            action: 'send_message',
            phase: 'establish',
            fact: { factId: 'fact-dup', keywords: ['second'], category: 'cat-b' }
          }
        ],
        assertions: [
          { type: 'recall_contains', stepIndex: 0, factId: 'fact-dup', keywords: ['second'] }
        ]
      };
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.size).toBe(1);
      expect(registry.get('fact-dup').keywords).toEqual(['second']);
      expect(registry.get('fact-dup').establishedAtStepIndex).toBe(1);
    });

    test('sets recallResult to null initially', () => {
      const scenario = createMemoryScenario();
      const registry = agent._buildFactRegistryForScenario(scenario);
      expect(registry.get('fact-marcus').recallResult).toBeNull();
    });
  });

  // ===================================================================
  // 8.3 Custom Assertion: recall_contains
  // ===================================================================

  describe('evaluateAssertion() — recall_contains', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    function makeContext(responseText) {
      return {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { text: responseText } }
        ],
        lastStepResult: null
      };
    }

    test('passes when all keywords found in step response', async () => {
      const ctx = makeContext('Marcus is indeed the detective protagonist');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus', 'detective'] },
        ctx
      );
      expect(result.passed).toBe(true);
      expect(result.type).toBe('recall_contains');
    });

    test('fails when one keyword missing', async () => {
      const ctx = makeContext('Marcus is the protagonist');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus', 'detective'] },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Missing keywords');
      expect(result.message).toContain('detective');
    });

    test('fails when all keywords missing', async () => {
      const ctx = makeContext('The story begins with a rainy night');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus', 'detective'] },
        ctx
      );
      expect(result.passed).toBe(false);
    });

    test('case-insensitive keyword matching', async () => {
      const ctx = makeContext('MARCUS is the DETECTIVE');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus', 'detective'] },
        ctx
      );
      expect(result.passed).toBe(true);
    });

    test('returns expected with keywords listed', async () => {
      const ctx = makeContext('Marcus detective');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus', 'detective'] },
        ctx
      );
      expect(result.expected).toContain('Marcus');
      expect(result.expected).toContain('detective');
    });

    test('returns actual with truncated response text', async () => {
      const longResponse = 'x'.repeat(300);
      const ctx = makeContext(longResponse);
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['missing'] },
        ctx
      );
      expect(result.actual.length).toBeLessThanOrEqual(200);
    });

    test('returns durationMs', async () => {
      const ctx = makeContext('Marcus detective');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: ['Marcus'] },
        ctx
      );
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('fails with message if stepIndex missing', async () => {
      const ctx = makeContext('Marcus');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', factId: 'fact-1', keywords: ['Marcus'] },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });

    test('fails with message if factId missing', async () => {
      const ctx = makeContext('Marcus');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, keywords: ['Marcus'] },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });

    test('fails with message if keywords not array', async () => {
      const ctx = makeContext('Marcus');
      const result = await agent.evaluateAssertion(
        { type: 'recall_contains', stepIndex: 0, factId: 'fact-1', keywords: 'Marcus' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });
  });

  // ===================================================================
  // 8.4 Custom Assertion: no_contradiction
  // ===================================================================

  describe('evaluateAssertion() — no_contradiction', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    function makeContext(responseText) {
      return {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { text: responseText } }
        ],
        lastStepResult: null
      };
    }

    test('passes when no contradiction strings found', async () => {
      const ctx = makeContext('Marcus is a detective in 1940s LA');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher', 'lawyer'] },
        ctx
      );
      expect(result.passed).toBe(true);
      expect(result.type).toBe('no_contradiction');
    });

    test('fails when contradiction string found in response', async () => {
      const ctx = makeContext('Marcus is actually a teacher, not a detective');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher', 'lawyer'] },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('CONTRADICTION');
      expect(result.message).toContain('teacher');
    });

    test('case-insensitive contradiction matching', async () => {
      const ctx = makeContext('Marcus is a TEACHER');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher'] },
        ctx
      );
      expect(result.passed).toBe(false);
    });

    test('reports found contradictions in actual field', async () => {
      const ctx = makeContext('Marcus is a teacher and lawyer');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher', 'lawyer'] },
        ctx
      );
      expect(result.actual).toContain('teacher');
      expect(result.actual).toContain('lawyer');
    });

    test('returns expected with contradiction list', async () => {
      const ctx = makeContext('Marcus detective');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher', 'lawyer'] },
        ctx
      );
      expect(result.expected).toContain('teacher');
      expect(result.expected).toContain('lawyer');
    });

    test('returns durationMs', async () => {
      const ctx = makeContext('Marcus detective');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: ['teacher'] },
        ctx
      );
      expect(typeof result.durationMs).toBe('number');
    });

    test('fails with message if stepIndex missing', async () => {
      const ctx = makeContext('test');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', factId: 'fact-1', contradictions: ['teacher'] },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });

    test('fails with message if contradictions not array', async () => {
      const ctx = makeContext('test');
      const result = await agent.evaluateAssertion(
        { type: 'no_contradiction', stepIndex: 0, factId: 'fact-1', contradictions: 'teacher' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });
  });

  // ===================================================================
  // 8.5 Custom Assertion: fact_present
  // ===================================================================

  describe('evaluateAssertion() — fact_present', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    test('passes when validate_memory returns found:true and text matches', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'Marcus is a detective' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'Marcus' },
        ctx
      );
      expect(result.passed).toBe(true);
      expect(result.type).toBe('fact_present');
    });

    test('fails when validate_memory returns found:false', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: false } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'Marcus' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not found in memory');
    });

    test('fails when found:true but expected text not in result', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'The story is set in LA' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'Marcus' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('missing expected content');
    });

    test('case-insensitive text matching', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'MARCUS IS A DETECTIVE' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'marcus' },
        ctx
      );
      expect(result.passed).toBe(true);
    });

    test('includes actual memory text in actual field', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'Marcus is a detective' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'Marcus' },
        ctx
      );
      expect(result.actual).toContain('Marcus is a detective');
    });

    test('returns durationMs', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'Marcus' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1', expected: 'Marcus' },
        ctx
      );
      expect(typeof result.durationMs).toBe('number');
    });

    test('fails with message if factId missing', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'x' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, expected: 'x' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });

    test('fails with message if expected missing', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [
          { stepIndex: 0, status: 'passed', result: { found: true, text: 'x' } }
        ],
        lastStepResult: null
      };
      const result = await agent.evaluateAssertion(
        { type: 'fact_present', stepIndex: 0, factId: 'fact-1' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires');
    });
  });

  // ===================================================================
  // 8.6 Assertion Fallback to BaseAgent
  // ===================================================================

  describe('evaluateAssertion() — fallback', () => {
    let agent;
    let connector;

    beforeEach(async () => {
      connector = createMemoryMockConnector();
      agent = new SentinelAgent(createSentinelConfig(), connector);
      await agent.initialize();
    });

    test('delegates state_exists to super', async () => {
      connector._state.set('mykey', 'myval');
      const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };
      const result = await agent.evaluateAssertion(
        { type: 'state_exists', key: 'mykey' },
        ctx
      );
      expect(result.passed).toBe(true);
      expect(result.type).toBe('state_exists');
    });

    test('delegates response_contains to super', async () => {
      const ctx = {
        scenarioId: 'test',
        stepResults: [],
        lastStepResult: { result: { text: 'hello world' } }
      };
      const result = await agent.evaluateAssertion(
        { type: 'response_contains', value: 'hello' },
        ctx
      );
      expect(result.passed).toBe(true);
      expect(result.type).toBe('response_contains');
    });

    test('delegates unknown type to super (returns failed)', async () => {
      const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };
      const result = await agent.evaluateAssertion(
        { type: 'nonexistent_type' },
        ctx
      );
      expect(result.passed).toBe(false);
      expect(result.type).toBe('nonexistent_type');
    });
  });

  // ===================================================================
  // 8.7 Fact Classification
  // ===================================================================

  describe('_classifyFactResult()', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    const factEntry = { factId: 'fact-1', keywords: ['x'], contradictions: ['y'], category: 'test' };

    test('returns recalled when recall_contains passes for fact', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-1', passed: true }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('recalled');
    });

    test('returns forgotten when recall_contains fails', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-1', passed: false }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('forgotten');
    });

    test('returns contradicted when no_contradiction fails', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'no_contradiction', factId: 'fact-1', passed: false }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('contradicted');
    });

    test('contradiction takes priority over recall failure', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-1', passed: false },
        { type: 'no_contradiction', factId: 'fact-1', passed: false }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('contradicted');
    });

    test('returns untested when no assertions reference this factId', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-other', passed: true }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('untested');
    });

    test('returns recalled when fact_present passes', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'fact_present', factId: 'fact-1', passed: true }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('recalled');
    });

    test('returns forgotten when fact_present fails', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'fact_present', factId: 'fact-1', passed: false }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('forgotten');
    });

    test('handles multiple recall_contains for same fact — all must pass', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-1', passed: true },
        { type: 'recall_contains', factId: 'fact-1', passed: false }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('forgotten');
    });

    test('handles mixed assertion types for same fact', () => {
      const merged = createMockMergedAssertionResults([
        { type: 'recall_contains', factId: 'fact-1', passed: true },
        { type: 'no_contradiction', factId: 'fact-1', passed: true },
        { type: 'fact_present', factId: 'fact-1', passed: true }
      ]);
      expect(agent._classifyFactResult(factEntry, merged)).toBe('recalled');
    });

    test('returns untested for empty assertion results', () => {
      expect(agent._classifyFactResult(factEntry, [])).toBe('untested');
    });
  });

  // ===================================================================
  // 8.8 Recall Metrics Computation
  // ===================================================================

  describe('_computeRecallMetrics()', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    function makeFactRegistry(facts) {
      const registry = new Map();
      for (const f of facts) {
        registry.set(f.factId, {
          factId: f.factId,
          keywords: f.keywords || [],
          contradictions: f.contradictions || [],
          category: f.category || 'test',
          establishedAtStepIndex: f.step || 0,
          recallResult: null
        });
      }
      return registry;
    }

    test('computes correct recallRate', () => {
      const registry = makeFactRegistry([
        { factId: 'f1', category: 'a' },
        { factId: 'f2', category: 'a' },
        { factId: 'f3', category: 'a' }
      ]);
      // 2 recalled, 1 forgotten
      const assertionResults = [
        { type: 'recall_contains', passed: true },
        { type: 'recall_contains', passed: true },
        { type: 'recall_contains', passed: false }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'recall_contains', factId: 'f2' },
          { type: 'recall_contains', factId: 'f3' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.recallRate).toBeCloseTo(2 / 3);
      expect(metrics.facts.recalled).toBe(2);
      expect(metrics.facts.forgotten).toBe(1);
    });

    test('computes correct contradictionRate', () => {
      const registry = makeFactRegistry([
        { factId: 'f1', category: 'a' },
        { factId: 'f2', category: 'a' }
      ]);
      const assertionResults = [
        { type: 'no_contradiction', passed: true },
        { type: 'no_contradiction', passed: false }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'no_contradiction', factId: 'f1' },
          { type: 'no_contradiction', factId: 'f2' }
        ]
      };
      // f1 has only no_contradiction (passed) → no recall assertion → untested
      // f2 has only no_contradiction (failed) → contradicted
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.facts.contradicted).toBe(1);
      expect(metrics.contradictionRate).toBeGreaterThan(0);
    });

    test('computes per-category rates', () => {
      const registry = makeFactRegistry([
        { factId: 'f1', category: 'character' },
        { factId: 'f2', category: 'character' },
        { factId: 'f3', category: 'plot' }
      ]);
      const assertionResults = [
        { type: 'recall_contains', passed: true },
        { type: 'recall_contains', passed: false },
        { type: 'recall_contains', passed: true }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'recall_contains', factId: 'f2' },
          { type: 'recall_contains', factId: 'f3' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.byCategory.character.recalled).toBe(1);
      expect(metrics.byCategory.character.forgotten).toBe(1);
      expect(metrics.byCategory.plot.recalled).toBe(1);
      expect(metrics.byCategory.plot.rate).toBe(1);
    });

    test('passed=true when rate >= threshold and contradictions <= threshold', () => {
      const registry = makeFactRegistry([
        { factId: 'f1' }
      ]);
      const assertionResults = [{ type: 'recall_contains', passed: true }];
      const scenario = {
        id: 'test',
        recallThreshold: 0.85,
        contradictionThreshold: 0.0,
        assertions: [{ type: 'recall_contains', factId: 'f1' }]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.passed).toBe(true);
    });

    test('passed=false when rate below threshold', () => {
      const registry = makeFactRegistry([
        { factId: 'f1' },
        { factId: 'f2' }
      ]);
      const assertionResults = [
        { type: 'recall_contains', passed: true },
        { type: 'recall_contains', passed: false }
      ];
      const scenario = {
        id: 'test',
        recallThreshold: 0.85,
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'recall_contains', factId: 'f2' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.passed).toBe(false);
    });

    test('passed=false when contradiction rate above threshold', () => {
      const registry = makeFactRegistry([
        { factId: 'f1' }
      ]);
      const assertionResults = [
        { type: 'recall_contains', passed: true },
        { type: 'no_contradiction', passed: false }
      ];
      const scenario = {
        id: 'test',
        contradictionThreshold: 0.0,
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'no_contradiction', factId: 'f1' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      // Contradiction found → contradicted (not recalled), rate = 0/1 = 0, contradiction rate = 1/1 = 1
      expect(metrics.passed).toBe(false);
    });

    test('handles zero testable facts (rate = 0)', () => {
      const registry = makeFactRegistry([
        { factId: 'f1' }
      ]);
      // No matching assertions for f1
      const assertionResults = [
        { type: 'state_exists', passed: true }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'state_exists', key: 'x' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.recallRate).toBe(0);
      expect(metrics.facts.untested).toBe(1);
    });

    test('merges assertion configs with results by index alignment', () => {
      const registry = makeFactRegistry([
        { factId: 'f1' },
        { factId: 'f2' }
      ]);
      // Assertions in specific order — index alignment is critical
      const assertionResults = [
        { type: 'recall_contains', passed: true },
        { type: 'recall_contains', passed: false }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'recall_contains', factId: 'f2' }
        ]
      };
      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      // f1 → recalled (index 0 passed), f2 → forgotten (index 1 failed)
      expect(metrics.factDetails[0].result).toBe('recalled');
      expect(metrics.factDetails[1].result).toBe('forgotten');
    });
  });

  // ===================================================================
  // 8.9 analyzeResults()
  // ===================================================================

  describe('analyzeResults()', () => {
    let agent;

    beforeEach(async () => {
      const scenario = createMemoryScenario();
      const config = createSentinelConfig({ scenarios: [scenario] });
      agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
    });

    test('calls super.analyzeResults(testRunResult) with testRunResult param', async () => {
      const superAnalyze = jest.spyOn(BaseAgent.prototype, 'analyzeResults');
      const testRunResult = createMockTestRunResult([
        { scenarioId: 'test-memory-scenario', status: 'passed', steps: [], assertions: [] }
      ]);
      await agent.analyzeResults(testRunResult);
      expect(superAnalyze).toHaveBeenCalledWith(testRunResult);
      superAnalyze.mockRestore();
    });

    test('enriches scenario results with memory field', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [],
        assertions: [
          { type: 'recall_contains', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 },
          { type: 'no_contradiction', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 }
        ]
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].memory).toBeDefined();
      expect(analysis.scenarios[0].memory.facts).toBeDefined();
      expect(analysis.scenarios[0].memory.recallRate).toBeDefined();
    });

    test('enriches scenario results with phases field', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [
          { stepIndex: 0, status: 'passed' },
          { stepIndex: 1, status: 'passed' },
          { stepIndex: 2, status: 'passed' },
          { stepIndex: 3, status: 'passed' },
          { stepIndex: 4, status: 'passed' }
        ],
        assertions: [
          { type: 'recall_contains', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 },
          { type: 'no_contradiction', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 }
        ]
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].phases).toBeDefined();
      expect(analysis.scenarios[0].phases.setup).toBeDefined();
      expect(analysis.scenarios[0].phases.establish).toBeDefined();
      expect(analysis.scenarios[0].phases.recall).toBeDefined();
    });

    test('sets status to failed when recall below threshold', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [],
        assertions: [
          { type: 'recall_contains', passed: false, message: 'miss', expected: '', actual: '', durationMs: 1 },
          { type: 'no_contradiction', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 }
        ]
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].status).toBe('failed');
      expect(analysis.scenarios[0].memory.passed).toBe(false);
    });

    test('keeps status passed when recall meets threshold', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [],
        assertions: [
          { type: 'recall_contains', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 },
          { type: 'no_contradiction', passed: true, message: 'ok', expected: '', actual: '', durationMs: 1 }
        ]
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].status).toBe('passed');
      expect(analysis.scenarios[0].memory.passed).toBe(true);
    });

    test('handles scenario with no fact registry (returns unenriched)', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'nonexistent-scenario',
        status: 'passed',
        steps: [],
        assertions: []
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].memory).toBeUndefined();
    });

    test('handles scenario config not found (returns unenriched)', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'unknown-id',
        status: 'passed',
        steps: [],
        assertions: []
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].memory).toBeUndefined();
    });

    test('handles mixed: some scenarios pass, some fail', async () => {
      const scenario2 = createMemoryScenario({ id: 'scenario-2' });
      const config = createSentinelConfig({ scenarios: [createMemoryScenario(), scenario2] });
      const mixedAgent = new SentinelAgent(config, createMemoryMockConnector());
      await mixedAgent.initialize();

      const testRunResult = createMockTestRunResult([
        {
          scenarioId: 'test-memory-scenario',
          status: 'passed',
          steps: [],
          assertions: [
            { type: 'recall_contains', passed: true, message: '', expected: '', actual: '', durationMs: 1 },
            { type: 'no_contradiction', passed: true, message: '', expected: '', actual: '', durationMs: 1 }
          ]
        },
        {
          scenarioId: 'scenario-2',
          status: 'passed',
          steps: [],
          assertions: [
            { type: 'recall_contains', passed: false, message: '', expected: '', actual: '', durationMs: 1 },
            { type: 'no_contradiction', passed: true, message: '', expected: '', actual: '', durationMs: 1 }
          ]
        }
      ]);

      const analysis = await mixedAgent.analyzeResults(testRunResult);
      expect(analysis.scenarios[0].memory.passed).toBe(true);
      expect(analysis.scenarios[1].memory.passed).toBe(false);
    });

    test('returns scenarios array (not scenarioResults)', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [],
        assertions: []
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.scenarios).toBeDefined();
      expect(analysis.scenarioResults).toBeUndefined();
    });

    test('preserves base analysis fields (summary, durationMs, passRate)', async () => {
      const testRunResult = createMockTestRunResult([{
        scenarioId: 'test-memory-scenario',
        status: 'passed',
        steps: [],
        assertions: []
      }]);
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.summary).toBeDefined();
      expect(analysis.durationMs).toBeDefined();
      expect(analysis.passRate).toBeDefined();
    });
  });

  // ===================================================================
  // 8.10 Phase Metrics
  // ===================================================================

  describe('_computePhaseMetrics()', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    test('groups steps by phase from scenario config', () => {
      const scenario = {
        steps: [
          { action: 'a', phase: 'setup' },
          { action: 'b', phase: 'establish' },
          { action: 'c', phase: 'establish' },
          { action: 'd', phase: 'recall' }
        ]
      };
      const stepResults = [
        { status: 'passed' },
        { status: 'passed' },
        { status: 'passed' },
        { status: 'passed' }
      ];
      const phases = agent._computePhaseMetrics(scenario, stepResults);
      expect(phases.setup.steps).toBe(1);
      expect(phases.establish.steps).toBe(2);
      expect(phases.recall.steps).toBe(1);
    });

    test('counts passed/failed/skipped per phase', () => {
      const scenario = {
        steps: [
          { action: 'a', phase: 'setup' },
          { action: 'b', phase: 'establish' },
          { action: 'c', phase: 'establish' },
          { action: 'd', phase: 'recall' }
        ]
      };
      const stepResults = [
        { status: 'passed' },
        { status: 'passed' },
        { status: 'failed' },
        { status: 'skipped' }
      ];
      const phases = agent._computePhaseMetrics(scenario, stepResults);
      expect(phases.setup.passed).toBe(1);
      expect(phases.establish.passed).toBe(1);
      expect(phases.establish.failed).toBe(1);
      expect(phases.recall.skipped).toBe(1);
    });

    test('uses numeric index alignment (not stepId)', () => {
      const scenario = {
        steps: [
          { action: 'a', phase: 'setup' },
          { action: 'b', phase: 'recall' }
        ]
      };
      const stepResults = [
        { status: 'passed' },
        { status: 'failed' }
      ];
      const phases = agent._computePhaseMetrics(scenario, stepResults);
      // Index 0 → setup (passed), index 1 → recall (failed)
      expect(phases.setup.passed).toBe(1);
      expect(phases.recall.failed).toBe(1);
    });

    test('handles steps without phase field (grouped as unknown)', () => {
      const scenario = {
        steps: [
          { action: 'a' },
          { action: 'b', phase: 'recall' }
        ]
      };
      const stepResults = [
        { status: 'passed' },
        { status: 'passed' }
      ];
      const phases = agent._computePhaseMetrics(scenario, stepResults);
      expect(phases.unknown.steps).toBe(1);
      expect(phases.recall.steps).toBe(1);
    });

    test('handles missing step results (counted as skipped)', () => {
      const scenario = {
        steps: [
          { action: 'a', phase: 'setup' },
          { action: 'b', phase: 'recall' },
          { action: 'c', phase: 'recall' }
        ]
      };
      // Only 1 step result — steps at index 1 and 2 have no result
      const stepResults = [{ status: 'passed' }];
      const phases = agent._computePhaseMetrics(scenario, stepResults);
      expect(phases.setup.passed).toBe(1);
      expect(phases.recall.skipped).toBe(2);
    });
  });

  // ===================================================================
  // 8.11 generateReport()
  // ===================================================================

  describe('generateReport()', () => {
    let agent;

    beforeEach(async () => {
      agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
    });

    test('calls super.generateReport(analysis)', async () => {
      const superReport = jest.spyOn(BaseAgent.prototype, 'generateReport');
      const analysis = { summary: { total: 1, passed: 1, failed: 0 }, durationMs: 100, passRate: 1, scenarios: [] };
      await agent.generateReport(analysis);
      expect(superReport).toHaveBeenCalledWith(analysis);
      superReport.mockRestore();
    });

    test('includes memoryHealth in report', async () => {
      const analysis = { summary: { total: 1, passed: 1, failed: 0 }, durationMs: 100, passRate: 1, scenarios: [] };
      const report = await agent.generateReport(analysis);
      expect(report.memoryHealth).toBeDefined();
    });

    test('computes overallRecallRate across all scenarios', async () => {
      const analysis = {
        summary: { total: 1, passed: 1, failed: 0 },
        durationMs: 100,
        passRate: 1,
        scenarios: [{
          scenarioId: 'test',
          memory: {
            facts: { total: 3, recalled: 2, forgotten: 1, contradicted: 0, untested: 0 },
            recallRate: 2 / 3,
            passed: false,
            byCategory: {
              character: { total: 2, recalled: 1, forgotten: 1, contradicted: 0, rate: 0.5 },
              plot: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1 }
            }
          }
        }]
      };
      const report = await agent.generateReport(analysis);
      expect(report.memoryHealth.overallRecallRate).toBeCloseTo(2 / 3);
      expect(report.memoryHealth.factsRecalled).toBe(2);
      expect(report.memoryHealth.factsForgotten).toBe(1);
    });

    test('identifies weakCategories (below threshold)', async () => {
      const analysis = {
        summary: { total: 1, passed: 1, failed: 0 },
        durationMs: 100,
        passRate: 1,
        scenarios: [{
          scenarioId: 'test',
          memory: {
            facts: { total: 2, recalled: 1, forgotten: 1, contradicted: 0, untested: 0 },
            passed: false,
            byCategory: {
              character: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1 },
              setting: { total: 1, recalled: 0, forgotten: 1, contradicted: 0, rate: 0 }
            }
          }
        }]
      };
      const report = await agent.generateReport(analysis);
      expect(report.memoryHealth.weakCategories).toContain('setting');
      expect(report.memoryHealth.strongCategories).toContain('character');
    });

    test('identifies strongCategories (at or above threshold)', async () => {
      const analysis = {
        summary: { total: 1, passed: 1, failed: 0 },
        durationMs: 100,
        passRate: 1,
        scenarios: [{
          scenarioId: 'test',
          memory: {
            facts: { total: 2, recalled: 2, forgotten: 0, contradicted: 0, untested: 0 },
            passed: true,
            byCategory: {
              character: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1 },
              plot: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1 }
            }
          }
        }]
      };
      const report = await agent.generateReport(analysis);
      expect(report.memoryHealth.strongCategories).toContain('character');
      expect(report.memoryHealth.strongCategories).toContain('plot');
      expect(report.memoryHealth.weakCategories).toHaveLength(0);
    });

    test('passed is true only when ALL scenarios pass memory thresholds', async () => {
      const analysis = {
        summary: { total: 2, passed: 1, failed: 1 },
        durationMs: 100,
        passRate: 0.5,
        scenarios: [
          {
            scenarioId: 's1',
            memory: {
              facts: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, untested: 0 },
              passed: true,
              byCategory: {}
            }
          },
          {
            scenarioId: 's2',
            memory: {
              facts: { total: 1, recalled: 0, forgotten: 1, contradicted: 0, untested: 0 },
              passed: false,
              byCategory: {}
            }
          }
        ]
      };
      const report = await agent.generateReport(analysis);
      expect(report.memoryHealth.passed).toBe(false);
    });
  });

  // ===================================================================
  // 8.12 Threshold Cascading
  // ===================================================================

  describe('threshold cascading', () => {
    test('scenario threshold overrides config threshold', async () => {
      const scenario = createMemoryScenario({ recallThreshold: 0.5 });
      const config = createSentinelConfig({ recallThreshold: 0.9, scenarios: [scenario] });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
      expect(agent._getRecallThreshold(scenario)).toBe(0.5);
    });

    test('config threshold overrides default 0.85', async () => {
      const config = createSentinelConfig({ recallThreshold: 0.7 });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
      const scenario = { id: 'test' }; // no recallThreshold
      expect(agent._getRecallThreshold(scenario)).toBe(0.7);
    });

    test('default 0.85 used when neither scenario nor config set', async () => {
      const config = createSentinelConfig();
      delete config.recallThreshold;
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();
      const scenario = { id: 'test' };
      expect(agent._getRecallThreshold(scenario)).toBe(0.85);
    });

    test('contradiction threshold cascading: scenario -> config -> 0.0', async () => {
      const config = createSentinelConfig({ contradictionThreshold: 0.1 });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();

      // Scenario overrides config
      expect(agent._getContradictionThreshold({ contradictionThreshold: 0.05 })).toBe(0.05);
      // Config overrides default
      expect(agent._getContradictionThreshold({})).toBe(0.1);
      // Default when nothing set
      const config2 = createSentinelConfig();
      delete config2.contradictionThreshold;
      const agent2 = new SentinelAgent(config2, createMemoryMockConnector());
      await agent2.initialize();
      expect(agent2._getContradictionThreshold({})).toBe(0.0);
    });

    test('_getRecallThreshold handles undefined scenario', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();
      expect(agent._getRecallThreshold(undefined)).toBe(0.85);
    });
  });

  // ===================================================================
  // 8.13 Edge Cases
  // ===================================================================

  describe('edge cases', () => {
    test('scenario with zero distance steps (immediate recall)', async () => {
      const scenario = {
        id: 'immediate-recall',
        name: 'Immediate Recall',
        steps: [
          { action: 'create_session', phase: 'setup' },
          {
            action: 'send_message',
            params: { text: 'Marcus is a detective' },
            phase: 'establish',
            fact: { factId: 'f1', keywords: ['Marcus'], category: 'character' }
          },
          { action: 'wait_for_response', params: {}, phase: 'establish' },
          { action: 'send_message', params: { text: 'Who is Marcus?' }, phase: 'recall' },
          { action: 'wait_for_response', params: {}, phase: 'recall' }
        ],
        assertions: [
          { type: 'recall_contains', stepIndex: 4, factId: 'f1', keywords: ['Marcus'] }
        ]
      };
      const config = createSentinelConfig({ scenarios: [scenario] });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();

      // No distance phase at all — should work fine
      const registry = agent._factRegistries.get('immediate-recall');
      expect(registry.size).toBe(1);

      const phases = agent._computePhaseMetrics(scenario, [
        { status: 'passed' }, { status: 'passed' }, { status: 'passed' },
        { status: 'passed' }, { status: 'passed' }
      ]);
      expect(phases.distance).toBeUndefined();
      expect(phases.setup.steps).toBe(1);
      expect(phases.establish.steps).toBe(2);
      expect(phases.recall.steps).toBe(2);
    });

    test('scenario with all facts contradicted', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();

      const registry = new Map();
      registry.set('f1', { factId: 'f1', keywords: ['x'], contradictions: ['y'], category: 'a', establishedAtStepIndex: 0, recallResult: null });
      registry.set('f2', { factId: 'f2', keywords: ['a'], contradictions: ['b'], category: 'a', establishedAtStepIndex: 1, recallResult: null });

      const assertionResults = [
        { type: 'no_contradiction', passed: false },
        { type: 'no_contradiction', passed: false }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'no_contradiction', factId: 'f1' },
          { type: 'no_contradiction', factId: 'f2' }
        ]
      };

      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.facts.contradicted).toBe(2);
      expect(metrics.contradictionRate).toBe(1);
      expect(metrics.recallRate).toBe(0);
      expect(metrics.passed).toBe(false);
    });

    test('scenario with all facts forgotten', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();

      const registry = new Map();
      registry.set('f1', { factId: 'f1', keywords: ['x'], contradictions: [], category: 'a', establishedAtStepIndex: 0, recallResult: null });
      registry.set('f2', { factId: 'f2', keywords: ['y'], contradictions: [], category: 'b', establishedAtStepIndex: 1, recallResult: null });

      const assertionResults = [
        { type: 'recall_contains', passed: false },
        { type: 'recall_contains', passed: false }
      ];
      const scenario = {
        id: 'test',
        assertions: [
          { type: 'recall_contains', factId: 'f1' },
          { type: 'recall_contains', factId: 'f2' }
        ]
      };

      const metrics = agent._computeRecallMetrics(registry, assertionResults, scenario);
      expect(metrics.facts.forgotten).toBe(2);
      expect(metrics.recallRate).toBe(0);
      expect(metrics.passed).toBe(false);
    });

    test('very long scenario (20+ steps) processes correctly', async () => {
      const scenario = createMultiFactScenario({ factCount: 10 });
      const config = createSentinelConfig({ scenarios: [scenario] });
      const agent = new SentinelAgent(config, createMemoryMockConnector());
      await agent.initialize();

      const registry = agent._factRegistries.get('multi-fact-10');
      expect(registry.size).toBe(10);
      expect(scenario.steps.length).toBeGreaterThan(20);
    });

    test('_extractResponseText handles null/undefined/string/object results', async () => {
      const agent = new SentinelAgent(createSentinelConfig(), createMemoryMockConnector());
      await agent.initialize();

      // null stepResult
      expect(agent._extractResponseText(null)).toBe('');
      // undefined stepResult
      expect(agent._extractResponseText(undefined)).toBe('');
      // string result
      expect(agent._extractResponseText({ result: 'hello world' })).toBe('hello world');
      // object with text
      expect(agent._extractResponseText({ result: { text: 'Hello' } })).toBe('hello');
      // object with response
      expect(agent._extractResponseText({ result: { response: 'Hi' } })).toBe('hi');
      // object with content
      expect(agent._extractResponseText({ result: { content: 'Hey' } })).toBe('hey');
      // object with no recognized field
      expect(agent._extractResponseText({ result: { data: 123 } })).toBe('');
    });
  });
});
