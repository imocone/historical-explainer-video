import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { validateSchema } from "../../../engine/runtime/schema.mjs";
import { imageDescriptors } from "../../authored-images.mjs";
import { hashObject, sha256 } from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { DEFAULT_OPENER_TEMPLATE_ID, programOpenerTemplateId } from "../../opener-template-selection.mjs";
import { validateAcceptance as acceptProgram } from "../../modules/plan-program/validate.mjs";
import { validateAcceptance as acceptBookend } from "../../modules/author-bookend/validate.mjs";
import { createOpenerTimingService } from "../../modules/author-bookend/opener-timing.mjs";
import { assertAudioTracks } from "../../modules/render-video/runtime/render-contracts.mjs";
import { openerTimelineForTreatment } from "./render-policy.mjs";
import { renderData } from "./render-plan.mjs";
import { validate } from "./validate.mjs";

const exec = promisify(execFile);
const fixture = JSON.parse(await readFile(new URL("./examples/golden.json", import.meta.url), "utf8")).result;
const context = {openerNarration: fixture.flashbackLine, cues:[{id:1}],
  semanticContext:{facts:[{id:"R001"}]}, bodyStoryboard:{beats:[
    {id:"B001",treatment:{}}, {id:"B002",treatment:{}}
  ]}};

test("默认选择新模板，明确选择的旧片头和已有节目保持可用", async () => {
  assert.equal(DEFAULT_OPENER_TEMPLATE_ID, "opposed-opener");
  const result = {programForm:"historical-explainer", openerTemplate:"opposed-opener"};
  assert.deepEqual(await acceptProgram({result,context:{programRequest:{}}}), []);
  result.openerTemplate = "episode-opener";
  assert.ok((await acceptProgram({result,context:{programRequest:{}}})).length);
  assert.deepEqual(await acceptProgram({result,context:{programRequest:{openerTemplate:"episode-opener"}}}), []);
  assert.equal(programOpenerTemplateId({openerTemplate:"crossfire-opener"}), "crossfire-opener");
});

test("一段一图，分段文字、音轨和弹开卡点随真实口播走", async () => {
  const two = structuredClone(fixture);
  const hash = "a".repeat(64);
  for (const shot of two.flashbackShots) shot.asset = {provider:"image-gen",file:"fixture.png",sha256:hash,
    mimeType:"image/png",width:1920,height:1080,drawingDigest:hash,promptFile:"fixture.json",promptSha256:hash,
    visual:{packageId:"fixture",version:"1",profileId:"fixture",profileDigest:hash,referenceId:"fixture"}};
  await validateSchema(new URL("../../../contracts/opposed-opener-treatment.schema.json", import.meta.url).pathname, two, "逐段片头");
  assert.deepEqual(validate({result:two,context}), []);
  const broken = structuredClone(two);
  broken.flashbackShots[1].spokenText = "先卖家田？";
  assert.ok(validate({result:broken,context}).some(error => error.includes("全部有声文字")));
  for (const count of [1,2,3,4]) {
    const pieces = ["先修桥。", "再铺路。", "最后通车。", "全线贯通。"].slice(0,count);
    const treatment = {templateId:"opposed-opener", flashbackLine:pieces.join(""),
      flashbackShots:pieces.map((text,i) => ({...structuredClone(fixture.flashbackShots[0]),
        id:`O0${i+1}`, spokenText:text, screenLines:[text], highlight:""})),
      narration:{durationMs:count*1100, sentenceCues:pieces.map((_,i) => ({target:`O0${i+1}`,startMs:i*1100+100,endMs:i*1100+800}))}};
    assert.equal((await imageDescriptors({treatment})).length, count);
    const timeline = openerTimelineForTreatment(treatment);
    const {audioTracks,exitTransition} = renderData({treatment});
    assert.equal(timeline.cuts.length, count);
    assert.equal(audioTracks.filter(track=>track.id.startsWith("opposed-rush-top-")).length, count);
    assert.equal(audioTracks.filter(track=>track.id.startsWith("opposed-rush-bottom-")).length, count);
    assert.equal(audioTracks.find(track=>track.id === "opposed-release-gear").startFrame, timeline.releaseFrame-4);
    assert.ok(timeline.releaseFrame >= Math.round((count*1100-300+1000)*.06));
    assert.equal(exitTransition.durationInFrames, timeline.durationFrames-timeline.releaseFrame);
    const tracks = audioTracks.map(({startFrame,endFrame,...track}) => ({...track,startMs:startFrame/60*1000,endMs:endFrame/60*1000}));
    assert.doesNotThrow(() => assertAudioTracks({audioTracks:tracks,segments:[{segmentType:"opener",startMs:0,endMs:timeline.durationFrames/60*1000}],durationMs:timeline.durationFrames/60*1000}));
    for (let i=1;i<count;i++) {
      assert.ok(timeline.cuts[i] >= Math.round(treatment.narration.sentenceCues[i-1].endMs*.06));
      if (i<count-1) assert.equal(timeline.cuts[i], Math.round(treatment.narration.sentenceCues[i].startMs*.06));
      else assert.ok(timeline.cuts[i] <= Math.round(treatment.narration.sentenceCues[i].startMs*.06));
    }
  }
});

test("两句和三句的最后一张承接停顿并蓄力，紧连的口播不提前切断画面", () => {
  const treatment = (cues,durationMs) => ({
    flashbackShots:cues.map((_,i)=>({id:`O0${i+1}`})),
    narration:{durationMs,sentenceCues:cues.map(([startMs,endMs],i)=>({target:`O0${i+1}`,startMs,endMs}))}
  });
  const three=openerTimelineForTreatment(treatment([[0,1186],[1517,2293],[3149,3941]],4215));
  assert.deepEqual(three.cuts,[0,91,168]);
  assert.equal(three.releaseFrame,296);
  assert.ok(three.releaseFrame-three.cuts[2] > three.cuts[2]-three.cuts[1]);
  assert.ok(three.releaseFrame-three.cuts[2] > three.cuts[1]);
  const two=openerTimelineForTreatment(treatment([[0,1186],[1517,2293]],2500));
  assert.deepEqual(two.cuts,[0,83]);
  assert.equal(two.releaseFrame,198);
  assert.ok(two.releaseFrame-two.cuts[1] > two.cuts[1]);
  const adjacent=openerTimelineForTreatment(treatment([[0,1000],[1000,1800]],1800));
  assert.equal(adjacent.cuts[1],60);
  assert.equal(adjacent.releaseFrame,168);
  const longPause=openerTimelineForTreatment(treatment([[0,1000],[3000,3500]],3600));
  assert.deepEqual(longPause.cuts,[0,144]);
  assert.equal(longPause.releaseFrame,309);
  assert.ok(longPause.releaseFrame-longPause.cuts[1] > longPause.cuts[1]);
  const earlierPause=openerTimelineForTreatment(treatment([[0,500],[2100,2600],[2800,3300]],3500));
  const finalHold=earlierPause.releaseFrame/60*1000-3300;
  const firstBreath=earlierPause.cuts[1]/60*1000-500;
  const secondBreath=earlierPause.cuts[2]/60*1000-2600;
  assert.ok(finalHold >= Math.max(firstBreath,secondBreath)+240);
});

test("真实词级卡点可按两段和三段映射", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opposed-timing-"));
  t.after(() => rm(root,{recursive:true,force:true}));
  const fixturePath = path.join(root,"words.json"), python = path.join(root,"captioner");
  await writeFile(fixturePath,JSON.stringify({
    1:{start_time:100,end_time:600,original_subtitle:"先修桥"},
    2:{start_time:900,end_time:1400,original_subtitle:"再铺路"},
    3:{start_time:1800,end_time:2400,original_subtitle:"最后通车"}
  }));
  await writeFile(python,`#!${process.execPath}\nconst fs=require("node:fs");const a=process.argv.slice(2);if(a.includes("--help"))console.log("jianying bijian --word-timestamps json");else fs.copyFileSync(${JSON.stringify(fixturePath)},a[a.indexOf("-o")+1]);\n`,{mode:0o755});
  const service=createOpenerTimingService({root,python,workDir:path.join(root,"timing")});
  for (const [sentences, expected] of [
    [[{target:"O01",text:"先修桥，再铺路，"},{target:"O02",text:"最后通车。"}],[[100,1400],[1800,2400]]],
    [[{target:"O01",text:"先修桥，"},{target:"O02",text:"再铺路，"},{target:"O03",text:"最后通车。"}],[[100,600],[900,1400],[1800,2400]]]
  ]) {
    const timed=await service.time({audioPath:path.join(root,"voice.mp3"),sentences});
    assert.deepEqual(timed.sentenceCues.map(cue=>[cue.startMs,cue.endMs]),expected);
  }
});

test("本地转录末字零时长时，用实际停顿定位两段，不虚构字级时间", async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),"opposed-pause-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const fixturePath=path.join(root,"words.json"), python=path.join(root,"captioner"), audio=path.join(root,"voice.wav");
  const words={1:{start_time:200,end_time:1500,original_subtitle:"先修桥"},
    2:{start_time:1600,end_time:2600,original_subtitle:"再铺"},
    3:{start_time:2600,end_time:2600,original_subtitle:"路"}};
  await writeFile(fixturePath,JSON.stringify(words));
  await writeFile(python,`#!${process.execPath}\nconst fs=require("node:fs");const a=process.argv.slice(2);if(a.includes("--help"))console.log("jianying bijian --word-timestamps json");else if(a[a.indexOf("--asr")+1]!=="whisper-cpp")process.exit(1);else fs.copyFileSync(${JSON.stringify(fixturePath)},a[a.indexOf("-o")+1]);\n`,{mode:0o755});
  await exec("ffmpeg",["-v","error","-y","-f","lavfi","-i",
    "aevalsrc=if(between(t\\,0.2\\,1)+between(t\\,1.6\\,2.3)\\,0.2*sin(2*PI*440*t)\\,0):s=16000:d=2.6",audio]);
  const service=createOpenerTimingService({root,python,workDir:path.join(root,"timing")});
  const request={audioPath:audio,durationMs:2600,sentences:[{target:"O01",text:"先修桥，"},{target:"O02",text:"再铺路。"}]};
  const timed=await service.time(request);
  assert.equal(timed.evidence.actualModel,"WHISPER_CPP");
  for(const [actual,expected] of timed.sentenceCues.map(cue=>[cue.startMs,cue.endMs]).flat().map((value,i)=>[value,[200,1000,1600,2300][i]]))
    assert.ok(Math.abs(actual-expected)<30,`${actual} vs ${expected}`);
  words[2].original_subtitle="再扑";
  await writeFile(fixturePath,JSON.stringify(words));
  const homophone=await service.time(request);
  assert.equal(homophone.sentenceCues[1].recognizedText,"再扑路");
  assert.ok(Math.abs(homophone.sentenceCues[1].startMs-1600)<30);
  words[2].original_subtitle="天地";
  words[3].original_subtitle="山";
  await writeFile(fixturePath,JSON.stringify(words));
  await assert.rejects(service.time(request),/无法形成片头真实卡点/);
  await writeFile(fixturePath,JSON.stringify({1:{start_time:200,end_time:1200,original_subtitle:"先修桥"},
    2:{start_time:1200,end_time:2200,original_subtitle:"再扑路"},3:{start_time:2200,end_time:3100,original_subtitle:"最后通"},
    4:{start_time:3100,end_time:3100,original_subtitle:"车"}}));
  await exec("ffmpeg",["-v","error","-y","-f","lavfi","-i",
    "aevalsrc=if(between(t\\,0.2\\,0.8)+between(t\\,1.2\\,1.8)+between(t\\,2.2\\,2.8)\\,0.2*sin(2*PI*440*t)\\,0):s=16000:d=3.1",audio]);
  const three=await service.time({audioPath:audio,durationMs:3100,sentences:[
    {target:"O01",text:"先修桥，"},{target:"O02",text:"再铺路，"},{target:"O03",text:"最后通车。"}]});
  for(const [actual,expected] of three.sentenceCues.map(cue=>[cue.startMs,cue.endMs]).flat().map((value,i)=>[value,[200,800,1200,1800,2200,2800][i]]))
    assert.ok(Math.abs(actual-expected)<30,`${actual} vs ${expected}`);
});

test("改分段时复用同一配音，配音记录或文件缺失时不重复提交", async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),"opposed-accept-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const paths=getEpisodePaths(root,"ep01"), work=getStageWorkPaths(paths,"p4");
  const imageDirectory=path.join(paths.p4,"assets","opener");
  await mkdir(imageDirectory,{recursive:true});
  const image=path.join(imageDirectory,"fixture.png"), prompt=path.join(imageDirectory,"fixture.json");
  await writeFile(image,"fixture image"); await writeFile(prompt,"fixture prompt");
  const asset={provider:"image-gen",file:path.relative(root,image),sha256:sha256(await readFile(image)),
    promptFile:path.relative(root,prompt),promptSha256:sha256(await readFile(prompt))};
  const audio=path.join(root,"fixture.mp3");
  await exec("ffmpeg",["-v","error","-f","lavfi","-i","anullsrc=r=32000:cl=mono","-t","4","-y",audio]);
  let submissions=0,timings=0;
  const services={workspaceRoot:root,episodeId:"ep01",authorizePaidTts:true,
    task:{taskDigest:hashObject({test:"opposed"}),inputs:{}},
    ttsService:{async synthesize(){submissions++;return {audio:await readFile(audio),remoteTaskId:"fixture"};}},
    timingService:{async time({sentences}){timings++;return {sentenceCues:sentences.map((item,i)=>({...item,
      recognizedText:item.text,startMs:100+i*900,endMs:600+i*900})),
      evidence:{provider:"video-captioner",actualModel:"JIANYING",fallbackOccurred:false,wordTimelineSha256:"a".repeat(64)}};}}};
  const pieces=["先修桥，","再铺路，","最后通车。"];
  const shot=(text,i)=>({...structuredClone(fixture.flashbackShots[0]),id:`O0${i+1}`,
    spokenText:text,screenLines:[text],highlight:"",asset});
  const result={templateId:"opposed-opener",flashbackLine:pieces.join(""),
    flashbackShots:[shot(pieces[0]+pieces[1],0),shot(pieces[2],1)]};
  const accept=()=>acceptBookend({result,context:{segmentType:"opener"},services});
  assert.deepEqual(await accept(),[]);
  assert.equal(submissions,1); assert.equal(timings,1);
  result.flashbackShots=pieces.map(shot);
  await rm(path.join(paths.p4,"opener-tts-input.txt"));
  await rm(path.join(work.work,"opener-tts-intent.yaml"));
  assert.deepEqual(await accept(),[]);
  assert.equal(submissions,1); assert.equal(timings,2);
  assert.equal(result.narration.sentenceCues.length,3);
  result.flashbackShots=[shot(pieces[0]+pieces[1],0),shot(pieces[2],1)];
  await writeFile(path.join(paths.p4,"opener-tts-input.txt"),"错误输入");
  assert.ok((await accept()).some(error=>error.includes("不能重复提交")));
  assert.equal(submissions,1);
  await rm(path.join(paths.p4,"opener-tts-input.txt"));
  await rm(path.join(paths.p4,"opener-narration.mp3"));
  assert.ok((await accept()).some(error=>error.includes("不能重复提交")));
  assert.equal(submissions,1);
});
