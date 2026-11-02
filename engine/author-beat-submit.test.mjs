import {imageProfileFor} from '../packages/templates/vox-explainer/image-style.mjs';
import {createAppearance, SURFACE_PALETTE} from '../packages/templates/vox-explainer/appearance.mjs';
import {refreshAuthorReferences, projectSpeechTiming} from '../packages/templates/vox-explainer/author-context.mjs';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {acceptCandidate, readData, runNext, sha256} from './runtime.mjs';
import {getEpisodePaths, getProgramPaths, getStageWorkPaths} from '../packages/workspace-paths.mjs';
import {submitAuthorCandidate} from '../packages/modules/author-beat/submit.mjs';
import {createRenderPolicy,renderData,authoredAssetsForTreatment} from '../packages/templates/vox-explainer/render-plan.mjs';
import {resolveCueBindingsToFrames} from '../packages/cue-boundaries.mjs';
import {assertTaskContinuity} from './runtime/tasks.mjs';

test('vox defaults may refresh without changing the current author task', () => {
  const saved = {stageId:'p3', moduleId:'author-beat', resolvedAssembly:{slots:[]}, inputs:{
    authorUnit:{id:'TR001', templateId:'vox-explainer'}, cues:[{id:1, text:'比较两条线路'}],
    templateContext:{appearance:createAppearance(), renderContext:{palette:{background:'#FFFAF0'}, subtitle:{outline:2}, width:1920}}
  }};
  const current = structuredClone(saved);
  current.inputs.templateContext.appearance.palette.background = '#173E45';
  current.inputs.templateContext.appearance.fonts.title.family = 'updated-title';
  current.inputs.templateContext.renderContext.palette.background = '#173E45';
  current.inputs.templateContext.renderContext.subtitle.outline = 4;
  assert.doesNotThrow(() => assertTaskContinuity(saved, current));
  current.inputs.templateContext.renderContext.width = 1280;
  assert.throws(() => assertTaskContinuity(saved, current), /inputs/);
  current.inputs.templateContext.renderContext.width = 1920;
  current.inputs.cues[0].text = '比较三个仓库';
  assert.throws(() => assertTaskContinuity(saved, current), /inputs/);
  current.inputs.cues = structuredClone(saved.inputs.cues);
  saved.inputs.currentTreatment = {appearance:createAppearance()};
  current.inputs.currentTreatment = structuredClone(saved.inputs.currentTreatment);
  current.inputs.templateContext.appearance = structuredClone(saved.inputs.templateContext.appearance);
  current.inputs.templateContext.renderContext.palette = structuredClone(saved.inputs.templateContext.renderContext.palette);
  assert.doesNotThrow(() => assertTaskContinuity(saved, current), '已有作品也可更新派生字幕样式');
  current.inputs.currentTreatment.appearance.art = 'ink-brush';
  assert.throws(() => assertTaskContinuity(saved, current), /inputs/);
});

const root = fileURLToPath(new URL('..', import.meta.url));
const write = async (file, value) => {
  await mkdir(path.dirname(file), {recursive:true});
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const vox = cueId => ({templateId:'vox-explainer', appearance:createAppearance({palette:{
  background:'#ffffff',ink:'#202020',paper:'#f0f0f0',accent:'#c83c32',secondary:'#3268c8'}}), objective:'比较同一对象的状态',
  continuity:{period:'测试时期', location:'测试现场', subjects:[], props:[], carryToNext:{subjects:[], props:[]}},
  assetRequests:[], moments:[{id:'M001', purpose:'读状态', sourceRefs:[`C${String(cueId).padStart(3,'0')}`]}],
  scene:{markup:'<div id="state">状态</div>',animation:"timeline.from(select('#state'), {opacity:0,duration:.4},cue('M001'));"}});
const cueResult = cueId => ({items:[{target:'M001', action:'advance-explainer', cueId, edge:'start'}]});

const setup = async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'partial-body-redesign-'));
  t.after(() => rm(workspaceRoot, {recursive:true, force:true}));
  const options = {root, workspaceRoot, episodeId:'ep01', stageId:'p3'};
  const paths = getEpisodePaths(workspaceRoot, 'ep01'), work = getStageWorkPaths(paths, 'p3', 'TR001');
  const visual = await readData(path.join(root, 'visuals/meiji-state-machine/visual-package.json'));
  await write(getProgramPaths(workspaceRoot).programPlan, {programForm:'historical-explainer',
    openerTemplate:'episode-opener', visualPackage:{visualPackageId:visual.id, version:visual.version}});
  const narration = '状态变化。\n观察现场。\n继续观察。\n区分结果。';
  const subtitles = [1,2,3,4].map((id,i) => `${id}\n00:00:${String(i*6).padStart(2,'0')},000 --> 00:00:${String((i+1)*6).padStart(2,'0')},000\n${narration.split('\n')[i]}\n`).join('\n');
  await write(paths.narrationText, narration);
  await write(paths.narrationSubtitles, subtitles);
  const audio = Buffer.alloc(44 + 24000 * 8 * 2);
  audio.write('RIFF',0); audio.writeUInt32LE(audio.length-8,4); audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16); audio.writeUInt16LE(1,20); audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(8000,24); audio.writeUInt32LE(16000,28);
  audio.writeUInt16LE(2,32); audio.writeUInt16LE(16,34);
  audio.write('data',36); audio.writeUInt32LE(audio.length-44,40);
  await writeFile(path.join(paths.p2,'narration.wav'),audio);
  await write(paths.narrationPackage, {episodeId:'ep01', durationMs:24000, files:{
    narration:{path:'narration.txt', sha256:sha256(narration)},
    audio:{path:'narration.wav',sha256:sha256(audio)},
    subtitles:{path:'narration.srt', sha256:sha256(subtitles)}
  }});
  await write(paths.sourceAssets, {schemaVersion:'1.0', assets:[]});
  const beats = [1,2,3,4].map(id => ({id:`B00${id}`, cueRange:[id,id],
    templateId:id === 1 || id === 4 ? 'vox-explainer' : 'fullframe-narrative',
    viewerOutcome:'理解状态', directorBrief:{roleInAlbum:'推进观察', mustShow:'状态的区别', relationFromPrevious:null}}));
  await write(paths.storyboard, {episodeId:'ep01', understanding:{episodeQuestion:'如何区分状态？', thesis:'观察再区分',
    narrativeArc:{start:'开始观察', turn:'发现变化', end:'理解区别'}, facts:[], relations:[], evidence:[], uncertainties:[],
    mustNotInvent:['不增加数量'], semanticReading:{underlyingMeaning:'区分观察与结果', audienceStartingPoint:'尚未区分',
      targetUnderstanding:'理解区别', speakerStances:[], contextConstraints:[], rhetoricalReadings:[], humanStakes:[]}},
    albumPlan:{intent:'理解状态', openingState:'开始观察', progression:'区分状态', endingState:'理解区别', recurringElements:[]},
    beats, templateRuns:[{id:'TR001', templateId:'vox-explainer', beatIds:['B001'], treatment:vox(1)},
      {id:'TR002', templateId:'fullframe-narrative', beatIds:['B002','B003']},
      {id:'TR003', templateId:'vox-explainer', beatIds:['B004']}],
    features:{'cue-sync':{bindings:{TR001:cueResult(1)}}}});
  return {options, paths, work};
};

test('Lemo音效沿原作者工作单交付，未知动作在提交前返回，接纳保留画面和独立声音结果', async t => {
  const {options, paths, work} = await setup(t);
  const story = await readData(paths.storyboard);
  story.features['sound-effects'] = {units: {}};
  story.features['background-music'] = {enabled:false};
  story.templateRuns[0].treatment = null;
  await write(paths.storyboard, story);
  await runNext({...options, segmentId:'TR001'});
  const order = await readData(work.workOrder);
  assert.deepEqual(order.inputs.featureContexts['sound-effects'].music,{enabled:false});
  assert.ok(order.resolvedAssembly.slots.flatMap(slot => slot.implementations)
    .some(item => item.packageId === 'sound-effects' && item.resources.some(resource => resource.role === 'authorRules')));
  const treatment = vox(1);
  treatment.scene.events = [{id:'E001',target:'M001',offsetSeconds:.8}];
  treatment.scene.animation = "timeline.from(select('#state'),{opacity:0,duration:.4},eventTime('E001')-.4);";
  const result = {treatment, featureResults: {'cue-sync': cueResult(1), 'sound-effects': {events: [
    {id:'S001', purpose:'状态显露时点缀', soundId:'paper', eventId:'E999', gain:.5}
  ]}}};
  await write(work.candidate, {taskDigest: order.taskDigest, result});
  await assert.rejects(submitAuthorCandidate({workOrderPath:work.workOrder, candidatePath:work.candidate,
    workspace:options.workspaceRoot, episode:'ep01'}), /找不到画面事件/u);
  result.featureResults['sound-effects'].events[0].eventId = 'E001';
  await write(work.candidate, {taskDigest: order.taskDigest, result});
  const {preview} = await import('../packages/templates/vox-explainer/preview.mjs');
  const previewed = await preview({workOrderPath:work.workOrder,candidatePath:work.candidate,
    outputDirectory:path.join(options.workspaceRoot,'preview'),stills:true,at:[.8]});
  const mixed = await readFile(path.join(previewed.projectDirectory,'audio.wav'));
  assert.ok(mixed.subarray(mixed.indexOf(Buffer.from('data'))+8).some(value=>value!==0),
    '静音旁白夹具的候选预演实际包含音效，eventTime也能在真实Renderer求值');
  const sounds = result.featureResults['sound-effects'].events;
  result.featureResults['sound-effects'].events = [];
  await write(work.candidate, {taskDigest:order.taskDigest,result});
  const muted = await preview({workOrderPath:work.workOrder,candidatePath:work.candidate,
    outputDirectory:path.join(options.workspaceRoot,'preview-muted'),stills:true,at:[.8]});
  const silent = await readFile(path.join(muted.projectDirectory,'audio.wav'));
  assert.ok(silent.subarray(silent.indexOf(Buffer.from('data'))+8).every(value=>value===0),
    '明确取消音效后实际PCM静音，scene事件仍能驱动同一画面');
  result.featureResults['sound-effects'].events = sounds;
  await write(work.candidate, {taskDigest:order.taskDigest,result});
  await submitAuthorCandidate({workOrderPath:work.workOrder, candidatePath:work.candidate,
    workspace:options.workspaceRoot, episode:'ep01'});
  await acceptCandidate({...options, segmentId:'TR001'});
  const accepted = await readData(paths.storyboard);
  assert.deepEqual(accepted.templateRuns.find(run => run.id === 'TR001').treatment.scene, treatment.scene);
  assert.deepEqual(accepted.features['sound-effects'].units.TR001.events, result.featureResults['sound-effects'].events);
  assert.ok(accepted.features['sound-effects'].units.TR001._producer);
});

test('讲解先预演画面再交音效，原B2仍要求完整功能交付', async t => {
  const {options,paths,work}=await setup(t);
  const story=await readData(paths.storyboard);
  story.features['sound-effects']={units:{}};
  story.templateRuns[0].treatment=null;
  await write(paths.storyboard,story);
  await runNext({...options,segmentId:'TR001'});
  const order=await readData(work.workOrder),treatment=vox(1);
  const result={treatment,featureResults:{'cue-sync':cueResult(1)}};
  await write(work.candidate,{taskDigest:order.taskDigest,result});
  const {preview}=await import('../packages/templates/vox-explainer/preview.mjs');
  assert.equal((await preview({workOrderPath:work.workOrder,candidatePath:work.candidate,
    validateOnly:true})).message,'Author/Cue/RenderData OK','原画面预演不提前要求音效');
  await assert.rejects(submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'}),/已启用功能缺少候选结果: sound-effects/);
  result.featureResults['sound-effects']={events:[{id:'S001',purpose:'状态落定',soundId:'paper',
    anchor:{target:'M001',action:'advance-explainer',offsetSeconds:.8}}]};
  await write(work.candidate,{taskDigest:order.taskDigest,result});
  await preview({workOrderPath:work.workOrder,candidatePath:work.candidate,validateOnly:true});
  await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'});
  await acceptCandidate({...options,segmentId:'TR001'});
  const saved=await readData(paths.storyboard);
  const {_producer,...savedTreatment}=saved.templateRuns[0].treatment;
  assert.ok(_producer,'声音和画面沿原接纳入口保存');
  assert.deepEqual(savedTreatment,treatment);
  assert.deepEqual(saved.features['sound-effects'].units.TR001.events,result.featureResults['sound-effects'].events);
});

test('实测短语进入原P3任务视图；仅投递当前段，拒绝不同旁白',async t=>{
  const {options,paths,work}=await setup(t);
  const manifest=await readData(paths.narrationPackage);
  const quality={semantic:{timingSource:{kind:'provider-native'}},speechTiming:{
    audioSha256:manifest.files.audio.sha256,cues:[
      {cueId:1,phrases:[{text:'状态',startMs:70,endMs:500},{text:'变化。',startMs:600,endMs:1200}]},
      {cueId:4,phrases:[{text:'区分结果。',startMs:18000,endMs:22000}]}]}};
  await write(path.join(paths.p2,'subtitle-quality.yaml'),quality);
  manifest.evidence={subtitleQuality:{path:'subtitle-quality.yaml',sha256:sha256(JSON.stringify(quality))}};
  await write(paths.narrationPackage,manifest);
  await runNext({...options,redesignBody:true,redesignBeatIds:['B001'],revisionReason:'核对实测短语交接'});
  const view=JSON.parse(execFileSync(process.execPath,[path.join(root,'packages/p3-task-view.mjs'),work.workOrder],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
  assert.deepEqual(view.inputs.templateContext.audio.speechTiming,{available:true,source:'provider-native',cues:[
    {cueId:1,phrases:[{index:1,text:'状态',startOffsetSeconds:4/60,endOffsetSeconds:.5},
      {index:2,text:'变化。',startOffsetSeconds:.6,endOffsetSeconds:1.2}]}]});
  quality.speechTiming.audioSha256='f'.repeat(64);
  await write(path.join(paths.p2,'subtitle-quality.yaml'),quality);
  await assert.rejects(refreshAuthorReferences({workOrder:await readData(work.workOrder),workOrderPath:work.workOrder}),
    /短语时间与当前正式旁白不同源/u);
});

test('短语以同一全局帧再相减；重复文本靠序号区分，不拆分词内时间',()=>{
  const cue={id:7,startMs:1001,endMs:1500};
  const result=projectSpeechTiming({cues:[cue],speechTiming:{available:true,source:'provider-native',cues:[
    {cueId:7,phrases:[{text:'门',startMs:1009,endMs:1084},{text:'门',startMs:1200,endMs:1350}]}]}});
  assert.deepEqual(result.cues[0].phrases,[{index:1,text:'门',startOffsetSeconds:1/60,endOffsetSeconds:5/60},
    {index:2,text:'门',startOffsetSeconds:.2,endOffsetSeconds:.35}]);
  assert.throws(()=>projectSpeechTiming({cues:[cue],speechTiming:{available:true,cues:[
    {cueId:7,phrases:[{text:'门',startMs:999,endMs:1050}]}]}}),/实测时段无效/u);
  const last=projectSpeechTiming({cues:[cue],speechTiming:{available:true,cues:[
    {cueId:7,phrases:[{text:'门',startMs:1200,endMs:1500}]}]}});
  assert.equal(last.cues[0].phrases[0].endOffsetSeconds,29/60,'末端落在本段最后可呈现帧');
});

test('B2交回候选后由主代理接纳；下一段任务视图可完整恢复',async t=>{
  const {options,paths}=await setup(t);
  let work=getStageWorkPaths(paths,'p3','TR001');
  await runNext({...options,redesignBody:true,redesignBeatIds:['B001'],revisionReason:'仅修当前讲解'});
  const order=await readData(work.workOrder);
  const currentView=JSON.parse(execFileSync(process.execPath,
    [path.join(root,'packages/p3-task-view.mjs'),work.workOrder],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
  const authorContext=currentView.inputs.templateContext;
  assert.deepEqual(authorContext.renderContext,order.inputs.templateContext.renderContext);
  assert.equal(authorContext.renderContext.width,1920);
  assert.equal(authorContext.renderContext.time.durationInFrames,360);
  assert.deepEqual(order.inputs.templateContext.appearance.palette,SURFACE_PALETTE,
    '新工作单投递固定底板与字线颜色，主体角色色由作者选择');
  assert.deepEqual(authorContext.appearance,order.inputs.currentTreatment.appearance,'当前视图保留已有作品实际选择的颜色');
  assert.equal(authorContext.visual,undefined);
  const audioFile=path.join(paths.p2,'narration.wav');
  const {speechTiming,...audioContext} = authorContext.audio;
  assert.equal(speechTiming.available,false);
  assert.match(speechTiming.reason,/没有实测短语时间/u);
  assert.deepEqual(audioContext,{file:audioFile,sha256:sha256(await readFile(audioFile)),startMs:0,endMs:6000});
  const subtitles=await readFile(paths.narrationSubtitles,'utf8');
  await write(paths.narrationSubtitles,subtitles.replace('状态变化','状态不同'));
  await assert.rejects(refreshAuthorReferences({workOrder:order,workOrderPath:work.workOrder}),/本单字幕与当前正式原声交接不一致/u);
  await write(paths.narrationSubtitles,subtitles);
  const authored=vox(1);
  authored.appearance.palette.accent='#8253a8';
  delete authored.continuity.carryToNext;
  await write(work.candidate,{taskDigest:order.taskDigest,result:{treatment:authored}});
  const cueOptions=JSON.parse(execFileSync(process.execPath,
    [path.join(root,'packages/modules/author-beat/cue-options.mjs'),work.workOrder,work.candidate],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
  assert.equal(cueOptions.nextTarget.target,'M001');
  assert.equal(cueOptions.diagnostics.length,0);
  const {cueText,...binding}=cueOptions.legalOptions[0];
  const items=[binding];
  await write(work.candidate,{taskDigest:order.taskDigest,
    result:{treatment:authored,featureResults:{'cue-sync':{items}}}});
  const preview=execFileSync(process.execPath,[path.join(root,'packages/templates/vox-explainer/preview.mjs'),
    '--work-order',work.workOrder,'--candidate',work.candidate,'--validate-only'],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
  assert.match(preview,/Author\/Cue\/RenderData OK/);
  const submitted=await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'});
  assert.equal(submitted.preflight.ok,true);
  assert.equal(submitted.next,undefined);
  await acceptCandidate({...options,segmentId:'TR001'});
  const next=await runNext({...options,segmentId:'TR002'});
  assert.equal(next.taskId,'ep01/B002/author');
  const accepted=await readData(getEpisodePaths(options.workspaceRoot,'ep01').storyboard);
  const result=accepted.templateRuns.find(run=>run.id==='TR001').treatment;
  assert.deepEqual(result.scene,authored.scene,'联合调用产物由原B2完整接纳');
  const assetRefs=await authoredAssetsForTreatment({treatment:result,workspaceRoot:options.workspaceRoot,episodeId:'ep01',segmentId:'TR001'});
  const actionTimings=resolveCueBindingsToFrames({bindingSet:accepted.features['cue-sync'].bindings.TR001,
    cues:order.inputs.cues,segmentStartMs:0,segmentEndMs:6000,fps:60});
  const rendered=renderData({segmentId:'TR001',treatment:result,assetRefs,actionTimings,durationInFrames:360,
    policy:createRenderPolicy({fps:60,width:1920,height:1080})});
  assert.deepEqual(rendered.voxExplainer.scene,result.scene);
  assert.deepEqual(rendered.voxExplainer.appearance,authored.appearance);
  assert.deepEqual(rendered.voxExplainer.policy,{fps:60,width:1920,height:1080});
  assert.ok(rendered.resourceFiles.includes(authored.appearance.fonts.body.publicPath));
  work=getStageWorkPaths(paths,'p3','TR002');
  const signed=await readFile(work.workOrder);
  const read=(...args)=>JSON.parse(execFileSync(process.execPath,
    [path.join(root,'packages/p3-task-view.mjs'),work.workOrder,...args],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
  const view=read();
  const compact=read('--reuse-references',JSON.stringify(view.referenceDigests));
  assert.equal(compact.reusedReferences.episodeContext,true);
  assert.equal(compact.inputs.templateContext.episodeContext.cues,undefined);
  assert.deepEqual(compact.inputs.templateContext.priorVisuals,[]);
  assert.deepEqual(compact.inputs.cues,view.inputs.cues);
  assert.deepEqual(read().inputs,view.inputs);
  assert.deepEqual(await readFile(work.workOrder),signed);
});

test('B2预检失败停在原单，不接纳或续领',async t=>{
  const {options,paths}=await setup(t);
  const work=getStageWorkPaths(paths,'p3','TR002');
  await runNext({...options,segmentId:'TR002'});
  const signed=await readFile(work.workOrder),story=await readFile(paths.storyboard);
  const order=await readData(work.workOrder);
  await write(work.candidate,{taskDigest:order.taskDigest,result:{}});
  await assert.rejects(submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep02'}),/当前工作单/);
  await assert.rejects(submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'}),/candidate|合同|treatment/);
  assert.deepEqual(await readFile(work.workOrder),signed);
  assert.deepEqual(await readFile(paths.storyboard),story);
});

test('Vox原图片入口传递新姿态与修图参考，漏传不导入，沿原B2接纳',async t=>{
  const {options,paths,work}=await setup(t);
  await runNext({...options,redesignBody:true,redesignBeatIds:['B001'],revisionReason:'验证同一人物的新姿态与修图'});
  const order=await readData(work.workOrder);
  const authored=vox(1);
  const request=id=>({requestId:id,purpose:'保持同一人物',sourceRefs:['C001'],mustNotInvent:['不改变身份'],
    visualBrief:{composition:'人物站立，衣装与装备清楚'},exactTexts:[],transparentBackground:false});
  authored.assetRequests=[request('AR001'),{...request('AR002'),referenceImageId:'AR001',
    visualBrief:{composition:'同一人物坐下，保留面貌、衣装与装备'}}];
  authored.scene.markup='<img src="asset:AR001"><img src="asset:AR002">';
  const candidate={taskDigest:order.taskDigest,result:{treatment:authored,featureResults:{'cue-sync':cueResult(1)}}};
  await write(work.candidate,candidate);
  const cli=(command,...args)=>JSON.parse(execFileSync(process.execPath,
    [path.join(root,'packages/templates/vox-explainer/images.mjs'),command,work.workOrder,work.candidate,...args],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,stdio:'pipe'}));
  const image=path.join(root,'packages/templates/vox-explainer/references/comic-figures.png');
  const changedImage=(await imageProfileFor(authored.appearance)).styles.general.references[0].absolutePath;
  const jobFile=path.join(options.workspaceRoot,'actual-call.json');
  let jobs=cli('prepare');
  assert.deepEqual(jobs.map(item=>item.requestId),['AR001'],'原图未完成时不提交依赖它的新姿态');
  assert.deepEqual(jobs[0].job.referenced_image_paths,[changedImage,image],'普通图件在共同画风后收到人物与器物结构参考');
  assert.doesNotMatch(jobs[0].job.prompt,/薄土层断面|连续的大地块/,'普通人物不接收地形切片的构图要求');
  await write(jobFile,jobs[0].job);
  const original=cli('import','AR001',image,jobFile);
  const originalFile=path.join(options.workspaceRoot,original.file);
  jobs=cli('prepare');
  assert.deepEqual(jobs.map(item=>item.requestId),['AR002']);
  const poseJob=jobs[0].job;
  assert.equal(poseJob.referenced_image_paths.at(-1),originalFile);
  assert.equal(sha256(await readFile(originalFile)),original.sha256);
  assert.match(poseJob.prompt,/第3张参考图是本件内容的参考原图/);
  assert.match(poseJob.prompt,/保持同一人物的面貌、衣装和装备/);
  const saved=await readData(work.candidate),recolored=structuredClone(saved);
  recolored.result.treatment.appearance.palette.accent='#775588';
  await write(work.candidate,recolored);
  const beforeRecolor=await readFile(work.candidate);
  const recolorJobs=cli('prepare');
  assert.deepEqual(recolorJobs.map(item=>item.requestId),['AR001'],'原图配色待修正时不提前准备新姿态');
  await write(jobFile,poseJob);
  assert.throws(()=>cli('import','AR002',image,jobFile),/图片与当前讲解样式不一致/);
  assert.deepEqual(await readFile(work.candidate),beforeRecolor,'导入不能使用配色尚未就绪的原图');
  await write(jobFile,recolorJobs[0].job);
  const recoloredOriginal=cli('import','AR001',image,jobFile);
  const afterRecolor=cli('prepare');
  assert.deepEqual(afterRecolor.map(item=>item.requestId),['AR002']);
  assert.equal(afterRecolor[0].job.referenced_image_paths.at(-1),path.join(options.workspaceRoot,recoloredOriginal.file));
  await write(work.candidate,saved);
  const beforePose=await readFile(work.candidate);
  await write(jobFile,{...poseJob,referenced_image_paths:poseJob.referenced_image_paths.slice(0,-1)});
  assert.throws(()=>cli('import','AR002',image,jobFile),/须原样携带/);
  assert.deepEqual(await readFile(work.candidate),beforePose,'漏传不能替换当前候选');
  await write(jobFile,poseJob);
  const pose=cli('import','AR002',image,jobFile);
  assert.deepEqual((await readData(path.join(options.workspaceRoot,pose.promptFile))).referenced_image_paths,
    poseJob.referenced_image_paths,'实际调用参数随原图导入保存');
  assert.deepEqual(cli('prepare'),[]);

  const revision=await readData(work.candidate);
  revision.result.treatment.assetRequests[1].visualBrief.composition+='；只修正右手握姿，保留其它部分';
  await write(work.candidate,revision);
  const revisionJob=cli('prepare')[0].job;
  const poseFile=path.join(options.workspaceRoot,pose.file);
  assert.deepEqual(revisionJob.referenced_image_paths.slice(-2),[originalFile,poseFile]);
  assert.match(revisionJob.prompt,/待修改的原图/);
  assert.match(revisionJob.prompt,/第4张参考图是本件待修改的原图/);
  assert.match(revisionJob.prompt,/只修正右手握姿/);
  await write(jobFile,{...revisionJob,referenced_image_paths:revisionJob.referenced_image_paths.slice(0,-1)});
  assert.throws(()=>cli('import','AR002',changedImage,jobFile),/须原样携带/);
  assert.deepEqual((await readData(work.candidate)).result.treatment.assetRequests[1].asset,pose);
  await write(jobFile,revisionJob);
  const revised=cli('import','AR002',changedImage,jobFile);
  assert.notEqual(revised.sha256,pose.sha256);
  assert.equal(sha256(await readFile(poseFile)),pose.sha256,'修改前的原图保留');
  assert.deepEqual(cli('prepare'),[]);
  const final=await readData(work.candidate);
  assert.deepEqual(final.result.treatment.assetRequests[0].asset,original,'合格原图保持原值');

  for(const referenceImageId of ['AR002','AR999']) {
    const bad=structuredClone(final);
    bad.result.treatment.assetRequests[1].referenceImageId=referenceImageId;
    await write(work.candidate,bad);
    assert.throws(()=>cli('prepare'),/本段另一张/);
  }
  const outside=structuredClone(final);
  outside.result.treatment.assetRequests[0].asset.file=image;
  outside.result.treatment.assetRequests[1].visualBrief.composition+='；修正';
  await write(work.candidate,outside);
  assert.throws(()=>cli('prepare'),/P3讲解素材/);
  const cyclic=structuredClone(candidate);
  cyclic.result.treatment.assetRequests[0].referenceImageId='AR002';
  await write(work.candidate,cyclic);
  assert.throws(()=>cli('prepare'),/循环引用/);
  await write(work.candidate,final);
  const submitted=await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'});
  assert.equal(submitted.preflight.ok,true);
  await acceptCandidate({...options,segmentId:'TR001'});
  const accepted=(await readData(paths.storyboard)).templateRuns.find(run=>run.id==='TR001').treatment;
  const assets=await authoredAssetsForTreatment({treatment:accepted,workspaceRoot:options.workspaceRoot,
    episodeId:'ep01',segmentId:'TR001'});
  assert.deepEqual(assets.map(asset=>asset.sha256),[original.sha256,revised.sha256]);
});

test('Vox共用地图画风参考并按图件形态投递说明，原图片与B2消费同一选择',async t=>{
  const {options,paths,work}=await setup(t);
  await runNext({...options,redesignBody:true,redesignBeatIds:['B001'],revisionReason:'验证参考用途投递'});
  const order=await readData(work.workOrder),authored=vox(1);
  const request=(id,visualBrief)=>({requestId:id,purpose:'当前讲解图件',sourceRefs:['C001'],
    mustNotInvent:['不改变本题对象'],visualBrief,exactTexts:[],transparentBackground:false});
  authored.assetRequests=[
    request('AR001',{composition:'地图旁的独立人物与器物，不带地面'}),
    request('AR002',{composition:'山谷通路的立体地形切片',styleReference:'terrain'})
  ];
  authored.scene.markup='<img src="asset:AR001"><img src="asset:AR002">';
  await write(work.candidate,{taskDigest:order.taskDigest,result:{treatment:authored,
    featureResults:{'cue-sync':cueResult(1)}}});
  const cli=(command,...args)=>JSON.parse(execFileSync(process.execPath,
    [path.join(root,'packages/templates/vox-explainer/images.mjs'),command,work.workOrder,work.candidate,...args],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,stdio:'pipe'}));
  const figure=path.join(root,'packages/templates/vox-explainer/references/comic-figures.png');
  const terrain=(await imageProfileFor(authored.appearance)).styles.general.references[0].absolutePath;
  const jobs=cli('prepare'),callFile=path.join(options.workspaceRoot,'actual-call.json');
  const art=await readFile(path.join(root,'packages/templates/vox-explainer/references/art.md'),'utf8');
  const section=title=>art.split(`## ${title}\n`)[1].split('\n## ')[0].trim();
  const common=section('共同画风'),general=section('人物、器物与普通情境'),terrainMethod=section('空间地形');
  assert.deepEqual(jobs.map(item=>item.job.referenced_image_paths),[[terrain,figure],[terrain]]);
  for(const {requestId,job} of jobs)
    assert.ok(job.prompt.includes(authored.assetRequests.find(request=>request.requestId===requestId).purpose),
      '图片模型收到作者已经填写的本件用途');
  assert.ok(jobs[0].job.prompt.includes(general),'普通图件收到现行人物、器物与情境画法');
  assert.ok(!jobs[0].job.prompt.includes(terrainMethod),'普通图件不误收地形专用说明');
  for(const {job} of jobs) {
    assert.ok(job.prompt.includes(common),'各类图件均收到完整现行共同画风');
    assert.doesNotMatch(job.prompt,/默认底板是暖灰米色|强调默认用清楚的朱红/,
      '不注入废弃预设；画法措辞由当前art真源拥有');
  }
  assert.doesNotMatch(jobs[0].job.prompt,/生成蓝图中的完整场景|保留连续环境/,'不透明背景不应把独立图件变成完整场景');
  assert.ok(jobs[1].job.prompt.includes(terrainMethod),'地形图件收到现行空间地形画法');
  assert.ok(!jobs[1].job.prompt.includes(general),'地形图件不误收普通图件专用说明');
  assert.doesNotMatch(jobs[1].job.prompt,/comic-figures\.png|从人物与器物图里/);
  const before=await readFile(work.candidate);
  await write(callFile,{...jobs[0].job,referenced_image_paths:[figure,terrain]});
  assert.throws(()=>cli('import','AR001',figure,callFile),/须原样携带/);
  assert.deepEqual(await readFile(work.candidate),before);
  for(const {requestId,job} of jobs){
    await write(callFile,job);
    const asset=cli('import',requestId,requestId==='AR001'?figure:terrain,callFile);
    const actual=await readData(path.join(options.workspaceRoot,asset.promptFile));
    assert.deepEqual(actual.referenced_image_paths,job.referenced_image_paths);
    assert.equal(actual.prompt,job.prompt);
  }
  assert.deepEqual(cli('prepare'),[],'有效图片不会因参考投递修复重复生成');
  const submitted=await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'});
  assert.equal(submitted.preflight.ok,true);
  await acceptCandidate({...options,segmentId:'TR001'});
  const accepted=(await readData(paths.storyboard)).templateRuns.find(run=>run.id==='TR001').treatment;
  assert.equal(accepted.assetRequests[1].visualBrief.styleReference,'terrain');
  const assets=await authoredAssetsForTreatment({treatment:accepted,workspaceRoot:options.workspaceRoot,
    episodeId:'ep01',segmentId:'TR001'});
  assert.equal(assets.length,2);
});

test('仅音效返工实际生成专用声音和音乐收放，原卡点与指定BGM联听，关闭音效画面和原稿保持', async t => {
  const {options,paths,work} = await setup(t);
  const bgm = path.join(paths.input,'sources/selected.wav');
  await mkdir(path.dirname(bgm),{recursive:true});
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=220:duration=24',
    '-ar','48000','-ac','2',bgm]);
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:[{id:'SA001',mediaType:'audio',path:'sources/selected.wav',
    sha256:sha256(await readFile(bgm)),sourceCitation:'本测试显式指定合成音频',creator:null,date:null,
    rightsStatus:'public-domain',usageNotes:'非生产单曲测试输入'}]});
  const story = await readData(paths.storyboard);
  story.features['background-music'] = {sourceAssetId:'SA001'};
  story.features['sound-effects'] = {units:{}};
  await write(paths.storyboard, story);
  await runNext({...options,segmentId:'TR001'});
  const order = await readData(work.workOrder);
  assert.deepEqual(order.inputs.repairFeatureIds,['sound-effects']);
  const context=order.inputs.featureContexts['sound-effects'];
  assert.equal(context.music.sourceAssetId,'SA001');
  assert.equal(context.music.source.file,'ep01/制作/input/sources/selected.wav');
  const view=JSON.parse(execFileSync(process.execPath,[path.join(root,'packages/p3-task-view.mjs'),work.workOrder],{encoding:'utf8'}));
  assert.equal(view.inputs.featureContexts['sound-effects'].music.sourceAssetId,'SA001');
  const {generateSound} = await import('../packages/features/sound-effects/generate.mjs');
  const recipe = path.join(options.workspaceRoot,order.scratchPath,'recipe.json');
  await write(path.join(path.dirname(recipe),'authored.py'),
    'import numpy as np\nfrom lemo import sfx as S\ndef render(*, sr, rng):\n    out = np.zeros((round(sr * .6), 2), np.float32)\n    S.add(out, S.creak(v=.2), 0, gain=.4)\n    S.add(out, S.thump(v=.4, f=137), .04)\n    return out\n');
  await write(recipe,{seed:7,syncSeconds:.04,sourceFile:'authored.py'});
  const asset = await generateSound({workOrderPath:work.workOrder,recipePath:recipe});
  const result = {featureResults:{'sound-effects':{events:[{id:'S001',purpose:'读状态的实际显露',asset,
    anchor:{target:'M001',action:'advance-explainer',offsetSeconds:.8},gain:.6}],
    musicGestures:[{id:'G001',purpose:'变化成立前收声，随后恢复原音乐',points:[
      [.2,1],[.5,0],[.9,0],[1.5,1]].map(([offsetSeconds,gain])=>
        ({anchor:{target:'M001',action:'advance-explainer',offsetSeconds},gain}))}]}}};
  await write(work.candidate,{taskDigest:order.taskDigest,result});
  const invalid = structuredClone(result);
  invalid.featureResults['sound-effects'].musicGestures[0].points[1].anchor.target='M999';
  await write(work.candidate,{taskDigest:order.taskDigest,result:invalid});
  await assert.rejects(()=>submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'}),/找不到画面锚点/);
  await write(work.candidate,{taskDigest:order.taskDigest,result});
  const candidateBefore = await readFile(work.candidate), pictureBefore = await readFile(paths.storyboard);
  const {preview} = await import('../packages/templates/vox-explainer/preview.mjs');
  const base = {workOrderPath:work.workOrder,candidatePath:work.candidate,stills:true,at:[.8]};
  const on = await preview({...base,outputDirectory:path.join(options.workspaceRoot,'sound-on')});
  const off = await preview({...base,outputDirectory:path.join(options.workspaceRoot,'sound-off'),muteEffects:true});
  const frame = async directory => readFile(path.join(directory,(await readdir(directory)).find(file=>file.endsWith('.png'))));
  assert.deepEqual(await frame(on.output),await frame(off.output),'开关音效的真实Renderer截图逐字节相同');
  const onAudio = await readFile(path.join(on.projectDirectory,'audio.wav'));
  const offAudio = await readFile(path.join(off.projectDirectory,'audio.wav'));
  assert.notDeepEqual(onAudio,offAudio,'同一旁白与指定BGM中只改变音效层');
  const composition = await readFile(path.join(on.projectDirectory,'index.html'),'utf8');
  assert.match(composition,/body-background-music/);
  assert.match(composition,/sfx-/);
  assert.deepEqual(await readFile(work.candidate),candidateBefore,'预览不把原画面和cue-sync转抄回仅音效候选');
  assert.deepEqual(await readFile(paths.storyboard),pictureBefore,'预览与制声不改正式原画面');
  await submitAuthorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate,
    workspace:options.workspaceRoot,episode:'ep01'});
  await acceptCandidate({...options,segmentId:'TR001'});
  const accepted = await readData(paths.storyboard);
  assert.deepEqual(accepted.templateRuns[0].treatment,story.templateRuns[0].treatment);
  assert.equal(accepted.features['sound-effects'].units.TR001.events[0].asset.sha256,asset.sha256);
  assert.deepEqual(accepted.features['sound-effects'].units.TR001.musicGestures,
    result.featureResults['sound-effects'].musicGestures);
});

test('正式CLI开关保留声音成果，作者装配关闭且原画面、Cue、BGM选择不变', async t => {
  const {options,paths}=await setup(t);
  const story=await readData(paths.storyboard);
  story.features['sound-effects']={enabled:true,units:{TR001:{events:[]}}};
  story.features['background-music']={sourceAssetId:'SA001'};
  await write(paths.storyboard,story);
  const command=value=>JSON.parse(execFileSync(process.execPath,[path.join(root,'engine/cli.mjs'),'next',
    '--workspace',options.workspaceRoot,'--episode','ep01','--stage','p3','--sound-effects',value],{encoding:'utf8'}));
  const off=command('off');assert.equal(off.enabled,false);
  const disabled=await readData(paths.storyboard);
  assert.deepEqual(disabled.features['sound-effects'].units,story.features['sound-effects'].units);
  for(const key of ['beats','templateRuns','albumPlan'])assert.deepEqual(disabled[key],story[key]);
  assert.deepEqual(disabled.features['cue-sync'],story.features['cue-sync']);
  assert.deepEqual(disabled.features['background-music'],story.features['background-music']);
  const {loadStageModel,loadSelectedVisualForModel}=await import('./runtime/model.mjs');
  const {prepareNodeAssembly}=await import('./runtime/implementations.mjs');
  const model=await loadStageModel(root,{stageId:'p3'});
  const visual=await loadSelectedVisualForModel({root,workspaceRoot:options.workspaceRoot,model,storyboard:disabled});
  const node=model.orderedNodes.find(n=>n.moduleId==='author-beat');
  const {assembly}=await prepareNodeAssembly({model,node,storyboard:disabled,
    selection:{beatTemplateIds:['vox-explainer'],visualPackageId:visual.id}});
  assert.ok(!assembly.slots.flatMap(s=>s.implementations).some(i=>i.packageId==='sound-effects'),
    '实际作者装配不含音效规则、Schema或校验器');
  assert.equal(command('on').enabled,true);
  const enabled=await readData(paths.storyboard);
  assert.deepEqual(enabled.features['sound-effects'].units,story.features['sound-effects'].units);
  assert.deepEqual(enabled.templateRuns,story.templateRuns);
  assert.equal(command('on').changed,false,'重复开启不清空成果或重签作者');
});
