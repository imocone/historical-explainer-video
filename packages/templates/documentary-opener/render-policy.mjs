import { VIDEO_SPEC } from "../../video-spec.mjs";
import { DOCUMENTARY_OPENER_TIMING_POLICY as TIMING } from "./timing-policy.mjs";

export const DOCUMENTARY_OPENER_RENDER_POLICY = Object.freeze({
  shotStarts: Object.freeze([0, .6, 1.2, 1.8, 2.4, 3].map((seconds) => Math.round(seconds * VIDEO_SPEC.fps))),
  bookStartFrame: Math.round(3.4 * VIDEO_SPEC.fps),
  bookReadyFrame: Math.round(4.5 * VIDEO_SPEC.fps),
  sourceExitStartFrame: Math.round(4.95 * VIDEO_SPEC.fps),
  sourceExitEndFrame: Math.round(5.45 * VIDEO_SPEC.fps),
  titleStartFrame: Math.round(5.35 * VIDEO_SPEC.fps),
  titleReadyFrame: Math.round(6.1 * VIDEO_SPEC.fps),
  exitTransition: Object.freeze({ type: "dip-to-black", durationInFrames: TIMING.exitFrames })
});

export const documentaryOpenerTimelineForTreatment = (treatment) => {
  if (treatment?.memoryShots?.length !== 5 || !treatment.hero) throw new Error("纪录片回忆片头需要五张正文图和一张宽景");
  if (treatment.narration !== undefined) throw new Error("纪录片回忆片头不得携带旁白或TTS证据");
  const blackStartFrame = TIMING.durationInFrames - TIMING.exitFrames;
  const incomingStartFrame = blackStartFrame + Math.ceil(TIMING.exitFrames / 2);
  return {
    shotCuts: [...DOCUMENTARY_OPENER_RENDER_POLICY.shotStarts, TIMING.durationInFrames],
    durationFrames: TIMING.durationInFrames,
    blackStartFrame,
    blackFrame: incomingStartFrame - TIMING.blackHoldFrames,
    incomingStartFrame
  };
};
