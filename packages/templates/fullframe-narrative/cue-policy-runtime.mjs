import { FULLFRAME_RENDER_POLICY } from "./render-policy.mjs";
import {
  assertActionTimingStructureForTreatment,
  fullframeCueTargetsForTreatment,
  fullframeFrameWindows,
  fullframeTransitionCapacityFor,
  fullframeTransitionLimitsFor,
  maximumBoundaryFramesFor,
  resolveFrameTransitionTimings
} from "./timing-runtime.mjs";
import {
  deriveMotionCameras,
  motionTravelBudgetForWindow
} from "./camera/index.mjs";

export const cueSyncTargetsForTreatment = fullframeCueTargetsForTreatment;

export const validateCueBindingsForTreatment = ({
  treatment,
  bindings,
  firstCue
}) => {
  const errors = [];
  const firstRequest = treatment.assetRequests?.[0];
  if (!firstRequest || !firstCue) return ["全画幅A缺少Beat首字幕边界"];
  const frameBindings = (bindings ?? []).filter((binding) => ["start-frame-motion", "dissolve-in"].includes(binding.action));
  if (frameBindings.some((binding, index) => binding.target !== treatment.assetRequests[index]?.requestId)) {
    errors.push("全画幅画面卡点必须保持已设计的A/B顺序；解说框按各自字幕独立触发");
  }
  const firstBinding = (bindings ?? []).find((binding) => (
    binding.target === firstRequest.requestId
    && binding.action === "start-frame-motion"
  ));
  if (firstBinding && (String(firstBinding.cueId) !== String(firstCue.id) || firstBinding.edge !== "start")) {
    errors.push(`全画幅A必须绑定Beat首字幕${firstCue.id}.start`);
  }
  for (const request of treatment.assetRequests ?? []) {
    for (const [calloutIndex] of (request.callouts ?? []).entries()) {
      const target = `${request.requestId}.callout.${calloutIndex}`;
      const binding = (bindings ?? []).find((item) => item.target === target && item.action === "show-callout");
      if (binding && binding.edge !== "start") {
        errors.push(`${request.requestId} 解说框${calloutIndex + 1}必须绑定真实字幕起点`);
      }
    }
  }
  return errors;
};

const motionBudgetForWindow = ({ frameId, window, maximumEndFrame, speedRatio,
  motion = { speedRatio }, fps, label }) => {
  const { startFrame, endFrame, runtimeEndFrame, cameraFrameOffset } = window.motion;
  const budgetAt = (frame, purpose) => motionTravelBudgetForWindow({
    startFrame,
    runtimeEndFrame: frame,
    fps,
    motionPolicy: FULLFRAME_RENDER_POLICY.motion,
    speedRatio,
    motion,
    label: `${label}/${frameId} ${purpose}`
  });
  const visible = budgetAt(endFrame, "正文可见行程");
  const actual = budgetAt(runtimeEndFrame, "真实接镜行程");
  const maximum = budgetAt(maximumEndFrame, "最大预留行程");
  return {
    frameId,
    speedRatio,
    startFrame,
    visibleEndFrame: endFrame,
    cameraPrerollFrames: cameraFrameOffset,
    exitTailFrames: runtimeEndFrame - endFrame,
    readableStartFrame: window.readableStartFrame,
    readableEndFrame: window.readableEndFrame,
    runtimeEndFrame,
    runtimeDurationMs: actual.elapsedSeconds * 1000,
    runtimeCameraTravel: actual.requiredTravel,
    maximumZoomScaleTravel: actual.maximumZoomScaleTravel,
    maximumRuntimeEndFrame: maximumEndFrame,
    visibleDurationMs: visible.elapsedSeconds * 1000,
    readableDurationMs: (window.readableEndFrame - window.readableStartFrame) * 1000 / fps,
    maximumBoundaryReserveMs: Math.round((maximumEndFrame - window.visibleEndFrame) * 1000 / fps),
    maximumRuntimeDurationMs: Math.round(maximum.elapsedSeconds * 1000),
    visibleCameraTravel: visible.requiredTravel,
    maximumRuntimeCameraTravel: maximum.requiredTravel
  };
};

export const fullframeMotionBudgetForCueOption = ({
  durationInFrames,
  switchFrame = null,
  transitionDesign = null,
  runtimeTiming = null,
  speedRatios = null,
  motions = null,
  fps,
  label = "全画幅作者运镜预算"
}) => {
  if (!Number.isInteger(durationInFrames) || durationInFrames < 2) {
    throw new Error(`${label} 缺少合法Beat时长`);
  }
  let transitions = [];
  if (switchFrame !== null) {
    if (transitionDesign === null) {
      const capacity = fullframeTransitionCapacityFor({ durationInFrames, switchFrame, fps, label });
      if (!capacity) throw new Error(`${label} 当前字幕切点没有可满足最低阅读时窗的转场时长`);
      // This planning reference never becomes an authored transition.
      transitionDesign = {
        type: "dissolve",
        durationMs: capacity.maximumDurationMs,
        reason: "当前切点最大可行窗口预算，非正式转场选择"
      };
    }
    transitions = resolveFrameTransitionTimings({
      durationInFrames,
      switchTimings: [{ action: "dissolve-in", frame: switchFrame }],
      designs: [transitionDesign],
      fps,
      limits: fullframeTransitionLimitsFor({ fps, label }),
      label
    });
  }
  const maximumBoundaryFrames = maximumBoundaryFramesFor({ fps, label });
  const windows = fullframeFrameWindows({ durationInFrames, transitions, runtimeTiming,
    maximumBoundaryFrames, fps, label });
  // Known Cue gaps belong to the real tail, even beyond the effect reserve.
  const maximumExitFrames = Math.max(maximumBoundaryFrames, runtimeTiming?.exitTailFrames ?? 0);
  return windows.map((window, index) => motionBudgetForWindow({
    frameId: index === 0 ? "A" : "B",
    window,
    maximumEndFrame: transitions[index]
      ? transitions[index].endFrame + maximumBoundaryFrames
      : durationInFrames - 1 + maximumExitFrames + (index === 0 ? maximumBoundaryFrames : 0),
    speedRatio: speedRatios === null ? FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio : speedRatios[index],
    motion: motions?.[index],
    fps,
    label
  }));
};

export const assertActionTimingsForTreatment = ({
  treatment,
  actionTimings,
  durationInFrames,
  fps,
  label = "全画幅"
}) => {
  const requests = treatment.assetRequests ?? [];
  const { windows } = assertActionTimingStructureForTreatment({
    treatment,
    actionTimings,
    durationInFrames,
    fps,
    label
  });
  for (const [index, request] of requests.entries()) {
    deriveMotionCameras({
      motion: { ...request.motion, ...windows[index].motion },
      fps,
      motionPolicy: FULLFRAME_RENDER_POLICY.motion,
      label: `${label}/${request.requestId} Beat内路线预检`
    });
  }
  return actionTimings;
};

export const defaultActionTimingsForTreatment = () => {
  throw new Error("正文全画幅每张画面都必须使用 cue-sync 绑定真实字幕边界，不允许默认时间");
};
