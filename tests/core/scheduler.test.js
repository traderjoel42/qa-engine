'use strict';

const Scheduler = require('../../core/scheduler');

// ===================================================================
// MOCK FACTORIES
// ===================================================================

function createMockScheduledRunRepo() {
  return {
    getEnabled: jest.fn().mockReturnValue([]),
    getAll: jest.fn().mockReturnValue([]),
    getByApp: jest.fn().mockReturnValue([]),
    getById: jest.fn().mockReturnValue(null),
    create: jest.fn().mockImplementation(s => s),
    updateLastRun: jest.fn(),
    setEnabled: jest.fn(),
    updateCron: jest.fn(),
    delete: jest.fn()
  };
}

function createMockOrchestrator() {
  return {
    run: jest.fn().mockResolvedValue({
      testRunId: 'run-mock-123',
      summary: {
        total_tests: 15,
        passed: 14,
        failed: 1,
        skipped: 0,
        pass_rate: 93.3,
        bugs_created: 1,
        duration_ms: 45000
      }
    })
  };
}

function createMockNotifier() {
  return {
    send: jest.fn().mockResolvedValue(undefined)
  };
}

function createMockTestRunRepo() {
  return {
    getRunsSince: jest.fn().mockReturnValue([])
  };
}

const activeSchedulers = [];

function createScheduler(overrides = {}) {
  const scheduledRunRepo = createMockScheduledRunRepo();
  const orchestrator = createMockOrchestrator();
  const notifier = createMockNotifier();
  const testRunRepo = createMockTestRunRepo();
  const loadAppConfig = jest.fn().mockReturnValue({ id: 'brainstormy', name: 'Brainstormy' });

  const scheduler = new Scheduler({
    scheduledRunRepo,
    orchestrator,
    notifier,
    testRunRepo,
    loadAppConfig,
    defaultRecipient: '+1234567890',
    ...overrides
  });

  activeSchedulers.push(scheduler);
  return { scheduler, scheduledRunRepo, orchestrator, notifier, testRunRepo, loadAppConfig };
}

function createMockSchedule(overrides = {}) {
  return {
    id: 'sched-1',
    app_id: 'brainstormy',
    name: 'Daily Smoke',
    cron_expression: '0 6 * * *',
    test_mode: 'smoke',
    agents: '["healer"]',
    environment: 'staging',
    enabled: 1,
    notify_on_start: 0,
    notify_on_complete: 1,
    notify_only_failures: 0,
    ...overrides
  };
}

// ===================================================================
// TESTS
// ===================================================================

describe('Scheduler', () => {

  afterEach(async () => {
    for (const s of activeSchedulers) {
      await s.stop();
    }
    activeSchedulers.length = 0;
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------
  // start()
  // -----------------------------------------------------------------
  describe('start()', () => {
    test('loads enabled schedules from database', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      scheduledRunRepo.getEnabled.mockReturnValue([
        createMockSchedule({ id: 's1' }),
        createMockSchedule({ id: 's2', name: 'Nightly Full' })
      ]);
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      expect(scheduledRunRepo.getEnabled).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test('registers cron tasks for each schedule', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      scheduledRunRepo.getEnabled.mockReturnValue([
        createMockSchedule({ id: 's1' }),
        createMockSchedule({ id: 's2', name: 'Another' })
      ]);
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      expect(scheduler.activeTasks.size).toBe(2);
      logSpy.mockRestore();
    });

    test('sets running flag to true', async () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      expect(scheduler.running).toBe(true);
      logSpy.mockRestore();
    });

    test('warns if already running', async () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await scheduler.start();
      await scheduler.start(); // second call
      expect(warnSpy).toHaveBeenCalledWith('Scheduler already running');
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------
  describe('stop()', () => {
    test('stops all active cron tasks', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      scheduledRunRepo.getEnabled.mockReturnValue([createMockSchedule()]);
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      expect(scheduler.activeTasks.size).toBe(1);
      await scheduler.stop();
      logSpy.mockRestore();
    });

    test('clears activeTasks map', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      scheduledRunRepo.getEnabled.mockReturnValue([createMockSchedule()]);
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      await scheduler.stop();
      expect(scheduler.activeTasks.size).toBe(0);
      logSpy.mockRestore();
    });

    test('sets running flag to false', async () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.start();
      await scheduler.stop();
      expect(scheduler.running).toBe(false);
      logSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------
  // registerTask()
  // -----------------------------------------------------------------
  describe('registerTask()', () => {
    test('validates cron expression', () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduler.registerTask(createMockSchedule());
      expect(scheduler.activeTasks.has('sched-1')).toBe(true);
      logSpy.mockRestore();
    });

    test('logs error for invalid cron', () => {
      const { scheduler } = createScheduler();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      scheduler.registerTask(createMockSchedule({ cron_expression: 'invalid' }));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid cron expression')
      );
      expect(scheduler.activeTasks.has('sched-1')).toBe(false);
      errorSpy.mockRestore();
    });

    test('stops existing task before re-registering', () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduler.registerTask(createMockSchedule());
      const firstTask = scheduler.activeTasks.get('sched-1');
      const stopSpy = jest.spyOn(firstTask, 'stop');
      scheduler.registerTask(createMockSchedule());
      expect(stopSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test('creates new cron.schedule task', () => {
      const { scheduler } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduler.registerTask(createMockSchedule());
      const task = scheduler.activeTasks.get('sched-1');
      expect(task).toBeDefined();
      expect(typeof task.stop).toBe('function');
      logSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------
  // executeSchedule()
  // -----------------------------------------------------------------
  describe('executeSchedule()', () => {
    test('prevents concurrent execution of same schedule', async () => {
      const { scheduler, orchestrator } = createScheduler();
      const schedule = createMockSchedule();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Simulate concurrent execution
      scheduler.executing.add(schedule.id);
      await scheduler.executeSchedule(schedule);
      expect(orchestrator.run).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already executing')
      );
      warnSpy.mockRestore();
    });

    test('sends start notification when configured', async () => {
      const { scheduler, notifier } = createScheduler();
      const schedule = createMockSchedule({ notify_on_start: 1 });
      await scheduler.executeSchedule(schedule);
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('Starting scheduled run')
      );
    });

    test('calls orchestrator.run with appConfig and correct options', async () => {
      const { scheduler, orchestrator, loadAppConfig } = createScheduler();
      const schedule = createMockSchedule();
      await scheduler.executeSchedule(schedule);
      expect(loadAppConfig).toHaveBeenCalledWith('brainstormy');
      expect(orchestrator.run).toHaveBeenCalledWith(
        { id: 'brainstormy', name: 'Brainstormy' },
        expect.objectContaining({
          mode: 'smoke',
          agents: ['healer'],
          environment: 'staging',
          triggered_by: 'scheduled',
          triggered_via: 'cron'
        })
      );
    });

    test('updates last_run_at and status after completion', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      const schedule = createMockSchedule();
      await scheduler.executeSchedule(schedule);
      expect(scheduledRunRepo.updateLastRun).toHaveBeenCalledWith(
        'sched-1',
        expect.objectContaining({
          last_run_at: expect.any(String),
          last_run_status: 'failed', // mock has 1 failure
          last_run_id: 'run-mock-123'
        })
      );
    });

    test('notifies on completion when configured', async () => {
      const { scheduler, notifier } = createScheduler();
      const schedule = createMockSchedule({ notify_on_complete: 1 });
      await scheduler.executeSchedule(schedule);
      // notifier.send called for completion (not start since notify_on_start=0)
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('Complete')
      );
    });

    test('notifies only on failures when notify_only_failures set', async () => {
      const { scheduler, orchestrator, notifier } = createScheduler();
      // All passing
      orchestrator.run.mockResolvedValue({
        testRunId: 'run-pass',
        summary: { total_tests: 10, passed: 10, failed: 0, pass_rate: 100, bugs_created: 0 }
      });
      const schedule = createMockSchedule({ notify_on_complete: 1, notify_only_failures: 1 });
      await scheduler.executeSchedule(schedule);
      // Should NOT notify because all passed and notify_only_failures=1
      expect(notifier.send).not.toHaveBeenCalled();
    });

    test('handles errors and sends error notification', async () => {
      const { scheduler, orchestrator, notifier, scheduledRunRepo } = createScheduler();
      orchestrator.run.mockRejectedValue(new Error('Connection timeout'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const schedule = createMockSchedule();
      await scheduler.executeSchedule(schedule);
      expect(scheduledRunRepo.updateLastRun).toHaveBeenCalledWith(
        'sched-1',
        expect.objectContaining({ last_run_status: 'error' })
      );
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('Connection timeout')
      );
      errorSpy.mockRestore();
    });

    test('removes from executing set in finally block', async () => {
      const { scheduler } = createScheduler();
      const schedule = createMockSchedule();
      await scheduler.executeSchedule(schedule);
      expect(scheduler.executing.has(schedule.id)).toBe(false);
    });

    test('routes digest mode to sendDailyDigest', async () => {
      const { scheduler, notifier } = createScheduler();
      const schedule = createMockSchedule({ test_mode: 'digest' });
      await scheduler.executeSchedule(schedule);
      // sendDailyDigest sends notification about runs
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('No test runs')
      );
    });
  });

  // -----------------------------------------------------------------
  // sendDailyDigest()
  // -----------------------------------------------------------------
  describe('sendDailyDigest()', () => {
    test('aggregates test runs from last 24 hours', async () => {
      const { scheduler, testRunRepo, notifier } = createScheduler();
      testRunRepo.getRunsSince.mockReturnValue([
        { summary: { total_tests: 10, passed: 9, failed: 1, bugs_created: 1 }, status: 'completed', triggered_by: 'scheduled', started_at: new Date().toISOString() },
        { summary: { total_tests: 5, passed: 5, failed: 0, bugs_created: 0 }, status: 'completed', triggered_by: 'manual', started_at: new Date().toISOString() }
      ]);
      const schedule = createMockSchedule({ test_mode: 'digest' });
      await scheduler.sendDailyDigest(schedule);
      expect(testRunRepo.getRunsSince).toHaveBeenCalledWith('brainstormy', expect.any(String));
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('Daily QA Digest')
      );
    });

    test('formats message with pass/fail counts', async () => {
      const { scheduler, testRunRepo, notifier } = createScheduler();
      testRunRepo.getRunsSince.mockReturnValue([
        { summary: { total_tests: 10, passed: 8, failed: 2, bugs_created: 1 }, status: 'completed', triggered_by: 'scheduled', started_at: new Date().toISOString() }
      ]);
      const schedule = createMockSchedule({ test_mode: 'digest' });
      await scheduler.sendDailyDigest(schedule);
      const msg = notifier.send.mock.calls[0][1];
      expect(msg).toContain('8/10 passed');
      expect(msg).toContain('2 failures');
    });

    test('handles zero runs gracefully', async () => {
      const { scheduler, testRunRepo, notifier } = createScheduler();
      testRunRepo.getRunsSince.mockReturnValue([]);
      const schedule = createMockSchedule({ test_mode: 'digest' });
      await scheduler.sendDailyDigest(schedule);
      expect(notifier.send).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('No test runs')
      );
    });

    test('emits digest:sent event', async () => {
      const { scheduler, testRunRepo } = createScheduler();
      testRunRepo.getRunsSince.mockReturnValue([
        { summary: { total_tests: 5, passed: 5, failed: 0, bugs_created: 0 }, status: 'completed', triggered_by: 'manual', started_at: new Date().toISOString() }
      ]);
      const eventSpy = jest.fn();
      scheduler.on('digest:sent', eventSpy);
      const schedule = createMockSchedule({ test_mode: 'digest' });
      await scheduler.sendDailyDigest(schedule);
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runs: 1 })
      );
    });
  });

  // -----------------------------------------------------------------
  // schedule management
  // -----------------------------------------------------------------
  describe('schedule management', () => {
    test('createSchedule persists to DB and registers task', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const result = await scheduler.createSchedule({
        app_id: 'brainstormy',
        name: 'New Schedule',
        cron_expression: '0 8 * * 1-5',
        agents: ['healer', 'sentinel']
      });
      expect(scheduledRunRepo.create).toHaveBeenCalled();
      expect(result.name).toBe('New Schedule');
      expect(scheduler.activeTasks.size).toBe(1);
      logSpy.mockRestore();
    });

    test('pauseSchedule stops task and updates DB', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduler.registerTask(createMockSchedule());
      expect(scheduler.activeTasks.size).toBe(1);
      await scheduler.pauseSchedule('sched-1');
      expect(scheduler.activeTasks.has('sched-1')).toBe(false);
      expect(scheduledRunRepo.setEnabled).toHaveBeenCalledWith('sched-1', false);
      logSpy.mockRestore();
    });

    test('resumeSchedule re-registers task and updates DB', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduledRunRepo.getById.mockReturnValue(createMockSchedule());
      await scheduler.resumeSchedule('sched-1');
      expect(scheduledRunRepo.setEnabled).toHaveBeenCalledWith('sched-1', true);
      expect(scheduler.activeTasks.has('sched-1')).toBe(true);
      logSpy.mockRestore();
    });

    test('runNow triggers immediate execution', async () => {
      const { scheduler, scheduledRunRepo, orchestrator } = createScheduler();
      scheduledRunRepo.getById.mockReturnValue(createMockSchedule());
      await scheduler.runNow('sched-1');
      expect(orchestrator.run).toHaveBeenCalled();
    });

    test('updateCron validates and updates expression', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      scheduledRunRepo.getById.mockReturnValue(createMockSchedule());
      await scheduler.updateCron('sched-1', '30 */2 * * *');
      expect(scheduledRunRepo.updateCron).toHaveBeenCalledWith('sched-1', '30 */2 * * *');
      logSpy.mockRestore();
    });

    test('listSchedules returns all with running status', async () => {
      const { scheduler, scheduledRunRepo } = createScheduler();
      scheduledRunRepo.getAll.mockReturnValue([
        createMockSchedule({ id: 's1' }),
        createMockSchedule({ id: 's2' })
      ]);
      scheduler.executing.add('s1');
      const result = await scheduler.listSchedules();
      expect(result).toHaveLength(2);
      expect(result[0].is_running).toBe(true);
      expect(result[1].is_running).toBe(false);
    });
  });
});
