// No JSX/React imports so the server can import it to place sound effects on
// the exact frames the renderer uses.
import type { Scene, TimelineScene } from '../types';

// Frames the cross-fade lasts between two neighbours. Declared here (not in
// Remotion JSX) so the renderer (TransitionSeries) and the server (SFX cues)
// agree on the handoff length.
export const OVERLAP = 14;

// Returns the TransitionSeries sequence durations plus the composition frame
// where each scene actually begins.
//
// TransitionSeries subtracts one OVERLAP per handoff from the composed total,
// so the sequence slots must sum to `totalFrames + OVERLAP * (n - 1)` for the
// reel to land exactly on `totalFrames` (the audio length). `from` therefore
// subtracts the overlap consumed by each earlier handoff — it is the frame the
// incoming scene starts being visible, which is what the SFX cues key off.
// Returns the estimated speech weight for a line of narration.
// Takes into account word count, character phoneme length, and punctuation pauses.
export const computeTextSpeechWeight = (text?: string): number => {
  const clean = String(text || '').trim();
  if (!clean) return 1;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const wordCount = words.length;
  const charCount = clean.replace(/\s+/g, '').length;
  const commas = (clean.match(/[,;:]/g) || []).length;
  const sentenceEnds = (clean.match(/[.!?]/g) || []).length;
  // Standard speech metrics: ~0.32s per word + 0.035s per char + punctuation pauses
  return Math.max(1, wordCount * 0.32 + charCount * 0.035 + commas * 0.25 + sentenceEnds * 0.45);
};

export const timelineFor = (scenes: Scene[], totalFrames: number): TimelineScene[] => {
  const count = Math.max(1, scenes.length);
  const weights = scenes.map((scene) => {
    const textWeight = computeTextSpeechWeight(scene.narrationBeat || scene.body);
    const manualWeight = Math.max(0.5, Math.min(3, Number(scene.durationWeight) || 1));
    return textWeight * manualWeight;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const handoffs = Math.max(0, count - 1) * OVERLAP;
  const budget = totalFrames + handoffs;
  const minSlot = Math.max(OVERLAP + 2, Math.min(30, Math.floor(budget / count)));

  let cursor = 0;
  return scenes.map((scene, index) => {
    const remainingScenes = count - index;
    const remainingBudget = budget - cursor;
    let slot: number;

    if (index === count - 1) {
      slot = remainingBudget;
    } else {
      const ideal = Math.round((weights[index] / totalWeight) * budget);
      const maxPossible = Math.max(minSlot, remainingBudget - (remainingScenes - 1) * minSlot);
      slot = Math.max(minSlot, Math.min(maxPossible, ideal));
    }

    const from = cursor - index * OVERLAP;
    cursor += slot;
    return { ...scene, from, durationInFrames: slot };
  });
};
