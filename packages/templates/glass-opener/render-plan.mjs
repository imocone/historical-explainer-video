import { VIDEO_SPEC } from "../../video-spec.mjs";
import { defaultActionTimingsForTreatment, renderData as defaultOpenerRenderData } from "../opposed-opener/render-plan.mjs";
import { GLASS_POLICY, openerTimelineForTreatment } from "./render-policy.mjs";

export { defaultActionTimingsForTreatment };
export const createRenderPolicy = () => GLASS_POLICY;
export const durationMs = ({treatment}) =>
  Math.ceil(openerTimelineForTreatment(treatment).durationFrames / VIDEO_SPEC.fps * 1000);

export const assertActionTimingsForTreatment = ({treatment,actionTimings,durationInFrames}) => {
  if (durationInFrames !== openerTimelineForTreatment(treatment).durationFrames
    || JSON.stringify(actionTimings) !== JSON.stringify(defaultActionTimingsForTreatment({treatment})))
    throw new Error("玻璃片头动作与实际配音卡点不一致");
  return actionTimings;
};

export const renderData = options => ({
  ...defaultOpenerRenderData(options),
  openerTimeline:openerTimelineForTreatment(options.treatment),
  exitTransition:GLASS_POLICY.exitTransition,
  resourceFiles:["packages/templates/glass-opener/assets/window-glass-normal.png",
    "packages/templates/glass-opener/assets/window-glass-pbr.jpg",
    "packages/templates/glass-opener/assets/glass-cracks.png",
    "packages/templates/glass-opener/assets/glass-edge.png"]
});
