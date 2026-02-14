# Task 6: Integration Test Playbook — Completion Summary

**Date:** 2026-02-14
**Status:** Complete
**Final Result:** 8/8 smoke scenarios passing, 3 consecutive green runs

---

## Summary

Task 6 iterated through 6 test runs (plus sub-runs) against Brainstormy staging to diagnose and fix failures in all 8 smoke test scenarios. The process moved through Phases 1-7 of the playbook, resolving issues in selector calibration, SPA navigation, entity creation flows, overlay dismissal, API key configuration, and chat interaction.

## Key Discoveries

### 1. No data-testid Attributes
Brainstormy staging has zero `data-testid` attributes. All 55+ selectors from Task 4 had to be rewritten from `[data-testid='...']` to CSS class selectors. The BEM naming convention (`.message-input__textarea`, `.create-project-modal__submit`, etc.) provides stable selectors.

### 2. SPA Hydration Crash
`page.goto('/projects')` kills the React SPA — the `/projects` route doesn't exist. Brainstormy is a single-page app where all content lives under `/` and `/chat/{uuid}`. The connector was rewritten to use sidebar button clicks and modal flows instead of route navigation.

### 3. Auto-Creation Entity Model
Creating a "project" in Brainstormy auto-creates a story and session in one operation. The 2-step modal flow (name + medium → navigator genre selection) ends with the URL changing to `/chat/{uuid}`. Project, story, and session all share the same UUID.

### 4. Engagement Modal Overlay
After authentication and entity creation, a `.engagement-modal-overlay` div blocks all pointer events. The `dismissOverlays()` method uses `page.evaluate()` to remove these elements from the DOM before any user interaction.

### 5. OpenRouter API Key Requirement
Chat is readonly without a configured OpenRouter API key. The key is set via the settings dialog (`input.api-key-input` + `.save-api-key-btn`). The connector's `configureApiKey()` method reads `BRAINSTORMY_OPENROUTER_KEY` from the environment and configures it during initialization.

### 6. Chat Selector Specifics
- Chat input: `.message-input__textarea` (not `.message-input textarea`)
- Send button: `.message-input__button` (not `.message-input__send`)
- Message assertions: `:last-child` pseudo-selector doesn't work because the message list has trailing non-message elements

## Files Modified

| File | Changes |
|------|---------|
| `apps/brainstormy/app.config.json` | 55+ selectors rewritten to CSS classes, 4 new settings selectors added |
| `connectors/brainstormy/connector.js` | `createProject()`, `createStory()`, `createSession()`, `navigateToProject/Story/Session()` rewritten; `dismissOverlays()` and `configureApiKey()` added |
| `apps/brainstormy/scenarios/smoke-tests.json` | Assertions updated for `/chat/` URLs, wait steps added, timeouts adjusted |
| `tests/connectors/brainstormy-connector.test.js` | Tests updated for new connector behavior |
| `connectors/generic-web-app/connector.js` | Navigate timeout increased to 120s |

## Run History

| Run | Result | Key Fix |
|-----|--------|---------|
| 001 | 0/8 | Navigate timeout too short for Render cold start |
| 002 | 1/8 | Discovered zero data-testid attributes |
| 003 | 6/8 | Full selector + connector rewrite |
| 004 | 8/8 | API key config + chat selector fixes |
| 005 | 8/8 | Stability confirmation |
| 006 | 8/8 | Stability confirmation |

## Phase 7 Assessment

- **Task 7 (data-testid attributes):** Deferred. BEM selectors are stable.
- **Task 8 (cleanup action):** Low priority. ~1 project per run, easily identifiable.
