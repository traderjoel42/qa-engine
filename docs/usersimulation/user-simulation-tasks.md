# User Simulation Framework — Implementation Tasks

## Prerequisites

- Brainstormy staging environment running and accessible
- Clerk test user configured for simulation
- OpenRouter API key available for test user
- Python 3.11+ with pytest-asyncio, httpx, playwright installed
- Claude API key for LLM-based evaluation

---

## Phase 1: Foundation (3-4 days)

### Task 1.1: Project Structure and Configuration (~2 hours)

**Create directory structure:**
```
tests/simulation/
├── __init__.py
├── runner.py
├── api_client.py
├── metrics.py
├── screenshot.py
├── config.py
├── stories/
│   └── __init__.py
├── evaluators/
│   └── __init__.py
├── reports/
│   └── __init__.py
├── results/           # gitignored, stores run output
├── screenshots/       # gitignored, stores captured images
└── conftest.py
```

**config.py contents:**
- Environment definitions (local, staging)
- Base URLs, auth methods
- Timeout defaults
- Pacing defaults (message delay, session delay)
- LLM evaluation model config

**Dependencies to add to requirements or pyproject.toml:**
- `httpx` (likely already present)
- `playwright` (likely already present from QA Engine)
- `anthropic` (for LLM evaluation)
- `pytest-asyncio`

**Validation:**
- [ ] Directory structure created
- [ ] Config loads without errors
- [ ] Can import from `tests.simulation`

---

### Task 1.2: API Client (~4 hours)

**File:** `tests/simulation/api_client.py`

**Implement `BrainstormyClient` class with methods:**
- `create_project(name, description)` → POST /api/projects
- `create_story(project_id, name, description)` → POST /api/projects/{id}/stories
- `create_session(story_id, name, guidance_mode, template)` → POST /api/stories/{id}/sessions
- `send_message(session_id, content)` → POST /api/sessions/{id}/messages
- `get_messages(session_id)` → GET /api/sessions/{id}/messages
- `end_session(session_id)` → POST /api/sessions/{id}/end
- `generate_bible(story_id, template_key)` → POST /api/stories/{id}/bibles
- `get_bible(story_id, template_key)` → GET /api/stories/{id}/bibles/{key}
- `generate_report(story_id, report_type, parameters)` → POST /api/stories/{id}/reports
- `get_report(report_id)` → GET /api/reports/{id}
- `search(story_id, query, limit)` → POST /api/stories/{id}/search
- `create_bookmark(story_id, message_id, title, category)` → POST /api/stories/{id}/bookmarks/message

**Authentication:**
- Accept auth token in constructor
- Include as Bearer token in all requests
- Implement Clerk session token acquisition helper

**Error handling:**
- Retry on 429 (rate limit) with exponential backoff
- Retry on 503 (service unavailable) — Render cold starts
- Raise on 4xx/5xx after retries exhausted
- Log all requests/responses for debugging

**Validation:**
- [ ] Can create project on staging
- [ ] Can send message and receive AI response
- [ ] Can generate bible
- [ ] Auth token works with Clerk
- [ ] Retries work on simulated failures

---

### Task 1.3: Metrics Collector (~3 hours)

**File:** `tests/simulation/metrics.py`

**Implement `MetricsCollector` class:**
- `timed(method, *args)` — Wraps any async call with timing
- `record_response_time(method_name, elapsed_ms)` — Store timing data
- `record_error(method_name, error)` — Store error data
- `record_session_complete(session_index, message_count)` — Track session progress
- `compile(retention_results, citation_results) -> RunMetrics` — Aggregate all metrics

**Implement `RunMetrics` dataclass:**
- All fields per spec Part 4.1
- `to_dict()` method for JSON serialization
- `save(filepath)` method for persistence

**Validation:**
- [ ] Timing wrapper correctly measures elapsed time
- [ ] Metrics compile into expected structure
- [ ] Can save/load metrics as JSON

---

### Task 1.4: Basic CLI Runner (~2 hours)

**File:** `tests/simulation/runner.py`

**Implement `SimulationRunner` class (skeleton):**
- Constructor accepts client, scenario, options
- `run()` method orchestrates: setup → sessions → deliverables → queries → screenshots → metrics
- Session loop sends messages with pacing delays
- Handles session end + summary wait (poll for `has_summary: true`)

**CLI entry point:**
```bash
python -m tests.simulation.runner --scenario <id> --tier <15|50|100> --env <local|staging>
```

**Flags:**
- `--scenario` — Scenario ID (required)
- `--tier` — Scale tier (default: 15)
- `--env` — Environment (default: staging)
- `--screenshots-only` — Skip metrics evaluation
- `--no-screenshots` — Skip screenshot capture
- `--dry-run` — Print plan without executing

**Validation:**
- [ ] CLI parses arguments correctly
- [ ] Dry run prints execution plan
- [ ] Can run skeleton against staging (creates project, no sessions yet)

---

### Task 1.5: Pytest Fixtures (~1 hour)

**File:** `tests/simulation/conftest.py`

**Fixtures:**
- `simulation_config` — Load config for current environment
- `brainstormy_client` — Authenticated BrainstormyClient
- `metrics_collector` — Fresh MetricsCollector
- `screenshot_capture` — ScreenshotCapture (if not headless-only)

**Validation:**
- [ ] Fixtures initialize without errors
- [ ] Client fixture can reach staging API

---

## Phase 2: First Story — "The Last Ember" Tier 15 (3-4 days)

### Task 2.1: Author Session Scripts (~6 hours)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Author 15 SessionScript objects** per spec Part 2.3, Scenario 1. Each session needs:
- Session name and description
- Guidance mode and template
- 3-6 user messages written in natural writer voice
- Expected facts list
- Screenshot moments

**Writing quality bar:** Each message should pass the "would a real writer type this?" test. Follow message authoring guidelines from spec Part 2.4.

**Validation:**
- [ ] All 15 sessions have 3-6 messages each
- [ ] Messages sound natural, not robotic
- [ ] Expected facts cover the key story decisions per session table
- [ ] Total message count is ~50-75

---

### Task 2.2: Define Challenge Queries (~2 hours)

**In same file:** Add `ChallengeQuery` objects to the scenario.

**Write 15-20 challenge queries** covering:
- 10+ direct recall queries (fact established in specific session)
- 3-5 cross-reference queries (connecting facts from different sessions)
- 2-3 inference queries (requiring reasoning about established facts)

**Each query needs:**
- Natural question phrasing (as a writer would ask)
- Session index where the fact was established
- List of expected facts in the answer
- Query type classification

**Validation:**
- [ ] Queries cover facts from all 15 sessions
- [ ] Mix of query types
- [ ] Expected facts are specific and evaluable

---

### Task 2.3: Define Deliverable Requests (~2 hours)

**In same file:** Add `DeliverableRequest` objects.

**Define deliverables:**
- Standard Story Bible (after session 15)
- Character-focused Story Bible (after session 15)
- Character Profile report: Elena (after session 10)
- Character Profile report: Maren (after session 10)
- Story Outline report (after session 15)

**Also define the complete `StoryScenario` wrapper** tying sessions, queries, and deliverables together.

**Validation:**
- [ ] All deliverable types are valid template_key/report_type values
- [ ] Trigger-after-session indices are correct
- [ ] Scenario dataclass is complete and importable

---

### Task 2.4: End-to-End Integration (~3 hours)

**Run the full simulation against staging:**

```bash
python -m tests.simulation.runner --scenario fantasy_ember --tier 15 --env staging --no-screenshots
```

**Debug expected issues:**
- Auth token acquisition
- API endpoint paths (verify against actual routes)
- Session end + summary generation wait logic
- Message send timing (too fast? too slow?)
- Bible/report generation timeout
- Challenge query session creation

**Iterate until:** All 15 sessions complete, all deliverables generate, all challenge queries receive responses.

**Validation:**
- [ ] Full 15-session simulation completes without errors
- [ ] All 5 deliverables generate successfully
- [ ] All challenge queries receive AI responses
- [ ] Timing data collected for all API calls

---

### Task 2.5: Retention Evaluator (~2 hours)

**File:** `tests/simulation/evaluators/retention.py`

**Implement `RetentionEvaluator`:**
- Takes challenge query + AI response
- Calls Claude API with evaluation prompt (per spec Part 4.2)
- Parses JSON response for: facts present, facts missing, contradictions, score
- Returns `RetentionResult` dataclass

**Handle edge cases:**
- AI response is empty or error
- Claude evaluation returns unparseable response
- Partial fact matches (fact paraphrased but present)

**Validation:**
- [ ] Evaluator returns scores for sample queries
- [ ] Scores are reasonable (known-good response scores high, known-bad scores low)
- [ ] JSON parsing handles Claude response variations

---

### Task 2.6: Citation Evaluator (~2 hours)

**File:** `tests/simulation/evaluators/citation.py`

**Implement `CitationEvaluator`:**
- Parse citation short-IDs from bible/report content (regex: `\[([a-f0-9]{8})\]`)
- Look up full UUIDs in `citation_map`
- Verify cited messages exist via API (GET /api/sessions/{id}/messages)
- Check for claims without citations using LLM
- Return `CitationResult` with accuracy rate, hallucination rate, details

**Validation:**
- [ ] Correctly parses citation IDs from generated content
- [ ] Validates citations against real messages
- [ ] Detects unsupported claims

---

## Phase 3: Screenshots and Reporting (2-3 days)

### Task 3.1: Screenshot Capture System (~4 hours)

**File:** `tests/simulation/screenshot.py`

**Implement `ScreenshotCapture` class:**
- `initialize()` — Launch Playwright, authenticate via Clerk session injection
- `capture_session_chat(session_id)` — Navigate to session, screenshot chat interface
- `capture_session_list(story_id)` — Screenshot session list with all sessions visible
- `capture_story_bible(story_id, template_key)` — Screenshot bible viewer
- `capture_report(report_id)` — Screenshot report with citations
- `capture_search_results(story_id, query)` — Execute search, screenshot results
- `capture_project_overview(project_id)` — Screenshot project page
- `cleanup()` — Close browser

**Screenshot settings:**
- Viewport: 1440x900 (standard marketing size)
- Full-page option for long content
- PNG format, high quality
- Output to `tests/simulation/screenshots/{scenario_id}/`

**Auth approach:** Reuse Clerk session injection pattern from QA Engine's BrainstormyConnector.

**Validation:**
- [ ] Can authenticate and navigate to a project
- [ ] Screenshots capture at correct viewport size
- [ ] Screenshots look clean (no loading spinners, no auth screens)
- [ ] All 7 capture methods produce valid PNGs

---

### Task 3.2: Screenshot Integration with Runner (~2 hours)

**Modify `SimulationRunner.run()`:**
- After all sessions complete, call screenshot capture for each configured moment
- Capture walkthrough sequence for video production
- Save screenshots with descriptive filenames
- Log screenshot paths in metrics output

**Validation:**
- [ ] Runner captures screenshots at correct moments
- [ ] Screenshots saved to correct directory
- [ ] Filenames are descriptive and organized

---

### Task 3.3: Benchmark Report Generator (~3 hours)

**File:** `tests/simulation/reports/generator.py`

**Implement `BenchmarkReportGenerator`:**
- `generate(metrics: RunMetrics) -> str` — Produce markdown report per spec Part 8.1
- Include: run summary, retention breakdown, citation accuracy, performance stats, error log
- Include: marketing-ready data points section
- Include: screenshot inventory with paths
- Save to `tests/simulation/results/{run_id}/report.md`

**Validation:**
- [ ] Report generates from real RunMetrics
- [ ] All sections populated
- [ ] Marketing data points are clearly highlighted
- [ ] Report is readable and useful

---

### Task 3.4: Consistency Validation (~2 hours)

**Run the fantasy_ember scenario 3 times:**
```bash
python -m tests.simulation.runner --scenario fantasy_ember --tier 15 --env staging
```

**For each run, record:**
- Retention score
- Citation accuracy
- Response times
- Any errors

**Compare across runs:**
- Retention variance < 5%?
- Citation accuracy variance < 5%?
- Any flaky failures?

**Adjust thresholds if needed** — the success criteria in the spec may need tuning based on real performance.

**Validation:**
- [ ] 3 runs complete successfully
- [ ] Metrics are consistent (< 5% variance)
- [ ] Thresholds in spec are realistic

---

## Phase 4: Remaining Stories — Tier 15 (3-4 days)

### Task 4.1: Author "The Glass Alibi" (~6 hours)

**File:** `tests/simulation/stories/mystery_glass.py`

**Author per spec Part 2.3, Scenario 2:**
- 15 session scripts with mystery/thriller voice
- Challenge queries focused on clue recall, timeline consistency, motive tracking
- Deliverables: Standard Bible, Character Profile (Noor), Outline, Relationship Map

**Quality bar:** Mystery genre requires tight consistency — clues mentioned in session 5 must be recalled correctly in session 14.

---

### Task 4.2: Author "The Atlas of Us" (~6 hours)

**File:** `tests/simulation/stories/romance_atlas.py`

**Author per spec Part 2.3, Scenario 3:**
- 15 session scripts with romance voice
- Challenge queries focused on emotional arc, relationship dynamics, thematic threads
- Deliverables: Standard Bible, Character Profiles (Iris, Callum), Relationship Map, Theme Analysis

**Quality bar:** Romance genre requires emotional authenticity — user messages should convey genuine creative investment in the characters' relationship.

---

### Task 4.3: Cross-Genre Run and Comparison (~2 hours)

**Run all three scenarios:**
```bash
python -m tests.simulation.runner --all --tier 15 --env staging
```

**Compare metrics across genres:**
- Does retention differ by genre/story structure?
- Does citation accuracy differ by deliverable type?
- Which genre produces the best marketing screenshots?

**Generate combined benchmark report.**

---

## Phase 5: Progressive Scale — Tiers 50 and 100 (5-7 days)

### Task 5.1: LLM Message Generation Pipeline (~4 hours)

**File:** `tests/simulation/stories/generator.py`

**Implement `SessionMessageGenerator`:**
- Takes `GeneratedSessionOutline` + story context
- Calls Claude API with message generation prompt (per spec Part 7.2)
- Returns list of user messages
- Includes automated quality checks (message length, fact coverage)

**Validation:**
- [ ] Generates natural-sounding messages
- [ ] Messages establish required facts
- [ ] Quality checks catch bad generations

---

### Task 5.2: Author Tier 50 Session Outlines (~6 hours)

**For each of the 3 scenarios, author 35 additional `GeneratedSessionOutline` objects:**
- What topic each session explores
- What facts it establishes
- Which prior sessions it builds on
- How many messages (3-8)
- Writer notes for the generation LLM

**These go in each scenario file** as a `TIER_50_OUTLINES` list.

---

### Task 5.3: Generate and Review Tier 50 Content (~4 hours)

**Run message generation for all outlines:**
```bash
python -m tests.simulation.stories.generator --scenario fantasy_ember --tier 50
```

**Review generated messages:**
- Read through for quality
- Flag any that sound robotic or off-genre
- Regenerate flagged sessions
- Commit approved messages as static fixtures

---

### Task 5.4: Run Tier 50 Simulations (~4 hours)

**Run all three scenarios at tier 50:**
```bash
python -m tests.simulation.runner --all --tier 50 --env staging
```

**Key metrics to track:**
- Retention degradation curve (compare tier 15 vs tier 50)
- Response time increase with more context
- Summary generation time at session 50
- Any memory failures or contradictions

---

### Task 5.5: Author Tier 100 Session Outlines (~6 hours)

**For each scenario, author 50 additional outlines** (sessions 51-100).

At this scale, stories should expand into:
- Fantasy: Book 2 planning, expanded world-building, new character arcs
- Mystery: Series detective development, second case introduction
- Romance: Sequel seeds, supporting character development, thematic expansion

---

### Task 5.6: Generate and Review Tier 100 Content (~4 hours)

Same pipeline as Task 5.3, for the 51-100 session range.

---

### Task 5.7: Run Tier 100 Simulations and Analysis (~4 hours)

**Run and analyze:**
- At what session count does retention measurably degrade?
- Does context assembly slow down significantly?
- Do Story Bibles remain accurate with 100 sessions of content?
- Are there any system-level bottlenecks (database, search, LLM context window)?

**Generate stress test report** documenting findings and any architectural limits discovered.

---

## Validation Checkpoints

### After Phase 1
- [ ] Can create project and send messages via API client
- [ ] Timing metrics collected for all API calls
- [ ] CLI runner accepts arguments and executes skeleton

### After Phase 2
- [ ] "The Last Ember" runs end-to-end at tier 15
- [ ] Retention score ≥ 85%
- [ ] Citation accuracy ≥ 85%
- [ ] All metrics compiled into RunMetrics

### After Phase 3
- [ ] 7+ screenshots per scenario captured
- [ ] Screenshots pass "would I put this in an ad?" test
- [ ] Benchmark report generates with marketing-ready data points
- [ ] 3 consistent runs with < 5% variance

### After Phase 4
- [ ] All 3 genres running at tier 15
- [ ] Cross-genre benchmark report generated
- [ ] Combined screenshot library for marketing

### After Phase 5
- [ ] All 3 genres running at tier 50 and 100
- [ ] Retention degradation curve documented
- [ ] Architectural limits identified
- [ ] Stress test report complete
