# Week 3 Integration Testing — Implementation Spec

**QA Engine Phase 1 · Week 3 · Day 5**
**Version:** 1.0
**Date:** February 12, 2026
**Builds on:** Days 1-4 specs

---

## Overview

Day 5 verifies that all Week 3 components work together end-to-end. The focus is on wiring — ensuring the Bug Detector, Approval Manager, and Auto-Fixer interact correctly through the injectable dependency chain.

**File to create:**
- `tests/integration/bug-workflow.test.js` — End-to-end bug workflow tests

**Existing files referenced:**
- `core/engine/bug-detector.js`
- `core/engine/approval-manager.js`
- `core/engine/auto-fixer.js`
- `core/engine/errors.js`
- `core/integrations/adapters/bug-tracker.js`
- `core/integrations/adapters/notification.js`
- `core/integrations/adapters/llm.js`

---

## Design Decisions

### D1: Integration Tests Use Real Classes with Mock Adapters

Unit tests mock individual dependencies. Integration tests instantiate **all three engine classes** (BugDetector, ApprovalManager, AutoFixer) with their real constructors, but inject **mock adapters** (LLM, notifier, bug tracker, code executor, test runner). This tests the wiring between components without needing real external services.

### D2: No Database — In-Memory Storage Throughout

All storage injectables use in-memory Map-based implementations. This matches the Phase 1 approach and avoids database setup complexity for integration tests.

### D3: Three Test Categories

1. **Full workflow tests** — Test failure → bug detection → approval → fix → verify
2. **Component wiring tests** — Bug Detector correctly creates and invokes Approval Manager
3. **Error propagation tests** — Failures at each stage produce correct results downstream

---

## Integration Test Structure

### File: `tests/integration/bug-workflow.test.js`

Target: **~45 tests**

### Shared Setup

Every integration test creates a fully-wired component graph:

```javascript
const BugDetector = require('../../core/engine/bug-detector');
const ApprovalManager = require('../../core/engine/approval-manager');
const AutoFixer = require('../../core/engine/auto-fixer');

function createIntegrationStack(overrides = {}) {
  // Mock adapters
  const llm = createMockLLM(overrides.llm);
  const bugTracker = createMockBugTracker(overrides.bugTracker);
  const notifier = createMockNotifier(overrides.notifier);
  const codeExecutor = createMockCodeExecutor(overrides.codeExecutor);
  const testRunner = createMockTestRunner(overrides.testRunner);

  // Shared storage (in-memory, shared across components)
  const bugStorage = createMockStorage(overrides.bugStorage);
  const approvalStorage = createMockApprovalStorage(overrides.approvalStorage);
  const fixStorage = createMockFixStorage(overrides.fixStorage);

  // Real instances with mock adapters
  const approvalManager = new ApprovalManager({
    notifier,
    storage: approvalStorage,
    timeoutMs: overrides.timeoutMs || 3600000,
    recipients: ['+1234567890']
  });

  const autoFixer = new AutoFixer({
    llm,
    codeExecutor,
    testRunner,
    storage: fixStorage,
    bugTracker,
    notifier
  });

  const bugDetector = new BugDetector({
    llm,
    bugTracker,
    notifier,
    storage: bugStorage,
    approvalManager
  });

  return {
    bugDetector,
    approvalManager,
    autoFixer,
    // Adapters (for assertion/spy access)
    llm,
    bugTracker,
    notifier,
    codeExecutor,
    testRunner,
    // Storage (for state inspection)
    bugStorage,
    approvalStorage,
    fixStorage
  };
}
```

### Test Groups

**Group 1: Full Happy-Path Workflow (~8 tests)**

Tests the complete flow: test failure → bug detected → auto-fixable → approval sent → YES response → fix generated → fix safe → fix applied → fix verified.

```
Test: "Complete bug detection → approval → fix workflow"
  1. Create integration stack
  2. Call bugDetector.detectAndReport(app, 'sentinel', failure)
     → Verify bug created with correct classification
     → Verify external issue created in bug tracker
     → Verify approval request sent via notifier
  3. Get approval ID from notifier.sendWithActions call
  4. Call approvalManager.handleResponse(`YES-${approvalId}`)
     → Verify returns action='approved'
  5. Call autoFixer.generateAndApplyFix(app, bug, approval)
     → Verify returns status='verified'
  6. Verify all mock adapters called in correct order
```

```
Test: "Full workflow with NO response"
  1. Bug detection + approval request
  2. Call handleResponse with NO-{id}
  3. Verify approval status = 'rejected'
  4. Verify autoFixer NOT called
```

```
Test: "Full workflow with INFO then YES response"
  1. Bug detection + approval request
  2. Call handleResponse with INFO-{id} → returns bug details
  3. Call handleResponse with YES-{id} → returns approved
  4. Fix workflow succeeds
```

```
Test: "Full workflow with timeout"
  1. Create stack with timeoutMs: 1 (1ms)
  2. Bug detection + approval request
  3. Wait 10ms
  4. Call approvalManager.checkTimeout(approvalId) → returns true
  5. Verify approval status = 'timed-out'
```

```
Test: "Non-auto-fixable bug skips approval entirely"
  1. Configure LLM to return analysis with fix_approach: 'redesign architecture' (no simple pattern)
  2. Call detectAndReport
  3. Verify bug.auto_fixable = false
  4. Verify notifier.sendWithActions NOT called
  5. Verify bug tracker still creates issue with label 'needs-manual-fix'
```

```
Test: "Multiple bugs generate sequential IDs"
  1. Call detectAndReport 3 times
  2. Verify BUG-1, BUG-2, BUG-3
```

```
Test: "Bug tracker failure doesn't block bug creation"
  1. Configure bugTracker.createIssue to throw
  2. Call detectAndReport
  3. Verify bug record exists without external_issue_id
```

```
Test: "LLM failure produces degraded but valid bug"
  1. Configure llm.complete to throw
  2. Call detectAndReport
  3. Verify bug exists with root_cause='LLM analysis failed'
  4. Verify auto_fixable=false (can't analyze = can't auto-fix)
```

**Group 2: Auto-Fixer Safety Integration (~7 tests)**

```
Test: "Safety review rejects dangerous fix — entire pipeline returns safety-rejected"
  1. Configure LLM to return fix with eval() in code
  2. Call generateAndApplyFix
  3. Verify status='safety-rejected'
  4. Verify codeExecutor.applyChanges NOT called
```

```
Test: "Safety review rejects too many changes"
  1. Configure LLM to return fix with 15 changes
  2. Verify status='safety-rejected'
```

```
Test: "Fix application failure triggers rollback"
  1. Configure codeExecutor.applyChanges to throw
  2. Verify status='apply-error'
  3. Verify codeExecutor.rollback called
```

```
Test: "Verification failure triggers rollback"
  1. Configure testRunner.runTest to return { passed: false }
  2. Verify status='rolled-back'
  3. Verify codeExecutor.rollback called
```

```
Test: "Regression suite failure triggers rollback even if original test passes"
  1. Configure runTest passed=true, runSuite passed=false
  2. Verify status='rolled-back'
```

```
Test: "Unapproved fix throws FixError"
  1. Create approval with status='pending' (not approved)
  2. Call generateAndApplyFix → throws FixError
```

```
Test: "Rejected fix throws FixError"
  1. Create approval with status='rejected'
  2. Call generateAndApplyFix → throws FixError
```

**Group 3: Cross-Component Data Flow (~10 tests)**

```
Test: "Bug record from detector contains all fields needed by auto-fixer"
  1. Call detectAndReport, capture bug
  2. Verify bug has: bug_id, likely_location, fix_approach, category, evidence.test_id
  3. These are the fields AutoFixer.generateAndApplyFix reads
```

```
Test: "Approval record from manager contains all fields needed by auto-fixer"
  1. Call requestApproval, capture approval
  2. Verify approval has: approval_id, status, bug_id, bug (cached)
  3. handleResponse YES → verify approval has: status='approved', responded_at
```

```
Test: "Evidence flows from failure through bug to issue description"
  1. Create failure with specific console error + network failure
  2. Call detectAndReport
  3. Inspect bugTracker.createIssue call args
  4. Verify description mentions console error count + network failure count
```

```
Test: "Classification affects auto-fixability → affects labels"
  1. Failure that classifies as 'ui' category
  2. Verify auto_fixable=false (ui not auto-fixable)
  3. Verify issue labels include 'needs-manual-fix'
```

```
Test: "Classification affects auto-fixability → affects approval flow"
  1. Failure that classifies as 'memory' + simple pattern
  2. Verify auto_fixable=true
  3. Verify notifier called (approval initiated)
```

```
Test: "FixResult contains enough info for bug status update"
  1. Run full fix pipeline
  2. Verify FixResult has: status, bugId, explanation, startedAt, completedAt
```

```
Test: "LLM prompt includes evidence from failure"
  1. Call detectAndReport with specific console errors
  2. Inspect llm.complete call args
  3. Verify prompt contains console error messages
```

```
Test: "Fix prompt includes bug analysis data"
  1. Call generateFix
  2. Inspect llm.complete call args
  3. Verify prompt contains root_cause, likely_location, fix_approach
```

```
Test: "Multiple sequential bug workflows don't interfere"
  1. Run two complete workflows (detect → approve → fix) sequentially
  2. Verify separate bug IDs, separate approval IDs
  3. Verify no cross-contamination of state
```

```
Test: "Approval lookup after request finds the correct bug"
  1. Request approval, capture approvalId
  2. getApproval(approvalId) → verify bug_id matches
  3. handleResponse(YES-{id}) → verify returned bug matches original
```

**Group 4: Error Isolation (~8 tests)**

```
Test: "Bug tracker error during detection doesn't prevent approval"
  1. bugTracker.createIssue throws
  2. Bug still created, approval still sent
  3. Verify _issueCreationError set on bug
```

```
Test: "Notifier error during approval doesn't prevent record creation"
  1. notifier.sendWithActions throws
  2. Approval record still exists in storage
  3. Verify _notificationError set on approval
```

```
Test: "Fix generation LLM error returns clean FixResult"
  1. llm.complete throws during generateFix
  2. Verify returns FixResult with status='failed'
  3. Verify fix storage updated with error
```

```
Test: "Rollback error during apply-error is caught"
  1. codeExecutor.applyChanges throws
  2. codeExecutor.rollback also throws
  3. Verify overall flow still returns (doesn't crash)
```

```
Test: "BugDetectorError has correct phase on evidence failure"
  1. Provide null failure
  2. Catch error, verify phase='evidence'
```

```
Test: "FixError has correct phase on generation failure"
  1. Mock LLM to return unparseable content
  2. Catch error from generateFix, verify phase='generation'
```

```
Test: "ApprovalError on bad bugId"
  1. Call generateApprovalId with 'invalid'
  2. Catch error, verify it's ApprovalError
```

```
Test: "AdapterError from base classes"
  1. Instantiate BugTrackerAdapter (base), call createIssue
  2. Catch error, verify adapterType='bug_tracker', operation='createIssue'
```

**Group 5: Orchestrator Wiring (~5 tests)**

These test how the Bug Detector connects to the TestOrchestrator's `failureHandler` interface.

```
Test: "Bug Detector wraps as failureHandler correctly"
  1. Create bug detector
  2. Create closure: failureHandler = async (agentId, failures, ctx) => { ... }
  3. Call failureHandler with array of failures
  4. Verify detectAndReport called for each failure
```

```
Test: "failureHandler processes multiple failures sequentially"
  1. Pass 3 failures to handler
  2. Verify 3 separate bugs created (BUG-1, BUG-2, BUG-3)
```

```
Test: "failureHandler continues after one detection error"
  1. First failure triggers LLM error (degraded mode)
  2. Second failure succeeds normally
  3. Both bugs created
```

```
Test: "failureHandler passes correct app config from context"
  1. context = { appConfig: { name: 'Brainstormy', ... } }
  2. Verify detectAndReport receives correct app
```

```
Test: "failureHandler can be replaced with no-op (Week 2 default)"
  1. No-op handler: async () => {}
  2. Verify orchestrator continues without error
```

---

## Claude Code Implementation Steps

### Step 1: Create integration test file
```
File: tests/integration/bug-workflow.test.js
Import all three engine classes + all mock factories from Days 1-4 specs.
Create createIntegrationStack() helper.
```

### Step 2: Implement test groups 1-5
```
Work through each group sequentially.
After each group, run tests to verify.
Expected: ~45 tests in this file.
```

### Step 3: Fix any wiring issues discovered
```
Integration tests may reveal:
- Missing exports
- Mismatched argument shapes between components
- Storage interface inconsistencies
Fix these in the source files and update unit tests if needed.
```

### Step 4: Final full-suite run
```
Run entire test suite: connectors + agents + orchestrator + bug detector + approval manager + auto-fixer + integration.
Expected: ~1193 (after Days 3-4) + ~45 (integration) = ~1238 total tests passing.
```

---

## Validation Criteria

**Day 5 is complete when:**
- [ ] `tests/integration/bug-workflow.test.js` exists with ~45 tests
- [ ] Full happy-path workflow passes (detect → approve → fix → verify)
- [ ] All error isolation tests pass (component failures don't cascade)
- [ ] Cross-component data flow verified (evidence propagates correctly)
- [ ] Orchestrator failureHandler wiring works
- [ ] Total project tests: ~1238 passing
- [ ] No regressions in any existing test suites
- [ ] **Week 3 milestone: Bug detection + auto-fix pipeline complete, ~1238 tests passing**

---

## Week 3 Summary

| Day | Component | New Tests | Running Total |
|-----|-----------|-----------|---------------|
| 1-2 | Bug Detector + Adapters + Linear Client | ~170 | ~1033 |
| 3-4 | Auto-Fixer + Approval Manager | ~160 | ~1193 |
| 5 | Integration Testing | ~45 | ~1238 |

**Week 3 deliverables:**
- 6 new source files (bug-detector, approval-manager, auto-fixer, errors, 3 adapter interfaces)
- 1 new integration file (linear client)
- ~375 new tests across 8 test files
- Complete bug detection → approval → auto-fix pipeline
- All components follow injectable dependency pattern
- Graceful degradation at every failure point
