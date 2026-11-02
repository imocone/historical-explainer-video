import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {hashObject, readData, sha256} from '../packages/program-utils.mjs';
import {getEpisodePaths,getStageWorkPaths} from '../packages/workspace-paths.mjs';
import {fullframeMotionBudgetForCueOption} from '../packages/templates/fullframe-narrative/cue-policy-runtime.mjs';
import {projectVideoProduction} from '../packages/templates/cinematic-video/production-projection.mjs';
import {prepareStudio} from '../packages/modules/render-video/studio.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)), exec=promisify(execFile);
const write=async(file,value)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
const accepted=(value,moduleId,nodeId)=>({...value,_producer:{moduleId,nodeId,taskDigest:'a'.repeat(64),inputs:[],rules:[],contract:'b'.repeat(64),outputSha256:hashObject(value)}});

test('逐段片头走作者图片和正式 Studio 入口，并在弹开期间露出正文', {timeout:60000}, async t=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),'opposed-studio-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const manifest=await readData(path.join(root,'visuals/modern-editorial/visual-package.json'));
  const image=path.join(root,'visuals/modern-editorial',manifest.masterReference.path);
  await write(path.join(workspace,'program.yaml'),{openerTemplate:'opposed-opener',visualPackage:{visualPackageId:manifest.id,version:manifest.version}});
  const paths=getEpisodePaths(workspace,'ep01'), work=getStageWorkPaths(paths,'p3');
  const cues=[{id:1,startMs:0,endMs:6000,text:'院子里的来客正在等候。'}];
  const binding={target:'AR001',action:'start-frame-motion',cueId:1,edge:'start'};
  const body={templateId:'fullframe-narrative',incomingTransition:null,
    continuity:{period:'清代',location:'院落',continuesPreviousScene:false,subjects:['来客'],props:[],carryToNext:{subjects:[],props:[]}},
    calloutGate:{'historical-quote':'not-triggered','person-intro':'not-triggered','term-gloss':'not-triggered'},
    assetRequests:[{requestId:'AR001',kind:'fullframe-image',frameId:'A',cameraRelation:'first',purpose:'看见等候者与尚未打开的院门',
      sourceRefs:['C001'],mustNotInvent:['不增加人物身份'],required:true,acceptanceCriteria:['来客与院门关系清楚'],
      sceneDescription:'完整院落中，来客在前景停步，石径接向中景关闭的院门，后景有相连的屋宇。',
      attentionPlan:{entryFocus:'院落',landingFocus:'来客与院门',safeEndFocus:'来客与院门',viewerChange:'从场地转向未被回应的等候'},
      motion:{type:'push-in',speedRatio:1,startViewport:{x:0,y:0,width:1,height:1},routeWaypoints:[],
        semanticEndViewport:{x:.15,y:.1,width:2/3,height:2/3},safeEndViewport:{x:.15,y:.1,width:2/3,height:2/3}}}]};
  const task={subject:{kind:'episode',id:'ep01'},moduleId:'author-beat',nodeId:'author',stageId:'p3',
    candidatePath:path.relative(workspace,work.candidate),scratchPath:path.relative(workspace,path.join(work.work,'attempt-fixture')),
    resolvedAssembly:{node:{id:'author',moduleId:'author-beat'},module:{id:'author-beat'},slots:[{id:'body-template',implementations:[{packageId:'fullframe-narrative'}]}]},
    inputs:{authorUnit:{id:'B001',templateId:'fullframe-narrative',cueRange:[1,1]},cues,sourceAssets:[],enabledFeatureIds:['cue-sync'],
      templateContext:{incomingTransitionSupported:false,cueOptions:{frameA:[{cueId:1,edge:'start'}],frameB:[]},motionBudgets:{options:[{binding:null,frames:fullframeMotionBudgetForCueOption({durationInFrames:360,fps:60})}]}},semanticContext:{}}};
  task.taskDigest=hashObject(task);
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:[]});
  await write(work.workOrder,task);await write(work.candidate,{taskDigest:task.taskDigest,result:{treatment:body,featureResults:{'cue-sync':{items:[binding]}}}});
  const cli=async(...args)=>JSON.parse((await exec(process.execPath,[path.join(root,'packages/authored-images.mjs'),...args],{maxBuffer:4*1024*1024})).stdout);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const bodyResult=(await readData(work.candidate)).result.treatment;
  await write(paths.storyboard,{understanding:{},albumPlan:{},beats:[{id:'B001',templateId:bodyResult.templateId,cueRange:[1,1],treatment:bodyResult}],
    templateRuns:[],features:{'cue-sync':{bindings:{B001:{items:[binding]}}}}});
  await write(paths.narrationText,cues[0].text);
  const srt='1\n00:00:00,000 --> 00:00:06,000\n'+cues[0].text+'\n';await write(paths.narrationSubtitles,srt);
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','6','-y',paths.narrationAudio]);
  await write(paths.narrationPackage,{episodeId:'ep01',seriesTitle:'离线片头链路',durationMs:6000,files:{
    narration:{path:'narration.txt',sha256:sha256(cues[0].text)},subtitles:{path:'narration.srt',sha256:sha256(srt)},
    audio:{path:'narration.mp3',sha256:sha256(await readFile(paths.narrationAudio))}}});
  const opener=(await readData(path.join(root,'packages/templates/opposed-opener/examples/golden.json'))).result;
  opener.flashbackShots.forEach(shot=>{shot.bodyRefs=['B001'];shot.sourceRefs=['C001'];});
  const p4=getStageWorkPaths(paths,'p4',null,'opener');
  const openerTask={subject:{kind:'episode',id:'ep01'},moduleId:'author-bookend',nodeId:'opener',stageId:'p4',
    candidatePath:path.relative(workspace,p4.candidate),scratchPath:path.relative(workspace,path.join(p4.work,'attempt-opener')),
    resolvedAssembly:{slots:[{id:'opener-template',implementations:[{packageId:'opposed-opener'}]}]},inputs:{sourceAssets:[]}};
  openerTask.taskDigest=hashObject(openerTask);
  await write(p4.workOrder,openerTask);await write(p4.candidate,{taskDigest:openerTask.taskDigest,result:opener});
  for(const job of await cli('prepare',p4.workOrder,p4.candidate)){
    await cli('begin',p4.workOrder,p4.candidate,job.key);await cli('import',p4.workOrder,p4.candidate,job.key,image);
  }
  const result=(await readData(p4.candidate)).result, voice=path.join(paths.p4,'opener-narration.mp3');
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','3','-y',voice]);
  result.narration={textSha256:sha256(result.flashbackLine),audioSha256:sha256(await readFile(voice)),durationMs:3000,ttsFingerprint:'a'.repeat(64),
    sentenceCues:[{target:'O01',startMs:100,endMs:900},{target:'O02',startMs:1350,endMs:2700}]};
  await write(paths.episodePackage,{episodeId:'ep01',opener:result});
  const videoPlan={episodeId:'ep01',templateId:'cinematic-video',selectionReason:'离线样本不生成视频',incomingTransitions:{},spans:[]};
  await write(paths.videoPlan,accepted(videoPlan,'author-video','video'));
  await write(paths.videoManifest,accepted({episodeId:'ep01',videoPlanSha256:hashObject(projectVideoProduction(videoPlan)),clips:[]},'produce-video-assets','video-assets'));
  const studio=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root}), plan=studio.renderPlan;
  const intro=plan.segments.find(s=>s.id==='opener'), firstBody=plan.segments.find(s=>s.id==='B001');
  assert.equal(intro.templateId,'opposed-opener');assert.equal(intro.assetRefs.length,2);
  assert.equal(firstBody.appliedEntranceLeadFrames,18);
  assert.equal(firstBody.appliedEntryTransition.presentation,'under-outgoing');
  assert.equal(plan.audioTracks.filter(a=>a.id.startsWith('opposed-rush-top-')).length,2);
  assert.ok(plan.audioTracks.some(a=>a.id==='opposed-release-gear'));
  assert.equal(plan.audioTracks.find(a=>a.id==='body-narration').startMs,intro.endMs);
});
