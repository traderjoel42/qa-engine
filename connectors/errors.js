'use strict';

class ConnectorError extends Error {
  /**
   * @param {string} message - Error description
   * @param {object} [options]
   * @param {string} [options.action] - What was being attempted
   * @param {string} [options.selector] - Which element (if applicable)
   * @param {string} [options.phase] - 'initialize'|'authenticate'|'navigate'|'interact'|'cleanup'
   * @param {boolean} [options.recoverable=false] - Can the agent retry/skip?
   * @param {object} [options.evidence] - Evidence package captured at failure
   */
  constructor(message, { action, selector, phase, recoverable = false, evidence = null } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.action = action;
    this.selector = selector;
    this.phase = phase;
    this.recoverable = recoverable;
    this.evidence = evidence;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Serialize for logging/database storage.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      action: this.action,
      selector: this.selector,
      phase: this.phase,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      hasEvidence: this.evidence !== null
    };
  }
}

class AuthenticationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'authenticate', recoverable: false });
    this.name = 'AuthenticationError';
  }
}

class NavigationError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'navigate', recoverable: true });
    this.name = 'NavigationError';
  }
}

class ElementNotFoundError extends ConnectorError {
  constructor(selector, details = {}) {
    super(`Element not found: ${selector}`, { ...details, selector, phase: 'interact', recoverable: true });
    this.name = 'ElementNotFoundError';
  }
}

class ConnectorTimeoutError extends ConnectorError {
  constructor(message, details = {}) {
    super(message, { ...details, recoverable: true });
    this.name = 'ConnectorTimeoutError';
  }
}

module.exports = {
  ConnectorError,
  AuthenticationError,
  NavigationError,
  ElementNotFoundError,
  ConnectorTimeoutError
};
