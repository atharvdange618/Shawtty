# Harness — AI Reel Agent (video-only, fast motion-graphics)

> Paths below are repo-root-relative. App code lives in `app/` — run app `npm`
> scripts from `app/`. HyperFrames port artifacts live in `hyperframes/`.

## Pipeline

1. User submits a prompt in the browser panel (`app/public/app.js` → `POST /api/jobs`).
2. Server creates a job (`app/server/jobs.ts`) and calls AICredits chat with
   `openai/gpt-4.1-mini` (`app/server/aicredits.ts: generateReelPlan`).
3. The model returns strict JSON: title, narration (<900 chars), 4–6 scenes
   `{kicker, headline, body, visual, accent, durationWeight}`, style `{mood, palette}`.
   Allowed visuals: `orbit | bars | timeline | cards | pulse` (contract enforced in
   `normalizeScene`; the HF port and renderer both key off these five values).
   Plan also carries `targetSeconds` (parsed from "20-second"/"1 min" in the prompt by
   `extractTargetSeconds`, 5–90s) and `unsupported` (prompt instructions the renderer
   can't draw, shown in the UI). The planner gets a word budget at 2.5 words/s.
4. Narration: `generateSpeech` calls AICredits `/audio/speech` with `openai/tts-1`
   and writes `app/public/generated/<job-id>.mp3`. If `targetSeconds` is set and the audio is
   >5% off, it is regenerated once with `speed` (clamped 0.85–1.15); models miscount
   words, so timing is fixed on measured seconds. Reel length = ffprobe duration + 0.6s.
   Remotion loads the MP3 over HTTP from this server, not via `staticFile()`, because
   the cached bundle snapshots `public/` once per process. Sarvam Bulbul is unusable
   through the gateway (it swaps every voice for `meera`, which 400s).
   Voice/model allowlists live in `app/server/aicredits.ts` (`resolveSpeechVoice`).
5. Remotion renders `GeneratedReel` (1080x1920, 30fps) with the plan + duration as
   input props. Output: `app/reel/<job-id>/reel.mp4` (+ `plan.json`, `input.json`, `job.json`).
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
- Smooth handoffs: scenes are composed with `@remotion/transitions` `TransitionSeries`
  and a `fade()` cross-fade of 14 frames (`OVERLAP`) — hard cuts are banned. Both the
  outgoing and incoming scenes animate (the old one-sided cover ramp is gone), so no
  ghosting. `app/remotion/timeline.ts` returns non-overlapping slots sized so the composed
  total still equals the audio length (`Σslots − OVERLAP×(n−1) = durationInFrames`);
  the SFX cues in `app/server/jobs.ts` key off the same numbers. `@remotion/transitions`
  pins to the rest of the stack (4.0.534); it bundles React DOM 19, so this app pins
  `react`/`react-dom` 19.2.3. Text pops (sticker slam, staggered word rise) in the
  first ~25 frames while the vignette builds underneath.
- Text sits top (sticker kicker, ink headline, gray body); illustration fills the
  lower two-thirds. Header + progress rail persist.
- All scene animation is pure frame math (no state/effects) — required for determinism
  and for the HyperFrames port to stay valid. New scenes must follow this beat. The
  handoff itself is now a package component (`TransitionSeries`), which the HF port
  cannot reproduce; that parity gap is `docs/plan.md` open decision 5.

## HyperFrames port (skill: remotion-to-hyperframes)

- Source: `app/remotion/GeneratedReel.tsx` (+ `Root.tsx` defaultProps baked).
- Skill lint (Step 1): no blockers/warnings; info `staticFile` only (inert, audio null).
- Output: `hyperframes/index.html` + `hyperframes/compositions/scene-{1,2,3}.html`
  (paused GSAP timelines, `window.__timelines`, spring→`back.out` per `timing.md`).
- **Stale vs current renderer:** the port was generated before the `TransitionSeries`
  fix and still encodes the old 14f one-sided slide-fade handoff (`compositions/*.html`,
  `OVERLAP` comment). Re-port or retire per open decision 5.
- Gaps: `hyperframes/TRANSLATION_NOTES.md`.
- Eval (Step 4): Remotion baseline vs `npx hyperframes render` → SSIM All **0.922**
  (Y 0.894). Below the T2 0.95 bar → Remotion stays the production renderer.
- `app/remotion.config.ts` (png + bt709) exists for eval parity — do not delete.

## Verifying (use this)

```bash
cd app
npm run check          # env + ffmpeg/ffprobe sanity
npm run dev            # server on :3000
# submit a prompt in the UI, then:
node -e "fetch('http://localhost:3000/api/jobs/<id>').then(r=>r.json()).then(j=>console.log(j.job.status, j.job.step, j.job.videoUrl))"
```

Render smoke (no LLM cost), from `app/`: `npm run render:smoke`.
Style check (single frame), from `app/`:
`npx remotion still remotion/index.tsx GeneratedReel <out>.png --frame=30`.
HF re-validate after visual edits (from repo root): re-render baseline + `npx hyperframes render ./hyperframes`,
then `ffmpeg -i baseline.mp4 -i hf.mp4 -lavfi ssim -f null -`.
