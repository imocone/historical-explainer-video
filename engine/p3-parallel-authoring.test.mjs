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
  const plan = {albumPlan: original.albumPlan, beats: original.beats, templateRuns: [
    {id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002"]},
    {id: "TR002", templateId: "vox-explainer", beatIds: ["B003"]}
  ]};
  await write(paths.storyboard, {understanding: original.understanding});
  await runNext(options);
  const directorWork = getStageWorkPaths(paths, "p3");
  const director = await readData(directorWork.workOrder);
  const directorView = await viewFor(directorWork.workOrder);
  assert.equal(directorView.scratchPath, director.scratchPath);
  const sourceFile = path.join(options.workspaceRoot, directorView.scratchPath, "period.md");
  const evidence = "适用范围：测试时期院门。可见特征：门闩为横向木条。依据：离线自制样本。限定：不证明任何历史形制。";
  await write(sourceFile, evidence);
  for (const [index, beat] of plan.beats.entries()) {
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
  await bindHistoricalContext({workOrderPath: directorWork.workOrder, sourceId: source.id});
  await inspectCurrentDirectorCandidate({workOrderPath: directorWork.workOrder, candidatePath: directorWork.candidate});
  for (const name of ["inspect-boundaries", "lock-boundaries"]) await exec(process.execPath,
    [path.join(root, `packages/modules/direct-episode/${name}.mjs`), directorWork.workOrder, directorWork.candidate]);
  await acceptCandidate(options);
  await runNext({...options, claim: "fullframe"});
  await runNext({...options, claim: "explainer"});
  const work = getStageWorkPaths(paths, "p3", "TR001"), other = getStageWorkPaths(paths, "p3", "TR002");
  const task = await readData(work.workOrder), otherTask = await readData(other.workOrder);
  const signed = await readFile(work.workOrder), otherSigned = await readFile(other.workOrder);
  assert.match(task.inputs.authorBatch.members[0].inputs.beat.directorBrief.mustShow, /SA001/);
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
    templateId: "fullframe-narrative", incomingTransition: id === 1 ? null : {type: "dissolve", durationMs: 600, reason: "换观察位置"},
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
  otherResult.featureResults["sound-effects"] = {events: []};
  await write(other.candidate, {taskDigest: otherTask.taskDigest, result: otherResult});
  await preflightAuthorCandidate({workOrderPath: other.workOrder, candidatePath: other.candidate});
  await acceptCandidate({...options, segmentId: "TR002"});
  assert.deepEqual((await readData(paths.storyboard)).features["sound-effects"].units.TR002.events, []);
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

test("正式命令驱动最多三路进程，每章换新作者且各段互不覆盖", { timeout: 180_000 }, async t => {
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
  const active = await Promise.all(workers.map((worker, index) => assign(worker, index + 1)));
  assert.equal(new Set(active.map(value => value.pid)).size, 3);
  assert.deepEqual(active.map(value => value.segmentId), assigned);
  t.diagnostic(`三路同时持有 TR001、TR002、TR003；进程 ${active.map(value => value.pid).join("、")}`);
  const untouched = await Promise.all([1, 2].map(id => readFile(getStageWorkPaths(paths, "p3", `TR00${id}`).workOrder)));
  await workers[2]({ action: "finish" });
  assert.equal((await cli(options, "accept", "--segment", "TR003")).taskId, "ep01/TR003/author");
  assert.deepEqual(await Promise.all([1, 2].map(id => readFile(getStageWorkPaths(paths, "p3", `TR00${id}`).workOrder))), untouched);
  await workers[2].stop();
  assert.equal((await cli(options, "next", "--claim", "explainer")).segmentId, "TR004");
  workers[2] = authorProcess(t);
  const replacement = await assign(workers[2], 4);
  assert.ok(active.every(value => value.pid !== replacement.pid));
  const continuing = await Promise.all(workers.map(worker => worker({ action: "inspect" })));
  assert.deepEqual(continuing.map(value => value.segmentId), ["TR001", "TR002", "TR004"]);
  assert.deepEqual(continuing.slice(0, 2), active.slice(0, 2));
  t.diagnostic("TR003先完成并接纳，结束其进程后为TR004新建进程；另两路原进程仍在处理TR001、TR002");
  assert.equal((await cli(options, "next", "--claim", "explainer")).kind, "author-queue-empty");
  await Promise.all(workers.map(worker => worker({ action: "finish" })));
  const remaining = new Map();
  for (const id of [1, 2, 4]) {
    const work = getStageWorkPaths(paths, "p3", `TR00${id}`);
    remaining.set(id, { work, order: await readFile(work.workOrder), candidate: await readFile(work.candidate) });
  }
  for (const id of [4, 2, 1]) {
    assert.equal((await cli(options, "accept", "--segment", `TR00${id}`)).taskId, `ep01/TR00${id}/author`);
    remaining.delete(id);
    for (const { work, order, candidate } of remaining.values()) {
      assert.deepEqual(await readFile(work.workOrder), order);
      assert.deepEqual(await readFile(work.candidate), candidate);
    }
  }
  const story = await readData(paths.storyboard);
  assert.deepEqual(story.templateRuns.map(run => run.treatment.moments[0].sourceRefs), [["C001"], ["C002"], ["C003"], ["C004"]]);
  assert.deepEqual(Object.keys(story.features["cue-sync"].bindings).sort(), ["TR001", "TR002", "TR003", "TR004"]);
  assert.equal((await cli(options, "status")).queue.find(item => item.nodeId === "author").units.completed, 4);
  t.diagnostic("接纳顺序TR003→TR004→TR002→TR001；四段成果齐全，其余工作单及候选逐字节未变");
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
