'use strict';

const { loadAppConfig, listApps, loadAllApps, AppLoaderError } = require('../../core/app-loader');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('loadAppConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-apps-'));

    // Create a valid app
    const appDir = path.join(tmpDir, 'test-app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'app.config.json'),
      JSON.stringify({ id: 'test-app', name: 'Test App', type: 'generic' })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Group 1: Successful loading
  test('loads valid app config from directory', () => {
    const config = loadAppConfig(tmpDir, 'test-app');
    expect(config).toBeDefined();
    expect(config.id).toBe('test-app');
  });

  test('returns parsed JSON with all fields', () => {
    const config = loadAppConfig(tmpDir, 'test-app');
    expect(config.id).toBe('test-app');
    expect(config.name).toBe('Test App');
    expect(config.type).toBe('generic');
  });

  // Group 2: Validation errors
  test('throws AppLoaderError when config file not found', () => {
    expect(() => loadAppConfig(tmpDir, 'nonexistent')).toThrow(AppLoaderError);
  });

  test('throws AppLoaderError for invalid JSON', () => {
    const badDir = path.join(tmpDir, 'bad-json');
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, 'app.config.json'), '{not valid json!!!}');

    expect(() => loadAppConfig(tmpDir, 'bad-json')).toThrow(AppLoaderError);
  });

  test('throws AppLoaderError when id field missing', () => {
    const noIdDir = path.join(tmpDir, 'no-id');
    fs.mkdirSync(noIdDir);
    fs.writeFileSync(
      path.join(noIdDir, 'app.config.json'),
      JSON.stringify({ name: 'No ID', type: 'generic' })
    );

    expect(() => loadAppConfig(tmpDir, 'no-id')).toThrow(AppLoaderError);
  });

  test('throws AppLoaderError when id does not match directory name', () => {
    const mismatchDir = path.join(tmpDir, 'mismatch');
    fs.mkdirSync(mismatchDir);
    fs.writeFileSync(
      path.join(mismatchDir, 'app.config.json'),
      JSON.stringify({ id: 'wrong-id', name: 'Mismatch', type: 'generic' })
    );

    expect(() => loadAppConfig(tmpDir, 'mismatch')).toThrow(AppLoaderError);
  });
});

describe('listApps', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-apps-'));

    // Create a valid app
    const appDir = path.join(tmpDir, 'test-app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'app.config.json'),
      JSON.stringify({ id: 'test-app', name: 'Test App', type: 'generic' })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Group 3: Directory scanning
  test('returns array of app IDs from directory', () => {
    const apps = listApps(tmpDir);
    expect(apps).toEqual(['test-app']);
  });

  test('returns empty array when directory does not exist', () => {
    const apps = listApps('/nonexistent/path/that/does/not/exist');
    expect(apps).toEqual([]);
  });
});

describe('loadAllApps', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-apps-'));

    // Create a valid app
    const appDir = path.join(tmpDir, 'good-app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'app.config.json'),
      JSON.stringify({ id: 'good-app', name: 'Good App', type: 'generic' })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Group 4: Bulk loading
  test('loads all valid apps into a Map', () => {
    const apps = loadAllApps(tmpDir);
    expect(apps).toBeInstanceOf(Map);
    expect(apps.size).toBe(1);
    expect(apps.get('good-app').name).toBe('Good App');
  });

  test('skips invalid configs with warning (does not throw)', () => {
    // Create an invalid app alongside the valid one
    const badDir = path.join(tmpDir, 'bad-app');
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, 'app.config.json'), '{invalid json}');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const apps = loadAllApps(tmpDir);
    expect(apps.size).toBe(1); // Only good-app loaded
    expect(apps.has('good-app')).toBe(true);
    expect(apps.has('bad-app')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
