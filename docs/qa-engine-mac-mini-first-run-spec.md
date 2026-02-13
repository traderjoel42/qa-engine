# QA Engine: Mac Mini Environment Setup & First-Run Validation

**Version:** 3.1  
**Date:** February 13, 2026  
**Phase:** 2, Task 1  
**Prerequisite:** Phase 1 complete — run `npm test` on Mac Mini to confirm actual passing count  
**Related:** qa-engine-01 through 05, brainstormy-connector-and-scheduling-spec  
**Revision History:**
- v1.0: Initial spec (written against design docs, not codebase)
- v2.0: Reconciled all naming/path/config mismatches with actual codebase (22 findings)
- v3.0: Addresses execution pipeline gaps found in v2.0 deep evaluation (12 findings) — CLI browser lifecycle, scenario loading, scenario format compatibility, auth credential nesting, and `.gitignore` gaps
- v3.1: Fixes 2 runtime failures and 2 code sample inaccuracies from v3.0 deep-trace evaluation (6 findings) — getBaseURL() override, assertion selector resolution, EvidenceCollector constructor signature, engine closure variable reference

---

## Goal

Get a single successful smoke test run against the real Brainstormy staging environment, running on the Mac Mini, with evidence captured and a WhatsApp notification delivered. This is the "it works for real" milestone — proving the system connects, authenticates, executes, stores results, and notifies.

**This spec covers exactly five things:**

1. Mac Mini environment setup (runtime, browsers, database, repo)
2. Environment variables and secrets configuration
3. Staging prerequisites validation (reachability, auth, test isolation)
4. First smoke test run with evidence collection
5. First WhatsApp notification delivery

**This spec does NOT cover:** scheduler activation, daily operations, metrics tracking, escalation procedures, monitoring, pre-deploy hooks, or any ongoing operational concerns.

---

## Design Decisions

### D1: Correct the Staging URL Everywhere

**Decision:** Use `https://brainstormy-frontend-staging.onrender.com` as the staging URL.

**Rationale:** The original QA Engine design specs reference `staging.brainstormy.app` and test account `testbot@brainstormy.app`. Neither exists. The actual staging frontend is deployed on Render at the URL above, and the QA test account is `qa-automation@brainstormy.co` using Clerk email/password auth. The `app.config.json` must reflect reality from day one.

**Impact:** Update the `baseUrl` and `environments.staging.baseUrl` fields in `apps/brainstormy/app.config.json`, plus auth credential references.

### D2: Cold-Start-Aware Timeouts

**Decision:** Increase the `navigation` timeout to 90 seconds in `app.config.json` and implement a `warmUp()` method in BrainstormyConnector that hits the staging URL before tests begin.

**Rationale:** Render free/starter tier services spin down after inactivity. The first page load can take 30–60 seconds while the service container restarts. The existing 30-second navigation timeout in `connector.config.timeouts.navigation` will fail on cold starts, creating false negatives that undermine trust in the system before it's even proven.

**Implementation:** Add a `warmUp()` method to BrainstormyConnector (or BaseConnector) that performs an HTTP GET against the app's `baseUrl` with a 120-second timeout, called from `initialize()` before any browser navigation. Also increase `connector.config.timeouts.navigation` from `30000` to `90000` in the app config.

**Impact:** Requires a code change to the connector (see Change A).

### D3: Minimal First Run — Healer Agent, Smoke Mode Only

**Decision:** The first-run validation uses only the Healer agent in `smoke` mode. No Sentinel, Librarian, or Quinn agents.

**Rationale:** The goal is to prove the plumbing works: connector authenticates, browser actions execute, evidence is captured, results are stored. The existing smoke test scenarios in `apps/brainstormy/scenarios/smoke-tests.json` are the right starting point. Running memory persistence tests (Sentinel) or edge cases (Quinn) introduces variables that could obscure infrastructure problems.

**Impact:** The CLI command for first run: `node cli/index.js test --app brainstormy --agent healer --mode smoke`. Uses the existing `--mode` flag.

**Note:** The `--mode` flag is passed through the CLI but `BaseAgent.getScenarios()` does not currently filter scenarios by mode — it returns all scenarios in the agent's config. Since all scenarios in the rewritten `smoke-tests.json` are smoke tests, this has no effect on the first run. Mode-based filtering can be added later if regression and full scenario sets are added to the same file.

### D4: Skip Bug Detection and Auto-Fix for First Run

**Decision:** Add a `--skip-bug-detection` flag to the CLI `test` command. When set, the orchestrator still collects evidence on failure but does not invoke the Bug Detector, create Linear issues, or trigger approval workflows.

**Rationale:** The first run will almost certainly encounter selector mismatches, timing issues, or unexpected UI states. These are setup calibration issues, not bugs. Routing them through bug detection would create noise in Linear and potentially trigger approval workflows before the system is proven.

**Impact:** Requires a code change (see Change B). The flag must thread through CLI → `engine.run()` → orchestrator → `_runPostHooks()` → FailureHandler.

### D5: WhatsApp Notification as Standalone Verification

**Decision:** Test WhatsApp notification delivery as a separate manual step using a standalone script, not as part of the smoke test flow and not via a CLI subcommand.

**Rationale:** The smoke test validates browser automation + evidence + storage. WhatsApp validates Twilio credentials + message delivery. Coupling them means a Twilio misconfiguration could block proving that browser automation works. The CLI currently has `test`, `status`, and `bugs` commands but no `notify` command — adding one is out of scope for this task.

**Impact:** Create `scripts/verify-whatsapp.js` using the correct env var names from `core/config.js`.

### D6: SQLite Database at Codebase-Standard Location

**Decision:** Use the database path defined in `core/config.js`: `./data/qa-engine.db` (configurable via `QA_ENGINE_DB_PATH` env var).

**Rationale:** The Phase 1 implementation chose `data/qa-engine.db` as the database location, not `database/qa.db` as the original design specs proposed. The migration system is built into the engine initialization via `createDatabase()` in `core/database/index.js` — there is no standalone migration script. The `data/` directory and database file are created automatically on first engine run.

**Impact:** All SQLite commands in this spec use `data/qa-engine.db`. No manual migration step needed.

### D7: App Config Loads from JSON Files, Not Database

**Decision:** Do not insert app records into the SQLite `apps` table manually. The system loads app configuration from `apps/brainstormy/app.config.json` at runtime via `loadAppConfig()`.

**Rationale:** The Phase 1 implementation uses JSON files as the source of truth for app configuration. The `apps` table in SQLite is populated or referenced by the engine at runtime, not pre-seeded.

**Impact:** No manual database initialization step. The database is created automatically on first engine run.

---

## Code Changes Required Before First Run

The v2.0 evaluation found that the execution pipeline (CLI → engine → orchestrator → agent → connector) has several gaps that must be closed before the smoke test command can reach the staging server. These are listed from most critical to least, with estimated effort revised based on the v2.0 deep-read evaluation.

**Total estimated code changes: ~160–230 lines across 6–8 files.**

### Change A: Warm-Up Method + getBaseURL() Override in Connector

**File to modify:** `connectors/brainstormy/connector.js`

**What:** Two additions to the BrainstormyConnector:

**Part 1 — `getBaseURL()` override (RUNTIME FAILURE FIX):**

The base class `BaseConnector.getBaseURL()` reads `this.app.environments?.[env]?.url`, but the config uses `baseUrl` not `url`. This means every relative-path navigation (e.g., `navigate("/")`, `navigate("/projects")`) will fail with `NavigationError: 'Base URL not configured'`. The connector's own `initialize()` bypasses this via `getEnvironment().baseUrl → page.goto()`, so auth works — but scenario actions that call `navigate()` with relative paths break.

```javascript
/**
 * Override base getBaseURL() which reads environments[env].url (wrong key).
 * Our config uses baseUrl at both top-level and environment level.
 */
getBaseURL() {
  const env = this.app.activeEnvironment ?? 'staging';
  return this.app.environments?.[env]?.baseUrl || this.app.baseUrl;
}
```

**Part 2 — `warmUp()` method:**

Performs an HTTP GET against the app's base URL to wake up Render services before browser automation begins. Called from `initialize()`.

```javascript
/**
 * Wake up the target service if it's been idle (Render cold start).
 * Performs a plain HTTP GET with generous timeout before browser nav.
 *
 * NOTE: The 'timeout' option on https.get() sets the socket inactivity timeout,
 * not a hard deadline. For Render cold starts where the TCP connection succeeds
 * but the HTTP response takes 30-60s, this works because the socket remains
 * active during the server startup. If the connection itself hangs (no TCP
 * handshake), we add an explicit setTimeout as a hard deadline.
 */
async warmUp() {
  const url = this.getBaseURL();
  const timeoutMs = this.getTimeout('warmUp') || 120000;

  console.log(`Warming up ${url} (timeout: ${timeoutMs / 1000}s)...`);
  const start = Date.now();

  try {
    const https = require('https');
    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

      const req = https.get(url, { timeout: timeoutMs }, (res) => {
        res.resume(); // Drain response
        clearTimeout(deadline);
        settle(resolve, res.statusCode);
      });
      req.on('timeout', () => { req.destroy(); clearTimeout(deadline); settle(reject, new Error('Warm-up timeout')); });
      req.on('error', (err) => { clearTimeout(deadline); settle(reject, err); });

      // Hard deadline fallback in case socket timeout doesn't fire
      const deadline = setTimeout(() => { req.destroy(); settle(reject, new Error('Warm-up hard deadline')); }, timeoutMs + 5000);
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Service ready (${elapsed}s)`);
  } catch (err) {
    console.warn(`  Warm-up warning: ${err.message} — proceeding anyway`);
  }
}
```

Then in `initialize()`, call `await this.warmUp()` before the first `page.goto()`.

**Estimated effort:** ~35 lines in one file.

### Change B: --skip-bug-detection CLI Flag

**Files to modify:** `cli/commands/test.js`, `core/engine/factory.js` (engine.run()), `core/engine/test-orchestrator.js` (_runPostHooks())

**What:** Add `--skip-bug-detection` option to the test command. The flag must flow through the full call chain:

1. `cli/commands/test.js` — accept the flag, include in options passed to `engine.run()`
2. `core/engine/factory.js` `engine.run()` — pass `skipBugDetection` through to orchestrator options
3. `core/engine/test-orchestrator.js` `_runPostHooks()` — check the flag before calling `this._failureHandler.handle(result)`

In `cli/commands/test.js`:
```javascript
.option('--skip-bug-detection', 'Disable bug detection and Linear integration')
```

In `_runPostHooks()` (or equivalent failure handling path):
```javascript
if (result.status === 'failed' && !this._options.skipBugDetection) {
  await this._failureHandler.handle(result);
}
```

**Estimated effort:** ~25 lines across 3 files.

### Change C: Browser Lifecycle in CLI Test Command (CRITICAL)

**Files to modify:** `core/engine/factory.js`, possibly `core/engine/test-orchestrator.js`

**What:** The `TestOrchestrator._executeRun()` requires `options.page` (a Playwright Page instance) and `options.evidenceCollector` (an EvidenceCollector instance). Currently, `cli/commands/test.js` passes only `{ mode, agents }` to `engine.run()`, and nobody in the call chain creates a browser, page, or evidence collector. The orchestrator will throw `ConfigurationError: 'options.page (Playwright page instance) is required'` immediately.

The `engine.run()` wrapper in `factory.js` must:

1. Launch a Playwright Chromium browser
2. Create a browser context and page
3. Create an EvidenceCollector instance (with correct constructor signature)
4. Pass both into the orchestrator options
5. Clean up the browser after the run completes (success or failure)

**Implementation approach — add to `engine.run()` in `factory.js`:**

Note: `engine.run()` is defined as a method on an object literal inside `createEngine()`. It uses closure variables (e.g., `orchestrator`, `appConfig`), not `this._orchestrator`. The code sample below matches the actual pattern.

```javascript
async run(appId, options = {}) {
  // ... existing setup (appConfig loaded, agents registered, etc.) ...

  // Create browser and evidence collector if not provided
  let browser = null;
  let manageBrowser = false;

  if (!options.page) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    options.page = await context.newPage();
    manageBrowser = true;
  }

  if (!options.evidenceCollector) {
    const EvidenceCollector = require('./engine/evidence-collector');
    // EvidenceCollector constructor requires { runId, appId, basePath }
    // NOT { page } — page is attached via initialize() separately
    const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const evidenceCollector = new EvidenceCollector({
      runId,
      appId,
      basePath: './evidence'
    });
    await evidenceCollector.initialize(options.page);
    options.evidenceCollector = evidenceCollector;
    options.runId = runId; // Pass to orchestrator so it uses this instead of generating its own
  }

  try {
    // Uses closure variable 'orchestrator', passes appConfig (not appId)
    const result = await orchestrator.run(appConfig, { ...options, agentIds });
    return result;
  } finally {
    if (manageBrowser && browser) {
      await browser.close();
    }
  }
}
```

The orchestrator's `_executeRun()` should also be checked — if it generates its own `runId`, it should prefer `options.runId` when provided to stay in sync with the EvidenceCollector's `runId`.

**Estimated effort:** ~45–55 lines in `core/engine/factory.js`, ~5 lines in `core/engine/test-orchestrator.js` (runId check).

### Change D: Scenario Loading into Agent Config (CRITICAL)

**Files to modify:** `apps/brainstormy/app.config.json`, `core/engine/factory.js` (agent registration)

**What:** When agents are registered in `factory.js:301-303`, the agent config comes from `appConfig.agents[agentId]`. Currently `app.config.json` has no `agents` key, so agents get `{}` (empty config), and `BaseAgent.getScenarios()` throws `ConfigurationError: No scenarios configured` because `this.config.scenarios` is undefined.

The scenarios exist in `apps/brainstormy/scenarios/smoke-tests.json` but nothing loads them into agent config. Two things must happen:

**Part 1 — Add `agents` block to `app.config.json`:**
```json
{
  "agents": {
    "healer": {
      "scenarioFiles": ["scenarios/smoke-tests.json"]
    }
  }
}
```

**Part 2 — Add scenario file loading to the engine:**

In `factory.js`, when registering agents, resolve `scenarioFiles` to actual scenario data:

```javascript
// In the agent registration loop
const agentConfig = appConfig.agents?.[agentId] || {};

// Load scenarios from referenced files
if (agentConfig.scenarioFiles && Array.isArray(agentConfig.scenarioFiles)) {
  const path = require('path');
  const fs = require('fs');
  agentConfig.scenarios = [];

  for (const scenarioFile of agentConfig.scenarioFiles) {
    const filePath = path.resolve(`apps/${appId}`, scenarioFile);
    if (fs.existsSync(filePath)) {
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Handle both single scenario and array of scenarios
      const scenarios = Array.isArray(loaded) ? loaded : (loaded.scenarios || [loaded]);
      agentConfig.scenarios.push(...scenarios);
    }
  }
}

orchestrator.registerAgent(agentId, agentRegistry[agentId], agentConfig);
```

**Estimated effort:** ~30–40 lines across 2 files (config + factory).

### Change E: Scenario Format Compatibility (CRITICAL)

**File to modify:** `apps/brainstormy/scenarios/smoke-tests.json`

**What:** The current `smoke-tests.json` mixes `action` and `assert` entries in a single `steps` array:
```json
{ "action": "navigate", "params": { "path": "/" } },
{ "assert": "selector_visible", "selector": "userMenu", "message": "..." }
```

But `BaseAgent.executeStep()` always calls `connector.performAction(step.action, ...)`. For `assert` entries, `step.action` is `undefined`, which calls `performAction(undefined, {})` and throws `"Action 'undefined' is not supported"`.

Additionally, `BaseAgent.runScenario()` evaluates assertions from `scenario.assertions || []` — a separate top-level array, not from inline `steps`. And the assertion types in the scenario (`selector_visible`, `element_count_gte`, `result_count_gte`) don't match what BaseAgent supports (`state_exists`, `state_equals`, `state_contains`, `state_truthy`, `url_contains`, `url_matches`, `element_exists`, `element_text_contains`, `response_contains`, `step_succeeded`).

**Resolution — rewrite `smoke-tests.json` to match the BaseAgent contract:**

The scenarios must use:
- `steps` array containing only action entries (no inline asserts)
- `assertions` array at the scenario level using supported assertion types

```json
[
  {
    "id": "smoke-01-login",
    "name": "Login and Dashboard Load",
    "description": "Verify Clerk authentication and dashboard render",
    "mode": "smoke",
    "steps": [
      {
        "action": "navigate",
        "params": { "path": "/" }
      }
    ],
    "assertions": [
      {
        "type": "element_exists",
        "selector": "userMenu",
        "message": "User menu should be visible after login"
      },
      {
        "type": "url_contains",
        "value": "/",
        "message": "Should be on the dashboard"
      }
    ]
  },
  {
    "id": "smoke-02-navigate-project",
    "name": "Navigate to Test Project",
    "description": "Verify project page loads and displays content",
    "mode": "smoke",
    "steps": [
      {
        "action": "navigate",
        "params": { "path": "/projects" }
      }
    ],
    "assertions": [
      {
        "type": "element_exists",
        "selector": "newProjectButton",
        "message": "New project button should be visible on projects page"
      }
    ]
  }
]
```

**Important note about authentication:** The connector's `initialize()` method performs Clerk authentication automatically before any agents run. By the time `smoke-01-login` executes, the user is already logged in. The scenario's purpose is to verify the authenticated state is correct (userMenu visible, correct URL), not to perform the login itself. The scenario name is kept as "Login and Dashboard Load" for clarity about what's being validated, but the login action is handled by the connector lifecycle.

**Estimated effort:** Rewrite the JSON file (~30 lines) PLUS add assertion selector resolution to BaseAgent (~6 lines, see below).

**Required: Assertion Selector Resolution in BaseAgent**

The `element_exists` assertion type in `BaseAgent.evaluateAssertion()` passes the raw selector key (e.g., `"userMenu"`) directly to `connector.exists()`, which calls `page.$("userMenu")`. Playwright interprets this as a CSS selector for `<userMenu>` elements — which don't exist. The assertion will always fail even when the element IS visible.

The connector has a `getSelector()` method that resolves key names to CSS selectors (e.g., `"userMenu"` → `"[data-testid='user-menu']"`), but `evaluateAssertion()` doesn't call it.

**File to modify:** `agents/base-agent.js`, in `evaluateAssertion()`:

```javascript
case 'element_exists': {
  const resolved = this.connector.getSelector?.(assertion.selector) || assertion.selector;
  const exists = await this.connector.exists(resolved);
  // ... rest of existing logic
}
```

Apply the same resolution pattern to any other assertion types that accept selectors (e.g., `element_text_contains` if it exists). This ensures the selector config system works end-to-end — scenario files reference logical names, the config maps them to CSS selectors, and assertions resolve them before querying the DOM.

### Change F: .gitignore Update

**File to modify:** `.gitignore`

**What:** The current `.gitignore` has `database/*.db` but the default database path is `data/qa-engine.db`. The `data/` directory is not gitignored, so the database could be accidentally committed.

**Add to `.gitignore`:**
```
# QA Engine database
data/*.db
data/*.db-journal
data/*.db-wal
```

**Estimated effort:** 3 lines.

---

## Implementation Steps

### Step 1: Verify Mac Mini System Prerequisites

**What:** Confirm Node.js, git, and SQLite are available. The Mac Mini already has Node.js v24 installed per SETUP-STATUS.md — no need to install or downgrade.

**Commands:**
```bash
# Verify Node.js (v18+ required, v24 already installed)
node --version  # Expected: v24.x.x

# Verify npm
npm --version

# Verify git
git --version

# Verify SQLite (ships with macOS)
sqlite3 --version
```

**Validation:** All four commands return version numbers. Node.js must be v18+.

**Notes:** Do NOT install Node.js 20 via nvm — the existing v24 installation is fine and newer. If for some reason Node.js is missing, install via `brew install node` or nvm, targeting v20+.

---

### Step 2: Verify Repository and Install Dependencies

**What:** The qa-engine repo is already cloned on the Mac Mini. Verify it's up to date, install/update dependencies, and install Playwright browsers.

**Commands:**
```bash
# Navigate to the repo
cd ~/qa-engine  # Adjust path if cloned elsewhere

# Pull latest
git pull

# Install/update Node.js dependencies
npm install

# Install Playwright browsers (Chromium is the primary target)
npx playwright install chromium

# Verify Playwright
npx playwright --version
```

**Validation:**
```bash
# Verify dependencies installed
ls node_modules/.package-lock.json  # Should exist

# Run the existing unit test suite to confirm the codebase is clean
npm test
# Record the actual passing count — the spec no longer assumes a specific number
```

**Notes:** If the test suite fails, STOP. Fix test failures before proceeding. Record the actual test count for the success criteria checklist.

---

### Step 3: Configure Environment Variables

**What:** Create `.env` file with all required secrets. Env var names match `core/config.js` and `.env.example` in the actual codebase.

**File:** `<repo>/.env`

```bash
# ==============================================
# QA Engine Environment Configuration
# Mac Mini - Brainstormy Staging
# ==============================================

# --- Brainstormy Staging Auth ---
# Clerk email/password credentials for the QA test account
BRAINSTORMY_TEST_PASSWORD=<password for qa-automation@brainstormy.co>

# --- WhatsApp / Twilio ---
# Used for sending test notifications and approval requests
# IMPORTANT: Var names must match core/config.js
QA_ENGINE_NOTIFICATION_RECIPIENTS=whatsapp:+<Joel's phone number>
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<Twilio auth token>
TWILIO_FROM_NUMBER=whatsapp:+<Twilio WhatsApp sender number>

# --- AI / LLM ---
# Used by Bug Detector and Auto-Fixer (not needed for first run,
# but configure now to avoid a second setup pass)
ANTHROPIC_API_KEY=<Anthropic API key>

# --- Bug Tracking ---
# Used by Bug Detector for creating Linear issues (not needed for first run)
LINEAR_API_KEY=<Linear API key>
```

**Validation:**
```bash
# Verify .env is loaded (from repo root)
node -e "require('dotenv').config(); \
  ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER', \
   'QA_ENGINE_NOTIFICATION_RECIPIENTS','BRAINSTORMY_TEST_PASSWORD', \
   'ANTHROPIC_API_KEY','LINEAR_API_KEY'].forEach(k => \
   console.log(k + ':', process.env[k] ? 'SET' : 'MISSING'))"

# All should print SET, not MISSING
```

**Security notes:**
- Verify `.env` is in `.gitignore`: `grep '\.env' .gitignore`
- Never commit credentials to the repository
- Cross-reference `.env.example` in the repo for any additional vars that may have been added during Phase 1

---

### Step 4: Update app.config.json for Real Staging

**What:** Update the Brainstormy app configuration to use the actual staging URL and test account. The config structure must match what `loadAppConfig()` (which requires `id`, not `app_id`) and the BrainstormyConnector expect.

**File:** `apps/brainstormy/app.config.json`

Update the following fields in the existing config structure (do not replace the entire file — preserve any keys not mentioned here):

```json
{
  "id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat-app",
  "baseUrl": "https://brainstormy-frontend-staging.onrender.com",

  "environments": {
    "staging": {
      "baseUrl": "https://brainstormy-frontend-staging.onrender.com"
    }
  },

  "connector": {
    "type": "brainstormy",
    "config": {
      "auth": {
        "type": "email_password",
        "required": true,
        "credentials": {
          "email": "qa-automation@brainstormy.co",
          "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
        }
      },
      "selectors": {
        "clerkEmailInput": "[name='emailAddress'], [name='email'], input[type='email']",
        "clerkPasswordInput": "[name='password'], input[type='password']",
        "clerkSubmitButton": "[type='submit'], button:has-text('Continue'), button:has-text('Sign in')",
        "userMenu": "[data-testid='user-menu']",
        "readyIndicator": "[data-testid='app-loaded']",
        "chatInput": "[data-testid='chat-input']",
        "sendButton": "[data-testid='send-button']",
        "aiMessage": "[data-testid='ai-message']",
        "generatingIndicator": "[data-testid='generating']",
        "newProjectButton": "[data-testid='new-project-button']",
        "newStoryButton": "[data-testid='new-story-button']",
        "newSessionButton": "[data-testid='new-session-button']"
      },
      "timeouts": {
        "navigation": 90000,
        "aiResponse": 90000,
        "bibleGeneration": 120000,
        "clerkAuth": 30000,
        "warmUp": 120000
      },
      "testProjectName": "[QA] Smoke Test Project"
    }
  },

  "agents": {
    "healer": {
      "scenarioFiles": ["scenarios/smoke-tests.json"]
    }
  }
}
```

**Key changes (aligned with codebase — addressing v2.0 eval findings):**
- `"id"` (not `"app_id"`) — `core/app-loader.js:53` requires `config.id`
- `"credentials": { "email": ..., "passwordEnv": ... }` nested under `auth` — `connectors/brainstormy/connector.js:108-111` reads `auth.credentials.email` and `auth.credentials.passwordEnv`
- `"clerkAuth": 30000` retained in timeouts — connector's `authenticate()` calls `this.getTimeout('clerkAuth')`
- `"base": "ai-chat-app"` removed from connector — ConnectorFactory only reads `connector.type`, `base` is ignored
- `"agents"` block added — required for scenario loading (see Change D); without this, agents get `{}` and throw `No scenarios configured`
- Fallback selectors for Clerk inputs (comma-separated) since actual Clerk UI may differ from assumed `data-testid` values
- `warmUp` timeout added, `navigation` increased from `30000` to `90000` for Render cold starts

**Validation:**
```bash
# Verify the config is valid JSON and key fields are correct
node -e "const c = require('./apps/brainstormy/app.config.json'); \
  console.log('App ID:', c.id); \
  console.log('URL:', c.baseUrl); \
  console.log('Auth email:', c.connector.config.auth.credentials.email); \
  console.log('Nav timeout:', c.connector.config.timeouts.navigation); \
  console.log('ClerkAuth timeout:', c.connector.config.timeouts.clerkAuth); \
  console.log('Healer scenarios:', c.agents?.healer?.scenarioFiles);"
# Expected:
#   App ID: brainstormy
#   URL: https://brainstormy-frontend-staging.onrender.com
#   Auth email: qa-automation@brainstormy.co
#   Nav timeout: 90000
#   ClerkAuth timeout: 30000
#   Healer scenarios: [ 'scenarios/smoke-tests.json' ]
```

---

### Step 4a: Update .gitignore (Change F)

**What:** Ensure the SQLite database at `data/qa-engine.db` won't be accidentally committed.

**Commands:**
```bash
# Check current .gitignore coverage
grep -E 'data/' .gitignore

# If data/*.db is not covered, add it:
echo -e "\n# QA Engine database\ndata/*.db\ndata/*.db-journal\ndata/*.db-wal" >> .gitignore

git add .gitignore
git commit -m "Add data/*.db to .gitignore for QA Engine database"
```

---

### Step 4b: Implement Code Changes A–E

**What:** Implement all code changes described in the "Code Changes Required" section. These should be done in order since they build on each other.

**Order of implementation:**

1. **Change F** (.gitignore) — already done in Step 4a
2. **Change A** (warmUp in connector) — standalone, no dependencies
3. **Change C** (browser lifecycle in engine.run) — **most critical**, unblocks the entire pipeline
4. **Change D** (scenario file loading in factory.js) — unblocks agent execution
5. **Change E** (rewrite smoke-tests.json) — unblocks scenario execution
6. **Change B** (--skip-bug-detection flag) — prevents noise from expected failures

**Validation after each change:**
```bash
# After each change, run the test suite
npm test
# Confirm no regressions
```

**Validation after all changes:**
```bash
# Verify warm-up method exists
node -e "const C = require('./connectors/brainstormy/connector'); \
  console.log('warmUp:', typeof C.prototype.warmUp === 'function' ? 'EXISTS' : 'MISSING'); \
  console.log('getBaseURL:', typeof C.prototype.getBaseURL === 'function' ? 'EXISTS' : 'MISSING')"

# Verify --skip-bug-detection flag is recognized
node cli/index.js test --help
# Should list --skip-bug-detection in the options

# Verify scenario loading works (dry run — will fail to connect but should get past config loading)
node -e "
  const config = require('./apps/brainstormy/app.config.json');
  const path = require('path');
  const fs = require('fs');
  const agentConfig = config.agents.healer;
  const scenarios = [];
  for (const f of agentConfig.scenarioFiles) {
    const filePath = path.resolve('apps/brainstormy', f);
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const s = Array.isArray(loaded) ? loaded : (loaded.scenarios || [loaded]);
    scenarios.push(...s);
  }
  console.log('Scenarios loaded:', scenarios.length);
  scenarios.forEach(s => console.log('  -', s.id, ':', s.name));
"
# Expected: lists smoke-01-login, smoke-02-navigate-project, etc.
```

**Commit all changes together:**
```bash
git add -A
git commit -m "Bridge CLI-to-staging pipeline: browser lifecycle, scenario loading, format compat, warm-up, skip-bug-detection"
git push
```

---

### Step 5: Validate Staging is Reachable

**What:** Confirm the staging environment is up and responding before attempting browser automation.

**Commands:**
```bash
# Simple HTTP check with generous timeout for cold start
curl -o /dev/null -s -w "HTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  --max-time 120 \
  https://brainstormy-frontend-staging.onrender.com

# Expected: HTTP Status: 200, Time: could be 30-60s on cold start
```

**If this fails:**
- Check that the Render service is not suspended (Render dashboard)
- Check that the URL is spelled correctly
- If the service returns 5xx, the staging backend may also need to wake up — Brainstormy's frontend makes API calls to a separate backend service on Render

**Programmatic validation script:**

**File:** `scripts/verify-staging.js`
```javascript
#!/usr/bin/env node

/**
 * Verify staging environment is reachable.
 * Handles Render cold-start with generous timeout.
 */

const https = require('https');
const config = require('../apps/brainstormy/app.config.json');

const url = config.baseUrl || config.environments?.staging?.baseUrl;
const timeout = config.connector?.config?.timeouts?.warmUp || 120000;

console.log(`Checking staging at: ${url}`);
console.log(`Timeout: ${timeout / 1000}s (cold start may take 30-60s)`);
console.log('Waiting...');

const startTime = Date.now();

const req = https.get(url, { timeout }, (res) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Staging is reachable`);
  console.log(`   Status: ${res.statusCode}`);
  console.log(`   Response time: ${elapsed}s`);

  if (res.statusCode !== 200) {
    console.log(`⚠️  Non-200 status — staging may be partially up`);
    process.exit(1);
  }

  process.exit(0);
});

req.on('timeout', () => {
  console.log(`❌ Staging did not respond within ${timeout / 1000}s`);
  console.log('   Check Render dashboard for service status');
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  console.log(`❌ Cannot reach staging: ${err.message}`);
  process.exit(1);
});
```

**Validation:**
```bash
node scripts/verify-staging.js
# Expected: ✅ Staging is reachable, Status: 200
```

---

### Step 6: Validate Test Account Authentication (Browser)

**What:** Use Playwright to verify that the QA test account can log in to staging through Clerk's authentication flow.

**File:** `scripts/verify-auth.js`

```javascript
#!/usr/bin/env node

/**
 * Verify QA test account can authenticate against staging.
 * Opens a real browser, navigates to staging, performs Clerk login.
 *
 * Reads config from the actual app.config.json structure:
 *   connector.config.selectors, connector.config.auth.credentials, etc.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const config = require('../apps/brainstormy/app.config.json');

const stagingUrl = config.baseUrl;
const connectorConfig = config.connector.config;
const email = connectorConfig.auth.credentials.email;
const password = process.env[connectorConfig.auth.credentials.passwordEnv];

if (!password) {
  console.error(`❌ ${connectorConfig.auth.credentials.passwordEnv} not set in .env`);
  process.exit(1);
}

// Helper: try multiple comma-separated selectors, return first match
async function findBySelectors(page, selectorString, opts = {}) {
  const selectors = selectorString.split(',').map(s => s.trim());
  for (const selector of selectors) {
    try {
      const el = await page.waitForSelector(selector, {
        timeout: opts.timeout || connectorConfig.timeouts.navigation,
        state: opts.state || 'visible'
      });
      if (el) return { element: el, selector };
    } catch {
      // Try next
    }
  }
  return { element: null, selector: null };
}

(async () => {
  console.log(`Authenticating ${email} at ${stagingUrl}`);
  console.log('Launching browser...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Ensure evidence directory exists
  const fs = require('fs');
  fs.mkdirSync('evidence', { recursive: true });

  try {
    // Step 1: Navigate (warm up)
    console.log('Navigating to staging (may take 30-60s for cold start)...');
    await page.goto(stagingUrl, {
      waitUntil: 'networkidle',
      timeout: connectorConfig.timeouts.warmUp || 120000
    });
    console.log('  Page loaded');
    await page.screenshot({ path: 'evidence/debug-01-initial-load.png' });

    // Step 2: Find email input
    console.log('Looking for login form...');
    let { element: emailInput, selector: emailSel } =
      await findBySelectors(page, connectorConfig.selectors.clerkEmailInput, { timeout: 15000 });

    if (!emailInput) {
      // Clerk might need us to click "Sign In" first
      console.log('  No email input visible — looking for Sign In button...');
      await page.screenshot({ path: 'evidence/debug-02-no-email-input.png' });

      const signInButton = await page.$('text=Sign in') ||
                           await page.$('text=Sign In') ||
                           await page.$('text=Log in') ||
                           await page.$('[data-testid="sign-in-button"]');

      if (signInButton) {
        console.log('  Clicking Sign In button...');
        await signInButton.click();
        await page.waitForTimeout(3000);
      }

      ({ element: emailInput, selector: emailSel } =
        await findBySelectors(page, connectorConfig.selectors.clerkEmailInput, { timeout: 15000 }));
    }

    if (!emailInput) {
      await page.screenshot({ path: 'evidence/debug-03-still-no-email-input.png' });
      throw new Error('Could not find email input. Check evidence/debug-*.png');
    }
    console.log(`  Found email input: ${emailSel}`);

    // Step 3: Enter email, click continue
    await emailInput.fill(email);

    const { element: submitBtn } =
      await findBySelectors(page, connectorConfig.selectors.clerkSubmitButton, { timeout: 5000 });

    if (submitBtn) {
      await submitBtn.click();
      console.log('  Clicked continue after email');
      await page.waitForTimeout(2000);
    }

    // Step 4: Enter password
    const { element: passwordInput, selector: pwSel } =
      await findBySelectors(page, connectorConfig.selectors.clerkPasswordInput, { timeout: 15000 });

    if (!passwordInput) {
      await page.screenshot({ path: 'evidence/debug-04-no-password-input.png' });
      throw new Error('Could not find password input. Check screenshots.');
    }
    console.log(`  Found password input: ${pwSel}`);

    await passwordInput.fill(password);

    // Click submit again for password
    const { element: submitBtn2 } =
      await findBySelectors(page, connectorConfig.selectors.clerkSubmitButton, { timeout: 5000 });

    if (submitBtn2) {
      await submitBtn2.click();
      console.log('  Submitted credentials');
    }

    // Step 5: Wait for authenticated state
    console.log('Waiting for authenticated state...');

    const { element: authIndicator } =
      await findBySelectors(page, connectorConfig.selectors.userMenu, { timeout: connectorConfig.timeouts.navigation });

    if (authIndicator) {
      console.log('  ✅ Auth indicator (userMenu) found — login successful');
    } else {
      const currentUrl = page.url();
      console.log(`  Current URL: ${currentUrl}`);
      if (!currentUrl.includes('sign-in') && !currentUrl.includes('login')) {
        console.log('  ✅ No longer on sign-in page — likely authenticated');
      } else {
        await page.screenshot({ path: 'evidence/debug-05-auth-failed.png' });
        throw new Error('Authentication appears to have failed. Check screenshots.');
      }
    }

    await page.screenshot({ path: 'evidence/debug-06-authenticated.png' });
    console.log('\n✅ Authentication verification PASSED');
    console.log(`   Account: ${email}`);
    console.log(`   URL after login: ${page.url()}`);

  } catch (err) {
    console.error(`\n❌ Authentication verification FAILED: ${err.message}`);
    console.error('   Check evidence/debug-*.png for screenshots at each stage');
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
```

**Validation:**
```bash
node scripts/verify-auth.js
# Expected: ✅ Authentication verification PASSED
# Debug screenshots saved to evidence/debug-*.png regardless of outcome
```

**If this fails:** The debug screenshots at each stage show exactly where the flow broke down. Common issues:
- Clerk UI uses different selectors → update `connector.config.selectors` in `app.config.json`
- Test account doesn't exist in staging Clerk → create it in the Clerk dashboard
- Password is wrong → verify in `.env`
- Clerk uses a different auth flow (e.g., magic link only) → enable password auth for the test account

---

### Step 7: Verify Test Project Isolation

**What:** Confirm the QA test account has (or can create) a dedicated test project that won't interfere with real data.

**Manual prerequisite (one-time, before first run):**

1. Log in to `https://brainstormy-frontend-staging.onrender.com` as `qa-automation@brainstormy.co`
2. Create a project named `[QA] Smoke Test Project` (matching `connector.config.testProjectName` in the app config)
3. Note the project ID from the URL (e.g., `/projects/abc-123-def`) for debugging reference

**Rationale for manual setup:** Auto-creating projects during testing is what the smoke test itself will validate. We need a known-good project to exist first so the initial smoke tests can navigate to it. Chicken-and-egg: use manual setup for the bootstrap, then let automation handle creation in subsequent tests.

**Validation:**
```bash
# Verify the testProjectName is configured
node -e "const c = require('./apps/brainstormy/app.config.json'); \
  console.log('Test project name:', c.connector.config.testProjectName || 'NOT SET')"
# Expected: [QA] Smoke Test Project
```

---

### Step 8: First Smoke Test Run

**What:** Execute the Healer agent's smoke tests through the CLI against real staging. This is the milestone — the first real test run.

**How the execution pipeline works (for debugging context):**

1. `cli/commands/test.js` parses flags, calls `engine.run('brainstormy', options)`
2. `engine.run()` **(Change C)** launches Playwright browser, creates page + EvidenceCollector
3. `engine.run()` calls `loadAppConfig('brainstormy')` which reads `app.config.json` (requires `id` field)
4. `engine.run()` registers agents with scenario data **(Change D)** loaded from `scenarioFiles`
5. Orchestrator calls `connector.initialize()` which calls `warmUp()` **(Change A)** then performs Clerk auth automatically
6. Healer agent runs scenarios from `smoke-tests.json` **(Change E)** — actions use `navigate()` which calls `getBaseURL()` **(Change A override)** to resolve the staging URL, then assertions resolve selector keys via `connector.getSelector()` **(Change E)**
7. If a test fails and `--skip-bug-detection` **(Change B)** is set, FailureHandler is skipped
8. `engine.run()` closes the browser in a `finally` block

**Important note about authentication:** The connector's `initialize()` handles Clerk login before any agent scenarios execute. The `smoke-01-login` scenario verifies the post-auth state (userMenu visible) — it does not perform the login itself. If authentication fails, it will fail at the connector level with a clear error, not inside a scenario step.

**Run command:**
```bash
# Run smoke tests with bug detection disabled
node cli/index.js test --app brainstormy --agent healer --mode smoke --skip-bug-detection
```

**What success looks like:**
```
QA Engine v1.0.0
═══════════════════════════════════════════
Running: Healer Agent (smoke mode)
Target:  https://brainstormy-frontend-staging.onrender.com
═══════════════════════════════════════════

Warming up service...                        ✅ (34.2s)
Authenticating (Clerk)...                    ✅ (3.1s)
[smoke-01-login] Verifying auth state...     ✅ (0.8s)
[smoke-02-navigate-project] Navigating...    ✅ (2.1s)

═══════════════════════════════════════════
RESULT: PASSED
═══════════════════════════════════════════
Test Run ID:  <uuid>
Evidence:     evidence/brainstormy/<run-id>/
```

**Validation checklist after the run:**
```bash
# 1. Verify test run was recorded in SQLite
sqlite3 data/qa-engine.db "SELECT id, status, summary FROM test_runs ORDER BY started_at DESC LIMIT 1"
# Expected: shows the run with status 'completed' and summary JSON

# 2. Verify test results were recorded
sqlite3 data/qa-engine.db "SELECT test_name, status, duration_ms FROM test_results ORDER BY executed_at DESC LIMIT 5"
# Expected: smoke-01-login | passed, smoke-02-navigate-project | passed, etc.

# 3. Verify evidence was stored on disk
ls evidence/brainstormy/
# Expected: directory named with the test run ID

find evidence/brainstormy/ -name "*.png" | head -5
# Expected: screenshot files

# 4. Verify evidence metadata was recorded in SQLite
sqlite3 data/qa-engine.db "SELECT file_type, file_path FROM evidence_metadata ORDER BY created_at DESC LIMIT 5"
# Expected: screenshot, log, and network entries with valid file paths

# 5. Verify all expected tables exist
sqlite3 data/qa-engine.db ".tables"
# Expected includes: apps, test_runs, test_results, bugs, approvals, evidence_metadata, fixes, scheduled_runs, schema_migrations
```

---

### Step 9: First WhatsApp Notification

**What:** Send a test notification via Twilio to verify WhatsApp delivery works. This is a standalone script using the correct env var names from `core/config.js`.

**File:** `scripts/verify-whatsapp.js`

```javascript
#!/usr/bin/env node

/**
 * Send a test WhatsApp notification to verify Twilio configuration.
 * Standalone — does not depend on test run infrastructure.
 *
 * Uses env var names matching core/config.js:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *   QA_ENGINE_NOTIFICATION_RECIPIENTS
 */

require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM_NUMBER;
const recipients = process.env.QA_ENGINE_NOTIFICATION_RECIPIENTS;

// Validate all required vars
const missing = [];
if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
if (!from) missing.push('TWILIO_FROM_NUMBER');
if (!recipients) missing.push('QA_ENGINE_NOTIFICATION_RECIPIENTS');

if (missing.length > 0) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
  console.error('   Check .env file — var names must match core/config.js');
  process.exit(1);
}

// QA_ENGINE_NOTIFICATION_RECIPIENTS is comma-separated; use the first one
const to = recipients.split(',')[0].trim();

console.log(`Sending test notification...`);
console.log(`  From: ${from}`);
console.log(`  To:   ${to}`);

const client = twilio(accountSid, authToken);

client.messages
  .create({
    body: [
      '🧪 *QA Engine — Connection Test*',
      '',
      'If you can read this, WhatsApp notifications are working.',
      '',
      `Sent: ${new Date().toISOString()}`,
      `Host: Mac Mini`,
      `Target: Brainstormy Staging`
    ].join('\n'),
    from: from,
    to: to
  })
  .then((message) => {
    console.log(`\n✅ Message sent successfully`);
    console.log(`   SID: ${message.sid}`);
    console.log(`   Status: ${message.status}`);
    console.log('\n📱 Check your phone for the WhatsApp message.');
  })
  .catch((err) => {
    console.error(`\n❌ Failed to send message: ${err.message}`);

    if (err.code === 20003) {
      console.error('   Auth failed — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    } else if (err.code === 21608) {
      console.error('   Unverified recipient — send "join <sandbox-keyword>" from WhatsApp to Twilio number first');
    } else if (err.code === 21211) {
      console.error('   Invalid "to" number — check QA_ENGINE_NOTIFICATION_RECIPIENTS format');
      console.error('   Should be: whatsapp:+1234567890');
    }

    process.exit(1);
  });
```

**Validation:**
```bash
node scripts/verify-whatsapp.js
# Expected: ✅ Message sent successfully
# Then check phone: WhatsApp message should arrive within seconds
```

**Common issues:**
- Error 21608 (unverified): For Twilio sandbox, send "join \<keyword\>" from WhatsApp to the Twilio number first. One-time setup.
- Error 20003 (auth): Double-check SID and auth token in `.env`
- Message sent but not received: Check Twilio console for delivery status

---

## Post-Validation: Selector Calibration

The first run will very likely require selector adjustments. Clerk's login form and Brainstormy's UI may use different attributes than what's in the config. This is expected and not a failure — it's calibration.

**Process when a step fails due to selectors:**

1. Check the debug screenshots in `evidence/` — they show what the page looked like at failure
2. Open the staging URL in a regular browser, inspect the element
3. Update the selector in `connector.config.selectors` in `app.config.json`
4. Re-run `scripts/verify-auth.js` or the smoke test
5. Repeat until all steps pass

**Once the smoke test passes cleanly, commit the calibrated config:**
```bash
git add apps/brainstormy/app.config.json
git commit -m "Calibrate selectors and config for real staging environment"
git push
```

---

## Link to npm for Global CLI (Optional)

The `package.json` has a `bin` entry mapping `qa-engine` → `./cli/index.js`. To use the short-form `qa-engine test` instead of `node cli/index.js test`:

```bash
npm link
qa-engine --version  # Should work now
```

This is optional — all commands in this spec use the explicit `node cli/index.js` form to avoid assumptions.

---

## Success Criteria Checklist

All items must be checked before this task is complete:

### Environment Setup
- [ ] Node.js v18+ verified on Mac Mini (v24 already installed)
- [ ] Repository up to date (`git pull`) and npm dependencies installed
- [ ] Playwright Chromium browser installed
- [ ] Existing unit tests pass (record actual count: ______)
- [ ] `.env` file created with all required variables (correct names per `core/config.js`)
- [ ] `.env` is in `.gitignore`

### Code Changes (~160–230 lines across 6–8 files)
- [ ] Change A: `getBaseURL()` override added to BrainstormyConnector (resolves `baseUrl` key mismatch)
- [ ] Change A: `warmUp()` method added to connector with hard deadline fallback + proper `clearTimeout`, called from `initialize()`
- [ ] Change B: `--skip-bug-detection` flag threaded through CLI → `engine.run()` → orchestrator `_runPostHooks()` → FailureHandler
- [ ] Change C: Browser lifecycle (launch, page, EvidenceCollector, teardown) added to `engine.run()` in `factory.js` — uses correct `EvidenceCollector({ runId, appId, basePath })` constructor + `initialize(page)`, and closure variable `orchestrator` (not `this._orchestrator`)
- [ ] Change D: Scenario file loading added to agent registration in `factory.js`; `agents` block added to `app.config.json`
- [ ] Change E: `smoke-tests.json` rewritten with separate `steps` (actions only) and `assertions` arrays using supported assertion types
- [ ] Change E: Assertion selector resolution added to `BaseAgent.evaluateAssertion()` — resolves key names via `connector.getSelector()` before DOM queries
- [ ] Change F: `data/*.db` added to `.gitignore`
- [ ] All existing tests still pass after code changes

### Configuration
- [ ] `app.config.json` uses `"id"` (not `"app_id"`) — required by `core/app-loader.js`
- [ ] `app.config.json` uses `auth.credentials.email` / `auth.credentials.passwordEnv` — required by connector's `authenticate()`
- [ ] `app.config.json` updated with correct staging `baseUrl` (`brainstormy-frontend-staging.onrender.com`)
- [ ] `connector.config.timeouts.navigation` set to `90000`
- [ ] `connector.config.timeouts.clerkAuth` set to `30000` (retained from existing config)
- [ ] `connector.config.timeouts.warmUp` set to `120000`
- [ ] `connector.config.selectors` calibrated against actual Clerk UI
- [ ] `agents.healer.scenarioFiles` references `scenarios/smoke-tests.json`

### Database & Storage
- [ ] SQLite database auto-created at `data/qa-engine.db` on first engine run
- [ ] All expected tables present (including `fixes`, `scheduled_runs`, `schema_migrations`)
- [ ] Evidence directory structure created under `evidence/`

### Staging Validation
- [ ] `scripts/verify-staging.js` confirms staging is reachable (HTTP 200)
- [ ] `scripts/verify-auth.js` confirms test account can authenticate through Clerk
- [ ] QA test project `[QA] Smoke Test Project` exists in staging (manual creation, one-time)

### First Smoke Test
- [ ] `node cli/index.js test --app brainstormy --agent healer --mode smoke --skip-bug-detection` executes successfully
- [ ] Test status is `passed` (or failures are clearly selector calibration issues, not infrastructure/pipeline problems)
- [ ] Test run recorded in `data/qa-engine.db` `test_runs` table
- [ ] Test results recorded in `data/qa-engine.db` `test_results` table
- [ ] Screenshots captured and stored in evidence directory
- [ ] Console logs captured
- [ ] Network requests captured
- [ ] Evidence metadata recorded in `data/qa-engine.db` `evidence_metadata` table

### WhatsApp Notification
- [ ] `scripts/verify-whatsapp.js` sends message successfully (Twilio returns SID)
- [ ] WhatsApp message received on Joel's phone
- [ ] Message content is readable and correctly formatted

---

## Evaluation Findings Cross-Reference

### v1.0 → v2.0 Findings (22 items — all resolved in v2.0)

| # | Finding | Resolution |
|---|---------|-----------|
| 1 | DB path `database/qa.db` vs `data/qa-engine.db` | All references use `data/qa-engine.db` |
| 2 | `scripts/migrate.js` doesn't exist | Removed — DB auto-initializes |
| 3 | `scripts/create-app.js` doesn't exist | Removed — apps load from JSON |
| 4 | `--no-bug-detection` flag missing | Changed to `--skip-bug-detection` as code change |
| 5 | `--scenario` flag missing | Uses `--mode smoke` instead |
| 6 | Scenario file structure mismatch | Uses existing `smoke-tests.json` |
| 7 | `TWILIO_WHATSAPP_FROM` vs `TWILIO_FROM_NUMBER` | Uses `TWILIO_FROM_NUMBER` |
| 8 | `WHATSAPP_DEFAULT_RECIPIENT` not recognized | Uses `QA_ENGINE_NOTIFICATION_RECIPIENTS` |
| 9 | `app.config.json` structure mismatch | Uses `baseUrl`, `connector.config.*`, camelCase |
| 10 | No warm-up capability | Listed as Change A |
| 11 | No `notify` CLI command | Standalone script only |
| 12 | Scenario action types don't match connector | Uses existing action vocabulary |
| 13 | `test_data` config key not recognized | Uses `connector.config.testProjectName` |
| 14 | Node.js 20 vs 24 | Acknowledges v24, verifies v18+ |
| 15 | Selector key naming mismatch | Uses `clerkEmailInput` etc. |
| 16 | Missing tables in expected list | Includes `fixes`, `scheduled_runs`, `schema_migrations` |
| 17 | Test count needs verification | Says "run `npm test` to confirm" |
| 18 | Verification scripts wrong config paths | Scripts use `config.connector.config.*` |
| 19 | `QA_ENGINE_ENV` not used | Removed |
| 20 | `.env.example` uses `TWILIO_FROM_NUMBER` | Resolved by #7 |
| 21 | `better-sqlite3` inline scripts | Removed |
| 22 | `npm link` needed for global command | Optional section added |

### v2.0 → v3.0 Findings (12 items — all resolved in v3.0)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 1 | CLI doesn't create Playwright browser/page/EvidenceCollector | CRITICAL | Change C: browser lifecycle in `engine.run()` (~40–50 lines) |
| 2 | No scenario loading — agents get empty config `{}` | CRITICAL | Change D: scenario file loading + `agents` block in config (~30–40 lines) |
| 3 | Scenario format (mixed action/assert in steps) incompatible with BaseAgent | CRITICAL | Change E: rewrite `smoke-tests.json` with separate `steps`/`assertions` arrays |
| 4 | `app_id` vs `id` in config | CRITICAL | Changed to `"id": "brainstormy"` |
| 5 | `auth.email` vs `auth.credentials.email` nesting | CRITICAL | Config uses `auth.credentials.email` / `auth.credentials.passwordEnv`; verify-auth.js updated |
| 6 | `--skip-bug-detection` more complex than estimated | SIGNIFICANT | Updated Change B: threads through 3 files (~25 lines), not 2 |
| 7 | `data/*.db` not in `.gitignore` | SIGNIFICANT | Change F: added to `.gitignore` |
| 8 | `clerkAuth` timeout removed from proposed config | MODERATE | Retained `"clerkAuth": 30000` in timeouts |
| 9 | `warmUp()` socket timeout vs response timeout nuance | MODERATE | Added hard deadline fallback via `setTimeout` in Change A |
| 10 | Auth done by connector, not by scenario steps | MODERATE | Noted in Step 8 pipeline description; scenario names clarified |
| 11 | `connector.base` field unused | MINOR | Removed from config |
| 12 | Evidence directory creation | MINOR | Already handled by `fs.mkdirSync` in verify-auth.js |

### v3.0 → v3.1 Findings (6 items — all resolved in v3.1)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 1 | `getBaseURL()` returns `undefined` — reads `environments[env].url` but config uses `baseUrl` | RUNTIME FAILURE | Added `getBaseURL()` override to Change A (~3 lines) |
| 2 | `element_exists` assertions pass raw selector keys (`"userMenu"`) not CSS selectors | RUNTIME FAILURE | Added required selector resolution to Change E via `connector.getSelector()` (~6 lines) |
| 3 | EvidenceCollector constructor requires `{ runId, appId, basePath }`, not `{ page }` | CODE FIX | Corrected Change C: generate `runId` in `engine.run()`, call `initialize(page)` separately |
| 4 | Change C uses `this._orchestrator` but engine is object literal with closure vars | CODE FIX | Corrected Change C: uses closure variable `orchestrator`, passes `appConfig` not `appId` |
| 5 | `--mode smoke` doesn't actually filter scenarios in `BaseAgent.getScenarios()` | MINOR | Noted in D3; non-blocking since all scenarios in rewritten file are smoke tests |
| 6 | `setTimeout` in `warmUp()` never cleared on normal completion | MINOR | Added `clearTimeout(deadline)` and settled-flag pattern to Change A |

---

## What Comes Next (Out of Scope)

After this task passes all success criteria, the following tasks can be specced:

1. **Expanded smoke scenarios** — Add project creation, story creation, session creation, and message-send scenarios to the Healer agent
2. **Selector hardening** — Add `data-testid` attributes to Brainstormy frontend components where missing
3. **Bug detection activation** — Enable the Bug Detector with Linear integration (remove `--skip-bug-detection`)
4. **Scheduler activation** — Configure launchd to run smoke tests on a schedule
5. **Daily operations** — Morning review workflow, metrics tracking, WhatsApp summary reports

None of those begin until this task confirms the foundation works.
