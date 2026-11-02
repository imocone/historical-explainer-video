import { publicationTextFor } from "../../packages/modules/author-narration/publication-text.mjs";
import { projectVideoProduction } from "../../packages/templates/cinematic-video/production-projection.mjs";
import { assertVideoOpenerInput } from "../../packages/p4-opener-reference.mjs";
import { collectQuoteRequests, mergeAcceptedQuotes } from "../../packages/templates/fullframe-narrative/callout/batch.mjs";
import { projectAcceptedOpenerBodyDependencies } from "../../packages/modules/author-bookend/dependency-projection.mjs";
import { projectRenderStoryboard } from "../../packages/modules/render-video/runtime/projection.mjs";
import { authorPreviousTreatmentProducerInputsForResult, previousTreatmentInputForAuthorUnit } from "./author-tasks.mjs";
import { inspectP3Inputs } from "./storyboard-validation.mjs";
import { commitAcceptance, recoverAcceptance } from "./acceptance-commit.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { materializeEpisodeBriefs } from "../../packages/program-brief.mjs";
import {
  getEpisodePaths,
  getProgramPaths,
  getStageWorkPaths
} from "../../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../../packages/publication-paths.mjs";
import { hashObject, readData, sha256, stableStringify } from "../../packages/program-utils.mjs";
import { completeTreatmentCandidate, validateTreatmentCandidate } from "../../packages/modules/author-beat/candidate-validation.mjs";
import { validateAuthorBatch } from "../../packages/modules/author-beat/batch-validation.mjs";
import { resolveReusableNarrationMaterials } from ".././p1-revision-materials.mjs";
import { assertProgramRevisionRequest } from "./state-program.mjs";
import { assertProjectPaths, exists, importModule } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import { loadStageModel } from "./model.mjs";
import { loadPackages } from "./packages.mjs";
import {
  controllerSpecFor,
  featureAdapter,
  findBeat,
  implementationFor,
  implementationIds,
  projectControllerResult,
  templatePolicyFromAssembly
} from "./implementations.mjs";
import {
  assertP3BodyRedesignRequest,
  authorUnitsForStoryboard,
  businessContent,
  changedDirectorBeatIds,
  changedDirectorRunIds,
  clearChangedBeatFeatureResults,
  completedBodySlice,
  directorAlbumDirection,
  directorResultSlice,
  mergeDirectorResult,
  producerInputsWithSelectedSources,
  openerAlbumDirection,
  staticBodyBeat
} from "./storyboard.mjs";
import { pairedOpenerTaskDigest, producer } from "./artifacts.mjs";
import { requireStageId, resolveStageCurrent } from "./status.mjs";
import { assertTaskContinuity, isBodyHandoffReason } from "./tasks.mjs";

const openerInputsFromBody = (storyboard, opener) => ({
  understanding: businessContent(storyboard?.understanding),
  direction: openerAlbumDirection(storyboard?.albumPlan),
  firstBeat: storyboard?.beats?.[0] ? staticBodyBeat(storyboard.beats[0]) : null,
  body: projectAcceptedOpenerBodyDependencies({ bodyStoryboard: completedBodySlice(storyboard ?? {}), result: opener })
});

const featureIdsForConsumer = (model, storyboard, moduleId) => Object.keys(storyboard?.features ?? {}).filter((id) =>
  model.packages.get(id)?.manifest.implements?.some((item) => item.moduleId === moduleId));

const renderInputsFromBody = (model, storyboard) => ({
  storyboard: projectRenderStoryboard(storyboard ?? {}, featureIdsForConsumer(model, storyboard, "render-video")),
  quotes: (storyboard?.authorQuotes?.items ?? []).map(({ id, quote }) => ({ id, quote }))
});
async function acceptCandidate({
  root,
  workspaceRoot = root,
  episodeId,
  programId,
  targetId,
  stageId,
  platform = null,
  segmentId = null,
  nodeId = null,
  acceptanceServices = {}
}) {
  requireStageId(stageId, "accept");
  const recovered = await recoverAcceptance({ workspaceRoot, episodeId, stageId, targetId, platform, segmentId, nodeId });
  if (recovered) return recovered;

  const model = await loadStageModel(root, { stageId, resourceScope: "stage" });
  const current = await resolveStageCurrent({
    root,
    workspaceRoot,
    episodeId,
    programId,
    targetId,
    stageId,
    platform,
    segmentId,
    nodeId,
    model
  });
  const paths =
    current.paths ??
    (() => {
      if (current.subject?.kind === "program") return getProgramPaths(workspaceRoot);
      if (current.subject?.kind === "release-bundle")
        return getPublicationPaths(workspaceRoot, episodeId, targetId);
      if (current.subject?.kind === "episode") return getEpisodePaths(workspaceRoot, episodeId);
      throw new Error("当前生产对象没有可解析的工作目录");
    })();
  const workPaths = current.workPaths ?? getStageWorkPaths(paths, stageId);
  await assertProjectPaths({
    root: workspaceRoot,
    label: `${stageId} 工作路径`,
    files: [workPaths.work, workPaths.workOrder, workPaths.candidate]
  });
  if (!(await exists(workPaths.workOrder)))
    throw new Error("缺少当前 work-order.yaml，请先运行 next");
  if (current.kind !== "task" || current.runner !== "ai")
    throw new Error("当前没有可接纳的人工智能任务");
  if (current.mode === "video-plan" && !current.context.storyboard?.opener)
    throw new Error("先接纳片头并交给视频作者核对接镜，保留当前video工作单与候选");
  const saved = await readData(workPaths.workOrder);
  const savedHash = hashObject(saved);
  await validateSchema(
    path.join(root, "contracts", "work-order.schema.json"),
    saved,
    workPaths.workOrder
  );
  if (saved.stageId !== stageId)
    throw new Error(`work-order.yaml 属于阶段 ${saved.stageId}，不能由 ${stageId} 接纳`);
  if (!(await exists(workPaths.candidate))) throw new Error("缺少 candidate.yaml");
  if (model.workflowRecord.subjectKind !== current.workOrder.subject.kind) {
    throw new Error(
      `阶段 ${stageId} 属于 Subject kind=${model.workflowRecord.subjectKind}，不能接纳 ${current.workOrder.subject.kind}`
    );
  }
  const { taskDigest, ...base } = saved;
  if (hashObject(base) !== taskDigest) throw new Error("work-order.yaml 自身内容已被改写");
  assertTaskContinuity(saved, current.workOrder);
  current.workOrder = saved;
  const candidate = await readData(workPaths.candidate);
  // Acceptance validators may enrich result; compare files with their read-time contents.
  const candidateHash = hashObject(candidate);
  await validateSchema(
    path.join(root, "contracts", "candidate.schema.json"),
    candidate,
    workPaths.candidate
  );
  if (candidate.taskDigest !== current.workOrder.taskDigest)
    throw new Error("candidate taskDigest 已过期");
  if (candidate.returnTo) {
    if (!current.workOrder.allowedReturnTargets.includes(candidate.returnTo.target)) {
      throw new Error(`${current.workOrder.nodeId} 不允许退回 ${candidate.returnTo.target}`);
    }
    const fullWorkflow = model.workflowModel.workflowById.get(current.workOrder.workflowId);
    const targetNode = fullWorkflow.nodeById.get(candidate.returnTo.target);
    if (!targetNode)
      throw new Error(`returnTo 引用了不存在的 Workflow 节点: ${candidate.returnTo.target}`);
    if (current.workOrder.workflowId === "video" && candidate.returnTo.cueRefs.length === 0) {
      throw new Error("Video Workflow 的 returnTo 必须引用至少一个当前字幕 cue");
    }
    if (current.workOrder.workflowId === "narration" && candidate.returnTo.cueRefs.length !== 0) {
      throw new Error("Narration Workflow 的 returnTo 不使用字幕 cueRefs");
    }
    const returnCues = current.context.authorBatch
      ? current.context.authorBatch.members.flatMap(member => member.inputs.cues) : current.context.cues ?? [];
    const cueIds = new Set(returnCues.map(cue => cue.id));
    for (const cueRef of candidate.returnTo.cueRefs) {
      if (!cueIds.has(cueRef)) throw new Error(`returnTo 引用了当前任务范围外的 cue ${cueRef}`);
    }
    const request = {
      ...candidate.returnTo,
      requestedBy: {
        taskId: current.workOrder.taskId,
        nodeId: current.workOrder.nodeId,
        moduleId: current.workOrder.moduleId,
        taskDigest: current.workOrder.taskDigest
      }
    };
    const targetStageId = fullWorkflow.stageByNodeId.get(targetNode.id);
    const requestPath = getStageWorkPaths(paths, targetStageId).returnRequest(targetNode.id);
    return commitAcceptance({
      workspaceRoot, workPaths,
      writes: new Map([[requestPath, request]]),
      cleanup: [workPaths.workOrder, workPaths.candidate],
      scratchPath: current.workOrder.scratchPath ? path.resolve(workspaceRoot, current.workOrder.scratchPath) : null,
      materials: null,
      verify: async () => {
        if (hashObject(await readData(workPaths.workOrder)) !== savedHash
          || hashObject(await readData(workPaths.candidate)) !== candidateHash) throw new Error("退回期间候选或工作单已变化");
      },
      result: { kind: "returned", subject: current.workOrder.subject, workflowId: current.workOrder.workflowId,
        stageId: current.workOrder.stageId, taskId: current.workOrder.taskId, target: request.target, reason: request.reason }
    });
  }
  const containsProducer = (value) =>
    Array.isArray(value)
      ? value.some(containsProducer)
      : value && typeof value === "object"
        ? Object.entries(value).some(
            ([key, child]) => key === "_producer" || containsProducer(child)
          )
        : false;
  if (containsProducer(candidate.result)) throw new Error("候选稿越权写入 _producer");
  let primaryResult = candidate.result;
  if (current.mode === "video-plan") await assertVideoOpenerInput({ workspaceRoot,
    workOrder: saved, result: primaryResult, opener: current.context.storyboard.opener });
  let featureResults = {};
  let moduleValidator;
  let errors = [];
  let batchViews = null;
  if (current.mode === "treatment") {
    completeTreatmentCandidate({ candidateResult: candidate.result, context: current.context });
    primaryResult = current.context.authorBatch ? candidate.result.items : candidate.result.treatment;
    featureResults = candidate.result.featureResults ?? {};
    const selectedFeatureIds = new Set(
      implementationIds(current.workOrder.resolvedAssembly, "feature")
    );
    const unexpectedFeatureIds = Object.keys(featureResults).filter(
      (featureId) => !selectedFeatureIds.has(featureId)
    );
    if (unexpectedFeatureIds.length) {
      throw new Error(
        `候选稿写入当前 Author 节点未启用的功能结果: ${unexpectedFeatureIds.join(", ")}`
      );
    }
    const templateId = current.templateRecord?.manifest?.id ?? current.context?.selectedTemplate;
    const templateImplementation = implementationFor(
      current.workOrder.resolvedAssembly,
      templateId,
      "template",
      "outputSchema"
    );
    const featureImplementations = implementationIds(
      current.workOrder.resolvedAssembly,
      "feature"
    ).map((featureId) =>
      implementationFor(current.workOrder.resolvedAssembly, featureId, "feature", "outputSchema")
    );
    const validateAuthor = current.context.authorBatch ? validateAuthorBatch : validateTreatmentCandidate;
    const validation = await validateAuthor({
      candidateResult: candidate.result,
      context: current.context,
      systemRoot: root,
      workspaceRoot,
      episodeId,
      task: saved,
      moduleValidatorSource:
        current.validatorPath ??
        path.resolve(current.record.directory, current.record.manifest.validator),
      templateImplementation,
      featureImplementations,
      loadResource: (source) => importModule(path.resolve(root, source)),
      loadTemplatePolicy: () =>
        templatePolicyFromAssembly({
          root,
          assembly: current.workOrder.resolvedAssembly
        }),
      services: acceptanceServices,
      treatmentSchemaPath: path.resolve(
        current.outputRecord.directory,
        current.outputRecord.manifest.outputSchema
      ),
      treatmentLabel: "candidate.result",
      featureResultLabel: (featureId) => `candidate.featureResults.${featureId}`
    });
    if (current.context.authorBatch) {
      batchViews = validation;
      moduleValidator = await importModule(current.validatorPath);
    } else ({ errors, moduleValidator } = validation);
  } else {
    const primaryOutputSchemaPath =
      current.outputSchemaPath ??
      path.resolve(current.outputRecord.directory, current.outputRecord.manifest.outputSchema);
    moduleValidator = await importModule(
      current.validatorPath ??
        path.resolve(current.record.directory, current.record.manifest.validator)
    );
    const templateValidator = current.templateRecord ? await importModule(
      path.resolve(current.templateRecord.directory, current.templateRecord.manifest.validator)
    ) : null;
    for (const validator of [moduleValidator, templateValidator]) {
      if (typeof validator?.completeCandidate === "function") {
        await validator.completeCandidate({ result: primaryResult, context: current.context,
          services: { ...acceptanceServices, systemRoot: root, workspaceRoot, episodeId, task: saved } });
      }
    }
    await validateSchema(primaryOutputSchemaPath, primaryResult, "candidate.result");
    errors = [...moduleValidator.validate({ result: primaryResult, context: current.context })];
    if (templateValidator) {
      errors.push(
        ...templateValidator.validate({ result: primaryResult, context: current.context })
      );
      if (!errors.length && typeof templateValidator.validateAcceptance === "function") {
        errors.push(
          ...(await templateValidator.validateAcceptance({
            result: primaryResult,
            context: current.context,
            services: {
              systemRoot: root,
              workspaceRoot,
              episodeId,
              task: saved,
              resolvedAssembly: current.resolvedAssembly ?? current.workOrder.resolvedAssembly,
              ...acceptanceServices
            }
          }))
        );
      }
    }
  }
  if (!current.context?.repairFeatureIds?.length && !errors.length && typeof moduleValidator.validateAcceptance === "function") {
    errors.push(
      ...(await moduleValidator.validateAcceptance({
        result: primaryResult,
        context: current.context,
        services: {
          systemRoot: root,
          workspaceRoot,
          episodeId,
          task: saved,
          resolvedAssembly: current.resolvedAssembly ?? current.workOrder.resolvedAssembly,
          ...acceptanceServices
        }
      }))
    );
  }
  if (errors.length) throw new Error(`candidate 语义校验失败: ${errors.join("; ")}`);
  const validatedFeatureResults = featureResults;
  const projection = batchViews ? {
    kind: "treatment", authorUnitId: current.object.authorUnitId, featureResults: {},
    treatment: batchViews.map(view => {
      const result = view.candidate.result;
      const patch = projectControllerResult({ spec: controllerSpecFor(current.record),
        result: result.treatment, featureResults: result.featureResults,
        scope: { authorUnitId: view.item.beatId, beatId: view.item.beatId, nodeId: current.workOrder.nodeId } });
      if (patch.kind !== "treatment" || patch.authorUnitId !== view.item.beatId
        || stableStringify(patch.treatment) !== stableStringify(result.treatment)
        || stableStringify(patch.featureResults) !== stableStringify(result.featureResults)) {
        throw new Error(`${view.item.beatId} 的接纳投影改变了已验证结果`);
      }
      return { beatId: view.item.beatId, treatment: patch.treatment, featureResults: patch.featureResults };
    })
  } : projectControllerResult({
    spec: controllerSpecFor(current.record),
    result: primaryResult,
    featureResults,
    scope: { ...(current.object ?? {}), nodeId: current.workOrder.nodeId }
  });
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error(`${current.workOrder.moduleId} controller.project 必须返回局部补丁对象`);
  }
  let projectedPrimaryResult;
  if (current.mode === "author-quotes" && projection.kind === "author-quotes") {
    projectedPrimaryResult = projection.quotes;
  } else if (current.mode === "understanding" && projection.kind === "understanding") {
    projectedPrimaryResult = projection.section;
  } else if (current.mode === "visual-plan" && projection.kind === "visual-plan") {
    projectedPrimaryResult = projection.visualPlan;
  } else if (
    current.mode === "treatment" &&
    projection.kind === "treatment" &&
    projection.authorUnitId === current.object.authorUnitId
  ) {
    projectedPrimaryResult = projection.treatment;
    featureResults = projection.featureResults ?? {};
  } else if (
    current.mode === "segment" &&
    projection.kind === "segment" &&
    projection.segmentType === current.object.segmentType
  ) {
    projectedPrimaryResult = projection.segment;
  } else if (
    ["ai-narration", "ai-subtitles", "program-plan", "publish", "video-plan", "video-assets"].includes(current.mode) &&
    projection.kind === "artifact"
  ) {
    projectedPrimaryResult = projection.artifact;
  } else {
    throw new Error(
      `${current.workOrder.moduleId} controller.project 返回了不属于当前工位的局部补丁`
    );
  }
  const validatedPrimaryResult =
    current.mode === "understanding" ? primaryResult.understanding : primaryResult;
  if (stableStringify(projectedPrimaryResult) !== stableStringify(validatedPrimaryResult)) {
    throw new Error(`${current.workOrder.moduleId} controller.project 不得改写已验证业务内容`);
  }
  if (
    current.mode === "treatment" &&
    stableStringify(featureResults) !== stableStringify(validatedFeatureResults)
  ) {
    throw new Error(`${current.workOrder.moduleId} controller.project 不得改写已验证功能结果`);
  }
  const writes = new Map();
  const rawWrites = new Map();
  const writeBaselines = new Map();
  const queueWrite = async (file, value) => {
    if (!writeBaselines.has(file)) writeBaselines.set(file, await exists(file) ? hashObject(await readData(file)) : null);
    writes.set(file, value);
  };
  const markRepair = async (stage, node, reason, repairPaths = paths, extra = {}) => {
    const file = getStageWorkPaths(repairPaths, stage).returnRequest(node);
    if (!(await exists(file)) && !writes.has(file)) await queueWrite(file, { target: node, reason, cueRefs: [], ...extra });
  };
  const oldOutput = await exists(current.outputPath) ? businessContent(await readData(current.outputPath)) : null;

  const editsStoryboard = ["author-quotes", "understanding", "visual-plan", "treatment", "feature"].includes(current.mode);
  const priorStoryboard = editsStoryboard && await exists(paths.storyboard) ? await readData(paths.storyboard) : null;
  if (editsStoryboard) writeBaselines.set(paths.storyboard, priorStoryboard ? hashObject(priorStoryboard) : null);
  let updatedStoryboard = null;
  let materials = null;
  let outputSha256;
  let consumedReturnPath = null;
  if (current.mode === "author-quotes") {
    const storyboard = structuredClone(priorStoryboard);
    const accepted = { ...projectedPrimaryResult, _producer: producer({ task: current, result: projectedPrimaryResult }) };
    storyboard.authorQuotes = mergeAcceptedQuotes({ previous: storyboard.authorQuotes, accepted });
    storyboard.authorQuotes._producer.outputSha256 = hashObject(businessContent(storyboard.authorQuotes));
    updatedStoryboard = storyboard;
    outputSha256 = storyboard.authorQuotes._producer.outputSha256;
    if (current.context?.quoteRevision) {
      const requestPath = workPaths.returnRequest("author");
      const request = await readData(requestPath);
      if (hashObject(request) !== hashObject(current.context.quoteRevision)) {
        throw new Error("P3引文定点重作请求在候选接纳期间发生变化");
      }
      consumedReturnPath = requestPath;
    }
  } else if (current.mode === "understanding") {
    const existing = structuredClone(priorStoryboard ?? {});
    const result = businessContent(projectedPrimaryResult);
    const sectionResult = { understanding: result };
    const sectionProducer = producer({ task: current, result: sectionResult });
    const storyboard = { ...existing, understanding: { ...result, _producer: sectionProducer } };
    updatedStoryboard = storyboard;
    outputSha256 = sectionProducer.outputSha256;
    consumedReturnPath = workPaths.returnRequest(current.node.id);
  } else if (current.mode === "visual-plan") {
    const storedExisting = structuredClone(priorStoryboard);
    const existing = storedExisting;
    const albumDirectionChanged =
      hashObject(directorAlbumDirection(existing.albumPlan)) !==
      hashObject(directorAlbumDirection(projectedPrimaryResult.albumPlan));
    const changedBeatIds =
      albumDirectionChanged
        ? [
            ...new Set([
              ...(storedExisting.beats ?? []).map((beat) => beat.id),
              ...(projectedPrimaryResult.beats ?? []).map((beat) => beat.id)
            ])
          ]
        : changedDirectorBeatIds(existing, projectedPrimaryResult);
    const changedRunIds =
      albumDirectionChanged
        ? [
            ...new Set([
              ...(storedExisting.templateRuns ?? []).map((run) => run.id),
              ...(projectedPrimaryResult.templateRuns ?? []).map((run) => run.id)
            ])
          ]
        : changedDirectorRunIds(existing, projectedPrimaryResult, changedBeatIds);
    const directorProducer = producer({
      task: current,
      result: directorResultSlice(projectedPrimaryResult)
    });
    const storyboard = mergeDirectorResult({
      model,
      assembly: current.workOrder.resolvedAssembly,
      existing,
      result: projectedPrimaryResult,
      directorProducer,
      changedBeatIds,
      changedRunIds
    });
    await clearChangedBeatFeatureResults({
      model,
      storyboard,
      beatIds: [...new Set([...changedBeatIds, ...changedRunIds])]
    });
    updatedStoryboard = storyboard;
    outputSha256 = directorProducer.outputSha256;
    consumedReturnPath = workPaths.returnRequest(current.node.id);
  } else if (current.mode === "segment") {
    const accepted = {
      ...projectedPrimaryResult,
      _producer: producer({ task: current, result: projectedPrimaryResult })
    };
    const packaging = { opener: accepted };
    await validateSchema(
      path.join(root, "contracts/episode-package.schema.json"),
      packaging,
      paths.episodePackage
    );
    if (stableStringify(businessContent(oldOutput)) !== stableStringify(businessContent(packaging))) {
      await markRepair("p4", "render", "片头设计发生实际修改，更新成片");
      if (await exists(paths.videoPlan)) {
        const firstBeatId = (await readData(paths.storyboard)).beats?.[0]?.id;
        if ((await readData(paths.videoPlan)).spans.some(({ beatIds }) => beatIds[0] === firstBeatId))
          await markRepair("p4", "video", "片头设计发生实际修改，复核正文首段视频接镜");
      }
    }
    await queueWrite(paths.episodePackage, packaging);
    outputSha256 = accepted._producer.outputSha256;
    consumedReturnPath = workPaths.returnRequest(current.node.id);
  } else if (current.mode === "treatment") {
    const storyboard = structuredClone(priorStoryboard);
    const accepted = batchViews ? null : {
      ...projectedPrimaryResult,
      _producer: producer({
        task: current,
        result: projectedPrimaryResult
      })
    };
    if (batchViews) {
      for (const view of batchViews) {
        const { treatment, featureResults: features } = view.candidate.result;
        const inputsFor = result => producerInputsWithSelectedSources({
          base: [...current.inputHashes, ...authorPreviousTreatmentProducerInputsForResult({
            result, previousTreatmentInput: view.workOrder.inputs.previousTreatment })],
          result, sourceAssets: view.workOrder.inputs.sourceAssets
        });
        const memberTask = { ...current, producerInputsForResult: inputsFor,
          producerDigestForResult: result => current.producerDigestForInputs(inputsFor(result)) };
        findBeat(storyboard, view.item.beatId).treatment = { ...treatment,
          _producer: producer({ task: memberTask, result: treatment }) };
        for (const [featureId, featureResult] of Object.entries(features)) {
          const adapter = await featureAdapter({ root, assembly: current.workOrder.resolvedAssembly, featureId });
          adapter.projectResult({ storyboard,
            scope: { featureId, authorUnitId: view.item.beatId, unitId: view.item.beatId, beatId: view.item.beatId },
            result: featureResult, producer: producer({ task: memberTask, result: featureResult, featureId }) });
        }
      }
    } else if (current.context?.repairFeatureIds?.length) {
      // Existing treatment remains owned by its original author.
    } else if (current.object.templateRunId) {
      const run = (storyboard.templateRuns ?? []).find(
        (candidate) => candidate.id === current.object.templateRunId
      );
      if (!run) throw new Error(`Author 接纳目标不存在: ${current.object.templateRunId}`);
      run.treatment = accepted;
      for (const beatId of run.beatIds ?? []) findBeat(storyboard, beatId).treatment = null;
    } else {
      const beat = findBeat(storyboard, current.object.beatId);
      beat.treatment = accepted;
    }
    for (const [featureId, featureResult] of Object.entries(featureResults)) {
      const adapter = await featureAdapter({
        root,
        assembly: current.workOrder.resolvedAssembly,
        featureId
      });
      if (typeof adapter.projectResult !== "function")
        throw new Error(`${featureId} 的 validator 必须导出 projectResult`);
      if (current.object.templateRunId) {
        for (const beatId of current.context.authorUnit?.beatIds ?? []) {
          if (typeof adapter.clearResult === "function") {
            adapter.clearResult({
              storyboard,
              scope: { featureId, authorUnitId: beatId, unitId: beatId, beatId }
            });
          }
        }
      }
      adapter.projectResult({
        storyboard,
        scope: {
          featureId,
          authorUnitId: current.object.authorUnitId,
          unitId: current.object.authorUnitId,
          beatId: current.object.authorUnitId
        },
        result: featureResult,
        producer: producer({ task: current, result: featureResult, featureId })
      });
    }
    updatedStoryboard = storyboard;
    outputSha256 = batchViews ? hashObject(projectedPrimaryResult) : accepted._producer.outputSha256;
    if (current.context?.p3BodyRedesign) {
      const requestPath = workPaths.returnRequest("author");
      const request = assertP3BodyRedesignRequest(await readData(requestPath));
      if (stableStringify(request) !== stableStringify(current.context.p3BodyRedesign)) {
        throw new Error("P3正文重作请求在候选接纳期间发生变化");
      }
      if (!request.pendingAuthorUnitIds.includes(current.object.authorUnitId)) {
        throw new Error("当前作者单元不属于P3正文重作待办范围");
      }
      const pendingAuthorUnitIds = request.pendingAuthorUnitIds.filter(
        (id) => id !== current.object.authorUnitId
      );
      if (pendingAuthorUnitIds.length) {
        const signedReason = saved.inputs.p3BodyRedesign.reason;
        const reason = isBodyHandoffReason(request.reason) && !isBodyHandoffReason(signedReason)
          ? signedReason : request.reason;
        await queueWrite(requestPath, { ...request, reason, pendingAuthorUnitIds });
      } else {
        consumedReturnPath = requestPath;
      }
    }
  } else if (current.mode === "ai-narration") {
    const { openerNarration, publication, ...scriptBusiness } = projectedPrimaryResult;
    const openerBusiness = { schemaVersion: "3.0", openerNarration };
    const revisionScope = current.context?.returnRequest?.revisionScope ?? null;
    const rewriteNarration = revisionScope === "narration" && current.workOrder.moduleId === "author-narration";
    let materialExecutionId;
    if (["publication-copy", "publication-all", "cover-content"].includes(revisionScope)) {
      materialExecutionId = current.context?.materialExecutionId;
    } else if (["opener", "narration"].includes(revisionScope) && !rewriteNarration) {
      materialExecutionId = current.context?.reusedNarrationMaterials?.materialExecutionId;
    } else {
      const currentMaterials = await resolveReusableNarrationMaterials({
        workspaceRoot,
        episodeId,
        episodeBrief: current.context?.episodeBrief,
        materialExecutionId: current.workOrder.executionId
      });
      materialExecutionId = currentMaterials.materialExecutionId;
    }
    if (!/^[a-f0-9]{64}$/u.test(materialExecutionId ?? "")) {
      throw new Error("P1接纳无法确定正文使用的材料尝试身份");
    }
    const scriptChanged = !oldOutput || stableStringify(oldOutput) !== stableStringify(scriptBusiness);
    const previousScript = oldOutput ? await readData(current.outputPath) : null;
    const materialChanged = previousScript?._producer?.materialExecutionId !== materialExecutionId;
    const scriptAccepted = scriptChanged || materialChanged ? {
      ...scriptBusiness,
      _producer: {
        ...producer({ task: current, result: scriptBusiness }),
        materialExecutionId
      }
    } : previousScript;
    const openerSchemaPath = path.join(root, "contracts", "opener-narration.schema.json");
    const baseOpenerProducer = producer({ task: current, result: openerBusiness });
    const openerProducer = {
      ...baseOpenerProducer,
      inputs: [...new Set([...baseOpenerProducer.inputs, hashObject(scriptBusiness)])],
      contract: sha256(await readFile(openerSchemaPath))
    };
    openerProducer.taskDigest = pairedOpenerTaskDigest({
      scriptProducer: scriptAccepted._producer,
      openerProducer
    });
    const openerAccepted = { ...openerBusiness, _producer: openerProducer };
    await validateSchema(
      path.resolve(current.outputRecord.directory, current.outputRecord.manifest.outputSchema),
      scriptAccepted,
      current.outputPath
    );
    await validateSchema(openerSchemaPath, openerAccepted, paths.openerNarration);
    if (oldOutput && stableStringify(oldOutput) !== stableStringify(scriptBusiness)) {
      await markRepair("p2", "synthesize-narration", "正文发生实际修改，更新口播");
    }
    const oldOpener = await exists(paths.openerNarration) ? businessContent(await readData(paths.openerNarration)) : null;
    if (oldOpener && stableStringify(oldOpener) !== stableStringify(openerBusiness)) {
      await markRepair("p4", "opener", "片头口播发生实际修改，更新片头设计");
    }
    if (scriptChanged || materialChanged) await queueWrite(current.outputPath, scriptAccepted);
    if (scriptChanged || materialChanged || stableStringify(oldOpener) !== stableStringify(openerBusiness)) {
      await queueWrite(paths.openerNarration, openerAccepted);
    }
    if (publication) {
      const publicationPaths = getPublicationPaths(workspaceRoot, episodeId, targetId ?? "release-main");
      const schemaPath = path.join(root, "contracts/publication.schema.json");
      const publicationAccepted = { ...publication, _producer: {
        ...producer({ task: current, result: publication }), materialExecutionId,
        contract: sha256(await readFile(schemaPath))
      } };
      await validateSchema(schemaPath, publicationAccepted, publicationPaths.publicationDocument);
      const previous = await exists(publicationPaths.publicationDocument)
        ? businessContent(await readData(publicationPaths.publicationDocument)) : null;
      if ((materialChanged && !rewriteNarration) || stableStringify(previous) !== stableStringify(publication)) {
        await queueWrite(publicationPaths.publicationDocument, publicationAccepted);
        rawWrites.set(publicationPaths.publicationText, publicationTextFor(publication));
        await queueWrite(getStageWorkPaths(publicationPaths, "p1").returnRequest("produce-covers"), {
          target: "produce-covers", reason: "发布内容已接纳，完成对应封面交付", cueRefs: [], phase: "cover",
          ...(current.context?.returnRequest?.coverExampleAdoption
            ? { coverExampleAdoption: current.context.returnRequest.coverExampleAdoption } : {})
        });
      }
    }
    materials = { episodeId, materialExecutionId };
    const publicationInput = path.resolve(workspaceRoot, current.workOrder.scratchPath, "publication-input.md");
    if (publication && await exists(publicationInput)) {
      await assertProjectPaths({ root: workspaceRoot, files: [publicationInput], label: "P1发布调查输入" });
      rawWrites.set(path.join(workPaths.work, `attempt-${materialExecutionId}`, "publication-input.md"),
        await readFile(publicationInput, "utf8"));
    }
    outputSha256 = scriptAccepted._producer.outputSha256;
    consumedReturnPath = workPaths.returnRequest(current.node.id);
  } else {
    let acceptedBusiness = projectedPrimaryResult;
    const accepted = {
      ...acceptedBusiness,
      _producer: producer({ task: current, result: acceptedBusiness })
    };
    await validateSchema(
      path.resolve(current.outputRecord.directory, current.outputRecord.manifest.outputSchema),
      accepted,
      current.outputPath
    );
    if (["video-plan", "video-assets"].includes(current.mode)
      && (!oldOutput || stableStringify(oldOutput) !== stableStringify(projectedPrimaryResult))) {
      if (current.mode === "video-plan" && stableStringify(projectVideoProduction(oldOutput)) !== stableStringify(projectVideoProduction(projectedPrimaryResult))) {
        if (await exists(paths.videoManifest)) await markRepair("p4", "video-assets", "视频设计发生实际修改，更新受影响视频");
      }
      if (await exists(paths.finalVideo)) await markRepair("p4", "render", "剧情视频交付发生实际修改，更新成片");
    }
    if (current.workOrder.workflowId === "program" && current.mode === "program-plan") {
      if (current.context?.programRevision) {
        const requestPath = workPaths.returnRequest(current.node.id);
        const storedRequest = assertProgramRevisionRequest(
          await readData(requestPath),
          current.node.id
        );
        if (stableStringify(storedRequest) !== stableStringify(current.context.programRevision)) {
          throw new Error("P0修订请求在候选接纳期间发生变化");
        }
        await queueWrite(requestPath, {
          ...storedRequest,
          state: "accepting",
          expectedProgramSha256: hashObject(projectedPrimaryResult)
        });
      }
      const openerChanged = oldOutput && oldOutput.openerTemplate !== projectedPrimaryResult.openerTemplate;
      const visualChanged = oldOutput && oldOutput.visualPackage?.visualPackageId !== projectedPrimaryResult.visualPackage?.visualPackageId;
      const coverChanged = oldOutput && oldOutput.coverPackage?.coverPackageId !== projectedPrimaryResult.coverPackage?.coverPackageId;
      for (const episode of projectedPrimaryResult.episodes) {
        const episodePaths = getEpisodePaths(workspaceRoot, episode.episodeId);
        if (openerChanged && await exists(episodePaths.episodePackage)) {
          await markRepair("p4", "opener", "节目片头模板选择发生实际修改，更新片头设计", episodePaths);
        }
        if (visualChanged) {
          if (await exists(episodePaths.storyboard)) await markRepair("p3", "author", "节目画风实际改变，保留设计并更新需要改画的图片", episodePaths);
          if (await exists(episodePaths.episodePackage)) await markRepair("p4", "opener", "节目画风实际改变，更新片头图片", episodePaths);
          if (await exists(episodePaths.videoPlan)) await markRepair("p4", "video", "节目画风实际改变，更新视频首图与受影响设计", episodePaths);
          if (await exists(episodePaths.finalVideo)) await markRepair("p4", "render", "节目视觉包选择发生实际修改，更新成片外观", episodePaths);
        }
        if (visualChanged || coverChanged) {
          const publicationPaths = getPublicationPaths(workspaceRoot, episode.episodeId, "release-main");
          if (await exists(publicationPaths.publicationDocument)) await markRepair("p1", "produce-covers", "节目封面或视觉包选择发生实际修改，更新封面", publicationPaths, { phase: "cover" });
        }
      }
      await materializeEpisodeBriefs({
        root: workspaceRoot,
        systemRoot: root,
        plan: accepted,
        write: async (file, brief) => {
          const previous = await exists(file) ? businessContent(await readData(file)) : null;
          if (previous && stableStringify(previous) !== stableStringify(businessContent(brief))) {
            const episodePaths = getEpisodePaths(workspaceRoot, brief.episodeId);
            const node = brief.programForm === "historical-documentary" ? "author-documentary-narration" : "author-narration";
            await markRepair("p1", node, "单集任务发生实际修改，按当前任务修订受影响口播", episodePaths);
          }
          await queueWrite(file, brief);
        }
      });
    }
    await queueWrite(current.outputPath, accepted);
    outputSha256 = accepted._producer.outputSha256;
    if (current.workOrder.workflowId === "program" && current.mode === "program-plan") {
      consumedReturnPath = workPaths.returnRequest(current.node.id);
    }
    if (current.workOrder.workflowId === "narration" || ["video-plan", "video-assets"].includes(current.mode)) {
      consumedReturnPath = workPaths.returnRequest(current.node.id);
    }
  }
  if (updatedStoryboard) {
    if (updatedStoryboard.authorQuotes && current.mode !== "author-quotes") {
      const queryInput = ({ request, cueRange }) => hashObject({ request, cueRange });
      const previousRequests = new Map(collectQuoteRequests(priorStoryboard ?? {}).map(item => [item.id, queryInput(item)]));
      const currentRequests = new Map(collectQuoteRequests(updatedStoryboard).map(item => [item.id, queryInput(item)]));
      const quotes = updatedStoryboard.authorQuotes;
      const retained = quotes.items.filter(item =>
        currentRequests.has(item.id) && currentRequests.get(item.id) === previousRequests.get(item.id));
      if (retained.length !== quotes.items.length) {
        quotes.batches ??= [structuredClone({ items: quotes.items, receipt: quotes.receipt, _producer: quotes._producer })];
        quotes.items = retained;
        quotes._producer.outputSha256 = hashObject(businessContent(quotes));
      }
    }
    if (stableStringify(businessContent(priorStoryboard)) !== stableStringify(businessContent(updatedStoryboard))) {
      // P3's model deliberately omits render roles; read consumer manifests, not whole downstream stages.
      const consumerModel = { packages: await loadPackages(root, {
        moduleIds: new Set(["render-video"]),
        includeKinds: new Set(["template", "feature"]), stageScoped: true
      }) };
      if (await exists(paths.episodePackage)) {
        const { opener } = await readData(paths.episodePackage);
        if (stableStringify(businessContent(openerInputsFromBody(priorStoryboard, opener)))
          !== stableStringify(businessContent(openerInputsFromBody(updatedStoryboard, opener)))) {
          await markRepair("p4", "opener", "片头实际读取的正文内容发生修改，更新片头衔接");
        }
      }
      if (await exists(paths.videoPlan)) {
        const selected = new Set((await readData(paths.videoPlan)).spans.flatMap(({ beatIds }) => beatIds));
        const videoInputs = (story) => {
          const beats = story?.beats ?? [];
          const consumed = new Set(selected);
          for (const [index, beat] of beats.entries()) {
            if (!selected.has(beat.id)) continue;
            if (beats[index - 1]) consumed.add(beats[index - 1].id);
            if (beats[index + 1]) consumed.add(beats[index + 1].id);
          }
          const runs = (story?.templateRuns ?? []).filter(run => run.templateId !== "fullframe-narrative"
            && run.beatIds.some((id) => consumed.has(id)));
          const bindingIds = new Set([...consumed, ...runs.map(({ id }) => id)]);
          return businessContent({
            understanding: story?.understanding,
            beats: beats.map((beat) => ({ id: beat.id, cueRange: beat.cueRange, templateId: beat.templateId,
              ...(consumed.has(beat.id) ? { treatment: beat.treatment } : {}) })),
            templateRuns: runs,
            bindings: Object.fromEntries(Object.entries(story?.features?.["cue-sync"]?.bindings ?? {})
              .filter(([id]) => bindingIds.has(id)))
          });
        };
        if (stableStringify(videoInputs(priorStoryboard)) !== stableStringify(videoInputs(updatedStoryboard)))
          await markRepair("p4", "video", "视频选段的正文语义、范围、画面或前后接镜发生实际修改，修正受影响设计");
      }
      if (stableStringify(renderInputsFromBody(consumerModel, priorStoryboard)) !== stableStringify(renderInputsFromBody(consumerModel, updatedStoryboard))) {
        await markRepair("p4", "render", "正文交付发生实际修改，更新成片");
      }
      if (current.mode === "understanding" && priorStoryboard?.albumPlan) {
        await markRepair("p3", "director", "理解内容发生实际修改，修订受影响的视觉计划");
      }
    }
    await queueWrite(paths.storyboard, updatedStoryboard);
  }
  if (["treatment", "feature"].includes(current.mode)) {
    const updated = writes.get(paths.storyboard);
    const units = authorUnitsForStoryboard(updated);
    const oldUnits = authorUnitsForStoryboard(oldOutput);
    const changedIds = current.object.authorBatchIds ?? [current.object.authorUnitId];
    for (const changedId of changedIds) {
      const index = units.findIndex(unit => unit.id === changedId);
      const next = units[index + 1];
      if (changedIds.includes(next?.id)) continue;
      const previous = oldUnits.find(unit => unit.id === changedId);
      const latest = units[index];
      let inheritedInputChanged = false;
      if (next?.treatment) {
        const { cues } = await inspectP3Inputs(root, workspaceRoot, episodeId);
        const { programForm, openerTemplate } = await readData(getProgramPaths(workspaceRoot).programPlan);
        const inheritedInputs = async (storyboard, authorUnits, previousAuthorUnit) => authorPreviousTreatmentProducerInputsForResult({
          result: next.treatment,
          previousTreatmentInput: await previousTreatmentInputForAuthorUnit({
            root, model, previousAuthorUnit, authorUnit: next, authorUnits, storyboard, cues, programForm, openerTemplate,
            includeCamera: new Set(["continue", "motivated-reverse", "visual-match"])
              .has(next.treatment.assetRequests?.[0]?.cameraRelation)
          })
        });
        try {
          inheritedInputChanged = stableStringify(await inheritedInputs(priorStoryboard, oldUnits, previous))
            !== stableStringify(await inheritedInputs(updated, units, latest));
        } catch (error) {
          // A changed predecessor may no longer supply the next page's old dependency.
          // Repair that consumer instead of rejecting the valid current author result.
          if (error.code !== "author-previous-input-missing") throw error;
          inheritedInputChanged = true;
        }
      }
      if (inheritedInputChanged) {
        const requestPath = workPaths.returnRequest("author");
        const request = writes.get(requestPath) ?? (await exists(requestPath) ? await readData(requestPath) : null);
        const pendingAuthorUnitIds = [...new Set([...(request?.pendingAuthorUnitIds ?? []).filter(id => id !== changedId), next.id])];
        await queueWrite(requestPath, { target: "author", reason: request?.reason ?? `前一单元 ${changedId} 的实际承接末态改变，修订 ${next.id} 的承接部分`, cueRefs: [],
          revisionScope: "body-redesign", redesignState: "pending-author", baselineVisualPlanSha256: hashObject(directorResultSlice(updated)),
          selectedBeatIds: [...new Set([...(request?.selectedBeatIds ?? []), ...next.beatIds])], pendingAuthorUnitIds });
        if (consumedReturnPath === requestPath) consumedReturnPath = null;
      }
    }
  }
  if (current.mode === "ai-subtitles" && stableStringify(oldOutput) !== stableStringify(projectedPrimaryResult)) {
    await markRepair("p2", "finalize-narration", "字幕发生实际修改，更新口播交付");
  }
  return commitAcceptance({
    workspaceRoot, workPaths, writes, rawWrites,
    cleanup: [workPaths.workOrder, workPaths.candidate, ...(consumedReturnPath ? [consumedReturnPath] : [])],
    scratchPath: current.mode !== "ai-narration" && current.workOrder.scratchPath
      ? path.resolve(workspaceRoot, current.workOrder.scratchPath) : null,
    materials,
    verify: async () => {
      for (const [file, before] of writeBaselines) {
        const actual = await exists(file) ? hashObject(await readData(file)) : null;
        if (actual !== before) throw new Error(`接纳目标在准备期间发生变化: ${file}`);
      }
      if (hashObject(await readData(workPaths.workOrder)) !== savedHash
        || hashObject(await readData(workPaths.candidate)) !== candidateHash) {
        throw new Error("接纳期间工作单或候选已变化，保留现场");
      }
      const latest = await resolveStageCurrent({ root, workspaceRoot, episodeId, programId, targetId, stageId, platform, segmentId, nodeId, model });
      if (latest.kind !== "task") throw new Error("接纳期间当前任务已变化，保留候选");
      assertTaskContinuity(saved, latest.workOrder);
      if (current.mode === "video-plan") {
        if (hashObject(businessContent(current.context.storyboard.opener))
          !== hashObject(businessContent(latest.context?.storyboard?.opener ?? null)))
          throw new Error("接纳期间片头已变化，保留视频候选，先核对受影响接镜");
        await assertVideoOpenerInput({ workspaceRoot, workOrder: saved,
          result: primaryResult, opener: latest.context.storyboard.opener });
      }
    },
    result: {
    kind: "accepted",
    subject: current.workOrder.subject,
    workflowId: current.workOrder.workflowId,
    stageId: current.workOrder.stageId,
    taskId: current.workOrder.taskId,
    output: current.allowedWrite ?? current.workOrder.allowedWrite,
    outputSha256
    }
  });
}

export { acceptCandidate };
