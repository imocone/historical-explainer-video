import { assertPublicationRevisionRequest, sealedPublicationBusinessForRevision } from "./publication-requests.mjs";
import { getPublicationPaths } from "../../packages/publication-paths.mjs";
import { resolvePublicationCurrent } from "./state-publication.mjs";
import { episodeReferenceVideos } from "../../packages/reference-program.mjs";
import { readStageRestart, restartPending } from "./stage-restart.mjs";
import path from "node:path";
import { narrationEpisodeProjection } from "../../packages/program-brief.mjs";
import {
  getEpisodePaths,
  getProgramPaths,
  getStageWorkPaths
} from "../../packages/workspace-paths.mjs";
import { hashObject, readData, sha256 } from "../../packages/program-utils.mjs";
import { programOpenerTemplateId } from "../../packages/opener-template-selection.mjs";
import { resolveReusableNarrationMaterials, validateReusableNarrationMaterials } from ".././p1-revision-materials.mjs";
import {
  REVISION_REQUEST_ID,
  WorkflowInputError,
  assertProjectPaths,
  exists,
  importModule,
  relative
} from "./files.mjs";

import { loadStageModel } from "./model.mjs";
import { controllerSpecFor, prepareNodeAssembly } from "./implementations.mjs";
import { businessContent } from "./storyboard.mjs";
import { aiTask, programInvocationTask, programTask } from "./tasks.mjs";
import { readP1Delivery, readScriptPackage } from "./artifacts.mjs";
import { controllerInputs } from "./author-tasks.mjs";

const narrationResearchSlice = ({ programPlan }) => ({
  programForm: programPlan.programForm,
  editorialDirection: programPlan.editorialDirection,
  narrativeTone: programPlan.narrativeTone,
  ...(programPlan.programForm === "historical-documentary"
    ? {
        ...(programPlan.maxDurationSeconds !== undefined
          ? { maxDurationSeconds: programPlan.maxDurationSeconds }
          : {}),
        documentaryContract: programPlan.documentaryContract,
        seriesConcept: programPlan.seriesConcept,
        artisticApproach: programPlan.artisticApproach,
        seriesNarrativeStrategy: programPlan.seriesNarrativeStrategy,
        storyWorld: structuredClone(programPlan.storyWorld)
      }
    : {}),
  ...(programPlan.researchLibrary ? {
    researchLibrary: { notebookId: programPlan.researchLibrary.notebookId }
  } : {})
});

const currentP0NarrationHandoff = async ({ workspaceRoot, episodeId }) => {
  const programPlanBusiness = businessContent(await readData(getProgramPaths(workspaceRoot).programPlan));
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const fullEpisodeBrief = businessContent(await readData(paths.episodeBrief));
  const episodeBrief = narrationEpisodeProjection(fullEpisodeBrief);
  const programPlan = narrationResearchSlice({
    programPlan: programPlanBusiness
  });
  if (programPlanBusiness.referenceProgram) {
    programPlan.referenceVideos = await episodeReferenceVideos(programPlanBusiness, episodeId);
  }
  return {
    episodeBrief,
    fullEpisodeBrief,
    programPlan,
    programPlanBusiness
  };
};

const resolveNarrationCurrent = async ({
  root,
  workspaceRoot = root,
  episodeId,
  model = null,
  resourceCache = model?.resourceCache ?? new Map()
}) => {
  if (!model?.stageId) {
    let current = null;
    for (const stageId of ["p1", "p2"]) {
      current = await resolveNarrationCurrent({
        root,
        workspaceRoot,
        episodeId,
        model: await loadStageModel(root, { stageId, resourceCache })
      });
      if (current.kind !== "complete") return current;
    }
    return current;
  }
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const publicationPaths = getPublicationPaths(workspaceRoot, episodeId, "release-main");
  model = { ...model, stageRestart: await readStageRestart({ workspaceRoot, episodeId, stageId: model.stageId }) };
  const pendingNodes = await Promise.all(model.orderedNodes.map(node => exists(getStageWorkPaths(paths, model.stageId).returnRequest(node.id))));
  if (model.stageId === "p1") pendingNodes.push(await exists(path.join(getStageWorkPaths(paths, "p1").work, "cover-regeneration.yaml")));
  const deliveries = model.stageId === "p1" ? [paths.scriptPackage, paths.openerNarration, publicationPaths.publicationDocument, publicationPaths.publicationText, publicationPaths.coverYoutube, publicationPaths.coverVertical, publicationPaths.coverReceipt]
    : [paths.narrationPackage, paths.narrationText, paths.narrationAudio, paths.narrationSubtitles];
  if (!model.stageRestart && !pendingNodes.some(Boolean) && (await Promise.all(deliveries.map(exists))).every(Boolean)) {
    return { kind: "complete", episodeId, message: "当前阶段交付齐备", output: relative(workspaceRoot, deliveries[0]) };
  }
  const stagePaths =
    model.stageId === "p1"
      ? [paths.episodeBrief, paths.scriptPackage, paths.openerNarration]
      : [
          paths.scriptPackage,
          paths.ttsInput,
          paths.ttsResult,
          paths.rawNarration,
          paths.subtitleCorrection,
          paths.narrationText,
          paths.narrationAudio,
          paths.narrationSubtitles,
          paths.subtitleQuality,
          paths.narrationPackage
        ];
  await assertProjectPaths({
    root: workspaceRoot,
    label: "Narration Workflow 当前阶段路径",
    files: stagePaths
  });

  const preparedByNodeId = new Map();
  const prepareFor = async (node) => {
    if (!preparedByNodeId.has(node.id)) {
      preparedByNodeId.set(
        node.id,
        await prepareNodeAssembly({
          model,
          node,
          storyboard: {},
          selection: selectedOpenerTemplateId
            ? { segmentTemplateId: selectedOpenerTemplateId, coverPackageId: selectedCoverPackageId }
            : {}
        })
      );
    }
    return preparedByNodeId.get(node.id);
  };
  const descriptorFor = async (node) => (await prepareFor(node)).descriptor;
  const attachTaskPolicy = async (task, descriptor) => {
    if (task.runner !== "ai") return { ...task, descriptor };
    const ancestors = model.ancestorsByNodeId.get(task.node.id) ?? new Set();
    const allowedReturnTargets = [];
    for (const targetNode of model.orderedNodes) {
      if (!ancestors.has(targetNode.id)) continue;
      const targetDescriptor = await descriptorFor(targetNode);
      if (
        (descriptor.returnTo ?? []).some(
          (policy) => policy.primitive === targetDescriptor.primitive
        )
      ) {
        allowedReturnTargets.push(targetNode.id);
      }
    }
    return { ...task, descriptor: descriptor, allowedReturnTargets };
  };

  let episodeBrief = null;
  let programPlan = null;
  let selectedOpenerTemplateId = null;
  let selectedCoverPackageId = null;
  let sealedScriptPackage = null;
  if (model.stageId === "p1") {
    const rawEpisodeBrief = await readData(
      getEpisodePaths(workspaceRoot, episodeId).episodeBrief
    ).catch(() => null);
    const expectedAuthorNodeId =
      rawEpisodeBrief?.programForm === "historical-documentary"
        ? "author-documentary-narration"
        : "author-narration";
    try {
      const handoff = await currentP0NarrationHandoff({
        root,
        workspaceRoot,
        episodeId,
        resourceCache
      });
      episodeBrief = handoff.episodeBrief;
      programPlan = handoff.programPlan;
      selectedOpenerTemplateId = programOpenerTemplateId(handoff.programPlanBusiness);
      selectedCoverPackageId = handoff.programPlanBusiness.coverPackage?.coverPackageId;
    } catch (error) {
      throw new WorkflowInputError({
        workflowId: model.workflowRecord.id,
        stageId: "p1",
        nodeId: expectedAuthorNodeId,
        upstreamStageId: "p0",
        cause: error
      });
    }
  } else {
    try {
      sealedScriptPackage = await readScriptPackage({
        root,
        workspaceRoot,
        episodeId
      });
    } catch (error) {
      return {
        kind: "blocked-upstream",
        upstreamStageId: "p1",
        nodeId: "author-narration",
        reason: error.message
      };
    }
  }
  const state = {
    scriptPackage: sealedScriptPackage,
    ttsResult: null,
    subtitleCorrection: null,
    narrationPackage: null
  };
  const roleState = {
    "script-package": "scriptPackage",
    "tts-result": "ttsResult",
    "subtitle-correction": "subtitleCorrection"
  };
  const inputNameByRole = {
    "script-package": "scriptPackage",
    "tts-result": "ttsResult",
    "subtitle-correction": "subtitleCorrection"
  };
  const requireUpstream = (value, node, label) => {
    if (!value) throw new Error(`Workflow 节点 ${node.id} 缺少前置成果: ${label}`);
    return value;
  };
  const projectionForRole = ({ role, node }) => {
    if (role === "episode-brief") {
      return {
        inputs: { episodeBrief },
        context: { episodeBrief },
        inputHashes: [hashObject(episodeBrief)]
      };
    }
    if (role === "program-plan") {
      return {
        inputs: { programPlan },
        context: { programPlan },
        inputHashes: [hashObject(programPlan)]
      };
    }
    const stateKey = roleState[role];
    if (!stateKey) throw new Error(`${node.id} 使用了 Narration Runtime 未投影的读取角色: ${role}`);
    const artifact = requireUpstream(state[stateKey], node, role);
    const business = businessContent(artifact);
    const inputName = inputNameByRole[role];
    const extra = role === "script-package" ? { scriptPackageSha256: hashObject(business) } : {};
    return {
      inputs: { [inputName]: business, ...extra },
      context: { [inputName]: business, ...extra },
      inputHashes: [hashObject(business)]
    };
  };
  const projectionsFor = ({ prepared, node }) => {
    return Object.fromEntries(
      controllerSpecFor(prepared.record).reads.map(({ role }) => [
        role,
        projectionForRole({ role, node })
      ])
    );
  };
  const outputPathForPrimitive = (primitive) =>
    ({
      "ai-narration": paths.scriptPackage,
      "program-narration-synthesize": paths.ttsResult,
      "ai-subtitles": paths.subtitleCorrection,
      "program-narration-finalize": paths.narrationPackage
    })[primitive];
  const stateKeyForPrimitive = (primitive) =>
    ({
      "ai-narration": "scriptPackage",
      "program-narration-synthesize": "ttsResult",
      "ai-subtitles": "subtitleCorrection",
      "program-narration-finalize": "narrationPackage"
    })[primitive];

  const buildProgramTask = async ({ node, prepared, controlInputs = {}, controlContext = {} }) => {
    const projected = controllerInputs({
      record: prepared.record,
      projections: projectionsFor({ prepared, node }),
      controlInputs,
      controlContext: { episodeId, ...controlContext }
    });
    return programTask({
      root,
      model,
      workspaceRoot,
      episodeId,
      node,
      record: prepared.record,
      assembly: prepared.assembly,
      ...projected,
      outputPath: outputPathForPrimitive(prepared.descriptor.primitive),
      context: { ...projected.context, workspaceRoot, episodeId }
    });
  };
  const stageProgram = async ({ node, prepared }) => {
    const task = await buildProgramTask({ node, prepared });
    const primitive = prepared.descriptor.primitive;
    if (returnRequests.has(node.id)) task.returnRequestPath = getStageWorkPaths(paths, model.stageId).returnRequest(node.id);
    const entry = await importModule(
      path.resolve(prepared.record.directory, prepared.record.manifest.programEntry)
    );
    if (returnRequests.has(node.id) && primitive === "program-narration-finalize") return { task, readyToRun: true, reason: returnRequests.get(node.id).reason };
    if (typeof entry.inspect !== "function") {
      if (!(await exists(task.outputPath))) {
        return { task, reason: `${path.basename(task.outputPath)} 尚未完成` };
      }
    } else {
      let inspection;
      try {
        inspection = await entry.inspect({
          root: workspaceRoot,
          systemRoot: root,
          episodeId,
          task: programInvocationTask(task)
        });
      } catch (error) {
        return { task, reason: error.message, hardFailure: true };
      }
      if (!inspection?.valid) {
        return {
          task,
          reason: inspection?.reason ?? `${path.basename(task.outputPath)} 尚未完成`,
          authorizationRequired: inspection?.authorizationRequired === true,
          unknownExternal: inspection?.unknownExternal === true,
          waitingExternal: inspection?.waitingExternal === true,
          retryAfterMinutes: inspection?.retryAfterMinutes,
          remoteFailed: inspection?.remoteFailed === true,
          hardFailure: inspection?.hardFailure === true,
          readyToRun: inspection?.readyToRun === true,
          paidCallRequired: inspection?.paidCallRequired
        };
      }
      task.paidCallRequired = inspection?.paidCallRequired;
    }
    if (returnRequests.has(node.id)) return { task, readyToRun: true, paidCallRequired: false, reason: returnRequests.get(node.id).reason };
    try {
      const artifact = await readData(task.outputPath);
      if (restartPending(model, artifact)) return { task, readyToRun: true, reason: "本阶段重跑尚未交付当前节点" };
      return { task, artifact };
    } catch (error) {
      return {
        task,
        reason: error.message,
        paidCallRequired: task.paidCallRequired,
        authorizationRequired: false
      };
    }
  };

  const buildAiTask = async ({
    node,
    prepared,
    controlInputs = {},
    controlContext = {},
    controlInputHashes = []
  }) => {
    const projected = controllerInputs({
      record: prepared.record,
      projections: projectionsFor({ prepared, node }),
      controlInputs,
      controlContext: { episodeId, ...controlContext },
      controlInputHashes
    });
    const outputPath = outputPathForPrimitive(prepared.descriptor.primitive);
    const task = await aiTask({
      root,
      model,
      workspaceRoot,
      episodeId,
      node,
      record: prepared.record,
      assembly: prepared.assembly,
      ...projected,
      outputPath,
      allowedWrite:
        prepared.descriptor.primitive === "ai-narration"
          ? `${relative(workspaceRoot, outputPath)} + ${relative(workspaceRoot, paths.openerNarration)} + ${relative(workspaceRoot, publicationPaths.publicationDocument)} + ${relative(workspaceRoot, publicationPaths.publicationText)}`
          : relative(workspaceRoot, outputPath),
      taskId: `${episodeId}/${node.id}`,
      mode: prepared.descriptor.primitive,
      context: projected.context,
      assemblyRuleRole:
        prepared.descriptor.primitive === "ai-narration" ? "copyRules" : "authorRules"
    });
    return attachTaskPolicy(task, prepared.descriptor);
  };
  const stageAi = async ({ node, prepared }) => {
    let returnRequest = returnRequests.get(node.id) ?? null;
    const publicationRevision = ["publication-copy", "publication-all", "cover-content"];
    if (!returnRequest && prepared.descriptor.primitive === "ai-narration"
      && await exists(paths.scriptPackage) && await exists(paths.openerNarration)
      && !restartPending(model, await readData(paths.scriptPackage))
      && !(await exists(publicationPaths.publicationDocument))) {
      const script = await readData(paths.scriptPackage);
      returnRequest = { target: node.id, reason: "保留正式正文与片头，由原作者补齐发布文案与封面构思",
        cueRefs: [], revisionScope: "publication-all",
        reusedNarrationMaterials: await resolveReusableNarrationMaterials({ workspaceRoot, episodeId, episodeBrief,
          materialExecutionId: script._producer?.materialExecutionId }) };
    }
    const {
      reusedNarrationMaterials: pinnedNarrationMaterials,
      reusedSubtitleTiming: pinnedSubtitleTiming,
      ...authorReturnRequest
    } = returnRequest ?? {};
    let revisionInputs = {};
    let revisionInputHashes = returnRequest ? [hashObject(authorReturnRequest)] : [];
    if (publicationRevision.includes(returnRequest?.revisionScope)) {
      const { scriptPackage, openerNarration } = await readP1Delivery({ root, workspaceRoot, episodeId });
      const reusedNarrationMaterials = await validateReusableNarrationMaterials({ workspaceRoot, episodeId,
        episodeBrief, materials: pinnedNarrationMaterials });
      revisionInputs = { reusedNarrationMaterials, materialExecutionId: scriptPackage._producer.materialExecutionId,
        currentScriptPackage: businessContent(scriptPackage), currentOpenerNarration: businessContent(openerNarration),
        ...(await exists(publicationPaths.publicationDocument)
          ? { currentPublication: (await sealedPublicationBusinessForRevision({ paths: publicationPaths,
              request: returnRequest.baselinePublicationSha256 ? returnRequest : null })).business } : {}) };
      revisionInputHashes.push(...Object.values(revisionInputs).map(hashObject));
    } else if (returnRequest?.revisionScope === "subtitles") {
      const timing = pinnedSubtitleTiming;
      if (
        timing?.audioSha256 !== state.ttsResult?.rawAudio?.sha256 ||
        timing?.narrationSha256 !== sha256(state.scriptPackage?.narration ?? "")
      ) {
        throw new Error("字幕返工时间证据与当前正式正文或音频不一致");
      }
      revisionInputs = { reusedSubtitleTiming: timing };
      revisionInputHashes.push(hashObject(timing));
    } else if (["opener", "narration"].includes(returnRequest?.revisionScope)) {
      const { scriptPackage, openerNarration } = await readP1Delivery({
        root,
        workspaceRoot,
        episodeId
      });
      const reusedNarrationMaterials = await validateReusableNarrationMaterials({
        workspaceRoot,
        episodeId,
        episodeBrief,
        materials: pinnedNarrationMaterials,
        allowAnswerAndEndingRevision: true
      });
      revisionInputs = {
        reusedNarrationMaterials,
        currentScriptPackage: businessContent(scriptPackage),
        currentOpenerNarration: businessContent(openerNarration),
        ...(await exists(publicationPaths.publicationDocument)
          ? { currentPublication: businessContent(await readData(publicationPaths.publicationDocument)) } : {})
      };
      revisionInputHashes.push(...Object.values(revisionInputs).map(hashObject));
    } else if (returnRequest && prepared.descriptor.primitive === "ai-narration") {
      if (await exists(paths.scriptPackage)) {
        const currentScript = await readData(paths.scriptPackage);
        revisionInputs.currentScriptPackage = businessContent(currentScript);
        if (currentScript._producer?.materialExecutionId) revisionInputs.materialExecutionId = currentScript._producer.materialExecutionId;
      }
      if (await exists(paths.openerNarration)) revisionInputs.currentOpenerNarration = businessContent(await readData(paths.openerNarration));
      revisionInputHashes.push(...Object.values(revisionInputs).map(hashObject));
    }
    const task = await buildAiTask({
      node,
      prepared,
      controlInputs: returnRequest ? { returnRequest: authorReturnRequest, ...revisionInputs } : {},
      controlContext: returnRequest
        ? { returnRequest: authorReturnRequest, ...revisionInputs }
        : {},
      controlInputHashes: revisionInputHashes
    });
    if (returnRequest) {
      return { task, reason: `上游退回 ${node.id}：${returnRequest.reason}` };
    }
    const outputExists = await exists(task.outputPath);
    if (model.stageRestart && (!outputExists || restartPending(model, await readData(task.outputPath))))
      return { task, reason: "本阶段重跑：按当前上游重新完成本节点" };
    const openerExists =
      prepared.descriptor.primitive === "ai-narration"
        ? await exists(paths.openerNarration)
        : false;
    if (!outputExists && !openerExists) {
      return { task, reason: `尚无正式 ${path.basename(task.outputPath)}` };
    }
    if (!outputExists || (prepared.descriptor.primitive === "ai-narration" && !openerExists)) {
      return {
        task,
        reason: "P1现有正式正文与片头不完整；只能由用户明确要求完整重跑",
        hardFailure: true
      };
    }
    try {
      const artifact = await readData(task.outputPath);
      if (prepared.descriptor.primitive === "ai-narration") {
        await readP1Delivery({ root, workspaceRoot, episodeId });
      }
      return { task, artifact };
    } catch (error) {
      const narrationFailure = prepared.descriptor.primitive === "ai-narration";
      return {
        task,
        reason: narrationFailure
          ? `${error.message}；现有P1不能由普通next覆盖，只能由用户明确要求完整重跑`
          : error.message,
        hardFailure: narrationFailure
      };
    }
  };

  const returnRequests = new Map();
  for (const node of model.orderedNodes) {
    if (node.id === "produce-covers") continue;
    if (
      ["historical-explainer", "historical-documentary"].includes(node.condition) &&
      node.condition !== episodeBrief?.programForm
    )
      continue;
    const nodeStageId = model.workflowRecord.stageByNodeId.get(node.id);
    const workPaths = getStageWorkPaths(paths, nodeStageId);
    const requestPath = workPaths.returnRequest(node.id);
    if (!(await exists(requestPath))) continue;
    const request = await readData(requestPath);
    if (request.target !== node.id) throw new Error(`上游退回控制记录的 target 必须是 ${node.id}`);
    if (typeof request.reason !== "string" || !request.reason.trim()) {
      throw new Error(`上游退回 ${node.id} 缺少 reason`);
    }
    if (!Array.isArray(request.cueRefs) || request.cueRefs.length !== 0) {
      throw new Error(`Narration Workflow 上游退回 ${node.id} 的 cueRefs 必须为空`);
    }
    if (
      request.revisionScope != null &&
      !(
        (["author-narration", "author-documentary-narration"].includes(node.id) &&
          ["opener", "narration", "full", "publication-copy", "publication-all", "cover-content"].includes(request.revisionScope)) ||
        (node.id === "author-subtitles" && request.revisionScope === "subtitles")
      )
    ) {
      throw new Error(`Narration Workflow 不支持的定点返工范围: ${request.revisionScope}`);
    }
    if (
      request.revisionScope != null &&
      !REVISION_REQUEST_ID.test(request.revisionRequestId ?? "")
    ) {
      throw new Error("Narration Workflow P1返工请求缺少稳定revisionRequestId");
    }
    if (
      request.exactOpenerNarration != null &&
      (!["opener", "narration"].includes(request.revisionScope) ||
        typeof request.exactOpenerNarration !== "string" ||
        !request.exactOpenerNarration.trim())
    ) {
      throw new Error("Narration Workflow 用户指定片头原句非法");
    }
    if (
      ["opener", "narration"].includes(request.revisionScope) &&
      (!request.reusedNarrationMaterials ||
        typeof request.reusedNarrationMaterials !== "object" ||
        Array.isArray(request.reusedNarrationMaterials))
    ) {
      throw new Error("Narration Workflow 口播返工缺少固定旧材料");
    }
    if (request.reusedNarrationMaterials != null && !["opener", "narration", "publication-copy", "publication-all", "cover-content"].includes(request.revisionScope)) {
      throw new Error("Narration Workflow 当前返工范围不使用固定旧材料");
    }
    if (["publication-copy", "publication-all", "cover-content"].includes(request.revisionScope)) assertPublicationRevisionRequest(request);
    returnRequests.set(node.id, request);
  }

  for (const node of model.orderedNodes) {
    if (
      ["historical-explainer", "historical-documentary"].includes(node.condition) &&
      node.condition !== episodeBrief?.programForm
    )
      continue;
    if (node.id === "produce-covers") return resolvePublicationCurrent({ root, workspaceRoot, episodeId, model });
    const prepared = await prepareFor(node);
    const { primitive } = prepared.descriptor;
    const outputPath = outputPathForPrimitive(primitive);
    if (!outputPath) throw new Error(`Narration Workflow 原语没有运行时输出映射: ${primitive}`);
    if (!returnRequests.has(node.id) && await exists(outputPath)
      && !restartPending(model, await readData(outputPath))
      && (primitive !== "ai-narration" || (await exists(paths.openerNarration) && await exists(publicationPaths.publicationDocument)))
      && (primitive !== "program-narration-synthesize" || await exists(paths.rawNarration))
      && (primitive !== "program-narration-finalize" || (
        await exists(paths.narrationText) && await exists(paths.narrationAudio) && await exists(paths.narrationSubtitles)
      ))) {
      state[stateKeyForPrimitive(primitive)] = await readData(outputPath);
      continue;
    }

    if (prepared.record.manifest.runner === "ai") {
      const result = await stageAi({ node, prepared });
      if (!result.artifact) {
        return {
          ...result.task,
          reason: result.reason,
          hardFailure: result.hardFailure === true
        };
      }
      state[stateKeyForPrimitive(primitive)] = result.artifact;
      continue;
    }

    const result = await stageProgram({ node, prepared });
    if (!result.artifact) {
      return {
        ...result.task,
        descriptor: prepared.descriptor,
        reason: result.reason,
        authorizationRequired: result.authorizationRequired,
        unknownExternal: result.unknownExternal,
        waitingExternal: result.waitingExternal,
        retryAfterMinutes: result.retryAfterMinutes,
        remoteFailed: result.remoteFailed,
        hardFailure: result.hardFailure,
        readyToRun: result.readyToRun,
        paidCallRequired: result.paidCallRequired
      };
    }
    state[stateKeyForPrimitive(primitive)] = result.artifact;
  }
  return {
    kind: "complete",
    episodeId,
    message: "当前 Workflow 全部完成",
    output: relative(workspaceRoot, paths.narrationPackage)
  };
};

export { currentP0NarrationHandoff, resolveNarrationCurrent };
