import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export const Subtitles: React.FC<{ script: any }> = ({ script }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!script || !script.segments) return null;

  // No offset needed — we're inside a Sequence that starts at demo time
  return (
    <>
      {script.segments.map((seg: any, i: number) => {
        if (!seg.narration) return null;

        const startFrame = seg.start_time * fps;
        const endFrame = seg.end_time * fps;

        if (frame < startFrame || frame > endFrame) return null;

        // Smooth fade in over 8 frames, fade out over 10 frames
        const opacity = interpolate(
          frame,
          [startFrame, startFrame + 8, endFrame - 10, endFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );

        return (
          <AbsoluteFill
            key={i}
            style={{
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingBottom: 70,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.82)',
                padding: '10px 22px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                opacity,
                maxWidth: 1200,
              }}
            >
              <p style={{
                color: 'white',
                margin: 0,
                fontSize: 28,
                fontFamily: 'system-ui',
                fontWeight: 400,
                lineHeight: 1.4,
                textAlign: 'center',
              }}>
                {seg.narration}
              </p>
            </div>
          </AbsoluteFill>
        );
      })}
    </>
  );
};
