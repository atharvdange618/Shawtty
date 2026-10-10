// Voice-synced timeline engine — single source of truth for AV sync.
//
// INVARIANT (the whole reel depends on this):
//   audio = TTS(script)
//   transcript = Whisper(audio) with word timestamps (or syllabic estimate)
//   plan.narration === transcript words, beats partition the transcript
//   scene [start,end] === when its beat is actually spoken
//
// Scene cuts are driven by measured timestamps, never by the
// LLM's guesses — so graphics always explain the words being heard.
import type { Scene, TimedBeat, TimelineScene, TranscriptWord } from '../types';

// Frames the cross-fade lasts between two neighbours. Declared here (not in
// Remotion JSX) so the renderer (TransitionSeries) and the server (SFX cues)
// agree on the handoff length.
export const OVERLAP = 14;

/** Minimum frames a scene must hold the screen fully visible (readable). */
export const MIN_VISIBLE_FRAMES = 60;
/** Minimum slot size = visible hold + one full crossfade handoff. */
export const MIN_SLOT_FRAMES = OVERLAP + MIN_VISIBLE_FRAMES; // 74 ≈ 2.5s
/** Fastest we ever cut: every idea gets time to land on a phone screen. */
export const MIN_BEAT_SECONDS = 2.5;
/** Slowest a beat may linger before it feels like a slideshow. */
export const MAX_BEAT_SECONDS = 8.0;
/** Beats stay readable only when short enough for one visual shot. */
export const MAX_BEAT_WORDS = 16;
/** Below this a beat is a flash frame — merge it, never render it. */
export const MIN_BEAT_WORDS = 3;

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

const normalizeWords = (text: string): string[] =>
  String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

/** Collapse whitespace for exact-match comparisons (audio vs beats). */
export const normalizeScriptText = (text: string): string =>
  String(text || '').replace(/\s+/g, ' ').trim();

/**
 * How many scenes can this audio duration support without creating
 * unreadable flash frames? Used by both the choreographer prompt and the
 * server-side cap.
 */
export const maxScenesForDuration = (speechSeconds: number): number => {
  if (!Number.isFinite(speechSeconds) || speechSeconds <= 0) return 6;
  return Math.max(3, Math.min(32, Math.floor(speechSeconds / MIN_BEAT_SECONDS)));
};

/**
 * Deterministically split an authoritative script into N contiguous,
 * non-overlapping beats that rejoin EXACTLY to the script.
 * Splits prefer sentence/clause boundaries so cuts land on breaths.
 */
export const splitScriptIntoBeats = (script: string, targetCount: number): string[] => {
  const clean = normalizeScriptText(script);
  if (!clean) return [];
  const count = Math.max(1, Math.round(targetCount) || 1);
  if (count === 1) return [clean];

  // Split into clauses on sentence ends / commas / conjunctions — natural breaths.
  const clauses = clean.match(/[^.!?;,]+[.!?;,]?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  if (clauses.length >= count) {
    // Group consecutive clauses into `count` balanced buckets by word count.
    const weights = clauses.map((c) => normalizeWords(c).length);
    const total = weights.reduce((a, b) => a + b, 0);
    const perBucket = total / count;
    const beats: string[] = [];
    let current: string[] = [];
    let currentWords = 0;
    for (let i = 0; i < clauses.length; i += 1) {
      current.push(clauses[i]);
      currentWords += weights[i];
      const bucketsLeft = count - beats.length - 1;
      const clausesLeft = clauses.length - i - 1;
      // Close the bucket when we hit quota and remaining clauses can fill the rest.
      if (bucketsLeft > 0 && currentWords >= perBucket && clausesLeft >= bucketsLeft) {
        beats.push(current.join(' ').trim());
        current = [];
        currentWords = 0;
      } else if (bucketsLeft === 0 && i === clauses.length - 1) {
        beats.push(current.join(' ').trim());
        current = [];
        currentWords = 0;
      } else if (clausesLeft === bucketsLeft - 1 && bucketsLeft > 1) {
        beats.push(current.join(' ').trim());
        current = [];
        currentWords = 0;
      }
    }
    if (current.length) {
      if (beats.length < count) beats.push(current.join(' ').trim());
      else beats[beats.length - 1] = `${beats[beats.length - 1]} ${current.join(' ')}`.trim();
    }
    // Merge/split overflow edge cases so we return exactly `count` non-empty beats.
    while (beats.length > count) {
      const last = beats.pop() as string;
      beats[beats.length - 1] = `${beats[beats.length - 1]} ${last}`.trim();
    }
    return beats.filter(Boolean);
  }

  // Fewer clauses than beats: split longest clauses word-wise.
  const words = normalizeWords(clean);
  const perBeat = Math.ceil(words.length / count);
  const beats: string[] = [];
  for (let i = 0; i < words.length; i += perBeat) {
    beats.push(words.slice(i, i + perBeat).join(' '));
  }
  return beats.filter(Boolean);
};

/**
 * Force a draft scene list onto the authoritative script.
 * The LLM's narrationBeats are treated as *hints* for proportional sizing
 * only — the returned beats always partition `script` exactly, so TTS audio
 * (spoken from `script`) can never desync from visuals.
 */
export const alignBeatsToScript = (script: string, drafts: Scene[]): string[] => {
  const clean = normalizeScriptText(script);
  if (!clean) return drafts.map(() => '');
  const words = normalizeWords(clean);
  if (drafts.length === 0) return [clean];
  if (drafts.length === 1) return [clean];

  // Proportional sizing from draft hint weights (falls back to even split).
  const hintWeights = drafts.map((d) => {
    const hint = normalizeScriptText(d.narrationBeat || d.body || d.headline || '');
    const n = normalizeWords(hint).length;
    return n > 0 ? n : Math.max(1, Math.round(words.length / drafts.length));
  });
  const totalHint = hintWeights.reduce((a, b) => a + b, 0) || 1;

  const beats: string[] = [];
  let cursor = 0;
  for (let i = 0; i < drafts.length; i += 1) {
    if (i === drafts.length - 1) {
      beats.push(words.slice(cursor).join(' '));
      break;
    }
    const remaining = drafts.length - i;
    const remainingWords = words.length - cursor;
    // Ideal proportional cut, clamped so every remaining beat keeps >= MIN_BEAT_WORDS.
    const ideal = Math.round((hintWeights[i] / totalHint) * words.length);
    const maxTake = remainingWords - (remaining - 1) * MIN_BEAT_WORDS;
    const take = Math.max(MIN_BEAT_WORDS, Math.min(maxTake, ideal));
    // Prefer cutting at a sentence end near the ideal point.
    let cut = cursor + take;
    let best = cut;
    for (let k = Math.max(cursor + MIN_BEAT_WORDS, cut - 4); k <= Math.min(words.length - 1, cut + 4); k += 1) {
      if (/[.!?;,]$/.test(words[k - 1] ?? '')) {
        if (Math.abs(k - cut) < Math.abs(best - cut)) best = k;
      }
    }
    cut = Math.max(cursor + MIN_BEAT_WORDS, Math.min(cursor + maxTake, best));
    beats.push(words.slice(cursor, cut).join(' '));
    cursor = cut;
  }
  return beats;
};

/**
 * Merge beats that are too short to read (< MIN_BEAT_WORDS) into the neighbour
 * with fewer words. Returns the merged beat list.
 */
export const mergeFlashBeats = (beats: string[]): string[] => {
  const out = beats.filter((b) => normalizeScriptText(b).length > 0);
  for (let i = out.length - 1; i >= 0 && out.length > 1; i -= 1) {
    if (normalizeWords(out[i]).length >= MIN_BEAT_WORDS) continue;
    if (i === 0) {
      out[1] = `${out[0]} ${out[1]}`.trim();
      out.splice(0, 1);
    } else {
      out[i - 1] = `${out[i - 1]} ${out[i]}`.trim();
      out.splice(i, 1);
    }
  }
  return out;
};

export const timelineFor = (scenes: Scene[], totalFrames: number): TimelineScene[] => {
  const count = Math.max(1, scenes.length);
  // Pure voice-driven weights: the scene lasts as long as it takes to SPEAK
  // its beat. The LLM's durationWeight is only a ±10% nudge — it must never
  // be allowed to stretch/shrink a beat into desync (the old 0.5x–3x range
  // created 30ms flash frames and 6s drags alike).
  const weights = scenes.map((scene) => {
    const textWeight = computeTextSpeechWeight(scene.narrationBeat || scene.body);
    const nudge = Math.max(0.9, Math.min(1.1, Number(scene.durationWeight) || 1));
    return Math.max(0.5, textWeight * nudge);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const handoffs = Math.max(0, count - 1) * OVERLAP;
  const budget = totalFrames + handoffs;
  // Every slot must survive its own crossfade AND hold readable content.
  const minSlot = Math.max(
    MIN_SLOT_FRAMES,
    Math.min(Math.floor(budget / Math.max(1, count)), MIN_SLOT_FRAMES + 20),
  );
  // If the budget cannot fit every scene at minSlot, the caller over-cut:
  // still compose exactly (last scene absorbs) but never emit <=0 slots.
  const hardMin = OVERLAP + 4;

  let cursor = 0;
  return scenes.map((scene, index) => {
    const remainingScenes = count - index;
    const remainingBudget = budget - cursor;
    let slot: number;

    if (index === count - 1) {
      slot = Math.max(hardMin, remainingBudget);
    } else {
      const ideal = Math.round((weights[index] / totalWeight) * budget);
      const maxPossible = Math.max(hardMin, remainingBudget - (remainingScenes - 1) * minSlot);
      // Respect minSlot unless the budget genuinely cannot fit (over-cut guard).
      const floor = remainingBudget - (remainingScenes - 1) * hardMin >= minSlot ? minSlot : hardMin;
      slot = Math.max(floor, Math.min(maxPossible, ideal));
    }

    const from = cursor - index * OVERLAP;
    cursor += slot;
    return { ...scene, from, durationInFrames: slot };
  });
};

/**
 * Group timestamped transcript words into contiguous visual beats.
 * Cuts land on sentence ends or natural pauses (>= 0.35s gaps) once the
 * beat is long enough — so a scene change never slices a word in half and
 * graphics always switch on a breath, not mid-syllable.
 */
export const groupWordsIntoBeats = (
  words: TranscriptWord[],
  targetSeconds = 3.4,
): TimedBeat[] => {
  const clean = (words || []).filter((w) => w && w.word.trim().length > 0);
  if (clean.length === 0) return [];

  const beats: TimedBeat[] = [];
  let current: TranscriptWord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    beats.push({
      text: current.map((w) => w.word).join(' '),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < clean.length; i += 1) {
    current.push(clean[i]);
    const isLast = i === clean.length - 1;
    const duration = clean[i].end - current[0].start;
    const gap = isLast ? 0 : Math.max(0, clean[i + 1].start - clean[i].end);
    const endsSentence = /[.!?…]+$/.test(clean[i].word);
    const wordCount = current.length;

    if (isLast) {
      flush();
    } else if (
      (duration >= targetSeconds * 0.7 && (endsSentence || gap >= 0.35)) ||
      wordCount >= MAX_BEAT_WORDS ||
      duration >= MAX_BEAT_SECONDS
    ) {
      flush();
    }
  }

  // Merge a trailing stump (< MIN_BEAT_WORDS) into the previous beat.
  // Beats are guaranteed 3–16 words on exit so reviewTimedPlan keeps a 1:1
  // beat↔scene mapping (reviewPlan only re-cuts outside that range).
  if (
    beats.length > 1 &&
    beats[beats.length - 1].words.length < MIN_BEAT_WORDS
  ) {
    const stump = beats.pop() as TimedBeat;
    const prev = beats[beats.length - 1];
    const merged = [...prev.words, ...stump.words];
    if (merged.length > MAX_BEAT_WORDS) {
      // Overflow: keep a ≥3-word tail instead of an overlong beat.
      const tailCount = Math.max(MIN_BEAT_WORDS, merged.length - MAX_BEAT_WORDS);
      const head = merged.slice(0, merged.length - tailCount);
      const tail = merged.slice(merged.length - tailCount);
      beats[beats.length - 1] = {
        text: head.map((w) => w.word).join(' '),
        start: head[0].start,
        end: head[head.length - 1].end,
        words: head,
      };
      beats.push({
        text: tail.map((w) => w.word).join(' '),
        start: tail[0].start,
        end: tail[tail.length - 1].end,
        words: tail,
      });
    } else {
      beats[beats.length - 1] = {
        text: merged.map((w) => w.word).join(' '),
        start: merged[0].start,
        end: merged[merged.length - 1].end,
        words: merged,
      };
    }
  }
  return beats;
};

/**
 * Fallback when Whisper timestamps are unavailable: spread the script's
 * words across the measured audio duration proportionally to syllabic
 * speech weight. Same grouping rules as the real transcript path.
 */
export const estimateWordTimings = (text: string, durationSeconds: number): TranscriptWord[] => {
  const tokens = normalizeWords(text);
  if (tokens.length === 0 || !(durationSeconds > 0)) return [];
  const fractions = wordFractionsFor(tokens.join(' '));
  let cursor = 0;
  return tokens.map((word, i) => {
    const dur = Math.max(0.08, fractions[i] * durationSeconds);
    const start = cursor;
    cursor += dur;
    return { word, start, end: Math.min(durationSeconds, cursor) };
  });
};

/**
 * Timeline built from REAL transcript times instead of estimated weights.
 * Scene `start`/`end` are seconds in the narration audio (≈ composition
 * time); slots are derived so the composition still lands exactly on
 * totalFrames with OVERLAP crossfades.
 */
export const timelineFromBeats = (
  scenes: Scene[],
  totalFrames: number,
  fps = 30,
): TimelineScene[] => {
  const count = Math.max(1, scenes.length);
  const hardMin = OVERLAP + 4;
  const froms = scenes.map((s, i) => {
    if (i === 0) return 0;
    const t = Number(s.start);
    return Number.isFinite(t) && t >= 0 ? Math.round(t * fps) : -1;
  });
  // Fill any missing starts by even spacing (shouldn't happen post-review).
  for (let i = 0; i < froms.length; i += 1) {
    if (froms[i] < 0) {
      froms[i] = Math.round((i / count) * totalFrames);
    }
    if (i > 0 && froms[i] <= froms[i - 1]) {
      froms[i] = froms[i - 1] + hardMin;
    }
  }

  const handoffs = Math.max(0, count - 1) * OVERLAP;
  const budget = totalFrames + handoffs;
  let cursor = 0;
  return scenes.map((scene, index) => {
    let slot: number;
    if (index === count - 1) {
      slot = Math.max(hardMin, budget - cursor);
    } else {
      // Next beat's audio start, re-expressed as a slot incl. the handoff.
      const ideal = froms[index + 1] - (cursor - index * OVERLAP) + OVERLAP;
      const remainingScenes = count - index;
      const remainingBudget = budget - cursor;
      const maxPossible = Math.max(hardMin, remainingBudget - (remainingScenes - 1) * MIN_SLOT_FRAMES);
      const floor =
        remainingBudget - (remainingScenes - 1) * hardMin >= MIN_SLOT_FRAMES
          ? MIN_SLOT_FRAMES
          : hardMin;
      slot = Math.max(floor, Math.min(maxPossible, Math.max(hardMin, ideal)));
    }
    const from = cursor - index * OVERLAP;
    cursor += slot;
    return { ...scene, from, durationInFrames: slot };
  });
};

/** FNV-1a string hash — stable layout seeds (same text → same geometry). */
export const hashSeed = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Deterministic PRNG (mulberry32-style): no Math.random, renders stay stable. */
export const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Estimated per-word speaking fractions inside one beat (sums to 1). */
export const wordFractionsFor = (beat: string): number[] => {
  const words = normalizeWords(beat);
  if (words.length === 0) return [];
  const weights = words.map((w) => {
    const rawLen = w.replace(/[^a-zA-Z0-9]/g, '').length;
    const hasComma = /[,;:]/.test(w);
    const hasEnd = /[.!?]/.test(w);
    const lenWeight = rawLen <= 3 ? 2.0 : rawLen <= 6 ? 3.5 : 5.4;
    return lenWeight + (hasComma ? 2.5 : 0) + (hasEnd ? 4.0 : 0);
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / total);
};
