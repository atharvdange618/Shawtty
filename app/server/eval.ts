// Creativity harness: scores every finished plan 1–5 on the house rubric
// (hook, visual variety, motion quality, sound consistency, originality).
// Pure + unit-tested. A low hook/originality score means the pipeline
// followed a template instead of being creative — persisted to eval.json
// and shown in the UI next to the video.
import type { Scene } from '../types';

export type EvalScores = {
  hook: number;
  variety: number;
  motion: number;
  sound: number;
  originality: number;
  overall: number;
};

export const EVAL_VERSION = 1;

const clamp15 = (v: number): number => Math.max(1, Math.min(5, Math.round(v)));

/** Hook: something happens in the first 1–2s — a question, a punch, a short slam. */
export const scoreHook = (first: Scene | undefined): number => {
  const beat = (first?.narrationBeat || first?.body || '').trim();
  if (!beat) return 1;
  if (/\?\s*$/.test(beat)) return 5;
  if (/!\s*$/.test(beat)) return 4;
  const words = beat.split(/\s+/).length;
  if (words <= 8) return 4;
  if (words <= 12) return 3;
  return 2;
};

/** Variety: different layouts per scene — the same card repeated scores 1. */
export const scoreVariety = (scenes: Scene[]): number => {
  if (scenes.length === 0) return 1;
  const distinct = new Set(scenes.map((s) => s.visual)).size;
  let adjacentDupes = 0;
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].visual === scenes[i - 1].visual) adjacentDupes += 1;
  }
  return clamp15((distinct / scenes.length) * 5 - adjacentDupes);
};

const MOTION_VISUALS = new Set([
  'kinetic_typography',
  'comparison_matrix',
  'radial_gauge',
  'timeline_path',
  'stat_spotlight',
  'neural_flow',
  'terminal_stream',
  'architecture_stack',
  'bento_grid',
  'split_screen',
]);

/**
 * Motion quality: share of beats with an inherently moving visual AND
 * concrete payload (isMotionHeavy), vs static filler.
 */
export const scoreMotion = (
  scenes: Scene[],
  isConcrete: (scene: Scene) => boolean,
): number => {
  if (scenes.length === 0) return 1;
  const live = scenes.filter((s) => MOTION_VISUALS.has(s.visual) && isConcrete(s)).length;
  return clamp15((live / scenes.length) * 5);
};

/** Sound consistency: 2–3 reused transition types score 5; chaos scores 2. */
export const scoreSound = (scenes: Scene[]): number => {
  if (scenes.length === 0) return 1;
  const distinct = new Set(scenes.map((s) => s.transition || 'fade')).size;
  if (distinct <= 1) return 3;
  if (distinct <= 3) return 5;
  return 2;
};

/** Originality: headlines must not echo each other (word-set overlap). */
export const scoreOriginality = (scenes: Scene[]): number => {
  if (scenes.length < 2) return 3;
  const sets = scenes.map(
    (s) => new Set(s.headline.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)),
  );
  let worst = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const inter = [...sets[i]].filter((w) => sets[j].has(w)).length;
      const union = new Set([...sets[i], ...sets[j]]).size || 1;
      worst = Math.max(worst, inter / union);
    }
  }
  return clamp15(5 - worst * 4);
};

export const scorePlan = (
  scenes: Scene[],
  isConcrete: (scene: Scene) => boolean,
): EvalScores => {
  const hook = scoreHook(scenes[0]);
  const variety = scoreVariety(scenes);
  const motion = scoreMotion(scenes, isConcrete);
  const sound = scoreSound(scenes);
  const originality = scoreOriginality(scenes);
  const overall = Math.round(((hook + variety + motion + sound + originality) / 5) * 10) / 10;
  return { hook, variety, motion, sound, originality, overall };
};
