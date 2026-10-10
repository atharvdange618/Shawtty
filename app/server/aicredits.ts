import fs from 'node:fs/promises';
import { config } from './config';
import { ApiError } from './errors';
import type { ReelPlan, ReelTheme, Scene, TimedBeat, TranscriptWord, TransitionType, Visual } from '../types';

// Transient gateway failures worth one attempt on the fallback base URL.
// 500/429 included: the gateway intermittently 500s large codegen calls and
// rate-limits bursts — a single retry saves the whole job.
const retryableStatus = new Set<number>([404, 405, 429, 500, 502, 503, 504]);

// Word-boundaried: must not match inside larger numbers (e.g. a JSON
// parse error reporting "position 25029" contains "502" — not a 502).
const TRANSIENT_RE = /(\b500\b|\b502\b|\b503\b|\b504\b|\b429\b|fetch failed|timeout|ECONNRESET)/i;

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

const VISUALS = new Set<Visual>([
  'cinematic_character',
  'character_duo',
  'scarf_wind',
  'landscape_canvas',
  'cinematic_quote',
  'bento_grid',
  'neural_flow',
  'comparison_matrix',
  'radial_gauge',
  'architecture_stack',
  'terminal_stream',
  'stat_spotlight',
  'wave_spectrum',
  'dialogue_cards',
  'kinetic_typography',
  'sticker_collage',
  'timeline_path',
  'split_screen',
  'quote_card',
  'orbit',
  'bars',
  'timeline',
  'cards',
  'pulse',
]);
// Generic fallbacks only — every entry renders fully without photos or
// topic-specific payloads, so no topic can collapse into one repeated look.
const FALLBACK_VISUALS: Visual[] = [
  'kinetic_typography',
  'bento_grid',
  'stat_spotlight',
  'quote_card',
  'comparison_matrix',
  'timeline_path',
  'split_screen',
];

const VALID_TRANSITIONS = new Set<TransitionType>([
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'wipe-left',
  'flip-top',
]);

const THEMES = new Set<ReelTheme>([
  'storytelling',
  'tech',
  'education',
  'comedy',
  'finance',
  'lifestyle',
]);

export const detectThemeFromPrompt = (prompt: string): ReelTheme => {
  const p = prompt.toLowerCase();
  if (/(?:funny|comedy|joke|meme|laugh|hilarious|satire|fun|roast|humor)/i.test(p)) return 'comedy';
  if (/(?:money|finance|stock|invest|crypto|wealth|market|profit|revenue|dollar|cash|trading|economy)/i.test(p)) return 'finance';
  if (/(?:story|journey|character|once upon|dramatic|legend|historical|biography|tale|narrative|anime|titan|eren|mikasa|love story|tragic|romance|cinematic)/i.test(p)) return 'storytelling';
  if (/(?:health|fitness|workout|wellness|lifestyle|travel|food|cooking|mindfulness|diet|meditation)/i.test(p)) return 'lifestyle';
  if (/(?:tech|ai|code|software|model|computer|algorithm|hardware|cloud|data|app|neural|developer|gemini|robot)/i.test(p)) return 'tech';
  return 'education';
};

export const extractUserColors = (prompt: string): string[] => {
  const p = prompt.toLowerCase();
  const colors: string[] = [];
  if (/\b(?:yellow|gold|amber)\b/.test(p)) colors.push('#FFE600');
  if (/\b(?:neon|lime|green|emerald)\b/.test(p)) colors.push('#E0FE10', '#00FF66');
  if (/\b(?:cyan|electric blue|aqua)\b/.test(p)) colors.push('#00F5FF');
  if (/\b(?:purple|violet|magenta)\b/.test(p)) colors.push('#A855F7', '#FF007F');
  if (/\b(?:red|crimson|ruby)\b/.test(p)) colors.push('#FF2E55');
  if (/\b(?:orange|coral|tangerine)\b/.test(p)) colors.push('#FF6B00');
  return colors;
};

export const THEME_PALETTES: Record<ReelTheme, string[]> = {
  storytelling: ['#0B0C10', '#FF2E55', '#FFB800', '#FF6B00', '#6366F1', '#EC4899'],
  tech: ['#08090E', '#E0FE10', '#00F5FF', '#FF0055', '#7928CA', '#00FF66'],
  education: ['#0A0D14', '#00F59B', '#3B82F6', '#FFE600', '#8B5CF6', '#FF3366'],
  comedy: ['#101018', '#FFE600', '#FF007F', '#00E5FF', '#FF6B00', '#76FF03'],
  finance: ['#06080A', '#00E676', '#FFD700', '#00B0FF', '#7C4DFF', '#00E5FF'],
  lifestyle: ['#0E0B14', '#FF2A85', '#FF7A00', '#00F0FF', '#FFE600', '#A855F7'],
};

type RawScene = {
  kicker?: unknown;
  headline?: unknown;
  body?: unknown;
  narrationBeat?: unknown;
  visual?: unknown;
  accent?: unknown;
  durationWeight?: unknown;
  transition?: unknown;
  visualData?: unknown;
  imageUrl?: unknown;
};

const normalizeScene = (scene: unknown, index: number, theme: ReelTheme): Scene => {
  const raw = (scene ?? {}) as RawScene;
  const rawVisual = String(raw.visual || '').trim() as Visual;
  const rawHasImage = Boolean(raw.imageUrl || ((raw.visualData ?? {}) as Record<string, unknown>).imageUrl);
  const isStoryVisual =
    rawVisual === 'cinematic_character' ||
    rawVisual === 'character_duo' ||
    rawVisual === 'scarf_wind' ||
    rawVisual === 'water_breathing' ||
    rawVisual === 'hinokami_kagura' ||
    rawVisual === 'landscape_canvas';

  // Topic-neutral rotation used when the model requests a photo-style
  // visual but no image is available. Deliberately generic — works for food,
  // health, finance, comedy, tech, and stories alike.
  const motionGraphicsFallbacks: Visual[] = [
    'kinetic_typography',
    'bento_grid',
    'stat_spotlight',
    'quote_card',
    'comparison_matrix',
    'timeline_path',
    'split_screen',
    'radial_gauge',
    'neural_flow',
  ];

  let visual: Visual;
  if (!rawHasImage && isStoryVisual && theme !== 'storytelling') {
    visual = motionGraphicsFallbacks[index % motionGraphicsFallbacks.length];
  } else if (VISUALS.has(rawVisual)) {
    visual = rawVisual;
  } else {
    visual = FALLBACK_VISUALS[index % FALLBACK_VISUALS.length];
  }

  const palette = THEME_PALETTES[theme] || THEME_PALETTES.education;
  const rawTransition = String(raw.transition || '').trim() as TransitionType;
  const transition: TransitionType | undefined = VALID_TRANSITIONS.has(rawTransition)
    ? rawTransition
    : undefined;

  const rawVd = (raw.visualData ?? {}) as Record<string, unknown>;
  const rawElements = Array.isArray(rawVd.elements) ? rawVd.elements : [];
  const rawNodes = Array.isArray(rawVd.nodes) ? rawVd.nodes : [];
  const rawBars = Array.isArray(rawVd.bars) ? rawVd.bars : [];
  const rawHighlights = Array.isArray(rawVd.highlightWords) ? rawVd.highlightWords : [];
  const rawStickers = Array.isArray(rawVd.stickers) ? rawVd.stickers : [];
  const rawBubbles = Array.isArray(rawVd.speechBubbles) ? rawVd.speechBubbles : [];

  const narrationBeat = raw.narrationBeat
    ? clampText(raw.narrationBeat, 240)
    : clampText(raw.body || raw.headline, 240);

  return {
    kicker: clampText(raw.kicker || `Beat ${index + 1}`, 28),
    headline: clampText(raw.headline || 'Key idea', 64),
    body: clampText(raw.body || narrationBeat, 180),
    narrationBeat,
    visual,
    accent: isHex(raw.accent) ? String(raw.accent) : palette[(index + 1) % palette.length],
    durationWeight: Math.max(0.5, Math.min(3, Number(raw.durationWeight) || 1)),
    transition,
    visualData: {
      tag: rawVd.tag ? clampText(rawVd.tag, 32) : undefined,
      metric: rawVd.metric ? clampText(rawVd.metric, 24) : undefined,
      metricLabel: rawVd.metricLabel ? clampText(rawVd.metricLabel, 48) : undefined,
      badge: rawVd.badge ? clampText(rawVd.badge, 32) : undefined,
      quote: rawVd.quote ? clampText(rawVd.quote, 140) : undefined,
      quoteAuthor: rawVd.quoteAuthor ? clampText(rawVd.quoteAuthor, 40) : undefined,
      stickers: rawStickers.map((s) => clampText(s, 24)).filter(Boolean).slice(0, 4),
      speechBubbles: rawBubbles.slice(0, 3).map((b) => {
        const item = (b ?? {}) as Record<string, unknown>;
        return {
          text: clampText(item.text, 80),
          side: item.side === 'right' ? ('right' as const) : ('left' as const),
          speaker: item.speaker ? clampText(item.speaker, 20) : undefined,
        };
      }),
      elements: rawElements.slice(0, 4).map((rawEl) => {
        const el = (rawEl ?? {}) as Record<string, unknown>;
        return {
          label: clampText(el.label || '', 30),
          value: clampText(el.value || '', 20),
          detail: clampText(el.detail || '', 50),
          badge: clampText(el.badge || '', 20),
          status: clampText(el.status || '', 16),
          percent: typeof el.percent === 'number' ? el.percent : undefined,
        };
      }),
      nodes: rawNodes.slice(0, 4).map((rawN) => {
        const n = (rawN ?? {}) as Record<string, unknown>;
        return {
          label: clampText(n.label || '', 30),
          sub: clampText(n.sub || '', 35),
          icon: clampText(n.icon || '', 10),
        };
      }),
      bars: rawBars.slice(0, 4).map((rawB) => {
        const b = (rawB ?? {}) as Record<string, unknown>;
        return {
          label: clampText(b.label || '', 30),
          value: Math.max(0, Math.min(100, Number(b.value) || 50)),
          highlight: Boolean(b.highlight),
        };
      }),
      codeSnippet: rawVd.codeSnippet ? String(rawVd.codeSnippet).slice(0, 300) : undefined,
      highlightWords: rawHighlights.map((w) => clampText(w, 24)).filter(Boolean).slice(0, 5),
      ambientColor: isHex(rawVd.ambientColor) ? String(rawVd.ambientColor) : undefined,
      imageUrl: typeof (raw.imageUrl || rawVd.imageUrl) === 'string' ? String(raw.imageUrl || rawVd.imageUrl).trim() : undefined,
      characterName: rawVd.characterName ? clampText(rawVd.characterName, 40) : undefined,
      characterQuote: rawVd.characterQuote ? clampText(rawVd.characterQuote, 140) : undefined,
      effect: rawVd.effect === 'red_scarf_wind' || rawVd.effect === 'petals' || rawVd.effect === 'embers' ? (rawVd.effect as 'red_scarf_wind' | 'petals' | 'embers') : undefined,
    },
    imageUrl: typeof (raw.imageUrl || rawVd.imageUrl) === 'string' ? String(raw.imageUrl || rawVd.imageUrl).trim() : undefined,
  };
};

const fallbackScenes = (prompt: string, theme: ReelTheme): Scene[] => {
  const palette = THEME_PALETTES[theme] || THEME_PALETTES.education;
  return [
    {
      kicker: 'Hook',
      headline: clampText(prompt, 54),
      body: 'Every great concept begins with a compelling observation.',
      narrationBeat: 'Every great concept begins with a compelling observation.',
      visual: 'kinetic_typography',
      accent: palette[1],
      durationWeight: 1,
      transition: 'fade',
      visualData: {
        highlightWords: ['great', 'concept'],
      },
    },
    {
      kicker: 'Breakdown',
      headline: 'The Core Mechanism',
      body: 'Understanding the key elements that make this work.',
      narrationBeat: 'Understanding the key elements that make this work.',
      visual: 'bento_grid',
      accent: palette[2],
      durationWeight: 1,
      transition: 'slide-left',
      visualData: {
        metric: '10x',
        metricLabel: 'Impact Factor',
        badge: 'KEY INSIGHT',
        elements: [
          { label: 'Foundation', value: 'Step 1', detail: 'Essential principles' },
          { label: 'Execution', value: 'Step 2', detail: 'Real-world application' },
        ],
      },
    },
    {
      kicker: 'Comparison',
      headline: 'Before vs After',
      body: 'See the contrast between traditional methods and modern approaches.',
      narrationBeat: 'See the contrast between traditional methods and modern approaches.',
      visual: 'comparison_matrix',
      accent: palette[3],
      durationWeight: 1,
      transition: 'slide-up',
      visualData: {
        bars: [
          { label: 'Modern Approach', value: 94, highlight: true },
          { label: 'Legacy Method', value: 46, highlight: false },
        ],
      },
    },
    {
      kicker: 'Takeaway',
      headline: 'The Bottom Line',
      body: 'Apply this insight to achieve results faster than ever.',
      narrationBeat: 'Apply this insight to achieve results faster than ever.',
      visual: 'stat_spotlight',
      accent: palette[1],
      durationWeight: 1,
      transition: 'wipe-left',
      visualData: {
        metric: '100%',
        metricLabel: 'Actionable Takeaway',
        badge: 'SUMMARY',
      },
    },
  ];
};

// Measured from openai/tts-1 (alloy) output: 2.42-2.64 words per second.
const WORDS_PER_SECOND = 2.5;
// jobs.ts adds this much silence after the voice.
export const TAIL_SECONDS = 0.6;

// "20-second", "30 sec", "45s", "1 minute", "1.5 min". First match wins.
// Values outside 5-180s (the composition's clamp) are ignored, e.g. "1990s".
export const extractTargetSeconds = (prompt: string): number | null => {
  const match = String(prompt).match(/(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?)\b/i);
  if (!match) return null;
  const seconds = Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1);
  return seconds >= 5 && seconds <= 180 ? seconds : null;
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

export type VoiceScriptResult = {
  title: string;
  theme: ReelTheme;
  script: string;
  mood: string;
  palette: string[];
};

export const generateVoiceScript = async (
  prompt: string,
  researchContext?: string,
): Promise<VoiceScriptResult> => {
  const targetSeconds = extractTargetSeconds(prompt);
  const wordBudget = targetSeconds ? wordBudgetFor(targetSeconds) : 120;
  const detectedTheme = detectThemeFromPrompt(prompt);

  const system = [
    'You are a World-Class Viral Short-Form Video Producer and Scriptwriter (style of Fireship, Vox, Kurzgesagt, Apple keynotes).',
    'Your mission: write a high-voltage, spoken-for-video narration script for a modern vertical video reel (YouTube Shorts / TikTok / Instagram Reels).',
    'Return strict JSON only. Do not return markdown code fences.',
    '',
    'CRITICAL SCRIPTWRITING RULES:',
    '1. HOOK IN THE FIRST 3 SECONDS: Start with a gripping question, shocking contrast, or high-stakes statement.',
    '2. HIGH-ENERGY & PUNCHY: Use concise, rhythmic sentences. No passive voice, no academic fluff, no corporate filler words.',
    '3. CLEAR CONCEPT CONTRASTS: For explainer topics (e.g. AI vs AGI), clearly contrast narrow task-specific tools with general autonomous human-level intelligence.',
    `4. EXACT WORD BUDGET: The voiceover speaks at ~2.5 words/second. The script must be approximately ${wordBudget} words (between ${wordBudget - 5} and ${wordBudget + 5} words) to perfectly fill ${targetSeconds || 45} seconds. Count words accurately before answering.`,
    '5. NO STAGE DIRECTIONS OR BRACKETS: Return ONLY the exact words to be spoken aloud by the voice actor.',
  ].join('\n');

  const user = [
    'Write a viral short-form voiceover script for this reel prompt:',
    prompt,
    '',
    researchContext ? `Topic Research Insights:\n${researchContext}\n` : '',
    'JSON schema:',
    JSON.stringify({
      title: 'string (short punchy title)',
      theme: 'storytelling|tech|education|comedy|finance|lifestyle',
      script: 'string (the exact spoken narration words)',
      mood: 'string (e.g. high-energy futuristic, cinematic tragic, fast-paced tech)',
      palette: ['#RRGGBB', '#RRGGBB', '#RRGGBB', '#RRGGBB', '#RRGGBB', '#RRGGBB'],
    }),
  ].join('\n');

  const response = await postJson<ChatCompletionResponse>('/chat/completions', {
    model: config.videoModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('AICredits response missing message content.');
  const raw = extractJson(content);
  const rawTheme = String(raw.theme || '').toLowerCase() as ReelTheme;
  const theme = THEMES.has(rawTheme) ? rawTheme : detectedTheme;
  const script = String(raw.script || prompt).trim();

  return {
    title: clampText(raw.title || 'Generated Reel', 64),
    theme,
    script,
    mood: clampText(raw.mood || `${theme} dynamic, kinetic`, 80),
    palette: (() => {
      const userColors = extractUserColors(prompt);
      const basePalette = Array.isArray(raw.palette)
        ? (raw.palette as unknown[]).filter((c): c is string => isHex(c)).slice(0, 6)
        : THEME_PALETTES[theme];
      const merged = [...userColors, ...basePalette];
      return Array.from(new Set(merged)).slice(0, 6);
    })(),
  };
};

export const choreographScenes = async ({
  prompt,
  title,
  theme,
  script,
  speechSeconds,
  researchContext,
  beats,
}: {
  prompt: string;
  title: string;
  theme: ReelTheme;
  script: string;
  speechSeconds: number;
  researchContext?: string;
  /** Fixed timestamped beats from the real voice transcript. When provided, the LLM designs exactly one scene per beat — it does NOT re-cut the script. */
  beats?: TimedBeat[];
}): Promise<Scene[]> => {
  // Deliberate pacing: cuts average ~3.5-4.5s per shot so viewers can
  // actually process each idea — never more scenes than the audio can hold
  // at >=2.5s per beat (faster becomes an unreadable slideshow).
  // With transcript beats, the count is already fixed by the voice itself.
  const maxSupportable = Math.max(3, Math.min(24, Math.floor(speechSeconds / 2.5)));
  const targetSceneCount = beats
    ? beats.length
    : Math.max(4, Math.min(maxSupportable, Math.round(speechSeconds / 3.6)));

  const beatLedger = beats
    ? [
        '',
        'FIXED TIMESTAMPED BEATS — the voiceover was already recorded and force-aligned.',
        `You MUST return EXACTLY ${beats.length} scenes, in this order, one per beat:`,
        ...beats.map(
          (b, i) =>
            `Beat ${i + 1} [${b.start.toFixed(2)}s–${b.end.toFixed(2)}s]: "${b.text}"`,
        ),
        'Copy each beat VERBATIM into that scene\'s "narrationBeat". Do not merge, split, reorder, or reword beats.',
        '',
      ].join('\n')
    : '';

  const system = [
    'You are an Elite Motion Graphics Art Director and Video Editor.',
    `You have a finished voiceover script of EXACT duration ${speechSeconds.toFixed(1)} seconds.`,
    beats
      ? `Your job is to design EXACTLY ${beats.length} VISUAL SHOTS — one per fixed timestamped beat below. The cuts are locked to the recorded voice; you choose what each locked cut SHOWS.`
      : `Your job is to cut this script into ${targetSceneCount} RAPID, HIGH-DENSITY, DYNAMIC VISUAL SHOTS.`,
    'Return strict JSON only. Do not return markdown code fences.',
    '',
    beatLedger,
    'CRITICAL VIDEO EDITING & MOTION RULES:',
    beats
      ? `1. LOCKED CUTS (THE TIMESTAMPS ARE LAW):`
      : `1. DELIBERATE PACING (NO SLIDESHOWS, NO FLASH FRAMES):`,
    beats
      ? `   - Return EXACTLY ${beats.length} scenes matching the beats above, in order. Scene N visualizes ONLY what beat N says — read its words and illustrate them literally.`
      : `   - A watchable reel holds each idea ~3.5 to 4.5 seconds so viewers can process it. Cut this script into approximately ${targetSceneCount} visual shots (between ${Math.max(4, targetSceneCount - 2)} and ${targetSceneCount + 2} scenes).`,
    '   - Every scene holds 4-14 spoken words. NEVER group 15+ words into one slow scene; NEVER emit 1-2 word flash scenes.',
    '2. VISUAL DIVERSITY (ANTI-REPETITION — STRICTLY ENFORCED):',
    '   - NEVER use the same visual twice in a row. Rotate across at least 4 different visuals per reel.',
    '   - Match the visual to THIS topic (not to tech by default):',
    '     - kinetic_typography: 2-5 word hook slammed huge (opening + punchlines).',
    '     - bento_grid / stat_spotlight: stats, numbers, facts, impacts.',
    '     - comparison_matrix / split_screen: before-vs-after, myth-vs-fact, option A vs B.',
    '     - timeline_path: sequences, journeys, steps, evolution.',
    '     - quote_card: memorable one-liner or verdict.',
    '     - dialogue_cards / sticker_collage: reactions, voices, comedy beats.',
    '     - neural_flow / radial_gauge / architecture_stack / terminal_stream: ONLY for genuinely technical topics with real data payloads.',
    '     - cinematic_* / landscape_canvas: ONLY when a photo is supplied for this scene.',
    '   - Copy the topic vocabulary into visualData (elements/bars/nodes/metric). NEVER write AGI/AI-brain placeholder copy for non-tech topics.',
    beats
      ? '3. VOICE SYNC (ALREADY SOLVED — DO NOT TOUCH):'
      : '3. VOICE SYNC (SERVER-ENFORCED, YOU PROVIDE HINTS):',
    beats
      ? '   - "narrationBeat" MUST be the beat text copied word-for-word. The timestamps already sync audio, mouth, and cuts.'
      : '   - For EVERY scene, provide "narrationBeat": roughly which consecutive words are spoken during that cut (4-14 words).',
    beats
      ? '   - NEVER invent words outside the beats. If a beat is a personal line ("my sister"), use kinetic_typography, quote_card, or dialogue_cards — never a data chart.'
      : '   - The server re-partitions beats onto the script EXACTLY, so keep beats in script order and proportional — do not invent words outside the script.',
    '4. TEXT DISCIPLINE (OVERFLOW KILLS READABILITY):',
    '   - kicker: 1-3 words. headline: 2-8 words, a LABEL — never the full spoken sentence.',
    '   - body: 1 short sentence (<=28 words) supporting the visual.',
    '   - NEVER set headline identical to narrationBeat (no double text on screen).',
    '5. RICH MOTION GRAPHICS DATA (EVERY DATA VISUAL MUST EAT REAL WORDS):',
    '   - For EVERY bento_grid / stat_spotlight / comparison_matrix / split_screen / radial_gauge / timeline_path / architecture_stack / neural_flow scene, visualData MUST be copied from that scene\'s beat words: numbers ("9 hours", "90%"), named effects ("shrinking attention", "spiking anxiety"), steps in order.',
    '   - BANNED placeholder copy: "Key stat", "10x", "92%", "100%", "Key factor", "Metric", "Option", "Alternative", "Baseline", "Before/After" as bare labels, empty detail strings. A box with no real words is a failed scene.',
    '   - metric = a number actually SPOKEN in the beat (with its unit) or omit metric and use elements/bars instead. bars need ≥2 labeled entries; elements need label AND value/detail filled from the beat.',
    '   - If a beat has no numbers and no listable facts, do NOT force a data visual — use kinetic_typography, quote_card, or dialogue_cards for that beat.',
    '6. TRANSITION DISCIPLINE (2–3 PER VIDEO, REUSED RHYTHMICALLY): pick at most three transition types for the whole reel (e.g. slide-left + fade, or wipe-left + flip-top + fade) and reuse them — random variety looks amateur. Direction-consistent: forward motion always enters from the same side. Calm beats use fade; app-like steps use slide; section changes use wipe; playful comparisons use flip-top.',
    '7. LIVING GRAPHICS (NO ANIMATED SLIDESHOW): every scene must MOVE for its whole duration — bars grow AND count, rings fill, lines draw, numbers tick, cards stagger in then breathe. A data visual whose cells are only static short text with nothing countable, fillable, or drawable is a FAILED scene — use kinetic_typography for text-only beats. Prefer visuals with built-in motion (comparison_matrix, radial_gauge, timeline_path, stat_spotlight, neural_flow) whenever the beat has anything measurable, sequential, or ranked.',
    '8. SELF-CHECK BEFORE RESPONDING (the reviewer rejects violations, so get it right first time): no adjacent duplicate visuals; every number in visualData appears verbatim in its beat; comparison_matrix ships ≥2 bars; metrics are ≤5 words; no headline identical to its beat; at most three transition types in the whole reel; every data visual has label AND value/detail filled from the beat — never empty strings.',
  ].join('\n');

  const user = [
    'Choreograph rapid-paced motion graphics scenes for this script:',
    `Title: ${title}`,
    `Theme: ${theme}`,
    `Exact Duration: ${speechSeconds.toFixed(1)}s`,
    `Target Scene Count: ${targetSceneCount} rapid visual shots`,
    '',
    `Complete Voiceover Script:\n"${script}"`,
    '',
    researchContext ? `Topic Research Insights:\n${researchContext}\n` : '',
    'JSON schema:',
    JSON.stringify({
      scenes: [
        {
          kicker: 'string',
          headline: 'string',
          body: 'string',
          narrationBeat: 'string (which consecutive script words this cut covers, 4-14 words, in order)',
          visual: 'kinetic_typography|neural_flow|split_screen|comparison_matrix|radial_gauge|terminal_stream|architecture_stack|stat_spotlight|timeline_path|bento_grid|cinematic_character|character_duo|scarf_wind|water_breathing|hinokami_kagura|cinematic_quote',
          accent: '#RRGGBB',
          durationWeight: 1,
          transition: 'wipe-left|slide-up|slide-left|slide-right|flip-top|fade',
          visualData: {
            tag: 'string',
            metric: 'string',
            metricLabel: 'string',
            badge: 'string',
            quote: 'string',
            quoteAuthor: 'string',
            stickers: ['string'],
            speechBubbles: [{ text: 'string', side: 'left|right', speaker: 'string' }],
            elements: [{ label: 'string', value: 'string', detail: 'string', badge: 'string' }],
            nodes: [{ label: 'string', sub: 'string', icon: 'string' }],
            bars: [{ label: 'string', value: 95, highlight: true }],
            codeSnippet: 'string',
            highlightWords: ['keyword1', 'keyword2'],
            ambientColor: '#RRGGBB',
          },
        },
      ],
    }),
  ].join('\n');

  const response = await postJson<ChatCompletionResponse>('/chat/completions', {
    model: config.videoModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.75,
    max_tokens: 6000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('AICredits response missing message content.');
  const raw = extractJson(content);
  const rawScenes = Array.isArray(raw.scenes) ? (raw.scenes as unknown[]) : [];

  return (rawScenes.length ? rawScenes : fallbackScenes(prompt, theme)).map((scene, index) =>
    normalizeScene(scene, index, theme),
  );
};

export type GenerateVisualCodeOptions = {
  system: string;
  user: string;
};

type VisualCodeResponse = { code?: unknown };

export type VisualCodeResult = { code: string | null; error?: string };

const isBalanceError = (message: string): boolean =>
  /402|insufficient balance|budget exceeded/i.test(message);

/**
 * Execute one bespoke-visual codegen call. Retries ONCE on transient gateway
 * failures — but NEVER on an empty wallet: a 402 fails fast with a top-up
 * message instead of burning more attempts. Never throws; the reason travels
 * in `error` so jobs fail with the truth, not a generic message.
 */
export const generateVisualCode = async ({
  system,
  user,
}: GenerateVisualCodeOptions): Promise<VisualCodeResult> => {
  const body = {
    model: config.videoModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.5,
    // Detailed multi-beat components are long — a low ceiling truncates the
    // JSON mid-code (fatal, unrecoverable). gpt-4.1-mini allows 32k output.
    max_tokens: 16000,
    response_format: { type: 'json_object' },
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await postJson<ChatCompletionResponse>('/chat/completions', body);
      const content = response.choices?.[0]?.message?.content;
      if (!content) return { code: null, error: 'empty response from model' };
      const raw = extractJson(content) as VisualCodeResponse;
      const code = String(raw.code || '').trim();
      if (code.length >= 200) return { code };
      console.warn('[codegen] LLM returned too little code — treating as failure.');
      return { code: null, error: 'model returned too little code' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[codegen] LLM call failed (attempt ${attempt}/2): ${message.slice(0, 300)}.`);
      if (isBalanceError(message)) {
        return { code: null, error: 'AICredits balance exhausted — top up the account and resubmit (no further attempts will succeed until then)' };
      }
      if (attempt === 2 || !TRANSIENT_RE.test(message)) return { code: null, error: message.slice(0, 300) };
    }
  }
  return { code: null, error: 'unknown codegen failure' };
};

export const generateReelPlan = async (
  prompt: string,
  researchContext?: string,
): Promise<ReelPlan> => {
  const targetSeconds = extractTargetSeconds(prompt);
  const scriptData = await generateVoiceScript(prompt, researchContext);
  const estimatedSeconds =
    targetSeconds ||
    Math.max(15, Math.round(scriptData.script.split(/\s+/).length / WORDS_PER_SECOND));

  const scenes = await choreographScenes({
    prompt,
    title: scriptData.title,
    theme: scriptData.theme,
    script: scriptData.script,
    speechSeconds: estimatedSeconds,
    researchContext,
  });

  return {
    title: scriptData.title,
    theme: scriptData.theme,
    narration: scriptData.script,
    scenes,
    style: {
      theme: scriptData.theme,
      mood: scriptData.mood,
      palette: scriptData.palette,
    },
    targetSeconds,
    unsupported: [],
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

type WhisperVerboseResponse = {
  text?: string;
  duration?: number;
  words?: Array<{ word?: string; start?: number; end?: number }>;
};

/**
 * Transcribe our own TTS audio with word-level timestamps (Whisper
 * verbose_json). This is what makes scenes land on the words actually
 * spoken instead of on the LLM's guesses.
 *
 * Returns null on ANY failure (gateway has no transcription endpoint, model
 * rejected, network error, garbage output) — the caller falls back to
 * syllable-estimated timings and the reel still renders.
 */
export type TranscribeResult = { words: TranscriptWord[] | null; error?: string };

export const transcribeWords = async (audioPath: string): Promise<TranscribeResult> => {
  try {
    if (!config.apiKey) return { words: null, error: 'missing API key' };
    const audio = await fs.readFile(audioPath);
    if (audio.length < 1000) return { words: null, error: 'audio file too small' };

    for (const baseUrl of baseUrlCandidates()) {
      try {
        const form = new FormData();
        form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'narration.mp3');
        form.append('model', config.transcribeModel);
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'word');

        const response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
        });
        if (!response.ok) {
          if (retryableStatus.has(response.status)) continue;
          const err = `${response.status} from ${baseUrl}: ${(await readErrorBody(response)).slice(0, 200)}`;
          console.warn(`[transcribe] ${err}`);
          return { words: null, error: err };
        }
        const data = (await response.json()) as WhisperVerboseResponse;
        const words = (data.words || [])
          .filter((w) => typeof w.word === 'string' && w.word.trim().length > 0)
          .map((w) => ({
            word: String(w.word).trim(),
            start: Math.max(0, Number(w.start) || 0),
            end: Math.max(0, Number(w.end) || 0),
          }))
          .filter((w) => w.end >= w.start);
        if (words.length < 3) {
          // Most common cause: the gateway returns plain text with no word
          // timestamps (verbose_json granularity unsupported) — timing falls
          // back to syllabic estimates, which still keeps cuts on breaths.
          const hasText = typeof data.text === 'string' && data.text.trim().length > 0;
          const err = hasText
            ? 'transcript has text but no word timestamps (granularity unsupported)'
            : 'too few words returned';
          console.warn(`[transcribe] ${err}, ignoring.`);
          return { words: null, error: err };
        }
        return { words };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('fetch failed')) continue;
        console.warn(`[transcribe] failed: ${message.slice(0, 200)}`);
        return { words: null, error: message.slice(0, 200) };
      }
    }
    return { words: null, error: 'all transcription endpoints unreachable' };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    console.warn(`[transcribe] failed: ${message}`);
    return { words: null, error: message };
  }
};
