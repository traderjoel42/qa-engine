'use strict';

const GenericWebAppConnector = require('../generic-web-app/connector');
const {
  ConnectorError,
  ConnectorTimeoutError
} = require('../errors');

/**
 * Connector for AI-powered chat applications.
 *
 * Adds chat-specific interactions on top of GenericWebAppConnector:
 * - Send messages and track conversation history
 * - Wait for AI responses with streaming awareness
 * - Validate AI memory across conversation turns
 *
 * Requires these selectors in app config:
 *   chat_input          — the message input field
 *   chat_send           — the send button
 *   ai_message          — selector matching AI response message elements
 *   generating_indicator — (optional) element visible while AI is generating
 *
 * Requires these timeouts in app config:
 *   ai_response          — (optional, default 60000) max wait for AI response
 *
 * Inheritance chain:
 *   BaseConnector → GenericWebAppConnector → AIAppConnector (this) → [App]Connector
 *
 * @example
 * const connector = new AIAppConnector(appConfig, page, evidenceCollector);
 * await connector.initialize();
 * await connector.performAction('send_message', { text: 'Hello' });
 * const response = await connector.performAction('wait_for_response');
 * const memory = await connector.performAction('validate_memory', {
 *   query: 'What did I say?',
 *   expected: 'Hello'
 * });
 */
class AIAppConnector extends GenericWebAppConnector {

  // ===================================================================
  // ACTION DISPATCH — Overrides GenericWebAppConnector
  // ===================================================================

  /**
   * Evidence-wrapping dispatcher for AI-specific actions.
   *
   * Handles: send_message, wait_for_response, get_conversation, validate_memory.
   * Unrecognized actions fall through to super.performAction() which handles
   * generic actions (click, type, navigate, etc.) with its own evidence wrapping.
   *
   * @param {string} action - Action type
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<any>} Action result
   */
  async performAction(action, params = {}) {
    // Check if this is an AI-specific action
    const aiActions = ['send_message', 'wait_for_response', 'get_conversation', 'validate_memory'];

    if (!aiActions.includes(action)) {
      // Not ours — delegate to GenericWebAppConnector (which handles evidence)
      return await super.performAction(action, params);
    }

    // AI-specific action — wrap with evidence
    const stepId = `${action}_${Date.now()}`;
    await this.collectEvidence(`before_${stepId}`);

    let result;
    try {
      switch (action) {
        case 'send_message':
          result = await this.sendMessage(params.text);
          break;
        case 'wait_for_response':
          result = await this.waitForAIResponse(params.timeout);
          break;
        case 'get_conversation':
          result = await this.getConversationHistory();
          break;
        case 'validate_memory':
          result = await this.validateMemory(params.query, params.expected);
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
  // CHAT INTERACTION
  // ===================================================================

  /**
   * Send a message in the chat interface.
   *
   * Types into the chat input and clicks send. Tracks the message
   * in connector state for conversation history.
   *
   * @param {string} text - Message text to send
   * @returns {Promise<{text: string, timestamp: string, messageIndex: number}>}
   * @throws {ConnectorError} If chat_input or chat_send selectors are missing
   */
  async sendMessage(text) {
    const inputSelector = this.getSelector('chat_input');
    const sendSelector = this.getSelector('chat_send');

    if (!inputSelector || !sendSelector) {
      throw new ConnectorError(
        'Missing chat selectors in config (need: chat_input, chat_send)',
        { action: 'send_message', phase: 'interact' }
      );
    }

    // Type message and send
    await this.type(inputSelector, text);
    await this.click(sendSelector);

    // Track in state
    const messages = this.getState('messages') || [];
    const entry = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };
    messages.push(entry);
    this.setState('messages', messages);

    return {
      text,
      timestamp: entry.timestamp,
      messageIndex: messages.length - 1
    };
  }

  /**
   * Wait for the AI to respond.
   *
   * Waits for a new AI message element to appear, then waits for
   * generation to complete (streaming finished), then extracts the
   * response text. Tracks the response in connector state.
   *
   * @param {number} [timeout] - Max wait in ms (default: config ai_response or 60000)
   * @returns {Promise<{text: string, html: string, timestamp: string, messageIndex: number}>}
   * @throws {ConnectorTimeoutError} If AI doesn't respond within timeout
   */
  async waitForAIResponse(timeout) {
    const effectiveTimeout = timeout ?? this.getTimeout('ai_response', 60000);
    const aiMessageSelector = this.getSelector('ai_message');

    if (!aiMessageSelector) {
      throw new ConnectorError(
        'Missing ai_message selector in config',
        { action: 'wait_for_response', phase: 'interact' }
      );
    }

    try {
      // Count existing AI messages before waiting
      const existingMessages = await this.page.$$(aiMessageSelector);
      const beforeCount = existingMessages.length;

      // Wait for a NEW AI message to appear (count increases)
      await this.page.waitForFunction(
        ({ selector, before }) => document.querySelectorAll(selector).length > before,
        { selector: aiMessageSelector, before: beforeCount },
        { timeout: effectiveTimeout }
      );

      // Wait for generation to complete (streaming finished)
      await this.waitForGenerationComplete(effectiveTimeout);

      // Brief settle for final DOM updates
      await this.page.waitForTimeout(500);

      // Extract the last AI message
      const allMessages = await this.page.$$(aiMessageSelector);
      const lastMessage = allMessages[allMessages.length - 1];

      let responseData = { text: '', html: '' };
      if (lastMessage) {
        responseData = await lastMessage.evaluate(el => ({
          text: el.textContent,
          html: el.innerHTML
        }));
      }

      // Track in state
      const messages = this.getState('messages') || [];
      const entry = {
        role: 'assistant',
        content: responseData.text,
        timestamp: new Date().toISOString()
      };
      messages.push(entry);
      this.setState('messages', messages);

      return {
        text: responseData.text,
        html: responseData.html,
        timestamp: entry.timestamp,
        messageIndex: messages.length - 1
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        throw error;
      }
      throw this._wrapPlaywrightError(error, {
        action: 'wait_for_response',
        selector: aiMessageSelector
      });
    }
  }

  /**
   * Get the accumulated conversation history from connector state.
   *
   * @returns {Promise<Array<{role: string, content: string, timestamp: string}>>}
   */
  async getConversationHistory() {
    return this.getState('messages') || [];
  }

  /**
   * Validate that the AI remembers something by asking a question
   * and checking if the response contains the expected content.
   *
   * Uses case-insensitive substring matching. For more sophisticated
   * matching, agents should call sendMessage + waitForAIResponse
   * directly and apply their own assertions.
   *
   * @param {string} query - Question to ask the AI
   * @param {string} expected - Expected substring in the response
   * @returns {Promise<{query: string, expected: string, response: string, found: boolean, timestamp: string}>}
   */
  async validateMemory(query, expected) {
    // Send the question
    await this.sendMessage(query);

    // Wait for response
    const response = await this.waitForAIResponse();

    // Check if expected content is present (case-insensitive)
    const found = response.text.toLowerCase().includes(expected.toLowerCase());

    return {
      query,
      expected,
      response: response.text,
      found,
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // GENERATION DETECTION
  // ===================================================================

  /**
   * Check if the AI is currently generating a response.
   * Returns false if no generating_indicator is configured.
   *
   * @returns {Promise<boolean>}
   */
  async isGenerating() {
    const indicator = this.getSelector('generating_indicator');
    if (!indicator) {
      return false;
    }
    return await this.exists(indicator);
  }

  /**
   * Wait for AI generation to complete (indicator disappears).
   *
   * If no generating_indicator is configured, waits a fixed 2-second
   * settle period as a fallback.
   *
   * @param {number} [timeout=120000] - Maximum wait time in ms
   * @throws {ConnectorTimeoutError} If generation doesn't complete within timeout
   */
  async waitForGenerationComplete(timeout = 120000) {
    const indicator = this.getSelector('generating_indicator');

    if (!indicator) {
      // No indicator configured — use fixed settle period
      await this.page.waitForTimeout(2000);
      return;
    }

    const start = Date.now();
    while (await this.exists(indicator)) {
      if (Date.now() - start > timeout) {
        throw new ConnectorTimeoutError(
          `AI generation did not complete within ${timeout}ms`,
          { action: 'waitForGenerationComplete', phase: 'interact', recoverable: true }
        );
      }
      await this.page.waitForTimeout(500);
    }
  }
}

module.exports = AIAppConnector;
