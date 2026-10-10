import { renderReel } from '../server/render';
import type { ReelInputProps } from '../types';

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
      visual: 'orbit',
      accent: '#35d6ff',
      durationWeight: 1,
    },
    {
      kicker: 'Output',
      headline: 'Saved in reel folder',
      body: 'The generated MP4 lands at reel/smoke/reel.mp4.',
      visual: 'cards',
      accent: '#ffcc66',
      durationWeight: 1,
    },
  ],
};

await renderReel({
  jobId: 'smoke',
  inputProps,
  onProgress: (progress) => {
    if (progress % 20 === 0) {
      console.log(`render ${progress}%`);
    }
  },
});

console.log('Rendered reel/smoke/reel.mp4');
