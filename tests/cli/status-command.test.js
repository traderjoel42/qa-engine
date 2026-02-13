'use strict';

jest.mock('../../core/engine/factory', () => ({
  createEngine: jest.fn()
}));

const { createEngine } = require('../../core/engine/factory');
const { Command } = require('commander');
const statusCommand = require('../../cli/commands/status');

function createMockEngine(overrides = {}) {
  return {
    run: jest.fn().mockResolvedValue({}),
    status: jest.fn().mockResolvedValue([]),
    bugs: jest.fn().mockResolvedValue([]),
    shutdown: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('status command', () => {
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

  function runCommand(args = []) {
    const program = new Command();
    program.exitOverride();
    statusCommand(program);
    return program.parseAsync(['node', 'qa-engine', 'status', ...args]);
  }

  // Group 1: Basic behavior
  test('calls engine.status() with default limit 10', async () => {
    await runCommand();

    expect(mockEngine.status).toHaveBeenCalledWith({ limit: 10 });
  });

  test('respects --limit option', async () => {
    await runCommand(['--limit', '5']);

    expect(mockEngine.status).toHaveBeenCalledWith({ limit: 5 });
  });

  test('prints "No test runs found" when empty', async () => {
    await runCommand();

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('No test runs found');
  });

  // Group 2: Output formatting
  test('prints run date, app, and status for each run', async () => {
    mockEngine.status.mockResolvedValue([
      { started_at: '2026-02-12T10:00:00Z', app_id: 'brainstormy', status: 'completed' }
    ]);

    await runCommand();

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('brainstormy');
    expect(allOutput).toContain('completed');
  });

  test('parses JSON summary if stored as string', async () => {
    mockEngine.status.mockResolvedValue([
      {
        started_at: '2026-02-12T10:00:00Z',
        app_id: 'brainstormy',
        status: 'completed',
        summary: JSON.stringify({ passed: 3, failed: 1, total: 4 })
      }
    ]);

    await runCommand();

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('Passed: 3');
    expect(allOutput).toContain('Failed: 1');
  });

  test('handles runs without summary gracefully', async () => {
    mockEngine.status.mockResolvedValue([
      { started_at: '2026-02-12T10:00:00Z', app_id: 'brainstormy', status: 'running' }
    ]);

    await expect(runCommand()).resolves.not.toThrow();
  });

  // Group 3: Cleanup
  test('calls engine.shutdown() after displaying', async () => {
    mockEngine.status.mockResolvedValue([
      { started_at: '2026-02-12T10:00:00Z', app_id: 'brainstormy', status: 'completed' }
    ]);

    await runCommand();

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });

  test('calls engine.shutdown() on error', async () => {
    mockEngine.status.mockRejectedValue(new Error('DB error'));

    await runCommand();

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });
});
