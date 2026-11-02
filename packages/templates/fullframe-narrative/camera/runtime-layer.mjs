import { narrativeVisibility } from "../../../modules/render-video/runtime/narrative-transition.mjs";
import { cameraGeometryAtProgress } from "./geometry.mjs";
import { motionProgressAtFrame } from "./p4-runtime.mjs";

export const cameraAtFrame = ({ motion, frame }) => {
  if (!Number.isInteger(motion?.startFrame)
    || !Number.isInteger(motion?.runtimeEndFrame)
    || motion.runtimeEndFrame <= motion.startFrame
    || !motion.startCamera || !motion.endCamera) {
    throw new Error("P4 全画幅运镜缺少合法确定帧区间");
  }
  return cameraGeometryAtProgress({ motion, progress: motionProgressAtFrame({
    motion, frame, label: "P4 全画幅运镜"
  }) });
};

export const cameraStateAtRuntimeFrame = ({ frames, transitions, localFrame, runtimeTiming, label }) => {
  if (!Array.isArray(frames) || frames.length < 1) throw new Error(`${label} 缺少全画幅画面`);
  if (!Array.isArray(transitions) || transitions.length !== frames.length - 1) {
    throw new Error(`${label} 相邻转场数量必须比画面数量少一`);
  }
  for (const [index, transition] of transitions.entries()) {
    if (!Number.isInteger(transition?.startFrame) || !Number.isInteger(transition.endFrame)
      || transition.endFrame - transition.startFrame !== transition.design?.durationInFrames
      || (index > 0 && transitions[index - 1].endFrame > transition.startFrame)) {
      throw new Error(`${label} 第${index + 1}个相邻转场计划无效`);
    }
  }
  const visualFrame = localFrame + (runtimeTiming?.visualFrameOffset ?? 0);
  const semanticFrame = localFrame + (runtimeTiming?.semanticFrameOffset ?? 0);
  const layer = (index, visibleWeight) => ({ index, opacity: visibleWeight, visibleWeight,
    camera: cameraAtFrame({ motion: frames[index].motion, frame: index === 0 ? visualFrame : semanticFrame }) });
  const index = transitions.findIndex((transition) => semanticFrame >= transition.startFrame && semanticFrame < transition.endFrame);
  if (index === -1) return { layers: [layer(transitions.filter(({ endFrame }) => semanticFrame >= endFrame).length, 1)] };
  const transition = transitions[index];
  const visibility = narrativeVisibility({ ...transition.design, frame: semanticFrame - transition.startFrame });
  return {
    transition: { ...transition, localStartFrame: transition.startFrame - (runtimeTiming?.semanticFrameOffset ?? 0) },
    layers: [layer(index, visibility.outgoing), layer(index + 1, visibility.incoming)]
  };
};
