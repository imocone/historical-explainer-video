import { EFFECT_TYPES, EFFECT_INTENSITIES, FOREGROUND_FILES } from "./policy.mjs";

export const effectCueTargetsForRequest = (request) => (request.effects ?? []).flatMap((effect, index) =>
  effect.timing === "cue" ? [{ target: `${request.requestId}.effect.${index}`, action: "show-effect" }] : []);

export const effectAnchorTargetsForRequest = (request) => (request.effects ?? []).flatMap((effect, index) =>
  ["emotion", "soft-light"].includes(effect.type) ? [{ index, anchorFocus: effect.anchorFocus }] : []);

export const assertEffectAnchors = ({ request, anchors = {}, required = false, label = request.requestId }) => {
  if (!anchors || typeof anchors !== "object" || Array.isArray(anchors)) throw new Error(`${label} effectAnchors必须是对象`);
  for (const [index, anchor] of Object.entries(anchors)) {
    if (!/^(0|[1-9][0-9]*)$/u.test(index) || !anchor || typeof anchor !== "object"
      || Object.keys(anchor).some((key) => !["x", "y", "anchorFocus"].includes(key))
      || typeof anchor.anchorFocus !== "string" || !anchor.anchorFocus.trim()
      || ![anchor.x, anchor.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
      throw new Error(`${label} 效果锚点${index}必须注明目标及源图归一化x/y`);
  }
  if (required) for (const { index, anchorFocus } of effectAnchorTargetsForRequest(request)) {
    if (anchors[index]?.anchorFocus !== anchorFocus)
      throw new Error(`${label} 效果${index}缺少匹配“${anchorFocus}”的实图锚点，回当前P3作者据实图校准`);
  }
  return anchors;
};

export const effectDesignErrors = (request) => {
  const errors = [];
  for (const [index, effect] of (request.effects ?? []).entries()) {
    const label = `${request.requestId} 效果${index}`;
    if (!EFFECT_TYPES.includes(effect.type) || !EFFECT_INTENSITIES.includes(effect.intensity)
      || !["scene", "cue"].includes(effect.timing) || !effect.reason?.trim()) errors.push(`${label}缺少效果、强度、时序或选择理由`);
    if (effect.timing === "cue" && (!Number.isInteger(effect.durationMs) || effect.durationMs < 500 || effect.durationMs > 8000))
      errors.push(`${label}的Cue动作须给出500至8000毫秒的时长`);
    if (effect.type === "emotion" && (effect.timing !== "cue" || !effect.anchorFocus?.trim()
      || !["focus", "question"].includes(effect.symbol)
      || effect.durationMs < 800 || effect.durationMs > 2400)) errors.push(`${label}须选择人物、表情和800至2400毫秒的Cue反应`);
    if (effect.type === "foreground" && !FOREGROUND_FILES[effect.preset]) errors.push(`${label}缺少已登记的透明前景`);
    if (effect.type === "soft-light" && (!["top-left", "top-right"].includes(effect.source) || !effect.anchorFocus?.trim()))
      errors.push(`${label}须按场景选择光源方向与实图目标`);
  }
  return errors;
};

export const prepareEffectsForFrame = ({ request, asset, actionTimings, visibleStartFrame, visibleEndFrame, sceneEndFrame = visibleEndFrame,
  cameraFrameOffset = 0, fps, allowPendingAnchors = false }) => {
  const errors = effectDesignErrors(request);
  if (errors.length) throw new Error(errors.join("；"));
  const anchors = assertEffectAnchors({ request, anchors: asset.effectAnchors ?? {}, required: !allowPendingAnchors });
  const pendingAnchors = [];
  const effects = (request.effects ?? []).flatMap((effect, index) => {
    let startFrame = visibleStartFrame;
    let endFrame = sceneEndFrame + 1;
    if (effect.timing === "cue") {
      const target = `${request.requestId}.effect.${index}`;
      const timing = actionTimings.find((item) => item.target === target && item.action === "show-effect");
      if (!Number.isInteger(timing?.frame)) throw new Error(`${target}缺少真实Cue动作时刻`);
      startFrame = timing.frame;
      endFrame = startFrame + Math.ceil(effect.durationMs * fps / 1000);
      if (startFrame < visibleStartFrame || endFrame > visibleEndFrame + 1)
        throw new Error(`${target}动作超出所属画面的可见时窗，回P3调整Cue或时长`);
    }
    const anchored = ["emotion", "soft-light"].includes(effect.type);
    if (anchored && anchors[index]?.anchorFocus !== effect.anchorFocus) {
      pendingAnchors.push({ index, anchorFocus: effect.anchorFocus });
      return [];
    }
    return [{ ...effect, index, seed: `${request.requestId}/${index}/${effect.type}`,
      startFrame: startFrame + cameraFrameOffset, endFrame: endFrame + cameraFrameOffset,
      ...(anchored ? { anchor: anchors[index] } : {}),
      ...(effect.type === "foreground" ? { file: FOREGROUND_FILES[effect.preset] } : {}) }];
  });
  return { effects, pendingAnchors };
};

export const effectOpacityAtFrame = ({ effect, frame, fps }) => {
  // The image's A/B or cross-Beat transition already owns scene visibility,
  // including visible preroll and exit tails. Do not fade that image twice.
  if (effect.timing === "scene") return 1;
  if (frame < effect.startFrame || frame >= effect.endFrame) return 0;
  const fade = Math.max(1, Math.round(fps * 0.16));
  return Math.max(0, Math.min(1, (frame - effect.startFrame) / fade, (effect.endFrame - frame) / fade));
};

// A point follows the source image's existing camera; symbol size remains in screen space.
export const projectedEffectAnchor = ({ anchor, camera }) => ({
  x: camera.left + anchor.x * camera.scale,
  y: camera.top + anchor.y * camera.scale
});

export const effectSampleFrame = ({ index, localFrame, runtimeTiming }) => localFrame
  + (index === 0 ? runtimeTiming?.visualFrameOffset ?? 0 : runtimeTiming?.semanticFrameOffset ?? 0);
