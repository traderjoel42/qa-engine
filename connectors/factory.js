'use strict';

const GenericWebAppConnector = require('./generic-web-app/connector');
const AIAppConnector = require('./ai-chat-app/connector');
const BrainstormyConnector = require('./brainstormy/connector');
const { ConnectorError } = require('./errors');

/**
 * Factory for instantiating the correct connector class from app configuration.
 *
 * Agents use ConnectorFactory.create() instead of importing connector classes
 * directly. This keeps agents app-agnostic.
 *
 * The connector type is determined by app.connector.type in the app config.
 * New connectors are registered by adding them to the CONNECTOR_REGISTRY.
 *
 * @example
 * const connector = await ConnectorFactory.create(appConfig, page, evidenceCollector);
 * // connector is now an initialized instance of the correct connector class
 * await connector.performAction('send_message', { text: 'Hello' });
 * await connector.cleanup();
 */
class ConnectorFactory {

  /**
   * Registry of connector type strings → connector classes.
   * Add new connectors here.
   */
  static CONNECTOR_REGISTRY = {
    'generic': GenericWebAppConnector,
    'ai-chat-app': AIAppConnector,
    'brainstormy': BrainstormyConnector
  };

  /**
   * Create and initialize a connector for the given app.
   *
   * @param {object} app - App configuration (includes connector.type)
   * @param {import('playwright').Page} page - Playwright page instance
   * @param {object} evidenceCollector - Evidence collection service
   * @param {object} [options]
   * @param {boolean} [options.skipInitialize=false] - Skip calling initialize() (for testing)
   * @returns {Promise<BaseConnector>} Initialized connector instance
   * @throws {ConnectorError} If connector type is unknown
   */
  static async create(app, page, evidenceCollector, { skipInitialize = false } = {}) {
    const connectorType = app.connector?.type;

    if (!connectorType) {
      throw new ConnectorError(
        'App configuration missing connector.type',
        { phase: 'initialize' }
      );
    }

    const ConnectorClass = ConnectorFactory.CONNECTOR_REGISTRY[connectorType];

    if (!ConnectorClass) {
      throw new ConnectorError(
        `Unknown connector type: "${connectorType}". Available: ${Object.keys(ConnectorFactory.CONNECTOR_REGISTRY).join(', ')}`,
        { phase: 'initialize' }
      );
    }

    const connector = new ConnectorClass(app, page, evidenceCollector);

    if (!skipInitialize) {
      await connector.initialize();
    }

    return connector;
  }

  /**
   * Register a new connector class.
   * Used by plugins or app-specific connectors added at runtime.
   *
   * @param {string} type - Connector type string
   * @param {typeof BaseConnector} ConnectorClass - Connector class (must extend BaseConnector)
   */
  static register(type, ConnectorClass) {
    ConnectorFactory.CONNECTOR_REGISTRY[type] = ConnectorClass;
  }

  /**
   * Get list of registered connector types.
   *
   * @returns {string[]}
   */
  static getRegisteredTypes() {
    return Object.keys(ConnectorFactory.CONNECTOR_REGISTRY);
  }
}

module.exports = ConnectorFactory;
