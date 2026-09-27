import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { ArabicFirst, Collections, Connect, Fix, Forecast, InApp, Intro, Launch as SoftLaunch, Meet, Problem, Trust } from "./scenes";
import { C, FONT } from "./theme";

const T = 18; // transition length in frames

const SCENES: { id: string; frames: number; Comp: React.FC; enter: "fade" | "slide" }[] = [
  { id: "intro", frames: 150, Comp: Intro, enter: "fade" },
  { id: "problem", frames: 270, Comp: Problem, enter: "fade" },
  { id: "meet", frames: 130, Comp: Meet, enter: "fade" },
  { id: "connect", frames: 210, Comp: Connect, enter: "slide" },
  { id: "forecast", frames: 330, Comp: Forecast, enter: "slide" },
  { id: "in-app", frames: 150, Comp: InApp, enter: "fade" },
  { id: "fix", frames: 300, Comp: Fix, enter: "slide" },
  { id: "collections", frames: 280, Comp: Collections, enter: "slide" },
  { id: "arabic", frames: 230, Comp: ArabicFirst, enter: "fade" },
  { id: "trust", frames: 170, Comp: Trust, enter: "fade" },
  { id: "launch", frames: 240, Comp: SoftLaunch, enter: "fade" },
];

export const LAUNCH_DURATION = SCENES.reduce((s, x) => s + x.frames, 0) - T * (SCENES.length - 1);

export const Launch: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.dark, fontFamily: FONT }}>
      <TransitionSeries>
        {SCENES.map(({ id, frames, Comp, enter }, i) => (
          <React.Fragment key={id}>
            {i > 0 && (
              <TransitionSeries.Transition
                presentation={enter === "slide" ? slide({ direction: "from-right" }) : fade()}
                timing={linearTiming({ durationInFrames: T })}
              />
            )}
            <TransitionSeries.Sequence durationInFrames={frames}>
              <Comp />
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}
      </TransitionSeries>
      <Audio
        src={staticFile("music.wav")}
        volume={(f) =>
          interpolate(f, [0, 30, durationInFrames - 75, durationInFrames - 1], [0, 0.85, 0.85, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
    </AbsoluteFill>
  );
};
