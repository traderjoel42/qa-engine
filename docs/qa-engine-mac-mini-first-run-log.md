# QA Engine — Mac Mini First Run: Implementation Log

**Date:** 2026-02-13
**Spec version:** v3.2 (`docs/qa-engine-mac-mini-first-run-spec.md`)
**Test suite:** 1840 tests, 43 suites — all passing after every change

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

---

## Issues Encountered
None. All 1840 tests passed after every change.

---

## Remaining Steps (from spec)

The following spec steps are **not code changes** — they require manual execution on the Mac Mini:

- **Step 5:** Set environment variable `BRAINSTORMY_TEST_PASSWORD` in `~/.zshrc`
- **Step 6:** Install Playwright browsers (`npx playwright install chromium`)
- **Step 7:** First smoke run: `node cli/index.js test --app brainstormy --agent healer --mode smoke --skip-bug-detection`
- **Step 8:** Evaluate results — check exit code, review evidence screenshots, verify Clerk auth flow
- **Step 9:** Iterate on selectors/timeouts if needed based on run results
