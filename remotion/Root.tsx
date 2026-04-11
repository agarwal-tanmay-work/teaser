import { Composition, getInputProps, registerRoot } from 'remotion';
import { TeaserVideo, TeaserVideoProps } from './TeaserVideo';
import React from 'react';

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as any;

  // Calculate total duration by summing all curated clips
  const fps = 30;
  let totalDemoFrames = 0;
  if (inputProps.scenes) {
    for (const scene of inputProps.scenes) {
      if (scene.clips) {
        for (const clip of scene.clips) {
          totalDemoFrames += Math.round(((clip.end - clip.start) / 1000) * fps);
        }
      }
    }
  }

  const demoDuration = totalDemoFrames > 0 ? (totalDemoFrames / fps) : 10;
  const videoSeconds = INTRO_SECONDS + demoDuration + OUTRO_SECONDS;
  const durationInFrames = Math.ceil(videoSeconds * fps);

  return (
    <>
      <Composition
        id="TeaserVideo"
        component={TeaserVideo as any}
        durationInFrames={durationInFrames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [],
          productName: 'Teaser AI',
          tagline: 'Record your product effortlessly',
          productUrl: 'https://useteaser.com',
        } as TeaserVideoProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);
