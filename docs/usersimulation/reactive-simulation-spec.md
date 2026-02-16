# Reactive User Simulation Specification

## Overview

The Reactive User Simulation is an LLM-driven simulated writer that conducts genuine conversations with Brainstormy. Unlike the scripted simulation framework (which sends pre-written messages and ignores Brainstormy's responses), the reactive system reads each AI response, reasons about it, and generates contextually appropriate follow-up messages — just as a real writer would.

This tests what scripted simulation cannot: conversational coherence, responsiveness to user direction, within-session consistency, and Brainstormy's ability to be a useful creative partner across diverse writing styles and genres.

### What This Is

An autonomous agent that uses Brainstormy as a real user would — creating projects, opening sessions, brainstorming story ideas, responding to Brainstormy's suggestions, pushing back, changing direction, getting excited, going deep on details — then measuring how well Brainstormy performed across the full interaction.

### What This Is Not

- Not a replacement for scripted simulation. Scripted runs are reproducible and fast. Reactive runs are non-deterministic and slower. Both are needed.
- Not a UI test. This operates at the API level via `httpx`, same as the scripted framework. The QA Engine handles UI testing.
- Not a load test. This simulates one writer at realistic pace, not concurrent users.

### Scope: Fiction / Novels Only

Version 1 of Brainstormy ships as a fiction/novel development platform. All simulation parameters, personas, and evaluation criteria are scoped to novel writing. Screenwriting, TTRPG, and non-fiction are excluded from v1 testing. Future subscription types may expand the simulation to other verticals.

### Relationship to Existing Systems

| System | Tests | How |
|---|---|---|
| QA Engine | UI renders correctly, buttons work, pages load | Playwright browser automation |
| Scripted Simulation | Memory retention at scale, citation accuracy | Pre-written messages, ignores AI responses |
| **Reactive Simulation** | **Conversational quality, memory + interactivity** | **LLM reads and responds to Brainstormy dynamically** |

### Two Testing Modes

The reactive simulation operates in two distinct modes that test different things:

| | Budget Mode | Journey Mode |
|---|---|---|
| **Purpose** | Tests the memory engine | Tests the product experience |
| **Starting input** | Genre + persona + auto-generated fact budget | Genre + persona + seed idea (theme, character, etc.) |
| **Session planning** | Pre-planned arc with fact targets | Agent decides session types based on conversation flow |
| **Primary metric** | Retention of planned facts | Coherence of final deliverables |
| **Automated scoring** | High (fact recall is binary) | Medium (coherence requires judgment) |
| **Human review needed** | Low | High (but high-value) |
| **What it catches** | Search failures, summary gaps, context truncation | UX dead ends, guidance quality, creative partnership |
| **Dashboard question it answers** | "Does Brainstormy remember what users tell it?" | "Does Brainstormy actually help someone write a novel?" |

Both modes share the same agent architecture, personas, and conversation loop. They differ in planning, evaluation, and what "success" means.

### Design Principle

The reactive simulation should be **configurable enough to cover the usage patterns that worry you**, without requiring you to author scenario scripts. You pick genre, persona, mode, and scale from visual controls — the system generates everything else at runtime.

---

## Part 1: Architecture

### 1.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Reactive Simulation                        │
│                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐  │
│  │  User Agent   │────▶│  Brainstormy  │────▶│  User Agent   │  │
│  │  (generates   │     │  API          │     │  (reads       │  │
│  │   message)    │◀────│  (responds)   │◀────│   response)   │  │
│  └──────┬───────┘     └──────────────┘     └──────────────┘  │
│         │                                                     │
│  ┌──────┴───────┐                                             │
│  │  Agent State  │  Tracks: conversation arc, established     │
│  │              │  facts, session goals, persona voice,       │
│  │              │  story decisions, readiness signals         │
│  └──────┬───────┘                                             │
│         │                                                     │
│  ┌──────┴───────────────────────────────────┐                 │
│  │  Mode-Specific Controller                 │                 │
│  │                                           │                 │
│  │  Budget Mode: SessionPlanner + FactBudget │                 │
│  │  Journey Mode: ProgressionEngine + Seeds  │                 │
│  └──────┬───────────────────────────────────┘                 │
│         │                                                     │
│  ┌──────┴───────┐                                             │
│  │  Observer     │  Post-run: extracts emerged facts,         │
│  │              │  scores quality, generates challenges,       │
│  │              │  evaluates deliverable coherence             │
│  └──────────────┘                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Conversation Loop

For each session, the agent runs a message loop:

```
1. Create session via API → Brainstormy auto-generates an opening message
2. Agent reads Brainstormy's opening message
3. Agent generates first message as a response to the opening
4. Send to Brainstormy API → receive AI response
5. Agent reads AI response
6. Agent decides: continue thread, redirect, push back, go deeper, or wrap up
7. Agent generates next message informed by AI response
8. Repeat 4-7 until session message target reached (or agent signals done)
9. End session, wait for summary
```

**Note:** Brainstormy auto-generates an opening AI message when a session is created (except for logline sessions, which skip this). This means the first message in every session is from Brainstormy, not the user. The agent's first action is always to *read and respond to* Brainstormy's opening, which is how real users experience the product.

The critical difference from scripted simulation: **step 6**. The agent's next message depends on what Brainstormy said. If Brainstormy suggests something interesting, the agent might pursue it. If Brainstormy contradicts an earlier decision, the agent might call it out. If Brainstormy gives a generic response, the agent might push for specifics.

### 1.3 Repository Location

Extends the existing simulation framework:

```
tests/simulation/
├── runner.py               # EXISTING — scripted runner
├── reactive/               # NEW — reactive simulation
│   ├── __init__.py
│   ├── agent.py            # The simulated writer LLM agent
│   ├── personas.py         # Writer persona definitions
│   ├── state.py            # Agent conversation state tracker
│   ├── observer.py         # Post-run analysis and fact extraction
│   ├── session_planner.py  # Budget mode: plans session arcs and goals
│   ├── progression.py      # Journey mode: graduation logic and seed handling
│   ├── runner.py           # Reactive simulation orchestrator (both modes)
│   └── prompts.py          # All LLM prompts for the agent
├── api_client.py           # EXISTING — shared
├── metrics.py              # EXISTING — shared (extended)
├── evaluators/             # EXISTING — shared
└── config.py               # EXISTING — extended with reactive config
```

### 1.4 Output Format

Both modes produce the same base `metrics.json` format as scripted simulation, ensuring compatibility with the quality improvement pipeline. Mode-specific metrics are appended:

```
tests/simulation/results/{run_id}/
├── metrics.json              # Standard retention + mode-specific metrics
├── transcript.json           # Full conversation transcript with agent reasoning
├── fact_ledger.json          # All facts: planned + emerged, with status
├── session_plans.json        # Budget: planned vs actual. Journey: graduation log
└── journey_report.json       # Journey mode only: deliverable coherence analysis
```

---

## Part 2: Configuration Parameters

These are the parameters that will become visual controls on the dashboard.

### 2.1 Mode

**Options:** `budget` | `journey`

- **Budget mode:** Tests memory engine. Agent gets a generated fact budget and session plan. Evaluation is primarily automated.
- **Journey mode:** Tests product experience. Agent starts with a seed idea and navigates the full Brainstormy workflow. Evaluation is mixed automated + human review.

### 2.2 Genre

Selects the Navigator key and shapes the story the agent develops.

**Options:** `fantasy`, `mystery`, `romance`, `science_fiction`, `horror`, `thriller`, `literary`, `historical`, `middle_grade`, `young_adult`, `general_editorial`

**Effect:** Sets the Navigator via `PUT /api/stories/{id}/navigator`, and instructs the agent LLM to brainstorm within that genre's conventions.

### 2.3 Writer Persona

Defines *how* the simulated writer communicates — their verbosity, planning style, expertise level, and conversational patterns. This is the key variable for testing whether Brainstormy handles diverse interaction styles.

```python
@dataclass
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
```

**Built-in Personas (5):**

| Persona | Verbosity | Planning | Pushback | Expertise | Tests |
|---|---|---|---|---|---|
| **Efficient Plotter** | Terse, short | Plotter, quick decisions | Often | Experienced | Minimal input, rapid decisions |
| **Verbose Explorer** | Verbose, long | Pantser, indecisive | Rarely | Beginner | Message volume, tangent handling |
| **Revisionist** | Moderate | Plantser, indecisive | Often | Experienced | Fact evolution, contradiction tracking |
| **Methodical Worldbuilder** | Moderate | Plotter, deliberate | Sometimes | Intermediate | Deep systematic exploration |
| **Anxious Beginner** | Moderate | Pantser, deliberate | Rarely | Beginner | Encouragement, supportiveness |

Full persona definitions with voice descriptions and example messages are in the implementation (see `personas.py` in Part 1.3).

### 2.4 Scale Parameters

**Sessions:** Integer, 1–100. Default 10. In budget mode, this is the exact session count. In journey mode, this is the maximum — the agent may finish earlier if it completes the full workflow.

**Messages per session:** Range with min/max. Default 4–8. The agent targets a random count within this range for each session, adjusting based on conversation flow.

**Session type mix (budget mode only):** Controls the ratio of explore vs. focus sessions:
- **All explore** — Pure brainstorming
- **Natural progression** (default) — Starts explore, transitions to focus
- **Heavy focus** — Mostly focused sessions
- **Custom** — Specify percentages per template

In journey mode, session type mix is not configurable — the agent decides when to graduate based on readiness signals (see Part 5).

### 2.5 Seed (Journey Mode Only)

The starting point for an open-ended exploration. The agent begins with this and nothing else.

```python
@dataclass
class Seed:
    """Starting point for journey mode."""
    seed_type: str   # "theme" | "character" | "antagonist" | "premise" | "vibe" | "situation"
    content: str     # The seed itself — free text
```

**Seed types:**

| Type | Example | What it provides |
|---|---|---|
| `theme` | "isolation and connection in the digital age" | Abstract concept, no story specifics |
| `character` | "a retired detective who starts losing her memory" | One character, no plot |
| `antagonist` | "a corporation that replaces people's dreams with ads" | Opposing force, no protagonist |
| `premise` | "what if gravity reversed for one hour every day" | Speculative hook, no characters |
| `vibe` | "cozy mystery in a small seaside town" | Tone and setting, almost nothing else |
| `situation` | "two estranged siblings inherit a haunted bookshop" | Starting scenario, no direction |

The agent's first session opens with a natural message about the seed, as if the user just sat down with this one idea and wants to explore it.

### 2.6 Fact Budget (Budget Mode Only)

Auto-generated at run start based on genre and session count. An LLM creates a story premise and genre-appropriate facts spread across a planned session arc. Approximately 3–5 facts per session. Some facts are marked `flexible=True`, allowing the agent to modify them if Brainstormy suggests something compelling.

### 2.7 Parameter Summary

**Shared parameters (both modes):**

| Parameter | Type | Options | Default | Dashboard Control |
|---|---|---|---|---|
| Mode | Select | `budget`, `journey` | `budget` | Toggle or radio buttons |
| Genre | Select | 11 navigator keys | `fantasy` | Dropdown |
| Persona | Select | 5 built-in personas | `verbose_explorer` | Dropdown with preview |
| Sessions | Integer | 1–100 | 10 | Slider |
| Messages per session | Range | min 2–15, max 3–20 | 4–8 | Dual slider |
| Working method | Select | supportive, balanced, direct | `balanced` | Dropdown |

**Working method note:** Working method is a *user-level* preference (stored in `users.settings` JSONB), not a per-story or per-session setting. It's configured via `PUT /api/users/me/preferences`, not a story endpoint. The runner must call this once at the start of each run. **Requires adding `set_working_method()` to `api_client.py`:**

```python
async def set_working_method(self, method: str) -> dict:
    return await self._put('/users/me/preferences', json={'working_method': method})
```

**Budget mode only:**

| Parameter | Type | Options | Default | Dashboard Control |
|---|---|---|---|---|
| Session type mix | Select | 4 presets + custom | Natural progression | Radio buttons |

**Journey mode only:**

| Parameter | Type | Options | Default | Dashboard Control |
|---|---|---|---|---|
| Seed type | Select | 6 types | `premise` | Dropdown |
| Seed content | Text | Free text | (required) | Text input |

---

## Part 3: The User Agent

### 3.1 Agent Architecture

The agent is an LLM (Claude Sonnet) prompted to behave as a specific writer persona. It maintains conversation state and makes decisions about what to say next based on Brainstormy's responses. The agent works identically in both modes — the difference is what drives its session-level goals.

The agent prompt includes mode-specific context injected into a `{mode_context}` section:

- **Budget mode context:** Lists remaining facts to establish in this session, instructs the agent to weave them naturally into conversation.
- **Journey mode context:** Describes the current creative phase (explore/develop/workshop), the seed idea, what's been decided so far, and encourages the agent to follow its curiosity while tracking readiness to advance.

### 3.2 Agent Decision Making

The agent doesn't just generate messages — it makes strategic decisions that mimic real writer behavior:

**Responding to suggestions:** When Brainstormy proposes something, the agent evaluates it against the persona's tendencies. A `pushback_frequency="often"` persona rejects ~40% of suggestions. An `anxious_beginner` accepts almost everything.

**Pacing fact establishment (budget mode):** The session planner distributes facts across sessions. The agent finds natural moments to introduce them. Unfit facts get deferred to the next session.

**Sensing readiness (journey mode):** The agent assesses whether enough story material has emerged to graduate to the next phase. It reports `readiness_signals` that the progression engine uses to decide transitions.

**Handling tangents:** Based on `tangent_tendency`, the agent occasionally goes off-topic, testing whether Brainstormy can follow and return.

**Session wrap-up:** As the agent approaches the target message count, it naturally converges — making final decisions, summarizing, and signaling readiness to move on.

### 3.3 Agent State

Tracks story decisions, open questions, rejected ideas, established facts (planned + emerged), conversation history, direction changes, and (journey mode) readiness signals and current phase. Full dataclass in implementation.

---

## Part 4: Budget Mode — Session Planning and Fact Budget

### 4.1 Session Planner

Before the simulation begins, the session planner creates a high-level arc. Not a rigid script — a loose plan the agent adapts.

### 4.2 Session Type Progression

The "natural progression" mix:
```
Sessions 1-3:  Explore — broad brainstorming, premise, characters
Sessions 4-6:  Mix of explore + character/world focus
Sessions 7-9:  Plot focus, scene development
Sessions 10+:  Deeper focus sessions, refinement
```

Genre shapes template distribution. Fantasy skews world-building. Mystery skews plot. Romance skews character.

**Explore template note:** Budget mode explore sessions default to `template="open"`, but the `problem` template is available for variety. The session planner may use `template="problem"` for mid-run explore sessions where the agent is working through a specific story problem (e.g., "how do I resolve this plot hole?") rather than open-ended brainstorming.

### 4.3 Fact Distribution

- **Character facts** → Early explore + character focus sessions
- **World facts** → Spread across explore + world sessions
- **Plot facts** → Later sessions once characters/world exist
- **Relationship facts** → After relevant characters are established

3–5 target facts per session. Deferred facts roll forward.

---

## Part 5: Journey Mode — Progression Engine

### 5.1 The Creative Journey

Journey mode simulates the path a real novelist takes through Brainstormy, starting with almost nothing and building toward a complete story framework:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   EXPLORE    │────▶│   DEVELOP    │────▶│  WORKSHOP    │
│              │     │              │     │              │
│ Explore      │     │ Focus        │     │ Workshop     │
│ sessions     │     │ sessions     │     │ templates    │
│              │     │              │     │              │
│ Discover     │     │ Deepen       │     │ Synthesize   │
│ the story    │     │ elements     │     │ deliverables │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Explore phase:** Open-ended brainstorming using Explore sessions. The agent starts from the seed and follows creative threads. No structure imposed.

**Develop phase:** Focused development using Focus sessions (character, plot, world, scene, dialogue). The agent picks specific elements to deepen based on what emerged during exploration.

**Workshop phase:** Synthesis using Workshop templates (theme, logline, outline). The agent works toward concrete deliverables that capture the story developed in prior phases.

### 5.2 Graduation Logic

The progression engine decides when to graduate between phases. This is **not** pre-scheduled — it depends on what actually happened in conversation.

**Explore → Develop signals:**
- Agent has named 2+ characters
- Agent has established a core conflict or premise
- Agent references earlier decisions ("going back to what we said about...")
- Agent expresses desire to go deeper ("I want to really figure out who she is")
- Agent has been in explore for 3+ sessions

**Develop → Workshop signals:**
- Agent has developed at least one character in depth
- Agent has a clear conflict/plot direction
- Agent has enough world-building for the genre
- Agent starts thinking about structure ("how does this all fit together?")
- Agent has been in develop for 3+ sessions
- Remaining session budget ≤ 30% of total (forces graduation)

**Phase guardrails:**

| Phase | Minimum Sessions | Maximum Sessions | Notes |
|---|---|---|---|
| Explore | 2 | 50% of total | Must establish basic story material |
| Develop | 2 | 40% of total | Must deepen at least 2 elements |
| Workshop | 2 | 30% of total | Must attempt theme + logline at minimum |

### 5.3 Session Selection in Journey Mode

**Complete template reference:**

| Mode | Templates | Notes |
|---|---|---|
| Explore | `open` (default), `problem` | `problem` is for problem-focused exploration |
| Focus | `character`, `plot`, `scene`, `world`, `logline`, `dialogue`, `outline_section`, `custom` | `custom` references user-created focus areas |
| Workshop | `workshop_theme`, `workshop_act`, `workshop_sequence`, `workshop_scene`, `workshop_beat`, `workshop_structure` | `workshop_structure` is the unified template combining the granular hierarchy (`act` → `sequence` → `scene` → `beat`) |

The reactive simulation uses a subset in v1. Journey mode uses `workshop_structure` for synthesis rather than the granular hierarchy — the granular templates (`workshop_act`, etc.) are available for future enhancement. The `custom` template is also excluded from v1 since it depends on user-created focus areas.

**Explore phase:** `guidance_mode="explore"`, defaults to `template="open"`. The `problem` template is available for problem-focused exploration but not used in v1 journey mode (available for budget mode variety — see Part 4). Topics derived from seed + conversation flow.

**Develop phase:** `guidance_mode="focus"` with template selected by need:
- Undeveloped characters → `template="character"`, `focus_target_name="<n>"`
- Unclear world rules → `template="world"`
- Loose plot structure → `template="plot"`
- Key scenes identified → `template="scene"`
- Dialogue voice exploration → `template="dialogue"`

**Workshop phase:** `guidance_mode="focus"` with workshop templates:
- First → `template="workshop_theme"`
- After theme → `template="logline"`
- After logline → `template="workshop_structure"` or `template="outline_section"`

**Uniqueness constraints:** The backend enforces **one `logline` session and one `workshop_theme` session per story**. Creating a duplicate returns an error. The `ProgressionEngine` must track which unique templates have been used and never attempt to create a second one:

```python
class ProgressionEngine:
    def __init__(self, session_cap: int):
        ...
        self.used_unique_templates: set[str] = set()  # tracks "logline", "workshop_theme"
    
    def suggest_next_session(self, agent_state, current_phase) -> SessionSpec:
        ...
        # Never suggest a unique template that's already been created
        if candidate_template in ("logline", "workshop_theme"):
            if candidate_template in self.used_unique_templates:
                # Skip to next workshop step
                ...
```

The agent’s session-opening message reflects transitions naturally. A real writer might say: “Okay, I feel like I have a solid handle on the characters and the world. Let me try to figure out what this story is actually *about*.”

### 5.4 Emerged Fact Tracking

In journey mode, **all facts are emerged facts**. There's no pre-planned budget. The agent and observer track what gets established — who stated it (agent or Brainstormy), when, and whether it was later modified.

---

## Part 6: Post-Run Evaluation

### 6.1 The Observer

After all sessions complete, the Observer analyzes the full transcript. Works for both modes with different emphasis.

**Both modes:**
- Emerged fact extraction and validation
- Challenge query generation
- Conversational quality scores
- Contradiction detection

**Budget mode additionally:**
- Planned fact recall evaluation

**Journey mode additionally:**
- Phase transition quality
- Deliverable coherence analysis
- Journey completeness score

### 6.2 Challenge Query Generation

Both modes generate challenge queries from what actually happened. Queries test recall of specific facts from different sessions, include direct recall and inference types, test both user-stated and AI-suggested facts, and are phrased as natural writer questions.

### 6.3 Conversational Quality Metrics (Both Modes)

```python
@dataclass
class ConversationalQualityScores:
    """Metrics unique to reactive simulation."""
    
    # Coherence
    within_session_coherence: float    # 0-1, contradictions within a session?
    cross_session_coherence: float     # 0-1, consistent across sessions?
    
    # Responsiveness
    direction_follow_rate: float       # 0-1, when user redirects, does AI follow?
    pushback_handling: float           # 0-1, quality when user disagrees
    
    # Building
    self_reference_rate: float         # 0-1, references its own earlier ideas?
    suggestion_quality: float          # 0-1, genre-appropriate and useful?
    
    # Adaptation
    style_matching: float              # 0-1, response style matches writer level?
    question_appropriateness: float    # 0-1, useful questions (not interrogative)?
```

Each metric scored by LLM evaluator reviewing transcript sections with specific rubrics.

### 6.4 Journey Mode: Deliverable Coherence Analysis

Journey mode's unique evaluation layer. After workshops, the observer checks whether deliverables are coherent with each other and with the developed story:

```python
@dataclass
class JourneyCoherenceScores:
    """Journey mode specific metrics."""
    
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
    human_review_recommended: bool
    human_review_notes: str                # What the human should look for
```

### 6.5 Combined Metrics Output

Both modes produce `metrics.json` with standard retention + conversational quality. Journey mode adds `journey_coherence` and `phases` sections. Full schema example:

```json
{
    "run_id": "reactive_journey_fantasy_verbose_20260215_160000",
    "simulation_type": "reactive",
    "simulation_mode": "journey",
    "config": {
        "genre": "fantasy",
        "persona": "verbose_explorer",
        "sessions": 15,
        "sessions_used": 12,
        "messages_per_session": [4, 8],
        "working_method": "balanced",
        "seed": {
            "seed_type": "character",
            "content": "a retired detective who starts losing her memory"
        }
    },
    
    "retention_score": 0.78,
    "citation_accuracy": 0.85,
    
    "conversational_quality": {
        "within_session_coherence": 0.91,
        "cross_session_coherence": 0.78,
        "direction_follow_rate": 0.85,
        "pushback_handling": 0.73,
        "self_reference_rate": 0.65,
        "suggestion_quality": 0.88,
        "style_matching": 0.80,
        "question_appropriateness": 0.82
    },
    
    "journey_coherence": {
        "explore_to_develop_quality": 0.88,
        "develop_to_workshop_quality": 0.75,
        "theme_reflects_exploration": 0.82,
        "logline_captures_story": 0.79,
        "outline_consistent_with_decisions": 0.71,
        "bible_completeness": 0.85,
        "deliverable_alignment": 0.77,
        "story_elements_coverage": 0.90,
        "journey_completion": "full",
        "human_review_recommended": true,
        "human_review_notes": "Outline act 2 thin — check sessions 7-9 for plot coverage"
    },
    
    "facts": {
        "emerged_total": 47,
        "emerged_retained": 38,
        "emerged_from_agent": 29,
        "emerged_from_brainstormy": 18,
        "direction_changes": 5
    },
    
    "phases": {
        "explore_sessions": 4,
        "develop_sessions": 5,
        "workshop_sessions": 3,
        "transitions": [
            {"from": "explore", "to": "develop", "at_session": 5, "reason": "Named 3 characters, core conflict established"},
            {"from": "develop", "to": "workshop", "at_session": 10, "reason": "Character + world sufficient, agent asked about structure"}
        ]
    }
}
```

---

## Part 7: Reactive Runner

### 7.1 Orchestrator

The runner handles both modes through a shared core with mode-specific controllers:

**Budget mode flow:**
1. Generate fact budget and session plan
2. Create project (`is_series=True`), explicitly create story, configure Navigator, set working method
3. Initialize agent with fact budget
4. Run sessions per plan (agent reacts to Brainstormy within each)
5. Post-run observation → challenge queries → retention evaluation
6. Compile and save metrics

**Journey mode flow:**
1. Create project (`is_series=True`), explicitly create story, configure Navigator, set working method
2. Initialize agent with seed
3. Loop: progression engine evaluates readiness → suggests next session → agent runs it
4. Loop ends when journey complete or session cap reached
5. Post-run observation → challenge queries → retention + coherence evaluation
6. Compile and save metrics (including journey coherence)

**Project creation note:** Projects must be created with `is_series=True` to avoid auto-creation side effects. When `is_series=False` (default), the backend automatically creates an implicit story and a first session, which conflicts with the runner's explicit setup flow. The existing scripted runner uses the same pattern.

Both modes share the `_run_reactive_session()` method — the per-session conversation loop is identical.

---

## Part 8: Cost Estimation

### Budget Mode (10-session run)

| Component | LLM Calls | Est. Cost |
|---|---|---|
| Fact budget + session planning | 2 | ~$0.04 |
| Agent messages (10 × 6 avg) | 60 | ~$0.60 |
| Post-run analysis + challenge eval | ~27 | ~$0.30 |
| **Total** | **~89** | **~$0.94** |

### Journey Mode (15-session run)

| Component | LLM Calls | Est. Cost |
|---|---|---|
| Agent messages (15 × 6 avg) | 90 | ~$0.90 |
| Progression decisions | ~15 | ~$0.08 |
| Post-run analysis + challenge + coherence eval | ~37 | ~$0.45 |
| **Total** | **~142** | **~$1.43** |

Under $2 for a comprehensive 15-session journey test. Brainstormy's OpenRouter costs are separate.

**Cost model note:** These estimates assume Claude Sonnet for all agent LLM calls. If journey mode graduation logic or persona maintenance requires Opus for better reasoning, costs scale 5–10x (a 15-session journey run would be ~$7–15). Start with Sonnet; upgrade selectively if persona drift or graduation quality is poor.

### Known Issue: Summary Timeouts on Staging

Session summaries on staging consistently exceed the 300-second poll timeout (observed during scripted simulation Phase 2 runs). Summaries *are* generated but take longer than the runner's poll window. This affects both scripted and reactive simulation.

**Impact:** The runner proceeds without summary confirmation. The Observer cannot use summary content for quality analysis until summaries complete. **Mitigation:** Add a post-run step that re-fetches all session summaries after the full run completes, before the Observer begins analysis. Summaries should be available by then given the total run duration.

---

## Part 9: Implementation Plan

### Phase 1: Core Agent (8–10 hours)

| Task | Est. | Description |
|---|---|---|
| 1.1 | 2h | WriterPersona definitions and all 5 built-in personas |
| 1.2 | 3h | UserAgent with message generation and state tracking |
| 1.3 | 2h | Agent prompt engineering and JSON parsing (both mode contexts) |
| 1.4 | 2h | AgentState with fact tracking, session recording, readiness signals |
| 1.5 | 1h | Manual test: agent generates coherent messages in a loop |

### Phase 2: Budget Mode (4–6 hours)

| Task | Est. | Description |
|---|---|---|
| 2.1 | 2h | Fact budget generation prompt and parser |
| 2.2 | 2h | Session planner with type mix and fact distribution |
| 2.3 | 1h | Session type progression logic |
| 2.4 | 1h | Validate across genre/persona combinations |

### Phase 3: Journey Mode (6–8 hours)

| Task | Est. | Description |
|---|---|---|
| 3.1 | 2h | Seed handling and journey-mode agent prompt context |
| 3.2 | 3h | ProgressionEngine with readiness evaluation and session suggestion |
| 3.3 | 2h | Phase transition logic with guardrails |
| 3.4 | 1h | Workshop session integration (theme, logline, outline templates) |

### Phase 4: Evaluation (6–8 hours)

| Task | Est. | Description |
|---|---|---|
| 4.1 | 2h | Observer: emerged fact extraction + challenge generation |
| 4.2 | 2h | Conversational quality evaluators (both modes) |
| 4.3 | 2h | Journey coherence evaluator (deliverable analysis) |
| 4.4 | 1h | Metrics compilation into standard metrics.json (extend `MetricsCollector.compile()` or create `ReactiveMetricsCollector` subclass to accept `conversational_quality`, `journey_coherence`, `facts`, `phases` alongside existing `retention_results` and `citation_results`) |

### Phase 5: Runner and Integration (4–5 hours)

| Task | Est. | Description |
|---|---|---|
| 5.1 | 2h | ReactiveRunner with both mode paths |
| 5.2 | 1h | CLI entry point alongside scripted runner |
| 5.3 | 1h | Transcript, fact ledger, journey report output |
| 5.4 | 1h | WhatsApp notification on completion |

### Phase 6: Validation (2–3 hours)

| Task | Est. | Description |
|---|---|---|
| 6.1 | 1h | Run 2 budget mode simulations |
| 6.2 | 1h | Run 2 journey mode simulations with different seeds |
| 6.3 | 1h | Tune prompts, verify pipeline compatibility |

### Total: 30–40 hours

---

## Part 10: Success Criteria

### Functional (Both Modes)
- [ ] Agent maintains persona voice across all sessions
- [ ] Agent reads and meaningfully responds to Brainstormy's suggestions
- [ ] Agent handles all 5 personas without breaking character
- [ ] Challenge queries generated and evaluated successfully
- [ ] metrics.json compatible with quality improvement pipeline
- [ ] Both modes runnable from CLI and (future) dashboard

### Budget Mode Targets (10-session run)
- [ ] Agent establishes ≥80% of planned facts naturally
- [ ] Retention ≥ 80% for planned facts, ≥ 70% for emerged facts
- [ ] Within-session coherence ≥ 85%, cross-session ≥ 75%
- [ ] Direction follow rate ≥ 80%
- [ ] Citation accuracy ≥ 80%

### Journey Mode Targets (15-session run)
- [ ] Agent navigates all three phases (explore → develop → workshop)
- [ ] Phase transitions based on readiness signals, not just session count
- [ ] At least one workshop deliverable (theme or logline) produced
- [ ] Emerged fact retention ≥ 70%
- [ ] Journey completion = "full" for ≥ 80% of runs
- [ ] Deliverable alignment ≥ 70%
- [ ] Story elements coverage ≥ 80%
- [ ] Human reviewer rates project as "plausible" or better

### Compatibility
- [ ] Same evaluators work for scripted, budget, and journey metrics
- [ ] Quality pipeline consumes all metrics.json variants without modification
- [ ] Results displayable on future unified dashboard

---

## Part 11: Appendix

### A. Persona × Genre Coverage Matrix

High-value combinations for novel development testing:

| | Fantasy | Mystery | Romance | Thriller | Literary | Horror | Sci-Fi | Historical |
|---|---|---|---|---|---|---|---|---|
| Efficient Plotter | ✓ | ✓ | | ✓ | | | | |
| Verbose Explorer | ✓ | | ✓ | | ✓ | | | |
| Revisionist | | ✓ | | | ✓ | | ✓ | |
| Methodical Worldbuilder | ✓ | | | | | | ✓ | ✓ |
| Anxious Beginner | ✓ | | ✓ | | | ✓ | | |

### B. Comparison: All Three Simulation Types

| Aspect | Scripted | Reactive Budget | Reactive Journey |
|---|---|---|---|
| Messages | Pre-authored | LLM with fact targets | LLM, fully open |
| Reads AI responses | No | Yes | Yes |
| Reproducible | Perfectly | Non-deterministic | Non-deterministic |
| Cost per run | ~$0.15 | ~$1.00 | ~$1.50 |
| Tests retention | Yes | Yes | Yes |
| Tests conversation | No | Yes | Yes |
| Tests full UX workflow | No | No | Yes |
| Tests deliverable coherence | Limited | Limited | Yes |
| Requires scenario authoring | Yes | No | No |
| Human review needed | Low | Low | High |
| Primary question | "Does memory work?" | "Does memory work interactively?" | "Does the product work?" |

### C. Seed Examples by Genre

| Genre | Theme | Character | Premise | Vibe |
|---|---|---|---|---|
| Fantasy | "the cost of power" | "a mapmaker whose maps change the landscape" | "what if dreams were a shared public space" | "dark academia meets fairy tale" |
| Mystery | "truth vs. justice" | "a forensic accountant who finds a body in the numbers" | "a murder where the victim left clues in their will" | "cozy village mystery with a sharp edge" |
| Romance | "second chances" | "a war correspondent coming home to the life they left" | "rivals forced to collaborate on a failing bookshop" | "warm, witty, slow burn" |
| Thriller | "who watches the watchers" | "a hostage negotiator whose family is taken" | "a whistleblower discovers the leak is inside their team" | "claustrophobic, ticking clock" |
| Literary | "the stories we tell ourselves" | "a translator losing their first language" | "three siblings return to sell their childhood home" | "quiet devastation, precise prose" |
| Horror | "what lurks in routine" | "a night shift nurse at a hospital that shouldn't exist" | "a neighborhood where everyone's basements connect" | "creeping suburban dread" |

### D. Unused Session Parameters (Future Phases)

The session creation API supports two additional parameters not used in v1 reactive simulation:

- **`custom_focus_id`** — References user-created custom focus areas (`074_custom_focus_areas.sql`). Would allow testing of user-defined focus templates.
- **`parent_session_id`** — For sessions spawned from logline workshops. Required for session branching (enhancement #2 below).

### E. Future Enhancements

1. **Multi-story runs:** Agent creates multiple stories within one project, testing project-level memory
2. **Session branching:** Agent deliberately tests Brainstormy's branching features (leverages `parent_session_id` parameter)
3. **Adversarial mode:** Rapid topic changes, contradictions, extremely long messages — find breaking points
4. **Persona learning:** Analyze lowest-scoring persona/genre combos, auto-generate variants targeting weaknesses
5. **A/B testing mode:** Same persona/genre with different Brainstormy configs, compare metrics
6. **Journey replay:** Same journey, different persona — compare how writer types navigate same territory
7. **Collaborative review:** After run, second LLM evaluates project from "new reader" perspective
8. **Custom focus areas:** Agent creates custom focus areas mid-run, testing the `custom_focus_id` workflow
