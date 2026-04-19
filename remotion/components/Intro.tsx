import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { IntroProps } from '../../types';

export const Intro: React.FC<IntroProps> = ({ productName, tagline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Background opacity — fully visible immediately
  const bgOpacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Product name entrance — spring from below
  const nameProgress = spring({
    frame: frame - 8,
    fps,
    config: { damping: 10, stiffness: 90, mass: 0.75 },
  });
  const nameY = interpolate(nameProgress, [0, 1], [60, 0]);
  const nameOpacity = interpolate(nameProgress, [0, 1], [0, 1]);

  // Tagline entrance — staggered after name
  const taglineProgress = spring({
    frame: frame - 22,
    fps,
    config: { damping: 10, stiffness: 90, mass: 0.75 },
  });
  const taglineY = interpolate(taglineProgress, [0, 1], [40, 0]);
  const taglineOpacity = interpolate(taglineProgress, [0, 1], [0, 1]);

  // Decorative line between name and tagline
  const lineWidth = interpolate(frame, [15, 35], [0, 120], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #080614 0%, #0f0d24 50%, #171032 100%)',
      opacity: bgOpacity,
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          color: 'white',
          fontSize: 104,
          margin: 0,
          fontWeight: 900,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          letterSpacing: '-0.045em',
          transform: `translateY(${nameY}px)`,
          opacity: nameOpacity,
          textShadow: '0 8px 40px rgba(99, 102, 241, 0.35)',
        }}>
          {productName}
        </h1>

        {/* Decorative gradient line */}
        <div style={{
          width: lineWidth,
          height: 3,
          background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
          margin: '20px auto',
          borderRadius: 2,
        }} />

        <p style={{
          color: '#b0b0cc',
          fontSize: 34,
          margin: 0,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          fontWeight: 300,
          letterSpacing: '0.01em',
          transform: `translateY(${taglineY}px)`,
          opacity: taglineOpacity,
        }}>
          {tagline}
        </p>
      </div>
    </AbsoluteFill>
  );
};
