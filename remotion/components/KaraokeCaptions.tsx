import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from 'remotion';
import type { SceneCapture, WordTiming } from '../../types';

interface KaraokeCaptionsProps {
  scenes: SceneCapture[];
  /** Absolute start frame in master composition (i.e. where the demo clips begin). */
  startFrame: number;
}

interface TimedWord {
  text: string;
  startFrame: number;
  endFrame: number;
  emphasis: boolean;
}

interface TimedScene {
  sceneStart: number;
  sceneDur: number;
  words: TimedWord[];
}

const EMPHASIS_RE = /^\*\*(.+?)\*\*([.,!?;:"')\]]*)$/;

/**
 * Parses narration text. Recognises `**word**` markup as emphasis and strips
 * the asterisks from the visible text.
 */
function parseNarration(narration: string): { text: string; emphasis: boolean }[] {
  const cleaned = (narration ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(' ');
  return tokens.map((tok) => {
    const m = tok.match(EMPHASIS_RE);
    if (m) return { text: m[1] + (m[2] ?? ''), emphasis: true };
    return { text: tok, emphasis: false };
  });
}

/**
 * Computes timing for each word of a scene. Uses pre-populated `wordTimings` if
 * available, otherwise distributes words evenly across the scene's duration
 * with a minimum of 8 frames per word so short words stay readable.
 */
function buildTimedWords(
  parsed: { text: string; emphasis: boolean }[],
  sceneStartFrame: number,
  sceneDurFrames: number,
  fps: number,
  explicit: WordTiming[] | undefined
): TimedWord[] {
  if (parsed.length === 0) return [];
  if (explicit && explicit.length === parsed.length) {
    return explicit.map((w, i) => ({
      text: parsed[i].text,
      startFrame: sceneStartFrame + Math.round((w.startMs / 1000) * fps),
      endFrame: sceneStartFrame + Math.round((w.endMs / 1000) * fps),
      emphasis: parsed[i].emphasis || w.emphasis === true,
    }));
  }
  const count = parsed.length;
  const perWord = Math.max(8, Math.floor(sceneDurFrames / count));
  const totalWords = perWord * count;
  const padding = Math.max(0, Math.floor((sceneDurFrames - totalWords) / 2));
  return parsed.map((p, i) => ({
    text: p.text,
    startFrame: sceneStartFrame + padding + i * perWord,
    endFrame: sceneStartFrame + padding + (i + 1) * perWord,
    emphasis: p.emphasis,
  }));
}

const WORDS_PER_LINE = 6;

/**
 * Word-level karaoke caption layer. Renders on top of the demo footage.
 * - Active word: amber `#FACC15` with spring scale 1.08 + glow
 * - Spoken: white 0.78 opacity
 * - Unspoken: hidden (word springs in 80ms before its timing mark)
 *
 * Windowing: max 2 lines visible, scrolls as the active word advances past
 * line boundaries.
 */
export const KaraokeCaptions: React.FC<KaraokeCaptionsProps> = ({ scenes, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const relFrame = frame - startFrame;

  let cumulative = 0;
  const timed: TimedScene[] = scenes.map((scene) => {
    const sceneDur = scene.clips.reduce(
      (acc, clip) => acc + Math.round(((clip.end - clip.start) / 1000) * fps),
      0
    );
    const sceneStart = cumulative;
    cumulative += sceneDur;
    const parsed = parseNarration(scene.narration ?? '');
    const words = buildTimedWords(parsed, sceneStart, sceneDur, fps, scene.wordTimings);
    return { sceneStart, sceneDur, words };
  });

  const active = timed.find(
    (s) => relFrame >= s.sceneStart && relFrame < s.sceneStart + s.sceneDur
  );

  if (!active || active.words.length === 0) return null;

  const lines: TimedWord[][] = [];
  for (let i = 0; i < active.words.length; i += WORDS_PER_LINE) {
    lines.push(active.words.slice(i, i + WORDS_PER_LINE));
  }

  let activeLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const inRange = lines[i].some(
      (w) => relFrame >= w.startFrame && relFrame < w.endFrame
    );
    if (inRange) {
      activeLineIdx = i;
      break;
    }
    if (lines[i][lines[i].length - 1].endFrame <= relFrame) {
      activeLineIdx = i;
    }
  }
  const visibleLines = lines.slice(activeLineIdx, activeLineIdx + 2);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 110,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          maxWidth: 1480,
          padding: '24px 44px',
          backgroundColor: 'rgba(0, 0, 0, 0.38)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderRadius: 18,
          border: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        {visibleLines.map((line, li) => (
          <div
            key={li}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '0 22px',
              rowGap: 6,
            }}
          >
            {line.map((w, wi) => {
              const isActive = relFrame >= w.startFrame && relFrame < w.endFrame;
              const isSpoken = relFrame >= w.endFrame;
              const isUnspoken = relFrame < w.startFrame;

              const reveal = spring({
                frame: Math.max(0, relFrame - (w.startFrame - 3)),
                fps,
                config: { damping: 13, stiffness: 190, mass: 0.55 },
              });

              const emphasisBoost = w.emphasis ? 0.05 : 0;
              const targetScale = isActive ? 1.08 + emphasisBoost : 1.0;
              const scale = isUnspoken
                ? 0.9
                : 1.0 + (targetScale - 1.0) * reveal;

              const color = isActive || (w.emphasis && isSpoken)
                ? '#FACC15'
                : '#FFFFFF';
              const opacity = isUnspoken
                ? 0
                : isActive
                  ? 1
                  : 0.8;
              const glow = isActive
                ? '0 0 26px rgba(250, 204, 21, 0.55), 0 4px 14px rgba(0,0,0,0.9)'
                : '0 4px 12px rgba(0,0,0,0.85)';

              return (
                <span
                  key={wi}
                  style={{
                    color,
                    fontSize: 60,
                    fontWeight: 900,
                    fontFamily:
                      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
                    letterSpacing: '-0.015em',
                    lineHeight: 1.14,
                    transform: `scale(${scale})`,
                    transformOrigin: 'center bottom',
                    opacity,
                    textShadow: glow,
                    display: 'inline-block',
                  }}
                >
                  {w.text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export default KaraokeCaptions;
