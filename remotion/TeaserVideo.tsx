import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  OffthreadVideo,
} from 'remotion';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import { ProgressBar } from './components/ProgressBar';
import type { SceneCapture } from '../types';

export interface TeaserVideoProps {
  scenes: SceneCapture[];
  recordedVideoUrl?: string;
  voiceoverUrl?: string;
  productName: string;
  tagline: string;
  productUrl: string;
}

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;

export const TeaserVideo: React.FC<TeaserVideoProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const introFrames = INTRO_SECONDS * fps;
  const outroFrames = OUTRO_SECONDS * fps;
  const demoFrames = durationInFrames - introFrames - outroFrames;

  // Intro fade-out crossfade
  const crossFadeOut = interpolate(
    frame,
    [introFrames - fps * 0.3, introFrames + fps * 0.2],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#080614' }}>
      
      {/* ─── Recorded Demo Video ─── */}
      <Sequence from={introFrames} durationInFrames={demoFrames} layout="none">
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          {/* Background behind the video window */}
          <AbsoluteFill
            style={{
              background: 'radial-gradient(circle at center, #1b163a 0%, #080614 100%)',
              zIndex: -1
            }}
          />

          {props.recordedVideoUrl ? (
            <div style={{
              width: 1600,
              height: 900,
              borderRadius: 16,
              boxShadow: '0 50px 120px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#0a0a0a'
            }}>
              {/* macOS Chrome Header */}
              <div style={{
                height: 42,
                backgroundColor: 'rgba(25, 25, 25, 0.95)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 20px',
                gap: 8,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                flexShrink: 0,
                zIndex: 10,
              }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
                <div style={{
                  marginLeft: 60,
                  flex: 1,
                  maxWidth: 800,
                  height: 26,
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 12,
                }}>
                  <span style={{ color: '#888', fontSize: 13, fontFamily: 'system-ui' }}>
                    {props.productUrl ? new URL(props.productUrl).hostname : 'app.demo.io'}
                  </span>
                </div>
              </div>

              {/* Sequentialized Jump-Cut Video Flow */}
              <div style={{ flex: 1, position: 'relative', backgroundColor: '#000' }}>
                {(() => {
                  let cumulativeFrame = 0
                  return props.scenes.flatMap((scene, sceneIdx) => {
                    return scene.clips.map((clip, clipIdx) => {
                      const clipDurFrames = Math.round(((clip.end - clip.start) / 1000) * fps)
                      const startAt = cumulativeFrame
                      cumulativeFrame += clipDurFrames
                      
                      return (
                        <Sequence 
                          key={`s${sceneIdx}c${clipIdx}`} 
                          from={startAt} 
                          durationInFrames={clipDurFrames}
                          layout="none"
                        >
                          <OffthreadVideo 
                            src={props.recordedVideoUrl!} 
                            startFrom={Math.round((clip.start / 1000) * fps)}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        </Sequence>
                      )
                    })
                  })
                })()}
              </div>
            </div>
          ) : (
            <div style={{ color: 'white' }}>No video recorded.</div>
          )}

          {/* Subtitles Overlay mapped to merged clips */}
          {(() => {
            let cumulativeFrame = 0
            return props.scenes.map((scene, i) => {
              const sceneDurFrames = scene.clips.reduce((acc, clip) => 
                acc + Math.round(((clip.end - clip.start) / 1000) * fps), 0
              )
              const startAt = cumulativeFrame
              cumulativeFrame += sceneDurFrames
              
              return (
                <Sequence key={i} from={startAt} durationInFrames={sceneDurFrames} layout="none">
                  {scene.narration && (
                    <AbsoluteFill
                      style={{
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        paddingBottom: 60,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        opacity: interpolate(
                          frame - (introFrames + startAt), 
                          [0, 10, sceneDurFrames - 10, sceneDurFrames], 
                          [0, 1, 1, 0], 
                          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
                        )
                      }}
                    >
                      <div
                        style={{
                          backgroundColor: 'rgba(10, 10, 15, 0.75)',
                          padding: '16px 36px',
                          borderRadius: 14,
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                          backdropFilter: 'blur(16px)',
                          maxWidth: 1200,
                        }}
                      >
                        <p style={{
                          color: '#f8f8f8',
                          margin: 0,
                          fontSize: 28,
                          fontFamily: 'system-ui',
                          fontWeight: 500,
                          lineHeight: 1.4,
                          textAlign: 'center',
                          letterSpacing: '0.01em',
                          textShadow: '0 2px 8px rgba(0,0,0,0.6)'
                        }}>
                          {scene.narration}
                        </p>
                      </div>
                    </AbsoluteFill>
                  )}
                </Sequence>
              )
            })
          })()}
        </AbsoluteFill>
      </Sequence>

      {/* ─── Intro (overlays on top, fades out to reveal video) ─── */}
      {crossFadeOut > 0 && (
        <Sequence from={0} durationInFrames={introFrames + Math.round(fps * 0.3)} layout="none">
          <AbsoluteFill style={{ opacity: crossFadeOut }}>
            <Intro productName={props.productName} tagline={props.tagline} />
          </AbsoluteFill>
        </Sequence>
      )}

      {/* ─── Outro ─── */}
      <Sequence from={durationInFrames - outroFrames} durationInFrames={outroFrames} layout="none">
        <Outro productName={props.productName} productUrl={props.productUrl} />
      </Sequence>

      {/* ─── Progress Bar (spans full video) ─── */}
      <ProgressBar />

      {/* ─── Audio ─── */}
      {props.voiceoverUrl && <Audio src={props.voiceoverUrl} />}
    </AbsoluteFill>
  );
};
