import { Composition, interpolate, registerRoot } from 'remotion';
import { CustomVisualProvider, GeneratedReel } from './GeneratedReel';
import { defaultProps } from './Root';
import type { GeneratedVisualProps, ReelInputProps } from '../types';

// Studio-only entry. The bare remotion/index.tsx has no visual provider (jobs
// inject an LLM-written one per video), so the stage throws by design. This
// wraps it with a labelled placeholder so the stage — audio, timeline,
// transitions, HUD — can be inspected without running codegen.
const FPS = 30;

const StudioPlaceholderVisual = (p: GeneratedVisualProps) => {
  const enter = interpolate(p.t, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        opacity: enter,
      }}
    >
      <div style={{ fontSize: 24, color: p.theme.muted, letterSpacing: 4 }}>STUDIO PLACEHOLDER</div>
      <div style={{ fontSize: 64, fontWeight: 900, color: p.theme.text, textAlign: 'center' }}>{p.headline}</div>
      <div style={{ fontSize: 28, color: p.accent, fontWeight: 700 }}>{p.visual}</div>
    </div>
  );
};

const StudioReel = (props: ReelInputProps) => (
  <CustomVisualProvider value={StudioPlaceholderVisual}>
    <GeneratedReel {...props} />
  </CustomVisualProvider>
);

const StudioRoot = () => (
  <Composition
    id="GeneratedReel"
    component={StudioReel}
    durationInFrames={FPS * defaultProps.durationInSeconds}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
  />
);

registerRoot(StudioRoot);
