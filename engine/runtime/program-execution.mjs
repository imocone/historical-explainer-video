import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { assertProjectPath, atomicWriteData, hashObject, readData, stableStringify, withoutProducer, withProjectLock } from "../../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { exists, importModule } from "./files.mjs";
import { controllerSpecFor } from "./implementations.mjs";
import { programInvocationTask } from "./tasks.mjs";
import { withWorkflowWrite } from "./acceptance-commit.mjs";
import { cleanupEpisodeMedia } from "../../packages/modules/render-video/runtime/cleanup.mjs";
import { bodyEditOverlapErrors, bodyEditWindows, bodyRuntimeTimingForAuthorUnits, changedBodyViewingUnits } from "../../packages/modules/render-video/runtime/transitions.mjs";
import { parseSrt } from "../p3-input.mjs";
import { authorUnitsForStoryboard, directorResultSlice } from "./storyboard.mjs";

const executionPaths = ({ workspaceRoot, episodeId, stageId }) => {
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), stageId).work;
  return { journal: path.join(work, "program-execution.yaml"), lock: path.join(work, ".program-execution.lock") };
};
const readOptional = async (file) => file && await exists(file) ? readData(file) : null;
const same = (left, right) => stableStringify(left) === stableStringify(right);

export const narrationChanges = ({ before, output, beforeCues, afterCues }) => {
  const narration = before?.files?.narration?.sha256 !== output.files?.narration?.sha256;
  const audio = before?.files?.audio?.sha256 !== output.files?.audio?.sha256;
  const subtitles = before?.files?.subtitles?.sha256 !== output.files?.subtitles?.sha256;
  const boundaries = subtitles && (!beforeCues || !afterCues || !same(beforeCues.map(cue => cue.text), afterCues.map(cue => cue.text)));
  const timingCueRefs = !boundaries && beforeCues && afterCues ? afterCues.filter((cue, index) =>
    cue.startMs !== beforeCues[index]?.startMs || cue.endMs !== beforeCues[index]?.endMs).map(cue => cue.id) : [];
  if (!boundaries && before?.durationMs !== output.durationMs && afterCues?.length) timingCueRefs.push(afterCues.at(-1).id);
  return { narration, audio, subtitles, boundaries, timingCueRefs: [...new Set(timingCueRefs)] };
};

const bodyReferences = (value, refs = new Set()) => {
  if (!value || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value)) {
    if (key === "bodyRefs" && Array.isArray(child)) for (const id of child) refs.add(id);
    else if (key !== "_producer") bodyReferences(child, refs);
  }
  return refs;
};
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
  if (journal.primitive === "program-narration-finalize" && previous) {
    const afterCues = parseSrt(await readFile(paths.narrationSubtitles, "utf8"));
    const delta = narrationChanges({ before: previous, output, beforeCues: journal.beforeCues, afterCues });
    const storyboard = await readOptional(paths.storyboard);
    if (delta.narration) {
      await repair("p3", "director", "口播正文发生实际修改，修订受影响的共享理解与分镜",
        journal.beforeCues ? { previousCues: journal.beforeCues } : {});
      await repair("p4", "opener", "正文发生实际修改，核对片头实际引用与进入方向");
    } else if (delta.boundaries) {
      await repair("p3", "director", "正文未变，字幕分句变化；保留已有语义和画面意图，修正受影响的语义引用与镜头边界", {
        ...(journal.beforeCues ? { cueRebinding: { previousCues: journal.beforeCues } } : {})
      });
      // The director's accepted ranges determine the actual author and P4 consumers.
    } else if (delta.timingCueRefs.length && storyboard?.beats?.length) {
      const selected = storyboard.beats.filter(beat => delta.timingCueRefs.some(id => id >= beat.cueRange[0] && id <= beat.cueRange[1]));
      const selectedIds = new Set(selected.map(beat => beat.id));
      const authorUnits = authorUnitsForStoryboard(storyboard);
      // Timing measurements still identify the affected readers when a new
      // cue is too short to carry the existing camera handles.
      const timing = cues => bodyRuntimeTimingForAuthorUnits({ authorUnits, cues, requireCameraHandles: false });
      const newTiming = timing(afterCues);
      const conflicts = bodyEditOverlapErrors(bodyEditWindows(newTiming.transitions));
      const changedWindows = new Set(journal.beforeCues ? changedBodyViewingUnits({
        before: timing(journal.beforeCues), after: newTiming
      }) : []);
      const units = authorUnits.filter(unit =>
        unit.beatIds.some(id => selectedIds.has(id)) || (unit.treatment && changedWindows.has(unit.id)));
      const selectedAuthorIds = new Set([...selectedIds, ...units.filter(unit => changedWindows.has(unit.id))
        .flatMap(unit => unit.beatIds)]);
      if (conflicts.length) {
        await repair("p3", "director", `口播时间变化后，${conflicts.join("；")}。沿原分镜排开实际转场，保留有效画面和素材`,
          journal.beforeCues ? { cueRebinding: { previousCues: journal.beforeCues } } : {});
      } else if (units.length) {
        const file = getStageWorkPaths(paths, "p3").returnRequest("author");
        const prior = await readOptional(file);
        if (prior && prior.revisionScope !== "body-redesign") throw new Error("P3已有其它作者返工；保留P2交付与收口记录，先协调该任务");
        await atomicWriteData(file, { ...prior, target: "author",
          reason: prior?.reason ? (prior.reason.includes("口播时间变化") ? prior.reason : `${prior.reason}；口播时间变化，只修实际受影响的时窗与Cue，保留有效画面和素材`)
            : "正文与字幕分句未变，口播时间变化；只修实际受影响的时窗与Cue，保留有效画面和素材",
          cueRefs: [], revisionScope: "body-redesign", redesignState: "pending-author",
          baselineVisualPlanSha256: hashObject(directorResultSlice(storyboard)),
          selectedBeatIds: [...new Set([...(prior?.selectedBeatIds ?? []), ...selectedAuthorIds])],
          pendingAuthorUnitIds: [...new Set([...(prior?.pendingAuthorUnitIds ?? []), ...units.map(unit => unit.id)])] });
      }
      const opener = (await readOptional(paths.episodePackage))?.opener;
      const openerRefs = bodyReferences(opener);
      if (opener && (selectedIds.has(storyboard.beats[0]?.id) || [...selectedIds].some(id => openerRefs.has(id)))) {
        await repair("p4", "opener", "片头实际引用的正文时间变化，核对衔接与卡点");
      }
      const video = await readOptional(paths.videoPlan);
      if (video?.spans?.some(span => span.beatIds.some(id => selectedIds.has(id)))) {
        await repair("p4", "video", "已选剧情段的口播时间变化，核对时窗与接镜，保留有效原视频");
      }
    }
    if (delta.narration || delta.audio || delta.subtitles || previous.durationMs !== output.durationMs)
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
      if (primitive === "program-narration-finalize" && journal.before) {
        const paths = getEpisodePaths(workspaceRoot, episodeId);
        if (await exists(paths.narrationSubtitles)) {
          const subtitles = await readFile(paths.narrationSubtitles, "utf8");
          // Old cues only help compare changes; a damaged delivery must remain repairable.
          try { journal.beforeCues = parseSrt(subtitles); } catch { /* No usable comparison. */ }
        }
      }
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
