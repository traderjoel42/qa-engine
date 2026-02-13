'use strict';

const crypto = require('crypto');
const { DatabaseError } = require('../../engine/errors');

class BaseRepository {
  constructor(connection, tableName) {
    this._connection = connection;
    this._tableName = tableName;
    this._jsonColumns = [];
  }

  create(data) {
    const record = { ...data };
    if (!record.id) {
      record.id = this._generateId();
    }
    const serialized = this._serializeJson(record);
    const columns = Object.keys(serialized);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(c => serialized[c]);

    try {
      this._connection.db.prepare(
        `INSERT INTO ${this._tableName} (${columns.join(', ')}) VALUES (${placeholders})`
      ).run(...values);
    } catch (err) {
      throw new DatabaseError(`Failed to create record in ${this._tableName}: ${err.message}`, {
        cause: err,
        details: { table: this._tableName }
      });
    }

    return this.findById(record.id);
  }

  findById(id) {
    const row = this._connection.db.prepare(
      `SELECT * FROM ${this._tableName} WHERE id = ?`
    ).get(id);
    return row ? this._deserializeJson(row) : null;
  }

  findOne(where) {
    const { clause, values } = this._buildWhere(where);
    const row = this._connection.db.prepare(
      `SELECT * FROM ${this._tableName} ${clause} LIMIT 1`
    ).get(...values);
    return row ? this._deserializeJson(row) : null;
  }

  findMany(where = {}, options = {}) {
    const { clause, values } = this._buildWhere(where);
    let sql = `SELECT * FROM ${this._tableName} ${clause}`;

    if (options.orderBy) {
      sql += ` ${this._buildOrderBy(options.orderBy)}`;
    }
    if (options.limit) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }
    if (options.offset) {
      sql += ` OFFSET ${Number(options.offset)}`;
    }

    const rows = this._connection.db.prepare(sql).all(...values);
    return rows.map(row => this._deserializeJson(row));
  }

  update(id, data) {
    const existing = this.findById(id);
    if (!existing) {
      return null;
    }

    const updateData = { ...data };
    // Auto-set updated_at if the table has that column
    if (this._hasColumn('updated_at') && !updateData.updated_at) {
      updateData.updated_at = new Date().toISOString();
    }

    const serialized = this._serializeJson(updateData);
    const columns = Object.keys(serialized);
    const setClause = columns.map(c => `${c} = ?`).join(', ');
    const values = columns.map(c => serialized[c]);

    try {
      this._connection.db.prepare(
        `UPDATE ${this._tableName} SET ${setClause} WHERE id = ?`
      ).run(...values, id);
    } catch (err) {
      throw new DatabaseError(`Failed to update record in ${this._tableName}: ${err.message}`, {
        cause: err,
        details: { table: this._tableName, id }
      });
    }

    return this.findById(id);
  }

  delete(id) {
    const result = this._connection.db.prepare(
      `DELETE FROM ${this._tableName} WHERE id = ?`
    ).run(id);
    return result.changes > 0;
  }

  count(where = {}) {
    const { clause, values } = this._buildWhere(where);
    const row = this._connection.db.prepare(
      `SELECT COUNT(*) as count FROM ${this._tableName} ${clause}`
    ).get(...values);
    return row.count;
  }

  exists(where) {
    const { clause, values } = this._buildWhere(where);
    const row = this._connection.db.prepare(
      `SELECT 1 FROM ${this._tableName} ${clause} LIMIT 1`
    ).get(...values);
    return !!row;
  }

  _buildWhere(conditions) {
    const keys = Object.keys(conditions);
    if (keys.length === 0) {
      return { clause: '', values: [] };
    }
    const clause = 'WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
    const values = keys.map(k => conditions[k]);
    return { clause, values };
  }

  _buildOrderBy(orderBy) {
    const parts = Object.entries(orderBy).map(
      ([col, dir]) => `${col} ${dir.toUpperCase()}`
    );
    return `ORDER BY ${parts.join(', ')}`;
  }

  _serializeJson(data) {
    const result = { ...data };
    for (const col of this._jsonColumns) {
      if (col in result && result[col] !== null && typeof result[col] === 'object') {
        result[col] = JSON.stringify(result[col]);
      }
    }
    return result;
  }

  _deserializeJson(row) {
    const result = { ...row };
    for (const col of this._jsonColumns) {
      if (col in result && result[col] !== null && typeof result[col] === 'string') {
        try {
          result[col] = JSON.parse(result[col]);
        } catch {
          // Leave as string if not valid JSON
        }
      }
    }
    return result;
  }

  _generateId() {
    return crypto.randomUUID();
  }

  _hasColumn(columnName) {
    try {
      const columns = this._connection.db.prepare(
        `PRAGMA table_info(${this._tableName})`
      ).all();
      return columns.some(c => c.name === columnName);
    } catch {
      return false;
    }
  }
}

module.exports = BaseRepository;
