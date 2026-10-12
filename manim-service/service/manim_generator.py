import json
import logging
import re
from typing import Dict, Any, List, Optional
import neatlogs
from .llm_client import chat_completion

logger = logging.getLogger("manim_service.generator")

SCRIPT_SYSTEM_PROMPT = """You are an elite creative director, screenwriter, and educator creating viral, masterclass-level vertical video reels (9:16 format for TikTok, Instagram Reels, YouTube Shorts) across ANY domain:
- Computer Science, Distributed Systems & Software (e.g. Redis scaling, Kafka, HTTP/3, Raft, Garbage Collection)
- Science, Physics, Chemistry, Biology & Math (e.g. Black Holes, CRISPR, Quantum Entanglement, Photosynthesis)
- Cinematic Stories, History & Biographies (e.g. Fall of Rome, Apollo 13, Anime Lore, Industrial Revolution)
- Finance, Economics & Business (e.g. 2008 Financial Crisis, Visa Network, Game Theory)

CORE PRINCIPLE: DUAL SELF-CONTAINMENT & PROCESSABLE PACING
1. AUDIO-ONLY LISTENER: A user listening with eyes closed gets a deep, clear, intellectually captivating explanation with concrete stakes and zero fluff.
2. MUTE-ONLY VIEWER: A user watching on mute understands 100% through bold headlines, minimal entity cards, animated relationships, and clear summary takeaways.
3. SLOW, ARTICULATE PACING: Never rush or cram too many ideas! Explain one single minimal, core mechanism per act with crystal clarity so the viewer has time to absorb and understand the concepts.

4-ACT STORYBOARD STRUCTURE:
- Act 1 (The Setup & Failure / Phenomenon): The initial state, traffic surge, breakdown, or paradox (15-18 words).
- Act 2 (The Technical Bottleneck / Crisis): The mechanical bottleneck or limitation exposed via dramatic revelation (15-18 words).
- Act 3 (The Elegant Solution / Mechanism): The breakthrough mechanism explained step-by-step with clear causality (20-24 words).
- Act 4 (The Core Takeaway / Golden Rule): 3 crisp takeaways and the universal golden rule (14-17 words).

TIMING & WORD BUDGET (STRICT 65-80 WORDS TOTAL FOR A DELIBERATE, MASTERCLASS 45-55s REEL):
- Total words across all 4 acts combined: STRICTLY 65 to 80 words.
- Act 1: 15 to 18 words
- Act 2: 15 to 18 words
- Act 3: 20 to 24 words
- Act 4: 14 to 17 words

Return a JSON object:
{
  "title": "Topic Title",
  "domain": "tech|science|story|finance",
  "acts": [
    {
      "act_number": 1,
      "title": "Act 1 Title",
      "narration": "Exact calm voiceover spoken in Act 1 (15-18 words).",
      "visual_action": "Precise visual choreography: minimal setup (max 2 elements), causal arrow, metric bar."
    },
    {
      "act_number": 2,
      "title": "Act 2 Title",
      "narration": "Exact calm voiceover spoken in Act 2 (15-18 words).",
      "visual_action": "Clean cut to 2 full-screen ImpactScreen cards revealing the exact technical bottleneck."
    },
    {
      "act_number": 3,
      "title": "Act 3 Title",
      "narration": "Exact calm voiceover spoken in Act 3 (20-24 words).",
      "visual_action": "Clean step-by-step solution (max 2-3 elements), request arrow, fast response, camera zoom focus, latency gauge."
    },
    {
      "act_number": 4,
      "title": "Core Takeaways",
      "narration": "Exact calm voiceover spoken in Act 4 (14-17 words).",
      "visual_action": "SummaryCard with 3 takeaway rows and VerdictBanner."
    }
  ]
}
"""

MANIM_CODE_SYSTEM_PROMPT = """You are a master Manim Community Edition (ManimCE) motion graphics director creating viral, high-retention 1080x1920 vertical 9:16 reels with STEP-BY-STEP EXPLANATORY MOTION GRAPHICS, DYNAMIC CAMERA FOCUS, AND BOLD IMPACT CARDS.

CRITICAL DIRECTIVE: DO NOT USE RIGID HARDCODED TEMPLATES.
You are a creative animator. You can illustrate ANY topic (Redis scaling, quantum physics, rocket propulsion, biology, economics, history) by designing custom geometric shapes, cards, diagrams, networks, and motion flows from first principles!

GOLDEN RULES FOR HIGH-RETENTION 9:16 MOTION GRAPHICS:

================================================================================
RULE 1: MINIMAL FOCAL CONTENT (MAX 2-3 ACTIVE ELEMENTS PER SCREEN)
================================================================================
- ONE SCREEN MUST CONTAIN ONLY VERY MINIMAL, ESSENTIAL INFORMATION!
- NEVER cram 6, 8, or 9 boxes or tiny complex architecture diagrams into the narrow vertical frame!
- Maximum 2 to 3 major focal elements on screen at any moment!
- Generous negative space is mandatory. Each node must be large, legible, and spaced apart with comfortable padding.
- ALWAYS cleanly fade out earlier annotations, temporary pills, or old diagrams BEFORE introducing new elements:
  ```python
  self.play(FadeOut(old_elements), run_time=0.35)
  ```

================================================================================
RULE 2: SLOW, PROCESSABLE PACING WITH DELIBERATE PAUSES
================================================================================
- Viewers need time to process visual transformations!
- Draw elements STEP-BY-STEP:
  * First draw the source node.
  * Then animate the causal request arrow traveling to the destination node (`GlowArrow`).
  * Then animate the destination reacting (color change, metric fill, or returning pulse).
- ALWAYS include 1.0 to 1.5 second pauses (`self.wait(1.2)`) between transformations so the viewer can absorb the concept before moving on!

================================================================================
RULE 3: DYNAMIC CAMERA ZOOM IN AND ZOOM OUT (NOT HARDCODED)
================================================================================
- Use `class ReelScene(MovingCameraScene):`.
- When emphasizing a particular element, stressed node, or crucial interaction:
  Smoothly zoom in to focus on that specific element or region:
  ```python
  PunchIn(self, target_element, scale=0.82, run_time=0.6)
  ```
  `PunchIn` dynamically calculates the bounding box and centers the camera with safe margins for ANY mobject or group!
- When transitioning back to wide view or introducing the next part of the architecture:
  Glide smoothly back to full 9:16 overview:
  ```python
  PunchOut(self, run_time=0.5)
  ```

================================================================================
RULE 4: FIRST-PRINCIPLES VISUAL SHAPES & UNIVERSAL ASSETS (NO HARDCODING)
================================================================================
- You are not limited to pre-built widgets! You can freely create custom visual objects using ANY native Manim shapes:
  * Shapes: `RoundedRectangle`, `Circle`, `Square`, `Ellipse`, `Polygon`, `Arc`, `Annulus`, `Dot`
  * Connectors & Flows: `GlowArrow`, `CurvedArrow`, `Line`, `DashedLine`, traveling pulse `Dot`
  * Compound objects: Combine shapes and text into `VGroup`
- For convenient labeled entities with icons, you can use:
  ```python
  card = IconCard(label="PRIMARY DB", subtext="DISK STORAGE", icon_name="database", color="#3B82F6", width=2.0, height=2.2)
  ```
- Or load vector icon assets using `get_icon(name, color="#38BDF8", scale=1.0)`:
  Available icons: "user", "users", "server", "database", "redis", "cpu", "cloud", "bolt", "shield", "lock", "globe", "activity"
- Tailor your visual metaphors to the topic:
  * Science / Physics: Orbits, particles, waves, field lines using `Circle`, `Arc`, `Arrow`
  * Biology / Medicine: Cells, viruses, receptors, membranes using `Circle`, `Dot`, `VGroup`
  * Finance / Economics: Flow conduits, reserve blocks, branching pathways
  * Computing / Architecture: Distributed nodes, memory layers, glowing request streams
  * Math & Logic: Geometric figures, Venn circles, coordinate curves, state transitions

================================================================================
RULE 5: BUG-FREE METRICS & PROGRESS GAUGES (ZERO OVERLAPPING BARS)
================================================================================
- To display CPU load, queue depth, memory usage, or progress:
  Use `MetricBar(label="CPU USAGE", value="100%", pct=1.0, color="#EF4444", width=3.8, height=0.55)`
- To animate it increasing smoothly in-place without coordinate drift:
  Use `AnimateMetric(self, metric_bar, new_val="100%", new_pct=1.0, new_color="#EF4444", run_time=0.6)`
- NEVER write ad-hoc rectangles and `.align_to()` that can drift into (0, 0) and slice through nodes!

================================================================================
RULE 6: FULL-SCREEN IMPACT CARDS FOR CRISIS & BOTTLENECK CUTS
================================================================================
- When the narration exposes shocking bottlenecks, crashes, or physical limits (Act 2):
  Clear the canvas and CUT to 2 dedicated full-screen `ImpactScreen` cards:
  ```python
  self.play(FadeOut(*self.mobjects), run_time=0.3)
  self.clear()
  s1 = ImpactScreen(title="DISK I/O BOTTLENECK", subtitle="Mechanical seeks stall under 50k queries", icon_type="cross", color="#EF4444")
  self.play(FadeIn(s1), run_time=0.3)
  self.wait(1.5)
  self.play(FadeOut(s1), run_time=0.25)
  ```

================================================================================
RULE 7: STRICT 9:16 VERTICAL CANVAS & PLATFORM UI SAFE ZONES
================================================================================
- Canvas: Width 9.0 units, Height 16.0 units. Center is ORIGIN (0, 0, 0).
- Horizontal safe bounds: X in [-2.2, +2.2] (width <= 4.4 units).
- Vertical safe viewport: Y in [-2.8, +4.8].
- Top Header belongs at UP * 4.6: `VisualHeadline(badge_text, title, subtitle, color)`
- Bottom status/verdict banners belong at DOWN * 2.4 to DOWN * 2.6: `VerdictBanner(...)` or `TelemetryBar(...)`
- NEVER place any text or visual elements below DOWN * 3.0 (platform UI overlap zone)!

================================================================================
RULE 8: ACT LIFECYCLE & CLEANUP
================================================================================
- At the end of each act:
  ```python
  PunchOut(self, run_time=0.2)
  self.play(FadeOut(*self.mobjects), run_time=0.4)
  self.clear()
  self.wait(0.1)
  ```
- Calculate timing remainder: `rem = budget - (self.renderer.time - t_act) - 0.5`. If `rem > 0.1: self.wait(rem)`.

GLOBAL HELPERS AVAILABLE (DO NOT REDEFINE):
- `VisualHeadline(badge_text, title, subtitle=None, color="#00F2FE")` [at UP * 4.6]
- `IconCard(label, subtext=None, icon_name="server", color="#38BDF8", width=2.0, height=2.2)`
- `MetricBar(label, value, pct=1.0, color="#EF4444", width=3.8, height=0.55)`
- `AnimateMetric(scene, metric_bar, new_val="100%", new_pct=1.0, new_color="#EF4444")`
- `GlowArrow(start_point, end_point, label=None, color="#00F2FE", curved=False)`
- `ImpactScreen(title, subtitle=None, icon_type="cross"|"check", color="#EF4444")`
- `PunchIn(scene, target, scale=0.82, run_time=0.6)`
- `PunchOut(scene, run_time=0.5)`
- `TelemetryBar(metric_label, value_text, status_color)` [at DOWN * 2.6]
- `VerdictBanner(title, subtitle=None, color="#FFD700")` [at DOWN * 2.4]
- `SummaryCard(title, rows=None, width=4.4)` [3 crisp takeaway rows]
- `get_icon(name, color, scale)`: user, users, server, database, redis, cpu, cloud, bolt, shield, lock, globe, activity
"""

def determine_domain_guidance(prompt: str, domain: str) -> str:
    """
    Dynamically generates visual thinking guidelines and motion choreography
    for ANY topic and domain from first principles without hardcoded domain templates.
    """
    return f"""VISUAL THINKING & MOTION CHOREOGRAPHY FOR: "{prompt}" ({domain.upper()} DOMAIN)

CRITICAL INSTRUCTION: DO NOT USE PRE-BAKED HARDCODED CODE.
Think as a master visual animator and design bespoke motion graphics from first principles!

1. HOW TO DECONSTRUCT THIS TOPIC INTO VISUAL SHAPES:
- Identify the 2 or 3 core physical or abstract entities representing this topic:
  * You can build custom shapes directly using Manim primitives:
    - Nodes, blocks, storage, registers, containers, barriers: `RoundedRectangle`, `Rectangle`
    - Agents, atoms, cells, users, particles, celestial bodies: `Circle`, `Dot`, `Annulus`, `get_icon(...)`
    - Ready-made entity cards: `IconCard(label="...", subtext="...", icon_name="...", color="...")`
  * Dynamic connectors & motion:
    - Directional flow, energy, requests, signals: `GlowArrow(start, end, label="...", color="...")` or `CurvedArrow`
    - Flow pulses or moving packets: `Dot(color=...).animate.move_to(...)`
    - Saturated load, stress, queue, temperature, price: `MetricBar(label="...", value="...", pct=..., color="...")`

2. 4-ACT STORYBOARD CHOREOGRAPHY (MAX 2-3 ELEMENTS PER SCREEN):
- Act 1 (The Setup / Baseline Phenomenon - MAX 2 ELEMENTS):
  * Introduce 1-2 core entities cleanly on screen with generous padding.
  * Animate the normal baseline interaction or surge with `GlowArrow`.
  * Dynamic Camera Zoom: `PunchIn(self, focal_entity, scale=0.82)` to lock viewer focus!
  * Deliberate pause: `self.wait(1.2)` to let the viewer absorb the baseline setup.
  * Reset view: `PunchOut(self)`.

- Act 2 (The Crisis / Bottleneck / Turning Point):
  * Reveal the mechanical limit, failure, or dramatic contradiction!
  * Show visual stress: entity color shift (`entity.animate.set_stroke(RED)`), or metric saturation (`AnimateMetric`), or a clean cut to full-screen `ImpactScreen` cards:
    `s1 = ImpactScreen(title="CRITICAL BOTTLENECK / REVELATION", subtitle="Specific technical explanation of the failure", icon_type="cross", color="#EF4444")`
    `self.play(FadeIn(s1), run_time=0.3); self.wait(1.5); self.play(FadeOut(s1), run_time=0.25)`

- Act 3 (The Breakthrough Mechanism / Solution - MAX 2-3 ELEMENTS):
  * Introduce the breakthrough layer or mechanism step-by-step.
  * Step-by-step causality:
    1. First draw the incoming flow toward the new mechanism.
    2. Animate the reaction (instant response, stabilization, or transformed output).
    3. Dynamic Camera Zoom: `PunchIn(self, active_mechanism, scale=0.82)` right into the action!
    4. Deliberate pause: `self.wait(1.2)` so viewers clearly process the breakthrough.
    5. Reset view: `PunchOut(self)`.
    6. Performance / state gauge at `DOWN * 2.4`: `MetricBar(...)` or telemetry badge.

- Act 4 (The Synthesis / Golden Takeaways):
  * Cleanly clear the arena objects.
  * Present 3 crisp, memorable takeaways using `SummaryCard("KEY TAKEAWAYS", [("POINT 1", "...", "#00F2FE"), ("POINT 2", "...", "#10B981"), ("POINT 3", "...", "#FFD700")])`.
  * Display the universal golden rule banner at `DOWN * 2.4`:
    `verdict = VerdictBanner("THE GOLDEN RULE", "Clear single-sentence takeaway", color="#10B981").move_to(DOWN * 2.4)`
"""

@neatlogs.span(kind="CHAIN", name="generate_reel_script")
async def generate_reel_script(prompt: str) -> Dict[str, Any]:
    """
    Generate structured 4-act script and narration for a reel topic across any domain.
    """
    messages = [
        {"role": "system", "content": SCRIPT_SYSTEM_PROMPT},
        {"role": "user", "content": f"Create a high-retention reel script for: {prompt}"},
    ]

    response_text = await chat_completion(
        messages=messages,
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    cleaned_text = response_text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned_text)
    if match:
        cleaned_text = match.group(1).strip()

    try:
        data = json.loads(cleaned_text)
    except Exception as e:
        logger.error(f"Failed to parse script JSON: {e}, text: {response_text[:200]}")
        data = {
            "title": prompt,
            "domain": "general",
            "acts": [
                {"act_number": 1, "title": "The Introduction", "narration": f"Here is the story and core concept behind {prompt}.", "visual_action": "Initial scene setup and concept introduction."},
                {"act_number": 2, "title": "The Turning Point", "narration": "A critical event changes everything and challenges expectations.", "visual_action": "Twist or problem visualized with dramatic elements."},
                {"act_number": 3, "title": "The Resolution", "narration": "Through persistence and connection, the resolution unfolds across boundaries.", "visual_action": "Climax and breakthrough moment."},
                {"act_number": 4, "title": "Key Takeaways", "narration": "The lasting impact and enduring themes that make this unforgettable.", "visual_action": "Summary card with key takeaways."},
            ]
        }

    # Auto-detect domain if missing
    if not data.get("domain"):
        low = prompt.lower()
        if any(k in low for k in ["your name", "kimi no na wa", "anime", "movie", "story", "character", "history", "war", "battle", "lore", "novel", "film"]):
            data["domain"] = "story"
        elif any(k in low for k in ["physics", "math", "quantum", "gravity", "black hole", "relativity", "biology", "chemistry"]):
            data["domain"] = "science"
        else:
            data["domain"] = "tech"

    full_narration = " ".join([act.get("narration", "").strip() for act in data.get("acts", [])])
    data["full_narration"] = full_narration
    return data

@neatlogs.span(kind="CHAIN", name="generate_manim_code")
async def generate_manim_code_for_script(
    prompt: str,
    script_data: Dict[str, Any],
    act_timings: Dict[int, float],
    total_duration: float,
    act_audio_breakdowns: Optional[Dict[int, List[Dict[str, Any]]]] = None,
) -> str:
    """
    Generate Python Manim code aligned with exact per-act voiceover durations, spoken timestamps, and domain visual styles.
    """
    domain = script_data.get("domain", "tech")
    acts_info = []
    for act in script_data.get("acts", []):
        act_num = act.get("act_number", 1)
        dur = act_timings.get(act_num, 7.0)
        breakdown_lines = []
        if act_audio_breakdowns and act_num in act_audio_breakdowns:
            for seg in act_audio_breakdowns[act_num]:
                s = seg.get("start", 0.0)
                e = seg.get("end", dur)
                txt = seg.get("text", "")
                breakdown_lines.append(f"    * Spoken [{s:.1f}s -> {e:.1f}s]: \"{txt}\"")
        breakdown_str = ("\n" + "\n".join(breakdown_lines)) if breakdown_lines else ""
        acts_info.append(
            f"ACT {act_num}: \"{act.get('title')}\"\n"
            f"- Time Budget: Exactly {dur:.1f}s\n"
            f"- Voiceover: \"{act.get('narration')}\"{breakdown_str}\n"
            f"- Visual Choreography: {act.get('visual_action')}"
        )

    domain_guidance = determine_domain_guidance(prompt, domain)

    user_prompt = f"""Topic: {prompt}
Domain: {domain}
Total Reel Duration: {total_duration:.1f} seconds.

{domain_guidance}

ACT BREAKDOWN & ACOUSTIC TIMINGS (MUST MATCH EXACTLY FOR PERFECT AV SYNC):
{chr(10).join(acts_info)}

Generate complete, runnable Manim Python code with ReelScene(MovingCameraScene).

MANDATORY FIRST-PASS SUCCESS & CLEAN AESTHETIC CHECKLIST:
1. SCENE CLASS: `class ReelScene(MovingCameraScene):`.
2. ONE SCREEN = MINIMAL CONTENT: Maximum 2-3 focal elements on screen at any time! Generous breathing room, zero overlapping boxes.
3. SLOW, PROCESSABLE PACING: Draw causal arrows and transformations step-by-step as narration speaks them. Include 1.0-1.5s pauses (`self.wait(1.2)`) between transformations so viewers can easily process each step!
4. DYNAMIC CAMERA ZOOM IN & OUT: Use `PunchIn(self, target, scale=0.82)` to focus in on the element being explained. Use `PunchOut(self)` to glide back to wide overview. Works dynamically on any element or group.
5. REAL VECTOR ASSETS: Use `get_icon("name")` ("user", "users", "server", "database", "redis", "cpu", "cloud", "bolt", "shield", "lock", "globe", "activity") or `IconCard(...)` or custom Manim vector shapes.
6. RELIABLE METRICS: Use `MetricBar(label, value, pct, color)` or `TelemetryBar(metric, value, color)`. Never write manual `.align_to()` rectangles.
7. FULL-SCREEN IMPACT CARDS: In Act 2, cut to 2 full-screen `ImpactScreen` cards for shocking technical bottlenecks with 1.5s pauses.
8. COORDINATE SAFE ZONE: Horizontal X in [-2.2, +2.2] (width <= 4.4). Vertical Y in [-2.8, +4.8]. Top header at `UP * 4.6`. Bottom banner at `DOWN * 2.4`. NEVER place any text or visual elements below `DOWN * 3.0`!
9. End each act with:
   `PunchOut(self, run_time=0.2)`
   `self.play(FadeOut(*self.mobjects), run_time=0.4)`
   `self.clear()`
   `self.wait(0.1)`
10. Exact timing lock: For each act, calculate `rem = budget - (self.renderer.time - t_act) - 0.5` and wait if positive before clearance.
11. ONLY use `from manim import *`. Pre-defined helpers are available globally.
"""

    messages = [
        {"role": "system", "content": MANIM_CODE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    response_text = await chat_completion(
        messages=messages,
        temperature=0.2,
        response_format=None,
    )

    # Extract pure python code, stripping any conversational text, markdown, or JSON wrapper
    py_blocks = re.findall(r"```(?:python)?\s*([\s\S]*?)\s*```", response_text)
    for block in py_blocks:
        if "class ReelScene" in block or "construct(" in block or "from manim" in block:
            return block.strip()

    json_match = re.search(r"(\{[\s\S]*\})", response_text)
    if json_match:
        try:
            parsed = json.loads(json_match.group(1), strict=False)
            if isinstance(parsed, dict) and "code" in parsed:
                code_inner = str(parsed["code"]).strip()
                inner_py = re.search(r"```(?:python)?\s*([\s\S]*?)\s*```", code_inner)
                if inner_py:
                    code_inner = inner_py.group(1).strip()
                if "class ReelScene" in code_inner or "construct(" in code_inner or "from manim" in code_inner:
                    return code_inner
        except Exception:
            pass

    code_start_match = re.search(r"(?m)^(?:from\s+manim\s+import|import\s+manim|config\.pixel|class\s+ReelScene|#\s*---\s*GLOBAL|def\s+get_icon)\b", response_text)
    if code_start_match:
        pure_code = response_text[code_start_match.start():]
        pure_code = re.sub(r'["\s\}]+$', '', pure_code)
        return pure_code.strip()

    code = re.sub(r"^```(?:python|json)?\s*", "", response_text.strip())
    code = re.sub(r"\s*```$", "", code)
    return code.strip()

async def generate_manim_reel(prompt: str) -> Dict[str, Any]:
    """
    Legacy wrapper for backward compatibility.
    """
    script_data = await generate_reel_script(prompt)
    default_timings = {1: 7.5, 2: 7.0, 3: 13.0, 4: 5.5}
    total_dur = sum(default_timings.values())
    code = await generate_manim_code_for_script(prompt, script_data, default_timings, total_dur)
    return {
        "title": script_data.get("title", prompt),
        "narration": script_data.get("full_narration", ""),
        "code": code,
        "script_data": script_data,
    }
