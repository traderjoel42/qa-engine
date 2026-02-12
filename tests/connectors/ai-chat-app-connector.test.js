'use strict';

const AIAppConnector = require('../../connectors/ai-chat-app/connector');
const GenericWebAppConnector = require('../../connectors/generic-web-app/connector');
const BaseConnector = require('../../connectors/base-connector');
const {
  ConnectorError,
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

/**
 * Create an AIAppConnector with AI-specific selectors added to config.
 */
function createAIAppConfig(overrides = {}) {
  return createMockAppConfig({
    config: {
      auth_indicator: '[data-testid="user-menu"]',
      ready_indicator: '[data-testid="app-loaded"]',
      selectors: {
        login_email: '[name="email"]',
        login_password: '[name="password"]',
        login_submit: '[type="submit"]',
        logout: '[data-testid="logout-button"]',
        chat_input: '[data-testid="chat-input"]',
        chat_send: '[data-testid="send-button"]',
        ai_message: '[data-testid="ai-message"]',
        generating_indicator: '[data-testid="generating"]'
      },
      timeouts: {
        ai_response: 60000,
        navigation: 30000
      }
    },
    ...overrides
  });
}

function createConnector(appOverrides = {}, pageOverrides = {}, evidenceOverrides = {}) {
  const app = createAIAppConfig(appOverrides);
  const page = createMockPage(pageOverrides);
  const evidence = createMockEvidence(evidenceOverrides);
  const connector = new AIAppConnector(app, page, evidence);
  return { connector, app, page, evidence };
}

/**
 * Set up mock page to simulate a conversation response.
 * After waitForFunction resolves, $$ returns mock AI message elements.
 */
function setupResponseMocks(page, responseText = 'AI response text', responseHtml = '<p>AI response text</p>') {
  // $$ returns empty initially, then returns one mock element after waitForFunction
  let callCount = 0;
  page.$$.mockImplementation(async () => {
    callCount++;
    if (callCount <= 1) {
      // First call: count existing messages (0)
      return [];
    }
    // Subsequent calls: return a mock AI message
    return [createMockElement({ text: responseText, html: responseHtml })];
  });

  // generating_indicator not found (generation already complete)
  page.$.mockResolvedValue(null);
}

// ===================================================================
// TESTS
// ===================================================================

describe('AIAppConnector', () => {

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly', () => {
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
  // performAction — AI action dispatch
  // ===================================================================

  describe('performAction() — AI action dispatch', () => {
    test('dispatches send_message to sendMessage()', async () => {
      const { connector, page } = createConnector();
      const spy = jest.spyOn(connector, 'sendMessage').mockResolvedValue({ text: 'hi', timestamp: 'ts', messageIndex: 0 });

      await connector.performAction('send_message', { text: 'hi' });
      expect(spy).toHaveBeenCalledWith('hi');
    });

    test('dispatches wait_for_response to waitForAIResponse()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'waitForAIResponse').mockResolvedValue({ text: 'resp', html: '', timestamp: 'ts', messageIndex: 0 });

      await connector.performAction('wait_for_response', { timeout: 5000 });
      expect(spy).toHaveBeenCalledWith(5000);
    });

    test('dispatches get_conversation to getConversationHistory()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'getConversationHistory').mockResolvedValue([]);

      await connector.performAction('get_conversation');
      expect(spy).toHaveBeenCalled();
    });

    test('dispatches validate_memory to validateMemory()', async () => {
      const { connector } = createConnector();
      const spy = jest.spyOn(connector, 'validateMemory').mockResolvedValue({ query: 'q', expected: 'e', response: 'r', found: true, timestamp: 'ts' });

      await connector.performAction('validate_memory', { query: 'q', expected: 'e' });
      expect(spy).toHaveBeenCalledWith('q', 'e');
    });

    test('delegates click to super.performAction()', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('click', { selector: '#btn' });
      expect(page.click).toHaveBeenCalledWith('#btn');
    });

    test('delegates type to super.performAction()', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('type', { selector: '#input', text: 'hello' });
      expect(page.fill).toHaveBeenCalledWith('#input', 'hello');
    });

    test('delegates navigate to super.performAction()', async () => {
      const { connector, page } = createConnector();

      await connector.performAction('navigate', { path: '/dashboard' });
      expect(page.goto).toHaveBeenCalled();
    });

    test('delegates unknown action to super chain (throws)', async () => {
      const { connector } = createConnector();

      await expect(connector.performAction('unknown_action')).rejects.toThrow('not supported');
    });

    test('captures before evidence for AI actions', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'sendMessage').mockResolvedValue({ text: 'hi', timestamp: 'ts', messageIndex: 0 });

      await connector.performAction('send_message', { text: 'hi' });

      const calls = evidence.collectAll.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0][1]).toMatch(/^before_send_message_/);
    });

    test('captures after evidence on success', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'sendMessage').mockResolvedValue({ text: 'hi', timestamp: 'ts', messageIndex: 0 });

      await connector.performAction('send_message', { text: 'hi' });

      const calls = evidence.collectAll.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toMatch(/^after_send_message_/);
    });

    test('captures failure evidence on error', async () => {
      const { connector, evidence } = createConnector();
      jest.spyOn(connector, 'sendMessage').mockRejectedValue(new ConnectorError('fail'));

      await expect(connector.performAction('send_message', { text: 'hi' })).rejects.toThrow('fail');

      const calls = evidence.collectAll.mock.calls;
      const failCall = calls.find(c => c[1].startsWith('failed_'));
      expect(failCall).toBeDefined();
      expect(failCall[1]).toMatch(/^failed_send_message_/);
    });

    test('does NOT double-capture evidence for delegated generic actions', async () => {
      const { connector, evidence } = createConnector();

      await connector.performAction('click', { selector: '#btn' });

      // Evidence should be captured by GenericWebAppConnector (before + after)
      // but AIAppConnector should NOT add its own wrapping
      const calls = evidence.collectAll.mock.calls;
      const beforeCalls = calls.filter(c => c[1].startsWith('before_'));
      const afterCalls = calls.filter(c => c[1].startsWith('after_'));
      // Exactly one before and one after from GenericWebAppConnector
      expect(beforeCalls).toHaveLength(1);
      expect(afterCalls).toHaveLength(1);
    });
  });

  // ===================================================================
  // sendMessage
  // ===================================================================

  describe('sendMessage()', () => {
    test('types text into chat_input selector', async () => {
      const { connector, page } = createConnector();

      await connector.sendMessage('Hello AI');
      expect(page.fill).toHaveBeenCalledWith('[data-testid="chat-input"]', 'Hello AI');
    });

    test('clicks chat_send selector', async () => {
      const { connector, page } = createConnector();

      await connector.sendMessage('Hello AI');
      expect(page.click).toHaveBeenCalledWith('[data-testid="send-button"]');
    });

    test('pushes user message to state messages array', async () => {
      const { connector } = createConnector();

      await connector.sendMessage('Hello AI');

      const messages = connector.getState('messages');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello AI');
      expect(messages[0].timestamp).toBeDefined();
    });

    test('returns text, timestamp, and messageIndex', async () => {
      const { connector } = createConnector();

      const result = await connector.sendMessage('Test message');

      expect(result.text).toBe('Test message');
      expect(result.timestamp).toBeDefined();
      expect(result.messageIndex).toBe(0);
    });

    test('increments messageIndex with each call', async () => {
      const { connector } = createConnector();

      const r1 = await connector.sendMessage('First');
      const r2 = await connector.sendMessage('Second');
      const r3 = await connector.sendMessage('Third');

      expect(r1.messageIndex).toBe(0);
      expect(r2.messageIndex).toBe(1);
      expect(r3.messageIndex).toBe(2);
    });

    test('throws ConnectorError when chat_input selector missing', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {
            chat_send: '[data-testid="send-button"]'
            // chat_input missing
          },
          timeouts: {}
        }
      });

      await expect(connector.sendMessage('hi')).rejects.toThrow(ConnectorError);
      await expect(connector.sendMessage('hi')).rejects.toThrow('Missing chat selectors');
    });

    test('throws ConnectorError when chat_send selector missing', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]'
            // chat_send missing
          },
          timeouts: {}
        }
      });

      await expect(connector.sendMessage('hi')).rejects.toThrow(ConnectorError);
      await expect(connector.sendMessage('hi')).rejects.toThrow('Missing chat selectors');
    });
  });

  // ===================================================================
  // waitForAIResponse
  // ===================================================================

  describe('waitForAIResponse()', () => {
    test('waits for new AI message element to appear', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page);

      await connector.waitForAIResponse();

      expect(page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ selector: '[data-testid="ai-message"]', before: 0 }),
        expect.objectContaining({ timeout: 60000 })
      );
    });

    test('waits for generation to complete before extracting', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page);
      const spy = jest.spyOn(connector, 'waitForGenerationComplete').mockResolvedValue(undefined);

      await connector.waitForAIResponse();

      expect(spy).toHaveBeenCalledWith(60000);
    });

    test('extracts text and html from last AI message', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page, 'The answer is 42', '<p>The answer is 42</p>');

      const result = await connector.waitForAIResponse();

      expect(result.text).toBe('The answer is 42');
      expect(result.html).toBe('<p>The answer is 42</p>');
    });

    test('pushes assistant message to state messages array', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page);

      await connector.waitForAIResponse();

      const messages = connector.getState('messages');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('AI response text');
    });

    test('returns text, html, timestamp, and messageIndex', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page);

      const result = await connector.waitForAIResponse();

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('messageIndex');
      expect(result.messageIndex).toBe(0);
    });

    test('uses config ai_response timeout when no timeout param', async () => {
      const { connector, page } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]',
            ai_message: '[data-testid="ai-message"]'
          },
          timeouts: { ai_response: 45000 }
        }
      });
      setupResponseMocks(page);

      await connector.waitForAIResponse();

      expect(page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        expect.objectContaining({ timeout: 45000 })
      );
    });

    test('uses provided timeout parameter over config', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page);

      await connector.waitForAIResponse(10000);

      expect(page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        expect.objectContaining({ timeout: 10000 })
      );
    });

    test('defaults to 60000ms when no config and no param', async () => {
      const { connector, page } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]',
            ai_message: '[data-testid="ai-message"]'
          },
          timeouts: {}
        }
      });
      setupResponseMocks(page);

      await connector.waitForAIResponse();

      expect(page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        expect.objectContaining({ timeout: 60000 })
      );
    });

    test('throws ConnectorTimeoutError when AI does not respond', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([]);
      page.$.mockResolvedValue(null);
      page.waitForFunction.mockRejectedValue(Object.assign(new Error('Timeout exceeded'), { name: 'TimeoutError' }));

      await expect(connector.waitForAIResponse(5000)).rejects.toThrow(ConnectorTimeoutError);
    });

    test('throws ConnectorError when ai_message selector missing', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]'
            // ai_message missing
          },
          timeouts: {}
        }
      });

      await expect(connector.waitForAIResponse()).rejects.toThrow(ConnectorError);
      await expect(connector.waitForAIResponse()).rejects.toThrow('Missing ai_message selector');
    });

    test('wraps Playwright errors via _wrapPlaywrightError', async () => {
      const { connector, page } = createConnector();
      page.$$.mockResolvedValue([]);
      page.$.mockResolvedValue(null);
      page.waitForFunction.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(connector.waitForAIResponse()).rejects.toThrow('Navigation failed');
    });
  });

  // ===================================================================
  // getConversationHistory
  // ===================================================================

  describe('getConversationHistory()', () => {
    test('returns empty array when no messages sent', async () => {
      const { connector } = createConnector();

      const history = await connector.getConversationHistory();
      expect(history).toEqual([]);
    });

    test('returns accumulated user and assistant messages', async () => {
      const { connector, page } = createConnector();

      // Send a message
      await connector.sendMessage('Hello');

      // Simulate a response
      setupResponseMocks(page, 'Hi there');
      await connector.waitForAIResponse();

      const history = await connector.getConversationHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    test('messages are in chronological order', async () => {
      const { connector, page } = createConnector();

      await connector.sendMessage('First');
      setupResponseMocks(page, 'Reply 1');
      await connector.waitForAIResponse();

      const history = await connector.getConversationHistory();
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Reply 1');
    });

    test('each message has role, content, timestamp', async () => {
      const { connector } = createConnector();

      await connector.sendMessage('Test');

      const history = await connector.getConversationHistory();
      const msg = history[0];
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(msg).toHaveProperty('timestamp');
    });
  });

  // ===================================================================
  // validateMemory
  // ===================================================================

  describe('validateMemory()', () => {
    function setupValidateMemoryMocks(connector, page, responseText) {
      // sendMessage is called internally — mock the page interactions
      setupResponseMocks(page, responseText);
    }

    test('sends query via sendMessage', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'Marcus is the character');
      const spy = jest.spyOn(connector, 'sendMessage');

      await connector.validateMemory('Who is the character?', 'Marcus');

      expect(spy).toHaveBeenCalledWith('Who is the character?');
    });

    test('waits for response via waitForAIResponse', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'Marcus is the character');
      const spy = jest.spyOn(connector, 'waitForAIResponse');

      await connector.validateMemory('Who is the character?', 'Marcus');

      expect(spy).toHaveBeenCalled();
    });

    test('returns found=true when response contains expected (exact case)', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'The character is Marcus.');

      const result = await connector.validateMemory('Who?', 'Marcus');
      expect(result.found).toBe(true);
    });

    test('returns found=true when response contains expected (different case)', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'The character is MARCUS.');

      const result = await connector.validateMemory('Who?', 'marcus');
      expect(result.found).toBe(true);
    });

    test('returns found=false when response does not contain expected', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'I do not recall any character.');

      const result = await connector.validateMemory('Who?', 'Marcus');
      expect(result.found).toBe(false);
    });

    test('includes full response text in result', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'The full response here.');

      const result = await connector.validateMemory('Question?', 'anything');
      expect(result.response).toBe('The full response here.');
    });

    test('includes query and expected in result', async () => {
      const { connector, page } = createConnector();
      setupValidateMemoryMocks(connector, page, 'Some reply');

      const result = await connector.validateMemory('My query', 'My expected');
      expect(result.query).toBe('My query');
      expect(result.expected).toBe('My expected');
      expect(result.timestamp).toBeDefined();
    });
  });

  // ===================================================================
  // isGenerating
  // ===================================================================

  describe('isGenerating()', () => {
    test('returns true when generating_indicator element exists', async () => {
      const { connector, page } = createConnector();
      page.$.mockImplementation(async (selector) => {
        if (selector === '[data-testid="generating"]') return createMockElement();
        return null;
      });

      const result = await connector.isGenerating();
      expect(result).toBe(true);
    });

    test('returns false when generating_indicator element missing', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      const result = await connector.isGenerating();
      expect(result).toBe(false);
    });

    test('returns false when generating_indicator not configured', async () => {
      const { connector } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]',
            ai_message: '[data-testid="ai-message"]'
            // generating_indicator not configured
          },
          timeouts: {}
        }
      });

      const result = await connector.isGenerating();
      expect(result).toBe(false);
    });
  });

  // ===================================================================
  // waitForGenerationComplete
  // ===================================================================

  describe('waitForGenerationComplete()', () => {
    test('polls until generating indicator disappears', async () => {
      const { connector, page } = createConnector();
      let pollCount = 0;
      page.$.mockImplementation(async (selector) => {
        if (selector === '[data-testid="generating"]') {
          pollCount++;
          // Indicator visible for 2 polls, then disappears
          return pollCount <= 2 ? createMockElement() : null;
        }
        return null;
      });

      await connector.waitForGenerationComplete();

      // Should have polled 3 times (2 visible + 1 gone)
      expect(pollCount).toBe(3);
    });

    test('returns immediately when indicator not visible', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(null);

      await connector.waitForGenerationComplete();

      // waitForTimeout should NOT have been called (no polling needed)
      // The indicator was never visible so the while loop body never executes
      expect(page.waitForTimeout).not.toHaveBeenCalledWith(500);
    });

    test('uses 2-second settle when no indicator configured', async () => {
      const { connector, page } = createConnector({
        config: {
          selectors: {
            chat_input: '[data-testid="chat-input"]',
            chat_send: '[data-testid="send-button"]',
            ai_message: '[data-testid="ai-message"]'
            // generating_indicator not configured
          },
          timeouts: {}
        }
      });

      await connector.waitForGenerationComplete();

      expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
    });

    test('throws ConnectorTimeoutError when generation exceeds timeout', async () => {
      const { connector, page } = createConnector();
      // Indicator never disappears
      page.$.mockImplementation(async (selector) => {
        if (selector === '[data-testid="generating"]') return createMockElement();
        return null;
      });

      // Override Date.now to simulate elapsed time exceeding timeout
      const originalNow = Date.now;
      let callNum = 0;
      Date.now = jest.fn(() => {
        callNum++;
        // First call (start): time = 0
        // Second call (check): time = 200, which exceeds timeout of 100
        return callNum <= 1 ? 0 : 200;
      });

      try {
        await expect(connector.waitForGenerationComplete(100)).rejects.toThrow(ConnectorTimeoutError);
      } finally {
        Date.now = originalNow;
      }
    });

    test('polls at 500ms intervals', async () => {
      const { connector, page } = createConnector();
      let pollCount = 0;
      page.$.mockImplementation(async (selector) => {
        if (selector === '[data-testid="generating"]') {
          pollCount++;
          return pollCount <= 1 ? createMockElement() : null;
        }
        return null;
      });

      await connector.waitForGenerationComplete();

      expect(page.waitForTimeout).toHaveBeenCalledWith(500);
    });
  });

  // ===================================================================
  // State management — conversation tracking
  // ===================================================================

  describe('State management — conversation tracking', () => {
    test('sendMessage + waitForAIResponse builds conversation array', async () => {
      const { connector, page } = createConnector();

      await connector.sendMessage('Hello');
      setupResponseMocks(page, 'Hi back');
      await connector.waitForAIResponse();

      const messages = connector.getState('messages');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello' });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi back' });
    });

    test('multiple exchanges maintain correct order', async () => {
      const { connector, page } = createConnector();

      // Exchange 1
      await connector.sendMessage('First question');
      setupResponseMocks(page, 'First answer');
      await connector.waitForAIResponse();

      // Exchange 2
      await connector.sendMessage('Second question');
      setupResponseMocks(page, 'Second answer');
      await connector.waitForAIResponse();

      const messages = connector.getState('messages');
      expect(messages).toHaveLength(4);
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(messages.map(m => m.content)).toEqual([
        'First question', 'First answer', 'Second question', 'Second answer'
      ]);
    });

    test('validateMemory adds both user and assistant messages to history', async () => {
      const { connector, page } = createConnector();
      setupResponseMocks(page, 'Marcus is the character');

      await connector.validateMemory('Who?', 'Marcus');

      const messages = connector.getState('messages');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Who?');
      expect(messages[1].role).toBe('assistant');
    });

    test('clearState resets conversation history', async () => {
      const { connector } = createConnector();

      await connector.sendMessage('Hello');
      expect(connector.getState('messages')).toHaveLength(1);

      connector.clearState();
      expect(connector.getState('messages')).toBeUndefined();

      const history = await connector.getConversationHistory();
      expect(history).toEqual([]);
    });
  });

  // ===================================================================
  // Inherited behavior (smoke tests)
  // ===================================================================

  describe('Inherited behavior (smoke tests)', () => {
    test('initialize authenticates and waits for ready', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());
      process.env.TEST_APP_PASSWORD = 'secret';

      try {
        await connector.initialize();
        expect(connector._initialized).toBe(true);
      } finally {
        delete process.env.TEST_APP_PASSWORD;
      }
    });

    test('cleanup logs out and clears state', async () => {
      const { connector, page } = createConnector();
      page.$.mockResolvedValue(createMockElement());
      connector.setState('authenticated', true);

      await connector.cleanup();

      expect(connector._cleanedUp).toBe(true);
    });

    test('click/type/select work through super', async () => {
      const { connector, page } = createConnector();

      await connector.click('#btn');
      expect(page.click).toHaveBeenCalledWith('#btn');

      await connector.type('#input', 'text');
      expect(page.fill).toHaveBeenCalledWith('#input', 'text');

      await connector.select('#sel', 'val');
      expect(page.selectOption).toHaveBeenCalledWith('#sel', 'val');
    });

    test('evidence collection delegates to EvidenceCollector', async () => {
      const { connector, evidence } = createConnector();

      await connector.collectEvidence('test_step');
      expect(evidence.collectAll).toHaveBeenCalled();
    });
  });
});
