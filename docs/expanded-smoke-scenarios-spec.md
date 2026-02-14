# Expanded Smoke Scenarios Specification

**Version:** 1.2
**Date:** February 14, 2026
**Phase:** QA Engine Phase 2 — Task 2
**Prerequisite:** Phase 2 Task 1 (First-Run Validation) complete ✅
**Status:** Ready for Implementation

---

## Changelog

### v1.2 (February 14, 2026)

Fixes from second feasibility evaluation against current codebase (post-git-pull):

**Critical:**
- Fixed smoke-02 ID mismatch: remote commit 1851751 reverted the first-run rename, so the file currently has `smoke-02-navigate-project`. The spec now references this ID throughout, and Task 1 includes renaming it back to `smoke-02-sidebar-loaded` (which was the validated, passing version). All `depends_on` chains reference the post-rename ID.

**Moderate:**
1. Added explicit SPA risk note for `createProject()`'s internal `this.navigate('/projects')` call (connector.js:468). This uses `page.goto()` — the same mechanism that broke smoke-02 during first-run. May work post-hydration but needs testing during calibration (Task 6).
2. Fixed `navigate_to_session` switch case: state fallback must happen in the switch case (`params.session_id || params.name || this.getState('current_session_id')`), not inside the method body, because the method signature is `navigateToSession(sessionIdentifier)`.
3. Fixed `wait_for_response` state fix: variable is `responseData.text` not `responseText`. Added note that `BrainstormyConnector.waitForAIResponse()` overrides the AIAppConnector method and calls `super` — the state is set during the super call, no separate changes needed in the override.
4. Reduced selector list from 18 to 11: removed 7 selectors that already exist in `app.config.json` with calibrated values from first-run (`chatInput`, `chatSend`, `sessionList`, `sessionItem`, `newProjectButton`, `newStoryButton`, `newSessionButton`). Existing calibrated values must be preserved.
5. Replaced `:last-of-type` message selectors with `data-testid`-only primary selectors and `page.evaluate()`-based fallback strategy, since `:last-of-type` matches on HTML tag name, not CSS class — if both user and assistant messages are `<div>` elements, it matches the wrong one.
6. Removed unused breadcrumb selectors (`breadcrumbProject`, `breadcrumbStory`, `breadcrumbSession`) — no scenario references them after smoke-08 was redesigned to use `navigate_to_*` actions.

**Minor:**
7. Fixed `element_text_contains` code sample to match actual structure at `base-agent.js:418-428` (uses `this.connector` and existing `text` variable, not standalone `connector`).
8. Removed redundant `|| 30000` default from `wait` action fix — `waitFor()` already defaults to 30000.
9. Added explicit task dependency order to task list.

### v1.1 (February 14, 2026)

Fixes from first feasibility evaluation — see v1.1 changelog for full details. Key fixes: snake_case action names, `stepIndex` field, pre-existing bugs flagged, SPA navigation avoidance, `use_state` pattern eliminated, cleanup rewritten without phantom API methods.

---

## 1. Overview

### What Exists Today

`apps/brainstormy/scenarios/smoke-tests.json` contains two scenarios:

| ID (current file) | ID (after Task 1 rename) | What It Tests |
|----|------|---------------|
| `smoke-01-login` | `smoke-01-login` (unchanged) | Confirms Clerk session injection worked |
| `smoke-02-navigate-project` | `smoke-02-sidebar-loaded` | Confirms app shell renders after auth. **Note:** Remote commit 1851751 reverted the first-run rename. Task 1 renames it back to `smoke-02-sidebar-loaded` and restores the validated sidebar-check behavior that passed during first-run. |

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

**Location:** `base-agent.js:418-428`
**Problem:** `GenericWebAppConnector.extractData()` at `generic-web-app/connector.js:414` returns an object `{text, value, html, attributes}`. The assertion code assigns this object to `text`, then does `String(text).includes(assertion.value)` — producing `"[object Object]"`, which never matches.

**Fix:** Add after the existing try/catch block that assigns `text`:
```javascript
// base-agent.js — inside the element_text_contains case, after try/catch:
text = text?.text ?? null;  // extractData returns {text, value, html, attributes}
passed = text !== null && String(text).includes(assertion.value);
```

**Affects:** Any scenario using `element_text_contains`. This is a latent bug — no existing scenario has triggered it yet.

### 3.2 `wait` Action Selector Resolution Bug

**Location:** `generic-web-app/connector.js:292-294`
**Problem:** The existing `wait` action passes `params.selector` directly to `waitFor()` as raw CSS. When scenarios use logical selector names (e.g., `"sessionList"`), these are passed as literal CSS and fail.

**Fix:**
```javascript
case 'wait':
  const resolvedSelector = this.getSelector(params.selector) || params.selector;
  await this.waitFor(resolvedSelector, params.timeout);
  return { found: true, selector: params.selector };
```

**Note:** No `|| 30000` default for timeout needed — `waitFor()` at `connector.js:387` already defaults to 30000.

**Affects:** smoke-08 (uses logical names `storyList`, `sessionList`, `chatInput` in wait steps).

---

## 4. Scenario JSON Definitions

All scenarios follow the established format: separate `steps` (actions) and `assertions` arrays. Action names use snake_case matching the connector's `performAction()` switch. Assertion field names match `base-agent.js` property names. Selectors use camelCase keys matching existing `app.config.json` convention.

### 4.1 smoke-03-create-project

`create_project` already navigates to `/projects` internally (connector.js:468) via `this.navigate('/projects')`. No explicit navigate step is needed.

**⚠️ SPA hydration risk:** `create_project` calls `page.goto()` internally — the same mechanism that broke smoke-02 during first-run. This may work fine if the SPA shell is already hydrated from `initialize()` and `page.goto()` triggers client-side routing rather than a full reload. **This must be tested during Task 6 calibration.** If it fails, the `createProject()` method itself needs to be modified to use sidebar click navigation instead of `page.goto()`.

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

**Implementation requirement:** See Section 6.2 for the `last_ai_response` connector fix.

### 4.6 smoke-08-hierarchy-navigation

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

**Design:** Empty `params: {}` signals "use state." Each `navigate_to_*` action reads from connector state internally when no explicit ID param is provided — the state fallback is in the `performAction()` switch case, not inside the method body (see Section 6.2).

---

## 5. New Selectors Required in `app.config.json`

Seven selectors needed by scenarios already exist with calibrated values from first-run. These must **not** be overwritten. Only 11 genuinely new selectors need to be added.

### Existing Selectors (preserve as-is)

These are already in `app.config.json` with working values:

| Key | Already Calibrated |
|-----|--------------------|
| `chatInput` | ✅ `[data-testid="chat-input"], textarea[placeholder*="message"]` |
| `chatSend` | ✅ `[data-testid="chat-send"], button[aria-label="Send"]` |
| `sessionList` | ✅ `[data-testid="session-list"], .session-list` |
| `sessionItem` | ✅ `[data-testid="session-item"], .session-list-item` |
| `newProjectButton` | ✅ `.nav-vertical__add-btn, .section-header__add-btn` |
| `newStoryButton` | ✅ `[data-testid="new-story-button"], button:has-text("New Story")` |
| `newSessionButton` | ✅ `[data-testid="new-session-button"], button:has-text("New Session")` |

**Do not overwrite these during Task 4.** Their CSS fallback values were calibrated during first-run.

### New Selectors to Add (11 keys)

CSS values are placeholders requiring calibration against real staging:

```json
{
  "projectHeading":        "[data-testid='project-heading'], h1.project-name",
  "projectList":           "[data-testid='project-list'], .projects-container",
  "projectCard":           "[data-testid='project-card'], .project-card",

  "storyHeading":          "[data-testid='story-heading'], h1.story-name",
  "storyList":             "[data-testid='story-list'], .stories-container",
  "storyCard":             "[data-testid='story-card'], .story-card",

  "messageList":           "[data-testid='message-list'], .messages-container",
  "userMessageLast":       "[data-testid='user-message']:last-of-type",
  "assistantMessageLast":  "[data-testid='assistant-message']:last-of-type"
}
```

**Message selector calibration warning:** The `userMessageLast` and `assistantMessageLast` selectors rely on `data-testid` as the primary strategy. The `:last-of-type` pseudo-class matches based on HTML tag name, not CSS class — if user and assistant messages are both `<div>` elements, `:last-of-type` would match the last `<div>` in the container regardless of message role. During calibration (Task 4), inspect the actual DOM to determine:
- Whether `data-testid="user-message"` / `data-testid="assistant-message"` exist (ideal case)
- Whether messages use different HTML tags (e.g., `<div>` vs `<article>`) enabling `:last-of-type`
- If neither works, implement a custom `getLastMessageByRole` helper in the connector using `page.evaluate()`:

```javascript
async getLastMessageByRole(role) {
  return this.page.evaluate((r) => {
    const msgs = document.querySelectorAll(`[data-role="${r}"], .message.${r}`);
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
  }, role);
}
```

**Removed from v1.1:** `breadcrumbProject`, `breadcrumbStory`, `breadcrumbSession` — no scenario uses them after smoke-08 was redesigned. Can be added later if breadcrumb-based scenarios are created.

---

## 6. Connector Changes

### 6.1 Summary of What Exists vs. What's Needed

| Action (snake_case) | Exists? | Changes Needed |
|---------------------|---------|----------------|
| `navigate` | ✅ GenericWebAppConnector | None |
| `create_project` | ✅ BrainstormyConnector | None (SPA risk noted in Section 4.1) |
| `create_story` | ✅ BrainstormyConnector | None |
| `create_session` | ✅ BrainstormyConnector | None |
| `send_message` | ✅ AIAppConnector | None |
| `wait_for_response` | ✅ AIAppConnector | Add `setState('last_ai_response', ...)` |
| `wait` | ✅ GenericWebAppConnector | Fix selector resolution (Section 3.2) |
| `navigate_to_story` | ✅ BrainstormyConnector | Add state fallback in switch case |
| `navigate_to_project` | ❌ **New** | Implement |
| `navigate_to_session` | ⚠️ Exists, needs refactor | Add state fallback in switch case + UUID direct navigation |

### 6.2 New/Modified Actions

All state fallbacks happen in the `performAction()` switch case, not inside the method body. This matches the existing pattern where the switch case resolves params before calling the method.

#### `navigate_to_project` (New)

Add to `brainstormyActions` array at `connector.js:361` and implement in `performAction()` switch:

```javascript
case 'navigate_to_project':
  const projectId = params.project_id || this.getState('current_project_id');
  if (!projectId) throw new Error('No project ID available — provide project_id param or run create_project first');
  await this.navigate(`/projects/${projectId}`);
  await this.waitForAppReady();
  result = { navigated: true, projectId };
  break;
```

#### `navigate_to_story` (Add state fallback in switch case)

Current switch case at `connector.js:393-394`:
```javascript
case 'navigate_to_story':
  result = await this.navigateToStory(params.story_id || params.name);
```

Change to:
```javascript
case 'navigate_to_story':
  result = await this.navigateToStory(params.story_id || params.name || this.getState('current_story_id'));
```

#### `navigate_to_session` (Add state fallback in switch case + UUID support)

Current switch case at `connector.js:397-398`:
```javascript
case 'navigate_to_session':
  result = await this.navigateToSession(params.session_id || params.name);
```

Change to:
```javascript
case 'navigate_to_session':
  result = await this.navigateToSession(params.session_id || params.name || this.getState('current_session_id'));
```

Then, inside `navigateToSession(sessionIdentifier)` at `connector.js:682-694`, add UUID detection before the existing DOM search:
```javascript
async navigateToSession(sessionIdentifier) {
  // Direct navigation for UUIDs
  if (sessionIdentifier && sessionIdentifier.match(/^[0-9a-f-]{36}$/i)) {
    await this.navigate(`/sessions/${sessionIdentifier}`);
    await this.waitForAppReady();
    return { navigated: true, sessionId: sessionIdentifier };
  }
  // ... existing DOM search by text/href for non-UUID values ...
}
```

#### `wait_for_response` (Add `last_ai_response` state)

In `AIAppConnector.waitForAIResponse()` at `ai-chat-app/connector.js:184-190`, add after the existing `responseData` extraction:

```javascript
// After existing code:
// let responseData = { text: '', html: '' };
// if (lastMessage) {
//   responseData = await lastMessage.evaluate(el => ({
//     text: el.textContent,
//     html: el.innerHTML
//   }));
// }

// ADD THIS LINE:
this.setState('last_ai_response', responseData.text || '');
```

**Note:** `BrainstormyConnector.waitForAIResponse()` at `connector.js:1057-1067` overrides this method and calls `super.waitForAIResponse(timeout)`. The state is set during the `super` call, so the override does not need separate changes.

### 6.3 Param Resolution Design

No `use_state` parameter pattern is introduced. Each `navigate_to_*` switch case reads from state as a final fallback when no explicit param is provided. Scenarios pass `params: {}` to signal "use whatever is in state." This follows the existing pattern used by `create_session` (which reads `current_story_id` from state at `connector.js:562`).

### 6.4 Template Variable Note

`{{timestamp}}` and `{{uuid}}` interpolation already exists in `BaseAgent.resolveParams()` at `base-agent.js:565-579`. No implementation work needed.

---

## 7. Cleanup Strategy

### Decision: Tag-and-Sweep with Delayed Cleanup

1. **Tagging:** All test entities use `QA Smoke Test *` naming with `{{timestamp}}` suffix.

2. **Post-run hold:** Successful runs leave data for 1 hour. Failed runs preserve data indefinitely for debugging.

3. **Cleanup trigger:** Runs at the start of the next suite run, or on-demand via CLI.

### Implementation

**Option A — `page.evaluate()` with fetch (preferred if API endpoint exists):**
```javascript
async cleanupTestData(options = {}) {
  const maxAge = options.maxAge || 3600000; // 1 hour

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

**Option B — Playwright UI navigation (fallback):** Navigate to projects page, find test projects by name, click through delete flow in UI. Slower and more fragile but doesn't require API changes.

---

## 8. Scenario Runner Changes

### 8.1 Group-Aware Execution

Changes required to `BaseAgent.runTests()` — not a separate method:

```javascript
// Before iterating scenarios, sort by group then order:
const groupPriority = { independent: 0, setup: 1, test: 2 };
scenarios.sort((a, b) =>
  (groupPriority[a.group] ?? 1) - (groupPriority[b.group] ?? 1) || (a.order ?? 0) - (b.order ?? 0)
);

let setupFailed = false;

for (const scenario of scenarios) {
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

  if (result.status === 'failed' && scenario.group === 'setup') {
    setupFailed = true;
  }
}
```

**In `BaseAgent._computeSummary()` (base-agent.js:586-593):**
```javascript
summary.skipped_dependency = results.filter(r => r.status === 'skipped_dependency').length;
summary.failed = results.filter(r => r.status === 'failed').length;
// skipped_dependency does not count as failed
```

**In `test-orchestrator.js:392-436`:** Same `skipped_dependency` awareness.

### 8.2 Backward Compatibility

Scenarios without `group`/`order`/`depends_on` default to `group: "independent"`, `order: 0`, `depends_on: []`. Existing scenarios work unchanged.

---

## 9. Complete Updated `smoke-tests.json` Structure

File remains a plain JSON array. Existing scenarios get `group` and `order` fields:

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
    "...": "(renamed from smoke-02-navigate-project, behavior restored to sidebar check)"
  },
  { "...": "smoke-03 through smoke-08 from Section 4" }
]
```

---

## 10. Risk Considerations

### SPA Hydration (smoke-03, smoke-08)

Direct URL navigation to Brainstormy sub-routes may fail due to SPA hydration issues (documented in first-run Step 8).

**smoke-03:** `create_project` calls `this.navigate('/projects')` internally — same `page.goto()` mechanism that broke smoke-02 during first-run. This may work post-hydration if the initial `initialize()` call fully loaded the SPA shell. **Must be tested during Task 6.** If it fails, `createProject()` needs to be modified to use sidebar click navigation.

**smoke-08:** Uses `navigate_to_*` actions with `this.navigate()` for in-app navigation. Same risk as smoke-03, same calibration requirement.

### AI Response Timeout (smoke-07)

Highest-risk scenario — depends on OpenRouter/LLM availability. Mitigations: 60s `wait_for_response` timeout, 90s scenario timeout, tagged `slow` for optional skipping, simple prompt for fast response.

### Selector Fragility

Mitigations: `data-testid` preferred with CSS fallbacks, calibration task verifies every selector, screenshot on failure. Message selectors need special attention — see Section 5 calibration warning.

### Test Data Accumulation

Mitigations: timestamp naming for age-based cleanup, pre-run sweep, admin dashboard bulk-delete.

---

## 11. Implementation Task List

### Task Dependency Order

```
Task 0 (bug fixes) ─────────────┐
Task 1 (rename smoke-02) ───────┤
Task 2 (connector changes) ─────┼──→ Task 5 (add scenarios) ──→ Task 6 (integration test)
Task 3 (group-aware runner) ─────┤
Task 4 (selector calibration) ──┘

Task 7 (frontend data-testid) ──→ if needed based on Task 4/6 findings
Task 8 (cleanup action) ────────→ can happen after Task 6
```

Tasks 0, 1, 2, 3 can be done in parallel or in a single session. Task 4 requires staging access. Task 5 requires Tasks 0-4 complete. Task 6 requires everything.

---

### Task 0: Pre-Existing Bug Fixes (~45 min)

**Task 0a: Fix `element_text_contains` assertion (30 min)**
File: `base-agent.js:418-428`
After the existing try/catch that assigns `text`, add: `text = text?.text ?? null;`
This extracts the `.text` property from the `{text, value, html, attributes}` object returned by `extractData()`.

**Task 0b: Fix `wait` action selector resolution (15 min)**
File: `generic-web-app/connector.js:292-294`
Add `this.getSelector(params.selector) || params.selector` before passing to `waitFor()`. No default timeout needed — `waitFor()` already defaults to 30000.

**Validation:** Write a throwaway scenario using both assertion types with logical selector names.

### Task 1: Rename smoke-02 + Add Metadata (~30 min)

Rename `smoke-02-navigate-project` back to `smoke-02-sidebar-loaded` in `smoke-tests.json` and restore the validated sidebar-check behavior from first-run. The current remote version (commit 1851751) reverted the first-run rename and uses `/projects` navigation which hit SPA hydration issues.

Also add `"group": "independent"` and `"order"` fields to both existing scenarios.

**Validation:** Run existing suite, both pass with renamed smoke-02.

### Task 2: Connector Changes (~1.5 hours)

**2a: Add `navigate_to_project` action (30 min)**
Add to `brainstormyActions` array at `connector.js:361` and implement in `performAction()` switch per Section 6.2.

**2b: Add state fallback to `navigate_to_story` switch case (10 min)**
Change `params.story_id || params.name` to `params.story_id || params.name || this.getState('current_story_id')` in the switch case at `connector.js:393-394`.

**2c: Add state fallback to `navigate_to_session` switch case + UUID support (30 min)**
Change switch case at `connector.js:397-398` to include `|| this.getState('current_session_id')`. Add UUID detection inside `navigateToSession()` method per Section 6.2.

**2d: Add `last_ai_response` state to `wait_for_response` (10 min)**
In `AIAppConnector.waitForAIResponse()` at `ai-chat-app/connector.js:184-190`, add `this.setState('last_ai_response', responseData.text || '');` after the response extraction. The `BrainstormyConnector` override calls `super` so it gets this for free.

**Validation:** Unit test each action with mock page.

### Task 3: Group-Aware Scenario Runner (~2-3 hours)

Modify `BaseAgent.runTests()`, `BaseAgent._computeSummary()`, and `test-orchestrator.js` summary computation per Section 8.

**Validation:** Temporarily break smoke-03, run suite, verify smoke-04 through smoke-08 report `skipped_dependency` and only smoke-03 reports `failed`.

### Task 4: Add New Selectors to `app.config.json` + Calibrate (~2 hours)

Add the 11 new selectors from Section 5. **Do not overwrite** the 7 existing calibrated selectors.

Calibration checklist:
- Verify each new selector resolves against real staging DOM
- Determine message selector strategy (see Section 5 calibration warning)
- Test whether `page.goto()` to `/projects/{id}` works post-hydration (determines if smoke-03/08 need connector changes)
- Log missing `data-testid` attributes for Task 7

**Deliverable:** Updated `app.config.json`, list of missing `data-testid` attributes, SPA navigation finding.

### Task 5: Add Six New Scenarios to `smoke-tests.json` (~45 min)

Add scenario JSON from Section 4. Pre-merge checklist:
- ✅ All action names are snake_case
- ✅ All `step_succeeded` assertions use `stepIndex`
- ✅ All selector references use camelCase matching `app.config.json`
- ✅ File remains plain JSON array
- ✅ All `depends_on` reference `smoke-02-sidebar-loaded` (post-Task 1 rename)

### Task 6: Integration Test Against Staging (~2-3 hours)

Execute all 8 scenarios. Priority debug areas:
- SPA hydration: does `create_project`'s internal `page.goto('/projects')` work post-hydration?
- Message selectors: does `userMessageLast` / `assistantMessageLast` resolve correctly?
- AI response timeout tuning
- Timing issues (increase waits as needed)

**Validation:** All 8 scenarios pass with screenshot evidence.

### Task 7: Frontend `data-testid` Attributes (If Needed) (~1-2 hours)

Brainstormy codebase task based on Task 4/6 findings. Priority: `user-message`, `assistant-message`, `project-heading`, `story-heading`, `message-list`.

### Task 8: Implement Cleanup Action (~2-3 hours)

Per Section 7. First check if `DELETE /api/projects/:id` exists, then choose Option A or B.

---

## 12. Estimated Total Effort

| Task | Estimate |
|------|----------|
| Task 0: Pre-existing bug fixes | 45 min |
| Task 1: Rename smoke-02 + metadata | 30 min |
| Task 2: Connector changes | 1.5 hours |
| Task 3: Group-aware runner | 2-3 hours |
| Task 4: Selector calibration | 2 hours |
| Task 5: Add scenario JSON | 45 min |
| Task 6: Integration testing + debugging | 2-3 hours |
| Task 7: Frontend data-testid (if needed) | 1-2 hours |
| Task 8: Cleanup action | 2-3 hours |
| **Total** | **~12-16 hours** |

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
