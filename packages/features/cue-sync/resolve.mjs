import { resolveCueBoundary } from "../../cue-boundaries.mjs";
export { resolveCueBindingsToFrames as resolveCueSyncBindings } from "../../cue-boundaries.mjs";

export const orderCueSyncBindings = ({ result, allowedTargets, cues }) => {
  const key = (item) => `${item.target}\u0000${item.action}`;
  const order = new Map(allowedTargets.map((item, index) => [key(item), index]));
  const seen = new Set();
  for (const item of result.items ?? []) {
    if (!order.has(key(item))) throw new Error(`模板未声明卡点: ${item.target}/${item.action}`);
    if (seen.has(key(item))) throw new Error(`卡点重复: ${item.target}/${item.action}`);
    seen.add(key(item));
  }
  const timed = (result.items ?? []).map((item) => ({
    item,
    timeMs: resolveCueBoundary({ cueId: item.cueId, edge: item.edge, cues }).timeMs
  }));
  return { ...result, items: timed.sort((a, b) => (
    a.timeMs - b.timeMs || order.get(key(a.item)) - order.get(key(b.item))
  )).map(({ item }) => item) };
};
