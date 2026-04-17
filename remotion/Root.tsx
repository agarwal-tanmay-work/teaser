import { Composition, getInputProps, registerRoot } from 'remotion';
import { TeaserVideo, TeaserVideoProps } from './TeaserVideo';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import React from 'react';

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as any;

  // Calculate TeaserVideo duration by summing all curated clips
  let totalDemoFrames = 0;
  if (inputProps.scenes) {
    for (const scene of inputProps.scenes) {
      if (scene.clips) {
        for (const clip of scene.clips) {
          totalDemoFrames += Math.round(((clip.end - clip.start) / 1000) * FPS);
        }
      }
    }
  }

  const demoDuration = totalDemoFrames > 0 ? (totalDemoFrames / FPS) : 10;
  const videoSeconds = INTRO_SECONDS + demoDuration + OUTRO_SECONDS;
  const teaserDurationInFrames = Math.ceil(videoSeconds * FPS);

  return (
    <>
      <Composition
        id="TeaserVideo"
        component={TeaserVideo as any}
        durationInFrames={teaserDurationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [],
          productName: 'Teaser AI',
          tagline: 'Record your product effortlessly',
          productUrl: 'https://useteaser.com',
        } as TeaserVideoProps}
      />
      <Composition
        id="Intro"
        component={Intro as any}
        durationInFrames={INTRO_SECONDS * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ productName: 'Product', tagline: 'See what it can do' }}
      />
      <Composition
        id="Outro"
        component={Outro as any}
        durationInFrames={OUTRO_SECONDS * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ productName: 'Product', productUrl: 'https://useteaser.com' }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
