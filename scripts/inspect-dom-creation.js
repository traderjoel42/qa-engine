'use strict';

/**
 * DOM inspection script — explores the project/story/session creation flow.
 * Clicks through the UI to discover what forms/modals appear and captures
 * DOM structure at each step.
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

async function dumpPageState(page, label) {
  console.log(`\n=== ${label} ===`);
  console.log('URL:', page.url());

  // All visible inputs
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea, select')).map(e =>
      `<${e.tagName.toLowerCase()}> type="${e.type}" name="${e.name}" placeholder="${e.placeholder}" class="${e.className?.substring(0, 80)}" visible=${e.offsetParent !== null}`
    )
  );
  if (inputs.length) {
    console.log('INPUTS:');
    inputs.forEach(i => console.log('  ', i));
  }

  // All visible buttons
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]')).filter(e => e.offsetParent !== null).map(e =>
      `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 80)}" text="${e.textContent?.substring(0, 60).trim()}" aria="${e.getAttribute('aria-label') || ''}" title="${e.getAttribute('title') || ''}"`
    )
  );
  if (buttons.length) {
    console.log('VISIBLE BUTTONS:');
    buttons.forEach(b => console.log('  ', b));
  }

  // Modals / dialogs / overlays
  const modals = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="Modal"], [class*="dialog" i], [class*="Dialog"], [class*="overlay" i], [class*="Overlay"], [class*="popup" i], [class*="Popup"]')).map(e =>
      `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 100)}" role="${e.getAttribute('role') || ''}" visible=${e.offsetParent !== null} html="${e.innerHTML?.substring(0, 500)}"`
    )
  );
  if (modals.length) {
    console.log('MODALS/DIALOGS:');
    modals.forEach(m => console.log('  ', m));
  }

  // All headings
  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(e => e.offsetParent !== null).map(e =>
      `<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 60)}" text="${e.textContent?.substring(0, 80).trim()}"`
    )
  );
  if (headings.length) {
    console.log('HEADINGS:');
    headings.forEach(h => console.log('  ', h));
  }

  // Main content area
  const mainContent = await page.evaluate(() => {
    const main = document.querySelector('main, [class*="content" i], [class*="main" i]');
    if (main) return main.innerHTML?.substring(0, 2000);
    return document.querySelector('#root')?.innerHTML?.substring(0, 2000) || 'NO ROOT';
  });
  console.log('MAIN CONTENT (truncated):');
  console.log(mainContent?.substring(0, 1500));
}

(async () => {
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (!clerkKey) { console.error('CLERK_SECRET_KEY not set'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Auth via Clerk Backend API
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
    await page.waitForSelector('#root', { timeout: 30000 });
    await page.waitForTimeout(5000);

    // Step 1: Capture initial state
    await dumpPageState(page, 'STEP 1: INITIAL STATE (Dashboard)');
    await page.screenshot({ path: 'evidence/brainstormy/creation-step1-initial.png', fullPage: true });

    // Step 2: Click "New Novel" button (the + next to NOVELS header)
    console.log('\n--- Clicking "New Novel" + button ---');
    const newNovelBtn = await page.$('button.nav-vertical__add-btn[title="New Novel"]');
    if (!newNovelBtn) {
      // Try alternative: first .nav-vertical__add-btn
      console.log('Exact selector not found, trying first .nav-vertical__add-btn...');
      const firstAddBtn = await page.$('.nav-vertical__add-btn');
      if (firstAddBtn) {
        await firstAddBtn.click();
      } else {
        console.log('No add button found at all!');
      }
    } else {
      await newNovelBtn.click();
    }
    await page.waitForTimeout(3000);

    await dumpPageState(page, 'STEP 2: AFTER CLICKING "New Novel"');
    await page.screenshot({ path: 'evidence/brainstormy/creation-step2-after-new-novel.png', fullPage: true });

    // Step 3: Look for input fields and try to fill a name
    const nameInput = await page.$('input[type="text"], input[name*="name" i], input[placeholder*="name" i], input:not([type="hidden"]):not([type="password"]):not([type="email"])');
    if (nameInput) {
      console.log('\n--- Found name input, filling in test name ---');
      await nameInput.fill('QA DOM Inspect Test Novel');
      await page.waitForTimeout(1000);
      await dumpPageState(page, 'STEP 3: AFTER FILLING NAME');
      await page.screenshot({ path: 'evidence/brainstormy/creation-step3-filled-name.png', fullPage: true });

      // Look for submit/create button
      const submitBtn = await page.$('button[type="submit"], button:has-text("Create"), button:has-text("Save"), button:has-text("Add"), button:has-text("OK"), button:has-text("Done")');
      if (submitBtn) {
        console.log('\n--- Found submit button, clicking ---');
        const submitText = await submitBtn.textContent();
        console.log('Submit button text:', submitText);
        await submitBtn.click();
        await page.waitForTimeout(5000);
        await dumpPageState(page, 'STEP 4: AFTER CREATING NOVEL');
        await page.screenshot({ path: 'evidence/brainstormy/creation-step4-created.png', fullPage: true });
      } else {
        // Maybe pressing Enter works
        console.log('\n--- No submit button found, trying Enter key ---');
        await nameInput.press('Enter');
        await page.waitForTimeout(5000);
        await dumpPageState(page, 'STEP 4: AFTER PRESSING ENTER');
        await page.screenshot({ path: 'evidence/brainstormy/creation-step4-enter.png', fullPage: true });
      }
    } else {
      console.log('No name input found after clicking New Novel!');
      // Maybe it auto-created something?
      console.log('Checking URL change or sidebar update...');
    }

    // Step 5: Check if we're on a novel/project page now
    console.log('\n--- Current URL after creation attempt:', page.url());

    // Step 6: Try to find "New Story" or equivalent inside the novel
    console.log('\n--- Looking for story creation options ---');
    const storyBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent !== null).map(e => ({
        text: e.textContent?.trim().substring(0, 60),
        class: e.className?.substring(0, 80),
        title: e.getAttribute('title'),
        ariaLabel: e.getAttribute('aria-label')
      }))
    );
    console.log('All visible buttons:', JSON.stringify(storyBtns, null, 2));

    // Step 7: Look for the section-header add buttons (which might create stories/books)
    const sectionBtns = await page.$$('.section-header__add-btn');
    if (sectionBtns.length) {
      console.log(`\nFound ${sectionBtns.length} section add buttons`);
      // Click the first one (probably "Series" add button under Novels)
      console.log('--- Clicking first section add button ---');
      await sectionBtns[0].click();
      await page.waitForTimeout(3000);
      await dumpPageState(page, 'STEP 7: AFTER CLICKING SECTION ADD BUTTON');
      await page.screenshot({ path: 'evidence/brainstormy/creation-step7-section-add.png', fullPage: true });
    }

    // Step 8: Full DOM dump for reference
    console.log('\n=== FULL #root innerHTML (first 5000 chars) ===');
    const rootHtml = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 5000));
    console.log(rootHtml);

    // Step 9: Check chat area selectors
    console.log('\n=== CHAT AREA ELEMENTS ===');
    const chatElements = await page.evaluate(() => {
      const results = [];
      // Look for textarea
      document.querySelectorAll('textarea').forEach(e => {
        results.push(`<textarea> name="${e.name}" placeholder="${e.placeholder}" class="${e.className?.substring(0, 80)}" visible=${e.offsetParent !== null}`);
      });
      // Look for message containers
      document.querySelectorAll('[class*="message" i], [class*="chat" i], [class*="conversation" i]').forEach(e => {
        results.push(`<${e.tagName.toLowerCase()}> class="${e.className?.substring(0, 100)}" visible=${e.offsetParent !== null} childCount=${e.children.length}`);
      });
      return results;
    });
    chatElements.forEach(c => console.log(c));

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'evidence/brainstormy/creation-error.png' }).catch(() => {});
  }

  await browser.close();
})();
