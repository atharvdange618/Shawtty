# Harness — AI Reel Agent (video-only, fast motion-graphics)

## Pipeline

1. User submits a prompt in the browser panel (`public/app.js` → `POST /api/jobs`).
2. Server creates a job (`server/jobs.js`) and calls AICredits chat with
   `openai/gpt-4.1-mini` (`server/aicredits.js: generateReelPlan`).
3. The model returns strict JSON: title, narration (<900 chars), 4–6 scenes
   `{kicker, headline, body, visual, accent, durationWeight}`, style `{mood, palette}`.
   Allowed visuals: `orbit | bars | timeline | cards | pulse` (contract enforced in
   `normalizeScene`; the HF port and renderer both key off these five values).
   Plan also carries `targetSeconds` (parsed from "20-second"/"1 min" in the prompt by
   `extractTargetSeconds`, 5–90s) and `unsupported` (prompt instructions the renderer
   can't draw, shown in the UI). The planner gets a word budget at 2.5 words/s.
4. Narration: `generateSpeech` calls AICredits `/audio/speech` with `openai/tts-1`
   and writes `public/generated/<job-id>.mp3`. If `targetSeconds` is set and the audio is
   >5% off, it is regenerated once with `speed` (clamped 0.85–1.15); models miscount
   words, so timing is fixed on measured seconds. Reel length = ffprobe duration + 0.6s.
   Remotion loads the MP3 over HTTP from this server, not via `staticFile()`, because
   the cached bundle snapshots `public/` once per process. Sarvam Bulbul is unusable
   through the gateway (it swaps every voice for `meera`, which 400s).
   Voice/model allowlists live in `server/aicredits.js` (`resolveSpeechVoice`).
5. Remotion renders `GeneratedReel` (1080x1920, 30fps) with the plan + duration as
   input props. Output: `reel/<job-id>/reel.mp4` (+ `plan.json`, `input.json`, `job.json`).
6. Failures persist `error` + `trace` (stack) in `job.json` and log server-side.

## Visual system (flat-illustration explainer, no-slideshow rules)

Reference look: light dotted-paper canvas (`#F1F2F4`), ink outlines (`#161616`),
white cards with hard offset shadows, one vivid accent per scene. Every scene is a
living vignette — never a static card:

- Five vignettes keyed by `visual`: `orbit`→network hub (phone + orbiting app chips),
  `bars`→dashboard (growing skyline + analytics card), `timeline`→journey (drawing
  path, milestone nodes, traveler), `cards`→chat cluster (bubbles + live typing),
  `pulse`→broadcast (play hub, radiating rings, badges) — each with people/phone
  figures, floating UI cards and confetti drift.
- Ambient motion never stops: sine bob/drift on every floating element, orbiting
  chips, traveling dots, pulsing rings, live typing indicator.
- Smooth handoffs: scenes overlap 14 frames (`OVERLAP`) with slide-up + fade cover —
  hard cuts are banned. Text pops (sticker slam, staggered word rise) in the first
  ~25 frames while the vignette builds underneath.
- Text sits top (sticker kicker, ink headline, gray body); illustration fills the
  lower two-thirds. Header + progress rail persist.
- All animation is pure frame math (no state/effects) — required for determinism
  and for the HyperFrames port to stay valid. New scenes must follow this beat.

## HyperFrames port (skill: remotion-to-hyperframes)

- Source: `remotion/GeneratedReel.jsx` (+ `Root.jsx` defaultProps baked).
- Skill lint (Step 1): no blockers/warnings; info `staticFile` only (inert, audio null).
- Output: `hyperframes/index.html` + `compositions/scene-{1,2,3}.html`
  (paused GSAP timelines, `window.__timelines`, spring→`back.out` per `timing.md`).
- Gaps: `hyperframes/TRANSLATION_NOTES.md`.
- Eval (Step 4): Remotion baseline vs `npx hyperframes render` → SSIM All **0.922**
  (Y 0.894). Below the T2 0.95 bar → Remotion stays the production renderer.
- `remotion.config.ts` (png + bt709) exists for eval parity — do not delete.

## Verifying (use this)

```bash
npm run check          # env + ffmpeg/ffprobe sanity
npm run dev            # server on :3000
# submit a prompt in the UI, then:
node -e "fetch('http://localhost:3000/api/jobs/<id>').then(r=>r.json()).then(j=>console.log(j.job.status, j.job.step, j.job.videoUrl))"
```

Render smoke (no LLM cost): `npm run render:smoke`.
Style check (single frame): `npx remotion still remotion/index.jsx GeneratedReel <out>.png --frame=30`.
HF re-validate after visual edits: re-render baseline + `npx hyperframes render ./hyperframes`,
then `ffmpeg -i baseline.mp4 -i hf.mp4 -lavfi ssim -f null -`.
