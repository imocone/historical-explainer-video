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
import { projectAdjacentTreatment, readPreviousTreatment, refreshAuthorReferences } from "../packages/templates/fullframe-narrative/context-runtime.mjs";
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

test("导演枚举全画幅内部切点与实际交接，跳过讲解章内切点", () => {
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
    workOrder: { inputs: { cues } }, candidate: { result: { beats, templateRuns: [
      {id: "TR002", templateId: "vox-explainer", beatIds: ["B002", "B003"]}
    ] } }
  });
  assert.equal(inspection.summary.cueCount, 10);
  assert.deepEqual(inspection.beatIndex.map(({ id, cueRange }) => ({ id, cueRange })),
    beats.map(({ id, cueRange }) => ({ id, cueRange })));
  assert.deepEqual(inspection.internalBoundaries.map(item => item.boundary), ["1/2", "9/10"]);
  assert.deepEqual(inspection.betweenBeatBoundaries.map(item => [item.leftCueRange, item.rightCueRange]),
    [[[1, 2], [3, 5]], [[6, 8], [9, 10]]]);
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
    allowedWrite: "ep01/制作/p3/storyboard.yaml", allowedReturnTargets: [],
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
  const musicRoot = path.join(root,'local-media/background-music');
  await mkdir(musicRoot,{recursive:true});
  const musicDirectory = await mkdtemp(path.join(musicRoot,'.fullframe-test-'));
  t.after(()=>rm(musicDirectory,{recursive:true,force:true}));
  const musicFile = path.join(musicDirectory,'score.wav');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=f=217:r=48000:d=0.4',
    '-af','adelay=7550,apad','-t','18',musicFile]);
  for (const [key,value] of Object.entries({BACKGROUND_MUSIC_FILE:musicFile,
    BACKGROUND_MUSIC_SOURCE:'全画幅预演测试音',BACKGROUND_MUSIC_RIGHTS:'public-domain'})) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(()=>{if (previous === undefined) delete process.env[key]; else process.env[key] = previous;});
  }
  const paths=getEpisodePaths(workspaceRoot,'ep01');
  const visual=await readData(path.join(root,'visuals/wet-watercolor/visual-package.json'));
  const image=path.join(root,'visuals/wet-watercolor',visual.masterReference.path);
  await write(getProgramPaths(workspaceRoot).programPlan,{programForm:'historical-explainer',openerTemplate:'episode-opener',
    visualPackage:{visualPackageId:visual.id,version:visual.version}});
  const narration='来客在院门前等待。\n院门仍然关着。\n里面传来木门的声音。';
  const subtitles='1\n00:00:00,000 --> 00:00:06,000\n来客在院门前等待。\n\n2\n00:00:06,000 --> 00:00:12,000\n院门仍然关着。\n\n3\n00:00:12,000 --> 00:00:18,000\n里面传来木门的声音。\n';
  await write(paths.narrationText,narration);await write(paths.narrationSubtitles,subtitles);
  const narrationFile=path.join(paths.p2,'narration.wav');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','18',narrationFile]);
  await write(paths.narrationPackage,{episodeId:'ep01',durationMs:18000,files:{
    narration:{path:'narration.txt',sha256:sha256(narration)},subtitles:{path:'narration.srt',sha256:sha256(subtitles)},
    audio:{path:'narration.wav',sha256:sha256(await readFile(narrationFile))}}});
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:[]});
  await write(paths.storyboard,{understanding:{episodeQuestion:'等待会怎样？',thesis:'等待尚无回应',
    narrativeArc:{start:'等待',turn:'继续等待',end:'未被回应'},facts:[],relations:[],evidence:[],uncertainties:[],mustNotInvent:['不添加身份'],
    semanticReading:{underlyingMeaning:'等待',audienceStartingPoint:'尚未了解',targetUnderstanding:'体会等待',speakerStances:[],contextConstraints:[],rhetoricalReadings:[],humanStakes:[]}},
    albumPlan:{intent:'体会等待',openingState:'来客等候',progression:'观察等待',endingState:'未被回应',recurringElements:[]},
    beats:[1,2,3].map(direction),templateRuns:[{id:'TR001',templateId:'fullframe-narrative',beatIds:['B001','B002','B003'],treatment:null}],
    features:{'cue-sync':{bindings:{}},'sound-effects':{units:{}}}});
  const options={root,workspaceRoot,episodeId:'ep01',stageId:'p3',segmentId:'TR001'};
  await runNext(options);
  const work=getStageWorkPaths(paths,'p3','TR001'),task=await readData(work.workOrder);
  assert.equal(task.inputs.authorBatch.members.length,3);
  const {taskDigest:signature,...signed}=task;
  assert.equal(task.moduleId,'author-beat');
  assert.equal(hashObject(signed),signature,'原工作单签名完整');
  const view = JSON.parse(execFileSync(process.execPath, [path.join(root, 'packages/p3-task-view.mjs'), work.workOrder],
    {encoding:'utf8', maxBuffer:4*1024*1024}));
  const authorVisual = view.inputs.templateContext.visual;
  const visualSlot = task.resolvedAssembly.slots.find(slot => slot.id === 'visual');
  const fullframeProfile = visualSlot.implementations[0].resources
    .find(resource => resource.role === 'productionProfiles').content['fullframe-image'];
  assert.equal(authorVisual.stylePrompt, fullframeProfile.stylePrompt, '写图纸前投递所选正文画法');
  assert.deepEqual(authorVisual.references,
    fullframeProfile.references.map(({id, absolutePath, styleScopes}) => ({id, absolutePath, styleScopes})),
    '写图纸前可打开所选画法参考原图');
  const items=[1,2,3].map(id=>({beatId:`B00${id}`,...resultFor(id)}));
  await write(work.candidate,{taskDigest:task.taskDigest,result:{items}});
  const images=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(root,'packages/authored-images.mjs'),...args],
    {encoding:'utf8',maxBuffer:4*1024*1024}));
  for (const item of items) {
    const [{job}] = images('begin', work.workOrder, work.candidate, `${item.beatId}/AR001`);
    assert.ok(job.prompt.startsWith(authorVisual.stylePrompt + '\n\n'), '生图沿用作者设计时读取的画法');
    assert.match(authorVisual.stylePrompt, /整幅白平衡、冷暖、浓淡和明暗层次由本视觉包确定/u);
    assert.match(job.prompt, /【场面图纸】[^\n]+整体用色、明暗处理、材质表现和笔触按上方视觉包执行/u);
    assert.ok(job.prompt.includes('\n\n' + item.treatment.assetRequests[0].sceneDescription + '\n\n'), '原样交付场面图纸');
    assert.deepEqual(job.referenced_image_paths, authorVisual.references.map(reference => reference.absolutePath));
    images('import', work.workOrder, work.candidate, `${item.beatId}/AR001`, image);
  }
  await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const ready=await readData(work.candidate),pictures=ready.result.items.map(item=>structuredClone(item.treatment));
  await assert.rejects(preflightAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate}),/已启用功能缺少候选结果: sound-effects/);
  const {generateSound}=await import('../packages/features/sound-effects/generate.mjs');
  const recipe=path.join(workspaceRoot,task.scratchPath,'recording.json');
  const shore = {generator:'recording',parameters:{name:'shore-lap',startSeconds:.3,endSeconds:2.4}};
  await write(recipe,{syncSeconds:0,layers:[shore]});
  const originalShore = await generateSound({workOrderPath:work.workOrder,recipePath:recipe});
  await write(recipe,{syncSeconds:0,layers:[{...shore,effects:[{type:'occlusion',parameters:{
    atSeconds:.65,durationSeconds:.16,frequency:1250,gain:.55
  }}]}]});
  const asset=await generateSound({workOrderPath:work.workOrder,recipePath:recipe});
  assert.equal(asset.durationSeconds,2.1);
  const excerpt = (recording, start, duration, filters = []) => execFileSync('ffmpeg', ['-v','error',
    '-ss',String(start),'-i',path.join(workspaceRoot,recording.file),'-t',String(duration),...filters,'-f','s16le','-']);
  const energy = buffer => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 2) sum += buffer.readInt16LE(i) ** 2;
    return sum;
  };
  assert.deepEqual(excerpt(asset,.12,.35),excerpt(originalShore,.12,.35),'遮挡发生前仍是同一段原声');
  const tailGain = filters => energy(excerpt(asset,.95,.5,filters)) / energy(excerpt(originalShore,.95,.5,filters));
  const fullBand = tailGain([]), highBand = tailGain(['-af','highpass=f=2200']);
  assert.ok(fullBand > 0 && fullBand < .4 && highBand < fullBand * .5,'遮挡后保留同一余声并显著收敛高频');
  ready.result.items[0].featureResults['sound-effects']={events:[{id:'S001',purpose:'测试前一镜声音自然延续',
    asset,anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:5.35}}]};
  ready.result.items[1].featureResults['sound-effects']={events:[]};
  await write(recipe,{syncSeconds:.8,layers:[{generator:'recording',parameters:{name:'heavy-wood-door'}}]});
  const door=await generateSound({workOrderPath:work.workOrder,recipePath:recipe});
  ready.result.items[2].featureResults['sound-effects']={events:[{id:'S001',purpose:'测试后一镜声音先入',
    asset:door,anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:0}}]};
  await write(work.candidate,ready);
  const preview=await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate,clipRequestId:'B002/AR001'});
  const media=preview.beats[0].realImages.file;
  const audio=(from,duration)=>execFileSync('ffmpeg',['-v','error','-ss',String(from),'-i',media,
    '-t',String(duration),'-vn','-f','s16le','-']);
  const tail=audio(.4,.7), music=audio(2.55,.2), quiet=audio(3.4,.4), lead=audio(6.1,.6);
  const peak=buffer=>{let result=0;for(let i=0;i<buffer.length;i+=2) result=Math.max(result,Math.abs(buffer.readInt16LE(i)));return result;};
  assert.ok(peak(tail)>100,'尚未接纳的B001实录确实进入B002预览');
  assert.ok(peak(music)>100,'B002动态预览从系统目录读取并播放本机默认音乐');
  assert.ok(peak(quiet)<5,'B001声音结束后保留B002的留白');
  assert.ok(peak(lead)>100,'尚未接纳的B003实录先于切换进入B002预览');
  await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,workspace:workspaceRoot,episode:'ep01'});
  await acceptCandidate(options);
  const saved=await readData(paths.storyboard);
  assert.deepEqual(Object.keys(saved.features['sound-effects'].units).sort(),['B001','B002','B003']);
  for(const [index,item]of ready.result.items.entries()){
    assert.deepEqual(saved.features['sound-effects'].units[item.beatId].events,item.featureResults['sound-effects'].events);
    assert.deepEqual(withoutProducer(saved.beats[index].treatment),pictures[index]);
  }
});

test("四Beat联合设计、图片与接纳，独立选速及改取景保留其它成果与全部原图", async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fullframe-paragraph-test-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const paths = getEpisodePaths(workspaceRoot, "ep01");
  let work = getStageWorkPaths(paths, "p3");
  const visual = await readData(path.join(root, "visuals/wet-watercolor/visual-package.json"));
  const image = path.join(root, "visuals/wet-watercolor", visual.masterReference.path);
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
  const result = { understanding: initial.understanding, albumPlan: initial.albumPlan,
    beats: initial.beats.map(({ treatment, ...beat }, index) => ({
      ...beat,
      directorBrief: { ...beat.directorBrief, entryFocus: "来客", reveal: "院门没有打开", exitHold: "无人回应" },
      incomingTransition: resultFor(index + 1).treatment.incomingTransition
    })),
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
  assert.deepEqual(task.inputs.authorBatch.members.map(member => member.inputs.templateContext.directedTransition),
    result.beats.map(beat => beat.incomingTransition), "分镜接法原样进入新作者单");
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
  const stale=structuredClone(task);
  for(const inputs of [stale.inputs,...stale.inputs.authorBatch.members.map(member=>member.inputs)]) {
    inputs.templateContext.motionBudgets={speedRange:{maximumRatio:999},options:[]};
  }
  const staleBefore=structuredClone(stale);
  const renewedReferences=await refreshAuthorReferences({workOrder:stale,workOrderPath:work.workOrder});
  for(const inputs of [renewedReferences,...renewedReferences.authorBatch.members.map(member=>member.inputs)]) {
    assert.equal(inputs.templateContext.motionBudgets.speedRange.maximumRatio,3);
    assert.equal(inputs.templateContext.motionBudgets.maximumRenderScale,1.5);
    const frame=inputs.templateContext.motionBudgets.options[0].frames[0];
    assert.ok(frame.runtimeTravelRange.zoom.maximum>frame.runtimeTravelRange.zoom.minimum);
    assert.equal(Object.hasOwn(frame,"speedRatio"),false,"恢复视图不把最低速预填为作者选择");
  }
  assert.deepEqual(stale,staleBefore,"现行预算投递不改原单、候选或成员输入");
  const candidate = { taskDigest: task.taskDigest, result: { items: [1, 2, 3, 4].map(id => ({ beatId: `B00${id}`, ...resultFor(id) })) } };
  // Explicit author choices exercise selection preservation, not a creative quota.
  const selectedRatios=[1.25,1.45,1.31,1.6];
  for(const [i,item] of candidate.result.items.entries()) item.treatment.assetRequests[0].motion.speedRatio=selectedRatios[i];
  candidate.result.items[2].treatment.assetRequests[0].motion.speedChanges=[{timeMs:2000,speedRatio:1.55},{timeMs:4000,speedRatio:1.18}];
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
  assert.deepEqual(measured.result.items.map(item=>item.treatment.assetRequests[0].motion.speedRatio),selectedRatios,
    "测量不把作者选择归一成最低速");
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
  failedCandidate.result.items[3].treatment.assetRequests[0].motion.speedRatio = 3;
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
    clipRequestId: "B004/AR001", saveFeedback: true });
  assert.deepEqual(clip.inspectedBeatIds, ["B004"], "单图预览不处理其它成员");
  const clipFeedback = await readFeedback(["B004"], clip.feedbackPath);
  assert.ok(clipFeedback.beats[0].realImages.file.endsWith("motion.mp4"));
  const clipAudio = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
    "-of", "json", path.resolve(workspaceRoot, clipFeedback.beats[0].realImages.file)], { encoding: "utf8" }));
  assert.equal(clipAudio.streams.length, 1, "动态预演保留原P2音轨");
  const cliFeedback = JSON.parse(execFileSync(process.execPath, [path.join(root, "packages/templates/fullframe-narrative/inspect-design.mjs"),
    work.workOrder, work.candidate, "--read-feedback", clip.feedbackPath, "--beat", "B004"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
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
  assert.deepEqual(original.beats.map(beat => beat.treatment.incomingTransition),
    result.beats.map(beat => beat.incomingTransition), "已接纳的全画幅保留分镜接法");
  assert.deepEqual(original.beats.map(beat=>beat.treatment.assetRequests[0].motion.speedRatio),selectedRatios,
    "正式接纳原样保留各镜头选速");
  assert.deepEqual(original.beats[2].treatment.assetRequests[0].motion.speedChanges,
    [{timeMs:2000,speedRatio:1.55},{timeMs:4000,speedRatio:1.18}],"正式接纳原样保留作者变速");
  assert.equal(original.templateRuns[0].treatment, null);
  assert.equal(authorUnitsForStoryboard(original).length, 4);
  assert.deepEqual(Object.keys(original.features["cue-sync"].bindings), ["B001", "B002", "B003", "B004"]);
  const cues = task.inputs.templateContext.episodeContext.cues;
  assert.equal((await collectAuthoredMedia({ storyboard: original, cues, bodyDurationMs: 24000 })).items.length, 4);
  await runNext({ ...options, redesignBody: true, redesignBeatIds: ["B003"], revisionReason: "调整第三Beat速度与取景，保留原图和时长" });
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
  const motion = revisedResult.treatment.assetRequests[0].motion;
  motion.semanticEndViewport = {x:.15,y:.1,width:.7,height:.7};
  motion.safeEndViewport = {...motion.semanticEndViewport};
  await write(work.candidate, { taskDigest: revision.taskDigest, result: revisedResult });
  assert.deepEqual(images("prepare", work.workOrder, work.candidate), [],"已有图调整取景与速度不触发生图");
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
  assert.deepEqual(updated.beats.map(beat=>beat.cueRange),original.beats.map(beat=>beat.cueRange),"运镜修正不移动Beat或换图边界");
  for (const index of [0, 1, 3]) assert.deepEqual(updated.beats[index], original.beats[index]);
  assert.deepEqual(updated.beats.map(beat => beat.treatment.assetRequests[0].asset), original.beats.map(beat => beat.treatment.assetRequests[0].asset));
  for (const id of ["B001", "B002", "B004"]) assert.deepEqual(updated.features["cue-sync"].bindings[id], original.features["cue-sync"].bindings[id]);

  // Repairing a formerly accepted short route must not execute that old route
  // again before accepting the valid replacement and updating its consumer.
  const staleHandoff = structuredClone(updated);
  const oldMotion = staleHandoff.beats[2].treatment.assetRequests[0].motion;
  oldMotion.semanticEndViewport = {x:.02,y:.02,width:.95,height:.95};
  oldMotion.safeEndViewport = {...oldMotion.semanticEndViewport};
  delete oldMotion.speedChanges;
  staleHandoff.beats[2].treatment._producer.outputSha256 = hashObject(withoutProducer(staleHandoff.beats[2].treatment));
  staleHandoff.beats[3].treatment.assetRequests[0].cameraRelation = "visual-match";
  staleHandoff.beats[3].treatment._producer.outputSha256 = hashObject(withoutProducer(staleHandoff.beats[3].treatment));
  await write(paths.storyboard, staleHandoff);
  await runNext({...options,redesignBody:true,redesignBeatIds:["B003"],revisionReason:"只补足原图运镜，更新必要接镜"});
  const repair = await readData(work.workOrder);
  const restoredRoute = {treatment:withoutProducer(updated.beats[2].treatment),featureResults:{
    "cue-sync":withoutProducer(updated.features["cue-sync"].bindings.B003),
    "sound-effects":withoutProducer(updated.features["sound-effects"].units.B003)}};
  await write(work.candidate,{taskDigest:repair.taskDigest,result:restoredRoute});
  assert.equal((await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate})).ok,true);
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,workspace:workspaceRoot,episode:"ep01"});
  await acceptCandidate({...options,segmentId:"TR001"});
  const repaired = await readData(paths.storyboard);
  assert.deepEqual(withoutProducer(repaired.beats[2].treatment),restoredRoute.treatment);
  assert.deepEqual(repaired.beats.map(beat=>beat.treatment.assetRequests[0].asset),updated.beats.map(beat=>beat.treatment.assetRequests[0].asset));
  const handoffRequest = await readData(getStageWorkPaths(paths,"p3").returnRequest("author"));
  assert.deepEqual(handoffRequest.pendingAuthorUnitIds,["B004"]);
  assert.equal((await runNext({...options,segmentId:"TR001"})).taskId,"ep01/B004/author");
  const consumer = await readData(work.workOrder);
  assert.ok(consumer.inputs.previousCameraStateSha256);
  assert.ok((await readPreviousTreatment({workspaceRoot,task:consumer})).cameraState);
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
  const understanding = {episodeQuestion: "为何等待？", thesis: "门尚未打开", narrativeArc: {start: "到来", turn: "停步", end: "等待"},
    facts: [], relations: [], evidence: [], uncertainties: [], mustNotInvent: [],
    semanticReading: {underlyingMeaning: "观察等待", audienceStartingPoint: "未见院门", targetUnderstanding: "门闭着",
      speakerStances: [], contextConstraints: [], rhetoricalReadings: [], humanStakes: []}};
  const base = { understanding, albumPlan: { intent: "等待", openingState: "到来", progression: "观察", endingState: "等待", recurringElements: [] },
    beats: [1, 2, 3, 4].map(id => {
      const { treatment, ...beat } = direction(id);
      return { ...beat,
        directorBrief: { ...beat.directorBrief, entryFocus: "院门", reveal: "门闭着", exitHold: "等人开门" },
        incomingTransition: resultFor(id).treatment.incomingTransition
      };
    }),
    templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B002", "B003", "B004"] }] };
  base.beats[2].cueRange = [3, 4]; base.beats[3].cueRange = [5, 5];
  const context = { templates: ["fullframe-narrative", "vox-explainer"],
    cues: [1, 2, 3, 4, 5].map(id => ({ id, text: "继续观察。", startMs: (id - 1) * 5000, endMs: id * 5000 })), currentVisualPlan: base,
    returnRequest: { revisionScope: "director-revision", selectedBeatIds: ["B003"], cueRefs: [3, 4], baselineVisualPlanSha256: hashObject(base) } };
  const split = structuredClone(base);
  split.beats[2].cueRange = [3, 3];
  split.beats.splice(3, 0, { ...structuredClone(split.beats[2]), id: "B005", cueRange: [4, 4] });
  split.templateRuns[0].beatIds.splice(3, 0, "B005");
  assert.deepEqual(validateDirector({ result: split, context }), []);
  const noTransition = structuredClone(split);
  noTransition.beats[3].incomingTransition = null;
  assert.match(validateDirector({ result: noTransition, context }).join("\n"), /beats\[3\] 相邻全画幅必须交付叠化或闪黑/);
  base.templateRuns[0].templateId = split.templateRuns[0].templateId = "vox-explainer";
  for (const result of [base, split]) for (const beat of result.beats) {
    beat.templateId = "vox-explainer";
    delete beat.incomingTransition;
  }
  context.returnRequest.baselineVisualPlanSha256 = hashObject(base);
  assert.deepEqual(validateDirector({ result: base, context }), []);
  assert.ok(validateDirector({ result: split, context }).some(error => error.includes("新划讲解章只交接一条")));
  const detached = structuredClone(base);
  detached.templateRuns = base.beats.map((beat, index) => ({
    id: `TR00${index + 1}`, templateId: "vox-explainer", beatIds: [beat.id]
  }));
  assert.ok(validateDirector({ result: detached, context }).some(error => error.includes("全部受影响页面")));
});
