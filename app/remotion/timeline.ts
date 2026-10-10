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
export const timelineFor = (scenes: Scene[], totalFrames: number): TimelineScene[] => {
  const weights = scenes.map((scene) => Math.max(0.5, Number(scene.durationWeight) || 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const handoffs = Math.max(0, scenes.length - 1) * OVERLAP;
  const budget = totalFrames + handoffs;

  let cursor = 0;
  return scenes.map((scene, index) => {
    const slot =
      index === scenes.length - 1
        ? budget - cursor
        : Math.max(50, Math.round((weights[index] / totalWeight) * budget));
    const from = cursor - index * OVERLAP;
    cursor += slot;
    return { ...scene, from, durationInFrames: slot };
  });
};
