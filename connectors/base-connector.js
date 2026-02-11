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
