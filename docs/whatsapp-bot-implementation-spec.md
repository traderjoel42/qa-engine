# QA Engine: WhatsApp Bot Implementation Specification

**Phase:** 1, Week 5, Days 1-2  
**Purpose:** Implementation-ready spec for the WhatsApp Bot — Express webhook server, inbound message parsing, approval routing, notification templates  
**For:** Claude Code technical evaluation → implementation  
**Dependencies:** TestOrchestrator (✅), BugDetector (✅), ApprovalManager (✅), AutoFixer (✅), StateManager (✅), Database (✅), NotificationAdapter interface (✅), Twilio WhatsApp Notification Adapter (✅), Integration Wiring / `createEngine()` (✅ Week 4 Day 5) — 1,500+ tests  
**References:** qa-engine-01-overview-and-architecture.md (Interface Layer, WhatsApp Bot section, Approval Flow), qa-engine-02-core-engine-spec.md (Approval Manager interaction, notification patterns), qa-engine-05-implementation-plan.md (Week 4 Days 3-4 WhatsApp Bot plan, validation criteria, file checklist)

---

## 1. Design Decisions

### D1: WhatsApp Bot ≠ Notification Adapter

The Twilio WhatsApp Notification Adapter (built Week 4 Day 4) handles **outbound** messages — it implements the `NotificationAdapter` interface with `send()` and `sendWithActions()`. That adapter doesn't know about webhooks, HTTP, or inbound messages.

The WhatsApp Bot is the **inbound** layer — it receives messages from Twilio's webhook, parses commands and approval responses, routes them to the appropriate engine component, and sends responses back. It *uses* the notification adapter for outbound replies but is architecturally a separate concern.

```
                  Twilio Cloud
                       │
              ┌────────┴────────┐
              │   HTTP POST     │  (inbound: user → bot)
              │  /webhooks/     │
              │   whatsapp      │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  WhatsApp Bot   │  ← THIS SPEC
              │  (Express app)  │
              │  Parse → Route  │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Core Engine    │
              │  (createEngine) │
              │  run/status/    │
              │  bugs/approve   │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Notification   │
              │  Adapter        │  (outbound: bot → user)
              │  (Twilio SDK)   │
              └─────────────────┘
```

### D2: Single-User, Single-App (Phase 1)

For Phase 1, the WhatsApp bot serves one user (Joel) managing one app (Brainstormy). This simplifies everything:

- No user authentication beyond phone number allowlisting
- No app selection — all commands target the configured default app
- No multi-tenant routing
- Environment variables configure the single authorized phone number

Phase 2 (SaaS) adds user registration, app selection syntax ("@brainstormy run smoke tests"), and multi-tenant routing.

### D3: Engine Composition via `createEngine()`

The bot doesn't construct engine components directly. It calls the `createEngine()` factory (built Week 4 Day 5) which assembles the full stack: database → state manager → concrete adapters → orchestrator → bug detector → approval manager → auto-fixer.

The bot interacts through the engine's public API surface:
- `engine.run(appId, options)` — trigger test runs
- `engine.status()` — get active/recent run status
- `engine.bugs(appId, options)` — list bugs
- `engine.approve(approvalId)` — approve a fix
- `engine.reject(approvalId)` — reject a fix
- `engine.bugInfo(approvalId)` — get detailed bug info

**Implementation note — approve/reject/bugInfo:** These three methods do not yet exist on the engine object returned by `createEngine()`. The existing engine exposes `run()`, `status()`, `bugs()`, `shutdown()`, and `_internals`. As part of this spec's implementation, **add these methods to `core/engine/factory.js`** by delegating to `ApprovalManager.handleResponse()`:

```javascript
// Add to the engine object in createEngine() factory
async approve(approvalId) {
  return approvalManager.handleResponse(`YES-${approvalId}`);
},
async reject(approvalId) {
  return approvalManager.handleResponse(`NO-${approvalId}`);
},
async bugInfo(approvalId) {
  return approvalManager.handleResponse(`INFO-${approvalId}`);
}
```

This keeps the `_internals` boundary clean — the WhatsApp bot never reaches through to `engine._internals.approvalManager` directly.

**Implementation note — status() return shape:** The current `engine.status()` returns a flat `Array<TestRunRecord>` from the database. This spec expects `{ activeRuns: [], recentRuns: [] }`. **Enhance `engine.status()` in factory.js** to split runs into `activeRuns` (status='running') and `recentRuns` (completed in last 24h, capped at 10):

```javascript
// Replace the existing status() in createEngine() factory
async status() {
  const allRuns = await db.testRuns.findMany({ limit: 20 });
  return {
    activeRuns: allRuns.filter(r => r.status === 'running'),
    recentRuns: allRuns.filter(r => r.status !== 'running').slice(0, 10)
  };
}
```

### D4: Stateless Webhook Handler

The Express server is stateless — it doesn't track conversation state or maintain sessions. Each inbound message is parsed, routed, and responded to independently. Long-running operations (test runs) are kicked off asynchronously; the webhook returns immediately with an acknowledgment, and the engine sends completion notifications via the outbound notification adapter.

### D5: Twilio Webhook Signature Validation

Every inbound request must pass Twilio's webhook signature validation. This prevents spoofed messages from triggering test runs or approving fixes. The validation uses the `X-Twilio-Signature` header, the request URL, and the Twilio auth token.

In test mode, signature validation is skippable via a constructor option for easier testing.

### D6: Natural Language Parsing is Pattern-Based (Not LLM)

Inbound message parsing uses regex patterns, not LLM calls. This is deliberate:

- **Speed:** Pattern matching is instant; LLM calls add 1-3 seconds latency
- **Cost:** Zero API cost for command parsing
- **Reliability:** Deterministic behavior — same input always produces same routing
- **Scope:** Phase 1 commands are finite and well-defined; no need for NLU

If a message doesn't match any known pattern, the bot replies with a help menu showing available commands.

### D7: TwiML Response Format

Twilio expects either a TwiML XML response or a 200 with empty body (if sending responses via the REST API instead). We use the **REST API approach**: the webhook handler returns a 200 with empty TwiML, and all actual response messages are sent via the Twilio notification adapter. This gives us more control over message formatting and allows multiple response messages for a single inbound command.

---

## 2. Data Structures

### InboundMessage

Parsed representation of a Twilio webhook payload:

```javascript
/**
 * @typedef {Object} InboundMessage
 * @property {string} from - Sender phone number (whatsapp:+1234567890)
 * @property {string} body - Raw message text
 * @property {string} messageSid - Twilio message SID
 * @property {string} accountSid - Twilio account SID
 * @property {Date} receivedAt - When the webhook was received
 */
```

### ParsedCommand

Result of parsing an inbound message body:

```javascript
/**
 * @typedef {Object} ParsedCommand
 * @property {'run'|'status'|'bugs'|'approve'|'reject'|'info'|'help'|'unknown'} type
 * @property {Object} params - Command-specific parameters
 *
 * For type 'run':
 * @property {Object} params
 * @property {string} [params.mode] - 'smoke'|'full'|'regression'|null
 * @property {string[]} [params.agents] - Specific agent IDs (e.g., ['healer'])
 *
 * For type 'approve'|'reject'|'info':
 * @property {Object} params
 * @property {string} params.approvalId - The approval ID (e.g., 'ABC-247')
 *
 * For type 'bugs':
 * @property {Object} params
 * @property {string} [params.status] - Filter: 'open'|'fixed'|'all'
 *
 * For type 'status':
 * @property {Object} params (empty)
 *
 * For type 'help':
 * @property {Object} params (empty)
 *
 * For type 'unknown':
 * @property {Object} params
 * @property {string} params.originalText - The unrecognized message text
 */
```

### CommandResult

Result of executing a parsed command:

```javascript
/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} message - Human-readable response text
 * @property {Object} [data] - Structured result data (optional)
 */
```

### WebhookConfig

Configuration for the WhatsApp bot server:

```javascript
/**
 * @typedef {Object} WebhookConfig
 * @property {number} port - HTTP server port (default: 3001)
 * @property {string} webhookPath - Webhook URL path (default: '/webhooks/whatsapp')
 * @property {string} twilioAuthToken - Twilio auth token for signature validation
 * @property {string} webhookUrl - Full public URL for signature validation
 * @property {string[]} allowedNumbers - Authorized phone numbers ['whatsapp:+1234567890']
 * @property {boolean} validateSignatures - Enable/disable Twilio signature validation (default: true)
 * @property {string} defaultAppId - Default app to target (default: 'brainstormy')
 */
```

---

## 3. Constructor + Method Inventory

### Class: `MessageParser`

**File:** `interfaces/whatsapp-bot/message-parser.js`

Stateless utility class. Parses raw message text into structured commands.

```javascript
class MessageParser {
  /**
   * Parse a raw message body into a structured command.
   * @param {string} body - Raw message text (trimmed)
   * @returns {ParsedCommand}
   */
  parse(body) {}

  /**
   * Check if a message is an approval response (YES-XXX-NNN, NO-XXX-NNN, INFO-XXX-NNN).
   * @param {string} body
   * @returns {{action: 'YES'|'NO'|'INFO', approvalId: string}|null}
   */
  parseApprovalResponse(body) {}

  /**
   * Check if a message is a run command.
   * @param {string} body
   * @returns {{mode: string|null, agents: string[]}|null}
   */
  parseRunCommand(body) {}

  /**
   * Check if a message is a status query.
   * @param {string} body
   * @returns {boolean}
   */
  isStatusQuery(body) {}

  /**
   * Check if a message is a bugs query.
   * @param {string} body
   * @returns {{status: string}|null}
   */
  parseBugsQuery(body) {}

  /**
   * Check if a message is a help request.
   * @param {string} body
   * @returns {boolean}
   */
  isHelpRequest(body) {}
}
```

### Class: `CommandHandler`

**File:** `interfaces/whatsapp-bot/command-handler.js`

Routes parsed commands to the engine and formats responses. Injected with the engine instance.

```javascript
class CommandHandler {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {string} options.defaultAppId - Default app to target
   */
  constructor(options) {}

  /**
   * Handle a parsed command and send response(s).
   * @param {ParsedCommand} command - Parsed command
   * @param {InboundMessage} message - Original inbound message
   * @returns {Promise<CommandResult>}
   */
  async handle(command, message) {}

  /**
   * Handle a 'run' command — trigger test execution.
   * Sends an immediate acknowledgment, then kicks off async test run.
   * Engine sends completion notification when done.
   * @param {Object} params - {mode, agents}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleRun(params, message) {}

  /**
   * Handle a 'status' command — return active/recent run status.
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleStatus(message) {}

  /**
   * Handle a 'bugs' command — list bugs with optional status filter.
   * @param {Object} params - {status}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleBugs(params, message) {}

  /**
   * Handle an 'approve' command — route YES response to Approval Manager.
   * @param {Object} params - {approvalId}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleApprove(params, message) {}

  /**
   * Handle a 'reject' command — route NO response to Approval Manager.
   * @param {Object} params - {approvalId}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleReject(params, message) {}

  /**
   * Handle an 'info' command — return detailed bug info for an approval.
   * @param {Object} params - {approvalId}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleInfo(params, message) {}

  /**
   * Handle a 'help' command — return available commands.
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleHelp(message) {}

  /**
   * Handle an 'unknown' command — return help prompt.
   * @param {Object} params - {originalText}
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handleUnknown(params, message) {}
}
```

### Class: `WebhookServer`

**File:** `interfaces/whatsapp-bot/server.js`

Express app that receives Twilio webhooks, validates signatures, extracts messages, and routes to the handler pipeline.

```javascript
class WebhookServer {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {WebhookConfig} options.config - Server configuration
   * @param {MessageParser} [options.parser] - Injectable parser (default: new MessageParser())
   * @param {CommandHandler} [options.handler] - Injectable handler (default: new CommandHandler(...))
   */
  constructor(options) {}

  /**
   * Create and configure the Express app (without starting it).
   * @returns {express.Application}
   */
  createApp() {}

  /**
   * Start the HTTP server.
   * @returns {Promise<http.Server>}
   */
  async start() {}

  /**
   * Stop the HTTP server gracefully.
   * @returns {Promise<void>}
   */
  async stop() {}

  /**
   * Validate Twilio webhook signature.
   * @param {express.Request} req
   * @returns {boolean}
   */
  validateSignature(req) {}

  /**
   * Extract InboundMessage from Express request body.
   * @param {express.Request} req
   * @returns {InboundMessage}
   */
  extractMessage(req) {}

  /**
   * Check if sender is authorized.
   * @param {string} from - Sender number (whatsapp:+1234567890)
   * @returns {boolean}
   */
  isAuthorized(from) {}

  /**
   * Health check endpoint handler.
   * @param {express.Request} req
   * @param {express.Response} res
   */
  healthCheck(req, res) {}
}
```

### Class: `NotificationTemplates`

**File:** `interfaces/whatsapp-bot/notification-templates.js`

Stateless utility class. Formats structured data into WhatsApp-friendly message strings. Used by both the CommandHandler (for immediate responses) and by the engine's notification hooks (for async alerts).

```javascript
class NotificationTemplates {
  /**
   * Format a test run acknowledgment message.
   * @param {Object} options - {mode, agents, appId}
   * @returns {string}
   */
  static runAcknowledgment(options) {}

  /**
   * Format a test run completion summary.
   * @param {Object} summary - TestOrchestrator result summary
   * @returns {string}
   */
  static runComplete(summary) {}

  /**
   * Format a status response (active + recent runs).
   * @param {Object} status - {activeRuns: [], recentRuns: []}
   * @returns {string}
   */
  static statusReport(status) {}

  /**
   * Format a bugs list response.
   * @param {Object[]} bugs - Array of bug records
   * @param {string} filter - Status filter applied
   * @returns {string}
   */
  static bugsList(bugs, filter) {}

  /**
   * Format an approval request notification (sent when bug detected).
   * @param {Object} bug - Bug record with approval info
   * @returns {string}
   */
  static approvalRequest(bug) {}

  /**
   * Format an approval confirmation.
   * @param {string} approvalId
   * @param {string} action - 'approved'|'rejected'
   * @returns {string}
   */
  static approvalConfirmation(approvalId, action) {}

  /**
   * Format detailed bug info response.
   * @param {Object} bug - Full bug record with evidence
   * @returns {string}
   */
  static bugDetail(bug) {}

  /**
   * Format a fix completion notification.
   * @param {Object} bug - Bug record
   * @param {Object} fix - Fix result
   * @returns {string}
   */
  static fixComplete(bug, fix) {}

  /**
   * Format a fix failure notification.
   * @param {Object} bug - Bug record
   * @param {string} reason - Failure reason
   * @returns {string}
   */
  static fixFailed(bug, reason) {}

  /**
   * Format the help menu.
   * @returns {string}
   */
  static helpMenu() {}

  /**
   * Format an error message for unknown commands.
   * @param {string} originalText
   * @returns {string}
   */
  static unknownCommand(originalText) {}

  /**
   * Format an unauthorized access message.
   * @returns {string}
   */
  static unauthorized() {}

  /**
   * Format an internal error message.
   * @returns {string}
   */
  static internalError() {}
}
```

---

## 4. Message Parsing Rules

### Approval Responses (Highest Priority — Checked First)

These are time-sensitive and must be routed immediately.

| Pattern | Example | Parsed As |
|---------|---------|-----------|
| `YES-{ID}` | `YES-ABC-247` | `{type: 'approve', params: {approvalId: 'ABC-247'}}` |
| `NO-{ID}` | `NO-ABC-247` | `{type: 'reject', params: {approvalId: 'ABC-247'}}` |
| `INFO-{ID}` | `INFO-ABC-247` | `{type: 'info', params: {approvalId: 'ABC-247'}}` |

**Regex:** `/^(YES|NO|INFO)-([A-Z]{3}-\d+)$/i`

Case-insensitive. The approval ID is always `{3 uppercase letters}-{digits}`.

### Run Commands

| Pattern | Example | Parsed As |
|---------|---------|-----------|
| `run` (alone) | `Run` | `{type: 'run', params: {mode: null, agents: []}}` |
| `run smoke` / `run smoke tests` | `Run smoke tests` | `{type: 'run', params: {mode: 'smoke', agents: []}}` |
| `run full` / `run full tests` | `Run full` | `{type: 'run', params: {mode: 'full', agents: []}}` |
| `run regression` | `Run regression` | `{type: 'run', params: {mode: 'regression', agents: []}}` |
| `run healer` | `Run healer` | `{type: 'run', params: {mode: null, agents: ['healer']}}` |
| `run sentinel` | `Run sentinel` | `{type: 'run', params: {mode: null, agents: ['sentinel']}}` |
| `run healer sentinel` | `Run healer sentinel` | `{type: 'run', params: {mode: null, agents: ['healer', 'sentinel']}}` |
| `test` / `test smoke` | `Test smoke` | Same as `run smoke` |

**Regex:** `/^(?:run|test)(?:\s+(.+))?$/i`

Then the captured group is parsed for mode keywords and agent names.

**Known modes:** `smoke`, `full`, `regression`  
**Known agents:** `healer`, `sentinel`, `librarian`, `quinn`

### Status Queries

| Pattern | Example |
|---------|---------|
| `status` | `Status` |
| `what's running` | `What's running?` |
| `progress` | `progress` |

**Regex:** `/^(?:status|what'?s?\s+running\??|progress)$/i`

### Bug Queries

| Pattern | Example | Parsed As |
|---------|---------|-----------|
| `bugs` | `Bugs` | `{type: 'bugs', params: {status: 'open'}}` |
| `open bugs` | `Open bugs` | `{type: 'bugs', params: {status: 'open'}}` |
| `fixed bugs` | `Fixed bugs` | `{type: 'bugs', params: {status: 'fixed'}}` |
| `all bugs` | `All bugs` | `{type: 'bugs', params: {status: 'all'}}` |
| `what failed` | `What failed?` | `{type: 'bugs', params: {status: 'open'}}` |

**Regex:** `/^(?:(open|fixed|all)\s+)?(?:bugs|what\s+failed\??)$/i`

### Help Requests

| Pattern | Example |
|---------|---------|
| `help` | `Help` |
| `commands` | `Commands` |
| `?` | `?` |
| `menu` | `Menu` |

**Regex:** `/^(?:help|commands|\?|menu)$/i`

### Parse Order

The parser checks patterns in this order (first match wins):

1. **Approval response** — `YES-`, `NO-`, `INFO-` prefix
2. **Help** — `help`, `commands`, `?`, `menu`
3. **Status** — `status`, `what's running`, `progress`
4. **Bugs** — `bugs`, `what failed`
5. **Run** — `run`, `test`
6. **Unknown** — everything else

---

## 5. Notification Templates

### Test Run Acknowledgment
```
🚀 Starting smoke tests...
Agents: Healer, Sentinel
App: Brainstormy

I'll notify you when results are ready.
```

### Test Run Complete — All Passed
```
✅ Test Run Complete

15/15 tests passed
Agents: Healer (8/8), Sentinel (7/7)
Duration: 3m 42s

No bugs detected.
```

### Test Run Complete — Failures
```
❌ Test Run Complete

12/15 tests passed, 3 failed
Agents: Healer (8/8 ✅), Sentinel (4/7 ❌)
Duration: 5m 18s

🐛 3 bugs detected:
• BUG-248: Memory recall failed for character name (auto-fixable)
• BUG-249: Citation missing in Story Bible (auto-fixable)
• BUG-250: Session list not loading (needs manual fix)

Approval requests sent for auto-fixable bugs.
```

### Approval Request
```
🔴 Auto-Fix Available

BUG-248: Memory recall failed for character name
Severity: medium | Agent: Sentinel
Root cause: Search query not matching recent session content

Approve fix?
  YES-ABC-248
  NO-ABC-248
  INFO-ABC-248 (details)
```

### Approval Confirmation
```
✅ Approved: ABC-248

Generating and applying fix...
I'll notify you when verification completes.
```

### Fix Complete — Success
```
✅ Fix Verified: BUG-248

Memory recall failed for character name
Fix: Updated semantic search query weighting
Verification: Re-ran failing test → passed
Regression: 15/15 tests still passing

Linear issue updated: LIN-248 → Done
```

### Fix Complete — Failed
```
❌ Fix Failed: BUG-248

Memory recall failed for character name
Reason: Verification test still failing after fix
Action: Escalated to manual fix

Linear issue updated: LIN-248 → Needs Manual Fix
```

### Status Report
```
📊 QA Engine Status

Active: 1 run in progress
  └ Smoke tests (Healer, Sentinel) — 67% complete

Recent runs (last 24h):
  ✅ 2/12 8:00pm — Full (15/15 passed)
  ❌ 2/12 2:00pm — Smoke (12/15 passed)
  ✅ 2/11 8:00pm — Full (15/15 passed)
```

### Bugs List
```
🐛 Open Bugs (3)

• BUG-250: Session list not loading
  Severity: high | manual fix needed
  
• BUG-248: Memory recall failed
  Severity: medium | fix pending approval
  
• BUG-249: Citation missing
  Severity: medium | fix in progress
```

### Bug Detail (INFO response)
```
📋 Bug Detail: BUG-248

Title: Memory recall failed for character name
Severity: medium
Category: memory
Agent: Sentinel
Detected: 2/12 2:15pm

Root Cause:
Search query not matching recent session content due to embedding mismatch after session summary generation.

Affected Component: services/semantic-search.js
Likely Fix: Update query weighting to include session summary embeddings

Evidence:
• Screenshot: [link]
• Console errors: 0
• Network failures: 1

Linear: LIN-248
Status: Pending approval (ABC-248)
```

### Help Menu
```
📖 QA Engine Commands

Run tests:
  run — run all enabled agents
  run smoke — smoke tests only
  run healer — specific agent
  test regression — regression suite

Check status:
  status — active and recent runs
  bugs — open bugs
  all bugs — all bugs including fixed

Approvals:
  YES-ABC-247 — approve auto-fix
  NO-ABC-247 — reject auto-fix
  INFO-ABC-247 — detailed bug info

help — show this menu
```

### Unknown Command
```
🤔 I didn't understand that.

Send "help" to see available commands.
```

### Unauthorized
```
⛔ Unauthorized. This number is not registered with QA Engine.
```

### Internal Error
```
⚠️ Something went wrong processing your request. Please try again.

If the issue persists, check the server logs.
```

---

## 6. Full Implementation Code

### File: `interfaces/whatsapp-bot/message-parser.js`

```javascript
'use strict';

const KNOWN_MODES = ['smoke', 'full', 'regression'];
const KNOWN_AGENTS = ['healer', 'sentinel', 'librarian', 'quinn'];

class MessageParser {
  /**
   * Parse a raw message body into a structured command.
   * Checks patterns in priority order: approval > help > status > bugs > run > unknown.
   * @param {string} body - Raw message text
   * @returns {ParsedCommand}
   */
  parse(body) {
    if (!body || typeof body !== 'string') {
      return { type: 'unknown', params: { originalText: '' } };
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return { type: 'unknown', params: { originalText: '' } };
    }

    // 1. Approval responses (highest priority)
    const approval = this.parseApprovalResponse(trimmed);
    if (approval) {
      const typeMap = { 'YES': 'approve', 'NO': 'reject', 'INFO': 'info' };
      return {
        type: typeMap[approval.action],
        params: { approvalId: approval.approvalId }
      };
    }

    // 2. Help
    if (this.isHelpRequest(trimmed)) {
      return { type: 'help', params: {} };
    }

    // 3. Status
    if (this.isStatusQuery(trimmed)) {
      return { type: 'status', params: {} };
    }

    // 4. Bugs
    const bugs = this.parseBugsQuery(trimmed);
    if (bugs) {
      return { type: 'bugs', params: bugs };
    }

    // 5. Run
    const run = this.parseRunCommand(trimmed);
    if (run) {
      return { type: 'run', params: run };
    }

    // 6. Unknown
    return { type: 'unknown', params: { originalText: trimmed } };
  }

  /**
   * Check if a message is an approval response.
   * Format: YES-ABC-247, NO-ABC-247, INFO-ABC-247 (case-insensitive)
   * @param {string} body
   * @returns {{action: 'YES'|'NO'|'INFO', approvalId: string}|null}
   */
  parseApprovalResponse(body) {
    const match = body.match(/^(YES|NO|INFO)-([A-Z]{3}-\d+)$/i);
    if (!match) return null;
    return {
      action: match[1].toUpperCase(),
      approvalId: match[2].toUpperCase()
    };
  }

  /**
   * Check if a message is a run/test command. Extracts mode and agents.
   * @param {string} body
   * @returns {{mode: string|null, agents: string[]}|null}
   */
  parseRunCommand(body) {
    const match = body.match(/^(?:run|test)(?:\s+(.+))?$/i);
    if (!match) return null;

    const args = match[1] ? match[1].toLowerCase().split(/\s+/) : [];

    let mode = null;
    const agents = [];

    for (const arg of args) {
      // Strip trailing "tests" (e.g., "smoke tests" → "smoke")
      const cleaned = arg.replace(/\s*tests?$/i, '');
      if (KNOWN_MODES.includes(cleaned)) {
        mode = cleaned;
      } else if (KNOWN_AGENTS.includes(cleaned)) {
        agents.push(cleaned);
      }
      // Ignore unrecognized args (e.g., "tests" as standalone word)
    }

    return { mode, agents };
  }

  /**
   * Check if a message is a status query.
   * @param {string} body
   * @returns {boolean}
   */
  isStatusQuery(body) {
    return /^(?:status|what'?s?\s+running\??|progress)$/i.test(body);
  }

  /**
   * Check if a message is a bugs query. Returns status filter.
   * @param {string} body
   * @returns {{status: string}|null}
   */
  parseBugsQuery(body) {
    const match = body.match(/^(?:(open|fixed|all)\s+)?(?:bugs|what\s+failed\??)$/i);
    if (!match) return null;
    return { status: match[1] ? match[1].toLowerCase() : 'open' };
  }

  /**
   * Check if a message is a help request.
   * @param {string} body
   * @returns {boolean}
   */
  isHelpRequest(body) {
    return /^(?:help|commands|\?|menu)$/i.test(body);
  }
}

module.exports = MessageParser;
```

### File: `interfaces/whatsapp-bot/notification-templates.js`

```javascript
'use strict';

class NotificationTemplates {
  static runAcknowledgment({ mode, agents, appId }) {
    const modeLabel = mode ? `${mode} tests` : 'all tests';
    const agentLabel = agents.length > 0
      ? agents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
      : 'all enabled agents';

    return [
      `🚀 Starting ${modeLabel}...`,
      `Agents: ${agentLabel}`,
      `App: ${appId}`,
      '',
      "I'll notify you when results are ready."
    ].join('\n');
  }

  static runComplete(summary) {
    const { totalTests, passed, failed, agents, durationMs, bugsCreated } = summary;
    const icon = failed === 0 ? '✅' : '❌';
    const duration = NotificationTemplates._formatDuration(durationMs);

    const lines = [
      `${icon} Test Run Complete`,
      '',
      `${passed}/${totalTests} tests passed${failed > 0 ? `, ${failed} failed` : ''}`,
    ];

    if (agents && agents.length > 0) {
      const agentSummaries = agents.map(a => {
        const agentIcon = a.failed === 0 ? '✅' : '❌';
        return `${a.name} (${a.passed}/${a.total} ${agentIcon})`;
      });
      lines.push(`Agents: ${agentSummaries.join(', ')}`);
    }

    lines.push(`Duration: ${duration}`);

    if (failed === 0) {
      lines.push('', 'No bugs detected.');
    } else if (bugsCreated > 0) {
      lines.push('', `🐛 ${bugsCreated} bug${bugsCreated !== 1 ? 's' : ''} detected.`);
    }

    return lines.join('\n');
  }

  static statusReport({ activeRuns, recentRuns }) {
    const lines = ['📊 QA Engine Status', ''];

    if (activeRuns.length === 0) {
      lines.push('Active: No runs in progress');
    } else {
      lines.push(`Active: ${activeRuns.length} run${activeRuns.length !== 1 ? 's' : ''} in progress`);
      for (const run of activeRuns) {
        const progress = run.progress ? ` — ${run.progress}% complete` : '';
        lines.push(`  └ ${run.mode || 'Full'} (${run.agents.join(', ')})${progress}`);
      }
    }

    if (recentRuns.length > 0) {
      lines.push('', `Recent runs (last 24h):`);
      for (const run of recentRuns) {
        const icon = run.failed === 0 ? '✅' : '❌';
        const time = NotificationTemplates._formatTime(run.completed_at);
        lines.push(`  ${icon} ${time} — ${run.mode || 'Full'} (${run.passed}/${run.total} passed)`);
      }
    }

    return lines.join('\n');
  }

  static bugsList(bugs, filter) {
    if (bugs.length === 0) {
      return `🐛 No ${filter === 'all' ? '' : filter + ' '}bugs found.`;
    }

    const lines = [`🐛 ${filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)} Bugs (${bugs.length})`, ''];

    for (const bug of bugs.slice(0, 10)) { // Max 10 in list
      const statusLabel = bug.auto_fixable
        ? (bug.approval_status === 'pending' ? 'fix pending approval' : `fix ${bug.approval_status}`)
        : 'manual fix needed';
      lines.push(`• ${bug.bug_id}: ${bug.title}`);
      lines.push(`  Severity: ${bug.severity} | ${statusLabel}`);
      lines.push('');
    }

    if (bugs.length > 10) {
      lines.push(`... and ${bugs.length - 10} more. Check Linear for full list.`);
    }

    return lines.join('\n').trim();
  }

  static approvalRequest(bug) {
    return [
      '🔴 Auto-Fix Available',
      '',
      `${bug.bug_id}: ${bug.title}`,
      `Severity: ${bug.severity} | Agent: ${bug.detected_by}`,
      `Root cause: ${bug.root_cause}`,
      '',
      'Approve fix?',
      `  YES-${bug.approval_id}`,
      `  NO-${bug.approval_id}`,
      `  INFO-${bug.approval_id} (details)`
    ].join('\n');
  }

  static approvalConfirmation(approvalId, action) {
    if (action === 'approved') {
      return [
        `✅ Approved: ${approvalId}`,
        '',
        'Generating and applying fix...',
        "I'll notify you when verification completes."
      ].join('\n');
    }

    return [
      `🚫 Rejected: ${approvalId}`,
      '',
      'Bug marked as needs-manual-fix.',
      'Linear issue updated.'
    ].join('\n');
  }

  static bugDetail(bug) {
    const lines = [
      `📋 Bug Detail: ${bug.bug_id}`,
      '',
      `Title: ${bug.title}`,
      `Severity: ${bug.severity}`,
      `Category: ${bug.category}`,
      `Agent: ${bug.detected_by}`,
      `Detected: ${NotificationTemplates._formatTime(bug.created_at)}`,
      '',
      'Root Cause:',
      bug.root_cause,
      '',
      `Affected Component: ${bug.affected_component}`,
      `Likely Fix: ${bug.fix_approach}`,
    ];

    if (bug.evidence) {
      lines.push('', 'Evidence:');
      if (bug.evidence.screenshots && bug.evidence.screenshots.length > 0) {
        lines.push(`• Screenshots: ${bug.evidence.screenshots.length}`);
      }
      lines.push(`• Console errors: ${bug.evidence.console_errors || 0}`);
      lines.push(`• Network failures: ${bug.evidence.network_failures || 0}`);
    }

    if (bug.external_issue_url) {
      lines.push('', `Linear: ${bug.external_issue_url}`);
    }

    if (bug.approval_id) {
      lines.push(`Status: ${bug.approval_status || 'pending'} (${bug.approval_id})`);
    }

    return lines.join('\n');
  }

  static fixComplete(bug, fix) {
    const icon = fix.verified ? '✅' : '❌';
    const lines = [
      `${icon} Fix ${fix.verified ? 'Verified' : 'Applied'}: ${bug.bug_id}`,
      '',
      bug.title,
      `Fix: ${fix.explanation || 'Applied automated fix'}`,
    ];

    if (fix.verified) {
      lines.push(`Verification: Re-ran failing test → passed`);
      if (fix.regressionPassed) {
        lines.push(`Regression: ${fix.regressionTotal}/${fix.regressionTotal} tests still passing`);
      }
    }

    if (bug.external_issue_url) {
      lines.push('', `Linear issue updated: ${bug.external_issue_id} → Done`);
    }

    return lines.join('\n');
  }

  static fixFailed(bug, reason) {
    return [
      `❌ Fix Failed: ${bug.bug_id}`,
      '',
      bug.title,
      `Reason: ${reason}`,
      'Action: Escalated to manual fix',
      '',
      bug.external_issue_url
        ? `Linear issue updated: ${bug.external_issue_id} → Needs Manual Fix`
        : 'Please fix manually.'
    ].join('\n');
  }

  static helpMenu() {
    return [
      '📖 QA Engine Commands',
      '',
      'Run tests:',
      '  run — run all enabled agents',
      '  run smoke — smoke tests only',
      '  run healer — specific agent',
      '  test regression — regression suite',
      '',
      'Check status:',
      '  status — active and recent runs',
      '  bugs — open bugs',
      '  all bugs — all bugs including fixed',
      '',
      'Approvals:',
      '  YES-ABC-247 — approve auto-fix',
      '  NO-ABC-247 — reject auto-fix',
      '  INFO-ABC-247 — detailed bug info',
      '',
      'help — show this menu'
    ].join('\n');
  }

  static unknownCommand(originalText) {
    const preview = originalText.length > 30
      ? originalText.substring(0, 30) + '...'
      : originalText;
    return [
      `🤔 I didn't understand "${preview}".`,
      '',
      'Send "help" to see available commands.'
    ].join('\n');
  }

  static unauthorized() {
    return '⛔ Unauthorized. This number is not registered with QA Engine.';
  }

  static internalError() {
    return [
      '⚠️ Something went wrong processing your request. Please try again.',
      '',
      'If the issue persists, check the server logs.'
    ].join('\n');
  }

  // --- Private Helpers ---

  static _formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0) return `${remainingSeconds}s`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  static _formatTime(dateOrString) {
    if (!dateOrString) return 'unknown';
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).toLowerCase();
  }
}

module.exports = NotificationTemplates;
```

### File: `interfaces/whatsapp-bot/command-handler.js`

```javascript
'use strict';

const NotificationTemplates = require('./notification-templates');

class CommandHandler {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {string} options.defaultAppId - Default app to target
   */
  constructor({ engine, notifier, defaultAppId = 'brainstormy' }) {
    if (!engine) throw new Error('CommandHandler requires engine');
    if (!notifier) throw new Error('CommandHandler requires notifier');

    this.engine = engine;
    this.notifier = notifier;
    this.defaultAppId = defaultAppId;
  }

  /**
   * Route a parsed command to the appropriate handler.
   * @param {ParsedCommand} command
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handle(command, message) {
    try {
      switch (command.type) {
        case 'run':
          return await this.handleRun(command.params, message);
        case 'status':
          return await this.handleStatus(message);
        case 'bugs':
          return await this.handleBugs(command.params, message);
        case 'approve':
          return await this.handleApprove(command.params, message);
        case 'reject':
          return await this.handleReject(command.params, message);
        case 'info':
          return await this.handleInfo(command.params, message);
        case 'help':
          return await this.handleHelp(message);
        case 'unknown':
        default:
          return await this.handleUnknown(command.params, message);
      }
    } catch (error) {
      // Send error notification to user
      await this.notifier.send(
        message.from,
        NotificationTemplates.internalError()
      );
      return {
        success: false,
        message: `Error handling ${command.type}: ${error.message}`
      };
    }
  }

  /**
   * Handle 'run' — send ack immediately, kick off async test run.
   */
  async handleRun(params, message) {
    const { mode, agents } = params;

    // Send immediate acknowledgment
    const ackMessage = NotificationTemplates.runAcknowledgment({
      mode,
      agents,
      appId: this.defaultAppId
    });
    await this.notifier.send(message.from, ackMessage);

    // Kick off test run asynchronously (don't await completion)
    const runOptions = {
      ...(mode && { mode }),
      ...(agents.length > 0 && { agents })
    };

    // Fire and forget — engine sends completion notification via its own notifier
    // engine.run() takes (appId, options) as two separate parameters
    this.engine.run(this.defaultAppId, runOptions).catch(error => {
      // On unexpected failure, notify user
      this.notifier.send(
        message.from,
        `⚠️ Test run failed to start: ${error.message}`
      ).catch(() => {}); // Swallow notification send failure
    });

    return {
      success: true,
      message: ackMessage
    };
  }

  /**
   * Handle 'status' — query engine and send formatted response.
   */
  async handleStatus(message) {
    const status = await this.engine.status();
    const responseMessage = NotificationTemplates.statusReport(status);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: status };
  }

  /**
   * Handle 'bugs' — query engine with status filter and send list.
   */
  async handleBugs(params, message) {
    // engine.bugs() takes (appId, options) as two separate parameters
    const bugs = await this.engine.bugs(this.defaultAppId, {
      status: params.status
    });
    const responseMessage = NotificationTemplates.bugsList(bugs, params.status);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: bugs };
  }

  /**
   * Handle 'approve' — route YES to Approval Manager.
   */
  async handleApprove(params, message) {
    const result = await this.engine.approve(params.approvalId);
    const responseMessage = NotificationTemplates.approvalConfirmation(
      params.approvalId,
      'approved'
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: result };
  }

  /**
   * Handle 'reject' — route NO to Approval Manager.
   */
  async handleReject(params, message) {
    const result = await this.engine.reject(params.approvalId);
    const responseMessage = NotificationTemplates.approvalConfirmation(
      params.approvalId,
      'rejected'
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: result };
  }

  /**
   * Handle 'info' — fetch and send detailed bug info.
   */
  async handleInfo(params, message) {
    const bug = await this.engine.bugInfo(params.approvalId);
    if (!bug) {
      const notFoundMsg = `❓ No bug found for approval ID: ${params.approvalId}`;
      await this.notifier.send(message.from, notFoundMsg);
      return { success: false, message: notFoundMsg };
    }
    const responseMessage = NotificationTemplates.bugDetail(bug);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: bug };
  }

  /**
   * Handle 'help' — send command menu.
   */
  async handleHelp(message) {
    const responseMessage = NotificationTemplates.helpMenu();
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage };
  }

  /**
   * Handle 'unknown' — send help prompt.
   */
  async handleUnknown(params, message) {
    const responseMessage = NotificationTemplates.unknownCommand(
      params.originalText || ''
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: false, message: responseMessage };
  }
}

module.exports = CommandHandler;
```

### File: `interfaces/whatsapp-bot/server.js`

```javascript
'use strict';

const express = require('express');
const crypto = require('crypto');
const MessageParser = require('./message-parser');
const CommandHandler = require('./command-handler');

class WebhookServer {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {WebhookConfig} options.config - Server configuration
   * @param {MessageParser} [options.parser] - Injectable parser (default: new MessageParser())
   * @param {CommandHandler} [options.handler] - Injectable handler
   */
  constructor({ engine, notifier, config, parser, handler }) {
    if (!config) throw new Error('WebhookServer requires config');
    if (!config.twilioAuthToken && config.validateSignatures !== false) {
      throw new Error('WebhookServer requires config.twilioAuthToken when signature validation is enabled');
    }

    this.engine = engine;
    this.notifier = notifier;
    this.config = {
      port: 3001,
      webhookPath: '/webhooks/whatsapp',
      validateSignatures: true,
      allowedNumbers: [],
      defaultAppId: 'brainstormy',
      ...config
    };

    this.parser = parser || new MessageParser();
    this.handler = handler || new CommandHandler({
      engine,
      notifier,
      defaultAppId: this.config.defaultAppId
    });

    this.app = null;
    this.server = null;
  }

  /**
   * Create and configure the Express app.
   * @returns {express.Application}
   */
  createApp() {
    const app = express();

    // Parse URL-encoded bodies (Twilio sends form data)
    app.use(express.urlencoded({ extended: false }));

    // Health check
    app.get('/health', (req, res) => this.healthCheck(req, res));

    // Webhook endpoint
    app.post(this.config.webhookPath, async (req, res) => {
      await this._handleWebhook(req, res);
    });

    this.app = app;
    return app;
  }

  /**
   * Start the HTTP server.
   * @returns {Promise<http.Server>}
   */
  async start() {
    if (!this.app) {
      this.createApp();
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        resolve(this.server);
      });
    });
  }

  /**
   * Stop the HTTP server gracefully.
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Core webhook handler — signature validation, authorization, parse, route.
   * @param {express.Request} req
   * @param {express.Response} res
   */
  async _handleWebhook(req, res) {
    try {
      // 1. Validate Twilio signature
      if (this.config.validateSignatures && !this.validateSignature(req)) {
        res.status(403).send('Invalid signature');
        return;
      }

      // 2. Extract message
      const message = this.extractMessage(req);

      // 3. Check authorization
      if (!this.isAuthorized(message.from)) {
        // Send unauthorized response via Twilio
        if (this.notifier) {
          await this.notifier.send(
            message.from,
            '⛔ Unauthorized. This number is not registered with QA Engine.'
          ).catch(() => {}); // Best effort
        }
        res.status(200).type('text/xml').send('<Response></Response>');
        return;
      }

      // 4. Parse command
      const command = this.parser.parse(message.body);

      // 5. Route to handler (async — don't block webhook response)
      // We still await here because the handler sends the response;
      // only engine.run() is fire-and-forget within the handler.
      await this.handler.handle(command, message);

      // 6. Return empty TwiML (all responses sent via REST API)
      res.status(200).type('text/xml').send('<Response></Response>');

    } catch (error) {
      // Log error but still return 200 to Twilio
      // (Twilio retries on non-200, which would cause duplicate processing)
      console.error('Webhook handler error:', error);
      res.status(200).type('text/xml').send('<Response></Response>');
    }
  }

  /**
   * Validate Twilio webhook signature using HMAC-SHA1.
   *
   * Algorithm:
   * 1. Take the full webhook URL
   * 2. Sort the POST parameters alphabetically by key
   * 3. Append each key-value pair to the URL
   * 4. HMAC-SHA1 the result with the auth token
   * 5. Compare with X-Twilio-Signature header
   *
   * @param {express.Request} req
   * @returns {boolean}
   */
  validateSignature(req) {
    const signature = req.headers['x-twilio-signature'];
    if (!signature) return false;

    const url = this.config.webhookUrl || `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Sort POST params and append to URL
    let data = url;
    if (req.body) {
      const sortedKeys = Object.keys(req.body).sort();
      for (const key of sortedKeys) {
        data += key + req.body[key];
      }
    }

    // HMAC-SHA1
    const expectedSignature = crypto
      .createHmac('sha1', this.config.twilioAuthToken)
      .update(data, 'utf-8')
      .digest('base64');

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false; // Different lengths
    }
  }

  /**
   * Extract InboundMessage from Twilio webhook body.
   * @param {express.Request} req
   * @returns {InboundMessage}
   */
  extractMessage(req) {
    return {
      from: req.body.From || '',
      body: req.body.Body || '',
      messageSid: req.body.MessageSid || '',
      accountSid: req.body.AccountSid || '',
      receivedAt: new Date()
    };
  }

  /**
   * Check if sender is in the allowed numbers list.
   * Empty allowlist = allow all (for development).
   * @param {string} from
   * @returns {boolean}
   */
  isAuthorized(from) {
    if (this.config.allowedNumbers.length === 0) return true;
    return this.config.allowedNumbers.includes(from);
  }

  /**
   * Health check endpoint.
   */
  healthCheck(req, res) {
    res.json({
      status: 'ok',
      service: 'qa-engine-whatsapp-bot',
      uptime: process.uptime()
    });
  }
}

module.exports = WebhookServer;
```

### File: `interfaces/whatsapp-bot/index.js`

Entry point that wires the bot to a real engine.

```javascript
'use strict';

const WebhookServer = require('./server');
const MessageParser = require('./message-parser');
const CommandHandler = require('./command-handler');
const NotificationTemplates = require('./notification-templates');

/**
 * Create a fully-wired WhatsApp bot instance.
 * 
 * @param {Object} options
 * @param {Object} options.engine - From createEngine()
 * @param {Object} options.notifier - NotificationAdapter instance (Twilio)
 * @param {Object} options.config - WebhookConfig
 * @returns {WebhookServer}
 */
function createWhatsAppBot({ engine, notifier, config }) {
  return new WebhookServer({ engine, notifier, config });
}

module.exports = {
  createWhatsAppBot,
  WebhookServer,
  MessageParser,
  CommandHandler,
  NotificationTemplates
};
```

---

## 7. Test Specifications

### File: `tests/whatsapp-bot/message-parser.test.js`

**Target: ~52 tests**

```
describe('MessageParser', () => {

  describe('parse() — routing priority', () => {
    test('empty string → unknown')
    test('null → unknown')
    test('whitespace only → unknown')
    test('approval response checked before run command')
    test('help checked before run command')
  })

  describe('parseApprovalResponse()', () => {
    test('YES-ABC-247 → approve with approvalId ABC-247')
    test('NO-ABC-247 → reject with approvalId ABC-247')
    test('INFO-ABC-247 → info with approvalId ABC-247')
    test('yes-abc-247 → case-insensitive match, approvalId uppercased')
    test('YES-XYZ-1 → single digit ID')
    test('YES-ABC-12345 → multi-digit ID')
    test('YES-ABC → missing number, returns null')
    test('YES-AB-247 → only 2 letters, returns null')
    test('YES-ABCD-247 → 4 letters, returns null')
    test('YESABC247 → no dashes, returns null')
    test('YES- → incomplete, returns null')
    test('MAYBE-ABC-247 → unknown action, returns null')
  })

  describe('parseRunCommand()', () => {
    test('run → mode null, agents empty')
    test('Run → case-insensitive')
    test('test → alias for run')
    test('run smoke → mode smoke')
    test('run smoke tests → mode smoke, strips "tests"')
    test('run full → mode full')
    test('run regression → mode regression')
    test('run healer → agents [healer]')
    test('run sentinel → agents [sentinel]')
    test('run healer sentinel → agents [healer, sentinel]')
    test('run smoke healer → mode smoke, agents [healer]')
    test('test regression librarian → mode regression, agents [librarian]')
    test('run unknown_thing → ignores unrecognized args')
    test('running → does not match (not exact prefix)')
    test('run → trailing space handled')
  })

  describe('isStatusQuery()', () => {
    test('status → true')
    test('Status → case-insensitive')
    test("what's running → true")
    test('whats running → true (without apostrophe)')
    test("what's running? → true (with question mark)")
    test('progress → true')
    test('status update → false (extra words)')
  })

  describe('parseBugsQuery()', () => {
    test('bugs → status open (default)')
    test('open bugs → status open')
    test('fixed bugs → status fixed')
    test('all bugs → status all')
    test('what failed → status open')
    test('what failed? → status open (with question mark)')
    test('Bugs → case-insensitive')
    test('my bugs → null (unrecognized prefix)')
  })

  describe('isHelpRequest()', () => {
    test('help → true')
    test('commands → true')
    test('? → true')
    test('menu → true')
    test('Help → case-insensitive')
    test('help me → false (extra words)')
  })

  describe('parse() — full integration', () => {
    test('YES-ABC-247 → {type: approve, params: {approvalId: ABC-247}}')
    test('run smoke → {type: run, params: {mode: smoke, agents: []}}')
    test('bugs → {type: bugs, params: {status: open}}')
    test('status → {type: status, params: {}}')
    test('help → {type: help, params: {}}')
    test('hello there → {type: unknown, params: {originalText: "hello there"}}')
  })
})
```

### File: `tests/whatsapp-bot/notification-templates.test.js`

**Target: ~28 tests**

```
describe('NotificationTemplates', () => {

  describe('runAcknowledgment()', () => {
    test('includes mode label when mode provided')
    test('says "all tests" when mode is null')
    test('lists specific agent names when provided')
    test('says "all enabled agents" when agents empty')
    test('includes app ID')
  })

  describe('runComplete()', () => {
    test('✅ icon when all passed')
    test('❌ icon when failures exist')
    test('includes pass/total counts')
    test('includes per-agent breakdown')
    test('formats duration correctly')
    test('shows bug count when bugs detected')
    test('says "No bugs detected" when none')
  })

  describe('statusReport()', () => {
    test('shows "No runs in progress" when no active runs')
    test('shows active run count and details')
    test('shows recent runs with icons')
    test('handles empty recent runs')
  })

  describe('bugsList()', () => {
    test('shows "No bugs found" when empty')
    test('formats bug entries with severity and status')
    test('truncates at 10 bugs')
    test('shows overflow count when > 10 bugs')
    test('includes filter label in header')
  })

  describe('approvalRequest()', () => {
    test('includes bug ID and title')
    test('includes YES/NO/INFO options with approval ID')
    test('includes severity and agent')
  })

  describe('approvalConfirmation()', () => {
    test('approved → ✅ message with fix in progress')
    test('rejected → 🚫 message with manual fix note')
  })

  describe('bugDetail()', () => {
    test('includes all bug fields')
    test('includes evidence summary')
    test('includes Linear link when available')
    test('handles missing optional fields')
  })

  describe('helpMenu()', () => {
    test('includes all command categories')
    test('includes approval syntax examples')
  })

  describe('unknownCommand()', () => {
    test('includes truncated original text')
    test('truncates long messages at 30 chars')
    test('suggests help command')
  })

  describe('utility methods', () => {
    test('_formatDuration — seconds only')
    test('_formatDuration — minutes and seconds')
    test('_formatDuration — handles 0 and negative')
    test('_formatTime — formats Date object')
    test('_formatTime — formats ISO string')
    test('_formatTime — handles null')
  })
})
```

### File: `tests/whatsapp-bot/command-handler.test.js`

**Target: ~38 tests**

```
describe('CommandHandler', () => {

  describe('constructor', () => {
    test('throws if engine missing')
    test('throws if notifier missing')
    test('defaults defaultAppId to brainstormy')
    test('accepts custom defaultAppId')
  })

  describe('handle() — routing', () => {
    test('routes run command to handleRun')
    test('routes status command to handleStatus')
    test('routes bugs command to handleBugs')
    test('routes approve command to handleApprove')
    test('routes reject command to handleReject')
    test('routes info command to handleInfo')
    test('routes help command to handleHelp')
    test('routes unknown command to handleUnknown')
    test('catches handler errors and sends error notification')
  })

  describe('handleRun()', () => {
    test('sends acknowledgment immediately via notifier')
    test('calls engine.run(appId, options) with defaultAppId as first arg')
    test('calls engine.run() with mode in options when specified')
    test('calls engine.run() with agents in options when specified')
    test('does not await engine.run() — fire and forget')
    test('sends error notification if engine.run() rejects')
    test('returns success with ack message')
  })

  describe('handleStatus()', () => {
    test('calls engine.status()')
    test('formats activeRuns and recentRuns into status report')
    test('returns data from engine')
  })

  describe('handleBugs()', () => {
    test('calls engine.bugs(appId, options) with defaultAppId as first arg')
    test('passes status filter in options')
    test('formats and sends bug list')
  })

  describe('handleApprove()', () => {
    test('calls engine.approve() with approval ID')
    test('sends approved confirmation')
  })

  describe('handleReject()', () => {
    test('calls engine.reject() with approval ID')
    test('sends rejected confirmation')
  })

  describe('handleInfo()', () => {
    test('calls engine.bugInfo() with approval ID')
    test('sends formatted bug detail')
    test('sends not-found message when bug is null')
  })

  describe('handleHelp()', () => {
    test('sends help menu via notifier')
  })

  describe('handleUnknown()', () => {
    test('sends unknown command message via notifier')
    test('returns success: false')
  })

  describe('error handling', () => {
    test('engine.status() failure → sends internal error, returns success: false')
    test('notifier.send() failure in error handler → does not throw')
  })
})
```

### File: `tests/whatsapp-bot/server.test.js`

**Target: ~42 tests**

Uses `supertest` for HTTP-level testing of the Express app without starting a real server.

```
describe('WebhookServer', () => {

  describe('constructor', () => {
    test('throws if config missing')
    test('throws if twilioAuthToken missing when validateSignatures is true')
    test('allows missing twilioAuthToken when validateSignatures is false')
    test('applies default config values (port, path, etc.)')
    test('creates default MessageParser if not injected')
    test('creates default CommandHandler if not injected')
    test('uses injected parser when provided')
    test('uses injected handler when provided')
  })

  describe('createApp()', () => {
    test('returns an Express application')
    test('registers /health GET endpoint')
    test('registers webhookPath POST endpoint')
    test('configures URL-encoded body parsing')
  })

  describe('health check — GET /health', () => {
    test('returns 200 with status ok')
    test('includes service name')
    test('includes uptime')
  })

  describe('webhook — POST /webhooks/whatsapp', () => {

    describe('signature validation', () => {
      test('rejects request with missing X-Twilio-Signature → 403')
      test('rejects request with invalid signature → 403')
      test('accepts request with valid signature → 200')
      test('skips validation when validateSignatures is false')
    })

    describe('authorization', () => {
      test('allows message from authorized number')
      test('rejects message from unauthorized number')
      test('allows all numbers when allowedNumbers is empty')
      test('sends unauthorized notification to rejected sender')
    })

    describe('message extraction', () => {
      test('extracts From, Body, MessageSid, AccountSid')
      test('handles missing Body gracefully')
      test('handles missing From gracefully')
    })

    describe('command routing', () => {
      test('parses message body and routes to handler')
      test('returns empty TwiML response')
      test('returns 200 even on handler errors (prevents Twilio retries)')
    })

    describe('full integration flow', () => {
      test('"Run smoke tests" → parser → handler → run ack sent')
      test('"YES-ABC-247" → parser → handler → approve sent')
      test('"status" → parser → handler → status report sent')
      test('"help" → parser → handler → help menu sent')
      test('"gibberish" → parser → handler → unknown response sent')
    })
  })

  describe('validateSignature()', () => {
    test('computes HMAC-SHA1 correctly per Twilio spec')
    test('sorts POST params alphabetically')
    test('appends key-value pairs to URL')
    test('uses timing-safe comparison')
    test('returns false for length mismatch')
    test('uses config.webhookUrl when available')
    test('falls back to req host/path when webhookUrl not set')
  })

  describe('start() and stop()', () => {
    test('start() returns http.Server')
    test('stop() closes server gracefully')
    test('stop() resolves immediately if server not started')
  })

  describe('isAuthorized()', () => {
    test('returns true if from is in allowedNumbers')
    test('returns false if from is not in allowedNumbers')
    test('returns true if allowedNumbers is empty (dev mode)')
  })
})
```

### Test Counts Summary

| File | Tests |
|------|-------|
| `tests/engine/factory.test.js` (new methods) | ~10 |
| `tests/whatsapp-bot/message-parser.test.js` | ~52 |
| `tests/whatsapp-bot/notification-templates.test.js` | ~28 |
| `tests/whatsapp-bot/command-handler.test.js` | ~38 |
| `tests/whatsapp-bot/server.test.js` | ~42 |
| **Total new tests** | **~170** |
| **Prior project tests** | **~1,500+** |
| **Project total after** | **~1,670+** |

---

## 8. Mock Patterns

### Mock Engine

Every test that needs an engine uses this mock factory. Matches the `createEngine()` API surface.

```javascript
function createMockEngine(overrides = {}) {
  return {
    run: jest.fn().mockResolvedValue({
      id: 'run-001',
      status: 'completed',
      summary: {
        totalTests: 15,
        passed: 15,
        failed: 0,
        durationMs: 222000,
        bugsCreated: 0,
        agents: [
          { name: 'Healer', passed: 8, failed: 0, total: 8 },
          { name: 'Sentinel', passed: 7, failed: 0, total: 7 }
        ]
      }
    }),

    status: jest.fn().mockResolvedValue({
      activeRuns: [],
      recentRuns: [
        {
          id: 'run-001',
          mode: 'smoke',
          passed: 15,
          failed: 0,
          total: 15,
          completed_at: new Date().toISOString(),
          agents: ['Healer', 'Sentinel']
        }
      ]
    }),

    bugs: jest.fn().mockResolvedValue([]),

    approve: jest.fn().mockResolvedValue({ 
      action: 'YES',
      approval_id: 'ABC-247',
      message: 'Fix approved',
      status: 'approved' 
    }),

    reject: jest.fn().mockResolvedValue({ 
      action: 'NO',
      approval_id: 'ABC-247',
      message: 'Fix rejected',
      status: 'rejected' 
    }),

    bugInfo: jest.fn().mockResolvedValue({
      bug_id: 'BUG-248',
      title: 'Memory recall failed',
      severity: 'medium',
      category: 'memory',
      detected_by: 'Sentinel',
      root_cause: 'Search query mismatch',
      affected_component: 'services/semantic-search.js',
      fix_approach: 'Update query weighting',
      approval_id: 'ABC-248',
      approval_status: 'pending',
      created_at: new Date().toISOString(),
      evidence: {
        screenshots: ['screenshot-001.png'],
        console_errors: 0,
        network_failures: 1
      }
    }),

    ...overrides
  };
}
```

### Mock Notifier

```javascript
function createMockNotifier() {
  return {
    send: jest.fn().mockResolvedValue({ id: 'msg-001', status: 'sent' }),
    sendWithActions: jest.fn().mockResolvedValue({ id: 'msg-002', status: 'sent' })
  };
}
```

### Supertest Setup for Server Tests

```javascript
const request = require('supertest');
const crypto = require('crypto');
const WebhookServer = require('../../interfaces/whatsapp-bot/server');

function createTestServer(overrides = {}) {
  const engine = createMockEngine(overrides.engine);
  const notifier = createMockNotifier();
  const config = {
    port: 0, // Random port
    webhookPath: '/webhooks/whatsapp',
    twilioAuthToken: 'test-auth-token-32chars-abcdefgh',
    webhookUrl: 'https://example.com/webhooks/whatsapp',
    allowedNumbers: ['whatsapp:+1234567890'],
    validateSignatures: false, // Disable for most tests
    defaultAppId: 'brainstormy',
    ...overrides.config
  };

  const server = new WebhookServer({ engine, notifier, config });
  const app = server.createApp();

  return { server, app, engine, notifier, config };
}

function generateTwilioSignature(url, params, authToken) {
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
}

// Usage in tests:
const { app, engine, notifier } = createTestServer();

const response = await request(app)
  .post('/webhooks/whatsapp')
  .type('form')
  .send({
    Body: 'Run smoke tests',
    From: 'whatsapp:+1234567890',
    MessageSid: 'SM123',
    AccountSid: 'AC123'
  });

expect(response.status).toBe(200);
expect(engine.run).toHaveBeenCalledWith('brainstormy', expect.objectContaining({ mode: 'smoke' }));
```

---

## 9. Files to Create

| File | Description | LOC (approx) |
|------|-------------|--------------|
| `core/engine/factory.js` *(modify)* | Add approve/reject/bugInfo methods, enhance status() | ~30 |
| `interfaces/whatsapp-bot/message-parser.js` | Inbound message parsing | ~100 |
| `interfaces/whatsapp-bot/notification-templates.js` | All message templates | ~220 |
| `interfaces/whatsapp-bot/command-handler.js` | Command routing + engine interaction | ~170 |
| `interfaces/whatsapp-bot/server.js` | Express webhook server | ~180 |
| `interfaces/whatsapp-bot/index.js` | Public API + factory | ~25 |
| `tests/whatsapp-bot/message-parser.test.js` | Parser unit tests | ~350 |
| `tests/whatsapp-bot/notification-templates.test.js` | Template unit tests | ~250 |
| `tests/whatsapp-bot/command-handler.test.js` | Handler unit tests | ~300 |
| `tests/whatsapp-bot/server.test.js` | Server integration tests | ~400 |
| **Total** | **1 modified + 9 new files** | **~2,025** |

### npm Dependencies

```bash
# express already installed (v5.2.1)
npm install --save-dev supertest
```

`crypto` is a Node.js built-in — no install needed.

---

## 10. Claude Code Implementation Steps

### Step 0: Engine Factory Enhancements

Modify `core/engine/factory.js` to add three new methods to the engine object (`approve`, `reject`, `bugInfo`) that delegate to `ApprovalManager.handleResponse()`. Also enhance `engine.status()` to return `{ activeRuns, recentRuns }` instead of a flat array. Add tests for the new methods in `tests/engine/factory.test.js`.

Verify: `npx jest tests/engine/factory.test.js --verbose` — existing tests pass + new tests for approve/reject/bugInfo/enhanced status.

### Step 1: MessageParser + Tests

Create `interfaces/whatsapp-bot/message-parser.js` and `tests/whatsapp-bot/message-parser.test.js`.

Verify: `npx jest tests/whatsapp-bot/message-parser.test.js --verbose` — ~52 tests passing.

### Step 2: NotificationTemplates + Tests

Create `interfaces/whatsapp-bot/notification-templates.js` and `tests/whatsapp-bot/notification-templates.test.js`.

Verify: `npx jest tests/whatsapp-bot/notification-templates.test.js --verbose` — ~28 tests passing.

### Step 3: CommandHandler + Tests

Create `interfaces/whatsapp-bot/command-handler.js` and `tests/whatsapp-bot/command-handler.test.js`. Uses mock engine and mock notifier.

Verify: `npx jest tests/whatsapp-bot/command-handler.test.js --verbose` — ~38 tests passing.

### Step 4: WebhookServer + Tests

Install `supertest` (`express` already installed). Create `interfaces/whatsapp-bot/server.js` and `tests/whatsapp-bot/server.test.js`. Full HTTP-level integration tests.

Verify: `npx jest tests/whatsapp-bot/server.test.js --verbose` — ~42 tests passing.

### Step 5: Index + Wiring

Create `interfaces/whatsapp-bot/index.js` with `createWhatsAppBot()` factory and all exports.

Verify: All 4 test files pass together: `npx jest tests/whatsapp-bot/ --verbose` — ~160 tests.

### Step 6: Full Regression

Run the complete test suite: `npx jest --verbose`

Verify: ~1,670+ tests passing (including new factory tests), zero regressions.

### Implementation Log

After each step, append to `docs/whatsapp-bot-implementation-log.md`:
- Step number
- Files created/modified
- Actual test count (run tests to get real number)
- Any deviations from spec and why
- Timestamp

---

## 11. Validation Criteria

**Days 1-2 are complete when:**

- [ ] `core/engine/factory.js` updated with `approve()`, `reject()`, `bugInfo()` methods and enhanced `status()` return shape
- [ ] `interfaces/whatsapp-bot/message-parser.js` exists with full implementation
- [ ] `interfaces/whatsapp-bot/notification-templates.js` exists with all 14 template methods (using snake_case DB field names)
- [ ] `interfaces/whatsapp-bot/command-handler.js` exists routing all 8 command types
- [ ] `interfaces/whatsapp-bot/server.js` exists with Express app, signature validation, authorization
- [ ] `interfaces/whatsapp-bot/index.js` exports `createWhatsAppBot`, all classes
- [ ] ~160 new tests passing in `tests/whatsapp-bot/`
- [ ] Signature validation uses timing-safe HMAC-SHA1 comparison
- [ ] Authorization checks sender against allowlist
- [ ] All commands parse case-insensitively
- [ ] Approval responses (`YES-ABC-247`) route to `engine.approve()` → `ApprovalManager.handleResponse()`
- [ ] `engine.run(appId, options)` called with two parameters (appId first, options second)
- [ ] `engine.bugs(appId, options)` called with two parameters (appId first, options second)
- [ ] `engine.run()` is fire-and-forget (not awaited in webhook handler)
- [ ] Webhook always returns 200 to Twilio (even on errors)
- [ ] No regressions: `npx jest --verbose` — all ~1,670+ tests pass
- [ ] Implementation log updated at `docs/whatsapp-bot-implementation-log.md`

**Manual validation (after Week 4 concrete adapters are wired):**

```bash
# Start webhook server
npm run start:webhook

# Test via curl (simulates Twilio webhook)
curl -X POST http://localhost:3001/webhooks/whatsapp \
  -d "Body=Run smoke tests" \
  -d "From=whatsapp:+1234567890" \
  -d "MessageSid=SM123" \
  -d "AccountSid=AC123"

# Should return <Response></Response> and trigger test run

curl http://localhost:3001/health
# Should return {"status":"ok","service":"qa-engine-whatsapp-bot","uptime":...}
```

---

## 12. What This Spec Does NOT Cover

- **Scheduling / Cron:** Separate spec (Week 5 Day 5)
- **Twilio outbound adapter internals:** Already built (Week 4 Day 4)
- **Engine composition / `createEngine()`:** Already built (Week 4 Day 5)
- **Real Brainstormy connector:** Separate spec (Week 5 Days 3-5)
- **Multi-user / multi-app routing:** Phase 2
- **WhatsApp media messages (images, files):** Phase 2
- **Rate limiting:** Phase 2
- **Conversation state / follow-ups:** Phase 2 (e.g., "run that again")
