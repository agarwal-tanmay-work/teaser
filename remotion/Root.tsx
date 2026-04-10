import { Composition, getInputProps, registerRoot } from 'remotion';
import { TeaserVideo, TeaserVideoProps } from './TeaserVideo';
import React from 'react';

const INTRO_SECONDS = 3;
const OUTRO_SECONDS = 3;

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as any;
  // videoLength is in seconds (30/60/90). Add intro+outro time and convert to frames at 30fps
  const videoSeconds = (inputProps.videoLength || 60) + INTRO_SECONDS + OUTRO_SECONDS;
  const durationInFrames = videoSeconds * 30;

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
          rawVideoUrl: '',
          clickEvents: [],
          productName: 'Teaser AI',
          tagline: 'Record your product effortlessly',
        } as TeaserVideoProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);
