import asyncio
import json
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from uuid import uuid4

from .config import JOBS_DIR, OUTPUT_DIR
from .manim_generator import generate_manim_reel
from .manim_runner import render_manim_code
from .repair_agent import repair_manim_code
from .tts import (
    generate_narration,
    get_audio_duration,
    mux_audio_video,
    synthesize_synchronized_storyboard_audio,
    generate_ass_subtitles,
    generate_subtle_sfx,
)

logger = logging.getLogger("manim_service.orchestrator")

jobs_store: Dict[str, Dict[str, Any]] = {}

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    if job_id in jobs_store:
        return jobs_store[job_id]
    
    # Try reading from disk
    job_file = JOBS_DIR / job_id / "job.json"
    if job_file.exists():
        try:
            data = json.loads(job_file.read_text(encoding="utf-8"))
            jobs_store[job_id] = data
            return data
        except Exception:
            pass
    return None

def save_job(job: Dict[str, Any]):
    job["updated_at"] = datetime.utcnow().isoformat()
    jobs_store[job["id"]] = job
    
    job_dir = JOBS_DIR / job["id"]
    job_dir.mkdir(parents=True, exist_ok=True)
    job_file = job_dir / "job.json"
    job_file.write_text(json.dumps(job, indent=2), encoding="utf-8")

async def run_reel_pipeline(job_id: str, prompt: str, quality: str = "h", max_retries: int = 3):
    job = jobs_store[job_id]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Phase 1: Script & Storyboard Planning
        job["status"] = "generating_code"
        job["step"] = "Planning 4-act narrative storyboard"
        job["progress"] = 15
        save_job(job)

        from .manim_generator import generate_reel_script, generate_manim_code_for_script

        script_data = await generate_reel_script(prompt)
        job["title"] = script_data.get("title", prompt)
        job["narration"] = script_data.get("full_narration", "")
        save_job(job)

        # Phase 2: Narration Voiceover Synthesis & Timing Measurement
        job["step"] = "Synthesizing synchronized voiceover audio with Sarvam AI"
        job["progress"] = 28
        save_job(job)

        audio_path = job_dir / "narration.mp3"
        audio_duration = 30.0
        act_timings = {}
        act_audio_breakdowns = {}
        acts = script_data.get("acts", [])

        try:
            audio_path, act_timings, audio_duration, act_audio_breakdowns = await synthesize_synchronized_storyboard_audio(
                acts=acts,
                job_dir=job_dir,
                transition_pause=0.5,
            )
            job["audio_duration"] = audio_duration
            logger.info(f"Synthesized voiceover: {audio_duration:.2f}s with exact per-act timings: {act_timings}")
        except Exception as tts_err:
            logger.warning(f"Voiceover synthesis failed: {tts_err}. Falling back to default timing.")
            act_timings = {1: 7.5, 2: 7.5, 3: 11.0, 4: 6.0}
            audio_duration = sum(act_timings.values())
            job["audio_duration"] = audio_duration
            act_audio_breakdowns = {i: [{"text": act.get("narration", ""), "start": 0.0, "end": act_timings[i]}] for i, act in enumerate(acts, 1)}

        # Phase 3: Synchronized Manim Code Generation
        job["step"] = "Generating time-synchronized Manim scene code"
        job["progress"] = 38
        save_job(job)

        current_code = await generate_manim_code_for_script(
            prompt=prompt,
            script_data=script_data,
            act_timings=act_timings,
            total_duration=audio_duration,
            act_audio_breakdowns=act_audio_breakdowns,
        )
        job["current_code"] = current_code
        save_job(job)

        # Phase 4: Render & Self-Healing Repair Loop
        job["status"] = "rendering"
        job["step"] = "Rendering 1080p Manim vertical animation"
        job["progress"] = 50
        save_job(job)

        successful_video: Optional[str] = None
        attempt_num = 1

        while attempt_num <= max_retries:
            logger.info(f"Render attempt {attempt_num}/{max_retries} for job {job_id}")
            job["current_attempt"] = attempt_num
            job["step"] = f"Compiling Manim scene (Attempt {attempt_num}/{max_retries})"
            save_job(job)

            render_res = await render_manim_code(
                code=current_code,
                job_dir=job_dir,
                scene_name="ReelScene",
                quality=quality,
            )

            attempt_record = {
                "attempt": attempt_num,
                "timestamp": datetime.utcnow().isoformat(),
                "success": render_res["success"],
                "error_summary": render_res.get("error_summary"),
                "traceback": render_res.get("traceback"),
                "code": current_code,
            }
            job["attempts"].append(attempt_record)

            if render_res["success"]:
                successful_video = render_res["video_path"]
                logger.info(f"Attempt {attempt_num} succeeded!")
                break
            else:
                logger.warning(f"Attempt {attempt_num} failed: {render_res['error_summary']}")
                if attempt_num < max_retries:
                    # Self-healing repair pass
                    job["status"] = "repairing"
                    job["step"] = f"Auto-repairing code errors with traceback feedback (Attempt {attempt_num} -> {attempt_num+1})"
                    save_job(job)

                    repair_res = await repair_manim_code(
                        broken_code=current_code,
                        error_summary=render_res["error_summary"] or "Render Failed",
                        traceback=render_res["traceback"] or render_res["stderr"],
                        prompt=prompt,
                    )

                    attempt_record["diagnosis"] = repair_res.get("diagnosis", "")
                    current_code = repair_res.get("code", current_code)
                    job["current_code"] = current_code
                    save_job(job)
                
                attempt_num += 1

        if not successful_video:
            job["status"] = "failed"
            job["error"] = f"Render failed after {max_retries} attempts: {job['attempts'][-1].get('error_summary')}"
            job["step"] = "Failed"
            save_job(job)
            return

        # Phase 4: Audio / Video Final Mix
        job["status"] = "mixing"
        job["step"] = "Finalizing 1080p MP4 audio & video synchronization"
        job["progress"] = 90
        save_job(job)

        final_mp4_path = OUTPUT_DIR / f"{job_id}.mp4"
        if audio_path.exists() and audio_duration > 0:
            ass_path = job_dir / "subtitles.ass"
            try:
                generate_ass_subtitles(acts, act_timings, ass_path, act_audio_breakdowns=act_audio_breakdowns)
            except Exception as sub_err:
                logger.warning(f"Failed to generate subtitles: {sub_err}")
                ass_path = None

            sfx_path = job_dir / "sfx.wav"
            try:
                await generate_subtle_sfx(act_timings, audio_duration, sfx_path)
            except Exception as sfx_err:
                logger.warning(f"Failed to generate SFX: {sfx_err}")
                sfx_path = None

            await mux_audio_video(
                video_path=Path(successful_video),
                audio_path=audio_path,
                output_path=final_mp4_path,
                ass_path=ass_path,
                sfx_path=sfx_path,
            )
        else:
            shutil.copy2(successful_video, final_mp4_path)

        job["status"] = "completed"
        job["progress"] = 100
        job["step"] = "Completed! 1080p Reel ready."
        job["video_path"] = str(final_mp4_path)
        job["video_url"] = f"/output/{job_id}.mp4"
        save_job(job)
        logger.info(f"Job {job_id} successfully completed. Output: {final_mp4_path}")

    except Exception as e:
        logger.exception(f"Unexpected error in pipeline for job {job_id}: {e}")
        job["status"] = "failed"
        job["error"] = str(e)
        job["step"] = "Unexpected Failure"
        save_job(job)
