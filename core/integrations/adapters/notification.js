'use strict';

const { AdapterError } = require('../../engine/errors');

/**
 * Base adapter for notification channels (WhatsApp, Slack, email, etc.).
 * Concrete implementations must override all methods.
 */
class NotificationAdapter {
  /**
   * Send a simple text message.
   * @param {string|string[]} recipient - Recipient identifier(s) (phone number, channel ID, email)
   * @param {string} message - Message text
   * @returns {Promise<{id: string, status: string}>} Send result
   */
  async send(recipient, message) {
    throw new AdapterError('send() must be implemented by subclass', {
      adapterType: 'notification',
      operation: 'send'
    });
  }

  /**
   * Send a message with interactive actions (approve/reject buttons).
   * @param {string|string[]} recipient - Recipient identifier(s)
   * @param {string} message - Message text
   * @param {Array<{id: string, label: string}>} actions - Available actions
   * @returns {Promise<{id: string, status: string}>} Send result
   */
  async sendWithActions(recipient, message, actions) {
    throw new AdapterError('sendWithActions() must be implemented by subclass', {
      adapterType: 'notification',
      operation: 'sendWithActions'
    });
  }
}

module.exports = NotificationAdapter;
