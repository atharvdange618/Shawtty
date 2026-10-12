# Shawtty Manim Engine (`manim-service/`)

A high-performance Python microservice that generates vertical 1080x1920 (9:16) motion-graphics explainer reels using **Manim Community Edition**, **Sarvam AI TTS**, and an autonomous **Self-Healing LLM Repair Loop**.

---

## Features

- **Manim Community Edition**: Produces 3Blue1Brown-style vector animations, geometric transformations, and architecture diagrams rendered at 1080x1920 vertical format.
- **Sarvam AI Voiceover Integration**: Generates natural speech via `bulbul:v4-flash`, with per-act duration measurement down to the millisecond.
- **Audio-Synced Animation Timings**: Automatically calculates animation `run_time` values to match spoken narration beats.
- **Self-Healing Repair Loop**: If Manim encounters a compilation failure or runtime error, the service captures the Python traceback and prompts the repair agent to patch the script in place (up to 3 attempts).
- **Embedded Vector Icons**: Includes an SVG library for system design concepts: cloud, server, database, redis, cpu, lock, user, and activity icons.
- **Developer Playground UI**: Comes with a standalone web interface on port 8000 with real-time logs, code viewer, and one-click prompt presets.

---

## Architecture Pipeline

```text
1. SCRIPT PLANNING (LLM)
   - Breaks topic into a 4-act narrative arc:
     Act 1: Hook & Core Problem
     Act 2: Mechanism / Architecture Deep Dive
     Act 3: Key Insight / The "Aha!" Moment
     Act 4: Real-world Impact & Takeaways

2. VOICEOVER SYNTHESIS (Sarvam AI)
   - Generates speech for each act via Sarvam API.
   - Measures exact audio duration per act.

3. MANIM CODE GENERATION (LLM)
   - Writes a self-contained Manim Python script with a ReelScene class.
   - Paces animations to match measured act durations.

4. COMPILATION & RUNNER (Manim Community)
   - Runs `manim render -qh --format mp4 ReelScene` at 1080x1920.

5. SELF-HEALING REPAIR LOOP (Optional)
   - On error: parses stderr/traceback -> prompts LLM repair -> re-renders.

6. AUDIO-VIDEO MUXING (FFmpeg)
   - Combines narration audio, subtle SFX, and rendered video into final MP4.
```

---

## Local Setup

### Prerequisites
- Python 3.10+ or 3.11+
- FFmpeg installed on system PATH
- Cairo and Pango development libraries (standard for Manim Community)

### 1. Create Virtual Environment

```bash
python -m venv .venv

# Activate on Windows:
.venv\Scripts\activate

# Activate on Linux/macOS:
source .venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your API credentials in `.env`:

```env
# LLM Provider (LiteLLM / OpenAI compatible)
LLM_BASE_URL=https://litellm.vision.aivar.app/v1
LLM_API_KEY=your_llm_api_key
VIDEO_MODEL=claude-opus-4.6

# Voiceover (Sarvam AI)
SARVAM_API_KEY=your_sarvam_api_key
SARVAM_BASE_URL=https://api.sarvam.ai
SARVAM_MODEL=bulbul:v4-flash
SARVAM_SPEAKER=shubh_enhi_ads
SARVAM_LANGUAGE_CODE=en-IN

PORT=8000
```

### 4. Run Service

```bash
uvicorn service.main:app --host 0.0.0.0 --port 8000 --reload
```

Access the developer console at `http://localhost:8000`.

---

## Docker Setup

Run standalone with Docker:

```bash
docker build -t shawtty-manim-service .
docker run -p 8000:8000 --env-file .env shawtty-manim-service
```

Or using Docker Compose:

```bash
docker compose up --build
```

---

## API Endpoints

### `GET /api/health`
Returns service health, engine version, and output directory status.

### `POST /api/jobs`
Creates an asynchronous video generation job.
- **Request Body**:
  ```json
  {
    "prompt": "How WebSockets work under the hood",
    "quality": "h",
    "max_retries": 3
  }
  ```
- **Response**: `200 OK` with initial job object.

### `GET /api/jobs`
Lists all recent generation jobs with status, timestamps, and progress.

### `GET /api/jobs/{job_id}`
Returns details for a specific job:
- `status`: `queued` | `generating_code` | `rendering` | `completed` | `failed`
- `step`: Human-readable description of current task
- `progress`: 0 to 100 percentage
- `current_code`: Current Manim Python script
- `attempts`: Array of compilation attempts and tracebacks (if repairs occurred)
- `video_url`: Relative path to completed video once rendered

### `GET /output/{job_id}.mp4`
Direct static streaming endpoint for the rendered 1080p MP4 reel.
