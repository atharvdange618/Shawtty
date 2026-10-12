import { Composition } from 'remotion';
import { GeneratedReel } from './GeneratedReel';
import type { ReelInputProps } from '../types';

const FPS = 30;

export const defaultProps: ReelInputProps = {
  jobId: 'preview',
  title: 'Prompt to Reel',
  prompt: 'Create a short reel about AI agents.',
  narration:
    'Turn one prompt into a clean narrated reel. The agent plans the story, generates the voice, and renders motion graphics that stay in sync.',
  durationInSeconds: 10,
  audioFile: '',
  style: {
    mood: 'crisp, kinetic, modern',
    palette: ['#101317', '#35d6ff', '#ffcc66', '#ff6b8a'],
  },
  scenes: [
    {
      kicker: 'Keynote',
      headline: 'Next-Gen Showcase',
      body: 'Start with any idea or real-world concept.',
      visual: 'bento_grid',
      accent: '#4285F4',
      durationWeight: 1,
      visualData: {
        metric: '10x',
        metricLabel: 'Performance Leap',
        badge: 'STATE OF THE ART',
      },
    },
    {
      kicker: 'Architecture',
      headline: 'Deep Neural Pipeline',
      body: 'Live web intelligence feeds autonomous motion graphics.',
      visual: 'neural_flow',
      accent: '#9B51E0',
      durationWeight: 1,
      visualData: {
        nodes: [
          { label: 'Web Intelligence', sub: 'DuckDuckGo + Wikipedia' },
          { label: 'Motion Engine', sub: '30 FPS Frame Physics' },
          { label: 'Remotion Render', sub: 'H.264 High Profile' },
        ],
      },
    },
    {
      kicker: 'Benchmark',
      headline: 'Cinematic Visual Quality',
      body: 'Google seminar motion graphics designed to impress.',
      visual: 'comparison_matrix',
      accent: '#00E5FF',
      durationWeight: 1,
      visualData: {
        bars: [
          { label: 'Shawtty v2', value: 96, highlight: true },
          { label: 'Generic Reels', value: 45, highlight: false },
        ],
      },
    },
  ],
};

export const RemotionRoot = () => (
  <Composition
    id="GeneratedReel"
    component={GeneratedReel}
    durationInFrames={FPS * defaultProps.durationInSeconds}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const duration = Math.max(5, Math.min(180, Number(props.durationInSeconds) || 10));

      return {
        durationInFrames: Math.ceil(duration * FPS),
        props: {
          ...props,
          durationInSeconds: duration,
        },
      };
    }}
  />
);
