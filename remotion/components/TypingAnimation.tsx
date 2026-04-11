import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { ElementBox } from '../../types';

interface TypingAnimationProps {
  text: string;
  startFrame: number;
  targetBox: ElementBox;
}

/**
 * TypingAnimation — renders characters appearing one-by-one inside a text field.
 * Overlaid on the BEFORE screenshot to simulate live typing.
 */
export const TypingAnimation: React.FC<TypingAnimationProps> = ({ text, startFrame, targetBox }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (frame < startFrame) return null;

  const elapsed = frame - startFrame;
  const charsPerFrame = 4 / fps; // ~4 characters per second
  const visibleChars = Math.min(text.length, Math.floor(elapsed * charsPerFrame));
  const displayText = text.slice(0, visibleChars);

  if (visibleChars === 0) return null;

  // Blink cursor after last visible character
  const cursorVisible = Math.floor(elapsed / (fps * 0.5)) % 2 === 0;

  // Position relative to the element's bounding box (inside the browser content area)
  // The targetBox coordinates are page-relative (1920x1080 viewport)
  // We need to map to the browser content area: 1600x900 (16:9 ratio)
  const BROWSER_WIDTH = 1600;
  const CONTENT_HEIGHT = 900;

  const x = (targetBox.x / 1920) * BROWSER_WIDTH;
  const y = (targetBox.y / 1080) * CONTENT_HEIGHT;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - (targetBox.width / 1920 * BROWSER_WIDTH) / 2 + 10, // Left edge of the input field
        top: y - 12,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <span
        style={{
          color: '#333',
          fontSize: 16,
          fontFamily: 'system-ui',
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}
      >
        {displayText}
        {cursorVisible && (
          <span style={{ color: '#6366f1', fontWeight: 300 }}>|</span>
        )}
      </span>
    </div>
  );
};
