'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseConnection = require('../../core/database/connection');
const { ConnectionError } = require('../../core/engine/errors');

describe('DatabaseConnection', () => {
  let conn;

  afterEach(() => {
    if (conn) {
      try { conn.close(); } catch {}
      conn = null;
    }
  });

  describe('constructor', () => {
    it('uses :memory: as default dbPath', () => {
      conn = new DatabaseConnection();
      expect(conn._dbPath).toBe(':memory:');
    });

    it('accepts custom dbPath', () => {
      conn = new DatabaseConnection({ dbPath: '/tmp/test.db' });
      expect(conn._dbPath).toBe('/tmp/test.db');
    });

    it('uses default pragmas when none provided', () => {
      conn = new DatabaseConnection();
      expect(conn._pragmas).toEqual({
        journal_mode: 'WAL',
        foreign_keys: 'ON',
        busy_timeout: 5000
      });
    });

    it('accepts custom pragmas', () => {
      const pragmas = { journal_mode: 'DELETE', foreign_keys: 'OFF' };
      conn = new DatabaseConnection({ pragmas });
      expect(conn._pragmas).toEqual(pragmas);
    });
  });

  describe('open()', () => {
    it('opens an in-memory database', () => {
      conn = new DatabaseConnection();
      const result = conn.open();
      expect(result).toBe(conn);
      expect(conn._db).not.toBeNull();
    });

    it('opens a file-based database', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-db-'));
      const dbPath = path.join(tmpDir, 'test.db');
      conn = new DatabaseConnection({ dbPath });
      conn.open();
      expect(fs.existsSync(dbPath)).toBe(true);
      conn.close();
      fs.unlinkSync(dbPath);
      // Clean up WAL/SHM files if they exist
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
      fs.rmdirSync(tmpDir);
    });

    it('applies WAL pragma on file-based database', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-wal-'));
      const dbPath = path.join(tmpDir, 'wal-test.db');
      conn = new DatabaseConnection({ dbPath });
      conn.open();
      const result = conn.db.pragma('journal_mode');
      expect(result[0].journal_mode).toBe('wal');
      conn.close();
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
      try { fs.rmdirSync(tmpDir); } catch {}
    });

    it('enforces foreign keys', () => {
      conn = new DatabaseConnection();
      conn.open();
      const result = conn.db.pragma('foreign_keys');
      expect(result[0].foreign_keys).toBe(1);
    });

    it('sets busy_timeout', () => {
      conn = new DatabaseConnection();
      conn.open();
      const result = conn.db.pragma('busy_timeout');
      expect(result[0].timeout).toBe(5000);
    });

    it('is idempotent — calling open() twice returns same connection', () => {
      conn = new DatabaseConnection();
      conn.open();
      const db1 = conn._db;
      conn.open();
      const db2 = conn._db;
      expect(db1).toBe(db2);
    });

    it('throws ConnectionError for invalid path', () => {
      conn = new DatabaseConnection({ dbPath: '/nonexistent/dir/test.db' });
      expect(() => conn.open()).toThrow(ConnectionError);
    });
  });

  describe('close()', () => {
    it('closes an open connection', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.close();
      expect(conn._db).toBeNull();
    });

    it('is idempotent — closing twice does not throw', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.close();
      expect(() => conn.close()).not.toThrow();
    });

    it('does nothing when called on never-opened connection', () => {
      conn = new DatabaseConnection();
      expect(() => conn.close()).not.toThrow();
    });
  });

  describe('db getter', () => {
    it('returns the raw better-sqlite3 instance when open', () => {
      conn = new DatabaseConnection();
      conn.open();
      expect(conn.db).toBeDefined();
      expect(typeof conn.db.prepare).toBe('function');
    });

    it('throws ConnectionError when not open', () => {
      conn = new DatabaseConnection();
      expect(() => conn.db).toThrow(ConnectionError);
      expect(() => conn.db).toThrow('Database is not open');
    });

    it('throws ConnectionError after close', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.close();
      expect(() => conn.db).toThrow(ConnectionError);
    });
  });

  describe('transaction()', () => {
    it('commits on success', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

      conn.transaction(() => {
        conn.db.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
        conn.db.prepare('INSERT INTO t (val) VALUES (?)').run('world');
      });

      const rows = conn.db.prepare('SELECT * FROM t').all();
      expect(rows).toHaveLength(2);
    });

    it('rolls back on error', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

      expect(() => {
        conn.transaction(() => {
          conn.db.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
          throw new Error('Abort');
        });
      }).toThrow('Abort');

      const rows = conn.db.prepare('SELECT * FROM t').all();
      expect(rows).toHaveLength(0);
    });

    it('returns the value from the transaction function', () => {
      conn = new DatabaseConnection();
      conn.open();
      conn.db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

      const result = conn.transaction(() => {
        conn.db.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
        return 'done';
      });

      expect(result).toBe('done');
    });
  });
});
