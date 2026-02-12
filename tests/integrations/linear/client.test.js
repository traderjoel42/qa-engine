'use strict';

const LinearClient = require('../../../core/integrations/linear/client');
const BugTrackerAdapter = require('../../../core/integrations/adapters/bug-tracker');
const { AdapterError } = require('../../../core/engine/errors');

// ── Mock HTTP Client ──────────────────────────────────────────────

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

function createSuccessClient(httpResponses = {}, configOverrides = {}) {
  const httpClient = createMockHttpClient(httpResponses);
  const client = new LinearClient({
    apiKey: 'lin_api_test',
    teamId: 'team-123',
    httpClient,
    ...configOverrides
  });
  return { client, httpClient };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('LinearClient', () => {

  // ── Group 1: Constructor ──

  describe('Constructor', () => {
    it('requires apiKey — throws AdapterError', () => {
      expect(() => new LinearClient({ teamId: 'team-1' }))
        .toThrow(AdapterError);
    });

    it('requires teamId — throws AdapterError', () => {
      expect(() => new LinearClient({ apiKey: 'key' }))
        .toThrow(AdapterError);
    });

    it('accepts optional projectId, defaultLabels, baseUrl, httpClient', () => {
      const client = new LinearClient({
        apiKey: 'key',
        teamId: 'team-1',
        projectId: 'proj-1',
        defaultLabels: ['qa'],
        baseUrl: 'https://custom.api',
        httpClient: jest.fn()
      });
      expect(client).toBeInstanceOf(LinearClient);
      expect(client).toBeInstanceOf(BugTrackerAdapter);
    });

    it('default baseUrl is https://api.linear.app', () => {
      const client = new LinearClient({ apiKey: 'key', teamId: 'team-1' });
      expect(client._baseUrl).toBe('https://api.linear.app');
    });
  });

  // ── Group 2: createIssue() ──

  describe('createIssue()', () => {
    it('sends correct GraphQL mutation', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/ENG-1', title: 'Test' }
              }
            }
          }),
          text: async () => ''
        }
      });

      const result = await client.createIssue({ title: 'Bug', priority: 'high', labels: [] });
      expect(result).toEqual({ id: 'issue-1', key: 'ENG-1', url: 'https://linear.app/ENG-1' });

      // Verify the IssueCreate call
      const calls = httpClient.mock.calls;
      const issueCreateCall = calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueCreate');
      });
      expect(issueCreateCall).toBeTruthy();
    });

    it('maps priority strings to Linear numbers', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'i1', identifier: 'ENG-1', url: 'url', title: 't' }
              }
            }
          }),
          text: async () => ''
        }
      });

      await client.createIssue({ title: 'Bug', priority: 'urgent', labels: [] });

      const issueCreateCall = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueCreate');
      });
      const body = JSON.parse(issueCreateCall[1].body);
      expect(body.variables.input.priority).toBe(1); // urgent = 1
    });

    it('includes defaultLabels + bug.labels', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({
            data: { team: { labels: { nodes: [
              { id: 'lbl-1', name: 'qa' },
              { id: 'lbl-2', name: 'bug' }
            ] } } }
          }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'i1', identifier: 'E-1', url: 'u', title: 't' }
              }
            }
          }),
          text: async () => ''
        }
      }, { defaultLabels: ['qa'] });

      await client.createIssue({ title: 'Bug', labels: ['bug'] });

      const issueCreateCall = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueCreate');
      });
      const body = JSON.parse(issueCreateCall[1].body);
      expect(body.variables.input.labelIds).toEqual(['lbl-1', 'lbl-2']);
    });

    it('includes projectId when configured', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'i1', identifier: 'E-1', url: 'u', title: 't' }
              }
            }
          }),
          text: async () => ''
        }
      }, { projectId: 'proj-99' });

      await client.createIssue({ title: 'Bug', labels: [] });

      const issueCreateCall = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueCreate');
      });
      const body = JSON.parse(issueCreateCall[1].body);
      expect(body.variables.input.projectId).toBe('proj-99');
    });

    it('throws on missing bug.title', async () => {
      const { client } = createSuccessClient();
      await expect(client.createIssue({})).rejects.toThrow(AdapterError);
      await expect(client.createIssue(null)).rejects.toThrow(AdapterError);
    });

    it('throws on API failure (non-200)', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: false, status: 500,
          json: async () => ({}),
          text: async () => 'Internal Server Error'
        }
      });

      await expect(client.createIssue({ title: 'Bug', labels: [] })).rejects.toThrow(AdapterError);
    });

    it('throws on GraphQL errors', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({ errors: [{ message: 'Bad request' }] }),
          text: async () => ''
        }
      });

      await expect(client.createIssue({ title: 'Bug', labels: [] })).rejects.toThrow(AdapterError);
    });

    it('throws on issueCreate.success=false', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueCreate: { success: false, issue: null } }
          }),
          text: async () => ''
        }
      });

      await expect(client.createIssue({ title: 'Bug', labels: [] })).rejects.toThrow(AdapterError);
    });

    it('returns {id, key, url}', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({ data: { team: { labels: { nodes: [] } } } }),
          text: async () => ''
        },
        IssueCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'abc', identifier: 'ENG-247', url: 'https://linear.app/ENG-247', title: 'Bug' }
              }
            }
          }),
          text: async () => ''
        }
      });

      const result = await client.createIssue({ title: 'Bug', labels: [] });
      expect(result).toHaveProperty('id', 'abc');
      expect(result).toHaveProperty('key', 'ENG-247');
      expect(result).toHaveProperty('url', 'https://linear.app/ENG-247');
    });
  });

  // ── Group 3: updateIssue() ──

  describe('updateIssue()', () => {
    it('sends correct GraphQL mutation with id', async () => {
      const { client, httpClient } = createSuccessClient({
        IssueUpdate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueUpdate: { success: true, issue: { id: 'i1', identifier: 'E-1', url: 'u' } } }
          }),
          text: async () => ''
        }
      });

      await client.updateIssue('i1', { title: 'Updated' });

      const call = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueUpdate');
      });
      const body = JSON.parse(call[1].body);
      expect(body.variables.id).toBe('i1');
      expect(body.variables.input.title).toBe('Updated');
    });

    it('maps update fields correctly', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamStates: {
          ok: true, status: 200,
          json: async () => ({
            data: { team: { states: { nodes: [{ id: 'state-done', name: 'Done' }] } } }
          }),
          text: async () => ''
        },
        IssueUpdate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueUpdate: { success: true, issue: { id: 'i1', identifier: 'E-1', url: 'u' } } }
          }),
          text: async () => ''
        }
      });

      await client.updateIssue('i1', { priority: 'urgent', status: 'Done' });

      const updateCall = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('IssueUpdate');
      });
      const body = JSON.parse(updateCall[1].body);
      expect(body.variables.input.priority).toBe(1);
      expect(body.variables.input.stateId).toBe('state-done');
    });

    it('throws on missing id', async () => {
      const { client } = createSuccessClient();
      await expect(client.updateIssue(null, {})).rejects.toThrow(AdapterError);
      await expect(client.updateIssue('', {})).rejects.toThrow(AdapterError);
    });

    it('throws on API failure', async () => {
      const { client } = createSuccessClient({
        IssueUpdate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueUpdate: { success: false } }
          }),
          text: async () => ''
        }
      });

      await expect(client.updateIssue('i1', { title: 'x' })).rejects.toThrow(AdapterError);
    });

    it('returns {id, url}', async () => {
      const { client } = createSuccessClient({
        IssueUpdate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueUpdate: { success: true, issue: { id: 'i1', identifier: 'E-1', url: 'https://u' } } }
          }),
          text: async () => ''
        }
      });

      const result = await client.updateIssue('i1', { title: 'x' });
      expect(result).toEqual({ id: 'i1', url: 'https://u' });
    });
  });

  // ── Group 4: addComment() ──

  describe('addComment()', () => {
    it('sends correct mutation', async () => {
      const { client, httpClient } = createSuccessClient({
        CommentCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { commentCreate: { success: true, comment: { id: 'c-1' } } }
          }),
          text: async () => ''
        }
      });

      await client.addComment('i1', 'This is a comment');

      const call = httpClient.mock.calls.find(c => {
        const body = JSON.parse(c[1].body);
        return body.query.includes('CommentCreate');
      });
      const body = JSON.parse(call[1].body);
      expect(body.variables.input.issueId).toBe('i1');
      expect(body.variables.input.body).toBe('This is a comment');
    });

    it('throws on missing id', async () => {
      const { client } = createSuccessClient();
      await expect(client.addComment(null, 'comment')).rejects.toThrow(AdapterError);
    });

    it('throws on missing comment', async () => {
      const { client } = createSuccessClient();
      await expect(client.addComment('i1', '')).rejects.toThrow(AdapterError);
      await expect(client.addComment('i1', null)).rejects.toThrow(AdapterError);
    });

    it('returns comment ID', async () => {
      const { client } = createSuccessClient({
        CommentCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { commentCreate: { success: true, comment: { id: 'c-42' } } }
          }),
          text: async () => ''
        }
      });

      const result = await client.addComment('i1', 'text');
      expect(result).toEqual({ id: 'c-42' });
    });

    it('throws when commentCreate.success is false', async () => {
      const { client } = createSuccessClient({
        CommentCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { commentCreate: { success: false } }
          }),
          text: async () => ''
        }
      });

      await expect(client.addComment('i1', 'text')).rejects.toThrow(AdapterError);
    });
  });

  // ── Group 5: getIssue() ──

  describe('getIssue()', () => {
    it('sends correct query with id', async () => {
      const { client, httpClient } = createSuccessClient({
        Issue: {
          ok: true, status: 200,
          json: async () => ({
            data: { issue: { id: 'i1', identifier: 'E-1', title: 'Bug', description: 'desc', url: 'u', priority: 2, state: { name: 'Open' }, labels: { nodes: [] }, createdAt: '2026-01-01', updatedAt: '2026-01-01' } }
          }),
          text: async () => ''
        }
      });

      await client.getIssue('i1');

      const call = httpClient.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.variables.id).toBe('i1');
      expect(body.query).toContain('issue(id: $id)');
    });

    it('returns full issue data', async () => {
      const issueData = {
        id: 'i1', identifier: 'E-1', title: 'Bug', description: 'desc',
        url: 'u', priority: 2, state: { name: 'Open' },
        labels: { nodes: [{ name: 'qa' }] },
        createdAt: '2026-01-01', updatedAt: '2026-01-01'
      };

      const { client } = createSuccessClient({
        Issue: {
          ok: true, status: 200,
          json: async () => ({ data: { issue: issueData } }),
          text: async () => ''
        }
      });

      const result = await client.getIssue('i1');
      expect(result).toEqual(issueData);
    });

    it('throws on missing id', async () => {
      const { client } = createSuccessClient();
      await expect(client.getIssue(null)).rejects.toThrow(AdapterError);
      await expect(client.getIssue('')).rejects.toThrow(AdapterError);
    });

    it('throws on not found', async () => {
      const { client } = createSuccessClient({
        Issue: {
          ok: true, status: 200,
          json: async () => ({ data: { issue: null } }),
          text: async () => ''
        }
      });

      await expect(client.getIssue('nonexistent')).rejects.toThrow(AdapterError);
    });
  });

  // ── Group 6: _graphql() Internal ──

  describe('_graphql() Internal', () => {
    it('sends correct headers (Content-Type, Authorization)', async () => {
      const { client, httpClient } = createSuccessClient({
        TestQuery: {
          ok: true, status: 200,
          json: async () => ({ data: { test: true } }),
          text: async () => ''
        }
      });

      await client._graphql('query TestQuery { test }');

      const call = httpClient.mock.calls[0];
      expect(call[0]).toBe('https://api.linear.app/graphql');
      expect(call[1].headers['Content-Type']).toBe('application/json');
      expect(call[1].headers['Authorization']).toBe('lin_api_test');
    });

    it('handles network errors (fetch throws)', async () => {
      const httpClient = jest.fn().mockRejectedValue(new Error('Network failure'));
      const client = new LinearClient({ apiKey: 'key', teamId: 'team-1', httpClient });

      await expect(client._graphql('query Q { x }')).rejects.toThrow(AdapterError);
      await expect(client._graphql('query Q { x }')).rejects.toThrow(/Network failure/);
    });

    it('handles non-200 responses', async () => {
      const { client } = createSuccessClient({
        unknown: {
          ok: false, status: 401,
          json: async () => ({}),
          text: async () => 'Unauthorized'
        }
      });

      // Use a query that won't match any named response
      const httpClient = jest.fn().mockResolvedValue({
        ok: false, status: 401,
        json: async () => ({}),
        text: async () => 'Unauthorized'
      });
      const c = new LinearClient({ apiKey: 'k', teamId: 't', httpClient });
      await expect(c._graphql('query X { x }')).rejects.toThrow(/401/);
    });

    it('handles GraphQL error array', async () => {
      const httpClient = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ errors: [{ message: 'Field error' }, { message: 'Auth error' }] }),
        text: async () => ''
      });
      const client = new LinearClient({ apiKey: 'k', teamId: 't', httpClient });

      await expect(client._graphql('query X { x }')).rejects.toThrow(/Field error/);
      await expect(client._graphql('query X { x }')).rejects.toThrow(AdapterError);
    });

    it('uses custom baseUrl', async () => {
      const httpClient = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ data: {} }),
        text: async () => ''
      });
      const client = new LinearClient({ apiKey: 'k', teamId: 't', httpClient, baseUrl: 'https://custom.api' });

      await client._graphql('query X { x }');
      expect(httpClient.mock.calls[0][0]).toBe('https://custom.api/graphql');
    });
  });

  // ── Group 7: _resolveLabels() ──

  describe('_resolveLabels()', () => {
    it('returns IDs for existing labels', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({
            data: { team: { labels: { nodes: [
              { id: 'lbl-1', name: 'qa' },
              { id: 'lbl-2', name: 'bug' }
            ] } } }
          }),
          text: async () => ''
        }
      });

      const ids = await client._resolveLabels(['qa', 'bug']);
      expect(ids).toEqual(['lbl-1', 'lbl-2']);
    });

    it('creates missing labels', async () => {
      const { client, httpClient } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({
            data: { team: { labels: { nodes: [{ id: 'lbl-1', name: 'qa' }] } } }
          }),
          text: async () => ''
        },
        LabelCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueLabelCreate: { success: true, issueLabel: { id: 'lbl-new' } } }
          }),
          text: async () => ''
        }
      });

      const ids = await client._resolveLabels(['qa', 'new-label']);
      expect(ids).toEqual(['lbl-1', 'lbl-new']);
    });

    it('empty array returns empty', async () => {
      const { client } = createSuccessClient();
      const ids = await client._resolveLabels([]);
      expect(ids).toEqual([]);
    });

    it('handles create failure gracefully (skips label)', async () => {
      const { client } = createSuccessClient({
        TeamLabels: {
          ok: true, status: 200,
          json: async () => ({
            data: { team: { labels: { nodes: [] } } }
          }),
          text: async () => ''
        },
        LabelCreate: {
          ok: true, status: 200,
          json: async () => ({
            data: { issueLabelCreate: { success: false } }
          }),
          text: async () => ''
        }
      });

      const ids = await client._resolveLabels(['failing-label']);
      expect(ids).toEqual([]); // label creation failed, so no ID added
    });
  });
});
