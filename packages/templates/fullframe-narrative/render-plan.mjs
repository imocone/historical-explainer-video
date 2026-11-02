import { assertFullframeFramePolicy } from "./capacity-policy.mjs";
import {
  deriveMotionCameras,
  validateMotionFraming,
  validateRuntimeSafeRange
} from "./camera/index.mjs";
import { validateFullframeRenderPolicy } from "./render-policy.mjs";
import { fullframeTransitionsForTreatment, fullframeFrameWindows } from "./timing-runtime.mjs";
import { resolveCalloutLifecycleTiming } from "./callout/timing.mjs";
import { assertCalloutGateForRender, prepareCalloutsForFrame, createCalloutOverlays } from "./callout/render-plan.mjs";
export { placeCalloutOverlays } from "./callout/render-plan.mjs";
import { prepareEffectsForFrame } from "./effects/runtime.mjs";
import {
  assertActionTimingsForTreatment,
  defaultActionTimingsForTreatment
} from "./cue-policy.mjs";

const validateFraming = ({ segmentId, asset, motion }) => {
  const framing = asset.framing;
  return validateMotionFraming({
    motion,
    framing,
    label: `${segmentId}/${asset.requestId} P3→P4 全画幅路线`
  });
};

const timingFor = ({ actionTimings, target, action, label }) => {
  const timing = actionTimings.find((item) => item.target === target && item.action === action);
  if (!Number.isInteger(timing?.frame)) throw new Error(`${label} 缺少 ${target}/${action} 动作时刻`);
  return timing;
};

export const createRenderPolicy = validateFullframeRenderPolicy;

export { assertActionTimingsForTreatment, defaultActionTimingsForTreatment };

export const renderData = ({
  segmentId,
  treatment,
  actionTimings,
  assetRefs,
  targetDurationMs,
  durationInFrames,
  policy,
  runtimeTiming = null,
  allowPendingEffectAnchors = false
}) => {
  assertCalloutGateForRender({ treatment, segmentId });
  const requests = new Map((treatment.assetRequests ?? []).map((request) => [request.requestId, request]));
  const frameSources = assetRefs.filter((asset) => asset.kind === "fullframe-image");
  const fullframe = frameSources.map((asset, index) => {
    const request = requests.get(asset.requestId);
    if (!request?.motion?.type) throw new Error(`${segmentId}/${asset.requestId} 缺少逐图 motion`);
    if (request.motion.type === "hold" || request.motion.holdAfterMs !== undefined) {
      throw new Error(`${segmentId}/${asset.requestId} 正文全画幅必须持续运动，不支持 hold / holdAfterMs`);
    }
    const framing = validateFraming({ segmentId, asset, motion: request.motion });
    const actionTiming = timingFor({
      actionTimings,
      target: asset.requestId,
      action: index === 0 ? "start-frame-motion" : "dissolve-in",
      label: `${segmentId}/${asset.requestId}`
    });
    const callouts = prepareCalloutsForFrame({ request, segmentId, actionTimings, policy });
    const motion = {
      type: request.motion.type,
      speedRatio: request.motion.speedRatio,
      ...(request.motion.speedChanges ? { speedChanges: structuredClone(request.motion.speedChanges) } : {}),
      startViewport: framing.startViewport,
      routeWaypoints: framing.routeWaypoints,
      semanticEndViewport: framing.semanticEndViewport,
      safeEndViewport: framing.safeEndViewport,
      routeCoverageRect: framing.routeCoverageRect,
      source: framing.source,
      actionTiming
    };
    return {
      requestId: asset.requestId,
      motion,
      callouts
    };
  });
  if (fullframe.length !== assetRefs.length) throw new Error(`${segmentId} 全画幅模板含有非全画幅素材`);
  if (fullframe.length < 1) throw new Error(`${segmentId} 全画幅缺少素材`);
  if (fullframe.length !== requests.size) throw new Error(`${segmentId} 全画幅素材数量与画面设计不一致`);
  const frameIds = (treatment.assetRequests ?? []).map((request) => request.frameId);
  assertFullframeFramePolicy({ targetDurationMs, frameIds, label: `${segmentId} 全画幅` });
  const { firstMotion, transitions: frameTransitions } = fullframeTransitionsForTreatment({
    treatment, actionTimings, durationInFrames, fps: policy.fps, label: `${segmentId} 全画幅`
  });
  if (frameTransitions.length && fullframe[0].motion.actionTiming.frame >= frameTransitions[0].startFrame) {
    throw new Error(`${segmentId} 第一张画面运镜不得晚于第二张画面切换`);
  }
  const windows = fullframeFrameWindows({
    durationInFrames,
    firstMotionFrame: firstMotion.frame,
    transitions: frameTransitions,
    runtimeTiming,
    fps: policy.fps,
    label: `${segmentId} 全画幅`
  });
  for (const [index, item] of fullframe.entries()) {
    const window = windows[index];
    item.motion = { ...item.motion, ...window.motion };
    item.callouts = item.callouts.map((callout, calloutIndex) => ({
      ...callout,
      ...resolveCalloutLifecycleTiming({
        cueFrame: callout.actionTiming.frame,
        visibleStartFrame: window.visibleStartFrame,
        calloutPolicy: callout,
        label: `${segmentId}/${item.requestId} 解说框${calloutIndex + 1}`
      })
    }));
    const runtimeCameras = deriveMotionCameras({
      motion: item.motion,
      fps: policy.fps,
      motionPolicy: policy.motion,
      label: `${segmentId}/${item.requestId}`
    });
    validateRuntimeSafeRange({
      actualEndViewport: runtimeCameras.actualEndViewport,
      actualRouteViewports: runtimeCameras.actualRouteViewports,
      actualSafeRect: runtimeCameras.actualSafeRect,
      routeCoverageRect: item.motion.routeCoverageRect,
      label: `${segmentId}/${item.requestId} P4实际安全范围`
    });
    item.motion = {
      ...item.motion,
      ...runtimeCameras
    };
    const prepared = prepareEffectsForFrame({ request: requests.get(item.requestId), asset: frameSources[index],
      actionTimings, visibleStartFrame: window.visibleStartFrame,
      visibleEndFrame: window.visibleEndFrame, sceneEndFrame: item.motion.runtimeEndFrame - item.motion.cameraFrameOffset,
      cameraFrameOffset: item.motion.cameraFrameOffset, fps: policy.fps,
      allowPendingAnchors: allowPendingEffectAnchors });
    item.effects = prepared.effects;
    item.pendingEffectAnchors = prepared.pendingAnchors;
  }
  const overlays = createCalloutOverlays({ fullframe, segmentId, policy });
  return {
    incomingTransition: treatment.incomingTransition ?? null,
    overlays,
    fullframe,
    frameTransitions,
    resourceFiles: [...new Set(fullframe.flatMap((item) => item.effects.filter((effect) => effect.file).map((effect) => effect.file)))]
  };
};
