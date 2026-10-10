import fs from 'node:fs/promises';
import { config } from './config';
import { ApiError } from './errors';
import type { ReelPlan, ReelTheme, Scene, TransitionType, Visual } from '../types';

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
const FALLBACK_VISUALS: Visual[] = [
  'cinematic_character',
  'character_duo',
  'kinetic_typography',
  'cinematic_quote',
  'scarf_wind',
  'bento_grid',
  'stat_spotlight',
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

export const THEME_PALETTES: Record<ReelTheme, string[]> = {
  storytelling: ['#0D1117', '#E5A93C', '#E11D48', '#38BDF8', '#F59E0B'],
  tech: ['#08090E', '#4285F4', '#9B51E0', '#00E5FF', '#10B981'],
  education: ['#0F172A', '#10B981', '#3B82F6', '#F59E0B', '#6366F1'],
  comedy: ['#18181B', '#FACC15', '#F43F5E', '#06B6D4', '#A855F7'],
  finance: ['#0B0F12', '#10B981', '#F59E0B', '#38BDF8', '#8B5CF6'],
  lifestyle: ['#1C1917', '#FB7185', '#34D399', '#FBBF24', '#A78BFA'],
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
  const visual = VISUALS.has(rawVisual)
    ? rawVisual
    : FALLBACK_VISUALS[index % FALLBACK_VISUALS.length];

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

export const generateReelPlan = async (
  prompt: string,
  researchContext?: string,
): Promise<ReelPlan> => {
  const targetSeconds = extractTargetSeconds(prompt);
  const wordBudget = targetSeconds ? wordBudgetFor(targetSeconds) : null;
  const detectedTheme = detectThemeFromPrompt(prompt);

  const system = [
    'You are a World-Class Creative Director and Remotion Motion Graphics Producer.',
    'Your mission is to understand the soul and genre of the topic (storytelling, tech, education, comedy, finance, or lifestyle) and produce a rich, dynamic, scene-by-scene motion reel plan.',
    'Return strict JSON only. Do not return markdown code fences.',
    '',
    'CRITICAL DESIGN RULES:',
    '1. THEME & EMOTION: Determine the content theme: storytelling, tech, education, comedy, finance, or lifestyle.',
    '   - Storytelling: Cinematic narrative, dramatic quotes, character beats, warm ember/gold/midnight palette.',
    '   - Tech: High-tech obsidian, cybernetic node flows, code terminals, telemetry dials, electric cyan/violet/blue palette.',
    '   - Education: Clear structured explainer, step-by-step milestones, comparison benchmarks, clean slate/emerald palette.',
    '   - Comedy: Punchy comic stickers, speech bubbles, bold word slams, vibrant yellow/hot pink/cyan pop palette.',
    '   - Finance: Metric tickers, profit bars, luxury gold/emerald/onyx palette.',
    '   - Lifestyle: Warm coral/sage/amber, minimalist cards, inspiring affirmations.',
    '',
    '2. DYNAMIC SCENES (NOT HARDCODED, NOT FIXED COUNT):',
    '   - Do NOT restrict to 4 or 6 scenes! Plan as many scenes as the narration requires (6 to 20+ scenes depending on the script length and pacing).',
    '   - Each scene represents one crisp beat or sentence of the narration.',
    '',
    '3. VISUALLY AVAILABLE VOICE (EVERY SPOKEN BEAT VISIBLE & SYNCED):',
    '   - For EVERY scene, provide "narrationBeat" (the exact spoken sentence for that beat). The viewer MUST be able to read along with what the voice says!',
    '   - Every scene must have a UNIQUE, non-overlapping narrationBeat (8 to 16 words). Scene 1 must NEVER repeat words from Scene 0!',
    '   - The overall script "narration" is the exact sequential join of all scene narrationBeats.',
    '   - Ensure the visual elements directly reflect the spoken words.',
    '',
    '4. REMOTION MOTION & TRANSITIONS:',
    '   - Choose dynamic transitions between scenes from: slide-left, slide-right, slide-up, wipe-left, flip-top, fade.',
    '   - Visual archetypes for each scene:',
    '     * For stories / anime / characters: cinematic_character, character_duo, scarf_wind, landscape_canvas, cinematic_quote, kinetic_typography.',
    '     * For tech / code: terminal_stream, architecture_stack, neural_flow, radial_gauge.',
    '     * For explainer / metrics: bento_grid, comparison_matrix, stat_spotlight, wave_spectrum, timeline_path.',
    '     * For comedy / pop: sticker_collage, dialogue_cards, split_screen, quote_card.',
    '',
    '5. NO GENERIC SLIDESHOW BOXES FOR STORIES:',
    '   - If the topic is an emotional narrative, anime romance, or legend (e.g. Eren & Mikasa from Attack on Titan):',
    '     DO NOT use corporate bento boxes, tech cards, or flowchart diagrams!',
    '     Use cinematic character moments, landscape canvases, symbolic flowing assets (like the red scarf), and poignant quotes.',
    '',
    wordBudget
      ? `The voiceover speaks about ${WORDS_PER_SECOND} words per second, so the narration must be exactly about ${wordBudget} words (never fewer than ${wordBudget - 3}, never more than ${wordBudget + 3}) to fill ${targetSeconds} seconds. Count the words before answering.`
      : '',
  ].filter(Boolean).join('\n');

  const user = [
    'Create a genre-tailored motion-graphics reel plan for this prompt:',
    prompt,
    '',
    researchContext ? `${researchContext}\n` : '',
    'JSON schema:',
    JSON.stringify({
      title: 'string',
      theme: 'storytelling|tech|education|comedy|finance|lifestyle',
      narration: 'string',
      scenes: [
        {
          kicker: 'string',
          headline: 'string',
          body: 'string',
          narrationBeat: 'string (exact voiceover words spoken during this beat)',
          visual: 'cinematic_character|character_duo|scarf_wind|landscape_canvas|cinematic_quote|bento_grid|neural_flow|comparison_matrix|radial_gauge|architecture_stack|terminal_stream|stat_spotlight|wave_spectrum|dialogue_cards|kinetic_typography|sticker_collage|timeline_path|split_screen|quote_card',
          accent: '#RRGGBB',
          durationWeight: 1,
          transition: 'fade|slide-left|slide-right|slide-up|wipe-left|flip-top',
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
      style: {
        theme: 'storytelling|tech|education|comedy|finance|lifestyle',
        mood: 'string',
        palette: ['#RRGGBB'],
      },
      unsupported: ['string'],
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
  const rawTheme = String(
    raw.theme || (raw.style as Record<string, unknown> | undefined)?.theme || '',
  ).toLowerCase() as ReelTheme;
  const theme: ReelTheme = THEMES.has(rawTheme) ? rawTheme : detectedTheme;
  const themePalette = THEME_PALETTES[theme];

  const rawScenes = Array.isArray(raw.scenes) ? (raw.scenes as unknown[]) : [];
  const normalizedScenes: Scene[] = (
    rawScenes.length ? rawScenes : fallbackScenes(prompt, theme)
  ).map((scene, index) => normalizeScene(scene, index, theme));
  const rawStyle = (raw.style ?? {}) as { mood?: unknown; palette?: unknown };

  const joinedNarration = normalizedScenes
    .map((s) => (s.narrationBeat || s.body || '').trim())
    .filter(Boolean)
    .join(' ');

  return {
    title: clampText(raw.title || 'Generated Reel', 64),
    theme,
    narration: clampText(joinedNarration || raw.narration || prompt, 3900),
    scenes: normalizedScenes,
    style: {
      theme,
      mood: clampText(rawStyle.mood || `${theme} dynamic, cinematic, kinetic`, 80),
      palette: Array.isArray(rawStyle.palette)
        ? (rawStyle.palette as unknown[]).filter((c): c is string => isHex(c)).slice(0, 6)
        : themePalette,
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
