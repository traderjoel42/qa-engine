'use strict';

const LLMAdapter = require('../adapters/llm');
const { AdapterError } = require('../../engine/errors');

class AnthropicAdapter extends LLMAdapter {
  constructor(options = {}) {
    super();
    this._client = options.client || null;
    this._apiKey = options.apiKey || null;
    this._defaultModel = options.defaultModel || 'claude-sonnet-4-5-20250929';
    this._defaultMaxTokens = options.defaultMaxTokens || 4096;
    this._maxRetries = options.maxRetries || 3;
    this._retryDelayMs = options.retryDelayMs || 1000;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    if (!this._client) {
      if (!this._apiKey) {
        throw new AdapterError('Anthropic API key required', {
          adapterType: 'llm',
          operation: 'initialize'
        });
      }
      const Anthropic = require('@anthropic-ai/sdk');
      this._client = new Anthropic({ apiKey: this._apiKey });
    }

    this._initialized = true;
  }

  async complete(prompt, options = {}) {
    await this.initialize();

    const model = options.model || this._defaultModel;
    const maxTokens = options.maxTokens || this._defaultMaxTokens;
    const temperature = options.temperature !== undefined ? options.temperature : undefined;
    const systemPrompt = options.systemPrompt || undefined;

    const requestParams = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    };

    if (systemPrompt) {
      requestParams.system = systemPrompt;
    }
    if (temperature !== undefined) {
      requestParams.temperature = temperature;
    }

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const response = await this._client.messages.create(requestParams);

        return {
          content: this._extractContent(response),
          usage: {
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0
          },
          model: response.model || model
        };
      } catch (error) {
        if (this._isRetryable(error) && attempt < this._maxRetries) {
          await this._delay(this._retryDelayMs * Math.pow(2, attempt));
          continue;
        }

        throw new AdapterError(`Anthropic API error: ${error.message}`, {
          adapterType: 'llm',
          operation: 'complete',
          cause: error,
          details: {
            model,
            attempt: attempt + 1,
            statusCode: error.status || null,
            errorType: error.error?.type || null
          }
        });
      }
    }
  }

  async *streamComplete(prompt, options = {}) {
    await this.initialize();

    const model = options.model || this._defaultModel;
    const maxTokens = options.maxTokens || this._defaultMaxTokens;
    const temperature = options.temperature !== undefined ? options.temperature : undefined;
    const systemPrompt = options.systemPrompt || undefined;

    const requestParams = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    };

    if (systemPrompt) requestParams.system = systemPrompt;
    if (temperature !== undefined) requestParams.temperature = temperature;

    try {
      const stream = this._client.messages.stream(requestParams);

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        }
      }
    } catch (error) {
      throw new AdapterError(`Anthropic streaming error: ${error.message}`, {
        adapterType: 'llm',
        operation: 'streamComplete',
        cause: error
      });
    }
  }

  _extractContent(response) {
    if (!response.content || response.content.length === 0) {
      return '';
    }
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
  }

  _isRetryable(error) {
    const retryableStatuses = [429, 500, 502, 503, 529];
    if (error.status && retryableStatuses.includes(error.status)) {
      return true;
    }
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }
    return false;
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AnthropicAdapter;
