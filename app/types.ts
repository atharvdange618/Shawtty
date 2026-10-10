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
  effect?: 'red_scarf_wind' | 'petals' | 'embers' | 'none';
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
};

export type ReelStyle = {
  theme?: ReelTheme;
  mood: string;
  palette: string[];
  backgroundStyle?: string;
};

export type ReelPlan = {
  title: string;
  theme?: ReelTheme;
  narration: string;
  scenes: Scene[];
  style: ReelStyle;
  targetSeconds: number | null;
  unsupported: string[];
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

export type SfxName = 'swish' | 'pop';

export type Cue = {
  sfx: SfxName;
  /** Seconds from the start of the reel. */
  t: number;
  /** Gain in dB. */
  db: number;
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
