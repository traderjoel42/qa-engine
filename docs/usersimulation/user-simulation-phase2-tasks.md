# User Simulation Framework — Phase 2 Tasks

**Phase:** 2 — First Story ("The Last Ember" Tier 15)
**Estimated effort:** 17 hours (3–4 days)
**Depends on:** Phase 1 (complete), EndSessionResponse bug fix (summary_id should be `str | None`)
**Milestone:** Complete simulation of "The Last Ember" with retention and citation metrics.

---

## Prerequisites

Before starting Phase 2:

1. **EndSessionResponse bug must be fixed** — `end_session` currently returns 400 because `summary_id` is typed as `str` but comes back as `None` when no summary exists yet. Phase 1 documented this. Fix in the backend Pydantic model before running Phase 2 end-to-end.

2. **Phase 1 validated against staging** — Runner works, messages send, bible generates, challenge query placeholder flow works.

3. **Anthropic API key available** — Required for the RetentionEvaluator (LLM-based scoring). The key should be in `.env` as `ANTHROPIC_API_KEY`. This is separate from the OpenRouter key used by Brainstormy itself.

---

## Task 2.1: Author 15 Session Scripts (~6 hours)

### Task 2.1.1: Replace Placeholder Scenario with Full Scenario Shell

**File:** `tests/simulation/stories/fantasy_ember.py`

Replace the placeholder `FANTASY_EMBER_PLACEHOLDER` (1 session, 3 messages) with the full `FANTASY_EMBER` scenario shell containing all 15 `SessionScript` entries. Start with metadata only (name, guidance_mode, template, focus_target_name, expected_facts, description) — messages are filled in by subsequent sub-tasks.

Use the session arc table from the spec (Part 2.3, Scenario 1):

```python
from ..models import StoryScenario, SessionScript, ChallengeQuery, DeliverableRequest
from ..registry import register_scenario

FANTASY_EMBER = StoryScenario(
    id='fantasy_ember',
    name='The Last Ember',
    genre='fantasy',
    description='In a world where magical ability is fading generation by generation, '
                'a young artificer discovers her inventions channel the last reserves '
                'of ambient magic — and a dying order of mages wants to use her as a '
                'living conduit to reignite the source.',
    project_name='The Last Ember',
    story_name='Book 1: The Last Ember',
    navigator_key='fantasy',
    sessions=[
        # Session 1: Initial premise brainstorm
        SessionScript(
            name='Initial Premise Brainstorm',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.2
            expected_facts=[
                'Magic is fading/declining generation by generation',
                'World is in a twilight period between magic and mundane',
                'Story has a fantasy/science-fiction hybrid feel',
            ],
            description='Exploring the core concept — magic dying, the world feeling it',
            screenshot_moments=['after_session'],
        ),
        # Session 2: Elena — who is she?
        SessionScript(
            name='Elena — Who Is She?',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.2
            expected_facts=[
                'Elena is the protagonist',
                'Elena is an artificer (builds mechanical/magical devices)',
                'Elena is in her mid-20s',
                'Elena is a skeptic about magic',
                'Elena works in her grandfather\'s workshop',
            ],
            description='Discovering Elena as a character — her skills, personality, world',
            screenshot_moments=['after_session'],
        ),
        # Session 3: Elena's backstory
        SessionScript(
            name='Elena\'s Backstory',
            guidance_mode='focus',
            template='character',
            focus_target_name='Elena',
            messages=[],  # Filled in Task 2.1.3
            expected_facts=[
                'Elena\'s grandfather taught her the craft',
                'Grandfather died approximately 2 years ago',
                'Elena inherited the workshop/shop from her grandfather',
                'Grandfather may have known more about magic than he let on',
            ],
            description='Deep dive into Elena\'s history, her grandfather, and the workshop',
        ),
        # Session 4: The magic system
        SessionScript(
            name='The Magic System',
            guidance_mode='focus',
            template='world',
            messages=[],  # Filled in Task 2.1.3
            expected_facts=[
                'Magic is tied to "ember lines" — ley-line equivalent',
                'Ember lines are depleting over centuries',
                'Magic was once common but is now rare',
                'Elena\'s inventions unknowingly draw on ember line energy',
            ],
            description='Designing how magic works — ember lines, depletion, connection to the land',
        ),
        # Session 5: The Order of Kindling
        SessionScript(
            name='The Order of Kindling',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.4
            expected_facts=[
                'The Order of Kindling is a secret mage order',
                'They believe Elena is a "Conduit"',
                'They want to use Elena to reignite the magic source',
                'The Order is dying out along with magic itself',
            ],
            description='Introducing the Order — who they are, what they want, why they matter',
        ),
        # Session 6: Maren — the Order's emissary
        SessionScript(
            name='Maren — The Order\'s Emissary',
            guidance_mode='focus',
            template='character',
            focus_target_name='Maren',
            messages=[],  # Filled in Task 2.1.4
            expected_facts=[
                'Maren is the Order\'s emissary to Elena',
                'Maren is a true believer in the Order\'s mission',
                'Maren is roughly Elena\'s age',
                'Maren becomes an ambiguous ally — not straightforwardly trustworthy',
            ],
            description='Building Maren as a character — beliefs, relationship to Elena, complexity',
        ),
        # Session 7: Act 1 structure
        SessionScript(
            name='Act 1 Structure',
            guidance_mode='focus',
            template='plot',
            messages=[],  # Filled in Task 2.1.5
            expected_facts=[
                'Inciting incident: Elena\'s latest invention causes a visible magical flare',
                'The flare draws the Order\'s attention',
                'Elena\'s normal world is established before the flare',
                'Act 1 ends with Elena forced to acknowledge magic is real',
            ],
            description='Structuring the first act — normal world, inciting incident, first threshold',
        ),
        # Session 8: The antagonist question
        SessionScript(
            name='The Antagonist Question',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.5
            expected_facts=[
                'Lord Castellan Voss is the Order\'s leader',
                'Voss is willing to sacrifice Elena for the "greater good"',
                'Voss believes the ends justify the means',
                'Voss is not a simple villain — he genuinely believes he\'s saving the world',
            ],
            description='Exploring the antagonist — who opposes Elena and why',
        ),
        # Session 9: Political landscape
        SessionScript(
            name='Political Landscape',
            guidance_mode='focus',
            template='world',
            messages=[],  # Filled in Task 2.1.6
            expected_facts=[
                'Three factions: Order of Kindling (restore magic), Rationalists (embrace mundane), Crown (maintain control)',
                'Factions have competing visions for the world\'s future',
                'Elena is caught between factions',
                'The Crown wants to control magic\'s decline for political advantage',
            ],
            description='Mapping the political world — factions, tensions, competing agendas',
        ),
        # Session 10: Supporting cast roundup
        SessionScript(
            name='Supporting Cast Roundup',
            guidance_mode='focus',
            template='character',
            messages=[],  # Filled in Task 2.1.6
            expected_facts=[
                'Dex is Elena\'s apprentice — young, loyal, comic relief',
                'Sable is an information broker — morally ambiguous, useful',
                'Theron is a Crown investigator — represents institutional power',
                'Each supporting character has their own agenda',
            ],
            description='Rounding out the cast — Dex, Sable, Theron, their roles in the story',
        ),
        # Session 11: Midpoint and Act 2
        SessionScript(
            name='Midpoint and Act 2',
            guidance_mode='focus',
            template='plot',
            messages=[],  # Filled in Task 2.1.7
            expected_facts=[
                'Elena learns she IS the last ember — her bloodline is the final magical reservoir',
                'This revelation is the midpoint twist',
                'Act 2 escalates the stakes from "they want my help" to "they want ME"',
                'Elena\'s agency is the central tension of Act 2',
            ],
            description='The midpoint revelation and second act structure',
        ),
        # Session 12: The revelation scene
        SessionScript(
            name='The Revelation Scene',
            guidance_mode='focus',
            template='scene',
            messages=[],  # Filled in Task 2.1.7
            expected_facts=[
                'Elena discovers the truth in her grandfather\'s hidden workshop beneath the shop',
                'The hidden workshop contains evidence grandfather knew about the ember lines',
                'The discovery is emotional — betrayal, wonder, grief',
                'This scene is the emotional climax of Act 2',
            ],
            description='Designing the scene where Elena discovers the truth about herself',
        ),
        # Session 13: Thematic exploration
        SessionScript(
            name='Thematic Exploration',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.8
            expected_facts=[
                'Core theme: technology vs. magic (or: innovation vs. tradition)',
                'Secondary theme: sacrifice vs. self-preservation',
                'Tertiary theme: found family vs. blood obligation',
                'Elena embodies the tension between these themes',
            ],
            description='Stepping back to think about what the story is really about',
        ),
        # Session 14: Act 3 and climax
        SessionScript(
            name='Act 3 and Climax',
            guidance_mode='focus',
            template='plot',
            messages=[],  # Filled in Task 2.1.8
            expected_facts=[
                'Elena chooses to redistribute the magic rather than hoard or surrender it',
                'The climax involves Elena using her artificer skills in a new way',
                'Voss opposes the redistribution — he wants concentrated power',
                'The resolution changes the world permanently',
            ],
            description='Planning the final act — Elena\'s choice, the climactic confrontation, resolution',
        ),
        # Session 15: Series potential, loose threads
        SessionScript(
            name='Series Potential and Loose Threads',
            guidance_mode='explore',
            messages=[],  # Filled in Task 2.1.9
            expected_facts=[
                'Book 2 setup: consequences of redistribution are unpredictable',
                'Maren\'s relationship with Elena is unresolved',
                'Voss is still active/alive — not defeated permanently',
                'New magical phenomena emerge from the redistribution',
            ],
            description='Looking beyond Book 1 — what\'s next, what\'s unresolved',
            screenshot_moments=['after_session'],
        ),
    ],
    challenge_queries=[],   # Filled in Task 2.2
    deliverables=[],        # Filled in Task 2.3
)

register_scenario(FANTASY_EMBER)
```

**Validation:**
- [ ] `python -m tests.simulation --list` shows `fantasy_ember` with 15 sessions
- [ ] `python -m tests.simulation --scenario fantasy_ember --dry-run` prints all 15 sessions with correct modes/templates
- [ ] No import errors

### Task 2.1.2: Author Sessions 1–2 (Explore Sessions — Premise and Protagonist)

**File:** `tests/simulation/stories/fantasy_ember.py`

Fill in messages for sessions 1 and 2. These are both `explore` mode — broad, free-flowing brainstorming. Each session needs 4–5 messages.

**Session 1 — Initial Premise Brainstorm (4 messages):**
The writer is arriving with a half-formed concept. Messages should feel like someone thinking out loud about a "what if" idea. Establish: magic is fading, the world is in transition, there's something bittersweet about the setting. Include one moment of getting excited about an idea.

**Session 2 — Elena, Who Is She? (4 messages):**
The writer is now exploring the protagonist. Messages should feel like someone discovering a character — "I think she's..." and "What if she..." style. Establish: Elena's name, her profession (artificer), her age bracket, her skepticism, her workspace. Include one moment of backtracking ("Actually, I don't think she should be...").

**Message writing guidelines (from spec Part 2.4):**
- Sound like a real writer thinking out loud, not issuing commands
- Use contractions, casual phrasing, sentence fragments
- Show creative development — exploring, backtracking, getting excited
- Establish facts organically: "I think Elena is the oldest of three sisters" not "Establish fact: Elena has two siblings"
- 2–4 sentences per message is the sweet spot
- Reference the AI's likely responses with phrases like "oh I like that idea" or "building on what you said"
- Include moments of uncertainty: "I'm not sure about this part but..."

**Example message style from spec:**
```
"I've been thinking about this concept for a while — what if magic is dying?
Not like it disappears overnight, but more like a slow fade. Each generation
has a little less of it. And the people in this world can feel it happening."
```

**Validation:**
- [ ] Session 1 has 4 messages that establish all 3 expected facts
- [ ] Session 2 has 4 messages that establish all 5 expected facts
- [ ] Messages read as natural writer brainstorming, not test data
- [ ] At least one message per session references or builds on the AI's likely response
- [ ] At least one backtracking/revision moment across the two sessions

### Task 2.1.3: Author Sessions 3–4 (Focus Sessions — Backstory and Magic System)

**File:** `tests/simulation/stories/fantasy_ember.py`

Fill in messages for sessions 3 and 4. Both are `focus` mode — deeper, more structured exploration.

**Session 3 — Elena's Backstory (4 messages, focus: character, target: Elena):**
The writer is going deeper on Elena. Focus on the grandfather relationship, the workshop inheritance, the gap between what she knows and what she'll discover. Include emotional depth — this isn't just facts, it's the emotional core. One message should show the writer discovering something surprising about their own character.

**Session 4 — The Magic System (5 messages, focus: world):**
The writer is designing the rules. "Ember lines" as ley-line equivalent, how they're depleting, how Elena's inventions interact with them. Include one moment of the writer getting excited about a tension/irony (e.g., "Wait — if her inventions draw on the last reserves, she's actually *accelerating* the end of magic"). This is the session where world-building clicks into place.

**Validation:**
- [ ] Session 3 has 4 messages establishing all 4 expected facts
- [ ] Session 4 has 5 messages establishing all 4 expected facts
- [ ] The "Wait —" eureka moment appears naturally in session 4
- [ ] Messages use focus session conventions (deeper, more specific questions/statements)

### Task 2.1.4: Author Sessions 5–6 (Order of Kindling and Maren)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 5 — The Order of Kindling (4 messages, explore):**
Introducing the antagonist faction. The writer is brainstorming who these people are and what they want. Feel of "I think there needs to be an organization that..." evolving into specific details. Establish: secret order, they believe Elena is a Conduit, their plan to use her, their own decline.

**Session 6 — Maren (5 messages, focus: character, target: Maren):**
Building the most important secondary character. The writer is working out Maren's complexity — she's not a villain, not an ally, somewhere in between. Include tension between Maren's loyalty to the Order and her growing connection to Elena. One message should backtrack on Maren being a "true believer" to add nuance (per spec Part 2.4 example: "Actually, I don't think Maren should be a true believer. That's too simple.").

**Validation:**
- [ ] Session 5 has 4 messages establishing all 4 expected facts
- [ ] Session 6 has 5 messages establishing all 4 expected facts
- [ ] Maren's complexity comes through — not reducible to a simple archetype
- [ ] The backtracking moment in session 6 adds genuine nuance

### Task 2.1.5: Author Sessions 7–8 (Act 1 Structure and Antagonist)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 7 — Act 1 Structure (4 messages, focus: plot):**
The writer is structuring the opening act. Messages should feel like someone organizing earlier brainstorming into a narrative shape. Reference prior sessions: "So with Elena in her workshop and the ember lines depleting..." Establish the inciting incident (magical flare from an invention) and Act 1's arc.

**Session 8 — The Antagonist Question (4 messages, explore):**
The writer is figuring out the villain. This should feel exploratory — "Who is actually opposing Elena?" — before arriving at Lord Castellan Voss. Include the writer working through the nuance of a villain who genuinely believes he's right. One message should show the writer rejecting a simpler antagonist concept in favor of Voss's moral complexity.

**Validation:**
- [ ] Session 7 has 4 messages establishing all 4 expected facts
- [ ] Session 8 has 4 messages establishing all 4 expected facts
- [ ] Session 7 references earlier sessions organically (shows the writer remembers their own story)
- [ ] Voss feels like a three-dimensional antagonist, not a cardboard villain

### Task 2.1.6: Author Sessions 9–10 (Political Landscape and Supporting Cast)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 9 — Political Landscape (5 messages, focus: world):**
The writer is mapping the power dynamics. Three factions (Order, Rationalists, Crown) with competing agendas. Messages should feel like someone working out how the pieces fit together: "OK so if the Order wants to restore magic, who opposes that?" Include cross-references to earlier decisions.

**Session 10 — Supporting Cast Roundup (5 messages, focus: character):**
The writer is filling out the ensemble. Dex, Sable, Theron — each with a brief personality sketch and narrative role. This session establishes the characters whose profiles will be generated as deliverables. Messages should introduce each character with personality, not just function.

**Note on focus_target_name:** Session 10 is a roundup session covering multiple characters. Set `focus_target_name=None` (even though template is 'character') — the API rejects focus_target_name when it doesn't match a single entity. The writer will mention all three characters in their messages.

**Deviation from spec:** The spec's arc table says "Focus: Character" for session 10, implying a single character focus. But the content (Dex, Sable, Theron) is multi-character. We use `guidance_mode='focus'`, `template='character'`, `focus_target_name=None` to get character-mode prompting without targeting a single character. If the API rejects this combination during integration testing (Task 2.4), fall back to `guidance_mode='explore'`.

**Validation:**
- [ ] Session 9 has 5 messages establishing all 4 expected facts
- [ ] Session 10 has 5 messages establishing all 4 expected facts
- [ ] Three factions are clearly distinct with different worldviews
- [ ] Each supporting character has personality, not just plot function

### Task 2.1.7: Author Sessions 11–12 (Midpoint and Revelation Scene)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 11 — Midpoint and Act 2 (4 messages, focus: plot):**
The big twist: Elena IS the last ember. The writer should arrive at this gradually — not state it in message 1 but build toward it across the session. "What if the reason her inventions channel magic is because..." One message should show the writer realizing the implications for Act 2's structure.

**Session 12 — The Revelation Scene (4 messages, focus: scene):**
Designing a specific scene in detail. The grandfather's hidden workshop beneath the shop. This is the most emotionally grounded session — the writer is imagining physical space, emotional beats, sensory details. Messages should feel cinematic: "I see her pushing aside the workbench and finding the trapdoor..."

**Validation:**
- [ ] Session 11 has 4 messages establishing all 4 expected facts
- [ ] Session 12 has 4 messages establishing all 4 expected facts
- [ ] The midpoint twist feels earned, not blurted out
- [ ] Session 12 has sensory/spatial details that feel like a real scene

### Task 2.1.8: Author Sessions 13–14 (Theme and Act 3)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 13 — Thematic Exploration (4 messages, explore):**
The writer is stepping back from plot to think about meaning. Technology vs. magic, sacrifice vs. self-preservation, found family. Messages should feel reflective: "I keep coming back to this idea that Elena represents both sides..." Include connections between theme and earlier plot decisions.

**Session 14 — Act 3 and Climax (5 messages, focus: plot):**
Planning the ending. Elena's choice to redistribute rather than hoard or surrender. The confrontation with Voss. How the resolution changes the world. Messages should feel decisive — the writer is making final calls after 13 sessions of exploration. Reference earlier decisions across multiple sessions.

**Validation:**
- [ ] Session 13 has 4 messages establishing all 4 expected facts
- [ ] Session 14 has 5 messages establishing all 4 expected facts
- [ ] Thematic discussion connects to specific plot/character decisions
- [ ] Act 3 plan references decisions from sessions 7, 8, 11 organically

### Task 2.1.9: Author Session 15 (Series Potential)

**File:** `tests/simulation/stories/fantasy_ember.py`

**Session 15 — Series Potential and Loose Threads (4 messages, explore):**
The writer is looking beyond Book 1. What threads remain unresolved? What consequences of the climax seed Book 2? The tone should feel expansive and forward-looking — the writer is excited about the possibilities. Reference the Maren relationship, Voss's survival, the unpredictable effects of magic redistribution.

**Validation:**
- [ ] Session 15 has 4 messages establishing all 4 expected facts
- [ ] Forward-looking tone — the writer is excited, not just wrapping up
- [ ] References at least 3 specific earlier decisions across different sessions

### Task 2.1.10: Review Pass — Message Quality and Fact Coverage

**File:** `tests/simulation/stories/fantasy_ember.py`

Full review of all 15 sessions after initial authoring:

1. **Read all messages sequentially** — do they feel like a coherent creative process?
2. **Fact coverage audit** — does every `expected_facts` entry have a clear message that establishes it?
3. **Cross-reference check** — do later sessions reference earlier decisions naturally?
4. **Voice consistency** — does the "writer" feel like the same person throughout?
5. **Message count verification** — confirm 3–6 messages per session, total ≈ 60–70 messages

**Count targets from spec dry-run output:**
- 15 sessions total
- ~52 total messages (spec estimate) — adjust to 60-70 for richer content

**Validation:**
- [ ] All sessions have 3–6 messages
- [ ] Total message count is 60–70
- [ ] Every expected fact has at least one message that clearly establishes it
- [ ] Later sessions reference earlier sessions at least 8 times total
- [ ] No two messages use identical phrasing patterns
- [ ] Messages pass the "would I screenshot this?" test (looks like a real project)
- [ ] `python -m tests.simulation --scenario fantasy_ember --dry-run` shows correct counts

**After completion:** `git add tests/simulation/stories/fantasy_ember.py && git commit -m "Phase 2.1: Author all 15 session scripts for The Last Ember" && git push`

---

## Task 2.2: Define Challenge Queries and Expected Facts (~2 hours)

### Task 2.2.1: Implement 5 Challenge Queries

**File:** `tests/simulation/stories/fantasy_ember.py`

Add the 5 challenge queries from the spec to the `FANTASY_EMBER` scenario's `challenge_queries` list. Each query is sent in its own dedicated session (implemented in Phase 1 runner) to prevent contamination.

```python
challenge_queries=[
    # 1. Direct recall — session 3 (Elena's backstory)
    ChallengeQuery(
        query="What is Elena's relationship to her grandfather?",
        established_in_session=2,  # 0-indexed: session 3 = index 2
        expected_facts=[
            'Grandfather taught Elena her craft/skills',
            'Grandfather died approximately 2 years ago',
            'Elena inherited the workshop/shop from him',
        ],
        query_type='direct_recall',
    ),
    # 2. Direct recall — session 4 (magic system)
    ChallengeQuery(
        query="How does the magic system work in this world?",
        established_in_session=3,  # 0-indexed: session 4 = index 3
        expected_facts=[
            'Magic is tied to ember lines (ley-line equivalent)',
            'Ember lines are depleting over centuries',
            'Elena\'s inventions draw on ember line energy',
        ],
        query_type='direct_recall',
    ),
    # 3. Cross-reference — sessions 5 + 8 (Order + Voss)
    ChallengeQuery(
        query="Why would Castellan Voss be willing to sacrifice Elena?",
        established_in_session=7,  # Primary: session 8 (Voss), index 7
        expected_facts=[
            'Voss believes sacrificing Elena will reignite magic',
            'Voss sees this as serving the greater good',
            'The Order (which Voss leads) wants to use Elena as a Conduit',
        ],
        query_type='cross_reference',
    ),
    # 4. Inference — sessions 6 + 14 (Maren + climax)
    ChallengeQuery(
        query="Given Elena's decision at the climax, what happens to Maren's "
              "beliefs about the Order?",
        established_in_session=13,  # Primary: session 14 (climax), index 13
        expected_facts=[
            'Elena chose redistribution over the Order\'s plan',
            'Maren was a believer in the Order\'s mission (with doubts)',
            'Elena\'s choice challenges Maren\'s worldview',
        ],
        query_type='inference',
    ),
    # 5. Cross-reference — session 9 (factions)
    ChallengeQuery(
        query="What are all the factions and their positions on magic?",
        established_in_session=8,  # 0-indexed: session 9 = index 8
        expected_facts=[
            'Order of Kindling wants to restore/preserve magic',
            'Rationalists want to embrace the mundane/non-magical future',
            'The Crown wants to control magic\'s decline for political advantage',
            'Three distinct factions with competing visions',
        ],
        query_type='cross_reference',
    ),
],
```

**Note on `established_in_session`:** This is 0-indexed, matching Python list indexing. Session 3 in the arc table = index 2. The evaluator uses this to assess recall distance (how far back the AI must remember).

**Validation:**
- [ ] 5 challenge queries defined with all fields populated
- [ ] `established_in_session` values are correct 0-indexed references
- [ ] `expected_facts` are specific enough for LLM evaluation (not vague)
- [ ] Mix of query types: 2 direct_recall, 2 cross_reference, 1 inference
- [ ] `python -m tests.simulation --scenario fantasy_ember --dry-run` shows 5 challenge queries

**After completion:** `git add tests/simulation/stories/fantasy_ember.py && git commit -m "Phase 2.2: Define challenge queries for The Last Ember" && git push`

---

## Task 2.3: Define Deliverable Requests and Implement Mid-Run Triggering (~2 hours)

### Task 2.3.1: Define 5 Deliverable Requests

**File:** `tests/simulation/stories/fantasy_ember.py`

Add deliverables from the spec to the `FANTASY_EMBER` scenario:

```python
deliverables=[
    # Character profiles — after session 10 (supporting cast established)
    DeliverableRequest(
        type='report',
        template_id='character_profile',
        parameters={'character_name': 'Elena'},
        trigger_after_session=9,  # 0-indexed: after session 10 = index 9
    ),
    DeliverableRequest(
        type='report',
        template_id='character_profile',
        parameters={'character_name': 'Maren'},
        trigger_after_session=9,  # 0-indexed: after session 10 = index 9
    ),
    # Bibles and outline — after session 15 (story complete)
    DeliverableRequest(
        type='bible',
        template_id='standard',
        trigger_after_session=-1,  # -1 = after all sessions
    ),
    DeliverableRequest(
        type='bible',
        template_id='character_focused',
        trigger_after_session=-1,
    ),
    DeliverableRequest(
        type='report',
        template_id='outline',
        trigger_after_session=-1,
    ),
],
```

**Note on `trigger_after_session`:** Uses 0-indexed session references. `-1` means "after all sessions." The runner checks this value during the session loop.

**Note on `character_focused` bible template:** Per spec Part 2.2 note: "character_focused bibles and relationship_map/theme_analysis reports exist in the API spec but have never been exercised by the QA Engine. Plan for potential bugs when these are first used." If `character_focused` fails during integration run (Task 2.4), document the bug and comment out for now.

**Validation:**
- [ ] 5 deliverables defined (2 reports after session 10, 2 bibles + 1 report at end)
- [ ] `trigger_after_session` values are correct (9 for mid-run, -1 for end)
- [ ] `parameters` dict matches API expectations (`character_name` key)
- [ ] `python -m tests.simulation --scenario fantasy_ember --dry-run` shows 5 deliverables with correct trigger points

### Task 2.3.2: Implement Mid-Run Deliverable Triggering in Runner

**File:** `tests/simulation/runner.py`

Phase 1 generates all deliverables after all sessions, ignoring `trigger_after_session`. Phase 2 must implement mid-run triggering so character profiles generate after session 10.

**Modify `SimulationRunner.run()` session loop:**

```python
async def run(self) -> RunMetrics:
    # ... setup ...
    
    sessions = self.scenario.get_sessions_for_tier(self.tier)
    for i, session_script in enumerate(sessions):
        await self._run_session(story_id, session_script, session_index=i)
        
        # Check for mid-run deliverables after each session
        await self._check_and_generate_deliverables(story_id, session_index=i)
    
    # Generate end-of-run deliverables (trigger_after_session == -1)
    await self._generate_end_deliverables(story_id)
    
    # ... challenge queries, compile ...
```

**New methods:**

```python
async def _check_and_generate_deliverables(self, story_id: str, session_index: int):
    """Generate any deliverables triggered after the given session index."""
    for deliverable in self.scenario.deliverables:
        if deliverable.trigger_after_session == session_index:
            logger.info(f"Triggering deliverable: {deliverable.type}/{deliverable.template_id} "
                       f"(after session {session_index + 1})")
            await self._generate_deliverable(story_id, deliverable)

async def _generate_end_deliverables(self, story_id: str):
    """Generate deliverables with trigger_after_session == -1."""
    for deliverable in self.scenario.deliverables:
        if deliverable.trigger_after_session == -1:
            await self._generate_deliverable(story_id, deliverable)
```

**Deviation from Phase 1:** Phase 1's `run()` method had a single loop `for deliverable in self.scenario.deliverables: await self._generate_deliverable(...)` at the end. Replace this with the split approach above. The `_generate_deliverable()` method itself doesn't change.

**Validation:**
- [ ] Dry-run output shows deliverable trigger points correctly
- [ ] Character profiles listed as "after session 10" not "at end"
- [ ] The Phase 1 placeholder scenario (with `trigger_after_session=-1`) still works correctly
- [ ] No deliverable is generated twice

**After completion:** `git add tests/simulation/ && git commit -m "Phase 2.3: Deliverables with mid-run triggering" && git push`

---

## Task 2.4: End-to-End Integration Run (~3 hours)

### Task 2.4.1: Fix EndSessionResponse Bug (Backend)

**File:** Backend Pydantic model for `EndSessionResponse`

The `end_session` endpoint returns `summary_id: null` when no summary has been generated yet, but the Pydantic model types it as `str`. Fix to `str | None`.

**This is a backend fix, not a simulation fix.** Document the exact file/line and fix during this task.

**Validation:**
- [ ] `end_session` no longer returns 400 when `summary_id` is null
- [ ] Existing functionality unaffected

### Task 2.4.2: Run Full 15-Session Simulation Against Staging

**Command:**
```bash
python -m tests.simulation --scenario fantasy_ember --tier 15 --env staging --verbose
```

**Expected behavior:**
1. Creates project `sim_{timestamp}_fantasy_ember`
2. Creates story "Book 1: The Last Ember"
3. Configures Navigator with `fantasy` key
4. Runs 15 sessions sequentially (60-70 messages total)
5. After session 10: generates Elena and Maren character profiles
6. After session 15: generates standard bible, character_focused bible, and outline
7. Runs 5 challenge queries in separate sessions
8. Compiles and saves metrics JSON
9. Sends WhatsApp notification

**Estimated runtime:** ~15-25 minutes (15 sessions × ~30s avg per session + deliverable generation)

**Debug checklist if issues arise:**
- [ ] Auth: Clerk JWT refreshing properly for long runs?
- [ ] Pacing: Are `asyncio.sleep` delays working between sessions?
- [ ] Summary wait: Is polling for `has_summary: true` working with exponential backoff?
- [ ] Focus sessions: Does the API accept `template` + `focus_target_name` combinations correctly?
- [ ] Character profiles: Does `character_profile` report type work with `parameters={'character_name': '...'}?`
- [ ] Character-focused bible: Does `character_focused` template_id work? (Never tested before — see spec note)
- [ ] Outline report: Does `outline` report type work?
- [ ] Challenge queries: Are dedicated sessions created and ended properly?
- [ ] Message limit: Is any session hitting the message-per-session limit? (Watch for `continued_in` in end_session response)

### Task 2.4.3: Debug and Fix Issues

Record all issues found during the integration run. Common expected issues:

1. **Timing issues** — Sessions may need longer summary wait timeouts for 15+ sessions of context
2. **Character-focused bible bugs** — Template never tested in QA Engine, may have API issues
3. **Focus session validation** — The API may reject certain `template` + `focus_target_name` combos
4. **Rate limiting** — Long runs may hit API or LLM rate limits

For each issue:
- Document the error (HTTP status, response body, logs)
- Classify as: simulation bug, backend bug, or configuration issue
- Fix or work around
- Re-run the failing segment to confirm fix

### Task 2.4.4: Verify Metrics Output

After a successful run, verify the metrics JSON:

```bash
cat tests/simulation/results/*/metrics.json | python -m json.tool | head -50
```

**Expected metrics structure:**
- `scenario_id`: "fantasy_ember"
- `tier`: 15
- `sessions_completed`: 15
- `messages_sent`: 60-70
- `deliverables_generated`: 5
- `challenge_queries_run`: 5
- `retention_results`: 5 entries (all with `score: 0.0` — placeholder until Task 2.5)
- `response_times_ms`: array of timing measurements
- `errors`: ideally empty

**Validation:**
- [ ] Full 15-session run completes without aborting
- [ ] All 5 deliverables generated (or issues documented and worked around)
- [ ] All 5 challenge queries executed with AI responses captured
- [ ] Metrics JSON saved with all expected fields
- [ ] WhatsApp notification received
- [ ] Total runtime logged and reasonable (15-30 minutes)

**After completion:** `git add tests/simulation/ && git commit -m "Phase 2.4: Integration run validated against staging" && git push`

---

## Task 2.5: Retention Evaluator (~2 hours)

### Task 2.5.1: Evaluate Existing Test Framework Evaluators

**Before building from scratch,** check if the existing `tests/framework/evaluators/` has reusable components:

1. **Read** `tests/framework/evaluators/llm_evaluator.py` — Does it have a Claude API client and structured response parsing we can reuse?
2. **Read** `tests/framework/evaluators/consistency_evaluator.py` — Does contradiction detection overlap with retention evaluation?
3. **Read** `tests/framework/evaluators/citation_evaluator.py` — Needed for Task 2.6, evaluate now.

**Decision framework:**
- If the existing LLM evaluator has a working Claude API integration with structured JSON parsing → import and use it as a base
- If it's tightly coupled to the test framework's own data structures → build fresh but follow similar patterns
- If it doesn't exist yet (spec only, not implemented) → build fresh

**Document the decision** in `tests/simulation/PROGRESS.md` under a "Phase 2 Decisions" section.

### Task 2.5.2: Implement RetentionEvaluator

**File:** `tests/simulation/evaluators/retention.py`

```python
import json
import anthropic
from ..models import ChallengeQuery, RetentionResult
from ..config import SimulationConfig

class RetentionEvaluator:
    """Scores whether AI responses contain expected facts using Claude as judge."""
    
    def __init__(self, config: SimulationConfig):
        self.client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var
        self.model = config.evaluation.model  # e.g., 'claude-sonnet-4-5-20250929'
    
    async def evaluate(self, query: ChallengeQuery, ai_response: str) -> RetentionResult:
        """
        Send the challenge query + AI response + expected facts to Claude.
        Parse structured JSON response into RetentionResult.
        """
    
    def _build_evaluation_prompt(self, query: ChallengeQuery, ai_response: str) -> str:
        """Build the evaluation prompt from spec Part 4.2."""
    
    def _parse_evaluation_response(self, raw: str, query: ChallengeQuery) -> RetentionResult:
        """Parse Claude's JSON response into a RetentionResult."""
```

**Evaluation prompt (from spec Part 4.2):**

```python
RETENTION_EVALUATION_PROMPT = """
A user asked an AI writing assistant this question about their story:

Question: {query}

The AI responded:
{ai_response}

The following facts were established earlier in the brainstorming:
{expected_facts_json}

Score the response:
1. Which expected facts are present in the response? (list each with brief evidence)
2. Which expected facts are missing? (list each)
3. Does the response contradict any established facts? (list any contradictions with details)
4. Overall retention score (0.0 to 1.0, where 1.0 = all facts present, no contradictions)

Respond as JSON with this exact structure:
{{
    "facts_present": ["fact text", ...],
    "facts_missing": ["fact text", ...],
    "contradictions": ["description of contradiction", ...],
    "score": 0.0,
    "reasoning": "Brief explanation of scoring"
}}
"""
```

**Implementation details:**
- Use the `anthropic` Python SDK (already in requirements for the project)
- Use `client.messages.create()` with `response_format` or parse JSON from text response
- Model: Use `claude-sonnet-4-5-20250929` for cost efficiency (not Opus — evaluation doesn't need max intelligence)
- Set `max_tokens=1024` — evaluation responses are short
- Parse JSON from the response, handling potential formatting issues (code blocks, trailing text)
- Map parsed fields to `RetentionResult` dataclass

**Config addition:** Add `evaluation.model` to `SimulationConfig` if not already present:

```python
@dataclass
class EvaluationConfig:
    model: str = 'claude-sonnet-4-5-20250929'
    max_tokens: int = 1024
    temperature: float = 0.0  # Deterministic for evaluation
```

**Validation:**
- [ ] Can call Claude API with the evaluation prompt
- [ ] Parses JSON response correctly into RetentionResult
- [ ] Handles malformed JSON gracefully (logs warning, returns score 0.0)
- [ ] Score computation matches: `len(facts_present) / len(expected_facts)` (cross-check with LLM's own score)
- [ ] Contradictions are captured separately from missing facts
- [ ] `raw_evaluation` field contains the full LLM response for debugging

### Task 2.5.3: Integrate RetentionEvaluator into Runner

**File:** `tests/simulation/runner.py`

Replace the Phase 1 placeholder evaluation (which returns `score=0.0, facts_missing=query.expected_facts`) with real LLM evaluation.

**Modify `_run_challenge_queries()`:**

```python
async def _run_challenge_queries(self, story_id: str) -> list[RetentionResult]:
    evaluator = RetentionEvaluator(self.config)
    retention_results = []
    
    for query in self.scenario.challenge_queries:
        # Create dedicated session (unchanged from Phase 1)
        session = await self.client.create_session(
            story_id, f"[Recall Test] {query.query_type}"
        )
        response = await self.client.send_message(session['id'], query.query)
        ai_content = response['assistant_message']['content']
        
        # NEW: Real evaluation instead of placeholder
        result = await evaluator.evaluate(query, ai_content)
        retention_results.append(result)
        
        await self.client.end_session(session['id'])
        # Don't wait for summary — not needed for recall tests
    
    return retention_results
```

**Validation:**
- [ ] Challenge queries return real scores (not all 0.0)
- [ ] Metrics JSON shows retention scores per query
- [ ] `avg_retention_score` computed correctly in compiled metrics
- [ ] Contradictions, if any, are recorded

### Task 2.5.4: Test Retention Evaluator in Isolation

**File:** `tests/simulation/evaluators/test_retention.py`

Create a quick smoke test that runs the evaluator against a known-good input:

```python
import pytest
from tests.simulation.evaluators.retention import RetentionEvaluator
from tests.simulation.models import ChallengeQuery

@pytest.mark.asyncio
async def test_retention_evaluator_scores_correctly():
    """Test with a mock AI response that contains some expected facts."""
    evaluator = RetentionEvaluator(config)  # Requires ANTHROPIC_API_KEY
    
    query = ChallengeQuery(
        query="What is Elena's relationship to her grandfather?",
        established_in_session=2,
        expected_facts=[
            'Grandfather taught Elena her craft',
            'Grandfather died about 2 years ago',
            'Elena inherited the workshop',
        ],
        query_type='direct_recall',
    )
    
    # Simulated AI response that mentions 2 of 3 facts
    ai_response = (
        "Elena learned everything she knows from her grandfather, who ran the workshop "
        "before her. After he passed away, she took over the business and continued "
        "building her mechanical inventions there."
    )
    
    result = await evaluator.evaluate(query, ai_response)
    
    assert result.score > 0.5  # Should find at least 2/3 facts
    assert len(result.facts_present) >= 2
    assert len(result.contradictions) == 0
```

**Validation:**
- [ ] Test passes with real Anthropic API call
- [ ] Score reflects actual fact coverage
- [ ] No crashes on API errors (graceful degradation)

**After completion:** `git add tests/simulation/evaluators/ tests/simulation/runner.py && git commit -m "Phase 2.5: Retention evaluator with LLM scoring" && git push`

---

## Task 2.6: Citation Evaluator (~2 hours)

### Task 2.6.1: Evaluate Existing Citation Evaluator for Reuse

**File to check:** `tests/framework/evaluators/citation_evaluator.py`

The existing test framework has a citation evaluator spec (from `brainstormy-testing-framework-spec.md`). Check if it's implemented:

1. Does `tests/framework/evaluators/citation_evaluator.py` exist?
2. If yes: Does it handle Brainstormy's `[short_id]` → UUID citation_map format?
3. Does it extract citations from content, look up in citation_map, and verify message existence?
4. Can it be imported into the simulation framework without pulling in the entire test framework?

**Decision:**
- If the existing evaluator is implemented and handles `citation_map` → import and wrap it
- If it exists but is incomplete or tightly coupled → port the citation extraction logic only
- If it doesn't exist → build fresh following the spec pattern

### Task 2.6.2: Implement CitationEvaluator

**File:** `tests/simulation/evaluators/citation.py`

```python
import re
from ..models import CitationResult, DeliverableRequest

class CitationEvaluator:
    """Validates citations in generated bibles and reports."""
    
    def __init__(self, client):
        """
        Args:
            client: BrainstormyClient for fetching message content when needed
        """
        self.client = client
    
    async def evaluate(self, deliverable_content: dict, 
                       deliverable_request: DeliverableRequest) -> CitationResult:
        """
        1. Extract the rendered content and citation_map from the deliverable
        2. Parse citation short-IDs from the content (e.g., [abc12345])
        3. Validate each citation against the citation_map
        4. Check for claims without citations (potential hallucinations)
        5. Return CitationResult with accuracy metrics
        """
    
    def _extract_citations(self, content: str) -> list[str]:
        """Extract citation short-IDs from content using regex.
        
        Brainstormy citations use format: [short_id] where short_id 
        is a short alphanumeric string mapping to a full message UUID.
        """
        # Pattern matches [A1], [B3], [abc12345], etc.
        return re.findall(r'\[([A-Za-z0-9]+)\]', content)
    
    def _validate_citation(self, short_id: str, citation_map: dict) -> dict:
        """Check if a citation short-ID exists in the citation_map.
        
        Returns: {'short_id': str, 'valid': bool, 'message_uuid': str | None}
        """
    
    async def _check_content_relevance(self, short_id: str, 
                                        surrounding_text: str,
                                        message_content: str) -> bool:
        """Optional: Use LLM to verify the cited message supports the claim.
        
        For Phase 2, start with existence-only validation.
        Content relevance checking can be added later if hallucination 
        rates are high.
        """
        # Phase 2: Skip content relevance, just check existence
        return True
```

**Citation evaluation flow:**
1. Bible/report API response includes `content` (rendered text) and `citation_map` (dict of `short_id` → `message_uuid`)
2. Extract all `[short_id]` patterns from `content`
3. For each extracted short_id: check if it exists as a key in `citation_map`
4. Valid = short_id found in citation_map. Invalid = short_id not found.
5. Compute metrics: `accuracy = valid / total`, `hallucination_rate = unsupported / total`

**What counts as "unsupported":** For Phase 2, we only count citations with invalid short-IDs as errors. Phase 3+ can add LLM-based content relevance checking (does the cited message actually support the claim?).

**Deviation from spec:** The spec's `CitationEvaluator.evaluate()` takes `(deliverable, story_id)` suggesting it fetches the deliverable. In practice, the runner already has the deliverable response from generation. We pass the full response dict to avoid redundant API calls.

**Validation:**
- [ ] Correctly extracts citation short-IDs from sample content
- [ ] Distinguishes valid citations (in citation_map) from invalid ones
- [ ] Handles content with zero citations (returns 0 total, NaN/0 accuracy)
- [ ] Handles content with no citation_map (returns error result)
- [ ] `CitationResult` fields all populated correctly

### Task 2.6.3: Integrate CitationEvaluator into Runner

**File:** `tests/simulation/runner.py`

Modify deliverable generation to capture responses and run citation evaluation.

**Modify `_generate_deliverable()`:**

```python
async def _generate_deliverable(self, story_id: str, 
                                 deliverable: DeliverableRequest) -> dict | None:
    """Generate a deliverable and run citation evaluation.
    
    Returns the deliverable response dict, or None on failure.
    """
    try:
        if deliverable.type == 'bible':
            with self.metrics.timed('generate_bible', deliverable.template_id):
                response = await self.client.generate_bible(
                    story_id, deliverable.template_id
                )
        elif deliverable.type == 'report':
            with self.metrics.timed('generate_report', deliverable.template_id):
                response = await self.client.generate_report(
                    story_id, deliverable.template_id,
                    parameters=deliverable.parameters
                )
        else:
            logger.warning(f"Unknown deliverable type: {deliverable.type}")
            return None
        
        # Store response for citation evaluation
        return response
    except Exception as e:
        logger.error(f"Deliverable generation failed: {e}")
        self.metrics.record_error('deliverable', str(e))
        return None
```

**Modify the main `run()` flow to collect deliverable responses and evaluate citations:**

```python
# After all sessions and deliverables are generated, evaluate citations
citation_evaluator = CitationEvaluator(self.client)
citation_results = []

for deliverable_req, response in self._deliverable_responses:
    if response is not None:
        result = await citation_evaluator.evaluate(response, deliverable_req)
        citation_results.append(result)

# Pass citation results to compile
metrics = self.metrics.compile(retention_results, citation_results=citation_results)
```

**Storage pattern:** During the run, store `(DeliverableRequest, response_dict)` tuples in a list (`self._deliverable_responses`). After all deliverables are generated, iterate and evaluate.

**Validation:**
- [ ] Citation evaluation runs after each deliverable
- [ ] Metrics JSON includes citation accuracy per deliverable
- [ ] `compile()` now receives real `citation_results` (not `None`)
- [ ] Compiled metrics include `avg_citation_accuracy` and `avg_hallucination_rate`

### Task 2.6.4: Test Citation Evaluator in Isolation

**File:** `tests/simulation/evaluators/test_citation.py`

```python
import pytest
from tests.simulation.evaluators.citation import CitationEvaluator

def test_extract_citations():
    evaluator = CitationEvaluator(client=None)  # Client not needed for extraction
    
    content = "Elena is an artificer [a1b2c3] who works in her grandfather's workshop [d4e5f6]."
    citations = evaluator._extract_citations(content)
    assert citations == ['a1b2c3', 'd4e5f6']

def test_validate_citation_valid():
    evaluator = CitationEvaluator(client=None)
    citation_map = {'a1b2c3': 'uuid-1234', 'd4e5f6': 'uuid-5678'}
    
    result = evaluator._validate_citation('a1b2c3', citation_map)
    assert result['valid'] is True
    assert result['message_uuid'] == 'uuid-1234'

def test_validate_citation_invalid():
    evaluator = CitationEvaluator(client=None)
    citation_map = {'a1b2c3': 'uuid-1234'}
    
    result = evaluator._validate_citation('xxxxxx', citation_map)
    assert result['valid'] is False

@pytest.mark.asyncio
async def test_evaluate_full():
    evaluator = CitationEvaluator(client=None)
    deliverable_response = {
        'content': 'Elena [a1] is an artificer [b2] with unknown origins [c3].',
        'citation_map': {'a1': 'uuid-1', 'b2': 'uuid-2'},  # c3 is NOT in map
    }
    deliverable_request = DeliverableRequest(type='bible', template_id='standard')
    
    result = await evaluator.evaluate(deliverable_response, deliverable_request)
    assert result.total_citations == 3
    assert result.valid_citations == 2
    assert result.invalid_citations == 1
    assert result.accuracy == pytest.approx(2/3, rel=0.01)
```

**Validation:**
- [ ] Citation extraction regex works on real Brainstormy content patterns
- [ ] Valid/invalid distinction works correctly
- [ ] Full evaluation produces correct CitationResult
- [ ] Edge cases handled: no citations, empty citation_map, no content field

**After completion:** `git add tests/simulation/evaluators/ tests/simulation/runner.py && git commit -m "Phase 2.6: Citation evaluator with integration" && git push`

---

## Final Validation (after all Phase 2 tasks)

### Full End-to-End Run with Evaluators

```bash
# Run full simulation with real evaluators
python -m tests.simulation --scenario fantasy_ember --tier 15 --env staging --verbose

# Verify metrics
cat tests/simulation/results/*/metrics.json | python -m json.tool
```

**Phase 2 is complete when:**
- [ ] 15 sessions run to completion (~60-70 messages sent)
- [ ] 5 deliverables generated (2 after session 10, 3 after session 15)
- [ ] 5 challenge queries evaluated with real LLM-based retention scores
- [ ] Citation accuracy computed for all deliverables
- [ ] Metrics JSON contains retention scores (not placeholder 0.0)
- [ ] Metrics JSON contains citation accuracy (not None)
- [ ] Average retention score ≥ 0.70 (reasonable for first run — target is 0.85+)
- [ ] Citation accuracy ≥ 0.80 for standard bible
- [ ] No unresolved errors in metrics
- [ ] WhatsApp notification sent with summary stats
- [ ] Total runtime ≤ 30 minutes

**Phase 2 milestone:** Complete simulation of "The Last Ember" with retention and citation metrics.

---

## Implementation Log

*(Append after each task completion)*

| Task | Date | Notes |
|------|------|-------|
| 2.1.1 | | |
| 2.1.2 | | |
| 2.1.3 | | |
| 2.1.4 | | |
| 2.1.5 | | |
| 2.1.6 | | |
| 2.1.7 | | |
| 2.1.8 | | |
| 2.1.9 | | |
| 2.1.10 | | |
| 2.2.1 | | |
| 2.3.1 | | |
| 2.3.2 | | |
| 2.4.1 | | |
| 2.4.2 | | |
| 2.4.3 | | |
| 2.4.4 | | |
| 2.5.1 | | |
| 2.5.2 | | |
| 2.5.3 | | |
| 2.5.4 | | |
| 2.6.1 | | |
| 2.6.2 | | |
| 2.6.3 | | |
| 2.6.4 | | |
