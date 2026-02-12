'use strict';

/**
 * Create a mock Playwright page with event emitter support.
 */
function createMockPage(options = {}) {
  const listeners = {};

  return {
    url: () => options.url ?? 'https://test.example.com/dashboard',
    title: async () => options.title ?? 'Test Page',
    viewportSize: () => options.viewport ?? { width: 1280, height: 720 },

    screenshot: async ({ path: filePath, fullPage }) => {
      // Write a tiny placeholder file so filesystem assertions work
      const fs = require('fs');
      const dir = require('path').dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, `mock-screenshot-${fullPage ? 'full' : 'viewport'}`);
    },

    // Event emitter
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
  createMockConsoleMessage,
  createMockRequest,
  createMockResponse
};
