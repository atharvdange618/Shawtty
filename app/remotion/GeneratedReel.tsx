import { createContext, useContext } from 'react';
import type { ReactElement } from 'react';
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { OVERLAP, timelineFor, timelineFromBeats } from '../server/timeline';
import type {
  GeneratedVisualComponent,
  ReelInputProps,
  ReelTheme,
  Scene as SceneModel,
  TimelineScene,
  TransitionType,
} from '../types';

const fontFamily =
  'Inter, "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// Bespoke-visual injection: the per-video LLM component arrives via context
// at module scope (never through serialized Remotion props). No provider =
// codegen failed = the job fails loudly instead of airing filler.
const CustomVisualContext = createContext<GeneratedVisualComponent | null>(null);

export const CustomVisualProvider = CustomVisualContext.Provider;

const useCustomVisual = (): GeneratedVisualComponent | null => useContext(CustomVisualContext);

const safeScenes = (scenes: SceneModel[]): SceneModel[] => {
  if (Array.isArray(scenes) && scenes.length) {
    return scenes;
  }

  return [
    {
      kicker: 'Keynote',
      headline: 'Next-Generation Intelligence',
      body: 'Autonomous motion graphics engineered for creator clarity and impact.',
      narrationBeat: 'Autonomous motion graphics engineered for creator clarity and impact.',
      visual: 'kinetic_typography',
      accent: '#4285F4',
      durationWeight: 1,
      transition: 'fade',
      visualData: {
        highlightWords: ['Next-Gen', 'Intelligence'],
      },
    },
  ];
};

// ---------------------------------------------------------------- Theme Atmospheres

export type ThemeStyle = {
  bg: string;
  orb1: string;
  orb2: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  pillBg: string;
  defaultAccent: string;
};

const THEME_STYLES: Record<ReelTheme, ThemeStyle> = {
  tech: {
    bg: '#05070A',
    orb1: 'rgba(224, 254, 16, 0.28)',
    orb2: 'rgba(0, 245, 255, 0.24)',
    cardBg: 'rgba(12, 17, 30, 0.85)',
    cardBorder: 'rgba(224, 254, 16, 0.35)',
    textPrimary: '#F2F4F8',
    textSecondary: '#A0AEC0',
    pillBg: 'rgba(224, 254, 16, 0.16)',
    defaultAccent: '#E0FE10',
  },
  storytelling: {
    bg: '#08080E',
    orb1: 'rgba(255, 46, 85, 0.28)',
    orb2: 'rgba(255, 184, 0, 0.22)',
    cardBg: 'rgba(18, 14, 24, 0.85)',
    cardBorder: 'rgba(255, 46, 85, 0.35)',
    textPrimary: '#FFFDF8',
    textSecondary: '#E2E8F0',
    pillBg: 'rgba(255, 46, 85, 0.18)',
    defaultAccent: '#FF2E55',
  },
  education: {
    bg: '#080C14',
    orb1: 'rgba(0, 245, 155, 0.26)',
    orb2: 'rgba(59, 130, 246, 0.24)',
    cardBg: 'rgba(10, 18, 32, 0.85)',
    cardBorder: 'rgba(0, 245, 155, 0.35)',
    textPrimary: '#F2F4F8',
    textSecondary: '#94A3B8',
    pillBg: 'rgba(0, 245, 155, 0.18)',
    defaultAccent: '#00F59B',
  },
  comedy: {
    bg: '#120E1A',
    orb1: 'rgba(255, 230, 0, 0.30)',
    orb2: 'rgba(255, 0, 127, 0.25)',
    cardBg: 'rgba(24, 18, 34, 0.85)',
    cardBorder: 'rgba(255, 230, 0, 0.40)',
    textPrimary: '#F2F4F8',
    textSecondary: '#F3E8FF',
    pillBg: 'rgba(255, 230, 0, 0.20)',
    defaultAccent: '#FFE600',
  },
  finance: {
    bg: '#060A0C',
    orb1: 'rgba(0, 230, 118, 0.28)',
    orb2: 'rgba(255, 215, 0, 0.24)',
    cardBg: 'rgba(8, 18, 22, 0.85)',
    cardBorder: 'rgba(0, 230, 118, 0.35)',
    textPrimary: '#F2F4F8',
    textSecondary: '#94A3B8',
    pillBg: 'rgba(0, 230, 118, 0.18)',
    defaultAccent: '#00E676',
  },
  lifestyle: {
    bg: '#141211',
    orb1: 'rgba(251, 113, 133, 0.22)',
    orb2: 'rgba(52, 211, 153, 0.18)',
    cardBg: 'rgba(255, 255, 255, 0.05)',
    cardBorder: 'rgba(251, 113, 133, 0.22)',
    textPrimary: '#FAF5F0',
    textSecondary: '#D6D3D1',
    pillBg: 'rgba(251, 113, 133, 0.18)',
    defaultAccent: '#FB7185',
  },
};

// ---------------------------------------------------------------- Transition Dispatcher

const renderTransition = (index: number, transitionType?: TransitionType): ReactElement => {
  // Directional moves ride a spring (physical, smooth); fades stay linear.
  // One consistent motion language — no random effect per cut.
  const slideTiming = springTiming({ durationInFrames: OVERLAP, config: { damping: 200 } });
  const fadeTiming = linearTiming({ durationInFrames: OVERLAP });
  const key = `transition-${index}`;

  switch (transitionType) {
    case 'slide-left':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-right' })}
          timing={slideTiming}
        />
      );
    case 'slide-right':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-left' })}
          timing={slideTiming}
        />
      );
    case 'slide-up':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-bottom' })}
          timing={slideTiming}
        />
      );
    case 'wipe-left':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={wipe({ direction: 'from-right' })}
          timing={slideTiming}
        />
      );
    case 'flip-top':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={flip({ direction: 'from-top' })}
          timing={slideTiming}
        />
      );
    case 'fade':
    default:
      return <TransitionSeries.Transition key={key} presentation={fade()} timing={fadeTiming} />;
  }
};

// Film grain: kills H.264 gradient banding and adds texture. The seed
// flickers like film instead of sitting static.
const FilmGrain = ({ seed }: { seed: number }) => (
  <svg
    width="100%"
    height="100%"
    style={{ position: 'absolute', inset: 0, opacity: 0.055, mixBlendMode: 'overlay', pointerEvents: 'none', zIndex: 8 }}
  >
    <filter id="reel-grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed={seed} />
    </filter>
    <rect width="100%" height="100%" filter="url(#reel-grain)" />
  </svg>
);

// ---------------------------------------------------------------- Stage ambience

// ---------------------------------------------------------------- Scene Container

type SceneProps = {
  scene: TimelineScene;
  index: number;
  total: number;
  themeStyle: ThemeStyle;
};

const Scene = ({ scene, index, total, themeStyle }: SceneProps) => {
  const frame = useCurrentFrame();
  const accent = scene.accent || themeStyle.defaultAccent;
  const spokenText = scene.narrationBeat || scene.body;

  // ALL visuals are LLM-written per video and injected via context. There is
  // deliberately no template fallback: a missing component means codegen
  // failed, and the job fails loudly instead of airing filler graphics.
  const Custom = useCustomVisual();
  if (!Custom) {
    throw new Error(
      'Bespoke visual component missing — codegen failed and template fallback is disabled. See job logs.',
    );
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {/* Bespoke visual zone: the LLM-written component owns every pixel
          here — backgrounds, titles, charts, characters. The shell only
          provides timing, transitions, audio, and grain. */}
      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          top: 100,
          bottom: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Custom
          t={frame}
          totalFrames={scene.durationInFrames}
          beatIndex={index}
          totalBeats={total}
          beat={spokenText}
          words={spokenText.split(/\s+/).filter(Boolean)}
          headline={scene.headline}
          visual={scene.visual}
          visualData={scene.visualData ?? {}}
          accent={accent}
          theme={{
            bg: themeStyle.bg,
            text: themeStyle.textPrimary,
            muted: themeStyle.textSecondary,
            accent2: themeStyle.defaultAccent,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Main Composition

export const GeneratedReel = ({ theme, scenes, audioFile, style }: ReelInputProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const normalizedScenes = safeScenes(scenes);
  // Transcript-timed scenes cut on real spoken times; untimed scenes
  // (smoke renders, legacy plans) fall back to weight-estimated slots.
  const timed =
    normalizedScenes.length > 0 &&
    normalizedScenes.every((s) => typeof s.start === 'number' && typeof s.end === 'number');
  const timeline = timed
    ? timelineFromBeats(normalizedScenes, durationInFrames, 30)
    : timelineFor(normalizedScenes, durationInFrames);

  const activeTheme: ReelTheme = theme || style?.theme || 'tech';
  // Light paper explainer mode overrides the dark stage (bg + text tokens);
  // bespoke components already receive matching tokens via props.
  const LIGHT_STAGE: ThemeStyle = {
    bg: '#F7F8FA',
    orb1: 'rgba(79, 70, 229, 0.10)',
    orb2: 'rgba(8, 145, 178, 0.10)',
    cardBg: '#FFFFFF',
    cardBorder: '#E2E5EB',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    pillBg: 'rgba(79, 70, 229, 0.10)',
    defaultAccent: style?.palette?.[1] ?? '#4F46E5',
  };
  const themeStyle = style?.mode === 'light' ? LIGHT_STAGE : THEME_STYLES[activeTheme] || THEME_STYLES.tech;

  return (
    <AbsoluteFill style={{ background: themeStyle.bg, overflow: 'hidden', fontFamily }}>
      {audioFile ? (
        <Audio src={/^https?:\/\//.test(audioFile) ? audioFile : staticFile(audioFile)} />
      ) : null}

      {/* Dynamic Remotion Transitions Series */}
      <TransitionSeries>
        {timeline.flatMap((scene, index): ReactElement[] => {
          const items: ReactElement[] = [];
          if (index > 0) {
            items.push(renderTransition(index, scene.transition));
          }
          items.push(
            <TransitionSeries.Sequence
              key={`scene-${index}`}
              durationInFrames={scene.durationInFrames}
            >
              <Scene
                scene={scene}
                index={index}
                total={timeline.length}
                themeStyle={themeStyle}
              />
            </TransitionSeries.Sequence>,
          );
          return items;
        })}
      </TransitionSeries>

      <FilmGrain seed={frame % 8} />
    </AbsoluteFill>
  );
};
