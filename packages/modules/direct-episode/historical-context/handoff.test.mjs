import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {atomicWriteData, hashObject, readData} from '../../../program-utils.mjs';
import {getEpisodePaths} from '../../../workspace-paths.mjs';
import {publishHistoricalContext, bindHistoricalContext} from './handoff.mjs';

const write = atomicWriteData;
const cuesFor = texts => texts.map((text, index) => ({
  id: index + 1, text, startMs: index * 2000, endMs: (index + 1) * 2000
}));

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'historical-context-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const candidatePath = path.join(root, 'ep01/制作/p3/_work/candidate.yaml');
  const workOrderPath = path.join(path.dirname(candidatePath), 'work-order.yaml');
  const input = getEpisodePaths(root, 'ep01').input;
  const base = {stageId: 'p3', nodeId: 'director', moduleId: 'direct-episode', subject: {id: 'ep01'},
    candidatePath: path.relative(root, candidatePath), scratchPath: 'ep01/制作/p3/_work/scratch',
    resolvedAssembly: {node: {id: 'director', moduleId: 'direct-episode'}, module: {id: 'direct-episode'}},
    inputs: {cues: cuesFor(['测试场面1', '测试场面2', '测试场面3']), sourceAssets: [],
      templates: [{id: 'fullframe-narrative'}, {id: 'vox-explainer'}]}};
  const task = {...base, taskDigest: hashObject(base)};
  const result = {understanding: {
    episodeQuestion: '如何辨认变化？', thesis: '比较场景', narrativeArc: {start: '观察', turn: '比较', end: '确认'},
    facts: [], relations: [], evidence: [], uncertainties: [], mustNotInvent: ['不增加数量'],
    semanticReading: {underlyingMeaning: '理解变化', audienceStartingPoint: '尚未比较', targetUnderstanding: '看见区别',
      speakerStances: [], contextConstraints: [], rhetoricalReadings: [], humanStakes: []}
  }, albumPlan: {intent: '测试', openingState: '进入', progression: '变化', endingState: '结束', recurringElements: []},
    beats: [[1, 2], [3, 3]].map((cueRange, i) => ({id: `B00${i+1}`, cueRange,
      templateId: i ? 'vox-explainer' : 'fullframe-narrative', viewerOutcome: '看清对象',
      directorBrief: {roleInAlbum: '推进', mustShow: `原观看内容${i+1}`, relationFromPrevious: i ? '承接' : null}})),
    templateRuns: [{id: 'TR001', templateId: 'fullframe-narrative', beatIds: ['B001']},
      {id: 'TR002', templateId: 'vox-explainer', beatIds: ['B002']}]};
  await write(workOrderPath, task);
  await write(candidatePath, {taskDigest: task.taskDigest, result});
  await write(getEpisodePaths(root, 'ep01').sourceAssets, {schemaVersion: '1.0', assets: []});
  const scratch = path.join(root, task.scratchPath, 'historical-context');
  await mkdir(scratch, {recursive: true});
  await writeFile(path.join(scratch, 'note.md'), '独立夹具的衣装与环境说明，不是历史证据。');
  await writeFile(path.join(scratch, 'portrait.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'));
  const meta = {creator: 'test', date: null, rightsStatus: 'permission-granted', sourceCitation: '离线夹具，不是历史依据', usageNotes: '只验证交接'};
  const finding = {features: '测试可见结构', evidence: ['note'], limits: '不证明历史事实'};
  const research = {taskDigest: task.taskDigest, title: '非生产视觉交接样本', materials: [
    {key: 'portrait', file: 'portrait.png', mediaType: 'photo', ...meta},
    {key: 'note', file: 'note.md', mediaType: 'document', ...meta}], contexts: [
    {cueRange: [1,1], period: '测试前期', place: '甲地', occasion: '出行', limits: '仅测试',
      people: [{subject: '甲', ageAndRole: '中年，测试角色', likeness: {basis: 'portrait', ...finding, evidence: ['portrait']}, clothing: finding}], environment: []},
    {cueRange: [3,3], period: '测试后期', place: '乙地', occasion: '劳动', limits: '仅测试',
      people: [], environment: [{subject: '木门', ...finding}]}]};
  const researchPath = path.join(scratch, 'research.json');
  await write(researchPath, research);
  return {root, input, task, result, candidatePath, workOrderPath, researchPath, research,
    sourceAssetsPath: getEpisodePaths(root, 'ep01').sourceAssets,
    publish: () => publishHistoricalContext({workOrderPath, researchPath}),
    bind: sourceId => bindHistoricalContext({workOrderPath, sourceId})};
}

async function reopen(f, {returnRequest, cues, cueRanges}) {
  const candidate = await readData(f.candidatePath);
  const {taskDigest: _, ...base} = structuredClone(f.task);
  base.inputs.currentVisualPlan = structuredClone(candidate.result);
  base.inputs.sourceAssets = (await readData(f.sourceAssetsPath)).assets;
  base.inputs.returnRequest = returnRequest;
  base.inputs.cues = cues;
  const taskDigest = hashObject(base);
  cueRanges?.forEach((range, index) => { candidate.result.beats[index].cueRange = range; });
  await write(f.workOrderPath, {...base, taskDigest});
  await write(f.candidatePath, {...candidate, taskDigest});
  return taskDigest;
}

test('完整考据登记并按Cue分发，重复恢复与拆Beat不串时期、不改观看原文', async t => {
  const f = await setup(t), signed = await readFile(f.workOrderPath, 'utf8');
  const a = await f.publish();
  assert.equal(a.source.id, 'SA003');
  assert.deepEqual(a.contexts[0].people[0].likeness.evidence, ['SA001']);
  assert.deepEqual(a.contexts[0].people[0].clothing.evidence, ['SA002']);
  const dossier = JSON.parse(await readFile(path.join(f.input, a.source.path)));
  assert.equal(dossier.contexts[1].environment[0].subject, '木门');
  await f.bind(a.source.id);
  const bound = await readFile(f.candidatePath, 'utf8');
  assert.equal((await f.publish()).source.id, a.source.id);
  await f.bind(a.source.id);
  assert.equal(await readFile(f.candidatePath, 'utf8'), bound);
  assert.equal(await readFile(f.workOrderPath, 'utf8'), signed);
  const candidate = await readData(f.candidatePath);
  assert.match(candidate.result.beats[0].directorBrief.mustShow, /^原观看内容1\n.*测试前期/u);
  assert.doesNotMatch(candidate.result.beats[0].directorBrief.mustShow, /测试后期/u);
  const second = structuredClone(candidate.result.beats[0]);
  candidate.result.beats[0].cueRange = [1,1];
  second.id = 'B003'; second.cueRange = [2,2]; second.directorBrief.relationFromPrevious = '继续';
  candidate.result.beats.splice(1,0,second);
  candidate.result.templateRuns[0].beatIds.push('B003');
  await write(f.candidatePath, candidate);
  const boundAgain = await f.bind(a.source.id);
  assert.deepEqual(boundAgain.bindings.map(x => x.beatId), ['B001','B002']);
  assert.equal((await readData(f.candidatePath)).result.beats[1].directorBrief.mustShow, '原观看内容1');
  const updated = structuredClone(f.research);
  updated.materials = [{key:'portrait',sourceAssetId:'SA001'},{key:'note',sourceAssetId:'SA002'}];
  updated.contexts[0].people[0].clothing.features = '补查后修正衣装，保留另一时期环境';
  await write(f.researchPath, updated);
  const revised = await f.publish();
  await f.bind(revised.source.id);
  const next = await readData(f.candidatePath);
  assert.match(next.result.beats[2].directorBrief.mustShow, /测试后期/u);
  assert.ok(next.result.beats[2].directorBrief.mustShow.includes(revised.source.id));
  assert.deepEqual(revised.contexts[1], a.contexts[1]);
  assert.equal((await readData(getEpisodePaths(f.root,'ep01').sourceAssets)).assets.length,4);
});

test('已选画像漏原件、坏引用、缺文件及原件变化在候选写入前失败', async t => {
  const f = await setup(t), candidate = await readFile(f.candidatePath, 'utf8');
  const bad = structuredClone(f.research);
  bad.materials = bad.materials.filter(x => x.key !== 'portrait');
  bad.contexts[0].people[0].likeness.evidence = ['note'];
  await write(f.researchPath, bad);
  await assert.rejects(f.publish(), /没有可交接原图/u);
  assert.equal((await readData(getEpisodePaths(f.root,'ep01').sourceAssets)).assets.length, 0);
  bad.contexts[0].people[0].likeness.evidence = ['missing'];
  await write(f.researchPath, bad);
  await assert.rejects(f.publish(), /不存在的材料/u);
  await write(f.researchPath, {...f.research, materials: f.research.materials.map(x => x.key === 'note' ? {...x,file:'absent.md'} : x)});
  await assert.rejects(f.publish(), /ENOENT/u);
  await write(f.researchPath, f.research);
  const a = await f.publish();
  await writeFile(path.join(f.input, a.sourceAssets[0].path), '改写原图');
  await assert.rejects(f.bind(a.source.id), /原件内容与登记不一致/u);
  assert.equal(await readFile(f.candidatePath,'utf8'), candidate);
});

test('局部导演返工限定研究与交接范围，复用已登记原件', async t => {
  const f = await setup(t);
  const scopedResearch = structuredClone(f.research);
  scopedResearch.contexts[0].cueRange = [1, 3];
  await write(f.researchPath, scopedResearch);
  const published = await f.publish();
  await f.bind(published.source.id);
  const current = await readData(f.candidatePath);
  const cues = structuredClone(f.task.inputs.cues);
  cues[2].text = '范围外已更新的字幕不影响本次复用';
  const taskDigest = await reopen(f, {cues, returnRequest: {revisionScope:'director-revision',
    selectedBeatIds:['B001'], cueRefs:[1,2], baselineVisualPlanSha256:hashObject(current.result)}});
  const outside = current.result.beats[1];
  const reused = await f.bind(published.source.id);
  assert.deepEqual(reused.bindings.map(item => item.beatId), ['B001']);
  assert.deepEqual((await readData(f.candidatePath)).result, current.result);
  await write(f.researchPath,{...f.research,taskDigest});
  await assert.rejects(f.publish(), /超出本次导演修订/u);
  const research = {...f.research,taskDigest,contexts:[f.research.contexts[0]], materials:[
    {key:'portrait',sourceAssetId:'SA001'},{key:'note',sourceAssetId:'SA002'}]};
  research.contexts[0].people[0].clothing.features = '修改授权范围内衣装说明';
  await write(f.researchPath,research);
  const revised = await f.publish();
  await f.bind(revised.source.id);
  const result = (await readData(f.candidatePath)).result;
  assert.deepEqual(result.beats[1],outside);
  assert.equal(result.beats[0].directorBrief.mustShow.split('【历史视觉依据').length,2);
  assert.ok(result.beats[0].directorBrief.mustShow.includes(revised.source.id));
  assert.equal((await readData(getEpisodePaths(f.root,'ep01').sourceAssets)).assets.length,4);

  await reopen(f, {cues: f.task.inputs.cues, returnRequest: {target: 'director', reason: '整集重绑'}});
  await f.bind(revised.source.id);
  assert.deepEqual((await readData(f.candidatePath)).result, result);
  await f.bind(published.source.id);
  assert.deepEqual((await readData(f.candidatePath)).result, result);
  await f.bind();
  assert.deepEqual((await readData(f.candidatePath)).result, result);
  assert.equal((await readData(f.sourceAssetsPath)).assets.length, 4);

  const combined = cuesFor(['测试场面1', '测试场面2测试场面3']);
  await reopen(f, {cues: combined, cueRanges: [[1, 1], [2, 2]],
    returnRequest: {cueRebinding: {previousCues: f.task.inputs.cues}}});
  await f.bind();
  await reopen(f, {cues: f.task.inputs.cues, cueRanges: [[1, 2], [3, 3]],
    returnRequest: {cueRebinding: {previousCues: combined}}});
  await f.bind();
  const {beats} = (await readData(f.candidatePath)).result;
  assert.deepEqual(beats[0], result.beats[0], '再次拆分也不会把旧考据挂回修改过的章节');
  assert.match(beats[1].directorBrief.mustShow, /木门/u);
});

test('原文不变时随字幕拆合移动考据，实际改字仍返回导演', async t => {
  const f = await setup(t), original = await f.publish();
  await f.bind(original.source.id);
  const separate = cuesFor(['测试', '场面1', '测试场面2', '测试场面3']);
  await reopen(f, {cues: separate, cueRanges: [[1, 3], [4, 4]],
    returnRequest: {cueRebinding: {previousCues: f.task.inputs.cues}}});
  const command = path.join(import.meta.dirname, 'handoff.mjs');
  const {stdout} = await promisify(execFile)(process.execPath, [command, 'bind', f.workOrderPath]);
  const separated = JSON.parse(stdout);
  assert.deepEqual(separated.bindings.map(item => item.cueRanges), [[[1, 2]], [[4, 4]]]);
  const sourceId = separated.bindings[0].sourceId;
  const assets = (await readData(f.sourceAssetsPath)).assets;
  const asset = assets.find(item => item.id === sourceId);
  const dossier = await readData(path.join(f.input, asset.path));
  assert.deepEqual(dossier.sources, original.sourceAssets);
  const bound = await readData(f.candidatePath);
  await f.bind();
  assert.deepEqual(await readData(f.candidatePath), bound);
  assert.equal((await readData(f.sourceAssetsPath)).assets.length, assets.length);

  const joined = cuesFor(['测试', '场面1测试场面2测试场面3']);
  await reopen(f, {cues: joined, cueRanges: [[1, 1], [2, 2]],
    returnRequest: {cueRebinding: {previousCues: separate}}});
  const combined = await f.bind();
  assert.deepEqual(combined.bindings.map(item => item.cueRanges), [[[1, 2]], [[1, 2], [2, 2]]]);

  await reopen(f, {cues: separate, cueRanges: [[1, 3], [4, 4]],
    returnRequest: {cueRebinding: {previousCues: joined}}});
  const splitAgain = await f.bind();
  assert.deepEqual(splitAgain.bindings.map(item => item.cueRanges), [[[1, 2]], [[4, 4]]]);
  const beats = (await readData(f.candidatePath)).result.beats;
  assert.doesNotMatch(beats[0].directorBrief.mustShow, /测试后期/u);
  assert.doesNotMatch(beats[1].directorBrief.mustShow, /测试前期/u);

  await reopen(f, {cues: cuesFor(['测试', '场面甲', '测试场面2', '测试场面3']),
    returnRequest: {cueRebinding: {previousCues: separate}}});
  const before = await readData(f.candidatePath);
  const beforeAssets = await readData(f.sourceAssetsPath);
  await assert.rejects(f.bind(), /考据对应口播已改变/u);
  assert.deepEqual(await readData(f.candidatePath), before);
  assert.deepEqual(await readData(f.sourceAssetsPath), beforeAssets);
});

test('无历史对象的恢复输入不制造空来源；未知权利不把图当成可用原件', async t => {
  const f=await setup(t);
  await write(f.researchPath,{...f.research,materials:[],contexts:[],notApplicableReason:'全部为抽象数量比较，无历史对象'});
  assert.equal((await f.publish()).source,null);
  assert.equal((await readData(getEpisodePaths(f.root,'ep01').sourceAssets)).assets.length,0);
  f.research.materials[0].rightsStatus='unknown';
  await write(f.researchPath,f.research);
  await assert.rejects(f.publish(),/权利|授权/u);
});
