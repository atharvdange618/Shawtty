# AI Reel Agent MVP

A small local agent that turns a prompt into a narrated motion-graphics reel.

The app gives you a prompt panel in the browser, calls AICredits for a video plan and speech audio, renders a Remotion composition, and saves the final MP4 in `reel/<job-id>/reel.mp4`.

## Setup

1. Install packages:

```bash
npm install
```

2. Create `.env` from `.env.example` and put your AICredits key in `AICREDITS_API_KEY`.

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

Large prompts are allowed up to `PROMPT_MAX_CHARS`, which defaults to `20000`. Add `PROMPT_MAX_CHARS=30000` to `.env` if you need an even larger stress-test prompt.

## Requirements

- Node.js 18 or newer.
- FFmpeg and FFprobe on your PATH.
- Remotion dependencies installed with `npm install`.
- A working AICredits key with access to:
  - `openai/gpt-4.1-mini` for the motion plan.
  - `openai/tts-1` for speech (`SPEECH_VOICE`: alloy, echo, fable, onyx, nova, shimmer).
    Sarvam `bulbul` models fail through AICredits right now: the gateway swaps
    every voice for `meera`, which Bulbul rejects with HTTP 400.

## Output

Each job gets its own folder:

```text
reel/<job-id>/
  input.json
  plan.json
  job.json
  reel.mp4
```

Generated speech audio is stored in `public/generated/<job-id>.mp3` so Remotion can load it during render.

## Notes

The MVP asks the AI model for structured JSON instead of executing generated code. Remotion renders that JSON through a local, trusted component. This keeps the first version stable and avoids running unreviewed model code.
