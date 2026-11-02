import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { acceptCandidate, deriveStatus, resetStage, runNext } from "./runtime.mjs";
import { resolveStageCurrent } from "./runtime/status.mjs";
import { hashObject, readData, sha256 } from "../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { pendingAcceptance, recoverAcceptance } from "./runtime/acceptance-commit.mjs";
import { readVideoOpenerInput, assertVideoOpenerInput } from "../packages/p4-opener-reference.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const exec = promisify(execFile);
const write = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
};
const acceptedOpener = value => ({ ...value, _producer: { moduleId: "author-bookend", nodeId: "opener",
  taskDigest: "a".repeat(64), inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(value) } });
const setup = async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p4-parallel-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const options = { root, workspaceRoot, episodeId: "ep01", targetId: "release-main", stageId: "p4" };
  const paths = getEpisodePaths(workspaceRoot, "ep01");
  await write(paths.videoSettings,{enabled:true});
  const visual = await readData(path.join(root, "visuals/meiji-state-machine/visual-package.json"));
  const opener = (await readData(path.join(root, "packages/templates/episode-opener/examples/golden.json"))).result;
  await write(path.join(workspaceRoot, "program.yaml"), {
    openerTemplate: "episode-opener", visualPackage: { visualPackageId: visual.id, version: visual.version }
  });
  const text = "来客在门外等候。", srt = `1\n00:00:00,000 --> 00:00:06,000\n${text}\n`;
  await write(paths.narrationText, text); await write(paths.narrationSubtitles, srt);
  await write(paths.narrationPackage, { episodeId: "ep01", durationMs: 6000, files: {
    narration: { path: "narration.txt", sha256: sha256(text) },
    subtitles: { path: "narration.srt", sha256: sha256(srt) }
  } });
  await write(paths.sourceAssets, { assets: [] });
  await write(paths.openerNarration, { openerNarration: opener.flashbackLine });
  await write(paths.storyboard, { episodeId: "ep01", understanding: {}, albumPlan: {},
    beats: [{ id: "B001", cueRange: [1, 1], templateId: "fullframe-narrative",
      treatment: { templateId: "fullframe-narrative", assetRequests: [] } }],
    templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001"], treatment: null }], features: {} });
  return { options, paths, opener };
};

test("片头与video同时持单，正式输入完整，交接片头不重签video或覆盖候选", async t => {
  const { options, paths, opener } = await setup(t);
  const cli = async nodeId => JSON.parse((await exec(process.execPath, [path.join(root, "engine/cli.mjs"), "next",
    "--workspace", options.workspaceRoot, "--episode", "ep01", "--stage", "p4", "--node", nodeId])).stdout);
  const intro = await cli("opener"), video = await cli("video");
  assert.notEqual(intro.candidatePath, video.candidatePath);
  const introWork = getStageWorkPaths(paths, "p4", null, "opener");
  const videoWork = getStageWorkPaths(paths, "p4", null, "video");
  const introOrder = await readData(introWork.workOrder), videoOrder = await readData(videoWork.workOrder);
  assert.equal(introOrder.nodeId, "opener"); assert.equal(videoOrder.nodeId, "video");
  assert.equal(introOrder.inputs.narration, "来客在门外等候。");
  assert.equal(introOrder.inputs.openerNarration, opener.flashbackLine);
  assert.equal(introOrder.inputs.directionContext.firstBeat.id, "B001");
  assert.equal(videoOrder.inputs.narration, "来客在门外等候。");
  assert.equal(videoOrder.inputs.cues.length, 1);
  assert.deepEqual(videoOrder.inputs.storyboard.content, await readData(paths.storyboard));
  assert.equal(videoOrder.inputs.visual.id, "meiji-state-machine");
  assert.equal(videoOrder.inputs.openerReference.source, "ep01/制作/p4/episode-package.yaml#opener");
  assert.ok(videoOrder.resolvedRules.some(x => x.source.endsWith("cinematic-video/AUTHOR.md")));
  for (const order of [introOrder, videoOrder]) {
    assert.ok(order.outputContract.content);
    assert.ok(order.resolvedAssembly.slots.flatMap(s => s.implementations)
      .some(i => i.resources.some(r => r.role === "examples")));
  }
  const early = await deriveStatus({ ...options, nodeId: "video" });
  assert.equal(early.queue.find(x => x.nodeId === "opener").state, "current");
  assert.equal(early.queue.find(x => x.nodeId === "video").state, "current");
  assert.equal(early.queue.find(x => x.nodeId === "video-assets").state, "blocked");
  const candidate = { taskDigest: videoOrder.taskDigest, result: {
    episodeId: "ep01", templateId: "cinematic-video", selectionReason: "此段没有必须动态表现的重要场面", spans: [], incomingTransitions: {}
  } };
  await write(videoWork.candidate, candidate);
  const before = await readFile(videoWork.workOrder, "utf8");
  await assert.rejects(acceptCandidate({ ...options, nodeId: "video" }), /先接纳片头/);
  assert.equal((await runNext({ ...options, nodeId: "video-assets" })).kind, "blocked-upstream");
  const contextBefore = await resolveStageCurrent({ ...options, nodeId: "video" });
  const firstSpan = { spans: [{ beatIds: ["B001"] }] };
  const digestBefore = contextBefore.producerDigestForResult(firstSpan);
  // 已接纳片头的离线fixture；不调用图像/TTS服务、不把此fixture冒充作品验证。
  await write(paths.episodePackage, { opener });
  const resumed = await runNext({ ...options, nodeId: "video" });
  assert.equal(resumed.taskDigest, video.taskDigest);
  assert.equal(await readFile(videoWork.workOrder, "utf8"), before);
  assert.deepEqual(await readData(videoWork.candidate), candidate);
  const contextAfter = await resolveStageCurrent({ ...options, nodeId: "video" });
  assert.deepEqual(contextAfter.context.storyboard.opener, opener);
  assert.notEqual(contextAfter.producerDigestForResult(firstSpan), digestBefore);
  const introBytes = await readFile(introWork.workOrder, "utf8");
  assert.equal((await acceptCandidate({ ...options, nodeId: "video" })).kind, "accepted");
  assert.equal(await readFile(introWork.workOrder, "utf8"), introBytes);
  const status = await deriveStatus(options);
  assert.equal(status.queue.find(x => x.nodeId === "video").state, "completed");
  assert.notEqual(status.kind, "stage-complete");
  await runNext({ ...options, nodeId: "video-assets" });
  assert.equal((await deriveStatus({...options,nodeId:"video-assets"})).kind,"node-complete");
  assert.notEqual((await deriveStatus(options)).kind,"stage-complete");
  assert.deepEqual((await readData(paths.videoManifest)).clips, []);
});

test("P4换单先检查工作目录外的原视频，原单恢复不被阻断", async t => {
  const { options, paths } = await setup(t);
  await runNext({ ...options, nodeId: "video" });
  const work = getStageWorkPaths(paths, "p4", null, "video");
  const original = await readData(work.workOrder);
  const candidate = { taskDigest: original.taskDigest, result: {
    episodeId: "ep01", templateId: "cinematic-video", selectionReason: "保留当前设计", spans: [], incomingTransitions: {}
  } };
  await write(work.candidate, candidate);
  const receiptPath = path.join(paths.p4, "video", "V001", "part-1", "original", "generation.json");
  const receipt = { state: "pending", requestDigest: "original", submitId: "original-remote" };
  await write(receiptPath, receipt);
  assert.equal((await runNext({ ...options, nodeId: "video" })).taskDigest, original.taskDigest);
  const story = await readData(paths.storyboard);
  story.understanding = { revised: true };
  await write(paths.storyboard, story);
  await assert.rejects(runNext({ ...options, nodeId: "video" }), /先恢复原远端任务/);
  assert.deepEqual(await readData(work.workOrder), original);
  assert.deepEqual(await readData(work.candidate), candidate);
  assert.deepEqual(await readData(receiptPath), receipt);
  await write(receiptPath, { ...receipt, state: "complete" });
  const next = await runNext({ ...options, nodeId: "video" });
  assert.notEqual(next.taskDigest, original.taskDigest);
  assert.deepEqual(await readData(path.join(work.work, "held-work", `${original.taskDigest}.json`)),
    { workOrder: original, candidate });
});

test("节点接纳恢复不清理另一作者，reset覆盖节点且保留正式成果", async t => {
  const { options, paths } = await setup(t);
  await runNext({ ...options, nodeId: "opener" });
  await runNext({ ...options, nodeId: "video" });
  const intro = getStageWorkPaths(paths, "p4", null, "opener"), video = getStageWorkPaths(paths, "p4", null, "video");
  await write(intro.candidate, { taskDigest: (await readData(intro.workOrder)).taskDigest, result: {} });
  await write(video.candidate, { taskDigest: (await readData(video.workOrder)).taskDigest, result: {} });
  const other = await readFile(intro.candidate, "utf8");
  const original = await readData(paths.storyboard), updated = { ...original, fixtureRecovery: true };
  await write(path.join(video.work, "acceptance-commit.yaml"), {
    writes: [{ file: paths.storyboard, value: updated, before: hashObject(original) }], cleanup: [],
    result: { kind: "accepted", taskId: "ep01/video" }
  });
  assert.ok(await pendingAcceptance(options));
  await assert.rejects(resetStage(options), /仍有执行或接纳待恢复/);
  assert.equal((await recoverAcceptance({ ...options, nodeId: "video" })).taskId, "ep01/video");
  assert.equal(await readFile(intro.candidate, "utf8"), other);
  assert.equal(await pendingAcceptance(options), null);
  const reset = await resetStage(options);
  assert.equal(reset.kind, "stage-reset");
  for (const work of [intro, video]) {
    await assert.rejects(readFile(work.workOrder), { code: "ENOENT" });
    await assert.rejects(readFile(work.candidate), { code: "ENOENT" });
    assert.ok(await readData(path.join(work.work, "restarts", reset.restartId, "work-order.yaml")));
  }
  assert.deepEqual(await readData(paths.storyboard), updated);
});

test("首幕片头读取绑定实际版本，变化或返工不吞掉原候选", async t => {
  const { options, paths, opener } = await setup(t);
  await runNext({ ...options, nodeId: "video" });
  const work = getStageWorkPaths(paths, "p4", null, "video");
  const order = await readData(work.workOrder);
  const result = { spans: [{ id: "V001", beatIds: ["B001"] }] };
  await write(work.candidate, { taskDigest: order.taskDigest, result });
  const candidate = await readFile(work.candidate, "utf8"), originalOrder = await readFile(work.workOrder, "utf8");
  await assert.rejects(readVideoOpenerInput({ workOrderPath: work.workOrder }), { code: "ENOENT" });
  await write(paths.episodePackage, { opener: acceptedOpener(opener) });
  await assert.rejects(assertVideoOpenerInput({ workspaceRoot: options.workspaceRoot, workOrder: order, result, opener }), /缺少当前片头版本/);
  const input = await readVideoOpenerInput({ workOrderPath: work.workOrder });
  assert.deepEqual(input.opener, opener);
  await assertVideoOpenerInput({ workspaceRoot: options.workspaceRoot, workOrder: order, result, opener });
  const changed = { ...opener, flashbackLine: opener.flashbackLine + "更新" };
  await write(paths.episodePackage, { opener: acceptedOpener(changed) });
  await assert.rejects(assertVideoOpenerInput({ workspaceRoot: options.workspaceRoot, workOrder: order, result, opener: changed }), /缺少当前片头版本/);
  assert.deepEqual((await readVideoOpenerInput({ workOrderPath: work.workOrder })).opener, changed);
  await assertVideoOpenerInput({ workspaceRoot: options.workspaceRoot, workOrder: order, result, opener: changed });
  await write(getStageWorkPaths(paths, "p4").returnRequest("opener"), { target: "opener", reason: "当前片头待修正", cueRefs: [] });
  await assert.rejects(readVideoOpenerInput({ workOrderPath: work.workOrder }), /等待本次片头正式接纳/);
  assert.equal(await readFile(work.candidate, "utf8"), candidate);
  assert.equal(await readFile(work.workOrder, "utf8"), originalOrder);
  await assertVideoOpenerInput({ workspaceRoot: options.workspaceRoot, workOrder: order, result: { spans: [] }, opener: null });
});

test("视频接纳准备期间片头变化时事务拒绝旧版，原单与候选保留", async t => {
  const { options, paths, opener } = await setup(t);
  await write(paths.episodePackage, { opener: acceptedOpener(opener) });
  await runNext({ ...options, nodeId: "video" });
  const work = getStageWorkPaths(paths, "p4", null, "video"), order = await readData(work.workOrder);
  await write(work.candidate, { taskDigest: order.taskDigest, result: {
    episodeId: "ep01", templateId: "cinematic-video", selectionReason: "本片段无需视频", spans: [], incomingTransitions: {}
  } });
  const candidate = await readFile(work.candidate, "utf8");
  const originalRead = fs.readFile;
  let changed = false;
  fs.readFile = async (file, ...args) => {
    if (file === work.candidate && !changed) {
      changed = true;
      await write(paths.episodePackage, { opener: acceptedOpener({ ...opener, flashbackLine: opener.flashbackLine + "更新" }) });
    }
    return originalRead(file, ...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(acceptCandidate({ ...options, nodeId: "video" }), /接纳期间片头已变化/); }
  finally { fs.readFile = originalRead; syncBuiltinESMExports(); }
  assert.ok(changed);
  await assert.rejects(readFile(paths.videoPlan), { code: "ENOENT" });
  assert.equal(await readFile(work.candidate, "utf8"), candidate);
  assert.equal((await readData(work.workOrder)).taskDigest, order.taskDigest);
});
