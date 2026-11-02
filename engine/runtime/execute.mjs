import { executeProgramNode } from "./program-execution.mjs";
import { commitAcceptance, withWorkflowWrite } from "./acceptance-commit.mjs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { atomicWriteData, hashObject, readData } from "../../packages/program-utils.mjs";
import { REVISION_REQUEST_ID, assertProjectPaths, exists, initializeMissingSourceAssets, relative } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import { controllerSpecFor } from "./implementations.mjs";
import { assertTaskContinuity } from "./tasks.mjs";
import { assertStageSettled } from "./stage-restart.mjs";
import { resolveStageCurrent, statusKindForTask } from "./status.mjs";

// One active order; parked work is reused only if its actual inputs still match.
const parkChangedWork = async ({ workspaceRoot, workPaths, saved, current }) => {
  if (saved.stageId !== current.stageId || hashObject(saved.subject) !== hashObject(current.subject)
    || saved.workflowId !== current.workflowId || saved.candidatePath !== current.candidatePath)
    assertTaskContinuity(saved, current);
  const stageWork = workPaths.nodeId ? path.dirname(workPaths.work) : workPaths.work;
  await assertStageSettled(workspaceRoot, workPaths.segmentId ? workPaths.work : path.dirname(stageWork));
  const directory = path.join(workPaths.work, "held-work");
  const file = path.join(directory, `${saved.taskDigest}.json`);
  await assertProjectPaths({ root: workspaceRoot, label: "保留受影响工作单", files: [file, workPaths.candidate] });
  const candidate = await exists(workPaths.candidate) ? await readData(workPaths.candidate)
    : await exists(file) ? (await readData(file)).candidate : null;
  await atomicWriteData(file, { workOrder: saved, candidate });
  await rm(workPaths.candidate, { force: true });
};

const matchingHeldWork = async ({ workspaceRoot, workPaths, current }) => {
  const directory = path.join(workPaths.work, "held-work");
  await assertProjectPaths({ root: workspaceRoot, label: "恢复同一工作单", files: [directory] });
  const names = await readdir(directory).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const name of names) {
    const file = path.join(directory, name);
    await assertProjectPaths({ root: workspaceRoot, label: "恢复同一工作单", files: [file] });
    try {
      const held = await readData(file);
      const { taskDigest, ...base } = held.workOrder;
      if (hashObject(base) !== taskDigest) continue;
      assertTaskContinuity(held.workOrder, current);
      return { ...held, file };
    } catch { continue; } // Unusable history must not prevent the current task.
  }
  return null;
};

const executeCurrentTask = async ({
  root,
  workspaceRoot,
  episodeId,
  programId,
  targetId,
  stageId,
  platform = null,
  segmentId = null,
  nodeId = null,
  claim = null,
  authorizePaidTts,
  model,
  current,
  preExecuted
}) => {
  const executed = [...preExecuted];
  const emptyAuthorQueue = () => ({ kind: "author-queue-empty", stageId, claim,
    reason: "当前无可领取的对应类型正文段，由主代理核对在途任务、整集进度和历史引文收口", executed });
  if (claim && (current.kind !== "task" || current.mode !== "treatment")) return emptyAuthorQueue();
  const executedProgramTasks = new Set();
  const currentPrimitive = () =>
    current.kind === "task" && current.runner === "program"
      ? controllerSpecFor(current.record).primitive
      : null;
  for (let guard = 0; current.kind === "task" && current.runner === "program"; guard += 1) {
    if (guard > 10) throw new Error("程序节点未能推进 Workflow");
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
        model
      });
      continue;
    }
    const primitive = currentPrimitive();
    const executionKey = current.taskDigest ?? current.taskId;
    if (executedProgramTasks.has(executionKey))
      throw new Error(`程序节点执行后仍未通过: ${current.reason ?? current.taskId}`);
    if (current.unknownExternal) {
      return {
        kind: "external-result-unknown",
        subject: current.base.subject,
        workflowId: current.base.workflowId,
        stageId: current.base.stageId,
        nodeId: current.node.id,
        moduleId: current.record.manifest.id,
        reason: current.reason,
        executed
      };
    }
    if (current.hardFailure) {
      return {
        kind: "blocked",
        subject: current.base.subject,
        workflowId: current.base.workflowId,
        stageId: current.base.stageId,
        nodeId: current.node.id,
        moduleId: current.record.manifest.id,
        reason: current.reason,
        executed
      };
    }
    if (current.waitingExternal && !current.readyToRun) {
      return {
        kind: "waiting-external",
        subject: current.base.subject,
        workflowId: current.base.workflowId,
        stageId: current.base.stageId,
        nodeId: current.node.id,
        moduleId: current.record.manifest.id,
        reason: current.reason,
        ...(current.retryAfterMinutes ? { retryAfterMinutes: current.retryAfterMinutes } : {}),
        executed
      };
    }
    if (current.remoteFailed) {
      return {
        kind: "external-failed",
        subject: current.base.subject,
        workflowId: current.base.workflowId,
        stageId: current.base.stageId,
        nodeId: current.node.id,
        moduleId: current.record.manifest.id,
        reason: current.reason,
        executed
      };
    }
    if (
      primitive === "program-narration-synthesize" &&
      current.paidCallRequired !== false &&
      !authorizePaidTts
    ) {
      return {
        kind: "authorization-required",
        subject: current.base.subject,
        workflowId: current.base.workflowId,
        stageId: current.base.stageId,
        nodeId: current.node.id,
        moduleId: current.record.manifest.id,
        reason: "P2 合成需要本次 next 的明确付费授权",
        executed
      };
    }
    executedProgramTasks.add(executionKey);
    let programResult = null;
    try {
      programResult = await executeProgramNode({ root, workspaceRoot, current, authorizePaidTts });
    } catch (error) {
      if (error?.code === "authorization-required") {
        return {
          kind: "authorization-required",
          subject: current.base.subject,
          workflowId: current.base.workflowId,
          stageId: current.base.stageId,
          nodeId: current.node.id,
          moduleId: current.record.manifest.id,
          reason: error.message,
          executed
        };
      }
      if (error?.code === "unknown-remote-result") {
        return {
          kind: "external-result-unknown",
          subject: current.base.subject,
          workflowId: current.base.workflowId,
          stageId: current.base.stageId,
          nodeId: current.node.id,
          moduleId: current.record.manifest.id,
          reason: error.message,
          executed
        };
      }
      if (new Set(["remote-task-not-created", "remote-task-failed"]).has(error?.code)) {
        return {
          kind: "external-failed",
          subject: current.base.subject,
          workflowId: current.base.workflowId,
          stageId: current.base.stageId,
          nodeId: current.node.id,
          moduleId: current.record.manifest.id,
          reason: error.message,
          executed
        };
      }
      throw error;
    }
    if (programResult?.kind === "image-generation-batch") return {
      ...programResult, subject: current.base.subject, workflowId: current.base.workflowId,
      stageId: current.base.stageId, taskId: current.taskId, executed
    };
    if (primitive === "program-narration-synthesize") authorizePaidTts = false;
    executed.push(current.record.manifest.id);
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
      model
    });
  }
  if (current.kind !== "task") return { ...current, executed };
  if (current.mode === "publish" && !platform && current.parallelPlatforms?.length > 1) {
    const workOrders = [];
    for (const selected of current.parallelPlatforms) {
      const options = { root, workspaceRoot, episodeId, targetId, stageId, platform: selected, model };
      const task = await resolveStageCurrent({ ...options, materializePublicationRequest: true });
      workOrders.push({ platform: selected, ...await executeCurrentTask({ ...options, current: task, preExecuted: [] }) });
    }
    return { kind: "publication-batch", subject: current.subject, workflowId: current.workflowId,
      stageId, workOrders, executed };
  }
  return withWorkflowWrite(workspaceRoot, async () => {
  current = await resolveStageCurrent({ root, workspaceRoot, episodeId, programId, targetId, stageId, platform, segmentId, nodeId,
    materializePublicationRequest: stageId === "p4", model });
  if (claim) {
    const available = (current.authorSegments ?? []).filter(segment => segment.state === "pending");
    const templateId = claim === "explainer" ? "vox-explainer" : "fullframe-narrative";
    const selected = available.find(segment => segment.templateId === templateId);
    if (!selected || current.mode !== "treatment") return emptyAuthorQueue();
    segmentId = selected.id;
    current = await resolveStageCurrent({ root, workspaceRoot, episodeId, programId, targetId, stageId, segmentId, model });
  }
  if (current.kind !== "task" || current.runner !== "ai") throw new Error("签发前当前任务已变化，请重新读取当前节点");
  if (current.hardFailure) {
    return {
      kind: "blocked",
      subject: current.workOrder.subject,
      workflowId: current.workOrder.workflowId,
      stageId: current.workOrder.stageId,
      nodeId: current.workOrder.nodeId,
      moduleId: current.workOrder.moduleId,
      reason: current.reason,
      executed
    };
  }
  const workPaths = current.workPaths ?? getStageWorkPaths(current.paths, stageId);
  const currentRuleSources = current.workOrder.resolvedRules.map(({ source }) => source);
  let retainedWorkOrder = false;
  let abandonedScratchPath = null;
  let replacingFullNarration = false;
  let replacingBodyWithDirector = false;
  if (await exists(workPaths.workOrder)) {
    await assertProjectPaths({
      root: workspaceRoot,
      label: `${stageId} 工作单`,
      files: [workPaths.workOrder]
    });
    const saved = await readData(workPaths.workOrder);
    const { taskDigest, ...base } = saved;
    if (hashObject(base) !== taskDigest) throw new Error("work-order.yaml 自身内容已被改写");
    const request = current.workOrder.inputs?.returnRequest;
    replacingBodyWithDirector = stageId === "p3" && current.mode === "visual-plan"
      && request?.revisionScope === "director-revision" && saved.taskDigest === request.replacesTaskDigest;
    replacingFullNarration =
      stageId === "p1" &&
      ["author-narration", "author-documentary-narration"].includes(current.workOrder.moduleId) &&
      request?.target === current.workOrder.nodeId &&
      request?.revisionScope === "full" &&
      REVISION_REQUEST_ID.test(request?.revisionRequestId ?? "") &&
      request.revisionRequestId !== saved.inputs?.returnRequest?.revisionRequestId;
    if (replacingFullNarration || replacingBodyWithDirector) {
      // A new persisted revision replaces prior inputs; the same request remains a continuation.
      if (replacingBodyWithDirector) {
        if (saved.stageId !== "p3" || saved.nodeId !== "author"
          || saved.inputs?.p3BodyRedesign?.revisionScope !== "body-redesign"
          || hashObject(saved.inputs.p3BodyRedesign) !== request.replacesBodyRedesignSha256) {
          throw new Error("导演修订不能替代与请求不一致的正文工作单");
        }
      } else assertTaskContinuity({ ...saved, inputs: current.workOrder.inputs,
        resolvedAssembly: current.workOrder.resolvedAssembly }, current.workOrder);
      const expectedScratch = path.join(workPaths.work, `attempt-${saved.executionId}`);
      if (
        !/^[a-f0-9]{64}$/u.test(saved.executionId ?? "") ||
        saved.scratchPath !== relative(workspaceRoot, expectedScratch) ||
        saved.scratchPath === current.workOrder.scratchPath
      ) throw new Error("被新返工请求替代的旧材料目录与工作单不一致");
      abandonedScratchPath = expectedScratch;
    } else {
      try {
        assertTaskContinuity(saved, current.workOrder);
        current.workOrder = saved;
        retainedWorkOrder = true;
      } catch {
        await parkChangedWork({ workspaceRoot, workPaths, saved, current: current.workOrder });
      }
    }
  }
  let held = null;
  if ((!retainedWorkOrder || !await exists(workPaths.candidate))
    && !replacingFullNarration && !replacingBodyWithDirector) {
    held = await matchingHeldWork({ workspaceRoot, workPaths, current: current.workOrder });
    if (held) current.workOrder = held.workOrder;
  }
  const scratchPath = current.workOrder.scratchPath
    ? path.resolve(workspaceRoot, current.workOrder.scratchPath)
    : null;
  await assertProjectPaths({
    root: workspaceRoot,
    label: `${stageId} 工作路径`,
    files: [
      workPaths.work,
      workPaths.workOrder,
      workPaths.candidate,
      ...(scratchPath ? [scratchPath] : []),
      ...(abandonedScratchPath ? [abandonedScratchPath] : [])
    ]
  });
  await validateSchema(
    path.join(root, "contracts", "work-order.schema.json"),
    current.workOrder,
    "work-order"
  );
  if (scratchPath) await mkdir(scratchPath, { recursive: true });
  if (replacingFullNarration || replacingBodyWithDirector) {
    // Keep the old order until cleanup succeeds so an interrupted next can finish this request.
    await rm(workPaths.candidate, { force: true });
    await rm(abandonedScratchPath, { recursive: true, force: true });
  }
  if (held) {
    const writes = new Map([[workPaths.workOrder, current.workOrder]]);
    if (held.candidate) writes.set(workPaths.candidate, held.candidate);
    await commitAcceptance({ workspaceRoot, workPaths, writes, cleanup: [held.file],
      workflowWriteHeld: true, verify: async () => {}, result: { kind: "work-restored" } });
  } else if (!retainedWorkOrder) await atomicWriteData(workPaths.workOrder, current.workOrder);
  if (!retainedWorkOrder && (await exists(workPaths.candidate))) {
    const candidate = await readData(workPaths.candidate);
    if (candidate.taskDigest !== current.workOrder.taskDigest)
      await rm(workPaths.candidate, { force: true });
  }
  return {
    kind: "work-order",
    subject: current.workOrder.subject,
    workflowId: current.workOrder.workflowId,
    stageId: current.workOrder.stageId,
    taskId: current.workOrder.taskId,
    taskDigest: current.workOrder.taskDigest,
    workOrderPath: relative(workspaceRoot, workPaths.workOrder),
    candidatePath: current.workOrder.candidatePath,
    ...(workPaths.segmentId ? { segmentId: workPaths.segmentId } : {}),
    ...(currentRuleSources ? { currentRuleSources } : {}),
    ...(current.workOrder.scratchPath ? { scratchPath: current.workOrder.scratchPath } : {}),
    executed
  };
  });
};

export { executeCurrentTask };
