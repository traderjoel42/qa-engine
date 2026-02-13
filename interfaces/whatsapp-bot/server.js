'use strict';

const express = require('express');
const crypto = require('crypto');
const MessageParser = require('./message-parser');
const CommandHandler = require('./command-handler');

class WebhookServer {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {WebhookConfig} options.config - Server configuration
   * @param {MessageParser} [options.parser] - Injectable parser (default: new MessageParser())
   * @param {CommandHandler} [options.handler] - Injectable handler
   */
  constructor({ engine, notifier, config, parser, handler }) {
    if (!config) throw new Error('WebhookServer requires config');
    if (!config.twilioAuthToken && config.validateSignatures !== false) {
      throw new Error('WebhookServer requires config.twilioAuthToken when signature validation is enabled');
    }

    this.engine = engine;
    this.notifier = notifier;
    this.config = {
      port: 3001,
      webhookPath: '/webhooks/whatsapp',
      validateSignatures: true,
      allowedNumbers: [],
      defaultAppId: 'brainstormy',
      ...config
    };

    this.parser = parser || new MessageParser();
    this.handler = handler || new CommandHandler({
      engine,
      notifier,
      defaultAppId: this.config.defaultAppId
    });

    this.app = null;
    this.server = null;
  }

  /**
   * Create and configure the Express app.
   * @returns {express.Application}
   */
  createApp() {
    const app = express();

    // Parse URL-encoded bodies (Twilio sends form data)
    app.use(express.urlencoded({ extended: false }));

    // Health check
    app.get('/health', (req, res) => this.healthCheck(req, res));

    // Webhook endpoint
    app.post(this.config.webhookPath, async (req, res) => {
      await this._handleWebhook(req, res);
    });

    this.app = app;
    return app;
  }

  /**
   * Start the HTTP server.
   * @returns {Promise<http.Server>}
   */
  async start() {
    if (!this.app) {
      this.createApp();
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        resolve(this.server);
      });
    });
  }

  /**
   * Stop the HTTP server gracefully.
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Core webhook handler — signature validation, authorization, parse, route.
   * @param {express.Request} req
   * @param {express.Response} res
   */
  async _handleWebhook(req, res) {
    try {
      // 1. Validate Twilio signature
      if (this.config.validateSignatures && !this.validateSignature(req)) {
        res.status(403).send('Invalid signature');
        return;
      }

      // 2. Extract message
      const message = this.extractMessage(req);

      // 3. Check authorization
      if (!this.isAuthorized(message.from)) {
        // Send unauthorized response via Twilio
        if (this.notifier) {
          await this.notifier.send(
            message.from,
            '⛔ Unauthorized. This number is not registered with QA Engine.'
          ).catch(() => {}); // Best effort
        }
        res.status(200).type('text/xml').send('<Response></Response>');
        return;
      }

      // 4. Parse command
      const command = this.parser.parse(message.body);

      // 5. Route to handler (async — don't block webhook response)
      // We still await here because the handler sends the response;
      // only engine.run() is fire-and-forget within the handler.
      await this.handler.handle(command, message);

      // 6. Return empty TwiML (all responses sent via REST API)
      res.status(200).type('text/xml').send('<Response></Response>');

    } catch (error) {
      // Log error but still return 200 to Twilio
      // (Twilio retries on non-200, which would cause duplicate processing)
      console.error('Webhook handler error:', error);
      res.status(200).type('text/xml').send('<Response></Response>');
    }
  }

  /**
   * Validate Twilio webhook signature using HMAC-SHA1.
   *
   * Algorithm:
   * 1. Take the full webhook URL
   * 2. Sort the POST parameters alphabetically by key
   * 3. Append each key-value pair to the URL
   * 4. HMAC-SHA1 the result with the auth token
   * 5. Compare with X-Twilio-Signature header
   *
   * @param {express.Request} req
   * @returns {boolean}
   */
  validateSignature(req) {
    const signature = req.headers['x-twilio-signature'];
    if (!signature) return false;

    const url = this.config.webhookUrl || `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Sort POST params and append to URL
    let data = url;
    if (req.body) {
      const sortedKeys = Object.keys(req.body).sort();
      for (const key of sortedKeys) {
        data += key + req.body[key];
      }
    }

    // HMAC-SHA1
    const expectedSignature = crypto
      .createHmac('sha1', this.config.twilioAuthToken)
      .update(data, 'utf-8')
      .digest('base64');

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false; // Different lengths
    }
  }

  /**
   * Extract InboundMessage from Twilio webhook body.
   * @param {express.Request} req
   * @returns {InboundMessage}
   */
  extractMessage(req) {
    return {
      from: req.body.From || '',
      body: req.body.Body || '',
      messageSid: req.body.MessageSid || '',
      accountSid: req.body.AccountSid || '',
      receivedAt: new Date()
    };
  }

  /**
   * Check if sender is in the allowed numbers list.
   * Empty allowlist = allow all (for development).
   * @param {string} from
   * @returns {boolean}
   */
  isAuthorized(from) {
    if (this.config.allowedNumbers.length === 0) return true;
    return this.config.allowedNumbers.includes(from);
  }

  /**
   * Health check endpoint.
   */
  healthCheck(req, res) {
    res.json({
      status: 'ok',
      service: 'qa-engine-whatsapp-bot',
      uptime: process.uptime()
    });
  }
}

module.exports = WebhookServer;
