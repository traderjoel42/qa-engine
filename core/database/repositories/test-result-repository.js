'use strict';

const BaseRepository = require('./base-repository');

class TestResultRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'test_results');
    this._jsonColumns = ['details', 'evidence'];
  }

  findByTestRun(testRunId) {
    return this.findMany({ test_run_id: testRunId });
  }

  findByAgent(appId, agentId) {
    return this.findMany({ app_id: appId, agent_id: agentId });
  }

  findFailed(appId, options = {}) {
    return this.findMany({ app_id: appId, status: 'failed' }, options);
  }
}

module.exports = TestResultRepository;
