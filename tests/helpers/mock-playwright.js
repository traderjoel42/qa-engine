'use strict';

/**
 * Create a mock Playwright page with event emitter support.
 *
 * Provides two categories of methods:
 * - Manual implementations: on/off/_emit (event emitter), screenshot (filesystem)
 * - Jest mocks: url, title, goto, click, fill, selectOption, waitForSelector,
 *   waitForLoadState, waitForTimeout, waitForFunction, $, $$ (assertion-friendly)
 */
function createMockPage(options = {}) {
  const listeners = {};

  return {
    // Jest mocks — controllable per-test via mockReturnValue/mockResolvedValue
    url: jest.fn().mockReturnValue(options.url ?? 'https://test.example.com/dashboard'),
    title: jest.fn().mockResolvedValue(options.title ?? 'Test Page'),
    viewportSize: () => options.viewport ?? { width: 1280, height: 720 },

    // Playwright interaction methods (GenericWebAppConnector)
    goto: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue(null),
    $$: jest.fn().mockResolvedValue([]),

    // Manual implementation — writes placeholder files for filesystem assertions
    screenshot: async ({ path: filePath, fullPage }) => {
      const fs = require('fs');
      const dir = require('path').dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, `mock-screenshot-${fullPage ? 'full' : 'viewport'}`);
    },

    // Event emitter — manual implementation for EvidenceCollector listener tests
    on: (event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    off: (event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    },

    // Test helper: emit events to trigger handlers
    _emit: (event, ...args) => {
      (listeners[event] || []).forEach(handler => handler(...args));
    }
  };
}

/**
 * Create a mock Playwright ElementHandle.
 * evaluate() returns a Promise to match Playwright's real API.
 */
function createMockElement({ text = '', value = '', html = '', attributes = {} } = {}) {
  return {
    evaluate: jest.fn().mockImplementation(fn => {
      const mockEl = {
        textContent: text,
        value: value,
        innerHTML: html,
        attributes: Object.entries(attributes).map(([name, val]) => ({ name, value: val }))
      };
      return Promise.resolve(fn(mockEl));
    })
  };
}

/**
 * Create a mock app configuration object.
 * auth_indicator and ready_indicator live at config top-level (not inside selectors).
 */
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

/**
 * Create a mock Playwright ElementHandle for citation elements.
 * Uses getAttribute() and textContent() (Playwright ElementHandle methods),
 * NOT the evaluate() pattern used by createMockElement.
 */
function createMockCitationElement(id, text) {
  return {
    getAttribute: jest.fn().mockResolvedValue(id),
    textContent: jest.fn().mockResolvedValue(text),
    evaluate: jest.fn().mockImplementation(fn =>
      Promise.resolve(fn({ textContent: text, value: '', innerHTML: text, attributes: [] }))
    )
  };
}

/**
 * Create a full Brainstormy app configuration object.
 * Includes all selectors from GenericWebAppConnector, AIAppConnector,
 * and BrainstormyConnector, plus url_patterns and extended timeouts.
 */
function createBrainstormyAppConfig(overrides = {}) {
  return createMockAppConfig({
    app_id: 'brainstormy',
    name: 'Brainstormy',
    connector: { type: 'brainstormy', base: 'ai-chat-app' },
    config: {
      auth_indicator: '[data-testid="user-menu"]',
      ready_indicator: '[data-testid="app-loaded"]',
      selectors: {
        // Login (from GenericWebAppConnector config)
        login_email: '[name="email"]',
        login_password: '[name="password"]',
        login_submit: '[type="submit"]',
        logout: '[data-testid="logout-button"]',

        // Chat (from AIAppConnector config)
        chat_input: '[data-testid="chat-input"]',
        chat_send: '[data-testid="send-button"]',
        ai_message: '[data-testid="ai-message"]',
        generating_indicator: '[data-testid="generating"]',

        // Brainstormy-specific
        new_project_button: '[data-testid="new-project-button"]',
        project_name_input: '[data-testid="project-name-input"]',
        create_project_submit: '[data-testid="create-project-button"]',
        new_story_button: '[data-testid="new-story-button"]',
        story_name_input: '[data-testid="story-name-input"]',
        story_vertical_select: '[data-testid="story-vertical-select"]',
        create_story_submit: '[data-testid="create-story-button"]',
        new_session_button: '[data-testid="new-session-button"]',
        session_type_select: '[data-testid="session-type-select"]',
        create_session_submit: '[data-testid="create-session-button"]',
        story_bible_button: '[data-testid="story-bible-button"]',
        bible_template_prefix: '[data-testid="template-',
        generate_bible_button: '[data-testid="generate-bible-button"]',
        bible_content: '[data-testid="bible-content"]',
        session_summary_button: '[data-testid="session-summary-button"]',
        summary_content: '[data-testid="summary-content"]',
        citation_element: '[data-citation-id]'
      },
      url_patterns: {
        project_id: 'projects\\/([a-zA-Z0-9-]+)',
        story_id: 'stories\\/([a-zA-Z0-9-]+)',
        session_id: 'sessions\\/([a-zA-Z0-9-]+)'
      },
      timeouts: {
        ai_response: 60000,
        bible_generation: 120000,
        navigation: 30000
      }
    },
    ...overrides
  });
}

/**
 * Create a mock Playwright ConsoleMessage.
 */
function createMockConsoleMessage({ type = 'log', text = '', url, lineNumber, columnNumber } = {}) {
  return {
    type: () => type,
    text: () => text,
    location: () => ({
      url: url ?? 'https://test.example.com/app.js',
      lineNumber: lineNumber ?? 0,
      columnNumber: columnNumber ?? 0
    })
  };
}

/**
 * Create a mock Playwright Request.
 */
function createMockRequest({ url = 'https://api.example.com/data', method = 'GET', resourceType = 'fetch', headers = {}, timing, failure } = {}) {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    headers: () => ({ 'content-type': 'application/json', ...headers }),
    timing: () => timing ?? { startTime: 0, responseEnd: 150 },
    failure: () => failure ?? null,
    response: () => null  // Synchronous, matches Playwright v1.58. Override per test.
  };
}

/**
 * Create a mock Playwright Response.
 */
function createMockResponse({ status = 200, statusText = 'OK', headers = {} } = {}) {
  return {
    status: () => status,
    statusText: () => statusText,
    allHeaders: async () => ({ 'content-type': 'application/json', ...headers })
  };
}

module.exports = {
  createMockPage,
  createMockElement,
  createMockCitationElement,
  createMockAppConfig,
  createBrainstormyAppConfig,
  createMockConsoleMessage,
  createMockRequest,
  createMockResponse
};
