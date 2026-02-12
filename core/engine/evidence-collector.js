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
    this._pendingCaptures = [];
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
      // Await any in-flight network capture promises before writing
      await Promise.allSettled(this._pendingCaptures);
      this._pendingCaptures = [];

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
   * @returns {Promise<object>} Evidence package (see spec Section 4.3 for structure)
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
   * In Playwright v1.58, request.response() is synchronous and returns Response | null.
   * @param {import('playwright').Request} request
   */
  _onRequestFinished(request) {
    try {
      const response = request.response();

      // Track the async capture promise so cleanup can await it
      const promise = this._captureRequest(request, response);
      this._pendingCaptures.push(promise);
      promise
        .catch(err => {
          console.error('[EvidenceCollector] Request capture error:', err.message);
        })
        .finally(() => {
          this._pendingCaptures = this._pendingCaptures.filter(p => p !== promise);
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
   * @param {import('playwright').Response|null} response - Response object (synchronous in Playwright v1.58)
   */
  async _captureRequest(request, response) {
    const status = response ? response.status() : null;

    // Calculate duration from timing data
    // request.timing() returns timestamps, not durations.
    // Duration = responseEnd - startTime. Both may be -1 if unavailable.
    const timing = request.timing();
    let duration = 0;
    if (timing && timing.responseEnd > 0 && timing.startTime >= 0) {
      duration = Math.round(timing.responseEnd - timing.startTime);
    }

    const entry = {
      url: request.url(),
      method: request.method(),
      status,
      statusText: response ? response.statusText() : null,
      duration,
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
   * Replaces non-alphanumeric characters (except underscores and hyphens) with
   * underscores, collapses runs, and truncates to 50 chars.
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
