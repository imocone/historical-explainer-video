import { resolveCueSyncBindings } from "./resolve.mjs";

export const contribute = ({ phase, featureData, segment, cues, fps }) => {
  if (phase !== "action-timings" || segment.segmentType !== "body") return null;
  const bindingSet = featureData.bindings?.[segment.id];
  if (!bindingSet) throw new Error(`${segment.id} 缺少已启用 cue-sync 的卡点结果`);
  return {
    actionTimings: resolveCueSyncBindings({
      bindingSet,
      cues,
      segmentStartMs: segment.localStartMs,
      segmentEndMs: segment.localEndMs,
      fps
    })
  };
};
