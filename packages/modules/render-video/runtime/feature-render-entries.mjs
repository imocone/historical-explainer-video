export const featureRenderEntryLoaders = {
  "background-music": () => import("../../../features/background-music/render-entry.mjs"),
  "cue-sync": () => import("../../../features/cue-sync/render-entry.mjs"),
  "sound-effects": () => import("../../../features/sound-effects/render-entry.mjs")
};
