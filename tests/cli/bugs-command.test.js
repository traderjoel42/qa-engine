'use strict';

jest.mock('../../core/engine/factory', () => ({
  createEngine: jest.fn()
}));

const { createEngine } = require('../../core/engine/factory');
const { Command } = require('commander');
const bugsCommand = require('../../cli/commands/bugs');

function createMockEngine(overrides = {}) {
  return {
    run: jest.fn().mockResolvedValue({}),
    status: jest.fn().mockResolvedValue([]),
    bugs: jest.fn().mockResolvedValue([]),
    shutdown: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('bugs command', () => {
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
    bugsCommand(program);
    return program.parseAsync(['node', 'qa-engine', 'bugs', ...args]);
  }

  // Group 1: Option parsing
  test('requires --app option', async () => {
    await expect(runCommand([])).rejects.toThrow();
  });

  test('passes --status filter when specified', async () => {
    await runCommand(['--app', 'brainstormy', '--status', 'open']);

    expect(mockEngine.bugs).toHaveBeenCalledWith('brainstormy', expect.objectContaining({
      status: 'open'
    }));
  });

  // Group 2: Output formatting
  test('prints bug severity, title, status, and date', async () => {
    mockEngine.bugs.mockResolvedValue([
      {
        bug_id: 'BUG-001',
        title: 'Login crash',
        severity: 'critical',
        status: 'open',
        created_at: '2026-02-12T10:00:00Z'
      }
    ]);

    await runCommand(['--app', 'brainstormy']);

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('CRITICAL');
    expect(allOutput).toContain('Login crash');
    expect(allOutput).toContain('open');
  });

  test('prints Linear URL when available', async () => {
    mockEngine.bugs.mockResolvedValue([
      {
        bug_id: 'BUG-002',
        title: 'UI glitch',
        severity: 'low',
        status: 'open',
        created_at: '2026-02-12T10:00:00Z',
        external_issue_url: 'https://linear.app/team/issue/123'
      }
    ]);

    await runCommand(['--app', 'brainstormy']);

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('https://linear.app/team/issue/123');
  });

  test('prints "No bugs found" when empty', async () => {
    await runCommand(['--app', 'brainstormy']);

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('No bugs found');
  });

  // Group 3: Cleanup and errors
  test('calls engine.shutdown() after displaying', async () => {
    mockEngine.bugs.mockResolvedValue([
      {
        bug_id: 'BUG-003',
        title: 'Test Bug',
        severity: 'medium',
        status: 'open',
        created_at: '2026-02-12T10:00:00Z'
      }
    ]);

    await runCommand(['--app', 'brainstormy']);

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });

  test('calls engine.shutdown() on error', async () => {
    mockEngine.bugs.mockRejectedValue(new Error('DB error'));

    await runCommand(['--app', 'brainstormy']);

    expect(mockEngine.shutdown).toHaveBeenCalled();
  });

  test('includes status qualifier in empty message when filtered', async () => {
    await runCommand(['--app', 'brainstormy', '--status', 'closed']);

    const allOutput = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('No bugs found');
    expect(allOutput).toContain('closed');
  });
});
