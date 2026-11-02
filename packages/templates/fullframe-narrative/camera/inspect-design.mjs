import { fullframeDesignItemsForCandidate } from "./candidate-context.mjs";
import {
  inspectFullframeDesigns
} from "./p4-runtime.mjs";
import {
  removeFullframeCameraFinalLock,
  writeFullframeCameraFinalLock
} from "./design-lock.mjs";
import { motionRouteViewportsAtFrames } from "./p4-runtime.mjs";
import { narrativeFirstVisibleFrame, narrativeLastVisibleFrame, narrativeHandleFrames, narrativeTransitionExposure, resolveNarrativeTransition } from "../../../modules/render-video/runtime/narrative-transition.mjs";
import { FULLFRAME_RENDER_POLICY } from "../render-policy.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";

const transitionReadingFor = ({ index, items, treatment, previousTreatment, incomingTransitionSupported }) => {
  const design = index === 0 ? treatment.incomingTransition : treatment.assetRequests[index].incomingTransition;
  if (!design || (index === 0 && !incomingTransitionSupported)) return null;
  const edit = resolveNarrativeTransition(design);
  const last = edit.durationInFrames - 1;
  const firstVisible = narrativeFirstVisibleFrame(edit);
  const frames = [...new Set([
    0, firstVisible, ...[.25, .5, .75, 1].map((fraction) => Math.round(last * fraction)),
    ...(edit.type === "dip-to-black" ? [firstVisible - 1, narrativeLastVisibleFrame(edit) + 1] : [])
  ])].sort((a, b) => a - b);
  const offsets = frames.map((frame) => frame - Math.floor(edit.durationInFrames / 2));
  const handoff = previousTreatment?.cameraState?.transitionHandoff;
  const incoming = items[index];
  const outgoing = items[index - 1];
  const viewports = (motion, motionStartFrame, motionEndFrame, sampleFrames) => motionRouteViewportsAtFrames({
    motion, motionStartFrame,
    frames: sampleFrames.map((frame) => Math.max(motionStartFrame, Math.min(motionEndFrame, frame))),
    fps: VIDEO_SPEC.fps, motionPolicy: FULLFRAME_RENDER_POLICY.motion, label: "转场同帧观看取景"
  });
  // Motion and exposure use the same Cue clock; hidden state is not visible evidence.
  const incomingViewports = viewports(incoming.motion, incoming.budget.startFrame, incoming.budget.runtimeEndFrame,
    offsets.map((offset) => index === 0
      ? (handoff?.currentFrameAtCut ?? narrativeHandleFrames()) + offset
      : incoming.cutFrame + offset));
  const outgoingViewports = outgoing
    ? viewports(outgoing.motion, outgoing.budget.startFrame, outgoing.budget.runtimeEndFrame,
      offsets.map((offset) => incoming.cutFrame + offset + outgoing.budget.cameraPrerollFrames))
    : handoff ? viewports(handoff.previousMotion, handoff.previousMotion.startFrame, handoff.previousMotion.runtimeEndFrame,
      offsets.map((offset) => handoff.previousMotionFrameAtCut + offset)) : null;
  return {
    outgoingTarget: outgoing?.id ?? previousTreatment?.exitPicture?.requestId ?? null,
    cueOffsetWindowMs: [-Math.floor(edit.durationInFrames / 2), Math.ceil(edit.durationInFrames / 2)]
      .map((frame) => frame * 1000 / VIDEO_SPEC.fps),
    samples: frames.map((frame, i) => ({
      cueOffsetMs: offsets[i] * 1000 / VIDEO_SPEC.fps,
      outgoingViewport: outgoingViewports?.[i] ?? null,
      incomingViewport: incomingViewports[i],
      exposure: narrativeTransitionExposure({ ...edit, frame })
    }))
  };
};

export const measureCameraDesign = ({ treatment, featureResults, templateContext, cues, previousTreatment }) => {
  const items = fullframeDesignItemsForCandidate({
    treatment, featureResults, templateContext, cues
  });
  const motionBudgets = items.map(({ id, budget }) => ({ target: id, ...budget }));
  const results = inspectFullframeDesigns({ items });
  const failures = results.filter((item) => !item.ok).map((item) => ({
    target: item.id,
    failureClass: item.failureClass,
    error: item.error
  }));
  if (failures.length) return { ok: false, failures, motionBudgets };
  return {
    ok: true,
    geometryPassed: true,
    motionBudgets,
    targets: results.map((item, index) => ({
      target: item.id,
      speedRatio: item.speedRatio,
      ...(item.speedChanges ? { speedChanges: item.speedChanges } : {}),
      incomingTransition: index === 0 ? treatment.incomingTransition ?? null
        : treatment.assetRequests[index].incomingTransition,
      transitionReading: transitionReadingFor({
        index, items, treatment, previousTreatment,
        incomingTransitionSupported: templateContext?.incomingTransitionSupported
      }),
      ...(index > 0 ? { transitionEntryViewport: treatment.assetRequests[index].motion.startViewport } : {}),
      ...(index === 0 && templateContext?.incomingTransitionSupported ? {
        transitionEntryViewport: motionRouteViewportsAtFrames({
          motion: treatment.assetRequests[0].motion, motionStartFrame: 0,
          frames: [0, 1].map((offset) => {
            const edit = resolveNarrativeTransition(treatment.incomingTransition ?? null);
            const first = narrativeFirstVisibleFrame(edit);
            return narrativeHandleFrames() - Math.floor(edit.durationInFrames / 2) + first + offset;
          }), fps: VIDEO_SPEC.fps, motionPolicy: FULLFRAME_RENDER_POLICY.motion,
          label: "所选转场的入口取景"
        })[0]
      } : {}),
      visibleDurationMs: item.visibleDurationMs,
      visibleCameraTravel: item.visibleCameraTravel,
      runtimeCameraTravel: item.runtimeCameraTravel,
      runtimeDurationMs: item.runtimeDurationMs,
      visibleEndViewport: item.visibleEndViewport,
      visibleRouteViewports: item.visibleRouteViewports,
      remainingVisibleRouteDistance: item.remainingVisibleRouteDistance
    }))
  };
};

export const inspectCameraDesign = async ({ workspaceRoot, workOrder, candidate, previousTreatment }) => {
  const measurement = measureCameraDesign({
    treatment: candidate?.result?.treatment,
    featureResults: candidate?.result?.featureResults,
    templateContext: workOrder?.inputs?.templateContext,
    cues: workOrder?.inputs?.cues,
    previousTreatment
  });
  if (!measurement.ok) {
    await removeFullframeCameraFinalLock({ workspaceRoot, task: workOrder });
    return measurement;
  }
  if (!candidate.result.treatment.assetRequests.every(request => request.asset)) {
    await removeFullframeCameraFinalLock({ workspaceRoot, task: workOrder });
    return { ...measurement, cameraLockWritten: false };
  }
  await writeFullframeCameraFinalLock({
    workspaceRoot, task: workOrder, candidateResult: candidate.result,
    templateContext: workOrder.inputs?.templateContext
  });
  return { ...measurement, cameraLockWritten: true };
};
