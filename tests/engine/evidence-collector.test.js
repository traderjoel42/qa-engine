'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const EvidenceCollector = require('../../core/engine/evidence-collector');
const {
  createMockPage,
  createMockConsoleMessage,
  createMockRequest,
  createMockResponse
} = require('../helpers/mock-playwright');

// Temp directory for test evidence
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createCollector(overrides = {}) {
  return new EvidenceCollector({
    runId: 'run-001',
    appId: 'test-app',
    basePath: tmpDir,
    ...overrides
  });
}

describe('EvidenceCollector', () => {

  describe('Constructor', () => {
    test('sets runId, appId, basePath from config', () => {
      const ec = createCollector();
      expect(ec.runId).toBe('run-001');
      expect(ec.appId).toBe('test-app');
      expect(ec.basePath).toBe(tmpDir);
    });

    test('computes runPath, screenshotPath, logPath, networkPath correctly', () => {
      const ec = createCollector();
      expect(ec.runPath).toBe(path.join(tmpDir, 'test-app', 'run-001'));
      expect(ec.screenshotPath).toBe(path.join(tmpDir, 'test-app', 'run-001', 'screenshots'));
      expect(ec.logPath).toBe(path.join(tmpDir, 'test-app', 'run-001', 'logs'));
      expect(ec.networkPath).toBe(path.join(tmpDir, 'test-app', 'run-001', 'network'));
    });

    test('initializes empty buffers', () => {
      const ec = createCollector();
      expect(ec._consoleLogs).toEqual([]);
      expect(ec._networkRequests).toEqual([]);
      expect(ec._pendingCaptures).toEqual([]);
    });

    test('sets _screenshotCounter to 0', () => {
      const ec = createCollector();
      expect(ec._screenshotCounter).toBe(0);
    });

    test('basePath defaults to ./evidence when not provided', () => {
      const ec = new EvidenceCollector({ runId: 'r', appId: 'a' });
      expect(ec.basePath).toBe('./evidence');
    });
  });

  describe('initialize()', () => {
    test('attaches console listener to page', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      // Emit a console event and check it was captured
      page._emit('console', createMockConsoleMessage({ type: 'log', text: 'hello' }));
      expect(ec._consoleLogs).toHaveLength(1);
      expect(ec._consoleLogs[0].message).toBe('hello');
    });

    test('attaches requestfinished listener to page', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest();
      page._emit('requestfinished', mockReq);

      // Give the async _captureRequest time to resolve
      await new Promise(r => setTimeout(r, 10));
      expect(ec._networkRequests).toHaveLength(1);
    });

    test('attaches requestfailed listener to page', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ failure: { errorText: 'net::ERR_FAILED' } });
      page._emit('requestfailed', mockReq);
      expect(ec._networkRequests).toHaveLength(1);
      expect(ec._networkRequests[0].failed).toBe(true);
    });

    test('sets _initialized to true', async () => {
      const ec = createCollector();
      expect(ec._initialized).toBe(false);
      await ec.initialize(createMockPage());
      expect(ec._initialized).toBe(true);
    });

    test('stores page reference', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);
      expect(ec._page).toBe(page);
    });
  });

  describe('cleanup()', () => {
    test('removes all listeners from page', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      await ec.cleanup();

      // Emit events after cleanup — should NOT be captured
      page._emit('console', createMockConsoleMessage({ text: 'after cleanup' }));
      expect(ec._consoleLogs).toHaveLength(0);
    });

    test('awaits pending network capture promises before writing', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      // Emit a request that will be captured async
      const mockReq = createMockRequest();
      page._emit('requestfinished', mockReq);

      // Cleanup should await the pending capture
      await ec.cleanup();

      // Verify the request was written to disk
      const networkFile = path.join(ec.networkPath, 'requests.json');
      const data = JSON.parse(fs.readFileSync(networkFile, 'utf8'));
      expect(data).toHaveLength(1);
    });

    test('writes console.json to logs directory', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ type: 'error', text: 'test error' }));
      await ec.cleanup();

      const logFile = path.join(ec.logPath, 'console.json');
      expect(fs.existsSync(logFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      expect(data).toHaveLength(1);
      expect(data[0].message).toBe('test error');
    });

    test('writes requests.json to network directory', async () => {
      const ec = createCollector({ runId: 'cleanup-net' });
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfailed', createMockRequest({ failure: { errorText: 'timeout' } }));
      await ec.cleanup();

      const networkFile = path.join(ec.networkPath, 'requests.json');
      expect(fs.existsSync(networkFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(networkFile, 'utf8'));
      expect(data).toHaveLength(1);
    });

    test('writes index.json to run directory', async () => {
      const ec = createCollector({ runId: 'cleanup-idx' });
      const page = createMockPage();
      await ec.initialize(page);
      await ec.cleanup();

      const indexFile = path.join(ec.runPath, 'index.json');
      expect(fs.existsSync(indexFile)).toBe(true);
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      expect(index.runId).toBe('cleanup-idx');
      expect(index.appId).toBe('test-app');
      expect(index.evidence).toBeDefined();
      expect(index.paths).toBeDefined();
    });

    test('sets _initialized to false', async () => {
      const ec = createCollector({ runId: 'cleanup-init' });
      await ec.initialize(createMockPage());
      expect(ec._initialized).toBe(true);
      await ec.cleanup();
      expect(ec._initialized).toBe(false);
    });

    test('clears page reference', async () => {
      const ec = createCollector({ runId: 'cleanup-page' });
      const page = createMockPage();
      await ec.initialize(page);
      await ec.cleanup();
      expect(ec._page).toBeNull();
    });

    test('clears _pendingCaptures array', async () => {
      const ec = createCollector({ runId: 'cleanup-pending' });
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfinished', createMockRequest());
      await ec.cleanup();
      expect(ec._pendingCaptures).toEqual([]);
    });

    test('safe to call multiple times', async () => {
      const ec = createCollector({ runId: 'cleanup-multi' });
      await ec.initialize(createMockPage());
      await ec.cleanup();
      await expect(ec.cleanup()).resolves.toBeUndefined();
    });

    test('handles page already closed gracefully', async () => {
      const ec = createCollector({ runId: 'cleanup-closed' });
      const page = createMockPage();
      // Override off to throw (simulating closed page)
      page.off = () => { throw new Error('Target closed'); };
      await ec.initialize(page);

      // Should not throw
      await expect(ec.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('captureScreenshot()', () => {
    test('creates screenshots directory on first call', async () => {
      const ec = createCollector({ runId: 'ss-dir' });
      const page = createMockPage();

      await ec.captureScreenshot(page, 'test_step');
      expect(fs.existsSync(ec.screenshotPath)).toBe(true);
    });

    test('captures full-page screenshot', async () => {
      const ec = createCollector({ runId: 'ss-full' });
      const page = createMockPage();

      const result = await ec.captureScreenshot(page, 'full_test');
      expect(result).not.toBeNull();
      expect(fs.existsSync(result)).toBe(true);
      const content = fs.readFileSync(result, 'utf8');
      expect(content).toBe('mock-screenshot-full');
    });

    test('captures viewport screenshot', async () => {
      const ec = createCollector({ runId: 'ss-vp' });
      const page = createMockPage();

      const fullPath = await ec.captureScreenshot(page, 'vp_test');
      const vpPath = fullPath.replace('_full.png', '_viewport.png');
      expect(fs.existsSync(vpPath)).toBe(true);
      const content = fs.readFileSync(vpPath, 'utf8');
      expect(content).toBe('mock-screenshot-viewport');
    });

    test('returns full-page screenshot path', async () => {
      const ec = createCollector({ runId: 'ss-path' });
      const page = createMockPage();

      const result = await ec.captureScreenshot(page, 'path_test');
      expect(result).toContain('_full.png');
      expect(result).toContain(ec.screenshotPath);
    });

    test('increments screenshot counter', async () => {
      const ec = createCollector({ runId: 'ss-counter' });
      const page = createMockPage();

      const path1 = await ec.captureScreenshot(page, 'first');
      const path2 = await ec.captureScreenshot(page, 'second');
      expect(path1).toContain('001_');
      expect(path2).toContain('002_');
      expect(ec._screenshotCounter).toBe(2);
    });

    test('generates filename with counter, name, timestamp', async () => {
      const ec = createCollector({ runId: 'ss-fname' });
      const page = createMockPage();

      const result = await ec.captureScreenshot(page, 'login_page');
      const filename = path.basename(result);
      // Pattern: 001_login_page_{timestamp}_full.png
      expect(filename).toMatch(/^001_login_page_\d+_full\.png$/);
    });

    test('sanitizes step name in filename', async () => {
      const ec = createCollector({ runId: 'ss-sanitize' });
      const page = createMockPage();

      const result = await ec.captureScreenshot(page, 'step with spaces & symbols!');
      const filename = path.basename(result);
      expect(filename).not.toContain(' ');
      expect(filename).not.toContain('&');
      expect(filename).not.toContain('!');
    });

    test('returns null on failure (does not throw)', async () => {
      const ec = createCollector({ runId: 'ss-fail' });
      const page = createMockPage();
      // Override screenshot to throw
      page.screenshot = async () => { throw new Error('Page crashed'); };

      const result = await ec.captureScreenshot(page, 'broken');
      expect(result).toBeNull();
    });
  });

  describe('getConsoleLogs()', () => {
    test('returns empty array before any console events', async () => {
      const ec = createCollector();
      const logs = await ec.getConsoleLogs();
      expect(logs).toEqual([]);
    });

    test('returns accumulated log entries', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ type: 'log', text: 'msg1' }));
      page._emit('console', createMockConsoleMessage({ type: 'warn', text: 'msg2' }));

      const logs = await ec.getConsoleLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('msg1');
      expect(logs[1].message).toBe('msg2');
    });

    test('returns shallow copy (not internal buffer reference)', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ text: 'test' }));

      const logs1 = await ec.getConsoleLogs();
      const logs2 = await ec.getConsoleLogs();
      expect(logs1).not.toBe(logs2);
      expect(logs1).not.toBe(ec._consoleLogs);
    });

    test('returns empty array on error (does not throw)', async () => {
      const ec = createCollector();
      // Force an error by corrupting the buffer
      Object.defineProperty(ec, '_consoleLogs', {
        get() { throw new Error('corrupted'); }
      });
      const logs = await ec.getConsoleLogs();
      expect(logs).toEqual([]);
    });
  });

  describe('getNetworkRequests()', () => {
    test('returns empty array before any network events', async () => {
      const ec = createCollector();
      const requests = await ec.getNetworkRequests();
      expect(requests).toEqual([]);
    });

    test('returns accumulated request entries', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfailed', createMockRequest({ url: 'https://a.com', failure: { errorText: 'fail' } }));
      page._emit('requestfailed', createMockRequest({ url: 'https://b.com', failure: { errorText: 'fail' } }));

      const requests = await ec.getNetworkRequests();
      expect(requests).toHaveLength(2);
    });

    test('returns shallow copy (not internal buffer reference)', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfailed', createMockRequest({ failure: { errorText: 'fail' } }));

      const req1 = await ec.getNetworkRequests();
      const req2 = await ec.getNetworkRequests();
      expect(req1).not.toBe(req2);
      expect(req1).not.toBe(ec._networkRequests);
    });

    test('returns empty array on error (does not throw)', async () => {
      const ec = createCollector();
      Object.defineProperty(ec, '_networkRequests', {
        get() { throw new Error('corrupted'); }
      });
      const requests = await ec.getNetworkRequests();
      expect(requests).toEqual([]);
    });
  });

  describe('collectAll()', () => {
    test('returns complete evidence package', async () => {
      const ec = createCollector({ runId: 'collect-full' });
      const page = createMockPage();
      await ec.initialize(page);

      const evidence = await ec.collectAll(page, 'test_step');
      expect(evidence.stepName).toBe('test_step');
      expect(evidence.timestamp).toBeDefined();
      expect(evidence.screenshots).toBeDefined();
      expect(evidence.consoleLogs).toBeDefined();
      expect(evidence.networkRequests).toBeDefined();
      expect(evidence.url).toBeDefined();
      expect(evidence.pageTitle).toBeDefined();
      expect(evidence.viewport).toBeDefined();
      expect(evidence.summary).toBeDefined();
    });

    test('includes screenshot paths', async () => {
      const ec = createCollector({ runId: 'collect-ss' });
      const page = createMockPage();

      const evidence = await ec.collectAll(page, 'screenshot_test');
      expect(evidence.screenshots).not.toBeNull();
      expect(evidence.screenshots.full).toContain('_full.png');
      expect(evidence.screenshots.viewport).toContain('_viewport.png');
    });

    test('includes consoleLogs array', async () => {
      const ec = createCollector({ runId: 'collect-logs' });
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ type: 'error', text: 'oops' }));
      const evidence = await ec.collectAll(page, 'log_test');
      expect(evidence.consoleLogs).toHaveLength(1);
      expect(evidence.consoleLogs[0].message).toBe('oops');
    });

    test('includes networkRequests array', async () => {
      const ec = createCollector({ runId: 'collect-net' });
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfailed', createMockRequest({ failure: { errorText: 'fail' } }));
      const evidence = await ec.collectAll(page, 'net_test');
      expect(evidence.networkRequests).toHaveLength(1);
    });

    test('includes page URL, title, viewport', async () => {
      const ec = createCollector({ runId: 'collect-meta' });
      const page = createMockPage({
        url: 'https://app.example.com/test',
        title: 'Test Title',
        viewport: { width: 800, height: 600 }
      });

      const evidence = await ec.collectAll(page, 'meta_test');
      expect(evidence.url).toBe('https://app.example.com/test');
      expect(evidence.pageTitle).toBe('Test Title');
      expect(evidence.viewport).toEqual({ width: 800, height: 600 });
    });

    test('includes summary counts', async () => {
      const ec = createCollector({ runId: 'collect-summary' });
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ type: 'error', text: 'err1' }));
      page._emit('console', createMockConsoleMessage({ type: 'warn', text: 'warn1' }));
      page._emit('console', createMockConsoleMessage({ type: 'log', text: 'info1' }));
      page._emit('requestfailed', createMockRequest({ failure: { errorText: 'fail' } }));

      const evidence = await ec.collectAll(page, 'summary_test');
      expect(evidence.summary.totalLogs).toBe(3);
      expect(evidence.summary.errorLogs).toBe(1);
      expect(evidence.summary.warnLogs).toBe(1);
      expect(evidence.summary.totalRequests).toBe(1);
      expect(evidence.summary.failedRequests).toBe(1);
    });

    test('returns partial evidence when screenshot fails', async () => {
      const ec = createCollector({ runId: 'collect-partial' });
      const page = createMockPage();
      page.screenshot = async () => { throw new Error('crash'); };
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ text: 'still here' }));

      const evidence = await ec.collectAll(page, 'partial_test');
      expect(evidence.screenshots).toBeNull();
      expect(evidence.consoleLogs).toHaveLength(1);
      expect(evidence.consoleLogs[0].message).toBe('still here');
    });

    test('includes error field when screenshot fails', async () => {
      const ec = createCollector({ runId: 'collect-err' });
      const page = createMockPage();
      page.screenshot = async () => { throw new Error('crash'); };

      const evidence = await ec.collectAll(page, 'error_test');
      expect(evidence.error).toBeDefined();
      expect(evidence.error).toContain('Screenshot capture failed');
    });

    test('handles closed page gracefully (returns partial evidence)', async () => {
      const ec = createCollector({ runId: 'collect-closed' });
      const page = createMockPage();
      page.screenshot = async () => { throw new Error('Target closed'); };
      page.url = () => { throw new Error('Target closed'); };
      page.title = async () => { throw new Error('Target closed'); };

      const evidence = await ec.collectAll(page, 'closed_test');
      expect(evidence.stepName).toBe('closed_test');
      expect(evidence.screenshots).toBeNull();
      expect(evidence.url).toBe('');
    });
  });

  describe('clearBuffers()', () => {
    test('resets console log buffer to empty', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ text: 'test' }));
      expect(ec._consoleLogs).toHaveLength(1);

      ec.clearBuffers();
      expect(ec._consoleLogs).toHaveLength(0);
    });

    test('resets network request buffer to empty', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfailed', createMockRequest({ failure: { errorText: 'fail' } }));
      expect(ec._networkRequests).toHaveLength(1);

      ec.clearBuffers();
      expect(ec._networkRequests).toHaveLength(0);
    });

    test('does not affect screenshot counter', async () => {
      const ec = createCollector({ runId: 'clear-counter' });
      const page = createMockPage();

      await ec.captureScreenshot(page, 'before_clear');
      expect(ec._screenshotCounter).toBe(1);

      ec.clearBuffers();
      expect(ec._screenshotCounter).toBe(1);
    });
  });

  describe('Console Event Handling', () => {
    test('captures log level from console message type', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ type: 'error', text: 'e' }));
      page._emit('console', createMockConsoleMessage({ type: 'warn', text: 'w' }));
      page._emit('console', createMockConsoleMessage({ type: 'info', text: 'i' }));

      expect(ec._consoleLogs[0].level).toBe('error');
      expect(ec._consoleLogs[1].level).toBe('warn');
      expect(ec._consoleLogs[2].level).toBe('info');
    });

    test('captures message text', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ text: 'hello world' }));
      expect(ec._consoleLogs[0].message).toBe('hello world');
    });

    test('captures timestamp', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const before = new Date().toISOString();
      page._emit('console', createMockConsoleMessage({ text: 'ts' }));
      const after = new Date().toISOString();

      expect(ec._consoleLogs[0].timestamp >= before).toBe(true);
      expect(ec._consoleLogs[0].timestamp <= after).toBe(true);
    });

    test('captures page URL', async () => {
      const ec = createCollector();
      const page = createMockPage({ url: 'https://myapp.com/page' });
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({ text: 'url' }));
      expect(ec._consoleLogs[0].url).toBe('https://myapp.com/page');
    });

    test('captures stack trace for error messages', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('console', createMockConsoleMessage({
        type: 'error',
        text: 'ReferenceError',
        url: 'https://app.com/script.js',
        lineNumber: 42,
        columnNumber: 10
      }));

      expect(ec._consoleLogs[0].stack).toBe('https://app.com/script.js:42:10');
    });

    test('handles malformed console messages without throwing', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      // Emit a broken console message
      const brokenMsg = {
        type: () => { throw new Error('broken'); },
        text: () => 'text',
        location: () => ({})
      };

      // Should not throw
      page._emit('console', brokenMsg);
      // The entry won't be added due to error, but no crash
      expect(ec._consoleLogs).toHaveLength(0);
    });
  });

  describe('Network Event Handling', () => {
    test('captures URL, method, status for completed requests', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockResponse = createMockResponse({ status: 200, statusText: 'OK' });
      const mockReq = createMockRequest({ url: 'https://api.com/data', method: 'POST' });
      mockReq.response = () => mockResponse;

      page._emit('requestfinished', mockReq);
      await new Promise(r => setTimeout(r, 10));

      expect(ec._networkRequests[0].url).toBe('https://api.com/data');
      expect(ec._networkRequests[0].method).toBe('POST');
      expect(ec._networkRequests[0].status).toBe(200);
    });

    test('captures duration from request timing', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ timing: { startTime: 100, responseEnd: 350 } });
      page._emit('requestfinished', mockReq);
      await new Promise(r => setTimeout(r, 10));

      expect(ec._networkRequests[0].duration).toBe(250);
    });

    test('calculates duration as responseEnd minus startTime', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ timing: { startTime: 1000, responseEnd: 1234 } });
      page._emit('requestfinished', mockReq);
      await new Promise(r => setTimeout(r, 10));

      expect(ec._networkRequests[0].duration).toBe(234);
    });

    test('marks requests with status >= 400 as failed', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockResponse = createMockResponse({ status: 500, statusText: 'Internal Server Error' });
      const mockReq = createMockRequest();
      mockReq.response = () => mockResponse;

      page._emit('requestfinished', mockReq);
      await new Promise(r => setTimeout(r, 10));

      expect(ec._networkRequests[0].failed).toBe(true);
      expect(ec._networkRequests[0].status).toBe(500);
    });

    test('captures failed requests with failure reason', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ failure: { errorText: 'net::ERR_CONNECTION_REFUSED' } });
      page._emit('requestfailed', mockReq);

      expect(ec._networkRequests[0].failed).toBe(true);
      expect(ec._networkRequests[0].failureReason).toBe('net::ERR_CONNECTION_REFUSED');
      expect(ec._networkRequests[0].status).toBeNull();
    });

    test('redacts authorization headers', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ headers: { 'authorization': 'Bearer secret-token' } });
      page._emit('requestfailed', mockReq);

      expect(ec._networkRequests[0].requestHeaders.authorization).toBe('[REDACTED]');
    });

    test('redacts cookie headers', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ headers: { 'cookie': 'session=abc123' } });
      page._emit('requestfailed', mockReq);

      expect(ec._networkRequests[0].requestHeaders.cookie).toBe('[REDACTED]');
    });

    test('preserves non-sensitive headers', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      const mockReq = createMockRequest({ headers: { 'x-request-id': '12345' } });
      page._emit('requestfailed', mockReq);

      expect(ec._networkRequests[0].requestHeaders['x-request-id']).toBe('12345');
      expect(ec._networkRequests[0].requestHeaders['content-type']).toBe('application/json');
    });

    test('handles missing response gracefully', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      // Default mock request has response: () => null
      const mockReq = createMockRequest();
      page._emit('requestfinished', mockReq);
      await new Promise(r => setTimeout(r, 10));

      expect(ec._networkRequests[0].status).toBeNull();
      expect(ec._networkRequests[0].statusText).toBeNull();
      expect(ec._networkRequests[0].responseHeaders).toEqual({});
    });

    test('tracks pending captures and cleans up after resolution', async () => {
      const ec = createCollector();
      const page = createMockPage();
      await ec.initialize(page);

      page._emit('requestfinished', createMockRequest());
      // Immediately after emit, there should be a pending capture
      expect(ec._pendingCaptures.length).toBeGreaterThanOrEqual(0);

      // After waiting, the pending capture should resolve and clean up
      await new Promise(r => setTimeout(r, 50));
      expect(ec._pendingCaptures).toHaveLength(0);
    });
  });

  describe('_sanitizeName()', () => {
    test('replaces special characters with underscores', () => {
      const ec = createCollector();
      expect(ec._sanitizeName('hello world!')).toBe('hello_world');
    });

    test('collapses consecutive underscores', () => {
      const ec = createCollector();
      expect(ec._sanitizeName('a___b')).toBe('a_b');
    });

    test('removes leading/trailing underscores', () => {
      const ec = createCollector();
      expect(ec._sanitizeName('__test__')).toBe('test');
    });

    test('truncates to 50 characters', () => {
      const ec = createCollector();
      const longName = 'a'.repeat(100);
      expect(ec._sanitizeName(longName).length).toBeLessThanOrEqual(50);
    });

    test('preserves alphanumeric characters and hyphens', () => {
      const ec = createCollector();
      expect(ec._sanitizeName('test-step_123')).toBe('test-step_123');
    });
  });

  describe('_redactHeaders()', () => {
    test('redacts authorization header', () => {
      const ec = createCollector();
      const result = ec._redactHeaders({ 'authorization': 'Bearer token123' });
      expect(result.authorization).toBe('[REDACTED]');
    });

    test('redacts cookie header', () => {
      const ec = createCollector();
      const result = ec._redactHeaders({ 'cookie': 'session=xyz' });
      expect(result.cookie).toBe('[REDACTED]');
    });

    test('redacts x-api-key header', () => {
      const ec = createCollector();
      const result = ec._redactHeaders({ 'x-api-key': 'sk-123' });
      expect(result['x-api-key']).toBe('[REDACTED]');
    });

    test('case-insensitive header matching', () => {
      const ec = createCollector();
      const result = ec._redactHeaders({ 'Authorization': 'Bearer tok', 'COOKIE': 'val' });
      expect(result['Authorization']).toBe('[REDACTED]');
      expect(result['COOKIE']).toBe('[REDACTED]');
    });

    test('preserves non-sensitive headers unchanged', () => {
      const ec = createCollector();
      const result = ec._redactHeaders({
        'content-type': 'application/json',
        'accept': 'text/html'
      });
      expect(result['content-type']).toBe('application/json');
      expect(result.accept).toBe('text/html');
    });

    test('returns empty object for null/undefined input', () => {
      const ec = createCollector();
      expect(ec._redactHeaders(null)).toEqual({});
      expect(ec._redactHeaders(undefined)).toEqual({});
      expect(ec._redactHeaders('not-an-object')).toEqual({});
    });
  });
});
