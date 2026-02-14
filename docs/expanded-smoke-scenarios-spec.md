# Expanded Smoke Scenarios Specification

**Version:** 1.0
**Date:** February 14, 2026
**Phase:** QA Engine Phase 2 — Task 2
**Prerequisite:** Phase 2 Task 1 (First-Run Validation) complete ✅
**Status:** Ready for Implementation

---

## 1. Overview

### What Exists Today

`apps/brainstormy/scenarios/smoke-tests.json` contains two passing scenarios:

| ID | Name | What It Tests |
|----|------|---------------|
| `smoke-01-login` | Verify authenticated state | Confirms Clerk session injection worked |
| `smoke-02-navigate-project` | Navigate to projects page | Confirms basic navigation and page load |

Authentication is handled by `connector.initialize()` via Clerk Backend API session injection — no scenario needs login steps.

### What This Spec Adds

Six new scenarios covering the Brainstormy core happy path:

| ID | Name | What It Tests |
|----|------|---------------|
| `smoke-03-create-project` | Create a new project | Project creation flow, redirect, sidebar update |
| `smoke-04-create-story` | Create a story within a project | Story creation, vertical selection, redirect |
| `smoke-05-create-session` | Create an Explore session | Session creation, mode selection, chat interface load |
| `smoke-06-send-message` | Send a user message | Message input, send, message appears in chat |
| `smoke-07-ai-response` | Receive an AI response | AI generates a reply, response renders in chat |
| `smoke-08-hierarchy-navigation` | Navigate project → story → session | Breadcrumb/sidebar navigation across all three levels |

Together with the existing two, these eight scenarios form a complete smoke suite covering: auth → navigation → CRUD → chat → AI round-trip → hierarchy traversal.

---

## 2. Architecture Decision: Independent vs. Sequential Scenarios

### Decision: Hybrid — Shared Setup Phase + Independent Assertions

**Problem:** Pure independence means each scenario creates its own project/story/session, which is slow and creates a lot of test data. Pure sequencing means a failure in `smoke-03` cascades to fail `smoke-04` through `smoke-08`, hiding the real issue.

**Solution:** Use a two-tier approach:

1. **Setup scenarios (smoke-03 through smoke-05)** are sequential and create test entities. They run first, in order. If any fails, the suite short-circuits with a clear "setup failed" report rather than running (and failing) all downstream scenarios.

2. **Test scenarios (smoke-06 through smoke-08)** are independent of each other but depend on setup having succeeded. They use the session/story/project created during setup. If `smoke-06` fails, `smoke-07` and `smoke-08` still run.

This is implemented via **state passthrough**: setup scenarios store IDs in connector state (`current_project_id`, `current_story_id`, `current_session_id`), and test scenarios read them.

```
smoke-01-login          ─┐
smoke-02-navigate       ─┤  Independent (existing)
                         │
smoke-03-create-project ─┐
smoke-04-create-story   ─┤  Sequential setup (new)
smoke-05-create-session ─┘
                         │
smoke-06-send-message   ─┐
smoke-07-ai-response    ─┤  Independent tests (new, depend on setup)
smoke-08-hierarchy-nav  ─┘
```

### Scenario Metadata

Each scenario gets a `group` and `order` field to express this:

```json
{
  "group": "setup",
  "order": 3,
  "depends_on": ["smoke-02-navigate-project"]
}
```

The runner processes groups in order (`independent` → `setup` → `test`) and within each group respects `order`. If a `setup` scenario fails, all `test` scenarios are skipped with status `skipped_dependency`.

---

## 3. Scenario JSON Definitions

All scenarios follow the established format: separate `steps` (actions) and `assertions` arrays, with selectors resolved via `connector.getSelector()`.

### 3.1 smoke-03-create-project

```json
{
  "id": "smoke-03-create-project",
  "name": "Create a new project",
  "description": "Creates a test project and verifies it appears in the UI",
  "group": "setup",
  "order": 3,
  "depends_on": ["smoke-02-navigate-project"],
  "tags": ["smoke", "crud", "project"],
  "timeout": 30000,
  "steps": [
    {
      "action": "navigate",
      "params": { "path": "/projects" }
    },
    {
      "action": "createProject",
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
      "selector": "project_heading",
      "message": "Project heading should be visible"
    },
    {
      "type": "element_text_contains",
      "selector": "project_heading",
      "value": "QA Smoke Test Project",
      "message": "Project heading should contain the project name"
    }
  ]
}
```

### 3.2 smoke-04-create-story

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
      "action": "createStory",
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
      "type": "state_equals",
      "key": "current_vertical",
      "value": "novel",
      "message": "Vertical should be stored as 'novel'"
    },
    {
      "type": "element_exists",
      "selector": "story_heading",
      "message": "Story heading should be visible"
    }
  ]
}
```

### 3.3 smoke-05-create-session

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
      "action": "createSession",
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
      "selector": "chat_input",
      "message": "Chat input should be visible (session is active)"
    },
    {
      "type": "element_exists",
      "selector": "message_list",
      "message": "Message list container should exist"
    }
  ]
}
```

### 3.4 smoke-06-send-message

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
      "action": "sendMessage",
      "params": {
        "text": "Hello, this is a QA smoke test message. Let's brainstorm a story about a detective in 1920s Chicago."
      }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "step": 0,
      "message": "sendMessage action should complete without error"
    },
    {
      "type": "element_exists",
      "selector": "user_message_last",
      "message": "User message should appear in the chat"
    },
    {
      "type": "element_text_contains",
      "selector": "user_message_last",
      "value": "QA smoke test message",
      "message": "User message should contain the sent text"
    }
  ]
}
```

### 3.5 smoke-07-ai-response

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
      "action": "sendMessage",
      "params": {
        "text": "QA test: briefly describe a mysterious character who runs a speakeasy."
      }
    },
    {
      "action": "waitForAIResponse",
      "params": { "timeout": 60000 }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "step": 1,
      "message": "waitForAIResponse should complete within timeout"
    },
    {
      "type": "element_exists",
      "selector": "assistant_message_last",
      "message": "An assistant message should appear in the chat"
    },
    {
      "type": "state_truthy",
      "key": "last_ai_response",
      "message": "Connector state should store the AI response"
    }
  ]
}
```

### 3.6 smoke-08-hierarchy-navigation

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
      "action": "navigate",
      "params": { "path": "/projects" }
    },
    {
      "action": "wait",
      "params": { "selector": "project_list", "timeout": 10000 }
    },
    {
      "action": "navigateToProject",
      "params": { "use_state": "current_project_id" }
    },
    {
      "action": "wait",
      "params": { "selector": "story_list", "timeout": 10000 }
    },
    {
      "action": "navigateToStory",
      "params": { "use_state": "current_story_id" }
    },
    {
      "action": "wait",
      "params": { "selector": "session_list", "timeout": 10000 }
    },
    {
      "action": "navigateToSession",
      "params": { "use_state": "current_session_id" }
    },
    {
      "action": "wait",
      "params": { "selector": "chat_input", "timeout": 10000 }
    }
  ],
  "assertions": [
    {
      "type": "step_succeeded",
      "step": 1,
      "message": "Project list should load on /projects"
    },
    {
      "type": "step_succeeded",
      "step": 3,
      "message": "Story list should load on project page"
    },
    {
      "type": "step_succeeded",
      "step": 5,
      "message": "Session list should load on story page"
    },
    {
      "type": "step_succeeded",
      "step": 7,
      "message": "Chat input should load in session view"
    },
    {
      "type": "url_contains",
      "value": "/sessions/",
      "message": "Should end on the session page"
    },
    {
      "type": "element_exists",
      "selector": "chat_input",
      "message": "Chat interface should be visible at the end"
    }
  ]
}
```

---

## 4. New Selectors Required in `app.config.json`

The existing selector map needs the following additions. CSS values are placeholders — they must be calibrated against the real staging UI.

```json
{
  "selectors": {
    "___EXISTING___": "...",

    "project_heading":        "[data-testid='project-heading'], h1.project-name",
    "project_list":           "[data-testid='project-list'], .projects-container",
    "project_card":           "[data-testid='project-card'], .project-card",

    "story_heading":          "[data-testid='story-heading'], h1.story-name",
    "story_list":             "[data-testid='story-list'], .stories-container",
    "story_card":             "[data-testid='story-card'], .story-card",

    "session_list":           "[data-testid='session-list'], .sessions-container",
    "session_item":           "[data-testid='session-item'], .session-item",

    "chat_input":             "[data-testid='chat-input'], textarea.message-input",
    "chat_send":              "[data-testid='chat-send'], button.send-button",
    "message_list":           "[data-testid='message-list'], .messages-container",
    "user_message_last":      "[data-testid='user-message']:last-child, .message.user:last-child",
    "assistant_message_last": "[data-testid='assistant-message']:last-child, .message.assistant:last-child",

    "new_project_button":     "[data-testid='new-project-button'], button:has-text('New Project')",
    "new_story_button":       "[data-testid='new-story-button'], button:has-text('New Story')",
    "new_session_button":     "[data-testid='new-session-button'], button:has-text('New Session')",

    "breadcrumb_project":     "[data-testid='breadcrumb-project'], .breadcrumb .project-link",
    "breadcrumb_story":       "[data-testid='breadcrumb-story'], .breadcrumb .story-link",
    "breadcrumb_session":     "[data-testid='breadcrumb-session'], .breadcrumb .session-link"
  }
}
```

**Selector strategy:** Each selector uses a `data-testid` primary (preferred) with a CSS class/semantic fallback. During calibration (Task 3 below), we'll determine which selectors the real staging UI supports and update accordingly. Where neither matches, we'll add `data-testid` attributes to the Brainstormy frontend.

---

## 5. Connector Changes: New `performAction()` Actions

### 5.1 Actions Already Covered

These existing connector actions handle most scenarios:

| Action | Source | Used By |
|--------|--------|---------|
| `navigate` | GenericWebAppConnector | smoke-08 |
| `createProject` | BrainstormyConnector | smoke-03 |
| `createStory` | BrainstormyConnector | smoke-04 |
| `createSession` | BrainstormyConnector | smoke-05 |
| `sendMessage` (via `send_message`) | AIAppConnector | smoke-06, smoke-07 |
| `waitForAIResponse` (via `wait_for_response`) | AIAppConnector | smoke-07 |

### 5.2 New Actions Required

Three new actions are needed for hierarchy navigation and generic waiting:

#### `navigateToProject`

Navigates to a specific project page using an ID from connector state.

```javascript
case 'navigateToProject':
  const projectId = params.project_id || this.getState(params.use_state || 'current_project_id');
  if (!projectId) throw new Error('No project ID available');
  await this.navigate(`/projects/${projectId}`);
  return { navigated: true, projectId };
```

#### `navigateToSession`

Navigates to a specific session page using an ID from connector state.

```javascript
case 'navigateToSession':
  const sessionId = params.session_id || this.getState(params.use_state || 'current_session_id');
  if (!sessionId) throw new Error('No session ID available');
  await this.navigate(`/sessions/${sessionId}`);
  return { navigated: true, sessionId };
```

**Note:** `navigateToStory` already exists in the BrainstormyConnector spec. We need `navigateToProject` and `navigateToSession` to complete the hierarchy.

#### `wait`

A generic selector wait action for the GenericWebAppConnector level. Delegates to `waitFor()`:

```javascript
case 'wait':
  const selector = this.getSelector(params.selector) || params.selector;
  await this.waitFor(selector, params.timeout || 30000);
  return { found: true, selector: params.selector };
```

### 5.3 `{{timestamp}}` Template Variable

The `createProject` and `createStory` actions receive names containing `{{timestamp}}`. The connector (or scenario runner) should interpolate this before execution:

```javascript
// In scenario runner, before passing params to connector
function interpolateParams(params) {
  const timestamp = Date.now();
  return JSON.parse(
    JSON.stringify(params).replace(/\{\{timestamp\}\}/g, timestamp)
  );
}
```

This ensures each run creates uniquely-named entities, making it easy to identify test data.

### 5.4 `last_ai_response` State Key

The `waitForAIResponse` action in AIAppConnector should store the response text in connector state:

```javascript
async waitForAIResponse(timeout = 60000) {
  const responseSelector = this.getSelector('assistant_message_last');
  await this.waitFor(responseSelector, timeout);
  const responseText = await this.extractData(responseSelector);
  this.setState('last_ai_response', responseText?.text || '');
  return { text: responseText?.text };
}
```

This enables the `state_truthy` assertion in smoke-07 to verify a response was received.

---

## 6. Cleanup Strategy

### Decision: Tag-and-Sweep with Delayed Cleanup

**Rationale:** Test data should persist long enough for debugging but not accumulate indefinitely.

### How It Works

1. **Tagging:** All test entities created during smoke tests use a recognizable naming pattern: `QA Smoke Test *`. The `{{timestamp}}` suffix makes each run's data unique.

2. **Post-run hold:** After a successful suite run, test data is left in place for 1 hour. This allows manual inspection if a scenario passed but the results feel wrong.

3. **Cleanup trigger:** A `cleanupTestData` action on the connector deletes all projects matching the `QA Smoke Test *` pattern that are older than the hold period. This runs:
   - Automatically at the end of a successful suite (after the hold period)
   - On-demand via CLI: `qa-engine cleanup --app brainstormy`
   - At the start of the next suite run (stale data from failed previous runs)

4. **Failed run behavior:** If the suite fails, test data is NOT cleaned up. This preserves the exact state for debugging. The next suite run cleans up stale data before starting.

### Implementation

```javascript
// In BrainstormyConnector
async cleanupTestData(options = {}) {
  const maxAge = options.maxAge || 3600000; // 1 hour default
  const cutoff = Date.now() - maxAge;

  // Use Brainstormy API directly if available, or navigate UI
  // API approach (preferred — faster, more reliable):
  const projects = await this.apiGet('/api/projects');
  const testProjects = projects.filter(p =>
    p.name.startsWith('QA Smoke Test') &&
    new Date(p.created_at).getTime() < cutoff
  );

  for (const project of testProjects) {
    await this.apiDelete(`/api/projects/${project.id}`);
  }

  return { deleted: testProjects.length };
}
```

**API-based cleanup is strongly preferred** over UI-based deletion. It's faster, more reliable, and doesn't generate unnecessary Playwright interactions. If the Brainstormy API doesn't expose a delete endpoint, we add one (admin-only, gated behind test environment flag).

---

## 7. Scenario Runner Changes

### 7.1 Group-Aware Execution

The scenario runner needs to understand the `group` and `depends_on` fields:

```javascript
async runSuite(scenarios) {
  // Sort by group priority, then order
  const groupOrder = { independent: 0, setup: 1, test: 2 };
  const sorted = scenarios.sort((a, b) =>
    (groupOrder[a.group] || 0) - (groupOrder[b.group] || 0) || a.order - b.order
  );

  let setupFailed = false;
  const results = [];

  for (const scenario of sorted) {
    if (setupFailed && scenario.group !== 'independent') {
      results.push({
        id: scenario.id,
        status: 'skipped_dependency',
        message: 'Setup scenario failed — skipping'
      });
      continue;
    }

    const result = await this.runScenario(scenario);
    results.push(result);

    if (result.status === 'failed' && scenario.group === 'setup') {
      setupFailed = true;
    }
  }

  return results;
}
```

### 7.2 State Passthrough

The connector state (`current_project_id`, etc.) naturally persists across scenarios within a single suite run because the connector instance is shared. No additional plumbing needed — the connector's `this.state` Map carries forward.

---

## 8. Complete Updated `smoke-tests.json`

After implementation, the file should contain all 8 scenarios. The existing `smoke-01` and `smoke-02` keep their current format. They get `group: "independent"` and `order` fields added for compatibility with the group-aware runner:

```json
{
  "suite": "brainstormy-smoke",
  "version": "2.0",
  "description": "Brainstormy core smoke test suite — auth, navigation, CRUD, chat, AI round-trip",
  "scenarios": [
    { "...": "smoke-01-login (existing, add group: independent, order: 1)" },
    { "...": "smoke-02-navigate-project (existing, add group: independent, order: 2)" },
    { "...": "smoke-03-create-project (new)" },
    { "...": "smoke-04-create-story (new)" },
    { "...": "smoke-05-create-session (new)" },
    { "...": "smoke-06-send-message (new)" },
    { "...": "smoke-07-ai-response (new)" },
    { "...": "smoke-08-hierarchy-navigation (new)" }
  ]
}
```

---

## 9. Risk Considerations

### AI Response Timeout (smoke-07)

This is the highest-risk scenario because it depends on OpenRouter/LLM availability and latency. Mitigations:

- **Generous timeout:** 60s for AI response, 90s for scenario total
- **Tagged as `slow`:** The runner can optionally skip `slow`-tagged scenarios for fast pre-deploy checks
- **Retry policy:** Consider allowing 1 retry for `slow`-tagged scenarios before marking as failed
- **Prompt is simple:** "briefly describe a mysterious character" should produce a fast, short response

### Selector Fragility

CSS selectors break when the UI changes. Mitigations:

- **Prefer `data-testid`:** These are explicit test hooks that survive refactors
- **Fallback selectors:** Each selector has a `data-testid` primary and CSS fallback
- **Calibration task:** Dedicated task to verify every selector against real staging
- **Screenshot on failure:** Evidence collector captures state for quick diagnosis

### Test Data Accumulation

If cleanup fails or is skipped, test projects accumulate. Mitigations:

- **Timestamp in names:** Easy to identify and age-out
- **Pre-run cleanup:** Each suite run cleans stale data before starting
- **Admin dashboard:** Brainstormy admin can see and bulk-delete test projects
- **API-based cleanup:** Doesn't depend on UI selectors being stable

---

## 10. Implementation Task List

### Task 1: Add `group`/`order`/`depends_on` to Existing Scenarios (~30 min)

Update `smoke-01-login` and `smoke-02-navigate-project` in `smoke-tests.json` to include the new metadata fields (`group: "independent"`, `order`, `depends_on: []`). Verify existing scenarios still pass.

**Validation:** Run existing suite, all pass, new fields are inert.

### Task 2: Implement Group-Aware Scenario Runner (~2 hours)

Modify the scenario runner to:
- Parse `group`, `order`, `depends_on` fields
- Sort scenarios by group priority then order
- Skip downstream scenarios when a `setup` scenario fails (status: `skipped_dependency`)
- Report skipped scenarios clearly in output

**Validation:** Manually break smoke-03 (e.g., wrong selector), run suite, verify smoke-04 through smoke-08 report `skipped_dependency`.

### Task 3: Add New Selectors to `app.config.json` + Calibrate (~2 hours)

Add all selectors from Section 4 to `app.config.json`. Then, using a manual Playwright session against staging, verify each selector resolves to the correct element. Update CSS values as needed. Where `data-testid` attributes are missing from the Brainstormy frontend, log them as a separate frontend task.

**Deliverable:** Updated `app.config.json` with working selectors, list of missing `data-testid` attributes.

### Task 4: Implement New Connector Actions (~1.5 hours)

Add to BrainstormyConnector's `performAction()`:
- `navigateToProject` — navigate by project ID from state
- `navigateToSession` — navigate by session ID from state

Add to GenericWebAppConnector's `performAction()`:
- `wait` — generic selector wait action

Update AIAppConnector's `waitForAIResponse` to store `last_ai_response` in state.

**Validation:** Unit test each new action with mock page.

### Task 5: Implement `{{timestamp}}` Interpolation (~30 min)

Add template variable interpolation to the scenario runner so `{{timestamp}}` in step params is replaced with `Date.now()` before execution.

**Validation:** Run a scenario with `{{timestamp}}` in a name, verify the created entity has a numeric suffix.

### Task 6: Add Six New Scenarios to `smoke-tests.json` (~1 hour)

Add the scenario JSON from Section 3 to the smoke tests file. This is mostly copy-paste from this spec with minor adjustments based on selector calibration from Task 3.

**Validation:** File parses as valid JSON, scenario IDs are unique.

### Task 7: Run Full Suite Against Staging (~1-2 hours)

Execute all 8 scenarios against Brainstormy staging. Debug and fix:
- Selector mismatches (most likely issue)
- Timing issues (add waits where needed)
- Action sequence problems (e.g., button not clickable yet)
- AI response timeout tuning

**Validation:** All 8 scenarios pass. Screenshot evidence collected for each.

### Task 8: Implement Cleanup Action (~1 hour)

Add `cleanupTestData` to BrainstormyConnector. Integrate with post-suite hook:
- On success: schedule cleanup after hold period (or clean immediately in CI mode)
- On failure: skip cleanup, log message about preserved test data
- On next run: clean stale data before starting

**Validation:** Run suite twice, verify first run's data is cleaned before second run creates new data.

### Task 9: Frontend `data-testid` Attributes (If Needed) (~1-2 hours)

Based on findings from Task 3, add missing `data-testid` attributes to Brainstormy frontend components. This is a Brainstormy codebase task, not a QA Engine task. Priority `data-testid` attributes:

- `chat-input`, `chat-send`, `message-list` (chat interface)
- `user-message`, `assistant-message` (message bubbles)
- `project-heading`, `story-heading` (page titles)
- `session-list`, `session-item` (session navigation)
- `new-project-button`, `new-story-button`, `new-session-button` (creation CTAs)

**Validation:** Re-run suite after adding attributes, verify selectors resolve.

---

## 11. Estimated Total Effort

| Task | Estimate |
|------|----------|
| Task 1: Metadata on existing scenarios | 30 min |
| Task 2: Group-aware runner | 2 hours |
| Task 3: Selector calibration | 2 hours |
| Task 4: New connector actions | 1.5 hours |
| Task 5: Timestamp interpolation | 30 min |
| Task 6: Add scenario JSON | 1 hour |
| Task 7: Integration testing + debugging | 1-2 hours |
| Task 8: Cleanup action | 1 hour |
| Task 9: Frontend data-testid (if needed) | 1-2 hours |
| **Total** | **~10-12 hours** |

Tasks 1-6 can be done in a single implementation session. Task 7 is iterative debugging. Tasks 8-9 can happen in parallel or after the core scenarios are passing.

---

## 12. Success Criteria

Phase 2 Task 2 is complete when:

- [ ] All 8 smoke scenarios pass against Brainstormy staging
- [ ] A setup failure correctly skips downstream test scenarios
- [ ] Test data is cleaned up after successful runs
- [ ] Screenshot evidence is captured for every scenario step
- [ ] The suite completes in under 3 minutes (excluding AI response wait)
- [ ] Results are reported via existing WhatsApp notification format
