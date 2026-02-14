# Task 6: Integration Test Against Staging — Execution Playbook

**Date:** February 14, 2026  
**Purpose:** Step-by-step guide for running all 8 smoke scenarios against Brainstormy staging, capturing failures, debugging, and iterating to green.  
**Use with:** Claude Code in the `qa-engine` repo

---

## Pre-Flight Checklist

Before running anything, verify these prerequisites:

```bash
# 1. Confirm you're on the right branch with all Tasks 0-5 committed
git log --oneline -8
# Should show commits through 159b4e9 (Task 5)

# 2. Verify unit tests still pass
npm test
# Expected: 1842 passing

# 3. Verify env vars are set
echo $BRAINSTORMY_TEST_PASSWORD   # Must be set (qa-automation@brainstormy.co password)
echo $CLERK_SECRET_KEY            # Must be set (staging Clerk secret for session injection)

# 4. Verify staging is alive (cold start may take 60-120s on Render)
curl -s -o /dev/null -w "%{http_code}" https://brainstormy-frontend-staging.onrender.com
# Expected: 200 (may take a moment if cold)

# 5. Verify app.config.json is valid
node -e "const c = require('./apps/brainstormy/app.config.json'); \
  console.log('App ID:', c.id); \
  console.log('URL:', c.baseUrl); \
  console.log('Selectors count:', Object.keys(c.connector.config.selectors).length);"
# Expected: 18 selectors (7 existing + 11 new from Task 4)
```

---

## Phase 1: First Run — Capture Baseline

Run the full suite once to see what the raw state looks like. Expect most new scenarios to fail on this first pass — that's the whole point of Task 6.

```bash
# Run all smoke scenarios with verbose output + evidence collection
node scripts/run-agent.js brainstormy healer --verbose 2>&1 | tee docs/task6-run-001.log
```

**What to capture from this first run:**
- Which scenarios pass (likely smoke-01, smoke-02 from prior validation)
- Which scenarios fail and at which step
- Error messages — especially selector-related errors (`waitForSelector`, `no element found`)
- Screenshots in the evidence directory (check `evidence/` or `data/evidence/`)
- Any timeout errors (especially smoke-07 AI response)

**Log the results immediately:**

```bash
# Append initial findings to the log file
cat >> docs/expanded-smoke-scenarios-log.md << 'EOF'

## Task 6: Integration Test Run Log

### Run 001 — Initial Baseline
**Date:** $(date -u +"%Y-%m-%d %H:%M UTC")
**Commit:** $(git rev-parse --short HEAD)

| Scenario | Status | Failure Point | Error |
|----------|--------|---------------|-------|
| smoke-01-login | ? | - | - |
| smoke-02-sidebar-loaded | ? | - | - |
| smoke-03-create-project | ? | - | - |
| smoke-04-create-story | ? | - | - |
| smoke-05-create-session | ? | - | - |
| smoke-06-send-message | ? | - | - |
| smoke-07-ai-response | ? | - | - |
| smoke-08-hierarchy-navigation | ? | - | - |

**Findings:**
(fill in after run)
EOF
```

---

## Phase 2: Selector Calibration (Priority Area #4)

This is likely the single biggest source of failures. All 11 new selectors from Task 4 have placeholder CSS values. They MUST be verified against the real staging DOM.

### Step 2a: Interactive DOM Inspection

Open a Playwright inspector session against staging to examine the real DOM:

```bash
# Launch Playwright in headed mode with inspector
npx playwright open https://brainstormy-frontend-staging.onrender.com
```

**If headed mode isn't available (e.g., headless-only server), use a script:**

```javascript
// scripts/inspect-selectors.js
const { chromium } = require('playwright');
const appConfig = require('../apps/brainstormy/app.config.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to staging (handle Clerk auth the same way connector does)
  await page.goto(appConfig.baseUrl);
  await page.waitForTimeout(5000); // Wait for SPA hydration
  
  const selectors = appConfig.connector.config.selectors;
  
  console.log('\n=== SELECTOR CALIBRATION REPORT ===\n');
  
  for (const [key, selector] of Object.entries(selectors)) {
    try {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        console.log(`✅ ${key}: FOUND <${tag}> "${text?.substring(0, 50)}"`);
      } else {
        console.log(`❌ ${key}: NOT FOUND — selector: ${selector}`);
      }
    } catch (err) {
      console.log(`⚠️  ${key}: ERROR — ${err.message.substring(0, 80)}`);
    }
  }
  
  // Take a screenshot for reference
  await page.screenshot({ path: 'evidence/selector-calibration.png', fullPage: true });
  
  // Dump the full DOM structure for analysis
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  require('fs').writeFileSync('evidence/staging-dom-dump.html', bodyHTML);
  
  await browser.close();
})();
```

```bash
node scripts/inspect-selectors.js
```

### Step 2b: Selector-by-Selector Calibration

For each failing selector, use this investigation pattern:

```javascript
// In the Playwright inspector or a script, for each broken selector:

// 1. Check if data-testid exists at all
await page.$$eval('*[data-testid]', els => 
  els.map(e => `${e.tagName} data-testid="${e.getAttribute('data-testid')}"`));

// 2. Look for the element by text content or role
await page.$$eval('h1, h2, h3', els => 
  els.map(e => `<${e.tagName}> class="${e.className}" text="${e.textContent.substring(0, 40)}"`));

// 3. Check the message container structure (critical for smoke-06, smoke-07)
await page.$$eval('[class*="message"], [class*="Message"]', els => 
  els.map(e => `<${e.tagName}> class="${e.className}" role="${e.getAttribute('role')}"`));

// 4. Check breadcrumb structure (critical for smoke-08)
await page.$$eval('[class*="breadcrumb"], [class*="Breadcrumb"], nav a', els => 
  els.map(e => `<${e.tagName}> class="${e.className}" href="${e.getAttribute('href')}" text="${e.textContent}"`));
```

### Step 2c: Known Problem Areas & Likely Fixes

**1. `userMessageLast` / `assistantMessageLast` (Priority Area #2)**

The spec used `:last-of-type` fallback, which won't work if user and assistant messages share the same HTML tag (e.g., both are `<div>`). Investigate:

```javascript
// Find all message elements and their distinguishing attributes
await page.$$eval('[class*="message"], [class*="Message"]', els => 
  els.map(e => ({
    tag: e.tagName,
    className: e.className,
    role: e.getAttribute('role'),
    dataRole: e.dataset?.role || e.dataset?.type || e.dataset?.sender,
    text: e.textContent?.substring(0, 30)
  }))
);
```

**Likely fix patterns:**
- If messages have `data-role="user"` / `data-role="assistant"`: use `[data-role="user"]:last-of-type`
- If messages have different CSS classes: use `.user-message:last-child` / `.assistant-message:last-child`
- If messages are in a flat list with no role distinction: you'll need to use `nth-last-child` or JavaScript evaluation instead of a CSS selector

**2. `chatInput` / `chatSend` (existing selectors — may already work)**

These were among the 7 calibrated selectors from prior validation. Double-check they still resolve after navigating into a session (not just on page load).

**3. `projectHeading` / `storyHeading`**

Brainstormy may not have a standalone `<h1>` with the project name. The name might be in the sidebar, a breadcrumb, or an inline-editable field. Check:

```javascript
// After creating/navigating to a project
await page.$$eval('h1, h2, [class*="title"], [class*="Title"], [class*="heading"]', els =>
  els.map(e => `<${e.tagName}> class="${e.className}" text="${e.textContent.substring(0, 40)}"`));
```

**4. `breadcrumbProject` / `breadcrumbStory` / `breadcrumbSession`**

Brainstormy may not use traditional breadcrumbs. Navigation might be sidebar-based. Check if the hierarchy navigation in smoke-08 should use sidebar links instead of breadcrumbs:

```javascript
// Look for sidebar navigation elements
await page.$$eval('nav a, aside a, [class*="sidebar"] a, [class*="Sidebar"] a', els =>
  els.map(e => `<${e.tagName}> class="${e.className}" href="${e.getAttribute('href')}" text="${e.textContent.substring(0, 40)}"`));
```

### Step 2d: Update app.config.json

After identifying the correct selectors, update them:

```bash
# Edit app.config.json with the calibrated selectors
# Example: if project heading is actually in a div.project-title
# Change: "projectHeading": "[data-testid='project-heading'], h1.project-name"
# To:     "projectHeading": "div.project-title"
```

**After updating selectors, commit and re-run:**

```bash
git add apps/brainstormy/app.config.json
git commit -m "Task 6: Calibrate selectors against staging DOM (run 001)"
git push

# Re-run to verify
node scripts/run-agent.js brainstormy healer --verbose 2>&1 | tee docs/task6-run-002.log
```

---

## Phase 3: SPA Hydration Investigation (Priority Area #1)

The `createProject` action internally calls `page.goto('/projects')`. In a React SPA, this full page navigation may break hydration. Test this specifically:

```javascript
// scripts/test-spa-navigation.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // 1. Navigate to staging, let SPA hydrate
  await page.goto('https://brainstormy-frontend-staging.onrender.com');
  await page.waitForLoadState('networkidle');
  console.log('Initial URL:', page.url());
  
  // 2. Test: Does page.goto('/projects') work post-hydration?
  try {
    await page.goto('https://brainstormy-frontend-staging.onrender.com/projects');
    await page.waitForLoadState('networkidle');
    console.log('After goto /projects:', page.url());
    
    // Check if React app is still mounted
    const reactRoot = await page.$('#root, #app, [data-reactroot]');
    console.log('React root found:', !!reactRoot);
    
    // Check if the page rendered correctly
    const bodyText = await page.textContent('body');
    console.log('Page has content:', bodyText.length > 100);
  } catch (err) {
    console.error('goto /projects FAILED:', err.message);
  }
  
  // 3. Alternative: Use sidebar click navigation instead
  try {
    await page.goto('https://brainstormy-frontend-staging.onrender.com');
    await page.waitForLoadState('networkidle');
    
    // Find and click the "Projects" link in sidebar
    const projectsLink = await page.$('a[href="/projects"], a[href*="projects"]');
    if (projectsLink) {
      await projectsLink.click();
      await page.waitForLoadState('networkidle');
      console.log('After sidebar click to /projects:', page.url());
    } else {
      console.log('No projects link found in sidebar');
    }
  } catch (err) {
    console.error('Sidebar navigation FAILED:', err.message);
  }
  
  await browser.close();
})();
```

**If `page.goto()` breaks hydration**, the fix is to change `createProject`'s implementation in the connector to use sidebar/SPA navigation instead:

```javascript
// In connectors/brainstormy/connector.js, createProject method
// BEFORE (if using page.goto):
async createProject(name) {
  await this.page.goto(`${this.baseUrl}/projects`);
  // ...
}

// AFTER (use SPA navigation):
async createProject(name) {
  // Click sidebar link or use React Router navigation
  const projectsLink = await this.page.$('a[href="/projects"]');
  if (projectsLink) {
    await projectsLink.click();
    await this.page.waitForLoadState('networkidle');
  }
  // ... rest of creation logic
}
```

---

## Phase 4: Message Selector Investigation (Priority Area #2)

This is critical for smoke-06 (send message) and smoke-07 (AI response). The `:last-of-type` fallback in the spec may not work.

### Step 4a: Understand the Message DOM Structure

After navigating to an active session with existing messages:

```javascript
// Dump the complete message list structure
const messageHTML = await page.$eval(
  '[class*="message" i], [class*="chat" i], [role="log"]',
  el => el?.outerHTML?.substring(0, 5000) || 'NOT FOUND'
);
console.log(messageHTML);
```

### Step 4b: Determine Selector Strategy

Based on what the DOM looks like, choose one:

**Option A — Distinct classes for user/assistant:**
```json
"userMessageLast": ".user-message:last-child",
"assistantMessageLast": ".assistant-message:last-child"
```

**Option B — Data attributes:**
```json
"userMessageLast": "[data-role='user']:last-of-type",
"assistantMessageLast": "[data-role='assistant']:last-of-type"
```

**Option C — Nth-child approach (if messages alternate in a flat list):**
Need JavaScript evaluation instead of CSS selector. This would require modifying the `element_exists` and `element_text_contains` assertion handlers to support JS evaluation, or adding a custom assertion type.

**Option D — Use `page.evaluate()` in the connector:**
If CSS selectors are insufficient, modify `waitForAIResponse` in AIAppConnector to use JavaScript to find the last assistant message:

```javascript
async waitForAIResponse(timeout = 60000) {
  // Wait for generating indicator to disappear
  await this.page.waitForSelector(
    this.getSelector('generatingIndicator'), 
    { state: 'hidden', timeout }
  ).catch(() => {}); // May not appear if response is fast
  
  // Use evaluate to find last assistant message
  const response = await this.page.evaluate(() => {
    const messages = document.querySelectorAll('[data-role="assistant"], .assistant-message');
    const last = messages[messages.length - 1];
    return last ? last.textContent : null;
  });
  
  this.setState('last_ai_response', response);
  return { text: response };
}
```

---

## Phase 5: AI Response Timeout Tuning (Priority Area #3)

### Step 5a: Measure Actual Response Time

```javascript
// scripts/test-ai-response-time.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate and authenticate...
  // Navigate to an active session...
  
  const start = Date.now();
  
  // Send a message
  await page.fill('CHAT_INPUT_SELECTOR', 'QA test: briefly describe a mysterious character who runs a speakeasy.');
  await page.click('CHAT_SEND_SELECTOR');
  
  // Wait for AI response
  try {
    // Wait for generating indicator, then wait for it to disappear
    await page.waitForSelector('GENERATING_INDICATOR_SELECTOR', { timeout: 10000 });
    await page.waitForSelector('GENERATING_INDICATOR_SELECTOR', { state: 'hidden', timeout: 120000 });
    
    const elapsed = Date.now() - start;
    console.log(`AI response arrived in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s)`);
    
    if (elapsed > 60000) {
      console.log('⚠️  Response took >60s — increase waitForAIResponse timeout');
    } else if (elapsed > 30000) {
      console.log('⚠️  Response took >30s — 60s timeout is adequate but tight');
    } else {
      console.log('✅ Response time is healthy');
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`❌ AI response timeout after ${elapsed}ms: ${err.message}`);
  }
  
  await browser.close();
})();
```

### Step 5b: Adjust Timeouts Based on Findings

In `smoke-tests.json`:
- `smoke-07` scenario timeout: Start at 90s, increase to 120s if AI typically takes 40-60s
- `waitForAIResponse` params: Start at 60s, increase to 90s if needed
- Consider adding `retries: 1` to smoke-07 if timeout failures are intermittent

In `app.config.json`:
```json
"timeouts": {
  "aiResponse": 90000,   // Adjust based on measurement
  "navigation": 90000,
  "warmUp": 120000
}
```

---

## Phase 6: Timing & Wait Issues (Priority Area #5)

Common timing issues in SPA testing:

### 6a: After Navigation

```javascript
// Problem: Asserting immediately after navigate, before React renders
// Fix: Add explicit waits after navigation actions

// In the connector, after any navigation:
await this.page.waitForLoadState('networkidle');
await this.page.waitForTimeout(1000); // Brief stabilization pause
```

### 6b: After Entity Creation

```javascript
// Problem: createProject clicks "Create" and immediately asserts
// Fix: Wait for URL change or element appearance

// In createProject:
await Promise.all([
  this.page.waitForNavigation({ waitUntil: 'networkidle' }),
  this.page.click(createButton)
]);
```

### 6c: After sendMessage

```javascript
// Problem: sendMessage completes but message hasn't rendered yet
// Fix: After clicking send, wait for the message to appear

// In sendMessage:
await this.click(sendSelector);
await this.page.waitForTimeout(500); // UI rendering pause
// Or better: wait for the message element to appear
await this.page.waitForSelector('NEW_MESSAGE_SELECTOR', { timeout: 5000 });
```

### 6d: Render Cold Starts

Brainstormy staging on Render may cold-start (60-120s). The connector's `initialize()` should already handle this with the `warmUp` timeout. If the very first scenario fails with a navigation timeout, increase:

```json
"timeouts": {
  "warmUp": 180000  // 3 minutes for cold start
}
```

---

## Fix Cycle Workflow

Repeat this cycle until all 8 scenarios pass:

```
┌─────────────────────────────┐
│ 1. Run suite                │
│    node scripts/run-agent.js │
│    brainstormy healer       │
│    --verbose                │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 2. Identify first failure    │
│    - Which scenario?         │
│    - Which step/assertion?   │
│    - What's the error?       │
│    - Check screenshot        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 3. Diagnose root cause       │
│    - Selector wrong? → 2b    │
│    - Timing issue? → Phase 6 │
│    - SPA hydration? → Phase 3│
│    - AI timeout? → Phase 5   │
│    - Connector bug? → fix    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 4. Apply fix                 │
│    - Edit config or code     │
│    - Run unit tests          │
│    - Commit with message:    │
│      "Task 6: fix [desc]     │
│       (run N)"               │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ 5. Re-run & log results      │
│    - Append to log file      │
│    - git push                │
│    - Repeat from step 1      │
└─────────────────────────────┘
```

---

## Log Template

Append this for each run to `docs/expanded-smoke-scenarios-log.md`:

```markdown
### Run NNN — [Brief Description]
**Date:** YYYY-MM-DD HH:MM UTC
**Commit:** [short hash]
**Changes since last run:** [what was fixed]

| Scenario | Status | Duration | Notes |
|----------|--------|----------|-------|
| smoke-01-login | ✅/❌/⏭️ | Xms | |
| smoke-02-sidebar-loaded | ✅/❌/⏭️ | Xms | |
| smoke-03-create-project | ✅/❌/⏭️ | Xms | |
| smoke-04-create-story | ✅/❌/⏭️ | Xms | |
| smoke-05-create-session | ✅/❌/⏭️ | Xms | |
| smoke-06-send-message | ✅/❌/⏭️ | Xms | |
| smoke-07-ai-response | ✅/❌/⏭️ | Xms | |
| smoke-08-hierarchy-nav | ✅/❌/⏭️ | Xms | |

**Result:** X/8 passed, Y failed, Z skipped

**Findings & Fixes Applied:**
- [Finding 1]
- [Fix applied]
```

---

## Phase 7: Post-Stabilization Assessment

Once all 8 scenarios pass consistently (run the suite 2-3 times to confirm stability):

### Task 7 Assessment: Frontend data-testid Attributes

**Decision criteria:** During selector calibration, track which selectors required fragile CSS class/structure-based fallbacks vs. stable `data-testid` hooks.

**Create this list during Phase 2:**

```markdown
## Selectors Needing data-testid (Task 7 Candidates)

| Selector Key | Current CSS Selector | Why data-testid is needed |
|--------------|---------------------|---------------------------|
| projectHeading | div.some-fragile-class | No semantic hook, class could change |
| userMessageLast | complex JS workaround | Can't select with pure CSS |
| ... | ... | ... |
```

**Task 7 should proceed if:** More than 3 selectors rely on fragile CSS fallbacks that would break on minor UI changes.

**Task 7 can be deferred if:** Most selectors resolved to stable semantic selectors (roles, aria labels, or existing data attributes).

### Task 8 Assessment: Cleanup Action

**Decision criteria:** After several test runs, check how much test data accumulated:

```bash
# Count test projects created during testing (look for "QA Smoke Test" pattern)
# This would be done via Brainstormy's admin dashboard or database query
```

**Task 8 should proceed if:** Test data accumulation is a concern (>10 test projects per run, no easy way to clean up manually).

**Task 8 can be deferred if:** Test data is minimal, easily identifiable by timestamp prefix, and can be cleaned manually via admin dashboard.

---

## Quick Reference: File Locations

| File | Purpose |
|------|---------|
| `apps/brainstormy/app.config.json` | Selectors, timeouts, auth config |
| `apps/brainstormy/scenarios/smoke-tests.json` | All 8 scenario definitions |
| `connectors/brainstormy/connector.js` | BrainstormyConnector actions |
| `connectors/ai-chat-app/connector.js` | AIAppConnector (sendMessage, waitForAIResponse) |
| `connectors/generic/connector.js` | GenericWebAppConnector (navigate, click, wait) |
| `agents/healer/agent.js` | BaseAgent scenario execution |
| `core/engine/scenario-runner.js` | Group-aware scenario runner |
| `docs/expanded-smoke-scenarios-log.md` | Debug log (append findings here) |
| `evidence/` | Screenshots and DOM dumps |

## Quick Reference: Run Commands

```bash
# Full suite
node scripts/run-agent.js brainstormy healer --verbose

# Single scenario (if runner supports --scenario flag)
node scripts/run-agent.js brainstormy healer --scenario smoke-03-create-project --verbose

# Just the independent group (quick smoke)
node scripts/run-agent.js brainstormy healer --group independent --verbose

# Unit tests (run after any code changes)
npm test
```
