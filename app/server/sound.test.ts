import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCues, buildSoundtrack } from './sound';
import type { TimelineScene } from '../types';

const entry = (overrides: Partial<TimelineScene> & { from: number }): TimelineScene => ({
  kicker: 'k',
  headline: 'h',
  body: 'b',
  narrationBeat: 'beat words here',
  visual: 'bento_grid',
  accent: '#35d6ff',
  durationWeight: 1,
  durationInFrames: 60,
  ...overrides,
});

describe('buildCues (one subtle cue per beat)', () => {
  it('emits at most one cue per scene', () => {
    const scenes = [
      entry({ from: 0, visual: 'kinetic_typography' }),
      entry({ from: 60, visual: 'bento_grid', transition: 'slide-left' }),
      entry({ from: 120, visual: 'neural_flow' }),
      entry({ from: 180, visual: 'stat_spotlight', transition: 'wipe-left' }),
    ];
    const cues = buildCues(scenes);

    expect(cues.length).toBe(scenes.length);
  });

  it('maps story events: impact, riser into finale, chime outro', () => {
    const cues = buildCues([
      entry({ from: 0, visual: 'kinetic_typography' }),
      entry({ from: 60, visual: 'bento_grid', transition: 'slide-left' }),
      entry({ from: 120, visual: 'timeline_path' }),
      entry({ from: 180, visual: 'quote_card' }),
    ]);

    expect(cues[0].sfx).toBe('punch_impact');
    expect(cues[1].sfx).toMatch(/whoosh|swish/);
    expect(cues[2].sfx).toBe('riser');
    expect(cues[3].sfx).toBe('chime');
  });

  it('gives data reveals shimmer and camera pushes swell', () => {
    const cues = buildCues([
      entry({ from: 0, visual: 'quote_card' }),
      entry({ from: 60, visual: 'stat_spotlight', transition: 'fade' }),
      entry({ from: 120, visual: 'bento_grid', transition: 'slide-up' }),
      entry({ from: 180, visual: 'timeline_path' }),
      entry({ from: 240, visual: 'quote_card' }),
    ]);

    expect(cues[1].sfx).toBe('shimmer');
    expect(cues[2].sfx).toBe('swell');
    expect(cues[3].sfx).toBe('riser');
    expect(cues[4].sfx).toBe('chime');
  });

  it('keeps every cue at subtle gains — nothing near the voice', () => {
    const scenes = Array.from({ length: 12 }, (_, i) =>
      entry({ from: i * 60, visual: i % 2 ? 'bento_grid' : 'kinetic_typography', transition: 'slide-left' }),
    );
    const cues = buildCues(scenes);

    for (const cue of cues) {
      expect(cue.db ?? -28).toBeLessThanOrEqual(-22);
    }
  });

  it('lands transition cues at the handoff centre', () => {
    const cues = buildCues([
      entry({ from: 0, visual: 'quote_card' }),
      entry({ from: 60, visual: 'bento_grid', transition: 'slide-left' }),
    ]);

    // from=60f → 2.0s, centre of 14f crossfade ≈ 2.23s.
    expect(cues[1].t).toBeCloseTo(2 + 7 / 30, 5);
  });

  it('synthesizes every SFX family without errors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shawtty-sfx-'));
    const musicPath = path.join(dir, 'm.wav');
    const sfxPath = path.join(dir, 's.wav');
    const families = ['punch_impact', 'riser', 'chime', 'shimmer', 'swell', 'laser_slice', 'pop'] as const;
    await buildSoundtrack({
      durationInSeconds: 3,
      cues: families.map((sfx, i) => ({ sfx, t: i * 0.3, db: -24 })),
      musicPath,
      sfxPath,
      theme: 'tech',
    });
    const [m, s] = await Promise.all([fs.stat(musicPath), fs.stat(sfxPath)]);
    expect(m.size).toBeGreaterThan(1000);
    expect(s.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
