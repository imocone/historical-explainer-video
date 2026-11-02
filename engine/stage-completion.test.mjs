import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { deriveStatus, hashObject, readData, resolvePublicationCurrent, resolveRenderInputs, runNext, runRange, sha256 } from "./runtime.mjs";
import { getEpisodePaths, getProgramPaths } from "../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../packages/publication-paths.mjs";
import { projectVideoProduction } from "../packages/templates/cinematic-video/production-projection.mjs";
import { authorSegmentProgress } from "./runtime/state-video.mjs";
import { run as produceCovers } from "../packages/modules/produce-covers/cover/run.mjs";
import { programInvocationTask } from "./runtime/tasks.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("P3进度按完整段计数，讲解地图范围不计入全画幅Beat", () => {
  const storyboard = {
    beats: [
      ...["B001", "B002", "B003"].map(id => ({ id, templateId: "fullframe-narrative" })),
      { id: "B004", templateId: "vox-explainer" },
      ...["B005", "B006"].map(id => ({ id, templateId: "vox-explainer" }))
    ],
    templateRuns: [
      { id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002", "B003"] },
      { id: "TR002", templateId: "vox-explainer", beatIds: ["B004"] },
      { id: "TR003", templateId: "vox-explainer", beatIds: ["B005", "B006"] }
    ]
  };
  const progress = (ids, currentUnitId = null) => authorSegmentProgress({
    storyboard, completedUnitIds: new Set(ids), currentUnitId
  });
  assert.deepEqual(progress(["B001", "B002"], "B003"), {
    unit: "segment", beatCount: 3, total: 3, completed: 0, currentUnitId: "TR001"
  });
  assert.deepEqual(progress(["B001", "B002", "B003"], "TR002"), {
    unit: "segment", beatCount: 3, total: 3, completed: 1, currentUnitId: "TR002"
  });
  assert.equal(progress(["B001", "B002", "B003", "TR002", "TR003"]).completed, 3);
  assert.equal(progress(["B001", "B003", "TR002", "TR003"], "B002").completed, 2);
});

const write = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
};
const accepted = (value, moduleId, nodeId) => ({
  ...value,
  _producer: {
    moduleId, nodeId, taskDigest: "a".repeat(64), inputs: [], rules: [],
    contract: "b".repeat(64), outputSha256: hashObject(value)
  }
});

const setup = async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "stage-completion-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const options = { root, workspaceRoot, episodeId: "ep01", targetId: "release-main" };
  const paths = getEpisodePaths(workspaceRoot, options.episodeId);
  const publication = getPublicationPaths(workspaceRoot, options.episodeId, options.targetId);
  const visual = await readData(path.join(root, "visuals/meiji-state-machine/visual-package.json"));
  const opener = (await readData(path.join(root, "packages/templates/episode-opener/examples/golden.json"))).result;
  const videoPlan = {
    episodeId: options.episodeId, templateId: "cinematic-video",
    selectionReason: "本用例不选择剧情视频", incomingTransitions: {}, spans: []
  };
  const narration = "测试口播。";
  const subtitles = "1\n00:00:00,000 --> 00:00:01,000\n测试口播。\n";
  await write(getProgramPaths(workspaceRoot).programPlan, {
    openerTemplate: "episode-opener", visualPackage: { visualPackageId: visual.id, version: visual.version }
  });
  await write(paths.narrationText, narration);
  await write(paths.narrationSubtitles, subtitles);
  await write(paths.narrationPackage, {
    episodeId: options.episodeId, durationMs: 1000,
    files: {
      narration: { path: "narration.txt", sha256: sha256(narration) },
      subtitles: { path: "narration.srt", sha256: sha256(subtitles) }
    }
  });
  await write(paths.sourceAssets, { assets: [] });
  await write(paths.storyboard, { episodeId: options.episodeId, understanding: {}, albumPlan: {}, beats: [], templateRuns: [], features: {} });
  await write(paths.openerNarration, { openerNarration: opener.flashbackLine });
  await write(paths.episodePackage, { episodeId: options.episodeId, opener });
  await write(paths.videoPlan, accepted(videoPlan, "author-video", "video"));
  await write(paths.videoManifest, accepted({
    episodeId:options.episodeId, videoPlanSha256:hashObject(projectVideoProduction(videoPlan)), clips:[]
  }, "produce-video-assets", "video-assets"));
  // 已有阅读稿，但正式发布文案缺失，复现错误跨阶段检查。
  await write(publication.publicationText, "保留已有阅读稿");
  return { options, paths, publication };
};

test('P4默认不进入视频模块，也不依赖发布文案',async t=>{
 const {options,paths}=await setup(t);
 await rm(paths.videoPlan);await rm(paths.videoManifest);
 const status=await deriveStatus({...options,stageId:'p4'});
 assert.deepEqual(status.queue.map(x=>x.nodeId),['opener','render']);
 assert.notEqual(status.nodeId,'video');assert.notEqual(status.nodeId,'video-assets');
 await assert.rejects(readFile(paths.videoPlan),{code:'ENOENT'});
 await assert.rejects(readFile(paths.videoManifest),{code:'ENOENT'});
 await assert.rejects(resolvePublicationCurrent(options),/P1正式文案缺失/);
 // Offline handoff fixture only: no authoring, media API, or production render.
 const packaging=await readData(paths.episodePackage);
 await writeFile(path.join(options.workspaceRoot,'fixture-image.png'),'fixture image bytes');
 for(const shot of packaging.opener.flashbackShots)
   shot.asset={file:'fixture-image.png',sha256:sha256('fixture image bytes')};
 await write(paths.episodePackage,packaging);
 const render=await resolveRenderInputs(options);
 assert.equal(render.moduleId,'render-video');
 assert.equal(render.context.videoPlan,null);
 assert.equal(render.context.videoManifest,null);
});

test('P3不读取下游P4的视频选择',async t=>{
 const {options,paths}=await setup(t);
 const before=await deriveStatus({...options,stageId:'p3'});
 await write(paths.videoSettings,'invalid downstream setting');
 const after=await deriveStatus({...options,stageId:'p3'});
 assert.equal(after.kind,before.kind);
 assert.equal(after.nodeId,before.nodeId);
});

test("空选由真实程序交付，无效清单退回原生产方恢复", async (t) => {
  const { options, paths } = await setup(t);
  const upstream = [paths.storyboard, paths.episodePackage, paths.videoPlan];
  const before = await Promise.all(upstream.map(file => readFile(file, "utf8")));
  await rm(paths.videoManifest);
  await runNext({ ...options, stageId: "p4", nodeId:"video-assets" });
  assert.equal((await deriveStatus({ ...options, stageId: "p4", nodeId:"video-assets" })).kind, "node-complete");
  const manifest = await readData(paths.videoManifest);
  assert.deepEqual(manifest.clips, []);
  assert.equal(manifest._producer.contract, sha256(await readFile(path.join(root, "contracts/video-manifest.schema.json"))));
  assert.ok(manifest._producer.rules.length > 0);

  delete manifest._producer.rules;
  delete manifest._producer.contract;
  await write(paths.videoManifest, manifest);
  await assert.rejects(resolveRenderInputs(options), /required property 'rules'/u);
  const repair = await deriveStatus({ ...options, stageId: "p4" });
  assert.equal(repair.moduleId, "produce-video-assets");
  assert.equal(repair.runner, "program");
  await runNext({ ...options, stageId: "p4", nodeId:"video-assets" });
  assert.equal((await deriveStatus({ ...options, stageId: "p4", nodeId:"video-assets" })).kind, "node-complete");
  assert.deepEqual(await Promise.all(upstream.map(file => readFile(file, "utf8"))), before);
});

test("封面仅呈现作者原文，不按节目总集数自动补系列名或集号", async (t) => {
  for (const count of [1, 2]) await t.test(`${count}集`, async (t) => {
    const { options, paths, publication } = await setup(t);
    const programPath = getProgramPaths(options.workspaceRoot).programPlan;
    const program = await readData(programPath);
    program.coverPackage = { coverPackageId: "type-first-editorial", version: "1.0.0" };
    program.episodes = Array.from({ length: count }, (_, index) => ({ episodeId: `ep0${index + 1}` }));
    await write(programPath, program);
    await write(paths.scriptPackage, { episodeId: options.episodeId, narration: "测试口播。" });
    const cover = { posterConcept: "舰队在江面上接近对岸。", heroVisual: "江面上的舰队",
      visibleText: count === 1 ? ["怎样迎战？"] : ["舰队接近", "怎样迎战？", "历史节目 01"] };
    await write(publication.publicationDocument, { schemaVersion: "7.0", episodeId: options.episodeId,
      targetId: options.targetId, platforms: {}, covers: { youtube: cover, vertical: cover } });
    const task = await resolvePublicationCurrent(options);
    assert.equal(task.node.moduleId, "produce-covers");
    const batch = await produceCovers({ root: options.workspaceRoot,
      episodeId: options.episodeId, targetId: options.targetId, task: programInvocationTask(task) });
    assert.equal(batch.kind, "image-generation-batch");
    assert.equal(batch.requests.length, 2);
    for (const request of batch.requests) {
      assert.doesNotMatch(request.prompt, /C旁排入正式集号/u);
      assert.match(request.prompt, count === 1
        ? /【文字原文】1「怎样迎战？」/u
        : /【文字原文】1「舰队接近」；2「怎样迎战？」；3「历史节目 01」/u);
      if (count === 1) assert.doesNotMatch(request.prompt, /历史节目|「01」/u);
    }
  });
});

test("正文局部渲染输入不依赖片头或剧情视频交付", async (t) => {
  const { options, paths } = await setup(t);
  const storyboard = await readData(paths.storyboard);
  storyboard.beats = [{ id: "B001", templateId: "fullframe-narrative", cueRange: [1, 1],
    treatment: { templateId: "fullframe-narrative" } }];
  await write(paths.storyboard, storyboard);
  await Promise.all([paths.episodePackage, paths.videoPlan, paths.videoManifest].map(file => rm(file)));
  const task = await resolveRenderInputs({ ...options, previewPart: "body" });
  assert.equal(task.moduleId, "render-video");
  assert.equal(task.context.previewPart, "body");
  assert.deepEqual(task.context.previewSegmentIds, ["B001"]);
  assert.equal(task.context.storyboard.opener, undefined);
  assert.equal(task.context.videoPlan, null);
  // Empty the body to isolate the missing opener from intentionally incomplete
  // body-preview fixtures; the full render must still require its own opener.
  await write(paths.storyboard,{...storyboard,beats:[]});
  await assert.rejects(resolveRenderInputs(options), /尚无正式片头设计/u);
});

test("片头局部渲染输入不要求无关正文或剧情视频交付", async (t) => {
  const { options, paths } = await setup(t);
  const storyboard = await readData(paths.storyboard);
  storyboard.beats = ["B001", "B002", "B003", "B004"].map(id => ({
    id, templateId: "fullframe-narrative", cueRange: [1, 1],
    treatment: id === "B004" ? null : { templateId: "fullframe-narrative" }
  }));
  await write(paths.storyboard, storyboard);
  await Promise.all([paths.videoPlan, paths.videoManifest].map(file => rm(file)));
  const task = await resolveRenderInputs({ ...options, previewPart: "opener" });
  assert.equal(task.context.previewPart, "opener");
  assert.deepEqual(task.context.previewSegmentIds, ["opener"]);
  assert.equal(task.context.storyboard.opener.templateId, "episode-opener");
  assert.equal(task.context.videoManifest, null);
});

test("P4缺少自己的交付仍回到对应作者", async (t) => {
  for (const nodeId of ["opener", "video"]) {
    await t.test(nodeId, async (t) => {
      const { options, paths } = await setup(t);
      if (nodeId === "opener") await write(paths.episodePackage, { episodeId: options.episodeId });
      else { await write(paths.videoSettings,{enabled:true});await rm(paths.videoPlan); }
      const status = await deriveStatus({ ...options, stageId: "p4" });
      assert.equal(status.kind, "task");
      assert.equal(status.runner, "ai");
      assert.equal(status.nodeId, nodeId);
    });
  }
});

test('公开系统不存在P5，已有成片不进入发布节点',async t=>{
 const {options,paths}=await setup(t);await write(paths.finalVideo,'existing final video fixture');
 const status=await deriveStatus({...options,stageId:'p4'});
 assert.notEqual(status.nodeId,'publish-platform');
 assert(!status.queue.some(x=>x.nodeId==='publish-platform'));
 await assert.rejects(deriveStatus({...options,stageId:'p5'}),/未知阶段/);
});

test('连续范围以P4结束，公开阶段不含P5且不改既有上游',async t=>{
 const {options,paths}=await setup(t);const before=await readFile(paths.storyboard);
 await assert.rejects(runRange({...options,fromStage:'p4',toStage:'p5'}),/按顺序|P1|p1|p4|p5|阶段/);
 assert.deepEqual(await readFile(paths.storyboard),before);
});
