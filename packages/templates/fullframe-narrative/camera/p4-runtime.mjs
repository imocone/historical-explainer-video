import {
  FullframeCameraDesignError,
  FULLFRAME_VIEWPORT_POLICY,
  cameraForViewport,
  cameraPositionAtDistance,
  coverageRectForViewports,
  motionRouteViewports,
  validateMotionGeometry,
  viewportForCamera
} from "./geometry.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { FULLFRAME_RENDER_POLICY, fullframeSpeedSecondsAt } from "../render-policy.mjs";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const epsilon = 1e-9;
const motionFamily = (type) => type === "traverse" ? "traverse" : "zoom";
const designError = (failureClass, message) => new FullframeCameraDesignError(failureClass, message);

const motionCameraPathFor = ({ motion, label = "全画幅相机路线" }) => {
  validateMotionGeometry({ motion, label });
  const viewports = motionRouteViewports(motion);
  const cameras = viewports.map(cameraForViewport);
  const segmentLengths = cameras.slice(1).map((camera, index) => motion.type === "traverse"
    ? Math.hypot(
        camera.left - cameras[index].left,
        camera.top - cameras[index].top
      )
    : Math.abs(camera.scale - cameras[index].scale));
  if (segmentLengths.some((length) => !Number.isFinite(length) || length <= epsilon)) {
    throw designError("route-definition", `${label} 的P3路线包含不可执行分段`);
  }
  const attentionTargetPointIndex = 1 + motion.routeWaypoints.length;
  const attentionTargetTravelDistance = segmentLengths
    .slice(0, attentionTargetPointIndex)
    .reduce((sum, length) => sum + length, 0);
  const routeLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  return {
    viewports,
    cameras,
    segmentLengths,
    attentionTargetTravelDistance,
    routeLength
  };
};

export const inspectFullframeDesigns = ({ items }) => {
  if (!Array.isArray(items) || items.length < 1) {
    throw new Error("全画幅路线测量需要至少一项设计");
  }
  return items.map((item, index) => {
    const id = item?.id ?? `item-${index + 1}`;
    try {
      const plan = motionCameraPathFor({ motion: item?.motion, label: id });
      const family = motionFamily(item.motion.type);
      const visibleCameraTravel = item?.budget?.visibleCameraTravel?.[family];
      const runtimeCameraTravel = item?.budget?.runtimeCameraTravel?.[family];
      const maximumRuntimeCameraTravel = item?.budget?.maximumRuntimeCameraTravel?.[family];
      if (!Number.isFinite(visibleCameraTravel) || !Number.isFinite(runtimeCameraTravel) || !Number.isFinite(maximumRuntimeCameraTravel)) {
        throw designError("window-contract", `${id} 缺少 ${family} 路线预算`);
      }
      if (runtimeCameraTravel > plan.routeLength + epsilon) {
        throw designError("window-contract", `${id} 路线会在真实接镜运动窗口结束前耗尽`);
      }
      const semanticEndTravel = plan.attentionTargetTravelDistance;
      const maximumScale = Math.max(...plan.cameras.map((camera) => camera.scale));
      if (visibleCameraTravel <= 0) {
        throw new Error(`${id}缺少可执行的正文可见行程`);
      }
      const visible = positionAtDistance({ plan, distance: visibleCameraTravel });
      return {
        id,
        ok: true,
        family,
        speedRatio: item.motion.speedRatio,
        ...(item.motion.speedChanges ? { speedChanges: item.motion.speedChanges } : {}),
        semanticEndTravel,
        visibleCameraTravel,
        runtimeCameraTravel,
        runtimeDurationMs: item.budget.runtimeDurationMs,
        routeLength: plan.routeLength,
        maximumRuntimeCameraTravel,
        visibleDurationMs: item.budget.visibleDurationMs,
        visibleEndViewport: visible.viewport,
        visibleRouteViewports: visible.actualRouteViewports,
        remainingVisibleRouteDistance: Math.max(0, plan.routeLength - visibleCameraTravel),
        maximumScale
      };
    } catch (error) {
      return {
        id,
        ok: false,
        failureClass: error?.failureClass ?? "route-contract",
        error: error.message
      };
    }
  });
};

const positionAtDistance = ({ plan, distance }) => {
  const { camera, segmentIndex } = cameraPositionAtDistance({
    cameras: plan.cameras,
    segmentLengths: plan.segmentLengths,
    distance: clamp(distance, 0, plan.routeLength)
  });
  const actualRouteViewports = [
    ...plan.viewports.slice(0, segmentIndex + 1),
    viewportForCamera(camera)
  ];
  return { camera, viewport: actualRouteViewports.at(-1), actualRouteViewports };
};

export const motionRouteViewportsAtFrames = ({
  motion,
  motionStartFrame,
  frames,
  fps,
  motionPolicy,
  label = "全画幅同帧交接"
}) => {
  if (!Number.isInteger(motionStartFrame)
    || !Array.isArray(frames)
    || frames.length < 2
    || frames.some((frame) => !Number.isInteger(frame) || frame < motionStartFrame)) {
    throw new Error(`${label} 缺少连续可执行帧`);
  }
  const family = motionFamily(motion?.type);
  const speed = family === "traverse"
    ? motionPolicy.traverseNormalizedSpeedPerSecond
    : motionPolicy.zoomScaleSpeedPerSecond;
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(speed) || speed <= 0) {
    throw new Error(`${label} 缺少运动族基准速度`);
  }
  const plan = motionCameraPathFor({ motion, label });
  return frames.map((frame) => positionAtDistance({
    plan,
    distance: speed * fullframeSpeedSecondsAt({ motion,
      elapsedSeconds: (frame - motionStartFrame) / fps, policy: motionPolicy })
  }).viewport);
};

export const motionTravelBudgetForWindow = ({
  startFrame,
  runtimeEndFrame,
  fps,
  motionPolicy,
  speedRatio,
  motion = { speedRatio },
  label = "全画幅运镜预算"
}) => {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`${label} fps 必须为正数`);
  if (!Number.isInteger(startFrame)) throw new Error(`${label} 缺少运镜起始帧`);
  if (!Number.isInteger(runtimeEndFrame) || runtimeEndFrame <= startFrame) {
    throw new Error(`${label} 缺少包含真实转场时窗的运镜结束帧`);
  }
  const traverseSpeed = motionPolicy.traverseNormalizedSpeedPerSecond;
  const zoomSpeed = motionPolicy.zoomScaleSpeedPerSecond;
  if (!Number.isFinite(traverseSpeed) || traverseSpeed <= 0
    || !Number.isFinite(zoomSpeed) || zoomSpeed <= 0) {
    throw new Error(`${label} 缺少运动族基准速度`);
  }
  const elapsedSeconds = (runtimeEndFrame - startFrame) / fps;
  const speedSeconds = fullframeSpeedSecondsAt({ motion, elapsedSeconds, policy: motionPolicy });
  return {
    elapsedSeconds,
    maximumZoomScaleTravel: FULLFRAME_VIEWPORT_POLICY.maximumRenderScale - 1,
    requiredTravel: {
      traverse: traverseSpeed * speedSeconds,
      zoom: zoomSpeed * speedSeconds
    }
  };
};

export const deriveMotionCameras = ({
  motion,
  fps,
  motionPolicy,
  label = "P4 全画幅运镜"
}) => {
  validateMotionGeometry({ motion, label });
  if (!Number.isInteger(motion?.endFrame) || motion.endFrame <= motion.startFrame) {
    throw new Error(`${label} 缺少正文可见运镜结束帧`);
  }
  const visibleBudget = motionTravelBudgetForWindow({
    startFrame: motion.startFrame,
    runtimeEndFrame: motion.endFrame,
    fps,
    motionPolicy,
    speedRatio: motion.speedRatio,
    motion,
    label: `${label} 正文可见行程`
  });
  const runtimeBudget = motionTravelBudgetForWindow({
    startFrame: motion?.startFrame,
    runtimeEndFrame: motion?.runtimeEndFrame,
    fps,
    motionPolicy,
    speedRatio: motion.speedRatio,
    motion,
    label
  });
  const plan = motionCameraPathFor({ motion, label });
  const startCamera = plan.cameras[0];
  const visibleTravelDistance = motion.type === "traverse"
    ? visibleBudget.requiredTravel.traverse
    : visibleBudget.requiredTravel.zoom;
  const travelDistance = motion.type === "traverse"
    ? runtimeBudget.requiredTravel.traverse
    : runtimeBudget.requiredTravel.zoom;
  if (Math.max(visibleTravelDistance, travelDistance) > plan.routeLength + epsilon) {
    throw designError("window-contract", `${label} 路线会在真实可见窗口结束前耗尽；当前取景需修正以覆盖原时窗`);
  }
  const visible = positionAtDistance({ plan, distance: visibleTravelDistance });
  const actual = positionAtDistance({ plan, distance: travelDistance });
  const endCamera = actual.camera;
  validateMotionGeometry({
    motion: {
      ...motion,
      startCamera,
      endCamera,
      cameraPath: {
        cameras: plan.cameras,
        segmentLengths: plan.segmentLengths,
        travelDistance
      }
    },
    label
  });
  const actualEndViewport = actual.viewport;
  const actualRouteViewports = actual.actualRouteViewports;
  const actualSafeRect = coverageRectForViewports(actualRouteViewports);
  return {
    fps,
    startCamera,
    endCamera,
    cameraPath: {
      cameras: plan.cameras,
      segmentLengths: plan.segmentLengths,
      travelDistance
    },
    attentionTargetTravelDistance: plan.attentionTargetTravelDistance,
    visibleTravelDistance,
    visibleEndViewport: visible.viewport,
    visibleRouteViewports: visible.actualRouteViewports,
    travelDistance,
    routeLength: plan.routeLength,
    runtimeRouteShortfallDistance: Math.max(0, plan.routeLength - travelDistance),
    actualEndViewport,
    actualRouteViewports,
    actualSafeRect
  };
};

export const motionProgressAtFrame = ({ motion, frame, label = "P4 全画幅运镜" }) => {
  if (!Number.isInteger(frame)) throw new Error(`${label} 当前帧必须是整数`);
  if (!Number.isInteger(motion?.startFrame)) throw new Error(`${label} 缺少运镜起始帧`);
  if (!Number.isInteger(motion?.runtimeEndFrame) || motion.runtimeEndFrame <= motion.startFrame) {
    throw new Error(`${label} 缺少已解析的真实运镜结束帧`);
  }
  const fps = motion.fps ?? VIDEO_SPEC.fps;
  const total = fullframeSpeedSecondsAt({ motion,
    elapsedSeconds: (motion.runtimeEndFrame - motion.startFrame) / fps });
  return fullframeSpeedSecondsAt({ motion,
    elapsedSeconds: clamp(frame - motion.startFrame, 0, motion.runtimeEndFrame - motion.startFrame) / fps }) / total;
};

export const motionSpeedRatioAtFrame = ({ motion, motionStartFrame = motion.startFrame, frame, fps = VIDEO_SPEC.fps }) => {
  const at = elapsedSeconds => fullframeSpeedSecondsAt({ motion, elapsedSeconds });
  const seconds = (frame - motionStartFrame) / fps;
  return Math.max(FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio, (at(seconds + 1 / fps) - at(seconds)) * fps);
};
