import {videoIsEnabled} from './video-settings.mjs';
import { pendingProgramCompletion } from "./program-execution.mjs";
import { pendingAcceptance } from "./acceptance-commit.mjs";
import { getEpisodePaths } from "../../packages/workspace-paths.mjs";
import { readData } from "../../packages/program-utils.mjs";
import { classifyStageProgress } from ".././workflows.mjs";
import { loadStageModel } from "./model.mjs";
import { resolveVideoCurrent } from "./state-video.mjs";
import { resolveNarrationCurrent } from "./state-narration.mjs";
import { resolveProgramCurrent } from "./state-program.mjs";
const requireStageId = (stageId, operation) => {
  if (typeof stageId !== "string" || !stageId) {
    throw new Error(`${operation} 必须提供 stageId`);
  }
};

const workflowResolvers = Object.freeze({
  program: resolveProgramCurrent,
  narration: resolveNarrationCurrent,
  video: resolveVideoCurrent
});

const resolverForWorkflow = (workflowId) => {
  const resolver = workflowResolvers[workflowId];
  if (!resolver) throw new Error(`Workflow ${workflowId} 没有登记运行时解析器`);
  return resolver;
};

const resolveStageCurrent = async ({
  root,
  workspaceRoot = root,
  episodeId,
  programId,
  targetId,
  stageId,
  segmentId = null,
  nodeId = null,
  materializeWorkOrder = true,
  model = null
}) => {
  requireStageId(stageId, "阶段运行");
  if (segmentId && (stageId !== "p3" || !/^TR[0-9]{3,}$/u.test(segmentId)))
    throw new Error("segmentId只用于P3的TR段编号");
  if (nodeId && (stageId !== "p4" || !["opener", "video", "video-assets", "render"].includes(nodeId)))
    throw new Error("nodeId只用于P4的opener/video/video-assets/render节点");
  model ??= await loadStageModel(root, { stageId, resourceScope: "stage" });
  const subject = (() => {
    if (model.workflowRecord.subjectKind === "program") {
      if (!programId) throw new Error(`${stageId} 必须提供 programId`);
      return { kind: "program", id: programId };
    }
    if (model.workflowRecord.subjectKind === "episode") {
      if (!episodeId) throw new Error(`${stageId} 必须提供 episodeId`);
      return { kind: "episode", id: episodeId };
    }
    throw new Error(`不支持的 Subject kind: ${model.workflowRecord.subjectKind}`);
  })();
  const pending = await pendingAcceptance({ workspaceRoot, episodeId, stageId, targetId });
  if (pending) return { kind: "recovery-required", subject, workflowId: model.workflowRecord.id, stageId,
    reason: "同一候选的接纳写入尚未收口；运行同参 next 或 accept 补完剩余提交" };
  const programCompletion = await pendingProgramCompletion({ workspaceRoot, episodeId, stageId });
  if (programCompletion) return { kind: "recovery-required", subject, workflowId: model.workflowRecord.id, stageId,
    reason: "程序已写出成果；运行同参 next 补完下游待办与请求清理" };
  const resolver = resolverForWorkflow(model.workflowRecord.id);
  let current;
  try {
    current = await resolver({
      root,
      workspaceRoot,
      episodeId,
      programId,
      targetId,
      segmentId,
      nodeId,
      model
    });
  } catch (error) {
    if (error?.code !== "workflow-input-invalid" || error.workflowId !== model.workflowRecord.id)
      throw error;
    const progress = classifyStageProgress({
      model: model.workflowModel,
      stageId,
      currentNodeId: error.nodeId
    });
    if (progress.kind !== "blocked-upstream" && !error.upstreamStageId) throw error;
    return {
      kind: "blocked-upstream",
      subject,
      workflowId: model.workflowRecord.id,
      stageId,
      upstreamStageId:
        progress.kind === "blocked-upstream" ? progress.upstreamStageId : error.upstreamStageId,
      nodeId: error.nodeId,
      reason: error.message
    };
  }
  if (["blocked-upstream", "initialization-required"].includes(current.kind) && !current.subject) {
    return {
      ...current,
      subject,
      workflowId: model.workflowRecord.id,
      stageId
    };
  }
  if (current.kind === "complete") {
    const progress = classifyStageProgress({
      model: model.workflowModel,
      stageId,
      workflowComplete: true
    });
    if (progress.kind === "complete") {
      const {
        episodeId: _episodeId,
        programId: _programId,
        targetId: _targetId,
        ...rest
      } = current;
      return { ...rest, subject, workflowId: model.workflowRecord.id, stageId };
    }
    return {
      kind: "stage-complete",
      subject,
      workflowId: model.workflowRecord.id,
      stageId,
      message: `Production Stage ${stageId} 已完成`,
      ...(current.authorUnitProgress ? { authorUnitProgress: current.authorUnitProgress, authorSegments: current.authorSegments } : {})
    };
  }
  if (current.kind !== "task" || !current.node) return current;
  if (segmentId && current.node.id !== "author") return {
    kind: "blocked-upstream", subject, workflowId: model.workflowRecord.id, stageId,
    nodeId: current.node.id, reason: `先由主代理完成 ${current.node.id}，再领取 ${segmentId}`
  };
  const progress = classifyStageProgress({
    model: model.workflowModel,
    stageId,
    currentNodeId: current.node.id
  });
  if (progress.kind === "blocked-upstream") {
    return {
      kind: "blocked-upstream",
      subject,
      workflowId: model.workflowRecord.id,
      stageId,
      upstreamStageId: progress.upstreamStageId,
      nodeId: progress.nodeId,
      reason: `上游阶段尚未完成，当前待办节点为 ${current.node.id}`
    };
  }
  if (progress.kind === "stage-complete") {
    return {
      kind: "stage-complete",
      subject,
      workflowId: model.workflowRecord.id,
      stageId,
      message: `Production Stage ${stageId} 已完成`
    };
  }
  if (materializeWorkOrder && current.runner === "ai") {
    current.workOrder = current.createWorkOrder(current.allowedReturnTargets);
  }
  return current;
};

const taskIdentity = (current) => ({
  subject: current.runner === "ai" ? current.subject : current.base.subject,
  workflowId: current.runner === "ai" ? current.workflowId : current.base.workflowId,
  taskId: current.taskId,
  nodeId: current.node.id,
  moduleId: current.record.manifest.id
});

const statusKindForTask = (current) => {
  if (current.hardFailure) return "blocked";
  if (current.unknownExternal) return "external-result-unknown";
  if (current.waitingExternal) return "waiting-external";
  if (current.remoteFailed) return "external-failed";
  if (current.authorizationRequired) return "authorization-required";
  return "task";
};

const deriveStageQueue = ({
  model,
  stageId,
  current,
  completedNodeIds = new Set(),
  activeCondition = null
}) => {
  const stage = model.workflowRecord.stages.find((item) => item.id === stageId);
  if (!stage) throw new Error(`Workflow ${model.workflowRecord.id} 缺少阶段 ${stageId}`);
  const nodes = stage.nodeIds.map((nodeId) => model.nodeById.get(nodeId));
  const currentNodeId =
    current.kind === "task"
      ? current.node.id
      : (current.nodeId ?? null);
  const currentIndex = currentNodeId ? nodes.findIndex((node) => node.id === currentNodeId) : -1;
  const stageDone = ["complete", "stage-complete"].includes(current.kind);
  const currentState =
    current.kind === "task"
      ? current.hardFailure
        ? "blocked"
        : current.waitingExternal
          ? "waiting-external"
          : current.authorizationRequired
            ? "authorization-required"
            : current.unknownExternal
              ? "external-result-unknown"
              : current.remoteFailed
                ? "blocked"
                : "current"
      : current.kind === "blocked-upstream"
        ? "blocked"
        : current.kind === "initialization-required"
          ? "current"
          : current.kind;
  return nodes.map((node, index) => {
    let state = "pending";
    if (
      activeCondition &&
      node.condition &&
      node.condition !== "always" &&
      node.condition !== activeCondition
    )
      state = "not-applicable";
    else if (
      stageDone ||
      completedNodeIds.has(node.id) ||
      (currentIndex >= 0 && index < currentIndex)
    )
      state = "completed";
    else if (index === currentIndex) state = currentState;
    else if (current.kind === "blocked-upstream") state = "blocked";
    const record = model.packages.get(node.moduleId);
    return {
      position: index + 1,
      nodeId: node.id,
      moduleId: node.moduleId,
      runner: record.manifest.runner,
      state,
      ...(node.id === "author" ? { units: current.authorUnitProgress ?? null } : {}),
      ...(state === "not-applicable" ? { reason: "本集节目形式不适用" } : {}),
      ...(index === currentIndex && current.reason ? { reason: current.reason } : {}),
      ...(index === currentIndex && current.retryAfterMinutes
        ? { retryAfterMinutes: current.retryAfterMinutes }
        : {})
    };
  });
};

async function deriveStatus({
  root,
  workspaceRoot = root,
  episodeId,
  programId,
  targetId,
  stageId,
  segmentId = null,
  nodeId = null
}) {
  requireStageId(stageId, "status");
  const model = await loadStageModel(root, { stageId, resourceScope: "stage" });
  const current = await resolveStageCurrent({
    root,
    workspaceRoot,
    episodeId,
    programId,
    targetId,
    stageId,
    segmentId,
    nodeId,
    model,
    materializeWorkOrder: false
  });
  const activeCondition = model.workflowRecord.id === "narration" && stageId === "p1"
    ? (await readData(getEpisodePaths(workspaceRoot, episodeId).episodeBrief).catch(() => null))?.programForm ?? null
    : null;
  let queue = deriveStageQueue({ model, stageId, current, activeCondition });
  if(stageId==="p4"&&!await videoIsEnabled({workspaceRoot,episodeId})) queue=queue.filter(entry=>model.orderedNodes.find(node=>node.id===entry.nodeId)?.condition!=="video-enabled");
  if (stageId === "p4" && !["recovery-required", "stage-complete", "complete"].includes(current.kind)) {
    for (const entry of queue.filter(entry=>entry.nodeId!=="render")) {
      const selected = await resolveStageCurrent({ root, workspaceRoot, episodeId, targetId, stageId,
        nodeId: entry.nodeId, model, materializeWorkOrder: false });
      entry.state = selected.kind === "node-complete" ? "completed"
        : selected.kind === "task" ? statusKindForTask(selected) === "task" ? "current" : statusKindForTask(selected)
        : "blocked";
      delete entry.reason;
      if (selected.reason) entry.reason = selected.reason;
    }
  }
  if (current.kind !== "task") return { ...current, queue };
  const identity = taskIdentity(current);
  return {
    kind: statusKindForTask(current),
    subject: identity.subject,
    workflowId: identity.workflowId,
    stageId,
    taskId: identity.taskId,
    nodeId: identity.nodeId,
    moduleId: identity.moduleId,
    runner: current.runner,
    reason: current.reason,
    ...(current.fingerprint ? { fingerprint: current.fingerprint } : {}),
    ...(current.authorSegments ? { authorSegments: current.authorSegments } : {}),
    ...(current.retryAfterMinutes ? { retryAfterMinutes: current.retryAfterMinutes } : {}),
    queue
  };
}

export {
  deriveStatus,
  requireStageId,
  resolveStageCurrent,
  resolverForWorkflow,
  statusKindForTask
};
