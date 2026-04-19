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
import { KaraokeCaptions } from './components/KaraokeCaptions';
import { ClipMotion } from './components/ClipMotion';
import type { TeaserVideoProps } from '../types';

export type { TeaserVideoProps };

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;
const CROSSFADE_SECONDS = 0.25;

export const TeaserVideo: React.FC<TeaserVideoProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const introFrames = INTRO_SECONDS * fps;
  const outroFrames = OUTRO_SECONDS * fps;
  const demoFrames = durationInFrames - introFrames - outroFrames;
  const crossfadeFrames = Math.round(CROSSFADE_SECONDS * fps);

  // Intro fades out into the demo; demo fades out into the outro.
  const introToDemoOpacity = interpolate(
    frame,
    [introFrames - crossfadeFrames, introFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const demoOpacity = interpolate(
    frame,
    [
      introFrames - crossfadeFrames,
      introFrames,
      durationInFrames - outroFrames,
      durationInFrames - outroFrames + crossfadeFrames,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#050409' }}>
      {/* ─── Demo layer (full 1920×1080, immersive, no chrome) ─── */}
      <Sequence
        from={introFrames - crossfadeFrames}
        durationInFrames={demoFrames + crossfadeFrames * 2}
        layout="none"
      >
        <AbsoluteFill style={{ opacity: demoOpacity }}>
          {props.recordedVideoUrl ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: '#000',
                overflow: 'hidden',
              }}
            >
              {(() => {
                let cumulativeFrame = 0;
                return props.scenes.flatMap((scene, sceneIdx) =>
                  scene.clips.map((clip, clipIdx) => {
                    const clipDurFrames = Math.round(
                      ((clip.end - clip.start) / 1000) * fps
                    );
                    const startAt = cumulativeFrame;
                    cumulativeFrame += clipDurFrames;
                    return (
                      <Sequence
                        key={`s${sceneIdx}c${clipIdx}`}
                        from={crossfadeFrames + startAt}
                        durationInFrames={clipDurFrames}
                        layout="none"
                      >
                        <ClipMotion
                          scene={scene}
                          clipDurFrames={clipDurFrames}
                          isLeadClip={clipIdx === 0}
                        >
                          <OffthreadVideo
                            src={props.recordedVideoUrl!}
                            startFrom={Math.round((clip.start / 1000) * fps)}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        </ClipMotion>
                      </Sequence>
                    );
                  })
                );
              })()}
            </div>
          ) : (
            <AbsoluteFill
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontFamily: 'system-ui',
              }}
            >
              No demo footage recorded.
            </AbsoluteFill>
          )}

          {/* Karaoke caption layer — positioned relative to demo start */}
          <KaraokeCaptions
            scenes={props.scenes}
            startFrame={crossfadeFrames}
          />
        </AbsoluteFill>
      </Sequence>

      {/* ─── Intro (overlays; fades out to reveal the demo) ─── */}
      {introToDemoOpacity > 0 && (
        <Sequence from={0} durationInFrames={introFrames} layout="none">
          <AbsoluteFill style={{ opacity: introToDemoOpacity }}>
            <Intro productName={props.productName} tagline={props.tagline} />
          </AbsoluteFill>
        </Sequence>
      )}

      {/* ─── Outro ─── */}
      <Sequence
        from={durationInFrames - outroFrames}
        durationInFrames={outroFrames}
        layout="none"
      >
        <Outro productName={props.productName} productUrl={props.productUrl} />
      </Sequence>

      {/* ─── Progress bar across the full master ─── */}
      <ProgressBar />

      {/* ─── Audio ─── */}
      {props.voiceoverUrl && <Audio src={props.voiceoverUrl} />}
      {props.musicUrl && (
        <Audio
          src={props.musicUrl}
          volume={(f) => {
            // Fade in 0 → 0.22 over first 1s, hold, fade 0.22 → 0 over last 1.5s.
            const fadeInFrames = fps * 1;
            const fadeOutStart = durationInFrames - Math.round(fps * 1.5);
            if (f < fadeInFrames) return (f / fadeInFrames) * 0.22;
            if (f > fadeOutStart) {
              const tail = Math.max(
                0,
                1 - (f - fadeOutStart) / (durationInFrames - fadeOutStart)
              );
              return 0.22 * tail;
            }
            return 0.22;
          }}
        />
      )}
    </AbsoluteFill>
  );
};
