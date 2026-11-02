import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {createAppearance} from './appearance.mjs';
import {drawingDigest, imageJob, imageJobs, loadImageProfile, importAuthoredImage, importSourceImage} from './images.mjs';
import {validate, validateAcceptance} from './validate.mjs';
import {authoredAssetsForTreatment} from './render-plan.mjs';
import {getEpisodePaths} from '../../workspace-paths.mjs';
import {sha256} from '../../program-utils.mjs';
import {projectRhetoricalBoundaries} from '../../modules/author-beat/projection.mjs';
import {projectRenderStoryboard} from '../../modules/render-video/runtime/projection.mjs';

// Already-imported image fixtures; no image generation, media lease or real episode.
async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'vox-image-references-'));
  t.after(() => rm(workspaceRoot, {recursive: true, force: true}));
  const workspace = {workspaceRoot, episodeId: 'ep99', unitId: 'TR001'};
  const directory = path.join(getEpisodePaths(workspaceRoot, workspace.episodeId).p3, 'assets', workspace.unitId);
  await mkdir(directory, {recursive: true});
  const appearance = createAppearance({palette: {background: '#ffffff', ink: '#202020', paper: '#f0f0f0',
    accent: '#c83c32', secondary: '#3268c8'}}), profile = await loadImageProfile(appearance);
  const request = (id, composition, referenceImageId) => ({requestId: id, purpose: '同一人物的形象',
    sourceRefs: ['C001'], mustNotInvent: ['测试示意'], exactTexts: [], transparentBackground: false,
    visualBrief: {composition}, ...(referenceImageId ? {referenceImageId} : {})});
  const parent = request('AR001', '人物穿蓝衣');
  const pose = request('AR002', '同一人物坐姿，保留衣装', 'AR001');
  const detail = request('AR003', '坐姿人物的局部，保留衣装', 'AR002');
  const separate = request('AR004', '独立器物');
  const treatment = {templateId: 'vox-explainer', appearance, objective: '观察同一对象',
    continuity: {period: '测试', location: '测试', subjects: [], props: []},
    moments: [{id: 'M001', purpose: '观察', sourceRefs: ['C001']}],
    scene: {markup: '<img src="asset:AR001"><img src="asset:AR002"><img src="asset:AR003"><img src="asset:AR004">', animation: ''},
    assetRequests: [parent, pose, detail, separate]};
  const cues = [{id: 1, text: '观察', startMs: 0, endMs: 6000}];
  const semanticContext = {};
  const bytes = await readFile(new URL('./references/comic-figures.png', import.meta.url));
  const changedBytes = await readFile(new URL('./references/comic-terrain.png', import.meta.url));
  const absolute = asset => path.resolve(workspaceRoot, asset.file);
  async function save(request, name, image, job) {
    if (!job) {
      const original = treatment.assetRequests.find(item => item.requestId === request.referenceImageId);
      const projected = projectRhetoricalBoundaries({assetRequests: [request]}, {semanticContext, cues}).assetRequests[0];
      job = imageJob({request: projected, treatment, profile,
        referenceImages: original ? [{kind: 'identity', file: absolute(original.asset)}] : []});
    }
    const file = path.join(directory, name + '.png'), promptFile = path.join(directory, name + '.json');
    const imageAppearance = {source: profile.source, art: profile.art, tone: profile.tone, digest: profile.digest};
    const prompt = {provider: 'image-gen', requestId: request.requestId, drawingDigest: drawingDigest(request),
      ...job, appearance: imageAppearance};
    await writeFile(file, image);
    await writeFile(promptFile, JSON.stringify(prompt));
    return {provider: 'image-gen', file: path.relative(workspaceRoot, file), sha256: sha256(image),
      mimeType: 'image/png', width: image.readUInt32BE(16), height: image.readUInt32BE(20),
      explainerPlacement: {contentBounds: {x: 0, y: 0, width: 1, height: 1}},
      drawingDigest: drawingDigest(request), appearance: imageAppearance,
      promptFile: path.relative(workspaceRoot, promptFile), promptSha256: sha256(await readFile(promptFile))};
  }
  for (const request of treatment.assetRequests) request.asset = await save(request, request.requestId + '-v1', bytes);
  const prepare = () => imageJobs({treatment, profile, semanticContext, cues, sourceAssets: [], ...workspace});
  const acceptance = () => validateAcceptance({result: treatment,
    context: {authorUnit: {id: workspace.unitId}, sourceAssets: [], semanticContext, cues}, services: {task: {}, ...workspace}});
  const renderAssets = () => authoredAssetsForTreatment({treatment: projectRenderStoryboard({understanding: semanticContext,
    beats: [{id: 'B001', templateId: treatment.templateId, cueRange: [1, 1], treatment}]}).beats[0].treatment,
    ...workspace, segmentId: workspace.unitId});
  return {workspace, treatment, profile, semanticContext, cues, parent, pose, detail, separate, bytes, changedBytes,
    save, absolute, prepare, acceptance, renderAssets};
}

test('原图内容修订逐级更新引用姿态，旧引用不能接纳或进入渲染，无关素材保留', async t => {
  const f = await fixture(t);
  const untouched = structuredClone(f.separate.asset);
  const oldParent = structuredClone(f.parent.asset), oldPose = structuredClone(f.pose.asset);
  assert.deepEqual(await f.prepare(), []);
  f.parent.visualBrief.composition = '人物改穿红衣';
  assert.deepEqual((await f.prepare()).map(item => item.requestId), ['AR001']);
  f.parent.asset = await f.save(f.parent, 'parent-v2', f.changedBytes);
  let jobs = await f.prepare();
  assert.deepEqual(jobs.map(item => item.requestId), ['AR002']);
  assert.ok((await f.acceptance()).some(error => error.includes('AR002')));
  await assert.rejects(f.renderAssets(), /原图.*变化/);
  assert.ok(jobs[0].job.referenced_image_paths.includes(f.absolute(f.parent.asset)));
  assert.ok(jobs[0].job.referenced_image_paths.includes(f.absolute(oldPose)), '修订仍携带姿态旧图');

  const premature = imageJob({request: f.detail, treatment: f.treatment, profile: f.profile,
    referenceImages: [{kind: 'identity', file: f.absolute(f.pose.asset)},
      {kind: 'revision', file: f.absolute(f.detail.asset)}]});
  await assert.rejects(importAuthoredImage({...f.workspace, request: f.detail, treatment: f.treatment,
    profile: f.profile, sourceAssets: [], sourceFile: f.absolute(f.detail.asset), job: premature}), /原图.*变化/);

  f.pose.asset = await f.save(f.pose, 'pose-v2', f.changedBytes, jobs[0].job);
  jobs = await f.prepare();
  assert.deepEqual(jobs.map(item => item.requestId), ['AR003']);
  assert.ok(jobs[0].job.referenced_image_paths.includes(f.absolute(f.pose.asset)));
  f.detail.asset = await f.save(f.detail, 'detail-v2', f.changedBytes, jobs[0].job);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual(f.separate.asset, untouched);
  for (const asset of [untouched, oldParent, oldPose])
    assert.equal(sha256(await readFile(f.absolute(asset))), asset.sha256, '原图及未受影响素材保留');
});

test('登记画像经原件导入到新姿态的真实请求，面貌用途与衣装限定保持', async t => {
  const f = await fixture(t);
  const input = getEpisodePaths(f.workspace.workspaceRoot, f.workspace.episodeId).input;
  await mkdir(path.join(input, 'sources'), {recursive: true});
  await writeFile(path.join(input, 'sources/portrait.png'), f.bytes);
  const source = {id: 'SA001', mediaType: 'photo', path: 'sources/portrait.png', sha256: sha256(f.bytes),
    sourceCitation: '独立测试图像，只证明参考交接', creator: null, date: null, rightsStatus: 'permission-granted',
    usageNotes: '甲人物中年面容参考；图中礼服与殿堂不用于本镜工作场合，不作为该事件发生的证明'};
  f.parent.sourceAssetId = source.id;
  f.parent.sourceRefs.push(source.id);
  f.parent.asset = await importSourceImage({...f.workspace, request: f.parent, sourceAssets: [source]});
  f.pose.sourceRefs.push(source.id);
  f.pose.visualBrief.composition = '甲人物在工地活动，面貌依AR001中年原件；穿适用工作衣装，不沿用画像礼服与殿堂';
  delete f.pose.asset;
  f.treatment.assetRequests = [f.parent, f.pose];
  f.treatment.scene.markup = '<img src="asset:AR002">';
  const options = {...f.workspace, treatment: f.treatment, profile: f.profile,
    semanticContext: f.semanticContext, cues: f.cues, sourceAssets: [source]};
  const [{job, requestId}] = await imageJobs(options);
  assert.equal(requestId, 'AR002');
  assert.equal(job.referenced_image_paths.at(-1), f.absolute(f.parent.asset));
  assert.ok(job.prompt.includes(`登记原件 SA001。对应对象、时期和用途：${source.usageNotes}`));
  assert.match(job.prompt, /不把画像中的礼服或背景自动沿用到其它场合/u);
  assert.doesNotMatch(job.prompt, /保持同一人物的面貌、衣装和装备/u);
  await assert.rejects(importAuthoredImage({...options, request: f.pose,
    sourceFile: f.absolute(f.parent.asset), job: {...job, referenced_image_paths: job.referenced_image_paths.slice(0, -1)}}),
  /缺失或变更时不能导入/u);
  f.pose.asset = await importAuthoredImage({...options, request: f.pose, sourceFile: f.absolute(f.parent.asset), job});
  const receipt = JSON.parse(await readFile(path.resolve(f.workspace.workspaceRoot, f.pose.asset.promptFile), 'utf8'));
  assert.deepEqual(receipt.referenced_image_paths, job.referenced_image_paths);
  assert.equal(receipt.prompt, job.prompt);
  assert.deepEqual(await imageJobs(options), []);
  assert.deepEqual(await validateAcceptance({result: f.treatment,
    context: {authorUnit: {id: f.workspace.unitId}, sourceAssets: [source], semanticContext: f.semanticContext, cues: f.cues},
    services: {task: {}, ...f.workspace}}), []);
  // A later pose still cites the original, not the generated pose.
  f.pose.visualBrief.composition += '；仅将手臂抬起';
  const [revision] = await imageJobs(options);
  assert.ok(revision.job.referenced_image_paths.includes(f.absolute(f.parent.asset)));
  assert.equal(revision.job.referenced_image_paths.at(-1), f.absolute(f.pose.asset));
  assert.ok(revision.job.prompt.includes(source.usageNotes));
});

test('补充画风参考保留旧调用的普通及登记原图链，身份与实际内容仍须一致', async t => {
  for (const registered of [false, true]) await t.test(registered ? '登记原件' : '普通原图', async t => {
    const f = await fixture(t), sourceAssets = [];
    if (registered) {
      const input = getEpisodePaths(f.workspace.workspaceRoot, f.workspace.episodeId).input;
      await mkdir(path.join(input, 'sources'), {recursive: true});
      await writeFile(path.join(input, 'sources/portrait.png'), f.bytes);
      sourceAssets.push({id: 'SA001', mediaType: 'photo', path: 'sources/portrait.png', sha256: sha256(f.bytes),
        sourceCitation: '本测试的登记原图', creator: null, date: null, rightsStatus: 'permission-granted',
        usageNotes: '同一人物的面貌依据，不提供衣装与场景'});
      f.parent.sourceAssetId = 'SA001';
      f.parent.sourceRefs.push('SA001');
      f.pose.sourceRefs.push('SA001');
      f.parent.asset = await importSourceImage({...f.workspace, request: f.parent, sourceAssets});
    }
    const oldStyle = {...f.profile.styles.general, references: f.profile.styles.general.references.slice(0, 1),
      stylePrompt: f.profile.styles.general.stylePrompt.replace(/\n\n第1张参考图提供共同画风。第2张参考图[^\n]+/u, '')};
    const oldProfile = {...f.profile, styles: {...f.profile.styles, general: oldStyle}};
    const calls = new Map();
    for (const request of f.treatment.assetRequests) {
      if (request.sourceAssetId) continue;
      const original = f.treatment.assetRequests.find(item => item.requestId === request.referenceImageId);
      const job = imageJob({request, treatment: f.treatment, profile: oldProfile,
        referenceImages: original ? [{kind: 'identity', file: f.absolute(original.asset),
          ...(original.asset.provider === 'source-asset' ? {source: original.asset.source} : {})}] : []});
      calls.set(request.requestId, job);
      request.asset = await f.save(request, `${request.requestId}-single-style`, f.bytes, job);
    }
    const options = {...f.workspace, treatment: f.treatment, profile: f.profile,
      semanticContext: f.semanticContext, cues: f.cues, sourceAssets};
    const acceptance = () => validateAcceptance({result: f.treatment,
      context: {authorUnit: {id: f.workspace.unitId}, sourceAssets,
        semanticContext: f.semanticContext, cues: f.cues}, services: {task: {}, ...f.workspace}});
    const retained = structuredClone(f.treatment.assetRequests.map(request => request.asset));
    assert.equal(f.profile.styles.general.references.length, 2);
    assert.equal(calls.get('AR002').referenced_image_paths.length, 2, '旧调用只有一张画风图和一张身份原图');
    assert.deepEqual(await imageJobs(options), []);
    assert.deepEqual(await acceptance(), []);
    assert.equal((await f.renderAssets()).length, 4);
    assert.deepEqual(f.treatment.assetRequests.map(request => request.asset), retained);
    for (const asset of retained.filter(asset => asset.promptFile))
      assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, asset.promptFile))), asset.promptSha256,
        '准备、接纳与渲染不改写旧调用');

    const oldPose = f.pose.asset, oldCall = calls.get('AR002');
    const identity = oldCall.prompt.split('\n').find(line => line.startsWith('第2张参考图是'));
    const invalidCalls = {
      缺少身份参考: oldCall.prompt.replace(identity, ''),
      重复身份参考: oldCall.prompt.replace('本段解释目标：', `${identity}\n\n本段解释目标：`),
      序号越界: oldCall.prompt.replace(identity, identity.replace('第2张', '第99张')),
      修图不是身份参考: oldCall.prompt.replace(identity, '第2张参考图是本件待修改的原图。')
    };
    if (registered) invalidCalls.登记身份不符 = oldCall.prompt.replace('登记原件 SA001。', '登记原件 SA002。');
    for (const [name, prompt] of Object.entries(invalidCalls)) {
      f.pose.asset = await f.save(f.pose, `invalid-${name}`, f.bytes, {...oldCall, prompt});
      assert.deepEqual((await imageJobs(options)).map(item => item.requestId), ['AR002'], name);
    }
    f.pose.asset = oldPose;
    if (registered) {
      const source = sourceAssets[0];
      await writeFile(path.join(getEpisodePaths(f.workspace.workspaceRoot, f.workspace.episodeId).input,
        source.path), f.changedBytes);
      source.sha256 = sha256(f.changedBytes);
      f.parent.asset = await importSourceImage({...f.workspace, request: f.parent, sourceAssets});
    } else {
      f.parent.visualBrief.composition += '，改穿红衣';
      f.parent.asset = await f.save(f.parent, 'parent-changed', f.changedBytes);
    }
    assert.deepEqual((await imageJobs(options)).map(item => item.requestId), ['AR002']);
    assert.ok((await acceptance()).some(error => error.includes('AR002')));
    await assert.rejects(f.renderAssets(), /原图.*变化/);
  });
});

test('只补同一事实引用或改布局时复用原图及其真实调用记录', async t => {
  const f = await fixture(t);
  const before = structuredClone(f.treatment.assetRequests.map(request => request.asset));
  const previousPrompt = imageJob({request: f.parent, treatment: f.treatment, profile: f.profile});
  f.semanticContext.facts = [{id: 'F001', cueRefs: [1]}];
  f.parent.sourceRefs.push('F001');
  f.treatment.scene.markup = '<div style="transform:translateX(20px)">' + f.treatment.scene.markup + '</div>';
  f.treatment.appearance.palette.background = '#ffffff';
  f.treatment.appearance.palette.paper = '#f8f8f8';
  Object.assign(f.profile, await loadImageProfile(f.treatment.appearance));
  assert.doesNotMatch(previousPrompt.prompt, /图文角色色：[^\n]*background/, '底板色不作为图件角色色投递');
  assert.notEqual(drawingDigest(f.parent), f.parent.asset.drawingDigest, '原请求摘要改变但绘图输入未变');
  assert.deepEqual(imageJob({request: f.parent, treatment: f.treatment, profile: f.profile}), previousPrompt);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual(f.treatment.assetRequests.map(request => request.asset), before);
  for (const asset of before)
    assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, asset.promptFile))), asset.promptSha256);
});

test('重写整段讲法与地点说明后，新旧图片按各自设计复用且原调用不改写', async t => {
  const f = await fixture(t);
  const retained = structuredClone([f.parent.asset, f.pose.asset, f.detail.asset]);
  f.treatment.objective = '改从实际作用\n解释同一对象的结果';
  f.treatment.continuity.location = '同一地点的资源过程示意';
  f.separate.visualBrief.composition = '为新讲法补充的独立量器';
  const jobs = await f.prepare();
  assert.deepEqual(jobs.map(item => item.requestId), ['AR004']);
  f.separate.asset = await f.save(f.separate, 'new-context', f.changedBytes, jobs[0].job);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual([f.parent.asset, f.pose.asset, f.detail.asset], retained);
  for (const asset of retained) {
    assert.equal(sha256(await readFile(f.absolute(asset))), asset.sha256);
    assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, asset.promptFile))), asset.promptSha256);
  }
});

test('设计和配色字段换序仍复用原图，导入保留原始参数且不忽略数组顺序', async t => {
  const f = await fixture(t);
  f.parent.visualBrief = {composition: '人物穿蓝衣\n保留衣料细节', styleReference: 'general',
    supportingEvidence: [{description: '人物形象依据', sourceRefs: ['C001']}],
    readingPath: ['先看人物', '再看衣装']};
  f.parent.asset = await f.save(f.parent, 'ordered-design', f.bytes);
  const before = structuredClone(f.parent.asset);
  const job = imageJob({request: f.parent, treatment: f.treatment, profile: f.profile,
    referenceImages: [{kind: 'revision', file: f.absolute(before)}]});
  f.parent.visualBrief = {readingPath: ['先看人物', '再看衣装'],
    supportingEvidence: [{sourceRefs: ['C001'], description: '人物形象依据'}],
    styleReference: 'general', composition: '人物穿蓝衣\n保留衣料细节'};
  f.treatment.appearance.palette = Object.fromEntries(Object.entries(f.treatment.appearance.palette).reverse());
  Object.assign(f.profile, await loadImageProfile(f.treatment.appearance));
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual(f.parent.asset, before);

  f.parent.asset = await importAuthoredImage({...f.workspace, request: f.parent, treatment: f.treatment,
    profile: f.profile, semanticContext: f.semanticContext, cues: f.cues,
    sourceFile: f.absolute(before), job});
  const saved = JSON.parse(await readFile(path.resolve(f.workspace.workspaceRoot, f.parent.asset.promptFile), 'utf8'));
  assert.equal(saved.prompt, job.prompt, '比较时规范化，不改写实际生图提示');
  assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, before.promptFile))), before.promptSha256);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  f.parent.visualBrief.readingPath.reverse();
  assert.deepEqual((await f.prepare()).map(item => item.requestId), ['AR001'], '实际阅读顺序变化仍需修图');
});

test('旧配色不能导入或靠当前样式摘要通过接纳，正确参数沿原链路恢复', async t => {
  const f = await fixture(t);
  const before = structuredClone(f.parent.asset);
  const job = imageJob({request: f.parent, treatment: f.treatment, profile: f.profile,
    referenceImages: [{kind: 'revision', file: f.absolute(before)}]});
  f.treatment.appearance.palette.accent = '#00ff00';
  Object.assign(f.profile, await loadImageProfile(f.treatment.appearance));
  await assert.rejects(importAuthoredImage({...f.workspace, request: f.parent, treatment: f.treatment,
    profile: f.profile, semanticContext: f.semanticContext, cues: f.cues,
    sourceFile: f.absolute(before), job}), /实际生图配色与当前讲解样式不一致/);
  assert.deepEqual(f.parent.asset, before);

  // Reproduce a prior incorrect import: old call, stamped with the current appearance.
  f.parent.asset = await f.save(f.parent, 'old-colors-current-stamp', f.bytes, job);
  assert.equal(f.parent.asset.appearance.digest, f.profile.digest);
  assert.deepEqual((await f.prepare()).map(item => item.requestId), ['AR001', 'AR004']);
  assert.ok((await f.acceptance()).some(error => error.includes('AR001图片与当前讲解样式不一致')));
  await assert.rejects(f.renderAssets(), /当前讲解样式不一致/);

  for (let round = 0; round < 3; round++) for (const {requestId, job: currentJob} of await f.prepare()) {
    const request = f.treatment.assetRequests.find(item => item.requestId === requestId);
    request.asset = await importAuthoredImage({...f.workspace, request, treatment: f.treatment,
      profile: f.profile, semanticContext: f.semanticContext, cues: f.cues,
      sourceFile: f.absolute(request.asset), job: currentJob});
  }
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, before.promptFile))), before.promptSha256);
});

test('整章时段扩展保留本件要求未变的图片，新旧调用并存且新导入仍核完整参数', async t => {
  const f = await fixture(t), before = structuredClone(f.parent.asset);
  const savedBytes = await readFile(path.resolve(f.workspace.workspaceRoot, before.promptFile));
  const oldJob = imageJob({request:f.parent, treatment:f.treatment, profile:f.profile,
    referenceImages:[{kind:'revision',file:f.absolute(before)}]});
  f.treatment.continuity.period = '测试时期及其随后一年的同一制度背景';
  f.separate.asset = await f.save(f.separate, 'new-scope-object', f.bytes);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual(f.parent.asset, before);
  assert.deepEqual(await readFile(path.resolve(f.workspace.workspaceRoot, before.promptFile)), savedBytes);
  await assert.rejects(importAuthoredImage({...f.workspace, request:f.parent, treatment:f.treatment,
    profile:f.profile, semanticContext:f.semanticContext, cues:f.cues,
    sourceFile:f.absolute(before), job:oldJob}), /实际生图参数与当前绘图输入不一致/);
});

test('本件时代形制及图片实际继承要求变化仍贯通准备、接纳与渲染', async t => {
  const changes = {
    时代: f => {
      f.treatment.continuity.period = '另一时期';
      f.parent.visualBrief.composition = '本件改为另一有据时代的立领长衣与不同袖型，人物形制须重画';
    },
    继承要求: f => { f.semanticContext.semanticReading = {rhetoricalReadings: [
      {cueRefs: [1], evidenceRefs: [], prohibitedLiteralization: '比喻不画成真实受伤'}]}; }
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async t => {
    const f = await fixture(t), before = structuredClone(f.parent.asset);
    change(f);
    if (name === '时代') assert.notEqual(drawingDigest(f.parent), before.drawingDigest,
      '时代形制的专业判断须落实到本件绘图输入');
    else assert.equal(drawingDigest(f.parent), before.drawingDigest, '继承输入仍由原投影核对');
    assert.deepEqual((await f.prepare()).map(item => item.requestId), name === '时代' ? ['AR001'] : ['AR001', 'AR004']);
    assert.ok((await f.acceptance()).some(error => error.includes('当前图片设计')));
    await assert.rejects(f.renderAssets(), /当前图片设计/);
    // Consume the prepared jobs in dependency order, using a local non-production fixture image.
    for (let round = 0; round < 3; round++) for (const {requestId, job} of await f.prepare()) {
      const request = f.treatment.assetRequests.find(item => item.requestId === requestId);
      request.asset = await f.save(request, `${requestId}-updated`,
        name === '时代' && requestId === 'AR001' ? f.changedBytes : f.bytes, job);
    }
    assert.deepEqual(await f.prepare(), []);
    assert.deepEqual(await f.acceptance(), []);
    assert.equal((await f.renderAssets()).length, 4);
    assert.equal(sha256(await readFile(f.absolute(before))), before.sha256);
    assert.equal(sha256(await readFile(path.resolve(f.workspace.workspaceRoot, before.promptFile))), before.promptSha256);
    assert.deepEqual(f.parent.mustNotInvent, ['测试示意'], '派生边界不写回作者设计');
  });
});

test('继承要求仅影响实际引用及当前作者范围，不因无关上游文字变化重做', async t => {
  const f = await fixture(t);
  f.semanticContext.semanticReading = {rhetoricalReadings: [
    {cueRefs: [2], evidenceRefs: ['E001'], prohibitedLiteralization: '其它段的比喻不得实化'}]};
  f.semanticContext.evidence = [{id: 'E001', cueRefs: [2]}];
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);

  const treatment = structuredClone(f.treatment);
  treatment.assetRequests[0].sourceRefs = ['C002'];
  const story = {understanding: f.semanticContext,
    beats: [{id: 'B002', cueRange: [2, 2]}, {id: 'B003', cueRange: [3, 3]}],
    templateRuns: [{id: 'TR002', templateId: 'vox-explainer', beatIds: ['B002', 'B003'], treatment}]};
  const projected = projectRenderStoryboard(story);
  assert.deepEqual(projected.templateRuns[0].treatment.assetRequests[0].mustNotInvent,
    ['测试示意', '其它段的比喻不得实化']);
  assert.deepEqual(projected.templateRuns[0].treatment.assetRequests[3].mustNotInvent, ['测试示意']);
  assert.deepEqual(treatment.assetRequests[0].mustNotInvent, ['测试示意']);
  assert.equal(projected.understanding, undefined, 'P4只接收实际图片要求');
});

test('图片导入核对本次真实绘图输入，旧参数不能被登记成当前设计', async t => {
  const f = await fixture(t);
  const job = imageJob({request: f.parent, treatment: f.treatment, profile: f.profile,
    referenceImages: [{kind: 'revision', file: f.absolute(f.parent.asset)}]});
  f.treatment.continuity.location = '已经改变的地点';
  await assert.rejects(importAuthoredImage({...f.workspace, request: f.parent, treatment: f.treatment,
    profile: f.profile, semanticContext: f.semanticContext, cues: f.cues,
    sourceFile: f.absolute(f.parent.asset), job}), /实际生图参数与当前绘图输入不一致/);
  const currentJob = imageJob({request: f.parent, treatment: f.treatment, profile: f.profile,
    referenceImages: [{kind: 'revision', file: f.absolute(f.parent.asset)}]});
  f.parent.asset = await importAuthoredImage({...f.workspace, request: f.parent, treatment: f.treatment,
    profile: f.profile, semanticContext: f.semanticContext, cues: f.cues,
    sourceFile: f.absolute(f.parent.asset), job: currentJob});
  assert.ok(!(await f.prepare()).some(item => item.requestId === 'AR001'));
});

test('原图内容未变时保留已有姿态，不因提示或文件名变化重做', async t => {
  const f = await fixture(t);
  const poses = structuredClone([f.pose.asset, f.detail.asset, f.separate.asset]);
  const oldParent = f.parent.asset;
  f.parent.visualBrief.composition += '，构图说明调整';
  assert.deepEqual((await f.prepare()).map(item => item.requestId), ['AR001']);
  f.parent.asset = await f.save(f.parent, 'parent-same-content', f.bytes);
  assert.notEqual(f.parent.asset.file, oldParent.file);
  assert.equal(f.parent.asset.sha256, oldParent.sha256);
  assert.deepEqual(await f.prepare(), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.deepEqual([f.pose.asset, f.detail.asset, f.separate.asset], poses);
  assert.equal((await f.renderAssets()).length, 4);
});

test('已上屏图件的原图引用链可只作参考，交付仍保留全部溯源素材', async t => {
  const f = await fixture(t);
  const assets = structuredClone(f.treatment.assetRequests.map(request => request.asset));
  const context = {cues: [{id: 1}]};
  f.treatment.scene.markup = '<img src="asset:AR003"><img src="asset:AR004">';
  assert.deepEqual(validate({result: f.treatment, context}), []);
  assert.deepEqual(await f.acceptance(), []);
  assert.equal((await f.renderAssets()).length, 4);
  assert.deepEqual(f.treatment.assetRequests.map(request => request.asset), assets);
  f.treatment.scene.markup += '<img src="asset:AR999">';
  assert.ok(validate({result: f.treatment, context}).includes('画面使用未声明图片: AR999'));
  f.treatment.scene.markup = '<img src="asset:AR003">';
  assert.deepEqual(validate({result: f.treatment, context}), ['图片没有进入画面: AR004']);
});
