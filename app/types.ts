// Shared domain types for the reel pipeline (server + Remotion).
//
// Declared as `type` aliases, not `interface`: Remotion constrains composition
// props to `Record<string, unknown>`, and only type literals get an implicit
// index signature, so interfaces would fail that assignment.
export type ReelTheme =
  | 'storytelling'
  | 'tech'
  | 'education'
  | 'comedy'
  | 'finance'
  | 'lifestyle';

export type TransitionType =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'wipe-left'
  | 'flip-top';

export type Visual =
  | 'cinematic_character'
  | 'landscape_canvas'
  | 'character_duo'
  | 'scarf_wind'
  | 'water_breathing'
  | 'hinokami_kagura'
  | 'cinematic_quote'
  | 'bento_grid'
  | 'neural_flow'
  | 'comparison_matrix'
  | 'radial_gauge'
  | 'architecture_stack'
  | 'terminal_stream'
  | 'stat_spotlight'
  | 'wave_spectrum'
  | 'dialogue_cards'
  | 'kinetic_typography'
  | 'sticker_collage'
  | 'timeline_path'
  | 'split_screen'
  | 'quote_card'
  | 'orbit'
  | 'bars'
  | 'timeline'
  | 'cards'
  | 'pulse';

export type SceneElement = {
  label?: string;
  value?: string;
  detail?: string;
  badge?: string;
  color?: string;
  status?: string;
  percent?: number;
};

export type SceneVisualData = {
  tag?: string;
  metric?: string;
  metricLabel?: string;
  badge?: string;
  elements?: SceneElement[];
  nodes?: Array<{ label: string; sub?: string; icon?: string }>;
  bars?: Array<{ label: string; value: number; highlight?: boolean }>;
  codeSnippet?: string;
  quote?: string;
  quoteAuthor?: string;
  stickers?: string[];
  speechBubbles?: Array<{ text: string; side: 'left' | 'right'; speaker?: string }>;
  highlightWords?: string[];
  ambientColor?: string;
  imageUrl?: string;
  characterName?: string;
  characterQuote?: string;
  effect?: 'red_scarf_wind' | 'petals' | 'embers' | 'snow' | 'water_waves' | 'solar_flames' | 'none';
};

/** One transcribed word with absolute timestamps (seconds in the narration audio). */
export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

/** A contiguous slice of the timestamped transcript — one visual shot. */
export type TimedBeat = {
  text: string;
  /** Seconds from the start of the narration audio. */
  start: number;
  end: number;
  words: TranscriptWord[];
};

export type Scene = {
  kicker: string;
  headline: string;
  body: string;
  narrationBeat?: string;
  visual: Visual;
  accent: string;
  durationWeight: number;
  transition?: TransitionType;
  visualData?: SceneVisualData;
  imageUrl?: string;
  /** Transcript-grounded timing: seconds from the start of the narration audio. */
  start?: number;
  end?: number;
  /** Per-word start offsets (seconds, relative to `start`). Drives captions. */
  wordTimings?: number[];
};

export type ReelStyle = {
  theme?: ReelTheme;
  mood: string;
  palette: string[];
  backgroundStyle?: string;
  /** Light paper explainer vs dark premium kinetic. Defaults to dark. */
  mode?: 'dark' | 'light';
};

export type ReelPlan = {
  title: string;
  theme?: ReelTheme;
  narration: string;
  scenes: Scene[];
  style: ReelStyle;
  targetSeconds: number | null;
  unsupported?: string[];
  searchInsights?: string[];
  searchQuery?: string;
  images?: Array<{ title: string; url: string; thumbnail?: string }>;
};

/** Props passed to the Remotion composition (also written to `input.json`). */
export type ReelInputProps = {
  jobId: string;
  title: string;
  theme?: ReelTheme;
  prompt: string;
  narration: string;
  scenes: Scene[];
  style: ReelStyle;
  audioFile: string;
  durationInSeconds: number;
  createdAt?: string;
  images?: Array<{ title: string; url: string; thumbnail?: string }>;
};

export type TimelineScene = Scene & {
  /** Frame at which the incoming scene starts being visible (first scene = 0). */
  from: number;
  durationInFrames: number;
};

/**
 * Contract for runtime-generated visuals: the LLM writes ONE bespoke
 * `GeneratedVisual` component per video (see server/codegen.ts + prompts.ts).
 * It arrives via React context at module scope — never through serialized
 * Remotion props (functions can't cross the bundle boundary).
 */
export type GeneratedVisualProps = {
  /** Local scene frame (0-based). The ONLY clock — no Date/random allowed. */
  t: number;
  totalFrames: number;
  beatIndex: number;
  totalBeats: number;
  beat: string;
  /** Beat split into tokens (same order) — per-word stagger/highlight. */
  words: string[];
  headline: string;
  /** Intended archetype name (advisory — the code composes freely). */
  visual: string;
  visualData: SceneVisualData;
  /** Scene accent hex. Use ONCE as the focal point. */
  accent: string;
  /** Resolved theme tokens — no theme imports needed in generated code. */
  theme: { bg: string; text: string; muted: string; accent2: string };
};

export type SfxName =
  | 'swish'
  | 'pop'
  | 'whoosh_fast'
  | 'whoosh_heavy'
  | 'punch_impact'
  | 'laser_slice'
  | 'cyber_blip'
  | 'typewriter_click'
  | 'riser'
  | 'chime'
  | 'shimmer'
  | 'swell';

export type Cue = {
  sfx: SfxName;
  /** Seconds from the start of the reel. */
  t: number;
  db?: number;
};

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed';

export type Job = {
  id: string;
  prompt: string;
  status: JobStatus;
  step: string;
  progress: number;
  error: string | null;
  trace: string | null;
  createdAt: string;
  updatedAt: string;
  plan: ReelPlan | null;
  videoUrl: string | null;
  audioUrl: string | null;
  searchInsights?: string[] | null;
};
