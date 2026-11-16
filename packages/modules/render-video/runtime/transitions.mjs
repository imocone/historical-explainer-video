import {
  isExplainerTemplateId
} from "../../../explainer-template-selection.mjs";
import { resolveCueRange } from "../../../cue-boundaries.mjs";
import { frameForMs, frameSpanForMs, VIDEO_SPEC } from "../../../video-spec.mjs";
import { isNarrativeMedia, narrativeBoundary } from "./narrative-transition.mjs";
import { VOX_EXPLAINER_TIMING } from "../../../templates/vox-explainer/cue-policy.mjs";
import { episodeEndingReserveFrames } from "./ending.mjs";

const framesForSeconds = (seconds) => Math.round(seconds * VIDEO_SPEC.fps);
const ordinaryTransitionLimitFrames = framesForSeconds(0.4);
const centeredTransitionHalfLimitFrames = framesForSeconds(0.5);
const narrativeMedia = (segment) => isNarrativeMedia({ templateId: segment.templateId });

export const transitionFrames = (duration) => Math.max(
  1,
  Math.min(ordinaryTransitionLimitFrames, Math.floor(duration / 3))
);

const centeredTransitionHalfFrames = (duration) => Math.max(
  0,
  Math.min(centeredTransitionHalfLimitFrames, Math.floor(duration / 3))
);

const explainerTiming = () => VOX_EXPLAINER_TIMING;
const lastExplainerActionFrame = segment => Math.max(0, segment.durationInFrames - 1);

const explainerPushesFor = ({ segment, transitions }) => ({
  incoming: transitions.find(item => item.nextId === segment.id && item.explainerPush),
  outgoing: transitions.find(item => item.previousId === segment.id && item.explainerPush)
});

export const explainerHandoffContext = ({ segment, transitions }) => {
  const { incoming, outgoing } = explainerPushesFor({ segment, transitions });
  const entry = explainerTiming(segment).entry;
  const breathFrames = entry.breathFrames;
  const contentStart = incoming ? -incoming.entranceLeadFrames + incoming.durationInFrames + breathFrames : 0;
  return {
    ...(incoming ? { entryHandoff: {
      contentStartFrame: contentStart, titleStartFrame: contentStart,
      titleEndFrame: contentStart + entry.titleRevealFrames,
      boardStartFrame: contentStart + entry.titleRevealFrames
    } } : {}),
    ...(outgoing ? { exitHandoff: {
      startFrame: outgoing.startFrame - segment.startFrame,
      durationInFrames: outgoing.durationInFrames
    } } : {})
  };
};

export const explainerViewingWindow = ({ segment, transitions }) => {
  const { incoming, outgoing } = explainerPushesFor({ segment, transitions });
  const localWindow = (push) => {
    if (!push) return null;
    const startFrame = push.startFrame - segment.startFrame;
    return { startFrame, endFrame: startFrame + push.durationInFrames };
  };
  const entryPush = localWindow(incoming);
  const exitPush = localWindow(outgoing);
  const startFrame = Math.max(0, entryPush?.endFrame ?? 0);
  const endFrame = Math.min(segment.durationInFrames, exitPush?.startFrame ?? segment.durationInFrames);
  return {
    entryPush,
    exitPush,
    clearViewing: endFrame > startFrame ? { startFrame, endFrame } : null
  };
};

// GSAP power3.inOut: both complete frames travel the same distance, with no alpha blend.
export const explainerPushPresentation = ({ frame, durationInFrames }) => {
  const t = Math.max(0, Math.min(1, frame / durationInFrames));
  const p = t < .5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
  return { outgoing: { opacity: 1, translate: `${-p * 100}% 0` },
    incoming: { opacity: 1, translate: `${(1 - p) * 100}% 0` } };
};
const transitionProgress = ({ frame, durationInFrames }) => (
  Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)))
);

export const centeredTransitionProgress = ({ frame, durationInFrames }) => {
  const progress = transitionProgress({ frame, durationInFrames });
  return progress * progress * (3 - 2 * progress);
};

// The outgoing opener reaches black halfway through this boundary. The body
// then emerges during the second half, before its narration starts.
export const dipToBlackIncomingProgress = ({ frame, durationInFrames }) => {
  const progress = Math.max(0, (transitionProgress({ frame, durationInFrames }) - .5) * 2);
  return progress * progress * (3 - 2 * progress);
};

export const transitionPresentation = ({ frame, durationInFrames, transition = null }) => {
  const progress = centeredTransitionProgress({ frame, durationInFrames });
  if (transition?.variant === "strip-open" || transition?.type === "crossfire-open") return { opacity: 1 };
  if (transition?.type === "pull-reveal" && transition.direction === "right-to-left") {
    return {
      opacity: 1,
      clipPath: `inset(0 ${progress * 100}% 0 0)`,
      translate: `${-36 * progress}px 0px`
    };
  }
  return { opacity: 1 - progress };
};

export const incomingPullRevealPresentation = ({ frame, durationInFrames, transition = null }) => {
  const progress = centeredTransitionProgress({ frame, durationInFrames });
  if (transition?.variant === "strip-open") return { opacity: 1 };
  return {
    opacity: 1,
    clipPath: `inset(0 0 0 ${(1 - progress) * 100}%)`,
    translate: `${36 * (1 - progress)}px 0px`
  };
};

export const preEnteredSegmentTiming = ({
  startFrame,
  durationInFrames,
  entranceLeadFrames,
  exitTailFrames = 0
}) => ({
  from: startFrame - entranceLeadFrames,
  durationInFrames: durationInFrames + entranceLeadFrames + exitTailFrames,
  semanticFrameOffset: -entranceLeadFrames
});

export const incomingVisualFrameOffset = ({ entranceLeadFrames, entryTransition = null, holdIncomingVisualAtStart = true }) => {
  if (!Number.isInteger(entranceLeadFrames) || entranceLeadFrames < 0) {
    throw new Error("incoming entranceLeadFrames 必须是非负整数");
  }
  const fullframeCameraPrerollFrames = incomingCameraPrerollFrames({
    entranceLeadFrames, entryTransition, holdIncomingVisualAtStart
  });
  return -(entranceLeadFrames - fullframeCameraPrerollFrames);
};

export const openerEntranceLeadFramesFor = ({ exitTransition, visualGapFrames }) => (
  exitTransition.durationInFrames + visualGapFrames
);

export const incomingCameraPrerollFrames = ({
  entranceLeadFrames,
  holdIncomingVisualAtStart,
  entryTransition = null
}) => {
  if (!Number.isInteger(entranceLeadFrames) || entranceLeadFrames < 0) {
    throw new Error("incoming entranceLeadFrames 必须是非负整数");
  }
  if (typeof holdIncomingVisualAtStart !== "boolean") {
    throw new Error("incoming holdIncomingVisualAtStart 必须是布尔值");
  }
  if (entryTransition?.type === "crossfire-open") {
    // The plate owns the entrance. The body's own camera begins at the settled
    // full-frame image, and keeps the original narration/Cue origin.
    return holdIncomingVisualAtStart ? 0 : Math.min(entranceLeadFrames, framesForSeconds(.84));
  }
  if (entryTransition?.presentation === "story-designed") return entranceLeadFrames;
  if (!holdIncomingVisualAtStart) {
    // The incoming image is invisible for the first half of a dip to black.
    // Keep its camera at the entrance until its first positive-opacity frame.
    return entryTransition?.type === "dip-to-black"
      ? Math.max(0, entranceLeadFrames - Math.ceil(entryTransition.durationInFrames / 2))
      : entranceLeadFrames;
  }
  if (
    entryTransition?.type === "pull-reveal"
    && entryTransition.direction === "right-to-left"
  ) {
    return Math.min(centeredTransitionHalfLimitFrames, entranceLeadFrames);
  }
  return 0;
};

export const boundaryOverlayRuntimeTiming = ({
  cameraPrerollFrames
}) => {
  if (!Number.isInteger(cameraPrerollFrames) || cameraPrerollFrames < 0) {
    throw new Error("边界叠层 cameraPrerollFrames 必须是非负整数");
  }
  return {
    cameraPrerollFrames,
    visualFrameOffset: cameraPrerollFrames
  };
};

export const crossBeatTransitionPlan = (segments, { requireCameraHandles = true } = {}) => segments.slice(1).flatMap((segment, index) => {
  const previous = segments[index];
  if (narrativeMedia(previous) && narrativeMedia(segment)) return [narrativeBoundary({ previous, next: segment, requireCameraHandles })];
  const incomingExplainer = isExplainerTemplateId(segment.templateId);
  const outgoingExplainer = isExplainerTemplateId(previous.templateId);
  if ((incomingExplainer && (narrativeMedia(previous) || outgoingExplainer))
    || (outgoingExplainer && narrativeMedia(segment))) {
    const timing = explainerTiming(incomingExplainer ? segment : previous);
    const requested = incomingExplainer ? segment.entranceLeadFrames ?? timing.entry.leadFrames : timing.entry.pushFrames;
    if (!Number.isInteger(requested) || requested < 0) throw new Error(`${segment.id} entranceLeadFrames 必须是非负整数`);
    const available = segment.startFrame - previous.startFrame - (outgoingExplainer ? lastExplainerActionFrame(previous) : 0);
    const lead = Math.max(0, Math.min(requested, available, previous.durationInFrames));
    const pushFrames = timing.entry.pushFrames;
    return [{ boundaryId: `${previous.id}->${segment.id}`, previousId: previous.id, nextId: segment.id,
      mode: "pre-entry", startFrame: segment.startFrame - lead, entranceLeadFrames: lead,
      exitTailFrames: Math.max(0, segment.startFrame - previous.startFrame - previous.durationInFrames + pushFrames - lead),
      transitionFrames: 0, durationInFrames: pushFrames,
      explainerPush: true, holdIncomingVisualAtStart: incomingExplainer }];
  }
  const previousDuration = Math.max(1, previous.durationInFrames);
  const nextDuration = Math.max(1, segment.durationInFrames);
  const requestedLeadFrames = segment.entranceLeadFrames ?? 0;
  if (!Number.isInteger(requestedLeadFrames) || requestedLeadFrames < 0) {
    throw new Error(`${segment.id} entranceLeadFrames 必须是非负整数`);
  }
  const exitTransition = previous.exitTransition ?? null;
  if (exitTransition !== null) {
    const validDissolve = ["dissolve", "dip-to-black", "crossfire-open"].includes(exitTransition.type);
    const validPullReveal = exitTransition.type === "pull-reveal"
      && exitTransition.direction === "right-to-left";
    if ((!validDissolve && !validPullReveal)
      || !Number.isInteger(exitTransition.durationInFrames)
      || exitTransition.durationInFrames < 1) {
      throw new Error(`${previous.id} exitTransition 不合法`);
    }
  }
  const openerToBody = (
    previous.segmentType === "opener"
    && segment.segmentType === "body"
    && exitTransition !== null
  );
  const openerToFullframe = openerToBody && narrativeMedia(segment);
  const openerToExplainer = openerToBody && isExplainerTemplateId(segment.templateId);
  const boundaryExitTransition = openerToBody && exitTransition.type === "pull-reveal"
    ? { ...exitTransition, variant: "strip-open" }
    : exitTransition;
  const entryTransition = openerToFullframe && exitTransition.type === "pull-reveal"
    ? {
        type: "pull-reveal",
        direction: "right-to-left",
        variant: "strip-open"
      }
    : openerToBody && exitTransition.type === "crossfire-open"
      ? { type: "crossfire-open", durationInFrames: exitTransition.durationInFrames }
    : openerToBody && exitTransition.type === "dip-to-black"
      ? { type: "dip-to-black", durationInFrames: exitTransition.durationInFrames }
    : openerToBody && exitTransition.type === "dissolve"
      ? {
          type: "dissolve",
          presentation: "under-outgoing",
          durationInFrames: exitTransition.durationInFrames
        }
      : null;
  const fadeFrames = boundaryExitTransition?.durationInFrames
    ?? Math.min(transitionFrames(previousDuration), transitionFrames(nextDuration));
  const ordinaryEntranceLeadFrames = boundaryExitTransition === null
    ? Math.min(
        requestedLeadFrames,
        centeredTransitionHalfFrames(previousDuration),
        centeredTransitionHalfFrames(nextDuration)
      )
    : 0;
  const openerVisualGapFrames = openerToBody
    ? Math.max(0, segment.startFrame - (previous.startFrame + previousDuration))
    : 0;
  const openerEntranceLeadFrames = openerToBody
    ? openerEntranceLeadFramesFor({ exitTransition: boundaryExitTransition, visualGapFrames: openerVisualGapFrames })
    : 0;
  const entranceLeadFrames = openerToBody ? openerEntranceLeadFrames : ordinaryEntranceLeadFrames;
  const exitTailFrames = openerToBody
    ? 0
    : ordinaryEntranceLeadFrames > 0
      ? ordinaryEntranceLeadFrames
      : previous.templateId === "fullframe-narrative" ? fadeFrames : 0;
  const actualTransitionFrames = openerToBody
    ? boundaryExitTransition.durationInFrames
    : ordinaryEntranceLeadFrames > 0
      ? ordinaryEntranceLeadFrames + exitTailFrames
      : fadeFrames;
  const overlayDuration = ordinaryEntranceLeadFrames > 0
    ? actualTransitionFrames
    : fadeFrames;
  // At the opener boundary, the incoming body is already visible during its
  // entrance lead; that real pre-entry time also covers the transition.
  if (overlayDuration > nextDuration + (openerToBody ? entranceLeadFrames : 0)) {
    throw new Error(`${previous.id}->${segment.id} 边界覆盖超过下一分拍时长`);
  }
  if (entranceLeadFrames > previousDuration) {
    throw new Error(`${previous.id}->${segment.id} 边界覆盖超过上一片段时长`);
  }
  return [{
    boundaryId: `${previous.id}->${segment.id}`,
    previousId: previous.id,
    nextId: segment.id,
    mode: entranceLeadFrames > 0 ? "pre-entry" : "overlay",
    startFrame: segment.startFrame - entranceLeadFrames,
    entranceLeadFrames,
    exitTailFrames,
    transitionFrames: actualTransitionFrames,
    durationInFrames: overlayDuration,
    holdIncomingVisualAtStart: openerToExplainer,
    ...(boundaryExitTransition ? { exitTransition: boundaryExitTransition } : {}),
    ...(entryTransition ? { entryTransition } : {})
  }];
});

export const bodyEditWindows = transitions => transitions
  .filter(edit => (edit.mode === "narrative" || edit.explainerPush) && edit.durationInFrames > 0)
  .map(edit => ({
    boundaryId: edit.boundaryId,
    type: edit.explainerPush ? "vox-push" : edit.entryTransition.type,
    startFrame: edit.startFrame,
    endFrame: edit.startFrame + edit.durationInFrames
  }));

export const bodyEditOverlapErrors = windows => {
  const errors = [];
  let previousEdit = null;
  for (const edit of [...windows].sort((a, b) => a.startFrame - b.startFrame)) {
    if (previousEdit && edit.startFrame < previousEdit.endFrame) {
      const overlap = Math.min(previousEdit.endFrame, edit.endFrame) - edit.startFrame;
      errors.push(`${previousEdit.boundaryId} 和 ${edit.boundaryId} 的转场重叠 ${overlap} 帧`);
    }
    if (!previousEdit || edit.endFrame > previousEdit.endFrame) previousEdit = edit;
  }
  return errors;
};

export const resolveCrossBeatRuntimeTiming = ({
  segments,
  transitions = crossBeatTransitionPlan(segments),
  allowOverlappingEdits = false
}) => {
  if (!Array.isArray(segments) || !Array.isArray(transitions)) {
    throw new Error("P4 跨片段运行计时必须提供片段和转场数组");
  }
  if (!allowOverlappingEdits) {
    const overlaps = bodyEditOverlapErrors(bodyEditWindows(transitions));
    if (overlaps.length) throw new Error(overlaps.join("；"));
  }
  const entranceLeadById = new Map(transitions.map((transition) => [
    transition.nextId,
    transition.entranceLeadFrames
  ]));
  const exitTailById = new Map(transitions.map((transition) => [
    transition.previousId,
    transition.exitTailFrames
  ]));
  const entryTransitionById = new Map(transitions
    .filter((transition) => transition.entryTransition)
    .map((transition) => [transition.nextId, transition.entryTransition]));
  const transitionFramesById = new Map(transitions.map((transition) => [
    transition.nextId,
    transition.transitionFrames
  ]));
  const holdIncomingById = new Map(transitions.map((transition) => [
    transition.nextId,
    transition.holdIncomingVisualAtStart
  ]));
  const resolvedSegments = segments.map((segment) => {
    const appliedEntranceLeadFrames = entranceLeadById.get(segment.id) ?? 0;
    const appliedEntryTransition = entryTransitionById.get(segment.id) ?? null;
    const appliedHoldIncomingVisualAtStart = holdIncomingById.get(segment.id) ?? false;
    const appliedVisualFrameOffset = incomingVisualFrameOffset({
          entranceLeadFrames: appliedEntranceLeadFrames,
          entryTransition: appliedEntryTransition,
          holdIncomingVisualAtStart: appliedHoldIncomingVisualAtStart
        });
    return {
      ...segment,
      appliedEntranceLeadFrames,
      appliedExitTailFrames: exitTailById.get(segment.id) ?? 0,
      appliedEntryTransition,
      appliedTransitionFrames: transitionFramesById.get(segment.id) ?? 0,
      appliedHoldIncomingVisualAtStart,
      appliedVisualFrameOffset,
      appliedCameraPrerollFrames: incomingCameraPrerollFrames({
        entranceLeadFrames: appliedEntranceLeadFrames,
        holdIncomingVisualAtStart: appliedHoldIncomingVisualAtStart,
        entryTransition: appliedEntryTransition
      })
    };
  });
  return { transitions, segments: resolvedSegments };
};

export const bodyTransitionFieldsFor = (templateId) => {
  if (!isExplainerTemplateId(templateId)) return {};
  const timing = VOX_EXPLAINER_TIMING;
  return {
    entranceLeadFrames: timing.entry.leadFrames,
    renderData: {
      voxExplainer: {
        transition: {
          incomingLeadFrames: timing.exit.backgroundSwapLeadFrames,
          exitTailFrames: timing.exit.tailFrames
        }
      }
    }
  };
};

// Body-relative frames use the same Cue origin as the anchored P4 body.
export const bodyRuntimeTimingForAuthorUnits = ({ authorUnits, cues, requireCameraHandles = true }) => {
  if (!Array.isArray(authorUnits)) throw new Error("正文接镜计时缺少作者单元序列");
  const segments = authorUnits.map((unit) => {
    const firstBeat = unit.beats?.[0];
    const lastBeat = unit.beats?.at(-1);
    if (!firstBeat || !lastBeat) throw new Error(`${unit.id} 缺少接镜边界Beat范围`);
    const cueRange = [firstBeat.cueRange[0], lastBeat.cueRange[1]];
    const { startMs, endMs } = resolveCueRange({ cueRange, cues });
    return {
      id: unit.id,
      templateId: unit.templateId,
      segmentType: "body",
      cueRange,
      startFrame: frameForMs({ milliseconds: startMs }),
      durationInFrames: frameSpanForMs({ startMs, endMs }),
      ...bodyTransitionFieldsFor(unit.templateId),
      ...(Object.hasOwn(firstBeat, "incomingTransition") ? { incomingTransition: firstBeat.incomingTransition } : {})
    };
  });
  const resolved = resolveCrossBeatRuntimeTiming({
    segments,
    transitions: crossBeatTransitionPlan(segments, { requireCameraHandles }),
    allowOverlappingEdits: true
  });
  const last = resolved.segments.at(-1);
  if (last?.templateId === "fullframe-narrative" && last.cueRange[1] === cues.at(-1)?.id)
    last.appliedExitTailFrames = episodeEndingReserveFrames();
  return resolved;
};

export const changedBodyViewingUnits = ({ before, after }) => {
  const previousById = new Map(before.segments.map(segment => [segment.id, segment]));
  return after.segments.filter(segment => {
    const previous = previousById.get(segment.id);
    if (!previous || previous.templateId !== segment.templateId) return false;
    if (isExplainerTemplateId(segment.templateId)) {
      return JSON.stringify(explainerViewingWindow({ segment: previous, transitions: before.transitions }))
        !== JSON.stringify(explainerViewingWindow({ segment, transitions: after.transitions }));
    }
    return previous.appliedCameraPrerollFrames !== segment.appliedCameraPrerollFrames
      || previous.appliedExitTailFrames !== segment.appliedExitTailFrames;
  }).map(({ id }) => id);
};
