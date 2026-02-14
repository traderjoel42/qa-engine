'use strict';

const AIAppConnector = require('../ai-chat-app/connector');
const {
  ConnectorError
} = require('../errors');

/**
 * Connector for Brainstormy — AI-powered story development platform.
 *
 * Adds Brainstormy-specific workflows on top of AIAppConnector:
 * - Create and navigate projects, stories, sessions
 * - Generate story bibles with template selection
 * - Extract session summaries
 * - Extract citation data from AI responses
 * - Clerk authentication via email/password
 * - Test data management (setup project, archive data)
 *
 * Selectors are resolved via getSelector() which checks:
 *   1. connector.config.selectors in app.config.json (camelCase keys)
 *   2. DEFAULT_SELECTORS from ./selectors.js (fallback)
 *
 * Inheritance chain:
 *   BaseConnector → GenericWebAppConnector → AIAppConnector → BrainstormyConnector (this)
 *
 * @example
 * const connector = new BrainstormyConnector(brainstormyConfig, page, evidenceCollector);
 * await connector.initialize();
 * await connector.performAction('create_project', { name: 'My Novel' });
 * await connector.performAction('create_story', { name: 'Chapter 1', vertical: 'novel' });
 * await connector.performAction('create_session', { type: 'explore' });
 * await connector.performAction('send_message', { text: 'A detective arrives at...' });
 * const response = await connector.performAction('wait_for_response');
 * // response.citations contains extracted citation data
 */
class BrainstormyConnector extends AIAppConnector {

  // ===================================================================
  // CONSTRUCTOR — State tracking for entity management
  // ===================================================================

  /**
   * @param {Object} app - App configuration
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {Object} evidenceCollector - Evidence collection service
   */
  constructor(app, page, evidenceCollector) {
    super(app, page, evidenceCollector);

    /** @type {string|null} */
    this.currentProjectId = null;
    /** @type {string|null} */
    this.currentStoryId = null;
    /** @type {string|null} */
    this.currentSessionId = null;
    /** @type {Array<{type: string, id: string, name: string}>} Created entity IDs for cleanup */
    this.createdEntities = [];
  }

  // ===================================================================
  // LIFECYCLE
  // ===================================================================

  /**
   * Override base getBaseURL() which reads environments[env].url (wrong key).
   * Our config uses baseUrl at both top-level and environment level.
   */
  getBaseURL() {
    const env = this.app.activeEnvironment ?? 'staging';
    return this.app.environments?.[env]?.baseUrl || this.app.baseUrl;
  }

  /**
   * Wake up the target service if it's been idle (Render cold start).
   * Performs a plain HTTP GET with generous timeout before browser nav.
   *
   * NOTE: The 'timeout' option on https.get() sets the socket inactivity timeout,
   * not a hard deadline. For Render cold starts where the TCP connection succeeds
   * but the HTTP response takes 30-60s, this works because the socket remains
   * active during the server startup. If the connection itself hangs (no TCP
   * handshake), we add an explicit setTimeout as a hard deadline.
   */
  async warmUp() {
    const url = this.getBaseURL();
    const timeoutMs = this.getTimeout('warmUp') || 120000;

    console.log(`Warming up ${url} (timeout: ${timeoutMs / 1000}s)...`);
    const start = Date.now();

    try {
      const https = require('https');
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

        const req = https.get(url, { timeout: timeoutMs }, (res) => {
          res.resume(); // Drain response
          clearTimeout(deadline);
          settle(resolve, res.statusCode);
        });
        req.on('timeout', () => { req.destroy(); clearTimeout(deadline); settle(reject, new Error('Warm-up timeout')); });
        req.on('error', (err) => { clearTimeout(deadline); settle(reject, err); });

        // Hard deadline fallback in case socket timeout doesn't fire
        const deadline = setTimeout(() => { req.destroy(); settle(reject, new Error('Warm-up hard deadline')); }, timeoutMs + 5000);
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  Service ready (${elapsed}s)`);
    } catch (err) {
      console.warn(`  Warm-up warning: ${err.message} — proceeding anyway`);
    }
  }

  /**
   * Initialize: warm up service, authenticate via Clerk Backend API,
   * navigate to app, verify dashboard loads.
   */
  async initialize() {
    const env = this.getEnvironment();

    // Wake up Render service before browser navigation
    await this.warmUp();

    // Authenticate via Clerk Backend API (session injection)
    if (env.auth.required) {
      const success = await this.authenticate();
      if (!success) {
        throw new ConnectorError(
          'BrainstormyConnector: Authentication failed',
          { phase: 'initialize' }
        );
      }
    }

    // Navigate to app (session cookie already set)
    await this.page.goto(env.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.getTimeout('warmUp') || 120000
    });

    // Verify app ready
    await this.waitForAppReady();
    await this.collectEvidence('authenticated_ready');

    this._initialized = true;
  }

  /**
   * Authenticate via Clerk Backend API session injection.
   *
   * Instead of filling the Clerk UI form (which triggers factor-two verification
   * on every Playwright run due to fresh browser contexts), this method:
   *   1. Looks up the test user by email via Clerk Backend API
   *   2. Creates a sign-in token for that user
   *   3. Navigates the browser to the sign-in token URL, which creates a
   *      session and redirects to the app — bypassing factor-two entirely
   *
   * Requires CLERK_SECRET_KEY environment variable (sk_test_... or sk_live_...).
   *
   * @returns {Promise<boolean>} Success
   */
  async authenticate() {
    const env = this.getEnvironment();
    const auth = env.auth;
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;

    try {
      if (!clerkSecretKey) {
        throw new Error('CLERK_SECRET_KEY environment variable is required for Clerk Backend API authentication');
      }
      const email = auth.credentials.email;

      // Step 1: Look up user by email
      console.log(`  Looking up Clerk user: ${email}...`);
      const usersResponse = await this._clerkApiRequest(
        'GET',
        `/v1/users?email_address[]=${encodeURIComponent(email)}`,
        null,
        clerkSecretKey
      );

      if (!usersResponse.ok) {
        throw new Error(`Clerk user lookup failed: HTTP ${usersResponse.status} — ${usersResponse.body}`);
      }

      const users = JSON.parse(usersResponse.body);
      if (!Array.isArray(users) || users.length === 0) {
        throw new Error(`No Clerk user found for email: ${email}`);
      }

      const userId = users[0].id;
      console.log(`  Found user: ${userId}`);

      // Step 2: Create a sign-in token for the user
      // redirect_url tells Clerk where to send the browser after consuming the token,
      // which ensures the session is established on the app's domain.
      console.log('  Creating sign-in token...');
      const tokenResponse = await this._clerkApiRequest(
        'POST',
        '/v1/sign_in_tokens',
        JSON.stringify({ user_id: userId, redirect_url: env.baseUrl }),
        clerkSecretKey
      );

      if (!tokenResponse.ok) {
        throw new Error(`Clerk sign-in token creation failed: HTTP ${tokenResponse.status} — ${tokenResponse.body}`);
      }

      const tokenData = JSON.parse(tokenResponse.body);
      const signInUrl = tokenData.url;

      if (!signInUrl) {
        throw new Error('Clerk sign-in token response missing url field');
      }

      // Step 3: Navigate to app's sign-in with the ticket hash fragment.
      // This triggers the Clerk middleware to redirect to accounts.dev, which
      // initializes the Clerk client (sets __clerk_db_jwt). This client state
      // is required for the sign-in token URL to properly redirect back.
      const baseUrl = env.baseUrl.replace(/\/$/, '');
      const appTicketUrl = `${baseUrl}/sign-in#/__clerk_ticket=${tokenData.token}`;
      console.log('  Initializing Clerk client via app redirect...');
      await this.page.goto(appTicketUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.getTimeout('navigation') || 90000
      });
      await this.page.waitForTimeout(5000);

      // Step 4: Navigate to sign-in token URL on accounts.dev
      // With the Clerk client established, the ticket is consumed and Clerk
      // redirects back to the app with a valid session.
      console.log('  Navigating to sign-in token URL...');
      await this.page.goto(signInUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.getTimeout('navigation') || 90000
      });
      await this.collectEvidence('initial_load');

      // Step 5: Wait for redirect to app
      if (!this.page.url().startsWith(baseUrl)) {
        try {
          await this.page.waitForURL(url => url.href.startsWith(baseUrl), { timeout: 30000 });
        } catch {
          // If redirect didn't work, navigate directly (session may have been
          // established via handshake)
          console.log('  Redirect did not complete, navigating to app...');
          await this.page.goto(baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: this.getTimeout('navigation') || 90000
          });
        }
      }
      console.log(`  Current URL: ${this.page.url()}`);

      // Step 6: Verify authenticated state
      console.log('  Verifying authenticated state...');
      const userMenuSelector = this.getSelector('userMenu');
      if (userMenuSelector) {
        try {
          await this.page.waitForSelector(userMenuSelector, {
            timeout: this.getTimeout('clerkAuth') || 30000
          });
          console.log('  Authenticated (user menu visible)');
        } catch {
          // Fallback: check we're not on sign-in page
          const currentUrl = this.page.url();
          if (currentUrl.includes('sign-in') || currentUrl.includes('factor')) {
            throw new Error(`Still on sign-in page after session injection: ${currentUrl}`);
          }
          console.log('  Authenticated (no longer on sign-in page)');
        }
      }

      await this.collectEvidence('auth_complete');
      return true;
    } catch (error) {
      await this.collectEvidence('auth_failed');
      console.error('Clerk authentication failed:', error.message);
      return false;
    }
  }

  /**
   * Make an HTTP request to the Clerk Backend API.
   * @param {string} method - HTTP method
   * @param {string} path - API path (e.g., '/v1/users')
   * @param {string|null} body - Request body (JSON string)
   * @param {string} secretKey - Clerk secret key
   * @returns {Promise<{ok: boolean, status: number, body: string}>}
   */
  _clerkApiRequest(method, path, body, secretKey) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.clerk.com',
        path,
        method,
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: data
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Clerk API request timed out'));
      });

      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * Cleanup: archive test data, logout, clear state.
   */
  async cleanup() {
    try {
      await this.archiveTestData();
    } catch (error) {
      console.warn('Cleanup archive failed:', error.message);
    }

    // Logout via parent chain
    await super.cleanup();
  }

  // ===================================================================
  // ACTION DISPATCH — Overrides AIAppConnector
  // ===================================================================

  /**
   * Evidence-wrapping dispatcher for Brainstormy-specific actions.
   *
   * Handles: create_project, create_story, create_session, navigate_to_story,
   * navigate_to_session, generate_bible, get_bible, generate_report, get_report,
   * end_session, get_session_summary, search, create_bookmark, get_bookmarks,
   * setup_test_project, archive_test_data.
   * Unrecognized actions delegate to super.performAction() which handles
   * AI actions and generic actions with their own evidence wrapping.
   *
   * @param {string} action - Action type
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<any>} Action result
   */
  async performAction(action, params = {}) {
    const brainstormyActions = [
      'create_project', 'create_story', 'create_session',
      'navigate_to_project', 'navigate_to_story', 'navigate_to_session',
      'generate_bible', 'get_bible',
      'generate_report', 'get_report',
      'end_session', 'get_session_summary',
      'search', 'create_bookmark', 'get_bookmarks',
      'setup_test_project', 'archive_test_data'
    ];

    if (!brainstormyActions.includes(action)) {
      return await super.performAction(action, params);
    }

    // Brainstormy-specific action — wrap with evidence
    const stepId = `${action}_${Date.now()}`;
    await this.collectEvidence(`before_${stepId}`);

    let result;
    try {
      switch (action) {
        // Entity creation
        case 'create_project':
          result = await this.createProject(params.name);
          break;
        case 'create_story':
          result = await this.createStory(params.name, params.vertical);
          break;
        case 'create_session':
          result = await this.createSession(params.type, params.name);
          break;

        // Navigation
        case 'navigate_to_project': {
          const projectId = params.project_id || this.getState('current_project_id');
          if (!projectId) throw new ConnectorError('No project ID available — provide project_id param or run create_project first', { action: 'navigate_to_project', phase: 'interact' });
          result = await this.navigateToProject(projectId);
          break;
        }
        case 'navigate_to_story':
          result = await this.navigateToStory(params.story_id || params.name || this.getState('current_story_id'));
          break;
        case 'navigate_to_session':
          result = await this.navigateToSession(params.session_id || params.name || this.getState('current_session_id'));
          break;

        // Bible operations
        case 'generate_bible':
          result = await this.generateStoryBible(params.template);
          break;
        case 'get_bible':
          result = await this.getStoryBible(params.template);
          break;

        // Report operations
        case 'generate_report':
          result = await this.generateReport(params.type, params.parameters);
          break;
        case 'get_report':
          result = await this.getReport(params.report_id);
          break;

        // Session lifecycle
        case 'end_session':
          result = await this.endSession();
          break;
        case 'get_session_summary':
          result = await this.getSessionSummary(params.session_id);
          break;

        // Search
        case 'search':
          result = await this.performSearch(params.query);
          break;

        // Bookmarks
        case 'create_bookmark':
          result = await this.createBookmark(params.message_index, params.title);
          break;
        case 'get_bookmarks':
          result = await this.getBookmarks(params.category);
          break;

        // Test data management
        case 'setup_test_project':
          result = await this.setupTestProject(params.name);
          break;
        case 'archive_test_data':
          result = await this.archiveTestData();
          break;
      }
    } catch (error) {
      await this.collectEvidence(`failed_${stepId}`);
      throw error;
    }

    await this.collectEvidence(`after_${stepId}`);
    return result;
  }

  // ===================================================================
  // PROJECT / STORY / SESSION MANAGEMENT
  // ===================================================================

  /**
   * Create a new project.
   *
   * @param {string} name - Project name
   * @returns {Promise<{id: string, name: string, timestamp: string}>}
   * @throws {ConnectorError} If project ID cannot be extracted from URL
   */
  async createProject(name) {
    // Navigate to projects page
    await this.navigate('/projects');

    // Click new project button
    await this.click(this.getSelector('newProjectButton'));

    // Fill project name
    await this.type(this.getSelector('projectNameInput'), name);

    // Submit
    await this.click(this.getSelector('createProjectSubmit'));

    // Wait for redirect
    await this.waitForNavigation();

    // Extract project ID from URL
    const projectId = await this._extractIdFromUrl('project_id');
    if (!projectId) {
      throw new ConnectorError(
        'Failed to extract project ID from URL after creation',
        { action: 'create_project', phase: 'interact' }
      );
    }

    // Store in state (both instance property and state map)
    this.currentProjectId = projectId;
    this.setState('current_project_id', projectId);
    this.createdEntities.push({ type: 'project', id: projectId, name });

    return {
      id: projectId,
      name,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create a new story within the current project.
   *
   * @param {string} name - Story name
   * @param {string} vertical - Story vertical (e.g., 'novel', 'screenplay')
   * @returns {Promise<{id: string, name: string, vertical: string, timestamp: string}>}
   * @throws {ConnectorError} If no current project or story ID cannot be extracted
   */
  async createStory(name, vertical = 'novel') {
    const projectId = this.currentProjectId || this.getState('current_project_id');
    if (!projectId) {
      throw new ConnectorError(
        'No current project — call createProject first',
        { action: 'create_story', phase: 'interact' }
      );
    }

    // Click new story button
    await this.click(this.getSelector('newStoryButton'));

    // Fill story name
    await this.type(this.getSelector('storyNameInput'), name);

    // Select vertical
    const verticalSelector = this.getSelector('storyVerticalSelect');
    if (verticalSelector && await this.exists(verticalSelector)) {
      await this.select(verticalSelector, vertical);
    }

    // Submit
    await this.click(this.getSelector('createStorySubmit'));

    // Wait for redirect
    await this.waitForNavigation();

    // Extract story ID from URL
    const storyId = await this._extractIdFromUrl('story_id');
    if (!storyId) {
      throw new ConnectorError(
        'Failed to extract story ID from URL after creation',
        { action: 'create_story', phase: 'interact' }
      );
    }

    // Store in state
    this.currentStoryId = storyId;
    this.setState('current_story_id', storyId);
    this.createdEntities.push({ type: 'story', id: storyId, name });

    return {
      id: storyId,
      name,
      vertical,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create a new session within the current story.
   *
   * @param {string} [type='explore'] - Session type
   * @param {string} [name] - Optional session name
   * @returns {Promise<{id: string, type: string, name: string, timestamp: string}>}
   * @throws {ConnectorError} If no current story or session ID cannot be extracted
   */
  async createSession(type = 'explore', name) {
    const storyId = this.currentStoryId || this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory first',
        { action: 'create_session', phase: 'interact' }
      );
    }

    // Click new session button
    await this.click(this.getSelector('newSessionButton'));

    // Select session type if provided and selector exists
    if (type) {
      const typeSelector = this.getSelector('sessionTypeSelect');
      if (typeSelector && await this.exists(typeSelector)) {
        await this.select(typeSelector, type);
      }
    }

    // Submit (if there's a separate submit button)
    const submitSelector = this.getSelector('createSessionSubmit');
    if (submitSelector && await this.exists(submitSelector)) {
      await this.click(submitSelector);
    }

    // Wait for redirect
    await this.waitForNavigation();

    // Extract session ID from URL
    const sessionId = await this._extractIdFromUrl('session_id');
    if (!sessionId) {
      throw new ConnectorError(
        'Failed to extract session ID from URL after creation',
        { action: 'create_session', phase: 'interact' }
      );
    }

    // Store in state
    const sessionName = name || `QA Session ${Date.now()}`;
    this.currentSessionId = sessionId;
    this.setState('current_session_id', sessionId);
    this.createdEntities.push({ type: 'session', id: sessionId, name: sessionName });

    return {
      id: sessionId,
      type,
      name: sessionName,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * End the current session, triggering summary generation.
   * @returns {Promise<{session_id: string, summary_generated: boolean}>}
   */
  async endSession() {
    const endButton = this.getSelector('endSessionButton');
    if (!await this.exists(endButton)) {
      throw new ConnectorError(
        'End session button not found — is a session active?',
        { action: 'end_session', phase: 'interact' }
      );
    }

    await this.click(endButton);

    // Wait for summary generation (may take time)
    const timeout = this.getTimeout('sessionSummary');
    try {
      await this.waitFor(
        this.getSelector('sessionSummaryContent'),
        timeout
      );
      return { session_id: this.currentSessionId, summary_generated: true };
    } catch {
      return { session_id: this.currentSessionId, summary_generated: false };
    }
  }

  /**
   * Navigate to a specific project by ID.
   * @param {string} projectId - Project UUID
   * @returns {Promise<{navigated: boolean, projectId: string}>}
   */
  async navigateToProject(projectId) {
    await this.navigate(`/projects/${projectId}`);
    await this.waitForAppReady();
    this.currentProjectId = projectId;
    this.setState('current_project_id', projectId);
    return { navigated: true, projectId };
  }

  /**
   * Navigate to a specific story by name or ID.
   * @param {string} storyIdentifier - Story name, UUID, or storyId
   */
  async navigateToStory(storyIdentifier) {
    // If it looks like a UUID, navigate directly
    if (/^[a-f0-9-]{36}$/.test(storyIdentifier)) {
      await this.navigate(`/stories/${storyIdentifier}`);
      this.currentStoryId = storyIdentifier;
      this.setState('current_story_id', storyIdentifier);
      return;
    }

    // Otherwise, search sidebar items
    const storyItems = await this.page.$$(this.getSelector('storySidebarItem'));
    for (const item of storyItems) {
      const text = await item.textContent();
      const href = await item.getAttribute('href');
      if (text.includes(storyIdentifier) || (href && href.includes(storyIdentifier))) {
        await item.click();
        await this.waitForNavigation();
        return;
      }
    }
    throw new ConnectorError(
      `Story "${storyIdentifier}" not found in sidebar`,
      { action: 'navigate_to_story', phase: 'interact' }
    );
  }

  /**
   * Navigate to a specific session by name or ID.
   * @param {string} sessionIdentifier - Session name or UUID
   */
  async navigateToSession(sessionIdentifier) {
    // Direct navigation for UUIDs
    if (sessionIdentifier && /^[0-9a-f-]{36}$/i.test(sessionIdentifier)) {
      await this.navigate(`/sessions/${sessionIdentifier}`);
      await this.waitForAppReady();
      this.currentSessionId = sessionIdentifier;
      this.setState('current_session_id', sessionIdentifier);
      return { navigated: true, sessionId: sessionIdentifier };
    }

    const sessionItems = await this.page.$$(this.getSelector('sessionItem'));
    for (const item of sessionItems) {
      const text = await item.textContent();
      const href = await item.getAttribute('href');
      if (text.includes(sessionIdentifier) || (href && href.includes(sessionIdentifier))) {
        await item.click();
        await this.waitForNavigation();
        return;
      }
    }
    throw new ConnectorError(
      `Session "${sessionIdentifier}" not found`,
      { action: 'navigate_to_session', phase: 'interact' }
    );
  }

  // ===================================================================
  // BIBLE GENERATION
  // ===================================================================

  /**
   * Generate a story bible using the specified template.
   *
   * @param {string} [template='standard'] - Template key
   * @returns {Promise<{template: string, sections: Object, section_count: number, timestamp: string}>}
   * @throws {ConnectorError} If no current story
   */
  async generateStoryBible(template = 'standard') {
    const storyId = this.currentStoryId || this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory or navigateToStory first',
        { action: 'generate_bible', phase: 'interact' }
      );
    }

    // Navigate to bible section
    await this.click(this.getSelector('bibleTab'));

    // Select template
    const templateSelector = this.getSelector('bibleTemplateSelect');
    if (templateSelector && await this.exists(templateSelector)) {
      await this.select(templateSelector, template);
    }

    // Click generate
    await this.click(this.getSelector('bibleGenerateButton'));

    // Wait for generation (can take 30-120s)
    const bibleTimeout = this.getTimeout('bibleGeneration');
    const generatingIndicator = this.getSelector('bibleGeneratingIndicator');

    // Wait for indicator to appear then disappear
    try {
      await this.page.waitForSelector(generatingIndicator, { timeout: 10000 });
    } catch {
      // Indicator may not appear if generation is instant
    }

    // Wait for indicator to disappear (generation complete)
    await this.page.waitForSelector(generatingIndicator, {
      state: 'hidden',
      timeout: bibleTimeout
    });

    // Extract sections
    const sections = await this.extractBibleSections();

    return {
      template,
      sections,
      section_count: Object.keys(sections).length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get the current Story Bible content.
   * @param {string} [template='standard']
   * @returns {Promise<{template: string, sections: Object}>}
   */
  async getStoryBible(template = 'standard') {
    await this.click(this.getSelector('bibleTab'));
    await this.waitFor(this.getSelector('bibleSection'));

    const sections = await this.extractBibleSections();
    return { template, sections };
  }

  /**
   * Extract all bible section titles and content from the page.
   * @private
   * @returns {Promise<Object>} Map of section_key → { title, content, has_content }
   */
  async extractBibleSections() {
    const sectionSelector = this.getSelector('bibleSection');
    const sectionElements = await this.page.$$(sectionSelector);

    const sections = {};
    for (const el of sectionElements) {
      const title = await el.$eval(
        '.section-title, h3, [data-testid="section-title"]',
        (node) => node.textContent.trim()
      ).catch(() => 'Unknown');

      const content = await el.$eval(
        '.section-content, [data-testid="section-content"]',
        (node) => node.textContent.trim()
      ).catch(() => '');

      const key = title.toLowerCase().replace(/\s+/g, '_');
      sections[key] = {
        title,
        content,
        has_content: content.length > 0
      };
    }

    return sections;
  }

  // ===================================================================
  // REPORT OPERATIONS
  // ===================================================================

  /**
   * Generate a report for the current story.
   * @param {string} type - Report type ('outline', 'character_profile', etc.)
   * @param {Object} [parameters={}] - Report parameters
   * @returns {Promise<{type: string, content: string, citations: Object}>}
   */
  async generateReport(type, parameters = {}) {
    await this.click(this.getSelector('reportTab'));
    await this.waitFor(this.getSelector('reportTypeSelect'));

    await this.select(this.getSelector('reportTypeSelect'), type);

    // Fill parameters if any (e.g., character name input)
    for (const [key, value] of Object.entries(parameters)) {
      const paramSelector = `[data-testid="report-param-${key}"]`;
      if (await this.exists(paramSelector)) {
        await this.type(paramSelector, value);
      }
    }

    await this.click(this.getSelector('reportGenerateButton'));

    // Wait for report generation
    const timeout = this.getTimeout('reportGeneration');
    await this.waitFor(this.getSelector('reportContent'), timeout);

    // Extract content and citations
    const contentData = await this.extractData(this.getSelector('reportContent'));
    const citations = await this.extractCitations();

    return { type, content: contentData ? contentData.text : '', citations };
  }

  /**
   * Get the current report content.
   * @param {string} [reportId] - Optional report ID
   * @returns {Promise<{content: string, citations: Object}>}
   */
  async getReport(reportId) {
    const contentData = await this.extractData(this.getSelector('reportContent'));
    const citations = await this.extractCitations();
    return { content: contentData ? contentData.text : '', citations };
  }

  // ===================================================================
  // SEARCH OPERATIONS
  // ===================================================================

  /**
   * Perform a semantic search in the current story.
   * @param {string} query - Search query
   * @returns {Promise<{query: string, results: Array, count: number}>}
   */
  async performSearch(query) {
    const searchInput = this.getSelector('searchInput');
    await this.waitFor(searchInput);
    await this.type(searchInput, query);

    const searchSubmit = this.getSelector('searchSubmit');
    if (searchSubmit && await this.exists(searchSubmit)) {
      await this.click(searchSubmit);
    } else {
      await this.page.press(searchInput, 'Enter');
    }

    // Wait for results
    const timeout = this.getTimeout('search');
    await this.waitFor(this.getSelector('searchResults'), timeout);

    // Extract results
    const resultSelector = this.getSelector('searchResultItem');
    const resultElements = await this.page.$$(resultSelector);

    const results = [];
    for (const el of resultElements) {
      const text = await el.textContent();
      const source = await el.getAttribute('data-source-type').catch(() => 'message');
      results.push({ text: text.trim(), source });
    }

    return { query, results, count: results.length };
  }

  // ===================================================================
  // BOOKMARK OPERATIONS
  // ===================================================================

  /**
   * Bookmark a message in the current session.
   * @param {number} [messageIndex=0] - 0-based index of message to bookmark (from most recent)
   * @param {string} [title='QA Test Bookmark'] - Bookmark title
   * @returns {Promise<{bookmarked: boolean, title: string}>}
   */
  async createBookmark(messageIndex = 0, title = 'QA Test Bookmark') {
    const messages = await this.page.$$(this.getSelector('aiMessage'));
    if (messages.length === 0) {
      throw new ConnectorError(
        'No messages to bookmark',
        { action: 'create_bookmark', phase: 'interact' }
      );
    }

    const targetIndex = Math.min(messageIndex, messages.length - 1);
    const targetMessage = messages[messages.length - 1 - targetIndex];

    // Hover to reveal bookmark button
    await targetMessage.hover();
    const bookmarkBtn = await targetMessage.$(this.getSelector('bookmarkButton'));
    if (!bookmarkBtn) {
      throw new ConnectorError(
        'Bookmark button not found on message',
        { action: 'create_bookmark', phase: 'interact' }
      );
    }

    await bookmarkBtn.click();

    // Fill title
    await this.waitFor(this.getSelector('bookmarkTitleInput'));
    await this.type(this.getSelector('bookmarkTitleInput'), title);
    await this.click(this.getSelector('bookmarkSaveButton'));

    // Wait for confirmation
    await this.page.waitForTimeout(1000);

    return { bookmarked: true, title };
  }

  /**
   * Get all bookmarks for the current story.
   * @param {string} [category] - Optional category filter
   * @returns {Promise<{bookmarks: Array, count: number}>}
   */
  async getBookmarks(category) {
    await this.click(this.getSelector('bookmarksTab'));
    await this.waitFor(this.getSelector('bookmarkItem'));

    const bookmarkElements = await this.page.$$(this.getSelector('bookmarkItem'));

    const bookmarks = [];
    for (const el of bookmarkElements) {
      const elTitle = await el.$eval(
        '[data-testid="bookmark-title"], .bookmark-title',
        (node) => node.textContent.trim()
      ).catch(() => '');
      const content = await el.$eval(
        '[data-testid="bookmark-content"], .bookmark-content',
        (node) => node.textContent.trim()
      ).catch(() => '');
      bookmarks.push({ title: elTitle, content });
    }

    return { bookmarks, count: bookmarks.length };
  }

  // ===================================================================
  // SESSION SUMMARY
  // ===================================================================

  /**
   * Get session summary content.
   * @param {string} [sessionId] - Session ID (defaults to current)
   * @returns {Promise<{session_id: string, summary: string|null, timestamp: string}>}
   */
  async getSessionSummary(sessionId) {
    const sid = sessionId || this.currentSessionId || this.getState('current_session_id');

    // Click summary button if it exists (existing connector pattern)
    const summaryButton = this.getSelector('sessionSummaryButton');
    if (summaryButton && await this.exists(summaryButton)) {
      await this.click(summaryButton);
      await this.waitFor(this.getSelector('sessionSummaryContent'));
    }

    // Extract summary content
    const summarySelector = this.getSelector('sessionSummaryContent');
    if (await this.exists(summarySelector)) {
      const summaryData = await this.extractData(summarySelector);
      return {
        session_id: sid,
        summary: summaryData ? summaryData.text : null,
        timestamp: new Date().toISOString()
      };
    }

    return { session_id: sid, summary: null, timestamp: new Date().toISOString() };
  }

  // ===================================================================
  // TEST DATA MANAGEMENT
  // ===================================================================

  /**
   * Set up a dedicated test project for QA runs.
   * Creates the project if it doesn't exist, or navigates to it.
   * @param {string} [name='QA Test Project']
   * @returns {Promise<{project_id: string, created: boolean}>}
   */
  async setupTestProject(name = 'QA Test Project') {
    await this.navigate('/projects');
    await this.waitFor(this.getSelector('sidebarProjects'));

    // Check if test project already exists
    const projectLinks = await this.page.$$('a[href*="/projects/"]');
    for (const link of projectLinks) {
      const text = await link.textContent();
      if (text.trim() === name) {
        await link.click();
        await this.waitForNavigation();

        const projectId = await this._extractIdFromUrl('project_id');
        this.currentProjectId = projectId;
        this.setState('current_project_id', projectId);

        return { project_id: projectId, created: false };
      }
    }

    // Create new test project
    const project = await this.createProject(name);
    return { project_id: project.id, created: true };
  }

  /**
   * Archive test stories by logging created entities for post-mortem.
   * @private
   */
  async archiveTestData() {
    // Best-effort cleanup — log entities created during this run
    if (this.createdEntities.length > 0) {
      console.log(
        'BrainstormyConnector: Created entities for cleanup:',
        JSON.stringify(this.createdEntities, null, 2)
      );
    }
  }

  // ===================================================================
  // CITATION EXTRACTION (waitForAIResponse override) — KEPT from existing
  // ===================================================================

  /**
   * Wait for AI response with citation extraction.
   * Calls super to handle streaming detection and text extraction,
   * then decorates the result with citation data.
   *
   * @param {number} [timeout] - Max wait in ms
   * @returns {Promise<{text, html, timestamp, messageIndex, citations}>}
   */
  async waitForAIResponse(timeout) {
    const response = await super.waitForAIResponse(timeout);

    // Extract citations from the response DOM
    const citations = await this.extractCitations();

    return {
      ...response,
      citations
    };
  }

  /**
   * Extract citation references from the page.
   * Returns empty array if no citations found or extraction fails.
   * Never throws — citations are supplementary evidence.
   *
   * @returns {Promise<Array<{id: string, text: string}>>}
   */
  async extractCitations() {
    const citationSelector = this.getSelector('reportCitation');
    if (!citationSelector) {
      return [];
    }

    try {
      const elements = await this.page.$$(citationSelector);

      return await Promise.all(
        elements.map(async el => ({
          id: await el.getAttribute('data-citation-id'),
          text: await el.textContent()
        }))
      );
    } catch (error) {
      // Citations are supplementary — don't fail the test
      return [];
    }
  }

  // ===================================================================
  // SELECTOR / TIMEOUT / ENVIRONMENT OVERRIDES
  // ===================================================================

  /**
   * Override getSelector() to resolve from connector.config.selectors path.
   *
   * BaseConnector.getSelector() reads this.app.config?.selectors?.[key], but our
   * config puts selectors at this.app.connector.config.selectors. This override
   * checks the correct path first, then falls back to DEFAULT_SELECTORS.
   *
   * @param {string} key - Selector key in camelCase (e.g., 'chatInput')
   * @returns {string} CSS selector string
   */
  getSelector(key) {
    const configSelectors = this.app.connector?.config?.selectors;
    const DEFAULT_SELECTORS = require('./selectors');

    // 1. Try key as-is (camelCase from our code, or snake_case from parent classes)
    if (configSelectors?.[key]) return configSelectors[key];
    if (DEFAULT_SELECTORS[key]) return DEFAULT_SELECTORS[key];

    // 2. Convert snake_case → camelCase for backward compatibility with parent classes
    // (AIAppConnector uses 'chat_input', we store as 'chatInput')
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camelKey !== key) {
      if (configSelectors?.[camelKey]) return configSelectors[camelKey];
      if (DEFAULT_SELECTORS[camelKey]) return DEFAULT_SELECTORS[camelKey];
    }

    return null;
  }

  /**
   * Get a timeout value from config.
   * Config uses camelCase keys (e.g., aiResponse, bibleGeneration).
   * @param {string} key - Timeout key in camelCase
   * @returns {number} Timeout in ms
   */
  getTimeout(key) {
    const defaults = {
      aiResponse: 60000,
      bibleGeneration: 120000,
      reportGeneration: 90000,
      navigation: 30000,
      search: 15000,
      sessionSummary: 60000,
      clerkAuth: 30000
    };
    return this.app.connector?.config?.timeouts?.[key] || defaults[key];
  }

  /**
   * Override waitForAppReady() from GenericWebAppConnector.
   *
   * The base class reads this.app.config?.ready_indicator, but our config
   * stores the ready indicator as a selector key in connector.config.selectors.
   * This override resolves it via getSelector().
   */
  async waitForAppReady() {
    const readySelector = this.getSelector('readyIndicator');
    if (readySelector) {
      await this.waitFor(readySelector, this.getTimeout('navigation'));
    }
  }

  /**
   * Get the current environment config.
   * Reads from flat top-level config by default (baseUrl, connector.config.auth).
   * Merges environment overrides when specified.
   * @param {string} [envName] - Optional environment name override
   * @returns {{ baseUrl: string, auth: Object }}
   */
  getEnvironment(envName) {
    const auth = this.app.connector?.config?.auth || {};
    const baseConfig = {
      baseUrl: this.app.baseUrl,
      auth
    };

    // If an environment override exists, merge it
    if (envName && this.app.environments?.[envName]) {
      const envOverride = this.app.environments[envName];
      return {
        baseUrl: envOverride.baseUrl || baseConfig.baseUrl,
        auth: {
          ...baseConfig.auth,
          ...envOverride.auth,
          credentials: {
            ...baseConfig.auth?.credentials,
            ...envOverride.auth?.credentials
          }
        }
      };
    }

    return baseConfig;
  }

  // ===================================================================
  // HELPERS — KEPT from existing
  // ===================================================================

  /**
   * Extract an entity ID from the current URL using a configured pattern.
   *
   * @param {string} patternKey - Key in config.url_patterns (e.g., 'project_id')
   * @returns {Promise<string|null>} Extracted ID or null if not matched
   */
  async _extractIdFromUrl(patternKey) {
    const pattern = this.app.config?.url_patterns?.[patternKey]
      || this.app.connector?.config?.url_patterns?.[patternKey];
    if (!pattern) {
      // Fallback: try generic UUID pattern
      const url = await this.getCurrentURL();
      const match = url.match(/([a-f0-9-]{36}|[a-f0-9]{8,})/);
      return match ? match[1] : null;
    }

    const url = await this.getCurrentURL();
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const match = url.match(regex);
    return match ? match[1] : null;
  }
}

module.exports = BrainstormyConnector;
