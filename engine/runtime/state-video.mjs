import {videoIsEnabled} from './video-settings.mjs';
import { projectVideoProduction } from "../../packages/templates/cinematic-video/production-projection.mjs";
import { episodeReferenceVideos } from "../../packages/reference-program.mjs";
import { readAcceptedNarrationEvidence } from "../p1-revision-materials.mjs";
import { readStageRestart, restartPending } from "./stage-restart.mjs";
import { validateSchema } from "./schema.mjs";
import { assertP3DirectorRevisionRequest } from "./storyboard.mjs";
import { validate as validateVideoPlan } from "../../packages/templates/cinematic-video/validate.mjs";
import { validateDelivery } from "../../packages/modules/produce-video-assets/delivery.mjs";

import { resolveRenderAssetHandoff } from "./asset-handoff.mjs";

import path from "node:path";
import { authorSegmentId, getEpisodePaths, getProgramPaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { hashObject, readData } from "../../packages/program-utils.mjs";
import { projectRenderStoryboard } from "../../packages/modules/render-video/runtime/projection.mjs";
import { EXPLAINER_TEMPLATE_IDS } from "../../packages/explainer-template-selection.mjs";
import { programOpenerTemplateId } from "../../packages/opener-template-selection.mjs";
import { WorkflowInputError, assertProjectPaths, exists } from "./files.mjs";
import { P3_BODY_REDESIGN_SCOPE, assertP3BodyRedesignPreservesVisualPlan, assertP3BodyRedesignRequest, authorUnitsForStoryboard, businessContent, directorResultSlice, enabledFeatureIdsForNode, selectedSourceAssetHashes } from "./storyboard.mjs";

import { loadSelectedVisualForModel, loadStageModel } from "./model.mjs";
import {
  controllerDescriptorForNode,
  prepareNodeAssembly
} from "./implementations.mjs";
import {
  inspectP3Inputs,
  missingAuthorFeatures
} from "./storyboard-validation.mjs";
import { aiTask, programInvocationTask, programTask } from "./tasks.mjs";

import {
  renderVisualContext,
  sourceAssetsDigest
} from "./visual-inputs.mjs";
import {
  buildAuthorTask,
  buildAuthorQuoteTask,
  buildSegmentTask,
  controllerInputs
} from "./author-tasks.mjs";

import { buildUnderstandingTask, buildVisualDirectorTask, buildVideoTask } from "./design-tasks.mjs";
import { collectQuoteRequests, projectResolvedQuotes, quoteBatchInputs, resolveQuoteDecisions, retainedQuoteEvidence } from "../../packages/templates/fullframe-narrative/callout/batch.mjs";
import { P3_QUOTE_REVISION_SCOPE, assertP3QuoteRevisionRequest } from "./quote-revision-contract.mjs";

export const authorSegmentProgress = ({ storyboard, completedUnitIds, currentUnitId = null }) => {
  const segments = (storyboard.templateRuns ?? []).map(run => ({
    id: run.id,
    unitIds: run.templateId === "fullframe-narrative" ? run.beatIds : [run.id]
  }));
  return {
    unit: "segment",
    beatCount: storyboard.beats.filter(beat => beat.templateId === "fullframe-narrative").length,
    total: segments.length,
    completed: segments.filter(segment => segment.unitIds.every(id => completedUnitIds.has(id))).length,
    currentUnitId: segments.find(segment => segment.unitIds.includes(currentUnitId))?.id ?? null
  };
};

const readVideoArtifact = async ({ root, file, schema, moduleId, nodeId }) => {
  const artifact = await readData(file);
  await validateSchema(path.join(root, "contracts", schema), artifact, file);
  if (artifact._producer?.moduleId !== moduleId || artifact._producer?.nodeId !== nodeId
    || artifact._producer.outputSha256 !== hashObject(businessContent(artifact)))
    throw new Error(`${file} 缺少正确的正式接纳来源或内容摘要`);
  return artifact;
};
const resolveVideoCurrent = async ({
  root,
  workspaceRoot = root,
  episodeId,
  targetId = "release-main",
  segmentId = null,
  nodeId = null,
  model = null,
  resourceCache = model?.resourceCache ?? new Map(),
  consumerOnly = false,
  storyboardOverride = undefined,
  previewSegmentIds = null,
  previewPart = null
}) => {
  const isolatedPreview = Boolean(previewSegmentIds || previewPart);
  if (targetId !== "release-main") throw new Error("唯一交付目标必须是 release-main");
  if (!model?.stageId) {
    let current = null;
    for (const stageId of ["p3", "p4"]) {
      current = await resolveVideoCurrent({
        root,
        workspaceRoot,
        episodeId,
        targetId,
        consumerOnly,
        model: await loadStageModel(root, { stageId, resourceCache,
          resourceScope:"stage" })
      });
      if (current.kind !== "complete") return current;
    }
    return current;
  }
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const videoEnabled=model.stageId==='p4'&&await videoIsEnabled({workspaceRoot,episodeId});
  if(nodeId&&["video","video-assets"].includes(nodeId)&&!videoEnabled)return {kind:"node-disabled",nodeId,stageId:model.stageId,reason:"剧情视频未启用，只有用户明确要求才执行"};
  model = { ...model, stageRestart: await readStageRestart({ workspaceRoot, episodeId, stageId: model.stageId }) };
  const stageWorkPaths = getStageWorkPaths(paths, model.stageId);


  let videoPlan = null;
  let currentVideoPlan = null;
  const videoDesignReturned = await exists(getStageWorkPaths(paths, "p4").returnRequest("video"));
  if (videoEnabled && ["p4"].includes(model.stageId) && !videoDesignReturned && await exists(paths.videoPlan)) {
    videoPlan = await readVideoArtifact({ root, file: paths.videoPlan, schema: "cinematic-video-plan.schema.json", moduleId: "author-video", nodeId: "video" });
  }
  if (videoEnabled && model.stageId === "p4" && videoDesignReturned && !model.stageRestart && await exists(paths.videoPlan)) {
    currentVideoPlan = await readVideoArtifact({ root, file: paths.videoPlan, schema: "cinematic-video-plan.schema.json", moduleId: "author-video", nodeId: "video" });
  }
  const workPaths = getStageWorkPaths(paths, model.stageId);
  const stagePathGroups = {
    p3: [getStageWorkPaths(paths, "p3").work, paths.storyboard],
    p4: [getStageWorkPaths(paths, "p4").work, paths.episodePackage, paths.videoPlan, paths.videoManifest,
      paths.renderReceipt, paths.finalVideo]
  };
  const stageOrder = ["p3", "p4"];
  const lastStageIndex = stageOrder.indexOf(model.stageId ?? "p4");
  await assertProjectPaths({
    root: workspaceRoot,
    label: "Video Workflow 当前阶段路径",
    files: stageOrder.slice(0, lastStageIndex + 1).flatMap((stageId) => stagePathGroups[stageId])
  });
  let bodyModel = model;
  if (model.stageId === "p4") {
    bodyModel = await loadStageModel(root, { stageId: "p3", resourceCache });
  }
  let programPlan = null;
  if (["p3", "p4"].includes(model.stageId)) {
    try {
      programPlan = businessContent(await readData(getProgramPaths(workspaceRoot).programPlan));
    } catch (error) {
      return {
        kind: "blocked-upstream",
        upstreamStageId: "p0",
        nodeId: "plan-program",
        reason: `P3无法读取现行P0节目真源: ${error.message}`
      };
    }
  }
  const p1OpenerNarrationFor = async (segmentType) => {
    if (model.stageId !== "p4" || segmentType !== "opener") return null;
    try {
      const artifact = await readData(paths.openerNarration);
      return businessContent(artifact).openerNarration;
    } catch (cause) {
      throw new WorkflowInputError({
        workflowId: model.workflowRecord.id,
        stageId: "p3",
        nodeId: "opener",
        upstreamStageId: "p1",
        cause
      });
    }
  };
  const returnRequests = new Map();
  for (const node of model.orderedNodes) {
    if (isolatedPreview) continue;
    const requestPath = workPaths.returnRequest(node.id);
    if (!(await exists(requestPath))) continue;
    const request = await readData(requestPath);
    if (request.target !== node.id) throw new Error(`上游退回控制记录的 target 必须是 ${node.id}`);
    if (typeof request.reason !== "string" || !request.reason.trim())
      throw new Error(`上游退回 ${node.id} 缺少 reason`);
    const isP3BodyRedesign =
      node.id === "author" && request.revisionScope === P3_BODY_REDESIGN_SCOPE;
    if (isP3BodyRedesign) {
      assertP3BodyRedesignRequest(request);
    } else if (node.id === "author" && request.revisionScope === P3_QUOTE_REVISION_SCOPE) {
      assertP3QuoteRevisionRequest(request);
    } else if (node.id === "director" && request.revisionScope === "director-revision") {
      assertP3DirectorRevisionRequest(request);
    } else if (request.revisionScope != null) {
      throw new Error(`Video Workflow 不支持的定点返工范围: ${request.revisionScope}`);
    } else if (
      !Array.isArray(request.cueRefs) ||
      request.cueRefs.some((id) => !Number.isInteger(id) || id < 1)
    ) {
      throw new Error(`上游退回 ${node.id} 的 cueRefs 非法`);
    }
    returnRequests.set(node.id, request);
  }
  const p3Revision = returnRequests.get("author") ?? null;
  const p3DirectorRevision = returnRequests.get("director")?.revisionScope === "director-revision"
    ? returnRequests.get("director") : null;
  const p3BodyRedesign = p3Revision?.revisionScope === P3_BODY_REDESIGN_SCOPE ? p3Revision : null;
  const p3QuoteRevision = p3Revision?.revisionScope === P3_QUOTE_REVISION_SCOPE ? p3Revision : null;
  let inspected;
  try {
    inspected = await inspectP3Inputs(root, workspaceRoot, episodeId);
  } catch (error) {
    if (
      error.message.includes("narration-package") ||
      error.message.includes(`${path.sep}p2${path.sep}`)
    ) {
      return {
        kind: "blocked-upstream",
        upstreamStageId: "p2",
        nodeId: "finalize-narration",
        reason: `当前阶段无法读取 P2 正式口播交接: ${error.message}`
      };
    }
    if (
      error.message.includes("source-assets") ||
      error.message.includes(`${path.sep}input${path.sep}`)
    ) {
      if (model.stageId !== "p3") {
        return {
          kind: "blocked-upstream",
          upstreamStageId: "p3",
          nodeId: "understand",
          reason: `当前阶段无法读取 P3 已核验来源资产: ${error.message}`
        };
      }
      const mayInitializeMissingSourceAssets =
        error?.code === "ENOENT" && error.message.includes(paths.sourceAssets);
      return {
        kind: mayInitializeMissingSourceAssets ? "initialization-required" : "blocked-upstream",
        ...(mayInitializeMissingSourceAssets ? {} : { upstreamStageId: "p3" }),
        nodeId: "understand",
        ...(mayInitializeMissingSourceAssets
          ? {
              initializeMissingSourceAssets: true,
              reason: "P3 系统入口将在 next 时建立空来源资产清单后继续预检"
            }
          : {
              hardFailure: true,
              reason: `P3 当前输入无效: ${error.message}`
            })
      };
    }
    throw error;
  }
  let visualPackage = null;
  let storyboard =
    storyboardOverride === undefined
      ? (await exists(paths.storyboard))
        ? await readData(paths.storyboard)
        : null
      : storyboardOverride;
  if (p3QuoteRevision) assertP3QuoteRevisionRequest(p3QuoteRevision, storyboard);
  if (p3BodyRedesign && storyboard?.albumPlan) {
    assertP3BodyRedesignPreservesVisualPlan({
      baselineSha256: p3BodyRedesign.baselineVisualPlanSha256,
      candidateSha256: hashObject(directorResultSlice(storyboard))
    });
  }
  if (p3DirectorRevision) assertP3DirectorRevisionRequest(p3DirectorRevision, directorResultSlice(storyboard));
  if (model.stageId !== "p3" && !storyboard) {
    return {
      kind: "blocked-upstream",
      upstreamStageId: "p3",
      nodeId: "opener",
      reason: "当前阶段缺少 P3 正式 storyboard.yaml"
    };
  }
  let packagingFailure = null;
  const quoteContext = { notebookId: programPlan?.researchLibrary?.notebookId, cues: inspected.cues };
  if (!quoteContext.notebookId && storyboard?.authorQuotes && collectQuoteRequests(storyboard)
    .some(({ id }) => !storyboard.authorQuotes.items.some((item) => item.id === id))) {
    quoteContext.notebookId = (await readData(getProgramPaths(workspaceRoot).programPlan)).researchLibrary?.notebookId;
  }
  if (model.stageId !== "p3") storyboard = projectResolvedQuotes(storyboard, quoteContext);
  if (previewPart) previewSegmentIds = previewPart === "body" ? storyboard.beats.map(beat => beat.id) : ["opener"];
  if (previewPart === "body") {
    const { opener, ...bodyStoryboard } = storyboard;
    storyboard = bodyStoryboard;
  }
  if (model.stageId !== "p3" && previewPart !== "body") {
    try {
      const packaging = await readData(paths.episodePackage);
      storyboard = { ...storyboard, opener: packaging.opener };
    } catch (error) {
      packagingFailure = error.code === "ENOENT" ? "尚无正式片头设计" : error.message;
      if ((consumerOnly || model.stageId !== "p4") && (!isolatedPreview || previewSegmentIds.includes("opener")))
        return {
          kind: "blocked-upstream",
          upstreamStageId: "p4",
          nodeId: "opener",
          reason: packagingFailure
        };
    }
  }
  let videoManifest = null;
  let videoManifestFailure = null;

  if (["p4"].includes(model.stageId) && videoPlan) {
    if (videoDesignReturned) return {
      kind: "blocked-upstream", upstreamStageId: "p4", nodeId: "video", reason: "当前阶段需要已接纳剧情视频设计（允许空选）"
    };
    const errors = validateVideoPlan({ result: videoPlan, context: { storyboard, cues: inspected.cues,
      sourceAssets: inspected.sourceAssets, preview: isolatedPreview } });
    if (errors.length) return { kind: "blocked-upstream", upstreamStageId: "p4", nodeId: "video", reason: errors.join("; ") };
    if (!await exists(getStageWorkPaths(paths, "p4").returnRequest("video-assets")) && await exists(paths.videoManifest)) {
      try {
        videoManifest = await readVideoArtifact({ root, file: paths.videoManifest, schema: "video-manifest.schema.json", moduleId: "produce-video-assets", nodeId: "video-assets" });
      } catch (error) {
        if (model.stageId !== "p4") throw error;
        videoManifestFailure = error.message;
      }
    }

  }

  const state = {
    understandingVerified:false, visualPlanVerified:model.stageId !== "p3",
    validatedTreatments:new Set(), validatedSegments:new Set(), renderTask:null
  };
  const requireStage = (condition, node, label) => {
    if (!condition) throw new Error(`Workflow 节点 ${node.id} 缺少前置成果: ${label}`);
  };
  const beatItems = (storyboard?.beats ?? []).map((beat) => ({ beat }));
  let authorUnitItems;
  let authorSegments = null;
  const orderedAuthorUnits = () =>
    (authorUnitItems ??= authorUnitsForStoryboard(storyboard).map((authorUnit) => ({
      authorUnit
    })));
  const authorUnitProgress = ({ currentUnitId = null, pendingUnitIds = null } = {}) => {
    if (model.stageId !== "p3" || !state.visualPlanVerified) return null;
    const unitIds = orderedAuthorUnits().map(({ authorUnit }) => authorUnit.id);
    const completedUnitIds = pendingUnitIds
      ? new Set(unitIds.filter(id => !pendingUnitIds.includes(id)))
      : p3BodyRedesign
        ? new Set(orderedAuthorUnits().filter(({ authorUnit }) => authorUnit.treatment
          && !p3BodyRedesign.pendingAuthorUnitIds.includes(authorUnit.id)).map(({ authorUnit }) => authorUnit.id))
        : state.validatedTreatments;
    return authorSegmentProgress({ storyboard, completedUnitIds, currentUnitId });
  };
  const withAuthorUnitProgress = (current, options = {}) => {
    if (Object.hasOwn(current, "authorUnitProgress")) return current;
    const progress = authorUnitProgress(options);
    return progress ? { ...current, authorUnitProgress: progress, ...(authorSegments ? { authorSegments } : {}) } : current;
  };
  const allBodyTreatmentsVerified = () => {
    if (model.stageId !== "p3") return true;
    const units = orderedAuthorUnits();
    return (
      units.length > 0 &&
      units.every(({ authorUnit }) => state.validatedTreatments.has(authorUnit.id))
    );
  };
  const prepareFor = async (node, item = null) => {
    const record = model.packages.get(node.moduleId);
    const needsVisual = (record?.manifest?.slots ?? []).some(
      (slot) => slot.selectionSource === "program-visual"
    );
    if (needsVisual && !visualPackage) {
      visualPackage = await loadSelectedVisualForModel({
        root,
        workspaceRoot,
        model,
        storyboard: storyboard ?? {}
      });
    }
    const selectedOpenerTemplateId =
      node.id === "opener"
        ? programOpenerTemplateId(programPlan)
        : null;
    return prepareNodeAssembly({
      model,
      node,
      storyboard: storyboard ?? {},
      selection: {
        ...(visualPackage ? { visualPackageId: visualPackage.id } : {}),
        ...(node.moduleId === "direct-episode"
          ? {
              templateCatalogIds: ["fullframe-narrative", ...EXPLAINER_TEMPLATE_IDS]
            }
          : {}),
        ...(selectedOpenerTemplateId ? { segmentTemplateId: selectedOpenerTemplateId } : {}),
        ...(item?.authorUnit?.templateId
          ? { beatTemplateId: item.authorUnit.templateId }
          : item?.beat?.templateId
            ? { beatTemplateId: item.beat.templateId }
            : {})
      }
    });
  };
  const nodeEnabled = ({ node, assembly }) => {
    if (node.condition === "always") return true;
    if (node.condition === "video-enabled") return videoEnabled;
    requireStage(state.visualPlanVerified, node, "Visual Director 已接纳的功能与片段启用键");
    if (node.condition === "input-present") return Object.hasOwn(storyboard, node.scope);
    if (node.condition === "slot-filled") {
      return assembly.slots.some((slot) => slot.implementations.length > 0);
    }
    throw new Error(`Workflow 节点 ${node.id} 使用未知条件: ${node.condition}`);
  };
  const allowedReturnTargetsFor = async ({ node, descriptor }) => {
    const policies = descriptor.returnTo ?? [];
    if (!Array.isArray(policies))
      throw new Error(`${node.moduleId} controller.prepare.returnTo 必须是数组`);
    const fullWorkflow = model.workflowModel.workflowById.get(model.workflowRecord.id);
    const ancestors = fullWorkflow.ancestorsByNodeId.get(node.id) ?? new Set();
    const targets = [];
    const returnModels = [...new Map([bodyModel,model].flatMap(owner => owner.orderedNodes.map(node => [node.id,{node,owner}]))).values()];
    for (const {node:targetNode,owner} of returnModels) {
      if (!ancestors.has(targetNode.id)) continue;
      const targetDescriptor = controllerDescriptorForNode({
        record: owner.packages.get(targetNode.moduleId),
        node: targetNode
      });
      const matches = policies.some(
        (policy) =>
          policy?.primitive === targetDescriptor.primitive &&
          (!policy.segmentType || policy.segmentType === targetDescriptor.segmentType)
      );
      if (!matches) continue;
      if (
        targetDescriptor.primitive === "ai-segment" &&
        !Object.hasOwn(storyboard ?? {}, targetDescriptor.segmentType)
      )
        continue;
      targets.push(targetNode.id);
    }
    return targets;
  };
  const attachTaskPolicy = async (task, prepared) => {
    if (!task || task.descriptor) return task;
    if (task.runner !== "ai") return { ...task, descriptor: prepared.descriptor };
    const restrictReturnTargets = Boolean(p3DirectorRevision || (p3Revision && (!segmentId || task.context?.p3BodyRedesign)))
      || task.mode === "author-quotes";
    const allowedReturnTargets = restrictReturnTargets
      ? []
      : await allowedReturnTargetsFor({ node: task.node, descriptor: prepared.descriptor });
    return { ...task, descriptor: prepared.descriptor, allowedReturnTargets };
  };

  const stage = async (node, assembly, outputPath, projections) => {
    const record = model.packages.get(node.moduleId);
    const projected = controllerInputs({ record, projections });
    const task = await programTask({
      root,
      model,
      workspaceRoot,
      episodeId,
      node,
      record,
      assembly,
      ...projected,
      outputPath,
      context: projected.context
    });
    if (isolatedPreview) return task;
    if (returnRequests.has(node.id)) {
      task.returnRequestPath = workPaths.returnRequest(node.id);
      return task;
    }
    if (!(await exists(outputPath))) return task;
    const artifact = await readData(outputPath);
    if (restartPending(model, artifact)) return task;
    return { task, artifact };
  };

  const resolveUnit = async ({ node, item, prepared }) => {
    const { assembly, descriptor } = prepared;
    if (descriptor.primitive === "ai-understanding") {
      if (storyboard?.understanding && !restartPending(model, storyboard.understanding) && !returnRequests.has(node.id)) {
        state.understandingVerified = true;
        return null;
      }

      const task = await buildUnderstandingTask({
        node,
        assembly,
        model,
        inspected,
        workspaceRoot,
        returnRequests,
        root,
        episodeId,
        paths
      });
      const returnRequest = returnRequests.get(node.id);
      if (returnRequest) return { ...task, reason: `上游退回 ${node.id}：${returnRequest.reason}` };
      if (!storyboard?.understanding || restartPending(model, storyboard.understanding))
        return { ...task, reason: "storyboard 尚无正式 understanding 区" };
      state.understandingVerified = true;
      return null;
    }
    if (descriptor.primitive === "ai-visual-director") {
      if (storyboard?.albumPlan && storyboard?.beats && storyboard?.templateRuns && !restartPending(model, storyboard) && !returnRequests.has(node.id)) {
        state.visualPlanVerified = true;
        return null;
      }

      requireStage(state.understandingVerified, node, "已接纳 Understanding");
      const task = await buildVisualDirectorTask({
        node,
        assembly,
        model,
        storyboard,
        returnRequests,
        workspaceRoot,
        inspected,
        paths,
        root,
        episodeId
      });
      const returnRequest = returnRequests.get(node.id);
      if (returnRequest) return { ...task, reason: `上游退回 ${node.id}：${returnRequest.reason}` };
      if (
        restartPending(model, storyboard) || !storyboard?.albumPlan ||
        !Array.isArray(storyboard.beats) ||
        !Array.isArray(storyboard.templateRuns)
      ) {
        return {
          ...task,
          reason: "storyboard 尚无正式整集画册与 Beat 视觉计划"
        };
      }
      state.visualPlanVerified = true;
      return null;
    }
    requireStage(state.visualPlanVerified, node, "已接纳 Visual Director 整集画册与 Beat 计划");
    if (descriptor.primitive === "ai-beat-treatment") {
      const { authorUnit } = item;
      const repairFeatureIds = item.repairFeatureIds ?? (authorUnit.treatment ? await missingAuthorFeatures({ root, assembly, storyboard, authorUnit }) : []);
      const revisingUnit = p3BodyRedesign?.pendingAuthorUnitIds.includes(authorUnit.id);
      if (p3BodyRedesign && !revisingUnit && !segmentId) {
        if (authorUnit.treatment && !restartPending(model, authorUnit.treatment) && !repairFeatureIds.length)
          state.validatedTreatments.add(authorUnit.id);
        return null;
      }
      if (authorUnit.treatment && !restartPending(model, authorUnit.treatment) && !repairFeatureIds.length && !p3BodyRedesign?.pendingAuthorUnitIds.includes(authorUnit.id)) {
        state.validatedTreatments.add(authorUnit.id);
        return null;
      }

      requireStage(authorUnit.templateId, node, `${authorUnit.id} 已由 Visual Director 判定模板`);
      const items = orderedAuthorUnits();
      const index = items.findIndex(({ authorUnit: candidate }) => candidate.id === authorUnit.id);
      if (index > 0 && !revisingUnit && authorSegmentId(authorUnit)
        && authorSegmentId(items[index - 1].authorUnit) === authorSegmentId(authorUnit)) {
        requireStage(
          state.validatedTreatments.has(items[index - 1].authorUnit.id),
          node,
          `${items[index - 1].authorUnit.id} 已接纳 treatment`
        );
      }
      const task = await buildAuthorTask({
        root,
        workspaceRoot,
        episodeId,
        model,
        inspected,
        understanding: storyboard.understanding,
        storyboard,
        node,
        assembly,
        authorUnit,
        authorBatch: authorUnit.paragraph && !revisingUnit && !repairFeatureIds.length
          ? items.map(item => item.authorUnit).filter(unit => authorUnit.paragraph.beatIds.includes(unit.id)
            && (!unit.treatment || restartPending(model, unit.treatment))) : [],
        repairFeatureIds,
        programPlan,
        visualPackage,
        previousAuthorUnit: index > 0 ? items[index - 1].authorUnit : null,
        nextAuthorUnit: items[index + 1]?.authorUnit ?? null,
        p3Revision: p3BodyRedesign?.pendingAuthorUnitIds.includes(authorUnit.id)
          ? p3BodyRedesign
          : null
      });
      if (p3BodyRedesign?.pendingAuthorUnitIds.includes(authorUnit.id)) {
        return { ...task, reason: `正文作者单元 ${authorUnit.id} 待修订：${p3BodyRedesign.reason}` };
      }
      if (repairFeatureIds.length) return { ...task, reason: `${authorUnit.id} 缺少功能交付: ${repairFeatureIds.join(", ")}` };
      if (!authorUnit.treatment || restartPending(model, authorUnit.treatment)) return { ...task, reason: `${authorUnit.id} 尚未完成本次成片设计` };
      state.validatedTreatments.add(authorUnit.id);
      return null;
    }
    if (descriptor.primitive === "ai-segment") {
      if (storyboard[descriptor.segmentType] && !restartPending(model, storyboard[descriptor.segmentType]) && !returnRequests.has(node.id)) {
        state.validatedSegments.add(descriptor.segmentType);
        return null;
      }

      requireStage(allBodyTreatmentsVerified(), node, "全部正文 treatment");
      const items = beatItems;
      const returnRequest = returnRequests.get(node.id);
      const task = await buildSegmentTask({
        root,
        workspaceRoot,
        episodeId,
        model,
        inspected,
        understanding: storyboard.understanding,
        storyboard,
        node,
        assembly,
        segmentType: descriptor.segmentType,
        programPlan,
        openerNarration: await p1OpenerNarrationFor(descriptor.segmentType),
        adjacentBeat: items[0]?.beat ?? null,
        returnRequest
      });
      const segment = storyboard[descriptor.segmentType];
      if (returnRequest) {
        return { ...task, reason: `上游退回 ${node.id}：${returnRequest.reason}` };
      }
      if (!segment || restartPending(model, segment))
        return {
          ...task,
          reason: packagingFailure ?? "片头已启用但尚未创作"
        };
      state.validatedSegments.add(descriptor.segmentType);
      return null;
    }
    if (["ai-video-plan", "ai-video-assets"].includes(descriptor.primitive)) {
      const production = descriptor.primitive === "ai-video-assets";
      if (!production && videoPlan && !restartPending(model, videoPlan) && !returnRequests.has(node.id)) return null;
      if (production && videoManifest && !restartPending(model, videoManifest) && !returnRequests.has(node.id)) {
        try {
          await validateDelivery({ root: workspaceRoot, episodeId, videoPlan, videoManifest, storyboard, cues: inspected.cues });
          return null;
        } catch { /* The current producer receives the specific missing or changed delivery. */ }
      }
      let renderContext = null;
      if (production) {
        const renderStoryboard = { ...storyboard, opener: (await readData(paths.episodePackage)).opener };
        const renderModel = await loadStageModel(root, { stageId: "p4", resourceCache });
        const renderVisual = await loadSelectedVisualForModel({ root, workspaceRoot, model: renderModel, storyboard });
        const renderNode = renderModel.orderedNodes.find((item) => item.moduleId === "render-video");
        const { assembly: renderAssembly } = await prepareNodeAssembly({
          model: renderModel, node: renderNode, storyboard: renderStoryboard, selection: { visualPackageId: renderVisual.id }
        });
        const featureIds = enabledFeatureIdsForNode({ assembly: renderAssembly, features: storyboard.features });
        renderContext = { storyboard: projectRenderStoryboard(renderStoryboard, featureIds),
          featureIds, visualPackage: renderVisualContext(renderVisual) };
      }
      const { opener: currentOpener, ...bodyStoryboard } = storyboard;
      const videoStoryboard = !returnRequests.has("opener") && !restartPending(model, currentOpener)
        ? storyboard : bodyStoryboard;
      const task = await buildVideoTask({ root, model, workspaceRoot, episodeId, paths, node, assembly,
        storyboard: videoStoryboard, inspected, visualPackage, renderContext,
        videoPlan, currentVideoPlan, returnRequest: returnRequests.get(node.id) });
      return { ...task, reason: production ? videoManifestFailure ?? "剧情视频待生产并技术接纳" : "正文剧情视频待选段和设计" };
    }
    if (descriptor.primitive === "program-render") {
      if(!isolatedPreview){
        if(videoEnabled&&(!videoPlan || !videoManifest)) return {kind:"blocked-upstream",upstreamStageId:"p4",nodeId:!videoPlan?"video":"video-assets",reason:videoManifestFailure??"先完成本阶段视频设计与素材交付，再压片"};

    const handoff = await resolveRenderAssetHandoff({workspaceRoot, storyboard, cues:inspected.cues,
      videoPlan, bodyDurationMs:inspected.narrationPackage.durationMs});
    if (handoff.kind === "blocked-upstream") return handoff;
    try {
      if(videoEnabled) await validateDelivery({root:workspaceRoot,episodeId,videoPlan,videoManifest,storyboard,cues:inspected.cues});
    } catch (error) {
      return {kind:"blocked-upstream",upstreamStageId:"p4",nodeId:"video-assets",reason:error.message};
    }

      }
      const featureIds = enabledFeatureIdsForNode({ assembly, features: storyboard.features });
      const renderStoryHash = hashObject(projectRenderStoryboard(storyboard, featureIds));
      const result = await stage(node, assembly, paths.renderReceipt, {
        "video-plan": { inputs: { videoPlanSha256: hashObject((videoPlan ? businessContent(videoPlan) : null)) }, context: { videoPlan: (videoPlan ? businessContent(videoPlan) : null) }, inputHashes: [hashObject((videoPlan ? businessContent(videoPlan) : null))] },
        "video-manifest": { inputs: { videoManifestSha256: hashObject((videoManifest ? businessContent(videoManifest) : null)) }, context: { videoManifest: (videoManifest ? businessContent(videoManifest) : null) }, inputHashes: [hashObject((videoManifest ? businessContent(videoManifest) : null))] },
        storyboard: {
          inputs: { storyboardSha256: renderStoryHash },
          context: { storyboard: projectRenderStoryboard(storyboard, featureIds) },
          inputHashes: [renderStoryHash]
        },
        "narration-package": {
          inputs: { narrationPackageSha256: inspected.narrationPackageSha256 },
          context: { input: inspected.narrationPackage, cues: inspected.cues },
          inputHashes: [inspected.narrationPackageSha256]
        },
        "source-assets": {
          inputs: { sourceAssets: inspected.sourceAssets },
          context: { sourceAssets: inspected.sourceAssets },
          inputHashes: [sourceAssetsDigest(inspected)],
          producerInputHashes: selectedSourceAssetHashes({
            value: storyboard,
            sourceAssets: inspected.sourceAssets
          })
        },
        "visual-package": {
          inputs: {
            visualPackage: {
              id: visualPackage.id,
              version: visualPackage.version,
              renderDigest: visualPackage.renderDigest
            }
          },
          context: { visualPackage: renderVisualContext(visualPackage) },
          inputHashes: [visualPackage.renderDigest]
        }
      });
      if (result.kind === "task") return { ...result, reason: result.reason ?? "P4 成片尚未渲染" };
      const finalFile = path.join(workspaceRoot, result.artifact.output);
      if (!(await exists(finalFile)))
        return { ...result.task, kind: "task", reason: `最终成片缺失: ${result.artifact.output}` };
      state.renderTask = result.task;
      return null;
    }
    throw new Error(`Workflow 节点 ${node.id} 没有运行时处理逻辑`);
  };

  const selectedAncestors = nodeId
    ? model.workflowModel.workflowById.get(model.workflowRecord.id).ancestorsByNodeId.get(nodeId) : null;
  const consumedAfterEach = new Set();
  for (const node of model.orderedNodes) {
    if(consumerOnly && node.moduleId!=="render-video") continue;
    if(node.condition==="video-enabled"&&!videoEnabled) continue;
    if (nodeId && node.id !== nodeId && !selectedAncestors.has(node.id)) continue;

    if (consumedAfterEach.has(node.id)) continue;
    const follower = model.afterEachByParent.get(node.id) ?? null;
    if (follower) consumedAfterEach.add(follower.id);
    if (!node.scope.startsWith("each-")) {
      const prepared = await prepareFor(node);
      if (!nodeEnabled({ node, assembly: prepared.assembly })) continue;
      const current = await resolveUnit({ node, item: null, prepared });
      if (current) {
        if (nodeId && node.id !== nodeId) return { kind: "blocked-upstream", stageId: model.stageId,
          upstreamStageId: model.stageId, nodeId: node.id, reason: `先完成 ${node.id}，再执行 ${nodeId}` };
        return attachTaskPolicy(withAuthorUnitProgress(current), prepared);
      }
      if (node.id === nodeId) return { kind: "node-complete", stageId: model.stageId, nodeId,
        subject: { kind: "episode", id: episodeId }, workflowId: model.workflowRecord.id };
      continue;
    }
    const iterationItems = node.scope === "each-author-unit" ? orderedAuthorUnits() : beatItems;
    if (node.scope === "each-author-unit" && model.stageId === "p3") {
      if (segmentId && !(storyboard.templateRuns ?? []).some(run => run.id === segmentId))
        throw new Error(`当前导演计划没有段 ${segmentId}`);
      for (const item of iterationItems) {
        item.prepared = await prepareFor(node, item);
        item.repairFeatureIds = item.authorUnit.treatment ? await missingAuthorFeatures({
          root, assembly: item.prepared.assembly, storyboard, authorUnit: item.authorUnit
        }) : [];
        if (item.authorUnit.treatment && !restartPending(model, item.authorUnit.treatment)
          && !item.repairFeatureIds.length && !p3BodyRedesign?.pendingAuthorUnitIds.includes(item.authorUnit.id))
          state.validatedTreatments.add(item.authorUnit.id);
      }
      authorSegments = await Promise.all((storyboard.templateRuns ?? []).map(async run => {
        const members = iterationItems.filter(item => authorSegmentId(item.authorUnit) === run.id);
        const completed = members.length > 0 && members.every(item => state.validatedTreatments.has(item.authorUnit.id));
        const work = getStageWorkPaths(paths, "p3", run.id);
        return { id: run.id, templateId: run.templateId, beatIds: run.beatIds,
          state: completed ? "completed" : await exists(work.workOrder) || await exists(work.candidate) ? "in-progress" : "pending" };
      }));
    }
    for (const item of iterationItems) {
      if (segmentId && item.authorUnit && authorSegmentId(item.authorUnit) !== segmentId) continue;
      const itemPrepared = item.prepared ?? await prepareFor(node, item);
      if (!nodeEnabled({ node, assembly: itemPrepared.assembly })) continue;
      const current = await resolveUnit({ node, item, prepared: itemPrepared });
      if (current)
        return attachTaskPolicy(
          withAuthorUnitProgress(current, {
            currentUnitId: item.authorUnit?.id ?? null
          }),
          itemPrepared
        );
      if (follower) {
        const followerPrepared = await prepareFor(follower, item);
        if (!nodeEnabled({ node: follower, assembly: followerPrepared.assembly })) continue;
        const followed = await resolveUnit({ node: follower, item, prepared: followerPrepared });
        if (followed)
          return attachTaskPolicy(
            withAuthorUnitProgress(followed, {
              currentUnitId: item.authorUnit?.id ?? null
            }),
            followerPrepared
          );
      }
    }
    if (segmentId && node.scope === "each-author-unit") return withAuthorUnitProgress({
      kind: "segment-complete", subject: { kind: "episode", id: episodeId }, workflowId: "video",
      stageId: "p3", nodeId: "author", segmentId, message: `${segmentId} 当前作者任务已完成`
    });
  }
  const quoteDecisions = model.stageId === "p3" ? resolveQuoteDecisions(storyboard, quoteContext) : null;
  if (model.stageId === "p3" && restartPending(model, storyboard?.authorQuotes)) quoteDecisions.clear();
  for (const id of p3QuoteRevision?.selectedBeatIds ?? []) quoteDecisions.delete(id);
  if (model.stageId === "p3" && collectQuoteRequests(storyboard).some(request => !quoteDecisions.has(request.id))) {
    const node = model.orderedNodes.find((entry) => entry.moduleId === "author-beat");
    const item = orderedAuthorUnits().find(({ authorUnit }) => authorUnit.templateId === "fullframe-narrative");
    const prepared = await prepareFor(node, item);
    const task = await buildAuthorQuoteTask({ root, workspaceRoot, episodeId, model, inspected, storyboard,
      node, assembly: prepared.assembly, programPlan, quoteRevision: p3QuoteRevision });
    const reason = "全部正文设计已完成，等待取得引文原文、真实出处并收口";
    return attachTaskPolicy(withAuthorUnitProgress({ ...task, reason }), prepared);
  }
  if (model.stageId === "p3" && await exists(workPaths.workOrder)) {
    const saved = await readData(workPaths.workOrder);
    if (saved.inputs?.authorPhase === "quotes") {
      const { taskDigest, ...base } = saved;
      const requests = collectQuoteRequests(storyboard).map(({ id, request, cueRange }) => ({ id, request, cueRange }));
      if (hashObject(base) !== taskDigest || saved.subject?.id !== episodeId || saved.stageId !== "p3"
        || saved.nodeId !== "author" || saved.moduleId !== "author-beat"
        || saved.inputs.quoteRequests.some((request) => !requests.some((item) => hashObject(item) === hashObject(request)))
        || hashObject(saved.inputs) !== hashObject({ ...quoteBatchInputs({ ...quoteContext, referenceVideos: await episodeReferenceVideos(programPlan, episodeId), narrationEvidence: await readAcceptedNarrationEvidence({ workspaceRoot, episodeId }), retainedQuoteEvidence: retainedQuoteEvidence(storyboard), quoteRequests: saved.inputs.quoteRequests, quoteRevision: p3QuoteRevision }),
          ...(model.stageRestart ? { stageRestartId: model.stageRestart.id } : {}) })) {
        throw new Error("遗留引文工作单与当前正式输入不一致，保留现场");
      }
      const recovery = { kind: "recovery-required", subject: { kind: "episode", id: episodeId },
        workflowId: "video", stageId: "p3", nodeId: "author", authorUnitProgress: authorUnitProgress(),
        reason: "已有引文决议已覆盖当前请求；运行同参 next 收口尚未使用的引文工作单" };
      Object.defineProperty(recovery, "unusedQuoteWorkOrder", { value: saved });
      return recovery;
    }
  }
  const completed = {
    kind: "complete",
    episodeId,
    message: "当前 Workflow 全部完成",
    output: state.renderTask ? (await readData(paths.renderReceipt)).output : null,
    ...(authorUnitProgress() ? { authorUnitProgress: authorUnitProgress(), authorSegments } : {})
  };
  if (state.renderTask)
    Object.defineProperty(completed, "renderProgramTask", { value: state.renderTask });
  return completed;
};

const resolveRenderInputs = async ({
  root,
  workspaceRoot = root,
  episodeId,
  previewSegmentIds = null,
  previewPart = null
}) => {
  if (previewPart && (!["body", "opener"].includes(previewPart) || previewSegmentIds))
    throw new Error("片段预览只能选择 body 或 opener，不能与 Beat 预览混用");
  const current = await resolveVideoCurrent({
    root,
    workspaceRoot,
    episodeId,
    model: await loadStageModel(root, { stageId: "p4" }),
    consumerOnly: true,
    previewSegmentIds,
    previewPart
  });
  const renderTask =
    current.kind === "complete"
      ? current.renderProgramTask
      : current.kind === "task" &&
          current.runner === "program" &&
          current.descriptor?.primitive === "program-render"
        ? current
        : null;
  if (!renderTask) {
    throw new Error(
      `渲染输入无法成立${current.reason ? `：${current.reason}` : `：${current.kind}`}`
    );
  }
  const invocation = programInvocationTask(renderTask);
  if (previewPart) {
    invocation.context.previewPart = previewPart;
    previewSegmentIds = previewPart === "body" ? invocation.context.storyboard.beats.map(beat => beat.id) : ["opener"];
  }
  if (previewSegmentIds) invocation.context.previewSegmentIds = previewSegmentIds;
  return invocation;
};

export { resolveRenderInputs, resolveVideoCurrent };
