import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { assertProjectPath, atomicWrite, atomicWriteData, hashObject, readData, sha256, withProjectLock } from "../../packages/program-utils.mjs";
import { getEpisodePaths, getProgramPaths, getStageWorkPaths, listAuthorWorkPaths, p4WorkPaths } from "../../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../../packages/publication-paths.mjs";
import { compactAcceptedNarrationMaterials } from "../p1-revision-materials.mjs";
import { exists } from "./files.mjs";

export const withWorkflowWrite = (workspaceRoot, execute) => withProjectLock({
  root: workspaceRoot,
  lock: path.join(workspaceRoot, "制作", ".workflow-write.lock"),
  label: "工作单与接纳写入",
  execute
});
const contentHash = (text) => {
  try { return hashObject(JSON.parse(text)); } catch { return sha256(text); }
};
const snapshot = async (file) => await exists(file) ? contentHash(await readFile(file, "utf8")) : null;
const writtenHash = (entry) => entry.text !== undefined ? contentHash(entry.text)
  : entry.value === undefined ? null : hashObject(entry.value);

const finish = async ({ workspaceRoot, journalPath, journal }) => {
  // Only the same candidate's old or already-written value can be resumed.
  for (const entry of [...journal.writes, ...journal.cleanup.filter(item => !journal.writes.some(write => write.file === item.file))]) {
    await assertProjectPath({ root: workspaceRoot, file: entry.file, label: "接纳恢复目标" });
    const actual = await snapshot(entry.file);
    if (actual !== entry.before && actual !== writtenHash(entry)
      && !(actual === null && journal.cleanup.some(item => item.file === entry.file))) {
      throw new Error(`接纳恢复目标已被其他写入改变，保留现场: ${entry.file}`);
    }
  }
  for (const entry of journal.writes) {
    const { file, value, text } = entry;
    const actual = await snapshot(file);
    if (actual === writtenHash(entry)) continue;
    if (actual === null && journal.cleanup.some(item => item.file === file)) continue;
    if (text !== undefined) await atomicWrite(file, text);
    else await atomicWriteData(file, value);
  }
  if (journal.materials) await compactAcceptedNarrationMaterials({ workspaceRoot, ...journal.materials });
  for (const { file } of journal.cleanup) await rm(file, { force: true });
  if (journal.scratchPath) {
    await assertProjectPath({ root: workspaceRoot, file: journal.scratchPath, label: "接纳临时目录" });
    await rm(journal.scratchPath, { recursive: true, force: true });
  }
  await rm(journalPath, { force: true });
  return journal.result;
};

export const commitAcceptance = async ({ workspaceRoot, workPaths, writes, rawWrites = new Map(), cleanup, scratchPath, materials, result, verify, workflowWriteHeld = false }) => {
 const commit = async () => {
  await verify();
  const journalPath = path.join(workPaths.work, "acceptance-commit.yaml");
  if (await exists(journalPath)) throw new Error("已有未收口接纳，请先恢复同一候选");
  const entries = [];
  for (const [file, value] of writes) entries.push({ file, value, before: await snapshot(file) });
  for (const [file, text] of rawWrites) entries.push({ file, text, before: await snapshot(file) });
  const cleanupEntries = [];
  for (const file of cleanup) cleanupEntries.push({ file, before: await snapshot(file) });
  const journal = { writes: entries, cleanup: cleanupEntries, scratchPath, materials, result };
  await atomicWriteData(journalPath, journal);
  return finish({ workspaceRoot, journalPath, journal });
 };
 return workflowWriteHeld ? commit() : withWorkflowWrite(workspaceRoot, commit);
};

export const pendingAcceptance = async ({ workspaceRoot, episodeId, stageId, targetId = "release-main" }) => {
  if (["p2", "p4"].includes(stageId)) {
    const pending = await pendingAcceptance({ workspaceRoot, episodeId, stageId: "p1" });
    if (pending) return pending;
  }
  const subjects = stageId === "p0" ? [getProgramPaths(workspaceRoot)] : [getEpisodePaths(workspaceRoot, episodeId)];

  const workPaths = subjects.map(subject => getStageWorkPaths(subject, stageId));
  if (stageId === "p4") workPaths.push(...p4WorkPaths(subjects[0]));
  if (stageId === "p3") workPaths.push(...await listAuthorWorkPaths(subjects[0]));
  for (const work of workPaths) {
    const journalPath = path.join(work.work, "acceptance-commit.yaml");
    if (await exists(journalPath)) {
      const journal = await readData(journalPath);

      return { journalPath, journal };
    }
  }
  return null;
};

export const recoverAcceptance = async (options) => withWorkflowWrite(options.workspaceRoot, async () => {
  const selectedJournal = options.segmentId || options.nodeId ? path.join(getStageWorkPaths(
    getEpisodePaths(options.workspaceRoot, options.episodeId), options.stageId, options.segmentId, options.nodeId
  ).work, "acceptance-commit.yaml") : null;
  let result = null;
  for (let pending; (pending = await pendingAcceptance(options));) {
    const recovered = await finish({ workspaceRoot: options.workspaceRoot, ...pending });
    if (!selectedJournal || pending.journalPath === selectedJournal) result = recovered;
  }
  return result;
});
