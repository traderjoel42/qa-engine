'use strict';

const BaseConnector = require('../../connectors/base-connector');
const {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
} = require('../../connectors/errors');

// Minimal subclass to test BaseConnector (since it can't be instantiated directly)
class TestConnector extends BaseConnector {
  constructor(app, page, evidenceCollector) {
    super(app, page, evidenceCollector);
  }
}

// Mock factories
function createMockPage(overrides = {}) {
  return {
    url: jest.fn().mockReturnValue('https://staging.example.com/dashboard'),
    ...overrides
  };
}

function createMockEvidence(overrides = {}) {
  return {
    captureScreenshot: jest.fn().mockResolvedValue('/evidence/screenshot.png'),
    getConsoleLogs: jest.fn().mockResolvedValue([{ level: 'error', message: 'test', timestamp: '2026-02-11T00:00:00Z' }]),
    getNetworkRequests: jest.fn().mockResolvedValue([{ url: '/api/test', method: 'GET', status: 200, duration: 100 }]),
    collectAll: jest.fn().mockResolvedValue({
      stepName: 'test_step',
      timestamp: '2026-02-11T00:00:00Z',
      screenshot: '/evidence/test_step.png',
      consoleLogs: [],
      networkRequests: [],
      url: 'https://staging.example.com',
      pageTitle: 'Test'
    }),
    ...overrides
  };
}

function createMockApp(overrides = {}) {
  return {
    config: {
      selectors: {
        login_email: '#email',
        login_password: '#password',
        chat_input: '.chat-input'
      },
      timeouts: {
        navigation: 15000,
        ai_response: 60000
      }
    },
    environments: {
      staging: { url: 'https://staging.example.com' },
      production: { url: 'https://example.com' }
    },
    activeEnvironment: 'staging',
    ...overrides
  };
}

describe('BaseConnector', () => {

  describe('Instantiation', () => {
    test('cannot be instantiated directly — throws error', () => {
      expect(() => new BaseConnector({}, {}, {})).toThrow(
        'BaseConnector is abstract and cannot be instantiated directly'
      );
    });

    test('can be instantiated via subclass', () => {
      const connector = new TestConnector({}, {}, {});
      expect(connector).toBeInstanceOf(BaseConnector);
      expect(connector).toBeInstanceOf(TestConnector);
    });

    test('stores app, page, evidence references', () => {
      const app = createMockApp();
      const page = createMockPage();
      const evidence = createMockEvidence();
      const connector = new TestConnector(app, page, evidence);

      expect(connector.app).toBe(app);
      expect(connector.page).toBe(page);
      expect(connector.evidence).toBe(evidence);
    });

    test('initializes empty state Map', () => {
      const connector = new TestConnector({}, {}, {});
      expect(connector.state).toBeInstanceOf(Map);
      expect(connector.state.size).toBe(0);
    });

    test('_initialized starts as false', () => {
      const connector = new TestConnector({}, {}, {});
      expect(connector._initialized).toBe(false);
    });

    test('_cleanedUp starts as false', () => {
      const connector = new TestConnector({}, {}, {});
      expect(connector._cleanedUp).toBe(false);
    });
  });

  describe('Abstract Methods', () => {
    let connector;

    beforeEach(() => {
      connector = new TestConnector({}, createMockPage(), {});
    });

    test('initialize() throws ConnectorError', async () => {
      await expect(connector.initialize()).rejects.toThrow(ConnectorError);
      await expect(connector.initialize()).rejects.toThrow('Must implement initialize()');
    });

    test('cleanup() throws ConnectorError', async () => {
      await expect(connector.cleanup()).rejects.toThrow(ConnectorError);
      await expect(connector.cleanup()).rejects.toThrow('Must implement cleanup()');
    });

    test('authenticate() throws AuthenticationError', async () => {
      await expect(connector.authenticate()).rejects.toThrow(AuthenticationError);
      await expect(connector.authenticate()).rejects.toThrow('Must implement authenticate()');
    });

    test('logout() throws ConnectorError', async () => {
      await expect(connector.logout()).rejects.toThrow(ConnectorError);
      await expect(connector.logout()).rejects.toThrow('Must implement logout()');
    });

    test('isAuthenticated() throws ConnectorError', async () => {
      await expect(connector.isAuthenticated()).rejects.toThrow(ConnectorError);
      await expect(connector.isAuthenticated()).rejects.toThrow('Must implement isAuthenticated()');
    });

    test('navigate() throws NavigationError', async () => {
      await expect(connector.navigate('/test')).rejects.toThrow(NavigationError);
      await expect(connector.navigate('/test')).rejects.toThrow('Must implement navigate()');
    });

    test('waitForNavigation() throws ConnectorTimeoutError', async () => {
      await expect(connector.waitForNavigation()).rejects.toThrow(ConnectorTimeoutError);
      await expect(connector.waitForNavigation()).rejects.toThrow('Must implement waitForNavigation()');
    });

    test('performAction() throws ConnectorError with action name', async () => {
      await expect(connector.performAction('create_story')).rejects.toThrow(ConnectorError);
      await expect(connector.performAction('create_story')).rejects.toThrow(
        'Action "create_story" is not supported by this connector'
      );
    });

    test('click() throws ElementNotFoundError', async () => {
      await expect(connector.click('#btn')).rejects.toThrow(ElementNotFoundError);
      await expect(connector.click('#btn')).rejects.toThrow('Element not found: #btn');
    });

    test('type() throws ElementNotFoundError', async () => {
      await expect(connector.type('#input', 'text')).rejects.toThrow(ElementNotFoundError);
      await expect(connector.type('#input', 'text')).rejects.toThrow('Element not found: #input');
    });

    test('select() throws ElementNotFoundError', async () => {
      await expect(connector.select('#dropdown', 'option1')).rejects.toThrow(ElementNotFoundError);
      await expect(connector.select('#dropdown', 'option1')).rejects.toThrow('Element not found: #dropdown');
    });

    test('waitFor() throws ConnectorTimeoutError', async () => {
      await expect(connector.waitFor('.loading')).rejects.toThrow(ConnectorTimeoutError);
      await expect(connector.waitFor('.loading')).rejects.toThrow('Must implement waitFor()');
    });

    test('extractData() throws ElementNotFoundError', async () => {
      await expect(connector.extractData('.title')).rejects.toThrow(ElementNotFoundError);
      await expect(connector.extractData('.title')).rejects.toThrow('Element not found: .title');
    });

    test('extractMultiple() throws ConnectorError', async () => {
      await expect(connector.extractMultiple('.items')).rejects.toThrow(ConnectorError);
      await expect(connector.extractMultiple('.items')).rejects.toThrow('Must implement extractMultiple()');
    });

    test('exists() throws ConnectorError', async () => {
      await expect(connector.exists('.modal')).rejects.toThrow(ConnectorError);
      await expect(connector.exists('.modal')).rejects.toThrow('Must implement exists()');
    });
  });

  describe('Implemented Methods — getCurrentURL', () => {
    test('returns page.url() value', async () => {
      const page = createMockPage();
      const connector = new TestConnector({}, page, {});

      const url = await connector.getCurrentURL();
      expect(url).toBe('https://staging.example.com/dashboard');
      expect(page.url).toHaveBeenCalled();
    });
  });

  describe('Implemented Methods — Evidence Collection', () => {
    let connector, page, evidence;

    beforeEach(() => {
      page = createMockPage();
      evidence = createMockEvidence();
      connector = new TestConnector({}, page, evidence);
    });

    test('takeScreenshot delegates to evidence.captureScreenshot', async () => {
      const result = await connector.takeScreenshot('login_page');
      expect(evidence.captureScreenshot).toHaveBeenCalledWith(page, 'login_page');
      expect(result).toBe('/evidence/screenshot.png');
    });

    test('getLogs delegates to evidence.getConsoleLogs', async () => {
      const result = await connector.getLogs();
      expect(evidence.getConsoleLogs).toHaveBeenCalled();
      expect(result).toEqual([{ level: 'error', message: 'test', timestamp: '2026-02-11T00:00:00Z' }]);
    });

    test('getNetworkRequests delegates to evidence.getNetworkRequests', async () => {
      const result = await connector.getNetworkRequests();
      expect(evidence.getNetworkRequests).toHaveBeenCalled();
      expect(result).toEqual([{ url: '/api/test', method: 'GET', status: 200, duration: 100 }]);
    });

    test('collectEvidence delegates to evidence.collectAll with page and stepName', async () => {
      const result = await connector.collectEvidence('after_login');
      expect(evidence.collectAll).toHaveBeenCalledWith(page, 'after_login');
      expect(result).toHaveProperty('stepName', 'test_step');
      expect(result).toHaveProperty('screenshot');
      expect(result).toHaveProperty('consoleLogs');
      expect(result).toHaveProperty('networkRequests');
    });
  });

  describe('Implemented Methods — State Management', () => {
    let connector;

    beforeEach(() => {
      connector = new TestConnector({}, createMockPage(), {});
    });

    test('setState/getState round-trips values', () => {
      connector.setState('authenticated', true);
      expect(connector.getState('authenticated')).toBe(true);
    });

    test('getState returns undefined for unset keys', () => {
      expect(connector.getState('nonexistent')).toBeUndefined();
    });

    test('hasState returns true for set keys, false for unset', () => {
      connector.setState('key', 'value');
      expect(connector.hasState('key')).toBe(true);
      expect(connector.hasState('missing')).toBe(false);
    });

    test('clearState removes all entries', () => {
      connector.setState('a', 1);
      connector.setState('b', 2);
      connector.setState('c', 3);
      expect(connector.state.size).toBe(3);

      connector.clearState();
      expect(connector.state.size).toBe(0);
      expect(connector.getState('a')).toBeUndefined();
    });

    test('state supports any value type (string, object, array, null)', () => {
      connector.setState('string', 'hello');
      connector.setState('object', { key: 'value' });
      connector.setState('array', [1, 2, 3]);
      connector.setState('null', null);

      expect(connector.getState('string')).toBe('hello');
      expect(connector.getState('object')).toEqual({ key: 'value' });
      expect(connector.getState('array')).toEqual([1, 2, 3]);
      expect(connector.getState('null')).toBeNull();
    });
  });

  describe('Implemented Methods — Configuration Helpers', () => {
    test('getSelector returns selector from app config', () => {
      const connector = new TestConnector(createMockApp(), createMockPage(), {});
      expect(connector.getSelector('login_email')).toBe('#email');
      expect(connector.getSelector('chat_input')).toBe('.chat-input');
    });

    test('getSelector returns undefined for missing key', () => {
      const connector = new TestConnector(createMockApp(), createMockPage(), {});
      expect(connector.getSelector('nonexistent')).toBeUndefined();
    });

    test('getSelector returns undefined when config is missing', () => {
      const connector = new TestConnector({}, createMockPage(), {});
      expect(connector.getSelector('login_email')).toBeUndefined();
    });

    test('getTimeout returns configured value', () => {
      const connector = new TestConnector(createMockApp(), createMockPage(), {});
      expect(connector.getTimeout('navigation')).toBe(15000);
      expect(connector.getTimeout('ai_response')).toBe(60000);
    });

    test('getTimeout returns default when key not configured', () => {
      const connector = new TestConnector(createMockApp(), createMockPage(), {});
      expect(connector.getTimeout('unknown', 5000)).toBe(5000);
    });

    test('getTimeout uses 30000 when no default provided', () => {
      const connector = new TestConnector(createMockApp(), createMockPage(), {});
      expect(connector.getTimeout('unknown')).toBe(30000);
    });

    test('getBaseURL returns staging URL by default', () => {
      const app = createMockApp();
      delete app.activeEnvironment;
      const connector = new TestConnector(app, createMockPage(), {});
      expect(connector.getBaseURL()).toBe('https://staging.example.com');
    });

    test('getBaseURL uses activeEnvironment when set', () => {
      const app = createMockApp({ activeEnvironment: 'production' });
      const connector = new TestConnector(app, createMockPage(), {});
      expect(connector.getBaseURL()).toBe('https://example.com');
    });
  });

  describe('healthCheck', () => {
    test('returns healthy:true after initialization flag set', async () => {
      const connector = new TestConnector({}, createMockPage(), {});
      connector._initialized = true;

      const result = await connector.healthCheck();
      expect(result.healthy).toBe(true);
    });

    test('returns healthy:false before initialization', async () => {
      const connector = new TestConnector({}, createMockPage(), {});

      const result = await connector.healthCheck();
      expect(result.healthy).toBe(false);
    });

    test('returns healthy:false after cleanup', async () => {
      const connector = new TestConnector({}, createMockPage(), {});
      connector._initialized = true;
      connector._cleanedUp = true;

      const result = await connector.healthCheck();
      expect(result.healthy).toBe(false);
    });

    test('includes state size and URL in details', async () => {
      const connector = new TestConnector({}, createMockPage(), {});
      connector._initialized = true;
      connector.setState('key', 'value');

      const result = await connector.healthCheck();
      expect(result.details.stateSize).toBe(1);
      expect(result.details.url).toBe('https://staging.example.com/dashboard');
      expect(result.details.initialized).toBe(true);
      expect(result.details.cleanedUp).toBe(false);
    });
  });
});

describe('ConnectorError hierarchy', () => {
  test('ConnectorError has correct properties', () => {
    const error = new ConnectorError('test error', {
      action: 'click',
      selector: '#btn',
      phase: 'interact',
      recoverable: true,
      evidence: { screenshot: '/path.png' }
    });

    expect(error.name).toBe('ConnectorError');
    expect(error.message).toBe('test error');
    expect(error.action).toBe('click');
    expect(error.selector).toBe('#btn');
    expect(error.phase).toBe('interact');
    expect(error.recoverable).toBe(true);
    expect(error.evidence).toEqual({ screenshot: '/path.png' });
    expect(error).toBeInstanceOf(Error);
  });

  test('AuthenticationError sets phase to "authenticate" and recoverable to false', () => {
    const error = new AuthenticationError('login failed');
    expect(error.name).toBe('AuthenticationError');
    expect(error.phase).toBe('authenticate');
    expect(error.recoverable).toBe(false);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toBeInstanceOf(Error);
  });

  test('NavigationError sets phase to "navigate" and recoverable to true', () => {
    const error = new NavigationError('page not found');
    expect(error.name).toBe('NavigationError');
    expect(error.phase).toBe('navigate');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(ConnectorError);
  });

  test('ElementNotFoundError includes selector in message', () => {
    const error = new ElementNotFoundError('#missing-btn');
    expect(error.name).toBe('ElementNotFoundError');
    expect(error.message).toBe('Element not found: #missing-btn');
    expect(error.selector).toBe('#missing-btn');
    expect(error.phase).toBe('interact');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(ConnectorError);
  });

  test('ConnectorTimeoutError is recoverable by default', () => {
    const error = new ConnectorTimeoutError('timed out waiting');
    expect(error.name).toBe('ConnectorTimeoutError');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(ConnectorError);
  });

  test('toJSON serializes correctly', () => {
    const error = new ConnectorError('test', {
      action: 'click',
      selector: '#btn',
      phase: 'interact',
      recoverable: true,
      evidence: { screenshot: '/path.png' }
    });

    const json = error.toJSON();
    expect(json).toEqual({
      name: 'ConnectorError',
      message: 'test',
      action: 'click',
      selector: '#btn',
      phase: 'interact',
      recoverable: true,
      timestamp: expect.any(String),
      hasEvidence: true
    });
  });

  test('toJSON reports hasEvidence: false when no evidence', () => {
    const error = new ConnectorError('test');
    const json = error.toJSON();
    expect(json.hasEvidence).toBe(false);
  });

  test('all errors include timestamp', () => {
    const before = new Date().toISOString();
    const errors = [
      new ConnectorError('test'),
      new AuthenticationError('test'),
      new NavigationError('test'),
      new ElementNotFoundError('#sel'),
      new ConnectorTimeoutError('test')
    ];
    const after = new Date().toISOString();

    for (const error of errors) {
      expect(error.timestamp).toBeDefined();
      expect(error.timestamp >= before).toBe(true);
      expect(error.timestamp <= after).toBe(true);
    }
  });
});
