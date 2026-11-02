import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hashObject, readData, sha256, withoutProducer } from "../packages/program-utils.mjs";
import { getEpisodePaths, getProgramPaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { acceptCandidate, runNext } from "./runtime.mjs";
import { inspectCurrentDirectorCandidate } from "../packages/modules/direct-episode/inspect-authorability.mjs";
import { inspectDirectorBoundaries } from "../packages/modules/direct-episode/inspect-boundaries.mjs";
import { validate as validateDirector } from "../packages/modules/direct-episode/validate.mjs";
import { assertTaskContinuity } from "./runtime/tasks.mjs";
import { authorUnitsForStoryboard, changedDirectorBeatIds } from "./runtime/storyboard.mjs";
import { authorPreviousTreatmentProducerInputsForResult } from "./runtime/author-tasks.mjs";
import { projectAdjacentTreatment } from "../packages/templates/fullframe-narrative/context-runtime.mjs";
import { projectP3TaskView } from "../packages/p3-task-view.mjs";
import { inspectFullframeDesign, readFullframeDesignFeedback } from "../packages/templates/fullframe-narrative/inspect-design.mjs";
import { lockFullframeCallouts } from "../packages/templates/fullframe-narrative/lock-callouts.mjs";
import { preflightAuthorCandidate } from "../packages/modules/author-beat/preflight.mjs";
import { submitAuthorCandidate } from "../packages/modules/author-beat/submit.mjs";
import { collectAuthoredMedia } from "../packages/authored-media.mjs";
import { bodySegmentDescriptorsFor } from "../packages/modules/render-video/runtime/body-segments.mjs";
import { projectRenderStoryboard } from "../packages/modules/render-video/runtime/projection.mjs";
import { videoWindow } from "../packages/templates/cinematic-video/timing.mjs";
import { projectAcceptedOpenerBodyDependencies } from "../packages/modules/author-bookend/dependency-projection.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = async (file, value) => { await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value)); };
const direction = id => ({ id: `B00${id}`, cueRange: [id, id], templateId: "fullframe-narrative",
  viewerOutcome: "体会等待", directorBrief: { roleInAlbum: "推进等待", mustShow: "来客与院门", relationFromPrevious: id > 1 ? "继续观察" : null }, treatment: null });

test("导演只枚举全画幅内部切点，保留讲解地图范围及全部相邻交接", () => {
  const beats = [
    { ...direction(1), cueRange: [1, 2] },
    { ...direction(2), cueRange: [3, 5], templateId: "vox-explainer" },
    { ...direction(3), cueRange: [6, 8], templateId: "vox-explainer" },
    { ...direction(4), cueRange: [9, 10] }
  ];
  const cues = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1, startMs: index * 5000, endMs: (index + 1) * 5000
  }));
  const inspection = inspectDirectorBoundaries({
    workOrder: { inputs: { cues } }, candidate: { result: { beats } }
  });
  assert.equal(inspection.summary.cueCount, 10);
  assert.deepEqual(inspection.beatIndex.map(({ id, cueRange }) => ({ id, cueRange })),
    beats.map(({ id, cueRange }) => ({ id, cueRange })));
  assert.deepEqual(inspection.internalBoundaries.map(item => item.boundary), ["1/2", "9/10"]);
  assert.deepEqual(inspection.betweenBeatBoundaries.map(item => [item.leftCueRange, item.rightCueRange]),
    [[[1, 2], [3, 5]], [[3, 5], [6, 8]], [[6, 8], [9, 10]]]);
});

test("导演恢复旧工作单时消费现行目录，保留原模板身份与签发内容", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "director-catalog-view-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ids = ["fullframe-narrative", "vox-explainer"];
  const base = {
    subject: { kind: "episode", id: "ep01" }, stageId: "p3", nodeId: "director",
    moduleId: "direct-episode", runner: "ai",
    inputs: { narration: { content: "来客等候。" }, cues: [{ id: 1, text: "来客等候。" }],
      templates: ids.map(id => ({ id, purpose: "旧能力说明", rejectWhen: "旧限制" })) },
    resolvedRules: [{ source: "packages/modules/direct-episode/SKILL.md", sha256: "old" }],
    outputContract: { source: "packages/modules/direct-episode/result.schema.json", content: {} },
    resolvedAssembly: { node: { id: "director", moduleId: "direct-episode" },
      module: { id: "direct-episode", manifest: { source: "packages/modules/direct-episode/package.yaml" },
        controllerEntry: { source: "packages/modules/direct-episode/controller.json" } },
      slots: [{ id: "body-template-catalog", selection: { packageIds: ids },
        implementations: ids.map(packageId => ({ packageId, kind: "template", majorVersion: 1,
          resources: [{ role: "catalog", source: `packages/templates/${packageId}/package.yaml#catalog`, sha256: "old" }] })) }] },
    allowedWrite: "ep01/制作/p3/storyboard.yaml", allowedReturnTargets: ["understand"],
    candidatePath: "ep01/制作/p3/_work/candidate.yaml"
  };
  const task = { ...base, taskDigest: hashObject(base) };
  const file = path.join(directory, path.dirname(base.candidatePath), "work-order.yaml");
  await write(getEpisodePaths(directory, "ep01").sourceAssets, { schemaVersion: "1.0", assets: [] });
  await write(file, task);
  const original = await readFile(file);
  const view = JSON.parse(execFileSync(process.execPath,
    [path.join(root, "packages/p3-task-view.mjs"), file], { cwd: root, encoding: "utf8" }));
  assert.equal(view.taskDigest, task.taskDigest);
  assert.deepEqual(view.inputs.templates.map(item => item.id), ids);
  for (const [index, id] of ids.entries()) {
    const manifest = await readData(path.join(root, `packages/templates/${id}/package.yaml`));
    assert.deepEqual(view.inputs.templates[index], { id, ...manifest.catalog });
    assert.equal(view.resolvedAssembly.slots[0].implementations[index].resources[0].sha256,
      hashObject(manifest.catalog));
  }
  assert.deepEqual(await readFile(file), original, "读取现行能力不改签发单");
  const missing = structuredClone(task);
  missing.inputs.templates[0].id = "missing-director-template";
  const { taskDigest: _digest, ...missingBase } = missing;
  missing.taskDigest = hashObject(missingBase);
  const missingFile = path.join(path.dirname(file), "missing-catalog.yaml");
  await write(missingFile, missing);
  assert.throws(() => execFileSync(process.execPath,
    [path.join(root, "packages/p3-task-view.mjs"), missingFile], { cwd: root, stdio: "pipe" }),
  "现行目录不可用时停止，不能沿用旧能力说明");
});
const resultFor = id => ({ treatment: { templateId: "fullframe-narrative",
  incomingTransition: id === 1 ? null : { type: "dissolve", durationMs: 600, reason: "在当前口播转换观察位置" },
  continuity: { period: "测试时代", location: "院落", continuesPreviousScene: false, subjects: ["来客"], props: [], carryToNext: { subjects: [], props: [] } },
  calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" },
  assetRequests: [{ requestId: "AR001", frameId: "A", cameraRelation: id === 1 ? "first" : "reset",
    purpose: "看见等待中的来客与关闭的院门", sourceRefs: [`C00${id}`], mustNotInvent: ["不添加人物身份"], acceptanceCriteria: ["人物与院门可辨"],
    sceneDescription: "完整院落中，来客在前景停步，石径通向中景关闭的院门，后景屋宇相连。",
    attentionPlan: { entryFocus: "院落", landingFocus: "来客与院门", viewerChange: "感受未被回应的等待" },
    motion: { type: "push-in", speedRatio: 1, startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
      semanticEndViewport: { x: .15, y: .1, width: 2 / 3, height: 2 / 3 } } }] },
  featureResults: { "cue-sync": { items: [{ target: "AR001", action: "start-frame-motion", cueId: id, edge: "start" }] } } });

test("全画幅联合单先完成画面，再逐Beat交音效并沿原B2接纳", async t => {
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'fullframe-sound-handoff-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const paths=getEpisodePaths(workspaceRoot,'ep01');
  const visual=await readData(path.join(root,'visuals/modern-editorial/visual-package.json'));
  const image=path.join(root,'visuals/modern-editorial',visual.masterReference.path);
  await write(getProgramPaths(workspaceRoot).programPlan,{programForm:'historical-explainer',openerTemplate:'episode-opener',
    visualPackage:{visualPackageId:visual.id,version:visual.version}});
  const narration='来客在院门前等待。\n院门仍然关着。';
  const subtitles='1\n00:00:00,000 --> 00:00:06,000\n来客在院门前等待。\n\n2\n00:00:06,000 --> 00:00:12,000\n院门仍然关着。\n';
  await write(paths.narrationText,narration);await write(paths.narrationSubtitles,subtitles);
  await write(paths.narrationPackage,{episodeId:'ep01',durationMs:12000,files:{
    narration:{path:'narration.txt',sha256:sha256(narration)},subtitles:{path:'narration.srt',sha256:sha256(subtitles)}}});
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:[]});
  await write(paths.storyboard,{understanding:{episodeQuestion:'等待会怎样？',thesis:'等待尚无回应',
    narrativeArc:{start:'等待',turn:'继续等待',end:'未被回应'},facts:[],relations:[],evidence:[],uncertainties:[],mustNotInvent:['不添加身份'],
    semanticReading:{underlyingMeaning:'等待',audienceStartingPoint:'尚未了解',targetUnderstanding:'体会等待',speakerStances:[],contextConstraints:[],rhetoricalReadings:[],humanStakes:[]}},
    albumPlan:{intent:'体会等待',openingState:'来客等候',progression:'观察等待',endingState:'未被回应',recurringElements:[]},
    beats:[1,2].map(direction),templateRuns:[{id:'TR001',templateId:'fullframe-narrative',beatIds:['B001','B002'],treatment:null}],
    features:{'cue-sync':{bindings:{}},'sound-effects':{units:{}}}});
  const options={root,workspaceRoot,episodeId:'ep01',stageId:'p3',segmentId:'TR001'};
  await runNext(options);
  const work=getStageWorkPaths(paths,'p3','TR001'),task=await readData(work.workOrder);
  assert.equal(task.inputs.authorBatch.members.length,2);
  const {taskDigest:signature,...signed}=task;
  assert.equal(task.moduleId,'author-beat');
  assert.equal(hashObject(signed),signature,'原工作单签名完整');
  const items=[1,2].map(id=>({beatId:`B00${id}`,...resultFor(id)}));
  await write(work.candidate,{taskDigest:task.taskDigest,result:{items}});
  const images=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(root,'packages/authored-images.mjs'),...args],
    {encoding:'utf8',maxBuffer:4*1024*1024}));
  for(const item of items){images('begin',work.workOrder,work.candidate,`${item.beatId}/AR001`);
    images('import',work.workOrder,work.candidate,`${item.beatId}/AR001`,image);}
  await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const ready=await readData(work.candidate),pictures=ready.result.items.map(item=>structuredClone(item.treatment));
  await assert.rejects(preflightAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate}),/已启用功能缺少候选结果: sound-effects/);
  for(const item of ready.result.items)item.featureResults['sound-effects']={events:[{id:'S001',purpose:`${item.beatId}的重点`,
    soundId:'paper',anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1}}]};
  await write(work.candidate,ready);
  await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,workspace:workspaceRoot,episode:'ep01'});
  await acceptCandidate(options);
  const saved=await readData(paths.storyboard);
  assert.deepEqual(Object.keys(saved.features['sound-effects'].units).sort(),['B001','B002']);
  for(const [index,item]of ready.result.items.entries()){
    assert.deepEqual(saved.features['sound-effects'].units[item.beatId].events,item.featureResults['sound-effects'].events);
    assert.deepEqual(withoutProducer(saved.beats[index].treatment),pictures[index]);
  }
});

test("四Beat联合设计、图片与接纳，单Beat调速保留其它成果与全部原图", async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fullframe-paragraph-test-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const paths = getEpisodePaths(workspaceRoot, "ep01");
  let work = getStageWorkPaths(paths, "p3");
  const visual = await readData(path.join(root, "visuals/modern-editorial/visual-package.json"));
  const image = path.join(root, "visuals/modern-editorial", visual.masterReference.path);
  await write(getProgramPaths(workspaceRoot).programPlan, { programForm: "historical-explainer", openerTemplate: "episode-opener",
    visualPackage: { visualPackageId: visual.id, version: visual.version } });
  const narration = Array(4).fill("来客仍在院门前等待。").join("\n");
  const subtitles = [1, 2, 3, 4].map((id, i) => `${id}\n00:00:${String(i * 6).padStart(2, "0")},000 --> 00:00:${String((i + 1) * 6).padStart(2, "0")},000\n来客仍在院门前等待。\n`).join("\n");
  await write(paths.narrationText, narration); await write(paths.narrationSubtitles, subtitles);
  // Camera clip previews consume P2 audio; keep that input in this offline fixture.
  const audioFile = path.join(paths.p2, "narration.wav");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "24", "-y", audioFile]);
  await write(paths.narrationPackage, { episodeId: "ep01", durationMs: 24000, files: {
    narration: { path: "narration.txt", sha256: sha256(narration) }, subtitles: { path: "narration.srt", sha256: sha256(subtitles) },
    audio: { path: "narration.wav", sha256: sha256(await readFile(audioFile)) } } });
  await write(paths.sourceAssets, { schemaVersion: "1.0", assets: [] });
  const initial = { understanding: { episodeQuestion: "等待会怎样？", thesis: "等待尚无回应",
    narrativeArc: { start: "等待", turn: "继续等待", end: "仍未回应" }, facts: [], relations: [], evidence: [], uncertainties: [], mustNotInvent: ["不添加身份"],
    semanticReading: { underlyingMeaning: "等待", audienceStartingPoint: "尚未了解", targetUnderstanding: "体会等待", speakerStances: [], contextConstraints: [], rhetoricalReadings: [], humanStakes: [] } },
    albumPlan: { intent: "体会等待", openingState: "来客等候", progression: "观察等待", endingState: "未被回应", recurringElements: [] },
    beats: [1, 2, 3, 4].map(direction), templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002", "B003", "B004"], treatment: null }],
    features: { "cue-sync": { bindings: {} } } };
  await write(paths.storyboard, { understanding: initial.understanding });
  const options = { root, workspaceRoot, episodeId: "ep01", stageId: "p3" };
  await runNext(options);
  const director = await readData(work.workOrder);
  assert.equal(director.moduleId, "direct-episode");
  const result = { albumPlan: initial.albumPlan,
    beats: initial.beats.map(({ treatment, ...beat }) => beat),
    templateRuns: initial.templateRuns.map(({ treatment, ...run }) => run) };
  assert.deepEqual(validateDirector({ result, context: director.inputs }), []);
  assert.ok(validateDirector({ result: { ...result, templateRuns: [] }, context: director.inputs })
    .some(error => error.includes("唯一连续段")));
  await write(work.candidate, { taskDigest: director.taskDigest, result });
  const planned = await inspectCurrentDirectorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate });
  assert.equal(planned.authorable, true);
  assert.deepEqual(planned.units.map(unit => unit.id), ["B001", "B002", "B003", "B004"]);
  for (const entry of ["inspect-boundaries", "lock-boundaries"]) execFileSync(process.execPath,
    [path.join(root, `packages/modules/direct-episode/${entry}.mjs`), work.workOrder, work.candidate],
    { stdio: ["ignore", "pipe", "pipe"] });
  await acceptCandidate(options);
  await runNext(options);
  work = getStageWorkPaths(paths, "p3", "TR001");
  const task = await readData(work.workOrder);
  assert.deepEqual(task.inputs.authorBatch.members.map(member => member.beatId), ["B001", "B002", "B003", "B004"]);
  const signedInputs = structuredClone(task.inputs), view = projectP3TaskView(task);
  assert.deepEqual(view.inputs.authorBatch, signedInputs.authorBatch, "全部成员保留完整业务输入");
  assert.deepEqual(view.inputs.templateContext, signedInputs.templateContext, "共享全片语境保留");
  assert.equal(view.inputs.cues, undefined, "首个成员已有完整字幕，不在顶层重复投递");
  assert.equal(view.inputs.semanticContext, undefined);
  assert.deepEqual(task.inputs, signedInputs, "投影不改写签发工作单");
  const distinct = structuredClone(task);
  distinct.inputs.semanticContext = { ...distinct.inputs.semanticContext, mustNotInvent: ["独立共享限定"] };
  const { taskDigest: _digest, ...base } = distinct;
  distinct.taskDigest = hashObject(base);
  assert.deepEqual(projectP3TaskView(distinct).inputs.semanticContext, distinct.inputs.semanticContext,
    "顶层包含独有信息时完整保留");
  const delivered = JSON.parse(execFileSync(process.execPath, [path.join(root, "packages/p3-task-view.mjs"), work.workOrder],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  for (const [index, member] of delivered.inputs.authorBatch.members.entries()) {
    const original = signedInputs.authorBatch.members[index].inputs;
    assert.deepEqual(member.inputs.cues, original.cues);
    assert.deepEqual(member.inputs.semanticContext, original.semanticContext);
    assert.equal(member.inputs.authorUnitBeats[0].cues, undefined);
    assert.equal(member.inputs.directionContext.albumPlan, undefined);
    assert.deepEqual(member.inputs.templateContext.priorCueIndex,
      original.templateContext.priorCueIndex.map(({ text: _text, ...cue }) => cue));
  }
  assert.deepEqual((await readData(work.workOrder)).inputs, signedInputs, "实际投递仍不改签发输入");
  const candidate = { taskDigest: task.taskDigest, result: { items: [1, 2, 3, 4].map(id => ({ beatId: `B00${id}`, ...resultFor(id) })) } };
  // Static waiting deliberately leaves room for narration; the enabled feature still delivers.
  for (const item of candidate.result.items) item.featureResults["sound-effects"] = { events: [] };
  candidate.result.items[2].treatment.continuity.continuesPreviousScene = true;
  await write(work.candidate, candidate);
  const draft = await readFile(work.candidate);
  await assert.rejects(inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    clipRequestId: "B003/AR999" }), /当前Beat\/AR/);
  assert.deepEqual(await readFile(work.candidate), draft);
  assert.equal((await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate })).beats.length, 4);
  const measured = await readData(work.candidate);
  const saved = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate, saveFeedback: true });
  const readFeedback = (beatIds, feedbackPath = saved.feedbackPath) => readFullframeDesignFeedback({
    workOrderPath: work.workOrder, candidatePath: work.candidate, feedbackPath, beatIds });
  const b2 = await readFeedback(["B002"]);
  assert.deepEqual(b2.inspectedBeatIds, ["B002"]);
  assert.equal(b2.beats[0].targets[0].design.sceneDescription, measured.result.items[1].treatment.assetRequests[0].sceneDescription);
  assert.deepEqual(await readData(work.candidate), measured, "读取反馈不改候选");
  await assert.rejects(readFeedback(["B999"]), /反馈没有Beat/);
  const unrelated = structuredClone(measured);
  unrelated.result.items[3].treatment.assetRequests[0].purpose = "未被B002读取的末拍新职责";
  await write(work.candidate, unrelated);
  assert.deepEqual((await readFeedback(["B002"])).beats, b2.beats, "无关成员改变不使当前反馈失效");
  unrelated.result.items[0].treatment.assetRequests[0].motion.speedRatio = 1.1;
  await write(work.candidate, unrelated);
  await assert.rejects(readFeedback(["B002"]), /前序接缝已改变/);
  const ownChange = structuredClone(measured);
  ownChange.result.items[1].treatment.assetRequests[0].sceneDescription += "来客抬头看向院门。";
  await write(work.candidate, ownChange);
  await assert.rejects(readFeedback(["B002"]), /设计或前序接缝已改变/);
  await write(work.candidate, measured);
  const failedCandidate = structuredClone(measured);
  failedCandidate.result.items[3].treatment.assetRequests[0].motion.speedRatio = 20;
  delete failedCandidate.result.items[3].treatment.assetRequests[0].kind;
  await write(work.candidate, failedCandidate);
  const failedFeedback = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    beatIds: ["B004"], saveFeedback: true });
  assert.equal(failedFeedback.ok, false);
  assert.equal((await readFeedback(["B004"], failedFeedback.feedbackPath)).ok, false, "失败测量也能读取完整原因");
  assert.deepEqual(await readData(work.candidate), failedCandidate, "失败反馈不改候选");
  await write(work.candidate, measured);
  const images = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, "packages/authored-images.mjs"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }));
  const pending = images("prepare", work.workOrder, work.candidate);
  assert.equal(pending.length, 4);
  assert.equal(pending.find(job => job.key === "B003/AR001").dependsOn, "B002");
  assert.throws(() => images("begin", work.workOrder, work.candidate, "B003/AR001"), /先完成其导入/);
  for (const id of [1, 2, 4]) images("begin", work.workOrder, work.candidate, `B00${id}/AR001`);
  assert.throws(() => images("begin", work.workOrder, work.candidate, "B004/AR001"), /结果未知/);
  for (const id of [1, 2, 4]) images("import", work.workOrder, work.candidate, `B00${id}/AR001`, image);
  const dependent = images("begin", work.workOrder, work.candidate, "B003/AR001");
  assert.ok(dependent[0].job.referenced_image_paths.some(file => file.includes("assets/B002/")));
  images("import", work.workOrder, work.candidate, "B003/AR001", image);
  const realFull = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate });
  assert.equal(realFull.ok, true);
  await lockFullframeCallouts({ workOrderPath: work.workOrder, candidatePath: work.candidate });
  const valid = await readData(work.candidate), bad = structuredClone(valid);
  const lockedFile = id => path.join(workspaceRoot, task.scratchPath, "beats", id, "step-locks/fullframe-camera-final.json");
  const outsideLocks = await Promise.all(["B001", "B004"].map(id => readFile(lockedFile(id))));
  const outsideLockInodes = await Promise.all(["B001", "B004"].map(async id => (await stat(lockedFile(id))).ino));
  const scoped = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate, beatIds: ["B002"] });
  assert.deepEqual(scoped.inspectedBeatIds, ["B002", "B003"], "局部测量保留紧邻下一拍的入场复核");
  assert.deepEqual(scoped.beats, realFull.beats.slice(1, 3), "局部与整段使用同一设计、取景、接缝及实图材料");
  assert.deepEqual(await readData(work.candidate), valid, "局部检查保留完整候选");
  assert.deepEqual(await Promise.all(["B001", "B004"].map(id => readFile(lockedFile(id)))), outsideLocks);
  assert.deepEqual(await Promise.all(["B001", "B004"].map(async id => (await stat(lockedFile(id))).ino)), outsideLockInodes,
    "无关成员的锁没有被重写");
  const savedScoped = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    beatIds: ["B002"], saveFeedback: true });
  const savedReading = await readFeedback([], savedScoped.feedbackPath);
  const abbreviated = structuredClone(valid);
  delete abbreviated.result.items[0].treatment.assetRequests[0].motion.safeEndViewport;
  delete abbreviated.result.items[0].treatment.assetRequests[0].attentionPlan.safeEndFocus;
  await write(work.candidate, abbreviated);
  assert.deepEqual(await readFeedback([], savedScoped.feedbackPath), savedReading,
    "上一拍允许的简写不使既有反馈失效");
  assert.deepEqual(await readData(work.candidate), abbreviated, "读取反馈只在内存补齐相邻参考");
  assert.deepEqual(await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    beatIds: ["B002"] }), scoped, "上一拍简写时，局部实图、取景和接缝与整段检查相同");
  assert.deepEqual(await readData(work.candidate), abbreviated, "局部检查不补写未选中的上一拍");
  const invalidPrevious = structuredClone(abbreviated);
  invalidPrevious.result.items[0].treatment.assetRequests[0].motion.safeEndViewport = null;
  await write(work.candidate, invalidPrevious);
  await assert.rejects(readFeedback([], savedScoped.feedbackPath), /路线|取景/);
  await assert.rejects(inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    beatIds: ["B002"] }), /路线|取景/);
  assert.deepEqual(await readData(work.candidate), invalidPrevious, "不把明确错误的路线改成默认值");
  assert.deepEqual(await Promise.all(["B001", "B004"].map(id => readFile(lockedFile(id)))), outsideLocks);
  assert.deepEqual(await Promise.all(["B001", "B004"].map(async id => (await stat(lockedFile(id))).ino)), outsideLockInodes,
    "简写参考与失败路径均不刷新未选Beat的锁");
  await write(work.candidate, valid);
  const clip = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate,
    clipRequestId: "B002/AR001", saveFeedback: true });
  assert.deepEqual(clip.inspectedBeatIds, ["B002"], "单图预览不处理其它成员");
  const clipFeedback = await readFeedback(["B002"], clip.feedbackPath);
  assert.ok(clipFeedback.beats[0].realImages.file.endsWith("motion.mp4"));
  const clipAudio = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
    "-of", "json", path.resolve(workspaceRoot, clipFeedback.beats[0].realImages.file)], { encoding: "utf8" }));
  assert.equal(clipAudio.streams.length, 1, "动态预演保留原P2音轨");
  const cliFeedback = JSON.parse(execFileSync(process.execPath, [path.join(root, "packages/templates/fullframe-narrative/inspect-design.mjs"),
    work.workOrder, work.candidate, "--read-feedback", clip.feedbackPath, "--beat", "B002"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  assert.deepEqual(cliFeedback, clipFeedback);
  bad.result.items[2].treatment.assetRequests[0].sourceRefs = ["C001"];
  const beforeFailure = await readFile(paths.storyboard);
  await write(work.candidate, bad);
  const partial = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate, beatIds: ["B001"] });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.inspectedBeatIds, ["B001", "B002"]);
  await assert.rejects(preflightAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate }), /范围外/);
  assert.deepEqual(await readFile(paths.storyboard), beforeFailure);
  await write(work.candidate, valid);
  assert.equal((await submitAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate, workspace: workspaceRoot, episode: "ep01" })).preflight.ok, true);
  await acceptCandidate({ ...options, segmentId: "TR001" });
  const original = await readData(paths.storyboard);
  assert.equal(original.templateRuns[0].treatment, null);
  assert.equal(authorUnitsForStoryboard(original).length, 4);
  assert.deepEqual(Object.keys(original.features["cue-sync"].bindings), ["B001", "B002", "B003", "B004"]);
  const cues = task.inputs.templateContext.episodeContext.cues;
  assert.equal((await collectAuthoredMedia({ storyboard: original, cues, bodyDurationMs: 24000 })).items.length, 4);
  await runNext({ ...options, redesignBody: true, redesignBeatIds: ["B003"], revisionReason: "只调整第三Beat速度" });
  const revision = await readData(work.workOrder);
  assert.equal(revision.inputs.authorBatch, undefined);
  assert.equal(revision.inputs.templateContext.paragraph.acceptedMembers.length, 4);
  const refreshed = structuredClone(revision);
  refreshed.inputs.templateContext.paragraph.acceptedMembers[0].treatment.assetRequests[0].purpose = "更新的只读参考";
  assert.doesNotThrow(() => assertTaskContinuity(revision, refreshed));
  const revisedResult = { treatment: withoutProducer(original.beats[2].treatment), featureResults: {
    "cue-sync": withoutProducer(original.features["cue-sync"].bindings.B003),
    "sound-effects": withoutProducer(original.features["sound-effects"].units.B003) } };
  revisedResult.treatment.assetRequests[0].motion.speedRatio = 1.2;
  await write(work.candidate, { taskDigest: revision.taskDigest, result: revisedResult });
  assert.deepEqual(images("prepare", work.workOrder, work.candidate), []);
  const revisionFeedback = await inspectFullframeDesign({ workOrderPath: work.workOrder, candidatePath: work.candidate, saveFeedback: true });
  assert.equal((await readFeedback([], revisionFeedback.feedbackPath)).ok, true);
  assert.ok(revision.inputs.previousCameraStateSha256);
  const changedPrevious = structuredClone(original);
  changedPrevious.beats[1].treatment.assetRequests[0].motion.speedRatio = 1.1;
  await write(paths.storyboard, changedPrevious);
  await assert.rejects(readFeedback([], revisionFeedback.feedbackPath), /当前工作单.*不一致/);
  await write(paths.storyboard, original);
  assert.equal((await readFeedback([], revisionFeedback.feedbackPath)).ok, true);
  await lockFullframeCallouts({ workOrderPath: work.workOrder, candidatePath: work.candidate });
  await submitAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate, workspace: workspaceRoot, episode: "ep01" });
  await acceptCandidate({ ...options, segmentId: "TR001" });
  const updated = await readData(paths.storyboard);
  for (const index of [0, 1, 3]) assert.deepEqual(updated.beats[index], original.beats[index]);
  assert.deepEqual(updated.beats.map(beat => beat.treatment.assetRequests[0].asset), original.beats.map(beat => beat.treatment.assetRequests[0].asset));
  for (const id of ["B001", "B002", "B004"]) assert.deepEqual(updated.features["cue-sync"].bindings[id], original.features["cue-sync"].bindings[id]);
});

test("分组不使全画幅失效，渲染及视频仍消费独立Beat，地图讲解保留整段", () => {
  const beats = [1, 2, 3, 4].map(id => ({ ...direction(id), treatment: resultFor(id).treatment }));
  const base = { albumPlan: { recurringElements: [] }, beats, templateRuns: [] };
  const grouped = { ...base, templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: beats.map(beat => beat.id), treatment: null }] };
  assert.deepEqual(changedDirectorBeatIds(base, grouped), []);
  assert.deepEqual(bodySegmentDescriptorsFor(grouped), bodySegmentDescriptorsFor(base));
  assert.deepEqual(projectRenderStoryboard(grouped), projectRenderStoryboard(base));
  const opener = { templateId: "episode-opener", flashbackShots: [{ bodyRefs: ["B003"] }] };
  const openerInputs = bodyStoryboard => projectAcceptedOpenerBodyDependencies({ bodyStoryboard, result: opener });
  assert.deepEqual(openerInputs(grouped), openerInputs(base));
  const cues = [1, 2, 3, 4].map(id => ({ id, text: "来客等候。", startMs: (id - 1) * 6000, endMs: id * 6000 }));
  const span = { id: "V001", beatIds: ["B001"], firstFramePrompt: "来客等候", shots: [{ id: "S01", durationMs: 6000 }], parts: [{ shotIds: ["S01"], videoPrompt: "来客等候" }] };
  assert.deepEqual(videoWindow({ span, storyboard: grouped, cues }), videoWindow({ span, storyboard: base, cues }));
  for (const [index, templateId] of [[1, "vox-explainer"], [3, "vox-explainer"]]) {
    beats[index].templateId = templateId; beats[index].treatment = null;
  }
  const mixed = { beats, templateRuns: beats.map((beat, index) => ({ id: `TR00${index + 1}`, templateId: beat.templateId, beatIds: [beat.id],
    treatment: beat.templateId === "fullframe-narrative" ? null : { templateId: beat.templateId } })) };
  assert.deepEqual(bodySegmentDescriptorsFor(mixed).map(segment => segment.id), ["B001", "TR002", "B003", "TR004"]);
});

test("相邻物理参考不消费速度，严格相机接续仍消费真实末态", () => {
  const previous = resultFor(1).treatment, revised = structuredClone(previous);
  revised.assetRequests[0].motion.speedRatio = 2;
  const next = { continuity: { continuesPreviousScene: true }, assetRequests: [{ cameraRelation: "reset" }] };
  const inputs = value => authorPreviousTreatmentProducerInputsForResult({ result: next, previousTreatmentInput: projectAdjacentTreatment(value) });
  assert.deepEqual(inputs(previous), inputs(revised));
  next.assetRequests[0].cameraRelation = "continue";
  const camera = value => authorPreviousTreatmentProducerInputsForResult({ result: next, previousTreatmentInput: {
    ...projectAdjacentTreatment(value), exitFrameId: "A", cameraState: { actualEnd: value.assetRequests[0].motion.speedRatio } } });
  assert.notDeepEqual(camera(previous), camera(revised));
});

test("全画幅局部拆Beat可保留段内其它成员，讲解共享组仍须完整授权", () => {
  const base = { albumPlan: { intent: "等待", openingState: "到来", progression: "观察", endingState: "等待", recurringElements: [] },
    beats: [1, 2, 3, 4].map(id => { const { treatment, ...beat } = direction(id); return beat; }),
    templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002", "B003", "B004"] }] };
  base.beats[2].cueRange = [3, 4]; base.beats[3].cueRange = [5, 5];
  const context = { templates: ["fullframe-narrative", "vox-explainer"],
    cues: [1, 2, 3, 4, 5].map(id => ({ id })), currentVisualPlan: base,
    returnRequest: { revisionScope: "director-revision", selectedBeatIds: ["B003"], cueRefs: [3, 4], baselineVisualPlanSha256: hashObject(base) } };
  const split = structuredClone(base);
  split.beats[2].cueRange = [3, 3];
  split.beats.splice(3, 0, { ...structuredClone(split.beats[2]), id: "B005", cueRange: [4, 4] });
  split.templateRuns[0].beatIds.splice(3, 0, "B005");
  assert.deepEqual(validateDirector({ result: split, context }), []);
  base.templateRuns[0].templateId = split.templateRuns[0].templateId = "vox-explainer";
  for (const result of [base, split]) for (const beat of result.beats) beat.templateId = "vox-explainer";
  context.returnRequest.baselineVisualPlanSha256 = hashObject(base);
  assert.ok(validateDirector({ result: split, context }).some(error => error.includes("全部受影响页面")));
});
