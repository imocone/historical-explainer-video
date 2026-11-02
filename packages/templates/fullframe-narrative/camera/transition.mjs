import { cameraForViewport, motionRouteViewports, viewportForCamera } from "./geometry.mjs";
import { cameraAtFrame, cameraStateAtRuntimeFrame } from "./runtime-layer.mjs";
import { motionSpeedRatioAtFrame } from "./p4-runtime.mjs";
import { fullframeCameraSampleFrames } from "../timing-runtime.mjs";
import { FULLFRAME_RENDER_POLICY, fullframeMotionPolicyForRatio } from "../render-policy.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { narrativeCameraSampleOffsets } from "../../../modules/render-video/runtime/narrative-transition.mjs";

const epsilon = 1e-9;
const familyFor = (type) => type === "traverse" ? "traverse" : "zoom";

const cameraDelta = (from, to) => ({
  scale: to.scale - from.scale,
  left: to.left - from.left,
  top: to.top - from.top
});

const nonZeroDelta = (delta) => Math.abs(delta.scale) > epsilon
  || Math.abs(delta.left) > epsilon
  || Math.abs(delta.top) > epsilon;

const firstMotionDelta = (viewports) => {
  const cameras = (viewports ?? []).map(cameraForViewport);
  for (let index = 1; index < cameras.length; index += 1) {
    const delta = cameraDelta(cameras[index - 1], cameras[index]);
    if (nonZeroDelta(delta)) return delta;
  }
  return null;
};

const motionDeltaMagnitude = ({ delta, family }) => family === "traverse"
  ? Math.hypot(delta.left, delta.top)
  : Math.abs(delta.scale);

const centerDelta = (viewports) => {
  if (!Array.isArray(viewports) || viewports.length < 2) return null;
  const [from, to] = viewports;
  return {
    x: (to.x + to.width / 2) - (from.x + from.width / 2),
    y: (to.y + to.height / 2) - (from.y + from.height / 2)
  };
};

const centerMagnitude = (delta) => delta ? Math.hypot(delta.x, delta.y) : 0;
const centerAlignment = (a, b) => (a.x * b.x + a.y * b.y) / (centerMagnitude(a) * centerMagnitude(b));

const fullframeEntryCompatibilityErrors = ({
  previousViewport,
  currentViewport,
  currentType,
  currentSpeedRatio,
  fps = VIDEO_SPEC.fps,
  motionPolicy = FULLFRAME_RENDER_POLICY.motion,
  label = "全画幅接镜"
}) => {
  if (!previousViewport || !currentViewport) return [`${label}缺少接镜取样所需的前后相机`];
  const previous = cameraForViewport(previousViewport);
  const current = cameraForViewport(currentViewport);
  const delta = cameraDelta(previous, current);
  const family = familyFor(currentType);
  const selectedPolicy = fullframeMotionPolicyForRatio(currentSpeedRatio, motionPolicy);
  if (family === "traverse") {
    const maximum = selectedPolicy.traverseNormalizedSpeedPerSecond / fps;
    if (Math.abs(delta.scale) > epsilon
      || Math.hypot(delta.left, delta.top) > maximum + epsilon) {
      return [`${label}入口跳变超过当前模板一帧traverse行程`];
    }
    return [];
  }
  const maximum = selectedPolicy.zoomScaleSpeedPerSecond / fps;
  const scaleDelta = Math.abs(delta.scale);
  if (scaleDelta > maximum + epsilon
    || Math.abs(delta.left) > scaleDelta + epsilon
    || Math.abs(delta.top) > scaleDelta + epsilon) {
    return [`${label}入口跳变不属于当前模板一帧zoom行程`];
  }
  return [];
};

export const fullframeCameraRelationErrors = ({
  relation,
  previousType,
  currentType,
  previousSpeedRatio,
  currentSpeedRatio,
  previousRouteViewports,
  currentRouteViewports,
  previousHandoffIndex = 0,
  fps = VIDEO_SPEC.fps,
  motionPolicy = FULLFRAME_RENDER_POLICY.motion,
  label = "全画幅接镜"
}) => {
  if (!new Set(["continue", "motivated-reverse"]).has(relation)) return [];
  const previousAtHandoff = previousRouteViewports?.[previousHandoffIndex];
  const currentFirst = currentRouteViewports?.[0];
  const errors = fullframeEntryCompatibilityErrors({
    previousViewport: previousAtHandoff,
    currentViewport: currentFirst,
    currentType,
    currentSpeedRatio,
    fps,
    motionPolicy,
    label
  });
  if (familyFor(previousType) !== familyFor(currentType)) {
    errors.push(`${label} ${relation}前后必须属于同一运动族`);
    return errors;
  }
  const previousDelta = firstMotionDelta(previousRouteViewports);
  const currentDelta = firstMotionDelta(currentRouteViewports);
  if (!previousDelta || !currentDelta) {
    errors.push(`${label} ${relation}缺少接镜所需的前后运动分段`);
    return errors;
  }
  const family = familyFor(currentType);
  const minimumEvidence = (ratio) => {
    const policy = fullframeMotionPolicyForRatio(ratio, motionPolicy);
    return (family === "traverse" ? policy.traverseNormalizedSpeedPerSecond : policy.zoomScaleSpeedPerSecond) / fps;
  };
  if (motionDeltaMagnitude({ delta: previousDelta, family }) < minimumEvidence(previousSpeedRatio) - epsilon
    || motionDeltaMagnitude({ delta: currentDelta, family }) < minimumEvidence(currentSpeedRatio) - epsilon) {
    errors.push(`${label} ${relation}取样方向证据不足一帧有效运动`);
    return errors;
  }
  if (family === "traverse") {
    const previousCenter = centerDelta(previousRouteViewports);
    const currentCenter = centerDelta(currentRouteViewports);
    const alignment = centerAlignment(previousCenter, currentCenter);
    if (relation === "continue" && !(alignment > epsilon)) {
      errors.push(`${label} continue取样中的实际平移方向没有延续`);
    }
    if (relation === "motivated-reverse" && !(alignment < -epsilon)) {
      errors.push(`${label} motivated-reverse取样中的实际平移方向没有反转`);
    }
  } else {
    const product = previousDelta.scale * currentDelta.scale;
    if (relation === "continue" && !(product > 0)) {
      errors.push(`${label} continue取样中的实际推拉方向没有延续`);
    }
    if (relation === "motivated-reverse" && !(product < 0)) {
      errors.push(`${label} motivated-reverse取样中的实际推拉方向没有反转`);
    }
    const previousCenter = centerDelta(previousRouteViewports);
    const currentCenter = centerDelta(currentRouteViewports);
    if (relation === "continue"
      && centerMagnitude(previousCenter) > epsilon
      && centerMagnitude(currentCenter) > epsilon
      && !(centerAlignment(previousCenter, currentCenter) > epsilon)) {
      errors.push(`${label} continue取样中的实际中心方向没有延续`);
    }
  }
  return errors;
};

// P3 owns the relation. Recheck only relations whose real image framing was calibrated.
export const assertRealizedCameraRelations = ({ segments, transitions, fps = VIDEO_SPEC.fps }) => {
  const calibrated = (segment, index) => {
    const frame = segment.renderData.fullframe[index];
    const request = segment.treatment.assetRequests.find((item) => item.requestId === frame.requestId);
    const original = motionRouteViewports(request.motion);
    return motionRouteViewports(frame.motion).some((viewport, i) => ["x", "y", "width", "height"]
      .some((key) => Math.abs(viewport[key] - original[i][key]) > epsilon));
  };
  const layerAt = (segment, index, globalFrame) => cameraStateAtRuntimeFrame({
    frames: segment.renderData.fullframe, transitions: segment.renderData.frameTransitions,
    localFrame: globalFrame - segment.startFrame,
    runtimeTiming: { semanticFrameOffset: 0, visualFrameOffset: segment.appliedCameraPrerollFrames ?? 0 },
    label: `${segment.id} 最终取景接镜`
  }).layers.find((layer) => layer.index === index && layer.visibleWeight > epsilon);
  const speedAt = (segment, index, localFrame) => motionSpeedRatioAtFrame({
    motion: segment.renderData.fullframe[index].motion, fps,
    frame: localFrame + (index === 0 ? segment.appliedCameraPrerollFrames ?? 0 : 0)
  });
  for (const [segmentIndex, current] of segments.entries()) {
    if (current.templateId !== "fullframe-narrative" || !current.renderData?.fullframe) continue;
    for (const [index, frame] of current.renderData.fullframe.entries()) {
      const relation = current.treatment.assetRequests.find((item) => item.requestId === frame.requestId)?.cameraRelation;
      if (!["continue", "motivated-reverse"].includes(relation)) continue;
      const previous = index ? current : segments[segmentIndex - 1];
      // A video replacement owns its filmed boundary; it has no image camera to calibrate here.
      if (previous?.templateId !== "fullframe-narrative" || !previous.renderData?.fullframe) continue;
      const previousIndex = index ? index - 1 : previous.renderData.fullframe.length - 1;
      if (!calibrated(current, index) && !calibrated(previous, previousIndex)) continue;
      const boundary = index ? current.renderData.frameTransitions[index - 1]
        : transitions.find((item) => item.previousId === previous.id && item.nextId === current.id);
      if (!boundary) throw new Error(`${current.id}/${frame.requestId} 缺少严格接镜时窗`);
      if (index) {
        const samples = fullframeCameraSampleFrames(boundary);
        const viewports = (imageIndex, frames) => frames.map((at) => viewportForCamera(cameraAtFrame({
          motion: current.renderData.fullframe[imageIndex].motion,
          frame: at + (imageIndex === 0 ? current.appliedCameraPrerollFrames ?? 0 : 0)
        })));
        const errors = fullframeCameraRelationErrors({ relation, fps,
          previousType: previous.renderData.fullframe[previousIndex].motion.type, currentType: frame.motion.type,
          previousSpeedRatio: speedAt(previous, previousIndex, samples.previous[0]),
          currentSpeedRatio: speedAt(current, index, samples.current[0]),
          previousRouteViewports: viewports(previousIndex, samples.previous),
          currentRouteViewports: viewports(index, samples.current), previousHandoffIndex: samples.previousHandoffIndex,
          label: `${current.id}/${frame.requestId} 最终取景 ${relation}` });
        if (errors.length) throw new Error(errors.join("；"));
        continue;
      }
      const pair = narrativeCameraSampleOffsets(current.incomingTransition ?? null, fps)
        .map((offset) => current.startFrame + offset);
      const previousPair = narrativeCameraSampleOffsets(current.incomingTransition ?? null, fps)
        .map((offset) => current.startFrame + offset);
      const errors = fullframeCameraRelationErrors({ relation, fps,
        previousType: previous.renderData.fullframe[previousIndex].motion.type, currentType: frame.motion.type,
        previousSpeedRatio: speedAt(previous, previousIndex, previousPair[0] - previous.startFrame),
        currentSpeedRatio: speedAt(current, index, pair[0] - current.startFrame),
        previousRouteViewports: previousPair.map((at) => viewportForCamera(layerAt(previous, previousIndex, at).camera)),
        currentRouteViewports: pair.map((at) => viewportForCamera(layerAt(current, index, at).camera)),
        previousHandoffIndex: 0,
        label: `${previous.id}->${current.id}/${frame.requestId} 最终取景 ${relation}` });
      if (errors.length) throw new Error(errors.join("；"));
    }
  }
};
