import React from "react";
import { Composition } from "remotion";
import { LAUNCH_DURATION, Launch } from "./Launch";
import { loadFonts } from "./fonts";
import { FPS, HEIGHT, WIDTH } from "./theme";

loadFonts();

export const RemotionRoot: React.FC = () => (
  <Composition id="SiyulahLaunch" component={Launch} durationInFrames={LAUNCH_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
