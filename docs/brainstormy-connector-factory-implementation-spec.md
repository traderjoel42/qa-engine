# QA Engine: BrainstormyConnector + ConnectorFactory Implementation Specification

**Phase:** 1, Week 1, Day 5  
**Purpose:** Implementation-ready spec for `connectors/brainstormy/connector.js` and `connectors/factory.js`  
**For:** Claude Code evaluation → implementation  
**References:** qa-engine-03-connector-pattern-spec.md, ai-chat-app-connector-implementation-spec.md  
**Depends on:** `connectors/ai-chat-app/connector.js` (implemented), all parent connectors, `connectors/errors.js`  
**Depended on by:** All agents (Week 2), ConnectorFactory used by Test Orchestrator

---

## 1. Design Decisions

### BrainstormyConnector — Role in the System

BrainstormyConnector is the **leaf node** of the inheritance chain — the one connector that actually knows about Brainstormy's domain model (projects, stories, sessions, bibles, reports, citations). It's the thinnest layer: UI automation recipes for Brainstormy-specific workflows, no business logic.

```
BaseConnector (abstract — contract)
    ↓
GenericWebAppConnector (Playwright interactions + evidence wrapping)
    ↓
AIAppConnector (chat: send_message, wait_for_response, validate_memory)
    ↓
BrainstormyConnector (THIS — projects, stories, sessions, bibles, citations)
```

### ConnectorFactory — Role in the System

ConnectorFactory is a static factory that instantiates the correct connector class based on app config. It's the single entry point agents use to get a connector — agents never import specific connector classes directly.

### Key Design Principles

1. **Configuration over hardcoding — extended.** The original spec (qa-engine-03) hardcoded selectors like `[data-testid="new-project-button"]` inside BrainstormyConnector methods. This violates the pattern established by GenericWebAppConnector. Instead, **all selectors go into config**, and methods reference them via `this.getSelector()`. This makes BrainstormyConnector resilient to frontend selector changes without code modifications.

2. **ID extraction from URLs.** After creating a project/story/session, the connector extracts the entity ID from the URL. This is the one Brainstormy-specific assumption that can't be configured away — the URL structure (`/projects/{id}`, `/stories/{id}`, `/sessions/{id}`) is an architectural contract.

3. **waitForAIResponse override for citations.** BrainstormyConnector overrides `waitForAIResponse` to extract citation data from the response DOM after the parent extracts the text. This is the cleanest extension point — `super.waitForAIResponse()` handles streaming detection and text extraction, then BrainstormyConnector decorates the result with citations.

4. **Thin adapters.** Each method is a UI automation recipe: navigate → click → fill → wait → extract → return. No validation, no retries, no orchestration logic. If `createProject` fails because a selector is missing, the Playwright error wrapping from GenericWebAppConnector handles it.

### What Changes from the Original Spec

- **All selectors via config.** Methods use `this.getSelector('new_project_button')` instead of `'[data-testid="new-project-button"]'`.
- **performAction evidence wrapping.** Follows the same pattern as AIAppConnector — wraps its own actions with evidence, delegates unknown actions to super.
- **Error types.** Uses `ConnectorError` from the hierarchy, not bare `Error`.
- **Timestamp format.** Uses ISO strings (`.toISOString()`) consistently, matching AIAppConnector.
- **ConnectorFactory included.** Bundled into this spec since it's small and completes the connector layer.

---

## 2. BrainstormyConnector — Method Inventory

### 2.1 Brainstormy-Specific Actions (new)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `createProject(name)` | `async (string) → {id, name, timestamp}` | Navigate to projects, click new, fill name, submit, extract ID from URL. |
| `createStory(name, vertical)` | `async (string, string) → {id, name, vertical, timestamp}` | Within current project, create a story with a vertical type. |
| `createSession(type)` | `async (string?) → {id, type, timestamp}` | Within current story, create a new brainstorming session. |
| `navigateToStory(storyId)` | `async (string) → void` | Navigate to a specific story page. Updates state. |
| `generateStoryBible(template)` | `async (string?) → {template, content, timestamp}` | Navigate to story tools, select template, generate, extract content. |
| `getSessionSummary(sessionId)` | `async (string) → {session_id, summary, timestamp}` | Navigate to session, click summary, extract text. |
| `extractCitations()` | `async () → Array<{id, text}>` | Extract citation elements from the most recent AI response. |

### 2.2 Overridden Methods

| Method | Why overridden |
|--------|----------------|
| `performAction(action, params)` | Adds Brainstormy-specific action dispatch. Delegates unknown to super. |
| `waitForAIResponse(timeout?)` | Calls super, then decorates result with extracted citations. |

### 2.3 Inherited Methods (NOT overridden)

Everything from AIAppConnector, GenericWebAppConnector, and BaseConnector works as-is. Full chat capabilities (`sendMessage`, `validateMemory`, etc.), all Playwright interactions, evidence collection, state management, config helpers.

---

## 3. performAction — Brainstormy Actions

### Supported Actions

| Action string | Dispatches to | Required params |
|---|---|---|
| `'create_project'` | `this.createProject(params.name)` | `{ name }` |
| `'create_story'` | `this.createStory(params.name, params.vertical)` | `{ name, vertical }` |
| `'create_session'` | `this.createSession(params.type)` | `{ type? }` |
| `'navigate_to_story'` | `this.navigateToStory(params.story_id)` | `{ story_id }` |
| `'generate_bible'` | `this.generateStoryBible(params.template)` | `{ template? }` |
| `'get_session_summary'` | `this.getSessionSummary(params.session_id)` | `{ session_id }` |
| anything else | `super.performAction(action, params)` | — (AIAppConnector or GenericWebAppConnector handles) |

### Action Chain Example

An agent running a full Brainstormy test workflow:

```javascript
await connector.performAction('create_project', { name: 'Test Project' });
await connector.performAction('create_story', { name: 'Test Story', vertical: 'novel' });
await connector.performAction('create_session', { type: 'explore' });
await connector.performAction('send_message', { text: 'A young woman named Maya discovers...' });
await connector.performAction('wait_for_response');
await connector.performAction('validate_memory', { query: 'What is her name?', expected: 'Maya' });
await connector.performAction('generate_bible', { template: 'standard' });
```

Each call captures before/after evidence at the appropriate level of the hierarchy.

---

## 4. Citation Extraction

### waitForAIResponse Override

BrainstormyConnector overrides `waitForAIResponse` to decorate the result:

```
1. Call super.waitForAIResponse(timeout) → gets { text, html, timestamp, messageIndex }
2. Call this.extractCitations() → gets [{ id, text }, ...]
3. Return { ...response, citations }
```

### extractCitations Design

Citations in Brainstormy's frontend are rendered as elements with `data-citation-id` attributes. The testing framework spec (brainstormy-testing-framework-tasks.md) defines `data-testid="citation-{id}"` on citation elements within ChatMessage.jsx.

We use `data-citation-id` as the attribute to read the citation identifier, and `textContent()` to get the cited text:

```javascript
async extractCitations() {
  const citationSelector = this.getSelector('citation_element');
  if (!citationSelector) {
    return [];
  }

  try {
    const citationElements = await this.page.$$(citationSelector);
    return await Promise.all(
      citationElements.map(async el => ({
        id: await el.getAttribute('data-citation-id'),
        text: await el.textContent()
      }))
    );
  } catch (error) {
    // Citations are supplementary — don't fail the test if extraction fails
    return [];
  }
}
```

### Why extractCitations Never Throws

Citations are supplementary evidence, not a core test assertion. If the DOM changes or citation elements can't be parsed, returning an empty array is correct — the test can still validate the response text. Agents that specifically test citation accuracy will assert on the `citations` array being non-empty.

---

## 5. URL-Based ID Extraction

### The Pattern

After creating entities, BrainstormyConnector extracts IDs from the post-redirect URL:

```javascript
const url = await this.getCurrentURL();
const match = url.match(/projects\/([a-zA-Z0-9-]+)/);
const projectId = match ? match[1] : null;
```

### Why This Works

Brainstormy's frontend uses client-side routing with entity IDs in the URL path:
- `/projects/{uuid}` after project creation
- `/projects/{uuid}/stories/{uuid}` after story creation  
- `/sessions/{uuid}` or similar after session creation

### Failure Mode

If the regex doesn't match (URL structure changed, redirect didn't happen), the ID is `null`. The method throws `ConnectorError` with a clear message. This is preferable to silently storing `null` in state.

---

## 6. Extended App Configuration

BrainstormyConnector needs additional selectors beyond what AIAppConnector uses. These go into the same `config.selectors` object:

```javascript
// Brainstormy-specific selectors (added to existing config)
{
  selectors: {
    // ... existing login, chat, and generating selectors ...

    // Project management
    new_project_button: '[data-testid="new-project-button"]',
    project_name_input: '[data-testid="project-name-input"]',
    create_project_submit: '[data-testid="create-project-button"]',

    // Story management
    new_story_button: '[data-testid="new-story-button"]',
    story_name_input: '[data-testid="story-name-input"]',
    story_vertical_select: '[data-testid="story-vertical-select"]',
    create_story_submit: '[data-testid="create-story-button"]',

    // Session management
    new_session_button: '[data-testid="new-session-button"]',
    session_type_select: '[data-testid="session-type-select"]',
    create_session_submit: '[data-testid="create-session-button"]',

    // Bible generation
    story_bible_button: '[data-testid="story-bible-button"]',
    bible_template_prefix: '[data-testid="template-',  // appended with template key + '"]'
    generate_bible_button: '[data-testid="generate-bible-button"]',
    bible_content: '[data-testid="bible-content"]',

    // Session summary
    session_summary_button: '[data-testid="session-summary-button"]',
    summary_content: '[data-testid="summary-content"]',

    // Citations
    citation_element: '[data-citation-id]'
  },

  timeouts: {
    // ... existing timeouts ...
    bible_generation: 120000
  },

  // URL patterns for ID extraction
  url_patterns: {
    project_id: /projects\/([a-zA-Z0-9-]+)/,
    story_id: /stories\/([a-zA-Z0-9-]+)/,
    session_id: /sessions\/([a-zA-Z0-9-]+)/
  }
}
```

### Design Note: `bible_template_prefix`

The template selector is constructed dynamically: `this.getSelector('bible_template_prefix') + template`. This produces `[data-testid="template-standard"]` for the `standard` template. The prefix pattern avoids needing a separate config entry for every template.

### Design Note: `url_patterns`

URL patterns for ID extraction are stored in config rather than hardcoded in the connector. This makes BrainstormyConnector testable with different URL structures and prevents the regex from being scattered across methods. Methods access them via `this.app.config?.url_patterns?.project_id`.

---

## 7. Complete BrainstormyConnector Implementation

```javascript
// connectors/brainstormy/connector.js

'use strict';

const AIAppConnector = require('../ai-chat-app/connector');
const {
  ConnectorError
} = require('../errors');

/**
 * Connector for Brainstormy — AI-powered story development platform.
 *
 * Adds Brainstormy-specific workflows on top of AIAppConnector:
 * - Create and navigate projects, stories, sessions
 * - Generate story bibles with template selection
 * - Extract session summaries
 * - Extract citation data from AI responses
 *
 * Requires additional selectors in app config beyond AIAppConnector:
 *   new_project_button, project_name_input, create_project_submit
 *   new_story_button, story_name_input, story_vertical_select, create_story_submit
 *   new_session_button, session_type_select, create_session_submit
 *   story_bible_button, bible_template_prefix, generate_bible_button, bible_content
 *   session_summary_button, summary_content
 *   citation_element
 *
 * Requires url_patterns in app config:
 *   project_id, story_id, session_id (regex patterns for URL-based ID extraction)
 *
 * Inheritance chain:
 *   BaseConnector → GenericWebAppConnector → AIAppConnector → BrainstormyConnector (this)
 *
 * @example
 * const connector = new BrainstormyConnector(brainstormyConfig, page, evidenceCollector);
 * await connector.initialize();
 * await connector.performAction('create_project', { name: 'My Novel' });
 * await connector.performAction('create_story', { name: 'Chapter 1', vertical: 'novel' });
 * await connector.performAction('create_session', { type: 'explore' });
 * await connector.performAction('send_message', { text: 'A detective arrives at...' });
 * const response = await connector.performAction('wait_for_response');
 * // response.citations contains extracted citation data
 */
class BrainstormyConnector extends AIAppConnector {

  // ===================================================================
  // ACTION DISPATCH — Overrides AIAppConnector
  // ===================================================================

  /**
   * Evidence-wrapping dispatcher for Brainstormy-specific actions.
   *
   * Handles: create_project, create_story, create_session, navigate_to_story,
   * generate_bible, get_session_summary.
   * Unrecognized actions delegate to super.performAction() which handles
   * AI actions and generic actions with their own evidence wrapping.
   *
   * @param {string} action - Action type
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<any>} Action result
   */
  async performAction(action, params = {}) {
    const brainstormyActions = [
      'create_project', 'create_story', 'create_session',
      'navigate_to_story', 'generate_bible', 'get_session_summary'
    ];

    if (!brainstormyActions.includes(action)) {
      return await super.performAction(action, params);
    }

    // Brainstormy-specific action — wrap with evidence
    const stepId = `${action}_${Date.now()}`;
    await this.collectEvidence(`before_${stepId}`);

    let result;
    try {
      switch (action) {
        case 'create_project':
          result = await this.createProject(params.name);
          break;
        case 'create_story':
          result = await this.createStory(params.name, params.vertical);
          break;
        case 'create_session':
          result = await this.createSession(params.type);
          break;
        case 'navigate_to_story':
          result = await this.navigateToStory(params.story_id);
          break;
        case 'generate_bible':
          result = await this.generateStoryBible(params.template);
          break;
        case 'get_session_summary':
          result = await this.getSessionSummary(params.session_id);
          break;
      }
    } catch (error) {
      await this.collectEvidence(`failed_${stepId}`);
      throw error;
    }

    await this.collectEvidence(`after_${stepId}`);
    return result;
  }

  // ===================================================================
  // PROJECT / STORY / SESSION MANAGEMENT
  // ===================================================================

  /**
   * Create a new project.
   *
   * @param {string} name - Project name
   * @returns {Promise<{id: string, name: string, timestamp: string}>}
   * @throws {ConnectorError} If project ID cannot be extracted from URL
   */
  async createProject(name) {
    // Navigate to projects page
    await this.navigate('/projects');

    // Click new project button
    await this.click(this.getSelector('new_project_button'));

    // Fill project name
    await this.type(this.getSelector('project_name_input'), name);

    // Submit
    await this.click(this.getSelector('create_project_submit'));

    // Wait for redirect
    await this.waitForNavigation();

    // Extract project ID from URL
    const projectId = await this._extractIdFromUrl('project_id');
    if (!projectId) {
      throw new ConnectorError(
        'Failed to extract project ID from URL after creation',
        { action: 'create_project', phase: 'interact' }
      );
    }

    // Store in state
    this.setState('current_project_id', projectId);

    return {
      id: projectId,
      name,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create a new story within the current project.
   *
   * @param {string} name - Story name
   * @param {string} vertical - Story vertical (e.g., 'novel', 'screenplay')
   * @returns {Promise<{id: string, name: string, vertical: string, timestamp: string}>}
   * @throws {ConnectorError} If no current project or story ID cannot be extracted
   */
  async createStory(name, vertical) {
    const projectId = this.getState('current_project_id');
    if (!projectId) {
      throw new ConnectorError(
        'No current project — call createProject first',
        { action: 'create_story', phase: 'interact' }
      );
    }

    // Click new story button
    await this.click(this.getSelector('new_story_button'));

    // Fill story name
    await this.type(this.getSelector('story_name_input'), name);

    // Select vertical
    await this.select(this.getSelector('story_vertical_select'), vertical);

    // Submit
    await this.click(this.getSelector('create_story_submit'));

    // Wait for redirect
    await this.waitForNavigation();

    // Extract story ID from URL
    const storyId = await this._extractIdFromUrl('story_id');
    if (!storyId) {
      throw new ConnectorError(
        'Failed to extract story ID from URL after creation',
        { action: 'create_story', phase: 'interact' }
      );
    }

    // Store in state
    this.setState('current_story_id', storyId);

    return {
      id: storyId,
      name,
      vertical,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create a new session within the current story.
   *
   * @param {string} [type] - Session type (e.g., 'explore', 'develop', 'guide')
   * @returns {Promise<{id: string, type: string|undefined, timestamp: string}>}
   * @throws {ConnectorError} If no current story or session ID cannot be extracted
   */
  async createSession(type) {
    const storyId = this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory first',
        { action: 'create_session', phase: 'interact' }
      );
    }

    // Click new session button
    await this.click(this.getSelector('new_session_button'));

    // Select session type if provided and selector exists
    if (type) {
      const typeSelector = this.getSelector('session_type_select');
      if (typeSelector) {
        await this.select(typeSelector, type);
      }
    }

    // Submit (if there's a separate submit button)
    const submitSelector = this.getSelector('create_session_submit');
    if (submitSelector && await this.exists(submitSelector)) {
      await this.click(submitSelector);
    }

    // Wait for redirect
    await this.waitForNavigation();

    // Extract session ID from URL
    const sessionId = await this._extractIdFromUrl('session_id');
    if (!sessionId) {
      throw new ConnectorError(
        'Failed to extract session ID from URL after creation',
        { action: 'create_session', phase: 'interact' }
      );
    }

    // Store in state
    this.setState('current_session_id', sessionId);

    return {
      id: sessionId,
      type,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Navigate to a specific story.
   *
   * @param {string} storyId - Story UUID
   * @returns {Promise<void>}
   */
  async navigateToStory(storyId) {
    await this.navigate(`/stories/${storyId}`);
    this.setState('current_story_id', storyId);
  }

  // ===================================================================
  // BIBLE GENERATION
  // ===================================================================

  /**
   * Generate a story bible using the specified template.
   *
   * @param {string} [template='standard'] - Template key
   * @returns {Promise<{template: string, content: string, timestamp: string}>}
   * @throws {ConnectorError} If no current story
   */
  async generateStoryBible(template = 'standard') {
    const storyId = this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory or navigateToStory first',
        { action: 'generate_bible', phase: 'interact' }
      );
    }

    // Navigate to bible section
    await this.click(this.getSelector('story_bible_button'));

    // Select template (prefix + template key)
    const templatePrefix = this.getSelector('bible_template_prefix');
    if (templatePrefix) {
      await this.click(`${templatePrefix}${template}"]`);
    }

    // Click generate
    await this.click(this.getSelector('generate_bible_button'));

    // Wait for generation (can take a while)
    const bibleTimeout = this.getTimeout('bible_generation', 120000);
    await this.waitFor(this.getSelector('bible_content'), bibleTimeout);

    // Extract bible content
    const bibleData = await this.extractData(this.getSelector('bible_content'));

    return {
      template,
      content: bibleData ? bibleData.text : '',
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // SESSION SUMMARY
  // ===================================================================

  /**
   * Get a session summary.
   *
   * @param {string} sessionId - Session UUID
   * @returns {Promise<{session_id: string, summary: string, timestamp: string}>}
   */
  async getSessionSummary(sessionId) {
    // Navigate to session
    await this.navigate(`/sessions/${sessionId}`);

    // Click summary button
    await this.click(this.getSelector('session_summary_button'));

    // Wait for summary content to appear
    await this.waitFor(this.getSelector('summary_content'));

    // Extract summary text
    const summaryData = await this.extractData(this.getSelector('summary_content'));

    return {
      session_id: sessionId,
      summary: summaryData ? summaryData.text : '',
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // CITATION EXTRACTION (waitForAIResponse override)
  // ===================================================================

  /**
   * Wait for AI response with citation extraction.
   * Calls super to handle streaming detection and text extraction,
   * then decorates the result with citation data.
   *
   * @param {number} [timeout] - Max wait in ms
   * @returns {Promise<{text, html, timestamp, messageIndex, citations}>}
   */
  async waitForAIResponse(timeout) {
    const response = await super.waitForAIResponse(timeout);

    // Extract citations from the response DOM
    const citations = await this.extractCitations();

    return {
      ...response,
      citations
    };
  }

  /**
   * Extract citation references from the page.
   * Returns empty array if no citations found or extraction fails.
   * Never throws — citations are supplementary evidence.
   *
   * @returns {Promise<Array<{id: string, text: string}>>}
   */
  async extractCitations() {
    const citationSelector = this.getSelector('citation_element');
    if (!citationSelector) {
      return [];
    }

    try {
      const elements = await this.page.$$(citationSelector);

      return await Promise.all(
        elements.map(async el => ({
          id: await el.getAttribute('data-citation-id'),
          text: await el.textContent()
        }))
      );
    } catch (error) {
      // Citations are supplementary — don't fail the test
      return [];
    }
  }

  // ===================================================================
  // HELPERS
  // ===================================================================

  /**
   * Extract an entity ID from the current URL using a configured pattern.
   *
   * @param {string} patternKey - Key in config.url_patterns (e.g., 'project_id')
   * @returns {Promise<string|null>} Extracted ID or null if not matched
   */
  async _extractIdFromUrl(patternKey) {
    const pattern = this.app.config?.url_patterns?.[patternKey];
    if (!pattern) {
      // Fallback: try generic UUID pattern
      const url = await this.getCurrentURL();
      const match = url.match(/([a-f0-9-]{36}|[a-f0-9]{8,})/);
      return match ? match[1] : null;
    }

    const url = await this.getCurrentURL();
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const match = url.match(regex);
    return match ? match[1] : null;
  }
}

module.exports = BrainstormyConnector;
```

---

## 8. ConnectorFactory Implementation

```javascript
// connectors/factory.js

'use strict';

const GenericWebAppConnector = require('./generic-web-app/connector');
const AIAppConnector = require('./ai-chat-app/connector');
const BrainstormyConnector = require('./brainstormy/connector');
const { ConnectorError } = require('./errors');

/**
 * Factory for instantiating the correct connector class from app configuration.
 *
 * Agents use ConnectorFactory.create() instead of importing connector classes
 * directly. This keeps agents app-agnostic.
 *
 * The connector type is determined by app.connector.type in the app config.
 * New connectors are registered by adding them to the CONNECTOR_REGISTRY.
 *
 * @example
 * const connector = await ConnectorFactory.create(appConfig, page, evidenceCollector);
 * // connector is now an initialized instance of the correct connector class
 * await connector.performAction('send_message', { text: 'Hello' });
 * await connector.cleanup();
 */
class ConnectorFactory {

  /**
   * Registry of connector type strings → connector classes.
   * Add new connectors here.
   */
  static CONNECTOR_REGISTRY = {
    'generic': GenericWebAppConnector,
    'ai-chat-app': AIAppConnector,
    'brainstormy': BrainstormyConnector
  };

  /**
   * Create and initialize a connector for the given app.
   *
   * @param {object} app - App configuration (includes connector.type)
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {object} evidenceCollector - Evidence collection service
   * @param {object} [options]
   * @param {boolean} [options.skipInitialize=false] - Skip calling initialize() (for testing)
   * @returns {Promise<BaseConnector>} Initialized connector instance
   * @throws {ConnectorError} If connector type is unknown
   */
  static async create(app, page, evidenceCollector, { skipInitialize = false } = {}) {
    const connectorType = app.connector?.type;

    if (!connectorType) {
      throw new ConnectorError(
        'App configuration missing connector.type',
        { phase: 'initialize' }
      );
    }

    const ConnectorClass = ConnectorFactory.CONNECTOR_REGISTRY[connectorType];

    if (!ConnectorClass) {
      throw new ConnectorError(
        `Unknown connector type: "${connectorType}". Available: ${Object.keys(ConnectorFactory.CONNECTOR_REGISTRY).join(', ')}`,
        { phase: 'initialize' }
      );
    }

    const connector = new ConnectorClass(app, page, evidenceCollector);

    if (!skipInitialize) {
      await connector.initialize();
    }

    return connector;
  }

  /**
   * Register a new connector class.
   * Used by plugins or app-specific connectors added at runtime.
   *
   * @param {string} type - Connector type string
   * @param {typeof BaseConnector} ConnectorClass - Connector class (must extend BaseConnector)
   */
  static register(type, ConnectorClass) {
    ConnectorFactory.CONNECTOR_REGISTRY[type] = ConnectorClass;
  }

  /**
   * Get list of registered connector types.
   *
   * @returns {string[]}
   */
  static getRegisteredTypes() {
    return Object.keys(ConnectorFactory.CONNECTOR_REGISTRY);
  }
}

module.exports = ConnectorFactory;
```

---

## 9. Unit Test Specification

### BrainstormyConnector Tests

```javascript
// tests/connectors/brainstormy-connector.test.js — Test outline

describe('BrainstormyConnector', () => {

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly');
    test('inherits from AIAppConnector');
    test('inherits from GenericWebAppConnector');
    test('inherits from BaseConnector');
  });

  describe('performAction() — Brainstormy action dispatch', () => {
    test('dispatches create_project to createProject()');
    test('dispatches create_story to createStory()');
    test('dispatches create_session to createSession()');
    test('dispatches navigate_to_story to navigateToStory()');
    test('dispatches generate_bible to generateStoryBible()');
    test('dispatches get_session_summary to getSessionSummary()');
    test('delegates send_message to super (AIAppConnector)');
    test('delegates click to super (GenericWebAppConnector)');
    test('delegates unknown action to super chain');
    test('captures before evidence for Brainstormy actions');
    test('captures after evidence on success');
    test('captures failure evidence on error');
  });

  describe('createProject()', () => {
    test('navigates to /projects');
    test('clicks new_project_button selector');
    test('types name into project_name_input selector');
    test('clicks create_project_submit selector');
    test('waits for navigation after submit');
    test('extracts project ID from URL');
    test('stores current_project_id in state');
    test('returns id, name, and timestamp');
    test('throws ConnectorError when ID cannot be extracted');
  });

  describe('createStory()', () => {
    test('requires current_project_id in state');
    test('throws ConnectorError when no current project');
    test('clicks new_story_button selector');
    test('types name into story_name_input selector');
    test('selects vertical in story_vertical_select');
    test('clicks create_story_submit selector');
    test('extracts story ID from URL');
    test('stores current_story_id in state');
    test('returns id, name, vertical, and timestamp');
  });

  describe('createSession()', () => {
    test('requires current_story_id in state');
    test('throws ConnectorError when no current story');
    test('clicks new_session_button selector');
    test('selects type when provided and selector exists');
    test('skips type selection when not provided');
    test('clicks create_session_submit when it exists');
    test('skips submit click when button not in DOM');
    test('extracts session ID from URL');
    test('stores current_session_id in state');
    test('returns id, type, and timestamp');
  });

  describe('navigateToStory()', () => {
    test('navigates to /stories/{storyId}');
    test('stores storyId in current_story_id state');
  });

  describe('generateStoryBible()', () => {
    test('requires current_story_id in state');
    test('throws ConnectorError when no current story');
    test('clicks story_bible_button selector');
    test('clicks template selector using prefix + template key');
    test('clicks generate_bible_button selector');
    test('waits for bible_content with bible_generation timeout');
    test('extracts content text from bible_content element');
    test('defaults to "standard" template');
    test('returns template, content, and timestamp');
    test('returns empty content when extractData returns null');
  });

  describe('getSessionSummary()', () => {
    test('navigates to /sessions/{sessionId}');
    test('clicks session_summary_button selector');
    test('waits for summary_content element');
    test('extracts summary text');
    test('returns session_id, summary, and timestamp');
    test('returns empty summary when extractData returns null');
  });

  describe('waitForAIResponse() — override', () => {
    test('calls super.waitForAIResponse()');
    test('extracts citations after getting response');
    test('returns response with citations array appended');
    test('returns empty citations when no citation elements found');
    test('returns empty citations when extraction fails');
  });

  describe('extractCitations()', () => {
    test('queries elements matching citation_element selector');
    test('extracts id from data-citation-id attribute');
    test('extracts text via textContent');
    test('returns array of {id, text} objects');
    test('returns empty array when no citation selector configured');
    test('returns empty array when no citation elements found');
    test('returns empty array on error (never throws)');
  });

  describe('_extractIdFromUrl()', () => {
    test('uses url_patterns from config when available');
    test('falls back to generic UUID pattern when no config');
    test('returns null when pattern does not match');
    test('handles RegExp patterns');
    test('handles string patterns (converted to RegExp)');
  });

  describe('Inherited behavior (smoke tests)', () => {
    test('sendMessage works through AIAppConnector');
    test('validateMemory works through AIAppConnector');
    test('click/type work through GenericWebAppConnector');
    test('evidence collection delegates to EvidenceCollector');
    test('getSelector reads from app config');
  });
});
```

### ConnectorFactory Tests

```javascript
// tests/connectors/connector-factory.test.js — Test outline

describe('ConnectorFactory', () => {

  describe('create()', () => {
    test('creates GenericWebAppConnector for type "generic"');
    test('creates AIAppConnector for type "ai-chat-app"');
    test('creates BrainstormyConnector for type "brainstormy"');
    test('calls initialize() on created connector');
    test('skips initialize() when skipInitialize is true');
    test('throws ConnectorError when connector.type is missing');
    test('throws ConnectorError for unknown connector type');
    test('error message lists available connector types');
    test('passes app, page, and evidenceCollector to constructor');
  });

  describe('register()', () => {
    test('adds new connector type to registry');
    test('create() can instantiate registered type');
    test('can override existing type');
  });

  describe('getRegisteredTypes()', () => {
    test('returns array of registered type strings');
    test('includes all default types');
    test('includes dynamically registered types');
  });
});
```

---

## 10. Mock Requirements

### Mock Element with getAttribute and textContent

For citation extraction tests, mock elements need `getAttribute()` and `textContent()` (Playwright ElementHandle methods, not the `evaluate` pattern):

```javascript
function createMockCitationElement(id, text) {
  return {
    getAttribute: jest.fn().mockResolvedValue(id),
    textContent: jest.fn().mockResolvedValue(text),
    evaluate: jest.fn().mockImplementation(fn =>
      Promise.resolve(fn({ textContent: text, value: '', innerHTML: text, attributes: [] }))
    )
  };
}
```

### Mock App Config for Brainstormy

Extend `createMockAppConfig` with Brainstormy-specific selectors and url_patterns:

```javascript
function createBrainstormyAppConfig(overrides = {}) {
  return createMockAppConfig({
    app_id: 'brainstormy',
    name: 'Brainstormy',
    connector: { type: 'brainstormy', base: 'ai-chat-app' },
    config: {
      auth_indicator: '[data-testid="user-menu"]',
      ready_indicator: '[data-testid="app-loaded"]',
      selectors: {
        // Login (from GenericWebAppConnector config)
        login_email: '[name="email"]',
        login_password: '[name="password"]',
        login_submit: '[type="submit"]',
        logout: '[data-testid="logout-button"]',

        // Chat (from AIAppConnector config)
        chat_input: '[data-testid="chat-input"]',
        chat_send: '[data-testid="send-button"]',
        ai_message: '[data-testid="ai-message"]',
        generating_indicator: '[data-testid="generating"]',

        // Brainstormy-specific
        new_project_button: '[data-testid="new-project-button"]',
        project_name_input: '[data-testid="project-name-input"]',
        create_project_submit: '[data-testid="create-project-button"]',
        new_story_button: '[data-testid="new-story-button"]',
        story_name_input: '[data-testid="story-name-input"]',
        story_vertical_select: '[data-testid="story-vertical-select"]',
        create_story_submit: '[data-testid="create-story-button"]',
        new_session_button: '[data-testid="new-session-button"]',
        session_type_select: '[data-testid="session-type-select"]',
        create_session_submit: '[data-testid="create-session-button"]',
        story_bible_button: '[data-testid="story-bible-button"]',
        bible_template_prefix: '[data-testid="template-',
        generate_bible_button: '[data-testid="generate-bible-button"]',
        bible_content: '[data-testid="bible-content"]',
        session_summary_button: '[data-testid="session-summary-button"]',
        summary_content: '[data-testid="summary-content"]',
        citation_element: '[data-citation-id]'
      },
      url_patterns: {
        project_id: 'projects\\/([a-zA-Z0-9-]+)',
        story_id: 'stories\\/([a-zA-Z0-9-]+)',
        session_id: 'sessions\\/([a-zA-Z0-9-]+)'
      },
      timeouts: {
        ai_response: 60000,
        bible_generation: 120000,
        navigation: 30000
      }
    },
    ...overrides
  });
}
```

---

## 11. Implementation Order for Claude Code

### Step 1: Extend Mock Helpers

| Task | Details |
|------|---------|
| Add `createMockCitationElement` | Factory for elements with `getAttribute()` and `textContent()` methods. |
| Add `createBrainstormyAppConfig` | Full Brainstormy app config factory extending `createMockAppConfig`. |

### Step 2: Implementation

| # | File | Purpose |
|---|------|---------|
| 1 | `connectors/brainstormy/connector.js` | Full BrainstormyConnector from Section 7. Create `connectors/brainstormy/` directory. |
| 2 | `connectors/factory.js` | ConnectorFactory from Section 8. |
| 3 | `tests/connectors/brainstormy-connector.test.js` | BrainstormyConnector tests from Section 9. |
| 4 | `tests/connectors/connector-factory.test.js` | ConnectorFactory tests from Section 9. |

### Step 3: Validation

```bash
# Run all tests
npm test

# Verify full inheritance chain
node -e "
  const BrainstormyConnector = require('./connectors/brainstormy/connector');
  const AIAppConnector = require('./connectors/ai-chat-app/connector');
  const GenericWebAppConnector = require('./connectors/generic-web-app/connector');
  const BaseConnector = require('./connectors/base-connector');
  const c = new BrainstormyConnector({ config: {} }, {}, {});
  console.log('→ AIAppConnector:', c instanceof AIAppConnector);
  console.log('→ GenericWebAppConnector:', c instanceof GenericWebAppConnector);
  console.log('→ BaseConnector:', c instanceof BaseConnector);
  console.log('Has createProject:', typeof c.createProject === 'function');
  console.log('Has sendMessage:', typeof c.sendMessage === 'function');
  console.log('Has click:', typeof c.click === 'function');
"

# Verify ConnectorFactory
node -e "
  const factory = require('./connectors/factory');
  console.log('Types:', factory.getRegisteredTypes());
"

# Verify all test suites pass together
npm test 2>&1 | tail -5
```

---

## 12. Claude Code Implementation Notes

1. **No new dependencies.** BrainstormyConnector imports from `../ai-chat-app/connector` and `../errors`. ConnectorFactory imports the three connector classes and errors. No npm packages.

2. **`bible_template_prefix` produces a partial selector.** The config stores `'[data-testid="template-'` (note: no closing bracket). The method appends `template + '"]'` to complete it: `[data-testid="template-standard"]`. This is a deliberate pattern — the implementer must verify the string concatenation produces valid CSS selectors. Tests should verify with a mock `click` call.

3. **`_extractIdFromUrl` handles both RegExp and string patterns.** Config loaded from JSON files will have string patterns (JSON doesn't support RegExp). The method converts strings to RegExp with `new RegExp(pattern)`. Config created in JavaScript can use native RegExp. Tests should cover both.

4. **`createSession` has conditional submit.** Some UIs auto-submit when a type is selected (no separate submit button). The method checks `exists(create_session_submit)` before clicking. This is the only method with this conditional pattern.

5. **`extractCitations` uses `el.getAttribute()` and `el.textContent()`.** These are Playwright ElementHandle methods, NOT the `el.evaluate(fn)` pattern used in `extractData`. The difference: `getAttribute/textContent` are direct ElementHandle methods that return Promises; `evaluate` runs arbitrary JS in the browser context. Both work, but `getAttribute/textContent` are simpler for single-property extraction.

6. **ConnectorFactory.CONNECTOR_REGISTRY is a static class field.** This requires Node.js 12+ (which we're already targeting). It's mutable — `register()` can add entries. Tests that use `register()` should clean up after themselves to avoid polluting other tests.

7. **ConnectorFactory.create() with `skipInitialize`** is essential for unit testing. Tests create connectors without a real Playwright page, so `initialize()` would fail. The option lets tests instantiate connectors for method-level testing.

8. **The Brainstormy app config JSON file** (for real usage, not tests) should live at `config/apps/brainstormy.json` but is NOT created in this sprint. The mock config factory serves all testing needs. The real config file will be created when the staging environment is ready.

---

## 13. What Comes Next

With BrainstormyConnector + ConnectorFactory, **Week 1 is complete**:

- ✅ BaseConnector (abstract contract)
- ✅ EvidenceCollector (never-fail evidence capture)
- ✅ GenericWebAppConnector (Playwright interactions + evidence wrapping)
- ✅ AIAppConnector (chat-specific actions)
- ✅ BrainstormyConnector (Brainstormy domain actions)
- ✅ ConnectorFactory (instantiation from config)

**Week 2** begins the agent layer:

- Days 1-2: BaseAgent + HealerAgent (smoke tests, regression detection)
- Days 3-4: SentinelAgent (data persistence, memory validation) + LibrarianAgent (citation accuracy)
- Day 5: Test Orchestrator (runs agents in sequence, aggregates results)

Agents use `ConnectorFactory.create()` to get a connector and interact through `performAction()` — they never know which app they're testing.
