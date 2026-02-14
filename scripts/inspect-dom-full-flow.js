'use strict';

/**
 * DOM inspection — complete flow: create project → explore session → chat
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
    // Auth
    console.log('Authenticating...');
    const users = JSON.parse((await clerkApiRequest('GET', `/v1/users?email_address[]=${encodeURIComponent('qa-automation@brainstormy.co')}`, null, clerkKey)).body);
    const userId = users[0].id;
    const tokenData = JSON.parse((await clerkApiRequest('POST', '/v1/sign_in_tokens', JSON.stringify({ user_id: userId, redirect_url: BASE_URL }), clerkKey)).body);
    await page.goto(`${BASE_URL}/sign-in#/__clerk_ticket=${tokenData.token}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);
    await page.goto(tokenData.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!page.url().startsWith(BASE_URL)) {
      try { await page.waitForURL(url => url.href.startsWith(BASE_URL), { timeout: 30000 }); } catch { await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); }
    }
    await page.waitForSelector('#root', { timeout: 60000 });
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
    await page.waitForTimeout(5000);
    await page.waitForSelector('.nav-vertical__add-btn', { timeout: 60000 });
    console.log('Ready. URL:', page.url());

    // Force-dismiss overlays via JS
    await page.evaluate(() => {
      document.querySelectorAll('[class*="engagement-modal"], [class*="overlay"][role="dialog"]').forEach(el => el.remove());
    });
    await page.waitForTimeout(1000);
    console.log('Overlays removed');

    // Current state
    console.log('URL:', page.url());
    const hasSession = /\/chat\/[0-9a-f-]{36}/.test(page.url());
    console.log('Already in session?', hasSession);

    if (hasSession) {
      // Explore existing session UI
      console.log('\n===== EXPLORING EXISTING SESSION =====');
      const sessionUI = await page.evaluate(() => {
        const result = {};
        // Textareas
        result.textareas = Array.from(document.querySelectorAll('textarea')).map(e => ({
          placeholder: e.placeholder,
          class: e.className?.substring(0, 80),
          visible: e.offsetParent !== null
        }));
        // Send button
        result.sendButtons = Array.from(document.querySelectorAll('button')).filter(e =>
          e.offsetParent !== null && (
            e.className?.includes('send') ||
            e.getAttribute('aria-label')?.toLowerCase().includes('send')
          )
        ).map(e => ({ class: e.className?.substring(0, 80), ariaLabel: e.getAttribute('aria-label'), text: e.textContent?.substring(0, 40).trim() }));
        // Message containers
        result.messageElements = Array.from(document.querySelectorAll('[class*="message" i]')).filter(e => e.offsetParent !== null).map(e => ({
          tag: e.tagName.toLowerCase(),
          class: e.className?.substring(0, 100),
          children: e.children.length,
          text: e.textContent?.substring(0, 60).trim()
        }));
        // Chat container
        const chatContainer = document.querySelector('[class*="chat-messages"], [class*="message-list"], [class*="messages-container"]');
        result.chatContainer = chatContainer ? { class: chatContainer.className, children: chatContainer.children.length } : null;
        return result;
      });
      console.log(JSON.stringify(sessionUI, null, 2));

      // Full HTML of main content area (not sidebar)
      const mainHtml = await page.evaluate(() => {
        const sidebar = document.querySelector('.brainstormy-sidebar');
        const root = document.querySelector('#root');
        if (!root) return 'NO ROOT';
        // Get all top-level divs that aren't the sidebar
        const mainParts = Array.from(root.children[0]?.children || []).filter(el => el !== sidebar && !el.className?.includes('sidebar'));
        return mainParts.map(el => `[${el.className?.substring(0, 60)}]\n${el.innerHTML?.substring(0, 2000)}`).join('\n===\n');
      });
      console.log('\nMain area HTML:');
      console.log(mainHtml?.substring(0, 4000));
    }

    // ===== CREATE NEW PROJECT =====
    console.log('\n===== CREATING PROJECT =====');
    await page.click('button.nav-vertical__add-btn[title="New Novel"]');
    await page.waitForSelector('.create-project-modal', { timeout: 10000 });
    console.log('Modal opened');

    await page.fill('.create-project-modal input[type="text"]', 'QA Flow Test 2');
    await page.waitForTimeout(300);
    await page.click('.create-project-modal__submit');
    await page.waitForTimeout(2000);

    // Skip navigator
    const skipBtn = await page.$('.create-project-modal__skip');
    if (skipBtn) {
      console.log('Clicking Skip...');
      await skipBtn.click();
    } else {
      // Maybe select General Editorial
      const generalBtn = await page.$('.navigator-card--general');
      if (generalBtn) {
        console.log('Clicking General Editorial...');
        await generalBtn.click();
      }
    }
    await page.waitForTimeout(8000);

    // Force-dismiss any new overlays
    await page.evaluate(() => {
      document.querySelectorAll('[class*="engagement-modal"], [class*="overlay"][role="dialog"]').forEach(el => el.remove());
    });
    await page.waitForTimeout(2000);

    console.log('\nPost-creation URL:', page.url());
    await page.screenshot({ path: 'evidence/brainstormy/flow-01-created.png', fullPage: true });

    // Dump complete state after project creation
    const postCreate = await page.evaluate(() => {
      const result = {};
      // URL
      result.url = window.location.href;
      // Sidebar
      result.sidebar = document.querySelector('.brainstormy-sidebar')?.innerHTML?.substring(0, 3000);
      // Visible inputs
      result.inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter(e => e.offsetParent !== null).map(e => ({
        tag: e.tagName.toLowerCase(), type: e.type, placeholder: e.placeholder, class: e.className?.substring(0, 80)
      }));
      // Visible buttons (non-sidebar)
      result.mainButtons = Array.from(document.querySelectorAll('button')).filter(e =>
        e.offsetParent !== null && !e.closest('.brainstormy-sidebar')
      ).map(e => ({ class: e.className?.substring(0, 80), text: e.textContent?.substring(0, 60).trim(), title: e.getAttribute('title') }));
      // Headings
      result.headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(e => e.offsetParent !== null).map(e => ({
        tag: e.tagName.toLowerCase(), text: e.textContent?.substring(0, 80).trim(), class: e.className?.substring(0, 60)
      }));
      // Main area structure
      const sidebar = document.querySelector('.brainstormy-sidebar');
      const appDiv = document.querySelector('#root > div, #root > main');
      if (appDiv) {
        const nonSidebar = Array.from(appDiv.children).filter(el => el !== sidebar && !el.className?.includes('sidebar'));
        result.mainAreaHtml = nonSidebar.map(el => el.outerHTML?.substring(0, 1500)).join('\n');
      }
      return result;
    });
    console.log('\nPost-creation state:');
    console.log('URL:', postCreate.url);
    console.log('Inputs:', JSON.stringify(postCreate.inputs, null, 2));
    console.log('Main buttons:', JSON.stringify(postCreate.mainButtons, null, 2));
    console.log('Headings:', JSON.stringify(postCreate.headings, null, 2));
    console.log('\nMain area HTML:');
    console.log(postCreate.mainAreaHtml?.substring(0, 3000));
    console.log('\nSidebar HTML (first 2000):');
    console.log(postCreate.sidebar?.substring(0, 2000));

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'evidence/brainstormy/flow-error.png' }).catch(() => {});
  }

  await browser.close();
})();
