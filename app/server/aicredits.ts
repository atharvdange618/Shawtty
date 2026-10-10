import fs from 'node:fs/promises';
import { config } from './config';
import { ApiError } from './errors';
import type { ReelPlan, Scene, Visual } from '../types';

const retryableStatus = new Set<number>([404, 405, 502, 503, 504]);

const baseUrlCandidates = (): string[] => {
  const urls = [config.baseUrl];
  if (config.fallbackBaseUrl && config.fallbackBaseUrl !== config.baseUrl) {
    urls.push(config.fallbackBaseUrl);
  }
  return urls;
};

type ErrorBody = { error?: { message?: string }; message?: string };

const readErrorBody = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as ErrorBody;
    return json.error?.message || json.message || text;
  } catch {
    return text.slice(0, 600);
  }
};

type PostJsonOptions = { expectBinary?: boolean };

// Overloads keep the binary (speech) call typed as Buffer and the JSON call
// typed as the caller's response shape, without leaking `any` at call sites.
function postJson<T>(
  path: string,
  body: unknown,
  options?: { expectBinary?: false },
): Promise<T>;
function postJson(
  path: string,
  body: unknown,
  options: { expectBinary: true },
): Promise<Buffer>;
async function postJson(
  path: string,
  body: unknown,
  { expectBinary = false }: PostJsonOptions = {},
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error('Missing AICREDITS_API_KEY in .env.');
  }

  const bodyRecord = (body ?? {}) as { model?: string; voice?: string };
  let lastError: unknown = null;

  for (const baseUrl of baseUrlCandidates()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const message = await readErrorBody(response);
        const error = new ApiError(
          `AICredits ${response.status} from ${baseUrl}${path} (model=${bodyRecord.model || 'n/a'} voice=${bodyRecord.voice || 'n/a'}): ${message}`,
          {
            status: response.status,
            detail: {
              baseUrl,
              path,
              model: bodyRecord.model,
              voice: bodyRecord.voice,
            },
          },
        );
        lastError = error;

        if (retryableStatus.has(response.status)) {
          continue;
        }

        throw error;
      }

      if (expectBinary) {
        return Buffer.from(await response.arrayBuffer());
      }

      return response.json();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('fetch failed')) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(`AICredits request failed for ${path}.`);
}

export type BulbulVersion = 'v2' | 'v3';

export const BULBUL_V2_SPEAKERS = new Set<string>([
  'anushka',
  'abhilash',
  'manisha',
  'vidya',
  'arya',
  'karun',
  'hitesh',
]);

export const BULBUL_V3_SPEAKERS = new Set<string>([
  'aditya', 'ritu', 'ashutosh', 'priya', 'neha', 'rahul', 'pooja',
  'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya',
  'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan',
  'shubh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani',
  'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan',
  'soham', 'rupali',
]);

export const DEFAULT_VOICE_BY_MODEL: Record<BulbulVersion, string> = {
  v2: 'anushka',
  v3: 'shubh',
};

// Known-invalid voices that users commonly set: OpenAI voices and
// legacy Sarvam names. Kept for a clearer warning message.
const KNOWN_INVALID_FOR_BULBUL = new Set<string>([
  'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
  'meera', 'diya',
]);

const detectBulbulVersion = (model?: string): BulbulVersion => {
  const normalized = String(model || '').toLowerCase();
  if (normalized.includes('v3')) return 'v3';
  if (normalized.includes('v2')) return 'v2';
  return 'v3';
};

export const OPENAI_TTS_VOICES = new Set<string>(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

export type ResolvedVoice = {
  voice: string;
  version: 'openai' | BulbulVersion;
  fallbackUsed: boolean;
};

export const resolveSpeechVoice = (model: string, voice: string): ResolvedVoice => {
  const requested = String(voice || '').trim().toLowerCase();

  if (String(model || '').toLowerCase().startsWith('openai/')) {
    if (OPENAI_TTS_VOICES.has(requested)) {
      return { voice: requested, version: 'openai', fallbackUsed: false };
    }
    console.warn(`[speech] Voice '${requested}' is not valid for ${model}; falling back to 'alloy'.`);
    return { voice: 'alloy', version: 'openai', fallbackUsed: true };
  }

  const version = detectBulbulVersion(model);
  const allowed = version === 'v2' ? BULBUL_V2_SPEAKERS : BULBUL_V3_SPEAKERS;
  const fallback = DEFAULT_VOICE_BY_MODEL[version];

  if (allowed.has(requested)) {
    return { voice: requested, version, fallbackUsed: false };
  }

  if (requested && (KNOWN_INVALID_FOR_BULBUL.has(requested) || requested)) {
    console.warn(
      `[speech] Speaker '${requested}' is not valid for bulbul:${version}; falling back to '${fallback}'.`,
    );
  }

  return { voice: fallback, version, fallbackUsed: true };
};

const extractJson = (content: string): Record<string, unknown> => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a JSON object.');
  }

  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
};

const clampText = (value: unknown, maxLength: number): string => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const isHex = (value: unknown): boolean => /^#[0-9a-f]{6}$/i.test(String(value || ''));

const VISUALS = new Set<Visual>(['orbit', 'bars', 'timeline', 'cards', 'pulse']);
const FALLBACK_VISUALS: Visual[] = ['orbit', 'bars', 'cards'];
const FALLBACK_ACCENTS = ['#35d6ff', '#ffcc66', '#ff6b8a'];

type RawScene = {
  kicker?: unknown;
  headline?: unknown;
  body?: unknown;
  visual?: unknown;
  accent?: unknown;
  durationWeight?: unknown;
};

const normalizeScene = (scene: unknown, index: number): Scene => {
  const raw = (scene ?? {}) as RawScene;
  const visual = VISUALS.has(raw.visual as Visual)
    ? (raw.visual as Visual)
    : FALLBACK_VISUALS[index % 3];

  return {
    kicker: clampText(raw.kicker || `Scene ${index + 1}`, 28),
    headline: clampText(raw.headline || 'Key idea', 54),
    body: clampText(raw.body || 'A concise supporting thought for this beat.', 110),
    visual,
    accent: isHex(raw.accent) ? String(raw.accent) : FALLBACK_ACCENTS[index % 3],
    durationWeight: Math.max(0.5, Math.min(3, Number(raw.durationWeight) || 1)),
  };
};

const fallbackScenes = (prompt: string): Scene[] => [
  {
    kicker: 'Idea',
    headline: 'Turn the prompt into a clear reel',
    body: clampText(prompt, 100),
    visual: 'orbit',
    accent: '#35d6ff',
    durationWeight: 1,
  },
  {
    kicker: 'Motion',
    headline: 'Use clean animated beats',
    body: 'Each section gets readable text, energetic motion, and a simple visual metaphor.',
    visual: 'cards',
    accent: '#ffcc66',
    durationWeight: 1,
  },
  {
    kicker: 'Voice',
    headline: 'Sync visuals to narration',
    body: 'Speech duration drives the timeline so the final reel feels locked together.',
    visual: 'pulse',
    accent: '#ff6b8a',
    durationWeight: 1,
  },
];

// Measured from openai/tts-1 (alloy) output: 2.42-2.64 words per second.
const WORDS_PER_SECOND = 2.5;
// jobs.ts adds this much silence after the voice.
export const TAIL_SECONDS = 0.6;

// "20-second", "30 sec", "45s", "1 minute", "1.5 min". First match wins.
// Values outside 5-90s (the composition's clamp) are ignored, e.g. "1990s".
export const extractTargetSeconds = (prompt: string): number | null => {
  const match = String(prompt).match(/(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?)\b/i);
  if (!match) return null;
  const seconds = Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1);
  return seconds >= 5 && seconds <= 90 ? seconds : null;
};

export const wordBudgetFor = (seconds: number): number =>
  Math.round((seconds - TAIL_SECONDS) * WORDS_PER_SECOND);

type ChatCompletionResponse = {
  model?: string;
  usage?: unknown;
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string };
  }>;
};

export const generateReelPlan = async (prompt: string): Promise<ReelPlan> => {
  const targetSeconds = extractTargetSeconds(prompt);
  const wordBudget = targetSeconds ? wordBudgetFor(targetSeconds) : null;

  const system = [
    'You are a senior motion graphics producer for short vertical reels.',
    'Return strict JSON only. Do not return markdown or code fences.',
    'Build a concise narration and 4 to 6 animated scenes for a 9:16 motion-graphics video.',
    'Keep scene text short enough for mobile screens.',
    'Allowed visual values: orbit, bars, timeline, cards, pulse.',
    'Use vivid but professional accent colors as 6-digit hex values.',
    'The narration should be under 900 characters and should match the scene order.',
    wordBudget
      ? `The voiceover speaks about ${WORDS_PER_SECOND} words per second, so the narration must be exactly about ${wordBudget} words (never fewer than ${wordBudget - 3}, never more than ${wordBudget + 3}) to fill ${targetSeconds} seconds. Count the words before answering.`
      : '',
    'What the renderer always does (never list these as unsupported): clean flat vector illustration style,',
    'kinetic typography (sticker kicker slam, word-by-word headline rise), smooth slide-fade scene transitions,',
    'ambient motion, background music with sound effects, and one AI voice reading the narration.',
    'Color palette requests are supported: express them through the scene accent colors and style.palette.',
    'Tone requests (punchy, friendly, calm) are supported through the narration wording.',
    'The only visuals are these five animated vignettes: orbit = phone with orbiting app chips,',
    'bars = growing bar dashboard, timeline = path with milestones, cards = chat bubbles, pulse = play button with radiating rings.',
    'It cannot draw characters or people with emotions, split screens or side-by-side layouts, topic-specific illustrations',
    '(e.g. a thermometer, a uterus, a car), photos, or change the voice itself (accent, gender, emotion).',
    'List every instruction from the prompt that falls in that cannot-do list in "unsupported", as short phrases. Use [] when everything is supported.',
    'Never describe an unsupported visual in scene text as if it were on screen (no "Meet Sarah, looking confused").',
  ].filter(Boolean).join(' ');

  const user = [
    'Create a motion-graphics reel plan for this prompt:',
    prompt,
    '',
    'JSON schema:',
    '{"title":"string","narration":"string","scenes":[{"kicker":"string","headline":"string","body":"string","visual":"orbit|bars|timeline|cards|pulse","accent":"#RRGGBB","durationWeight":1}],"style":{"mood":"string","palette":["#RRGGBB"]},"unsupported":["string"]}',
  ].join('\n');

  const response = await postJson<ChatCompletionResponse>('/chat/completions', {
    model: config.videoModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.75,
    // Reasoning models count hidden reasoning tokens against this budget
    // (~1100 observed), so leave room for both reasoning and the JSON plan.
    max_tokens: 6000,
    response_format: { type: 'json_object' },
  });

  const choice = response.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `Plan generation hit max_tokens (model=${response.model || config.videoModel}, usage=${JSON.stringify(response.usage)}); JSON was truncated.`,
    );
  }

  const content = choice?.message?.content;
  if (!content) {
    throw new Error('AICredits chat response did not include message content.');
  }

  const raw = extractJson(content);
  const rawScenes = Array.isArray(raw.scenes) ? (raw.scenes as unknown[]).slice(0, 6) : [];
  const normalizedScenes: Scene[] = (rawScenes.length ? rawScenes : fallbackScenes(prompt)).map(
    (scene, index) => normalizeScene(scene, index),
  );
  const rawStyle = (raw.style ?? {}) as { mood?: unknown; palette?: unknown };

  return {
    title: clampText(raw.title || 'Generated Reel', 64),
    narration: clampText(raw.narration || prompt, 3900),
    scenes: normalizedScenes,
    style: {
      mood: clampText(rawStyle.mood || 'crisp, kinetic, modern', 80),
      palette: Array.isArray(rawStyle.palette)
        ? (rawStyle.palette as unknown[]).filter((c): c is string => isHex(c)).slice(0, 5)
        : ['#101317', '#35d6ff', '#ffcc66', '#ff6b8a'],
    },
    targetSeconds,
    unsupported: Array.isArray(raw.unsupported)
      ? (raw.unsupported as unknown[])
          .map((item) => clampText(item, 80))
          .filter((item) => item.length > 0)
          .slice(0, 8)
      : [],
  };
};

export type GenerateSpeechOptions = {
  text: string;
  outputPath: string;
  speed?: number;
};

export const generateSpeech = async ({
  text,
  outputPath,
  speed = 1,
}: GenerateSpeechOptions): Promise<string> => {
  // Resolve through the allowlist so a stale .env value like
  // SPEECH_VOICE=alloy|meera|diya can't produce an AICredits 400.
  const { voice } = resolveSpeechVoice(config.speechModel, config.speechVoice);

  const audio = await postJson(
    '/audio/speech',
    {
      model: config.speechModel,
      input: text,
      voice,
      response_format: config.speechFormat,
      ...(speed !== 1 ? { speed } : {}),
    },
    { expectBinary: true },
  );

  if (audio.length < 1000) {
    throw new Error('Speech API returned an unexpectedly small audio file.');
  }

  await fs.writeFile(outputPath, audio);
  return outputPath;
};
