# BrainstormyConnector + ConnectorFactory Implementation Log

**Spec:** docs/brainstormy-connector-factory-implementation-spec.md
**Started:** 2026-02-11

---

## Task 1: Extend Mock Helpers (Step 1)

**Status:** Complete
**Commit:** 3a73ee3
**Files changed:** `tests/helpers/mock-playwright.js` (modified, 77 insertions)

**What was done:**
- Added `createMockCitationElement(id, text)` factory:
  - `getAttribute`: jest.fn() returning Promise (Playwright ElementHandle method for `data-citation-id`)
  - `textContent`: jest.fn() returning Promise (Playwright ElementHandle method for cited text)
  - `evaluate`: jest.fn() for compatibility with extractData pattern
- Added `createBrainstormyAppConfig(overrides)` factory:
  - Extends `createMockAppConfig` with full selector set: login (4), chat (4), Brainstormy-specific (17)
  - `auth_indicator` and `ready_indicator` explicitly included at config top-level
  - `url_patterns` as strings (JSON-compatible): project_id, story_id, session_id
  - Extended timeouts: ai_response (60s), bible_generation (120s), navigation (30s)
  - `connector: { type: 'brainstormy', base: 'ai-chat-app' }` for ConnectorFactory
- Updated exports to include both new factories

**Backward compatibility validation:**
- EvidenceCollector tests: 75/75 pass
- BaseConnector tests: 51/51 pass
- GenericWebAppConnector tests: 99/99 pass
- AIAppConnector tests: 60/60 pass
- Full suite: 285 tests, 0 failures

---

## Task 2: Implement BrainstormyConnector (Step 2.1)

**Status:** Complete
**Commit:** 81203c9
**Files changed:** `connectors/brainstormy/connector.js` (new, 422 lines)

**What was done:**
- Implemented full BrainstormyConnector class per spec Section 7
- Project/Story/Session management: `createProject()` navigates to /projects, clicks new, fills name, submits, extracts ID from URL, stores in state; `createStory()` requires current_project_id, clicks new, fills name, selects vertical, submits, extracts ID; `createSession()` requires current_story_id, clicks new, conditional type selection, conditional submit click (some UIs auto-submit), extracts ID
- Navigation: `navigateToStory()` navigates to /stories/{id}, updates state
- Bible generation: `generateStoryBible()` requires current_story_id, clicks bible button, selects template via prefix concatenation (`bible_template_prefix + template + '"]'`), clicks generate, waits with bible_generation timeout, extracts content
- Session summary: `getSessionSummary()` navigates to /sessions/{id}, clicks summary button, waits for content, extracts text
- Citation extraction: `waitForAIResponse()` override calls super then decorates with `extractCitations()`; `extractCitations()` uses `el.getAttribute('data-citation-id')` + `el.textContent()` (Playwright ElementHandle methods), never throws
- URL ID extraction: `_extractIdFromUrl()` reads patterns from `config.url_patterns`, handles both RegExp and string patterns via `new RegExp()`, falls back to generic UUID regex
- Action dispatch: `performAction()` wraps 6 Brainstormy actions with evidence, delegates everything else to `super.performAction()`

**Validation:**
- Module loads correctly, all methods are functions
- Full inheritance chain: AIAppConnector → GenericWebAppConnector → BaseConnector (all instanceof checks pass)
- Inherited methods (sendMessage, click, collectEvidence, etc.) accessible

---

## Task 3: Implement ConnectorFactory (Step 2.2)

**Status:** Complete
**Commit:** aa77c36
**Files changed:** `connectors/factory.js` (new, 95 lines)

**What was done:**
- Implemented ConnectorFactory per spec Section 8
- `CONNECTOR_REGISTRY`: static class field mapping type strings to classes — `generic` → GenericWebAppConnector, `ai-chat-app` → AIAppConnector, `brainstormy` → BrainstormyConnector
- `create(app, page, evidenceCollector, { skipInitialize })`: reads `app.connector.type`, looks up class, instantiates, optionally calls `initialize()`; throws ConnectorError for missing type or unknown type (error message lists available types)
- `register(type, ConnectorClass)`: add new connector types at runtime
- `getRegisteredTypes()`: returns array of registered type strings

**Validation:**
- Module loads correctly, all 3 static methods are functions
- `getRegisteredTypes()` returns `['generic', 'ai-chat-app', 'brainstormy']`

---

## Task 4: Implement BrainstormyConnector Tests (Step 2.3)

**Status:** Complete
**Commit:** 585b766
**Files changed:** `tests/connectors/brainstormy-connector.test.js` (new, 978 lines)

**What was done:**
- 83 unit tests across 12 describe blocks, all passing
- Constructor / Instantiation: 4 tests (direct instantiation, AIAppConnector/GenericWebAppConnector/BaseConnector inheritance)
- performAction(): 12 tests (6 Brainstormy action dispatches, 3 delegations to super chain, before/after/failure evidence)
- createProject(): 9 tests (navigation, button click, name fill, submit, waitForNavigation, ID extraction, state storage, return value, error on missing ID)
- createStory(): 9 tests (requires project, error without project, button/name/vertical/submit, ID extraction, state, return value)
- createSession(): 10 tests (requires story, error without story, button, type selection, skip type, conditional submit exists/not-exists, ID extraction, state, return value)
- navigateToStory(): 2 tests (navigation, state update)
- generateStoryBible(): 9 tests (requires story, bible button, template prefix+key concatenation, generate button, bible_generation timeout wait, content extraction, default template, return value, null content)
- getSessionSummary(): 6 tests (navigation, summary button, wait for content, text extraction, return value, null summary)
- waitForAIResponse() override: 5 tests (super call, citation extraction, response structure, empty citations, error resilience)
- extractCitations(): 7 tests (selector query, getAttribute id, textContent text, array of objects, no selector configured, empty elements, error never throws)
- _extractIdFromUrl(): 5 tests (config patterns, UUID fallback, null on no match, RegExp patterns, string patterns)
- Inherited behavior: 5 smoke tests (sendMessage, validateMemory, click/type, evidence delegation, getSelector)

**Test infrastructure:**
- `createConnector()` factory using shared `createBrainstormyAppConfig`, `createMockPage`, local `createMockEvidence`
- `mockUrlWithId(page, url)` helper for URL-based ID extraction tests
- `setupWaitForResponseMocks()` for waitForAIResponse override tests with citation elements

**Results:**
```
Test Suites: 1 passed, 1 total
Tests:       83 passed, 83 total
Time:        0.145s
```

**Full suite:** 368/368 tests across 5 suites

---

## Task 5: Implement ConnectorFactory Tests (Step 2.4)

**Status:** Complete
**Commit:** a4b866d
**Files changed:** `tests/connectors/connector-factory.test.js` (new, 235 lines)

**What was done:**
- 15 unit tests across 3 describe blocks, all passing
- create(): 9 tests (GenericWebAppConnector for "generic", AIAppConnector for "ai-chat-app", BrainstormyConnector for "brainstormy", initialize() called, skipInitialize skips, missing connector.type error, unknown type error, error lists available types, constructor arg passthrough)
- register(): 3 tests (adds new type, create() instantiates registered type, can override existing type)
- getRegisteredTypes(): 3 tests (returns string array, includes all defaults, includes dynamically registered types)

**Test infrastructure:**
- `beforeEach/afterEach` saves and restores `CONNECTOR_REGISTRY` to prevent `register()` tests from polluting other tests

**Results:**
```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
Time:        0.109s
```

**Full suite:** 383/383 tests across 6 suites

---

## Task 6: Final Validation (Step 3)

**Status:** Complete

**All validation checks passed:**

1. `npm test` — 383/383 tests pass (6 suites), 0 failures, 0.38s
2. Full inheritance chain verified: `BrainstormyConnector → AIAppConnector → GenericWebAppConnector → BaseConnector` (all instanceof checks pass)
3. ConnectorFactory: `getRegisteredTypes()` returns `['generic', 'ai-chat-app', 'brainstormy']`
4. Backward compatibility: EvidenceCollector (75) + BaseConnector (51) + GenericWebAppConnector (99) + AIAppConnector (60) tests unaffected

---

## Implementation Summary

**All tasks complete.** BrainstormyConnector + ConnectorFactory implementation matches spec Sections 7 and 8.

| File | Lines | Purpose |
|------|-------|---------|
| `tests/helpers/mock-playwright.js` | 243 | Extended: +createMockCitationElement, +createBrainstormyAppConfig |
| `connectors/brainstormy/connector.js` | 422 | BrainstormyConnector — domain-specific actions + citation extraction |
| `connectors/factory.js` | 95 | ConnectorFactory — static registry + create/register/getRegisteredTypes |
| `tests/connectors/brainstormy-connector.test.js` | 978 | 83 unit tests across 12 describe blocks |
| `tests/connectors/connector-factory.test.js` | 235 | 15 unit tests across 3 describe blocks |

**Test results:**
```
Test Suites: 6 passed, 6 total
Tests:       383 passed, 383 total (51 BaseConnector + 75 EvidenceCollector + 99 GenericWebAppConnector + 60 AIAppConnector + 83 BrainstormyConnector + 15 ConnectorFactory)
```

**Week 1 connector layer is now complete:**
- BaseConnector (abstract contract)
- EvidenceCollector (never-fail evidence capture)
- GenericWebAppConnector (Playwright interactions + evidence wrapping)
- AIAppConnector (chat-specific actions)
- BrainstormyConnector (Brainstormy domain actions)
- ConnectorFactory (instantiation from config)

**Next steps per spec Section 13:**
- Week 2, Days 1-2: BaseAgent + HealerAgent (smoke tests, regression detection)
- Week 2, Days 3-4: SentinelAgent + LibrarianAgent (data persistence, citation accuracy)
- Week 2, Day 5: Test Orchestrator (runs agents in sequence, aggregates results)
