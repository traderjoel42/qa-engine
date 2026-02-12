# QA Engine: SentinelAgent Implementation Specification

**Phase:** 1, Week 2, Day 3  
**Version:** 2.0 (revised after feasibility review)  
**Purpose:** Implementation-ready spec for `agents/sentinel/agent.js`  
**For:** Claude Code technical evaluation → implementation  
**Dependencies:** BaseAgent (✅), HealerAgent (✅), error hierarchy (✅), mock-connector (✅) — 539/539 tests passing  
**References:** qa-engine-01-overview-and-architecture.md, qa-engine-02-core-engine-spec.md, qa-engine-03-connector-pattern-spec.md, qa-engine-05-implementation-plan.md, brainstormy-testing-framework-spec.md, base-agent-healer-implementation-spec.md

---

## Revision History

**v2.0** — Corrected 7 critical interface mismatches identified by Claude Code feasibility review:

| # | Issue | Resolution |
|---|-------|------------|
| 1 | `evaluateAssertion` signature: spec had 4 params (sync), BaseAgent has 2 params (async) | Rewrote to `async evaluateAssertion(assertion, scenarioContext)`. Step results accessed via `scenarioContext.stepResults[assertion.stepIndex]`. |
| 2 | Assertion return shape: spec used `{details}`, BaseAgent uses `{expected, actual, durationMs}` | All custom assertions now return `{type, passed, message, expected, actual, durationMs}`. |
| 3 | Per-step assertions: spec assumed step-level assertions, BaseAgent only supports scenario-level | All assertions moved to `scenario.assertions` array. Each references steps by `stepIndex`. |
| 4 | StepResult missing fields: spec expected `stepId` (string), `phase`, `assertions` | All lookups now use numeric `stepIndex`. Phase comes from scenario config, not StepResult. |
| 5 | `analyzeResults()` signature: spec had no params, BaseAgent requires `testRunResult` | Corrected to `async analyzeResults(testRunResult)`. |
| 6 | `scenarioContext` missing fields: spec expected `._stepResults`, `._currentStepAssertionResults`, `._scenario` | Removed all underscore-prefixed fields. Uses only `scenarioContext.stepResults`, `.lastStepResult`, `.scenarioId`. |
| 7 | Report field naming: spec used `scenarioResults`, BaseAgent uses `scenarios` | Corrected all references to `scenarios`. |

Additional fixes: `config.id` (not `agentId`), `getScenarios()` for tag filtering, `step_succeeded` requires `stepIndex`, `recall_accuracy` moved from assertion to `analyzeResults()` computation.

---

## 1. Design Decisions

### Why SentinelAgent Exists

SentinelAgent validates Brainstormy's core value proposition: **memory persistence across sessions**. While HealerAgent verifies that basic features work (smoke tests), SentinelAgent proves that facts established in session 1 survive through session 20+. This is the competitive differentiator — ChatGPT and Claude lose context between conversations; Brainstormy doesn't.

SentinelAgent doesn't hardcode any Brainstormy-specific logic. It orchestrates **multi-phase memory scenarios** through the same `performAction()` connector interface. The connector handles app-specific DOM interactions; the agent handles test strategy.

### Multi-Phase Scenario Architecture

Memory testing requires a fundamentally different execution pattern than smoke tests. HealerAgent scenarios are linear: step 1 → step 2 → step 3 → assert. SentinelAgent scenarios have **three distinct phases** that must execute in order:

```
Phase 1: ESTABLISH — Create facts in the app's memory
  → Send messages containing specific facts
  → Facts are tagged with IDs for later verification

Phase 2: DISTANCE — Create temporal/session distance
  → Create intervening sessions with unrelated content
  → Simulates real-world usage between fact establishment and recall
  → Configurable: 0 sessions (immediate recall) to 20+ sessions

Phase 3: RECALL — Query for established facts and score accuracy
  → Send recall queries designed to surface specific facts
  → Scenario-level assertions validate responses contain expected facts
  → Score recall accuracy against threshold
  → Detect contradictions with established facts
```

This three-phase pattern is encoded in scenario JSON config. BaseAgent's `runScenario()` → `executeStep()` pipeline handles all phases — SentinelAgent adds **phase-aware analysis** on top.

### Phases Are Metadata, Not Agent Logic

The `phase` field on scenario steps is a **data annotation** that SentinelAgent reads during analysis — not a control flow mechanism. BaseAgent ignores it completely (it's just an extra field on the step config object). SentinelAgent reads it in `_computePhaseMetrics()` to group results by phase.

This means:
- Same SentinelAgent class works for 3-fact quick tests and 50-fact stress tests
- Phase boundaries are configurable per scenario
- New phase types (e.g., `modify` for testing fact updates) can be added without agent code changes
- BaseAgent requires zero modifications

### Scenario-Level Assertions with Step References

**BaseAgent architecture:** Assertions live on `scenario.assertions` (array) and are evaluated after all steps complete, via `evaluateAssertions(scenario.assertions, scenarioContext)`. Per-step assertions do not exist.

SentinelAgent's custom assertion types include a `stepIndex` field that identifies which step's result to check. During evaluation, the assertion accesses `scenarioContext.stepResults[assertion.stepIndex]` to get the target step's result. This works cleanly with BaseAgent's existing interface — no modifications needed.

```
Scenario config:
  steps[0]:  create_session (setup)
  steps[1]:  send_message — "Marcus is a detective" (establish, fact declared here)
  steps[2]:  wait_for_response (establish)
  ...
  steps[14]: send_message — "Who is the protagonist?" (recall)
  steps[15]: wait_for_response (recall — response to check)
  
  assertions:
    { type: "recall_contains", stepIndex: 15, factId: "fact-marcus", keywords: ["Marcus", "detective"] }
    { type: "no_contradiction", stepIndex: 15, factId: "fact-marcus", contradictions: ["teacher"] }
```

### Custom Assertion Types

SentinelAgent extends BaseAgent's 10 assertion types with **3 memory-specific types**:

| Type | Purpose | Key Params |
|------|---------|------------|
| `recall_contains` | Response at `stepIndex` mentions an established fact | `stepIndex`, `factId`, `keywords` (array) |
| `no_contradiction` | Response at `stepIndex` doesn't contradict an established fact | `stepIndex`, `factId`, `contradictions` (array) |
| `fact_present` | `validate_memory` result at `stepIndex` contains expected fact | `stepIndex`, `factId`, `expected` (string) |

These are evaluated in `evaluateAssertion(assertion, scenarioContext)` via switch + `super.evaluateAssertion()` fallback — same pattern as HealerAgent.

**`recall_accuracy` is NOT an assertion type.** Aggregate recall rate is computed in `analyzeResults()` after all assertions are evaluated. This is cleaner because `evaluateAssertion` has no access to other assertion results — only `scenarioContext.stepResults`.

### Recall Scoring Algorithm

Recall scoring is deterministic and config-driven, not LLM-powered (LLM analysis is Bug Detector's job in Week 3). Computed in `analyzeResults()`:

```
For each fact in fact registry:
  1. Find assertions targeting this factId in the scenario's assertion results
  2. Check no_contradiction assertions first — any failure → 'contradicted'
  3. Check recall_contains / fact_present assertions — any failure → 'forgotten'
  4. All passed → 'recalled'

recallRate = factsRecalled / (factsRecalled + factsForgotten + factsContradicted)
passed = recallRate >= scenario.recallThreshold (default: 0.85)
         AND contradictionRate <= scenario.contradictionThreshold (default: 0.0)
```

### Contradiction Detection Strategy

Contradictions are more severe than forgotten facts. A forgotten fact means the system lost context; a contradiction means the system actively generated incorrect information. SentinelAgent tracks these separately:

- **Forgotten:** Recall assertions fail (keywords missing from response)
- **Contradicted:** `no_contradiction` assertion fails (contradiction strings found in response)
- **Recalled:** All assertions for this fact pass

Contradiction rate is always expected to be 0% — any contradiction is a critical failure.

### Fact Registry

Each scenario maintains a **fact registry** — a mapping from `factId` to fact metadata. This is built from `establish` phase steps during `initialize()` and used during `analyzeResults()`:

```javascript
// Built from scenario config during initialize()
factRegistry = Map {
  'fact-marcus-detective' => {
    factId: 'fact-marcus-detective',
    establishedAtStepIndex: 1,
    keywords: ['Marcus', 'detective'],
    contradictions: ['teacher', 'lawyer', 'doctor'],
    category: 'character'
  },
  'fact-setting-noir' => {
    factId: 'fact-setting-noir',
    establishedAtStepIndex: 3,
    keywords: ['noir', '1940s', 'Los Angeles'],
    contradictions: ['modern', 'future', 'fantasy'],
    category: 'setting'
  }
}
```

Facts are extracted from steps that include a `fact` field in their config. This is passive — the agent doesn't parse message content, it reads the scenario author's declared facts.

---

## 2. Data Structures

### SentinelConfig

```javascript
// Config shape (validated in initialize, schema is documentation only)
{
  id: 'sentinel',                  // used by getAgentId()
  description: 'Memory persistence validation',
  recallThreshold: 0.85,           // global default
  contradictionThreshold: 0.0,     // global default
  scenarios: [
    {
      id: 'memory-basic-3-facts',
      name: 'Basic 3-Fact Memory Test',
      description: '...',
      timeout: 300000,
      recallThreshold: 0.85,       // per-scenario override (optional)
      contradictionThreshold: 0.0, // per-scenario override (optional)
      steps: [ /* MemoryStep[] */ ],
      assertions: [ /* Assertion[] */ ]
    }
  ]
}
```

### MemoryStep (step config — extra fields ignored by BaseAgent)

```javascript
{
  // BaseAgent uses these:
  action: 'send_message',
  params: { text: 'The protagonist is Marcus, a detective.' },
  description: 'Establish fact: Marcus is a detective',
  captureEvidence: false,

  // SentinelAgent reads these (BaseAgent ignores):
  phase: 'establish',              // 'setup' | 'establish' | 'distance' | 'recall'
  fact: {                          // only on establish-phase steps
    factId: 'fact-marcus-detective',
    keywords: ['Marcus', 'detective'],
    contradictions: ['teacher', 'lawyer', 'doctor'],
    category: 'character'
  }
}
```

### Assertion Config (scenario-level)

```javascript
// recall_contains
{
  type: 'recall_contains',
  stepIndex: 15,                   // which step's result to check
  factId: 'fact-marcus-detective', // links to fact registry
  keywords: ['Marcus', 'detective']
}

// no_contradiction
{
  type: 'no_contradiction',
  stepIndex: 15,
  factId: 'fact-marcus-detective',
  contradictions: ['teacher', 'lawyer', 'doctor']
}

// fact_present (for validate_memory action results)
{
  type: 'fact_present',
  stepIndex: 16,                   // step that ran validate_memory
  factId: 'fact-marcus-detective',
  expected: 'Marcus'               // expected substring in memory result
}
```

### FactEntry (internal — built during initialize)

```javascript
{
  factId: 'fact-marcus-detective',
  keywords: ['Marcus', 'detective'],
  contradictions: ['teacher', 'lawyer', 'doctor'],
  category: 'character',
  establishedAtStepIndex: 1,       // numeric index of establish step
  recallResult: null               // set during analyzeResults: 'recalled' | 'forgotten' | 'contradicted' | 'untested'
}
```

### AssertionResult (returned by evaluateAssertion — matches BaseAgent shape exactly)

```javascript
{
  type: 'recall_contains',
  passed: true,
  message: 'All 2 keywords found for fact \'fact-marcus-detective\'',
  expected: 'response at step 15 contains keywords: Marcus, detective',
  actual: 'marcus is indeed the detective protagonist we established...',
  durationMs: 2
}
```

### Enriched Scenario Result (from analyzeResults)

```javascript
{
  // --- from testRunResult.scenarios[i] ---
  scenarioId: 'memory-basic-3-facts',
  status: 'passed',
  steps: [ /* StepResult[] */ ],
  assertions: [ /* AssertionResult[] */ ],
  duration: 45000,
  error: null,

  // --- added by SentinelAgent.analyzeResults ---
  memory: {
    facts: { total: 3, recalled: 2, forgotten: 1, contradicted: 0, untested: 0 },
    recallRate: 0.667,
    contradictionRate: 0.0,
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    passed: false,
    factDetails: [
      { factId: 'fact-marcus-detective', category: 'character', result: 'recalled', establishedAtStepIndex: 1 },
      { factId: 'fact-setting-noir', category: 'setting', result: 'forgotten', establishedAtStepIndex: 3 },
      { factId: 'fact-villain-revenge', category: 'plot', result: 'recalled', establishedAtStepIndex: 5 }
    ],
    byCategory: {
      character: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1.0 },
      setting: { total: 1, recalled: 0, forgotten: 1, contradicted: 0, rate: 0.0 },
      plot: { total: 1, recalled: 1, forgotten: 0, contradicted: 0, rate: 1.0 }
    }
  },
  phases: {
    setup: { steps: 3, passed: 3, failed: 0, skipped: 0 },
    establish: { steps: 6, passed: 6, failed: 0, skipped: 0 },
    distance: { steps: 6, passed: 6, failed: 0, skipped: 0 },
    recall: { steps: 6, passed: 5, failed: 1, skipped: 0 }
  }
}
```

### MemoryReport (from generateReport)

```javascript
{
  // --- from super.generateReport(analysis) ---
  agentId: 'sentinel',
  timestamp: '2026-02-12T10:00:00.000Z',
  durationMs: 120000,
  scenarios: [ /* enriched scenario results */ ],

  // --- added by SentinelAgent ---
  memoryHealth: {
    overallRecallRate: 0.917,
    overallContradictionRate: 0.0,
    factsTested: 12,
    factsRecalled: 11,
    factsForgotten: 1,
    factsContradicted: 0,
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    passed: true,
    weakCategories: ['setting'],
    strongCategories: ['character', 'plot']
  }
}
```

---

## 3. Method Inventory

### SentinelAgent (extends BaseAgent)

| Method | Override? | Signature | Purpose |
|--------|-----------|-----------|---------|
| `constructor(config, connector)` | No | `constructor(config, connector)` | Uses BaseAgent constructor. |
| `initialize()` | **Yes** | `async initialize()` | Builds fact registries from scenario configs. Validates each scenario with facts has assertions referencing those factIds. |
| `runTests()` | No | Inherited | Iterates scenarios, calls runScenario(). |
| `runScenario(scenario)` | No | Inherited | Executes steps, evaluates scenario.assertions. |
| `executeStep(step, scenarioContext)` | No | Inherited | Calls performAction, captures result. |
| `evaluateAssertion(assertion, scenarioContext)` | **Yes** | `async evaluateAssertion(assertion, scenarioContext)` | Switch on 3 custom types + super fallback. |
| `analyzeResults(testRunResult)` | **Yes** | `async analyzeResults(testRunResult)` | Calls super, enriches each scenario with memory metrics and phase metrics. |
| `generateReport(analysis)` | **Yes** | `async generateReport(analysis)` | Calls super, adds `memoryHealth` aggregate. |
| `cleanup()` | No | Inherited | |
| `_buildFactRegistries()` | New (private) | `_buildFactRegistries() → Map` | Scans all scenarios from `getScenarios()`, builds factRegistry per scenario. |
| `_buildFactRegistryForScenario(scenario)` | New (private) | `_buildFactRegistryForScenario(scenario) → Map` | Extracts FactEntry objects from steps with `fact` field. |
| `_classifyFactResult(factEntry, mergedResults)` | New (private) | `_classifyFactResult(factEntry, mergedResults) → string` | Checks assertion results targeting this factId. Returns 'recalled' / 'forgotten' / 'contradicted' / 'untested'. |
| `_computeRecallMetrics(factRegistry, assertionResults, scenario)` | New (private) | Returns the `memory` block. |
| `_computePhaseMetrics(scenario, stepResults)` | New (private) | Groups steps by phase, counts pass/fail/skip per phase. |
| `_computeMemoryHealth(enrichedScenarios)` | New (private) | Aggregates across all scenarios for `memoryHealth`. |
| `_getRecallThreshold(scenario)` | New (private) | `scenario.recallThreshold ?? this.config.recallThreshold ?? 0.85` |
| `_getContradictionThreshold(scenario)` | New (private) | `scenario.contradictionThreshold ?? this.config.contradictionThreshold ?? 0.0` |
| `_extractResponseText(stepResult)` | New (private) | Extracts lowercase text from a StepResult's result field. |
| `_findScenarioConfig(scenarioId)` | New (private) | Finds scenario in getScenarios() by id. |

---

## 4. Assertion Evaluation

### Method Signature (matches BaseAgent exactly)

```javascript
async evaluateAssertion(assertion, scenarioContext) {
  // assertion: { type, stepIndex, factId, keywords|contradictions|expected, message }
  // scenarioContext: { scenarioId, stepResults, lastStepResult }
  // Returns: { type, passed, message, expected, actual, durationMs }
}
```

### Custom Assertion: `recall_contains`

```javascript
case 'recall_contains': {
  const startTime = Date.now();
  const { stepIndex, factId, keywords } = assertion;

  if (stepIndex === undefined || !factId || !keywords || !Array.isArray(keywords)) {
    return {
      type: 'recall_contains',
      passed: false,
      message: 'recall_contains requires stepIndex, factId, and keywords array',
      expected: 'valid recall_contains assertion config',
      actual: `stepIndex=${stepIndex}, factId=${factId}, keywords=${JSON.stringify(keywords)}`,
      durationMs: Date.now() - startTime
    };
  }

  const stepResult = scenarioContext.stepResults[stepIndex];
  const responseText = this._extractResponseText(stepResult);
  const missingKeywords = keywords.filter(kw => !responseText.includes(kw.toLowerCase()));

  return {
    type: 'recall_contains',
    passed: missingKeywords.length === 0,
    message: missingKeywords.length === 0
      ? `All ${keywords.length} keywords found for fact '${factId}'`
      : `Missing keywords for fact '${factId}': ${missingKeywords.join(', ')}`,
    expected: `response at step ${stepIndex} contains keywords: ${keywords.join(', ')}`,
    actual: responseText.substring(0, 200),
    durationMs: Date.now() - startTime
  };
}
```

### Custom Assertion: `no_contradiction`

```javascript
case 'no_contradiction': {
  const startTime = Date.now();
  const { stepIndex, factId, contradictions } = assertion;

  if (stepIndex === undefined || !factId || !contradictions || !Array.isArray(contradictions)) {
    return {
      type: 'no_contradiction',
      passed: false,
      message: 'no_contradiction requires stepIndex, factId, and contradictions array',
      expected: 'valid no_contradiction assertion config',
      actual: `stepIndex=${stepIndex}, factId=${factId}, contradictions=${JSON.stringify(contradictions)}`,
      durationMs: Date.now() - startTime
    };
  }

  const stepResult = scenarioContext.stepResults[stepIndex];
  const responseText = this._extractResponseText(stepResult);
  const foundContradictions = contradictions.filter(c => responseText.includes(c.toLowerCase()));

  return {
    type: 'no_contradiction',
    passed: foundContradictions.length === 0,
    message: foundContradictions.length === 0
      ? `No contradictions detected for fact '${factId}'`
      : `CONTRADICTION for fact '${factId}': found [${foundContradictions.join(', ')}]`,
    expected: `response at step ${stepIndex} contains none of: ${contradictions.join(', ')}`,
    actual: foundContradictions.length === 0
      ? 'no contradictions found'
      : `found: ${foundContradictions.join(', ')}`,
    durationMs: Date.now() - startTime
  };
}
```

### Custom Assertion: `fact_present`

```javascript
case 'fact_present': {
  const startTime = Date.now();
  const { stepIndex, factId, expected } = assertion;

  if (stepIndex === undefined || !factId || !expected) {
    return {
      type: 'fact_present',
      passed: false,
      message: 'fact_present requires stepIndex, factId, and expected string',
      expected: 'valid fact_present assertion config',
      actual: `stepIndex=${stepIndex}, factId=${factId}, expected=${expected}`,
      durationMs: Date.now() - startTime
    };
  }

  // validate_memory returns { found: boolean, text: string, confidence: number }
  const stepResult = scenarioContext.stepResults[stepIndex];
  const memResult = stepResult?.result;
  const found = memResult?.found === true;
  const textMatches = found &&
    (memResult?.text || '').toLowerCase().includes(expected.toLowerCase());

  return {
    type: 'fact_present',
    passed: found && textMatches,
    message: found && textMatches
      ? `Fact '${factId}' present in memory with expected content`
      : found
        ? `Fact '${factId}' found but missing expected content: '${expected}'`
        : `Fact '${factId}' not found in memory`,
    expected: `validate_memory at step ${stepIndex} found=true, text contains '${expected}'`,
    actual: found
      ? `found=true, text='${(memResult?.text || '').substring(0, 200)}'`
      : 'found=false',
    durationMs: Date.now() - startTime
  };
}
```

---

## 5. Full Implementation: `agents/sentinel/agent.js`

```javascript
'use strict';

const BaseAgent = require('../base-agent');
const { ConfigurationError } = require('../errors');

/**
 * SentinelAgent — Memory persistence validation.
 *
 * Tests that facts established in early sessions persist across
 * intervening sessions and can be accurately recalled later.
 *
 * Multi-phase scenarios:
 *   establish → distance → recall
 *
 * Custom assertion types (3):
 *   recall_contains, no_contradiction, fact_present
 *
 * Recall accuracy is computed in analyzeResults(), not as an assertion.
 *
 * Extends BaseAgent — never overrides runTests() or runScenario().
 */
class SentinelAgent extends BaseAgent {

  // =========================================================
  // Lifecycle
  // =========================================================

  /**
   * Initialize agent: build fact registries from scenario configs.
   * BaseAgent.initialize() is a no-op, but we call it for forward
   * compatibility in case it gains logic later.
   */
  async initialize() {
    await super.initialize();
    this._factRegistries = this._buildFactRegistries();
  }

  // =========================================================
  // Assertion Evaluation (override)
  // =========================================================

  /**
   * Evaluate SentinelAgent-specific assertion types.
   * Falls back to BaseAgent for standard 10 types.
   *
   * Signature matches BaseAgent exactly: async, 2 params.
   * Returns: { type, passed, message, expected, actual, durationMs }
   *
   * @param {object} assertion - { type, stepIndex, factId, ...params }
   * @param {object} scenarioContext - { scenarioId, stepResults, lastStepResult }
   * @returns {Promise<AssertionResult>}
   */
  async evaluateAssertion(assertion, scenarioContext) {
    switch (assertion.type) {

      // -------------------------------------------------------
      // recall_contains: keywords present in a step's response
      // -------------------------------------------------------
      case 'recall_contains': {
        const startTime = Date.now();
        const { stepIndex, factId, keywords } = assertion;

        if (stepIndex === undefined || !factId || !keywords || !Array.isArray(keywords)) {
          return {
            type: 'recall_contains',
            passed: false,
            message: 'recall_contains requires stepIndex, factId, and keywords array',
            expected: 'valid recall_contains assertion config',
            actual: `stepIndex=${stepIndex}, factId=${factId}, keywords=${JSON.stringify(keywords)}`,
            durationMs: Date.now() - startTime
          };
        }

        const stepResult = scenarioContext.stepResults[stepIndex];
        const responseText = this._extractResponseText(stepResult);
        const missingKeywords = keywords.filter(kw => !responseText.includes(kw.toLowerCase()));

        return {
          type: 'recall_contains',
          passed: missingKeywords.length === 0,
          message: missingKeywords.length === 0
            ? `All ${keywords.length} keywords found for fact '${factId}'`
            : `Missing keywords for fact '${factId}': ${missingKeywords.join(', ')}`,
          expected: `response at step ${stepIndex} contains keywords: ${keywords.join(', ')}`,
          actual: responseText.substring(0, 200),
          durationMs: Date.now() - startTime
        };
      }

      // -------------------------------------------------------
      // no_contradiction: contradiction strings absent from response
      // -------------------------------------------------------
      case 'no_contradiction': {
        const startTime = Date.now();
        const { stepIndex, factId, contradictions } = assertion;

        if (stepIndex === undefined || !factId || !contradictions || !Array.isArray(contradictions)) {
          return {
            type: 'no_contradiction',
            passed: false,
            message: 'no_contradiction requires stepIndex, factId, and contradictions array',
            expected: 'valid no_contradiction assertion config',
            actual: `stepIndex=${stepIndex}, factId=${factId}, contradictions=${JSON.stringify(contradictions)}`,
            durationMs: Date.now() - startTime
          };
        }

        const stepResult = scenarioContext.stepResults[stepIndex];
        const responseText = this._extractResponseText(stepResult);
        const foundContradictions = contradictions.filter(
          c => responseText.includes(c.toLowerCase())
        );

        return {
          type: 'no_contradiction',
          passed: foundContradictions.length === 0,
          message: foundContradictions.length === 0
            ? `No contradictions detected for fact '${factId}'`
            : `CONTRADICTION for fact '${factId}': found [${foundContradictions.join(', ')}]`,
          expected: `response at step ${stepIndex} contains none of: ${contradictions.join(', ')}`,
          actual: foundContradictions.length === 0
            ? 'no contradictions found'
            : `found: ${foundContradictions.join(', ')}`,
          durationMs: Date.now() - startTime
        };
      }

      // -------------------------------------------------------
      // fact_present: validate_memory result contains expected fact
      // -------------------------------------------------------
      case 'fact_present': {
        const startTime = Date.now();
        const { stepIndex, factId, expected } = assertion;

        if (stepIndex === undefined || !factId || !expected) {
          return {
            type: 'fact_present',
            passed: false,
            message: 'fact_present requires stepIndex, factId, and expected string',
            expected: 'valid fact_present assertion config',
            actual: `stepIndex=${stepIndex}, factId=${factId}, expected=${expected}`,
            durationMs: Date.now() - startTime
          };
        }

        const stepResult = scenarioContext.stepResults[stepIndex];
        const memResult = stepResult?.result;
        const found = memResult?.found === true;
        const textMatches = found &&
          (memResult?.text || '').toLowerCase().includes(expected.toLowerCase());

        return {
          type: 'fact_present',
          passed: found && textMatches,
          message: found && textMatches
            ? `Fact '${factId}' present in memory with expected content`
            : found
              ? `Fact '${factId}' found but missing expected content: '${expected}'`
              : `Fact '${factId}' not found in memory`,
          expected: `validate_memory at step ${stepIndex} found=true, text contains '${expected}'`,
          actual: found
            ? `found=true, text='${(memResult?.text || '').substring(0, 200)}'`
            : 'found=false',
          durationMs: Date.now() - startTime
        };
      }

      // -------------------------------------------------------
      // Fallback to BaseAgent's 10 built-in types
      // -------------------------------------------------------
      default:
        return super.evaluateAssertion(assertion, scenarioContext);
    }
  }

  // =========================================================
  // Analysis (override)
  // =========================================================

  /**
   * Enrich scenario results with memory-specific metrics.
   *
   * @param {TestRunResult} testRunResult - from runTests()
   * @returns {Promise<object>} Enriched analysis
   */
  async analyzeResults(testRunResult) {
    const baseAnalysis = await super.analyzeResults(testRunResult);

    // Get scenario results from testRunResult (not from baseAnalysis)
    const scenarioResults = testRunResult.scenarios || [];

    // Enrich each scenario with memory metrics
    const enrichedScenarios = scenarioResults.map(scenarioResult => {
      const scenario = this._findScenarioConfig(scenarioResult.scenarioId);
      if (!scenario) return scenarioResult;

      const factRegistry = this._factRegistries.get(scenario.id);
      if (!factRegistry || factRegistry.size === 0) return scenarioResult;

      const memory = this._computeRecallMetrics(
        factRegistry,
        scenarioResult.assertions || [],
        scenario
      );

      const phases = this._computePhaseMetrics(
        scenario,
        scenarioResult.steps || []
      );

      // Override status if memory thresholds not met
      const effectiveStatus = memory.passed ? scenarioResult.status : 'failed';

      return {
        ...scenarioResult,
        status: effectiveStatus,
        memory,
        phases
      };
    });

    return {
      ...baseAnalysis,
      scenarios: enrichedScenarios
    };
  }

  // =========================================================
  // Report Generation (override)
  // =========================================================

  /**
   * Generate memory health report aggregating all scenarios.
   *
   * @param {object} analysis - from analyzeResults()
   * @returns {Promise<object>} Report with memoryHealth
   */
  async generateReport(analysis) {
    const baseReport = await super.generateReport(analysis);

    const memoryHealth = this._computeMemoryHealth(
      analysis?.scenarios || []
    );

    return {
      ...baseReport,
      memoryHealth
    };
  }

  // =========================================================
  // Private: Fact Registry Building
  // =========================================================

  /**
   * Build fact registries for all scenarios.
   * Uses getScenarios() to respect tag filtering.
   *
   * @returns {Map<string, Map<string, FactEntry>>} scenarioId → factRegistry
   */
  _buildFactRegistries() {
    const registries = new Map();
    const scenarios = this.getScenarios();

    for (const scenario of scenarios) {
      const registry = this._buildFactRegistryForScenario(scenario);
      registries.set(scenario.id, registry);
    }

    return registries;
  }

  /**
   * Build fact registry for a single scenario.
   * Extracts facts from steps with `fact` field.
   * Validates that if facts exist, scenario has assertions referencing them.
   *
   * @param {object} scenario
   * @returns {Map<string, FactEntry>}
   * @throws {ConfigurationError} if facts exist but no assertions reference them
   */
  _buildFactRegistryForScenario(scenario) {
    const registry = new Map();
    const steps = scenario.steps || [];

    // Extract facts from steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.fact) {
        registry.set(step.fact.factId, {
          factId: step.fact.factId,
          keywords: step.fact.keywords || [],
          contradictions: step.fact.contradictions || [],
          category: step.fact.category || 'uncategorized',
          establishedAtStepIndex: i,
          recallResult: null
        });
      }
    }

    // Validate: if facts exist, at least one assertion should reference a factId
    if (registry.size > 0) {
      const assertions = scenario.assertions || [];
      const memoryAssertionTypes = ['recall_contains', 'no_contradiction', 'fact_present'];
      const hasMemoryAssertions = assertions.some(
        a => memoryAssertionTypes.includes(a.type)
      );
      if (!hasMemoryAssertions) {
        throw new ConfigurationError(
          `Scenario '${scenario.id}' has ${registry.size} facts but no memory assertions (recall_contains, no_contradiction, or fact_present)`,
          { scenarioId: scenario.id, factCount: registry.size }
        );
      }
    }

    return registry;
  }

  // =========================================================
  // Private: Fact Classification
  // =========================================================

  /**
   * Classify a single fact as recalled, forgotten, contradicted, or untested.
   *
   * Checks merged assertion results (with _factId and _assertionType added)
   * for assertions targeting this factId. no_contradiction failures take priority.
   *
   * @param {FactEntry} factEntry
   * @param {object[]} mergedResults - assertion results with _factId, _assertionType
   * @returns {'recalled'|'forgotten'|'contradicted'|'untested'}
   */
  _classifyFactResult(factEntry, mergedResults) {
    const relatedAssertions = mergedResults.filter(
      ar => ar._factId === factEntry.factId
    );

    if (relatedAssertions.length === 0) return 'untested';

    // Check contradictions first (higher severity)
    const contradictionResults = relatedAssertions.filter(
      ar => ar._assertionType === 'no_contradiction'
    );
    for (const cr of contradictionResults) {
      if (!cr.passed) return 'contradicted';
    }

    // Check recall_contains and fact_present
    const recallResults = relatedAssertions.filter(
      ar => ar._assertionType === 'recall_contains' || ar._assertionType === 'fact_present'
    );
    if (recallResults.length === 0) return 'untested';

    return recallResults.every(rr => rr.passed) ? 'recalled' : 'forgotten';
  }

  // =========================================================
  // Private: Metric Computation
  // =========================================================

  /**
   * Compute recall metrics for a scenario.
   *
   * Merges assertion configs (which have factId) with assertion results
   * (which have passed/failed) by index alignment, then classifies each fact.
   *
   * @param {Map<string, FactEntry>} factRegistry
   * @param {AssertionResult[]} assertionResults
   * @param {object} scenario - scenario config (has assertions array)
   * @returns {object} memory metrics block
   */
  _computeRecallMetrics(factRegistry, assertionResults, scenario) {
    // Merge assertion configs with results by index
    // evaluateAssertions processes scenario.assertions in order,
    // so assertionResults[i] corresponds to scenario.assertions[i]
    const assertionConfigs = scenario.assertions || [];
    const mergedResults = assertionResults.map((result, i) => ({
      ...result,
      _factId: assertionConfigs[i]?.factId || null,
      _assertionType: assertionConfigs[i]?.type || result.type
    }));

    const factDetails = [];
    const byCategory = {};
    let recalled = 0;
    let forgotten = 0;
    let contradicted = 0;
    let untested = 0;

    for (const [factId, factEntry] of factRegistry) {
      const result = this._classifyFactResult(factEntry, mergedResults);
      factEntry.recallResult = result;

      factDetails.push({
        factId,
        category: factEntry.category,
        result,
        establishedAtStepIndex: factEntry.establishedAtStepIndex
      });

      switch (result) {
        case 'recalled': recalled++; break;
        case 'forgotten': forgotten++; break;
        case 'contradicted': contradicted++; break;
        case 'untested': untested++; break;
      }

      // Category tracking
      const cat = factEntry.category;
      if (!byCategory[cat]) {
        byCategory[cat] = { total: 0, recalled: 0, forgotten: 0, contradicted: 0, rate: 0 };
      }
      byCategory[cat].total++;
      if (result === 'recalled') byCategory[cat].recalled++;
      if (result === 'forgotten') byCategory[cat].forgotten++;
      if (result === 'contradicted') byCategory[cat].contradicted++;
    }

    // Compute category rates
    for (const cat of Object.keys(byCategory)) {
      const c = byCategory[cat];
      c.rate = c.total > 0 ? c.recalled / c.total : 0;
    }

    const testable = recalled + forgotten + contradicted;
    const recallRate = testable > 0 ? recalled / testable : 0;
    const contradictionRate = testable > 0 ? contradicted / testable : 0;
    const recallThreshold = this._getRecallThreshold(scenario);
    const contradictionThreshold = this._getContradictionThreshold(scenario);

    return {
      facts: { total: factRegistry.size, recalled, forgotten, contradicted, untested },
      recallRate,
      contradictionRate,
      recallThreshold,
      contradictionThreshold,
      passed: recallRate >= recallThreshold && contradictionRate <= contradictionThreshold,
      factDetails,
      byCategory
    };
  }

  /**
   * Compute per-phase step metrics.
   * Phase comes from scenario config steps (not from StepResult).
   *
   * @param {object} scenario - scenario config
   * @param {StepResult[]} stepResults - from scenario execution
   * @returns {object} phase → { steps, passed, failed, skipped }
   */
  _computePhaseMetrics(scenario, stepResults) {
    const phases = {};
    const steps = scenario.steps || [];

    for (let i = 0; i < steps.length; i++) {
      const phase = steps[i].phase || 'unknown';
      if (!phases[phase]) {
        phases[phase] = { steps: 0, passed: 0, failed: 0, skipped: 0 };
      }
      phases[phase].steps++;

      const stepResult = stepResults[i]; // aligned by index
      if (!stepResult) {
        phases[phase].skipped++;
      } else if (stepResult.status === 'passed') {
        phases[phase].passed++;
      } else if (stepResult.status === 'skipped') {
        phases[phase].skipped++;
      } else {
        phases[phase].failed++;
      }
    }

    return phases;
  }

  /**
   * Aggregate memory health across all scenario results.
   *
   * @param {object[]} enrichedScenarios - scenario results with memory field
   * @returns {object} memoryHealth block
   */
  _computeMemoryHealth(enrichedScenarios) {
    let totalFacts = 0;
    let totalRecalled = 0;
    let totalForgotten = 0;
    let totalContradicted = 0;
    const categoryAgg = {};

    for (const sr of enrichedScenarios) {
      if (!sr.memory) continue;

      totalFacts += sr.memory.facts.total;
      totalRecalled += sr.memory.facts.recalled;
      totalForgotten += sr.memory.facts.forgotten;
      totalContradicted += sr.memory.facts.contradicted;

      for (const [cat, metrics] of Object.entries(sr.memory.byCategory || {})) {
        if (!categoryAgg[cat]) {
          categoryAgg[cat] = { total: 0, recalled: 0 };
        }
        categoryAgg[cat].total += metrics.total;
        categoryAgg[cat].recalled += metrics.recalled;
      }
    }

    const testable = totalRecalled + totalForgotten + totalContradicted;
    const overallRecallRate = testable > 0 ? totalRecalled / testable : 0;
    const overallContradictionRate = testable > 0 ? totalContradicted / testable : 0;

    const weakCategories = [];
    const strongCategories = [];
    const threshold = this.config.recallThreshold ?? 0.85;

    for (const [cat, metrics] of Object.entries(categoryAgg)) {
      const rate = metrics.total > 0 ? metrics.recalled / metrics.total : 0;
      if (rate < threshold) {
        weakCategories.push(cat);
      } else {
        strongCategories.push(cat);
      }
    }

    const allPassed = enrichedScenarios.every(sr => !sr.memory || sr.memory.passed);

    return {
      overallRecallRate,
      overallContradictionRate,
      factsTested: totalFacts,
      factsRecalled: totalRecalled,
      factsForgotten: totalForgotten,
      factsContradicted: totalContradicted,
      recallThreshold: threshold,
      contradictionThreshold: this.config.contradictionThreshold ?? 0.0,
      passed: allPassed,
      weakCategories,
      strongCategories
    };
  }

  // =========================================================
  // Private: Helpers
  // =========================================================

  /**
   * Extract lowercase response text from a StepResult.
   * Handles multiple result shapes from different connector actions.
   */
  _extractResponseText(stepResult) {
    if (!stepResult) return '';
    const raw = stepResult.result?.text
      || stepResult.result?.response
      || stepResult.result?.content
      || (typeof stepResult.result === 'string' ? stepResult.result : '');
    return raw.toString().toLowerCase();
  }

  /**
   * Find a scenario config by ID.
   */
  _findScenarioConfig(scenarioId) {
    return this.getScenarios().find(s => s.id === scenarioId) || null;
  }

  /**
   * Get effective recall threshold for a scenario.
   * Cascade: scenario → config → 0.85
   */
  _getRecallThreshold(scenario) {
    return scenario?.recallThreshold ?? this.config.recallThreshold ?? 0.85;
  }

  /**
   * Get effective contradiction threshold for a scenario.
   * Cascade: scenario → config → 0.0
   */
  _getContradictionThreshold(scenario) {
    return scenario?.contradictionThreshold ?? this.config.contradictionThreshold ?? 0.0;
  }
}

module.exports = SentinelAgent;
```

---

## 6. Config Schema: `agents/sentinel/sentinel.config.schema.json`

This is **documentation only** — not enforced at runtime (same as HealerAgent pattern).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SentinelAgentConfig",
  "description": "Configuration schema for SentinelAgent memory persistence testing. Documentation only — not enforced at runtime.",
  "type": "object",
  "required": ["id", "scenarios"],
  "properties": {
    "id": { "type": "string", "const": "sentinel", "description": "Used by getAgentId()" },
    "description": { "type": "string" },
    "recallThreshold": {
      "type": "number", "minimum": 0, "maximum": 1, "default": 0.85,
      "description": "Global default recall accuracy threshold"
    },
    "contradictionThreshold": {
      "type": "number", "minimum": 0, "maximum": 1, "default": 0,
      "description": "Global maximum allowed contradiction rate"
    },
    "scenarios": {
      "type": "array",
      "items": { "$ref": "#/definitions/MemoryScenario" },
      "minItems": 1
    }
  },
  "definitions": {
    "MemoryScenario": {
      "type": "object",
      "required": ["id", "name", "steps", "assertions"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "description": { "type": "string" },
        "timeout": { "type": "number", "default": 300000 },
        "recallThreshold": { "type": "number", "minimum": 0, "maximum": 1 },
        "contradictionThreshold": { "type": "number", "minimum": 0, "maximum": 1 },
        "steps": {
          "type": "array",
          "items": { "$ref": "#/definitions/MemoryStep" }
        },
        "assertions": {
          "type": "array",
          "items": { "type": "object" },
          "description": "Scenario-level assertions evaluated after all steps complete. Custom types: recall_contains, no_contradiction, fact_present."
        }
      }
    },
    "MemoryStep": {
      "type": "object",
      "required": ["action"],
      "properties": {
        "action": { "type": "string" },
        "params": { "type": "object" },
        "description": { "type": "string" },
        "captureEvidence": { "type": "boolean", "default": false },
        "phase": {
          "type": "string",
          "enum": ["setup", "establish", "distance", "recall"],
          "description": "Phase annotation read by SentinelAgent. Ignored by BaseAgent."
        },
        "fact": {
          "$ref": "#/definitions/FactDeclaration",
          "description": "Fact declaration for establish-phase steps. Read by SentinelAgent. Ignored by BaseAgent."
        }
      }
    },
    "FactDeclaration": {
      "type": "object",
      "required": ["factId", "keywords"],
      "properties": {
        "factId": { "type": "string" },
        "keywords": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "contradictions": { "type": "array", "items": { "type": "string" }, "default": [] },
        "category": { "type": "string", "description": "Optional grouping (character, setting, plot, worldbuilding)" }
      }
    }
  }
}
```

---

## 7. Example Scenario Config

This shows the scenario config shape. Real scenario files are authored during orchestrator/staging integration. Unit tests create configs inline. **Note step indices in assertions — these must match step array positions exactly.**

```json
{
  "id": "memory-basic-3-facts",
  "name": "Basic 3-Fact Memory Test",
  "description": "Establish 3 facts across sessions, create distance, then verify recall",
  "timeout": 300000,
  "recallThreshold": 0.85,
  "steps": [
    {
      "action": "create_project",
      "params": { "name": "Memory Test {{timestamp}}" },
      "description": "Create test project",
      "phase": "setup"
    },
    {
      "action": "create_story",
      "params": { "name": "Noir Story", "vertical": "novel" },
      "description": "Create test story",
      "phase": "setup"
    },
    {
      "action": "create_session",
      "params": { "type": "explore" },
      "description": "Create first session",
      "phase": "setup"
    },
    {
      "action": "send_message",
      "params": { "text": "The protagonist is Marcus, a hardboiled detective working in 1940s Los Angeles." },
      "description": "Establish fact: Marcus is a detective",
      "phase": "establish",
      "fact": {
        "factId": "fact-marcus-detective",
        "keywords": ["Marcus", "detective"],
        "contradictions": ["teacher", "lawyer", "doctor", "nurse"],
        "category": "character"
      }
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "description": "Wait for AI response",
      "phase": "establish"
    },
    {
      "action": "send_message",
      "params": { "text": "The story is set in a noir version of 1940s Los Angeles, with rain-slicked streets and jazz clubs." },
      "description": "Establish fact: noir 1940s LA setting",
      "phase": "establish",
      "fact": {
        "factId": "fact-setting-noir",
        "keywords": ["noir", "1940s", "Los Angeles"],
        "contradictions": ["modern day", "future", "fantasy", "medieval"],
        "category": "setting"
      }
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "phase": "establish"
    },
    {
      "action": "send_message",
      "params": { "text": "The villain is Victor, a former business partner of Marcus's father, driven by revenge for a deal gone wrong decades ago." },
      "description": "Establish fact: villain motivated by revenge",
      "phase": "establish",
      "fact": {
        "factId": "fact-villain-revenge",
        "keywords": ["Victor", "revenge"],
        "contradictions": ["money", "greed", "power", "love"],
        "category": "plot"
      }
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "phase": "establish"
    },
    {
      "action": "create_session",
      "params": { "type": "explore" },
      "description": "Create intervening session 2",
      "phase": "distance"
    },
    {
      "action": "send_message",
      "params": { "text": "Let's brainstorm some scene descriptions for the opening chapter." },
      "description": "Send unrelated content in session 2",
      "phase": "distance"
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "phase": "distance"
    },
    {
      "action": "create_session",
      "params": { "type": "explore" },
      "description": "Create intervening session 3",
      "phase": "distance"
    },
    {
      "action": "send_message",
      "params": { "text": "What kind of pacing would work best for a noir thriller? I'm thinking slow burn." },
      "description": "Send more unrelated content",
      "phase": "distance"
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "phase": "distance"
    },
    {
      "action": "create_session",
      "params": { "type": "explore" },
      "description": "Create recall session",
      "phase": "recall"
    },
    {
      "action": "send_message",
      "params": { "text": "Who is the protagonist of our story and what do they do?" },
      "description": "Recall query: protagonist",
      "phase": "recall"
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "description": "AI response about protagonist (step 17 — assertion target)",
      "phase": "recall"
    },
    {
      "action": "send_message",
      "params": { "text": "Remind me about the setting we established for this story." },
      "description": "Recall query: setting",
      "phase": "recall"
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "description": "AI response about setting (step 19 — assertion target)",
      "phase": "recall"
    },
    {
      "action": "send_message",
      "params": { "text": "What is Victor's motivation as our antagonist?" },
      "description": "Recall query: villain",
      "phase": "recall"
    },
    {
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "description": "AI response about villain (step 21 — assertion target)",
      "phase": "recall"
    }
  ],
  "assertions": [
    { "type": "recall_contains", "stepIndex": 17, "factId": "fact-marcus-detective", "keywords": ["Marcus", "detective"] },
    { "type": "no_contradiction", "stepIndex": 17, "factId": "fact-marcus-detective", "contradictions": ["teacher", "lawyer", "doctor", "nurse"] },
    { "type": "recall_contains", "stepIndex": 19, "factId": "fact-setting-noir", "keywords": ["noir", "1940s", "Los Angeles"] },
    { "type": "no_contradiction", "stepIndex": 19, "factId": "fact-setting-noir", "contradictions": ["modern day", "future", "fantasy", "medieval"] },
    { "type": "recall_contains", "stepIndex": 21, "factId": "fact-villain-revenge", "keywords": ["Victor", "revenge"] },
    { "type": "no_contradiction", "stepIndex": 21, "factId": "fact-villain-revenge", "contradictions": ["money", "greed", "power", "love"] }
  ]
}
```

---

## 8. Test Specifications

### Test File: `tests/agents/sentinel-agent.test.js`

**Total estimated tests: ~85**

### 8.1 Constructor & Initialization (~8 tests)

```javascript
describe('SentinelAgent', () => {
  describe('constructor', () => {
    test('accepts config and connector');
    test('is instanceof BaseAgent');
  });

  describe('initialize()', () => {
    test('calls super.initialize()');
    test('builds fact registries from scenario configs');
    test('creates registry entry for each step with fact declaration');
    test('handles scenario with no facts (empty registry, no error)');
    test('throws ConfigurationError if scenario has facts but no memory assertions');
    test('uses getScenarios() to respect tag filtering');
  });
});
```

### 8.2 Fact Registry Building (~12 tests)

```javascript
describe('_buildFactRegistryForScenario()', () => {
  test('extracts factId, keywords, contradictions, category from step.fact');
  test('records establishedAtStepIndex as numeric array index');
  test('handles multiple facts in one scenario');
  test('handles fact with no contradictions (defaults to [])');
  test('handles fact with no category (defaults to uncategorized)');
  test('ignores steps without fact declarations');
  test('handles steps without phase field (no error)');
  test('throws ConfigurationError: facts exist but no memory assertions');
  test('does not throw when zero facts and zero memory assertions');
  test('does not throw when zero facts but has standard assertions');
  test('handles duplicate factIds (last one wins by Map behavior)');
  test('sets recallResult to null initially');
});
```

### 8.3 Custom Assertion: recall_contains (~10 tests)

```javascript
describe('evaluateAssertion() — recall_contains', () => {
  test('passes when all keywords found in step response');
  test('fails when one keyword missing');
  test('fails when all keywords missing');
  test('case-insensitive keyword matching');
  test('returns expected with keywords listed');
  test('returns actual with truncated response text');
  test('returns durationMs');
  test('fails with message if stepIndex missing');
  test('fails with message if factId missing');
  test('fails with message if keywords not array');
});
```

### 8.4 Custom Assertion: no_contradiction (~8 tests)

```javascript
describe('evaluateAssertion() — no_contradiction', () => {
  test('passes when no contradiction strings found');
  test('fails when contradiction string found in response');
  test('case-insensitive contradiction matching');
  test('reports found contradictions in actual field');
  test('returns expected with contradiction list');
  test('returns durationMs');
  test('fails with message if stepIndex missing');
  test('fails with message if contradictions not array');
});
```

### 8.5 Custom Assertion: fact_present (~8 tests)

```javascript
describe('evaluateAssertion() — fact_present', () => {
  test('passes when validate_memory returns found:true and text matches');
  test('fails when validate_memory returns found:false');
  test('fails when found:true but expected text not in result');
  test('case-insensitive text matching');
  test('includes actual memory text in actual field');
  test('returns durationMs');
  test('fails with message if factId missing');
  test('fails with message if expected missing');
});
```

### 8.6 Assertion Fallback to BaseAgent (~3 tests)

```javascript
describe('evaluateAssertion() — fallback', () => {
  test('delegates state_exists to super');
  test('delegates response_contains to super');
  test('delegates unknown type to super (returns failed)');
});
```

### 8.7 Fact Classification (~10 tests)

```javascript
describe('_classifyFactResult()', () => {
  test('returns recalled when recall_contains passes for fact');
  test('returns forgotten when recall_contains fails');
  test('returns contradicted when no_contradiction fails');
  test('contradiction takes priority over recall failure');
  test('returns untested when no assertions reference this factId');
  test('returns recalled when fact_present passes');
  test('returns forgotten when fact_present fails');
  test('handles multiple recall_contains for same fact — all must pass');
  test('handles mixed assertion types for same fact');
  test('returns untested for empty assertion results');
});
```

### 8.8 Recall Metrics Computation (~8 tests)

```javascript
describe('_computeRecallMetrics()', () => {
  test('computes correct recallRate');
  test('computes correct contradictionRate');
  test('computes per-category rates');
  test('passed=true when rate >= threshold and contradictions <= threshold');
  test('passed=false when rate below threshold');
  test('passed=false when contradiction rate above threshold');
  test('handles zero testable facts (rate = 0)');
  test('merges assertion configs with results by index alignment');
});
```

### 8.9 analyzeResults() (~10 tests)

```javascript
describe('analyzeResults()', () => {
  test('calls super.analyzeResults(testRunResult) with testRunResult param');
  test('enriches scenario results with memory field');
  test('enriches scenario results with phases field');
  test('sets status to failed when recall below threshold');
  test('keeps status passed when recall meets threshold');
  test('handles scenario with no fact registry (returns unenriched)');
  test('handles scenario config not found (returns unenriched)');
  test('handles mixed: some scenarios pass, some fail');
  test('returns scenarios array (not scenarioResults)');
  test('preserves base analysis fields (summary, durationMs, passRate)');
});
```

### 8.10 Phase Metrics (~5 tests)

```javascript
describe('_computePhaseMetrics()', () => {
  test('groups steps by phase from scenario config');
  test('counts passed/failed/skipped per phase');
  test('uses numeric index alignment (not stepId)');
  test('handles steps without phase field (grouped as unknown)');
  test('handles missing step results (counted as skipped)');
});
```

### 8.11 generateReport() (~6 tests)

```javascript
describe('generateReport()', () => {
  test('calls super.generateReport(analysis)');
  test('includes memoryHealth in report');
  test('computes overallRecallRate across all scenarios');
  test('identifies weakCategories (below threshold)');
  test('identifies strongCategories (at or above threshold)');
  test('passed is true only when ALL scenarios pass memory thresholds');
});
```

### 8.12 Threshold Cascading (~5 tests)

```javascript
describe('threshold cascading', () => {
  test('scenario threshold overrides config threshold');
  test('config threshold overrides default 0.85');
  test('default 0.85 used when neither scenario nor config set');
  test('contradiction threshold cascading: scenario → config → 0.0');
  test('_getRecallThreshold handles undefined scenario');
});
```

### 8.13 Edge Cases (~5 tests)

```javascript
describe('edge cases', () => {
  test('scenario with zero distance steps (immediate recall)');
  test('scenario with all facts contradicted');
  test('scenario with all facts forgotten');
  test('very long scenario (20+ steps) processes correctly');
  test('_extractResponseText handles null/undefined/string/object results');
});
```

---

## 9. Mock Patterns & Test Helpers

### File: `tests/helpers/sentinel-helpers.js`

Separate from `mock-connector.js` to keep concerns separated. Agent-specific helpers.

```javascript
'use strict';

const { createMockConnector, createAgentConfig } = require('./mock-connector');

/**
 * Create a mock connector with overridable action handlers.
 * Delegates to base mock for unoverridden actions.
 */
function createMemoryMockConnector(overrides = {}) {
  const mock = createMockConnector();
  const originalPerformAction = mock.performAction.bind(mock);

  mock.performAction = async (action, params) => {
    if (overrides[action]) {
      return overrides[action](params);
    }
    return originalPerformAction(action, params);
  };

  return mock;
}

/**
 * Create a minimal SentinelAgent config.
 * Uses config.id (not agentId) for getAgentId() compatibility.
 */
function createSentinelConfig(overrides = {}) {
  return {
    id: 'sentinel',
    description: 'Memory persistence validation',
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    scenarios: overrides.scenarios || [createMemoryScenario()],
    ...overrides
  };
}

/**
 * Create a minimal memory scenario with 1 fact.
 * Steps: setup → establish (with fact) → wait → recall query → recall response.
 * Assertions: recall_contains + no_contradiction at scenario level.
 */
function createMemoryScenario(overrides = {}) {
  const steps = overrides.steps || [
    {
      action: 'create_session',
      params: { type: 'explore' },
      phase: 'setup'
    },
    {
      action: 'send_message',
      params: { text: 'The protagonist is Marcus, a detective.' },
      phase: 'establish',
      fact: {
        factId: 'fact-marcus',
        keywords: ['Marcus', 'detective'],
        contradictions: ['teacher', 'lawyer'],
        category: 'character'
      }
    },
    {
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'establish'
    },
    {
      action: 'send_message',
      params: { text: 'Who is the protagonist?' },
      phase: 'recall'
    },
    {
      action: 'wait_for_response',
      params: { timeout: 30000 },
      description: 'Recall response (step 4 — assertion target)',
      phase: 'recall'
    }
  ];

  const assertions = overrides.assertions || [
    {
      type: 'recall_contains',
      stepIndex: 4,
      factId: 'fact-marcus',
      keywords: ['Marcus', 'detective']
    },
    {
      type: 'no_contradiction',
      stepIndex: 4,
      factId: 'fact-marcus',
      contradictions: ['teacher', 'lawyer']
    }
  ];

  return {
    id: overrides.id || 'test-memory-scenario',
    name: overrides.name || 'Test Memory Scenario',
    timeout: overrides.timeout || 120000,
    recallThreshold: overrides.recallThreshold,
    contradictionThreshold: overrides.contradictionThreshold,
    steps,
    assertions
  };
}

/**
 * Create a multi-fact scenario for recall accuracy testing.
 * All facts go in one establish phase, one distance step, then all recalls.
 * Assertions: recall_contains + no_contradiction for each fact.
 *
 * @param {object} opts - { factCount, recallThreshold }
 */
function createMultiFactScenario({ factCount = 3, recallThreshold = 0.85 } = {}) {
  const steps = [
    // Step 0: setup
    {
      action: 'create_session',
      params: { type: 'explore' },
      phase: 'setup'
    }
  ];

  let stepIdx = 1;
  const assertionConfigs = [];

  // Establish facts: each is send_message + wait_for_response
  for (let i = 0; i < factCount; i++) {
    steps.push({
      action: 'send_message',
      params: { text: `Fact ${i}: keyword-${i} is established.` },
      phase: 'establish',
      fact: {
        factId: `fact-${i}`,
        keywords: [`keyword-${i}`],
        contradictions: [`contra-${i}`],
        category: i % 2 === 0 ? 'character' : 'plot'
      }
    });
    stepIdx++;

    steps.push({
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'establish'
    });
    stepIdx++;
  }

  // Distance: one intervening session
  steps.push({
    action: 'create_session',
    params: { type: 'explore' },
    phase: 'distance'
  });
  stepIdx++;

  // Recall: send_message + wait_for_response per fact
  for (let i = 0; i < factCount; i++) {
    steps.push({
      action: 'send_message',
      params: { text: `Recall query for fact ${i}` },
      phase: 'recall'
    });
    const sendIdx = stepIdx;
    stepIdx++;

    steps.push({
      action: 'wait_for_response',
      params: { timeout: 30000 },
      phase: 'recall'
    });
    const responseIdx = stepIdx;
    stepIdx++;

    // Assertions targeting the wait_for_response step (has the AI response)
    assertionConfigs.push({
      type: 'recall_contains',
      stepIndex: responseIdx - 1,
      factId: `fact-${i}`,
      keywords: [`keyword-${i}`]
    });
    assertionConfigs.push({
      type: 'no_contradiction',
      stepIndex: responseIdx - 1,
      factId: `fact-${i}`,
      contradictions: [`contra-${i}`]
    });
  }

  return {
    id: `multi-fact-${factCount}`,
    name: `${factCount}-Fact Memory Test`,
    recallThreshold,
    steps,
    assertions: assertionConfigs
  };
}

/**
 * Create a mock testRunResult for analyzeResults() testing.
 *
 * @param {object[]} scenarioResults - [{ scenarioId, status, steps, assertions }]
 * @returns {object} testRunResult compatible with BaseAgent.analyzeResults
 */
function createMockTestRunResult(scenarioResults) {
  const total = scenarioResults.length;
  const passed = scenarioResults.filter(s => s.status === 'passed').length;
  const failed = total - passed;

  return {
    summary: { total, passed, failed },
    scenarios: scenarioResults,
    durationMs: 1000
  };
}

/**
 * Create mock assertion results with _factId and _assertionType already merged.
 * For testing _classifyFactResult directly (pre-merged format).
 *
 * @param {Array} results - [{ type, factId, passed }]
 * @returns {object[]} formatted for _classifyFactResult
 */
function createMockMergedAssertionResults(results) {
  return results.map(r => ({
    type: r.type,
    passed: r.passed,
    message: r.passed ? 'passed' : 'failed',
    expected: '',
    actual: '',
    durationMs: 1,
    _factId: r.factId || null,
    _assertionType: r.type
  }));
}

module.exports = {
  createMemoryMockConnector,
  createSentinelConfig,
  createMemoryScenario,
  createMultiFactScenario,
  createMockTestRunResult,
  createMockMergedAssertionResults
};
```

---

## 10. Files to Create

| # | File | Lines (est.) | Purpose |
|---|------|-------------|---------|
| 1 | `agents/sentinel/agent.js` | ~310 | SentinelAgent class |
| 2 | `agents/sentinel/sentinel.config.schema.json` | ~65 | Config documentation schema |
| 3 | `tests/helpers/sentinel-helpers.js` | ~200 | createSentinelConfig, createMemoryScenario, createMultiFactScenario, createMemoryMockConnector, createMockTestRunResult, createMockMergedAssertionResults |
| 4 | `tests/agents/sentinel-agent.test.js` | ~650 | ~85 tests |

**Total: ~1,225 lines across 4 files, ~85 new tests bringing project total to ~624.**

---

## 11. Implementation Steps for Claude Code

**Implement SentinelAgent from spec. Follow `docs/sentinel-agent-implementation-spec.md` Section 11, all 5 steps.**

Read the full spec first, then execute each step in order:

1. **Step 1:** Create `tests/helpers/sentinel-helpers.js` — exports `createSentinelConfig`, `createMemoryScenario`, `createMultiFactScenario`, `createMemoryMockConnector`, `createMockTestRunResult`, `createMockMergedAssertionResults` per Section 9.

2. **Step 2:** Create `agents/sentinel/sentinel.config.schema.json` — per Section 6. Documentation only.

3. **Step 3:** Create `agents/sentinel/agent.js` — full implementation per Section 5. SentinelAgent extends BaseAgent with 4 overrides (`initialize`, `evaluateAssertion`, `analyzeResults`, `generateReport`) and 10 private methods. **Critical: match BaseAgent's exact method signatures.**

4. **Step 4:** Create `tests/agents/sentinel-agent.test.js` — per Section 8. ~85 tests covering all 13 test groups.

5. **Step 5:** Run `npm test` — all 539 existing tests + all new sentinel tests must pass. Create `docs/sentinel-agent-implementation-log.md` with test counts per suite.

**Key rules:**
- Section 5 code is authoritative — implement exactly as written
- SentinelAgent NEVER imports connector classes — uses mock connector from helpers
- `evaluateAssertion(assertion, scenarioContext)` — **2 params, async** — matches BaseAgent exactly
- Returns `{ type, passed, message, expected, actual, durationMs }` — **matches BaseAgent shape**
- Assertions are **scenario-level** (`scenario.assertions`), not per-step
- Step results accessed via `scenarioContext.stepResults[assertion.stepIndex]` — numeric index
- `analyzeResults(testRunResult)` — **requires testRunResult param** — matches BaseAgent/HealerAgent
- Report uses `scenarios` field name (not `scenarioResults`)
- Config uses `id: 'sentinel'` (not `agentId`)
- Uses `getScenarios()` for tag filtering (not `this.config.scenarios` directly)
- `_classifyFactResult` checks `no_contradiction` before `recall_contains` — contradiction is higher severity
- The `AssertionError` spelling is intentional (avoids Node.js collision) — already established
- `recall_accuracy` is NOT an assertion type — it's computed in analyzeResults()

Commit each step separately with descriptive messages.

---

## 12. Claude Code Implementation Notes

1. **SentinelAgent is a thin layer on top of BaseAgent.** The 4 overrides + 10 private methods add memory-specific analysis. All scenario execution, step running, timeout enforcement, and base assertion evaluation are inherited. Don't reimplement anything in BaseAgent.

2. **The critical design choice: assertions at scenario level with stepIndex references.** This works with BaseAgent's existing `evaluateAssertions(scenario.assertions, scenarioContext)` call. No BaseAgent modifications needed. Each custom assertion accesses `scenarioContext.stepResults[assertion.stepIndex]` to read the target step's result.

3. **`recall_accuracy` is NOT an assertion type.** It was removed because `evaluateAssertion` has no access to other assertion results — only `scenarioContext.stepResults`. Aggregate recall rate is computed in `analyzeResults()` by iterating the fact registry and checking assertion outcomes. This is cleaner and more reliable.

4. **Assertion-to-fact linking via index alignment.** `evaluateAssertions()` processes `scenario.assertions` in order, producing `assertionResults` with the same length and order. `_computeRecallMetrics()` merges them by index: `assertionResults[i]` corresponds to `scenario.assertions[i]`. The merged object carries `_factId` and `_assertionType` from the config, plus `passed` from the result. `_classifyFactResult` then filters by `_factId`.

5. **Phase is a config annotation, not a runtime field.** BaseAgent's StepResult has no `phase` field. `_computePhaseMetrics()` reads phase from `scenario.steps[i].phase` and matches to `stepResults[i]` by array position. This index alignment works because BaseAgent produces one StepResult per step, in order.

6. **`_extractResponseText()` handles multiple result shapes.** Connectors may return `{ text: '...' }`, `{ response: '...' }`, `{ content: '...' }`, or plain strings. The helper tries all known shapes and falls back to empty string. All comparisons are case-insensitive (`.toLowerCase()`).

7. **Threshold cascading:** scenario → config → default. `_getRecallThreshold(scenario)` returns `scenario.recallThreshold ?? this.config.recallThreshold ?? 0.85`. Same pattern for contradiction threshold with default 0.0.

8. **`createMultiFactScenario` in test helpers generates valid stepIndex references.** The helper tracks step indices as it builds the steps array, then generates assertion configs pointing to the correct recall response steps. Test authors can override `factCount` and `recallThreshold`.

9. **`createMockTestRunResult` provides the testRunResult shape.** Needed for testing `analyzeResults(testRunResult)`. It wraps scenario results with the `{ summary, scenarios, durationMs }` structure that BaseAgent.runTests() produces.

---

## 13. What Comes Next

After SentinelAgent is built and tested:

- **Day 4:** LibrarianAgent — Citation accuracy and Bible verification. Extends BaseAgent with content validation scenarios. Custom assertions for citation grounding (`citation_valid`, `citation_supports_claim`, `no_hallucination`, `content_complete`). Same pattern: scenario-level assertions with `stepIndex` references.
- **Day 5:** Test Orchestrator — Coordinates agents, manages lifecycle, aggregates results. Creates connector via ConnectorFactory, passes to each agent. Sequential execution with shared connector.
