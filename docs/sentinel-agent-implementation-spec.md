# QA Engine: SentinelAgent Implementation Specification

**Phase:** 1, Week 2, Day 3  
**Purpose:** Implementation-ready spec for `agents/sentinel/agent.js`  
**For:** Claude Code technical evaluation → implementation  
**Dependencies:** BaseAgent (✅), HealerAgent (✅), error hierarchy (✅), mock-connector (✅) — 539/539 tests passing  
**References:** qa-engine-01-overview-and-architecture.md, qa-engine-02-core-engine-spec.md, qa-engine-03-connector-pattern-spec.md, qa-engine-05-implementation-plan.md, brainstormy-testing-framework-spec.md, base-agent-healer-implementation-spec.md

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
  → Validate responses contain expected facts
  → Score recall accuracy against threshold
  → Detect contradictions with established facts
```

This three-phase pattern is encoded in scenario JSON config. BaseAgent's `runScenario()` → `executeStep()` pipeline handles all phases — SentinelAgent adds **phase-aware analysis** on top.

### Why Not Hardcode Phases in the Agent?

The phases are a **scenario config concern**, not an agent logic concern. A scenario step has a `phase` field (`establish`, `distance`, `recall`). The agent reads this field during `analyzeResults()` to compute per-phase metrics. This means:

- Same SentinelAgent class works for 3-fact quick tests and 50-fact stress tests
- Phase boundaries are configurable per scenario
- New phase types (e.g., `modify` for testing fact updates) can be added without agent code changes

### Custom Assertion Types

SentinelAgent extends BaseAgent's 10 assertion types with 4 memory-specific types:

| Type | Purpose | Params |
|------|---------|--------|
| `recall_contains` | Response mentions an established fact | `factId`, `keywords` (array) |
| `recall_accuracy` | Recall rate meets threshold across all facts in scenario | `threshold` (0-1) |
| `no_contradiction` | Response doesn't contradict an established fact | `factId`, `contradictions` (array of strings that would indicate contradiction) |
| `fact_present` | Specific fact appears in `validate_memory` result | `factId`, `expected` (string) |

These are evaluated in `evaluateAssertion()` via switch + `super.evaluateAssertion()` fallback — same pattern as HealerAgent.

### Recall Scoring Algorithm

Recall scoring is deterministic and config-driven, not LLM-powered (LLM analysis is Bug Detector's job in Week 3):

```
For each fact in scenario:
  1. Find the recall step that targets this fact (via factId match)
  2. Check if step passed all its assertions
  3. If passed → fact recalled. If failed → fact forgotten.

recallRate = factsRecalled / totalFacts
passed = recallRate >= scenario.recallThreshold (default: 0.85)
```

### Contradiction Detection Strategy

Contradictions are more severe than forgotten facts. A forgotten fact means the system lost context; a contradiction means the system actively generated incorrect information. SentinelAgent tracks these separately:

- **Forgotten:** Recall query returns no relevant information about the fact
- **Contradicted:** Recall response contains content matching the fact's `contradictions` array (e.g., fact says "Marcus is a detective" → contradiction if response says "Marcus is a teacher")
- **Recalled:** Response contains expected keywords and no contradictions

Contradiction rate is always expected to be 0% — any contradiction is a critical failure.

### Fact Registry

Each scenario maintains a **fact registry** — a mapping from `factId` to fact metadata. This is built from `establish` phase steps during `initialize()` and used during `analyzeResults()`:

```javascript
// Built from scenario config during initialize()
factRegistry = {
  'fact-marcus-detective': {
    factId: 'fact-marcus-detective',
    establishedInStep: 2,
    keywords: ['Marcus', 'detective'],
    contradictions: ['teacher', 'lawyer', 'doctor'],
    category: 'character'  // optional grouping
  },
  'fact-setting-noir': {
    factId: 'fact-setting-noir',
    establishedInStep: 3,
    keywords: ['noir', '1940s', 'Los Angeles'],
    contradictions: ['modern', 'future', 'fantasy'],
    category: 'setting'
  }
}
```

Facts are extracted from `establish` phase steps that include a `fact` field in their config. This is passive — the agent doesn't parse message content, it reads the scenario author's declared facts.

---

## 2. Data Structures

### SentinelConfig (extends AgentConfig)

```javascript
// agents/sentinel/sentinel.config.schema.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["agentId", "scenarios"],
  "properties": {
    "agentId": { "type": "string", "const": "sentinel" },
    "agentType": { "type": "string", "const": "sentinel" },
    "description": { "type": "string" },
    "recallThreshold": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "default": 0.85,
      "description": "Global default recall accuracy threshold (overridden per-scenario)"
    },
    "contradictionThreshold": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "default": 0,
      "description": "Maximum allowed contradiction rate (0 = zero tolerance)"
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
      "required": ["id", "name", "steps"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "description": { "type": "string" },
        "timeout": { "type": "number", "default": 300000 },
        "recallThreshold": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "description": "Per-scenario override of global recallThreshold"
        },
        "contradictionThreshold": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "steps": {
          "type": "array",
          "items": { "$ref": "#/definitions/MemoryStep" }
        }
      }
    },
    "MemoryStep": {
      "type": "object",
      "required": ["id", "action"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "phase": {
          "type": "string",
          "enum": ["establish", "distance", "recall", "setup"],
          "description": "Phase classification. 'setup' for project/story creation. 'establish' for fact-planting. 'distance' for intervening sessions. 'recall' for memory verification."
        },
        "action": { "type": "string" },
        "params": { "type": "object" },
        "fact": { "$ref": "#/definitions/FactDeclaration" },
        "recallTarget": {
          "type": "string",
          "description": "factId this recall step is targeting (for recall phase steps)"
        },
        "assertions": {
          "type": "array",
          "items": { "$ref": "#/definitions/Assertion" }
        }
      }
    },
    "FactDeclaration": {
      "type": "object",
      "required": ["factId", "keywords"],
      "properties": {
        "factId": { "type": "string" },
        "keywords": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "description": "Keywords expected in successful recall responses"
        },
        "contradictions": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Strings that indicate contradictory recall"
        },
        "category": {
          "type": "string",
          "description": "Optional grouping (character, setting, plot, worldbuilding)"
        }
      }
    }
  }
}
```

### FactEntry (internal)

```javascript
/**
 * Internal representation of an established fact.
 * Built from FactDeclaration in scenario config.
 */
{
  factId: 'fact-marcus-detective',
  keywords: ['Marcus', 'detective'],
  contradictions: ['teacher', 'lawyer', 'doctor'],
  category: 'character',
  establishedInStep: 'step-establish-marcus',   // step ID
  establishedInPhase: 'establish',
  recallStepId: null,    // set when recall step found
  recallResult: null     // 'recalled' | 'forgotten' | 'contradicted' — set during analysis
}
```

### MemoryScenarioResult (extends ScenarioResult)

```javascript
/**
 * Returned from analyzeResults() per scenario.
 * Extends base ScenarioResult with memory-specific fields.
 */
{
  // --- inherited from ScenarioResult ---
  scenarioId: 'memory-basic-3-facts',
  scenarioName: 'Basic 3-Fact Memory Test',
  status: 'passed',       // 'passed' | 'failed' | 'error'
  steps: [ /* StepResult[] */ ],
  assertions: { passed: 8, failed: 1, total: 9 },
  duration: 45000,
  error: null,

  // --- SentinelAgent additions ---
  memory: {
    facts: {
      total: 3,
      recalled: 2,
      forgotten: 1,
      contradicted: 0
    },
    recallRate: 0.667,
    contradictionRate: 0.0,
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    passed: false,           // recallRate >= recallThreshold && contradictionRate <= contradictionThreshold
    factDetails: [
      {
        factId: 'fact-marcus-detective',
        category: 'character',
        result: 'recalled',
        establishedInStep: 'step-establish-marcus',
        recallStepId: 'step-recall-marcus'
      },
      {
        factId: 'fact-setting-noir',
        category: 'setting',
        result: 'forgotten',
        establishedInStep: 'step-establish-setting',
        recallStepId: 'step-recall-setting'
      },
      {
        factId: 'fact-villain-motive',
        category: 'plot',
        result: 'recalled',
        establishedInStep: 'step-establish-villain',
        recallStepId: 'step-recall-villain'
      }
    ],
    byCategory: {
      character: { total: 1, recalled: 1, rate: 1.0 },
      setting: { total: 1, recalled: 0, rate: 0.0 },
      plot: { total: 1, recalled: 1, rate: 1.0 }
    }
  },
  phases: {
    establish: { steps: 3, passed: 3, failed: 0 },
    distance: { steps: 5, passed: 5, failed: 0 },
    recall: { steps: 3, passed: 2, failed: 1 }
  }
}
```

### MemoryReport (extends AgentReport)

```javascript
/**
 * Full agent report aggregating all scenario results.
 * Returned from generateReport().
 */
{
  // --- inherited from AgentReport ---
  agentId: 'sentinel',
  agentType: 'sentinel',
  timestamp: '2026-02-12T10:00:00.000Z',
  duration: 120000,
  scenarios: {
    total: 4,
    passed: 3,
    failed: 1
  },
  scenarioResults: [ /* MemoryScenarioResult[] */ ],

  // --- SentinelAgent additions ---
  memoryHealth: {
    overallRecallRate: 0.917,
    overallContradictionRate: 0.0,
    factsTested: 12,
    factsRecalled: 11,
    factsForgotten: 1,
    factsContradicted: 0,
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    passed: true,    // overall pass: all scenarios meet their thresholds
    weakCategories: ['setting'],   // categories with recall rate < threshold
    strongCategories: ['character', 'plot']
  }
}
```

---

## 3. Method Inventory

### SentinelAgent (extends BaseAgent)

| Method | Override? | Purpose |
|--------|-----------|---------|
| `constructor(config, connector)` | No | Uses BaseAgent constructor. No new instance state needed — factRegistries are per-scenario, built in initialize(). |
| `initialize()` | **Yes** | Calls `super.initialize()`, then builds fact registries from all scenario configs. Validates each scenario has at least one establish step and one recall step. |
| `runTests()` | No | Inherited. Iterates scenarios, calls runScenario(). |
| `runScenario(scenario)` | No | Inherited. Executes steps via executeStep(), enforces timeout. |
| `executeStep(step, stepIndex, scenarioContext)` | No | Inherited. Calls performAction, runs assertions. |
| `evaluateAssertion(assertion, step, stepResult, scenarioContext)` | **Yes** | Switch on 4 custom types + super fallback for built-in types. |
| `analyzeResults()` | **Yes** | Calls `super.analyzeResults()`, then enriches each ScenarioResult with memory metrics: per-fact outcomes, recall rate, contradiction rate, category breakdowns. |
| `generateReport()` | **Yes** | Calls `super.generateReport()`, then adds `memoryHealth` aggregate across all scenarios. |
| `cleanup()` | No | Inherited. |
| `_buildFactRegistries()` | New (private) | Scans all scenario configs, builds factRegistry map per scenario. Called by initialize(). |
| `_buildFactRegistryForScenario(scenario)` | New (private) | Extracts FactEntry objects from establish-phase steps. Links recall steps to facts via recallTarget. Returns Map<factId, FactEntry>. |
| `_classifyFactResult(factEntry, scenarioStepResults)` | New (private) | Given a fact and the scenario's step results, determines if the fact was recalled, forgotten, or contradicted. |
| `_computeRecallMetrics(factRegistry, scenarioStepResults)` | New (private) | Computes recall rate, contradiction rate, per-category breakdown. Returns the `memory` block for MemoryScenarioResult. |
| `_computePhaseMetrics(scenario, scenarioStepResults)` | New (private) | Groups step results by phase, computes per-phase pass/fail counts. Returns the `phases` block. |
| `_computeMemoryHealth(scenarioResults)` | New (private) | Aggregates memory metrics across all scenarios. Returns the `memoryHealth` block for MemoryReport. |
| `_getRecallThreshold(scenario)` | New (private) | Returns `scenario.recallThreshold ?? this.config.recallThreshold ?? 0.85`. |
| `_getContradictionThreshold(scenario)` | New (private) | Returns `scenario.contradictionThreshold ?? this.config.contradictionThreshold ?? 0.0`. |

---

## 4. Assertion Evaluation

### Custom Assertion Types

#### `recall_contains`

Checks if a recall step's response contains expected keywords for a specific fact.

```javascript
case 'recall_contains': {
  const { factId, keywords } = assertion;
  if (!factId || !keywords || !Array.isArray(keywords)) {
    return {
      passed: false,
      message: 'recall_contains requires factId and keywords array'
    };
  }

  // Get the response text from the step result
  const responseText = (stepResult?.result?.text || stepResult?.result || '').toString().toLowerCase();
  const missingKeywords = keywords.filter(kw => !responseText.includes(kw.toLowerCase()));

  return {
    passed: missingKeywords.length === 0,
    message: missingKeywords.length === 0
      ? `All ${keywords.length} keywords found for fact '${factId}'`
      : `Missing keywords for fact '${factId}': ${missingKeywords.join(', ')}`,
    details: {
      factId,
      keywordsExpected: keywords,
      keywordsFound: keywords.filter(kw => responseText.includes(kw.toLowerCase())),
      keywordsMissing: missingKeywords
    }
  };
}
```

#### `recall_accuracy`

Scenario-level assertion — checks cumulative recall rate against threshold. This must be the **last assertion in the last recall step** because it needs all prior recall results to compute accuracy.

```javascript
case 'recall_accuracy': {
  const { threshold } = assertion;
  const effectiveThreshold = threshold ?? this._getRecallThreshold(scenarioContext._scenario);

  // Count facts by checking recall_contains assertions in prior steps
  const recallSteps = (scenarioContext._stepResults || []).filter(
    sr => sr.phase === 'recall'
  );

  let factsRecalled = 0;
  let totalFacts = 0;

  for (const recallStep of recallSteps) {
    const recallAssertions = (recallStep.assertions || []).filter(
      a => a.type === 'recall_contains'
    );
    for (const ra of recallAssertions) {
      totalFacts++;
      if (ra.passed) factsRecalled++;
    }
  }

  // Also count current step's recall_contains assertions (already evaluated)
  const currentRecallAssertions = (scenarioContext._currentStepAssertionResults || []).filter(
    a => a.type === 'recall_contains'
  );
  for (const ra of currentRecallAssertions) {
    totalFacts++;
    if (ra.passed) factsRecalled++;
  }

  const recallRate = totalFacts > 0 ? factsRecalled / totalFacts : 0;

  return {
    passed: recallRate >= effectiveThreshold,
    message: recallRate >= effectiveThreshold
      ? `Recall rate ${(recallRate * 100).toFixed(1)}% meets threshold ${(effectiveThreshold * 100).toFixed(1)}%`
      : `Recall rate ${(recallRate * 100).toFixed(1)}% below threshold ${(effectiveThreshold * 100).toFixed(1)}%`,
    details: {
      recallRate,
      threshold: effectiveThreshold,
      factsRecalled,
      totalFacts
    }
  };
}
```

#### `no_contradiction`

Checks that a recall response doesn't contain any known contradiction strings for a fact.

```javascript
case 'no_contradiction': {
  const { factId, contradictions } = assertion;
  if (!factId || !contradictions || !Array.isArray(contradictions)) {
    return {
      passed: false,
      message: 'no_contradiction requires factId and contradictions array'
    };
  }

  const responseText = (stepResult?.result?.text || stepResult?.result || '').toString().toLowerCase();
  const foundContradictions = contradictions.filter(c => responseText.includes(c.toLowerCase()));

  return {
    passed: foundContradictions.length === 0,
    message: foundContradictions.length === 0
      ? `No contradictions detected for fact '${factId}'`
      : `CONTRADICTION for fact '${factId}': found [${foundContradictions.join(', ')}]`,
    details: {
      factId,
      contradictionsChecked: contradictions,
      contradictionsFound: foundContradictions,
      severity: foundContradictions.length > 0 ? 'critical' : 'none'
    }
  };
}
```

#### `fact_present`

Checks the result of a `validate_memory` connector action for a specific fact.

```javascript
case 'fact_present': {
  const { factId, expected } = assertion;
  if (!factId || !expected) {
    return {
      passed: false,
      message: 'fact_present requires factId and expected string'
    };
  }

  // validate_memory returns { found: boolean, text: string, confidence: number }
  const memResult = stepResult?.result;
  const found = memResult?.found === true;
  const textMatches = found && (memResult?.text || '').toLowerCase().includes(expected.toLowerCase());

  return {
    passed: found && textMatches,
    message: found && textMatches
      ? `Fact '${factId}' present in memory with expected content`
      : found
        ? `Fact '${factId}' found but missing expected content: '${expected}'`
        : `Fact '${factId}' not found in memory`,
    details: {
      factId,
      expected,
      found,
      actualText: memResult?.text || null,
      confidence: memResult?.confidence || null
    }
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
 * Custom assertion types:
 *   recall_contains, recall_accuracy, no_contradiction, fact_present
 *
 * Extends BaseAgent — never overrides runTests() or runScenario().
 */
class SentinelAgent extends BaseAgent {

  // =========================================================
  // Lifecycle
  // =========================================================

  /**
   * Initialize agent: validate config, build fact registries.
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
   * Falls back to BaseAgent for standard types.
   */
  evaluateAssertion(assertion, step, stepResult, scenarioContext) {
    switch (assertion.type) {

      case 'recall_contains': {
        const { factId, keywords } = assertion;
        if (!factId || !keywords || !Array.isArray(keywords)) {
          return {
            type: 'recall_contains',
            passed: false,
            message: 'recall_contains requires factId and keywords array'
          };
        }

        const responseText = this._extractResponseText(stepResult);
        const missingKeywords = keywords.filter(
          kw => !responseText.includes(kw.toLowerCase())
        );

        return {
          type: 'recall_contains',
          passed: missingKeywords.length === 0,
          message: missingKeywords.length === 0
            ? `All ${keywords.length} keywords found for fact '${factId}'`
            : `Missing keywords for fact '${factId}': ${missingKeywords.join(', ')}`,
          details: {
            factId,
            keywordsExpected: keywords,
            keywordsFound: keywords.filter(kw => responseText.includes(kw.toLowerCase())),
            keywordsMissing: missingKeywords
          }
        };
      }

      case 'recall_accuracy': {
        const { threshold } = assertion;
        const scenario = scenarioContext?._scenario;
        const effectiveThreshold = threshold ?? this._getRecallThreshold(scenario);

        const { factsRecalled, totalFacts } = this._countRecallResults(scenarioContext);
        const recallRate = totalFacts > 0 ? factsRecalled / totalFacts : 0;

        return {
          type: 'recall_accuracy',
          passed: recallRate >= effectiveThreshold,
          message: recallRate >= effectiveThreshold
            ? `Recall rate ${(recallRate * 100).toFixed(1)}% meets threshold ${(effectiveThreshold * 100).toFixed(1)}%`
            : `Recall rate ${(recallRate * 100).toFixed(1)}% below threshold ${(effectiveThreshold * 100).toFixed(1)}%`,
          details: {
            recallRate,
            threshold: effectiveThreshold,
            factsRecalled,
            totalFacts
          }
        };
      }

      case 'no_contradiction': {
        const { factId, contradictions } = assertion;
        if (!factId || !contradictions || !Array.isArray(contradictions)) {
          return {
            type: 'no_contradiction',
            passed: false,
            message: 'no_contradiction requires factId and contradictions array'
          };
        }

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
          details: {
            factId,
            contradictionsChecked: contradictions,
            contradictionsFound: foundContradictions,
            severity: foundContradictions.length > 0 ? 'critical' : 'none'
          }
        };
      }

      case 'fact_present': {
        const { factId, expected } = assertion;
        if (!factId || !expected) {
          return {
            type: 'fact_present',
            passed: false,
            message: 'fact_present requires factId and expected string'
          };
        }

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
          details: {
            factId,
            expected,
            found,
            actualText: memResult?.text || null,
            confidence: memResult?.confidence || null
          }
        };
      }

      default:
        return super.evaluateAssertion(assertion, step, stepResult, scenarioContext);
    }
  }

  // =========================================================
  // Analysis (override)
  // =========================================================

  /**
   * Enrich scenario results with memory-specific metrics.
   */
  async analyzeResults() {
    const baseAnalysis = await super.analyzeResults();

    // Enrich each scenario result with memory metrics
    const enrichedResults = baseAnalysis.scenarioResults.map(scenarioResult => {
      const scenario = this.config.scenarios.find(s => s.id === scenarioResult.scenarioId);
      if (!scenario) return scenarioResult;

      const factRegistry = this._factRegistries.get(scenario.id);
      if (!factRegistry || factRegistry.size === 0) return scenarioResult;

      const memory = this._computeRecallMetrics(
        factRegistry,
        scenarioResult.steps,
        scenario
      );

      const phases = this._computePhaseMetrics(scenario, scenarioResult.steps);

      // Override status if memory thresholds not met
      const memoryPassed = memory.passed;
      const effectiveStatus = memoryPassed ? scenarioResult.status : 'failed';

      return {
        ...scenarioResult,
        status: effectiveStatus,
        memory,
        phases
      };
    });

    return {
      ...baseAnalysis,
      scenarioResults: enrichedResults
    };
  }

  // =========================================================
  // Report Generation (override)
  // =========================================================

  /**
   * Generate memory health report aggregating all scenarios.
   */
  async generateReport(analysis) {
    const baseReport = await super.generateReport(analysis);

    const memoryHealth = this._computeMemoryHealth(
      analysis?.scenarioResults || baseReport.scenarioResults
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
   * @returns {Map<string, Map<string, FactEntry>>} scenarioId → factRegistry
   */
  _buildFactRegistries() {
    const registries = new Map();

    for (const scenario of this.config.scenarios) {
      const registry = this._buildFactRegistryForScenario(scenario);
      registries.set(scenario.id, registry);
    }

    return registries;
  }

  /**
   * Build fact registry for a single scenario.
   * Validates that establish and recall steps exist.
   *
   * @param {object} scenario - Scenario config
   * @returns {Map<string, FactEntry>} factId → FactEntry
   * @throws {ConfigurationError} if scenario has facts but no recall steps
   */
  _buildFactRegistryForScenario(scenario) {
    const registry = new Map();

    // Extract facts from establish-phase steps
    for (const step of scenario.steps) {
      if (step.fact) {
        const factEntry = {
          factId: step.fact.factId,
          keywords: step.fact.keywords || [],
          contradictions: step.fact.contradictions || [],
          category: step.fact.category || 'uncategorized',
          establishedInStep: step.id,
          establishedInPhase: step.phase || 'establish',
          recallStepId: null,
          recallResult: null
        };
        registry.set(step.fact.factId, factEntry);
      }
    }

    // Link recall steps to facts
    for (const step of scenario.steps) {
      if (step.recallTarget && registry.has(step.recallTarget)) {
        registry.get(step.recallTarget).recallStepId = step.id;
      }
    }

    // Validate: if facts exist, at least one recall step should exist
    if (registry.size > 0) {
      const hasRecallSteps = scenario.steps.some(
        s => s.phase === 'recall' || s.recallTarget
      );
      if (!hasRecallSteps) {
        throw new ConfigurationError(
          `Scenario '${scenario.id}' has ${registry.size} facts but no recall steps`,
          { scenarioId: scenario.id, factCount: registry.size }
        );
      }
    }

    return registry;
  }

  // =========================================================
  // Private: Metric Computation
  // =========================================================

  /**
   * Classify a single fact as recalled, forgotten, or contradicted.
   *
   * @param {FactEntry} factEntry
   * @param {StepResult[]} stepResults
   * @returns {'recalled'|'forgotten'|'contradicted'|'untested'}
   */
  _classifyFactResult(factEntry, stepResults) {
    if (!factEntry.recallStepId) return 'untested';

    const recallStep = stepResults.find(sr => sr.stepId === factEntry.recallStepId);
    if (!recallStep) return 'untested';

    // Check for contradictions first (higher severity)
    const contradictionAssertions = (recallStep.assertions || []).filter(
      a => a.type === 'no_contradiction' && a.details?.factId === factEntry.factId
    );
    for (const ca of contradictionAssertions) {
      if (!ca.passed) return 'contradicted';
    }

    // Check recall_contains assertions for this fact
    const recallAssertions = (recallStep.assertions || []).filter(
      a => a.type === 'recall_contains' && a.details?.factId === factEntry.factId
    );
    if (recallAssertions.length === 0) {
      // No specific recall assertion — check fact_present
      const factAssertions = (recallStep.assertions || []).filter(
        a => a.type === 'fact_present' && a.details?.factId === factEntry.factId
      );
      if (factAssertions.length > 0) {
        return factAssertions.every(fa => fa.passed) ? 'recalled' : 'forgotten';
      }
      // No assertions targeting this fact in its recall step
      return 'untested';
    }

    return recallAssertions.every(ra => ra.passed) ? 'recalled' : 'forgotten';
  }

  /**
   * Compute recall metrics for a scenario.
   *
   * @param {Map<string, FactEntry>} factRegistry
   * @param {StepResult[]} stepResults
   * @param {object} scenario
   * @returns {object} memory metrics block
   */
  _computeRecallMetrics(factRegistry, stepResults, scenario) {
    const factDetails = [];
    const byCategory = {};
    let recalled = 0;
    let forgotten = 0;
    let contradicted = 0;
    let untested = 0;

    for (const [factId, factEntry] of factRegistry) {
      const result = this._classifyFactResult(factEntry, stepResults);
      factEntry.recallResult = result;

      factDetails.push({
        factId,
        category: factEntry.category,
        result,
        establishedInStep: factEntry.establishedInStep,
        recallStepId: factEntry.recallStepId
      });

      // Tally
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

    const totalTestable = recalled + forgotten + contradicted;
    const recallRate = totalTestable > 0 ? recalled / totalTestable : 0;
    const contradictionRate = totalTestable > 0 ? contradicted / totalTestable : 0;
    const recallThreshold = this._getRecallThreshold(scenario);
    const contradictionThreshold = this._getContradictionThreshold(scenario);

    return {
      facts: {
        total: factRegistry.size,
        recalled,
        forgotten,
        contradicted,
        untested
      },
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
   */
  _computePhaseMetrics(scenario, stepResults) {
    const phases = {};

    for (const step of scenario.steps) {
      const phase = step.phase || 'unknown';
      if (!phases[phase]) {
        phases[phase] = { steps: 0, passed: 0, failed: 0, skipped: 0 };
      }
      phases[phase].steps++;

      const stepResult = stepResults.find(sr => sr.stepId === step.id);
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
   */
  _computeMemoryHealth(scenarioResults) {
    let totalFacts = 0;
    let totalRecalled = 0;
    let totalForgotten = 0;
    let totalContradicted = 0;
    const categoryAgg = {};

    for (const sr of scenarioResults) {
      if (!sr.memory) continue;

      totalFacts += sr.memory.facts.total;
      totalRecalled += sr.memory.facts.recalled;
      totalForgotten += sr.memory.facts.forgotten;
      totalContradicted += sr.memory.facts.contradicted;

      // Aggregate categories
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

    // Identify weak/strong categories
    const weakCategories = [];
    const strongCategories = [];
    for (const [cat, metrics] of Object.entries(categoryAgg)) {
      const rate = metrics.total > 0 ? metrics.recalled / metrics.total : 0;
      if (rate < (this.config.recallThreshold ?? 0.85)) {
        weakCategories.push(cat);
      } else {
        strongCategories.push(cat);
      }
    }

    const allPassed = scenarioResults.every(sr =>
      !sr.memory || sr.memory.passed
    );

    return {
      overallRecallRate,
      overallContradictionRate,
      factsTested: totalFacts,
      factsRecalled: totalRecalled,
      factsForgotten: totalForgotten,
      factsContradicted: totalContradicted,
      recallThreshold: this.config.recallThreshold ?? 0.85,
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
   * Extract lowercase response text from a step result.
   */
  _extractResponseText(stepResult) {
    const raw = stepResult?.result?.text
      || stepResult?.result?.content
      || stepResult?.result
      || '';
    return raw.toString().toLowerCase();
  }

  /**
   * Count recall results from scenarioContext (for recall_accuracy assertion).
   */
  _countRecallResults(scenarioContext) {
    let factsRecalled = 0;
    let totalFacts = 0;

    // Check completed steps
    const priorSteps = scenarioContext?._stepResults || [];
    for (const sr of priorSteps) {
      const recallAssertions = (sr.assertions || []).filter(
        a => a.type === 'recall_contains'
      );
      for (const ra of recallAssertions) {
        totalFacts++;
        if (ra.passed) factsRecalled++;
      }
    }

    // Check current step's already-evaluated assertions
    const currentAssertions = scenarioContext?._currentStepAssertionResults || [];
    for (const ra of currentAssertions) {
      if (ra.type === 'recall_contains') {
        totalFacts++;
        if (ra.passed) factsRecalled++;
      }
    }

    return { factsRecalled, totalFacts };
  }

  /**
   * Get effective recall threshold for a scenario.
   */
  _getRecallThreshold(scenario) {
    return scenario?.recallThreshold ?? this.config.recallThreshold ?? 0.85;
  }

  /**
   * Get effective contradiction threshold for a scenario.
   */
  _getContradictionThreshold(scenario) {
    return scenario?.contradictionThreshold ?? this.config.contradictionThreshold ?? 0.0;
  }
}

module.exports = SentinelAgent;
```

---

## 6. Config Schema: `agents/sentinel/sentinel.config.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SentinelAgentConfig",
  "description": "Configuration schema for SentinelAgent memory persistence testing",
  "type": "object",
  "required": ["agentId", "scenarios"],
  "properties": {
    "agentId": { "type": "string", "const": "sentinel" },
    "agentType": { "type": "string", "const": "sentinel" },
    "description": { "type": "string" },
    "recallThreshold": {
      "type": "number", "minimum": 0, "maximum": 1, "default": 0.85
    },
    "contradictionThreshold": {
      "type": "number", "minimum": 0, "maximum": 1, "default": 0
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
      "required": ["id", "name", "steps"],
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
        }
      }
    },
    "MemoryStep": {
      "type": "object",
      "required": ["id", "action"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "phase": { "type": "string", "enum": ["setup", "establish", "distance", "recall"] },
        "action": { "type": "string" },
        "params": { "type": "object" },
        "fact": { "$ref": "#/definitions/FactDeclaration" },
        "recallTarget": { "type": "string" },
        "assertions": { "type": "array", "items": { "type": "object" } }
      }
    },
    "FactDeclaration": {
      "type": "object",
      "required": ["factId", "keywords"],
      "properties": {
        "factId": { "type": "string" },
        "keywords": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "contradictions": { "type": "array", "items": { "type": "string" }, "default": [] },
        "category": { "type": "string" }
      }
    }
  }
}
```

---

## 7. Example Scenario Config: `apps/brainstormy/scenarios/memory-basic-3-facts.json`

This is an **example** showing the scenario config shape. Real scenario files are authored during orchestrator/staging integration. Unit tests create configs inline.

```json
{
  "id": "memory-basic-3-facts",
  "name": "Basic 3-Fact Memory Test",
  "description": "Establish 3 facts across sessions, create distance, then verify recall",
  "timeout": 300000,
  "recallThreshold": 0.85,
  "steps": [
    {
      "id": "step-setup-project",
      "name": "Create test project",
      "phase": "setup",
      "action": "create_project",
      "params": { "name": "Memory Test {{timestamp}}" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-setup-story",
      "name": "Create test story",
      "phase": "setup",
      "action": "create_story",
      "params": { "name": "Noir Story", "vertical": "novel" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-setup-session-1",
      "name": "Create first session",
      "phase": "setup",
      "action": "create_session",
      "params": { "type": "explore" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-marcus",
      "name": "Establish fact: Marcus is a detective",
      "phase": "establish",
      "action": "send_message",
      "params": { "text": "The protagonist is Marcus, a hardboiled detective working in 1940s Los Angeles." },
      "fact": {
        "factId": "fact-marcus-detective",
        "keywords": ["Marcus", "detective"],
        "contradictions": ["teacher", "lawyer", "doctor", "nurse"],
        "category": "character"
      },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-wait-1",
      "name": "Wait for AI response",
      "phase": "establish",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-setting",
      "name": "Establish fact: noir 1940s LA setting",
      "phase": "establish",
      "action": "send_message",
      "params": { "text": "The story is set in a noir version of 1940s Los Angeles, with rain-slicked streets and jazz clubs." },
      "fact": {
        "factId": "fact-setting-noir",
        "keywords": ["noir", "1940s", "Los Angeles"],
        "contradictions": ["modern day", "future", "fantasy", "medieval"],
        "category": "setting"
      },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-wait-2",
      "name": "Wait for AI response",
      "phase": "establish",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-villain",
      "name": "Establish fact: villain motivated by revenge",
      "phase": "establish",
      "action": "send_message",
      "params": { "text": "The villain is Victor, a former business partner of Marcus's father, driven by revenge for a deal gone wrong decades ago." },
      "fact": {
        "factId": "fact-villain-revenge",
        "keywords": ["Victor", "revenge"],
        "contradictions": ["money", "greed", "power", "love"],
        "category": "plot"
      },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-establish-wait-3",
      "name": "Wait for AI response",
      "phase": "establish",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-session-2",
      "name": "Create intervening session 2",
      "phase": "distance",
      "action": "create_session",
      "params": { "type": "explore" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-filler-1",
      "name": "Send unrelated content in session 2",
      "phase": "distance",
      "action": "send_message",
      "params": { "text": "Let's brainstorm some scene descriptions for the opening chapter." },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-wait-1",
      "name": "Wait for filler response",
      "phase": "distance",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-session-3",
      "name": "Create intervening session 3",
      "phase": "distance",
      "action": "create_session",
      "params": { "type": "explore" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-filler-2",
      "name": "Send more unrelated content in session 3",
      "phase": "distance",
      "action": "send_message",
      "params": { "text": "What kind of pacing would work best for a noir thriller? I'm thinking slow burn." },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-distance-wait-2",
      "name": "Wait for filler response",
      "phase": "distance",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-recall-session",
      "name": "Create recall session",
      "phase": "recall",
      "action": "create_session",
      "params": { "type": "explore" },
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-recall-marcus",
      "name": "Recall: Who is the protagonist?",
      "phase": "recall",
      "action": "send_message",
      "params": { "text": "Who is the protagonist of our story and what do they do?" },
      "recallTarget": "fact-marcus-detective",
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-recall-marcus-check",
      "name": "Verify Marcus recall",
      "phase": "recall",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "recallTarget": "fact-marcus-detective",
      "assertions": [
        {
          "type": "recall_contains",
          "factId": "fact-marcus-detective",
          "keywords": ["Marcus", "detective"]
        },
        {
          "type": "no_contradiction",
          "factId": "fact-marcus-detective",
          "contradictions": ["teacher", "lawyer", "doctor", "nurse"]
        }
      ]
    },
    {
      "id": "step-recall-setting",
      "name": "Recall: What is the setting?",
      "phase": "recall",
      "action": "send_message",
      "params": { "text": "Remind me about the setting we established for this story." },
      "recallTarget": "fact-setting-noir",
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-recall-setting-check",
      "name": "Verify setting recall",
      "phase": "recall",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "recallTarget": "fact-setting-noir",
      "assertions": [
        {
          "type": "recall_contains",
          "factId": "fact-setting-noir",
          "keywords": ["noir", "1940s", "Los Angeles"]
        },
        {
          "type": "no_contradiction",
          "factId": "fact-setting-noir",
          "contradictions": ["modern day", "future", "fantasy", "medieval"]
        }
      ]
    },
    {
      "id": "step-recall-villain",
      "name": "Recall: What motivates the villain?",
      "phase": "recall",
      "action": "send_message",
      "params": { "text": "What is Victor's motivation as our antagonist?" },
      "recallTarget": "fact-villain-revenge",
      "assertions": [
        { "type": "step_succeeded" }
      ]
    },
    {
      "id": "step-recall-villain-check",
      "name": "Verify villain recall + final accuracy",
      "phase": "recall",
      "action": "wait_for_response",
      "params": { "timeout": 60000 },
      "recallTarget": "fact-villain-revenge",
      "assertions": [
        {
          "type": "recall_contains",
          "factId": "fact-villain-revenge",
          "keywords": ["Victor", "revenge"]
        },
        {
          "type": "no_contradiction",
          "factId": "fact-villain-revenge",
          "contradictions": ["money", "greed", "power", "love"]
        },
        {
          "type": "recall_accuracy",
          "threshold": 0.85
        }
      ]
    }
  ]
}
```

---

## 8. Test Specifications

### Test File: `tests/agents/sentinel-agent.test.js`

**Total estimated tests: ~80-90**

### 8.1 Constructor & Initialization (~8 tests)

```javascript
describe('SentinelAgent', () => {
  describe('constructor', () => {
    test('accepts config and connector');
    test('sets agentType to sentinel');
  });

  describe('initialize()', () => {
    test('calls super.initialize()');
    test('builds fact registries from scenario configs');
    test('creates registry entry for each step with fact declaration');
    test('links recall steps to facts via recallTarget');
    test('throws ConfigurationError if scenario has facts but no recall steps');
    test('handles scenario with no facts (empty registry, no error)');
  });
});
```

### 8.2 Fact Registry Building (~12 tests)

```javascript
describe('_buildFactRegistryForScenario()', () => {
  test('extracts factId, keywords, contradictions, category from step.fact');
  test('records establishedInStep as the step ID');
  test('sets recallStepId when recallTarget matches factId');
  test('handles multiple facts in one scenario');
  test('handles fact with no contradictions array (defaults to [])');
  test('handles fact with no category (defaults to uncategorized)');
  test('ignores steps without fact declarations');
  test('ignores steps without phase field (no error)');
  test('throws ConfigurationError: facts exist but no recall steps');
  test('does not throw when zero facts and zero recall steps');
  test('handles duplicate factIds (last one wins)');
  test('links multiple recall steps to different facts in same scenario');
});
```

### 8.3 Custom Assertion: recall_contains (~10 tests)

```javascript
describe('evaluateAssertion() — recall_contains', () => {
  test('passes when all keywords found in response text');
  test('fails when one keyword missing');
  test('fails when all keywords missing');
  test('case-insensitive keyword matching');
  test('returns missing keywords in details');
  test('returns found keywords in details');
  test('fails with message if factId missing');
  test('fails with message if keywords not array');
  test('handles stepResult.result as string (not object)');
  test('handles stepResult.result.text (object with text field)');
});
```

### 8.4 Custom Assertion: recall_accuracy (~8 tests)

```javascript
describe('evaluateAssertion() — recall_accuracy', () => {
  test('passes when recall rate meets threshold');
  test('fails when recall rate below threshold');
  test('uses assertion threshold when provided');
  test('uses scenario recallThreshold when assertion has no threshold');
  test('uses config recallThreshold as final fallback');
  test('defaults to 0.85 when no threshold configured anywhere');
  test('returns recallRate and threshold in details');
  test('handles zero total facts (rate = 0, fails)');
});
```

### 8.5 Custom Assertion: no_contradiction (~8 tests)

```javascript
describe('evaluateAssertion() — no_contradiction', () => {
  test('passes when no contradiction strings found');
  test('fails when contradiction string found in response');
  test('case-insensitive contradiction matching');
  test('reports all found contradictions');
  test('sets severity to critical when contradiction found');
  test('sets severity to none when no contradictions');
  test('fails with message if factId missing');
  test('fails with message if contradictions not array');
});
```

### 8.6 Custom Assertion: fact_present (~8 tests)

```javascript
describe('evaluateAssertion() — fact_present', () => {
  test('passes when validate_memory returns found:true and text matches');
  test('fails when validate_memory returns found:false');
  test('fails when found:true but expected text not in result');
  test('case-insensitive text matching');
  test('includes confidence in details when present');
  test('includes actualText in details');
  test('fails with message if factId missing');
  test('fails with message if expected missing');
});
```

### 8.7 Assertion Fallback (~3 tests)

```javascript
describe('evaluateAssertion() — fallback to BaseAgent', () => {
  test('delegates state_exists to super');
  test('delegates response_contains to super');
  test('delegates unknown type to super (returns failed)');
});
```

### 8.8 Fact Classification (~10 tests)

```javascript
describe('_classifyFactResult()', () => {
  test('returns recalled when recall_contains passes');
  test('returns forgotten when recall_contains fails');
  test('returns contradicted when no_contradiction fails');
  test('contradiction takes priority over forgotten');
  test('returns untested when recallStepId is null');
  test('returns untested when recall step not found in results');
  test('checks fact_present when no recall_contains assertions');
  test('returns recalled from fact_present pass');
  test('returns forgotten from fact_present fail');
  test('returns untested when no matching assertions in recall step');
});
```

### 8.9 analyzeResults() (~10 tests)

```javascript
describe('analyzeResults()', () => {
  test('enriches scenario results with memory metrics');
  test('computes correct recallRate');
  test('computes correct contradictionRate');
  test('groups facts by category with per-category rates');
  test('sets status to failed when recall below threshold');
  test('keeps status passed when recall meets threshold');
  test('computes phase metrics (establish/distance/recall counts)');
  test('handles scenario with no fact registry (returns unenriched)');
  test('handles scenario not found in config (returns unenriched)');
  test('handles mixed: some scenarios pass, some fail');
});
```

### 8.10 generateReport() (~6 tests)

```javascript
describe('generateReport()', () => {
  test('includes memoryHealth in report');
  test('computes overallRecallRate across all scenarios');
  test('computes overallContradictionRate');
  test('identifies weakCategories (below threshold)');
  test('identifies strongCategories (at or above threshold)');
  test('passed is true only when ALL scenarios pass memory thresholds');
});
```

### 8.11 Threshold Cascading (~5 tests)

```javascript
describe('threshold cascading', () => {
  test('scenario threshold overrides config threshold');
  test('config threshold overrides default 0.85');
  test('default 0.85 used when neither scenario nor config set');
  test('contradiction threshold cascading: scenario → config → 0.0');
  test('per-assertion threshold overrides scenario threshold');
});
```

### 8.12 Edge Cases (~5 tests)

```javascript
describe('edge cases', () => {
  test('scenario with zero distance steps (immediate recall)');
  test('scenario with all facts contradicted');
  test('scenario with all facts forgotten');
  test('scenario with facts but no assertions on recall steps');
  test('very long scenario (20+ steps) processes correctly');
});
```

---

## 9. Mock Patterns

### Extended Mock Connector

SentinelAgent tests use the same `createMockConnector()` from `tests/helpers/mock-connector.js`. No new mock connector is needed — the existing mock's `performAction` switch handles all actions SentinelAgent uses (`send_message`, `wait_for_response`, `create_session`, `create_project`, `create_story`, `validate_memory`).

For tests needing specific `validate_memory` or `wait_for_response` return values, override the action in the mock:

```javascript
const { createMockConnector, createAgentConfig } = require('../helpers/mock-connector');

// Override specific actions for memory tests
function createMemoryMockConnector(overrides = {}) {
  const mock = createMockConnector();
  const originalPerformAction = mock.performAction;

  mock.performAction = async (action, params) => {
    if (overrides[action]) {
      return overrides[action](params);
    }
    return originalPerformAction(action, params);
  };

  return mock;
}

// Usage in test:
const connector = createMemoryMockConnector({
  wait_for_response: (params) => ({
    text: 'Marcus is indeed the detective protagonist we established.',
    timestamp: new Date()
  }),
  validate_memory: (params) => ({
    found: true,
    text: 'Marcus is a hardboiled detective in 1940s LA',
    confidence: 0.95
  })
});
```

### Helper: Create Sentinel Config

```javascript
/**
 * Create a minimal SentinelAgent config for testing.
 */
function createSentinelConfig(overrides = {}) {
  return {
    agentId: 'sentinel',
    agentType: 'sentinel',
    recallThreshold: 0.85,
    contradictionThreshold: 0.0,
    scenarios: overrides.scenarios || [createMemoryScenario()],
    ...overrides
  };
}

/**
 * Create a minimal memory scenario for testing.
 */
function createMemoryScenario(overrides = {}) {
  return {
    id: overrides.id || 'test-memory-scenario',
    name: overrides.name || 'Test Memory Scenario',
    timeout: overrides.timeout || 120000,
    recallThreshold: overrides.recallThreshold,
    steps: overrides.steps || [
      {
        id: 'step-setup',
        name: 'Create session',
        phase: 'setup',
        action: 'create_session',
        params: { type: 'explore' },
        assertions: [{ type: 'step_succeeded' }]
      },
      {
        id: 'step-establish-1',
        name: 'Establish fact',
        phase: 'establish',
        action: 'send_message',
        params: { text: 'The protagonist is Marcus, a detective.' },
        fact: {
          factId: 'fact-marcus',
          keywords: ['Marcus', 'detective'],
          contradictions: ['teacher', 'lawyer'],
          category: 'character'
        },
        assertions: [{ type: 'step_succeeded' }]
      },
      {
        id: 'step-establish-wait',
        name: 'Wait for response',
        phase: 'establish',
        action: 'wait_for_response',
        params: { timeout: 30000 },
        assertions: [{ type: 'step_succeeded' }]
      },
      {
        id: 'step-recall-1',
        name: 'Recall fact',
        phase: 'recall',
        action: 'wait_for_response',
        params: { timeout: 30000 },
        recallTarget: 'fact-marcus',
        assertions: [
          {
            type: 'recall_contains',
            factId: 'fact-marcus',
            keywords: ['Marcus', 'detective']
          },
          {
            type: 'no_contradiction',
            factId: 'fact-marcus',
            contradictions: ['teacher', 'lawyer']
          }
        ]
      }
    ]
  };
}

/**
 * Create a multi-fact scenario for recall accuracy testing.
 */
function createMultiFactScenario({ factCount = 3, recallThreshold = 0.85 } = {}) {
  const steps = [
    {
      id: 'step-setup',
      name: 'Create session',
      phase: 'setup',
      action: 'create_session',
      params: { type: 'explore' },
      assertions: [{ type: 'step_succeeded' }]
    }
  ];

  const facts = [];
  for (let i = 0; i < factCount; i++) {
    const factId = `fact-${i}`;
    facts.push(factId);

    steps.push({
      id: `step-establish-${i}`,
      name: `Establish fact ${i}`,
      phase: 'establish',
      action: 'send_message',
      params: { text: `Fact ${i} content` },
      fact: {
        factId,
        keywords: [`keyword-${i}`],
        contradictions: [`contra-${i}`],
        category: i % 2 === 0 ? 'character' : 'plot'
      },
      assertions: [{ type: 'step_succeeded' }]
    });

    steps.push({
      id: `step-establish-wait-${i}`,
      phase: 'establish',
      action: 'wait_for_response',
      params: { timeout: 30000 },
      assertions: [{ type: 'step_succeeded' }]
    });
  }

  // Distance steps
  steps.push({
    id: 'step-distance-1',
    phase: 'distance',
    action: 'create_session',
    params: { type: 'explore' },
    assertions: [{ type: 'step_succeeded' }]
  });

  // Recall steps
  for (let i = 0; i < factCount; i++) {
    steps.push({
      id: `step-recall-${i}`,
      name: `Recall fact ${i}`,
      phase: 'recall',
      action: 'wait_for_response',
      params: { timeout: 30000 },
      recallTarget: `fact-${i}`,
      assertions: [
        {
          type: 'recall_contains',
          factId: `fact-${i}`,
          keywords: [`keyword-${i}`]
        },
        {
          type: 'no_contradiction',
          factId: `fact-${i}`,
          contradictions: [`contra-${i}`]
        }
      ]
    });
  }

  // Final accuracy check on last step
  steps[steps.length - 1].assertions.push({
    type: 'recall_accuracy',
    threshold: recallThreshold
  });

  return {
    id: `multi-fact-${factCount}`,
    name: `${factCount}-Fact Memory Test`,
    recallThreshold,
    steps
  };
}
```

These helpers go in `tests/helpers/mock-connector.js` (extend existing file with new exports) or in a new `tests/helpers/sentinel-helpers.js`.

**Decision: Create `tests/helpers/sentinel-helpers.js`** — keeps concerns separate. The mock-connector file stays generic; sentinel helpers are agent-specific.

---

## 10. Files to Create

| # | File | Lines (est.) | Purpose |
|---|------|-------------|---------|
| 1 | `agents/sentinel/agent.js` | ~320 | SentinelAgent class |
| 2 | `agents/sentinel/sentinel.config.schema.json` | ~75 | Config validation schema |
| 3 | `tests/helpers/sentinel-helpers.js` | ~180 | createSentinelConfig, createMemoryScenario, createMultiFactScenario, createMemoryMockConnector |
| 4 | `tests/agents/sentinel-agent.test.js` | ~650 | ~85 tests |

**Total: ~1,225 lines across 4 files, ~85 new tests bringing project total to ~624.**

Note: Brainstormy-specific scenario JSON files (like the example in Section 7) are deferred to orchestrator/staging integration in Day 5 / Week 3. Unit tests create configs inline via helpers.

---

## 11. Implementation Steps for Claude Code

**Implement SentinelAgent from spec. Follow `docs/sentinel-agent-implementation-spec.md` Section 11, all 5 steps.**

Read the full spec first, then execute each step in order:

1. **Step 1:** Create `tests/helpers/sentinel-helpers.js` — exports `createSentinelConfig`, `createMemoryScenario`, `createMultiFactScenario`, `createMemoryMockConnector` per Section 9.

2. **Step 2:** Create `agents/sentinel/sentinel.config.schema.json` — per Section 6.

3. **Step 3:** Create `agents/sentinel/agent.js` — full implementation per Section 5. SentinelAgent extends BaseAgent with 3 overrides (`initialize`, `evaluateAssertion`, `analyzeResults`, `generateReport`) and 9 private methods.

4. **Step 4:** Create `tests/agents/sentinel-agent.test.js` — per Section 8. ~85 tests covering all 12 test groups.

5. **Step 5:** Run `npm test` — all 539 existing tests + all new sentinel tests must pass. Create `docs/sentinel-agent-implementation-log.md` with test counts per suite.

**Key rules:**
- Section 5 code is authoritative — implement exactly as written
- SentinelAgent NEVER imports connector classes — uses mock connector from helpers
- Custom assertion types use switch + `super.evaluateAssertion()` fallback — same pattern as HealerAgent
- The `recall_accuracy` assertion depends on prior step results via `scenarioContext._stepResults` and `scenarioContext._currentStepAssertionResults` — verify BaseAgent populates these during step execution
- Fact registries are built during `initialize()`, not during `analyzeResults()` — analyze uses the pre-built registries
- `_classifyFactResult` checks `no_contradiction` before `recall_contains` — contradiction is higher severity
- The `AssertionError` spelling is intentional (avoids Node.js collision) — already established in agents/errors.js

Commit each step separately with descriptive messages.

---

## 12. Claude Code Implementation Notes

1. **SentinelAgent is a thin layer on top of BaseAgent.** The 3 overrides + 9 private methods add memory-specific analysis. All scenario execution, step running, timeout enforcement, and base assertion evaluation are inherited. Don't reimplement anything in BaseAgent.

2. **The phase field is a scenario config concern, not agent logic.** SentinelAgent reads `step.phase` from config during `_computePhaseMetrics()` and `_buildFactRegistryForScenario()`. It doesn't enforce phase ordering — that's the scenario author's responsibility.

3. **Fact registry is built from config, not from runtime state.** The agent doesn't parse message content or AI responses to discover facts. It reads the `fact` field on scenario steps. This is declarative — the scenario author declares what facts were established and what keywords prove recall.

4. **`scenarioContext` must carry step results for `recall_accuracy`.** The `recall_accuracy` assertion type needs to see all prior recall assertion results. Verify that BaseAgent's `runScenario()` → `executeStep()` pipeline stores step results on `scenarioContext._stepResults` and current step assertions on `scenarioContext._currentStepAssertionResults`. If BaseAgent doesn't populate these, you'll need to add that plumbing — flag it in the implementation log.

5. **`_classifyFactResult()` is the core analysis logic.** It's called once per fact during `analyzeResults()`. It searches the step results for the fact's recall step, then checks assertions in priority order: `no_contradiction` first (contradiction is critical), then `recall_contains`, then `fact_present` as fallback.

6. **Threshold cascading order:** assertion → scenario → config → 0.85 (recall) / 0.0 (contradiction). Each level can omit the value to inherit from the next level. The `_getRecallThreshold()` and `_getContradictionThreshold()` helpers encode this cascade.

7. **Memory metrics are additive to base analysis.** `analyzeResults()` calls `super.analyzeResults()` first, then enriches each scenario result. The base analysis structure is preserved — memory fields are added alongside existing fields. Same for `generateReport()`.

8. **`createMemoryMockConnector` wraps the standard mock.** It delegates to the base mock for unoverridden actions. Tests control `wait_for_response` return values to simulate recalled vs. forgotten facts — the mock returns different text containing or missing the expected keywords.

---

## 13. What Comes Next

After SentinelAgent is built and tested:

- **Day 4:** LibrarianAgent — Citation accuracy and Bible verification. Extends BaseAgent with content validation scenarios. Custom assertions for citation grounding (`citation_valid`, `citation_supports_claim`, `no_hallucination`, `content_complete`).
- **Day 5:** Test Orchestrator — Coordinates agents, manages lifecycle, aggregates results. Creates connector via ConnectorFactory, passes to each agent. Sequential execution with shared connector.
