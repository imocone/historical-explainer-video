export const templateRenderPlanLoaders = {
  "cinematic-video": () => import("../../../templates/cinematic-video/render-plan.mjs"),
  "crossfire-opener": () => import("../../../templates/crossfire-opener/render-plan.mjs"),
  "documentary-opener": () => import("../../../templates/documentary-opener/render-plan.mjs"),
  "episode-opener": () => import("../../../templates/episode-opener/render-plan.mjs"),
  "fullframe-narrative": () => import("../../../templates/fullframe-narrative/render-plan.mjs"),
  "glass-opener": () => import("../../../templates/glass-opener/render-plan.mjs"),
  "opposed-opener": () => import("../../../templates/opposed-opener/render-plan.mjs"),
  "vox-explainer": () => import("../../../templates/vox-explainer/render-plan.mjs")
};
