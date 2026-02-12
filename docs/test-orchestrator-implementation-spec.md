# QA Engine: Test Orchestrator Implementation Specification

**Phase:** 1, Week 2, Day 5  
**Purpose:** Implementation-ready spec for `core/engine/test-orchestrator.js`  
**For:** Claude Code technical evaluation → implementation  
**Dependencies:** BaseAgent + HealerAgent (✅), SentinelAgent (✅), LibrarianAgent (✅), ConnectorFactory (✅) — 764 tests total across 11 suites  
**References:** qa-engine-01-overview-and-architecture.md, qa-engine-02-core-engine-spec.md, qa-engine-03-connector-pattern-spec.md, qa-engine-05-implementation-plan.md, docs/base-agent-healer-implementation-spec.md  

---

## 1. Design Decisions

### Why the Orchestrator Exists

The Test Orchestrator is the **coordination layer** between the outside world (CLI, WhatsApp, scheduled triggers) and the agent/connector execution pipeline. Without it, every caller would need to know how to create connectors, instantiate agents, manage lifecycles, aggregate results, and handle errors. The orchestrator encapsulates all of that into a single `run()` call.

### Orchestrator ≠ Agent

The orchestrator is **not** an agent. It doesn't extend BaseAgent, doesn't run scenarios, and doesn't evaluate assertions. It's a coordinator:

```
Caller (CLI / WhatsApp / Scheduler / API)
  └── TestOrchestrator.run(appConfig, options)
        ├── ConnectorFactory.create(appConfig) → connector
        ├── connector.initialize()
        ├── For each selected agent:
        │     ├── new AgentClass(agentConfig, connector)
        │     ├── agent.initialize()
        │     ├── agent.runTests() → TestRunResult
        │     ├── agent.cleanup()
        │     └── collect result (or error result on crash)
        ├── connector.cleanup()
        └── return OrchestratorResult (aggregated)
```

### Connector Lifecycle Ownership

**The orchestrator owns the connector lifecycle, not agents.** This is the key architectural boundary:

- Caller provides `page` (Playwright page instance) and `evidenceCollector` via run options
- Orchestrator calls `ConnectorFactory.create(appConfig, page, evidenceCollector, { skipInitialize: true })` once
- Orchestrator calls `connector.initialize()` once before any agents run
- Same connector instance is passed to every agent
- Orchestrator calls `connector.cleanup()` once after all agents finish
- Agents call their own `agent.initialize()` / `agent.cleanup()` within this window

**Why `skipInitialize: true`?** `ConnectorFactory.create()` auto-initializes by default (navigates to app, authenticates, verifies ready state). The orchestrator passes `{ skipInitialize: true }` so it can own the full lifecycle — this gives it clean error handling boundaries and ensures initialize errors are caught in the orchestrator's try/catch, not inside the factory.

**Why page/evidenceCollector come from the caller?** The orchestrator coordinates agents; it doesn't manage browser infrastructure. The caller (CLI script, scheduler, WhatsApp bot) is responsible for creating the Playwright browser/page and configuring evidence storage. This keeps the orchestrator testable and free from Playwright import dependencies.

**Why agents share a single session:** Re-creating connectors per agent would mean re-authenticating, re-navigating, and losing shared state. The connector is expensive; agents are cheap.

### Agent Registration Pattern

Agents aren't discovered at runtime or loaded from config files. They're **registered** with the orchestrator by the caller. This keeps the orchestrator free from import dependencies on specific agent classes:

```javascript
const orchestrator = new TestOrchestrator(options);
orchestrator.registerAgent('healer', HealerAgent, healerConfig);
orchestrator.registerAgent('sentinel', SentinelAgent, sentinelConfig);
orchestrator.registerAgent('librarian', LibrarianAgent, librarianConfig);
const result = await orchestrator.run(appConfig);
```

**Why not auto-discovery?** Auto-discovery requires filesystem assumptions, dynamic `require()`, and creates hidden coupling. Explicit registration is predictable, testable, and lets callers control exactly which agents run.

### Error Isolation Strategy

Two tiers of errors:

1. **Agent errors** — An agent throws during `initialize()`, `runTests()`, or `cleanup()`. The orchestrator catches, records an error result for that agent, and **continues to the next agent**. One broken agent never prevents others from running.

2. **Connector errors** — The connector throws during `initialize()` or fatally during the run. This is **unrecoverable** — all agents depend on the connector. The orchestrator aborts, records the connector error, and returns an error-status `OrchestratorResult`.

**Connector cleanup errors** are logged but don't change the overall result status. If all agents passed but cleanup failed, the result is still `passed` — cleanup is best-effort.

### Injectable Dependencies (Future-Ready, Not Over-Built)

The orchestrator accepts three optional injectable dependencies:

- **storage** — Persist `OrchestratorResult` somewhere (database, file). Default: no-op (result returned to caller only).
- **notifier** — Send completion notification (WhatsApp, Slack, email). Default: no-op.
- **failureHandler** — Process failures for bug detection pipeline. Default: no-op.

All three follow the same pattern: interface with a single async method, default implementation that does nothing. This keeps Phase 1 simple while giving Phase 2 (Bug Detector, WhatsApp) clean injection points.

### Agent Selection

Three selection modes:

- **`runAll()`** — Run every registered agent in registration order
- **`runAgents(agentIds)`** — Run specific agents by their registered ID. Throws `ConfigurationError` if any ID isn't registered.
- **`runByTag(tag)`** — Run agents whose config includes a matching tag in `config.tags[]`. Agents without tags are skipped.

All three return the same `OrchestratorResult` shape.

### Run ID Generation

Each orchestrator run gets a unique `runId` in the format `run-{timestamp}-{random}` (e.g., `run-1707753600000-a3b2`). Simple, sortable, unique enough for Phase 1. No UUID dependency needed.

---

## 2. Data Structures

### AgentRegistration

```javascript
/**
 * Internal record of a registered agent.
 * Stored in this._agents Map keyed by agentId.
 */
{
  agentId: 'healer',           // String — unique identifier
  AgentClass: HealerAgent,     // Constructor function — called with new
  config: { /* agent config */ }, // Object — passed to agent constructor
  tags: ['smoke', 'critical']  // String[] — from config.tags, defaults to []
}
```

### OrchestratorResult

```javascript
/**
 * Returned by all run methods.
 * Contains aggregated results from all agent runs.
 */
{
  runId: 'run-1707753600000-a3b2',   // String — unique run identifier
  appId: 'brainstormy',              // String — from appConfig.appId
  agentResults: [                     // TestRunResult[] — one per agent (including errored)
    {
      // Standard TestRunResult from BaseAgent
      agentId: 'healer',
      scenarios: [...],
      summary: { total: 5, passed: 5, failed: 0, errors: 0, skipped: 0 },
      durationMs: 1234,
      startedAt: '2025-02-12T...',
      completedAt: '2025-02-12T...'
    },
    {
      // Error result for crashed agent
      agentId: 'sentinel',
      scenarios: [],
      summary: { total: 0, passed: 0, failed: 0, errors: 1, skipped: 0 },
      durationMs: 50,
      startedAt: '2025-02-12T...',
      completedAt: '2025-02-12T...',
      error: {
        message: 'Memory config validation failed',
        name: 'ConfigurationError',
        stack: '...'
      }
    }
  ],
  summary: {
    totalAgents: 3,
    passedAgents: 2,       // Agent passed = 0 failed + 0 errors in summary
    failedAgents: 0,       // Agent failed = any failed scenarios
    errorAgents: 1,        // Agent errored = threw during execution
    totalScenarios: 10,
    passedScenarios: 10,
    failedScenarios: 0,
    errorScenarios: 1,     // From the crashed agent's error count
    skippedScenarios: 0
  },
  overallStatus: 'error',   // 'passed' | 'failed' | 'error'
  durationMs: 5678,          // Total wall-clock time
  startedAt: '2025-02-12T...',
  completedAt: '2025-02-12T...',
  trigger: 'manual',         // 'manual' | 'scheduled' | 'pre-deploy' | 'webhook'
  connectorError: null       // Error object if connector failed, null otherwise
}
```

**`overallStatus` logic:**
- `'passed'` — All agents' summaries have 0 failed and 0 errors
- `'failed'` — At least one agent has failed scenarios (but no agent-level crashes)
- `'error'` — At least one agent crashed (threw during execution) OR connector failed

**Priority:** `error` > `failed` > `passed`. If there's 1 error agent and 1 failed agent, status is `error`.

### Error Result Shape

When an agent crashes, the orchestrator creates a synthetic `TestRunResult`:

```javascript
{
  agentId: registration.agentId,
  scenarios: [],
  summary: { total: 0, passed: 0, failed: 0, errors: 1, skipped: 0 },
  durationMs: /* measured */,
  startedAt: /* captured */,
  completedAt: /* captured */,
  error: {
    message: error.message,
    name: error.name || 'Error',
    stack: error.stack
  }
}
```

### Connector Error Result

When the connector fails during initialization, the run aborts immediately:

```javascript
{
  runId, appId,
  agentResults: [],
  summary: {
    totalAgents: 0, passedAgents: 0, failedAgents: 0, errorAgents: 0,
    totalScenarios: 0, passedScenarios: 0, failedScenarios: 0,
    errorScenarios: 0, skippedScenarios: 0
  },
  overallStatus: 'error',
  durationMs: /* measured */,
  startedAt, completedAt,
  trigger,
  connectorError: {
    message: error.message,
    name: error.name || 'Error',
    stack: error.stack
  }
}
```

---

## 3. Constructor + Method Inventory

### Constructor

```javascript
/**
 * @param {Object} options
 * @param {Object} [options.connectorFactory] - Factory with .create(appConfig) method. Default: ConnectorFactory
 * @param {Object} [options.storage] - { async store(result) }. Default: no-op
 * @param {Object} [options.notifier] - { async notify(result) }. Default: no-op
 * @param {Object} [options.failureHandler] - { async handle(result) }. Default: no-op
 * @param {Function} [options.generateRunId] - Custom run ID generator. Default: built-in
 */
constructor(options = {})
```

**Stores:**
- `this._agents = new Map()` — AgentRegistration records keyed by agentId
- `this._connectorFactory` — ConnectorFactory or injected replacement
- `this._storage` — Storage dependency
- `this._notifier` — Notifier dependency
- `this._failureHandler` — Failure handler dependency
- `this._generateRunId` — Run ID generator function

### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `registerAgent(agentId, AgentClass, config)` | `void` | Register an agent for future runs |
| `unregisterAgent(agentId)` | `boolean` | Remove a registered agent. Returns true if found. |
| `getRegisteredAgents()` | `AgentRegistration[]` | List all registered agents |
| `run(appConfig, options)` | `Promise<OrchestratorResult>` | Run selected agents (default: all). **options.page** and **options.evidenceCollector** are required. |
| `runAll(appConfig, options)` | `Promise<OrchestratorResult>` | Explicit alias: run every registered agent |
| `runAgents(appConfig, agentIds, options)` | `Promise<OrchestratorResult>` | Run specific agents by ID |
| `runByTag(appConfig, tag, options)` | `Promise<OrchestratorResult>` | Run agents matching a tag |

### Private Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `_executeRun(appConfig, registrations, options)` | `Promise<OrchestratorResult>` | Core execution loop shared by all public run methods |
| `_runAgent(registration, connector)` | `Promise<TestRunResult>` | Run a single agent with error isolation |
| `_createErrorResult(registration, error, startedAt)` | `TestRunResult` | Create synthetic error result for crashed agent |
| `_createConnectorErrorResult(runId, appConfig, error, startedAt, trigger)` | `OrchestratorResult` | Create abort result for connector failure |
| `_aggregateSummary(agentResults)` | `Object` | Compute summary from array of TestRunResults |
| `_determineStatus(summary, hasConnectorError)` | `string` | Determine 'passed'/'failed'/'error' |
| `_generateRunId()` | `string` | Generate unique run-{timestamp}-{random} ID |
| `_serializeError(error)` | `Object` | Extract { message, name, stack } from error |

---

## 4. Implementation

### `core/engine/test-orchestrator.js`

```javascript
'use strict';

const ConnectorFactory = require('../../connectors/factory');
const { ConfigurationError } = require('../../agents/errors');

/**
 * Default no-op implementations for injectable dependencies.
 */
const NOOP_STORAGE = { store: async () => {} };
const NOOP_NOTIFIER = { notify: async () => {} };
const NOOP_FAILURE_HANDLER = { handle: async () => {} };

/**
 * Generate a unique run ID.
 * Format: run-{timestamp}-{random4hex}
 */
function defaultGenerateRunId() {
  const timestamp = Date.now();
  const random = Math.random().toString(16).slice(2, 6);
  return `run-${timestamp}-${random}`;
}

class TestOrchestrator {
  /**
   * @param {Object} options
   * @param {Object} [options.connectorFactory] - Must have .create(appConfig)
   * @param {Object} [options.storage] - Must have async .store(result)
   * @param {Object} [options.notifier] - Must have async .notify(result)
   * @param {Object} [options.failureHandler] - Must have async .handle(result)
   * @param {Function} [options.generateRunId] - Returns string run ID
   */
  constructor(options = {}) {
    this._agents = new Map();
    this._connectorFactory = options.connectorFactory || ConnectorFactory;
    this._storage = options.storage || NOOP_STORAGE;
    this._notifier = options.notifier || NOOP_NOTIFIER;
    this._failureHandler = options.failureHandler || NOOP_FAILURE_HANDLER;
    this._generateRunId = options.generateRunId || defaultGenerateRunId;
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT REGISTRATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Register an agent for future test runs.
   *
   * @param {string} agentId - Unique identifier (e.g., 'healer', 'sentinel')
   * @param {Function} AgentClass - Constructor function (not an instance)
   * @param {Object} config - Agent configuration passed to constructor
   * @throws {ConfigurationError} If agentId is not a string, AgentClass is not a function,
   *   or config is not an object
   */
  registerAgent(agentId, AgentClass, config) {
    if (typeof agentId !== 'string' || agentId.trim() === '') {
      throw new ConfigurationError('agentId must be a non-empty string');
    }
    if (typeof AgentClass !== 'function') {
      throw new ConfigurationError('AgentClass must be a constructor function');
    }
    if (!config || typeof config !== 'object') {
      throw new ConfigurationError('config must be an object');
    }

    this._agents.set(agentId, {
      agentId,
      AgentClass,
      config,
      tags: Array.isArray(config.tags) ? [...config.tags] : []
    });
  }

  /**
   * Remove a registered agent.
   *
   * @param {string} agentId
   * @returns {boolean} True if agent was found and removed
   */
  unregisterAgent(agentId) {
    return this._agents.delete(agentId);
  }

  /**
   * Get all registered agents.
   *
   * @returns {Array<{agentId: string, AgentClass: Function, config: Object, tags: string[]}>}
   */
  getRegisteredAgents() {
    return Array.from(this._agents.values());
  }

  // ═══════════════════════════════════════════════════════════
  // RUN METHODS
  // ═══════════════════════════════════════════════════════════

  /**
   * Run agents. If options.agentIds is provided, runs those agents.
   * If options.tag is provided, runs agents matching that tag.
   * Otherwise runs all registered agents.
   *
   * @param {Object} appConfig - Application configuration with appId
   * @param {Object} [options]
   * @param {string[]} [options.agentIds] - Specific agent IDs to run
   * @param {string} [options.tag] - Run agents with this tag
   * @param {string} [options.trigger='manual'] - What triggered this run
   * @returns {Promise<OrchestratorResult>}
   */
  async run(appConfig, options = {}) {
    if (options.agentIds) {
      return this.runAgents(appConfig, options.agentIds, options);
    }
    if (options.tag) {
      return this.runByTag(appConfig, options.tag, options);
    }
    return this.runAll(appConfig, options);
  }

  /**
   * Run every registered agent.
   *
   * @param {Object} appConfig
   * @param {Object} [options]
   * @param {string} [options.trigger='manual']
   * @returns {Promise<OrchestratorResult>}
   * @throws {ConfigurationError} If no agents are registered
   */
  async runAll(appConfig, options = {}) {
    const registrations = Array.from(this._agents.values());
    if (registrations.length === 0) {
      throw new ConfigurationError('No agents registered. Call registerAgent() first.');
    }
    return this._executeRun(appConfig, registrations, options);
  }

  /**
   * Run specific agents by ID.
   *
   * @param {Object} appConfig
   * @param {string[]} agentIds - IDs of agents to run
   * @param {Object} [options]
   * @param {string} [options.trigger='manual']
   * @returns {Promise<OrchestratorResult>}
   * @throws {ConfigurationError} If any agentId is not registered
   */
  async runAgents(appConfig, agentIds, options = {}) {
    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      throw new ConfigurationError('agentIds must be a non-empty array');
    }

    const registrations = [];
    for (const id of agentIds) {
      const registration = this._agents.get(id);
      if (!registration) {
        throw new ConfigurationError(`Agent '${id}' is not registered. Registered: [${Array.from(this._agents.keys()).join(', ')}]`);
      }
      registrations.push(registration);
    }

    return this._executeRun(appConfig, registrations, options);
  }

  /**
   * Run agents whose config includes a matching tag.
   *
   * @param {Object} appConfig
   * @param {string} tag - Tag to match
   * @param {Object} [options]
   * @param {string} [options.trigger='manual']
   * @returns {Promise<OrchestratorResult>}
   * @throws {ConfigurationError} If tag is not a string or no agents match
   */
  async runByTag(appConfig, tag, options = {}) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      throw new ConfigurationError('tag must be a non-empty string');
    }

    const registrations = Array.from(this._agents.values())
      .filter(reg => reg.tags.includes(tag));

    if (registrations.length === 0) {
      throw new ConfigurationError(
        `No agents match tag '${tag}'. Available tags: [${this._getAvailableTags().join(', ')}]`
      );
    }

    return this._executeRun(appConfig, registrations, options);
  }

  // ═══════════════════════════════════════════════════════════
  // CORE EXECUTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Core execution loop shared by all public run methods.
   *
   * Lifecycle:
   *   1. Generate runId, capture startedAt
   *   2. Create connector via factory
   *   3. Initialize connector
   *   4. For each selected agent (sequentially):
   *      a. Instantiate agent with (config, connector)
   *      b. agent.initialize()
   *      c. agent.runTests() → TestRunResult
   *      d. agent.cleanup()
   *      e. On any throw: catch, create error result, continue
   *   5. Cleanup connector (best-effort)
   *   6. Aggregate results into OrchestratorResult
   *   7. Call storage.store(), notifier.notify(), failureHandler.handle()
   *   8. Return OrchestratorResult
   *
   * @param {Object} appConfig
   * @param {AgentRegistration[]} registrations
   * @param {Object} options
   * @param {Object} options.page - Playwright page instance (required)
   * @param {Object} options.evidenceCollector - EvidenceCollector instance (required)
   * @param {string} [options.trigger='manual']
   * @returns {Promise<OrchestratorResult>}
   */
  async _executeRun(appConfig, registrations, options = {}) {
    const runId = this._generateRunId();
    const trigger = options.trigger || 'manual';
    const startedAt = new Date().toISOString();

    // Validate required execution environment
    const { page, evidenceCollector } = options;
    if (!page) {
      throw new ConfigurationError('options.page (Playwright page instance) is required');
    }
    if (!evidenceCollector) {
      throw new ConfigurationError('options.evidenceCollector is required');
    }

    let connector = null;
    let connectorError = null;
    const agentResults = [];

    // ── Step 1: Create connector (skipInitialize so orchestrator owns lifecycle) ──
    try {
      connector = await this._connectorFactory.create(
        appConfig, page, evidenceCollector, { skipInitialize: true }
      );
    } catch (error) {
      return this._createConnectorErrorResult(
        runId, appConfig, error, startedAt, trigger, 'create'
      );
    }

    // ── Step 2: Initialize connector (orchestrator-owned) ──
    try {
      await connector.initialize();
    } catch (error) {
      // Attempt cleanup even if initialize failed
      try { await connector.cleanup(); } catch (_) { /* best-effort */ }
      return this._createConnectorErrorResult(
        runId, appConfig, error, startedAt, trigger, 'initialize'
      );
    }

    // ── Step 2: Run each agent sequentially ──
    for (const registration of registrations) {
      const result = await this._runAgent(registration, connector);
      agentResults.push(result);
    }

    // ── Step 3: Cleanup connector (best-effort) ──
    try {
      await connector.cleanup();
    } catch (error) {
      // Log but don't fail the run — cleanup is best-effort
      connectorError = {
        ...this._serializeError(error),
        phase: 'cleanup'
      };
    }

    // ── Step 4: Aggregate results ──
    const completedAt = new Date().toISOString();
    const summary = this._aggregateSummary(agentResults);
    const overallStatus = this._determineStatus(summary, false); // cleanup errors don't affect status

    const result = {
      runId,
      appId: appConfig.appId || appConfig.id || 'unknown',
      agentResults,
      summary,
      overallStatus,
      durationMs: new Date(completedAt) - new Date(startedAt),
      startedAt,
      completedAt,
      trigger,
      connectorError: connectorError?.phase === 'cleanup' ? connectorError : null
    };

    // ── Step 5: Post-run hooks (all best-effort) ──
    await this._runPostHooks(result);

    return result;
  }

  /**
   * Run a single agent with full error isolation.
   *
   * @param {AgentRegistration} registration
   * @param {Object} connector
   * @returns {Promise<TestRunResult>}
   */
  async _runAgent(registration, connector) {
    const agentStartedAt = new Date().toISOString();

    try {
      // Instantiate
      const agent = new registration.AgentClass(registration.config, connector);

      // Initialize
      await agent.initialize();

      // Run tests
      const result = await agent.runTests();

      // Cleanup (best-effort — don't let cleanup failure override a good result)
      try {
        await agent.cleanup();
      } catch (_) {
        // Swallow cleanup errors — result is already captured
      }

      return result;
    } catch (error) {
      return this._createErrorResult(registration, error, agentStartedAt);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RESULT CONSTRUCTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a synthetic TestRunResult for an agent that crashed.
   */
  _createErrorResult(registration, error, startedAt) {
    const completedAt = new Date().toISOString();
    return {
      agentId: registration.agentId,
      scenarios: [],
      summary: { total: 0, passed: 0, failed: 0, errors: 1, skipped: 0 },
      durationMs: new Date(completedAt) - new Date(startedAt),
      startedAt,
      completedAt,
      error: this._serializeError(error)
    };
  }

  /**
   * Create an OrchestratorResult when the connector fails.
   */
  _createConnectorErrorResult(runId, appConfig, error, startedAt, trigger, phase) {
    const completedAt = new Date().toISOString();
    return {
      runId,
      appId: appConfig.appId || appConfig.id || 'unknown',
      agentResults: [],
      summary: {
        totalAgents: 0,
        passedAgents: 0,
        failedAgents: 0,
        errorAgents: 0,
        totalScenarios: 0,
        passedScenarios: 0,
        failedScenarios: 0,
        errorScenarios: 0,
        skippedScenarios: 0
      },
      overallStatus: 'error',
      durationMs: new Date(completedAt) - new Date(startedAt),
      startedAt,
      completedAt,
      trigger,
      connectorError: {
        ...this._serializeError(error),
        phase // 'create' or 'initialize'
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AGGREGATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Compute aggregate summary from array of TestRunResults.
   */
  _aggregateSummary(agentResults) {
    let totalScenarios = 0;
    let passedScenarios = 0;
    let failedScenarios = 0;
    let errorScenarios = 0;
    let skippedScenarios = 0;
    let passedAgents = 0;
    let failedAgents = 0;
    let errorAgents = 0;

    for (const result of agentResults) {
      const s = result.summary;

      // Agent-level classification
      if (result.error) {
        // Agent crashed
        errorAgents++;
      } else if (s.failed > 0) {
        failedAgents++;
      } else if (s.errors > 0) {
        errorAgents++;
      } else {
        passedAgents++;
      }

      // Scenario-level aggregation
      totalScenarios += s.total;
      passedScenarios += s.passed;
      failedScenarios += s.failed;
      errorScenarios += s.errors;
      skippedScenarios += s.skipped || 0;
    }

    return {
      totalAgents: agentResults.length,
      passedAgents,
      failedAgents,
      errorAgents,
      totalScenarios,
      passedScenarios,
      failedScenarios,
      errorScenarios,
      skippedScenarios
    };
  }

  /**
   * Determine overall run status.
   * Priority: error > failed > passed
   */
  _determineStatus(summary, hasConnectorError) {
    if (hasConnectorError) return 'error';
    if (summary.errorAgents > 0) return 'error';
    if (summary.failedAgents > 0) return 'failed';
    return 'passed';
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════

  /**
   * Extract serializable error info.
   */
  _serializeError(error) {
    return {
      message: error.message,
      name: error.name || 'Error',
      stack: error.stack || ''
    };
  }

  /**
   * Get all unique tags across registered agents.
   */
  _getAvailableTags() {
    const tags = new Set();
    for (const reg of this._agents.values()) {
      for (const tag of reg.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags);
  }

  /**
   * Run post-execution hooks. All are best-effort — failures logged, never thrown.
   */
  async _runPostHooks(result) {
    try {
      await this._storage.store(result);
    } catch (error) {
      // TODO Phase 2: Add structured logging. For now, swallow — hooks are best-effort.
    }

    try {
      await this._notifier.notify(result);
    } catch (error) {
      // TODO Phase 2: Add structured logging.
    }

    // Only invoke failureHandler if there were failures or errors
    if (result.overallStatus !== 'passed') {
      try {
        await this._failureHandler.handle(result);
      } catch (error) {
        // TODO Phase 2: Add structured logging.
      }
    }
  }
}

module.exports = TestOrchestrator;
```

---

## 5. Error Classes

The orchestrator uses `ConfigurationError` from the existing error hierarchy (`agents/errors.js`). No new error classes needed. The existing hierarchy:

```
AgentError (base)
  ├── ScenarioError
  ├── AssertionError   ← intentional spelling
  └── ConfigurationError  ← orchestrator uses this
```

The orchestrator throws `ConfigurationError` for:
- Invalid `registerAgent()` arguments
- Running with no agents registered
- Running with unregistered agent IDs
- Running by tag with no matches
- Invalid tag argument

All runtime errors (agent crashes, connector crashes) are **caught and recorded**, never thrown.

---

## 6. Test Specifications

### File: `tests/engine/test-orchestrator.test.js`

Estimated: **~93 tests** organized into 10 `describe` blocks.

---

### Block 1: Constructor (5 tests)

```
describe('TestOrchestrator - Constructor')
  ✓ creates with default options
  ✓ accepts custom connectorFactory
  ✓ accepts custom storage dependency
  ✓ accepts custom notifier dependency
  ✓ accepts custom failureHandler dependency
```

**What to verify:**
- Default dependencies are no-op objects
- Custom dependencies are stored
- `_agents` map starts empty

---

### Block 2: Agent Registration (12 tests)

```
describe('TestOrchestrator - Agent Registration')
  describe('registerAgent')
    ✓ registers an agent with valid arguments
    ✓ stores AgentClass, config, and tags
    ✓ extracts tags from config.tags array
    ✓ defaults tags to empty array when config has no tags
    ✓ allows overwriting an existing agent ID (re-registration)
    ✓ throws ConfigurationError for empty string agentId
    ✓ throws ConfigurationError for non-string agentId
    ✓ throws ConfigurationError for non-function AgentClass
    ✓ throws ConfigurationError for null config
    ✓ throws ConfigurationError for non-object config

  describe('unregisterAgent')
    ✓ removes a registered agent and returns true
    ✓ returns false for non-existent agent ID

  describe('getRegisteredAgents')
    ✓ returns empty array when none registered
    ✓ returns all registered agents
    ✓ preserves registration order
```

---

### Block 3: Run Method Routing (8 tests)

```
describe('TestOrchestrator - run() routing')
  ✓ delegates to runAll when no selection options provided
  ✓ delegates to runAgents when options.agentIds provided
  ✓ delegates to runByTag when options.tag provided
  ✓ passes trigger option through to result
  ✓ defaults trigger to 'manual'
```

---

### Block 4: runAll (10 tests)

```
describe('TestOrchestrator - runAll')
  ✓ runs all registered agents and returns OrchestratorResult
  ✓ throws ConfigurationError when no agents registered
  ✓ throws ConfigurationError when options.page is missing
  ✓ throws ConfigurationError when options.evidenceCollector is missing
  ✓ creates connector via factory with appConfig, page, evidenceCollector, { skipInitialize: true }
  ✓ initializes connector before running agents
  ✓ calls cleanup on connector after all agents finish
  ✓ passes same connector instance to all agents
  ✓ runs agents in registration order
  ✓ includes correct appId from appConfig
```

---

### Block 5: runAgents (7 tests)

```
describe('TestOrchestrator - runAgents')
  ✓ runs only specified agents
  ✓ preserves order of agentIds
  ✓ throws ConfigurationError for empty agentIds array
  ✓ throws ConfigurationError for non-array agentIds
  ✓ throws ConfigurationError when agent ID not registered
  ✓ error message includes list of registered agents
  ✓ only runs requested agents, skips others
```

---

### Block 6: runByTag (7 tests)

```
describe('TestOrchestrator - runByTag')
  ✓ runs agents matching the tag
  ✓ skips agents without the tag
  ✓ throws ConfigurationError for empty tag
  ✓ throws ConfigurationError for non-string tag
  ✓ throws ConfigurationError when no agents match tag
  ✓ error message includes available tags
  ✓ matches agents with multiple tags
```

---

### Block 7: Error Isolation — Agent Errors (12 tests)

```
describe('TestOrchestrator - Agent Error Isolation')
  ✓ continues to next agent when one crashes during initialize()
  ✓ continues to next agent when one crashes during runTests()
  ✓ continues to next agent when one crashes during cleanup()
  ✓ records error result for crashed agent
  ✓ error result has correct agentId
  ✓ error result has empty scenarios array
  ✓ error result summary has errors: 1
  ✓ error result includes serialized error with message, name, stack
  ✓ non-crashing agents still produce normal results
  ✓ overall status is 'error' when any agent crashes
  ✓ summary counts crashed agent as errorAgent
  ✓ still cleans up connector after agent crash
```

---

### Block 8: Error Isolation — Connector Errors (9 tests)

```
describe('TestOrchestrator - Connector Error Isolation')
  ✓ returns error result when ConnectorFactory.create() throws
  ✓ returns error result when connector.initialize() throws
  ✓ connector error result has empty agentResults
  ✓ connector error result has overallStatus 'error'
  ✓ connector error result includes connectorError with message and phase
  ✓ connector create error has phase 'create'
  ✓ connector initialize error has phase 'initialize'
  ✓ attempts connector cleanup even when initialize fails
  ✓ factory.create() called with appConfig, page, evidenceCollector, { skipInitialize: true }
```

---

### Block 9: Result Aggregation (15 tests)

```
describe('TestOrchestrator - Result Aggregation')
  describe('summary computation')
    ✓ counts all scenarios across agents
    ✓ sums passed scenarios
    ✓ sums failed scenarios
    ✓ sums error scenarios
    ✓ sums skipped scenarios
    ✓ classifies agent with all passed as passedAgent
    ✓ classifies agent with any failed as failedAgent
    ✓ classifies agent with errors (no crash) as errorAgent
    ✓ classifies crashed agent as errorAgent
    ✓ totalAgents equals number of agents run

  describe('overallStatus')
    ✓ returns 'passed' when all agents pass
    ✓ returns 'failed' when any agent has failed scenarios
    ✓ returns 'error' when any agent crashed
    ✓ 'error' takes priority over 'failed'
    ✓ 'failed' takes priority over 'passed'

  describe('OrchestratorResult shape')
    ✓ includes runId
    ✓ includes durationMs as positive number
    ✓ includes startedAt and completedAt as ISO strings
    ✓ includes trigger from options
    ✓ connectorError is null on success
```

---

### Block 10: Injectable Dependencies (8 tests)

```
describe('TestOrchestrator - Injectable Dependencies')
  describe('storage')
    ✓ calls storage.store() with OrchestratorResult after run
    ✓ does not fail run if storage.store() throws
    ✓ default storage is no-op (no throw)

  describe('notifier')
    ✓ calls notifier.notify() with OrchestratorResult after run
    ✓ does not fail run if notifier.notify() throws
    ✓ default notifier is no-op (no throw)

  describe('failureHandler')
    ✓ calls failureHandler.handle() when overallStatus is not 'passed'
    ✓ does not call failureHandler.handle() when overallStatus is 'passed'
    ✓ does not fail run if failureHandler.handle() throws
```

---

## 7. Mock Patterns

### Mock Agent Class

```javascript
/**
 * Creates a mock agent constructor that returns predictable results.
 * Used for most orchestrator tests since we're testing coordination, not agent logic.
 */
function createMockAgentClass(overrides = {}) {
  const defaults = {
    initializeFn: async () => {},
    runTestsFn: null,       // Will use default result if not provided
    cleanupFn: async () => {},
    agentId: 'mock-agent'
  };
  const opts = { ...defaults, ...overrides };

  return class MockAgent {
    constructor(config, connector) {
      this.config = config;
      this.connector = connector;
      this._initialized = false;
      this._cleanedUp = false;
    }

    async initialize() {
      this._initialized = true;
      return opts.initializeFn();
    }

    async runTests() {
      if (opts.runTestsFn) {
        return opts.runTestsFn();
      }
      return createMockTestRunResult(opts.agentId);
    }

    async cleanup() {
      this._cleanedUp = true;
      return opts.cleanupFn();
    }
  };
}
```

### Mock TestRunResult

```javascript
/**
 * Creates a standard passing TestRunResult.
 */
function createMockTestRunResult(agentId, overrides = {}) {
  return {
    agentId,
    scenarios: overrides.scenarios || [
      { id: 'scenario-1', name: 'Test Scenario', status: 'passed', steps: [], durationMs: 100 }
    ],
    summary: {
      total: 1, passed: 1, failed: 0, errors: 0, skipped: 0,
      ...overrides.summary
    },
    durationMs: overrides.durationMs || 100,
    startedAt: overrides.startedAt || new Date().toISOString(),
    completedAt: overrides.completedAt || new Date().toISOString(),
    ...overrides
  };
}

/**
 * Creates a TestRunResult with failures.
 */
function createFailedTestRunResult(agentId) {
  return createMockTestRunResult(agentId, {
    summary: { total: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }
  });
}
```

### Mock Connector Factory

```javascript
/**
 * Creates a mock ConnectorFactory with controllable behavior.
 * Matches real ConnectorFactory.create(app, page, evidenceCollector, options) signature.
 */
function createMockConnectorFactory(overrides = {}) {
  const mockConnector = {
    initialize: overrides.initializeFn || jest.fn().mockResolvedValue(undefined),
    cleanup: overrides.cleanupFn || jest.fn().mockResolvedValue(undefined),
    performAction: jest.fn().mockResolvedValue({}),
    ...overrides.extraMethods
  };

  return {
    create: overrides.createFn || jest.fn().mockResolvedValue(mockConnector),
    _mockConnector: mockConnector  // Exposed for assertion access
  };
}
```

### Mock Injectable Dependencies

```javascript
function createMockStorage() {
  return { store: jest.fn().mockResolvedValue(undefined) };
}

function createMockNotifier() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function createMockFailureHandler() {
  return { handle: jest.fn().mockResolvedValue(undefined) };
}
```

### Throwing Agent (for error isolation tests)

```javascript
/**
 * Creates an agent that throws at a specific lifecycle phase.
 */
function createThrowingAgentClass(phase, error = new Error('Agent crashed')) {
  return createMockAgentClass({
    initializeFn: phase === 'initialize' ? async () => { throw error; } : async () => {},
    runTestsFn: phase === 'runTests' ? async () => { throw error; } : null,
    cleanupFn: phase === 'cleanup' ? async () => { throw error; } : async () => {}
  });
}
```

### Standard Test Setup Helper

```javascript
/**
 * Sets up a standard orchestrator with mock factory and agents.
 * Used by most test blocks to reduce boilerplate.
 */
function createTestOrchestrator(overrides = {}) {
  const factory = createMockConnectorFactory(overrides.connector);
  const storage = createMockStorage();
  const notifier = createMockNotifier();
  const failureHandler = createMockFailureHandler();

  const orchestrator = new TestOrchestrator({
    connectorFactory: factory,
    storage,
    notifier,
    failureHandler,
    generateRunId: () => 'run-test-001',
    ...overrides.orchestratorOptions
  });

  return { orchestrator, factory, storage, notifier, failureHandler };
}

const TEST_APP_CONFIG = {
  appId: 'test-app',
  connector: { type: 'generic' },
  baseUrl: 'http://localhost:3000'
};

/**
 * Mock page and evidenceCollector for run options.
 * The real versions come from Playwright and EvidenceCollector —
 * these stubs satisfy the orchestrator's validation check.
 */
const TEST_RUN_OPTIONS = {
  page: { url: () => 'http://localhost:3000', close: jest.fn() },
  evidenceCollector: { capture: jest.fn(), store: jest.fn() }
};
```

---

## 8. Files to Create

| File | Purpose | Estimated LOC |
|------|---------|---------------|
| `core/engine/test-orchestrator.js` | Orchestrator implementation | ~280 |
| `tests/engine/test-orchestrator.test.js` | Test suite | ~700 |

**Total:** ~1000 LOC, ~93 tests

---

## 9. Claude Code Implementation Steps

### Step 1: Read Existing Code
```
Read these files to understand the patterns:
- agents/errors.js (ConfigurationError import path)
- connectors/factory.js (ConnectorFactory.create API — note: create(app, page, evidenceCollector, options))
- agents/base-agent.js (TestRunResult shape, agent lifecycle)
- agents/healer/agent.js (concrete agent pattern for mock reference)
- tests/agents/healer-agent.test.js (test structure, mock patterns)
```

### Step 2: Create Implementation
```
Create core/engine/test-orchestrator.js
- Copy the implementation from Section 4 of this spec
- Verify the import path for ConfigurationError matches the actual file
- Verify ConnectorFactory import path matches the actual file
```

### Step 3: Create Test File
```
Create tests/engine/test-orchestrator.test.js
- Implement all 10 describe blocks from Section 6
- Use mock patterns from Section 7
- Put mock helpers at top of file (createMockAgentClass, etc.)
- Import TestOrchestrator and ConfigurationError
```

### Step 4: Run Tests
```
npx jest tests/engine/test-orchestrator.test.js --verbose
- All ~90 tests should pass
- Fix any import path issues
```

### Step 5: Run Full Suite
```
npx jest --verbose
- Verify no regressions in existing tests
- All 764 existing tests should still pass
```

### Step 6: Verify Integration Compatibility
```
Verify that the orchestrator wires correctly with real classes (not just mocks):
- Create a quick integration test that:
  1. Creates orchestrator with the real ConnectorFactory
  2. Registers HealerAgent with a minimal config
  3. Calls run(appConfig, { page: mockPage, evidenceCollector: mockCollector })
  4. The factory will throw because mockPage isn't a real Playwright page
  5. Confirms the result is a connector error with phase 'create' — not an import error or wiring error
  6. This proves: import paths resolve, factory receives correct args, error isolation works
```

---

## 10. Validation Criteria

- [ ] `core/engine/test-orchestrator.js` exists and exports TestOrchestrator
- [ ] `tests/engine/test-orchestrator.test.js` exists with ~93 tests
- [ ] All tests pass: `npx jest tests/engine/test-orchestrator.test.js --verbose`
- [ ] No regressions: `npx jest --verbose` (all 764 prior tests still pass)
- [ ] Constructor accepts and stores injectable dependencies
- [ ] `registerAgent()` validates all arguments
- [ ] `runAll()` creates connector once, passes to all agents, cleans up
- [ ] `ConnectorFactory.create()` called with `(appConfig, page, evidenceCollector, { skipInitialize: true })`
- [ ] Throws `ConfigurationError` when `options.page` or `options.evidenceCollector` missing
- [ ] `runAgents()` throws on unknown IDs with helpful error message
- [ ] `runByTag()` filters correctly, throws on no matches
- [ ] Agent crash is caught, error result recorded, next agent runs
- [ ] Connector crash aborts run with connector error result
- [ ] Summary aggregation is accurate across multiple agents
- [ ] `overallStatus` follows priority: error > failed > passed
- [ ] Post-run hooks (storage, notifier, failureHandler) are called
- [ ] Post-run hook failures don't affect the returned result
- [ ] `failureHandler.handle()` only called when status is not 'passed'
