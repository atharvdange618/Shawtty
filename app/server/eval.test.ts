import { describe, expect, it } from 'vitest';
import { scoreHook, scoreMotion, scoreOriginality, scorePlan, scoreSound, scoreVariety } from './eval';
import type { Scene } from '../types';

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  kicker: 'Beat',
  headline: 'Key idea',
  body: 'Body copy here.',
  narrationBeat: 'Body copy here.',
  visual: 'kinetic_typography',
  accent: '#35d6ff',
  durationWeight: 1,
  ...overrides,
});

describe('creativity eval', () => {
  it('rewards a question hook, punishes a slow factual open', () => {
    expect(scoreHook(scene({ narrationBeat: 'Ever seen a toddler refuse food?' }))).toBe(5);
    expect(scoreHook(scene({ narrationBeat: 'In this comprehensive analysis we will examine several factors' }))).toBeLessThanOrEqual(3);
  });

  it('rewards layout variety, punishes the same card repeated', () => {
    const varied = ['kinetic_typography', 'bento_grid', 'comparison_matrix', 'quote_card'].map((visual) =>
      scene({ visual: visual as Scene['visual'] }),
    );
    expect(scoreVariety(varied)).toBe(5);
    expect(scoreVariety([scene(), scene(), scene()])).toBe(1);
  });

  it('counts only concrete motion visuals toward motion quality', () => {
    const scenes = [scene({ visual: 'comparison_matrix' }), scene({ visual: 'radial_gauge' })];
    expect(scoreMotion(scenes, () => true)).toBe(5);
    expect(scoreMotion(scenes, () => false)).toBe(1);
    const mixed = [scene({ visual: 'comparison_matrix' }), scene({ visual: 'quote_card' })];
    expect(scoreMotion(mixed, () => true)).toBe(3);
  });

  it('rewards 2-3 consistent transitions', () => {
    const scenes = [
      scene({ transition: 'slide-left' }),
      scene({ transition: 'fade' }),
      scene({ transition: 'slide-left' }),
    ];
    expect(scoreSound(scenes)).toBe(5);
    expect(scoreSound([scene({ transition: 'fade' })])).toBe(3);
  });

  it('punishes echoing headlines', () => {
    const fresh = [scene({ headline: 'Token buckets fill fast' }), scene({ headline: 'Sleep repairs young brains' })];
    expect(scoreOriginality(fresh)).toBeGreaterThanOrEqual(4);
    const echo = [scene({ headline: 'Brain rewiring explained' }), scene({ headline: 'Brain rewiring effects' })];
    expect(scoreOriginality(echo)).toBeLessThan(scoreOriginality(fresh));
  });

  it('scorePlan averages the five rubric scores', () => {
    const scores = scorePlan([scene({ narrationBeat: 'Really?' })], () => true);
    expect(scores.overall).toBeGreaterThanOrEqual(1);
    expect(scores.overall).toBeLessThanOrEqual(5);
    expect(Object.keys(scores)).toEqual(['hook', 'variety', 'motion', 'sound', 'originality', 'overall']);
  });
});
