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
  return {
    id: 'brainstormy',
    name: 'Brainstormy',
    type: 'ai-chat-app',
    baseUrl: 'https://staging.brainstormy.app',
    connector: {
      type: 'brainstormy',
      config: {
        auth: {
          type: 'email_password',
          required: true,
          credentials: {
            email: 'testbot@brainstormy.app',
            passwordEnv: 'BRAINSTORMY_TEST_PASSWORD'
          }
        },
        selectors: {
          clerkEmailInput: 'input[name="identifier"]',
          clerkPasswordInput: 'input[name="password"]',
          clerkSubmitButton: 'button[type="submit"]',
          userMenu: '[data-testid="user-menu"]',
          logoutButton: '[data-testid="logout-button"]',
          sidebarProjects: '[data-testid="sidebar-projects"]',
          storySidebarItem: '[data-testid="story-nav-item"]',
          newProjectButton: '[data-testid="new-project-button"]',
          projectNameInput: '[data-testid="project-name-input"]',
          createProjectSubmit: '[data-testid="create-project-button"]',
          newStoryButton: '[data-testid="new-story-button"]',
          storyNameInput: '[data-testid="story-name-input"]',
          storyVerticalSelect: '[data-testid="story-vertical-select"]',
          createStorySubmit: '[data-testid="create-story-button"]',
          newSessionButton: '[data-testid="new-session-button"]',
          sessionTypeSelect: '[data-testid="session-type-select"]',
          createSessionSubmit: '[data-testid="create-session-button"]',
          sessionList: '[data-testid="session-list"]',
          sessionItem: '[data-testid="session-item"]',
          endSessionButton: '[data-testid="end-session-button"]',
          chatInput: '[data-testid="chat-input"]',
          chatSend: '[data-testid="send-button"]',
          aiMessage: '[data-testid="ai-message"]',
          userMessage: '[data-testid="user-message"]',
          generatingIndicator: '[data-testid="generating"]',
          searchInput: '[data-testid="search-input"]',
          searchSubmit: '[data-testid="search-submit"]',
          searchResults: '[data-testid="search-results"]',
          searchResultItem: '[data-testid="search-result-item"]',
          bibleTab: '[data-testid="bible-tab"]',
          bibleTemplateSelect: '[data-testid="bible-template-select"]',
          bibleGenerateButton: '[data-testid="bible-generate"]',
          bibleSection: '[data-testid="bible-section"]',
          bibleGeneratingIndicator: '[data-testid="bible-generating"]',
          reportTab: '[data-testid="report-tab"]',
          reportTypeSelect: '[data-testid="report-type-select"]',
          reportGenerateButton: '[data-testid="report-generate"]',
          reportContent: '[data-testid="report-content"]',
          reportCitation: '[data-citation-id]',
          bookmarkButton: '[data-testid="bookmark-button"]',
          bookmarkTitleInput: '[data-testid="bookmark-title-input"]',
          bookmarkSaveButton: '[data-testid="bookmark-save"]',
          bookmarksTab: '[data-testid="bookmarks-tab"]',
          bookmarkItem: '[data-testid="bookmark-item"]',
          sessionSummaryButton: '[data-testid="session-summary-button"]',
          sessionSummaryContent: '[data-testid="session-summary"]',
          readyIndicator: '[data-testid="app-loaded"]'
        },
        url_patterns: {
          project_id: 'projects\\/([a-zA-Z0-9-]+)',
          story_id: 'stories\\/([a-zA-Z0-9-]+)',
          session_id: 'sessions\\/([a-zA-Z0-9-]+)'
        },
        timeouts: {
          aiResponse: 60000,
          bibleGeneration: 120000,
          reportGeneration: 90000,
          navigation: 30000,
          search: 15000,
          sessionSummary: 60000,
          clerkAuth: 30000
        },
        testProjectName: 'QA Test Project'
      }
    },
    environments: {
      staging: {
        url: 'https://staging.brainstormy.app',
        auth: { credentials: { passwordEnv: 'BRAINSTORMY_TEST_PASSWORD' } }
      }
    },
    ...overrides
  };
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
