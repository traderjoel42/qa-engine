'use strict';

const ScheduleHandler = require('../../interfaces/whatsapp-bot/handlers/schedule-handler');

// ===================================================================
// MOCK FACTORIES
// ===================================================================

function createMockScheduler(schedules = []) {
  return {
    listSchedules: jest.fn().mockResolvedValue(schedules),
    pauseSchedule: jest.fn().mockResolvedValue(undefined),
    resumeSchedule: jest.fn().mockResolvedValue(undefined),
    runNow: jest.fn().mockResolvedValue(undefined),
    updateCron: jest.fn().mockResolvedValue(undefined)
  };
}

function createMockScheduleData(overrides = {}) {
  return {
    id: 'sched-1',
    app_id: 'brainstormy',
    name: 'Nightly Full Suite',
    cron_expression: '0 2 * * *',
    test_mode: 'full',
    agents: '["healer","sentinel"]',
    environment: 'staging',
    enabled: 1,
    is_running: false,
    has_active_task: true,
    last_run_at: '2026-02-12T02:00:00.000Z',
    last_run_status: 'passed',
    ...overrides
  };
}

// ===================================================================
// TESTS
// ===================================================================

describe('ScheduleHandler', () => {

  // -----------------------------------------------------------------
  // canHandle()
  // -----------------------------------------------------------------
  describe('canHandle()', () => {
    let handler;

    beforeEach(() => {
      handler = new ScheduleHandler(createMockScheduler());
    });

    test('returns true for "schedules"', () => {
      expect(handler.canHandle('schedules')).toBe(true);
    });

    test('returns true for "pause nightly"', () => {
      expect(handler.canHandle('pause nightly')).toBe(true);
    });

    test('returns true for "resume nightly"', () => {
      expect(handler.canHandle('resume nightly')).toBe(true);
    });

    test('returns true for "run nightly now"', () => {
      expect(handler.canHandle('run nightly now')).toBe(true);
    });

    test('returns true for "nightly now"', () => {
      expect(handler.canHandle('nightly now')).toBe(true);
    });

    test('returns true for "change nightly to 0 3 * * *"', () => {
      expect(handler.canHandle('change nightly to 0 3 * * *')).toBe(true);
    });

    test('returns true for "digest"', () => {
      expect(handler.canHandle('digest')).toBe(true);
    });

    test('returns false for unrelated messages', () => {
      expect(handler.canHandle('run smoke')).toBe(false);
      expect(handler.canHandle('status')).toBe(false);
      expect(handler.canHandle('help')).toBe(false);
      expect(handler.canHandle('bugs')).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // handle()
  // -----------------------------------------------------------------
  describe('handle()', () => {
    test('listSchedules returns formatted list', async () => {
      const schedules = [
        createMockScheduleData(),
        createMockScheduleData({
          id: 'sched-2',
          name: 'Daily Digest',
          cron_expression: '0 8 * * *',
          test_mode: 'digest',
          enabled: 0,
          last_run_at: null,
          last_run_status: null
        })
      ];
      const scheduler = createMockScheduler(schedules);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('schedules');
      expect(result.text).toContain('📅 Schedules:');
      expect(result.text).toContain('Nightly Full Suite');
      expect(result.text).toContain('Daily Digest');
      expect(result.text).toContain('0 2 * * *');
      expect(result.text).toContain('Never run');
    });

    test('listSchedules returns message when empty', async () => {
      const scheduler = createMockScheduler([]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('schedules');
      expect(result.text).toBe('No schedules configured.');
    });

    test('pauseSchedule pauses by partial name match', async () => {
      const schedule = createMockScheduleData();
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('pause nightly');
      expect(scheduler.pauseSchedule).toHaveBeenCalledWith('sched-1');
      expect(result.text).toContain('Paused');
      expect(result.text).toContain('Nightly Full Suite');
    });

    test('resumeSchedule resumes by name', async () => {
      const schedule = createMockScheduleData();
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('resume nightly');
      expect(scheduler.resumeSchedule).toHaveBeenCalledWith('sched-1');
      expect(result.text).toContain('Resumed');
    });

    test('runNow triggers async execution', async () => {
      const schedule = createMockScheduleData();
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('run nightly now');
      expect(scheduler.runNow).toHaveBeenCalledWith('sched-1');
      expect(result.text).toContain('Starting');
      expect(result.text).toContain('notification when it completes');
    });

    test('updateCron validates and applies new expression', async () => {
      const schedule = createMockScheduleData();
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('change nightly to 0 3 * * *');
      expect(scheduler.updateCron).toHaveBeenCalledWith('sched-1', '0 3 * * *');
      expect(result.text).toContain('Updated');
      expect(result.text).toContain('0 3 * * *');
    });

    test('returns error for unknown schedule name', async () => {
      const scheduler = createMockScheduler([]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('pause nonexistent');
      expect(result.text).toContain('not found');
    });

    test('digest triggers digest schedule', async () => {
      const schedule = createMockScheduleData({
        id: 'sched-digest',
        name: 'Daily Digest',
        test_mode: 'digest'
      });
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('digest');
      expect(scheduler.runNow).toHaveBeenCalledWith('sched-digest');
      expect(result.text).toContain('Digest sent');
    });

    test('digest returns message when no digest schedule exists', async () => {
      const scheduler = createMockScheduler([
        createMockScheduleData({ test_mode: 'full' })
      ]);
      const handler = new ScheduleHandler(scheduler);

      const result = await handler.handle('digest');
      expect(result.text).toBe('No digest schedule configured.');
    });
  });

  // -----------------------------------------------------------------
  // findScheduleByName()
  // -----------------------------------------------------------------
  describe('findScheduleByName()', () => {
    test('finds exact match (case-insensitive)', async () => {
      const schedule = createMockScheduleData({ name: 'Nightly Full Suite' });
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const found = await handler.findScheduleByName('nightly full suite');
      expect(found).toEqual(schedule);
    });

    test('finds partial match', async () => {
      const schedule = createMockScheduleData({ name: 'Nightly Full Suite' });
      const scheduler = createMockScheduler([schedule]);
      const handler = new ScheduleHandler(scheduler);

      const found = await handler.findScheduleByName('nightly');
      expect(found).toEqual(schedule);
    });

    test('returns null when no match', async () => {
      const scheduler = createMockScheduler([]);
      const handler = new ScheduleHandler(scheduler);

      const found = await handler.findScheduleByName('nonexistent');
      expect(found).toBeNull();
    });
  });
});
