import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import type { SceneCapture } from '../../types';

interface ClipMotionProps {
  scene: SceneCapture;
  clipDurFrames: number;
  /** Whether this clip is the first of its parent scene — the clip that "owns" the click-zoom moment. */
  isLeadClip: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a demo clip with motion to sell the moment:
 * - Scenes with a click target (`targetElement` set): smart zoom-in toward the
 *   element, brief hold, then zoom out. Origin is set to the element's
 *   centre so the frame feels drawn to where the action is.
 * - Scenes without a target (scroll / navigate / hover on nothing):
 *   slow Ken Burns pan — 1.00 → 1.04 across the clip with a gentle drift
 *   toward the lower third, which is where most UI action lives.
 *
 * All motion is clip-relative via `useCurrentFrame()` inside the child
 * `Sequence`, so zoom timings follow clip trim boundaries even when the
 * recording is jump-cut.
 */
export const ClipMotion: React.FC<ClipMotionProps> = ({
  scene,
  clipDurFrames,
  isLeadClip,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const t = clipDurFrames > 0
    ? Math.min(1, Math.max(0, frame / clipDurFrames))
    : 0;

  let scale = 1.0;
  let originX = 50;
  let originY = 50;
  let translateX = 0;
  let translateY = 0;

  const hasClickTarget =
    scene.targetElement !== null &&
    isLeadClip &&
    (scene.action === 'click' || scene.action === 'type' || scene.action === 'hover');

  if (hasClickTarget && scene.targetElement) {
    // Origin at the element centre. Convert to percent of the 1920×1080 frame.
    const cx = Math.max(8, Math.min(92, (scene.targetElement.x / 1920) * 100));
    const cy = Math.max(8, Math.min(92, (scene.targetElement.y / 1080) * 100));
    originX = cx;
    originY = cy;

    // Smart zoom curve across the clip:
    // 0.0 → 0.25: zoom in 1.00 → 1.12
    // 0.25 → 0.75: hold 1.12 (click + result moment)
    // 0.75 → 1.0:  zoom out 1.12 → 1.00
    const zoomInPhase = interpolate(t, [0, 0.25], [1.0, 1.12], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const zoomOutPhase = interpolate(t, [0.75, 1.0], [1.12, 1.0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    scale = Math.min(zoomInPhase, zoomOutPhase);
  } else {
    // Ken Burns: gentle scale from 1.00 → 1.04 with a whisper of drift.
    scale = interpolate(t, [0, 1], [1.0, 1.04]);
    translateX = interpolate(t, [0, 1], [0, -12]);
    translateY = interpolate(t, [0, 1], [0, 8]);
  }

  // Damped fade-in at clip head + fade-out at clip tail to smooth
  // jump-cut edges. 6 frames (≈200 ms) on each side.
  const edgeFadeFrames = Math.min(6, Math.floor(clipDurFrames / 4));
  const opacity = interpolate(
    frame,
    [0, edgeFadeFrames, clipDurFrames - edgeFadeFrames, clipDurFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Keep fps in scope for future motion tweaks that need time-based easing.
  void fps;

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        transformOrigin: `${originX}% ${originY}%`,
        opacity,
        overflow: 'hidden',
        willChange: 'transform, opacity',
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export default ClipMotion;
