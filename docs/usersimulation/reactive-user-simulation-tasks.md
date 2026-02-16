# Reactive User Simulation — Implementation Tasks

## Overview

This task list implements the Reactive User Simulation from `reactive-simulation-spec.md`. The reactive simulation extends the existing scripted simulation framework with an LLM-driven agent that conducts genuine conversations with Brainstormy, testing conversational quality, memory retention under interactive use, and the full product experience.

**Reference specs:**
- `reactive-simulation-spec.md` — Full architecture, agent design, modes, evaluation
- `user-simulation-spec.md` — Scripted simulation architecture (base classes, API client, metrics)
- `user-simulation-phase1-tasks.md` — Phase 1 implementation details (API client patterns, auth, naming conventions)

**Reference code (in `brainstormy-FMA-MVP` repo):**
- `backend/api/` — REST endpoint implementations (verify endpoint paths here)
- `backend/config/navigators/fiction/` — Navigator TOML files defining valid genre keys
- `backend/config/working_method.py` — Working method configuration
- `docs/session-modes/focus-mode-spec.md` — Session guidance_mode/template naming (if present; naming conventions also documented in `user-simulation-phase1-tasks.md` Implementation Notes)

**Timeline:** 32–43 hours across 6 phases
**Repository:** `brainstormy-FMA-MVP`
**Location:** `tests/simulation/reactive/` (extends existing `tests/simulation/`)
**Git:** Push after completing each task. Update `tests/simulation/PROGRESS.md` with reactive simulation status. (If `PROGRESS.md` doesn't exist yet, create it as the first step — it was specified in scripted Phase 1 Task 1.5.3.)

---

## Prerequisites

Before starting, verify:
- [ ] Scripted simulation Phase 1 is complete and working (API client, metrics collector, runner all functional)
- [ ] Brainstormy staging environment is running
- [ ] Brainstormy staging backend has a valid OpenRouter API key configured (enables AI responses when the simulation sends messages)
- [ ] `ANTHROPIC_API_KEY` is available (for the simulation agent's LLM calls — separate from OpenRouter)
- [ ] You can run the scripted simulation end-to-end on staging
- [ ] `httpx`, `anthropic`, and `pytest-asyncio` are in project dependencies

**First action:** Run the existing scripted simulation to confirm the API client and staging environment work:
```bash
python -m tests.simulation --scenario fantasy_ember --tier 15 --env staging --no-screenshots --verbose
```

---

## Implementation Notes

### Existing Infrastructure to Reuse

The reactive simulation builds on top of Phase 1 infrastructure. Do NOT reimplement:
- `api_client.py` — `BrainstormyClient` with all endpoint methods. **Extend** with `_put()` convenience wrapper and `set_working_method()`.
- `config.py` — `SimulationConfig`, `EnvironmentConfig`, `PacingConfig`, `RetryConfig`, `EvaluationConfig`. **Extend** with `ReactiveConfig`.
- `metrics.py` — `MetricsCollector` and `RunMetrics`. **Subclass** as `ReactiveMetricsCollector` and `ReactiveRunMetrics`.
- `evaluators/retention.py` — `RetentionEvaluator`. Reuse directly for challenge query evaluation.
- Runner patterns — Session creation, message sending, summary waiting, error handling patterns from `runner.py`.

### ReactiveConfig Dataclass

**File:** `tests/simulation/config.py` (extend existing file)

Add this alongside the existing config classes. Referenced by `ReactiveRunner.__init__()` (Task 5.1.1).

```python
@dataclass(frozen=True)
class ReactiveConfig:
    """Configuration for a reactive simulation run."""
    mode: str                              # "budget" | "journey"
    genre: str                             # Navigator key (e.g., "fantasy", "mystery")
    persona_key: str                       # WriterPersona key (e.g., "verbose_explorer")
    sessions: int                          # Session count (1-100)
    messages_per_session: tuple[int, int]  # (min, max) messages per session
    working_method: str                    # "supportive" | "balanced" | "direct"
    
    # Budget mode only
    session_type_mix: str = "natural_progression"  # "all_explore" | "natural_progression" | "heavy_focus" | "custom"
    
    # Journey mode only
    seed: 'Seed | None' = None             # Required when mode="journey"
    
    def validate(self) -> list[str]:
        """Return list of issues (empty = valid)."""
        issues = []
        if self.mode not in ("budget", "journey"):
            issues.append(f"Invalid mode: {self.mode}")
        if self.mode == "journey" and self.seed is None:
            issues.append("Journey mode requires a seed")
        if not 1 <= self.sessions <= 100:
            issues.append(f"Sessions must be 1-100, got {self.sessions}")
        if self.messages_per_session[0] > self.messages_per_session[1]:
            issues.append("messages_per_session min > max")
        return issues
```

### Naming Conventions (unchanged from scripted)

- Session guidance modes: `explore` or `focus` (NOT `develop`)
- Focus templates: `character`, `plot`, `scene`, `world`, `logline`, `dialogue`, `outline_section`, `workshop_theme`, `workshop_structure`
- Unique templates per story: `logline` (max 1), `workshop_theme` (max 1) — backend enforces this

### API Client Path Convention

All endpoint methods use paths WITHOUT the `/api` prefix — `_request()` prepends `/api` automatically. Example: `/users/me/preferences`, NOT `/api/users/me/preferences`.

### Agent LLM Configuration

All agent and evaluator LLM calls use the Anthropic Python SDK directly (NOT through Brainstormy's API). Default model: `claude-sonnet-4-5-20250929`. Temperature: 0.3 for agent calls (some creativity needed), 0.0 for evaluator calls (consistency needed).

### send_message Returns Synchronously

Same as scripted: `POST /api/sessions/{session_id}/messages` returns both `user_message` and `assistant_message` in a single synchronous response. The agent reads `assistant_message.content` to generate its next response.

---

## Phase 1: Core Agent (8–10 hours)

### Task 1.1: Writer Persona Definitions (~2 hours)

**File:** `tests/simulation/reactive/personas.py`

#### Task 1.1.1: WriterPersona Dataclass

```python
@dataclass(frozen=True)
class WriterPersona:
    """A simulated writer's communication style and behavior."""
    key: str
    name: str
    description: str
    
    # Communication style
    verbosity: str          # "terse" | "moderate" | "verbose"
    message_length: str     # "short" (1-2 sentences) | "medium" (3-5) | "long" (6-10+)
    
    # Creative approach
    planning_style: str     # "plotter" | "pantser" | "plantser"
    decision_speed: str     # "quick" | "deliberate" | "indecisive"
    
    # Interaction patterns
    pushback_frequency: str  # "rarely" | "sometimes" | "often"
    tangent_tendency: str    # "focused" | "occasional_tangent" | "frequent_tangent"
    expertise_level: str     # "beginner" | "intermediate" | "experienced"
    
    # Voice notes for the agent LLM
    voice_description: str
    example_messages: list[str]
    
    # Drift detection
    characteristic_patterns: list[str]  # regex or substring patterns for drift check
```

#### Task 1.1.2: Define All 5 Built-in Personas

Each persona needs a complete definition. The `voice_description` and `example_messages` are injected verbatim into every agent prompt (see spec Part 3.6), so they must be carefully written.

**Efficient Plotter:**
- key: `efficient_plotter`
- Terse, short messages (1-2 sentences). Quick decisions. Experienced. Often pushes back. Focused.
- Voice: Direct, uses craft terminology ("stakes", "arc", "inciting incident"). No hedging. States decisions as facts.
- Example messages (3): Write 3 messages that sound like an experienced plotter — blunt, efficient, precise.
- Characteristic patterns: craft terminology, short sentences, declarative statements.

**Verbose Explorer:**
- key: `verbose_explorer`
- Verbose, long messages (6-10+ sentences). Pantser, indecisive. Beginner. Rarely pushes back. Frequent tangents.
- Voice: Enthusiastic, uses ellipses and dashes, thinks out loud, asks rhetorical questions, circles back.
- Example messages (3): Write 3 messages that ramble productively — tangential but creative.
- Characteristic patterns: ellipses, dashes, "I wonder if...", "actually wait...", long paragraphs.

**Revisionist:**
- key: `revisionist`
- Moderate verbosity, medium messages. Plantser, indecisive. Experienced. Often pushes back. Occasional tangents.
- Voice: Second-guesses earlier decisions, references what was said before, wants to revise. Uses "actually, what if instead..." frequently.
- Example messages (3): Write 3 messages that show revision behavior — changing mind, referencing earlier ideas.
- Characteristic patterns: "actually", "what if instead", "going back to", "I'm not sure about".

**Methodical Worldbuilder:**
- key: `methodical_worldbuilder`
- Moderate verbosity, medium messages. Plotter, deliberate. Intermediate. Sometimes pushes back. Focused.
- Voice: Systematic, asks about implications and consistency. Builds outward from details. Wants rules and logic.
- Example messages (3): Write 3 messages that show systematic world-building — rules, consequences, internal logic.
- Characteristic patterns: "so does that mean", "what are the rules for", "how does X affect Y", numbered lists.

**Anxious Beginner:**
- key: `anxious_beginner`
- Moderate verbosity, medium messages. Pantser, deliberate. Beginner. Rarely pushes back. Focused.
- Voice: Uncertain, seeks validation, grateful for suggestions. Uses hedging language. Defers to AI's expertise.
- Example messages (3): Write 3 messages that show uncertainty and gratitude — hesitant but engaged.
- Characteristic patterns: "is that okay?", "I'm not sure if", "do you think", "thank you", question marks.

**Helper functions:**
```python
def get_persona(key: str) -> WriterPersona:
    """Look up persona by key. Raises KeyError if not found."""

def list_personas() -> list[WriterPersona]:
    """Return all built-in personas."""
```

**Validation:**
- [ ] All 5 personas instantiate without errors
- [ ] Each persona has exactly 3 example messages
- [ ] Each persona has at least 2 characteristic patterns
- [ ] `get_persona("efficient_plotter")` returns correct persona
- [ ] `list_personas()` returns all 5
- [ ] Voice descriptions are detailed enough to drive distinct agent behavior (>100 words each)

---

### Task 1.2: User Agent with Message Generation (~3 hours)

**File:** `tests/simulation/reactive/agent.py`

#### Task 1.2.1: UserAgent Class

```python
class UserAgent:
    def __init__(
        self,
        persona: WriterPersona,
        state: AgentState,
        anthropic_client: anthropic.AsyncAnthropic,
        model: str = "claude-sonnet-4-5-20250929",
        temperature: float = 0.3,
    ):
        self.persona = persona
        self.state = state
        self.client = anthropic_client
        self.model = model
        self.temperature = temperature
        self.message_count_in_session = 0
        self._consecutive_drift_failures = 0
```

#### Task 1.2.2: generate_message() Method

```python
async def generate_message(
    self,
    brainstormy_response: str | None,
    mode_context: str,
    target_message_count: int,
) -> AgentResponse:
    """
    Generate the next message as the writer persona.
    
    Args:
        brainstormy_response: Brainstormy's last message content, or None for
            logline sessions (no opening message) and session-start failures.
            When None, the prompt builder omits the "RESPOND TO THIS" section
            and the agent generates an unprompted opener instead.
        mode_context: Budget or journey mode context block
        target_message_count: Target messages for this session (for pacing)
    
    Returns:
        AgentResponse with message, decision, fact tracking, reasoning
    """
```

**Implementation:**
1. Build the full prompt using `_build_prompt()` (see Task 1.3)
2. Call Anthropic API with structured JSON output
3. Parse response as `AgentResponse` (see Task 1.2.3)
4. On parse failure: retry once with simplified prompt, then regex fallback (spec Part 3.2)
5. Run drift check every 5 messages (spec Part 3.6)
6. Update `self.state` with facts established/modified/emerged
7. Track token usage for cost monitoring
8. Return `AgentResponse`

**Token tracking:** Every LLM call must record `input_tokens` and `output_tokens` from the Anthropic response `usage` field. Accumulate in `self.total_input_tokens` and `self.total_output_tokens`.

#### Task 1.2.3: AgentResponse Dataclass

```python
@dataclass
class AgentResponse:
    message: str
    decision: str           # "continue" | "redirect" | "pushback" | "go_deeper" | "wrap_up"
    facts_targeted: list[str]
    facts_established: list[str]
    facts_modified: list[dict]
    facts_emerged: list[dict]
    readiness_signals: list[str]
    direction_change: str | None
    reasoning: str
    
    # Token tracking
    input_tokens: int = 0
    output_tokens: int = 0
    parse_method: str = "json"  # "json" | "regex_fallback" | "generic_fallback"
```

**Parsing logic:**
1. Try `json.loads()` on the raw LLM response
2. If that fails, try regex: `re.search(r'"message"\s*:\s*"([^"]+)"', raw_output)`
3. If regex finds a message, construct `AgentResponse` with message only, set `parse_method="regex_fallback"`, fill other fields with defaults
4. If regex fails, use persona-appropriate fallback message:
   - Beginner personas: "That's interesting — tell me more about that?"
   - Experienced personas: "Continue."
   - Set `parse_method="generic_fallback"`
5. Log all parse failures with raw output to transcript errors

#### Task 1.2.4: generate_session_summary() Method

```python
async def generate_session_summary(
    self,
    session_messages: list[tuple[str, str]],
) -> str:
    """
    Generate a one-paragraph summary of the just-completed session.
    Used for context management (NOT Brainstormy's summary — those are too slow).
    
    Returns:
        One paragraph summarizing: topic, key decisions, facts established, direction changes.
    """
```

**Implementation:**
- Prompt: "Summarize this brainstorming session in one paragraph. Include: the main topic discussed, key story decisions made, specific facts established (names, rules, events), and any direction changes."
- Input: all session messages as user/assistant pairs
- Max tokens: 300
- Temperature: 0.0 (factual summary, no creativity)
- Track tokens for cost monitoring

#### Task 1.2.5: Drift Detection

```python
def _check_drift(self, message: str) -> bool:
    """
    Check if the agent's message matches persona expectations.
    Returns True if message passes, False if drift detected.
    """
```

**Implementation per spec Part 3.6:**
- Check message length against `persona.message_length` range (per spec Part 2.3):
  - "short": 1-2 sentences
  - "medium": 3-5 sentences
  - "long": 6-10+ sentences
  - Allow ±1 sentence tolerance
- Check for characteristic patterns: at least 1 of `persona.characteristic_patterns` should appear
- Track `_consecutive_drift_failures`. If ≥2, set a flag that `_build_prompt()` reads to inject corrective nudge.
- Reset counter on a passing check.

**Validation:**
- [ ] Agent generates coherent messages with each of the 5 personas
- [ ] JSON parsing produces valid `AgentResponse` objects
- [ ] Regex fallback works when JSON is malformed
- [ ] Generic fallback produces persona-appropriate messages
- [ ] Session summaries are one paragraph, factual, and capture key decisions
- [ ] Drift detection flags short messages from verbose personas and vice versa
- [ ] Token counts are recorded for every LLM call
- [ ] Parse errors are logged with raw output

---

### Task 1.3: Agent Prompt Engineering (~2 hours)

**File:** `tests/simulation/reactive/prompts.py`

#### Task 1.3.1: Main Agent Prompt Template

Build the prompt structure from spec Part 3.4:

```python
def build_agent_prompt(
    persona: WriterPersona,
    mode_context: str,
    session_summaries: list[str],
    fact_ledger_compact: str,
    open_questions: list[str],
    rejected_ideas: list[str],
    current_session_messages: list[tuple[str, str]],
    brainstormy_last_response: str | None,
    drift_correction: str | None = None,
    message_number: int = 0,
    target_message_count: int = 6,
) -> str:
    """Build the full agent prompt. Must stay under 12K tokens."""
```

**Prompt sections (in order):**

1. **System context** (~200 tokens): "You are a fiction writer brainstorming with an AI assistant called Brainstormy. You are NOT the AI — you are the human writer."

2. **Persona definition** (~800 tokens): Verbatim `persona.voice_description` + all `persona.example_messages`. NEVER summarize or omit — this prevents drift.

3. **Mode context** (~500 tokens): Injected `mode_context` string (budget or journey specific, see Task 1.3.2).

4. **Prior sessions summary** (~2K tokens max): One paragraph per completed session from `session_summaries`. If total exceeds 2K tokens, truncate oldest first.

5. **Fact ledger** (~1K tokens max): Compact list from `fact_ledger_compact`. See `build_compact_fact_ledger()` in Task 1.3.3.

6. **Open questions + rejected ideas** (~300 tokens max): Last 10 of each.

7. **Current session messages** (~3K tokens): Full verbatim message pairs, EXCLUDING the final Brainstormy response (which is presented separately in section 8).

8. **Brainstormy's last response** (~500 tokens): The message being responded to, presented with a `>>> RESPOND TO THIS <<<` marker. Omit this section entirely when `brainstormy_response` is None (logline sessions, session-start failures).

9. **Drift correction** (optional, ~100 tokens): If `drift_correction` is set, inject: `"REMINDER: You are {persona.name}. Your messages should be {persona.message_length}. Example of your voice: {persona.example_messages[0]}"`

10. **Task instruction** (~300 tokens): "Generate your next message as JSON. Include: message (in your voice), decision, facts_targeted, facts_established, facts_modified, facts_emerged, readiness_signals, direction_change, reasoning."

11. **Pacing hint** (~50 tokens): "This is message {n} of ~{target}. {pacing_note}" where pacing_note is:
    - Early (< 30%): "Take your time exploring."
    - Middle (30-70%): "Continue developing ideas."
    - Late (> 70%): "Start wrapping up — make final decisions."
    - Last: "This is your last message. Wrap up clearly."

**Token budget enforcement:**
```python
def _estimate_tokens(text: str) -> int:
    """Rough estimate: 1 token per 4 characters."""
    return len(text) // 4

def _enforce_budget(prompt: str, ceiling: int = 12000) -> str:
    """If over budget, truncate prior session summaries (oldest first) until under."""
```

#### Task 1.3.2: Mode Context Builders

```python
def build_budget_mode_context(
    session_plan: dict,
    current_session_index: int,
    target_facts: list[dict],
    deferred_facts: list[str],
) -> str:
    """
    Budget mode context block.
    Lists facts to establish this session, deferred facts from prior sessions.
    """

def build_journey_mode_context(
    seed: dict,
    current_phase: str,
    phase_session_number: int,
    readiness_signals_so_far: list[str],
    story_state_summary: str,
) -> str:
    """
    Journey mode context block.
    Describes current phase, seed, what's established, encourages following curiosity.
    """
```

#### Task 1.3.3: Compact Fact Ledger Builder

```python
def build_compact_fact_ledger(
    facts_established: dict,
    facts_emerged: list,
    current_template: str | None = None,
    max_tokens: int = 1000,
) -> str:
    """
    Build compact fact ledger for prompt injection.
    
    Format: [f001] Elena is 28, engineer (established session 1)
    
    Cap strategy (spec Part 3.4 rule 4):
    1. Always include all 'core' priority facts
    2. Include 30 most recently established/modified facts
    3. Include facts relevant to current session template
    4. Full ledger always maintained in AgentState; only prompt version is capped
    """
```

#### Task 1.3.4: Session Summary Prompt

```python
SESSION_SUMMARY_PROMPT = """Summarize this brainstorming session in one paragraph.
Include: the main topic discussed, key story decisions made, specific facts established 
(character names, world rules, plot points), and any direction changes.
Keep it factual and concise — this summary will be used as context for future sessions.

SESSION MESSAGES:
{messages}

Write one paragraph summary:"""
```

#### Task 1.3.5: Evaluation Prompt Templates

```python
QUALITY_EVALUATION_PROMPT = """You are evaluating Brainstormy, an AI brainstorming partner for fiction writers.
Review the following transcript segment and score the specified metrics.

METRICS TO EVALUATE:
{metrics_list}

CONTEXT:
- Genre: {genre}
- Writer persona: {persona_description}
- Session type: {session_type}
{extra_context}

TRANSCRIPT:
{transcript_segment}

For each metric, score 0.0 to 1.0. Provide:
1. The score
2. 1-2 sentence justification
3. Specific examples from the transcript

Respond as JSON:
{{
    "scores": {{
        "{metric_name}": {{
            "score": 0.85,
            "justification": "...",
            "evidence": ["..."]
        }}
    }}
}}"""

CHALLENGE_QUERY_GENERATION_PROMPT = """..."""  # For observer to generate recall queries

JOURNEY_COHERENCE_PROMPT = """..."""  # For evaluating deliverable coherence

FACT_BUDGET_GENERATION_PROMPT = """..."""  # For budget mode fact generation (Task 2.1)
```

**Validation:**
- [ ] `build_agent_prompt()` produces a well-structured prompt under 12K tokens
- [ ] Budget mode context lists target facts clearly
- [ ] Journey mode context describes phase and seed appropriately
- [ ] Compact fact ledger stays under 1K tokens for 40 facts
- [ ] Compact fact ledger correctly caps at 100+ facts (keeps core + 30 recent)
- [ ] Token budget enforcement truncates oldest summaries first
- [ ] Drift correction injects when flag is set
- [ ] Pacing hints change based on message position

---

### Task 1.4: Agent State Tracker (~2 hours)

**File:** `tests/simulation/reactive/state.py`

#### Task 1.4.1: Supporting Dataclasses

```python
@dataclass
class StoryDecision:
    description: str
    session_index: int
    message_index: int
    
@dataclass
class FactStatus:
    fact_id: str
    value: str
    category: str           # "character" | "relationship" | "world" | "plot"
    priority: str           # "core" | "supporting" | "detail"
    status: str             # "planned" | "established" | "modified" | "deferred" | "abandoned"
    flexible: bool
    target_session: int | None
    established_in_session: int | None = None
    established_at_message: int | None = None
    source: str | None = None  # "agent" | "brainstormy"
    modifications: list[dict] = field(default_factory=list)

@dataclass
class EmergedFact:
    fact_id: str            # Auto-generated: "e001", "e002", ...
    description: str
    category: str
    source: str             # "agent" | "brainstormy"
    established_in_session: int
    established_at_message: int
    current_value: str
    modified_in_sessions: list[int] = field(default_factory=list)

@dataclass
class DirectionChange:
    description: str
    session_index: int
    message_index: int

@dataclass
class ReadinessSignal:
    signal: str
    session_index: int
    message_index: int

@dataclass
class PhaseTransition:
    from_phase: str
    to_phase: str
    at_session: int
    signals: list[str]
    agent_state_snapshot: str
```

#### Task 1.4.2: AgentState Class

```python
@dataclass
class AgentState:
    # Story state
    story_decisions: list[StoryDecision] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    rejected_ideas: list[str] = field(default_factory=list)
    
    # Fact tracking
    facts_established: dict[str, FactStatus] = field(default_factory=dict)
    facts_emerged: list[EmergedFact] = field(default_factory=list)
    facts_deferred: list[str] = field(default_factory=list)
    
    # Session summaries (agent-generated, for context management)
    session_summaries: list[str] = field(default_factory=list)
    current_session_messages: list[tuple[str, str]] = field(default_factory=list)
    
    # Direction changes
    direction_changes: list[DirectionChange] = field(default_factory=list)
    
    # Journey mode
    readiness_signals: list[ReadinessSignal] = field(default_factory=list)
    current_phase: str = "explore"
    phase_transitions: list[PhaseTransition] = field(default_factory=list)
    
    # Error tracking
    sessions_with_errors: int = 0
    parse_errors: int = 0
    
    # Counters
    _emerged_fact_counter: int = field(default=0, repr=False)
```

**Methods:**

| Method | Purpose |
|--------|---------|
| `update_from_response(response: AgentResponse, session_index: int, message_index: int)` | Apply agent response to state: update facts, record decisions, track signals |
| `add_session_message(role: str, content: str)` | Append to current session messages |
| `end_session(summary: str)` | Move current messages to summary, reset current session |
| `get_compact_fact_ledger(current_template: str \| None) -> str` | Delegate to `build_compact_fact_ledger()` |
| `get_recent_open_questions(n: int = 10) -> list[str]` | Last N open questions |
| `get_recent_rejected_ideas(n: int = 10) -> list[str]` | Last N rejected ideas |
| `record_error(session_index: int)` | Increment error count |
| `record_parse_error()` | Increment parse error count |
| `_next_emerged_id() -> str` | Returns "e001", "e002", etc. |

**`update_from_response()` details:**
- For each `facts_established`: update status to "established", set session/message indices
- For each `facts_modified`: update value, add to modifications list
- For each `facts_emerged`: create `EmergedFact` with auto-generated ID, append to list
- For each `readiness_signals`: create `ReadinessSignal`, append to list
- If `direction_change` is not None: create `DirectionChange`, append

#### Task 1.4.3: State Initialization

```python
@classmethod
def from_fact_budget(cls, fact_budget: dict) -> "AgentState":
    """Initialize state from a budget mode fact budget."""
    state = cls()
    for fact in fact_budget["facts"]:
        state.facts_established[fact["fact_id"]] = FactStatus(
            fact_id=fact["fact_id"],
            value=fact["value"],
            category=fact["category"],
            priority=fact["priority"],
            status="planned",
            flexible=fact["flexible"],
            target_session=fact["target_session"],
        )
    return state

@classmethod
def from_seed(cls, seed: dict) -> "AgentState":
    """Initialize state for journey mode. Minimal — everything emerges."""
    return cls()
```

**Validation:**
- [ ] `AgentState.from_fact_budget()` correctly loads all facts as "planned"
- [ ] `update_from_response()` transitions facts from "planned" → "established"
- [ ] `update_from_response()` handles fact modifications with history
- [ ] Emerged fact IDs auto-increment correctly
- [ ] `end_session()` clears current messages and appends summary
- [ ] `get_compact_fact_ledger()` stays under 1K tokens
- [ ] State survives across multiple sessions without data loss
- [ ] Error and parse error counters increment correctly

---

### Task 1.5: Manual Agent Test (~1 hour)

#### Task 1.5.1: Standalone Agent Loop Test

Create a test script that runs the agent in a conversation loop WITHOUT Brainstormy, using mock responses:

**File:** `tests/simulation/reactive/test_agent_standalone.py`

```python
async def test_agent_loop():
    """
    Run agent for 5 turns with mock Brainstormy responses.
    Verify: messages match persona, JSON parsing works, state updates correctly.
    """
```

**Mock Brainstormy responses (5):**
1. Opening: "Welcome! I'd love to help you develop your story. What's been on your mind?"
2. After agent's first message: "That's a fascinating concept! Tell me more about the main character."
3. Suggestion: "What if the protagonist has a secret connection to the ancient power?"
4. Pushback response: "I see your point. Let's explore a different angle then."
5. Deep dive: "Let's break down the magic system. What are the rules and limitations?"

**Test each persona** against these 5 mock responses. Verify:
- [ ] Efficient Plotter messages are short (1-3 sentences)
- [ ] Verbose Explorer messages are long (6+ sentences) with tangent patterns
- [ ] Revisionist references earlier decisions
- [ ] Methodical Worldbuilder asks systematic questions
- [ ] Anxious Beginner uses hedging language
- [ ] All responses parse as valid `AgentResponse` JSON
- [ ] State correctly tracks facts after 5 turns

---

## Phase 2: Budget Mode (4–6 hours)

### Task 2.1: Fact Budget Generation (~2 hours)

**File:** `tests/simulation/reactive/session_planner.py`

#### Task 2.1.1: Fact Budget Generator

```python
async def generate_fact_budget(
    genre: str,
    session_count: int,
    anthropic_client: anthropic.AsyncAnthropic,
    model: str = "claude-sonnet-4-5-20250929",
) -> dict:
    """
    Generate a story premise and fact budget for budget mode.
    
    Returns dict matching spec Part 2.6 schema:
    {
        "premise": "...",
        "facts": [
            {"fact_id": "f001", "value": "...", "category": "...", 
             "priority": "...", "flexible": bool, "target_session": int}
        ]
    }
    """
```

**Prompt requirements:**
- Input: genre name and session count
- Output: JSON with premise + 3-5 facts per session
- Category distribution: ~30% character, ~20% relationship, ~30% world, ~20% plot
- Priority distribution: ~30% core, ~50% supporting, ~20% detail
- Flexibility: all core facts `flexible=false`, supporting/detail `flexible=true` unless premise-critical
- Session distribution: character + world facts early, plot + relationship facts later
- Some facts should repeat across sessions for recall testing
- Premise should be specific to the genre and compelling

**Fact ID format:** Sequential `f001`, `f002`, ..., `f{NNN}`.

#### Task 2.1.2: Fact Budget Validator

```python
def validate_fact_budget(budget: dict, session_count: int) -> list[str]:
    """
    Validate a generated fact budget. Returns list of issues (empty = valid).
    
    Checks:
    - All required fields present
    - Fact IDs are unique
    - target_session values are within range [0, session_count-1]
    - Category distribution is roughly correct (±10%)
    - Priority distribution is roughly correct (±10%)
    - Core facts are all flexible=false
    - At least 3 facts per session
    """
```

**Validation:**
- [ ] Generator produces valid budget for each of the 11 genres
- [ ] Fantasy budgets include world-building facts
- [ ] Mystery budgets include plot/clue facts
- [ ] Romance budgets include relationship facts
- [ ] Fact count scales with session count (3-5 per session)
- [ ] Validator catches missing fields, out-of-range sessions, bad distributions

---

### Task 2.2: Session Planner (~2 hours)

**File:** `tests/simulation/reactive/session_planner.py` (same file as 2.1)

#### Task 2.2.1: SessionPlan and SessionSpec Dataclasses

```python
@dataclass
class SessionSpec:
    """Specification for a single session in the plan."""
    session_index: int
    name: str
    guidance_mode: str          # "explore" | "focus"
    template: str               # "open", "character", "plot", etc.
    target_facts: list[str]     # fact_ids to establish
    target_messages: int        # target message count
    focus_target_name: str | None = None  # for character focus sessions

@dataclass
class SessionPlan:
    """Complete session plan for a budget mode run."""
    premise: str
    sessions: list[SessionSpec]
    fact_budget: dict           # The full generated budget
```

#### Task 2.2.2: SessionPlanner Class

```python
class SessionPlanner:
    def __init__(
        self,
        genre: str,
        persona: WriterPersona,
        session_count: int,
        messages_per_session: tuple[int, int],  # (min, max)
        session_type_mix: str,  # "all_explore" | "natural_progression" | "heavy_focus" | "custom"
    ):
        ...
    
    async def create_plan(
        self,
        anthropic_client: anthropic.AsyncAnthropic,
    ) -> SessionPlan:
        """Generate fact budget and build session plan."""
    
    def _distribute_facts(self, facts: list[dict], sessions: list[SessionSpec]) -> None:
        """Assign facts to sessions based on category and target_session."""
    
    def _build_session_sequence(self) -> list[SessionSpec]:
        """Build session sequence based on session_type_mix."""
```

**Natural progression logic (spec Part 4.2):**
```
Sessions 1-30%:  Explore (template="open")
Sessions 30-60%: Mix of explore + character/world focus
Sessions 60-90%: Plot focus, scene development
Sessions 90%+:   Deeper focus, refinement
```

**Genre-influenced template distribution:**
- Fantasy: more `world` templates
- Mystery: more `plot` templates
- Romance: more `character` templates
- Thriller: more `scene` + `plot` templates
- Literary: more `character` + explore

**Session naming (spec Part 7.2):**
`"{persona.name} — Session {n}: {template_description}"`

**Validation:**
- [ ] Natural progression creates correct session type sequence
- [ ] Facts distribute across sessions (3-5 per session)
- [ ] Genre influences template selection
- [ ] All session names follow naming convention
- [ ] Custom session type mix accepts percentage input

---

### Task 2.3: Session Type Progression Logic (~1 hour)

Already covered in Task 2.2.2. This task validates the progression works across all mix types:

- [ ] `all_explore` produces only explore sessions
- [ ] `natural_progression` transitions from explore → focus correctly
- [ ] `heavy_focus` produces mostly focus sessions
- [ ] Deferred facts from one session appear in the next session's targets

---

### Task 2.4: Cross-Genre Validation (~1 hour)

Run the planner with each genre × each persona combination from the coverage matrix (spec Appendix A):

- [ ] Fantasy + Efficient Plotter: plan has world-building focus
- [ ] Mystery + Revisionist: plan has plot/clue focus
- [ ] Romance + Verbose Explorer: plan has character focus
- [ ] Sci-Fi + Methodical Worldbuilder: plan has world + plot focus
- [ ] Fantasy + Anxious Beginner: plan has gentler progression

Verify fact budgets are genre-appropriate and session plans distribute facts sensibly.

---

## Phase 3: Journey Mode (6–8 hours)

### Task 3.1: Seed Handling and Journey Context (~2 hours)

**File:** `tests/simulation/reactive/progression.py`

#### Task 3.1.1: Seed Dataclass

```python
@dataclass(frozen=True)
class Seed:
    seed_type: str   # "theme" | "character" | "antagonist" | "premise" | "vibe" | "situation"
    content: str
    
    def to_opening_prompt(self, persona: WriterPersona) -> str:
        """
        Generate a natural opening message from this seed in the persona's voice.
        Example for theme seed with verbose persona:
        "So I've been thinking about this idea... it's not fully formed yet, but I keep 
        coming back to this theme of isolation and connection in the digital age..."
        """
```

#### Task 3.1.2: Journey Mode Context

The journey mode context block (injected into agent prompt via `build_journey_mode_context()` in Task 1.3.2) includes:
- Current phase (explore/develop/workshop)
- The original seed
- What's been established so far (brief summary)
- Phase-specific guidance:
  - Explore: "Follow your curiosity. Introduce ideas naturally. Don't force structure."
  - Develop: "You have characters and a world. Go deep on specific elements."
  - Workshop: "Time to synthesize. Work toward concrete deliverables."
- Readiness signals the agent should watch for and report

**Validation:**
- [ ] Each seed type generates a natural opening message for each persona
- [ ] Journey context changes appropriately across phases
- [ ] Opening messages vary significantly across personas (verbose vs. terse)

---

### Task 3.2: Progression Engine (~3 hours)

**File:** `tests/simulation/reactive/progression.py` (same file as 3.1)

#### Task 3.2.1: ProgressionEngine Class

```python
class ProgressionEngine:
    def __init__(self, session_cap: int, seed: Seed, genre: str):
        self.session_cap = session_cap
        self.seed = seed
        self.genre = genre
        self.current_phase = "explore"
        self.sessions_completed = 0
        self.phase_session_counts = {"explore": 0, "develop": 0, "workshop": 0}
        self.used_unique_templates: set[str] = set()  # "logline", "workshop_theme"
        self.graduation_log: list[dict] = []
    
    def suggest_next_session(self, agent_state: AgentState) -> SessionSpec:
        """Suggest the next session based on current phase and agent state."""
    
    def evaluate_graduation(self, agent_state: AgentState) -> str | None:
        """
        Check if the agent should graduate to the next phase.
        Returns new phase name or None if no graduation.
        """
    
    def is_journey_complete(self, agent_state: AgentState) -> bool:
        """Check if the journey is complete (spec Part 5.2.1)."""
    
    @property
    def journey_completion_state(self) -> str:
        """Returns 'full', 'partial', or 'stalled'."""
    
    @property
    def workshop_session_count(self) -> int:
        return self.phase_session_counts["workshop"]
    
    @property
    def remaining_sessions(self) -> int:
        return self.session_cap - self.sessions_completed
```

#### Task 3.2.2: Graduation Logic

Implement the readiness evaluation from spec Part 5.2.

**Explore → Develop signals:**
- `named_characters`: Agent has named 2+ characters
- `core_conflict_established`: Agent has stated a central conflict
- `self_referencing`: Agent references earlier decisions
- `depth_desire`: Agent expresses wanting to go deeper
- Plus: 3+ sessions in explore

**Develop → Workshop signals:**
- `character_depth`: At least one character developed in depth
- `conflict_direction`: Clear conflict/plot direction
- `world_sufficient`: Enough world-building for the genre
- `structure_thinking`: Agent starts thinking about structure
- Plus: 3+ sessions in develop
- Plus: remaining sessions ≤ 30% of total forces graduation

**Graduation method:**
```python
def evaluate_graduation(self, agent_state: AgentState) -> str | None:
    if self.current_phase == "explore":
        return self._check_explore_graduation(agent_state)
    elif self.current_phase == "develop":
        return self._check_develop_graduation(agent_state)
    return None  # Workshop doesn't graduate
```

#### Task 3.2.3: Session Selection

```python
def suggest_next_session(self, agent_state: AgentState) -> SessionSpec:
    # 1. Check graduation
    new_phase = self.evaluate_graduation(agent_state)
    if new_phase:
        self._graduate(new_phase, agent_state)
    
    # 2. Select template based on current phase
    if self.current_phase == "explore":
        return self._suggest_explore_session(agent_state)
    elif self.current_phase == "develop":
        return self._suggest_develop_session(agent_state)
    else:  # workshop
        return self._suggest_workshop_session(agent_state)
```

**Workshop session selection (spec Part 5.3):**
1. First workshop session → `workshop_theme` (if not already used)
2. Second → `logline` (if not already used)
3. After both → `workshop_structure` or `outline_section`
4. Never suggest a unique template that's already in `used_unique_templates`

**Develop session selection:**
- Examine agent state for underdeveloped elements
- Undeveloped named characters → `character` template
- Unclear world rules → `world` template
- Loose plot → `plot` template
- Key scenes mentioned → `scene` template

---

### Task 3.3: Phase Transition Logic with Guardrails (~2 hours)

#### Task 3.3.1: Forcing Rules

Implement the forcing rules from spec Part 5.2:

```python
def _check_explore_graduation(self, agent_state: AgentState) -> str | None:
    # Natural graduation check
    signals = [s.signal for s in agent_state.readiness_signals]
    natural_ready = (
        signals.count("named_characters") >= 1
        and "core_conflict_established" in signals
        and self.phase_session_counts["explore"] >= 3
    )
    
    # Forcing rule: remaining ≤ 50% AND still in explore
    forced = (
        self.remaining_sessions <= self.session_cap * 0.5
        and self.current_phase == "explore"
    )
    
    if natural_ready or forced:
        return "develop"
    return None

def _check_develop_graduation(self, agent_state: AgentState) -> str | None:
    # Natural graduation
    # ... similar signal checking ...
    
    # Forcing rule: remaining ≤ 30% AND still in develop
    forced = (
        self.remaining_sessions <= self.session_cap * 0.3
        and self.current_phase == "develop"
    )
    
    # Emergency: 2 sessions remaining and not yet in workshop
    emergency = (
        self.remaining_sessions <= 2
        and self.current_phase != "workshop"
    )
    
    if natural_ready or forced or emergency:
        return "workshop"
    return None
```

#### Task 3.3.2: Phase Guardrails

| Phase | Min Sessions | Max Sessions | Enforcement |
|---|---|---|---|
| Explore | 2 | 50% of total | Cannot graduate before min; forced graduation at max |
| Develop | 2 | 40% of total | Same |
| Workshop | 2 | 30% of total | Guaranteed by forcing rules |

**Validation:**
- [ ] 10-session run: explore gets max 5, develop gets max 4, workshop gets min 2
- [ ] Forcing rules activate at correct thresholds
- [ ] Emergency workshop triggers at 2 remaining sessions
- [ ] Natural graduation works when signals are present
- [ ] Unique templates (logline, workshop_theme) are never duplicated
- [ ] Journey completes with "full" status when deliverables produced
- [ ] Journey reports "stalled" when session cap reached without deliverables

---

### Task 3.4: Workshop Session Integration (~1 hour)

Verify workshop templates work through the API:

- [ ] `create_session(story_id, name, guidance_mode="focus", template="workshop_theme")` succeeds
- [ ] `create_session(story_id, name, guidance_mode="focus", template="logline")` succeeds
- [ ] Second `logline` session returns an error (uniqueness constraint)
- [ ] `workshop_structure` sessions can be created multiple times
- [ ] Workshop sessions accept and respond to agent messages normally

---

## Phase 4: Evaluation (6–8 hours)

### Task 4.1: Observer — Fact Extraction and Challenge Generation (~2 hours)

**File:** `tests/simulation/reactive/observer.py`

#### Task 4.1.0: Observer Return-Type Dataclasses

Define all dataclasses used as return types by the Observer and evaluators:

```python
@dataclass
class ConversationalQualityScores:
    """Metrics unique to reactive simulation (spec Part 6.3)."""
    # Coherence
    within_session_coherence: float    # 0-1
    cross_session_coherence: float     # 0-1
    # Responsiveness
    direction_follow_rate: float       # 0-1
    pushback_handling: float           # 0-1
    # Building
    self_reference_rate: float         # 0-1
    suggestion_quality: float          # 0-1
    # Adaptation
    style_matching: float              # 0-1
    question_appropriateness: float    # 0-1
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @property
    def average(self) -> float:
        scores = [self.within_session_coherence, self.cross_session_coherence,
                  self.direction_follow_rate, self.pushback_handling,
                  self.self_reference_rate, self.suggestion_quality,
                  self.style_matching, self.question_appropriateness]
        return sum(scores) / len(scores)

@dataclass
class FactValidationResult:
    """Result of the Observer validating agent's self-reported facts."""
    confirmed_facts: list[str]         # fact_ids the agent claimed AND transcript confirms
    unconfirmed_facts: list[str]       # fact_ids the agent claimed but transcript doesn't support
    missed_facts: list[dict]           # Facts in transcript that agent didn't tag
    contradictions: list[dict]         # Contradictions between claimed and actual
    
    @property
    def accuracy(self) -> float:
        total = len(self.confirmed_facts) + len(self.unconfirmed_facts)
        return len(self.confirmed_facts) / total if total > 0 else 1.0

@dataclass
class JourneyCoherenceScores:
    """Journey mode specific metrics (spec Part 6.4)."""
    # Phase transitions
    explore_to_develop_quality: float     # 0-1, natural transition?
    develop_to_workshop_quality: float    # 0-1, enough material to synthesize?
    # Deliverable coherence
    theme_reflects_exploration: float      # 0-1, theme connects to explored ideas?
    logline_captures_story: float          # 0-1, logline reflects actual story?
    outline_consistent_with_decisions: float  # 0-1, outline matches decisions?
    bible_completeness: float              # 0-1, Story Bible captures major decisions?
    # Cross-deliverable consistency
    deliverable_alignment: float           # 0-1, do deliverables agree?
    # Journey completeness
    story_elements_coverage: float         # 0-1, protagonist/conflict/stakes/setting addressed?
    journey_completion: str                # "full" | "partial" | "stalled"
    # Human review flag
    human_review_recommended: bool = False
    human_review_notes: str = ""           # What the human should look for
    
    def to_dict(self) -> dict:
        return asdict(self)

@dataclass
class ObserverReport:
    """Aggregated output from the Observer's full post-run analysis."""
    fact_validation: FactValidationResult
    challenge_queries: list['ReactiveChallengeQuery']
    contradictions: list[dict]
    conversational_quality: ConversationalQualityScores
    journey_coherence: 'JourneyCoherenceScores | None'  # None for budget mode
    persona_consistency_score: float    # 0-1, measures simulation quality not Brainstormy's
    
    # Token tracking for all observer/evaluator calls
    total_input_tokens: int = 0
    total_output_tokens: int = 0
```

#### Task 4.1.1: Observer Class

```python
class Observer:
    def __init__(
        self,
        transcript: dict,          # Full transcript.json content
        agent_state: AgentState,   # Final agent state
        config: dict,              # Run config (genre, persona, mode, etc.)
        anthropic_client: anthropic.AsyncAnthropic,
    ):
        self.transcript = transcript
        self.agent_state = agent_state
        self.config = config
        self.client = anthropic_client
    
    async def analyze(self) -> ObserverReport:
        """Run full post-run analysis."""
    
    async def validate_fact_ledger(self) -> FactValidationResult:
        """
        Validate agent's self-reported facts against the transcript.
        The Observer is the authoritative ground truth (spec Part 6.1).
        
        - Confirms each claimed fact actually appears in the transcript
        - Identifies additional emerged facts the agent missed
        - Flags contradictions between claimed and actual
        """
    
    async def generate_challenge_queries(self) -> list[ReactiveChallengeQuery]:
        """
        Generate recall queries from what actually happened.
        
        Count: 1 per 2 sessions, capped at 10.
        Types: direct_recall, inference, cross_session
        Tests both user-stated and AI-suggested facts.
        
        NOTE: These queries are later executed by the ReactiveRunner directly
        via the API client (create session → send_message → evaluate response),
        NOT through the UserAgent. The agent is not involved in challenge query
        execution — it's a direct API interaction identical to the scripted runner
        pattern (phase 1 tasks, Task 1.4.2, step 4).
        """
    
    async def detect_contradictions(self) -> list[dict]:
        """Find contradictions within and across sessions."""
```

#### Task 4.1.2: ChallengeQuery Dataclass (reactive-specific)

```python
@dataclass
class ReactiveChallengeQuery:
    """A challenge query generated from the reactive run transcript."""
    query: str
    query_type: str              # "direct_recall" | "inference" | "cross_session"
    source_session: int          # Session where the fact was established
    source_message: int          # Message index
    expected_facts: list[str]    # What should be recalled
    source_attribution: str      # "agent" | "brainstormy"
```

**Challenge query session mechanics (spec Part 6.2):**
- The Observer generates queries; the **ReactiveRunner** executes them (not the UserAgent)
- Execution follows the scripted runner's pattern exactly: create a dedicated session per query → send query as a direct `send_message()` call → evaluate Brainstormy's response via `RetentionEvaluator`
- Each query gets its own session: `guidance_mode="explore"`, name `"[Recall Test] {query_type}"`
- `RetentionEvaluator` (existing, shared) evaluates responses
- Costs included in Part 8 model

**Validation:**
- [ ] Fact validation catches agent claims that aren't in the transcript
- [ ] Fact validation finds facts the agent missed
- [ ] Challenge queries are natural writer questions (not robotic)
- [ ] Query count follows formula: sessions // 2, capped at 10
- [ ] Contradiction detection finds within-session and cross-session contradictions

---

### Task 4.2: Conversational Quality Evaluators (~2 hours)

**File:** `tests/simulation/reactive/observer.py` (or `evaluators/conversational.py`)

#### Task 4.2.1: Tier 1 — Per-Session Evaluation

```python
async def evaluate_session_quality(
    self,
    session_transcript: dict,
    persona: WriterPersona,
    genre: str,
) -> dict:
    """
    Evaluate 4 metrics for one session in a single LLM call.
    Returns: {metric_name: {"score": float, "justification": str, "evidence": [str]}}
    
    Metrics:
    - within_session_coherence
    - direction_follow_rate
    - style_matching
    - question_appropriateness
    """
```

Uses the batched evaluation prompt from spec Part 6.3.1. One call per session evaluating all 4 metrics.

#### Task 4.2.2: Tier 2 — Cross-Session Evaluation

```python
async def evaluate_cross_session_quality(
    self,
    session_summaries: list[str],
    fact_ledger: dict,
    sampled_responses: list[str],
) -> dict:
    """
    Evaluate cross-session metrics (2-3 calls total).
    
    Metrics:
    - cross_session_coherence (from summaries + fact ledger)
    - self_reference_rate (from sampled responses)
    """
```

#### Task 4.2.3: Tier 3 — Event-Triggered Evaluation

```python
async def evaluate_pushback_handling(
    self,
    pushback_moments: list[dict],  # Filtered transcript segments
) -> dict:
    """Evaluate pushback_handling metric. Only called if pushback events exist."""

async def evaluate_suggestion_quality(
    self,
    sampled_suggestions: list[dict],  # Brainstormy suggestions with context
    genre: str,
) -> dict:
    """Evaluate suggestion_quality metric."""
```

#### Task 4.2.4: Quality Score Aggregator

```python
async def compute_conversational_quality(self) -> ConversationalQualityScores:
    """
    Run all evaluation tiers and aggregate into ConversationalQualityScores.
    
    Total calls:
    - Budget (10 sessions): ~14-17 calls
    - Journey (15 sessions): ~20-25 calls
    """
```

**Validation:**
- [ ] Per-session evaluator produces valid scores (0.0-1.0) for all 4 metrics
- [ ] Cross-session evaluator works with fact ledger input
- [ ] Pushback evaluation only triggers when pushback events exist
- [ ] All scores are 0.0-1.0 range
- [ ] Token usage tracked for all evaluator calls

---

### Task 4.3: Journey Coherence Evaluator (~2 hours)

**File:** `tests/simulation/reactive/observer.py`

#### Task 4.3.1: JourneyCoherenceEvaluator

```python
async def evaluate_journey_coherence(
    self,
    transcript: dict,
    fact_ledger: dict,
    phase_transitions: list[dict],
    deliverables: dict,        # workshop outputs (theme, logline, etc.)
) -> JourneyCoherenceScores:
    """
    Journey mode specific evaluation.
    2 LLM calls: one for phase transitions, one for deliverable coherence.
    """
```

**JourneyCoherenceScores** — implement the dataclass from spec Part 6.4.

**Evaluation approach:**
1. Phase transition quality: Feed phase transitions + surrounding session summaries → evaluate naturalness
2. Deliverable coherence: Feed deliverables + fact ledger → evaluate alignment
3. Journey completeness: Computed from agent state (not LLM-evaluated)

**Validation:**
- [ ] Coherence evaluator handles "full" journey completion
- [ ] Coherence evaluator handles "partial" completion (cap reached)
- [ ] Coherence evaluator handles "stalled" completion (no deliverables)
- [ ] `human_review_recommended` is set when scores are ambiguous (<0.7)

---

### Task 4.4: ReactiveMetricsCollector Subclass (~2 hours)

**File:** `tests/simulation/reactive/metrics.py`

#### Task 4.4.1: ReactiveRunMetrics

```python
@dataclass
class ReactiveRunMetrics(RunMetrics):
    """Extended metrics for reactive simulation runs."""
    
    simulation_type: str = "reactive"         # Discriminator field
    simulation_mode: str = "budget"           # "budget" | "journey"
    
    # Conversational quality (both modes)
    conversational_quality: dict | None = None  # ConversationalQualityScores as dict
    
    # Journey coherence (journey mode only)
    journey_coherence: dict | None = None       # JourneyCoherenceScores as dict
    
    # Fact tracking
    facts: dict | None = None                   # emerged_total, emerged_retained, etc.
    
    # Phase information (journey mode)
    phases: dict | None = None                  # explore_sessions, transitions, etc.
    
    # Cost tracking
    cost_tracking: dict | None = None           # agent_calls, tokens, estimated cost
```

#### Task 4.4.2: ReactiveMetricsCollector

```python
class ReactiveMetricsCollector(MetricsCollector):
    """Extends MetricsCollector with reactive-specific tracking."""
    
    def __init__(self, mode: str, genre: str, persona_key: str, 
                 environment: str = 'staging', run_id: str | None = None):
        # Auto-generate run_id: reactive_{mode}_{genre}_{persona}_{timestamp}
        ...
    
    # Additional tracking methods
    def record_agent_call(self, input_tokens: int, output_tokens: int): ...
    def record_evaluator_call(self, input_tokens: int, output_tokens: int): ...
    def set_conversational_quality(self, scores: ConversationalQualityScores): ...
    def set_journey_coherence(self, scores: JourneyCoherenceScores): ...
    def set_fact_summary(self, fact_summary: dict): ...
    def set_phase_info(self, phase_info: dict): ...
    
    def compile(self, retention_results, citation_results=None) -> ReactiveRunMetrics:
        """Override to produce ReactiveRunMetrics with all extended fields."""
```

**Run ID format:** `reactive_{mode}_{genre}_{persona}_{YYYYMMDD}_{HHMMSS}_{6-char-hex}`

**Validation:**
- [ ] `ReactiveRunMetrics` serializes to JSON with all fields including `simulation_type`
- [ ] `ReactiveRunMetrics` round-trips through save/load
- [ ] Scripted `RunMetrics` still works unchanged (no regressions)
- [ ] Cost tracking accurately reflects token usage
- [ ] `simulation_type` and `simulation_mode` are always present in output JSON

---

## Phase 5: Runner and Integration (4–5 hours)

### Task 5.1: Reactive Runner (~2 hours)

**File:** `tests/simulation/reactive/runner.py`

#### Task 5.1.1: ReactiveRunner Class

```python
class ReactiveRunner:
    def __init__(
        self,
        client: BrainstormyClient,
        config: SimulationConfig,
        reactive_config: ReactiveConfig,
    ):
        self.client = client
        self.config = config
        self.reactive_config = reactive_config
        self.metrics = ReactiveMetricsCollector(...)
        self.agent: UserAgent | None = None
        self.observer: Observer | None = None
    
    async def run(self) -> ReactiveRunMetrics:
        """Full reactive simulation run."""
```

#### Task 5.1.2: Budget Mode Flow

```python
async def _run_budget_mode(self) -> ReactiveRunMetrics:
    """
    1. Generate fact budget and session plan
    2. Create project (is_series=True), story, configure Navigator, set working method
    3. Initialize agent with fact budget
    4. Run sessions per plan
    5. Post-run: wait grace period, fetch summaries
    6. Observer analysis → challenge queries → retention evaluation
    7. Compile metrics
    """
```

#### Task 5.1.3: Journey Mode Flow

```python
async def _run_journey_mode(self) -> ReactiveRunMetrics:
    """
    1. Create project (is_series=True), story, configure Navigator, set working method
    2. Initialize agent with seed
    3. Loop: progression engine suggests next session → agent runs it
    4. Check journey completion after each session
    5. Post-run: wait grace period, fetch summaries
    6. Observer analysis → challenge queries → retention + coherence evaluation
    7. Compile metrics
    """
```

#### Task 5.1.4: Shared Session Loop

```python
async def _run_reactive_session(
    self,
    story_id: str,
    session_spec: SessionSpec,
    session_index: int,
) -> dict:
    """
    Shared per-session loop (identical for both modes).
    
    1. Create session via API
    2. Get opening message via get_messages(session_id)
    3. Agent reads opening, generates first response
    4. Send to Brainstormy, receive AI response
    5. Agent reads response, decides next action
    6. Repeat until target message count or agent signals wrap_up
    7. End session
    8. Agent generates session summary (for context management)
    9. Return session transcript
    """
```

**Error recovery (spec Part 1.2.1):**
- `send_message()` 500 → retry with backoff (max 3), reuse same agent message
- Agent LLM malformed JSON → retry once, then regex fallback
- Brainstormy empty response → agent pushes for specifics (persona-appropriate)
- 429 rate limiting → exponential backoff, respect Retry-After
- Session creation fails → skip, log gap, continue
- Unrecoverable session error → end session, continue to next

**Opening message handling:**
- After `create_session()`, call `get_messages(session_id)` to retrieve AI opening
- Logline sessions skip this — agent sends first message unprompted
- If no opening message retrieved, agent generates a seed-based opener

#### Task 5.1.5: Working Method Setup

**Requires extending `api_client.py` with two additions:**

**First:** Add `_put()` convenience wrapper (the existing client only has `_get`, `_post`, `_delete`):

```python
# In api_client.py — new convenience wrapper (mirrors _post)
async def _put(self, path: str, json: dict | None = None) -> dict:
    return await self._request('PUT', path, json=json)
```

**Second:** Add the `set_working_method()` endpoint method:

```python
# In api_client.py — new method
async def set_working_method(self, method: str) -> dict:
    """
    Set the user's working method preference.
    NOTE: Path is /users/me/preferences (no /api prefix — _request() prepends it).
    
    ⚠️ UNVERIFIED — verify endpoint exists before first use.
    Check backend/api/users.py and backend/config/working_method.py.
    """
    return await self._put('/users/me/preferences', json={'working_method': method})
```

**Before first use:** Verify the endpoint exists by checking `backend/api/users.py`. If the endpoint shape differs or doesn't exist, update accordingly.

#### Task 5.1.6: Post-Run Summary Fetch

```python
async def _post_run_summary_fetch(
    self,
    session_ids: list[str],
    grace_period_seconds: int = 600,
) -> dict[str, str | None]:
    """
    Wait grace period, then batch-fetch all session summaries.
    Spec Part 8: Known issue — staging summaries exceed poll timeout.
    """
    await asyncio.sleep(grace_period_seconds)
    summaries = {}
    for sid in session_ids:
        try:
            summary = await self.client.get_summary(sid)
            summaries[sid] = summary.get("content")
        except Exception:
            summaries[sid] = None
    return summaries
```

**Validation:**
- [ ] Budget mode creates project, generates budget, runs sessions, produces metrics
- [ ] Journey mode creates project, navigates phases, produces metrics
- [ ] Error recovery handles 500, malformed JSON, empty responses
- [ ] Session loop sends messages and reads responses correctly
- [ ] Opening messages retrieved via get_messages()
- [ ] Working method set at run start (or gracefully skip if unverified)
- [ ] Post-run summary fetch works after grace period
- [ ] Agent state persists across sessions

---

### Task 5.2: CLI Entry Point (~1 hour)

**File:** `tests/simulation/reactive/runner.py` (bottom) or `tests/simulation/reactive/__main__.py`

#### Task 5.2.1: Reactive CLI

```python
def build_reactive_parser() -> argparse.ArgumentParser:
    """Build CLI parser for reactive simulation."""

# CLI flags:
# --mode {budget,journey}     Mode (required)
# --genre <genre_key>         Genre (default: fantasy)
# --persona <persona_key>     Persona (default: verbose_explorer)
# --sessions <int>            Session count (default: 10)
# --messages-min <int>        Min messages per session (default: 4)
# --messages-max <int>        Max messages per session (default: 8)
# --working-method {supportive,balanced,direct}  (default: balanced)
# --seed-type <type>          Journey mode seed type (default: premise)
# --seed <text>               Journey mode seed content (required for journey)
# --session-mix <mix>         Budget mode session type mix (default: natural_progression)
# --env {staging,local}       Target environment (default: staging)
# --dry-run                   Print plan without running
# --cleanup                   Delete project after run
# --verbose / -v              Debug logging
# --list-personas             List available personas and exit
# --list-genres               List available genres and exit
```

**`__main__.py`:**
```python
"""Allow running as: python -m tests.simulation.reactive"""
from .runner import main
main()
```

**Invocation examples:**
```bash
# Budget mode
python -m tests.simulation.reactive --mode budget --genre fantasy --persona verbose_explorer --sessions 10

# Journey mode
python -m tests.simulation.reactive --mode journey --genre mystery --persona efficient_plotter --sessions 15 --seed-type premise --seed "a murder where the victim left clues in their will"

# Dry run
python -m tests.simulation.reactive --mode budget --genre romance --sessions 5 --dry-run

# List options
python -m tests.simulation.reactive --list-personas
python -m tests.simulation.reactive --list-genres
```

**Validation:**
- [ ] `--list-personas` prints all 5 personas with descriptions
- [ ] `--list-genres` prints all 11 genres
- [ ] `--dry-run` prints execution plan (mode, genre, persona, sessions, estimated cost)
- [ ] Journey mode requires `--seed` argument
- [ ] Budget mode ignores `--seed` argument
- [ ] CLI parses all flag combinations correctly

---

### Task 5.3: Output Files (~1 hour)

#### Task 5.3.1: Transcript Writer

```python
def write_transcript(
    run_id: str,
    sessions: list[dict],
    errors: list[dict],
    output_dir: str,
) -> str:
    """Write transcript.json matching spec Part 1.4.1 schema."""
```

#### Task 5.3.2: Fact Ledger Writer

```python
def write_fact_ledger(
    run_id: str,
    mode: str,
    agent_state: AgentState,
    output_dir: str,
) -> str:
    """Write fact_ledger.json matching spec schema."""
```

#### Task 5.3.3: Session Plans Writer

```python
def write_session_plans(
    run_id: str,
    mode: str,
    planned: list[dict] | None,
    actual: list[dict],
    graduation_log: list[dict] | None,
    output_dir: str,
) -> str:
    """Write session_plans.json — different schema for budget vs journey mode."""
```

#### Task 5.3.4: Journey Report Writer

```python
def write_journey_report(
    run_id: str,
    coherence_scores: JourneyCoherenceScores,
    raw_evaluator_responses: list[dict],
    output_dir: str,
) -> str:
    """Write journey_report.json (journey mode only)."""
```

**Output directory:** `tests/simulation/results/{run_id}/`

**Validation:**
- [ ] All 4 output files are valid JSON
- [ ] Transcript includes agent reasoning and decision fields
- [ ] Fact ledger tracks both planned and emerged facts
- [ ] Session plans match spec schemas for both modes
- [ ] Journey report includes raw evaluator responses

---

### Task 5.4: WhatsApp Notification (~1 hour)

Extend the existing WhatsApp notification (from scripted runner) to include reactive-specific information:

```
🐻 Reactive Simulation Complete
Mode: Journey | Genre: Fantasy
Persona: Verbose Explorer
Sessions: 12/15 | Phases: E→D→W
Status: ✅ PASS
Retention: 78% | Coherence: 0.82
Conversational Quality: 0.81 avg
Duration: 42m 18s
Est. Cost: $4.25
Run ID: reactive_journey_fantasy_verbose_20260215_160000_a1b2c3
```

**Validation:**
- [ ] Notification sends for budget mode runs
- [ ] Notification sends for journey mode runs (includes phase info)
- [ ] Notification includes estimated cost
- [ ] Runner completes normally when Twilio credentials absent

---

## Phase 6: Validation (2–3 hours)

### Task 6.1: Budget Mode Validation (~1 hour)

Run 2 budget mode simulations on staging:

**Run 1:** Fantasy + Verbose Explorer, 10 sessions
```bash
python -m tests.simulation.reactive --mode budget --genre fantasy --persona verbose_explorer --sessions 10 --env staging --verbose
```

**Run 2:** Mystery + Efficient Plotter, 10 sessions
```bash
python -m tests.simulation.reactive --mode budget --genre mystery --persona efficient_plotter --sessions 10 --env staging --verbose
```

**Verify for both:**
- [ ] All sessions complete without unrecoverable errors
- [ ] Agent maintains persona voice throughout
- [ ] Fact budget generated and facts distributed
- [ ] ≥80% of planned facts established naturally
- [ ] Challenge queries generated and evaluated
- [ ] metrics.json produced with all required fields
- [ ] transcript.json has agent reasoning for each message
- [ ] fact_ledger.json tracks planned + emerged facts
- [ ] Cost tracking reflects actual token usage

---

### Task 6.2: Journey Mode Validation (~1 hour)

Run 2 journey mode simulations on staging:

**Run 1:** Fantasy + Verbose Explorer, 15 sessions, character seed
```bash
python -m tests.simulation.reactive --mode journey --genre fantasy --persona verbose_explorer --sessions 15 --seed-type character --seed "a mapmaker whose maps change the landscape" --env staging --verbose
```

**Run 2:** Romance + Anxious Beginner, 10 sessions, vibe seed
```bash
python -m tests.simulation.reactive --mode journey --genre romance --persona anxious_beginner --sessions 10 --seed-type vibe --seed "warm, witty, slow burn" --env staging --verbose
```

**Verify for both:**
- [ ] Agent navigates all 3 phases (explore → develop → workshop)
- [ ] Phase transitions logged with signals
- [ ] At least workshop_theme and logline sessions attempted
- [ ] journey_report.json produced with coherence scores
- [ ] Agent responds to Brainstormy's suggestions (not ignoring them)
- [ ] Journey completion state is "full" or "partial" (not "stalled")

---

### Task 6.3: Prompt Tuning and Pipeline Compatibility (~1 hour)

**Prompt tuning:**
- Review transcripts from 6.1 and 6.2
- Identify any persona drift, fact introduction awkwardness, or evaluation scoring anomalies
- Adjust prompts in `prompts.py` as needed

**Pipeline compatibility:**
- [ ] `metrics.json` includes `simulation_type: "reactive"` discriminator
- [ ] `metrics.json` includes `simulation_mode: "budget"` or `"journey"`
- [ ] Existing scripted simulation still runs without regressions
- [ ] Both scripted and reactive results files can coexist in `results/` directory

---

## End-to-End Validation (after all phases)

Run this sequence to confirm the full reactive simulation works:

```bash
# 1. List available options
python -m tests.simulation.reactive --list-personas
python -m tests.simulation.reactive --list-genres

# 2. Dry run
python -m tests.simulation.reactive --mode budget --genre fantasy --sessions 5 --dry-run

# 3. Quick budget run (5 sessions)
python -m tests.simulation.reactive --mode budget --genre fantasy --persona efficient_plotter --sessions 5 --env staging --verbose

# 4. Quick journey run (5 sessions)
python -m tests.simulation.reactive --mode journey --genre mystery --persona anxious_beginner --sessions 5 --seed-type vibe --seed "cozy village mystery with a sharp edge" --env staging --verbose

# 5. Verify outputs
ls tests/simulation/results/reactive_*/
cat tests/simulation/results/reactive_*/metrics.json | python -m json.tool | head -50

# 6. Full budget run (10 sessions)
python -m tests.simulation.reactive --mode budget --genre fantasy --persona verbose_explorer --sessions 10 --env staging

# 7. Full journey run (15 sessions)
python -m tests.simulation.reactive --mode journey --genre fantasy --persona verbose_explorer --sessions 15 --seed-type character --seed "a mapmaker whose maps change the landscape" --env staging
```

**Reactive simulation is complete when:**
- [ ] Both modes run end-to-end on staging without crashes
- [ ] Agent maintains distinct persona voice across all 5 personas
- [ ] Budget mode: ≥80% planned fact establishment rate
- [ ] Journey mode: navigates all 3 phases, produces deliverables
- [ ] Challenge queries evaluate retention successfully
- [ ] Conversational quality scores populate for all 8 metrics
- [ ] All output files (metrics, transcript, fact_ledger, session_plans, journey_report) are valid JSON
- [ ] Cost tracking matches estimates within 2x
- [ ] WhatsApp notification sends on completion
- [ ] Scripted simulation still works (no regressions)

---

## Appendix: File Summary

| File | Phase | Purpose |
|------|-------|---------|
| `reactive/__init__.py` | 1 | Package init |
| `reactive/personas.py` | 1.1 | WriterPersona definitions, 5 built-in personas |
| `reactive/agent.py` | 1.2 | UserAgent — message generation, drift detection |
| `reactive/prompts.py` | 1.3 | All LLM prompt templates |
| `reactive/state.py` | 1.4 | AgentState, FactStatus, EmergedFact, supporting dataclasses |
| `reactive/session_planner.py` | 2 | Fact budget generation, SessionPlanner, SessionPlan |
| `reactive/progression.py` | 3 | Seed, ProgressionEngine, graduation logic |
| `reactive/observer.py` | 4.1–4.3 | Observer, ObserverReport, FactValidationResult, ConversationalQualityScores, quality evaluators, journey coherence |
| `reactive/metrics.py` | 4.4 | ReactiveMetricsCollector, ReactiveRunMetrics |
| `reactive/runner.py` | 5.1–5.2 | ReactiveRunner, CLI, session loop |
| `reactive/output.py` | 5.3 | Transcript/ledger/plan/report writers |
| `reactive/__main__.py` | 5.2 | `python -m tests.simulation.reactive` entry point |
| `reactive/test_agent_standalone.py` | 1.5 | Standalone agent loop test |
| `api_client.py` | 5.1 | **Extended** with `_put()` wrapper and `set_working_method()` |
| `config.py` | Notes | **Extended** with `ReactiveConfig` (defined in Implementation Notes) |
