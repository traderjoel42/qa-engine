# QA Engine: Mac Mini Environment Setup & First-Run Validation

**Version:** 1.0  
**Date:** February 13, 2026  
**Phase:** 2, Task 1  
**Prerequisite:** Phase 1 complete (83 tests passing, 1,840 total across 43 suites, zero regressions)  
**Related:** qa-engine-01 through 05, brainstormy-connector-and-scheduling-spec

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

**Rationale:** The original QA Engine specs reference `staging.brainstormy.app` and test account `testbot@brainstormy.app`. Neither exists. The actual staging frontend is deployed on Render at the URL above, and the QA test account is `qa-automation@brainstormy.co` using Clerk email/password auth. The `app.config.json` must reflect reality from day one — running against a nonexistent URL would waste time debugging DNS failures that aren't bugs.

**Impact:** Update `apps/brainstormy/app.config.json` environments block and all credential references.

### D2: Cold-Start-Aware Timeouts

**Decision:** Set navigation timeout to 90 seconds, AI response timeout to 90 seconds, and add an explicit warm-up step before the first test.

**Rationale:** Render free/starter tier services spin down after inactivity. The first page load can take 30–60 seconds while the service container restarts. Standard 30-second Playwright timeouts will fail on cold starts, creating false negatives that undermine trust in the system before it's even proven. A dedicated warm-up request with generous timeout, followed by standard (but still padded) timeouts for actual tests, handles this cleanly.

**Impact:** The warm-up step is added to the connector's `initialize()` flow (or as a pre-test hook in the CLI). Timeouts in `app.config.json` are increased. After the first request warms the service, subsequent requests should respond within normal timeframes.

### D3: Minimal First Run — Healer Agent, Smoke Scenarios Only

**Decision:** The first-run validation uses only the Healer agent with smoke test scenarios. No Sentinel, Librarian, or Quinn agents.

**Rationale:** The goal is to prove the plumbing works: connector authenticates, browser actions execute, evidence is captured, results are stored. A single successful login-and-navigate smoke test proves all of that. Running memory persistence tests (Sentinel) or edge cases (Quinn) introduces variables that could obscure infrastructure problems. Debug one layer at a time.

**Impact:** The CLI command for first run targets a single agent: `qa-engine test --app brainstormy --agent healer --scenario smoke-login`.

### D4: Skip Bug Detection and Auto-Fix for First Run

**Decision:** Disable bug detection, Linear integration, and auto-fix for the first-run validation. If a test fails, it should report the failure with evidence but NOT attempt to create Linear issues or generate fixes.

**Rationale:** The first run will almost certainly encounter selector mismatches, timing issues, or unexpected UI states. These are setup calibration issues, not bugs. Routing them through bug detection would create noise in Linear and potentially trigger approval workflows before the system is proven. Once the smoke test passes reliably, bug detection can be enabled in a subsequent task.

**Impact:** Run with `--no-bug-detection` flag or equivalent config override. The Healer agent still collects evidence on failure — screenshots, console logs, network requests — but stops at "test failed with evidence" rather than entering the bug lifecycle.

### D5: WhatsApp Notification as Standalone Verification

**Decision:** Test WhatsApp notification delivery as a separate manual step, not as part of the smoke test flow.

**Rationale:** The smoke test validates browser automation + evidence + storage. WhatsApp validates Twilio credentials + message delivery. Coupling them means a Twilio misconfiguration could block proving that browser automation works. Test them independently, then combine in subsequent tasks.

**Impact:** A dedicated CLI command or script sends a test notification: `qa-engine notify --test`. This sends a hardcoded "QA Engine is online" message to the configured recipient and confirms delivery.

### D6: SQLite Database in Standard Location

**Decision:** Place the SQLite database at `<repo>/database/qa.db` with evidence storage at `<repo>/evidence/`.

**Rationale:** Matches the directory structure defined in the Phase 0 spec. Local filesystem storage is appropriate for Phase 1–2 (single machine, single app). No need for external database configuration.

**Impact:** The `scripts/migrate.js` command creates the database and applies the schema. Evidence directories are created on first test run.

---

## Implementation Steps

### Step 1: Mac Mini System Prerequisites

**What:** Install Node.js, verify system tools, install Playwright browsers.

**Commands:**
```bash
# Verify or install Node.js 18+ (use nvm for version management)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc  # or ~/.bashrc
nvm install 20
nvm use 20
node --version  # Should print v20.x.x

# Verify git is available
git --version

# Verify SQLite is available (ships with macOS)
sqlite3 --version
```

**Validation:**
```bash
node --version    # v20.x.x
npm --version     # 10.x.x
git --version     # git version 2.x.x
sqlite3 --version # 3.x.x
```

**Notes:** If Node.js is already installed via Homebrew or another method, that's fine — just verify it's v18+. The nvm approach is recommended for version management but not required.

---

### Step 2: Clone Repository and Install Dependencies

**What:** Clone the qa-engine repo, install npm dependencies, install Playwright browsers.

**Commands:**
```bash
# Clone the repo (adjust URL to actual GitHub repo)
cd ~
git clone https://github.com/traderjoel42/qa-engine.git
cd qa-engine

# Install Node.js dependencies
npm install

# Install Playwright browsers (Chromium is the primary target)
npx playwright install chromium

# Verify Playwright works
npx playwright --version
```

**Validation:**
```bash
# Verify dependencies installed
ls node_modules/.package-lock.json  # Should exist

# Verify Playwright browser is installed
npx playwright install --dry-run chromium  # Should say "already installed"

# Run the existing unit test suite to confirm nothing is broken
npm test
# Expected: 83 tests passing across Phase 1 implementation
```

**Notes:** If the existing test suite fails, STOP. Fix test failures before proceeding — the codebase should be clean before attempting integration with a real environment.

---

### Step 3: Configure Environment Variables

**What:** Create `.env` file with all required secrets for staging integration.

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
WHATSAPP_DEFAULT_RECIPIENT=whatsapp:+<Joel's phone number>
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<Twilio auth token>
TWILIO_WHATSAPP_FROM=whatsapp:+<Twilio WhatsApp sender number>

# --- AI / LLM ---
# Used by Bug Detector and Auto-Fixer (not needed for first run,
# but configure now to avoid a second setup pass)
ANTHROPIC_API_KEY=<Anthropic API key>

# --- Bug Tracking ---
# Used by Bug Detector for creating Linear issues (not needed for first run)
LINEAR_API_KEY=<Linear API key>

# --- Environment ---
QA_ENGINE_ENV=staging
```

**Validation:**
```bash
# Verify .env is loaded (from repo root)
node -e "require('dotenv').config(); console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'MISSING')"
node -e "require('dotenv').config(); console.log('BRAINSTORMY_TEST_PASSWORD:', process.env.BRAINSTORMY_TEST_PASSWORD ? 'SET' : 'MISSING')"
node -e "require('dotenv').config(); console.log('WHATSAPP_DEFAULT_RECIPIENT:', process.env.WHATSAPP_DEFAULT_RECIPIENT ? 'SET' : 'MISSING')"

# All should print SET, not MISSING
```

**Security notes:**
- `.env` must be in `.gitignore` (verify this exists in the repo)
- Never commit credentials to the repository
- The `.env.example` file in the repo documents required variables without values

---

### Step 4: Update app.config.json for Real Staging

**What:** Update the Brainstormy app configuration to use the actual staging URL and test account.

**File:** `apps/brainstormy/app.config.json`

Replace the environments block with the correct staging configuration:

```json
{
  "app_id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat-app",

  "environments": {
    "staging": {
      "url": "https://brainstormy-frontend-staging.onrender.com",
      "auth": {
        "type": "email_password",
        "required": true,
        "credentials": {
          "email": "qa-automation@brainstormy.co",
          "password_env": "BRAINSTORMY_TEST_PASSWORD"
        }
      }
    }
  },

  "connector": {
    "type": "brainstormy",
    "base": "ai-chat-app"
  },

  "config": {
    "auth_indicator": "[data-testid='user-menu']",
    "ready_indicator": "[data-testid='app-loaded']",

    "selectors": {
      "login_email": "[name='email'], [name='emailAddress'], input[type='email']",
      "login_password": "[name='password'], input[type='password']",
      "login_submit": "[type='submit'], button:has-text('Continue'), button:has-text('Sign in')",
      "logout": "[data-testid='logout-button']",

      "chat_input": "[data-testid='chat-input']",
      "chat_send": "[data-testid='send-button']",
      "ai_message": "[data-testid='ai-message']",
      "generating_indicator": "[data-testid='generating']",

      "new_project_button": "[data-testid='new-project-button']",
      "new_story_button": "[data-testid='new-story-button']",
      "new_session_button": "[data-testid='new-session-button']"
    },

    "timeouts": {
      "navigation": 90000,
      "ai_response": 90000,
      "bible_generation": 120000,
      "warm_up": 120000,
      "element_visible": 30000
    }
  }
}
```

**Key changes from original spec:**
- `url`: Changed from `https://staging.brainstormy.app` to `https://brainstormy-frontend-staging.onrender.com`
- `credentials.email`: Changed from `testbot@brainstormy.app` to `qa-automation@brainstormy.co`
- `selectors.login_*`: Added fallback selectors because Clerk's login form may use different attribute names than assumed in the original spec. These are comma-separated Playwright selector lists — it will match the first one found.
- `timeouts.navigation`: Increased from 30000 to 90000 for Render cold starts
- `timeouts.warm_up`: New field, 120 seconds for initial service wake-up
- `timeouts.element_visible`: New field, generous wait for elements after navigation

**Validation:**
```bash
# Verify the config is valid JSON
node -e "const c = require('./apps/brainstormy/app.config.json'); console.log('App:', c.name, '| URL:', c.environments.staging.url)"
# Expected: App: Brainstormy | URL: https://brainstormy-frontend-staging.onrender.com
```

---

### Step 5: Initialize Database

**What:** Run database migrations to create the SQLite schema.

**Commands:**
```bash
# Run migrations
node scripts/migrate.js

# Verify schema was created
sqlite3 database/qa.db ".tables"
# Expected output should include: apps, test_runs, test_results, bugs, approvals, evidence_metadata

# Verify the apps table structure
sqlite3 database/qa.db ".schema apps"

# Create the Brainstormy app record
node scripts/create-app.js brainstormy
# Or if no script exists, insert manually:
# node -e "
#   const db = require('better-sqlite3')('database/qa.db');
#   db.prepare('INSERT INTO apps (id, name, type, config, status) VALUES (?, ?, ?, ?, ?)').run(
#     'brainstormy-staging',
#     'Brainstormy',
#     'ai-chat',
#     JSON.stringify(require('./apps/brainstormy/app.config.json')),
#     'active'
#   );
#   console.log('App record created');
# "
```

**Validation:**
```bash
# Verify app record exists
sqlite3 database/qa.db "SELECT id, name, status FROM apps"
# Expected: brainstormy-staging|Brainstormy|active (or similar)
```

---

### Step 6: Create Evidence Directory Structure

**What:** Create the directory structure for storing test evidence (screenshots, logs, network captures).

**Commands:**
```bash
mkdir -p evidence/brainstormy-staging
```

**Validation:**
```bash
ls -la evidence/
# Should show brainstormy-staging directory
```

**Notes:** The EvidenceCollector creates per-run subdirectories automatically (`evidence/<app_id>/<test_run_id>/screenshots/`, etc.). We just need the top-level structure to exist.

---

### Step 7: Validate Staging is Reachable

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

**Programmatic validation (create a quick verification script):**

**File:** `scripts/verify-staging.js`
```javascript
#!/usr/bin/env node

/**
 * Verify staging environment is reachable.
 * Handles Render cold-start with generous timeout.
 */

const https = require('https');
const config = require('../apps/brainstormy/app.config.json');

const url = config.environments.staging.url;
const timeout = config.config.timeouts.warm_up || 120000;

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

### Step 8: Validate Test Account Authentication (Browser)

**What:** Use Playwright to verify that the QA test account can log in to staging through Clerk's authentication flow. This is the critical integration point — if Clerk auth doesn't work, nothing else will.

**File:** `scripts/verify-auth.js`

```javascript
#!/usr/bin/env node

/**
 * Verify QA test account can authenticate against staging.
 * Opens a real browser, navigates to staging, performs Clerk login.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const config = require('../apps/brainstormy/app.config.json');

const stagingUrl = config.environments.staging.url;
const email = config.environments.staging.auth.credentials.email;
const password = process.env[config.environments.staging.auth.credentials.password_env];

if (!password) {
  console.error('❌ BRAINSTORMY_TEST_PASSWORD not set in .env');
  process.exit(1);
}

(async () => {
  console.log(`Authenticating ${email} at ${stagingUrl}`);
  console.log('Launching browser...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to staging (warm up)
    console.log('Navigating to staging (may take 30-60s for cold start)...');
    await page.goto(stagingUrl, {
      waitUntil: 'networkidle',
      timeout: config.config.timeouts.warm_up
    });
    console.log('  Page loaded');

    // Step 2: Look for Clerk sign-in
    // Clerk may redirect to a sign-in page or show a modal
    // Wait for any email input to appear
    console.log('Looking for login form...');

    // Take a screenshot of initial state for debugging
    await page.screenshot({ path: 'evidence/debug-01-initial-load.png' });

    // Try to find email input using fallback selectors
    const emailSelectors = config.config.selectors.login_email.split(',').map(s => s.trim());
    let emailInput = null;

    for (const selector of emailSelectors) {
      try {
        emailInput = await page.waitForSelector(selector, {
          timeout: config.config.timeouts.element_visible,
          state: 'visible'
        });
        if (emailInput) {
          console.log(`  Found email input: ${selector}`);
          break;
        }
      } catch {
        // Try next selector
      }
    }

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

      // Try again after clicking
      for (const selector of emailSelectors) {
        try {
          emailInput = await page.waitForSelector(selector, {
            timeout: config.config.timeouts.element_visible,
            state: 'visible'
          });
          if (emailInput) {
            console.log(`  Found email input after sign-in click: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }
    }

    if (!emailInput) {
      await page.screenshot({ path: 'evidence/debug-03-no-email-input-after-retry.png' });
      throw new Error('Could not find email input field. Check evidence/debug-*.png screenshots.');
    }

    // Step 3: Enter credentials
    console.log('Entering credentials...');
    await emailInput.fill(email);

    // Clerk's flow: email first, then "Continue", then password
    // Look for continue/submit button
    const submitSelectors = config.config.selectors.login_submit.split(',').map(s => s.trim());
    let submitButton = null;

    for (const selector of submitSelectors) {
      try {
        submitButton = await page.$(selector);
        if (submitButton && await submitButton.isVisible()) {
          console.log(`  Found submit button: ${selector}`);
          break;
        }
        submitButton = null;
      } catch {
        // Try next
      }
    }

    if (submitButton) {
      await submitButton.click();
      console.log('  Clicked continue/submit after email');
      await page.waitForTimeout(2000);
    }

    // Now look for password field
    const passwordSelectors = config.config.selectors.login_password.split(',').map(s => s.trim());
    let passwordInput = null;

    for (const selector of passwordSelectors) {
      try {
        passwordInput = await page.waitForSelector(selector, {
          timeout: config.config.timeouts.element_visible,
          state: 'visible'
        });
        if (passwordInput) {
          console.log(`  Found password input: ${selector}`);
          break;
        }
      } catch {
        // Try next
      }
    }

    if (!passwordInput) {
      await page.screenshot({ path: 'evidence/debug-04-no-password-input.png' });
      throw new Error('Could not find password input field. Clerk may use a different flow. Check screenshots.');
    }

    await passwordInput.fill(password);

    // Click final submit
    submitButton = null;
    for (const selector of submitSelectors) {
      try {
        submitButton = await page.$(selector);
        if (submitButton && await submitButton.isVisible()) break;
        submitButton = null;
      } catch {
        // Try next
      }
    }

    if (submitButton) {
      await submitButton.click();
      console.log('  Submitted credentials');
    }

    // Step 4: Wait for authenticated state
    console.log('Waiting for authenticated state...');

    // Wait for either the auth indicator or a reasonable page load
    try {
      await page.waitForSelector(config.config.auth_indicator, {
        timeout: config.config.timeouts.navigation,
        state: 'visible'
      });
      console.log('  ✅ Auth indicator found — login successful');
    } catch {
      // Auth indicator might not exist yet — check URL instead
      const currentUrl = page.url();
      console.log(`  Current URL: ${currentUrl}`);

      // If we're no longer on a sign-in page, likely authenticated
      if (!currentUrl.includes('sign-in') && !currentUrl.includes('login')) {
        console.log('  ✅ No longer on sign-in page — likely authenticated');
      } else {
        await page.screenshot({ path: 'evidence/debug-05-auth-failed.png' });
        throw new Error('Authentication appears to have failed. Check screenshots.');
      }
    }

    // Step 5: Take success screenshot
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

**If this fails:** The debug screenshots at each stage will show exactly where the flow broke down. Common issues:
- Clerk UI changed selectors → update `app.config.json` selectors
- Test account doesn't exist in staging Clerk → create it in the Clerk dashboard
- Password is wrong → verify in `.env`
- Clerk is using a different auth flow (e.g., magic link only) → need to enable password auth for the test account in Clerk settings

---

### Step 9: Verify Test Project Isolation

**What:** Confirm the QA test account has (or can create) a dedicated test project that won't interfere with real data.

**Rationale:** The QA automation will create projects, stories, and sessions during testing. These must be isolated from any real user data in staging. The simplest approach: ensure the test account only creates resources prefixed with `[QA]` and has a cleanup mechanism.

**Manual prerequisite (one-time, before first run):**

1. Log in to `https://brainstormy-frontend-staging.onrender.com` as `qa-automation@brainstormy.co`
2. Create a project named `[QA] Smoke Test Project`
3. Note the project ID from the URL (e.g., `/projects/abc-123-def`)
4. Add this project ID to `app.config.json` under a new `test_data` key:

```json
{
  "test_data": {
    "smoke_test_project_id": "<project-id-from-url>",
    "project_name_prefix": "[QA]"
  }
}
```

**Rationale for manual setup:** Auto-creating projects during testing is what the smoke test itself will validate. We need a known-good project to exist first so the initial smoke test can navigate to it and verify the UI works. Chicken-and-egg: use manual setup for the bootstrap, then let automation handle creation in subsequent tests.

**Validation:**
```bash
# Verify the project ID is configured
node -e "const c = require('./apps/brainstormy/app.config.json'); console.log('Test project:', c.test_data?.smoke_test_project_id || 'NOT SET')"
```

---

### Step 10: First Smoke Test Run

**What:** Execute a single smoke test through the CLI against real staging. This is the milestone — the first real test run.

**Smoke test scenario (`apps/brainstormy/scenarios/smoke-login.json`):**

If this file doesn't already exist from Phase 1, create it:

```json
{
  "id": "smoke-login",
  "name": "Login and Navigate Smoke Test",
  "description": "Verify basic authentication and page navigation against staging",
  "agent": "healer",
  "priority": "critical",
  "steps": [
    {
      "action": "warm_up",
      "description": "Wake up Render service if cold",
      "timeout": 120000
    },
    {
      "action": "authenticate",
      "description": "Log in with QA test account via Clerk"
    },
    {
      "action": "verify_authenticated",
      "description": "Confirm login succeeded by checking for auth indicator or dashboard"
    },
    {
      "action": "navigate",
      "target": "/projects",
      "description": "Navigate to projects page"
    },
    {
      "action": "verify_element_visible",
      "selector": "[data-testid='new-project-button'], button:has-text('New Project'), .projects-list",
      "description": "Verify projects page loaded with expected elements"
    },
    {
      "action": "capture_evidence",
      "type": "screenshot",
      "name": "projects-page-loaded"
    }
  ],
  "expected_outcome": {
    "all_steps_complete": true,
    "authenticated": true,
    "evidence_captured": true
  }
}
```

**Run command:**
```bash
# Run the smoke test (with bug detection disabled for first run)
qa-engine test --app brainstormy --agent healer --scenario smoke-login --no-bug-detection

# Or if the CLI isn't globally linked yet:
node cli/index.js test --app brainstormy --agent healer --scenario smoke-login --no-bug-detection
```

**What success looks like:**
```
QA Engine v1.0.0
═══════════════════════════════════════════
Running: smoke-login (Healer Agent)
Target:  https://brainstormy-frontend-staging.onrender.com
═══════════════════════════════════════════

[1/6] Warming up staging service...          ✅ (34.2s)
[2/6] Authenticating qa-automation@...       ✅ (3.1s)
[3/6] Verifying authenticated state...       ✅ (0.8s)
[4/6] Navigating to /projects...             ✅ (2.1s)
[5/6] Verifying projects page elements...    ✅ (0.5s)
[6/6] Capturing evidence...                  ✅ (0.3s)

═══════════════════════════════════════════
RESULT: PASSED  (41.0s total)
═══════════════════════════════════════════
Test Run ID:  tr-20260213-001
Evidence:     evidence/brainstormy-staging/tr-20260213-001/
Screenshots:  3
Console Logs: captured
Network Reqs: captured
```

**Validation checklist after the run:**
```bash
# 1. Verify test run was recorded in SQLite
sqlite3 database/qa.db "SELECT id, status, summary FROM test_runs ORDER BY started_at DESC LIMIT 1"
# Expected: shows the run with status 'completed' and summary JSON

# 2. Verify test result was recorded
sqlite3 database/qa.db "SELECT test_name, status, duration_ms FROM test_results ORDER BY executed_at DESC LIMIT 1"
# Expected: smoke-login | passed | ~41000

# 3. Verify evidence was stored
ls evidence/brainstormy-staging/
# Expected: directory named with the test run ID

ls evidence/brainstormy-staging/tr-*/screenshots/
# Expected: screenshot files (PNG)

ls evidence/brainstormy-staging/tr-*/logs/
# Expected: console log capture file

ls evidence/brainstormy-staging/tr-*/network/
# Expected: network request capture file

# 4. Verify evidence metadata was recorded in SQLite
sqlite3 database/qa.db "SELECT file_type, file_path FROM evidence_metadata ORDER BY created_at DESC LIMIT 5"
# Expected: screenshot, log, and network entries with valid file paths
```

---

### Step 11: First WhatsApp Notification

**What:** Send a test notification via Twilio to verify WhatsApp delivery works.

**File:** `scripts/verify-whatsapp.js`

```javascript
#!/usr/bin/env node

/**
 * Send a test WhatsApp notification to verify Twilio configuration.
 * Standalone — does not depend on test run infrastructure.
 */

require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_WHATSAPP_FROM;
const to = process.env.WHATSAPP_DEFAULT_RECIPIENT;

// Validate all required vars
const missing = [];
if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
if (!from) missing.push('TWILIO_WHATSAPP_FROM');
if (!to) missing.push('WHATSAPP_DEFAULT_RECIPIENT');

if (missing.length > 0) {
  console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

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
      console.error('   Authentication failed — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    } else if (err.code === 21608) {
      console.error('   Unverified recipient — the "to" number needs to join the Twilio sandbox');
      console.error('   Send "join <sandbox-keyword>" from your WhatsApp to the Twilio number');
    } else if (err.code === 21211) {
      console.error('   Invalid "to" number — check WHATSAPP_DEFAULT_RECIPIENT format');
      console.error('   Should be: whatsapp:+1234567890');
    }

    process.exit(1);
  });
```

**Validation:**
```bash
node scripts/verify-whatsapp.js
# Expected: ✅ Message sent successfully
# Then check phone: WhatsApp message from Twilio should arrive within seconds
```

**Common issues:**
- Error 21608 (unverified): For Twilio sandbox, Joel must send "join <keyword>" from his WhatsApp to the Twilio number first. This is a one-time setup.
- Error 20003 (auth): Double-check SID and auth token in `.env`
- Message sent but not received: Check Twilio console for delivery status. May need to wait or re-join sandbox.

---

## Post-Validation: Selector Calibration

The first run will very likely require selector adjustments. Clerk's login form and Brainstormy's UI may use different attributes than what's assumed in the config. This is expected and not a failure — it's calibration.

**Process when a step fails due to selectors:**

1. Check the debug screenshots in `evidence/` — they show exactly what the page looked like at the point of failure
2. Open the staging URL in a regular browser, inspect the element
3. Update the selector in `app.config.json`
4. Re-run the verification script or smoke test
5. Repeat until all steps pass

**Once the smoke test passes cleanly, commit the calibrated selectors:**
```bash
git add apps/brainstormy/app.config.json
git commit -m "Calibrate selectors for real staging environment"
```

---

## Success Criteria Checklist

All items must be checked before this task is complete:

### Environment Setup
- [ ] Node.js 20+ installed and verified on Mac Mini
- [ ] Repository cloned and npm dependencies installed
- [ ] Playwright Chromium browser installed
- [ ] Existing unit tests pass (83 tests, zero regressions)
- [ ] `.env` file created with all 7 environment variables set
- [ ] `.env` is in `.gitignore`

### Configuration
- [ ] `app.config.json` updated with correct staging URL (`brainstormy-frontend-staging.onrender.com`)
- [ ] `app.config.json` updated with correct test account (`qa-automation@brainstormy.co`)
- [ ] Timeouts configured for Render cold starts (90s navigation, 120s warm-up)
- [ ] Login selectors calibrated against actual Clerk UI

### Database & Storage
- [ ] SQLite database created at `database/qa.db`
- [ ] All schema tables present (apps, test_runs, test_results, bugs, approvals, evidence_metadata)
- [ ] Brainstormy app record inserted
- [ ] Evidence directory structure created

### Staging Validation
- [ ] `verify-staging.js` confirms staging is reachable (HTTP 200)
- [ ] `verify-auth.js` confirms test account can authenticate through Clerk
- [ ] QA test project exists in staging (manual creation, one-time)

### First Smoke Test
- [ ] `qa-engine test` command executes successfully with `smoke-login` scenario
- [ ] Test status is `passed`
- [ ] Test run recorded in SQLite `test_runs` table
- [ ] Test result recorded in SQLite `test_results` table
- [ ] Screenshots captured and stored in evidence directory
- [ ] Console logs captured
- [ ] Network requests captured
- [ ] Evidence metadata recorded in SQLite `evidence_metadata` table

### WhatsApp Notification
- [ ] `verify-whatsapp.js` sends message successfully (Twilio returns SID)
- [ ] WhatsApp message received on Joel's phone
- [ ] Message content is readable and correctly formatted

---

## What Comes Next (Out of Scope)

After this task passes all success criteria, the following tasks can be specced:

1. **Expanded smoke scenarios** — Add project creation, story creation, session creation, and message-send scenarios to the Healer agent
2. **Selector hardening** — Add `data-testid` attributes to Brainstormy frontend components where missing, reducing reliance on fragile CSS selectors
3. **Bug detection activation** — Enable the Bug Detector with Linear integration for real failure classification
4. **Scheduler activation** — Configure launchd to run smoke tests on a schedule
5. **Daily operations** — Morning review workflow, metrics tracking, WhatsApp summary reports

None of those begin until this task confirms the foundation works.
