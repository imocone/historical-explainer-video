import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { assertProjectPath, hashObject, readData, sha256 } from "../../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths, listAuthorWorkPaths, p4WorkPaths } from "../../packages/workspace-paths.mjs";

import { commitAcceptance, withWorkflowWrite } from "./acceptance-commit.mjs";
import { exists } from "./files.mjs";

export const EPISODE_STAGES = ["p1", "p2", "p3", "p4"];
export const restartPath = (workspaceRoot, episodeId, stageId) =>
  path.join(getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), stageId).work, "restart.yaml");

export const readStageRestart = async ({ workspaceRoot, episodeId, stageId }) => {
  if (!episodeId || !EPISODE_STAGES.includes(stageId)) return null;
  const file = restartPath(workspaceRoot, episodeId, stageId);
  await assertProjectPath({ root: workspaceRoot, file, label: "阶段重跑记录" });
  if (!await exists(file)) return null;
  const value = await readData(file);
  if (value.stageId !== stageId || !/^[0-9a-f-]{36}$/u.test(value.id ?? ""))
    throw new Error("阶段重跑身份无效，保留现场");
  return value;
};

export const restartToken = (restart) => restart ? hashObject({ stageRestart: restart.id }) : null;
export const restartPending = (model, artifact) => Boolean(model.stageRestart
  && !artifact?._producer?.inputs?.includes(restartToken(model.stageRestart)));

// A paid operation must finish on its original identity before a fresh attempt.
const readRemoteRecords = async (root, directory, records = []) => {
  await assertProjectPath({ root, file: directory, label: "重跑前远端记录" });
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (entry.name === "restarts") continue;
    const file = path.join(directory, entry.name);
    if (entry.name.endsWith(".lock")) throw new Error(`当前执行尚未释放，请先结束或恢复原任务: ${file}`);
    if (entry.isDirectory()) { await readRemoteRecords(root, file, records); continue; }
    if (!["generation.json", "tool-call.json", "tts-intent.yaml", "opener-tts-intent.yaml"].includes(entry.name)) continue;
    await assertProjectPath({ root, file, label: "重跑前远端记录" });
    const record = await readData(file);
    records.push({ file, record });
  }
  return records;
};

export const assertStageSettled = async (root, directory) => {
  const records = await readRemoteRecords(root, directory);
  const superseded = new Set(records.map(({ record }) => record.request?.replacesRequestDigest).filter(Boolean));
  for (const { file, record } of records) {
    const status = record.status ?? record.state;
    if (!superseded.has(record.requestDigest)
      && !["completed", "complete", "succeeded", "superseded", "not-created", "remote-failed", "submit-rejected", "local-rejected", "failed", "rejected"].includes(status))
      throw new Error(`先恢复原远端任务，再更换工作: ${file} (${status})`);
  }
};

// Reset changes execution intent, never the accepted deliverables or remote receipts.
export async function resetStage(options) {
  const { workspaceRoot, episodeId, stageId } = options;
  if (!EPISODE_STAGES.includes(stageId)) throw new Error("reset 只支持 P1—P4（含 p4）");
  return withWorkflowWrite(workspaceRoot, async () => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const workPaths = getStageWorkPaths(paths, stageId);
  const subjects = [workPaths];
  if (stageId === "p4") subjects.push(...p4WorkPaths(paths));
  if (stageId === "p3") subjects.push(...await listAuthorWorkPaths(paths));

  const restart = { id: randomUUID(), stageId, startedAt: new Date().toISOString() };
  const writes = new Map([[restartPath(workspaceRoot, episodeId, stageId), restart]]);
  const rawWrites = new Map();
  const snapshots = new Map();
  const cleanup = [];
  const archive = async (file, destination) => {
    await assertProjectPath({ root: workspaceRoot, file, label: "重跑前工作记录" });
    const text = await readFile(file, "utf8");
    snapshots.set(file, sha256(text));
    rawWrites.set(destination, text);
  };
  for (const work of subjects) {
    for (const name of await readdir(work.work).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error))) {
      if (!["work-order.yaml", "candidate.yaml", "restart.yaml", "cover-regeneration.yaml",
        "tts-intent.yaml", "tts-result.yaml", "opener-tts-intent.yaml", "opener-tts-result.yaml"].includes(name)
        && !/^return-.*\.yaml$/u.test(name)) continue;
      const file = path.join(work.work, name);
      await archive(file, path.join(work.work, "restarts", restart.id, name));
      if (name !== "restart.yaml" && !name.includes("tts-")) cleanup.push(file);
    }
    const held = path.join(work.work, "held-work");
    await assertProjectPath({ root: workspaceRoot, file: held, label: "重跑前保留工作" });
    for (const name of await readdir(held).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error))) {
      const file = path.join(held, name);
      await archive(file, path.join(work.work, "restarts", restart.id, "held-work", name));
      cleanup.push(file);
    }
  }
  const ttsResult = stageId === "p2" ? paths.ttsResult
    : stageId === "p4" ? path.join(paths.p4, "opener-tts-result.yaml") : null;
  if (ttsResult && await exists(ttsResult)) {
    await archive(ttsResult, path.join(workPaths.work, "restarts", restart.id, path.basename(ttsResult)));
  }
  const runFile = path.join(paths.production, "run.yaml");
  await assertProjectPath({ root: workspaceRoot, file: runFile, label: "单集执行范围" });
  if (await exists(runFile)) {
    const run = await readData(runFile);
    snapshots.set(runFile, sha256(await readFile(runFile, "utf8")));
    const index = EPISODE_STAGES.indexOf(stageId);
    if (EPISODE_STAGES.indexOf(run.from) <= index && index <= EPISODE_STAGES.indexOf(run.to))
      writes.set(runFile, { ...run, stage: stageId, finished: false });
  }
  const result = { kind: "stage-reset", episodeId, stageId, restartId: restart.id,
    message: `${stageId} 已登记整阶段重跑；上游、旧成果和远端记录保留，运行同阶段 next 开始` };
  return commitAcceptance({ workspaceRoot, workPaths, writes, rawWrites, cleanup, result, workflowWriteHeld: true,
    verify: async () => {
      await assertStageSettled(workspaceRoot, path.join(paths.production, stageId));

      for (const work of subjects) {
        for (const name of ["acceptance-commit.yaml", "program-execution.yaml"])
          if (await exists(path.join(work.work, name))) throw new Error("当前阶段仍有执行或接纳待恢复，保留现场");
      }
      for (const [file, expected] of snapshots)
        if (!await exists(file) || sha256(await readFile(file, "utf8")) !== expected)
          throw new Error("重置前现场已变化，请重新读取当前阶段");
      for (const file of [...writes.keys(), ...rawWrites.keys()]) await assertProjectPath({ root: workspaceRoot, file, label: "阶段重跑写入" });
    }
  });
  });
}
