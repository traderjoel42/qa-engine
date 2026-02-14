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
   * @throws {NavigationError} If navigation fails or base URL is not configured
   */
  async navigate(path) {
    let url;
    if (path.startsWith('http')) {
      url = path;
    } else {
      const baseURL = this.getBaseURL();
      if (!baseURL) {
        throw new NavigationError('Base URL not configured — check app.environments', {
          action: 'navigate'
        });
      }
      url = `${baseURL}${path}`;
    }

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
        case 'wait': {
          const resolvedSelector = this.getSelector(params.selector) || params.selector;
          await this.waitFor(resolvedSelector, params.timeout);
          result = { found: true, selector: params.selector };
          break;
        }
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
