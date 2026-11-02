import path from "node:path";

import { hashObject } from "../../program-utils.mjs";

export const deriveCandidateWorkspaceRoot = ({ workOrder, candidatePath }) => {
  const relativeCandidate = workOrder?.candidatePath;
  if (typeof relativeCandidate !== "string" || !relativeCandidate || path.isAbsolute(relativeCandidate)) {
    throw new Error("工作单 candidatePath 必须是节目工作区内的相对路径");
  }
  let workspaceRoot = path.resolve(candidatePath);
  for (const _part of relativeCandidate.split("/").filter(Boolean)) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, relativeCandidate) !== path.resolve(candidatePath)) {
    throw new Error("候选路径与工作单 candidatePath 不一致");
  }
  return workspaceRoot;
};

export const assertFullframeDesignTask = ({ workOrder, candidate, candidatePath }) => {
  if (workOrder?.stageId !== "p3"
    || workOrder?.moduleId !== "author-beat"
    || workOrder?.resolvedAssembly?.node?.id !== workOrder?.nodeId
    || workOrder?.resolvedAssembly?.node?.moduleId !== workOrder?.moduleId
    || workOrder?.resolvedAssembly?.module?.id !== workOrder?.moduleId) {
    throw new Error("全画幅设计工具只接受正式 P3 author-beat 工作单");
  }
  const { taskDigest, ...workOrderBase } = workOrder;
  if (hashObject(workOrderBase) !== taskDigest) throw new Error("work-order 自身内容已被改写");
  if (candidate?.taskDigest !== taskDigest) throw new Error("候选与工作单 taskDigest 不一致");
  const implementations = (workOrder.resolvedAssembly?.slots ?? [])
    .find((slot) => slot.id === "body-template")?.implementations ?? [];
  if (implementations.length !== 1 || implementations[0].packageId !== "fullframe-narrative") {
    throw new Error("当前工作单没有唯一装配 fullframe-narrative");
  }
  const treatments = workOrder.inputs?.authorBatch
    ? candidate?.result?.items?.map(item => item.treatment) : [candidate?.result?.treatment];
  if (workOrder.inputs?.authorUnit?.templateId !== "fullframe-narrative"
    || !treatments?.length || treatments.some(treatment => treatment?.templateId !== "fullframe-narrative")) {
    throw new Error("当前创作单位、候选与全画幅模板身份不一致");
  }
  return deriveCandidateWorkspaceRoot({ workOrder, candidatePath });
};

// Complete deterministic representation only; authored values are never replaced.
export const completeFullframeRepresentation = (candidateResult) => {
  const completed = structuredClone(candidateResult);
  for (const request of completed?.treatment?.assetRequests ?? []) {
    if (!Object.hasOwn(request, "kind")) request.kind = "fullframe-image";
    if (!Object.hasOwn(request, "required")) request.required = true;
    if (request.motion?.semanticEndViewport && !Object.hasOwn(request.motion, "safeEndViewport")) {
      request.motion.safeEndViewport = structuredClone(request.motion.semanticEndViewport);
    }
    if (request.motion?.semanticEndViewport && request.motion?.safeEndViewport
      && ["x", "y", "width", "height"].every((key) => request.motion.safeEndViewport[key] === request.motion.semanticEndViewport[key])
      && request.attentionPlan && !Object.hasOwn(request.attentionPlan, "safeEndFocus")) {
      request.attentionPlan.safeEndFocus = request.attentionPlan.landingFocus;
    }
  }
  return completed;
};
