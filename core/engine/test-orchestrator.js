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

    // ── Step 3: Run each agent sequentially ──
    for (const registration of registrations) {
      const result = await this._runAgent(registration, connector);
      agentResults.push(result);
    }

    // ── Step 4: Cleanup connector (best-effort) ──
    try {
      await connector.cleanup();
    } catch (error) {
      // Log but don't fail the run — cleanup is best-effort
      connectorError = {
        ...this._serializeError(error),
        phase: 'cleanup'
      };
    }

    // ── Step 5: Aggregate results ──
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

    // ── Step 6: Post-run hooks (all best-effort) ──
    await this._runPostHooks(result, options);

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
      skippedScenarios += (s.skipped || 0) + (s.skipped_dependency || 0);
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
  async _runPostHooks(result, options = {}) {
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
    // and bug detection hasn't been disabled via --skip-bug-detection
    if (result.overallStatus !== 'passed' && !options.skipBugDetection) {
      try {
        await this._failureHandler.handle(result);
      } catch (error) {
        // TODO Phase 2: Add structured logging.
      }
    }
  }
}

module.exports = TestOrchestrator;
