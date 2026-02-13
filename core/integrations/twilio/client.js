'use strict';

const NotificationAdapter = require('../adapters/notification');
const { AdapterError } = require('../../engine/errors');

class TwilioWhatsAppAdapter extends NotificationAdapter {
  constructor(options = {}) {
    super();
    this._client = options.client || null;
    this._accountSid = options.accountSid || null;
    this._authToken = options.authToken || null;
    this._fromNumber = options.fromNumber || null;
    this._maxRetries = options.maxRetries || 2;
    this._retryDelayMs = options.retryDelayMs || 1000;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    if (!this._client) {
      if (!this._accountSid || !this._authToken) {
        throw new AdapterError('Twilio account SID and auth token required', {
          adapterType: 'notification',
          operation: 'initialize'
        });
      }
      if (!this._fromNumber) {
        throw new AdapterError('Twilio from number required', {
          adapterType: 'notification',
          operation: 'initialize'
        });
      }
      const twilio = require('twilio');
      this._client = twilio(this._accountSid, this._authToken);
    }

    this._initialized = true;
  }

  async send(recipient, message) {
    await this.initialize();

    const to = this._normalizeRecipient(recipient);

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const result = await this._client.messages.create({
          body: message,
          from: this._fromNumber,
          to
        });

        return {
          id: result.sid,
          status: this._mapStatus(result.status)
        };
      } catch (error) {
        if (this._isRetryable(error) && attempt < this._maxRetries) {
          await this._delay(this._retryDelayMs * Math.pow(2, attempt));
          continue;
        }

        throw new AdapterError(`Twilio send error: ${error.message}`, {
          adapterType: 'notification',
          operation: 'send',
          cause: error,
          details: {
            recipient: this._redactNumber(to),
            attempt: attempt + 1,
            statusCode: error.status || null,
            twilioCode: error.code || null
          }
        });
      }
    }
  }

  async sendWithActions(recipient, message, actions) {
    const actionLines = actions.map(a => `\u2022 Reply "${a.id}" to ${a.label}`).join('\n');
    const fullMessage = `${message}\n\n${actionLines}`;

    return this.send(recipient, fullMessage);
  }

  _normalizeRecipient(recipient) {
    const number = Array.isArray(recipient) ? recipient[0] : recipient;

    if (!number.startsWith('whatsapp:')) {
      return `whatsapp:${number}`;
    }
    return number;
  }

  _mapStatus(twilioStatus) {
    const statusMap = {
      'queued': 'pending',
      'sending': 'pending',
      'sent': 'sent',
      'delivered': 'delivered',
      'undelivered': 'failed',
      'failed': 'failed',
      'read': 'delivered'
    };
    return statusMap[twilioStatus] || 'unknown';
  }

  _redactNumber(number) {
    return number.replace(/(\+?\d*)(\d{4})$/, (_, prefix, last4) => {
      return '*'.repeat(prefix.length) + last4;
    });
  }

  _isRetryable(error) {
    const retryableCodes = [20429, 20500, 20503];
    if (error.code && retryableCodes.includes(error.code)) {
      return true;
    }
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
    return false;
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TwilioWhatsAppAdapter;
