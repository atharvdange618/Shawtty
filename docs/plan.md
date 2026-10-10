# Reel Agent v2: Research-to-Reel Pipeline

**Status:** Draft, waiting for team approval
**Author:** Atharv (with Claude Code)
**Date:** 2026-10-10
**App:** `app/`

> **Paths:** app-relative paths below (`server/…`, `remotion/…`) resolve under `app/`; bare `plan.md`/`revise-plan.md`/`HARNESS.md` references live in `docs/`.

> How to review: read sections 1 to 3 for the what and why, then skim 4 to 9 for the how.
> Leave comments on the open decisions in section 11. Once everyone approves, we split
> the milestones in section 10 and start.

---

## 1. Goal

Build an affordable reel generator for **small English-language creators** who want good
explainer reels without paying for big AI subscriptions.

A creator types a topic. The agent researches it, writes a script with sources, lets the
creator edit and approve that script, then produces a finished 9:16 reel with topic-specific
illustrations, a voiceover, word-highlight subtitles, music and sound effects, all in sync.

### What success looks like

- Visuals match the topic (a fever reel shows fever things, not generic dashboards).
- Each scene starts when its line starts. Subtitles match the voice to within about 0.2s.
- Every factual claim in the script traces back to a source the creator can see.
- Cost per reel stays low and predictable (target: under ₹5).
- Jobs rarely fail, and when they do the creator sees a plain reason, not a stack trace.
- The requested length is respected (a "20-second reel" comes out at 20s, ±1s).

### Out of scope for v2

Multiple languages, user accounts and payments, model-written animation code, character
animation (walking, changing expressions), and Sarvam voices. Section 12 explains each.

---

## 2. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Who it's for | Small creators, sold as a product | Not a hackathon demo anymore, so reliability and cost per reel matter as much as looks. |
| Human checkpoint | Creator reviews and edits the **script** before render | Creators control what is said in their name, and a bad script never costs a render. |
| Language | English only | `openai/tts-1` works today. Indian languages need Sarvam direct (later). |
| Animation approach | **Component library** (approach A) | The model outputs structured scene specs. Trusted Remotion components render them. No model-written code runs. See 2.1. |
| Billing | **Bring your own key** (AICredits), key passed per job | No billing to build, no API costs for us, no abuse risk, and each creator has their own rate limit. The client takes the key per job, so managed credits can come later without a pipeline rewrite. |

### 2.1 Why a component library and not model-written code

We considered letting the model write Remotion code for every reel (what
`srvjha/reel-animated-explainer` does inside Claude Code). It has no ceiling on what it can
draw, but in a paid server pipeline:

- Model-written React fails to compile or overflows the layout often enough that we would
  need automated still-frame checks, vision review and retry loops. That multiplies cost and
  render time per reel.
- Running model-written code on our server means a crafted prompt could execute code there.
  Every render would need a locked-down sandbox.
- Quality varies from reel to reel, which is hard to sell.

The library caps what we can show, but every valid plan renders. The `unsupported` list
(already built, see section 3) tells us which component to build next, based on real prompts.
A later option is a data-only "custom scene" format (shapes, paths and keyframes as JSON,
never JS) for gaps the library doesn't cover.

---

## 3. Where we are today

Working and tested on `main` (uncommitted as of this plan):

- Prompt to reel in one job: `gpt-4.1-mini` writes a JSON plan, Remotion renders 1080x1920 @30fps.
- Five fixed vignettes: `orbit`, `bars`, `timeline`, `cards`, `pulse`.
- Narration with `openai/tts-1` (`alloy`). Reel length comes from measured audio length.
- Requested length is parsed from the prompt and met by adjusting TTS `speed` (0.85 to 1.15).
  Tested: two 20s requests came out at 20.17s and 20.00s.
- The plan lists `unsupported` instructions (characters, split screens, topic illustrations),
  shown in the UI.
- Procedural music and SFX (ported from the friend's plugin, MIT, credited in `server/sound.js`),
  with the music ducked under the voice by ffmpeg sidechain compression.

### Facts we verified against AICredits (they shape this plan)

| Finding | Effect on design |
|---|---|
| Sarvam Bulbul TTS is broken through the gateway (every voice is replaced with `meera`, then rejected with 400) | English with `tts-1` for now. |
| Whisper works but the gateway strips word timestamps (`verbose_json` comes back as plain text) | We can't transcribe our own audio for subtitle timings. We generate audio per line instead (section 6). |
| `perplexity/sonar` does real web search with citations (16 annotations, 3.3s, ~₹0.60 per call) | Research stage uses it. |
| Non-search models (e.g. Hermes) return URLs from memory, not from a search | Only search-backed models may be used for research. |
| `flux-1-schnell` makes a usable flat-vector illustration in 3.3s | Illustrations come from Flux. Per-image price not yet confirmed. |
| Seven parallel calls hit `429 Concurrency Limit Exceeded` | We need a per-job concurrency cap and 429 retries. |
| `openai/gpt-mini-latest` is an alias that has pointed at different models | Pin exact model IDs everywhere. |

---

## 4. Architecture

Each stage is one module with one input, one output, and one saved file in
`reel/<job-id>/`. If a stage fails, only that stage retries.

```
prompt
  │
  ▼
[1] Research ── perplexity/sonar ──────────────▶ research.json
  │
  ▼
[2] Script ──── gpt-4.1-mini ──────────────────▶ script.json
  │
  ▼
 ⏸  Creator reviews / edits / approves script    (job pauses: awaiting_review)
  │
  ▼
[3] Scene plan ─ gpt-4.1-mini ─────────────────▶ scenes.json
  │
  ▼
[4] Assets ──── tts-1 per line, flux per scene ▶ audio/line-N.mp3, images/scene-N.png, timing.json
  │
  ▼
[5] Render ──── Remotion, then ffmpeg mix ─────▶ reel.mp4
```

### 4.1 Job states

```
queued → researching → scripting → awaiting_review → planning
       → generating_assets → rendering → mixing → complete
any state → failed (with a plain-language reason and the stage that failed)
```

`awaiting_review` is saved to `job.json`, so a paused job survives a server restart.
Approving loads the job from disk, not only from the in-memory map.

### 4.2 API

| Method | Path | Does |
|---|---|---|
| POST | `/api/jobs` | Starts stages 1 and 2. Body: `{ prompt }`. Header: creator key. |
| GET | `/api/jobs/:id` | Status, research, script, scenes, output URLs. Never returns a key. |
| PUT | `/api/jobs/:id/script` | Saves the creator's edits while in `awaiting_review`. |
| POST | `/api/jobs/:id/approve` | Starts stages 3 to 5. Header: creator key. |
| POST | `/api/jobs/:id/retry` | Reruns the failed stage only. Header: creator key. |

---

## 5. Stages in detail

### 5.1 Research (`server/stages/research.js`)

- Model: `perplexity/sonar`. One call.
- Asks for 4 to 8 findings relevant to the prompt, each with a source URL from the
  search results.
- Keeps only findings whose URL appears in the response's citation annotations.
  Drops anything else.
- Output `research.json`:

```json
{
  "topic": "string",
  "findings": [
    { "id": "f1", "claim": "string", "sourceUrl": "https://...", "sourceTitle": "string" }
  ]
}
```

### 5.2 Script (`server/stages/script.js`)

- Model: `gpt-4.1-mini`. Input: prompt, findings, target seconds, word budget.
- One line per scene: a hook, 3 to 5 body lines, a closing line. Each line lists the
  finding IDs it relies on.
- Rule: every factual claim must map to at least one finding. Lines with no finding
  are marked `unsourced: true`, and the review screen highlights them.
- Carries over today's `targetSeconds` and `unsupported` logic.
- Output `script.json`:

```json
{
  "title": "string",
  "targetSeconds": 20,
  "lines": [
    { "id": "l1", "text": "string", "findingIds": ["f1"], "unsourced": false }
  ],
  "unsupported": ["string"]
}
```

### 5.3 Creator review (UI)

- Shows the findings (with links) next to the script lines.
- Each line is editable. Lines can be added, removed and reordered (max 7).
- Live estimate of spoken length (words / 2.5 per second) against the target.
- `unsourced` lines get a yellow flag: "No source backs this line."
- The `unsupported` list shows what the reel can't draw.
- Buttons: **Approve and render**, **Regenerate script** (reruns stage 2 only).

### 5.4 Scene plan (`server/stages/scenes.js`)

- Model: `gpt-4.1-mini`. Input: approved lines, the component catalog (names, props, when to
  use each), the house illustration style.
- Picks one layout per line, fills its props, writes an illustration prompt, and anchors
  each on-screen element to a word in the line (`atWord`) so it appears when that word is
  spoken.
- Every scene is checked against the layout's prop rules. Invalid scenes fall back to the
  `motion` layout (today's vignettes) instead of failing the job.
- Output `scenes.json`:

```json
{
  "scenes": [
    {
      "lineId": "l1",
      "layout": "split",
      "props": {
        "left":  { "label": "Hormone imbalance", "illustration": "img1", "atWord": 3 },
        "right": { "label": "What treatment targets", "illustration": "img2", "atWord": 8 }
      },
      "illustrations": {
        "img1": "a uterus icon with arrows showing hormone levels out of balance",
        "img2": "a doctor holding a clipboard"
      },
      "accent": "#FF6F61"
    }
  ],
  "style": { "palette": ["#FF6F61", "#FFA726"] }
}
```

### 5.5 Component library v1 (`remotion/layouts/`)

Each layout is a trusted React component with a fixed prop shape. Elements enter on
their `atWord` time.

| Layout | Shows | Good for |
|---|---|---|
| `illustration` | One large Flux image with slow zoom and gentle bob, headline above | Hooks, single ideas |
| `split` | Two panels side by side, each an image plus a label, entering in turn | A vs B, before and after, myth vs fact |
| `steps` | 2 to 4 numbered items, each popping in on its word | Tips, lists, processes |
| `stat` | Big number counting up plus a label and a small image | Facts with numbers |
| `myth-fact` | "MYTH" card gets stamped, flips to the "FACT" card | Myth-busting (a very common creator format) |
| `takeaway` | Bold closing line, CTA chip ("Save this") | Last scene |
| `motion` | Today's five vignettes | Fallback when an image fails or a scene is invalid |

Shared rules: one accent per scene from the palette, header and progress rail persist,
scenes overlap 14 frames with the existing slide-fade, and all animation is pure frame
math (no state or effects).

### 5.6 Illustrations (`server/stages/images.js`)

- Model: `flux-1-schnell`, portrait size (exact size to confirm in M3).
- A fixed house-style prefix is added to every prompt: flat vector, thick ink outlines,
  plain white background, the scene accent color, no text.
- Images are generated in parallel, capped by the per-job concurrency limit (section 8).
- On failure after retries, that scene uses the `motion` layout. The job still completes.
- Known limits, accepted for v2: expressions are sometimes wrong (a smiling "sick"
  person in our test), the same character looks different across scenes, no transparent
  background (we frame images on white cards to match the paper canvas).

---

## 6. Audio, timing and subtitles

### 6.1 Voice per line

- One `tts-1` call per script line, not one for the whole script. Same total characters,
  so the same cost.
- Each clip is measured with ffprobe. That gives exact start and end times per line,
  so **scene N starts exactly when line N starts**.
- Length fit: if the total is more than 5% off the target, all clips are regenerated
  once at one shared `speed` (clamped 0.85 to 1.15). Same method as today.
- A 0.25s gap between lines, a 0.6s tail at the end.
- `timing.json` stores each line's start, end and estimated word times.

### 6.2 Word times (for subtitles and `atWord`)

The gateway gives no word timestamps, so we estimate inside each clip: spread the
clip's duration across words by character count, with extra weight for punctuation
pauses. Since each clip is one short line, errors stay small (target: within 0.2s).
If that proves too loose, the upgrade path is local forced alignment (whisper.cpp,
as in the friend's plugin), which is out of scope for v2.

### 6.3 Subtitles (`remotion/Captions.jsx`)

- A caption band in the lower part of the frame, kept **above Instagram's bottom UI**
  (no text in roughly the bottom 20%).
- Max 2 lines, about 32 characters each. The current word is highlighted in the accent color.
- Never a single word alone on a line (rule borrowed from the friend's plugin).
- Layouts reserve this band, so captions never cover illustrations or labels.

### 6.4 Music and SFX

Keep the current system (`server/sound.js` plus ffmpeg ducking). Change the cue source: SFX fire
on scene starts and on `atWord` element entrances from `timing.json`. One known tweak:
ducking is shallow (about 4.6 dB) because `tts-1` output is quiet. Normalize the voice
with `loudnorm` before the mix.

---

## 7. Keys and security (BYOK)

- The creator pastes their AICredits key once. It is stored **only in their browser**
  (`localStorage`) and sent in a header with `POST /api/jobs`, `/approve` and `/retry`.
- The server keeps the key in memory for that request's work only. It is **never** written
  to `job.json`, logs, error traces or responses.
- The AICredits client takes the key per call: `postJson(path, body, { apiKey })`.
  `.env`'s `AICREDITS_API_KEY` remains only for local dev and smoke tests.
- Hard rule: model output and creator text are rendered with `textContent`, never
  `innerHTML`, because an XSS bug could read the key from `localStorage`.
- Plain error mapping: 401 → "This key doesn't work", 402 or balance errors → "Your AICredits
  balance is empty", 429 → "Rate limited, retrying".
- Tradeoff we accept: a second device means pasting the key again. Storing keys on our
  server would need accounts, a database and encryption, so it waits until we add accounts.

---

## 8. Reliability and cost

### 8.1 Concurrency and retries

- Max 3 AICredits calls in flight per job.
- Retry 429 and 5xx with backoff (1s, 3s, 9s), honoring `Retry-After`. Max 3 attempts.
- Do not retry 400, 401 or 402. Fail that stage with a plain message.
- Every LLM stage checks `finish_reason` (we already hit truncated JSON once).

### 8.2 Cost per reel (20s, 5 scenes)

| Stage | Calls | Est. cost |
|---|---|---|
| Research | 1 × sonar | ₹0.60 |
| Script | 1 × gpt-4.1-mini | ₹0.07 |
| Scene plan | 1 × gpt-4.1-mini | ₹0.07 |
| Voice | 5 × tts-1 (+5 if retimed) | ~₹0.30 to 0.60 |
| Images | ~5 to 8 × flux-1-schnell | **unconfirmed** (see 11) |
| Render and mix | local | ₹0 |
| **Total** | | **~₹1.10 + images** |

Research and script (about ₹0.70) run before approval, so abandoned prompts stay cheap.
The UI shows the estimated cost before **Approve and render**.

---

## 9. Testing

- Add **Vitest** (needs approval, see 11). Unit tests for the pure modules:
  duration parsing, word budget, word-time estimation, timeline and cue placement,
  scene validation and fallback, citation filtering, error mapping, key never written to disk.
- Mock `fetch` for every AICredits call. No paid calls in unit tests.
- Keep `npm run render:smoke` (no API cost) and add a still-frame check per layout:
  `npx remotion still ... --frame=N` for each layout with fixture props.
- One manual end-to-end run per milestone with a real key. We record the job ID and length.
- Pre-commit gate for everyone: lint, typecheck (see 11), tests.

---

## 10. Milestones

Each milestone ends with a working reel. Estimates are focused-work hours for one person.

| # | Milestone | Includes | Est. | Done when | Owner |
|---|---|---|---|---|---|
| M0 | Foundations | Vitest + lint setup, per-job key client, 429 retries + concurrency cap, job state machine with saved pause state, error mapping | 5 to 6 h | Tests run in CI or locally; a job can pause and resume after restart | |
| M1 | Research + script + review | Stages 1 and 2, review screen, key input in UI, `/script` and `/approve` | 8 to 10 h | A creator edits a sourced script and approves it; today's renderer produces the reel | |
| M2 | Voice per line + subtitles | Per-line TTS, `timing.json`, scene lengths from clips, word times, caption band, loudnorm | 8 to 10 h | Stills show each scene starting within 0.2s of its line; captions match the voice | |
| M3 | Scene plan + layouts + images | Stage 3, layouts v1 (6 + fallback), Flux stage with fallback, `atWord` entrances, SFX on entrances | 16 to 24 h | A fever prompt gives on-topic images in every scene; invalid scenes fall back, never fail | |
| M4 | Polish | Cost estimate in UI, retry button, docs (README, HARNESS), cleanup | 4 to 6 h | A new teammate can run it from the README alone | |

M1 and M2 can run in parallel (different files). M3 depends on M2's `timing.json`.

---

## 11. Open decisions (please weigh in)

1. **Revenue model.** With BYOK, creators pay AICredits, not us. How do we earn: a small
   subscription, one-time access, premium themes? If recurring, we need accounts and
   payments soon, and section 7's "keys only in the browser" should be revisited.
2. **Flux image price.** Someone check the charge for one `flux-1-schnell` image on the
   AICredits dashboard. If it's well above ₹0.50, we cap images per reel or try another model.
3. **New dev dependencies.** ✅ Resolved — `vitest` + `eslint` (flat config,
   `typescript-eslint`) are in. `zod` for validating model JSON is still open
   (today `normalizeScene` validates by hand).
4. **TypeScript.** ✅ Resolved — migrated. The app is now TypeScript (`server/`,
   `remotion/`, `scripts/`), run through `tsx` and typechecked with `tsc --noEmit`
   (`npm run typecheck`). Shared domain types live in `app/types.ts`; later stage
   modules (`server/stages/*`) start as TS.
5. **HyperFrames port.** `HARNESS.md` keeps a HyperFrames port of the old renderer in sync.
   The new layouts would break that parity. Do we drop the port, or keep it for the
   `motion` fallback only?
6. **Medical and health topics.** Research grounding helps, but should health reels also get
   a fixed on-screen line ("Not medical advice. Talk to a doctor.")? Our homeopathy/PCOS test
   showed how easily a script can overstate a claim.

---

## 12. Not doing in v2, and why

| Item | Why not now | When |
|---|---|---|
| Hindi and other Indian languages | Needs Sarvam direct (the gateway breaks it) and Devanagari subtitles | After v2, if creators ask |
| Accounts and payments | BYOK removes the need at launch | When the revenue model needs it |
| Model-written animation code | Reliability, cost and security (section 2.1) | Maybe a data-only custom scene format later |
| Character animation | Image models give still pictures; real acting needs an SVG character rig (days of work) | After layouts v1, if `unsupported` data shows demand |
| Same character across scenes | Needs reference-image editing or a rig | Later |
| Forced alignment (whisper.cpp) | Per-line timing is likely good enough | If 6.2's estimate misses the 0.2s target |
