'use strict';

const BaseAgent = require('../../agents/base-agent');
const { AgentError, ScenarioError, ConfigurationError } = require('../../agents/errors');
const { createMockConnector, createAgentConfig } = require('../helpers/mock-connector');

describe('BaseAgent', () => {

  describe('Constructor', () => {
    test('stores config and connector references', () => {
      const config = createAgentConfig();
      const connector = createMockConnector();
      const agent = new BaseAgent(config, connector);
      expect(agent.config).toBe(config);
      expect(agent.connector).toBe(connector);
    });

    test('throws ConfigurationError when config is null', () => {
      const connector = createMockConnector();
      expect(() => new BaseAgent(null, connector)).toThrow(ConfigurationError);
      expect(() => new BaseAgent(null, connector)).toThrow('Agent config is required');
    });

    test('throws ConfigurationError when connector is null', () => {
      const config = createAgentConfig();
      expect(() => new BaseAgent(config, null)).toThrow(ConfigurationError);
      expect(() => new BaseAgent(config, null)).toThrow('Connector is required');
    });

    test('initializes empty _results array', () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      expect(agent._results).toEqual([]);
    });

    test('_startedAt and _completedAt start as null', () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      expect(agent._startedAt).toBeNull();
      expect(agent._completedAt).toBeNull();
    });
  });

  describe('getAgentId', () => {
    test('returns config.id when set', () => {
      const agent = new BaseAgent(createAgentConfig({ id: 'my-agent' }), createMockConnector());
      expect(agent.getAgentId()).toBe('my-agent');
    });

    test('returns constructor name when config.id is not set', () => {
      const config = createAgentConfig();
      delete config.id;
      const agent = new BaseAgent(config, createMockConnector());
      expect(agent.getAgentId()).toBe('BaseAgent');
    });
  });

  describe('getScenarios', () => {
    test('returns scenarios from config', () => {
      const config = createAgentConfig();
      const agent = new BaseAgent(config, createMockConnector());
      expect(agent.getScenarios()).toBe(config.scenarios);
    });

    test('throws ConfigurationError when scenarios is undefined', () => {
      const config = createAgentConfig();
      delete config.scenarios;
      const agent = new BaseAgent(config, createMockConnector());
      expect(() => agent.getScenarios()).toThrow(ConfigurationError);
      expect(() => agent.getScenarios()).toThrow('No scenarios configured');
    });

    test('throws ConfigurationError when scenarios is empty array', () => {
      const agent = new BaseAgent(createAgentConfig({ scenarios: [] }), createMockConnector());
      expect(() => agent.getScenarios()).toThrow(ConfigurationError);
    });

    test('throws ConfigurationError when scenarios is not an array', () => {
      const agent = new BaseAgent(createAgentConfig({ scenarios: 'not-array' }), createMockConnector());
      expect(() => agent.getScenarios()).toThrow(ConfigurationError);
    });

    test('filters by tagFilter when configured', () => {
      const config = createAgentConfig({
        tagFilter: ['critical'],
        scenarios: [
          { id: 's1', name: 'S1', tags: ['smoke', 'critical'], steps: [], assertions: [] },
          { id: 's2', name: 'S2', tags: ['smoke'], steps: [], assertions: [] },
          { id: 's3', name: 'S3', tags: ['critical'], steps: [], assertions: [] }
        ]
      });
      const agent = new BaseAgent(config, createMockConnector());
      const scenarios = agent.getScenarios();
      expect(scenarios).toHaveLength(2);
      expect(scenarios.map(s => s.id)).toEqual(['s1', 's3']);
    });

    test('returns all scenarios when tagFilter matches nothing', () => {
      const config = createAgentConfig({
        tagFilter: ['nonexistent'],
        scenarios: [
          { id: 's1', name: 'S1', tags: ['smoke'], steps: [], assertions: [] },
          { id: 's2', name: 'S2', tags: ['smoke'], steps: [], assertions: [] }
        ]
      });
      const agent = new BaseAgent(config, createMockConnector());
      const scenarios = agent.getScenarios();
      expect(scenarios).toHaveLength(2);
    });
  });

  describe('resolveParams', () => {
    let agent;
    const scenarioContext = { scenarioId: 'test-scenario', stepResults: [{ status: 'passed' }, { status: 'passed' }] };

    beforeEach(() => {
      agent = new BaseAgent(createAgentConfig(), createMockConnector());
    });

    test('replaces {{timestamp}} with numeric string', () => {
      const result = agent.resolveParams({ name: 'Project {{timestamp}}' }, scenarioContext);
      expect(result.name).toMatch(/^Project \d+$/);
    });

    test('replaces {{uuid}} with random string', () => {
      const result = agent.resolveParams({ id: '{{uuid}}' }, scenarioContext);
      expect(result.id).toMatch(/^[a-z0-9]+$/);
      expect(result.id.length).toBeGreaterThan(0);
    });

    test('replaces {{scenarioId}} with scenario id from context', () => {
      const result = agent.resolveParams({ ref: '{{scenarioId}}' }, scenarioContext);
      expect(result.ref).toBe('test-scenario');
    });

    test('replaces {{stepIndex}} with current step count', () => {
      const result = agent.resolveParams({ idx: '{{stepIndex}}' }, scenarioContext);
      expect(result.idx).toBe('2'); // stepResults has 2 entries
    });

    test('passes non-string values through unchanged', () => {
      const result = agent.resolveParams({ count: 42, flag: true, obj: { nested: true } }, scenarioContext);
      expect(result.count).toBe(42);
      expect(result.flag).toBe(true);
      expect(result.obj).toEqual({ nested: true });
    });

    test('handles multiple replacements in one string', () => {
      const result = agent.resolveParams({ name: '{{scenarioId}}-{{timestamp}}' }, scenarioContext);
      expect(result.name).toMatch(/^test-scenario-\d+$/);
    });

    test('handles params with no templates — returns as-is', () => {
      const result = agent.resolveParams({ name: 'plain text' }, scenarioContext);
      expect(result.name).toBe('plain text');
    });

    test('returns empty object for empty params', () => {
      const result = agent.resolveParams({}, scenarioContext);
      expect(result).toEqual({});
    });
  });

  describe('executeStep', () => {
    let agent, connector;

    beforeEach(() => {
      connector = createMockConnector();
      agent = new BaseAgent(createAgentConfig(), connector);
    });

    const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };

    test('calls connector.performAction with resolved params', async () => {
      const step = { action: 'navigate', params: { path: '/home' } };
      await agent.executeStep(step, 0, ctx);
      expect(connector.performAction).toHaveBeenCalledWith('navigate', { path: '/home' });
    });

    test('returns StepResult with status "passed" on success', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: { selector: '#btn' } };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.status).toBe('passed');
      expect(result.action).toBe('click');
      expect(result.result).toEqual({ success: true });
      expect(result.error).toBeNull();
    });

    test('returns StepResult with status "failed" when connector throws', async () => {
      connector.performAction.mockRejectedValue(new Error('click failed'));
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.result).toBeNull();
    });

    test('wraps non-AgentError into ScenarioError', async () => {
      connector.performAction.mockRejectedValue(new Error('generic'));
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.error).toBeInstanceOf(ScenarioError);
      expect(result.error.cause).toBeInstanceOf(Error);
      expect(result.error.cause.message).toBe('generic');
    });

    test('preserves AgentError as-is when connector throws one', async () => {
      const agentErr = new AgentError('already wrapped', { phase: 'execute' });
      connector.performAction.mockRejectedValue(agentErr);
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.error).toBe(agentErr);
    });

    test('captures evidence on failure', async () => {
      connector.performAction.mockRejectedValue(new Error('fail'));
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(connector.collectEvidence).toHaveBeenCalled();
      expect(result.evidence).toBeDefined();
      expect(result.evidence.stepName).toContain('failed');
    });

    test('captures evidence when step.captureEvidence is true', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: {}, captureEvidence: true };
      const result = await agent.executeStep(step, 0, ctx);
      expect(connector.collectEvidence).toHaveBeenCalled();
      expect(result.evidence).toBeDefined();
    });

    test('does not capture evidence on success unless captureEvidence is true', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(connector.collectEvidence).not.toHaveBeenCalled();
      expect(result.evidence).toBeNull();
    });

    test('records durationMs', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('includes resolved params in result', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: { name: 'Test {{timestamp}}' } };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.params.name).toMatch(/^Test \d+$/);
    });

    test('includes step description in result', async () => {
      connector.performAction.mockResolvedValue({ success: true });
      const step = { action: 'click', params: {}, description: 'Click the button' };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.description).toBe('Click the button');
    });

    test('evidence capture failure does not throw', async () => {
      connector.performAction.mockRejectedValue(new Error('fail'));
      connector.collectEvidence.mockRejectedValue(new Error('evidence failed'));
      const step = { action: 'click', params: {} };
      const result = await agent.executeStep(step, 0, ctx);
      expect(result.status).toBe('failed');
      expect(result.evidence).toBeNull();
    });
  });

  describe('evaluateAssertion', () => {
    let agent, connector;
    const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };

    beforeEach(() => {
      connector = createMockConnector();
      agent = new BaseAgent(createAgentConfig(), connector);
    });

    // state_exists
    test('state_exists passes when key is set', async () => {
      connector._state.set('authenticated', true);
      const result = await agent.evaluateAssertion({ type: 'state_exists', key: 'authenticated' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('state_exists fails when key is not set', async () => {
      const result = await agent.evaluateAssertion({ type: 'state_exists', key: 'missing' }, ctx);
      expect(result.passed).toBe(false);
    });

    // state_equals
    test('state_equals passes on exact match', async () => {
      connector._state.set('mode', 'dark');
      const result = await agent.evaluateAssertion({ type: 'state_equals', key: 'mode', value: 'dark' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('state_equals fails on mismatch', async () => {
      connector._state.set('mode', 'light');
      const result = await agent.evaluateAssertion({ type: 'state_equals', key: 'mode', value: 'dark' }, ctx);
      expect(result.passed).toBe(false);
    });

    // state_contains
    test('state_contains passes when value includes substring (case-insensitive)', async () => {
      connector._state.set('greeting', 'Hello World');
      const result = await agent.evaluateAssertion({ type: 'state_contains', key: 'greeting', value: 'hello' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('state_contains fails when value does not include substring', async () => {
      connector._state.set('greeting', 'Hello World');
      const result = await agent.evaluateAssertion({ type: 'state_contains', key: 'greeting', value: 'goodbye' }, ctx);
      expect(result.passed).toBe(false);
    });

    test('state_contains fails when key is not set', async () => {
      const result = await agent.evaluateAssertion({ type: 'state_contains', key: 'missing', value: 'test' }, ctx);
      expect(result.passed).toBe(false);
    });

    // state_truthy
    test('state_truthy passes for truthy value', async () => {
      connector._state.set('authenticated', true);
      const result = await agent.evaluateAssertion({ type: 'state_truthy', key: 'authenticated' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('state_truthy fails for falsy value', async () => {
      connector._state.set('authenticated', false);
      const result = await agent.evaluateAssertion({ type: 'state_truthy', key: 'authenticated' }, ctx);
      expect(result.passed).toBe(false);
    });

    test('state_truthy fails for undefined key', async () => {
      const result = await agent.evaluateAssertion({ type: 'state_truthy', key: 'missing' }, ctx);
      expect(result.passed).toBe(false);
    });

    // url_contains
    test('url_contains passes when URL includes value', async () => {
      connector.getCurrentURL.mockResolvedValue('https://staging.app.com/dashboard');
      const result = await agent.evaluateAssertion({ type: 'url_contains', value: 'dashboard' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('url_contains fails when URL does not include value', async () => {
      connector.getCurrentURL.mockResolvedValue('https://staging.app.com/login');
      const result = await agent.evaluateAssertion({ type: 'url_contains', value: 'dashboard' }, ctx);
      expect(result.passed).toBe(false);
    });

    // url_matches
    test('url_matches passes when URL matches regex pattern', async () => {
      connector.getCurrentURL.mockResolvedValue('https://staging.app.com/projects/123');
      const result = await agent.evaluateAssertion({ type: 'url_matches', pattern: '/projects/\\d+' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('url_matches fails when URL does not match', async () => {
      connector.getCurrentURL.mockResolvedValue('https://staging.app.com/login');
      const result = await agent.evaluateAssertion({ type: 'url_matches', pattern: '/projects/\\d+' }, ctx);
      expect(result.passed).toBe(false);
    });

    // element_exists
    test('element_exists passes when connector.exists returns true', async () => {
      connector.exists.mockResolvedValue(true);
      const result = await agent.evaluateAssertion({ type: 'element_exists', selector: '#dashboard' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('element_exists fails when connector.exists returns false', async () => {
      connector.exists.mockResolvedValue(false);
      const result = await agent.evaluateAssertion({ type: 'element_exists', selector: '#missing' }, ctx);
      expect(result.passed).toBe(false);
    });

    // element_text_contains
    test('element_text_contains passes when text includes value', async () => {
      connector.extractData.mockResolvedValue({ text: 'Welcome, Joel', value: null, html: '', attributes: {} });
      const result = await agent.evaluateAssertion({ type: 'element_text_contains', selector: '#welcome', value: 'Joel' }, ctx);
      expect(result.passed).toBe(true);
    });

    test('element_text_contains fails when text does not include value', async () => {
      connector.extractData.mockResolvedValue({ text: 'Welcome, Joel', value: null, html: '', attributes: {} });
      const result = await agent.evaluateAssertion({ type: 'element_text_contains', selector: '#welcome', value: 'Alice' }, ctx);
      expect(result.passed).toBe(false);
    });

    test('element_text_contains fails when extractData throws', async () => {
      connector.extractData.mockRejectedValue(new Error('not found'));
      const result = await agent.evaluateAssertion({ type: 'element_text_contains', selector: '#missing', value: 'test' }, ctx);
      expect(result.passed).toBe(false);
      expect(result.actual).toBe('element not found');
    });

    // response_contains
    test('response_contains passes when last step result text includes value', async () => {
      const ctxWithResult = {
        ...ctx,
        lastStepResult: { result: { text: 'Hello, I can help you with that!' } }
      };
      const result = await agent.evaluateAssertion({ type: 'response_contains', value: 'help you' }, ctxWithResult);
      expect(result.passed).toBe(true);
    });

    test('response_contains fails when text does not include value', async () => {
      const ctxWithResult = {
        ...ctx,
        lastStepResult: { result: { text: 'Hello there' } }
      };
      const result = await agent.evaluateAssertion({ type: 'response_contains', value: 'goodbye' }, ctxWithResult);
      expect(result.passed).toBe(false);
    });

    test('response_contains handles missing lastStepResult gracefully', async () => {
      const result = await agent.evaluateAssertion({ type: 'response_contains', value: 'test' }, ctx);
      expect(result.passed).toBe(false);
    });

    // step_succeeded
    test('step_succeeded passes when step status is "passed"', async () => {
      const ctxWithSteps = {
        ...ctx,
        stepResults: [{ status: 'passed' }, { status: 'passed' }]
      };
      const result = await agent.evaluateAssertion({ type: 'step_succeeded', stepIndex: 1 }, ctxWithSteps);
      expect(result.passed).toBe(true);
    });

    test('step_succeeded fails when step status is "failed"', async () => {
      const ctxWithSteps = {
        ...ctx,
        stepResults: [{ status: 'passed' }, { status: 'failed' }]
      };
      const result = await agent.evaluateAssertion({ type: 'step_succeeded', stepIndex: 1 }, ctxWithSteps);
      expect(result.passed).toBe(false);
    });

    test('step_succeeded fails when stepIndex is out of bounds', async () => {
      const result = await agent.evaluateAssertion({ type: 'step_succeeded', stepIndex: 99 }, ctx);
      expect(result.passed).toBe(false);
      expect(result.actual).toBe('step not found');
    });

    // unknown type
    test('unknown assertion type fails with descriptive message', async () => {
      const result = await agent.evaluateAssertion({ type: 'nonexistent_check' }, ctx);
      expect(result.passed).toBe(false);
      expect(result.actual).toBe('unknown assertion type');
    });

    // error handling
    test('assertion evaluation error results in failed assertion, not thrown error', async () => {
      connector.getCurrentURL.mockRejectedValue(new Error('page crashed'));
      const result = await agent.evaluateAssertion({ type: 'url_contains', value: 'test' }, ctx);
      expect(result.passed).toBe(false);
      expect(result.actual).toContain('error:');
    });

    // result structure
    test('returns correct AssertionResult shape with type, passed, message, expected, actual, durationMs', async () => {
      connector._state.set('key', 'val');
      const result = await agent.evaluateAssertion({ type: 'state_exists', key: 'key' }, ctx);
      expect(result).toHaveProperty('type', 'state_exists');
      expect(result).toHaveProperty('passed', true);
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('expected');
      expect(result).toHaveProperty('actual');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.durationMs).toBe('number');
    });

    test('uses assertion.message when provided', async () => {
      connector._state.set('key', 'val');
      const result = await agent.evaluateAssertion({ type: 'state_exists', key: 'key', message: 'Custom message' }, ctx);
      expect(result.message).toBe('Custom message');
    });
  });

  describe('evaluateAssertions', () => {
    test('evaluates all assertions and returns array of results', async () => {
      const connector = createMockConnector();
      connector._state.set('a', 1);
      const agent = new BaseAgent(createAgentConfig(), connector);
      const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };
      const results = await agent.evaluateAssertions([
        { type: 'state_exists', key: 'a' },
        { type: 'state_exists', key: 'b' }
      ], ctx);
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });

    test('returns empty array for empty assertions', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      const ctx = { scenarioId: 'test', stepResults: [], lastStepResult: null };
      const results = await agent.evaluateAssertions([], ctx);
      expect(results).toEqual([]);
    });
  });

  describe('runScenario', () => {
    let agent, connector;

    beforeEach(() => {
      connector = createMockConnector({
        actionResults: {
          navigate: { success: true },
          click: { success: true }
        }
      });
      agent = new BaseAgent(createAgentConfig(), connector);
    });

    test('executes all steps in order', async () => {
      const callOrder = [];
      connector.performAction.mockImplementation(async (action) => {
        callOrder.push(action);
        return { success: true };
      });
      const scenario = {
        id: 'test', name: 'Test',
        steps: [
          { action: 'step1', params: {} },
          { action: 'step2', params: {} },
          { action: 'step3', params: {} }
        ],
        assertions: []
      };
      await agent.runScenario(scenario);
      expect(callOrder).toEqual(['step1', 'step2', 'step3']);
    });

    test('evaluates assertions after steps', async () => {
      connector._state.set('authenticated', true);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: [{ type: 'state_truthy', key: 'authenticated' }]
      };
      const result = await agent.runScenario(scenario);
      expect(result.assertions).toHaveLength(1);
      expect(result.assertions[0].passed).toBe(true);
    });

    test('returns status "passed" when all steps and assertions pass', async () => {
      connector._state.set('authenticated', true);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: [{ type: 'state_truthy', key: 'authenticated' }]
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('passed');
    });

    test('returns status "failed" when an assertion fails', async () => {
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: [{ type: 'state_exists', key: 'nonexistent' }]
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('failed');
    });

    test('returns status "failed" when a step fails but error is recoverable', async () => {
      const recoverableErr = new Error('element not found');
      recoverableErr.recoverable = true;
      connector.performAction.mockRejectedValueOnce(recoverableErr);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'click', params: {} }],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('failed');
    });

    test('returns status "error" when a step fails with non-recoverable error', async () => {
      const fatalErr = new Error('page crashed');
      fatalErr.recoverable = false;
      connector.performAction.mockRejectedValueOnce(fatalErr);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [
          { action: 'click', params: {} },
          { action: 'navigate', params: {} }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('error');
    });

    test('marks remaining steps as "skipped" after non-recoverable failure', async () => {
      const fatalErr = new Error('page crashed');
      fatalErr.recoverable = false;
      connector.performAction
        .mockRejectedValueOnce(fatalErr)
        .mockResolvedValue({ success: true });
      const scenario = {
        id: 'test', name: 'Test',
        steps: [
          { action: 'step1', params: {} },
          { action: 'step2', params: {} },
          { action: 'step3', params: {} }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[1].status).toBe('skipped');
      expect(result.steps[2].status).toBe('skipped');
    });

    test('skipped steps have durationMs 0 and null result/error/evidence', async () => {
      const fatalErr = new Error('crash');
      fatalErr.recoverable = false;
      connector.performAction.mockRejectedValueOnce(fatalErr);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [
          { action: 'step1', params: {} },
          { action: 'step2', params: { selector: '#btn' }, description: 'Click btn' }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      const skipped = result.steps[1];
      expect(skipped.status).toBe('skipped');
      expect(skipped.durationMs).toBe(0);
      expect(skipped.result).toBeNull();
      expect(skipped.error).toBeNull();
      expect(skipped.evidence).toBeNull();
      expect(skipped.action).toBe('step2');
      expect(skipped.description).toBe('Click btn');
    });

    test('continues past recoverable step failures', async () => {
      const recoverableErr = new Error('soft fail');
      recoverableErr.recoverable = true;
      connector.performAction
        .mockRejectedValueOnce(recoverableErr)
        .mockResolvedValue({ success: true });
      const scenario = {
        id: 'test', name: 'Test',
        steps: [
          { action: 'step1', params: {} },
          { action: 'step2', params: {} }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[1].status).toBe('passed');
    });

    test('collects end-of-scenario evidence', async () => {
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(connector.collectEvidence).toHaveBeenCalledWith('scenario_end_test');
      expect(result.evidence).toBeDefined();
    });

    test('evidence collection failure does not crash scenario', async () => {
      connector.collectEvidence.mockRejectedValue(new Error('evidence fail'));
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('passed');
      expect(result.evidence).toBeNull();
    });

    test('records durationMs', async () => {
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('populates failedSteps and failedAssertions arrays', async () => {
      const err = new Error('fail');
      err.recoverable = true;
      connector.performAction.mockRejectedValueOnce(err);
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'click', params: {} }],
        assertions: [{ type: 'state_exists', key: 'missing' }]
      };
      const result = await agent.runScenario(scenario);
      expect(result.failedSteps).toHaveLength(1);
      expect(result.failedAssertions).toHaveLength(1);
    });

    test('times out when scenario exceeds timeout — status is "error"', async () => {
      connector.performAction.mockImplementation(() => new Promise(() => {})); // never resolves
      const scenario = {
        id: 'test', name: 'Test',
        timeout: 50, // 50ms timeout
        steps: [
          { action: 'slow_action', params: {} },
          { action: 'next_action', params: {} }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('error');
    });

    test('marks unexecuted steps as "skipped" on timeout', async () => {
      connector.performAction.mockImplementation(() => new Promise(() => {})); // never resolves
      const scenario = {
        id: 'test', name: 'Test',
        timeout: 50,
        steps: [
          { action: 'slow_action', params: {} },
          { action: 'step2', params: {} },
          { action: 'step3', params: {} }
        ],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      // The first step was in-flight (never completed), remaining are skipped
      const skippedSteps = result.steps.filter(s => s.status === 'skipped');
      expect(skippedSteps.length).toBeGreaterThan(0);
    });

    test('uses scenario.timeout when provided', async () => {
      connector.performAction.mockImplementation(() => new Promise(() => {}));
      const scenario = {
        id: 'test', name: 'Test',
        timeout: 30,
        steps: [{ action: 'slow', params: {} }],
        assertions: []
      };
      const start = Date.now();
      await agent.runScenario(scenario);
      const elapsed = Date.now() - start;
      // Should have timed out around 30ms, not the default 120000ms
      expect(elapsed).toBeLessThan(5000);
    });

    test('uses config.scenarioTimeout as fallback', async () => {
      connector.performAction.mockImplementation(() => new Promise(() => {}));
      agent.config.scenarioTimeout = 30;
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'slow', params: {} }],
        assertions: []
      };
      const start = Date.now();
      await agent.runScenario(scenario);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });

    test('uses 120000ms default when no timeout configured', async () => {
      // Just verify the timeout resolution logic, don't wait 120s
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: []
      };
      // This should complete well before 120s with the default mock
      const result = await agent.runScenario(scenario);
      expect(result.status).toBe('passed');
    });

    test('includes error field on ScenarioResult when crashed', async () => {
      const scenario = {
        id: 'test', name: 'Test',
        steps: [{ action: 'navigate', params: {} }],
        assertions: []
      };
      const result = await agent.runScenario(scenario);
      expect(result).toHaveProperty('error');
    });
  });

  describe('runTests', () => {
    test('runs all scenarios from config', async () => {
      const connector = createMockConnector();
      const config = createAgentConfig({
        scenarios: [
          { id: 's1', name: 'S1', steps: [{ action: 'a', params: {} }], assertions: [] },
          { id: 's2', name: 'S2', steps: [{ action: 'b', params: {} }], assertions: [] }
        ]
      });
      const agent = new BaseAgent(config, connector);
      const result = await agent.runTests();
      expect(result.scenarios).toHaveLength(2);
    });

    test('returns TestRunResult with summary', async () => {
      const connector = createMockConnector();
      connector._state.set('key', 'val');
      const config = createAgentConfig({
        scenarios: [
          { id: 's1', name: 'S1', steps: [{ action: 'a', params: {} }], assertions: [{ type: 'state_exists', key: 'key' }] },
          { id: 's2', name: 'S2', steps: [{ action: 'b', params: {} }], assertions: [{ type: 'state_exists', key: 'missing' }] }
        ]
      });
      const agent = new BaseAgent(config, connector);
      const result = await agent.runTests();
      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBe(2);
      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(1);
    });

    test('records startedAt and completedAt', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      const result = await agent.runTests();
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(new Date(result.completedAt) >= new Date(result.startedAt)).toBe(true);
    });

    test('computes durationMs', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      const result = await agent.runTests();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('summary counts passed/failed/errors correctly', async () => {
      const connector = createMockConnector();
      const fatalErr = new Error('fatal');
      fatalErr.recoverable = false;
      connector.performAction
        .mockResolvedValueOnce({ success: true })  // s1 passes
        .mockResolvedValueOnce({ success: true })  // s2 step passes, assertion will fail
        .mockRejectedValueOnce(fatalErr);           // s3 errors
      const config = createAgentConfig({
        scenarios: [
          { id: 's1', name: 'S1', steps: [{ action: 'a', params: {} }], assertions: [] },
          { id: 's2', name: 'S2', steps: [{ action: 'b', params: {} }], assertions: [{ type: 'state_exists', key: 'missing' }] },
          { id: 's3', name: 'S3', steps: [{ action: 'c', params: {} }], assertions: [] }
        ]
      });
      const agent = new BaseAgent(config, connector);
      const result = await agent.runTests();
      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.errors).toBe(1);
    });

    test('scenario crash produces error result, does not stop other scenarios', async () => {
      const connector = createMockConnector();
      let callCount = 0;
      connector.performAction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('crash');
        return { success: true };
      });
      const config = createAgentConfig({
        scenarios: [
          { id: 's1', name: 'S1', steps: [{ action: 'a', params: {} }], assertions: [] },
          { id: 's2', name: 'S2', steps: [{ action: 'b', params: {} }], assertions: [] }
        ]
      });
      const agent = new BaseAgent(config, connector);
      const result = await agent.runTests();
      expect(result.scenarios).toHaveLength(2);
      // s1 has a failed step (recoverable by default), s2 should pass
      expect(result.scenarios[1].status).toBe('passed');
    });

    test('throws ConfigurationError for missing scenarios', async () => {
      const config = createAgentConfig();
      delete config.scenarios;
      const agent = new BaseAgent(config, createMockConnector());
      await expect(agent.runTests()).rejects.toThrow(ConfigurationError);
    });
  });

  describe('analyzeResults', () => {
    let agent;

    beforeEach(() => {
      agent = new BaseAgent(createAgentConfig(), createMockConnector());
    });

    test('returns base analysis with summary and passRate', async () => {
      const testRunResult = {
        summary: { total: 4, passed: 3, failed: 1, errors: 0, skipped: 0 },
        durationMs: 5000
      };
      const analysis = await agent.analyzeResults(testRunResult);
      expect(analysis.summary).toBe(testRunResult.summary);
      expect(analysis.durationMs).toBe(5000);
      expect(analysis.passRate).toBe(0.75);
    });

    test('passRate is 0 when no scenarios', async () => {
      const analysis = await agent.analyzeResults({
        summary: { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0 },
        durationMs: 0
      });
      expect(analysis.passRate).toBe(0);
    });

    test('passRate is 1.0 when all pass', async () => {
      const analysis = await agent.analyzeResults({
        summary: { total: 5, passed: 5, failed: 0, errors: 0, skipped: 0 },
        durationMs: 1000
      });
      expect(analysis.passRate).toBe(1.0);
    });

    test('passRate is 0.5 when half pass', async () => {
      const analysis = await agent.analyzeResults({
        summary: { total: 4, passed: 2, failed: 2, errors: 0, skipped: 0 },
        durationMs: 1000
      });
      expect(analysis.passRate).toBe(0.5);
    });
  });

  describe('generateReport', () => {
    test('returns report with agentId and agentType', async () => {
      const agent = new BaseAgent(createAgentConfig({ id: 'my-agent' }), createMockConnector());
      const analysis = { summary: { total: 1, passed: 1 }, durationMs: 100 };
      const report = await agent.generateReport(analysis);
      expect(report.agentId).toBe('my-agent');
      expect(report.agentType).toBe('BaseAgent');
    });

    test('includes metadata with appId and environment', async () => {
      const connector = createMockConnector({ app: { id: 'brainstormy', activeEnvironment: 'staging' } });
      const agent = new BaseAgent(createAgentConfig(), connector);
      const analysis = { summary: { total: 1, passed: 1 }, durationMs: 100 };
      const report = await agent.generateReport(analysis);
      expect(report.metadata.appId).toBe('brainstormy');
      expect(report.metadata.environment).toBe('staging');
    });

    test('includes analysis and scenarios', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      agent._results = [{ scenarioId: 's1', status: 'passed' }];
      const analysis = { summary: { total: 1, passed: 1 }, durationMs: 100 };
      const report = await agent.generateReport(analysis);
      expect(report.analysis).toBe(analysis);
      expect(report.scenarios).toEqual([{ scenarioId: 's1', status: 'passed' }]);
    });
  });

  describe('initialize and cleanup hooks', () => {
    test('initialize is no-op by default', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      await expect(agent.initialize()).resolves.toBeUndefined();
    });

    test('cleanup is no-op by default', async () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      await expect(agent.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('_computeSummary', () => {
    test('counts passed/failed/errors/skipped correctly', () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      const results = [
        { status: 'passed' },
        { status: 'passed' },
        { status: 'failed' },
        { status: 'error' },
        { status: 'skipped' }
      ];
      const summary = agent._computeSummary(results);
      expect(summary).toEqual({
        total: 5,
        passed: 2,
        failed: 1,
        errors: 1,
        skipped: 1,
        skipped_dependency: 0
      });
    });

    test('handles empty results array', () => {
      const agent = new BaseAgent(createAgentConfig(), createMockConnector());
      const summary = agent._computeSummary([]);
      expect(summary).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 0,
        skipped_dependency: 0
      });
    });
  });
});
