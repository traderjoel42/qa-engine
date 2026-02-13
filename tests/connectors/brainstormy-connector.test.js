'use strict';

const BrainstormyConnector = require('../../connectors/brainstormy/connector');
const AIAppConnector = require('../../connectors/ai-chat-app/connector');
const GenericWebAppConnector = require('../../connectors/generic-web-app/connector');
const BaseConnector = require('../../connectors/base-connector');
const { ConnectorError } = require('../../connectors/errors');
const {
  createMockPage,
  createMockElement,
  createMockCitationElement,
  createBrainstormyAppConfig
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
      timestamp: '2026-02-13T00:00:00Z',
      screenshots: { full: '/evidence/full.png', viewport: '/evidence/viewport.png' },
      consoleLogs: [],
      networkRequests: [],
      url: 'https://staging.brainstormy.app',
      pageTitle: 'Brainstormy',
      viewport: { width: 1280, height: 720 },
      summary: { totalLogs: 0, errorLogs: 0, warnLogs: 0, totalRequests: 0, failedRequests: 0 }
    }),
    ...overrides
  };
}

function createConnector(appOverrides = {}, pageOverrides = {}, evidenceOverrides = {}) {
  const app = createBrainstormyAppConfig(appOverrides);
  const page = createMockPage(pageOverrides);
  const evidence = createMockEvidence(evidenceOverrides);
  const connector = new BrainstormyConnector(app, page, evidence);
  return { connector, app, page, evidence };
}

/**
 * Set mock page URL (used by _extractIdFromUrl via getCurrentURL).
 */
function mockUrl(page, url) {
  page.url.mockReturnValue(url);
}

// ===================================================================
// TESTS
// ===================================================================

describe('BrainstormyConnector', () => {

  // -----------------------------------------------------------------
  // constructor
  // -----------------------------------------------------------------
  describe('constructor', () => {
    test('initializes with null project/story/session IDs', () => {
      const { connector } = createConnector();
      expect(connector.currentProjectId).toBeNull();
      expect(connector.currentStoryId).toBeNull();
      expect(connector.currentSessionId).toBeNull();
    });

    test('sets up empty createdEntities array', () => {
      const { connector } = createConnector();
      expect(connector.createdEntities).toEqual([]);
      expect(Array.isArray(connector.createdEntities)).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // initialize()
  // -----------------------------------------------------------------
  describe('initialize()', () => {
    test('navigates to staging URL', async () => {
      const { connector, page } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      expect(page.goto).toHaveBeenCalledWith(
        'https://staging.brainstormy.app',
        { waitUntil: 'networkidle' }
      );
    });

    test('calls authenticate when auth required', async () => {
      const { connector } = createConnector();
      const authSpy = jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      expect(authSpy).toHaveBeenCalled();
    });

    test('throws on auth failure', async () => {
      const { connector } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(false);
      await expect(connector.initialize()).rejects.toThrow(ConnectorError);
      await expect(connector.initialize()).rejects.toThrow('Authentication failed');
    });

    test('collects evidence for initial load and auth', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      // collectAll is called as (page, stepName) — step name at index 1
      const stepNames = evidence.collectAll.mock.calls.map(c => c[1]);
      expect(stepNames).toContain('initial_load');
      expect(stepNames).toContain('authenticated_ready');
    });

    test('waits for app ready indicator', async () => {
      const { connector, page } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      // waitForAppReady → waitFor → page.waitForSelector
      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="app-loaded"]',
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });
  });

  // -----------------------------------------------------------------
  // authenticate()
  // -----------------------------------------------------------------
  describe('authenticate()', () => {
    beforeEach(() => {
      process.env.BRAINSTORMY_TEST_PASSWORD = 'test-secret-pw';
    });

    afterEach(() => {
      delete process.env.BRAINSTORMY_TEST_PASSWORD;
    });

    test('fills Clerk email input with configured email', async () => {
      const { connector, page } = createConnector();
      await connector.authenticate();
      expect(page.fill).toHaveBeenCalledWith(
        'input[name="identifier"]',
        'testbot@brainstormy.app'
      );
    });

    test('fills Clerk password input from env var', async () => {
      const { connector, page } = createConnector();
      await connector.authenticate();
      expect(page.fill).toHaveBeenCalledWith(
        'input[name="password"]',
        'test-secret-pw'
      );
    });

    test('clicks submit and waits for user menu', async () => {
      const { connector, page } = createConnector();
      await connector.authenticate();
      expect(page.click).toHaveBeenCalledWith('button[type="submit"]');
      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="user-menu"]',
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });

    test('returns false on timeout', async () => {
      const { connector, page } = createConnector();
      page.waitForSelector.mockRejectedValueOnce(new Error('Timeout'));
      const result = await connector.authenticate();
      expect(result).toBe(false);
    });

    test('collects evidence on failure', async () => {
      const { connector, page, evidence } = createConnector();
      page.waitForSelector.mockRejectedValueOnce(new Error('Timeout'));
      await connector.authenticate();
      const stepNames = evidence.collectAll.mock.calls.map(c => c[1]);
      expect(stepNames).toContain('auth_failed');
    });
  });

  // -----------------------------------------------------------------
  // performAction()
  // -----------------------------------------------------------------
  describe('performAction()', () => {
    test('routes create_project to createProject', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createProject').mockResolvedValue({ id: 'p1' });
      await connector.performAction('create_project', { name: 'Test' });
      expect(spy).toHaveBeenCalledWith('Test');
    });

    test('routes create_story to createStory', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createStory').mockResolvedValue({ id: 's1' });
      await connector.performAction('create_story', { name: 'Ch1', vertical: 'novel' });
      expect(spy).toHaveBeenCalledWith('Ch1', 'novel');
    });

    test('routes create_session to createSession', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createSession').mockResolvedValue({ id: 'se1' });
      await connector.performAction('create_session', { type: 'explore', name: 'QA' });
      expect(spy).toHaveBeenCalledWith('explore', 'QA');
    });

    test('routes generate_bible to generateStoryBible', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'generateStoryBible').mockResolvedValue({ sections: {} });
      await connector.performAction('generate_bible', { template: 'standard' });
      expect(spy).toHaveBeenCalledWith('standard');
    });

    test('routes search to performSearch', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'performSearch').mockResolvedValue({ results: [] });
      await connector.performAction('search', { query: 'detective' });
      expect(spy).toHaveBeenCalledWith('detective');
    });

    test('routes send_message to parent AIAppConnector', async () => {
      const { connector, page } = createConnector();
      // send_message is not in brainstormyActions, so it goes to super.performAction()
      // which eventually calls sendMessage()
      await connector.performAction('send_message', { text: 'hello' });
      expect(page.fill).toHaveBeenCalledWith('[data-testid="chat-input"]', 'hello');
    });

    test('routes unknown action to parent chain', async () => {
      const { connector } = createConnector();
      // Unknown actions go to super.performAction which goes to GenericWebAppConnector
      // which throws for truly unknown actions
      await expect(connector.performAction('totally_unknown_action'))
        .rejects.toThrow();
    });

    test('collects before/after evidence for every action', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'createProject').mockResolvedValue({ id: 'p1' });
      await connector.performAction('create_project', { name: 'Test' });
      const stepNames = evidence.collectAll.mock.calls.map(c => c[1]);
      const beforeCalls = stepNames.filter(s => s.startsWith('before_create_project'));
      const afterCalls = stepNames.filter(s => s.startsWith('after_create_project'));
      expect(beforeCalls.length).toBeGreaterThanOrEqual(1);
      expect(afterCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------
  // createProject()
  // -----------------------------------------------------------------
  describe('createProject()', () => {
    test('navigates to /projects, clicks new, fills name', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/projects/abc-123');
      await connector.createProject('My Novel');
      // navigate calls page.goto with base URL + path
      expect(page.goto).toHaveBeenCalledWith('https://staging.brainstormy.app/projects');
      expect(page.click).toHaveBeenCalledWith('[data-testid="new-project-button"]');
      expect(page.fill).toHaveBeenCalledWith('[data-testid="project-name-input"]', 'My Novel');
    });

    test('extracts project ID from URL', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/projects/proj-uuid-42');
      const result = await connector.createProject('Test');
      expect(result.id).toBe('proj-uuid-42');
    });

    test('stores project ID in state', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/projects/proj-state-1');
      await connector.createProject('Test');
      expect(connector.currentProjectId).toBe('proj-state-1');
      expect(connector.getState('current_project_id')).toBe('proj-state-1');
    });

    test('tracks entity for cleanup', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/projects/proj-cleanup');
      await connector.createProject('Cleanup Test');
      expect(connector.createdEntities).toContainEqual(
        expect.objectContaining({ type: 'project', id: 'proj-cleanup', name: 'Cleanup Test' })
      );
    });
  });

  // -----------------------------------------------------------------
  // createStory()
  // -----------------------------------------------------------------
  describe('createStory()', () => {
    test('throws if no project selected', async () => {
      const { connector } = createConnector();
      await expect(connector.createStory('My Story'))
        .rejects.toThrow('No current project');
    });

    test('fills story name and vertical', async () => {
      const { connector, page } = createConnector();
      connector.currentProjectId = 'proj-1';
      mockUrl(page, 'https://staging.brainstormy.app/stories/story-1');
      // exists() calls page.$() — return truthy so vertical select is found
      page.$.mockResolvedValue(createMockElement());
      await connector.createStory('Chapter 1', 'screenplay');
      expect(page.fill).toHaveBeenCalledWith('[data-testid="story-name-input"]', 'Chapter 1');
      expect(page.selectOption).toHaveBeenCalledWith(
        '[data-testid="story-vertical-select"]',
        'screenplay'
      );
    });

    test('extracts story ID from URL', async () => {
      const { connector, page } = createConnector();
      connector.currentProjectId = 'proj-1';
      mockUrl(page, 'https://staging.brainstormy.app/stories/story-uuid-7');
      const result = await connector.createStory('Test Story');
      expect(result.id).toBe('story-uuid-7');
      expect(connector.currentStoryId).toBe('story-uuid-7');
    });
  });

  // -----------------------------------------------------------------
  // createSession()
  // -----------------------------------------------------------------
  describe('createSession()', () => {
    test('throws if no story selected', async () => {
      const { connector } = createConnector();
      await expect(connector.createSession('explore'))
        .rejects.toThrow('No current story');
    });

    test('selects session type', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      mockUrl(page, 'https://staging.brainstormy.app/sessions/sess-1');
      page.$.mockResolvedValue(createMockElement());
      await connector.createSession('brainstorm');
      expect(page.selectOption).toHaveBeenCalledWith(
        '[data-testid="session-type-select"]',
        'brainstorm'
      );
    });

    test('extracts session ID from URL', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      mockUrl(page, 'https://staging.brainstormy.app/sessions/sess-uuid-3');
      page.$.mockResolvedValue(createMockElement());
      const result = await connector.createSession('explore');
      expect(result.id).toBe('sess-uuid-3');
      expect(connector.currentSessionId).toBe('sess-uuid-3');
    });
  });

  // -----------------------------------------------------------------
  // generateStoryBible()
  // -----------------------------------------------------------------
  describe('generateStoryBible()', () => {
    function setupBibleMocks(page) {
      page.$.mockResolvedValue(createMockElement()); // exists() truthy
      page.$$.mockResolvedValue([
        {
          $eval: jest.fn()
            .mockResolvedValueOnce('Characters')
            .mockResolvedValueOnce('Main character details...')
        },
        {
          $eval: jest.fn()
            .mockResolvedValueOnce('World Building')
            .mockResolvedValueOnce('Fantasy world with...')
        }
      ]);
    }

    test('selects template and clicks generate', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      setupBibleMocks(page);
      await connector.generateStoryBible('detailed');
      expect(page.click).toHaveBeenCalledWith('[data-testid="bible-tab"]');
      expect(page.click).toHaveBeenCalledWith('[data-testid="bible-generate"]');
    });

    test('waits for generation indicator to disappear', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      setupBibleMocks(page);
      await connector.generateStoryBible('standard');
      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="bible-generating"]',
        expect.objectContaining({ state: 'hidden' })
      );
    });

    test('extracts sections from page', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      setupBibleMocks(page);
      const result = await connector.generateStoryBible('standard');
      expect(result.sections).toHaveProperty('characters');
      expect(result.sections).toHaveProperty('world_building');
    });

    test('returns section count', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      setupBibleMocks(page);
      const result = await connector.generateStoryBible('standard');
      expect(result.section_count).toBe(2);
      expect(result.template).toBe('standard');
    });
  });

  // -----------------------------------------------------------------
  // performSearch()
  // -----------------------------------------------------------------
  describe('performSearch()', () => {
    function setupSearchMocks(page) {
      page.$.mockResolvedValue(createMockElement()); // exists() truthy
      page.$$.mockResolvedValue([
        {
          textContent: jest.fn().mockResolvedValue('Found result 1'),
          getAttribute: jest.fn().mockResolvedValue('message')
        },
        {
          textContent: jest.fn().mockResolvedValue('Found result 2'),
          getAttribute: jest.fn().mockResolvedValue('bible')
        }
      ]);
    }

    test('fills search input and submits', async () => {
      const { connector, page } = createConnector();
      setupSearchMocks(page);
      await connector.performSearch('detective');
      expect(page.fill).toHaveBeenCalledWith('[data-testid="search-input"]', 'detective');
      expect(page.click).toHaveBeenCalledWith('[data-testid="search-submit"]');
    });

    test('extracts result items', async () => {
      const { connector, page } = createConnector();
      setupSearchMocks(page);
      const result = await connector.performSearch('detective');
      expect(result.results.length).toBe(2);
      expect(result.results[0].text).toBe('Found result 1');
      expect(result.results[1].source).toBe('bible');
    });

    test('returns count', async () => {
      const { connector, page } = createConnector();
      setupSearchMocks(page);
      const result = await connector.performSearch('detective');
      expect(result.count).toBe(2);
      expect(result.query).toBe('detective');
    });
  });

  // -----------------------------------------------------------------
  // cleanup()
  // -----------------------------------------------------------------
  describe('cleanup()', () => {
    test('logs created entities', async () => {
      const { connector } = createConnector();
      connector.createdEntities = [{ type: 'project', id: 'p1', name: 'Test' }];
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      await connector.cleanup();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created entities'),
        expect.stringContaining('p1')
      );
      logSpy.mockRestore();
    });

    test('calls parent cleanup (logout)', async () => {
      const { connector } = createConnector();
      const superCleanup = jest.spyOn(
        Object.getPrototypeOf(BrainstormyConnector.prototype),
        'cleanup'
      ).mockResolvedValue();
      await connector.cleanup();
      expect(superCleanup).toHaveBeenCalled();
      superCleanup.mockRestore();
    });
  });
});
