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
 *   establish -> distance -> recall
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
   * @returns {Map<string, Map<string, FactEntry>>} scenarioId -> factRegistry
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
   * @returns {object} phase -> { steps, passed, failed, skipped }
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
   * Cascade: scenario -> config -> 0.85
   */
  _getRecallThreshold(scenario) {
    return scenario?.recallThreshold ?? this.config.recallThreshold ?? 0.85;
  }

  /**
   * Get effective contradiction threshold for a scenario.
   * Cascade: scenario -> config -> 0.0
   */
  _getContradictionThreshold(scenario) {
    return scenario?.contradictionThreshold ?? this.config.contradictionThreshold ?? 0.0;
  }
}

module.exports = SentinelAgent;
