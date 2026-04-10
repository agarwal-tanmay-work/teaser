import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import { Cursor } from './components/Cursor';
import { Subtitles } from './components/Subtitles';
import { LowerThird } from './components/LowerThird';
import { ScrollBar } from './components/ScrollBar';
import { ProgressBar } from './components/ProgressBar';
import { FeatureHighlight } from './components/FeatureHighlight';
import type { ClickEvent } from '../types';

export interface TeaserVideoProps {
  rawVideoUrl: string;
  voiceoverUrl?: string;
  clickEvents: ClickEvent[];
  scrollEvents?: any[];
  script?: any;
  productName: string;
  tagline: string;
}

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;

/**
 * DemoSection — the core recording playback with all overlays
 * Wrapped in its own <Sequence> so useCurrentFrame() is relative to demo start.
 */
const DemoSection: React.FC<{
  rawVideoUrl: string;
  clickEvents: ClickEvent[];
  scrollEvents?: any[];
  script?: any;
  productName: string;
}> = ({ rawVideoUrl, clickEvents, scrollEvents, script, productName }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ─── Camera Zoom on click events ───
  let currentZoom = 1;
  let originX = '50%';
  let originY = '50%';

  if (clickEvents && clickEvents.length > 0) {
    const clickFrameWindow = fps * 2.8;
    const rampIn = fps * 0.5;
    const rampOut = fps * 0.6;

    const activeZoomClick = clickEvents.find(e => {
      if (e.action !== 'click') return false;
      // Timestamps are relative to recording start, which aligns with demo sequence start
      const tCenter = e.timestamp * fps;
      return frame >= tCenter - rampIn && frame <= tCenter + clickFrameWindow;
    });

    if (activeZoomClick) {
      const tCenter = activeZoomClick.timestamp * fps;
      const tStart = tCenter - rampIn;
      const tEnd = tCenter + clickFrameWindow;

      currentZoom = interpolate(
        frame,
        [tStart, tCenter, tEnd - rampOut, tEnd],
        [1, 1.25, 1.25, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );

      originX = `${Math.max(15, Math.min(85, (activeZoomClick.x / 1920) * 100))}%`;
      originY = `${Math.max(15, Math.min(85, (activeZoomClick.y / 1080) * 100))}%`;
    }
  }

  return (
    <AbsoluteFill>
      {/* Deep navy gradient background */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(135deg, #080614 0%, #0f0d24 50%, #171032 100%)',
        }}
      />

      {/* Zoomable browser window wrapper */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${currentZoom})`,
          transformOrigin: `${originX} ${originY}`,
        }}
      >
        <div
          style={{
            width: 1680,
            height: 945,
            backgroundColor: '#0a0a0a',
            borderRadius: 16,
            boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* macOS Chrome Header */}
          <div style={{
            height: 42,
            backgroundColor: '#1c1c1c',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            gap: 8,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
            <div style={{
              marginLeft: 60,
              flex: 1,
              maxWidth: 800,
              height: 26,
              backgroundColor: '#2e2e2e',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 12,
            }}>
              <span style={{ color: '#888', fontSize: 13, fontFamily: 'system-ui' }}>
                {productName.toLowerCase().replace(/\s+/g, '')}.com
              </span>
            </div>
          </div>

          {/* Video content */}
          <div style={{ flex: 1, position: 'relative' }}>
            {rawVideoUrl ? (
              <OffthreadVideo
                src={rawVideoUrl}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : null}
            <ScrollBar scrollEvents={scrollEvents} />
          </div>
        </div>

        {/* Animated Mouse Cursor */}
        <Cursor clickEvents={clickEvents} />
      </AbsoluteFill>

      {/* Cinematic Overlays — these use script timestamps directly (no offset needed) */}
      <FeatureHighlight script={script} />
      <Subtitles script={script} />
    </AbsoluteFill>
  );
};

/**
 * TeaserVideo — main Remotion composition
 * Uses <Sequence> to structure the video into Intro → Demo → Outro
 * Each component gets its own timeline via useCurrentFrame() starting at 0.
 */
export const TeaserVideo: React.FC<TeaserVideoProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const introFrames = INTRO_SECONDS * fps;
  const outroFrames = OUTRO_SECONDS * fps;
  const demoFrames = durationInFrames - introFrames - outroFrames;

  // Cross-fade: intro fades out over the first 0.5s of the demo
  const crossFadeOut = interpolate(
    frame,
    [introFrames - fps * 0.3, introFrames + fps * 0.2],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#080614' }}>
      {/* ─── Demo Sequence (plays behind everything, slightly early for cross-fade) ─── */}
      <Sequence from={Math.max(0, introFrames - fps * 0.3)} durationInFrames={demoFrames + fps * 0.3} layout="none">
        <DemoSection
          rawVideoUrl={props.rawVideoUrl}
          clickEvents={props.clickEvents}
          scrollEvents={props.scrollEvents}
          script={props.script}
          productName={props.productName}
        />
      </Sequence>

      {/* ─── Intro Sequence (overlays on top, fades out to reveal demo) ─── */}
      {crossFadeOut > 0 && (
        <Sequence from={0} durationInFrames={introFrames + fps * 0.3} layout="none">
          <AbsoluteFill style={{ opacity: crossFadeOut }}>
            <Intro productName={props.productName} tagline={props.tagline} />
          </AbsoluteFill>
        </Sequence>
      )}

      {/* ─── Outro Sequence ─── */}
      <Sequence from={durationInFrames - outroFrames} durationInFrames={outroFrames} layout="none">
        <Outro productName={props.productName} />
      </Sequence>

      {/* ─── Progress Bar (spans entire video) ─── */}
      <ProgressBar />

      {/* ─── Audio (spans entire video) ─── */}
      {props.voiceoverUrl && <Audio src={props.voiceoverUrl} />}
    </AbsoluteFill>
  );
};
