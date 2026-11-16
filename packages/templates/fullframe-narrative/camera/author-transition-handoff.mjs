import { CROSS_FIRE } from "../../crossfire-opener/render-policy.mjs";
import { OPPOSED_POLICY } from "../../opposed-opener/render-policy.mjs";
import { GLASS_POLICY } from "../../glass-opener/render-policy.mjs";
import { resolveCueBindingsToFrames, resolveCueRange } from "../../../cue-boundaries.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import {
  DOCUMENTARY_OPENER_RENDER_POLICY
} from "../../documentary-opener/render-policy.mjs";
import {
  OPENER_RENDER_POLICY
} from "../../episode-opener/render-policy.mjs";
import {
  bodyRuntimeTimingForAuthorUnits,
  incomingCameraPrerollFrames,
  incomingVisualFrameOffset,
  openerEntranceLeadFramesFor,
  preEnteredSegmentTiming
} from "../../../modules/render-video/runtime/transitions.mjs";
import { narrativeHandleFrames } from "../../../modules/render-video/runtime/narrative-transition.mjs";
import { FULLFRAME_RENDER_POLICY } from "../render-policy.mjs";
import { framesForMilliseconds } from "../timing-runtime.mjs";
import { viewportForCamera } from "./geometry.mjs";
import { fullframeRuntimePlansForSegments } from "./p3-preflight.mjs";
import { cameraStateAtRuntimeFrame } from "./runtime-layer.mjs";

const epsilon = 1e-9;

const fullframeActionTimingsForSegment = ({ storyboard, cues, segment }) => {
  const bindingSet = storyboard.features?.["cue-sync"]?.bindings?.[segment.id];
  if (!bindingSet) throw new Error(`${segment.id} 缺少已接纳cue-sync结果`);
  const range = resolveCueRange({ cueRange: segment.cueRange, cues });
  return resolveCueBindingsToFrames({
    bindingSet,
    cues,
    segmentStartMs: range.startMs,
    segmentEndMs: range.endMs,
    fps: VIDEO_SPEC.fps
  });
};

export const fullframeRuntimeTimingForAuthorUnits = ({ authorUnits, cues, openerTemplate, requireCameraHandles = true }) => {
  const resolved = bodyRuntimeTimingForAuthorUnits({ authorUnits, cues, requireCameraHandles });
  // Body-relative coordinates keep camera handoff independent of the later opener duration.
  // Its fixed exit policy already determines the first body camera preroll.
  const first = resolved.segments[0];
  if (first?.templateId === "fullframe-narrative") {
    const policy = {
      "episode-opener": OPENER_RENDER_POLICY,
      "documentary-opener": DOCUMENTARY_OPENER_RENDER_POLICY,
      "crossfire-opener": CROSS_FIRE,
      "opposed-opener": OPPOSED_POLICY,
      "glass-opener": GLASS_POLICY
    }[openerTemplate];
    if (!policy) throw new Error("全画幅首拍预算缺少有效的正式片头选择");
    first.appliedEntranceLeadFrames = openerEntranceLeadFramesFor({
      exitTransition: policy.exitTransition,
      visualGapFrames: Math.max(0, first.startFrame)
    });
    first.appliedCameraPrerollFrames = incomingCameraPrerollFrames({
      entranceLeadFrames: first.appliedEntranceLeadFrames,
      holdIncomingVisualAtStart: false,
      entryTransition: policy.exitTransition
    });
    first.appliedVisualFrameOffset = incomingVisualFrameOffset({
      entranceLeadFrames: first.appliedEntranceLeadFrames,
      holdIncomingVisualAtStart: false,
      entryTransition: policy.exitTransition
    });
  }
  return resolved;
};

export const fullframeTransitionHandoffForAuthorUnit = ({
  previousAuthorUnit, currentAuthorUnit, authorUnits, storyboard, cues, openerTemplate
}) => {
  if (previousAuthorUnit?.treatment?.templateId !== "fullframe-narrative"
    || currentAuthorUnit?.templateId !== "fullframe-narrative") return null;
  const resolved = fullframeRuntimeTimingForAuthorUnits({ authorUnits, cues, openerTemplate });
  const previousSegment = resolved.segments.find((segment) => segment.id === previousAuthorUnit.id);
  const currentSegment = resolved.segments.find((segment) => segment.id === currentAuthorUnit.id);
  const boundary = resolved.transitions.find((transition) => (
    transition.previousId === previousAuthorUnit.id && transition.nextId === currentAuthorUnit.id
  ));
  if (!previousSegment || !currentSegment || !boundary) {
    throw new Error(`${previousAuthorUnit.id}->${currentAuthorUnit.id} 缺少可计算的接镜边界`);
  }
  const maximumBoundaryFrames = framesForMilliseconds({
    milliseconds: FULLFRAME_RENDER_POLICY.motion.maximumBoundaryTravelMs,
    fps: VIDEO_SPEC.fps,
    label: "全画幅跨片段运镜上限"
  });
  const [plan] = fullframeRuntimePlansForSegments({
    segments: [{
      id: previousSegment.id,
      treatment: previousAuthorUnit.treatment,
      actionTimings: fullframeActionTimingsForSegment({ storyboard, cues, segment: previousSegment }),
      durationInFrames: previousSegment.durationInFrames,
      cameraPrerollFrames: previousSegment.appliedCameraPrerollFrames,
      exitTailFrames: previousSegment.appliedExitTailFrames
    }],
    fps: VIDEO_SPEC.fps,
    motionPolicy: FULLFRAME_RENDER_POLICY.motion,
    maximumBoundaryFrames
  });
  const previousFrameIndex = plan?.frames?.length - 1;
  if (!Number.isInteger(previousFrameIndex) || previousFrameIndex < 0) {
    throw new Error(`${previousAuthorUnit.id} 缺少上一全画幅运行计划`);
  }
  const previousTiming = preEnteredSegmentTiming({
    startFrame: previousSegment.startFrame,
    durationInFrames: previousSegment.durationInFrames,
    entranceLeadFrames: previousSegment.appliedEntranceLeadFrames,
    exitTailFrames: previousSegment.appliedExitTailFrames
  });
  const currentTiming = preEnteredSegmentTiming({
    startFrame: currentSegment.startFrame,
    durationInFrames: currentSegment.durationInFrames,
    entranceLeadFrames: currentSegment.appliedEntranceLeadFrames,
    exitTailFrames: currentSegment.appliedExitTailFrames
  });
  // Reference the stable camera handles, not an effect the current author has
  // not chosen yet. Design measurement samples this same source at its actual chosen boundary.
  const referenceStart = currentSegment.startFrame - narrativeHandleFrames();
  const globalFrames = [referenceStart + 1, referenceStart + 2];
  const previousRouteViewports = globalFrames.map((globalFrame) => {
    const state = cameraStateAtRuntimeFrame({
      frames: plan.frames,
      transitions: plan.transitions,
      localFrame: globalFrame - previousTiming.from,
      runtimeTiming: {
        semanticFrameOffset: previousTiming.semanticFrameOffset,
        visualFrameOffset: previousSegment.appliedVisualFrameOffset
      },
      label: `${previousAuthorUnit.id}->${currentAuthorUnit.id} Author接镜证据`
    });
    const layer = state.layers.find((item) => item.index === previousFrameIndex && item.visibleWeight > epsilon);
    if (!layer) throw new Error(`${previousAuthorUnit.id} 在交接帧${globalFrame}缺少末画面相机`);
    return viewportForCamera(layer.camera);
  });
  return {
    previousType: plan.frames[previousFrameIndex].type,
    previousMotion: plan.frames[previousFrameIndex].motion,
    previousMotionFrameAtCut: currentSegment.startFrame - (previousFrameIndex === 0
      ? previousTiming.from - previousSegment.appliedVisualFrameOffset : previousSegment.startFrame),
    currentFrameAtCut: currentSegment.startFrame - currentTiming.from,
    previousVisibleEndViewport: plan.frames[previousFrameIndex].runtime.visibleEndViewport,
    previousRuntimeEndViewport: plan.frames[previousFrameIndex].runtime.actualEndViewport,
    previousRouteViewports,
    currentLocalFrames: globalFrames.map((globalFrame) => globalFrame - currentTiming.from)
  };
};
