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
