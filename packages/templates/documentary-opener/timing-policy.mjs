import { VIDEO_SPEC } from "../../video-spec.mjs";

export const DOCUMENTARY_OPENER_TIMING_POLICY = Object.freeze({
  durationInFrames: Math.round(10.5 * VIDEO_SPEC.fps),
  maxReadableUnits: 20,
  montageFrames: Math.round(3 * VIDEO_SPEC.fps),
  exitFrames: Math.round(2.3 * VIDEO_SPEC.fps),
  blackHoldFrames: Math.round(.5 * VIDEO_SPEC.fps)
});
