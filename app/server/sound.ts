// Procedural music bed + sound effects, no sample files.
//
// Ported from the "yellow-ticker" theme sound.py and mix_audio.py in
// https://github.com/srvjha/reel-animated-explainer
// MIT License, Copyright (c) 2026 srvjha
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

import fs from 'node:fs/promises';
import { OVERLAP } from './timeline';
import type { Cue, ReelTheme, SfxName, TimelineScene } from '../types';

const SR = 44100;
// The bed sits well under the voice (which peaks near -3 dBFS); the
// sidechain in media.ts ducks it further during speech. SFX are felt, not
// noticed — only the kinetic title hit is allowed real presence.
const MUSIC_DB = -26;
/** Seconds of audio lead: SFX land ~2 frames before the visual (30fps). */
const SFX_LEAD_SECONDS = 0.07;
const TWO_PI = 2 * Math.PI;
const nf = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const dbToGain = (db: number): number => 10 ** (db / 20);

type Rng = () => number;

const makeRng = (seed = 7): Rng => {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(TWO_PI * uniform());
};

const synth = (seconds: number, fn: (t: number, i: number, n: number) => number): Float64Array => {
  const n = Math.floor(seconds * SR);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = fn(i / SR, i, n);
  return x;
};

const sweep = (
  seconds: number,
  freqAt: (t: number) => number,
  envAt: (t: number) => number,
): Float64Array => {
  let phase = 0;
  return synth(seconds, (t) => {
    phase += (TWO_PI * freqAt(t)) / SR;
    return Math.sin(phase) * envAt(t);
  });
};

const put = (buf: Float64Array, x: Float64Array, t: number, gain: number): void => {
  const start = Math.floor(t * SR);
  if (start < 0 || start >= buf.length) return;
  const end = Math.min(buf.length, start + x.length);
  for (let i = start; i < end; i += 1) buf[i] += x[i - start] * gain;
};

const peakNormalize = (x: Float64Array, db: number): Float64Array => {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const g = dbToGain(db) / (peak + 1e-9);
  for (let i = 0; i < x.length; i += 1) x[i] *= g;
  return x;
};

// 1. Tech & Cyber Synth Soundtrack (driving 128 bpm arpeggiator, 808 sub, hi-hat rolls)
const cyberSynthMusic = (dur: number, rng: Rng): Float64Array => {
  const out = new Float64Array(Math.floor(SR * dur));
  const bpm = 126;
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  const roots = [57, 57, 53, 55]; // Am, Am, F, G

  for (let t = 0, bar = 0; t < dur; t += beat * 4, bar += 1) {
    const root = roots[bar % roots.length];
    const arpNotes = [0, 7, 12, 15, 19, 15, 12, 7];

    for (let s = 0; s < 16; s += 1) {
      const ts = t + s * sixteenth;
      const note = root + 12 + arpNotes[s % arpNotes.length];
      const f = nf(note);
      // Cyber pluck with resonance
      put(
        out,
        synth(0.18, (tt) => (Math.sin(TWO_PI * f * tt) + 0.4 * Math.sin(3 * TWO_PI * f * tt)) * Math.exp(-tt * 20)),
        ts,
        0.14,
      );

      // Hi-hat rolls
      if (s % 2 === 1) {
        put(out, synth(0.03, (tt) => rng() * Math.exp(-tt * 180)), ts, 0.05);
      }
    }

    // Punchy 808 sub kick on beats 0 and 2.5
    for (const kickBeat of [0, 2.5]) {
      const kt = t + kickBeat * beat;
      put(out, sweep(0.24, (tt) => 130 * Math.exp(-tt * 25) + 45, (tt) => Math.exp(-tt * 12)), kt, 0.45);
    }

    // Snappy snare on beats 1 and 3
    for (const snareBeat of [1, 3]) {
      const st = t + snareBeat * beat;
      put(out, synth(0.16, (tt) => rng() * Math.exp(-tt * 22)), st, 0.16);
      put(out, sweep(0.08, (tt) => 240 * Math.exp(-tt * 40) + 140, (tt) => Math.exp(-tt * 25)), st, 0.2);
    }

    // Sustained sub bass drone
    const bassF = nf(root - 24);
    put(out, synth(beat * 4, (tt) => Math.sin(TWO_PI * bassF * tt) * (1 - 0.2 * Math.cos(TWO_PI * 2 * tt))), t, 0.35);
  }
  return out;
};

// 2. Cinematic Storytelling / Anime Soundtrack (80 bpm minor swells, soft chords, deep sub pulse)
const cinematicAmbientMusic = (dur: number): Float64Array => {
  const out = new Float64Array(Math.floor(SR * dur));
  const chordDur = 3.2;
  const roots = [57, 53, 60, 55]; // Am, F, C, G

  for (let t = 0, chord = 0; t < dur; t += chordDur, chord += 1) {
    const root = roots[chord % roots.length];
    const intervals = [0, 7, 12, 15]; // minor 7th harmonics

    // Soft warm pad chord
    for (const iv of intervals) {
      const f = nf(root + iv);
      put(
        out,
        synth(chordDur, (tt) => {
          const env = Math.sin((Math.PI * tt) / chordDur) ** 1.5;
          return (Math.sin(TWO_PI * f * tt) + 0.2 * Math.sin(2 * TWO_PI * f * tt)) * env;
        }),
        t,
        0.18,
      );
    }

    // Deep sub pulse
    const subF = nf(root - 24);
    put(
      out,
      synth(chordDur, (tt) => Math.sin(TWO_PI * subF * tt) * Math.sin((Math.PI * tt) / chordDur)),
      t,
      0.35,
    );
  }
  return out;
};

// 3. Upbeat Modern Groove (120 bpm bouncy pluck)
const upbeatGrooveMusic = (dur: number, rng: Rng): Float64Array => {
  const out = new Float64Array(Math.floor(SR * dur));
  const beat = 60 / 120;
  const prog: Array<[number, number[]]> = [
    [60, [0, 4, 7]],
    [57, [0, 3, 7]],
    [65, [0, 4, 7]],
    [67, [0, 4, 7]],
  ];

  for (let t = 0, bar = 0; t < dur; t += beat * 4, bar += 1) {
    const [root, iv] = prog[bar % 4];
    for (let k = 0; k < 8; k += 1) {
      const ts = t + (k * beat) / 2;
      const f = nf(root + 12 + iv[k % 3] + (k === 3 || k === 7 ? 12 : 0));
      put(out, synth(0.25, (tt) => (Math.sin(TWO_PI * f * tt) + 0.3 * Math.sin(2 * TWO_PI * f * tt)) * Math.exp(-tt * 14)), ts, 0.12);
      if (k % 4 === 0) put(out, sweep(0.18, (tt) => 100 * Math.exp(-tt * 30) + 48, (tt) => Math.exp(-tt * 14)), ts, 0.4);
      if (k % 4 === 2) put(out, synth(0.12, (tt) => rng() * Math.exp(-tt * 30)), ts, 0.1);
      if (k % 2 === 1) put(out, synth(0.02, (tt) => rng() * Math.exp(-tt * 200)), ts, 0.05);
    }
    const bassF = nf(root - 12);
    put(out, synth(beat * 4, (tt) => Math.sin(TWO_PI * bassF * tt) * Math.exp(-tt * 1.5)), t, 0.3);
  }
  return out;
};

// ---------------------------------------------------------------- SFX Generators

const swish = (rng: Rng, d = 0.35): Float64Array => {
  const noise = synth(d, () => rng());
  return synth(d, (_t, i, n) => {
    let s = 0;
    for (let j = i - 2; j <= i + 1; j += 1) if (j >= 0 && j < n) s += noise[j];
    return (s / 4) * Math.sin((Math.PI * i) / (n - 1)) ** 3;
  });
};

const whooshFast = (rng: Rng, d = 0.22): Float64Array => {
  const noise = synth(d, () => rng());
  return synth(d, (_t, i, n) => {
    const env = Math.sin((Math.PI * i) / (n - 1)) ** 4;
    let s = 0;
    for (let j = i - 2; j <= i + 1; j += 1) if (j >= 0 && j < n) s += noise[j];
    return (s / 4) * env;
  });
};

const whooshHeavy = (rng: Rng, d = 0.42): Float64Array => {
  const sub = sweep(d, (tt) => 60 + 180 * Math.sin((Math.PI * tt) / d), (tt) => Math.sin((Math.PI * tt) / d) ** 2);
  const noise = synth(d, () => rng() * 0.4);
  return synth(d, (_t, i, n) => {
    const env = Math.sin((Math.PI * i) / (n - 1)) ** 2;
    return sub[i] * 0.7 + noise[i] * env * 0.3;
  });
};

const punchImpact = (): Float64Array => {
  const d = 0.18;
  const sub = sweep(d, (tt) => 120 * Math.exp(-tt * 24) + 42, (tt) => Math.exp(-tt * 18));
  const snap = sweep(0.04, (tt) => 1200 * Math.exp(-tt * 80) + 100, (tt) => Math.exp(-tt * 60));
  return synth(d, (_t, i) => sub[i] + (i < snap.length ? snap[i] * 0.5 : 0));
};

const laserSlice = (): Float64Array =>
  sweep(0.14, (tt) => 2400 * Math.exp(-tt * 22) + 220, (tt) => Math.exp(-tt * 16));

const cyberBlip = (): Float64Array => {
  const d = 0.1;
  return synth(d, (t) => {
    const f = t < 0.04 ? 1200 : 1800;
    return Math.sin(TWO_PI * f * t) * Math.exp(-t * 28);
  });
};

const typewriterClick = (rng: Rng): Float64Array => {
  const d = 0.04;
  return synth(d, (t) => (rng() * 0.7 + 0.3 * Math.sin(TWO_PI * 1800 * t)) * Math.exp(-t * 120));
};

const pop = (): Float64Array =>
  sweep(0.08, (tt) => 400 + (1600 * tt) / 0.08, (tt) => Math.exp(-tt * 30));

// Build-up riser (1.2s): swelling sweep that peaks into the next cut.
const riser = (): Float64Array => {
  const d = 1.2;
  const tone = sweep(d, (tt) => 200 + 1400 * (tt / d), (tt) => Math.sin((Math.PI * tt) / d / 2) ** 2);
  return synth(d, (_t, i) => tone[i] * 0.8);
};

// Warm success chime: two soft sine partials, 0.5s decay.
const chime = (): Float64Array =>
  synth(0.5, (t) => (Math.sin(TWO_PI * 880 * t) * 0.6 + Math.sin(TWO_PI * 1320 * t) * 0.3) * Math.exp(-t * 8));

// Twinkle shimmer for data reveals: gentle rising whistle, 0.25s.
const shimmer = (): Float64Array =>
  sweep(0.25, (tt) => 2400 + 3200 * tt, (tt) => Math.exp(-tt * 10) * Math.sin((Math.PI * tt) / 0.25));

// Low air swell for camera pushes: soft noise breath + sub sine, 0.8s.
const swell = (rng: Rng): Float64Array => {
  const d = 0.8;
  const noise = synth(d, () => rng());
  return synth(d, (_t, i, n) => {
    let s = 0;
    for (let j = i - 3; j <= i + 3; j += 1) if (j >= 0 && j < n) s += noise[j];
    const env = Math.sin((Math.PI * i) / (n - 1)) ** 2;
    return ((s / 7) * 0.6 + Math.sin(TWO_PI * 70 * (i / SR)) * 0.4) * env;
  });
};

const SFX: Record<SfxName, (rng: Rng) => Float64Array> = {
  swish: (rng) => swish(rng),
  pop: () => pop(),
  whoosh_fast: (rng) => whooshFast(rng),
  whoosh_heavy: (rng) => whooshHeavy(rng),
  punch_impact: () => punchImpact(),
  laser_slice: () => laserSlice(),
  cyber_blip: () => cyberBlip(),
  typewriter_click: (rng) => typewriterClick(rng),
  riser: () => riser(),
  chime: () => chime(),
  shimmer: () => shimmer(),
  swell: (rng) => swell(rng),
};

// Peak targets per SFX family (dBFS). UI sounds whisper; only the title hit
// carries weight. Nothing here may approach the voice track.
const DEFAULT_SFX_DB: Record<SfxName, number> = {
  swish: -27,
  whoosh_fast: -27,
  whoosh_heavy: -26,
  punch_impact: -22,
  laser_slice: -26,
  cyber_blip: -30,
  typewriter_click: -30,
  pop: -30,
  riser: -26,
  chime: -24,
  shimmer: -28,
  swell: -26,
};

/** Deterministic pitch variants so repeats don't sound robotic (±5%). */
const RATE_VARIANTS = [0.95, 1.0, 1.05];

const resample = (x: Float64Array, rate: number): Float64Array => {
  if (Math.abs(rate - 1) < 1e-6) return x;
  const n = Math.max(1, Math.floor(x.length / rate));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const pos = i * rate;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = x[j] * (1 - frac) + (j + 1 < x.length ? x[j + 1] * frac : 0);
  }
  return out;
};

/**
 * One subtle cue per scene, mapped by story event (house SFX law):
 * kinetic slam → impact; finale → warm chime; penultimate → riser building
 * into it; data reveals → shimmer; camera pushes → swell; cuts → whooshes.
 * Never stacked, always whisper-quiet next to the voice.
 * Matches jobs.ts timeline entries ({from} in frames, 30fps).
 */
export const buildCues = (scenes: Array<{ from: number; visual: TimelineScene['visual']; transition?: TimelineScene['transition'] }>): Cue[] => {
  const FPS = 30;
  return scenes.flatMap((scene, index): Cue[] => {
    const start = scene.from / FPS;
    const isFinal = index === scenes.length - 1;
    const isPenult = index === scenes.length - 2 && scenes.length > 2;
    if (scene.visual === 'kinetic_typography') {
      return [{ sfx: 'punch_impact', t: start + 0.15, db: -22 }];
    }
    if (isFinal && index > 0) {
      return [{ sfx: 'chime', t: start + (OVERLAP / 2) / FPS, db: -24 }];
    }
    if (isPenult) {
      // Riser peaks into the finale cut.
      return [{ sfx: 'riser', t: Math.max(0, start + (OVERLAP / 2) / FPS - 1.0), db: -26 }];
    }
    if (index === 0) {
      return [{ sfx: 'pop', t: start + 0.15, db: -30 }];
    }
    const transT = start + (OVERLAP / 2) / FPS;
    if (scene.visual === 'stat_spotlight' || scene.visual === 'radial_gauge') {
      return [{ sfx: 'shimmer', t: transT, db: -28 }];
    }
    if (scene.transition === 'slide-up') {
      return [{ sfx: 'swell', t: transT, db: -26 }];
    }
    if (scene.transition === 'wipe-left' || scene.visual === 'split_screen') {
      return [{ sfx: 'laser_slice', t: transT, db: -26 }];
    }
    if (index % 3 === 0) return [{ sfx: 'whoosh_heavy', t: transT, db: -26 }];
    if (index % 3 === 1) return [{ sfx: 'whoosh_fast', t: transT, db: -27 }];
    return [{ sfx: 'swish', t: transT, db: -27 }];
  });
};

const writeWav = async (filePath: string, mono: Float64Array): Promise<void> => {
  const frames = mono.length;
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const s = Math.round(Math.max(-1, Math.min(1, mono[i])) * 32767);
    buf.writeInt16LE(s, 44 + i * 4);
    buf.writeInt16LE(s, 46 + i * 4);
  }
  await fs.writeFile(filePath, buf);
};

export type BuildSoundtrackOptions = {
  durationInSeconds: number;
  cues: Cue[];
  musicPath: string;
  sfxPath: string;
  theme?: ReelTheme;
};

export const buildSoundtrack = async ({
  durationInSeconds,
  cues,
  musicPath,
  sfxPath,
  theme,
}: BuildSoundtrackOptions): Promise<void> => {
  const rng = makeRng(7);
  const dur = durationInSeconds + 0.1;
  const n = Math.floor(SR * dur);

  let bed: Float64Array;
  if (theme === 'tech') {
    bed = cyberSynthMusic(dur, rng);
  } else if (theme === 'storytelling') {
    bed = cinematicAmbientMusic(dur);
  } else {
    bed = upbeatGrooveMusic(dur, rng);
  }

  const fadeIn = Math.floor(0.8 * SR);
  const fadeOut = Math.min(n, Math.floor(2 * SR));
  for (let i = 0; i < fadeIn; i += 1) bed[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i += 1) bed[n - 1 - i] *= i / fadeOut;
  peakNormalize(bed, MUSIC_DB);

  const sfx = new Float64Array(n);
  cues.forEach((cue, ci) => {
    const gen = SFX[cue.sfx] || SFX.swish;
    // Pitch variant + ±1dB deterministic jitter so repeats don't sound looped.
    const rate = RATE_VARIANTS[ci % RATE_VARIANTS.length];
    const jitter = (((ci * 37) % 5) - 2) * 0.5;
    const targetDb = (cue.db ?? DEFAULT_SFX_DB[cue.sfx] ?? -28) + jitter;
    put(sfx, peakNormalize(resample(gen(rng), rate), targetDb), Math.max(0, cue.t - SFX_LEAD_SECONDS), 1);
  });

  await writeWav(musicPath, bed);
  await writeWav(sfxPath, sfx);
};
