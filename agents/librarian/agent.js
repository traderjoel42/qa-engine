'use strict';

const BaseAgent = require('../base-agent');
const { ConfigurationError } = require('../errors');

/**
 * LibrarianAgent — validates citation accuracy in reports and Story Bibles.
 *
 * Custom assertion types (via evaluateAssertion override):
 *   - citation_accuracy: batch-validates all citations in a generated document
 *   - no_unsupported_claims: aggregate hallucination detection
 *   - all_sections_populated: bible section completeness
 *   - citation_supports_claim: spot-check a specific citation's semantic support
 *
 * Scenario helpers in tests/helpers/librarian-helpers.js:
 *   - createReportCitationScenario(config)
 *   - createBibleCompletenessScenario(config)
 *   - createHallucinationDetectionScenario(config)
 */
class LibrarianAgent extends BaseAgent {

  // ---------------------------------------------------------------------------
  // Lifecycle overrides
  // ---------------------------------------------------------------------------

  async initialize() {
    await super.initialize();

    // Validate that config has meaningful scenarios
    const scenarios = this.getScenarios();
    if (scenarios.length === 0) {
      throw new ConfigurationError(
        'LibrarianAgent requires at least one scenario'
      );
    }

    // Validate thresholds if provided
    const thresholds = this.config.thresholds || {};
    if (thresholds.citationAccuracy !== undefined &&
        (thresholds.citationAccuracy < 0 || thresholds.citationAccuracy > 1)) {
      throw new ConfigurationError('citationAccuracy threshold must be between 0 and 1');
    }
    if (thresholds.hallucinationRate !== undefined &&
        (thresholds.hallucinationRate < 0 || thresholds.hallucinationRate > 1)) {
      throw new ConfigurationError('hallucinationRate threshold must be between 0 and 1');
    }
    if (thresholds.sectionCompleteness !== undefined &&
        (thresholds.sectionCompleteness < 0 || thresholds.sectionCompleteness > 1)) {
      throw new ConfigurationError('sectionCompleteness threshold must be between 0 and 1');
    }
  }

  // ---------------------------------------------------------------------------
  // Custom assertion dispatch (override with super fallback)
  // ---------------------------------------------------------------------------

  async evaluateAssertion(assertion, scenarioContext) {
    const startTime = Date.now();

    switch (assertion.type) {

      case 'citation_accuracy': {
        return await this._evaluateCitationAccuracy(assertion, scenarioContext, startTime);
      }

      case 'no_unsupported_claims': {
        return this._evaluateNoUnsupportedClaims(assertion, scenarioContext, startTime);
      }

      case 'all_sections_populated': {
        return this._evaluateAllSectionsPopulated(assertion, scenarioContext, startTime);
      }

      case 'citation_supports_claim': {
        return await this._evaluateCitationSupportsClaim(assertion, scenarioContext, startTime);
      }

      default:
        return super.evaluateAssertion(assertion, scenarioContext);
    }
  }

  // ---------------------------------------------------------------------------
  // Assertion handlers — each returns { type, passed, message, expected, actual, durationMs }
  // ---------------------------------------------------------------------------

  /**
   * Batch-validates all citations in a generated document.
   * Extracts citations from step result content, verifies each via connector.
   */
  async _evaluateCitationAccuracy(assertion, scenarioContext, startTime) {
    const { reportStepIndex, minAccuracy = 0.90 } = assertion;
    const stepResult = scenarioContext.stepResults[reportStepIndex];

    if (!stepResult || stepResult.status === 'failed') {
      return {
        type: 'citation_accuracy',
        passed: false,
        message: `Cannot evaluate citations: step ${reportStepIndex} failed or missing`,
        expected: `step ${reportStepIndex} succeeded with report content`,
        actual: stepResult ? stepResult.status : 'missing',
        durationMs: Date.now() - startTime
      };
    }

    const content = stepResult.result?.content || '';
    const citations = this._extractCitations(content);

    if (citations.length === 0) {
      return {
        type: 'citation_accuracy',
        passed: false,
        message: 'No citations found in generated content',
        expected: `>= 1 citation with accuracy >= ${(minAccuracy * 100).toFixed(1)}%`,
        actual: { accuracy: 0, total: 0, valid: 0, invalid: 0, details: [] },
        durationMs: Date.now() - startTime
      };
    }

    // Verify each citation via connector
    const details = [];
    for (const citation of citations) {
      try {
        const verification = await this.connector.performAction('verify_citation', {
          citationId: citation.id,
          claimText: citation.claimText
        });
        details.push({
          citationId: citation.id,
          claimText: citation.claimText,
          position: citation.position,
          sourceExists: verification.source_exists,
          supportsClaim: verification.supports_claim,
          sourceContent: verification.source_content || null,
          valid: verification.valid
        });
      } catch (err) {
        details.push({
          citationId: citation.id,
          claimText: citation.claimText,
          position: citation.position,
          sourceExists: false,
          supportsClaim: false,
          sourceContent: null,
          valid: false
        });
      }
    }

    const valid = details.filter(d => d.valid).length;
    const accuracy = details.length > 0 ? valid / details.length : 0;
    const passed = accuracy >= minAccuracy;

    return {
      type: 'citation_accuracy',
      passed,
      message: passed
        ? `Citation accuracy ${(accuracy * 100).toFixed(1)}% meets threshold ${(minAccuracy * 100).toFixed(1)}%`
        : `Citation accuracy ${(accuracy * 100).toFixed(1)}% below threshold ${(minAccuracy * 100).toFixed(1)}%`,
      expected: `>= ${(minAccuracy * 100).toFixed(1)}%`,
      actual: {
        accuracy,
        total: details.length,
        valid,
        invalid: details.length - valid,
        details
      },
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Scans content for claims without citations (hallucination detection).
   */
  _evaluateNoUnsupportedClaims(assertion, scenarioContext, startTime) {
    const { reportStepIndex, maxUnsupportedRate = 0.05 } = assertion;
    const stepResult = scenarioContext.stepResults[reportStepIndex];

    if (!stepResult || stepResult.status === 'failed') {
      return {
        type: 'no_unsupported_claims',
        passed: false,
        message: `Cannot evaluate claims: step ${reportStepIndex} failed or missing`,
        expected: `step ${reportStepIndex} succeeded with content`,
        actual: stepResult ? stepResult.status : 'missing',
        durationMs: Date.now() - startTime
      };
    }

    const content = stepResult.result?.content || '';
    const claims = this._extractClaims(content);

    if (claims.length === 0) {
      return {
        type: 'no_unsupported_claims',
        passed: true,
        message: 'No claims found in content (nothing to check)',
        expected: `unsupported rate <= ${(maxUnsupportedRate * 100).toFixed(1)}%`,
        actual: { rate: 0, totalClaims: 0, unsupportedClaims: 0, examples: [] },
        durationMs: Date.now() - startTime
      };
    }

    // Find claims without any citation
    const unsupportedClaims = claims.filter(claim => !/\[[a-f0-9]{8}\]/i.test(claim));
    const rate = unsupportedClaims.length / claims.length;
    const passed = rate <= maxUnsupportedRate;

    return {
      type: 'no_unsupported_claims',
      passed,
      message: passed
        ? `Unsupported claim rate ${(rate * 100).toFixed(1)}% within threshold ${(maxUnsupportedRate * 100).toFixed(1)}%`
        : `Unsupported claim rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(maxUnsupportedRate * 100).toFixed(1)}%`,
      expected: `<= ${(maxUnsupportedRate * 100).toFixed(1)}%`,
      actual: {
        rate,
        totalClaims: claims.length,
        unsupportedClaims: unsupportedClaims.length,
        examples: unsupportedClaims.slice(0, 3).map(c => c.substring(0, 80))
      },
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Bible-specific: checks all sections have real content.
   */
  _evaluateAllSectionsPopulated(assertion, scenarioContext, startTime) {
    const { bibleStepIndex, allowEmpty = [] } = assertion;
    const stepResult = scenarioContext.stepResults[bibleStepIndex];

    if (!stepResult || stepResult.status === 'failed') {
      return {
        type: 'all_sections_populated',
        passed: false,
        message: `Cannot evaluate sections: step ${bibleStepIndex} failed or missing`,
        expected: `step ${bibleStepIndex} succeeded with bible sections`,
        actual: stepResult ? stepResult.status : 'missing',
        durationMs: Date.now() - startTime
      };
    }

    const sections = stepResult.result?.sections;
    if (!sections || typeof sections !== 'object') {
      return {
        type: 'all_sections_populated',
        passed: false,
        message: 'No sections object found in bible step result',
        expected: 'sections object with content',
        actual: typeof sections,
        durationMs: Date.now() - startTime
      };
    }

    const allowedEmpty = new Set(allowEmpty);
    const sectionKeys = Object.keys(sections);
    const emptySections = [];

    for (const key of sectionKeys) {
      const content = sections[key];
      const isEmpty = !content ||
        content === '*Not yet developed*' ||
        content.trim() === '';

      if (isEmpty && !allowedEmpty.has(key)) {
        emptySections.push(key);
      }
    }

    const totalSections = sectionKeys.length;
    const populatedSections = totalSections - emptySections.length;
    const completeness = totalSections > 0 ? populatedSections / totalSections : 1.0;
    const passed = emptySections.length === 0;

    return {
      type: 'all_sections_populated',
      passed,
      message: passed
        ? `All ${totalSections} sections populated`
        : `${emptySections.length}/${totalSections} sections empty: ${emptySections.join(', ')}`,
      expected: 'all sections populated',
      actual: {
        completeness,
        totalSections,
        populatedSections,
        emptySections,
        allowedEmpty: allowEmpty
      },
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Spot-checks a specific citation's semantic support.
   */
  async _evaluateCitationSupportsClaim(assertion, scenarioContext, startTime) {
    const { citationId, claimText, strictness = 'normal' } = assertion;

    if (!citationId || !claimText) {
      return {
        type: 'citation_supports_claim',
        passed: false,
        message: 'citation_supports_claim requires citationId and claimText',
        expected: 'citationId and claimText provided',
        actual: `citationId=${citationId}, claimText=${claimText ? 'present' : 'missing'}`,
        durationMs: Date.now() - startTime
      };
    }

    try {
      const result = await this.connector.performAction('verify_citation', {
        citationId,
        claimText,
        strictness
      });

      const passed = result.supports_claim === true;

      return {
        type: 'citation_supports_claim',
        passed,
        message: passed
          ? `Citation [${citationId}] supports claim at ${strictness} strictness`
          : `Citation [${citationId}] does not support claim at ${strictness} strictness`,
        expected: `supports_claim = true (strictness: ${strictness})`,
        actual: {
          citationId,
          supportsClaim: result.supports_claim,
          sourceExists: result.source_exists,
          sourceContent: (result.source_content || '').substring(0, 100)
        },
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      return {
        type: 'citation_supports_claim',
        passed: false,
        message: `verify_citation failed: ${err.message}`,
        expected: 'verify_citation succeeds',
        actual: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  // ---------------------------------------------------------------------------
  // analyzeResults + generateReport (async, with super calls)
  // ---------------------------------------------------------------------------

  async analyzeResults(testRunResult) {
    const baseAnalysis = await super.analyzeResults(testRunResult);

    // Collect all custom assertion results from scenarios
    const citationAccResults = [];
    const hallucinationResults = [];
    const completenessResults = [];

    for (const scenario of (testRunResult.scenarios || [])) {
      for (const ar of (scenario.assertions || [])) {
        switch (ar.type) {
          case 'citation_accuracy':
            citationAccResults.push(ar);
            break;
          case 'no_unsupported_claims':
            hallucinationResults.push(ar);
            break;
          case 'all_sections_populated':
            completenessResults.push(ar);
            break;
        }
      }
    }

    // Compute aggregate citation accuracy
    let totalCitations = 0;
    let totalValid = 0;
    for (const ar of citationAccResults) {
      if (ar.actual && typeof ar.actual === 'object') {
        totalCitations += ar.actual.total || 0;
        totalValid += ar.actual.valid || 0;
      }
    }
    const overallCitationAccuracy = totalCitations > 0 ? totalValid / totalCitations : 1.0;

    // Compute aggregate hallucination rate
    let totalClaims = 0;
    let totalUnsupported = 0;
    for (const ar of hallucinationResults) {
      if (ar.actual && typeof ar.actual === 'object') {
        totalClaims += ar.actual.totalClaims || 0;
        totalUnsupported += ar.actual.unsupportedClaims || 0;
      }
    }
    const overallHallucinationRate = totalClaims > 0 ? totalUnsupported / totalClaims : 0;

    // Compute aggregate section completeness
    let totalSections = 0;
    let totalPopulated = 0;
    for (const ar of completenessResults) {
      if (ar.actual && typeof ar.actual === 'object') {
        totalSections += ar.actual.totalSections || 0;
        totalPopulated += ar.actual.populatedSections || 0;
      }
    }
    const overallSectionCompleteness = totalSections > 0 ? totalPopulated / totalSections : 1.0;

    // Threshold checks
    const thresholds = this.config.thresholds || {};
    const citAccThreshold = thresholds.citationAccuracy ?? 0.90;
    const hallThreshold = thresholds.hallucinationRate ?? 0.05;
    const secCompThreshold = thresholds.sectionCompleteness ?? 1.0;

    return {
      ...baseAnalysis,
      librarian: {
        overallCitationAccuracy,
        overallHallucinationRate,
        overallSectionCompleteness,
        totalCitations,
        totalValidCitations: totalValid,
        totalClaims,
        totalUnsupportedClaims: totalUnsupported,
        totalSections,
        totalPopulatedSections: totalPopulated,
        thresholdsPassed: {
          citationAccuracy: overallCitationAccuracy >= citAccThreshold,
          hallucinationRate: overallHallucinationRate <= hallThreshold,
          sectionCompleteness: overallSectionCompleteness >= secCompThreshold
        },
        assertionCounts: {
          citationAccuracy: citationAccResults.length,
          hallucinationDetection: hallucinationResults.length,
          sectionCompleteness: completenessResults.length
        }
      }
    };
  }

  async generateReport(analysis) {
    const baseReport = await super.generateReport(analysis);
    const lib = analysis.librarian || {};

    const allPassed = lib.thresholdsPassed
      ? Object.values(lib.thresholdsPassed).every(v => v)
      : true;

    return {
      ...baseReport,
      librarianSummary: {
        status: allPassed ? 'passed' : 'failed',
        citationAccuracy: `${((lib.overallCitationAccuracy || 0) * 100).toFixed(1)}%`,
        hallucinationRate: `${((lib.overallHallucinationRate || 0) * 100).toFixed(1)}%`,
        sectionCompleteness: `${((lib.overallSectionCompleteness || 0) * 100).toFixed(1)}%`,
        totalCitations: lib.totalCitations || 0,
        validCitations: lib.totalValidCitations || 0,
        totalClaims: lib.totalClaims || 0,
        unsupportedClaims: lib.totalUnsupportedClaims || 0,
        thresholdsPassed: lib.thresholdsPassed || {}
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Internal utilities
  // ---------------------------------------------------------------------------

  /**
   * Extract citations from content. Matches [8-char-hex-id] pattern.
   * @param {string} content - Document content
   * @returns {Array<{id: string, claimText: string, position: number}>}
   */
  _extractCitations(content) {
    if (!content) return [];
    const regex = /\[([a-f0-9]{8})\]/gi;
    const results = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const position = match.index;
      const claimText = this._getSurroundingSentence(content, position);
      results.push({
        id: match[1].toLowerCase(),
        claimText,
        position
      });
    }

    return results;
  }

  /**
   * Extract claim sentences from content.
   * Filters out headers, blank lines, template markers, and short fragments.
   * @param {string} content - Document content
   * @returns {string[]} Claim sentences
   */
  _extractClaims(content) {
    if (!content) return [];

    const lines = content.split('\n');
    const claims = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;
      // Skip markdown headers
      if (/^#{1,6}\s/.test(trimmed)) continue;
      // Skip template markers
      if (trimmed === '*Not yet developed*') continue;
      // Skip horizontal rules
      if (/^[-*_]{3,}$/.test(trimmed)) continue;
      // Skip lines that are just bold headers
      if (/^\*\*[^*]+\*\*$/.test(trimmed)) continue;

      // Split line into sentences, keep those > 10 chars
      const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
      for (const sentence of sentences) {
        claims.push(sentence.trim());
      }
    }

    return claims;
  }

  /**
   * Get the sentence surrounding a character position in text.
   * @param {string} content - Full text
   * @param {number} position - Character position of citation
   * @returns {string} Surrounding sentence
   */
  _getSurroundingSentence(content, position) {
    const lookback = 200;
    const lookahead = 200;
    const before = content.substring(Math.max(0, position - lookback), position);
    const after = content.substring(position, Math.min(content.length, position + lookahead));

    const sentenceStart = before.lastIndexOf('.') !== -1
      ? before.lastIndexOf('.') + 1
      : 0;
    const sentenceEnd = after.indexOf('.') !== -1
      ? after.indexOf('.') + 1
      : after.length;

    const startPos = Math.max(0, position - lookback) + sentenceStart;
    const endPos = position + sentenceEnd;

    return content.substring(startPos, endPos).trim();
  }
}

module.exports = LibrarianAgent;
