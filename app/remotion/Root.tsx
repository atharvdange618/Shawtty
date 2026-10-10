import { Composition } from 'remotion';
import { GeneratedReel } from './GeneratedReel';
import type { ReelInputProps } from '../types';

const FPS = 30;

const defaultProps: ReelInputProps = {
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
      kicker: 'Prompt',
      headline: 'Start with one idea',
      body: 'Write what the reel should explain, pitch, or teach.',
      visual: 'orbit',
      accent: '#35d6ff',
      durationWeight: 1,
    },
    {
      kicker: 'Agent',
      headline: 'Build the motion plan',
      body: 'The model turns your prompt into a timeline of concise visual beats.',
      visual: 'cards',
      accent: '#ffcc66',
      durationWeight: 1,
    },
    {
      kicker: 'Render',
      headline: 'Sync voice and video',
      body: 'Remotion renders the final vertical MP4 using the speech duration.',
      visual: 'pulse',
      accent: '#ff6b8a',
      durationWeight: 1,
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
      const duration = Math.max(5, Math.min(90, Number(props.durationInSeconds) || 10));

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
