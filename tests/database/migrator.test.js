'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseConnection = require('../../core/database/connection');
const Migrator = require('../../core/database/migrator');
const { MigrationError } = require('../../core/engine/errors');

describe('Migrator', () => {
  let conn;
  let tmpDir;

  beforeEach(() => {
    conn = new DatabaseConnection();
    conn.open();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-migrations-'));
  });

  afterEach(() => {
    try { conn.close(); } catch {}
    // Clean up temp migration files
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  });

  function writeMigration(filename, sql) {
    fs.writeFileSync(path.join(tmpDir, filename), sql);
  }

  describe('initialize()', () => {
    it('creates schema_migrations table', () => {
      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      migrator.initialize();

      const tables = conn.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      ).all();
      expect(tables).toHaveLength(1);
    });

    it('is idempotent — calling twice does not throw', () => {
      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      migrator.initialize();
      expect(() => migrator.initialize()).not.toThrow();
    });
  });

  describe('migrate()', () => {
    it('applies migration files in numeric order', async () => {
      writeMigration('002_second.sql', 'CREATE TABLE second (id INTEGER PRIMARY KEY)');
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      const result = await migrator.migrate();

      expect(result.applied).toEqual(['001_first.sql', '002_second.sql']);
      expect(result.current_version).toBe(2);
    });

    it('records applied migrations with timestamp', async () => {
      writeMigration('001_test.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await migrator.migrate();

      const rows = conn.db.prepare('SELECT * FROM schema_migrations').all();
      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(1);
      expect(rows[0].name).toBe('001_test.sql');
      expect(rows[0].applied_at).toBeDefined();
    });

    it('skips already-applied migrations', async () => {
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await migrator.migrate();

      writeMigration('002_second.sql', 'CREATE TABLE second (id INTEGER PRIMARY KEY)');
      const result = await migrator.migrate();

      expect(result.applied).toEqual(['002_second.sql']);
      expect(result.current_version).toBe(2);
    });

    it('rolls back on migration failure', async () => {
      writeMigration('001_bad.sql', 'INVALID SQL STATEMENT');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await expect(migrator.migrate()).rejects.toThrow(MigrationError);

      // schema_migrations should exist but have no entries
      const rows = conn.db.prepare('SELECT * FROM schema_migrations').all();
      expect(rows).toHaveLength(0);
    });

    it('handles empty migrations directory', async () => {
      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      const result = await migrator.migrate();

      expect(result.applied).toEqual([]);
      expect(result.current_version).toBe(0);
    });

    it('is re-entrant — running migrate twice is safe', async () => {
      writeMigration('001_test.sql', 'CREATE TABLE t (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await migrator.migrate();
      const result = await migrator.migrate();

      expect(result.applied).toEqual([]);
      expect(result.current_version).toBe(1);
    });
  });

  describe('getCurrentVersion()', () => {
    it('returns 0 when no migrations applied', () => {
      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      migrator.initialize();
      expect(migrator.getCurrentVersion()).toBe(0);
    });

    it('returns correct version after migrations', async () => {
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');
      writeMigration('002_second.sql', 'CREATE TABLE second (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await migrator.migrate();

      expect(migrator.getCurrentVersion()).toBe(2);
    });

    it('returns 0 when schema_migrations table does not exist', () => {
      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      expect(migrator.getCurrentVersion()).toBe(0);
    });
  });

  describe('getPendingMigrations()', () => {
    it('returns all files when none applied', () => {
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');
      writeMigration('002_second.sql', 'CREATE TABLE second (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      migrator.initialize();

      expect(migrator.getPendingMigrations()).toEqual(['001_first.sql', '002_second.sql']);
    });

    it('returns only unapplied files', async () => {
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      await migrator.migrate();

      writeMigration('002_second.sql', 'CREATE TABLE second (id INTEGER PRIMARY KEY)');
      expect(migrator.getPendingMigrations()).toEqual(['002_second.sql']);
    });

    it('returns empty array for missing migrations directory', () => {
      const migrator = new Migrator(conn, { migrationsDir: '/nonexistent/path' });
      expect(migrator.getPendingMigrations()).toEqual([]);
    });

    it('ignores non-SQL files', () => {
      writeMigration('001_first.sql', 'CREATE TABLE first (id INTEGER PRIMARY KEY)');
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Migrations');

      const migrator = new Migrator(conn, { migrationsDir: tmpDir });
      migrator.initialize();

      expect(migrator.getPendingMigrations()).toEqual(['001_first.sql']);
    });
  });

  describe('custom migrationsDir', () => {
    it('uses custom directory via constructor', async () => {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-custom-'));
      fs.writeFileSync(path.join(customDir, '001_custom.sql'), 'CREATE TABLE custom (id INTEGER PRIMARY KEY)');

      const migrator = new Migrator(conn, { migrationsDir: customDir });
      const result = await migrator.migrate();

      expect(result.applied).toEqual(['001_custom.sql']);

      // Clean up
      fs.unlinkSync(path.join(customDir, '001_custom.sql'));
      fs.rmdirSync(customDir);
    });
  });
});
