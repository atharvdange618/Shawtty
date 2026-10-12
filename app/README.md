# Shawtty Web Gateway (`app/`)

The Node.js + Express gateway and interactive frontend for Shawtty.

It provides the browser interface (`http://localhost:3000`), handles job queuing, communicates with the Python `manim-service` backend, and streams the finished 1080p MP4 reel directly to the user.

---

## Architecture Role

```text
[ Browser UI ]
      │  (POST /api/jobs { prompt })
      ▼
[ Express Server (server/index.ts) ]
      │  (Job dispatch & tracking)
      ▼
[ Job Proxy (server/jobs.ts) ] ───► [ Python manim-service (Port 8000) ]
      │                                       │
      │◄── (Poll status & download MP4) ──────┘
      ▼
[ Local Reel Cache (reel/<job-id>/reel.mp4) ]
      │
      ▼
[ Video Player in Browser ]
```

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set the URL of the Manim microservice:

```env
PORT=3000
MANIM_SERVICE_URL=http://localhost:8000
PROMPT_MAX_CHARS=20000
```

*(When running inside Docker Compose, `MANIM_SERVICE_URL` is automatically configured to `http://manim-service:8000`)*.

### 3. Verify Health

Check if your configuration and `manim-service` connection are healthy:

```bash
npm run check
```

### 4. Start the Server

```bash
# Development mode with hot-reloading (via tsx)
npm run dev

# Or production start
npm start
```

Open `http://localhost:3000` in your web browser.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 3000 with auto-reload |
| `npm start` | Start server via `tsx server/index.ts` |
| `npm run check` | Run environment check and test connection to `manim-service` |
| `npm run typecheck` | Run `tsc --noEmit` to verify TypeScript types |

---

## Output Files

Jobs are saved locally in the `reel/` directory:

```text
reel/
  <job-id>/
    job.json        # Public job state (progress, steps, timestamp)
    trace.json      # Pipeline execution trace log
    reel.mp4        # Rendered 1080p vertical video reel
```
