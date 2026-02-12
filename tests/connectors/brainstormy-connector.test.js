'use strict';

const BrainstormyConnector = require('../../connectors/brainstormy/connector');
const AIAppConnector = require('../../connectors/ai-chat-app/connector');
const GenericWebAppConnector = require('../../connectors/generic-web-app/connector');
const BaseConnector = require('../../connectors/base-connector');
const {
  ConnectorError
} = require('../../connectors/errors');
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
  const app = createBrainstormyAppConfig(appOverrides);
  const page = createMockPage(pageOverrides);
  const evidence = createMockEvidence(evidenceOverrides);
  const connector = new BrainstormyConnector(app, page, evidence);
  return { connector, app, page, evidence };
}

/**
 * Set up mock page URL to contain an entity ID for extraction.
 */
function mockUrlWithId(page, url) {
  page.url.mockReturnValue(url);
}

// ===================================================================
// TESTS
// ===================================================================

describe('BrainstormyConnector', () => {

  // ===================================================================
  // Constructor / Instantiation
  // ===================================================================

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(BrainstormyConnector);
    });

    test('inherits from AIAppConnector', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(AIAppConnector);
    });

    test('inherits from GenericWebAppConnector', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(GenericWebAppConnector);
    });

    test('inherits from BaseConnector', () => {
      const { connector } = createConnector();
      expect(connector).toBeInstanceOf(BaseConnector);
    });
  });

  // ===================================================================
  // performAction — Brainstormy action dispatch
  // ===================================================================

  describe('performAction() — Brainstormy action dispatch', () => {
    test('dispatches create_project to createProject()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createProject').mockResolvedValue({ id: 'p1', name: 'Test', timestamp: 'ts' });

      await connector.performAction('create_project', { name: 'Test' });
      expect(spy).toHaveBeenCalledWith('Test');
    });

    test('dispatches create_story to createStory()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createStory').mockResolvedValue({ id: 's1', name: 'Story', vertical: 'novel', timestamp: 'ts' });

      await connector.performAction('create_story', { name: 'Story', vertical: 'novel' });
      expect(spy).toHaveBeenCalledWith('Story', 'novel');
    });

    test('dispatches create_session to createSession()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'createSession').mockResolvedValue({ id: 'se1', type: 'explore', timestamp: 'ts' });

      await connector.performAction('create_session', { type: 'explore' });
      expect(spy).toHaveBeenCalledWith('explore');
    });

    test('dispatches navigate_to_story to navigateToStory()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'navigateToStory').mockResolvedValue(undefined);

      await connector.performAction('navigate_to_story', { story_id: 'abc-123' });
      expect(spy).toHaveBeenCalledWith('abc-123');
    });

    test('dispatches generate_bible to generateStoryBible()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'generateStoryBible').mockResolvedValue({ template: 'standard', content: '', timestamp: 'ts' });

      await connector.performAction('generate_bible', { template: 'standard' });
      expect(spy).toHaveBeenCalledWith('standard');
    });

    test('dispatches get_session_summary to getSessionSummary()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'getSessionSummary').mockResolvedValue({ session_id: 'se1', summary: '', timestamp: 'ts' });

      await connector.performAction('get_session_summary', { session_id: 'se1' });
      expect(spy).toHaveBeenCalledWith('se1');
    });

    test('delegates send_message to super (AIAppConnector)', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'sendMessage').mockResolvedValue({ text: 'hi', timestamp: 'ts', messageIndex: 0 });

      await connector.performAction('send_message', { text: 'hi' });
      expect(spy).toHaveBeenCalledWith('hi');
    });

    test('delegates click to super (GenericWebAppConnector)', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('click', { selector: '#btn' });
      expect(page.click).toHaveBeenCalledWith('#btn');
    });

    test('delegates unknown action to super chain', async () => {
      const { connector } = createConnector();

      await expect(connector.performAction('unknown_action')).rejects.toThrow('not supported');
    });

    test('captures before evidence for Brainstormy actions', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'createProject').mockResolvedValue({ id: 'p1', name: 'Test', timestamp: 'ts' });

      await connector.performAction('create_project', { name: 'Test' });

      const calls = evidence.collectAll.mock.calls;
      expect(calls[0][1]).toMatch(/^before_create_project_/);
    });

    test('captures after evidence on success', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'createProject').mockResolvedValue({ id: 'p1', name: 'Test', timestamp: 'ts' });

      await connector.performAction('create_project', { name: 'Test' });

      const calls = evidence.collectAll.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toMatch(/^after_create_project_/);
    });

    test('captures failure evidence on error', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'createProject').mockRejectedValue(new ConnectorError('fail'));

      await expect(connector.performAction('create_project', { name: 'Test' })).rejects.toThrow('fail');

      const calls = evidence.collectAll.mock.calls;
      const failCall = calls.find(c => c[1].startsWith('failed_'));
      expect(failCall).toBeDefined();
      expect(failCall[1]).toMatch(/^failed_create_project_/);
    });
  });

  // ===================================================================
  // createProject
  // ===================================================================

  describe('createProject()', () => {
    test('navigates to /projects', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/abc-12345678');

      await connector.createProject('Test Project');

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/projects');
    });

    test('clicks new_project_button selector', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/abc-12345678');

      await connector.createProject('Test Project');

      expect(page.click).toHaveBeenCalledWith('[data-testid="new-project-button"]');
    });

    test('types name into project_name_input selector', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/abc-12345678');

      await connector.createProject('My Novel');

      expect(page.fill).toHaveBeenCalledWith('[data-testid="project-name-input"]', 'My Novel');
    });

    test('clicks create_project_submit selector', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/abc-12345678');

      await connector.createProject('Test');

      expect(page.click).toHaveBeenCalledWith('[data-testid="create-project-button"]');
    });

    test('waits for navigation after submit', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/abc-12345678');

      await connector.createProject('Test');

      // waitForNavigation calls waitForLoadState('networkidle')
      expect(page.waitForLoadState).toHaveBeenCalled();
    });

    test('extracts project ID from URL', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/proj-uuid-1234');

      const result = await connector.createProject('Test');

      expect(result.id).toBe('proj-uuid-1234');
    });

    test('stores current_project_id in state', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/proj-uuid-1234');

      await connector.createProject('Test');

      expect(connector.getState('current_project_id')).toBe('proj-uuid-1234');
    });

    test('returns id, name, and timestamp', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/projects/proj-uuid-1234');

      const result = await connector.createProject('My Project');

      expect(result.id).toBe('proj-uuid-1234');
      expect(result.name).toBe('My Project');
      expect(result.timestamp).toBeDefined();
    });

    test('throws ConnectorError when ID cannot be extracted', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://staging.test-app.com/dashboard');

      await expect(connector.createProject('Test')).rejects.toThrow(ConnectorError);
      await expect(connector.createProject('Test')).rejects.toThrow('Failed to extract project ID');
    });
  });

  // ===================================================================
  // createStory
  // ===================================================================

  describe('createStory()', () => {
    test('requires current_project_id in state', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/projects/proj-1/stories/story-uuid');

      const result = await connector.createStory('Chapter 1', 'novel');
      expect(result.id).toBe('story-uuid');
    });

    test('throws ConnectorError when no current project', async () => {
      const { connector } = createConnector();

      await expect(connector.createStory('Story', 'novel')).rejects.toThrow(ConnectorError);
      await expect(connector.createStory('Story', 'novel')).rejects.toThrow('No current project');
    });

    test('clicks new_story_button selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-uuid');

      await connector.createStory('Chapter 1', 'novel');

      expect(page.click).toHaveBeenCalledWith('[data-testid="new-story-button"]');
    });

    test('types name into story_name_input selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-uuid');

      await connector.createStory('My Story', 'novel');

      expect(page.fill).toHaveBeenCalledWith('[data-testid="story-name-input"]', 'My Story');
    });

    test('selects vertical in story_vertical_select', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-uuid');

      await connector.createStory('My Story', 'screenplay');

      expect(page.selectOption).toHaveBeenCalledWith('[data-testid="story-vertical-select"]', 'screenplay');
    });

    test('clicks create_story_submit selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-uuid');

      await connector.createStory('My Story', 'novel');

      expect(page.click).toHaveBeenCalledWith('[data-testid="create-story-button"]');
    });

    test('extracts story ID from URL', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-abc-789');

      const result = await connector.createStory('My Story', 'novel');

      expect(result.id).toBe('story-abc-789');
    });

    test('stores current_story_id in state', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-abc-789');

      await connector.createStory('My Story', 'novel');

      expect(connector.getState('current_story_id')).toBe('story-abc-789');
    });

    test('returns id, name, vertical, and timestamp', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_project_id', 'proj-1');
      mockUrlWithId(page, 'https://staging.test-app.com/stories/story-uuid');

      const result = await connector.createStory('My Story', 'novel');

      expect(result.id).toBe('story-uuid');
      expect(result.name).toBe('My Story');
      expect(result.vertical).toBe('novel');
      expect(result.timestamp).toBeDefined();
    });
  });

  // ===================================================================
  // createSession
  // ===================================================================

  describe('createSession()', () => {
    test('requires current_story_id in state', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      page.$.mockResolvedValue(createMockElement());

      const result = await connector.createSession('explore');
      expect(result.id).toBe('sess-uuid');
    });

    test('throws ConnectorError when no current story', async () => {
      const { connector } = createConnector();

      await expect(connector.createSession('explore')).rejects.toThrow(ConnectorError);
      await expect(connector.createSession('explore')).rejects.toThrow('No current story');
    });

    test('clicks new_session_button selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      page.$.mockResolvedValue(createMockElement());

      await connector.createSession('explore');

      expect(page.click).toHaveBeenCalledWith('[data-testid="new-session-button"]');
    });

    test('selects type when provided and selector exists', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      page.$.mockResolvedValue(createMockElement());

      await connector.createSession('explore');

      expect(page.selectOption).toHaveBeenCalledWith('[data-testid="session-type-select"]', 'explore');
    });

    test('skips type selection when not provided', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      page.$.mockResolvedValue(createMockElement());

      await connector.createSession();

      expect(page.selectOption).not.toHaveBeenCalledWith(
        '[data-testid="session-type-select"]',
        expect.anything()
      );
    });

    test('clicks create_session_submit when it exists', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      // exists() calls page.$() — return element so submit button "exists"
      page.$.mockResolvedValue(createMockElement());

      await connector.createSession('explore');

      expect(page.click).toHaveBeenCalledWith('[data-testid="create-session-button"]');
    });

    test('skips submit click when button not in DOM', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      // exists() calls page.$() — return null so button doesn't exist
      page.$.mockResolvedValue(null);

      await connector.createSession('explore');

      // Click is still called for new_session_button, but NOT for create_session_submit
      const clickCalls = page.click.mock.calls.map(c => c[0]);
      expect(clickCalls).toContain('[data-testid="new-session-button"]');
      expect(clickCalls).not.toContain('[data-testid="create-session-button"]');
    });

    test('extracts session ID from URL', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-abc-123');
      page.$.mockResolvedValue(createMockElement());

      const result = await connector.createSession();

      expect(result.id).toBe('sess-abc-123');
    });

    test('stores current_session_id in state', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-abc-123');
      page.$.mockResolvedValue(createMockElement());

      await connector.createSession();

      expect(connector.getState('current_session_id')).toBe('sess-abc-123');
    });

    test('returns id, type, and timestamp', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      mockUrlWithId(page, 'https://staging.test-app.com/sessions/sess-uuid');
      page.$.mockResolvedValue(createMockElement());

      const result = await connector.createSession('develop');

      expect(result.id).toBe('sess-uuid');
      expect(result.type).toBe('develop');
      expect(result.timestamp).toBeDefined();
    });
  });

  // ===================================================================
  // navigateToStory
  // ===================================================================

  describe('navigateToStory()', () => {
    test('navigates to /stories/{storyId}', async () => {
      const { connector, page } = createConnector();

      await connector.navigateToStory('story-uuid-456');

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/stories/story-uuid-456');
    });

    test('stores storyId in current_story_id state', async () => {
      const { connector } = createConnector();

      await connector.navigateToStory('story-uuid-456');

      expect(connector.getState('current_story_id')).toBe('story-uuid-456');
    });
  });

  // ===================================================================
  // generateStoryBible
  // ===================================================================

  describe('generateStoryBible()', () => {
    test('requires current_story_id in state', async () => {
      const { connector } = createConnector();

      await expect(connector.generateStoryBible()).rejects.toThrow(ConnectorError);
      await expect(connector.generateStoryBible()).rejects.toThrow('No current story');
    });

    test('clicks story_bible_button selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Bible content here' }));

      await connector.generateStoryBible();

      expect(page.click).toHaveBeenCalledWith('[data-testid="story-bible-button"]');
    });

    test('clicks template selector using prefix + template key', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Content' }));

      await connector.generateStoryBible('detailed');

      expect(page.click).toHaveBeenCalledWith('[data-testid="template-detailed"]');
    });

    test('clicks generate_bible_button selector', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Content' }));

      await connector.generateStoryBible();

      expect(page.click).toHaveBeenCalledWith('[data-testid="generate-bible-button"]');
    });

    test('waits for bible_content with bible_generation timeout', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Content' }));

      await connector.generateStoryBible();

      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="bible-content"]',
        { timeout: 120000 }
      );
    });

    test('extracts content text from bible_content element', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'The story bible content' }));

      const result = await connector.generateStoryBible();

      expect(result.content).toBe('The story bible content');
    });

    test('defaults to "standard" template', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Content' }));

      const result = await connector.generateStoryBible();

      expect(result.template).toBe('standard');
      expect(page.click).toHaveBeenCalledWith('[data-testid="template-standard"]');
    });

    test('returns template, content, and timestamp', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(createMockElement({ text: 'Content' }));

      const result = await connector.generateStoryBible('custom');

      expect(result.template).toBe('custom');
      expect(result.content).toBe('Content');
      expect(result.timestamp).toBeDefined();
    });

    test('returns empty content when extractData returns null', async () => {
      const { connector, page } = createConnector();
      connector.setState('current_story_id', 'story-1');
      page.$.mockResolvedValue(null);

      const result = await connector.generateStoryBible();

      expect(result.content).toBe('');
    });
  });

  // ===================================================================
  // getSessionSummary
  // ===================================================================

  describe('getSessionSummary()', () => {
    test('navigates to /sessions/{sessionId}', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement({ text: 'Summary text' }));

      await connector.getSessionSummary('sess-uuid-789');

      expect(page.goto).toHaveBeenCalledWith('https://staging.test-app.com/sessions/sess-uuid-789');
    });

    test('clicks session_summary_button selector', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement({ text: 'Summary' }));

      await connector.getSessionSummary('sess-1');

      expect(page.click).toHaveBeenCalledWith('[data-testid="session-summary-button"]');
    });

    test('waits for summary_content element', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement({ text: 'Summary' }));

      await connector.getSessionSummary('sess-1');

      expect(page.waitForSelector).toHaveBeenCalledWith(
        '[data-testid="summary-content"]',
        expect.any(Object)
      );
    });

    test('extracts summary text', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement({ text: 'The session summary text' }));

      const result = await connector.getSessionSummary('sess-1');

      expect(result.summary).toBe('The session summary text');
    });

    test('returns session_id, summary, and timestamp', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement({ text: 'Summary here' }));

      const result = await connector.getSessionSummary('sess-abc');

      expect(result.session_id).toBe('sess-abc');
      expect(result.summary).toBe('Summary here');
      expect(result.timestamp).toBeDefined();
    });

    test('returns empty summary when extractData returns null', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      const result = await connector.getSessionSummary('sess-1');

      expect(result.summary).toBe('');
    });
  });

  // ===================================================================
  // waitForAIResponse — override
  // ===================================================================

  describe('waitForAIResponse() — override', () => {
    function setupWaitForResponseMocks(page, responseText = 'AI response', citationElements = []) {
      let callCount = 0;
      page.$$.mockImplementation(async (selector) => {
        if (selector === '[data-citation-id]') {
          return citationElements;
        }
        // ai_message selector
        callCount++;
        if (callCount <= 1) return [];
        return [createMockElement({ text: responseText, html: `<p>${responseText}</p>` })];
      });
      page.$.mockResolvedValue(null); // generating_indicator not found
    }

    test('calls super.waitForAIResponse()', async () => {
      const { connector, page } = createConnector();
      setupWaitForResponseMocks(page);

      const result = await connector.waitForAIResponse();

      expect(result.text).toBe('AI response');
    });

    test('extracts citations after getting response', async () => {
      const { connector, page } = createConnector();
      const citations = [
        createMockCitationElement('cit-1', 'First citation'),
        createMockCitationElement('cit-2', 'Second citation')
      ];
      setupWaitForResponseMocks(page, 'Response text', citations);

      const result = await connector.waitForAIResponse();

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].id).toBe('cit-1');
      expect(result.citations[0].text).toBe('First citation');
    });

    test('returns response with citations array appended', async () => {
      const { connector, page } = createConnector();
      setupWaitForResponseMocks(page, 'Some response');

      const result = await connector.waitForAIResponse();

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('messageIndex');
      expect(result).toHaveProperty('citations');
    });

    test('returns empty citations when no citation elements found', async () => {
      const { connector, page } = createConnector();
      setupWaitForResponseMocks(page, 'Response', []);

      const result = await connector.waitForAIResponse();

      expect(result.citations).toEqual([]);
    });

    test('returns empty citations when extraction fails', async () => {
      const { connector, page } = createConnector();
      let callCount = 0;
      page.$$.mockImplementation(async (selector) => {
        if (selector === '[data-citation-id]') {
          throw new Error('DOM error');
        }
        callCount++;
        if (callCount <= 1) return [];
        return [createMockElement({ text: 'Response', html: '<p>Response</p>' })];
      });
      page.$.mockResolvedValue(null);

      const result = await connector.waitForAIResponse();

      expect(result.citations).toEqual([]);
    });
  });

  // ===================================================================
  // extractCitations
  // ===================================================================

  describe('extractCitations()', () => {
    test('queries elements matching citation_element selector', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([]);

      await connector.extractCitations();

      expect(page.$$).toHaveBeenCalledWith('[data-citation-id]');
    });

    test('extracts id from data-citation-id attribute', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([createMockCitationElement('cit-42', 'Some text')]);

      const result = await connector.extractCitations();

      expect(result[0].id).toBe('cit-42');
    });

    test('extracts text via textContent', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([createMockCitationElement('cit-1', 'Citation text here')]);

      const result = await connector.extractCitations();

      expect(result[0].text).toBe('Citation text here');
    });

    test('returns array of {id, text} objects', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([
        createMockCitationElement('c1', 'First'),
        createMockCitationElement('c2', 'Second'),
        createMockCitationElement('c3', 'Third')
      ]);

      const result = await connector.extractCitations();

      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { id: 'c1', text: 'First' },
        { id: 'c2', text: 'Second' },
        { id: 'c3', text: 'Third' }
      ]);
    });

    test('returns empty array when no citation selector configured', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {
            // No citation_element configured
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]'
          },
          timeouts: {}
        }
      });

      const result = await connector.extractCitations();

      expect(result).toEqual([]);
    });

    test('returns empty array when no citation elements found', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([]);

      const result = await connector.extractCitations();

      expect(result).toEqual([]);
    });

    test('returns empty array on error (never throws)', async () => {
      const { connector, page } = createConnector();
      page.$$.mockRejectedValue(new Error('Page crashed'));

      const result = await connector.extractCitations();

      expect(result).toEqual([]);
    });
  });

  // ===================================================================
  // _extractIdFromUrl
  // ===================================================================

  describe('_extractIdFromUrl()', () => {
    test('uses url_patterns from config when available', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://app.com/projects/my-project-id');

      const id = await connector._extractIdFromUrl('project_id');

      expect(id).toBe('my-project-id');
    });

    test('falls back to generic UUID pattern when no config', async () => {
      const { connector, page } = createConnector({
        config: {
          selectors: {},
          timeouts: {}
          // no url_patterns
        }
      });
      mockUrlWithId(page, 'https://app.com/entities/a1b2c3d4-e5f6-7890-abcd-ef1234567890');

      const id = await connector._extractIdFromUrl('project_id');

      expect(id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    test('returns null when pattern does not match', async () => {
      const { connector, page } = createConnector();
      mockUrlWithId(page, 'https://app.com/dashboard');

      const id = await connector._extractIdFromUrl('project_id');

      expect(id).toBeNull();
    });

    test('handles RegExp patterns', async () => {
      const { connector, page } = createConnector({
        config: {
          selectors: {},
          timeouts: {},
          url_patterns: {
            project_id: /projects\/([a-zA-Z0-9-]+)/
          }
        }
      });
      mockUrlWithId(page, 'https://app.com/projects/regex-matched-id');

      const id = await connector._extractIdFromUrl('project_id');

      expect(id).toBe('regex-matched-id');
    });

    test('handles string patterns (converted to RegExp)', async () => {
      const { connector, page } = createConnector();
      // Default config has string patterns
      mockUrlWithId(page, 'https://app.com/stories/string-pattern-id');

      const id = await connector._extractIdFromUrl('story_id');

      expect(id).toBe('string-pattern-id');
    });
  });

  // ===================================================================
  // Inherited behavior (smoke tests)
  // ===================================================================

  describe('Inherited behavior (smoke tests)', () => {
    test('sendMessage works through AIAppConnector', async () => {
      const { connector, page } = createConnector();

      const result = await connector.sendMessage('Hello from Brainstormy');

      expect(result.text).toBe('Hello from Brainstormy');
      expect(page.fill).toHaveBeenCalledWith('[data-testid="chat-input"]', 'Hello from Brainstormy');
    });

    test('validateMemory works through AIAppConnector', async () => {
      const { connector, page } = createConnector();
      // Set up response mocks for validateMemory flow
      let callCount = 0;
      page.$$.mockImplementation(async (selector) => {
        if (selector === '[data-citation-id]') return [];
        callCount++;
        if (callCount <= 1) return [];
        return [createMockElement({ text: 'Marcus is the character', html: '<p>Marcus</p>' })];
      });
      page.$.mockResolvedValue(null);

      const result = await connector.validateMemory('Who is the character?', 'Marcus');

      expect(result.found).toBe(true);
    });

    test('click/type work through GenericWebAppConnector', async () => {
      const { connector, page } = createConnector();

      await connector.click('#test-btn');
      expect(page.click).toHaveBeenCalledWith('#test-btn');

      await connector.type('#test-input', 'hello');
      expect(page.fill).toHaveBeenCalledWith('#test-input', 'hello');
    });

    test('evidence collection delegates to EvidenceCollector', async () => {
      const { connector, evidence } = createConnector();

      await connector.collectEvidence('brainstormy_test');
      expect(evidence.collectAll).toHaveBeenCalled();
    });

    test('getSelector reads from app config', () => {
      const { connector } = createConnector();

      expect(connector.getSelector('new_project_button')).toBe('[data-testid="new-project-button"]');
      expect(connector.getSelector('citation_element')).toBe('[data-citation-id]');
    });
  });
});
