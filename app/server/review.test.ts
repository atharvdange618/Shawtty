import { describe, expect, it } from 'vitest';
import { reviewPlan, reviewTimedPlan } from './review';
import { normalizeScriptText } from './timeline';
import type { Scene, TimedBeat } from '../types';

const draft = (overrides: Partial<Scene> = {}): Scene => ({
  kicker: 'Beat',
  headline: 'Key idea',
  body: 'Supporting line.',
  narrationBeat: 'Supporting line.',
  visual: 'kinetic_typography',
  accent: '#35d6ff',
  durationWeight: 1,
  ...overrides,
});

describe('reviewPlan (system QA pass)', () => {
  it('preserves AV sync: joined beats equal the narration exactly', () => {
    const script = 'Toddlers mirror what they see at the table every single day.';
    const { scenes, narration } = reviewPlan(
      script,
      [draft({ narrationBeat: 'Toddlers mirror what they see' }), draft({ narrationBeat: 'at the table every single day.' })],
      { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] },
    );

    expect(narration).toBe(normalizeScriptText(script));
    expect(normalizeScriptText(scenes.map((s) => s.narrationBeat || '').join(' '))).toBe(narration);
  });

  it('never repeats the same visual twice in a row', () => {
    const script = 'One two three four. Five six seven eight. Nine ten eleven twelve. Thirteen fourteen fifteen sixteen.';
    const { scenes } = reviewPlan(
      script,
      [draft({}), draft({}), draft({}), draft({})],
      { theme: 'education', palette: ['#000000', '#35d6ff', '#ffcc66'] },
    );

    for (let i = 1; i < scenes.length; i += 1) {
      expect(scenes[i].visual).not.toBe(scenes[i - 1].visual);
    }
  });

  it('demotes data-heavy visuals that have no payload', () => {
    const script = 'Simple words for a simple beat here today. Another plain beat follows right after this one.';
    const { scenes, warnings } = reviewPlan(script, [draft({ visual: 'neural_flow' })], {
      theme: 'lifestyle',
      palette: ['#000000', '#35d6ff'],
    });

    expect(scenes[0].visual).not.toBe('neural_flow');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rewrites headlines that parrot the voiceover and caps length', () => {
    const beat = 'Phones at dinner rewire toddler patience';
    const { scenes } = reviewPlan(`${beat} plus a few more trailing words here.`, [
      draft({ headline: beat, narrationBeat: beat }),
    ], { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] });

    expect(scenes[0].headline.toLowerCase()).not.toBe(beat.toLowerCase());
    expect(scenes[0].headline.split(' ').filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it('splits overlong beats so each shot stays readable', () => {
    const longBeat = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const { scenes } = reviewPlan(longBeat, [draft({ narrationBeat: longBeat })], {
      theme: 'education',
      palette: ['#000000', '#35d6ff'],
    });

    expect(scenes.length).toBeGreaterThan(1);
    for (const s of scenes) {
      expect((s.narrationBeat || '').split(' ').filter(Boolean).length).toBeLessThanOrEqual(16);
    }
  });
});

describe('concrete payload gate', () => {
  it('rebuilds filler payload from the beat instead of rendering dead boxes', () => {
    const beat = 'Kids spend up to nine hours a day on devices now, every single day';
    const { scenes, warnings } = reviewPlan(beat, [
      draft({
        narrationBeat: beat,
        visual: 'bento_grid',
        visualData: { elements: [{ label: 'X', value: '', detail: '' }] },
      }),
    ], { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] });

    expect(scenes[0].visual).toBe('bento_grid');
    expect(scenes[0].visualData?.metric).toMatch(/nine hours/i);
    expect((scenes[0].visualData?.elements ?? []).length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => w.includes('rebuilt payload'))).toBe(true);
  });

  it('rejects placeholder metrics like "Key stat" even when present', () => {
    const beat = 'This constant screen time rewires their brains, shrinking attention spans and spiking anxiety';
    const { scenes } = reviewPlan(beat, [
      draft({
        narrationBeat: beat,
        visual: 'bento_grid',
        visualData: {
          metric: 'Key stat',
          metricLabel: 'Brain Rewiring',
          elements: [
            { label: 'Attention Span', value: 'Shrinking', detail: '' },
            { label: 'Anxiety Levels', value: 'Spiking', detail: '' },
          ],
        },
      }),
    ], { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] });

    // "Key stat" is banned → synthesis must replace it with beat words.
    expect(scenes[0].visualData?.metric?.toLowerCase()).not.toBe('key stat');
  });

  it('demotes to kinetic type when the beat yields nothing concrete', () => {
    const beat = 'Oh yes indeed so very truly quite deeply always';
    const { scenes, warnings } = reviewPlan(beat, [
      draft({ narrationBeat: beat, visual: 'radial_gauge', visualData: {} }),
    ], { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] });

    expect(scenes[0].visual).toBe('kinetic_typography');
    expect(warnings.some((w) => w.includes('demoted'))).toBe(true);
  });
});

describe('synthesis quality (no echo, no filler words)', () => {
  it('strips label words from details instead of echoing them', () => {
    const beat = 'When you make a request you spend a token';
    const { scenes } = reviewPlan(beat, [
      draft({
        narrationBeat: beat,
        visual: 'neural_flow',
        visualData: {
          nodes: [
            { label: 'When you make', sub: 'When you make a request' },
            { label: 'You spend token', sub: 'you spend a token' },
          ],
        },
      }),
    ], { theme: 'tech', palette: ['#000000', '#35d6ff'] });

    const subs = (scenes[0].visualData?.nodes ?? []).map((n) => n.sub || '');
    for (const sub of subs) {
      expect(sub.toLowerCase()).not.toContain('when you make a request');
      expect(sub.toLowerCase()).not.toContain('you spend a token');
    }
  });

  it('builds labels from content words, not filler', () => {
    const beat = 'When you make a request the meter starts running fast';
    const { scenes } = reviewPlan(beat, [
      draft({ narrationBeat: beat, visual: 'bento_grid', visualData: {} }),
    ], { theme: 'tech', palette: ['#000000', '#35d6ff'] });

    const labels = (scenes[0].visualData?.elements ?? []).map((e) => e.label || '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.toLowerCase()).not.toMatch(/\b(when|you)\b/);
    }
  });
});

describe('reviewTimedPlan (transcript-grounded)', () => {
  const beat = (text: string, start: number, end: number): TimedBeat => ({
    text,
    start,
    end,
    words: text.split(' ').map((word, i, arr) => ({
      word,
      start: start + (i / arr.length) * (end - start),
      end: start + ((i + 1) / arr.length) * (end - start),
    })),
  });

  it('keeps a 1:1 beat↔scene mapping and stamps real timings', () => {
    const beats = [
      beat('Ever seen a toddler refuse food today', 0.2, 2.4),
      beat('That is my sister at the table', 2.4, 4.1),
    ];
    const { scenes, narration } = reviewTimedPlan(beats, [draft({}), draft({})], {
      theme: 'lifestyle',
      palette: ['#000000', '#35d6ff'],
    });

    expect(scenes.length).toBe(2);
    expect(scenes[0].narrationBeat).toBe(beats[0].text);
    expect(scenes[0].start).toBe(0.2);
    expect(scenes[0].end).toBe(2.4);
    expect(scenes[0].wordTimings?.length).toBe(7);
    expect(scenes[0].wordTimings?.[0]).toBe(0);
    expect(narration).toBe(normalizeScriptText(beats.map((b) => b.text).join(' ')));
  });

  it('never puts a data chart on a personal beat, even when the LLM tries', () => {
    const beats = [beat('That is my sister at the table', 0.2, 2.0)];
    const { scenes, warnings } = reviewTimedPlan(
      beats,
      [draft({ visual: 'split_screen', narrationBeat: beats[0].text })],
      { theme: 'lifestyle', palette: ['#000000', '#35d6ff'] },
    );

    expect(['kinetic_typography', 'quote_card', 'dialogue_cards']).toContain(scenes[0].visual);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('cycles drafts when the LLM returns fewer scenes than beats', () => {
    const beats = [
      beat('First beat with several words here', 0, 2),
      beat('Second beat with several words here', 2, 4),
      beat('Third beat with several words here', 4, 6),
    ];
    const { scenes } = reviewTimedPlan(beats, [draft({ headline: 'Only draft' })], {
      theme: 'education',
      palette: ['#000000', '#35d6ff'],
    });

    expect(scenes.length).toBe(3);
    expect(scenes[2].narrationBeat).toBe(beats[2].text);
    expect(scenes[2].start).toBe(4);
  });
});
