import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ClickEvent } from '../../types';

export const Cursor: React.FC<{ clickEvents: ClickEvent[] }> = ({ clickEvents }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!clickEvents || clickEvents.length === 0) return null;

  // Only consider click/hover/type actions (not navigate/scroll)
  const interactiveEvents = clickEvents.filter(
    e => e.action === 'click' || e.action === 'hover' || e.action === 'type'
  );

  if (interactiveEvents.length === 0) return null;

  // Find the most recent event that started showing, and the next one (for interpolation)
  let activeEvent: ClickEvent | null = null;
  let nextEvent: ClickEvent | null = null;

  for (let i = 0; i < interactiveEvents.length; i++) {
    const ev = interactiveEvents[i];
    const evFrame = (ev.timestamp * fps); // relative to DemoSequence 0
    const showStart = evFrame - (fps * 0.5); // show 0.5s before
    const showEnd = evFrame + (fps * 1.5);   // show 1.5s after

    if (frame >= showStart && frame <= showEnd) {
      activeEvent = ev;
      nextEvent = interactiveEvents[i + 1] || null;
      break;
    }
  }

  if (!activeEvent) return null;

  const clickFrame = (activeEvent.timestamp * fps);

  // Safe spring — only pulse after the click moment, never negative frames
  const framesSinceClick = Math.max(0, frame - clickFrame);
  const rippleScale = spring({
    frame: framesSinceClick,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
    durationInFrames: 15,
  });

  const isClicking = frame >= clickFrame && frame < clickFrame + 6;
  const cursorScale = isClicking ? 0.75 : 1;

  // Fade in/out
  const showStart = clickFrame - (fps * 0.5);
  const showEnd = clickFrame + (fps * 1.5);
  const opacity = interpolate(
    frame,
    [showStart, showStart + 5, showEnd - 8, showEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Map coordinates: capture is 1920x1080, browser window is 1680x945 centered
  const PAD_X = Math.round((1920 - 1680) / 2);
  const PAD_Y = Math.round((1080 - 945) / 2);
  const x = PAD_X + (activeEvent.x / 1920) * 1680;
  const y = PAD_Y + (activeEvent.y / 1080) * 945;

  return (
    <div
      style={{
        position: 'absolute',
        top: y,
        left: x,
        transform: `translate(-50%, -50%) scale(${cursorScale})`,
        pointerEvents: 'none',
        zIndex: 9999,
        opacity,
      }}
    >
      {/* Cursor SVG */}
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.24c.45 0 .67-.54.35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z"
          fill="#000"
          stroke="#FFF"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Indigo Ripple on Click */}
      {isClicking && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 80 * rippleScale,
          height: 80 * rippleScale,
          backgroundColor: 'rgba(99, 102, 241, 0.45)',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          opacity: Math.max(0, 1 - rippleScale),
        }} />
      )}
    </div>
  );
};
