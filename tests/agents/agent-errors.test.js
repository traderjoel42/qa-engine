'use strict';

const {
  AgentError,
  ScenarioError,
  AssertionError,
  ConfigurationError
} = require('../../agents/errors');

describe('AgentError hierarchy', () => {

  describe('AgentError', () => {
    test('has correct default properties', () => {
      const err = new AgentError('test error');
      expect(err.name).toBe('AgentError');
      expect(err.message).toBe('test error');
      expect(err.recoverable).toBe(false);
      expect(err.evidence).toBeNull();
      expect(err.cause).toBeNull();
      expect(err.agentId).toBeUndefined();
      expect(err.scenario).toBeUndefined();
      expect(err.step).toBeUndefined();
      expect(err.phase).toBeUndefined();
    });

    test('stores agentId, scenario, step, phase', () => {
      const err = new AgentError('test', {
        agentId: 'healer',
        scenario: 'login-flow',
        step: 2,
        phase: 'execute'
      });
      expect(err.agentId).toBe('healer');
      expect(err.scenario).toBe('login-flow');
      expect(err.step).toBe(2);
      expect(err.phase).toBe('execute');
    });

    test('stores evidence and cause', () => {
      const evidence = { screenshot: '/path/to/screenshot.png' };
      const cause = new Error('original');
      const err = new AgentError('wrapped', { evidence, cause });
      expect(err.evidence).toBe(evidence);
      expect(err.cause).toBe(cause);
    });

    test('recoverable defaults to false', () => {
      const err = new AgentError('test');
      expect(err.recoverable).toBe(false);
    });

    test('includes timestamp', () => {
      const before = new Date().toISOString();
      const err = new AgentError('test');
      const after = new Date().toISOString();
      expect(err.timestamp).toBeDefined();
      expect(err.timestamp >= before).toBe(true);
      expect(err.timestamp <= after).toBe(true);
    });

    test('toJSON serializes correctly', () => {
      const err = new AgentError('test error', {
        agentId: 'healer',
        scenario: 'login',
        step: 0,
        phase: 'execute',
        recoverable: true
      });
      const json = err.toJSON();
      expect(json.name).toBe('AgentError');
      expect(json.message).toBe('test error');
      expect(json.agentId).toBe('healer');
      expect(json.scenario).toBe('login');
      expect(json.step).toBe(0);
      expect(json.phase).toBe('execute');
      expect(json.recoverable).toBe(true);
      expect(json.timestamp).toBeDefined();
      expect(json.hasEvidence).toBe(false);
      expect(json.cause).toBeNull();
    });

    test('toJSON includes cause info when present', () => {
      const cause = new Error('original');
      cause.recoverable = true;
      const err = new AgentError('wrapped', { cause });
      const json = err.toJSON();
      expect(json.cause).toEqual({
        name: 'Error',
        message: 'original',
        recoverable: true
      });
    });

    test('toJSON shows hasEvidence: false when no evidence', () => {
      const err = new AgentError('test');
      expect(err.toJSON().hasEvidence).toBe(false);
    });
  });

  describe('ScenarioError', () => {
    test('extends AgentError', () => {
      const err = new ScenarioError('step failed');
      expect(err).toBeInstanceOf(AgentError);
      expect(err).toBeInstanceOf(Error);
    });

    test('name is "ScenarioError"', () => {
      const err = new ScenarioError('step failed');
      expect(err.name).toBe('ScenarioError');
    });

    test('phase defaults to "execute"', () => {
      const err = new ScenarioError('step failed');
      expect(err.phase).toBe('execute');
    });

    test('recoverable defaults to true', () => {
      const err = new ScenarioError('step failed');
      expect(err.recoverable).toBe(true);
    });

    test('allows phase override', () => {
      const err = new ScenarioError('init failed', { phase: 'initialize' });
      expect(err.phase).toBe('initialize');
    });

    test('allows recoverable override', () => {
      const err = new ScenarioError('fatal', { recoverable: false });
      expect(err.recoverable).toBe(false);
    });
  });

  describe('AssertionError', () => {
    test('extends AgentError', () => {
      const err = new AssertionError('assertion failed');
      expect(err).toBeInstanceOf(AgentError);
      expect(err).toBeInstanceOf(Error);
    });

    test('name is "AssertionError"', () => {
      const err = new AssertionError('assertion failed');
      expect(err.name).toBe('AssertionError');
    });

    test('stores expected and actual', () => {
      const err = new AssertionError('mismatch', {
        expected: 'foo',
        actual: 'bar'
      });
      expect(err.expected).toBe('foo');
      expect(err.actual).toBe('bar');
    });

    test('phase is "execute"', () => {
      const err = new AssertionError('assertion failed');
      expect(err.phase).toBe('execute');
    });

    test('recoverable is true', () => {
      const err = new AssertionError('assertion failed');
      expect(err.recoverable).toBe(true);
    });

    test('toJSON includes expected and actual', () => {
      const err = new AssertionError('mismatch', {
        expected: 'foo',
        actual: 'bar'
      });
      const json = err.toJSON();
      expect(json.expected).toBe('foo');
      expect(json.actual).toBe('bar');
      expect(json.name).toBe('AssertionError');
    });
  });

  describe('ConfigurationError', () => {
    test('extends AgentError', () => {
      const err = new ConfigurationError('bad config');
      expect(err).toBeInstanceOf(AgentError);
      expect(err).toBeInstanceOf(Error);
    });

    test('name is "ConfigurationError"', () => {
      const err = new ConfigurationError('bad config');
      expect(err.name).toBe('ConfigurationError');
    });

    test('phase is "initialize"', () => {
      const err = new ConfigurationError('bad config');
      expect(err.phase).toBe('initialize');
    });

    test('recoverable is false', () => {
      const err = new ConfigurationError('bad config');
      expect(err.recoverable).toBe(false);
    });
  });
});
