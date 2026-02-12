'use strict';

const BugTrackerAdapter = require('../../../core/integrations/adapters/bug-tracker');
const { AdapterError } = require('../../../core/engine/errors');

describe('BugTrackerAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new BugTrackerAdapter();
  });

  it('createIssue() throws AdapterError', async () => {
    await expect(adapter.createIssue({})).rejects.toThrow(AdapterError);
  });

  it('createIssue() throws with adapterType bug_tracker', async () => {
    try {
      await adapter.createIssue({});
    } catch (err) {
      expect(err.adapterType).toBe('bug_tracker');
      expect(err.operation).toBe('createIssue');
    }
  });

  it('updateIssue() throws AdapterError with correct operation', async () => {
    try {
      await adapter.updateIssue('id-1', {});
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('bug_tracker');
      expect(err.operation).toBe('updateIssue');
    }
  });

  it('addComment() throws AdapterError with correct operation', async () => {
    try {
      await adapter.addComment('id-1', 'comment');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('bug_tracker');
      expect(err.operation).toBe('addComment');
    }
  });

  it('getIssue() throws AdapterError with correct operation', async () => {
    try {
      await adapter.getIssue('id-1');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('bug_tracker');
      expect(err.operation).toBe('getIssue');
    }
  });
});
