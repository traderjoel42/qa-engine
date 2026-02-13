# QA Engine Week 5 Days 3-5: Real Brainstormy Connector & Scheduling

**Version:** 1.0  
**Date:** February 13, 2026  
**Author:** Joel (with Claude)  
**Status:** Ready for Claude Code Review  
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

**Implementation:** Selectors live in the app config, not hardcoded in the connector. The connector calls `this.getSelector('chat_input')` which resolves from config.

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
- Uses the same `TestOrchestrator.runTests()` entry point as scheduled runs
- Exits with non-zero code to block push if smoke tests fail
- Optional — developers can skip with `--no-verify`

---

## Part 2: Data Structures

### Brainstormy App Configuration

```javascript
/**
 * @typedef {Object} BrainstormyAppConfig
 * @property {string} app_id - 'brainstormy'
 * @property {string} name - 'Brainstormy'
 * @property {string} type - 'ai-chat'
 * @property {BrainstormyEnvironments} environments
 * @property {BrainstormyConnectorConfig} connector
 * @property {BrainstormySelectorConfig} config
 */

/**
 * @typedef {Object} BrainstormyEnvironments
 * @property {BrainstormyEnvConfig} staging
 * @property {BrainstormyEnvConfig} [production]
 */

/**
 * @typedef {Object} BrainstormyEnvConfig
 * @property {string} url - e.g. 'https://staging.brainstormy.app'
 * @property {BrainstormyAuth} auth
 */

/**
 * @typedef {Object} BrainstormyAuth
 * @property {string} type - 'clerk_email_password'
 * @property {boolean} required - true
 * @property {BrainstormyCredentials} credentials
 */

/**
 * @typedef {Object} BrainstormyCredentials
 * @property {string} email - 'testbot@brainstormy.app'
 * @property {string} password_env - 'BRAINSTORMY_TEST_PASSWORD'
 */

/**
 * @typedef {Object} BrainstormySelectorConfig
 * @property {string} auth_indicator - Selector visible when logged in
 * @property {string} ready_indicator - Selector visible when app is loaded
 * @property {BrainstormySelectors} selectors
 * @property {BrainstormyTimeouts} timeouts
 */

/**
 * @typedef {Object} BrainstormySelectors
 * @property {string} clerk_email_input - Clerk email input in sign-in form
 * @property {string} clerk_password_input - Clerk password input
 * @property {string} clerk_submit_button - Clerk submit button
 * @property {string} user_menu - Logged-in user menu element
 * @property {string} sidebar_projects - Projects link in sidebar
 * @property {string} new_project_button - Create project button
 * @property {string} project_name_input - Project name input
 * @property {string} create_project_submit - Project creation submit
 * @property {string} new_story_button - Create story button
 * @property {string} story_name_input - Story name input
 * @property {string} story_vertical_select - Vertical selector dropdown
 * @property {string} create_story_submit - Story creation submit
 * @property {string} new_session_button - Create session button
 * @property {string} session_type_select - Session type selector
 * @property {string} create_session_submit - Session creation submit
 * @property {string} chat_input - Chat message input textarea
 * @property {string} chat_send - Send message button
 * @property {string} ai_message - AI response message container
 * @property {string} user_message - User message container
 * @property {string} generating_indicator - Streaming/generating indicator
 * @property {string} search_input - Search bar input
 * @property {string} search_submit - Search submit button
 * @property {string} search_results - Search results container
 * @property {string} search_result_item - Individual search result
 * @property {string} bible_tab - Story Bible tab/link
 * @property {string} bible_template_select - Bible template selector
 * @property {string} bible_generate_button - Generate bible button
 * @property {string} bible_section - Bible section container
 * @property {string} bible_generating_indicator - Bible generation progress
 * @property {string} report_tab - Reports tab/link
 * @property {string} report_type_select - Report type selector
 * @property {string} report_generate_button - Generate report button
 * @property {string} report_content - Report content container
 * @property {string} report_citation - Citation element in report
 * @property {string} bookmark_button - Bookmark message button
 * @property {string} bookmark_title_input - Bookmark title input
 * @property {string} bookmark_save_button - Bookmark save button
 * @property {string} bookmarks_tab - Bookmarks list tab/link
 * @property {string} bookmark_item - Individual bookmark in list
 * @property {string} session_list - Session list container
 * @property {string} session_item - Individual session in list
 * @property {string} session_summary_content - Session summary text
 * @property {string} end_session_button - End session button
 * @property {string} story_sidebar_item - Story item in sidebar nav
 * @property {string} logout_button - Logout button
 */

/**
 * @typedef {Object} BrainstormyTimeouts
 * @property {number} ai_response - Max wait for AI response (ms), default 60000
 * @property {number} bible_generation - Max wait for bible gen (ms), default 120000
 * @property {number} report_generation - Max wait for report gen (ms), default 90000
 * @property {number} navigation - Max wait for page navigation (ms), default 30000
 * @property {number} search - Max wait for search results (ms), default 15000
 * @property {number} session_summary - Max wait for summary gen (ms), default 60000
 * @property {number} clerk_auth - Max wait for Clerk auth flow (ms), default 30000
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

### scheduled_runs Table

```sql
-- Add to core/database/schema.sql

CREATE TABLE scheduled_runs (
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
    await this.page.goto(env.url, { waitUntil: 'networkidle' });
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
    const timeout = this.getTimeout('clerk_auth');

    try {
      // Wait for Clerk sign-in form to render
      // Clerk may use a modal or embedded component
      const emailSelector = this.getSelector('clerk_email_input');
      const passwordSelector = this.getSelector('clerk_password_input');
      const submitSelector = this.getSelector('clerk_submit_button');

      await this.page.waitForSelector(emailSelector, { timeout });

      // Fill credentials
      await this.page.fill(emailSelector, auth.credentials.email);
      await this.page.fill(
        passwordSelector,
        process.env[auth.credentials.password_env]
      );

      // Submit
      await this.page.click(submitSelector);

      // Wait for redirect to dashboard
      await this.page.waitForSelector(
        this.getSelector('user_menu'),
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
    await this.waitForSelector(this.getSelector('new_project_button'));
    await this.page.click(this.getSelector('new_project_button'));

    // Fill project name
    await this.page.waitForSelector(this.getSelector('project_name_input'));
    await this.page.fill(this.getSelector('project_name_input'), name);
    await this.page.click(this.getSelector('create_project_submit'));

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

    await this.page.click(this.getSelector('new_story_button'));
    await this.page.waitForSelector(this.getSelector('story_name_input'));
    await this.page.fill(this.getSelector('story_name_input'), name);

    // Select vertical if dropdown exists
    const verticalSelector = this.getSelector('story_vertical_select');
    if (verticalSelector && await this.exists(verticalSelector)) {
      await this.page.selectOption(verticalSelector, vertical);
    }

    await this.page.click(this.getSelector('create_story_submit'));
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

    await this.page.click(this.getSelector('new_session_button'));
    await this.page.waitForSelector(this.getSelector('session_type_select'));

    // Select session type
    const typeSelector = this.getSelector('session_type_select');
    if (typeSelector && await this.exists(typeSelector)) {
      await this.page.selectOption(typeSelector, type);
    }

    await this.page.click(this.getSelector('create_session_submit'));
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
    const endButton = this.getSelector('end_session_button');
    if (!await this.exists(endButton)) {
      throw new Error('End session button not found — is a session active?');
    }

    await this.page.click(endButton);

    // Wait for summary generation (may take time)
    const timeout = this.getTimeout('session_summary');
    try {
      await this.page.waitForSelector(
        this.getSelector('session_summary_content'),
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
    const summarySelector = this.getSelector('session_summary_content');
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
    await this.page.click(this.getSelector('bible_tab'));
    await this.page.waitForSelector(this.getSelector('bible_template_select'));

    // Select template
    await this.page.selectOption(
      this.getSelector('bible_template_select'),
      template
    );

    // Click generate
    await this.page.click(this.getSelector('bible_generate_button'));

    // Wait for generation to complete (can take 30-120s)
    const timeout = this.getTimeout('bible_generation');
    const generatingIndicator = this.getSelector('bible_generating_indicator');

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
    await this.page.click(this.getSelector('bible_tab'));
    await this.page.waitForSelector(this.getSelector('bible_section'));

    const sections = await this.extractBibleSections();
    return { template, sections };
  }

  /**
   * Extract all bible section titles and content from the page.
   * @private
   * @returns {Object} Map of section_key → { title, content, has_content }
   */
  async extractBibleSections() {
    const sectionSelector = this.getSelector('bible_section');
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
    await this.page.click(this.getSelector('report_tab'));
    await this.page.waitForSelector(this.getSelector('report_type_select'));

    await this.page.selectOption(this.getSelector('report_type_select'), type);

    // Fill parameters if any (e.g., character name input)
    for (const [key, value] of Object.entries(parameters)) {
      const paramSelector = `[data-testid="report-param-${key}"]`;
      if (await this.exists(paramSelector)) {
        await this.page.fill(paramSelector, value);
      }
    }

    await this.page.click(this.getSelector('report_generate_button'));

    // Wait for report generation
    const timeout = this.getTimeout('report_generation');
    await this.page.waitForSelector(
      this.getSelector('report_content'),
      { timeout }
    );

    // Extract content and citations
    const content = await this.page.textContent(
      this.getSelector('report_content')
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
    const searchInput = this.getSelector('search_input');
    await this.page.waitForSelector(searchInput);
    await this.page.fill(searchInput, query);

    const searchSubmit = this.getSelector('search_submit');
    if (searchSubmit && await this.exists(searchSubmit)) {
      await this.page.click(searchSubmit);
    } else {
      await this.page.press(searchInput, 'Enter');
    }

    // Wait for results
    const timeout = this.getTimeout('search');
    await this.page.waitForSelector(
      this.getSelector('search_results'),
      { timeout }
    );

    // Extract results
    const resultSelector = this.getSelector('search_result_item');
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
    const messages = await this.page.$$(this.getSelector('ai_message'));
    if (messages.length === 0) {
      throw new Error('No messages to bookmark');
    }

    const targetIndex = Math.min(messageIndex, messages.length - 1);
    const targetMessage = messages[messages.length - 1 - targetIndex];

    // Hover to reveal bookmark button
    await targetMessage.hover();
    const bookmarkBtn = await targetMessage.$(this.getSelector('bookmark_button'));
    if (!bookmarkBtn) {
      throw new Error('Bookmark button not found on message');
    }

    await bookmarkBtn.click();

    // Fill title
    await this.page.waitForSelector(this.getSelector('bookmark_title_input'));
    await this.page.fill(this.getSelector('bookmark_title_input'), title);
    await this.page.click(this.getSelector('bookmark_save_button'));

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
    await this.page.click(this.getSelector('bookmarks_tab'));
    await this.page.waitForSelector(this.getSelector('bookmark_item'));

    const bookmarkElements = await this.page.$$(this.getSelector('bookmark_item'));

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
    const storyItems = await this.page.$$(this.getSelector('story_sidebar_item'));
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
    const sessionItems = await this.page.$$(this.getSelector('session_item'));
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
    await this.page.waitForSelector(this.getSelector('sidebar_projects'));

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
   * @returns {BrainstormyEnvConfig}
   */
  getEnvironment() {
    const envName = this.app.config?.environment || 'staging';
    return this.app.environments[envName];
  }

  /**
   * Get a timeout value from config.
   * @param {string} key - Timeout key
   * @returns {number} Timeout in ms
   */
  getTimeout(key) {
    const defaults = {
      ai_response: 60000,
      bible_generation: 120000,
      report_generation: 90000,
      navigation: 30000,
      search: 15000,
      session_summary: 60000,
      clerk_auth: 30000
    };
    return this.app.config?.timeouts?.[key] || defaults[key];
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
   * Navigate to a path within Brainstormy.
   * @param {string} path - Relative path
   */
  async navigate(path) {
    const env = this.getEnvironment();
    const url = path.startsWith('http') ? path : `${env.url}${path}`;
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }
}

module.exports = BrainstormyConnector;
```

### File: `connectors/brainstormy/selectors.js`

```javascript
'use strict';

/**
 * Default selectors for Brainstormy UI elements.
 * These serve as fallback values when not specified in app.config.json.
 * Ordered by priority: data-testid > role/aria > CSS class.
 */
const DEFAULT_SELECTORS = {
  // Clerk Authentication
  clerk_email_input: 'input[name="identifier"], input[type="email"]',
  clerk_password_input: 'input[name="password"], input[type="password"]',
  clerk_submit_button: 'button[data-localization-key="formButtonPrimary"], button[type="submit"]',

  // Auth state
  user_menu: '[data-testid="user-menu"], [data-testid="user-button"]',
  logout_button: '[data-testid="logout-button"], button:has-text("Sign out")',

  // Navigation
  sidebar_projects: '[data-testid="sidebar-projects"], a[href="/projects"]',
  story_sidebar_item: '[data-testid="story-nav-item"], .sidebar-story-link',

  // Project CRUD
  new_project_button: '[data-testid="new-project-button"], button:has-text("New Project")',
  project_name_input: '[data-testid="project-name-input"], input[name="project-name"]',
  create_project_submit: '[data-testid="create-project-button"], button[type="submit"]',

  // Story CRUD
  new_story_button: '[data-testid="new-story-button"], button:has-text("New Story")',
  story_name_input: '[data-testid="story-name-input"], input[name="story-name"]',
  story_vertical_select: '[data-testid="story-vertical-select"], select[name="vertical"]',
  create_story_submit: '[data-testid="create-story-button"], button[type="submit"]',

  // Session CRUD
  new_session_button: '[data-testid="new-session-button"], button:has-text("New Session")',
  session_type_select: '[data-testid="session-type-select"], select[name="session-type"]',
  create_session_submit: '[data-testid="create-session-button"], button[type="submit"]',
  session_list: '[data-testid="session-list"], .session-list',
  session_item: '[data-testid="session-item"], .session-list-item',
  end_session_button: '[data-testid="end-session-button"], button:has-text("End Session")',

  // Chat
  chat_input: '[data-testid="chat-input"], textarea[placeholder*="message"]',
  chat_send: '[data-testid="send-button"], button[aria-label="Send"]',
  ai_message: '[data-testid="ai-message"], .message-assistant',
  user_message: '[data-testid="user-message"], .message-user',
  generating_indicator: '[data-testid="generating"], .streaming-indicator',

  // Search
  search_input: '[data-testid="search-input"], input[placeholder*="Search"]',
  search_submit: '[data-testid="search-submit"]',
  search_results: '[data-testid="search-results"], .search-results',
  search_result_item: '[data-testid="search-result-item"], .search-result',

  // Bible
  bible_tab: '[data-testid="bible-tab"], a[href*="bible"], button:has-text("Story Bible")',
  bible_template_select: '[data-testid="bible-template-select"], select[name="template"]',
  bible_generate_button: '[data-testid="bible-generate"], button:has-text("Generate")',
  bible_section: '[data-testid="bible-section"], .bible-section',
  bible_generating_indicator: '[data-testid="bible-generating"], .bible-progress',

  // Reports
  report_tab: '[data-testid="report-tab"], a[href*="reports"]',
  report_type_select: '[data-testid="report-type-select"], select[name="report-type"]',
  report_generate_button: '[data-testid="report-generate"], button:has-text("Generate")',
  report_content: '[data-testid="report-content"], .report-content',
  report_citation: '[data-citation-id], .citation-link',

  // Bookmarks
  bookmark_button: '[data-testid="bookmark-button"], button[aria-label="Bookmark"]',
  bookmark_title_input: '[data-testid="bookmark-title-input"], input[name="bookmark-title"]',
  bookmark_save_button: '[data-testid="bookmark-save"], button:has-text("Save")',
  bookmarks_tab: '[data-testid="bookmarks-tab"], a[href*="bookmarks"]',
  bookmark_item: '[data-testid="bookmark-item"], .bookmark-list-item',

  // Session summary
  session_summary_content: '[data-testid="session-summary"], .session-summary-content',

  // App state
  ready_indicator: '[data-testid="app-loaded"], #app-root'
};

module.exports = DEFAULT_SELECTORS;
```

---

## Part 5: Brainstormy App Config File

### File: `apps/brainstormy/app.config.json`

```json
{
  "app_id": "brainstormy",
  "name": "Brainstormy",
  "type": "ai-chat",

  "environments": {
    "staging": {
      "url": "https://staging.brainstormy.app",
      "auth": {
        "type": "clerk_email_password",
        "required": true,
        "credentials": {
          "email": "testbot@brainstormy.app",
          "password_env": "BRAINSTORMY_TEST_PASSWORD"
        }
      }
    },
    "production": {
      "url": "https://brainstormy.app",
      "auth": {
        "type": "clerk_email_password",
        "required": true,
        "credentials": {
          "email": "testbot@brainstormy.app",
          "password_env": "BRAINSTORMY_PROD_TEST_PASSWORD"
        }
      }
    }
  },

  "connector": {
    "type": "brainstormy",
    "base": "ai-chat-app"
  },

  "config": {
    "environment": "staging",
    "auth_indicator": "[data-testid='user-menu']",
    "ready_indicator": "[data-testid='app-loaded']",
    "test_project_name": "QA Test Project",

    "timeouts": {
      "ai_response": 60000,
      "bible_generation": 120000,
      "report_generation": 90000,
      "navigation": 30000,
      "search": 15000,
      "session_summary": 60000,
      "clerk_auth": 30000
    }
  }
}
```

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
        { "assert": "selector_visible", "selector": "user_menu", "message": "User menu should be visible after login" }
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
        { "assert": "element_count_gte", "selector": "ai_message", "value": 1, "message": "Should have at least one AI response" }
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
        { "assert": "selector_visible", "selector": "sidebar_projects", "message": "Projects sidebar should be visible" },
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
const { v4: uuidv4 } = require('uuid');
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
   * @param {import('./database/models/scheduled-run-model')} options.scheduledRunModel
   * @param {import('./engine/test-orchestrator')} options.orchestrator
   * @param {import('./integrations/adapters/notification')} options.notifier
   * @param {import('./database/models/test-run-model')} options.testRunModel
   */
  constructor({ scheduledRunModel, orchestrator, notifier, testRunModel }) {
    super();

    /** @type {Map<string, import('node-cron').ScheduledTask>} */
    this.activeTasks = new Map();

    this.scheduledRunModel = scheduledRunModel;
    this.orchestrator = orchestrator;
    this.notifier = notifier;
    this.testRunModel = testRunModel;

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

    const schedules = await this.scheduledRunModel.getEnabled();
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
          null, // Default recipient
          `🏃 Starting scheduled run: ${schedule.name}\n` +
          `Mode: ${schedule.test_mode} | Agents: ${JSON.parse(schedule.agents).join(', ')}`
        );
      }

      // Execute tests via orchestrator
      const result = await this.orchestrator.runTests(schedule.app_id, {
        mode: schedule.test_mode,
        agents: JSON.parse(schedule.agents),
        environment: schedule.environment,
        triggered_by: 'scheduled',
        triggered_via: 'cron',
        schedule_id: schedule.id
      });

      // Update schedule tracking
      await this.scheduledRunModel.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: result.summary.failed > 0 ? 'failed' : 'passed',
        last_run_id: result.testRunId
      });

      // Notify completion
      const shouldNotify = schedule.notify_on_complete &&
        (!schedule.notify_only_failures || result.summary.failed > 0);

      if (shouldNotify) {
        await this.notifier.send(
          null,
          this.formatCompletionMessage(schedule, result, startTime)
        );
      }

      this.emit('schedule:completed', { schedule, result });

    } catch (error) {
      console.error(`Scheduler: Error in ${schedule.name}:`, error.message);

      await this.scheduledRunModel.updateLastRun(schedule.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: 'error'
      });

      // Always notify on errors
      await this.notifier.send(
        null,
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

    const runs = await this.testRunModel.getRunsSince(
      schedule.app_id,
      since
    );

    if (runs.length === 0) {
      await this.notifier.send(
        null,
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

    await this.notifier.send(null, message);
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
      id: config.id || uuidv4(),
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

    await this.scheduledRunModel.create(schedule);

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
    await this.scheduledRunModel.setEnabled(scheduleId, false);
    console.log(`Scheduler: Paused ${scheduleId}`);
  }

  /**
   * Resume a paused schedule.
   * @param {string} scheduleId
   */
  async resumeSchedule(scheduleId) {
    const schedule = await this.scheduledRunModel.getById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    await this.scheduledRunModel.setEnabled(scheduleId, true);
    this.registerTask({ ...schedule, enabled: 1 });
    console.log(`Scheduler: Resumed ${scheduleId}`);
  }

  /**
   * Trigger an immediate run of a schedule (ignoring cron timing).
   * @param {string} scheduleId
   * @returns {Object} Test run result
   */
  async runNow(scheduleId) {
    const schedule = await this.scheduledRunModel.getById(scheduleId);
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

    await this.scheduledRunModel.updateCron(scheduleId, cronExpression);

    // Re-register if active
    const schedule = await this.scheduledRunModel.getById(scheduleId);
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
      ? await this.scheduledRunModel.getByApp(appId)
      : await this.scheduledRunModel.getAll();

    return schedules.map((s) => ({
      ...s,
      is_running: this.executing.has(s.id),
      has_active_task: this.activeTasks.has(s.id)
    }));
  }
}

module.exports = Scheduler;
```

### File: `core/database/models/scheduled-run-model.js`

```javascript
'use strict';

/**
 * Database model for scheduled_runs table.
 */
class ScheduledRunModel {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Get all enabled schedules.
   * @returns {ScheduledRun[]}
   */
  getEnabled() {
    return this.db
      .prepare('SELECT * FROM scheduled_runs WHERE enabled = 1')
      .all();
  }

  /**
   * Get all schedules.
   * @returns {ScheduledRun[]}
   */
  getAll() {
    return this.db
      .prepare('SELECT * FROM scheduled_runs ORDER BY created_at')
      .all();
  }

  /**
   * Get schedules for a specific app.
   * @param {string} appId
   * @returns {ScheduledRun[]}
   */
  getByApp(appId) {
    return this.db
      .prepare('SELECT * FROM scheduled_runs WHERE app_id = ? ORDER BY created_at')
      .all(appId);
  }

  /**
   * Get a schedule by ID.
   * @param {string} id
   * @returns {ScheduledRun|null}
   */
  getById(id) {
    return this.db
      .prepare('SELECT * FROM scheduled_runs WHERE id = ?')
      .get(id) || null;
  }

  /**
   * Create a new schedule.
   * @param {ScheduledRun} schedule
   */
  create(schedule) {
    this.db.prepare(`
      INSERT INTO scheduled_runs (
        id, app_id, name, cron_expression, test_mode, agents,
        environment, enabled, notify_on_start, notify_on_complete,
        notify_only_failures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      schedule.id, schedule.app_id, schedule.name,
      schedule.cron_expression, schedule.test_mode, schedule.agents,
      schedule.environment, schedule.enabled,
      schedule.notify_on_start, schedule.notify_on_complete,
      schedule.notify_only_failures
    );
  }

  /**
   * Update the last run tracking fields.
   * @param {string} id
   * @param {Object} data
   */
  updateLastRun(id, data) {
    this.db.prepare(`
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
    this.db.prepare(`
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
    this.db.prepare(`
      UPDATE scheduled_runs SET cron_expression = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(cronExpression, id);
  }

  /**
   * Delete a schedule.
   * @param {string} id
   */
  delete(id) {
    this.db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(id);
  }
}

module.exports = ScheduledRunModel;
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

# Run database migration to add scheduled_runs table
node scripts/migrate.js

# Seed default schedules
node -e "
const db = require('./core/database/connection').getDb();
const ScheduledRunModel = require('./core/database/models/scheduled-run-model');
const model = new ScheduledRunModel(db);

// Check if already seeded
const existing = model.getAll();
if (existing.length > 0) {
  console.log('Schedules already exist, skipping seed.');
  process.exit(0);
}

// Insert defaults (from schema seed SQL)
db.exec(\`
  INSERT INTO scheduled_runs (id, app_id, name, cron_expression, test_mode, agents, environment, enabled, notify_on_complete)
  VALUES
    ('sched-nightly-full', 'brainstormy', 'Nightly Full Suite', '0 2 * * *', 'full', '[\"healer\",\"sentinel\",\"librarian\"]', 'staging', 1, 1),
    ('sched-weekly-regression', 'brainstormy', 'Weekly Regression', '0 3 * * 0', 'regression', '[\"healer\",\"sentinel\",\"librarian\"]', 'staging', 1, 1),
    ('sched-daily-digest', 'brainstormy', 'Daily Digest', '0 8 * * *', 'digest', '[]', 'staging', 1, 1);
\`);

console.log('Default schedules seeded.');
"

echo "✅ Scheduler setup complete."
echo "   Start with: npm run start:scheduler"
```

---

## Part 9: WhatsApp Bot Schedule Commands

These commands extend the WhatsApp bot from Days 1-2 to support schedule management.

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

## Part 10: Connector Factory Update

### File: Update to `connectors/factory.js`

```javascript
'use strict';

const GenericWebAppConnector = require('./generic-web-app/connector');
const AIAppConnector = require('./ai-chat-app/connector');
const BrainstormyConnector = require('./brainstormy/connector');

/**
 * Factory to instantiate the correct connector for an app.
 */
class ConnectorFactory {
  /**
   * Known connector types → classes.
   * @type {Object<string, typeof import('./base-connector')>}
   */
  static connectors = {
    generic: GenericWebAppConnector,
    'ai-chat-app': AIAppConnector,
    brainstormy: BrainstormyConnector
  };

  /**
   * Create and initialize a connector for the given app.
   * @param {Object} app - App configuration
   * @param {import('playwright').Page} page - Playwright page
   * @param {import('../core/engine/evidence-collector')} evidenceCollector
   * @returns {import('./base-connector')} Initialized connector
   */
  static async create(app, page, evidenceCollector) {
    const connectorType = app.connector?.type || 'generic';
    const ConnectorClass = this.connectors[connectorType];

    if (!ConnectorClass) {
      throw new Error(`Unknown connector type: ${connectorType}`);
    }

    const connector = new ConnectorClass(app, page, evidenceCollector);
    await connector.initialize();
    return connector;
  }

  /**
   * Register a new connector type.
   * @param {string} type
   * @param {typeof import('./base-connector')} ConnectorClass
   */
  static register(type, ConnectorClass) {
    this.connectors[type] = ConnectorClass;
  }
}

module.exports = ConnectorFactory;
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
    test('calls orchestrator.runTests with correct params');
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

### Test: `tests/database/scheduled-run-model.test.js`

```javascript
// Target: 10 tests

describe('ScheduledRunModel', () => {
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

**Total test target: 71 tests**

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
    runTests: jest.fn().mockResolvedValue({
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

### Mock SQLite Database (for ScheduledRunModel tests)

```javascript
/**
 * Create an in-memory SQLite database for model tests.
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

  return db;
}
```

---

## Part 13: Files to Create

| File | Purpose | LOC (est.) |
|---|---|---|
| `connectors/brainstormy/connector.js` | BrainstormyConnector class | ~450 |
| `connectors/brainstormy/selectors.js` | Default selector definitions | ~80 |
| `connectors/factory.js` | Updated ConnectorFactory with Brainstormy | ~50 |
| `apps/brainstormy/app.config.json` | App configuration | ~60 |
| `apps/brainstormy/scenarios/smoke-tests.json` | Smoke test scenarios | ~70 |
| `apps/brainstormy/scenarios/memory-tests.json` | Memory/Sentinel scenarios | ~120 |
| `apps/brainstormy/scenarios/bible-tests.json` | Bible/Librarian scenarios | ~100 |
| `core/scheduler.js` | Scheduler class with node-cron | ~320 |
| `core/database/models/scheduled-run-model.js` | ScheduledRunModel DB operations | ~100 |
| `interfaces/whatsapp-bot/handlers/schedule-handler.js` | WhatsApp schedule commands | ~180 |
| `scripts/pre-deploy.sh` | Git pre-push hook | ~25 |
| `scripts/setup-scheduler.sh` | Scheduler setup script | ~40 |
| `tests/connectors/brainstormy-connector.test.js` | Connector unit tests | ~300 |
| `tests/core/scheduler.test.js` | Scheduler unit tests | ~280 |
| `tests/whatsapp-bot/schedule-handler.test.js` | Schedule handler tests | ~150 |
| `tests/database/scheduled-run-model.test.js` | Model unit tests | ~120 |
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

**Step 4:** Update `connectors/factory.js`
```bash
# Verify: Factory can resolve 'brainstormy' type
node -e "
const F = require('./connectors/factory');
console.log('brainstormy' in F.connectors ? 'PASS' : 'FAIL', '- brainstormy registered');
"
```

**Step 5:** Create `apps/brainstormy/app.config.json`
```bash
# Verify: Config is valid JSON and has required fields
node -e "
const c = require('./apps/brainstormy/app.config.json');
console.log(c.app_id === 'brainstormy' ? 'PASS' : 'FAIL', '- app_id');
console.log(c.environments.staging.url ? 'PASS' : 'FAIL', '- staging URL');
console.log(c.connector.type === 'brainstormy' ? 'PASS' : 'FAIL', '- connector type');
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

**Step 11:** Add scheduled_runs migration
```bash
# Add to schema and run migration
node scripts/migrate.js
sqlite3 database/qa.db ".schema scheduled_runs"
# Should show CREATE TABLE scheduled_runs ...
```

**Step 12:** Implement `core/database/models/scheduled-run-model.js`
```bash
npm test -- tests/database/scheduled-run-model.test.js
# Expected: 10 tests pass
```

**Step 13:** Implement `core/scheduler.js`
```bash
# Verify: Scheduler loads and has correct API
node -e "
const S = require('./core/scheduler');
const s = new S({scheduledRunModel:{getEnabled:()=>[]},orchestrator:{},notifier:{},testRunModel:{}});
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
            tests/database/scheduled-run-model.test.js

# Expected: 71 tests, 71 passing
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
- [ ] Executes tests via TestOrchestrator.runTests()
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
- [ ] 10 ScheduledRunModel tests passing
- [ ] Total: 71 tests passing
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
# Already installed: playwright, better-sqlite3, uuid, express, twilio
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
