import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {acceptCandidate, deriveStatus, hashObject, readData, runNext, sha256} from './runtime.mjs';
import {assertTaskContinuity} from './runtime/tasks.mjs';
import {getEpisodePaths, getProgramPaths, getStageWorkPaths} from '../packages/workspace-paths.mjs';
import {createAppearance} from '../packages/templates/vox-explainer/appearance.mjs';
import {parseSrt} from './p3-input.mjs';
import {directorResultSlice} from './runtime/storyboard.mjs';
import {inspectCurrentDirectorCandidate} from '../packages/modules/direct-episode/inspect-authorability.mjs';
import {collectAuthoredMedia} from '../packages/authored-media.mjs';

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
  const paths = getEpisodePaths(workspaceRoot, 'ep01'), work = getStageWorkPaths(paths, 'p3', 'TR002');
  const visual = await readData(path.join(root, 'visuals/meiji-state-machine/visual-package.json'));
  await write(getProgramPaths(workspaceRoot).programPlan, {programForm:'historical-explainer',
    openerTemplate:'episode-opener', visualPackage:{visualPackageId:visual.id, version:visual.version}});
  const narration = '状态变化。\n观察现场。\n继续观察。\n区分结果。';
  const subtitles = [1,2,3,4].map((id,i) => `${id}\n00:00:${String(i*6).padStart(2,'0')},000 --> 00:00:${String((i+1)*6).padStart(2,'0')},000\n${narration.split('\n')[i]}\n`).join('\n');
  await write(paths.narrationText, narration);
  await write(paths.narrationSubtitles, subtitles);
  await write(paths.narrationPackage, {episodeId:'ep01', durationMs:24000, files:{
    narration:{path:'narration.txt', sha256:sha256(narration)}, subtitles:{path:'narration.srt', sha256:sha256(subtitles)}
  }});
  await write(paths.sourceAssets, {schemaVersion:'1.0',assets:[]});
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

test('旧成片缺失时仍可从正式入口领取指定正文返工', async t => {
  const {options, paths} = await setup(t);
  const receipt = {episodeId:'ep01', output:'ep01/output/final.mp4', sha256:'a'.repeat(64),
    mediaRetention:'documents-and-release'};
  await write(paths.renderReceipt, {...receipt, _producer:{moduleId:'render-video', nodeId:'render',
    outputSha256:hashObject(receipt)}});
  const revision = await runNext({...options, redesignBody:true, redesignBeatIds:['B001'], revisionReason:'重做指定讲解'});
  assert.equal(revision.taskId, 'ep01/TR001/author');
  assert.equal((await deriveStatus(options)).taskId, revision.taskId);
});

test('合并前的正文返工沿原工作单和候选接纳，正文基线变化仍停止', async t => {
  const {options, paths} = await setup(t);
  const requestPath = getStageWorkPaths(paths, 'p3').returnRequest('author');
  const {understanding, ...visualPlan} = directorResultSlice(await readData(paths.storyboard));
  const request = {target:'author', reason:'原讲解局部返工', cueRefs:[],
    revisionScope:'body-redesign', redesignState:'pending-author', baselineVisualPlanSha256:hashObject(visualPlan),
    selectedBeatIds:['B001'], pendingAuthorUnitIds:['TR001']};
  await write(requestPath, request);
  const issued = await runNext(options);
  const author = getStageWorkPaths(paths, 'p3', 'TR001');
  const signed = await readFile(author.workOrder, 'utf8');
  const candidate = {taskDigest:issued.taskDigest,
    result:{treatment:vox(1), featureResults:{'cue-sync':cueResult(1)}}};
  await write(author.candidate, candidate);
  assert.equal((await runNext({...options, segmentId:'TR001'})).taskDigest, issued.taskDigest);
  assert.equal(await readFile(author.workOrder, 'utf8'), signed);
  assert.deepEqual(await readData(author.candidate), candidate);
  const story = await readData(paths.storyboard);
  const changed = structuredClone(story);
  changed.albumPlan.intent = '另一个真实任务';
  await write(paths.storyboard, changed);
  await assert.rejects(deriveStatus(options), /改变了既有视觉导演计划/);
  assert.deepEqual(await readData(author.candidate), candidate);
  await write(paths.storyboard, story);
  assert.equal((await acceptCandidate({...options, segmentId:'TR001'})).kind, 'accepted');
  await assert.rejects(readFile(requestPath), {code:'ENOENT'});
});

test('正文返工保留进行中的导演候选和正式分镜', async t => {
  const {options, paths} = await setup(t);
  const work = getStageWorkPaths(paths, 'p3');
  const before = await readFile(paths.storyboard, 'utf8');
  await write(work.returnRequest('director'), {target:'director', cueRefs:[],
    reason:'口播正文发生实际修改，修订受影响的共享理解与分镜'});
  const original = await runNext(options);
  assert.equal(original.taskId, 'ep01/director');
  const candidate = {taskDigest:original.taskDigest, result:{understanding:{draft:true}}};
  await write(work.candidate, candidate);
  await assert.rejects(runNext({...options,redesignBody:true,redesignBeatIds:['B001']}), /仍有导演修订请求/);
  assert.deepEqual(await readData(work.candidate), candidate);
  assert.equal(await readFile(paths.storyboard, 'utf8'), before);
});

test('分句修订沿导演接纳保留设计素材，仅向受影响作者交接旧Cue与功能', async t => {
  for (const {split, earlier = false} of [{split:true}, {split:false}, {split:true,earlier:true}])
    await t.test(earlier ? '同章后续音效仍绑定旧编号' : split ? '编号改变' : '范围编号不变而句界改变', async t => {
    const {options, paths} = await setup(t);
    const work = getStageWorkPaths(paths, 'p3');
    const previousCues = parseSrt(await readFile(paths.narrationSubtitles, 'utf8'));
    const original = await readData(paths.storyboard);
    for (const beat of original.beats.slice(1)) beat.directorBrief.relationFromPrevious = '继续观察';
    original.beats[0].templateId = 'fullframe-narrative';
    original.templateRuns[0] = {id:'TR001',templateId:'fullframe-narrative',beatIds:['B001'],treatment:null};
    original.templateRuns[1].treatment = null;
    delete original.features['cue-sync'].bindings.TR001;
    for (const id of [1,2,3]) {
      const file = path.join(paths.p3, 'assets', `B00${id}`, 'retained.png');
      await write(file, `本单原图片${id}`);
      original.beats[id - 1].treatment = {templateId:'fullframe-narrative',
        incomingTransition:id <= 2 ? null : {type:'dissolve',durationMs:600,reason:'转换观察'},
        continuity:{period:'测试时期',location:'现场',continuesPreviousScene:false,subjects:[],props:[],carryToNext:{subjects:[],props:[]}},
        calloutGate:{'historical-quote':'not-triggered','person-intro':'not-triggered','term-gloss':'not-triggered'},
        assetRequests:[{requestId:'AR001',kind:'fullframe-image',required:true,frameId:'A',cameraRelation:id <= 2 ? 'first' : 'reset',
          purpose:'观察场面',sourceRefs:[`C00${id}`],mustNotInvent:[],acceptanceCriteria:['画面完整'],
          sceneDescription:'完整现场中的观察对象',attentionPlan:{entryFocus:'现场',landingFocus:'对象',viewerChange:'看清对象'},
          motion:{type:'push-in',speedRatio:1,startViewport:{x:0,y:0,width:1,height:1},routeWaypoints:[],
            semanticEndViewport:{x:.1,y:.1,width:2/3,height:2/3},safeEndViewport:{x:.1,y:.1,width:2/3,height:2/3}},
          asset:{file:path.relative(options.workspaceRoot,file),sha256:sha256(await readFile(file))}}]};
      original.features['cue-sync'].bindings[`B00${id}`] = {items:[{target:'AR001',action:'start-frame-motion',cueId:id,edge:'start'}]};
    }
    original.templateRuns[2].treatment = vox(4);
    original.features['cue-sync'].bindings.TR003 = cueResult(4);
    const soundFile = path.join(paths.p3, 'assets', 'B002', 'retained.wav');
    const {label, ...soundAsset} = (await readData(path.join(root, 'packages/features/sound-effects/library/catalog.json'))).paper;
    await writeFile(soundFile, await readFile(path.join(root, soundAsset.file)));
    soundAsset.file = path.relative(options.workspaceRoot, soundFile);
    original.features['sound-effects'] = {enabled:true, units:Object.fromEntries([1,2,3].map(id => [`B00${id}`, {
      events:[{id:'S001',purpose:'观察动作',asset:soundAsset,
        anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1}}]
    }]))};
    await write(paths.storyboard, original);
    const cues = earlier
      ? [previousCues[0],{id:2,text:'观察',startMs:6000,endMs:9000},{id:3,text:'现场。',startMs:9000,endMs:12000},
        {...previousCues[2],id:4},{...previousCues[3],id:5}]
      : [...previousCues.slice(0,2), {id:3,text:'继续',startMs:12000,endMs:15000},
      ...(split ? [{id:4,text:'观察。',startMs:15000,endMs:18000},{...previousCues[3],id:5}]
        : [{id:4,text:'观察。区分结果。',startMs:15000,endMs:24000}])];
    const srt = cues.map(cue => `${cue.id}\n00:00:${String(cue.startMs/1000).padStart(2,'0')},000 --> 00:00:${String(cue.endMs/1000).padStart(2,'0')},000\n${cue.text}\n`).join('\n');
    await write(paths.narrationSubtitles, srt);
    const narrationPackage = await readData(paths.narrationPackage);
    narrationPackage.files.subtitles.sha256 = sha256(srt);
    await write(paths.narrationPackage, narrationPackage);
    const referenced = split ? 'B001' : 'B003';
    await write(paths.episodePackage, {opener:{templateId:'episode-opener',flashbackShots:[{bodyRefs:[referenced]}]}});
    await write(paths.videoPlan, {spans:[{beatIds:[referenced]}]});
    await write(work.returnRequest('director'), {target:'director',reason:'只修分句绑定',cueRefs:[],cueRebinding:{previousCues}});
    await runNext(options);
    const task = await readData(work.workOrder), result = directorResultSlice(original);
    assert.deepEqual(task.inputs.returnRequest.cueRebinding.previousCues, previousCues);
    if (earlier) { result.beats[1].cueRange = [2,3]; result.beats[2].cueRange = [4,4]; result.beats[3].cueRange = [5,5]; }
    else if (split) { result.beats[2].cueRange = [3,4]; result.beats[3].cueRange = [5,5]; }
    await write(work.candidate, {taskDigest:task.taskDigest,result});
    const inspection = await inspectCurrentDirectorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate});
    assert.equal(inspection.authorable,true,JSON.stringify(inspection));
    for (const entry of ['inspect-boundaries','lock-boundaries']) execFileSync(process.execPath,
      [path.join(root,`packages/modules/direct-episode/${entry}.mjs`),work.workOrder,work.candidate],{stdio:['ignore','pipe','pipe']});
    await acceptCandidate(options);
    const retained = await readData(paths.storyboard);
    for (const index of [1,2]) assert.deepEqual(retained.beats[index].treatment, original.beats[index].treatment);
    assert.deepEqual(retained.templateRuns.map(run=>run.treatment), original.templateRuns.map(run=>run.treatment));
    assert.deepEqual(retained.features, original.features);
    const repair = await readData(work.returnRequest('author'));
    assert.deepEqual(repair.pendingAuthorUnitIds, earlier ? ['B002','B003','TR003'] : ['B003','TR003']);
    assert.deepEqual(repair.selectedBeatIds, earlier ? ['B002','B003','B004'] : ['B003','B004']);
    const media = await collectAuthoredMedia({storyboard:retained,cues,bodyDurationMs:24000});
    for (const item of media.items) assert.equal(sha256(await readFile(path.resolve(options.workspaceRoot,item.file))),item.sha256);
    for (const node of ['opener','video']) {
      const request = getStageWorkPaths(paths,'p4').returnRequest(node);
      if (split && (!earlier || node === 'opener')) await assert.rejects(readFile(request),{code:'ENOENT'});
      else assert.equal((await readData(request)).target,node);
    }
    const next = await runNext(options);
    const currentId = earlier ? 'B002' : 'B003';
    assert.equal(next.taskId,`ep01/${currentId}/author`);
    const authorPath = getStageWorkPaths(paths,'p3','TR002').workOrder;
    const author = await readData(authorPath);
    assert.deepEqual(author.inputs.currentTreatment,original.beats[earlier ? 1 : 2].treatment);
    assert.deepEqual(author.inputs.currentFeatureResults['cue-sync'],original.features['cue-sync'].bindings[currentId]);
    assert.deepEqual(author.inputs.currentFeatureResults['sound-effects'],original.features['sound-effects'].units[currentId]);
    assert.deepEqual(author.inputs.p3BodyRedesign.cueRebinding.previousCues,previousCues);
    assert.deepEqual(author.inputs.repairBeatIds,[currentId]);
    const sounds = author.inputs.featureContexts['sound-effects'];
    assert.deepEqual(sounds.acceptedUnits.map(unit => unit.unitId),earlier ? [] : ['B002']);
    const view = JSON.parse(execFileSync(process.execPath,[path.join(root,'packages/p3-task-view.mjs'),authorPath],{encoding:'utf8'}));
    assert.deepEqual(view.inputs.featureContexts['sound-effects'],sounds,'任务视图刷新沿用同一待修边界');
    assert.deepEqual(await readData(authorPath),author,'只读刷新保持原工作单');
    assert.deepEqual(await readData(paths.storyboard),retained,'派单与刷新保留原设计和全部功能');
    assert.equal(sha256(await readFile(soundFile)),soundAsset.sha256,'原音效文件保持原字节');
  });
});

test('导演局部修订续接合并前的原单，保留原成果并交接必要接镜返工', async t => {
  const {options, paths} = await setup(t);
  const work = getStageWorkPaths(paths, 'p3');
  const original = await readData(paths.storyboard);
  original.beats[0].templateId = 'fullframe-narrative';
  original.templateRuns[0] = {id:'TR001',templateId:'fullframe-narrative',beatIds:['B001'],treatment:null};
  original.templateRuns[2].treatment = vox(4);
  original.features['cue-sync'].bindings = {TR003:cueResult(4)};
  for (const [index, beat] of original.beats.entries()) {
    if (index) beat.directorBrief.relationFromPrevious = '继续观察';
    if (index > 2) continue;
    const file = path.join(paths.p3, 'assets', beat.id, 'retained.png');
    await write(file, `原图${beat.id}`);
    beat.treatment = {templateId:'fullframe-narrative',incomingTransition:null,
      continuity:{period:'测试时期',location:'原现场',continuesPreviousScene:false,subjects:[],props:[],carryToNext:{subjects:[],props:[]}},
      calloutGate:{'historical-quote':'not-triggered','person-intro':'not-triggered','term-gloss':'not-triggered'},
      assetRequests:[{requestId:'AR001',kind:'fullframe-image',required:true,frameId:'A',cameraRelation:'first',
        purpose:'原观看场面',sourceRefs:[`C00${index+1}`],mustNotInvent:[],acceptanceCriteria:['画面完整'],
        sceneDescription:'当前正式原场面',attentionPlan:{entryFocus:'现场',landingFocus:'对象',viewerChange:'看清对象'},
        motion:{type:'push-in',speedRatio:1,startViewport:{x:0,y:0,width:1,height:1},routeWaypoints:[],
          semanticEndViewport:{x:.1,y:.1,width:2/3,height:2/3},safeEndViewport:{x:.1,y:.1,width:2/3,height:2/3}},
        asset:{file:path.relative(options.workspaceRoot,file),sha256:sha256(await readFile(file))}}]};
    original.features['cue-sync'].bindings[beat.id] = {
      items:[{target:'AR001',action:'start-frame-motion',cueId:index+1,edge:'start'}]
    };
  }
  const {label, ...soundAsset} = (await readData(path.join(root,'packages/features/sound-effects/library/catalog.json'))).paper;
  const soundFile = path.join(paths.p3,'assets','B002','retained.wav');
  await writeFile(soundFile,await readFile(path.join(root,soundAsset.file)));
  soundAsset.file = path.relative(options.workspaceRoot,soundFile);
  original.features['sound-effects'] = {enabled:true,units:{B002:{events:[{
    id:'S001',purpose:'原声音',asset:soundAsset,
    anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1}
  }]}}};
  await write(paths.storyboard,original);
  const {understanding, ...visualPlan} = directorResultSlice(original);
  await write(work.returnRequest('director'),{target:'director',reason:'调整B002观看要求及下一拍必要承接',
    revisionScope:'director-revision',selectedBeatIds:['B002'],cueRefs:[2],
    baselineVisualPlanSha256:hashObject(visualPlan)});
  await runNext(options);
  const {taskDigest: _digest, ...oldOrder} = await readData(work.workOrder);
  oldOrder.inputs.currentVisualPlan = visualPlan;
  oldOrder.inputs.understanding = {source:'ep01/制作/p3/storyboard.yaml#understanding',
    sha256:hashObject(understanding), content:understanding};
  const task = {...oldOrder, taskDigest:hashObject(oldOrder)}, result = structuredClone(visualPlan);
  result.beats[1].directorBrief.mustShow = '同一对象在当前范围内的新观看要求';
  result.beats[1].incomingTransition = {
    type: "dissolve", durationMs: 600, reason: "接住前一镜已认出的对象，再看清区别"
  };
  Object.assign(result.beats[1].directorBrief, {entryFocus:'原场面', reveal:'看清对象的区别', exitHold:'保留区别到下一镜'});
  result.beats[2].directorBrief.relationFromPrevious = '承接前拍新关系，保留本拍原场面';
  await write(work.candidate,{taskDigest:task.taskDigest,result});
  await write(work.workOrder,task);
  assert.equal((await runNext(options)).taskDigest, task.taskDigest);
  assert.deepEqual(await readData(work.workOrder), task);
  assert.deepEqual(await readData(work.candidate), {taskDigest:task.taskDigest,result});
  const view = JSON.parse(execFileSync(process.execPath, [path.join(root,'packages/p3-task-view.mjs'),work.workOrder],
    {encoding:'utf8'}));
  result.understanding = view.inputs.currentVisualPlan.understanding;
  await write(work.candidate,{taskDigest:task.taskDigest,result});
  assert.equal((await inspectCurrentDirectorCandidate({workOrderPath:work.workOrder,candidatePath:work.candidate})).authorable,true);
  for (const entry of ['inspect-boundaries','lock-boundaries']) execFileSync(process.execPath,
    [path.join(root,`packages/modules/direct-episode/${entry}.mjs`),work.workOrder,work.candidate],{stdio:['ignore','pipe','pipe']});
  await acceptCandidate(options);
  const retained = await readData(paths.storyboard);
  for (const index of [0,1,2]) assert.deepEqual(retained.beats[index].treatment,original.beats[index].treatment);
  assert.deepEqual(retained.features,original.features);
  const revision = await readData(work.returnRequest('author'));
  assert.deepEqual(revision.pendingAuthorUnitIds,['B002','B003']);
  assert.deepEqual(revision.selectedBeatIds,['B002','B003']);
  const next = await runNext(options);
  assert.equal(next.taskId,'ep01/B002/author');
  const author = await readData(getStageWorkPaths(paths,'p3','TR002').workOrder);
  assert.deepEqual(author.inputs.currentTreatment,original.beats[1].treatment);
  assert.deepEqual(author.inputs.currentFeatureResults['cue-sync'],original.features['cue-sync'].bindings.B002);
  assert.deepEqual(author.inputs.currentFeatureResults['sound-effects'],original.features['sound-effects'].units.B002);
  assert.deepEqual(author.inputs.repairBeatIds,['B002']);
  assert.equal(sha256(await readFile(soundFile)),soundAsset.sha256);
});

test('指定段返工先执行，其它段的原候选和临时材料保持原位', async t => {
  const {options, paths, work} = await setup(t);
  const original = await runNext(options);
  assert.equal(original.taskId, 'ep01/B002/author');
  const saved = await readData(work.workOrder);
  const draft = {taskDigest:saved.taskDigest, result:{draft:'未完成的原候选'}};
  await write(work.candidate, draft);
  const marker = path.join(options.workspaceRoot, saved.scratchPath, 'retained-step.json');
  await write(marker, {value:'原临时材料'});
  const storyBefore = await readFile(paths.storyboard);
  const revision = await runNext({...options, redesignBody:true, redesignBeatIds:['B001','B004'], revisionReason:'重做指定讲解'});
  assert.equal(revision.taskId, 'ep01/TR001/author');
  assert.deepEqual(await readData(work.workOrder), saved);
  assert.deepEqual(await readData(work.candidate), draft);
  assert.deepEqual(await readFile(paths.storyboard), storyBefore);
  assert.equal((await runNext(options)).taskDigest, revision.taskDigest);
  for (const [unit, cueId] of [['TR001',1], ['TR003',4]]) {
    const selected = getStageWorkPaths(paths, 'p3', unit);
    const order = await readData(selected.workOrder);
    assert.equal(order.inputs.authorUnit.id, unit);
    await write(selected.candidate, {taskDigest:order.taskDigest, result:{treatment:vox(cueId), featureResults:{'cue-sync':cueResult(cueId)}}});
    await acceptCandidate({...options,segmentId:unit});
    assert.equal((await deriveStatus(options)).taskId, unit === 'TR001' ? 'ep01/TR003/author' : original.taskId);
    await runNext(options);
  }
  assert.deepEqual(await readData(work.workOrder), saved);
  assert.deepEqual(await readData(work.candidate), draft);
  assert.deepEqual(await readData(marker), {value:'原临时材料'});
});

test('未知远端或未点名范围不插入返工，保留原单与正式成果', async t => {
  const {options, paths, work} = await setup(t);
  await runNext(options);
  const before = await readFile(work.workOrder), story = await readFile(paths.storyboard);
  await assert.rejects(runNext({...options, redesignBody:true}), /指定范围/);
  const order = await readData(work.workOrder);
  await write(path.join(options.workspaceRoot, order.scratchPath, 'generation.json'), {status:'calling'});
  await assert.rejects(runNext({...options, redesignBody:true, redesignBeatIds:['B002']}), /先恢复原远端/);
  assert.deepEqual(await readFile(work.workOrder), before);
  assert.deepEqual(await readFile(paths.storyboard), story);
  await assert.rejects(readFile(work.returnRequest('author')), {code:'ENOENT'});
});

test('只读画面参考刷新可恢复原身份，当前字幕与实际相邻输入变化仍拒绝', () => {
  const base = {stageId:'p3', moduleId:'author-beat', resolvedAssembly:{slots:[]},
    inputs:{templateContext:{priorVisuals:[{unitId:'TR001', pictures:[{purpose:'旧图'}]}]},
      cues:[{id:3,text:'原口播'}], previousTreatment:{continuity:{location:'原现场'}}}};
  const updated = structuredClone(base);
  updated.inputs.templateContext.priorVisuals = [{unitId:'TR001', pictures:[{purpose:'新图', asset:{sha256:'a'.repeat(64)}}]}];
  assert.doesNotThrow(() => assertTaskContinuity(base, updated));
  updated.inputs.cues[0].text = '改变的口播';
  assert.throws(() => assertTaskContinuity(base, updated), /输入/);
  updated.inputs.cues = base.inputs.cues;
  updated.inputs.previousTreatment.continuity.location = '改变的现场';
  assert.throws(() => assertTaskContinuity(base, updated), /输入/);
});

test('导演基线及自动承接说明更新时，业务输入一致的返工单可继续', () => {
  const base = {stageId:'p3', moduleId:'author-beat', resolvedAssembly:{slots:[]}, inputs:{
    templateContext:{}, authorUnit:{id:'B003', beatIds:['B003']}, cues:[{id:3,text:'原口播'}],
    previousTreatment:{continuity:{location:'原现场'}}, p3BodyRedesign:{
      baselineVisualPlanSha256:'a'.repeat(64),
      reason:'去掉指定画外文字', selectedBeatIds:['B001','B002','B003'], pendingAuthorUnitIds:['B002','B003']
    }
  }};
  const updated = structuredClone(base);
  updated.inputs.p3BodyRedesign.baselineVisualPlanSha256 = 'b'.repeat(64);
  assert.doesNotThrow(() => assertTaskContinuity(base, updated));
  updated.inputs.p3BodyRedesign.reason = '前一单元 B001 的实际承接末态改变，修订 B002 的承接部分';
  assert.doesNotThrow(() => assertTaskContinuity(base, updated));
  assert.equal(base.inputs.p3BodyRedesign.reason, '去掉指定画外文字');
  updated.inputs.cues[0].text = '实际改了口播';
  assert.throws(() => assertTaskContinuity(base, updated), /输入/);
  updated.inputs.cues = base.inputs.cues;
  updated.inputs.previousTreatment.continuity.location = '实际改了前镜';
  assert.throws(() => assertTaskContinuity(base, updated), /输入/);
  updated.inputs.previousTreatment = base.inputs.previousTreatment;
  updated.inputs.p3BodyRedesign.reason = '重画整张人物';
  assert.throws(() => assertTaskContinuity(base, updated), /输入/);
});
