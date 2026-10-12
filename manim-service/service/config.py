import os
from pathlib import Path
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

# Try loading from local .env or from parent app/.env
local_env = Path(__file__).resolve().parent.parent / ".env"
parent_env = Path(__file__).resolve().parent.parent.parent / "app" / ".env"

if local_env.exists():
    load_dotenv(local_env)
elif parent_env.exists():
    load_dotenv(parent_env)
else:
    load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "output"
MEDIA_DIR = BASE_DIR / "media"
JOBS_DIR = BASE_DIR / "jobs"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# LLM Generation (LiteLLM)
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://litellm.vision.aivar.app/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
VIDEO_MODEL = os.getenv("VIDEO_MODEL", "claude-opus-4.6")

# Sarvam AI for Primary TTS
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_BASE_URL = os.getenv("SARVAM_BASE_URL", "https://api.sarvam.ai")
SARVAM_MODEL = os.getenv("SARVAM_MODEL", "bulbul:v4-flash")
SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER", "shubh_enhi_ads")
SARVAM_LANGUAGE_CODE = os.getenv("SARVAM_LANGUAGE_CODE", "en-IN")

# AICredits for Whisper & GPT TTS
AICREDITS_API_KEY = os.getenv("AICREDITS_API_KEY", "")
AICREDITS_BASE_URL = os.getenv("AICREDITS_BASE_URL", "https://aicredits.in/v1")
AICREDITS_FALLBACK_BASE_URL = os.getenv("AICREDITS_FALLBACK_BASE_URL", "https://api.aicredits.in/v1")
SPEECH_MODEL = os.getenv("SPEECH_MODEL", "openai/tts-1")
SPEECH_VOICE = os.getenv("SPEECH_VOICE", "alloy")
SPEECH_FORMAT = os.getenv("SPEECH_FORMAT", "mp3")
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "openai/whisper-1")
PORT = int(os.getenv("PORT", "8000"))
