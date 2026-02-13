-- Apps: root entity
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_test_run_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_apps_status ON apps(status);

-- Test Runs
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'staging',
  agents TEXT NOT NULL DEFAULT '[]',
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  triggered_via TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  evidence_path TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_test_runs_app ON test_runs(app_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_started ON test_runs(started_at);

-- Test Results
CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  test_name TEXT NOT NULL,
  scenario_name TEXT,
  status TEXT NOT NULL,
  details TEXT,
  evidence TEXT,
  bugs_created INTEGER DEFAULT 0,
  bug_ids TEXT,
  duration_ms INTEGER,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_app ON test_results(app_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);
CREATE INDEX IF NOT EXISTS idx_test_results_agent ON test_results(agent_id);

-- Bugs
CREATE TABLE IF NOT EXISTS bugs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  bug_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,
  priority TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  detected_by TEXT NOT NULL,
  test_run_id TEXT REFERENCES test_runs(id),
  test_id TEXT,
  root_cause TEXT,
  affected_component TEXT,
  likely_location TEXT,
  fix_approach TEXT,
  evidence TEXT,
  external_issue_id TEXT,
  external_issue_url TEXT,
  auto_fixable INTEGER DEFAULT 0,
  auto_fixed INTEGER DEFAULT 0,
  fix_details TEXT,
  related_bugs TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  fixed_at TEXT,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bugs_app ON bugs(app_id);
CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_bugs_severity ON bugs(severity);
CREATE INDEX IF NOT EXISTS idx_bugs_created ON bugs(created_at);

-- Approvals
-- NOTE: FK column is bug_ref_id (not bug_id) to avoid collision with bugs.bug_id (the human-readable BUG-NNN)
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  bug_ref_id TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  approval_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notification_sent_at TEXT,
  notification_channel TEXT,
  responded_at TEXT,
  responded_via TEXT,
  responder_id TEXT,
  timeout_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_bug ON approvals(bug_ref_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_approval_id ON approvals(approval_id);

-- Fixes
-- NOTE: FK column is bug_ref_id (not bug_id) to avoid collision with bugs.bug_id (the human-readable BUG-NNN)
CREATE TABLE IF NOT EXISTS fixes (
  id TEXT PRIMARY KEY,
  bug_ref_id TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  fix_type TEXT NOT NULL,
  generated_fix TEXT,
  safety_review TEXT,
  applied_at TEXT,
  verified_at TEXT,
  rolled_back_at TEXT,
  verification_result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fixes_bug ON fixes(bug_ref_id);
CREATE INDEX IF NOT EXISTS idx_fixes_app ON fixes(app_id);
CREATE INDEX IF NOT EXISTS idx_fixes_status ON fixes(status);

-- Evidence Metadata
CREATE TABLE IF NOT EXISTS evidence_metadata (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  test_run_id TEXT REFERENCES test_runs(id) ON DELETE CASCADE,
  bug_ref_id TEXT REFERENCES bugs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_app ON evidence_metadata(app_id);
CREATE INDEX IF NOT EXISTS idx_evidence_test_run ON evidence_metadata(test_run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_bug ON evidence_metadata(bug_ref_id);

-- NOTE: schema_migrations table is NOT created here.
-- It is created by Migrator.initialize() before any migrations run.
