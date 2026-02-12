# QA Engine: Evidence Collector Implementation Specification

**Phase:** 1, Week 1, Days 1-2  
**Purpose:** Implementation-ready spec for `core/engine/evidence-collector.js`  
**For:** Claude Code evaluation → implementation  
**References:** qa-engine-02-core-engine-spec.md (Section 4), qa-engine-04-database-schema-spec.md (evidence_metadata table)  
**Depends on:** Nothing — no internal QA Engine dependencies. Uses Playwright and filesystem only.  
**Depended on by:** `connectors/base-connector.js` (already implemented — delegates 4 methods to this class)

---

## 1. Design Decisions

### Role in the System

The Evidence Collector is the **debugging backbone** of QA Engine. Every test step, every failure, every bug report depends on evidence it captures. It sits between the connector layer (which triggers captures) and the storage layer (filesystem + eventually database metadata).

```
Connector calls this.evidence.collectAll(page, stepName)
    ↓
EvidenceCollector captures screenshot + logs + network + metadata
    ↓
Writes files to disk in organized directory structure
    ↓
Returns evidence package object (paths + data)
    ↓
Bug Detector / Test Orchestrator use evidence for analysis
```

### Key Design Principles

1. **Never fail the test.** Evidence collection errors must never cause a test to fail. If a screenshot can't be captured, return partial evidence with error metadata — don't throw.

2. **Files on disk, metadata in memory.** Screenshots go to disk immediately. Logs and network data stay in memory (arrays) until flushed or returned. Database metadata (the `evidence_metadata` table) is a Phase 2 concern — for now, the filesystem IS the persistence layer.

3. **One collector per test run.** Each test run gets its own EvidenceCollector instance. The collector is initialized with a `runId` and `appId`, which determine the storage directory. Console and network listeners are bound to a specific Playwright page.

4. **Continuous capture, on-demand snapshots.** Console logs and network requests are captured continuously via Playwright event listeners attached during `initialize()`. Screenshots are captured on demand when `captureScreenshot()` is called.

### Interface Contract (from BaseConnector)

BaseConnector's implemented evidence methods delegate directly to these four methods. The signatures are already locked in:

```javascript
// These are the EXACT method signatures BaseConnector calls:
evidence.captureScreenshot(page, name)   → Promise<string>     // returns file path
evidence.getConsoleLogs()                → Promise<Array>      // returns log entries
evidence.getNetworkRequests()            → Promise<Array>      // returns request entries
evidence.collectAll(page, stepName)      → Promise<Object>     // returns full evidence package
```

Any changes to these signatures would break BaseConnector. They are the public API.

---

## 2. Complete Method Inventory

### 2.1 Lifecycle Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `constructor(config)` | `new EvidenceCollector({ runId, appId, basePath? })` | Set up storage paths and internal buffers. |
| `initialize(page)` | `async initialize(page: Page) → void` | Attach console and network listeners to Playwright page. Must be called once before any capture methods. |
| `cleanup()` | `async cleanup() → void` | Flush any pending data, remove listeners, optionally write summary index file. |

### 2.2 Capture Methods (Public API — called by BaseConnector)

| Method | Signature | Returns | Purpose |
|--------|-----------|---------|---------|
| `captureScreenshot(page, name)` | `async (Page, string) → string` | File path | Take full-page + viewport screenshots. Write to disk immediately. |
| `getConsoleLogs()` | `async () → Array` | Log entries | Return accumulated console log buffer. |
| `getNetworkRequests()` | `async () → Array` | Request entries | Return accumulated network request buffer. |
| `collectAll(page, stepName)` | `async (Page, string) → Object` | Evidence package | Capture screenshot + return logs + network + metadata in one call. |

### 2.3 Storage Methods (Internal)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `_ensureDirectories()` | `async () → void` | Create evidence directory structure on first use. |
| `_generateFilename(name, extension)` | `(string, string) → string` | Generate unique, sortable filename with timestamp. |
| `_writeIndex()` | `async () → void` | Write `index.json` summary file to the run's evidence directory. |

### 2.4 Buffer Management Methods (Internal)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `_onConsoleMessage(msg)` | `(ConsoleMessage) → void` | Playwright `page.on('console')` handler. Pushes to log buffer. |
| `_onRequestFinished(request)` | `(Request) → void` | Playwright `page.on('requestfinished')` handler. Pushes to network buffer. |
| `_onRequestFailed(request)` | `(Request) → void` | Playwright `page.on('requestfailed')` handler. Pushes failed request to network buffer. |
| `clearBuffers()` | `() → void` | Reset log and network buffers. Called between test scenarios if needed. |

---

## 3. Directory Structure

Each test run gets its own directory under the configured evidence base path:

```
evidence/
└── {appId}/
    └── {runId}/
        ├── screenshots/
        │   ├── 001_before_initialize_1707600000000_full.png
        │   ├── 001_before_initialize_1707600000000_viewport.png
        │   ├── 002_after_authenticate_1707600001000_full.png
        │   └── ...
        ├── logs/
        │   └── console.json          (written on cleanup)
        ├── network/
        │   └── requests.json         (written on cleanup)
        └── index.json                (written on cleanup — summary of all evidence)
```

### Filename Convention

Screenshots use a sequential counter + step name + timestamp for sortability:

```
{counter}_{stepName}_{timestamp}_{type}.png
```

- **counter**: 3-digit zero-padded (001, 002, ...) — ensures filesystem sort order matches capture order
- **stepName**: Sanitized (alphanumeric + underscores only, truncated to 50 chars)
- **timestamp**: Unix milliseconds — ensures uniqueness
- **type**: `full` or `viewport`

---

## 4. Data Structures

### 4.1 Console Log Entry

```javascript
{
  level: 'error',              // 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: 'Failed to fetch /api/stories',
  source: 'console',           // Always 'console' for page console messages
  timestamp: '2026-02-11T10:00:00.123Z',
  url: 'https://staging.brainstormy.app/dashboard',  // Page URL when logged
  stack: null                  // Stack trace if available (errors)
}
```

### 4.2 Network Request Entry

```javascript
{
  url: 'https://staging.brainstormy.app/api/stories',
  method: 'GET',
  status: 500,                 // HTTP status code, null if request failed before response
  statusText: 'Internal Server Error',
  duration: 234,               // ms from request start to response end
  resourceType: 'fetch',       // 'document' | 'fetch' | 'xhr' | 'stylesheet' | 'script' | 'image' | etc.
  failed: true,                // true if status >= 400 or request failed entirely
  failureReason: null,         // Playwright failure text if request didn't complete
  timestamp: '2026-02-11T10:00:00.456Z',
  requestHeaders: { 'Authorization': '[REDACTED]', 'Content-Type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' }
}
```

### 4.3 Evidence Package (returned by `collectAll`)

```javascript
{
  stepName: 'before_click_1707600000000',
  timestamp: '2026-02-11T10:00:00.000Z',
  
  // Screenshots
  screenshots: {
    full: '/evidence/brainstormy/run-123/screenshots/003_before_click_1707600000000_full.png',
    viewport: '/evidence/brainstormy/run-123/screenshots/003_before_click_1707600000000_viewport.png'
  },
  
  // Accumulated buffers (snapshots at this point in time)
  consoleLogs: [ ...all log entries so far... ],
  networkRequests: [ ...all request entries so far... ],
  
  // Page metadata
  url: 'https://staging.brainstormy.app/dashboard',
  pageTitle: 'Brainstormy - Dashboard',
  viewport: { width: 1280, height: 720 },
  
  // Counts for quick assessment
  summary: {
    totalLogs: 12,
    errorLogs: 2,
    warnLogs: 1,
    totalRequests: 45,
    failedRequests: 1
  }
}
```

### 4.4 Index File Structure (written on cleanup)

```javascript
{
  runId: 'run-123',
  appId: 'brainstormy',
  startedAt: '2026-02-11T10:00:00.000Z',
  completedAt: '2026-02-11T10:05:30.000Z',
  
  evidence: {
    screenshotCount: 24,
    screenshots: [
      { name: 'before_initialize', path: 'screenshots/001_before_initialize_...full.png', timestamp: '...' },
      // ...
    ],
    consoleLogCount: 47,
    consoleErrorCount: 3,
    networkRequestCount: 156,
    failedRequestCount: 2
  },
  
  paths: {
    screenshots: 'screenshots/',
    logs: 'logs/console.json',
    network: 'network/requests.json'
  }
}
```

---

## 5. Sensitive Data Handling

Network requests often contain auth tokens, API keys, and user data. The evidence collector must sanitize before storing.

### Redaction Rules

```javascript
const REDACT_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token'
];

const REDACT_BODY_FIELDS = [
  'password',
  'token',
  'secret',
  'api_key',
  'apiKey',
  'access_token',
  'refresh_token'
];
```

**Header redaction:** Any header whose lowercase key is in `REDACT_HEADERS` gets its value replaced with `'[REDACTED]'`.

**Body redaction:** Not implemented in Phase 1 — request/response bodies are not captured (too large, too variable). Only headers, URL, status, and timing are stored.

**URL parameters:** Not redacted in Phase 1 — URLs are stored as-is. If a URL contains a token as a query parameter, it will be visible in evidence. This is acceptable for a self-hosted QA tool; revisit for SaaS (Phase 3).

---

## 6. Error Handling Strategy

### The Golden Rule: Never Fail the Test

Evidence collection is a **support function**. If it fails, the test should continue. Every public method follows this pattern:

```javascript
async captureScreenshot(page, name) {
  try {
    return await this._captureScreenshotUnsafe(page, name);
  } catch (error) {
    console.error(`[EvidenceCollector] Screenshot capture failed for "${name}":`, error.message);
    return null;  // Caller handles null gracefully
  }
}
```

### Error Return Conventions

| Method | On success | On failure |
|--------|-----------|------------|
| `captureScreenshot()` | File path string | `null` |
| `getConsoleLogs()` | Array of entries | `[]` (empty array) |
| `getNetworkRequests()` | Array of entries | `[]` (empty array) |
| `collectAll()` | Full evidence package | Partial package with `error` field |

### Partial Evidence Package

When `collectAll()` encounters an error, it returns whatever it could capture:

```javascript
{
  stepName: 'failed_step',
  timestamp: '2026-02-11T10:00:00.000Z',
  screenshots: null,           // Screenshot failed
  consoleLogs: [...],          // These still worked
  networkRequests: [...],      // These still worked
  url: 'about:blank',
  pageTitle: '',
  viewport: null,
  summary: { ... },
  error: 'Screenshot capture failed: page closed',
  errorDetails: 'Protocol error: Target closed'
}
```

---

## 7. Complete Implementation

```javascript
// core/engine/evidence-collector.js

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Captures and stores debugging evidence during test execution.
 * 
 * One instance per test run. Attaches to a Playwright page to continuously
 * capture console logs and network requests. Screenshots are captured on demand.
 * 
 * CRITICAL: Evidence collection must NEVER cause a test to fail.
 * All public methods catch errors and return partial/empty results.
 * 
 * @example
 * const collector = new EvidenceCollector({ runId: 'run-123', appId: 'brainstormy' });
 * await collector.initialize(page);
 * const screenshot = await collector.captureScreenshot(page, 'after_login');
 * const evidence = await collector.collectAll(page, 'verify_dashboard');
 * await collector.cleanup();
 */
class EvidenceCollector {
  /**
   * @param {object} config
   * @param {string} config.runId - Unique test run identifier
   * @param {string} config.appId - Application identifier
   * @param {string} [config.basePath='./evidence'] - Root directory for evidence storage
   */
  constructor({ runId, appId, basePath = './evidence' }) {
    this.runId = runId;
    this.appId = appId;
    this.basePath = basePath;

    // Computed paths
    this.runPath = path.join(basePath, appId, runId);
    this.screenshotPath = path.join(this.runPath, 'screenshots');
    this.logPath = path.join(this.runPath, 'logs');
    this.networkPath = path.join(this.runPath, 'network');

    // Internal buffers
    this._consoleLogs = [];
    this._networkRequests = [];
    this._screenshotCounter = 0;
    this._startedAt = new Date().toISOString();

    // Listener references (for cleanup/removal)
    this._consoleListener = null;
    this._requestFinishedListener = null;
    this._requestFailedListener = null;
    this._page = null;

    // State
    this._initialized = false;
    this._directoriesCreated = false;
  }

  // ===================================================================
  // LIFECYCLE
  // ===================================================================

  /**
   * Attach console and network listeners to a Playwright page.
   * Must be called once before any capture methods.
   * 
   * @param {import('playwright').Page} page - Playwright page instance
   */
  async initialize(page) {
    this._page = page;

    // Bind listeners (store references for removal in cleanup)
    this._consoleListener = (msg) => this._onConsoleMessage(msg);
    this._requestFinishedListener = (request) => this._onRequestFinished(request);
    this._requestFailedListener = (request) => this._onRequestFailed(request);

    page.on('console', this._consoleListener);
    page.on('requestfinished', this._requestFinishedListener);
    page.on('requestfailed', this._requestFailedListener);

    this._initialized = true;
  }

  /**
   * Flush pending data, write summary files, remove listeners.
   * Safe to call multiple times.
   */
  async cleanup() {
    // Remove listeners
    if (this._page && this._consoleListener) {
      try {
        this._page.off('console', this._consoleListener);
        this._page.off('requestfinished', this._requestFinishedListener);
        this._page.off('requestfailed', this._requestFailedListener);
      } catch (error) {
        // Page may already be closed — that's fine
        console.error('[EvidenceCollector] Listener removal failed:', error.message);
      }
    }

    // Write accumulated data to disk
    try {
      await this._ensureDirectories();

      // Write console logs
      const logFile = path.join(this.logPath, 'console.json');
      await fs.promises.writeFile(logFile, JSON.stringify(this._consoleLogs, null, 2));

      // Write network requests
      const networkFile = path.join(this.networkPath, 'requests.json');
      await fs.promises.writeFile(networkFile, JSON.stringify(this._networkRequests, null, 2));

      // Write index
      await this._writeIndex();
    } catch (error) {
      console.error('[EvidenceCollector] Cleanup write failed:', error.message);
    }

    // Clear references
    this._page = null;
    this._consoleListener = null;
    this._requestFinishedListener = null;
    this._requestFailedListener = null;
    this._initialized = false;
  }

  // ===================================================================
  // PUBLIC API — Called by BaseConnector
  // ===================================================================

  /**
   * Capture full-page and viewport screenshots.
   * 
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {string} name - Descriptive step name (e.g., 'after_login', 'before_click')
   * @returns {Promise<string|null>} Path to full-page screenshot, or null on failure
   */
  async captureScreenshot(page, name) {
    try {
      await this._ensureDirectories();

      this._screenshotCounter++;
      const counter = String(this._screenshotCounter).padStart(3, '0');
      const safeName = this._sanitizeName(name);
      const timestamp = Date.now();

      // Full-page screenshot
      const fullFilename = `${counter}_${safeName}_${timestamp}_full.png`;
      const fullPath = path.join(this.screenshotPath, fullFilename);
      await page.screenshot({ path: fullPath, fullPage: true });

      // Viewport-only screenshot
      const viewportFilename = `${counter}_${safeName}_${timestamp}_viewport.png`;
      const viewportPath = path.join(this.screenshotPath, viewportFilename);
      await page.screenshot({ path: viewportPath, fullPage: false });

      return fullPath;
    } catch (error) {
      console.error(`[EvidenceCollector] Screenshot failed for "${name}":`, error.message);
      return null;
    }
  }

  /**
   * Return accumulated console log entries.
   * Returns a shallow copy to prevent external mutation.
   * 
   * @returns {Promise<Array<{level: string, message: string, source: string, timestamp: string, url: string, stack: string|null}>>}
   */
  async getConsoleLogs() {
    try {
      return [...this._consoleLogs];
    } catch (error) {
      console.error('[EvidenceCollector] getConsoleLogs failed:', error.message);
      return [];
    }
  }

  /**
   * Return accumulated network request entries.
   * Returns a shallow copy to prevent external mutation.
   * 
   * @returns {Promise<Array<{url: string, method: string, status: number|null, duration: number, resourceType: string, failed: boolean, failureReason: string|null, timestamp: string}>>}
   */
  async getNetworkRequests() {
    try {
      return [...this._networkRequests];
    } catch (error) {
      console.error('[EvidenceCollector] getNetworkRequests failed:', error.message);
      return [];
    }
  }

  /**
   * Capture complete evidence package: screenshot + logs + network + metadata.
   * This is the primary method called by BaseConnector.collectEvidence().
   * 
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {string} stepName - Descriptive step name
   * @returns {Promise<object>} Evidence package (see Section 4.3 for structure)
   */
  async collectAll(page, stepName) {
    const timestamp = new Date().toISOString();
    let screenshotResult = null;
    let url = '';
    let pageTitle = '';
    let viewport = null;

    // Screenshot (may fail — that's OK)
    try {
      const fullPath = await this.captureScreenshot(page, stepName);
      if (fullPath) {
        const viewportPath = fullPath.replace('_full.png', '_viewport.png');
        screenshotResult = { full: fullPath, viewport: viewportPath };
      }
    } catch (error) {
      // Already logged inside captureScreenshot
    }

    // Page metadata (may fail if page is closed)
    try {
      url = page.url();
      pageTitle = await page.title();
      viewport = page.viewportSize();
    } catch (error) {
      console.error(`[EvidenceCollector] Page metadata failed for "${stepName}":`, error.message);
    }

    // Logs and network (always available from buffers)
    const consoleLogs = await this.getConsoleLogs();
    const networkRequests = await this.getNetworkRequests();

    // Build summary counts
    const summary = {
      totalLogs: consoleLogs.length,
      errorLogs: consoleLogs.filter(l => l.level === 'error').length,
      warnLogs: consoleLogs.filter(l => l.level === 'warn' || l.level === 'warning').length,
      totalRequests: networkRequests.length,
      failedRequests: networkRequests.filter(r => r.failed).length
    };

    const evidence = {
      stepName,
      timestamp,
      screenshots: screenshotResult,
      consoleLogs,
      networkRequests,
      url,
      pageTitle,
      viewport,
      summary
    };

    // Add error field if screenshot failed
    if (!screenshotResult) {
      evidence.error = 'Screenshot capture failed or returned null';
    }

    return evidence;
  }

  // ===================================================================
  // BUFFER MANAGEMENT — Internal
  // ===================================================================

  /**
   * Clear log and network buffers.
   * Use between test scenarios within the same run if needed.
   */
  clearBuffers() {
    this._consoleLogs = [];
    this._networkRequests = [];
  }

  // ===================================================================
  // EVENT LISTENERS — Internal
  // ===================================================================

  /**
   * Handle Playwright page console events.
   * @param {import('playwright').ConsoleMessage} msg
   */
  _onConsoleMessage(msg) {
    try {
      const entry = {
        level: msg.type(),  // 'log', 'info', 'warning', 'error', 'debug', etc.
        message: msg.text(),
        source: 'console',
        timestamp: new Date().toISOString(),
        url: this._page?.url() ?? '',
        stack: null
      };

      // Attempt to get stack trace for errors
      if (msg.type() === 'error') {
        const location = msg.location();
        if (location && location.url) {
          entry.stack = `${location.url}:${location.lineNumber}:${location.columnNumber}`;
        }
      }

      this._consoleLogs.push(entry);
    } catch (error) {
      // Never fail silently but also never propagate
      console.error('[EvidenceCollector] Console capture error:', error.message);
    }
  }

  /**
   * Handle completed network requests.
   * @param {import('playwright').Request} request
   */
  _onRequestFinished(request) {
    try {
      const response = request.response ? request.response() : null;
      
      // Build entry asynchronously but don't await in the listener
      this._captureRequest(request, response).catch(err => {
        console.error('[EvidenceCollector] Request capture error:', err.message);
      });
    } catch (error) {
      console.error('[EvidenceCollector] Request finished handler error:', error.message);
    }
  }

  /**
   * Handle failed network requests (no response received).
   * @param {import('playwright').Request} request
   */
  _onRequestFailed(request) {
    try {
      const entry = {
        url: request.url(),
        method: request.method(),
        status: null,
        statusText: null,
        duration: 0,
        resourceType: request.resourceType(),
        failed: true,
        failureReason: request.failure()?.errorText ?? 'Unknown failure',
        timestamp: new Date().toISOString(),
        requestHeaders: this._redactHeaders(request.headers()),
        responseHeaders: {}
      };

      this._networkRequests.push(entry);
    } catch (error) {
      console.error('[EvidenceCollector] Request failed handler error:', error.message);
    }
  }

  /**
   * Capture request/response details for a completed request.
   * @param {import('playwright').Request} request
   * @param {Promise<import('playwright').Response|null>} responsePromise
   */
  async _captureRequest(request, responsePromise) {
    let response = null;
    try {
      response = await responsePromise;
    } catch (error) {
      // Response may not be available
    }

    const status = response ? response.status() : null;
    const entry = {
      url: request.url(),
      method: request.method(),
      status,
      statusText: response ? response.statusText() : null,
      duration: request.timing()?.responseEnd ?? 0,
      resourceType: request.resourceType(),
      failed: status !== null && status >= 400,
      failureReason: null,
      timestamp: new Date().toISOString(),
      requestHeaders: this._redactHeaders(request.headers()),
      responseHeaders: response ? this._redactHeaders(await response.allHeaders()) : {}
    };

    this._networkRequests.push(entry);
  }

  // ===================================================================
  // STORAGE — Internal
  // ===================================================================

  /**
   * Create evidence directory structure on first use.
   * Idempotent — safe to call multiple times.
   */
  async _ensureDirectories() {
    if (this._directoriesCreated) return;

    await fs.promises.mkdir(this.screenshotPath, { recursive: true });
    await fs.promises.mkdir(this.logPath, { recursive: true });
    await fs.promises.mkdir(this.networkPath, { recursive: true });

    this._directoriesCreated = true;
  }

  /**
   * Write index.json summary file.
   */
  async _writeIndex() {
    const screenshots = [];
    try {
      const files = await fs.promises.readdir(this.screenshotPath);
      for (const file of files.filter(f => f.endsWith('_full.png'))) {
        screenshots.push({
          name: file.replace(/_full\.png$/, ''),
          path: `screenshots/${file}`,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      // Screenshots dir may not exist if none were captured
    }

    const index = {
      runId: this.runId,
      appId: this.appId,
      startedAt: this._startedAt,
      completedAt: new Date().toISOString(),
      evidence: {
        screenshotCount: screenshots.length,
        screenshots,
        consoleLogCount: this._consoleLogs.length,
        consoleErrorCount: this._consoleLogs.filter(l => l.level === 'error').length,
        networkRequestCount: this._networkRequests.length,
        failedRequestCount: this._networkRequests.filter(r => r.failed).length
      },
      paths: {
        screenshots: 'screenshots/',
        logs: 'logs/console.json',
        network: 'network/requests.json'
      }
    };

    const indexPath = path.join(this.runPath, 'index.json');
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  // ===================================================================
  // UTILITIES — Internal
  // ===================================================================

  /**
   * Sanitize a step name for use in filenames.
   * Replaces non-alphanumeric characters with underscores, truncates to 50 chars.
   * 
   * @param {string} name - Raw step name
   * @returns {string} Filesystem-safe name
   */
  _sanitizeName(name) {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
  }

  /**
   * Redact sensitive headers.
   * 
   * @param {object} headers - Header key-value pairs
   * @returns {object} Headers with sensitive values replaced by '[REDACTED]'
   */
  _redactHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};

    const REDACT_KEYS = [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'x-csrf-token'
    ];

    const redacted = {};
    for (const [key, value] of Object.entries(headers)) {
      redacted[key] = REDACT_KEYS.includes(key.toLowerCase())
        ? '[REDACTED]'
        : value;
    }
    return redacted;
  }
}

module.exports = EvidenceCollector;
```

---

## 8. Unit Test Specification

```javascript
// tests/engine/evidence-collector.test.js — Test outline

describe('EvidenceCollector', () => {

  describe('Constructor', () => {
    test('sets runId, appId, basePath from config');
    test('computes runPath, screenshotPath, logPath, networkPath correctly');
    test('initializes empty buffers');
    test('sets _screenshotCounter to 0');
    test('basePath defaults to ./evidence when not provided');
  });

  describe('initialize()', () => {
    test('attaches console listener to page');
    test('attaches requestfinished listener to page');
    test('attaches requestfailed listener to page');
    test('sets _initialized to true');
    test('stores page reference');
  });

  describe('cleanup()', () => {
    test('removes all listeners from page');
    test('writes console.json to logs directory');
    test('writes requests.json to network directory');
    test('writes index.json to run directory');
    test('sets _initialized to false');
    test('clears page reference');
    test('safe to call multiple times');
    test('handles page already closed gracefully');
  });

  describe('captureScreenshot()', () => {
    test('creates screenshots directory on first call');
    test('captures full-page screenshot');
    test('captures viewport screenshot');
    test('returns full-page screenshot path');
    test('increments screenshot counter');
    test('generates filename with counter, name, timestamp');
    test('sanitizes step name in filename');
    test('returns null on failure (does not throw)');
  });

  describe('getConsoleLogs()', () => {
    test('returns empty array before any console events');
    test('returns accumulated log entries');
    test('returns shallow copy (not internal buffer reference)');
    test('returns empty array on error (does not throw)');
  });

  describe('getNetworkRequests()', () => {
    test('returns empty array before any network events');
    test('returns accumulated request entries');
    test('returns shallow copy (not internal buffer reference)');
    test('returns empty array on error (does not throw)');
  });

  describe('collectAll()', () => {
    test('returns complete evidence package');
    test('includes screenshot paths');
    test('includes consoleLogs array');
    test('includes networkRequests array');
    test('includes page URL, title, viewport');
    test('includes summary counts');
    test('returns partial evidence when screenshot fails');
    test('includes error field when screenshot fails');
    test('handles closed page gracefully (returns partial evidence)');
  });

  describe('clearBuffers()', () => {
    test('resets console log buffer to empty');
    test('resets network request buffer to empty');
    test('does not affect screenshot counter');
  });

  describe('Console Event Handling', () => {
    test('captures log level from console message type');
    test('captures message text');
    test('captures timestamp');
    test('captures page URL');
    test('captures stack trace for error messages');
    test('handles malformed console messages without throwing');
  });

  describe('Network Event Handling', () => {
    test('captures URL, method, status for completed requests');
    test('captures duration from request timing');
    test('marks requests with status >= 400 as failed');
    test('captures failed requests with failure reason');
    test('redacts authorization headers');
    test('redacts cookie headers');
    test('preserves non-sensitive headers');
    test('handles missing response gracefully');
  });

  describe('_sanitizeName()', () => {
    test('replaces special characters with underscores');
    test('collapses consecutive underscores');
    test('removes leading/trailing underscores');
    test('truncates to 50 characters');
    test('preserves alphanumeric characters and hyphens');
  });

  describe('_redactHeaders()', () => {
    test('redacts authorization header');
    test('redacts cookie header');
    test('redacts x-api-key header');
    test('case-insensitive header matching');
    test('preserves non-sensitive headers unchanged');
    test('returns empty object for null/undefined input');
  });
});
```

---

## 9. Mocking Strategy for Tests

Tests need to mock Playwright's `Page`, `ConsoleMessage`, `Request`, and `Response` objects. Here's the mock factory:

```javascript
// tests/helpers/mock-playwright.js

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
    timing: () => timing ?? { responseEnd: 150 },
    failure: () => failure ?? null,
    response: () => Promise.resolve(null)  // Override per test
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
```

---

## 10. Implementation Order for Claude Code

### Step 1: Directory and Helpers

| Task | Details |
|------|---------|
| Create `core/engine/` directory | If it doesn't exist already |
| Create `tests/engine/` directory | For evidence collector tests |
| Create `tests/helpers/` directory | For shared test utilities |
| Create `tests/helpers/mock-playwright.js` | Mock factory from Section 9 |

### Step 2: Implementation

| # | File | Purpose |
|---|------|---------|
| 1 | `core/engine/evidence-collector.js` | Full implementation from Section 7 |
| 2 | `tests/engine/evidence-collector.test.js` | Tests from Section 8, using mocks from Section 9 |

### Step 3: Validation

```bash
# Run tests
npm test -- --testPathPattern=evidence-collector

# Verify the module loads and exports correctly
node -e "const EC = require('./core/engine/evidence-collector'); const ec = new EC({ runId: 'test', appId: 'test' }); console.log('OK:', typeof ec.captureScreenshot);"

# Verify evidence directory creation
node -e "
  const EC = require('./core/engine/evidence-collector');
  const ec = new EC({ runId: 'verify-test', appId: 'verify-app', basePath: './tmp-evidence' });
  ec._ensureDirectories().then(() => {
    const fs = require('fs');
    console.log('Dirs created:', fs.existsSync('./tmp-evidence/verify-app/verify-test/screenshots'));
    fs.rmSync('./tmp-evidence', { recursive: true });
  });
"
```

---

## 11. Claude Code Implementation Notes

1. **No internal QA Engine dependencies.** EvidenceCollector uses only `fs`, `path`, and Playwright types. It does not import anything from `connectors/`, `core/`, or `agents/`. This makes it independently testable.

2. **The four public API methods are locked.** `captureScreenshot(page, name)`, `getConsoleLogs()`, `getNetworkRequests()`, and `collectAll(page, stepName)` — these signatures match what BaseConnector already calls. Do not change them.

3. **Playwright event listener pattern.** `page.on('console', handler)` and `page.on('requestfinished', handler)` are the standard Playwright APIs. The `_onRequestFinished` handler deals with the async response promise carefully — `request.response()` returns a Promise in some Playwright versions and a direct value in others. The implementation handles both by wrapping in `_captureRequest()`.

4. **`_onRequestFinished` async subtlety.** The listener itself is synchronous (Playwright calls it synchronously), but capturing the response requires awaiting. The pattern is to call `this._captureRequest(request, responsePromise).catch(...)` — fire-and-forget with error suppression. This means network entries may arrive slightly out of order. That's acceptable.

5. **Screenshot writes are synchronous to the test flow.** Unlike network captures, `captureScreenshot()` is awaited. This ensures the screenshot is on disk before the evidence package is returned. The test pauses briefly for I/O — this is intentional and necessary.

6. **Filesystem cleanup is NOT implemented here.** The cleanup in this spec is about flushing buffers and writing summary files. Evidence retention/deletion (the 30-day cleanup from qa-engine-02-core-engine-spec.md) is a separate concern that lives in a scheduled job, not in the collector.

7. **Tests should use a temporary directory.** Use `os.tmpdir()` or a `tmp-evidence-*` directory created in `beforeAll()` and cleaned up in `afterAll()`. Never write to `./evidence/` during tests.

8. **Apply the two robustness fixes from the feasibility review:**
   - In `_onRequestFinished`: Playwright's `request.response()` may return a Promise or a direct Response depending on how it's called. Handle both cases.
   - Consider that `request.timing()` may return `null` on some request types — default `duration` to `0` when timing is unavailable.

---

## 12. What Comes Next

After EvidenceCollector is built and tested:

- **Same sprint (Days 1-2):** `GenericWebAppConnector` — implements all BaseConnector abstract methods with Playwright, uses real EvidenceCollector
- **Integration test:** Verify BaseConnector → EvidenceCollector delegation works end-to-end with a live Playwright page
- **Days 3-4:** `AIAppConnector` — builds on GenericWebAppConnector with chat-specific evidence patterns (e.g., capturing AI response timing)
