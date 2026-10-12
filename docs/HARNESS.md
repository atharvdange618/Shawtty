# Harness — Shawtty (Manim Community 1080p Motion-Graphics Engine)

> Paths below are repo-root-relative. App code lives in `app/` (Express gateway), and Python rendering engine lives in `manim-service/`.

---

## 1. Pipeline Specification

1. **User Request**:
   - User submits a prompt via browser UI (`app/public/app.js` → `POST /api/jobs`).
   - Express backend creates a local tracking job (`app/server/jobs.ts`) and forwards the request to `manim-service` (`POST /api/jobs`).

2. **Phase 1: 4-Act Narrative & Storyboard Planning**:
   - `manim-service/service/manim_generator.py`: Calls LLM to structure topic into 4 distinct pedagogical acts:
     - **Act 1 (Hook & Core Problem)**: Bold setup, question or friction point.
     - **Act 2 (Architecture & Mechanisms)**: Technical breakdown, components, data flow.
     - **Act 3 (Key Insight / Aha! Moment)**: Deep dive into the clever principle making it work.
     - **Act 4 (Impact & Takeaways)**: Punchy summary card with 3 memorable points.

3. **Phase 2: High-Fidelity Voiceover Synthesis**:
   - `manim-service/service/tts.py`: Calls **Sarvam AI** (`bulbul:v4-flash`, speaker `shubh_enhi_ads`).
   - Generates narration audio for each act and measures exact runtime durations down to the millisecond (`act_timings = {1: s1, 2: s2, 3: s3, 4: s4}`).

4. **Phase 3: Synchronized Manim Code Generation**:
   - `manim-service/service/manim_generator.py`: Generates a single, cohesive Python script using `from manim import *`.
   - Incorporates vector typography, layout boxes, geometric transforms, and SVG icons.
   - Paces animations (`self.play(..., run_time=...)` and `self.wait(...)`) to match measured act audio durations exactly.

5. **Phase 4: 1080p Manim Rendering & Self-Healing Loop**:
   - `manim-service/service/manim_runner.py`: Spawns sandboxed `manim` CLI execution targeting 1080x1920 (9:16 vertical).
   - **Self-Healing Loop** (`service/repair_agent.py`): If compilation or runtime fails, parses stderr/traceback, diagnoses root cause, prompts LLM to apply a surgical fix, and re-renders (up to 3 attempts).

6. **Phase 5: Audio Muxing & Delivery**:
   - FFmpeg muxes narration, subtle audio SFX, and rendered video into `output/<job-id>.mp4`.
   - The Express server downloads the completed reel into `app/reel/<job-id>/reel.mp4` and delivers it to the browser.

---

## 2. Visual System

- **Canvas**: 1080x1920 (9:16 vertical format), dark background (`#0D1117` / `#0A0E17`).
- **Typography**: Clean high-contrast sans-serif type with colored highlight emphasis.
- **Icons**: Scalable vector icons in `service/assets/icons/` (cloud, database, server, redis, cpu, lock, user, shield).
- **Layout Patterns**:
  - `ActHeader`: Floating act badges and title cards.
  - `SummaryCard`: Polished 3-point takeaway cards with glowing borders.
  - Diagram flows with smooth vector arrows, pulses, and transformations.

---

## 3. Verification & Quality Commands

```bash
# Verify Express gateway
cd app
npm run check          # Check environment and Manim service health
npm run typecheck      # Verify TypeScript types

# Verify Manim microservice
cd ../manim-service
python -c "from manim import *; print(ManimBanner())"
curl http://localhost:8000/api/health
```
