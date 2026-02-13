'use strict';

const cron = require('node-cron');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Manages scheduled test runs using node-cron.
 * Schedules are persisted in SQLite and loaded on startup.
 * Integrates with TestOrchestrator for execution and
 * NotificationAdapter for WhatsApp alerts.
 *
 * @extends EventEmitter
 * @emits schedule:started - When a scheduled run begins
 * @emits schedule:completed - When a scheduled run finishes
 * @emits schedule:error - When a scheduled run fails
 * @emits digest:sent - When daily digest is sent
 */
class Scheduler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('./database/repositories/scheduled-run-repository')} options.scheduledRunRepo
   * @param {import('./engine/test-orchestrator')} options.orchestrator
   * @param {import('./integrations/adapters/notification')} options.notifier
   * @param {import('./database/repositories/test-run-repository')} options.testRunRepo
   * @param {(appId: string) => Object} options.loadAppConfig - Function that loads appConfig by ID
   * @param {string} [options.defaultRecipient] - Phone number for WhatsApp notifications
   */
  constructor({ scheduledRunRepo, orchestrator, notifier, testRunRepo, loadAppConfig, defaultRecipient }) {
    super();

    /** @type {Map<string, import('node-cron').ScheduledTask>} */
    this.activeTasks = new Map();

    this.scheduledRunRepo = scheduledRunRepo;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.testRunRepo = testRunRepo;
    this.loadAppConfig = loadAppConfig;
    this.defaultRecipient = defaultRecipient || process.env.WHATSAPP_DEFAULT_RECIPIENT;

    /** @type {boolean} */
    this.running = false;

    /** @type {Set<string>} Schedule IDs currently executing */
    this.executing = new Set();
  }

  /**
   * Start the scheduler: load all enabled schedules from DB
   * and register cron tasks.
   */
  async start() {
    if (this.running) {
      console.warn('Scheduler already running');
      return;
    }

    const schedules = this.scheduledRunRepo.getEnabled();
    console.log(`Scheduler: Loading ${schedules.length} enabled schedule(s)`);

    for (const schedule of schedules) {
      this.registerTask(schedule);
    }

    this.running = true;
    console.log('Scheduler: Started');
  }

  /**
   * Stop the scheduler: destroy all cron tasks.
   */
  async stop() {
    for (const [id, task] of this.activeTasks) {
      task.stop();
      console.log(`Scheduler: Stopped task ${id}`);
    }
    this.activeTasks.clear();
    this.running = false;
    console.log('Scheduler: Stopped');
  }

  /**
   * Register a cron task for a schedule.
   * @param {ScheduledRun} schedule
   */
  registerTask(schedule) {
    if (!cron.validate(schedule.cron_expression)) {
      console.error(
        `Scheduler: Invalid cron expression for ${schedule.name}: ${schedule.cron_expression}`
      );
      return;
    }

    // Stop existing task if re-registering
    if (this.activeTasks.has(schedule.id)) {
      this.activeTasks.get(schedule.id).stop();
    }

    const task = cron.schedule(schedule.cron_expression, async () => {
      await this.executeSchedule(schedule);
    });

    this.activeTasks.set(schedule.id, task);
    console.log(
      `Scheduler: Registered "${schedule.name}" [${schedule.cron_expression}]`
    );
  }

  /**
   * Execute a scheduled run.
   * Prevents concurrent execution of the same schedule.
   * @param {ScheduledRun} schedule
   */
  async executeSchedule(schedule) {
    // Prevent concurrent execution
    if (this.executing.has(schedule.id)) {
      console.warn(`Scheduler: ${schedule.name} already executing, skipping`);
      return;
    }

    this.executing.add(schedule.id);
    const startTime = Date.now();

    try {
      // Handle special 'digest' mode
      if (schedule.test_mode === 'digest') {
        await this.sendDailyDigest(schedule);
        return;
      }

      this.emit('schedule:started', { schedule, startTime });

      // Notify start if configured
      if (schedule.notify_on_start) {
        await this.notifier.send(
          this.defaultRecipient,
          `🏃 Starting scheduled run: ${schedule.name}\n` +
          `Mode: ${schedule.test_mode} | Agents: ${JSON.parse(schedule.agents).join(', ')}`
        );
      }

      // Load app configuration for the orchestrator
      const appConfig = this.loadAppConfig(schedule.app_id);

      // Execute tests via orchestrator
      // Note: orchestrator.run() expects (appConfig, options) — NOT (appId, options)
      const result = await this.orchestrator.run(appConfig, {
        mode: schedule.test_mode,
        agents: JSON.parse(schedule.agents),
        environment: schedule.environment,
        triggered_by: 'scheduled',
        triggered_via: 'cron',
        schedule_id: schedule.id
      });

      // Update schedule tracking
      this.scheduledRunRepo.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: result.summary.failed > 0 ? 'failed' : 'passed',
        last_run_id: result.testRunId
      });

      // Notify completion
      const shouldNotify = schedule.notify_on_complete &&
        (!schedule.notify_only_failures || result.summary.failed > 0);

      if (shouldNotify) {
        await this.notifier.send(
          this.defaultRecipient,
          this.formatCompletionMessage(schedule, result, startTime)
        );
      }

      this.emit('schedule:completed', { schedule, result });

    } catch (error) {
      console.error(`Scheduler: Error in ${schedule.name}:`, error.message);

      this.scheduledRunRepo.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: 'error'
      });

      // Always notify on errors
      await this.notifier.send(
        this.defaultRecipient,
        `❌ Scheduled run "${schedule.name}" failed with error:\n${error.message}`
      );

      this.emit('schedule:error', { schedule, error });

    } finally {
      this.executing.delete(schedule.id);
    }
  }

  /**
   * Format a completion notification message.
   * @param {ScheduledRun} schedule
   * @param {Object} result
   * @param {number} startTime
   * @returns {string}
   */
  formatCompletionMessage(schedule, result, startTime) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const { summary } = result;
    const icon = summary.failed > 0 ? '🔴' : '✅';

    return [
      `${icon} ${schedule.name} Complete`,
      ``,
      `Tests: ${summary.passed}/${summary.total_tests} passed`,
      `Duration: ${duration}s`,
      summary.failed > 0 ? `Failed: ${summary.failed} test(s)` : '',
      summary.bugs_created > 0 ? `Bugs: ${summary.bugs_created} new` : '',
      `Pass rate: ${summary.pass_rate.toFixed(1)}%`
    ].filter(Boolean).join('\n');
  }

  /**
   * Send daily digest summarizing last 24h of test results.
   * @param {ScheduledRun} schedule
   */
  async sendDailyDigest(schedule) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const runs = this.testRunRepo.getRunsSince(
      schedule.app_id,
      since
    );

    if (runs.length === 0) {
      await this.notifier.send(
        this.defaultRecipient,
        `📊 Daily Digest: No test runs in the last 24 hours.`
      );
      return;
    }

    const totalTests = runs.reduce(
      (sum, r) => sum + (r.summary?.total_tests || 0), 0
    );
    const totalPassed = runs.reduce(
      (sum, r) => sum + (r.summary?.passed || 0), 0
    );
    const totalFailed = runs.reduce(
      (sum, r) => sum + (r.summary?.failed || 0), 0
    );
    const bugsCreated = runs.reduce(
      (sum, r) => sum + (r.summary?.bugs_created || 0), 0
    );
    const passRate = totalTests > 0
      ? ((totalPassed / totalTests) * 100).toFixed(1)
      : 'N/A';

    const failedRuns = runs.filter(
      r => r.summary?.failed > 0 || r.status === 'failed'
    );

    const message = [
      `📊 Daily QA Digest — ${new Date().toLocaleDateString()}`,
      ``,
      `Runs: ${runs.length}`,
      `Tests: ${totalPassed}/${totalTests} passed (${passRate}%)`,
      totalFailed > 0 ? `⚠️ ${totalFailed} failures across ${failedRuns.length} run(s)` : '✅ All tests passing',
      bugsCreated > 0 ? `🐛 ${bugsCreated} new bug(s) created` : '',
      ``,
      failedRuns.length > 0
        ? `Failed runs:\n${failedRuns.map(r => `  • ${r.triggered_by} at ${new Date(r.started_at).toLocaleTimeString()}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n');

    await this.notifier.send(this.defaultRecipient, message);
    this.emit('digest:sent', { date: new Date(), runs: runs.length });
  }

  // ===== SCHEDULE MANAGEMENT =====

  /**
   * Create a new schedule.
   * @param {Partial<ScheduledRun>} config
   * @returns {ScheduledRun}
   */
  async createSchedule(config) {
    const schedule = {
      id: config.id || crypto.randomUUID(),
      app_id: config.app_id,
      name: config.name,
      cron_expression: config.cron_expression,
      test_mode: config.test_mode || 'smoke',
      agents: JSON.stringify(config.agents || []),
      environment: config.environment || 'staging',
      enabled: config.enabled !== false ? 1 : 0,
      notify_on_start: config.notify_on_start ? 1 : 0,
      notify_on_complete: config.notify_on_complete !== false ? 1 : 0,
      notify_only_failures: config.notify_only_failures ? 1 : 0
    };

    this.scheduledRunRepo.create(schedule);

    if (schedule.enabled) {
      this.registerTask(schedule);
    }

    return schedule;
  }

  /**
   * Pause a schedule.
   * @param {string} scheduleId
   */
  async pauseSchedule(scheduleId) {
    if (this.activeTasks.has(scheduleId)) {
      this.activeTasks.get(scheduleId).stop();
      this.activeTasks.delete(scheduleId);
    }
    this.scheduledRunRepo.setEnabled(scheduleId, false);
    console.log(`Scheduler: Paused ${scheduleId}`);
  }

  /**
   * Resume a paused schedule.
   * @param {string} scheduleId
   */
  async resumeSchedule(scheduleId) {
    const schedule = this.scheduledRunRepo.getById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    this.scheduledRunRepo.setEnabled(scheduleId, true);
    this.registerTask({ ...schedule, enabled: 1 });
    console.log(`Scheduler: Resumed ${scheduleId}`);
  }

  /**
   * Trigger an immediate run of a schedule (ignoring cron timing).
   * @param {string} scheduleId
   * @returns {Object} Test run result
   */
  async runNow(scheduleId) {
    const schedule = this.scheduledRunRepo.getById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    await this.executeSchedule(schedule);
  }

  /**
   * Update cron expression for a schedule.
   * @param {string} scheduleId
   * @param {string} cronExpression
   */
  async updateCron(scheduleId, cronExpression) {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    this.scheduledRunRepo.updateCron(scheduleId, cronExpression);

    // Re-register if active
    const schedule = this.scheduledRunRepo.getById(scheduleId);
    if (schedule && schedule.enabled) {
      this.registerTask(schedule);
    }
  }

  /**
   * List all schedules with their status.
   * @param {string} [appId]
   * @returns {Array<ScheduledRun & { next_run: string }>}
   */
  async listSchedules(appId) {
    const schedules = appId
      ? this.scheduledRunRepo.getByApp(appId)
      : this.scheduledRunRepo.getAll();

    return schedules.map((s) => ({
      ...s,
      is_running: this.executing.has(s.id),
      has_active_task: this.activeTasks.has(s.id)
    }));
  }
}

module.exports = Scheduler;
