#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { atomicWriteData, readData } from "../../program-utils.mjs";
import {
  directorAuthorabilityErrors,
  inspectDirectorAuthorability
} from "./authorability.mjs";
import { renumberDirectorResult, validate as validateDirectorCandidate } from "./validate.mjs";
import { assertCurrentDirectorInputs } from "./inspect-boundaries.mjs";
import {
  removeDirectorAuthorabilityLock,
  writeDirectorAuthorabilityLock
} from "./step-locks.mjs";

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const isPackageId = (value) => typeof value === "string"
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);

const loadCuePolicyFromCatalog = async ({ templateId, allowedTemplateIds }) => {
  if (!isPackageId(templateId) || !allowedTemplateIds.has(templateId)) {
    throw new Error(`候选引用了工作单未投递的模板: ${templateId ?? "missing"}`);
  }
  const packageRoot = path.join(systemRoot, "packages", "templates", templateId);
  const manifest = await readData(path.join(packageRoot, "package.yaml"));
  if (manifest?.kind !== "template" || manifest.id !== templateId || typeof manifest.cuePolicy !== "string") {
    throw new Error(`${templateId} 缺少正式 cuePolicy`);
  }
  return import(pathToFileURL(path.resolve(packageRoot, manifest.cuePolicy)).href);
};

export const inspectCurrentDirectorCandidate = async ({ workOrderPath, candidatePath }) => {
  const [workOrder, candidate] = await Promise.all([
    readData(path.resolve(workOrderPath)),
    readData(path.resolve(candidatePath))
  ]);
  const workspaceRoot = assertCurrentDirectorInputs({ workOrder, candidate, candidatePath });
  await removeDirectorAuthorabilityLock({ workspaceRoot, task: workOrder });
  const numbered = workOrder.inputs?.currentVisualPlan
    ? { result: candidate.result, changes: [] }
    : renumberDirectorResult(candidate.result);
  candidate.result = numbered.result;
  const validationErrors = validateDirectorCandidate({
    result: candidate.result,
    context: {
      ...workOrder.inputs,
      understanding: workOrder.inputs?.understanding?.content
    }
  });
  if (validationErrors.length) {
    throw new Error(`Visual Director候选合同失败: ${validationErrors.join("; ")}`);
  }
  if (numbered.changes.length) await atomicWriteData(path.resolve(candidatePath), candidate);
  const allowedTemplateIds = new Set((workOrder.inputs?.templates ?? []).flatMap((template) => (
    isPackageId(template?.id) ? [template.id] : []
  )));
  const inspections = await inspectDirectorAuthorability({
    result: candidate.result,
    cues: workOrder.inputs?.cues ?? [],
    includePlanning: true,
    loadCuePolicy: (templateId) => loadCuePolicyFromCatalog({ templateId, allowedTemplateIds })
  });
  const errors = directorAuthorabilityErrors(inspections);
  if (errors.length) return { authorable: false, units: inspections, errors, renumbered: numbered.changes };
  await writeDirectorAuthorabilityLock({
    workspaceRoot,
    task: workOrder,
    result: candidate.result
  });
  return { authorable: true, units: inspections, renumbered: numbered.changes };
};

const main = async () => {
  const [workOrderPath, candidatePath] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath) {
    throw new Error("用法: inspect-authorability.mjs <workOrderPath> <candidatePath>");
  }
  const inspection = await inspectCurrentDirectorCandidate({ workOrderPath, candidatePath });
  process.stdout.write(`${JSON.stringify(projectDirectorInspection(inspection))}\n`);
  if (!inspection.authorable) process.exitCode = 1;
};

// Director chooses pages and cuts; the author's full motion budget stays in
// the template calculation and author task context.
export const projectDirectorInspection = (inspection) => ({
  ...inspection,
  units: inspection.units.map((unit) => ({
    ...unit,
    ...(unit.planning ? {
      planning: {
        ...unit.planning,
        options: unit.planning.options.map(({ binding, frames }) => ({
          binding,
          frames: frames.map(({ frameId, visibleDurationMs, readableDurationMs }) => ({
            frameId,
            visibleDurationMs,
            readableDurationMs
          }))
        }))
      }
    } : {})
  }))
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
