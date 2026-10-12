import asyncio
import base64
import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
import httpx

from .config import (
    SARVAM_API_KEY,
    SARVAM_BASE_URL,
    SARVAM_MODEL,
    SARVAM_SPEAKER,
    SARVAM_LANGUAGE_CODE,
    AICREDITS_API_KEY,
    AICREDITS_BASE_URL,
    AICREDITS_FALLBACK_BASE_URL,
    SPEECH_MODEL,
    SPEECH_VOICE,
    SPEECH_FORMAT,
)

logger = logging.getLogger("manim_service.tts")

async def generate_sarvam_audio(
    text: str,
    output_path: Path,
    speaker: str = SARVAM_SPEAKER,
    model: str = SARVAM_MODEL,
    target_language_code: str = SARVAM_LANGUAGE_CODE,
    pace: float = 0.90,
) -> Path:
    """
    Generate speech audio via Sarvam AI REST API (bulbul:v4-flash).
    """
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY is not configured")

    url = f"{SARVAM_BASE_URL.rstrip('/')}/text-to-speech"
    headers = {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "target_language_code": target_language_code,
        "speaker": speaker,
        "model": model,
        "pace": pace,
        "speech_sample_rate": 24000,
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        logger.info(f"Generating Sarvam AI voiceover (model={model}, speaker={speaker})...")
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code == 200:
            data = resp.json()
            audios = data.get("audios", [])
            if not audios:
                raise ValueError("Sarvam AI returned empty audios array")
            audio_bytes = base64.b64decode(audios[0])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(audio_bytes)
            logger.info(f"Sarvam AI speech synthesized successfully: {output_path} ({len(audio_bytes)} bytes)")
            return output_path
        else:
            raise RuntimeError(f"Sarvam AI returned HTTP {resp.status_code}: {resp.text}")

async def generate_narration(text: str, output_path: Path) -> Path:
    """
    Generate speech audio.
    1. Primary: Sarvam AI (bulbul:v4-flash)
    2. Fallback: edge-tts (studio neural en-US-ChristopherNeural)
    3. Final Fallback: AICredits OpenAI TTS
    """
    # 1. Try Sarvam AI first
    if SARVAM_API_KEY:
        try:
            return await generate_sarvam_audio(text, output_path)
        except Exception as e:
            logger.warning(f"Sarvam AI TTS generation failed: {e}. Falling back to edge-tts.")

    # 2. Try edge-tts neural voice (free, ultra-fast, high quality)
    try:
        import edge_tts
        logger.info("Synthesizing via edge-tts neural voice en-US-ChristopherNeural...")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        communicate = edge_tts.Communicate(text, "en-US-ChristopherNeural", rate="-6%")
        await communicate.save(str(output_path))
        if output_path.exists() and output_path.stat().st_size > 100:
            logger.info(f"Saved speech audio via edge-tts to {output_path} ({output_path.stat().st_size} bytes)")
            return output_path
    except Exception as edge_err:
        logger.warning(f"edge-tts fallback failed: {edge_err}. Trying AICredits...")

    # 3. Try AICredits
    if AICREDITS_API_KEY:
        headers = {
            "Authorization": f"Bearer {AICREDITS_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": SPEECH_MODEL,
            "input": text,
            "voice": SPEECH_VOICE,
            "response_format": SPEECH_FORMAT,
        }
        urls = [AICREDITS_BASE_URL, AICREDITS_FALLBACK_BASE_URL]
        async with httpx.AsyncClient(timeout=60.0) as client:
            for base_url in urls:
                endpoint = f"{base_url.rstrip('/')}/audio/speech"
                try:
                    resp = await client.post(endpoint, headers=headers, json=payload)
                    if resp.status_code == 200:
                        output_path.parent.mkdir(parents=True, exist_ok=True)
                        output_path.write_bytes(resp.content)
                        logger.info(f"Saved speech audio via AICredits to {output_path} ({len(resp.content)} bytes)")
                        return output_path
                except Exception as e:
                    logger.warning(f"AICredits error {endpoint}: {e}")

    raise RuntimeError("All TTS gateways (Sarvam AI, edge-tts, AICredits) failed.")

def extract_acoustic_speech_segments(act_file: Path, narration: str) -> List[Dict[str, Any]]:
    """
    Extract millisecond-exact spoken clause intervals using pydub acoustic silence detection.
    Returns: [{'text': str, 'start': float, 'end': float}] relative to act start.
    """
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_nonsilent
        audio_seg = AudioSegment.from_file(str(act_file))
        dur = len(audio_seg) / 1000.0
        nonsilent = detect_nonsilent(audio_seg, min_silence_len=200, silence_thresh=-35)
        
        # Split narration into natural sentence/clause units
        sentences = [s.strip() for s in re.split(r'(?<=[.!?,\u2014])\s+', narration) if s.strip()]
        if not sentences:
            sentences = [narration]
            
        segments = []
        if nonsilent and len(nonsilent) >= len(sentences):
            blocks_per_sent = max(1, len(nonsilent) // len(sentences))
            for i, sent in enumerate(sentences):
                idx_start = min(i * blocks_per_sent, len(nonsilent) - 1)
                idx_end = min((i + 1) * blocks_per_sent - 1, len(nonsilent) - 1) if i < len(sentences) - 1 else len(nonsilent) - 1
                s = nonsilent[idx_start][0] / 1000.0
                e = nonsilent[idx_end][1] / 1000.0
                segments.append({"text": sent, "start": round(s, 2), "end": round(e, 2)})
        elif nonsilent:
            total_non_dur = sum((e - s) for s, e in nonsilent) / 1000.0
            cur_time = nonsilent[0][0] / 1000.0
            total_chars = sum(len(s) for s in sentences) or 1
            for sent in sentences:
                sent_dur = total_non_dur * (len(sent) / total_chars)
                segments.append({"text": sent, "start": round(cur_time, 2), "end": round(cur_time + sent_dur, 2)})
                cur_time += sent_dur
        else:
            cur = 0.0
            step = dur / max(1, len(sentences))
            for sent in sentences:
                segments.append({"text": sent, "start": round(cur, 2), "end": round(cur + step, 2)})
                cur += step
        return segments
    except Exception as e:
        logger.warning(f"Acoustic segment detection fallback: {e}")
        return [{"text": narration, "start": 0.0, "end": 6.0}]

async def synthesize_synchronized_storyboard_audio(
    acts: List[Dict[str, Any]],
    job_dir: Path,
    transition_pause: float = 0.8,
) -> Tuple[Path, Dict[int, float], float, Dict[int, List[Dict[str, Any]]]]:
    """
    Synthesize per-act voiceover audio, extract acoustic speech timestamps, and compute exact timing budgets.
    Pads each act with transition_pause seconds of silence so transitions feel natural.
    Returns: (final_concatenated_mp3_path, act_timings_dict, total_duration, act_audio_breakdowns)
    """
    act_audio_files: List[Path] = []
    act_timings: Dict[int, float] = {}
    act_audio_breakdowns: Dict[int, List[Dict[str, Any]]] = {}

    for i, act in enumerate(acts):
        act_num = act.get("act_number", i + 1)
        narration = act.get("narration", "").strip()
        if not narration:
            continue

        act_file = job_dir / f"act_{act_num}.wav"
        try:
            await generate_narration(narration, act_file)
            dur = await get_audio_duration(act_file)
            segments = extract_acoustic_speech_segments(act_file, narration)
            act_audio_breakdowns[act_num] = segments
        except Exception as e:
            logger.warning(f"Failed to generate audio for Act {act_num}: {e}")
            dur = 6.0
            act_audio_breakdowns[act_num] = [{"text": narration, "start": 0.0, "end": dur}]

        # Budget = duration of speech + transition_pause
        act_budget = round(dur + transition_pause, 1)
        act_timings[act_num] = act_budget
        act_audio_files.append(act_file)
        logger.info(f"Act {act_num} audio: speech={dur:.2f}s, budget (with {transition_pause}s pause)={act_budget:.1f}s, segments={len(act_audio_breakdowns[act_num])}")

    narration_path = job_dir / "narration.mp3"

    # If we have multiple act files, concatenate them with padding using ffmpeg
    if len(act_audio_files) > 1:
        input_args = []
        filter_parts = []
        concat_inputs = []
        for idx, f in enumerate(act_audio_files):
            input_args.extend(["-i", str(f)])
            filter_parts.append(f"[{idx}:a]apad=pad_dur={transition_pause}[a{idx}]")
            concat_inputs.append(f"[a{idx}]")

        filter_str = ";".join(filter_parts) + ";" + "".join(concat_inputs) + f"concat=n={len(act_audio_files)}:v=0:a=1[out]"
        cmd = [
            "ffmpeg",
            "-y",
            *input_args,
            "-filter_complex", filter_str,
            "-map", "[out]",
            "-c:a", "libmp3lame",
            "-b:a", "192k",
            str(narration_path),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0 and narration_path.exists():
            total_dur = await get_audio_duration(narration_path)
            logger.info(f"Concatenated {len(act_audio_files)} acts into {narration_path} (total: {total_dur:.2f}s)")
            return narration_path, act_timings, total_dur, act_audio_breakdowns
        else:
            logger.warning(f"ffmpeg concat failed ({proc.returncode}): {stderr.decode(errors='replace')}")

    elif len(act_audio_files) == 1:
        shutil.copy2(act_audio_files[0], narration_path)
        total_dur = await get_audio_duration(narration_path)
        return narration_path, act_timings, total_dur, act_audio_breakdowns

    # Fallback to single narration synthesis if per-act concat had any problem
    full_text = " ".join([act.get("narration", "").strip() for act in acts])
    await generate_narration(full_text, narration_path)
    total_dur = await get_audio_duration(narration_path)
    word_counts = [max(1, len(act.get("narration", "").split())) for act in acts]
    total_words = max(1, sum(word_counts))
    fallback_timings = {}
    for i, act in enumerate(acts):
        act_num = act.get("act_number", i + 1)
        fallback_timings[act_num] = max(4.0, round(total_dur * (word_counts[i] / total_words), 1))
        act_audio_breakdowns[act_num] = [{"text": act.get("narration", ""), "start": 0.0, "end": fallback_timings[act_num]}]
    return narration_path, fallback_timings, total_dur, act_audio_breakdowns

async def get_audio_duration(audio_path: Path) -> float:
    """
    Measure audio file duration in seconds via ffprobe or ffmpeg.
    """
    # Try ffprobe first
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(audio_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            data = json.loads(stdout.decode())
            return float(data["format"]["duration"])
    except Exception as e:
        logger.debug(f"ffprobe failed, trying ffmpeg fallback: {e}")

    # Fallback to ffmpeg
    try:
        cmd = ["ffmpeg", "-i", str(audio_path)]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", stderr.decode("utf-8", errors="replace"))
        if match:
            hours, minutes, seconds = match.groups()
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception as e:
        logger.warning(f"ffmpeg duration check failed: {e}")

    return 0.0

async def get_video_duration(video_path: Path) -> float:
    """
    Measure video file duration in seconds via ffprobe or ffmpeg.
    """
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(video_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            data = json.loads(stdout.decode())
            return float(data["format"]["duration"])
    except Exception as e:
        logger.debug(f"ffprobe video check failed: {e}")

    try:
        cmd = ["ffmpeg", "-i", str(video_path)]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", stderr.decode("utf-8", errors="replace"))
        if match:
            hours, minutes, seconds = match.groups()
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception as e:
        logger.warning(f"ffmpeg video duration check failed: {e}")

    return 0.0

def format_ass_time(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hrs}:{mins:02d}:{secs:05.2f}"

def generate_ass_subtitles(
    acts: List[Dict[str, Any]],
    act_timings: Dict[int, float],
    output_path: Path,
    act_audio_breakdowns: Optional[Dict[int, List[Dict[str, Any]]]] = None,
) -> Path:
    """
    Generate viral-style animated .ass captions synchronized per act using acoustic speech timestamps.
    Positions captions at MarginV=350 (comfortably above mobile platform UI danger zone).
    """
    ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,66,&H00FFFFFF,&H0000FFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,4.5,2.0,2,80,80,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    current_time = 0.0

    for idx, act in enumerate(acts):
        act_num = act.get("act_number", idx + 1)
        dur = act_timings.get(act_num, 7.0)
        
        # Check if we have acoustic speech breakdown for this act
        breakdown = (act_audio_breakdowns or {}).get(act_num, [])
        if breakdown:
            for seg in breakdown:
                text = seg.get("text", "").strip()
                words = text.split()
                if not words:
                    continue
                seg_s = current_time + seg.get("start", 0.0)
                seg_e = current_time + seg.get("end", dur)
                seg_dur = max(0.5, seg_e - seg_s)

                # Chunk words into 2-3 word phrases for viral readability
                chunks = []
                c_idx = 0
                while c_idx < len(words):
                    c_len = 3 if len(words) - c_idx >= 4 else (len(words) - c_idx)
                    chunks.append(" ".join(words[c_idx:c_idx + c_len]))
                    c_idx += c_len

                chunk_s = seg_s
                for chunk in chunks:
                    c_words = chunk.split()
                    c_dur = seg_dur * (len(c_words) / len(words))
                    c_end = chunk_s + c_dur

                    highlight_color = "&H00FFFF&" if idx % 2 == 0 else "&HFFFF00&"
                    if len(c_words) > 1:
                        formatted_text = f"{{\\c{highlight_color}}}{c_words[0]}{{\\c&HFFFFFF&}} " + " ".join(c_words[1:])
                    else:
                        formatted_text = f"{{\\c{highlight_color}}}{chunk}"

                    t_start_str = format_ass_time(chunk_s)
                    t_end_str = format_ass_time(c_end)
                    events.append(f"Dialogue: 0,{t_start_str},{t_end_str},Default,,0,0,0,,{formatted_text}")
                    chunk_s = c_end
        else:
            narration = act.get("narration", "").strip()
            words = narration.split()
            if words:
                chunks = []
                i = 0
                while i < len(words):
                    chunk_len = 3 if len(words) - i >= 4 else (len(words) - i)
                    chunks.append(" ".join(words[i:i+chunk_len]))
                    i += chunk_len

                total_words = len(words)
                act_speech_dur = max(1.0, dur - 0.4)
                chunk_start = current_time
                for chunk in chunks:
                    chunk_words = chunk.split()
                    chunk_dur = act_speech_dur * (len(chunk_words) / total_words)
                    chunk_end = chunk_start + chunk_dur

                    highlight_color = "&H00FFFF&" if idx % 2 == 0 else "&HFFFF00&"
                    if len(chunk_words) > 1:
                        formatted_text = f"{{\\c{highlight_color}}}{chunk_words[0]}{{\\c&HFFFFFF&}} " + " ".join(chunk_words[1:])
                    else:
                        formatted_text = f"{{\\c{highlight_color}}}{chunk}"

                    t_start_str = format_ass_time(chunk_start)
                    t_end_str = format_ass_time(chunk_end)
                    events.append(f"Dialogue: 0,{t_start_str},{t_end_str},Default,,0,0,0,,{formatted_text}")
                    chunk_start = chunk_end

        current_time += dur

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(ass_header + "\n".join(events) + "\n", encoding="utf-8")
    logger.info(f"Generated synchronized ASS subtitles: {output_path} ({len(events)} events)")
    return output_path

async def generate_subtle_sfx(act_timings: Dict[int, float], total_dur: float, output_path: Path) -> Optional[Path]:
    """
    Synthesize audible, punchy transition swooshes at the intro, act boundaries, and midpoints.
    Completely generic across any number of acts.
    """
    try:
        delays = [350]
        current_t = 0.0
        for act_num in sorted(act_timings.keys()):
            act_dur = act_timings[act_num]
            if current_t > 0:
                delays.append(int(current_t * 1000))
            if act_dur >= 6.5:
                delays.append(int((current_t + act_dur * 0.45) * 1000))
            current_t += act_dur

        delays = sorted(list(set(delays)))
        if not delays:
            return None

        filter_inputs = []
        amix_inputs = []
        for i, delay_ms in enumerate(delays):
            # Crisp white noise bandpass sweep + subtle bass impact (-14dB)
            filter_inputs.append(
                f"anoisesrc=d=0.28:c=white:r=48000,bandpass=f=1450:w=700,afade=t=in:ss=0:d=0.04,afade=t=out:st=0.06:d=0.20,volume=0.25[n{i}];"
                f"sine=f=95:d=0.22,afade=t=out:st=0.03:d=0.18,volume=0.20[b{i}];"
                f"[n{i}][b{i}]amix=inputs=2:normalize=0[raw{i}];"
                f"[raw{i}]adelay={delay_ms}|{delay_ms}[w{i}]"
            )
            amix_inputs.append(f"[w{i}]")

        filter_str = ";".join(filter_inputs) + ";" + "".join(amix_inputs) + f"amix=inputs={len(delays)}:duration=longest:normalize=0[out]"

        cmd = [
            "ffmpeg", "-y",
            "-filter_complex", filter_str,
            "-map", "[out]",
            "-t", str(int(total_dur) + 2),
            str(output_path),
        ]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc.communicate()
        if proc.returncode == 0 and output_path.exists():
            logger.info(f"Generated transition SFX: {output_path} ({len(delays)} cues)")
            return output_path
    except Exception as e:
        logger.warning(f"Failed to generate subtle SFX: {e}")
    return None

async def mux_audio_video(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    ass_path: Optional[Path] = None,
    sfx_path: Optional[Path] = None,
) -> Path:
    """
    Mux Manim video and TTS audio with:
    1. Intelligent AV sync (adaptive PTS scaling if needed)
    2. Subtle sound effects (SFX) mixing with normalize=0 to prevent volume pumping
    3. Broadcast loudness normalization (-16 LUFS) so audio never gets louder or quieter
    4. Burned synchronized viral-style subtitles (.ass)
    """
    try:
        v_dur = await get_video_duration(video_path)
        a_dur = await get_audio_duration(audio_path)
        logger.info(f"Muxing check: raw video={v_dur:.2f}s, audio={a_dur:.2f}s, subtitles={ass_path is not None}, sfx={sfx_path is not None}")

        pts_scale = 1.0
        if v_dur > 0 and a_dur > 0:
            ratio = v_dur / a_dur
            if 0.5 <= ratio <= 2.2 and abs(v_dur - a_dur) > 1.0:
                pts_scale = a_dur / v_dur
                logger.info(f"Applying adaptive video time-scale setpts={pts_scale:.4f}*PTS")

        inputs = ["-i", str(video_path), "-i", str(audio_path)]
        if sfx_path and sfx_path.exists():
            inputs.extend(["-i", str(sfx_path)])

        v_filters = []
        if abs(pts_scale - 1.0) > 0.01:
            v_filters.append(f"setpts={pts_scale:.4f}*PTS")
        if ass_path and ass_path.exists():
            escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:")
            v_filters.append(f"subtitles={escaped_ass}")

        # Audio filter: normalize=0 prevents volume fluctuation on voice; loudnorm normalizes to broadcast standard
        if sfx_path and sfx_path.exists():
            if v_filters:
                filter_complex = (
                    f"[0:v]{','.join(v_filters)}[v];"
                    f"[1:a]volume=1.0[voice];"
                    f"[2:a]volume=0.20,afade=t=in:ss=0:d=0.04,afade=t=out:st={int(a_dur)}:d=0.3[sfx];"
                    f"[voice][sfx]amix=inputs=2:duration=first:normalize=0[mixed];"
                    f"[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[a]"
                )
                map_v = "[v]"
            else:
                filter_complex = (
                    f"[1:a]volume=1.0[voice];"
                    f"[2:a]volume=0.20,afade=t=in:ss=0:d=0.04,afade=t=out:st={int(a_dur)}:d=0.3[sfx];"
                    f"[voice][sfx]amix=inputs=2:duration=first:normalize=0[mixed];"
                    f"[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[a]"
                )
                map_v = "0:v"
            map_a = "[a]"
        else:
            if v_filters:
                filter_complex = f"[0:v]{','.join(v_filters)}[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]"
                map_v = "[v]"
                map_a = "[a]"
            else:
                filter_complex = "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]"
                map_v = "0:v"
                map_a = "[a]"

        cmd = [
            "ffmpeg", "-y",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", map_v,
            "-map", map_a,
            "-c:v", "libx264" if v_filters else "copy",
            "-preset", "fast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            str(output_path),
        ]

        logger.info(f"Running mux cmd: {' '.join(cmd[:12])}...")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            logger.info(f"Successfully muxed final video with audio, subtitles, and SFX: {output_path}")
            return output_path
        else:
            logger.warning(f"ffmpeg muxing failed ({proc.returncode}): {stderr.decode('utf-8', errors='replace')}")
    except Exception as e:
        logger.warning(f"Error invoking ffmpeg for muxing: {e}")

    shutil.copy2(video_path, output_path)
    return output_path
