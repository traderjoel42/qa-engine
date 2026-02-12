'use strict';

const LLMAdapter = require('../../../core/integrations/adapters/llm');
const { AdapterError } = require('../../../core/engine/errors');

describe('LLMAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new LLMAdapter();
  });

  it('complete() throws AdapterError with correct adapterType and operation', async () => {
    try {
      await adapter.complete('prompt');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('llm');
      expect(err.operation).toBe('complete');
    }
  });

  it('complete() rejects (not just throws)', async () => {
    await expect(adapter.complete('prompt')).rejects.toThrow(AdapterError);
  });

  it('streamComplete() throws AdapterError with correct adapterType and operation', async () => {
    try {
      const gen = adapter.streamComplete('prompt');
      await gen.next();
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('llm');
      expect(err.operation).toBe('streamComplete');
    }
  });
});
