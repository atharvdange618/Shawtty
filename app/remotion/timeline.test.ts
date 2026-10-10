import { describe, expect, it } from 'vitest';
import { OVERLAP, timelineFor } from './timeline';
import type { Scene } from '../types';

const scene = (durationWeight: number): Scene => ({
  kicker: 'k',
  headline: 'h',
  body: 'b',
  visual: 'orbit',
  accent: '#35d6ff',
  durationWeight,
});

describe('timelineFor', () => {
  it('composes to exactly totalFrames once the overlaps are subtracted', () => {
    const scenes = [scene(1), scene(1), scene(1)];
    const totalFrames = 900;

    const timeline = timelineFor(scenes, totalFrames);
    const slotSum = timeline.reduce((sum, s) => sum + s.durationInFrames, 0);

    expect(slotSum - OVERLAP * (scenes.length - 1)).toBe(totalFrames);
  });

  it('starts the first scene at frame 0 and overlaps each next one by OVERLAP', () => {
    const timeline = timelineFor([scene(1), scene(2), scene(1)], 900);

    expect(timeline[0].from).toBe(0);
    for (let i = 1; i < timeline.length; i += 1) {
      const previousEnd = timeline[i - 1].from + timeline[i - 1].durationInFrames;
      expect(timeline[i].from).toBe(previousEnd - OVERLAP);
    }
  });

  it('gives the last scene the remainder so the reel lands on totalFrames', () => {
    const scenes = [scene(1), scene(1), scene(1)];
    const totalFrames = 900;

    const timeline = timelineFor(scenes, totalFrames);
    const last = timeline[timeline.length - 1];

    expect(last.from + last.durationInFrames).toBe(totalFrames);
  });

  it('scales slot length by durationWeight', () => {
    const timeline = timelineFor([scene(1), scene(3)], 900);

    expect(timeline[1].durationInFrames).toBeGreaterThan(timeline[0].durationInFrames);
  });

  it('carries the scene fields through onto the timed entries', () => {
    const [first] = timelineFor([scene(2)], 300);

    expect(first.kicker).toBe('k');
    expect(first.visual).toBe('orbit');
    expect(first.durationInFrames).toBe(300);
  });

  it('handles large scene counts (e.g. 20 scenes) without negative frames or overflow', () => {
    const scenes = Array.from({ length: 20 }).map((_, i) => scene((i % 2) + 1));
    const totalFrames = 600; // 20s at 30fps
    const timeline = timelineFor(scenes, totalFrames);

    expect(timeline.length).toBe(20);
    timeline.forEach((s) => {
      expect(s.durationInFrames).toBeGreaterThanOrEqual(OVERLAP);
    });

    const slotSum = timeline.reduce((sum, s) => sum + s.durationInFrames, 0);
    expect(slotSum - OVERLAP * (scenes.length - 1)).toBe(totalFrames);
  });
});
