import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {acceptCandidate, deriveStatus, hashObject, readData, runNext, sha256} from './runtime.mjs';
import {assertTaskContinuity} from './runtime/tasks.mjs';
import {getEpisodePaths, getProgramPaths, getStageWorkPaths} from '../packages/workspace-paths.mjs';
import {createAppearance} from '../packages/templates/vox-explainer/appearance.mjs';

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
  await write(paths.sourceAssets, {assets:[]});
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

test('自动承接说明不使其它返工单失效，真实修改意见和输入变化仍拒绝', () => {
  const base = {stageId:'p3', moduleId:'author-beat', resolvedAssembly:{slots:[]}, inputs:{
    templateContext:{}, authorUnit:{id:'B003', beatIds:['B003']}, cues:[{id:3,text:'原口播'}],
    previousTreatment:{continuity:{location:'原现场'}}, p3BodyRedesign:{
      reason:'去掉指定画外文字', selectedBeatIds:['B001','B002','B003'], pendingAuthorUnitIds:['B002','B003']
    }
  }};
  const updated = structuredClone(base);
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
