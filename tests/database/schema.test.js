'use strict';

const crypto = require('crypto');
const DatabaseConnection = require('../../core/database/connection');
const Migrator = require('../../core/database/migrator');

describe('Initial Schema (Migration 001)', () => {
  let conn;

  beforeEach(async () => {
    conn = new DatabaseConnection();
    conn.open();
    const migrator = new Migrator(conn);
    await migrator.migrate();
  });

  afterEach(() => {
    try { conn.close(); } catch {}
  });

  const EXPECTED_TABLES = [
    'apps', 'test_runs', 'test_results', 'bugs',
    'approvals', 'fixes', 'evidence_metadata'
  ];

  it('creates all 7 tables plus schema_migrations', () => {
    const tables = conn.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(r => r.name);

    expect(tables).toEqual(expect.arrayContaining([...EXPECTED_TABLES, 'schema_migrations']));
    expect(tables).toHaveLength(8);
  });

  it('creates all indexes', () => {
    const indexes = conn.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all().map(r => r.name);

    const expectedIndexes = [
      'idx_approvals_approval_id',
      'idx_approvals_bug',
      'idx_approvals_status',
      'idx_apps_status',
      'idx_bugs_app',
      'idx_bugs_created',
      'idx_bugs_severity',
      'idx_bugs_status',
      'idx_evidence_app',
      'idx_evidence_bug',
      'idx_evidence_test_run',
      'idx_fixes_app',
      'idx_fixes_bug',
      'idx_fixes_status',
      'idx_test_results_agent',
      'idx_test_results_app',
      'idx_test_results_run',
      'idx_test_results_status',
      'idx_test_runs_app',
      'idx_test_runs_started',
      'idx_test_runs_status'
    ];

    expect(indexes).toEqual(expectedIndexes);
  });

  it('enforces foreign key constraints — insert child without parent fails', () => {
    expect(() => {
      conn.db.prepare(
        "INSERT INTO test_runs (id, app_id, status) VALUES (?, ?, ?)"
      ).run('run-1', 'nonexistent-app', 'running');
    }).toThrow(/FOREIGN KEY/);
  });

  it('CASCADE delete works — delete app removes test_runs and bugs', () => {
    const appId = crypto.randomUUID();
    conn.db.prepare(
      "INSERT INTO apps (id, name, type) VALUES (?, ?, ?)"
    ).run(appId, 'Test App', 'web');

    conn.db.prepare(
      "INSERT INTO test_runs (id, app_id, status) VALUES (?, ?, ?)"
    ).run('run-1', appId, 'running');

    conn.db.prepare(
      "INSERT INTO bugs (id, app_id, bug_id, title, severity, priority, category, detected_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('bug-uuid-1', appId, 'BUG-001', 'Test Bug', 'high', 'high', 'functional', 'sentinel');

    conn.db.prepare("DELETE FROM apps WHERE id = ?").run(appId);

    const runs = conn.db.prepare("SELECT * FROM test_runs WHERE app_id = ?").all(appId);
    const bugs = conn.db.prepare("SELECT * FROM bugs WHERE app_id = ?").all(appId);
    expect(runs).toHaveLength(0);
    expect(bugs).toHaveLength(0);
  });

  it('default values populated correctly', () => {
    const appId = crypto.randomUUID();
    conn.db.prepare(
      "INSERT INTO apps (id, name, type) VALUES (?, ?, ?)"
    ).run(appId, 'Test App', 'web');

    const app = conn.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId);
    expect(app.config).toBe('{}');
    expect(app.status).toBe('active');
    expect(app.created_at).toBeDefined();
    expect(app.updated_at).toBeDefined();

    conn.db.prepare(
      "INSERT INTO test_runs (id, app_id) VALUES (?, ?)"
    ).run('run-1', appId);

    const run = conn.db.prepare("SELECT * FROM test_runs WHERE id = ?").get('run-1');
    expect(run.environment).toBe('staging');
    expect(run.agents).toBe('[]');
    expect(run.triggered_by).toBe('manual');
    expect(run.status).toBe('running');
  });

  it('JSON text columns accept valid JSON', () => {
    const appId = crypto.randomUUID();
    const config = JSON.stringify({ url: 'http://test.com', port: 3000 });
    conn.db.prepare(
      "INSERT INTO apps (id, name, type, config) VALUES (?, ?, ?, ?)"
    ).run(appId, 'Test App', 'web', config);

    const app = conn.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId);
    const parsed = JSON.parse(app.config);
    expect(parsed.url).toBe('http://test.com');
    expect(parsed.port).toBe(3000);
  });

  it('datetime defaults populate as ISO strings', () => {
    const appId = crypto.randomUUID();
    conn.db.prepare(
      "INSERT INTO apps (id, name, type) VALUES (?, ?, ?)"
    ).run(appId, 'Test App', 'web');

    const app = conn.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId);
    // datetime('now') produces 'YYYY-MM-DD HH:MM:SS' format
    expect(app.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('schema is idempotent — running migration twice does not error', async () => {
    // The first migration was already applied in beforeEach on the same connection.
    // Run migrate again on the same connection — should be a no-op.
    const migrator2 = new Migrator(conn);
    const result = await migrator2.migrate();

    expect(result.applied).toEqual([]);
    expect(result.current_version).toBe(1);
  });
});
