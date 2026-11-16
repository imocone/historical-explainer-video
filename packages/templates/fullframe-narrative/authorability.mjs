import {
  frameForTime,
  resolveCueRange
} from "../../cue-boundaries.mjs";
import { VIDEO_SPEC, frameSpanForMs } from "../../video-spec.mjs";
import { fullframeMotionBudgetForCueOption } from "./cue-policy-runtime.mjs";
import { fullframeTransitionCapacityFor } from "./timing-runtime.mjs";
import { fullframeRuntimeTimingForAuthorUnits } from "./camera/author-transition-handoff.mjs";
import { FULLFRAME_RENDER_POLICY } from "./render-policy.mjs";
import { FULLFRAME_VIEWPORT_POLICY } from "./camera/geometry.mjs";

const internalCueBoundaries = (range) => {
  const candidates = [];
  const seen = new Set();
  for (const cue of range.cues) {
    for (const edge of ["start", "end"]) {
      const timeMs = edge === "start" ? cue.startMs : cue.endMs;
      if (timeMs <= range.startMs || timeMs >= range.endMs) continue;
      const key = `${cue.id}\u0000${edge}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ cueId: cue.id, edge, timeMs });
    }
  }
  return candidates;
};

export const inspectFullframeAuthorability = ({
  cueRange,
  cues,
  fps = VIDEO_SPEC.fps,
  label = "全画幅 Beat",
  includePlanning = false,
  singlePicture = false,
  authorUnits = null,
  openerTemplate = null
}) => {
  const range = resolveCueRange({ cueRange, cues });
  const durationInFrames = frameSpanForMs({
    startMs: range.startMs,
    endMs: range.endMs,
    fps
  });
  const timing = authorUnits ? fullframeRuntimeTimingForAuthorUnits({ authorUnits, cues, openerTemplate }) : null;
  const segment = timing?.segments.find(item => item.id === label);
  if (authorUnits && !segment) throw new Error(`${label} 缺少有序播放单元的接镜时窗`);
  const runtimeTiming = segment ? { cameraPrerollFrames: segment.appliedCameraPrerollFrames,
    exitTailFrames: segment.appliedExitTailFrames } : null;
  const framesFor = (args) => fullframeMotionBudgetForCueOption({ durationInFrames, fps, runtimeTiming, ...args })
    .map(frame => {
      const maximumRatio = Math.min(FULLFRAME_RENDER_POLICY.motion.maximumSpeedRatio,
        frame.maximumZoomScaleTravel / (FULLFRAME_RENDER_POLICY.motion.zoomScaleSpeedPerSecond * frame.runtimeDurationMs/1000));
      return { ...frame, pureZoomConstantSpeedRange: maximumRatio >= FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio
        ? { minimumRatio: FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio, maximumRatio } : null };
    });
  const singleBudget = framesFor({ label });
  const legalBindings = [];
  const options = [];
  for (const candidate of singlePicture ? [] : internalCueBoundaries(range)) {
    const frame = frameForTime({
      timeMs: candidate.timeMs,
      segmentStartMs: range.startMs,
      segmentEndMs: range.endMs,
      fps
    });
    const transitionCapacity = fullframeTransitionCapacityFor({ durationInFrames, switchFrame: frame, fps, label });
    if (!transitionCapacity) continue;
    const binding = { cueId: candidate.cueId, edge: candidate.edge };
    legalBindings.push(binding);
    if (includePlanning) options.push({
      binding,
      transitionCapacity,
      frames: framesFor({
        switchFrame: frame,
        label: `${label}/${candidate.cueId}.${candidate.edge}`
      })
    });
  }

  if (includePlanning) options.unshift({ binding: null, frames: singleBudget });
  const occupiesViewingTime = item => item.durationInFrames > 0
    && (item.mode === "narrative" || item.explainerPush);
  const incoming = timing?.transitions.find(item => item.nextId === label && occupiesViewingTime(item));
  const outgoing = timing?.transitions.find(item => item.previousId === label && occupiesViewingTime(item));
  const clearViewingMs = segment ? 1000 / fps * Math.max(0,
    Math.min(segment.startFrame + durationInFrames, outgoing?.startFrame ?? Infinity)
    - Math.max(segment.startFrame, incoming ? incoming.startFrame + incoming.durationInFrames : 0)) : range.durationMs;

  return {
    ...(includePlanning ? { planning: { options, clearViewingMs, speedRange: {
      minimumRatio: FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio,
      maximumRatio: FULLFRAME_RENDER_POLICY.motion.maximumSpeedRatio,
      referenceTraversePerSecond: FULLFRAME_RENDER_POLICY.motion.traverseNormalizedSpeedPerSecond,
      referenceZoomPerSecond: FULLFRAME_RENDER_POLICY.motion.zoomScaleSpeedPerSecond },
      maximumRenderScale: FULLFRAME_VIEWPORT_POLICY.maximumRenderScale,
      motionTypes: ["push-in", "pull-out", "traverse"] } } : {}),
    allowsAB: legalBindings.length > 0,
    durationMs: range.durationMs,
    legalBindings
  };
};
