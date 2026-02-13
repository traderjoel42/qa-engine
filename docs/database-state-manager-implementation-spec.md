# Database Layer + State Manager — Implementation Spec

**QA Engine Phase 1, Week 4, Days 1-2**  
**Date:** February 12, 2026  
**Depends on:** All Week 1-3 components (Connectors, Agents, Orchestrator, Bug Detector, Auto-Fixer, Approval Manager, Integration Adapters)  
**Reference:** `qa-engine-04-database-schema-spec.md`, `qa-engine-02-core-engine-spec.md` §5 (State Manager)

---

## Overview

Build the persistence layer (SQLite via `better-sqlite3`) and the State Manager that gives the QA Engine durable memory across runs. After this work, test results, bugs, approvals, and fixes survive process restarts. Every existing component continues to work unchanged — the database and State Manager are new injectable dependencies, not replacements.

**Deliverables:**
1. **Database module** — schema, migrations, connection management, repository classes
2. **State Manager** — in-memory active state + database-backed persistence
3. **~150-180 new tests**, zero regressions on existing 1238

---

## Day 1: Database Layer

### Architecture

```
core/database/
├── connection.js          # Connection factory + lifecycle
├── migrator.js            # Schema versioning + migration runner
├── migrations/
│   └── 001_initial_schema.sql
├── repositories/
│   ├── base-repository.js # Shared CRUD + query helpers
│   ├── app-repository.js
│   ├── test-run-repository.js
│   ├── test-result-repository.js
│   ├── bug-repository.js
│   ├── approval-repository.js
│   ├── fix-repository.js
│   └── evidence-metadata-repository.js
└── index.js               # Public API: createDatabase({ dbPath })
```

### 1. Connection Manager

**File:** `core/database/connection.js`

```javascript
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

  open() { /* opens better-sqlite3, applies pragmas, returns this */ }
  close() { /* closes connection, nulls _db */ }
  get db() { /* returns raw better-sqlite3 instance, throws if not open */ }

  // Transaction helper
  transaction(fn) {
    const trx = this._db.transaction(fn);
    return trx();
  }
}
```

**Design decisions:**
- `better-sqlite3` is synchronous — no async/await needed for DB ops. This simplifies everything.
- WAL mode for concurrent reads during test runs.
- `foreign_keys = ON` enforced at connection level — SQLite disables them by default.
- `:memory:` default makes unit testing trivial — no temp file cleanup.
- Constructor takes options object for testability. No singletons, no global state.

**Constructor signature:**
```javascript
new DatabaseConnection({ dbPath, pragmas })
```

**Tests (~15):**
- Opens in-memory database
- Opens file-based database (temp dir)
- Applies WAL pragma
- Enforces foreign keys
- `db` getter throws when not open
- `close()` is idempotent
- `transaction()` commits on success
- `transaction()` rolls back on error
- Multiple connections to same file work (WAL mode)
- Pragmas are configurable

### 2. Migrator

**File:** `core/database/migrator.js`

```javascript
class Migrator {
  constructor(connection, options = {}) {
    this._connection = connection;
    this._migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
  }

  initialize() {
    /* Creates schema_migrations table if not exists */
  }

  async migrate() {
    /* Reads migration files, applies unapplied ones in order, records in schema_migrations */
    /* Returns { applied: ['001_initial_schema'], current_version: 1 } */
  }

  getCurrentVersion() {
    /* Returns current schema version number */
  }

  getPendingMigrations() {
    /* Returns list of unapplied migration filenames */
  }
}
```

**Migration file format:**
- Filename: `NNN_description.sql` (e.g., `001_initial_schema.sql`)
- Contains raw SQL statements separated by `;`
- Applied inside a transaction — all-or-nothing

**Migration naming:**
```
001_initial_schema.sql      ← Day 1 (this spec)
002_add_evidence_metadata.sql  ← Future
003_add_user_tables.sql        ← Phase 3
```

**Tests (~12):**
- Creates schema_migrations table on initialize
- Discovers migration files from directory
- Applies migrations in numeric order
- Records applied migrations with timestamp
- Skips already-applied migrations
- Returns correct current version
- Returns correct pending list
- Rolls back on migration failure (single migration atomic)
- Handles empty migrations directory
- Handles missing migrations directory gracefully
- Re-entrant (running migrate twice is safe)
- Custom migrationsDir via constructor

### 3. Initial Schema (Migration 001)

**File:** `core/database/migrations/001_initial_schema.sql`

Adapted from `qa-engine-04-database-schema-spec.md` for SQLite:

```sql
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
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  bug_id TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_approvals_bug ON approvals(bug_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_approval_id ON approvals(approval_id);

-- Fixes
CREATE TABLE IF NOT EXISTS fixes (
  id TEXT PRIMARY KEY,
  bug_id TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_fixes_bug ON fixes(bug_id);
CREATE INDEX IF NOT EXISTS idx_fixes_app ON fixes(app_id);
CREATE INDEX IF NOT EXISTS idx_fixes_status ON fixes(status);

-- Evidence Metadata
CREATE TABLE IF NOT EXISTS evidence_metadata (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  test_run_id TEXT REFERENCES test_runs(id) ON DELETE CASCADE,
  bug_id TEXT REFERENCES bugs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_app ON evidence_metadata(app_id);
CREATE INDEX IF NOT EXISTS idx_evidence_test_run ON evidence_metadata(test_run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_bug ON evidence_metadata(bug_id);

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**SQLite adaptations from the PostgreSQL spec:**
- `UUID` → `TEXT` (app code generates UUIDs via `crypto.randomUUID()`)
- `JSONB` → `TEXT` (stored as JSON strings, parsed in app code)
- `TIMESTAMPTZ` → `TEXT` (ISO 8601 strings, `datetime('now')` default)
- `BOOLEAN` → `INTEGER` (0/1)
- `TEXT[]` → `TEXT` (JSON arrays as strings)
- No `gen_random_uuid()` — app generates IDs
- No `SEQUENCE` — app manages `BUG-NNN` numbering via MAX query
- `IF NOT EXISTS` on all CREATE statements for idempotency

**Tests (~8):**
- Migration creates all 7 tables + schema_migrations
- All indexes created
- Foreign key constraints enforced (insert child without parent fails)
- CASCADE delete works (delete app → deletes test_runs, bugs, etc.)
- Default values populated correctly
- JSON text columns accept valid JSON
- Datetime defaults populate as ISO strings
- Schema is idempotent (running migration twice doesn't error)

### 4. Base Repository

**File:** `core/database/repositories/base-repository.js`

```javascript
class BaseRepository {
  constructor(connection, tableName) {
    this._connection = connection;
    this._tableName = tableName;
  }

  // Core CRUD
  create(data)          { /* INSERT, generates id if missing, returns record */ }
  findById(id)          { /* SELECT by id, returns record or null */ }
  findOne(where)        { /* SELECT with where conditions, returns first or null */ }
  findMany(where, options) { /* SELECT with where, orderBy, limit, offset */ }
  update(id, data)      { /* UPDATE by id, sets updated_at if column exists, returns record */ }
  delete(id)            { /* DELETE by id, returns boolean */ }
  count(where)          { /* COUNT with optional where */ }
  exists(where)         { /* Returns boolean */ }

  // Query building helpers (internal)
  _buildWhere(conditions)   { /* { status: 'open', app_id: '...' } → 'WHERE status = ? AND app_id = ?' */ }
  _buildOrderBy(orderBy)    { /* { created_at: 'DESC' } → 'ORDER BY created_at DESC' */ }
  _serializeJson(data)      { /* Stringify any object/array values for SQLite TEXT columns */ }
  _deserializeJson(row, jsonColumns) { /* Parse JSON TEXT columns back to objects */ }
  _generateId()             { /* crypto.randomUUID() */ }
}
```

**Design decisions:**
- JSON serialization/deserialization happens at the repository boundary — callers work with native objects, DB stores strings. Each concrete repository declares its own `jsonColumns` list.
- `updated_at` is set automatically on `update()` if the table has that column.
- `_buildWhere` supports simple equality only. No complex query builder — if a repository needs a custom query, it writes raw SQL. YAGNI.
- ID generation uses `crypto.randomUUID()` (Node 19+, available in current LTS).

**Constructor signature:**
```javascript
new BaseRepository(connection, tableName)
```

**Tests (~25):**
- `create()` generates UUID when id not provided
- `create()` uses provided id when given
- `create()` returns the created record with all defaults
- `findById()` returns record when exists
- `findById()` returns null when not found
- `findOne()` with single condition
- `findOne()` with multiple conditions
- `findOne()` returns null when no match
- `findMany()` returns all matching records
- `findMany()` with orderBy
- `findMany()` with limit
- `findMany()` with limit + offset
- `findMany()` returns empty array when no matches
- `update()` modifies specified fields only
- `update()` sets updated_at automatically
- `update()` returns updated record
- `update()` returns null for nonexistent id
- `delete()` removes record
- `delete()` returns true on success
- `delete()` returns false for nonexistent id
- `count()` with no conditions returns total
- `count()` with conditions returns filtered count
- `exists()` returns true when match exists
- `exists()` returns false when no match
- JSON serialization: objects stored as strings, returned as objects
- JSON deserialization handles null JSON columns

### 5. Concrete Repositories

Each extends BaseRepository with table-specific queries and JSON column declarations.

**File:** `core/database/repositories/app-repository.js`

```javascript
class AppRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'apps');
    this._jsonColumns = ['config'];
  }

  findByName(name)            { /* findOne({ name }) */ }
  findActive()                { /* findMany({ status: 'active' }) */ }
  updateLastTestRun(id, timestamp) { /* update(id, { last_test_run_at }) */ }
}
```

**File:** `core/database/repositories/test-run-repository.js`

```javascript
class TestRunRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'test_runs');
    this._jsonColumns = ['agents', 'summary'];
  }

  findByApp(appId, options)     { /* findMany with app_id filter + options */ }
  findActive()                  { /* findMany({ status: 'running' }) */ }
  findRecent(appId, limit = 10) { /* Most recent N runs for app, ordered by started_at DESC */ }
  complete(id, summary)         { /* update with status, summary, completed_at */ }

  // Aggregation
  getPassRate(appId, days = 30) {
    /* Raw SQL: AVG pass_rate from summary JSON for last N days */
  }
}
```

**File:** `core/database/repositories/test-result-repository.js`

```javascript
class TestResultRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'test_results');
    this._jsonColumns = ['details', 'evidence'];
  }

  findByTestRun(testRunId)    { /* findMany with test_run_id filter */ }
  findByAgent(appId, agentId) { /* findMany with app_id + agent_id */ }
  findFailed(appId, options)  { /* findMany with status = 'failed' */ }
}
```

**File:** `core/database/repositories/bug-repository.js`

```javascript
class BugRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'bugs');
    this._jsonColumns = ['evidence', 'fix_details', 'related_bugs'];
  }

  findByApp(appId, options)   { /* findMany with app_id filter + options */ }
  findOpen(appId)             { /* findMany with status IN ('open', 'in-progress') */ }
  findBySeverity(appId, severity) { /* findMany with app_id + severity */ }
  findByBugId(bugId)          { /* findOne({ bug_id: bugId }) */ }

  nextBugNumber(appId) {
    /* SELECT MAX(CAST(SUBSTR(bug_id, 5) AS INTEGER)) FROM bugs WHERE app_id = ? */
    /* Returns next available number, e.g., 248 if highest is BUG-247 */
  }

  updateStatus(id, status, extraFields = {}) {
    /* update with status + any extra fields like fixed_at, verified_at */
  }
}
```

**File:** `core/database/repositories/approval-repository.js`

```javascript
class ApprovalRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'approvals');
    this._jsonColumns = [];
  }

  findByApprovalId(approvalId) { /* findOne({ approval_id: approvalId }) */ }
  findPending()                { /* findMany({ status: 'pending' }) */ }
  findExpired()                { /* Raw SQL: pending + timeout_at < datetime('now') */ }
  findByBug(bugId)             { /* findMany({ bug_id: bugId }) */ }

  respond(id, status, respondedVia) {
    /* update with status, responded_at, responded_via */
  }
}
```

**File:** `core/database/repositories/fix-repository.js`

```javascript
class FixRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'fixes');
    this._jsonColumns = ['generated_fix', 'safety_review', 'verification_result'];
  }

  findByBug(bugId)        { /* findMany({ bug_id: bugId }) */ }
  findByApp(appId, options) { /* findMany with app_id + options */ }
  findInProgress()        { /* findMany({ status: 'in-progress' }) */ }
}
```

**File:** `core/database/repositories/evidence-metadata-repository.js`

```javascript
class EvidenceMetadataRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'evidence_metadata');
    this._jsonColumns = ['metadata'];
  }

  findByTestRun(testRunId) { /* findMany with test_run_id filter */ }
  findByBug(bugId)         { /* findMany with bug_id filter */ }
  findByType(appId, type)  { /* findMany with app_id + type filter */ }
  getStorageUsage(appId)   { /* Raw SQL: SUM(file_size) for app */ }
}
```

**Tests for concrete repositories (~40 total, ~5-7 per repository):**

Each repository's tests follow the same pattern:
1. Test custom finder methods return correct results
2. Test JSON columns serialize/deserialize properly
3. Test table-specific business logic (e.g., `nextBugNumber`, `getPassRate`)
4. Test edge cases (empty results, boundary conditions)

Specific notable tests:
- `BugRepository.nextBugNumber()` returns 1 when no bugs exist
- `BugRepository.nextBugNumber()` returns correct next number with existing bugs
- `TestRunRepository.getPassRate()` calculates correctly from summary JSON
- `ApprovalRepository.findExpired()` correctly identifies timed-out approvals
- `EvidenceMetadataRepository.getStorageUsage()` sums file_size correctly
- Cascade deletes propagate through repositories (delete app → verify test_runs gone)

### 6. Database Module Public API

**File:** `core/database/index.js`

```javascript
function createDatabase(options = {}) {
  const connection = new DatabaseConnection(options);
  connection.open();

  const migrator = new Migrator(connection, options);
  migrator.initialize();
  migrator.migrate();

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
    close: () => connection.close()
  };
}

module.exports = { createDatabase, DatabaseConnection, Migrator, /* ...repositories */ };
```

**Usage:**
```javascript
// In-memory for tests
const db = createDatabase();

// File-based for production
const db = createDatabase({ dbPath: './data/qa-engine.db' });

// Use repositories
const app = db.apps.create({ name: 'Brainstormy', type: 'ai-chat', config: { ... } });
const runs = db.testRuns.findByApp(app.id);

// Cleanup
db.close();
```

**Tests (~5):**
- `createDatabase()` returns object with all repositories
- `createDatabase()` runs migrations automatically
- `createDatabase({ dbPath })` creates file-based database
- `close()` cleans up connection
- Repositories share the same connection instance

### Day 1 Test Summary

| Component | Tests |
|-----------|-------|
| DatabaseConnection | ~15 |
| Migrator | ~12 |
| Schema (001 migration) | ~8 |
| BaseRepository | ~25 |
| Concrete Repositories (7) | ~40 |
| Database Module (index.js) | ~5 |
| **Day 1 Total** | **~105** |

---

## Day 2: State Manager

### Architecture

```
core/engine/
└── state-manager.js      # In-memory state + DB persistence

tests/engine/
└── state-manager.test.js
```

The State Manager sits between the Orchestrator/Bug Detector/Approval Manager/Auto-Fixer and the database. Active state (running test runs, pending approvals, in-progress fixes) lives in memory for fast access. Completed state persists to the database.

### State Manager Design

**File:** `core/engine/state-manager.js`

```javascript
class StateManager {
  constructor(options = {}) {
    // Database (injectable, defaults to null = in-memory only mode)
    this._db = options.db || null;

    // In-memory active state
    this._activeTestRuns = new Map();   // id → testRun
    this._pendingApprovals = new Map(); // approvalId → approval
    this._activeFixes = new Map();      // bugId → fix
    this._agentHealth = new Map();      // agentId → health

    // Timeout tracking (for approvals)
    this._timeouts = new Map();         // approvalId → timeoutId
  }
}
```

**Constructor signature:**
```javascript
new StateManager({ db })
```

Where `db` is the object returned by `createDatabase()` (or null for pure in-memory mode). This maintains the injectable dependency pattern used throughout the project.

### State Manager API

#### Test Run Lifecycle

```javascript
// Create a new test run — writes to memory + DB
async createTestRun(appId, agents, options = {}) {
  // options: { environment, triggeredBy, triggeredVia }
  // Returns: { id, app_id, agents, status: 'running', progress, started_at }
}

// Update progress as agents complete
async updateTestRunProgress(testRunId, agentId, result) {
  // result: { status: 'completed'|'failed'|'error', summary }
  // Updates progress.completed_agents, progress.current_agent
  // Persists to DB
}

// Mark test run complete — moves from active memory to DB only
async completeTestRun(testRunId, summary) {
  // summary: { total, passed, failed, skipped, duration_ms, pass_rate, bugs_created }
  // Sets status = summary.failed === 0 ? 'completed' : 'failed'
  // Sets completed_at
  // Removes from _activeTestRuns
  // Updates app.last_test_run_at
}

// Query
getActiveTestRuns()            { /* Returns Array from _activeTestRuns */ }
getTestRun(testRunId)          { /* Memory first, then DB fallback */ }
async getRecentTestRuns(appId, limit = 10) { /* DB query via repository */ }
```

#### Approval Lifecycle

```javascript
// Track a new pending approval
async trackApproval(bugId, approvalId, options = {}) {
  // options: { timeoutMs = 3600000, channel }
  // Creates approval record in memory + DB
  // Does NOT set setTimeout — external scheduler calls checkTimeouts()
  // Returns: { id, bug_id, approval_id, status: 'pending', timeout_at }
}

// Update approval status
async updateApproval(approvalId, status, respondedVia) {
  // status: 'approved', 'rejected', 'timed-out'
  // Sets responded_at, responded_via
  // Removes from _pendingApprovals
  // Persists to DB
}

// Check for expired approvals (called by external scheduler)
async checkTimeouts() {
  // Iterates _pendingApprovals, checks timeout_at
  // Returns array of expired approvalIds (caller handles notification)
  // Does NOT auto-update status — returns expired list, caller decides
}

// Query
getPendingApprovals()           { /* Returns Array from _pendingApprovals */ }
getApproval(approvalId)         { /* Memory first, then DB fallback */ }
async getApprovalsByBug(bugId)  { /* DB query */ }
```

**Important:** The original spec uses `setTimeout` for approval timeouts. We change this to `checkTimeouts()` called by an external scheduler for two reasons: (1) `setTimeout` doesn't survive process restarts, and (2) it's untestable without timer mocking. The external scheduler (Week 4 Day 5 or Week 5) calls `checkTimeouts()` on an interval.

#### Fix Lifecycle

```javascript
// Track an in-progress fix
async trackFix(bugId, appId, fixData) {
  // fixData: { fix_type, generated_fix }
  // Returns: { id, bug_id, app_id, status: 'in-progress', started_at }
}

// Update fix status
async updateFixStatus(bugId, status, details = {}) {
  // status: 'applied', 'verified', 'failed', 'rolled-back'
  // details: { verification_result, error, applied_at, verified_at, rolled_back_at }
  // On terminal status (verified, failed, rolled-back): removes from _activeFixes
  // Persists to DB
}

// Query
getActiveFixes()       { /* Returns Array from _activeFixes */ }
getFix(bugId)          { /* Memory first, then DB fallback */ }
async getFixesByApp(appId) { /* DB query */ }
```

#### Agent Health Tracking

```javascript
// Record agent health status (pure in-memory, no DB persistence)
trackAgentHealth(agentId, health) {
  // health: { status: 'healthy'|'degraded'|'unhealthy', error_count, last_success, last_error }
  // Updates _agentHealth map
}

getAgentHealth(agentId)  { /* Returns health object or null */ }
getAllAgentHealth()       { /* Returns Map snapshot */ }
```

**Design decision:** Agent health is ephemeral — it only matters while the engine is running. No DB persistence needed. Keeps the scope tight.

#### State Recovery (Process Restart)

```javascript
// Recover state from DB on startup
async recover() {
  // 1. Load running test runs from DB → _activeTestRuns
  //    Mark any found as 'interrupted' (they were running when process died)
  // 2. Load pending approvals from DB → _pendingApprovals
  // 3. Load in-progress fixes from DB → _activeFixes
  // Returns: { recoveredTestRuns, recoveredApprovals, recoveredFixes }
}
```

**Design decision:** `recover()` is called explicitly by the engine on startup, not automatically in the constructor. This keeps construction synchronous and gives the caller control over when recovery happens.

### State Manager — Full Method Summary

| Method | Memory | DB | Returns |
|--------|--------|----|---------|
| `createTestRun(appId, agents, opts)` | Write | Write | testRun |
| `updateTestRunProgress(id, agentId, result)` | Update | Update | void |
| `completeTestRun(id, summary)` | Delete | Update | void |
| `getActiveTestRuns()` | Read | — | Array |
| `getTestRun(id)` | Read | Fallback | testRun\|null |
| `getRecentTestRuns(appId, limit)` | — | Read | Array |
| `trackApproval(bugId, approvalId, opts)` | Write | Write | approval |
| `updateApproval(approvalId, status, via)` | Delete | Update | void |
| `checkTimeouts()` | Read | — | Array of expired IDs |
| `getPendingApprovals()` | Read | — | Array |
| `getApproval(approvalId)` | Read | Fallback | approval\|null |
| `getApprovalsByBug(bugId)` | — | Read | Array |
| `trackFix(bugId, appId, fixData)` | Write | Write | fix |
| `updateFixStatus(bugId, status, details)` | Conditional Delete | Update | void |
| `getActiveFixes()` | Read | — | Array |
| `getFix(bugId)` | Read | Fallback | fix\|null |
| `getFixesByApp(appId)` | — | Read | Array |
| `trackAgentHealth(agentId, health)` | Write | — | void |
| `getAgentHealth(agentId)` | Read | — | health\|null |
| `getAllAgentHealth()` | Read | — | Map |
| `recover()` | Write | Read | recovery summary |

### State Manager — Error Handling

The State Manager follows the project's established pattern: **DB failure should not crash the engine.**

```javascript
async _persistToDb(operation, fallbackValue) {
  if (!this._db) return fallbackValue;
  try {
    return await operation();
  } catch (error) {
    // Log warning but don't throw
    // In-memory state remains authoritative
    console.warn(`StateManager DB persistence failed: ${error.message}`);
    return fallbackValue;
  }
}
```

Every DB write is wrapped in this helper. If the database is unavailable or errors, the in-memory state continues working. This matches the "degraded mode" pattern from the Bug Detector (LLM failure → bug still tracked without enrichment).

### State Manager — Graceful Shutdown

```javascript
async shutdown() {
  // 1. Persist any dirty in-memory state to DB
  // 2. Mark active test runs as 'interrupted'
  // 3. Clear all Maps
  // Returns void — safe to call multiple times
}
```

### State Manager — Pure In-Memory Mode

When `db` is null (no database provided), the State Manager operates in pure in-memory mode:
- All writes go to Maps only
- All DB-backed queries return empty arrays
- `recover()` returns empty recovery summary
- `shutdown()` clears Maps without DB writes

This is critical for backward compatibility — all existing 1238 tests use no-op/null dependencies. A StateManager with no DB must work identically to having no StateManager at all.

### State Manager Tests

**Test file:** `tests/engine/state-manager.test.js`

#### Test Run Tests (~18)

- `createTestRun` adds to active map
- `createTestRun` persists to DB when db provided
- `createTestRun` generates UUID for id
- `createTestRun` sets status = 'running'
- `createTestRun` populates progress with agent count
- `updateTestRunProgress` increments completed_agents
- `updateTestRunProgress` advances current_agent
- `updateTestRunProgress` persists to DB
- `updateTestRunProgress` no-ops for unknown testRunId
- `completeTestRun` removes from active map
- `completeTestRun` sets completed status based on failures
- `completeTestRun` sets completed_at timestamp
- `completeTestRun` updates app.last_test_run_at
- `completeTestRun` persists summary to DB
- `getActiveTestRuns` returns only running tests
- `getTestRun` finds from memory first
- `getTestRun` falls back to DB
- `getRecentTestRuns` queries DB with limit

#### Approval Tests (~14)

- `trackApproval` adds to pending map
- `trackApproval` persists to DB
- `trackApproval` calculates timeout_at from timeoutMs
- `trackApproval` defaults to 1 hour timeout
- `updateApproval` removes from pending map
- `updateApproval` sets responded_at and responded_via
- `updateApproval` persists to DB
- `updateApproval` no-ops for unknown approvalId
- `checkTimeouts` returns empty array when nothing expired
- `checkTimeouts` returns expired approvalIds
- `checkTimeouts` does not auto-update status
- `getPendingApprovals` returns only pending
- `getApproval` finds from memory first, DB fallback
- `getApprovalsByBug` queries DB

#### Fix Tests (~12)

- `trackFix` adds to active map
- `trackFix` persists to DB
- `trackFix` sets status = 'in-progress'
- `updateFixStatus` updates status
- `updateFixStatus` removes from map on terminal status ('verified')
- `updateFixStatus` removes from map on terminal status ('failed')
- `updateFixStatus` removes from map on terminal status ('rolled-back')
- `updateFixStatus` keeps in map on non-terminal status ('applied')
- `updateFixStatus` persists to DB
- `getActiveFixes` returns only in-progress
- `getFix` finds from memory first, DB fallback
- `getFixesByApp` queries DB

#### Agent Health Tests (~6)

- `trackAgentHealth` stores in map
- `trackAgentHealth` updates existing entry
- `getAgentHealth` returns health object
- `getAgentHealth` returns null for unknown agent
- `getAllAgentHealth` returns full map
- Agent health is NOT persisted to DB

#### Recovery Tests (~8)

- `recover` loads running test_runs from DB
- `recover` marks loaded test_runs as 'interrupted'
- `recover` loads pending approvals from DB
- `recover` loads in-progress fixes from DB
- `recover` returns count summary
- `recover` handles empty DB gracefully
- `recover` in no-db mode returns empty summary
- `recover` doesn't duplicate already-loaded state

#### Degraded Mode Tests (~7)

- All methods work with `db = null` (pure in-memory)
- DB write failure doesn't throw
- DB write failure logs warning
- DB read failure returns null/empty
- In-memory state survives DB failure
- `shutdown` works with no DB
- `shutdown` is idempotent

#### Shutdown Tests (~3)

- `shutdown` persists dirty state to DB
- `shutdown` marks active runs as interrupted
- `shutdown` clears all Maps

### Day 2 Test Summary

| Component | Tests |
|-----------|-------|
| Test Run Lifecycle | ~18 |
| Approval Lifecycle | ~14 |
| Fix Lifecycle | ~12 |
| Agent Health | ~6 |
| Recovery | ~8 |
| Degraded Mode | ~7 |
| Shutdown | ~3 |
| **Day 2 Total** | **~68** |

---

## Combined Days 1-2 Summary

| Day | Component | Tests |
|-----|-----------|-------|
| 1 | Database Layer | ~105 |
| 2 | State Manager | ~68 |
| **Total** | | **~173** |

**Running total after Week 4 Days 1-2: ~1411 tests (1238 existing + 173 new)**

---

## File Checklist

### Day 1

- [ ] `core/database/connection.js`
- [ ] `core/database/migrator.js`
- [ ] `core/database/migrations/001_initial_schema.sql`
- [ ] `core/database/repositories/base-repository.js`
- [ ] `core/database/repositories/app-repository.js`
- [ ] `core/database/repositories/test-run-repository.js`
- [ ] `core/database/repositories/test-result-repository.js`
- [ ] `core/database/repositories/bug-repository.js`
- [ ] `core/database/repositories/approval-repository.js`
- [ ] `core/database/repositories/fix-repository.js`
- [ ] `core/database/repositories/evidence-metadata-repository.js`
- [ ] `core/database/index.js`
- [ ] `tests/database/connection.test.js`
- [ ] `tests/database/migrator.test.js`
- [ ] `tests/database/schema.test.js`
- [ ] `tests/database/base-repository.test.js`
- [ ] `tests/database/repositories.test.js` (all concrete repos)

### Day 2

- [ ] `core/engine/state-manager.js`
- [ ] `tests/engine/state-manager.test.js`

---

## Integration Points

### How State Manager Connects to Existing Components

The State Manager does NOT replace or modify existing components. It's a new optional dependency that the top-level engine wiring (Week 4 Day 5) passes in.

**Orchestrator** — Currently creates its own result objects and returns them. State Manager wraps around the orchestrator to persist results:
```javascript
// Engine wiring (not in State Manager itself):
const testRun = await stateManager.createTestRun(appId, agents);
const result = await orchestrator.run(connector, agents);
await stateManager.completeTestRun(testRun.id, result.summary);
```

**Bug Detector** — Currently returns bug objects. State Manager persists them:
```javascript
// In failureHandler wiring:
const bug = await bugDetector.detect(failure);
db.bugs.create(bug); // Direct repository call
```

**Approval Manager** — Currently tracks approvals in-memory with its own Maps. State Manager provides durable backing:
```javascript
// Approval Manager can optionally delegate to State Manager
const approval = await stateManager.trackApproval(bugId, approvalId);
```

**Auto-Fixer** — Currently uses no-op code executor and test runner. State Manager tracks fix lifecycle:
```javascript
await stateManager.trackFix(bugId, appId, fixData);
// ... fix runs ...
await stateManager.updateFixStatus(bugId, 'verified', { verification_result });
```

### What Does NOT Change

- No existing constructor signatures change
- No existing test files are modified
- Orchestrator, BugDetector, ApprovalManager, AutoFixer remain injectable-defaults-only
- All 1238 existing tests continue to pass without any state manager involvement

---

## Error Hierarchy

Following the project's established error pattern (from `bug-detector-adapters-implementation-spec.md`):

```javascript
class DatabaseError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = options.code || 'DB_ERROR';
    this.cause = options.cause || null;
  }
}

class ConnectionError extends DatabaseError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'CONNECTION_ERROR' });
    this.name = 'ConnectionError';
  }
}

class MigrationError extends DatabaseError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'MIGRATION_ERROR' });
    this.name = 'MigrationError';
  }
}

class StateManagerError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'StateManagerError';
    this.code = options.code || 'STATE_ERROR';
    this.cause = options.cause || null;
  }
}
```

---

## Dependencies

### New npm packages

```json
{
  "better-sqlite3": "^11.x"
}
```

That's it. One new dependency. `crypto.randomUUID()` is built into Node.js. `path` and `fs` are built-in. No ORM, no query builder — raw SQL via `better-sqlite3`'s synchronous API.

### Why better-sqlite3 over alternatives

- **Synchronous API** — no async ceremony for simple queries. Tests are simpler.
- **fastest SQLite binding for Node** — benchmarked 2-5x faster than `sqlite3` package.
- **Prepared statements by default** — SQL injection protection built in.
- **WAL mode support** — concurrent reads during test runs.
- **`:memory:` support** — unit tests need no file cleanup.
- **No native addon drama** — prebuilt binaries for all platforms.

---

## Validation Criteria

### Day 1 Complete When:
- [ ] `createDatabase()` returns working database with all repositories
- [ ] All 7 tables created with correct schema
- [ ] CRUD operations work on all repositories
- [ ] JSON serialization/deserialization transparent to callers
- [ ] Foreign key constraints enforced
- [ ] CASCADE deletes propagate correctly
- [ ] File-based and in-memory modes both work
- [ ] ~105 new tests passing
- [ ] All 1238 existing tests still passing

### Day 2 Complete When:
- [ ] State Manager tracks test runs, approvals, fixes, agent health
- [ ] In-memory state provides fast active-state queries
- [ ] DB persistence survives process restart (via `recover()`)
- [ ] Pure in-memory mode works without DB (backward compatible)
- [ ] DB failures degrade gracefully (warnings, not crashes)
- [ ] Shutdown persists dirty state
- [ ] ~68 new tests passing
- [ ] All 1238 + Day 1 tests still passing
- [ ] Zero regressions throughout
