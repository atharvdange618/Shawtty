import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const trimSlash = (value) => value.replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.AICREDITS_API_KEY || '',
  baseUrl: trimSlash(process.env.AICREDITS_BASE_URL || 'https://aicredits.in/v1'),
  fallbackBaseUrl: trimSlash(
    process.env.AICREDITS_FALLBACK_BASE_URL || 'https://api.aicredits.in/v1',
  ),
  videoModel: process.env.VIDEO_MODEL || 'openai/gpt-4.1-mini',
  // Speech defaults must be a compatible model + voice pair.
  // openai/tts-1 voices: alloy, echo, fable, onyx, nova, shimmer.
  // Sarvam bulbul via AICredits is currently broken: the gateway replaces every
  // voice with 'meera' and Bulbul rejects it with a 400.
  speechModel: process.env.SPEECH_MODEL || 'openai/tts-1',
  speechVoice: process.env.SPEECH_VOICE || 'alloy',
  speechFormat: process.env.SPEECH_FORMAT || 'mp3',
  promptMaxChars: Number(process.env.PROMPT_MAX_CHARS || 20000),
};

export const paths = {
  publicDir: path.join(ROOT_DIR, 'public'),
  generatedAudioDir: path.join(ROOT_DIR, 'public', 'generated'),
  reelDir: path.join(ROOT_DIR, 'reel'),
  remotionEntry: path.join(ROOT_DIR, 'remotion', 'index.jsx'),
};

// Single source of truth for docs/health checks (avoids hardcoded model
// names drifting between README, HARNESS.md and code).
export const SUPPORTED_SPEECH = {
  'openai/tts-1': 'alloy (default), echo, fable, onyx, nova, shimmer',
  'sarvam/bulbul-v3': 'shubh (default), aditya, ritu, priya, ... (37 voices)',
  'sarvam/bulbul-v2': 'anushka (default), abhilash, manisha, vidya, arya, karun, hitesh',
};
