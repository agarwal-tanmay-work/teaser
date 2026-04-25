import React from 'react';
import { Composition, getInputProps, registerRoot } from 'remotion';
import { TeaserVideo, TeaserVideoProps } from './TeaserVideo';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import type { SceneCapture } from '../types';

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 4;
const FPS = 30;

const DEFAULT_DEMO_SECONDS = 10;

interface RuntimeTeaserInputs {
  scenes?: SceneCapture[];
}

export const RemotionRoot: React.FC = () => {
  const runtime = getInputProps() as RuntimeTeaserInputs;

  // Duration = sum of kept-clip durations across scenes (0 falls back to a
  // placeholder demo window so Studio previews don't collapse to zero frames).
  let totalDemoFrames = 0;
  if (Array.isArray(runtime.scenes)) {
    for (const scene of runtime.scenes) {
      for (const clip of scene.clips ?? []) {
        totalDemoFrames += Math.round(((clip.end - clip.start) / 1000) * FPS);
      }
    }
  }

  const demoDuration = totalDemoFrames > 0 ? totalDemoFrames / FPS : DEFAULT_DEMO_SECONDS;
  const videoSeconds = INTRO_SECONDS + demoDuration + OUTRO_SECONDS;
  const teaserDurationInFrames = Math.ceil(videoSeconds * FPS);

  // These defaults are ONLY used when previewing this composition inside
  // Remotion Studio with no inputProps. Production renders override every
  // field via inputProps coming from the actual job/manifest.
  const defaultTeaserProps: TeaserVideoProps = {
    scenes: [],
    productName: 'Your Product',
    tagline: 'See it in action',
    productUrl: '',
  };

  return (
    <>
      <Composition
        id="TeaserVideo"
        component={TeaserVideo}
        durationInFrames={teaserDurationInFrames}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={defaultTeaserProps}
      />
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={INTRO_SECONDS * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ productName: 'Product', tagline: 'See what it can do' }}
      />
      <Composition
        id="Outro"
        component={Outro}
        durationInFrames={OUTRO_SECONDS * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ productName: 'Your Product', productUrl: '' }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
