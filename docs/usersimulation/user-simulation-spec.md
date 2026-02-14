# User Simulation Framework Specification

## Overview

The User Simulation Framework generates realistic multi-session writing projects through Brainstormy's API, serving three purposes simultaneously:

1. **Stress testing** â€” Validate memory retention, context assembly, and system reliability at progressive scale (15 â†’ 50 â†’ 100+ sessions)
2. **Content generation** â€” Produce compelling, screenshot-ready projects that showcase Brainstormy's features for marketing, support documentation, and video production
3. **Competitive benchmarks** â€” Quantify Brainstormy's architectural advantages (memory retention rate, citation accuracy, context utilization) with reproducible metrics

### Relationship to Existing Specs

This framework builds on concepts from `brainstormy-testing-framework-spec.md` but reframes them for dual content/quality purposes. Key differences:

| Aspect | Testing Framework Spec | This Spec |
|--------|----------------------|-----------|
| Story content | Synthetic test data | Compelling, genre-authentic narratives |
| Primary output | Pass/fail metrics | Populated projects + metrics + screenshots |
| Session content | Fact-establishment patterns | Natural writer conversations |
| Scale target | 15-25 sessions | Progressive: 15 â†’ 50 â†’ 100+ |
| Visual output | None | Screenshots at key moments for marketing |

### Relationship to QA Engine

The QA Engine (`qa-engine` repo) handles Playwright-based UI smoke tests â€” verifying buttons, navigation, and page rendering. This framework operates at the API level, simulating a writer's entire creative journey and measuring whether Brainstormy's core value proposition (persistent context) holds at scale.

---

## Part 1: Architecture

### 1.1 System Components

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  Simulation Runner                    â”‚
â”‚  Orchestrates story playback, collects metrics        â”‚
â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
       â”‚          â”‚              â”‚
       â–¼          â–¼              â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Story   â”‚ â”‚   API    â”‚ â”‚  Metrics     â”‚
â”‚  Library â”‚ â”‚  Client  â”‚ â”‚  Collector   â”‚
â”‚          â”‚ â”‚          â”‚ â”‚              â”‚
â”‚ Pre-     â”‚ â”‚ Talks to â”‚ â”‚ Retention,   â”‚
â”‚ authored â”‚ â”‚ Brainstormyâ”‚ â”‚ citation,   â”‚
â”‚ scenariosâ”‚ â”‚ endpoints â”‚ â”‚ timing, etc  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚
                           â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                           â”‚  Screenshot  â”‚
                           â”‚  Capture     â”‚
                           â”‚              â”‚
                           â”‚  Playwright  â”‚
                           â”‚  at key      â”‚
                           â”‚  moments     â”‚
                           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### 1.2 Execution Flow

For each story scenario:

1. **Setup** â€” Create project, story, configure API key via API
2. **Session loop** â€” For each session in the scenario:
   a. Create session (Explore, Focus, or Workshop type)
   b. Send message sequence (user messages from story script)
   c. Receive and record AI responses
   d. End session (triggers summary generation)
   e. Optionally capture screenshots via Playwright
3. **Deliverable generation** â€” Generate Story Bibles, reports after sufficient sessions
4. **Challenge queries** â€” Send recall/inference questions, measure accuracy
5. **Metrics collection** â€” Aggregate retention, citation, timing metrics
6. **Screenshot pass** â€” Playwright captures polished screenshots of the populated project

### 1.3 Repository Location

```
brainstormy/
â”œâ”€â”€ tests/
â”‚   â””â”€â”€ simulation/
â”‚       â”œâ”€â”€ runner.py              # Simulation orchestrator
â”‚       â”œâ”€â”€ api_client.py          # Brainstormy API wrapper
â”‚       â”œâ”€â”€ metrics.py             # Metrics collection and scoring
â”‚       â”œâ”€â”€ screenshot.py          # Playwright screenshot capture
â”‚       â”œâ”€â”€ stories/
â”‚       â”‚   â”œâ”€â”€ __init__.py
â”‚       â”‚   â”œâ”€â”€ fantasy_ember.py   # "The Last Ember" â€” fantasy/sci-fi
â”‚       â”‚   â”œâ”€â”€ mystery_glass.py   # "The Glass Alibi" â€” mystery/thriller
â”‚       â”‚   â””â”€â”€ romance_atlas.py   # "The Atlas of Us" â€” romance
â”‚       â”œâ”€â”€ evaluators/
â”‚       â”‚   â”œâ”€â”€ retention.py       # Memory retention scoring
â”‚       â”‚   â”œâ”€â”€ citation.py        # Citation accuracy scoring
â”‚       â”‚   â””â”€â”€ consistency.py     # Contradiction detection
â”‚       â”œâ”€â”€ reports/
â”‚       â”‚   â””â”€â”€ generator.py       # Benchmark report generation
â”‚       â””â”€â”€ conftest.py            # Pytest fixtures
```

### 1.4 Technology Choices

- **Language:** Python (matches existing Brainstormy backend and test infrastructure)
- **API interaction:** `httpx` async client (already in Brainstormy dependencies)
- **Screenshot capture:** Playwright (already installed for QA Engine integration)
- **Test runner:** pytest with async support (`pytest-asyncio`)
- **Metrics storage:** JSON files per run in `tests/simulation/results/`
- **LLM evaluation:** Claude API for challenge query scoring (same key as Brainstormy)

---

## Part 2: Story Library

### 2.1 Design Principles for Story Content

Stories must be **compelling enough to screenshot** â€” they need to look like a real writer's project, not test data. This means:

- Character names, settings, and conflicts should feel genre-authentic
- User messages should read like a writer thinking out loud, not issuing commands
- The conversation should show natural creative development â€” exploring, backtracking, getting excited about ideas
- Facts should be established organically ("I think Elena is the oldest of three sisters") rather than formally ("Establish fact: Elena has two younger siblings")
- Sessions should have natural arcs â€” starting broad, narrowing focus, reaching provisional decisions

### 2.2 Story Scenario Structure

Each story scenario is a Python class containing:

```python
@dataclass
class SessionScript:
    """One brainstorming session's worth of user messages."""
    name: str                          # Session name (visible in UI)
    description: str | None            # Session description
    guidance_mode: str                 # 'explore' or 'focus' (formerly 'develop')
    template: str | None               # For focus sessions: 'character', 'plot', etc.
    messages: list[str]                # User messages to send, in order
    expected_facts: list[str]          # Facts this session should establish (for metrics)
    screenshot_moments: list[str]      # When to capture: 'after_session', 'after_message_3', etc.

@dataclass  
class ChallengeQuery:
    """A question to test whether Brainstormy remembers established facts."""
    query: str                         # The question to ask
    established_in_session: int        # Which session established this fact (0-indexed)
    expected_facts: list[str]          # What the response should contain
    query_type: str                    # 'direct_recall', 'cross_reference', 'inference'

@dataclass
class DeliverableRequest:
    """A Story Bible or report to generate after simulation."""
    type: str                          # 'bible' or 'report'
    template_key: str                  # e.g., 'standard', 'character_focused', 'outline'
    parameters: dict | None = None     # e.g., {'character_name': 'Elena'} for character_profile
    trigger_after_session: int = -1    # Generate after this session (-1 = end)

@dataclass
class StoryScenario:
    """Complete story simulation scenario."""
    id: str                            # e.g., 'fantasy_ember_25'
    name: str                          # e.g., 'The Last Ember'
    genre: str                         # 'fantasy', 'mystery', 'romance'
    description: str                   # Brief story premise
    project_name: str                  # Name for the Brainstormy project
    story_name: str                    # Name for the Brainstormy story
    sessions: list[SessionScript]      # Ordered session scripts
    challenge_queries: list[ChallengeQuery]  # Post-simulation recall tests
    deliverables: list[DeliverableRequest]   # Bibles/reports to generate
    scale_tier: str                    # '15', '50', '100' â€” which progressive tier
```

### 2.3 Story Scenarios

#### Scenario 1: "The Last Ember" (Fantasy/Sci-Fi)

**Premise:** In a world where magical ability is fading generation by generation, a young artificer discovers that her mechanical inventions are actually channeling the last reserves of ambient magic â€” and a dying order of mages wants to use her as a living conduit to reignite the source.

**Why this works for marketing:** World-building heavy, showcases Brainstormy remembering complex magic systems, faction politics, and character relationships across many sessions. Visually dramatic content in Story Bibles.

**Scale tiers:**
- **15 sessions:** Core story â€” Elena's discovery, the Order's approach, central conflict established
- **50 sessions:** Full novel development â€” supporting cast, magic system rules, three-act structure, subplots
- **100 sessions:** Series-scale â€” Book 1 complete, Book 2 seeds, expanded world-building, detailed scene planning

**Session arc (15-session tier):**

| Session | Type | Focus | Key Facts Established |
|---------|------|-------|----------------------|
| 1 | Explore | Initial premise brainstorm | World concept, magic-fading premise |
| 2 | Explore | Elena â€” who is she? | Elena: artificer, mid-20s, skeptic, works in her grandfather's workshop |
| 3 | Focus: Character | Elena's backstory | Elena's grandfather taught her, died 2 years ago, she inherited the shop |
| 4 | Focus: World | The magic system | Magic tied to "ember lines" â€” ley-line equivalent, depleting over centuries |
| 5 | Explore | The Order of Kindling | Secret mage order, believe Elena is a Conduit, want to use her |
| 6 | Focus: Character | Maren â€” the Order's emissary | Maren: true believer, Elena's age, becomes ambiguous ally |
| 7 | Focus: Plot | Act 1 structure | Inciting incident: Elena's latest invention causes a visible magical flare |
| 8 | Explore | The antagonist question | Lord Castellan Voss â€” Order leader, willing to sacrifice Elena for the "greater good" |
| 9 | Focus: World | Political landscape | Three factions: Order (restore magic), Rationalists (embrace mundane), Crown (maintain control) |
| 10 | Focus: Character | Supporting cast roundup | Dex (Elena's apprentice), Sable (information broker), Theron (Crown investigator) |
| 11 | Focus: Plot | Midpoint and Act 2 | Elena learns she IS the last ember â€” her bloodline is the final magical reservoir |
| 12 | Focus: Scene | The revelation scene | Elena discovers the truth in her grandfather's hidden workshop beneath the shop |
| 13 | Explore | Thematic exploration | Technology vs. magic, sacrifice vs. self-preservation, found family |
| 14 | Focus: Plot | Act 3 and climax | Elena chooses to redistribute the magic rather than hoard or surrender it |
| 15 | Explore | Series potential, loose threads | Setup for Book 2, unresolved Maren relationship, Voss still active |

**Challenge queries (post-simulation):**
- "What is Elena's relationship to her grandfather?" (direct recall, session 3)
- "How does the magic system work in this world?" (direct recall, session 4)
- "Why would Castellan Voss be willing to sacrifice Elena?" (cross-reference, sessions 5+8)
- "Given Elena's decision at the climax, what happens to Maren's beliefs about the Order?" (inference, sessions 6+14)
- "What are all the factions and their positions on magic?" (cross-reference, session 9)

**Deliverables:**
- Standard Story Bible (after session 15)
- Character-focused Bible (after session 15)
- Character Profile report: Elena (after session 10)
- Character Profile report: Maren (after session 10)
- Story Outline report (after session 15)

---

#### Scenario 2: "The Glass Alibi" (Mystery/Thriller)

**Premise:** A forensic glass analyst is called to consult on a locked-room murder in a century-old conservatory â€” where the victim is her estranged mother, and every suspect is a family member she hasn't spoken to in fifteen years.

**Why this works for marketing:** Plot-twist heavy, showcases Brainstormy maintaining consistency across complex clue trails, suspect timelines, and revelation sequences. Demonstrates the "AI remembers your red herrings" value prop.

**Scale tiers:**
- **15 sessions:** Core mystery â€” crime scene, suspects, key clues, solution
- **50 sessions:** Full novel â€” detailed suspect backstories, red herrings, forensic procedural elements, subplot
- **100 sessions:** Series potential â€” standalone mystery complete, recurring detective character development, second case seeds

**Session arc (15-session tier):**

| Session | Type | Focus | Key Facts Established |
|---------|------|-------|----------------------|
| 1 | Explore | Premise and setup | Locked-room conservatory murder, protagonist is victim's daughter |
| 2 | Focus: Character | Dr. Noor Vasquez â€” protagonist | Forensic glass analyst, estranged 15 years, left home at 18 after family betrayal |
| 3 | Explore | The crime scene | Mother found dead in sealed conservatory, rare orchid collection, single shattered pane |
| 4 | Focus: Character | The family suspects | 4 suspects: Uncle Rodrigo, Cousin Pilar, stepfather Martin, half-sister Luz |
| 5 | Focus: Plot | Clue framework | Glass fragments are wrong era, orchid pollen on wrong person, locked from inside |
| 6 | Focus: Character | Uncle Rodrigo deep dive | Art dealer, financial trouble, stood to inherit, alibi depends on security camera timing |
| 7 | Focus: Character | Cousin Pilar deep dive | Estate lawyer, knew about the will change, last person to see victim alive |
| 8 | Explore | Red herrings and misdirection | Martin's affair, Luz's secret meetings, the missing conservatory key |
| 9 | Focus: Plot | Midpoint revelation | The glass pane was replaced BEFORE the murder â€” this was staged |
| 10 | Focus: Scene | Noor confronts Pilar | Tense family dinner scene where Noor reveals the glass evidence |
| 11 | Explore | The real motive | Mother was about to expose a family financial crime spanning decades |
| 12 | Focus: Plot | Solution mechanics | How the murder was actually committed â€” the conservatory wasn't locked from inside |
| 13 | Focus: Character | Noor's emotional arc | Reconciling with her mother's memory, the betrayal that drove her away |
| 14 | Focus: Plot | Climax and resolution | Noor traps the real killer using a glass-replacement demonstration |
| 15 | Explore | Aftermath and character resolution | Family reconciliation (partial), Noor's career impact, series setup |

**Challenge queries:**
- "What are the clue discrepancies Noor found at the crime scene?" (direct recall, sessions 3+5)
- "Who had motive and opportunity to replace the conservatory glass pane?" (cross-reference, sessions 4+6+7+9)
- "How does Noor's estrangement from her family affect her objectivity on the case?" (inference, sessions 2+13)
- "What was the real motive for the murder?" (direct recall, session 11)
- "Walk me through the timeline of the night of the murder based on what we've established." (cross-reference, multiple sessions)

**Deliverables:**
- Standard Story Bible (after session 15)
- Character Profile: Dr. Noor Vasquez (after session 10)
- Story Outline (after session 15)
- Relationship Map (after session 10)

---

#### Scenario 3: "The Atlas of Us" (Romance)

**Premise:** A travel journalist who writes about places she's never visited (using research and interviews) falls for a cartographer who's mapped every place she's faked â€” and he knows her work is fraudulent before she does.

**Why this works for marketing:** Character-driven, showcases Brainstormy tracking emotional arcs, relationship dynamics, and thematic threads across sessions. The romance genre is one of the largest fiction markets and underserved by AI writing tools.

**Scale tiers:**
- **15 sessions:** Core romance â€” meet-cute through crisis through resolution
- **50 sessions:** Full novel â€” dual POV development, supporting cast, subplot, detailed scene work
- **100 sessions:** Series-scale â€” Book 1 complete, connected couple for Book 2 seeds, expanded world

**Session arc (15-session tier):**

| Session | Type | Focus | Key Facts Established |
|---------|------|-------|----------------------|
| 1 | Explore | Premise and meet-cute concept | Journalist/cartographer pairing, the fraud secret, how they meet |
| 2 | Focus: Character | Iris Yoon â€” the journalist | Writes for Wanderlust magazine, Korean-American, agoraphobic (the secret reason she can't travel) |
| 3 | Focus: Character | Callum Voss â€” the cartographer | Scottish, fieldwork cartographer for geological surveys, quiet, observant, immediately spots the tells in Iris's writing |
| 4 | Explore | The meet-cute scene | They meet at a magazine awards ceremony. He's receiving a mapping award, she's receiving travel writing award |
| 5 | Focus: Plot | Act 1 â€” attraction and tension | Callum is intrigued, not judgmental. Iris is terrified he'll expose her |
| 6 | Focus: Character | Why Iris became agoraphobic | Panic attack during a college study abroad trip, escalated into full agoraphobia, built the fraud career as a coping mechanism |
| 7 | Focus: Scene | First real date â€” the map room | Callum shows Iris his personal map collection. She describes places she's "been" and he gently challenges her |
| 8 | Explore | The emotional stakes | Iris's editor is pushing for a "live travel" video series. Callum's next expedition leaves in 3 months |
| 9 | Focus: Plot | Midpoint â€” the confession | Iris tells Callum the truth. He admits he already knew. Trust fracture: she's hurt he let her perform |
| 10 | Focus: Character | Supporting cast | Iris's editor Margot, Callum's expedition partner Fiona, Iris's therapist Dr. Lim |
| 11 | Focus: Plot | Act 2 crisis â€” the stakes collide | Magazine discovers the fraud. Callum offers to take Iris on a short local trip as exposure therapy |
| 12 | Focus: Scene | The first trip â€” 40 miles from home | Iris's first real journey, panic attack on the train, Callum's patience, breakthrough moment |
| 13 | Explore | Thematic exploration | Maps as metaphors â€” "the map is not the territory," writing about what you love vs. what you know |
| 14 | Focus: Plot | Climax and grand gesture | Iris writes her first honest piece â€” about the 40-mile trip. Callum names a newly mapped inlet after her |
| 15 | Explore | Resolution and future | Iris starts a new column about learning to travel with anxiety, Callum delays his expedition, HEA |

**Challenge queries:**
- "Why can't Iris actually travel to the places she writes about?" (direct recall, session 6)
- "How does Callum react when Iris confesses the truth?" (direct recall, session 9)
- "What is the thematic significance of maps in this story?" (cross-reference, sessions 3+7+13+14)
- "How does the magazine subplot create pressure on Iris and Callum's relationship?" (inference, sessions 8+11)
- "Trace Iris's emotional arc from the awards ceremony to the final resolution." (cross-reference, multiple sessions)

**Deliverables:**
- Standard Story Bible (after session 15)
- Character Profile: Iris (after session 10)
- Character Profile: Callum (after session 10)
- Relationship Map (after session 10)
- Theme Analysis (after session 15)

---

### 2.4 Message Authoring Guidelines

User messages in session scripts should follow these patterns to look authentic:

**Natural thinking-aloud style:**
```
"I'm thinking Elena should be someone who doesn't believe in magic at all â€” like she's 
completely rational and scientific, and that's part of what makes it ironic that she's 
the one channeling it."
```

**Building on AI responses:**
```
"Oh I like that idea about the grandfather's journal. What if it's not a journal exactly, 
but his workshop notebooks? And they have all these diagrams that Elena always assumed 
were engineering schematics but are actually magical formulae?"
```

**Backtracking and revising:**
```
"Actually, I don't think Maren should be a true believer. That's too simple. What if she 
has her own doubts about the Order but feels trapped by her family's legacy within it?"
```

**Getting excited about discoveries:**
```
"Wait â€” if the magic is fading because the ember lines are depleting, and Elena's 
inventions are drawing on the last reserves... then every time she builds something, 
she's actually accelerating the end of magic. That's such a good tension."
```

### 2.5 Progressive Scale Strategy

Each genre scenario has three tiers. Tiers are additive â€” the 50-session tier includes the 15-session content plus additional sessions:

| Tier | Sessions | What It Adds | Purpose |
|------|----------|-------------|---------|
| 15 | 15 | Core story arc | Baseline metrics, quick iteration, initial screenshots |
| 50 | 50 | Full novel development | Stress test at novel scale, rich marketing content |
| 100 | 100+ | Series-scale content | System limits testing, showcase project depth |

**Scaling approach:** Sessions 1-15 are hand-authored for quality. Sessions 16-50 and 51-100 use a hybrid approach: key session outlines are pre-authored (what facts to establish, what topics to explore) but user messages are generated by an LLM prompted with the story context and writer persona. This keeps content quality high at scale without requiring 100 hand-written session scripts per scenario.

```python
@dataclass
class GeneratedSessionOutline:
    """Outline for LLM-generated sessions (tiers 50 and 100)."""
    name: str
    guidance_mode: str
    template: str | None
    topic: str                      # What this session should explore
    facts_to_establish: list[str]   # What should be decided/revealed
    builds_on_sessions: list[int]   # Which prior sessions this references
    message_count: int              # How many user messages to generate (3-8)
    writer_notes: str               # Guidance for the message-generating LLM
```

---

## Part 3: API Client

### 3.1 Client Design

The API client wraps Brainstormy's REST API with async methods matching the simulation workflow:

```python
class BrainstormyClient:
    """Async client for Brainstormy API, authenticated as a test user."""
    
    def __init__(self, base_url: str, auth_token: str):
        self.base_url = base_url
        self.auth_token = auth_token
        self.client = httpx.AsyncClient(...)
    
    # Project/Story management
    async def create_project(self, name: str, description: str = None) -> dict
    async def create_story(self, project_id: str, name: str, description: str = None) -> dict
    
    # Session lifecycle
    async def create_session(self, story_id: str, name: str, 
                            guidance_mode: str = 'explore',
                            template: str = None) -> dict
    async def send_message(self, session_id: str, content: str) -> dict
    async def get_messages(self, session_id: str) -> list[dict]
    async def end_session(self, session_id: str) -> dict
    
    # Deliverables
    async def generate_bible(self, story_id: str, template_key: str) -> dict
    async def generate_report(self, story_id: str, report_type: str, 
                             parameters: dict = None) -> dict
    async def get_bible(self, story_id: str, template_key: str) -> dict
    async def get_report(self, report_id: str) -> dict
    
    # Search (for metrics validation)
    async def search(self, story_id: str, query: str, limit: int = 20) -> list[dict]
    
    # Bookmarks
    async def create_bookmark(self, story_id: str, message_id: str, 
                             title: str, category: str = None) -> dict
    
    # Summary polling
    async def wait_for_summary(self, session_id: str, 
                               timeout: float = 120.0) -> dict:
        """Poll GET /api/sessions/{id} for has_summary: true.
        Exponential backoff: 2s initial → 10s max interval.
        Raises TimeoutError after timeout seconds."""
    
    # Preflight validation
    async def preflight_check(self) -> dict:
        """Verify API reachable and auth valid before starting a run.
        Returns {'api_reachable': bool, 'auth_valid': bool, 'can_list_projects': bool}"""
```

### 3.2 Authentication

The simulation uses a single dedicated Clerk test user for all scenarios. Scenario isolation is achieved through unique project names (timestamp-prefixed), not separate users. This avoids multi-Clerk setup complexity while maintaining full data isolation since projects are already separated by `project_id`.

**Staging:** Authenticate via Clerk session token stored in `BRAINSTORMY_SIM_AUTH_TOKEN` env var, sent as `Authorization: Bearer {token}` header. The token must be obtained manually and refreshed when it expires.

**Local:** If the test auth bypass from `brainstormy-testing-framework-tasks.md` (Task 1.4b) is implemented, use the `X-Test-User-ID` header instead. This avoids token expiry issues during development.

```python
# Staging: Clerk session token
client = BrainstormyClient(
    base_url="https://brainstormy-staging.onrender.com",
    auth_token=os.environ["BRAINSTORMY_SIM_AUTH_TOKEN"]
)

# Local (if test bypass exists): X-Test-User-ID header
client = BrainstormyClient(
    base_url="http://localhost:8000",
    auth_token=None,
    test_user_id="sim-test-user"
)
```

**One-time setup for the simulation Clerk user:**
1. Create a dedicated Clerk user for simulation (or designate an existing test user)
2. Log in to staging as that user
3. Configure a valid OpenRouter API key in Brainstormy Settings → API Keys
4. Verify by starting a quick Explore session and confirming AI responses work
5. Obtain a session token and set `BRAINSTORMY_SIM_AUTH_TOKEN`

### 3.3 Rate Limiting and Pacing

Simulated sessions should pace messages realistically, not as fast as possible:

- **Between messages in a session:** 2-5 second pause (simulates reading AI response)
- **Between sessions:** 5-10 second pause (simulates session transition)
- **After session end (summary generation):** Poll for completion, up to 120 seconds (see 3.4)
- **After deliverable generation:** Wait for completion, up to 180 seconds

These pauses also prevent overwhelming the staging environment and ensure AI responses have time to process.

### 3.4 Summary Wait Strategy

Summary generation is async after `POST /api/sessions/{id}/end`. The client must poll for completion:

1. Call `end_session()` — this triggers async summary generation
2. Poll `GET /api/sessions/{id}` checking the `has_summary` field (already in API response per `api-spec.md`)
3. Exponential backoff: start at 2s intervals, multiply by 1.5 each poll, cap at 10s intervals
4. Hard timeout at 120s — log a warning and continue the run (don't abort)

Continuing after timeout rather than aborting lets the simulation complete with a gap in metrics, which is better than a failed run. The timeout is generous since summaries typically complete in 10-30s.

### 3.5 Preflight Check

Before starting a long simulation run (15+ sessions), the runner calls `preflight_check()` to verify:

1. **API reachable** — can connect to the base URL
2. **Auth valid** — `GET /api/projects` returns 200, not 401
3. **AI responses work** — (optional, expensive) create a temp session, send "Hello", verify assistant response, delete session

If preflight fails, the runner aborts with a clear error before committing to a 15-minute+ run.

---

## Part 4: Metrics Collection

### 4.1 Metrics Architecture

```python
@dataclass
class RunMetrics:
    """Complete metrics for one simulation run."""
    run_id: str
    scenario_id: str
    started_at: datetime
    completed_at: datetime
    
    # Scale
    total_sessions: int
    total_messages_sent: int
    total_messages_received: int
    
    # Memory retention
    retention_score: float          # 0.0-1.0, percentage of facts correctly recalled
    retention_details: list[dict]   # Per-query breakdown
    
    # Citation accuracy (from deliverables)
    citation_accuracy: float        # 0.0-1.0, percentage of valid citations
    hallucination_rate: float       # 0.0-1.0, percentage of unsupported claims
    citation_details: list[dict]    # Per-deliverable breakdown
    
    # Consistency
    contradiction_count: int        # Number of contradictions detected
    consistency_score: float        # 0.0-1.0
    
    # Performance
    avg_response_time_ms: float     # Average AI response time
    p95_response_time_ms: float     # 95th percentile
    max_response_time_ms: float     # Worst case
    summary_generation_times: list[float]  # Per-session summary time
    
    # System health
    errors: list[dict]              # Any API errors encountered
    timeouts: int                   # Number of timeout retries
```

### 4.2 Memory Retention Evaluation

After all sessions complete, the runner sends challenge queries as new messages in a dedicated "recall test" session. An LLM evaluator scores each response:

```python
class RetentionEvaluator:
    """Scores whether AI responses contain expected facts."""
    
    async def evaluate(self, query: ChallengeQuery, ai_response: str) -> RetentionResult:
        """
        Uses Claude to judge whether the AI response contains the expected facts.
        Returns score 0.0-1.0 and detailed breakdown.
        """
        evaluation_prompt = f"""
        A user asked an AI writing assistant this question about their story:
        
        Question: {query.query}
        
        The AI responded:
        {ai_response}
        
        The following facts were established earlier in the brainstorming:
        {json.dumps(query.expected_facts)}
        
        Score the response:
        1. Which expected facts are present in the response? (list each)
        2. Which expected facts are missing? (list each)
        3. Does the response contradict any established facts? (yes/no, details)
        4. Overall retention score (0.0 to 1.0)
        
        Respond as JSON.
        """
        # ... call Claude API, parse response
```

### 4.3 Citation Accuracy Evaluation

After generating Story Bibles and reports, the evaluator checks citation validity:

```python
class CitationEvaluator:
    """Validates that citations in generated content link to real sources."""
    
    async def evaluate(self, deliverable: dict, story_id: str) -> CitationResult:
        """
        1. Parse citation short-IDs from content (e.g., [abc12345])
        2. Look up full UUIDs in citation_map
        3. Verify each cited message exists and contains relevant content
        4. Check for claims without citations (potential hallucinations)
        """
```

### 4.4 Performance Metrics

Collected passively during simulation:

```python
class PerformanceCollector:
    """Tracks timing for every API call."""
    
    async def timed_request(self, method, *args, **kwargs):
        start = time.monotonic()
        result = await method(*args, **kwargs)
        elapsed_ms = (time.monotonic() - start) * 1000
        self.timings.append({
            'method': method.__name__,
            'elapsed_ms': elapsed_ms,
            'timestamp': datetime.utcnow().isoformat()
        })
        return result
```

---

## Part 5: Screenshot Capture

### 5.1 Purpose

Screenshots serve dual duty: evidence for stress-test runs AND marketing/support/video assets. They need to look like real usage, not test output.

### 5.2 Screenshot Strategy

The simulation runner operates at the API level (fast, reliable, measurable). Screenshots are captured as a separate pass using Playwright, navigating the populated project in the browser.

```python
class ScreenshotCapture:
    """Captures polished screenshots of simulation results via Playwright."""
    
    def __init__(self, base_url: str, auth_session: str):
        self.browser = None
        self.page = None
    
    async def initialize(self):
        """Launch browser, authenticate, set viewport."""
        self.browser = await playwright.chromium.launch(headless=True)
        self.page = await self.browser.new_page(viewport={'width': 1440, 'height': 900})
        await self.authenticate()
    
    async def capture_project_overview(self, project_id: str) -> str:
        """Screenshot the project page showing all stories."""
        
    async def capture_session_chat(self, session_id: str, scroll_to: str = 'bottom') -> str:
        """Screenshot a session's chat interface."""
        
    async def capture_story_bible(self, story_id: str, template_key: str) -> str:
        """Screenshot the Story Bible viewer."""
        
    async def capture_report(self, report_id: str) -> str:
        """Screenshot a generated report with citations visible."""
        
    async def capture_session_list(self, story_id: str) -> str:
        """Screenshot the session list showing many sessions."""
        
    async def capture_search_results(self, story_id: str, query: str) -> str:
        """Screenshot search results for a compelling query."""
```

### 5.3 Screenshot Moments

Key moments to capture for each scenario:

| Moment | Marketing Value | Capture After |
|--------|----------------|---------------|
| Session chat with rich AI response | "Look how smart the AI is" | Session 7+ with visible context use |
| Session list with 15+ sessions | "It keeps track of everything" | All sessions created |
| Story Bible â€” character section | "Automatic story bible" | Bible generation |
| Report with citations | "Grounded in your actual conversations" | Report generation |
| Search results | "Find anything instantly" | Simulation complete |
| Project overview with story | "Organize your creative world" | Project setup |
| Focus session with domain prompt | "Deep dive on characters" | Focus session in progress |

### 5.4 Screenshot Output

```
tests/simulation/screenshots/
â”œâ”€â”€ fantasy_ember_15/
â”‚   â”œâ”€â”€ session_chat_07_plot.png
â”‚   â”œâ”€â”€ session_list_full.png
â”‚   â”œâ”€â”€ bible_standard.png
â”‚   â”œâ”€â”€ bible_character.png
â”‚   â”œâ”€â”€ report_elena_profile.png
â”‚   â”œâ”€â”€ search_magic_system.png
â”‚   â””â”€â”€ project_overview.png
â”œâ”€â”€ mystery_glass_15/
â”‚   â””â”€â”€ ...
â””â”€â”€ romance_atlas_15/
    â””â”€â”€ ...
```

### 5.5 Video Content Support

For video production, the screenshot system can capture a sequence of screenshots that form a visual walkthrough:

```python
async def capture_walkthrough_sequence(self, story_id: str) -> list[str]:
    """
    Capture a sequence of screenshots that tell the story of a 
    writer using Brainstormy, suitable for video slideshow or 
    screen-recording overlay.
    
    Sequence:
    1. Empty project (fresh start)
    2. First explore session (brainstorming)
    3. Session list growing (progress)
    4. Focus session on character (deep work)
    5. Story Bible populated (deliverable)
    6. Search finding a detail from session 3 (memory)
    7. Report with citations (grounding)
    """
```

---

## Part 6: Simulation Runner

### 6.1 Runner Design

```python
class SimulationRunner:
    """Orchestrates a complete story simulation."""
    
    def __init__(self, client: BrainstormyClient, scenario: StoryScenario,
                 config: SimulationConfig, tier: int = 15):
        self.client = client
        self.scenario = scenario
        self.config = config
        self.tier = tier
        self.metrics = MetricsCollector(scenario.id, tier, config.environment.name)
    
    async def run(self) -> RunMetrics:
        """Execute complete simulation."""
        self.metrics.start()
        
        # 1. Setup — timestamp-prefixed project name for isolation
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        project_name = f"sim_{timestamp}_{self.scenario.id}"
        project = await self.client.create_project(project_name)
        story = await self.client.create_story(project['id'], self.scenario.story_name)
        self.metrics.set_resource_ids(project['id'], story['id'])
        
        # 2. Run sessions
        sessions = self.scenario.get_sessions_for_tier(self.tier)
        for i, session_script in enumerate(sessions):
            await self.run_session(story['id'], session_script, session_index=i)
        
        # 3. Generate deliverables
        for deliverable in self.scenario.deliverables:
            await self.generate_deliverable(story['id'], deliverable)
        
        # 4. Run challenge queries
        retention_results = await self.run_challenge_queries(story['id'])
        
        # 5. Capture screenshots (Phase 3)
        # Screenshots are a separate Playwright pass, stubbed for now
        
        # 6. Compile and save metrics
        metrics = self.metrics.compile(retention_results)
        metrics.save(f"tests/simulation/results/{self.metrics.run_id}/metrics.json")
        
        # 7. Send WhatsApp notification (if configured)
        await self.notify_completion(metrics)
        
        return metrics
    
    async def run_session(self, story_id: str, script: SessionScript, 
                         session_index: int):
        """Execute one session's worth of messages.
        
        Error handling: individual message/session failures are recorded
        in metrics but do NOT abort the run. If session 7 fails, 
        continue with session 8.
        """
        session = await self.client.create_session(
            story_id, script.name,
            guidance_mode=script.guidance_mode,
            template=script.template
        )
        
        for j, message in enumerate(script.messages):
            try:
                response = await self.metrics.timed(
                    'send_message',
                    self.client.send_message, session['id'], message
                )
                self.metrics.record_message_sent()
                self.metrics.record_message_received()
            except Exception as e:
                self.metrics.record_error('send_message', e)
                continue
            
            # Pace messages realistically
            await asyncio.sleep(random.uniform(
                self.config.pacing.message_delay_min,
                self.config.pacing.message_delay_max
            ))
        
        # End session and wait for summary
        await self.client.end_session(session['id'])
        try:
            summary_start = time.monotonic()
            await self.client.wait_for_summary(
                session['id'], 
                timeout=self.config.pacing.summary_timeout
            )
            self.metrics.record_summary_time(time.monotonic() - summary_start)
        except TimeoutError:
            self.metrics.record_timeout()
        
        self.metrics.record_session_complete(session_index, len(script.messages), session['id'])
        
        # Pace between sessions
        await asyncio.sleep(random.uniform(
            self.config.pacing.session_delay_min,
            self.config.pacing.session_delay_max
        ))
```

### 6.2 CLI Interface

```bash
# List available scenarios
python -m tests.simulation.runner --list

# Dry run — print execution plan without running
python -m tests.simulation.runner --scenario fantasy_ember --tier 15 --dry-run

# Run a single scenario at tier 15
python -m tests.simulation.runner --scenario fantasy_ember --tier 15

# Run all scenarios at tier 15 (sequential — one at a time)
python -m tests.simulation.runner --all --tier 15

# Run with screenshots disabled
python -m tests.simulation.runner --scenario fantasy_ember --tier 15 --no-screenshots

# Run with cleanup (delete project after metrics saved)
python -m tests.simulation.runner --scenario fantasy_ember --tier 15 --cleanup

# Run against local dev
python -m tests.simulation.runner --scenario mystery_glass --tier 15 --env local

# Run against staging with verbose logging
python -m tests.simulation.runner --scenario fantasy_ember --tier 50 --env staging --verbose

# Generate benchmark report from existing results
python -m tests.simulation.reports --format markdown --output benchmark.md
```

**CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario <id>` | (required unless `--all` or `--list`) | Scenario ID to run |
| `--all` | false | Run all registered scenarios |
| `--list` | false | List available scenarios and exit |
| `--tier {15,50,100}` | 15 | Scale tier |
| `--env {staging,local}` | staging | Target environment |
| `--dry-run` | false | Print execution plan without running |
| `--no-screenshots` | false | Skip screenshot capture |
| `--cleanup` | false | Delete simulation project after run (metrics always saved locally) |
| `--verbose / -v` | false | Enable DEBUG logging |

**Execution model:** `--all` runs scenarios sequentially (one at a time). Parallel execution is deferred — sequential avoids concurrency bugs, resource contention on staging, and complex error attribution. A 15-session tier takes roughly 15-20 minutes per scenario, so three scenarios sequential is under an hour.

**Project naming:** Each run creates a project named `sim_{YYYYMMDD}_{HHMMSS}_{scenario_id}` to ensure no collisions and easy identification. Old runs are always preserved unless `--cleanup` is specified.

**Cleanup behavior:** When `--cleanup` is set, the runner calls `DELETE /api/projects/{project_id}` after metrics are saved to the local filesystem. This cascade-deletes all stories, sessions, and messages. Metrics JSON is always saved locally regardless of cleanup.

### 6.3 Environment Configuration

```python
# tests/simulation/config.py

ENVIRONMENTS = {
    'local': {
        'base_url': 'http://localhost:8000',
        'frontend_url': 'http://localhost:3000',
        'auth_method': 'test_bypass',
    },
    'staging': {
        'base_url': 'https://brainstormy-staging.onrender.com',
        'frontend_url': 'https://brainstormy-frontend-staging.onrender.com',
        'auth_method': 'clerk_session',
    },
}
```

---

## Part 7: LLM-Generated Session Content (Tiers 50 and 100)

### 7.1 Hybrid Authoring Approach

Sessions 1-15 are fully hand-authored â€” every user message is pre-written to ensure quality and control. For tiers 50 and 100, a hybrid approach generates additional sessions:

1. **Session outlines are hand-authored** â€” topic, facts to establish, which prior sessions it builds on
2. **User messages are LLM-generated** â€” prompted with the story context, writer persona, and session outline
3. **Quality review** â€” generated messages are reviewed and adjusted before being committed to the story library

### 7.2 Message Generation Prompt

```python
MESSAGE_GENERATION_PROMPT = """
You are generating user messages for a simulated brainstorming session in a creative 
writing tool. The messages should sound like a real writer thinking through their story 
â€” informal, exploratory, sometimes excited, sometimes uncertain.

STORY CONTEXT:
{story_summary}

PRIOR SESSIONS SUMMARY:
{relevant_session_summaries}

THIS SESSION:
- Topic: {session_topic}
- Session type: {guidance_mode} / {template}
- Facts to establish: {facts_to_establish}
- Building on: {prior_session_references}

Generate {message_count} user messages that:
1. Sound like natural writer thinking-aloud (not commands or test data)
2. Organically establish the required facts through conversation
3. Reference earlier decisions when relevant (shows the writer remembers their own story)
4. Include at least one moment of backtracking or revision
5. Show genuine creative engagement â€” excitement, uncertainty, discovery

Format: Return a JSON array of strings, each being one user message.
"""
```

### 7.3 Generated Content Review Pipeline

Generated sessions go through review before inclusion:

1. **Generate** â€” LLM produces session messages
2. **Automated check** â€” Verify facts are addressable, messages are reasonable length, no anachronisms
3. **Manual review** â€” Quick read-through for quality (does it sound like a real writer?)
4. **Commit** â€” Approved sessions are saved to the story library as permanent fixtures
5. **Regenerate** â€” Rejected sessions are regenerated with adjusted prompts

This pipeline runs once to build out the 50 and 100 tier content. The generated sessions become static fixtures, not regenerated each run.

---

## Part 8: Benchmark Reporting

### 8.1 Report Format

After each simulation run, generate a markdown report:

```markdown
# Brainstormy Simulation Report

## Run Summary
- **Scenario:** The Last Ember (Fantasy)
- **Scale:** 15 sessions, 47 messages
- **Date:** 2026-02-15
- **Environment:** staging

## Memory Retention
- **Overall Score:** 92% (23/25 facts recalled)
- **Direct Recall:** 95% (19/20)
- **Cross-Reference:** 80% (4/5)
- **Inference:** N/A (0 queries this tier)

### Retention by Session Distance
| Facts From | Recall Rate | Notes |
|------------|-------------|-------|
| Sessions 1-5 | 90% | Oldest facts, tested by most queries |
| Sessions 6-10 | 95% | Mid-story facts |
| Sessions 11-15 | 100% | Recent facts |

## Citation Accuracy
- **Standard Bible:** 94% accuracy, 2% hallucination rate
- **Character Profile (Elena):** 91% accuracy, 3% hallucination rate
- **Story Outline:** 88% accuracy, 5% hallucination rate

## Performance
- **Avg Response Time:** 3,200ms
- **P95 Response Time:** 8,100ms
- **Summary Generation:** avg 12s, max 28s
- **Bible Generation:** avg 45s

## Errors
- None

## Screenshots
- 7 screenshots captured in tests/simulation/screenshots/fantasy_ember_15/
```

### 8.2 Competitive Positioning Data

The benchmark report includes data points suitable for marketing claims:

```
âœ… "92% fact retention across 15 brainstorming sessions"
âœ… "94% citation accuracy in auto-generated Story Bibles"  
âœ… "Zero contradictions detected across 47 messages"
âœ… "Average 3.2s response time with full story context"
```

These numbers should be validated across multiple runs before being used in marketing materials. Target: 3+ consistent runs with similar numbers.

---

## Part 9: Implementation Plan

### Phase 1: Foundation (3-4 days)

| Task | Estimate | Description |
|------|----------|-------------|
| 1.1 | 2 hours | Project structure, config, dependencies |
| 1.2 | 4 hours | API client with auth + all endpoints |
| 1.3 | 3 hours | Metrics collector (timing, retention structure) |
| 1.4 | 2 hours | Basic CLI runner |
| 1.5 | 1 hour | Pytest fixtures and conftest |

**Milestone:** Can create a project, send messages, collect timing metrics via CLI.

### Phase 2: First Story â€” "The Last Ember" Tier 15 (3-4 days)

| Task | Estimate | Description |
|------|----------|-------------|
| 2.1 | 6 hours | Author all 15 session scripts with 3-6 messages each |
| 2.2 | 2 hours | Define challenge queries and expected facts |
| 2.3 | 2 hours | Define deliverable requests |
| 2.4 | 3 hours | Run simulation end-to-end, debug API integration |
| 2.5 | 2 hours | Retention evaluator (LLM-based scoring) |
| 2.6 | 2 hours | Citation evaluator |

**Milestone:** Complete simulation of "The Last Ember" with retention and citation metrics.

### Phase 3: Screenshots and Reporting (2-3 days)

| Task | Estimate | Description |
|------|----------|-------------|
| 3.1 | 4 hours | Playwright screenshot capture system |
| 3.2 | 2 hours | Screenshot integration with runner |
| 3.3 | 3 hours | Benchmark report generator |
| 3.4 | 2 hours | Run 3x for consistency, adjust thresholds |

**Milestone:** Screenshots captured, benchmark report generated with marketing-ready numbers.

### Phase 4: Remaining Stories â€” Tier 15 (3-4 days)

| Task | Estimate | Description |
|------|----------|-------------|
| 4.1 | 6 hours | Author "The Glass Alibi" (mystery) â€” 15 sessions |
| 4.2 | 6 hours | Author "The Atlas of Us" (romance) â€” 15 sessions |
| 4.3 | 2 hours | Run all three scenarios, cross-genre metrics |

**Milestone:** All three genres at tier 15 complete with metrics and screenshots.

### Phase 5: Progressive Scale â€” Tiers 50 and 100 (5-7 days)

| Task | Estimate | Description |
|------|----------|-------------|
| 5.1 | 4 hours | LLM message generation pipeline |
| 5.2 | 6 hours | Author session outlines for tier 50 (35 additional per story) |
| 5.3 | 4 hours | Generate and review tier 50 messages |
| 5.4 | 4 hours | Run tier 50 simulations, measure retention degradation |
| 5.5 | 6 hours | Author session outlines for tier 100 |
| 5.6 | 4 hours | Generate and review tier 100 messages |
| 5.7 | 4 hours | Run tier 100 simulations, stress test analysis |

**Milestone:** Full progressive scale testing complete. Know exact session count where retention begins to degrade.

### Total Estimated Effort

| Phase | Days | Focus |
|-------|------|-------|
| Phase 1: Foundation | 3-4 | Infrastructure |
| Phase 2: First Story | 3-4 | Content + Metrics |
| Phase 3: Screenshots | 2-3 | Visual Assets |
| Phase 4: Remaining Stories | 3-4 | Content |
| Phase 5: Scale | 5-7 | Stress Testing |
| **Total** | **~16-22 days** | |

Phases 1-3 deliver the highest immediate value: one working scenario with metrics AND screenshots. Phases 4-5 expand breadth and depth.

---

## Part 10: Success Criteria

### Stress Testing
- [ ] All three scenarios run to completion at tier 15 without errors
- [ ] Memory retention rate â‰¥ 85% at tier 15
- [ ] Memory retention rate â‰¥ 75% at tier 50
- [ ] Identify exact session count where retention begins to measurably degrade
- [ ] Citation accuracy â‰¥ 85% across all deliverable types
- [ ] Zero contradictions in tier 15 runs
- [ ] P95 response time < 15 seconds at tier 50

### Marketing Content
- [ ] Screenshots look like real writer projects (pass "would I put this in an ad?" test)
- [ ] At least 7 distinct screenshot types per scenario (chat, bible, report, search, list, overview, focus)
- [ ] Story content is genre-authentic and compelling
- [ ] Walkthrough sequence suitable for video production

### Competitive Benchmarks
- [ ] 3+ consistent runs per scenario producing similar metrics
- [ ] Benchmark report includes marketing-ready data points
- [ ] Metrics are reproducible (< 5% variance between runs)

---

## Part 11: Resolved Design Decisions

*Previously "Open Questions" — resolved 2026-02-14.*

**1. Test user management:** One dedicated simulation Clerk user for all scenarios. Scenario isolation via unique timestamp-prefixed project names (`sim_{timestamp}_{scenario_id}`). No per-scenario users needed — projects are already fully isolated by `project_id`.

**2. Data cleanup:** Preserve simulation projects on staging by default. `--cleanup` CLI flag available to delete after run. Preserved projects enable screenshot re-capture, manual QA inspection, marketing asset mining, and demo walkthroughs. Metrics JSON is always saved locally regardless of cleanup.

**3. Session end timing:** Poll `GET /api/sessions/{id}` for `has_summary: true` with exponential backoff (2s initial → 10s max interval, 120s hard timeout). On timeout, log warning and continue — don't abort the run. See Part 3.4 for full detail. **WhatsApp notification:** The runner should send a WhatsApp notification upon simulation run completion (success or failure) using the same Twilio integration as the QA Engine. This requires verifying that the QA Engine's WhatsApp communication system is operational. The notification should include: scenario name, tier, pass/fail status, retention score, and duration.

**4. OpenRouter API key:** Pre-configured manually in the simulation Clerk user's Brainstormy account settings. One-time setup. The runner's preflight check (Part 3.5) verifies auth works before committing to a long run. No programmatic key management.

**5. Concurrent runs:** Sequential only for v1. The `--all` flag loops through scenarios one at a time. Parallel execution deferred to Phase 5+ only if actual run times prove problematic. Three tier-15 scenarios sequential is under an hour.

**6. Existing test data:** Always create fresh projects. Never reuse or append to existing simulation projects. Reproducible metrics require clean state. Timestamp-prefixed project names avoid collisions. Old runs accumulate on staging and can be bulk-deleted via `--cleanup` or manually through the UI.
