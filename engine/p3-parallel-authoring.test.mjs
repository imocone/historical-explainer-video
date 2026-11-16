import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { acceptCandidate, deriveStatus, resetStage, runNext } from "./runtime.mjs";
import { hashObject, readData, sha256, withProjectLock } from "../packages/program-utils.mjs";
import { getEpisodePaths, getProgramPaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { createAppearance } from "../packages/templates/vox-explainer/appearance.mjs";
import { submitAuthorCandidate } from "../packages/modules/author-beat/submit.mjs";
import { pendingAcceptance, recoverAcceptance } from "./runtime/acceptance-commit.mjs";
import { recoverProgramCompletion } from "./runtime/program-execution.mjs";
import { parseSrt } from "./p3-input.mjs";
import {registerP3Source, readP3Sources} from "../packages/p3-sources.mjs";
import {publishHistoricalContext, bindHistoricalContext} from "../packages/modules/direct-episode/historical-context/handoff.mjs";
import {preflightAuthorCandidate} from "../packages/modules/author-beat/preflight.mjs";
import {preview} from "../packages/templates/vox-explainer/preview.mjs";
import {withRenderQueueHeld} from "../packages/modules/render-video/runtime/media-test-helpers.test.mjs";
import {inspectCurrentDirectorCandidate} from "../packages/modules/direct-episode/inspect-authorability.mjs";
import {inspectFullframeDesign} from "../packages/templates/fullframe-narrative/inspect-design.mjs";
import {lockFullframeCallouts} from "../packages/templates/fullframe-narrative/lock-callouts.mjs";
import {fullframeBatchItems} from "../packages/templates/fullframe-narrative/author-batch.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
};
const setup = async (t, templates = Array(3).fill("vox-explainer")) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p3-parallel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const options = { root, workspaceRoot, episodeId: "ep01", stageId: "p3" };
  const paths = getEpisodePaths(workspaceRoot, "ep01");
  const visual = await readData(path.join(root, "visuals/meiji-state-machine/visual-package.json"));
  await write(getProgramPaths(workspaceRoot).programPlan, { programForm: "historical-explainer",
    openerTemplate: "episode-opener", visualPackage: { visualPackageId: visual.id, version: visual.version } });
  const narration = templates.map((_, i) => `观察第${i + 1}项变化。`).join("\n");
  const subtitles = narration.split("\n").map((text, i) => `${i + 1}\n00:00:${String(i * 6).padStart(2, "0")},000 --> 00:00:${String((i + 1) * 6).padStart(2, "0")},000\n${text}\n`).join("\n");
  await write(paths.narrationText, narration);
  await write(paths.narrationSubtitles, subtitles);
  const audio = Buffer.alloc(44 + templates.length * 6 * 8000 * 2);
  audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  await writeFile(path.join(paths.p2, "narration.wav"), audio);
  await write(paths.narrationPackage, { episodeId: "ep01", durationMs: templates.length * 6000, files: {
    narration: { path: "narration.txt", sha256: sha256(narration) },
    audio: {path: "narration.wav", sha256: sha256(audio)},
    subtitles: { path: "narration.srt", sha256: sha256(subtitles) } } });
  await write(paths.sourceAssets, { schemaVersion: "1.0", assets: [] });
  await write(paths.storyboard, { episodeId: "ep01", understanding: {
    episodeQuestion: "如何辨认变化？", thesis: "比较同一对象", narrativeArc: { start: "观察", turn: "比较", end: "确认" },
    facts: [], relations: [], evidence: [], uncertainties: [], mustNotInvent: ["不增加数量"],
    semanticReading: { underlyingMeaning: "理解变化", audienceStartingPoint: "尚未比较", targetUnderstanding: "看见区别",
      speakerStances: [], contextConstraints: [], rhetoricalReadings: [], humanStakes: [] } },
    albumPlan: { intent: "比较变化", openingState: "起点", progression: "比较", endingState: "结果", recurringElements: [] },
    beats: templates.map((templateId, index) => ({ id: `B00${index + 1}`, cueRange: [index + 1, index + 1], templateId,
      viewerOutcome: "辨认变化", directorBrief: { roleInAlbum: "比较", mustShow: "当前状态", relationFromPrevious: null } })),
    templateRuns: templates.map((templateId, index) => ({ id: `TR00${index + 1}`, templateId, beatIds: [`B00${index + 1}`] })),
    features: { "cue-sync": { bindings: {} } } });
  return { options, paths };
};
const resultFor = cueId => ({ treatment: { templateId: "vox-explainer", appearance: createAppearance({palette: {
  background: '#ffffff', ink: '#202020', paper: '#f0f0f0', accent: '#c83c32', secondary: '#3268c8'}}), objective: "辨认当前状态",
  continuity: { period: "测试时期", location: "测试现场", subjects: [], props: [], carryToNext: { subjects: [], props: [] } },
  assetRequests: [], moments: [{id: "M001", purpose: "看清状态", sourceRefs: [`C00${cueId}`]}],
  scene: {markup: '<div id="state">状态</div>', animation: "timeline.set(select('#state'),{opacity:1},cue('M001'));"} },
  featureResults: { "cue-sync": { items: [{ target: "M001", action: "advance-explainer", cueId, edge: "start" }] } } });

const exec = promisify(execFile);
const cli = async (options, command, ...flags) => {
  const { stdout } = await exec(process.execPath, [path.join(root, "engine/cli.mjs"), command,
    "--workspace", options.workspaceRoot, "--episode", options.episodeId, "--stage", options.stageId, ...flags],
  { cwd: root, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
};

const deliverRetimedCues = async ({ options, paths, before, after }) => {
  const prior = await readData(paths.narrationPackage);
  const output = structuredClone(prior);
  output.files.subtitles.sha256 = sha256(after);
  await write(paths.narrationSubtitles, after);
  await write(paths.narrationPackage, output);
  const work = getStageWorkPaths(paths, "p2");
  await write(path.join(work.work, "program-execution.yaml"), {
    before: prior, beforeCues: parseSrt(before), phase: "completed",
    primitive: "program-narration-finalize", moduleId: "finalize-narration",
    outputPath: paths.narrationPackage, outputSha256: hashObject(output)
  });
  assert.equal(await recoverProgramCompletion({ ...options, stageId: "p2" }), "finalize-narration");
};

test("导演在制作前看见两个不同切点挤占同一批帧，并在原分镜排开", async t => {
  const { options, paths } = await setup(t, ["fullframe-narrative", "fullframe-narrative", "vox-explainer"]);
  const { understanding, albumPlan, beats, templateRuns } = await readData(paths.storyboard);
  for (const [index, beat] of beats.entries()) {
    Object.assign(beat.directorBrief, { entryFocus: "认出同一对象", reveal: "看清变化", exitHold: "留下结果",
      relationFromPrevious: index ? "沿同一对象承接" : null });
  }
  beats[0].incomingTransition = null;
  beats[1].incomingTransition = { type: "dissolve", durationMs: 1600, reason: "延续同一处境，叠化让观众追认上一镜的对象" };
  await rm(paths.storyboard);
  const subtitles = (await readFile(paths.narrationSubtitles, "utf8")).replaceAll("00:00:12,000", "00:00:07,100");
  await write(paths.narrationSubtitles, subtitles);
  const narrationPackage = await readData(paths.narrationPackage);
  narrationPackage.files.subtitles.sha256 = sha256(subtitles);
  await write(paths.narrationPackage, narrationPackage);
  const director = await cli(options, "next");
  const work = getStageWorkPaths(paths, "p3");
  const candidate = { taskDigest: director.taskDigest, result: { understanding, albumPlan, beats, templateRuns } };
  await write(work.candidate, candidate);
  const inspect = () => inspectCurrentDirectorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate });
  const collision = await inspect();
  assert.deepEqual(collision.editWindows, [
    { boundaryId: "B001->B002", type: "dissolve", startFrame: 312, endFrame: 408 },
    { boundaryId: "B002->TR003", type: "vox-push", startFrame: 396, endFrame: 426 }
  ]);
  assert.deepEqual(collision.errors, ["B001->B002 和 B002->TR003 的转场重叠 12 帧"]);
  beats[1].incomingTransition.durationMs = 600;
  await write(work.candidate, candidate);
  const repaired = await inspect();
  assert.equal(repaired.authorable, true);
  assert.equal(repaired.editWindows[1].startFrame - repaired.editWindows[0].endFrame, 18);
  for (const name of ["inspect-boundaries", "lock-boundaries"]) {
    await exec(process.execPath, [path.join(root, `packages/modules/direct-episode/${name}.mjs`), work.workOrder, work.candidate]);
  }
  assert.equal((await cli(options, "accept")).kind, "accepted");

  const left = await cli(options, "next", "--claim", "fullframe");
  const right = await cli(options, "next", "--claim", "fullframe");
  const leftWork = getStageWorkPaths(paths, "p3", left.segmentId);
  const rightWork = getStageWorkPaths(paths, "p3", right.segmentId);
  const rightDraft = { taskDigest: right.taskDigest, result: { items: [] } };
  await write(rightWork.candidate, rightDraft);
  const rightProject = path.join(options.workspaceRoot, right.scratchPath, "work-in-progress.txt");
  await write(rightProject, "切点调整前已经做好的画面材料");
  const revision = await cli(options, "next", "--revise-director", "--beat", "B001", "--beat", "B002",
    "--revision-reason", "再给第二镜留出一点清楚显露的时间");
  const updated = (await readData(work.workOrder)).inputs.currentVisualPlan;
  updated.beats[1].incomingTransition.durationMs = 500;
  await write(work.candidate, { taskDigest: revision.taskDigest, result: updated });
  assert.equal((await inspect()).authorable, true);
  for (const name of ["inspect-boundaries", "lock-boundaries"]) {
    await exec(process.execPath, [path.join(root, `packages/modules/direct-episode/${name}.mjs`), work.workOrder, work.candidate]);
  }
  assert.equal((await cli(options, "accept")).kind, "accepted");
  assert.equal((await readData(leftWork.workOrder)).taskDigest, left.taskDigest);
  assert.equal((await readData(rightWork.workOrder)).taskDigest, right.taskDigest);
  assert.deepEqual(await readData(rightWork.candidate), rightDraft);
  const resumed = await cli(options, "next", "--segment", right.segmentId);
  assert.notEqual(resumed.taskDigest, right.taskDigest);
  const parked = path.join(rightWork.work, "held-work", right.taskDigest + ".json");
  assert.deepEqual((await readData(parked)).candidate, rightDraft);
  assert.equal(await readFile(rightProject, "utf8"), "切点调整前已经做好的画面材料");
});

test("口播改时造成实际转场冲突时先回导演，保留原分镜", async t => {
  const { options, paths } = await setup(t, ["fullframe-narrative", "fullframe-narrative", "vox-explainer"]);
  const work = getStageWorkPaths(paths, "p3");
  const storyboard = await readData(paths.storyboard);
  storyboard.beats[0].incomingTransition = null;
  storyboard.beats[1].incomingTransition = { type: "dissolve", durationMs: 1600, reason: "沿同一对象承接" };
  await write(paths.storyboard, storyboard);
  const before = await readFile(paths.narrationSubtitles, "utf8");
  const after = before.replaceAll("00:00:12,000", "00:00:07,100");
  await deliverRetimedCues({ options, paths, before, after });
  const repair = await readData(work.returnRequest("director"));
  assert.match(repair.reason, /B001->B002 和 B002->TR003 的转场重叠 12 帧/);
  assert.deepEqual(repair.cueRebinding.previousCues, parseSrt(before));
  assert.deepEqual(await readData(paths.storyboard), storyboard);
  assert.equal((await cli(options, "next")).taskId, "ep01/director");
});

test("讲解实际推移经导演定稿交给原章作者，续领保留段内设计", async t => {
  const { options, paths } = await setup(t, ["fullframe-narrative", "vox-explainer", "fullframe-narrative"]);
  const storyboard = await readData(paths.storyboard);
  const { understanding, albumPlan, beats, templateRuns } = storyboard;
  for (const [index, beat] of beats.entries()) {
    Object.assign(beat.directorBrief, { entryFocus: "认出同一对象", reveal: "看清变化", exitHold: "留下结果",
      relationFromPrevious: index ? "沿同一对象承接" : null });
    if (beat.templateId === "fullframe-narrative") beat.incomingTransition = null;
  }
  await rm(paths.storyboard);
  const subtitles = (await readFile(paths.narrationSubtitles, "utf8"))
    .replaceAll("00:00:06,000", "00:00:00,200")
    .replace("00:00:12,000 -->", "00:00:12,150 -->");
  await write(paths.narrationSubtitles, subtitles);
  const narrationPackage = await readData(paths.narrationPackage);
  narrationPackage.files.subtitles.sha256 = sha256(subtitles);
  await write(paths.narrationPackage, narrationPackage);

  const director = await cli(options, "next");
  const directorWork = getStageWorkPaths(paths, "p3");
  await write(directorWork.candidate, { taskDigest: director.taskDigest,
    result: { understanding, albumPlan, beats, templateRuns } });
  const inspect = async name => JSON.parse((await exec(process.execPath,
    [path.join(root, `packages/modules/direct-episode/${name}.mjs`), directorWork.workOrder, directorWork.candidate])).stdout);
  const planned = (await inspect("inspect-authorability")).units.find(unit => unit.id === "TR002").planning.viewingWindow;
  assert.deepEqual(planned, {
    entryPush: { startFrame: -12, endFrame: 18 },
    exitPush: { startFrame: 707, endFrame: 737 },
    clearViewing: { startFrame: 18, endFrame: 707 }
  });
  await inspect("inspect-boundaries");
  await inspect("lock-boundaries");
  assert.equal((await cli(options, "accept")).kind, "accepted");
  const accepted = await readData(paths.storyboard);
  assert.deepEqual(accepted.templateRuns.find(run => run.id === "TR002").beatIds, ["B002"]);

  await cli(options, "next", "--sound-effects", "off");
  const claim = await cli(options, "next", "--claim", "explainer");
  const work = getStageWorkPaths(paths, "p3", "TR002");
  const result = resultFor(2);
  result.treatment.scene.animation += "\ntimeline.to(select('#state'),{x:100,duration:1},cue('M001'));";
  const candidate = { taskDigest: claim.taskDigest, result };
  await write(work.candidate, candidate);
  const signed = await readFile(work.workOrder);
  assert.equal(JSON.parse(signed).inputs.templateContext.viewingWindow, undefined);
  const { stdout } = await exec(process.execPath, [path.join(root, "packages/p3-task-view.mjs"), work.workOrder]);
  assert.deepEqual(JSON.parse(stdout).inputs.templateContext.viewingWindow, planned);
  assert.equal((await cli(options, "next", "--segment", "TR002")).taskDigest, claim.taskDigest);
  assert.deepEqual(await readFile(work.workOrder), signed);
  assert.deepEqual(await readData(work.candidate), candidate);

  const draftFile = path.join(options.workspaceRoot, claim.scratchPath, "scene-source.js");
  await write(draftFile, "const originalScene = true;");
  await write(work.candidate, { ...candidate,
    returnTo: { target: "director", reason: "请确认讲解段首是否保留当前承接", cueRefs: [2] } });
  assert.equal((await cli(options, "accept", "--segment", "TR002")).kind, "returned");
  const request = await readData(directorWork.returnRequest("director"));
  assert.equal(request.revisionScope, "director-revision");
  assert.deepEqual(request.selectedBeatIds, ["B002"]);
  assert.equal(await readFile(draftFile, "utf8"), "const originalScene = true;");
  const held = path.join(work.work, "held-work", claim.taskDigest + ".json");
  assert.deepEqual((await readData(held)).candidate, candidate);
  const review = await cli(options, "next");
  const reviewOrder = await readData(directorWork.workOrder);
  await write(directorWork.candidate, { taskDigest: review.taskDigest, result: reviewOrder.inputs.currentVisualPlan });
  await inspect("inspect-authorability");
  await inspect("inspect-boundaries");
  await inspect("lock-boundaries");
  assert.equal((await cli(options, "accept")).kind, "accepted");
  assert.equal((await cli(options, "next", "--segment", "TR002")).taskDigest, claim.taskDigest);
  assert.deepEqual(await readData(work.candidate), candidate);
  assert.equal(await readFile(draftFile, "utf8"), "const originalScene = true;");

  await submitAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    workspace: options.workspaceRoot, episode: "ep01" });
  assert.equal((await cli(options, "accept", "--segment", "TR002")).kind, "accepted");
  const completed = await readData(paths.storyboard);
  assert.deepEqual(completed.beats.map(({ id, cueRange }) => ({ id, cueRange })),
    accepted.beats.map(({ id, cueRange }) => ({ id, cueRange })));
  assert.equal(completed.templateRuns.find(run => run.id === "TR002").treatment.scene.animation,
    result.treatment.scene.animation);

  const retimed = subtitles.replaceAll("00:00:00,200", "00:00:00,600");
  await deliverRetimedCues({ options, paths, before: subtitles, after: retimed });
  const repair = await readData(directorWork.returnRequest("author"));
  assert.deepEqual(repair.pendingAuthorUnitIds, ["B001", "TR002"]);
  assert.deepEqual(repair.selectedBeatIds, ["B001", "B002"]);
  assert.deepEqual((await readData(paths.storyboard)).templateRuns.find(run => run.id === "TR002"),
    completed.templateRuns.find(run => run.id === "TR002"));

  const redo = await cli(options, "next", "--segment", "TR002");
  const redoFile = path.join(options.workspaceRoot, redo.scratchPath, "scene-source.js");
  await write(redoFile, "const keepDuringRedesign = true;");
  const redoDraft = { taskDigest: redo.taskDigest, result };
  const returnForDirector = async () => {
    await write(work.candidate, { ...redoDraft,
      returnTo: { target: "director", reason: "重作时发现章首观看目标需要导演确认", cueRefs: [2] } });
    assert.equal((await cli(options, "accept", "--segment", "TR002")).kind, "returned");
    assert.deepEqual(await readData(directorWork.returnRequest("author")), repair);
    return cli(options, "next");
  };
  await returnForDirector();
  assert.equal((await cli(options, "next", "--cancel-director-revision")).kind, "revision-cancelled");
  assert.equal((await cli(options, "next", "--segment", "TR002")).taskDigest, redo.taskDigest);
  assert.deepEqual(await readData(work.candidate), redoDraft);

  const directorRedo = await returnForDirector();
  const directorDraft = (await readData(directorWork.workOrder)).inputs.currentVisualPlan;
  directorDraft.beats.find(beat => beat.id === "B002").directorBrief.reveal = "让观众先认出遮挡，再看清作用位置";
  await write(directorWork.candidate, { taskDigest: directorRedo.taskDigest, result: directorDraft });
  await inspect("inspect-authorability");
  await inspect("inspect-boundaries");
  await inspect("lock-boundaries");
  assert.equal((await cli(options, "accept")).kind, "accepted");
  const resumed = await readData(directorWork.returnRequest("author"));
  assert.notEqual(resumed.baselineVisualPlanSha256, repair.baselineVisualPlanSha256);
  assert.equal(resumed.reason, repair.reason);
  assert.deepEqual(resumed.pendingAuthorUnitIds, ["B001", "TR002"]);
  assert.notEqual((await cli(options, "next", "--segment", "TR002")).taskDigest, redo.taskDigest);
  assert.deepEqual((await readData(path.join(work.work, "held-work", redo.taskDigest + ".json"))).candidate, redoDraft);
  assert.equal(await readFile(redoFile, "utf8"), "const keepDuringRedesign = true;");
});

test("合并前的理解返工和同源候选沿当前导演接纳，双请求一并收口", async t => {
  const {options, paths} = await setup(t, ["fullframe-narrative", "vox-explainer"]);
  const work = getStageWorkPaths(paths, "p3");
  const original = await readData(paths.storyboard);
  const current = await cli(options, "status");
  assert.equal(current.nodeId, "author");
  const {parseSrt} = await import("./p3-input.mjs");
  const previousCues = parseSrt(await readFile(paths.narrationSubtitles, "utf8"));
  const legacy = {target: "understand", reason: "旧理解请求核对字幕引用", cueRefs: [],
    cueRebinding: {understanding: original.understanding, previousCues}};
  await write(work.returnRequest("understand"), legacy);
  assert.equal((await cli(options, "status")).nodeId, "director");
  await write(work.returnRequest("director"), {target: "director", reason: "同一次字幕引用修订", cueRefs: [],
    cueRebinding: {previousCues}});
  await cli(options, "next");
  const {taskDigest: _digest, ...oldOrder} = await readData(work.workOrder);
  Object.assign(oldOrder, {taskId: "ep01/understand", moduleId: "understand-episode", nodeId: "understand",
    allowedWrite: oldOrder.allowedWrite + "#understanding"});
  oldOrder.resolvedAssembly.node = {id: "understand", moduleId: "understand-episode"};
  oldOrder.resolvedAssembly.module.id = "understand-episode";
  oldOrder.inputs.returnRequest = legacy;
  oldOrder.scratchPath = path.relative(options.workspaceRoot, path.join(work.work, "attempt-legacy"));
  const scratch = path.join(options.workspaceRoot, oldOrder.scratchPath, "original-note.txt");
  await write(scratch, "原工作材料");
  const signed = {...oldOrder, taskDigest: hashObject(oldOrder)};
  const draft = {taskDigest: signed.taskDigest, result: {understanding: original.understanding}};
  await write(work.workOrder, signed);
  await write(work.candidate, draft);

  const continued = await cli(options, "next");
  assert.equal(continued.taskId, "ep01/director");
  assert.deepEqual(await readData(work.candidate), {taskDigest: continued.taskDigest, result: draft.result});
  const held = await readData(path.join(work.work, "held-work", signed.taskDigest + ".json"));
  assert.deepEqual(held, {workOrder: signed, candidate: draft});
  assert.equal(await readFile(scratch, "utf8"), "原工作材料");
  assert.deepEqual(await readData(work.returnRequest("understand")), legacy);
  assert.equal((await cli(options, "next")).taskDigest, continued.taskDigest);

  const beats = structuredClone(original.beats);
  beats[1].directorBrief.relationFromPrevious = "继续观察同一变化";
  await write(work.candidate, {taskDigest: continued.taskDigest, result: {understanding: draft.result.understanding,
    albumPlan: original.albumPlan, beats, templateRuns: original.templateRuns}});
  await inspectCurrentDirectorCandidate({workOrderPath: work.workOrder, candidatePath: work.candidate});
  for (const name of ["inspect-boundaries", "lock-boundaries"]) await exec(process.execPath,
    [path.join(root, `packages/modules/direct-episode/${name}.mjs`), work.workOrder, work.candidate]);
  assert.equal((await cli(options, "accept")).kind, "accepted");
  for (const target of ["understand", "director"]) await assert.rejects(readFile(work.returnRequest(target)), {code: "ENOENT"});
  assert.equal((await cli(options, "status")).nodeId, "author");
  assert.deepEqual(await readData(path.join(work.work, "held-work", signed.taskDigest + ".json")), held);
});

test("其它CLI渲染期间仍能查询P3和领取原作者工作单", {timeout: 330000}, async t => {
  const {options, paths} = await setup(t, ['fullframe-narrative']);
  const storyboard = await readFile(paths.storyboard, 'utf8');
  await withRenderQueueHeld(async () => {
    assert.equal((await cli(options, 'status')).kind, 'task');
    const claimed = await cli(options, 'next', '--claim', 'fullframe');
    assert.equal(claimed.segmentId, 'TR001');
    const work = getStageWorkPaths(paths, 'p3', 'TR001');
    const original = await readFile(work.workOrder, 'utf8');
    assert.equal((await cli(options, 'next', '--segment', 'TR001')).taskDigest, claimed.taskDigest);
    assert.equal(await readFile(work.workOrder, 'utf8'), original);
    assert.equal(await readFile(paths.storyboard, 'utf8'), storyboard);
  });
});

test("补查来源进入现有作者与预演，追加保留候选，原来源改变仍被识别", async t => {
  const {options, paths} = await setup(t, ["vox-explainer"]);
  await write(paths.sourceAssets, {schemaVersion: "1.0", assets: [{
    id: "SA001", mediaType: "document", path: "sources/original.txt", sha256: "a".repeat(64),
    sourceCitation: "原始依据", creator: null, date: null, rightsStatus: "permission-granted", usageNotes: "原输入"
  }]});
  await write(path.join(paths.input, "sources/original.txt"), "原始依据");
  await runNext({...options, claim: "explainer"});
  const work = getStageWorkPaths(paths, "p3", "TR001");
  const before = await readFile(work.workOrder, "utf8");
  const task = await readData(work.workOrder);
  const result = resultFor(1);
  await write(work.candidate, {taskDigest: task.taskDigest, result});
  const candidateBefore = await readFile(work.candidate, "utf8");
  const file = path.join(options.workspaceRoot, task.scratchPath, "research.md");
  await write(file, "依据原文整理的关系与精度限制。");
  const source = {file, mediaType: "document", sourceCitation: "https://example.org/source#section",
    creator: "样例作者", date: null, rightsStatus: "permission-granted", usageNotes: "只支持相对关系"};
  const asset = await registerP3Source({workOrderPath: work.workOrder, source});
  assert.equal(asset.id, "SA002");
  assert.deepEqual(await registerP3Source({workOrderPath: work.workOrder, source}), asset);
  await runNext({...options, segmentId: "TR001"});
  assert.equal(await readFile(work.workOrder, "utf8"), before);
  assert.equal(await readFile(work.candidate, "utf8"), candidateBefore);
  const {stdout} = await exec(process.execPath, [path.join(root, "packages/p3-task-view.mjs"), work.workOrder]);
  assert.deepEqual(JSON.parse(stdout).inputs.sourceAssets.at(-1), asset);
  result.treatment.moments[0].sourceRefs.push(asset.id);
  await write(work.candidate, {taskDigest: task.taskDigest, result});
  await preflightAuthorCandidate({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await preview({workOrderPath: work.workOrder, candidatePath: work.candidate, validateOnly: true});
  const registry = await readData(paths.sourceAssets);
  registry.assets[0].usageNotes = "改了原输入";
  await write(paths.sourceAssets, registry);
  await assert.rejects(readP3Sources({workspaceRoot: options.workspaceRoot, workOrder: task}), /原来源已改变/);
  registry.assets[0].usageNotes = "原输入";
  await write(paths.sourceAssets, registry);
  await acceptCandidate({...options, segmentId: "TR001"});
  assert.ok((await readData(paths.storyboard)).templateRuns[0].treatment.moments[0].sourceRefs.includes("SA002"));
});

test("导演历史视觉组件经接纳、正文追加、实图请求贯通，原单与其它章节保持", {timeout: 180000}, async t => {
  const {options, paths} = await setup(t, ["fullframe-narrative", "fullframe-narrative", "vox-explainer"]);
  const viewFor = async file => JSON.parse((await exec(process.execPath,
    [path.join(root, "packages/p3-task-view.mjs"), file], {maxBuffer: 8 * 1024 * 1024})).stdout);
  const original = await readData(paths.storyboard);
  const plan = {understanding: original.understanding, albumPlan: original.albumPlan, beats: original.beats, templateRuns: [
    {id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002"]},
    {id: "TR002", templateId: "vox-explainer", beatIds: ["B003"]}
  ]};
  await rm(paths.storyboard);
  await runNext(options);
  const directorWork = getStageWorkPaths(paths, "p3");
  const director = await readData(directorWork.workOrder);
  assert.equal(director.nodeId, "director");
  const semanticDraft = {taskDigest: director.taskDigest, result: {understanding: plan.understanding}};
  await write(directorWork.candidate, semanticDraft);
  await runNext(options);
  assert.deepEqual(await readData(directorWork.candidate), semanticDraft);
  assert.equal(await readFile(directorWork.workOrder, "utf8").then(JSON.parse).then(task => task.taskDigest), director.taskDigest);
  const directorView = await viewFor(directorWork.workOrder);
  assert.equal(directorView.scratchPath, director.scratchPath);
  const sourceFile = path.join(options.workspaceRoot, directorView.scratchPath, "period.md");
  const evidence = "适用范围：测试时期院门。可见特征：门闩为横向木条。依据：离线自制样本。限定：不证明任何历史形制。";
  await write(sourceFile, evidence);
  for (const [index, beat] of plan.beats.entries()) {
    if (beat.templateId === "fullframe-narrative") {
      beat.incomingTransition = index > 0 ? {type: "dissolve", durationMs: 600, reason: "保持同一院门的观察连续"} : null;
    }
    Object.assign(beat.directorBrief, {entryFocus: "看清院门", reveal: "观察木闩的方位", exitHold: "留住院门和木闩的关系"});
    beat.directorBrief.mustShow = "看清当前院门结构";
    beat.directorBrief.relationFromPrevious = index ? "沿前项继续观察结构" : null;
  }
  await write(directorWork.candidate, {taskDigest: director.taskDigest, result: plan});
  const researchPath = path.join(options.workspaceRoot, director.scratchPath, "historical-context/research.json");
  await write(researchPath, {taskDigest: director.taskDigest, title: "离线导演历史视觉交接", materials: [{
    key: "gate", file: sourceFile, mediaType: "document", sourceCitation: "离线交接样本", creator: "test", date: null,
    rightsStatus: "permission-granted", usageNotes: "仅验证依据传递，不证明历史画质"
  }], contexts: [{cueRange: [1,3], period: "测试时期", place: "测试院门", occasion: "观察门闩", people: [],
    environment: [{subject: "院门", features: "门闩为横向木条", evidence: ["gate"], limits: "不推断其它历史形制"}], limits: "独立测试"}]});
  const published = await publishHistoricalContext({workOrderPath: directorWork.workOrder, researchPath});
  const source = published.source, evidenceSource = published.sourceAssets[0];
  plan.understanding.evidence = [{id: "E001", cueRefs: [1], source: "registered-source",
    text: "测试原件说明院门门闩为横向木条", sourceAssetRefs: [evidenceSource.id]}];
  plan.understanding.facts = [{id: "F001", cueRefs: [1], claim: "测试院门带横向木闩", evidenceRefs: ["E001"]}];
  await write(directorWork.candidate, {taskDigest: director.taskDigest, result: plan});
  await bindHistoricalContext({workOrderPath: directorWork.workOrder, sourceId: source.id});
  const bounded = await readData(directorWork.candidate);
  const wrongCut = structuredClone(bounded);
  wrongCut.result.beats[2].incomingTransition = {type: "dissolve", durationMs: 600, reason: "错误的讲解进场要求"};
  await write(directorWork.candidate, wrongCut);
  await assert.rejects(inspectCurrentDirectorCandidate({workOrderPath: directorWork.workOrder,
    candidatePath: directorWork.candidate}), /讲解章不交付 incomingTransition/);
  await write(directorWork.candidate, bounded);
  await inspectCurrentDirectorCandidate({workOrderPath: directorWork.workOrder, candidatePath: directorWork.candidate});
  for (const name of ["inspect-boundaries", "lock-boundaries"]) await exec(process.execPath,
    [path.join(root, `packages/modules/direct-episode/${name}.mjs`), directorWork.workOrder, directorWork.candidate]);
  await acceptCandidate(options);
  const directed = await readData(paths.storyboard);
  assert.equal(directed.understanding._producer.moduleId, "direct-episode");
  assert.ok(directed.understanding._producer.inputs.includes(evidenceSource.sha256));
  await runNext({...options, claim: "fullframe"});
  await runNext({...options, claim: "explainer"});
  const work = getStageWorkPaths(paths, "p3", "TR001"), other = getStageWorkPaths(paths, "p3", "TR002");
  const task = await readData(work.workOrder), otherTask = await readData(other.workOrder);
  const signed = await readFile(work.workOrder), otherSigned = await readFile(other.workOrder);
  assert.deepEqual(otherTask.inputs.authorUnitBeats.map(beat => [beat.id, beat.cueRange, beat.incomingTransition]),
    [["B003", [3, 3], undefined]]);
  assert.equal(otherTask.inputs.authorUnitBeats[0].directorBrief.reveal, "观察木闩的方位");
  assert.match(task.inputs.authorBatch.members[0].inputs.beat.directorBrief.mustShow, /SA001/);
  assert.deepEqual(task.inputs.authorBatch.members[1].inputs.templateContext.directedTransition, plan.beats[1].incomingTransition);
  assert.deepEqual(task.inputs.authorBatch.members[1].inputs.templateContext.cueOptions.frameB, []);
  assert.equal(task.inputs.authorBatch.members[0].inputs.semanticContext.facts[0].id, "F001");
  const visual = await readData(path.join(root, "visuals/meiji-state-machine/visual-package.json"));
  const image = path.join(root, "visuals/meiji-state-machine", visual.masterReference.path);
  const photo = await registerP3Source({workOrderPath: work.workOrder, source: {
    file: image, mediaType: "photo", sourceCitation: "本仓测试参考图", creator: "test", date: null,
    rightsStatus: "permission-granted", usageNotes: "只验证原图传入，不是时代证据"
  }});
  const view = await viewFor(work.workOrder);
  assert.deepEqual(view.inputs.sourceAssets.map(asset => asset.id), [evidenceSource.id, source.id, photo.id]);
  assert.ok(view.inputs.authorBatch.members.every(member => member.inputs.sourceAssets === undefined));
  assert.equal(await readFile(path.join(paths.input, evidenceSource.path), "utf8"), evidence);
  const historical = await readData(path.join(paths.input, source.path));
  assert.equal(historical.contexts[0].environment[0].features, "门闩为横向木条");
  assert.deepEqual(historical.contexts[0].environment[0].evidence, [evidenceSource.id]);
  assert.deepEqual((await viewFor(other.workOrder)).inputs.sourceAssets, view.inputs.sourceAssets);
  const result = {items: [1, 2].map(id => ({beatId: `B00${id}`, treatment: {
    templateId: "fullframe-narrative", incomingTransition: plan.beats[id - 1].incomingTransition,
    continuity: {period: "测试时期", location: "院落", continuesPreviousScene: false, subjects: [], props: ["院门"], carryToNext: {subjects: [], props: []}},
    calloutGate: {"historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered"},
    assetRequests: [{requestId: "AR001", frameId: "A", cameraRelation: id === 1 ? "first" : "reset",
      purpose: "观察院门", sceneDescription: "院落中的木门关闭，门闩为横向木条。",
      sourceRefs: [`C00${id}`, source.id, photo.id], mustNotInvent: ["不推断其它历史形制"], acceptanceCriteria: ["横向门闩可辨"],
      attentionPlan: {entryFocus: "院门", landingFocus: "门闩", viewerChange: "看清结构"},
      motion: {type: "push-in", speedRatio: 1, startViewport: {x: 0, y: 0, width: 1, height: 1}, routeWaypoints: [],
        semanticEndViewport: {x: .15, y: .1, width: 2/3, height: 2/3}}}]
  }, featureResults: {
    "cue-sync": {items: [{target: "AR001", action: "start-frame-motion", cueId: id, edge: "start"}]},
    // This static gate fixture deliberately leaves room for narration without extra sound.
    "sound-effects": {events: []}
  }}))};
  await write(work.candidate, {taskDigest: task.taskDigest, result});
  const pending = await readFile(work.candidate);
  await runNext({...options, segmentId: "TR001"});
  assert.deepEqual(await readFile(work.workOrder), signed);
  assert.deepEqual(await readFile(work.candidate), pending);
  const images = async (...args) => JSON.parse((await exec(process.execPath,
    [path.join(root, "packages/authored-images.mjs"), ...args], {maxBuffer: 8 * 1024 * 1024})).stdout);
  const bad = structuredClone(result);
  bad.items[1].treatment.assetRequests[0].sourceRefs.push("SA999");
  await write(work.candidate, {taskDigest: task.taskDigest, result: bad});
  await assert.rejects(inspectFullframeDesign({workOrderPath: work.workOrder, candidatePath: work.candidate}), /未登记来源/);
  await assert.rejects(images("prepare", work.workOrder, work.candidate), /未登记来源/);
  await write(work.candidate, {taskDigest: task.taskDigest, result});
  await inspectFullframeDesign({workOrderPath: work.workOrder, candidatePath: work.candidate});
  for (const beatId of ["B001", "B002"]) {
    const [started] = await images("begin", work.workOrder, work.candidate, `${beatId}/AR001`);
    assert.match(started.job.prompt, /门闩为横向木条/);
    assert.ok(started.job.referenced_image_paths.includes(path.join(paths.input, photo.path)));
    await images("import", work.workOrder, work.candidate, `${beatId}/AR001`, image);
  }
  await inspectFullframeDesign({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await lockFullframeCallouts({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await preflightAuthorCandidate({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await acceptCandidate({...options, segmentId: "TR001"});
  const accepted = await readData(paths.storyboard);
  for (const beat of accepted.beats.slice(0, 2)) {
    assert.ok(beat.treatment._producer.inputs.includes(photo.sha256));
    assert.match(beat.treatment.assetRequests[0].sceneDescription, /横向木条/);
    assert.deepEqual(accepted.features["sound-effects"].units[beat.id].events, []);
  }
  assert.deepEqual(await readFile(other.workOrder), otherSigned);
  const otherResult = resultFor(3);
  otherResult.treatment.moments[0].sourceRefs.push(source.id, photo.id);
  otherResult.treatment.scene.events = [{id: "E001", target: "M001", offsetSeconds: .75}];
  otherResult.treatment.scene.animation = "timeline.set(select('#state'),{opacity:1},eventTime('E001'));";
  otherResult.featureResults["sound-effects"] = {events: []};
  await write(other.candidate, {taskDigest: otherTask.taskDigest, result: otherResult});
  assert.equal((await preview({workOrderPath: other.workOrder, candidatePath: other.candidate, validateOnly: true})).moments, 1);
  await preflightAuthorCandidate({workOrderPath: other.workOrder, candidatePath: other.candidate});
  await acceptCandidate({...options, segmentId: "TR002"});
  const finalStory = await readData(paths.storyboard);
  assert.deepEqual(finalStory.features["sound-effects"].units.TR002.events, []);
  assert.deepEqual(finalStory.templateRuns.find(run => run.id === "TR002").treatment.scene.events,
    otherResult.treatment.scene.events);
  await runNext({...options, redesignBody: true, redesignBeatIds: ["B001"], revisionReason: "测试单Beat补充依据"});
  const revision = await readData(work.workOrder), revisionSigned = await readFile(work.workOrder);
  assert.equal(revision.inputs.authorBatch, undefined);
  const supplementFile = path.join(options.workspaceRoot, revision.scratchPath, "supplement.md");
  await write(supplementFile, "测试院门的木条门闩未开启；仅为离线交接样本。");
  const supplement = await registerP3Source({workOrderPath: work.workOrder, source: {
    file: supplementFile, mediaType: "document", sourceCitation: "单Beat补查样本", creator: "test", date: null,
    rightsStatus: "permission-granted", usageNotes: "只验证单Beat补查"
  }});
  const single = structuredClone(result.items[0]);
  delete single.beatId;
  single.treatment.assetRequests[0].sourceRefs.push(supplement.id);
  single.treatment.assetRequests[0].sceneDescription += "木条门闩未开启。";
  await write(work.candidate, {taskDigest: revision.taskDigest, result: single});
  assert.equal((await viewFor(work.workOrder)).inputs.sourceAssets.at(-1).id, supplement.id);
  await inspectFullframeDesign({workOrderPath: work.workOrder, candidatePath: work.candidate});
  const [singleJob] = await images("begin", work.workOrder, work.candidate, "B001/AR001");
  assert.match(singleJob.job.prompt, /木条门闩未开启/);
  assert.ok(singleJob.job.prompt.includes(supplement.id));
  await images("import", work.workOrder, work.candidate, "B001/AR001", image);
  await inspectFullframeDesign({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await lockFullframeCallouts({workOrderPath: work.workOrder, candidatePath: work.candidate});
  await preflightAuthorCandidate({workOrderPath: work.workOrder, candidatePath: work.candidate});
  assert.deepEqual(await readFile(work.workOrder), revisionSigned);
  await acceptCandidate({...options, segmentId: "TR001"});
  assert.deepEqual((await readData(paths.storyboard)).beats[1], accepted.beats[1]);
  const denied = {...task, moduleId: "understand-episode"};
  const {taskDigest: _digest, ...deniedBase} = denied;
  denied.taskDigest = hashObject(deniedBase);
  const deniedFile = path.join(options.workspaceRoot, "not-a-body-task.json");
  await write(deniedFile, denied);
  await assert.rejects(registerP3Source({workOrderPath: deniedFile, source: {file: supplementFile}}), /需要当前P3导演或正文作者/);
  const registry = await readData(paths.sourceAssets);
  registry.assets[0].usageNotes = "改写原共用依据";
  await write(paths.sourceAssets, registry);
  await assert.rejects(readP3Sources({workspaceRoot: options.workspaceRoot, workOrder: task}), /原来源已改变/);
});

test("领取锁正常释放的时间差可重试，活动锁和损坏记录仍拒绝", async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p3-claim-lock-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const lock = path.join(workspaceRoot, "claim.lock");
  const owner = { schemaVersion: "1.0", token: "current", pid: process.pid, hostname: os.hostname() };
  let executions = 0;
  const acquire = () => withProjectLock({ root: workspaceRoot, lock, execute: () => ++executions });
  await write(lock, owner);
  await assert.rejects(acquire(), /已有进程执行/);
  const originalRead = fs.readFile;
  let released = false;
  const mockedRead = t.mock.method(fs, "readFile", async (file, ...args) => {
    if (file === lock && !released) {
      released = true;
      await rm(lock);
    }
    return originalRead(file, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(await acquire(), 1);
    assert.equal(released, true);
  } finally {
    mockedRead.mock.restore();
    syncBuiltinESMExports();
  }
  await write(lock, "broken lock");
  await assert.rejects(acquire(), /锁记录无效/);
  assert.equal(await readFile(lock, "utf8"), "broken lock");
  assert.equal(executions, 1);
});

// Independent processes stand in for chapter authors; only the coordinator runs the production CLI.
const authorProcess = t => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { readFile, writeFile, rename } from 'node:fs/promises';
    let active = null;
    process.on('message', async message => {
      try {
        if (message.action === 'assign') {
          if (active) throw new Error('作者仍在处理原段');
          active = message;
        } else if (message.action === 'finish') {
          const task = JSON.parse(await readFile(active.workOrder, 'utf8'));
          const temporary = active.candidate + '.tmp';
          await writeFile(temporary, JSON.stringify({ taskDigest: task.taskDigest, result: active.result }));
          await rename(temporary, active.candidate);
          active = null;
        }
        process.send({ pid: process.pid, segmentId: active?.segmentId ?? null });
      } catch (error) { process.send({ error: error.message }); }
    });
  `], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };
  t.after(stop);
  const send = async message => {
    const reply = once(child, "message", { signal: AbortSignal.timeout(30_000) });
    child.send(message);
    const [value] = await reply;
    assert.equal(value.error, undefined);
    return value;
  };
  send.stop = stop;
  return send;
};

test("讲解B2交回先留候选再补派，收齐后沿原单精修并接纳", { timeout: 180_000 }, async t => {
  const { options, paths } = await setup(t, Array(4).fill("vox-explainer"));
  const requests = await Promise.allSettled(Array.from({ length: 3 }, () => cli(options, "next", "--claim", "explainer")));
  const assigned = [];
  for (const request of requests) {
    if (request.status === "fulfilled") assigned.push(request.value.segmentId);
    else {
      assert.match(request.reason.stderr, /已有进程执行/);
      assigned.push((await cli(options, "next", "--claim", "explainer")).segmentId);
    }
  }
  assert.deepEqual(assigned.sort(), ["TR001", "TR002", "TR003"]);
  const workers = Array.from({ length: 3 }, () => authorProcess(t));
  const assign = (worker, id) => worker({ action: "assign", segmentId: `TR00${id}`,
    ...getStageWorkPaths(paths, "p3", `TR00${id}`), result: resultFor(id) });
  const submit = async work => submitAuthorCandidate({
    workOrderPath: work.workOrder, candidatePath: work.candidate,
    workspace: options.workspaceRoot, episode: options.episodeId
  });
  const active = await Promise.all(workers.map((worker, index) => assign(worker, index + 1)));
  assert.equal(new Set(active.map(value => value.pid)).size, 3);
  assert.deepEqual(active.map(value => value.segmentId), assigned);
  t.diagnostic(`三路同时持有 TR001、TR002、TR003；进程 ${active.map(value => value.pid).join("、")}`);
  const untouched = await Promise.all([1, 2].map(id => readFile(getStageWorkPaths(paths, "p3", `TR00${id}`).workOrder)));
  const before = await readFile(paths.storyboard);
  const work = getStageWorkPaths(paths, "p3", "TR003");
  await workers[2]({ action: "finish" });
  assert.equal((await submit(work)).preflight.ok, true);
  const draft = await readFile(work.candidate);
  const signed = await readFile(work.workOrder);
  await workers[2].stop();
  assert.equal((await cli(options, "next", "--claim", "explainer")).segmentId, "TR004");
  assert.deepEqual(await readFile(work.candidate), draft);
  assert.deepEqual(await Promise.all([1, 2].map(id => readFile(getStageWorkPaths(paths, "p3", `TR00${id}`).workOrder))), untouched);
  workers[2] = authorProcess(t);
  const replacement = await assign(workers[2], 4);
  assert.ok(active.every(value => value.pid !== replacement.pid));
  const continuing = await Promise.all(workers.map(worker => worker({ action: "inspect" })));
  assert.deepEqual(continuing.map(value => value.segmentId), ["TR001", "TR002", "TR004"]);
  assert.deepEqual(continuing.slice(0, 2), active.slice(0, 2));
  t.diagnostic("TR003交回候选后释放名额，TR004由新进程接手，TR001和TR002继续");
  assert.equal((await cli(options, "next", "--claim", "explainer")).kind, "author-queue-empty");
  await Promise.all(workers.map(worker => worker({ action: "finish" })));
  for (const id of [1, 2, 4]) {
    assert.equal((await submit(getStageWorkPaths(paths, "p3", `TR00${id}`))).preflight.ok, true);
  }
  const ready = await cli(options, "status");
  assert.ok(ready.authorSegments.every(segment => segment.state === "in-progress"));
  assert.equal(ready.queue.find(item => item.nodeId === "author").units.completed, 0);
  assert.deepEqual(await readFile(paths.storyboard), before);

  assert.equal((await cli(options, "next", "--segment", "TR003")).segmentId, "TR003");
  assert.deepEqual(await readFile(work.workOrder), signed);
  assert.deepEqual(await readFile(work.candidate), draft);
  const edited = await readData(work.candidate);
  const polishedMarkup = '<div id="state">变化后的状态</div>';
  edited.result.treatment.scene.markup = polishedMarkup;
  await write(work.candidate, edited);
  assert.equal((await submit(work)).preflight.ok, true);
  await preview({workOrderPath: work.workOrder, candidatePath: work.candidate, validateOnly: true});
  assert.deepEqual(await readFile(paths.storyboard), before);

  const remaining = new Map();
  for (const id of [1, 2, 3, 4]) {
    const work = getStageWorkPaths(paths, "p3", `TR00${id}`);
    remaining.set(id, { work, order: await readFile(work.workOrder), candidate: await readFile(work.candidate) });
  }
  for (const id of [1, 2, 3, 4]) {
    assert.equal((await cli(options, "accept", "--segment", `TR00${id}`)).taskId, `ep01/TR00${id}/author`);
    remaining.delete(id);
    for (const { work, order, candidate } of remaining.values()) {
      assert.deepEqual(await readFile(work.workOrder), order);
      assert.deepEqual(await readFile(work.candidate), candidate);
    }
  }
  const story = await readData(paths.storyboard);
  assert.equal(story.templateRuns[2].treatment.scene.markup, polishedMarkup);
  assert.deepEqual(story.templateRuns.map(run => run.treatment.moments[0].sourceRefs), [["C001"], ["C002"], ["C003"], ["C004"]]);
  assert.deepEqual(Object.keys(story.features["cue-sync"].bindings).sort(), ["TR001", "TR002", "TR003", "TR004"]);
  assert.equal((await cli(options, "status")).queue.find(item => item.nodeId === "author").units.completed, 4);
  t.diagnostic("原单精修后通过B2与预演接口，四段接纳齐全，接纳时其余候选保持原值");
});

test("正式accept恢复事务后只返回指定段的结果", { timeout: 180_000 }, async t => {
  for (const selected of ["TR001", "TR002"]) await t.test(selected, async t => {
    const { options, paths } = await setup(t);
    const saved = new Map();
    for (const id of [1, 2, 3]) {
      const segmentId = `TR00${id}`, work = getStageWorkPaths(paths, "p3", segmentId);
      await cli(options, "next", "--segment", segmentId);
      const task = await readData(work.workOrder);
      await write(work.candidate, { taskDigest: task.taskDigest, result: resultFor(id) });
      saved.set(segmentId, { work, order: await readFile(work.workOrder, "utf8"), candidate: await readFile(work.candidate, "utf8") });
    }
    const before = await readData(paths.storyboard);
    const accepted = await cli(options, "accept", "--segment", "TR001");
    const after = await readData(paths.storyboard), first = saved.get("TR001");
    await write(paths.storyboard, before);
    await write(first.work.workOrder, first.order);
    await write(first.work.candidate, first.candidate);
    await write(path.join(first.work.work, "acceptance-commit.yaml"), {
      writes: [{ file: paths.storyboard, value: after, before: hashObject(before) }],
      cleanup: [{ file: first.work.workOrder, before: hashObject(JSON.parse(first.order)) },
        { file: first.work.candidate, before: hashObject(JSON.parse(first.candidate)) }], result: accepted
    });
    assert.equal((await cli(options, "accept", "--segment", selected)).taskId, `ep01/${selected}/author`);
    const story = await readData(paths.storyboard);
    assert.ok(story.templateRuns[0].treatment);
    assert.equal(Boolean(story.templateRuns[1].treatment), selected === "TR002");
    for (const segmentId of selected === "TR001" ? ["TR002", "TR003"] : ["TR003"]) {
      const { work, order, candidate } = saved.get(segmentId);
      assert.equal(await readFile(work.workOrder, "utf8"), order);
      assert.equal(await readFile(work.candidate, "utf8"), candidate);
    }
    assert.equal(await pendingAcceptance(options), null);
  });
});

test("并发领取不会重复分配，先完成者立即补下一段", async t => {
  const { options, paths } = await setup(t, Array(4).fill("vox-explainer"));
  const requests = await Promise.allSettled(Array.from({ length: 3 }, () => runNext({ ...options, claim: "explainer" })));
  const assigned = [];
  for (const request of requests) {
    if (request.status === "fulfilled") assigned.push(request.value);
    else {
      assert.match(request.reason.message, /已有进程执行/);
      assigned.push(await runNext({ ...options, claim: "explainer" }));
    }
  }
  assert.deepEqual(assigned.map(item => item.segmentId).sort(), ["TR001", "TR002", "TR003"]);
  const first = getStageWorkPaths(paths, "p3", "TR001"), second = getStageWorkPaths(paths, "p3", "TR002");
  const active = await Promise.all([readFile(first.workOrder), readFile(second.workOrder)]);
  const work = getStageWorkPaths(paths, "p3", "TR003"), task = await readData(work.workOrder);
  await write(work.candidate, { taskDigest: task.taskDigest, result: resultFor(3) });
  await acceptCandidate({ ...options, segmentId: "TR003" });
  assert.equal((await runNext({ ...options, claim: "explainer" })).segmentId, "TR004");
  assert.deepEqual(await Promise.all([readFile(first.workOrder), readFile(second.workOrder)]), active);
  assert.equal((await runNext({ ...options, claim: "explainer" })).kind, "author-queue-empty");
});

test("正文作者可分类型领取两种模板，空队列保留其它类型待办", async t => {
  const { options, paths } = await setup(t, ["fullframe-narrative", "fullframe-narrative",
    "vox-explainer", "vox-explainer", "fullframe-narrative"]);
  const assigned = [];
  for (const claim of ["fullframe", "fullframe", "explainer", "explainer"])
    assigned.push((await runNext({ ...options, claim })).segmentId);
  assert.deepEqual(assigned, ["TR001", "TR002", "TR003", "TR004"]);
  assert.equal((await runNext({ ...options, claim: "explainer" })).kind, "author-queue-empty");
  const status = await deriveStatus(options);
  assert.equal(status.authorSegments.find(segment => segment.id === "TR005").state, "pending");
  assert.equal((await runNext({ ...options, claim: "fullframe" })).segmentId, "TR005");
  assert.equal((await runNext({ ...options, claim: "fullframe" })).kind, "author-queue-empty");
  const work = getStageWorkPaths(paths, "p3", "TR003"), task = await readData(work.workOrder);
  await write(work.candidate, {taskDigest: task.taskDigest, result: resultFor(3)});
  const before = await readFile(work.candidate);
  assert.equal((await runNext({...options, segmentId: "TR003"})).segmentId, "TR003");
  assert.deepEqual(await readFile(work.candidate), before);
  await submitAuthorCandidate({workOrderPath: work.workOrder, candidatePath: work.candidate,
    workspace: options.workspaceRoot, episode: "ep01"});
  await acceptCandidate({...options, segmentId: "TR003"});
  assert.ok((await readData(paths.storyboard)).templateRuns.find(run => run.id === "TR003").treatment);
  await assert.rejects(runNext({ ...options, claim: "fullframe", segmentId: "TR001" }), /不同时指定段/);
});

test("三段独立签发，子代理只交候选，主代理乱序接纳不丢成果", async t => {
  const { options, paths } = await setup(t);
  const saved = new Map();
  for (const id of [1, 2, 3]) {
    const segmentId = `TR00${id}`, work = getStageWorkPaths(paths, "p3", segmentId);
    const next = await runNext({ ...options, segmentId });
    assert.equal(path.resolve(options.workspaceRoot, next.workOrderPath), work.workOrder);
    const task = await readData(work.workOrder);
    assert.equal(task.inputs.authorUnit.id, segmentId);
    assert.equal(task.inputs.previousTreatment, null);
    await write(work.candidate, { taskDigest: task.taskDigest, result: resultFor(id) });
    saved.set(segmentId, { work, order: await readFile(work.workOrder), candidate: await readFile(work.candidate) });
  }
  const before = await readFile(paths.storyboard);
  const work = saved.get("TR003").work;
  const handoff = await submitAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    workspace: options.workspaceRoot, episode: "ep01" });
  assert.equal(handoff.preflight.ok, true);
  assert.equal(handoff.acceptance, undefined);
  assert.equal(handoff.next, undefined);
  assert.deepEqual(await readFile(paths.storyboard), before);
  for (const segmentId of ["TR003", "TR001", "TR002"]) {
    assert.equal((await acceptCandidate({ ...options, segmentId })).kind, "accepted");
    saved.delete(segmentId);
    for (const { work: other, order, candidate } of saved.values()) {
      assert.deepEqual(await readFile(other.workOrder), order);
      assert.deepEqual(await readFile(other.candidate), candidate);
    }
    const status = await deriveStatus(options);
    assert.equal(status.queue.find(item => item.nodeId === "author").units.completed, 3 - saved.size);
  }
  const story = await readData(paths.storyboard);
  assert.ok(story.templateRuns.every(run => run.treatment?.templateId === "vox-explainer"));
  assert.deepEqual(Object.keys(story.features["cue-sync"].bindings).sort(), ["TR001", "TR002", "TR003"]);
});

test("接纳恢复找到分段事务并保留其它段候选", async t => {
  const { options, paths } = await setup(t);
  const work = getStageWorkPaths(paths, "p3", "TR002"), other = getStageWorkPaths(paths, "p3", "TR001");
  const original = await readData(paths.storyboard), updated = { ...original, testRecovery: true };
  await write(other.candidate, { untouched: true });
  await write(path.join(work.work, "acceptance-commit.yaml"), {
    writes: [{ file: paths.storyboard, value: updated, before: hashObject(original) }], cleanup: [],
    result: { kind: "accepted", taskId: "ep01/TR002/author" } });
  assert.ok(await pendingAcceptance(options));
  assert.equal((await recoverAcceptance(options)).taskId, "ep01/TR002/author");
  assert.deepEqual(await readData(paths.storyboard), updated);
  assert.deepEqual(await readData(other.candidate), { untouched: true });
  assert.equal(await pendingAcceptance(options), null);
});

test("后段全画幅不等前段，先前段交付不改变已签工作单与段内参考", async t => {
  const { options, paths } = await setup(t);
  const story = await readData(paths.storyboard);
  for (const beat of story.beats) beat.templateId = "fullframe-narrative";
  for (const run of story.templateRuns) run.templateId = "fullframe-narrative";
  await write(paths.storyboard, story);
  await runNext({ ...options, segmentId: "TR003" });
  const work = getStageWorkPaths(paths, "p3", "TR003"), before = await readFile(work.workOrder);
  const task = await readData(work.workOrder);
  assert.equal(task.inputs.previousTreatment, null);
  assert.equal(task.inputs.previousCameraStateSha256, undefined);
  assert.deepEqual(task.inputs.templateContext.priorVisuals, []);
  assert.deepEqual(task.inputs.templateContext.priorCallouts, []);
  assert.equal(task.inputs.templateContext.segmentStart, true);
  assert.equal(task.inputs.templateContext.episodeContext.cues.length, 3);
  assert.equal(task.inputs.templateContext.incomingTransitionSupported, true, "段首独立起镜仍保留相邻转场");
  story.beats[1].treatment = { templateId: "fullframe-narrative", assetRequests: [{
    requestId: "AR001", callouts: [{ kind: "term-gloss", term: "前段概念" }] }] };
  story.features["cue-sync"].bindings.B002 = { items: [] };
  await write(paths.storyboard, story);
  await runNext({ ...options, segmentId: "TR003" });
  assert.deepEqual(await readFile(work.workOrder), before);
  const current = await readData(work.workOrder);
  assert.deepEqual(current.inputs.templateContext.priorVisuals, []);
  assert.deepEqual(current.inputs.templateContext.priorCallouts, []);
});

test("并行返工乱序接纳，不使其它段的原候选过期", async t => {
  const { options, paths } = await setup(t);
  const story = await readData(paths.storyboard);
  for (const [index, run] of story.templateRuns.entries()) {
    const result = resultFor(index + 1);
    run.treatment = result.treatment;
    story.features["cue-sync"].bindings[run.id] = result.featureResults["cue-sync"];
  }
  await write(paths.storyboard, story);
  await runNext({ ...options, redesignBody: true, revisionReason: "各段明确比较结果" });
  for (const id of [1, 2, 3]) {
    await runNext({ ...options, segmentId: `TR00${id}` });
    const work = getStageWorkPaths(paths, "p3", `TR00${id}`), task = await readData(work.workOrder);
    const result = resultFor(id);
    result.treatment.objective = `确认第${id}段的比较结果`;
    await write(work.candidate, { taskDigest: task.taskDigest, result });
  }
  for (const id of [3, 1, 2]) assert.equal((await acceptCandidate({ ...options, segmentId: `TR00${id}` })).kind, "accepted");
  const completed = await readData(paths.storyboard);
  assert.deepEqual(completed.templateRuns.map(run => run.treatment.objective),
    [1, 2, 3].map(id => `确认第${id}段的比较结果`));
});

test("自动承接说明误换单后，空候选原入口恢复业务相同的暂存成果", async t => {
  const { options, paths } = await setup(t);
  const story = await readData(paths.storyboard);
  for (const [index, run] of story.templateRuns.entries()) {
    const result = resultFor(index + 1);
    run.treatment = result.treatment;
    story.features["cue-sync"].bindings[run.id] = result.featureResults["cue-sync"];
  }
  await write(paths.storyboard, story);
  await runNext({ ...options, redesignBody: true, revisionReason: "保留原图，只修指定文字" });
  await runNext({ ...options, segmentId: "TR003" });
  const work = getStageWorkPaths(paths, "p3", "TR003"), original = await readData(work.workOrder);
  const candidate = { taskDigest: original.taskDigest, result: resultFor(3) };
  const marker = path.join(options.workspaceRoot, original.scratchPath, "retained-step.json");
  await write(marker, { original: true });
  const requestPath = work.returnRequest("author"), request = await readData(requestPath);
  await write(requestPath, { ...request, reason: "前一单元 TR001 的实际承接末态改变，修订 TR002 的承接部分" });
  // Reproduce an already-issued empty replacement while retaining the original signed work.
  await rm(work.workOrder);
  const replacement = await runNext({ ...options, segmentId: "TR003" });
  assert.notEqual(replacement.taskDigest, original.taskDigest);
  await write(path.join(work.work, "held-work", `${original.taskDigest}.json`), { workOrder: original, candidate });
  const restored = await runNext({ ...options, segmentId: "TR003" });
  assert.equal(restored.taskDigest, original.taskDigest);
  assert.deepEqual(await readData(work.workOrder), original);
  assert.deepEqual(await readData(work.candidate), candidate);
  assert.deepEqual(await readData(marker), { original: true });
  await acceptCandidate({ ...options, segmentId: "TR003" });
  assert.equal((await readData(requestPath)).reason, request.reason);
});

test("局部返工在进行时，其它段仍可交回原候选", async t => {
  const { options, paths } = await setup(t);
  await runNext({ ...options, segmentId: "TR002" });
  const work = getStageWorkPaths(paths, "p3", "TR002"), task = await readData(work.workOrder);
  await write(work.candidate, { taskDigest: task.taskDigest, result: resultFor(2) });
  await runNext({ ...options, redesignBody: true, redesignBeatIds: ["B001"], revisionReason: "只调整第一段" });
  const request = await readFile(work.returnRequest("author"));
  assert.equal((await acceptCandidate({ ...options, segmentId: "TR002" })).kind, "accepted");
  assert.deepEqual(await readFile(work.returnRequest("author")), request);
  assert.ok((await readData(paths.storyboard)).templateRuns[1].treatment);
});

test("未知图片调用留在原段，其它段可换单，整阶段重置仍保留未知现场", async t => {
  const { options, paths } = await setup(t);
  for (const segmentId of ["TR001", "TR002"]) await runNext({ ...options, segmentId });
  const first = getStageWorkPaths(paths, "p3", "TR001"), second = getStageWorkPaths(paths, "p3", "TR002");
  const firstTask = await readData(first.workOrder), secondTask = await readData(second.workOrder);
  const record = path.join(options.workspaceRoot, firstTask.scratchPath, "images", "TR001", "AR001", "tool-call.json");
  await write(record, { state: "calling", task: "original-image-call" });
  const firstOrder = await readFile(first.workOrder);
  const candidate = { taskDigest: secondTask.taskDigest, result: {} };
  await write(second.candidate, candidate);
  const story = await readData(paths.storyboard);
  story.beats[1].directorBrief.mustShow = "本段修改后的比较对象";
  await write(paths.storyboard, story);
  await runNext({ ...options, segmentId: "TR002" });
  const held = await readData(path.join(second.work, "held-work", `${secondTask.taskDigest}.json`));
  assert.deepEqual(held.candidate, candidate);
  assert.deepEqual(await readFile(first.workOrder), firstOrder);
  await assert.rejects(resetStage(options), /先恢复原远端任务/);
  assert.equal((await readData(record)).state, "calling");
  assert.deepEqual(await readFile(first.workOrder), firstOrder);
});

const expandingFullframeDraft = async t => {
  const {options, paths} = await setup(t,
    ["fullframe-narrative", "fullframe-narrative", "fullframe-narrative", "vox-explainer"]);
  await write(paths.sourceAssets, {schemaVersion: "1.0", assets: [{
    id: "SA001", mediaType: "document", path: "sources/original.txt", sha256: sha256("原始依据"),
    sourceCitation: "原始依据", creator: null, date: null, rightsStatus: "permission-granted", usageNotes: "原输入"
  }]});
  await write(path.join(paths.input, "sources/original.txt"), "原始依据");
  const story = await readData(paths.storyboard);
  story.templateRuns = [
    {id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002"]},
    {id: "TR003", templateId: "fullframe-narrative", beatIds: ["B003"]},
    {id: "TR004", templateId: "vox-explainer", beatIds: ["B004"]}
  ];
  story.beats[0].directorBrief.mustShow += "\n【历史视觉依据 SA001】本镜原有的读取提示。";
  await write(paths.storyboard, story);
  await runNext({...options, segmentId: "TR001"});
  const work = getStageWorkPaths(paths, "p3", "TR001"), order = await readData(work.workOrder);
  const image = path.join(paths.p3, "assets", "B001", "retained.png");
  const bytes = Buffer.from("existing image bytes: do not regenerate");
  await mkdir(path.dirname(image), {recursive: true});
  await writeFile(image, bytes);
  const candidate = {taskDigest: order.taskDigest, result: {items: ["B001", "B002"].map(beatId => ({
    beatId, treatment: {templateId: "fullframe-narrative", assetRequests: [{requestId: "AR001",
      sceneDescription: "本章已形成的画面草稿", ...(beatId === "B001" ? {asset: {
        provider: "image-gen", file: path.relative(options.workspaceRoot, image), sha256: sha256(bytes)
      }} : {})}]}
  }))}};
  assert.equal(fullframeBatchItems({workOrder: order, candidate}).length, 2);
  await write(work.candidate, candidate);
  story.templateRuns[0].beatIds.push("B003");
  story.templateRuns.splice(1, 1);
  // Same component hint, now carried by a larger research document.
  story.beats[0].directorBrief.mustShow = story.beats[0].directorBrief.mustShow.replace("SA001】", "SA008】");
  await write(paths.storyboard, story);
  return {options, paths, work, order, candidate, image, bytes, story};
};

test("同章扩章原入口续接草稿和实图，新增成员仍须作者完整交付", async t => {
  const {options, paths, work, order, candidate, image, bytes} = await expandingFullframeDraft(t);
  const next = await runNext({...options, segmentId: "TR001"});
  assert.notEqual(next.taskDigest, order.taskDigest);
  const current = await readData(work.workOrder), continued = await readData(work.candidate);
  assert.deepEqual(current.inputs.authorBatch.members.map(member => member.beatId), ["B001", "B002", "B003"]);
  assert.equal(continued.taskDigest, current.taskDigest);
  assert.deepEqual(continued.result, candidate.result);
  assert.deepEqual(await readFile(image), bytes);
  assert.throws(() => fullframeBatchItems({workOrder: current, candidate: continued}), /完整交付/);
  const before = await readFile(work.candidate);
  await runNext({...options, segmentId: "TR001"});
  assert.deepEqual(await readFile(work.candidate), before);
  assert.ok((await readData(paths.storyboard)).beats.every(beat => !beat.treatment));
  await assert.rejects(readFile(path.join(work.work, "held-work", `${order.taskDigest}.json`)), {code: "ENOENT"});
});

test("扩章续接不恢复已改变观看职责的草稿或其它阶段停放工作", async t => {
  await t.test("原成员观看职责已变化", async t => {
    const {options, paths, work, order, candidate, story} = await expandingFullframeDraft(t);
    story.beats[0].directorBrief.mustShow = "必须看见另一个实际对象";
    await write(paths.storyboard, story);
    await runNext({...options, segmentId: "TR001"});
    await assert.rejects(readFile(work.candidate), {code: "ENOENT"});
    assert.deepEqual((await readData(path.join(work.work, "held-work", `${order.taskDigest}.json`))).candidate, candidate);
  });
  await t.test("其它阶段停放工作", async t => {
    const {options, work, order, candidate} = await expandingFullframeDraft(t);
    const {taskDigest: _digest, ...base} = order;
    base.stageId = "p4";
    const different = {...base, taskDigest: hashObject(base)};
    await write(path.join(work.work, "held-work", `${different.taskDigest}.json`), {
      workOrder: different, candidate: {...candidate, taskDigest: different.taskDigest}
    });
    await rm(work.workOrder);
    await rm(work.candidate);
    await runNext({...options, segmentId: "TR001"});
    await assert.rejects(readFile(work.candidate), {code: "ENOENT"});
  });
  await t.test("原来源已变化", async t => {
    const {options, paths, work, order, candidate} = await expandingFullframeDraft(t);
    const sources = await readData(paths.sourceAssets);
    sources.assets[0].usageNotes = "原依据用途已变化";
    await write(paths.sourceAssets, sources);
    await runNext({...options, segmentId: "TR001"});
    await assert.rejects(readFile(work.candidate), {code: "ENOENT"});
    assert.deepEqual((await readData(path.join(work.work, "held-work", `${order.taskDigest}.json`))).candidate, candidate);
  });
});

test("扩章续接遇到原未知图片调用仍停在原对象", async t => {
  const {options, work, order, candidate} = await expandingFullframeDraft(t);
  await write(path.join(work.work, "held-work", `${order.taskDigest}.json`), {workOrder: order, candidate});
  await rm(work.workOrder);
  await rm(work.candidate);
  const record = path.join(options.workspaceRoot, order.scratchPath, "images", "B001", "AR001", "tool-call.json");
  await write(record, {state: "calling", task: "original-image-call"});
  await assert.rejects(runNext({...options, segmentId: "TR001"}), /先恢复原远端任务/);
  assert.equal((await readData(record)).state, "calling");
  assert.deepEqual((await readData(path.join(work.work, "held-work", `${order.taskDigest}.json`))).candidate, candidate);
  await assert.rejects(readFile(work.candidate), {code: "ENOENT"});
});
