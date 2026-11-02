#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteData, readData } from "../../program-utils.mjs";
import { validateSchema } from "../../modules/author-beat/candidate-validation.mjs";
import { orderCueSyncBindings } from "../../features/cue-sync/resolve.mjs";
import { validate, validateRuntime } from "../../features/cue-sync/validate.mjs";
import * as templatePolicy from "./cue-policy.mjs";
import { assertFullframeDesignTask } from "./task-contract.mjs";
import { writeCalloutContentLock } from "./callout/step-locks.mjs";
import { fullframeAuthorViews } from "./author-batch.mjs";

const treatmentSchema = fileURLToPath(new URL("../../../contracts/fullframe-treatment.schema.json", import.meta.url));
const cueSchema = fileURLToPath(new URL("../../../contracts/cue-sync.schema.json", import.meta.url));

export const lockFullframeCallouts = async ({ workOrderPath, candidatePath }) => {
  const [workOrder, candidate] = await Promise.all([
    readData(path.resolve(workOrderPath)),
    readData(path.resolve(candidatePath))
  ]);
  const workspaceRoot = assertFullframeDesignTask({ workOrder, candidate, candidatePath });
  const views = await fullframeAuthorViews({ workspaceRoot, workOrder, candidate });
  for (const view of views) {
    await lockCalloutView({ workspaceRoot, workOrder: view.workOrder, candidate: view.candidate });
    if (view.item) Object.assign(view.item, view.candidate.result);
  }
  await atomicWriteData(path.resolve(candidatePath), candidate);
  return { locked: true, taskDigest: workOrder.taskDigest, step: "fullframe-callouts",
    ...(workOrder.inputs.authorBatch ? { beatIds: views.map(view => view.item.beatId) } : {}) };
};

const lockCalloutView = async ({ workspaceRoot, workOrder, candidate }) => {
  const treatment = candidate.result.treatment;
  const original = candidate.result.featureResults?.["cue-sync"];
  await validateSchema(treatmentSchema, treatment, "fullframe treatment");
  await validateSchema(cueSchema, original, "cue-sync");
  const ordered = orderCueSyncBindings({
    result: original,
    allowedTargets: templatePolicy.cueSyncTargetsForTreatment(treatment),
    cues: workOrder.inputs.cues
  });
  const context = { ...workOrder.inputs, treatment, templatePolicy };
  const errors = [
    ...validate({ result: ordered, context }),
    ...await validateRuntime({ result: ordered, context })
  ];
  if (errors.length) throw new Error(errors.join("; "));
  candidate.result.featureResults["cue-sync"] = ordered;
  await writeCalloutContentLock({
    workspaceRoot,
    task: workOrder,
    candidateResult: candidate.result,
    context: workOrder.inputs
  });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [workOrderPath, candidatePath] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath) {
    process.stderr.write("用法: lock-callouts.mjs <workOrderPath> <candidatePath>\n");
    process.exitCode = 1;
  } else {
    lockFullframeCallouts({ workOrderPath, candidatePath })
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}
