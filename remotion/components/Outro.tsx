import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

interface OutroProps {
  productName: string;
}

export const Outro: React.FC<OutroProps> = ({ productName }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in from dark
  const bgOpacity = interpolate(frame, [0, fps * 0.6], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // CTA text entrance — spring
  const ctaProgress = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const ctaY = interpolate(ctaProgress, [0, 1], [50, 0]);
  const ctaOpacity = interpolate(ctaProgress, [0, 1], [0, 1]);

  // Tagline entrance — staggered
  const tagProgress = spring({
    frame: frame - 25,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const tagY = interpolate(tagProgress, [0, 1], [30, 0]);
  const tagOpacity = interpolate(tagProgress, [0, 1], [0, 1]);

  // Fade to black at the very end
  const fadeToBlack = interpolate(
    frame,
    [durationInFrames - fps * 0.8, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #080614 0%, #0a0820 100%)',
      opacity: bgOpacity,
    }}>
      <div style={{ textAlign: 'center' }}>
        {/* Product name */}
        <p style={{
          color: 'white',
          fontSize: 52,
          margin: 0,
          fontFamily: 'system-ui',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          transform: `translateY(${ctaY}px)`,
          opacity: ctaOpacity,
        }}>
          Try {productName} today
        </p>

        {/* Decorative gradient line */}
        <div style={{
          width: 80,
          height: 3,
          background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
          margin: '24px auto',
          borderRadius: 2,
          opacity: tagOpacity,
        }} />

        {/* URL / CTA */}
        <p style={{
          color: '#8888aa',
          fontSize: 28,
          margin: 0,
          fontFamily: 'system-ui',
          fontWeight: 300,
          transform: `translateY(${tagY}px)`,
          opacity: tagOpacity,
        }}>
          useteaser.com
        </p>
      </div>

      {/* Final fade to black */}
      {fadeToBlack > 0 && (
        <AbsoluteFill style={{
          backgroundColor: '#000',
          opacity: fadeToBlack,
        }} />
      )}
    </AbsoluteFill>
  );
};
