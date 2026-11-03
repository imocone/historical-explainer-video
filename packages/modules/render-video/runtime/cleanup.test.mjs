import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteData, fileSha256, hashObject } from '../../../program-utils.mjs';
import { cleanupEpisodeMedia, MEDIA_RETENTION, readRetainedDelivery } from './cleanup.mjs';
import { deriveStatus } from '../../../../engine/runtime/status.mjs';
import { recoverProgramCompletion } from '../../../../engine/runtime/program-execution.mjs';
import { runNext } from '../../../../engine/runtime/next.mjs';

const systemRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const put = async (file, content) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
const present = file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
async function fixture(t, { retained = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'render-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'programme'), tools = path.join(root, 'system');
  const episode = path.join(workspaceRoot, 'ep01'), production = path.join(episode, '制作');
  const formal = ['制作/p0/episode-brief.yaml', '制作/input/source-assets.yaml', '制作/p1/script-package.yaml',
    '制作/p1/release-main/publication.yaml', '制作/p2/narration.txt', '制作/p2/narration.srt', '制作/p2/narration-package.yaml',
    '制作/p3/storyboard.yaml', '制作/p4/episode-package.yaml', '制作/p4/video-plan.yaml',
    '制作/p5/release-main/request.yaml', '制作/p5/release-main/_work/intents/youtube/browser.yaml',
    '制作/p5/release-main/receipts/youtube.yaml', 'output/final.mp4', 'output/cover-youtube.png', 'output/cover-vertical.png', 'output/publication.txt'];
  for (const file of formal) await put(path.join(episode, file), JSON.stringify({ preserved: file }));
  const media = ['制作/input/photo.jpg', '制作/p2/raw-narration.flac', '制作/p2/narration.mp3',
    '制作/p3/assets/scene.png', '制作/p3/assets/drawing.svg', '制作/p35/opener-narration.mp3',
    '制作/p4/assets/video.mp4', 'output/trial.mp4', '制作/p3/_work/TR001/cache.bin',
    '制作/p4/_work/hyperframes/old/index.html', '制作/p3/_work/TR001/candidate.yaml'];
  for (const file of media) await put(path.join(episode, file), 'remove this derivative');
  await put(path.join(production, 'p2/narration.txt'), '保留的正式口播');
  await atomicWriteData(path.join(production, 'p2/narration-package.yaml'), {episodeId:'ep01', files:{
    narration:{path:'narration.txt',sha256:'a'.repeat(64)},
    audio:{path:'narration.mp3',sha256:'b'.repeat(64)},
    subtitles:{path:'narration.srt',sha256:'c'.repeat(64)} }});
  await put(path.join(production, 'p3/assets/scene.json'), '{"formalImageProvenance":true}');
  await put(path.join(production, 'p2/_work/tts-intent.yaml'), '{"status":"completed"}');
  await put(path.join(workspaceRoot, 'program.yaml'), '{"seriesTitle":"保留节目总资料"}');
  await put(path.join(workspaceRoot, 'ep02/制作/p3/assets/scene.png'), 'other episode');
  await put(path.join(workspaceRoot, 'materials/reference.png'), 'shared reference');
  const previewRoot = path.join(tools, 'tmp/vox-explainer-previews', hashObject(path.resolve(workspaceRoot)));
  await put(path.join(previewRoot, 'projects/ep01-TR001/index.html'), 'preview');
  await put(path.join(previewRoot, 'ep01-TR001.mp4'), 'preview video');
  await put(path.join(previewRoot, 'ep01-TR001-stills/frame.png'), 'preview still');
  await put(path.join(previewRoot, 'projects/ep02-TR001/index.html'), 'other preview');
  const historyRoot = path.join(root, 'native-history'), id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const project = path.join(previewRoot, 'projects/ep01-TR001');
  await put(path.join(project, '.hyperframes/history-id'), id);
  await atomicWriteData(path.join(historyRoot, id, 'project.json'), {dir:project});
  await put(path.join(historyRoot, id, 'blobs/image'), 'own hidden media copy');
  await put(path.join(historyRoot, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/blobs/image'), 'other hidden media copy');
  const receiptPath = path.join(production, 'p4/render-receipt.yaml');
  const business = { episodeId: 'ep01', output: 'ep01/output/final.mp4', sha256: await fileSha256(path.join(episode, 'output/final.mp4')),
    durationMs: 35000, ...(retained ? { mediaRetention: MEDIA_RETENTION } : {}),
    publicationTiming: { captions: [{text:'第一章',startMs:0,endMs:1000},{text:'第二章',startMs:12000,endMs:13000},{text:'第三章',startMs:24000,endMs:25000}] } };
  const receipt = { ...business, _producer: { moduleId:'render-video', nodeId:'render', taskDigest:'a'.repeat(64), inputs:[], outputSha256:hashObject(business) } };
  await atomicWriteData(receiptPath, receipt);
  const preserved = new Map(await Promise.all(formal.map(async file => [file, await readFile(path.join(episode, file), 'utf8')])));
  return { root, workspaceRoot, systemRoot:tools, episodeId:'ep01', episode, production, formal, media, previewRoot, historyRoot, preserved, receipt, receiptPath };
}

test('successful cleanup removes media and own previews, retaining documents, release files and neighbouring work', async t => {
  const f = await fixture(t);
  const originalReceipt = await readFile(f.receiptPath, 'utf8');
  const result = await cleanupEpisodeMedia(f);
  assert.ok(result.removedFiles >= f.media.length);
  for (const file of f.media) assert.equal(await present(path.join(f.episode, file)), false, file);
  for (const [file, content] of f.preserved) assert.equal(await readFile(path.join(f.episode, file), 'utf8'), content, file);
  assert.equal(await readFile(f.receiptPath, 'utf8'), originalReceipt);
  assert.equal(await present(path.join(f.production, 'p3/assets/scene.json')), true);
  assert.equal(await present(path.join(f.production, 'p2/_work/tts-intent.yaml')), true);
  assert.equal(await present(path.join(f.previewRoot, 'projects/ep01-TR001')), false);
  assert.equal(await present(path.join(f.previewRoot, 'ep01-TR001.mp4')), false);
  assert.equal(await present(path.join(f.previewRoot, 'ep01-TR001-stills')), false);
  assert.equal(await present(path.join(f.previewRoot, 'projects/ep02-TR001/index.html')), true);
  assert.equal(result.removedHistories, 1);
  assert.deepEqual(await readdir(f.historyRoot), ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  assert.equal(await readFile(path.join(f.workspaceRoot, 'ep02/制作/p3/assets/scene.png'), 'utf8'), 'other episode');
  assert.equal(await readFile(path.join(f.workspaceRoot, 'materials/reference.png'), 'utf8'), 'shared reference');
  assert.equal((await cleanupEpisodeMedia(f)).removedFiles, 0);
  const copied = await fixture(t);
  const copiedId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await atomicWriteData(path.join(copied.historyRoot,copiedId,'project.json'), {dir:path.join(copied.previewRoot,'projects/ep02-TR001')});
  await cleanupEpisodeMedia(copied);
  assert.equal(await present(path.join(copied.historyRoot,copiedId,'blobs/image')), true, '历史编号相同但归属其它项目时不删');
});

test('missing, changed or invalid final delivery, active work and symlinks never trigger deletions', async t => {
  for (const fault of ['missing', 'changed', 'receipt', 'active', 'symlink']) {
    const f = await fixture(t);
    if (fault === 'missing') await rm(path.join(f.episode, 'output/final.mp4'));
    if (fault === 'changed') await put(path.join(f.episode, 'output/final.mp4'), 'different video');
    if (fault === 'receipt') await atomicWriteData(f.receiptPath, { ...f.receipt, episodeId:'ep02' });
    if (fault === 'active') await put(path.join(f.production, 'p3/_work/TR002/work-order.yaml'), '{}');
    if (fault === 'symlink') await symlink(path.join(f.workspaceRoot, 'materials'), path.join(f.production, 'p3/linked'));
    await assert.rejects(cleanupEpisodeMedia(f), /保留|进行中|符号链接/);
    for (const file of f.media) assert.equal(await present(path.join(f.episode, file)), true, `${fault}: ${file}`);
  }
  const legacy = await fixture(t, { retained:false });
  await cleanupEpisodeMedia(legacy);
  assert.equal(await present(path.join(legacy.episode, legacy.media[0])), true, '既有未启用清理策略的成片不追溯清理');
  await rm(legacy.receiptPath);
  assert.equal(await readRetainedDelivery(legacy), null, '压片失败未交付时不清理');
});

test('original programme closeout resumes cleanup and retained stages stay complete without regenerating media', async t => {
  const f = await fixture(t);
  const journalPath = path.join(f.production, 'p4/_work/program-execution.yaml');
  await atomicWriteData(journalPath, { primitive:'program-render', moduleId:'render-video', nodeId:'render',
    taskDigest:'a'.repeat(64), outputPath:f.receiptPath, phase:'completed', outputSha256:hashObject(f.receipt) });
  assert.equal((await deriveStatus({root:systemRoot,workspaceRoot:f.workspaceRoot,episodeId:'ep01',stageId:'p4',targetId:'release-main'})).kind, 'recovery-required');
  await recoverProgramCompletion({root:systemRoot,workspaceRoot:f.workspaceRoot,episodeId:'ep01',stageId:'p4'});
  assert.equal(await present(journalPath), false);
  assert.equal(await present(path.join(f.episode, f.media[0])), false);
  for (const stageId of ['p1','p2','p3','p4']) {
    const status = await deriveStatus({root:systemRoot,workspaceRoot:f.workspaceRoot,episodeId:'ep01',stageId,targetId:'release-main'});
    assert.ok(['complete','stage-complete'].includes(status.kind), `${stageId}: ${JSON.stringify(status)}`);
    assert.equal(status.mediaRetention, MEDIA_RETENTION);
  }
  assert.equal((await runNext({root:systemRoot,workspaceRoot:f.workspaceRoot,episodeId:'ep01',stageId:'p4',targetId:'release-main'})).kind, 'complete');
  await put(path.join(f.production,'p4/_work/return-render.yaml'), JSON.stringify({target:'render',reason:'新的实际返工',cueRefs:[]}));
  const revised = await deriveStatus({root:systemRoot,workspaceRoot:f.workspaceRoot,episodeId:'ep01',stageId:'p4',targetId:'release-main'});
  assert.equal(revised.kind, 'blocked-upstream', '新的明确返工不能被旧成片完成状态掩盖');
  assert.equal(revised.upstreamStageId, 'p2', '返工如实报告已清理的配音缺口，不自动再次付费');
});
