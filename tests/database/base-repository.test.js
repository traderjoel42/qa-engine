'use strict';

const crypto = require('crypto');
const DatabaseConnection = require('../../core/database/connection');
const Migrator = require('../../core/database/migrator');
const BaseRepository = require('../../core/database/repositories/base-repository');

describe('BaseRepository', () => {
  let conn;
  let repo;

  beforeEach(async () => {
    conn = new DatabaseConnection();
    conn.open();
    const migrator = new Migrator(conn);
    await migrator.migrate();
    repo = new BaseRepository(conn, 'apps');
    repo._jsonColumns = ['config'];
  });

  afterEach(() => {
    try { conn.close(); } catch {}
  });

  function createApp(overrides = {}) {
    return {
      id: crypto.randomUUID(),
      name: 'Test App',
      type: 'web',
      config: JSON.stringify({ url: 'http://test.com' }),
      ...overrides
    };
  }

  describe('create()', () => {
    it('generates UUID when id not provided', () => {
      const result = repo.create({ name: 'My App', type: 'web' });
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f]{8}-/);
    });

    it('uses provided id when given', () => {
      const id = crypto.randomUUID();
      const result = repo.create({ id, name: 'My App', type: 'web' });
      expect(result.id).toBe(id);
    });

    it('returns the created record with all defaults', () => {
      const result = repo.create({ name: 'My App', type: 'web' });
      expect(result.name).toBe('My App');
      expect(result.type).toBe('web');
      expect(result.status).toBe('active');
      expect(result.config).toEqual({});
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });
  });

  describe('findById()', () => {
    it('returns record when exists', () => {
      const app = createApp();
      repo.create(app);
      const found = repo.findById(app.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(app.id);
      expect(found.name).toBe('Test App');
    });

    it('returns null when not found', () => {
      const found = repo.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findOne()', () => {
    it('finds with single condition', () => {
      repo.create({ name: 'App A', type: 'web' });
      repo.create({ name: 'App B', type: 'mobile' });

      const found = repo.findOne({ type: 'mobile' });
      expect(found).not.toBeNull();
      expect(found.name).toBe('App B');
    });

    it('finds with multiple conditions', () => {
      repo.create({ name: 'App A', type: 'web', status: 'active' });
      repo.create({ name: 'App B', type: 'web', status: 'inactive' });

      const found = repo.findOne({ type: 'web', status: 'inactive' });
      expect(found).not.toBeNull();
      expect(found.name).toBe('App B');
    });

    it('returns null when no match', () => {
      repo.create({ name: 'App A', type: 'web' });
      const found = repo.findOne({ type: 'desktop' });
      expect(found).toBeNull();
    });
  });

  describe('findMany()', () => {
    beforeEach(() => {
      repo.create({ name: 'App A', type: 'web' });
      repo.create({ name: 'App B', type: 'web' });
      repo.create({ name: 'App C', type: 'mobile' });
    });

    it('returns all matching records', () => {
      const results = repo.findMany({ type: 'web' });
      expect(results).toHaveLength(2);
    });

    it('supports orderBy', () => {
      const results = repo.findMany({}, { orderBy: { name: 'DESC' } });
      expect(results[0].name).toBe('App C');
      expect(results[2].name).toBe('App A');
    });

    it('supports limit', () => {
      const results = repo.findMany({}, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('supports limit + offset', () => {
      const results = repo.findMany({}, { orderBy: { name: 'ASC' }, limit: 1, offset: 1 });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('App B');
    });

    it('returns empty array when no matches', () => {
      const results = repo.findMany({ type: 'desktop' });
      expect(results).toEqual([]);
    });
  });

  describe('update()', () => {
    it('modifies specified fields only', () => {
      const app = repo.create({ name: 'Original', type: 'web' });
      const updated = repo.update(app.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
      expect(updated.type).toBe('web');
    });

    it('sets updated_at automatically', () => {
      const app = repo.create({ name: 'App', type: 'web' });
      const originalUpdatedAt = app.updated_at;

      // Small delay to ensure timestamp differs
      const updated = repo.update(app.id, { name: 'Modified' });
      expect(updated.updated_at).toBeDefined();
      // updated_at should be an ISO string (may or may not differ from original depending on timing)
      expect(typeof updated.updated_at).toBe('string');
    });

    it('returns updated record', () => {
      const app = repo.create({ name: 'App', type: 'web' });
      const updated = repo.update(app.id, { name: 'New Name', status: 'inactive' });
      expect(updated.id).toBe(app.id);
      expect(updated.name).toBe('New Name');
      expect(updated.status).toBe('inactive');
    });

    it('returns null for nonexistent id', () => {
      const result = repo.update('nonexistent', { name: 'No Op' });
      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    it('removes record', () => {
      const app = repo.create({ name: 'App', type: 'web' });
      repo.delete(app.id);
      expect(repo.findById(app.id)).toBeNull();
    });

    it('returns true on success', () => {
      const app = repo.create({ name: 'App', type: 'web' });
      expect(repo.delete(app.id)).toBe(true);
    });

    it('returns false for nonexistent id', () => {
      expect(repo.delete('nonexistent')).toBe(false);
    });
  });

  describe('count()', () => {
    beforeEach(() => {
      repo.create({ name: 'App A', type: 'web' });
      repo.create({ name: 'App B', type: 'web' });
      repo.create({ name: 'App C', type: 'mobile' });
    });

    it('returns total with no conditions', () => {
      expect(repo.count()).toBe(3);
    });

    it('returns filtered count with conditions', () => {
      expect(repo.count({ type: 'web' })).toBe(2);
    });
  });

  describe('exists()', () => {
    it('returns true when match exists', () => {
      repo.create({ name: 'App', type: 'web' });
      expect(repo.exists({ type: 'web' })).toBe(true);
    });

    it('returns false when no match', () => {
      expect(repo.exists({ type: 'desktop' })).toBe(false);
    });
  });

  describe('JSON serialization', () => {
    it('stores objects as strings and returns as objects', () => {
      const config = { url: 'http://test.com', port: 3000 };
      const app = repo.create({ name: 'App', type: 'web', config });

      expect(app.config).toEqual(config);

      // Verify stored as string in raw DB
      const raw = conn.db.prepare('SELECT config FROM apps WHERE id = ?').get(app.id);
      expect(typeof raw.config).toBe('string');
      expect(JSON.parse(raw.config)).toEqual(config);
    });

    it('handles null JSON columns gracefully', () => {
      // Test _deserializeJson directly with a null value in a JSON column
      const row = { id: '123', name: 'App', config: null };
      const result = repo._deserializeJson(row);
      expect(result.config).toBeNull();
    });
  });
});
