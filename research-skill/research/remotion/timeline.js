// Plain JS (no JSX) so the server can import it to place sound effects on the
// exact frames the renderer uses.

// Frames two neighbors stay on screen together for the slide-fade handoff.
export const OVERLAP = 14;

export const timelineFor = (scenes, totalFrames) => {
  const weights = scenes.map((scene) => Math.max(0.5, Number(scene.durationWeight) || 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  return scenes.map((scene, index) => {
    const slot =
      index === scenes.length - 1
        ? totalFrames - cursor
        : Math.max(50, Math.round((weights[index] / totalWeight) * totalFrames));
    const from = index === 0 ? 0 : Math.max(0, cursor - OVERLAP);
    const durationInFrames = index === 0 ? slot : slot + OVERLAP;
    cursor += slot;
    return { ...scene, from, durationInFrames };
  });
};
