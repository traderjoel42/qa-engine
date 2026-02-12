# Bug Detector + Integration Adapters — Implementation Spec

**QA Engine Phase 1 · Week 3 · Days 1-2**
**Version:** 1.0
**Date:** February 12, 2026
**Builds on:** test-orchestrator-implementation-spec.md (Week 2 Day 5)

---

## Overview

This spec covers the Bug Detector (the core engine component that analyzes test failures, classifies bugs, and routes them to external systems) and three integration adapter interfaces plus the Linear client implementation.

**Entry point:** The Bug Detector is the `failureHandler` that the TestOrchestrator calls when agents produce failures. In Week 2, we injected a no-op `failureHandler` — this week we replace it with the real pipeline.

**Files to create:**
- `core/engine/bug-detector.js` — Main bug detection pipeline
- `core/integrations/adapters/bug-tracker.js` — Bug tracker adapter interface
- `core/integrations/adapters/notification.js` — Notification adapter interface
- `core/integrations/adapters/llm.js` — LLM adapter interface
- `core/integrations/linear/client.js` — Linear API client (implements BugTrackerAdapter)
- `core/engine/errors.js` — Week 3 error classes (extends agents/errors.js pattern)
- `tests/engine/bug-detector.test.js` — Bug Detector tests
- `tests/integrations/adapters/bug-tracker.test.js` — Adapter interface tests
- `tests/integrations/adapters/notification.test.js` — Adapter interface tests
- `tests/integrations/adapters/llm.test.js` — Adapter interface tests
- `tests/integrations/linear/client.test.js` — Linear client tests

---

## Design Decisions

### D1: Bug Detector as Standalone Class — Not a failureHandler Function

The TestOrchestrator accepts `failureHandler` as an injectable dependency with signature `async (agentId, failures, context) => void`. The Bug Detector is a full class with its own dependencies. The wiring layer creates a closure:

```javascript
const bugDetector = new BugDetector({ llm, bugTracker, notifier, storage, approvalManager });
const failureHandler = async (agentId, failures, context) => {
  for (const failure of failures) {
    await bugDetector.detectAndReport(context.appConfig, agentId, failure);
  }
};
const orchestrator = new TestOrchestrator(appConfig, { failureHandler });
```

**Why:** BugDetector needs its own rich dependency graph (LLM, bug tracker, notifier). Flattening that into a single function would lose testability. The closure adapts the class to the orchestrator's interface.

### D2: Adapter Interfaces Are Base Classes with `throw 'Not implemented'`

Same pattern as BaseConnector and BaseAgent — JavaScript doesn't have interfaces, so adapter base classes:
1. Define the method contract
2. Throw descriptive errors if subclasses don't override
3. Provide JSDoc type documentation for IDE support

Concrete implementations (LinearClient, TwilioClient, AnthropicClient) extend these base classes. The Bug Detector constructor accepts adapter instances — it never imports or instantiates concrete implementations.

### D3: Bug Detection Pipeline Is Sequential — Not Parallel

The pipeline steps (gather evidence → LLM analysis → classify → auto-fixability → create issue → approval) run sequentially because each step depends on the previous step's output. This is intentional — parallelizing would require speculative execution that wastes LLM tokens.

### D4: LLM Analysis Returns Structured JSON — Parsed with Fallback

The LLM prompt requests JSON output. We parse with `JSON.parse()` inside a try/catch. On parse failure, we create a degraded analysis with `root_cause: 'LLM analysis failed'` and `auto_fixable: false` — the pipeline still creates an issue, just without LLM-enriched data. This ensures a bug is always tracked even when Claude returns malformed output.

### D5: Bug ID Generation Is In-Memory Counter — Not Database Sequence

For Phase 1, bug IDs (`BUG-1`, `BUG-2`, etc.) use a simple in-memory counter seeded from storage on construction. The database spec shows a `generate_bug_id()` function, but we won't have the database layer until later. The `storage` injectable handles persistence — the default no-op storage means IDs reset on restart (acceptable for Phase 1).

### D6: Auto-Fixability Is Conservative — Default False

The `isAutoFixable()` method checks three conditions (ALL must pass):
1. Fix approach matches a known simple pattern
2. Likely location is determinable (not 'unknown')
3. Category allows auto-fix (memory=yes, data-accuracy=yes, ui=no, backend=no, performance=yes)

If any check fails, `auto_fixable = false`. We err on the side of creating manual issues rather than attempting risky auto-fixes.

### D7: Error Classes Extend a New EngineError Base — Parallel to AgentError

Week 2 established `AgentError → ScenarioError, AssertionError, ConfigurationError`. Week 3 adds:
```
EngineError (base for all engine-level errors)
  ├── BugDetectorError   — failures in the detection pipeline
  ├── FixError            — failures in auto-fix (used in Days 3-4)
  ├── ApprovalError       — failures in approval workflow (used in Days 3-4)
  └── AdapterError        — failures in integration adapters
```

These are in `core/engine/errors.js`, separate from `agents/errors.js`.

---

## Error Classes

### File: `core/engine/errors.js`

```javascript
'use strict';

class EngineError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'ENGINE_ERROR';
    this.details = options.details || {};
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

class BugDetectorError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'BUG_DETECTOR_ERROR', ...options });
    this.phase = options.phase || 'unknown'; // 'evidence', 'analysis', 'classification', 'issue_creation', 'approval'
    this.bugContext = options.bugContext || null;
  }
}

class FixError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'FIX_ERROR', ...options });
    this.phase = options.phase || 'unknown'; // 'generation', 'safety_review', 'application', 'verification', 'rollback'
    this.bugId = options.bugId || null;
  }
}

class ApprovalError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'APPROVAL_ERROR', ...options });
    this.approvalId = options.approvalId || null;
  }
}

class AdapterError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'ADAPTER_ERROR', ...options });
    this.adapterType = options.adapterType || 'unknown'; // 'bug_tracker', 'notification', 'llm'
    this.operation = options.operation || null;
  }
}

module.exports = {
  EngineError,
  BugDetectorError,
  FixError,
  ApprovalError,
  AdapterError
};
```

---

## Integration Adapter Interfaces

### File: `core/integrations/adapters/bug-tracker.js`

```javascript
'use strict';

const { AdapterError } = require('../../engine/errors');

/**
 * Base adapter for bug tracking systems (Linear, Jira, GitHub Issues, etc.).
 * Concrete implementations must override all methods.
 */
class BugTrackerAdapter {
  /**
   * Create a new issue in the bug tracker.
   * @param {Object} bug - Bug data
   * @param {string} bug.title - Issue title
   * @param {string} bug.description - Formatted issue description (Markdown)
   * @param {string} bug.priority - Priority: 'urgent', 'high', 'normal', 'low'
   * @param {string[]} bug.labels - Labels to apply
   * @param {Object} [bug.custom_fields] - Tracker-specific custom fields
   * @returns {Promise<{id: string, url: string, key: string}>} Created issue reference
   */
  async createIssue(bug) {
    throw new AdapterError('createIssue() must be implemented by subclass', {
      adapterType: 'bug_tracker',
      operation: 'createIssue'
    });
  }

  /**
   * Update an existing issue.
   * @param {string} id - Issue ID in the bug tracker
   * @param {Object} updates - Fields to update (status, priority, labels, description, etc.)
   * @returns {Promise<{id: string, url: string}>} Updated issue reference
   */
  async updateIssue(id, updates) {
    throw new AdapterError('updateIssue() must be implemented by subclass', {
      adapterType: 'bug_tracker',
      operation: 'updateIssue'
    });
  }

  /**
   * Add a comment to an existing issue.
   * @param {string} id - Issue ID
   * @param {string} comment - Comment text (Markdown)
   * @returns {Promise<{id: string}>} Comment reference
   */
  async addComment(id, comment) {
    throw new AdapterError('addComment() must be implemented by subclass', {
      adapterType: 'bug_tracker',
      operation: 'addComment'
    });
  }

  /**
   * Get an issue by ID.
   * @param {string} id - Issue ID
   * @returns {Promise<Object>} Issue data (tracker-specific shape)
   */
  async getIssue(id) {
    throw new AdapterError('getIssue() must be implemented by subclass', {
      adapterType: 'bug_tracker',
      operation: 'getIssue'
    });
  }
}

module.exports = BugTrackerAdapter;
```

### File: `core/integrations/adapters/notification.js`

```javascript
'use strict';

const { AdapterError } = require('../../engine/errors');

/**
 * Base adapter for notification channels (WhatsApp, Slack, email, etc.).
 * Concrete implementations must override all methods.
 */
class NotificationAdapter {
  /**
   * Send a simple text message.
   * @param {string|string[]} recipient - Recipient identifier(s) (phone number, channel ID, email)
   * @param {string} message - Message text
   * @returns {Promise<{id: string, status: string}>} Send result
   */
  async send(recipient, message) {
    throw new AdapterError('send() must be implemented by subclass', {
      adapterType: 'notification',
      operation: 'send'
    });
  }

  /**
   * Send a message with interactive actions (approve/reject buttons).
   * @param {string|string[]} recipient - Recipient identifier(s)
   * @param {string} message - Message text
   * @param {Array<{id: string, label: string}>} actions - Available actions
   * @returns {Promise<{id: string, status: string}>} Send result
   */
  async sendWithActions(recipient, message, actions) {
    throw new AdapterError('sendWithActions() must be implemented by subclass', {
      adapterType: 'notification',
      operation: 'sendWithActions'
    });
  }
}

module.exports = NotificationAdapter;
```

### File: `core/integrations/adapters/llm.js`

```javascript
'use strict';

const { AdapterError } = require('../../engine/errors');

/**
 * Base adapter for LLM providers (Anthropic Claude, OpenAI, etc.).
 * Concrete implementations must override all methods.
 */
class LLMAdapter {
  /**
   * Send a completion request and return the full response.
   * @param {string} prompt - The prompt text
   * @param {Object} [options] - Provider-specific options
   * @param {string} [options.model] - Model identifier
   * @param {number} [options.maxTokens] - Maximum tokens in response
   * @param {number} [options.temperature] - Sampling temperature (0-1)
   * @param {string} [options.systemPrompt] - System-level instructions
   * @returns {Promise<{content: string, usage: {inputTokens: number, outputTokens: number}, model: string}>}
   */
  async complete(prompt, options = {}) {
    throw new AdapterError('complete() must be implemented by subclass', {
      adapterType: 'llm',
      operation: 'complete'
    });
  }

  /**
   * Send a completion request and stream the response.
   * @param {string} prompt - The prompt text
   * @param {Object} [options] - Same as complete()
   * @returns {AsyncGenerator<string>} Yields response chunks
   */
  async *streamComplete(prompt, options = {}) {
    throw new AdapterError('streamComplete() must be implemented by subclass', {
      adapterType: 'llm',
      operation: 'streamComplete'
    });
  }
}

module.exports = LLMAdapter;
```

---

## Linear Client Implementation

### File: `core/integrations/linear/client.js`

```javascript
'use strict';

const BugTrackerAdapter = require('../adapters/bug-tracker');
const { AdapterError } = require('../../engine/errors');

/**
 * Linear API client that implements the BugTrackerAdapter interface.
 *
 * Uses Linear's REST API v1 for issue management.
 * Requires: apiKey, teamId. Optional: projectId, defaultLabels.
 */
class LinearClient extends BugTrackerAdapter {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - Linear API key
   * @param {string} config.teamId - Linear team ID
   * @param {string} [config.projectId] - Default project ID
   * @param {string[]} [config.defaultLabels] - Labels to apply to all issues
   * @param {string} [config.baseUrl] - API base URL (default: https://api.linear.app)
   * @param {Function} [config.httpClient] - Injectable HTTP client for testing (default: fetch)
   */
  constructor(config = {}) {
    super();

    if (!config.apiKey) {
      throw new AdapterError('LinearClient requires config.apiKey', {
        adapterType: 'bug_tracker',
        operation: 'constructor'
      });
    }
    if (!config.teamId) {
      throw new AdapterError('LinearClient requires config.teamId', {
        adapterType: 'bug_tracker',
        operation: 'constructor'
      });
    }

    this._apiKey = config.apiKey;
    this._teamId = config.teamId;
    this._projectId = config.projectId || null;
    this._defaultLabels = config.defaultLabels || [];
    this._baseUrl = config.baseUrl || 'https://api.linear.app';
    this._httpClient = config.httpClient || null; // null = use global fetch
  }

  /**
   * Create a Linear issue via GraphQL API.
   */
  async createIssue(bug) {
    if (!bug || !bug.title) {
      throw new AdapterError('createIssue requires bug.title', {
        adapterType: 'bug_tracker',
        operation: 'createIssue'
      });
    }

    const allLabels = [...this._defaultLabels, ...(bug.labels || [])];
    const labelIds = await this._resolveLabels(allLabels);

    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
            title
          }
        }
      }
    `;

    const variables = {
      input: {
        teamId: this._teamId,
        title: bug.title,
        description: bug.description || '',
        priority: this._mapPriority(bug.priority),
        labelIds: labelIds,
        ...(this._projectId ? { projectId: this._projectId } : {})
      }
    };

    const result = await this._graphql(mutation, variables);

    if (!result.issueCreate || !result.issueCreate.success) {
      throw new AdapterError('Linear issue creation failed', {
        adapterType: 'bug_tracker',
        operation: 'createIssue',
        details: { result }
      });
    }

    const issue = result.issueCreate.issue;
    return {
      id: issue.id,
      key: issue.identifier, // e.g., "ENG-247"
      url: issue.url
    };
  }

  /**
   * Update an existing Linear issue.
   */
  async updateIssue(id, updates) {
    if (!id) {
      throw new AdapterError('updateIssue requires id', {
        adapterType: 'bug_tracker',
        operation: 'updateIssue'
      });
    }

    const mutation = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            url
          }
        }
      }
    `;

    const input = {};
    if (updates.title) input.title = updates.title;
    if (updates.description) input.description = updates.description;
    if (updates.priority) input.priority = this._mapPriority(updates.priority);
    if (updates.status) input.stateId = await this._resolveState(updates.status);

    const result = await this._graphql(mutation, { id, input });

    if (!result.issueUpdate || !result.issueUpdate.success) {
      throw new AdapterError('Linear issue update failed', {
        adapterType: 'bug_tracker',
        operation: 'updateIssue',
        details: { id, result }
      });
    }

    const issue = result.issueUpdate.issue;
    return { id: issue.id, url: issue.url };
  }

  /**
   * Add a comment to a Linear issue.
   */
  async addComment(id, comment) {
    if (!id) {
      throw new AdapterError('addComment requires id', {
        adapterType: 'bug_tracker',
        operation: 'addComment'
      });
    }
    if (!comment) {
      throw new AdapterError('addComment requires comment text', {
        adapterType: 'bug_tracker',
        operation: 'addComment'
      });
    }

    const mutation = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
          }
        }
      }
    `;

    const result = await this._graphql(mutation, {
      input: { issueId: id, body: comment }
    });

    if (!result.commentCreate || !result.commentCreate.success) {
      throw new AdapterError('Linear comment creation failed', {
        adapterType: 'bug_tracker',
        operation: 'addComment',
        details: { id, result }
      });
    }

    return { id: result.commentCreate.comment.id };
  }

  /**
   * Get a Linear issue by ID.
   */
  async getIssue(id) {
    if (!id) {
      throw new AdapterError('getIssue requires id', {
        adapterType: 'bug_tracker',
        operation: 'getIssue'
      });
    }

    const query = `
      query Issue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          url
          priority
          state { name }
          labels { nodes { name } }
          createdAt
          updatedAt
        }
      }
    `;

    const result = await this._graphql(query, { id });

    if (!result.issue) {
      throw new AdapterError(`Linear issue not found: ${id}`, {
        adapterType: 'bug_tracker',
        operation: 'getIssue',
        details: { id }
      });
    }

    return result.issue;
  }

  // --- Private helpers ---

  /**
   * Execute a GraphQL request against Linear's API.
   */
  async _graphql(query, variables = {}) {
    const doFetch = this._httpClient || fetch;

    let response;
    try {
      response = await doFetch(`${this._baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this._apiKey
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (err) {
      throw new AdapterError(`Linear API request failed: ${err.message}`, {
        adapterType: 'bug_tracker',
        operation: 'graphql',
        details: { originalError: err.message }
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unable to read response');
      throw new AdapterError(`Linear API returned ${response.status}: ${body}`, {
        adapterType: 'bug_tracker',
        operation: 'graphql',
        details: { status: response.status, body }
      });
    }

    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      throw new AdapterError(`Linear GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`, {
        adapterType: 'bug_tracker',
        operation: 'graphql',
        details: { errors: json.errors }
      });
    }

    return json.data;
  }

  /**
   * Map our priority strings to Linear's numeric priorities.
   * Linear: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low
   */
  _mapPriority(priority) {
    const map = {
      'urgent': 1,
      'high': 2,
      'normal': 3,
      'low': 4
    };
    return map[priority] || 3;
  }

  /**
   * Resolve label names to IDs. Creates labels that don't exist.
   * Returns array of label IDs.
   */
  async _resolveLabels(labelNames) {
    if (!labelNames || labelNames.length === 0) return [];

    // Fetch existing team labels
    const query = `
      query TeamLabels($teamId: String!) {
        team(id: $teamId) {
          labels { nodes { id name } }
        }
      }
    `;

    const result = await this._graphql(query, { teamId: this._teamId });
    const existingLabels = result.team?.labels?.nodes || [];
    const labelMap = new Map(existingLabels.map(l => [l.name, l.id]));

    const ids = [];
    for (const name of labelNames) {
      if (labelMap.has(name)) {
        ids.push(labelMap.get(name));
      } else {
        // Create label
        const createResult = await this._graphql(`
          mutation LabelCreate($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) {
              success
              issueLabel { id }
            }
          }
        `, { input: { teamId: this._teamId, name } });

        if (createResult.issueLabelCreate?.success) {
          ids.push(createResult.issueLabelCreate.issueLabel.id);
        }
      }
    }

    return ids;
  }

  /**
   * Resolve a status name to a Linear workflow state ID.
   */
  async _resolveState(statusName) {
    const query = `
      query TeamStates($teamId: String!) {
        team(id: $teamId) {
          states { nodes { id name } }
        }
      }
    `;

    const result = await this._graphql(query, { teamId: this._teamId });
    const states = result.team?.states?.nodes || [];
    const state = states.find(s => s.name.toLowerCase() === statusName.toLowerCase());
    return state?.id || null;
  }
}

module.exports = LinearClient;
```

---

## Bug Detector Implementation

### File: `core/engine/bug-detector.js`

### Constructor + Method Inventory

| Method | Visibility | Signature | Purpose |
|--------|-----------|-----------|---------|
| `constructor(options)` | public | `(options: Object) → BugDetector` | Accept injectable adapters |
| `detectAndReport(app, agentId, failure)` | public | `async (Object, string, Object) → BugRecord` | Main pipeline entry point |
| `gatherEvidence(failure)` | public | `async (Object) → EvidenceBundle` | Assemble evidence from failure |
| `analyzeBug(app, agentId, failure, evidence)` | public | `async (Object, string, Object, Object) → LLMAnalysis` | LLM-powered root cause analysis |
| `classifyBug(analysis)` | public | `(LLMAnalysis) → Classification` | Severity + category + priority |
| `isAutoFixable(analysis, classification)` | public | `(LLMAnalysis, Classification) → boolean` | Conservative auto-fix determination |
| `createBugRecord(app, agentId, failure, analysis, classification, autoFixable, evidence)` | public | `async (...) → BugRecord` | Create and persist bug |
| `createExternalIssue(app, bug)` | public | `async (Object, BugRecord) → {id, url, key}` | Create issue in bug tracker |
| `formatIssueDescription(bug)` | public | `(BugRecord) → string` | Format Markdown issue body |
| `_generateBugId()` | private | `() → string` | Generate `BUG-{n}` ID |
| `_buildAnalysisPrompt(app, agentId, failure, evidence)` | private | `(Object, string, Object, Object) → string` | Build LLM prompt |
| `_parseAnalysisResponse(content)` | private | `(string) → LLMAnalysis` | Parse LLM JSON with fallback |
| `_mapSeverityToPriority(severity)` | private | `(string) → string` | Map severity → priority |

### Data Structures

#### BugRecord
```javascript
{
  id: 'uuid-string',           // Internal ID
  bug_id: 'BUG-247',           // Human-readable ID
  app_id: 'brainstormy',       // App identifier
  title: 'Memory recall failed for character Marcus',
  description: 'Full description...',

  // Classification
  severity: 'high',            // 'critical' | 'high' | 'medium' | 'low'
  priority: 'high',            // 'urgent' | 'high' | 'normal' | 'low'
  category: 'memory',          // 'memory' | 'data-accuracy' | 'ui' | 'backend' | 'performance'
  status: 'open',              // 'open' | 'in-progress' | 'fixed' | 'verified' | 'closed'

  // Detection
  detected_by: 'sentinel',     // Agent ID
  test_name: 'Multi-session memory recall',
  scenario: 'establish-recall-3-facts',

  // LLM Analysis
  root_cause: 'Semantic search returning low-relevance results...',
  affected_component: 'Search service - vector similarity',
  likely_location: 'services/search.py:retrieve_context()',
  fix_approach: 'Adjust similarity threshold from 0.7 to 0.6',
  confidence: 0.85,

  // Evidence
  evidence: { /* EvidenceBundle */ },

  // External tracking
  external_issue_id: 'abc123',
  external_issue_url: 'https://linear.app/team/ENG-247',

  // Auto-fix
  auto_fixable: true,

  // Timestamps
  created_at: '2026-02-12T...',
  updated_at: '2026-02-12T...'
}
```

#### EvidenceBundle
```javascript
{
  test_id: 'sentinel-memory-recall-001',
  test_name: 'Multi-session memory recall',
  scenario: 'establish-recall-3-facts',
  step_failed: 'recall_check',
  error_message: 'Expected Marcus, got undefined',
  error_stack: 'Error: Expected Marcus...\n  at ...',

  screenshots: ['evidence/screenshots/sentinel-001-step3.png'],
  console_logs: [{ level: 'error', message: '...', timestamp: '...' }],
  network_requests: [{ url: '...', status: 500, method: 'POST', failed: true }],

  url: 'https://brainstormy.app/story/abc/session/xyz',
  occurred_at: '2026-02-12T...',
  test_started_at: '2026-02-12T...'
}
```

#### LLMAnalysis
```javascript
{
  root_cause: 'string',
  affected_component: 'string',
  likely_location: 'string',
  fix_approach: 'string',
  confidence: 0.85,           // 0.0-1.0
  impact_assessment: 'string'
}
```

#### Classification
```javascript
{
  severity: 'high',
  category: 'memory',
  priority: 'high'
}
```

### Full Implementation

```javascript
'use strict';

const { BugDetectorError } = require('./errors');

class BugDetector {
  /**
   * @param {Object} options
   * @param {import('../integrations/adapters/llm')} options.llm - LLM adapter for bug analysis
   * @param {import('../integrations/adapters/bug-tracker')} [options.bugTracker] - Bug tracker adapter (default: no-op)
   * @param {import('../integrations/adapters/notification')} [options.notifier] - Notification adapter (default: no-op)
   * @param {Object} [options.storage] - Storage interface { saveBug, updateBug, getNextBugNumber }
   * @param {Object} [options.approvalManager] - Approval manager instance (wired in Days 3-4)
   */
  constructor(options = {}) {
    if (!options.llm) {
      throw new BugDetectorError('BugDetector requires options.llm adapter', {
        phase: 'construction'
      });
    }

    this._llm = options.llm;
    this._bugTracker = options.bugTracker || null;
    this._notifier = options.notifier || null;
    this._approvalManager = options.approvalManager || null;

    // Storage with no-op defaults
    this._storage = options.storage || {
      saveBug: async (bug) => bug,
      updateBug: async (id, updates) => ({ id, ...updates }),
      getNextBugNumber: async () => this._bugCounter
    };

    // In-memory bug ID counter (Phase 1)
    this._bugCounter = 1;
  }

  /**
   * Main pipeline: analyze failure → classify → create issue → maybe trigger approval.
   *
   * @param {Object} app - App configuration
   * @param {string} agentId - Agent that detected the failure
   * @param {Object} failure - Failure data from agent test run (scenario result with error)
   * @returns {Promise<Object>} BugRecord
   */
  async detectAndReport(app, agentId, failure) {
    if (!app) {
      throw new BugDetectorError('detectAndReport requires app config', { phase: 'evidence' });
    }
    if (!agentId) {
      throw new BugDetectorError('detectAndReport requires agentId', { phase: 'evidence' });
    }
    if (!failure) {
      throw new BugDetectorError('detectAndReport requires failure data', { phase: 'evidence' });
    }

    // 1. Gather evidence
    let evidence;
    try {
      evidence = this.gatherEvidence(failure);
    } catch (err) {
      throw new BugDetectorError(`Evidence gathering failed: ${err.message}`, {
        phase: 'evidence',
        details: { originalError: err.message }
      });
    }

    // 2. LLM analysis
    let analysis;
    try {
      analysis = await this.analyzeBug(app, agentId, failure, evidence);
    } catch (err) {
      // Degraded mode — create bug without LLM enrichment
      analysis = {
        root_cause: 'LLM analysis failed',
        affected_component: 'unknown',
        likely_location: 'unknown',
        fix_approach: 'Manual investigation required',
        confidence: 0,
        impact_assessment: 'Unable to assess — LLM analysis failed'
      };
    }

    // 3. Classify
    const classification = this.classifyBug(analysis);

    // 4. Determine auto-fixability
    const autoFixable = this.isAutoFixable(analysis, classification);

    // 5. Create bug record
    const bug = await this.createBugRecord(
      app, agentId, failure, analysis, classification, autoFixable, evidence
    );

    // 6. Create external issue (if bug tracker configured)
    if (this._bugTracker) {
      try {
        const externalIssue = await this.createExternalIssue(app, bug);
        bug.external_issue_id = externalIssue.id;
        bug.external_issue_url = externalIssue.url;
        bug.external_issue_key = externalIssue.key;
        await this._storage.updateBug(bug.id, {
          external_issue_id: externalIssue.id,
          external_issue_url: externalIssue.url
        });
      } catch (err) {
        // Non-fatal: bug is tracked internally even if external creation fails
        bug._issueCreationError = err.message;
      }
    }

    // 7. Initiate approval if auto-fixable and approval manager exists
    if (autoFixable && this._approvalManager) {
      try {
        const approval = await this._approvalManager.requestApproval(app, bug);
        bug.approval_id = approval.approval_id;
      } catch (err) {
        // Non-fatal: bug exists, approval just didn't send
        bug._approvalError = err.message;
      }
    }

    return bug;
  }

  /**
   * Assemble evidence from the failure object.
   * Normalizes the shape regardless of which agent produced the failure.
   */
  gatherEvidence(failure) {
    const evidence = {
      test_id: failure.test_id || failure.scenarioId || null,
      test_name: failure.test_name || failure.scenarioName || failure.name || 'unknown',
      scenario: failure.scenario || failure.scenarioId || null,
      step_failed: failure.step || failure.stepIndex || null,
      error_message: null,
      error_stack: null,
      screenshots: [],
      console_logs: [],
      network_requests: [],
      url: null,
      occurred_at: failure.timestamp || new Date().toISOString(),
      test_started_at: failure.startedAt || null
    };

    // Extract error info
    if (failure.error) {
      if (failure.error instanceof Error) {
        evidence.error_message = failure.error.message;
        evidence.error_stack = failure.error.stack;
      } else if (typeof failure.error === 'string') {
        evidence.error_message = failure.error;
      } else if (typeof failure.error === 'object') {
        evidence.error_message = failure.error.message || JSON.stringify(failure.error);
        evidence.error_stack = failure.error.stack || null;
      }
    }

    // Extract evidence attachments
    if (failure.evidence) {
      evidence.screenshots = failure.evidence.screenshots || [];
      evidence.console_logs = failure.evidence.console_logs || failure.evidence.consoleLogs || [];
      evidence.network_requests = failure.evidence.network_requests || failure.evidence.networkRequests || [];
    }

    // Extract state/URL
    if (failure.state) {
      evidence.url = failure.state.url || null;
    }

    return evidence;
  }

  /**
   * Send failure + evidence to LLM for root cause analysis.
   */
  async analyzeBug(app, agentId, failure, evidence) {
    const prompt = this._buildAnalysisPrompt(app, agentId, failure, evidence);

    const response = await this._llm.complete(prompt, {
      model: 'claude-sonnet-4-5-20250514',
      maxTokens: 1024,
      temperature: 0.2,
      systemPrompt: 'You are a QA engineer analyzing test failures. Return your analysis as valid JSON only, with no markdown fencing or extra text.'
    });

    return this._parseAnalysisResponse(response.content);
  }

  /**
   * Classify a bug based on LLM analysis.
   * Maps analysis fields to severity/category/priority.
   */
  classifyBug(analysis) {
    // Determine category from affected_component
    let category = 'backend'; // default
    const component = (analysis.affected_component || '').toLowerCase();
    if (component.includes('memory') || component.includes('recall') || component.includes('search')) {
      category = 'memory';
    } else if (component.includes('citation') || component.includes('accuracy') || component.includes('bible')) {
      category = 'data-accuracy';
    } else if (component.includes('ui') || component.includes('frontend') || component.includes('display')) {
      category = 'ui';
    } else if (component.includes('performance') || component.includes('latency') || component.includes('speed')) {
      category = 'performance';
    }

    // Determine severity from confidence + impact
    let severity = 'medium'; // default
    const impact = (analysis.impact_assessment || '').toLowerCase();
    if (analysis.confidence >= 0.8 && (impact.includes('critical') || impact.includes('data loss') || impact.includes('crash'))) {
      severity = 'critical';
    } else if (analysis.confidence >= 0.6 && (impact.includes('high') || impact.includes('broken') || impact.includes('fail'))) {
      severity = 'high';
    } else if (analysis.confidence < 0.4 || impact.includes('minor') || impact.includes('cosmetic')) {
      severity = 'low';
    }

    const priority = this._mapSeverityToPriority(severity);

    return { severity, category, priority };
  }

  /**
   * Determine if a bug can be auto-fixed.
   * Conservative — all three conditions must pass.
   */
  isAutoFixable(analysis, classification) {
    // Condition 1: Fix approach matches known simple patterns
    const simpleFixPatterns = [
      'adjust threshold',
      'update selector',
      'fix timeout',
      'add null check',
      'update config',
      'change parameter',
      'modify prompt',
      'fix off-by-one'
    ];

    const fixApproach = (analysis.fix_approach || '').toLowerCase();
    const hasSimplePattern = simpleFixPatterns.some(pattern =>
      fixApproach.includes(pattern)
    );

    if (!hasSimplePattern) {
      return false;
    }

    // Condition 2: Likely location is determinable
    if (!analysis.likely_location || analysis.likely_location === 'unknown') {
      return false;
    }

    // Condition 3: Category allows auto-fix
    const categoryRules = {
      'memory': true,
      'data-accuracy': true,
      'ui': false,
      'backend': false,
      'performance': true
    };

    return categoryRules[classification.category] !== false;
  }

  /**
   * Create and persist a bug record.
   */
  async createBugRecord(app, agentId, failure, analysis, classification, autoFixable, evidence) {
    const bugId = this._generateBugId();

    const bug = {
      id: `bug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bug_id: bugId,
      app_id: app.id || app.name || 'unknown',
      title: this._generateTitle(agentId, analysis, evidence),
      description: analysis.impact_assessment || '',

      severity: classification.severity,
      priority: classification.priority,
      category: classification.category,
      status: 'open',

      detected_by: agentId,
      test_name: evidence.test_name,
      scenario: evidence.scenario,

      root_cause: analysis.root_cause,
      affected_component: analysis.affected_component,
      likely_location: analysis.likely_location,
      fix_approach: analysis.fix_approach,
      confidence: analysis.confidence,

      evidence: evidence,

      external_issue_id: null,
      external_issue_url: null,

      auto_fixable: autoFixable,

      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await this._storage.saveBug(bug);
    return bug;
  }

  /**
   * Create an issue in the external bug tracker.
   */
  async createExternalIssue(app, bug) {
    const description = this.formatIssueDescription(bug);

    const labels = [
      'qa-detected',
      bug.auto_fixable ? 'auto-fixable' : 'needs-manual-fix',
      `agent:${bug.detected_by}`,
      `severity:${bug.severity}`
    ];

    return await this._bugTracker.createIssue({
      title: `[QA] ${bug.title}`,
      description,
      priority: bug.priority,
      labels,
      custom_fields: {
        test_id: bug.evidence.test_id,
        bug_id: bug.bug_id
      }
    });
  }

  /**
   * Format a Markdown description for the external issue.
   */
  formatIssueDescription(bug) {
    const screenshotSection = bug.evidence.screenshots.length > 0
      ? `- [Screenshot](${bug.evidence.screenshots[bug.evidence.screenshots.length - 1]})`
      : '- No screenshots captured';

    const consoleErrors = (bug.evidence.console_logs || []).filter(l => l.level === 'error').length;
    const networkFailures = (bug.evidence.network_requests || []).filter(r => r.failed).length;

    return `## Test Information
- **Agent:** ${bug.detected_by}
- **Test:** ${bug.test_name}
- **Scenario:** ${bug.scenario || 'N/A'}

## Root Cause
${bug.root_cause}

## Affected Component
${bug.affected_component}

## Likely Location
\`${bug.likely_location}\`

## Fix Approach
${bug.fix_approach}

## Evidence
${screenshotSection}
- Console Errors: ${consoleErrors}
- Network Failures: ${networkFailures}

## Auto-Fix Status
${bug.auto_fixable ? '✅ Auto-fixable — approval initiated' : '❌ Requires manual fix'}
`.trim();
  }

  // --- Private helpers ---

  _generateBugId() {
    const id = `BUG-${this._bugCounter}`;
    this._bugCounter++;
    return id;
  }

  _generateTitle(agentId, analysis, evidence) {
    if (analysis.root_cause && analysis.root_cause !== 'LLM analysis failed') {
      // Use first sentence of root cause, capped at 80 chars
      const firstSentence = analysis.root_cause.split('.')[0].trim();
      return firstSentence.length > 80 ? firstSentence.substring(0, 77) + '...' : firstSentence;
    }
    // Fallback: use error message
    const errorMsg = evidence.error_message || 'Unknown failure';
    const prefix = `[${agentId}] `;
    const maxLen = 80 - prefix.length;
    return prefix + (errorMsg.length > maxLen ? errorMsg.substring(0, maxLen - 3) + '...' : errorMsg);
  }

  _buildAnalysisPrompt(app, agentId, failure, evidence) {
    const appName = app.name || app.id || 'Application';
    const consoleErrors = (evidence.console_logs || [])
      .filter(l => l.level === 'error')
      .slice(0, 5)
      .map(l => `  - ${l.message}`)
      .join('\n');
    const networkFailures = (evidence.network_requests || [])
      .filter(r => r.failed)
      .slice(0, 5)
      .map(r => `  - ${r.method || 'GET'} ${r.url} → ${r.status || 'failed'}`)
      .join('\n');

    return `You are analyzing a test failure for ${appName}.

TEST INFORMATION:
- Agent: ${agentId}
- Test: ${evidence.test_name}
- Scenario: ${evidence.scenario || 'N/A'}
- Step that failed: ${evidence.step_failed || 'N/A'}

ERROR:
${evidence.error_message || 'No error message'}

${evidence.error_stack ? `STACK TRACE:\n${evidence.error_stack}\n` : ''}
EVIDENCE:
- Console errors: ${consoleErrors || '  None'}
- Network failures: ${networkFailures || '  None'}
- URL at failure: ${evidence.url || 'N/A'}

Analyze and return JSON (no markdown fencing):
{
  "root_cause": "What actually broke (1-2 sentences)",
  "affected_component": "Which part of the app (e.g., 'Search service', 'UI renderer')",
  "likely_location": "File/function if determinable (e.g., 'services/search.py:retrieve_context()'), or 'unknown'",
  "fix_approach": "High-level fix strategy (e.g., 'adjust threshold', 'add null check')",
  "confidence": 0.85,
  "impact_assessment": "How severe — mention 'critical', 'high', 'minor', etc."
}`;
  }

  _parseAnalysisResponse(content) {
    // Try to extract JSON from response (might have markdown fencing)
    let jsonStr = content.trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate required fields, providing defaults
      return {
        root_cause: parsed.root_cause || 'Unable to determine',
        affected_component: parsed.affected_component || 'unknown',
        likely_location: parsed.likely_location || 'unknown',
        fix_approach: parsed.fix_approach || 'Manual investigation required',
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
        impact_assessment: parsed.impact_assessment || 'Unable to assess'
      };
    } catch (err) {
      // Degraded analysis — JSON parse failed
      return {
        root_cause: 'LLM analysis returned unparseable response',
        affected_component: 'unknown',
        likely_location: 'unknown',
        fix_approach: 'Manual investigation required',
        confidence: 0,
        impact_assessment: 'Unable to assess'
      };
    }
  }

  _mapSeverityToPriority(severity) {
    const map = {
      'critical': 'urgent',
      'high': 'high',
      'medium': 'normal',
      'low': 'low'
    };
    return map[severity] || 'normal';
  }
}

module.exports = BugDetector;
```

---

## Test Specifications

### File: `tests/engine/bug-detector.test.js`

Target: **~120 tests**

#### Test Groups

**Group 1: Constructor Validation (~8 tests)**
- Requires `options.llm` — throws BugDetectorError if missing
- Accepts llm + optional bugTracker, notifier, storage, approvalManager
- Default storage provides no-op methods
- Sets initial bug counter to 1

**Group 2: gatherEvidence() (~18 tests)**
- Extracts error from Error instance (message + stack)
- Extracts error from string
- Extracts error from plain object
- Handles missing error gracefully
- Extracts screenshots from failure.evidence.screenshots
- Extracts console_logs (both snake_case and camelCase keys)
- Extracts network_requests (both snake_case and camelCase keys)
- Handles missing evidence object
- Extracts URL from failure.state.url
- Sets occurred_at from failure.timestamp or defaults to now
- Sets test_name from failure.test_name, failure.scenarioName, failure.name fallback chain
- Handles completely empty failure (no crash, returns skeleton)

**Group 3: analyzeBug() (~12 tests)**
- Calls llm.complete with correct prompt structure
- Passes correct model, maxTokens, temperature options
- Parses valid JSON response
- Strips markdown code fences from response
- Handles missing fields in JSON (fills defaults)
- Clamps confidence to 0-1 range
- Returns degraded analysis on JSON parse failure
- Returns degraded analysis on LLM adapter error (propagates up to detectAndReport)

**Group 4: classifyBug() (~15 tests)**
- Category detection: 'memory' for memory/recall/search components
- Category detection: 'data-accuracy' for citation/accuracy/bible components
- Category detection: 'ui' for ui/frontend/display components
- Category detection: 'performance' for performance/latency/speed components
- Category default: 'backend' for unrecognized components
- Severity: 'critical' when confidence >= 0.8 AND impact mentions critical/data loss/crash
- Severity: 'high' when confidence >= 0.6 AND impact mentions high/broken/fail
- Severity: 'low' when confidence < 0.4 OR impact mentions minor/cosmetic
- Severity default: 'medium' when no other rule matches
- Priority maps from severity: critical→urgent, high→high, medium→normal, low→low

**Group 5: isAutoFixable() (~14 tests)**
- Returns true when all three conditions pass (simple pattern + known location + allowed category)
- Returns false when fix_approach has no simple pattern match
- Returns false when likely_location is 'unknown'
- Returns false when likely_location is null/undefined
- Returns false when category is 'ui'
- Returns false when category is 'backend'
- Returns true for category 'memory' with valid pattern + location
- Returns true for category 'data-accuracy' with valid pattern + location
- Returns true for category 'performance' with valid pattern + location
- Pattern matching is case-insensitive
- Each simple fix pattern tested: adjust threshold, update selector, fix timeout, add null check, update config, change parameter, modify prompt, fix off-by-one

**Group 6: createBugRecord() (~8 tests)**
- Generates incrementing BUG-{n} IDs
- Calls storage.saveBug with full record
- Record includes all fields from analysis + classification + evidence
- Title generated from root_cause first sentence (capped at 80 chars)
- Title fallback to error message when root_cause unavailable
- Status defaults to 'open'
- Timestamps populated

**Group 7: createExternalIssue() (~8 tests)**
- Calls bugTracker.createIssue with formatted data
- Title prefixed with `[QA]`
- Labels include: qa-detected, auto-fixable/needs-manual-fix, agent:{id}, severity:{level}
- Description includes all sections (Test Info, Root Cause, etc.)
- Custom fields include test_id and bug_id

**Group 8: formatIssueDescription() (~6 tests)**
- Includes all required Markdown sections
- Screenshot link uses last screenshot in array
- Shows 'No screenshots captured' when empty
- Console error count calculated correctly
- Network failure count calculated correctly
- Auto-fix status shows correct emoji + text

**Group 9: detectAndReport() Full Pipeline (~20 tests)**
- Happy path: all steps succeed, returns complete bug record
- Validation: throws on missing app
- Validation: throws on missing agentId
- Validation: throws on missing failure
- LLM failure: creates bug with degraded analysis (auto_fixable=false)
- Bug tracker failure: bug created but external_issue_id is null, _issueCreationError set
- Bug tracker not configured: skips issue creation entirely
- Approval manager configured + auto-fixable: calls requestApproval
- Approval manager failure: bug created, _approvalError set
- Approval manager not configured: skips approval
- Non-auto-fixable bug: skips approval even with manager configured
- Sequential bug IDs: BUG-1, BUG-2, BUG-3 across multiple calls
- Evidence correctly passed through pipeline
- Classification correctly passed through pipeline

**Group 10: _parseAnalysisResponse() Edge Cases (~8 tests)**
- Valid JSON string
- JSON wrapped in ```json fences
- JSON wrapped in ``` fences (no language tag)
- Invalid JSON → degraded result
- Empty string → degraded result
- Missing confidence → defaults to 0.5
- Confidence > 1 → clamped to 1.0
- Confidence < 0 → clamped to 0.0

### File: `tests/integrations/linear/client.test.js`

Target: **~40 tests**

**Group 1: Constructor (~4 tests)**
- Requires apiKey — throws AdapterError
- Requires teamId — throws AdapterError
- Accepts optional projectId, defaultLabels, baseUrl, httpClient
- Default baseUrl is https://api.linear.app

**Group 2: createIssue() (~10 tests)**
- Sends correct GraphQL mutation
- Maps priority strings to Linear numbers
- Includes defaultLabels + bug.labels
- Includes projectId when configured
- Throws on missing bug.title
- Throws on API failure (non-200)
- Throws on GraphQL errors
- Throws on issueCreate.success=false
- Returns {id, key, url}

**Group 3: updateIssue() (~6 tests)**
- Sends correct GraphQL mutation with id
- Maps update fields correctly
- Throws on missing id
- Throws on API failure

**Group 4: addComment() (~5 tests)**
- Sends correct mutation
- Throws on missing id
- Throws on missing comment
- Returns comment ID

**Group 5: getIssue() (~5 tests)**
- Sends correct query with id
- Returns full issue data
- Throws on missing id
- Throws on not found

**Group 6: _graphql() Internal (~6 tests)**
- Sends correct headers (Content-Type, Authorization)
- Handles network errors (fetch throws)
- Handles non-200 responses
- Handles GraphQL error array

**Group 7: _resolveLabels() (~4 tests)**
- Returns IDs for existing labels
- Creates missing labels
- Empty array returns empty
- Handles create failure gracefully

### File: `tests/integrations/adapters/*.test.js`

**Bug Tracker Adapter (~5 tests):** Each method throws AdapterError with correct adapterType and operation.

**Notification Adapter (~3 tests):** send() and sendWithActions() throw AdapterError.

**LLM Adapter (~3 tests):** complete() and streamComplete() throw AdapterError.

---

## Mock Patterns

### Mock LLM Adapter

```javascript
function createMockLLM(overrides = {}) {
  return {
    complete: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        root_cause: 'Test root cause',
        affected_component: 'Memory service',
        likely_location: 'services/search.py:retrieve_context()',
        fix_approach: 'Adjust threshold from 0.7 to 0.6',
        confidence: 0.85,
        impact_assessment: 'High impact - memory recall broken'
      }),
      usage: { inputTokens: 500, outputTokens: 200 },
      model: 'claude-sonnet-4-5-20250514'
    }),
    streamComplete: jest.fn(),
    ...overrides
  };
}
```

### Mock Bug Tracker Adapter

```javascript
function createMockBugTracker(overrides = {}) {
  return {
    createIssue: jest.fn().mockResolvedValue({
      id: 'linear-issue-123',
      key: 'ENG-247',
      url: 'https://linear.app/team/ENG-247'
    }),
    updateIssue: jest.fn().mockResolvedValue({ id: 'linear-issue-123', url: '...' }),
    addComment: jest.fn().mockResolvedValue({ id: 'comment-1' }),
    getIssue: jest.fn().mockResolvedValue({ id: 'linear-issue-123', title: 'Bug' }),
    ...overrides
  };
}
```

### Mock Notification Adapter

```javascript
function createMockNotifier(overrides = {}) {
  return {
    send: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' }),
    sendWithActions: jest.fn().mockResolvedValue({ id: 'msg-2', status: 'sent' }),
    ...overrides
  };
}
```

### Mock Storage

```javascript
function createMockStorage(overrides = {}) {
  const bugs = new Map();
  return {
    saveBug: jest.fn().mockImplementation(async (bug) => { bugs.set(bug.id, bug); return bug; }),
    updateBug: jest.fn().mockImplementation(async (id, updates) => {
      const bug = bugs.get(id);
      if (bug) Object.assign(bug, updates);
      return bug;
    }),
    getNextBugNumber: jest.fn().mockResolvedValue(1),
    _bugs: bugs,
    ...overrides
  };
}
```

### Mock Approval Manager

```javascript
function createMockApprovalManager(overrides = {}) {
  return {
    requestApproval: jest.fn().mockResolvedValue({ approval_id: 'ABC-1', status: 'pending' }),
    handleResponse: jest.fn().mockResolvedValue({ message: 'Done' }),
    ...overrides
  };
}
```

### Standard Test Failure Fixture

```javascript
function createTestFailure(overrides = {}) {
  return {
    test_id: 'sentinel-memory-001',
    test_name: 'Multi-session memory recall',
    scenario: 'establish-recall-3-facts',
    step: 'recall_check',
    error: new Error('Expected Marcus, got undefined'),
    evidence: {
      screenshots: ['evidence/screenshots/sentinel-001-step3.png'],
      console_logs: [
        { level: 'error', message: 'Memory retrieval returned empty', timestamp: '2026-02-12T10:00:00Z' }
      ],
      network_requests: [
        { url: '/api/search', method: 'POST', status: 200, failed: false },
        { url: '/api/generate', method: 'POST', status: 500, failed: true }
      ]
    },
    state: { url: 'https://brainstormy.app/story/abc/session/xyz' },
    timestamp: '2026-02-12T10:00:05Z',
    startedAt: '2026-02-12T09:59:00Z',
    ...overrides
  };
}
```

### Standard App Config Fixture

```javascript
function createTestApp(overrides = {}) {
  return {
    id: 'brainstormy',
    name: 'Brainstormy',
    url: 'https://brainstormy.app',
    integrations: {
      bug_tracker: { type: 'linear', team_id: 'team-123' },
      notifications: { type: 'whatsapp', recipients: ['+1234567890'] }
    },
    ...overrides
  };
}
```

### Mock Linear HTTP Client

```javascript
function createMockHttpClient(responses = {}) {
  return jest.fn().mockImplementation(async (url, options) => {
    const body = JSON.parse(options.body);
    const operationName = body.query.match(/(?:mutation|query)\s+(\w+)/)?.[1] || 'unknown';

    const defaultResponse = {
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
      text: async () => '{}'
    };

    const response = responses[operationName] || defaultResponse;
    return typeof response === 'function' ? response(url, options) : response;
  });
}
```

---

## Claude Code Implementation Steps

### Step 1: Create error classes
```
File: core/engine/errors.js
Copy the error classes exactly as specified above.
Run: No tests yet — these are dependencies.
```

### Step 2: Create adapter interfaces
```
Files:
  core/integrations/adapters/bug-tracker.js
  core/integrations/adapters/notification.js
  core/integrations/adapters/llm.js
Tests:
  tests/integrations/adapters/bug-tracker.test.js (~5 tests)
  tests/integrations/adapters/notification.test.js (~3 tests)
  tests/integrations/adapters/llm.test.js (~3 tests)
Verify: Each abstract method throws AdapterError with correct adapterType + operation.
```

### Step 3: Create Linear client
```
File: core/integrations/linear/client.js
Test: tests/integrations/linear/client.test.js (~40 tests)
Key: Use injectable httpClient for testing — never call real Linear API.
Verify: All GraphQL operations tested via mock httpClient.
```

### Step 4: Create Bug Detector
```
File: core/engine/bug-detector.js
Test: tests/engine/bug-detector.test.js (~120 tests)
Key: Use mock factories for all adapters. Test each method individually AND the full pipeline.
Verify: Pipeline handles all combinations: LLM success/failure × bugTracker present/absent × autoFixable true/false × approvalManager present/absent.
```

### Step 5: Verify no regressions
```
Run full test suite. Expected: ~764 (existing) + ~170 (new) = ~934 tests passing.
```

---

## Validation Criteria

**Days 1-2 are complete when:**
- [ ] `core/engine/errors.js` exists with EngineError, BugDetectorError, FixError, ApprovalError, AdapterError
- [ ] All three adapter interfaces exist and throw correctly
- [ ] `core/integrations/linear/client.js` implements BugTrackerAdapter with full GraphQL operations
- [ ] `core/engine/bug-detector.js` implements full detection pipeline
- [ ] ~170 new tests passing across 6 test files
- [ ] Total project tests: ~764 + ~170 = ~934 passing
- [ ] No regressions in existing test suites
- [ ] Bug Detector follows injectable dependency pattern (no direct imports of adapters)
- [ ] Pipeline degrades gracefully (LLM failure → still creates bug; tracker failure → bug tracked internally)
