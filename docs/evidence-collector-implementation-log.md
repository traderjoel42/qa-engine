# Evidence Collector Implementation Log

**Spec:** docs/evidence-collector-implementation-spec.md (v1.2)
**Started:** 2026-02-11

---

## Task 1: Directory Structure and Mock Helpers

**Status:** Complete
**Commit:** 1cb9c2e
**Files changed:** `tests/helpers/mock-playwright.js` (new)

**What was done:**
- Created `tests/engine/` directory (empty, for upcoming test files)
- Created `tests/helpers/` directory for shared test utilities
- Implemented `tests/helpers/mock-playwright.js` with 4 mock factories from spec Section 9:
  - `createMockPage()` — event emitter support (on/off/_emit), screenshot writes placeholder files to disk, url/title/viewportSize
  - `createMockConsoleMessage()` — type/text/location
  - `createMockRequest()` — synchronous `response: () => null` matching Playwright v1.58, timing with `{startTime, responseEnd}`
  - `createMockResponse()` — status/statusText/allHeaders (async)
- `core/engine/` directory already existed (empty) — no action needed

**Validation:**
- `node -e "require('./tests/helpers/mock-playwright')"` — exports all 4 factories correctly
- `createMockRequest().response()` returns `null` (synchronous, not Promise)

---

## Task 2: Implement core/engine/evidence-collector.js

**Status:** Complete
**Commit:** 5fbd203
**Files changed:** `core/engine/evidence-collector.js` (new, 504 lines)

**What was done:**
- Implemented full EvidenceCollector class per spec Section 7
- Constructor: sets up paths (`evidence/{appId}/{runId}/screenshots|logs|network`), initializes buffers and state
- Lifecycle: `initialize(page)` attaches 3 Playwright listeners, `cleanup()` awaits pending captures → writes logs/network/index to disk → removes listeners
- Public API (4 methods matching BaseConnector contract):
  - `captureScreenshot(page, name)` — full-page + viewport screenshots, returns full path or null
  - `getConsoleLogs()` — returns shallow copy of accumulated log buffer
  - `getNetworkRequests()` — returns shallow copy of accumulated network buffer
  - `collectAll(page, stepName)` — screenshot + buffers + page metadata + summary counts
- Event listeners: `_onConsoleMessage` (sync), `_onRequestFinished` (async via `_captureRequest` with pending tracking), `_onRequestFailed` (sync)
- Storage: `_ensureDirectories` (idempotent), `_writeIndex` (summary JSON)
- Utilities: `_sanitizeName` (filesystem-safe, 50 char limit), `_redactHeaders` (6 sensitive header patterns)
- Timing: `responseEnd - startTime` with guards for null/negative values
- Async race condition: `_pendingCaptures` array tracked, awaited in `cleanup()` via `Promise.allSettled`

**Validation:**
- Module loads correctly, all 4 public methods are functions
- Path computation verified: `evidence/test/test/screenshots`

---

## Task 3: Implement tests/engine/evidence-collector.test.js

**Status:** Complete
**Commit:** 241cda0
**Files changed:** `tests/engine/evidence-collector.test.js` (new, 854 lines)

**What was done:**
- 75 unit tests across 12 describe blocks, all passing
- Constructor: 5 tests (config storage, path computation, empty buffers, counter init, basePath default)
- initialize(): 5 tests (console/requestfinished/requestfailed listener attachment, _initialized flag, page reference)
- cleanup(): 10 tests (listener removal, pending capture await, console.json/requests.json/index.json write, state reset, idempotency, closed page handling)
- captureScreenshot(): 8 tests (directory creation, full/viewport capture, path return, counter increment, filename format, sanitization, null on failure)
- getConsoleLogs(): 4 tests (empty default, accumulation, shallow copy, error resilience)
- getNetworkRequests(): 4 tests (empty default, accumulation, shallow copy, error resilience)
- collectAll(): 9 tests (full package, screenshot paths, logs/network/metadata/summary inclusion, partial evidence, error field, closed page)
- clearBuffers(): 3 tests (log reset, network reset, counter preservation)
- Console Event Handling: 6 tests (level, message, timestamp, URL, stack trace, malformed message resilience)
- Network Event Handling: 11 tests (URL/method/status, duration calc, timing subtraction, status>=400 failure, failed request reason, header redaction x2, header preservation, null response, pending capture tracking)
- _sanitizeName(): 5 tests (special char replacement, underscore collapse, trim, truncation, hyphen preservation)
- _redactHeaders(): 6 tests (auth/cookie/x-api-key redaction, case insensitivity, non-sensitive preservation, null/undefined handling)

**Test infrastructure:**
- Uses `os.tmpdir()` for temporary evidence directories (cleaned up in afterAll)
- `createCollector()` helper factory with default runId/appId/basePath
- Shared mocks from `tests/helpers/mock-playwright.js`

**Results:**
```
Test Suites: 1 passed, 1 total
Tests:       75 passed, 75 total
Time:        0.335s
```

---

## Task 4: Update BaseConnector Test Mock and Assertion

**Status:** Complete
**Commit:** e2563d1
**Files changed:** `tests/connectors/base-connector.test.js` (modified)

**What was done (per spec Section 11 note 9):**
- Updated `createMockEvidence().collectAll` mock return value:
  - Changed `screenshot: '/evidence/test_step.png'` (singular string) to `screenshots: { full: '...', viewport: '...' }` (plural object)
  - Added `viewport` and `summary` fields to match real evidence package shape
- Updated `collectEvidence` test assertion (line ~237):
  - Changed `expect(result).toHaveProperty('screenshot')` to `expect(result).toHaveProperty('screenshots')`
  - Added sub-property checks: `expect(result.screenshots).toHaveProperty('full')` and `.toHaveProperty('viewport')`

**Validation:**
- All 51 BaseConnector tests still pass
- All 75 EvidenceCollector tests still pass
- Full suite: 126 tests, 0 failures

---

## Task 5: Final Validation (Spec Section 10 Step 3)

**Status:** Complete

**All three validation checks passed:**

1. `npm test` — 126/126 tests pass (2 suites), 0 failures, 0.275s
2. `node -e "const EC = require('./core/engine/evidence-collector'); ..."` — all 4 public methods are functions
3. `ec._ensureDirectories()` — creates `tmp-evidence/verify-app/verify-test/screenshots` successfully, cleanup OK

---

## Implementation Summary

**All tasks complete.** Evidence Collector implementation matches spec v1.2 exactly.

| File | Lines | Purpose |
|------|-------|---------|
| `tests/helpers/mock-playwright.js` | 86 | Shared Playwright mock factories (4 exports) |
| `core/engine/evidence-collector.js` | 504 | EvidenceCollector class — screenshot/log/network capture |
| `tests/engine/evidence-collector.test.js` | 854 | 75 unit tests across 12 describe blocks |
| `tests/connectors/base-connector.test.js` | +4 lines | Mock and assertion update for evidence package shape |

**Test results:**
```
Test Suites: 2 passed, 2 total
Tests:       126 passed, 126 total (51 BaseConnector + 75 EvidenceCollector)
```

**Next steps per spec Section 12:**
- GenericWebAppConnector (implements all BaseConnector abstract methods with Playwright, uses real EvidenceCollector)
- Integration test: verify BaseConnector → EvidenceCollector delegation end-to-end
- AIAppConnector (chat, memory, AI-response methods)
