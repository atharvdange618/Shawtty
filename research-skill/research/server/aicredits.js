import fs from 'node:fs/promises';
import { config } from './config.js';

const retryableStatus = new Set([404, 405, 502, 503, 504]);
const baseUrlCandidates = () => {
  const urls = [config.baseUrl];
  if (config.fallbackBaseUrl && config.fallbackBaseUrl !== config.baseUrl) {
    urls.push(config.fallbackBaseUrl);
  }
  return urls;
};

const readErrorBody = async (response) => {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.message || text;
  } catch {
    return text.slice(0, 600);
  }
};

const postJson = async (path, body, { expectBinary = false } = {}) => {
  if (!config.apiKey) {
    throw new Error('Missing AICREDITS_API_KEY in .env.');
  }

  let lastError = null;

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
        const error = new Error(
          `AICredits ${response.status} from ${baseUrl}${path} (model=${body?.model || 'n/a'} voice=${body?.voice || 'n/a'}): ${message}`,
        );
        error.status = response.status;
        error.detail = { baseUrl, path, model: body?.model, voice: body?.voice };
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
      if (!String(error.message || '').includes('fetch failed')) {
        throw error;
      }
    }
  }

  throw lastError || new Error(`AICredits request failed for ${path}.`);
};

export const BULBUL_V2_SPEAKERS = new Set([
  'anushka',
  'abhilash',
  'manisha',
  'vidya',
  'arya',
  'karun',
  'hitesh',
]);

export const BULBUL_V3_SPEAKERS = new Set([
  'aditya', 'ritu', 'ashutosh', 'priya', 'neha', 'rahul', 'pooja',
  'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya',
  'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan',
  'shubh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani',
  'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan',
  'soham', 'rupali',
]);

export const DEFAULT_VOICE_BY_MODEL = {
  v2: 'anushka',
  v3: 'shubh',
};

// Known-invalid voices that users commonly set: OpenAI voices and
// legacy Sarvam names. Kept for a clearer warning message.
const KNOWN_INVALID_FOR_BULBUL = new Set([
  'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
  'meera', 'diya',
]);

const detectBulbulVersion = (model) => {
  const normalized = String(model || '').toLowerCase();
  if (normalized.includes('v3')) return 'v3';
  if (normalized.includes('v2')) return 'v2';
  return 'v3';
};

export const OPENAI_TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

export const resolveSpeechVoice = (model, voice) => {
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

const extractJson = (content) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a JSON object.');
  }

  return JSON.parse(candidate.slice(start, end + 1));
};

const clampText = (value, maxLength) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ''));

const normalizeScene = (scene, index) => {
  const visuals = new Set(['orbit', 'bars', 'timeline', 'cards', 'pulse']);
  const visual = visuals.has(scene?.visual) ? scene.visual : ['orbit', 'bars', 'cards'][index % 3];

  return {
    kicker: clampText(scene?.kicker || `Scene ${index + 1}`, 28),
    headline: clampText(scene?.headline || 'Key idea', 54),
    body: clampText(scene?.body || 'A concise supporting thought for this beat.', 110),
    visual,
    accent: isHex(scene?.accent) ? scene.accent : ['#35d6ff', '#ffcc66', '#ff6b8a'][index % 3],
    durationWeight: Math.max(0.5, Math.min(3, Number(scene?.durationWeight) || 1)),
  };
};

const fallbackScenes = (prompt) => [
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
// jobs.js adds this much silence after the voice.
export const TAIL_SECONDS = 0.6;

// "20-second", "30 sec", "45s", "1 minute", "1.5 min". First match wins.
// Values outside 5-90s (the composition's clamp) are ignored, e.g. "1990s".
export const extractTargetSeconds = (prompt) => {
  const match = String(prompt).match(/(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?)\b/i);
  if (!match) return null;
  const seconds = Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1);
  return seconds >= 5 && seconds <= 90 ? seconds : null;
};

export const wordBudgetFor = (seconds) => Math.round((seconds - TAIL_SECONDS) * WORDS_PER_SECOND);

export const generateReelPlan = async (prompt) => {
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

  const response = await postJson('/chat/completions', {
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
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, 6) : [];
  const normalizedScenes = (scenes.length ? scenes : fallbackScenes(prompt)).map(normalizeScene);

  return {
    title: clampText(raw.title || 'Generated Reel', 64),
    narration: clampText(raw.narration || prompt, 3900),
    scenes: normalizedScenes,
    style: {
      mood: clampText(raw.style?.mood || 'crisp, kinetic, modern', 80),
      palette: Array.isArray(raw.style?.palette)
        ? raw.style.palette.filter(isHex).slice(0, 5)
        : ['#101317', '#35d6ff', '#ffcc66', '#ff6b8a'],
    },
    targetSeconds,
    unsupported: Array.isArray(raw.unsupported)
      ? raw.unsupported.map((item) => clampText(item, 80)).filter(Boolean).slice(0, 8)
      : [],
  };
};

export const generateSpeech = async ({ text, outputPath, speed = 1 }) => {
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
