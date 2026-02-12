'use strict';

const { ConfigurationError } = require('../../agents/errors');

/**
 * Scenario helpers for LibrarianAgent tests.
 * Follows same pattern as tests/helpers/sentinel-helpers.js.
 */

/**
 * Creates a scenario that: establishes facts → generates report → validates citations.
 *
 * @param {Object} config
 * @param {string} config.reportType - 'outline', 'character_profile', etc.
 * @param {Object} [config.reportParams] - Report-specific params (e.g., { character_name })
 * @param {Array<{text: string}>} config.setupMessages - Messages to establish facts
 * @param {Object} [config.thresholds] - Override default thresholds
 * @returns {Object} Scenario with steps[] and assertions[]
 */
function createReportCitationScenario(config) {
  const {
    reportType,
    reportParams = {},
    setupMessages = [],
    thresholds = {}
  } = config;

  if (!reportType) {
    throw new ConfigurationError('createReportCitationScenario requires reportType');
  }
  if (setupMessages.length === 0) {
    throw new ConfigurationError('createReportCitationScenario requires at least one setupMessage');
  }

  const steps = [];

  // Create story + session
  steps.push({ action: 'create_story', params: { name: 'Citation Test {{timestamp}}', vertical: 'novel' } });
  steps.push({ action: 'create_session', params: { type: 'brainstorm' } });

  // Send setup messages (establish facts)
  for (const msg of setupMessages) {
    steps.push({ action: 'send_message', params: { text: msg.text } });
    steps.push({ action: 'wait_for_response', params: {} });
  }

  // Generate report — record step index for assertions
  const reportStepIndex = steps.length;
  steps.push({
    action: 'generate_report',
    params: { report_type: reportType, ...reportParams }
  });

  return {
    id: `report-citation-${reportType}`,
    name: `Report Citation Accuracy - ${reportType}`,
    tags: ['citation', 'report', reportType],
    timeout: 120000,
    steps,
    assertions: [
      {
        type: 'citation_accuracy',
        reportStepIndex,
        minAccuracy: thresholds.citationAccuracy ?? 0.90,
        message: `Report citations should be >= ${((thresholds.citationAccuracy ?? 0.90) * 100).toFixed(0)}% accurate`
      },
      {
        type: 'no_unsupported_claims',
        reportStepIndex,
        maxUnsupportedRate: thresholds.hallucinationRate ?? 0.05,
        message: `Hallucination rate should be <= ${((thresholds.hallucinationRate ?? 0.05) * 100).toFixed(0)}%`
      }
    ]
  };
}

/**
 * Creates a scenario that: establishes facts → generates bible → checks all sections.
 *
 * @param {Object} config
 * @param {string} config.templateKey - 'standard', 'heros_journey', etc.
 * @param {Array<{text: string}>} config.setupMessages - Messages to establish facts
 * @param {Array<string>} [config.allowEmpty] - Section keys allowed to be empty
 * @param {Object} [config.thresholds] - Override default thresholds
 * @returns {Object} Scenario with steps[] and assertions[]
 */
function createBibleCompletenessScenario(config) {
  const {
    templateKey,
    setupMessages = [],
    allowEmpty = [],
    thresholds = {}
  } = config;

  if (!templateKey) {
    throw new ConfigurationError('createBibleCompletenessScenario requires templateKey');
  }
  if (setupMessages.length === 0) {
    throw new ConfigurationError('createBibleCompletenessScenario requires at least one setupMessage');
  }

  const steps = [];

  steps.push({ action: 'create_story', params: { name: 'Bible Test {{timestamp}}', vertical: 'novel' } });
  steps.push({ action: 'create_session', params: { type: 'brainstorm' } });

  for (const msg of setupMessages) {
    steps.push({ action: 'send_message', params: { text: msg.text } });
    steps.push({ action: 'wait_for_response', params: {} });
  }

  const bibleStepIndex = steps.length;
  steps.push({
    action: 'generate_bible',
    params: { template_key: templateKey }
  });

  return {
    id: `bible-completeness-${templateKey}`,
    name: `Bible Completeness - ${templateKey}`,
    tags: ['citation', 'bible', templateKey],
    timeout: 180000,
    steps,
    assertions: [
      {
        type: 'all_sections_populated',
        bibleStepIndex,
        allowEmpty,
        message: 'All bible sections should have content'
      }
    ]
  };
}

/**
 * Creates a scenario with minimal facts to detect hallucination.
 *
 * @param {Object} config
 * @param {string} config.reportType - Report type to generate
 * @param {Object} [config.reportParams] - Report-specific params
 * @param {Array<{text: string}>} config.setupMessages - Minimal messages
 * @param {Object} [config.thresholds] - Override default thresholds
 * @returns {Object} Scenario with steps[] and assertions[]
 */
function createHallucinationDetectionScenario(config) {
  const {
    reportType,
    reportParams = {},
    setupMessages = [],
    thresholds = {}
  } = config;

  if (!reportType) {
    throw new ConfigurationError('createHallucinationDetectionScenario requires reportType');
  }
  if (setupMessages.length === 0) {
    throw new ConfigurationError('createHallucinationDetectionScenario requires at least one setupMessage');
  }

  const steps = [];

  steps.push({ action: 'create_story', params: { name: 'Hallucination Test {{timestamp}}', vertical: 'novel' } });
  steps.push({ action: 'create_session', params: { type: 'brainstorm' } });

  for (const msg of setupMessages) {
    steps.push({ action: 'send_message', params: { text: msg.text } });
    steps.push({ action: 'wait_for_response', params: {} });
  }

  const reportStepIndex = steps.length;
  steps.push({
    action: 'generate_report',
    params: { report_type: reportType, ...reportParams }
  });

  return {
    id: `hallucination-${reportType}`,
    name: `Hallucination Detection - ${reportType}`,
    tags: ['hallucination', 'report', reportType],
    timeout: 120000,
    steps,
    assertions: [
      {
        type: 'no_unsupported_claims',
        reportStepIndex,
        maxUnsupportedRate: thresholds.hallucinationRate ?? 0.10,
        message: `Hallucination rate should be <= ${((thresholds.hallucinationRate ?? 0.10) * 100).toFixed(0)}%`
      }
    ]
  };
}

module.exports = {
  createReportCitationScenario,
  createBibleCompletenessScenario,
  createHallucinationDetectionScenario
};
