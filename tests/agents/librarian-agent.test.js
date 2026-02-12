'use strict';

const LibrarianAgent = require('../../agents/librarian/agent');
const BaseAgent = require('../../agents/base-agent');
const { ConfigurationError } = require('../../agents/errors');
const { createMockConnector } = require('../helpers/mock-connector');
const {
  createReportCitationScenario,
  createBibleCompletenessScenario,
  createHallucinationDetectionScenario
} = require('../helpers/librarian-helpers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLibrarianConfig(overrides = {}) {
  return {
    id: 'librarian',
    scenarios: [
      createReportCitationScenario({
        reportType: 'character_profile',
        reportParams: { character_name: 'Sarah' },
        setupMessages: [{ text: 'Let\'s create a character named Sarah who is a marine biologist.' }]
      })
    ],
    thresholds: {},
    ...overrides
  };
}

function createScenarioContext(overrides = {}) {
  return {
    scenarioId: 'test-scenario',
    stepResults: [],
    lastStepResult: null,
    ...overrides
  };
}

function contextWithReportAt(stepIndex, reportContent, citationMap = {}) {
  const stepResults = new Array(stepIndex + 1).fill(null).map(() => ({
    status: 'passed',
    result: {}
  }));
  stepResults[stepIndex] = {
    status: 'passed',
    result: {
      id: 'report-123',
      content: reportContent,
      citation_map: citationMap,
      report_type: 'character_profile',
      title: 'Test Report'
    }
  };
  return createScenarioContext({ stepResults });
}

function contextWithBibleAt(stepIndex, sections) {
  const stepResults = new Array(stepIndex + 1).fill(null).map(() => ({
    status: 'passed',
    result: {}
  }));
  stepResults[stepIndex] = {
    status: 'passed',
    result: {
      id: 'bible-456',
      sections,
      template_key: 'standard',
      version: 1
    }
  };
  return createScenarioContext({ stepResults });
}

function contextWithFailedStepAt(stepIndex) {
  const stepResults = new Array(stepIndex + 1).fill(null).map(() => ({
    status: 'passed',
    result: {}
  }));
  stepResults[stepIndex] = { status: 'failed', result: null, error: 'Step failed' };
  return createScenarioContext({ stepResults });
}

function makeTestRunResult(overrides = {}) {
  return {
    agentId: 'librarian',
    scenarios: [],
    summary: { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0 },
    durationMs: 1000,
    ...overrides
  };
}

function makeVerifyCitationResult(overrides = {}) {
  return {
    valid: true,
    source_exists: true,
    supports_claim: true,
    source_content: 'User: Let\'s make Sarah a marine biologist...',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Block 1: Initialization
// ---------------------------------------------------------------------------

describe('LibrarianAgent - Initialization', () => {
  test('is an instance of BaseAgent', () => {
    const agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
    expect(agent).toBeInstanceOf(BaseAgent);
  });

  test('does not override constructor (uses BaseAgent constructor directly)', () => {
    expect(LibrarianAgent.prototype.constructor).not.toBe(BaseAgent.prototype.constructor);
    // But it doesn't define its OWN constructor body — it inherits BaseAgent's
    const config = createLibrarianConfig();
    const connector = createMockConnector();
    const agent = new LibrarianAgent(config, connector);
    expect(agent.config).toBe(config);
    expect(agent.connector).toBe(connector);
  });

  test('initialize() calls super.initialize()', async () => {
    const connector = createMockConnector();
    const config = createLibrarianConfig();
    const agent = new LibrarianAgent(config, connector);
    const superSpy = jest.spyOn(BaseAgent.prototype, 'initialize');
    await agent.initialize();
    expect(superSpy).toHaveBeenCalled();
    superSpy.mockRestore();
  });

  test('initialize() succeeds with valid scenarios', async () => {
    const agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
    await expect(agent.initialize()).resolves.toBeUndefined();
  });

  test('initialize() throws ConfigurationError when no scenarios', async () => {
    const config = createLibrarianConfig({ scenarios: [] });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
  });

  test('initialize() succeeds with default thresholds (none in config)', async () => {
    const config = createLibrarianConfig();
    delete config.thresholds;
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).resolves.toBeUndefined();
  });

  test('initialize() throws ConfigurationError for citationAccuracy < 0', async () => {
    const config = createLibrarianConfig({ thresholds: { citationAccuracy: -0.1 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
    await expect(agent.initialize()).rejects.toThrow('citationAccuracy threshold must be between 0 and 1');
  });

  test('initialize() throws ConfigurationError for citationAccuracy > 1', async () => {
    const config = createLibrarianConfig({ thresholds: { citationAccuracy: 1.5 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
  });

  test('initialize() throws ConfigurationError for hallucinationRate < 0', async () => {
    const config = createLibrarianConfig({ thresholds: { hallucinationRate: -0.01 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
    await expect(agent.initialize()).rejects.toThrow('hallucinationRate threshold must be between 0 and 1');
  });

  test('initialize() throws ConfigurationError for hallucinationRate > 1', async () => {
    const config = createLibrarianConfig({ thresholds: { hallucinationRate: 2.0 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
  });

  test('initialize() throws ConfigurationError for sectionCompleteness < 0', async () => {
    const config = createLibrarianConfig({ thresholds: { sectionCompleteness: -1 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
    await expect(agent.initialize()).rejects.toThrow('sectionCompleteness threshold must be between 0 and 1');
  });

  test('initialize() throws ConfigurationError for sectionCompleteness > 1', async () => {
    const config = createLibrarianConfig({ thresholds: { sectionCompleteness: 1.1 } });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).rejects.toThrow(ConfigurationError);
  });

  test('initialize() accepts valid thresholds (0 to 1)', async () => {
    const config = createLibrarianConfig({
      thresholds: { citationAccuracy: 0.0, hallucinationRate: 1.0, sectionCompleteness: 0.5 }
    });
    const agent = new LibrarianAgent(config, createMockConnector());
    await expect(agent.initialize()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Block 2: evaluateAssertion Dispatch
// ---------------------------------------------------------------------------

describe('LibrarianAgent - evaluateAssertion dispatch', () => {
  let agent, connector;

  beforeEach(() => {
    connector = createMockConnector({
      actionResults: {
        verify_citation: makeVerifyCitationResult()
      }
    });
    agent = new LibrarianAgent(createLibrarianConfig(), connector);
  });

  test('routes citation_accuracy to _evaluateCitationAccuracy', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345]. She studies marine life.');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.90 },
      ctx
    );
    expect(result.type).toBe('citation_accuracy');
    expect(result).toHaveProperty('actual.accuracy');
  });

  test('routes no_unsupported_claims to _evaluateNoUnsupportedClaims', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345]. She studies marine life.');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.05 },
      ctx
    );
    expect(result.type).toBe('no_unsupported_claims');
    expect(result).toHaveProperty('actual.totalClaims');
  });

  test('routes all_sections_populated to _evaluateAllSectionsPopulated', async () => {
    const ctx = contextWithBibleAt(0, { overview: 'Content here', themes: 'Theme content' });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.type).toBe('all_sections_populated');
    expect(result).toHaveProperty('actual.totalSections');
  });

  test('routes citation_supports_claim to _evaluateCitationSupportsClaim', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'Sarah is a biologist' },
      createScenarioContext()
    );
    expect(result.type).toBe('citation_supports_claim');
    expect(result).toHaveProperty('actual.supportsClaim');
  });

  test('falls through to super.evaluateAssertion for built-in types (state_exists)', async () => {
    connector.getState.mockReturnValue('some_value');
    const result = await agent.evaluateAssertion(
      { type: 'state_exists', key: 'some_key' },
      createScenarioContext()
    );
    expect(result.type).toBe('state_exists');
    expect(result.passed).toBe(true);
  });

  test('falls through to super.evaluateAssertion for unknown types', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'totally_unknown_type' },
      createScenarioContext()
    );
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/unknown|unsupported/i);
  });
});

// ---------------------------------------------------------------------------
// Block 3: citation_accuracy Assertion
// ---------------------------------------------------------------------------

describe('LibrarianAgent - citation_accuracy assertion', () => {
  let agent, connector;

  beforeEach(() => {
    connector = createMockConnector({
      actionResults: {
        verify_citation: makeVerifyCitationResult()
      }
    });
    agent = new LibrarianAgent(createLibrarianConfig(), connector);
  });

  test('returns passed when accuracy meets threshold', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345]. She studies coral [def12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.50 },
      ctx
    );
    expect(result.passed).toBe(true);
  });

  test('returns failed when accuracy below threshold', async () => {
    connector.performAction.mockImplementation(async (action, params) => {
      if (action === 'verify_citation') {
        return { valid: false, source_exists: false, supports_claim: false, source_content: null };
      }
      return {};
    });
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.90 },
      ctx
    );
    expect(result.passed).toBe(false);
  });

  test('returns result object with { type, passed, message, expected, actual, durationMs }', async () => {
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result).toHaveProperty('type', 'citation_accuracy');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('expected');
    expect(result).toHaveProperty('actual');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.durationMs).toBe('number');
  });

  test('actual contains accuracy, total, valid, invalid, details', async () => {
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.actual).toHaveProperty('accuracy');
    expect(result.actual).toHaveProperty('total');
    expect(result.actual).toHaveProperty('valid');
    expect(result.actual).toHaveProperty('invalid');
    expect(result.actual).toHaveProperty('details');
  });

  test('details contain per-citation { citationId, claimText, sourceExists, supportsClaim, valid }', async () => {
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.actual.details.length).toBe(1);
    const detail = result.actual.details[0];
    expect(detail).toHaveProperty('citationId', 'abc12345');
    expect(detail).toHaveProperty('claimText');
    expect(detail).toHaveProperty('sourceExists');
    expect(detail).toHaveProperty('supportsClaim');
    expect(detail).toHaveProperty('valid');
  });

  test('calls connector.performAction(verify_citation) for each extracted citation', async () => {
    const ctx = contextWithReportAt(0, 'Fact one [abc12345]. Fact two [def12345].');
    await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    const verifyCalls = connector.performAction.mock.calls.filter(c => c[0] === 'verify_citation');
    expect(verifyCalls.length).toBe(2);
  });

  test('passes citationId and claimText to verify_citation', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345].');
    await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    const verifyCalls = connector.performAction.mock.calls.filter(c => c[0] === 'verify_citation');
    expect(verifyCalls[0][1]).toHaveProperty('citationId', 'abc12345');
    expect(verifyCalls[0][1]).toHaveProperty('claimText');
    expect(typeof verifyCalls[0][1].claimText).toBe('string');
  });

  test('defaults minAccuracy to 0.90 when not specified', async () => {
    // 1 valid citation out of 1 = 100% >= 90% default → passed
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.expected).toContain('90.0%');
  });

  test('respects custom minAccuracy from assertion', async () => {
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.50 },
      ctx
    );
    expect(result.expected).toContain('50.0%');
  });

  test('returns failed with message when step result is missing', async () => {
    const ctx = createScenarioContext({ stepResults: [] });
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 5 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('step 5');
    expect(result.message).toContain('missing');
  });

  test('returns failed with message when step result status is failed', async () => {
    const ctx = contextWithFailedStepAt(0);
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('failed');
  });

  test('returns failed when no citations found in content', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist. No citations here.');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('No citations');
  });

  test('handles empty content string', async () => {
    const ctx = contextWithReportAt(0, '');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.total).toBe(0);
  });

  test('handles connector.performAction throwing error (marks citation invalid)', async () => {
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') throw new Error('Network error');
      return {};
    });
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.50 },
      ctx
    );
    expect(result.actual.details[0].valid).toBe(false);
    expect(result.actual.details[0].sourceExists).toBe(false);
  });

  test('handles mix of valid and invalid citations', async () => {
    let callCount = 0;
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') {
        callCount++;
        if (callCount === 1) return makeVerifyCitationResult();
        return { valid: false, source_exists: false, supports_claim: false, source_content: null };
      }
      return {};
    });
    const ctx = contextWithReportAt(0, 'Fact [abc12345]. Lie [def12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.90 },
      ctx
    );
    expect(result.actual.valid).toBe(1);
    expect(result.actual.invalid).toBe(1);
    expect(result.actual.accuracy).toBe(0.5);
    expect(result.passed).toBe(false);
  });

  test('computes accuracy as valid / total', async () => {
    const ctx = contextWithReportAt(0, 'Fact one [abc12345]. Fact two [def12345]. Fact three [aaa11111].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(result.actual.accuracy).toBe(result.actual.valid / result.actual.total);
  });

  test('accuracy is 0 when all citations invalid', async () => {
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') {
        return { valid: false, source_exists: false, supports_claim: false, source_content: null };
      }
      return {};
    });
    const ctx = contextWithReportAt(0, 'Lie [abc12345]. Lie [def12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0, minAccuracy: 0.01 },
      ctx
    );
    expect(result.actual.accuracy).toBe(0);
    expect(result.passed).toBe(false);
  });

  test('includes durationMs in result', async () => {
    const ctx = contextWithReportAt(0, 'She studies coral [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'citation_accuracy', reportStepIndex: 0 },
      ctx
    );
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Block 4: no_unsupported_claims Assertion
// ---------------------------------------------------------------------------

describe('LibrarianAgent - no_unsupported_claims assertion', () => {
  let agent;

  beforeEach(() => {
    agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
  });

  test('returns passed when all claims have citations', async () => {
    const content = 'Sarah is a biologist [abc12345]. She studies coral [def12345].';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.05 },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.actual.unsupportedClaims).toBe(0);
  });

  test('returns passed when unsupported rate within threshold', async () => {
    // 2 claims: one cited, one not → 50% unsupported, threshold 60%
    const content = 'Sarah is a biologist [abc12345]. She grew up in Portland and loved the ocean.';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.60 },
      ctx
    );
    expect(result.passed).toBe(true);
  });

  test('returns failed when unsupported rate exceeds threshold', async () => {
    const content = 'Sarah is a biologist. She grew up in Portland. She has a dog named Max.';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.05 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.rate).toBeGreaterThan(0.05);
  });

  test('returns result object with correct shape', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result).toHaveProperty('type', 'no_unsupported_claims');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('expected');
    expect(result).toHaveProperty('actual');
    expect(result).toHaveProperty('durationMs');
  });

  test('actual contains rate, totalClaims, unsupportedClaims, examples', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345]. She grew up in Portland.');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result.actual).toHaveProperty('rate');
    expect(result.actual).toHaveProperty('totalClaims');
    expect(result.actual).toHaveProperty('unsupportedClaims');
    expect(result.actual).toHaveProperty('examples');
  });

  test('examples contains first 3 uncited claims (truncated to 80 chars)', async () => {
    const longClaim = 'A'.repeat(100) + '.';
    const content = `${longClaim} Another uncited claim here about someone. Yet another claim without citations. Fourth one too.`;
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.01 },
      ctx
    );
    expect(result.actual.examples.length).toBeLessThanOrEqual(3);
    for (const ex of result.actual.examples) {
      expect(ex.length).toBeLessThanOrEqual(80);
    }
  });

  test('defaults maxUnsupportedRate to 0.05', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result.expected).toContain('5.0%');
  });

  test('respects custom maxUnsupportedRate', async () => {
    const ctx = contextWithReportAt(0, 'Sarah is a biologist [abc12345].');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.10 },
      ctx
    );
    expect(result.expected).toContain('10.0%');
  });

  test('returns passed for content with 0 claims', async () => {
    const ctx = contextWithReportAt(0, '# Header\n\n---\n\n**Bold Title**');
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.actual.totalClaims).toBe(0);
  });

  test('treats fully uncited content as 100% unsupported', async () => {
    const content = 'Sarah is a biologist. She studies coral reefs. She lives in Hawaii.';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0, maxUnsupportedRate: 0.05 },
      ctx
    );
    expect(result.actual.rate).toBe(1.0);
    expect(result.passed).toBe(false);
  });

  test('ignores headers when counting claims', async () => {
    const content = '# Character Profile\n\nSarah is a biologist [abc12345].';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    // Header should not be counted as a claim
    expect(result.actual.totalClaims).toBe(1);
  });

  test('ignores "*Not yet developed*" markers', async () => {
    const content = '*Not yet developed*\n\nSarah is a biologist [abc12345].';
    const ctx = contextWithReportAt(0, content);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result.actual.totalClaims).toBe(1);
  });

  test('returns failed when step result is missing', async () => {
    const ctx = createScenarioContext({ stepResults: [] });
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 3 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('step 3');
  });

  test('returns failed when step result status is failed', async () => {
    const ctx = contextWithFailedStepAt(0);
    const result = await agent.evaluateAssertion(
      { type: 'no_unsupported_claims', reportStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('failed');
  });
});

// ---------------------------------------------------------------------------
// Block 5: all_sections_populated Assertion
// ---------------------------------------------------------------------------

describe('LibrarianAgent - all_sections_populated assertion', () => {
  let agent;

  beforeEach(() => {
    agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
  });

  test('returns passed when all sections have content', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Story overview content here.',
      characters: 'Character details here.',
      themes: 'Theme discussion here.'
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.actual.emptySections).toEqual([]);
  });

  test('returns failed when a section is empty string', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content here.',
      characters: '',
      themes: 'Theme content.'
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.emptySections).toContain('characters');
  });

  test('returns failed when a section is "*Not yet developed*"', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      themes: '*Not yet developed*'
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.emptySections).toContain('themes');
  });

  test('returns failed when a section is null', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      themes: null
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.emptySections).toContain('themes');
  });

  test('returns failed when a section is whitespace only', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      themes: '   \n  '
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.actual.emptySections).toContain('themes');
  });

  test('respects allowEmpty for specific sections', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      themes: '',
      appendix: ''
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0, allowEmpty: ['themes', 'appendix'] },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.actual.allowedEmpty).toEqual(['themes', 'appendix']);
  });

  test('actual contains completeness, totalSections, populatedSections, emptySections', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      characters: 'Characters.',
      themes: ''
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.actual).toHaveProperty('completeness');
    expect(result.actual).toHaveProperty('totalSections', 3);
    expect(result.actual).toHaveProperty('populatedSections', 2);
    expect(result.actual).toHaveProperty('emptySections');
    expect(result.actual.emptySections).toEqual(['themes']);
  });

  test('returns failed when step result is missing', async () => {
    const ctx = createScenarioContext({ stepResults: [] });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 2 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('step 2');
  });

  test('returns failed when step result has no sections object', async () => {
    const ctx = createScenarioContext({
      stepResults: [{ status: 'passed', result: { id: 'bible-1' } }]
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('No sections');
  });

  test('handles single section (passes when populated)', async () => {
    const ctx = contextWithBibleAt(0, { overview: 'Some content.' });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.passed).toBe(true);
    expect(result.actual.totalSections).toBe(1);
  });

  test('lists all empty section keys in message', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      characters: '',
      themes: '',
      setting: ''
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.message).toContain('characters');
    expect(result.message).toContain('themes');
    expect(result.message).toContain('setting');
  });

  test('completeness is populated / total', async () => {
    const ctx = contextWithBibleAt(0, {
      overview: 'Content.',
      characters: 'Content.',
      themes: '',
      setting: ''
    });
    const result = await agent.evaluateAssertion(
      { type: 'all_sections_populated', bibleStepIndex: 0 },
      ctx
    );
    expect(result.actual.completeness).toBe(2 / 4);
  });
});

// ---------------------------------------------------------------------------
// Block 6: citation_supports_claim Assertion
// ---------------------------------------------------------------------------

describe('LibrarianAgent - citation_supports_claim assertion', () => {
  let agent, connector;

  beforeEach(() => {
    connector = createMockConnector({
      actionResults: {
        verify_citation: makeVerifyCitationResult()
      }
    });
    agent = new LibrarianAgent(createLibrarianConfig(), connector);
  });

  test('returns passed when supports_claim is true', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'Sarah is a biologist' },
      createScenarioContext()
    );
    expect(result.passed).toBe(true);
    expect(result.actual.supportsClaim).toBe(true);
  });

  test('returns failed when supports_claim is false', async () => {
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') {
        return { valid: false, source_exists: true, supports_claim: false, source_content: 'Unrelated content' };
      }
      return {};
    });
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'Sarah is a biologist' },
      createScenarioContext()
    );
    expect(result.passed).toBe(false);
    expect(result.actual.supportsClaim).toBe(false);
  });

  test('returns failed when citationId missing', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', claimText: 'Sarah is a biologist' },
      createScenarioContext()
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires citationId');
  });

  test('returns failed when claimText missing', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345' },
      createScenarioContext()
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('claimText');
  });

  test('defaults strictness to normal', async () => {
    await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim' },
      createScenarioContext()
    );
    const verifyCalls = connector.performAction.mock.calls.filter(c => c[0] === 'verify_citation');
    expect(verifyCalls[0][1].strictness).toBe('normal');
  });

  test('passes strictness to connector', async () => {
    await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim', strictness: 'strict' },
      createScenarioContext()
    );
    const verifyCalls = connector.performAction.mock.calls.filter(c => c[0] === 'verify_citation');
    expect(verifyCalls[0][1].strictness).toBe('strict');
  });

  test('returns failed on connector error with error message', async () => {
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') throw new Error('Connection refused');
      return {};
    });
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim' },
      createScenarioContext()
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Connection refused');
  });

  test('actual includes sourceContent preview (truncated to 100 chars)', async () => {
    const longContent = 'X'.repeat(200);
    connector.performAction.mockImplementation(async (action) => {
      if (action === 'verify_citation') {
        return { valid: true, source_exists: true, supports_claim: true, source_content: longContent };
      }
      return {};
    });
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim' },
      createScenarioContext()
    );
    expect(result.actual.sourceContent.length).toBeLessThanOrEqual(100);
  });

  test('actual includes sourceExists and supportsClaim booleans', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim' },
      createScenarioContext()
    );
    expect(typeof result.actual.sourceExists).toBe('boolean');
    expect(typeof result.actual.supportsClaim).toBe('boolean');
  });

  test('includes durationMs in result', async () => {
    const result = await agent.evaluateAssertion(
      { type: 'citation_supports_claim', citationId: 'abc12345', claimText: 'A claim' },
      createScenarioContext()
    );
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Block 7: Citation Extraction (_extractCitations)
// ---------------------------------------------------------------------------

describe('LibrarianAgent - _extractCitations', () => {
  let agent;

  beforeEach(() => {
    agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
  });

  test('extracts single citation [abc12345]', () => {
    const result = agent._extractCitations('She is a biologist [abc12345].');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('abc12345');
  });

  test('extracts multiple citations from content', () => {
    const result = agent._extractCitations('Fact one [abc12345]. Fact two [def67890]. Fact three [11223344].');
    expect(result.length).toBe(3);
    expect(result[0].id).toBe('abc12345');
    expect(result[1].id).toBe('def67890');
    expect(result[2].id).toBe('11223344');
  });

  test('returns empty array for content with no citations', () => {
    const result = agent._extractCitations('No citations in this content at all.');
    expect(result).toEqual([]);
  });

  test('returns empty array for null/undefined content', () => {
    expect(agent._extractCitations(null)).toEqual([]);
    expect(agent._extractCitations(undefined)).toEqual([]);
    expect(agent._extractCitations('')).toEqual([]);
  });

  test('handles citations at start of content', () => {
    const result = agent._extractCitations('[abc12345] starts the sentence.');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('abc12345');
  });

  test('handles citations at end of content', () => {
    const result = agent._extractCitations('Ends with citation [abc12345]');
    expect(result.length).toBe(1);
  });

  test('extracts claim text surrounding each citation', () => {
    const result = agent._extractCitations('Sarah is a marine biologist [abc12345]. She studies coral reefs.');
    expect(result[0].claimText).toBeTruthy();
    expect(typeof result[0].claimText).toBe('string');
  });

  test('is case-insensitive (handles [ABC12345])', () => {
    const result = agent._extractCitations('Uppercase citation [ABC12345].');
    expect(result.length).toBe(1);
  });

  test('lowercases extracted IDs', () => {
    const result = agent._extractCitations('Mixed case [AbCdEf12].');
    expect(result[0].id).toBe('abcdef12');
  });

  test('does not match non-hex IDs like [xyz12345]', () => {
    const result = agent._extractCitations('Invalid [xyz12345] should not match.');
    expect(result.length).toBe(0);
  });

  test('does not match IDs shorter than 8 chars like [abc123]', () => {
    const result = agent._extractCitations('Short [abc123] should not match.');
    expect(result.length).toBe(0);
  });

  test('handles multiple citations in same sentence', () => {
    const result = agent._extractCitations('She is [abc12345] a biologist [def67890] who studies coral.');
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Block 8: Claim Extraction (_extractClaims)
// ---------------------------------------------------------------------------

describe('LibrarianAgent - _extractClaims', () => {
  let agent;

  beforeEach(() => {
    agent = new LibrarianAgent(createLibrarianConfig(), createMockConnector());
  });

  test('splits content into sentences', () => {
    const result = agent._extractClaims('Sarah is a biologist. She studies coral reefs.');
    expect(result.length).toBe(2);
  });

  test('filters out markdown headers', () => {
    const result = agent._extractClaims('# Character Profile\n## Background\nSarah is a biologist.');
    // Only "Sarah is a biologist." should be a claim
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/Sarah/);
  });

  test('filters out blank lines', () => {
    const result = agent._extractClaims('Sarah is a biologist.\n\n\nShe studies coral.');
    expect(result.length).toBe(2);
  });

  test('filters out "*Not yet developed*" markers', () => {
    const result = agent._extractClaims('*Not yet developed*\nSarah is a biologist.');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/Sarah/);
  });

  test('filters out horizontal rules', () => {
    const result = agent._extractClaims('Sarah is a biologist.\n---\nShe studies coral.');
    expect(result.length).toBe(2);
    expect(result.every(c => !c.match(/^---$/))).toBe(true);
  });

  test('filters out bold-only lines', () => {
    const result = agent._extractClaims('**Character Background**\nSarah is a biologist.');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/Sarah/);
  });

  test('filters out sentences shorter than 10 chars', () => {
    const result = agent._extractClaims('Short. Hi. Sarah is a marine biologist who studies coral.');
    // "Short." and "Hi." are < 10 chars, only the long sentence should survive
    expect(result.length).toBe(1);
  });

  test('returns empty array for null content', () => {
    expect(agent._extractClaims(null)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(agent._extractClaims('')).toEqual([]);
  });

  test('handles multi-paragraph content correctly', () => {
    const content = '# Title\n\nSarah is a biologist. She studies coral.\n\n**Background**\n\nShe grew up in Hawaii. She has a dog.';
    const result = agent._extractClaims(content);
    expect(result.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Block 9: analyzeResults & generateReport
// ---------------------------------------------------------------------------

describe('LibrarianAgent - analyzeResults & generateReport', () => {
  let agent, connector;

  beforeEach(() => {
    connector = createMockConnector();
    agent = new LibrarianAgent(createLibrarianConfig(), connector);
  });

  // --- analyzeResults ---

  test('calls super.analyzeResults and merges result', async () => {
    const testRunResult = makeTestRunResult();
    const result = await agent.analyzeResults(testRunResult);
    // BaseAgent's analyzeResults returns summary, durationMs, passRate
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('librarian');
  });

  test('computes overallCitationAccuracy from citation_accuracy assertion results', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        status: 'passed',
        assertions: [
          { type: 'citation_accuracy', passed: true, actual: { accuracy: 0.95, total: 20, valid: 19 } }
        ]
      }]
    });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallCitationAccuracy).toBe(19 / 20);
    expect(result.librarian.totalCitations).toBe(20);
    expect(result.librarian.totalValidCitations).toBe(19);
  });

  test('computes overallHallucinationRate from no_unsupported_claims assertion results', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        status: 'passed',
        assertions: [
          { type: 'no_unsupported_claims', passed: true, actual: { rate: 0.04, totalClaims: 25, unsupportedClaims: 1 } }
        ]
      }]
    });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallHallucinationRate).toBe(1 / 25);
    expect(result.librarian.totalClaims).toBe(25);
    expect(result.librarian.totalUnsupportedClaims).toBe(1);
  });

  test('computes overallSectionCompleteness from all_sections_populated assertion results', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        status: 'passed',
        assertions: [
          { type: 'all_sections_populated', passed: false, actual: { totalSections: 6, populatedSections: 5 } }
        ]
      }]
    });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallSectionCompleteness).toBe(5 / 6);
    expect(result.librarian.totalSections).toBe(6);
    expect(result.librarian.totalPopulatedSections).toBe(5);
  });

  test('handles zero citation_accuracy assertions (accuracy = 1.0)', async () => {
    const testRunResult = makeTestRunResult({ scenarios: [] });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallCitationAccuracy).toBe(1.0);
  });

  test('handles zero no_unsupported_claims assertions (rate = 0)', async () => {
    const testRunResult = makeTestRunResult({ scenarios: [] });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallHallucinationRate).toBe(0);
  });

  test('handles zero all_sections_populated assertions (completeness = 1.0)', async () => {
    const testRunResult = makeTestRunResult({ scenarios: [] });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.overallSectionCompleteness).toBe(1.0);
  });

  test('thresholdsPassed uses config thresholds', async () => {
    agent = new LibrarianAgent(
      createLibrarianConfig({ thresholds: { citationAccuracy: 0.50, hallucinationRate: 0.50, sectionCompleteness: 0.50 } }),
      connector
    );
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        status: 'passed',
        assertions: [
          { type: 'citation_accuracy', passed: true, actual: { accuracy: 0.60, total: 10, valid: 6 } },
          { type: 'no_unsupported_claims', passed: true, actual: { rate: 0.40, totalClaims: 10, unsupportedClaims: 4 } },
          { type: 'all_sections_populated', passed: false, actual: { totalSections: 10, populatedSections: 6 } }
        ]
      }]
    });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.thresholdsPassed.citationAccuracy).toBe(true);
    expect(result.librarian.thresholdsPassed.hallucinationRate).toBe(true);
    expect(result.librarian.thresholdsPassed.sectionCompleteness).toBe(true);
  });

  test('thresholdsPassed uses defaults when config thresholds missing', async () => {
    agent = new LibrarianAgent(
      createLibrarianConfig({ thresholds: {} }),
      connector
    );
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        status: 'passed',
        assertions: [
          { type: 'citation_accuracy', passed: true, actual: { accuracy: 0.95, total: 20, valid: 19 } },
          { type: 'no_unsupported_claims', passed: true, actual: { rate: 0.02, totalClaims: 50, unsupportedClaims: 1 } }
        ]
      }]
    });
    const result = await agent.analyzeResults(testRunResult);
    // Defaults: citationAccuracy 0.90, hallucinationRate 0.05, sectionCompleteness 1.0
    expect(result.librarian.thresholdsPassed.citationAccuracy).toBe(true);  // 19/20=0.95 >= 0.90
    expect(result.librarian.thresholdsPassed.hallucinationRate).toBe(true);  // 1/50=0.02 <= 0.05
    expect(result.librarian.thresholdsPassed.sectionCompleteness).toBe(true);  // 1.0 (no assertions) >= 1.0
  });

  test('assertionCounts tracks count of each custom assertion type', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [
        {
          scenarioId: 's1',
          assertions: [
            { type: 'citation_accuracy', passed: true, actual: { total: 5, valid: 5 } },
            { type: 'no_unsupported_claims', passed: true, actual: { totalClaims: 10, unsupportedClaims: 0 } }
          ]
        },
        {
          scenarioId: 's2',
          assertions: [
            { type: 'all_sections_populated', passed: true, actual: { totalSections: 4, populatedSections: 4 } },
            { type: 'citation_accuracy', passed: true, actual: { total: 3, valid: 3 } }
          ]
        }
      ]
    });
    const result = await agent.analyzeResults(testRunResult);
    expect(result.librarian.assertionCounts.citationAccuracy).toBe(2);
    expect(result.librarian.assertionCounts.hallucinationDetection).toBe(1);
    expect(result.librarian.assertionCounts.sectionCompleteness).toBe(1);
  });

  // --- generateReport ---

  test('calls super.generateReport and merges result', async () => {
    const analysis = await agent.analyzeResults(makeTestRunResult());
    const report = await agent.generateReport(analysis);
    // BaseAgent's generateReport returns agentId, timestamp, summary, etc.
    expect(report).toHaveProperty('agentId');
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('librarianSummary');
  });

  test('adds librarianSummary to report', async () => {
    const analysis = await agent.analyzeResults(makeTestRunResult());
    const report = await agent.generateReport(analysis);
    expect(report.librarianSummary).toBeDefined();
    expect(report.librarianSummary).toHaveProperty('status');
    expect(report.librarianSummary).toHaveProperty('citationAccuracy');
    expect(report.librarianSummary).toHaveProperty('hallucinationRate');
    expect(report.librarianSummary).toHaveProperty('sectionCompleteness');
    expect(report.librarianSummary).toHaveProperty('totalCitations');
    expect(report.librarianSummary).toHaveProperty('validCitations');
    expect(report.librarianSummary).toHaveProperty('totalClaims');
    expect(report.librarianSummary).toHaveProperty('unsupportedClaims');
    expect(report.librarianSummary).toHaveProperty('thresholdsPassed');
  });

  test('librarianSummary.status is passed when all thresholds met', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        assertions: [
          { type: 'citation_accuracy', passed: true, actual: { total: 10, valid: 10 } },
          { type: 'no_unsupported_claims', passed: true, actual: { totalClaims: 20, unsupportedClaims: 0 } }
        ]
      }]
    });
    const analysis = await agent.analyzeResults(testRunResult);
    const report = await agent.generateReport(analysis);
    expect(report.librarianSummary.status).toBe('passed');
  });

  test('librarianSummary.status is failed when any threshold missed', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        assertions: [
          { type: 'citation_accuracy', passed: false, actual: { total: 10, valid: 5 } },
          { type: 'no_unsupported_claims', passed: true, actual: { totalClaims: 20, unsupportedClaims: 0 } }
        ]
      }]
    });
    const analysis = await agent.analyzeResults(testRunResult);
    const report = await agent.generateReport(analysis);
    expect(report.librarianSummary.status).toBe('failed');
  });

  test('formats percentages correctly', async () => {
    const testRunResult = makeTestRunResult({
      scenarios: [{
        scenarioId: 's1',
        assertions: [
          { type: 'citation_accuracy', passed: true, actual: { total: 3, valid: 2 } },
          { type: 'no_unsupported_claims', passed: true, actual: { totalClaims: 7, unsupportedClaims: 1 } }
        ]
      }]
    });
    const analysis = await agent.analyzeResults(testRunResult);
    const report = await agent.generateReport(analysis);
    expect(report.librarianSummary.citationAccuracy).toMatch(/\d+\.\d+%/);
    expect(report.librarianSummary.hallucinationRate).toMatch(/\d+\.\d+%/);
    expect(report.librarianSummary.sectionCompleteness).toMatch(/\d+\.\d+%/);
  });

  test('handles missing analysis.librarian gracefully', async () => {
    // Manually create an analysis without librarian field
    const analysis = {
      summary: { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0 },
      durationMs: 100,
      passRate: 0
    };
    const report = await agent.generateReport(analysis);
    expect(report.librarianSummary.status).toBe('passed');
    expect(report.librarianSummary.citationAccuracy).toBe('0.0%');
  });
});

// ---------------------------------------------------------------------------
// Block 10: Scenario Helpers
// ---------------------------------------------------------------------------

describe('Librarian Helpers', () => {

  // --- createReportCitationScenario ---

  test('generates scenario with steps and assertions', () => {
    const scenario = createReportCitationScenario({
      reportType: 'character_profile',
      setupMessages: [{ text: 'Create a character named Sarah.' }]
    });
    expect(scenario.steps.length).toBeGreaterThan(0);
    expect(scenario.assertions.length).toBeGreaterThan(0);
    expect(scenario).toHaveProperty('id');
    expect(scenario).toHaveProperty('name');
    expect(scenario).toHaveProperty('tags');
    expect(scenario).toHaveProperty('timeout');
  });

  test('every step has an action field', () => {
    const scenario = createReportCitationScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }, { text: 'msg2' }]
    });
    for (const step of scenario.steps) {
      expect(step).toHaveProperty('action');
      expect(typeof step.action).toBe('string');
    }
  });

  test('assertions are at scenario level (not embedded as steps)', () => {
    const scenario = createReportCitationScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }]
    });
    // Assertions should NOT appear in steps array
    const assertionActions = scenario.steps.filter(s =>
      s.action === 'citation_accuracy' || s.action === 'no_unsupported_claims'
    );
    expect(assertionActions.length).toBe(0);
    // Assertions should be in assertions array
    expect(scenario.assertions.length).toBe(2);
  });

  test('assertion.reportStepIndex points to generate_report step', () => {
    const scenario = createReportCitationScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }, { text: 'msg2' }]
    });
    const reportIdx = scenario.assertions[0].reportStepIndex;
    expect(scenario.steps[reportIdx].action).toBe('generate_report');
  });

  test('includes citation_accuracy and no_unsupported_claims assertions', () => {
    const scenario = createReportCitationScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }]
    });
    const types = scenario.assertions.map(a => a.type);
    expect(types).toContain('citation_accuracy');
    expect(types).toContain('no_unsupported_claims');
  });

  test('throws when reportType missing', () => {
    expect(() => createReportCitationScenario({
      setupMessages: [{ text: 'msg1' }]
    })).toThrow(ConfigurationError);
  });

  test('throws when setupMessages empty', () => {
    expect(() => createReportCitationScenario({
      reportType: 'outline',
      setupMessages: []
    })).toThrow(ConfigurationError);
  });

  test('applies custom thresholds to assertions', () => {
    const scenario = createReportCitationScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }],
      thresholds: { citationAccuracy: 0.80, hallucinationRate: 0.10 }
    });
    const citAcc = scenario.assertions.find(a => a.type === 'citation_accuracy');
    const noUnsup = scenario.assertions.find(a => a.type === 'no_unsupported_claims');
    expect(citAcc.minAccuracy).toBe(0.80);
    expect(noUnsup.maxUnsupportedRate).toBe(0.10);
  });

  // --- createBibleCompletenessScenario ---

  test('generates scenario with generate_bible step', () => {
    const scenario = createBibleCompletenessScenario({
      templateKey: 'standard',
      setupMessages: [{ text: 'msg1' }]
    });
    const bibleSteps = scenario.steps.filter(s => s.action === 'generate_bible');
    expect(bibleSteps.length).toBe(1);
  });

  test('includes all_sections_populated assertion with correct bibleStepIndex', () => {
    const scenario = createBibleCompletenessScenario({
      templateKey: 'standard',
      setupMessages: [{ text: 'msg1' }]
    });
    const assertion = scenario.assertions[0];
    expect(assertion.type).toBe('all_sections_populated');
    expect(scenario.steps[assertion.bibleStepIndex].action).toBe('generate_bible');
  });

  test('passes allowEmpty to assertion', () => {
    const scenario = createBibleCompletenessScenario({
      templateKey: 'standard',
      setupMessages: [{ text: 'msg1' }],
      allowEmpty: ['appendix', 'notes']
    });
    expect(scenario.assertions[0].allowEmpty).toEqual(['appendix', 'notes']);
  });

  test('throws when templateKey missing', () => {
    expect(() => createBibleCompletenessScenario({
      setupMessages: [{ text: 'msg1' }]
    })).toThrow(ConfigurationError);
  });

  // --- createHallucinationDetectionScenario ---

  test('generates scenario with no_unsupported_claims assertion', () => {
    const scenario = createHallucinationDetectionScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }]
    });
    expect(scenario.assertions[0].type).toBe('no_unsupported_claims');
  });

  test('hallucination scenario defaults maxUnsupportedRate to 0.10', () => {
    const scenario = createHallucinationDetectionScenario({
      reportType: 'outline',
      setupMessages: [{ text: 'msg1' }]
    });
    expect(scenario.assertions[0].maxUnsupportedRate).toBe(0.10);
  });

  test('throws when reportType missing in hallucination scenario', () => {
    expect(() => createHallucinationDetectionScenario({
      setupMessages: [{ text: 'msg1' }]
    })).toThrow(ConfigurationError);
  });

  test('throws when setupMessages empty in hallucination scenario', () => {
    expect(() => createHallucinationDetectionScenario({
      reportType: 'outline',
      setupMessages: []
    })).toThrow(ConfigurationError);
  });
});
