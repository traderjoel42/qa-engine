# QA Engine: GenericWebAppConnector Implementation Specification

**Phase:** 1, Week 1, Days 1-2  
**Purpose:** Implementation-ready spec for `connectors/generic-web-app/connector.js`  
**For:** Claude Code evaluation → implementation  
**References:** qa-engine-03-connector-pattern-spec.md, base-connector-implementation-spec.md  
**Depends on:** `connectors/base-connector.js` (implemented), `connectors/errors.js` (implemented), `core/engine/evidence-collector.js` (implemented)  
**Depended on by:** `connectors/ai-chat-app/connector.js` (AIAppConnector — next deliverable)

---

## 1. Design Decisions

### Role in the System

GenericWebAppConnector is the **first concrete connector** — the one that actually touches Playwright. It sits between the abstract BaseConnector (which defines the contract) and the app-specific connectors (which add domain logic).

```
BaseConnector (abstract — defines 15 abstract methods)
    ↓
GenericWebAppConnector (THIS — implements all 15 with Playwright)
    ↓
AIAppConnector (adds chat-specific actions: send_message, wait_for_response, etc.)
    ↓
BrainstormyConnector (adds Brainstormy-specific actions: create_project, create_story, etc.)
```

Any web application can be tested using GenericWebAppConnector directly. The specialized subclasses exist only to add domain-specific convenience actions — they inherit all the Playwright interaction logic from here.

### Key Design Principles

1. **Configuration over hardcoding.** Every selector, timeout, and URL comes from the `app` config object. GenericWebAppConnector never hardcodes a CSS selector or URL path. This is what makes it generic.

2. **Evidence wrapping in performAction.** Every `performAction` call automatically captures before/after/failure screenshots. Individual methods (`click`, `type`, etc.) do NOT capture evidence — only `performAction` does. This prevents double-capture when `performAction` dispatches to `click`.

3. **Playwright error wrapping.** Playwright throws its own `TimeoutError` and generic `Error` types. GenericWebAppConnector catches these and wraps them in the QA Engine error hierarchy (`ConnectorTimeoutError`, `ElementNotFoundError`, `NavigationError`) so agents get consistent error types regardless of the underlying browser driver.

4. **Thin adapter, not business logic.** Each method is a direct mapping to a Playwright API call with minimal glue. No validation, no retry logic, no workflow orchestration. That's what agents are for.

### What Changes from the Original Spec

The qa-engine-03-connector-pattern-spec.md has the right shape but predates the BaseConnector implementation. Key adjustments:

- **Error types:** Original spec used `throw new Error(...)`. We now use the error hierarchy from `connectors/errors.js`.
- **Constructor:** No `new.target` guard here — GenericWebAppConnector is concrete and can be instantiated directly.
- **performAction evidence wrapping:** The pattern from base-connector-implementation-spec.md Section 5.1 is now the canonical implementation.
- **getSelector/getTimeout/getBaseURL:** Already implemented in BaseConnector. GenericWebAppConnector calls `this.getSelector('login_email')` etc. — no need to redefine.

---

## 2. Complete Method Inventory

### 2.1 Lifecycle Methods (override BaseConnector abstract)

| Method | Purpose |
|--------|---------|
| `initialize()` | Navigate to app, authenticate if required, verify ready state. Sets `_initialized = true`. |
| `cleanup()` | Logout if authenticated, clear state, set `_cleanedUp = true`. Fault-tolerant — each step is try/caught independently. |

### 2.2 Authentication Methods (override BaseConnector abstract)

| Method | Purpose |
|--------|---------|
| `authenticate()` | Perform email/password login using selectors from config. Returns `true` on success. Sets state `authenticated = true`. |
| `logout()` | Click logout selector if it exists. Sets state `authenticated = false`. |
| `isAuthenticated()` | Check for auth indicator selector. Falls back to URL-based check (not on `/login`). |

### 2.3 Navigation Methods (override BaseConnector abstract)

| Method | Purpose |
|--------|---------|
| `navigate(path)` | Navigate to path (relative → prepend base URL, absolute → use as-is). Waits for network idle. |
| `waitForNavigation(timeout)` | Wait for Playwright `networkidle` load state. |

### 2.4 Interaction Methods (override BaseConnector abstract)

| Method | Purpose |
|--------|---------|
| `performAction(action, params)` | Evidence-wrapping dispatcher. Before → switch → after. Catches Playwright errors and wraps in QA Engine types. |
| `click(selector)` | `page.click(selector)` + 500ms settle pause. |
| `type(selector, text)` | `page.fill(selector, text)`. |
| `select(selector, value)` | `page.selectOption(selector, value)`. |
| `waitFor(selector, timeout)` | `page.waitForSelector(selector, { timeout })`. |

### 2.5 Data Extraction Methods (override BaseConnector abstract)

| Method | Purpose |
|--------|---------|
| `extractData(selector)` | Get text, value, innerHTML, and attributes from a single element. Returns `null` if not found. |
| `extractMultiple(selector)` | Get `textContent` from all matching elements. Returns empty array if none found. |
| `exists(selector)` | Check if element exists in DOM. Returns boolean, never throws. |

### 2.6 Helper Methods (new — not in BaseConnector)

| Method | Visibility | Purpose |
|--------|-----------|---------|
| `waitForAppReady()` | `async` public | Wait for `ready_indicator` selector from config. No-op if not configured. |
| `_wrapPlaywrightError(error, context)` | internal | Catch Playwright errors and convert to QA Engine error hierarchy. |

### 2.7 Inherited Methods (from BaseConnector — NOT overridden)

These are already implemented in BaseConnector and work as-is:

| Method | Source |
|--------|--------|
| `getCurrentURL()` | BaseConnector |
| `takeScreenshot(name)` | BaseConnector (delegates to EvidenceCollector) |
| `getLogs()` | BaseConnector (delegates to EvidenceCollector) |
| `getNetworkRequests()` | BaseConnector (delegates to EvidenceCollector) |
| `collectEvidence(stepName)` | BaseConnector (delegates to EvidenceCollector) |
| `setState/getState/hasState/clearState` | BaseConnector |
| `getSelector/getTimeout/getBaseURL` | BaseConnector |
| `healthCheck()` | BaseConnector |

---

## 3. Error Wrapping Strategy

Playwright throws several error types. GenericWebAppConnector catches and wraps them so agents see a consistent error hierarchy.

### Wrapping Rules

| Playwright throws | When | QA Engine wraps as |
|---|---|---|
| `TimeoutError` | `waitForSelector`, `waitForLoadState` | `ConnectorTimeoutError` |
| `Error('Element not found')` / target closed during click | `click`, `fill`, `selectOption` | `ElementNotFoundError` |
| `Error` during `goto` | Navigation failures | `NavigationError` |
| Any other `Error` | Unknown | `ConnectorError` |

### Detection Logic

Playwright's `TimeoutError` is detected by checking `error.name === 'TimeoutError'` (not `instanceof`, since it may come from a different module context). Element errors are detected by message patterns.

```javascript
_wrapPlaywrightError(error, { action, selector, phase } = {}) {
  // Playwright timeout
  if (error.name === 'TimeoutError' || error.message.includes('Timeout')) {
    return new ConnectorTimeoutError(
      `Timeout during ${action || 'operation'}: ${error.message}`,
      { action, selector, phase, recoverable: true }
    );
  }

  // Element not found / not visible / detached
  if (
    error.message.includes('waiting for selector') ||
    error.message.includes('Element is not') ||
    error.message.includes('no element found') ||
    error.message.includes('Target closed')
  ) {
    return new ElementNotFoundError(selector || 'unknown', {
      action,
      phase: phase || 'interact',
      recoverable: true
    });
  }

  // Navigation failure
  if (
    error.message.includes('net::') ||
    error.message.includes('Navigation failed') ||
    error.message.includes('ERR_')
  ) {
    return new NavigationError(
      `Navigation failed: ${error.message}`,
      { action, phase: 'navigate', recoverable: true }
    );
  }

  // Generic fallback
  return new ConnectorError(
    `Playwright error during ${action || 'operation'}: ${error.message}`,
    { action, selector, phase, recoverable: false }
  );
}
```

---

## 4. performAction Evidence Wrapping

This is the most important method in the class. It implements the pattern from base-connector-implementation-spec.md Section 5.1.

### Flow

```
Agent calls connector.performAction('click', { selector: '#btn' })
    ↓
1. Generate stepId: 'click_1707600000000'
2. Capture evidence: 'before_click_1707600000000'
3. Switch on action → dispatch to this.click('#btn')
4a. Success → capture evidence: 'after_click_1707600000000' → return result
4b. Failure → capture evidence: 'failed_click_1707600000000' → wrap error → throw
```

### Supported Actions

| Action string | Dispatches to | Required params |
|---|---|---|
| `'navigate'` | `this.navigate(params.path)` | `{ path }` |
| `'click'` | `this.click(params.selector)` | `{ selector }` |
| `'type'` | `this.type(params.selector, params.text)` | `{ selector, text }` |
| `'select'` | `this.select(params.selector, params.value)` | `{ selector, value }` |
| `'wait'` | `this.waitFor(params.selector, params.timeout)` | `{ selector, timeout? }` |
| `'extract'` | `this.extractData(params.selector)` | `{ selector }` |
| `'extract_multiple'` | `this.extractMultiple(params.selector)` | `{ selector }` |
| `'exists'` | `this.exists(params.selector)` | `{ selector }` |
| anything else | `super.performAction(action, params)` | — (throws ConnectorError) |

### Why evidence is NOT captured in individual methods

If `click()` captured evidence, and `performAction` also captured evidence around its call to `click()`, you'd get 4 captures per action instead of 2. Evidence capture is a `performAction`-level concern. Individual methods (`click`, `type`, etc.) are pure Playwright wrappers.

Agents calling `click()` directly (bypassing `performAction`) do NOT get automatic evidence. This is intentional — agents should use `performAction` for the evidence trail.

---

## 5. Authentication Design

### Supported Auth Types

Phase 1 supports only `email_password`. The authenticate method checks `app.environments.staging.auth.type` and dispatches accordingly. Additional types (OAuth, SSO, API key) can be added as new `case` branches later.

### Auth Flow

```
1. Read auth config from this.app.environments[activeEnv].auth
2. If auth.type !== 'email_password' → throw AuthenticationError('unsupported')
3. Navigate to auth.login_url (default: '/login')
4. Fill email field (selector from config: 'login_email')
5. Fill password field (selector from config: 'login_password')
   — password comes from process.env[auth.credentials.password_env]
6. Click submit button (selector from config: 'login_submit')
7. Wait for navigation (page redirect after login)
8. Verify via isAuthenticated()
9. Set state: authenticated = true
10. Return true
```

### Password Security

The password is **never** stored in app config. The config contains only `password_env: 'BRAINSTORMY_TEST_PASSWORD'`, and the connector reads `process.env.BRAINSTORMY_TEST_PASSWORD` at runtime. If the env var is not set, `authenticate()` throws `AuthenticationError`.

---

## 6. Complete Implementation

```javascript
// connectors/generic-web-app/connector.js

'use strict';

const BaseConnector = require('../base-connector');
const {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
} = require('../errors');

/**
 * Generic web application connector using Playwright.
 *
 * Implements all 15 BaseConnector abstract methods with Playwright API calls.
 * Configuration-driven — all selectors, timeouts, and URLs come from the
 * app config object, making this connector work with any web application.
 *
 * Inheritance chain:
 *   BaseConnector (abstract) → GenericWebAppConnector (this) → AIAppConnector → [App]Connector
 *
 * @example
 * const connector = new GenericWebAppConnector(appConfig, page, evidenceCollector);
 * await connector.initialize();
 * await connector.performAction('click', { selector: '#submit' });
 * await connector.cleanup();
 */
class GenericWebAppConnector extends BaseConnector {

  // ===================================================================
  // LIFECYCLE
  // ===================================================================

  /**
   * Initialize the connector:
   * 1. Navigate to the app's base URL
   * 2. Authenticate if required by config
   * 3. Wait for app ready indicator
   * 4. Mark as initialized
   *
   * @returns {Promise<void>}
   * @throws {ConnectorError} If initialization fails
   * @throws {AuthenticationError} If login fails
   */
  async initialize() {
    // Navigate to app root
    await this.navigate('/');

    // Authenticate if required
    const env = this.app.activeEnvironment ?? 'staging';
    const auth = this.app.environments?.[env]?.auth;

    if (auth?.required) {
      const success = await this.authenticate();
      if (!success) {
        throw new AuthenticationError('Authentication failed during initialization');
      }
    }

    // Wait for app to be ready
    await this.waitForAppReady();

    this._initialized = true;
  }

  /**
   * Cleanup after tests complete.
   * Each step is independently try/caught — one failure doesn't prevent the rest.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Step 1: Logout if authenticated
    try {
      if (await this.isAuthenticated()) {
        await this.logout();
      }
    } catch (error) {
      console.error('[GenericWebAppConnector] Logout during cleanup failed:', error.message);
    }

    // Step 2: Clear state
    try {
      this.clearState();
    } catch (error) {
      console.error('[GenericWebAppConnector] State clear during cleanup failed:', error.message);
    }

    this._cleanedUp = true;
  }

  // ===================================================================
  // AUTHENTICATION
  // ===================================================================

  /**
   * Authenticate with the application using email/password.
   * Credentials and selectors come from app config.
   *
   * @returns {Promise<boolean>} True if authentication succeeded
   * @throws {AuthenticationError} If auth type unsupported or credentials missing
   */
  async authenticate() {
    const env = this.app.activeEnvironment ?? 'staging';
    const auth = this.app.environments?.[env]?.auth;

    if (!auth) {
      throw new AuthenticationError('No auth configuration found');
    }

    if (auth.type !== 'email_password') {
      throw new AuthenticationError(`Auth type "${auth.type}" is not supported`);
    }

    // Read password from environment variable
    const password = process.env[auth.credentials.password_env];
    if (!password) {
      throw new AuthenticationError(
        `Environment variable "${auth.credentials.password_env}" is not set`
      );
    }

    try {
      // Navigate to login page
      const loginUrl = auth.login_url || '/login';
      await this.navigate(loginUrl);

      // Fill credentials
      const emailSelector = this.getSelector('login_email');
      const passwordSelector = this.getSelector('login_password');
      const submitSelector = this.getSelector('login_submit');

      if (!emailSelector || !passwordSelector || !submitSelector) {
        throw new AuthenticationError(
          'Missing login selectors in config (need: login_email, login_password, login_submit)'
        );
      }

      await this.type(emailSelector, auth.credentials.email);
      await this.type(passwordSelector, password);
      await this.click(submitSelector);

      // Wait for redirect after login
      await this.waitForNavigation();

      // Verify authentication succeeded
      const authenticated = await this.isAuthenticated();
      if (authenticated) {
        this.setState('authenticated', true);
      }

      return authenticated;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        `Authentication failed: ${error.message}`,
        { action: 'authenticate' }
      );
    }
  }

  /**
   * Log out of the application.
   * Clicks the logout selector if configured and visible.
   *
   * @returns {Promise<void>}
   */
  async logout() {
    const logoutSelector = this.getSelector('logout');
    if (logoutSelector && await this.exists(logoutSelector)) {
      await this.click(logoutSelector);
      await this.waitForNavigation();
    }
    this.setState('authenticated', false);
  }

  /**
   * Check if currently authenticated.
   * Uses auth_indicator selector if configured, otherwise checks URL.
   *
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    // Prefer config-based indicator
    const indicator = this.app.config?.auth_indicator;
    if (indicator) {
      return await this.exists(indicator);
    }

    // Fallback: not on login page
    const currentUrl = await this.getCurrentURL();
    return !currentUrl.includes('/login');
  }

  // ===================================================================
  // NAVIGATION
  // ===================================================================

  /**
   * Navigate to a path within the app.
   * Relative paths are prepended with the base URL.
   * Absolute URLs (starting with http) are used as-is.
   *
   * @param {string} path - Relative path (e.g., '/dashboard') or absolute URL
   * @returns {Promise<void>}
   * @throws {NavigationError} If navigation fails
   */
  async navigate(path) {
    const url = path.startsWith('http')
      ? path
      : `${this.getBaseURL()}${path}`;

    try {
      await this.page.goto(url);
      await this.waitForNavigation();
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'navigate',
        phase: 'navigate'
      });
    }
  }

  /**
   * Wait for page to reach network idle state.
   *
   * @param {number} [timeout=30000] - Maximum wait time in ms
   * @returns {Promise<void>}
   * @throws {ConnectorTimeoutError} If page doesn't settle within timeout
   */
  async waitForNavigation(timeout = 30000) {
    try {
      await this.page.waitForLoadState('networkidle', { timeout });
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'waitForNavigation',
        phase: 'navigate'
      });
    }
  }

  // ===================================================================
  // INTERACTIONS
  // ===================================================================

  /**
   * Evidence-wrapping action dispatcher.
   * This is the PRIMARY ENTRY POINT for agent interactions.
   *
   * Captures before/after/failure evidence around every action.
   * Dispatches to individual methods via switch statement.
   * Unrecognized actions fall through to super.performAction()
   * (which throws ConnectorError).
   *
   * @param {string} action - Action type
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<any>} Action result
   * @throws {ConnectorError} On failure (with evidence attached)
   */
  async performAction(action, params = {}) {
    const stepId = `${action}_${Date.now()}`;

    // Before evidence
    await this.collectEvidence(`before_${stepId}`);

    let result;
    try {
      switch (action) {
        case 'navigate':
          result = await this.navigate(params.path);
          break;
        case 'click':
          result = await this.click(params.selector);
          break;
        case 'type':
          result = await this.type(params.selector, params.text);
          break;
        case 'select':
          result = await this.select(params.selector, params.value);
          break;
        case 'wait':
          result = await this.waitFor(params.selector, params.timeout);
          break;
        case 'extract':
          result = await this.extractData(params.selector);
          break;
        case 'extract_multiple':
          result = await this.extractMultiple(params.selector);
          break;
        case 'exists':
          result = await this.exists(params.selector);
          break;
        default:
          // Chains up to BaseConnector → throws "not supported"
          result = await super.performAction(action, params);
      }
    } catch (error) {
      // Failure evidence — capture before re-throwing
      await this.collectEvidence(`failed_${stepId}`);
      throw error;
    }

    // After evidence
    await this.collectEvidence(`after_${stepId}`);

    return result;
  }

  /**
   * Click an element.
   * Includes a brief 500ms settle pause after click for UI updates.
   *
   * @param {string} selector - CSS selector
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError} If element not found
   */
  async click(selector) {
    try {
      await this.page.click(selector);
      await this.page.waitForTimeout(500);
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'click',
        selector
      });
    }
  }

  /**
   * Type text into an input field.
   * Uses Playwright's fill() which clears existing content first.
   *
   * @param {string} selector - CSS selector for input
   * @param {string} text - Text to enter
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError} If input not found
   */
  async type(selector, text) {
    try {
      await this.page.fill(selector, text);
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'type',
        selector
      });
    }
  }

  /**
   * Select an option from a dropdown.
   *
   * @param {string} selector - CSS selector for select element
   * @param {string} value - Option value to select
   * @returns {Promise<void>}
   * @throws {ElementNotFoundError} If select element not found
   */
  async select(selector, value) {
    try {
      await this.page.selectOption(selector, value);
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'select',
        selector
      });
    }
  }

  /**
   * Wait for an element to appear in the DOM.
   *
   * @param {string} selector - CSS selector
   * @param {number} [timeout=30000] - Maximum wait time in ms
   * @returns {Promise<void>}
   * @throws {ConnectorTimeoutError} If element doesn't appear within timeout
   */
  async waitFor(selector, timeout = 30000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'waitFor',
        selector
      });
    }
  }

  // ===================================================================
  // DATA EXTRACTION
  // ===================================================================

  /**
   * Extract text, value, innerHTML, and attributes from a single element.
   * Returns null if the element does not exist (does not throw).
   *
   * @param {string} selector - CSS selector
   * @returns {Promise<{text: string, value: any, html: string, attributes: object}|null>}
   */
  async extractData(selector) {
    const element = await this.page.$(selector);
    if (!element) return null;

    try {
      return await element.evaluate(el => ({
        text: el.textContent,
        value: el.value,
        html: el.innerHTML,
        attributes: Array.from(el.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {})
      }));
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'extractData',
        selector
      });
    }
  }

  /**
   * Extract textContent from all elements matching the selector.
   * Returns empty array if no elements found.
   *
   * @param {string} selector - CSS selector matching multiple elements
   * @returns {Promise<string[]>}
   */
  async extractMultiple(selector) {
    try {
      const elements = await this.page.$$(selector);
      return await Promise.all(
        elements.map(el => el.evaluate(e => e.textContent))
      );
    } catch (error) {
      throw this._wrapPlaywrightError(error, {
        action: 'extractMultiple',
        selector
      });
    }
  }

  /**
   * Check if an element exists in the DOM.
   * Never throws — always returns boolean.
   *
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>}
   */
  async exists(selector) {
    try {
      return (await this.page.$(selector)) !== null;
    } catch (error) {
      // If the page is closed or in a bad state, element doesn't "exist"
      return false;
    }
  }

  // ===================================================================
  // HELPERS
  // ===================================================================

  /**
   * Wait for the application to be fully loaded.
   * Uses the ready_indicator selector from config.
   * No-op if no indicator is configured.
   *
   * @returns {Promise<void>}
   */
  async waitForAppReady() {
    const readyIndicator = this.app.config?.ready_indicator;
    if (readyIndicator) {
      await this.waitFor(readyIndicator, this.getTimeout('navigation'));
    }
  }

  /**
   * Convert a Playwright error into the QA Engine error hierarchy.
   *
   * @param {Error} error - Playwright error
   * @param {object} context
   * @param {string} [context.action] - What was being attempted
   * @param {string} [context.selector] - Which element (if applicable)
   * @param {string} [context.phase] - Lifecycle phase
   * @returns {ConnectorError} Wrapped error
   */
  _wrapPlaywrightError(error, { action, selector, phase } = {}) {
    // Already a QA Engine error — pass through
    if (error instanceof ConnectorError) {
      return error;
    }

    // Playwright timeout
    if (error.name === 'TimeoutError' || error.message.includes('Timeout')) {
      return new ConnectorTimeoutError(
        `Timeout during ${action || 'operation'}: ${error.message}`,
        { action, selector, phase, recoverable: true }
      );
    }

    // Element not found / not visible / detached
    if (
      error.message.includes('waiting for selector') ||
      error.message.includes('Element is not') ||
      error.message.includes('no element found') ||
      error.message.includes('Target closed')
    ) {
      return new ElementNotFoundError(selector || 'unknown', {
        action,
        phase: phase || 'interact',
        recoverable: true
      });
    }

    // Navigation failure
    if (
      error.message.includes('net::') ||
      error.message.includes('Navigation failed') ||
      error.message.includes('ERR_')
    ) {
      return new NavigationError(
        `Navigation failed: ${error.message}`,
        { action, phase: 'navigate', recoverable: true }
      );
    }

    // Generic fallback
    return new ConnectorError(
      `Playwright error during ${action || 'operation'}: ${error.message}`,
      { action, selector, phase, recoverable: false }
    );
  }
}

module.exports = GenericWebAppConnector;
```

---

## 7. Unit Test Specification

```javascript
// tests/connectors/generic-web-app-connector.test.js — Test outline

describe('GenericWebAppConnector', () => {

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly (not abstract)');
    test('inherits from BaseConnector');
    test('stores app, page, evidence references');
    test('initializes with _initialized = false');
  });

  describe('initialize()', () => {
    test('navigates to base URL');
    test('authenticates when auth.required is true');
    test('skips authentication when auth.required is false');
    test('waits for ready indicator when configured');
    test('sets _initialized to true on success');
    test('throws AuthenticationError when login fails');
    test('throws NavigationError when app is unreachable');
  });

  describe('cleanup()', () => {
    test('logs out when authenticated');
    test('skips logout when not authenticated');
    test('clears all state');
    test('sets _cleanedUp to true');
    test('continues cleanup even if logout throws');
    test('continues cleanup even if clearState throws');
  });

  describe('authenticate()', () => {
    test('navigates to login page');
    test('fills email from config');
    test('fills password from environment variable');
    test('clicks submit button');
    test('waits for navigation after submit');
    test('returns true on success');
    test('sets state authenticated = true on success');
    test('throws AuthenticationError when no auth config');
    test('throws AuthenticationError for unsupported auth type');
    test('throws AuthenticationError when env var not set');
    test('throws AuthenticationError when login selectors missing');
  });

  describe('logout()', () => {
    test('clicks logout selector when exists');
    test('waits for navigation after logout click');
    test('no-op when logout selector not configured');
    test('no-op when logout element not visible');
    test('sets state authenticated = false');
  });

  describe('isAuthenticated()', () => {
    test('returns true when auth_indicator element exists');
    test('returns false when auth_indicator element missing');
    test('falls back to URL check when no auth_indicator configured');
    test('returns false when URL contains /login');
    test('returns true when URL does not contain /login');
  });

  describe('navigate()', () => {
    test('prepends base URL for relative paths');
    test('uses absolute URL as-is for http paths');
    test('waits for network idle after navigation');
    test('throws NavigationError on failure');
  });

  describe('waitForNavigation()', () => {
    test('waits for networkidle load state');
    test('uses provided timeout');
    test('throws ConnectorTimeoutError when page does not settle');
  });

  describe('performAction()', () => {
    test('captures before evidence');
    test('captures after evidence on success');
    test('captures failure evidence on error');
    test('dispatches navigate action');
    test('dispatches click action');
    test('dispatches type action');
    test('dispatches select action');
    test('dispatches wait action');
    test('dispatches extract action');
    test('dispatches extract_multiple action');
    test('dispatches exists action');
    test('throws ConnectorError for unknown actions via super');
    test('re-throws error after capturing failure evidence');
  });

  describe('click()', () => {
    test('calls page.click with selector');
    test('waits 500ms after click');
    test('wraps Playwright error as ElementNotFoundError');
  });

  describe('type()', () => {
    test('calls page.fill with selector and text');
    test('wraps Playwright error as ElementNotFoundError');
  });

  describe('select()', () => {
    test('calls page.selectOption with selector and value');
    test('wraps Playwright error as ElementNotFoundError');
  });

  describe('waitFor()', () => {
    test('calls page.waitForSelector with selector and timeout');
    test('uses default 30000ms timeout');
    test('wraps Playwright timeout as ConnectorTimeoutError');
  });

  describe('extractData()', () => {
    test('returns text, value, html, attributes for found element');
    test('returns null when element not found');
    test('wraps Playwright error on evaluation failure');
  });

  describe('extractMultiple()', () => {
    test('returns array of textContent for matching elements');
    test('returns empty array when no elements match');
    test('wraps Playwright error on failure');
  });

  describe('exists()', () => {
    test('returns true when element exists');
    test('returns false when element not found');
    test('returns false on error (never throws)');
  });

  describe('waitForAppReady()', () => {
    test('waits for ready_indicator when configured');
    test('uses navigation timeout from config');
    test('no-op when ready_indicator not configured');
  });

  describe('_wrapPlaywrightError()', () => {
    test('passes through ConnectorError subclasses unchanged');
    test('wraps TimeoutError as ConnectorTimeoutError');
    test('wraps "Timeout" message as ConnectorTimeoutError');
    test('wraps "waiting for selector" as ElementNotFoundError');
    test('wraps "Element is not" as ElementNotFoundError');
    test('wraps "Target closed" as ElementNotFoundError');
    test('wraps "net::" as NavigationError');
    test('wraps "ERR_" as NavigationError');
    test('wraps unknown errors as ConnectorError');
    test('sets recoverable = true for timeout and element errors');
    test('sets recoverable = false for generic errors');
    test('preserves action and selector in wrapped error');
  });

  describe('Inherited methods (smoke tests)', () => {
    test('getCurrentURL returns page.url()');
    test('takeScreenshot delegates to evidence collector');
    test('collectEvidence delegates to evidence collector');
    test('getSelector reads from app.config.selectors');
    test('getTimeout reads from app.config.timeouts with default');
    test('getBaseURL reads from app.environments');
  });
});
```

---

## 8. Mock Requirements for Tests

Tests need enhanced mocks beyond what `tests/helpers/mock-playwright.js` already provides. The existing mock factory covers the EvidenceCollector needs. GenericWebAppConnector tests need Playwright page mocks that simulate:

- `page.goto(url)` — navigating
- `page.click(selector)` — clicking elements
- `page.fill(selector, text)` — typing
- `page.selectOption(selector, value)` — dropdowns
- `page.waitForSelector(selector, options)` — waiting
- `page.waitForLoadState(state, options)` — navigation settle
- `page.waitForTimeout(ms)` — brief pauses
- `page.$(selector)` — single element query
- `page.$$(selector)` — multi element query
- `page.url()` — current URL (already in mock)

### Extended Mock Page Factory

Add these methods to the existing `createMockPage` in `tests/helpers/mock-playwright.js`:

```javascript
// Additional page methods needed for GenericWebAppConnector tests
goto: jest.fn().mockResolvedValue(undefined),
click: jest.fn().mockResolvedValue(undefined),
fill: jest.fn().mockResolvedValue(undefined),
selectOption: jest.fn().mockResolvedValue(undefined),
waitForSelector: jest.fn().mockResolvedValue(undefined),
waitForLoadState: jest.fn().mockResolvedValue(undefined),
waitForTimeout: jest.fn().mockResolvedValue(undefined),
$: jest.fn().mockResolvedValue(null),
$$: jest.fn().mockResolvedValue([]),
```

### Mock Element Factory

```javascript
function createMockElement({ text = '', value = '', html = '', attributes = {} } = {}) {
  return {
    evaluate: jest.fn().mockImplementation(fn => {
      // Simulate browser-side evaluation
      const mockEl = {
        textContent: text,
        value: value,
        innerHTML: html,
        attributes: Object.entries(attributes).map(([name, val]) => ({ name, value: val }))
      };
      return fn(mockEl);
    })
  };
}
```

### Mock App Config Factory

```javascript
function createMockAppConfig(overrides = {}) {
  return {
    app_id: 'test-app',
    name: 'Test App',
    activeEnvironment: 'staging',
    environments: {
      staging: {
        url: 'https://staging.test-app.com',
        auth: {
          type: 'email_password',
          required: true,
          login_url: '/login',
          credentials: {
            email: 'test@example.com',
            password_env: 'TEST_APP_PASSWORD'
          }
        }
      }
    },
    config: {
      auth_indicator: '[data-testid="user-menu"]',
      ready_indicator: '[data-testid="app-loaded"]',
      selectors: {
        login_email: '[name="email"]',
        login_password: '[name="password"]',
        login_submit: '[type="submit"]',
        logout: '[data-testid="logout-button"]'
      },
      timeouts: {
        ai_response: 60000,
        navigation: 30000
      }
    },
    ...overrides
  };
}
```

---

## 9. Implementation Order for Claude Code

### Step 1: Extend Mock Helpers

| Task | Details |
|------|---------|
| Update `tests/helpers/mock-playwright.js` | Add `goto`, `click`, `fill`, `selectOption`, `waitForSelector`, `waitForLoadState`, `waitForTimeout`, `$`, `$$` to `createMockPage`. Add `createMockElement` and `createMockAppConfig` factories. Preserve existing factories unchanged. |

### Step 2: Implementation

| # | File | Purpose |
|---|------|---------|
| 1 | `connectors/generic-web-app/connector.js` | Full implementation from Section 6. Create `connectors/generic-web-app/` directory. |
| 2 | `tests/connectors/generic-web-app-connector.test.js` | Tests from Section 7, using extended mocks from Step 1. |

### Step 3: Validation

```bash
# Run all tests (BaseConnector + EvidenceCollector + GenericWebAppConnector)
npm test

# Verify the module loads and the inheritance chain works
node -e "
  const GWAC = require('./connectors/generic-web-app/connector');
  const BaseConnector = require('./connectors/base-connector');
  const c = new GWAC({ config: {} }, {}, {});
  console.log('Inherits BaseConnector:', c instanceof BaseConnector);
  console.log('Has performAction:', typeof c.performAction === 'function');
  console.log('Has click:', typeof c.click === 'function');
  console.log('Has _wrapPlaywrightError:', typeof c._wrapPlaywrightError === 'function');
"

# Verify all test suites pass together
npm test 2>&1 | tail -5
```

---

## 10. Claude Code Implementation Notes

1. **No new dependencies.** GenericWebAppConnector imports only from `../base-connector` and `../errors`. It uses Playwright APIs through the injected `page` object — no `require('playwright')` needed.

2. **The 15 abstract methods are now implemented.** After this, BaseConnector's abstract method tests (which verify each throws `ConnectorError`) remain valid — those tests instantiate a bare subclass, not GenericWebAppConnector.

3. **`exists()` never throws.** This is deliberate. It's a check, not an assertion. If the page is in a bad state, the element doesn't "exist" — returning `false` is the correct behavior. Every other interaction method wraps errors.

4. **`extractData()` returns `null` for missing elements.** It does NOT throw `ElementNotFoundError`. The caller checks for `null`. This matches the original spec's pattern and differs from `click`/`type` which throw on missing elements.

5. **`page.waitForTimeout(500)` in `click()`.** This is a settle pause, not a timeout. React and other frameworks need a moment to process DOM updates after clicks. 500ms is conservative. The `waitFor` method is for explicit waits.

6. **`_wrapPlaywrightError` checks `instanceof ConnectorError` first.** This prevents double-wrapping when `authenticate()` catches and re-throws errors that were already wrapped by `navigate()` or `click()`.

7. **The `connectors/generic-web-app/` directory is new.** The spec places the file at `connectors/generic-web-app/connector.js` (not `connectors/generic-web-app-connector.js`). This matches the directory-per-connector pattern from qa-engine-03-connector-pattern-spec.md and allows each connector to have its own config schemas, README, etc.

8. **Mock page needs Jest mocks, not manual functions.** The existing `createMockPage` in `tests/helpers/mock-playwright.js` uses manual function implementations (for the EvidenceCollector tests which need event emitter behavior). The GenericWebAppConnector tests need Jest mocks (`jest.fn()`) for assertion support (`toHaveBeenCalledWith`, `mockRejectedValue`, etc.). The extended mock should add the new methods as `jest.fn()` while preserving the existing manual implementations for `on`, `off`, `_emit`, `screenshot`.

9. **`process.env` for passwords.** Tests should set and clean up `process.env.TEST_APP_PASSWORD` in `beforeEach/afterEach`. Don't leave test credentials in the environment across test suites.

---

## 11. What Comes Next

After GenericWebAppConnector is built and tested:

- **Same sprint (Days 3-4):** `AIAppConnector` — extends GenericWebAppConnector with chat-specific actions (`send_message`, `wait_for_response`, `get_conversation`, `validate_memory`)
- **Day 5:** `BrainstormyConnector` — extends AIAppConnector with Brainstormy-specific helpers (`createProject`, `createStory`, `createSession`, `generateStoryBible`)
- **Week 1 integration test:** Verify full chain: BaseConnector → GenericWebAppConnector → EvidenceCollector working together with a live Playwright page against a local test server
