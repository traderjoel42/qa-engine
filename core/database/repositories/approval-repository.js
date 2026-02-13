'use strict';

const BaseRepository = require('./base-repository');

class ApprovalRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'approvals');
    this._jsonColumns = [];
  }

  findByApprovalId(approvalId) {
    return this.findOne({ approval_id: approvalId });
  }

  findPending() {
    return this.findMany({ status: 'pending' });
  }

  findExpired() {
    const rows = this._connection.db.prepare(
      "SELECT * FROM approvals WHERE status = 'pending' AND timeout_at < datetime('now')"
    ).all();
    return rows.map(row => this._deserializeJson(row));
  }

  findByBug(bugRefId) {
    return this.findMany({ bug_ref_id: bugRefId });
  }

  respond(id, status, respondedVia) {
    return this.update(id, {
      status,
      responded_at: new Date().toISOString(),
      responded_via: respondedVia
    });
  }
}

module.exports = ApprovalRepository;
