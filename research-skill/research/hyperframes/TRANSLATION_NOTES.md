# TRANSLATION_NOTES — GeneratedReel (Remotion → HyperFrames)

Skill: remotion-to-hyperframes. Source: `remotion/GeneratedReel.jsx` + `remotion/Root.jsx`
(defaultProps baked: 10s, 30fps, 1080x1920, 3 scenes: orbit/cards/pulse vignettes,
flat-illustration light theme).

## Lint (skill Step 1, run manually — no Python on this machine)

- Blockers: none. No `useState`/`useReducer`/`useEffect`, `calculateMetadata` is sync,
  no third-party React UI libs.
- Warnings: none.
- Info: `r2hf/static-file` — `<Audio src={staticFile(audioFile)} />` maps to a relative
  asset path, but the app currently runs video-only (`audioFile: null`), so no
  `<audio>` element was emitted. Re-add per `references/media.md` when TTS returns.

## Timing substitutions (per references/timing.md)

- `spring({damping:12, stiffness:260})` (word pops) → `back.out(1.7)`, 0.5s, stagger 0.1s.
- `spring({damping:8, stiffness:300})` (sticker slam) → `back.out(2.0)`, 0.5s.
- `spring({damping:9, stiffness:260})` (ghost numeral) → `back.out(2.0)`, 0.6s.
- `spring({damping:11, stiffness:180})` (orbit punch) → `back.out(1.4)`, 0.7s.
- `spring({damping:11, stiffness:200})` stagger 5f (cards) → `back.out(1.7)`, 0.6s, stagger 0.17s.
- Whip-pan enter `interpolate(frame,[0,10],[1080,0],cubic-out)` → `x:1080→0`,
  0.33s `power3.out`. Whip exit (last 8f, cubic-in) → `x:0→-1080`, 0.27s `power3.in`
  + opacity out 0.2s. Matches `Easing.out(Easing.cubic)` → `power3.out` row.
- Pulse 30f `Easing.out(cubic)` cycle → `power1.out` 1.0s pulses with bounded
  `repeat: 2` (skill has no `<Loop>` primitive; scene is 3.33s so 3 pulses fit).
- Orbit rotation `frame*2.6deg` → linear `rotation +=290` over scene duration.
- Background zoom `interpolate(frame,[0,90],[1,1.06])` → linear scale tween.
- Progress rail linear → `width 0→100%`, 10s, `ease:"none"`.

## Validation (skill Step 4, measured 2026-10-10, illustration style)

- Remotion baseline: `npx remotion render remotion/index.jsx GeneratedReel hyperframes/baseline.mp4`
  (with `remotion.config.ts` png + bt709 per skill).
- HF render: `npx hyperframes render ./hyperframes --skill=remotion-to-hyperframes`
  → 300 frames, 10.0s, 1080x1920 (geometry match confirmed via ffprobe).
- SSIM (ffmpeg, 300 frames): **Y 0.894 / U 0.984 / V 0.975 / All 0.922**
  (previous dark style: 0.925 — same approximation class).
- Known approximation: the 14f overlap slide-fade between Remotion `<Sequence>`s
  has no HF host equivalent (hosts are sequential), so scene boundaries hard-cut
  under the incoming rise in HF. Ambient sine bobbing is rendered as bounded
  yoyo tweens. Below the T2 0.95 bar → Remotion stays the production renderer;
  HF port is a parallel validated artifact.

## Structural gaps

- Data-driven scenes: the Remotion comp renders per-job `plan.scenes` from the
  server. HF output bakes `Root.jsx` defaultProps. Per-job HF rendering should
  pass scenes via `hyperframes render --variables` (CLI supports it) — not wired yet.
- `calculateMetadata` 5–90s clamp resolved at translation time to the 10s default.
  Jobs with other durations need re-emit or variable-driven durations.
- Fonts: system stack only; no `@font-face` divergence cost.
- `renderMedia`/Remotion renderer retained as the production path (`server/render.js`);
  this HF port is validated as a parallel artifact until `--variables` wiring lands.
