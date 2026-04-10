import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ScrollEvent } from '../../types';

export const ScrollBar: React.FC<{ scrollEvents?: ScrollEvent[] }> = ({ scrollEvents }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!scrollEvents || scrollEvents.length === 0) return null;

  const currentTime = frame / fps;

  // Find the exact scroll percentage based on current time
  let currentScroll = 0;
  
  if (currentTime < scrollEvents[0].timestamp) {
     currentScroll = 0;
  } else {
     // Find the two events we are between
     let e0 = scrollEvents[0];
     let e1 = scrollEvents[scrollEvents.length - 1];
     
     for (let i = 0; i < scrollEvents.length - 1; i++) {
        const t0 = scrollEvents[i].timestamp;
        const t1 = scrollEvents[i+1].timestamp;
        if (currentTime >= t0 && currentTime <= t1) {
           e0 = scrollEvents[i];
           e1 = scrollEvents[i+1];
           break;
        }
     }
     
     if (e0 === e1) {
        currentScroll = e1.scrollPercent;
     } else {
        const t0 = e0.timestamp;
        const t1 = e1.timestamp;
        const dt = t1 - t0;
        const p = (currentTime - t0) / dt;
        currentScroll = e0.scrollPercent + (e1.scrollPercent - e0.scrollPercent) * p;
     }
  }

  // Draw the progress bar inside the browser window
  // The browser window in TeaserVideo has height 945 (header is 42, content is 903)
  const CONTENT_HEIGHT = 903;
  const barHeight = Math.max(20, currentScroll * CONTENT_HEIGHT);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
         position: 'absolute',
         right: 14,
         top: 42 + 4, // below header
         width: 5,
         height: barHeight,
         backgroundColor: 'rgba(255,255,255,0.4)',
         borderRadius: 4
      }} />
    </AbsoluteFill>
  );
};
