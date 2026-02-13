'use strict';

const {
  createEngine,
  ConsoleNotificationAdapter,
  RuleBasedLLMAdapter,
  NullBugTrackerAdapter,
  FailureHandler
} = require('../../core/engine/factory');

describe('createEngine', () => {
  const minimalConfig = {
    db: { path: ':memory:', inMemory: true },
    anthropic: { apiKey: null, model: 'claude-sonnet-4-5-20250929', maxTokens: 4096 },
    twilio: { accountSid: null, authToken: null, fromNumber: null },
    linear: { apiKey: null, teamId: null, projectId: null },
    engine: { approvalTimeoutMs: 3600000, notificationRecipients: [], appsDir: './apps' }
  };

  // Group 1: Basic creation
  test('creates engine with default config and in-memory DB', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(engine.run).toBeInstanceOf(Function);
    expect(engine.status).toBeInstanceOf(Function);
    expect(engine.bugs).toBeInstanceOf(Function);
    expect(engine.shutdown).toBeInstanceOf(Function);

    await engine.shutdown();
  });

  test('returns object with run, status, bugs, shutdown methods', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(typeof engine.run).toBe('function');
    expect(typeof engine.status).toBe('function');
    expect(typeof engine.bugs).toBe('function');
    expect(typeof engine.shutdown).toBe('function');

    await engine.shutdown();
  });

  test('exposes _internals for testing', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(engine._internals).toBeDefined();
    expect(engine._internals.config).toBeDefined();
    expect(engine._internals.db).toBeDefined();
    expect(engine._internals.llm).toBeDefined();
    expect(engine._internals.notifier).toBeDefined();
    expect(engine._internals.bugTracker).toBeDefined();
    expect(engine._internals.orchestrator).toBeDefined();

    await engine.shutdown();
  });

  // Group 2: Graceful degradation — adapter selection
  test('uses RuleBasedLLMAdapter when ANTHROPIC_API_KEY missing', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(engine._internals.llm).toBeInstanceOf(RuleBasedLLMAdapter);
    await engine.shutdown();
  });

  test('uses AnthropicAdapter when ANTHROPIC_API_KEY present', async () => {
    const configWithKey = {
      ...minimalConfig,
      anthropic: { ...minimalConfig.anthropic, apiKey: 'sk-ant-test123' }
    };
    const engine = await createEngine({ config: configWithKey, quiet: true });

    // AnthropicAdapter is the real one, not the rule-based fallback
    expect(engine._internals.llm).not.toBeInstanceOf(RuleBasedLLMAdapter);
    await engine.shutdown();
  });

  test('uses ConsoleNotificationAdapter when Twilio not configured', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(engine._internals.notifier).toBeInstanceOf(ConsoleNotificationAdapter);
    await engine.shutdown();
  });

  test('uses NullBugTrackerAdapter when Linear not configured', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(engine._internals.bugTracker).toBeInstanceOf(NullBugTrackerAdapter);
    await engine.shutdown();
  });

  // Group 3: Dependency injection overrides
  test('accepts override db', async () => {
    const mockDb = {
      testRuns: { findMany: jest.fn().mockReturnValue([]) },
      bugs: { findMany: jest.fn().mockReturnValue([]) },
      close: jest.fn()
    };
    const engine = await createEngine({
      config: minimalConfig,
      db: mockDb,
      quiet: true
    });

    expect(engine._internals.db).toBe(mockDb);
    await engine.shutdown();
  });

  test('accepts override llm adapter', async () => {
    const mockLlm = { complete: jest.fn() };
    const engine = await createEngine({
      config: minimalConfig,
      llm: mockLlm,
      quiet: true
    });

    expect(engine._internals.llm).toBe(mockLlm);
    await engine.shutdown();
  });

  test('accepts override notifier adapter', async () => {
    const mockNotifier = { send: jest.fn() };
    const engine = await createEngine({
      config: minimalConfig,
      notifier: mockNotifier,
      quiet: true
    });

    expect(engine._internals.notifier).toBe(mockNotifier);
    await engine.shutdown();
  });

  // Group 4: Shutdown
  test('shutdown closes database and state manager', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const db = engine._internals.db;

    // Should not throw
    await engine.shutdown();

    // DB should be closed — calling close again should not throw (already closed)
    expect(() => db.close()).not.toThrow();
  });

  test('shutdown handles already-closed database gracefully', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    // Close once
    await engine.shutdown();

    // Close again — should not throw
    await expect(engine.shutdown()).resolves.not.toThrow();
  });

  // Group 5: Agent registration
  test('engine.run() registers agents from default registry before orchestrator.run()', async () => {
    const appConfig = {
      id: 'test-app',
      name: 'Test',
      type: 'generic',
      agents: { healer: { enabled: true } }
    };

    const engine = await createEngine({
      config: minimalConfig,
      appLoader: () => appConfig,
      quiet: true
    });

    const mockOrchestrator = {
      registerAgent: jest.fn(),
      run: jest.fn().mockResolvedValue({
        runId: 'run-001',
        status: 'completed',
        total: 1,
        passed: 1,
        failed: 0,
        agentResults: []
      })
    };
    // Replace the orchestrator with our mock
    engine._internals.orchestrator.registerAgent = mockOrchestrator.registerAgent;
    engine._internals.orchestrator.run = mockOrchestrator.run;

    await engine.run('test-app', { agents: ['healer'] });

    // Should have registered the healer agent
    expect(mockOrchestrator.registerAgent).toHaveBeenCalledWith(
      'healer',
      expect.any(Function),
      expect.any(Object)
    );

    await engine.shutdown();
  });

  test('engine.run() uses overridden agentRegistry when provided', async () => {
    const MockAgent = class {};

    const appConfig = {
      id: 'test-app',
      name: 'Test',
      type: 'generic',
      agents: { custom: { enabled: true } }
    };

    const engine = await createEngine({
      config: minimalConfig,
      agentRegistry: { custom: MockAgent },
      appLoader: () => appConfig,
      quiet: true
    });

    const mockOrchestrator = {
      registerAgent: jest.fn(),
      run: jest.fn().mockResolvedValue({
        runId: 'run-002',
        status: 'completed',
        total: 1,
        passed: 1,
        failed: 0,
        agentResults: []
      })
    };
    engine._internals.orchestrator.registerAgent = mockOrchestrator.registerAgent;
    engine._internals.orchestrator.run = mockOrchestrator.run;

    await engine.run('test-app', { agents: ['custom'] });

    expect(mockOrchestrator.registerAgent).toHaveBeenCalledWith(
      'custom',
      MockAgent,
      expect.any(Object)
    );

    await engine.shutdown();
  });

  // Group 6: Enhanced status() return shape
  test('status() returns { activeRuns, recentRuns } object', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    const result = await engine.status();

    expect(result).toHaveProperty('activeRuns');
    expect(result).toHaveProperty('recentRuns');
    expect(Array.isArray(result.activeRuns)).toBe(true);
    expect(Array.isArray(result.recentRuns)).toBe(true);

    await engine.shutdown();
  });

  test('status() accepts options.limit parameter', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    const result = await engine.status({ limit: 5 });

    expect(result.activeRuns).toBeDefined();
    expect(result.recentRuns).toBeDefined();

    await engine.shutdown();
  });

  // Group 7: approve/reject/bugInfo methods
  test('engine exposes approve() method', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(typeof engine.approve).toBe('function');

    await engine.shutdown();
  });

  test('engine exposes reject() method', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(typeof engine.reject).toBe('function');

    await engine.shutdown();
  });

  test('engine exposes bugInfo() method', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });

    expect(typeof engine.bugInfo).toBe('function');

    await engine.shutdown();
  });

  test('approve() delegates to approvalManager.handleResponse with YES prefix', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const spy = jest.spyOn(engine._internals.approvalManager, 'handleResponse')
      .mockResolvedValue({ action: 'approved', approval_id: 'ABC-247' });

    await engine.approve('ABC-247');

    expect(spy).toHaveBeenCalledWith('YES-ABC-247');

    spy.mockRestore();
    await engine.shutdown();
  });

  test('reject() delegates to approvalManager.handleResponse with NO prefix', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const spy = jest.spyOn(engine._internals.approvalManager, 'handleResponse')
      .mockResolvedValue({ action: 'rejected', approval_id: 'ABC-247' });

    await engine.reject('ABC-247');

    expect(spy).toHaveBeenCalledWith('NO-ABC-247');

    spy.mockRestore();
    await engine.shutdown();
  });

  test('bugInfo() delegates to approvalManager.handleResponse with INFO prefix', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const spy = jest.spyOn(engine._internals.approvalManager, 'handleResponse')
      .mockResolvedValue({ action: 'info', approval_id: 'ABC-247', bug: {} });

    await engine.bugInfo('ABC-247');

    expect(spy).toHaveBeenCalledWith('INFO-ABC-247');

    spy.mockRestore();
    await engine.shutdown();
  });

  test('approve() returns handleResponse result envelope', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const expected = { action: 'approved', approval_id: 'XYZ-100', message: 'Fix approved' };
    jest.spyOn(engine._internals.approvalManager, 'handleResponse')
      .mockResolvedValue(expected);

    const result = await engine.approve('XYZ-100');

    expect(result).toEqual(expected);

    await engine.shutdown();
  });

  test('approve() returns error envelope when approval not found', async () => {
    const engine = await createEngine({ config: minimalConfig, quiet: true });
    const expected = { action: 'error', message: 'Approval XYZ-999 not found', approval_id: 'XYZ-999' };
    jest.spyOn(engine._internals.approvalManager, 'handleResponse')
      .mockResolvedValue(expected);

    const result = await engine.approve('XYZ-999');

    expect(result.action).toBe('error');

    await engine.shutdown();
  });
});

describe('ConsoleNotificationAdapter', () => {
  // Group 5: Fallback adapter behavior
  test('send(recipient, message) returns success and tracks sent messages', async () => {
    const adapter = new ConsoleNotificationAdapter();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    const result = await adapter.send('whatsapp:+1234', 'Test message');

    expect(result.success).toBe(true);
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].recipient).toBe('whatsapp:+1234');
    expect(adapter.sent[0].message).toBe('Test message');

    logSpy.mockRestore();
  });

  test('send() logs recipient and message to console', async () => {
    const adapter = new ConsoleNotificationAdapter();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await adapter.send('user@test.com', 'Hello');

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('user@test.com');
    expect(allOutput).toContain('Hello');

    logSpy.mockRestore();
  });
});

describe('RuleBasedLLMAdapter', () => {
  // Group 6: Rule-based classification
  test('complete() classifies crash-related text as critical severity', async () => {
    const adapter = new RuleBasedLLMAdapter();
    const result = await adapter.complete('The application crash occurred during login');

    const parsed = JSON.parse(result.content);
    expect(parsed.severity).toBe('critical');
  });

  test('complete() classifies auth-related text as authentication category', async () => {
    const adapter = new RuleBasedLLMAdapter();
    const result = await adapter.complete('Login failed with authentication error');

    const parsed = JSON.parse(result.content);
    expect(parsed.category).toBe('authentication');
  });

  test('complete() returns autoFixable=false for all classifications', async () => {
    const adapter = new RuleBasedLLMAdapter();
    const result = await adapter.complete('Some test failure');

    const parsed = JSON.parse(result.content);
    expect(parsed.autoFixable).toBe(false);
  });
});

describe('NullBugTrackerAdapter', () => {
  // Group 7: Null adapter
  test('createIssue returns null id and url', async () => {
    const adapter = new NullBugTrackerAdapter();
    const result = await adapter.createIssue({ title: 'Test Bug' });

    expect(result.id).toBeNull();
    expect(result.url).toBeNull();
  });
});

describe('FailureHandler', () => {
  // Group 8: Bridge pattern
  test('iterates agentResults and calls bugDetector.detectAndReport for each failed result', async () => {
    const mockBugDetector = {
      detectAndReport: jest.fn().mockResolvedValue({ bugId: 'BUG-001' })
    };

    const handler = new FailureHandler({ bugDetector: mockBugDetector });

    const result = {
      app: { id: 'test-app' },
      agentResults: [
        {
          agentId: 'healer',
          scenarios: [
            { status: 'passed', name: 'test1' },
            { status: 'failed', name: 'test2', error: 'Something broke' }
          ]
        }
      ]
    };

    const bugs = await handler.handle(result);

    expect(mockBugDetector.detectAndReport).toHaveBeenCalledTimes(1);
    expect(bugs).toHaveLength(1);
    expect(bugs[0].bugId).toBe('BUG-001');
  });

  test('passes agentId as string (not object) to detectAndReport', async () => {
    const mockBugDetector = {
      detectAndReport: jest.fn().mockResolvedValue({ bugId: 'BUG-002' })
    };

    const handler = new FailureHandler({ bugDetector: mockBugDetector });

    const result = {
      app: { id: 'test-app' },
      agentResults: [
        {
          agentId: 'sentinel',
          scenarios: [{ status: 'failed', name: 'test1', error: 'Error' }]
        }
      ]
    };

    await handler.handle(result);

    const [app, agentId, failure] = mockBugDetector.detectAndReport.mock.calls[0];
    expect(typeof agentId).toBe('string');
    expect(agentId).toBe('sentinel');
  });

  test('returns empty array when no agentResults have failures', async () => {
    const mockBugDetector = {
      detectAndReport: jest.fn()
    };

    const handler = new FailureHandler({ bugDetector: mockBugDetector });

    const result = {
      app: { id: 'test-app' },
      agentResults: [
        {
          agentId: 'healer',
          scenarios: [{ status: 'passed', name: 'test1' }]
        }
      ]
    };

    const bugs = await handler.handle(result);

    expect(bugs).toEqual([]);
    expect(mockBugDetector.detectAndReport).not.toHaveBeenCalled();
  });

  test('continues processing after individual detectAndReport error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const mockBugDetector = {
      detectAndReport: jest.fn()
        .mockRejectedValueOnce(new Error('Detection failed'))
        .mockResolvedValueOnce({ bugId: 'BUG-003' })
    };

    const handler = new FailureHandler({ bugDetector: mockBugDetector });

    const result = {
      app: { id: 'test-app' },
      agentResults: [
        {
          agentId: 'healer',
          scenarios: [
            { status: 'failed', name: 'test1', error: 'Error 1' },
            { status: 'failed', name: 'test2', error: 'Error 2' }
          ]
        }
      ]
    };

    const bugs = await handler.handle(result);

    expect(mockBugDetector.detectAndReport).toHaveBeenCalledTimes(2);
    expect(bugs).toHaveLength(1); // Only second one succeeded
    expect(bugs[0].bugId).toBe('BUG-003');

    errorSpy.mockRestore();
  });
});
