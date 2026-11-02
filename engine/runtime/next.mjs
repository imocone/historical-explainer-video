import {configureVideo} from './video-settings.mjs';
import { recoverProgramCompletion } from "./program-execution.mjs";
import { commitAcceptance, recoverAcceptance, withWorkflowWrite } from "./acceptance-commit.mjs";
import { rm, rmdir } from "node:fs/promises";
import { atomicWriteData, hashObject } from "../../packages/program-utils.mjs";
import path from "node:path";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { assertProjectPaths, exists, importModule, initializeMissingSourceAssets } from "./files.mjs";
import { programInvocationTask } from "./tasks.mjs";
import { validateSchema } from "./schema.mjs";
import { loadStageModel } from "./model.mjs";
import { resolveStageCurrent } from "./status.mjs";
import { validateNextOptions } from "./next-options.mjs";
import { prepareProgramRevision } from "./revise-program.mjs";
import {
  prepareNarrationReplacement,
  prepareNarrationRevision,
  prepareSubtitleRevision
} from "./revise-narration.mjs";
import { preparePublicationRevision, cancelCoverRegeneration as cancelCoverRequest } from "./revise-publication.mjs";
import { prepareBodyRedesign, prepareDirectorRevision, cancelDirectorRevision as cancelDirectorRequest } from "./revise-body.mjs";
import { prepareQuoteRevision } from "./quote-requests.mjs";
import { executeCurrentTask } from "./execute.mjs";
import {configureSoundEffects} from './sound-effects.mjs';
async function prepareNext({
  root,
  workspaceRoot = root,
  episodeId,
  programId,
  targetId,
  stageId,
  platform = null,
  segmentId = null,
  nodeId = null,
  claim = null,
  reviseProgram = false,
  reviseOpener = false,
  openerText = null,
  reviseNarration = false,
  reviseSubtitles = false,
  replaceNarrationRevision = false,
  rerunNarration = false,
  replaceFullRerun = false,
  redesignBody = false,
  reviseQuotes = false,
  reviseDirector = false,
  replaceBodyRedesign = false,
  cancelDirectorRevision = false,
  redesignBeatIds = [],
  revisePublication = false,
  reviseVideo = false,
  reviseCover = false,
  revisionReason = null,
  publicationFields = [],
  regenerateCover = false,
  replaceCoverTask = false,
  coverRecord = null,
  cancelCoverRegeneration = false,
  adoptCoverExamples = false,
  coverVariants = [],
  authorizePaidTts = false
}) {
  ({ redesignBeatIds } = await validateNextOptions({
    stageId,
    segmentId,
    claim,
    reviseProgram,
    reviseOpener,
    openerText,
    reviseNarration,
    reviseSubtitles,
    replaceNarrationRevision,
    rerunNarration,
    replaceFullRerun,
    redesignBody,
    reviseQuotes,
    reviseDirector,
    replaceBodyRedesign,
    cancelDirectorRevision,
    redesignBeatIds,
    revisePublication,
    reviseVideo,
    reviseCover,
    revisionReason,
    publicationFields,
    regenerateCover,
    replaceCoverTask,
    coverRecord,
    cancelCoverRegeneration,
    adoptCoverExamples,
    coverVariants,
    authorizePaidTts,
  }));
  if (nodeId && stageId !== "p4") throw new Error("--node只用于P4");
  if (reviseVideo && nodeId && nodeId !== "video") throw new Error("视频重作只能选择video节点");
  if (reviseVideo) nodeId = "video";
  if (stageId === "p4" && reviseOpener) {
    if (nodeId && nodeId !== "opener") throw new Error("片头返工只能选择opener节点");
    nodeId = "opener";
  }
  if (cancelCoverRegeneration) return { cancelled: await cancelCoverRequest({ root, workspaceRoot, episodeId, targetId }) };
  if (cancelDirectorRevision) return { cancelDirectorRevision: true, root, workspaceRoot, episodeId };
  const model = await loadStageModel(root, { stageId, resourceScope: "stage" });
  if (stageId === "p3" && !redesignBody) await prepareDirectorRevision({ root, workspaceRoot, episodeId, model,
    reviseDirector, replaceBodyRedesign, selectedBeatIds: redesignBeatIds, revisionReason });
  if (stageId === "p3") await prepareQuoteRevision({ root, workspaceRoot, episodeId, model,
    reviseQuotes, selectedBeatIds: redesignBeatIds, revisionReason });
  if (reviseProgram)
    await prepareProgramRevision({ root, workspaceRoot, programId, stageId, reviseProgram, model });
  let { p1AuthorNodeId, p1FullRerunReason, preResolvedP1Replacement } =
    stageId === "p1"
      ? await prepareNarrationReplacement({
          root,
          workspaceRoot,
          episodeId,
          stageId,
          openerText,
          replaceNarrationRevision,
          rerunNarration,
          replaceFullRerun,
          resourceCache: model.resourceCache
        })
      : { p1AuthorNodeId: null, p1FullRerunReason: null, preResolvedP1Replacement: null };
  let { current } = await resolveNextCurrent({
    root,
    workspaceRoot,
    episodeId,
    programId,
    targetId,
    stageId,
    model,
    platform,
    segmentId,
    nodeId,
    preResolvedP1Replacement
  });
  let preExecuted = [];
  if (replaceCoverTask) {
    if (current.kind === "task" && current.runner === "program" && current.programPhase === "cover") {
      const entry = await importModule(current.entryPath);
      await entry.replaceGeneration({ root: workspaceRoot, episodeId, targetId,
        task: programInvocationTask(current), variant: coverVariants[0], record: coverRecord });
      current = await resolveStageCurrent({ root, workspaceRoot, episodeId, programId, targetId, stageId, model });
    } else if (!["complete", "stage-complete"].includes(current.kind)) {
      throw new Error("当前不是P1封面替换相位，保留原任务");
    }
  }
  if (reviseVideo) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, "p4");
    const requestPath = workPaths.returnRequest("video");
    if (!(await exists(paths.videoPlan))) {
      throw new Error("没有已接纳的视频设计；请用普通 next --stage p4 创作");
    }
    const existingRequest = await exists(requestPath);
    if (!existingRequest) {
      const activeFiles = (reviseVideo ? ["video", "video-assets"] : ["opener", "video", "video-assets"]).flatMap(id => {
        const work = getStageWorkPaths(paths, "p4", null, id);
        return [work.workOrder, work.candidate];
      });
      await assertProjectPaths({ root: workspaceRoot, label: "P4视频设计重作路径",
        files: [paths.videoPlan, requestPath, ...activeFiles] });
      if ((await Promise.all(activeFiles.map(exists))).some(Boolean)) {
        throw new Error("P4当前作者仍有未收口工作单或候选，先完成或明确重置本阶段");
      }
      await atomicWriteData(requestPath, {
        target: "video",
        reason: "用户明确要求从当前正式正文重新划定剧情范围并重做视频设计",
        cueRefs: []
      });
    }
    try {
      if (!existingRequest) {
        current = await resolveStageCurrent({ root, workspaceRoot, episodeId, programId,
          targetId, stageId, nodeId, model });
      }
      if (current.kind !== "task" || current.runner !== "ai" || current.workOrder?.nodeId !== "video") {
        throw new Error("P4视频设计重作没有形成唯一 video 工作单");
      }
      await validateSchema(path.join(root, "contracts", "work-order.schema.json"), current.workOrder, "work-order");
    } catch (error) {
      if (!existingRequest) await rm(requestPath, { force: true });
      throw error;
    }
  }
  if (reviseSubtitles)
    ({ current } = await prepareSubtitleRevision({
      root,
      workspaceRoot,
      episodeId,
      stageId,
      reviseSubtitles,
      model,
      current
    }));
  if (reviseOpener || reviseNarration || rerunNarration)
    ({ current } = await prepareNarrationRevision({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      stageId,
      reviseOpener,
      openerText,
      reviseNarration,
      rerunNarration,
      model,
      p1AuthorNodeId,
      p1FullRerunReason,
      preResolvedP1Replacement,
      current
    }));
  if (revisePublication || reviseCover || regenerateCover || adoptCoverExamples)
    ({ current } = await preparePublicationRevision({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      stageId,
      revisePublication,
      reviseCover,
      revisionReason,
      publicationFields,
      regenerateCover,
      adoptCoverExamples,
      coverVariants,
      model,
      current
    }));
  if (redesignBody)
    ({ current } = await prepareBodyRedesign({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      stageId,
      redesignBody,
      redesignBeatIds,
      revisionReason,
      model,
      current
    }));
  return {
    root,
    workspaceRoot,
    episodeId,
    programId,
    targetId,
    stageId,
    platform,
    segmentId,
    nodeId,
    authorizePaidTts,
    claim,
    model,
    current,
    preExecuted
  };
}

async function runNext(options) {
  const workspaceRoot = options.workspaceRoot ?? options.root;
  if (options.soundEffects !== undefined && options.soundEffects !== null) {
    await recoverAcceptance({...options,workspaceRoot});
    return withWorkflowWrite(workspaceRoot,()=>configureSoundEffects({...options,workspaceRoot}));
  }
  if (options.cancelCoverRegeneration) {
    return withWorkflowWrite(workspaceRoot, async () => (await prepareNext(options)).cancelled);
  }
  const recoveredAcceptance = await recoverAcceptance({ ...options, workspaceRoot });
  if (options.cancelDirectorRevision && recoveredAcceptance?.kind === "revision-cancelled") return recoveredAcceptance;
  const recoveredProgram = await recoverProgramCompletion({ ...options, workspaceRoot });
  const prepared = await withWorkflowWrite(workspaceRoot, async()=>{
    const requested=options.video??(['video','video-assets'].includes(options.nodeId)||options.reviseVideo?'on':undefined);
    if(requested!==undefined)await configureVideo({...options,workspaceRoot,video:requested});
    return prepareNext(options);
  });
  if (prepared.cancelDirectorRevision) return cancelDirectorRequest(prepared);
  if (prepared.current.unusedQuoteWorkOrder) {
    const saved = prepared.current.unusedQuoteWorkOrder;
    const workPaths = getStageWorkPaths(getEpisodePaths(workspaceRoot, options.episodeId), "p3");
    const scratchPath = path.join(workPaths.work, `attempt-${saved.executionId}`);
    if (!/^[a-f0-9]{64}$/u.test(saved.executionId ?? "")
      || saved.scratchPath !== path.relative(workspaceRoot, scratchPath).split(path.sep).join("/")) {
      throw new Error("引文临时目录与工作单不一致，保留现场");
    }
    await commitAcceptance({ workspaceRoot, workPaths, writes: new Map(), cleanup: [workPaths.workOrder],
      result: { kind: "quote-closeout-recovered", stageId: "p3" },
      verify: async () => {
        await assertProjectPaths({ root: workspaceRoot, label: "未使用引文工作单收尾",
          files: [workPaths.workOrder, workPaths.candidate, scratchPath] });
        const latest = await resolveStageCurrent({ ...options, workspaceRoot, model: prepared.model });
        if (hashObject(latest.unusedQuoteWorkOrder ?? null) !== hashObject(saved)) {
          throw new Error("引文收尾现场已变化，保留原工作单");
        }
        if (await exists(workPaths.candidate)) {
          throw new Error("引文工作单已有候选或查询材料，保留原任务，不自动清理或重投");
        }
        // Only an empty directory can be removed; recovery must never recursively erase a late query receipt.
        try { await rmdir(scratchPath); } catch (error) {
          if (["ENOTEMPTY", "EEXIST"].includes(error.code))
            throw new Error("引文工作单已有候选或查询材料，保留原任务，不自动清理或重投");
          if (error.code !== "ENOENT") throw error;
        }
      }
    });
    prepared.current = await resolveStageCurrent({ ...options, workspaceRoot, model: prepared.model });
  }
  if (recoveredProgram) prepared.preExecuted.unshift(recoveredProgram);
  return executeCurrentTask(prepared);
}

const resolveNextCurrent = async ({
  root,
  workspaceRoot,
  episodeId,
  programId,
  targetId,
  stageId,
  model,
  platform,
  segmentId,
  nodeId,
  preResolvedP1Replacement
}) => {
  let current;
  try {
    current = await resolveStageCurrent({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      stageId,
      platform,
      segmentId,
      nodeId,
      materializePublicationRequest: stageId === "p4",
      model
    });
  } catch (error) {
    if (preResolvedP1Replacement) {
      if (preResolvedP1Replacement.created) {
        await rm(preResolvedP1Replacement.requestPath, { force: true });
      } else {
        await atomicWriteData(
          preResolvedP1Replacement.requestPath,
          preResolvedP1Replacement.request
        );
      }
    }
    throw error;
  }
  if (current.initializeMissingSourceAssets) {
    await initializeMissingSourceAssets({ workspaceRoot, episodeId });
    current = await resolveStageCurrent({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      stageId,
      platform,
      segmentId,
      nodeId,
      materializePublicationRequest: stageId === "p4",
      model
    });
  }
  return { current };
};

export { runNext };
