import {
  frameForTime,
  resolveCueRange
} from "../../cue-boundaries.mjs";
import { frameSpanForMs, VIDEO_SPEC } from "../../video-spec.mjs";
import { fullframeMotionBudgetForCueOption } from "./cue-policy-runtime.mjs";
import { FULLFRAME_RENDER_POLICY } from "./render-policy.mjs";
import { inspectFullframeAuthorability } from "./authorability.mjs";
import { fullframeTransitionCapacityFor } from "./timing-runtime.mjs";
import { fullframeRuntimeTimingForAuthorUnits, fullframeTransitionHandoffForAuthorUnit } from "./camera/author-transition-handoff.mjs";
import { projectCalloutAuthorContext } from "./callout/context-runtime.mjs";
import path from "node:path";
import { inspectP3Input } from "../../../engine/p3-input.mjs";
import { authorUnitsForStoryboard, businessContent } from "../../../engine/runtime/storyboard.mjs";
import { hashObject, readData } from "../../program-utils.mjs";
import { authorSegmentId, getEpisodePaths, getProgramPaths } from "../../workspace-paths.mjs";
import { deriveCandidateWorkspaceRoot } from "./task-contract.mjs";

import { projectAdjacentTreatment } from "./camera/context-runtime.mjs";
export { projectAdjacentTreatment };

export const readPreviousTreatment = async ({ workspaceRoot, task: workOrder }) => {
  if (!workOrder?.inputs?.previousCameraStateSha256) return workOrder?.inputs?.previousTreatment ?? null;
  const paths = getEpisodePaths(workspaceRoot, workOrder.subject.id);
  const [storyboard, inspected, programPlan] = await Promise.all([
    readData(paths.storyboard),
    inspectP3Input({ root: workspaceRoot, episodeId: workOrder.subject.id }),
    readData(getProgramPaths(workspaceRoot).programPlan)
  ]);
  const currentId = workOrder.inputs?.authorUnit?.id;
  const currentIndex = (storyboard.beats ?? []).findIndex((beat) => beat.id === currentId);
  if (currentIndex < 0) throw new Error("当前全画幅Beat不存在");
  const boundaryStoryboard = structuredClone(storyboard);
  const currentBeat = boundaryStoryboard.beats[currentIndex];
  currentBeat.treatment = { templateId: currentBeat.templateId };
  const authorUnits = authorUnitsForStoryboard(boundaryStoryboard);
  const previous = authorUnits.find((unit) => unit.id === workOrder.inputs.previousAuthorUnit?.id);
  if (workOrder.inputs.previousAuthorUnit?.kind !== "beat" || previous?.kind !== "beat"
    || previous.templateId !== "fullframe-narrative" || previous.treatment?.templateId !== "fullframe-narrative") {
    throw new Error("当前工作单指向的紧邻上一全画幅Beat不存在或尚未接纳");
  }
  const current = authorUnits.find((unit) => unit.id === currentId);
  if (!current) throw new Error("当前全画幅Beat缺少接镜边界单元");
  if (!authorSegmentId(current) || authorSegmentId(previous) !== authorSegmentId(current))
    throw new Error("相机参考必须来自同一全画幅段");
  const transitionHandoff = fullframeTransitionHandoffForAuthorUnit({
    previousAuthorUnit: previous,
    currentAuthorUnit: current,
    authorUnits,
    storyboard,
    cues: inspected.cues,
    openerTemplate: programPlan.openerTemplate
  });
  if (!transitionHandoff) throw new Error("当前边界缺少可用的上一全画幅相机交接轨迹");
  const projected = projectAdjacentTreatment(previous.treatment, { transitionHandoff });
  const physical = {
    templateId: projected.templateId,
    continuity: projected.continuity,
    exitPicture: projected.exitPicture
  };
  if (hashObject(physical) !== hashObject(workOrder.inputs.previousTreatment)) {
    throw new Error("上一镜物理连续性与当前工作单不一致");
  }
  const cameraInput = {
    templateId: projected.templateId,
    exitFrameId: projected.exitFrameId,
    cameraState: projected.cameraState
  };
  if (hashObject(cameraInput) !== workOrder.inputs.previousCameraStateSha256) {
    throw new Error("同帧相机交接轨迹与当前工作单摘要不一致");
  }
  return projected;
};

const locateBoundary = ({ beats, beforeBeatId }) => {
  const boundary = (beats ?? []).findIndex((beat) => beat.id === beforeBeatId);
  if (boundary < 0) throw new Error(`全画幅作者上下文找不到当前 Beat: ${beforeBeatId}`);
  return boundary;
};

const projectPriorVisuals = ({ authorUnits, beforeBeatId }) => {
  const boundary = authorUnits.findIndex((unit) => unit.beatIds.includes(beforeBeatId));
  if (boundary < 0) throw new Error(`全画幅前序画面参考找不到当前单位: ${beforeBeatId}`);
  const segmentId = authorSegmentId(authorUnits[boundary]);
  return authorUnits.slice(0, boundary).filter(unit => segmentId && authorSegmentId(unit) === segmentId).flatMap((unit) => {
    const pictures = (unit.treatment?.assetRequests ?? []).map(({ requestId, purpose, sceneDescription, attentionPlan, motion, incomingTransition, asset }, index) => ({
      requestId, purpose, ...(asset ? {asset} : {}),
      ...(unit.templateId === "fullframe-narrative" ? {
        sceneDescription,
        motionIntent: { type: motion.type, speedRatio: motion.speedRatio, entryFocus: attentionPlan.entryFocus,
          ...(motion.speedChanges ? { speedChanges: structuredClone(motion.speedChanges) } : {}),
          landingFocus: attentionPlan.landingFocus, viewerChange: attentionPlan.viewerChange },
        incomingTransition: index === 0 ? unit.treatment.incomingTransition ?? null : incomingTransition
      } : {})
    }));
    return pictures.length ? [{
      unitId: unit.id, templateId: unit.templateId, beatIds: [...unit.beatIds], pictures
    }] : [];
  });
};

const projectEpisodeReferences = ({ albumPlan, acceptedBeats, episodeCues, authorUnits, beforeBeatId }) => ({
  episodeContext: {
    cues: structuredClone(episodeCues),
    albumPlan: businessContent(albumPlan),
    beats: acceptedBeats.map(({ treatment, ...beat }) => businessContent(beat)),
    templateRuns: [...new Map(authorUnits.filter(unit => unit.templateRun || unit.paragraph)
      .map(unit => [unit.templateRun?.id ?? unit.paragraph.id, unit.templateRun ?? unit.paragraph])).values()].map((templateRun) => {
      const { treatment, ...direction } = templateRun;
      return businessContent(direction);
    }),
    currentPosition: { beatId: beforeBeatId, index: locateBoundary({ beats: acceptedBeats, beforeBeatId }) + 1,
      total: acceptedBeats.length }
  },
  priorVisuals: projectPriorVisuals({ authorUnits, beforeBeatId }),
  ...(authorUnits.find(unit => unit.id === beforeBeatId)?.paragraph ? { paragraph: (() => {
    const paragraph = authorUnits.find(unit => unit.id === beforeBeatId).paragraph;
    return { ...paragraph, acceptedMembers: authorUnits.filter(unit => paragraph.beatIds.includes(unit.id)
      && unit.treatment).map(unit => ({ beatId: unit.id, treatment: businessContent(unit.treatment) })) };
  })() } : {})
});

// Refresh read-only references for an already issued task without rewriting its
// identity or candidate. The same pinned previous camera is available immediately.
export const refreshAuthorReferences = async ({ workOrder, workOrderPath }) => {
  const workspaceRoot = deriveCandidateWorkspaceRoot({ workOrder,
    candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath)) });
  const [storyboard, inspected] = await Promise.all([
    readData(getEpisodePaths(workspaceRoot, workOrder.subject.id).storyboard),
    inspectP3Input({ root: workspaceRoot, episodeId: workOrder.subject.id })
  ]);
  return {
    templateContext: projectEpisodeReferences({ albumPlan: storyboard.albumPlan, acceptedBeats: storyboard.beats,
      episodeCues: inspected.cues, authorUnits: authorUnitsForStoryboard(storyboard),
      beforeBeatId: workOrder.inputs.authorUnit.beatIds[0] }),
    previousTreatment: await readPreviousTreatment({ workspaceRoot, task: workOrder })
  };
};

const projectBatchInputCopies = (inputs) => {
  if (!inputs.authorBatch) return inputs;
  const projected = structuredClone(inputs);
  const episode = projected.templateContext.episodeContext;
  const cueTexts = new Map(episode.cues.map(cue => [String(cue.id), cue.text]));
  for (const member of [projected, ...projected.authorBatch.members.map(member => member.inputs)]) {
    for (const beat of member.authorUnitBeats ?? []) {
      if (JSON.stringify(beat.cues) === JSON.stringify(member.cues)) delete beat.cues;
    }
    const direction = member.directionContext;
    if (direction?.albumPlan && Object.entries(direction.albumPlan).length
      && Object.entries(direction.albumPlan).every(([key, value]) =>
        JSON.stringify(value) === JSON.stringify(episode.albumPlan?.[key]))) delete direction.albumPlan;
    const context = member.templateContext;
    if (context?.priorCueIndex) context.priorCueIndex = context.priorCueIndex.map(cue => {
      if (typeof cue.text !== "string" || cueTexts.get(String(cue.id)) !== cue.text) return cue;
      const { text: _text, ...index } = cue;
      return index;
    });
  }
  return projected;
};

// Same-view copies share the episode text; cross-task reuse still needs explicit digests.
export const projectAuthorReferenceView = ({ inputs, workspaceRoot, episodeId, reuseReferences }) => {
  inputs = projectBatchInputCopies(inputs);
  const context = inputs.templateContext;
  const { currentPosition, ...episode } = context.episodeContext;
  const referenceDigests = {
    scope: hashObject({ workspaceRoot: path.resolve(workspaceRoot), episodeId }),
    episodeContext: hashObject(episode),
    priorVisuals: Object.fromEntries(context.priorVisuals.map(unit => [unit.unitId, hashObject(unit)]))
  };
  const sameScope = reuseReferences?.scope === referenceDigests.scope;
  const reusedReferences = {
    episodeContext: sameScope && reuseReferences.episodeContext === referenceDigests.episodeContext,
    priorVisuals: context.priorVisuals.filter(unit => sameScope
      && reuseReferences.priorVisuals?.[unit.unitId] === referenceDigests.priorVisuals[unit.unitId])
      .map(unit => unit.unitId)
  };
  return {
    inputs: { ...inputs, templateContext: { ...context,
      episodeContext: reusedReferences.episodeContext ? { currentPosition } : context.episodeContext,
      priorVisuals: context.priorVisuals.filter(unit => !reusedReferences.priorVisuals.includes(unit.unitId))
    } },
    referenceDigests,
    reusedReferences
  };
};

const projectFramePlanning = ({ beats, beforeBeatId, episodeCues, authorUnits, openerTemplate }) => {
  const boundary = locateBoundary({ beats, beforeBeatId });
  const beat = beats[boundary];
  const inspection = inspectFullframeAuthorability({
    cueRange: beat.cueRange,
    cues: episodeCues,
    label: beat.id
  });
  const firstCueId = beat.cueRange?.[0];
  const range = resolveCueRange({ cueRange: beat.cueRange, cues: episodeCues });
  const durationInFrames = frameSpanForMs({
    startMs: range.startMs,
    endMs: range.endMs,
    fps: VIDEO_SPEC.fps
  });
  const timing = fullframeRuntimeTimingForAuthorUnits({ authorUnits, cues: episodeCues, openerTemplate })
    .segments.find((segment) => segment.id === beforeBeatId);
  if (!timing) throw new Error(`${beat.id} 缺少已定接镜时窗`);
  const runtimeTiming = {
    cameraPrerollFrames: timing.appliedCameraPrerollFrames,
    exitTailFrames: timing.appliedExitTailFrames
  };
  const budgetForBinding = (binding) => {
    const cue = range.cues.find((item) => String(item.id) === String(binding.cueId));
    if (!cue) throw new Error(`${beat.id} 运镜预算找不到字幕: ${binding.cueId}`);
    const timeMs = binding.edge === "start" ? cue.startMs : cue.endMs;
    const switchFrame = frameForTime({
      timeMs, segmentStartMs: range.startMs, segmentEndMs: range.endMs, fps: VIDEO_SPEC.fps
    });
    return {
      binding,
      transitionCapacity: fullframeTransitionCapacityFor({ durationInFrames, switchFrame, fps: VIDEO_SPEC.fps, label: beat.id }),
      frames: fullframeMotionBudgetForCueOption({
        durationInFrames,
        runtimeTiming,
        switchFrame,
        fps: VIDEO_SPEC.fps,
        label: `${beat.id}/${binding.cueId}.${binding.edge}`
      })
    };
  };
  return {
    incomingTransitionSupported: boundary > 0 && beats[boundary - 1]?.templateId === "fullframe-narrative",
    cueOptions: {
      frameA: [{
        frameId: "A",
        action: "start-frame-motion",
        cueId: firstCueId,
        edge: "start"
      }],
      frameB: inspection.legalBindings.map((binding) => ({
        frameId: "B",
        action: "dissolve-in",
        ...binding
      }))
    },
    motionBudgets: {
      speedRange: {
        minimumRatio: FULLFRAME_RENDER_POLICY.motion.minimumSpeedRatio,
        referenceTraversePerSecond: FULLFRAME_RENDER_POLICY.motion.traverseNormalizedSpeedPerSecond,
        referenceZoomPerSecond: FULLFRAME_RENDER_POLICY.motion.zoomScaleSpeedPerSecond
      },
      options: [
        {
          binding: null,
          frames: fullframeMotionBudgetForCueOption({
            durationInFrames,
            runtimeTiming,
            fps: VIDEO_SPEC.fps,
            label: beat.id
          })
        },
        ...inspection.legalBindings.map(budgetForBinding)
      ]
    }
  };
};

export const projectAuthorContext = ({
  programPlan,
  authorUnits,
  episodeCues,
  albumPlan,
  acceptedBeats,
  beforeBeatId
}) => {
  const current = authorUnits.find(unit => unit.beatIds.includes(beforeBeatId));
  const segmentId = authorSegmentId(current);
  const memberIds = new Set(current?.paragraph?.beatIds ?? [beforeBeatId]);
  const framePlanning = projectFramePlanning({
    beats: acceptedBeats,
    beforeBeatId,
    episodeCues,
    authorUnits,
    openerTemplate: programPlan.openerTemplate
  });
  return {
    ...projectEpisodeReferences({ albumPlan, acceptedBeats, episodeCues, authorUnits, beforeBeatId }),
    ...projectCalloutAuthorContext({
      programPlan,
      episodeCues,
      beats: acceptedBeats.map(beat => memberIds.has(beat.id) ? beat : { ...beat, treatment: null }),
      beforeBeatId
    }),
    ...framePlanning,
    segmentStart: Boolean(segmentId && current.paragraph.beatIds[0] === beforeBeatId)
  };
};
