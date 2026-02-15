# User Simulation Framework — Phase 1 Implementation Tasks

## Overview

This task list implements Phase 1 (Foundation) from `user-simulation-spec.md`. Phase 1 creates the infrastructure that all subsequent phases build on: project structure, API client, metrics collection, CLI runner, and pytest fixtures.

**Reference specs (all in `brainstormy-FMA-MVP/docs/`):**
- `user-simulation-spec.md` — Parts 1, 3, 4, 6 (architecture, API client, metrics, runner), Part 11 (resolved design decisions)
- `user-simulation-tasks.md` — Phase 1 task descriptions
- `api-spec.md` — REST endpoint details (NOTE: some paths/fields are stale — use the endpoint table in this doc which was verified against actual backend code)
- `docs/session-modes/focus-mode-spec.md` — Session guidance_mode/template DB columns; `explore` and `focus` naming
- `guidance-suite-spec.md` — Navigator configuration API (`PUT /stories/{id}/navigator`) and genre key definitions
- `brainstormy-testing-framework-tasks.md` — Task 1.4b for test auth bypass pattern (`X-Test-User-ID` header)
- QA Engine's Clerk auth implementation — reference for sign-in token approach (in qa-engine repo, not docs)

**Timeline:** 3-4 days
**Repository:** `brainstormy-FMA-MVP` (NOT `qa-engine`)
**Existing test infra:** `tests/framework/` has evaluators (citation, consistency, fact_checker) and API executor that may be reusable in Phase 2+
**Location:** `tests/simulation/` (repo root, not inside `backend/`)
**Git:** Push after completing each task. Write progress to `tests/simulation/PROGRESS.md`.

---

## Prerequisites

Before starting, verify:
- [ ] Brainstormy staging environment is running at `brainstormy-frontend-staging.onrender.com`
- [ ] A Clerk test user exists for simulation (or create one)
- [ ] You can obtain a valid Clerk session token for that user
- [ ] The test user has a valid OpenRouter API key configured in their Brainstormy settings
- [ ] `httpx`, `pytest-asyncio`, and `anthropic` are in the project's Python dependencies

**First action:** Run `curl -s https://brainstormy-backend-staging.onrender.com/api/projects -H "X-Test-User-ID: $BRAINSTORMY_SIM_USER_ID" | head` to verify staging is reachable and test auth bypass works. Requires `BRAINSTORMY_TEST_MODE=true` on staging.

---

## Implementation Notes

### Auth Strategy

**Primary: Test auth bypass (for both local and staging).** The test auth middleware (`backend/middleware/test_auth.py`) is the most practical approach. The QA Engine's Clerk flow produces browser cookies, not bearer tokens for direct `httpx` API calls, making Clerk auth complex for API-level simulation.

Requirements:
- Set env var `BRAINSTORMY_TEST_MODE=true` on the target environment (NOT `TEST_MODE`)
- Create a test user in the database with `auth_provider_id` starting with `test_framework_` prefix (regular Clerk users won't work)
- Send `X-Test-User-ID: <user_id>` header on all requests
- The test user must have a valid OpenRouter API key configured in Brainstormy settings

**Fallback: Clerk session JWT.** If test bypass cannot be enabled on staging, extract a Clerk JWT via the sign-in token flow. This requires additional research — the QA Engine's `_clerkApiRequest()` is browser-oriented.

### Naming Conventions

- Session guidance modes: `explore` or `focus` (NOT `develop` — renamed per `focus-mode-spec.md`)
- Focus templates: `character`, `plot`, `scene`, `world`, `logline`, `dialogue`, `outline_section` (plus workshop-specific: `workshop_theme`, `workshop_act`, `workshop_sequence`, `workshop_scene`, `workshop_beat`, `workshop_structure`)
- Project name format: `sim_{YYYYMMDD}_{HHMMSS}_{scenario_id}`

### Session Creation — Confirmed Parameters

**Confirmed:** `POST /api/stories/{story_id}/sessions` accepts `guidance_mode` and `template` in the request body. Valid `guidance_mode` values: `explore`, `focus`. Additional useful parameters: `focus_target_name` (character name for character-focused sessions), `custom_focus_id`, `parent_session_id`.

**Important: Omit None values from request body.** The API validates that `focus_target_name` must NOT be set when `guidance_mode='explore'`. The client should build the request body dynamically, excluding None fields:
```python
body = {"name": name, "guidance_mode": guidance_mode}
if description is not None: body["description"] = description
if template is not None: body["template"] = template
if focus_target_name is not None: body["focus_target_name"] = focus_target_name
```

### Navigator Configuration

Each scenario specifies a `navigator_key` for genre-appropriate AI responses. After creating a story, the runner must call `PUT /api/stories/{story_id}/navigator` with the genre key. Without this, AI responses default to `general_editorial` guidance, reducing genre authenticity. Valid keys (defined as TOML files in `backend/config/navigators/fiction/`): `general_editorial`, `fantasy`, `historical`, `horror`, `literary`, `middle_grade`, `mystery`, `romance`, `science_fiction`, `thriller`, `young_adult`.

### send_message Returns Synchronously

`POST /api/sessions/{session_id}/messages` returns both `user_message` and `assistant_message` (with `citations` map) in a single synchronous response. No separate wait-for-response logic is needed. Response timing measures the full round-trip (user message → context assembly → LLM call → response).

### API Response Format

Core API endpoints return **flat JSON responses** — no `{"data": {...}}` wrapper. The client should return response JSON directly. Do NOT implement automatic envelope unwrapping (it will break deserialization). Only some auxiliary endpoints (captures, labels, snapshots) use an envelope, but the simulation does not call those.

---

## Task 1.1: Project Structure and Configuration (~2 hours)

### Task 1.1.1: Create Directory Structure

**Create:**
```
tests/simulation/
├── __init__.py
├── __main__.py          # Enables `python -m tests.simulation`
├── config.py
├── models.py            # Shared dataclasses
├── registry.py          # Scenario registration (see note below)
├── api_client.py
├── metrics.py
├── screenshot.py        # Stub for Phase 3
├── runner.py
├── stories/
│   └── __init__.py
├── evaluators/
│   └── __init__.py
├── reports/
│   └── __init__.py
├── results/             # gitignored
│   └── .gitkeep
├── screenshots/         # gitignored
│   └── .gitkeep
├── conftest.py
└── PROGRESS.md
```

**Why `registry.py`:** The scenario registry (where story modules register themselves) must be in its own module, NOT in `runner.py`. This avoids the Python `__main__` module identity problem: when running `python -m tests.simulation.runner`, Python creates a `__main__` module, and story modules importing from `tests.simulation.runner` would get a different module object. Putting the registry in `registry.py` ensures story modules and the runner share the same dict.

**`__main__.py` contents:**
```python
"""Allow running as: python -m tests.simulation"""
from .runner import main
main()
```

**`.gitignore` for `tests/simulation/`:**
```
results/
screenshots/
!results/.gitkeep
!screenshots/.gitkeep
```

### Task 1.1.2: Create `config.py`

**File:** `tests/simulation/config.py`

**Define these structures:**

```python
@dataclass(frozen=True)
class EnvironmentConfig:
    name: str                           # 'staging' or 'local'
    api_base_url: str                   # Backend API URL
    frontend_url: str                   # Frontend URL (for screenshots)
    auth_method: str                    # 'clerk_session' or 'test_bypass'

ENVIRONMENTS = {
    'staging': EnvironmentConfig(
        name='staging',
        api_base_url='https://brainstormy-backend-staging.onrender.com',
        frontend_url='https://brainstormy-frontend-staging.onrender.com',
        auth_method='test_bypass',  # Test bypass recommended for staging too
    ),
    'local': EnvironmentConfig(
        name='local',
        api_base_url='http://localhost:8000',
        frontend_url='http://localhost:3000',
        auth_method='test_bypass',
    ),
}

@dataclass(frozen=True)
class PacingConfig:
    message_delay_min: float = 2.0
    message_delay_max: float = 5.0
    session_delay_min: float = 5.0
    session_delay_max: float = 10.0
    summary_poll_interval: float = 2.0
    summary_poll_max_interval: float = 10.0
    summary_timeout: float = 120.0
    deliverable_timeout: float = 180.0

@dataclass(frozen=True)
class RetryConfig:
    max_retries: int = 3
    retry_delay_base: float = 2.0
    retry_delay_max: float = 30.0
    retryable_status_codes: tuple[int, ...] = (429, 502, 503, 504)

@dataclass(frozen=True)
class EvaluationConfig:
    model: str = 'claude-sonnet-4-5-20250929'
    max_tokens: int = 2048
    temperature: float = 0.0

@dataclass
class SimulationConfig:
    environment: EnvironmentConfig
    pacing: PacingConfig
    retry: RetryConfig
    evaluation: EvaluationConfig
    test_user_id: str | None              # From BRAINSTORMY_SIM_USER_ID env var (test bypass)
    clerk_session_token: str | None       # From BRAINSTORMY_SIM_AUTH_TOKEN env var (Clerk fallback)
    anthropic_api_key: str | None         # From ANTHROPIC_API_KEY env var
    capture_screenshots: bool = True
    cleanup_after_run: bool = False
    dry_run: bool = False
```

**`SimulationConfig.load(env_name)` class method:**
- Read env vars: `BRAINSTORMY_SIM_USER_ID`, `BRAINSTORMY_SIM_AUTH_TOKEN`, `BRAINSTORMY_TEST_MODE`, `ANTHROPIC_API_KEY`, `BRAINSTORMY_SIM_ENV`
- `BRAINSTORMY_SIM_ENV` overrides the `env_name` parameter

**`SimulationConfig.validate()` method:**
- Returns `list[str]` of issues (empty = valid)
- Check: requires `BRAINSTORMY_SIM_USER_ID` (for test bypass) or `BRAINSTORMY_SIM_AUTH_TOKEN` (for Clerk fallback)
- Check: `ANTHROPIC_API_KEY` required for LLM evaluation
- Add `validate_or_raise()` convenience method
- Twilio env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_NOTIFY_NUMBERS`) are optional — if absent, skip WhatsApp notification

**Constants:**
```python
SIMULATION_ROOT = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(SIMULATION_ROOT, 'results')
SCREENSHOTS_DIR = os.path.join(SIMULATION_ROOT, 'screenshots')
```

### Task 1.1.3: Create `models.py`

**File:** `tests/simulation/models.py`

Implement all shared dataclasses from spec Part 2.2:

- `SessionScript` — name, guidance_mode, messages, expected_facts (required); description, template, focus_target_name, screenshot_moments (optional, all default to None/[])
- `ChallengeQuery` — query, established_in_session, expected_facts, query_type
- `DeliverableRequest` — type ('bible'/'report'), template_id, parameters, anchor_id, trigger_after_session
- `GeneratedSessionOutline` — for tiers 50/100 (name, guidance_mode, template, topic, facts_to_establish, builds_on_sessions, message_count, writer_notes)
- `StoryScenario` — id, name, genre, description, project_name, story_name, navigator_key, sessions, challenge_queries, deliverables, tier_50_outlines, tier_100_outlines
- `RetentionResult` — query, query_type, established_in_session, facts_present, facts_missing, contradictions, score, raw_evaluation
- `CitationResult` — deliverable_type, template_id, total_citations, valid_citations, invalid_citations, unsupported_claims, accuracy, hallucination_rate, details
- `RunMetrics` — all fields from spec Part 4.1

**`StoryScenario.get_sessions_for_tier(tier)`:**
- Simply `return self.sessions[:tier]` for all tiers (matches spec). Tiers 50/100 will have more sessions added by the LLM generation step before this is called.

**`RunMetrics` must include:**
- Computed properties: `avg_response_time_ms`, `p95_response_time_ms`, `max_response_time_ms`, `duration_seconds`
- `to_dict()` → JSON-serializable dict (convert datetimes to ISO strings)
- `save(filepath)` → write JSON to file (create parent dirs)
- `load(filepath)` → classmethod, read JSON and reconstruct (parse ISO strings back to datetimes)

### Task 1.1.4: Create `screenshot.py` Stub

**File:** `tests/simulation/screenshot.py`

Create the `ScreenshotCapture` class with all method signatures from spec Part 5.2 but no implementation — each method logs a debug message and returns `None`. This lets the runner reference screenshots without Phase 3 being built.

**Methods to stub:**
- `initialize()`, `cleanup()`
- `capture_project_overview(project_id)`
- `capture_session_chat(session_id, scroll_to='bottom')`
- `capture_story_bible(story_id, template_id)`
- `capture_report(report_id)`
- `capture_session_list(story_id)`
- `capture_search_results(story_id, query)`
- `capture_walkthrough_sequence(story_id)`

**Validation:**
- [ ] All modules import without errors
- [ ] `SimulationConfig.load('staging')` works
- [ ] `SimulationConfig.load('local')` works
- [ ] `SimulationConfig.load('production')` raises ValueError
- [ ] `RunMetrics` round-trips through JSON save/load
- [ ] `StoryScenario.get_sessions_for_tier(15)` returns correct slice

---

## Task 1.2: API Client (~4 hours)

**File:** `tests/simulation/api_client.py`

### Task 1.2.1: BrainstormyClient Class

Implement async HTTP client wrapping Brainstormy's REST API.

**Constructor:**
```python
class BrainstormyClient:
    def __init__(self, base_url: str, auth_headers: dict,
                 retry_config: RetryConfig | None = None, timeout: float = 300.0):
```

**Context manager:** `async with BrainstormyClient(...) as client:` — creates/closes `httpx.AsyncClient`.

**`from_config(config: SimulationConfig)` classmethod** — construct from config, building auth headers:
```python
@classmethod
def from_config(cls, config: SimulationConfig) -> 'BrainstormyClient':
    if config.test_user_id:
        # Test bypass — no Authorization header needed
        auth_headers = {"X-Test-User-ID": config.test_user_id}
    elif config.clerk_session_token:
        auth_headers = {"Authorization": f"Bearer {config.clerk_session_token}"}
    else:
        raise ValueError("No auth configured: need test_user_id or clerk_session_token")
    return cls(config.environment.api_base_url, auth_headers, config.retry)
```

**Internal `_request(method, path, json, params)` method:**
- Prepend `/api` to path
- Include `self.auth_headers` on every request (set in constructor)
- Retry on status codes in `retry_config.retryable_status_codes` with exponential backoff
- Retry on `httpx.TimeoutException` and `httpx.ConnectError`
- Log all requests: method, url, status code, elapsed ms (use `logging` module)
- Return response JSON directly (core API responses are flat, no envelope)
- Raise `BrainstormyAPIError(status_code, detail, url)` on non-retryable errors

**Convenience wrappers:** `_get(path, params)`, `_post(path, json)`, `_delete(path)`

### Task 1.2.2: Endpoint Methods

Implement all endpoint methods. Verified against actual backend code:

| Method | HTTP | Path | Notes |
|--------|------|------|-------|
| `create_project(name, description=None, medium='novel', is_series=True)` | POST | `/projects` | `is_series=True` prevents auto-creation of story+session |
| `get_project(project_id)` | GET | `/projects/{id}` | |
| `list_projects()` | GET | `/projects` | Returns list |
| `delete_project(project_id)` | DELETE | `/projects/{id}` | Cascade deletes all children |
| `create_story(project_id, name, description=None)` | POST | `/projects/{id}/stories` | Nested under project |
| `get_story(story_id)` | GET | `/stories/{id}` | |
| `list_stories(project_id)` | GET | `/projects/{id}/stories` | |
| `delete_story(story_id)` | DELETE | `/stories/{id}` | |
| `configure_navigator(story_id, primary_key, ...)` | PUT | `/stories/{id}/navigator` | Genre-specific AI guidance |
| `create_session(story_id, name, ..., guidance_mode, template, focus_target_name)` | POST | `/stories/{id}/sessions` | **Confirmed:** accepts guidance_mode + template |
| `get_session(session_id)` | GET | `/sessions/{id}` | Does NOT include has_summary |
| `get_session_status(session_id)` | GET | `/sessions/{id}/status` | **Includes has_summary** |
| `list_sessions(story_id)` | GET | `/stories/{id}/sessions` | Also includes has_summary per session |
| `end_session(session_id)` | POST | `/sessions/{id}/end` | Triggers async summary generation |
| `delete_session(session_id)` | DELETE | `/sessions/{id}` | |
| `send_message(session_id, content)` | POST | `/sessions/{id}/messages` | Returns user_message + assistant_message + citation_map synchronously |
| `get_messages(session_id, limit=50, offset=0)` | GET | `/sessions/{id}/messages` | limit: 1-200, offset available |
| `generate_bible(story_id, template_id)` | POST | `/stories/{id}/bibles` | Field is **template_id** not template_key. Optional: character_anchors |
| `get_bible(story_id, template_id)` | GET | `/stories/{id}/bibles/current?template_id=...` | **Query param**, not path segment |
| `generate_report(story_id, report_type, parameters=None, anchor_id=None)` | POST | `/stories/{id}/reports` | Param `report_type` maps to API field `type` (avoids shadowing builtin). `parameters` required for `character_profile`: `{"character_name": "..."}` |
| `get_report(report_id)` | GET | `/reports/{id}` | |
| `list_reports(story_id)` | GET | `/stories/{id}/reports` | |
| `search(story_id, query, types='messages,summaries,bookmarks')` | **GET** | `/stories/{id}/search?q=...&types=...` | **GET with query params**, returns `{messages, summaries, bookmarks}` |
| `create_bookmark(session_id, message_id, user_title, category=None)` | POST | `/sessions/{id}/messages/{id}/bookmark` | **Path uses session_id + message_id**, not story_id |
| `list_bookmarks(story_id, category=None)` | GET | `/stories/{id}/bookmarks` | |
| `get_summary(session_id)` | GET | `/sessions/{id}/summary` | |

**Response format:** Core API responses are **flat JSON** — no `{"data": {...}}` wrapper. Do not implement envelope unwrapping.

### Task 1.2.3: `wait_for_summary()` Helper

```python
async def wait_for_summary(self, session_id: str,
                            poll_interval: float = 2.0,
                            max_interval: float = 10.0,
                            timeout: float = 120.0) -> dict:
```

- Poll `get_session_status(session_id)` checking `has_summary` field (NOT `get_session()` — that endpoint doesn't return `has_summary`)
- Exponential backoff: start at `poll_interval`, multiply by 1.5 each iteration, cap at `max_interval`
- On timeout: raise `TimeoutError` (caller decides how to handle)
- Return the session dict once summary is ready

### Task 1.2.4: `preflight_check()` Method

```python
async def preflight_check(self) -> dict[str, Any]:
```

Returns a dict with at minimum:
- `api_reachable: bool` — can reach the API at all
- `auth_valid: bool` — auth token accepted (200 on list projects, not 401)
- `can_list_projects: bool`

This is called before starting a long simulation run. If auth is invalid, the runner aborts early with a clear error.

**Validation:**
- [ ] Client can create a project on staging
- [ ] Client can create a story within that project
- [ ] Client can create a session (explore mode)
- [ ] Client can send a message and receive an AI response
- [ ] Client can end a session
- [ ] `wait_for_summary()` detects summary completion
- [ ] Client can generate a bible (standard template)
- [ ] Client can search story content
- [ ] Retry logic handles 503 (simulate with staging cold start)
- [ ] `preflight_check()` returns correct status
- [ ] Clean up: delete test project after validation

---

## Task 1.3: Metrics Collector (~3 hours)

**File:** `tests/simulation/metrics.py`

### Task 1.3.1: MetricsCollector Class

```python
class MetricsCollector:
    def __init__(self, scenario_id: str, tier: int, environment: str = 'staging',
                 run_id: str | None = None):
```

**Auto-generated `run_id`:** `{scenario_id}_{tier}_{YYYYMMDD}_{HHMMSS}_{6-char-hex}`

**Methods:**

| Method | Purpose |
|--------|---------|
| `start()` | Record start timestamp |
| `complete()` | Record completion timestamp |
| `async timed(label, coro_func, *args, **kwargs)` | Execute async function, record elapsed time, return result |
| `record_message_sent()` | Increment sent counter |
| `record_message_received()` | Increment received counter |
| `record_session_complete(session_index, message_count, session_id)` | Track session progress |
| `record_summary_time(elapsed_seconds)` | Record summary generation time |
| `record_error(operation, error)` | Store error details |
| `record_timeout()` | Increment timeout counter |
| `set_resource_ids(project_id, story_id)` | Store created resource IDs |
| `compile(retention_results, citation_results) → RunMetrics` | Aggregate everything |

**`timed()` details:**
- Wraps any async function with `time.monotonic()` timing
- Records both successful and failed calls (with `success: bool` flag)
- On failure, records the timing AND re-raises the exception
- All timings stored in internal list with label, elapsed_ms, timestamp, success

**`compile()` details:**
- Calls `complete()` if not already called
- Creates `RunMetrics` with all collected data
- For `response_times_ms`, only include timings where `label == 'send_message'` and `success == True`
- For retention: average scores, count contradictions, compute `consistency_score = max(0, 1.0 - contradiction_count * 0.1)`
- For citations: sum valid/invalid/unsupported across all deliverables, compute accuracy and hallucination rate

**Validation:**
- [ ] `timed()` correctly measures elapsed time on an async function
- [ ] `timed()` records error timings and re-raises
- [ ] `compile()` produces valid `RunMetrics` from recorded data
- [ ] `compile()` with retention results correctly averages scores
- [ ] `compile()` with citation results correctly computes accuracy
- [ ] JSON serialization round-trips through `RunMetrics.save()` / `RunMetrics.load()`

---

## Task 1.4: Basic CLI Runner (~2 hours)

### Task 1.4.1: Scenario Registry

**File:** `tests/simulation/registry.py`

```python
_SCENARIO_REGISTRY: dict[str, StoryScenario] = {}
_stories_imported: bool = False

def register_scenario(scenario: StoryScenario) -> None:
    """Called by story modules at import time."""

def get_scenario(scenario_id: str) -> StoryScenario:
    """Look up by ID. Triggers _ensure_stories_imported(). Raises KeyError if not found."""

def list_scenarios() -> list[StoryScenario]:
    """Returns all registered scenarios. Triggers _ensure_stories_imported()."""

def _ensure_stories_imported() -> None:
    """Import all modules in tests/simulation/stories/ to trigger registration.
    Uses pkgutil.walk_packages(). Only runs once (guard with _stories_imported flag)."""
```

### Task 1.4.2: SimulationRunner Class

**File:** `tests/simulation/runner.py`

```python
class SimulationRunner:
    def __init__(self, client: BrainstormyClient, scenario: StoryScenario,
                 config: SimulationConfig, tier: int = 15):

    async def run(self) -> RunMetrics:
        """Full simulation: setup → sessions → deliverables → challenges → compile"""
```

**`run()` flow:**

1. **Setup** — `_setup()`:
   - Create project with name `sim_{timestamp}_{scenario.id}` and `is_series=true` (prevents auto-creation of story+session)
   - Create story within project
   - Configure Navigator: `configure_navigator(story_id, scenario.navigator_key)` if not `general_editorial`
   - Store IDs in metrics via `set_resource_ids()`

2. **Session loop** — `_run_session(story_id, script, session_index)` for each script in scenario:
   - `create_session()` with script's name, description, guidance_mode, template, and focus_target_name (all confirmed accepted by API)
   - For each message in script: `send_message()` wrapped in `metrics.timed("send_message", ...)`
   - Record sent/received counts
   - Pace between messages: `asyncio.sleep(random.uniform(pacing.message_delay_min, max))`
   - After all messages: `end_session()` then `wait_for_summary()`
   - Record summary time
   - Handle errors gracefully: log and continue, don't abort the run
   - Handle 409 from end_session (session already has summary): log and continue
   - Pace between sessions: `asyncio.sleep(random.uniform(pacing.session_delay_min, max))`

3. **Deliverables** — `_generate_deliverable(story_id, deliverable)`:
   - For `type == 'bible'`: call `generate_bible(story_id, deliverable.template_id)`
   - For `type == 'report'`: call `generate_report(story_id, deliverable.template_id, parameters=deliverable.parameters, anchor_id=deliverable.anchor_id)`
   - Bible/report generation is synchronous (LLM call within HTTP request) — no polling needed, just set a 180s request timeout
   - Wrap in `metrics.timed()`
   - Handle errors: log and continue

4. **Challenge queries** — `_run_challenge_queries(story_id)`:
   - For each challenge query, create a **separate** dedicated session: `[Recall Test] {query.query_type}`
   - Send the query as a message, record AI response
   - End session (no need to wait for summary — not measured)
   - Return list of `RetentionResult` (placeholder scores — Phase 2 evaluators will properly score these)
   - One session per query prevents earlier answers from contaminating later queries

5. **Compile** — `metrics.compile(retention_results)` and return

**Error handling philosophy:** Individual message/session failures should be recorded in metrics but NOT abort the run. The runner should be resilient — if session 7 fails, continue with session 8.

### Task 1.4.3: CLI Entry Point

**File:** `tests/simulation/runner.py` (bottom of file)

```python
def build_parser() -> argparse.ArgumentParser:
def print_dry_run(scenario, tier, env):
async def run_cli(args) -> int:
def main():

if __name__ == '__main__':
    main()
```

**CLI flags:**
- `--scenario <id>` — Scenario ID to run
- `--all` — Run all registered scenarios
- `--list` — List available scenarios and exit
- `--tier {15,50,100}` — Scale tier (default: 15)
- `--env {staging,local}` — Target environment (default: staging)
- `--dry-run` — Print execution plan without running
- `--no-screenshots` — Skip screenshot capture
- `--cleanup` — Delete simulation project after run
- `--verbose / -v` — Enable debug logging

**`print_dry_run()` output:**
```
============================================================
DRY RUN — Simulation Plan
============================================================
  Scenario:     The Last Ember (fantasy_ember)
  Genre:        fantasy
  Tier:         15
  Environment:  staging
  Sessions:     15
  Total msgs:   52
  Deliverables: 5
  Challenges:   5

Session Plan:
   1. Initial Premise Brainstorm               [explore] (3 msgs)
   2. Elena — Who Is She?                      [explore] (4 msgs)
   ...

Deliverables:
  • bible/standard — at end
  • report/character_profile ({'character_name': 'Elena'}) — after session 10
  ...

Challenge Queries (5):
  • [direct_recall] What is Elena's relationship to her grandfather?
  ...
============================================================
```

**`run_cli()` flow:**
1. Parse args
2. Handle `--list` → print scenarios, return
3. Handle `--dry-run` → print plan, return
4. Load config, validate
5. For each scenario: create client, preflight check, run simulation, save metrics
6. If `--cleanup`: delete project
7. Print summary

**Logging config:**
- Default: INFO level
- With `--verbose`: DEBUG level
- Quiet httpx/httpcore loggers unless verbose

### Task 1.4.4: WhatsApp Notification on Completion

Per spec Part 11 (decision #3), the runner should send a WhatsApp notification when a simulation run completes. This uses the same Twilio integration as the QA Engine.

**Implementation pattern:** Follow `backend/services/whatsapp.py` which uses raw `httpx` calls to the Twilio REST API. Do NOT add the `twilio` Python package (it's not in requirements.txt).

**Notification content:**
```
🐻 Simulation Complete
Scenario: The Last Ember (fantasy_ember)
Tier: 15 | Env: staging
Status: ✅ PASS
Retention: 92% | Citations: 94%
Duration: 18m 42s
Run ID: fantasy_ember_15_20260214_143022_a1b2c3
```

**Implementation:**
- Add optional `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_NOTIFY_NUMBERS` to `SimulationConfig`
- If Twilio credentials are present, send notification after `metrics.compile()` completes
- If credentials are missing, skip silently (notification is optional)
- Send on both success and failure (failure notification includes error summary)
- Use raw `httpx` calls to Twilio REST API (matching `backend/services/whatsapp.py` pattern)

**Validation (WhatsApp):**
- [ ] Notification sends when Twilio credentials are configured
- [ ] Runner completes normally when Twilio credentials are absent (no error)
- [ ] Notification content includes scenario name, tier, status, scores, duration

**Validation (CLI):**
- [ ] `--list` shows registered scenarios
- [ ] `--dry-run` prints readable execution plan
- [ ] `--scenario fantasy_ember --tier 15` parses correctly
- [ ] `--all --tier 50 --env local --cleanup --verbose` parses correctly
- [ ] Runner skeleton can create a project on staging via CLI (with `--no-screenshots`)
- [ ] Exit code 0 on success, 1 on failure

---

## Task 1.5: Pytest Fixtures and Placeholder Story (~1 hour)

### Task 1.5.1: Conftest Fixtures

**File:** `tests/simulation/conftest.py`

**Fixtures:**

```python
def pytest_addoption(parser):
    parser.addoption('--sim-env', default='staging', choices=['staging', 'local'])
    parser.addoption('--sim-tier', default=15, type=int)

@pytest.fixture(scope='session')
def simulation_config(request) -> SimulationConfig:
    """Load config. Skip if credentials missing."""

@pytest_asyncio.fixture
async def brainstormy_client(simulation_config) -> BrainstormyClient:
    """Authenticated client. Skip if API unreachable."""

@pytest.fixture
def metrics_collector() -> MetricsCollector:
    """Fresh collector for tests."""

@pytest_asyncio.fixture
async def simulation_project(brainstormy_client) -> dict:
    """Create temp project, yield, then delete on teardown."""
```

### Task 1.5.2: Placeholder Fantasy Ember Scenario

**File:** `tests/simulation/stories/fantasy_ember.py`

Create a minimal placeholder scenario with 1 session and 3 messages — enough to validate the runner end-to-end. The full 15-session scenario is Phase 2, Task 2.1.

```python
from ..models import StoryScenario, SessionScript, ChallengeQuery, DeliverableRequest
from ..registry import register_scenario

FANTASY_EMBER_PLACEHOLDER = StoryScenario(
    id='fantasy_ember',
    name='The Last Ember',
    genre='fantasy',
    description='In a world where magical ability is fading...',
    project_name='The Last Ember',
    story_name='Book 1: The Last Ember',
    navigator_key='fantasy',
    sessions=[
        SessionScript(
            name='Initial Premise Brainstorm',
            guidance_mode='explore',
            messages=[
                "I've been thinking about this concept — what if magic is dying? ...",
                "Yeah, I think the world should feel like it's in this twilight period...",
                "I like the idea that the magic is tied to the land somehow...",
            ],
            expected_facts=[
                'Magic is fading/declining generation by generation',
                'Protagonist is a young woman artificer',
                'Magic is tied to ember lines in the land',
            ],
            description='Exploring the core concept and world',
            screenshot_moments=['after_session'],
        ),
    ],
    challenge_queries=[
        ChallengeQuery(
            query='What is the core concept of the magic system in this story?',
            established_in_session=0,
            expected_facts=['Magic is fading over generations', 'Connected to ember lines'],
            query_type='direct_recall',
        ),
    ],
    deliverables=[
        DeliverableRequest(type='bible', template_id='standard', trigger_after_session=-1),
    ],
)

register_scenario(FANTASY_EMBER_PLACEHOLDER)
```

**Important:** The messages should be fleshed out to sound like a real writer — don't use the truncated "..." versions. Write 2-3 sentences per message that feel natural per spec Part 2.4 guidelines.

### Task 1.5.3: PROGRESS.md

**File:** `tests/simulation/PROGRESS.md`

Create the progress tracking file with:
- Resolved design decisions summary (from spec Part 11)
- Phase 1 task checklist (mark each task as complete)
- Prerequisites section (document the manual setup steps for the simulation user)

**Validation:**
- [ ] `pytest tests/simulation/conftest.py` imports without errors
- [ ] `python -m tests.simulation --list` shows fantasy_ember
- [ ] `python -m tests.simulation --scenario fantasy_ember --dry-run` prints execution plan
- [ ] Fixtures initialize (skipping if credentials not available is OK)

---

## End-to-End Validation (after all tasks)

Run this sequence to confirm Phase 1 is working:

```bash
# 1. List scenarios
python -m tests.simulation --list

# 2. Dry run
python -m tests.simulation --scenario fantasy_ember --tier 15 --dry-run

# 3. Preflight check + 1-session run (no screenshots)
python -m tests.simulation --scenario fantasy_ember --tier 15 --env staging --no-screenshots --verbose

# 4. Verify output
cat tests/simulation/results/*/metrics.json | python -m json.tool | head -30
```

**Phase 1 is complete when:**
- [ ] CLI lists scenarios, dry-run prints plan
- [ ] Can create project and story on staging via API client
- [ ] Can send messages and receive AI responses
- [ ] Session end + summary wait works
- [ ] Timing metrics collected for all API calls
- [ ] Metrics saved as JSON with run ID
- [ ] `--cleanup` deletes the project after run
- [ ] Errors are recorded but don't abort the simulation

**Phase 1 milestone:** Can create a project, run 1 session (3 messages), end it, wait for summary, generate a bible, send a challenge query, and save timing metrics — all via CLI.
