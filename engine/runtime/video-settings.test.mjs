import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {getEpisodePaths,getStageWorkPaths} from '../../packages/workspace-paths.mjs';
import {readData} from '../../packages/program-utils.mjs';
import {configureVideo,videoIsEnabled} from './video-settings.mjs';
import {withWorkflowWrite} from './acceptance-commit.mjs';

test('视频默认关闭，显式选择持久化，关闭保留已成方案与素材',async t=>{
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'video-settings-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const options={workspaceRoot,episodeId:'ep01',stageId:'p4'};
  const paths=getEpisodePaths(workspaceRoot,'ep01');
  const choose=video=>withWorkflowWrite(workspaceRoot,()=>configureVideo({...options,video}));
  assert.equal(await videoIsEnabled(options),false);
  await assert.rejects(readFile(paths.videoSettings),{code:'ENOENT'});
  await choose('on');
  assert.equal(await videoIsEnabled(options),true);
  await writeFile(paths.videoPlan,'existing plan');
  await writeFile(paths.videoManifest,'existing clips');
  await mkdir(path.dirname(paths.finalVideo),{recursive:true});
  await writeFile(paths.finalVideo,'existing final video');
  await choose('off');
  assert.equal(await videoIsEnabled(options),false);
  assert.equal(await readFile(paths.videoPlan,'utf8'),'existing plan');
  assert.equal(await readFile(paths.videoManifest,'utf8'),'existing clips');
  assert.equal(await readFile(paths.finalVideo,'utf8'),'existing final video');
  const repair=getStageWorkPaths(paths,'p4').returnRequest('render');
  assert.equal((await readData(repair)).target,'render');
  const before=await readFile(repair,'utf8');
  await choose('off');
  assert.equal(await readFile(repair,'utf8'),before);
});

test('视频选择沿公共路径边界拒绝符号链接改道',async t=>{
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'video-settings-path-'));
  const outside=await mkdtemp(path.join(os.tmpdir(),'video-settings-outside-'));
  t.after(()=>Promise.all([rm(workspaceRoot,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]));
  const options={workspaceRoot,episodeId:'ep01',stageId:'p4',video:'on'};
  const paths=getEpisodePaths(workspaceRoot,'ep01');
  await mkdir(path.dirname(paths.videoSettings),{recursive:true});
  const target=path.join(outside,'settings.yaml');
  await writeFile(target,'{"enabled":false}');
  await symlink(target,paths.videoSettings);
  await assert.rejects(configureVideo(options),/符号链接/);
  assert.equal(await readFile(target,'utf8'),'{"enabled":false}');
});
