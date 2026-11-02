#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashObject, readData } from "../../program-utils.mjs";
import { completeTreatmentCandidate, deriveAuthorWorkspaceRoot } from "./candidate-validation.mjs";

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fail = (message) => {
  throw new Error(message);
};

const main = async () => {
  const [workOrderArgument, candidateArgument] = process.argv.slice(2);
  if (!workOrderArgument || !candidateArgument) {
    fail("用法: cue-options.mjs <workOrderPath> <candidatePath>");
  }
  const workOrder = await readData(path.resolve(workOrderArgument));
  const candidate = await readData(path.resolve(candidateArgument));
  if (workOrder.stageId !== "p3"
    || workOrder.moduleId !== "author-beat"
    || workOrder.resolvedAssembly?.node?.id !== workOrder.nodeId
    || workOrder.resolvedAssembly?.node?.moduleId !== workOrder.moduleId
    || workOrder.resolvedAssembly?.module?.id !== workOrder.moduleId) {
    fail("卡点选项程序只接受正式 P3 author-beat 工作单");
  }
  const { taskDigest, ...workOrderBase } = workOrder;
  if (hashObject(workOrderBase) !== taskDigest) fail("work-order 自身内容已被改写");
  {
    if (candidate.taskDigest !== workOrder.taskDigest) fail("候选与工作单 taskDigest 不一致");
    deriveAuthorWorkspaceRoot({ workOrder, candidatePath: candidateArgument });
    completeTreatmentCandidate({ candidateResult: candidate.result, context: workOrder.inputs ?? {} });
  }
  const treatment = candidate?.result?.treatment;
  if (!treatment || typeof treatment !== "object") fail("候选尚未形成 treatment");
  const templateImplementations = (workOrder.resolvedAssembly?.slots ?? [])
    .find((slot) => slot.id === "body-template")?.implementations ?? [];
  const templateImplementation = templateImplementations[0];
  if (templateImplementations.length !== 1
    || templateImplementation.packageId !== workOrder.inputs?.authorUnit?.templateId
    || templateImplementation.packageId !== treatment.templateId) {
    fail("候选 treatment 与当前唯一正文模板不一致");
  }
  const cuePolicy = (templateImplementation.resources ?? [])
    .find((resource) => resource.role === "cuePolicy");
  if (!cuePolicy?.source) fail("当前模板没有投递 cuePolicy");
  const policyPath = path.resolve(systemRoot, cuePolicy.source);
  const policy = await import(pathToFileURL(policyPath).href);
  if (typeof policy.legalCueOptionsForTreatment !== "function") {
    fail("当前模板不使用候选后卡点选项程序；请消费模板上下文提供的合法清单");
  }
  const fixedBindings = candidate?.result?.featureResults?.["cue-sync"]?.items ?? [];
  const input = {
    treatment,
    cues: workOrder.inputs?.cues ?? [],
    cueRange: workOrder.inputs?.authorUnit?.cueRange,
    fixedBindings,
    label: workOrder.inputs?.authorUnit?.id ?? "当前创作单位"
  };
  const cueOptions = policy.legalCueOptionsForTreatment(input);
  const cueById = new Map((workOrder.inputs?.cues ?? []).map((cue) => [String(cue.id), cue]));
  const withCueText = (item) => ({
    ...item,
    cueText: cueById.get(String(item.cueId))?.text ?? ""
  });
  process.stdout.write(`${JSON.stringify({
    authorUnitId: workOrder.inputs?.authorUnit?.id,
    templateId: templateImplementation.packageId,
    fixedBindings,
    complete: cueOptions.complete,
    nextTarget: cueOptions.nextTarget,
    legalOptions: cueOptions.legalOptions.map(withCueText),
    recommendedPlan: cueOptions.recommendedPlan.map(withCueText),
    cuePool: cueOptions.cuePool.map(withCueText),
    diagnostics: cueOptions.diagnostics ?? []
  }, null, 2)}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
