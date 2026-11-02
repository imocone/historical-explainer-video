import {
  frameForTime,
  resolveCueRange
} from "../../cue-boundaries.mjs";
import { VIDEO_SPEC, frameSpanForMs } from "../../video-spec.mjs";
import { fullframeMotionBudgetForCueOption } from "./cue-policy-runtime.mjs";
import { fullframeTransitionCapacityFor } from "./timing-runtime.mjs";

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
  includePlanning = false
}) => {
  const range = resolveCueRange({ cueRange, cues });
  const durationInFrames = frameSpanForMs({
    startMs: range.startMs,
    endMs: range.endMs,
    fps
  });
  const singleBudget = fullframeMotionBudgetForCueOption({
    durationInFrames,
    fps,
    label
  });
  const legalBindings = [];
  const options = [];
  for (const candidate of internalCueBoundaries(range)) {
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
      frames: fullframeMotionBudgetForCueOption({
        durationInFrames, switchFrame: frame, fps,
        label: `${label}/${candidate.cueId}.${candidate.edge}`
      })
    });
  }

  if (includePlanning) options.unshift({ binding: null, frames: singleBudget });

  return {
    ...(includePlanning ? { planning: { options } } : {}),
    allowsAB: legalBindings.length > 0,
    durationMs: range.durationMs,
    legalBindings
  };
};
