import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadPackages, assertPackageResources } from '../../../engine/runtime/packages.mjs';
import { DEFAULT_OPENER_TEMPLATE_ID } from '../../opener-template-selection.mjs';
import { authoredImageJob, importAuthoredImage } from '../../authored-images.mjs';
import { buildImageRequests } from './asset-contract.mjs';
import { CROSS_FIRE, incomingCrossfirePresentation } from './render-policy.mjs';
import { openerBodyRefs } from '../../modules/author-bookend/dependency-projection.mjs';
import { fullframeRuntimeTimingForAuthorUnits } from '../fullframe-narrative/camera/author-transition-handoff.mjs';
import { renderData } from './render-plan.mjs';
import { sha256 } from '../../program-utils.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const sample=JSON.parse(await readFile(new URL('./examples/golden.json',import.meta.url),'utf8')).result;

test('第三片头进入现有正式目录，两个原片头和默认选择保留',async()=>{
  const packages=await loadPackages(root,{moduleIds:new Set(['author-bookend']),includeKinds:new Set(['template']),stageScoped:true});
  assert.deepEqual([...packages.keys()].sort(),['crossfire-opener','documentary-opener','episode-opener']);
  const third=packages.get('crossfire-opener');
  await assertPackageResources(root,third);
  for(const moduleId of ['author-narration','author-documentary-narration','author-bookend','render-video'])assert.ok(third.manifest.implements.some(item=>item.moduleId===moduleId));
  assert.equal(DEFAULT_OPENER_TEMPLATE_ID,'episode-opener');
});

test('可选前景沿原素材合同产生透明任务，正文依赖仍跟随三幅真实引用',()=>{
  const r=structuredClone(sample);
  r.flashbackShots[1].foreground={visualBrief:structuredClone(r.flashbackShots[1].visualBrief)};
  const entries=buildImageRequests({treatment:r});assert.equal(entries.length,4);
  const profile={stylePrompt:'测试画风',references:[]};
  assert.equal(authoredImageJob({request:entries[0].request,profile}).transparent_background,false);
  assert.equal(authoredImageJob({request:entries[3].request,profile}).transparent_background,true);
  assert.equal(entries[3].target,r.flashbackShots[1].foreground);
  assert.deepEqual(openerBodyRefs(r),['B001','B002','B003']);
});

test('画幅入场与正文相机分开计时，落定后整幅连续播放',()=>{
  const timing=fullframeRuntimeTimingForAuthorUnits({openerTemplate:'crossfire-opener',programForm:'historical-explainer',
    authorUnits:[{id:'B001',templateId:'fullframe-narrative',beats:[{cueRange:[1,1]}]}],cues:[{id:1,startMs:0,endMs:6000,text:"测试正文。"}]});
  const first=timing.segments[0];
  assert.equal(first.appliedEntranceLeadFrames,CROSS_FIRE.exitTransition.durationInFrames);
  assert.equal(first.appliedCameraPrerollFrames,50);
  const at=t=>incomingCrossfirePresentation({frame:Math.round((t-8)*60+CROSS_FIRE.exitTransition.durationInFrames),durationInFrames:CROSS_FIRE.exitTransition.durationInFrames});
  assert.equal(at(6.4).opacity,0);
  assert.match(at(6.8).clipPath,/polygon/);
  assert.deepEqual(at(7.2),{opacity:1});
  assert.deepEqual(at(6.8),at(6.8),'逆向定位不能积累动画状态');
});

test('固定音轨使用实际母版，落定重音与5.38秒口播容量闭合',async()=>{
  const tracks=renderData({fps:60}).audioTracks;
  for(const track of tracks){assert.equal(sha256(await readFile(path.join(root,track.file))),track.sha256);assert.ok(track.endFrame<=480);}
  assert.equal(tracks.find(track=>track.id==='crossfire-land').startFrame,430);
  assert.equal(CROSS_FIRE.maxNarrationMs+CROSS_FIRE.narrationStartMs,5480);
});

test('独立前景在首次图片交付拒绝不透明文件，不进入合成',async t=>{
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'crossfire-alpha-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const visual=JSON.parse(await readFile(path.join(root,'visuals/modern-editorial/visual-package.json'),'utf8'));
  const r=structuredClone(sample);r.flashbackShots[1].foreground={visualBrief:structuredClone(r.flashbackShots[1].visualBrief)};
  const {request}=buildImageRequests({treatment:r})[3],profile={stylePrompt:'测试画风',references:[]};
  await assert.rejects(importAuthoredImage({workspaceRoot,episodeId:'ep01',stageId:'p4',unitId:'opener',request,profile,
    sourceFile:path.join(root,'visuals/modern-editorial',visual.masterReference.path),job:authoredImageJob({request,profile})}),/实际带透明区域/);
});

test('三种片头沿原接纳器区分旁白，不跳过第三模板的正式音频证据',async t=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),'crossfire-voice-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const {validateStoredAcceptance}=await import('../../modules/author-bookend/validate.mjs');
  assert.deepEqual(await validateStoredAcceptance({result:{templateId:'documentary-opener'},root:workspace,episodeId:'ep01'}),[]);
  for(const templateId of ['episode-opener','crossfire-opener']){
    const errors=await validateStoredAcceptance({result:{templateId,flashbackLine:sample.flashbackLine},root:workspace,episodeId:'ep01'});
    assert.ok(errors.length>0);
    assert.ok(errors.every(error=>!error.includes('未知片头模板')));
  }
});
