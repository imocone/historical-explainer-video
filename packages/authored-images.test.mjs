import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {authoredImageJob, importAuthoredImage, verifyAuthoredImage} from './authored-images.mjs';
import {withMediaResources} from './modules/render-video/runtime/media-process.mjs';
import {withRenderQueueHeld} from './modules/render-video/runtime/media-test-helpers.test.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGUlEQVR4nGMUNA5lIAUwkaSaYVQDcYBkDQAXZACrFYSv9wAAAABJRU5ErkJggg==', 'base64');

test('image jobs reserve reference slots for sources, continuity and revisions', () => {
  const request = {sourceRefs: [], production: {groupRules: [], panel: {lines: ['完整画面']}}};
  const profile = {stylePrompt: '当前画法', references: Array.from({length: 5}, (_, index) => ({
    id: `style-${index}`, absolutePath: `/style-${index}.png`, styleScopes: ['palette']
  }))};
  const job = options => authoredImageJob({request, profile, ...options});
  assert.deepEqual(job({}).referenced_image_paths, profile.references.map(item => item.absolutePath));

  const continuity = job({previousImage: '/previous.png'});
  assert.deepEqual(continuity.referenced_image_paths,
    ['/style-0.png', '/style-1.png', '/style-2.png', '/style-3.png', '/previous.png']);
  assert.doesNotMatch(continuity.prompt, /参考图 5 只读取/u);

  const revision = job({previousImage: '/previous.png', revision: {file: '/original.png', reason: '修正手部'}});
  assert.deepEqual(revision.referenced_image_paths,
    ['/style-0.png', '/style-1.png', '/style-2.png', '/style-3.png', '/original.png']);
  assert.match(revision.prompt, /最后一张参考为待修正原图/u);

  assert.deepEqual(job({sourceImages: ['/source-1.png', '/source-2.png'], previousImage: '/previous.png'})
    .referenced_image_paths, ['/style-0.png', '/style-1.png', '/source-1.png', '/source-2.png', '/previous.png']);
  assert.throws(() => job({sourceImages: Array(5).fill('/source.png')}), /超过5张/u);
});

test('人物与环境原图按实际顺序绑定用途，修图仍携带原始依据', () => {
  const portrait = {id: 'SA002', path: 'sources/portrait.png', rightsStatus: 'public-domain',
    usageNotes: '甲人物中年画像，只参考面容比例；画像礼服不用于本镜日常场合'};
  const environment = {id: 'SA003', path: 'sources/building.jpg', rightsStatus: 'permission-granted',
    usageNotes: '当地同时期建筑，仅参考屋顶与木构，不继承现代展陈'};
  const note = {id: 'SA001', path: 'sources/note.md', rightsStatus: 'permission-granted', usageNotes: '考据笔记'};
  const request = {sourceRefs: ['SA001', 'SA002', 'SA003'],
    production: {groupRules: [], panel: {lines: ['甲穿本镜适用的便服，面貌依SA002，环境结构依SA003']}}};
  const profile = {stylePrompt: '当前画法', references: Array.from({length: 5}, (_, index) => ({
    id: `style-${index}`, absolutePath: `/style-${index}.png`, styleScopes: ['palette']
  }))};
  // Catalog order is deliberately different from the selected image order.
  const options = {request, profile, sourceAssets: [environment, note, portrait],
    sourceImages: ['/portrait.png', '/building.jpg']};
  const first = authoredImageJob(options);
  assert.deepEqual(first.referenced_image_paths,
    ['/style-0.png', '/style-1.png', '/style-2.png', '/portrait.png', '/building.jpg']);
  assert.ok(first.prompt.includes(`参考图 4 为来源原图 SA002；对应对象、时期和用途：${portrait.usageNotes}`));
  assert.ok(first.prompt.includes(`参考图 5 为来源原图 SA003；对应对象、时期和用途：${environment.usageNotes}`));
  assert.doesNotMatch(first.prompt, /为来源原图 SA001/u, '事实笔记不能冒充传入图片');
  const revised = authoredImageJob({...options, previousImage: '/generated-before.png',
    revision: {file: '/current.png', reason: '恢复本人面容比例，保留适用便服'}});
  assert.deepEqual(revised.referenced_image_paths,
    ['/style-0.png', '/style-1.png', '/portrait.png', '/building.jpg', '/current.png']);
  assert.match(revised.prompt, /参考图 3 为来源原图 SA002/u);
  assert.match(revised.prompt, /参考图 4 为来源原图 SA003/u);
  assert.match(revised.prompt, /不把画像中的礼服或背景自动沿用到其它场合/u);
  assert.throws(() => authoredImageJob({...options, sourceAssets: [environment, note,
    {...portrait, rightsStatus: 'unknown'}]}), /SA002/u);
});

test('same-process image import stays serialized and preserves the original image receipt', {timeout: 15000}, async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'authored-image-queue-'));
  const sourceFile = path.join(workspaceRoot, 'source.png');
  const options = {workspaceRoot, sourceFile, episodeId: 'ep01', stageId: 'p3', unitId: 'B001',
    request: {requestId: 'AR001', kind: 'fullframe', sourceRefs: [], mustNotInvent: [],
      production: {panel: {lines: ['完整画面']}, groupRules: []}},
    profile: {packageId: 'visual-test', version: '1.0.0', profileId: 'fullframe-image',
      profileDigest: 'a'.repeat(64), referenceId: 'style'},
    job: {prompt: '完整16:9画面', transparent_background: false}};
  let release, enter, pending;
  const entered = new Promise(resolve => { enter = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const holder = withMediaResources(async () => { enter(); await hold; });
  try {
    await writeFile(sourceFile, png);
    await entered;
    let completed = false;
    pending = importAuthoredImage(options).then(asset => { completed = true; return asset; });
    await delay(150);
    assert.equal(completed, false, '同一进程内仍须串行，避免进程监督互相清理');
    release(); await holder;
    const asset = await pending;
    assert.deepEqual(await readFile(path.resolve(workspaceRoot, asset.file)), png);
    assert.equal(asset.width, 16); assert.equal(asset.height, 9);
    assert.equal(await verifyAuthoredImage({...options, asset}), asset);
    const directory = path.dirname(path.resolve(workspaceRoot, asset.file));
    const delivered = await readdir(directory);
    await writeFile(sourceFile, 'invalid image');
    await assert.rejects(importAuthoredImage(options), /cannot identify image file/u);
    assert.deepEqual(await readdir(directory), delivered, '解码失败不得写入半份图片交付');
  } finally {
    release(); await Promise.allSettled([holder, pending]);
    await rm(workspaceRoot, {recursive: true, force: true});
  }
});

test('fullframe imports and explainer image inspection do not wait for another CLI render', {timeout: 90000}, async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'image-inspection-'));
  const sourceFile = path.join(workspaceRoot, 'source.png');
  try {
    await writeFile(sourceFile, png);
    await withRenderQueueHeld(async () => {
      const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
        import {importAuthoredImage,verifyAuthoredImage} from ${JSON.stringify(new URL('./authored-images.mjs', import.meta.url).href)};
        import {inspectImage} from ${JSON.stringify(new URL('./templates/vox-explainer/images.mjs', import.meta.url).href)};
        const options={workspaceRoot:${JSON.stringify(workspaceRoot)},sourceFile:${JSON.stringify(sourceFile)},
          episodeId:'ep01',stageId:'p3',unitId:'B001',request:{requestId:'AR001',kind:'fullframe',
            sourceRefs:[],mustNotInvent:[],production:{panel:{lines:['完整画面']},groupRules:[]}},
          profile:{packageId:'visual-test',version:'1.0.0',profileId:'fullframe-image',profileDigest:'a'.repeat(64),referenceId:'style'},
          job:{prompt:'完整16:9画面',transparent_background:false}};
        const asset=await importAuthoredImage(options);
        assert.deepEqual(await readFile(path.resolve(options.workspaceRoot,asset.file)),await readFile(options.sourceFile));
        assert.equal(await verifyAuthoredImage({...options,asset}),asset);
        const info=await inspectImage(options.sourceFile,{transparentBackground:false});
        assert.equal(info.width,16);assert.equal(info.height,9);
        console.log('verified');
      `], {timeout: 30000});
      assert.equal(stdout.trim(), 'verified');
    });
  } finally {
    await rm(workspaceRoot, {recursive: true, force: true});
  }
});

test('原生片头连续修图可恢复原调用并导入，不隐藏未完成修图', async t => {
  const {atomicWriteData,hashObject,readData}=await import('./program-utils.mjs');
  const {getEpisodePaths,getStageWorkPaths}=await import('./workspace-paths.mjs');
  const systemRoot=new URL('../',import.meta.url).pathname;
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'native-opener-revision-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const work=getStageWorkPaths(getEpisodePaths(workspaceRoot,'ep01'),'p4',null,'opener');
  const visual=await readData(path.join(systemRoot,'visuals/meiji-state-machine/visual-package.json'));
  await atomicWriteData(path.join(workspaceRoot,'program.yaml'),{visualPackage:{visualPackageId:visual.id,version:visual.version}});
  const base={stageId:'p4',moduleId:'author-bookend',subject:{id:'ep01'},candidatePath:path.relative(workspaceRoot,work.candidate),
    scratchPath:path.relative(workspaceRoot,path.join(work.work,'attempt-native')),inputs:{},
    resolvedAssembly:{slots:[{id:'opener-template',implementations:[{packageId:'episode-opener'}]}]}};
  const task={...base,taskDigest:hashObject(base)};
  await atomicWriteData(work.workOrder,task);
  await atomicWriteData(work.candidate,{taskDigest:task.taskDigest,result:(await readData(path.join(systemRoot,'packages/templates/episode-opener/examples/golden.json'))).result});
  const image=path.join(workspaceRoot,'native-output.png');await writeFile(image,png);
  const exec=promisify(execFile);
  const cli=async(...args)=>JSON.parse((await exec(process.execPath,[path.join(systemRoot,'packages/authored-images.mjs'),...args],{maxBuffer:1024*1024})).stdout);
  await cli('begin',work.workOrder,work.candidate,'opener/AR001');
  await cli('import',work.workOrder,work.candidate,'opener/AR001',image);
  for(const reason of ['只修手部','再修衣领']){
    const [started]=await cli('begin',work.workOrder,work.candidate,'opener/AR001','--revision-reason',reason);
    const pending=await cli('prepare',work.workOrder,work.candidate);
    const original=pending.find(item=>item.key==='opener/AR001');
    assert.equal(original.record.state,'calling');assert.equal(original.record.job.prompt,started.job.prompt);
    assert.ok(original.record.job.prompt.includes(reason));
    await cli('import',work.workOrder,work.candidate,'opener/AR001',image);
    assert.equal((await readData(work.candidate)).result.flashbackShots[0].asset.provider,'image-gen');
  }
});
