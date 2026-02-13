'use strict';

const { loadConfig, validateConfig } = require('../../core/config');

describe('loadConfig', () => {
  // Group 1: Default values
  test('returns default db path when QA_ENGINE_DB_PATH not set', () => {
    const config = loadConfig({});
    expect(config.db.path).toBe('./data/qa-engine.db');
  });

  test('returns default approval timeout of 3600000ms', () => {
    const config = loadConfig({});
    expect(config.engine.approvalTimeoutMs).toBe(3600000);
  });

  test('returns empty notification recipients when not set', () => {
    const config = loadConfig({});
    expect(config.engine.notificationRecipients).toEqual([]);
  });

  test('returns default LLM model and max tokens', () => {
    const config = loadConfig({});
    expect(config.anthropic.model).toBe('claude-sonnet-4-5-20250929');
    expect(config.anthropic.maxTokens).toBe(4096);
  });

  // Group 2: Environment variable parsing
  test('reads ANTHROPIC_API_KEY from env', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-test-123' });
    expect(config.anthropic.apiKey).toBe('sk-test-123');
  });

  test('reads all Twilio vars from env', () => {
    const config = loadConfig({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token123',
      TWILIO_FROM_NUMBER: 'whatsapp:+14155238886'
    });
    expect(config.twilio.accountSid).toBe('AC123');
    expect(config.twilio.authToken).toBe('token123');
    expect(config.twilio.fromNumber).toBe('whatsapp:+14155238886');
  });

  test('reads all Linear vars from env', () => {
    const config = loadConfig({
      LINEAR_API_KEY: 'lin_api_test',
      LINEAR_TEAM_ID: 'team-1',
      LINEAR_PROJECT_ID: 'proj-1'
    });
    expect(config.linear.apiKey).toBe('lin_api_test');
    expect(config.linear.teamId).toBe('team-1');
    expect(config.linear.projectId).toBe('proj-1');
  });

  test('parses comma-separated notification recipients', () => {
    const config = loadConfig({
      QA_ENGINE_NOTIFICATION_RECIPIENTS: 'whatsapp:+1111,whatsapp:+2222'
    });
    expect(config.engine.notificationRecipients).toEqual([
      'whatsapp:+1111',
      'whatsapp:+2222'
    ]);
  });

  test('sets inMemory=true when db path is :memory:', () => {
    const config = loadConfig({ QA_ENGINE_DB_PATH: ':memory:' });
    expect(config.db.inMemory).toBe(true);
    expect(config.db.path).toBe(':memory:');
  });

  // Group 3: Edge cases
  test('trims whitespace from notification recipients', () => {
    const config = loadConfig({
      QA_ENGINE_NOTIFICATION_RECIPIENTS: '  whatsapp:+1111 , whatsapp:+2222  '
    });
    expect(config.engine.notificationRecipients).toEqual([
      'whatsapp:+1111',
      'whatsapp:+2222'
    ]);
  });

  test('filters empty strings from recipients', () => {
    const config = loadConfig({
      QA_ENGINE_NOTIFICATION_RECIPIENTS: 'whatsapp:+1111,,, ,whatsapp:+2222'
    });
    expect(config.engine.notificationRecipients).toEqual([
      'whatsapp:+1111',
      'whatsapp:+2222'
    ]);
  });

  test('handles non-numeric approval timeout gracefully (falls back to default)', () => {
    const config = loadConfig({ QA_ENGINE_APPROVAL_TIMEOUT_MS: 'not-a-number' });
    expect(config.engine.approvalTimeoutMs).toBe(3600000);
  });
});

describe('validateConfig', () => {
  // Group 4: Service detection
  test('reports llm=true when ANTHROPIC_API_KEY present', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-test' });
    const result = validateConfig(config);
    expect(result.services.llm).toBe(true);
  });

  test('reports notifications=true when all Twilio vars present', () => {
    const config = loadConfig({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_NUMBER: 'whatsapp:+1234'
    });
    const result = validateConfig(config);
    expect(result.services.notifications).toBe(true);
  });

  test('reports bugTracker=true when LINEAR_API_KEY and LINEAR_TEAM_ID present', () => {
    const config = loadConfig({
      LINEAR_API_KEY: 'lin_api_test',
      LINEAR_TEAM_ID: 'team-1'
    });
    const result = validateConfig(config);
    expect(result.services.bugTracker).toBe(true);
  });

  test('reports all services=false with empty config', () => {
    const config = loadConfig({});
    const result = validateConfig(config);
    expect(result.services.llm).toBe(false);
    expect(result.services.notifications).toBe(false);
    expect(result.services.bugTracker).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
