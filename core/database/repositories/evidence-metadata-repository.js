'use strict';

const BaseRepository = require('./base-repository');

class EvidenceMetadataRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'evidence_metadata');
    this._jsonColumns = ['metadata'];
  }

  findByTestRun(testRunId) {
    return this.findMany({ test_run_id: testRunId });
  }

  findByBug(bugRefId) {
    return this.findMany({ bug_ref_id: bugRefId });
  }

  findByType(appId, type) {
    return this.findMany({ app_id: appId, type });
  }

  getStorageUsage(appId) {
    const row = this._connection.db.prepare(
      'SELECT COALESCE(SUM(file_size), 0) as total FROM evidence_metadata WHERE app_id = ?'
    ).get(appId);
    return row.total;
  }
}

module.exports = EvidenceMetadataRepository;
