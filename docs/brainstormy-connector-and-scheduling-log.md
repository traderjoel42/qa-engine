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
