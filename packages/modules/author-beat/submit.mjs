#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readData } from "../../program-utils.mjs";
import { authorTaskSegmentId, getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { deriveAuthorWorkspaceRoot } from "./candidate-validation.mjs";

const systemRoot = fileURLToPath(new URL("../../../", import.meta.url));
const execute = (...args) => JSON.parse(execFileSync(process.execPath, args,
  { cwd: systemRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));

// The author checks its one candidate; the director owns acceptance and scheduling.
export const submitAuthorCandidate = async ({ workOrderPath, candidatePath, workspace,
  episode, run = execute }) => {
  const file = path.resolve(workOrderPath), candidate = path.resolve(candidatePath);
  const task = await readData(file);
  const workspaceRoot = deriveAuthorWorkspaceRoot({ workOrder: task, candidatePath: candidate });
  const segmentId = authorTaskSegmentId(task);
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, episode), "p3", segmentId);
  if (workspaceRoot !== path.resolve(workspace) || task.subject?.id !== episode || task.stageId !== "p3"
    || task.moduleId !== "author-beat" || task.runner !== "ai" || file !== work.workOrder || candidate !== work.candidate)
    throw new Error("提交参数必须指向同集P3作者的当前工作单和唯一候选");
  return { preflight: run("packages/modules/author-beat/preflight.mjs", file, candidate),
    taskId: task.taskId, segmentId, workOrderPath: file, candidatePath: candidate };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [workOrderPath, candidatePath, workspace, episode, extra] = process.argv.slice(2);
  if (!workOrderPath || !candidatePath || !workspace || !episode || extra) {
    process.stderr.write("用法: submit.mjs <工作单> <候选> <节目目录> <epNN>\n");
    process.exitCode = 1;
  } else {
    Promise.resolve().then(() => submitAuthorCandidate({ workOrderPath, candidatePath, workspace, episode }))
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  }
}
