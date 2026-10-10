import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { OVERLAP, timelineFor } from './timeline';
import type {
  ReelInputProps,
  ReelTheme,
  Scene as SceneModel,
  SceneVisualData,
  TimelineScene,
  TransitionType,
  Visual,
} from '../types';

const fontFamily =
  'Inter, "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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

const bob = (t: number, phase: number, amp: number, speed: number): number =>
  Math.sin(t * speed + phase) * amp;

// ---------------------------------------------------------------- Motion Primitives

type PopProps = {
  t: number;
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
  rotate?: number;
};

const Pop = ({ t, delay = 0, children, style, rotate = 0 }: PopProps) => {
  const p = spring({ frame: t - delay, fps: 30, config: { damping: 14, stiffness: 220 } });
  const scale = interpolate(p, [0, 1], [0.6, 1], { extrapolateRight: 'clamp' });
  const opacity = interpolate(p, [0, 0.4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        opacity: p <= 0 ? 0 : opacity,
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

type FloatWrapProps = {
  t: number;
  phase?: number;
  amp?: number;
  speed?: number;
  children: ReactNode;
  style?: CSSProperties;
};

const FloatWrap = ({ t, phase = 0, amp = 10, speed = 0.08, children, style }: FloatWrapProps) => (
  <div style={{ transform: `translateY(${bob(t, phase, amp, speed)}px)`, ...style }}>{children}</div>
);

// ---------------------------------------------------------------- Theme Atmospheres

type ThemeStyle = {
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
    bg: '#07080B',
    orb1: 'rgba(66, 133, 244, 0.22)',
    orb2: 'rgba(155, 81, 224, 0.20)',
    cardBg: 'rgba(255, 255, 255, 0.04)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    textPrimary: '#FFFFFF',
    textSecondary: '#9AA0A6',
    pillBg: 'rgba(66, 133, 244, 0.15)',
    defaultAccent: '#4285F4',
  },
  storytelling: {
    bg: '#0A0C14',
    orb1: 'rgba(229, 169, 60, 0.22)',
    orb2: 'rgba(225, 29, 72, 0.18)',
    cardBg: 'rgba(255, 255, 255, 0.05)',
    cardBorder: 'rgba(229, 169, 60, 0.25)',
    textPrimary: '#FFFDF8',
    textSecondary: '#D1D5DB',
    pillBg: 'rgba(229, 169, 60, 0.18)',
    defaultAccent: '#E5A93C',
  },
  education: {
    bg: '#0B1120',
    orb1: 'rgba(16, 185, 129, 0.20)',
    orb2: 'rgba(59, 130, 246, 0.20)',
    cardBg: 'rgba(255, 255, 255, 0.04)',
    cardBorder: 'rgba(255, 255, 255, 0.14)',
    textPrimary: '#FFFFFF',
    textSecondary: '#94A3B8',
    pillBg: 'rgba(16, 185, 129, 0.16)',
    defaultAccent: '#10B981',
  },
  comedy: {
    bg: '#14121A',
    orb1: 'rgba(250, 204, 21, 0.24)',
    orb2: 'rgba(244, 63, 94, 0.22)',
    cardBg: 'rgba(255, 255, 255, 0.06)',
    cardBorder: 'rgba(250, 204, 21, 0.35)',
    textPrimary: '#FFFFFF',
    textSecondary: '#E4E4E7',
    pillBg: 'rgba(250, 204, 21, 0.20)',
    defaultAccent: '#FACC15',
  },
  finance: {
    bg: '#090C0E',
    orb1: 'rgba(16, 185, 129, 0.22)',
    orb2: 'rgba(245, 158, 11, 0.18)',
    cardBg: 'rgba(255, 255, 255, 0.04)',
    cardBorder: 'rgba(16, 185, 129, 0.25)',
    textPrimary: '#FFFFFF',
    textSecondary: '#A1A1AA',
    pillBg: 'rgba(16, 185, 129, 0.18)',
    defaultAccent: '#10B981',
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
  const timing = linearTiming({ durationInFrames: OVERLAP });
  const key = `transition-${index}`;

  switch (transitionType) {
    case 'slide-left':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-right' })}
          timing={timing}
        />
      );
    case 'slide-right':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-left' })}
          timing={timing}
        />
      );
    case 'slide-up':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={slide({ direction: 'from-bottom' })}
          timing={timing}
        />
      );
    case 'wipe-left':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={wipe({ direction: 'from-right' })}
          timing={timing}
        />
      );
    case 'flip-top':
      return (
        <TransitionSeries.Transition
          key={key}
          presentation={fade()}
          timing={timing}
        />
      );
    case 'fade':
    default:
      return <TransitionSeries.Transition key={key} presentation={fade()} timing={timing} />;
  }
};

// ---------------------------------------------------------------- Visual Components

const normalizeImageUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const clean = url.replace(/^\/+/, '');
  try {
    return staticFile(clean);
  } catch {
    return `/${clean}`;
  }
};

const FloatingParticles = ({
  t,
  count = 14,
  type = 'embers',
}: {
  t: number;
  count?: number;
  type?: 'embers' | 'petals' | 'scarf';
}) => {
  const particles = Array.from({ length: count }, (_, i) => {
    const seed = i * 137.5;
    const startX = (seed * 7) % 1080;
    const speedY = 1.2 + (i % 5) * 0.4;
    const amp = 40 + (i % 4) * 20;
    const y = ((1920 - ((t * speedY * 3 + seed * 10) % 2100)) + 100);
    const x = startX + Math.sin(t * 0.03 + i) * amp;
    const size = type === 'scarf' ? 12 : 4 + (i % 4) * 3;
    const opacity = 0.4 + Math.sin(t * 0.05 + i) * 0.3;
    const color =
      type === 'scarf'
        ? 'rgba(225, 29, 72, 0.85)'
        : type === 'petals'
        ? 'rgba(251, 182, 206, 0.75)'
        : 'rgba(245, 158, 11, 0.85)';
    return { x, y, size, opacity, color };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size * (type === 'scarf' ? 2.5 : 1),
            borderRadius: type === 'petals' ? '50% 0 50% 0' : '50%',
            background: p.color,
            boxShadow: `0 0 12px ${p.color}`,
            opacity: p.opacity,
            transform: `rotate(${Math.sin(t * 0.02 + i) * 45}deg)`,
          }}
        />
      ))}
    </div>
  );
};

type VisualProps = {
  t: number;
  accent: string;
  data?: SceneVisualData;
  headline?: string;
  themeStyle: ThemeStyle;
  totalFrames?: number;
};

// 0A. Full-Bleed Cinematic Character Beat (Continuous Ken Burns, Steadicam sway, moving flare, cinema scope)
const CinematicCharacterBeat = ({
  t,
  accent,
  data,
  totalFrames = 90,
}: VisualProps) => {
  const rawImg = data?.imageUrl;
  const imgSrc = normalizeImageUrl(rawImg);
  const zoom = interpolate(t, [0, totalFrames], [1.06, 1.25], { extrapolateRight: 'clamp' });
  const panY = interpolate(t, [0, totalFrames], [0, -35], { extrapolateRight: 'clamp' });
  const panX = interpolate(t, [0, totalFrames], [-12, 16], { extrapolateRight: 'clamp' });
  const tilt = Math.sin((t / totalFrames) * Math.PI) * 1.3;
  const flash = interpolate(t, [0, 8], [1.25, 1.0], { extrapolateRight: 'clamp' });
  const fadeIn = interpolate(t, [0, 8], [0.3, 1], { extrapolateRight: 'clamp' });

  // Continuous drifting anamorphic light sweep
  const flareX = interpolate(t, [0, totalFrames], [20, 75], { extrapolateRight: 'clamp' });
  const flareY = interpolate(t, [0, totalFrames], [15, 30], { extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {imgSrc ? (
        <Img
          src={imgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px) rotate(${tilt}deg)`,
            filter: `brightness(${flash})`,
            opacity: fadeIn,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at 50% 40%, ${accent}33 0%, #08090E 85%)`,
          }}
        />
      )}

      {/* Moving Anamorphic Light Flare */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 90% 45% at ${flareX}% ${flareY}%, rgba(255,255,255,0.18) 0%, ${accent}28 40%, transparent 75%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />

      {/* Cinematic Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.95) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Cinema Scope Letterbox Bars with Subtle Glowing Line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderBottom: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderTop: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />

      <FloatingParticles t={t} count={20} type={data?.effect === 'red_scarf_wind' ? 'scarf' : 'embers'} />
    </div>
  );
};

// 0B. Character Duo Beat (Intertwined bond, emotional camera tracking)
const CharacterDuoBeat = ({
  t,
  accent,
  data,
  totalFrames = 90,
}: VisualProps) => {
  const rawImg = data?.imageUrl;
  const imgSrc = normalizeImageUrl(rawImg);
  const zoom = interpolate(t, [0, totalFrames], [1.05, 1.22], { extrapolateRight: 'clamp' });
  const panX = interpolate(t, [0, totalFrames], [15, -15], { extrapolateRight: 'clamp' });
  const panY = interpolate(t, [0, totalFrames], [0, -25], { extrapolateRight: 'clamp' });
  const tilt = Math.sin((t / totalFrames) * Math.PI) * -1.2;
  const flash = interpolate(t, [0, 8], [1.25, 1.0], { extrapolateRight: 'clamp' });
  const flareX = interpolate(t, [0, totalFrames], [70, 25], { extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {imgSrc ? (
        <Img
          src={imgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px) rotate(${tilt}deg)`,
            filter: `brightness(${flash})`,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #090B10 0%, #150A10 100%)',
          }}
        />
      )}

      {/* Moving Anamorphic Light Flare */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 90% 45% at ${flareX}% 25%, rgba(255,255,255,0.18) 0%, ${accent}28 40%, transparent 75%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />

      {/* Cinematic Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.95) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Cinema Scope Letterbox Bars */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderBottom: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderTop: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />

      <FloatingParticles t={t} count={20} type="petals" />
    </div>
  );
};

// 0C. Red Scarf in the Wind Beat (Animated flowing multi-wave silk ribbon)
const ScarfWindBeat = ({
  t,
  accent = '#E11D48',
  data,
  totalFrames = 90,
}: VisualProps) => {
  const rawImg = data?.imageUrl || '/assets/anime/aot-ending.jpg';
  const imgSrc = normalizeImageUrl(rawImg);
  const zoom = interpolate(t, [0, totalFrames], [1.05, 1.24], { extrapolateRight: 'clamp' });
  const panY = interpolate(t, [0, totalFrames], [0, -30], { extrapolateRight: 'clamp' });
  const panX = interpolate(t, [0, totalFrames], [-15, 15], { extrapolateRight: 'clamp' });
  const tilt = Math.sin((t / totalFrames) * Math.PI) * 1.4;

  const wave1 = Math.sin(t * 0.09) * 45;
  const wave2 = Math.cos(t * 0.08 + 1.2) * 55;
  const wave3 = Math.sin(t * 0.11 + 2.5) * 50;
  const wave4 = Math.cos(t * 0.07 + 0.5) * 35;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {imgSrc ? (
        <Img
          src={imgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px) rotate(${tilt}deg)`,
          }}
        />
      ) : null}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 90% 45% at 50% 30%, rgba(255,255,255,0.15) 0%, rgba(225,29,72,0.2) 45%, transparent 75%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.96) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Animated Flowing Red Scarf Silk Ribbons */}
      <svg
        viewBox="0 0 1080 1920"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 3,
          filter: 'drop-shadow(0 0 30px rgba(225, 29, 72, 0.85)) drop-shadow(0 0 10px #FF3B30)',
        }}
      >
        <defs>
          <linearGradient id="scarfGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#991B1B" stopOpacity="0.8" />
            <stop offset="30%" stopColor="#DC2626" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#EF4444" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#B91C1C" stopOpacity="0.8" />
          </linearGradient>
        </defs>
        <path
          d={`M -60 ${880 + wave1} Q 260 ${760 + wave2}, 540 ${860 + wave3} T 1140 ${740 + wave4}`}
          fill="none"
          stroke="url(#scarfGrad)"
          strokeWidth="42"
          strokeLinecap="round"
        />
        <path
          d={`M -60 ${910 + wave1} Q 260 ${790 + wave2}, 540 ${890 + wave3} T 1140 ${770 + wave4}`}
          fill="none"
          stroke="#FF4D4D"
          strokeWidth="12"
          strokeLinecap="round"
          opacity={0.85}
        />
        <path
          d={`M -40 ${980 + wave2} Q 320 ${900 + wave3}, 620 ${960 + wave1} T 1120 ${880 + wave2}`}
          fill="none"
          stroke="url(#scarfGrad)"
          strokeWidth="24"
          strokeLinecap="round"
          opacity={0.65}
        />
      </svg>

      {/* Cinema Scope Letterbox Bars */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderBottom: '1px solid rgba(225,29,72,0.4)',
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderTop: '1px solid rgba(225,29,72,0.4)',
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />

      <FloatingParticles t={t} count={24} type="scarf" />
    </div>
  );
};

// 0D. Landscape Canvas Beat (Sweeping environmental scale)
const LandscapeCanvasBeat = ({
  t,
  accent,
  data,
  totalFrames = 90,
}: VisualProps) => {
  const rawImg = data?.imageUrl;
  const imgSrc = normalizeImageUrl(rawImg);
  const zoom = interpolate(t, [0, totalFrames], [1.06, 1.25], { extrapolateRight: 'clamp' });
  const panX = interpolate(t, [0, totalFrames], [-15, 20], { extrapolateRight: 'clamp' });
  const panY = interpolate(t, [0, totalFrames], [0, -25], { extrapolateRight: 'clamp' });
  const tilt = Math.sin((t / totalFrames) * Math.PI) * 1.0;
  const flash = interpolate(t, [0, 8], [1.25, 1.0], { extrapolateRight: 'clamp' });
  const flareX = interpolate(t, [0, totalFrames], [20, 75], { extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {imgSrc ? (
        <Img
          src={imgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px) rotate(${tilt}deg)`,
            filter: `brightness(${flash})`,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, #090B10 0%, #1A0D15 100%)',
          }}
        />
      )}

      {/* Moving Anamorphic Light Flare */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 90% 45% at ${flareX}% 25%, rgba(255,255,255,0.16) 0%, ${accent}22 45%, transparent 75%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />

      {/* Cinematic Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.95) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Cinema Scope Letterbox Bars */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderBottom: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 70,
          background: '#000000',
          borderTop: `1px solid ${accent}44`,
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />

      <FloatingParticles t={t} count={20} type="embers" />
    </div>
  );
};

// 0E. Cinematic Quote Beat (Emotional climax and memorable words)
const CinematicQuoteBeat = ({
  t,
  data,
  headline,
  totalFrames = 90,
}: VisualProps) => {
  const quote = data?.quote || headline || 'Some love stories are not meant to have a happy ending.';
  const author = data?.quoteAuthor;
  const rawImg = data?.imageUrl;
  const imgSrc = normalizeImageUrl(rawImg);
  const pop = spring({ frame: t, fps: 30, config: { damping: 16 } });

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {imgSrc ? (
        <Img
          src={imgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.38) blur(3px)',
            transform: `scale(${1 + (t / totalFrames) * 0.08})`,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, #090B10 0%, #1A0812 100%)',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 80px 240px',
          zIndex: 2,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 90,
            lineHeight: 0.8,
            color: '#E11D48',
            marginBottom: 24,
            textShadow: '0 0 30px rgba(225, 29, 72, 0.8)',
            fontFamily: 'Georgia, serif',
          }}
        >
          “
        </div>
        <p
          style={{
            fontSize: 48,
            lineHeight: 1.45,
            fontWeight: 700,
            color: '#FFFFFF',
            maxWidth: 900,
            margin: 0,
            textShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 20px rgba(225,29,72,0.3)',
            fontFamily: fontFamily,
            transform: `scale(${pop})`,
          }}
        >
          {quote}
        </p>
        {author ? (
          <span
            style={{
              marginTop: 32,
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: 4,
              color: '#E5A93C',
              textTransform: 'uppercase',
              opacity: 0.9,
            }}
          >
            — {author}
          </span>
        ) : null}
      </div>
      <FloatingParticles t={t} count={16} type="scarf" />
    </div>
  );
};

// 1. Kinetic Typography (Giant words slam - great for hooks, punchlines, comedy)
const KineticTypographyBeat = ({ t, accent, headline, data }: VisualProps) => {
  const text = headline || data?.metric || 'BIG IMPACT';
  const words = text.split(/\s+/);
  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 20,
      }}
    >
      {words.map((w, idx) => {
        const anim = spring({ frame: t - idx * 4, fps: 30, config: { damping: 11, stiffness: 260 } });
        const scale = interpolate(anim, [0, 1], [2.2, 1], { extrapolateRight: 'clamp' });
        const isAccent = idx % 2 === 1;

        return (
          <div
            key={idx}
            style={{
              fontSize: 104,
              fontWeight: 900,
              letterSpacing: -2,
              lineHeight: 1,
              textAlign: 'center',
              textTransform: 'uppercase',
              transform: `scale(${scale}) rotate(${idx % 2 === 0 ? -2 : 2}deg)`,
              color: isAccent ? accent : '#FFFFFF',
              textShadow: isAccent ? `0 0 40px ${accent}88` : '0 10px 30px rgba(0,0,0,0.8)',
            }}
          >
            {w}
          </div>
        );
      })}
    </div>
  );
};

// 2. Dialogue Cards (Comic chat bubbles / Character reactions)
const DialogueCards = ({ t, accent, data, themeStyle }: VisualProps) => {
  const bubbles = data?.speechBubbles || [
    { text: 'Wait, does this really work automatically?', side: 'left' as const, speaker: 'User' },
    { text: 'Yes! Instant dynamic scenes with speech sync.', side: 'right' as const, speaker: 'AI Agent' },
  ];

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 32,
        padding: '0 30px',
      }}
    >
      {bubbles.map((b, i) => {
        const isRight = b.side === 'right';
        return (
          <Pop
            key={i}
            t={t}
            delay={i * 8}
            style={{ alignSelf: isRight ? 'flex-end' : 'flex-start', maxWidth: 700 }}
          >
            <div
              style={{
                borderRadius: 28,
                background: isRight
                  ? `linear-gradient(135deg, ${accent}33, ${accent}11)`
                  : themeStyle.cardBg,
                border: isRight ? `2px solid ${accent}` : `1.5px solid ${themeStyle.cardBorder}`,
                padding: '28px 36px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                position: 'relative',
              }}
            >
              {b.speaker && (
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    letterSpacing: 1.5,
                    color: isRight ? accent : themeStyle.textSecondary,
                    marginBottom: 10,
                    textTransform: 'uppercase',
                  }}
                >
                  {b.speaker}
                </div>
              )}
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: '#FFFFFF',
                  lineHeight: 1.3,
                }}
              >
                "{b.text}"
              </div>
            </div>
          </Pop>
        );
      })}
    </div>
  );
};

// 3. Sticker Collage (Reaction stickers & floating badges)
const StickerCollage = ({ t, accent, data, headline }: VisualProps) => {
  const stickers = data?.stickers || [data?.badge || 'VERIFIED', '100% REAL', 'NEXT LEVEL', 'MUST WATCH'];

  return (
    <div
      style={{
        width: 940,
        height: 880,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 900,
          textAlign: 'center',
          maxWidth: 700,
          color: '#FFFFFF',
          zIndex: 1,
        }}
      >
        {headline}
      </div>

      {stickers.map((tag, i) => {
        const spots = [
          { top: 60, left: 40, rot: -8 },
          { top: 80, right: 40, rot: 10 },
          { bottom: 80, left: 60, rot: 6 },
          { bottom: 100, right: 50, rot: -10 },
        ];
        const s = spots[i % spots.length];
        return (
          <Pop
            key={i}
            t={t}
            delay={i * 6}
            style={{ position: 'absolute', ...s, zIndex: 2 }}
            rotate={s.rot}
          >
            <div
              style={{
                padding: '16px 32px',
                borderRadius: 999,
                background: i === 0 ? accent : '#FFFFFF',
                color: '#000000',
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: 2,
                boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                border: '3px solid #000000',
              }}
            >
              {tag}
            </div>
          </Pop>
        );
      })}
    </div>
  );
};

// 4. Split Screen (Before vs After / Comparison Card)
const SplitScreen = ({ t, accent, data, themeStyle }: VisualProps) => {
  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        alignItems: 'center',
      }}
    >
      <Pop t={t} delay={4}>
        <div
          style={{
            height: 600,
            borderRadius: 32,
            background: 'rgba(255, 255, 255, 0.03)',
            border: `1.5px solid ${themeStyle.cardBorder}`,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: 2,
              color: themeStyle.textSecondary,
              padding: '6px 16px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.06)',
              alignSelf: 'flex-start',
            }}
          >
            BEFORE
          </span>
          <div style={{ fontSize: 34, fontWeight: 800, color: themeStyle.textSecondary }}>
            Manual timelines, static templates, repetitive graphics.
          </div>
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.3)' }}>Traditional Flow</div>
        </div>
      </Pop>

      <Pop t={t} delay={8}>
        <div
          style={{
            height: 600,
            borderRadius: 32,
            background: `linear-gradient(135deg, ${accent}22, rgba(255,255,255,0.02))`,
            border: `2px solid ${accent}`,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 30px ${accent}33`,
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: 2,
              color: accent,
              padding: '6px 16px',
              borderRadius: 999,
              background: `${accent}22`,
              alignSelf: 'flex-start',
            }}
          >
            AFTER
          </span>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.25 }}>
            {data?.metric || 'Instant AI Generation'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>
            {data?.metricLabel || 'Autonomous Storytelling'}
          </div>
        </div>
      </Pop>
    </div>
  );
};

// 5. Quote Card (Cinematic Quote Showcase)
const QuoteCard = ({ t, accent, data, themeStyle }: VisualProps) => {
  const quote = data?.quote || data?.metricLabel || 'Intelligence is the ability to adapt to change.';
  const author = data?.quoteAuthor || data?.badge || 'INSIGHT';

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pop t={t} delay={4} style={{ width: '100%', maxWidth: 840 }}>
        <div
          style={{
            borderRadius: 36,
            background: themeStyle.cardBg,
            border: `2px solid ${accent}55`,
            boxShadow: `0 30px 70px rgba(0,0,0,0.6), 0 0 40px ${accent}22`,
            padding: '60px 48px',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -30,
              left: 40,
              fontSize: 90,
              fontWeight: 900,
              lineHeight: 1,
              color: accent,
              opacity: 0.6,
            }}
          >
            “
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 1.35,
              marginTop: 20,
              fontStyle: 'italic',
            }}
          >
            {quote}
          </div>
          <div
            style={{
              marginTop: 36,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 2, background: accent }} />
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2, color: accent }}>
              {author}
            </span>
          </div>
        </div>
      </Pop>
    </div>
  );
};

// 6. Timeline Roadmap (Milestones Journey)
const TimelinePath = ({ t, accent, data, themeStyle }: VisualProps) => {
  const items = data?.nodes || [
    { label: 'Origin', sub: 'The initial breakthrough' },
    { label: 'Acceleration', sub: 'Scaling the core paradigm' },
    { label: 'Future Horizon', sub: 'Transforming the industry' },
  ];

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        position: 'relative',
        padding: '0 40px',
      }}
    >
      {items.map((node, i) => (
        <Pop key={i} t={t} delay={i * 8}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: i === 0 ? accent : 'rgba(255,255,255,0.08)',
                color: i === 0 ? '#000000' : '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                fontWeight: 900,
                boxShadow: i === 0 ? `0 0 24px ${accent}` : 'none',
                flexShrink: 0,
              }}
            >
              0{i + 1}
            </div>
            <div
              style={{
                flex: 1,
                borderRadius: 24,
                background: themeStyle.cardBg,
                border: `1.5px solid ${themeStyle.cardBorder}`,
                padding: '24px 32px',
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 900, color: '#FFFFFF' }}>{node.label}</div>
              <div style={{ fontSize: 20, color: themeStyle.textSecondary, marginTop: 4 }}>
                {node.sub}
              </div>
            </div>
          </div>
        </Pop>
      ))}
    </div>
  );
};

// 7. Bento Grid Showcase
const BentoGridShowcase = ({ t, accent, data, themeStyle }: VisualProps) => {
  const metric = data?.metric || '10x';
  const metricLabel = data?.metricLabel || 'Core Multiplier';
  const badge = data?.badge || 'VERIFIED';
  const elements = data?.elements || [
    { label: 'Speed', value: 'Instant', detail: 'Real-time performance' },
    { label: 'Accuracy', value: '99.4%', detail: 'Benchmark leader' },
  ];

  const p = spring({ frame: t - 6, fps: 30, config: { damping: 14, stiffness: 220 } });

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'grid',
        gridTemplateColumns: '1.2fr 0.8fr',
        gridTemplateRows: '1fr 0.8fr',
        gap: 20,
      }}
    >
      <Pop t={t} delay={4} style={{ gridColumn: '1 / 2', gridRow: '1 / 2' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 32,
            background: `linear-gradient(145deg, ${accent}22, rgba(255,255,255,0.02))`,
            border: `1.5px solid ${accent}55`,
            boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 40px ${accent}22`,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: 2,
              color: accent,
              background: `${accent}18`,
              padding: '6px 16px',
              borderRadius: 999,
              alignSelf: 'flex-start',
            }}
          >
            {badge}
          </span>
          <div>
            <div
              style={{
                fontSize: 84,
                fontWeight: 900,
                letterSpacing: -2,
                lineHeight: 1,
                color: '#FFFFFF',
              }}
            >
              {metric}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: themeStyle.textSecondary, marginTop: 10 }}>
              {metricLabel}
            </div>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '85%', background: accent }} />
          </div>
        </div>
      </Pop>

      <Pop t={t} delay={8} style={{ gridColumn: '2 / 3', gridRow: '1 / 2' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 32,
            background: themeStyle.cardBg,
            border: `1.5px solid ${themeStyle.cardBorder}`,
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 800, color: themeStyle.textSecondary, letterSpacing: 1.5 }}>
            TELEMETRY
          </span>
          <div style={{ fontSize: 52, fontWeight: 900, color: '#FFFFFF' }}>0.18s</div>
          <div style={{ fontSize: 18, color: themeStyle.textSecondary, fontWeight: 600 }}>RESPONSE TIME</div>
        </div>
      </Pop>

      {elements.slice(0, 2).map((item, idx) => (
        <Pop
          key={idx}
          t={t}
          delay={12 + idx * 4}
          style={{ gridColumn: idx === 0 ? '1 / 2' : '2 / 3', gridRow: '2 / 3' }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 32,
              background: themeStyle.cardBg,
              border: `1.5px solid ${themeStyle.cardBorder}`,
              padding: 26,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: themeStyle.textSecondary }}>{item.label}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: accent }}>{item.value}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#FFFFFF' }}>{item.detail}</div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${interpolate(p, [0, 1], [0, 80 + idx * 15], { extrapolateRight: 'clamp' })}%`,
                  background: accent,
                }}
              />
            </div>
          </div>
        </Pop>
      ))}
    </div>
  );
};

// 8. Comparison Matrix (Benchmark Slide)
const ComparisonMatrix = ({ t, accent, data, themeStyle }: VisualProps) => {
  const bars = data?.bars || [
    { label: 'Modern Approach', value: 96, highlight: true },
    { label: 'Industry Baseline', value: 68, highlight: false },
    { label: 'Legacy Paradigm', value: 42, highlight: false },
  ];

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 30,
        padding: '0 20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: accent }}>
          BENCHMARK PERFORMANCE
        </span>
        <span style={{ fontSize: 16, color: themeStyle.textSecondary, fontWeight: 600 }}>HIGHER IS BETTER</span>
      </div>

      {bars.map((bar, idx) => {
        const anim = spring({ frame: t - 8 - idx * 6, fps: 30, config: { damping: 14, stiffness: 180 } });
        const currentVal = interpolate(anim, [0, 1], [0, bar.value], { extrapolateRight: 'clamp' });
        const isHighlight = bar.highlight !== false && idx === 0;

        return (
          <Pop key={idx} t={t} delay={idx * 6}>
            <div
              style={{
                borderRadius: 28,
                background: isHighlight
                  ? `linear-gradient(135deg, ${accent}22, rgba(255,255,255,0.02))`
                  : themeStyle.cardBg,
                border: isHighlight ? `1.5px solid ${accent}` : `1px solid ${themeStyle.cardBorder}`,
                padding: '28px 32px',
                boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: '#FFFFFF' }}>{bar.label}</span>
                <span style={{ fontSize: 36, fontWeight: 900, color: isHighlight ? accent : '#FFFFFF' }}>
                  {Math.round(currentVal)}%
                </span>
              </div>
              <div
                style={{
                  height: 20,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                  padding: 2,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${currentVal}%`,
                    borderRadius: 999,
                    background: isHighlight ? `linear-gradient(90deg, ${accent}, #FFFFFF)` : 'rgba(255,255,255,0.4)',
                  }}
                />
              </div>
            </div>
          </Pop>
        );
      })}
    </div>
  );
};

// 9. Neural Flow Pipeline
const NeuralFlowPipeline = ({ t, accent, data, themeStyle }: VisualProps) => {
  const nodes = data?.nodes || [
    { label: 'Multimodal Input', sub: 'Vision & Sound' },
    { label: 'Transformer Core', sub: 'Cross Attention' },
    { label: 'Realtime Output', sub: 'Instant Response' },
  ];

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <svg
        style={{
          position: 'absolute',
          top: 60,
          bottom: 60,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 80,
          height: 740,
          zIndex: 0,
        }}
      >
        <line
          x1="40"
          y1="40"
          x2="40"
          y2="700"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="6"
          strokeDasharray="12 12"
          strokeDashoffset={-t * 3}
        />
        <circle
          cx="40"
          cy={40 + ((t * 8) % 660)}
          r="9"
          fill={accent}
          style={{ filter: `drop-shadow(0 0 14px ${accent})` }}
        />
      </svg>

      {nodes.map((node, i) => (
        <Pop key={i} t={t} delay={i * 8} style={{ zIndex: 1, width: '100%', maxWidth: 760 }}>
          <FloatWrap t={t} phase={i * 1.5} amp={8}>
            <div
              style={{
                borderRadius: 30,
                background: themeStyle.cardBg,
                border: `1.5px solid ${themeStyle.cardBorder}`,
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                padding: '28px 36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 18,
                    background: i === 0 ? accent : 'rgba(255,255,255,0.08)',
                    color: i === 0 ? '#000000' : '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    fontWeight: 900,
                  }}
                >
                  0{i + 1}
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#FFFFFF' }}>{node.label}</div>
                  <div style={{ fontSize: 18, color: themeStyle.textSecondary, marginTop: 4, fontWeight: 600 }}>
                    {node.sub}
                  </div>
                </div>
              </div>
            </div>
          </FloatWrap>
        </Pop>
      ))}
    </div>
  );
};

// 10. Radial Gauge
const RadialTelemetryGauge = ({ t, accent, data }: VisualProps) => {
  const metric = data?.metric || '99.4%';
  const metricLabel = data?.metricLabel || 'Accuracy Score';
  const tag = data?.tag || 'VERIFIED';

  const p = spring({ frame: t - 8, fps: 30, config: { damping: 14, stiffness: 180 } });
  const circumference = 2 * Math.PI * 170;
  const strokeDashoffset = interpolate(p, [0, 1], [circumference, circumference * 0.18], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative', width: 420, height: 420 }}>
        <svg width="420" height="420" viewBox="0 0 420 420" style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx="210"
            cy="210"
            r="170"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="22"
          />
          <circle
            cx="210"
            cy="210"
            r="170"
            fill="none"
            stroke={accent}
            strokeWidth="22"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ filter: `drop-shadow(0 0 16px ${accent})` }}
          />
        </svg>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 80, fontWeight: 900, color: '#FFFFFF', letterSpacing: -2 }}>
            {metric}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#9AA0A6', marginTop: 10 }}>
            {metricLabel}
          </div>
        </div>
      </div>

      <Pop t={t} delay={14}>
        <div
          style={{
            marginTop: 40,
            padding: '14px 32px',
            borderRadius: 999,
            background: `${accent}18`,
            border: `1.5px solid ${accent}66`,
            color: '#FFFFFF',
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          {tag}
        </div>
      </Pop>
    </div>
  );
};

// 11. Hero Stat Spotlight
const StatSpotlight = ({ t, accent, data, themeStyle }: VisualProps) => {
  const metric = data?.metric || '10x';
  const metricLabel = data?.metricLabel || 'Faster Execution';
  const badge = data?.badge || 'SURPASSING LIMITS';

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pop t={t} delay={4}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: 2.5,
            color: accent,
            background: `${accent}18`,
            padding: '8px 24px',
            borderRadius: 999,
            border: `1.5px solid ${accent}55`,
            marginBottom: 24,
          }}
        >
          {badge}
        </div>
      </Pop>

      <Pop t={t} delay={8}>
        <div
          style={{
            fontSize: 130,
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1,
            color: '#FFFFFF',
            textShadow: `0 0 50px ${accent}66`,
          }}
        >
          {metric}
        </div>
      </Pop>

      <Pop t={t} delay={14}>
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: themeStyle.textSecondary,
            marginTop: 18,
            textAlign: 'center',
            maxWidth: 600,
          }}
        >
          {metricLabel}
        </div>
      </Pop>
    </div>
  );
};

// 12. Terminal Stream
const TerminalDataStream = ({ t, accent, data }: VisualProps) => {
  const snippet =
    data?.codeSnippet ||
    `const stream = ai.generate({\n  theme: "Dynamic Storytelling",\n  pacing: "Adaptive Scene Beats"\n});`;

  const visibleChars = Math.max(12, Math.floor(t * 3));
  const displayed = snippet.slice(0, visibleChars);
  const lines = displayed.split('\n');

  return (
    <div
      style={{
        width: 940,
        height: 880,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Pop t={t} delay={4} style={{ width: '100%', maxWidth: 840 }}>
        <div
          style={{
            borderRadius: 32,
            background: 'rgba(10, 12, 16, 0.9)',
            border: `1.5px solid ${accent}55`,
            boxShadow: '0 30px 70px rgba(0,0,0,0.7)',
            padding: '36px 32px',
            fontFamily: '"Fira Code", monospace, Consolas',
            fontSize: 26,
            lineHeight: 1.6,
          }}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 20 }}>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>0{i + 1}</span>
              <span style={{ color: i === 0 ? accent : '#FFFFFF' }}>{l}</span>
            </div>
          ))}
        </div>
      </Pop>
    </div>
  );
};

// Visual Dispatcher
const VisualScene = ({
  visual,
  t,
  accent,
  data,
  headline,
  themeStyle,
  totalFrames = 90,
}: {
  visual: Visual;
  t: number;
  accent: string;
  data?: SceneVisualData;
  headline?: string;
  themeStyle: ThemeStyle;
  totalFrames?: number;
}) => {
  switch (visual) {
    case 'cinematic_character':
      return (
        <CinematicCharacterBeat
          t={t}
          accent={accent}
          data={data}
          headline={headline}
          themeStyle={themeStyle}
          totalFrames={totalFrames}
        />
      );
    case 'character_duo':
      return (
        <CharacterDuoBeat
          t={t}
          accent={accent}
          data={data}
          headline={headline}
          themeStyle={themeStyle}
          totalFrames={totalFrames}
        />
      );
    case 'scarf_wind':
      return (
        <ScarfWindBeat
          t={t}
          accent={accent}
          data={data}
          headline={headline}
          themeStyle={themeStyle}
          totalFrames={totalFrames}
        />
      );
    case 'landscape_canvas':
      return (
        <LandscapeCanvasBeat
          t={t}
          accent={accent}
          data={data}
          headline={headline}
          themeStyle={themeStyle}
          totalFrames={totalFrames}
        />
      );
    case 'cinematic_quote':
      return (
        <CinematicQuoteBeat
          t={t}
          accent={accent}
          data={data}
          headline={headline}
          themeStyle={themeStyle}
          totalFrames={totalFrames}
        />
      );
    case 'kinetic_typography':
      return <KineticTypographyBeat t={t} accent={accent} headline={headline} data={data} themeStyle={themeStyle} />;
    case 'dialogue_cards':
      return <DialogueCards t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'sticker_collage':
      return <StickerCollage t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'split_screen':
      return <SplitScreen t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'quote_card':
      return <QuoteCard t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'timeline_path':
      return <TimelinePath t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'bento_grid':
      return <BentoGridShowcase t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'comparison_matrix':
      return <ComparisonMatrix t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'neural_flow':
      return <NeuralFlowPipeline t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'radial_gauge':
      return <RadialTelemetryGauge t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'stat_spotlight':
      return <StatSpotlight t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    case 'terminal_stream':
      return <TerminalDataStream t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
    default:
      if (data?.imageUrl) {
        return (
          <CinematicCharacterBeat
            t={t}
            accent={accent}
            data={data}
            headline={headline}
            themeStyle={themeStyle}
            totalFrames={totalFrames}
          />
        );
      }
      return <BentoGridShowcase t={t} accent={accent} data={data} headline={headline} themeStyle={themeStyle} />;
  }
};

// ---------------------------------------------------------------- Kinetic Spoken Voice Caption

const SpokenVoiceCaption = ({
  text,
  t,
  totalFrames,
  accent,
  cinematic = false,
}: {
  text: string;
  t: number;
  totalFrames: number;
  accent: string;
  cinematic?: boolean;
}) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  // Calculate phonetic duration weight for each word based on character length & punctuation
  const wordWeights = words.map((w) => {
    const rawLen = w.replace(/[^a-zA-Z0-9]/g, '').length;
    const hasComma = /[,;:]/.test(w);
    const hasEnd = /[.!?]/.test(w);
    return Math.max(2, rawLen) + (hasComma ? 3 : 0) + (hasEnd ? 5 : 0);
  });
  const totalWeight = wordWeights.reduce((sum, w) => sum + w, 0);

  // Cumulative weight thresholds
  let cum = 0;
  const thresholds = wordWeights.map((w) => {
    cum += w;
    return cum;
  });

  // Active speech window: from frame 2 up to frame (totalFrames - OVERLAP - 3)
  const speechStartFrame = 2;
  const speechEndFrame = Math.max(speechStartFrame + 15, totalFrames - OVERLAP - 3);
  const speechDuration = speechEndFrame - speechStartFrame;

  const currentSpeechFrame = t - speechStartFrame;
  const isSpeechFinished = currentSpeechFrame >= speechDuration;
  const progressRatio = Math.max(0, Math.min(1, currentSpeechFrame / speechDuration));
  const targetWeight = progressRatio * totalWeight;

  // Find currently spoken word
  let activeWordIndex = words.length - 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i] >= targetWeight) {
      activeWordIndex = i;
      break;
    }
  }

  // Highlight styling
  const highlightColor = cinematic ? '#FACC15' : accent || '#38BDF8';

  return (
    <div
      style={{
        borderRadius: 24,
        background: cinematic ? 'rgba(7, 9, 15, 0.85)' : 'rgba(10, 12, 18, 0.82)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        border: cinematic
          ? '1.5px solid rgba(255, 255, 255, 0.2)'
          : '1.5px solid rgba(255, 255, 255, 0.14)',
        padding: cinematic ? '20px 32px' : '18px 28px',
        boxShadow: cinematic
          ? '0 24px 60px rgba(0,0,0,0.85), 0 0 35px rgba(225,29,72,0.22)'
          : '0 20px 50px rgba(0,0,0,0.7)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 12px',
        justifyContent: 'center',
        alignItems: 'center',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      {words.map((word, i) => {
        const isCurrent = !isSpeechFinished && i === activeWordIndex;
        const isPast = isSpeechFinished || i < activeWordIndex;

        return (
          <span
            key={i}
            style={{
              fontSize: cinematic ? 34 : 30,
              fontWeight: isCurrent ? 900 : isPast ? 800 : 600,
              lineHeight: 1.3,
              color: isCurrent
                ? '#FFFFFF'
                : isPast
                ? '#FFFFFF'
                : 'rgba(255, 255, 255, 0.38)',
              background: isCurrent
                ? `linear-gradient(135deg, ${highlightColor}44, ${highlightColor}22)`
                : 'transparent',
              border: isCurrent ? `1.5px solid ${highlightColor}99` : '1.5px solid transparent',
              padding: isCurrent ? '2px 10px' : '2px 2px',
              borderRadius: 8,
              textShadow: isCurrent
                ? `0 0 24px ${highlightColor}, 0 0 40px ${highlightColor}88`
                : isPast
                ? '0 2px 10px rgba(0,0,0,0.8)'
                : 'none',
              transform: isCurrent ? 'scale(1.14)' : 'scale(1)',
              transition: 'transform 0.08s ease, color 0.08s ease',
              display: 'inline-block',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

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

  const isStory =
    themeStyle === THEME_STYLES.storytelling ||
    Boolean(scene.imageUrl || scene.visualData?.imageUrl) ||
    scene.visual === 'cinematic_character' ||
    scene.visual === 'character_duo' ||
    scene.visual === 'scarf_wind' ||
    scene.visual === 'cinematic_quote' ||
    scene.visual === 'landscape_canvas';

  if (isStory) {
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <VisualScene
          visual={scene.visual}
          t={frame}
          accent={accent}
          data={{
            ...scene.visualData,
            imageUrl: scene.imageUrl || scene.visualData?.imageUrl,
          }}
          headline={scene.headline}
          themeStyle={themeStyle}
          totalFrames={scene.durationInFrames}
        />

        {/* Live Cinematic Subtitle Bar - Positioned in the prime lower-middle zone, well above mobile UI overlays */}
        <div
          style={{
            position: 'absolute',
            left: 50,
            right: 50,
            bottom: 390,
            zIndex: 10,
          }}
        >
          <SpokenVoiceCaption
            text={spokenText}
            t={frame}
            totalFrames={scene.durationInFrames}
            accent={accent}
            cinematic={true}
          />
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      {/* Top Scene Kicker & Counter */}
      <div
        style={{
          padding: '110px 78px 0',
          fontFamily,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 20px',
              borderRadius: 999,
              background: `${accent}22`,
              border: `1.5px solid ${accent}88`,
              color: '#FFFFFF',
              fontSize: 20,
              fontWeight: 900,
              letterSpacing: 2,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
            {String(scene.kicker || `BEAT ${index + 1}`).toUpperCase()}
          </div>

          <span
            style={{
              fontWeight: 900,
              fontSize: 22,
              color: themeStyle.textSecondary,
              letterSpacing: 2,
              background: 'rgba(255,255,255,0.06)',
              padding: '6px 16px',
              borderRadius: 999,
            }}
          >
            0{index + 1} / 0{total}
          </span>
        </div>

        {/* Dynamic Scene Headline */}
        <h1
          style={{
            margin: '18px 0 0',
            maxWidth: 920,
            fontSize: 62,
            lineHeight: 1.1,
            fontWeight: 900,
            letterSpacing: -1.5,
            color: themeStyle.textPrimary,
          }}
        >
          {scene.headline}
        </h1>
      </div>

      {/* Main Center Visual Motion - Centered and elevated above the bottom safe zone */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          top: 280,
          height: 980,
          zIndex: 1,
        }}
      >
        <VisualScene
          visual={scene.visual}
          t={frame}
          accent={accent}
          data={scene.visualData}
          headline={scene.headline}
          themeStyle={themeStyle}
          totalFrames={scene.durationInFrames}
        />
      </div>

      {/* Live Voiceover Caption Bar - Elevated in the prime reading area */}
      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 380,
          zIndex: 10,
        }}
      >
        <SpokenVoiceCaption
          text={spokenText}
          t={frame}
          totalFrames={scene.durationInFrames}
          accent={accent}
          cinematic={false}
        />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Main Composition

export const GeneratedReel = ({ title, theme, scenes, audioFile, style }: ReelInputProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const normalizedScenes = safeScenes(scenes);
  const timeline = timelineFor(normalizedScenes, durationInFrames);

  const activeTheme: ReelTheme = theme || style?.theme || 'tech';
  const themeStyle = THEME_STYLES[activeTheme] || THEME_STYLES.tech;

  const isStory =
    activeTheme === 'storytelling' ||
    normalizedScenes.some((s) => Boolean(s.imageUrl || s.visualData?.imageUrl));

  return (
    <AbsoluteFill style={{ background: themeStyle.bg, overflow: 'hidden', fontFamily }}>
      {audioFile ? (
        <Audio src={/^https?:\/\//.test(audioFile) ? audioFile : staticFile(audioFile)} />
      ) : null}

      {/* Theme Atmospheric Glowing Orbs */}
      <div
        style={{
          position: 'absolute',
          top: -150,
          left: -100,
          width: 800,
          height: 800,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${themeStyle.orb1} 0%, transparent 65%)`,
          filter: 'blur(90px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -150,
          right: -100,
          width: 850,
          height: 850,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${themeStyle.orb2} 0%, transparent 65%)`,
          filter: 'blur(90px)',
        }}
      />

      {/* Theme Coordinate Grid (hidden for cinematic stories) */}
      {!isStory ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.12) 1.5px, transparent 1.5px)',
            backgroundSize: '40px 40px',
            opacity: 0.6,
          }}
        />
      ) : null}

      {/* Top Header Bar (only shown for non-story structured reels) */}
      {!isStory ? (
        <div
          style={{
            position: 'absolute',
            left: 78,
            top: 56,
            right: 78,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#FFFFFF',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 1,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: themeStyle.defaultAccent,
                boxShadow: `0 0 12px ${themeStyle.defaultAccent}`,
              }}
            />
            <span>{title}</span>
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 900,
              letterSpacing: 2,
              color: themeStyle.defaultAccent,
              background: `${themeStyle.defaultAccent}18`,
              padding: '4px 14px',
              borderRadius: 999,
              border: `1px solid ${themeStyle.defaultAccent}44`,
              textTransform: 'uppercase',
            }}
          >
            {activeTheme} REEL
          </span>
        </div>
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

      {/* Bottom Glowing Progress Line */}
      <div
        style={{
          position: 'absolute',
          left: 78,
          right: 78,
          bottom: 44,
          height: 6,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: `${interpolate(frame, [0, durationInFrames], [0, 100], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}%`,
            height: '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${themeStyle.defaultAccent}, #FFFFFF)`,
            boxShadow: `0 0 16px ${themeStyle.defaultAccent}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
