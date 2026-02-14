# Expanded Smoke Scenarios Specification

**Version:** 1.1
**Date:** February 14, 2026
**Phase:** QA Engine Phase 2 — Task 2
**Prerequisite:** Phase 2 Task 1 (First-Run Validation) complete ✅
**Status:** Ready for Implementation

---

## Changelog

### v1.1 (February 14, 2026)

Fixes from feasibility evaluation against actual codebase:

**P0 — Critical (would have caused immediate runtime failures):**
- Fixed all action names from camelCase to snake_case to match connector's `performAction()` switch (`create_project`, `create_story`, `create_session`, `send_message`, `wait_for_response`)
- Fixed `step_succeeded` assertions: `step` → `stepIndex` to match `base-agent.js:442`
- Flagged `element_text_contains` bug: `extractData()` returns `{text, value, html, attributes}` object, but assertion at `base-agent.js:428` calls `String(text)` on it producing `"[object Object]"`. Added as required code fix (Task 0a)
- Flagged `wait` action selector resolution bug: existing `wait` action passes `params.selector` as raw CSS without calling `getSelector()`. Added as required code fix (Task 0b)
- Replaced all direct `/projects` URL navigation with sidebar click navigation to avoid SPA hydration failure (documented in first-run Step 8 calibration note)

**P1 — Significant gaps:**
- Added `navigate_to_project` as new action (was missing from connector entirely)
- Replaced `use_state` param pattern with explicit state reads in connector action implementations — no existing action supports `use_state`
- Documented that group/order/depends_on runner logic requires changes to `BaseAgent.runTests()`, not a separate `runSuite()` method, and that `_computeSummary()` needs `skipped_dependency` status
- Added `setState('last_ai_response', ...)` to `waitForAIResponse` connector fix
- Added `setState('current_vertical', ...)` to `createStory` connector fix
- Replaced `apiGet`/`apiDelete` cleanup approach with Playwright-based cleanup using existing connector methods plus a new `archive_test_data` enhancement

**Moderate fixes:**
- Corrected smoke-02 reference: actual passing scenario is `smoke-02-sidebar-loaded` (first-run renamed it)
- Removed redundant `navigate /projects` step from smoke-03 (`create_project` already navigates internally)
- Noted that `navigate_to_session` needs refactoring: current implementation searches DOM by text/href, doesn't support direct ID navigation
- Changed new selector keys to camelCase to match existing `app.config.json` convention
- Replaced `:last-child` message selectors with `:last-of-type` and noted calibration requirement
- Kept scenario file as plain array (no wrapper object) to preserve existing convention

**Already done (removed from task list):**
- `{{timestamp}}` interpolation — already in `BaseAgent.resolveParams()` at `base-agent.js:565-579`
- `wait` action existence — already in `GenericWebAppConnector.performAction()` switch (needs selector fix only)
- State passthrough infrastructure — `BaseConnector.state` Map with `setState()`/`getState()` already works

---

## 1. Overview

### What Exists Today

`apps/brainstormy/scenarios/smoke-tests.json` contains two passing scenarios:

| ID | Name | What It Tests |
|----|------|---------------|
| `smoke-01-login` | Verify authenticated state | Confirms Clerk session injection worked |
| `smoke-02-sidebar-loaded` | Verify sidebar loads | Confirms app shell renders after auth (renamed from `smoke-02-navigate-project` during first-run calibration due to SPA hydration issue) |

Authentication is handled by `connector.initialize()` via Clerk Backend API session injection — no scenario needs login steps.

### What This Spec Adds

Six new scenarios covering the Brainstormy core happy path:

| ID | Name | What It Tests |
|----|------|---------------|
| `smoke-03-create-project` | Create a new project | Project creation flow, redirect, sidebar update |
| `smoke-04-create-story` | Create a story within a project | Story creation, vertical selection, redirect |
| `smoke-05-create-session` | Create an Explore session | Session creation, chat interface load |
| `smoke-06-send-message` | Send a user message | Message input, send, message appears in chat |
| `smoke-07-ai-response` | Receive an AI response | AI generates a reply, response renders in chat |
| `smoke-08-hierarchy-navigation` | Navigate project → story → session | Sidebar navigation across all three hierarchy levels |

Together with the existing two, these eight scenarios form a complete smoke suite covering: auth → navigation → CRUD → chat → AI round-trip → hierarchy traversal.

---

## 2. Architecture Decision: Independent vs. Sequential Scenarios

### Decision: Hybrid — Shared Setup Phase + Independent Assertions

**Problem:** Pure independence means each scenario creates its own project/story/session, which is slow and creates a lot of test data. Pure sequencing means a failure in `smoke-03` cascades to fail `smoke-04` through `smoke-08`, hiding the real issue.

**Solution:** Use a two-tier approach:

1. **Setup scenarios (smoke-03 through smoke-05)** are sequential and create test entities. They run first, in order. If any fails, the suite short-circuits with a clear "setup failed" report rather than running (and failing) all downstream scenarios.

2. **Test scenarios (smoke-06 through smoke-08)** are independent of each other but depend on setup having succeeded. They use the session/story/project created during setup. If `smoke-06` fails, `smoke-07` and `smoke-08` still run.

This is implemented via **state passthrough**: setup scenarios store IDs in connector state (`current_project_id`, `current_story_id`, `current_session_id`), and test scenarios read them. The `BaseConnector.state` Map already persists across scenarios within a single suite run since the connector instance is shared — no new infrastructure needed.

```
smoke-01-login              ─┐
smoke-02-sidebar-loaded     ─┤  Independent (existing)
                             │
smoke-03-create-project     ─┐
smoke-04-create-story       ─┤  Sequential setup (new)
smoke-05-create-session     ─┘
                             │
smoke-06-send-message       ─┐
smoke-07-ai-response        ─┤  Independent tests (new, depend on setup)
smoke-08-hierarchy-nav      ─┘
```

### Scenario Metadata

Each scenario gets a `group` and `order` field to express this:

```json
{
  "group": "setup",
  "order": 3,
  "depends_on": ["smoke-02-sidebar-loaded"]
}
```

The runner processes groups in order (`independent` → `setup` → `test`) and within each group respects `order`. If a `setup` scenario fails, all `test` scenarios are skipped with status `skipped_dependency`.

**Implementation note:** This requires changes to `BaseAgent.runTests()` (currently iterates sequentially with no group awareness), and `_computeSummary()` at `base-agent.js:586-593` needs to count `skipped_dependency` as a distinct status alongside `passed`, `failed`, and `skipped`. The orchestrator's summary computation at `test-orchestrator.js:392-436` also needs this new status.

---

## 3. Known Codebase Bugs to Fix First

Before scenarios can run, two pre-existing bugs must be fixed:

### 3.1 `element_text_contains` Assertion Bug

**Location:** `base-agent.js:428`
**Problem:** `GenericWebAppConnector.extractData()` at `generic-web-app/connector.js:414` returns an object `{text, value, html, attributes}`. The assertion code does:
```javascript
passed = text !== null && String(text).includes(assertion.value);
```
`String({text: "...", ...})` produces `"[object Object]"`, which never matches any expected value.

**Fix:** Change the assertion to extract the `.text` property:
```javascript
const extracted = await connector.extractData(resolvedSelector);
const text = extracted?.text ?? null;
passed = text !== null && String(text).includes(assertion.value);
```

**Affects:** Any scenario using `element_text_contains`. This is a latent bug — no existing scenario has triggered it yet.

### 3.2 `wait` Action Selector Resolution Bug

**Location:** `generic-web-app/connector.js:292-294`
**Problem:** The existing `wait` action passes `params.selector` directly to `waitFor()` as raw CSS. When scenarios use logical selector names (e.g., `"sessionList"`), these are passed as literal CSS and fail because no DOM element matches `sessionList`.

**Fix:** Add selector resolution:
```javascript
case 'wait':
  const resolvedSelector = this.getSelector(params.selector) || params.selector;
  await this.waitFor(resolvedSelector, params.timeout || 30000);
  return { found: true, selector: params.selector };
```

**Affects:** smoke-08 (uses logical names `storyList`, `sessionList`, `chatInput` in wait steps).

---

## 4. Scenario JSON Definitions

All scenarios follow the established format: separate `steps` (actions) and `assertions` arrays. Action names use snake_case matching the connector's `performAction()` switch. Assertion field names match `base-agent.js` property names. Selectors use camelCase keys matching existing `app.config.json` convention.

### 4.1 smoke-03-create-project

`create_project` already navigates to `/projects` internally (connector.js:468), so no explicit navigate step is needed. This also avoids the SPA hydration issue with direct URL navigation.

```json
{
  "id": "smoke-03-create-project",
  "name": "Create a new project",
  "description": "Creates a test project and verifies it appears in the UI",
  "group": "setup",
  "order": 3,
  "depends_on": ["smoke-02-sidebar-loaded"],
  "tags": ["smoke", "crud", "project"],
  "timeout": 30000,
  "steps": [
    {
      "action": "create_project",
      "params": { "name": "QA Smoke Test Project {{timestamp}}" }
    }
  ],
  "assertions": [
    {
      "type": "url_contains",
      "value": "/projects/",
      "message": "Should redirect to the new project page"
    },
    {
      "type": "state_truthy",
      "key": "current_project_id",
      "message": "Connector state should have current_project_id"
    },
    {
      "type": "element_exists",
      "selector": "projectHeading",
      "message": "Project heading should be visible"
    }
  ]
}
```

**Note:** The `element_text_contains` assertion from v1.0 is removed. It depends on the bug fix in Section 3.1 and the text match is fragile (the `{{timestamp}}` suffix changes each run). The `url_contains` + `state_truthy` + `element_exists` trio is sufficient to verify project creation. If text verification is wanted after the bug fix, it can be re-added with a partial match on `"QA Smoke Test"`.

### 4.2 smoke-04-create-story

```json
{
  "id": "smoke-04-create-story",
  "name": "Create a story within a project",
  "description": "Creates a novel story inside the test project",
  "group": "setup",
  "order": 4,
  "depends_on": ["smoke-03-create-project"],
  "tags": ["smoke", "crud", "story"],
  "timeout": 30000,
  "steps": [
    {
      "action": "create_story",
      "params": {
        "name": "QA Smoke Test Story {{timestamp}}",
        "vertical": "novel"
      }
    }
  ],
  "assertions": [
    {
      "type": "url_contains",
      "value": "/stories/",
      "message": "Should redirect to the new story page"
    },
    {
      "type": "state_truthy",
      "key": "current_story_id",
      "message": "Connector state should have current_story_id"
    },
    {
      "type": "element_exists",
      "selector": "storyHeading",
      "message": "Story heading should be visible"
    }
  ]
}
```

**Note:** The `state_equals` assertion on `current_vertical` from v1.0 is removed. `createStory()` at `connector.js:511-555` does not currently set this state key. Rather than adding it just for an assertion, we verify story creation through URL redirect + state ID + heading visibility. If vertical validation is needed later, add `setState('current_vertical', vertical)` to `createStory()` first.

### 4.3 smoke-05-create-session

```json
{
  "id": "smoke-05-create-session",
  "name": "Create an Explore session",
  "description": "Creates an Explore-mode session and verifies chat interface loads",
  "group": "setup",
  "order": 5,
  "depends_on": ["smoke-04-create-story"],
  "tags": ["smoke", "crud", "session"],
  "timeout": 30000,
  "steps": [
    {
      "action": "create_session",
      "params": { "type": "explore" }
    }
  ],
  "assertions": [
    {
      "type": "url_contains",
      "value": "/sessions/",
      "message": "Should redirect to the new session page"
    },
    {
      "type": "state_truthy",
      "key": "current_session_id",
      "message": "Connector state should have current_session_id"
    },
    {
      "type": "element_exists",
      "selector": "chatInput",
      "message": "Chat input should be visible (session is active)"
    },
    {
      "type": "element_exists",
      "selector": "messageList",
      "message": "Message list container should exist"
    }
  ]
}
```

### 4.4 smoke-06-send-message

```json
{
  "id": "smoke-06-send-message",
  "name": "Send a user message",
  "description": "Types and sends a message, verifies it appears in the chat",
  "group": "test",
  "order": 6,
  "depends_on": ["smoke-05-create-session"],
  "tags": ["smoke", "chat", "message"],
  "timeout": 15000,
  "steps": [
    {
      "action": "send_message",
      "params": {
        "text": "Hello, this is a QA smoke test message. Let's brainstorm a story about a detective in 1920s Chicago."
      }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "stepIndex": 0,
      "message": "send_message action should complete without error"
    },
    {
      "type": "element_exists",
      "selector": "userMessageLast",
      "message": "User message should appear in the chat"
    }
  ]
}
```

**Note:** The `element_text_contains` assertion from v1.0 is removed (depends on bug fix in Section 3.1). `step_succeeded` + `element_exists` on the last user message is sufficient to verify the message was sent and rendered.

### 4.5 smoke-07-ai-response

```json
{
  "id": "smoke-07-ai-response",
  "name": "Receive an AI response",
  "description": "Sends a message and waits for the AI to respond. Validates the response renders in chat.",
  "group": "test",
  "order": 7,
  "depends_on": ["smoke-05-create-session"],
  "tags": ["smoke", "chat", "ai", "slow"],
  "timeout": 90000,
  "steps": [
    {
      "action": "send_message",
      "params": {
        "text": "QA test: briefly describe a mysterious character who runs a speakeasy."
      }
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "stepIndex": 1,
      "message": "wait_for_response should complete within timeout"
    },
    {
      "type": "element_exists",
      "selector": "assistantMessageLast",
      "message": "An assistant message should appear in the chat"
    },
    {
      "type": "state_truthy",
      "key": "last_ai_response",
      "message": "Connector state should store the AI response text"
    }
  ]
}
```

**Implementation requirement:** The `state_truthy` assertion on `last_ai_response` requires a connector change. `AIAppConnector.waitForAIResponse()` at `ai-chat-app/connector.js:192-200` currently only stores the response in the `messages` array — it does not call `setState('last_ai_response', ...)`. This must be added (see Task 2d below).

### 4.6 smoke-08-hierarchy-navigation

This scenario navigates via connector actions that read IDs from state, avoiding direct URL navigation and the SPA hydration issue.

```json
{
  "id": "smoke-08-hierarchy-navigation",
  "name": "Navigate project → story → session hierarchy",
  "description": "Navigates up to project level, back down to story, then to session, verifying each level loads correctly.",
  "group": "test",
  "order": 8,
  "depends_on": ["smoke-05-create-session"],
  "tags": ["smoke", "navigation", "hierarchy"],
  "timeout": 45000,
  "steps": [
    {
      "action": "navigate_to_project",
      "params": {}
    },
    {
      "action": "wait",
      "params": { "selector": "storyList", "timeout": 10000 }
    },
    {
      "action": "navigate_to_story",
      "params": {}
    },
    {
      "action": "wait",
      "params": { "selector": "sessionList", "timeout": 10000 }
    },
    {
      "action": "navigate_to_session",
      "params": {}
    },
    {
      "action": "wait",
      "params": { "selector": "chatInput", "timeout": 10000 }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "stepIndex": 0,
      "message": "navigate_to_project should complete"
    },
    {
      "type": "step_succeeded",
      "stepIndex": 2,
      "message": "navigate_to_story should complete"
    },
    {
      "type": "step_succeeded",
      "stepIndex": 4,
      "message": "navigate_to_session should complete"
    },
    {
      "type": "element_exists",
      "selector": "chatInput",
      "message": "Chat interface should be visible at the end"
    }
  ]
}
```

**Key design choices:**
- No `use_state` params — that pattern doesn't exist in the codebase. Each `navigate_to_*` action reads from connector state internally when no explicit ID param is provided (see Section 6.2).
- No direct `/projects` URL navigation — avoids SPA hydration failure.
- Empty `params: {}` signals "use state" — the action implementations default to reading from `current_project_id`, `current_story_id`, `current_session_id`.

---

## 5. New Selectors Required in `app.config.json`

New keys use camelCase to match the existing convention (e.g., `chatInput`, `aiMessage`, `userMenu`). CSS values are placeholders requiring calibration against real staging.

```json
{
  "selectors": {
    "___EXISTING_KEYS_UNCHANGED___": "...",

    "projectHeading":        "[data-testid='project-heading'], h1.project-name",
    "projectList":           "[data-testid='project-list'], .projects-container",
    "projectCard":           "[data-testid='project-card'], .project-card",

    "storyHeading":          "[data-testid='story-heading'], h1.story-name",
    "storyList":             "[data-testid='story-list'], .stories-container",
    "storyCard":             "[data-testid='story-card'], .story-card",

    "sessionList":           "[data-testid='session-list'], .sessions-container",
    "sessionItem":           "[data-testid='session-item'], .session-item",

    "chatInput":             "[data-testid='chat-input'], textarea.message-input",
    "chatSend":              "[data-testid='chat-send'], button.send-button",
    "messageList":           "[data-testid='message-list'], .messages-container",
    "userMessageLast":       "[data-testid='user-message']:last-of-type, .message.user:last-of-type",
    "assistantMessageLast":  "[data-testid='assistant-message']:last-of-type, .message.assistant:last-of-type",

    "newProjectButton":      "[data-testid='new-project-button'], button:has-text('New Project')",
    "newStoryButton":        "[data-testid='new-story-button'], button:has-text('New Story')",
    "newSessionButton":      "[data-testid='new-session-button'], button:has-text('New Session')",

    "breadcrumbProject":     "[data-testid='breadcrumb-project'], .breadcrumb .project-link",
    "breadcrumbStory":       "[data-testid='breadcrumb-story'], .breadcrumb .story-link",
    "breadcrumbSession":     "[data-testid='breadcrumb-session'], .breadcrumb .session-link"
  }
}
```

**Calibration notes:**
- All keys are camelCase (v1.0 used snake_case which mismatched existing convention)
- Message selectors use `:last-of-type` instead of `:last-child` (`:last-child` fails when message containers have padding/footer elements as siblings)
- Some selectors like `chatInput` may already exist in the config — during calibration, deduplicate rather than add duplicates
- The `getSelector()` method handles snake_case→camelCase conversion, so scenario JSON can use either convention for selector references, but config keys should be consistently camelCase

---

## 6. Connector Changes

### 6.1 Summary of What Exists vs. What's Needed

| Action (snake_case) | Exists? | Changes Needed |
|---------------------|---------|----------------|
| `navigate` | ✅ GenericWebAppConnector | None |
| `create_project` | ✅ BrainstormyConnector | None |
| `create_story` | ✅ BrainstormyConnector | None (see note on `current_vertical` below) |
| `create_session` | ✅ BrainstormyConnector | None |
| `send_message` | ✅ AIAppConnector | None |
| `wait_for_response` | ✅ AIAppConnector | Add `setState('last_ai_response', ...)` |
| `wait` | ✅ GenericWebAppConnector | Fix selector resolution (Section 3.2) |
| `navigate_to_story` | ✅ BrainstormyConnector | Add state-based ID lookup as fallback |
| `navigate_to_project` | ❌ **New** | Implement |
| `navigate_to_session` | ⚠️ Exists but needs refactor | Current implementation searches DOM by text/href; needs direct ID navigation support |

### 6.2 New/Modified Actions

#### `navigate_to_project` (New)

Add to `brainstormyActions` array at `connector.js:361` and implement in `performAction()` switch:

```javascript
case 'navigate_to_project':
  const projectId = params.project_id || this.getState('current_project_id');
  if (!projectId) throw new Error('No project ID available — provide project_id param or run create_project first');
  await this.navigate(`/projects/${projectId}`);
  await this.waitForAppReady();
  return { navigated: true, projectId };
```

**SPA hydration note:** This uses `this.navigate()` for in-app navigation (not cold page load), which should work after the app shell is already hydrated from `initialize()`. If this still hits the SPA issue during calibration, the fallback is to find and click the project in the sidebar by matching a `data-project-id` attribute. Determine the correct approach during Task 6.

#### `navigate_to_session` (Refactor)

The current implementation at `connector.js:682-694` searches session items by matching text/href content in the DOM. It does **not** accept a session ID directly. Modify to support state-based ID lookup:

```javascript
case 'navigate_to_session':
  const sessionId = params.session_id || this.getState('current_session_id');
  if (!sessionId) throw new Error('No session ID available');
  // If it looks like a UUID, navigate directly
  if (sessionId.match(/^[0-9a-f-]{36}$/i)) {
    await this.navigate(`/sessions/${sessionId}`);
    await this.waitForAppReady();
  } else {
    // Fall back to existing DOM search by text/name
    // ... existing implementation unchanged ...
  }
  return { navigated: true, sessionId };
```

#### `navigate_to_story` (Minor enhancement)

Already exists and handles UUIDs, but should also support reading from state when no params provided:

```javascript
case 'navigate_to_story':
  const storyId = params.story_id || params.name || this.getState('current_story_id');
  if (!storyId) throw new Error('No story ID available');
  // ... rest of existing implementation unchanged ...
```

#### `wait_for_response` (Add state key)

In `AIAppConnector.waitForAIResponse()` at `ai-chat-app/connector.js:192-200`, add after extracting the response:

```javascript
// After existing code that stores in messages array:
this.setState('last_ai_response', responseText || '');
```

This enables the `state_truthy` assertion in smoke-07.

### 6.3 Param Resolution Design

No `use_state` parameter pattern is introduced. The v1.0 spec proposed `"use_state": "current_project_id"` but no existing action supports this pattern. Instead, each `navigate_to_*` action reads from state internally when no explicit ID param is provided. This follows the existing pattern used by `create_session` (which reads `current_story_id` from state at `connector.js:562`).

Scenarios pass `params: {}` to signal "use whatever is in state." This is simple, consistent with existing patterns, and doesn't require new infrastructure.

### 6.4 Template Variable Note

The `{{timestamp}}` and `{{uuid}}` interpolation already exists in `BaseAgent.resolveParams()` at `base-agent.js:565-579`. No implementation work needed — scenarios can use `{{timestamp}}` in params immediately.

---

## 7. Cleanup Strategy

### Decision: Tag-and-Sweep with Delayed Cleanup

**Rationale:** Test data should persist long enough for debugging but not accumulate indefinitely.

### How It Works

1. **Tagging:** All test entities use a recognizable naming pattern: `QA Smoke Test *`. The `{{timestamp}}` suffix makes each run's data unique.

2. **Post-run hold:** After a successful suite run, test data is left in place for 1 hour for manual inspection.

3. **Cleanup trigger:** Runs at the start of the next suite run (cleaning stale data from previous runs), or on-demand via CLI: `qa-engine cleanup --app brainstormy`.

4. **Failed run behavior:** If the suite fails, test data is NOT cleaned up — this preserves the exact state for debugging.

### Implementation

The v1.0 spec used `this.apiGet()` / `this.apiDelete()` methods that don't exist anywhere in the connector hierarchy. Revised approach uses Playwright and existing connector methods:

**Option A — `page.evaluate()` with fetch (preferred if API endpoint exists):**
```javascript
async cleanupTestData(options = {}) {
  const maxAge = options.maxAge || 3600000; // 1 hour

  // Use in-browser fetch to call the API directly — avoids UI navigation
  const projects = await this.page.evaluate(async () => {
    const res = await fetch('/api/projects', { credentials: 'include' });
    return res.json();
  });

  const cutoff = Date.now() - maxAge;
  const stale = projects.filter(p =>
    p.name.startsWith('QA Smoke Test') &&
    new Date(p.created_at).getTime() < cutoff
  );

  for (const project of stale) {
    await this.page.evaluate(async (id) => {
      await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
    }, project.id);
  }

  return { deleted: stale.length };
}
```

**Prerequisite check:** Verify during calibration whether Brainstormy has a `DELETE /api/projects/:id` endpoint. If not, either add a staging-only admin endpoint or use Option B.

**Option B — Playwright UI navigation (fallback):**
Navigate to projects page, find test projects by name, click through delete flow in UI. This is slower and more fragile but doesn't require API changes. Implementation follows the pattern from the existing `archive_test_data` action.

---

## 8. Scenario Runner Changes

### 8.1 Group-Aware Execution

The group/order/depends_on logic must be added to `BaseAgent.runTests()` — this is **not** a separate `runSuite()` method. The current implementation iterates scenarios sequentially with `for...of` and has no awareness of groups, ordering, or dependencies.

Required changes:

**In `BaseAgent.runTests()` (base-agent.js):**
```javascript
// Before iterating scenarios, sort by group then order:
const groupPriority = { independent: 0, setup: 1, test: 2 };
scenarios.sort((a, b) =>
  (groupPriority[a.group] ?? 1) - (groupPriority[b.group] ?? 1) || (a.order ?? 0) - (b.order ?? 0)
);

let setupFailed = false;

for (const scenario of scenarios) {
  // Skip test scenarios if setup failed
  if (setupFailed && scenario.group === 'test') {
    results.push({
      scenarioId: scenario.id,
      status: 'skipped_dependency',
      message: 'Setup scenario failed — skipping dependent test'
    });
    continue;
  }

  const result = await this.runScenario(scenario);
  results.push(result);

  // If a setup scenario fails, flag for downstream skipping
  if (result.status === 'failed' && scenario.group === 'setup') {
    setupFailed = true;
  }
}
```

**In `BaseAgent._computeSummary()` (base-agent.js:586-593):**
Add `skipped_dependency` to the status counts:
```javascript
summary.skipped_dependency = results.filter(r => r.status === 'skipped_dependency').length;
// Ensure skipped_dependency scenarios don't count as failures
summary.failed = results.filter(r => r.status === 'failed').length;
```

**In `test-orchestrator.js:392-436` (summary computation):**
Same change — count `skipped_dependency` separately from `failed` and `skipped`.

### 8.2 Backward Compatibility

Scenarios without `group`/`order`/`depends_on` fields get defaults:
- `group`: `"independent"` (no ordering constraint)
- `order`: `0` (runs first within its group)
- `depends_on`: `[]`

This means the existing `smoke-01` and `smoke-02` scenarios continue to work unchanged even before they're updated with explicit metadata.

---

## 9. Complete Updated `smoke-tests.json` Structure

The file remains a plain JSON array (not wrapped in a `{suite, version, scenarios}` object). This preserves the existing convention — `Factory.js` handles both formats, but changing it is a separate decision. The existing scenarios get `group` and `order` fields added:

```json
[
  {
    "id": "smoke-01-login",
    "group": "independent",
    "order": 1,
    "...": "(existing fields unchanged)"
  },
  {
    "id": "smoke-02-sidebar-loaded",
    "group": "independent",
    "order": 2,
    "...": "(existing fields unchanged)"
  },
  { "...": "smoke-03 through smoke-08 from Section 4" }
]
```

---

## 10. Risk Considerations

### SPA Hydration (smoke-03, smoke-08)

Direct URL navigation to Brainstormy sub-routes loads the HTML shell without React hydration/session state (documented in first-run Step 8). Mitigations:
- smoke-03 delegates to `create_project` which handles navigation internally
- smoke-08 uses `navigate_to_*` connector actions (in-app navigation after initial hydration, not cold page load)
- During calibration, test whether `this.navigate()` to `/projects/{id}` works after initial app load — in-app navigation may work fine vs. cold navigation

### AI Response Timeout (smoke-07)

Highest-risk scenario — depends on OpenRouter/LLM availability. Mitigations:
- 60s `wait_for_response` timeout, 90s scenario timeout
- Tagged `slow` so fast pre-deploy checks can skip it
- Simple prompt ("briefly describe a mysterious character") for fast response
- Consider allowing 1 retry for `slow`-tagged scenarios

### Selector Fragility

CSS selectors break when UI changes. Mitigations:
- Prefer `data-testid` with CSS fallbacks
- Calibration task verifies every selector against real staging
- Screenshot on failure captures state for diagnosis
- `:last-of-type` instead of `:last-child` for message selectors

### Test Data Accumulation

If cleanup fails or is skipped, test projects accumulate. Mitigations:
- Timestamp in names enables age-based cleanup
- Pre-run cleanup sweeps stale data before each suite
- Admin dashboard allows bulk-delete of test projects

---

## 11. Implementation Task List

### Task 0: Pre-Existing Bug Fixes (~45 min)

These bugs exist independently of this spec but block scenario execution.

**Task 0a: Fix `element_text_contains` assertion (30 min)**
File: `base-agent.js:428`
Change assertion to read `.text` property from `extractData()` return value instead of stringifying the whole object. See Section 3.1 for exact fix.

**Task 0b: Fix `wait` action selector resolution (15 min)**
File: `generic-web-app/connector.js:292-294`
Add `this.getSelector(params.selector) || params.selector` before passing to `waitFor()`. See Section 3.2 for exact fix.

**Validation:** Write a throwaway scenario using both `element_text_contains` and `wait` with a logical selector name. Both should resolve correctly.

### Task 1: Add `group`/`order` to Existing Scenarios (~15 min)

Update `smoke-01-login` and `smoke-02-sidebar-loaded` in `smoke-tests.json` to include `"group": "independent"` and `"order"` fields. No other changes to existing scenarios.

**Validation:** Run existing suite, both pass, new fields are ignored by current runner.

### Task 2: Connector Changes (~1.5 hours)

**2a: Add `navigate_to_project` action (30 min)**
Add to `brainstormyActions` array at `connector.js:361` and implement in `performAction()` switch. Reads `current_project_id` from state when no explicit param provided.

**2b: Refactor `navigate_to_session` to support direct ID (30 min)**
Modify at `connector.js:682-694` to accept UUID and navigate directly via `this.navigate('/sessions/{id}')`, falling back to existing DOM text search for non-UUID values.

**2c: Add state fallback to `navigate_to_story` (10 min)**
Add `|| this.getState('current_story_id')` to the existing ID resolution at the top of the action handler.

**2d: Add `last_ai_response` state to `wait_for_response` (10 min)**
In `AIAppConnector.waitForAIResponse()` at `ai-chat-app/connector.js:192-200`, add `this.setState('last_ai_response', responseText)` after extracting the response.

**Validation:** Unit test each action — mock page, verify correct URL navigation and state reads.

### Task 3: Group-Aware Scenario Runner (~2-3 hours)

Modify `BaseAgent.runTests()`:
- Sort scenarios by `group` priority then `order`
- Default `group: "independent"` and `order: 0` for scenarios missing these fields
- Track `setupFailed` flag
- Skip `test` group scenarios when setup failed, with `skipped_dependency` status

Modify `BaseAgent._computeSummary()` (base-agent.js:586-593):
- Count `skipped_dependency` as distinct status, don't count as `failed`

Modify `test-orchestrator.js` summary computation (392-436):
- Same `skipped_dependency` awareness

**Validation:** Temporarily break smoke-03 (e.g., wrong selector), run suite, verify smoke-04 through smoke-08 report `skipped_dependency` and only smoke-03 reports `failed`.

### Task 4: Add New Selectors to `app.config.json` + Calibrate (~2 hours)

Add all selectors from Section 5 to `app.config.json`. Use a manual Playwright session against staging to verify each selector resolves. Update CSS values as needed.

Specific calibration steps:
- Check for existing duplicate keys (e.g., `chatInput` may already exist)
- Verify `:last-of-type` works for message selectors (may need JS-based selection if not)
- Test `navigate_to_project` to determine if in-app URL navigation works post-hydration or needs sidebar click fallback
- Where `data-testid` attributes are missing, log as frontend task (Task 7)

**Deliverable:** Updated `app.config.json` with working selectors, list of missing `data-testid` attributes.

### Task 5: Add Six New Scenarios to `smoke-tests.json` (~45 min)

Add the scenario JSON from Section 4 to the smoke tests file. Pre-merge checklist:
- ✅ All action names are snake_case
- ✅ All `step_succeeded` assertions use `stepIndex` (not `step`)
- ✅ All selector references use camelCase keys matching `app.config.json`
- ✅ File parses as valid JSON
- ✅ Scenario IDs are unique
- ✅ File remains a plain JSON array (no wrapper object)

### Task 6: Integration Test Against Staging (~2-3 hours)

Execute all 8 scenarios against Brainstormy staging. This is the iterative debugging pass. Common issues to expect:
- Selector mismatches (calibrate from actual DOM)
- Timing issues (add explicit waits or increase timeouts)
- SPA navigation quirks for `navigate_to_*` actions — determine if sidebar click fallback is needed
- AI response timeout on first run (cold LLM)

**Validation:** All 8 scenarios pass. Screenshot evidence collected for each step.

### Task 7: Frontend `data-testid` Attributes (If Needed) (~1-2 hours)

Based on findings from Task 4, add missing `data-testid` attributes to Brainstormy frontend components. This is a **Brainstormy codebase** task, not a QA Engine task. Priority attributes:

- `chat-input`, `chat-send`, `message-list` (chat interface)
- `user-message`, `assistant-message` (message bubbles)
- `project-heading`, `story-heading` (page titles)
- `session-list`, `session-item` (session navigation)
- `new-project-button`, `new-story-button`, `new-session-button` (creation CTAs)

**Validation:** Re-run suite after adding attributes, verify selectors resolve.

### Task 8: Implement Cleanup Action (~2-3 hours)

Add `cleanupTestData` to BrainstormyConnector per Section 7. Integrate with suite lifecycle:
- Pre-run: clean stale data (older than hold period)
- Post-run success: log "data preserved for 1 hour" message
- Post-run failure: log "data preserved for debugging" message

**First, check:** Does Brainstormy have a `DELETE /api/projects/:id` endpoint? If yes, use `page.evaluate(fetch(...))` approach (Option A). If no, either implement a staging-only admin delete endpoint or use Playwright UI navigation (Option B).

**Validation:** Run suite twice, verify first run's data is cleaned at start of second run.

---

## 12. Estimated Total Effort

| Task | Estimate |
|------|----------|
| Task 0: Pre-existing bug fixes | 45 min |
| Task 1: Metadata on existing scenarios | 15 min |
| Task 2: Connector changes | 1.5 hours |
| Task 3: Group-aware runner | 2-3 hours |
| Task 4: Selector calibration | 2 hours |
| Task 5: Add scenario JSON | 45 min |
| Task 6: Integration testing + debugging | 2-3 hours |
| Task 7: Frontend data-testid (if needed) | 1-2 hours |
| Task 8: Cleanup action | 2-3 hours |
| **Total** | **~12-16 hours** |

Tasks 0-2 can be done in a single focused session. Task 3 is the largest single effort and should be done independently. Tasks 4-5 are fast once selectors are calibrated. Task 6 is iterative. Tasks 7-8 can happen after core scenarios are passing.

---

## 13. Success Criteria

Phase 2 Task 2 is complete when:

- [ ] All 8 smoke scenarios pass against Brainstormy staging
- [ ] A setup failure correctly skips downstream test scenarios with `skipped_dependency` status
- [ ] `skipped_dependency` is counted correctly in summary (not as `failed`)
- [ ] Test data is cleaned up at the start of each subsequent run
- [ ] Screenshot evidence is captured for every scenario step
- [ ] The suite completes in under 3 minutes (excluding AI response wait in smoke-07)
- [ ] Results are reported via existing WhatsApp notification format
