'use strict';

function createMockConnector(options = {}) {
  const state = new Map();
  const actionResults = options.actionResults || {};
  const actionErrors = options.actionErrors || {};

  return {
    // Core interface used by agents
    performAction: jest.fn(async (action, params) => {
      if (actionErrors[action]) {
        throw actionErrors[action];
      }
      const result = actionResults[action];
      return typeof result === 'function' ? result(params) : (result || { success: true });
    }),

    // State management (used by assertions)
    getState: jest.fn((key) => state.get(key)),
    setState: jest.fn((key, value) => state.set(key, value)),
    hasState: jest.fn((key) => state.has(key)),
    clearState: jest.fn(() => state.clear()),

    // Evidence collection
    collectEvidence: jest.fn(async (stepName) => ({
      stepName,
      timestamp: new Date().toISOString(),
      screenshot: `/evidence/${stepName}.png`,
      consoleLogs: [],
      networkRequests: []
    })),

    // URL
    getCurrentURL: jest.fn(async () => options.currentURL || 'https://staging.app.com/dashboard'),

    // Data extraction (used by element assertions)
    exists: jest.fn(async (selector) => {
      const existing = options.existingElements || [];
      return existing.includes(selector);
    }),
    extractData: jest.fn(async (selector) => {
      const data = options.elementData || {};
      if (data[selector] === undefined) {
        const { ElementNotFoundError } = require('../../connectors/errors');
        throw new ElementNotFoundError(selector);
      }
      return data[selector];
    }),

    // Health check
    healthCheck: jest.fn(async () => ({
      healthy: options.healthy !== undefined ? options.healthy : true,
      details: { initialized: true, cleanedUp: false, stateSize: 0 }
    })),

    // App config access
    app: options.app || {
      id: 'test-app',
      activeEnvironment: 'staging'
    },

    // For direct state manipulation in tests
    _state: state
  };
}

function createAgentConfig(overrides = {}) {
  return {
    id: 'test-agent',
    scenarios: [
      {
        id: 'basic-smoke',
        name: 'Basic Smoke Test',
        steps: [
          { action: 'navigate', params: { path: '/dashboard' } },
          { action: 'click', params: { selector: '#main-button' } }
        ],
        assertions: [
          { type: 'state_exists', key: 'authenticated' }
        ]
      }
    ],
    ...overrides
  };
}

function createHealerConfig(overrides = {}) {
  return {
    id: 'healer',
    healthThreshold: 0.9,
    knownIssues: [],
    scenarios: [
      {
        id: 'login-flow',
        name: 'Login Flow',
        tags: ['smoke', 'critical'],
        steps: [
          { action: 'navigate', params: { path: '/login' } },
          { action: 'authenticate', params: {} }
        ],
        assertions: [
          { type: 'state_truthy', key: 'authenticated' }
        ]
      },
      {
        id: 'create-project',
        name: 'Create Project',
        tags: ['smoke'],
        steps: [
          { action: 'create_project', params: { name: 'Test Project {{timestamp}}' } }
        ],
        assertions: [
          { type: 'state_exists', key: 'current_project_id' }
        ]
      }
    ],
    ...overrides
  };
}

module.exports = {
  createMockConnector,
  createAgentConfig,
  createHealerConfig
};
