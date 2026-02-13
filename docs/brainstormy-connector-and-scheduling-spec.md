# QA Engine Week 5 Days 3-5: Real Brainstormy Connector & Scheduling

**Version:** 1.2 (post-evaluation v2 fixes)  
**Date:** February 13, 2026  
**Author:** Joel (with Claude)  
**Status:** Ready for Implementation  
**Depends on:** qa-engine-03-connector-pattern-spec.md, whatsapp-bot-implementation-spec.md

---

## Overview

This specification covers the final three days of QA Engine Week 5:

- **Days 3-4:** Real Brainstormy Connector — a concrete `BrainstormyConnector` class that implements the connector pattern from `qa-engine-03-connector-pattern-spec.md` to test the actual Brainstormy application at `brainstormy.app` via Playwright browser automation against the staging environment.
- **Day 5:** Scheduling & Cron — automated scheduling for recurring test runs (nightly regression, periodic smoke tests) using `node-cron`, with persistence in SQLite and integration with the WhatsApp bot for notifications.

**Relationship to prior specs:** The connector pattern spec (`03`) defined the abstract interface (`BaseConnector → GenericWebAppConnector → AIAppConnector → BrainstormyConnector`) with placeholder method bodies. This spec provides the full, production-ready implementation with real selectors, real workflows, error recovery, and test data management. The scheduling spec adds the `core/scheduler.js` file referenced in the implementation plan (`05`).

---

## Part 1: Design Decisions

### D1: Playwright Browser Automation Over Direct API Calls

**Decision:** The Brainstormy connector uses Playwright to drive a real Chromium browser against `staging.brainstormy.app` rather than calling Brainstormy's REST API directly.

**Rationale:**
- Tests the actual user experience — CSS rendering, JavaScript hydration, real-time streaming
- Catches frontend-only bugs that API tests miss (broken layouts, missing event handlers, React state issues)
- Evidence collection (screenshots, console logs, network traces) requires a real browser
- Aligns with the connector pattern's `page` parameter contract from `BaseConnector`
- The QA Engine's value proposition is catching bugs a user would see, not just API contract verification

**Trade-off:** Slower test execution (~60-90s per scenario vs ~5s for API-only), but worth it for the coverage gap. Smoke tests complete in under 5 minutes.

---

### D2: Clerk Authentication via Email/Password Flow

**Decision:** Authenticate with Brainstormy's staging environment using a dedicated test account through Clerk's hosted email/password login form.

**Rationale:**
- Brainstormy uses Clerk for authentication, which presents a hosted sign-in component
- A dedicated `testbot@brainstormy.app` account with email/password auth avoids OAuth complexity
- The password is stored in `BRAINSTORMY_TEST_PASSWORD` environment variable, never in code
- Clerk's sign-in component uses iframes; selectors target Clerk's known DOM structure

**Alternative rejected:** Clerk session tokens injected via `page.context().addCookies()` — fragile because token format changes with Clerk versions.

---

### D3: Hybrid Selector Strategy — data-testid Preferred, Fallback to Semantic Selectors

**Decision:** Primary selectors use `data-testid` attributes where Brainstormy provides them. Where `data-testid` is absent, use semantic selectors (`role`, `aria-label`, text content) with CSS class fallbacks as last resort.

**Rationale:**
- `data-testid` attributes are stable across UI refactors
- Brainstormy's React codebase already includes some `data-testid` attributes
- Semantic selectors (`getByRole`, `getByText`) are the next most resilient
- CSS class selectors are fragile but necessary for Brainstormy components that lack ARIA annotations
- The selector map in `app.config.json` makes updates centralized when Brainstormy's UI changes

**Implementation:** Selectors live in the app config, not hardcoded in the connector. The connector calls `this.getSelector('chatInput')` which resolves from config.

---

### D4: Agent-to-Feature Mapping for Brainstormy

**Decision:** Each QA agent tests specific Brainstormy features:

| Agent | Brainstormy Features Tested | Test Mode |
|---|---|---|
| **Healer** | Login, navigation, project/story/session CRUD, basic chat send/receive, page loads | Smoke, Regression |
| **Sentinel** | Semantic search recall, cross-session memory, session summary persistence, bookmark context inclusion | Smoke, Full |
| **Librarian** | Story Bible generation + section accuracy, citation grounding in reports, report generation with valid citation maps | Full, Regression |
| **Quinn** | Edge cases: empty story queries, very long messages, rapid-fire sends, special characters, concurrent session navigation | Full only (Phase 3) |

**Rationale:**
- Healer covers "does the app load and work at all?" — fast, broad, run nightly
- Sentinel covers Brainstormy's core differentiator (memory persistence) — the most important competitive feature
- Librarian covers data accuracy in generated artifacts — critical for user trust
- Quinn is deferred to Phase 3 but the connector supports its action types now

---

### D5: Test Data Management — Dedicated Test Project with Cleanup

**Decision:** Tests operate within a dedicated "QA Test Project" in the staging environment. Before each test run, the connector verifies the test project exists (creates it if not) and creates fresh stories/sessions. After each run, test stories are archived (not deleted) for post-mortem analysis.

**Rationale:**
- Isolated test data prevents interference with manual staging testing
- Fresh stories per run ensure deterministic test conditions
- Archiving (renaming with `[QA-archived]` prefix) preserves evidence linkage
- A cleanup job purges archived test data older than 7 days

**Data flow:**
```
Before run: Verify/create "QA Test Project" → Create "QA-{timestamp}" story → Create sessions
During run: All actions scoped to test story
After run:  Rename story to "[QA-archived] QA-{timestamp}" 
Cleanup:    Weekly purge of archived stories > 7 days old
```

---

### D6: Brainstormy Data Model Mapping to Connector Interface

**Decision:** Map Brainstormy's three-tier hierarchy (Project → Story → Session) to the connector's generic `performAction` vocabulary:

| Connector Action | Brainstormy Operation |
|---|---|
| `create_entity` (type: project) | Navigate to /projects, click New, fill name |
| `create_entity` (type: story) | Within project, click New Story, fill name + vertical |
| `create_entity` (type: session) | Within story, click New Session, select type |
| `send_message` | Type in chat input, click send |
| `wait_for_response` | Wait for AI message element, wait for streaming to complete |
| `validate_memory` | Send a recall query, check response contains expected content |
| `generate_bible` | Navigate to Bible tab, select template, click Generate, wait for completion |
| `get_session_summary` | End session, navigate to session list, read summary text |
| `search` | Use search bar, submit query, extract results |
| `create_bookmark` | Click bookmark icon on message, fill title |
| `navigate_to_story` | Click story in sidebar navigation |
| `navigate_to_session` | Click session in session list |

---

### D7: Three Test Modes with Distinct Scenario Sets

**Decision:** Define three test modes with increasing scope:

| Mode | Duration | Agents | When Run |
|---|---|---|---|
| **smoke** | ~3 min | Healer (subset) | Pre-deploy, on-demand, hourly |
| **full** | ~15 min | Healer + Sentinel + Librarian | Nightly at 2:00 AM |
| **regression** | ~25 min | All agents + extended scenarios | Weekly Sunday 3:00 AM, post-fix verification |

**Smoke scenarios (5 tests):**
1. Login succeeds, dashboard loads
2. Navigate to existing project
3. Create session, send one message, receive response
4. Search returns results for known content
5. Navigate between story and session views

**Full scenarios (15+ tests):**
All smoke tests plus:
6. Create project → story → session (full CRUD)
7. Multi-message conversation (3 exchanges)
8. Memory recall: establish fact, new session, query fact
9. Cross-session search: find content from previous session
10. Session summary: end session, verify summary generated
11. Story Bible: generate standard template, verify sections populated
12. Bookmark: save message, verify appears in bookmark list
13. Report: generate outline report, verify citation map has valid IDs
14. Session summary content: verify summary reflects actual conversation
15. Bookmark inclusion: verify bookmarked content appears in search context

**Regression scenarios (25+ tests):**
All full tests plus:
16-20. Extended memory tests (5 facts across 5 sessions, recall all)
21. Bible regeneration (generate, add content, regenerate, compare versions)
22. Multiple bible templates (standard, hero's journey)
23. Report with character_name parameter
24. Search with minimum similarity threshold verification
25. Edge: session with no messages → end session → verify graceful handling

---

### D8: node-cron for Scheduling Over OS-level Cron

**Decision:** Use the `node-cron` npm package for in-process scheduling rather than OS-level crontab or macOS launchd.

**Rationale:**
- Runs within the QA Engine Node.js process — no external configuration needed
- Schedule definitions stored in SQLite alongside other QA Engine state
- Easy to modify schedules at runtime via WhatsApp commands ("change nightly to 3am")
- Cross-platform (works on Mac Mini for development, Linux for production)
- Integrates directly with the Test Orchestrator — no subprocess spawning

**Alternative rejected:** `launchd` (macOS only, requires plist management, harder to modify dynamically). The implementation plan's reference to `launchctl` was a placeholder; `node-cron` is superior for this use case.

**Dependencies:** `npm install node-cron` (~50KB, zero transitive deps, well-maintained).

---

### D9: Schedule Persistence in SQLite

**Decision:** Store schedule configurations in a `scheduled_runs` table in the existing SQLite database. The scheduler loads schedules on startup and watches for changes.

**Rationale:**
- Schedules survive process restarts
- Can be modified via WhatsApp commands or CLI without editing files
- Single source of truth alongside test runs and bugs
- Supports enable/disable without deleting the schedule

---

### D10: WhatsApp Integration for Schedule Notifications

**Decision:** The scheduler integrates with the WhatsApp bot established in Days 1-2 to:
1. Send notifications when scheduled runs start/complete
2. Accept commands to modify schedules ("pause nightly", "run full now")
3. Send a daily digest at 8:00 AM summarizing overnight test results

**Rationale:**
- Joel manages QA from his phone — scheduled run results must reach WhatsApp
- The WhatsApp bot from Days 1-2 already handles notifications via `NotificationAdapter`
- Daily digest prevents notification overload from nightly runs

---

### D11: Pre-Deploy Hook as Git Pre-Push Script

**Decision:** Provide a `scripts/pre-deploy.sh` shell script that runs smoke tests before allowing `git push`. This complements the cron-based scheduling with event-driven testing.

**Rationale:**
- Catches regressions before they reach staging
- Uses the same `TestOrchestrator.run()` entry point as scheduled runs
- Exits with non-zero code to block push if smoke tests fail
- Optional — developers can skip with `--no-verify`

---

## Part 2: Data Structures

### Brainstormy App Configuration

```javascript
/**
 * @typedef {Object} BrainstormyAppConfig
 * @property {string} id - 'brainstormy' (not app_id — matches existing convention)
 * @property {string} name - 'Brainstormy'
 * @property {string} type - 'ai-chat-app' (matches existing type, not 'ai-chat')
 * @property {string} baseUrl - 'https://staging.brainstormy.app'
 * @property {BrainstormyConnectorConfig} connector
 * @property {Object} [environments] - Optional per-environment overrides
 */

/**
 * @typedef {Object} BrainstormyConnectorConfig
 * @property {string} type - 'brainstormy' (resolves to BrainstormyConnector in ConnectorFactory)
 * @property {Object} config
 * @property {BrainstormyAuth} config.auth
 * @property {Object<string, string>} config.selectors - camelCase selector keys
 * @property {BrainstormyTimeouts} config.timeouts - camelCase timeout keys
 * @property {string} config.testProjectName - 'QA Test Project'
 */

/**
 * @typedef {Object} BrainstormyAuth
 * @property {string} type - 'email_password'
 * @property {boolean} required - true
 * @property {BrainstormyCredentials} credentials
 */

/**
 * @typedef {Object} BrainstormyCredentials
 * @property {string} email - 'testbot@brainstormy.app'
 * @property {string} passwordEnv - 'BRAINSTORMY_TEST_PASSWORD' (camelCase)
 */

/**
 * @typedef {Object} BrainstormySelectors
 * All keys use camelCase to match connector.config.selectors convention.
 * @property {string} clerkEmailInput - Clerk email input in sign-in form
 * @property {string} clerkPasswordInput - Clerk password input
 * @property {string} clerkSubmitButton - Clerk submit button
 * @property {string} userMenu - Logged-in user menu element
 * @property {string} sidebarProjects - Projects link in sidebar
 * @property {string} newProjectButton - Create project button
 * @property {string} projectNameInput - Project name input
 * @property {string} createProjectSubmit - Project creation submit
 * @property {string} newStoryButton - Create story button
 * @property {string} storyNameInput - Story name input
 * @property {string} storyVerticalSelect - Vertical selector dropdown
 * @property {string} createStorySubmit - Story creation submit
 * @property {string} newSessionButton - Create session button
 * @property {string} sessionTypeSelect - Session type selector
 * @property {string} createSessionSubmit - Session creation submit
 * @property {string} chatInput - Chat message input textarea
 * @property {string} chatSend - Send message button
 * @property {string} aiMessage - AI response message container
 * @property {string} userMessage - User message container
 * @property {string} generatingIndicator - Streaming/generating indicator
 * @property {string} searchInput - Search bar input
 * @property {string} searchSubmit - Search submit button
 * @property {string} searchResults - Search results container
 * @property {string} searchResultItem - Individual search result
 * @property {string} bibleTab - Story Bible tab/link
 * @property {string} bibleTemplateSelect - Bible template selector
 * @property {string} bibleGenerateButton - Generate bible button
 * @property {string} bibleSection - Bible section container
 * @property {string} bibleGeneratingIndicator - Bible generation progress
 * @property {string} reportTab - Reports tab/link
 * @property {string} reportTypeSelect - Report type selector
 * @property {string} reportGenerateButton - Generate report button
 * @property {string} reportContent - Report content container
 * @property {string} reportCitation - Citation element in report
 * @property {string} bookmarkButton - Bookmark message button
 * @property {string} bookmarkTitleInput - Bookmark title input
 * @property {string} bookmarkSaveButton - Bookmark save button
 * @property {string} bookmarksTab - Bookmarks list tab/link
 * @property {string} bookmarkItem - Individual bookmark in list
 * @property {string} sessionList - Session list container
 * @property {string} sessionItem - Individual session in list
 * @property {string} sessionSummaryContent - Session summary text
 * @property {string} endSessionButton - End session button
 * @property {string} storySidebarItem - Story item in sidebar nav
 * @property {string} logoutButton - Logout button
 */

/**
 * @typedef {Object} BrainstormyTimeouts
 * All keys use camelCase to match connector.config.timeouts convention.
 * @property {number} aiResponse - Max wait for AI response (ms), default 60000
 * @property {number} bibleGeneration - Max wait for bible gen (ms), default 120000
 * @property {number} reportGeneration - Max wait for report gen (ms), default 90000
 * @property {number} navigation - Max wait for page navigation (ms), default 30000
 * @property {number} search - Max wait for search results (ms), default 15000
 * @property {number} sessionSummary - Max wait for summary gen (ms), default 60000
 * @property {number} clerkAuth - Max wait for Clerk auth flow (ms), default 30000
 */
```

### Scheduled Run Configuration

```javascript
/**
 * @typedef {Object} ScheduledRun
 * @property {string} id - UUID
 * @property {string} app_id - App being tested
 * @property {string} name - Human-readable name, e.g. 'Nightly Full Suite'
 * @property {string} cron_expression - node-cron expression, e.g. '0 2 * * *'
 * @property {string} test_mode - 'smoke' | 'full' | 'regression'
 * @property {string[]} agents - Agent IDs to run, e.g. ['healer', 'sentinel']
 * @property {string} environment - 'staging' | 'production'
 * @property {boolean} enabled - Whether schedule is active
 * @property {boolean} notify_on_start - Send WhatsApp when run starts
 * @property {boolean} notify_on_complete - Send WhatsApp when run finishes
 * @property {boolean} notify_only_failures - Only notify if failures detected
 * @property {string} [last_run_at] - ISO timestamp of last execution
 * @property {string} [last_run_status] - 'passed' | 'failed' | 'error'
 * @property {string} created_at - ISO timestamp
 * @property {string} updated_at - ISO timestamp
 */

/**
 * @typedef {Object} ScheduleOverride
 * @property {string} schedule_id - Which schedule to modify
 * @property {string} action - 'pause' | 'resume' | 'run_now' | 'update_cron' | 'update_agents'
 * @property {Object} [params] - Action-specific parameters
 * @property {string} requested_by - 'whatsapp' | 'cli' | 'api'
 * @property {string} requested_at - ISO timestamp
 */

/**
 * @typedef {Object} DailyDigest
 * @property {string} date - ISO date string
 * @property {number} total_runs - Runs in last 24h
 * @property {number} total_tests - Tests executed
 * @property {number} total_passed - Tests passed
 * @property {number} total_failed - Tests failed
 * @property {number} pass_rate - Percentage
 * @property {BugSummary[]} new_bugs - Bugs created in last 24h
 * @property {string[]} failing_agents - Agents with failures
 * @property {string} formatted_message - WhatsApp-ready message
 */
```

---

## Part 3: Database Schema Additions

### Migration File: `core/database/migrations/002_scheduled_runs.sql`

> **Important:** Migrations live in `core/database/migrations/` as numbered `.sql` files.
> The existing `Migrator` class discovers and applies them automatically via `createDatabase()`.
> Do NOT add this SQL to `schema.sql` directly — use the migration file.

```sql
-- Migration 002: Add scheduled_runs table for cron-based test scheduling

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id TEXT PRIMARY KEY,  -- UUID as text for SQLite
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  
  -- Schedule definition
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  test_mode TEXT NOT NULL DEFAULT 'smoke',  -- 'smoke', 'full', 'regression'
  agents TEXT NOT NULL DEFAULT '[]',  -- JSON array of agent IDs
  environment TEXT NOT NULL DEFAULT 'staging',
  
  -- State
  enabled INTEGER NOT NULL DEFAULT 1,  -- SQLite boolean
  
  -- Notification preferences
  notify_on_start INTEGER NOT NULL DEFAULT 0,
  notify_on_complete INTEGER NOT NULL DEFAULT 1,
  notify_only_failures INTEGER NOT NULL DEFAULT 0,
  
  -- Tracking
  last_run_at TEXT,  -- ISO timestamp
  last_run_status TEXT,  -- 'passed', 'failed', 'error'
  last_run_id TEXT,  -- FK to test_runs.id
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scheduled_runs_app ON scheduled_runs(app_id);
CREATE INDEX idx_scheduled_runs_enabled ON scheduled_runs(enabled);
```

### Default Schedules (Seed Data)

```sql
-- Seed: Default schedules for Brainstormy
INSERT INTO scheduled_runs (id, app_id, name, cron_expression, test_mode, agents, environment, enabled, notify_on_complete)
VALUES 
  -- Nightly full suite at 2:00 AM
  ('sched-nightly-full', 'brainstormy', 'Nightly Full Suite', '0 2 * * *', 'full', 
   '["healer","sentinel","librarian"]', 'staging', 1, 1),
  
  -- Hourly smoke tests during business hours (9 AM - 6 PM)
  ('sched-hourly-smoke', 'brainstormy', 'Hourly Smoke Tests', '0 9-18 * * 1-5', 'smoke',
   '["healer"]', 'staging', 0, 0),
  
  -- Weekly regression on Sunday at 3:00 AM
  ('sched-weekly-regression', 'brainstormy', 'Weekly Regression', '0 3 * * 0', 'regression',
   '["healer","sentinel","librarian"]', 'staging', 1, 1),
  
  -- Daily digest at 8:00 AM
  ('sched-daily-digest', 'brainstormy', 'Daily Digest', '0 8 * * *', 'digest',
   '[]', 'staging', 1, 1);
```

---

## Part 4: BrainstormyConnector Implementation

> **⚠️ DIFF-MERGE, NOT REPLACEMENT:** The existing `connectors/brainstormy/connector.js` (422 lines)
> is already fully implemented with working `performAction()`, `createProject()`, `createStory()`,
> `createSession()`, `generateStoryBible()`, `performSearch()`, `createBookmark()`, `generateReport()`,
> `extractCitations()`, etc.
>
> **Do NOT replace the file wholesale.** Instead, diff-merge using these concrete decisions:
>
> **KEEP from existing file (do not overwrite):**
> - `_extractIdFromUrl()` helper — existing uses this, spec inlines regex. Keep the helper.
> - `waitForAIResponse()` override — decorates parent with citation extraction. Not in spec, must preserve.
> - `extractCitations()` method — used by waitForAIResponse. Not in spec, must preserve.
> - `ConnectorError` usage from `../errors` — keep structured errors, don't downgrade to plain `Error`.
>
> **ADD from spec (new functionality):**
> 1. Constructor state tracking (`currentProjectId`, `currentStoryId`, `currentSessionId`, `createdEntities`)
> 2. Clerk-specific authentication flow in `authenticate()`
> 3. `cleanup()` method with entity archiving
> 4. `setupTestProject()` and `archiveTestData()` methods
> 5. `getEnvironment()` with multi-environment support
> 6. `getSelector()` override for `connector.config.selectors` path resolution
> 7. `waitForAppReady()` override for `readyIndicator` resolution
> 8. New `performAction()` cases: `end_session`, `get_bible`, `get_report`, `get_bookmarks`, `setup_test_project`, `archive_test_data`
>
> **RECONCILE (existing + spec differ):**
> - Selector key casing: Existing uses snake_case (`'bible_tab'`), spec uses camelCase (`'bibleTab'`).
>   **Decision:** Convert to camelCase to match `app.config.json`. Update all `getSelector()` calls.
> - `createProject()/createStory()/createSession()`: Keep existing `_extractIdFromUrl()` calls,
>   but add the `this.currentProjectId = id` state tracking from the spec.
>
> The code below shows the complete target state. Claude Code should compare against the existing file
> and merge following the decisions above.

### File: `connectors/brainstormy/connector.js`

```javascript
'use strict';

const AIAppConnector = require('../ai-chat-app/connector');

/**
 * Concrete connector for testing the Brainstormy application.
 * Extends AIAppConnector with Brainstormy-specific workflows
 * for project/story/session management, bible generation,
 * report creation, and bookmark operations.
 *
 * @extends AIAppConnector
 */
class BrainstormyConnector extends AIAppConnector {
  /**
   * @param {BrainstormyAppConfig} app - App configuration
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {import('../../core/engine/evidence-collector')} evidenceCollector
   */
  constructor(app, page, evidenceCollector) {
    super(app, page, evidenceCollector);

    /** @type {string|null} */
    this.currentProjectId = null;
    /** @type {string|null} */
    this.currentStoryId = null;
    /** @type {string|null} */
    this.currentSessionId = null;
    /** @type {string[]} Created entity IDs for cleanup */
    this.createdEntities = [];
  }

  // ===== LIFECYCLE =====

  /**
   * Initialize: navigate to staging URL, authenticate via Clerk,
   * verify dashboard loads.
   */
  async initialize() {
    const env = this.getEnvironment();

    // Navigate to app
    await this.page.goto(env.baseUrl, { waitUntil: 'networkidle' });
    await this.collectEvidence('initial_load');

    // Authenticate
    if (env.auth.required) {
      const success = await this.authenticate();
      if (!success) {
        throw new Error('BrainstormyConnector: Authentication failed');
      }
    }

    // Verify app ready
    await this.waitForAppReady();
    await this.collectEvidence('authenticated_ready');
  }

  /**
   * Authenticate via Clerk's email/password sign-in form.
   * Clerk renders in an iframe or shadow DOM depending on version.
   * @returns {boolean} Success
   */
  async authenticate() {
    const env = this.getEnvironment();
    const auth = env.auth;
    const timeout = this.getTimeout('clerkAuth');

    try {
      // Wait for Clerk sign-in form to render
      // Clerk may use a modal or embedded component
      const emailSelector = this.getSelector('clerkEmailInput');
      const passwordSelector = this.getSelector('clerkPasswordInput');
      const submitSelector = this.getSelector('clerkSubmitButton');

      await this.page.waitForSelector(emailSelector, { timeout });

      // Fill credentials
      await this.page.fill(emailSelector, auth.credentials.email);
      await this.page.fill(
        passwordSelector,
        process.env[auth.credentials.passwordEnv]
      );

      // Submit
      await this.page.click(submitSelector);

      // Wait for redirect to dashboard
      await this.page.waitForSelector(
        this.getSelector('userMenu'),
        { timeout }
      );

      await this.collectEvidence('auth_complete');
      return true;
    } catch (error) {
      await this.collectEvidence('auth_failed');
      console.error('Clerk authentication failed:', error.message);
      return false;
    }
  }

  /**
   * Cleanup: archive test data, logout, clear state.
   */
  async cleanup() {
    try {
      // Archive test stories (rename with prefix)
      await this.archiveTestData();
    } catch (error) {
      console.warn('Cleanup archive failed:', error.message);
    }

    // Logout
    await super.cleanup();
  }

  // ===== ACTION DISPATCH =====

  /**
   * Route Brainstormy-specific actions.
   * Falls through to AIAppConnector for chat actions,
   * then to GenericWebAppConnector for basic actions.
   *
   * @param {string} action - Action type
   * @param {Object} params - Action parameters
   * @returns {Object} Action result
   */
  async performAction(action, params = {}) {
    await this.collectEvidence(`before_${action}`);

    let result;
    switch (action) {
      // Entity creation
      case 'create_project':
        result = await this.createProject(params.name);
        break;
      case 'create_story':
        result = await this.createStory(params.name, params.vertical);
        break;
      case 'create_session':
        result = await this.createSession(params.type, params.name);
        break;

      // Navigation
      case 'navigate_to_story':
        result = await this.navigateToStory(params.story_id || params.name);
        break;
      case 'navigate_to_session':
        result = await this.navigateToSession(params.session_id || params.name);
        break;

      // Bible operations
      case 'generate_bible':
        result = await this.generateStoryBible(params.template);
        break;
      case 'get_bible':
        result = await this.getStoryBible(params.template);
        break;

      // Report operations
      case 'generate_report':
        result = await this.generateReport(params.type, params.parameters);
        break;
      case 'get_report':
        result = await this.getReport(params.report_id);
        break;

      // Session lifecycle
      case 'end_session':
        result = await this.endSession();
        break;
      case 'get_session_summary':
        result = await this.getSessionSummary(params.session_id);
        break;

      // Search
      case 'search':
        result = await this.performSearch(params.query);
        break;

      // Bookmarks
      case 'create_bookmark':
        result = await this.createBookmark(params.message_index, params.title);
        break;
      case 'get_bookmarks':
        result = await this.getBookmarks(params.category);
        break;

      // Test data management
      case 'setup_test_project':
        result = await this.setupTestProject(params.name);
        break;
      case 'archive_test_data':
        result = await this.archiveTestData();
        break;

      // Fall through to parent
      default:
        result = await super.performAction(action, params);
    }

    await this.collectEvidence(`after_${action}`);
    return result;
  }

  // ===== PROJECT OPERATIONS =====

  /**
   * Create a new project in Brainstormy.
   * @param {string} name - Project name
   * @returns {{ id: string, name: string }}
   */
  async createProject(name) {
    await this.navigate('/projects');
    await this.waitForSelector(this.getSelector('newProjectButton'));
    await this.page.click(this.getSelector('newProjectButton'));

    // Fill project name
    await this.page.waitForSelector(this.getSelector('projectNameInput'));
    await this.page.fill(this.getSelector('projectNameInput'), name);
    await this.page.click(this.getSelector('createProjectSubmit'));

    // Wait for navigation to new project
    await this.page.waitForNavigation({ waitUntil: 'networkidle' });

    // Extract project ID from URL: /projects/<uuid>
    const url = this.page.url();
    const match = url.match(/projects\/([a-f0-9-]+)/);
    const projectId = match ? match[1] : null;

    this.currentProjectId = projectId;
    this.setState('current_project_id', projectId);
    this.createdEntities.push({ type: 'project', id: projectId, name });

    return { id: projectId, name };
  }

  // ===== STORY OPERATIONS =====

  /**
   * Create a new story within the current project.
   * @param {string} name - Story name
   * @param {string} [vertical='novel'] - Writing vertical
   * @returns {{ id: string, name: string, vertical: string }}
   */
  async createStory(name, vertical = 'novel') {
    // Ensure we're in a project context
    if (!this.currentProjectId) {
      throw new Error('No project selected. Call createProject first.');
    }

    await this.page.click(this.getSelector('newStoryButton'));
    await this.page.waitForSelector(this.getSelector('storyNameInput'));
    await this.page.fill(this.getSelector('storyNameInput'), name);

    // Select vertical if dropdown exists
    const verticalSelector = this.getSelector('storyVerticalSelect');
    if (verticalSelector && await this.exists(verticalSelector)) {
      await this.page.selectOption(verticalSelector, vertical);
    }

    await this.page.click(this.getSelector('createStorySubmit'));
    await this.page.waitForNavigation({ waitUntil: 'networkidle' });

    // Extract story ID from URL: /stories/<uuid>
    const url = this.page.url();
    const match = url.match(/stories\/([a-f0-9-]+)/);
    const storyId = match ? match[1] : null;

    this.currentStoryId = storyId;
    this.setState('current_story_id', storyId);
    this.createdEntities.push({ type: 'story', id: storyId, name });

    return { id: storyId, name, vertical };
  }

  // ===== SESSION OPERATIONS =====

  /**
   * Create a new brainstorming session within the current story.
   * @param {string} [type='explore'] - Session type: 'explore' or 'focus'
   * @param {string} [name] - Optional session name
   * @returns {{ id: string, type: string, name: string }}
   */
  async createSession(type = 'explore', name) {
    if (!this.currentStoryId) {
      throw new Error('No story selected. Call createStory first.');
    }

    await this.page.click(this.getSelector('newSessionButton'));
    await this.page.waitForSelector(this.getSelector('sessionTypeSelect'));

    // Select session type
    const typeSelector = this.getSelector('sessionTypeSelect');
    if (typeSelector && await this.exists(typeSelector)) {
      await this.page.selectOption(typeSelector, type);
    }

    await this.page.click(this.getSelector('createSessionSubmit'));
    await this.page.waitForNavigation({ waitUntil: 'networkidle' });

    // Extract session ID from URL: /sessions/<uuid>
    const url = this.page.url();
    const match = url.match(/sessions\/([a-f0-9-]+)/);
    const sessionId = match ? match[1] : null;

    const sessionName = name || `QA Session ${Date.now()}`;
    this.currentSessionId = sessionId;
    this.setState('current_session_id', sessionId);
    this.createdEntities.push({ type: 'session', id: sessionId, name: sessionName });

    return { id: sessionId, type, name: sessionName };
  }

  /**
   * End the current session, triggering summary generation.
   * @returns {{ session_id: string, summary_generated: boolean }}
   */
  async endSession() {
    const endButton = this.getSelector('endSessionButton');
    if (!await this.exists(endButton)) {
      throw new Error('End session button not found — is a session active?');
    }

    await this.page.click(endButton);

    // Wait for summary generation (may take time)
    const timeout = this.getTimeout('sessionSummary');
    try {
      await this.page.waitForSelector(
        this.getSelector('sessionSummaryContent'),
        { timeout }
      );
      return { session_id: this.currentSessionId, summary_generated: true };
    } catch {
      return { session_id: this.currentSessionId, summary_generated: false };
    }
  }

  /**
   * Get session summary content.
   * @param {string} [sessionId] - Session ID (defaults to current)
   * @returns {{ session_id: string, summary: string|null }}
   */
  async getSessionSummary(sessionId) {
    const sid = sessionId || this.currentSessionId;

    // Navigate to session list to find summary
    const summarySelector = this.getSelector('sessionSummaryContent');
    if (await this.exists(summarySelector)) {
      const summary = await this.page.textContent(summarySelector);
      return { session_id: sid, summary };
    }

    return { session_id: sid, summary: null };
  }

  // ===== BIBLE OPERATIONS =====

  /**
   * Generate a Story Bible for the current story.
   * @param {string} [template='standard'] - Bible template key
   * @returns {{ template: string, sections: Object, section_count: number }}
   */
  async generateStoryBible(template = 'standard') {
    // Navigate to Bible tab
    await this.page.click(this.getSelector('bibleTab'));
    await this.page.waitForSelector(this.getSelector('bibleTemplateSelect'));

    // Select template
    await this.page.selectOption(
      this.getSelector('bibleTemplateSelect'),
      template
    );

    // Click generate
    await this.page.click(this.getSelector('bibleGenerateButton'));

    // Wait for generation to complete (can take 30-120s)
    const timeout = this.getTimeout('bibleGeneration');
    const generatingIndicator = this.getSelector('bibleGeneratingIndicator');

    // Wait for indicator to appear then disappear
    try {
      await this.page.waitForSelector(generatingIndicator, { timeout: 10000 });
    } catch {
      // Indicator may not appear if generation is instant
    }

    // Wait for indicator to disappear (generation complete)
    await this.page.waitForSelector(generatingIndicator, {
      state: 'hidden',
      timeout
    });

    // Extract sections
    const sections = await this.extractBibleSections();

    return {
      template,
      sections,
      section_count: Object.keys(sections).length
    };
  }

  /**
   * Get the current Story Bible content.
   * @param {string} [template='standard']
   * @returns {{ template: string, sections: Object }}
   */
  async getStoryBible(template = 'standard') {
    await this.page.click(this.getSelector('bibleTab'));
    await this.page.waitForSelector(this.getSelector('bibleSection'));

    const sections = await this.extractBibleSections();
    return { template, sections };
  }

  /**
   * Extract all bible section titles and content from the page.
   * @private
   * @returns {Object} Map of section_key → { title, content, has_content }
   */
  async extractBibleSections() {
    const sectionSelector = this.getSelector('bibleSection');
    const sectionElements = await this.page.$$(sectionSelector);

    const sections = {};
    for (const el of sectionElements) {
      const title = await el.$eval(
        '.section-title, h3, [data-testid="section-title"]',
        (node) => node.textContent.trim()
      ).catch(() => 'Unknown');

      const content = await el.$eval(
        '.section-content, [data-testid="section-content"]',
        (node) => node.textContent.trim()
      ).catch(() => '');

      const key = title.toLowerCase().replace(/\s+/g, '_');
      sections[key] = {
        title,
        content,
        has_content: content.length > 0
      };
    }

    return sections;
  }

  // ===== REPORT OPERATIONS =====

  /**
   * Generate a report for the current story.
   * @param {string} type - Report type ('outline', 'character_profile', etc.)
   * @param {Object} [parameters={}] - Report parameters (e.g. { character_name: 'Sarah' })
   * @returns {{ type: string, content: string, citations: Object }}
   */
  async generateReport(type, parameters = {}) {
    await this.page.click(this.getSelector('reportTab'));
    await this.page.waitForSelector(this.getSelector('reportTypeSelect'));

    await this.page.selectOption(this.getSelector('reportTypeSelect'), type);

    // Fill parameters if any (e.g., character name input)
    for (const [key, value] of Object.entries(parameters)) {
      const paramSelector = `[data-testid="report-param-${key}"]`;
      if (await this.exists(paramSelector)) {
        await this.page.fill(paramSelector, value);
      }
    }

    await this.page.click(this.getSelector('reportGenerateButton'));

    // Wait for report generation
    const timeout = this.getTimeout('reportGeneration');
    await this.page.waitForSelector(
      this.getSelector('reportContent'),
      { timeout }
    );

    // Extract content and citations
    const content = await this.page.textContent(
      this.getSelector('reportContent')
    );

    const citations = await this.extractCitations();

    return { type, content, citations };
  }

  // ===== SEARCH OPERATIONS =====

  /**
   * Perform a semantic search in the current story.
   * @param {string} query - Search query
   * @returns {{ query: string, results: Array<{ text: string, source: string }>, count: number }}
   */
  async performSearch(query) {
    const searchInput = this.getSelector('searchInput');
    await this.page.waitForSelector(searchInput);
    await this.page.fill(searchInput, query);

    const searchSubmit = this.getSelector('searchSubmit');
    if (searchSubmit && await this.exists(searchSubmit)) {
      await this.page.click(searchSubmit);
    } else {
      await this.page.press(searchInput, 'Enter');
    }

    // Wait for results
    const timeout = this.getTimeout('search');
    await this.page.waitForSelector(
      this.getSelector('searchResults'),
      { timeout }
    );

    // Extract results
    const resultSelector = this.getSelector('searchResultItem');
    const resultElements = await this.page.$$(resultSelector);

    const results = [];
    for (const el of resultElements) {
      const text = await el.textContent();
      const source = await el.getAttribute('data-source-type').catch(() => 'message');
      results.push({ text: text.trim(), source });
    }

    return { query, results, count: results.length };
  }

  // ===== BOOKMARK OPERATIONS =====

  /**
   * Bookmark a message in the current session.
   * @param {number} messageIndex - 0-based index of message to bookmark (from most recent)
   * @param {string} title - Bookmark title
   * @returns {{ bookmarked: boolean, title: string }}
   */
  async createBookmark(messageIndex = 0, title = 'QA Test Bookmark') {
    // Find the message element
    const messages = await this.page.$$(this.getSelector('aiMessage'));
    if (messages.length === 0) {
      throw new Error('No messages to bookmark');
    }

    const targetIndex = Math.min(messageIndex, messages.length - 1);
    const targetMessage = messages[messages.length - 1 - targetIndex];

    // Hover to reveal bookmark button
    await targetMessage.hover();
    const bookmarkBtn = await targetMessage.$(this.getSelector('bookmarkButton'));
    if (!bookmarkBtn) {
      throw new Error('Bookmark button not found on message');
    }

    await bookmarkBtn.click();

    // Fill title
    await this.page.waitForSelector(this.getSelector('bookmarkTitleInput'));
    await this.page.fill(this.getSelector('bookmarkTitleInput'), title);
    await this.page.click(this.getSelector('bookmarkSaveButton'));

    // Wait for confirmation
    await this.page.waitForTimeout(1000);

    return { bookmarked: true, title };
  }

  /**
   * Get all bookmarks for the current story.
   * @param {string} [category] - Optional category filter
   * @returns {{ bookmarks: Array<{ title: string, content: string }>, count: number }}
   */
  async getBookmarks(category) {
    await this.page.click(this.getSelector('bookmarksTab'));
    await this.page.waitForSelector(this.getSelector('bookmarkItem'));

    const bookmarkElements = await this.page.$$(this.getSelector('bookmarkItem'));

    const bookmarks = [];
    for (const el of bookmarkElements) {
      const title = await el.$eval(
        '[data-testid="bookmark-title"], .bookmark-title',
        (node) => node.textContent.trim()
      ).catch(() => '');
      const content = await el.$eval(
        '[data-testid="bookmark-content"], .bookmark-content',
        (node) => node.textContent.trim()
      ).catch(() => '');
      bookmarks.push({ title, content });
    }

    return { bookmarks, count: bookmarks.length };
  }

  // ===== NAVIGATION HELPERS =====

  /**
   * Navigate to a specific story by name or ID.
   * @param {string} storyIdentifier - Story name or UUID
   */
  async navigateToStory(storyIdentifier) {
    const storyItems = await this.page.$$(this.getSelector('storySidebarItem'));
    for (const item of storyItems) {
      const text = await item.textContent();
      const href = await item.getAttribute('href');
      if (text.includes(storyIdentifier) || (href && href.includes(storyIdentifier))) {
        await item.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle' });
        return;
      }
    }
    throw new Error(`Story "${storyIdentifier}" not found in sidebar`);
  }

  /**
   * Navigate to a specific session by name or ID.
   * @param {string} sessionIdentifier - Session name or UUID
   */
  async navigateToSession(sessionIdentifier) {
    const sessionItems = await this.page.$$(this.getSelector('sessionItem'));
    for (const item of sessionItems) {
      const text = await item.textContent();
      const href = await item.getAttribute('href');
      if (text.includes(sessionIdentifier) || (href && href.includes(sessionIdentifier))) {
        await item.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle' });
        return;
      }
    }
    throw new Error(`Session "${sessionIdentifier}" not found`);
  }

  // ===== TEST DATA MANAGEMENT =====

  /**
   * Set up a dedicated test project for QA runs.
   * Creates the project if it doesn't exist, or navigates to it.
   * @param {string} [name='QA Test Project']
   * @returns {{ project_id: string, created: boolean }}
   */
  async setupTestProject(name = 'QA Test Project') {
    await this.navigate('/projects');
    await this.page.waitForSelector(this.getSelector('sidebarProjects'));

    // Check if test project already exists
    const projectLinks = await this.page.$$('a[href*="/projects/"]');
    for (const link of projectLinks) {
      const text = await link.textContent();
      if (text.trim() === name) {
        await link.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle' });

        const url = this.page.url();
        const match = url.match(/projects\/([a-f0-9-]+)/);
        this.currentProjectId = match ? match[1] : null;
        this.setState('current_project_id', this.currentProjectId);

        return { project_id: this.currentProjectId, created: false };
      }
    }

    // Create new test project
    const project = await this.createProject(name);
    return { project_id: project.id, created: true };
  }

  /**
   * Archive test stories by renaming them with [QA-archived] prefix.
   * @private
   */
  async archiveTestData() {
    // This is a best-effort cleanup.
    // In practice, archiving may require API calls or manual cleanup.
    // For now, log the entities created for post-mortem.
    console.log(
      'BrainstormyConnector: Created entities for cleanup:',
      JSON.stringify(this.createdEntities, null, 2)
    );
  }

  // ===== UTILITY METHODS =====

  /**
   * Get the current environment config.
   * Reads from the flat top-level config by default (baseUrl, connector.config.auth).
   * If an explicit environment override exists (e.g., 'production'), merges those values.
   * @param {string} [envName] - Optional environment name override
   * @returns {{ baseUrl: string, auth: Object }}
   */
  getEnvironment(envName) {
    const auth = this.app.connector?.config?.auth || {};
    const baseConfig = {
      baseUrl: this.app.baseUrl,
      auth
    };

    // If an environment override exists, merge it
    if (envName && this.app.environments?.[envName]) {
      const envOverride = this.app.environments[envName];
      return {
        baseUrl: envOverride.baseUrl || baseConfig.baseUrl,
        auth: {
          ...baseConfig.auth,
          ...envOverride.auth,
          credentials: {
            ...baseConfig.auth?.credentials,
            ...envOverride.auth?.credentials
          }
        }
      };
    }

    return baseConfig;
  }

  /**
   * Override getSelector() to resolve from connector.config.selectors path.
   *
   * BaseConnector.getSelector() reads this.app.config?.selectors?.[key], but our
   * config puts selectors at this.app.connector.config.selectors. This override
   * checks the correct path first, then falls back to DEFAULT_SELECTORS from
   * the selectors.js defaults file.
   *
   * @param {string} key - Selector key in camelCase (e.g., 'chatInput')
   * @returns {string} CSS selector string
   */
  getSelector(key) {
    // 1. Config selectors (highest priority — overridable per-deployment)
    const configSelector = this.app.connector?.config?.selectors?.[key];
    if (configSelector) return configSelector;

    // 2. Default selectors from selectors.js (fallback)
    const DEFAULT_SELECTORS = require('./selectors');
    return DEFAULT_SELECTORS[key] || null;
  }

  /**
   * Get a timeout value from config.
   * Config uses camelCase keys (e.g., aiResponse, bibleGeneration).
   * @param {string} key - Timeout key in camelCase
   * @returns {number} Timeout in ms
   */
  getTimeout(key) {
    const defaults = {
      aiResponse: 60000,
      bibleGeneration: 120000,
      reportGeneration: 90000,
      navigation: 30000,
      search: 15000,
      sessionSummary: 60000,
      clerkAuth: 30000
    };
    return this.app.connector?.config?.timeouts?.[key] || defaults[key];
  }

  /**
   * Wait for a selector with evidence collection on timeout.
   * @param {string} selector
   * @param {number} [timeout]
   */
  async waitForSelector(selector, timeout) {
    try {
      await this.page.waitForSelector(selector, {
        timeout: timeout || this.getTimeout('navigation')
      });
    } catch (error) {
      await this.collectEvidence(`timeout_waiting_for_${selector}`);
      throw error;
    }
  }

  /**
   * Override waitForAppReady() from GenericWebAppConnector.
   *
   * The base class reads this.app.config?.ready_indicator, but our config
   * stores the ready indicator as a selector key in connector.config.selectors.
   * This override resolves it via getSelector() which checks the correct path.
   */
  async waitForAppReady() {
    const readySelector = this.getSelector('readyIndicator');
    if (readySelector) {
      await this.waitForSelector(readySelector, this.getTimeout('navigation'));
    }
  }

  /**
   * Navigate to a path within Brainstormy.
   * @param {string} path - Relative path
   */
  async navigate(path) {
    const env = this.getEnvironment();
    const url = path.startsWith('http') ? path : `${env.baseUrl}${path}`;
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }
}

module.exports = BrainstormyConnector;
```

### File: `connectors/brainstormy/selectors.js`

> **Role:** This file provides fallback default selectors for Brainstormy UI elements.
> The primary selectors come from `app.config.json` under `connector.config.selectors` (camelCase keys).
> The connector's `getSelector(key)` method (inherited from `BaseConnector`) reads from config first;
> these defaults are merged in the constructor for any keys missing from config.

```javascript
'use strict';

/**
 * Default selectors for Brainstormy UI elements.
 * These serve as fallback values when not specified in app.config.json.
 * Keys use camelCase to match the existing connector.config.selectors convention.
 * Ordered by priority: data-testid > role/aria > CSS class.
 */
const DEFAULT_SELECTORS = {
  // Clerk Authentication
  clerkEmailInput: 'input[name="identifier"], input[type="email"]',
  clerkPasswordInput: 'input[name="password"], input[type="password"]',
  clerkSubmitButton: 'button[data-localization-key="formButtonPrimary"], button[type="submit"]',

  // Auth state
  userMenu: '[data-testid="user-menu"], [data-testid="user-button"]',
  logoutButton: '[data-testid="logout-button"], button:has-text("Sign out")',

  // Navigation
  sidebarProjects: '[data-testid="sidebar-projects"], a[href="/projects"]',
  storySidebarItem: '[data-testid="story-nav-item"], .sidebar-story-link',

  // Project CRUD
  newProjectButton: '[data-testid="new-project-button"], button:has-text("New Project")',
  projectNameInput: '[data-testid="project-name-input"], input[name="project-name"]',
  createProjectSubmit: '[data-testid="create-project-button"], button[type="submit"]',

  // Story CRUD
  newStoryButton: '[data-testid="new-story-button"], button:has-text("New Story")',
  storyNameInput: '[data-testid="story-name-input"], input[name="story-name"]',
  storyVerticalSelect: '[data-testid="story-vertical-select"], select[name="vertical"]',
  createStorySubmit: '[data-testid="create-story-button"], button[type="submit"]',

  // Session CRUD
  newSessionButton: '[data-testid="new-session-button"], button:has-text("New Session")',
  sessionTypeSelect: '[data-testid="session-type-select"], select[name="session-type"]',
  createSessionSubmit: '[data-testid="create-session-button"], button[type="submit"]',
  sessionList: '[data-testid="session-list"], .session-list',
  sessionItem: '[data-testid="session-item"], .session-list-item',
  endSessionButton: '[data-testid="end-session-button"], button:has-text("End Session")',

  // Chat
  chatInput: '[data-testid="chat-input"], textarea[placeholder*="message"]',
  chatSend: '[data-testid="send-button"], button[aria-label="Send"]',
  aiMessage: '[data-testid="ai-message"], .message-assistant',
  userMessage: '[data-testid="user-message"], .message-user',
  generatingIndicator: '[data-testid="generating"], .streaming-indicator',

  // Search
  searchInput: '[data-testid="search-input"], input[placeholder*="Search"]',
  searchSubmit: '[data-testid="search-submit"]',
  searchResults: '[data-testid="search-results"], .search-results',
  searchResultItem: '[data-testid="search-result-item"], .search-result',

  // Bible
  bibleTab: '[data-testid="bible-tab"], a[href*="bible"], button:has-text("Story Bible")',
  bibleTemplateSelect: '[data-testid="bible-template-select"], select[name="template"]',
  bibleGenerateButton: '[data-testid="bible-generate"], button:has-text("Generate")',
  bibleSection: '[data-testid="bible-section"], .bible-section',
  bibleGeneratingIndicator: '[data-testid="bible-generating"], .bible-progress',

  // Reports
  reportTab: '[data-testid="report-tab"], a[href*="reports"]',
  reportTypeSelect: '[data-testid="report-type-select"], select[name="report-type"]',
  reportGenerateButton: '[data-testid="report-generate"], button:has-text("Generate")',
  reportContent: '[data-testid="report-content"], .report-content',
  reportCitation: '[data-citation-id], .citation-link',

  // Bookmarks
  bookmarkButton: '[data-testid="bookmark-button"], button[aria-label="Bookmark"]',
  bookmarkTitleInput: '[data-testid="bookmark-title-input"], input[name="bookmark-title"]',
  bookmarkSaveButton: '[data-testid="bookmark-save"], button:has-text("Save")',
  bookmarksTab: '[data-testid="bookmarks-tab"], a[href*="bookmarks"]',
  bookmarkItem: '[data-testid="bookmark-item"], .bookmark-list-item',

  // Session summary
  sessionSummaryContent: '[data-testid="session-summary"], .session-summary-content',

  // App state
  readyIndicator: '[data-testid="app-loaded"], #app-root'
};

module.exports = DEFAULT_SELECTORS;
```

---

## Part 5: Brainstormy App Config File

### File: `apps/brainstormy/app.config.json`

> **Important:** This config conforms to the existing config shape used by `BaseConnector`, 
> `GenericWebAppConnector`, and the existing BrainstormyConnector (422 lines). 
> Key differences from the original spec draft: uses `id` (not `app_id`), `baseUrl` (not nested `environments`),
> auth under `connector.config.auth`, selectors under `connector.config.selectors` with camelCase keys,
> and `connector.type: "brainstormy"` (so ConnectorFactory resolves to BrainstormyConnector, not AIAppConnector).

```json
{
  "id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat-app",
  "baseUrl": "https://staging.brainstormy.app",

  "connector": {
    "type": "brainstormy",
    "config": {
      "auth": {
        "type": "email_password",
        "required": true,
        "credentials": {
          "email": "testbot@brainstormy.app",
          "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
        }
      },
      "selectors": {
        "clerkEmailInput": "input[name=\"identifier\"], input[type=\"email\"]",
        "clerkPasswordInput": "input[name=\"password\"], input[type=\"password\"]",
        "clerkSubmitButton": "button[data-localization-key=\"formButtonPrimary\"], button[type=\"submit\"]",
        "userMenu": "[data-testid=\"user-menu\"], [data-testid=\"user-button\"]",
        "logoutButton": "[data-testid=\"logout-button\"], button:has-text(\"Sign out\")",
        "sidebarProjects": "[data-testid=\"sidebar-projects\"], a[href=\"/projects\"]",
        "storySidebarItem": "[data-testid=\"story-nav-item\"], .sidebar-story-link",
        "newProjectButton": "[data-testid=\"new-project-button\"], button:has-text(\"New Project\")",
        "projectNameInput": "[data-testid=\"project-name-input\"], input[name=\"project-name\"]",
        "createProjectSubmit": "[data-testid=\"create-project-button\"], button[type=\"submit\"]",
        "newStoryButton": "[data-testid=\"new-story-button\"], button:has-text(\"New Story\")",
        "storyNameInput": "[data-testid=\"story-name-input\"], input[name=\"story-name\"]",
        "storyVerticalSelect": "[data-testid=\"story-vertical-select\"], select[name=\"vertical\"]",
        "createStorySubmit": "[data-testid=\"create-story-button\"], button[type=\"submit\"]",
        "newSessionButton": "[data-testid=\"new-session-button\"], button:has-text(\"New Session\")",
        "sessionTypeSelect": "[data-testid=\"session-type-select\"], select[name=\"session-type\"]",
        "createSessionSubmit": "[data-testid=\"create-session-button\"], button[type=\"submit\"]",
        "sessionList": "[data-testid=\"session-list\"], .session-list",
        "sessionItem": "[data-testid=\"session-item\"], .session-list-item",
        "endSessionButton": "[data-testid=\"end-session-button\"], button:has-text(\"End Session\")",
        "chatInput": "[data-testid=\"chat-input\"], textarea[placeholder*=\"message\"]",
        "chatSend": "[data-testid=\"send-button\"], button[aria-label=\"Send\"]",
        "aiMessage": "[data-testid=\"ai-message\"], .message-assistant",
        "userMessage": "[data-testid=\"user-message\"], .message-user",
        "generatingIndicator": "[data-testid=\"generating\"], .streaming-indicator",
        "searchInput": "[data-testid=\"search-input\"], input[placeholder*=\"Search\"]",
        "searchSubmit": "[data-testid=\"search-submit\"]",
        "searchResults": "[data-testid=\"search-results\"], .search-results",
        "searchResultItem": "[data-testid=\"search-result-item\"], .search-result",
        "bibleTab": "[data-testid=\"bible-tab\"], a[href*=\"bible\"], button:has-text(\"Story Bible\")",
        "bibleTemplateSelect": "[data-testid=\"bible-template-select\"], select[name=\"template\"]",
        "bibleGenerateButton": "[data-testid=\"bible-generate\"], button:has-text(\"Generate\")",
        "bibleSection": "[data-testid=\"bible-section\"], .bible-section",
        "bibleGeneratingIndicator": "[data-testid=\"bible-generating\"], .bible-progress",
        "reportTab": "[data-testid=\"report-tab\"], a[href*=\"reports\"]",
        "reportTypeSelect": "[data-testid=\"report-type-select\"], select[name=\"report-type\"]",
        "reportGenerateButton": "[data-testid=\"report-generate\"], button:has-text(\"Generate\")",
        "reportContent": "[data-testid=\"report-content\"], .report-content",
        "reportCitation": "[data-citation-id], .citation-link",
        "bookmarkButton": "[data-testid=\"bookmark-button\"], button[aria-label=\"Bookmark\"]",
        "bookmarkTitleInput": "[data-testid=\"bookmark-title-input\"], input[name=\"bookmark-title\"]",
        "bookmarkSaveButton": "[data-testid=\"bookmark-save\"], button:has-text(\"Save\")",
        "bookmarksTab": "[data-testid=\"bookmarks-tab\"], a[href*=\"bookmarks\"]",
        "bookmarkItem": "[data-testid=\"bookmark-item\"], .bookmark-list-item",
        "sessionSummaryContent": "[data-testid=\"session-summary\"], .session-summary-content",
        "readyIndicator": "[data-testid=\"app-loaded\"], #app-root"
      },
      "timeouts": {
        "aiResponse": 60000,
        "bibleGeneration": 120000,
        "reportGeneration": 90000,
        "navigation": 30000,
        "search": 15000,
        "sessionSummary": 60000,
        "clerkAuth": 30000
      },
      "testProjectName": "QA Test Project"
    }
  },

  "environments": {
    "staging": {
      "baseUrl": "https://staging.brainstormy.app",
      "auth": {
        "credentials": {
          "passwordEnv": "BRAINSTORMY_TEST_PASSWORD"
        }
      }
    },
    "production": {
      "baseUrl": "https://brainstormy.app",
      "auth": {
        "credentials": {
          "passwordEnv": "BRAINSTORMY_PROD_TEST_PASSWORD"
        }
      }
    }
  }
}
```

> **Note on environments:** The top-level `baseUrl` and `connector.config.auth` are the primary config.
> The `environments` block is an optional override map — the connector reads `baseUrl` and auth from the 
> top-level by default, and only overrides from `environments[env]` when an explicit environment is specified 
> (e.g., for scheduled runs targeting production). This preserves backward compatibility with the existing 
> flat config shape while adding multi-environment support for the scheduler.

---

## Part 6: Test Scenario Definitions

### File: `apps/brainstormy/scenarios/smoke-tests.json`

```json
{
  "name": "Brainstormy Smoke Tests",
  "mode": "smoke",
  "agent": "healer",
  "timeout_ms": 180000,
  "scenarios": [
    {
      "id": "smoke-01-login",
      "name": "Login and Dashboard Load",
      "steps": [
        { "action": "navigate", "params": { "path": "/" } },
        { "assert": "selector_visible", "selector": "userMenu", "message": "User menu should be visible after login" }
      ]
    },
    {
      "id": "smoke-02-navigate-project",
      "name": "Navigate to Existing Project",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "assert": "url_contains", "value": "/projects/", "message": "Should be on project page" }
      ]
    },
    {
      "id": "smoke-03-create-session-chat",
      "name": "Create Session and Send Message",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Smoke Test Story", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "Hello, this is a smoke test message." } },
        { "action": "wait_for_response", "params": {} },
        { "assert": "element_count_gte", "selector": "aiMessage", "value": 1, "message": "Should have at least one AI response" }
      ]
    },
    {
      "id": "smoke-04-search",
      "name": "Search Returns Results",
      "depends_on": "smoke-03-create-session-chat",
      "steps": [
        { "action": "search", "params": { "query": "smoke test" } },
        { "assert": "result_count_gte", "field": "count", "value": 0, "message": "Search should return without error" }
      ]
    },
    {
      "id": "smoke-05-navigation",
      "name": "Navigate Between Views",
      "steps": [
        { "action": "navigate", "params": { "path": "/projects" } },
        { "assert": "selector_visible", "selector": "sidebarProjects", "message": "Projects sidebar should be visible" },
        { "action": "setup_test_project", "params": {} },
        { "assert": "url_contains", "value": "/projects/", "message": "Should navigate to project" }
      ]
    }
  ]
}
```

### File: `apps/brainstormy/scenarios/memory-tests.json`

```json
{
  "name": "Brainstormy Memory Persistence Tests",
  "mode": "full",
  "agent": "sentinel",
  "timeout_ms": 600000,
  "scenarios": [
    {
      "id": "mem-01-single-session-recall",
      "name": "Recall Fact Within Same Session",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Memory Test Story", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "The protagonist's name is Marcus and he is a blacksmith from the village of Thornfield." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "send_message", "params": { "text": "Marcus has a secret: he can see memories when he touches iron." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "validate_memory", "params": { "query": "What is the protagonist's name and occupation?", "expected": "Marcus" } },
        { "assert": "field_true", "field": "found", "message": "Should recall Marcus as protagonist" }
      ]
    },
    {
      "id": "mem-02-cross-session-recall",
      "name": "Recall Fact Across Sessions",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Cross-Session Memory Test", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "Our story is set in the year 2847 on a space station called Meridian." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "end_session", "params": {} },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "validate_memory", "params": { "query": "Where is our story set?", "expected": "Meridian" } },
        { "assert": "field_true", "field": "found", "message": "Should recall Meridian across sessions" }
      ]
    },
    {
      "id": "mem-03-search-recall",
      "name": "Semantic Search Finds Previous Content",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Search Recall Test", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "The antagonist uses a rare poison called Nightshade Extract that causes hallucinations before death." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "search", "params": { "query": "poison hallucinations" } },
        { "assert": "result_count_gte", "field": "count", "value": 1, "message": "Search should find poison-related content" }
      ]
    },
    {
      "id": "mem-04-session-summary-captures-facts",
      "name": "Session Summary Captures Key Decisions",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Summary Capture Test", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "We decided the climax happens at the abandoned lighthouse on chapter 15." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "send_message", "params": { "text": "The twist is that the lighthouse keeper is actually the protagonist's mother." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "end_session", "params": {} },
        { "action": "get_session_summary", "params": {} },
        { "assert": "field_contains", "field": "summary", "value": "lighthouse", "message": "Summary should mention the lighthouse" }
      ]
    },
    {
      "id": "mem-05-bookmark-in-context",
      "name": "Bookmarked Content Appears in Context",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Bookmark Context Test", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "The magic system is powered by emotional resonance. Stronger emotions create stronger spells." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "create_bookmark", "params": { "message_index": 0, "title": "Magic System Rule" } },
        { "action": "end_session", "params": {} },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "validate_memory", "params": { "query": "How does the magic system work?", "expected": "emotion" } },
        { "assert": "field_true", "field": "found", "message": "Bookmarked magic system rule should be in context" }
      ]
    }
  ]
}
```

### File: `apps/brainstormy/scenarios/bible-tests.json`

```json
{
  "name": "Brainstormy Bible & Report Tests",
  "mode": "full",
  "agent": "librarian",
  "timeout_ms": 900000,
  "scenarios": [
    {
      "id": "bible-01-generate-standard",
      "name": "Generate Standard Bible with Content",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Bible Test Story", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "Our protagonist is Elena, a 30-year-old marine biologist who discovers she can communicate with whales through dreams." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "send_message", "params": { "text": "The story is set in present-day Monterey Bay. The theme is about finding connection in isolation." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "end_session", "params": {} },
        { "action": "generate_bible", "params": { "template": "standard" } },
        { "assert": "field_gte", "field": "section_count", "value": 3, "message": "Bible should have at least 3 sections" }
      ]
    },
    {
      "id": "bible-02-sections-populated",
      "name": "Bible Sections Contain Relevant Content",
      "depends_on": "bible-01-generate-standard",
      "steps": [
        { "action": "get_bible", "params": { "template": "standard" } },
        { "assert": "sections_have_content", "min_populated": 2, "message": "At least 2 sections should have content" }
      ]
    },
    {
      "id": "report-01-generate-outline",
      "name": "Generate Outline Report with Citations",
      "steps": [
        { "action": "setup_test_project", "params": {} },
        { "action": "create_story", "params": { "name": "Report Test Story", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } },
        { "action": "send_message", "params": { "text": "Act 1: Elena discovers her ability during a routine dive. She hears whale song in her dreams that night." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "send_message", "params": { "text": "Act 2: She travels to remote islands following the whales' directions, facing skepticism from her peers." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "send_message", "params": { "text": "Act 3: She realizes the whales are warning of an ecological disaster. She must convince the world." } },
        { "action": "wait_for_response", "params": {} },
        { "action": "end_session", "params": {} },
        { "action": "generate_report", "params": { "type": "outline" } },
        { "assert": "field_not_empty", "field": "content", "message": "Report should have content" },
        { "assert": "has_citations", "field": "citations", "min_count": 1, "message": "Report should contain at least 1 citation" }
      ]
    },
    {
      "id": "report-02-citation-validity",
      "name": "Report Citations Reference Real Messages",
      "depends_on": "report-01-generate-outline",
      "steps": [
        { "action": "get_report", "params": {} },
        { "assert": "citations_valid", "message": "All citation IDs should reference existing messages" }
      ]
    }
  ]
}
```

---

## Part 7: Scheduler Implementation

### File: `core/scheduler.js`

```javascript
'use strict';

const cron = require('node-cron');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Manages scheduled test runs using node-cron.
 * Schedules are persisted in SQLite and loaded on startup.
 * Integrates with TestOrchestrator for execution and
 * NotificationAdapter for WhatsApp alerts.
 *
 * @extends EventEmitter
 * @emits schedule:started - When a scheduled run begins
 * @emits schedule:completed - When a scheduled run finishes
 * @emits schedule:error - When a scheduled run fails
 * @emits digest:sent - When daily digest is sent
 */
class Scheduler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('./database/repositories/scheduled-run-repository')} options.scheduledRunRepo
   * @param {import('./engine/test-orchestrator')} options.orchestrator
   * @param {import('./integrations/adapters/notification')} options.notifier
   * @param {import('./database/repositories/test-run-repository')} options.testRunRepo
   * @param {(appId: string) => Object} options.loadAppConfig - Function that loads appConfig by ID
   * @param {string} [options.defaultRecipient] - Phone number for WhatsApp notifications
   */
  constructor({ scheduledRunRepo, orchestrator, notifier, testRunRepo, loadAppConfig, defaultRecipient }) {
    super();

    /** @type {Map<string, import('node-cron').ScheduledTask>} */
    this.activeTasks = new Map();

    this.scheduledRunRepo = scheduledRunRepo;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.testRunRepo = testRunRepo;
    this.loadAppConfig = loadAppConfig;
    this.defaultRecipient = defaultRecipient || process.env.WHATSAPP_DEFAULT_RECIPIENT;

    /** @type {boolean} */
    this.running = false;

    /** @type {Set<string>} Schedule IDs currently executing */
    this.executing = new Set();
  }

  /**
   * Start the scheduler: load all enabled schedules from DB
   * and register cron tasks.
   */
  async start() {
    if (this.running) {
      console.warn('Scheduler already running');
      return;
    }

    const schedules = await this.scheduledRunRepo.getEnabled();
    console.log(`Scheduler: Loading ${schedules.length} enabled schedule(s)`);

    for (const schedule of schedules) {
      this.registerTask(schedule);
    }

    this.running = true;
    console.log('Scheduler: Started');
  }

  /**
   * Stop the scheduler: destroy all cron tasks.
   */
  async stop() {
    for (const [id, task] of this.activeTasks) {
      task.stop();
      console.log(`Scheduler: Stopped task ${id}`);
    }
    this.activeTasks.clear();
    this.running = false;
    console.log('Scheduler: Stopped');
  }

  /**
   * Register a cron task for a schedule.
   * @param {ScheduledRun} schedule
   */
  registerTask(schedule) {
    if (!cron.validate(schedule.cron_expression)) {
      console.error(
        `Scheduler: Invalid cron expression for ${schedule.name}: ${schedule.cron_expression}`
      );
      return;
    }

    // Stop existing task if re-registering
    if (this.activeTasks.has(schedule.id)) {
      this.activeTasks.get(schedule.id).stop();
    }

    const task = cron.schedule(schedule.cron_expression, async () => {
      await this.executeSchedule(schedule);
    });

    this.activeTasks.set(schedule.id, task);
    console.log(
      `Scheduler: Registered "${schedule.name}" [${schedule.cron_expression}]`
    );
  }

  /**
   * Execute a scheduled run.
   * Prevents concurrent execution of the same schedule.
   * @param {ScheduledRun} schedule
   */
  async executeSchedule(schedule) {
    // Prevent concurrent execution
    if (this.executing.has(schedule.id)) {
      console.warn(`Scheduler: ${schedule.name} already executing, skipping`);
      return;
    }

    this.executing.add(schedule.id);
    const startTime = Date.now();

    try {
      // Handle special 'digest' mode
      if (schedule.test_mode === 'digest') {
        await this.sendDailyDigest(schedule);
        return;
      }

      this.emit('schedule:started', { schedule, startTime });

      // Notify start if configured
      if (schedule.notify_on_start) {
        await this.notifier.send(
          this.defaultRecipient,
          `🏃 Starting scheduled run: ${schedule.name}\n` +
          `Mode: ${schedule.test_mode} | Agents: ${JSON.parse(schedule.agents).join(', ')}`
        );
      }

      // Load app configuration for the orchestrator
      const appConfig = this.loadAppConfig(schedule.app_id);

      // Execute tests via orchestrator
      // Note: orchestrator.run() expects (appConfig, options) — NOT (appId, options)
      const result = await this.orchestrator.run(appConfig, {
        mode: schedule.test_mode,
        agents: JSON.parse(schedule.agents),
        environment: schedule.environment,
        triggered_by: 'scheduled',
        triggered_via: 'cron',
        schedule_id: schedule.id
      });

      // Update schedule tracking
      await this.scheduledRunRepo.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: result.summary.failed > 0 ? 'failed' : 'passed',
        last_run_id: result.testRunId
      });

      // Notify completion
      const shouldNotify = schedule.notify_on_complete &&
        (!schedule.notify_only_failures || result.summary.failed > 0);

      if (shouldNotify) {
        await this.notifier.send(
          this.defaultRecipient,
          this.formatCompletionMessage(schedule, result, startTime)
        );
      }

      this.emit('schedule:completed', { schedule, result });

    } catch (error) {
      console.error(`Scheduler: Error in ${schedule.name}:`, error.message);

      await this.scheduledRunRepo.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: 'error'
      });

      // Always notify on errors
      await this.notifier.send(
        this.defaultRecipient,
        `❌ Scheduled run "${schedule.name}" failed with error:\n${error.message}`
      );

      this.emit('schedule:error', { schedule, error });

    } finally {
      this.executing.delete(schedule.id);
    }
  }

  /**
   * Format a completion notification message.
   * @param {ScheduledRun} schedule
   * @param {Object} result
   * @param {number} startTime
   * @returns {string}
   */
  formatCompletionMessage(schedule, result, startTime) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const { summary } = result;
    const icon = summary.failed > 0 ? '🔴' : '✅';

    return [
      `${icon} ${schedule.name} Complete`,
      ``,
      `Tests: ${summary.passed}/${summary.total_tests} passed`,
      `Duration: ${duration}s`,
      summary.failed > 0 ? `Failed: ${summary.failed} test(s)` : '',
      summary.bugs_created > 0 ? `Bugs: ${summary.bugs_created} new` : '',
      `Pass rate: ${summary.pass_rate.toFixed(1)}%`
    ].filter(Boolean).join('\n');
  }

  /**
   * Send daily digest summarizing last 24h of test results.
   * @param {ScheduledRun} schedule
   */
  async sendDailyDigest(schedule) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const runs = await this.testRunRepo.getRunsSince(
      schedule.app_id,
      since
    );
    // See Part 8b: TestRunRepository Extension for the required getRunsSince() method

    if (runs.length === 0) {
      await this.notifier.send(
        this.defaultRecipient,
        `📊 Daily Digest: No test runs in the last 24 hours.`
      );
      return;
    }

    const totalTests = runs.reduce(
      (sum, r) => sum + (r.summary?.total_tests || 0), 0
    );
    const totalPassed = runs.reduce(
      (sum, r) => sum + (r.summary?.passed || 0), 0
    );
    const totalFailed = runs.reduce(
      (sum, r) => sum + (r.summary?.failed || 0), 0
    );
    const bugsCreated = runs.reduce(
      (sum, r) => sum + (r.summary?.bugs_created || 0), 0
    );
    const passRate = totalTests > 0
      ? ((totalPassed / totalTests) * 100).toFixed(1)
      : 'N/A';

    const failedRuns = runs.filter(
      r => r.summary?.failed > 0 || r.status === 'failed'
    );

    const message = [
      `📊 Daily QA Digest — ${new Date().toLocaleDateString()}`,
      ``,
      `Runs: ${runs.length}`,
      `Tests: ${totalPassed}/${totalTests} passed (${passRate}%)`,
      totalFailed > 0 ? `⚠️ ${totalFailed} failures across ${failedRuns.length} run(s)` : '✅ All tests passing',
      bugsCreated > 0 ? `🐛 ${bugsCreated} new bug(s) created` : '',
      ``,
      failedRuns.length > 0
        ? `Failed runs:\n${failedRuns.map(r => `  • ${r.triggered_by} at ${new Date(r.started_at).toLocaleTimeString()}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n');

    await this.notifier.send(this.defaultRecipient, message);
    this.emit('digest:sent', { date: new Date(), runs: runs.length });
  }

  // ===== SCHEDULE MANAGEMENT =====

  /**
   * Create a new schedule.
   * @param {Partial<ScheduledRun>} config
   * @returns {ScheduledRun}
   */
  async createSchedule(config) {
    const schedule = {
      id: config.id || crypto.randomUUID(),
      app_id: config.app_id,
      name: config.name,
      cron_expression: config.cron_expression,
      test_mode: config.test_mode || 'smoke',
      agents: JSON.stringify(config.agents || []),
      environment: config.environment || 'staging',
      enabled: config.enabled !== false ? 1 : 0,
      notify_on_start: config.notify_on_start ? 1 : 0,
      notify_on_complete: config.notify_on_complete !== false ? 1 : 0,
      notify_only_failures: config.notify_only_failures ? 1 : 0
    };

    await this.scheduledRunRepo.create(schedule);

    if (schedule.enabled) {
      this.registerTask(schedule);
    }

    return schedule;
  }

  /**
   * Pause a schedule.
   * @param {string} scheduleId
   */
  async pauseSchedule(scheduleId) {
    if (this.activeTasks.has(scheduleId)) {
      this.activeTasks.get(scheduleId).stop();
      this.activeTasks.delete(scheduleId);
    }
    await this.scheduledRunRepo.setEnabled(scheduleId, false);
    console.log(`Scheduler: Paused ${scheduleId}`);
  }

  /**
   * Resume a paused schedule.
   * @param {string} scheduleId
   */
  async resumeSchedule(scheduleId) {
    const schedule = await this.scheduledRunRepo.getById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    await this.scheduledRunRepo.setEnabled(scheduleId, true);
    this.registerTask({ ...schedule, enabled: 1 });
    console.log(`Scheduler: Resumed ${scheduleId}`);
  }

  /**
   * Trigger an immediate run of a schedule (ignoring cron timing).
   * @param {string} scheduleId
   * @returns {Object} Test run result
   */
  async runNow(scheduleId) {
    const schedule = await this.scheduledRunRepo.getById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    await this.executeSchedule(schedule);
  }

  /**
   * Update cron expression for a schedule.
   * @param {string} scheduleId
   * @param {string} cronExpression
   */
  async updateCron(scheduleId, cronExpression) {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    await this.scheduledRunRepo.updateCron(scheduleId, cronExpression);

    // Re-register if active
    const schedule = await this.scheduledRunRepo.getById(scheduleId);
    if (schedule && schedule.enabled) {
      this.registerTask(schedule);
    }
  }

  /**
   * List all schedules with their status.
   * @param {string} [appId]
   * @returns {Array<ScheduledRun & { next_run: string }>}
   */
  async listSchedules(appId) {
    const schedules = appId
      ? await this.scheduledRunRepo.getByApp(appId)
      : await this.scheduledRunRepo.getAll();

    return schedules.map((s) => ({
      ...s,
      is_running: this.executing.has(s.id),
      has_active_task: this.activeTasks.has(s.id)
    }));
  }
}

module.exports = Scheduler;
```

### File: `core/database/repositories/scheduled-run-repository.js`

> **Important:** This follows the existing repository pattern. All data access extends `BaseRepository`
> with its `connection` wrapper. Repositories are instantiated in `core/database/index.js` via
> `createDatabase()` and provided to consumers as `db.scheduledRuns`.

```javascript
'use strict';

const BaseRepository = require('./base-repository');

/**
 * Repository for scheduled_runs table.
 * Extends BaseRepository for consistency with existing data access patterns.
 *
 * @extends BaseRepository
 */
class ScheduledRunRepository extends BaseRepository {
  constructor(connection) {
    super(connection, 'scheduled_runs');
  }

  /**
   * Get all enabled schedules.
   * @returns {ScheduledRun[]}
   */
  getEnabled() {
    return this.connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE enabled = 1')
      .all();
  }

  /**
   * Get all schedules.
   * @returns {ScheduledRun[]}
   */
  getAll() {
    return this.connection.db
      .prepare('SELECT * FROM scheduled_runs ORDER BY created_at')
      .all();
  }

  /**
   * Get schedules for a specific app.
   * @param {string} appId
   * @returns {ScheduledRun[]}
   */
  getByApp(appId) {
    return this.connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE app_id = ? ORDER BY created_at')
      .all(appId);
  }

  /**
   * Get a schedule by ID.
   * @param {string} id
   * @returns {ScheduledRun|null}
   */
  getById(id) {
    return this.connection.db
      .prepare('SELECT * FROM scheduled_runs WHERE id = ?')
      .get(id) || null;
  }

  /**
   * Create a new schedule.
   * Uses crypto.randomUUID() for ID generation, consistent with BaseRepository._generateId().
   * @param {Partial<ScheduledRun>} schedule
   * @returns {ScheduledRun}
   */
  create(schedule) {
    const id = schedule.id || this._generateId();
    this.connection.db.prepare(`
      INSERT INTO scheduled_runs (
        id, app_id, name, cron_expression, test_mode, agents,
        environment, enabled, notify_on_start, notify_on_complete,
        notify_only_failures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, schedule.app_id, schedule.name,
      schedule.cron_expression, schedule.test_mode, schedule.agents,
      schedule.environment, schedule.enabled ?? 1,
      schedule.notify_on_start ?? 0, schedule.notify_on_complete ?? 1,
      schedule.notify_only_failures ?? 0
    );
    return this.getById(id);
  }

  /**
   * Update the last run tracking fields.
   * @param {string} id
   * @param {Object} data
   */
  updateLastRun(id, data) {
    this.connection.db.prepare(`
      UPDATE scheduled_runs
      SET last_run_at = ?, last_run_status = ?, last_run_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(data.last_run_at, data.last_run_status, data.last_run_id || null, id);
  }

  /**
   * Enable or disable a schedule.
   * @param {string} id
   * @param {boolean} enabled
   */
  setEnabled(id, enabled) {
    this.connection.db.prepare(`
      UPDATE scheduled_runs SET enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(enabled ? 1 : 0, id);
  }

  /**
   * Update cron expression.
   * @param {string} id
   * @param {string} cronExpression
   */
  updateCron(id, cronExpression) {
    this.connection.db.prepare(`
      UPDATE scheduled_runs SET cron_expression = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(cronExpression, id);
  }

  /**
   * Delete a schedule.
   * @param {string} id
   */
  delete(id) {
    this.connection.db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(id);
  }
}

module.exports = ScheduledRunRepository;
```

**Registration in `core/database/index.js`:**

```javascript
// Add to createDatabase() function:
const ScheduledRunRepository = require('./repositories/scheduled-run-repository');

// In the return block alongside existing repositories:
scheduledRuns: new ScheduledRunRepository(connection),
```

---

## Part 8: Pre-Deploy Hook

### File: `scripts/pre-deploy.sh`

```bash
#!/bin/bash
# QA Engine Pre-Deploy Hook
# Runs smoke tests before allowing git push.
# Install: cp scripts/pre-deploy.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push

set -e

echo "🔍 QA Engine: Running pre-deploy smoke tests..."
echo ""

# Run smoke tests via CLI
node cli/index.js test --app brainstormy --mode smoke --quiet

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Smoke tests failed! Push blocked."
  echo "   Fix the issues and try again."
  echo "   Skip with: git push --no-verify"
  exit 1
fi

echo ""
echo "✅ Smoke tests passed. Proceeding with push."
exit 0
```

### File: `scripts/setup-scheduler.sh`

```bash
#!/bin/bash
# Set up the QA Engine scheduler.
# Seeds default schedules and starts the scheduler process.

set -e

echo "📅 QA Engine: Setting up scheduler..."

# Run database initialization (which runs Migrator.migrate() automatically)
# This applies any pending migrations including 002_scheduled_runs.sql
node -e "
const { createDatabase } = require('./core/database');
const db = createDatabase();
console.log('Database initialized and migrations applied.');
"

# Seed default schedules
node -e "
const { createDatabase } = require('./core/database');
const db = createDatabase();
const scheduledRuns = db.scheduledRuns;

// Check if already seeded
const existing = scheduledRuns.getAll();
if (existing.length > 0) {
  console.log('Schedules already exist, skipping seed.');
  process.exit(0);
}

// Seed defaults using the repository
scheduledRuns.create({
  id: 'sched-nightly-full',
  app_id: 'brainstormy',
  name: 'Nightly Full Suite',
  cron_expression: '0 2 * * *',
  test_mode: 'full',
  agents: JSON.stringify(['healer', 'sentinel', 'librarian']),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

scheduledRuns.create({
  id: 'sched-weekly-regression',
  app_id: 'brainstormy',
  name: 'Weekly Regression',
  cron_expression: '0 3 * * 0',
  test_mode: 'regression',
  agents: JSON.stringify(['healer', 'sentinel', 'librarian']),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

scheduledRuns.create({
  id: 'sched-daily-digest',
  app_id: 'brainstormy',
  name: 'Daily Digest',
  cron_expression: '0 8 * * *',
  test_mode: 'digest',
  agents: JSON.stringify([]),
  environment: 'staging',
  enabled: 1,
  notify_on_complete: 1
});

console.log('Default schedules seeded.');
"

echo "✅ Scheduler setup complete."
echo "   Start with: npm run start:scheduler"
```

---

## Part 8b: TestRunRepository Extension

> **Required change:** The Scheduler's daily digest calls `testRunRepo.getRunsSince()`, which does not
> exist on `TestRunRepository` today. `BaseRepository.findMany()` only supports simple equality in
> `_buildWhere()` — it cannot do `started_at >= ?`. This follows the pattern of the existing
> `getPassRate()` method in TestRunRepository which also uses raw SQL for date comparisons.

### Addition to: `core/database/repositories/test-run-repository.js`

```javascript
  /**
   * Get test runs for an app since a given timestamp.
   * Used by Scheduler.sendDailyDigest() to aggregate last 24h results.
   *
   * @param {string} appId - App ID to filter by
   * @param {string} sinceIso - ISO timestamp lower bound (inclusive)
   * @returns {TestRun[]}
   */
  getRunsSince(appId, sinceIso) {
    return this.connection.db.prepare(
      `SELECT * FROM test_runs
       WHERE app_id = ? AND started_at >= ?
       ORDER BY started_at DESC`
    ).all(appId, sinceIso);
  }
```

### Tests for getRunsSince() (add to existing test-run-repository test file)

```javascript
describe('getRunsSince()', () => {
  test('returns runs after the given timestamp');
  test('filters by app_id');
  test('returns empty array when no runs match');
  test('orders results by started_at descending');
});
```

> **Test count impact:** +4 tests (total now 75, up from 71).

---

## Part 9: WhatsApp Bot Schedule Commands

These commands extend the WhatsApp bot from Days 1-2 to support schedule management.

> **Integration with existing WhatsApp architecture:**
> The WhatsApp bot uses `MessageParser.parse()` → `CommandHandler.handle()` pipeline.
> `MessageParser` has fixed regex-based routing with priority order (if/else chain):
> approval → help → status → bugs → run → unknown.
>
> **⚠️ Collision risk:** The existing run pattern `/^(?:run|test)(?:\s+(.+))?$/i` would match
> "run nightly now" before schedule patterns are checked. Schedule patterns MUST be inserted
> BEFORE the run pattern in the priority chain.
>
> **Required changes to `interfaces/whatsapp-bot/message-parser.js`:**
>
> ```javascript
> // INSERT THESE CHECKS before the existing run/test pattern check.
> // The order matters — "run X now" must match schedule before generic "run X".
>
> // Schedule: "schedules" (list all)
> if (/^schedules$/i.test(text)) {
>   return { type: 'schedule', command: 'list', raw: text };
> }
>
> // Schedule: "pause <name>"
> const pauseMatch = text.match(/^pause\s+(.+)/i);
> if (pauseMatch) {
>   return { type: 'schedule', command: 'pause', name: pauseMatch[1].trim(), raw: text };
> }
>
> // Schedule: "resume <name>"
> const resumeMatch = text.match(/^resume\s+(.+)/i);
> if (resumeMatch) {
>   return { type: 'schedule', command: 'resume', name: resumeMatch[1].trim(), raw: text };
> }
>
> // Schedule: "<name> now" or "run <name> now" (MUST come before generic "run" pattern)
> const runNowMatch = text.match(/^(?:run\s+)?(.+?)\s+now$/i);
> if (runNowMatch) {
>   return { type: 'schedule', command: 'run_now', name: runNowMatch[1].trim(), raw: text };
> }
>
> // Schedule: "change <name> to <cron>"
> const changeMatch = text.match(/^change\s+(.+?)\s+to\s+(.+)/i);
> if (changeMatch) {
>   return { type: 'schedule', command: 'update_cron', name: changeMatch[1].trim(),
>            cron: changeMatch[2].trim(), raw: text };
> }
>
> // Schedule: "digest"
> if (/^digest$/i.test(text)) {
>   return { type: 'schedule', command: 'digest', raw: text };
> }
>
> // ... THEN the existing run/test pattern follows ...
> ```
>
> **Required changes to `interfaces/whatsapp-bot/command-handler.js`:**
>
> ```javascript
> // 1. Add to constructor:
> constructor({ orchestrator, notifier, scheduler, ...other }) {
>   // ... existing setup ...
>   this.scheduleHandler = new ScheduleHandler(scheduler);
> }
>
> // 2. Add case to handle() switch:
> case 'schedule':
>   return await this.scheduleHandler.handle(parsed.raw);
> ```
>
> **Required import in command-handler.js:**
> ```javascript
> const ScheduleHandler = require('./handlers/schedule-handler');
> ```
>
> **Test impact:** Existing WhatsApp bot tests (193 total) should still pass since new patterns
> are additive. Add 2-3 tests verifying "run nightly now" routes to schedule handler (not run handler)
> and "run full" still routes to the existing run handler.
>
> The `ScheduleHandler.canHandle()` method below is retained for standalone use and testing,
> but in production, routing is handled by `MessageParser`.

### File: `interfaces/whatsapp-bot/handlers/schedule-handler.js`

```javascript
'use strict';

/**
 * Handles WhatsApp commands related to schedule management.
 * Extends the WhatsApp bot with schedule-specific commands.
 *
 * Commands:
 *   "schedules"            → List all schedules
 *   "pause <name>"         → Pause a schedule
 *   "resume <name>"        → Resume a schedule
 *   "run <name> now"       → Trigger immediate execution
 *   "change <name> to <cron>" → Update cron expression
 */
class ScheduleHandler {
  /**
   * @param {import('../../../core/scheduler')} scheduler
   */
  constructor(scheduler) {
    this.scheduler = scheduler;
  }

  /**
   * Check if a message is a schedule command.
   * @param {string} message - Normalized message text
   * @returns {boolean}
   */
  canHandle(message) {
    const lower = message.toLowerCase().trim();
    return (
      lower === 'schedules' ||
      lower.startsWith('pause ') ||
      lower.startsWith('resume ') ||
      lower.includes(' now') ||
      lower.startsWith('change ') ||
      lower === 'next run' ||
      lower === 'digest'
    );
  }

  /**
   * Handle a schedule command.
   * @param {string} message - Raw message text
   * @returns {{ text: string }} Response
   */
  async handle(message) {
    const lower = message.toLowerCase().trim();

    if (lower === 'schedules') {
      return this.listSchedules();
    }

    if (lower.startsWith('pause ')) {
      const name = message.slice(6).trim();
      return this.pauseSchedule(name);
    }

    if (lower.startsWith('resume ')) {
      const name = message.slice(7).trim();
      return this.resumeSchedule(name);
    }

    if (lower.endsWith(' now') || lower.startsWith('run ')) {
      const name = message.replace(/^run\s+/i, '').replace(/\s+now$/i, '').trim();
      return this.runNow(name);
    }

    if (lower === 'digest') {
      const digestSchedule = (await this.scheduler.listSchedules())
        .find((s) => s.test_mode === 'digest');
      if (digestSchedule) {
        await this.scheduler.runNow(digestSchedule.id);
        return { text: '📊 Digest sent!' };
      }
      return { text: 'No digest schedule configured.' };
    }

    if (lower.startsWith('change ')) {
      return this.updateCron(message);
    }

    return { text: 'Unknown schedule command. Try: schedules, pause, resume, run now' };
  }

  /**
   * List all schedules.
   */
  async listSchedules() {
    const schedules = await this.scheduler.listSchedules();

    if (schedules.length === 0) {
      return { text: 'No schedules configured.' };
    }

    const lines = schedules.map((s) => {
      const status = s.enabled ? '✅' : '⏸️';
      const running = s.is_running ? ' 🏃' : '';
      const lastRun = s.last_run_at
        ? `Last: ${new Date(s.last_run_at).toLocaleString()}`
        : 'Never run';
      const lastStatus = s.last_run_status
        ? ` (${s.last_run_status})`
        : '';

      return `${status} ${s.name}${running}\n   ${s.cron_expression} | ${s.test_mode}\n   ${lastRun}${lastStatus}`;
    });

    return { text: `📅 Schedules:\n\n${lines.join('\n\n')}` };
  }

  /**
   * Pause a schedule by name.
   * @param {string} name
   */
  async pauseSchedule(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    await this.scheduler.pauseSchedule(schedule.id);
    return { text: `⏸️ Paused: ${schedule.name}` };
  }

  /**
   * Resume a schedule by name.
   * @param {string} name
   */
  async resumeSchedule(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    await this.scheduler.resumeSchedule(schedule.id);
    return { text: `▶️ Resumed: ${schedule.name}` };
  }

  /**
   * Trigger immediate execution.
   * @param {string} name
   */
  async runNow(name) {
    const schedule = await this.findScheduleByName(name);
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    // Run async — don't await (will send notification when done)
    this.scheduler.runNow(schedule.id).catch((err) => {
      console.error(`Run now failed for ${schedule.name}:`, err);
    });

    return { text: `🏃 Starting: ${schedule.name}\nYou'll get a notification when it completes.` };
  }

  /**
   * Update cron expression. Format: "change <name> to <cron>"
   * @param {string} message
   */
  async updateCron(message) {
    const match = message.match(/^change\s+(.+?)\s+to\s+(.+)$/i);
    if (!match) {
      return { text: 'Format: change <schedule name> to <cron expression>' };
    }

    const [, name, cronExpr] = match;
    const schedule = await this.findScheduleByName(name.trim());
    if (!schedule) {
      return { text: `Schedule "${name}" not found.` };
    }

    try {
      await this.scheduler.updateCron(schedule.id, cronExpr.trim());
      return { text: `🔄 Updated "${schedule.name}" to: ${cronExpr.trim()}` };
    } catch (error) {
      return { text: `❌ ${error.message}` };
    }
  }

  /**
   * Find a schedule by partial name match.
   * @param {string} name
   * @returns {ScheduledRun|null}
   */
  async findScheduleByName(name) {
    const schedules = await this.scheduler.listSchedules();
    const lower = name.toLowerCase();

    return schedules.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        s.name.toLowerCase().includes(lower)
    ) || null;
  }
}

module.exports = ScheduleHandler;
```

---

## Part 10: Connector Factory — No Changes Needed

> **Important:** The existing `connectors/factory.js` already registers BrainstormyConnector and should NOT be replaced.

The current factory has features the spec's simplified version would lose:

- `CONNECTOR_REGISTRY` static property (used by existing tests)
- `{ skipInitialize }` option on `create()` (used in unit tests to avoid full browser init)
- `getRegisteredTypes()` method (used for introspection)
- `ConnectorError` class from `./errors` (structured error handling)
- `register()` uses `ConnectorFactory.CONNECTOR_REGISTRY` (not `this.connectors`)

The BrainstormyConnector is already registered in the factory's `CONNECTOR_REGISTRY` as:

```javascript
'brainstormy': BrainstormyConnector
```

**Action for Claude Code:** Verify `BrainstormyConnector` is registered. If not, add it via:

```javascript
// In connectors/factory.js — add to CONNECTOR_REGISTRY and imports
const BrainstormyConnector = require('./brainstormy/connector');

// In CONNECTOR_REGISTRY:
'brainstormy': BrainstormyConnector
```

---

## Part 11: Test Specifications

### Test: `tests/connectors/brainstormy-connector.test.js`

```javascript
// Target: 25 tests

describe('BrainstormyConnector', () => {
  describe('constructor', () => {
    test('initializes with null project/story/session IDs');
    test('sets up empty createdEntities array');
  });

  describe('initialize()', () => {
    test('navigates to staging URL');
    test('calls authenticate when auth required');
    test('throws on auth failure');
    test('collects evidence for initial load and auth');
    test('waits for app ready indicator');
  });

  describe('authenticate()', () => {
    test('fills Clerk email input with configured email');
    test('fills Clerk password input from env var');
    test('clicks submit and waits for user menu');
    test('returns false on timeout');
    test('collects evidence on failure');
  });

  describe('performAction()', () => {
    test('routes create_project to createProject');
    test('routes create_story to createStory');
    test('routes create_session to createSession');
    test('routes generate_bible to generateStoryBible');
    test('routes search to performSearch');
    test('routes send_message to parent AIAppConnector');
    test('routes unknown action to parent chain');
    test('collects before/after evidence for every action');
  });

  describe('createProject()', () => {
    test('navigates to /projects, clicks new, fills name');
    test('extracts project ID from URL');
    test('stores project ID in state');
    test('tracks entity for cleanup');
  });

  describe('createStory()', () => {
    test('throws if no project selected');
    test('fills story name and vertical');
    test('extracts story ID from URL');
  });

  describe('createSession()', () => {
    test('throws if no story selected');
    test('selects session type');
    test('extracts session ID from URL');
  });

  describe('generateStoryBible()', () => {
    test('selects template and clicks generate');
    test('waits for generation indicator to disappear');
    test('extracts sections from page');
    test('returns section count');
  });

  describe('performSearch()', () => {
    test('fills search input and submits');
    test('extracts result items');
    test('returns count');
  });

  describe('cleanup()', () => {
    test('logs created entities');
    test('calls parent cleanup (logout)');
  });
});
```

### Test: `tests/core/scheduler.test.js`

```javascript
// Target: 22 tests

describe('Scheduler', () => {
  describe('start()', () => {
    test('loads enabled schedules from database');
    test('registers cron tasks for each schedule');
    test('sets running flag to true');
    test('warns if already running');
  });

  describe('stop()', () => {
    test('stops all active cron tasks');
    test('clears activeTasks map');
    test('sets running flag to false');
  });

  describe('registerTask()', () => {
    test('validates cron expression');
    test('logs error for invalid cron');
    test('stops existing task before re-registering');
    test('creates new cron.schedule task');
  });

  describe('executeSchedule()', () => {
    test('prevents concurrent execution of same schedule');
    test('sends start notification when configured');
    test('calls orchestrator.run with appConfig and correct options');
    test('updates last_run_at and status after completion');
    test('notifies on completion when configured');
    test('notifies only on failures when notify_only_failures set');
    test('handles errors and sends error notification');
    test('removes from executing set in finally block');
    test('routes digest mode to sendDailyDigest');
  });

  describe('sendDailyDigest()', () => {
    test('aggregates test runs from last 24 hours');
    test('formats message with pass/fail counts');
    test('handles zero runs gracefully');
    test('emits digest:sent event');
  });

  describe('schedule management', () => {
    test('createSchedule persists to DB and registers task');
    test('pauseSchedule stops task and updates DB');
    test('resumeSchedule re-registers task and updates DB');
    test('runNow triggers immediate execution');
    test('updateCron validates and updates expression');
    test('listSchedules returns all with running status');
  });
});
```

### Test: `tests/whatsapp-bot/schedule-handler.test.js`

```javascript
// Target: 14 tests

describe('ScheduleHandler', () => {
  describe('canHandle()', () => {
    test('returns true for "schedules"');
    test('returns true for "pause nightly"');
    test('returns true for "resume nightly"');
    test('returns true for "run nightly now"');
    test('returns true for "nightly now"');
    test('returns true for "change nightly to 0 3 * * *"');
    test('returns true for "digest"');
    test('returns false for unrelated messages');
  });

  describe('handle()', () => {
    test('listSchedules returns formatted list');
    test('pauseSchedule pauses by partial name match');
    test('resumeSchedule resumes by name');
    test('runNow triggers async execution');
    test('updateCron validates and applies new expression');
    test('returns error for unknown schedule name');
  });
});
```

### Test: `tests/database/scheduled-run-repository.test.js`

```javascript
// Target: 10 tests

describe('ScheduledRunRepository', () => {
  test('getEnabled returns only enabled schedules');
  test('getAll returns all schedules ordered by created_at');
  test('getByApp filters by app_id');
  test('getById returns schedule or null');
  test('create inserts a new schedule');
  test('updateLastRun updates tracking fields');
  test('setEnabled toggles enabled flag');
  test('updateCron updates cron_expression');
  test('delete removes schedule');
  test('create and getById round-trip preserves data');
});
```

**Total test target: 75 tests (71 original + 4 getRunsSince)**

---

## Part 12: Mock Patterns

### Mock Playwright Page

```javascript
/**
 * Create a mock Playwright page for unit testing.
 * Used by BrainstormyConnector tests.
 */
function createMockPage() {
  const page = {
    goto: jest.fn().mockResolvedValue(),
    url: jest.fn().mockReturnValue('https://staging.brainstormy.app/projects/abc-123'),
    fill: jest.fn().mockResolvedValue(),
    click: jest.fn().mockResolvedValue(),
    press: jest.fn().mockResolvedValue(),
    hover: jest.fn().mockResolvedValue(),
    textContent: jest.fn().mockResolvedValue('Mock content'),
    waitForSelector: jest.fn().mockResolvedValue(),
    waitForNavigation: jest.fn().mockResolvedValue(),
    waitForTimeout: jest.fn().mockResolvedValue(),
    selectOption: jest.fn().mockResolvedValue(),
    $$: jest.fn().mockResolvedValue([]),
    $: jest.fn().mockResolvedValue(null),
    $eval: jest.fn().mockResolvedValue(''),
    evaluate: jest.fn().mockResolvedValue(null)
  };
  return page;
}
```

### Mock Evidence Collector

```javascript
/**
 * Create a mock EvidenceCollector for unit testing.
 */
function createMockEvidenceCollector() {
  return {
    captureScreenshot: jest.fn().mockResolvedValue('/evidence/mock-screenshot.png'),
    getConsoleLogs: jest.fn().mockResolvedValue([]),
    getNetworkRequests: jest.fn().mockResolvedValue([]),
    collectAll: jest.fn().mockResolvedValue({
      screenshots: [],
      console_logs: [],
      network_requests: []
    })
  };
}
```

### Mock Orchestrator (for Scheduler tests)

```javascript
/**
 * Create a mock TestOrchestrator for Scheduler tests.
 */
function createMockOrchestrator() {
  return {
    run: jest.fn().mockResolvedValue({
      testRunId: 'run-mock-123',
      summary: {
        total_tests: 15,
        passed: 14,
        failed: 1,
        skipped: 0,
        pass_rate: 93.3,
        bugs_created: 1,
        duration_ms: 45000
      }
    })
  };
}
```

### Mock SQLite Database (for ScheduledRunRepository tests)

```javascript
/**
 * Create an in-memory SQLite database wrapped in a connection object
 * for ScheduledRunRepository tests.
 * The connection wrapper matches the shape expected by BaseRepository.
 */
function createTestDb() {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');

  // Create scheduled_runs table
  db.exec(`
    CREATE TABLE scheduled_runs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      test_mode TEXT NOT NULL DEFAULT 'smoke',
      agents TEXT NOT NULL DEFAULT '[]',
      environment TEXT NOT NULL DEFAULT 'staging',
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_on_start INTEGER NOT NULL DEFAULT 0,
      notify_on_complete INTEGER NOT NULL DEFAULT 1,
      notify_only_failures INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_run_status TEXT,
      last_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Return connection wrapper matching BaseRepository expectations
  return { db };
}
```

---

## Part 13: Files to Create

| File | Purpose | LOC (est.) |
|---|---|---|
| `connectors/brainstormy/connector.js` | BrainstormyConnector diff-merge additions | ~450 |
| `connectors/brainstormy/selectors.js` | Default selector definitions (camelCase) | ~80 |
| `apps/brainstormy/app.config.json` | App configuration (existing shape) | ~80 |
| `apps/brainstormy/scenarios/smoke-tests.json` | Smoke test scenarios | ~70 |
| `apps/brainstormy/scenarios/memory-tests.json` | Memory/Sentinel scenarios | ~120 |
| `apps/brainstormy/scenarios/bible-tests.json` | Bible/Librarian scenarios | ~100 |
| `core/scheduler.js` | Scheduler class with node-cron | ~330 |
| `core/database/migrations/002_scheduled_runs.sql` | Migration for scheduled_runs table | ~25 |
| `core/database/repositories/scheduled-run-repository.js` | ScheduledRunRepository (extends BaseRepository) | ~110 |
| `interfaces/whatsapp-bot/handlers/schedule-handler.js` | WhatsApp schedule commands | ~180 |
| `scripts/pre-deploy.sh` | Git pre-push hook | ~25 |
| `scripts/setup-scheduler.sh` | Scheduler setup script | ~40 |
| `tests/connectors/brainstormy-connector.test.js` | Connector unit tests | ~300 |
| `tests/core/scheduler.test.js` | Scheduler unit tests | ~280 |
| `tests/whatsapp-bot/schedule-handler.test.js` | Schedule handler tests | ~150 |
| `tests/database/scheduled-run-repository.test.js` | Model unit tests | ~120 |
| `tests/mocks/playwright-page.js` | Mock page factory | ~30 |
| `tests/mocks/evidence-collector.js` | Mock evidence collector | ~15 |
| `tests/mocks/orchestrator.js` | Mock orchestrator | ~20 |
| `tests/mocks/test-db.js` | In-memory SQLite factory | ~35 |
| **Total** | | **~2,545** |

---

## Part 14: Claude Code Implementation Steps

### Day 3: BrainstormyConnector Core (Steps 1-6)

**Step 1:** Create connector files
```bash
# Verify project structure
ls connectors/ai-chat-app/connector.js  # Should exist from Week 1
ls connectors/base-connector.js          # Should exist from Week 1

# Create Brainstormy connector directory
mkdir -p connectors/brainstormy
mkdir -p apps/brainstormy/scenarios
```

**Step 2:** Implement `connectors/brainstormy/selectors.js`
```bash
# Verify: Node can require the file
node -e "const s = require('./connectors/brainstormy/selectors'); console.log(Object.keys(s).length + ' selectors defined')"
# Expected: ~40+ selectors defined
```

**Step 3:** Implement `connectors/brainstormy/connector.js`
```bash
# Verify: Connector loads and has correct inheritance
node -e "
const B = require('./connectors/brainstormy/connector');
const b = new B({environments:{staging:{url:'x',auth:{required:false}}},connector:{type:'brainstormy'},config:{timeouts:{}}}, {goto:()=>{}}, {collectAll:()=>{}});
console.log('performAction' in b ? 'PASS' : 'FAIL', '- has performAction');
console.log('createProject' in b ? 'PASS' : 'FAIL', '- has createProject');
console.log('generateStoryBible' in b ? 'PASS' : 'FAIL', '- has generateStoryBible');
console.log('performSearch' in b ? 'PASS' : 'FAIL', '- has performSearch');
"
```

**Step 4:** Verify `connectors/factory.js` already registers BrainstormyConnector
```bash
# Verify: Factory can resolve 'brainstormy' type (no changes needed to factory)
node -e "
const F = require('./connectors/factory');
console.log('brainstormy' in F.CONNECTOR_REGISTRY ? 'PASS' : 'FAIL', '- brainstormy registered');
console.log(typeof F.create === 'function' ? 'PASS' : 'FAIL', '- create method exists');
console.log(typeof F.getRegisteredTypes === 'function' ? 'PASS' : 'FAIL', '- getRegisteredTypes exists');
"
```

**Step 5:** Create `apps/brainstormy/app.config.json`
```bash
# Verify: Config is valid JSON and has required fields (existing shape)
node -e "
const c = require('./apps/brainstormy/app.config.json');
console.log(c.id === 'brainstormy' ? 'PASS' : 'FAIL', '- id');
console.log(c.baseUrl ? 'PASS' : 'FAIL', '- baseUrl');
console.log(c.connector.type === 'brainstormy' ? 'PASS' : 'FAIL', '- connector type');
console.log(c.connector.config.auth ? 'PASS' : 'FAIL', '- auth config');
console.log(c.connector.config.selectors.chatInput ? 'PASS' : 'FAIL', '- selectors (camelCase)');
"
```

**Step 6:** Write connector tests
```bash
npm test -- tests/connectors/brainstormy-connector.test.js
# Expected: 25 tests pass
```

### Day 4: Scenarios + Integration (Steps 7-10)

**Step 7:** Create scenario JSON files
```bash
# Verify: All scenario files are valid JSON
node -e "
['smoke-tests','memory-tests','bible-tests'].forEach(f => {
  const s = require('./apps/brainstormy/scenarios/' + f + '.json');
  console.log('PASS -', f, ':', s.scenarios.length, 'scenarios');
});
"
```

**Step 8:** Integration test — connector + scenario loader
```bash
# Verify: Scenario can be loaded and actions resolved
node -e "
const smoke = require('./apps/brainstormy/scenarios/smoke-tests.json');
const B = require('./connectors/brainstormy/connector');
const actions = smoke.scenarios.flatMap(s => s.steps.filter(st => st.action).map(st => st.action));
const unique = [...new Set(actions)];
console.log('Actions used:', unique.join(', '));
console.log('All actions are strings:', unique.every(a => typeof a === 'string') ? 'PASS' : 'FAIL');
"
```

**Step 9:** Verify connector works with mock page against scenario structure
```bash
npm test -- tests/connectors/brainstormy-connector.test.js --verbose
```

**Step 10:** Create mock factories
```bash
node -e "
const { createMockPage } = require('./tests/mocks/playwright-page');
const p = createMockPage();
console.log(typeof p.goto === 'function' ? 'PASS' : 'FAIL', '- mock page');
"
```

### Day 5: Scheduler + Cron (Steps 11-16)

**Pre-requisite:** Install dependencies and register repository
```bash
# Install node-cron (required before Step 13)
npm install node-cron

# Add ScheduledRunRepository to core/database/index.js:
#   const ScheduledRunRepository = require('./repositories/scheduled-run-repository');
#   // In createDatabase() return block:
#   scheduledRuns: new ScheduledRunRepository(connection),
```

**Step 11:** Create `core/database/migrations/002_scheduled_runs.sql` and verify
```bash
# Create migration file, then run database init (Migrator applies it automatically)
node -e "
const { createDatabase } = require('./core/database');
const db = createDatabase();
// Verify table exists
const tables = db.connection.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_runs'\").all();
console.log(tables.length > 0 ? 'PASS' : 'FAIL', '- scheduled_runs table created');
"
```

**Step 12:** Implement `core/database/repositories/scheduled-run-repository.js`
```bash
npm test -- tests/database/scheduled-run-repository.test.js
# Expected: 10 tests pass
```

**Step 12b:** Add `getRunsSince()` to `core/database/repositories/test-run-repository.js`
```bash
# Add method (see Part 8b), then run tests
npm test -- tests/database/test-run-repository.test.js
# Expected: existing tests still pass + 4 new getRunsSince tests
```

**Step 13:** Implement `core/scheduler.js`
```bash
# Verify: Scheduler loads and has correct API
node -e "
const S = require('./core/scheduler');
const s = new S({scheduledRunRepo:{getEnabled:()=>[]},orchestrator:{},notifier:{},testRunRepo:{},loadAppConfig:()=>({})});
console.log('start' in s ? 'PASS' : 'FAIL', '- has start');
console.log('stop' in s ? 'PASS' : 'FAIL', '- has stop');
console.log('createSchedule' in s ? 'PASS' : 'FAIL', '- has createSchedule');
console.log('pauseSchedule' in s ? 'PASS' : 'FAIL', '- has pauseSchedule');
console.log('runNow' in s ? 'PASS' : 'FAIL', '- has runNow');
"
```

**Step 14:** Run scheduler tests
```bash
npm test -- tests/core/scheduler.test.js
# Expected: 22 tests pass
```

**Step 15:** Implement `interfaces/whatsapp-bot/handlers/schedule-handler.js`
```bash
npm test -- tests/whatsapp-bot/schedule-handler.test.js
# Expected: 14 tests pass
```

**Step 16:** Setup scripts and pre-deploy hook
```bash
chmod +x scripts/pre-deploy.sh
chmod +x scripts/setup-scheduler.sh

# Verify pre-deploy script syntax
bash -n scripts/pre-deploy.sh && echo "PASS - valid bash"

# Run setup
bash scripts/setup-scheduler.sh
```

**Final validation:**
```bash
# Run all tests from this spec
npm test -- tests/connectors/brainstormy-connector.test.js \
            tests/core/scheduler.test.js \
            tests/whatsapp-bot/schedule-handler.test.js \
            tests/database/scheduled-run-repository.test.js

# Expected: 75 tests, 75 passing
```

---

## Part 15: Validation Criteria Checklist

### BrainstormyConnector

- [ ] Extends AIAppConnector correctly (inheritance chain intact)
- [ ] `initialize()` navigates to staging URL and authenticates
- [ ] `authenticate()` handles Clerk email/password flow
- [ ] `performAction()` routes all Brainstormy-specific actions
- [ ] `createProject()` creates project and extracts ID from URL
- [ ] `createStory()` creates story with vertical selection
- [ ] `createSession()` creates session with type selection
- [ ] `generateStoryBible()` triggers generation and waits for completion
- [ ] `performSearch()` fills input, submits, extracts results
- [ ] `createBookmark()` bookmarks a message with title
- [ ] `endSession()` triggers session end and summary generation
- [ ] `cleanup()` logs created entities and calls parent cleanup
- [ ] Collects evidence before/after every `performAction` call
- [ ] All selectors configurable via app.config.json
- [ ] ConnectorFactory resolves 'brainstormy' to BrainstormyConnector
- [ ] Smoke scenario JSON valid and all actions resolvable
- [ ] Memory scenario JSON valid with cross-session tests
- [ ] Bible scenario JSON valid with generation and citation checks

### Scheduler

- [ ] Loads enabled schedules from SQLite on startup
- [ ] Registers valid cron tasks for each enabled schedule
- [ ] Prevents concurrent execution of the same schedule
- [ ] Executes tests via TestOrchestrator.run(appConfig, options)
- [ ] Updates last_run tracking in database after each run
- [ ] Sends start/completion/error notifications via WhatsApp
- [ ] Supports notify_only_failures configuration
- [ ] Daily digest aggregates last 24h of results
- [ ] `createSchedule()` persists and registers new schedule
- [ ] `pauseSchedule()` stops task and disables in DB
- [ ] `resumeSchedule()` re-registers task and enables in DB
- [ ] `runNow()` triggers immediate execution
- [ ] `updateCron()` validates and applies new expression
- [ ] WhatsApp handler responds to "schedules" command
- [ ] WhatsApp handler handles pause/resume/run now
- [ ] Pre-deploy script runs smoke tests and blocks on failure
- [ ] scheduled_runs table created with correct schema
- [ ] Default schedules seeded (nightly, weekly, digest)

### Test Coverage

- [ ] 25 BrainstormyConnector tests passing
- [ ] 22 Scheduler tests passing
- [ ] 14 ScheduleHandler tests passing
- [ ] 10 ScheduledRunRepository tests passing
- [ ] 4 TestRunRepository.getRunsSince tests passing
- [ ] Total: 75 tests passing
- [ ] All mock factories functional

---

## Appendix A: Environment Variables Required

```bash
# .env additions for Days 3-5

# Brainstormy test account (Clerk email/password)
BRAINSTORMY_TEST_PASSWORD=<staging test account password>
BRAINSTORMY_PROD_TEST_PASSWORD=<production test account password>

# Already configured from prior weeks:
# TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
# ANTHROPIC_API_KEY
# LINEAR_API_KEY
```

## Appendix B: npm Dependencies Added

```bash
npm install node-cron
# Already installed: playwright, better-sqlite3, express, twilio
# Note: uuid is NOT needed — uses crypto.randomUUID() for ID generation,
# consistent with BaseRepository._generateId() pattern
```

## Appendix C: Relationship to Existing Specs

| This Spec Component | References |
|---|---|
| BrainstormyConnector | qa-engine-03-connector-pattern-spec.md §Brainstormy Connector |
| Connector factory update | qa-engine-03-connector-pattern-spec.md §Connector Factory |
| Scheduler | qa-engine-05-implementation-plan.md §Week 4 Day 5 |
| scheduled_runs table | qa-engine-04-database-schema-spec.md (new table) |
| WhatsApp schedule commands | whatsapp-bot-implementation-spec.md (handler extension) |
| Test scenarios (smoke, memory, bible) | qa-engine-05-implementation-plan.md §Week 2 |
| Agent-feature mapping | qa-engine-01-overview-and-architecture.md §Agents |
| Pre-deploy hook | qa-engine-05-implementation-plan.md §Week 4 Day 5 |

---

## Appendix D: Changes from v1.0 (Post-Evaluation Fixes)

This section documents all changes made after Claude Code's feasibility evaluation of v1.0.

### Critical Fixes (C1-C3)

| ID | Issue | Fix Applied |
|---|---|---|
| **C1** | `orchestrator.runTests()` doesn't exist; actual API is `orchestrator.run(appConfig, options)` | Replaced all `runTests` calls with `run()`. Added `loadAppConfig` function to Scheduler constructor to load appConfig by ID before passing to orchestrator. Updated mock orchestrator, test descriptions, and validation checklist. |
| **C2** | ConnectorFactory replacement would break `skipInitialize`, `CONNECTOR_REGISTRY`, `getRegisteredTypes()`, `ConnectorError` | Removed factory.js replacement entirely. Part 10 now documents that existing factory already registers BrainstormyConnector — no changes needed. |
| **C3** | `uuid` package not in dependencies | Replaced `require('uuid')` with `crypto.randomUUID()`, consistent with `BaseRepository._generateId()` pattern. No new dependency needed. |

### Moderate Fixes (M1-M7)

| ID | Issue | Fix Applied |
|---|---|---|
| **M1** | app.config.json structural mismatch (nested environments, snake_case, wrong field names) | Rewrote config to match existing shape: `id` not `app_id`, `baseUrl` top-level, `connector.type: "brainstormy"`, auth under `connector.config.auth`, camelCase selectors/timeouts. Updated all connector methods (`getEnvironment()`, `getTimeout()`, `authenticate()`, `navigate()`) and all `getSelector()` calls to use camelCase keys. |
| **M2** | ScheduledRunModel bypasses BaseRepository pattern | Rewritten as `ScheduledRunRepository extends BaseRepository` with `connection` wrapper. Registered in `createDatabase()` as `db.scheduledRuns`. Updated mock test-db to provide connection wrapper. |
| **M3** | Missing database migration file | Added `core/database/migrations/002_scheduled_runs.sql` with proper migration file convention. Updated Step 11 to use `createDatabase()` which runs Migrator automatically. |
| **M4** | `testRunModel.getRunsSince()` doesn't exist | Added implementation note with the SQL query that must be added to `TestRunRepository`. |
| **M5** | BrainstormyConnector already exists (422 lines) | Added diff-merge warning: Part 4 now documents this as a merge target, not a replacement. Lists specific additions needed. |
| **M6** | selectors.js used snake_case; existing config uses camelCase in `connector.config.selectors` | Converted all selector keys to camelCase. Added note clarifying selectors.js as defaults file with merge pattern. |
| **M7** | WhatsApp ScheduleHandler needs routing through existing MessageParser → CommandHandler pipeline | Added integration notes with specific patterns to add to MessageParser and routing in CommandHandler. |

### Minor Fixes (m1-m5)

| ID | Issue | Fix Applied |
|---|---|---|
| **m1** | node-cron not in package.json | Already documented in Appendix B (no change needed). |
| **m2** | setup-scheduler.sh used wrong DB initialization pattern | Rewrote to use `createDatabase()` and `db.scheduledRuns` repository. |
| **m3** | References to nonexistent `scripts/migrate.js` | Removed all references; migrations run via `createDatabase()` → `Migrator.migrate()`. |
| **m4** | `notifier.send(null, message)` — null recipient | Added `defaultRecipient` option to Scheduler constructor (falls back to `WHATSAPP_DEFAULT_RECIPIENT` env var). All `send()` calls now use `this.defaultRecipient`. |
| **m5** | `setup_test_project` action missing from performAction | Already present in spec (was false positive in evaluation). |

### Naming Convention Changes (throughout)

| Old (v1.0) | New (v1.1) | Reason |
|---|---|---|
| `scheduledRunModel` | `scheduledRunRepo` | Follows BaseRepository pattern |
| `testRunModel` | `testRunRepo` | Follows BaseRepository pattern |
| `ScheduledRunModel` | `ScheduledRunRepository` | Extends BaseRepository |
| `app_id` (config) | `id` | Matches existing config convention |
| `password_env` | `passwordEnv` | camelCase consistency |
| `clerk_email_password` | `email_password` | Matches existing auth type |
| `ai_response` (timeout) | `aiResponse` | camelCase consistency |
| `clerk_email_input` (selector) | `clerkEmailInput` | camelCase consistency |
| All snake_case selectors | All camelCase selectors | Matches existing `connector.config.selectors` |

---

### Changes from v1.1 → v1.2 (Post-Evaluation v2 Fixes)

| ID | Issue | Fix Applied |
|---|---|---|
| **C1** | `connector.type: "ai-chat-app"` causes factory to create AIAppConnector instead of BrainstormyConnector | Changed to `connector.type: "brainstormy"` in app.config.json, typedef, Step 5 verification, and Appendix D note. |
| **M1** | `TestRunRepository.getRunsSince()` needed but only had inline comment, no tests | Added Part 8b with full method implementation, 4 test specs, and Step 12b. Updated total test target from 71 → 75. |
| **M2** | `BaseConnector.getSelector()` reads `this.app.config?.selectors` but config puts selectors at `this.app.connector.config.selectors` | Added `getSelector()` override in BrainstormyConnector that resolves from `connector.config.selectors` with fallback to `DEFAULT_SELECTORS`. |
| **M3** | Diff-merge guidance was too vague for 422-line existing file with overlapping methods | Expanded to concrete KEEP/ADD/RECONCILE decisions covering `_extractIdFromUrl()`, `waitForAIResponse()`, `extractCitations()`, `ConnectorError`, and selector casing. |
| **M4** | WhatsApp schedule patterns could collide with existing `run` command (`"run nightly now"` matches run before schedule) | Replaced integration notes with diff-ready code blocks. Schedule patterns explicitly placed BEFORE existing run pattern. Added `"run X now"` collision prevention regex. Added test guidance for routing verification. |
| **m1** | `waitForAppReady()` reads `this.app.config?.ready_indicator` but spec puts it in selectors | Added `waitForAppReady()` override in BrainstormyConnector that resolves `readyIndicator` via `getSelector()`. |
| **m2** | `createDatabase()` needs `scheduledRuns` repository added | Added explicit pre-requisite step in Day 5 with import + return block reminder. |
| **m3** | `npm install node-cron` not sequenced before Step 13 | Added as Day 5 pre-requisite before Step 11. |
