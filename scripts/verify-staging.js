#!/usr/bin/env node

/**
 * Verify staging environment is reachable.
 * Handles Render cold-start with generous timeout.
 */

const https = require('https');
const config = require('../apps/brainstormy/app.config.json');

const url = config.baseUrl || config.environments?.staging?.baseUrl;
const timeout = config.connector?.config?.timeouts?.warmUp || 120000;

console.log(`Checking staging at: ${url}`);
console.log(`Timeout: ${timeout / 1000}s (cold start may take 30-60s)`);
console.log('Waiting...');

const startTime = Date.now();

const req = https.get(url, { timeout }, (res) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\u2705 Staging is reachable`);
  console.log(`   Status: ${res.statusCode}`);
  console.log(`   Response time: ${elapsed}s`);

  if (res.statusCode !== 200) {
    console.log(`\u26a0\ufe0f  Non-200 status \u2014 staging may be partially up`);
    process.exit(1);
  }

  process.exit(0);
});

req.on('timeout', () => {
  console.log(`\u274c Staging did not respond within ${timeout / 1000}s`);
  console.log('   Check Render dashboard for service status');
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  console.log(`\u274c Cannot reach staging: ${err.message}`);
  process.exit(1);
});
