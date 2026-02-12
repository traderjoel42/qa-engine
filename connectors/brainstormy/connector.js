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
 *
 * Requires additional selectors in app config beyond AIAppConnector:
 *   new_project_button, project_name_input, create_project_submit
 *   new_story_button, story_name_input, story_vertical_select, create_story_submit
 *   new_session_button, session_type_select, create_session_submit
 *   story_bible_button, bible_template_prefix, generate_bible_button, bible_content
 *   session_summary_button, summary_content
 *   citation_element
 *
 * Requires url_patterns in app config:
 *   project_id, story_id, session_id (regex patterns for URL-based ID extraction)
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
  // ACTION DISPATCH — Overrides AIAppConnector
  // ===================================================================

  /**
   * Evidence-wrapping dispatcher for Brainstormy-specific actions.
   *
   * Handles: create_project, create_story, create_session, navigate_to_story,
   * generate_bible, get_session_summary.
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
      'navigate_to_story', 'generate_bible', 'get_session_summary'
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
        case 'create_project':
          result = await this.createProject(params.name);
          break;
        case 'create_story':
          result = await this.createStory(params.name, params.vertical);
          break;
        case 'create_session':
          result = await this.createSession(params.type);
          break;
        case 'navigate_to_story':
          result = await this.navigateToStory(params.story_id);
          break;
        case 'generate_bible':
          result = await this.generateStoryBible(params.template);
          break;
        case 'get_session_summary':
          result = await this.getSessionSummary(params.session_id);
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
    await this.click(this.getSelector('new_project_button'));

    // Fill project name
    await this.type(this.getSelector('project_name_input'), name);

    // Submit
    await this.click(this.getSelector('create_project_submit'));

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

    // Store in state
    this.setState('current_project_id', projectId);

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
  async createStory(name, vertical) {
    const projectId = this.getState('current_project_id');
    if (!projectId) {
      throw new ConnectorError(
        'No current project — call createProject first',
        { action: 'create_story', phase: 'interact' }
      );
    }

    // Click new story button
    await this.click(this.getSelector('new_story_button'));

    // Fill story name
    await this.type(this.getSelector('story_name_input'), name);

    // Select vertical
    await this.select(this.getSelector('story_vertical_select'), vertical);

    // Submit
    await this.click(this.getSelector('create_story_submit'));

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
    this.setState('current_story_id', storyId);

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
   * @param {string} [type] - Session type (e.g., 'explore', 'develop', 'guide')
   * @returns {Promise<{id: string, type: string|undefined, timestamp: string}>}
   * @throws {ConnectorError} If no current story or session ID cannot be extracted
   */
  async createSession(type) {
    const storyId = this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory first',
        { action: 'create_session', phase: 'interact' }
      );
    }

    // Click new session button
    await this.click(this.getSelector('new_session_button'));

    // Select session type if provided and selector exists
    if (type) {
      const typeSelector = this.getSelector('session_type_select');
      if (typeSelector) {
        await this.select(typeSelector, type);
      }
    }

    // Submit (if there's a separate submit button)
    const submitSelector = this.getSelector('create_session_submit');
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
    this.setState('current_session_id', sessionId);

    return {
      id: sessionId,
      type,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Navigate to a specific story.
   *
   * @param {string} storyId - Story UUID
   * @returns {Promise<void>}
   */
  async navigateToStory(storyId) {
    await this.navigate(`/stories/${storyId}`);
    this.setState('current_story_id', storyId);
  }

  // ===================================================================
  // BIBLE GENERATION
  // ===================================================================

  /**
   * Generate a story bible using the specified template.
   *
   * @param {string} [template='standard'] - Template key
   * @returns {Promise<{template: string, content: string, timestamp: string}>}
   * @throws {ConnectorError} If no current story
   */
  async generateStoryBible(template = 'standard') {
    const storyId = this.getState('current_story_id');
    if (!storyId) {
      throw new ConnectorError(
        'No current story — call createStory or navigateToStory first',
        { action: 'generate_bible', phase: 'interact' }
      );
    }

    // Navigate to bible section
    await this.click(this.getSelector('story_bible_button'));

    // Select template (prefix + template key)
    const templatePrefix = this.getSelector('bible_template_prefix');
    if (templatePrefix) {
      await this.click(`${templatePrefix}${template}"]`);
    }

    // Click generate
    await this.click(this.getSelector('generate_bible_button'));

    // Wait for generation (can take a while)
    const bibleTimeout = this.getTimeout('bible_generation', 120000);
    await this.waitFor(this.getSelector('bible_content'), bibleTimeout);

    // Extract bible content
    const bibleData = await this.extractData(this.getSelector('bible_content'));

    return {
      template,
      content: bibleData ? bibleData.text : '',
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // SESSION SUMMARY
  // ===================================================================

  /**
   * Get a session summary.
   *
   * @param {string} sessionId - Session UUID
   * @returns {Promise<{session_id: string, summary: string, timestamp: string}>}
   */
  async getSessionSummary(sessionId) {
    // Navigate to session
    await this.navigate(`/sessions/${sessionId}`);

    // Click summary button
    await this.click(this.getSelector('session_summary_button'));

    // Wait for summary content to appear
    await this.waitFor(this.getSelector('summary_content'));

    // Extract summary text
    const summaryData = await this.extractData(this.getSelector('summary_content'));

    return {
      session_id: sessionId,
      summary: summaryData ? summaryData.text : '',
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // CITATION EXTRACTION (waitForAIResponse override)
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
    const citationSelector = this.getSelector('citation_element');
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
  // HELPERS
  // ===================================================================

  /**
   * Extract an entity ID from the current URL using a configured pattern.
   *
   * @param {string} patternKey - Key in config.url_patterns (e.g., 'project_id')
   * @returns {Promise<string|null>} Extracted ID or null if not matched
   */
  async _extractIdFromUrl(patternKey) {
    const pattern = this.app.config?.url_patterns?.[patternKey];
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
