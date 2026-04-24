import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoScript } from '../../types';

export const LowerThird: React.FC<{ script: VideoScript }> = ({ script }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!script || !script.segments) return null;

  // Show a lower third for every other segment to avoid visual clutter
  return (
    <>
      {script.segments
        .filter((_, i) => i % 3 === 0)
        .map((seg, i) => {
          if (!seg.what_to_show) return null;

          const startFrame = seg.start_time * fps;
          const duration = fps * 2.8;
          const endFrame = startFrame + duration;

          if (frame < startFrame || frame > endFrame) return null;

          // Slide in from left using spring
          const progress = spring({
            frame: Math.max(0, frame - startFrame),
            fps,
            config: { damping: 14, stiffness: 120 },
          });

          const translateX = interpolate(progress, [0, 1], [-180, 0]);
          const opacity = interpolate(
            frame,
            [startFrame, startFrame + 6, endFrame - fps * 0.4, endFrame],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );

          return (
            <AbsoluteFill
              key={i}
              style={{
                justifyContent: 'flex-end',
                paddingLeft: 40,
                paddingBottom: 140,
                pointerEvents: 'none',
                zIndex: 9998,
              }}
            >
              <div
                style={{
                  backgroundColor: 'rgba(8, 6, 20, 0.75)',
                  borderLeft: '3px solid #6366f1',
                  padding: '12px 20px',
                  borderRadius: '0 8px 8px 0',
                  transform: `translateX(${translateX}px)`,
                  opacity,
                  width: 'fit-content',
                  maxWidth: 500,
                }}
              >
                <p style={{
                  color: '#e0e0f0',
                  margin: 0,
                  fontSize: 20,
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
