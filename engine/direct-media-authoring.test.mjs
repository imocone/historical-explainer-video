import {createAppearance} from '../packages/templates/vox-explainer/appearance.mjs';
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
import {inspectFullframeDesign} from '../packages/templates/fullframe-narrative/inspect-design.mjs';
import {lockFullframeCallouts} from '../packages/templates/fullframe-narrative/lock-callouts.mjs';
import {validateAcceptance} from '../packages/templates/fullframe-narrative/validate.mjs';
import {fullframeMotionBudgetForCueOption} from '../packages/templates/fullframe-narrative/cue-policy-runtime.mjs';
import {collectAuthoredMedia} from '../packages/authored-media.mjs';
import {firstFrameFor, selectPartRequest} from '../packages/modules/produce-video-assets/delivery.mjs';
import {prepareStudio} from '../packages/modules/render-video/studio.mjs';
import {projectVideoProduction} from '../packages/templates/cinematic-video/production-projection.mjs';
import {imageDescriptors} from '../packages/authored-images.mjs';

const root = fileURLToPath(new URL('..',import.meta.url));
const exec = promisify(execFile);
const write = async (file,value) => {await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value === 'string' ? value : JSON.stringify(value));};
const accepted = (value,moduleId,nodeId) => ({...value,_producer:{moduleId,nodeId,
  taskDigest:'a'.repeat(64),inputs:[],rules:[],contract:'b'.repeat(64),outputSha256:hashObject(value)}});
const cues = [{id:1,startMs:0,endMs:6000,text:'院子里的来客正在等候。'}];
const binding = {target:'AR001',action:'start-frame-motion',cueId:1,edge:'start'};
const treatment = () => ({templateId:'fullframe-narrative',incomingTransition:null,
  continuity:{period:'清代',location:'院落',continuesPreviousScene:false,subjects:['来客'],props:[],carryToNext:{subjects:[],props:[]}},
  calloutGate:{'historical-quote':'not-triggered','person-intro':'not-triggered','term-gloss':'not-triggered'},
  assetRequests:[{requestId:'AR001',kind:'fullframe-image',frameId:'A',cameraRelation:'first',purpose:'看见等候者与尚未打开的院门',
    sourceRefs:['C001'],mustNotInvent:['不增加人物身份'],required:true,acceptanceCriteria:['来客与院门关系清楚'],
    sceneDescription:'完整院落中，来客在前景停步，石径接向中景关闭的院门，后景有相连的屋宇。',
    attentionPlan:{entryFocus:'院落',landingFocus:'来客与院门',safeEndFocus:'来客与院门',viewerChange:'从场地转向未被回应的等候'},
    motion:{type:'push-in',speedRatio:1,startViewport:{x:0,y:0,width:1,height:1},routeWaypoints:[],
      semanticEndViewport:{x:.15,y:.1,width:2/3,height:2/3},safeEndViewport:{x:.15,y:.1,width:2/3,height:2/3}}}]});

const setup = async (t, episodeCues = cues) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(),'direct-media-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const manifest = await readData(path.join(root,'visuals/modern-editorial/visual-package.json'));
  const image = path.join(root,'visuals/modern-editorial',manifest.masterReference.path);
  await write(path.join(workspace,'program.yaml'),{openerTemplate:'documentary-opener',visualPackage:{visualPackageId:manifest.id,version:manifest.version}});
  const paths = getEpisodePaths(workspace,'ep01');
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:[]});
  const work = getStageWorkPaths(paths,'p3');
  const templateContext = {incomingTransitionSupported:false,cueOptions:{frameA:[{cueId:1,edge:'start'}],frameB:[]},
    motionBudgets:{options:[{binding:null,frames:fullframeMotionBudgetForCueOption({durationInFrames:Math.ceil(episodeCues.at(-1).endMs*60/1000),fps:60})}]}};
  const task = {subject:{kind:'episode',id:'ep01'},moduleId:'author-beat',nodeId:'author',stageId:'p3',
    candidatePath:path.relative(workspace,work.candidate),scratchPath:path.relative(workspace,path.join(work.work,'attempt-fixture')),
    resolvedAssembly:{node:{id:'author',moduleId:'author-beat'},module:{id:'author-beat'},slots:[{id:'body-template',implementations:[{packageId:'fullframe-narrative'}]}]},
    inputs:{authorUnit:{id:'B001',templateId:'fullframe-narrative',cueRange:[1,episodeCues.at(-1).id]},cues:episodeCues,sourceAssets:[],enabledFeatureIds:['cue-sync'],templateContext,semanticContext:{}}};
  task.taskDigest=hashObject(task);
  await write(work.workOrder,task);
  await write(work.candidate,{taskDigest:task.taskDigest,result:{treatment:treatment(),featureResults:{'cue-sync':{items:[binding]}}}});
  const cli = async (...args) => JSON.parse((await exec(process.execPath,[path.join(root,'packages/authored-images.mjs'),...args],{maxBuffer:4*1024*1024})).stdout);
  return {workspace,paths,work,task,image,cli};
};

test('地图沿原入口一次生图，来源按本集输入读取，焦点运镜可正常接纳', async t => {
  const episodeCues=[{id:1,startMs:0,endMs:6000,text:'欧洲地图只标记法国和德国，作为位置示意。'}];
  const {workspace,paths,work,task,image,cli}=await setup(t,episodeCues);
  const bytes=await readFile(image);
  await mkdir(path.join(paths.input,'sources'),{recursive:true});
  await writeFile(path.join(paths.input,'sources/reference.png'),bytes);
  task.inputs.sourceAssets=[{id:'SA001',mediaType:'photo',path:'sources/reference.png',sha256:sha256(bytes),
    sourceCitation:'独立测试参考',creator:null,date:null,rightsStatus:'permission-granted',usageNotes:'只验证参考图交接，不证明地图画质'}];
  await write(paths.sourceAssets,{schemaVersion:'1.0',assets:task.inputs.sourceAssets});
  const {taskDigest:_old,...content}=task;task.taskDigest=hashObject(content);
  const candidate=await readData(work.candidate);candidate.taskDigest=task.taskDigest;
  const request=candidate.result.treatment.assetRequests[0];
  request.sourceRefs.push('SA001');request.exactTexts=['法国','德国','两国位置'];
  candidate.result.treatment.continuity={period:'当代地理示意',location:'欧洲',continuesPreviousScene:false,
    subjects:[],props:[],carryToNext:{subjects:[],props:[]}};
  request.purpose='看清法国与德国的相对位置';
  request.attentionPlan={entryFocus:'欧洲范围',landingFocus:'法国与德国',safeEndFocus:'法国与德国',viewerChange:'从整体转向被提及的国家位置'};
  request.sceneDescription='完整欧洲位置示意图，以短字法国、德国标记两国，标题为两国位置，不添加人物或读图场景。';
  await write(work.workOrder,task);await write(work.candidate,candidate);
  const [started]=await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  assert.ok(started.job.prompt.includes(request.sceneDescription));
  assert.ok(started.job.referenced_image_paths.includes(path.join(paths.input,'sources/reference.png')));
  assert.ok(started.job.prompt.includes('不做拼贴或拼图'));
  assert.ok(started.job.prompt.includes('两国位置'));
  assert.ok(started.job.prompt.includes('只交付本次图纸对应的一张16:9成品'));
  const [made]=await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  assert.equal(made.asset.provider,'image-gen');assert.equal(made.asset.sha256,sha256(bytes));
  await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const complete=await readData(work.candidate);
  assert.deepEqual(await validateAcceptance({result:complete.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:complete.result}}),[]);
});

test('同一作者从图纸到实图及最终镜头；未知调用不重投，修图携带原图和意见', async t => {
  const {workspace,work,task,image,cli}=await setup(t);
  const before=await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  assert.equal(before.cameraLockWritten,false);
  const jobs=await cli('prepare',work.workOrder,work.candidate);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].job,undefined);
  assert.ok(jobs[0].referenceImages.includes(image));
  const [started]=await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  assert.ok(started.job.prompt.includes(treatment().assetRequests[0].sceneDescription));
  assert.ok(started.job.referenced_image_paths.includes(image));
  const [render]=await imageDescriptors({treatment:treatment(),targetDurationMs:6000});
  const [drawing]=await imageDescriptors({treatment:treatment(),targetDurationMs:6000,includeFraming:false});
  const {framing,...renderInput}=render.request.production;
  assert.ok(framing);
  assert.deepEqual(drawing.request.production,renderInput);
  await assert.rejects(cli('begin',work.workOrder,work.candidate,'B001/AR001'),/结果未知/);
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const withImage=await readData(work.candidate),asset=withImage.result.treatment.assetRequests[0].asset;
  assert.equal(asset.sha256,sha256(await readFile(image)));
  assert.equal(asset.width/asset.height,16/9);
  assert.deepEqual(await cli('prepare',work.workOrder,work.candidate),[]);
  withImage.result.treatment.assetRequests[0].sceneDescription += '院门前有一道台阶。';
  await write(work.candidate,withImage);
  const review=await cli('prepare',work.workOrder,work.candidate);
  assert.equal(review[0].asset.sha256,asset.sha256,'设计改变时交回原图核对，不静默重生');
  withImage.result.treatment.assetRequests[0].sceneDescription=treatment().assetRequests[0].sceneDescription;
  await write(work.candidate,withImage);
  const final=await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  assert.equal(final.cameraLockWritten,true);
  assert.ok((await readFile(final.realImages[0].routeMap.file)).length>0);
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const candidate=await readData(work.candidate);
  assert.deepEqual(await validateAcceptance({result:candidate.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:candidate.result}}),[]);
  const repaired=await cli('begin',work.workOrder,work.candidate,'B001/AR001','--revision-reason','只恢复院门与石径的连接关系');
  assert.equal(repaired[0].job.referenced_image_paths.at(-1),path.join(workspace,asset.file));
  assert.match(repaired[0].job.prompt,/只恢复院门与石径/);
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const changed=await readData(work.candidate);
  assert.notEqual(changed.result.treatment.assetRequests[0].asset.promptSha256,asset.promptSha256);
  assert.equal(changed.result.treatment.assetRequests[0].asset.sha256,asset.sha256);
  assert.ok((await validateAcceptance({result:changed.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:changed.result}})).length>0,'换图后必须重做实际受影响的最终镜头锁');
});

test('全画幅新创作的音效错误保留原画面及最终相机锁', async t => {
  const {workspace,paths,work,task,image,cli}=await setup(t);
  task.resolvedAssembly.slots.push({id:'beat-feature',implementations:[{kind:'feature',packageId:'sound-effects'}]});
  const {taskDigest:_old,...base}=task;task.taskDigest=hashObject(base);
  const candidate=await readData(work.candidate);candidate.taskDigest=task.taskDigest;
  await write(work.workOrder,task);await write(work.candidate,candidate);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const formed=await readData(work.candidate),picture=structuredClone(formed.result.treatment);
  const lock=path.join(workspace,task.scratchPath,'step-locks/fullframe-camera-final.json');
  const lockBefore=await readFile(lock);
  await write(paths.storyboard,{beats:[task.inputs.authorUnit],templateRuns:[],features:{}});
  await write(paths.narrationText,cues[0].text);
  const srt='1\n00:00:00,000 --> 00:00:06,000\n'+cues[0].text+'\n';
  await write(paths.narrationSubtitles,srt);
  const audio=await readFile(path.join(root,'packages/templates/vox-explainer/examples/supply-mg/assets/narration.wav'));
  await writeFile(path.join(paths.p2,'narration.wav'),audio);
  await write(paths.narrationPackage,{durationMs:6000,files:{
    narration:{path:'narration.txt',sha256:sha256(cues[0].text)},
    subtitles:{path:'narration.srt',sha256:sha256(srt)},audio:{path:'narration.wav',sha256:sha256(audio)}}});
  formed.result.featureResults['sound-effects']={events:[{id:'S001',purpose:'关键落点',soundId:'paper',
    anchor:{target:'AR999',action:'start-frame-motion',offsetSeconds:1}}]};
  await write(work.candidate,formed);
  await assert.rejects(inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate,
    clipRequestId:'AR001'}),error=>error.audioPlaybackFailure===true&&/找不到画面锚点/.test(error.message));
  assert.deepEqual(await readFile(lock),lockBefore,'选声或定位失败不能删除相机锁');
  const event=formed.result.featureResults['sound-effects'].events[0];delete event.soundId;
  event.anchor.target='AR001';event.asset={file:'ep01/制作/p3/assets/sound-effects/missing.wav',
    sha256:'a'.repeat(64),durationSeconds:.2,syncSeconds:0};
  await write(work.candidate,formed);
  await assert.rejects(inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate,
    clipRequestId:'AR001'}),error=>error.audioPlaybackFailure===true&&/missing.wav/.test(error.message));
  assert.deepEqual(await readFile(lock),lockBefore,'声音文件缺失也不能删除相机锁');
  const corrupt=path.join(workspace,event.asset.file);
  await mkdir(path.dirname(corrupt),{recursive:true});
  await writeFile(corrupt,'invalid WAV');
  await assert.rejects(inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate,
    clipRequestId:'AR001'}),error=>error.audioPlaybackFailure===true&&/ffmpeg/.test(error.message));
  assert.deepEqual(await readFile(lock),lockBefore,'实际混音失败不能删除相机锁');
  assert.deepEqual((await readData(work.candidate)).result.treatment,picture);
});

test('长Beat单图与作者变速走完整图片、测量和接纳链；调速复用原图', async t => {
  const episodeCues=[{id:1,startMs:0,endMs:6000,text:'来客停在关闭的院门前。'},
    {id:2,startMs:6040,endMs:14000,text:'他继续等候，院门仍没有打开。'}];
  const {workspace,work,task,image,cli}=await setup(t,episodeCues);
  const draft=await readData(work.candidate);
  Object.assign(draft.result.treatment.assetRequests[0].motion,{speedRatio:1,
    speedChanges:[{timeMs:2000,speedRatio:1.15},{timeMs:4000,speedRatio:1}]});
  await write(work.candidate,draft);
  const before=await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  assert.equal(before.ok,true);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const final=await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  assert.equal(final.cameraLockWritten,true);
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const result=await readData(work.candidate);
  assert.deepEqual(await validateAcceptance({result:result.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:result.result}}),[]);
  result.result.treatment.assetRequests[0].motion.speedChanges[0].speedRatio=1.1;
  await write(work.candidate,result);
  assert.deepEqual(await cli('prepare',work.workOrder,work.candidate),[]);
  assert.ok((await validateAcceptance({result:result.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:result.result}})).length>0);
  await inspectFullframeDesign({workOrderPath:work.workOrder,candidatePath:work.candidate});
  await lockFullframeCallouts({workOrderPath:work.workOrder,candidatePath:work.candidate});
  const revised=await readData(work.candidate);
  assert.deepEqual(await validateAcceptance({result:revised.result.treatment,context:task.inputs,
    services:{workspaceRoot:workspace,episodeId:'ep01',task,candidateResult:revised.result}}),[]);
});

test('独立B的请求不随A导入改变；连续参考由作者明确选择并保留原调用', async t => {
  const {workspace,work,image,cli}=await setup(t);
  const candidate=await readData(work.candidate);
  const second=structuredClone(candidate.result.treatment.assetRequests[0]);
  Object.assign(second,{requestId:'AR002',frameId:'B',cameraRelation:'reset',
    purpose:'独立看街上的行人',sceneDescription:'街道上行人经过，前方屋宇相连。'});
  candidate.result.treatment.assetRequests.push(second);
  await write(work.candidate,candidate);
  const first=await setup(t);
  await write(first.work.candidate,{...candidate,taskDigest:first.task.taskDigest});
  const [before]=await first.cli('begin',first.work.workOrder,first.work.candidate,'B001/AR002');
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const [independent]=await cli('begin',work.workOrder,work.candidate,'B001/AR002');
  assert.deepEqual(independent.job,before.job);
  const original=await readData(work.candidate);
  await cli('import',work.workOrder,work.candidate,'B001/AR002',image);
  assert.deepEqual((await readData(path.resolve(workspace,(await readData(work.candidate))
    .result.treatment.assetRequests[1].asset.promptFile))).referenced_image_paths,independent.job.referenced_image_paths);

  original.result.treatment.assetRequests[1]={...second,requestId:'AR003'};
  await write(work.candidate,original);
  await assert.rejects(cli('begin',work.workOrder,work.candidate,'B001/AR003',
    '--reference-image','B002/AR001'),/当前全画幅单位/);
  const [dependent]=await cli('begin',work.workOrder,work.candidate,'B001/AR003',
    '--reference-image','B001/AR001');
  assert.equal(dependent.job.referenced_image_paths.at(-1),path.resolve(workspace,
    original.result.treatment.assetRequests[0].asset.file));
  await assert.rejects(cli('begin',work.workOrder,work.candidate,'B001/AR003',
    '--reference-image','B001/AR001'),/结果未知/);
  const [recovered]=await cli('prepare',work.workOrder,work.candidate);
  assert.deepEqual(recovered.referenceImages,dependent.job.referenced_image_paths);
  assert.deepEqual(recovered.record.job,dependent.job);
  await cli('import',work.workOrder,work.candidate,'B001/AR003',image);
  const imported=(await readData(work.candidate)).result.treatment.assetRequests[1].asset;
  const {provider,requestId,drawingDigest,visual,...actualJob}=await readData(path.resolve(workspace,imported.promptFile));
  assert.deepEqual(actualJob,dependent.job,'恢复导入沿用原显式参考与完整请求');
  const nextTask=await readData(work.workOrder);
  delete nextTask.taskDigest;
  nextTask.inputs.authorUnit.id='B002';
  nextTask.inputs.previousAuthorUnit={id:'B001',kind:'beat',templateId:'fullframe-narrative'};
  nextTask.inputs.previousTreatment={templateId:'fullframe-narrative',exitPicture:{
    requestId:'AR001',asset:original.result.treatment.assetRequests[0].asset}};
  nextTask.taskDigest=hashObject(nextTask);
  delete original.result.treatment.assetRequests[0].asset;
  await write(work.workOrder,nextTask);
  await write(work.candidate,{...original,taskDigest:nextTask.taskDigest});
  const [carried]=await cli('begin',work.workOrder,work.candidate,'B002/AR003','--reference-image','previous');
  assert.equal(carried.job.referenced_image_paths.at(-1),dependent.job.referenced_image_paths.at(-1));
});

test('全画幅同名异景不自动引入前图或整拍人物名录，同场与显式参考仍可继承', async t => {
  const {workspace,work,task,image,cli}=await setup(t);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const previous=(await readData(work.candidate)).result.treatment.assetRequests[0].asset;
  for (const [id,sameScene,explicit] of [['B002',false,false],['B003',true,false],['B004',false,true]]) {
    const nextTask=structuredClone(task);
    delete nextTask.taskDigest;
    nextTask.inputs.authorUnit.id=id;
    nextTask.inputs.previousAuthorUnit={id:'B001',kind:'beat',templateId:'fullframe-narrative'};
    nextTask.inputs.previousTreatment={templateId:'fullframe-narrative',
      continuity:{subjects:['来客'],props:[],carryToNext:{subjects:['来客'],props:[]}},
      exitPicture:{requestId:'AR001',asset:previous,sceneDescription:'来客在院门前等候。'}};
    nextTask.taskDigest=hashObject(nextTask);
    const next=treatment();
    next.continuity.continuesPreviousScene=sameScene;
    next.continuity.location=sameScene?'院落':'港口';
    next.assetRequests[0].sceneDescription=sameScene?'院门旁的石径与门槛相接。':'港口的货箱沿栈道连向泊位。';
    await write(work.workOrder,nextTask);
    await write(work.candidate,{taskDigest:nextTask.taskDigest,result:{treatment:next}});
    const [prepared]=await cli('prepare',work.workOrder,work.candidate);
    assert.equal(prepared.referenceImages.includes(path.resolve(workspace,previous.file)),sameScene);
    const [started]=await cli('begin',work.workOrder,work.candidate,`${id}/AR001`,
      ...(explicit?['--reference-image','previous']:[]));
    assert.equal(started.job.referenced_image_paths.includes(path.resolve(workspace,previous.file)),sameScene||explicit);
    assert.doesNotMatch(started.job.prompt,/"subjects"|"props"/u,'整拍对象名录不追加为本图人物义务');
    if (sameScene) assert.match(started.job.prompt,/来客在院门前等候/u,'真实同场保留上一场面');
    else assert.doesNotMatch(started.job.prompt,/来客/u,'异景仅消费本图原文');
    await assert.rejects(cli('begin',work.workOrder,work.candidate,`${id}/AR001`),/结果未知/);
    const [resumed]=await cli('prepare',work.workOrder,work.candidate);
    assert.deepEqual(resumed.record.job,started.job,'恢复使用实际原请求');
  }
});

test('Studio从作者实图直接装配；不需要素材计划或图片清单', async t => {
  const {workspace,paths,work,image,cli}=await setup(t);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const body=(await readData(work.candidate)).result.treatment;
  // A non-production image is reused only to exercise the real media consumer.
  const story={understanding:{},albumPlan:{},beats:[{id:'B001',templateId:body.templateId,cueRange:[1,1],treatment:body}],
    templateRuns:[],features:{'cue-sync':{bindings:{B001:{items:[binding]}}},'sound-effects':{units:{B001:{events:[
      {id:'S001',purpose:'关键区域显露',soundId:'paper',anchor:{target:'AR001',action:'start-frame-motion',offsetSeconds:1},gain:.4}
    ]}}}}};
  await write(paths.storyboard,story);
  await write(paths.sourceAssets,{assets:[]});
  await write(paths.narrationText,cues[0].text);
  const srt='1\n00:00:00,000 --> 00:00:06,000\n'+cues[0].text+'\n';
  await write(paths.narrationSubtitles,srt);
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','6','-y',paths.narrationAudio]);
  await write(paths.narrationPackage,{episodeId:'ep01',seriesTitle:'离线链路样本',durationMs:6000,files:{
    narration:{path:'narration.txt',sha256:sha256(cues[0].text)},subtitles:{path:'narration.srt',sha256:sha256(srt)},
    audio:{path:'narration.mp3',sha256:sha256(await readFile(paths.narrationAudio))}}});
  const bodyPreview=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B001']});
  assert.equal(bodyPreview.compositionId,'episode');
  assert.deepEqual(bodyPreview.renderPlan.segments.map(segment=>segment.id),['B001']);
  assert.equal(bodyPreview.renderPlan.audioTracks.filter(track=>track.kind==='sound-effect').length,1,
    '全画幅声音沿正式P4计划与Studio消费，不依赖第二份素材清单');
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root}),/尚无正式片头设计/);
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['opener']}),/尚无正式片头设计/);
  const opener=(await readData(path.join(root,'packages/templates/documentary-opener/examples/golden.json'))).result;
  opener.memoryShots=opener.memoryShots.map(shot=>({...shot,bodyRefs:['B001']}));
  opener.hero.bodyRefs=['B001'];
  opener.hero.sourceRefs=['C001'];
  const p4=getStageWorkPaths(paths,'p4',null,'opener');
  const task={subject:{kind:'episode',id:'ep01'},moduleId:'author-bookend',nodeId:'opener',stageId:'p4',
    candidatePath:path.relative(workspace,p4.candidate),scratchPath:path.relative(workspace,path.join(p4.work,'attempt-opener')),
    resolvedAssembly:{slots:[{id:'opener-template',implementations:[{packageId:'documentary-opener'}]}]},inputs:{sourceAssets:[]}};
  task.taskDigest=hashObject(task);
  await write(p4.workOrder,task);await write(p4.candidate,{taskDigest:task.taskDigest,result:opener});
  const [job]=await cli('prepare',p4.workOrder,p4.candidate);
  await cli('begin',p4.workOrder,p4.candidate,job.key);
  await cli('import',p4.workOrder,p4.candidate,job.key,image);
  await write(paths.episodePackage,{episodeId:'ep01',opener:(await readData(p4.candidate)).result});
  const plan={episodeId:'ep01',templateId:'cinematic-video',selectionReason:'本样本不生成视频',incomingTransitions:{},spans:[]};
  await write(paths.videoPlan,accepted(plan,'author-video','video'));
  await write(paths.videoManifest,accepted({episodeId:'ep01',videoPlanSha256:hashObject(projectVideoProduction(plan)),clips:[]},'produce-video-assets','video-assets'));
  const studio=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root});
  assert.equal(studio.compositionId,'episode');
  assert.ok(studio.renderPlan.segments.some(segment=>segment.templateId==='fullframe-narrative'));
  assert.ok(studio.renderPlan.segments.some(segment=>segment.templateId==='documentary-opener'));
  assert.ok((await readFile(studio.propsPath)).length>0);
  assert.equal(paths.assetPlan,undefined);assert.equal(paths.assetManifest,undefined);
  const covered=await collectAuthoredMedia({storyboard:story,cues,videoPlan:{spans:[{beatIds:['B001']}]},bodyDurationMs:6000});
  assert.equal(covered.items.length,0,'已被视频接管的静图不是成片媒体依赖');
  const map={templateId:'vox-explainer',objective:'辨认海岸',appearance:createAppearance({palette:{
    background:'#ffffff',ink:'#202020',paper:'#f0f0f0',accent:'#c83c32',secondary:'#3268c8'}}),assetRequests:[],
    continuity:body.continuity,moments:[{id:'M001',purpose:'定位海岸',sourceRefs:['C002']}],
    scene:{markup:'<svg viewBox="0 0 1920 1080"><path d="M100 300L800 400" stroke="var(--ink)"/></svg>',animation:'timeline.set(select("path"),{opacity:1},cue("M001"));'}};
  const mapText='这里是海岸。',mapSrt=srt+'\n2\n00:00:06,000 --> 00:00:12,000\n'+mapText
    +'\n\n3\n00:00:12,000 --> 00:00:18,000\n后续场景。\n\n4\n00:00:18,000 --> 00:00:24,000\n后续地图。\n';
  const narration=cues[0].text+'\n'+mapText+'\n后续场景。\n后续地图。';
  await write(paths.narrationText,narration);await write(paths.narrationSubtitles,mapSrt);
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','24','-y',paths.narrationAudio]);
  await write(paths.narrationPackage,{episodeId:'ep01',seriesTitle:'离线链路样本',durationMs:24000,files:{
    narration:{path:'narration.txt',sha256:sha256(narration)},subtitles:{path:'narration.srt',sha256:sha256(mapSrt)},
    audio:{path:'narration.mp3',sha256:sha256(await readFile(paths.narrationAudio))}}});
  await write(paths.storyboard,{...story,beats:[...story.beats,
    {id:'B002',templateId:'vox-explainer',cueRange:[2,2],treatment:null},
    {id:'B003',templateId:'fullframe-narrative',cueRange:[3,3],treatment:null},
    {id:'B004',templateId:'vox-explainer',cueRange:[4,4],treatment:null}],
    templateRuns:[{id:'TR001',templateId:'vox-explainer',beatIds:['B002'],treatment:map},
      {id:'TR002',templateId:'vox-explainer',beatIds:['B004'],treatment:null}],
    features:{'cue-sync':{bindings:{...story.features['cue-sync'].bindings,
      TR001:{items:[{target:'M001',action:'advance-explainer',cueId:2,edge:'start'}]}}}}});
  const mapPreview=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B002']});
  assert.deepEqual(mapPreview.renderPlan.preview.segmentIds,['TR001'],'按成员Beat选择时必须实际包含地图段');
  assert.equal(mapPreview.renderPlan.segments.find(segment=>segment.id==='TR001').renderData.voxExplainer.scene.markup,map.scene.markup,'直接保留所选空间段完整画面');
  const jointPreview=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B001','B002']});
  assert.equal(jointPreview.renderPlan.transitions.find(boundary=>boundary.nextId==='TR001').explainerPush,true,'讲解入口沿专用整幅推入');
  assert.equal(mapPreview.renderPlan.segments.find(segment=>segment.id==='TR001').appliedEntryTransition,null,'不套用全画幅叠化或闪黑');
  const previewBaseline = await readData(paths.storyboard);
  const isolatedBaseline = await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B001']});
  const outsideWindow = structuredClone(previewBaseline);
  const obsoleteBody = structuredClone(body);
  obsoleteBody.incomingTransition = {type:'cut',durationMs:0,reason:'范围外的旧设计'};
  outsideWindow.beats[2].treatment = obsoleteBody;
  outsideWindow.beats[3] = {...outsideWindow.beats[3],templateId:'fullframe-narrative',treatment:obsoleteBody};
  outsideWindow.templateRuns = outsideWindow.templateRuns.filter(run=>run.id!=='TR002');
  outsideWindow.features['cue-sync'].bindings.B003 = {items:[{...binding,cueId:3}]};
  outsideWindow.features['cue-sync'].bindings.B004 = {items:[{...binding,cueId:4}]};
  await write(paths.storyboard,outsideWindow);
  const isolatedPreview = await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B001']});
  assert.deepEqual(isolatedPreview.renderPlan.preview.segmentIds,['B001']);
  assert.deepEqual(isolatedPreview.renderPlan.segments[0].renderData,isolatedBaseline.renderPlan.segments[0].renderData,
    '范围外旧转场不改变所选镜头的相机与画面');
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B003','B004']}),/未知正文转场 cut/);
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root}),/未知正文转场 cut/);
  await write(paths.storyboard,previewBaseline);
  const openerPreview=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['opener']});
  assert.deepEqual(openerPreview.renderPlan.preview.segmentIds,['opener'],'片头预览保留引用的正文图片');
  for (const id of ['B003','B004']) await assert.rejects(
    prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:[id]}),/缺少.*treatment/);
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root}),/TR002 缺少.*treatment/);
  await assert.rejects(collectAuthoredMedia({storyboard:await readData(paths.storyboard),
    cues:[...cues,{id:2,startMs:6000,endMs:12000,text:mapText},{id:3,startMs:12000,endMs:18000,text:'后续场景。'}],
    bodyDurationMs:24000}),/B003 尚未交付画面/);
  const missingBackground=await readData(paths.storyboard);
  delete missingBackground.beats[0].treatment.assetRequests[0].asset;
  await write(paths.storyboard,missingBackground);
  await assert.rejects(prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root,previewSegmentIds:['B002']}),
    /B001\/AR001 尚未交付实际图片/);
});

test('剧情视频首图来自原作者，未知远端仍恢复原任务', async t => {
  const {workspace,paths,image,cli}=await setup(t);
  const span={id:'V001',beatIds:['B001'],storyChange:'来客走向院门',sourceRefs:['C001'],mustNotInvent:[],
    firstFramePrompt:'院落中，来客站在石径起点，前方是关闭的院门。',
    shots:[{id:'S01',durationMs:6000}],parts:[{shotIds:['S01'],videoPrompt:'来客沿石径走向院门。'}]};
  const work=getStageWorkPaths(paths,'p4',null,'video');
  const task={subject:{kind:'episode',id:'ep01'},moduleId:'author-video',stageId:'p4',
    candidatePath:path.relative(workspace,work.candidate),scratchPath:path.relative(workspace,path.join(work.work,'attempt-video')),
    resolvedAssembly:{slots:[{id:'video-template',implementations:[{packageId:'cinematic-video'}]}]},
    inputs:{cues,sourceAssets:[],storyboard:{content:{beats:[{id:'B001',templateId:'fullframe-narrative',cueRange:[1,1],treatment:treatment()}]}}}};
  task.taskDigest=hashObject(task);
  await write(work.workOrder,task);
  await write(work.candidate,{taskDigest:task.taskDigest,result:{templateId:'cinematic-video',spans:[span]}});
  await cli('begin',work.workOrder,work.candidate,'V001/AR001');
  await cli('import',work.workOrder,work.candidate,'V001/AR001',image);
  span.asset=(await readData(work.candidate)).result.spans[0].asset;
  assert.equal(firstFrameFor({span}).sha256,span.asset.sha256);
  assert.throws(()=>firstFrameFor({span:{id:'V001'}}),/首图|首帧|图片/);
  const request={episodeId:'ep01',spanId:'V001',partIndex:1,firstFrameSha256:span.asset.sha256,
    designDigest:'d'.repeat(64),frameCount:360,seconds:6,model:'fixture',resolution:'720p'};
  const receipt={request,requestDigest:hashObject(request),state:'submitting',submitId:'existing-remote'};
  const selected=selectPartRequest({receipts:[receipt],proposedRequest:request});
  assert.equal(selected.receipt,receipt);
});

test('第三片头沿原图片交付和Studio入口接入真实正文，不改变正文时间', async t => {
  const {workspace,paths,work,image,cli}=await setup(t);
  await cli('begin',work.workOrder,work.candidate,'B001/AR001');
  await cli('import',work.workOrder,work.candidate,'B001/AR001',image);
  const body=(await readData(work.candidate)).result.treatment;
  await write(paths.storyboard,{understanding:{},albumPlan:{},beats:[{id:'B001',templateId:body.templateId,cueRange:[1,1],treatment:body}],
    templateRuns:[],features:{'cue-sync':{bindings:{B001:{items:[binding]}}}}});
  await write(paths.sourceAssets,{assets:[]});
  await write(paths.narrationText,cues[0].text);
  const srt='1\n00:00:00,000 --> 00:00:06,000\n'+cues[0].text+'\n';
  await write(paths.narrationSubtitles,srt);
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','6','-y',paths.narrationAudio]);
  await write(paths.narrationPackage,{episodeId:'ep01',seriesTitle:'离线链路样本',durationMs:6000,files:{
    narration:{path:'narration.txt',sha256:sha256(cues[0].text)},subtitles:{path:'narration.srt',sha256:sha256(srt)},
    audio:{path:'narration.mp3',sha256:sha256(await readFile(paths.narrationAudio))}}});
  const opener=(await readData(path.join(root,'packages/templates/crossfire-opener/examples/golden.json'))).result;
  opener.flashbackShots.forEach(shot=>{shot.bodyRefs=['B001'];shot.sourceRefs=['C001'];});
  const p4=getStageWorkPaths(paths,'p4',null,'opener');
  const task={subject:{kind:'episode',id:'ep01'},moduleId:'author-bookend',nodeId:'opener',stageId:'p4',
    candidatePath:path.relative(workspace,p4.candidate),scratchPath:path.relative(workspace,path.join(p4.work,'attempt-opener')),
    resolvedAssembly:{slots:[{id:'opener-template',implementations:[{packageId:'crossfire-opener'}]}]},inputs:{sourceAssets:[]}};
  task.taskDigest=hashObject(task);
  await write(p4.workOrder,task);await write(p4.candidate,{taskDigest:task.taskDigest,result:opener});
  const jobs=await cli('prepare',p4.workOrder,p4.candidate);
  for(const job of jobs){await cli('begin',p4.workOrder,p4.candidate,job.key);await cli('import',p4.workOrder,p4.candidate,job.key,image);}
  const result=(await readData(p4.candidate)).result;
  const voice=path.join(paths.p4,'opener-narration.mp3');
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','5','-y',voice]);
  result.narration={textSha256:sha256(result.flashbackLine),audioSha256:sha256(await readFile(voice)),durationMs:5000,ttsFingerprint:'a'.repeat(64),sentenceCues:[{target:'flashbackLine',startMs:0,endMs:4900}]};
  const {validate}=await import('../packages/templates/crossfire-opener/validate.mjs');
  const context={openerNarration:result.flashbackLine,templateContext:{episodeTitle:result.episodeTitle},cues,bodyStoryboard:await readData(paths.storyboard)};
  const {validateSchema}=await import('./runtime/schema.mjs');
  await validateSchema(path.join(root,'contracts/crossfire-opener-treatment.schema.json'),result,'第三片头');
  assert.deepEqual(validate({result,context}),[]);
  const bad=structuredClone(result);bad.narration.durationMs=5500;
  assert.ok(validate({result:bad,context}).some(error=>error.includes('5.38')));
  await write(paths.episodePackage,{episodeId:'ep01',opener:result});
  const plan={episodeId:'ep01',templateId:'cinematic-video',selectionReason:'离线样本不生成视频',incomingTransitions:{},spans:[]};
  await write(paths.videoPlan,accepted(plan,'author-video','video'));
  await write(paths.videoManifest,accepted({episodeId:'ep01',videoPlanSha256:hashObject(projectVideoProduction(plan)),clips:[]},'produce-video-assets','video-assets'));
  const studio=await prepareStudio({episodeId:'ep01',workspaceRoot:workspace,systemRoot:root});
  const rendered=studio.renderPlan;
  assert.equal(rendered.segments[0].templateId,'crossfire-opener');
  assert.equal(rendered.segments[0].durationInFrames,480);
  assert.equal(rendered.segments[1].startMs,8000);
  assert.equal(rendered.segments[1].appliedEntryTransition.type,'crossfire-open');
  assert.equal(rendered.audioTracks.find(track=>track.id==='opener-narration').startMs,100);
  assert.equal(rendered.audioTracks.find(track=>track.id==='body-narration').startMs,8000);
  assert.equal(rendered.audioTracks.find(track=>track.id==='crossfire-land').sourceStartFrame,20);
});
