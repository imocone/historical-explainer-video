import { resolveCueBindingsToFrames, resolveCueBoundary, resolveCueRange } from "../../cue-boundaries.mjs";
import { frameSpanForMs, VIDEO_SPEC } from "../../video-spec.mjs";

export function validate({ result, context }) {
  const errors = [];
  const cues = context.cues ?? [];
  const unitId = context.authorUnit?.id ?? context.beat?.id ?? "当前创作单位";
  const range = context.authorUnit?.cueRange ?? context.beat?.cueRange;
  const allowed = context.allowedTargets
    ?? context.templatePolicy?.cueSyncTargetsForTreatment?.(context.treatment)
    ?? [];
  const allowedSet = new Set(allowed.map((item) => `${item.target}\u0000${item.action}`));
  if (allowed.length === 0) errors.push(`${unitId} 缺少模板提供的合法卡点目标`);
  let allowedCueIds = null;
  let rangeCues = [];
  try {
    ({ cues: rangeCues } = resolveCueRange({ cueRange: range, cues }));
    allowedCueIds = new Set(rangeCues.map((cue) => String(cue.id)));
  } catch (error) {
    errors.push(`${unitId} 缺少合法 cueRange: ${error.message}`);
  }
  const seen = new Set();
  let previousTimeMs = -1;
  for (const binding of result.items ?? []) {
    const key = `${binding.target}\u0000${binding.action}`;
    if (seen.has(key)) errors.push(`${unitId} 卡点目标与动作重复: ${binding.target}/${binding.action}`);
    seen.add(key);
    if (allowedSet.size && !allowedSet.has(key)) errors.push(`${unitId} 使用模板未声明的卡点动作: ${binding.target}/${binding.action}`);
    if (allowedCueIds && !allowedCueIds.has(String(binding.cueId))) {
      errors.push(`${unitId} 卡点 cue 超出当前创作单位: ${binding.cueId}`);
    }
    try {
      const { timeMs } = resolveCueBoundary({ cueId: binding.cueId, edge: binding.edge, cues });
      if (timeMs < previousTimeMs) errors.push(`${unitId} 卡点顺序与字幕时间冲突`);
      previousTimeMs = timeMs;
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const item of allowed) {
    const key = `${item.target}\u0000${item.action}`;
    if (!seen.has(key)) errors.push(`${unitId} 缺少模板要求的卡点动作: ${item.target}/${item.action}`);
  }
  const validateBindings = context.templatePolicy?.validateCueBindingsForTreatment;
  if (typeof validateBindings === "function") {
    errors.push(...validateBindings({
      treatment: context.treatment,
      bindings: result.items ?? [],
      firstCue: rangeCues[0] ?? null,
      cues: rangeCues,
      templateContext: context.templateContext ?? null
    }));
  }
  return errors;
}

export async function validateRuntime({ result, context }) {
  const cues = context.cues ?? [];
  const segmentStartMs = cues[0]?.startMs;
  const segmentEndMs = cues.at(-1)?.endMs;
  if (!Number.isInteger(segmentStartMs) || !Number.isInteger(segmentEndMs) || segmentEndMs <= segmentStartMs) {
    return ["cue-sync 当前创作单位字幕边界无效"];
  }
  const actionTimings = resolveCueBindingsToFrames({
    bindingSet: result,
    cues,
    segmentStartMs,
    segmentEndMs,
    fps: VIDEO_SPEC.fps
  });
  const assertTimings = context.templatePolicy?.assertActionTimingsForTreatment;
  if (typeof assertTimings !== "function") return ["cue-sync 缺少模板动作预算接口"];
  try {
    assertTimings({
      treatment: context.treatment,
      actionTimings,
      durationInFrames: frameSpanForMs({ startMs: segmentStartMs, endMs: segmentEndMs, fps: VIDEO_SPEC.fps }),
      fps: VIDEO_SPEC.fps,
      label: `${context.authorUnit?.id ?? context.beat?.id ?? "当前创作单位"} cue-sync`
    });
    return [];
  } catch (error) {
    return [error.message];
  }
}

const scopeId = (scope) => scope.authorUnitId ?? scope.unitId ?? scope.beatId;

export const readResult = ({ storyboard, scope }) => storyboard.features?.[scope.featureId]?.bindings?.[scopeId(scope)] ?? null;

export const projectResult = ({ storyboard, scope, result, producer }) => {
  const feature = storyboard.features[scope.featureId];
  if (!feature || typeof feature !== "object") throw new Error(`${scope.featureId} 未在 P3 正文功能中启用`);
  feature.bindings ??= {};
  feature.bindings[scopeId(scope)] = { ...result, _producer: producer };
  return storyboard;
};

export const clearResult = ({ storyboard, scope }) => {
  const bindings = storyboard.features?.[scope.featureId]?.bindings;
  if (bindings) delete bindings[scopeId(scope)];
  return storyboard;
};
