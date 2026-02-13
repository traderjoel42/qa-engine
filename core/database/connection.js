'use strict';

const Database = require('better-sqlite3');
const { ConnectionError } = require('../engine/errors');

class DatabaseConnection {
  constructor(options = {}) {
    this._db = null;
    this._dbPath = options.dbPath || ':memory:';
    this._pragmas = options.pragmas || {
      journal_mode: 'WAL',
      foreign_keys: 'ON',
      busy_timeout: 5000
    };
  }

  open() {
    if (this._db) {
      return this;
    }
    try {
      this._db = new Database(this._dbPath);
      for (const [key, value] of Object.entries(this._pragmas)) {
        this._db.pragma(`${key} = ${value}`);
      }
    } catch (err) {
      throw new ConnectionError(`Failed to open database: ${err.message}`, {
        cause: err,
        details: { dbPath: this._dbPath }
      });
    }
    return this;
  }

  close() {
    if (this._db) {
      try {
        this._db.close();
      } catch (err) {
        throw new ConnectionError(`Failed to close database: ${err.message}`, {
          cause: err
        });
      } finally {
        this._db = null;
      }
    }
  }

  get db() {
    if (!this._db) {
      throw new ConnectionError('Database is not open', {
        code: 'CONNECTION_NOT_OPEN'
      });
    }
    return this._db;
  }

  transaction(fn) {
    const trx = this.db.transaction(fn);
    return trx();
  }
}

module.exports = DatabaseConnection;
