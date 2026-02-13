'use strict';

const TwilioWhatsAppAdapter = require('../../../core/integrations/twilio/client');
const { AdapterError } = require('../../../core/engine/errors');

function createMockTwilioClient(overrides = {}) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        sid: 'SM_test_message_id_123',
        status: 'queued'
      }),
      ...overrides.messages
    }
  };
}

describe('TwilioWhatsAppAdapter', () => {
  describe('Constructor', () => {
    it('default maxRetries is 2', () => {
      const adapter = new TwilioWhatsAppAdapter();
      expect(adapter._maxRetries).toBe(2);
    });

    it('default retryDelayMs is 1000', () => {
      const adapter = new TwilioWhatsAppAdapter();
      expect(adapter._retryDelayMs).toBe(1000);
    });

    it('accepts injectable client', () => {
      const client = createMockTwilioClient();
      const adapter = new TwilioWhatsAppAdapter({ client });
      expect(adapter._client).toBe(client);
    });

    it('accepts accountSid + authToken for lazy init', () => {
      const adapter = new TwilioWhatsAppAdapter({
        accountSid: 'AC_test',
        authToken: 'token_test'
      });
      expect(adapter._accountSid).toBe('AC_test');
      expect(adapter._authToken).toBe('token_test');
      expect(adapter._initialized).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('creates Twilio client from accountSid + authToken', async () => {
      const adapter = new TwilioWhatsAppAdapter({
        accountSid: 'AC_test',
        authToken: 'token_test',
        fromNumber: 'whatsapp:+14155238886'
      });
      await adapter.initialize();
      expect(adapter._client).not.toBeNull();
      expect(adapter._initialized).toBe(true);
    });

    it('throws AdapterError when no accountSid', async () => {
      const adapter = new TwilioWhatsAppAdapter({ authToken: 'token' });
      await expect(adapter.initialize()).rejects.toThrow(AdapterError);
      await expect(adapter.initialize()).rejects.toThrow('account SID and auth token required');
    });

    it('throws AdapterError when no authToken', async () => {
      const adapter = new TwilioWhatsAppAdapter({ accountSid: 'AC_test' });
      await expect(adapter.initialize()).rejects.toThrow(AdapterError);
    });

    it('throws AdapterError when no fromNumber (without injected client)', async () => {
      const adapter = new TwilioWhatsAppAdapter({
        accountSid: 'AC_test',
        authToken: 'token_test'
      });
      await expect(adapter.initialize()).rejects.toThrow('from number required');
    });

    it('is idempotent — second call is no-op', async () => {
      const client = createMockTwilioClient();
      const adapter = new TwilioWhatsAppAdapter({ client });
      await adapter.initialize();
      await adapter.initialize();
      expect(adapter._initialized).toBe(true);
    });

    it('skips SDK creation when client injected', async () => {
      const client = createMockTwilioClient();
      const adapter = new TwilioWhatsAppAdapter({ client });
      await adapter.initialize();
      expect(adapter._client).toBe(client);
    });
  });

  describe('send()', () => {
    let adapter, mockClient;

    beforeEach(() => {
      mockClient = createMockTwilioClient();
      adapter = new TwilioWhatsAppAdapter({
        client: mockClient,
        fromNumber: 'whatsapp:+14155238886',
        retryDelayMs: 1
      });
    });

    it('calls client.messages.create with correct body, from, to', async () => {
      await adapter.send('whatsapp:+1234567890', 'Hello');
      expect(mockClient.messages.create).toHaveBeenCalledWith({
        body: 'Hello',
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+1234567890'
      });
    });

    it('returns { id, status } with Twilio SID as id', async () => {
      const result = await adapter.send('whatsapp:+1234567890', 'Hello');
      expect(result).toEqual({
        id: 'SM_test_message_id_123',
        status: 'pending'
      });
    });

    it('auto-initializes on first call', async () => {
      const client = createMockTwilioClient();
      const a = new TwilioWhatsAppAdapter({ client, fromNumber: 'whatsapp:+1' });
      expect(a._initialized).toBe(false);
      await a.send('whatsapp:+1234567890', 'Hello');
      expect(a._initialized).toBe(true);
    });

    it('adds whatsapp: prefix to bare phone number', async () => {
      await adapter.send('+1234567890', 'Hello');
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'whatsapp:+1234567890' })
      );
    });

    it('passes through number that already has whatsapp: prefix', async () => {
      await adapter.send('whatsapp:+1234567890', 'Hello');
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'whatsapp:+1234567890' })
      );
    });

    it('handles array recipient (uses first)', async () => {
      await adapter.send(['+1111111111', '+2222222222'], 'Hello');
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'whatsapp:+1111111111' })
      );
    });

    it("maps 'queued' to 'pending'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'queued' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('pending');
    });

    it("maps 'sent' to 'sent'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'sent' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('sent');
    });

    it("maps 'delivered' to 'delivered'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'delivered' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('delivered');
    });

    it("maps 'failed' to 'failed'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'failed' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('failed');
    });

    it("maps 'undelivered' to 'failed'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'undelivered' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('failed');
    });

    it("maps 'read' to 'delivered'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'read' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('delivered');
    });

    it("maps unknown status to 'unknown'", async () => {
      mockClient.messages.create.mockResolvedValue({ sid: 'SM1', status: 'some_new_status' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.status).toBe('unknown');
    });

    it('retries on Twilio rate limit (code 20429)', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ code: 20429, message: 'rate limited' })
        .mockResolvedValueOnce({ sid: 'SM1', status: 'queued' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.id).toBe('SM1');
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2);
    });

    it('retries on Twilio server error (code 20500)', async () => {
      mockClient.messages.create
        .mockRejectedValueOnce({ code: 20500, message: 'server error' })
        .mockResolvedValueOnce({ sid: 'SM1', status: 'queued' });
      const result = await adapter.send('whatsapp:+1', 'msg');
      expect(result.id).toBe('SM1');
    });

    it('does NOT retry on invalid number (code 21211)', async () => {
      mockClient.messages.create.mockRejectedValue({ code: 21211, message: 'invalid number' });
      await expect(adapter.send('whatsapp:+invalid', 'msg')).rejects.toThrow(AdapterError);
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it('throws AdapterError after exhausting retries (with redacted number, twilioCode)', async () => {
      mockClient.messages.create.mockRejectedValue({ code: 20429, message: 'rate limited' });
      try {
        await adapter.send('whatsapp:+14155238886', 'msg');
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterError);
        expect(err.adapterType).toBe('notification');
        expect(err.operation).toBe('send');
        expect(err.details.twilioCode).toBe(20429);
        expect(err.details.attempt).toBe(3); // 1 initial + 2 retries
        expect(err.details.recipient).not.toContain('14155238886');
        expect(err.details.recipient).toContain('8886');
        expect(err.cause).toBeDefined();
      }
    });
  });

  describe('sendWithActions()', () => {
    let adapter, mockClient;

    beforeEach(() => {
      mockClient = createMockTwilioClient();
      adapter = new TwilioWhatsAppAdapter({
        client: mockClient,
        fromNumber: 'whatsapp:+14155238886'
      });
    });

    it('appends action labels to message', async () => {
      await adapter.sendWithActions('whatsapp:+1', 'Approve fix?', [
        { id: 'YES-ABC-001', label: 'Approve' }
      ]);
      const body = mockClient.messages.create.mock.calls[0][0].body;
      expect(body).toContain('Approve fix?');
      expect(body).toContain('YES-ABC-001');
    });

    it('formats actions as reply instructions', async () => {
      await adapter.sendWithActions('whatsapp:+1', 'Message', [
        { id: 'YES', label: 'Approve' }
      ]);
      const body = mockClient.messages.create.mock.calls[0][0].body;
      expect(body).toContain('Reply "YES" to Approve');
    });

    it('delegates to send() with combined message', async () => {
      const sendSpy = jest.spyOn(adapter, 'send');
      await adapter.sendWithActions('whatsapp:+1', 'Question?', [
        { id: 'A', label: 'Option A' }
      ]);
      expect(sendSpy).toHaveBeenCalledWith(
        'whatsapp:+1',
        expect.stringContaining('Question?')
      );
      sendSpy.mockRestore();
    });

    it('returns same { id, status } shape as send()', async () => {
      const result = await adapter.sendWithActions('whatsapp:+1', 'msg', [
        { id: 'A', label: 'Go' }
      ]);
      expect(result).toEqual({
        id: 'SM_test_message_id_123',
        status: 'pending'
      });
    });

    it('handles multiple actions', async () => {
      await adapter.sendWithActions('whatsapp:+1', 'Choose:', [
        { id: 'YES-ABC', label: 'Approve Fix' },
        { id: 'NO-ABC', label: 'Reject Fix' },
        { id: 'INFO-ABC', label: 'More Info' }
      ]);
      const body = mockClient.messages.create.mock.calls[0][0].body;
      expect(body).toContain('YES-ABC');
      expect(body).toContain('NO-ABC');
      expect(body).toContain('INFO-ABC');
    });
  });

  describe('Recipient Normalization (_normalizeRecipient)', () => {
    let adapter;

    beforeEach(() => {
      adapter = new TwilioWhatsAppAdapter({ client: createMockTwilioClient() });
    });

    it('adds prefix to bare number', () => {
      expect(adapter._normalizeRecipient('+1234567890')).toBe('whatsapp:+1234567890');
    });

    it('preserves existing prefix', () => {
      expect(adapter._normalizeRecipient('whatsapp:+1234567890')).toBe('whatsapp:+1234567890');
    });

    it("handles '+' country code", () => {
      expect(adapter._normalizeRecipient('+44123456789')).toBe('whatsapp:+44123456789');
    });

    it('extracts first from array', () => {
      expect(adapter._normalizeRecipient(['+1111', '+2222'])).toBe('whatsapp:+1111');
    });
  });

  describe('Number Redaction (_redactNumber)', () => {
    let adapter;

    beforeEach(() => {
      adapter = new TwilioWhatsAppAdapter({ client: createMockTwilioClient() });
    });

    it('keeps last 4 digits', () => {
      const result = adapter._redactNumber('+14155238886');
      expect(result).toContain('8886');
    });

    it('handles whatsapp: prefix', () => {
      const result = adapter._redactNumber('whatsapp:+14155238886');
      expect(result).toContain('8886');
      expect(result).not.toContain('14155238886');
    });

    it('handles short numbers', () => {
      const result = adapter._redactNumber('1234');
      expect(result).toBe('1234');
    });
  });

  describe('Retry Logic (_isRetryable)', () => {
    let adapter;

    beforeEach(() => {
      adapter = new TwilioWhatsAppAdapter({ client: createMockTwilioClient() });
    });

    it('returns true for 20429', () => {
      expect(adapter._isRetryable({ code: 20429 })).toBe(true);
    });

    it('returns true for 20500', () => {
      expect(adapter._isRetryable({ code: 20500 })).toBe(true);
    });

    it('returns false for 21211 (invalid number)', () => {
      expect(adapter._isRetryable({ code: 21211 })).toBe(false);
    });

    it('returns true for ECONNRESET', () => {
      expect(adapter._isRetryable({ code: 'ECONNRESET' })).toBe(true);
    });
  });
});
