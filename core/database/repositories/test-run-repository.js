'use strict';

const BaseRepository = require('./base-repository');

class TestRunRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'test_runs');
    this._jsonColumns = ['agents', 'summary'];
  }

  findByApp(appId, options = {}) {
    return this.findMany({ app_id: appId }, options);
  }

  findActive() {
    return this.findMany({ status: 'running' });
  }

  findRecent(appId, limit = 10) {
    return this.findMany({ app_id: appId }, {
      orderBy: { started_at: 'DESC' },
      limit
    });
  }

  complete(id, summary) {
    return this.update(id, {
      status: 'completed',
      summary,
      completed_at: new Date().toISOString()
    });
  }

  /**
   * Get test runs for an app since a given timestamp.
   * Used by Scheduler.sendDailyDigest() to aggregate last 24h results.
   *
   * @param {string} appId - App ID to filter by
   * @param {string} sinceIso - ISO timestamp lower bound (inclusive)
   * @returns {TestRun[]}
   */
  getRunsSince(appId, sinceIso) {
    return this._connection.db.prepare(
      `SELECT * FROM test_runs
       WHERE app_id = ? AND started_at >= ?
       ORDER BY started_at DESC`
    ).all(appId, sinceIso);
  }

  getPassRate(appId, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const rows = this._connection.db.prepare(`
      SELECT summary FROM test_runs
      WHERE app_id = ? AND status = 'completed' AND started_at >= ?
    `).all(appId, cutoffStr);

    if (rows.length === 0) return null;

    let totalPassed = 0;
    let totalTests = 0;

    for (const row of rows) {
      if (row.summary) {
        try {
          const summary = JSON.parse(row.summary);
          if (summary.passed !== undefined && summary.total !== undefined) {
            totalPassed += summary.passed;
            totalTests += summary.total;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return totalTests > 0 ? totalPassed / totalTests : null;
  }
}

module.exports = TestRunRepository;
