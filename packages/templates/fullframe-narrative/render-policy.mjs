import { CALLOUT_RENDER_POLICY, prepareCalloutRenderPolicy } from "./callout/render-policy.mjs";
import { VIDEO_SPEC, durationFramesForMs } from "../../video-spec.mjs";
export const FULLFRAME_RENDER_POLICY = Object.freeze({
  motion: Object.freeze({
    traverseNormalizedSpeedPerSecond: 0.01883673792,
    zoomScaleSpeedPerSecond: 0.0313945632,
    minimumSpeedRatio: 1,
    maximumBoundaryTravelMs: 1200
  }),
  transition: Object.freeze({
    maximumDurationMs: 1800,
    minimumAReadableMs: 3200,
    minimumBReadableMs: 1500
  }),
  callout: CALLOUT_RENDER_POLICY
});

// The constants above are the 100% reference, not a default authored speed.
export const fullframeMotionPolicyForRatio = (speedRatio, policy = FULLFRAME_RENDER_POLICY.motion) => {
  if (!Number.isFinite(speedRatio)
    || speedRatio < policy.minimumSpeedRatio) {
    throw new Error(`全画幅运动速度必须不低于 ${policy.minimumSpeedRatio}，由联合设计选择`);
  }
  return {
    ...policy,
    traverseNormalizedSpeedPerSecond: policy.traverseNormalizedSpeedPerSecond * speedRatio,
    zoomScaleSpeedPerSecond: policy.zoomScaleSpeedPerSecond * speedRatio
  };
};

const speedPointsFor = (motion, policy) => {
  fullframeMotionPolicyForRatio(motion?.speedRatio, policy);
  const changes = motion.speedChanges === undefined ? [] : motion.speedChanges;
  if (!Array.isArray(changes) || (motion.speedChanges !== undefined && changes.length === 0)) {
    throw new Error("全画幅 speedChanges 必须为非空有序数组");
  }
  const points = [{ timeMs: 0, speedRatio: motion.speedRatio }];
  for (const change of changes) {
    if (!Number.isInteger(change?.timeMs) || change.timeMs <= points.at(-1).timeMs) {
      throw new Error("全画幅速度变化点必须按正整数 timeMs 严格递增");
    }
    fullframeMotionPolicyForRatio(change.speedRatio, policy);
    points.push(change);
  }
  if (motion.holdAfterMs !== undefined) {
    throw new Error("全画幅运镜必须持续运动，不支持 holdAfterMs；行程不足须调整构图、取景与路线");
  }
  return points;
};

// Integrate the authored speed on the image's one motion clock. Visibility,
// hidden preroll and exit tails only select times on it; they never retime it.
export const fullframeSpeedSecondsAt = ({
  motion, elapsedSeconds, policy = FULLFRAME_RENDER_POLICY.motion
}) => {
  if (!Number.isFinite(elapsedSeconds)) throw new Error("全画幅运动时间必须为有限数值");
  const points = speedPointsFor(motion, policy);
  const until = Math.max(0, elapsedSeconds);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index];
    const start = from.timeMs / 1000, end = to.timeMs / 1000;
    const seconds = Math.max(0, Math.min(until, end) - start);
    travelled += from.speedRatio * seconds
      + (to.speedRatio - from.speedRatio) * seconds * seconds / (2 * (end - start));
    if (until <= end) return travelled;
  }
  return travelled + points.at(-1).speedRatio * Math.max(0, until - points.at(-1).timeMs / 1000);
};

const assertPositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} 必须为正整数`);
};

const assertPositiveNumber = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须为正数`);
};

export const validateFullframeRenderPolicy = ({ visualStyle, fps, width, height }) => {
  const policy = FULLFRAME_RENDER_POLICY;
  const motion = policy.motion;
  for (const key of [
    "traverseNormalizedSpeedPerSecond",
    "zoomScaleSpeedPerSecond",
    "maximumBoundaryTravelMs"
  ]) {
    assertPositiveNumber(motion?.[key], `P4 全画幅 motion.${key}`);
  }
  const transition = policy.transition;
  for (const key of ["maximumDurationMs", "minimumAReadableMs", "minimumBReadableMs"]) {
    assertPositiveInteger(transition?.[key], `P4 全画幅 transition.${key}`);
  }
  const callout = prepareCalloutRenderPolicy({ callout: policy.callout, visualStyle, fps });
  const subtitleSafeAreaHeight = VIDEO_SPEC.subtitle.safeAreaHeight;
  const safeMarginX = VIDEO_SPEC.safeMarginX;
  const safeMarginY = VIDEO_SPEC.safeMarginY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("P4 全画幅画布尺寸无效");
  }
  if (width !== VIDEO_SPEC.width || height !== VIDEO_SPEC.height || fps !== VIDEO_SPEC.fps) {
    throw new Error("P4 全画幅输出规格与系统视频规格不一致");
  }
  if (subtitleSafeAreaHeight + callout.subtitleGap >= height) {
    throw new Error("P4 全画幅字幕安全区没有为解说文字保留画面空间");
  }
  return {
    motion: { ...motion },
    transition: {
      ...transition,
      minimumAReadableFrames: durationFramesForMs({ milliseconds: transition.minimumAReadableMs, fps }),
      minimumBReadableFrames: durationFramesForMs({ milliseconds: transition.minimumBReadableMs, fps })
    },
    callout,
    subtitleSafeAreaHeight,
    safeMarginX,
    safeMarginY,
    fps,
    width,
    height
  };
};
