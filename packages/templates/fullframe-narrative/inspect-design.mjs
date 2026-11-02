#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {completeTreatmentCandidate, validateTreatmentCandidate} from '../../modules/author-beat/candidate-validation.mjs';

import { verifyAuthoredImage } from "../../authored-images.mjs";
import { assertEffectAnchors } from "./effects/runtime.mjs";
import { renderCandidateCamera } from "./camera/realization.mjs";
import { readData, atomicWriteData, withoutProducer, hashObject, assertProjectPath } from "../../program-utils.mjs";
import { inspectCameraDesign, measureCameraDesign } from "./camera/inspect-design.mjs";
import { getEpisodePaths, getProgramPaths } from "../../workspace-paths.mjs";
import { inspectP3Input } from "../../../engine/p3-input.mjs";
import { authorUnitsForStoryboard } from "../../../engine/runtime/storyboard.mjs";
import { cueSlice, projectAuthorBeat, projectAuthorUnitSemantics } from "../../modules/author-beat/projection.mjs";
import { readResult as readCueSyncResult } from "../../features/cue-sync/validate-runtime.mjs";
import { resolveCueBoundary } from "../../cue-boundaries.mjs";
import { projectAuthorContext, projectAdjacentTreatment, readPreviousTreatment } from "./context-runtime.mjs";
import { fullframeTransitionHandoffForAuthorUnit } from "./camera/author-transition-handoff.mjs";
import {
  assertFullframeDesignStage,
  removeFullframeCameraFinalLock
} from "./camera/design-lock.mjs";
import { assertFullframeDesignTask, completeFullframeRepresentation } from "./task-contract.mjs";
import { validateFullframeDesignSemantics } from "./validate.mjs";
import { fullframeAuthorViews } from "./author-batch.mjs";
import { projectTreatmentWithoutCallouts } from "./callout/projection.mjs";

const clearDesignLocks = ({ workspaceRoot, workOrder }) =>
  removeFullframeCameraFinalLock({ workspaceRoot, task: workOrder });

const feedbackInputsDigest = async (workspaceRoot, view) => hashObject({
  taskDigest: view.workOrder.taskDigest,
  treatment: projectTreatmentWithoutCallouts(completeFullframeRepresentation(view.candidate.result).treatment),
  bindings: view.candidate.result.featureResults?.["cue-sync"]?.items?.filter(item => item.action !== "show-callout")
    .sort((left, right) => left.target.localeCompare(right.target) || left.action.localeCompare(right.action)),
  previousTreatment: await readPreviousTreatment({ workspaceRoot, task: view.workOrder }),
  cues: view.workOrder.inputs.cues,
  motionBudgets: view.workOrder.inputs.templateContext.motionBudgets,
  incomingTransitionSupported: view.workOrder.inputs.templateContext.incomingTransitionSupported
});

const feedbackDirectory = async (workspaceRoot, workOrder) => {
  if (!workOrder.scratchPath || path.isAbsolute(workOrder.scratchPath)) throw new Error("当前工作单缺少临时目录");
  const directory = path.resolve(workspaceRoot, workOrder.scratchPath, "design-feedback");
  await assertProjectPath({ root: path.join(getEpisodePaths(workspaceRoot, workOrder.subject.id).p3, "_work"),
    file: directory, label: "当前测量反馈" });
  return directory;
};

// The saved object is a tool result for reading, never a candidate or acceptance receipt.
export const readFullframeDesignFeedback = async ({ workOrderPath, candidatePath, feedbackPath, beatIds = [] }) => {
  const [workOrder, candidate] = await Promise.all([readData(path.resolve(workOrderPath)), readData(path.resolve(candidatePath))]);
  const workspaceRoot = assertFullframeDesignTask({ workOrder, candidate, candidatePath });
  const directory = await feedbackDirectory(workspaceRoot, workOrder);
  const file = path.resolve(feedbackPath);
  await assertProjectPath({ root: directory, file, label: "当前测量反馈" });
  const saved = await readData(file);
  if (saved.taskDigest !== workOrder.taskDigest || path.basename(file) !== `${hashObject(saved)}.json`)
    throw new Error("测量反馈不属于当前任务或原件已变化");
  const selected = beatIds.length ? beatIds : Object.keys(saved.inputs);
  for (const id of selected) if (!saved.inputs[id]) throw new Error(`反馈没有Beat ${id}`);
  const views = await fullframeAuthorViews({ workspaceRoot, workOrder, candidate, beatIds: selected });
  for (const view of views) {
    const id = view.workOrder.inputs.authorUnit.id;
    if (!selected.includes(id) || saved.inputs[id] !== await feedbackInputsDigest(workspaceRoot, view))
      throw new Error(`${id} 设计或前序接缝已改变，重新测量受影响范围`);
  }
  if (!workOrder.inputs.authorBatch) return saved.result;
  const beats = saved.result.beats.filter(beat => selected.includes(beat.beatId));
  return { ...saved.result, ok: beats.every(beat => beat.ok), beats,
    inspectedBeatIds: beats.map(beat => beat.beatId) };
};

export const inspectFullframeDesign = async ({ workOrderPath, candidatePath, clipRequestId = null,
  beatIds = [], saveFeedback = false, bgmSourceAssetId = null, muteEffects = false }) => {
  const resolvedWorkOrderPath = path.resolve(workOrderPath);
  const resolvedCandidatePath = path.resolve(candidatePath);
  const [workOrder, candidate] = await Promise.all([
    readData(resolvedWorkOrderPath),
    readData(resolvedCandidatePath)
  ]);
  completeTreatmentCandidate({candidateResult:candidate.result, context:workOrder.inputs});
  const workspaceRoot = assertFullframeDesignTask({
    workOrder,
    candidate,
    candidatePath: resolvedCandidatePath
  });
  // A Feature repair previews the locked picture; it does not rerun picture
  // measurement, refresh locks, or write inherited cue-sync into the candidate.
  if (workOrder.inputs.repairFeatureIds?.length) {
    if (!clipRequestId || saveFeedback || beatIds.length) throw new Error('功能返工只用--clip预览原画面，不重做画面测量');
    const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const implementations = workOrder.resolvedAssembly.slots.flatMap(slot => slot.implementations);
    const {errors} = await validateTreatmentCandidate({candidateResult:candidate.result,
      context:workOrder.inputs, task:workOrder, systemRoot, workspaceRoot, episodeId:workOrder.subject.id,
      moduleValidatorSource:workOrder.validator.source,
      templateImplementation:implementations.find(item => item.packageId === 'fullframe-narrative'),
      featureImplementations:implementations.filter(item => item.kind === 'feature')});
    if (errors.length) throw new Error(errors.join('；'));
    return {ok:true, realImages:await renderCandidateCamera({workspaceRoot, systemRoot, workOrder,
      candidate, clipRequestId, bgmSourceAssetId, muteEffects})};
  }
  const batchIds = workOrder.inputs.authorBatch?.members.map(member => member.beatId)
    ?? [workOrder.inputs.authorUnit.id];
  const requested = clipRequestId && workOrder.inputs.authorBatch ? [clipRequestId.split("/")[0]] : beatIds;
  if (clipRequestId && beatIds.length) throw new Error("clip已限定目标，不同时指定Beat范围");
  for (const id of requested) if (!batchIds.includes(id)) throw new Error(`当前工作单没有Beat ${id}`);
  // A changed Beat can affect the next entrance even when it starts a new camera.
  const nextIds = clipRequestId ? [] : (workOrder.inputs.authorBatch?.members ?? [])
    .filter(member => requested.includes(member.beatId)).map(member => member.inputs.nextAuthorUnit?.id);
  const selected = batchIds.filter(id => !requested.length || requested.includes(id) || nextIds.includes(id));
  if (clipRequestId) {
    const [beatId, requestId, extra] = workOrder.inputs.authorBatch ? clipRequestId.split("/")
      : [batchIds[0], clipRequestId];
    const treatment = workOrder.inputs.authorBatch
      ? candidate.result.items.find(item => item.beatId === beatId)?.treatment : candidate.result.treatment;
    if (extra || !treatment?.assetRequests.some(request => request.requestId === requestId))
      throw new Error("clip必须指定当前Beat/AR编号；单Beat只指定AR编号");
  }
  if (workOrder.inputs.authorBatch) {
    candidate.result.items = candidate.result.items.map(({ beatId, ...result }) => ({
      beatId, ...(selected.includes(beatId) ? completeFullframeRepresentation(result) : result)
    }));
  } else candidate.result = completeFullframeRepresentation(candidate.result);
  const views = await fullframeAuthorViews({ workspaceRoot, workOrder, candidate, beatIds: selected });
  const results = [];
  for (const view of views) {
    const selectedClip = view.item
      ? clipRequestId?.startsWith(`${view.item.beatId}/`) ? clipRequestId.split("/")[1] : null : clipRequestId;
    const feedback = await inspectDesignView({ workspaceRoot, workOrder: view.workOrder,
      candidate: view.candidate, clipRequestId: selectedClip, bgmSourceAssetId, muteEffects });
    if (view.item) Object.assign(view.item, view.candidate.result);
    if (feedback.ok) await atomicWriteData(resolvedCandidatePath, candidate);
    results.push({ ...(view.item ? { beatId: view.item.beatId } : {}), ...feedback });
  }
  const result = workOrder.inputs.authorBatch ? { ok: results.every(result => result.ok), beats: results,
    inspectedBeatIds: selected, batchBeatIds: batchIds } : results[0];
  if (!saveFeedback) return result;
  const saved = JSON.parse(JSON.stringify({ taskDigest: workOrder.taskDigest,
    inputs: Object.fromEntries(await Promise.all(views.map(async view =>
      [view.workOrder.inputs.authorUnit.id, await feedbackInputsDigest(workspaceRoot, view)]))), result }));
  const file = path.join(await feedbackDirectory(workspaceRoot, workOrder), `${hashObject(saved)}.json`);
  await atomicWriteData(file, saved);
  return { ok: result.ok, feedbackPath: file, inspectedBeatIds: selected, batchBeatIds: batchIds,
    reviewAction: "read-complete-beat-feedback", beats: results.map(({ beatId, ok, failures }) => ({ beatId, ok, ...(failures ? { failures } : {}) })) };
};

const inspectDesignView = async ({ workspaceRoot, workOrder, candidate, clipRequestId, bgmSourceAssetId, muteEffects }) => {
  candidate.result = completeFullframeRepresentation(candidate.result);
  try {
    assertFullframeDesignStage(candidate.result);
  } catch (error) {
    await clearDesignLocks({ workspaceRoot, workOrder });
    throw error;
  }
  let previousTreatment;
  try {
    previousTreatment = await readPreviousTreatment({ workspaceRoot, task: workOrder });
  } catch (error) {
    await clearDesignLocks({ workspaceRoot, workOrder });
    throw error;
  }
  const semanticErrors = validateFullframeDesignSemantics({
    result: candidate.result.treatment,
    context: {
      ...workOrder.inputs,
      previousTreatment,
      featureResults: candidate.result.featureResults
    }
  });
  if (semanticErrors.length) {
    await clearDesignLocks({ workspaceRoot, workOrder });
    throw new Error(semanticErrors.join("; "));
  }
  const imagesReady = candidate.result.treatment.assetRequests.every(request => request.asset);
  if (imagesReady) for (const request of candidate.result.treatment.assetRequests) {
    await verifyAuthoredImage({asset:request.asset,workspaceRoot,episodeId:workOrder.subject.id,
      stageId:"p3",unitId:workOrder.inputs.authorUnit.id});
    assertEffectAnchors({request,anchors:request.effectAnchors,required:true});
  }
  const result = await inspectCameraDesign({
    workspaceRoot,
    workOrder,
    candidate,
    previousTreatment
  });
  if (!result.ok) return result;
  const feedback = viewingFeedback(result, candidate.result.treatment);
  if (imagesReady) try {
    feedback.realImages = await renderCandidateCamera({workspaceRoot,
      systemRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../.."),workOrder,candidate,clipRequestId,
      bgmSourceAssetId, muteEffects});
  } catch (error) {
    if (!error.audioPlaybackFailure) await clearDesignLocks({workspaceRoot,workOrder});
    throw error;
  }
  return feedback;
};

const viewingFeedback = (result, treatment) => {
  if (!result.ok) return result;
  const { targets, ...measurementResult } = result;
  return {
    reviewAction: "review-visible-composition",
    targets: targets.map((measurement, index) => {
      const request = treatment.assetRequests[index];
      const { target, ...metrics } = measurement;
      return {
        target,
        design: {
          ...(request.asset ? {asset:request.asset, effectAnchors:request.effectAnchors} : {}),
          purpose: request.purpose,
          sceneDescription: request.sceneDescription,
          sourceRefs: request.sourceRefs,
          mustNotInvent: request.mustNotInvent,
          ...(request.exactTexts ? { exactTexts: request.exactTexts } : {}),
          acceptanceCriteria: request.acceptanceCriteria,
          attentionPlan: request.attentionPlan,
          ...(request.effects ? { effects: request.effects } : {})
        },
        visibleComposition: measurement.visibleRouteViewports.map((viewport) => ({
          viewport,
          imageBounds: { left: viewport.x, top: viewport.y,
            right: viewport.x + viewport.width, bottom: viewport.y + viewport.height },
          magnification: 1 / viewport.width
        })),
        ...metrics
      };
    }),
    ...measurementResult
  };
};

// This adapter reads accepted inputs only. Candidate normalization, design
// assertions and lock writes remain exclusively in inspectFullframeDesign.
export const inspectFinalStoryboard = async ({ workspaceRoot, episodeId, beatIds = [] }) => {
  const root = path.resolve(workspaceRoot);
  const [rawStoryboard, programPlan, inspected] = await Promise.all([
    readData(getEpisodePaths(root, episodeId).storyboard),
    readData(getProgramPaths(root).programPlan),
    inspectP3Input({ root, episodeId })
  ]);
  const storyboard = withoutProducer(rawStoryboard);
  const authorUnits = authorUnitsForStoryboard(storyboard);
  const fullframeUnits = authorUnits.filter((unit) => unit.templateId === "fullframe-narrative");
  for (const id of beatIds) {
    if (!fullframeUnits.some((unit) => unit.id === id)) throw new Error(`没有可读取的全画幅 Beat: ${id}`);
  }
  const selected = fullframeUnits.filter((unit) => !beatIds.length || beatIds.includes(unit.id));
  const sourceById = new Map([
    ...inspected.cues.map((cue) => ({ ...cue, id: `C${String(cue.id).padStart(3, "0")}` })),
    ...storyboard.understanding.facts, ...storyboard.understanding.relations,
    ...storyboard.understanding.evidence, ...inspected.sourceAssets
  ].map((item) => [item.id, item]));
  const beats = selected.map((unit) => {
    const treatment = unit.treatment;
    if (treatment?.templateId !== "fullframe-narrative") throw new Error(`${unit.id} 尚无正式全画幅设计`);
    const cues = cueSlice(inspected.cues, unit.beat.cueRange);
    const cueSync = readCueSyncResult({ storyboard, scope: { featureId: "cue-sync", beatId: unit.id } });
    if (!cueSync) throw new Error(`${unit.id} 缺少正式 cue-sync 结果`);
    const templateContext = projectAuthorContext({
      programPlan, authorUnits, cues, episodeCues: inspected.cues,
      albumPlan: storyboard.albumPlan, acceptedBeats: storyboard.beats,
      acceptedFeatures: storyboard.features, beforeBeatId: unit.id
    });
    const previousUnit = authorUnits[authorUnits.indexOf(unit) - 1];
    const transitionHandoff = fullframeTransitionHandoffForAuthorUnit({
      previousAuthorUnit: previousUnit, currentAuthorUnit: unit, authorUnits,
      storyboard, cues: inspected.cues, openerTemplate: programPlan.openerTemplate
    });
    const previousTreatment = transitionHandoff
      ? projectAdjacentTreatment(previousUnit.treatment, { transitionHandoff }) : null;
    const feedback = viewingFeedback(measureCameraDesign({
      treatment, featureResults: { "cue-sync": cueSync }, templateContext, cues, previousTreatment
    }), treatment);
    const sources = new Map();
    const includeSource = (id) => {
      if (sources.has(id)) return;
      const source = sourceById.get(id);
      if (!source) throw new Error(`${unit.id} 无法展开来源 ${id}`);
      sources.set(id, source);
      for (const cueId of source.cueRefs ?? []) includeSource(`C${String(cueId).padStart(3, "0")}`);
      for (const evidenceId of source.evidenceRefs ?? []) includeSource(evidenceId);
      for (const assetId of source.sourceAssetRefs ?? []) includeSource(assetId);
    };
    for (const request of treatment.assetRequests) for (const ref of request.sourceRefs) includeSource(ref);
    const pictureStarts = treatment.assetRequests.map((request) => {
      const binding = cueSync.items.find((item) => item.target === request.requestId
        && ["start-frame-motion", "dissolve-in"].includes(item.action));
      if (!binding) throw new Error(`${unit.id}/${request.requestId} 缺少正式图片 Cue 绑定`);
      return resolveCueBoundary({ ...binding, cues }).timeMs;
    });
    return {
      beat: projectAuthorBeat(unit.beat), cues,
      semanticContext: projectAuthorUnitSemantics({ understanding: storyboard.understanding, beats: unit.beats, cues: inspected.cues }),
      sources: Object.fromEntries(sources),
      continuity: treatment.continuity,
      previousPicture: previousUnit ? {
        unitId: previousUnit.id, templateId: previousUnit.templateId,
        ...(previousTreatment ? { design: previousUnit.treatment.assetRequests.at(-1) } : {})
      } : null,
      ...feedback,
      ...(feedback.targets ? { targets: feedback.targets.map((target, index) => ({
        ...target,
        frameId: treatment.assetRequests[index].frameId,
        motion: treatment.assetRequests[index].motion,
        cameraRelation: treatment.assetRequests[index].cameraRelation,
        cueBinding: cueSync.items.find((item) => item.target === target.target
          && ["start-frame-motion", "dissolve-in"].includes(item.action)),
        playbackCues: cues.filter((cue) => cue.endMs > pictureStarts[index]
          && cue.startMs < (pictureStarts[index + 1] ?? cues.at(-1).endMs))
      })) } : {})
    };
  });
  return {
    mode: "final-storyboard-read-only", episodeId,
    fullframeBeatIds: fullframeUnits.map((unit) => unit.id),
    selectedBeatIds: selected.map((unit) => unit.id),
    episodeContext: {
      cues: inspected.cues, albumPlan: storyboard.albumPlan,
      beats: storyboard.beats.map(projectAuthorBeat)
    },
    beats, ok: beats.every((beat) => beat.ok)
  };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const run = async () => {
    const args = process.argv.slice(2);
    if (args[0]?.startsWith("--")) {
      const { values } = parseArgs({ args, options: {
        workspace: { type: "string" }, episode: { type: "string" },
        beat: { type: "string", multiple: true }
      } });
      if (!values.workspace || !values.episode) throw new Error("正式分镜只读用法: inspect-design.mjs --workspace <节目目录> --episode <epNN> [--beat B001 ...]");
      return inspectFinalStoryboard({ workspaceRoot: values.workspace, episodeId: values.episode, beatIds: values.beat });
    }
    const [workOrderPath, candidatePath, ...options] = args;
    if (!workOrderPath || !candidatePath) throw new Error("创作测量用法: inspect-design.mjs <workOrderPath> <candidatePath>");
    const { values } = parseArgs({ args: options, options: {
      clip: { type: "string" }, beat: { type: "string", multiple: true },
      "bgm-source": {type:"string"}, "mute-effects": {type:"boolean"},
      "save-feedback": { type: "boolean" }, "read-feedback": { type: "string" }
    } });
    if (values["read-feedback"]) {
      if (values.clip || values["save-feedback"]) throw new Error("读取反馈不重新测量或制作clip");
      return readFullframeDesignFeedback({ workOrderPath, candidatePath, feedbackPath: values["read-feedback"], beatIds: values.beat });
    }
    return inspectFullframeDesign({ workOrderPath, candidatePath, clipRequestId: values.clip,
      beatIds: values.beat, saveFeedback: values["save-feedback"], bgmSourceAssetId:values["bgm-source"],
      muteEffects:values["mute-effects"] });
  };
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
