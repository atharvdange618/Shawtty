import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
from uuid import uuid4

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import OUTPUT_DIR, JOBS_DIR
from .orchestrator import jobs_store, get_job, save_job, run_reel_pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("manim_service")

app = FastAPI(
    title="Shawtty Manim Reel Generator",
    description="Autonomous Vertical 1080p Motion Graphics Engine using Manim Community with Self-Healing LLM Repair Loop",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs for video streaming
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
static_dir = Path(__file__).resolve().parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

class CreateJobRequest(BaseModel):
    prompt: str = Field(..., description="Topic or prompt for the reel")
    quality: str = Field("h", description="'h' for 1080p high quality, 'l' for 480p rapid preview")
    max_retries: int = Field(3, description="Maximum self-healing repair attempts")

class RawRenderRequest(BaseModel):
    code: str = Field(..., description="Manim Python script")
    prompt: Optional[str] = Field("Custom Manim Code", description="Context prompt")
    quality: str = Field("h", description="Render quality")

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "engine": "Manim Community",
        "resolution": "1080x1920 (9:16 vertical)",
        "output_dir": str(OUTPUT_DIR),
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.post("/api/jobs")
async def create_job(req: CreateJobRequest, background_tasks: BackgroundTasks):
    job_id = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}"
    job_data: Dict[str, Any] = {
        "id": job_id,
        "prompt": req.prompt,
        "quality": req.quality,
        "status": "queued",
        "step": "Job queued for generation",
        "progress": 0,
        "title": req.prompt,
        "narration": "",
        "current_code": "",
        "current_attempt": 0,
        "attempts": [],
        "video_url": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    save_job(job_data)
    background_tasks.add_task(run_reel_pipeline, job_id, req.prompt, req.quality, req.max_retries)
    return {"job": job_data}

@app.get("/api/jobs")
async def list_jobs():
    jobs_list = []
    # Collect from memory + disk
    for job_dir in JOBS_DIR.iterdir():
        if job_dir.is_dir():
            job = get_job(job_dir.name)
            if job:
                jobs_list.append(job)
    jobs_list.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return {"jobs": jobs_list}

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": job}

@app.get("/")
async def root_view():
    index_file = static_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h1>Shawtty Manim Reel Generator API is Running!</h1><p>Visit /api/health</p>")
