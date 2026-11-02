import { DOCUMENTARY_OPENER_RENDER_POLICY, documentaryOpenerTimelineForTreatment } from "./render-policy.mjs";
import { documentaryOpenerShots } from "./selection.mjs";
import { DOCUMENTARY_OPENER_AUDIO } from "./audio/sources.mjs";
export { bodyAssetReferencesForTreatment } from "./selection.mjs";

export const createRenderPolicy = () => DOCUMENTARY_OPENER_RENDER_POLICY;
export const defaultActionTimingsForTreatment = ({ treatment }) => {
  const timeline = documentaryOpenerTimelineForTreatment(treatment);
  return documentaryOpenerShots(treatment).map((shot, index) => ({ target: shot.id, action: `memory-${shot.id}`, frame: timeline.shotCuts[index] }));
};
export const assertActionTimingsForTreatment = ({ treatment, actionTimings, durationInFrames }) => {
  const timeline = documentaryOpenerTimelineForTreatment(treatment);
  if (durationInFrames !== timeline.durationFrames) throw new Error("纪录片回忆片头必须固定10.5秒");
  if (JSON.stringify(actionTimings) !== JSON.stringify(defaultActionTimingsForTreatment({ treatment }))) throw new Error("纪录片回忆画流动作必须使用模板时间线");
  return actionTimings;
};
export const durationMs = ({ treatment, fps }) => Math.ceil(documentaryOpenerTimelineForTreatment(treatment).durationFrames / fps * 1000);
export const renderData = ({ treatment, actionTimings }) => ({
  actionFrames: Object.fromEntries(actionTimings.map(({ action, frame }) => [action, frame])),
  openerTimeline: documentaryOpenerTimelineForTreatment(treatment),
  audioTracks: [{
    id: "documentary-memory-music", kind: "background-music", segmentType: "opener",
    startFrame: 0, endFrame: documentaryOpenerTimelineForTreatment(treatment).durationFrames,
    file: DOCUMENTARY_OPENER_AUDIO.file, sha256: DOCUMENTARY_OPENER_AUDIO.sha256,
    volume: 10 ** (-10 / 20), loop: false, fadeInFrames: 1,
    fadeOutFrames: DOCUMENTARY_OPENER_RENDER_POLICY.exitTransition.durationInFrames
  }],
  exitTransition: DOCUMENTARY_OPENER_RENDER_POLICY.exitTransition
});
