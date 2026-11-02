import { VIDEO_SPEC } from "../../video-spec.mjs";
import { AUDIO } from "./audio/sources.mjs";
import { OPPOSED_POLICY, openerTimelineForTreatment } from "./render-policy.mjs";

export const createRenderPolicy = () => OPPOSED_POLICY;
export const durationMs = ({treatment}) =>
  Math.ceil(openerTimelineForTreatment(treatment).durationFrames / VIDEO_SPEC.fps * 1000);

export const defaultActionTimingsForTreatment = ({treatment}) => {
  const timeline = openerTimelineForTreatment(treatment);
  return treatment.flashbackShots.map((shot, i) => ({target:shot.id, action:"opposed-arrival", frame:timeline.cuts[i]}));
};

export const assertActionTimingsForTreatment = ({treatment, actionTimings, durationInFrames}) => {
  const timeline = openerTimelineForTreatment(treatment);
  if (durationInFrames !== timeline.durationFrames
    || JSON.stringify(actionTimings) !== JSON.stringify(defaultActionTimingsForTreatment({treatment})))
    throw new Error("逐段片头动作与实际配音卡点不一致");
  return actionTimings;
};

const effect = (id, asset, startFrame, endFrame, volume, extra = {}) => ({
  id, kind:"sound-effect", segmentType:"opener", file:asset.file, sha256:asset.sha256,
  startFrame, endFrame, volume, loop:false, ...extra
});

export const renderData = ({treatment}) => {
  const timeline = openerTimelineForTreatment(treatment);
  const {cuts, releaseFrame, durationFrames} = timeline;
  if (durationFrames > AUDIO.music.durationFrames) throw new Error("片头配乐母版短于实际片头");
  const audioTracks = cuts.flatMap((start, i) => [
    effect(`opposed-rush-top-${i+1}`, AUDIO.rushOne, start, Math.min(start+20, durationFrames), .8),
    effect(`opposed-rush-bottom-${i+1}`, AUDIO.rushTwo, start+3, Math.min(start+27, durationFrames), .7)
  ]);
  audioTracks.push(
    effect("opposed-release-gear", AUDIO.gear, Math.max(0, releaseFrame-4),
      Math.min(releaseFrame-4+AUDIO.gear.durationFrames, durationFrames), .60),
    effect("opposed-release-air", AUDIO.releaseAir, releaseFrame,
      Math.min(releaseFrame+AUDIO.releaseAir.durationFrames, durationFrames), .35, {fadeOutFrames:6}),
    {id:"opposed-music", kind:"background-music", segmentType:"opener",
      file:AUDIO.music.file, sha256:AUDIO.music.sha256, startFrame:0, endFrame:durationFrames,
      volume:1, loop:false, fadeInFrames:6, fadeOutFrames:15}
  );
  return {openerTimeline:timeline, audioTracks, exitTransition:OPPOSED_POLICY.exitTransition};
};
