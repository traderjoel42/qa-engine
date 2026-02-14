'use strict';

const { AgentError, ScenarioError, AssertionError, ConfigurationError } = require('./errors');

/**
 * Abstract base class for all QA Engine test agents.
 *
 * Provides the scenario execution framework. Subclasses customize behavior
 * by overriding hook methods (initialize, analyzeResults, generateReport, cleanup).
 *
 * Agents interact with apps EXCLUSIVELY through the connector's performAction() method.
 * They never import or reference specific connector classes.
 *
 * @abstract (soft — can be instantiated for testing, but not useful without scenarios)
 */
class BaseAgent {
  /**
   * @param {object} config - Agent configuration (scenarios, thresholds, known issues)
   * @param {import('../connectors/base-connector')} connector - App connector instance
   */
  constructor(config, connector) {
    if (!config) {
      throw new ConfigurationError('Agent config is required');
    }
    if (!connector) {
      throw new ConfigurationError('Connector is required');
    }

    this.config = config;
    this.connector = connector;
    this._results = [];           // accumulates ScenarioResults
    this._startedAt = null;
    this._completedAt = null;
  }

  // ===================================================================
  // LIFECYCLE HOOKS — Override in subclasses as needed
  // ===================================================================

  /**
   * Agent-specific initialization before test execution begins.
   * Called by Test Orchestrator after connector is initialized.
   * Default: no-op.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    // Hook — subclasses override as needed
  }

  /**
   * Agent-specific cleanup after test execution completes.
   * Called by Test Orchestrator after results are collected.
   * Default: no-op.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Hook — subclasses override as needed
  }

  // ===================================================================
  // CORE EXECUTION — Implemented (inherit as-is unless rare override)
  // ===================================================================

  /**
   * Execute all scenarios and return aggregated results.
   * This is the main entry point called by Test Orchestrator.
   *
   * Flow:
   * 1. Load scenarios from config
   * 2. For each scenario: runScenario()
   * 3. Aggregate results into TestRunResult
   *
   * Never throws — scenario failures are captured as results, not exceptions.
   * Only throws for truly fatal configuration errors.
   *
   * @returns {Promise<TestRunResult>}
   */
  async runTests() {
    this._startedAt = new Date().toISOString();
    this._results = [];

    const scenarios = this.getScenarios();

    for (const scenario of scenarios) {
      let scenarioResult;
      try {
        scenarioResult = await this.runScenario(scenario);
      } catch (error) {
        // Scenario-level crash — record as error result
        scenarioResult = {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          status: 'error',
          steps: [],
          assertions: [],
          failedSteps: [],
          failedAssertions: [],
          evidence: null,
          error: error instanceof AgentError ? error : new ScenarioError(
            `Scenario crashed: ${error.message}`,
            { agentId: this.getAgentId(), scenario: scenario.id, cause: error }
          ),
          durationMs: 0,
          timestamp: new Date().toISOString()
        };
      }
      this._results.push(scenarioResult);
    }

    this._completedAt = new Date().toISOString();

    const summary = this._computeSummary(this._results);

    return {
      agentId: this.getAgentId(),
      scenarios: this._results,
      summary,
      durationMs: new Date(this._completedAt) - new Date(this._startedAt),
      startedAt: this._startedAt,
      completedAt: this._completedAt
    };
  }

  /**
   * Execute a single scenario: run all steps, then evaluate assertions.
   *
   * @param {object} scenario - Scenario object from config
   * @returns {Promise<ScenarioResult>}
   */
  async runScenario(scenario) {
    const startTime = Date.now();
    const scenarioTimeout = scenario.timeout || this.config.scenarioTimeout || 120000;
    const steps = [];
    const scenarioContext = {
      scenarioId: scenario.id,
      stepResults: [],       // references same array as steps — for assertions to inspect
      lastStepResult: null
    };

    // Wrap execution in a timeout
    const executionPromise = this._executeScenarioSteps(scenario, steps, scenarioContext);

    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new ScenarioError(
          `Scenario timed out after ${scenarioTimeout}ms`,
          { agentId: this.getAgentId(), scenario: scenario.id, recoverable: false }
        ));
      }, scenarioTimeout);
      // Store timer so we can clear it
      executionPromise.finally(() => clearTimeout(timer));
    });

    try {
      await Promise.race([executionPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) {
        // Mark remaining unexecuted steps as skipped
        for (let i = steps.length; i < scenario.steps.length; i++) {
          steps.push({
            stepIndex: i,
            action: scenario.steps[i].action,
            params: scenario.steps[i].params || {},
            description: scenario.steps[i].description || null,
            status: 'skipped',
            result: null,
            error: null,
            evidence: null,
            durationMs: 0,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        throw error; // Re-throw non-timeout errors
      }
    }

    // Evaluate assertions (even if some steps failed — assertions may test partial state)
    const assertions = await this.evaluateAssertions(scenario.assertions || [], scenarioContext);

    // Collect final evidence snapshot
    let evidence = null;
    try {
      evidence = await this.connector.collectEvidence(`scenario_end_${scenario.id}`);
    } catch (_) {
      // Evidence collection failure is non-fatal
    }

    const failedSteps = steps.filter(s => s.status === 'failed');
    const failedAssertions = assertions.filter(a => !a.passed);

    // Determine overall status
    let status;
    if (timedOut || steps.some(s => s.status === 'failed' && s.error && !s.error.recoverable)) {
      status = 'error';
    } else if (failedAssertions.length > 0 || failedSteps.length > 0) {
      status = 'failed';
    } else {
      status = 'passed';
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status,
      steps,
      assertions,
      failedSteps,
      failedAssertions,
      evidence,
      error: null,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Internal: execute scenario steps sequentially.
   * Extracted to enable timeout wrapping in runScenario.
   *
   * @private
   * @param {object} scenario
   * @param {Array} steps - Mutated in place (pushed to)
   * @param {object} scenarioContext - Mutated in place
   * @returns {Promise<void>}
   */
  async _executeScenarioSteps(scenario, steps, scenarioContext) {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepResult = await this.executeStep(step, i, scenarioContext);
      steps.push(stepResult);
      scenarioContext.stepResults.push(stepResult);
      scenarioContext.lastStepResult = stepResult;

      // If step failed and it's not recoverable, mark remaining as skipped and stop
      if (stepResult.status === 'failed' && stepResult.error && !stepResult.error.recoverable) {
        for (let j = i + 1; j < scenario.steps.length; j++) {
          const skippedResult = {
            stepIndex: j,
            action: scenario.steps[j].action,
            params: scenario.steps[j].params || {},
            description: scenario.steps[j].description || null,
            status: 'skipped',
            result: null,
            error: null,
            evidence: null,
            durationMs: 0,
            timestamp: new Date().toISOString()
          };
          steps.push(skippedResult);
          scenarioContext.stepResults.push(skippedResult);
        }
        break;
      }
    }
  }

  /**
   * Execute a single step via the connector.
   *
   * @param {object} step - Step definition { action, params, description, captureEvidence }
   * @param {number} stepIndex - Position in the scenario
   * @param {object} scenarioContext - Shared context for the scenario run
   * @returns {Promise<StepResult>}
   */
  async executeStep(step, stepIndex, scenarioContext) {
    const startTime = Date.now();
    const resolvedParams = this.resolveParams(step.params || {}, scenarioContext);

    let result = null;
    let error = null;
    let evidence = null;
    let status = 'passed';

    try {
      result = await this.connector.performAction(step.action, resolvedParams);
    } catch (err) {
      status = 'failed';
      error = err instanceof AgentError ? err : new ScenarioError(
        `Step failed: ${step.action} — ${err.message}`,
        {
          agentId: this.getAgentId(),
          scenario: scenarioContext.scenarioId,
          step: stepIndex,
          cause: err,
          recoverable: err.recoverable !== undefined ? err.recoverable : true
        }
      );
    }

    // Capture evidence if requested or on failure
    if (step.captureEvidence || status === 'failed') {
      try {
        evidence = await this.connector.collectEvidence(
          `step_${stepIndex}_${step.action}_${status}`
        );
        if (error) {
          error.evidence = evidence;
        }
      } catch (_) {
        // Evidence capture failure is non-fatal
      }
    }

    return {
      stepIndex,
      action: step.action,
      params: resolvedParams,
      description: step.description || null,
      status,
      result,
      error,
      evidence,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // ASSERTION EVALUATION
  // ===================================================================

  /**
   * Evaluate all assertions for a scenario.
   *
   * @param {Array} assertions - Assertion definitions from scenario config
   * @param {object} scenarioContext - Shared context with step results
   * @returns {Promise<AssertionResult[]>}
   */
  async evaluateAssertions(assertions, scenarioContext) {
    const results = [];
    for (const assertion of assertions) {
      const result = await this.evaluateAssertion(assertion, scenarioContext);
      results.push(result);
    }
    return results;
  }

  /**
   * Evaluate a single assertion.
   * Subclasses can override to add custom assertion types,
   * calling super.evaluateAssertion() for unrecognized types.
   *
   * @param {object} assertion - { type, ...params, message }
   * @param {object} scenarioContext
   * @returns {Promise<AssertionResult>}
   */
  async evaluateAssertion(assertion, scenarioContext) {
    const startTime = Date.now();
    let passed = false;
    let expected = '';
    let actual = '';

    try {
      switch (assertion.type) {
        case 'state_exists': {
          const value = this.connector.getState(assertion.key);
          expected = `state key "${assertion.key}" exists`;
          actual = value !== undefined ? String(value) : 'undefined';
          passed = value !== undefined;
          break;
        }

        case 'state_equals': {
          const value = this.connector.getState(assertion.key);
          expected = `state "${assertion.key}" === ${JSON.stringify(assertion.value)}`;
          actual = JSON.stringify(value);
          passed = value === assertion.value;
          break;
        }

        case 'state_contains': {
          const value = this.connector.getState(assertion.key);
          expected = `state "${assertion.key}" contains "${assertion.value}"`;
          actual = value !== undefined ? String(value) : 'undefined';
          passed = value !== undefined &&
            String(value).toLowerCase().includes(String(assertion.value).toLowerCase());
          break;
        }

        case 'state_truthy': {
          const value = this.connector.getState(assertion.key);
          expected = `state "${assertion.key}" is truthy`;
          actual = JSON.stringify(value);
          passed = !!value;
          break;
        }

        case 'url_contains': {
          const url = await this.connector.getCurrentURL();
          expected = `URL contains "${assertion.value}"`;
          actual = url;
          passed = url.includes(assertion.value);
          break;
        }

        case 'url_matches': {
          const url = await this.connector.getCurrentURL();
          expected = `URL matches /${assertion.pattern}/`;
          actual = url;
          passed = new RegExp(assertion.pattern).test(url);
          break;
        }

        case 'element_exists': {
          const resolved = this.connector.getSelector?.(assertion.selector) || assertion.selector;
          const exists = await this.connector.exists(resolved);
          expected = `element "${assertion.selector}" exists`;
          actual = exists ? 'found' : 'not found';
          passed = exists;
          break;
        }

        case 'element_text_contains': {
          const resolved = this.connector.getSelector?.(assertion.selector) || assertion.selector;
          let text;
          try {
            text = await this.connector.extractData(resolved);
          } catch (_) {
            text = null;
          }
          // extractData returns {text, value, html, attributes} — extract the .text property
          text = text?.text ?? null;
          expected = `element "${assertion.selector}" text contains "${assertion.value}"`;
          actual = text !== null ? String(text) : 'element not found';
          passed = text !== null && String(text).includes(assertion.value);
          break;
        }

        case 'response_contains': {
          const lastResult = scenarioContext.lastStepResult?.result;
          const responseText = lastResult?.text || lastResult?.response || '';
          expected = `response contains "${assertion.value}"`;
          actual = responseText.substring(0, 200); // truncate for readability
          passed = responseText.toLowerCase().includes(assertion.value.toLowerCase());
          break;
        }

        case 'step_succeeded': {
          const stepResult = scenarioContext.stepResults[assertion.stepIndex];
          expected = `step ${assertion.stepIndex} succeeded`;
          actual = stepResult ? stepResult.status : 'step not found';
          passed = stepResult?.status === 'passed';
          break;
        }

        default:
          expected = `assertion type "${assertion.type}" recognized`;
          actual = 'unknown assertion type';
          passed = false;
      }
    } catch (error) {
      expected = `assertion "${assertion.type}" evaluates without error`;
      actual = `error: ${error.message}`;
      passed = false;
    }

    return {
      type: assertion.type,
      passed,
      message: assertion.message || `${expected}`,
      expected,
      actual,
      durationMs: Date.now() - startTime
    };
  }

  // ===================================================================
  // ANALYSIS & REPORTING HOOKS
  // ===================================================================

  /**
   * Analyze test results. Override for agent-specific analysis.
   * Default: pass/fail summary with timing.
   *
   * @param {TestRunResult} testRunResult
   * @returns {Promise<object>} Analysis object
   */
  async analyzeResults(testRunResult) {
    return {
      summary: testRunResult.summary,
      durationMs: testRunResult.durationMs,
      passRate: testRunResult.summary.total > 0
        ? testRunResult.summary.passed / testRunResult.summary.total
        : 0
    };
  }

  /**
   * Generate a report. Override for agent-specific reports.
   * Default: structured summary with all results.
   *
   * @param {object} analysis - Output from analyzeResults
   * @returns {Promise<object>} Report object
   */
  async generateReport(analysis) {
    return {
      agentId: this.getAgentId(),
      agentType: this.constructor.name,
      timestamp: new Date().toISOString(),
      summary: analysis.summary,
      analysis,
      scenarios: this._results,
      metadata: {
        appId: this.connector.app?.id || 'unknown',
        environment: this.connector.app?.activeEnvironment || 'unknown',
        connectorType: this.connector.constructor.name,
        durationMs: analysis.durationMs
      }
    };
  }

  // ===================================================================
  // UTILITY METHODS
  // ===================================================================

  /**
   * Get the agent's identifier.
   * @returns {string}
   */
  getAgentId() {
    return this.config.id || this.constructor.name;
  }

  /**
   * Get scenarios from config with validation.
   * @returns {Array<object>}
   * @throws {ConfigurationError} If no scenarios found
   */
  getScenarios() {
    const scenarios = this.config.scenarios;
    if (!scenarios || !Array.isArray(scenarios) || scenarios.length === 0) {
      throw new ConfigurationError(
        'No scenarios configured',
        { agentId: this.getAgentId() }
      );
    }

    // Filter by tags if config specifies a tag filter
    if (this.config.tagFilter && Array.isArray(this.config.tagFilter)) {
      const filtered = scenarios.filter(s =>
        s.tags && s.tags.some(tag => this.config.tagFilter.includes(tag))
      );
      if (filtered.length > 0) return filtered;
      // If filter matches nothing, run all scenarios (don't silently skip everything)
    }

    return scenarios;
  }

  /**
   * Resolve template variables in step params.
   * Supported variables:
   * - {{timestamp}} → Date.now()
   * - {{uuid}} → simple random id
   * - {{scenarioId}} → current scenario id
   * - {{stepIndex}} → current step index (from context)
   *
   * @param {object} params - Raw params from scenario config
   * @param {object} scenarioContext
   * @returns {object} Resolved params
   */
  resolveParams(params, scenarioContext) {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = value
          .replace(/\{\{timestamp\}\}/g, String(Date.now()))
          .replace(/\{\{uuid\}\}/g, this._generateSimpleId())
          .replace(/\{\{scenarioId\}\}/g, scenarioContext.scenarioId || '')
          .replace(/\{\{stepIndex\}\}/g, String(scenarioContext.stepResults?.length || 0));
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  /**
   * Compute pass/fail/error/skip summary from scenario results.
   * @private
   */
  _computeSummary(results) {
    return {
      total: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      errors: results.filter(r => r.status === 'error').length,
      skipped: results.filter(r => r.status === 'skipped').length
    };
  }

  /**
   * Generate a simple random ID for template variables.
   * Not cryptographically secure — just unique enough for test data.
   * @private
   */
  _generateSimpleId() {
    return Math.random().toString(36).substring(2, 10);
  }
}

module.exports = BaseAgent;
