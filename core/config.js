'use strict';

const path = require('path');

/**
 * ConfigError for invalid or problematic configuration.
 */
class ConfigError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

/**
 * Load configuration from environment variables.
 * Call dotenv.config() before this if using .env files.
 *
 * @param {object} env - Environment object (defaults to process.env)
 * @returns {object} Resolved configuration
 */
function loadConfig(env = process.env) {
  const dbPath = env.QA_ENGINE_DB_PATH || './data/qa-engine.db';

  const config = {
    db: {
      path: dbPath,
      inMemory: dbPath === ':memory:'
    },

    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || null,
      model: env.QA_ENGINE_LLM_MODEL || 'claude-sonnet-4-5-20250929',
      maxTokens: parseInt(env.QA_ENGINE_LLM_MAX_TOKENS, 10) || 4096
    },

    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || null,
      authToken: env.TWILIO_AUTH_TOKEN || null,
      fromNumber: env.TWILIO_FROM_NUMBER || null
    },

    linear: {
      apiKey: env.LINEAR_API_KEY || null,
      teamId: env.LINEAR_TEAM_ID || null,
      projectId: env.LINEAR_PROJECT_ID || null
    },

    engine: {
      approvalTimeoutMs: parseInt(env.QA_ENGINE_APPROVAL_TIMEOUT_MS, 10) || 3600000,
      notificationRecipients: env.QA_ENGINE_NOTIFICATION_RECIPIENTS
        ? env.QA_ENGINE_NOTIFICATION_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      appsDir: env.QA_ENGINE_APPS_DIR || './apps'
    }
  };

  return config;
}

/**
 * Validate configuration and return warnings about missing optional services.
 * Does NOT throw — all config is valid, some services just won't be available.
 *
 * @param {object} config - Configuration from loadConfig()
 * @returns {object} { warnings: string[], services: { llm: bool, notifications: bool, bugTracker: bool } }
 */
function validateConfig(config) {
  const warnings = [];
  const services = {
    llm: false,
    notifications: false,
    bugTracker: false
  };

  // LLM
  if (config.anthropic.apiKey) {
    services.llm = true;
  } else {
    warnings.push('ANTHROPIC_API_KEY not set — using rule-based bug classification (no LLM analysis)');
  }

  // Notifications
  if (config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber) {
    services.notifications = true;
  } else {
    warnings.push('Twilio not fully configured — using console notifications');
  }

  // Bug tracker
  if (config.linear.apiKey && config.linear.teamId) {
    services.bugTracker = true;
  } else {
    warnings.push('Linear not fully configured — bugs stored locally only');
  }

  // Validate numeric ranges
  if (config.engine.approvalTimeoutMs < 60000) {
    warnings.push('Approval timeout under 60s — this may cause premature timeouts');
  }

  if (config.anthropic.maxTokens < 100 || config.anthropic.maxTokens > 200000) {
    warnings.push(`LLM max tokens (${config.anthropic.maxTokens}) outside typical range [100, 200000]`);
  }

  return { warnings, services };
}

module.exports = { loadConfig, validateConfig, ConfigError };
