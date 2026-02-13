'use strict';

const fs = require('fs');
const path = require('path');
const { MigrationError } = require('../engine/errors');

class Migrator {
  constructor(connection, options = {}) {
    this._connection = connection;
    this._migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
  }

  initialize() {
    try {
      this._connection.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    } catch (err) {
      throw new MigrationError(`Failed to initialize migrations table: ${err.message}`, {
        cause: err
      });
    }
  }

  async migrate() {
    this.initialize();

    const pending = this.getPendingMigrations();
    const applied = [];

    for (const filename of pending) {
      const version = parseInt(filename.split('_')[0], 10);
      const filePath = path.join(this._migrationsDir, filename);

      let sql;
      try {
        sql = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        throw new MigrationError(`Failed to read migration file: ${filename}`, {
          cause: err,
          details: { filename, filePath }
        });
      }

      try {
        this._connection.transaction(() => {
          this._connection.db.exec(sql);
          this._connection.db.prepare(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
          ).run(version, filename, new Date().toISOString());
        });
        applied.push(filename);
      } catch (err) {
        throw new MigrationError(`Migration failed: ${filename}`, {
          cause: err,
          details: { filename, version }
        });
      }
    }

    return {
      applied,
      current_version: this.getCurrentVersion()
    };
  }

  getCurrentVersion() {
    try {
      const row = this._connection.db.prepare(
        'SELECT MAX(version) as version FROM schema_migrations'
      ).get();
      return row?.version || 0;
    } catch {
      return 0;
    }
  }

  getPendingMigrations() {
    let files;
    try {
      if (!fs.existsSync(this._migrationsDir)) {
        return [];
      }
      files = fs.readdirSync(this._migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch {
      return [];
    }

    const appliedVersions = this._getAppliedVersions();
    return files.filter(f => {
      const version = parseInt(f.split('_')[0], 10);
      return !appliedVersions.has(version);
    });
  }

  _getAppliedVersions() {
    try {
      const rows = this._connection.db.prepare(
        'SELECT version FROM schema_migrations'
      ).all();
      return new Set(rows.map(r => r.version));
    } catch {
      return new Set();
    }
  }
}

module.exports = Migrator;
