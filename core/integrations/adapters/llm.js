'use strict';

const { AdapterError } = require('../../engine/errors');

/**
 * Base adapter for LLM providers (Anthropic Claude, OpenAI, etc.).
 * Concrete implementations must override all methods.
 */
class LLMAdapter {
  /**
   * Send a completion request and return the full response.
   * @param {string} prompt - The prompt text
   * @param {Object} [options] - Provider-specific options
   * @param {string} [options.model] - Model identifier
   * @param {number} [options.maxTokens] - Maximum tokens in response
   * @param {number} [options.temperature] - Sampling temperature (0-1)
   * @param {string} [options.systemPrompt] - System-level instructions
   * @returns {Promise<{content: string, usage: {inputTokens: number, outputTokens: number}, model: string}>}
   */
  async complete(prompt, options = {}) {
    throw new AdapterError('complete() must be implemented by subclass', {
      adapterType: 'llm',
      operation: 'complete'
    });
  }

  /**
   * Send a completion request and stream the response.
   * @param {string} prompt - The prompt text
   * @param {Object} [options] - Same as complete()
   * @returns {AsyncGenerator<string>} Yields response chunks
   */
  async *streamComplete(prompt, options = {}) {
    throw new AdapterError('streamComplete() must be implemented by subclass', {
      adapterType: 'llm',
      operation: 'streamComplete'
    });
  }
}

module.exports = LLMAdapter;
