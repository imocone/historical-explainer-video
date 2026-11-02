import { OPENER_RENDER_POLICY, openerTimelineForTreatment } from "./render-policy.mjs";
import { openerAudioTracksForTreatment } from "./audio-policy.mjs";

export const createRenderPolicy = () => OPENER_RENDER_POLICY;

export const defaultActionTimingsForTreatment = ({ treatment }) => {
  const timeline = openerTimelineForTreatment(treatment);
  const flashbacks = [
    OPENER_RENDER_POLICY.actions.flashbackOne,
    OPENER_RENDER_POLICY.actions.flashbackTwo,
    OPENER_RENDER_POLICY.actions.flashbackThree
  ].map(({ id, target }, index) => ({ target, action: id, frame: timeline.flashbackCuts[index] }));
  return flashbacks;
};

export const assertActionTimingsForTreatment = ({ treatment, actionTimings, durationInFrames }) => {
  const timeline = openerTimelineForTreatment(treatment);
  if (durationInFrames !== timeline.durationFrames) {
    throw new Error(`片头必须按真实句级卡点派生为 ${timeline.durationFrames} 帧`);
  }
  const expected = defaultActionTimingsForTreatment({ treatment });
  if (JSON.stringify(actionTimings) !== JSON.stringify(expected)) {
    throw new Error("片头动作必须逐项使用真实句级卡点");
  }
  return actionTimings;
};

export const durationMs = ({ treatment, fps }) => Math.ceil(openerTimelineForTreatment(treatment).durationFrames / fps * 1000);

export const renderData = ({ treatment, actionTimings }) => ({
  actionFrames: Object.fromEntries(actionTimings.map(({ action, frame }) => [action, frame])),
  openerTimeline: openerTimelineForTreatment(treatment),
  audioTracks: openerAudioTracksForTreatment({ treatment }),
  exitTransition: OPENER_RENDER_POLICY.exitTransition
});
