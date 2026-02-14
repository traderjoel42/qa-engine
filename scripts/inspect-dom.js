'use strict';

/**
 * DOM inspection script for Task 6 selector calibration.
 * Replicates Clerk Backend API auth from BrainstormyConnector,
 * then dumps sidebar/DOM structure for selector discovery.
 */
const https = require('https');
const { chromium } = require('playwright');

const BASE_URL = 'https://brainstormy-frontend-staging.onrender.com';

function clerkApiRequest(method, path, body, secretKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.clerk.com', path, method,
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (!clerkKey) { console.error('CLERK_SECRET_KEY not set'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Auth via Clerk Backend API (same as BrainstormyConnector)
    console.log('Authenticating...');
    const users = JSON.parse((await clerkApiRequest('GET', `/v1/users?email_address[]=${encodeURIComponent('qa-automation@brainstormy.co')}`, null, clerkKey)).body);
    const userId = users[0].id;
    const tokenData = JSON.parse((await clerkApiRequest('POST', '/v1/sign_in_tokens', JSON.stringify({ user_id: userId, redirect_url: BASE_URL }), clerkKey)).body);
    const appTicketUrl = `${BASE_URL}/sign-in#/__clerk_ticket=${tokenData.token}`;
    await page.goto(appTicketUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);
    await page.goto(tokenData.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!page.url().startsWith(BASE_URL)) {
      try { await page.waitForURL(url => url.href.startsWith(BASE_URL), { timeout: 30000 }); } catch { await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
    }
    console.log('Authenticated. URL:', page.url());

    // Wait for app render
    await page.waitForSelector('#root', { timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log('\n=== SIDEBAR STRUCTURE ===');
    const sidebarHTML = await page.evaluate(() => {
      // Find sidebar - try common patterns
      const sidebar = document.querySelector('aside, nav, [class*="sidebar" i], [class*="Sidebar"], [class*="nav-vertical"]');
      if (sidebar) return sidebar.outerHTML.substring(0, 10000);
      // Fallback: dump all elements in first 220px width
      return document.querySelector('body').innerHTML.substring(0, 5000);
    });
    console.log(sidebarHTML);

    console.log('\n=== ALL DATA-TESTID ATTRIBUTES ===');
    const testIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid]')).map(e =>
        `<${e.tagName.toLowerCase()}> data-testid="${e.getAttribute('data-testid')}" text="${e.textContent?.substring(0, 40).trim()}"`
      )
    );
    testIds.forEach(t => console.log(t));

    console.log('\n=== ALL BUTTONS ===');
    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role="button"]')).map(e =>
        `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 80)}" text="${e.textContent?.substring(0, 40).trim()}" aria="${e.getAttribute('aria-label') || ''}"`
      )
    );
    buttons.forEach(b => console.log(b));

    console.log('\n=== ALL LINKS ===');
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map(e =>
        `<a> href="${e.getAttribute('href')}" class="${e.className?.substring(0, 60)}" text="${e.textContent?.substring(0, 40).trim()}"`
      )
    );
    links.forEach(l => console.log(l));

    console.log('\n=== HEADINGS ===');
    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(e =>
        `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 60)}" text="${e.textContent?.substring(0, 60).trim()}"`
      )
    );
    headings.forEach(h => console.log(h));

    console.log('\n=== SECTION HEADERS WITH + BUTTONS ===');
    const sections = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="section"], [class*="Section"], [class*="category"], [class*="Category"], [class*="vertical"], [class*="Vertical"]')).map(e =>
        `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 80)}" text="${e.textContent?.substring(0, 60).trim()}"`
      )
    );
    sections.forEach(s => console.log(s));

    // Screenshot
    await page.screenshot({ path: 'evidence/brainstormy/dom-inspection.png', fullPage: true });
    console.log('\nScreenshot saved to evidence/brainstormy/dom-inspection.png');

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'evidence/brainstormy/dom-inspection-error.png' }).catch(() => {});
  }

  await browser.close();
})();
