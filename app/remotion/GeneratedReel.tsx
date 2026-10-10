import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { OVERLAP, timelineFor } from './timeline';
import type { ReelInputProps, Scene as SceneModel, TimelineScene, Visual } from '../types';

// Flat-illustration explainer style (light canvas, ink + accent + white cards).
// Every scene is a living vignette: ambient bob/drift never stops, elements pop
// in staggered, and scenes hand off through @remotion/transitions' TransitionSeries
// (a real cross-fade — the outgoing scene fades out as the incoming one fades in).
// All animation stays pure frame math (no state/effects) — deterministic and portable.

const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const INK = '#161616';
const PAPER = '#F1F2F4';
const CARD_SHADOW = '10px 10px 0 rgba(22,22,22,0.10)';

const safeScenes = (scenes: SceneModel[]): SceneModel[] => {
  if (Array.isArray(scenes) && scenes.length) {
    return scenes.slice(0, 6);
  }

  return [
    {
      kicker: 'Reel',
      headline: 'AI generated motion graphics',
      body: 'A simple animated beat rendered with Remotion.',
      visual: 'orbit',
      accent: '#E8A800',
      durationWeight: 1,
    },
  ];
};

const bob = (t: number, phase: number, amp: number, speed: number): number =>
  Math.sin(t * speed + phase) * amp;

// ---------------------------------------------------------------- primitives

type PopProps = {
  t: number;
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
  rotate?: number;
};

const Pop = ({ t, delay = 0, children, style, rotate = 0 }: PopProps) => {
  const p = spring({ frame: t - delay, fps: 30, config: { damping: 12, stiffness: 240 } });
  const scale = interpolate(p, [0, 1], [0.4, 1], { extrapolateRight: 'clamp' });
  const opacity = interpolate(p, [0, 0.3], [0, 1], {
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

const FloatWrap = ({ t, phase = 0, amp = 12, speed = 0.09, children, style }: FloatWrapProps) => (
  <div style={{ transform: `translateY(${bob(t, phase, amp, speed)}px)`, ...style }}>{children}</div>
);

type PhoneMockupProps = { accent: string; screenLines?: number };

const PhoneMockup = ({ accent, screenLines = 3 }: PhoneMockupProps) => (
  <div
    style={{
      width: 190,
      height: 360,
      borderRadius: 34,
      background: '#ffffff',
      border: `6px solid ${INK}`,
      boxShadow: CARD_SHADOW,
      padding: '26px 20px',
      position: 'relative',
    }}
  >
    <div
      style={{
        width: 64,
        height: 12,
        borderRadius: 999,
        background: INK,
        margin: '0 auto 22px',
      }}
    />
    <div
      style={{
        width: 76,
        height: 76,
        borderRadius: '50%',
        background: accent,
        margin: '0 auto 18px',
        border: `4px solid ${INK}`,
      }}
    />
    {Array.from({ length: screenLines }).map((_, i) => (
      <div
        key={i}
        style={{
          height: 14,
          borderRadius: 7,
          background: i === 0 ? INK : '#D9DBDE',
          margin: '12px 8px',
          width: i === 0 ? '70%' : '92%',
        }}
      />
    ))}
    <div
      style={{
        margin: '18px auto 0',
        width: 110,
        height: 34,
        borderRadius: 999,
        background: INK,
      }}
    />
  </div>
);

type IconChipProps = { glyph: string; bg?: string; fg?: string };

const IconChip = ({ glyph, bg = '#ffffff', fg = INK }: IconChipProps) => (
  <div
    style={{
      width: 96,
      height: 96,
      borderRadius: 26,
      background: bg,
      color: fg,
      border: `5px solid ${INK}`,
      boxShadow: '6px 6px 0 rgba(22,22,22,0.14)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 44,
      fontWeight: 900,
    }}
  >
    {glyph}
  </div>
);

type ChatCardProps = { title: string; lines?: number; accent: string };

const ChatCard = ({ lines = 2, accent }: ChatCardProps) => (
  <div
    style={{
      width: 300,
      borderRadius: 24,
      background: '#ffffff',
      border: `5px solid ${INK}`,
      boxShadow: CARD_SHADOW,
      padding: '20px 22px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: accent, border: `3px solid ${INK}` }} />
      <div style={{ height: 14, width: 120, borderRadius: 7, background: INK }} />
    </div>
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        style={{
          height: 12,
          borderRadius: 6,
          background: '#D9DBDE',
          margin: '10px 0',
          width: i === lines - 1 ? '62%' : '94%',
        }}
      />
    ))}
  </div>
);

type StatChipProps = { value: string; label: string; accent: string };

const StatChip = ({ value, label, accent }: StatChipProps) => (
  <div
    style={{
      borderRadius: 999,
      background: INK,
      color: '#fff',
      padding: '14px 26px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: '6px 6px 0 rgba(22,22,22,0.18)',
    }}
  >
    <span style={{ background: accent, color: INK, borderRadius: 999, padding: '6px 16px', fontWeight: 900, fontSize: 26 }}>
      {value}
    </span>
    <span style={{ fontWeight: 800, fontSize: 24 }}>{label}</span>
  </div>
);

type PersonFigureProps = { accent: string; flip?: boolean };

const PersonFigure = ({ accent, flip = false }: PersonFigureProps) => (
  <div style={{ transform: flip ? 'scaleX(-1)' : 'none', width: 170, height: 330 }}>
    <div
      style={{
        width: 110,
        height: 110,
        borderRadius: '50%',
        background: '#fff',
        border: `6px solid ${INK}`,
        margin: '0 auto',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: -8, left: -6, right: -6, height: 56, background: INK, borderRadius: '50%' }} />
    </div>
    <div
      style={{
        width: 150,
        height: 150,
        borderRadius: 40,
        background: accent,
        border: `6px solid ${INK}`,
        margin: '-14px auto 0',
      }}
    />
    <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: -6 }}>
      <div style={{ width: 56, height: 92, borderRadius: 20, background: INK }} />
      <div style={{ width: 56, height: 92, borderRadius: 20, background: INK }} />
    </div>
  </div>
);

type ConfettiProps = { t: number; accent: string; seeds?: number };

const Confetti = ({ t, accent, seeds = 10 }: ConfettiProps) => (
  <>
    {Array.from({ length: seeds }).map((_, i) => {
      const x = (i * 173) % 900;
      const y = (i * 229) % 700;
      const r = 8 + ((i * 7) % 10);
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 40 + x,
            top: 40 + y,
            width: r,
            height: r,
            borderRadius: '50%',
            background: i % 3 === 0 ? accent : i % 3 === 1 ? INK : '#ffffff',
            border: i % 3 === 2 ? `3px solid ${INK}` : 'none',
            transform: `translateY(${bob(t, i * 1.3, 16, 0.08)}px)`,
            opacity: 0.9,
          }}
        />
      );
    })}
  </>
);

// ---------------------------------------------------------------- vignettes

type VignetteBodyProps = { t: number; accent: string };

// orbit → network: phone hub, orbiting app chips, floating chat cards.
const NetworkOrbit = ({ t, accent }: VignetteBodyProps) => {
  const glyphs = ['f', 'in', 'M', '▶', '✉'];
  return (
    <div style={{ position: 'relative', width: 940, height: 860 }}>
      <div
        style={{
          position: 'absolute',
          left: 170,
          top: 130,
          width: 600,
          height: 600,
          borderRadius: '50%',
          border: '4px dashed rgba(22,22,22,0.25)',
          transform: `rotate(${t * 1.1}deg)`,
        }}
      />
      <div style={{ position: 'absolute', left: 375, top: 245 }}>
        <FloatWrap t={t} amp={10}>
          <PhoneMockup accent={accent} />
        </FloatWrap>
      </div>
      {glyphs.map((g, i) => {
        const ang = ((t * 1.6 + i * 72) * Math.PI) / 180;
        const x = 470 + Math.cos(ang) * 330 - 48;
        const y = 430 + Math.sin(ang) * 300 - 48;
        return (
          <div key={g} style={{ position: 'absolute', left: x, top: y }}>
            <Pop t={t} delay={8 + i * 5}>
              <IconChip glyph={g} bg={i % 2 ? accent : '#ffffff'} />
            </Pop>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, top: 60 }}>
        <FloatWrap t={t} phase={1} amp={14}>
          <Pop t={t} delay={20}>
            <ChatCard title="msg" lines={2} accent={accent} />
          </Pop>
        </FloatWrap>
      </div>
      <div style={{ position: 'absolute', right: 0, bottom: 40 }}>
        <FloatWrap t={t} phase={3} amp={14}>
          <Pop t={t} delay={28}>
            <StatChip value="99+" label="alerts" accent={accent} />
          </Pop>
        </FloatWrap>
      </div>
    </div>
  );
};

// bars → dashboard: skyline backdrop + analytics card with growing bars.
const CityDash = ({ t, accent }: VignetteBodyProps) => {
  const towers = [300, 430, 250, 520, 360, 470, 290];
  const bars = [0.45, 0.7, 0.55, 0.9, 0.65, 1.0, 0.75];
  return (
    <div style={{ position: 'relative', width: 940, height: 860 }}>
      <div style={{ position: 'absolute', bottom: 120, left: 20, right: 20, display: 'flex', alignItems: 'end', gap: 14 }}>
        {towers.map((h, i) => {
          const rise = spring({ frame: t - i * 3, fps: 30, config: { damping: 14, stiffness: 160 } });
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: h * Math.max(0.05, rise),
                background: i % 3 === 0 ? accent : i % 3 === 1 ? INK : '#ffffff',
                border: `5px solid ${INK}`,
                borderRadius: '14px 14px 0 0',
                opacity: rise <= 0 ? 0 : 1,
              }}
            />
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 120, top: 40, width: 700 }}>
        <Pop t={t} delay={10}>
          <div
            style={{
              background: '#fff',
              border: `6px solid ${INK}`,
              borderRadius: 30,
              boxShadow: CARD_SHADOW,
              padding: '30px 34px',
            }}
          >
            <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
              <div style={{ height: 16, width: 150, borderRadius: 8, background: INK }} />
              <div style={{ height: 16, width: 90, borderRadius: 8, background: accent }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'end', gap: 16, height: 220 }}>
              {bars.map((b, i) => {
                const g = spring({ frame: t - 14 - i * 4, fps: 30, config: { damping: 13, stiffness: 200 } });
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: Math.max(8, 220 * b * g),
                      borderRadius: 12,
                      background: i === 5 ? accent : INK,
                      border: `4px solid ${INK}`,
                      opacity: g <= 0 ? 0 : 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </Pop>
      </div>
      <div style={{ position: 'absolute', right: 10, top: 560 }}>
        <FloatWrap t={t} phase={2} amp={12}>
          <Pop t={t} delay={34}>
            <StatChip value="×10" label="growth" accent={accent} />
          </Pop>
        </FloatWrap>
      </div>
      <Confetti t={t} accent={accent} seeds={8} />
    </div>
  );
};

// timeline → journey: drawing path, milestone nodes, traveler, person at the end.
const Journey = ({ t, accent }: VignetteBodyProps) => {
  const nodes = ['01', '02', '03', '04'];
  const draw = interpolate(t, [4, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{ position: 'relative', width: 940, height: 860 }}>
      <Confetti t={t} accent={accent} seeds={8} />
      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          top: 430,
          height: 10,
          borderRadius: 999,
          background: 'rgba(22,22,22,0.12)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 60,
          top: 430,
          width: 820 * draw,
          height: 10,
          borderRadius: 999,
          background: accent,
          border: `2px solid ${INK}`,
        }}
      />
      {nodes.map((n, i) => {
        const x = 110 + i * 250;
        const up = i % 2 === 0;
        return (
          <div key={n} style={{ position: 'absolute', left: x - 90, top: up ? 170 : 500 }}>
            <Pop t={t} delay={10 + i * 9}>
              <div style={{ width: 180, textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-block',
                    background: INK,
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 26,
                    borderRadius: 999,
                    padding: '10px 24px',
                    marginBottom: 12,
                  }}
                >
                  STEP {n}
                </div>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: i / 3 <= draw ? accent : '#fff',
                    border: `5px solid ${INK}`,
                    margin: '0 auto',
                  }}
                />
              </div>
            </Pop>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 60 + 820 * draw - 30, top: 372 }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: '#fff',
            border: `6px solid ${INK}`,
            boxShadow: `0 0 0 10px ${accent}`,
          }}
        />
      </div>
      <div style={{ position: 'absolute', right: 30, bottom: 30 }}>
        <FloatWrap t={t} amp={10}>
          <Pop t={t} delay={44}>
            <PersonFigure accent={accent} />
          </Pop>
        </FloatWrap>
      </div>
    </div>
  );
};

// cards → chat cluster: bubbles stagger in around a phone, typing dots alive.
const ChatCluster = ({ t, accent }: VignetteBodyProps) => {
  const bubbles = [
    { text: 'Did you see this?', me: false },
    { text: 'Sending it now ⚡', me: true },
    { text: 'This changes everything', me: false },
  ];
  return (
    <div style={{ position: 'relative', width: 940, height: 860 }}>
      <Confetti t={t} accent={accent} seeds={8} />
      <div style={{ position: 'absolute', left: 60, top: 120, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {bubbles.map((b, i) => (
          <div key={i} style={{ alignSelf: b.me ? 'flex-end' : 'flex-start', marginLeft: b.me ? 220 : 0 }}>
            <Pop t={t} delay={8 + i * 10} rotate={b.me ? 2 : -2}>
              <div
                style={{
                  background: b.me ? accent : '#fff',
                  border: `5px solid ${INK}`,
                  borderRadius: 26,
                  padding: '22px 30px',
                  fontSize: 32,
                  fontWeight: 800,
                  color: INK,
                  boxShadow: CARD_SHADOW,
                  maxWidth: 480,
                }}
              >
                {b.text}
              </div>
            </Pop>
          </div>
        ))}
        <Pop t={t} delay={42}>
          <div
            style={{
              background: '#fff',
              border: `5px solid ${INK}`,
              borderRadius: 999,
              padding: '16px 30px',
              display: 'inline-flex',
              gap: 12,
              boxShadow: CARD_SHADOW,
            }}
          >
            {[0, 1, 2].map((d) => {
              const s = 1 + 0.45 * Math.max(0, Math.sin(t * 0.35 - d * 0.9));
              return (
                <div key={d} style={{ width: 20 * s, height: 20 * s, borderRadius: '50%', background: INK }} />
              );
            })}
          </div>
        </Pop>
      </div>
      <div style={{ position: 'absolute', right: 40, bottom: 60 }}>
        <FloatWrap t={t} phase={1.5} amp={12}>
          <Pop t={t} delay={16}>
            <PhoneMockup accent={accent} screenLines={2} />
          </Pop>
        </FloatWrap>
      </div>
    </div>
  );
};

// pulse → broadcast: avatar hub, radiating rings, notification badges.
const Broadcast = ({ t, accent }: VignetteBodyProps) => {
  const cycle = (t % 45) / 45;
  const badges = ['★ 4.9', '✔ Sent', '◉ Live', '+1k'];
  return (
    <div style={{ position: 'relative', width: 940, height: 860 }}>
      <Confetti t={t} accent={accent} seeds={10} />
      <div style={{ position: 'absolute', left: 270, top: 230, width: 400, height: 400 }}>
        {[0, 1, 2].map((r) => {
          const p = (cycle + r / 3) % 1;
          return (
            <div
              key={r}
              style={{
                position: 'absolute',
                inset: 60 + p * 130,
                borderRadius: '50%',
                border: `5px solid ${accent}`,
                opacity: Math.max(0, 0.7 * (1 - p)),
              }}
            />
          );
        })}
        <div style={{ position: 'absolute', inset: 110, textAlign: 'center' }}>
          <FloatWrap t={t} amp={8}>
            <div
              style={{
                width: 180,
                height: 180,
                borderRadius: '50%',
                background: accent,
                border: `7px solid ${INK}`,
                boxShadow: CARD_SHADOW,
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 84,
                fontWeight: 900,
                color: INK,
              }}
            >
              ▶
            </div>
          </FloatWrap>
        </div>
      </div>
      {badges.map((b, i) => {
        const spots = [
          { left: 40, top: 120 },
          { left: 640, top: 90 },
          { left: 60, top: 620 },
          { left: 620, top: 640 },
        ];
        return (
          <div key={b} style={{ position: 'absolute', ...spots[i] }}>
            <FloatWrap t={t} phase={i * 1.7} amp={13}>
              <Pop t={t} delay={10 + i * 8} rotate={i % 2 ? 3 : -3}>
                <div
                  style={{
                    background: i % 2 ? INK : '#fff',
                    color: i % 2 ? '#fff' : INK,
                    border: `5px solid ${INK}`,
                    borderRadius: 999,
                    padding: '14px 28px',
                    fontSize: 28,
                    fontWeight: 900,
                    boxShadow: CARD_SHADOW,
                  }}
                >
                  {b}
                </div>
              </Pop>
            </FloatWrap>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 60, bottom: 40 }}>
        <FloatWrap t={t} phase={0.6} amp={10}>
          <Pop t={t} delay={40}>
            <PersonFigure accent={accent} flip />
          </Pop>
        </FloatWrap>
      </div>
    </div>
  );
};

type VignetteProps = { visual: Visual; t: number; accent: string };

const Vignette = ({ visual, t, accent }: VignetteProps) => {
  if (visual === 'bars') return <CityDash t={t} accent={accent} />;
  if (visual === 'timeline') return <Journey t={t} accent={accent} />;
  if (visual === 'cards') return <ChatCluster t={t} accent={accent} />;
  if (visual === 'pulse') return <Broadcast t={t} accent={accent} />;
  return <NetworkOrbit t={t} accent={accent} />;
};

// ---------------------------------------------------------------- text

type StickerProps = { text: string; accent: string; delay: number };

const Sticker = ({ text, accent, delay }: StickerProps) => {
  const frame = useCurrentFrame();
  const slam = spring({ frame: frame - delay, fps: 30, config: { damping: 9, stiffness: 280 } });
  const scale = interpolate(slam, [0, 1], [2.0, 1], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: '12px 24px',
        borderRadius: 16,
        background: accent,
        border: `4px solid ${INK}`,
        color: INK,
        fontSize: 26,
        fontWeight: 900,
        letterSpacing: 1,
        transform: `scale(${scale}) rotate(-3deg)`,
        opacity: slam <= 0 ? 0 : 1,
        boxShadow: '5px 5px 0 rgba(22,22,22,0.85)',
      }}
    >
      {String(text || '').toUpperCase()}
    </div>
  );
};

const KineticHeadline = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const words = String(text || '').split(/\s+/);
  return (
    <h1 style={{ margin: '26px 0 0', maxWidth: 900, fontSize: 76, lineHeight: 1.02, fontWeight: 900, color: INK }}>
      {words.map((word, i) => {
        const pop = spring({ frame: frame - 6 - i * 2, fps: 30, config: { damping: 13, stiffness: 260 } });
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              marginRight: 18,
              opacity: interpolate(pop, [0, 0.35], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
              transform: `translateY(${interpolate(pop, [0, 1], [50, 0], {
                extrapolateRight: 'clamp',
              })}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </h1>
  );
};

type SceneProps = { scene: TimelineScene; index: number; total: number };

const Scene = ({ scene, index, total }: SceneProps) => {
  const frame = useCurrentFrame();
  const accent = scene.accent || '#E8A800';
  const bodyOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <div style={{ padding: '150px 78px 0', fontFamily, position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Sticker text={scene.kicker} accent={accent} delay={4} />
          <span style={{ fontWeight: 900, fontSize: 28, color: INK, opacity: 0.55 }}>
            {index + 1}/{total}
          </span>
        </div>
        <KineticHeadline text={scene.headline} />
        <p
          style={{
            margin: '22px 0 0',
            maxWidth: 800,
            fontSize: 34,
            lineHeight: 1.25,
            color: 'rgba(22,22,22,0.62)',
            fontWeight: 600,
            opacity: bodyOpacity,
          }}
        >
          {scene.body}
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          top: 640,
          height: 1050,
          zIndex: 1,
        }}
      >
        <Vignette visual={scene.visual} t={frame} accent={accent} />
      </div>
    </AbsoluteFill>
  );
};

export const GeneratedReel = ({ title, scenes, audioFile }: ReelInputProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const normalizedScenes = safeScenes(scenes);
  const timeline = timelineFor(normalizedScenes, durationInFrames);

  return (
    <AbsoluteFill style={{ background: PAPER, overflow: 'hidden', fontFamily }}>
      {audioFile ? (
        <Audio src={/^https?:\/\//.test(audioFile) ? audioFile : staticFile(audioFile)} />
      ) : null}
      {/* faint dotted texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(22,22,22,0.10) 2px, transparent 2px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 78,
          top: 64,
          right: 78,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: INK,
          fontSize: 25,
          fontWeight: 800,
          zIndex: 10,
        }}
      >
        <span>{title}</span>
        <span>AI Reel</span>
      </div>

      <TransitionSeries>
        {timeline.flatMap((scene, index): ReactElement[] => {
          const items: ReactElement[] = [];
          if (index > 0) {
            items.push(
              <TransitionSeries.Transition
                key={`transition-${index}`}
                presentation={fade()}
                timing={linearTiming({ durationInFrames: OVERLAP })}
              />,
            );
          }
          items.push(
            <TransitionSeries.Sequence
              key={`scene-${index}`}
              durationInFrames={scene.durationInFrames}
            >
              <Scene scene={scene} index={index} total={timeline.length} />
            </TransitionSeries.Sequence>,
          );
          return items;
        })}
      </TransitionSeries>

      <div
        style={{
          position: 'absolute',
          left: 78,
          right: 78,
          bottom: 60,
          height: 12,
          borderRadius: 999,
          background: 'rgba(22,22,22,0.12)',
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
            background: INK,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
