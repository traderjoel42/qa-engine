'use strict';

const BaseRepository = require('./base-repository');

/**
 * Repository for scheduled_runs table.
 * Extends BaseRepository for consistency with existing data access patterns.
 *
 * @extends BaseRepository
 */
class ScheduledRunRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'scheduled_runs');
  }

  /**
   * Get all enabled schedules.
   * @returns {ScheduledRun[]}
   */
  getEnabled() {
    return this._connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE enabled = 1')
      .all();
  }

  /**
   * Get all schedules.
   * @returns {ScheduledRun[]}
   */
  getAll() {
    return this._connection.db
      .prepare('SELECT * FROM scheduled_runs ORDER BY created_at')
      .all();
  }

  /**
   * Get schedules for a specific app.
   * @param {string} appId
   * @returns {ScheduledRun[]}
   */
  getByApp(appId) {
    return this._connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE app_id = ? ORDER BY created_at')
      .all(appId);
  }

  /**
   * Get a schedule by ID.
   * @param {string} id
   * @returns {ScheduledRun|null}
   */
  getById(id) {
    return this._connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE id = ?')
      .get(id) || null;
  }

  /**
   * Create a new schedule.
   * Uses crypto.randomUUID() for ID generation, consistent with BaseRepository._generateId().
   * @param {Partial<ScheduledRun>} schedule
   * @returns {ScheduledRun}
   */
  create(schedule) {
    const id = schedule.id || this._generateId();
    this._connection.db.prepare(`
      INSERT INTO scheduled_runs (
        id, app_id, name, cron_expression, test_mode, agents,
        environment, enabled, notify_on_start, notify_on_complete,
        notify_only_failures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, schedule.app_id, schedule.name,
      schedule.cron_expression, schedule.test_mode || 'smoke',
      schedule.agents || '[]',
      schedule.environment || 'staging', schedule.enabled ?? 1,
      schedule.notify_on_start ?? 0, schedule.notify_on_complete ?? 1,
      schedule.notify_only_failures ?? 0
    );
    return this.getById(id);
  }

  /**
   * Update the last run tracking fields.
   * @param {string} id
   * @param {Object} data
   */
  updateLastRun(id, data) {
    this._connection.db.prepare(`
      UPDATE scheduled_runs
      SET last_run_at = ?, last_run_status = ?, last_run_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(data.last_run_at, data.last_run_status, data.last_run_id || null, id);
  }

  /**
   * Enable or disable a schedule.
   * @param {string} id
   * @param {boolean} enabled
   */
  setEnabled(id, enabled) {
    this._connection.db.prepare(`
      UPDATE scheduled_runs SET enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(enabled ? 1 : 0, id);
  }

  /**
   * Update cron expression.
   * @param {string} id
   * @param {string} cronExpression
   */
  updateCron(id, cronExpression) {
    this._connection.db.prepare(`
      UPDATE scheduled_runs SET cron_expression = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(cronExpression, id);
  }

  /**
   * Delete a schedule.
   * @param {string} id
   */
  delete(id) {
    this._connection.db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(id);
  }
}

module.exports = ScheduledRunRepository;
