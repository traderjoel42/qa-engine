# QA Engine: Base Connector Implementation Specification

**Phase:** 1, Week 1, Days 1-2  
**Purpose:** Implementation-ready spec for `connectors/base-connector.js`  
**For:** Claude Code implementation  
**References:** qa-engine-03-connector-pattern-spec.md, qa-engine-05-implementation-plan.md  
**Revision:** v1.1 — Post-feasibility review. Applied: `ConnectorTimeoutError` rename, relaxed Playwright rule, `hasState()` inventory fix, `executeAction` pattern clarification, infrastructure setup steps.

---

## 1. Design Decisions

### Why an Abstract Base Class (Not an Interface)

JavaScript doesn't have true interfaces, so BaseConnector serves dual purpose:

1. **Contract definition** — Abstract methods that throw `Must implement X()` errors enforce the interface at runtime
2. **Shared implementation** — State management, evidence collection wrappers, and the `performAction` dispatch pattern are implemented once and inherited

### Inheritance Hierarchy

```
BaseConnector (abstract — this file)
  └── GenericWebAppConnector (Playwright implementations of all abstract methods)
        └── AIAppConnector (adds chat, memory, AI-response methods)
              └── BrainstormyConnector (app-specific actions + selectors)
```

**Rule:** BaseConnector does not perform DOM interactions via Playwright. Metadata accessors (e.g., `getCurrentURL()` calling `page.url()`) are permitted in the base class. All DOM manipulation, element queries, and page navigation happen in GenericWebAppConnector.

### Constructor Dependencies

```javascript
constructor(app, page, evidenceCollector)
```

| Param | Type | Source | Purpose |
|-------|------|--------|---------|
| `app` | Object | App config JSON (e.g., `apps/brainstormy/config.json`) | Selectors, URLs, auth config, timeouts |
| `page` | Playwright Page | Created by Test Orchestrator via `browser.newPage()` | All DOM interactions |
| `evidenceCollector` | EvidenceCollector | `core/engine/evidence-collector.js` | Screenshots, logs, network captures |

---

## 2. Complete Method Inventory

Methods are organized by category. Each is marked as **ABSTRACT** (must override), **IMPLEMENTED** (shared logic, inherit as-is), or **HOOK** (optional override).

### 2.1 Lifecycle Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `initialize()` | ABSTRACT | `async initialize() → void` | Navigate to app, authenticate, verify ready state. Called once before test execution. |
| `cleanup()` | ABSTRACT | `async cleanup() → void` | Logout, clear state, release resources. Called after test execution completes or on error. |
| `healthCheck()` | HOOK | `async healthCheck() → { healthy: boolean, details: object }` | Verify connector can still interact with app. Default returns `{ healthy: true }`. Subclasses override for app-specific checks (e.g., session still valid, no error modals). |

### 2.2 Authentication Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `authenticate()` | ABSTRACT | `async authenticate() → boolean` | Log into the application. Returns true on success. |
| `logout()` | ABSTRACT | `async logout() → void` | Log out of the application. |
| `isAuthenticated()` | ABSTRACT | `async isAuthenticated() → boolean` | Check current auth state (e.g., presence of user menu element). |

### 2.3 Navigation Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `navigate(path)` | ABSTRACT | `async navigate(path: string) → void` | Navigate to relative or absolute path within the app. |
| `waitForNavigation(timeout)` | ABSTRACT | `async waitForNavigation(timeout?: number) → void` | Wait for page load to complete. Default timeout: 30000ms. |
| `getCurrentURL()` | IMPLEMENTED | `async getCurrentURL() → string` | Returns `this.page.url()`. No override needed. |

### 2.4 Interaction Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `performAction(action, params)` | ABSTRACT | `async performAction(action: string, params?: object) → object` | **Primary agent entry point.** Dispatches named actions to specific methods. Every subclass extends this with a `switch` statement + `super.performAction()` fallback. |
| `click(selector)` | ABSTRACT | `async click(selector: string) → void` | Click an element. |
| `type(selector, text)` | ABSTRACT | `async type(selector: string, text: string) → void` | Type text into an input field. |
| `select(selector, value)` | ABSTRACT | `async select(selector: string, value: string) → void` | Select dropdown option. |
| `waitFor(selector, timeout)` | ABSTRACT | `async waitFor(selector: string, timeout?: number) → void` | Wait for element to appear. Default timeout: 30000ms. |

### 2.5 Data Extraction Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `extractData(selector)` | ABSTRACT | `async extractData(selector: string) → any` | Extract text/data from a single element. |
| `extractMultiple(selector)` | ABSTRACT | `async extractMultiple(selector: string) → array` | Extract data from multiple matching elements. |
| `exists(selector)` | ABSTRACT | `async exists(selector: string) → boolean` | Check if element exists in DOM. |

### 2.6 Evidence Collection Methods

These are **IMPLEMENTED** in BaseConnector — they delegate to the `evidenceCollector` dependency. Subclasses inherit them directly.

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `takeScreenshot(name)` | IMPLEMENTED | `async takeScreenshot(name: string) → string` | Delegates to `this.evidence.captureScreenshot(this.page, name)`. Returns screenshot path. |
| `getLogs()` | IMPLEMENTED | `async getLogs() → array` | Delegates to `this.evidence.getConsoleLogs()`. |
| `getNetworkRequests()` | IMPLEMENTED | `async getNetworkRequests() → array` | Delegates to `this.evidence.getNetworkRequests()`. |
| `collectEvidence(stepName)` | IMPLEMENTED | `async collectEvidence(stepName: string) → object` | Delegates to `this.evidence.collectAll(this.page, stepName)`. Returns complete evidence package (screenshot + logs + network + timestamp). |

### 2.7 State Management Methods

These are **IMPLEMENTED** in BaseConnector using an internal `Map`. All subclasses inherit them.

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `setState(key, value)` | IMPLEMENTED | `setState(key: string, value: any) → void` | Store key-value pair. |
| `getState(key)` | IMPLEMENTED | `getState(key: string) → any` | Retrieve value. Returns `undefined` if not set. |
| `hasState(key)` | IMPLEMENTED | `hasState(key: string) → boolean` | Check if a state key exists. |
| `clearState()` | IMPLEMENTED | `clearState() → void` | Clear all state. Called during cleanup. |

### 2.8 Configuration Helper Methods

These are **IMPLEMENTED** convenience methods for accessing app config.

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `getSelector(key)` | IMPLEMENTED | `getSelector(key: string) → string\|undefined` | Returns `this.app.config.selectors?.[key]`. Configuration-driven selector lookup. |
| `getTimeout(key)` | IMPLEMENTED | `getTimeout(key: string, defaultMs?: number) → number` | Returns `this.app.config.timeouts?.[key] ?? defaultMs ?? 30000`. |
| `getBaseURL()` | IMPLEMENTED | `getBaseURL() → string` | Returns `this.app.environments[this.app.activeEnvironment ?? 'staging'].url`. |

---

## 3. Error Handling Strategy

### 3.1 Error Types

Define a custom error hierarchy for clear error classification:

```javascript
class ConnectorError extends Error {
  constructor(message, { action, selector, phase, recoverable = false, evidence = null } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.action = action;       // What was being attempted
    this.selector = selector;   // Which element (if applicable)
    this.phase = phase;         // 'initialize' | 'authenticate' | 'navigate' | 'interact' | 'cleanup'
    this.recoverable = recoverable;
    this.evidence = evidence;   // Evidence package captured at failure
    this.timestamp = new Date().toISOString();
  }
}

class AuthenticationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'authenticate', recoverable: false });
    this.name = 'AuthenticationError';
  }
}

class NavigationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'navigate', recoverable: true });
    this.name = 'NavigationError';
  }
}

class ElementNotFoundError extends ConnectorError {
  constructor(selector, details = {}) {
    super(`Element not found: ${selector}`, { ...details, selector, phase: 'interact', recoverable: true });
    this.name = 'ElementNotFoundError';
  }
}

class ConnectorTimeoutError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, recoverable: true });
    this.name = 'ConnectorTimeoutError';
  }
}
```

> **Why `ConnectorTimeoutError` instead of `TimeoutError`?** Playwright exports its own `TimeoutError`. When GenericWebAppConnector catches Playwright timeouts to wrap them, having identically-named classes in the same catch block creates ambiguity. The `Connector` prefix disambiguates at the call site.

### 3.2 Error Handling Rules

1. **Always collect evidence before throwing.** Every catch block should call `collectEvidence()` and attach the result to the error.

2. **Never swallow errors silently.** If a method catches an error internally (e.g., for retry logic), it must either re-throw or log the suppression.

3. **Classify errors as recoverable vs. fatal:**
   - **Recoverable:** Element not found, timeout, navigation failure → agent can retry or skip
   - **Fatal:** Authentication failure, app crash, connector misconfiguration → test run aborts

4. **Cleanup must be fault-tolerant.** `cleanup()` should wrap each step in try/catch so a logout failure doesn't prevent state clearing.

### 3.3 Evidence-on-Error Pattern

This is a **critical pattern** that subclasses must follow in every interaction method:

```javascript
// Pattern for GenericWebAppConnector (and descendants) to follow
async click(selector) {
  try {
    await this.page.click(selector, { timeout: this.getTimeout('interaction', 10000) });
  } catch (error) {
    const evidence = await this.collectEvidence(`click_failed_${selector}`);
    throw new ElementNotFoundError(selector, {
      action: 'click',
      evidence
    });
  }
}
```

---

## 4. State Management Design

### 4.1 What Goes in State

State tracks **runtime context** that accumulates during test execution:

| Key Pattern | Example | Purpose |
|-------------|---------|---------|
| `authenticated` | `true` | Track auth status |
| `currentPage` | `'dashboard'` | Track logical location |
| `messages` | `[{role, content, timestamp}]` | Chat history (AIAppConnector) |
| `createdEntities` | `[{type: 'story', id: '123', name: 'Test'}]` | Track entities for cleanup |
| `lastResponse` | `{text, citations, timestamp}` | Most recent AI response |
| `sessionId` | `'abc-123'` | Current active session |

### 4.2 State Lifecycle

```
initialize()     → state is empty
authenticate()   → setState('authenticated', true)
performAction()  → setState('createdEntities', [...])  // accumulates
cleanup()        → clearState()                         // resets everything
```

### 4.3 Design Rules

- State is **ephemeral** — lives only for one test run, cleared on cleanup
- State is **not persisted** to database (that's the evidence collector's job)
- Subclasses should document which state keys they set in JSDoc
- `getState()` returns `undefined` for unset keys — callers must handle this

---

## 5. Evidence Collection Integration

### 5.1 When Evidence Is Collected

Evidence collection is **automatic** around every `performAction` call. This wrapping lives in GenericWebAppConnector (not BaseConnector), since BaseConnector's `performAction` only serves as the unrecognized-action fallback.

```javascript
// This pattern lives in GenericWebAppConnector.performAction()
async performAction(action, params = {}) {
  const stepId = `${action}_${Date.now()}`;
  
  // Before evidence
  await this.collectEvidence(`before_${stepId}`);
  
  let result;
  try {
    // Dispatch to the appropriate method via switch statement
    switch (action) {
      case 'click':
        result = await this.click(params.selector);
        break;
      case 'type':
        result = await this.type(params.selector, params.text);
        break;
      // ... more actions
      default:
        // Chains up the hierarchy — BaseConnector throws "unsupported action"
        result = await super.performAction(action, params);
    }
  } catch (error) {
    // Failure evidence
    await this.collectEvidence(`failed_${stepId}`);
    throw error;
  }
  
  // After evidence
  await this.collectEvidence(`after_${stepId}`);
  
  return result;
}
```

### 5.2 Evidence Package Structure

Each `collectEvidence()` call produces:

```javascript
{
  stepName: 'before_click_1707600000000',
  timestamp: '2026-02-11T10:00:00.000Z',
  screenshot: '/evidence/run-123/before_click_1707600000000.png',
  consoleLogs: [
    { level: 'error', message: 'Failed to fetch /api/stories', timestamp: '...' }
  ],
  networkRequests: [
    { url: '/api/stories', method: 'GET', status: 500, duration: 234 }
  ],
  url: 'https://staging.brainstormy.app/dashboard',
  pageTitle: 'Brainstormy - Dashboard'
}
```

### 5.3 Evidence Collector Interface

BaseConnector expects the `evidenceCollector` to implement:

```javascript
// Required interface for evidenceCollector dependency
{
  captureScreenshot(page, name) → Promise<string>,  // returns file path
  getConsoleLogs() → Promise<array>,
  getNetworkRequests() → Promise<array>,
  collectAll(page, stepName) → Promise<object>       // returns full package above
}
```

This interface will be implemented in `core/engine/evidence-collector.js` (also a Week 1 deliverable).

---

## 6. Complete BaseConnector Implementation

```javascript
// connectors/base-connector.js

'use strict';

const {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
} = require('./errors');

/**
 * Abstract base class for all QA Engine connectors.
 * 
 * Defines the contract that agents rely on for app-agnostic testing.
 * Subclasses MUST implement all methods marked "Must implement X()".
 * 
 * Inheritance chain:
 *   BaseConnector → GenericWebAppConnector → AIAppConnector → [App]Connector
 * 
 * @abstract
 */
class BaseConnector {
  /**
   * @param {object} app - App configuration (selectors, URLs, auth, timeouts)
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {object} evidenceCollector - Evidence collection service
   */
  constructor(app, page, evidenceCollector) {
    if (new.target === BaseConnector) {
      throw new Error('BaseConnector is abstract and cannot be instantiated directly');
    }
    
    this.app = app;
    this.page = page;
    this.evidence = evidenceCollector;
    this.state = new Map();
    this._initialized = false;
    this._cleanedUp = false;
  }

  // ===================================================================
  // LIFECYCLE — Abstract (must override)
  // ===================================================================

  /**
   * Initialize the connector. Called once before test execution.
   * Implementations should: navigate to app, authenticate, verify ready state.
   * Must set this._initialized = true on success.
   * 
   * @abstract
   * @returns {Promise<void>}
   * @throws {ConnectorError} If initialization fails
   */
  async initialize() {
    throw new ConnectorError('Must implement initialize()', { phase: 'initialize' });
  }

  /**
   * Cleanup after tests complete.
   * Implementations should: logout, clear state, release resources.
   * Must be fault-tolerant — individual cleanup step failures should not
   * prevent remaining steps from executing.
   * Must set this._cleanedUp = true on completion.
   * 
   * @abstract
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new ConnectorError('Must implement cleanup()', { phase: 'cleanup' });
  }

  /**
   * Verify the connector can still interact with the app.
   * Override in subclasses for app-specific checks (session valid, no error modals, etc.)
   * 
   * @returns {Promise<{healthy: boolean, details: object}>}
   */
  async healthCheck() {
    return {
      healthy: this._initialized && !this._cleanedUp,
      details: {
        initialized: this._initialized,
        cleanedUp: this._cleanedUp,
        stateSize: this.state.size,
        url: await this.getCurrentURL()
      }
    };
  }

  // ===================================================================
  // AUTHENTICATION — Abstract (must override)
  // ===================================================================

  /**
   * Authenticate with the application.
   * @abstract
   * @returns {Promise<boolean>} True if authentication succeeded
   * @throws {AuthenticationError} If authentication fails irrecoverably
   */
  async authenticate() {
    throw new AuthenticationError('Must implement authenticate()');
  }

  /**
   * Log out of the application.
   * @abstract
   * @returns {Promise<void>}
   */
  async logout() {
    throw new ConnectorError('Must implement logout()', { phase: 'cleanup' });
  }

  /**
   * Check if currently authenticated.
   * @abstract
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    throw new ConnectorError('Must implement isAuthenticated()');
  }

  // ===================================================================
  // NAVIGATION — Abstract (must override, except getCurrentURL)
  // ===================================================================

  /**
   * Navigate to a path within the app.
   * @abstract
   * @param {string} path - Relative or absolute path
   * @returns {Promise<void>}
   * @throws {NavigationError} If navigation fails
   */
  async navigate(path) {
    throw new NavigationError('Must implement navigate()');
  }

  /**
   * Wait for navigation/page load to complete.
   * @abstract
   * @param {number} [timeout=30000] - Maximum wait time in ms
   * @returns {Promise<void>}
   * @throws {ConnectorTimeoutError} If navigation doesn't complete within timeout
   */
  async waitForNavigation(timeout = 30000) {
    throw new ConnectorTimeoutError('Must implement waitForNavigation()');
  }

  /**
   * Get current page URL. Implemented — no override needed.
   * @returns {Promise<string>}
   */
  async getCurrentURL() {
    return this.page.url();
  }

  // ===================================================================
  // INTERACTIONS — Abstract (must override)
  // ===================================================================

  /**
   * Perform a named action on the app.
   * This is the PRIMARY ENTRY POINT for agent interactions.
   * 
   * Subclasses implement this with a switch statement for supported actions,
   * calling super.performAction() for unrecognized actions (which chains up
   * the inheritance hierarchy).
   * 
   * @abstract
   * @param {string} action - Action type (e.g., 'click', 'type', 'create_entity')
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<object>} Action result
   * @throws {ConnectorError} If action is not supported or fails
   */
  async performAction(action, params = {}) {
    throw new ConnectorError(`Action "${action}" is not supported by this connector`, {
      action,
      phase: 'interact'
    });
  }

  /**
   * Click an element.
   * @abstract
   * @param {string} selector - CSS selector
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError}
   */
  async click(selector) {
    throw new ElementNotFoundError(selector, { action: 'click' });
  }

  /**
   * Type text into an input.
   * @abstract
   * @param {string} selector - CSS selector for input
   * @param {string} text - Text to type
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError}
   */
  async type(selector, text) {
    throw new ElementNotFoundError(selector, { action: 'type' });
  }

  /**
   * Select an option from a dropdown.
   * @abstract
   * @param {string} selector - CSS selector for select element
   * @param {string} value - Option value to select
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError}
   */
  async select(selector, value) {
    throw new ElementNotFoundError(selector, { action: 'select' });
  }

  /**
   * Wait for an element to appear in the DOM.
   * @abstract
   * @param {string} selector - CSS selector
   * @param {number} [timeout=30000] - Maximum wait time in ms
   * @returns {Promise<void>}
   * @throws {ConnectorTimeoutError}
   */
  async waitFor(selector, timeout = 30000) {
    throw new ConnectorTimeoutError(`Must implement waitFor() — waiting for: ${selector}`);
  }

  // ===================================================================
  // DATA EXTRACTION — Abstract (must override)
  // ===================================================================

  /**
   * Extract text/data from a single element.
   * @abstract
   * @param {string} selector - CSS selector
   * @returns {Promise<any>} Extracted data
   * @throws {ElementNotFoundError}
   */
  async extractData(selector) {
    throw new ElementNotFoundError(selector, { action: 'extractData' });
  }

  /**
   * Extract data from multiple matching elements.
   * @abstract
   * @param {string} selector - CSS selector matching multiple elements
   * @returns {Promise<Array>} Array of extracted data
   */
  async extractMultiple(selector) {
    throw new ConnectorError('Must implement extractMultiple()');
  }

  /**
   * Check if an element exists in the DOM.
   * @abstract
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>}
   */
  async exists(selector) {
    throw new ConnectorError('Must implement exists()');
  }

  // ===================================================================
  // EVIDENCE COLLECTION — Implemented (inherit as-is)
  // ===================================================================

  /**
   * Capture a screenshot of the current page.
   * @param {string} name - Descriptive name for the screenshot
   * @returns {Promise<string>} File path to saved screenshot
   */
  async takeScreenshot(name) {
    return await this.evidence.captureScreenshot(this.page, name);
  }

  /**
   * Get captured console logs.
   * @returns {Promise<Array<{level: string, message: string, timestamp: string}>>}
   */
  async getLogs() {
    return await this.evidence.getConsoleLogs();
  }

  /**
   * Get captured network requests.
   * @returns {Promise<Array<{url: string, method: string, status: number, duration: number}>>}
   */
  async getNetworkRequests() {
    return await this.evidence.getNetworkRequests();
  }

  /**
   * Collect complete evidence package (screenshot + logs + network + metadata).
   * @param {string} stepName - Descriptive name for this evidence capture point
   * @returns {Promise<object>} Complete evidence package
   */
  async collectEvidence(stepName) {
    return await this.evidence.collectAll(this.page, stepName);
  }

  // ===================================================================
  // STATE MANAGEMENT — Implemented (inherit as-is)
  // ===================================================================

  /**
   * Save a value to connector state.
   * State is ephemeral — cleared on cleanup, not persisted to database.
   * @param {string} key - State key
   * @param {any} value - State value
   */
  setState(key, value) {
    this.state.set(key, value);
  }

  /**
   * Retrieve a value from connector state.
   * @param {string} key - State key
   * @returns {any} Value, or undefined if not set
   */
  getState(key) {
    return this.state.get(key);
  }

  /**
   * Check if a state key exists.
   * @param {string} key - State key
   * @returns {boolean}
   */
  hasState(key) {
    return this.state.has(key);
  }

  /**
   * Clear all connector state.
   */
  clearState() {
    this.state.clear();
  }

  // ===================================================================
  // CONFIGURATION HELPERS — Implemented (inherit as-is)
  // ===================================================================

  /**
   * Look up a CSS selector from app configuration.
   * @param {string} key - Selector key (e.g., 'login_email', 'chat_input')
   * @returns {string|undefined} CSS selector string, or undefined if not configured
   */
  getSelector(key) {
    return this.app.config?.selectors?.[key];
  }

  /**
   * Look up a timeout value from app configuration.
   * @param {string} key - Timeout key (e.g., 'ai_response', 'navigation')
   * @param {number} [defaultMs=30000] - Default timeout if not configured
   * @returns {number} Timeout in milliseconds
   */
  getTimeout(key, defaultMs = 30000) {
    return this.app.config?.timeouts?.[key] ?? defaultMs;
  }

  /**
   * Get the base URL for the active environment.
   * @returns {string} Base URL (e.g., 'https://staging.brainstormy.app')
   */
  getBaseURL() {
    const env = this.app.activeEnvironment ?? 'staging';
    return this.app.environments?.[env]?.url;
  }
}

module.exports = BaseConnector;
```

---

## 7. Error Classes File

```javascript
// connectors/errors.js

'use strict';

class ConnectorError extends Error {
  /**
   * @param {string} message - Error description
   * @param {object} [options]
   * @param {string} [options.action] - What was being attempted
   * @param {string} [options.selector] - Which element (if applicable)
   * @param {string} [options.phase] - 'initialize'|'authenticate'|'navigate'|'interact'|'cleanup'
   * @param {boolean} [options.recoverable=false] - Can the agent retry/skip?
   * @param {object} [options.evidence] - Evidence package captured at failure
   */
  constructor(message, { action, selector, phase, recoverable = false, evidence = null } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.action = action;
    this.selector = selector;
    this.phase = phase;
    this.recoverable = recoverable;
    this.evidence = evidence;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Serialize for logging/database storage.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      action: this.action,
      selector: this.selector,
      phase: this.phase,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      hasEvidence: this.evidence !== null
    };
  }
}

class AuthenticationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'authenticate', recoverable: false });
    this.name = 'AuthenticationError';
  }
}

class NavigationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'navigate', recoverable: true });
    this.name = 'NavigationError';
  }
}

class ElementNotFoundError extends ConnectorError {
  constructor(selector, details = {}) {
    super(`Element not found: ${selector}`, { ...details, selector, phase: 'interact', recoverable: true });
    this.name = 'ElementNotFoundError';
  }
}

class ConnectorTimeoutError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, recoverable: true });
    this.name = 'ConnectorTimeoutError';
  }
}

module.exports = {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
};
```

---

## 8. Unit Test Specification

```javascript
// tests/connectors/base-connector.test.js — Test outline

describe('BaseConnector', () => {
  
  describe('Instantiation', () => {
    test('cannot be instantiated directly — throws error');
    test('can be instantiated via subclass');
    test('stores app, page, evidence references');
    test('initializes empty state Map');
    test('_initialized starts as false');
    test('_cleanedUp starts as false');
  });

  describe('Abstract Methods', () => {
    test('initialize() throws ConnectorError');
    test('cleanup() throws ConnectorError');
    test('authenticate() throws AuthenticationError');
    test('logout() throws ConnectorError');
    test('isAuthenticated() throws ConnectorError');
    test('navigate() throws NavigationError');
    test('waitForNavigation() throws ConnectorTimeoutError');
    test('performAction() throws ConnectorError with action name');
    test('click() throws ElementNotFoundError');
    test('type() throws ElementNotFoundError');
    test('select() throws ElementNotFoundError');
    test('waitFor() throws ConnectorTimeoutError');
    test('extractData() throws ElementNotFoundError');
    test('extractMultiple() throws ConnectorError');
    test('exists() throws ConnectorError');
  });

  describe('Implemented Methods — getCurrentURL', () => {
    test('returns page.url() value');
  });

  describe('Implemented Methods — Evidence Collection', () => {
    test('takeScreenshot delegates to evidence.captureScreenshot');
    test('getLogs delegates to evidence.getConsoleLogs');
    test('getNetworkRequests delegates to evidence.getNetworkRequests');
    test('collectEvidence delegates to evidence.collectAll with page and stepName');
  });

  describe('Implemented Methods — State Management', () => {
    test('setState/getState round-trips values');
    test('getState returns undefined for unset keys');
    test('hasState returns true for set keys, false for unset');
    test('clearState removes all entries');
    test('state supports any value type (string, object, array, null)');
  });

  describe('Implemented Methods — Configuration Helpers', () => {
    test('getSelector returns selector from app config');
    test('getSelector returns undefined for missing key');
    test('getTimeout returns configured value');
    test('getTimeout returns default when key not configured');
    test('getTimeout uses 30000 when no default provided');
    test('getBaseURL returns staging URL by default');
    test('getBaseURL uses activeEnvironment when set');
  });

  describe('healthCheck', () => {
    test('returns healthy:true after initialization flag set');
    test('returns healthy:false before initialization');
    test('returns healthy:false after cleanup');
    test('includes state size and URL in details');
  });
});

describe('ConnectorError hierarchy', () => {
  test('ConnectorError has correct properties');
  test('AuthenticationError sets phase to "authenticate" and recoverable to false');
  test('NavigationError sets phase to "navigate" and recoverable to true');
  test('ElementNotFoundError includes selector in message');
  test('ConnectorTimeoutError is recoverable by default');
  test('toJSON serializes correctly');
  test('all errors include timestamp');
});
```

---

## 9. Implementation Order for Claude Code

### Step 1: Infrastructure Setup (pre-implementation)

These items must exist before writing any connector code or tests.

| Task | Details |
|------|---------|
| Create `jest.config.js` | `testMatch: ['**/tests/**/*.test.js']`, CommonJS transform not needed (no ESM) |
| Update `package.json` test script | Change `"test": "echo \"Error: no test specified\" && exit 1"` → `"test": "jest"` |
| Create `tests/connectors/` directory | Empty directory for test files |
| Create `apps/brainstormy/config.json` | Use the Brainstormy config from qa-engine-03-connector-pattern-spec.md (Connector Configuration section). This doesn't block BaseConnector tests (which use mocks), but prevents it from becoming a forgotten dependency. |

### Step 2: Connector Files (in order)

| # | File | Purpose | Priority |
|---|------|---------|----------|
| 1 | `connectors/errors.js` | Error class hierarchy (Section 7) | Create first — BaseConnector imports it |
| 2 | `connectors/base-connector.js` | Abstract base class (Section 6) | Create second — depends on errors.js |
| 3 | `tests/connectors/base-connector.test.js` | Unit tests (Section 8) | Create third — validates both files above |

### Step 3: Validation

```bash
# Run tests — all should pass
npm test

# Verify error hierarchy
node -e "const e = require('./connectors/errors'); console.log(Object.keys(e));"
# Should print: ConnectorError, AuthenticationError, NavigationError, ElementNotFoundError, ConnectorTimeoutError

# Verify BaseConnector cannot be instantiated directly
node -e "const BC = require('./connectors/base-connector'); new BC({}, {}, {});"
# Should throw: "BaseConnector is abstract and cannot be instantiated directly"
```

---

## 10. Claude Code Implementation Notes

When sending this to Claude Code, emphasize:

1. **Follow Section 9 order exactly.** Infrastructure setup first (jest config, directories), then errors.js, then base-connector.js, then tests. Each step depends on the previous one.

2. **BaseConnector does not perform DOM interactions via Playwright.** Metadata accessors like `getCurrentURL()` (which calls `page.url()`) are permitted. All DOM manipulation, element queries, and page navigation happen in GenericWebAppConnector.

3. **Evidence collector is a dependency, not built here.** Use a mock/stub in tests. The mock must implement the interface defined in Section 5.3. The real `EvidenceCollector` is a parallel Week 1 deliverable.

4. **The `new.target` guard** prevents direct instantiation. This is the standard JS pattern for abstract classes.

5. **`performAction` is the key design pattern.** Each level in the hierarchy adds a `switch` block for its actions and falls through to `super.performAction()` for unrecognized actions. This is how agents stay app-agnostic. The evidence-wrapping version lives in GenericWebAppConnector (see Section 5.1 for the pattern).

6. **State management is intentionally simple.** A `Map` is sufficient. No need for proxies, observables, or persistence — state is ephemeral per test run.

7. **Error classification drives agent behavior.** `recoverable: true` means the agent can retry or skip. `recoverable: false` means abort the test run. This is used by the Test Orchestrator.

8. **`ConnectorTimeoutError` (not `TimeoutError`)** — renamed to avoid collision with Playwright's own `TimeoutError` export. GenericWebAppConnector will catch Playwright's `TimeoutError` and wrap it in `ConnectorTimeoutError` with attached evidence. The naming distinction makes this explicit at every call site.

---

## 11. What Comes Next

After BaseConnector is built and tested:

- **Same sprint (Days 1-2):** `GenericWebAppConnector` — implements all abstract methods with Playwright
- **Same sprint (Days 1-2):** `EvidenceCollector` — parallel deliverable
- **Days 3-4:** `AIAppConnector` — adds `sendMessage`, `waitForAIResponse`, `validateMemory`
- **Days 5:** `BrainstormyConnector` — app-specific actions + Brainstormy config JSON
