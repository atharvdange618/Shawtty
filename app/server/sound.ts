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
import type { Cue, SfxName } from '../types';

const SR = 44100;
const MUSIC_DB = -21;
const TWO_PI = 2 * Math.PI;
const nf = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const dbToGain = (db: number): number => 10 ** (db / 20);

type Rng = () => number;

// Seeded so the same plan always gets the same soundtrack (numpy used default_rng(7)).
const makeRng = (seed = 7): Rng => {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box-Muller: standard normal, like numpy's standard_normal.
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(TWO_PI * uniform());
};

const synth = (seconds: number, fn: (t: number, i: number, n: number) => number): Float64Array => {
  const n = Math.floor(seconds * SR);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = fn(i / SR, i, n);
  return x;
};

// Pitch-swept sine: phase is the running sum of the instantaneous frequency.
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

// Bouncy 120 bpm pluck over a I-vi-IV-V style loop, with kick, snare, hats and bass.
const music = (dur: number, rng: Rng): Float64Array => {
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

const swish = (rng: Rng, d = 0.35): Float64Array => {
  const noise = synth(d, () => rng());
  // 4-tap moving average ('same' convolution) softens the noise into air.
  return synth(d, (_t, i, n) => {
    let s = 0;
    for (let j = i - 2; j <= i + 1; j += 1) if (j >= 0 && j < n) s += noise[j];
    return (s / 4) * Math.sin((Math.PI * i) / (n - 1)) ** 3;
  });
};

const pop = (): Float64Array =>
  sweep(0.08, (tt) => 400 + (1600 * tt) / 0.08, (tt) => Math.exp(-tt * 30));

const SFX: Record<SfxName, (rng: Rng) => Float64Array> = {
  swish: (rng) => swish(rng),
  pop: () => pop(),
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
};

export const buildSoundtrack = async ({
  durationInSeconds,
  cues,
  musicPath,
  sfxPath,
}: BuildSoundtrackOptions): Promise<void> => {
  const rng = makeRng(7);
  const dur = durationInSeconds + 0.1;
  const n = Math.floor(SR * dur);

  const bed = music(dur, rng);
  const fadeIn = Math.floor(0.8 * SR);
  const fadeOut = Math.min(n, Math.floor(2 * SR));
  for (let i = 0; i < fadeIn; i += 1) bed[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i += 1) bed[n - 1 - i] *= i / fadeOut;
  peakNormalize(bed, MUSIC_DB);

  const sfx = new Float64Array(n);
  for (const cue of cues) {
    put(sfx, peakNormalize(SFX[cue.sfx](rng), cue.db ?? -20), Math.max(0, cue.t), 1);
  }

  await writeWav(musicPath, bed);
  await writeWav(sfxPath, sfx);
};
