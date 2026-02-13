# Brainstormy Connector & Scheduling Implementation Log

**Spec:** `docs/brainstormy-connector-and-scheduling-spec.md` (v1.2)
**Started:** February 13, 2026

---

## Step 1: Verify Project Structure

- **Status:** done
- **Changes:**
  - Verified `connectors/ai-chat-app/connector.js` exists
  - Verified `connectors/base-connector.js` exists
  - Verified `connectors/brainstormy/connector.js` exists (422 lines, will be diff-merged)
  - Verified `apps/brainstormy/app.config.json` exists (will be replaced)
  - Verified `apps/brainstormy/scenarios/` directory exists (empty)
  - Verified `scripts/` directory exists (empty)
  - All prerequisite files and directories in place — no creation needed
- **Deviations:** None

---

## Step 2: Implement selectors.js

- **Files created:** `connectors/brainstormy/selectors.js`
- **Status:** done
- **Changes:**
  - Created DEFAULT_SELECTORS with 47 camelCase selector keys
  - Added `sessionSummaryButton` selector (from evaluation note: existing connector uses `session_summary_button`, mapped to camelCase)
  - Selector priority: data-testid > role/aria > CSS class fallback
  - Verification: `node -e "require('./connectors/brainstormy/selectors')"` — 47 selectors defined
- **Deviations:** Added `sessionSummaryButton` not in spec's selectors.js — needed to support existing connector's `getSessionSummary()` which clicks a summary button before reading content

---

## Step 3: Diff-Merge connector.js

- **Files modified:** `connectors/brainstormy/connector.js`
- **Status:** done
- **Changes:**
  - Diff-merged existing 422-line connector with spec target → 1,018 lines
  - **KEPT** from existing: `_extractIdFromUrl()` (with added `connector.config` path fallback), `waitForAIResponse()` (citation decoration), `extractCitations()` (updated selector key to `reportCitation`), `ConnectorError` usage throughout
  - **ADDED:** Constructor with state tracking (`currentProjectId`, `currentStoryId`, `currentSessionId`, `createdEntities`), `initialize()`, `authenticate()` (Clerk email/password), `cleanup()`, expanded `performAction()` with 17 action types, `endSession()`, `navigateToSession()`, `getStoryBible()`, `extractBibleSections()`, `generateReport()`, `getReport()`, `performSearch()`, `createBookmark()`, `getBookmarks()`, `setupTestProject()`, `archiveTestData()`, `getSelector()` override, `getTimeout()` override, `waitForAppReady()` override, `getEnvironment()`
  - **RECONCILED:** All selector keys converted to camelCase, uses wrapper methods (`this.click()`, `this.type()`, `this.select()`, `this.waitFor()`, `this.extractData()`), `_extractIdFromUrl()` checks both `this.app.config?.url_patterns` and `this.app.connector?.config?.url_patterns`
  - Key selector renames: `new_project_button`→`newProjectButton`, `story_bible_button`→`bibleTab`, `bible_template_prefix`→`bibleTemplateSelect`, `generate_bible_button`→`bibleGenerateButton`, `bible_content`→`bibleSection`, `session_summary_button`→`sessionSummaryButton`, `summary_content`→`sessionSummaryContent`, `citation_element`→`reportCitation`
  - Verification: All 4 checks PASS (performAction, createProject, generateStoryBible, performSearch)
- **Deviations:**
  - Used wrapper methods (`this.click()`, `this.type()`, etc.) instead of spec's direct `this.page.*` calls — preserves existing error handling and evidence collection
  - Added `sessionSummaryButton` click in `getSessionSummary()` to match existing connector pattern
  - Enhanced `_extractIdFromUrl()` with dual path fallback (`app.config` + `app.connector.config`)

---

## Step 4: Verify ConnectorFactory

- **Status:** done
- **Changes:**
  - Verified `connectors/factory.js` has `'brainstormy'` in `CONNECTOR_REGISTRY`
  - `factory.getRegisteredTypes()` returns `['generic', 'ai-chat-app', 'brainstormy']` — PASS
  - No modifications needed
- **Deviations:** None

---

## Step 5: Create app.config.json

- **Files modified:** `apps/brainstormy/app.config.json`
- **Status:** done
- **Changes:**
  - Replaced existing config (had `connector.type: "ai-chat-app"` and snake_case selectors)
  - New config has `connector.type: "brainstormy"`, 43 camelCase selectors, 7 timeouts, 2 environments (staging/production)
  - Added `auth.required: true` and `testProjectName: "QA Test Project"`
  - Verification: All 5 checks PASS (id, baseUrl, connector type, auth config, camelCase selectors)
- **Deviations:** None — implemented verbatim from spec

---

## Step 6: Write connector tests

- **Files modified:** `tests/connectors/brainstormy-connector.test.js`, `tests/helpers/mock-playwright.js`, `connectors/brainstormy/connector.js`
- **Status:** done
- **Changes:**
  - Rewrote test file for new connector (was 978 lines for old connector, now 487 lines for new)
  - Updated `createBrainstormyAppConfig()` in mock-playwright.js: camelCase selectors, new config shape with `connector.config.selectors`, environments use `url` (matching `getBaseURL()`)
  - Fixed `getSelector()` in connector.js: added snake_case→camelCase fallback for backward compatibility with parent classes (AIAppConnector uses `chat_input`, we store as `chatInput`)
  - 39 tests across 10 describe blocks: constructor (2), initialize (5), authenticate (5), performAction (8), createProject (4), createStory (3), createSession (3), generateStoryBible (4), performSearch (3), cleanup (2)
- **Test count:** 39 tests passing (spec estimated 25)
- **Regression check:** All 264 connector tests passing (5 test suites)
- **Deviations:**
  - Added snake_case→camelCase conversion in `getSelector()` so parent classes (AIAppConnector, GenericWebAppConnector) can still resolve selectors using their snake_case keys
  - Test count 39 vs spec estimate of 25 — more thorough coverage of new methods

---

## Step 7: Create scenario JSON files

- **Files created:** `apps/brainstormy/scenarios/smoke-tests.json`, `apps/brainstormy/scenarios/memory-tests.json`, `apps/brainstormy/scenarios/bible-tests.json`
- **Status:** done
- **Changes:**
  - smoke-tests.json: 5 scenarios (login, navigate, session+chat, search, navigation)
  - memory-tests.json: 5 scenarios (single-session recall, cross-session, search recall, summary capture, bookmark context)
  - bible-tests.json: 4 scenarios (generate standard, sections populated, outline report with citations, citation validity)
  - Verification: All 3 files valid JSON, 14 total scenarios
- **Deviations:** None — implemented verbatim from spec

---

## Step 8: Integration test — connector + scenario loader

- **Status:** done
- **Changes:**
  - Verified all scenario actions resolve to strings: `navigate, setup_test_project, create_story, create_session, send_message, wait_for_response, search` — PASS
  - No new files needed
- **Deviations:** None

---

## Step 9: Verify connector works with mock page

- **Status:** done
- **Changes:**
  - Ran `npm test -- tests/connectors/brainstormy-connector.test.js --verbose` — 39 tests passing
  - All performAction routes work with mock page
- **Deviations:** None

---

## Step 10: Mock factories

- **Status:** done (already exist)
- **Changes:**
  - Mock factories already exist at `tests/helpers/mock-playwright.js` (updated in Step 6)
  - Contains: `createMockPage()`, `createMockElement()`, `createMockCitationElement()`, `createBrainstormyAppConfig()`, `createMockConsoleMessage()`, `createMockRequest()`, `createMockResponse()`
  - Mock evidence collector is defined locally in each test file (following existing pattern)
  - Spec's `createMockOrchestrator()` and `createTestDb()` will be created in-line in Steps 12-14 (scheduler/repository test files)
- **Deviations:** Spec verification path `tests/mocks/playwright-page` doesn't exist — project uses `tests/helpers/mock-playwright.js` instead. No new directory created.

---

## Step 11: Create migration 002_scheduled_runs.sql

- **Files created:** `core/database/migrations/002_scheduled_runs.sql`
- **Status:** done
- **Changes:**
  - Created migration with `scheduled_runs` table (16 columns), 2 indexes (`idx_scheduled_runs_app`, `idx_scheduled_runs_enabled`)
  - Updated `tests/database/schema.test.js`: table count 8→9, added new indexes in alphabetical order, migration version 1→2
  - Verification: `PASS - scheduled_runs table created`
- **Deviations:** None — implemented verbatim from spec

---

## Step 12: Implement ScheduledRunRepository

- **Files created:** `core/database/repositories/scheduled-run-repository.js`
- **Files modified:** `core/database/index.js`, `tests/database/repositories.test.js`
- **Status:** done
- **Changes:**
  - Created `ScheduledRunRepository extends BaseRepository` with: `getEnabled()`, `getAll()`, `getByApp()`, `getById()`, `create()`, `updateLastRun()`, `setEnabled()`, `updateCron()`, `delete()`
  - Registered as `scheduledRuns` in `createDatabase()` and module exports
  - 10 tests: create (1), getById (1), getEnabled (1), getAll (1), getByApp (1), updateLastRun (1), setEnabled (1), updateCron (1), delete (1), defaults (1)
- **Test count:** 10 tests passing
- **Deviations:** Used `this._connection` instead of `this.connection` to match BaseRepository's internal field name

---

## Step 12b: Add getRunsSince() to TestRunRepository

- **Files modified:** `core/database/repositories/test-run-repository.js`, `tests/database/repositories.test.js`
- **Status:** done
- **Changes:**
  - Added `getRunsSince(appId, sinceIso)` method — queries test_runs where `app_id = ? AND started_at >= ?`, ordered DESC
  - 4 tests: returns runs after timestamp (1), filters by app_id (1), empty array when no match (1), orders DESC (1)
- **Test count:** 4 new tests (53 total in repositories.test.js)
- **Regression check:** All 128 database tests passing (6 test suites)
- **Deviations:** None — implemented verbatim from spec

---

## Step 13: Implement Scheduler (core/scheduler.js)

- **Files created:** `core/scheduler.js`
- **Status:** done
- **Changes:**
  - Created `Scheduler extends EventEmitter` (384 lines)
  - Constructor: accepts `scheduledRunRepo`, `orchestrator`, `notifier`, `testRunRepo`, `loadAppConfig`, `defaultRecipient`
  - State: `activeTasks` (Map), `executing` (Set), `running` (boolean)
  - Core methods: `start()`, `stop()`, `registerTask()`, `executeSchedule()`, `formatCompletionMessage()`, `sendDailyDigest()`
  - Management methods: `createSchedule()`, `pauseSchedule()`, `resumeSchedule()`, `runNow()`, `updateCron()`, `listSchedules()`
  - Events emitted: `schedule:started`, `schedule:completed`, `schedule:error`, `digest:sent`
  - Uses `node-cron` for task scheduling, validates cron expressions before registering
  - Prevents concurrent execution of the same schedule via `this.executing` Set
  - `executeSchedule()` routes `test_mode === 'digest'` to `sendDailyDigest()` before emitting `schedule:started`
  - Calls `this.orchestrator.run(appConfig, options)` — NOT `runTests()` (as per spec critical notes)
  - Repository calls are synchronous (matching SQLite/better-sqlite3 pattern)
  - Verification: `node -e "require('./core/scheduler')"` — loads without error
- **Deviations:** None — implemented verbatim from spec

---

## Step 14: Write scheduler tests

- **Files created:** `tests/core/scheduler.test.js`
- **Status:** done
- **Changes:**
  - 30 tests across 6 describe blocks:
    - `start()` (4): loads schedules, registers tasks, sets running flag, warns if already running
    - `stop()` (3): stops all tasks, clears map, sets running false
    - `registerTask()` (4): validates cron, logs error for invalid, stops existing before re-register, creates task
    - `executeSchedule()` (9): prevents concurrent, start notification, orchestrator.run call, updates tracking, completion notify, notify_only_failures, error handling, finally cleanup, digest routing
    - `sendDailyDigest()` (4): aggregates runs, formats message, zero runs, emits event
    - Schedule management (6): create, pause, resume, runNow, updateCron, list
  - Mock factories: `createMockScheduledRunRepo()`, `createMockOrchestrator()`, `createMockNotifier()`, `createMockTestRunRepo()`, `createMockSchedule()`
  - Added `activeSchedulers` array + `afterEach` cleanup to prevent Jest hanging from open cron handles
  - Fixed `console.error` assertion — scheduler passes single template literal string, not two arguments
- **Test count:** 30 tests passing (spec estimated 22)
- **Regression check:** All 1,817 tests passing (42 test suites)
- **Deviations:**
  - Test count 30 vs spec estimate of 22 — more thorough coverage
  - Added `--forceExit` flag needed due to node-cron background timers; mitigated with afterEach cleanup
