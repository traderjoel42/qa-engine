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
