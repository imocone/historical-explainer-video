import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {contribute,musicPlaybackContext} from './render-entry.mjs';
import {prepareRenderPublic} from '../../modules/render-video/runtime/public-files.mjs';
import {assertRenderPlanFiles} from '../../modules/render-video/runtime/episode-props.mjs';
import {assertAudioTracks} from '../../modules/render-video/runtime/render-contracts.mjs';

const configure = (t,values) => {
  const names=['BACKGROUND_MUSIC_FILE','BACKGROUND_MUSIC_SOURCE','BACKGROUND_MUSIC_RIGHTS'];
  const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]=values[name]??'';
  t.after(()=>{for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}});
};

test('公开安装无配乐时仍可贡献空音轨，节目来源选择不受本机配置影响',t=>{
  configure(t,{});
  assert.deepEqual(musicPlaybackContext({featureData:{}}),{enabled:false});
  assert.deepEqual(contribute({phase:'audio-tracks',featureData:{}}),{audioTracks:[]});
  const source={id:'SA001',mediaType:'audio',path:'score.wav',sha256:'a'.repeat(64),rightsStatus:'licensed'};
  const playback=musicPlaybackContext({featureData:{sourceAssetId:'SA001'},episodeId:'ep01',sourceAssets:[source]});
  assert.equal(playback.source.file,'ep01/制作/input/score.wav');
  assert.deepEqual(musicPlaybackContext({featureData:{enabled:false,sourceAssetId:'SA001'}}),{enabled:false});
  assert.throws(()=>musicPlaybackContext({featureData:{sourceAssetId:'missing'},sourceAssets:[]}),/未登记来源/u);
});

test('个人音乐沿原上下文和音轨交付；文件不冒充许可，显式关闭不读取它',async t=>{
  await mkdir(fileURLToPath(new URL('../../../local-media/background-music/',import.meta.url)),{recursive:true});
  const directory=await mkdtemp(fileURLToPath(new URL('../../../local-media/background-music/.music-test-',import.meta.url)));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'score.wav');
  const bytes=Buffer.from('本地测试音频身份');await writeFile(file,bytes);
  configure(t,{BACKGROUND_MUSIC_FILE:file,BACKGROUND_MUSIC_SOURCE:'本地测试自制配乐',BACKGROUND_MUSIC_RIGHTS:'public-domain'});
  const playback=musicPlaybackContext({featureData:{}});
  assert.equal(playback.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(playback.source.sourceCitation,'本地测试自制配乐');
  const result=contribute({phase:'audio-tracks',featureData:{},bodyOffsetMs:1000,bodyEndMs:6000,fps:60});
  const track=result.audioTracks[0];
  assert.equal(track.file,playback.source.file);assert.equal(track.volume,0.2);assert.equal(track.loop,true);
  assert.equal(track.startMs,1000);assert.equal(track.endMs,6000);assert.equal(track.fadeInFrames,60);assert.equal(track.fadeOutFrames,120);
  assertAudioTracks({audioTracks:[track],segments:[{segmentType:'body',startMs:1000,endMs:6000}],bodyTimelineStartMs:1000,durationMs:6000});
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'personal-music-public-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const systemRoot=fileURLToPath(new URL('../../../',import.meta.url));
  const renderPlan={segments:[],overlays:[],audioTracks:[track],visualStyle:{shared:{fonts:{}}}};
  await assertRenderPlanFiles({root:workspaceRoot,systemRoot,renderPlan});
  const publicDirectory=path.join(workspaceRoot,'public');
  await prepareRenderPublic({workspaceRoot,systemRoot,episode:'ep01',renderPlan,publicDirectory});
  assert.deepEqual(await readFile(path.join(publicDirectory,track.file)),bytes,'P4使用原音频字节准备公开播放资源');
  process.env.BACKGROUND_MUSIC_RIGHTS='';
  assert.throws(()=>musicPlaybackContext({featureData:{}}),/权利状态不可/u);
  process.env.BACKGROUND_MUSIC_FILE=file+'.missing';
  assert.deepEqual(musicPlaybackContext({featureData:{enabled:false}}),{enabled:false});
});
