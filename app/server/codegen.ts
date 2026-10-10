// Runtime visual codegen: a bespoke Remotion component per video.
//
// The fixed template renderer is the ceiling on creativity — every video
// reuses the same 18 layouts. So the agent now writes ONE custom
// `GeneratedVisual` component per job under a strict contract (props,
// canvas, motion law, ban-list), then renders through a per-job bundle.
// Validation chain: security scan → tsc typecheck → webpack bundle →
// still-frame probe. tsc catches hallucinated component APIs (e.g. invented
// props) that bundlers strip silently and only explode at render time.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { generateVisualCode } from './aicredits';
import { paths } from './config';
import { ATLAS_LAW, CANVAS_LAW, CONTINUITY_LAW, DESIGN_LAW, EXPORT_CONTRACT, MOTION_LAW, REMOTION_LAW, ROLE, SFX_LAW } from './prompts';
import type { ReelPlan } from '../types';

export const GENERATED_VISUAL_FILE = 'visual.generated.tsx';
export const GENERATED_ENTRY_FILE = 'entry.generated.tsx';
export const JOB_COMPOSITION_ID = 'JobReel';
const MAX_CODE_CHARS = 60000;

// ---------------------------------------------------------------- Prompt

export type CodegenBeat = {
  text: string;
  start: number;
  end: number;
  visual: string;
  /** True when the system renders this beat as a full-bleed Ken Burns photo (not your component). */
  hasPhoto: boolean;
};

/**
 * The hardened system prompt, assembled from server/prompts.ts (the single
 * source of truth). Pure (unit-tested).
 */
export const buildCodegenPrompt = ({
  title,
  theme,
  mood,
  tokens,
  beats,
}: {
  title: string;
  theme: string;
  mood: string;
  tokens: { bg: string; text: string; muted: string; accent: string; accent2: string };
  beats: Array<CodegenBeat & { headline: string; visualDataJson: string }>;
}): { system: string; user: string } => {
  const system = [
    ROLE,
    'You write exactly ONE component. It must compile under TypeScript strict + render deterministically in headless Chromium. There is no second chance at runtime syntax — write carefully.',
    CANVAS_LAW,
    MOTION_LAW,
    DESIGN_LAW,
    SFX_LAW,
    ATLAS_LAW,
    REMOTION_LAW,
    CONTINUITY_LAW,
    EXPORT_CONTRACT,
  ].join('\n\n');

  const beatTable = beats
    .map(
      (b, i) =>
        `Beat ${i} [${b.start.toFixed(2)}s–${b.end.toFixed(2)}s] intent=${b.visual} headline="${b.headline}"${b.hasPhoto ? ' HAS_PHOTO(visualData.imageUrl is a photo for this beat — open with a slow Ken Burns treatment 1.06→1.2 plus your graphics, never a static frame)' : ''}\nwords: "${b.text}"\nvisualData: ${b.visualDataJson}`,
    )
    .join('\n\n');

  const user = [
    `Video: "${title}" (theme ${theme}, mood ${mood}).`,
    `Tokens: ${JSON.stringify(tokens)}.`,
    '',
    `Design EXACTLY ${beats.length} beat compositions (beatIndex 0–${beats.length - 1}):`,
    '',
    beatTable,
  ].join('\n');

  return { system, user };
};

// ---------------------------------------------------------------- Security scan

const ALLOWED_IMPORTS = new Set(['react', 'remotion', '@remotion/shapes']);

const DENIED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\brequire\s*\(/, label: 'require()' },
  { re: /\beval\s*\(/, label: 'eval()' },
  { re: /\bFunction\s*\(/, label: 'Function constructor' },
  { re: /\bprocess\b/, label: 'process object' },
  { re: /\bglobalThis\b/, label: 'globalThis' },
  { re: /\bwindow\b/, label: 'window' },
  { re: /\bdocument\b/, label: 'document' },
  { re: /\blocalStorage\b/, label: 'localStorage' },
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /[^a-zA-Z]import\s*\(/, label: 'dynamic import()' },
  { re: /child_process/, label: 'child_process' },
  { re: /from\s+['"]node:/, label: 'node: import' },
  { re: /\b__dirname\b/, label: '__dirname' },
  { re: /\b__filename\b/, label: '__filename' },
  { re: /\bMath\.random\s*\(/, label: 'Math.random()' },
  { re: /\bDate\.now\s*\(/, label: 'Date.now()' },
  { re: /\bsetTimeout\s*\(/, label: 'setTimeout()' },
  { re: /\bsetInterval\s*\(/, label: 'setInterval()' },
  { re: /\buseEffect\s*\(/, label: 'useEffect()' },
  { re: /\buseState\s*\(/, label: 'useState()' },
  { re: /dangerouslySetInnerHTML/, label: 'dangerouslySetInnerHTML' },
  { re: /<\s*img[\s>]/, label: '<img> tag (use remotion <Img>)' },
  { re: /<\s*image[\s>]/, label: '<image> tag' },
];

/** Find the balanced-brace block starting at the opening brace index. */
const balancedEnd = (src: string, openIdx: number): number => {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Remove frozen-motion declarations from generated source: @keyframes blocks
 * (balanced), animation and transition style props (inside style={{...}}
 * only, so beat copy like "Transition: fade" is untouched), remote font
 * loading (@import/@font-face lines, <link> tags). Returns the cleaned
 * source plus what was removed. tsc runs after — any bad surgery fails
 * loudly there.
 */
export const stripFrozenMotion = (code: string): { code: string; stripped: string[] } => {
  const stripped: string[] = [];
  let out = code;

  // @keyframes NAME { ... } — balanced removal anywhere.
  for (;;) {
    const at = out.indexOf('@keyframes');
    if (at < 0) break;
    const open = out.indexOf('{', at);
    if (open < 0) break;
    const end = balancedEnd(out, open);
    if (end < 0) break;
    out = out.slice(0, at) + out.slice(end + 1);
    stripped.push('@keyframes block');
  }

  // Animation/transition props — only inside style={{ ... }} regions, in
  // comma-preserving order (middle, first, last, sole) so objects stay valid.
  const NAME = '(?:animation|transition)[A-Za-z]*';
  const VAL = `"[^"]*"|'[^']*'|[^,;}]+`;
  const stripRegion = (region: string): string =>
    region
      .replace(new RegExp(`,\\s*${NAME}\\s*:\\s*(?:${VAL})\\s*,`, 'g'), ',')
      .replace(new RegExp(`${NAME}\\s*:\\s*(?:${VAL})\\s*,`, 'g'), '')
      .replace(new RegExp(`,\\s*${NAME}\\s*:\\s*(?:${VAL})`, 'g'), '')
      .replace(new RegExp(`${NAME}\\s*:\\s*(?:${VAL})`, 'g'), '');
  let cursor = 0;
  for (;;) {
    const styleAt = out.indexOf('style={{', cursor);
    if (styleAt < 0) break;
    const open = out.indexOf('{{', styleAt);
    const end = balancedEnd(out, open + 1);
    if (end < 0) break;
    const before = out.slice(0, open + 1);
    const region = out.slice(open + 1, end);
    const after = out.slice(end);
    const cleaned = stripRegion(region);
    if (cleaned !== region) stripped.push('CSS animation/transition declaration');
    out = before + cleaned + after;
    cursor = open + 1 + cleaned.length;
  }

  // Remote font loading: line-anchored at-rules + link tags.
  const fontStartLen = out.length;
  out = out.replace(/^\s*@(import|font-face)[^;\n]*;?/gm, '');
  out = out.replace(/<link\b[^>]*\/?>/g, '');
  if (out.length !== fontStartLen) stripped.push('remote font loading');

  return { code: out, stripped: [...new Set(stripped)] };
};

export type ScanResult = { ok: true } | { ok: false; error: string };

const execFileAsync = promisify(execFile);

/**
 * Typecheck a written generated component with the project's TypeScript.
 * Returns the first few TS errors as text, or null when clean. Pure
 * filesystem + tsc (unit-tested with tiny fixtures).
 */
export const typecheckVisualCode = async (visualPath: string): Promise<string | null> => {
  const tscBin = path.join(paths.reelDir, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    await execFileAsync(process.execPath, [
      tscBin,
      '--noEmit',
      '--jsx',
      'react-jsx',
      '--strict',
      '--skipLibCheck',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--target',
      'es2020',
      '--lib',
      'es2020,dom',
      visualPath,
    ]);
    return null;
  } catch (error) {
    const stdout = String((error as { stdout?: unknown }).stdout ?? '');
    const lines = stdout.split('\n').filter((l) => /error TS/.test(l)).slice(0, 4);
    const detail = lines.length > 0 ? lines.join('\n') : String(error instanceof Error ? error.message : error);
    return detail.slice(0, 800);
  }
};

/**
 * Static allowlist/denylist scan for LLM-written components. Pure (unit-tested).
 * Besides safety, this enforces the craft bar: real SVG illustration and
 * enough code to hold detail — text-only components are rejected, not aired.
 */
export const scanGeneratedCode = (code: string): ScanResult => {
  if (!code || code.trim().length < 2000) {
    return { ok: false, error: 'code too short for a detailed multi-beat component (min 2000 chars)' };
  }
  if (code.length > MAX_CODE_CHARS) {
    return { ok: false, error: `code exceeds ${MAX_CODE_CHARS} chars` };
  }
  if (!/<svg[\s>]/.test(code)) {
    return { ok: false, error: 'no <svg> illustration found — every beat must DRAW its concept, not just typeset it' };
  }
  const importRe = /(?:import\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\))/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const source = m[1] ?? m[2] ?? '';
    // Exact match first (covers scoped packages like @remotion/shapes),
    // then bare top-level packages (react, remotion).
    const allowed = ALLOWED_IMPORTS.has(source) || ALLOWED_IMPORTS.has(source.split('/')[0]);
    if (!allowed) {
      return { ok: false, error: `forbidden import: "${source}" (only react, remotion, @remotion/shapes allowed)` };
    }
  }
  for (const { re, label } of DENIED_PATTERNS) {
    if (re.test(code)) {
      return { ok: false, error: `forbidden pattern: ${label}` };
    }
  }
  if (!/export\s+(const|function)\s+GeneratedVisual\b/.test(code)) {
    return { ok: false, error: 'missing required export: GeneratedVisual' };
  }
  return { ok: true };
};

// ---------------------------------------------------------------- Entry builder

/**
 * Trusted per-job Remotion entry (server-written, never LLM-written).
 * Provides the GeneratedVisual via context so the template renderer picks
 * it up; the JobReel composition mirrors the main one's metadata rules.
 */
export const buildEntrySource = (): string =>
  [
    `import { Composition, registerRoot } from 'remotion';`,
    `import { CustomVisualProvider, GeneratedReel } from '../../remotion/GeneratedReel';`,
    `import { GeneratedVisual } from './${GENERATED_VISUAL_FILE.replace(/\.tsx$/, '')}';`,
    `import type { ReelInputProps } from '../../types';`,
    ``,
    `const FPS = 30;`,
    ``,
    `const JobReel = (props: ReelInputProps) => (`,
    `  <CustomVisualProvider value={GeneratedVisual}>`,
    `    <GeneratedReel {...props} />`,
    `  </CustomVisualProvider>`,
    `);`,
    ``,
    `const fallbackProps = {`,
    `  jobId: 'preview',`,
    `  title: 'Custom Reel',`,
    `  prompt: '',`,
    `  narration: '',`,
    `  scenes: [],`,
    `  style: { mood: '', palette: [] },`,
    `  audioFile: '',`,
    `  durationInSeconds: 10,`,
    `} as ReelInputProps;`,
    ``,
    `export const RemotionRoot = () => (`,
    `  <Composition`,
    `    id="${JOB_COMPOSITION_ID}"`,
    `    component={JobReel}`,
    `    durationInFrames={FPS * 10}`,
    `    fps={FPS}`,
    `    width={1080}`,
    `    height={1920}`,
    `    defaultProps={fallbackProps}`,
    `    calculateMetadata={({ props }) => {`,
    `      const duration = Math.max(5, Math.min(180, Number(props.durationInSeconds) || 10));`,
    `      return {`,
    `        durationInFrames: Math.ceil(duration * FPS),`,
    `        props: { ...props, durationInSeconds: duration },`,
    `      };`,
    `    }}`,
    `  />`,
    `);`,
    ``,
    `registerRoot(RemotionRoot);`,
    ``,
  ].join('\n');

// ---------------------------------------------------------------- Orchestration

export const buildCustomVisual = async ({
  jobId,
  plan,
}: {
  jobId: string;
  plan: ReelPlan;
}): Promise<string | null> => {
  try {
    const tokens = {
      bg: '#0B0D12',
      text: '#F2F4F8',
      muted: '#9AA3B2',
      accent: plan.style.palette[1] ?? '#7C83FF',
      accent2: plan.style.palette[2] ?? '#22D3EE',
    };
    const beats = plan.scenes.map((s) => ({
      text: s.narrationBeat || s.body,
      start: typeof s.start === 'number' ? s.start : 0,
      end: typeof s.end === 'number' ? s.end : 0,
      visual: s.visual,
      headline: s.headline,
      hasPhoto: Boolean(s.imageUrl || s.visualData?.imageUrl),
      visualDataJson: JSON.stringify(s.visualData ?? {}),
    }));

    const brief = {
      title: plan.title,
      theme: plan.theme ?? 'education',
      mood: plan.style.mood,
      tokens,
      beats,
    };
    const jobDir = path.join(paths.reelDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const record = async (ok: boolean, error: string | null, chars?: number): Promise<null> => {
      await fs.writeFile(
        path.join(jobDir, 'codegen.json'),
        `${JSON.stringify({ ok, error, chars: chars ?? 0, beats: beats.length }, null, 2)}\n`,
      );
      return null;
    };

    // Rejected source is saved for diagnosis (never rendered).
    const saveRejected = async (rejected: string): Promise<void> => {
      try {
        await fs.writeFile(path.join(jobDir, 'visual.rejected.tsx'), `${rejected}\n`);
      } catch {
        // Diagnosis only — never fail the job over it.
      }
    };

    // One generation round: LLM call (+fresh retry on empty, unless the
    // wallet is empty — then fail fast) then scan (+one fixHint retry on
    // scan failure). Returns validated source or null (reason recorded).
    let lastError: string | null = null;
    const produce = async (fixHint: string | null): Promise<string | null> => {
      const prompt = buildCodegenPrompt(brief);
      const first = await generateVisualCode(
        fixHint ? { system: prompt.system, user: `${prompt.user}\n\nPREVIOUS ATTEMPT REJECTED: ${fixHint}. Fix exactly this and nothing else.` } : prompt,
      );
      let code = first.code;
      lastError = first.error ?? null;
      if (!code) {
        if (lastError && /balance exhausted/i.test(lastError)) return null;
        // Truncation/invalid-JSON failures vary run to run — one fresh attempt
        // often fits where the last was cut off.
        console.warn(`[job ${jobId}] codegen came back empty — one fresh retry.`);
        const second = await generateVisualCode(prompt);
        code = second.code;
        lastError = second.error ?? lastError;
        if (!code) return null;
      }
      if (!scanGeneratedCode(code).ok) {
        const err = (scanGeneratedCode(code) as { error: string }).error;
        console.warn(`[job ${jobId}] codegen scan failed (${err}) — one retry with the error fed back.`);
        const retry = buildCodegenPrompt(brief);
        const res = await generateVisualCode({
          system: retry.system,
          user: `${retry.user}\n\nPREVIOUS ATTEMPT REJECTED: ${err}. Fix exactly this and nothing else.`,
        });
        code = res.code;
        lastError = res.error ?? lastError;
        if (code && !scanGeneratedCode(code).ok) {
          const err2 = (scanGeneratedCode(code) as { error: string }).error;
          console.warn(`[job ${jobId}] codegen retry failed (${err2}).`);
          await saveRejected(code);
          lastError = err2;
          return null;
        }
        if (!code) return null;
      }
      lastError = null;
      return code;
    };

    const writeFiles = async (code: string): Promise<void> => {
      await fs.writeFile(path.join(jobDir, GENERATED_VISUAL_FILE), `${code.replace(/\s+$/, '')}\n`);
      await fs.writeFile(path.join(jobDir, GENERATED_ENTRY_FILE), `${buildEntrySource()}\n`);
    };

    let code = await produce(null);
    if (!code) {
      const err = lastError ?? 'LLM returned no usable component after retries (see server log)';
      console.warn(`[job ${jobId}] visual codegen returned nothing (${err}) — no fallback, job will fail honestly.`);
      await record(false, err);
      return null;
    }
    // Frozen-motion surgery: strip non-rendering CSS animation/keyframes and
    // remote font loading instead of burning a regen on a style habit. tsc +
    // probe verify the result below.
    const surgery = stripFrozenMotion(code);
    if (surgery.stripped.length > 0) {
      console.warn(`[job ${jobId}] stripped non-rendering code (${surgery.stripped.join(', ')}) instead of regenerating.`);
      code = surgery.code;
    }
    await writeFiles(code);

    // tsc gate: catches hallucinated component APIs the bundler would strip
    // silently (e.g. invented <Arrow from/to> props that explode at render).
    const visualPath = path.join(jobDir, GENERATED_VISUAL_FILE);
    let typeError = await typecheckVisualCode(visualPath);
    if (typeError) {
      console.warn(`[job ${jobId}] codegen typecheck failed — one repair round.`);
      const fixed = await produce(`TypeScript errors in your component:\n${typeError}`);
      if (fixed) {
        await writeFiles(fixed);
        typeError = await typecheckVisualCode(visualPath);
        if (!typeError) code = fixed;
      }
      if (typeError) {
        const err = `typecheck failed twice (${typeError.split('\n')[0]})`;
        console.warn(`[job ${jobId}] codegen repair failed — no fallback, job will fail honestly.`);
        await record(false, err);
        return null;
      }
    }

    await record(true, null, code.length);
    console.log(`[job ${jobId}] custom visual written (${code.length} chars, ${beats.length} beats).`);
    return path.join(jobDir, GENERATED_ENTRY_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[job ${jobId}] visual codegen crashed (${message}) — no fallback, job will fail honestly.`);
    try {
      await fs.writeFile(
        path.join(paths.reelDir, jobId, 'codegen.json'),
        `${JSON.stringify({ ok: false, error: message.slice(0, 300), chars: 0, beats: 0 }, null, 2)}\n`,
      );
    } catch {
      // Best effort — the job error still carries the failure.
    }
    return null;
  }
};

/**
 * Repair round after a still-probe render failure: regenerate with the exact
 * probe error fed back, re-validate (scan + tsc), rewrite, and hand back the
 * entry path — or null when unrecoverable. Called at most once per job.
 */
export const repairVisualCode = async ({
  jobId,
  plan,
  error,
}: {
  jobId: string;
  plan: ReelPlan;
  error: string;
}): Promise<string | null> => {
  try {
    const tokens = {
      bg: '#0B0D12',
      text: '#F2F4F8',
      muted: '#9AA3B2',
      accent: plan.style.palette[1] ?? '#7C83FF',
      accent2: plan.style.palette[2] ?? '#22D3EE',
    };
    const beats = plan.scenes.map((s) => ({
      text: s.narrationBeat || s.body,
      start: typeof s.start === 'number' ? s.start : 0,
      end: typeof s.end === 'number' ? s.end : 0,
      visual: s.visual,
      headline: s.headline,
      hasPhoto: Boolean(s.imageUrl || s.visualData?.imageUrl),
      visualDataJson: JSON.stringify(s.visualData ?? {}),
    }));
    const prompt = buildCodegenPrompt({
      title: plan.title,
      theme: plan.theme ?? 'education',
      mood: plan.style.mood,
      tokens,
      beats,
    });
    const res = await generateVisualCode({
      system: prompt.system,
      user: `${prompt.user}\n\nPREVIOUS ATTEMPT FAILED AT RENDER: ${error.slice(0, 600)}. Fix exactly this — same beats, same contract.`,
    });
    let code = res.code;
    if (res.error) console.warn(`[job ${jobId}] probe repair note: ${res.error}`);
    if (!code || !scanGeneratedCode(code).ok) {
      console.warn(`[job ${jobId}] probe repair failed scan — giving up honestly.`);
      if (code) {
        try {
          await fs.writeFile(path.join(paths.reelDir, jobId, 'visual.rejected.tsx'), `${code}\n`);
        } catch {
          // Diagnosis only.
        }
      }
      return null;
    }
    const stripped = stripFrozenMotion(code);
    if (stripped.stripped.length > 0) {
      console.warn(`[job ${jobId}] stripped non-rendering code on repair (${stripped.stripped.join(', ')}).`);
      code = stripped.code;
    }
    const jobDir = path.join(paths.reelDir, jobId);
    await fs.writeFile(path.join(jobDir, GENERATED_VISUAL_FILE), `${code.replace(/\s+$/, '')}\n`);
    await fs.writeFile(path.join(jobDir, GENERATED_ENTRY_FILE), `${buildEntrySource()}\n`);
    const typeError = await typecheckVisualCode(path.join(jobDir, GENERATED_VISUAL_FILE));
    if (typeError) {
      console.warn(`[job ${jobId}] repaired code still fails typecheck — giving up honestly.`);
      return null;
    }
    console.log(`[job ${jobId}] probe repair written (${code.length} chars).`);
    return path.join(jobDir, GENERATED_ENTRY_FILE);
  } catch (err) {
    console.warn(
      `[job ${jobId}] probe repair crashed (${err instanceof Error ? err.message : String(err)}).`,
    );
    return null;
  }
};
