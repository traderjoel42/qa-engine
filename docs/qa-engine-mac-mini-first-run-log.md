# QA Engine — Mac Mini First Run: Implementation Log

**Date:** 2026-02-13 (started) → 2026-02-14 (first run completed)
**Spec version:** v3.2 (`docs/qa-engine-mac-mini-first-run-spec.md`)
**Test suite:** 1842 tests, 43 suites — all passing after every change

---

## Changes Implemented

### Change F — `.gitignore` (`50373fb`)
Added `data/*.db`, `data/*.db-journal`, `data/*.db-wal` to prevent committing SQLite database files.

### Change A — BrainstormyConnector (`b5cfef5`)
**File:** `connectors/brainstormy/connector.js`
- Added `getBaseURL()` override to read from `app.environments[env].baseUrl` with fallback to `app.baseUrl`
- Added `warmUp()` method — sends HTTPS GET to wake Render cold starts (timeout from `getTimeout('warmUp')`, default 120s)
- Modified `initialize()` to call `await this.warmUp()` before `page.goto()`

### Changes C+D — Engine factory (`463a52e`)
**File:** `core/engine/factory.js`
- **Change D (scenario loading):** Agent registration loop now loads `scenarioFiles` from disk, resolving paths via `path.resolve(appsDir, appId, scenarioFile)`
- **Change C (browser lifecycle):** `engine.run()` creates Playwright browser, page, and EvidenceCollector when not provided via options; cleans up browser in `finally` block

### Changes D-config + E — Config, smoke tests, selector resolution (`1851751`)
**Files:** `apps/brainstormy/app.config.json`, `apps/brainstormy/scenarios/smoke-tests.json`, `agents/base-agent.js`
- Updated `app.config.json`: Render staging URL, increased timeouts (navigation: 90s, warmUp: 120s), Clerk selector fallbacks, `agents.healer.scenarioFiles` reference
- Rewrote `smoke-tests.json` with separate `steps`/`assertions` arrays using supported types (`element_exists`, `url_contains`)
- Added selector resolution in `BaseAgent.evaluateAssertion()` — `element_exists` and `element_text_contains` now resolve camelCase keys via `connector.getSelector()`

### Change B — Skip bug detection flag (`cc594a8`)
**Files:** `cli/commands/test.js`, `core/engine/test-orchestrator.js`
- Added `--skip-bug-detection` CLI option
- Threaded `skipBugDetection` through `orchestrator._runPostHooks(result, options)`
- Guarded `failureHandler.handle()` with `!options.skipBugDetection`

### Clerk Backend API Session Injection (new)
**Files:** `connectors/brainstormy/connector.js`, `scripts/verify-auth.js`, `apps/brainstormy/app.config.json`

Replaced UI-based Clerk login with Backend API session injection to bypass factor-two
verification that triggers on every fresh Playwright browser context.

**Auth flow:**
1. Look up test user by email via `GET /v1/users?email_address[]=...`
2. Create sign-in token via `POST /v1/sign_in_tokens` with `redirect_url`
3. Navigate to app's sign-in page with `#/__clerk_ticket=TOKEN` to establish Clerk client on accounts.dev
4. Navigate to sign-in token URL — Clerk processes ticket and redirects to app with valid session

**Additional fixes:**
- Fixed `EvidenceCollector._onRequestFinished` — `request.response()` returns a Promise in Playwright 1.58, wrapped in `Promise.resolve()`
- Fixed CLI `test.js` result display — read `result.summary.totalScenarios` instead of `result.total`
- Fixed `readyIndicator` in `app.config.json` from `[data-testid='app-loaded'], #app-root` to `#root`
- Added `this._initialized = true` at end of `initialize()` (agent health check)
- Added `_clerkApiRequest()` helper using Node's `https` module

---

## First Smoke Test Run

**Run ID:** `run-1771085279657-eb63`
**Date:** 2026-02-14

```
Status:  failed (1 of 2 scenarios passed)
Total:   2
Passed:  1
Failed:  1
```

- Authentication: PASSED (Clerk Backend API session injection)
- 1 scenario passed, 1 failed
- Non-blocking issue: `FailureHandler: this._storage.saveBug is not a function` (missing storage method, does not affect test execution)

---

## Issues Encountered

1. **Clerk factor-two on fresh browser** — Every Playwright run triggers email verification code. Solved with Backend API session injection.
2. **EvidenceCollector crash** — `response.status is not a function` (24 per run). Playwright 1.58 changed `request.response()` to async. Fixed with `Promise.resolve()` wrapper.
3. **CLI showing 0 tests** — Wrong result field path. Fixed to `result.summary.totalScenarios`.
4. **readyIndicator timeout** — `#app-root` doesn't exist, actual root is `#root`. Fixed in config.
5. **Session domain isolation** — Sign-in token creates session on Clerk's `accounts.dev` domain, not the app domain. Solved by first navigating to app (triggers redirect to accounts.dev, establishing Clerk client), then navigating to sign-in token URL which properly redirects back to the app.

---

## Remaining Steps

- **Step 9:** WhatsApp notification test (`node scripts/verify-whatsapp.js`)
- Investigate `saveBug` storage method issue in FailureHandler
- Review and triage the 1 failing scenario
