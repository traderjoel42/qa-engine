'use strict';

const BaseRepository = require('./base-repository');

class AppRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'apps');
    this._jsonColumns = ['config'];
  }

  findByName(name) {
    return this.findOne({ name });
  }

  findActive() {
    return this.findMany({ status: 'active' });
  }

  updateLastTestRun(id, timestamp) {
    return this.update(id, { last_test_run_at: timestamp });
  }
}

module.exports = AppRepository;
