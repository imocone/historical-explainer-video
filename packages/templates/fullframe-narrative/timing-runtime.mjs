import { calloutLifecyclePolicyFor, resolveCalloutLifecycleTiming } from "./callout/timing.mjs";
import { durationFramesForMs } from "../../video-spec.mjs";
import { FULLFRAME_RENDER_POLICY } from "./render-policy.mjs";
import { effectCueTargetsForRequest, prepareEffectsForFrame } from "./effects/runtime.mjs";
import { narrativeFirstVisibleFrame, narrativeLastVisibleFrame, resolveNarrativeTransition } from "../../modules/render-video/runtime/narrative-transition.mjs";

const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} 必须为正整数`);
};

const assertPositiveNumber = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须为正数`);
};

export const framesForMilliseconds = ({ milliseconds, fps, label }) => {
  assertPositiveNumber(milliseconds, label);
  assertPositiveNumber(fps, "P4 fps");
  return durationFramesForMs({ milliseconds, fps });
};

export const resolveFrameTransitionTimings = ({
  durationInFrames,
  switchTimings,
  designs,
  fps,
  limits,
  label = "全画幅"
}) => {
  assertPositiveInteger(durationInFrames, `${label} 时长`);
  if (!Array.isArray(switchTimings)) throw new Error(`${label} 相邻画面切换必须是数组`);
  for (const key of ["minimumAReadableFrames", "minimumBReadableFrames"]) {
    assertPositiveInteger(limits?.[key], `${label} transition.${key}`);
  }
  if (!Array.isArray(designs) || designs.length !== switchTimings.length) throw new Error(`${label} 每处画面边界必须有一份转场设计`);
  if (switchTimings.length === 0) return [];

  let previousEndFrame = 0;
  const transitions = switchTimings.map((switchTiming, index) => {
    if (!switchTiming || switchTiming.action !== "dissolve-in") {
      throw new Error(`${label} 第${index + 2}张画面必须由 action=dissolve-in 驱动`);
    }
    if (!Number.isInteger(switchTiming.frame)) {
      throw new Error(`${label} 第${index + 2}张画面缺少确定切换帧`);
    }
    if (!designs[index]) throw new Error(`${label} 第${index + 2}张画面缺少入场设计，不能自动补选`);
    const design = resolveNarrativeTransition(designs[index], fps);
    const startFrame = switchTiming.frame - Math.floor(design.durationInFrames / 2);
    const endFrame = startFrame + design.durationInFrames;
    if (startFrame - previousEndFrame < limits.minimumAReadableFrames) {
      throw new Error(`${label} 第${index + 1}张画面在下一次转场前留屏预算不足`);
    }
    if (endFrame >= durationInFrames) throw new Error(`${label} 第${index + 1}次转场无法在 Beat 内完成`);
    previousEndFrame = endFrame;
    return { cutFrame: switchTiming.frame, startFrame, endFrame, design };
  });

  const finalReadableFrames = durationInFrames - transitions.at(-1).endFrame;
  if (finalReadableFrames < limits.minimumBReadableFrames) {
    throw new Error(`${label} 最后一张画面在转场完成后留屏预算不足`);
  }
  return transitions;
};

const assertFullframeTransitionWindow = ({ transition, label }) => {
  if (!Number.isInteger(transition?.startFrame)
    || !Number.isInteger(transition?.endFrame)
    || transition.endFrame - transition.startFrame !== transition.design?.durationInFrames) {
    throw new Error(`${label} 缺少与设计一致的转场窗口`);
  }
};

const firstVisibleFrameForFullframeTransition = ({ transition, label = "全画幅转场" }) => {
  assertFullframeTransitionWindow({ transition, label });
  return transition.startFrame + narrativeFirstVisibleFrame(transition.design);
};

const lastVisibleFrameForFullframeTransition = ({ transition, label = "全画幅转场" }) => {
  assertFullframeTransitionWindow({ transition, label });
  return transition.startFrame + narrativeLastVisibleFrame(transition.design);
};

// With no shared visible frames, compare the actual outgoing landing and
// incoming entry. Each side still supplies two visible frames for direction.
export const fullframeCameraSampleFrames = (transition) => {
  const first = firstVisibleFrameForFullframeTransition({ transition });
  const last = lastVisibleFrameForFullframeTransition({ transition });
  const shared = last >= first + 1;
  return { previous: shared ? [first, first + 1] : [last - 1, last],
    current: [first, first + 1], previousHandoffIndex: shared ? 0 : 1 };
};

export const visibleEndFrameForFullframeRequest = ({
  outgoingTransition = null,
  durationInFrames,
  label = "全画幅画面"
}) => {
  assertPositiveInteger(durationInFrames, `${label} 时长`);
  if (!outgoingTransition) return durationInFrames - 1;
  const visibleEndFrame = lastVisibleFrameForFullframeTransition({
    transition: outgoingTransition,
    label: `${label} 出场`
  });
  return visibleEndFrame;
};

export const visibleStartFrameForFullframeRequest = ({
  incomingTransition = null,
  firstMotionFrame = null,
  label = "全画幅画面"
}) => {
  if (!incomingTransition) {
    if (!Number.isInteger(firstMotionFrame) || firstMotionFrame < 0) {
      throw new Error(`${label} 缺少合法首帧运镜起点`);
    }
    return firstMotionFrame;
  }
  return firstVisibleFrameForFullframeTransition({
    transition: incomingTransition,
    label: `${label} 入场`
  });
};

export const motionStartFrameForFullframeRequest = (options) => visibleStartFrameForFullframeRequest(options);

// Visibility uses Beat time; only A has cross-Beat preroll and only the last image has an exit tail.
export const fullframeFrameWindows = ({
  durationInFrames,
  transitions,
  firstMotionFrame = 0,
  runtimeTiming = null,
  fps,
  maximumBoundaryFrames = maximumBoundaryFramesFor({ fps, label: "全画幅" }),
  label = "全画幅"
}) => {
  assertPositiveInteger(durationInFrames, `${label} 时长`);
  const { cameraPrerollFrames = 0, exitTailFrames = 0 } = runtimeTiming ?? {};
  for (const [name, frames] of [["相机预进入", cameraPrerollFrames], ["退出尾帧", exitTailFrames]]) {
    if (!Number.isInteger(frames) || frames < 0) throw new Error(`${label} ${name}必须是非负整数`);
  }
  if (!Number.isInteger(maximumBoundaryFrames) || maximumBoundaryFrames < 0) {
    throw new Error(`${label} 跨片段运镜上限必须是非负整数`);
  }
  if (cameraPrerollFrames > maximumBoundaryFrames) throw new Error(`${label} 相机预进入超出全画幅跨片段运镜上限`);

  return Array.from({ length: transitions.length + 1 }, (_, index) => {
    const incomingTransition = transitions[index - 1] ?? null;
    const outgoingTransition = transitions[index] ?? null;
    const visibleStartFrame = visibleStartFrameForFullframeRequest({ incomingTransition, firstMotionFrame, label });
    const visibleEndFrame = visibleEndFrameForFullframeRequest({ outgoingTransition, durationInFrames, label });
    const cameraFrameOffset = index === 0 ? cameraPrerollFrames : 0;
    const startFrame = motionStartFrameForFullframeRequest({ incomingTransition, firstMotionFrame, fps, label });
    const endFrame = visibleEndFrame + cameraFrameOffset;
    // The outgoing tail includes the real Cue gap, which may exceed an effect handle.
    const runtimeEndFrame = endFrame + (outgoingTransition ? 0 : exitTailFrames);
    if (endFrame <= startFrame) throw new Error(`${label} 第${index + 1}张画面没有合法独立运镜时间窗`);
    return {
      visibleStartFrame,
      visibleEndFrame,
      readableStartFrame: incomingTransition?.endFrame ?? firstMotionFrame,
      readableEndFrame: outgoingTransition?.startFrame ?? durationInFrames,
      motion: { startFrame, endFrame, runtimeEndFrame, cameraFrameOffset }
    };
  });
};

export const fullframeCueTargetsForTreatment = (treatment) => (treatment.assetRequests ?? []).flatMap((request, index) => [
  {
    target: request.requestId,
    action: index === 0 ? "start-frame-motion" : "dissolve-in"
  },
  ...effectCueTargetsForRequest(request),
  ...(request.callouts ?? []).map((_, calloutIndex) => ({
    target: `${request.requestId}.callout.${calloutIndex}`,
    action: "show-callout"
  }))
]);

const timingFor = ({ byKey, target, action, label }) => {
  const timing = byKey.get(`${target}\u0000${action}`);
  if (!timing) throw new Error(`${label} 缺少 ${target}/${action} 动作时刻`);
  return timing;
};

export const fullframeTransitionLimitsFor = ({ fps, label }) => ({
  minimumAReadableFrames: framesForMilliseconds({
    milliseconds: FULLFRAME_RENDER_POLICY.transition.minimumAReadableMs,
    fps,
    label: `${label} 前一画面可读预算`
  }),
  minimumBReadableFrames: framesForMilliseconds({
    milliseconds: FULLFRAME_RENDER_POLICY.transition.minimumBReadableMs,
    fps,
    label: `${label} 最后一画面可读预算`
  })
});

// Capacity is a property of this cue boundary, not an authored effect choice.
// Keep any boundary with a feasible duration; the global maximum need not fit.
export const fullframeTransitionCapacityFor = ({ durationInFrames, switchFrame, fps, label = "全画幅" }) => {
  assertPositiveInteger(durationInFrames, `${label} 时长`);
  if (!Number.isInteger(switchFrame)) throw new Error(`${label} 缺少确定切换帧`);
  const limits = fullframeTransitionLimitsFor({ fps, label });
  const maximumDurationInFrames = Math.min(
    framesForMilliseconds({ milliseconds: FULLFRAME_RENDER_POLICY.transition.maximumDurationMs, fps, label }),
    // start = cut - floor(duration / 2); end = cut + ceil(duration / 2).
    2 * (switchFrame - limits.minimumAReadableFrames) + 1,
    2 * (durationInFrames - switchFrame - limits.minimumBReadableFrames)
  );
  if (maximumDurationInFrames < 2) return null;
  return { maximumDurationInFrames, maximumDurationMs: maximumDurationInFrames * 1000 / fps };
};

export const maximumBoundaryFramesFor = ({ fps, label }) => framesForMilliseconds({
  milliseconds: FULLFRAME_RENDER_POLICY.motion.maximumBoundaryTravelMs,
  fps,
  label: `${label} 跨片段运镜预留`
});

export const fullframeTransitionsForTreatment = ({
  treatment,
  actionTimings,
  durationInFrames,
  fps,
  label = "全画幅"
}) => {
  const byKey = new Map((actionTimings ?? []).map((timing) => [
    `${timing.target}\u0000${timing.action}`,
    timing
  ]));
  const requests = treatment.assetRequests ?? [];
  if (requests.length < 1) throw new Error(`${label} 缺少全画幅画面`);
  const firstMotion = timingFor({
    byKey,
    target: requests[0].requestId,
    action: "start-frame-motion",
    label
  });
  const transitions = resolveFrameTransitionTimings({
    durationInFrames,
    switchTimings: requests.slice(1).map((request) => timingFor({
      byKey,
      target: request.requestId,
      action: "dissolve-in",
      label
    })),
    designs: requests.slice(1).map((request) => request.incomingTransition),
    fps,
    limits: fullframeTransitionLimitsFor({ fps, label }),
    label
  });
  return { firstMotion, transitions };
};

const resolveCalloutLifecyclesForTreatment = ({ treatment, actionTimings, durationInFrames, fps, label }) => {
  const { firstMotion, transitions } = fullframeTransitionsForTreatment({
    treatment, actionTimings, durationInFrames, fps, label
  });
  const windows = fullframeFrameWindows({ durationInFrames, transitions,
    firstMotionFrame: firstMotion.frame, fps, label });
  const byKey = new Map(actionTimings.map(timing => [`${timing.target}\u0000${timing.action}`, timing]));
  const requests = treatment.assetRequests;
  const lifecycles = [];
  for (const [index, request] of requests.entries()) {
    const { visibleStartFrame } = windows[index];
    for (const [calloutIndex, callout] of (request.callouts ?? []).entries()) {
      const calloutTiming = timingFor({
        byKey,
        target: `${request.requestId}.callout.${calloutIndex}`,
        action: "show-callout",
        label
      });
      const calloutLabel = `${label}/${request.requestId} 解说框${calloutIndex + 1}`;
      const lifecycle = resolveCalloutLifecycleTiming({
        cueFrame: calloutTiming.frame,
        visibleStartFrame,
        calloutPolicy: calloutLifecyclePolicyFor({
          callout,
          policy: FULLFRAME_RENDER_POLICY.callout,
          fps,
          label: calloutLabel
        }),
        label: calloutLabel
      });
      lifecycles.push({
        ...lifecycle,
        label: calloutLabel,
        kind: callout.kind,
        callout,
        cueFrame: calloutTiming.frame,
        requestId: request.requestId,
        calloutIndex
      });
    }
  }
  return { firstMotion, transitions, windows, lifecycles };
};

export const assertActionTimingStructureForTreatment = ({
  treatment,
  actionTimings,
  durationInFrames,
  fps,
  label = "全画幅"
}) => {
  if (!Number.isInteger(durationInFrames) || durationInFrames < 2 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error(`${label} 缺少合法时长或 fps`);
  }
  const targets = fullframeCueTargetsForTreatment(treatment);
  if (!Array.isArray(actionTimings) || actionTimings.length !== targets.length) {
    throw new Error(`${label} 动作时刻数量必须与模板动作数量一致`);
  }
  const byKey = new Map();
  for (const timing of actionTimings) {
    const key = `${timing.target}\u0000${timing.action}`;
    if (byKey.has(key)) throw new Error(`${label} 动作时刻重复: ${timing.target}/${timing.action}`);
    if (!Number.isInteger(timing.frame) || timing.frame < 0 || timing.frame >= durationInFrames) {
      throw new Error(`${label} 动作帧超出 Beat: ${timing.target}/${timing.action}`);
    }
    byKey.set(key, timing);
  }
  for (const target of targets) timingFor({ byKey, ...target, label });

  const resolved = resolveCalloutLifecyclesForTreatment({
    treatment,
    actionTimings,
    durationInFrames,
    fps,
    label
  });
  const { firstMotion, transitions, windows } = resolved;
  if (firstMotion.frame !== 0) {
    throw new Error(`${label} A必须从Beat第0帧开始`);
  }
  if (transitions.length && firstMotion.frame >= transitions[0].startFrame) {
    throw new Error(`${label} 第一张画面的运镜不得晚于第二张画面切换`);
  }
  if (!transitions.length && firstMotion.frame >= durationInFrames - 1) {
    throw new Error(`${label} A 图没有独立运镜预算`);
  }

  for (const [index, request] of (treatment.assetRequests ?? []).entries()) {
    prepareEffectsForFrame({ request, asset: {}, actionTimings,
      visibleStartFrame: windows[index].visibleStartFrame,
      visibleEndFrame: windows[index].visibleEndFrame,
      fps, allowPendingAnchors: true });
  }
  return resolved;
};
