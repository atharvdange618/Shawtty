# Revised Plan — Topic-Specific Reels with Procedural Motion (v2.1)

**Date:** 2026-10-10
**Replaces/supersedes:** `plan.md` §§5.4–5.6, §6 where noted. Goal, BYOK, and milestones M0–M4 from `plan.md` stand.
**Evidence:** `docs/MOTION-GRAPHICS-RESEARCH.md`, `docs/HARNESS.md`, code cited file:line below (app paths relative to `app/`).

## 1. Problem (what we fix)

1. **Same visuals every reel.** `normalizeScene` allows only `orbit|bars|timeline|cards|pulse` (`server/aicredits.js:161-163`); vignette JSX is hardcoded glyphs/strings/arrays (`remotion/GeneratedReel.jsx:263,315-316,480-484,545`). Only `accent` + text vary per prompt. System prompt reinforces it by telling the model topic illustration is impossible (`server/aicredits.js:240-241`).
2. **Overlap, no transition.** `OVERLAP=14` co-mounts neighbours (`remotion/timeline.js:5-19`) but only the incoming layer animates (`GeneratedReel.jsx:699-712`). Outgoing never exits → ~0.47s ghosting. SFX fires at `scene.from` when incoming is still transparent (`server/jobs.js:130-134`).

## 2. Proposal in one paragraph

Keep Remotion as the **only renderer and only motion engine**. Add two things it lacks: (a) **topic content** — one Flux still per scene, animated by Remotion (Ken Burns + entrances, §5); (b) **real transitions** — `@remotion/transitions` `TransitionSeries` replacing the one-sided overlap ramp (§6). Add per-line TTS → `timing.json` so scenes, `atWord` entrances, captions, and SFX share one clock (§7). Everything else (procedural music/SFX, 1080×1920@30fps, 5–90s clamp, BYOK) stays.

Why Flux if we animate procedurally? Remotion produces motion, not content. Hand-authoring a procedural illustration for every arbitrary topic does not scale; catalogue search (Lottie) has the same gap. Flux supplies the still; Remotion supplies camera, entrance, and handoff. On image failure the scene falls back to `motion` — job never fails for art.

## 3. Clean architecture

```
prompt (+creator key header)
  │
  ▼
[1] Research ── perplexity/sonar ──▶ research.json
  ▼
[2] Script ──── gpt-4.1-mini ──────▶ script.json
  ▼
 ⏸ awaiting_review (persist job.json; PUT /script, POST /approve)
  ▼
[3] Scene plan ─ gpt-4.1-mini ─────▶ scenes.json (layout+props+atWord+illustration prompts)
  ▼
[4] Assets ── tts-1 per line ──────▶ audio/line-N.mp3 + timing.json
        └──── flux-1-schnell ──────▶ images/scene-N.png (cap 3 concurrent, retry; fail → motion)
  ▼
[5] Render ── Remotion ────────────▶ reel.mp4 (silent) ──▶ ffmpeg mix (voice-ducked music + SFX) ─▶ reel.mp4
```

Job states: `queued → researching → scripting → awaiting_review → planning → generating_assets → rendering → mixing → complete`; any → `failed` with stage + plain reason. `awaiting_review` survives restart (load from disk, not map).

### 3.1 Stage contracts (files under `reel/<job-id>/`)

- `research.json`: `{topic, findings:[{id, claim, sourceUrl, sourceTitle}]}` — keep only URLs present in sonar citation annotations.
- `script.json`: `{title, targetSeconds, lines:[{id, text, findingIds, unsourced}], unsupported[]}`. Max 7 lines.
- `scenes.json`: `{scenes:[{lineId, layout, props, illustrations:{imgK: prompt}, accent}], style:{palette[]}}`. Layouts: `illustration|split|steps|stat|myth-fact|takeaway|motion`. Validator: unknown layout / bad props → `motion`, never fail.
- `timing.json`: `{lines:[{lineId, start, end, words:[{w, t}]}]}` from ffprobe-measured clips + 0.25s gaps + 0.6s tail. Single clock for scenes, entrances, captions, SFX.
- `inputProps`: `{jobId,title,narration,scenes,style,audioFiles,timing,durationInSeconds}` → `renderReel`.

### 3.2 Code map (new / changed)

- NEW `server/stages/research.js`, `script.js`, `scenes.js`, `images.js`, `voice.js` (one module per stage, §3.1 in/out).
- EDIT `server/aicredits.js`: per-call `postJson(path,body,{apiKey})` (BYOK), concurrency cap 3, retry 429/5xx 1s/3s/9s honoring `Retry-After`, never retry 400/401/402; `finish_reason` check.
- EDIT `server/jobs.js`: state machine + pause/resume + per-stage retry (`POST /:id/retry` reruns failed stage only).
- NEW `remotion/layouts/` (6 + `motion` fallback), `remotion/Captions.jsx`, EDIT `remotion/GeneratedReel.jsx` (TransitionSeries host), EDIT `remotion/timeline.js` (non-overlapping slots), EDIT `remotion/Root.jsx` (duration = Σ slots − transitions).
- EDIT `server/media.js` (`loudnorm` voice before mix), `server/sound.js` cues from `timing.json` (scene starts + `atWord` entrances).

### 3.3 API (BYOK)

Key in browser `localStorage` only, sent per mutating call; server holds in memory for that request, never writes to `job.json`/logs/responses; render with `textContent` only (XSS would leak key).

| Method | Path | Does |
|---|---|---|
| POST | `/api/jobs` | stages 1–2. `{prompt}`, key header |
| GET | `/api/jobs/:id` | status, research, script, scenes, URLs. No key |
| PUT | `/api/jobs/:id/script` | edits while `awaiting_review` |
| POST | `/api/jobs/:id/approve` | stages 3–5. Key header |
| POST | `/api/jobs/:id/retry` | failed stage only. Key header |

## 4. How Remotion animates a generated image (no video model)

`<Img>` is a layer like any div; frame math moves the camera:

- **Ken Burns:** `scale=interpolate(f,[0,dur],[1,1.12])`, `translateY=bob(f)` — existing `FloatWrap`/`bob` pattern (`GeneratedReel.jsx:48-70`).
- **Entrance:** `Pop` spring at `atWord` frame (`lineStart*30 + wordIdx*framesPerWord` from `timing.json`).
- **Framing:** white card + ink border + `CARD_SHADOW` hides Flux's no-transparency; text top, captions bottom-20%-clear.
- **Handoff:** image lives inside `TransitionSeries.Sequence`; transition animates the composed scene.

## 5. Illustration system (Flux, bounded)

- House-style prefix on every prompt: flat vector, thick ink outlines, plain white bg, scene accent, no text.
- Portrait size for 1080×1920 cards (exact params confirmed in M3 spike).
- Parallel gen, ≤3 in flight, 429/5xx retries. Failure → `motion` layout for that scene.
- Accepted limits (plan.md:5.6): wrong expressions, character drift across scenes, no transparency. No character rig / same-character guarantee in v2.

## 6. Transitions fix (do first, ~2–3h, no contract change)

Replace one-sided cover with first-party `TransitionSeries`:

- Install `@remotion/transitions@4.0.534 --save-exact` (pin to `package.json:15-22`).
- `timeline.js`: return non-overlapping slots (`from=cursor`, `durationInFrames=slot`); 14f overlap declared in JSX only.
- `GeneratedReel.jsx:696-720`: delete `cover`/`riseY` ramp; scenes as pure content in `<TransitionSeries.Sequence>`, `<TransitionSeries.Transition timing={linearTiming({durationInFrames:14})} presentation={fade()}/>` between (`slide from-bottom` optional to keep motion language). Keep sticker/headline ~25f entrances.
- `jobs.js:129-134`: cues = cumulative slot starts minus overlap (mid-handoff ≈ `slotStart−7f`; `pop` at +0.2s headline slam).
- `Root.jsx:56-66`: `durationInFrames = Σ(slots) − 14×(n−1)`; 14 legal (min slot 50).
- Fallback if deps frozen: outgoing `interpolate(f,[dur-14,dur],[1,0])` + freeze ambient on exit — inferior, keeps HF-untranslatable construct.

## 7. Audio / timing / subtitles

- One `tts-1` call per line (same chars ≈ same cost); ffprobe each clip → exact line starts → scene N starts when line N starts. Retiming: if total >5% off target, one regen of all clips at shared `speed` 0.85–1.15.
- Word times estimated per clip by char-weight + punctuation (target ±0.2s); upgrade to whisper.cpp only if miss measured.
- Captions: lower band above Instagram bottom-20%, ≤2 lines ~32 chars, current word in accent, no orphan words; layouts reserve the band.
- Music/SFX: keep `sound.js` + sidechain duck; add `loudnorm` on voice (duck currently shallow ~4.6dB); SFX on scene starts + `atWord` entrances.

## 8. Tradeoffs and why

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Content | Flux stills + Remotion motion | Pure procedural / Lottie-only / data-only JSON | Only Flux gives arbitrary-topic specificity at M3 cost; procedural catalogue does not scale; Lottie = complement for ambient accents; data-only JSON = highest churn, deferred until `unsupported` data justifies it |
| Transitions | `TransitionSeries` | Patch overlap with outgoing fade | First-party, deterministic, Studio-inspectable; patch re-implements half the package and keeps HF-untranslatable construct |
| Voice | Per-line TTS + `timing.json` | Whole-script TTS / gateway word timestamps | Gateway strips `verbose_json` timestamps; per-line gives exact scene sync at same char cost |
| Renderer | Remotion (SSIM baseline) | HyperFrames | HF eval 0.922 < 0.95 bar (`HARNESS.md:54-57`); keep HF for artifact only |
| Keys | BYOK per-job header | Server-stored keys / managed credits | Zero billing/abuse scope for v2; `.env` key for dev/smoke only; revisit with accounts |
| Animation safety | Component library, no model-written code | Model-written React (reel-animated-explainer style) | Compile/layout failures + sandbox needs + cost/retry blowup in paid pipeline (`plan.md:2.1`) |
| Failures | Fallback (`motion`), never fail on art; per-stage retry | Fail job on bad scene/image | Reliability + cost: bad art degrades, bad key/balance fails fast with plain message |

## 9. Cost / reliability (20s, 5 scenes)

Research 1×sonar ~₹0.60 + script/plan 2×gpt-4.1-mini ~₹0.14 + voice 5×tts-1 (+5 retime) ~₹0.30–0.60 + ~5–8 Flux **unconfirmed** → total ~₹1.10 + images; pre-approval spend ~₹0.70 shown in UI before Approve. Concurrency ≤3/job, backoff 1/3/9s, `Retry-After` honored. Error map: 401 key, 402/balance empty, 429 retrying.

## 10. Testing / done-when

- Vitest (proposed) for pure units: duration parse, word budget, word-time spread, timeline/cue math, scene validation/fallback, citation filter, error map, key-never-on-disk. `fetch` mocked; no paid calls.
- `render:smoke` (free) + per-layout stills (`remotion still … --frame=N`).
- One manual E2E per milestone with real key (record job ID + length ±1s, scene sync ±0.2s, fever prompt on-topic images, invalid scene → fallback).
- Gate: lint + typecheck decision + tests.

## 11. Milestones (unchanged shape, content updated)

M0 foundations (key client, retries/cap, state machine, errors) → M1 research+script+review → M2 voice-per-line + captions + **transitions fix** → M3 scene plan + layouts + Flux + `atWord` SFX → M4 polish (cost UI, retry, docs). M1+M2 parallel; M3 needs M2 `timing.json`.

## 12. Open decisions (need owners)

Revenue with BYOK; Flux per-image price (dashboard check); approve `vitest`/`eslint`/`zod`, TS-vs-JS; HyperFrames drop vs `motion`-only; health-topic disclaimer line.
