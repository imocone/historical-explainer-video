import { CROSS_FIRE } from "./render-policy.mjs";
import { AUDIO } from "./audio/sources.mjs";
export const createRenderPolicy = () => CROSS_FIRE;
export const durationMs = () => 8000;
export const defaultActionTimingsForTreatment = ({ fps }) => CROSS_FIRE.cuts.map((seconds, i) => ({ target: `O0${i+1}`, action: `crossfire-${i+1}`, frame: Math.round(seconds * fps) }));
export const assertActionTimingsForTreatment = ({ actionTimings, durationInFrames, fps }) => {
  if (durationInFrames !== 8 * fps || JSON.stringify(actionTimings) !== JSON.stringify(defaultActionTimingsForTreatment({ fps }))) throw new Error("交叉对冲必须保留8秒固定动作时钟");
  return actionTimings;
};
export const renderData = ({ fps }) => {
  const track = (id, name, start, end, volume, source = 0) => ({
    id, kind: "sound-effect", segmentType: "opener", file: AUDIO[name].file, sha256: AUDIO[name].sha256,
    startFrame: Math.round(start * fps), endFrame: Math.round(end * fps), sourceStartFrame: Math.round(source * fps), volume, loop: false
  });
  return { exitTransition: CROSS_FIRE.exitTransition, audioTracks: [
    { id: "crossfire-music", kind: "background-music", segmentType: "opener", ...AUDIO.music,
      startFrame: 0, endFrame: 8 * fps, volume: 1, loop: false, fadeInFrames: Math.round(8 / 60 * fps), fadeOutFrames: Math.round(58 / 60 * fps) },
    track("crossfire-cut-one", "cut", 1.66, 2.10, .24), track("crossfire-cut-two", "cut", 3.59, 4.03, .25),
    track("crossfire-arrival", "lock", 5.57, 6.53, .20), track("crossfire-release", "release", 6.25, 7.57, .27),
    track("crossfire-land", "lock", 7.16, 7.64, .22, .33)
  ] };
};
