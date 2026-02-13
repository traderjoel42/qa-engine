'use strict';

/**
 * Handles WhatsApp commands related to schedule management.
 * Extends the WhatsApp bot with schedule-specific commands.
 *
 * Commands:
 *   "schedules"            → List all schedules
 *   "pause <name>"         → Pause a schedule
 *   "resume <name>"        → Resume a schedule
 *   "run <name> now"       → Trigger immediate execution
 *   "change <name> to <cron>" → Update cron expression
 */
class ScheduleHandler {
  /**
   * @param {import('../../../core/scheduler')} scheduler
   */
  constructor(scheduler) {
    this.scheduler = scheduler;
  }

  /**
   * Check if a message is a schedule command.
   * @param {string} message - Normalized message text
   * @returns {boolean}
   */
  canHandle(message) {
    const lower = message.toLowerCase().trim();
    return (
      lower === 'schedules' ||
      lower.startsWith('pause ') ||
      lower.startsWith('resume ') ||
      lower.includes(' now') ||
      lower.startsWith('change ') ||
      lower === 'next run' ||
      lower === 'digest'
    );
  }

  /**
   * Handle a schedule command.
   * @param {string} message - Raw message text
   * @returns {{ text: string }} Response
   */
  async handle(message) {
    const lower = message.toLowerCase().trim();

    if (lower === 'schedules') {
      return this.listSchedules();
    }

    if (lower.startsWith('pause ')) {
      const name = message.slice(6).trim();
      return this.pauseSchedule(name);
    }

    if (lower.startsWith('resume ')) {
      const name = message.slice(7).trim();
      return this.resumeSchedule(name);
    }

    if (lower.endsWith(' now') || lower.startsWith('run ')) {
      const name = message.replace(/^run\s+/i, '').replace(/\s+now$/i, '').trim();
      return this.runNow(name);
    }

    if (lower === 'digest') {
      const digestSchedule = (await this.scheduler.listSchedules())
        .find((s) => s.test_mode === 'digest');
      if (digestSchedule) {
        await this.scheduler.runNow(digestSchedule.id);
        return { text: '📊 Digest sent!' };
      }
      return { text: 'No digest schedule configured.' };
    }

    if (lower.startsWith('change ')) {
      return this.updateCron(message);
    }

    return { text: 'Unknown schedule command. Try: schedules, pause, resume, run now' };
  }

  /**
   * List all schedules.
   */
  async listSchedules() {
    const schedules = await this.scheduler.listSchedules();

    if (schedules.length === 0) {
      return { text: 'No schedules configured.' };
    }

    const lines = schedules.map((s) => {
      const status = s.enabled ? '✅' : '⏸️';
      const running = s.is_running ? ' 🏃' : '';
      const lastRun = s.last_run_at
        ? `Last: ${new Date(s.last_run_at).toLocaleString()}`
        : 'Never run';
      const lastStatus = s.last_run_status
        ? ` (${s.last_run_status})`
        : '';

      return `${status} ${s.name}${running}\n   ${s.cron_expression} | ${s.test_mode}\n   ${lastRun}${lastStatus}`;
    });

    return { text: `📅 Schedules:\n\n${lines.join('\n\n')}` };
  }

  /**
   * Pause a schedule by name.
   * @param {string} name
   */
  async pauseSchedule(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    await this.scheduler.pauseSchedule(schedule.id);
    return { text: `⏸️ Paused: ${schedule.name}` };
  }

  /**
   * Resume a schedule by name.
   * @param {string} name
   */
  async resumeSchedule(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    await this.scheduler.resumeSchedule(schedule.id);
    return { text: `▶️ Resumed: ${schedule.name}` };
  }

  /**
   * Trigger immediate execution.
   * @param {string} name
   */
  async runNow(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    // Run async — don't await (will send notification when done)
    this.scheduler.runNow(schedule.id).catch((err) => {
      console.error(`Run now failed for ${schedule.name}:`, err);
    });

    return { text: `🏃 Starting: ${schedule.name}\nYou'll get a notification when it completes.` };
  }

  /**
   * Update cron expression. Format: "change <name> to <cron>"
   * @param {string} message
   */
  async updateCron(message) {
    const match = message.match(/^change\s+(.+?)\s+to\s+(.+)$/i);
    if (!match) {
      return { text: 'Format: change <schedule name> to <cron expression>' };
    }

    const [, name, cronExpr] = match;
    const schedule = await this.findScheduleByName(name.trim());
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    try {
      await this.scheduler.updateCron(schedule.id, cronExpr.trim());
      return { text: `🔄 Updated "${schedule.name}" to: ${cronExpr.trim()}` };
    } catch (error) {
      return { text: `❌ ${error.message}` };
    }
  }

  /**
   * Find a schedule by partial name match.
   * @param {string} name
   * @returns {ScheduledRun|null}
   */
  async findScheduleByName(name) {
    const schedules = await this.scheduler.listSchedules();
    const lower = name.toLowerCase();

    return schedules.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        s.name.toLowerCase().includes(lower)
    ) || null;
  }
}

module.exports = ScheduleHandler;
