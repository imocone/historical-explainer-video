#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashObject, readData } from "../../program-utils.mjs";
import {
  validateDirectorAuthorabilityLock,
  writeDirectorBoundaryInspectionLock
} from "./step-locks.mjs";
import { validate as validateDirectorCandidate } from "./validate.mjs";

const recurringElementRefsForBeat = ({ albumPlan, beatId }) => (
  (albumPlan?.recurringElements ?? []).filter((element) => (
    (element.beatRefs ?? []).includes(beatId)
  )).map((element) => element.id)
);

const cueSliceForBeat = ({ beat, cues, cueIndex }) => {
  const [firstCueId, lastCueId] = beat.cueRange ?? [];
  const start = cueIndex.get(String(firstCueId));
  const end = cueIndex.get(String(lastCueId));
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    throw new Error(`${beat.id} cueRange 无法在正式 cues 中定位`);
  }
  return cues.slice(start, end + 1);
};

export const inspectDirectorBoundaries = ({ workOrder, candidate }) => {
  const cues = workOrder?.inputs?.cues ?? [];
  const cueIndex = new Map(cues.map((cue, index) => [String(cue.id), index]));
  const result = candidate?.result ?? candidate;
  const beats = result?.beats ?? [];
  if (!beats.length) throw new Error("候选缺少 beats");
  const beatCues = beats.map((beat) => ({
    beat,
    cues: cueSliceForBeat({ beat, cues, cueIndex })
  }));
  const beatIndex = beatCues.map(({ beat, cues: currentCues }) => ({
    id: beat.id,
    cueRange: structuredClone(beat.cueRange),
    durationMs: currentCues.at(-1).endMs - currentCues[0].startMs,
    recurringElementRefs: recurringElementRefsForBeat({
      albumPlan: result.albumPlan,
      beatId: beat.id
    })
  }));
  const internalBoundaries = beatCues.filter(({ beat }) => (
    beat.templateId === "fullframe-narrative"
  )).flatMap(({ beat, cues: currentCues }) => (
    currentCues.slice(0, -1).map((cue, index) => ({
      beatId: beat.id,
      boundary: `${cue.id}/${currentCues[index + 1].id}`,
      leftCueRange: [currentCues[0].id, cue.id],
      rightCueRange: [currentCues[index + 1].id, currentCues.at(-1).id]
    }))
  ));
  const betweenBeatBoundaries = beatCues.slice(0, -1).map((left, index) => {
    const right = beatCues[index + 1];
    return {
      boundary: `${left.beat.id}/${right.beat.id}`,
      leftBeatId: left.beat.id,
      rightBeatId: right.beat.id,
      leftCueRange: structuredClone(left.beat.cueRange),
      rightCueRange: structuredClone(right.beat.cueRange)
    };
  });
  return {
    summary: {
      beatCount: beats.length,
      cueCount: cues.length,
      recurringElementCount: result.albumPlan?.recurringElements?.length ?? 0,
      internalBoundaryCount: internalBoundaries.length,
      betweenBeatBoundaryCount: betweenBeatBoundaries.length
    },
    sourcePointers: {
      albumPlan: "candidate.result.albumPlan",
      beatContracts: "candidate.result.beats",
      cueTexts: "workOrder.inputs.cues"
    },
    beatIndex,
    internalBoundaries,
    betweenBeatBoundaries
  };
};

export const assertCurrentDirectorInputs = ({ workOrder, candidate, candidatePath }) => {
  if (workOrder.stageId !== "p3"
    || workOrder.moduleId !== "direct-episode"
    || workOrder.resolvedAssembly?.node?.id !== workOrder.nodeId
    || workOrder.resolvedAssembly?.node?.moduleId !== workOrder.moduleId
    || workOrder.resolvedAssembly?.module?.id !== workOrder.moduleId) {
    throw new Error("导演入口只接受正式 P3 direct-episode 工作单");
  }
  const { taskDigest, ...workOrderBase } = workOrder;
  if (hashObject(workOrderBase) !== taskDigest) throw new Error("work-order 自身内容已被改写");
  if (candidate?.taskDigest !== taskDigest) throw new Error("候选与工作单 taskDigest 不一致");
  if (!candidate?.result || candidate.returnTo) throw new Error("导演入口只接受当前Visual Director结果候选");
  const relativeCandidate = workOrder.candidatePath;
  if (typeof relativeCandidate !== "string" || path.isAbsolute(relativeCandidate)) {
    throw new Error("工作单 candidatePath 必须是节目工作区内的相对路径");
  }
  const parts = relativeCandidate.split("/").filter(Boolean);
  let workspaceRoot = path.resolve(candidatePath);
  for (let index = 0; index < parts.length; index += 1) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, relativeCandidate) !== path.resolve(candidatePath)) {
    throw new Error("候选路径与工作单 candidatePath 不一致");
  }
  return workspaceRoot;
};

const main = async () => {
  const [workOrderPath, candidatePath] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath) {
    throw new Error("用法: inspect-boundaries.mjs <workOrderPath> <candidatePath>");
  }
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
  const inspection = inspectDirectorBoundaries({ workOrder, candidate });
  await writeDirectorBoundaryInspectionLock({
    workspaceRoot,
    task: workOrder,
    result: candidate.result
  });
  process.stdout.write(`${JSON.stringify(inspection)}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
