'use strict';

const DatabaseConnection = require('./connection');
const Migrator = require('./migrator');
const AppRepository = require('./repositories/app-repository');
const TestRunRepository = require('./repositories/test-run-repository');
const TestResultRepository = require('./repositories/test-result-repository');
const BugRepository = require('./repositories/bug-repository');
const ApprovalRepository = require('./repositories/approval-repository');
const FixRepository = require('./repositories/fix-repository');
const EvidenceMetadataRepository = require('./repositories/evidence-metadata-repository');
const ScheduledRunRepository = require('./repositories/scheduled-run-repository');
const BaseRepository = require('./repositories/base-repository');

async function createDatabase(options = {}) {
  const connection = new DatabaseConnection(options);
  connection.open();

  const migrator = new Migrator(connection, options);
  migrator.initialize();
  await migrator.migrate();

  return {
    connection,
    migrator,
    apps: new AppRepository(connection),
    testRuns: new TestRunRepository(connection),
    testResults: new TestResultRepository(connection),
    bugs: new BugRepository(connection),
    approvals: new ApprovalRepository(connection),
    fixes: new FixRepository(connection),
    evidenceMetadata: new EvidenceMetadataRepository(connection),
    scheduledRuns: new ScheduledRunRepository(connection),
    close: () => connection.close()
  };
}

module.exports = {
  createDatabase,
  DatabaseConnection,
  Migrator,
  BaseRepository,
  AppRepository,
  TestRunRepository,
  TestResultRepository,
  BugRepository,
  ApprovalRepository,
  FixRepository,
  EvidenceMetadataRepository,
  ScheduledRunRepository
};
