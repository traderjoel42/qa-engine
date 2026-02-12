'use strict';

class AgentError extends Error {
  /**
   * @param {string} message
   * @param {object} [options]
   * @param {string} [options.agentId] - Which agent
   * @param {string} [options.scenario] - Which scenario
   * @param {string|number} [options.step] - Which step
   * @param {string} [options.phase] - 'initialize'|'execute'|'analyze'|'report'|'cleanup'
   * @param {boolean} [options.recoverable=false]
   * @param {object} [options.evidence]
   * @param {Error} [options.cause] - Original error
   */
  constructor(message, { agentId, scenario, step, phase, recoverable = false, evidence = null, cause = null } = {}) {
    super(message);
    this.name = 'AgentError';
    this.agentId = agentId;
    this.scenario = scenario;
    this.step = step;
    this.phase = phase;
    this.recoverable = recoverable;
    this.evidence = evidence;
    this.cause = cause;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      agentId: this.agentId,
      scenario: this.scenario,
      step: this.step,
      phase: this.phase,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      hasEvidence: this.evidence !== null,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        recoverable: this.cause.recoverable
      } : null
    };
  }
}

class ScenarioError extends AgentError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: details.phase || 'execute', recoverable: details.recoverable !== undefined ? details.recoverable : true });
    this.name = 'ScenarioError';
  }
}

class AssertionError extends AgentError {
  constructor(message, { expected, actual, ...details } = {}) {
    super(message, { ...details, phase: 'execute', recoverable: true });
    this.name = 'AssertionError';
    this.expected = expected;
    this.actual = actual;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      expected: this.expected,
      actual: this.actual
    };
  }
}

class ConfigurationError extends AgentError {
  constructor(message, details = {}) {
    super(message, { ...details, phase: 'initialize', recoverable: false });
    this.name = 'ConfigurationError';
  }
}

module.exports = {
  AgentError,
  ScenarioError,
  AssertionError,
  ConfigurationError
};
