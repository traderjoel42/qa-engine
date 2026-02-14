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
    test('navigates to base URL after auth', async () => {
      const { connector, page } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      expect(page.goto).toHaveBeenCalledWith(
        'https://staging.brainstormy.app',
        { waitUntil: 'domcontentloaded', timeout: 120000 }
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
      // initial_load is collected inside authenticate() which is mocked here
      const stepNames = evidence.collectAll.mock.calls.map(c => c[1]);
      expect(stepNames).toContain('authenticated_ready');
    });

    test('waits for app ready indicator', async () => {
      const { connector, page } = createConnector();
      jest.spyOn(connector, 'authenticate').mockResolvedValue(true);
      await connector.initialize();
      // waitForAppReady → waitFor → page.waitForSelector
      expect(page.waitForSelector).toHaveBeenCalledWith(
        '#root',
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });
  });

  // -----------------------------------------------------------------
  // authenticate()
  // -----------------------------------------------------------------
  describe('authenticate()', () => {
    beforeEach(() => {
      process.env.CLERK_SECRET_KEY = 'sk_test_fake_key';
    });

    afterEach(() => {
      delete process.env.CLERK_SECRET_KEY;
    });

    test('throws if CLERK_SECRET_KEY is missing', async () => {
      delete process.env.CLERK_SECRET_KEY;
      const { connector } = createConnector();
      const result = await connector.authenticate();
      expect(result).toBe(false);
    });

    test('calls Clerk API to look up user by email', async () => {
      const { connector } = createConnector();
      const apiSpy = jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify([{ id: 'user_test123' }])
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify({ url: 'https://accounts.clerk.dev/sign-in/ticket?token=abc' })
        });

      await connector.authenticate();

      expect(apiSpy.mock.calls[0][0]).toBe('GET');
      expect(apiSpy.mock.calls[0][1]).toContain('/v1/users');
      expect(apiSpy.mock.calls[0][1]).toContain('testbot%40brainstormy.app');
    });

    test('creates sign-in token with user ID', async () => {
      const { connector } = createConnector();
      const apiSpy = jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify([{ id: 'user_test123' }])
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify({ url: 'https://accounts.clerk.dev/sign-in/ticket?token=abc' })
        });

      await connector.authenticate();

      expect(apiSpy.mock.calls[1][0]).toBe('POST');
      expect(apiSpy.mock.calls[1][1]).toBe('/v1/sign_in_tokens');
      const tokenBody = JSON.parse(apiSpy.mock.calls[1][2]);
      expect(tokenBody.user_id).toBe('user_test123');
      expect(tokenBody.redirect_url).toBeDefined();
    });

    test('navigates to sign-in token URL', async () => {
      const { connector, page } = createConnector();
      jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify([{ id: 'user_test123' }])
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify({ url: 'https://accounts.clerk.dev/sign-in/ticket?token=abc' })
        });

      await connector.authenticate();

      expect(page.goto).toHaveBeenCalledWith(
        'https://accounts.clerk.dev/sign-in/ticket?token=abc',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    test('returns true on successful auth', async () => {
      const { connector } = createConnector();
      jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify([{ id: 'user_test123' }])
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          body: JSON.stringify({ url: 'https://accounts.clerk.dev/sign-in/ticket?token=abc' })
        });

      const result = await connector.authenticate();
      expect(result).toBe(true);
    });

    test('returns false when Clerk API fails', async () => {
      const { connector } = createConnector();
      jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({ ok: false, status: 401, body: 'Unauthorized' });

      const result = await connector.authenticate();
      expect(result).toBe(false);
    });

    test('collects evidence on failure', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, '_clerkApiRequest')
        .mockResolvedValueOnce({ ok: false, status: 401, body: 'Unauthorized' });

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
    test('opens modal, fills name, clicks next, skips navigator', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/chat/abc12345-1234-1234-1234-123456789012');
      await connector.createProject('My Novel');
      // Should click new project button, fill name, click submit
      expect(page.click).toHaveBeenCalled();
      expect(page.fill).toHaveBeenCalledWith(expect.any(String), 'My Novel');
    });

    test('extracts session ID from /chat/ URL', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/chat/abc12345-1234-1234-1234-123456789012');
      const result = await connector.createProject('Test');
      expect(result.id).toBe('abc12345-1234-1234-1234-123456789012');
    });

    test('stores project/story/session IDs in state', async () => {
      const { connector, page } = createConnector();
      const uuid = 'abc12345-1234-1234-1234-123456789012';
      mockUrl(page, `https://staging.brainstormy.app/chat/${uuid}`);
      await connector.createProject('Test');
      expect(connector.currentProjectId).toBe(uuid);
      expect(connector.currentStoryId).toBe(uuid);
      expect(connector.currentSessionId).toBe(uuid);
      expect(connector.getState('current_project_id')).toBe(uuid);
      expect(connector.getState('current_story_id')).toBe(uuid);
      expect(connector.getState('current_session_id')).toBe(uuid);
    });

    test('tracks entity for cleanup', async () => {
      const { connector, page } = createConnector();
      const uuid = 'abc12345-1234-1234-1234-123456789012';
      mockUrl(page, `https://staging.brainstormy.app/chat/${uuid}`);
      await connector.createProject('Cleanup Test');
      expect(connector.createdEntities).toContainEqual(
        expect.objectContaining({ type: 'project', id: uuid, name: 'Cleanup Test' })
      );
    });
  });

  // -----------------------------------------------------------------
  // createStory()
  // -----------------------------------------------------------------
  describe('createStory()', () => {
    test('returns existing story ID if already set from project creation', async () => {
      const { connector } = createConnector();
      connector.currentStoryId = 'story-from-project';
      const result = await connector.createStory('My Story', 'novel');
      expect(result.id).toBe('story-from-project');
      expect(result.name).toBe('My Story');
      expect(result.vertical).toBe('novel');
    });

    test('creates project if no project or story exists', async () => {
      const { connector, page } = createConnector();
      const uuid = 'abc12345-1234-1234-1234-123456789012';
      mockUrl(page, `https://staging.brainstormy.app/chat/${uuid}`);
      const result = await connector.createStory('New Story');
      expect(result.id).toBe(uuid);
    });

    test('throws if project exists but no story ID', async () => {
      const { connector } = createConnector();
      connector.currentProjectId = 'proj-1';
      // No storyId set
      await expect(connector.createStory('Test'))
        .rejects.toThrow('unexpected state');
    });
  });

  // -----------------------------------------------------------------
  // createSession()
  // -----------------------------------------------------------------
  describe('createSession()', () => {
    test('returns existing session ID if already set from project creation', async () => {
      const { connector } = createConnector();
      connector.currentSessionId = 'sess-from-project';
      const result = await connector.createSession('explore');
      expect(result.id).toBe('sess-from-project');
      expect(result.type).toBe('explore');
    });

    test('extracts session ID from /chat/ URL if on session page', async () => {
      const { connector, page } = createConnector();
      connector.currentStoryId = 'story-1';
      const uuid = 'abc12345-1234-1234-1234-123456789012';
      mockUrl(page, `https://staging.brainstormy.app/chat/${uuid}`);
      const result = await connector.createSession('explore');
      expect(result.id).toBe(uuid);
      expect(connector.currentSessionId).toBe(uuid);
    });

    test('throws if no story and no session available', async () => {
      const { connector, page } = createConnector();
      mockUrl(page, 'https://staging.brainstormy.app/');
      await expect(connector.createSession('explore'))
        .rejects.toThrow('No current story');
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
