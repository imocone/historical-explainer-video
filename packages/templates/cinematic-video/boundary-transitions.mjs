import { bodySegmentDescriptorsFor } from "../../modules/render-video/runtime/body-segments.mjs";
import { isNarrativeMedia, resolveNarrativeTransition } from "../../modules/render-video/runtime/narrative-transition.mjs";

export const videoTransitionBoundaries = ({ storyboard, videoPlan, requireTreatment }) => {
  const segments = bodySegmentDescriptorsFor(storyboard, videoPlan, requireTreatment);
  return segments.slice(1).flatMap((next, index) => {
    const previous = segments[index];
    return isNarrativeMedia(previous) && isNarrativeMedia(next)
      && [previous.templateId, next.templateId].includes("cinematic-video")
      ? [{ previousId: previous.id, nextId: next.id }] : [];
  });
};

export const validateVideoTransitions = ({ storyboard, videoPlan, requireTreatment }) => {
  const targets = new Set(videoTransitionBoundaries({ storyboard, videoPlan, requireTreatment }).map((item) => item.nextId));
  const designs = videoPlan.incomingTransitions ?? {};
  const errors = [];
  for (const id of targets) {
    if (!Object.hasOwn(designs, id)) errors.push(`${id} 缺少视频接管后的实际入场转场设计`);
  }
  for (const [id, design] of Object.entries(designs)) {
    if (!targets.has(id)) errors.push(`${id} 不属于视频改变的实际正文接缝`);
    try { resolveNarrativeTransition(design); } catch (error) { errors.push(`${id}: ${error.message}`); }
  }
  return errors;
};
