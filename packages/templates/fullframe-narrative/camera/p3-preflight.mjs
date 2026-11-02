import { deriveMotionCameras } from "./p4-runtime.mjs";
import { assertActionTimingStructureForTreatment, fullframeFrameWindows } from "../timing-runtime.mjs";

// The integration layer resolves membership and cross-template transitions.
// Camera consumes only the resulting fullframe segments and their time windows.
export const fullframeRuntimePlansForSegments = ({ segments, fps, motionPolicy, maximumBoundaryFrames }) => {
  if (!Array.isArray(segments)) throw new Error("全画幅路线终审必须提供标准化片段数组");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("全画幅路线终审缺少合法fps");
  if (!Number.isInteger(maximumBoundaryFrames) || maximumBoundaryFrames < 0) {
    throw new Error("全画幅跨片段运镜上限必须是非负整数");
  }
  return segments.map(segment => {
    const label = segment?.id ?? "unknown";
    for (const key of ["cameraPrerollFrames", "exitTailFrames"]) {
      if (!Number.isInteger(segment?.[key])) throw new Error(`${label} 缺少标准化 ${key}`);
    }
    const { firstMotion, transitions } = assertActionTimingStructureForTreatment({
      treatment: segment.treatment,
      actionTimings: segment.actionTimings,
      durationInFrames: segment.durationInFrames,
      fps,
      label
    });
    const windows = fullframeFrameWindows({
      durationInFrames: segment.durationInFrames,
      firstMotionFrame: firstMotion.frame,
      transitions,
      runtimeTiming: segment,
      maximumBoundaryFrames,
      fps,
      label
    });
    const frames = segment.treatment.assetRequests.map((request, index) => {
      const motion = { ...request.motion, ...windows[index].motion };
      const runtime = deriveMotionCameras({ motion, fps, motionPolicy,
        label: `${label}/${request.requestId} P3整集路线终审` });
      return {
        target: `${label}/${request.frameId}`,
        beatId: label,
        frameId: request.frameId,
        requestId: request.requestId,
        type: request.motion.type,
        motion: { ...motion, ...runtime },
        runtime
      };
    });
    return { id: label, durationInFrames: segment.durationInFrames, frames, transitions };
  });
};
