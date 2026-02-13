# Concrete Adapters — Implementation Spec

**QA Engine Phase 1, Week 4, Days 3-4**  
**Date:** February 12, 2026  
**Depends on:** Week 3 adapter interfaces (`core/integrations/adapters/llm.js`, `core/integrations/adapters/notification.js`), error hierarchy (`core/engine/errors.js`)  
**Reference:** `qa-engine-01-overview-and-architecture.md` (adapter pattern), `qa-engine-02-core-engine-spec.md` (LLM usage in Bug Detector and Auto-Fixer)

---

## Overview

Build the two concrete adapter implementations that power the Bug Detector, Auto-Fixer, and Approval Manager with real external services. After this work, the QA Engine can analyze bugs with Claude and send approval requests via WhatsApp.

Both adapters implement existing abstract interfaces from Week 3. No existing files are modified except adding exports to barrel files.

**Deliverables:**
1. **Day 3: AnthropicAdapter** — Concrete LLMAdapter wrapping `@anthropic-ai/sdk`
2. **Day 4: TwilioWhatsAppAdapter** — Concrete NotificationAdapter wrapping `twilio`
3. **~120-150 new tests**, zero regressions

---

## Day 3: Anthropic LLM Adapter

### Architecture

```
core/integrations/anthropic/
├── client.js          # AnthropicAdapter class (extends LLMAdapter)
├── prompts.js         # Prompt templates for bug analysis, fix generation, classification
└── index.js           # Barrel export

tests/integrations/anthropic/
├── client.test.js
└── prompts.test.js
```

### 1. AnthropicAdapter

**File:** `core/integrations/anthropic/client.js`

```javascript
'use strict';

const LLMAdapter = require('../adapters/llm');
const { AdapterError } = require('../../engine/errors');

class AnthropicAdapter extends LLMAdapter {
  /**
   * @param {Object} options
   * @param {Object} [options.client] - Injectable Anthropic SDK client (for testing)
   * @param {string} [options.apiKey] - Anthropic API key (ignored if client provided)
   * @param {string} [options.defaultModel] - Default model identifier
   * @param {number} [options.defaultMaxTokens] - Default max tokens
   * @param {number} [options.maxRetries] - Max retries on transient errors
   * @param {number} [options.retryDelayMs] - Base delay between retries (doubles each retry)
   */
  constructor(options = {}) {
    super();
    this._client = options.client || null;
    this._apiKey = options.apiKey || null;
    this._defaultModel = options.defaultModel || 'claude-sonnet-4-5-20250929';
    this._defaultMaxTokens = options.defaultMaxTokens || 4096;
    this._maxRetries = options.maxRetries || 3;
    this._retryDelayMs = options.retryDelayMs || 1000;
    this._initialized = false;
  }
}
```

**Design decisions:**

- **Injectable client** — The `options.client` pattern lets tests inject a mock Anthropic SDK client. Production code passes `{ apiKey }` and the adapter creates the real client lazily on first use.
- **Lazy initialization** — The real `@anthropic-ai/sdk` client is created on first `complete()` call, not in the constructor. This avoids import-time side effects and makes the class testable without the SDK installed.
- **Default model** — `claude-sonnet-4-5-20250929` for most operations. Callers can override per-call via `options.model`.
- **No streaming in Phase 1** — `streamComplete()` is implemented but the QA Engine doesn't use streaming yet. Bug Detector and Auto-Fixer both need complete responses for JSON parsing.

### AnthropicAdapter Methods

#### `initialize()`

```javascript
async initialize() {
  if (this._initialized) return;

  if (!this._client) {
    if (!this._apiKey) {
      throw new AdapterError('Anthropic API key required', {
        adapterType: 'llm',
        operation: 'initialize'
      });
    }
    // Dynamic import to avoid hard dependency on SDK at require time
    const Anthropic = require('@anthropic-ai/sdk');
    this._client = new Anthropic({ apiKey: this._apiKey });
  }

  this._initialized = true;
}
```

#### `complete(prompt, options)`

Must match the LLMAdapter interface return shape: `{ content, usage: { inputTokens, outputTokens }, model }`

```javascript
async complete(prompt, options = {}) {
  await this.initialize();

  const model = options.model || this._defaultModel;
  const maxTokens = options.maxTokens || this._defaultMaxTokens;
  const temperature = options.temperature !== undefined ? options.temperature : undefined;
  const systemPrompt = options.systemPrompt || undefined;

  const requestParams = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };

  if (systemPrompt) {
    requestParams.system = systemPrompt;
  }
  if (temperature !== undefined) {
    requestParams.temperature = temperature;
  }

  let lastError;
  for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
    try {
      const response = await this._client.messages.create(requestParams);

      return {
        content: this._extractContent(response),
        usage: {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0
        },
        model: response.model || model
      };
    } catch (error) {
      lastError = error;

      if (this._isRetryable(error) && attempt < this._maxRetries) {
        await this._delay(this._retryDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw new AdapterError(`Anthropic API error: ${error.message}`, {
        adapterType: 'llm',
        operation: 'complete',
        cause: error,
        details: {
          model,
          attempt: attempt + 1,
          statusCode: error.status || null,
          errorType: error.error?.type || null
        }
      });
    }
  }
}
```

#### `streamComplete(prompt, options)`

```javascript
async *streamComplete(prompt, options = {}) {
  await this.initialize();

  const model = options.model || this._defaultModel;
  const maxTokens = options.maxTokens || this._defaultMaxTokens;
  const temperature = options.temperature !== undefined ? options.temperature : undefined;
  const systemPrompt = options.systemPrompt || undefined;

  const requestParams = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };

  if (systemPrompt) requestParams.system = systemPrompt;
  if (temperature !== undefined) requestParams.temperature = temperature;

  try {
    const stream = this._client.messages.stream(requestParams);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield event.delta.text;
      }
    }
  } catch (error) {
    throw new AdapterError(`Anthropic streaming error: ${error.message}`, {
      adapterType: 'llm',
      operation: 'streamComplete',
      cause: error
    });
  }
}
```

#### Internal Helpers

```javascript
_extractContent(response) {
  // Anthropic response.content is an array of content blocks
  // We concatenate all text blocks
  if (!response.content || response.content.length === 0) {
    return '';
  }
  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
}

_isRetryable(error) {
  // Retry on rate limits (429), server errors (500, 502, 503), and overloaded (529)
  const retryableStatuses = [429, 500, 502, 503, 529];
  if (error.status && retryableStatuses.includes(error.status)) {
    return true;
  }
  // Retry on network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }
  return false;
}

async _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 2. Prompt Templates

**File:** `core/integrations/anthropic/prompts.js`

Centralized prompt templates used by Bug Detector and Auto-Fixer. Exported as functions that take structured data and return prompt strings.

```javascript
'use strict';

/**
 * Prompt for Bug Detector's LLM analysis step.
 * Takes evidence and context, returns JSON analysis.
 */
function bugAnalysisPrompt({ appName, agentId, testName, scenarioName, failedStep, errorMessage, consoleErrors, networkFailures, screenshotPath }) {
  return `
You are analyzing a test failure for ${appName}.

TEST INFORMATION:
- Agent: ${agentId}
- Test: ${testName}
- Scenario: ${scenarioName}
- Step that failed: ${failedStep}

ERROR:
${errorMessage}

EVIDENCE:
- Console errors: ${consoleErrors}
- Network failures: ${networkFailures}
${screenshotPath ? `- Screenshot: ${screenshotPath}` : ''}

Analyze and respond with ONLY valid JSON (no markdown, no explanation):
{
  "root_cause": "what actually broke",
  "affected_component": "which part of the app",
  "likely_location": "file/function if determinable, or 'unknown'",
  "impact": "high|medium|low",
  "fix_approach": "high-level strategy to fix",
  "related_bugs": []
}`.trim();
}

/**
 * Prompt for Auto-Fixer's fix generation step.
 * Takes bug details and code context, returns JSON fix plan.
 */
function fixGenerationPrompt({ appName, bugTitle, rootCause, affectedComponent, likelyLocation, fixApproach, relevantCode }) {
  return `
You are fixing a bug in ${appName}.

BUG: ${bugTitle}
ROOT CAUSE: ${rootCause}
AFFECTED COMPONENT: ${affectedComponent}
LIKELY LOCATION: ${likelyLocation}
FIX APPROACH: ${fixApproach}

RELEVANT CODE:
${relevantCode}

CONSTRAINTS:
- Make minimal changes
- Don't break existing functionality
- Add comments explaining the fix
- Include a regression test

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "files_to_modify": [
    {
      "path": "...",
      "changes": [
        {
          "type": "replace|insert|delete",
          "line": 123,
          "old_code": "...",
          "new_code": "..."
        }
      ]
    }
  ],
  "regression_test": {
    "file": "...",
    "test_code": "..."
  },
  "explanation": "..."
}`.trim();
}

/**
 * Prompt for Bug Detector's classification step.
 * Simpler prompt for quick severity/category assessment.
 */
function bugClassificationPrompt({ errorMessage, rootCause, affectedComponent }) {
  return `
Classify this bug based on the information provided.

ERROR: ${errorMessage}
ROOT CAUSE: ${rootCause}
AFFECTED COMPONENT: ${affectedComponent}

Respond with ONLY valid JSON:
{
  "severity": "critical|high|medium|low",
  "category": "memory|data-accuracy|ui|backend|performance|other",
  "confidence": 0.0-1.0
}`.trim();
}

module.exports = {
  bugAnalysisPrompt,
  fixGenerationPrompt,
  bugClassificationPrompt
};
```

**Design decisions:**

- **Pure functions** — Prompts are stateless functions, not methods on a class. Easy to test, easy to compose.
- **JSON-only responses** — Every prompt explicitly asks for "ONLY valid JSON (no markdown, no explanation)." This prevents Claude from wrapping JSON in markdown code blocks.
- **Structured inputs** — Each prompt function takes a destructured object so the caller is explicit about what data it's providing. Missing fields become `undefined` in the template (visible in the prompt, not silently empty).
- **No model selection in prompts** — The prompt doesn't care which model runs it. Model selection is the caller's concern (Bug Detector uses Sonnet for analysis, could use Haiku for classification).

### 3. Barrel Export

**File:** `core/integrations/anthropic/index.js`

```javascript
'use strict';

const AnthropicAdapter = require('./client');
const prompts = require('./prompts');

module.exports = {
  AnthropicAdapter,
  prompts
};
```

### AnthropicAdapter Tests

**File:** `tests/integrations/anthropic/client.test.js`

All tests use an injectable mock client — no real API calls.

#### Mock Client Pattern

```javascript
function createMockClient(overrides = {}) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'claude-sonnet-4-5-20250929'
      }),
      stream: jest.fn().mockReturnValue(mockAsyncIterable([
        { type: 'content_block_delta', delta: { text: 'chunk1' } },
        { type: 'content_block_delta', delta: { text: 'chunk2' } }
      ])),
      ...overrides.messages
    }
  };
}
```

#### Constructor Tests (~5)

- Default model is `claude-sonnet-4-5-20250929`
- Default maxTokens is 4096
- Default maxRetries is 3
- Accepts injectable client
- Accepts apiKey for lazy initialization

#### `initialize()` Tests (~6)

- Creates SDK client from apiKey on first call
- Throws AdapterError when no apiKey and no client provided
- Idempotent — second call is no-op
- Skips SDK creation when client injected
- Sets `_initialized` flag
- AdapterError has correct `adapterType: 'llm'` and `operation: 'initialize'`

#### `complete()` Tests (~22)

- Calls `client.messages.create` with correct params
- Returns `{ content, usage, model }` shape
- Passes model override via options
- Passes maxTokens override via options
- Passes temperature when provided
- Passes systemPrompt as `system` field
- Omits temperature when not provided (no key in params)
- Omits system when no systemPrompt
- Extracts text from single content block
- Extracts and concatenates text from multiple content blocks
- Returns empty string for empty content array
- Handles missing usage gracefully (defaults to 0)
- Auto-initializes on first call
- Retries on 429 rate limit
- Retries on 500 server error
- Retries on 502 bad gateway
- Retries on 503 service unavailable
- Retries on 529 overloaded
- Retries on ECONNRESET network error
- Does NOT retry on 400 bad request
- Does NOT retry on 401 unauthorized
- Throws AdapterError after exhausting retries (with attempt count, statusCode, errorType in details)
- Exponential backoff: delay doubles each retry

#### `streamComplete()` Tests (~6)

- Yields text chunks from stream events
- Ignores non-text events
- Auto-initializes on first call
- Throws AdapterError on stream error
- Handles empty stream (yields nothing)
- AdapterError has correct operation: 'streamComplete'

#### Retry Logic Tests (~5)

- `_isRetryable` returns true for 429, 500, 502, 503, 529
- `_isRetryable` returns false for 400, 401, 403, 404
- `_isRetryable` returns true for ECONNRESET
- `_isRetryable` returns true for ETIMEDOUT
- `_isRetryable` returns false for unknown error codes

### Prompt Template Tests

**File:** `tests/integrations/anthropic/prompts.test.js`

#### `bugAnalysisPrompt` Tests (~6)

- Includes appName in output
- Includes agentId, testName, scenarioName
- Includes errorMessage
- Includes console error count
- Includes network failure count
- Omits screenshot line when screenshotPath is null/undefined

#### `fixGenerationPrompt` Tests (~4)

- Includes bug title and root cause
- Includes relevant code
- Includes constraints section
- Produces valid prompt structure

#### `bugClassificationPrompt` Tests (~3)

- Includes error message
- Includes root cause and affected component
- Requests JSON-only response

### Day 3 Test Summary

| Component | Tests |
|-----------|-------|
| Constructor | ~5 |
| initialize() | ~6 |
| complete() | ~22 |
| streamComplete() | ~6 |
| Retry logic | ~5 |
| Prompt templates | ~13 |
| **Day 3 Total** | **~57** |

---

## Day 4: Twilio WhatsApp Notification Adapter

### Architecture

```
core/integrations/twilio/
├── client.js          # TwilioWhatsAppAdapter class (extends NotificationAdapter)
├── templates.js       # Message templates for notifications
└── index.js           # Barrel export

tests/integrations/twilio/
├── client.test.js
└── templates.test.js
```

### 1. TwilioWhatsAppAdapter

**File:** `core/integrations/twilio/client.js`

```javascript
'use strict';

const NotificationAdapter = require('../adapters/notification');
const { AdapterError } = require('../../engine/errors');

class TwilioWhatsAppAdapter extends NotificationAdapter {
  /**
   * @param {Object} options
   * @param {Object} [options.client] - Injectable Twilio client (for testing)
   * @param {string} [options.accountSid] - Twilio account SID (ignored if client provided)
   * @param {string} [options.authToken] - Twilio auth token (ignored if client provided)
   * @param {string} [options.fromNumber] - WhatsApp-enabled Twilio number (e.g., 'whatsapp:+14155238886')
   * @param {number} [options.maxRetries] - Max retries on transient errors
   * @param {number} [options.retryDelayMs] - Base delay between retries
   */
  constructor(options = {}) {
    super();
    this._client = options.client || null;
    this._accountSid = options.accountSid || null;
    this._authToken = options.authToken || null;
    this._fromNumber = options.fromNumber || null;
    this._maxRetries = options.maxRetries || 2;
    this._retryDelayMs = options.retryDelayMs || 1000;
    this._initialized = false;
  }
}
```

**Design decisions:**

- **Same injectable pattern as AnthropicAdapter** — `options.client` for testing, lazy SDK initialization for production.
- **`fromNumber` includes `whatsapp:` prefix** — Twilio requires the `whatsapp:` prefix on both from and to numbers. The adapter normalizes recipient numbers but requires `fromNumber` to be pre-formatted.
- **Lower default retries (2)** — WhatsApp message delivery is less critical than LLM responses. If Twilio is down, the approval still exists in the database.

### TwilioWhatsAppAdapter Methods

#### `initialize()`

```javascript
async initialize() {
  if (this._initialized) return;

  if (!this._client) {
    if (!this._accountSid || !this._authToken) {
      throw new AdapterError('Twilio account SID and auth token required', {
        adapterType: 'notification',
        operation: 'initialize'
      });
    }
    if (!this._fromNumber) {
      throw new AdapterError('Twilio from number required', {
        adapterType: 'notification',
        operation: 'initialize'
      });
    }
    const twilio = require('twilio');
    this._client = twilio(this._accountSid, this._authToken);
  }

  this._initialized = true;
}
```

#### `send(recipient, message)`

Must match NotificationAdapter interface: returns `{ id, status }`

```javascript
async send(recipient, message) {
  await this.initialize();

  const to = this._normalizeRecipient(recipient);

  let lastError;
  for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
    try {
      const result = await this._client.messages.create({
        body: message,
        from: this._fromNumber,
        to
      });

      return {
        id: result.sid,
        status: this._mapStatus(result.status)
      };
    } catch (error) {
      lastError = error;

      if (this._isRetryable(error) && attempt < this._maxRetries) {
        await this._delay(this._retryDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw new AdapterError(`Twilio send error: ${error.message}`, {
        adapterType: 'notification',
        operation: 'send',
        cause: error,
        details: {
          recipient: this._redactNumber(to),
          attempt: attempt + 1,
          statusCode: error.status || null,
          twilioCode: error.code || null
        }
      });
    }
  }
}
```

#### `sendWithActions(recipient, message, actions)`

WhatsApp doesn't support interactive buttons via Twilio's basic API. Instead, we append action instructions as text.

```javascript
async sendWithActions(recipient, message, actions) {
  // Format actions as reply instructions appended to the message
  const actionLines = actions.map(a => `• Reply "${a.id}" to ${a.label}`).join('\n');
  const fullMessage = `${message}\n\n${actionLines}`;

  return this.send(recipient, fullMessage);
}
```

**Design decision:** The architecture spec shows approval messages like `YES-ABC-247 | NO-ABC-247`. Since WhatsApp Business API interactive buttons require template pre-approval from Meta (complex setup), we use plain text instructions. The ApprovalManager already generates the approval ID and formats the message — `sendWithActions` just appends action labels as reply instructions. This works today and can be upgraded to interactive buttons in Phase 3 without changing the interface.

#### Internal Helpers

```javascript
_normalizeRecipient(recipient) {
  // Handle array (send to first — batch not supported in Phase 1)
  const number = Array.isArray(recipient) ? recipient[0] : recipient;

  // Add whatsapp: prefix if missing
  if (!number.startsWith('whatsapp:')) {
    return `whatsapp:${number}`;
  }
  return number;
}

_mapStatus(twilioStatus) {
  // Twilio statuses: queued, sending, sent, delivered, undelivered, failed, read
  const statusMap = {
    'queued': 'pending',
    'sending': 'pending',
    'sent': 'sent',
    'delivered': 'delivered',
    'undelivered': 'failed',
    'failed': 'failed',
    'read': 'delivered'
  };
  return statusMap[twilioStatus] || 'unknown';
}

_redactNumber(number) {
  // Redact all but last 4 digits for error logging
  // 'whatsapp:+14155238886' → 'whatsapp:+*******8886'
  return number.replace(/(\+?\d*)(\d{4})$/, (_, prefix, last4) => {
    return '*'.repeat(prefix.length) + last4;
  });
}

_isRetryable(error) {
  // Retry on Twilio server errors and rate limits
  const retryableCodes = [
    20429,  // Too many requests
    20500,  // Internal server error
    20503,  // Service unavailable
  ];
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }
  // Retry on network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }
  return false;
}

async _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 2. Message Templates

**File:** `core/integrations/twilio/templates.js`

Message templates for different notification types. Used by the engine's wiring layer when composing messages to send through the adapter.

```javascript
'use strict';

const SEVERITY_EMOJI = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢'
};

const STATUS_EMOJI = {
  passed: '✅',
  failed: '❌',
  error: '⚠️'
};

/**
 * Format approval request message.
 * Used by ApprovalManager before sending via NotificationAdapter.
 */
function approvalRequestMessage({ bug, approvalId }) {
  const emoji = SEVERITY_EMOJI[bug.severity] || '⚪';
  return [
    `${emoji} Bug Detected: ${bug.title}`,
    '',
    `ID: ${bug.bug_id}`,
    `Severity: ${bug.severity}`,
    `Component: ${bug.affected_component || 'Unknown'}`,
    `Root Cause: ${bug.root_cause || 'Under analysis'}`,
    '',
    `Fix Approach: ${bug.fix_approach || 'N/A'}`,
    '',
    `Approve auto-fix?`,
    `• YES-${approvalId}`,
    `• NO-${approvalId}`,
    `• INFO-${approvalId}`,
    '',
    bug.external_issue_url ? `Details: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Format test run summary message.
 */
function testRunSummaryMessage({ appName, summary, testRunId }) {
  const emoji = summary.failed === 0 ? STATUS_EMOJI.passed : STATUS_EMOJI.failed;
  const lines = [
    `${emoji} Test Run Complete: ${appName}`,
    '',
    `Total: ${summary.total_tests || summary.total || 0}`,
    `Passed: ${summary.passed || 0}`,
    `Failed: ${summary.failed || 0}`,
    `Pass Rate: ${(summary.pass_rate || 0).toFixed(1)}%`,
    `Duration: ${((summary.duration_ms || 0) / 1000).toFixed(1)}s`
  ];

  if (summary.bugs_created > 0) {
    lines.push('', `🐛 ${summary.bugs_created} bug(s) created`);
  }

  return lines.join('\n');
}

/**
 * Format fix result notification.
 */
function fixResultMessage({ bug, success, error }) {
  if (success) {
    return [
      `✅ Bug Fixed: ${bug.title}`,
      '',
      `ID: ${bug.bug_id}`,
      `Fix verified and applied successfully.`
    ].join('\n');
  }

  return [
    `❌ Auto-Fix Failed: ${bug.title}`,
    '',
    `ID: ${bug.bug_id}`,
    `Error: ${error || 'Unknown error'}`,
    '',
    `Marked as needs-manual-fix.`,
    bug.external_issue_url ? `Details: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Format bug info response (for INFO-{approvalId} replies).
 */
function bugInfoMessage({ bug }) {
  const emoji = SEVERITY_EMOJI[bug.severity] || '⚪';
  return [
    `${emoji} ${bug.bug_id}: ${bug.title}`,
    '',
    `Severity: ${bug.severity}`,
    `Category: ${bug.category}`,
    `Status: ${bug.status}`,
    '',
    `Root Cause: ${bug.root_cause || 'Unknown'}`,
    `Component: ${bug.affected_component || 'Unknown'}`,
    `Location: ${bug.likely_location || 'Unknown'}`,
    '',
    `Fix Approach: ${bug.fix_approach || 'N/A'}`,
    `Auto-fixable: ${bug.auto_fixable ? 'Yes' : 'No'}`,
    '',
    bug.external_issue_url ? `Linear: ${bug.external_issue_url}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  SEVERITY_EMOJI,
  STATUS_EMOJI,
  approvalRequestMessage,
  testRunSummaryMessage,
  fixResultMessage,
  bugInfoMessage
};
```

### 3. Barrel Export

**File:** `core/integrations/twilio/index.js`

```javascript
'use strict';

const TwilioWhatsAppAdapter = require('./client');
const templates = require('./templates');

module.exports = {
  TwilioWhatsAppAdapter,
  templates
};
```

### TwilioWhatsAppAdapter Tests

**File:** `tests/integrations/twilio/client.test.js`

All tests use an injectable mock Twilio client — no real API calls, no Twilio SDK needed.

#### Mock Client Pattern

```javascript
function createMockTwilioClient(overrides = {}) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        sid: 'SM_test_message_id_123',
        status: 'queued'
      }),
      ...overrides.messages
    }
  };
}
```

#### Constructor Tests (~4)

- Default maxRetries is 2
- Default retryDelayMs is 1000
- Accepts injectable client
- Accepts accountSid + authToken for lazy init

#### `initialize()` Tests (~6)

- Creates Twilio client from accountSid + authToken
- Throws AdapterError when no accountSid
- Throws AdapterError when no authToken
- Throws AdapterError when no fromNumber (without injected client)
- Idempotent — second call is no-op
- Skips SDK creation when client injected

#### `send()` Tests (~16)

- Calls `client.messages.create` with correct body, from, to
- Returns `{ id, status }` with Twilio SID as id
- Auto-initializes on first call
- Adds `whatsapp:` prefix to bare phone number
- Passes through number that already has `whatsapp:` prefix
- Handles array recipient (uses first)
- Maps 'queued' to 'pending'
- Maps 'sent' to 'sent'
- Maps 'delivered' to 'delivered'
- Maps 'failed' to 'failed'
- Maps 'undelivered' to 'failed'
- Maps 'read' to 'delivered'
- Maps unknown status to 'unknown'
- Retries on Twilio rate limit (code 20429)
- Retries on Twilio server error (code 20500)
- Does NOT retry on invalid number (code 21211)
- Throws AdapterError after exhausting retries (with redacted number, twilioCode in details)

#### `sendWithActions()` Tests (~5)

- Appends action labels to message
- Formats actions as "Reply X to Y" instructions
- Delegates to send() with combined message
- Returns same `{ id, status }` shape as send()
- Handles multiple actions

#### Recipient Normalization Tests (~4)

- `_normalizeRecipient` adds prefix to bare number
- `_normalizeRecipient` preserves existing prefix
- `_normalizeRecipient` handles '+' country code
- `_normalizeRecipient` extracts first from array

#### Number Redaction Tests (~3)

- `_redactNumber` keeps last 4 digits
- `_redactNumber` handles whatsapp: prefix
- `_redactNumber` handles short numbers

#### Retry Logic Tests (~4)

- `_isRetryable` returns true for 20429
- `_isRetryable` returns true for 20500
- `_isRetryable` returns false for 21211 (invalid number)
- `_isRetryable` returns true for ECONNRESET

### Message Template Tests

**File:** `tests/integrations/twilio/templates.test.js`

#### `approvalRequestMessage` Tests (~6)

- Includes severity emoji
- Includes bug title and bug_id
- Includes YES/NO/INFO with approval ID
- Includes external issue URL when present
- Omits external issue URL when absent
- Includes root cause and affected component

#### `testRunSummaryMessage` Tests (~5)

- Shows ✅ emoji when no failures
- Shows ❌ emoji when failures exist
- Includes all summary fields (total, passed, failed, rate, duration)
- Includes bug count when bugs_created > 0
- Omits bug line when bugs_created is 0

#### `fixResultMessage` Tests (~3)

- Success case includes ✅ and verification message
- Failure case includes ❌ and error message
- Failure case includes external issue URL when present

#### `bugInfoMessage` Tests (~3)

- Includes all bug fields
- Uses correct severity emoji
- Handles missing optional fields gracefully

### Day 4 Test Summary

| Component | Tests |
|-----------|-------|
| Constructor | ~4 |
| initialize() | ~6 |
| send() | ~16 |
| sendWithActions() | ~5 |
| Recipient normalization | ~4 |
| Number redaction | ~3 |
| Retry logic | ~4 |
| Message templates | ~17 |
| **Day 4 Total** | **~59** |

---

## Combined Days 3-4 Summary

| Day | Component | Tests |
|-----|-----------|-------|
| 3 | Anthropic LLM Adapter | ~57 |
| 4 | Twilio WhatsApp Adapter | ~59 |
| **Total** | | **~116** |

**Running total after Week 4 Days 3-4: ~1527 tests** (1411 after Days 1-2 + 116 new)

---

## File Checklist

### Day 3

- [ ] `core/integrations/anthropic/client.js`
- [ ] `core/integrations/anthropic/prompts.js`
- [ ] `core/integrations/anthropic/index.js`
- [ ] `tests/integrations/anthropic/client.test.js`
- [ ] `tests/integrations/anthropic/prompts.test.js`

### Day 4

- [ ] `core/integrations/twilio/client.js`
- [ ] `core/integrations/twilio/templates.js`
- [ ] `core/integrations/twilio/index.js`
- [ ] `tests/integrations/twilio/client.test.js`
- [ ] `tests/integrations/twilio/templates.test.js`

---

## Integration Points

### How These Adapters Connect to Existing Components

Neither adapter modifies existing components. They implement interfaces that existing components already accept via constructor injection.

**Bug Detector** currently receives `{ llm }` in its constructor. To use the real adapter:
```javascript
const { AnthropicAdapter } = require('./core/integrations/anthropic');
const llm = new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY });
const bugDetector = new BugDetector({ llm });
```

**Auto-Fixer** currently receives `{ llm }` in its constructor. Same pattern:
```javascript
const autoFixer = new AutoFixer({ llm });
```

**Approval Manager** currently receives `{ notifier }` in its constructor:
```javascript
const { TwilioWhatsAppAdapter } = require('./core/integrations/twilio');
const notifier = new TwilioWhatsAppAdapter({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_WHATSAPP_FROM
});
const approvalManager = new ApprovalManager({ notifier });
```

**Orchestrator** receives `{ notifier }` for test run summary notifications:
```javascript
const orchestrator = new TestOrchestrator({ notifier });
```

This wiring happens in the engine assembly layer (Day 5 / Week 5), not in the adapters themselves.

### What Does NOT Change

- No existing constructor signatures change
- No existing test files are modified
- LLMAdapter and NotificationAdapter base classes are untouched
- Bug Detector, Auto-Fixer, Approval Manager source code is untouched
- All existing tests continue to pass without adapter involvement

---

## Error Handling Patterns

Both adapters follow the same error conventions:

1. **All thrown errors are `AdapterError`** — from `core/engine/errors.js`, extends `EngineError`
2. **`adapterType`** — always set ('llm' or 'notification')
3. **`operation`** — which method threw ('complete', 'send', 'initialize', etc.)
4. **`cause`** — original SDK error for debugging
5. **`details`** — structured context (model, statusCode, attempt count, redacted recipient)

Consumers (Bug Detector, Approval Manager) already handle `AdapterError` in their existing error paths.

---

## Dependencies

### Required npm packages

```json
{
  "@anthropic-ai/sdk": "^0.39.x",
  "twilio": "^5.x"
}
```

These are production dependencies — they're only `require()`'d inside `initialize()` to avoid import-time failures when credentials aren't configured.

### Environment Variables

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
ALERT_PHONE_NUMBER=+1234567890
```

---

## Validation Criteria

### Day 3 Complete When:
- [ ] `AnthropicAdapter.complete()` returns correct `{ content, usage, model }` shape
- [ ] Retries work for 429, 500, 502, 503, 529 status codes
- [ ] Non-retryable errors throw immediately
- [ ] All prompt templates produce valid prompt strings
- [ ] Mock client injection works — zero real API calls in tests
- [ ] ~57 new tests passing
- [ ] All existing tests still passing

### Day 4 Complete When:
- [ ] `TwilioWhatsAppAdapter.send()` returns correct `{ id, status }` shape
- [ ] `sendWithActions()` appends action instructions to message
- [ ] Recipient normalization adds `whatsapp:` prefix correctly
- [ ] Number redaction works for error logging
- [ ] All message templates produce correctly formatted WhatsApp messages
- [ ] Mock client injection works — zero real API calls in tests
- [ ] ~59 new tests passing
- [ ] All existing tests still passing
- [ ] Zero regressions throughout
