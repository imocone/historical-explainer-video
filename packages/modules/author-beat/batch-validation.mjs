import path from "node:path";
import { validateSchema, validateTreatmentCandidate } from "./candidate-validation.mjs";
import { fullframeAuthorViews } from "../../templates/fullframe-narrative/author-batch.mjs";
import { orderCueSyncBindings } from "../../features/cue-sync/resolve.mjs";

export const validateAuthorBatch = async ({ candidateResult, task, systemRoot, workspaceRoot,
  templateImplementation, loadResource, ...options }) => {
  await validateSchema(path.join(systemRoot, "contracts/author-batch-result.schema.json"), candidateResult, "联合候选");
  const views = await fullframeAuthorViews({ workspaceRoot, workOrder: task,
    candidate: { taskDigest: task.taskDigest, result: candidateResult } });
  const policySource = templateImplementation.resources.find(resource => resource.role === "cuePolicy").source;
  const policy = await loadResource(policySource);
  const featureIds = new Set((options.featureImplementations ?? []).map(implementation => implementation.packageId));
  for (const view of views) {
    const result = view.candidate.result;
    if (Object.keys(result.featureResults).some(id => !featureIds.has(id))) {
      throw new Error(`${view.item.beatId} 写入了未启用功能`);
    }
    if (result.featureResults["cue-sync"]) result.featureResults["cue-sync"] = orderCueSyncBindings({
      result: result.featureResults["cue-sync"], cues: view.workOrder.inputs.cues,
      allowedTargets: policy.cueSyncTargetsForTreatment(result.treatment)
    });
    const validation = await validateTreatmentCandidate({ ...options, candidateResult: result,
      context: { ...view.workOrder.inputs, selectedTemplate: templateImplementation.packageId },
      task: view.workOrder, systemRoot, workspaceRoot, templateImplementation, loadResource });
    if (validation.errors.length) throw new Error(`${view.item.beatId}: ${validation.errors.join("；")}`);
    view.item.treatment = result.treatment;
    view.item.featureResults = result.featureResults;
  }
  return views;
};
