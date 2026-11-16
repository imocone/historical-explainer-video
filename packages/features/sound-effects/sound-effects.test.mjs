import assert from 'node:assert/strict';
import test from 'node:test';
import {cp, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {contribute} from './render-entry.mjs';
import {soundTracksForSegment} from './timing.mjs';
import {audioTracksForWindow, scenePreviewProps} from '../../modules/render-video/runtime/scene-preview.mjs';
import {mixCompositionAudio} from '../../modules/render-video/runtime/audio-mix.mjs';
import {assertAudioTracks} from '../../modules/render-video/runtime/render-contracts.mjs';
import {resolveSceneEvents} from '../../templates/vox-explainer/scene.mjs';
import {bodyTransitionFieldsFor} from '../../modules/render-video/runtime/transitions.mjs';
import {musicEnvelopesForSegments} from '../background-music/dynamics.mjs';

const fps = 60;
const result = (target, action, offsetSeconds = 1) => ({events: [{id:'S001', purpose:'关键动作落定',
  soundId:'whoosh', ...(action === 'advance-explainer' ? {eventId:target === 'M999' ? 'E999' : 'E001'}
    : {anchor:{target, action, offsetSeconds}}), gain:.7, pan:-.5}]});
const segment = (id, templateId) => ({id, templateId, segmentType:'body', startMs:2000, endMs:8000,
  startFrame:120, durationInFrames:360, assetRefs: templateId === 'fullframe-narrative' ? [{}] : [],
  actionTimings:[{target:templateId === 'fullframe-narrative' ? 'AR001' : 'M001',
    action:templateId === 'fullframe-narrative' ? 'start-frame-motion' : 'advance-explainer', frame:0}],
  renderData: templateId === 'vox-explainer' ? {voxExplainer:{},eventTimings:[{id:'E001',frame:60}]} : {}});

test('两种模板共用真实事件时钟，动作时间变化传入画面和混音；视频替换不播放旧图事件', () => {
  const full = segment('B001','fullframe-narrative'), vox = segment('TR002','vox-explainer');
  const data = {units:{B001:result('AR001','start-frame-motion'), TR002:result('M001','advance-explainer')}};
  const video = {...segment('V001','cinematic-video'), beatIds:['B003']};
  data.units.B003 = result('AR001','start-frame-motion');
  const output = contribute({phase:'audio-tracks', featureData:data, segments:[full, vox, video], fps});
  assert.equal(output.audioTracks.length,2);
  assert.equal(vox.renderData.eventTimings[0].frame,60);
  assert.ok(output.audioTracks.every(track => track.startMs < 3000 && track.endMs > 3000));
  assert.doesNotThrow(() => assertAudioTracks({audioTracks:output.audioTracks,
    segments:[full,vox,video],durationMs:8000,fps}));
  vox.actionTimings[0].frame = 35;
  const scene={events:[{id:'E001',target:'M001',offsetSeconds:1}]};
  vox.renderData.eventTimings=resolveSceneEvents({scene,actionTimings:vox.actionTimings,fps,durationInFrames:360});
  const moved = soundTracksForSegment({segment:vox,result:data.units.TR002,fps});
  assert.equal(vox.renderData.eventTimings[0].frame,95);
  assert.ok(Math.abs(moved[0].startMs - output.audioTracks[1].startMs - 35/fps*1000) < 1e-8);
  assert.throws(() => soundTracksForSegment({segment:vox,result:result('M999','advance-explainer'),fps}), /找不到画面事件/u);
  assert.throws(() => soundTracksForSegment({segment:full,result:result('AR001','start-frame-motion',9),fps}), /超出本段/u);
  const retained=structuredClone(vox.renderData);
  assert.deepEqual(contribute({phase:'audio-tracks',featureData:{units:{TR002:{events:[]}}},segments:[vox],fps}).audioTracks,[]);
  assert.deepEqual(vox.renderData,retained,'移除声音不删除或改写画面事件');
});

test('局部预览的转场占位不解析声音，实际场景和已接纳声音时钟仍解析事件', () => {
  const actual = segment('TR002', 'vox-explainer');
  const placeholder = {id:'TR003', templateId:'vox-explainer', segmentType:'body',
    startMs:8000, endMs:14000, durationInFrames:360, assetRefs:[],
    ...bodyTransitionFieldsFor('vox-explainer')};
  const sound = {...result('M001', 'advance-explainer'), musicGestures:[{id:'G001',
    points:[{eventId:'E001', gain:.3}, {eventId:'E002', gain:1}]}]};
  actual.renderData.eventTimings.push({id:'E002', frame:120});
  const data = {units:{TR002:sound, TR003:sound}};
  const args = {phase:'audio-tracks', featureData:data, segments:[actual, placeholder], fps};
  const tracks = contribute(args).audioTracks;
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].sourceSegmentId, 'TR002');
  const musicArgs = {soundDesign:data, segments:args.segments, fps, trackStartMs:0};
  const envelopes = musicEnvelopesForSegments(musicArgs);
  assert.equal(envelopes.length, 1);
  const reference = {...actual, renderData:{eventTimings:actual.renderData.eventTimings}};
  assert.deepEqual(contribute({...args, segments:[reference]}).audioTracks, tracks,
    '已接纳的声音参考只含时钟也可正常播放');
  assert.deepEqual(musicEnvelopesForSegments({...musicArgs, segments:[reference]}), envelopes);
  const broken = {...actual, renderData:{...actual.renderData, eventTimings:[]}};
  assert.throws(() => contribute({...args, segments:[broken]}), /找不到画面事件 E001/u);
  assert.throws(() => contribute({...args, featureData:{units:{}}, segments:[actual]}), /缺少已启用音效交付/u);
});

test('Lemo声音的有效落点、截取和声像实际通过PCM混音，预演与成片截窗一致', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'lemo-sfx-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const vox = {...segment('TR001','vox-explainer'),startMs:0,startFrame:0,endMs:6000};
  const tracks = soundTracksForSegment({segment:vox,result:result('M001','advance-explainer'),fps});
  const file = tracks[0].file;
  const root = fileURLToPath(new URL('../../../',import.meta.url));
  await mkdir(path.dirname(path.join(directory,file)),{recursive:true});
  await cp(path.join(root,file),path.join(directory,file));
  const props = {fps,audioTracks:tracks};
  const fullPath = await mixCompositionAudio({props,timeline:{anchorMs:0,fromFrame:0,toFrame:360},projectDirectory:directory});
  const full = await readFile(fullPath);
  const slice = await mixCompositionAudio({props,timeline:{anchorMs:0,fromFrame:55,toFrame:120},projectDirectory:directory});
  const partial = await readFile(slice);
  const pcm = bytes => {const start=bytes.indexOf(Buffer.from('data'))+8; return bytes.subarray(start);};
  assert.deepEqual(pcm(partial),pcm(full).subarray(55*800*4,120*800*4),'跳转和最终封装读取同一声音片段');
  let left=0,right=0;
  const data=pcm(full);
  const soundEnd = Math.round(tracks[0].endMs * fps / 1000);
  assert.ok(data.subarray((soundEnd-1)*800*4,soundEnd*800*4).some(value => value !== 0),
    '完整音效的最后一帧保留原素材余韵');
  for(let i=0;i<data.length;i+=4){left+=data.readInt16LE(i)**2;right+=data.readInt16LE(i+2)**2;}
  assert.ok(left > right*4,'声像实际进入混音');
  const windowed = audioTracksForWindow({tracks,fromFrame:55,toFrame:120,fps});
  const preview = scenePreviewProps({segment:vox,audioTracks:windowed,lead:30});
  assert.equal(preview.audioTracks.length,1);
  assert.equal(preview.audioTracks[0].startMs,500);
  assert.equal(preview.audioTracks[0].sourceStartFrame,55-Math.round(tracks[0].startMs*fps/1000));
  const rebased = await mixCompositionAudio({props:{fps,audioTracks:windowed},
    timeline:{anchorMs:0,fromFrame:0,toFrame:65},projectDirectory:directory});
  assert.deepEqual(pcm(await readFile(rebased)),pcm(partial),'候选裁切连声音包络一起投影，不重启淡出');
});

test('余韵跨Beat保留，并在原节目结尾收口', () => {
  const full = {...segment('B001','fullframe-narrative'),startMs:0,durationInFrames:120};
  const data = {events:[{id:'S001',purpose:'关键落定',soundId:'ding',
    anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1.9}}]};
  const natural = soundTracksForSegment({segment:full,result:data,fps,durationMs:6000})[0];
  assert.equal(natural.startMs,1900);
  assert.equal(natural.endMs,3500);
  assert.equal(natural.fadeOutFrames,0);
  const closed = soundTracksForSegment({segment:full,result:data,fps,durationMs:3000})[0];
  assert.equal(closed.endMs,3000);
  assert.equal(closed.fadeOutFrames,2);
  const body = {...full,endMs:2000};
  assert.doesNotThrow(()=>assertAudioTracks({audioTracks:[closed],segments:[body],durationMs:3000,fps,
    ending:{afterSegmentType:'body',afterSegmentId:body.id,fadeEndMs:3000}}));
});

test('共享浮点混音限制真峰值，热信号裁窗与完整母线一致', async t => {
  const {runMediaProcess} = await import('../../modules/render-video/runtime/media-process.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(),'sfx-hot-mix-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await runMediaProcess('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
    'sine=frequency=1700:sample_rate=48000:duration=2','-ac','2','-c:a','pcm_f32le',path.join(directory,'hot.wav')]);
  const props = {fps,durationMs:2000,audioTracks:[{id:'sfx-hot',kind:'sound-effect',file:'hot.wav',
    startMs:0,endMs:2000,volume:32,loop:false}]};
  const file = await mixCompositionAudio({props,timeline:{anchorMs:0,fromFrame:0,toFrame:120},projectDirectory:directory});
  const full = await readFile(file);
  const measured = await runMediaProcess('ffmpeg',['-hide_banner','-nostats','-i',file,'-af',
    'ebur128=peak=true:framelog=verbose','-f','null','-'],{capture:true});
  const peak = Number([...measured.stderr.matchAll(/Peak:\s*([+-]?[\d.]+)\s*dBFS/g)].at(-1)[1]);
  assert.ok(peak <= -1,`真峰值 ${peak} dBFS`);
  const partial = await readFile(await mixCompositionAudio({props,
    timeline:{anchorMs:0,fromFrame:30,toFrame:90},projectDirectory:directory}));
  const pcm = bytes => bytes.subarray(bytes.indexOf(Buffer.from('data'))+8);
  assert.deepEqual(pcm(partial),pcm(full).subarray(30*800*4,90*800*4),'前瞻限制在裁窗前执行，保持同源');
});

test('下一段声音的准备声完整提前到前段，支持显式J-cut且不进入片头', () => {
  const next={...segment('B002','fullframe-narrative'),startMs:2000};
  const events={events:[{id:'S001',purpose:'下一场先声进入',soundId:'whoosh',
    anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:0}}]};
  const track=soundTracksForSegment({segment:next,result:events,fps,durationMs:8000})[0];
  assert.ok(track.startMs < 2000);
  assert.equal(track.sourceStartFrame,0,'不截去原准备声');
  const output=contribute({phase:'audio-tracks',featureData:{units:{B002:events}},segments:[next],
    fps,durationMs:8000,bodyOffsetMs:2000});
  assert.equal(output.audioTracks[0].startMs,2000,'正文首段不把音效带进片头');
  const earlier=structuredClone(events);
  earlier.events[0].anchor.offsetSeconds=-1;
  assert.deepEqual(soundTracksForSegment({segment:{...next,startMs:0,sourceStartMs:2000},
    result:earlier,fps,durationMs:2000}),[],'已在裁窗之前结束的J-cut不生成负时长音轨');
});

test('有旁白的完整母线按Lemo两遍响度整理，指定音乐在旁白下让位且源文件不改', async t => {
  const {runMediaProcess}=await import('../../modules/render-video/runtime/media-process.mjs');
  const directory=await mkdtemp(path.join(os.tmpdir(),'sfx-finish-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await runMediaProcess('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=2',
    '-af','volume=1.6,adelay=1000,apad=whole_dur=6','-ac','2','-c:a','pcm_s16le',path.join(directory,'voice.wav')]);
  await runMediaProcess('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=6',
    '-ac','2','-c:a','pcm_s16le',path.join(directory,'music.wav')]);
  const source=await readFile(path.join(directory,'music.wav'));
  const file=await mixCompositionAudio({projectDirectory:directory,timeline:{fromFrame:0,toFrame:360,anchorMs:0},
    props:{fps,durationMs:6000,audioTracks:[{id:'body-narration',kind:'narration',file:'voice.wav',startMs:0,endMs:6000,volume:1,loop:false},
      {id:'specified-bgm',kind:'background-music',file:'music.wav',startMs:0,endMs:6000,volume:.65,loop:false}]}});
  const {stdout:durationData}=await runMediaProcess('ffprobe',['-v','error','-show_entries','stream=duration_ts,time_base','-of','json',file],{capture:true});
  const pcmStream=JSON.parse(durationData).streams[0];
  assert.equal(pcmStream.time_base,'1/48000');
  assert.equal(pcmStream.duration_ts,6*48000,'响度和峰值处理不能缩短原PCM时间轴');
  assert.deepEqual(await readFile(path.join(directory,'music.wav')),source,'只在混音中平衡，不写音乐原件或配置');
  const measured=await runMediaProcess('ffmpeg',['-hide_banner','-nostats','-i',file,'-af','ebur128=peak=true:framelog=verbose','-f','null','-'],{capture:true});
  const loudness=Number([...measured.stderr.matchAll(/I:\s*([+-]?[\d.]+)\s*LUFS/g)].at(-1)[1]);
  assert.ok(Math.abs(loudness+14)<=1,`实测 ${loudness} LUFS`);
  const {stdout}=await runMediaProcess('ffmpeg',['-v','error','-i',file,'-af','bandpass=f=220:t=h:w=50',
    '-ar','48000','-ac','1','-f','f32le','-'],{capture:true,encoding:null});
  const rms=(a,b)=>{let sum=0,n=0;for(let i=Math.round(a*48000)*4;i<Math.round(b*48000)*4;i+=4){sum+=stdout.readFloatLE(i)**2;n++;}return Math.sqrt(sum/n);};
  assert.ok(rms(2,2.6)<rms(.2,.8)*.7,'同一音乐频带在旁白段实际降低');
});

test('正文音效在对白下让位，停顿中的音效不压低音乐，跨对白结尾的尾声保留', async t => {
  const {runMediaProcess} = await import('../../modules/render-video/runtime/media-process.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'body-effects-mix-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const tone = async (file, frequency, amplitude, duration) => {
    await runMediaProcess('ffmpeg', ['-v','error','-f','lavfi','-i',
      `aevalsrc=${amplitude}*sin(2*PI*${frequency}*t):s=48000:d=${duration}`,
      '-ac','2','-c:a','pcm_f32le',path.join(directory,file)]);
  };
  await runMediaProcess('ffmpeg', ['-v','error','-f','lavfi','-i',
    "aevalsrc=if(lt(t\\,2)\\,0.23\\,if(between(t\\,5\\,5.5)\\,0.027\\,0))*sin(2*PI*1000*t):s=48000:d=6",
    '-ac','2','-c:a','pcm_f32le',path.join(directory,'voice.wav')]);
  await tone('music.wav', 240, .09, 6);
  await tone('effect.wav', 3200, .28, 1.5);
  const track = (id, file, kind, startMs, endMs) => ({id, file, kind, segmentType:'body', startMs, endMs, volume:1});
  const props = {fps, durationMs:6000, audioTracks:[
    track('voice','voice.wav','narration',0,6000),
    track('music','music.wav','background-music',0,6000),
    track('under-voice','effect.wav','sound-effect',1000,2500),
    track('in-pause','effect.wav','sound-effect',3500,4500),
    track('under-quiet-voice','effect.wav','sound-effect',4700,6000)
  ]};
  const mix = (fromFrame, toFrame) => mixCompositionAudio({projectDirectory:directory, props,
    timeline:{anchorMs:0, fromFrame, toFrame}});
  const pcm = bytes => bytes.subarray(bytes.indexOf(Buffer.from('data')) + 8);
  const full = pcm(await readFile(await mix(0,360)));
  // The probes occupy separate frequencies. Measure only the intended stem
  // on each interval, with identical finishing gain on all windows.
  const amplitude = (frequency, from, to) => {
    let sin = 0, cos = 0;
    for (let sample = Math.round(from * 48000); sample < Math.round(to * 48000); sample++) {
      const angle = sample * 2 * Math.PI * frequency / 48000;
      const value = full.readInt16LE(sample * 4);
      sin += value * Math.sin(angle);
      cos += value * Math.cos(angle);
    }
    return Math.hypot(sin, cos) / ((to - from) * 48000);
  };
  const pausedEffect = amplitude(3200,3.75,4.25);
  assert.ok(pausedEffect > 2000, '对白结束后仍播放正文音效');
  assert.ok(amplitude(3200,2.25,2.5) > 2000, '正在播放的音效可自然跨过对白结尾');
  const overlapRatio = amplitude(3200,1.25,1.75) / pausedEffect;
  assert.ok(overlapRatio > .55 && overlapRatio < .85, `对白下的音效相对电平 ${overlapRatio}`);
  const musicRatio = amplitude(240,3.75,4.25) / amplitude(240,3,3.25);
  assert.ok(Math.abs(musicRatio - 1) < .04, `正文音效期间的配乐相对电平 ${musicRatio}`);
  for (const [from,to] of [[5,5.025],[5.15,5.4]]) {
    const quietRatio = amplitude(3200,from,to) / amplitude(1000,from,to);
    assert.ok(quietRatio > .35 && quietRatio < .95, `轻声开口及持续发声时，音效保留且低于旁白 ${quietRatio}`);
  }
  const endingRatio = amplitude(3200,5.98,6) / pausedEffect;
  assert.ok(endingRatio > .8, `控制信号的前探不会截断节目末尾的声源：${endingRatio}`);
  const endingMusicRatio = amplitude(240,5.98,6) / amplitude(240,3.75,4.25);
  assert.ok(endingMusicRatio > .8, `旁白让位处理不会截断节目末尾的配乐：${endingMusicRatio}`);
  const window = pcm(await readFile(await mix(70,300)));
  assert.deepEqual(window, full.subarray(70 * 800 * 4,300 * 800 * 4), '裁窗保留相同的对白检测和混音状态');
});

test('音乐意图由背景音乐包解析，撤出与回归实际进入PCM，裁窗不重启包络或音乐', async t => {
  const {contribute:music} = await import('../background-music/render-entry.mjs');
  const {resolveMusicGestures} = await import('../background-music/dynamics.mjs');
  const {specifiedMusicForWindow} = await import('../../modules/render-video/runtime/candidate-audio.mjs');
  const {runMediaProcess} = await import('../../modules/render-video/runtime/media-process.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'authored-music-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file='ep01/制作/input/music.wav';
  await mkdir(path.dirname(path.join(dir,file)),{recursive:true});
  await runMediaProcess('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=217:sample_rate=48000:duration=8',
    '-ac','2',path.join(dir,file)]);
  for (const templateId of ['fullframe-narrative','vox-explainer']) {
    const scene=segment('unit',templateId);
    const target=scene.actionTimings[0];
    const design={events:[],musicGestures:[{id:'G001',purpose:'转折前收声，作用成立后回归',points:
      [[.5,1],[1,0],[2,0],[3,1]].map(([offsetSeconds,gain])=>
        ({anchor:{target:target.target,action:target.action,offsetSeconds},gain}))}]};
    const storyboard={features:{'sound-effects':{enabled:true,units:{unit:design}}}};
    const sourceAssets=[{id:'SA001',mediaType:'audio',path:'music.wav',sha256:'a'.repeat(64),rightsStatus:'public-domain'}];
    const args={phase:'audio-tracks',featureData:{sourceAssetId:'SA001'},sourceAssets,episodeId:'ep01',
      bodyOffsetMs:0,bodyEndMs:8000,segments:[scene],storyboard,fps};
    const tracks=music(args).audioTracks;
    assert.deepEqual(tracks[0].gainEnvelopes[0], [{frame:150,gain:1},{frame:180,gain:0},{frame:240,gain:0},{frame:300,gain:1}]);
    const order={inputs:{cues:[{startMs:2000}]},resolvedAssembly:{slots:[{implementations:[{packageId:'sound-effects'}]}]}};
    const preview=specifiedMusicForWindow({sourceAssetId:'SA001',sourceAssets,episodeId:'ep01',fromFrame:165,toFrame:330,
      fps,bodyStartMs:0,bodyEndMs:8000,workOrder:order,result:{featureResults:{'sound-effects':design}},segment:{...scene,startMs:0}});
    assert.deepEqual(preview,audioTracksForWindow({tracks,fromFrame:165,toFrame:330,fps}),'候选与正式交付投影相同');
    assert.deepEqual(music({...args,storyboard:{features:{'sound-effects':{...storyboard.features['sound-effects'],enabled:false}}}}).audioTracks[0].gainEnvelopes,[]);
    assert.deepEqual(music({...args,segments:[{...scene,templateId:'cinematic-video'}]}).audioTracks[0].gainEnvelopes,[]);
    const invalid=structuredClone(design);invalid.musicGestures[0].points[1].anchor.offsetSeconds=.5;
    assert.throws(()=>resolveMusicGestures({result:invalid,actionTimings:scene.actionTimings,durationInFrames:360,fps}),/递增/);
    const props={fps,durationMs:8000,audioTracks:tracks};
    const full=await readFile(await mixCompositionAudio({props,timeline:{anchorMs:0,fromFrame:0,toFrame:480},projectDirectory:dir}));
    const pcm=bytes=>bytes.subarray(bytes.indexOf(Buffer.from('data'))+8);
    const samples=pcm(full);
    const energy=(a,b)=>{let sum=0;for(let i=Math.round(a*48000)*4;i<Math.round(b*48000)*4;i+=4)sum+=samples.readInt16LE(i)**2;return sum;};
    assert.equal(energy(3.2,3.8),0,'实际音乐撤出');
    assert.ok(energy(2,2.4)>0 && energy(5.2,5.8)>0,'原音乐在收声前和恢复后均存在');
    const slice=await readFile(await mixCompositionAudio({props,timeline:{anchorMs:0,fromFrame:165,toFrame:330},projectDirectory:dir}));
    const rebased=await readFile(await mixCompositionAudio({props:{fps,audioTracks:preview},timeline:{anchorMs:0,fromFrame:0,toFrame:165},projectDirectory:dir}));
    assert.deepEqual(pcm(slice),samples.subarray(165*800*4,330*800*4));
    assert.deepEqual(pcm(rebased),pcm(slice));
  }
});

test('本集登记实录可直接配声，保留出处和原卡点，拒绝权利未知或已改变的录音', async t => {
  const {writeFile} = await import('node:fs/promises');
  const {hashObject} = await import('../../program-utils.mjs');
  const {getEpisodePaths} = await import('../../workspace-paths.mjs');
  const {registerP3Source} = await import('../../p3-sources.mjs');
  const {runMediaProcess} = await import('../../modules/render-video/runtime/media-process.mjs');
  const {generateSound} = await import('./generate.mjs');
  const {validateRuntime} = await import('./validate.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'recorded-sound-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const episodeId = 'ep01';
  const paths = getEpisodePaths(root, episodeId);
  const orderDir = path.join(paths.p3, '_work/author/TR001');
  const scratch = path.join(orderDir, 'attempt');
  await mkdir(scratch, {recursive:true});
  await mkdir(paths.input, {recursive:true});
  await writeFile(paths.sourceAssets, JSON.stringify({schemaVersion:'1.0', assets:[]}));
  const base = {stageId:'p3', moduleId:'author-beat', subject:{id:episodeId},
    candidatePath:path.relative(root, path.join(orderDir, 'candidate.yaml')), scratchPath:path.relative(root, scratch),
    resolvedAssembly:{slots:[{implementations:[{packageId:'sound-effects'}]}]},
    inputs:{sourceAssets:[], authorUnit:{templateId:'fullframe-narrative'}}};
  const workOrderPath = path.join(orderDir, 'work-order.yaml');
  await writeFile(workOrderPath, JSON.stringify({...base, taskDigest:hashObject(base)}));
  const file = path.join(scratch, 'source.wav');
  await runMediaProcess('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=410:sample_rate=44100:duration=1',file]);
  const source = {file, mediaType:'audio', rightsStatus:'public-domain', creator:null, date:null,
    sourceCitation:'离线测试录音', usageNotes:'用于验证录音裁切和卡点'};
  const registered = await registerP3Source({workOrderPath, source});
  const restricted = await registerP3Source({workOrderPath, source:{...source, rightsStatus:'unknown'}});
  const recipePath = path.join(scratch, 'recipe.json');
  const recipeFor = sourceAssetId => writeFile(recipePath, JSON.stringify({syncSeconds:0.1, layers:[
    {generator:'recording', parameters:{sourceAssetId, startSeconds:0.25, endSeconds:0.65}}]}));
  await recipeFor(registered.id);
  const asset = await generateSound({workOrderPath, recipePath});
  assert.equal(asset.durationSeconds, 0.4);
  assert.equal(asset.syncSeconds, 0.1);
  assert.deepEqual(await validateRuntime({result:{events:[{asset}]}, services:{workspaceRoot:root, episodeId}}), []);
  const snapshot = JSON.parse(await readFile(path.join(root, asset.file.replace(/\.wav$/, '.json')), 'utf8'));
  assert.deepEqual(snapshot.recordingSources, [registered]);
  const pcm = await readFile(path.join(root, asset.file));
  assert.ok(pcm.subarray(pcm.indexOf(Buffer.from('data')) + 8).some(value => value !== 0));
  await recipeFor(restricted.id);
  await assert.rejects(() => generateSound({workOrderPath, recipePath}), /权利状态不可用于外部生产/);
  await recipeFor(registered.id);
  await writeFile(path.join(paths.input, registered.path), '被替换的实录');
  await assert.rejects(() => generateSound({workOrderPath, recipePath}), /与登记文件不一致/);
});

test('专用制声保存实际源码、参数与PCM，源码改变形成新资产，坏输出不交付', async t => {
  const {writeFile,readdir} = await import('node:fs/promises');
  const {hashObject} = await import('../../program-utils.mjs');
  const {generateSound} = await import('./generate.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'authored-sound-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const base={stageId:'p3',moduleId:'author-beat',subject:{id:'ep01'},candidatePath:'ep01/work/candidate.json',
    scratchPath:'ep01/work/scratch',resolvedAssembly:{slots:[{implementations:[{packageId:'sound-effects'}]}]}};
  const work=path.join(dir,'ep01/work/order.json'),scratch=path.join(dir,base.scratchPath);
  await mkdir(scratch,{recursive:true});
  await writeFile(work,JSON.stringify({...base,taskDigest:hashObject(base)}));
  const recipe=path.join(scratch,'sound.json'),source=path.join(scratch,'sound.py');
  await writeFile(recipe,JSON.stringify({seed:23,sourceFile:'sound.py',syncSeconds:.2,parameters:{d:.4}}));
  const code=`import numpy as np
def render(*, sr, rng, d):
    t = np.arange(round(sr * d)) / sr
    quiet = rng.standard_normal(len(t)) * .01 * np.sin(np.pi * t / d)
    peak_before_cut = .8 * ((t >= .02) & (t < .03))
    return quiet + peak_before_cut
`;
  await writeFile(source,code);
  const a=await generateSound({workOrderPath:work,recipePath:recipe});
  const again=await generateSound({workOrderPath:work,recipePath:recipe});
  assert.deepEqual(a,again);
  assert.equal(a.durationSeconds,.4);
  const stored=path.join(dir,a.file);
  assert.equal(await readFile(stored.replace(/\.wav$/,'.py'),'utf8'),code);
  assert.equal(JSON.parse(await readFile(stored.replace(/\.wav$/,'.json'))).parameters.d,.4);
  const uncutRecipe=JSON.parse(await readFile(recipe,'utf8'));
  const clip={startSeconds:.05,endSeconds:.3,fadeInSeconds:.025,fadeOutSeconds:.08};
  await writeFile(recipe,JSON.stringify({...uncutRecipe,clip}));
  const clipped=await generateSound({workOrderPath:work,recipePath:recipe});
  assert.equal(clipped.durationSeconds,.25);
  assert.ok(Math.abs(clipped.syncSeconds-.15)<1e-12);
  const pcm = bytes => bytes.subarray(bytes.indexOf(Buffer.from('data'))+8);
  const originalPcm=pcm(await readFile(stored));
  const clippedPcm=pcm(await readFile(path.join(dir,clipped.file)));
  const bytesAt=seconds=>Math.round(seconds*48000)*6;
  assert.deepEqual(clippedPcm.subarray(bytesAt(.05),bytesAt(.15)),
    originalPcm.subarray(bytesAt(.1),bytesAt(.2)),'裁掉峰值后，窗口中间仍保持原电平');
  assert.notDeepEqual(clippedPcm.subarray(bytesAt(.2),bytesAt(.24)),
    originalPcm.subarray(bytesAt(.25),bytesAt(.29)),'淡出发生在指定的窗口内');
  assert.deepEqual(clippedPcm.subarray(-6),Buffer.alloc(6));
  const gainEnvelope=[
    {atSeconds:0,gain:0},{atSeconds:.05,gain:0},{atSeconds:.08,gain:1},
    {atSeconds:.2,gain:1},{atSeconds:.3,gain:0}
  ];
  await writeFile(recipe,JSON.stringify({...uncutRecipe,gainEnvelope}));
  const shaped=await generateSound({workOrderPath:work,recipePath:recipe});
  const shapedPcm=pcm(await readFile(path.join(dir,shaped.file)));
  assert.equal(shaped.syncSeconds,a.syncSeconds);
  assert.equal(shaped.durationSeconds,a.durationSeconds);
  assert.deepEqual(shapedPcm.subarray(bytesAt(.1),bytesAt(.2)),
    originalPcm.subarray(bytesAt(.1),bytesAt(.2)),'曲线压掉原峰，未改的窗口仍保持原电平');
  assert.deepEqual(shapedPcm.subarray(0,bytesAt(.05)),Buffer.alloc(bytesAt(.05)));
  assert.deepEqual(shapedPcm.subarray(bytesAt(.3)),Buffer.alloc(bytesAt(.1)));
  const scene=segment('B001','fullframe-narrative');
  const [track]=contribute({phase:'audio-tracks',segments:[scene],fps,featureData:{units:{B001:{events:[{
    id:'S001',purpose:'声音作用结束后给口播留空间',asset:clipped,
    anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1}
  }]}}}}).audioTracks;
  assert.equal(track.startMs,2850);
  assert.equal(track.endMs,3100);
  await writeFile(recipe,JSON.stringify({...uncutRecipe,clip,syncSeconds:.299999}));
  const nearEnd=await generateSound({workOrderPath:work,recipePath:recipe});
  assert.ok(Math.abs(nearEnd.syncSeconds-.249999)<1e-12,'窗口内贴近末尾的卡点仍有效');
  await writeFile(recipe,JSON.stringify({...uncutRecipe,clip:{...clip,endSeconds:.15}}));
  await assert.rejects(()=>generateSound({workOrderPath:work,recipePath:recipe}),/保留syncSeconds/);
  await writeFile(recipe,JSON.stringify(uncutRecipe));
  await writeFile(source,code.replace('* .01','* .02'));
  const b=await generateSound({workOrderPath:work,recipePath:recipe});
  assert.notEqual(a.file,b.file);assert.notEqual(a.sha256,b.sha256);
  const before=await readdir(path.dirname(stored));
  await writeFile(source,'import numpy as np\ndef render(**kwargs):\n    return np.array([np.nan])\n');
  await assert.rejects(()=>generateSound({workOrderPath:work,recipePath:recipe}),/非有限值/);
  assert.deepEqual(await readdir(path.dirname(stored)),before,'失败不留下资产或临时生成目录');
});

test('音乐可安静结束、相邻单位低电平接续，完整PCM与末尾裁窗不回弹', async t => {
  const {contribute:music} = await import('../background-music/render-entry.mjs');
  const {runMediaProcess} = await import('../../modules/render-video/runtime/media-process.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'held-music-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file='ep01/制作/input/music.wav';
  await mkdir(path.dirname(path.join(dir,file)),{recursive:true});
  await runMediaProcess('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=217:sample_rate=48000:duration=9',
    '-ac','2',path.join(dir,file)]);
  const one={...segment('B001','fullframe-narrative'),startMs:0,endMs:3000,durationInFrames:180};
  const two={...segment('B002','fullframe-narrative'),startMs:3000,endMs:8000,durationInFrames:300};
  const gesture=points=>({events:[],musicGestures:[{id:'G001',purpose:'保留低电平并安静收束',
    points:points.map(([offsetSeconds,gain])=>({anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds},gain}))}]});
  const units={B001:gesture([[0,1],[1,.3]]),B002:gesture([[0,.3],[1,.3],[2,0],[5,0]])};
  const args={phase:'audio-tracks',featureData:{sourceAssetId:'SA001'},episodeId:'ep01',fps,
    sourceAssets:[{id:'SA001',mediaType:'audio',path:'music.wav',sha256:'a'.repeat(64),rightsStatus:'public-domain'}],
    bodyOffsetMs:0,bodyEndMs:8000,episodeEnding:{afterSegmentType:'body',fadeEndMs:9000,fadeFrames:120},
    segments:[one,two],storyboard:{features:{'sound-effects':{units}}}};
  const tracks=music(args).audioTracks;
  assert.equal(tracks[0].gainEnvelopes[0].at(-1).frame,180,'本单位保持到结束，不能压制后续独立章节');
  assert.deepEqual(tracks[0].gainEnvelopes[1].at(-1),{frame:540,gain:0},'最后一段保持到节目收口');
  assert.doesNotThrow(()=>assertAudioTracks({audioTracks:tracks,segments:[one,two],fps,durationMs:9000,
    ending:{...args.episodeEnding,afterSegmentId:'B002'}}));
  const props={fps,durationMs:9000,audioTracks:tracks},pcm=b=>b.subarray(b.indexOf(Buffer.from('data'))+8);
  const full=pcm(await readFile(await mixCompositionAudio({props,projectDirectory:dir,timeline:{anchorMs:0,fromFrame:0,toFrame:540}})));
  assert.ok(full.subarray(2*48000*4,4*48000*4).some(v=>v!==0),'跨Beat低电平仍可播放');
  assert.ok(full.subarray(6*48000*4).every(v=>v===0),'收声后包括节目收口均无回弹');
  const windowed=audioTracksForWindow({tracks,fromFrame:330,toFrame:540,fps});
  const tail=pcm(await readFile(await mixCompositionAudio({props:{fps,audioTracks:windowed},projectDirectory:dir,
    timeline:{anchorMs:0,fromFrame:0,toFrame:210}})));
  assert.deepEqual(tail,full.subarray(330*800*4));
});

test('声音作者读取同章已有声音与实际音乐，局部预览保留邻接余韵并遵守音乐关闭', async t => {
  const previousMusic = process.env.BACKGROUND_MUSIC_FILE;
  process.env.BACKGROUND_MUSIC_FILE = '';
  t.after(() => {if(previousMusic === undefined) delete process.env.BACKGROUND_MUSIC_FILE; else process.env.BACKGROUND_MUSIC_FILE = previousMusic;});
  const {projectAuthorContext} = await import('./author-context.mjs');
  const {candidateEffectTracks,specifiedMusicForWindow} = await import('../../modules/render-video/runtime/candidate-audio.mjs');
  const cues=[1,2,3].map((id,i)=>({id,startMs:i*2000,endMs:(i+1)*2000,text:'本章动作'}));
  const unit=id=>({id:`B00${id}`,templateId:'fullframe-narrative',paragraph:{id:id===3?'TR002':'TR001'},
    beats:[{cueRange:[id,id]}],treatment:{templateId:'fullframe-narrative'}});
  const prior={events:[{id:'S001',purpose:'前一动作余韵',soundId:'ding',anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1.9}}]};
  const acceptedFeatures={'cue-sync':{bindings:{B001:{items:[{target:'AR001',action:'start-frame-motion',cueId:1,edge:'start'}]},
    B003:{items:[{target:'AR001',action:'start-frame-motion',cueId:3,edge:'start'}]}}},
    'sound-effects':{units:{B001:prior,B003:prior}},'background-music':{enabled:false}};
  const context=projectAuthorContext({episodeId:'ep01',authorUnit:{id:'B002'},authorUnits:[unit(1),unit(2),unit(3)],
    episodeCues:cues,acceptedFeatures,sourceAssets:[]});
  assert.deepEqual(context.acceptedUnits.map(u=>u.unitId),['B001'],'只投递同章已有声音，不依赖其它章');
  assert.deepEqual(context.acceptedUnits[0].result,prior);
  assert.deepEqual(context.music,{enabled:false});
  const rebinding = {episodeId:'ep01',authorUnit:{id:'B002'},
    authorUnits:[unit(1),unit(2),{...unit(3),paragraph:{id:'TR001'},beats:[{cueRange:[4,4]}]}],
    episodeCues:[cues[0],cues[1],{...cues[2],id:4}],acceptedFeatures,sourceAssets:[],
    p3BodyRedesign:{cueRebinding:{previousCues:cues},pendingAuthorUnitIds:['B002','B003']}};
  const baseline = structuredClone(rebinding);
  assert.deepEqual(projectAuthorContext(rebinding).acceptedUnits,context.acceptedUnits,
    '待重新绑定的同章声音不进入当前时序，未受影响参考完整保留');
  assert.deepEqual(rebinding,baseline,'上下文投影不清空原设计或功能');
  assert.throws(() => projectAuthorContext({...rebinding,p3BodyRedesign:null}),/cueId 必须唯一存在: 3/u,
    '没有待修身份的坏绑定仍须报告，不能吞错放行');
  const repaired = structuredClone(rebinding);
  repaired.acceptedFeatures['cue-sync'].bindings.B003.items[0].cueId = 4;
  repaired.p3BodyRedesign.pendingAuthorUnitIds = ['B002'];
  assert.deepEqual(projectAuthorContext(repaired).acceptedUnits.map(unit => unit.unitId),['B001','B003'],
    '完成重新绑定的单位重新提供声音参考');
  const order={inputs:{authorUnit:{id:'B002'},cues:[cues[1]]},resolvedAssembly:{slots:[{implementations:[{kind:'feature',packageId:'sound-effects'}]}]}};
  const current={...segment('B002','fullframe-narrative'),startMs:0,endMs:2000,durationInFrames:120};
  const tracks=await candidateEffectTracks({workOrder:order,result:{featureResults:{'sound-effects':{events:[]}}},
    segment:current,fps,durationMs:2000,audioContext:context});
  assert.equal(tracks[0].startMs,0);
  assert.equal(tracks[0].sourceStartFrame,6);
  assert.equal(tracks[0].endMs,1500,'前一Beat余韵实际进入本Beat预览，不重启音效');
  const args={sourceAssets:[],episodeId:'ep01',fromFrame:120,toFrame:240,fps,bodyStartMs:0,bodyEndMs:6000,
    workOrder:order,result:{featureResults:{'sound-effects':{events:[]}}},segment:current,audioContext:context};
  assert.deepEqual(specifiedMusicForWindow(args),[]);
  const {['background-music']: _music, ...unselectedFeatures} = acceptedFeatures;
  const unselectedContext=projectAuthorContext({episodeId:'ep01',authorUnit:{id:'B002'},authorUnits:[unit(1),unit(2),unit(3)],
    episodeCues:cues,acceptedFeatures:unselectedFeatures,sourceAssets:[]});
  assert.deepEqual(unselectedContext.music,{enabled:false},'未配置个人音乐时，缺少节目选择仍保持无配乐');
  assert.deepEqual(specifiedMusicForWindow({...args,audioContext:unselectedContext}),[]);
  const defaultContext=projectAuthorContext({episodeId:'ep01',authorUnit:{id:'B002'},authorUnits:[unit(1),unit(2),unit(3)],
    episodeCues:cues,acceptedFeatures:{...acceptedFeatures,'background-music':{}},sourceAssets:[]});
  assert.deepEqual(defaultContext.music,{enabled:false},'公开安装未配置个人曲目时无默认音乐');
  assert.deepEqual(specifiedMusicForWindow({...args,audioContext:defaultContext}),[]);
});
