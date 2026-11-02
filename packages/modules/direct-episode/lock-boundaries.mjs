#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readData } from "../../program-utils.mjs";
import { assertCurrentDirectorInputs } from "./inspect-boundaries.mjs";
import {
  validateDirectorAuthorabilityLock,
  validateDirectorBoundaryInspectionLock,
  writeDirectorBoundariesLock
} from "./step-locks.mjs";
import { validate as validateDirectorCandidate } from "./validate.mjs";

const lockCurrentDirectorBoundaries = async ({ workOrderPath, candidatePath }) => {
  const [workOrder, candidate] = await Promise.all([
    readData(path.resolve(workOrderPath)),
    readData(path.resolve(candidatePath))
  ]);
  const workspaceRoot = assertCurrentDirectorInputs({ workOrder, candidate, candidatePath });
  const stageErrors = validateDirectorCandidate({
    result: candidate.result,
    context: {
      ...workOrder.inputs,
      understanding: workOrder.inputs?.understanding?.content
    }
  });
  if (stageErrors.length) throw new Error(stageErrors.join("; "));
  const capacityErrors = await validateDirectorAuthorabilityLock({ workspaceRoot, task: workOrder, result: candidate.result });
  if (capacityErrors.length) throw new Error(capacityErrors.join("; "));
  const inspectionErrors = await validateDirectorBoundaryInspectionLock({
    workspaceRoot,
    task: workOrder,
    result: candidate.result
  });
  if (inspectionErrors.length) throw new Error(inspectionErrors.join("; "));
  await writeDirectorBoundariesLock({
    workspaceRoot,
    task: workOrder,
    result: candidate.result
  });
  return { locked: true };
};

const main = async () => {
  const [workOrderPath, candidatePath] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath) {
    throw new Error("用法: lock-boundaries.mjs <workOrderPath> <candidatePath>");
  }
  process.stdout.write(`${JSON.stringify(
    await lockCurrentDirectorBoundaries({ workOrderPath, candidatePath }),
    null,
    2
  )}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
