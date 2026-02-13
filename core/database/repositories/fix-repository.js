'use strict';

const BaseRepository = require('./base-repository');

class FixRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'fixes');
    this._jsonColumns = ['generated_fix', 'safety_review', 'verification_result'];
  }

  findByBug(bugRefId) {
    return this.findMany({ bug_ref_id: bugRefId });
  }

  findByApp(appId, options = {}) {
    return this.findMany({ app_id: appId }, options);
  }

  findInProgress() {
    return this.findMany({ status: 'in-progress' });
  }
}

module.exports = FixRepository;
