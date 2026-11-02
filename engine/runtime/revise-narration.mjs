import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import {
  assertProjectPath,
  atomicWriteData,
  hashObject,
  readData
} from "../../packages/program-utils.mjs";
import {
  resolveReusableNarrationMaterials,
  validateReusableNarrationMaterials
} from ".././p1-revision-materials.mjs";
import { REVISION_REQUEST_ID, assertProjectPaths, exists, relative } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import { businessContent } from "./storyboard.mjs";
import { readP1Delivery } from "./artifacts.mjs";
import { currentP0NarrationHandoff } from "./state-narration.mjs";
import { resolveStageCurrent } from "./status.mjs";
import { assertStageSettled } from "./stage-restart.mjs";
const prepareNarrationReplacement = async ({
  root,
  workspaceRoot,
  episodeId,
  stageId,
  openerText,
  replaceNarrationRevision,
  rerunNarration,
  replaceFullRerun,
  resourceCache
}) => {
  const p1AuthorNodeId =
    stageId === "p1"
      ? (await currentP0NarrationHandoff({ root, workspaceRoot, episodeId, resourceCache }))
          .episodeBrief.programForm === "historical-documentary"
        ? "author-documentary-narration"
        : "author-narration"
      : null;
  const p1FullRerunReason = "用户明确要求从取材开始完整重做现行P1";
  let preResolvedP1Replacement = null;
  if (replaceNarrationRevision) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, stageId);
    const requestPath = workPaths.returnRequest(p1AuthorNodeId);
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P1失败正文稿重新签发路径",
      files: [workPaths.work, workPaths.workOrder, workPaths.candidate, requestPath]
    });
    if (!(await exists(requestPath)) || !(await exists(workPaths.workOrder))) {
      throw new Error(
        "--replace-narration-revision只用于AGY已明确失败或完整返回已被用户放弃、且尚未接纳的现行正文返工"
      );
    }
    const request = await readData(requestPath);
    const replaceableNarrationRevision =
      request?.target === p1AuthorNodeId &&
      request?.revisionScope === "narration" &&
      REVISION_REQUEST_ID.test(request?.revisionRequestId ?? "") &&
      Array.isArray(request?.cueRefs) &&
      request.cueRefs.length === 0;
    if (!replaceableNarrationRevision) {
      throw new Error("--replace-narration-revision只替换现行P1正文返工请求");
    }
    if (openerText !== null && request.exactOpenerNarration !== openerText.trim()) {
      throw new Error("重新签发不能改写原正文返工锁定的片头原句");
    }
    const savedWorkOrder = await readData(workPaths.workOrder);
    if (
      savedWorkOrder?.runner !== "ai" ||
      savedWorkOrder?.stageId !== "p1" ||
      savedWorkOrder?.nodeId !== p1AuthorNodeId ||
      savedWorkOrder?.moduleId !== p1AuthorNodeId
    ) {
      throw new Error("--replace-narration-revision没有找到现行P1作者工作单");
    }
    if (await exists(workPaths.candidate)) {
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        savedWorkOrder,
        workPaths.workOrder
      );
      const { taskDigest: savedTaskDigest, ...savedWorkOrderBase } = savedWorkOrder;
      const { reusedNarrationMaterials, ...authorRequest } = request;
      if (
        hashObject(savedWorkOrderBase) !== savedTaskDigest ||
        savedWorkOrder.workflowId !== "narration" ||
        savedWorkOrder.subject?.kind !== "episode" ||
        savedWorkOrder.subject?.id !== episodeId ||
        savedWorkOrder.candidatePath !== relative(workspaceRoot, workPaths.candidate) ||
        hashObject(savedWorkOrder.inputs?.returnRequest ?? null) !== hashObject(authorRequest) ||
        hashObject(savedWorkOrder.inputs?.reusedNarrationMaterials ?? null) !== hashObject(reusedNarrationMaterials ?? null) ||
        !/^[a-f0-9]{64}$/u.test(savedWorkOrder.executionId ?? "") ||
        savedWorkOrder.scratchPath !==
          relative(workspaceRoot, path.join(workPaths.work, `attempt-${savedWorkOrder.executionId}`))
      ) {
        throw new Error("--replace-narration-revision没有找到与现行请求一致的P1正文工作单");
      }
      const abandonedCandidate = await readData(workPaths.candidate);
      await validateSchema(
        path.join(root, "contracts", "candidate.schema.json"),
        abandonedCandidate,
        workPaths.candidate
      );
      if (abandonedCandidate.taskDigest !== savedTaskDigest || !abandonedCandidate.result) {
        throw new Error("--replace-narration-revision只能放弃绑定现行工作单的完整候选");
      }
    }
    const handoff = await currentP0NarrationHandoff({
      root,
      workspaceRoot,
      episodeId,
      resourceCache
    });
    await validateReusableNarrationMaterials({
      workspaceRoot,
      episodeId,
      episodeBrief: handoff.episodeBrief,
      materials: request.reusedNarrationMaterials
    });
    preResolvedP1Replacement = { requestPath, request };
    await atomicWriteData(requestPath, {
      ...request,
      reason: "用户在AGY明确失败或放弃完整未接纳稿后再次授权P1正文返工",
      revisionRequestId: randomUUID()
    });
  }
  let replacedInitialP1Attempt = false;
  if (replaceFullRerun) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, stageId);
    const requestPath = workPaths.returnRequest(p1AuthorNodeId);
    const hasScriptPackage = await exists(paths.scriptPackage);
    const hasOpenerNarration = await exists(paths.openerNarration);
    const hasRequest = await exists(requestPath);
    const hasWorkOrder = await exists(workPaths.workOrder);
    const initialRequest = hasRequest ? await readData(requestPath) : null;
    const initialUpstreamReturn =
      initialRequest?.target === p1AuthorNodeId &&
      initialRequest.revisionScope == null &&
      typeof initialRequest.reason === "string" && initialRequest.reason.trim() &&
      Array.isArray(initialRequest.cueRefs) && initialRequest.cueRefs.length === 0 &&
      initialRequest.exactOpenerNarration == null &&
      initialRequest.reusedNarrationMaterials == null;
    if ((!hasRequest || initialUpstreamReturn) && hasWorkOrder && !hasScriptPackage && !hasOpenerNarration) {
      await assertProjectPaths({
        root: workspaceRoot,
        label: "P1未接纳首次尝试替换路径",
        files: [
          paths.scriptPackage,
          paths.openerNarration,
          workPaths.work,
          workPaths.workOrder,
          workPaths.candidate,
          requestPath
        ]
      });
      const savedWorkOrder = await readData(workPaths.workOrder);
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        savedWorkOrder,
        workPaths.workOrder
      );
      const { taskDigest: savedTaskDigest, ...savedWorkOrderBase } = savedWorkOrder;
      if (
        hashObject(savedWorkOrderBase) !== savedTaskDigest ||
        savedWorkOrder.runner !== "ai" ||
        savedWorkOrder.workflowId !== "narration" ||
        savedWorkOrder.stageId !== "p1" ||
        savedWorkOrder.nodeId !== p1AuthorNodeId ||
        savedWorkOrder.moduleId !== p1AuthorNodeId ||
        hashObject(savedWorkOrder.inputs?.returnRequest ?? null) !== hashObject(initialRequest) ||
        !/^[a-f0-9]{64}$/u.test(savedWorkOrder.executionId ?? "") ||
        savedWorkOrder.scratchPath !==
          relative(
            workspaceRoot,
            path.join(workPaths.work, `attempt-${savedWorkOrder.executionId}`)
          )
      ) {
        throw new Error("--replace-full-rerun没有找到当前未接纳的首次P1作者工作单");
      }
      if (await exists(workPaths.candidate)) {
        const abandonedCandidate = await readData(workPaths.candidate);
        await validateSchema(
          path.join(root, "contracts", "candidate.schema.json"),
          abandonedCandidate,
          workPaths.candidate
        );
        if (abandonedCandidate.taskDigest !== savedTaskDigest || !abandonedCandidate.result) {
          throw new Error("--replace-full-rerun只能放弃绑定当前首次P1工作单的候选");
        }
      }
      await currentP0NarrationHandoff({ root, workspaceRoot, episodeId, resourceCache });
      const replacementRequest = {
        target: p1AuthorNodeId,
        reason: "用户明确放弃未接纳的首次P1尝试并要求从取材开始重新完成P1",
        cueRefs: [],
        revisionScope: "full",
        revisionRequestId: randomUUID()
      };
      await mkdir(workPaths.work, { recursive: true });
      await atomicWriteData(requestPath, replacementRequest);
      preResolvedP1Replacement = { requestPath, request: initialRequest, created: !hasRequest };
      replacedInitialP1Attempt = true;
    }
  }
  if (replaceFullRerun && !replacedInitialP1Attempt) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, stageId);
    const requestPath = workPaths.returnRequest(p1AuthorNodeId);
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P1完整重跑失败后替换路径",
      files: [
        paths.scriptPackage,
        paths.openerNarration,
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        requestPath
      ]
    });
    if (!(await exists(requestPath)) || !(await exists(workPaths.workOrder))) {
      throw new Error("--replace-full-rerun只用于放弃现行P1完整重跑尝试");
    }
    if ((await exists(paths.scriptPackage)) !== (await exists(paths.openerNarration))) {
      throw new Error("--replace-full-rerun不能替换仅缺正文或片头的残缺P1");
    }
    const request = await readData(requestPath);
    const replaceableFullRerun =
      request?.target === p1AuthorNodeId &&
      request?.revisionScope === "full" &&
      REVISION_REQUEST_ID.test(request?.revisionRequestId ?? "") &&
      Array.isArray(request?.cueRefs) &&
      request.cueRefs.length === 0;
    if (!replaceableFullRerun) {
      throw new Error("--replace-full-rerun只替换现行P1完整重跑请求");
    }
    const savedWorkOrder = await readData(workPaths.workOrder);
    await validateSchema(
      path.join(root, "contracts", "work-order.schema.json"),
      savedWorkOrder,
      workPaths.workOrder
    );
    const { taskDigest: savedTaskDigest, ...savedWorkOrderBase } = savedWorkOrder;
    if (
      hashObject(savedWorkOrderBase) !== savedTaskDigest ||
      savedWorkOrder.runner !== "ai" ||
      savedWorkOrder.workflowId !== "narration" ||
      savedWorkOrder.stageId !== "p1" ||
      savedWorkOrder.nodeId !== p1AuthorNodeId ||
      savedWorkOrder.moduleId !== p1AuthorNodeId ||
      savedWorkOrder.inputs?.returnRequest?.revisionScope !== "full" ||
      savedWorkOrder.inputs.returnRequest.revisionRequestId !== request.revisionRequestId ||
      !/^[a-f0-9]{64}$/u.test(savedWorkOrder.executionId ?? "") ||
      savedWorkOrder.scratchPath !==
        relative(workspaceRoot, path.join(workPaths.work, `attempt-${savedWorkOrder.executionId}`))
    ) {
      throw new Error("--replace-full-rerun没有找到与现行请求一致的P1完整重跑工作单");
    }
    if (await exists(workPaths.candidate)) {
      const abandonedCandidate = await readData(workPaths.candidate);
      await validateSchema(
        path.join(root, "contracts", "candidate.schema.json"),
        abandonedCandidate,
        workPaths.candidate
      );
      if (abandonedCandidate.taskDigest !== savedTaskDigest || !abandonedCandidate.result) {
        throw new Error("--replace-full-rerun只能放弃绑定现行工作单的完整候选");
      }
    }
    const abandonedQueryPath = path.resolve(
      workspaceRoot,
      savedWorkOrder.scratchPath,
      "notebook-query.json"
    );
    await assertProjectPath({
      root: workspaceRoot,
      file: abandonedQueryPath,
      label: "P1完整重跑旧主Query结果"
    });
    const hasQueryResult = await exists(abandonedQueryPath);
    const hasQueryAttempt = hasQueryResult || await exists(path.join(path.dirname(abandonedQueryPath), "notebook-query.txt"));
    let abandonedQuery = null;
    if (hasQueryResult) {
      const rawAbandonedQuery = await readFile(abandonedQueryPath, "utf8");
      try {
        abandonedQuery = JSON.parse(rawAbandonedQuery);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    const knownQueryResult =
      typeof abandonedQuery?.answer === "string" &&
      abandonedQuery.status !== "error" &&
      abandonedQuery.answer.trim() &&
      typeof abandonedQuery?.conversation_id === "string" &&
      abandonedQuery.conversation_id.trim() &&
      abandonedQuery?.citations &&
      typeof abandonedQuery.citations === "object" &&
      !Array.isArray(abandonedQuery.citations) &&
      (abandonedQuery.references === undefined || Array.isArray(abandonedQuery.references)) &&
      (savedWorkOrder.moduleId === "author-narration" ||
        (abandonedQuery.references ?? []).some(
          (item) =>
            item &&
            typeof item.source_id === "string" &&
            item.source_id.trim() &&
            item.citation_number != null &&
            typeof item.cited_text === "string" &&
            item.cited_text.trim()
        ));
    preResolvedP1Replacement = { requestPath, request };
    await atomicWriteData(requestPath, {
      ...request,
      reason: !hasQueryAttempt
        ? "现行P1完整重跑未使用NotebookLM Query，按已确认的替换条件开始新的无付费取材与创作尝试"
        : knownQueryResult
        ? "现行P1完整重跑已有完整主Query终态，后续成稿明确失败或未接纳，开始新的无付费尝试"
        : "现行P1完整重跑的NotebookLM结果未知且已放弃，开始新的无付费取材尝试",
      revisionRequestId: randomUUID()
    });
  }
  if (rerunNarration) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, stageId);
    const requestPath = workPaths.returnRequest(p1AuthorNodeId);
    if (await exists(requestPath)) {
      const request = await readData(requestPath);
      const replaceableTargetedRevision =
        request?.target === p1AuthorNodeId &&
        ["opener", "narration"].includes(request?.revisionScope) &&
        REVISION_REQUEST_ID.test(request?.revisionRequestId ?? "") &&
        Array.isArray(request?.cueRefs) &&
        request.cueRefs.length === 0;
      if (replaceableTargetedRevision) {
        await assertProjectPaths({
          root: workspaceRoot,
          label: "P1完整重跑替换旧定点返工路径",
          files: [
            paths.scriptPackage,
            paths.openerNarration,
            workPaths.work,
            workPaths.workOrder,
            workPaths.candidate,
            requestPath
          ]
        });
        if (!(await exists(paths.scriptPackage)) || !(await exists(paths.openerNarration))) {
          throw new Error("--rerun-narration只用于已有正式正文和片头的P1");
        }
        await currentP0NarrationHandoff({ root, workspaceRoot, episodeId, resourceCache });
        preResolvedP1Replacement = { requestPath, request };
        await atomicWriteData(requestPath, {
          target: p1AuthorNodeId,
          reason: p1FullRerunReason,
          cueRefs: [],
          revisionScope: "full",
          revisionRequestId: randomUUID()
        });
      }
    }
  }
  return { p1AuthorNodeId, p1FullRerunReason, preResolvedP1Replacement };
};

const prepareSubtitleRevision = async ({
  root,
  workspaceRoot,
  episodeId,
  stageId,
  reviseSubtitles,
  model,
  current
}) => {
  if (reviseSubtitles) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, "p2");
    const requestPath = workPaths.returnRequest("author-subtitles");
    let created = false;
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P2字幕返工路径",
      files: [
        paths.subtitleCorrection,
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        requestPath
      ]
    });
    if (!(await exists(requestPath))) {
      if (current.kind !== "complete")
        throw new Error("字幕返工只用于已完成P2；未完成任务继续当前工作单");
      for (const stage of ["p2", "p3", "p4"]) {
        const active = getStageWorkPaths(paths, stage);
        if ((await exists(active.workOrder)) || (await exists(active.candidate))) {
          throw new Error(`${stage}仍有未收口工作单或候选，不能开始字幕返工`);
        }
      }
      const correction = businessContent(await readData(paths.subtitleCorrection));
      await mkdir(workPaths.work, { recursive: true });
      await atomicWriteData(requestPath, {
        target: "author-subtitles",
        reason: "用户明确要求保留口播与配音，重新制作字幕",
        cueRefs: [],
        revisionScope: "subtitles",
        revisionRequestId: randomUUID(),
        reusedSubtitleTiming: {
          narrationSha256: correction.narrationSha256,
          audioSha256: correction.evidence.audioSha256,
          timingSource: correction.evidence.timingSource
        }
      });
      created = true;
    }
    try {
      current = await resolveStageCurrent({ root, workspaceRoot, episodeId, stageId, model });
      if (
        current.kind !== "task" ||
        current.workOrder?.nodeId !== "author-subtitles" ||
        current.context?.returnRequest?.revisionScope !== "subtitles"
      ) {
        throw new Error("字幕返工未形成唯一author-subtitles工作单");
      }
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        current.workOrder,
        "work-order"
      );
    } catch (error) {
      if (created) await rm(requestPath, { force: true });
      throw error;
    }
  }
  return { current };
};

const prepareNarrationRevision = async ({
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
}) => {
  const p1Revision = reviseOpener
    ? {
        scope: "opener",
        label: "P1片头定点返工",
        reason: "用户明确要求修改片头并同步调整正文开场与必要承接，其余内容保留",
        ...(openerText !== null ? { exactOpenerNarration: openerText.trim() } : {})
      }
    : reviseNarration
      ? {
          scope: "narration",
          label: "P1正文完整返工",
          reason: "用户明确要求重写现行P1正文",
          ...(openerText !== null ? { exactOpenerNarration: openerText.trim() } : {})
        }
      : rerunNarration
        ? {
            scope: "full",
            label: "P1完整重跑",
            reason: p1FullRerunReason
          }
        : null;
  if (p1Revision) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, stageId);
    const requestPath = workPaths.returnRequest(p1AuthorNodeId);
    let createdRevisionRequest = preResolvedP1Replacement?.created === true;
    let replacedRevisionRequest = preResolvedP1Replacement?.request ?? null;
    await assertProjectPaths({
      root: workspaceRoot,
      label: `${p1Revision.label}路径`,
      files: [workPaths.work, workPaths.workOrder, workPaths.candidate, requestPath]
    });
    if (await exists(requestPath)) {
      const request = await readData(requestPath);
      const sameRevision =
        request?.target === p1AuthorNodeId &&
        request?.revisionScope === p1Revision.scope &&
        Array.isArray(request?.cueRefs) &&
        request.cueRefs.length === 0;
      const pendingUpstreamReturn =
        p1Revision.scope === "narration" &&
        request?.target === p1AuthorNodeId &&
        request?.revisionScope == null &&
        Array.isArray(request?.cueRefs) &&
        request.cueRefs.length === 0 &&
        request.exactOpenerNarration == null &&
        request.reusedNarrationMaterials == null;
      if (!sameRevision && !pendingUpstreamReturn) {
        throw new Error(`P1已有其它返工请求，不能改写为${p1Revision.label}`);
      }
      if (pendingUpstreamReturn) {
        if (await exists(workPaths.candidate)) {
          throw new Error("P1上游退回已有候选，不能改签正文返工");
        }
        if (await exists(workPaths.workOrder)) {
          const saved = await readData(workPaths.workOrder);
          const { taskDigest, ...base } = saved;
          if (hashObject(base) !== taskDigest ||
            saved.stageId !== "p1" || saved.nodeId !== p1AuthorNodeId ||
            saved.moduleId !== p1AuthorNodeId || saved.runner !== "ai" ||
            hashObject(saved.inputs?.returnRequest ?? null) !== hashObject(request) ||
            !/^[a-f0-9]{64}$/u.test(saved.executionId ?? "") ||
            saved.scratchPath !== relative(
              workspaceRoot,
              path.join(workPaths.work, `attempt-${saved.executionId}`)
            )) {
            throw new Error("P1上游退回工作单与当前请求不一致");
          }
          const scratchPath = path.resolve(workspaceRoot, saved.scratchPath);
          await assertProjectPaths({ root: workspaceRoot, label: "P1上游退回临时目录", files: [scratchPath] });
          const scratchFiles = await readdir(scratchPath).catch(error =>
            error.code === "ENOENT" ? [] : Promise.reject(error)
          );
          if (scratchFiles.length) throw new Error("P1上游退回已开始作者工作，不能改签正文返工");
        }
        const { scriptPackage } = await readP1Delivery({ root, workspaceRoot, episodeId });
        const handoff = await currentP0NarrationHandoff({
          root, workspaceRoot, episodeId, resourceCache: model.resourceCache
        });
        const reusedNarrationMaterials = await resolveReusableNarrationMaterials({
          workspaceRoot,
          episodeId,
          episodeBrief: handoff.episodeBrief,
          materialExecutionId: scriptPackage._producer.materialExecutionId,
          allowAnswerAndEndingRevision: true
        });
        await atomicWriteData(requestPath, {
          target: p1AuthorNodeId,
          reason: p1Revision.reason,
          cueRefs: [],
          revisionScope: "narration",
          revisionRequestId: randomUUID(),
          ...(p1Revision.exactOpenerNarration !== undefined
            ? { exactOpenerNarration: p1Revision.exactOpenerNarration }
            : {}),
          reusedNarrationMaterials
        });
        createdRevisionRequest = true;
        replacedRevisionRequest = request;
      } else if (
        p1Revision.exactOpenerNarration !== undefined &&
        request.exactOpenerNarration !== p1Revision.exactOpenerNarration
      ) {
        throw new Error("P1返工请求已经签发，不能改写用户指定片头原句");
      }
      if (sameRevision && ["opener", "narration"].includes(p1Revision.scope)) {
        const handoff = await currentP0NarrationHandoff({
          root,
          workspaceRoot,
          episodeId,
          resourceCache: model.resourceCache
        });
        await validateReusableNarrationMaterials({
          workspaceRoot,
          episodeId,
          episodeBrief: handoff.episodeBrief,
          materials: request.reusedNarrationMaterials
        });
      }
    } else {
      const awaitingCovers = current.programPhase === "cover";
      if (awaitingCovers) await assertStageSettled(workspaceRoot, paths.p1);
      const canReviseStaleNarration =
        p1Revision.scope === "narration" &&
        current.kind === "task" &&
        current.hardFailure === true &&
        current.workOrder?.nodeId === p1AuthorNodeId;
      if (
        p1Revision.scope !== "full" &&
        current.kind !== "stage-complete" &&
        !awaitingCovers &&
        !canReviseStaleNarration
      ) {
        const flag = reviseOpener
          ? "--revise-opener"
          : reviseNarration
            ? "--revise-narration"
            : "--rerun-narration";
        throw new Error(`${flag}只用于已有正式正文与片头、且当前没有进行中任务的P1`);
      }
      const candidateExists = await exists(workPaths.candidate);
      const savedWorkOrderExists = await exists(workPaths.workOrder);
      if (candidateExists || savedWorkOrderExists) {
        throw new Error(`P1仍有未收口工作单或候选，不能发起${p1Revision.label}`);
      }
      const currentPair =
        p1Revision.scope === "full"
          ? null
          : await readP1Delivery({ root, workspaceRoot, episodeId });
      if (p1Revision.scope === "full") {
        await assertProjectPaths({
          root: workspaceRoot,
          label: "P1完整重跑的旧正式交接",
          files: [paths.scriptPackage, paths.openerNarration]
        });
        if (!(await exists(paths.scriptPackage)) || !(await exists(paths.openerNarration))) {
          throw new Error("--rerun-narration只用于已有正式正文和片头的P1");
        }
        await currentP0NarrationHandoff({
          root,
          workspaceRoot,
          episodeId,
          resourceCache: model.resourceCache
        });
      }
      let reusedNarrationMaterials = null;
      if (["opener", "narration"].includes(p1Revision.scope)) {
        const handoff = await currentP0NarrationHandoff({
          root,
          workspaceRoot,
          episodeId,
          resourceCache: model.resourceCache
        });
        reusedNarrationMaterials = await resolveReusableNarrationMaterials({
          workspaceRoot,
          episodeId,
          episodeBrief: handoff.episodeBrief,
          materialExecutionId: currentPair.scriptPackage._producer.materialExecutionId,
          allowAnswerAndEndingRevision: true
        });
      }
      await mkdir(workPaths.work, { recursive: true });
      await atomicWriteData(requestPath, {
        target: p1AuthorNodeId,
        reason: p1Revision.reason,
        cueRefs: [],
        revisionScope: p1Revision.scope,
        revisionRequestId: randomUUID(),
        ...(p1Revision.exactOpenerNarration !== undefined
          ? { exactOpenerNarration: p1Revision.exactOpenerNarration }
          : {}),
        ...(reusedNarrationMaterials ? { reusedNarrationMaterials } : {})
      });
      createdRevisionRequest = true;
    }
    try {
      current = await resolveStageCurrent({
        root,
        workspaceRoot,
        episodeId,
        programId,
        targetId,
        stageId,
        model
      });
      if (current.kind !== "task" || current.workOrder?.nodeId !== p1AuthorNodeId) {
        throw new Error(`${p1Revision.label}没有形成唯一作者工作单`);
      }
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        current.workOrder,
        "work-order"
      );
    } catch (error) {
      if (createdRevisionRequest) await rm(requestPath, { force: true });
      if (replacedRevisionRequest) await atomicWriteData(requestPath, replacedRevisionRequest);
      throw error;
    }
  }
  return { current };
};

export { prepareNarrationReplacement, prepareNarrationRevision, prepareSubtitleRevision };
