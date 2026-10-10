import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TAIL_SECONDS,
  extractTargetSeconds,
  resolveSpeechVoice,
  wordBudgetFor,
} from './aicredits';

// The fallback paths log a warning; silence it so test output stays readable.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractTargetSeconds', () => {
  it('parses seconds and minutes in common phrasings', () => {
    expect(extractTargetSeconds('make a 20-second reel')).toBe(20);
    expect(extractTargetSeconds('30 sec please')).toBe(30);
    expect(extractTargetSeconds('45s')).toBe(45);
    expect(extractTargetSeconds('1 minute')).toBe(60);
    expect(extractTargetSeconds('1.5 min')).toBe(90);
  });

  it('ignores values outside the 5-90s composition clamp', () => {
    expect(extractTargetSeconds('a 3 second clip')).toBeNull();
    expect(extractTargetSeconds('from the 1990s')).toBeNull();
  });

  it('returns null when no duration is present', () => {
    expect(extractTargetSeconds('no duration here')).toBeNull();
  });
});

describe('wordBudgetFor', () => {
  it('grows with the requested length', () => {
    expect(wordBudgetFor(30)).toBeGreaterThan(wordBudgetFor(20));
    expect(wordBudgetFor(20)).toBeGreaterThan(wordBudgetFor(10));
  });

  it('reserves the tail seconds before converting to words', () => {
    // 20s - 0.6s tail at ~2.5 words/s.
    expect(wordBudgetFor(20)).toBeGreaterThanOrEqual(
      Math.floor((20 - TAIL_SECONDS) * 2.5),
    );
  });
});

describe('resolveSpeechVoice', () => {
  it('accepts a valid OpenAI TTS voice unchanged', () => {
    expect(resolveSpeechVoice('openai/tts-1', 'alloy')).toEqual({
      voice: 'alloy',
      version: 'openai',
      fallbackUsed: false,
    });
  });

  it('falls back to alloy for an invalid OpenAI voice', () => {
    expect(resolveSpeechVoice('openai/tts-1', 'meera')).toEqual({
      voice: 'alloy',
      version: 'openai',
      fallbackUsed: true,
    });
  });

  it('accepts a valid Bulbul v3 speaker', () => {
    expect(resolveSpeechVoice('sarvam/bulbul-v3', 'shubh')).toEqual({
      voice: 'shubh',
      version: 'v3',
      fallbackUsed: false,
    });
  });

  it('falls back to the v3 default for an unknown speaker', () => {
    expect(resolveSpeechVoice('sarvam/bulbul-v3', 'alloy')).toEqual({
      voice: 'shubh',
      version: 'v3',
      fallbackUsed: true,
    });
  });

  it('detects the v2 model and its default speaker', () => {
    expect(resolveSpeechVoice('sarvam/bulbul-v2', 'anushka')).toEqual({
      voice: 'anushka',
      version: 'v2',
      fallbackUsed: false,
    });
  });
});
