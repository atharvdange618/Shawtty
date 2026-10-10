import fs from 'node:fs/promises';
import path from 'node:path';
import { renderReel } from '../server/render';
import { buildEntrySource } from '../server/codegen';
import { paths } from '../server/config';
import type { ReelInputProps } from '../types';

// Smoke-test fixture: a tiny hand-written bespoke component exercising the
// REAL product path (custom entry → bundle → still probe → render), the same
// way an LLM-written component travels. No paid APIs.
const FIXTURE_COMPONENT = `import { interpolate } from "remotion";
type Props = { t: number; totalFrames: number; beatIndex: number; beat: string; headline: string; visual: string; visualData: Record<string, any>; accent: string; theme: { bg: string; text: string; muted: string; accent2: string } };
export const GeneratedVisual = (p: Props) => {
  const enter = interpolate(p.t, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, opacity: enter }}>
      <div style={{ fontSize: 64, fontWeight: 900, color: p.theme.text, textAlign: 'center' }}>{p.headline}</div>
      <div style={{ fontSize: 28, color: p.accent, fontWeight: 700 }}>{p.beat}</div>
    </div>
  );
};
`;

const inputProps: ReelInputProps = {
  jobId: 'smoke',
  title: 'Smoke Test Reel',
  prompt: 'Verify the Remotion renderer path without calling any paid APIs.',
  narration: 'This local render confirms that the Remotion server pipeline works.',
  audioFile: '',
  durationInSeconds: 6,
  style: {
    mood: 'clean technical smoke test',
    palette: ['#101317', '#35d6ff', '#ffcc66', '#ff6b8a'],
  },
  scenes: [
    {
      kicker: 'Check',
      headline: 'Server render path',
      body: 'The same function used by jobs renders this file.',
      narrationBeat: 'The same function used by jobs renders this file.',
      visual: 'orbit',
      accent: '#35d6ff',
      durationWeight: 1,
      start: 0,
      end: 3,
      wordTimings: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 2.7, 2.9],
    },
    {
      kicker: 'Output',
      headline: 'Saved in reel folder',
      body: 'The generated MP4 lands at reel/smoke/reel.mp4.',
      narrationBeat: 'The generated MP4 lands at reel/smoke/reel.mp4.',
      visual: 'cards',
      accent: '#ffcc66',
      durationWeight: 1,
      start: 3,
      end: 6,
      wordTimings: [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8],
    },
  ],
};

const jobDir = path.join(paths.reelDir, 'smoke');
await fs.mkdir(jobDir, { recursive: true });
await fs.writeFile(path.join(jobDir, 'visual.generated.tsx'), `${FIXTURE_COMPONENT}\n`);
await fs.writeFile(path.join(jobDir, 'entry.generated.tsx'), `${buildEntrySource()}\n`);

await renderReel({
  jobId: 'smoke',
  inputProps,
  customEntry: path.join(jobDir, 'entry.generated.tsx'),
  onProgress: (progress) => {
    if (progress % 20 === 0) {
      console.log(`render ${progress}%`);
    }
  },
});

console.log('Rendered reel/smoke/reel.mp4');
