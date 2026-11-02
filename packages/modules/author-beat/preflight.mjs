#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashObject, readData, atomicWriteData } from "../../program-utils.mjs";
import {
  completeTreatmentCandidate,
  deriveAuthorWorkspaceRoot,
  validateSchema,
  validateTreatmentCandidate
} from "./candidate-validation.mjs";
import { readPreviousTreatment } from "../../templates/fullframe-narrative/context-runtime.mjs";
import { orderCueSyncBindings } from "../../features/cue-sync/resolve.mjs";
import { validateAuthorBatch } from "./batch-validation.mjs";
import { readP3Sources } from "../../p3-sources.mjs";

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fail = (message) => {
  throw new Error(message);
};

const importResource = async (source) => {
  if (typeof source !== "string" || !source) fail("工作单装配资源缺少 source");
  const file = path.resolve(systemRoot, source);
  await readFile(file);
  return import(pathToFileURL(file).href);
};

const implementations = (workOrder, kind) => (workOrder.resolvedAssembly?.slots ?? [])
  .flatMap((slot) => slot.implementations ?? [])
  .filter((implementation) => implementation.kind === kind);

const soleImplementation = (workOrder, kind, label) => {
  const matches = implementations(workOrder, kind);
  if (matches.length !== 1) fail(`${label} 必须恰好装配一个 ${kind}，实际 ${matches.length}`);
  return matches[0];
};

const containsProducer = (value) => {
  if (Array.isArray(value)) return value.some(containsProducer);
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "_producer")) return true;
  return Object.values(value).some(containsProducer);
};

export const preflightAuthorCandidate = async ({ workOrderPath, candidatePath, services = {} }) => {
  const workOrder = await readData(path.resolve(workOrderPath));
  const candidate = await readData(path.resolve(candidatePath));
  await validateSchema(path.join(systemRoot, "contracts", "work-order.schema.json"), workOrder, "work-order");
  if (workOrder.stageId !== "p3"
    || workOrder.moduleId !== "author-beat"
    || workOrder.resolvedAssembly?.node?.id !== workOrder.nodeId
    || workOrder.resolvedAssembly?.node?.moduleId !== workOrder.moduleId
    || workOrder.resolvedAssembly?.module?.id !== workOrder.moduleId) {
    fail("预检只接受正式 P3 author-beat 工作单");
  }
  const { taskDigest, ...workOrderBase } = workOrder;
  if (hashObject(workOrderBase) !== taskDigest) fail("work-order 自身内容已被改写");
  await validateSchema(path.join(systemRoot, "contracts", "candidate.schema.json"), candidate, "candidate");
  if (candidate.taskDigest !== taskDigest) fail("候选与工作单 taskDigest 不一致");
  if (candidate.returnTo) fail("预检只检查准备正式提交的 result 候选");
  if (containsProducer(candidate.result)) fail("候选稿越权写入 _producer");

  if (workOrder.inputs?.authorPhase === "quotes") {
    const workspaceRoot = deriveAuthorWorkspaceRoot({ workOrder, candidatePath: path.resolve(candidatePath) });
    const batchRoot = path.join(systemRoot, "packages/templates/fullframe-narrative/callout");
    const batch = await import(pathToFileURL(path.join(batchRoot, "batch.mjs")).href);
    await batch.completeCandidate({ result: candidate.result, services: { workspaceRoot, task: workOrder } });
    await validateSchema(path.join(batchRoot, "batch-result.schema.json"), candidate.result, "引文收口");
    const errors = await batch.validateAcceptance({ result: candidate.result, context: workOrder.inputs,
      services: { workspaceRoot, task: workOrder } });
    if (errors.length) fail(`引文收口失败: ${errors.join("; ")}`);
    return { ok: true, moduleId: workOrder.moduleId, authorPhase: "quotes", taskDigest };
  }

  if (workOrder.inputs?.authorBatch) {
    const workspaceRoot = deriveAuthorWorkspaceRoot({ workOrder, candidatePath: path.resolve(candidatePath) });
    const views = await validateAuthorBatch({ candidateResult: candidate.result, task: workOrder,
      systemRoot, workspaceRoot, episodeId: workOrder.subject.id, services,
      moduleValidatorSource: workOrder.validator.source,
      templateImplementation: soleImplementation(workOrder, "template", "author-beat"),
      featureImplementations: implementations(workOrder, "feature"), loadResource: importResource });
    await atomicWriteData(path.resolve(candidatePath), candidate);
    return { ok: true, moduleId: workOrder.moduleId, taskDigest,
      beatIds: views.map(view => view.item.beatId) };
  }
  const completed = completeTreatmentCandidate({ candidateResult: candidate.result, context: workOrder.inputs ?? {} });
  const treatment = candidate.result.treatment;
  const featureResults = candidate.result.featureResults ?? {};
  const templateImplementation = soleImplementation(workOrder, "template", "author-beat");
  const featureImplementations = implementations(workOrder, "feature");
  const featureIds = new Set(featureImplementations.map((item) => item.packageId));
  const unexpectedFeatures = Object.keys(featureResults).filter((featureId) => !featureIds.has(featureId));
  if (unexpectedFeatures.length) fail(`候选写入未启用的功能结果: ${unexpectedFeatures.join(", ")}`);

  const workspaceRoot = deriveAuthorWorkspaceRoot({
    workOrder,
    candidatePath: path.resolve(candidatePath)
  });
  const previousTreatment = templateImplementation.packageId === "fullframe-narrative"
    && workOrder.inputs?.previousCameraStateSha256
    ? await readPreviousTreatment({ workspaceRoot, task: workOrder })
    : workOrder.inputs?.previousTreatment;
  const context = {
    ...(workOrder.inputs ?? {}),
    sourceAssets: await readP3Sources({workspaceRoot, workOrder}),
    ...(Object.hasOwn(workOrder.inputs ?? {}, "previousTreatment")
      ? { previousTreatment }
      : {}),
    selectedTemplate: templateImplementation.packageId
  };
  let reordered = false;
  if (featureResults["cue-sync"]) {
    const policyResource = templateImplementation.resources.find((item) => item.role === "cuePolicy");
    const policy = await importResource(policyResource?.source);
    const original = featureResults["cue-sync"];
    const ordered = orderCueSyncBindings({ result: original, allowedTargets: policy.cueSyncTargetsForTreatment(treatment), cues: context.cues });
    reordered = JSON.stringify(original) !== JSON.stringify(ordered);
    featureResults["cue-sync"] = ordered;
  }
  const validation = await validateTreatmentCandidate({
    candidateResult: candidate.result,
    context,
    systemRoot,
    workspaceRoot,
    episodeId: workOrder.subject.id,
    task: workOrder,
    moduleValidatorSource: workOrder.validator?.source,
    templateImplementation,
    featureImplementations,
    loadResource: importResource,
    services
  });
  if (validation.errors.length) fail(`candidate 语义校验失败: ${validation.errors.join("; ")}`);
  if (completed || reordered) await atomicWriteData(path.resolve(candidatePath), candidate);
  return {
    ok: true,
    moduleId: workOrder.moduleId,
    authorUnitId: workOrder.inputs?.authorUnit?.id,
    templateId: treatment.templateId,
    featureIds: [...featureIds].sort(),
    taskDigest
  };
};

const main = async () => {
  const [workOrderPath, candidatePath] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath) {
    fail("用法: node packages/modules/author-beat/preflight.mjs <workOrderPath> <candidatePath>");
  }
  process.stdout.write(`${JSON.stringify(await preflightAuthorCandidate({ workOrderPath, candidatePath }), null, 2)}\n`);
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
