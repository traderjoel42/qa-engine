'use strict';

const fs = require('fs');
const path = require('path');

class AppLoaderError extends Error {
  constructor(message, appId = null) {
    super(message);
    this.name = 'AppLoaderError';
    this.appId = appId;
  }
}

/**
 * Load a single app configuration from its directory.
 *
 * @param {string} appsDir - Base apps directory path
 * @param {string} appId - App identifier (directory name)
 * @returns {object} Parsed app configuration
 * @throws {AppLoaderError} If config file missing or invalid JSON
 */
function loadAppConfig(appsDir, appId) {
  const configPath = path.join(appsDir, appId, 'app.config.json');

  if (!fs.existsSync(configPath)) {
    throw new AppLoaderError(
      `App config not found: ${configPath}`,
      appId
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new AppLoaderError(
      `Failed to read app config: ${err.message}`,
      appId
    );
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new AppLoaderError(
      `Invalid JSON in app config ${configPath}: ${err.message}`,
      appId
    );
  }

  // Validate required fields
  if (!config.id) {
    throw new AppLoaderError('App config missing required field: id', appId);
  }
  if (!config.name) {
    throw new AppLoaderError('App config missing required field: name', appId);
  }
  if (!config.type) {
    throw new AppLoaderError('App config missing required field: type', appId);
  }

  // Ensure id matches directory name
  if (config.id !== appId) {
    throw new AppLoaderError(
      `App config id "${config.id}" does not match directory name "${appId}"`,
      appId
    );
  }

  return config;
}

/**
 * List all available apps by scanning the apps directory.
 *
 * @param {string} appsDir - Base apps directory path
 * @returns {string[]} Array of app IDs (directory names that contain app.config.json)
 */
function listApps(appsDir) {
  if (!fs.existsSync(appsDir)) {
    return [];
  }

  const entries = fs.readdirSync(appsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => {
      const configPath = path.join(appsDir, entry.name, 'app.config.json');
      return fs.existsSync(configPath);
    })
    .map(entry => entry.name);
}

/**
 * Load all app configurations from the apps directory.
 *
 * @param {string} appsDir - Base apps directory path
 * @returns {Map<string, object>} Map of appId → config
 */
function loadAllApps(appsDir) {
  const appIds = listApps(appsDir);
  const apps = new Map();

  for (const appId of appIds) {
    try {
      apps.set(appId, loadAppConfig(appsDir, appId));
    } catch (err) {
      // Log but don't fail — one bad config shouldn't prevent loading others
      console.warn(`Warning: Skipping app "${appId}": ${err.message}`);
    }
  }

  return apps;
}

module.exports = { loadAppConfig, listApps, loadAllApps, AppLoaderError };
