'use strict';

const TestOrchestrator = require('../../core/engine/test-orchestrator');
const { ConfigurationError } = require('../../agents/errors');

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function createMockTestRunResult(agentId, overrides = {}) {
  return {
    agentId,
    scenarios: overrides.scenarios || [
      { id: 'scenario-1', name: 'Test Scenario', status: 'passed', steps: [], durationMs: 100 }
    ],
    summary: {
      total: 1, passed: 1, failed: 0, errors: 0, skipped: 0,
      ...overrides.summary
    },
    durationMs: overrides.durationMs || 100,
    startedAt: overrides.startedAt || new Date().toISOString(),
    completedAt: overrides.completedAt || new Date().toISOString(),
    ...overrides
  };
}

function createFailedTestRunResult(agentId) {
  return createMockTestRunResult(agentId, {
    summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }
  });
}

function createMockAgentClass(overrides = {}) {
  const defaults = {
    initializeFn: async () => {},
    runTestsFn: null,
    cleanupFn: async () => {},
    agentId: 'mock-agent'
  };
  const opts = { ...defaults, ...overrides };

  return class MockAgent {
    constructor(config, connector) {
      this.config = config;
      this.connector = connector;
      this._initialized = false;
      this._cleanedUp = false;
    }

    async initialize() {
      this._initialized = true;
      return opts.initializeFn();
    }

    async runTests() {
      if (opts.runTestsFn) {
        return opts.runTestsFn();
      }
      return createMockTestRunResult(opts.agentId);
    }

    async cleanup() {
      this._cleanedUp = true;
      return opts.cleanupFn();
    }
  };
}

function createThrowingAgentClass(phase, error = new Error('Agent crashed')) {
  return createMockAgentClass({
    initializeFn: phase === 'initialize' ? async () => { throw error; } : async () => {},
    runTestsFn: phase === 'runTests' ? async () => { throw error; } : null,
    cleanupFn: phase === 'cleanup' ? async () => { throw error; } : async () => {}
  });
}

function createMockConnectorFactory(overrides = {}) {
  const mockConnector = {
    initialize: overrides.initializeFn || jest.fn().mockResolvedValue(undefined),
    cleanup: overrides.cleanupFn || jest.fn().mockResolvedValue(undefined),
    performAction: jest.fn().mockResolvedValue({}),
    ...overrides.extraMethods
  };

  return {
    create: overrides.createFn || jest.fn().mockResolvedValue(mockConnector),
    _mockConnector: mockConnector
  };
}

function createMockStorage() {
  return { store: jest.fn().mockResolvedValue(undefined) };
}

function createMockNotifier() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function createMockFailureHandler() {
  return { handle: jest.fn().mockResolvedValue(undefined) };
}

function createTestOrchestrator(overrides = {}) {
  const factory = createMockConnectorFactory(overrides.connector);
  const storage = createMockStorage();
  const notifier = createMockNotifier();
  const failureHandler = createMockFailureHandler();

  const orchestrator = new TestOrchestrator({
    connectorFactory: factory,
    storage,
    notifier,
    failureHandler,
    generateRunId: () => 'run-test-001',
    ...overrides.orchestratorOptions
  });

  return { orchestrator, factory, storage, notifier, failureHandler };
}

const TEST_APP_CONFIG = {
  appId: 'test-app',
  connector: { type: 'generic' },
  baseUrl: 'http://localhost:3000'
};

const TEST_RUN_OPTIONS = {
  page: { url: () => 'http://localhost:3000', close: jest.fn() },
  evidenceCollector: { capture: jest.fn(), store: jest.fn() }
};

// ---------------------------------------------------------------------------
// Block 1: Constructor
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Constructor', () => {
  test('creates with default options', () => {
    const orchestrator = new TestOrchestrator();
    expect(orchestrator._agents).toBeInstanceOf(Map);
    expect(orchestrator._agents.size).toBe(0);
  });

  test('accepts custom connectorFactory', () => {
    const factory = createMockConnectorFactory();
    const orchestrator = new TestOrchestrator({ connectorFactory: factory });
    expect(orchestrator._connectorFactory).toBe(factory);
  });

  test('accepts custom storage dependency', () => {
    const storage = createMockStorage();
    const orchestrator = new TestOrchestrator({ storage });
    expect(orchestrator._storage).toBe(storage);
  });

  test('accepts custom notifier dependency', () => {
    const notifier = createMockNotifier();
    const orchestrator = new TestOrchestrator({ notifier });
    expect(orchestrator._notifier).toBe(notifier);
  });

  test('accepts custom failureHandler dependency', () => {
    const failureHandler = createMockFailureHandler();
    const orchestrator = new TestOrchestrator({ failureHandler });
    expect(orchestrator._failureHandler).toBe(failureHandler);
  });
});

// ---------------------------------------------------------------------------
// Block 2: Agent Registration
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Agent Registration', () => {
  describe('registerAgent', () => {
    test('registers an agent with valid arguments', () => {
      const { orchestrator } = createTestOrchestrator();
      const MockAgent = createMockAgentClass();
      orchestrator.registerAgent('test', MockAgent, { id: 'test', scenarios: [] });
      expect(orchestrator.getRegisteredAgents().length).toBe(1);
    });

    test('stores AgentClass, config, and tags', () => {
      const { orchestrator } = createTestOrchestrator();
      const MockAgent = createMockAgentClass();
      const config = { id: 'test', scenarios: [], tags: ['smoke'] };
      orchestrator.registerAgent('test', MockAgent, config);
      const reg = orchestrator.getRegisteredAgents()[0];
      expect(reg.agentId).toBe('test');
      expect(reg.AgentClass).toBe(MockAgent);
      expect(reg.config).toBe(config);
    });

    test('extracts tags from config.tags array', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('test', createMockAgentClass(), {
        id: 'test', scenarios: [], tags: ['smoke', 'critical']
      });
      const reg = orchestrator.getRegisteredAgents()[0];
      expect(reg.tags).toEqual(['smoke', 'critical']);
    });

    test('defaults tags to empty array when config has no tags', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('test', createMockAgentClass(), { id: 'test', scenarios: [] });
      const reg = orchestrator.getRegisteredAgents()[0];
      expect(reg.tags).toEqual([]);
    });

    test('allows overwriting an existing agent ID (re-registration)', () => {
      const { orchestrator } = createTestOrchestrator();
      const MockAgent1 = createMockAgentClass({ agentId: 'v1' });
      const MockAgent2 = createMockAgentClass({ agentId: 'v2' });
      orchestrator.registerAgent('test', MockAgent1, { id: 'test', scenarios: [] });
      orchestrator.registerAgent('test', MockAgent2, { id: 'test', scenarios: [] });
      expect(orchestrator.getRegisteredAgents().length).toBe(1);
      expect(orchestrator.getRegisteredAgents()[0].AgentClass).toBe(MockAgent2);
    });

    test('throws ConfigurationError for empty string agentId', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(() => orchestrator.registerAgent('', createMockAgentClass(), { id: 'x', scenarios: [] }))
        .toThrow(ConfigurationError);
    });

    test('throws ConfigurationError for non-string agentId', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(() => orchestrator.registerAgent(123, createMockAgentClass(), { id: 'x', scenarios: [] }))
        .toThrow(ConfigurationError);
    });

    test('throws ConfigurationError for non-function AgentClass', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(() => orchestrator.registerAgent('test', 'not-a-function', { id: 'x', scenarios: [] }))
        .toThrow(ConfigurationError);
    });

    test('throws ConfigurationError for null config', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(() => orchestrator.registerAgent('test', createMockAgentClass(), null))
        .toThrow(ConfigurationError);
    });

    test('throws ConfigurationError for non-object config', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(() => orchestrator.registerAgent('test', createMockAgentClass(), 'not-object'))
        .toThrow(ConfigurationError);
    });
  });

  describe('unregisterAgent', () => {
    test('removes a registered agent and returns true', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('test', createMockAgentClass(), { id: 'test', scenarios: [] });
      expect(orchestrator.unregisterAgent('test')).toBe(true);
      expect(orchestrator.getRegisteredAgents().length).toBe(0);
    });

    test('returns false for non-existent agent ID', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(orchestrator.unregisterAgent('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredAgents', () => {
    test('returns empty array when none registered', () => {
      const { orchestrator } = createTestOrchestrator();
      expect(orchestrator.getRegisteredAgents()).toEqual([]);
    });

    test('returns all registered agents', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      orchestrator.registerAgent('b', createMockAgentClass(), { id: 'b', scenarios: [] });
      expect(orchestrator.getRegisteredAgents().length).toBe(2);
    });

    test('preserves registration order', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('first', createMockAgentClass(), { id: 'first', scenarios: [] });
      orchestrator.registerAgent('second', createMockAgentClass(), { id: 'second', scenarios: [] });
      const agents = orchestrator.getRegisteredAgents();
      expect(agents[0].agentId).toBe('first');
      expect(agents[1].agentId).toBe('second');
    });
  });
});

// ---------------------------------------------------------------------------
// Block 3: Run Method Routing
// ---------------------------------------------------------------------------

describe('TestOrchestrator - run() routing', () => {
  let orchestrator, factory;

  beforeEach(() => {
    ({ orchestrator, factory } = createTestOrchestrator());
    orchestrator.registerAgent('agent1', createMockAgentClass({ agentId: 'agent1' }), {
      id: 'agent1', scenarios: [], tags: ['smoke']
    });
  });

  test('delegates to runAll when no selection options provided', async () => {
    const result = await orchestrator.run(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(1);
    expect(result.agentResults[0].agentId).toBe('agent1');
  });

  test('delegates to runAgents when options.agentIds provided', async () => {
    const result = await orchestrator.run(TEST_APP_CONFIG, {
      ...TEST_RUN_OPTIONS,
      agentIds: ['agent1']
    });
    expect(result.agentResults.length).toBe(1);
    expect(result.agentResults[0].agentId).toBe('agent1');
  });

  test('delegates to runByTag when options.tag provided', async () => {
    const result = await orchestrator.run(TEST_APP_CONFIG, {
      ...TEST_RUN_OPTIONS,
      tag: 'smoke'
    });
    expect(result.agentResults.length).toBe(1);
  });

  test('passes trigger option through to result', async () => {
    const result = await orchestrator.run(TEST_APP_CONFIG, {
      ...TEST_RUN_OPTIONS,
      trigger: 'scheduled'
    });
    expect(result.trigger).toBe('scheduled');
  });

  test('defaults trigger to manual', async () => {
    const result = await orchestrator.run(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.trigger).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// Block 4: runAll
// ---------------------------------------------------------------------------

describe('TestOrchestrator - runAll', () => {
  test('runs all registered agents and returns OrchestratorResult', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('a1', createMockAgentClass({ agentId: 'a1' }), { id: 'a1', scenarios: [] });
    orchestrator.registerAgent('a2', createMockAgentClass({ agentId: 'a2' }), { id: 'a2', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
    expect(result.summary.totalAgents).toBe(2);
  });

  test('throws ConfigurationError when no agents registered', async () => {
    const { orchestrator } = createTestOrchestrator();
    await expect(orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
    await expect(orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS))
      .rejects.toThrow('No agents registered');
  });

  test('throws ConfigurationError when options.page is missing', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await expect(orchestrator.runAll(TEST_APP_CONFIG, { evidenceCollector: {} }))
      .rejects.toThrow(ConfigurationError);
    await expect(orchestrator.runAll(TEST_APP_CONFIG, { evidenceCollector: {} }))
      .rejects.toThrow('options.page');
  });

  test('throws ConfigurationError when options.evidenceCollector is missing', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await expect(orchestrator.runAll(TEST_APP_CONFIG, { page: {} }))
      .rejects.toThrow(ConfigurationError);
    await expect(orchestrator.runAll(TEST_APP_CONFIG, { page: {} }))
      .rejects.toThrow('evidenceCollector');
  });

  test('creates connector via factory with appConfig, page, evidenceCollector, { skipInitialize: true }', async () => {
    const { orchestrator, factory } = createTestOrchestrator();
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(factory.create).toHaveBeenCalledWith(
      TEST_APP_CONFIG,
      TEST_RUN_OPTIONS.page,
      TEST_RUN_OPTIONS.evidenceCollector,
      { skipInitialize: true }
    );
  });

  test('initializes connector before running agents', async () => {
    const callOrder = [];
    const factory = createMockConnectorFactory({
      initializeFn: jest.fn(() => { callOrder.push('connector.init'); return Promise.resolve(); })
    });
    const AgentClass = createMockAgentClass({
      initializeFn: async () => { callOrder.push('agent.init'); },
      agentId: 'a'
    });
    const orchestrator = new TestOrchestrator({
      connectorFactory: factory,
      generateRunId: () => 'run-001'
    });
    orchestrator.registerAgent('a', AgentClass, { id: 'a', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(callOrder.indexOf('connector.init')).toBeLessThan(callOrder.indexOf('agent.init'));
  });

  test('calls cleanup on connector after all agents finish', async () => {
    const { orchestrator, factory } = createTestOrchestrator();
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(factory._mockConnector.cleanup).toHaveBeenCalled();
  });

  test('passes same connector instance to all agents', async () => {
    const connectors = [];
    const TrackingAgent = class {
      constructor(config, connector) { connectors.push(connector); }
      async initialize() {}
      async runTests() { return createMockTestRunResult('tracking'); }
      async cleanup() {}
    };
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('a', TrackingAgent, { id: 'a', scenarios: [] });
    orchestrator.registerAgent('b', TrackingAgent, { id: 'b', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(connectors.length).toBe(2);
    expect(connectors[0]).toBe(connectors[1]);
  });

  test('runs agents in registration order', async () => {
    const order = [];
    const makeAgent = (id) => createMockAgentClass({
      agentId: id,
      runTestsFn: async () => { order.push(id); return createMockTestRunResult(id); }
    });
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('first', makeAgent('first'), { id: 'first', scenarios: [] });
    orchestrator.registerAgent('second', makeAgent('second'), { id: 'second', scenarios: [] });
    orchestrator.registerAgent('third', makeAgent('third'), { id: 'third', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('includes correct appId from appConfig', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.appId).toBe('test-app');
  });
});

// ---------------------------------------------------------------------------
// Block 5: runAgents
// ---------------------------------------------------------------------------

describe('TestOrchestrator - runAgents', () => {
  let orchestrator;

  beforeEach(() => {
    ({ orchestrator } = createTestOrchestrator());
    orchestrator.registerAgent('a', createMockAgentClass({ agentId: 'a' }), { id: 'a', scenarios: [] });
    orchestrator.registerAgent('b', createMockAgentClass({ agentId: 'b' }), { id: 'b', scenarios: [] });
    orchestrator.registerAgent('c', createMockAgentClass({ agentId: 'c' }), { id: 'c', scenarios: [] });
  });

  test('runs only specified agents', async () => {
    const result = await orchestrator.runAgents(TEST_APP_CONFIG, ['a', 'c'], TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
    expect(result.agentResults.map(r => r.agentId)).toEqual(['a', 'c']);
  });

  test('preserves order of agentIds', async () => {
    const result = await orchestrator.runAgents(TEST_APP_CONFIG, ['c', 'a'], TEST_RUN_OPTIONS);
    expect(result.agentResults.map(r => r.agentId)).toEqual(['c', 'a']);
  });

  test('throws ConfigurationError for empty agentIds array', async () => {
    await expect(orchestrator.runAgents(TEST_APP_CONFIG, [], TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
  });

  test('throws ConfigurationError for non-array agentIds', async () => {
    await expect(orchestrator.runAgents(TEST_APP_CONFIG, 'not-array', TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
  });

  test('throws ConfigurationError when agent ID not registered', async () => {
    await expect(orchestrator.runAgents(TEST_APP_CONFIG, ['nonexistent'], TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
    await expect(orchestrator.runAgents(TEST_APP_CONFIG, ['nonexistent'], TEST_RUN_OPTIONS))
      .rejects.toThrow("Agent 'nonexistent' is not registered");
  });

  test('error message includes list of registered agents', async () => {
    await expect(orchestrator.runAgents(TEST_APP_CONFIG, ['missing'], TEST_RUN_OPTIONS))
      .rejects.toThrow(/Registered: \[a, b, c\]/);
  });

  test('only runs requested agents, skips others', async () => {
    const result = await orchestrator.runAgents(TEST_APP_CONFIG, ['b'], TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(1);
    expect(result.agentResults[0].agentId).toBe('b');
    expect(result.summary.totalAgents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Block 6: runByTag
// ---------------------------------------------------------------------------

describe('TestOrchestrator - runByTag', () => {
  let orchestrator;

  beforeEach(() => {
    ({ orchestrator } = createTestOrchestrator());
    orchestrator.registerAgent('a', createMockAgentClass({ agentId: 'a' }), {
      id: 'a', scenarios: [], tags: ['smoke', 'critical']
    });
    orchestrator.registerAgent('b', createMockAgentClass({ agentId: 'b' }), {
      id: 'b', scenarios: [], tags: ['smoke']
    });
    orchestrator.registerAgent('c', createMockAgentClass({ agentId: 'c' }), {
      id: 'c', scenarios: [], tags: ['memory']
    });
  });

  test('runs agents matching the tag', async () => {
    const result = await orchestrator.runByTag(TEST_APP_CONFIG, 'smoke', TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
  });

  test('skips agents without the tag', async () => {
    const result = await orchestrator.runByTag(TEST_APP_CONFIG, 'memory', TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(1);
    expect(result.agentResults[0].agentId).toBe('c');
  });

  test('throws ConfigurationError for empty tag', async () => {
    await expect(orchestrator.runByTag(TEST_APP_CONFIG, '', TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
  });

  test('throws ConfigurationError for non-string tag', async () => {
    await expect(orchestrator.runByTag(TEST_APP_CONFIG, 123, TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
  });

  test('throws ConfigurationError when no agents match tag', async () => {
    await expect(orchestrator.runByTag(TEST_APP_CONFIG, 'nonexistent', TEST_RUN_OPTIONS))
      .rejects.toThrow(ConfigurationError);
    await expect(orchestrator.runByTag(TEST_APP_CONFIG, 'nonexistent', TEST_RUN_OPTIONS))
      .rejects.toThrow("No agents match tag 'nonexistent'");
  });

  test('error message includes available tags', async () => {
    await expect(orchestrator.runByTag(TEST_APP_CONFIG, 'nonexistent', TEST_RUN_OPTIONS))
      .rejects.toThrow(/Available tags:/);
  });

  test('matches agents with multiple tags', async () => {
    const result = await orchestrator.runByTag(TEST_APP_CONFIG, 'critical', TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(1);
    expect(result.agentResults[0].agentId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// Block 7: Error Isolation — Agent Errors
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Agent Error Isolation', () => {
  test('continues to next agent when one crashes during initialize()', async () => {
    const { orchestrator } = createTestOrchestrator();
    const CrashAgent = createThrowingAgentClass('initialize');
    const GoodAgent = createMockAgentClass({ agentId: 'good' });
    orchestrator.registerAgent('crash', CrashAgent, { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', GoodAgent, { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
    expect(result.agentResults[1].agentId).toBe('good');
    expect(result.agentResults[1].error).toBeUndefined();
  });

  test('continues to next agent when one crashes during runTests()', async () => {
    const { orchestrator } = createTestOrchestrator();
    const CrashAgent = createThrowingAgentClass('runTests');
    const GoodAgent = createMockAgentClass({ agentId: 'good' });
    orchestrator.registerAgent('crash', CrashAgent, { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', GoodAgent, { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
    expect(result.agentResults[0].error).toBeDefined();
    expect(result.agentResults[1].error).toBeUndefined();
  });

  test('continues to next agent when one crashes during cleanup()', async () => {
    const { orchestrator } = createTestOrchestrator();
    const CrashAgent = createThrowingAgentClass('cleanup');
    const GoodAgent = createMockAgentClass({ agentId: 'good' });
    orchestrator.registerAgent('crash', CrashAgent, { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', GoodAgent, { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults.length).toBe(2);
    // Cleanup crash doesn't produce error result — result was already captured
    expect(result.agentResults[0].error).toBeUndefined();
    expect(result.agentResults[1].error).toBeUndefined();
  });

  test('records error result for crashed agent', async () => {
    const { orchestrator } = createTestOrchestrator();
    const CrashAgent = createThrowingAgentClass('initialize', new Error('Init failed'));
    orchestrator.registerAgent('crash', CrashAgent, { id: 'crash', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults[0].error).toBeDefined();
    expect(result.agentResults[0].error.message).toBe('Init failed');
  });

  test('error result has correct agentId', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('my-agent', createThrowingAgentClass('initialize'), { id: 'my-agent', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults[0].agentId).toBe('my-agent');
  });

  test('error result has empty scenarios array', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults[0].scenarios).toEqual([]);
  });

  test('error result summary has errors: 1', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults[0].summary.errors).toBe(1);
  });

  test('error result includes serialized error with message, name, stack', async () => {
    const { orchestrator } = createTestOrchestrator();
    const err = new TypeError('Bad type');
    orchestrator.registerAgent('crash', createThrowingAgentClass('initialize', err), { id: 'crash', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults[0].error.message).toBe('Bad type');
    expect(result.agentResults[0].error.name).toBe('TypeError');
    expect(result.agentResults[0].error.stack).toBeTruthy();
  });

  test('non-crashing agents still produce normal results', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('initialize'), { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', createMockAgentClass({ agentId: 'good' }), { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    const goodResult = result.agentResults.find(r => r.agentId === 'good');
    expect(goodResult.summary.passed).toBe(1);
    expect(goodResult.error).toBeUndefined();
  });

  test('overall status is error when any agent crashes', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', createMockAgentClass({ agentId: 'good' }), { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.overallStatus).toBe('error');
  });

  test('summary counts crashed agent as errorAgent', async () => {
    const { orchestrator } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
    orchestrator.registerAgent('good', createMockAgentClass({ agentId: 'good' }), { id: 'good', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.summary.errorAgents).toBe(1);
    expect(result.summary.passedAgents).toBe(1);
  });

  test('still cleans up connector after agent crash', async () => {
    const { orchestrator, factory } = createTestOrchestrator();
    orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(factory._mockConnector.cleanup).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block 8: Error Isolation — Connector Errors
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Connector Error Isolation', () => {
  test('returns error result when ConnectorFactory.create() throws', async () => {
    const factory = createMockConnectorFactory({
      createFn: jest.fn().mockRejectedValue(new Error('Factory boom'))
    });
    const orchestrator = new TestOrchestrator({
      connectorFactory: factory,
      generateRunId: () => 'run-001'
    });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.overallStatus).toBe('error');
    expect(result.connectorError.message).toBe('Factory boom');
  });

  test('returns error result when connector.initialize() throws', async () => {
    const factory = createMockConnectorFactory({
      initializeFn: jest.fn().mockRejectedValue(new Error('Init boom'))
    });
    const orchestrator = new TestOrchestrator({
      connectorFactory: factory,
      generateRunId: () => 'run-001'
    });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.overallStatus).toBe('error');
    expect(result.connectorError.message).toBe('Init boom');
  });

  test('connector error result has empty agentResults', async () => {
    const factory = createMockConnectorFactory({
      createFn: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.agentResults).toEqual([]);
  });

  test('connector error result has overallStatus error', async () => {
    const factory = createMockConnectorFactory({
      createFn: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.overallStatus).toBe('error');
  });

  test('connector error result includes connectorError with message and phase', async () => {
    const factory = createMockConnectorFactory({
      createFn: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.connectorError).toHaveProperty('message', 'boom');
    expect(result.connectorError).toHaveProperty('phase');
  });

  test('connector create error has phase create', async () => {
    const factory = createMockConnectorFactory({
      createFn: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.connectorError.phase).toBe('create');
  });

  test('connector initialize error has phase initialize', async () => {
    const factory = createMockConnectorFactory({
      initializeFn: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(result.connectorError.phase).toBe('initialize');
  });

  test('attempts connector cleanup even when initialize fails', async () => {
    const cleanupFn = jest.fn().mockResolvedValue(undefined);
    const factory = createMockConnectorFactory({
      initializeFn: jest.fn().mockRejectedValue(new Error('init boom')),
      cleanupFn
    });
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(cleanupFn).toHaveBeenCalled();
  });

  test('factory.create() called with appConfig, page, evidenceCollector, { skipInitialize: true }', async () => {
    const factory = createMockConnectorFactory();
    const orchestrator = new TestOrchestrator({ connectorFactory: factory, generateRunId: () => 'run-001' });
    orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
    await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
    expect(factory.create).toHaveBeenCalledWith(
      TEST_APP_CONFIG,
      TEST_RUN_OPTIONS.page,
      TEST_RUN_OPTIONS.evidenceCollector,
      { skipInitialize: true }
    );
  });
});

// ---------------------------------------------------------------------------
// Block 9: Result Aggregation
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Result Aggregation', () => {
  describe('summary computation', () => {
    test('counts all scenarios across agents', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 } })
      }), { id: 'a', scenarios: [] });
      orchestrator.registerAgent('b', createMockAgentClass({
        agentId: 'b',
        runTestsFn: async () => createMockTestRunResult('b', { summary: { total: 2, passed: 2, failed: 0, errors: 0, skipped: 0 } })
      }), { id: 'b', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.totalScenarios).toBe(5);
    });

    test('sums passed scenarios', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 3, passed: 2, failed: 1, errors: 0, skipped: 0 } })
      }), { id: 'a', scenarios: [] });
      orchestrator.registerAgent('b', createMockAgentClass({
        agentId: 'b',
        runTestsFn: async () => createMockTestRunResult('b', { summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 } })
      }), { id: 'b', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.passedScenarios).toBe(3);
    });

    test('sums failed scenarios', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 } })
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.failedScenarios).toBe(1);
    });

    test('sums error scenarios', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 3, passed: 1, failed: 0, errors: 2, skipped: 0 } })
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.errorScenarios).toBe(2);
    });

    test('sums skipped scenarios', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 3, passed: 1, failed: 0, errors: 0, skipped: 2 } })
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.skippedScenarios).toBe(2);
    });

    test('classifies agent with all passed as passedAgent', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({ agentId: 'a' }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.passedAgents).toBe(1);
    });

    test('classifies agent with any failed as failedAgent', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createFailedTestRunResult('a')
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.failedAgents).toBe(1);
    });

    test('classifies agent with errors (no crash) as errorAgent', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createMockTestRunResult('a', { summary: { total: 1, passed: 0, failed: 0, errors: 1, skipped: 0 } })
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.errorAgents).toBe(1);
    });

    test('classifies crashed agent as errorAgent', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.errorAgents).toBe(1);
    });

    test('totalAgents equals number of agents run', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({ agentId: 'a' }), { id: 'a', scenarios: [] });
      orchestrator.registerAgent('b', createMockAgentClass({ agentId: 'b' }), { id: 'b', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.summary.totalAgents).toBe(2);
    });
  });

  describe('overallStatus', () => {
    test('returns passed when all agents pass', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({ agentId: 'a' }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('passed');
    });

    test('returns failed when any agent has failed scenarios', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass({
        agentId: 'a',
        runTestsFn: async () => createFailedTestRunResult('a')
      }), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('failed');
    });

    test('returns error when any agent crashed', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('error');
    });

    test('error takes priority over failed', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('fail', createMockAgentClass({
        agentId: 'fail',
        runTestsFn: async () => createFailedTestRunResult('fail')
      }), { id: 'fail', scenarios: [] });
      orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('error');
    });

    test('failed takes priority over passed', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('good', createMockAgentClass({ agentId: 'good' }), { id: 'good', scenarios: [] });
      orchestrator.registerAgent('fail', createMockAgentClass({
        agentId: 'fail',
        runTestsFn: async () => createFailedTestRunResult('fail')
      }), { id: 'fail', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('failed');
    });
  });

  describe('OrchestratorResult shape', () => {
    test('includes runId', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.runId).toBe('run-test-001');
    });

    test('includes durationMs as positive number', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('includes startedAt and completedAt as ISO strings', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('includes trigger from options', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, { ...TEST_RUN_OPTIONS, trigger: 'pre-deploy' });
      expect(result.trigger).toBe('pre-deploy');
    });

    test('connectorError is null on success', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.connectorError).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Block 10: Injectable Dependencies
// ---------------------------------------------------------------------------

describe('TestOrchestrator - Injectable Dependencies', () => {
  describe('storage', () => {
    test('calls storage.store() with OrchestratorResult after run', async () => {
      const { orchestrator, storage } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(storage.store).toHaveBeenCalledWith(result);
    });

    test('does not fail run if storage.store() throws', async () => {
      const storage = { store: jest.fn().mockRejectedValue(new Error('Storage down')) };
      const orchestrator = new TestOrchestrator({
        connectorFactory: createMockConnectorFactory(),
        storage,
        generateRunId: () => 'run-001'
      });
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('passed');
    });

    test('default storage is no-op (no throw)', async () => {
      const orchestrator = new TestOrchestrator({
        connectorFactory: createMockConnectorFactory(),
        generateRunId: () => 'run-001'
      });
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      await expect(orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS)).resolves.toBeDefined();
    });
  });

  describe('notifier', () => {
    test('calls notifier.notify() with OrchestratorResult after run', async () => {
      const { orchestrator, notifier } = createTestOrchestrator();
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(notifier.notify).toHaveBeenCalledWith(result);
    });

    test('does not fail run if notifier.notify() throws', async () => {
      const notifier = { notify: jest.fn().mockRejectedValue(new Error('Notify down')) };
      const orchestrator = new TestOrchestrator({
        connectorFactory: createMockConnectorFactory(),
        notifier,
        generateRunId: () => 'run-001'
      });
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('passed');
    });

    test('default notifier is no-op (no throw)', async () => {
      const orchestrator = new TestOrchestrator({
        connectorFactory: createMockConnectorFactory(),
        generateRunId: () => 'run-001'
      });
      orchestrator.registerAgent('a', createMockAgentClass(), { id: 'a', scenarios: [] });
      await expect(orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS)).resolves.toBeDefined();
    });
  });

  describe('failureHandler', () => {
    test('calls failureHandler.handle() when overallStatus is not passed', async () => {
      const { orchestrator, failureHandler } = createTestOrchestrator();
      orchestrator.registerAgent('fail', createMockAgentClass({
        agentId: 'fail',
        runTestsFn: async () => createFailedTestRunResult('fail')
      }), { id: 'fail', scenarios: [] });
      await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(failureHandler.handle).toHaveBeenCalled();
    });

    test('does not call failureHandler.handle() when overallStatus is passed', async () => {
      const { orchestrator, failureHandler } = createTestOrchestrator();
      orchestrator.registerAgent('good', createMockAgentClass({ agentId: 'good' }), { id: 'good', scenarios: [] });
      await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(failureHandler.handle).not.toHaveBeenCalled();
    });

    test('does not fail run if failureHandler.handle() throws', async () => {
      const failureHandler = { handle: jest.fn().mockRejectedValue(new Error('Handler down')) };
      const orchestrator = new TestOrchestrator({
        connectorFactory: createMockConnectorFactory(),
        failureHandler,
        generateRunId: () => 'run-001'
      });
      orchestrator.registerAgent('crash', createThrowingAgentClass('runTests'), { id: 'crash', scenarios: [] });
      const result = await orchestrator.runAll(TEST_APP_CONFIG, TEST_RUN_OPTIONS);
      expect(result.overallStatus).toBe('error');
    });
  });
});
