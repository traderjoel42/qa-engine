# Expanded Smoke Scenarios Implementation Log

**Phase:** QA Engine Phase 2 — Task 2
**Spec:** `docs/expanded-smoke-scenarios-spec.md` v1.2
**Started:** February 14, 2026
**Machine:** Mac Mini (darwin arm64)

---

## Task 0: Pre-existing Bug Fixes ✅

**Commit:** `f1009d6`
**Status:** Complete

### Changes
1. **`agents/base-agent.js`** — Fixed `element_text_contains` assertion: `extractData()` returns `{text, value, html, attributes}` object, not a plain string. Added `text = text?.text ?? null;` after the call.
2. **`connectors/generic-web-app/connector.js`** — Fixed `wait` action: added selector resolution via `this.getSelector(params.selector) || params.selector` so logical selector names resolve correctly.
3. **`tests/agents/base-agent.test.js`** — Updated test mocks to return `{text, value, html, attributes}` objects matching real `extractData()` return shape.

### Validation
- All 1842 tests pass (`npm test`)

---

## Task 1: Rename smoke-02 + Add Metadata ✅

**Commit:** `0fc9c73`
**Status:** Complete

### Changes
1. **`apps/brainstormy/scenarios/smoke-tests.json`** — Renamed `smoke-02-navigate-project` to `smoke-02-sidebar-loaded`. Restored sidebar-check behavior: asserts `sidebarProjects` selector on `/` instead of `newProjectButton` on `/projects` (avoids SPA hydration issues). Added `"group": "independent"` and `"order"` fields to both existing scenarios.

### Validation
- All 1842 tests pass (`npm test`)
- No code references to old `smoke-02-navigate-project` ID (only doc files)

---

## Task 2: Connector Changes ✅

**Commit:** `34b47b6`
**Status:** Complete

### Changes
1. **`connectors/brainstormy/connector.js`** — 2a: Added `navigate_to_project` to `brainstormyActions` array + switch case with state fallback. Extracted to `navigateToProject(projectId)` method.
2. **`connectors/brainstormy/connector.js`** — 2b: Added `|| this.getState('current_story_id')` fallback to `navigate_to_story` switch case.
3. **`connectors/brainstormy/connector.js`** — 2c: Added `|| this.getState('current_session_id')` fallback to `navigate_to_session` switch case. Added UUID detection in `navigateToSession()` for direct navigation.
4. **`connectors/ai-chat-app/connector.js`** — 2d: Added `this.setState('last_ai_response', responseData.text || '')` in `waitForAIResponse()`. BrainstormyConnector override calls `super`, so it inherits this.

### Validation
- All 1842 tests pass (`npm test`)

---

## Task 3: Group-Aware Scenario Runner ✅

**Commit:** `5f307fd`
**Status:** Complete

### Changes
1. **`agents/base-agent.js` — `runTests()`**: Sort scenarios by group priority (`independent`=0, `setup`=1, `test`=2) then by `order`. Track `setupFailed` flag. When a setup scenario fails/errors, skip remaining setup + all test scenarios with `skipped_dependency` status (full 10-field result shape).
2. **`agents/base-agent.js` — `_computeSummary()`**: Added `skipped_dependency` count as distinct status.
3. **`core/engine/test-orchestrator.js` — `_aggregateSummary()`**: Folds `skipped_dependency` into `skippedScenarios` count for summary reporting.
4. **`tests/agents/base-agent.test.js`**: Updated `_computeSummary` test expectations to include `skipped_dependency: 0`.

### Feasibility fixes applied
- Runner skip logic: skips both remaining setup and all test scenarios (`scenario.group === 'setup' || scenario.group === 'test'`)
- skipped_dependency result shape: includes all 10 fields matching `runScenario()` return shape
- groupPriority default: `?? 0` (not `?? 1`)
- Orchestrator summary: folds `skipped_dependency` into `skipped`

### Validation
- All 1842 tests pass (`npm test`)

---

## Task 4: Add New Selectors to app.config.json ✅

**Commit:** `80b203c`
**Status:** Complete

### Changes
1. **`apps/brainstormy/app.config.json`** — Added 11 new selectors: `projectHeading`, `projectList`, `projectCard`, `storyHeading`, `storyList`, `storyCard`, `messageList`, `userMessageLast`, `assistantMessageLast`. All use `data-testid` primary with CSS class fallbacks. Existing 7 calibrated selectors preserved unchanged.

### Calibration notes
- `userMessageLast` and `assistantMessageLast` use `[data-testid]:last-of-type` — may need calibration during Task 6 if messages share the same HTML tag
- All CSS fallback values are placeholders requiring staging verification

### Validation
- All 1842 tests pass (`npm test`)

---

## Task 5: Add Six New Scenarios to smoke-tests.json ✅

**Commit:** `159b4e9`
**Status:** Complete

### Changes
1. **`apps/brainstormy/scenarios/smoke-tests.json`** — Added 6 new scenarios:
   - `smoke-03-create-project` (setup, order 3) — project creation + redirect + heading check
   - `smoke-04-create-story` (setup, order 4) — story creation with novel vertical
   - `smoke-05-create-session` (setup, order 5) — explore session + chat interface load
   - `smoke-06-send-message` (test, order 6) — send message + user message visible
   - `smoke-07-ai-response` (test, order 7) — send + wait_for_response + assistant message + state
   - `smoke-08-hierarchy-navigation` (test, order 8) — project → story → session navigation

### Pre-merge checklist
- ✅ All action names snake_case
- ✅ All step_succeeded use stepIndex
- ✅ All selectors camelCase matching app.config.json
- ✅ Plain JSON array
- ✅ depends_on chains reference smoke-02-sidebar-loaded
- ✅ Groups correct (independent/setup/test)
- ✅ Orders sequential 1-8

### Validation
- All 1842 tests pass (`npm test`)

---

## Task 6: Integration Test Against Staging ✅

**Status:** Complete — 8/8 passing, 3 consecutive green runs

### Run 001 — Initial Baseline
**Date:** 2026-02-14
**Commit:** `159b4e9` (Task 5)

| Scenario | Status | Duration | Notes |
|----------|--------|----------|-------|
| smoke-01-login | ❌ | timeout | `page.goto` navigate timeout (90s) — Render cold start |
| smoke-02-sidebar-loaded | ❌ | timeout | Same navigate timeout |
| smoke-03-create-project | ❌ | error | SPA crash on `page.goto('/projects')` |
| smoke-04 through smoke-08 | ⏭️ | skipped | Dependency cascade |

**Result:** 0/8 passed
**Fix:** Increased navigate timeout to 120s in GenericWebAppConnector

### Run 002 — Navigate Fix
**Date:** 2026-02-14

| Scenario | Status | Duration | Notes |
|----------|--------|----------|-------|
| smoke-01-login | ✅ | ~5s | |
| smoke-02-sidebar-loaded | ❌ | error | `[data-testid='sidebar-projects']` not found — no data-testid in DOM |
| smoke-03-create-project | ❌ | error | SPA crash: `page.goto('/projects')` kills React |
| smoke-04 through smoke-08 | ⏭️ | skipped | Dependency cascade |

**Result:** 1/8 passed
**Findings:** Zero data-testid attributes in staging DOM. All selectors need CSS class calibration. Creation flow uses 2-step modal, not `/projects` route.

### Run 003 — Full Selector & Connector Rewrite
**Date:** 2026-02-14
**Commit:** `d54e491`
**Changes:** Rewrote all 55+ selectors to CSS classes. Rewrote `createProject()` for 2-step modal. Adapted create/navigate methods for `/chat/{uuid}` URLs. Added `dismissOverlays()`.

| Scenario | Status | Duration | Notes |
|----------|--------|----------|-------|
| smoke-01-login | ✅ | ~5s | |
| smoke-02-sidebar-loaded | ✅ | ~4s | |
| smoke-03-create-project | ✅ | ~12s | |
| smoke-04-create-story | ✅ | ~0.5s | Auto-creation returns existing |
| smoke-05-create-session | ✅ | ~0.5s | Auto-creation returns existing |
| smoke-06-send-message | ❌ | 30s | Chat readonly without API key |
| smoke-07-ai-response | ❌ | 120s | Same — no OpenRouter API key configured |
| smoke-08-hierarchy-navigation | ✅ | ~8s | |

**Result:** 6/8 passed
**Findings:** Chat requires OpenRouter API key. `BRAINSTORMY_OPENROUTER_KEY` exists in `.env`.

### Run 004 — API Key + Chat Selector Fixes
**Date:** 2026-02-14
**Changes:** Added `configureApiKey()` method. Fixed `chatSend` (`.message-input__button`), `chatInput` (`.message-input__textarea`), `userMessageLast`/`assistantMessageLast` (removed `:last-child`). Added wait steps before send_message.

| Scenario | Status | Duration | Notes |
|----------|--------|----------|-------|
| smoke-01-login | ✅ | ~5s | |
| smoke-02-sidebar-loaded | ✅ | ~5s | |
| smoke-03-create-project | ✅ | ~12s | |
| smoke-04-create-story | ✅ | ~0.5s | |
| smoke-05-create-session | ✅ | ~0.5s | |
| smoke-06-send-message | ✅ | ~2.4s | |
| smoke-07-ai-response | ✅ | ~16s | |
| smoke-08-hierarchy-navigation | ✅ | ~11s | |

**Result:** 8/8 passed

### Run 005 & 006 — Stability Confirmation
**Date:** 2026-02-14

| Run | Result | smoke-07 Duration | Total Duration |
|-----|--------|-------------------|----------------|
| 005 | 8/8 ✅ | 15818ms | ~53s |
| 006 | 8/8 ✅ | 17467ms | ~56s |

**3 consecutive green runs confirmed.**

---

## Phase 7: Post-Stabilization Assessment

### Task 7 Assessment: Frontend data-testid Attributes

All selectors use stable BEM class naming conventions. Only `userMenu` (Clerk's `.cl-userButtonTrigger`) is genuinely fragile as a third-party dependency.

**Recommendation:** Task 7 can be **deferred**. CSS selectors are sufficiently stable for ongoing test execution.

### Task 8 Assessment: Cleanup Action

Test data accumulation: ~1 project per run, identifiable by `QA Smoke Test Project` + timestamp prefix.

**Recommendation:** Task 8 is **low priority**. Test data accumulation is modest and doesn't interfere with execution. Implement when project count becomes a concern.

---
