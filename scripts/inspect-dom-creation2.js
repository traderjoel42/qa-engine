'use strict';

/**
 * DOM inspection script — completes project creation and explores story/session flow.
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

async function dumpState(page, label) {
  console.log(`\n=== ${label} ===`);
  console.log('URL:', page.url());

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter(e => e.offsetParent !== null).map(e =>
      `<${e.tagName.toLowerCase()}> type="${e.type}" name="${e.name}" placeholder="${e.placeholder}" class="${e.className?.substring(0, 80)}" value="${e.value?.substring(0, 40)}"`
    )
  );
  if (inputs.length) { console.log('INPUTS:'); inputs.forEach(i => console.log('  ', i)); }

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]')).filter(e => e.offsetParent !== null).map(e =>
      `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 80)}" text="${e.textContent?.substring(0, 60).trim()}" disabled=${e.disabled}`
    )
  );
  if (buttons.length) { console.log('BUTTONS:'); buttons.forEach(b => console.log('  ', b)); }

  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1, h2, h3, h4')).filter(e => e.offsetParent !== null).map(e =>
      `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 60)}" text="${e.textContent?.substring(0, 80).trim()}"`
    )
  );
  if (headings.length) { console.log('HEADINGS:'); headings.forEach(h => console.log('  ', h)); }
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
    console.log('Auth redirect complete. URL:', page.url());

    // Wait for full load
    await page.waitForSelector('#root', { timeout: 60000 });
    console.log('#root found');
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch { console.log('networkidle timeout, proceeding...'); }
    await page.waitForTimeout(5000);
    console.log('Page URL after settle:', page.url());

    // Wait for sidebar specifically
    try {
      await page.waitForSelector('.nav-vertical__add-btn', { timeout: 60000 });
      console.log('Sidebar buttons found');
    } catch {
      console.log('Sidebar buttons NOT found after 60s');
      await page.screenshot({ path: 'evidence/brainstormy/creation2-no-sidebar.png', fullPage: true });
      // Dump page content to see what loaded
      const html = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 3000));
      console.log('ROOT HTML:', html);
      throw new Error('Sidebar not loaded');
    }

    // STEP 1: Click "New Novel"
    console.log('\n--- Creating a project ---');
    await page.click('button.nav-vertical__add-btn[title="New Novel"]');
    await page.waitForSelector('.create-project-modal', { timeout: 10000 });
    console.log('Modal opened');

    // STEP 2: Fill project name
    await page.fill('.create-project-modal input[type="text"]', 'QA Inspect Test');
    await page.waitForTimeout(500);

    const nextDisabled = await page.$eval('.create-project-modal__submit', el => el.disabled);
    console.log('Next button disabled after fill?', nextDisabled);

    await page.screenshot({ path: 'evidence/brainstormy/creation2-step2-filled.png', fullPage: true });

    // STEP 3: Click Next
    console.log('\n--- Clicking Next ---');
    await page.click('.create-project-modal__submit');
    await page.waitForTimeout(5000);

    await dumpState(page, 'AFTER CLICKING NEXT');
    await page.screenshot({ path: 'evidence/brainstormy/creation2-step3-next.png', fullPage: true });

    // Check if modal has a step 2
    const modalStillOpen = await page.$('.create-project-modal');
    if (modalStillOpen) {
      const modalHtml = await modalStillOpen.evaluate(el => el.innerHTML);
      console.log('\nFULL MODAL HTML:');
      console.log(modalHtml);

      // Try clicking submit again if it says "Create" or similar
      const submitBtn = await page.$('.create-project-modal__submit');
      if (submitBtn) {
        const submitText = await submitBtn.textContent();
        const isDisabled = await submitBtn.evaluate(el => el.disabled);
        console.log(`Submit button: text="${submitText?.trim()}" disabled=${isDisabled}`);

        // Fill any step-2 fields
        const step2Inputs = await page.$$('.create-project-modal input:not([type="hidden"]), .create-project-modal textarea');
        for (const inp of step2Inputs) {
          const ph = await inp.getAttribute('placeholder');
          const val = await inp.inputValue();
          console.log(`  Step2 input: placeholder="${ph}" value="${val}"`);
        }

        if (!isDisabled) {
          console.log('\n--- Clicking final submit ---');
          await submitBtn.click();
          await page.waitForTimeout(8000);
          await dumpState(page, 'AFTER FINAL SUBMIT');
          await page.screenshot({ path: 'evidence/brainstormy/creation2-step4-created.png', fullPage: true });
        }
      }
    } else {
      console.log('Modal closed after Next — project may have been created');
    }

    // STEP 5: Final state
    console.log('\n--- Final URL:', page.url());

    // Sidebar items
    const sidebarHTML = await page.evaluate(() => {
      const sidebar = document.querySelector('.brainstormy-sidebar');
      return sidebar?.innerHTML?.substring(0, 5000) || 'NO SIDEBAR';
    });
    console.log('\nSIDEBAR HTML (first 5000):');
    console.log(sidebarHTML);

    // Chat/session area
    const chatArea = await page.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).map(e =>
        `<textarea> placeholder="${e.placeholder}" class="${e.className?.substring(0, 80)}" visible=${e.offsetParent !== null}`
      );
      const messageContainers = Array.from(document.querySelectorAll('[class*="message" i], [class*="chat-area" i], [class*="session-content" i]')).map(e =>
        `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 100)}" visible=${e.offsetParent !== null} children=${e.children.length}`
      );
      return { textareas, messageContainers };
    });
    console.log('\nCHAT TEXTAREAS:');
    chatArea.textareas.forEach(t => console.log('  ', t));
    console.log('MESSAGE CONTAINERS:');
    chatArea.messageContainers.forEach(m => console.log('  ', m));

    // All buttons
    console.log('\n=== ALL VISIBLE BUTTONS (final) ===');
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent !== null).map(e =>
        `class="${e.className?.substring(0, 80)}" text="${e.textContent?.substring(0, 60).trim()}" title="${e.getAttribute('title') || ''}"`
      )
    );
    allBtns.forEach(b => console.log('  ', b));

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'evidence/brainstormy/creation2-error.png' }).catch(() => {});
  }

  await browser.close();
})();
