'use strict';

jest.mock('../../core/engine/factory', () => ({
  createEngine: jest.fn()
}));

const { createEngine } = require('../../core/engine/factory');
const { Command } = require('commander');
const testCommand = require('../../cli/commands/test');

function createMockEngine(overrides = {}) {
  return {
    run: jest.fn().mockResolvedValue({
      runId: 'run-001',
      overallStatus: 'failed',
      summary: {
        totalScenarios: 5,
        passedScenarios: 4,
        failedScenarios: 1,
        skippedScenarios: 0
      },
      agentResults: []
    }),
    status: jest.fn().mockResolvedValue([]),
    bugs: jest.fn().mockResolvedValue([]),
    shutdown: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('test command', () => {
  let mockEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
    createEngine.mockResolvedValue(mockEngine);

    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runCommand(args) {
    const program = new Command();
    program.exitOverride();
    testCommand(program);
    return program.parseAsync(['node', 'qa-engine', 'test', ...args]);
  }

  // Group 1: Option parsing
  test('requires --app option', async () => {
    await expect(runCommand([])).rejects.toThrow();
  });

  test('accepts --agent option for single agent', async () => {
    await runCommand(['--app', 'brainstormy', '--agent', 'healer']);

    expect(mockEngine.run).toHaveBeenCalledWith('brainstormy', expect.objectContaining({
      agents: ['healer']
    }));
  });

  test('defaults mode to smoke', async () => {
    await runCommand(['--app', 'brainstormy']);

    expect(mockEngine.run).toHaveBeenCalledWith('brainstormy', expect.objectContaining({
      mode: 'smoke'
    }));
  });

  // Group 2: Engine interaction
  test('calls engine.run() with correct appId and options', async () => {
    await runCommand(['--app', 'brainstormy', '--mode', 'regression']);

    expect(mockEngine.run).toHaveBeenCalledWith('brainstormy', expect.objectContaining({
      mode: 'regression'
    }));
  });

  test('passes agent filter when --agent specified', async () => {
    await runCommand(['--app', 'brainstormy', '--agent', 'sentinel']);

    const callArgs = mockEngine.run.mock.calls[0][1];
    expect(callArgs.agents).toEqual(['sentinel']);
  });

  test('calls engine.shutdown() after successful run', async () => {
    await runCommand(['--app', 'brainstormy']);

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });

  test('calls engine.shutdown() after error', async () => {
    mockEngine.run.mockRejectedValue(new Error('Test error'));

    await runCommand(['--app', 'brainstormy']);

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });

  // Group 3: Output and exit codes
  test('prints test summary on success', async () => {
    await runCommand(['--app', 'brainstormy']);

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('Test Run Complete');
  });

  test('exits with code 0 when no failures', async () => {
    mockEngine.run.mockResolvedValue({
      runId: 'run-002',
      overallStatus: 'passed',
      summary: {
        totalScenarios: 3,
        passedScenarios: 3,
        failedScenarios: 0,
        skippedScenarios: 0
      }
    });

    await runCommand(['--app', 'brainstormy']);

    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('exits with code 1 when failures exist', async () => {
    await runCommand(['--app', 'brainstormy']);

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
