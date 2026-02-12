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
