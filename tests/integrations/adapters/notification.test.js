'use strict';

const NotificationAdapter = require('../../../core/integrations/adapters/notification');
const { AdapterError } = require('../../../core/engine/errors');

describe('NotificationAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new NotificationAdapter();
  });

  it('send() throws AdapterError with correct adapterType and operation', async () => {
    try {
      await adapter.send('+1234567890', 'hello');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('notification');
      expect(err.operation).toBe('send');
    }
  });

  it('sendWithActions() throws AdapterError with correct adapterType and operation', async () => {
    try {
      await adapter.sendWithActions('+1234567890', 'approve?', [{ id: 'yes', label: 'Yes' }]);
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err.adapterType).toBe('notification');
      expect(err.operation).toBe('sendWithActions');
    }
  });

  it('send() rejects (not just throws)', async () => {
    await expect(adapter.send('r', 'msg')).rejects.toThrow(AdapterError);
  });
});
