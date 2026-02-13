-- Migration 002: Add scheduled_runs table for cron-based test scheduling

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id TEXT PRIMARY KEY,  -- UUID as text for SQLite
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,

  -- Schedule definition
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  test_mode TEXT NOT NULL DEFAULT 'smoke',  -- 'smoke', 'full', 'regression'
  agents TEXT NOT NULL DEFAULT '[]',  -- JSON array of agent IDs
  environment TEXT NOT NULL DEFAULT 'staging',

  -- State
  enabled INTEGER NOT NULL DEFAULT 1,  -- SQLite boolean

  -- Notification preferences
  notify_on_start INTEGER NOT NULL DEFAULT 0,
  notify_on_complete INTEGER NOT NULL DEFAULT 1,
  notify_only_failures INTEGER NOT NULL DEFAULT 0,

  -- Tracking
  last_run_at TEXT,  -- ISO timestamp
  last_run_status TEXT,  -- 'passed', 'failed', 'error'
  last_run_id TEXT,  -- FK to test_runs.id

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scheduled_runs_app ON scheduled_runs(app_id);
CREATE INDEX idx_scheduled_runs_enabled ON scheduled_runs(enabled);
