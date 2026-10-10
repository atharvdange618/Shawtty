// Shared domain types for the reel pipeline (server + Remotion).
//
// Declared as `type` aliases, not `interface`: Remotion constrains composition
// props to `Record<string, unknown>`, and only type literals get an implicit
// index signature, so interfaces would fail that assignment.

export type Visual = 'orbit' | 'bars' | 'timeline' | 'cards' | 'pulse';

export type Scene = {
  kicker: string;
  headline: string;
  body: string;
  visual: Visual;
  accent: string;
  durationWeight: number;
};

export type ReelStyle = {
  mood: string;
  palette: string[];
};

export type ReelPlan = {
  title: string;
  narration: string;
  scenes: Scene[];
  style: ReelStyle;
  targetSeconds: number | null;
  unsupported: string[];
};

/** Props passed to the Remotion composition (also written to `input.json`). */
export type ReelInputProps = {
  jobId: string;
  title: string;
  prompt: string;
  narration: string;
  scenes: Scene[];
  style: ReelStyle;
  audioFile: string;
  durationInSeconds: number;
  createdAt?: string;
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
};
