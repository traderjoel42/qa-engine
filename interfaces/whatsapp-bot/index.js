'use strict';

const WebhookServer = require('./server');
const MessageParser = require('./message-parser');
const CommandHandler = require('./command-handler');
const NotificationTemplates = require('./notification-templates');

/**
 * Create a fully-wired WhatsApp bot instance.
 *
 * @param {Object} options
 * @param {Object} options.engine - From createEngine()
 * @param {Object} options.notifier - NotificationAdapter instance (Twilio)
 * @param {Object} options.config - WebhookConfig
 * @returns {WebhookServer}
 */
function createWhatsAppBot({ engine, notifier, config }) {
  return new WebhookServer({ engine, notifier, config });
}

module.exports = {
  createWhatsAppBot,
  WebhookServer,
  MessageParser,
  CommandHandler,
  NotificationTemplates
};
