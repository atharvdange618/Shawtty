# Shawtty

Type a topic, get a finished 9:16 narrated motion-graphics reel. Built for small English-language creators who don't want to touch a timeline.

The code that runs today lives in `app/` (Express + Remotion). `docs/plan.md` is where v2 goes next (research-to-reel pipeline).

## Repo layout

```text
app/                         # Runnable MVP app (Express + Remotion)
  server/                    # Express API + job pipeline (jobs, AICredits, render, media, sound)
  remotion/                  # Trusted renderer (GeneratedReel, 1080x1920 @30fps)
  public/                    # Browser prompt panel
  scripts/                   # check-env, render-smoke
docs/                        # plan, revise-plan, HARNESS, research notes
hyperframes/                 # HyperFrames port output + eval artifacts
skills/                      # Vendored agent skills (git-workflow, remotion-to-hyperframes)
skills-lock.json             # Skill install lock (source + hash)
netlogs-trail/               # Neatlogs integration task brief
```

## Prerequisites

- Node.js 18+ (`node --version`)
- FFmpeg + FFprobe on PATH (`ffmpeg -version`, `ffprobe -version`)
- An AICredits key with access to `openai/gpt-4.1-mini` (plan) and
  `openai/tts-1` (speech)

## Setup guide

1. Clone and enter the app:

   ```bash
   git clone https://github.com/atharvdange618/Shawtty.git
   cd Shawtty/app
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure the environment:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set `AICREDITS_API_KEY`. Defaults work for everything else:

   | Variable | Default | Purpose |
   |---|---|---|
   | `AICREDITS_API_KEY` | (empty) | Required for plan + speech calls |
   | `AICREDITS_BASE_URL` | `https://aicredits.in/v1` | Primary gateway |
   | `AICREDITS_FALLBACK_BASE_URL` | `https://api.aicredits.in/v1` | Fallback gateway |
   | `VIDEO_MODEL` | `openai/gpt-4.1-mini` | Motion-plan model |
   | `SPEECH_MODEL` | `openai/tts-1` | Narration model |
   | `SPEECH_VOICE` | `alloy` | Also: echo, fable, onyx, nova, shimmer |
   | `SPEECH_FORMAT` | `mp3` | Speech audio format |
   | `PROMPT_MAX_CHARS` | `20000` | Max prompt length |
   | `PORT` | `3000` | HTTP port |

4. Sanity-check env + binaries (no API cost):

   ```bash
   npm run check
   ```

   Expected: key status, model names, and `ffmpeg:` / `ffprobe:` version lines.
   If a binary is "missing", install FFmpeg and re-run.

5. Verify the render path without spending (no LLM calls):

   ```bash
   npm run render:smoke
   ```

   Expected: `reel/smoke/reel.mp4`. This exercises the same `renderReel`
   function jobs use.

6. Start the server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`, type a prompt, submit. To include a target
   length, write it in the prompt ("20-second reel", "1 min"), the planner
   parses 5-90s and fits TTS speed (0.85-1.15) to match.

7. Check a job:

   ```bash
   curl http://localhost:3000/api/health
   curl http://localhost:3000/api/jobs/<job-id>
   ```

   Each job persists `reel/<job-id>/{input.json,plan.json,job.json,reel.mp4}`;
   speech audio lands in `public/generated/<job-id>.mp3`.

## Scripts

| Command | What it does | Cost |
|---|---|---|
| `npm run dev` / `npm start` | Start Express (`server/index.ts`) | API cost per job |
| `npm run check` | Env + ffmpeg/ffprobe sanity | Free |
| `npm run render:smoke` | Local 6s render to `reel/smoke/` | Free |
| `npm run typecheck` | TypeScript check across `server/`, `remotion/`, `scripts/` | Free |
| `npm run lint` | ESLint (TypeScript + browser JS) | Free |
| `npm run test` | Vitest unit tests (`test:watch` to watch) | Free |
| `npm run remotion:studio` | Open Remotion Studio | Free |
| `npm run remotion:render` | Manual render to `reel/manual.mp4` | Free |

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | `ok`, key presence, models (never leaks the key) |
| `GET` | `/api/jobs` | List jobs |
| `POST` | `/api/jobs` | Body `{ prompt }`, returns `202 { job }` |
| `GET` | `/api/jobs/:id` | Status, plan, `videoUrl` |
| Static | `/reel/*`, `/` | Rendered MP4s, prompt panel |

## Troubleshooting

- `AICREDITS_API_KEY: missing` from `npm run check` → `.env` not created or key
  empty. Copy from `.env.example` first.
- `ffmpeg/ffprobe: missing` → install FFmpeg and ensure both are on PATH.
- Job fails with 401 → bad key; 402/balance → empty AICredits balance;
  429 → rate-limited, retry.
- Sarvam Bulbul voices fail through the gateway (voice swapped to `meera`,
  rejected 400) → stay on `openai/tts-1` for now.
- `reel/` output or `public/generated/*.mp3` missing → both dirs are
  auto-created on server start; both are git-ignored build artifacts.
- Never commit `.env`. It is git-ignored; `.env.example` is the template.

## Docs

- `docs/plan.md`: v2 goal, staged pipeline, cost/reliability, open decisions.
- `docs/revise-plan.md`: revised v2.1 reel architecture plan.
- `docs/HARNESS.md`: pipeline contract, visual system, HyperFrames eval (SSIM 0.922), verify commands.
- `docs/MOTION-GRAPHICS-RESEARCH.md`, `docs/INTEGRATIONS-RESEARCH.md`: research notes.
- `app/README.md`: MVP app notes.
- `netlogs-trail/`: Neatlogs integration task brief.
