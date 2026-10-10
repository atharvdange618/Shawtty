# Motion-Graphics Research — Why Reels Look Identical + Transition Fix Path

**Date:** 2026-10-10 · **Stack:** Express + Remotion 4.0.534, 1080×1920 @30fps · **Status:** local-verified where file:line cited; docs-claimed where remotion.dev/HF cited; §8 marks the rest unverified.

## 0. Summary

1. Visuals are identical across prompts **by construction**: the plan contract allows only 5 hardcoded vignettes and the system prompt forbids topic-specific illustration.
2. The "overlap, no transition" look is the 14-frame dual-mounted slide-fade: the outgoing scene never fades out, the incoming scene ramps opacity 0→1 while sliding up, so both are visible for ~0.47s.
3. Production path = **plan.md's already-decided component library (A) + Flux images + `@remotion/transitions`**, staged under M2/M3. Lottie (B) is a complement, not a replacement. Data-only custom scenes (C) are deferred.
4. Only vendored skill is `remotion-to-hyperframes` (one-way port, not a renderer); Remotion's official agent skills (`remotion-dev/skills`) are worth installing for M2/M3.

## 1. Root cause (1): identical visual regardless of prompt

- `normalizeScene` accepts only `orbit|bars|timeline|cards|pulse`; anything else falls back to `[orbit,bars,cards][index%3]` — prompt content never influences the pick (`server/aicredits.js:161-163`).
- Fallback scenes are static copy (`orbit/cards/pulse`, `server/aicredits.js:175-200`).
- The system prompt **tells the model** it "cannot draw … topic-specific illustrations (e.g. a thermometer, a uterus, a car), photos" (`server/aicredits.js:240-241`), so the LLM never even tries.
- All five vignettes are fixed JSX: orbit glyphs hardcoded `['f','in','M','▶','✉']` (`remotion/GeneratedReel.jsx:263`); chat bubbles fixed strings (`:480-484`); bars/towers fixed arrays (`:315-316`); badges fixed (`:545`); confetti/person/phone shapes take only `accent` as a variable. The only per-prompt visual degrees of freedom are `accent` hex + text.
- Pipeline consequence: `jobs.js:runJob` (`server/jobs.js:59-95`) flows plan→TTS→render with no image/asset stage, so nothing prompt-specific can enter the frame. Rendered via `GeneratedReel` 1080×1920 (`remotion/Root.jsx:48-56`, clamp 5–90s at `:57`).

## 2. Root cause (2): next scene overlaps old one, no proper transition

- `OVERLAP=14`, `from = cursor-14`, `durationInFrames = slot+14` (`remotion/timeline.js:5-19`): neighbours are co-mounted 14 frames (~0.47s @30fps).
- `<Sequence>` defaults to `absolute-fill`, so co-mounted scenes stack by DOM order — later (incoming) on top ([remotion.dev/docs/sequence](https://www.remotion.dev/docs/sequence)).
- The handoff animates **only the incoming** layer: `cover` opacity 0→1 + `riseY` 110→0 over `[0, OVERLAP]` (`remotion/GeneratedReel.jsx:699-712`). The outgoing scene gets **no exit animation** — it stays fully opaque underneath until unmount. Mid-handoff the viewer sees the old scene around/below a semi-transparent rising new scene: reads as ghosting/overlap, not a designed transition.
- Aggravators: SFX `swish` fires at `scene.from` (`server/jobs.js:130-134`) exactly when the incoming layer is still transparent; HF port confirms the construct has no clean equivalent ("scene boundaries hard-cut", `hyperframes/TRANSLATION_NOTES.md:40-44`).
- Verdict: not a timing bug — the overlap math works as coded. It is a **missing exit choreography**: one-sided cover ≠ transition.

## 3. Options compared

| | A: plan.md library + Flux + transitions (recommended) | B: Lottie/dotLottie illustration system | C: data-only custom-scene JSON |
|---|---|---|---|
| Topic-specificity | High — per-scene Flux prompt e.g. "uterus icon…" (`plan.md:5.4/5.6`) | Medium — curated premade animations via LottieFiles ([docs](https://www.remotion.dev/docs/lottie)); matching arbitrary topics depends on catalogue hits | Highest ceiling — shapes/paths/keyframes as JSON; quality depends on planner + validator |
| Transition quality | Native `TransitionSeries` (`fade`/`slide`/`wipe`), progress-driven ([docs](https://www.remotion.dev/docs/transitions/transitionseries)) | Same transitions usable; Lottie layers are just scene content (`<Lottie animationData>`, [docs](https://www.remotion.dev/docs/lottie/lottie)) | Same transitions usable; content is data-rendered trusted components |
| Determinism / cost | Deterministic render; cost = LLM plan + ~5–8 Flux imgs + TTS (`plan.md:8.2`, Flux price **unconfirmed**) | Deterministic; near-zero marginal cost after curation (asset fetch once) | Deterministic if schema-validated; extra LLM tokens + validator work per reel |
| Implementation effort | M3-sized (16–24h): 6 layouts + Flux stage + `atWord` (`plan.md:10`) | Medium: `@remotion/lottie` wiring + per-topic asset map + fallback; catalogue gaps remain | High: schema design, validator, layout engine, still-frame checks |
| Pipeline fit | Exact fit: `scenes.json`→`timing.json`→`atWord` entrances, SFX on entrances, captions safe-area, 5–90s clamp (`plan.md:5.4/5.5/6`) | Fits as **asset source inside A's layouts** (e.g. `motion` fallback, badges, typing indicators) | Requires replacing `normalizeScene` contract + `timelineFor`; biggest churn |

- A is also the team's already-made decision ("Animation approach: component library", `plan.md:2/2.1`) with a documented fallback rule (invalid scene → `motion` layout, `plan.md:5.4`).
- Flux feasibility (docs-claimed): `FLUX.1-schnell` is a 12B rectified-flow transformer, 1–4 steps, Apache-2.0 ([model card](https://huggingface.co/black-forest-labs/FLUX.1-schnell)); same card warns it "may fail to generate output that matches the prompts" and is not factual — hence plan.md's accepted limits (wrong expressions, character drift, no transparency; `plan.md:5.6`) and the `motion`-fallback rule.

## 4. Recommendation (staged, tied to M2/M3)

1. **Now (M2-adjacent, ~2–3h): transitions fix** — install `@remotion/transitions@4.0.534 --save-exact`, replace OVERLAP slide-fade with `TransitionSeries` (§5). No pipeline/contract change; SFX cue math updated in the same diff.
2. **M2 as planned**: per-line TTS → `timing.json`, scene starts = line starts, caption band above bottom-20% UI, `loudnorm` before mix (`plan.md:6`).
3. **M3 as planned**: `scenes.json` (layout+props+`atWord`+illustration prompts) → Flux stage (house-style prefix, concurrency cap ≤3, retries; `plan.md:5.6/8.1`) → layouts v1 in `remotion/layouts/` with `motion` fallback.
4. **Lottie as complement inside M3**: use `@remotion/lottie` for abstract/ambient accents (rings, badges, typing) where Flux is weak; do not build the topic layer on catalogue search.
5. **Defer C** until `unsupported` data (`plan.md:2.1`) shows layout gaps worth a schema engine; defer character rig / same-character consistency (plan.md §12).

## 5. Transitions fix (concrete)

- **Target:** `TransitionSeries` with `fade()` (or `slide(direction:'from-bottom')` to preserve current motion language) + `linearTiming({durationInFrames: 14})` — keeps the current 0.47s handoff feel. Presentations/timings: [TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries), [fade()](https://www.remotion.dev/docs/transitions/presentations/fade), [slide()](https://www.remotion.dev/docs/transitions/presentations/slide), [timings](https://www.remotion.dev/docs/transitions/timings). (`@remotion/transitions` ships for the 4.0 line; pin `4.0.534` to match `package.json:15-22`.)
- **Timing math (docs-claimed):** total = Σ(sequence durations) − Σ(transition durations); transition must be ≤ either neighbour ([Duration of a TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)). Current min slot is 50 frames (`timeline.js:16`) so 14 is legal.
- **Code pointers:**
  - `remotion/timeline.js` — change `timelineFor` to return **non-overlapping slots** (`from = cursor`, `durationInFrames = slot`); the transition's 14f overlap is declared in JSX, not in `from` math. Keep the weight logic and last-scene remainder.
  - `remotion/GeneratedReel.jsx:696-720` — delete the `cover`/`riseY` one-sided ramp; render scenes as pure content inside `<TransitionSeries.Sequence>`; declare `<TransitionSeries.Transition timing={linearTiming({durationInFrames:14})} presentation={fade()}/>` between sequences. `Scene` keeps sticker/headline/body entrances (first ~25f) untouched.
  - `server/jobs.js:129-134` — recompute cue times as cumulative slot starts **minus** transition overlap for scenes after the first (transition *centre* ≈ `slotStart − 7f` if cues should land mid-handoff; keep `pop` at +0.2s on headline slam).
  - `remotion/Root.jsx:56-66` — `calculateMetadata` clamp stays; verify `durationInFrames` passed to render equals Σ(slots) − 14×(n−1) ([calculateMetadata](https://www.remotion.dev/docs/calculate-metadata)).
- **Why not keep overlap + patch:** adding an outgoing fade (e.g. `<Freeze>` + opacity ramp) re-implements half of `TransitionSeries` with manual z/opacity bookkeeping and keeps the HF-untranslatable construct; the package version is first-party, deterministic frame math, and Studio-inspectable. Keep path justified only if dependency freeze forbids new packages — then add outgoing `interpolate(frame,[duration-14,duration],[1,0])` + freeze ambient motion during exit.

## 6. Skills inventory

| Skill | ID / source | Install path | Applicability |
|---|---|---|---|
| remotion-to-hyperframes (vendored ×3 runtimes) | `heygen-com/hyperframes` (`skills-lock.json:4-9`); dirs `agent/skills/`, `.agents/skills/`, `.claude/skills/` | already vendored | **Not applicable** to production path: one-way Remotion→HF port only, declines fresh builds (`SKILL.md:3-8,23-45`); eval SSIM 0.922 < 0.95 bar, Remotion stays renderer (`HARNESS.md:54-57`). Keep for parallel artifact only (plan.md open decision 5). |
| Remotion official skills | `remotion-dev/skills` ([Agent Skills](https://www.remotion.dev/docs/ai/skills), [repo](https://github.com/remotion-dev/remotion/tree/main/packages/skills)) | `npx skills add remotion-dev/skills` | **Install for M2/M3:** `/remotion-markup` (layouts, timing, media), `/remotion-captions` (subtitle band), `/remotion-render` + `/remotion-studio` (stills/verify), `/remotion-best-practices` (umbrella), `/remotion-docs` (API lookup), `/remotion-saas` (BYOK app arch). |
| Lottie / motion-graphics / video / Flux skills | — | — | **None found.** Checked `agent/skills/`, `.agents/skills/`, `.claude/skills/` (each contains only `remotion-to-hyperframes`), `skills-lock.json` (single entry), and Remotion's skill list above (no Lottie/Flux skill). If a registry skill is wanted, `lottie.md` rules in community remotion-video-creation repos exist but are **not vetted primary sources** — treat as unverified. |

## 7. Sources

- Local (verified): `server/aicredits.js:161-163,175-200,240-241`; `server/jobs.js:59-95,129-134`; `remotion/timeline.js:5-19`; `remotion/GeneratedReel.jsx:263,315-316,480-484,545,696-720,798-812`; `remotion/Root.jsx:48-66`; `package.json:15-22`; `HARNESS.md`; `README.md`; `hyperframes/TRANSLATION_NOTES.md:40-44`; `plan.md:2,2.1,5.4,5.5,5.6,6,8.2,10,11,12`; root `README.md`; `skills-lock.json`; `agent/skills/remotion-to-hyperframes/SKILL.md`.
- Docs (claimed, owner): `<Sequence>`/`<Series>`/`TransitionSeries`/`fade`/`slide`/timings/`calculateMetadata`/`<Lottie>` on remotion.dev; [Agent Skills](https://www.remotion.dev/docs/ai/skills); [FLUX.1-schnell model card](https://huggingface.co/black-forest-labs/FLUX.1-schnell).
- Unverified (see §8).

## 8. Open questions (need measurement, not blogs)

1. Flux per-image price on AICredits (plan.md decision 11.2) — check dashboard before M3 costing.
2. Flux portrait exact size/params for 1080×1920 cards — confirm in M3 spike; "no text" is prompt heuristic, not a model guarantee.
3. Gateway 429/concurrency behaviour for parallel Flux+TTS (cap 3, backoff 1/3/9s per plan.md:8.1) — re-verify under M3 load.
4. Per-line word-time estimation error vs 0.2s target (plan.md:6.2); fallback whisper.cpp stays out of scope.
5. `clockWipe`/`flip` availability in `@remotion/transitions@4.0.534` — check package exports at install; only `fade`/`slide`/`wipe` verified against primary docs here.
6. HyperFrames port future (plan.md decision 11.5): drop vs `motion`-fallback-only after layouts land.
