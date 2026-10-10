import { describe, expect, it } from 'vitest';
import { extractSearchQuery, searchWikipedia } from './search';

describe('extractSearchQuery', () => {
  it('extracts topic from reel request prompts', () => {
    expect(extractSearchQuery('make a 20-second reel on Google Gemini 1.5 Pro')).toBe(
      'Google Gemini 1.5 Pro',
    );
    expect(extractSearchQuery('create a reel about Quantum Computing in 30 seconds')).toBe(
      'Quantum Computing',
    );
    expect(extractSearchQuery('explain CRISPR gene editing technology')).toBe(
      'CRISPR gene editing technology',
    );
  });

  it('handles clean topics unchanged', () => {
    expect(extractSearchQuery('DeepMind AlphaFold')).toBe('DeepMind AlphaFold');
  });
});

describe('searchWikipedia', () => {
  it('returns factual search results without an API key', async () => {
    const results = await searchWikipedia('Artificial intelligence', 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBeTruthy();
    expect(results[0].snippet).toBeTruthy();
    expect(results[0].source).toBe('wikipedia');
  });
});
