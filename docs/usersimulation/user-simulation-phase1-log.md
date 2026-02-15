# User Simulation Framework — Phase 1 Implementation Log

---

## Task 1.1: Project Structure and Configuration

**Status:** Complete
**Timestamp:** 2026-02-14T18:00:00

### What was implemented
- Directory structure: `tests/simulation/` with all subdirectories (`stories/`, `evaluators/`, `reports/`, `results/`, `screenshots/`)
- `__init__.py` and `__main__.py` entry point
- `config.py` — `EnvironmentConfig`, `PacingConfig`, `RetryConfig`, `EvaluationConfig`, `SimulationConfig` with `load()`, `validate()`, `validate_or_raise()`
- `models.py` — All 9 dataclasses: `SessionScript`, `ChallengeQuery`, `DeliverableRequest`, `GeneratedSessionOutline`, `StoryScenario`, `RetentionResult`, `CitationResult`, `RunMetrics`
- `screenshot.py` — Stub class with all method signatures, no implementation
- `.gitignore` for `results/` and `screenshots/`

### Files created
- `tests/simulation/__init__.py`
- `tests/simulation/__main__.py`
- `tests/simulation/config.py`
- `tests/simulation/models.py`
- `tests/simulation/screenshot.py`
- `tests/simulation/.gitignore`
- `tests/simulation/stories/__init__.py`
- `tests/simulation/evaluators/__init__.py`
- `tests/simulation/reports/__init__.py`
- `tests/simulation/results/.gitkeep`
- `tests/simulation/screenshots/.gitkeep`

### Validation results
- [x] All modules import without errors
- [x] `SimulationConfig.load('staging')` works
- [x] `SimulationConfig.load('local')` works
- [x] `SimulationConfig.load('production')` raises ValueError
- [x] `RunMetrics` round-trips through JSON save/load
- [x] `StoryScenario.get_sessions_for_tier(15)` returns correct slice

### Deviations
- Added `from __future__ import annotations` to all modules — the local Python is 3.9.6 (despite `.python-version` specifying 3.11.4), and `str | None` syntax requires 3.10+. The future import makes all annotations deferred strings, which works on 3.9+.

---

## Task 1.2: API Client

**Status:** Complete
**Timestamp:** 2026-02-14T18:15:00
**Commit:** `fa52eb6`

### What was implemented
- `BrainstormyClient` class with async context manager (`async with`)
- `from_config()` classmethod: builds auth headers from `SimulationConfig` (test bypass → `X-Test-User-ID`, Clerk → `Authorization: Bearer`)
- Internal `_request()` with retry logic (exponential backoff on 429/502/503/504, `TimeoutException`, `ConnectError`)
- 29 endpoint methods covering all API surfaces: projects, stories, navigator, sessions, messages, bibles, reports, search, bookmarks, summary
- `wait_for_summary()`: polls `/sessions/{id}/status` for `has_summary: true` with exponential backoff
- `preflight_check()`: verifies API reachable and auth valid
- `BrainstormyAPIError` exception class

### Files created
- `tests/simulation/api_client.py` (367 lines)

### Validation results
- [x] `from_config()` with test_user_id produces correct headers
- [x] `from_config()` with clerk_session_token produces correct headers
- [x] `from_config()` with no auth raises ValueError
- [x] All 29 expected methods present
- [x] Context manager protocol (`__aenter__`/`__aexit__`) implemented

### Deviations
- None

---

## Task 1.3: Metrics Collector

**Status:** Complete
**Timestamp:** 2026-02-14T18:30:00
**Commit:** `6a98a9d`

### What was implemented
- `MetricsCollector` class with auto-generated `run_id`
- `timed()` async wrapper: measures elapsed time, records success/failure, re-raises on failure
- Recording methods: `record_message_sent/received`, `record_session_complete`, `record_summary_time`, `record_error`, `record_timeout`, `set_resource_ids`
- `compile()`: aggregates into `RunMetrics` — averages retention scores, counts contradictions, computes citation accuracy/hallucination rate, filters response times to successful `send_message` calls only
- `citation_results=None` default per eval finding

### Files created
- `tests/simulation/metrics.py` (197 lines)

### Validation results
- [x] `timed()` correctly measures elapsed time on an async function
- [x] `timed()` records error timings and re-raises
- [x] `compile()` produces valid `RunMetrics` from recorded data
- [x] `compile()` with retention results correctly averages scores
- [x] `compile()` with citation results correctly computes accuracy
- [x] JSON serialization round-trips through `RunMetrics.save()` / `RunMetrics.load()`

### Deviations
- None

---

## Task 1.4: Basic CLI Runner

**Status:** Complete
**Timestamp:** 2026-02-14T18:45:00
**Commit:** `39ac013`

### What was implemented
- `registry.py`: Scenario registration with lazy auto-import via `pkgutil.walk_packages()`. Story modules call `register_scenario()` at import time. Registry lives in its own module (not `runner.py`) to avoid the `__main__` module identity problem.
- `SimulationRunner.run()`: Full orchestration — setup (project + story + navigator) → session loop (messages with pacing) → deliverables → challenge queries → compile → save metrics → WhatsApp notify → cleanup
- CLI entry point with `build_parser()`, `print_dry_run()`, `run_cli()`, `main()`
- WhatsApp notification via raw `httpx` to Twilio REST API with HTTP Basic Auth
- Error resilience: individual session/message failures recorded in metrics but don't abort the run
- 409 handling on `end_session` (session already has summary)
- `continued_in` detection on end_session response

### Files created
- `tests/simulation/registry.py` (68 lines)
- `tests/simulation/runner.py` (498 lines)

### Validation results
- [x] `--list` parses correctly
- [x] `--dry-run` prints readable execution plan
- [x] `--scenario fantasy_ember --tier 15` parses correctly
- [x] `--all --tier 50 --env local --cleanup --verbose` parses correctly
- [x] Registry registers and retrieves scenarios
- [x] Dry run output contains scenario details, deliverables, and challenge queries

### Deviations
- None

---

## Task 1.5: Pytest Fixtures and Placeholder Story

**Status:** Complete
**Timestamp:** 2026-02-14T19:00:00
**Commit:** `c9301e2`

### What was implemented
- `conftest.py`: 4 pytest fixtures — `simulation_config` (session-scoped), `brainstormy_client` (async with preflight), `metrics_collector` (fresh per test), `simulation_project` (creates and tears down temp project)
- `stories/fantasy_ember.py`: Placeholder scenario with 1 session (3 natural-voice messages about fading magic, Elena the artificer, and ember lines), 1 challenge query, 1 bible deliverable. Auto-registers via `register_scenario()`.
- `PROGRESS.md`: Design decisions summary, prerequisites checklist, Phase 1-2 task tracking.

### Files created
- `tests/simulation/conftest.py` (57 lines)
- `tests/simulation/stories/fantasy_ember.py` (81 lines)
- `tests/simulation/PROGRESS.md`

### Validation results
- [x] `conftest.py` imports without errors
- [x] `python -m tests.simulation --list` shows fantasy_ember
- [x] `python -m tests.simulation --scenario fantasy_ember --dry-run` prints execution plan
- [x] fantasy_ember auto-discovered via pkgutil registry

### Deviations
- None

---

## End-to-End Summary

**Phase 1 complete.** All 5 tasks implemented and validated.

| Task | Files | Lines | Commit |
|------|-------|-------|--------|
| 1.1 | 11 files | 369 | `722564b` |
| 1.2 | 1 file | 367 | `fa52eb6` |
| 1.3 | 1 file | 197 | `6a98a9d` |
| 1.4 | 2 files | 566 | `39ac013` |
| 1.5 | 3 files | 172 | `c9301e2` |
| **Total** | **18 files** | **~1,671 lines** | |

### Known deviation from task list
- All modules use `from __future__ import annotations` for Python 3.9 compatibility (local env has 3.9.6 despite `.python-version` specifying 3.11.4)

### End-to-End Validation: Staging Run

**Status:** Complete (with known backend issues)
**Timestamp:** 2026-02-14T22:29:51 — 2026-02-14T22:33:20
**Run ID:** `fantasy_ember_15_20260214_222951_85e18c`

#### Auth approach
The test bypass auth (`X-Test-User-ID` header) requires `BRAINSTORMY_TEST_MODE=true` on the staging server, which is not enabled. Instead, we used **Clerk JWT auto-refresh** — a new auth mode added to the simulation framework:
- `BRAINSTORMY_CLERK_SESSION_ID` — an active Clerk session ID for the `qa-automation@brainstormy.co` user
- `CLERK_SECRET_KEY` — Clerk Backend API secret key
- The client calls `POST https://api.clerk.dev/v1/sessions/{id}/tokens` to generate a fresh JWT (~60s TTL) before each request when the current token is near expiry
- Added `_refresh_clerk_token()` and `_ensure_valid_token()` to `BrainstormyClient`
- Added `clerk_session_id` and `clerk_secret_key` fields to `SimulationConfig`

#### What worked
- [x] Clerk JWT auto-refresh: tokens refreshed automatically every ~50s throughout the 3.5-minute run
- [x] Project creation (`sim_20260214_222951_fantasy_ember`, is_series=True)
- [x] Story creation (Book 1: The Last Ember)
- [x] Navigator configuration (fantasy key)
- [x] All 3 messages sent and received successfully
- [x] Bible generation completed
- [x] Metrics saved to `results/fantasy_ember_15_20260214_222951_85e18c/metrics.json`

#### Results
| Metric | Value |
|--------|-------|
| Sessions | 1 |
| Messages sent | 3 |
| Messages received | 3 |
| Avg response time | 9,675 ms |
| P95 response time | 10,554 ms |
| Duration | 209.1s |
| Errors | 2 |
| Timeouts | 1 |

#### Backend bugs discovered
Two errors, both caused by the same backend bug in the `end_session` endpoint:

1. **`EndSessionResponse.summary_id` validation error (HTTP 400)**: The backend's Pydantic model `EndSessionResponse` declares `summary_id: str` (required), but the actual value is `None` when the response is serialized before summary generation completes. This should be `summary_id: str | None = None` in the backend model. Affects both the main session and challenge query sessions.

2. **Summary timeout (120s)**: Because `end_session` returned a 400 error, the summary generation may not have been triggered, so `wait_for_summary` polling never saw `has_summary: true`.

**Action item:** Fix `EndSessionResponse.summary_id` to be `Optional[str]` in the backend (`backend/routers/sessions.py` or `backend/schemas/sessions.py`).

#### Files modified for Clerk auto-refresh
- `tests/simulation/config.py` — added `clerk_session_id`, `clerk_secret_key` fields and env var loading
- `tests/simulation/api_client.py` — added `_refresh_clerk_token()`, `_ensure_valid_token()`, and `_TOKEN_REFRESH_MARGIN`
