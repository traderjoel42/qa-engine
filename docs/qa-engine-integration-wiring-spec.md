# QA Engine: Day 5 Implementation Spec — Engine Factory, Configuration & Minimal CLI

**Version:** 1.2 (post-feasibility review)  
**Date:** February 12, 2026  
**Depends on:** All Week 1–4 implementations (~1536 passing tests)  
**Target:** ~72 new tests → Running total ~1608 tests

---

## Overview

Day 5 is the **integration wiring layer** — the glue that assembles all standalone components into a runnable system. After this, `qa-engine test --app brainstormy --agent healer` actually works from the command line.

**Four deliverables:**
1. **Configuration loader** (`core/config.js`) — env-based config with dotenv
2. **Engine factory** (`core/engine/factory.js`) — wires all dependencies, returns a usable engine
3. **App config loader** (`core/app-loader.js`) — reads app definitions from `apps/` directory
4. **Minimal CLI** (`cli/index.js` + `cli/commands/`) — three commands: `test`, `status`, `bugs`

**Design principle:** The factory is the *only* place that knows about concrete classes. Everything else works through the abstract interfaces established in Weeks 1–4.

---

## Part 1: Design Decisions

### 1.1 Single Factory, Not a DI Container

**Decision:** A plain `createEngine(config)` function, not a dependency injection framework.

**Rationale:** The dependency graph is small and static — about 8 components wired together. A DI container (awilix, inversify) adds complexity without benefit at this scale. The factory function is ~60 lines, easy to read, easy to test. If the graph grows past 15+ components in Phase 3, revisit.

### 1.2 Graceful Degradation via Adapter Fallbacks

**Decision:** Missing API keys produce console-logging fallback adapters, not errors.

**Rationale:** The engine must always run. A developer cloning the repo with zero env vars should be able to run `qa-engine test` and see results — just without LLM analysis, WhatsApp notifications, or Linear issues. Each external service enhances but doesn't gate core functionality.

**Degradation matrix:**

| Missing Config | Fallback Behavior | What's Lost |
|---|---|---|
| `ANTHROPIC_API_KEY` | Rule-based bug classification (severity from error patterns) | LLM-powered root cause analysis, smart fix generation |
| `TWILIO_*` | `console.log` notifications | WhatsApp alerts |
| `LINEAR_*` | Skip external issue creation, log bug locally only | Linear issue tracking |
| All three missing | Fully functional test runner with local DB storage | All external integrations |

### 1.3 Config from Environment Only (No Config Files for Engine)

**Decision:** Engine configuration comes from environment variables (with dotenv). App definitions come from JSON files in `apps/`.

**Rationale:** Engine config is deployment-specific (API keys, paths, timeouts) — environment variables are the standard approach. App definitions are version-controlled project artifacts — JSON files in a known directory structure are appropriate. Mixing these two concerns into a single config file creates confusion about what's secret vs. what's shared.

### 1.4 Commander.js with Minimal Commands

**Decision:** Three commands only: `test`, `status`, `bugs`. No interactive prompts, no fancy output formatting (chalk/ora deferred).

**Rationale:** The CLI exists to make the engine runnable, not to be a polished product. Interactive prompts and colored output are Week 5+ polish. The three commands cover the core loop: run tests → check status → view bugs. Commands like `init` and `agent add` are deferred per the task scope.

### 1.5 App Config Lives in `apps/` Directory

**Decision:** Each app gets a directory under `apps/` with an `app.config.json` file. The loader scans this directory.

**Rationale:** Matches the existing spec's `apps/brainstormy/app.config.json` pattern. Directory-per-app allows co-locating agent configs, scenarios, and custom connector code alongside the app definition. The loader doesn't import code — it just reads JSON and passes it to the ConnectorFactory.

### 1.6 FailureHandler Bridge Pattern

**Decision:** The factory creates a thin `FailureHandler` object that wraps `BugDetector` and iterates over failed results from an `OrchestratorResult`, calling `bugDetector.detectAndReport()` for each.

**Rationale:** The TestOrchestrator expects a `failureHandler` with a `.handle(result)` method that receives an `OrchestratorResult` object. The `OrchestratorResult` contains `agentResults[]`, each with an `agentId` (string) and `results[]` array. The BugDetector expects individual failures via `.detectAndReport(app, agentId, failure)` where `agentId` is a string. The bridge adapts between these two interfaces without modifying either existing class.

### 1.7 Agent Registration at Run Time

**Decision:** Agent classes are registered with the TestOrchestrator inside `engine.run()`, just before calling `orchestrator.run()`. A default registry maps agent IDs to their classes (`healer` → `HealerAgent`, etc.). The registry is overridable via `createEngine({ agentRegistry })`.

**Rationale:** The TestOrchestrator requires agents to be registered via `registerAgent(agentId, AgentClass, config)` before `run()` will work. Registering at run time (not at factory creation time) means only the requested agents are loaded, and the registry can be swapped for testing without modifying global state. The default registry covers the three built-in agents; Phase 3 custom agents would extend this registry.

---

## Part 2: File Inventory

```
core/
  config.js                    # Environment-based configuration loader
  app-loader.js                # Reads app configs from apps/ directory
  engine/
    factory.js                 # createEngine(config) — wires everything together
    errors.js                  # (modified) Add ConfigError, AppLoaderError
cli/
  index.js                     # Commander.js entry point + bin setup
  commands/
    test.js                    # qa-engine test --app <id> --agent <agent>
    status.js                  # qa-engine status [--limit N]
    bugs.js                    # qa-engine bugs --app <id> [--status open]
apps/
  brainstormy/
    app.config.json            # Brainstormy app definition
tests/
  core/
    config.test.js             # ~12 tests
    app-loader.test.js         # ~10 tests
  engine/
    factory.test.js            # ~24 tests
  cli/
    test-command.test.js       # ~10 tests
    status-command.test.js     # ~8 tests
    bugs-command.test.js       # ~8 tests
```

---

## Part 3: Data Structures

### 3.1 Engine Configuration Object

```javascript
/**
 * Resolved configuration object returned by loadConfig().
 * All values have defaults — the engine runs with zero env vars.
 */
const config = {
  // Database
  db: {
    path: './data/qa-engine.db',    // QA_ENGINE_DB_PATH or default
    inMemory: false                  // true when path === ':memory:'
  },
  
  // Anthropic LLM
  anthropic: {
    apiKey: null,                    // ANTHROPIC_API_KEY or null
    model: 'claude-sonnet-4-5-20250929',  // QA_ENGINE_LLM_MODEL or default
    maxTokens: 4096                  // QA_ENGINE_LLM_MAX_TOKENS or default
  },
  
  // Twilio WhatsApp
  twilio: {
    accountSid: null,                // TWILIO_ACCOUNT_SID or null
    authToken: null,                 // TWILIO_AUTH_TOKEN or null
    fromNumber: null                 // TWILIO_FROM_NUMBER or null
  },
  
  // Linear issue tracking
  linear: {
    apiKey: null,                    // LINEAR_API_KEY or null
    teamId: null,                    // LINEAR_TEAM_ID or null
    projectId: null                  // LINEAR_PROJECT_ID or null
  },
  
  // Engine behavior
  engine: {
    approvalTimeoutMs: 3600000,      // QA_ENGINE_APPROVAL_TIMEOUT_MS or 1hr
    notificationRecipients: [],      // QA_ENGINE_NOTIFICATION_RECIPIENTS (comma-separated)
    appsDir: './apps'                // QA_ENGINE_APPS_DIR or default
  }
};
```

### 3.2 App Configuration (JSON)

```json
{
  "id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat-app",
  "baseUrl": "https://staging.brainstormy.app",
  
  "connector": {
    "type": "ai-chat-app",
    "config": {
      "auth": {
        "type": "email_password",
        "credentials": {
          "email": "testbot@brainstormy.app",
          "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
        }
      },
      "selectors": {
        "chatInput": "[data-testid='chat-input']",
        "chatSend": "[data-testid='send-button']",
        "aiMessage": "[data-testid='ai-message']",
        "loginEmail": "[name='email']",
        "loginPassword": "[name='password']",
        "loginSubmit": "[type='submit']"
      },
      "timeouts": {
        "aiResponse": 60000,
        "navigation": 30000
      }
    }
  },
  
  "agents": {
    "healer": { "enabled": true },
    "sentinel": { "enabled": true },
    "librarian": { "enabled": true }
  }
}
```

### 3.3 Engine Object (returned by `createEngine()`)

```javascript
/**
 * The engine object returned by createEngine(config).
 * This is what CLI commands and future interfaces consume.
 */
const engine = {
  /**
   * Run tests for an app.
   * @param {string} appId - App identifier (matches directory in apps/)
   * @param {object} options - { agents: ['healer'], mode: 'smoke' }
   * @returns {Promise<object>} Test run summary (OrchestratorResult)
   */
  async run(appId, options = {}) { /* ... */ },
  
  /**
   * Get recent test run summaries.
   * @param {object} options - { limit: 10, appId: null }
   * @returns {Array} Recent test runs with summary stats
   */
  async status(options = {}) { /* ... */ },
  
  /**
   * Get bugs for an app.
   * @param {string} appId - App identifier
   * @param {object} options - { status: 'open', limit: 20 }
   * @returns {Array} Bug records
   */
  async bugs(appId, options = {}) { /* ... */ },
  
  /**
   * Clean shutdown — flush state, close DB.
   */
  async shutdown() { /* ... */ }
};
```

---

## Part 4: Implementation

### 4.1 Configuration Loader — `core/config.js`

```javascript
'use strict';

const path = require('path');

/**
 * ConfigError for invalid or problematic configuration.
 */
class ConfigError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

/**
 * Load configuration from environment variables.
 * Call dotenv.config() before this if using .env files.
 * 
 * @param {object} env - Environment object (defaults to process.env)
 * @returns {object} Resolved configuration
 */
function loadConfig(env = process.env) {
  const dbPath = env.QA_ENGINE_DB_PATH || './data/qa-engine.db';
  
  const config = {
    db: {
      path: dbPath,
      inMemory: dbPath === ':memory:'
    },
    
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || null,
      model: env.QA_ENGINE_LLM_MODEL || 'claude-sonnet-4-5-20250929',
      maxTokens: parseInt(env.QA_ENGINE_LLM_MAX_TOKENS, 10) || 4096
    },
    
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || null,
      authToken: env.TWILIO_AUTH_TOKEN || null,
      fromNumber: env.TWILIO_FROM_NUMBER || null
    },
    
    linear: {
      apiKey: env.LINEAR_API_KEY || null,
      teamId: env.LINEAR_TEAM_ID || null,
      projectId: env.LINEAR_PROJECT_ID || null
    },
    
    engine: {
      approvalTimeoutMs: parseInt(env.QA_ENGINE_APPROVAL_TIMEOUT_MS, 10) || 3600000,
      notificationRecipients: env.QA_ENGINE_NOTIFICATION_RECIPIENTS
        ? env.QA_ENGINE_NOTIFICATION_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      appsDir: env.QA_ENGINE_APPS_DIR || './apps'
    }
  };
  
  return config;
}

/**
 * Validate configuration and return warnings about missing optional services.
 * Does NOT throw — all config is valid, some services just won't be available.
 * 
 * @param {object} config - Configuration from loadConfig()
 * @returns {object} { warnings: string[], services: { llm: bool, notifications: bool, bugTracker: bool } }
 */
function validateConfig(config) {
  const warnings = [];
  const services = {
    llm: false,
    notifications: false,
    bugTracker: false
  };
  
  // LLM
  if (config.anthropic.apiKey) {
    services.llm = true;
  } else {
    warnings.push('ANTHROPIC_API_KEY not set — using rule-based bug classification (no LLM analysis)');
  }
  
  // Notifications
  if (config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber) {
    services.notifications = true;
  } else {
    warnings.push('Twilio not fully configured — using console notifications');
  }
  
  // Bug tracker
  if (config.linear.apiKey && config.linear.teamId) {
    services.bugTracker = true;
  } else {
    warnings.push('Linear not fully configured — bugs stored locally only');
  }
  
  // Validate numeric ranges
  if (config.engine.approvalTimeoutMs < 60000) {
    warnings.push('Approval timeout under 60s — this may cause premature timeouts');
  }
  
  if (config.anthropic.maxTokens < 100 || config.anthropic.maxTokens > 200000) {
    warnings.push(`LLM max tokens (${config.anthropic.maxTokens}) outside typical range [100, 200000]`);
  }
  
  return { warnings, services };
}

module.exports = { loadConfig, validateConfig, ConfigError };
```

### 4.2 App Loader — `core/app-loader.js`

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

class AppLoaderError extends Error {
  constructor(message, appId = null) {
    super(message);
    this.name = 'AppLoaderError';
    this.appId = appId;
  }
}

/**
 * Load a single app configuration from its directory.
 * 
 * @param {string} appsDir - Base apps directory path
 * @param {string} appId - App identifier (directory name)
 * @returns {object} Parsed app configuration
 * @throws {AppLoaderError} If config file missing or invalid JSON
 */
function loadAppConfig(appsDir, appId) {
  const configPath = path.join(appsDir, appId, 'app.config.json');
  
  if (!fs.existsSync(configPath)) {
    throw new AppLoaderError(
      `App config not found: ${configPath}`,
      appId
    );
  }
  
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new AppLoaderError(
      `Failed to read app config: ${err.message}`,
      appId
    );
  }
  
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new AppLoaderError(
      `Invalid JSON in app config ${configPath}: ${err.message}`,
      appId
    );
  }
  
  // Validate required fields
  if (!config.id) {
    throw new AppLoaderError('App config missing required field: id', appId);
  }
  if (!config.name) {
    throw new AppLoaderError('App config missing required field: name', appId);
  }
  if (!config.type) {
    throw new AppLoaderError('App config missing required field: type', appId);
  }
  
  // Ensure id matches directory name
  if (config.id !== appId) {
    throw new AppLoaderError(
      `App config id "${config.id}" does not match directory name "${appId}"`,
      appId
    );
  }
  
  return config;
}

/**
 * List all available apps by scanning the apps directory.
 * 
 * @param {string} appsDir - Base apps directory path
 * @returns {string[]} Array of app IDs (directory names that contain app.config.json)
 */
function listApps(appsDir) {
  if (!fs.existsSync(appsDir)) {
    return [];
  }
  
  const entries = fs.readdirSync(appsDir, { withFileTypes: true });
  
  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => {
      const configPath = path.join(appsDir, entry.name, 'app.config.json');
      return fs.existsSync(configPath);
    })
    .map(entry => entry.name);
}

/**
 * Load all app configurations from the apps directory.
 * 
 * @param {string} appsDir - Base apps directory path
 * @returns {Map<string, object>} Map of appId → config
 */
function loadAllApps(appsDir) {
  const appIds = listApps(appsDir);
  const apps = new Map();
  
  for (const appId of appIds) {
    try {
      apps.set(appId, loadAppConfig(appsDir, appId));
    } catch (err) {
      // Log but don't fail — one bad config shouldn't prevent loading others
      console.warn(`Warning: Skipping app "${appId}": ${err.message}`);
    }
  }
  
  return apps;
}

module.exports = { loadAppConfig, listApps, loadAllApps, AppLoaderError };
```

### 4.3 Engine Factory — `core/engine/factory.js`

```javascript
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
 * and a results[] array. Failed results have status === 'failed' with error info.
 * 
 * This bridge iterates failed results and calls BugDetector.detectAndReport()
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
    
    // OrchestratorResult shape: { app, agentResults: [{ agentId, results: [...] }] }
    // Extract the app config and iterate each agent's failed results.
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
      console.warn(`⚠ ${warning}`);
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
```

### 4.4 Error Additions — `core/engine/errors.js`

Add to existing errors file:

```javascript
// Add to the existing errors.js exports

class AppLoaderError extends EngineError {
  constructor(message, appId = null) {
    super(message);
    this.name = 'AppLoaderError';
    this.appId = appId;
  }
}

// Add to module.exports: AppLoaderError
```

**Note:** `ConfigError` lives in `core/config.js` as a standalone class (extends `Error`, not `EngineError`). This keeps `config.js` dependency-free — it can be used by the CLI entry point without pulling in the engine error hierarchy. `AppLoaderError` is defined both standalone in `core/app-loader.js` and as an `EngineError` subclass here; the standalone version is used by the app-loader module, while the engine version is available for engine-level error handling if needed.

### 4.5 CLI Entry Point — `cli/index.js`

```javascript
#!/usr/bin/env node
'use strict';

// Load .env before anything else
try {
  require('dotenv').config();
} catch (err) {
  // dotenv is optional — env vars can come from the shell
}

const { Command } = require('commander');
const testCommand = require('./commands/test');
const statusCommand = require('./commands/status');
const bugsCommand = require('./commands/bugs');

const program = new Command();

program
  .name('qa-engine')
  .description('AI-powered QA automation engine')
  .version('0.1.0');

testCommand(program);
statusCommand(program);
bugsCommand(program);

program.parse(process.argv);
```

### 4.6 Test Command — `cli/commands/test.js`

```javascript
'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `test` command.
 * 
 * Usage:
 *   qa-engine test --app brainstormy --agent healer
 *   qa-engine test --app brainstormy                    # runs all enabled agents
 */
module.exports = function testCommand(program) {
  program
    .command('test')
    .description('Run tests for an application')
    .requiredOption('--app <appId>', 'Application ID to test')
    .option('--agent <agentId>', 'Specific agent to run (omit for all enabled agents)')
    .option('--mode <mode>', 'Test mode: smoke, regression, full', 'smoke')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine();
        
        const runOptions = { mode: options.mode };
        if (options.agent) {
          runOptions.agents = [options.agent];
        }
        
        console.log(`Running tests for "${options.app}"...`);
        if (options.agent) {
          console.log(`  Agent: ${options.agent}`);
        }
        console.log(`  Mode: ${options.mode}`);
        console.log('');
        
        const result = await engine.run(options.app, runOptions);
        
        // Print summary
        console.log('--- Test Run Complete ---');
        console.log(`  Run ID:  ${result.runId || 'N/A'}`);
        console.log(`  Status:  ${result.status || 'completed'}`);
        console.log(`  Total:   ${result.total || 0}`);
        console.log(`  Passed:  ${result.passed || 0}`);
        console.log(`  Failed:  ${result.failed || 0}`);
        console.log(`  Skipped: ${result.skipped || 0}`);
        
        if (result.bugs && result.bugs.length > 0) {
          console.log(`  Bugs:    ${result.bugs.length} created`);
        }
        
        // Exit with non-zero if failures
        const exitCode = (result.failed || 0) > 0 ? 1 : 0;
        await engine.shutdown();
        process.exit(exitCode);
        
      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
```

### 4.7 Status Command — `cli/commands/status.js`

```javascript
'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `status` command.
 * 
 * Usage:
 *   qa-engine status               # shows 10 most recent runs
 *   qa-engine status --limit 5     # shows 5 most recent runs
 */
module.exports = function statusCommand(program) {
  program
    .command('status')
    .description('Show recent test runs')
    .option('--limit <n>', 'Number of runs to show', '10')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine({ quiet: true });
        
        const limit = parseInt(options.limit, 10) || 10;
        const runs = await engine.status({ limit });
        
        if (runs.length === 0) {
          console.log('No test runs found.');
          await engine.shutdown();
          return;
        }
        
        console.log(`Recent test runs (last ${runs.length}):\n`);
        
        for (const run of runs) {
          const date = run.started_at
            ? new Date(run.started_at).toLocaleString()
            : 'unknown';
          const status = run.status || 'unknown';
          const app = run.app_id || 'unknown';
          
          console.log(`  [${date}] ${app} — ${status}`);
          
          if (run.summary) {
            const s = typeof run.summary === 'string' ? JSON.parse(run.summary) : run.summary;
            console.log(`    Passed: ${s.passed || 0}, Failed: ${s.failed || 0}, Total: ${s.total || 0}`);
          }
        }
        
        await engine.shutdown();
        
      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
```

### 4.8 Bugs Command — `cli/commands/bugs.js`

```javascript
'use strict';

const { createEngine } = require('../../core/engine/factory');

/**
 * Register the `bugs` command.
 * 
 * Usage:
 *   qa-engine bugs --app brainstormy                # all bugs
 *   qa-engine bugs --app brainstormy --status open  # only open bugs
 */
module.exports = function bugsCommand(program) {
  program
    .command('bugs')
    .description('List bugs for an application')
    .requiredOption('--app <appId>', 'Application ID')
    .option('--status <status>', 'Filter by status (open, fixed, closed)')
    .option('--limit <n>', 'Number of bugs to show', '20')
    .action(async (options) => {
      let engine;
      try {
        engine = await createEngine({ quiet: true });
        
        const limit = parseInt(options.limit, 10) || 20;
        const bugs = await engine.bugs(options.app, {
          status: options.status || undefined,
          limit
        });
        
        if (bugs.length === 0) {
          const qualifier = options.status ? ` with status "${options.status}"` : '';
          console.log(`No bugs found for "${options.app}"${qualifier}.`);
          await engine.shutdown();
          return;
        }
        
        console.log(`Bugs for "${options.app}" (${bugs.length}):\n`);
        
        for (const bug of bugs) {
          const date = bug.created_at
            ? new Date(bug.created_at).toLocaleString()
            : 'unknown';
          const severity = bug.severity || 'unknown';
          const status = bug.status || 'open';
          const title = bug.title || bug.bug_id || 'untitled';
          
          console.log(`  [${severity.toUpperCase()}] ${title}`);
          console.log(`    Status: ${status} | Created: ${date}`);
          
          if (bug.external_issue_url) {
            console.log(`    Linear: ${bug.external_issue_url}`);
          }
          console.log('');
        }
        
        await engine.shutdown();
        
      } catch (err) {
        console.error(`Error: ${err.message}`);
        if (engine) await engine.shutdown();
        process.exit(2);
      }
    });
};
```

### 4.9 Brainstormy App Config — `apps/brainstormy/app.config.json`

```json
{
  "id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat-app",
  "baseUrl": "https://staging.brainstormy.app",
  
  "connector": {
    "type": "ai-chat-app",
    "config": {
      "auth": {
        "type": "email_password",
        "credentials": {
          "email": "testbot@brainstormy.app",
          "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
        }
      },
      "selectors": {
        "chatInput": "[data-testid='chat-input']",
        "chatSend": "[data-testid='send-button']",
        "aiMessage": "[data-testid='ai-message']",
        "generatingIndicator": "[data-testid='generating']",
        "loginEmail": "[name='email']",
        "loginPassword": "[name='password']",
        "loginSubmit": "[type='submit']",
        "authIndicator": "[data-testid='user-menu']",
        "readyIndicator": "[data-testid='app-loaded']"
      },
      "timeouts": {
        "aiResponse": 60000,
        "bibleGeneration": 120000,
        "navigation": 30000
      }
    }
  },
  
  "agents": {
    "healer": { "enabled": true },
    "sentinel": { "enabled": true },
    "librarian": { "enabled": true }
  }
}
```

### 4.10 `package.json` Addition

Add to the project's `package.json`:

```json
{
  "bin": {
    "qa-engine": "./cli/index.js"
  },
  "scripts": {
    "qa": "node cli/index.js"
  }
}
```

**Note:** `commander` (v14.0.3) and `dotenv` (v17.2.4) are already installed — no new dependencies needed.

---

## Part 5: Test Specifications

### 5.1 Configuration Tests — `tests/core/config.test.js` (~12 tests)

```javascript
const { loadConfig, validateConfig } = require('../../core/config');

describe('loadConfig', () => {
  // Group 1: Default values (4 tests)
  test('returns default db path when QA_ENGINE_DB_PATH not set');
  test('returns default approval timeout of 3600000ms');
  test('returns empty notification recipients when not set');
  test('returns default LLM model and max tokens');
  
  // Group 2: Environment variable parsing (5 tests)
  test('reads ANTHROPIC_API_KEY from env');
  test('reads all Twilio vars from env');
  test('reads all Linear vars from env');
  test('parses comma-separated notification recipients');
  test('sets inMemory=true when db path is :memory:');
  
  // Group 3: Edge cases (3 tests)
  test('trims whitespace from notification recipients');
  test('filters empty strings from recipients');
  test('handles non-numeric approval timeout gracefully (falls back to default)');
});

describe('validateConfig', () => {
  // Group 4: Service detection (4 tests)
  test('reports llm=true when ANTHROPIC_API_KEY present');
  test('reports notifications=true when all Twilio vars present');
  test('reports bugTracker=true when LINEAR_API_KEY and LINEAR_TEAM_ID present');
  test('reports all services=false with empty config');
  
  // Group 5: Warnings (2 tests — counted in group total above)
  // (Warnings are tested as part of the service detection tests)
});
```

**Mock pattern:** Pass a custom `env` object to `loadConfig()` — no mocking of `process.env` needed.

```javascript
test('reads ANTHROPIC_API_KEY from env', () => {
  const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-test-123' });
  expect(config.anthropic.apiKey).toBe('sk-test-123');
});
```

### 5.2 App Loader Tests — `tests/core/app-loader.test.js` (~10 tests)

```javascript
const { loadAppConfig, listApps, loadAllApps, AppLoaderError } = require('../../core/app-loader');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('loadAppConfig', () => {
  // Group 1: Successful loading (2 tests)
  test('loads valid app config from directory');
  test('returns parsed JSON with all fields');
  
  // Group 2: Validation errors (4 tests)
  test('throws AppLoaderError when config file not found');
  test('throws AppLoaderError for invalid JSON');
  test('throws AppLoaderError when id field missing');
  test('throws AppLoaderError when id does not match directory name');
});

describe('listApps', () => {
  // Group 3: Directory scanning (2 tests)
  test('returns array of app IDs from directory');
  test('returns empty array when directory does not exist');
});

describe('loadAllApps', () => {
  // Group 4: Bulk loading (2 tests)
  test('loads all valid apps into a Map');
  test('skips invalid configs with warning (does not throw)');
});
```

**Mock pattern:** Create a temp directory with real files. The app loader uses synchronous `fs` calls, so temp dirs are the cleanest approach.

```javascript
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-apps-'));
  
  // Create a valid app
  const appDir = path.join(tmpDir, 'test-app');
  fs.mkdirSync(appDir);
  fs.writeFileSync(
    path.join(appDir, 'app.config.json'),
    JSON.stringify({ id: 'test-app', name: 'Test App', type: 'generic' })
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

### 5.3 Engine Factory Tests — `tests/engine/factory.test.js` (~24 tests)

```javascript
const { 
  createEngine, 
  ConsoleNotificationAdapter, 
  RuleBasedLLMAdapter, 
  NullBugTrackerAdapter,
  FailureHandler 
} = require('../../core/engine/factory');

describe('createEngine', () => {
  // Group 1: Basic creation (3 tests)
  test('creates engine with default config and in-memory DB');
  test('returns object with run, status, bugs, shutdown methods');
  test('exposes _internals for testing');
  
  // Group 2: Graceful degradation — adapter selection (4 tests)
  test('uses RuleBasedLLMAdapter when ANTHROPIC_API_KEY missing');
  test('uses AnthropicAdapter when ANTHROPIC_API_KEY present');
  test('uses ConsoleNotificationAdapter when Twilio not configured');
  test('uses NullBugTrackerAdapter when Linear not configured');
  
  // Group 3: Dependency injection overrides (3 tests)
  test('accepts override db');
  test('accepts override llm adapter');
  test('accepts override notifier adapter');
  
  // Group 4: Shutdown (2 tests)
  test('shutdown closes database and state manager');
  test('shutdown handles already-closed database gracefully');
  
  // Group 5: Agent registration (2 tests)
  test('engine.run() registers agents from default registry before orchestrator.run()');
  test('engine.run() uses overridden agentRegistry when provided');
});

describe('ConsoleNotificationAdapter', () => {
  // Group 5: Fallback adapter behavior (2 tests)
  test('send(recipient, message) returns success and tracks sent messages');
  test('send() logs recipient and message to console');
});

describe('RuleBasedLLMAdapter', () => {
  // Group 6: Rule-based classification (3 tests)
  test('complete() classifies crash-related text as critical severity');
  test('complete() classifies auth-related text as authentication category');
  test('complete() returns autoFixable=false for all classifications');
});

describe('NullBugTrackerAdapter', () => {
  // Group 7: Null adapter (1 test)
  test('createIssue returns null id and url');
});

describe('FailureHandler', () => {
  // Group 8: Bridge pattern (4 tests)
  test('iterates agentResults and calls bugDetector.detectAndReport for each failed result');
  test('passes agentId as string (not object) to detectAndReport');
  test('returns empty array when no agentResults have failures');
  test('continues processing after individual detectAndReport error');
});
```

**Mock pattern:** Use the override mechanism — no mocking of require/import needed.

```javascript
test('creates engine with default config and in-memory DB', async () => {
  const engine = await createEngine({
    config: {
      db: { path: ':memory:', inMemory: true },
      anthropic: { apiKey: null },
      twilio: { accountSid: null, authToken: null, fromNumber: null },
      linear: { apiKey: null, teamId: null, projectId: null },
      engine: { approvalTimeoutMs: 3600000, notificationRecipients: [], appsDir: './apps' }
    },
    quiet: true
  });
  
  expect(engine.run).toBeInstanceOf(Function);
  expect(engine.status).toBeInstanceOf(Function);
  expect(engine.bugs).toBeInstanceOf(Function);
  expect(engine.shutdown).toBeInstanceOf(Function);
  
  await engine.shutdown();
});

test('uses RuleBasedLLMAdapter when ANTHROPIC_API_KEY missing', async () => {
  const engine = await createEngine({
    config: {
      db: { path: ':memory:', inMemory: true },
      anthropic: { apiKey: null },
      twilio: { accountSid: null, authToken: null, fromNumber: null },
      linear: { apiKey: null, teamId: null, projectId: null },
      engine: { approvalTimeoutMs: 3600000, notificationRecipients: [], appsDir: './apps' }
    },
    quiet: true
  });
  
  expect(engine._internals.llm).toBeInstanceOf(RuleBasedLLMAdapter);
  await engine.shutdown();
});
```

### 5.4 CLI Command Tests — `tests/cli/*.test.js` (~26 tests)

CLI commands are tested by mocking `createEngine` and verifying the command logic (option parsing, output formatting, exit codes). We do NOT spawn child processes — we test the command handler functions directly.

**Pattern:** Extract the action handler and test it with mocked dependencies.

#### `tests/cli/test-command.test.js` (~10 tests)

```javascript
describe('test command', () => {
  // Group 1: Option parsing (3 tests)
  test('requires --app option');
  test('accepts --agent option for single agent');
  test('defaults mode to smoke');
  
  // Group 2: Engine interaction (4 tests)
  test('calls engine.run() with correct appId and options');
  test('passes agent filter when --agent specified');
  test('calls engine.shutdown() after successful run');
  test('calls engine.shutdown() after error');
  
  // Group 3: Output and exit codes (3 tests)
  test('prints test summary on success');
  test('exits with code 0 when no failures');
  test('exits with code 1 when failures exist');
});
```

#### `tests/cli/status-command.test.js` (~8 tests)

```javascript
describe('status command', () => {
  // Group 1: Basic behavior (3 tests)
  test('calls engine.status() with default limit 10');
  test('respects --limit option');
  test('prints "No test runs found" when empty');
  
  // Group 2: Output formatting (3 tests)
  test('prints run date, app, and status for each run');
  test('parses JSON summary if stored as string');
  test('handles runs without summary gracefully');
  
  // Group 3: Cleanup (2 tests)
  test('calls engine.shutdown() after displaying');
  test('calls engine.shutdown() on error');
});
```

#### `tests/cli/bugs-command.test.js` (~8 tests)

```javascript
describe('bugs command', () => {
  // Group 1: Option parsing (2 tests)
  test('requires --app option');
  test('passes --status filter when specified');
  
  // Group 2: Output formatting (3 tests)
  test('prints bug severity, title, status, and date');
  test('prints Linear URL when available');
  test('prints "No bugs found" when empty');
  
  // Group 3: Cleanup and errors (3 tests)
  test('calls engine.shutdown() after displaying');
  test('calls engine.shutdown() on error');
  test('includes status qualifier in empty message when filtered');
});
```

**CLI mock pattern:** Mock the engine factory at the module level.

```javascript
// Mock the factory before requiring the command
jest.mock('../../core/engine/factory', () => ({
  createEngine: jest.fn()
}));

const { createEngine } = require('../../core/engine/factory');

// Create a mock engine for each test
function createMockEngine(overrides = {}) {
  return {
    run: jest.fn().mockResolvedValue({
      runId: 'run-001',
      status: 'completed',
      total: 5,
      passed: 4,
      failed: 1,
      skipped: 0,
      agentResults: []
    }),
    status: jest.fn().mockResolvedValue([]),
    bugs: jest.fn().mockResolvedValue([]),
    shutdown: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

beforeEach(() => {
  // createEngine is async — mock returns a resolved promise
  const mockEngine = createMockEngine();
  createEngine.mockResolvedValue(mockEngine);
  
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(process, 'exit').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});
```

---

## Part 6: Test Count Summary

| Test File | Tests | Coverage Area |
|---|---|---|
| `tests/core/config.test.js` | 12 | Config loading, validation, defaults |
| `tests/core/app-loader.test.js` | 10 | App config loading, directory scanning |
| `tests/engine/factory.test.js` | 24 | Engine creation, adapter selection, fallbacks, failure handler, agent registration |
| `tests/cli/test-command.test.js` | 10 | CLI test command logic |
| `tests/cli/status-command.test.js` | 8 | CLI status command logic |
| `tests/cli/bugs-command.test.js` | 8 | CLI bugs command logic |
| **Total** | **72** | |

**Running total after Day 5: ~1608 tests** (1536 existing + 72 new)

---

## Part 7: File Checklist

### New Files

- [ ] `core/config.js` — Configuration loader
- [ ] `core/app-loader.js` — App configuration loader
- [ ] `core/engine/factory.js` — Engine factory with adapter wiring
- [ ] `cli/index.js` — CLI entry point
- [ ] `cli/commands/test.js` — Test command
- [ ] `cli/commands/status.js` — Status command
- [ ] `cli/commands/bugs.js` — Bugs command
- [ ] `apps/brainstormy/app.config.json` — Brainstormy app definition
- [ ] `tests/core/config.test.js` — Config tests
- [ ] `tests/core/app-loader.test.js` — App loader tests
- [ ] `tests/engine/factory.test.js` — Factory tests
- [ ] `tests/cli/test-command.test.js` — Test command tests
- [ ] `tests/cli/status-command.test.js` — Status command tests
- [ ] `tests/cli/bugs-command.test.js` — Bugs command tests
- [ ] `.env.example` — Documented environment variables

### Modified Files

- [ ] `core/engine/errors.js` — Add `AppLoaderError` (ConfigError stays in `core/config.js`)
- [ ] `package.json` — Add `bin` field, `scripts.qa` (commander and dotenv already installed)

### Files NOT Modified

All existing source files in `connectors/`, `agents/`, `core/engine/` (except errors.js), `core/database/`, `core/integrations/` remain untouched. All 1536 existing tests continue to pass.

### Directories to Create

- `tests/core/` — for config and app-loader tests
- `tests/cli/` — for CLI command tests
- `data/` — default database file location (created automatically by better-sqlite3 if needed)

---

## Part 8: `.env.example`

```bash
# QA Engine Configuration
# Copy to .env and fill in values

# Database (default: ./data/qa-engine.db, use :memory: for in-memory)
# QA_ENGINE_DB_PATH=./data/qa-engine.db

# Anthropic API (optional — enables LLM-powered bug analysis)
# ANTHROPIC_API_KEY=sk-ant-...

# Twilio WhatsApp (optional — enables WhatsApp notifications)
# TWILIO_ACCOUNT_SID=AC...
# TWILIO_AUTH_TOKEN=...
# TWILIO_FROM_NUMBER=whatsapp:+14155238886

# Linear (optional — enables issue tracking)
# LINEAR_API_KEY=lin_api_...
# LINEAR_TEAM_ID=...
# LINEAR_PROJECT_ID=...

# Engine Settings
# QA_ENGINE_APPROVAL_TIMEOUT_MS=3600000
# QA_ENGINE_NOTIFICATION_RECIPIENTS=whatsapp:+1234567890,whatsapp:+0987654321
# QA_ENGINE_APPS_DIR=./apps

# App-specific credentials
# BRAINSTORMY_TEST_PASSWORD=...
```

---

## Part 9: Validation Criteria

### Functional

- [ ] `await createEngine()` with no env vars returns a working engine (all fallback adapters)
- [ ] `await createEngine()` with ANTHROPIC_API_KEY uses AnthropicAdapter
- [ ] `await createEngine()` with Twilio vars uses TwilioWhatsAppAdapter
- [ ] `await createEngine()` with Linear vars uses LinearClient
- [ ] `engine.shutdown()` can be called multiple times without error
- [ ] `loadConfig({})` returns valid config with all defaults
- [ ] `loadAppConfig()` reads and validates app.config.json
- [ ] `listApps()` finds apps with valid config files
- [ ] CLI `test` command parses options and calls engine.run()
- [ ] CLI `status` command displays formatted test run history
- [ ] CLI `bugs` command displays filtered bug list
- [ ] FailureHandler iterates OrchestratorResult.agentResults and calls BugDetector per failed result
- [ ] FailureHandler passes agentId as string to detectAndReport()
- [ ] RuleBasedLLMAdapter.complete() classifies bugs by keyword patterns
- [ ] ConsoleNotificationAdapter.send(recipient, message) logs and tracks messages
- [ ] engine.run() registers agents via orchestrator.registerAgent() before orchestrator.run()
- [ ] engine.run() calls orchestrator.run() with agentIds (not agents)

### Non-functional

- [ ] All 1536 existing tests still pass
- [ ] 72 new tests pass
- [ ] No new files import from concrete adapter modules except `factory.js`
- [ ] CLI commands call `engine.shutdown()` in all code paths (success, error)
- [ ] `createEngine()` accepts dependency overrides for every component
- [ ] Factory is the only file that imports concrete adapters + core components together
- [ ] `config.js` has no dependencies on engine internals (standalone ConfigError extends Error)

---

## Part 10: Dependency Graph Summary

```
CLI Commands
  └── await createEngine() [factory.js]
        ├── loadConfig() [config.js]         → env vars
        ├── await createDatabase() [database/]  → SQLite
        ├── StateManager                     → db
        ├── AnthropicAdapter OR RuleBasedLLMAdapter
        ├── TwilioWhatsAppAdapter OR ConsoleNotificationAdapter
        ├── LinearClient OR NullBugTrackerAdapter
        ├── ApprovalManager                  → notifier, stateManager
        ├── BugDetector                      → llm, bugTracker, notifier, stateManager
        ├── AutoFixer                        → llm, stateManager, bugTracker, notifier
        ├── FailureHandler                   → bugDetector (bridge)
        ├── TestOrchestrator                 → ConnectorFactory (class ref), stateManager, notifier, failureHandler
        └── defaultAgentRegistry             → HealerAgent, SentinelAgent, LibrarianAgent

App Config Loading + Agent Registration (at engine.run() time):
  engine.run(appId)
    ├── loadAppConfig(appsDir, appId) [app-loader.js]
    │     └── reads apps/<appId>/app.config.json
    ├── orchestrator.registerAgent(agentId, AgentClass, config) for each requested agent
    └── orchestrator.run(appConfig, { agentIds })
```

The factory is the composition root. Everything above it (CLI) is a thin shell. Everything below it (adapters, engine components, database) knows nothing about the wiring.

---

## Appendix: Feasibility Review Changelog (v1.0 → v1.1)

All fixes below were applied based on Claude Code's feasibility evaluation against the actual codebase.

### Critical Fixes

| # | Issue | Fix Applied |
|---|---|---|
| 1 | `orchestrator.runTests()` doesn't exist | Changed to `orchestrator.run()` with `agentIds` param (not `agents`) |
| 2 | `db.testRuns.findAll()` doesn't exist | Changed to `db.testRuns.findMany({}, { orderBy, limit })` — separate `where` + `options` args |
| 3 | `createEngine()` sync but `createDatabase()` async | Made `createEngine()` async, added `await` at all call sites |
| 4 | Wrong ConnectorFactory path + instantiation | Fixed path to `../../connectors/factory`, pass class reference (not `new ConnectorFactory()`) |
| 5 | `RuleBasedLLMAdapter.analyze()` — BugDetector calls `complete()` | Renamed to `complete(prompt, options)` matching LLMAdapter base class |
| 6 | `ConsoleNotificationAdapter.send(recipients)` — base uses singular | Changed to `send(recipient, message)` matching NotificationAdapter base |
| 7 | FailureHandler assumed `result.failures` — actual is OrchestratorResult | Rewrote to iterate `result.agentResults[].scenarios[]` filtering by `status === 'failed'` |
| 8 | `detectAndReport()` 2nd arg is `agentId` string, not object | Changed to pass `agentId` string from `agentResult.agentId` |

### Moderate Fixes

| # | Issue | Fix Applied |
|---|---|---|
| 9 | ConfigError defined in both `config.js` and `errors.js` | Removed from `errors.js`; standalone in `config.js` (extends Error, no engine deps) |
| 12 | Orchestrator requires agent registration — factory never did it | Added `defaultAgentRegistry` mapping agent IDs → classes; `engine.run()` calls `orchestrator.registerAgent()` before `orchestrator.run()` |

### Minor Fixes

| # | Issue | Fix Applied |
|---|---|---|
| 13 | Missing `tests/core/`, `tests/cli/`, `data/` directories | Added "Directories to Create" section to file checklist |
| 14 | `commander`/`dotenv` already installed | Updated package.json section — no new deps needed, just `bin` and `scripts` |

### Items Confirmed OK (no changes needed)

| # | Item |
|---|---|
| 10 | LinearClient constructor — factory guards with `validation.services.bugTracker` |
| 11 | `apps/brainstormy/app.config.json` — correctly specified in new files list |
| 15 | `.env.example` — correctly specified in new files list |

---

## Appendix: Feasibility Review Changelog (v1.1 → v1.2)

All fixes below were applied based on Claude Code's second feasibility evaluation against the actual codebase.

### Critical Fixes

| # | Issue | Fix Applied |
|---|---|---|
| 1 | `registerAgent()` requires 3 args — spec passed only 2 | Added `appConfig.agents[agentId] || {}` as third argument; updated rationale and flow diagram |
| 2 | `RuleBasedLLMAdapter.complete()` return shape wrong — returned `{ response }` instead of `{ content }` | Changed to return `{ content: JSON.stringify({...}), usage: { inputTokens: 0, outputTokens: 0 }, model }` matching AnthropicAdapter |

### Moderate Fixes

| # | Issue | Fix Applied |
|---|---|---|
| 3 | Status command reads `run.created_at` but test_runs table has `started_at` | Changed to `run.started_at` |

### Notes Applied

| # | Issue | Fix Applied |
|---|---|---|
| 4 | FailureHandler iterates `agentResult.results` but _runAgent returns `scenarios` | Changed to `agentResult.scenarios`; updated v1.1 changelog entry #7 |
