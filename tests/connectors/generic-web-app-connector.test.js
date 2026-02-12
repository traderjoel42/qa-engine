'use strict';

const GenericWebAppConnector = require('../../connectors/generic-web-app/connector');
const BaseConnector = require('../../connectors/base-connector');
const {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
} = require('../../connectors/errors');
const {
  createMockPage,
  createMockElement,
  createMockAppConfig
} = require('../helpers/mock-playwright');

// ===================================================================
// HELPERS
// ===================================================================

function createMockEvidence(overrides = {}) {
  return {
    captureScreenshot: jest.fn().mockResolvedValue('/evidence/screenshot.png'),
    getConsoleLogs: jest.fn().mockResolvedValue([]),
    getNetworkRequests: jest.fn().mockResolvedValue([]),
    collectAll: jest.fn().mockResolvedValue({
      stepName: 'test_step',
      timestamp: '2026-02-11T00:00:00Z',
      screenshots: { full: '/evidence/full.png', viewport: '/evidence/viewport.png' },
      consoleLogs: [],
      networkRequests: [],
      url: 'https://staging.test-app.com',
      pageTitle: 'Test',
      viewport: { width: 1280, height: 720 },
      summary: { totalLogs: 0, errorLogs: 0, warnLogs: 0, totalRequests: 0, failedRequests: 0 }
    }),
    ...overrides
  };
}

function createConnector(appOverrides = {}, pageOverrides = {}, evidenceOverrides = {}) {
  const app = createMockAppConfig(appOverrides);
  const page = createMockPage(pageOverrides);
  const evidence = createMockEvidence(evidenceOverrides);
  const connector = new GenericWebAppConnector(app, page, evidence);
  return { connector, app, page, evidence };
}

// ===================================================================
// TESTS
// ===================================================================

describe('GenericWebAppConnector', () => {

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly (not abstract)', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(GenericWebAppConnector);
    });

    test('inherits from BaseConnector', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(BaseConnector);
    });

    test('stores app, page, evidence references', () => {
      const { connector, app, page, evidence } = createConnector();
      expect(connector.app).toBe(app);
      expect(connector.page).toBe(page);
      expect(connector.evidence).toBe(evidence);
    });

    test('initializes with _initialized = false', () => {
      const { connector } = createConnector();
      expect(connector._initialized).toBe(false);
    });
  });

  describe('initialize()', () => {
    test('navigates to base URL', async () => {
      const { connector, page } = createConnector({
        environments: {
          staging: { url: 'https://staging.test-app.com', auth: { required: false } }
        }
      });

      await connector.initialize();
      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/');
    });

    test('authenticates when auth.required is true', async () => {
      const { connector, page } = createConnector();

      // Set password env var
      process.env.TEST_APP_PASSWORD = 'secret123';

      // isAuthenticated check after login succeeds
      page.url.mockReturnValue('https://staging.test-app.com/dashboard');
      // auth_indicator exists
      page.$.mockResolvedValue(createMockElement());

      await connector.initialize();

      // Verify login flow occurred (fill was called for email and password)
      expect(page.fill).toHaveBeenCalled();

      delete process.env.TEST_APP_PASSWORD;
    });

    test('skips authentication when auth.required is false', async () => {
      const { connector, page } = createConnector({
        environments: {
          staging: { url: 'https://staging.test-app.com', auth: { required: false } }
        }
      });

      await connector.initialize();

      // fill should not be called (no login)
      expect(page.fill).not.toHaveBeenCalled();
    });

    test('waits for ready indicator when configured', async () => {
      const { connector, page } = createConnector({
        environments: {
          staging: { url: 'https://staging.test-app.com', auth: { required: false } }
        }
      });

      await connector.initialize();

      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="app-loaded"]',
        { timeout: 30000 }
      );
    });

    test('sets _initialized to true on success', async () => {
      const { connector } = createConnector({
        environments: {
          staging: { url: 'https://staging.test-app.com', auth: { required: false } }
        }
      });

      await connector.initialize();
      expect(connector._initialized).toBe(true);
    });

    test('throws AuthenticationError when login fails', async () => {
      const { connector } = createConnector();

      // Password env not set → authenticate throws
      delete process.env.TEST_APP_PASSWORD;

      await expect(connector.initialize()).rejects.toThrow(AuthenticationError);
    });

    test('throws NavigationError when base URL not configured', async () => {
      const { connector } = createConnector({
        environments: {}
      });

      await expect(connector.initialize()).rejects.toThrow(NavigationError);
      await expect(connector.initialize()).rejects.toThrow('Base URL not configured');
    });
  });

  describe('cleanup()', () => {
    test('logs out when authenticated', async () => {
      const { connector, page } = createConnector();

      // auth_indicator exists → isAuthenticated returns true
      page.$.mockResolvedValue(createMockElement());

      await connector.cleanup();

      // Logout click should have been called
      expect(page.click).toHaveBeenCalledWith('[data-testid="logout-button"]');
    });

    test('skips logout when not authenticated', async () => {
      const { connector, page } = createConnector();

      // auth_indicator not found → isAuthenticated returns false
      page.$.mockResolvedValue(null);
      page.url.mockReturnValue('https://staging.test-app.com/login');

      await connector.cleanup();

      // No click should have been called for logout
      expect(page.click).not.toHaveBeenCalled();
    });

    test('clears all state', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);
      page.url.mockReturnValue('https://staging.test-app.com/login');

      connector.setState('key1', 'value1');
      connector.setState('key2', 'value2');

      await connector.cleanup();

      expect(connector.state.size).toBe(0);
    });

    test('sets _cleanedUp to true', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);
      page.url.mockReturnValue('https://staging.test-app.com/login');

      await connector.cleanup();

      expect(connector._cleanedUp).toBe(true);
    });

    test('continues cleanup even if logout throws', async () => {
      const { connector, page } = createConnector();

      // isAuthenticated returns true, but click throws
      page.$.mockResolvedValue(createMockElement());
      page.click.mockRejectedValue(new Error('Page crashed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await connector.cleanup();

      // Should still set _cleanedUp
      expect(connector._cleanedUp).toBe(true);

      consoleSpy.mockRestore();
    });

    test('continues cleanup even if isAuthenticated throws', async () => {
      const { connector, page } = createConnector({
        config: {} // no auth_indicator
      });

      // page.url throws (page closed)
      page.url.mockImplementation(() => { throw new Error('Target closed'); });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await connector.cleanup();

      expect(connector._cleanedUp).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('authenticate()', () => {
    let savedPassword;

    beforeEach(() => {
      savedPassword = process.env.TEST_APP_PASSWORD;
      process.env.TEST_APP_PASSWORD = 'test-password-123';
    });

    afterEach(() => {
      if (savedPassword !== undefined) {
        process.env.TEST_APP_PASSWORD = savedPassword;
      } else {
        delete process.env.TEST_APP_PASSWORD;
      }
    });

    test('navigates to login page', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement()); // isAuthenticated returns true

      await connector.authenticate();

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/login');
    });

    test('fills email from config', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.authenticate();

      expect(page.fill).toHaveBeenCalledWith('[name="email"]', 'test@example.com');
    });

    test('fills password from environment variable', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.authenticate();

      expect(page.fill).toHaveBeenCalledWith('[name="password"]', 'test-password-123');
    });

    test('clicks submit button', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.authenticate();

      expect(page.click).toHaveBeenCalledWith('[type="submit"]');
    });

    test('waits for navigation after submit', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.authenticate();

      // waitForLoadState should have been called for networkidle
      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.any(Object));
    });

    test('returns true on success', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement()); // auth indicator found

      const result = await connector.authenticate();

      expect(result).toBe(true);
    });

    test('sets state authenticated = true on success', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.authenticate();

      expect(connector.getState('authenticated')).toBe(true);
    });

    test('throws AuthenticationError when no auth config', async () => {
      const { connector } = createConnector({
        environments: { staging: { url: 'https://staging.test-app.com' } }
      });

      await expect(connector.authenticate()).rejects.toThrow(AuthenticationError);
      await expect(connector.authenticate()).rejects.toThrow('No auth configuration found');
    });

    test('throws AuthenticationError for unsupported auth type', async () => {
      const { connector } = createConnector({
        environments: {
          staging: {
            url: 'https://staging.test-app.com',
            auth: { type: 'oauth2', required: true }
          }
        }
      });

      await expect(connector.authenticate()).rejects.toThrow(AuthenticationError);
      await expect(connector.authenticate()).rejects.toThrow('Auth type "oauth2" is not supported');
    });

    test('throws AuthenticationError when env var not set', async () => {
      delete process.env.TEST_APP_PASSWORD;

      const { connector } = createConnector();

      await expect(connector.authenticate()).rejects.toThrow(AuthenticationError);
      await expect(connector.authenticate()).rejects.toThrow('Environment variable "TEST_APP_PASSWORD" is not set');
    });

    test('throws AuthenticationError when login selectors missing', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {} // no login selectors
        }
      });

      await expect(connector.authenticate()).rejects.toThrow(AuthenticationError);
      await expect(connector.authenticate()).rejects.toThrow('Missing login selectors');
    });
  });

  describe('logout()', () => {
    test('clicks logout selector when exists', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement()); // logout element exists

      await connector.logout();

      expect(page.click).toHaveBeenCalledWith('[data-testid="logout-button"]');
    });

    test('waits for navigation after logout click', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      await connector.logout();

      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.any(Object));
    });

    test('no-op when logout selector not configured', async () => {
      const { connector, page } = createConnector({
        config: { selectors: {} }
      });

      await connector.logout();

      expect(page.click).not.toHaveBeenCalled();
    });

    test('no-op when logout element not visible', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null); // element not found

      await connector.logout();

      expect(page.click).not.toHaveBeenCalled();
    });

    test('sets state authenticated = false', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      connector.setState('authenticated', true);
      await connector.logout();

      expect(connector.getState('authenticated')).toBe(false);
    });
  });

  describe('isAuthenticated()', () => {
    test('returns true when auth_indicator element exists', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement()); // indicator found

      const result = await connector.isAuthenticated();

      expect(result).toBe(true);
    });

    test('returns false when auth_indicator element missing', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null); // indicator not found

      const result = await connector.isAuthenticated();

      expect(result).toBe(false);
    });

    test('falls back to URL check when no auth_indicator configured', async () => {
      const { connector, page } = createConnector({
        config: { selectors: {} } // no auth_indicator
      });
      page.url.mockReturnValue('https://staging.test-app.com/dashboard');

      const result = await connector.isAuthenticated();

      expect(result).toBe(true);
      expect(page.url).toHaveBeenCalled();
    });

    test('returns false when URL contains /login', async () => {
      const { connector, page } = createConnector({
        config: { selectors: {} } // no auth_indicator
      });
      page.url.mockReturnValue('https://staging.test-app.com/login');

      const result = await connector.isAuthenticated();

      expect(result).toBe(false);
    });

    test('returns true when URL does not contain /login', async () => {
      const { connector, page } = createConnector({
        config: { selectors: {} }
      });
      page.url.mockReturnValue('https://staging.test-app.com/settings');

      const result = await connector.isAuthenticated();

      expect(result).toBe(true);
    });
  });

  describe('navigate()', () => {
    test('prepends base URL for relative paths', async () => {
      const { connector, page } = createConnector();

      await connector.navigate('/dashboard');

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/dashboard');
    });

    test('uses absolute URL as-is for http paths', async () => {
      const { connector, page } = createConnector();

      await connector.navigate('https://other-site.com/page');

      expect(page.goto).toHaveBeenCalledWith('https://other-site.com/page');
    });

    test('waits for network idle after navigation', async () => {
      const { connector, page } = createConnector();

      await connector.navigate('/test');

      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 30000 });
    });

    test('throws NavigationError on failure', async () => {
      const { connector, page } = createConnector();
      page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(connector.navigate('/test')).rejects.toThrow(NavigationError);
    });

    test('throws NavigationError when base URL not configured', async () => {
      const { connector } = createConnector({
        environments: {}
      });

      await expect(connector.navigate('/test')).rejects.toThrow(NavigationError);
      await expect(connector.navigate('/test')).rejects.toThrow('Base URL not configured');
    });
  });

  describe('waitForNavigation()', () => {
    test('waits for networkidle load state', async () => {
      const { connector, page } = createConnector();

      await connector.waitForNavigation();

      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 30000 });
    });

    test('uses provided timeout', async () => {
      const { connector, page } = createConnector();

      await connector.waitForNavigation(5000);

      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 5000 });
    });

    test('throws ConnectorTimeoutError when page does not settle', async () => {
      const { connector, page } = createConnector();
      const timeoutError = new Error('Timeout 30000ms exceeded');
      timeoutError.name = 'TimeoutError';
      page.waitForLoadState.mockRejectedValue(timeoutError);

      await expect(connector.waitForNavigation()).rejects.toThrow(ConnectorTimeoutError);
    });
  });

  describe('performAction()', () => {
    test('captures before evidence', async () => {
      const { connector, evidence } = createConnector();

      await connector.performAction('exists', { selector: '#btn' });

      const calls = evidence.collectAll.mock.calls;
      expect(calls.some(c => c[1].startsWith('before_exists_'))).toBe(true);
    });

    test('captures after evidence on success', async () => {
      const { connector, evidence } = createConnector();

      await connector.performAction('exists', { selector: '#btn' });

      const calls = evidence.collectAll.mock.calls;
      expect(calls.some(c => c[1].startsWith('after_exists_'))).toBe(true);
    });

    test('captures failure evidence on error', async () => {
      const { connector, page, evidence } = createConnector();
      page.click.mockRejectedValue(new Error('Element is not visible'));

      await expect(connector.performAction('click', { selector: '#btn' })).rejects.toThrow();

      const calls = evidence.collectAll.mock.calls;
      expect(calls.some(c => c[1].startsWith('failed_click_'))).toBe(true);
    });

    test('dispatches navigate action', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('navigate', { path: '/test' });

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/test');
    });

    test('dispatches click action', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('click', { selector: '#btn' });

      expect(page.click).toHaveBeenCalledWith('#btn');
    });

    test('dispatches type action', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('type', { selector: '#input', text: 'hello' });

      expect(page.fill).toHaveBeenCalledWith('#input', 'hello');
    });

    test('dispatches select action', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('select', { selector: '#dropdown', value: 'opt1' });

      expect(page.selectOption).toHaveBeenCalledWith('#dropdown', 'opt1');
    });

    test('dispatches wait action', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('wait', { selector: '.loading', timeout: 5000 });

      expect(page.waitForSelector).toHaveBeenCalledWith('.loading', { timeout: 5000 });
    });

    test('dispatches extract action', async () => {
      const { connector, page } = createConnector();
      const mockEl = createMockElement({ text: 'Hello' });
      page.$.mockResolvedValue(mockEl);

      const result = await connector.performAction('extract', { selector: '.title' });

      expect(result).toHaveProperty('text', 'Hello');
    });

    test('dispatches extract_multiple action', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([
        createMockElement({ text: 'Item 1' }),
        createMockElement({ text: 'Item 2' })
      ]);

      const result = await connector.performAction('extract_multiple', { selector: '.items' });

      expect(result).toEqual(['Item 1', 'Item 2']);
    });

    test('dispatches exists action', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      const result = await connector.performAction('exists', { selector: '#btn' });

      expect(result).toBe(true);
    });

    test('throws ConnectorError for unknown actions via super', async () => {
      const { connector } = createConnector();

      await expect(connector.performAction('dance', {})).rejects.toThrow(ConnectorError);
      await expect(connector.performAction('dance', {})).rejects.toThrow(
        'Action "dance" is not supported by this connector'
      );
    });

    test('re-throws error after capturing failure evidence', async () => {
      const { connector, page } = createConnector();
      page.click.mockRejectedValue(new Error('Element is not visible'));

      const error = await connector.performAction('click', { selector: '#btn' }).catch(e => e);

      expect(error).toBeInstanceOf(ElementNotFoundError);
    });
  });

  describe('click()', () => {
    test('calls page.click with selector', async () => {
      const { connector, page } = createConnector();

      await connector.click('#submit-btn');

      expect(page.click).toHaveBeenCalledWith('#submit-btn');
    });

    test('waits 500ms after click', async () => {
      const { connector, page } = createConnector();

      await connector.click('#btn');

      expect(page.waitForTimeout).toHaveBeenCalledWith(500);
    });

    test('wraps Playwright error as ElementNotFoundError', async () => {
      const { connector, page } = createConnector();
      page.click.mockRejectedValue(new Error('Element is not visible'));

      await expect(connector.click('#btn')).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('type()', () => {
    test('calls page.fill with selector and text', async () => {
      const { connector, page } = createConnector();

      await connector.type('#email', 'user@test.com');

      expect(page.fill).toHaveBeenCalledWith('#email', 'user@test.com');
    });

    test('wraps Playwright error as ElementNotFoundError', async () => {
      const { connector, page } = createConnector();
      page.fill.mockRejectedValue(new Error('no element found for selector "#email"'));

      await expect(connector.type('#email', 'test')).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('select()', () => {
    test('calls page.selectOption with selector and value', async () => {
      const { connector, page } = createConnector();

      await connector.select('#country', 'us');

      expect(page.selectOption).toHaveBeenCalledWith('#country', 'us');
    });

    test('wraps Playwright error as ElementNotFoundError', async () => {
      const { connector, page } = createConnector();
      page.selectOption.mockRejectedValue(new Error('waiting for selector "#dropdown"'));

      await expect(connector.select('#dropdown', 'value')).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('waitFor()', () => {
    test('calls page.waitForSelector with selector and timeout', async () => {
      const { connector, page } = createConnector();

      await connector.waitFor('.loaded', 10000);

      expect(page.waitForSelector).toHaveBeenCalledWith('.loaded', { timeout: 10000 });
    });

    test('uses default 30000ms timeout', async () => {
      const { connector, page } = createConnector();

      await connector.waitFor('.loaded');

      expect(page.waitForSelector).toHaveBeenCalledWith('.loaded', { timeout: 30000 });
    });

    test('wraps Playwright timeout as ConnectorTimeoutError', async () => {
      const { connector, page } = createConnector();
      const err = new Error('Timeout 30000ms exceeded waiting for selector ".loading"');
      err.name = 'TimeoutError';
      page.waitForSelector.mockRejectedValue(err);

      await expect(connector.waitFor('.loading')).rejects.toThrow(ConnectorTimeoutError);
    });
  });

  describe('extractData()', () => {
    test('returns text, value, html, attributes for found element', async () => {
      const { connector, page } = createConnector();
      const mockEl = createMockElement({
        text: 'Hello World',
        value: 'input-value',
        html: '<span>Hello</span>',
        attributes: { id: 'title', class: 'header' }
      });
      page.$.mockResolvedValue(mockEl);

      const result = await connector.extractData('.title');

      expect(result.text).toBe('Hello World');
      expect(result.value).toBe('input-value');
      expect(result.html).toBe('<span>Hello</span>');
      expect(result.attributes).toEqual({ id: 'title', class: 'header' });
    });

    test('returns null when element not found', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      const result = await connector.extractData('.missing');

      expect(result).toBeNull();
    });

    test('wraps Playwright error on evaluation failure', async () => {
      const { connector, page } = createConnector();
      const mockEl = {
        evaluate: jest.fn().mockRejectedValue(new Error('Target closed'))
      };
      page.$.mockResolvedValue(mockEl);

      await expect(connector.extractData('.broken')).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('extractMultiple()', () => {
    test('returns array of textContent for matching elements', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([
        createMockElement({ text: 'First' }),
        createMockElement({ text: 'Second' }),
        createMockElement({ text: 'Third' })
      ]);

      const result = await connector.extractMultiple('.list-item');

      expect(result).toEqual(['First', 'Second', 'Third']);
    });

    test('returns empty array when no elements match', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([]);

      const result = await connector.extractMultiple('.nonexistent');

      expect(result).toEqual([]);
    });

    test('wraps Playwright error on failure', async () => {
      const { connector, page } = createConnector();
      page.$$.mockRejectedValue(new Error('Target closed'));

      await expect(connector.extractMultiple('.items')).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('exists()', () => {
    test('returns true when element exists', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());

      const result = await connector.exists('#btn');

      expect(result).toBe(true);
    });

    test('returns false when element not found', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      const result = await connector.exists('#btn');

      expect(result).toBe(false);
    });

    test('returns false on error (never throws)', async () => {
      const { connector, page } = createConnector();
      page.$.mockRejectedValue(new Error('Page crashed'));

      const result = await connector.exists('#btn');

      expect(result).toBe(false);
    });
  });

  describe('waitForAppReady()', () => {
    test('waits for ready_indicator when configured', async () => {
      const { connector, page } = createConnector();

      await connector.waitForAppReady();

      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="app-loaded"]',
        { timeout: 30000 }
      );
    });

    test('uses navigation timeout from config', async () => {
      const { connector, page } = createConnector({
        config: {
          ready_indicator: '.app-ready',
          selectors: {},
          timeouts: { navigation: 15000 }
        }
      });

      await connector.waitForAppReady();

      expect(page.waitForSelector).toHaveBeenCalledWith('.app-ready', { timeout: 15000 });
    });

    test('no-op when ready_indicator not configured', async () => {
      const { connector, page } = createConnector({
        config: { selectors: {} }
      });

      await connector.waitForAppReady();

      expect(page.waitForSelector).not.toHaveBeenCalled();
    });
  });

  describe('_wrapPlaywrightError()', () => {
    let connector;

    beforeEach(() => {
      ({ connector } = createConnector());
    });

    test('passes through ConnectorError subclasses unchanged', () => {
      const original = new NavigationError('already wrapped');

      const result = connector._wrapPlaywrightError(original, { action: 'test' });

      expect(result).toBe(original);
    });

    test('wraps TimeoutError (by name) as ConnectorTimeoutError', () => {
      const error = new Error('Timeout 30000ms exceeded');
      error.name = 'TimeoutError';

      const result = connector._wrapPlaywrightError(error, { action: 'waitFor' });

      expect(result).toBeInstanceOf(ConnectorTimeoutError);
      expect(result.message).toContain('Timeout during waitFor');
    });

    test('wraps "Timeout" message as ConnectorTimeoutError', () => {
      const error = new Error('Timeout waiting for network idle');

      const result = connector._wrapPlaywrightError(error, { action: 'navigate' });

      expect(result).toBeInstanceOf(ConnectorTimeoutError);
    });

    test('wraps "waiting for selector" as ElementNotFoundError', () => {
      const error = new Error('waiting for selector "#btn"');

      const result = connector._wrapPlaywrightError(error, { action: 'click', selector: '#btn' });

      expect(result).toBeInstanceOf(ElementNotFoundError);
    });

    test('wraps "Element is not" as ElementNotFoundError', () => {
      const error = new Error('Element is not visible');

      const result = connector._wrapPlaywrightError(error, { action: 'click', selector: '#btn' });

      expect(result).toBeInstanceOf(ElementNotFoundError);
    });

    test('wraps "Target closed" as ElementNotFoundError', () => {
      const error = new Error('Target closed');

      const result = connector._wrapPlaywrightError(error, { action: 'click', selector: '#btn' });

      expect(result).toBeInstanceOf(ElementNotFoundError);
    });

    test('wraps "net::" as NavigationError', () => {
      const error = new Error('net::ERR_CONNECTION_REFUSED');

      const result = connector._wrapPlaywrightError(error, { action: 'navigate' });

      expect(result).toBeInstanceOf(NavigationError);
      expect(result.message).toContain('Navigation failed');
    });

    test('wraps "ERR_" as NavigationError', () => {
      const error = new Error('ERR_NAME_NOT_RESOLVED');

      const result = connector._wrapPlaywrightError(error, { action: 'navigate' });

      expect(result).toBeInstanceOf(NavigationError);
    });

    test('wraps unknown errors as ConnectorError', () => {
      const error = new Error('Something completely unexpected');

      const result = connector._wrapPlaywrightError(error, { action: 'click', selector: '#btn' });

      expect(result).toBeInstanceOf(ConnectorError);
      expect(result.message).toContain('Playwright error during click');
    });

    test('sets recoverable = true for timeout and element errors', () => {
      const timeoutErr = new Error('Timeout');
      timeoutErr.name = 'TimeoutError';
      const elementErr = new Error('Element is not visible');

      expect(connector._wrapPlaywrightError(timeoutErr).recoverable).toBe(true);
      expect(connector._wrapPlaywrightError(elementErr).recoverable).toBe(true);
    });

    test('sets recoverable = false for generic errors', () => {
      const error = new Error('Unknown internal failure');

      const result = connector._wrapPlaywrightError(error);

      expect(result.recoverable).toBe(false);
    });

    test('preserves action and selector in wrapped error', () => {
      const error = new Error('Element is not visible');

      const result = connector._wrapPlaywrightError(error, {
        action: 'click',
        selector: '#submit'
      });

      expect(result.action).toBe('click');
      expect(result.selector).toBe('#submit');
    });
  });

  describe('Inherited methods (smoke tests)', () => {
    test('getCurrentURL returns page.url()', async () => {
      const { connector, page } = createConnector();
      page.url.mockReturnValue('https://staging.test-app.com/current');

      const result = await connector.getCurrentURL();

      expect(result).toBe('https://staging.test-app.com/current');
    });

    test('takeScreenshot delegates to evidence collector', async () => {
      const { connector, evidence } = createConnector();

      const result = await connector.takeScreenshot('test_shot');

      expect(evidence.captureScreenshot).toHaveBeenCalled();
      expect(result).toBe('/evidence/screenshot.png');
    });

    test('collectEvidence delegates to evidence collector', async () => {
      const { connector, evidence } = createConnector();

      const result = await connector.collectEvidence('test_step');

      expect(evidence.collectAll).toHaveBeenCalled();
      expect(result).toHaveProperty('stepName');
    });

    test('getSelector reads from app.config.selectors', () => {
      const { connector } = createConnector();

      expect(connector.getSelector('login_email')).toBe('[name="email"]');
      expect(connector.getSelector('missing')).toBeUndefined();
    });

    test('getTimeout reads from app.config.timeouts with default', () => {
      const { connector } = createConnector();

      expect(connector.getTimeout('navigation')).toBe(30000);
      expect(connector.getTimeout('ai_response')).toBe(60000);
      expect(connector.getTimeout('unknown', 5000)).toBe(5000);
    });

    test('getBaseURL reads from app.environments', () => {
      const { connector } = createConnector();

      expect(connector.getBaseURL()).toBe('https://staging.test-app.com');
    });
  });
});
