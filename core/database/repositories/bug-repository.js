'use strict';

const BaseRepository = require('./base-repository');

class BugRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'bugs');
    this._jsonColumns = ['evidence', 'fix_details', 'related_bugs'];
  }

  findByApp(appId, options = {}) {
    return this.findMany({ app_id: appId }, options);
  }

  findOpen(appId) {
    const rows = this._connection.db.prepare(
      "SELECT * FROM bugs WHERE app_id = ? AND status IN ('open', 'in-progress')"
    ).all(appId);
    return rows.map(row => this._deserializeJson(row));
  }

  findBySeverity(appId, severity) {
    return this.findMany({ app_id: appId, severity });
  }

  findByBugId(bugId) {
    return this.findOne({ bug_id: bugId });
  }

  nextBugNumber(appId) {
    const row = this._connection.db.prepare(
      "SELECT MAX(CAST(SUBSTR(bug_id, 5) AS INTEGER)) as max_num FROM bugs WHERE app_id = ?"
    ).get(appId);
    return (row?.max_num || 0) + 1;
  }

  updateStatus(id, status, extraFields = {}) {
    return this.update(id, { status, ...extraFields });
  }
}

module.exports = BugRepository;
