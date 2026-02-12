'use strict';

const ConnectorFactory = require('../../connectors/factory');
const GenericWebAppConnector = require('../../connectors/generic-web-app/connector');
const AIAppConnector = require('../../connectors/ai-chat-app/connector');
const BrainstormyConnector = require('../../connectors/brainstormy/connector');
const BaseConnector = require('../../connectors/base-connector');
const {
  ConnectorError
} = require('../../connectors/errors');
const {
  createMockPage,
  createMockAppConfig,
  createBrainstormyAppConfig
} = require('../helpers/mock-playwright');

// ===================================================================
// HELPERS
// ===================================================================

function createMockEvidence() {
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
    })
  };
}

// ===================================================================
// TESTS
// ===================================================================

describe('ConnectorFactory', () => {

  // Save original registry and restore after tests that modify it
  let originalRegistry;

  beforeEach(() => {
    originalRegistry = { ...ConnectorFactory.CONNECTOR_REGISTRY };
  });

  afterEach(() => {
    ConnectorFactory.CONNECTOR_REGISTRY = originalRegistry;
  });

  // ===================================================================
  // create()
  // ===================================================================

  describe('create()', () => {
    test('creates GenericWebAppConnector for type "generic"', async () => {
      const app = createMockAppConfig({ connector: { type: 'generic' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector).toBeInstanceOf(GenericWebAppConnector);
    });

    test('creates AIAppConnector for type "ai-chat-app"', async () => {
      const app = createMockAppConfig({ connector: { type: 'ai-chat-app' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector).toBeInstanceOf(AIAppConnector);
    });

    test('creates BrainstormyConnector for type "brainstormy"', async () => {
      const app = createBrainstormyAppConfig();
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector).toBeInstanceOf(BrainstormyConnector);
    });

    test('calls initialize() on created connector', async () => {
      const app = createMockAppConfig({ connector: { type: 'generic' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      // Mock page.$ to return element for auth_indicator check and ready_indicator wait
      page.$.mockResolvedValue({ evaluate: jest.fn().mockResolvedValue({}) });
      process.env.TEST_APP_PASSWORD = 'secret';

      try {
        const connector = await ConnectorFactory.create(app, page, evidence);

        expect(connector._initialized).toBe(true);
      } finally {
        delete process.env.TEST_APP_PASSWORD;
      }
    });

    test('skips initialize() when skipInitialize is true', async () => {
      const app = createMockAppConfig({ connector: { type: 'generic' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector._initialized).toBe(false);
    });

    test('throws ConnectorError when connector.type is missing', async () => {
      const app = createMockAppConfig(); // No connector.type
      const page = createMockPage();
      const evidence = createMockEvidence();

      await expect(
        ConnectorFactory.create(app, page, evidence)
      ).rejects.toThrow(ConnectorError);
      await expect(
        ConnectorFactory.create(app, page, evidence)
      ).rejects.toThrow('missing connector.type');
    });

    test('throws ConnectorError for unknown connector type', async () => {
      const app = createMockAppConfig({ connector: { type: 'unknown-app' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      await expect(
        ConnectorFactory.create(app, page, evidence)
      ).rejects.toThrow(ConnectorError);
      await expect(
        ConnectorFactory.create(app, page, evidence)
      ).rejects.toThrow('Unknown connector type: "unknown-app"');
    });

    test('error message lists available connector types', async () => {
      const app = createMockAppConfig({ connector: { type: 'nonexistent' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      try {
        await ConnectorFactory.create(app, page, evidence);
      } catch (error) {
        expect(error.message).toContain('generic');
        expect(error.message).toContain('ai-chat-app');
        expect(error.message).toContain('brainstormy');
      }
    });

    test('passes app, page, and evidenceCollector to constructor', async () => {
      const app = createMockAppConfig({ connector: { type: 'generic' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector.app).toBe(app);
      expect(connector.page).toBe(page);
      expect(connector.evidence).toBe(evidence);
    });
  });

  // ===================================================================
  // register()
  // ===================================================================

  describe('register()', () => {
    test('adds new connector type to registry', () => {
      class CustomConnector extends GenericWebAppConnector {}
      ConnectorFactory.register('custom', CustomConnector);

      expect(ConnectorFactory.CONNECTOR_REGISTRY['custom']).toBe(CustomConnector);
    });

    test('create() can instantiate registered type', async () => {
      class CustomConnector extends GenericWebAppConnector {}
      ConnectorFactory.register('custom', CustomConnector);

      const app = createMockAppConfig({ connector: { type: 'custom' } });
      const page = createMockPage();
      const evidence = createMockEvidence();

      const connector = await ConnectorFactory.create(app, page, evidence, { skipInitialize: true });

      expect(connector).toBeInstanceOf(CustomConnector);
    });

    test('can override existing type', () => {
      class CustomGeneric extends GenericWebAppConnector {}
      ConnectorFactory.register('generic', CustomGeneric);

      expect(ConnectorFactory.CONNECTOR_REGISTRY['generic']).toBe(CustomGeneric);
    });
  });

  // ===================================================================
  // getRegisteredTypes()
  // ===================================================================

  describe('getRegisteredTypes()', () => {
    test('returns array of registered type strings', () => {
      const types = ConnectorFactory.getRegisteredTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types.every(t => typeof t === 'string')).toBe(true);
    });

    test('includes all default types', () => {
      const types = ConnectorFactory.getRegisteredTypes();

      expect(types).toContain('generic');
      expect(types).toContain('ai-chat-app');
      expect(types).toContain('brainstormy');
    });

    test('includes dynamically registered types', () => {
      class NewConnector extends GenericWebAppConnector {}
      ConnectorFactory.register('new-type', NewConnector);

      const types = ConnectorFactory.getRegisteredTypes();

      expect(types).toContain('new-type');
    });
  });
});
