import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCodegenPrompt, buildEntrySource, scanGeneratedCode, stripFrozenMotion, tokensForPlan, typecheckVisualCode } from './codegen';
import type { ReelPlan } from '../types';

const GOOD_COMPONENT = `
import { interpolate, spring } from "remotion";
import React from "react";
export const GeneratedVisual = (p: { t: number }) => {
  const s = spring({ frame: p.t, fps: 30, config: { damping: 14 } });
  return (
    <div style={{ opacity: interpolate(s, [0, 1], [0, 1]) }}>
      <svg viewBox="0 0 200 200" style={{ width: 200, height: 200 }}>
        <circle cx="100" cy="100" r="60" fill="none" stroke="#FF6B00" strokeWidth="10" />
        <rect x="40" y="150" width="120" height="14" rx="7" fill="#F2F4F8" />
        <path d="M20 180 L100 120 L180 180" fill="none" stroke="#22D3EE" strokeWidth="6" strokeLinecap="round" />
      </svg>
      <div>Beat with a drawn bucket, dial, and path behind the words</div>
      <div>Supporting detail line that names the effect being shown</div>
      <div>Minute detail: timings, labels, and units all present here</div>
    </div>
  );
};
`.padEnd(2100, '\n// craft padding to clear the detail-density floor. ');

describe('scanGeneratedCode', () => {
  it('accepts a clean contract-shaped component', () => {
    expect(scanGeneratedCode(GOOD_COMPONENT)).toEqual({ ok: true });
  });

  it('rejects missing exports and empty code', () => {
    expect(scanGeneratedCode('').ok).toBe(false);
    expect(scanGeneratedCode('export const Other = () => null;'.padEnd(2100, ' ')).ok).toBe(false);
  });

  it('rejects text-only components with no SVG illustration', () => {
    const textOnly = `
import { spring } from "remotion";
export const GeneratedVisual = (p: { t: number }) => <div>Just words on black, no drawing at all, nothing drawn here</div>;
`.padEnd(2100, '\n// padding. ');
    const result = scanGeneratedCode(textOnly);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/<svg>/);
  });

  it('rejects forbidden imports', () => {
    const code = `${GOOD_COMPONENT}\nimport fs from 'node:fs';\nconsole.log(fs);`;
    const result = scanGeneratedCode(code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forbidden import/);
  });

  it('accepts @remotion/shapes diagram primitives', () => {
    const code = `${GOOD_COMPONENT}\nimport { Arrow, Rect } from '@remotion/shapes';\nconsole.log(Arrow, Rect);`;
    expect(scanGeneratedCode(code)).toEqual({ ok: true });
  });

  it('passes frozen-motion traps through scan (stripFrozenMotion handles them)', () => {
    // CSS animation/keyframes never render in Remotion, but they cannot crash
    // anything — so the scan lets them through and the surgeon removes them.
    const cases = [
      '@keyframes slide { from {} }',
      'style={{ animation: "slide 2s infinite" }}',
      'style={{ transition: "opacity 1s" }}',
      '@import url("https://fonts/x.css");',
      '<link rel="stylesheet" href="x" />',
    ];
    for (const snippet of cases) {
      expect(scanGeneratedCode(`${GOOD_COMPONENT}\n${snippet}`).ok).toBe(true);
    }
  });

  it('rejects execution, network, time, and hook patterns', () => {
    const cases = [
      'const x = eval("1");',
      'fetch("http://x")',
      'Math.random()',
      'Date.now()',
      'useEffect(() => {})',
      'useState(0)',
      'process.env.X',
      'dangerouslySetInnerHTML={{__html: ""}}',
      '<img src="x" />',
    ];
    for (const snippet of cases) {
      const result = scanGeneratedCode(`${GOOD_COMPONENT}\n${snippet}`);
      expect(result.ok).toBe(false);
    }
  });

  it('passes frozen-motion traps through scan (stripFrozenMotion handles them)', () => {
    // CSS animation/keyframes never render in Remotion, but they cannot crash
    // anything — so the scan lets them through and the surgeon removes them.
    const cases = [
      '@keyframes slide { from {} }',
      'style={{ transition: "opacity 1s" }}',
      '@import url("https://fonts/x.css");',
      '<link rel="stylesheet" href="x" />',
    ];
    for (const snippet of cases) {
      expect(scanGeneratedCode(`${GOOD_COMPONENT}\n${snippet}`).ok).toBe(true);
    }
  });
});

describe('stripFrozenMotion', () => {
  it('removes keyframes blocks, CSS motion props, and font loading', () => {
    const src = [
      '@keyframes slide { from { opacity: 0; } to { opacity: 1; } }',
      'const a = <div style={{ opacity: 1, transition: "opacity 1s", animation: "slide 2s", color: "red" }}>x</div>;',
      '@import url("https://fonts/x.css");',
      '<link rel="stylesheet" href="x" />',
      'const b = "Transition: fade is a nice effect";',
    ].join('\n');
    const { code, stripped } = stripFrozenMotion(src);

    expect(stripped.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/@keyframes/);
    expect(code).not.toMatch(/@import/);
    expect(code).not.toMatch(/<link/);
    expect(code).toMatch(/opacity: 1/);
    expect(code).toMatch(/color: "red"/);
    // Beat copy mentioning transitions is untouched (only style props go).
    expect(code).toMatch(/Transition: fade is a nice effect/);
  });

  it('keeps style objects valid when the prop sits first, middle, or last', () => {
    const first = stripFrozenMotion('<div style={{ transition: "x 1s", b: 2 }} />;').code;
    const mid = stripFrozenMotion('<div style={{ b: 1, transition: "x 1s", c: 3 }} />;').code;
    const last = stripFrozenMotion('<div style={{ b: 1, transition: "x 1s" }} />;').code;
    const only = stripFrozenMotion('<div style={{ transition: "x 1s" }} />;').code;

    expect(first).toMatch(/{ +b: 2 +}/);
    expect(mid).toMatch(/{ +b: 1, c: 3 +}/);
    expect(last).toMatch(/{ +b: 1 +}/);
    expect(only).toMatch(/{{\s*}}/);
  });

  it('handles quoted values containing commas', () => {
    const { code } = stripFrozenMotion('<div style={{ transition: "opacity .3s, transform .3s", b: 2 }} />;');

    expect(code).toMatch(/{ +b: 2 +}/);
    expect(code).not.toMatch(/transform \.3s/);
  });
});

describe('buildCodegenPrompt', () => {
  it('embeds the contract, canvas, beats, and tokens', () => {
    const { system, user } = buildCodegenPrompt({
      title: 'Token buckets',
      theme: 'tech',
      mood: 'fast',
      tokens: { bg: '#0B0D12', text: '#F2F4F8', muted: '#9AA3B2', accent: '#FF6B00', accent2: '#22D3EE' },
      beats: [
        {
          text: 'Every request spends a token',
          start: 0.2,
          end: 2.4,
          visual: 'radial_gauge',
          headline: 'Token spend',
          hasPhoto: false,
          visualDataJson: '{"metric":"1 token"}',
        },
      ],
    });

    expect(system).toMatch(/GeneratedVisual/);
    expect(system).toMatch(/1080x1920/);
    expect(system).toMatch(/Math\.random/);
    expect(system).toMatch(/#F2F4F8/);
    expect(system).toMatch(/@remotion\/shapes/);
    expect(system).toMatch(/IDENTICAL coordinates/);
    expect(system).toMatch(/useVideoConfig/);
    expect(system).toMatch(/PERSISTENT STAGE/);
    expect(system).toMatch(/LIGHT PLATE PATTERN/);
    expect(system).toMatch(/DARK DUEL PATTERN/);
    expect(system).toMatch(/enter from INSIDE/);
    expect(user).toMatch(/Beat 0/);
    expect(user).toMatch(/1 token/);
    expect(user).toMatch(/Token spend/);
  });

  it('documents the real shapes API (no from/to props)', () => {
    const { system } = buildCodegenPrompt({
      title: 'x',
      theme: 'tech',
      mood: 'fast',
      tokens: { bg: '#0B0D12', text: '#F2F4F8', muted: '#9AA3B2', accent: '#FF6B00', accent2: '#22D3EE' },
      beats: [],
    });

    expect(system).toMatch(/length\/direction/);
    expect(system).toMatch(/NO from\/to/);
    expect(system).toMatch(/words: string\[\]/);
    expect(system).toMatch(/INSIDE config/);
    expect(system).toMatch(/COMMON ERRORS/);
    expect(system).toMatch(/ONLY the strings left\/right\/up\/down/);
  });
});

describe('tokensForPlan', () => {
  const plan = (mode?: 'dark' | 'light'): ReelPlan => ({
    title: 't',
    narration: 'n',
    scenes: [],
    style: { mood: 'm', palette: ['#000000', '#FF6B00', '#22D3EE'], ...(mode ? { mode } : {}) },
    targetSeconds: null,
  });

  it('emits dark premium tokens by default', () => {
    expect(tokensForPlan(plan())).toEqual({
      bg: '#0B0D12',
      text: '#F2F4F8',
      muted: '#9AA3B2',
      accent: '#FF6B00',
      accent2: '#22D3EE',
    });
  });

  it('emits light paper tokens for education explainers', () => {
    expect(tokensForPlan(plan('light'))).toEqual({
      bg: '#F7F8FA',
      text: '#0F172A',
      muted: '#64748B',
      accent: '#FF6B00',
      accent2: '#22D3EE',
    });
  });
});

describe('typecheckVisualCode', () => {
  const GOOD_TSX = `import { interpolate } from "remotion";
import { Arrow } from "@remotion/shapes";
export const GeneratedVisual = (p: { t: number }) => {
  const w = interpolate(p.t, [0, 30], [0, 100]);
  return (<div><Arrow length={200} direction="right" fill="#fff" /><span>{w}</span></div>);
};
`;

  const BAD_TSX = `import { Arrow } from "@remotion/shapes";
export const GeneratedVisual = (p: { t: number }) => {
  return (<div><Arrow from={{ x: 1, y: 2 }} to={{ x: 3, y: 4 }} /></div>);
};
`;

  it('passes clean code and flags hallucinated props', async () => {
    // Fixtures live under reel/ (git-ignored) so tsc resolves remotion +
    // @remotion/shapes from app/node_modules — same as production files.
    const { paths } = await import('./config');
    const dir = await fs.mkdtemp(path.join(paths.reelDir, '.tsc-test-'));
    const goodPath = path.join(dir, 'good.tsx');
    const badPath = path.join(dir, 'bad.tsx');
    await fs.writeFile(goodPath, GOOD_TSX);
    await fs.writeFile(badPath, BAD_TSX);

    expect(await typecheckVisualCode(goodPath)).toBeNull();
    const err = await typecheckVisualCode(badPath);
    expect(err).not.toBeNull();
    expect(err as string).toMatch(/error TS/);

    await fs.rm(dir, { recursive: true, force: true });
  }, 120000);
});

describe('buildEntrySource', () => {
  it('wires the provider, the generated component, and the JobReel id', () => {
    const src = buildEntrySource();

    expect(src).toMatch(/CustomVisualProvider/);
    expect(src).toMatch(/GeneratedVisual/);
    expect(src).toMatch(/JobReel/);
    expect(src).toMatch(/\.\.\/\.\.\/remotion\/GeneratedReel/);
    expect(src).not.toMatch(/CustomVisual'\]/);
    expect(src).not.toMatch(/remotion\/CustomVisual/);
  });
});
