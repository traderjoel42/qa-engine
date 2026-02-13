'use strict';

const { createDatabase } = require('../database');
const { loadConfig, validateConfig } = require('../config');
const { loadAppConfig, listApps } = require('../app-loader');

// Core engine components
const StateManager = require('./state-manager');
const TestOrchestrator = require('./test-orchestrator');
const BugDetector = require('./bug-detector');
const AutoFixer = require('./auto-fixer');
const ApprovalManager = require('./approval-manager');

// Agent classes (for registration with orchestrator)
const HealerAgent = require('../../agents/healer/agent');
const SentinelAgent = require('../../agents/sentinel/agent');
const LibrarianAgent = require('../../agents/librarian/agent');

/**
 * Default agent registry — maps agent IDs to their classes.
 * The factory uses this to register agents with the orchestrator
 * before running tests. Can be overridden via createEngine({ agentRegistry }).
 */
const defaultAgentRegistry = {
  healer: HealerAgent,
  sentinel: SentinelAgent,
  librarian: LibrarianAgent
};

// Concrete adapters
const { AnthropicAdapter } = require('../integrations/anthropic');
const { TwilioWhatsAppAdapter } = require('../integrations/twilio');
const LinearClient = require('../integrations/linear/client');

// Abstract adapters (for fallbacks)
const LLMAdapter = require('../integrations/adapters/llm');
const NotificationAdapter = require('../integrations/adapters/notification');
const BugTrackerAdapter = require('../integrations/adapters/bug-tracker');

// Connector factory
const ConnectorFactory = require('../../connectors/factory');

/**
 * Console notification adapter — fallback when Twilio isn't configured.
 * Logs notifications to stdout instead of sending WhatsApp messages.
 */
class ConsoleNotificationAdapter extends NotificationAdapter {
  constructor() {
    super();
    this.sent = []; // Track for testing
  }

  async send(recipient, message) {
    const timestamp = new Date().toISOString();
    console.log(`[NOTIFICATION ${timestamp}] To: ${recipient}`);
    console.log(`  ${message}`);
    this.sent.push({ recipient, message, timestamp });
    return { success: true, adapter: 'console' };
  }
}

/**
 * Rule-based LLM adapter — fallback when Anthropic isn't configured.
 * Uses pattern matching instead of LLM for bug classification.
 */
class RuleBasedLLMAdapter extends LLMAdapter {
  async complete(prompt, options = {}) {
    // Return a structured analysis based on keyword patterns
    const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    return {
      content: JSON.stringify({
        rootCause: 'Unable to determine — LLM not configured',
        severity: this._guessSeverity(text),
        category: this._guessCategory(text),
        autoFixable: false,
        suggestedFix: null,
        analysis: 'Rule-based classification (no LLM configured). Configure ANTHROPIC_API_KEY for AI-powered analysis.'
      }),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'rule-based'
    };
  }

  _guessSeverity(text) {
    const lower = text.toLowerCase();
    if (lower.includes('crash') || lower.includes('data loss') || lower.includes('security')) return 'critical';
    if (lower.includes('error') || lower.includes('fail') || lower.includes('broken')) return 'high';
    if (lower.includes('warning') || lower.includes('slow') || lower.includes('timeout')) return 'medium';
    return 'low';
  }

  _guessCategory(text) {
    const lower = text.toLowerCase();
    if (lower.includes('auth') || lower.includes('login') || lower.includes('password')) return 'authentication';
    if (lower.includes('memory') || lower.includes('recall') || lower.includes('context')) return 'memory';
    if (lower.includes('ui') || lower.includes('render') || lower.includes('display')) return 'ui';
    if (lower.includes('api') || lower.includes('network') || lower.includes('request')) return 'api';
    return 'unknown';
  }
}

/**
 * Null bug tracker adapter — fallback when Linear isn't configured.
 * Stores nothing externally, returns stub responses.
 */
class NullBugTrackerAdapter extends BugTrackerAdapter {
  async createIssue(bug) {
    return {
      id: null,
      url: null,
      adapter: 'null',
      note: 'No bug tracker configured. Set LINEAR_API_KEY to enable Linear integration.'
    };
  }

  async updateIssue(issueId, updates) {
    return { success: false, adapter: 'null' };
  }
}

/**
 * FailureHandler bridge — adapts BugDetector's per-failure API to the
 * TestOrchestrator's per-result API.
 *
 * The Orchestrator calls failureHandler.handle(result) where result is an
 * OrchestratorResult containing agentResults[]. Each agentResult has an agentId
 * and a scenarios[] array. Failed scenarios have status === 'failed' with error info.
 *
 * This bridge iterates failed scenarios and calls BugDetector.detectAndReport()
 * for each, passing the agentId as a string (not an object).
 */
class FailureHandler {
  constructor({ bugDetector }) {
    this.bugDetector = bugDetector;
  }

  async handle(result) {
    if (!result) {
      return [];
    }

    const bugs = [];

    // OrchestratorResult shape: { app, agentResults: [{ agentId, scenarios: [...] }] }
    // Extract the app config and iterate each agent's failed scenarios.
    const app = result.app || {};
    const agentResults = result.agentResults || [];

    for (const agentResult of agentResults) {
      const agentId = agentResult.agentId || 'unknown';
      const failures = (agentResult.scenarios || []).filter(
        r => r.status === 'failed'
      );

      for (const failure of failures) {
        try {
          const bug = await this.bugDetector.detectAndReport(
            app,
            agentId,   // string, not object
            failure
          );
          bugs.push(bug);
        } catch (err) {
          console.error(`FailureHandler: Error processing failure for agent "${agentId}": ${err.message}`);
          // Continue processing other failures
        }
      }
    }

    return bugs;
  }
}

/**
 * Create a fully wired QA Engine instance.
 *
 * @param {object} overrides - Override any config/dependency:
 *   @param {object} overrides.config - Pre-built config (skips loadConfig)
 *   @param {object} overrides.db - Pre-built database (skips createDatabase)
 *   @param {object} overrides.llm - LLM adapter override
 *   @param {object} overrides.notifier - Notification adapter override
 *   @param {object} overrides.bugTracker - Bug tracker adapter override
 *   @param {object} overrides.connectorFactory - Connector factory override
 *   @param {object} overrides.stateManager - State manager override
 *   @param {function} overrides.appLoader - App loader function override
 *   @param {object} overrides.agentRegistry - Map of agentId → AgentClass (overrides default registry)
 * @returns {Promise<object>} Engine object with run(), status(), bugs(), shutdown()
 */
async function createEngine(overrides = {}) {
  // 1. Configuration
  const config = overrides.config || loadConfig();
  const validation = validateConfig(config);

  // Log warnings (unless suppressed for tests)
  if (!overrides.quiet) {
    for (const warning of validation.warnings) {
      console.warn(`\u26A0 ${warning}`);
    }
  }

  // 2. Database
  const db = overrides.db || await createDatabase({
    dbPath: config.db.inMemory ? ':memory:' : config.db.path
  });

  // 3. State Manager
  const stateManager = overrides.stateManager || new StateManager({ db });

  // 4. Adapters (with graceful fallbacks)
  const llm = overrides.llm || (
    validation.services.llm
      ? new AnthropicAdapter({
          apiKey: config.anthropic.apiKey,
          defaultModel: config.anthropic.model,
          defaultMaxTokens: config.anthropic.maxTokens
        })
      : new RuleBasedLLMAdapter()
  );

  const notifier = overrides.notifier || (
    validation.services.notifications
      ? new TwilioWhatsAppAdapter({
          accountSid: config.twilio.accountSid,
          authToken: config.twilio.authToken,
          fromNumber: config.twilio.fromNumber
        })
      : new ConsoleNotificationAdapter()
  );

  const bugTracker = overrides.bugTracker || (
    validation.services.bugTracker
      ? new LinearClient({
          apiKey: config.linear.apiKey,
          teamId: config.linear.teamId,
          projectId: config.linear.projectId
        })
      : new NullBugTrackerAdapter()
  );

  // 5. Connector factory (pass the class itself — it uses static methods;
  //    TestOrchestrator stores it as this._connectorFactory = ConnectorFactory)
  const connectorFactory = overrides.connectorFactory || ConnectorFactory;

  // 6. Core engine components
  const approvalManager = new ApprovalManager({
    notifier,
    storage: stateManager,
    timeoutMs: config.engine.approvalTimeoutMs,
    recipients: config.engine.notificationRecipients
  });

  const bugDetector = new BugDetector({
    llm,
    bugTracker,
    notifier,
    storage: stateManager,
    approvalManager
  });

  const autoFixer = new AutoFixer({
    llm,
    storage: stateManager,
    bugTracker,
    notifier
  });

  // 7. App loader
  const appsDir = config.engine.appsDir;
  const appLoaderFn = overrides.appLoader || loadAppConfig;

  // 8. Failure handler bridge
  const failureHandler = new FailureHandler({
    bugDetector
  });

  // 9. Test orchestrator
  const orchestrator = new TestOrchestrator({
    connectorFactory,
    storage: stateManager,
    notifier,
    failureHandler
  });

  // 10. Build engine interface
  const engine = {
    async run(appId, options = {}) {
      const appConfig = appLoaderFn(appsDir, appId);

      // Filter agents if specified
      const agentIds = options.agents
        ? options.agents
        : Object.keys(appConfig.agents || {}).filter(
            a => appConfig.agents[a].enabled !== false
          );

      // Register agents with the orchestrator before running.
      // Agent classes are resolved by ID from the known agent registry.
      // Re-registering is idempotent — the orchestrator overwrites existing entries.
      const agentRegistry = overrides.agentRegistry || defaultAgentRegistry;
      for (const agentId of agentIds) {
        if (agentRegistry[agentId]) {
          orchestrator.registerAgent(agentId, agentRegistry[agentId], appConfig.agents[agentId] || {});
        }
      }

      const result = await orchestrator.run(appConfig, {
        ...options,
        agentIds
      });

      return result;
    },

    async status(options = {}) {
      const limit = options.limit || 10;
      const runs = db.testRuns.findMany(
        {},
        { orderBy: { started_at: 'DESC' }, limit }
      );
      return runs;
    },

    async bugs(appId, options = {}) {
      const where = { app_id: appId };
      if (options.status) {
        where.status = options.status;
      }
      const bugs = db.bugs.findMany(
        where,
        { orderBy: { created_at: 'DESC' }, limit: options.limit || 20 }
      );
      return bugs;
    },

    async shutdown() {
      try {
        await stateManager.shutdown();
      } catch (err) {
        console.error(`Shutdown warning: ${err.message}`);
      }
      try {
        db.close();
      } catch (err) {
        // Already closed or never opened — safe to ignore
      }
    },

    // Expose internals for testing/debugging
    _internals: {
      config,
      db,
      stateManager,
      llm,
      notifier,
      bugTracker,
      bugDetector,
      autoFixer,
      approvalManager,
      orchestrator,
      failureHandler
    }
  };

  return engine;
}

module.exports = {
  createEngine,
  // Export fallback classes for testing
  ConsoleNotificationAdapter,
  RuleBasedLLMAdapter,
  NullBugTrackerAdapter,
  FailureHandler
};
