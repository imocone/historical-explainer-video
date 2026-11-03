import path from "node:path";
import { rm } from "node:fs/promises";
import { assertProjectPath, atomicWriteData, hashObject, readData, stableStringify, withoutProducer, withProjectLock } from "../../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { exists, importModule } from "./files.mjs";
import { controllerSpecFor } from "./implementations.mjs";
import { programInvocationTask } from "./tasks.mjs";
import { withWorkflowWrite } from "./acceptance-commit.mjs";
import { cleanupEpisodeMedia } from "../../packages/modules/render-video/runtime/cleanup.mjs";

const executionPaths = ({ workspaceRoot, episodeId, stageId }) => {
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), stageId).work;
  return { journal: path.join(work, "program-execution.yaml"), lock: path.join(work, ".program-execution.lock") };
};
const readOptional = async (file) => file && await exists(file) ? readData(file) : null;
const same = (left, right) => stableStringify(left) === stableStringify(right);
const finishProgram = async ({ root, workspaceRoot, episodeId, journalPath, journal, output }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const repair = async (stageId, node, reason, extra = {}) => {
    const file = getStageWorkPaths(paths, stageId).returnRequest(node);
    const prior = await readOptional(file);
    if (prior?.revisionScope) return;
    const value = { target: node, reason, cueRefs: [], ...prior, ...extra };
    if (extra.changedAssetIds) value.changedAssetIds = [...new Set([...(prior?.changedAssetIds ?? []), ...extra.changedAssetIds])];
    if (!same(prior, value)) await atomicWriteData(file, value);
  };
  const previous = journal.before;
  const changed = !same(withoutProducer(previous), withoutProducer(output));
  if (changed && journal.primitive === "ai-video-assets") await repair("p4", "render", "素材发生实际修改，更新成片");
  if (journal.primitive === "program-narration-synthesize" && previous?.rawAudio?.sha256 !== output.rawAudio?.sha256) {
    await repair("p2", "author-subtitles", "口播音频发生实际修改，更新字幕");
    await repair("p2", "finalize-narration", "口播音频发生实际修改，更新口播交付");
  }
  if (journal.primitive === "program-narration-finalize" && ["narration", "audio", "subtitles"].some(key => previous?.files?.[key]?.sha256 !== output.files?.[key]?.sha256)) {
    await repair("p3", "understand", "口播交付发生实际修改，更新受影响的理解与设计");
    await repair("p4", "opener", "口播交付发生实际修改，更新片头衔接与时长");
    await repair("p4", "render", "口播交付发生实际修改，更新成片");
  }
  if (journal.returnRequestPath) {
    const request = await readOptional(journal.returnRequestPath);
    if (request && hashObject(request) === journal.returnRequestBefore) {
      await rm(journal.returnRequestPath, { force: true });
    }
  }
  if (journal.primitive === "program-render") await cleanupEpisodeMedia({ workspaceRoot, systemRoot: root, episodeId });
  await rm(journalPath, { force: true });
};

export const pendingProgramCompletion = async (options) => {
  if (!options.episodeId || options.stageId === "p0") return null;
  const files = executionPaths(options);
  const journal = await readOptional(files.journal);
  if (!journal) return null;
  await assertProjectPath({ root: options.workspaceRoot, file: journal.outputPath, label: "程序恢复输出" });
  if (journal.returnRequestPath) await assertProjectPath({ root: options.workspaceRoot, file: journal.returnRequestPath, label: "程序恢复请求" });
  const output = await readOptional(journal.outputPath);
  if (!output || (journal.phase !== "completed" && same(output, journal.before))) return null;
  if (journal.phase === "completed" && hashObject(output) !== journal.outputSha256) throw new Error("程序交付在收口前被改写，保留执行现场");
  if (journal.phase !== "completed" && output._producer?.taskDigest !== journal.taskDigest) throw new Error("程序输出不属于待收口执行，保留现场");
  return { ...files, journal, output };
};

export const recoverProgramCompletion = async (options) => {
  if (!options.episodeId || options.stageId === "p0") return null;
  const files = executionPaths(options);
  if (!(await exists(files.journal))) return null;
  return withProjectLock({ root: options.workspaceRoot, lock: files.lock, label: "程序执行与收口", execute: async () => {
    const pending = await pendingProgramCompletion(options);
    if (!pending) return null;
    await withWorkflowWrite(options.workspaceRoot, () => finishProgram({ ...options, journalPath: files.journal, journal: pending.journal, output: pending.output }));
    return pending.journal.moduleId;
  } });
};

export const executeProgramNode = async ({ root, workspaceRoot, current, authorizePaidTts = false, workflowWriteHeld = false }) => {
  const invocation = current.invocation;
  const episodeId = invocation.episodeId;
  const stageId = current.base.stageId;
  const entry = await importModule(current.entryPath ?? path.resolve(current.record.directory, current.record.manifest.programEntry));
  if (typeof entry.run !== "function") throw new Error(`${current.record.manifest.id} 的程序入口必须导出 run`);
  const primitive = controllerSpecFor(current.record).primitive;
  const run = () => entry.run({ root: workspaceRoot, systemRoot: root, ...invocation, task: programInvocationTask(current, {
    authorizePaidTts: primitive === "program-narration-synthesize" && authorizePaidTts
  }) });
  const files = executionPaths({ workspaceRoot, episodeId, stageId });
  return withProjectLock({ root: workspaceRoot, lock: files.lock, label: "程序执行与收口", execute: async () => {
    let journal = await readOptional(files.journal);
    if (journal && (journal.nodeId !== current.node.id || journal.outputPath !== current.outputPath)) throw new Error("尚有其它程序节点执行未收口");
    if (!journal) {
      const request = await readOptional(current.returnRequestPath);
      journal = { nodeId: current.node.id, moduleId: current.record.manifest.id, primitive, taskDigest: current.taskDigest,
        outputPath: current.outputPath, before: await readOptional(current.outputPath),
        returnRequestPath: current.returnRequestPath ?? null, returnRequestBefore: request ? hashObject(request) : null };
      await atomicWriteData(files.journal, journal);
    }
    const pending = await pendingProgramCompletion({ workspaceRoot, episodeId, stageId });
    if (!pending) {
      journal.taskDigest = current.taskDigest;
      await atomicWriteData(files.journal, journal);
      try {
        const result = await run();
        if (result?.kind === "image-generation-batch") {
          await rm(files.journal, { force: true });
          return result;
        }
      } catch (error) {
        // The module owns remote recovery; no changed delivery means no local closeout.
        if (same(await readOptional(current.outputPath), journal.before)) await rm(files.journal, { force: true });
        throw error;
      }
    }
    const output = pending?.output ?? await readData(current.outputPath);
    journal = { ...journal, phase: "completed", outputSha256: hashObject(output) };
    await atomicWriteData(files.journal, journal);
    const finish = () => finishProgram({ root, workspaceRoot, episodeId, journalPath: files.journal, journal, output });
    if (workflowWriteHeld) await finish();
    else await withWorkflowWrite(workspaceRoot, finish);
    return output;
  } });
};
