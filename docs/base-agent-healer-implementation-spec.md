# QA Engine: BaseAgent + HealerAgent Implementation Specification

**Phase:** 1, Week 2, Days 1-2  
**Purpose:** Implementation-ready spec for `agents/base-agent.js` and `agents/healer/agent.js`  
**For:** Claude Code technical evaluation → implementation  
**Dependencies:** BaseConnector (✅), EvidenceCollector (✅), GenericWebAppConnector (✅), AIAppConnector (✅), BrainstormyConnector (✅), ConnectorFactory (✅) — 383/383 tests passing  
**References:** qa-engine-01-overview-and-architecture.md, qa-engine-02-core-engine-spec.md, qa-engine-05-implementation-plan.md

---

## 1. Design Decisions

### Why BaseAgent Exists

BaseAgent mirrors the BaseConnector pattern: abstract base class with enforced contract + shared implementation. Agents define **WHAT to test**, connectors define **HOW to interact**. BaseAgent provides:

1. **Lifecycle management** — initialize/cleanup with connector lifecycle coordination
2. **Scenario execution framework** — iterate over configured scenarios, run steps, collect results
3. **Result analysis** — pass/fail classification, timing, evidence attachment
4. **Report generation** — standardized output format consumed by Test Orchestrator

### Agent ↔ Connector Relationship

```
Test Orchestrator
  ├── creates Connector via ConnectorFactory.create()
  ├── creates Agent, passes connector reference
  └── calls Agent lifecycle methods

Agent (app-agnostic)
  ├── receives connector in constructor
  ├── calls connector.performAction() exclusively
  └── never knows which app it's testing

Connector (app-specific)
  ├── translates performAction calls to DOM interactions
  └── wraps everything in evidence
```

**Critical rule:** Agents NEVER import or reference any specific connector class. They receive a connector instance and interact through `performAction()` only.

### Scenario-Driven Architecture

Agents don't hardcode test logic. They execute **scenarios** loaded from configuration:

```javascript
// apps/brainstormy/scenarios/smoke-tests.json
{
  "scenarios": [
    {
      "id": "create-project-story-session",
      "name": "Create Project → Story → Session",
      "steps": [
        { "action": "create_project", "params": { "name": "Test Project {{timestamp}}" } },
        { "action": "create_story", "params": { "name": "Test Story", "vertical": "novel" } },
        { "action": "create_session", "params": { "type": "explore" } }
      ],
      "assertions": [
        { "type": "state_exists", "key": "current_project_id" },
        { "type": "state_exists", "key": "current_story_id" },
        { "type": "state_exists", "key": "current_session_id" }
      ]
    }
  ]
}
```

This means the same HealerAgent class can run smoke tests for Brainstormy, a different AI app, or a generic web app — only the scenario files change.

### Constructor Dependencies

```javascript
constructor(config, connector)
```

| Param | Type | Source | Purpose |
|-------|------|--------|---------|
| `config` | Object | Agent config JSON (e.g., `apps/brainstormy/agents/healer.config.json`) | Scenarios, thresholds, retry settings |
| `connector` | BaseConnector subclass | Created by Test Orchestrator via ConnectorFactory | All app interactions |

**No EvidenceCollector dependency.** Agents get evidence through the connector. The connector already wraps every `performAction` call with evidence collection. Agents can request explicit evidence via `this.connector.collectEvidence(stepName)` when needed.

---

## 2. Error Hierarchy

Agents have their own error classes, separate from connector errors. Agent errors wrap connector errors when they bubble up.

```javascript
// agents/errors.js

class AgentError extends Error {
  constructor(message, { agentId, scenario, step, phase, recoverable = false, evidence = null, cause = null } = {}) {
    super(message);
    this.name = 'AgentError';
    this.agentId = agentId;
    this.scenario = scenario;       // scenario id/name
    this.step = step;               // step index or name
    this.phase = phase;             // 'initialize'|'execute'|'analyze'|'report'|'cleanup'
    this.recoverable = recoverable;
    this.evidence = evidence;
    this.cause = cause;             // original error (e.g., ConnectorError)
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
    super(message, { ...details, phase: 'execute', recoverable: true });
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
```

**4 error classes.** AgentError is the base. ScenarioError for step failures (recoverable — skip scenario, continue others). AssertionError for failed assertions with expected/actual. ConfigurationError for bad config (fatal — abort agent).

---

## 3. Complete Method Inventory

### 3.1 BaseAgent Methods

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `constructor(config, connector)` | IMPLEMENTED | `constructor(config, connector)` | Store config + connector, initialize result tracking |
| `initialize()` | HOOK | `async initialize() → void` | Agent-specific setup before test execution. Default: no-op. |
| `runTests()` | IMPLEMENTED | `async runTests() → TestRunResult` | Iterate scenarios, execute steps, collect results. Core framework. |
| `runScenario(scenario)` | IMPLEMENTED | `async runScenario(scenario) → ScenarioResult` | Execute single scenario's steps + assertions. |
| `executeStep(step, scenarioContext)` | IMPLEMENTED | `async executeStep(step, ctx) → StepResult` | Execute single action via connector, with timing and error handling. |
| `evaluateAssertions(assertions, scenarioContext)` | IMPLEMENTED | `async evaluateAssertions(assertions, ctx) → AssertionResult[]` | Run assertion checks against connector state and scenario context. |
| `evaluateAssertion(assertion, scenarioContext)` | IMPLEMENTED | `async evaluateAssertion(assertion, ctx) → AssertionResult` | Single assertion evaluation dispatch. |
| `analyzeResults(testRunResult)` | HOOK | `async analyzeResults(result) → Analysis` | Agent-specific result analysis. Default: pass/fail counts + duration. |
| `generateReport(analysis)` | HOOK | `async generateReport(analysis) → Report` | Agent-specific report. Default: structured summary. |
| `cleanup()` | HOOK | `async cleanup() → void` | Agent-specific teardown. Default: no-op. |
| `resolveParams(params, scenarioContext)` | IMPLEMENTED | `resolveParams(params, ctx) → object` | Template variable replacement (e.g., `{{timestamp}}`, `{{uuid}}`). |
| `getAgentId()` | IMPLEMENTED | `getAgentId() → string` | Returns `this.config.id` or constructor name as fallback. |
| `getScenarios()` | IMPLEMENTED | `getScenarios() → Scenario[]` | Returns scenarios from config, with validation. |

### 3.2 HealerAgent Methods (extends BaseAgent)

| Method | Type | Signature | Purpose |
|--------|------|-----------|---------|
| `initialize()` | OVERRIDE | `async initialize() → void` | Verify connector health before running smoke tests. |
| `analyzeResults(testRunResult)` | OVERRIDE | `async analyzeResults(result) → HealerAnalysis` | Classify failures as regressions vs. known issues, compute health score. |
| `generateReport(analysis)` | OVERRIDE | `async generateReport(analysis) → HealerReport` | Add regression detection summary and health score. |

HealerAgent is intentionally thin — only 3 overrides. The smoke test execution logic lives entirely in BaseAgent's `runTests()` → `runScenario()` → `executeStep()` chain. HealerAgent adds:
- Pre-flight health check
- Regression detection (compare current failures against known issues list)
- Health score computation (passed/total ratio)

---

## 4. Data Structures

### 4.1 Scenario (from config JSON)

```javascript
{
  id: 'create-project-story-session',       // unique within agent
  name: 'Create Project → Story → Session', // human-readable
  tags: ['smoke', 'critical'],              // for filtering
  timeout: 60000,                           // optional per-scenario timeout (ms)
  steps: [
    {
      action: 'create_project',             // maps to connector.performAction()
      params: { name: 'Test Project {{timestamp}}' },
      description: 'Create a new project',  // optional, for reports
      captureEvidence: true                 // optional, default false — explicit mid-scenario evidence
    }
  ],
  assertions: [
    {
      type: 'state_exists',                 // assertion type
      key: 'current_project_id',            // assertion-specific params
      message: 'Project ID should be set after creation'  // optional failure message
    }
  ]
}
```

### 4.2 Assertion Types

BaseAgent supports these assertion types out of the box:

| Type | Params | Behavior |
|------|--------|----------|
| `state_exists` | `{ key }` | `connector.getState(key) !== undefined` |
| `state_equals` | `{ key, value }` | `connector.getState(key) === value` |
| `state_contains` | `{ key, value }` | `String(connector.getState(key)).toLowerCase().includes(value.toLowerCase())` |
| `state_truthy` | `{ key }` | `!!connector.getState(key)` |
| `url_contains` | `{ value }` | `(await connector.getCurrentURL()).includes(value)` |
| `url_matches` | `{ pattern }` | `new RegExp(pattern).test(await connector.getCurrentURL())` |
| `element_exists` | `{ selector }` | `await connector.exists(selector)` |
| `element_text_contains` | `{ selector, value }` | `(await connector.extractData(selector)).includes(value)` |
| `response_contains` | `{ value }` | Last step result text includes value (case-insensitive) |
| `step_succeeded` | `{ stepIndex }` | Step at given index didn't fail |

**Extensibility:** HealerAgent (and future agents) can add custom assertion types by overriding `evaluateAssertion()` with a switch + `super.evaluateAssertion()` fallback.

### 4.3 StepResult

```javascript
{
  stepIndex: 0,
  action: 'create_project',
  params: { name: 'Test Project 1707600000000' },  // resolved params
  status: 'passed',         // 'passed' | 'failed' | 'skipped'
  result: { ... },          // connector performAction return value
  error: null,              // AgentError/ConnectorError if failed
  evidence: null,           // evidence package if captureEvidence was true or on failure
  durationMs: 1234,
  timestamp: '2026-02-12T10:00:00.000Z'
}
```

### 4.4 AssertionResult

```javascript
{
  type: 'state_exists',
  passed: true,
  message: 'Project ID should be set after creation',  // from assertion config or auto-generated
  expected: 'state key "current_project_id" exists',
  actual: 'proj_abc123',
  durationMs: 2
}
```

### 4.5 ScenarioResult

```javascript
{
  scenarioId: 'create-project-story-session',
  scenarioName: 'Create Project → Story → Session',
  status: 'passed',         // 'passed' | 'failed' | 'error'
  steps: [ StepResult, ... ],
  assertions: [ AssertionResult, ... ],
  failedSteps: [],          // subset of steps where status === 'failed'
  failedAssertions: [],     // subset of assertions where passed === false
  evidence: { ... },        // final evidence snapshot after scenario completes
  durationMs: 5678,
  timestamp: '2026-02-12T10:00:00.000Z'
}
```

Status logic:
- `'passed'` — all steps passed AND all assertions passed
- `'failed'` — at least one assertion failed (steps may have all passed but assertions caught an issue)
- `'error'` — a step threw a non-recoverable error or the scenario timed out

### 4.6 TestRunResult

```javascript
{
  agentId: 'healer',
  scenarios: [ ScenarioResult, ... ],
  summary: {
    total: 5,
    passed: 4,
    failed: 1,
    errors: 0,
    skipped: 0
  },
  durationMs: 30000,
  startedAt: '2026-02-12T10:00:00.000Z',
  completedAt: '2026-02-12T10:00:30.000Z'
}
```

### 4.7 HealerAnalysis (extends base analysis)

```javascript
{
  // Base analysis fields
  summary: { total, passed, failed, errors, skipped },
  durationMs: 30000,

  // Healer-specific
  healthScore: 0.80,        // passed / total
  regressions: [            // failures NOT in knownIssues list
    {
      scenarioId: 'send-message-get-response',
      failedAssertions: [...],
      isRegression: true
    }
  ],
  knownFailures: [          // failures that ARE in knownIssues list
    {
      scenarioId: 'bible-generation',
      knownIssueId: 'KNOWN-001',
      isRegression: false
    }
  ],
  hasRegressions: true,     // any new failures detected
  passRate: 0.80
}
```

### 4.8 Report

```javascript
{
  agentId: 'healer',
  agentType: 'HealerAgent',
  timestamp: '2026-02-12T10:00:30.000Z',
  summary: { total, passed, failed, errors, skipped },
  analysis: { ... },        // HealerAnalysis or base analysis
  scenarios: [ ScenarioResult, ... ],
  metadata: {
    appId: 'brainstormy',
    environment: 'staging',
    connectorType: 'brainstormy',
    durationMs: 30000
  }
}
```

---

## 5. BaseAgent Implementation

```javascript
// agents/base-agent.js

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
    const steps = [];
    const scenarioContext = {
      scenarioId: scenario.id,
      stepResults: [],       // references same array as steps — for assertions to inspect
      lastStepResult: null
    };

    // Execute steps sequentially
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepResult = await this.executeStep(step, i, scenarioContext);
      steps.push(stepResult);
      scenarioContext.stepResults.push(stepResult);
      scenarioContext.lastStepResult = stepResult;

      // If step failed and it's not recoverable, stop scenario
      if (stepResult.status === 'failed' && stepResult.error && !stepResult.error.recoverable) {
        break;
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
    if (steps.some(s => s.status === 'failed' && s.error && !s.error.recoverable)) {
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
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
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
          const exists = await this.connector.exists(assertion.selector);
          expected = `element "${assertion.selector}" exists`;
          actual = exists ? 'found' : 'not found';
          passed = exists;
          break;
        }

        case 'element_text_contains': {
          let text;
          try {
            text = await this.connector.extractData(assertion.selector);
          } catch (_) {
            text = null;
          }
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
```

---

## 6. HealerAgent Implementation

```javascript
// agents/healer/agent.js

'use strict';

const BaseAgent = require('../base-agent');
const { ScenarioError } = require('../errors');

/**
 * Healer Agent — Smoke tests and regression detection.
 *
 * Runs configured smoke test scenarios against the app, then:
 * 1. Computes a health score (passed / total)
 * 2. Classifies failures as regressions (new) or known issues (expected)
 * 3. Reports regressions separately for priority triage
 *
 * Configuration:
 * - scenarios: Array of smoke test scenario definitions
 * - knownIssues: Array of { scenarioId, issueId, description } for expected failures
 * - healthThreshold: Minimum health score to consider the app "healthy" (default: 0.9)
 *
 * @extends BaseAgent
 */
class HealerAgent extends BaseAgent {
  /**
   * Verify connector health before running smoke tests.
   * If the connector can't even health-check, there's no point running tests.
   */
  async initialize() {
    const health = await this.connector.healthCheck();
    if (!health.healthy) {
      throw new ScenarioError(
        `Connector health check failed: ${JSON.stringify(health.details)}`,
        { agentId: this.getAgentId(), phase: 'initialize' }
      );
    }
  }

  /**
   * Analyze results with regression detection.
   *
   * Compares failed scenarios against the knownIssues list in config.
   * Failures NOT in knownIssues are classified as regressions.
   *
   * @param {TestRunResult} testRunResult
   * @returns {Promise<HealerAnalysis>}
   */
  async analyzeResults(testRunResult) {
    const baseAnalysis = await super.analyzeResults(testRunResult);
    const knownIssues = this.config.knownIssues || [];
    const knownScenarioIds = new Set(knownIssues.map(ki => ki.scenarioId));

    const failedScenarios = testRunResult.scenarios.filter(
      s => s.status === 'failed' || s.status === 'error'
    );

    const regressions = [];
    const knownFailures = [];

    for (const scenario of failedScenarios) {
      if (knownScenarioIds.has(scenario.scenarioId)) {
        const knownIssue = knownIssues.find(ki => ki.scenarioId === scenario.scenarioId);
        knownFailures.push({
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName,
          knownIssueId: knownIssue.issueId,
          description: knownIssue.description,
          isRegression: false
        });
      } else {
        regressions.push({
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName,
          failedSteps: scenario.failedSteps,
          failedAssertions: scenario.failedAssertions,
          evidence: scenario.evidence,
          isRegression: true
        });
      }
    }

    const healthScore = testRunResult.summary.total > 0
      ? testRunResult.summary.passed / testRunResult.summary.total
      : 0;

    const healthThreshold = this.config.healthThreshold ?? 0.9;

    return {
      ...baseAnalysis,
      healthScore,
      healthThreshold,
      isHealthy: healthScore >= healthThreshold,
      regressions,
      knownFailures,
      hasRegressions: regressions.length > 0,
      regressionCount: regressions.length,
      knownFailureCount: knownFailures.length
    };
  }

  /**
   * Generate report with regression summary.
   *
   * @param {HealerAnalysis} analysis
   * @returns {Promise<HealerReport>}
   */
  async generateReport(analysis) {
    const baseReport = await super.generateReport(analysis);

    return {
      ...baseReport,
      healerSummary: {
        healthScore: analysis.healthScore,
        healthThreshold: analysis.healthThreshold,
        isHealthy: analysis.isHealthy,
        regressionCount: analysis.regressionCount,
        knownFailureCount: analysis.knownFailureCount,
        regressions: analysis.regressions.map(r => ({
          scenarioId: r.scenarioId,
          scenarioName: r.scenarioName,
          failedAssertionCount: r.failedAssertions?.length || 0,
          failedStepCount: r.failedSteps?.length || 0
        })),
        knownFailures: analysis.knownFailures.map(kf => ({
          scenarioId: kf.scenarioId,
          knownIssueId: kf.knownIssueId,
          description: kf.description
        }))
      }
    };
  }
}

module.exports = HealerAgent;
```

---

## 7. Agent Error Classes File

```javascript
// agents/errors.js

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
```

---

## 8. Unit Test Specification

### 8.1 Agent Error Tests

```javascript
// tests/agents/agent-errors.test.js

describe('AgentError hierarchy', () => {
  describe('AgentError', () => {
    test('has correct default properties');
    test('stores agentId, scenario, step, phase');
    test('stores evidence and cause');
    test('recoverable defaults to false');
    test('includes timestamp');
    test('toJSON serializes correctly');
    test('toJSON includes cause info when present');
    test('toJSON shows hasEvidence: false when no evidence');
  });

  describe('ScenarioError', () => {
    test('extends AgentError');
    test('name is "ScenarioError"');
    test('phase defaults to "execute"');
    test('recoverable defaults to true');
    test('allows phase override');
    test('allows recoverable override');
  });

  describe('AssertionError', () => {
    test('extends AgentError');
    test('name is "AssertionError"');
    test('stores expected and actual');
    test('phase is "execute"');
    test('recoverable is true');
    test('toJSON includes expected and actual');
  });

  describe('ConfigurationError', () => {
    test('extends AgentError');
    test('name is "ConfigurationError"');
    test('phase is "initialize"');
    test('recoverable is false');
  });
});
```

### 8.2 BaseAgent Tests

```javascript
// tests/agents/base-agent.test.js

describe('BaseAgent', () => {

  describe('Constructor', () => {
    test('stores config and connector references');
    test('throws ConfigurationError when config is null');
    test('throws ConfigurationError when connector is null');
    test('initializes empty _results array');
    test('_startedAt and _completedAt start as null');
  });

  describe('getAgentId', () => {
    test('returns config.id when set');
    test('returns constructor name when config.id is not set');
  });

  describe('getScenarios', () => {
    test('returns scenarios from config');
    test('throws ConfigurationError when scenarios is undefined');
    test('throws ConfigurationError when scenarios is empty array');
    test('throws ConfigurationError when scenarios is not an array');
    test('filters by tagFilter when configured');
    test('returns all scenarios when tagFilter matches nothing');
  });

  describe('resolveParams', () => {
    test('replaces {{timestamp}} with numeric string');
    test('replaces {{uuid}} with random string');
    test('replaces {{scenarioId}} with scenario id from context');
    test('replaces {{stepIndex}} with current step count');
    test('passes non-string values through unchanged');
    test('handles multiple replacements in one string');
    test('handles params with no templates — returns as-is');
    test('returns empty object for empty params');
  });

  describe('executeStep', () => {
    test('calls connector.performAction with resolved params');
    test('returns StepResult with status "passed" on success');
    test('returns StepResult with status "failed" when connector throws');
    test('wraps non-AgentError into ScenarioError');
    test('preserves AgentError as-is when connector throws one');
    test('captures evidence on failure');
    test('captures evidence when step.captureEvidence is true');
    test('does not capture evidence on success unless captureEvidence is true');
    test('records durationMs');
    test('includes resolved params in result');
    test('includes step description in result');
    test('evidence capture failure does not throw');
  });

  describe('evaluateAssertion', () => {
    // state_exists
    test('state_exists passes when key is set');
    test('state_exists fails when key is not set');

    // state_equals
    test('state_equals passes on exact match');
    test('state_equals fails on mismatch');

    // state_contains
    test('state_contains passes when value includes substring (case-insensitive)');
    test('state_contains fails when value does not include substring');
    test('state_contains fails when key is not set');

    // state_truthy
    test('state_truthy passes for truthy value');
    test('state_truthy fails for falsy value');
    test('state_truthy fails for undefined key');

    // url_contains
    test('url_contains passes when URL includes value');
    test('url_contains fails when URL does not include value');

    // url_matches
    test('url_matches passes when URL matches regex pattern');
    test('url_matches fails when URL does not match');

    // element_exists
    test('element_exists passes when connector.exists returns true');
    test('element_exists fails when connector.exists returns false');

    // element_text_contains
    test('element_text_contains passes when text includes value');
    test('element_text_contains fails when text does not include value');
    test('element_text_contains fails when extractData throws');

    // response_contains
    test('response_contains passes when last step result text includes value');
    test('response_contains fails when text does not include value');
    test('response_contains handles missing lastStepResult gracefully');

    // step_succeeded
    test('step_succeeded passes when step status is "passed"');
    test('step_succeeded fails when step status is "failed"');
    test('step_succeeded fails when stepIndex is out of bounds');

    // unknown type
    test('unknown assertion type fails with descriptive message');

    // error handling
    test('assertion evaluation error results in failed assertion, not thrown error');

    // result structure
    test('returns correct AssertionResult shape with type, passed, message, expected, actual, durationMs');
    test('uses assertion.message when provided');
  });

  describe('evaluateAssertions', () => {
    test('evaluates all assertions and returns array of results');
    test('returns empty array for empty assertions');
  });

  describe('runScenario', () => {
    test('executes all steps in order');
    test('evaluates assertions after steps');
    test('returns status "passed" when all steps and assertions pass');
    test('returns status "failed" when an assertion fails');
    test('returns status "failed" when a step fails but error is recoverable');
    test('returns status "error" when a step fails with non-recoverable error');
    test('stops execution at non-recoverable step failure');
    test('continues past recoverable step failures');
    test('collects end-of-scenario evidence');
    test('evidence collection failure does not crash scenario');
    test('records durationMs');
    test('populates failedSteps and failedAssertions arrays');
  });

  describe('runTests', () => {
    test('runs all scenarios from config');
    test('returns TestRunResult with summary');
    test('records startedAt and completedAt');
    test('computes durationMs');
    test('summary counts passed/failed/errors correctly');
    test('scenario crash produces error result, does not stop other scenarios');
    test('throws ConfigurationError for missing scenarios');
  });

  describe('analyzeResults', () => {
    test('returns base analysis with summary and passRate');
    test('passRate is 0 when no scenarios');
    test('passRate is 1.0 when all pass');
    test('passRate is 0.5 when half pass');
  });

  describe('generateReport', () => {
    test('returns report with agentId and agentType');
    test('includes metadata with appId and environment');
    test('includes analysis and scenarios');
  });

  describe('initialize and cleanup hooks', () => {
    test('initialize is no-op by default');
    test('cleanup is no-op by default');
  });

  describe('_computeSummary', () => {
    test('counts passed/failed/errors/skipped correctly');
    test('handles empty results array');
  });
});
```

### 8.3 HealerAgent Tests

```javascript
// tests/agents/healer-agent.test.js

describe('HealerAgent', () => {

  describe('extends BaseAgent', () => {
    test('is an instance of BaseAgent');
    test('constructor stores config and connector');
  });

  describe('initialize', () => {
    test('calls connector.healthCheck()');
    test('succeeds when connector is healthy');
    test('throws ScenarioError when connector is not healthy');
    test('includes health details in error message');
  });

  describe('analyzeResults', () => {
    test('computes healthScore as passed/total');
    test('healthScore is 0 when no scenarios');
    test('healthScore is 1.0 when all pass');
    test('classifies failures not in knownIssues as regressions');
    test('classifies failures in knownIssues as knownFailures');
    test('hasRegressions is true when regressions exist');
    test('hasRegressions is false when all failures are known');
    test('includes knownIssueId and description in knownFailures');
    test('includes failedSteps and failedAssertions in regressions');
    test('uses default healthThreshold of 0.9');
    test('uses config.healthThreshold when provided');
    test('isHealthy is true when healthScore >= threshold');
    test('isHealthy is false when healthScore < threshold');
    test('handles empty knownIssues list');
    test('handles scenario with status "error" as failure');
  });

  describe('generateReport', () => {
    test('includes healerSummary in report');
    test('healerSummary contains healthScore and isHealthy');
    test('healerSummary lists regressions with counts');
    test('healerSummary lists knownFailures with issueId');
    test('preserves base report fields');
  });

  describe('end-to-end scenario execution', () => {
    test('runs smoke test scenarios through full lifecycle');
    test('detects regression when new scenario fails');
    test('ignores known issue when known scenario fails');
    test('reports healthy when all scenarios pass');
    test('reports unhealthy when health score drops below threshold');
  });
});
```

---

## 9. Test Mock Helpers

### 9.1 Mock Connector for Agent Tests

Agents need a mock connector that responds to `performAction()` calls. This is simpler than the Playwright mocks used for connector tests:

```javascript
// tests/helpers/mock-connector.js

function createMockConnector(options = {}) {
  const state = new Map();
  const actionResults = options.actionResults || {};
  const actionErrors = options.actionErrors || {};

  return {
    // Core interface used by agents
    performAction: jest.fn(async (action, params) => {
      if (actionErrors[action]) {
        throw actionErrors[action];
      }
      const result = actionResults[action];
      return typeof result === 'function' ? result(params) : (result || { success: true });
    }),

    // State management (used by assertions)
    getState: jest.fn((key) => state.get(key)),
    setState: jest.fn((key, value) => state.set(key, value)),
    hasState: jest.fn((key) => state.has(key)),
    clearState: jest.fn(() => state.clear()),

    // Evidence collection
    collectEvidence: jest.fn(async (stepName) => ({
      stepName,
      timestamp: new Date().toISOString(),
      screenshot: `/evidence/${stepName}.png`,
      consoleLogs: [],
      networkRequests: []
    })),

    // URL
    getCurrentURL: jest.fn(async () => options.currentURL || 'https://staging.app.com/dashboard'),

    // Data extraction (used by element assertions)
    exists: jest.fn(async (selector) => {
      const existing = options.existingElements || [];
      return existing.includes(selector);
    }),
    extractData: jest.fn(async (selector) => {
      const data = options.elementData || {};
      if (data[selector] === undefined) {
        const { ElementNotFoundError } = require('../../connectors/errors');
        throw new ElementNotFoundError(selector);
      }
      return data[selector];
    }),

    // Health check
    healthCheck: jest.fn(async () => ({
      healthy: options.healthy !== undefined ? options.healthy : true,
      details: { initialized: true, cleanedUp: false, stateSize: 0 }
    })),

    // App config access
    app: options.app || {
      id: 'test-app',
      activeEnvironment: 'staging'
    },

    // For direct state manipulation in tests
    _state: state
  };
}

function createAgentConfig(overrides = {}) {
  return {
    id: 'test-agent',
    scenarios: [
      {
        id: 'basic-smoke',
        name: 'Basic Smoke Test',
        steps: [
          { action: 'navigate', params: { path: '/dashboard' } },
          { action: 'click', params: { selector: '#main-button' } }
        ],
        assertions: [
          { type: 'state_exists', key: 'authenticated' }
        ]
      }
    ],
    ...overrides
  };
}

function createHealerConfig(overrides = {}) {
  return {
    id: 'healer',
    healthThreshold: 0.9,
    knownIssues: [],
    scenarios: [
      {
        id: 'login-flow',
        name: 'Login Flow',
        tags: ['smoke', 'critical'],
        steps: [
          { action: 'navigate', params: { path: '/login' } },
          { action: 'authenticate', params: {} }
        ],
        assertions: [
          { type: 'state_truthy', key: 'authenticated' }
        ]
      },
      {
        id: 'create-project',
        name: 'Create Project',
        tags: ['smoke'],
        steps: [
          { action: 'create_project', params: { name: 'Test Project {{timestamp}}' } }
        ],
        assertions: [
          { type: 'state_exists', key: 'current_project_id' }
        ]
      }
    ],
    ...overrides
  };
}

module.exports = {
  createMockConnector,
  createAgentConfig,
  createHealerConfig
};
```

### 9.2 Using the Mock Connector

Agent tests set up behavior by configuring the mock:

```javascript
// Example test setup
const connector = createMockConnector({
  // Define what performAction returns for each action
  actionResults: {
    navigate: { success: true },
    authenticate: (params) => {
      connector._state.set('authenticated', true);
      return { success: true };
    },
    create_project: (params) => {
      connector._state.set('current_project_id', 'proj_123');
      return { success: true, id: 'proj_123' };
    }
  },
  // Or define errors for specific actions
  actionErrors: {
    create_session: new ConnectorError('Element not found', { recoverable: true })
  },
  // For element assertions
  existingElements: ['#dashboard', '#user-menu'],
  elementData: { '#welcome': 'Welcome, Joel' },
  currentURL: 'https://staging.brainstormy.app/dashboard'
});
```

**Key design:** The mock connector's `performAction` can mutate `_state` to simulate what a real connector would do (e.g., set `current_project_id` after `create_project`). This allows assertions that check connector state to work naturally.

---

## 10. Files to Create

| Order | File | Purpose | Estimated Lines |
|-------|------|---------|-----------------|
| 1 | `tests/helpers/mock-connector.js` | Mock connector + agent config helpers | ~100 |
| 2 | `agents/errors.js` | Agent error class hierarchy | ~90 |
| 3 | `agents/base-agent.js` | Abstract base agent with scenario framework | ~350 |
| 4 | `agents/healer/agent.js` | Healer agent (smoke tests + regression detection) | ~130 |
| 5 | `tests/agents/agent-errors.test.js` | Error class tests | ~100 |
| 6 | `tests/agents/base-agent.test.js` | BaseAgent tests | ~700 |
| 7 | `tests/agents/healer-agent.test.js` | HealerAgent tests | ~400 |
| 8 | `docs/base-agent-healer-implementation-log.md` | Implementation log | ~40 |

**Estimated totals:** ~1,910 lines across 8 files, ~100-120 tests.

---

## 11. Implementation Steps (for Claude Code)

### Step 1: Create mock connector helpers

Create `tests/helpers/mock-connector.js` with:
- `createMockConnector(options)` — configurable mock connector
- `createAgentConfig(overrides)` — basic agent config factory
- `createHealerConfig(overrides)` — healer-specific config factory

Verify: file exists and exports all three functions.

### Step 2: Create agent error classes

Create `agents/errors.js` with 4 error classes matching Section 7 exactly:
- `AgentError` — base with toJSON
- `ScenarioError` — phase defaults to 'execute', recoverable defaults to true
- `AssertionError` — adds expected/actual, toJSON includes them
- `ConfigurationError` — phase 'initialize', recoverable false

### Step 3: Create BaseAgent

Create `agents/base-agent.js` matching Section 5 implementation:
- Constructor with config + connector validation
- `runTests()` → `runScenario()` → `executeStep()` chain
- `evaluateAssertions()` → `evaluateAssertion()` with 10 assertion types
- `analyzeResults()` and `generateReport()` hook methods
- `resolveParams()` template variable replacement
- `getScenarios()` with validation and tag filtering
- All utility methods

### Step 4: Create HealerAgent

Create `agents/healer/agent.js` matching Section 6:
- Extends BaseAgent
- `initialize()` — connector health check
- `analyzeResults()` — regression detection via knownIssues
- `generateReport()` — healerSummary with health score

### Step 5: Create all test files

Create test files matching Section 8:
- `tests/agents/agent-errors.test.js` — error hierarchy tests
- `tests/agents/base-agent.test.js` — comprehensive BaseAgent tests
- `tests/agents/healer-agent.test.js` — HealerAgent with regression detection

### Step 6: Validate and log

Run `npm test` — all tests must pass (383 existing + new agent tests).
Create `docs/base-agent-healer-implementation-log.md` with test counts per suite.

---

## 12. Claude Code Implementation Notes

1. **Agents NEVER import connector classes.** The mock connector in tests simulates the interface without importing real connectors. Agent files only `require('../errors')` and `require('../base-agent')`.

2. **The scenario execution framework is the key deliverable.** `runTests` → `runScenario` → `executeStep` is the core loop. Everything else builds on it.

3. **Assertions evaluate against connector state, not return values.** The connector is the source of truth. When `performAction('create_project', ...)` runs, the connector sets state internally. Assertions check that state.

4. **The `response_contains` assertion checks `lastStepResult.result`.** This means the previous step's return value from `performAction()`. For AI chat responses, this would be `{ text: '...', html: '...' }` from `waitForAIResponse`.

5. **HealerAgent's regression detection is config-driven.** The `knownIssues` array maps scenario IDs to known failure IDs. New failures (not in the list) are regressions. This is a simple set-membership check, not LLM-powered analysis (that's Bug Detector's job in Week 3).

6. **Evidence flow:** Agents don't create evidence — connectors do. Agents request evidence via `connector.collectEvidence()` at scenario boundaries and on failures. The connector's `performAction` already wraps every action with evidence internally.

7. **Template variables in `resolveParams()`** — `{{timestamp}}` and `{{uuid}}` make test data unique per run. This prevents collision when running tests repeatedly against the same app instance.

8. **`_computeSummary` is private.** The leading underscore signals it's internal to BaseAgent. No subclass should need to override it.

---

## 13. What Comes Next

After BaseAgent + HealerAgent are built and tested:

- **Day 3:** SentinelAgent — Memory persistence validation. Extends BaseAgent with multi-session scenarios, fact establishment, and recall testing.
- **Day 4:** LibrarianAgent — Citation accuracy and Bible verification. Extends BaseAgent with content validation scenarios.
- **Day 5:** Test Orchestrator — Coordinates agents, manages lifecycle, aggregates results.
