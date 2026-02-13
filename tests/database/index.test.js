'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createDatabase } = require('../../core/database');
const AppRepository = require('../../core/database/repositories/app-repository');
const TestRunRepository = require('../../core/database/repositories/test-run-repository');
const TestResultRepository = require('../../core/database/repositories/test-result-repository');
const BugRepository = require('../../core/database/repositories/bug-repository');
const ApprovalRepository = require('../../core/database/repositories/approval-repository');
const FixRepository = require('../../core/database/repositories/fix-repository');
const EvidenceMetadataRepository = require('../../core/database/repositories/evidence-metadata-repository');

describe('Database Module Public API', () => {
  let db;

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
  });

  it('createDatabase() returns object with all repositories', async () => {
    db = await createDatabase();

    expect(db.connection).toBeDefined();
    expect(db.migrator).toBeDefined();
    expect(db.apps).toBeInstanceOf(AppRepository);
    expect(db.testRuns).toBeInstanceOf(TestRunRepository);
    expect(db.testResults).toBeInstanceOf(TestResultRepository);
    expect(db.bugs).toBeInstanceOf(BugRepository);
    expect(db.approvals).toBeInstanceOf(ApprovalRepository);
    expect(db.fixes).toBeInstanceOf(FixRepository);
    expect(db.evidenceMetadata).toBeInstanceOf(EvidenceMetadataRepository);
    expect(typeof db.close).toBe('function');
  });

  it('createDatabase() runs migrations automatically', async () => {
    db = await createDatabase();

    // Tables should exist — try inserting an app
    const app = db.apps.create({ name: 'Test', type: 'web' });
    expect(app.id).toBeDefined();
    expect(app.name).toBe('Test');
  });

  it('createDatabase({ dbPath }) creates file-based database', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-db-api-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = await createDatabase({ dbPath });

    expect(fs.existsSync(dbPath)).toBe(true);
    db.apps.create({ name: 'File App', type: 'web' });
    db.close();
    db = null;

    // Clean up
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  });

  it('close() cleans up connection', async () => {
    db = await createDatabase();
    db.close();
    expect(() => db.connection.db).toThrow('Database is not open');
    db = null;
  });

  it('repositories share the same connection instance', async () => {
    db = await createDatabase();
    expect(db.apps._connection).toBe(db.connection);
    expect(db.testRuns._connection).toBe(db.connection);
    expect(db.bugs._connection).toBe(db.connection);
    expect(db.approvals._connection).toBe(db.connection);
    expect(db.fixes._connection).toBe(db.connection);
    expect(db.evidenceMetadata._connection).toBe(db.connection);
  });
});
