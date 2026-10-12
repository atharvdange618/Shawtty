import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export type AppConfig = {
  port: number;
  apiKey: string;
  baseUrl: string;
  fallbackBaseUrl: string;
  llmApiKey: string;
  llmBaseUrl: string;
  videoModel: string;
  speechModel: string;
  speechVoice: string;
  speechFormat: string;
  transcribeModel: string;
  promptMaxChars: number;
  manimServiceUrl: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT || 3000),
  // AICredits for speech/transcribe
  apiKey: process.env.AICREDITS_API_KEY || '',
  baseUrl: trimSlash(process.env.AICREDITS_BASE_URL || 'https://aicredits.in/v1'),
  fallbackBaseUrl: trimSlash(
    process.env.AICREDITS_FALLBACK_BASE_URL || 'https://api.aicredits.in/v1',
  ),
  // LiteLLM for LLM generation
  llmApiKey: process.env.LLM_API_KEY || '',
  llmBaseUrl: trimSlash(process.env.LLM_BASE_URL || 'https://litellm.vision.aivar.app/v1'),
  videoModel: process.env.VIDEO_MODEL || 'claude-opus-4.6',
  speechModel: process.env.SPEECH_MODEL || 'openai/tts-1',
  speechVoice: process.env.SPEECH_VOICE || 'alloy',
  speechFormat: process.env.SPEECH_FORMAT || 'mp3',
  transcribeModel: process.env.TRANSCRIBE_MODEL || 'openai/whisper-1',
  promptMaxChars: Number(process.env.PROMPT_MAX_CHARS || 20000),
  manimServiceUrl: trimSlash(process.env.MANIM_SERVICE_URL || 'http://localhost:8000'),
};

export type AppPaths = {
  publicDir: string;
  generatedAudioDir: string;
  reelDir: string;
};

export const paths: AppPaths = {
  publicDir: path.join(ROOT_DIR, 'public'),
  generatedAudioDir: path.join(ROOT_DIR, 'public', 'generated'),
  reelDir: path.join(ROOT_DIR, 'reel'),
};

// Single source of truth for docs/health checks (avoids hardcoded model
// names drifting between README, HARNESS.md and code).
export const SUPPORTED_SPEECH: Record<string, string> = {
  'openai/tts-1': 'alloy (default), echo, fable, onyx, nova, shimmer',
  'sarvam/bulbul-v3': 'shubh (default), aditya, ritu, priya, ... (37 voices)',
  'sarvam/bulbul-v2': 'anushka (default), abhilash, manisha, vidya, arya, karun, hitesh',
};
