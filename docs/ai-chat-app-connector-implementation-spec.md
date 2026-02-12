# QA Engine: AIAppConnector Implementation Specification

**Phase:** 1, Week 1, Days 3-4  
**Purpose:** Implementation-ready spec for `connectors/ai-chat-app/connector.js`  
**For:** Claude Code evaluation → implementation  
**References:** qa-engine-03-connector-pattern-spec.md, generic-web-app-connector-implementation-spec.md  
**Depends on:** `connectors/generic-web-app/connector.js` (implemented), `connectors/errors.js` (implemented)  
**Depended on by:** `connectors/brainstormy/connector.js` (BrainstormyConnector — next deliverable)

---

## 1. Design Decisions

### Role in the System

AIAppConnector is the **chat-layer adapter** — it knows how to interact with any AI-powered chat application. It doesn't know about Brainstormy specifically (that's BrainstormyConnector's job), but it knows the universal patterns of AI chat interfaces: sending messages, waiting for streaming responses, tracking conversation history, and validating AI memory.

```
BaseConnector (abstract — contract)
    ↓
GenericWebAppConnector (Playwright interactions + evidence wrapping)
    ↓
AIAppConnector (THIS — chat-specific actions)
    ↓
BrainstormyConnector (Brainstormy-specific: projects, stories, sessions, bibles)
```

### Key Design Principles

1. **Chat is a conversation, not a click.** The fundamental interaction unit shifts from "click a selector" to "send a message and wait for a response." AIAppConnector's methods reflect this: `sendMessage`, `waitForAIResponse`, `getConversationHistory`, `validateMemory`.

2. **State tracks the conversation.** AIAppConnector maintains a `messages` array in connector state that mirrors the chat history. Every `sendMessage` pushes a user message; every `waitForAIResponse` pushes an assistant message. This gives agents a complete conversation record without scraping the DOM.

3. **Streaming awareness.** AI apps show a generating indicator while the model is producing output. `waitForAIResponse` must wait for generation to complete (indicator disappears) before extracting the response text. `isGenerating` and `waitForGenerationComplete` handle this.

4. **Evidence wrapping for AI actions.** AIAppConnector's `performAction` wraps its own actions (send_message, wait_for_response, etc.) with before/after/failure evidence, just as GenericWebAppConnector does for generic actions. Unrecognized actions fall through to `super.performAction()` which has its own evidence wrapping. This means agents get evidence regardless of which action they call.

### What Changes from the Original Spec

The qa-engine-03-connector-pattern-spec.md has the right methods but predates the evidence-wrapping `performAction` pattern established by GenericWebAppConnector. Key adjustments:

- **performAction wraps with evidence.** The original spec's AIAppConnector.performAction was a plain switch/dispatch. Now it follows the same before/try/catch/after pattern as GenericWebAppConnector for its own actions.
- **Error types.** Original used `throw new Error(...)`. Now uses `ConnectorTimeoutError` for generation timeouts.
- **waitForAIResponse is smarter.** Waits for generation to complete (indicator gone) before extracting, rather than just waiting for a message element to appear.
- **sendMessage returns structured data.** Returns `{ text, timestamp, messageIndex }` instead of just `{ text, timestamp }`.

---

## 2. Complete Method Inventory

### 2.1 Chat Interaction Methods (new — added by this class)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `sendMessage(text)` | `async (string) → {text, timestamp, messageIndex}` | Type text into chat input, click send, track in state. |
| `waitForAIResponse(timeout?)` | `async (number?) → {text, html, timestamp, messageIndex}` | Wait for generation to complete, extract response, track in state. |
| `getConversationHistory()` | `async () → Array` | Return accumulated messages from state. |
| `validateMemory(query, expected)` | `async (string, string) → {query, expected, response, found, timestamp}` | Send a question, check if response contains expected content. |

### 2.2 Generation Detection Methods (new)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `isGenerating()` | `async () → boolean` | Check if the generating indicator is visible. |
| `waitForGenerationComplete(timeout?)` | `async (number?) → void` | Poll until generating indicator disappears. |

### 2.3 Overridden Methods

| Method | Why overridden |
|--------|----------------|
| `performAction(action, params)` | Adds AI-specific action dispatch with evidence wrapping. Unrecognized actions fall through to `super.performAction()`. |

### 2.4 Inherited Methods (NOT overridden)

Everything from GenericWebAppConnector works as-is: `initialize`, `cleanup`, `authenticate`, `logout`, `isAuthenticated`, `navigate`, `waitForNavigation`, `click`, `type`, `select`, `waitFor`, `extractData`, `extractMultiple`, `exists`, `waitForAppReady`, `_wrapPlaywrightError`, and all BaseConnector helpers.

---

## 3. performAction — Evidence Wrapping for AI Actions

### The Design Problem

GenericWebAppConnector.performAction wraps generic actions (`click`, `type`, etc.) with evidence. But when an agent calls `performAction('send_message', ...)`, it hits AIAppConnector first. If AIAppConnector just dispatches to `sendMessage()` without evidence, the agent gets no before/after screenshots for chat actions.

### The Solution

AIAppConnector.performAction follows the same evidence pattern as GenericWebAppConnector for its own actions. For unrecognized actions, it delegates to `super.performAction()` which handles evidence wrapping for generic actions.

```
Agent calls performAction('send_message', { text: 'hello' })
  → AIAppConnector.performAction
    → captures before evidence
    → dispatches to this.sendMessage('hello')
    → captures after evidence (or failure evidence on error)
    → returns result

Agent calls performAction('click', { selector: '#btn' })
  → AIAppConnector.performAction
    → default case → super.performAction('click', { selector: '#btn' })
      → GenericWebAppConnector captures before evidence
      → dispatches to this.click('#btn')
      → captures after evidence
    → returns result
```

### Why not just wrap in AIAppConnector and skip super's wrapping?

Because GenericWebAppConnector's evidence wrapping is tightly coupled to its switch dispatch — it wraps the call to `this.click()`, not the call from `performAction`. If we removed evidence from GenericWebAppConnector and only wrapped at the AIAppConnector level, we'd need to duplicate the entire generic switch block. The cleaner design is: each level wraps its own actions and delegates the rest.

### Supported Actions (AI-specific)

| Action string | Dispatches to | Required params |
|---|---|---|
| `'send_message'` | `this.sendMessage(params.text)` | `{ text }` |
| `'wait_for_response'` | `this.waitForAIResponse(params.timeout)` | `{ timeout? }` |
| `'get_conversation'` | `this.getConversationHistory()` | none |
| `'validate_memory'` | `this.validateMemory(params.query, params.expected)` | `{ query, expected }` |
| anything else | `super.performAction(action, params)` | — (handled by GenericWebAppConnector) |

---

## 4. waitForAIResponse — Streaming Awareness

### The Problem

AI chat apps show responses progressively (streaming). If we extract the response text as soon as a message element appears, we get a partial response. We need to wait for generation to finish.

### The Flow

```
1. Get the count of existing AI messages → messageCountBefore
2. Wait for a NEW AI message to appear (count increases)
3. Wait for generation to complete (indicator disappears)
4. Brief settle pause (500ms) for final DOM updates
5. Extract the last AI message text
6. Push to state as assistant message
7. Return response object
```

### Detecting "new message appeared"

Rather than using `:last-child` (which might match a pre-existing message), we count messages before and after:

```javascript
// Before sending: count existing AI messages
const aiMessageSelector = this.getSelector('ai_message');
const beforeCount = (await this.page.$$(aiMessageSelector)).length;

// ... message is sent ...

// Wait for new message to appear (count increases)
await this.page.waitForFunction(
  ({ selector, before }) => document.querySelectorAll(selector).length > before,
  { selector: aiMessageSelector, before: beforeCount },
  { timeout }
);
```

This is more robust than `:last-child` because it handles cases where the DOM structure changes during streaming.

### Generation Complete Detection

Two strategies, tried in order:

1. **Indicator-based:** If `generating_indicator` selector is configured, poll until it disappears.
2. **Timeout-based:** If no indicator configured, wait a fixed settle period (2 seconds) after the message element appears.

---

## 5. validateMemory — The Core Test Primitive

Memory validation is the most important method for QA testing AI chat apps. It sends a question and checks if the AI "remembers" something.

### Flow

```
1. sendMessage(query)        — "What character did I introduce?"
2. waitForAIResponse()       — wait for AI to answer
3. Compare: response.text.toLowerCase().includes(expected.toLowerCase())
4. Return { query, expected, response, found, timestamp }
```

### Design Choice: Case-Insensitive Substring Match

Simple and intentional. For Phase 1, checking if "marcus" appears in the response is sufficient. Agents that need more sophisticated matching (semantic similarity, exact JSON structure, etc.) can call `sendMessage` + `waitForAIResponse` directly and apply their own assertions.

---

## 6. Complete Implementation

```javascript
// connectors/ai-chat-app/connector.js

'use strict';

const GenericWebAppConnector = require('../generic-web-app/connector');
const {
  ConnectorError,
  ConnectorTimeoutError
} = require('../errors');

/**
 * Connector for AI-powered chat applications.
 *
 * Adds chat-specific interactions on top of GenericWebAppConnector:
 * - Send messages and track conversation history
 * - Wait for AI responses with streaming awareness
 * - Validate AI memory across conversation turns
 *
 * Requires these selectors in app config:
 *   chat_input          — the message input field
 *   chat_send           — the send button
 *   ai_message          — selector matching AI response message elements
 *   generating_indicator — (optional) element visible while AI is generating
 *
 * Requires these timeouts in app config:
 *   ai_response          — (optional, default 60000) max wait for AI response
 *
 * Inheritance chain:
 *   BaseConnector → GenericWebAppConnector → AIAppConnector (this) → [App]Connector
 *
 * @example
 * const connector = new AIAppConnector(appConfig, page, evidenceCollector);
 * await connector.initialize();
 * await connector.performAction('send_message', { text: 'Hello' });
 * const response = await connector.performAction('wait_for_response');
 * const memory = await connector.performAction('validate_memory', {
 *   query: 'What did I say?',
 *   expected: 'Hello'
 * });
 */
class AIAppConnector extends GenericWebAppConnector {

  // ===================================================================
  // ACTION DISPATCH — Overrides GenericWebAppConnector
  // ===================================================================

  /**
   * Evidence-wrapping dispatcher for AI-specific actions.
   *
   * Handles: send_message, wait_for_response, get_conversation, validate_memory.
   * Unrecognized actions fall through to super.performAction() which handles
   * generic actions (click, type, navigate, etc.) with its own evidence wrapping.
   *
   * @param {string} action - Action type
   * @param {object} [params={}] - Action-specific parameters
   * @returns {Promise<any>} Action result
   */
  async performAction(action, params = {}) {
    // Check if this is an AI-specific action
    const aiActions = ['send_message', 'wait_for_response', 'get_conversation', 'validate_memory'];

    if (!aiActions.includes(action)) {
      // Not ours — delegate to GenericWebAppConnector (which handles evidence)
      return await super.performAction(action, params);
    }

    // AI-specific action — wrap with evidence
    const stepId = `${action}_${Date.now()}`;
    await this.collectEvidence(`before_${stepId}`);

    let result;
    try {
      switch (action) {
        case 'send_message':
          result = await this.sendMessage(params.text);
          break;
        case 'wait_for_response':
          result = await this.waitForAIResponse(params.timeout);
          break;
        case 'get_conversation':
          result = await this.getConversationHistory();
          break;
        case 'validate_memory':
          result = await this.validateMemory(params.query, params.expected);
          break;
      }
    } catch (error) {
      await this.collectEvidence(`failed_${stepId}`);
      throw error;
    }

    await this.collectEvidence(`after_${stepId}`);
    return result;
  }

  // ===================================================================
  // CHAT INTERACTION
  // ===================================================================

  /**
   * Send a message in the chat interface.
   *
   * Types into the chat input and clicks send. Tracks the message
   * in connector state for conversation history.
   *
   * @param {string} text - Message text to send
   * @returns {Promise<{text: string, timestamp: string, messageIndex: number}>}
   * @throws {ConnectorError} If chat_input or chat_send selectors are missing
   */
  async sendMessage(text) {
    const inputSelector = this.getSelector('chat_input');
    const sendSelector = this.getSelector('chat_send');

    if (!inputSelector || !sendSelector) {
      throw new ConnectorError(
        'Missing chat selectors in config (need: chat_input, chat_send)',
        { action: 'send_message', phase: 'interact' }
      );
    }

    // Type message and send
    await this.type(inputSelector, text);
    await this.click(sendSelector);

    // Track in state
    const messages = this.getState('messages') || [];
    const entry = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };
    messages.push(entry);
    this.setState('messages', messages);

    return {
      text,
      timestamp: entry.timestamp,
      messageIndex: messages.length - 1
    };
  }

  /**
   * Wait for the AI to respond.
   *
   * Waits for a new AI message element to appear, then waits for
   * generation to complete (streaming finished), then extracts the
   * response text. Tracks the response in connector state.
   *
   * @param {number} [timeout] - Max wait in ms (default: config ai_response or 60000)
   * @returns {Promise<{text: string, html: string, timestamp: string, messageIndex: number}>}
   * @throws {ConnectorTimeoutError} If AI doesn't respond within timeout
   */
  async waitForAIResponse(timeout) {
    const effectiveTimeout = timeout ?? this.getTimeout('ai_response', 60000);
    const aiMessageSelector = this.getSelector('ai_message');

    if (!aiMessageSelector) {
      throw new ConnectorError(
        'Missing ai_message selector in config',
        { action: 'wait_for_response', phase: 'interact' }
      );
    }

    try {
      // Count existing AI messages before waiting
      const existingMessages = await this.page.$$(aiMessageSelector);
      const beforeCount = existingMessages.length;

      // Wait for a NEW AI message to appear (count increases)
      await this.page.waitForFunction(
        ({ selector, before }) => document.querySelectorAll(selector).length > before,
        { selector: aiMessageSelector, before: beforeCount },
        { timeout: effectiveTimeout }
      );

      // Wait for generation to complete (streaming finished)
      await this.waitForGenerationComplete(effectiveTimeout);

      // Brief settle for final DOM updates
      await this.page.waitForTimeout(500);

      // Extract the last AI message
      const allMessages = await this.page.$$(aiMessageSelector);
      const lastMessage = allMessages[allMessages.length - 1];

      let responseData = { text: '', html: '' };
      if (lastMessage) {
        responseData = await lastMessage.evaluate(el => ({
          text: el.textContent,
          html: el.innerHTML
        }));
      }

      // Track in state
      const messages = this.getState('messages') || [];
      const entry = {
        role: 'assistant',
        content: responseData.text,
        timestamp: new Date().toISOString()
      };
      messages.push(entry);
      this.setState('messages', messages);

      return {
        text: responseData.text,
        html: responseData.html,
        timestamp: entry.timestamp,
        messageIndex: messages.length - 1
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        throw error;
      }
      throw this._wrapPlaywrightError(error, {
        action: 'wait_for_response',
        selector: aiMessageSelector
      });
    }
  }

  /**
   * Get the accumulated conversation history from connector state.
   *
   * @returns {Promise<Array<{role: string, content: string, timestamp: string}>>}
   */
  async getConversationHistory() {
    return this.getState('messages') || [];
  }

  /**
   * Validate that the AI remembers something by asking a question
   * and checking if the response contains the expected content.
   *
   * Uses case-insensitive substring matching. For more sophisticated
   * matching, agents should call sendMessage + waitForAIResponse
   * directly and apply their own assertions.
   *
   * @param {string} query - Question to ask the AI
   * @param {string} expected - Expected substring in the response
   * @returns {Promise<{query: string, expected: string, response: string, found: boolean, timestamp: string}>}
   */
  async validateMemory(query, expected) {
    // Send the question
    await this.sendMessage(query);

    // Wait for response
    const response = await this.waitForAIResponse();

    // Check if expected content is present (case-insensitive)
    const found = response.text.toLowerCase().includes(expected.toLowerCase());

    return {
      query,
      expected,
      response: response.text,
      found,
      timestamp: new Date().toISOString()
    };
  }

  // ===================================================================
  // GENERATION DETECTION
  // ===================================================================

  /**
   * Check if the AI is currently generating a response.
   * Returns false if no generating_indicator is configured.
   *
   * @returns {Promise<boolean>}
   */
  async isGenerating() {
    const indicator = this.getSelector('generating_indicator');
    if (!indicator) {
      return false;
    }
    return await this.exists(indicator);
  }

  /**
   * Wait for AI generation to complete (indicator disappears).
   *
   * If no generating_indicator is configured, waits a fixed 2-second
   * settle period as a fallback.
   *
   * @param {number} [timeout=120000] - Maximum wait time in ms
   * @throws {ConnectorTimeoutError} If generation doesn't complete within timeout
   */
  async waitForGenerationComplete(timeout = 120000) {
    const indicator = this.getSelector('generating_indicator');

    if (!indicator) {
      // No indicator configured — use fixed settle period
      await this.page.waitForTimeout(2000);
      return;
    }

    const start = Date.now();
    while (await this.exists(indicator)) {
      if (Date.now() - start > timeout) {
        throw new ConnectorTimeoutError(
          `AI generation did not complete within ${timeout}ms`,
          { action: 'waitForGenerationComplete', phase: 'interact', recoverable: true }
        );
      }
      await this.page.waitForTimeout(500);
    }
  }
}

module.exports = AIAppConnector;
```

---

## 7. Unit Test Specification

```javascript
// tests/connectors/ai-chat-app-connector.test.js — Test outline

describe('AIAppConnector', () => {

  describe('Constructor / Instantiation', () => {
    test('can be instantiated directly');
    test('inherits from GenericWebAppConnector');
    test('inherits from BaseConnector');
  });

  describe('performAction() — AI action dispatch', () => {
    test('dispatches send_message to sendMessage()');
    test('dispatches wait_for_response to waitForAIResponse()');
    test('dispatches get_conversation to getConversationHistory()');
    test('dispatches validate_memory to validateMemory()');
    test('delegates click to super.performAction()');
    test('delegates type to super.performAction()');
    test('delegates navigate to super.performAction()');
    test('delegates unknown action to super.performAction()');
    test('captures before evidence for AI actions');
    test('captures after evidence for AI actions on success');
    test('captures failure evidence for AI actions on error');
    test('does NOT double-capture evidence for delegated generic actions');
  });

  describe('sendMessage()', () => {
    test('types text into chat_input selector');
    test('clicks chat_send selector');
    test('pushes user message to state messages array');
    test('returns text, timestamp, and messageIndex');
    test('increments messageIndex with each call');
    test('throws ConnectorError when chat_input selector missing');
    test('throws ConnectorError when chat_send selector missing');
  });

  describe('waitForAIResponse()', () => {
    test('waits for new AI message element to appear');
    test('waits for generation to complete before extracting');
    test('extracts text and html from last AI message');
    test('pushes assistant message to state messages array');
    test('returns text, html, timestamp, and messageIndex');
    test('uses config ai_response timeout when no timeout param');
    test('uses provided timeout parameter over config');
    test('defaults to 60000ms when no config and no param');
    test('throws ConnectorTimeoutError when AI does not respond');
    test('throws ConnectorError when ai_message selector missing');
    test('wraps Playwright errors via _wrapPlaywrightError');
  });

  describe('getConversationHistory()', () => {
    test('returns empty array when no messages sent');
    test('returns accumulated user and assistant messages');
    test('messages are in chronological order');
    test('each message has role, content, timestamp');
  });

  describe('validateMemory()', () => {
    test('sends query via sendMessage');
    test('waits for response via waitForAIResponse');
    test('returns found=true when response contains expected (exact case)');
    test('returns found=true when response contains expected (different case)');
    test('returns found=false when response does not contain expected');
    test('includes full response text in result');
    test('includes query and expected in result');
  });

  describe('isGenerating()', () => {
    test('returns true when generating_indicator element exists');
    test('returns false when generating_indicator element missing');
    test('returns false when generating_indicator not configured');
  });

  describe('waitForGenerationComplete()', () => {
    test('polls until generating indicator disappears');
    test('returns immediately when indicator not visible');
    test('uses 2-second settle when no indicator configured');
    test('throws ConnectorTimeoutError when generation exceeds timeout');
    test('polls at 500ms intervals');
  });

  describe('State management — conversation tracking', () => {
    test('sendMessage + waitForAIResponse builds conversation array');
    test('multiple exchanges maintain correct order');
    test('validateMemory adds both user and assistant messages to history');
    test('clearState resets conversation history');
  });

  describe('Inherited behavior (smoke tests)', () => {
    test('initialize authenticates and waits for ready');
    test('cleanup logs out and clears state');
    test('click/type/select work through super');
    test('evidence collection delegates to EvidenceCollector');
  });
});
```

---

## 8. Mock Requirements

### Enhanced Mock Page for AI Tests

AIAppConnector uses two Playwright APIs that the current mocks don't cover:

1. **`page.waitForFunction(fn, arg, options)`** — Used to wait for new AI message element to appear by counting DOM elements.
2. **`page.$$(selector)` returning multiple elements** — Already mocked, but needs per-test configuration to simulate "messages appearing."

Add to `tests/helpers/mock-playwright.js`:

```javascript
// Add to createMockPage
waitForFunction: jest.fn().mockResolvedValue(undefined),
```

### Mock Element for AI Messages

Tests need to simulate extracting text from AI message elements:

```javascript
function createMockAIMessage(text, html) {
  return createMockElement({
    text: text || 'AI response text',
    html: html || '<p>AI response text</p>'
  });
}
```

### Test Helper: Simulate Conversation

Many tests need a mock page that simulates the send-and-receive flow:

```javascript
function setupConversationMocks(mockPage, responses = ['AI response']) {
  let messageCount = 0;

  // $$ returns increasing number of "AI messages" after each waitForFunction
  mockPage.waitForFunction.mockImplementation(async () => {
    messageCount++;
  });

  mockPage.$$.mockImplementation(async (selector) => {
    // Return messageCount mock elements
    return Array.from({ length: messageCount }, (_, i) =>
      createMockElement({
        text: responses[i] || `Response ${i + 1}`,
        html: `<p>${responses[i] || `Response ${i + 1}`}</p>`
      })
    );
  });
}
```

---

## 9. Implementation Order for Claude Code

### Step 1: Extend Mock Helpers

| Task | Details |
|------|---------|
| Add `waitForFunction` to `createMockPage` | `jest.fn().mockResolvedValue(undefined)` |
| Optionally add conversation helper | Utility for setting up send/receive mocks |

### Step 2: Implementation

| # | File | Purpose |
|---|------|---------|
| 1 | `connectors/ai-chat-app/connector.js` | Full implementation from Section 6. Create `connectors/ai-chat-app/` directory. |
| 2 | `tests/connectors/ai-chat-app-connector.test.js` | Tests from Section 7, using mocks from Step 1. |

### Step 3: Validation

```bash
# Run all tests
npm test

# Verify the inheritance chain
node -e "
  const AIAppConnector = require('./connectors/ai-chat-app/connector');
  const GenericWebAppConnector = require('./connectors/generic-web-app/connector');
  const BaseConnector = require('./connectors/base-connector');
  const c = new AIAppConnector({ config: {} }, {}, {});
  console.log('Inherits GenericWebAppConnector:', c instanceof GenericWebAppConnector);
  console.log('Inherits BaseConnector:', c instanceof BaseConnector);
  console.log('Has sendMessage:', typeof c.sendMessage === 'function');
  console.log('Has waitForAIResponse:', typeof c.waitForAIResponse === 'function');
  console.log('Has validateMemory:', typeof c.validateMemory === 'function');
  console.log('Has click (inherited):', typeof c.click === 'function');
"

# Verify all test suites pass together
npm test 2>&1 | tail -5
```

---

## 10. Claude Code Implementation Notes

1. **No new dependencies.** AIAppConnector imports only from `../generic-web-app/connector` and `../errors`. No new npm packages.

2. **`page.waitForFunction` runs code in the browser context.** The function passed to `waitForFunction` is serialized and executed in the page. It cannot access Node.js variables — only the `arg` parameter. The implementation passes `{ selector, before }` as the arg and uses `document.querySelectorAll` (browser API, not Playwright API).

3. **`sendMessage` calls `this.type` and `this.click` directly.** These are GenericWebAppConnector methods that wrap Playwright calls. They do NOT capture evidence. Evidence for `sendMessage` comes from `performAction`'s wrapping, not from the individual steps.

4. **`validateMemory` calls `sendMessage` + `waitForAIResponse` directly (not through `performAction`).** This means evidence is captured once at the `performAction('validate_memory')` level, not additionally for each sub-step. The validate_memory before/after evidence captures the full state change.

5. **The `aiActions` array guard in `performAction`.** This is cleaner than a switch with a default that calls super, because it avoids duplicating the evidence-wrapping boilerplate. The check `if (!aiActions.includes(action))` delegates early, and the switch below only handles known AI actions.

6. **`waitForGenerationComplete` is a polling loop, not an event listener.** Playwright doesn't expose "element removed" events. The 500ms polling interval is a pragmatic choice — fast enough to be responsive, slow enough to avoid hammering the DOM.

7. **`getConversationHistory` is async for interface consistency.** All public connector methods are async (returning Promises). Even though this one just reads state synchronously, it follows the convention so agents can always `await` connector methods.

8. **The `connectors/ai-chat-app/` directory pattern** matches `connectors/generic-web-app/` — one directory per connector with `connector.js` inside.

---

## 11. What Comes Next

After AIAppConnector is built and tested:

- **Same sprint (Day 5):** `BrainstormyConnector` — extends AIAppConnector with Brainstormy-specific actions (`create_project`, `create_story`, `create_session`, `generate_bible`, `navigate_to_story`, `get_session_summary`)
- **Week 1 wrap-up:** ConnectorFactory to instantiate the correct connector from app config
- **Week 2:** Agents (Healer, Sentinel, Librarian) use connectors through `performAction` — they never know which app they're testing
