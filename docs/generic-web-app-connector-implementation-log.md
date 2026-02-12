# GenericWebAppConnector Implementation Log

**Spec:** docs/generic-web-app-connector-implementation-spec.md
**Started:** 2026-02-11

---

## Task 1: Extend Mock Helpers (Step 1)

**Status:** Complete
**Commit:** 399109b
**Files changed:** `tests/helpers/mock-playwright.js` (modified, 82 insertions, 4 deletions)

**What was done:**
- Extended `createMockPage()` with 9 new jest.fn() Playwright methods:
  - `goto`, `click`, `fill`, `selectOption`, `waitForSelector`, `waitForLoadState`, `waitForTimeout`, `$`, `$$`
- Applied feasibility observation #2: Converted `url` and `title` from manual functions to `jest.fn()` for per-test mockReturnValue control
- Added `createMockElement()` factory:
  - `evaluate` returns `Promise.resolve(fn(mockEl))` (feasibility observation #3: matches Playwright's Promise-returning API)
  - Mock element exposes textContent, value, innerHTML, attributes
- Added `createMockAppConfig()` factory:
  - `auth_indicator` and `ready_indicator` at config top-level (feasibility observation #4: deliberate design distinction from interaction selectors)
  - Full auth config: type, required, login_url, credentials (email + password_env)
  - Selectors: login_email, login_password, login_submit, logout
  - Timeouts: ai_response (60s), navigation (30s)
- Preserved manual implementations for `on`, `off`, `_emit`, `screenshot` (event emitter + filesystem behavior)
- Exports updated: added `createMockElement`, `createMockAppConfig`

**Backward compatibility validation:**
- EvidenceCollector tests: 75/75 pass (url/title jest.fn() conversion is transparent)
- BaseConnector tests: 51/51 pass (uses its own local mock page factory)
- Full suite: 126 tests, 0 failures

---

## Task 2: Implement GenericWebAppConnector (Step 2a)

**Status:** Complete
**Commit:** 5dde4f0
**Files changed:** `connectors/generic-web-app/connector.js` (new, 544 lines)

**What was done:**
- Implemented full GenericWebAppConnector class per spec Section 6
- Lifecycle: `initialize()` navigates to base URL, authenticates if required, waits for ready indicator; `cleanup()` logs out if authenticated, clears state (each step independently try/caught)
- Authentication: `authenticate()` reads password from `process.env[auth.credentials.password_env]`, fills email/password selectors, clicks submit, verifies via `isAuthenticated()`; `logout()` clicks logout selector if exists; `isAuthenticated()` checks auth_indicator or URL fallback
- Navigation: `navigate()` handles relative/absolute URLs; `waitForNavigation()` waits for networkidle
- Applied feasibility observation #1: `navigate()` guards `getBaseURL()` returning undefined — throws `NavigationError('Base URL not configured')` instead of producing `"undefined/path"` URL
- Interactions: `performAction()` evidence-wrapping dispatcher (before/switch/after/failure); `click()` with 500ms settle pause; `type()` via page.fill; `select()` via page.selectOption; `waitFor()` via page.waitForSelector
- Data extraction: `extractData()` returns text/value/html/attributes (null if missing); `extractMultiple()` returns textContent array; `exists()` never throws
- Helpers: `waitForAppReady()` waits for ready_indicator; `_wrapPlaywrightError()` converts Playwright errors to QA Engine hierarchy with `instanceof ConnectorError` pass-through

**Validation:**
- Module loads correctly, all methods are functions
- Inherits from BaseConnector (instanceof check passes)
- Inherited methods (getSelector, collectEvidence, etc.) accessible

---

## Task 3: Implement GenericWebAppConnector Tests (Step 2b)

**Status:** Complete
**Commit:** 8f01ea9
**Files changed:** `tests/connectors/generic-web-app-connector.test.js` (new, 1052 lines)

**What was done:**
- 99 unit tests across 17 describe blocks, all passing
- Constructor / Instantiation: 4 tests (direct instantiation, BaseConnector inheritance, references, _initialized)
- initialize(): 7 tests (base URL navigation, auth when required, skip auth, ready indicator wait, _initialized flag, AuthenticationError, NavigationError)
- cleanup(): 6 tests (logout when authenticated, skip when not, state clear, _cleanedUp flag, fault tolerance x2)
- authenticate(): 11 tests (login page nav, email fill, password from env, submit click, navigation wait, success return, state set, no config, unsupported type, missing env var, missing selectors)
- logout(): 5 tests (click when exists, navigation wait, no-op x2, state set)
- isAuthenticated(): 5 tests (indicator exists/missing, URL fallback, /login check x2)
- navigate(): 5 tests (relative path, absolute URL, network idle wait, NavigationError, base URL guard)
- waitForNavigation(): 3 tests (networkidle, custom timeout, ConnectorTimeoutError)
- performAction(): 13 tests (before/after/failure evidence, 8 dispatch cases, unknown action, error re-throw)
- click(): 3 tests (page.click, 500ms settle, error wrapping)
- type(): 2 tests (page.fill, error wrapping)
- select(): 2 tests (page.selectOption, error wrapping)
- waitFor(): 3 tests (waitForSelector, default timeout, timeout error)
- extractData(): 3 tests (full data extraction, null for missing, evaluate failure)
- extractMultiple(): 3 tests (textContent array, empty array, error wrapping)
- exists(): 3 tests (true, false, false on error)
- waitForAppReady(): 3 tests (with indicator, custom timeout, no-op)
- _wrapPlaywrightError(): 12 tests (pass-through, TimeoutError by name, Timeout by message, waiting for selector, Element is not, Target closed, net::, ERR_, unknown, recoverable flags, action/selector preservation)
- Inherited methods: 6 smoke tests (getCurrentURL, takeScreenshot, collectEvidence, getSelector, getTimeout, getBaseURL)

**Test infrastructure:**
- `createConnector()` helper factory using shared `createMockAppConfig`, `createMockPage`, local `createMockEvidence`
- `process.env.TEST_APP_PASSWORD` set/cleaned in beforeEach/afterEach for auth tests

**Results:**
```
Test Suites: 1 passed, 1 total
Tests:       99 passed, 99 total
Time:        0.183s
```

---

## Task 4: Final Validation (Step 3)

**Status:** Complete

**All validation checks passed:**

1. `npm test` — 225/225 tests pass (3 suites), 0 failures, 0.32s
2. `node -e "const GWAC = require('./connectors/generic-web-app/connector'); ..."` — Inherits BaseConnector, all methods are functions
3. Backward compatibility: EvidenceCollector (75) + BaseConnector (51) tests unaffected by mock changes

---

## Implementation Summary

**All tasks complete.** GenericWebAppConnector implementation matches spec + all 4 feasibility observations applied.

| File | Lines | Purpose |
|------|-------|---------|
| `tests/helpers/mock-playwright.js` | 165 | Extended: +9 page methods, +createMockElement, +createMockAppConfig |
| `connectors/generic-web-app/connector.js` | 544 | GenericWebAppConnector — all 15 BaseConnector abstract methods + helpers |
| `tests/connectors/generic-web-app-connector.test.js` | 1052 | 99 unit tests across 17 describe blocks |

**Feasibility observations applied:**
1. `navigate()` guards `getBaseURL()` returning undefined
2. Mock `url`/`title` converted to `jest.fn()` for per-test control
3. `createMockElement.evaluate` returns `Promise.resolve()` matching Playwright API
4. `auth_indicator`/`ready_indicator` at config top-level (confirmed as deliberate design)

**Test results:**
```
Test Suites: 3 passed, 3 total
Tests:       225 passed, 225 total (51 BaseConnector + 75 EvidenceCollector + 99 GenericWebAppConnector)
```

**Next steps per spec Section 11:**
- AIAppConnector (extends GenericWebAppConnector with chat-specific actions: send_message, wait_for_response, get_conversation, validate_memory)
- BrainstormyConnector (extends AIAppConnector with Brainstormy-specific helpers)
- Integration test: verify full chain with a live Playwright page against a local test server
