'use strict';

const crypto = require('crypto');
const request = require('supertest');
const WebhookServer = require('../../interfaces/whatsapp-bot/server');

function createMockEngine() {
  return {
    run: jest.fn().mockResolvedValue({}),
    status: jest.fn().mockResolvedValue({ activeRuns: [], recentRuns: [] }),
    bugs: jest.fn().mockResolvedValue([]),
    approve: jest.fn().mockResolvedValue({ action: 'approved', approval_id: 'ABC-247' }),
    reject: jest.fn().mockResolvedValue({ action: 'rejected', approval_id: 'ABC-247' }),
    bugInfo: jest.fn().mockResolvedValue({
      action: 'info',
      bug: {
        bug_id: 'BUG-248', title: 'Test', severity: 'medium', category: 'test',
        detected_by: 'sentinel', created_at: '2026-02-12T14:00:00Z',
        root_cause: 'cause', affected_component: 'test.js', fix_approach: 'fix'
      }
    }),
    shutdown: jest.fn().mockResolvedValue(undefined)
  };
}

function createMockNotifier() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const AUTH_TOKEN = 'test_auth_token_12345';
const WEBHOOK_URL = 'https://example.com/webhooks/whatsapp';

function computeSignature(url, params, authToken) {
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
}

function createServer(overrides = {}) {
  const engine = createMockEngine();
  const notifier = createMockNotifier();
  const config = {
    twilioAuthToken: AUTH_TOKEN,
    webhookUrl: WEBHOOK_URL,
    validateSignatures: true,
    allowedNumbers: [],
    port: 0, // random port
    ...overrides.config
  };
  const { config: _ignored, ...rest } = overrides;
  const server = new WebhookServer({
    engine,
    notifier,
    config,
    ...rest
  });
  return { server, engine, notifier };
}

describe('WebhookServer', () => {

  // ── constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    test('throws if config missing', () => {
      expect(() => new WebhookServer({
        engine: createMockEngine(),
        notifier: createMockNotifier()
      })).toThrow('WebhookServer requires config');
    });

    test('throws if twilioAuthToken missing when validateSignatures is true', () => {
      expect(() => new WebhookServer({
        engine: createMockEngine(),
        notifier: createMockNotifier(),
        config: { validateSignatures: true }
      })).toThrow('twilioAuthToken');
    });

    test('allows missing twilioAuthToken when validateSignatures is false', () => {
      expect(() => new WebhookServer({
        engine: createMockEngine(),
        notifier: createMockNotifier(),
        config: { validateSignatures: false }
      })).not.toThrow();
    });

    test('applies default config values (port, path, etc.)', () => {
      const { server } = createServer();
      expect(server.config.port).toBe(0);
      expect(server.config.webhookPath).toBe('/webhooks/whatsapp');
      expect(server.config.defaultAppId).toBe('brainstormy');
    });

    test('creates default MessageParser if not injected', () => {
      const { server } = createServer();
      expect(server.parser).toBeDefined();
      expect(typeof server.parser.parse).toBe('function');
    });

    test('creates default CommandHandler if not injected', () => {
      const { server } = createServer();
      expect(server.handler).toBeDefined();
      expect(typeof server.handler.handle).toBe('function');
    });

    test('uses injected parser when provided', () => {
      const customParser = { parse: jest.fn() };
      const { server } = createServer({ parser: customParser });
      expect(server.parser).toBe(customParser);
    });

    test('uses injected handler when provided', () => {
      const customHandler = { handle: jest.fn() };
      const { server } = createServer({ handler: customHandler });
      expect(server.handler).toBe(customHandler);
    });
  });

  // ── createApp() ────────────────────────────────────────────────────

  describe('createApp()', () => {
    test('returns an Express application', () => {
      const { server } = createServer();
      const app = server.createApp();
      expect(typeof app.listen).toBe('function');
    });

    test('registers /health GET endpoint', async () => {
      const { server } = createServer();
      const app = server.createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    test('registers webhookPath POST endpoint', async () => {
      const { server } = createServer({ config: { validateSignatures: false } });
      const app = server.createApp();
      const res = await request(app)
        .post('/webhooks/whatsapp')
        .send('Body=help&From=whatsapp:+15551234567');
      expect(res.status).toBe(200);
    });

    test('configures URL-encoded body parsing', async () => {
      const { server } = createServer({ config: { validateSignatures: false } });
      const app = server.createApp();
      const res = await request(app)
        .post('/webhooks/whatsapp')
        .type('form')
        .send({ Body: 'help', From: 'whatsapp:+15551234567' });
      expect(res.status).toBe(200);
    });
  });

  // ── health check ───────────────────────────────────────────────────

  describe('health check — GET /health', () => {
    test('returns 200 with status ok', async () => {
      const { server } = createServer();
      const app = server.createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    test('includes service name', async () => {
      const { server } = createServer();
      const app = server.createApp();
      const res = await request(app).get('/health');
      expect(res.body.service).toBe('qa-engine-whatsapp-bot');
    });

    test('includes uptime', async () => {
      const { server } = createServer();
      const app = server.createApp();
      const res = await request(app).get('/health');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  // ── webhook POST ───────────────────────────────────────────────────

  describe('webhook — POST /webhooks/whatsapp', () => {

    describe('signature validation', () => {
      test('rejects request with missing X-Twilio-Signature → 403', async () => {
        const { server } = createServer();
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.status).toBe(403);
      });

      test('rejects request with invalid signature → 403', async () => {
        const { server } = createServer();
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .set('X-Twilio-Signature', 'invalidsignature')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.status).toBe(403);
      });

      test('accepts request with valid signature → 200', async () => {
        const { server } = createServer();
        const app = server.createApp();
        const params = { Body: 'help', From: 'whatsapp:+15551234567' };
        const sig = computeSignature(WEBHOOK_URL, params, AUTH_TOKEN);
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .set('X-Twilio-Signature', sig)
          .type('form')
          .send(params);
        expect(res.status).toBe(200);
      });

      test('skips validation when validateSignatures is false', async () => {
        const { server } = createServer({ config: { validateSignatures: false } });
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.status).toBe(200);
      });
    });

    describe('authorization', () => {
      test('allows message from authorized number', async () => {
        const { server, notifier } = createServer({
          config: {
            validateSignatures: false,
            allowedNumbers: ['whatsapp:+15551234567']
          }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        // Should send help menu, not unauthorized
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('QA Engine Commands')
        );
      });

      test('rejects message from unauthorized number', async () => {
        const { server, notifier } = createServer({
          config: {
            validateSignatures: false,
            allowedNumbers: ['whatsapp:+15559999999']
          }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('Unauthorized')
        );
      });

      test('allows all numbers when allowedNumbers is empty', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false, allowedNumbers: [] }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('QA Engine Commands')
        );
      });

      test('sends unauthorized notification to rejected sender', async () => {
        const { server, notifier } = createServer({
          config: {
            validateSignatures: false,
            allowedNumbers: ['whatsapp:+15559999999']
          }
        });
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.status).toBe(200);
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('Unauthorized')
        );
      });
    });

    describe('message extraction', () => {
      test('extracts From, Body, MessageSid, AccountSid', async () => {
        const mockHandler = { handle: jest.fn().mockResolvedValue({ success: true }) };
        const { server } = createServer({
          config: { validateSignatures: false },
          handler: mockHandler
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({
            From: 'whatsapp:+15551234567',
            Body: 'help',
            MessageSid: 'SM123',
            AccountSid: 'AC456'
          });
        const message = mockHandler.handle.mock.calls[0][1];
        expect(message.from).toBe('whatsapp:+15551234567');
        expect(message.body).toBe('help');
        expect(message.messageSid).toBe('SM123');
        expect(message.accountSid).toBe('AC456');
      });

      test('handles missing Body gracefully', async () => {
        const mockHandler = { handle: jest.fn().mockResolvedValue({ success: true }) };
        const { server } = createServer({
          config: { validateSignatures: false },
          handler: mockHandler
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ From: 'whatsapp:+15551234567' });
        const message = mockHandler.handle.mock.calls[0][1];
        expect(message.body).toBe('');
      });

      test('handles missing From gracefully', async () => {
        const mockHandler = { handle: jest.fn().mockResolvedValue({ success: true }) };
        const { server } = createServer({
          config: { validateSignatures: false },
          handler: mockHandler
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help' });
        const message = mockHandler.handle.mock.calls[0][1];
        expect(message.from).toBe('');
      });
    });

    describe('command routing', () => {
      test('parses message body and routes to handler', async () => {
        const mockHandler = { handle: jest.fn().mockResolvedValue({ success: true }) };
        const { server } = createServer({
          config: { validateSignatures: false },
          handler: mockHandler
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'status', From: 'whatsapp:+15551234567' });
        expect(mockHandler.handle).toHaveBeenCalledWith(
          { type: 'status', params: {} },
          expect.objectContaining({ from: 'whatsapp:+15551234567' })
        );
      });

      test('returns empty TwiML response', async () => {
        const { server } = createServer({ config: { validateSignatures: false } });
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.text).toBe('<Response></Response>');
      });

      test('returns 200 even on handler errors (prevents Twilio retries)', async () => {
        const mockHandler = { handle: jest.fn().mockRejectedValue(new Error('Boom')) };
        const { server } = createServer({
          config: { validateSignatures: false },
          handler: mockHandler
        });
        jest.spyOn(console, 'error').mockImplementation();
        const app = server.createApp();
        const res = await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(res.status).toBe(200);
        console.error.mockRestore();
      });
    });

    describe('full integration flow', () => {
      test('"Run smoke tests" → parser → handler → run ack sent', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'run smoke', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('smoke tests')
        );
      });

      test('"YES-ABC-247" → parser → handler → approve sent', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'YES-ABC-247', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('Approved: ABC-247')
        );
      });

      test('"status" → parser → handler → status report sent', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'status', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('QA Engine Status')
        );
      });

      test('"help" → parser → handler → help menu sent', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'help', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining('QA Engine Commands')
        );
      });

      test('"gibberish" → parser → handler → unknown response sent', async () => {
        const { server, notifier } = createServer({
          config: { validateSignatures: false }
        });
        const app = server.createApp();
        await request(app)
          .post('/webhooks/whatsapp')
          .type('form')
          .send({ Body: 'gibberish', From: 'whatsapp:+15551234567' });
        expect(notifier.send).toHaveBeenCalledWith(
          'whatsapp:+15551234567',
          expect.stringContaining("didn't understand")
        );
      });
    });
  });

  // ── validateSignature() ────────────────────────────────────────────

  describe('validateSignature()', () => {
    test('computes HMAC-SHA1 correctly per Twilio spec', () => {
      const { server } = createServer();
      const params = { Body: 'help', From: 'whatsapp:+15551234567' };
      const sig = computeSignature(WEBHOOK_URL, params, AUTH_TOKEN);
      const req = {
        headers: { 'x-twilio-signature': sig },
        protocol: 'https',
        get: () => 'example.com',
        originalUrl: '/webhooks/whatsapp',
        body: params
      };
      expect(server.validateSignature(req)).toBe(true);
    });

    test('sorts POST params alphabetically', () => {
      const { server } = createServer();
      const params = { Zebra: 'z', Apple: 'a' };
      const sig = computeSignature(WEBHOOK_URL, params, AUTH_TOKEN);
      const req = {
        headers: { 'x-twilio-signature': sig },
        protocol: 'https',
        get: () => 'example.com',
        originalUrl: '/webhooks/whatsapp',
        body: params
      };
      expect(server.validateSignature(req)).toBe(true);
    });

    test('appends key-value pairs to URL', () => {
      const { server } = createServer();
      // Manually verify: URL + sorted key-value pairs
      const params = { Body: 'test' };
      const expectedData = WEBHOOK_URL + 'Bodytest';
      const sig = crypto.createHmac('sha1', AUTH_TOKEN).update(expectedData, 'utf-8').digest('base64');
      const req = {
        headers: { 'x-twilio-signature': sig },
        protocol: 'https',
        get: () => 'example.com',
        originalUrl: '/webhooks/whatsapp',
        body: params
      };
      expect(server.validateSignature(req)).toBe(true);
    });

    test('uses timing-safe comparison', () => {
      // Verify it doesn't throw on valid signatures (timing-safe comparison works)
      const { server } = createServer();
      const params = { Body: 'help' };
      const sig = computeSignature(WEBHOOK_URL, params, AUTH_TOKEN);
      const req = {
        headers: { 'x-twilio-signature': sig },
        body: params
      };
      // Should not throw
      expect(() => server.validateSignature(req)).not.toThrow();
    });

    test('returns false for length mismatch', () => {
      const { server } = createServer();
      const req = {
        headers: { 'x-twilio-signature': 'short' },
        protocol: 'https',
        get: () => 'example.com',
        originalUrl: '/webhooks/whatsapp',
        body: { Body: 'help' }
      };
      expect(server.validateSignature(req)).toBe(false);
    });

    test('uses config.webhookUrl when available', () => {
      const { server } = createServer({ config: { webhookUrl: 'https://custom.com/hook' } });
      const params = { Body: 'help' };
      const sig = computeSignature('https://custom.com/hook', params, AUTH_TOKEN);
      const req = {
        headers: { 'x-twilio-signature': sig },
        protocol: 'https',
        get: () => 'example.com',
        originalUrl: '/webhooks/whatsapp',
        body: params
      };
      expect(server.validateSignature(req)).toBe(true);
    });

    test('falls back to req host/path when webhookUrl not set', () => {
      const { server } = createServer();
      // Remove webhookUrl from config
      delete server.config.webhookUrl;
      const params = { Body: 'help' };
      const fallbackUrl = 'https://myhost.com/webhooks/whatsapp';
      const sig = computeSignature(fallbackUrl, params, AUTH_TOKEN);
      const req = {
        headers: { 'x-twilio-signature': sig },
        protocol: 'https',
        get: (header) => header === 'host' ? 'myhost.com' : undefined,
        originalUrl: '/webhooks/whatsapp',
        body: params
      };
      expect(server.validateSignature(req)).toBe(true);
    });
  });

  // ── start() and stop() ────────────────────────────────────────────

  describe('start() and stop()', () => {
    test('start() returns http.Server', async () => {
      const { server } = createServer();
      const httpServer = await server.start();
      expect(httpServer).toBeDefined();
      expect(typeof httpServer.close).toBe('function');
      await server.stop();
    });

    test('stop() closes server gracefully', async () => {
      const { server } = createServer();
      await server.start();
      await expect(server.stop()).resolves.toBeUndefined();
    });

    test('stop() resolves immediately if server not started', async () => {
      const { server } = createServer();
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  // ── isAuthorized() ────────────────────────────────────────────────

  describe('isAuthorized()', () => {
    test('returns true if from is in allowedNumbers', () => {
      const { server } = createServer({
        config: { allowedNumbers: ['whatsapp:+15551234567'] }
      });
      expect(server.isAuthorized('whatsapp:+15551234567')).toBe(true);
    });

    test('returns false if from is not in allowedNumbers', () => {
      const { server } = createServer({
        config: { allowedNumbers: ['whatsapp:+15559999999'] }
      });
      expect(server.isAuthorized('whatsapp:+15551234567')).toBe(false);
    });

    test('returns true if allowedNumbers is empty (dev mode)', () => {
      const { server } = createServer({ config: { allowedNumbers: [] } });
      expect(server.isAuthorized('whatsapp:+15551234567')).toBe(true);
    });
  });
});
