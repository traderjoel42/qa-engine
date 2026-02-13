# QA Engine: Mac Mini Environment Setup & First-Run Validation

**Version:** 2.0  
**Date:** February 13, 2026  
**Phase:** 2, Task 1  
**Prerequisite:** Phase 1 complete — run `npm test` on Mac Mini to confirm actual passing count  
**Related:** qa-engine-01 through 05, brainstormy-connector-and-scheduling-spec  
**Revision Note:** v2.0 incorporates all 22 findings from Claude Code's feasibility evaluation against the actual qa-engine codebase. Every path, env var name, config key, CLI flag, and script reference has been reconciled with the implementation.

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

**Implementation:** Add a `warmUp()` method to BrainstormyConnector (or BaseConnector) that performs an HTTP GET against the app's `baseUrl` with a 120-second timeout, called from `initialize()` before any browser navigation. This is a small code change (~15 lines) to an existing file. Also increase `connector.config.timeouts.navigation` from `30000` to `90000` in the app config.

**Impact:** Requires a code change to the connector (see Step 4a). After the warm-up request wakes the service, subsequent requests should respond within normal timeframes.

### D3: Minimal First Run — Healer Agent, Smoke Mode Only

**Decision:** The first-run validation uses only the Healer agent in `smoke` mode. No Sentinel, Librarian, or Quinn agents.

**Rationale:** The goal is to prove the plumbing works: connector authenticates, browser actions execute, evidence is captured, results are stored. The existing smoke test scenarios in `apps/brainstormy/scenarios/smoke-tests.json` (IDs: `smoke-01-login`, `smoke-02-navigate-project`, etc.) are the right starting point. Running memory persistence tests (Sentinel) or edge cases (Quinn) introduces variables that could obscure infrastructure problems.

**Impact:** The CLI command for first run: `node cli/index.js test --app brainstormy --agent healer --mode smoke`. Uses the existing `--mode` flag — no new CLI flags needed for scenario selection.

### D4: Skip Bug Detection and Auto-Fix for First Run

**Decision:** Add a `--skip-bug-detection` flag to the CLI `test` command. When set, the orchestrator still collects evidence on failure but does not invoke the Bug Detector, create Linear issues, or trigger approval workflows.

**Rationale:** The first run will almost certainly encounter selector mismatches, timing issues, or unexpected UI states. These are setup calibration issues, not bugs. Routing them through bug detection would create noise in Linear and potentially trigger approval workflows before the system is proven.

**Implementation:** This requires a small code change to `cli/commands/test.js` to accept the flag and pass it through to `TestOrchestrator.run()` options. The orchestrator already has conditional bug detection logic — this just adds a way to disable it from the CLI. Estimated: ~20 lines across 2 files.

**Impact:** Requires a code change (see Step 4b).

### D5: WhatsApp Notification as Standalone Verification

**Decision:** Test WhatsApp notification delivery as a separate manual step using a standalone script, not as part of the smoke test flow and not via a CLI subcommand.

**Rationale:** The smoke test validates browser automation + evidence + storage. WhatsApp validates Twilio credentials + message delivery. Coupling them means a Twilio misconfiguration could block proving that browser automation works. The CLI currently has `test`, `status`, and `bugs` commands but no `notify` command — adding one is out of scope for this task. A standalone script is faster to create and serves the verification purpose.

**Impact:** Create `scripts/verify-whatsapp.js` using the correct env var names from `core/config.js`.

### D6: SQLite Database at Codebase-Standard Location

**Decision:** Use the database path defined in `core/config.js`: `./data/qa-engine.db` (configurable via `QA_ENGINE_DB_PATH` env var).

**Rationale:** The Phase 1 implementation chose `data/qa-engine.db` as the database location, not `database/qa.db` as the original design specs proposed. The migration system is built into the engine initialization via `createDatabase()` in `core/database/index.js` — there is no standalone `scripts/migrate.js`. Aligning with the actual codebase avoids confusion.

**Impact:** All SQLite commands in this spec use `data/qa-engine.db`. Database initialization happens automatically when the engine first runs, not via a manual migration script. The `data/` directory is created by the engine if it doesn't exist.

### D7: App Config Loads from JSON Files, Not Database

**Decision:** Do not insert app records into the SQLite `apps` table manually. The system loads app configuration from `apps/brainstormy/app.config.json` at runtime via `loadAppConfig()`.

**Rationale:** The Phase 1 implementation uses JSON files as the source of truth for app configuration. The `apps` table in SQLite is populated or referenced by the engine at runtime, not pre-seeded. Creating a manual `INSERT` would bypass the app loader and could produce schema mismatches.

**Impact:** Step 5 from v1.0 (manual database initialization and app record insertion) is removed. The database is initialized automatically on first engine run.

---

## Code Changes Required Before First Run

The evaluation identified two small capabilities that need to be added to the codebase before the first-run steps can execute. These are surgical additions, not architectural changes.

### Change A: Warm-Up Method in Connector

**File to modify:** `connectors/brainstormy/connector.js` (or `connectors/base-connector.js` if preferred)

**What:** Add a `warmUp()` method that performs an HTTP GET against the app's base URL to wake up Render services before browser automation begins. Call it from `initialize()`.

```javascript
/**
 * Wake up the target service if it's been idle (Render cold start).
 * Performs a plain HTTP GET with generous timeout before browser nav.
 */
async warmUp() {
  const url = this.app.baseUrl || this.app.environments?.staging?.baseUrl;
  const timeout = this.app.connector?.config?.timeouts?.warmUp || 120000;
  
  console.log(`Warming up ${url} (timeout: ${timeout / 1000}s)...`);
  const start = Date.now();
  
  try {
    const https = require('https');
    await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout }, (res) => {
        res.resume(); // Drain response
        resolve(res.statusCode);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Warm-up timeout')); });
      req.on('error', reject);
    });
    
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Service ready (${elapsed}s)`);
  } catch (err) {
    console.warn(`  Warm-up warning: ${err.message} — proceeding anyway`);
  }
}
```

Then in `initialize()`, call `await this.warmUp()` before the first `page.goto()`.

**Estimated effort:** ~20 lines added to one file.

### Change B: --skip-bug-detection CLI Flag

**Files to modify:** `cli/commands/test.js`, `core/engine/test-orchestrator.js`

**What:** Add `--skip-bug-detection` option to the test command. Pass it through as `options.skipBugDetection` to the orchestrator, which skips the Bug Detector invocation when the flag is true.

In `cli/commands/test.js`:
```javascript
.option('--skip-bug-detection', 'Disable bug detection and Linear integration')
```

In `TestOrchestrator.run()` (or wherever bug detection is triggered):
```javascript
if (testResult.status === 'failed' && !options.skipBugDetection) {
  await this.bugDetector.detectAndReport(testResult);
}
```

**Estimated effort:** ~10 lines across 2 files.

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

**Notes:** If the test suite fails, STOP. Fix test failures before proceeding. Record the actual test count for the success criteria checklist — Phase 1 may have added tests since the original "83 tests" claim.

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

**Key differences from v1.0 spec:**
- `TWILIO_FROM_NUMBER` (not `TWILIO_WHATSAPP_FROM`) — matches `core/config.js`
- `QA_ENGINE_NOTIFICATION_RECIPIENTS` (not `WHATSAPP_DEFAULT_RECIPIENT`) — matches `core/config.js`, comma-separated
- Removed `QA_ENGINE_ENV=staging` — no code reads this variable

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

**What:** Update the Brainstormy app configuration to use the actual staging URL and test account. The config structure must match what `loadAppConfig()` and the BrainstormyConnector expect.

**File:** `apps/brainstormy/app.config.json`

Update the following fields in the existing config structure (do not replace the entire file — preserve any keys not mentioned here):

```json
{
  "app_id": "brainstormy",
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
    "base": "ai-chat-app",
    "config": {
      "auth": {
        "type": "email_password",
        "required": true,
        "email": "qa-automation@brainstormy.co",
        "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
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
        "warmUp": 120000
      },
      "testProjectName": "[QA] Smoke Test Project"
    }
  }
}
```

**Key differences from v1.0 spec (aligned with actual codebase):**
- `baseUrl` (not `url`) at top level and in `environments.staging`
- `connector.config.auth.passwordEnv` (not `credentials.password_env`)
- `connector.config.selectors.clerkEmailInput` (not `config.selectors.login_email`)
- `connector.config.timeouts` (not top-level `config.timeouts`)
- `connector.config.testProjectName` (not `test_data.smoke_test_project_id`)
- Added fallback selectors for Clerk inputs (comma-separated) since actual Clerk UI may differ from assumed `data-testid` values
- `warmUp` timeout added to existing timeouts object
- `navigation` increased from `30000` to `90000` for Render cold starts

**Validation:**
```bash
# Verify the config is valid JSON and key fields are correct
node -e "const c = require('./apps/brainstormy/app.config.json'); \
  console.log('App:', c.name); \
  console.log('URL:', c.baseUrl); \
  console.log('Auth email:', c.connector.config.auth.email); \
  console.log('Nav timeout:', c.connector.config.timeouts.navigation);"
# Expected:
#   App: Brainstormy
#   URL: https://brainstormy-frontend-staging.onrender.com
#   Auth email: qa-automation@brainstormy.co
#   Nav timeout: 90000
```

---

### Step 4a: Implement Warm-Up in Connector (Code Change)

**What:** Add the `warmUp()` method to BrainstormyConnector (or BaseConnector) as described in "Code Changes Required" above, and call it from `initialize()`.

**Validation:**
```bash
# Run unit tests to confirm no regressions
npm test

# Verify the warm-up method exists
node -e "const C = require('./connectors/brainstormy/connector'); \
  console.log('warmUp method:', typeof C.prototype.warmUp === 'function' ? 'EXISTS' : 'MISSING')"
```

**Commit:**
```bash
git add connectors/
git commit -m "Add warmUp() to connector for Render cold-start handling"
```

---

### Step 4b: Implement --skip-bug-detection CLI Flag (Code Change)

**What:** Add `--skip-bug-detection` option to the `test` CLI command as described in "Code Changes Required" above.

**Validation:**
```bash
# Verify the flag is recognized
node cli/index.js test --help
# Should list --skip-bug-detection in the options

# Run unit tests to confirm no regressions
npm test
```

**Commit:**
```bash
git add cli/ core/
git commit -m "Add --skip-bug-detection flag to CLI test command"
```

---

### Step 5: Validate Staging is Reachable

**What:** Confirm the staging environment is up and responding before attempting browser automation. This handles the Render cold-start scenario explicitly.

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
 * Reads config from the actual app.config.json structure
 * (connector.config.selectors, connector.config.auth, etc.)
 */

require('dotenv').config();
const { chromium } = require('playwright');
const config = require('../apps/brainstormy/app.config.json');

const stagingUrl = config.baseUrl;
const connectorConfig = config.connector.config;
const email = connectorConfig.auth.email;
const password = process.env[connectorConfig.auth.passwordEnv];

if (!password) {
  console.error(`❌ ${connectorConfig.auth.passwordEnv} not set in .env`);
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

**The existing smoke scenarios in `apps/brainstormy/scenarios/smoke-tests.json` contain:**
- `smoke-01-login` — Authenticate and verify login
- `smoke-02-navigate-project` — Navigate to a project page
- (and potentially others added during Phase 1)

These use the connector's existing `performAction()` vocabulary (`authenticate`, `createProject`, `navigateToStory`, etc.) and do not need to be rewritten.

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
[smoke-01-login] Authenticating...           ✅ (3.1s)
[smoke-01-login] Verifying auth state...     ✅ (0.8s)
[smoke-02-navigate-project] Navigating...    ✅ (2.1s)
[smoke-02-navigate-project] Verifying...     ✅ (0.5s)

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

### Code Changes
- [ ] `warmUp()` method added to connector, called from `initialize()`
- [ ] `--skip-bug-detection` flag added to CLI `test` command
- [ ] All existing tests still pass after code changes

### Configuration
- [ ] `app.config.json` updated with correct staging `baseUrl` (`brainstormy-frontend-staging.onrender.com`)
- [ ] `app.config.json` updated with correct test account email (`qa-automation@brainstormy.co`)
- [ ] `connector.config.timeouts.navigation` set to `90000`
- [ ] `connector.config.timeouts.warmUp` set to `120000`
- [ ] `connector.config.selectors` calibrated against actual Clerk UI

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
- [ ] Test status is `passed` (or failures are clearly selector calibration issues, not infrastructure problems)
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

This table maps each finding from the Claude Code feasibility evaluation to its resolution in this spec:

| # | Finding | Severity | Resolution in v2.0 |
|---|---------|----------|---------------------|
| 1 | DB path `database/qa.db` vs `data/qa-engine.db` | CRITICAL | Fixed — all references use `data/qa-engine.db` |
| 2 | `scripts/migrate.js` doesn't exist | CRITICAL | Removed — DB initializes automatically on first engine run |
| 3 | `scripts/create-app.js` doesn't exist | CRITICAL | Removed — apps load from JSON files at runtime |
| 4 | `--no-bug-detection` flag missing | CRITICAL | Changed to `--skip-bug-detection`, listed as required code change (Step 4b) |
| 5 | `--scenario` flag missing | CRITICAL | Removed — uses existing `--mode smoke` instead |
| 6 | Scenario file structure mismatch | CRITICAL | Removed — uses existing `smoke-tests.json` scenarios |
| 7 | `TWILIO_WHATSAPP_FROM` vs `TWILIO_FROM_NUMBER` | CRITICAL | Fixed — uses `TWILIO_FROM_NUMBER` throughout |
| 8 | `WHATSAPP_DEFAULT_RECIPIENT` not recognized | CRITICAL | Fixed — uses `QA_ENGINE_NOTIFICATION_RECIPIENTS` |
| 9 | `app.config.json` structure mismatch | SIGNIFICANT | Fixed — uses `baseUrl`, `connector.config.*`, `camelCase` keys |
| 10 | No warm-up capability | SIGNIFICANT | Listed as required code change (Step 4a) with implementation |
| 11 | No `notify` CLI command | SIGNIFICANT | Removed — uses standalone `scripts/verify-whatsapp.js` only |
| 12 | Scenario action types don't match connector | SIGNIFICANT | Removed — uses existing smoke-tests.json with existing action vocabulary |
| 13 | `test_data` config key not recognized | SIGNIFICANT | Fixed — uses `connector.config.testProjectName` |
| 14 | Node.js 20 vs 24 already installed | MODERATE | Fixed — Step 1 says verify v18+, acknowledges v24 |
| 15 | Selector key naming mismatch | MODERATE | Fixed — verification scripts use `connector.config.selectors.clerkEmailInput` etc. |
| 16 | Missing tables in expected list | MODERATE | Fixed — checklist includes `fixes`, `scheduled_runs`, `schema_migrations` |
| 17 | Test count needs verification | MODERATE | Fixed — prerequisite says "run `npm test` to confirm actual count" |
| 18 | Verification scripts reference wrong config paths | MODERATE | Fixed — scripts read from `config.connector.config.*` |
| 19 | `QA_ENGINE_ENV` not used | MINOR | Removed from `.env` template |
| 20 | `.env.example` uses `TWILIO_FROM_NUMBER` | MINOR | Resolved by #7 |
| 21 | `better-sqlite3` inline scripts | MINOR | Removed — no manual DB operations needed |
| 22 | `npm link` needed for global command | MINOR | Added optional section explaining `npm link` |

---

## What Comes Next (Out of Scope)

After this task passes all success criteria, the following tasks can be specced:

1. **Expanded smoke scenarios** — Add project creation, story creation, session creation, and message-send scenarios to the Healer agent
2. **Selector hardening** — Add `data-testid` attributes to Brainstormy frontend components where missing
3. **Bug detection activation** — Enable the Bug Detector with Linear integration (remove `--skip-bug-detection`)
4. **Scheduler activation** — Configure launchd to run smoke tests on a schedule
5. **Daily operations** — Morning review workflow, metrics tracking, WhatsApp summary reports

None of those begin until this task confirms the foundation works.
