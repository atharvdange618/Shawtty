import { describe, expect, it } from 'vitest';
import {
  MIN_BEAT_WORDS,
  MIN_SLOT_FRAMES,
  MIN_VISIBLE_FRAMES,
  OVERLAP,
  alignBeatsToScript,
  estimateWordTimings,
  groupWordsIntoBeats,
  hashSeed,
  maxScenesForDuration,
  mergeFlashBeats,
  normalizeScriptText,
  seededRandom,
  splitScriptIntoBeats,
  timelineFor,
  timelineFromBeats,
} from './timeline';
import type { Scene, TranscriptWord } from '../types';

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

  it('never emits flash frames: every scene holds the screen past its crossfade', () => {
    const scenes = Array.from({ length: 8 }).map(() => ({
      ...scene(1),
      narrationBeat: 'Every great concept begins with a compelling observation here.',
    }));
    const timeline = timelineFor(scenes, 900);

    for (const s of timeline) {
      expect(s.durationInFrames - OVERLAP).toBeGreaterThanOrEqual(MIN_VISIBLE_FRAMES - 4);
    }
  });

  it('gives every scene at least MIN_SLOT_FRAMES when the budget allows', () => {
    const scenes = [scene(1), scene(1), scene(1)];
    const timeline = timelineFor(scenes, 900);

    for (const s of timeline.slice(0, -1)) {
      expect(s.durationInFrames).toBeGreaterThanOrEqual(MIN_SLOT_FRAMES);
    }
  });

  it('ignores extreme durationWeight nudges so timing stays voice-driven', () => {
    const normal = timelineFor(
      [
        { ...scene(1), narrationBeat: 'Short beat here told well.' },
        { ...scene(1), narrationBeat: 'Another short beat told well here.' },
      ],
      300,
    );
    const extreme = timelineFor(
      [
        { ...scene(0.5), narrationBeat: 'Short beat here told well.' },
        { ...scene(3), narrationBeat: 'Another short beat told well here.' },
      ],
      300,
    );
    // 0.5x vs 3x must not collapse/explode a beat into a flash or a drag.
    for (const s of extreme) {
      expect(s.durationInFrames - OVERLAP).toBeGreaterThanOrEqual(MIN_VISIBLE_FRAMES - 4);
    }
    expect(Math.abs(extreme[0].durationInFrames - normal[0].durationInFrames)).toBeLessThan(60);
  });
});

describe('voice sync helpers', () => {
  const script =
    'Ever seen a toddler refuse food without a phone? It starts with a distraction. Then the habit takes over the table.';

  const drafts = (beats: string[]): Scene[] =>
    beats.map((b, i) => ({
      kicker: `Beat ${i + 1}`,
      headline: `Point ${i + 1}`,
      body: b,
      narrationBeat: b,
      visual: 'kinetic_typography' as const,
      accent: '#35d6ff',
      durationWeight: 1,
    }));

  it('alignBeatsToScript partitions the script exactly (audio === visuals)', () => {
    const hinted = drafts(['Wrong words entirely here', 'Also wrong words here now', 'More wrong words here']);
    const beats = alignBeatsToScript(script, hinted);

    expect(beats.length).toBe(3);
    expect(normalizeScriptText(beats.join(' '))).toBe(normalizeScriptText(script));
    for (const b of beats) {
      expect(b.split(' ').filter(Boolean).length).toBeGreaterThanOrEqual(MIN_BEAT_WORDS);
    }
  });

  it('splitScriptIntoBeats rejoins exactly and honours the count', () => {
    const beats = splitScriptIntoBeats(script, 4);

    expect(beats.length).toBe(4);
    expect(normalizeScriptText(beats.join(' '))).toBe(normalizeScriptText(script));
  });

  it('mergeFlashBeats eliminates sub-minimum flash beats', () => {
    const merged = mergeFlashBeats(['A full beat with several words here', 'hi', 'Another full beat here']);

    expect(merged.join(' ')).toBe('A full beat with several words here hi Another full beat here');
    for (const b of merged) {
      expect(b.split(' ').filter(Boolean).length).toBeGreaterThanOrEqual(MIN_BEAT_WORDS);
    }
  });

  it('maxScenesForDuration caps scenes so every beat stays >= 1.6s', () => {
    expect(maxScenesForDuration(10)).toBeLessThanOrEqual(6);
    expect(maxScenesForDuration(60)).toBeLessThanOrEqual(24);
    expect(maxScenesForDuration(60)).toBeGreaterThan(maxScenesForDuration(10));
  });
});

describe('transcript-timed beats', () => {
  // "Ever seen(0.0-0.3) a(0.3-0.4) toddler(0.4-0.8) refuse(0.8-1.2) food(1.2-1.5) without(1.5-1.9) a(1.9-2.0) phone?(2.0-2.4) It(2.9-3.0) starts(3.0-3.4) now.(3.4-3.7)"
  const words: TranscriptWord[] = [
    { word: 'Ever', start: 0.0, end: 0.3 },
    { word: 'seen', start: 0.3, end: 0.5 },
    { word: 'a', start: 0.5, end: 0.6 },
    { word: 'toddler', start: 0.6, end: 1.0 },
    { word: 'refuse', start: 1.0, end: 1.4 },
    { word: 'food', start: 1.4, end: 1.7 },
    { word: 'without', start: 1.7, end: 2.0 },
    { word: 'a', start: 2.0, end: 2.1 },
    { word: 'phone?', start: 2.1, end: 2.5 },
    { word: 'It', start: 3.0, end: 3.1 },
    { word: 'starts', start: 3.1, end: 3.5 },
    { word: 'now.', start: 3.5, end: 3.8 },
  ];

  it('groupWordsIntoBeats cuts on sentence ends and pauses, keeping every word', () => {
    const beats = groupWordsIntoBeats(words, 2.2);

    expect(beats.length).toBe(2);
    expect(beats[0].text).toBe('Ever seen a toddler refuse food without a phone?');
    expect(beats[1].text).toBe('It starts now.');
    expect(beats[0].start).toBe(0);
    expect(beats[0].end).toBe(2.5);
    expect(beats.map((b) => b.text).join(' ')).toBe(words.map((w) => w.word).join(' '));
  });

  it('groupWordsIntoBeats guarantees 3-16 words per beat (review can keep 1:1)', () => {
    const many: TranscriptWord[] = Array.from({ length: 40 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.3,
      end: i * 0.3 + 0.25,
    }));
    const beats = groupWordsIntoBeats(many, 2.2);

    expect(beats.length).toBeGreaterThan(1);
    for (const b of beats) {
      expect(b.words.length).toBeGreaterThanOrEqual(MIN_BEAT_WORDS);
      expect(b.words.length).toBeLessThanOrEqual(16);
    }
    expect(beats.flatMap((b) => b.words).length).toBe(40);
  });

  it('estimateWordTimings spreads words across the measured duration', () => {
    const estimated = estimateWordTimings('Hello brave new world today', 5);

    expect(estimated.length).toBe(5);
    expect(estimated[0].start).toBe(0);
    expect(estimated[estimated.length - 1].end).toBeLessThanOrEqual(5);
    for (let i = 1; i < estimated.length; i += 1) {
      expect(estimated[i].start).toBeGreaterThanOrEqual(estimated[i - 1].start);
    }
  });

  it('hashSeed + seededRandom are deterministic per text (stable layouts)', () => {
    expect(hashSeed('token spend')).toBe(hashSeed('token spend'));
    expect(hashSeed('token spend')).not.toBe(hashSeed('brain rewiring'));

    const a = seededRandom(42);
    const b = seededRandom(42);
    expect(Array.from({ length: 5 }, () => a())).toEqual(Array.from({ length: 5 }, () => b()));
    for (const v of Array.from({ length: 20 }, () => a())) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('timelineFromBeats cuts on real spoken times and lands exactly', () => {
    const mk = (start: number, end: number): Scene => ({
      ...scene(1),
      narrationBeat: 'beat',
      start,
      end,
    });
    const scenes = [mk(0, 2.5), mk(2.5, 4.7), mk(4.7, 7.0)];
    const totalFrames = 220;
    const timeline = timelineFromBeats(scenes, totalFrames, 30);

    expect(timeline.length).toBe(3);
    expect(timeline[0].from).toBe(0);
    // Scene 2 audio starts at 2.5s → visible at ~75f.
    expect(Math.abs(timeline[1].from - 75)).toBeLessThanOrEqual(OVERLAP);
    const slotSum = timeline.reduce((sum, s) => sum + s.durationInFrames, 0);
    expect(slotSum - OVERLAP * (scenes.length - 1)).toBe(totalFrames);
    for (const s of timeline) {
      expect(s.durationInFrames).toBeGreaterThan(OVERLAP);
    }
  });
});
