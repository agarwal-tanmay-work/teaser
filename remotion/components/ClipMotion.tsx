import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
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
 * Wraps a demo clip with motion to sell interaction beats.
 *
 * Design: NO Ken-Burns drift. Slow scaling on every clip reads as a
 * documentary, not a SaaS launch demo. Modern launch videos (Linear,
 * Notion, Vercel, Stripe) cut hard and zoom only on the moment of action.
 *
 * Triggered ONLY on `click` and `type` actions on the lead clip of the
 * scene. Curve: snap-zoom from 1.0 → 1.18 in ~0.33 s with cubic ease-out,
 * then HOLD at 1.18 for the rest of the clip — no zoom-out drift. The
 * jump cut at the next clip handles the visual reset cleanly.
 *
 * For `type` actions, a tiny mid-clip settle bounce sells the keystroke
 * moment without becoming busy.
 *
 * Scroll, navigate, and hover clips: no motion. The recording itself
 * already carries motion (scroll, page change, cursor); adding scale on
 * top reads as artificial.
 */
export const ClipMotion: React.FC<ClipMotionProps> = ({
  scene,
  clipDurFrames,
  isLeadClip,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let scale = 1.0;
  let originX = 50;
  let originY = 50;

  const isInteraction =
    isLeadClip &&
    scene.targetElement !== null &&
    (scene.action === 'click' || scene.action === 'type');

  if (isInteraction && scene.targetElement) {
    // Origin pinned to the element centre, clamped 8–92 % so zooms never
    // crop edge elements out of frame.
    originX = Math.max(8, Math.min(92, (scene.targetElement.x / 1920) * 100));
    originY = Math.max(8, Math.min(92, (scene.targetElement.y / 1080) * 100));

    // Snap-zoom: 1.0 → 1.18 in ~10 frames (≈0.33 s on 30 fps), cubic ease-out.
    const zoomInDur = Math.min(12, Math.max(6, Math.round(fps * 0.33)));
    const punched = interpolate(frame, [0, zoomInDur], [1.0, 1.18], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
    scale = punched;

    // For `type` actions, add a tiny mid-clip bounce (1.18 → 1.205 → 1.18)
    // over 6 frames at the clip mid. Reads as the moment a query lands.
    if (scene.action === 'type' && clipDurFrames > zoomInDur + 8) {
      const bounceCenter = Math.round(clipDurFrames * 0.55);
      const bouncePhase = interpolate(
        frame,
        [bounceCenter - 3, bounceCenter, bounceCenter + 3],
        [0, 1, 0],
        {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.4, 0, 0.6, 1),
        }
      );
      scale = punched + bouncePhase * 0.025;
    }
  }

  // 6-frame opacity fade at clip head and tail to smooth the jump-cut edges.
  const edgeFadeFrames = Math.min(6, Math.floor(clipDurFrames / 4));
  const opacity = interpolate(
    frame,
    [0, edgeFadeFrames, clipDurFrames - edgeFadeFrames, clipDurFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
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
