#!/usr/bin/env node

/**
 * Verify QA test account can authenticate against staging via Clerk Backend API.
 *
 * Uses Clerk's sign-in token endpoint to create a session without UI interaction,
 * bypassing factor-two verification that triggers on every fresh browser context.
 *
 * Flow:
 *   1. Look up user by email via Clerk Backend API
 *   2. Create a sign-in token for that user
 *   3. Navigate to app's sign-in page with ticket (establishes Clerk client)
 *   4. Navigate to sign-in token URL (Clerk processes ticket & redirects to app)
 *   5. Verify authenticated state on the app
 *
 * Requires: CLERK_SECRET_KEY environment variable
 */

require('dotenv').config();
const https = require('https');
const { chromium } = require('playwright');
const config = require('../apps/brainstormy/app.config.json');

const stagingUrl = config.baseUrl;
const connectorConfig = config.connector.config;
const email = connectorConfig.auth.credentials.email;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!clerkSecretKey) {
  console.error('✗ CLERK_SECRET_KEY not set in .env');
  console.error('  This key is required for Clerk Backend API session injection.');
  console.error('  Get it from the Clerk dashboard → API Keys → Secret keys');
  process.exit(1);
}

function clerkApiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.clerk.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Clerk API request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log(`Authenticating ${email} at ${stagingUrl}`);
  console.log('Using Clerk Backend API session injection\n');

  // Step 1: Look up user by email
  console.log('Step 1: Looking up Clerk user...');
  const usersResponse = await clerkApiRequest(
    'GET',
    `/v1/users?email_address[]=${encodeURIComponent(email)}`
  );

  if (!usersResponse.ok) {
    console.error(`✗ Clerk user lookup failed: HTTP ${usersResponse.status}`);
    console.error(`  Response: ${usersResponse.body}`);
    process.exit(1);
  }

  const users = JSON.parse(usersResponse.body);
  if (!Array.isArray(users) || users.length === 0) {
    console.error(`✗ No Clerk user found for email: ${email}`);
    process.exit(1);
  }

  const userId = users[0].id;
  console.log(`  Found user: ${userId}`);

  // Step 2: Create sign-in token
  console.log('Step 2: Creating sign-in token...');
  const tokenResponse = await clerkApiRequest(
    'POST',
    '/v1/sign_in_tokens',
    JSON.stringify({ user_id: userId, redirect_url: stagingUrl })
  );

  if (!tokenResponse.ok) {
    console.error(`✗ Sign-in token creation failed: HTTP ${tokenResponse.status}`);
    console.error(`  Response: ${tokenResponse.body}`);
    process.exit(1);
  }

  const tokenData = JSON.parse(tokenResponse.body);
  const signInUrl = tokenData.url;

  if (!signInUrl) {
    console.error('✗ Sign-in token response missing url field');
    console.error(`  Response: ${JSON.stringify(tokenData, null, 2)}`);
    process.exit(1);
  }
  console.log('  Token created');

  // Step 3: Open browser
  console.log('Step 3: Opening browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const fs = require('fs');
  fs.mkdirSync('evidence', { recursive: true });

  try {
    // Step 4: Navigate to app's sign-in with ticket hash to establish Clerk client
    console.log('Step 4: Initializing Clerk client via app redirect...');
    const appTicketUrl = `${stagingUrl}/sign-in#/__clerk_ticket=${tokenData.token}`;
    await page.goto(appTicketUrl, {
      waitUntil: 'domcontentloaded',
      timeout: connectorConfig.timeouts.navigation || 90000
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'evidence/debug-01-after-app-redirect.png' });
    console.log(`  URL: ${page.url()}`);

    // Step 5: Navigate to sign-in token URL (ticket consumed, redirects to app)
    console.log('Step 5: Navigating to sign-in token URL...');
    await page.goto(signInUrl, {
      waitUntil: 'domcontentloaded',
      timeout: connectorConfig.timeouts.navigation || 90000
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'evidence/debug-02-after-token.png' });
    console.log(`  URL: ${page.url()}`);

    // Step 6: Verify authenticated state
    console.log('Step 6: Verifying authenticated state...');

    let authenticated = false;
    const selectors = connectorConfig.selectors.userMenu.split(',').map(s => s.trim());
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        console.log(`  ✓ User menu found: ${sel}`);
        authenticated = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!authenticated) {
      const currentUrl = page.url();
      if (!currentUrl.includes('sign-in') && !currentUrl.includes('factor')) {
        console.log('  ✓ No longer on sign-in page — likely authenticated');
        authenticated = true;
      }
    }

    await page.screenshot({ path: 'evidence/debug-03-final-state.png' });

    if (authenticated) {
      console.log(`\n✓ Authentication verification PASSED`);
      console.log(`  Account: ${email}`);
      console.log(`  URL after login: ${page.url()}`);
      console.log('  Method: Clerk Backend API session injection');
    } else {
      console.error('\n✗ Authentication verification FAILED');
      console.error(`  URL: ${page.url()}`);
      console.error('  Check evidence/debug-*.png for screenshots');
      process.exit(1);
    }

  } catch (err) {
    console.error(`\n✗ Authentication verification FAILED: ${err.message}`);
    await page.screenshot({ path: 'evidence/debug-error.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
