import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { VideoScript } from '../../types';

interface FeatureHighlightProps {
  script?: VideoScript;
}

export const FeatureHighlight: React.FC<FeatureHighlightProps> = ({ script }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!script || !script.segments) return null;

  return (
    <>
      {script.segments.map((seg, i) => {
        if (!seg.what_to_show) return null;

        const startFrame = seg.start_time * fps;
        const duration = fps * 3; // show for 3 seconds
        const endFrame = startFrame + duration;

        if (frame < startFrame || frame > endFrame) return null;

        // Slide in from bottom-right
        const progress = spring({
          frame: frame - startFrame,
          fps,
          config: { damping: 16, stiffness: 100 },
        });

        const translateY = interpolate(progress, [0, 1], [30, 0]);
        const opacity = interpolate(
          frame,
          [startFrame, startFrame + 6, endFrame - 10, endFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );

        return (
          <AbsoluteFill
            key={i}
            style={{
              justifyContent: 'flex-start',
              alignItems: 'flex-end',
              padding: '100px 40px 0 0',
              pointerEvents: 'none',
              zIndex: 9997,
            }}
          >
            <div style={{
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              backdropFilter: 'blur(8px)',
              padding: '10px 20px',
              borderRadius: 10,
              opacity,
              transform: `translateY(${translateY}px)`,
              maxWidth: 400,
            }}>
              <p style={{
                color: '#d4d4ff',
                fontSize: 18,
                margin: 0,
                fontFamily: 'system-ui',
                fontWeight: 400,
              }}>
                {seg.what_to_show}
              </p>
            </div>
          </AbsoluteFill>
        );
      })}
    </>
  );
};
