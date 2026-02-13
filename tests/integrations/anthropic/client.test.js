'use strict';

const AnthropicAdapter = require('../../../core/integrations/anthropic/client');
const { AdapterError } = require('../../../core/engine/errors');

function createMockClient(overrides = {}) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'claude-sonnet-4-5-20250929'
      }),
      stream: jest.fn().mockReturnValue(
        mockAsyncIterable([
          { type: 'content_block_delta', delta: { text: 'chunk1' } },
          { type: 'content_block_delta', delta: { text: 'chunk2' } }
        ])
      ),
      ...overrides.messages
    }
  };
}

function mockAsyncIterable(items) {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < items.length) {
            return { value: items[index++], done: false };
          }
          return { done: true };
        }
      };
    }
  };
}

describe('AnthropicAdapter', () => {
  describe('Constructor', () => {
    it('default model is claude-sonnet-4-5-20250929', () => {
      const adapter = new AnthropicAdapter();
      expect(adapter._defaultModel).toBe('claude-sonnet-4-5-20250929');
    });

    it('default maxTokens is 4096', () => {
      const adapter = new AnthropicAdapter();
      expect(adapter._defaultMaxTokens).toBe(4096);
    });

    it('default maxRetries is 3', () => {
      const adapter = new AnthropicAdapter();
      expect(adapter._maxRetries).toBe(3);
    });

    it('accepts injectable client', () => {
      const client = createMockClient();
      const adapter = new AnthropicAdapter({ client });
      expect(adapter._client).toBe(client);
    });

    it('accepts apiKey for lazy initialization', () => {
      const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
      expect(adapter._apiKey).toBe('sk-test');
      expect(adapter._initialized).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('creates SDK client from apiKey on first call', async () => {
      const adapter = new AnthropicAdapter({ apiKey: 'sk-test-key' });
      await adapter.initialize();
      expect(adapter._client).not.toBeNull();
      expect(adapter._initialized).toBe(true);
    });

    it('throws AdapterError when no apiKey and no client provided', async () => {
      const adapter = new AnthropicAdapter();
      await expect(adapter.initialize()).rejects.toThrow(AdapterError);
      await expect(adapter.initialize()).rejects.toThrow('Anthropic API key required');
    });

    it('is idempotent — second call is no-op', async () => {
      const client = createMockClient();
      const adapter = new AnthropicAdapter({ client });
      await adapter.initialize();
      await adapter.initialize();
      expect(adapter._initialized).toBe(true);
    });

    it('skips SDK creation when client injected', async () => {
      const client = createMockClient();
      const adapter = new AnthropicAdapter({ client });
      await adapter.initialize();
      expect(adapter._client).toBe(client);
    });

    it('sets _initialized flag', async () => {
      const client = createMockClient();
      const adapter = new AnthropicAdapter({ client });
      expect(adapter._initialized).toBe(false);
      await adapter.initialize();
      expect(adapter._initialized).toBe(true);
    });

    it('AdapterError has correct adapterType and operation', async () => {
      const adapter = new AnthropicAdapter();
      try {
        await adapter.initialize();
      } catch (err) {
        expect(err.adapterType).toBe('llm');
        expect(err.operation).toBe('initialize');
      }
    });
  });

  describe('complete()', () => {
    let adapter, mockClient;

    beforeEach(() => {
      mockClient = createMockClient();
      adapter = new AnthropicAdapter({ client: mockClient, retryDelayMs: 1 });
    });

    it('calls client.messages.create with correct params', async () => {
      await adapter.complete('test prompt');
      expect(mockClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'test prompt' }]
      });
    });

    it('returns { content, usage, model } shape', async () => {
      const result = await adapter.complete('prompt');
      expect(result).toEqual({
        content: '{"result": "ok"}',
        usage: { inputTokens: 100, outputTokens: 50 },
        model: 'claude-sonnet-4-5-20250929'
      });
    });

    it('passes model override via options', async () => {
      await adapter.complete('prompt', { model: 'claude-haiku-4-5-20251001' });
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
      );
    });

    it('passes maxTokens override via options', async () => {
      await adapter.complete('prompt', { maxTokens: 8192 });
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 8192 })
      );
    });

    it('passes temperature when provided', async () => {
      await adapter.complete('prompt', { temperature: 0.7 });
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 })
      );
    });

    it('passes systemPrompt as system field', async () => {
      await adapter.complete('prompt', { systemPrompt: 'You are a bug analyzer.' });
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'You are a bug analyzer.' })
      );
    });

    it('omits temperature when not provided', async () => {
      await adapter.complete('prompt');
      const args = mockClient.messages.create.mock.calls[0][0];
      expect(args).not.toHaveProperty('temperature');
    });

    it('omits system when no systemPrompt', async () => {
      await adapter.complete('prompt');
      const args = mockClient.messages.create.mock.calls[0][0];
      expect(args).not.toHaveProperty('system');
    });

    it('extracts text from single content block', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929'
      });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('hello world');
    });

    it('extracts and concatenates text from multiple content blocks', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [
          { type: 'text', text: 'part1' },
          { type: 'text', text: 'part2' }
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
        model: 'claude-sonnet-4-5-20250929'
      });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('part1part2');
    });

    it('returns empty string for empty content array', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [],
        usage: { input_tokens: 10, output_tokens: 0 },
        model: 'claude-sonnet-4-5-20250929'
      });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('');
    });

    it('handles missing usage gracefully (defaults to 0)', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-5-20250929'
      });
      const result = await adapter.complete('prompt');
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it('auto-initializes on first call', async () => {
      const client = createMockClient();
      const a = new AnthropicAdapter({ client });
      expect(a._initialized).toBe(false);
      await a.complete('prompt');
      expect(a._initialized).toBe(true);
    });

    it('retries on 429 rate limit', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 server error', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ status: 500, message: 'server error' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
    });

    it('retries on 502 bad gateway', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ status: 502, message: 'bad gateway' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
    });

    it('retries on 503 service unavailable', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ status: 503, message: 'unavailable' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
    });

    it('retries on 529 overloaded', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ status: 529, message: 'overloaded' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
    });

    it('retries on ECONNRESET network error', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'connection reset' })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-sonnet-4-5-20250929'
        });
      const result = await adapter.complete('prompt');
      expect(result.content).toBe('ok');
    });

    it('does NOT retry on 400 bad request', async () => {
      mockClient.messages.create.mockRejectedValue({ status: 400, message: 'bad request' });
      await expect(adapter.complete('prompt')).rejects.toThrow(AdapterError);
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 401 unauthorized', async () => {
      mockClient.messages.create.mockRejectedValue({ status: 401, message: 'unauthorized' });
      await expect(adapter.complete('prompt')).rejects.toThrow(AdapterError);
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it('throws AdapterError after exhausting retries', async () => {
      mockClient.messages.create.mockRejectedValue({ status: 429, message: 'rate limited' });
      try {
        await adapter.complete('prompt');
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterError);
        expect(err.details.attempt).toBe(4); // 1 initial + 3 retries
        expect(err.details.statusCode).toBe(429);
        expect(err.adapterType).toBe('llm');
        expect(err.operation).toBe('complete');
        expect(err.cause).toBeDefined();
      }
    });

    it('exponential backoff: delay doubles each retry', async () => {
      const delaySpy = jest.spyOn(adapter, '_delay').mockResolvedValue();
      mockClient.messages.create.mockRejectedValue({ status: 500, message: 'error' });

      await expect(adapter.complete('prompt')).rejects.toThrow(AdapterError);

      // 3 retries = 3 delay calls
      expect(delaySpy).toHaveBeenCalledTimes(3);
      expect(delaySpy).toHaveBeenNthCalledWith(1, 1);  // 1 * 2^0 = 1
      expect(delaySpy).toHaveBeenNthCalledWith(2, 2);  // 1 * 2^1 = 2
      expect(delaySpy).toHaveBeenNthCalledWith(3, 4);  // 1 * 2^2 = 4

      delaySpy.mockRestore();
    });
  });

  describe('streamComplete()', () => {
    let adapter, mockClient;

    beforeEach(() => {
      mockClient = createMockClient();
      adapter = new AnthropicAdapter({ client: mockClient });
    });

    it('yields text chunks from stream events', async () => {
      const chunks = [];
      for await (const chunk of adapter.streamComplete('prompt')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('ignores non-text events', async () => {
      mockClient.messages.stream.mockReturnValue(
        mockAsyncIterable([
          { type: 'message_start', message: {} },
          { type: 'content_block_delta', delta: { text: 'hello' } },
          { type: 'message_stop' }
        ])
      );
      const chunks = [];
      for await (const chunk of adapter.streamComplete('prompt')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['hello']);
    });

    it('auto-initializes on first call', async () => {
      const client = createMockClient();
      const a = new AnthropicAdapter({ client });
      expect(a._initialized).toBe(false);
      // eslint-disable-next-line no-unused-vars
      for await (const _ of a.streamComplete('prompt')) { /* consume */ }
      expect(a._initialized).toBe(true);
    });

    it('throws AdapterError on stream error', async () => {
      mockClient.messages.stream.mockReturnValue({
        [Symbol.asyncIterator]() {
          return {
            async next() { throw new Error('stream failed'); }
          };
        }
      });
      const chunks = [];
      await expect(async () => {
        for await (const chunk of adapter.streamComplete('prompt')) {
          chunks.push(chunk);
        }
      }).rejects.toThrow(AdapterError);
    });

    it('handles empty stream (yields nothing)', async () => {
      mockClient.messages.stream.mockReturnValue(mockAsyncIterable([]));
      const chunks = [];
      for await (const chunk of adapter.streamComplete('prompt')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });

    it('AdapterError has correct operation: streamComplete', async () => {
      mockClient.messages.stream.mockReturnValue({
        [Symbol.asyncIterator]() {
          return {
            async next() { throw new Error('stream failed'); }
          };
        }
      });
      try {
        for await (const _ of adapter.streamComplete('prompt')) { /* consume */ }
      } catch (err) {
        expect(err.operation).toBe('streamComplete');
        expect(err.adapterType).toBe('llm');
      }
    });
  });

  describe('Retry Logic (_isRetryable)', () => {
    let adapter;

    beforeEach(() => {
      adapter = new AnthropicAdapter({ client: createMockClient() });
    });

    it('returns true for 429, 500, 502, 503, 529', () => {
      expect(adapter._isRetryable({ status: 429 })).toBe(true);
      expect(adapter._isRetryable({ status: 500 })).toBe(true);
      expect(adapter._isRetryable({ status: 502 })).toBe(true);
      expect(adapter._isRetryable({ status: 503 })).toBe(true);
      expect(adapter._isRetryable({ status: 529 })).toBe(true);
    });

    it('returns false for 400, 401, 403, 404', () => {
      expect(adapter._isRetryable({ status: 400 })).toBe(false);
      expect(adapter._isRetryable({ status: 401 })).toBe(false);
      expect(adapter._isRetryable({ status: 403 })).toBe(false);
      expect(adapter._isRetryable({ status: 404 })).toBe(false);
    });

    it('returns true for ECONNRESET', () => {
      expect(adapter._isRetryable({ code: 'ECONNRESET' })).toBe(true);
    });

    it('returns true for ETIMEDOUT', () => {
      expect(adapter._isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('returns false for unknown error codes', () => {
      expect(adapter._isRetryable({ code: 'SOMETHING_ELSE' })).toBe(false);
      expect(adapter._isRetryable({})).toBe(false);
    });
  });
});
