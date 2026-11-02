import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadPackages, assertPackageResources } from "../../../engine/runtime/packages.mjs";
import { validateSchema } from "../../../engine/runtime/schema.mjs";
import { imageDescriptors } from "../../authored-images.mjs";
import { DEFAULT_OPENER_TEMPLATE_ID } from "../../opener-template-selection.mjs";
import { assertAudioTracks } from "../../modules/render-video/runtime/render-contracts.mjs";
import { buildSegmentPreviewProps } from "../../modules/render-video/runtime/preview-props.mjs";
import { narrativeHandleFrames } from "../../modules/render-video/runtime/narrative-transition.mjs";
import { resolveCrossBeatRuntimeTiming } from "../../modules/render-video/runtime/transitions.mjs";
import { fullframeRuntimeTimingForAuthorUnits } from "../fullframe-narrative/camera/author-transition-handoff.mjs";
import { renderData as defaultOpenerRenderData } from "../opposed-opener/render-plan.mjs";
import { assertActionTimingsForTreatment, defaultActionTimingsForTreatment, durationMs, renderData } from "./render-plan.mjs";
import { POST_EXIT_BREATH_FRAMES } from "./render-policy.mjs";
import { validate } from "./validate.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = JSON.parse(await readFile(new URL("./examples/golden.json", import.meta.url), "utf8")).result;

test("逗号前后各一图，不硬拆也不拆千分位和小数", () => {
  const resultFor = (line,pieces) => ({templateId:"glass-opener",flashbackLine:line,
    flashbackShots:pieces.map((spokenText,i) => ({id:`O0${i+1}`,spokenText,screenLines:[spokenText]}))});
  for (const [line,pieces] of [
    ["他要进京赶考，为什么先卖家田？",["他要进京赶考，","为什么先卖家田？"]],
    ["日本赢了奉天。日本赢了对马。为何没有赔款？",["日本赢了奉天。","日本赢了对马。","为何没有赔款？"]],
    ["涨到1,000人，增长3.14倍。",["涨到1,000人，","增长3.14倍。"]]
  ]) assert.deepEqual(validate({result:resultFor(line,pieces)}), []);
  for (const [line,pieces] of [
    ["他要进京赶考，为什么先卖家田？",["他要进京赶考，为什么先卖家田？"]],
    ["他要进京赶考。",["他要进京","赶考。"]]
  ]) assert.ok(validate({result:resultFor(line,pieces)}).some(error => error.includes("按原文逗号")));
});

test("可选玻璃片头接入原作者和渲染链，原默认选择不变", async () => {
  const packages = await loadPackages(root, {includeKinds:new Set(["template"])});
  const record = packages.get("glass-opener");
  assert.ok(record);
  await assertPackageResources(root, record);
  for (const moduleId of ["author-narration", "author-documentary-narration", "author-bookend", "render-video"])
    assert.ok(record.manifest.implements.some(slot => slot.moduleId === moduleId));
  assert.equal(DEFAULT_OPENER_TEMPLATE_ID, "opposed-opener");
  assert.equal((await imageDescriptors({treatment:fixture})).length, 2);
  const withAssets = structuredClone(fixture);
  const hash = "a".repeat(64);
  for (const shot of withAssets.flashbackShots) shot.asset = {provider:"image-gen",file:"fixture.png",sha256:hash,
    mimeType:"image/png",width:1920,height:1080,drawingDigest:hash,promptFile:"fixture.json",promptSha256:hash,
    visual:{packageId:"fixture",version:"1",profileId:"fixture",profileDigest:hash,referenceId:"fixture"}};
  await validateSchema(new URL("../../../contracts/glass-opener-treatment.schema.json", import.meta.url).pathname, withAssets, "玻璃片头");
  assert.deepEqual(validate({result:withAssets, context:{openerNarration:fixture.flashbackLine, cues:[{id:1}],
    semanticContext:{facts:[{id:"R001"}]}, bodyStoryboard:{beats:[{id:"B001",treatment:{}},{id:"B002",treatment:{}}]}}}), []);
});

test("两段和三段各自对冲，最后一段蓄力后接真实正文", () => {
  for (const count of [2,3]) {
    const cues = Array.from({length:count}, (_,i) => ({target:`O0${i+1}`,startMs:i*1100+100,endMs:i*1100+800}));
    const treatment = {flashbackShots:cues.map(cue => ({id:cue.target})), narration:{durationMs:count*1100,sentenceCues:cues}};
    const {openerTimeline:timeline, audioTracks, exitTransition, resourceFiles} = renderData({treatment});
    const original=defaultOpenerRenderData({treatment});
    assert.equal(timeline.cuts.length,count);
    assert.deepEqual(audioTracks, original.audioTracks);
    assert.equal(timeline.releaseFrame,original.openerTimeline.releaseFrame);
    assert.equal(timeline.durationFrames,original.openerTimeline.durationFrames+POST_EXIT_BREATH_FRAMES);
    assert.equal(durationMs({treatment}),Math.ceil(timeline.durationFrames/60*1000));
    const actionTimings=defaultActionTimingsForTreatment({treatment});
    assert.deepEqual(assertActionTimingsForTreatment({treatment,actionTimings,durationInFrames:timeline.durationFrames}),actionTimings);
    const handoff=resolveCrossBeatRuntimeTiming({segments:[
      {id:"opener",templateId:"glass-opener",segmentType:"opener",startFrame:0,durationInFrames:timeline.durationFrames,exitTransition},
      {id:"body",templateId:"fullframe-narrative",segmentType:"body",startFrame:timeline.durationFrames,durationInFrames:600}
    ]});
    assert.equal(handoff.transitions[0].startFrame,timeline.releaseFrame);
    assert.equal(handoff.segments[1].startFrame-(timeline.releaseFrame+timeline.exitFrames),POST_EXIT_BREATH_FRAMES);
    assert.equal(handoff.segments[1].appliedCameraPrerollFrames,exitTransition.durationInFrames);
    assert.doesNotThrow(()=>resolveCrossBeatRuntimeTiming({segments:[
      {id:"opener",templateId:"glass-opener",segmentType:"opener",startFrame:0,durationInFrames:timeline.durationFrames,exitTransition},
      {id:"body",templateId:"fullframe-narrative",segmentType:"body",startFrame:timeline.durationFrames,durationInFrames:30}
    ]}),"短首镜在提前入画时不应被误判为转场过长");
    for (const templateId of ["cinematic-video","vox-explainer"]) {
      const boundary=resolveCrossBeatRuntimeTiming({segments:[
        {id:"opener",templateId:"glass-opener",segmentType:"opener",startFrame:0,durationInFrames:timeline.durationFrames,exitTransition},
        {id:"body",templateId,segmentType:"body",startFrame:timeline.durationFrames,durationInFrames:600}
      ]});
      assert.equal(boundary.transitions[0].startFrame,timeline.releaseFrame);
      assert.equal(boundary.segments[1].startFrame-(timeline.releaseFrame+timeline.exitFrames),POST_EXIT_BREATH_FRAMES);
    }
    assert.ok(exitTransition.durationInFrames<=narrativeHandleFrames(),"正文视频的既有入场余量须覆盖整段交接");
    assert.equal(audioTracks.filter(track => track.id.startsWith("opposed-rush-top-")).length,count);
    assert.equal(audioTracks.filter(track => track.id.startsWith("opposed-rush-bottom-")).length,count);
    assert.ok(timeline.releaseFrame >= Math.round((cues.at(-1).endMs+1000)*.06));
    const release = audioTracks.find(track => track.id === "opposed-release-gear");
    assert.equal(release.startFrame, timeline.releaseFrame-4);
    assert.ok(resourceFiles.length && resourceFiles.every(file => file.startsWith("packages/templates/glass-opener/")));
    const tracks = audioTracks.map(({startFrame,endFrame,...track}) => ({...track,startMs:startFrame/60*1000,endMs:endFrame/60*1000}));
    const openerEnd = timeline.durationFrames/60*1000;
    const segments = [{segmentType:"opener",startMs:0,endMs:openerEnd},
      {segmentType:"body",startMs:openerEnd,endMs:openerEnd+1000}];
    assert.doesNotThrow(() => assertAudioTracks({audioTracks:tracks,segments,durationMs:openerEnd+1000}));
    const music = tracks.find(track => track.kind === "background-music");
    assert.throws(() => assertAudioTracks({audioTracks:[{...music,endMs:openerEnd+100}],segments,durationMs:openerEnd+1000}), /音轨超出/);
    const tailEffect = {...tracks.find(track => track.id === "opposed-release-gear"),endMs:openerEnd+100};
    assert.doesNotThrow(() => assertAudioTracks({audioTracks:[tailEffect],segments,durationMs:openerEnd+1000}));
    const lateEffect = {...tailEffect,startMs:openerEnd+1,endMs:openerEnd+200};
    assert.throws(() => assertAudioTracks({audioTracks:[lateEffect],segments,durationMs:openerEnd+1000}), /音轨超出/);
  }
  const input = {authorUnits:[{id:"B001",templateId:"fullframe-narrative",beats:[{cueRange:[1,1]}]}],
    cues:[{id:1,startMs:0,endMs:6000,text:"来客停在院门前。"}]};
  const glass = fullframeRuntimeTimingForAuthorUnits({...input,openerTemplate:"glass-opener"});
  const old = fullframeRuntimeTimingForAuthorUnits({...input,openerTemplate:"opposed-opener"});
  assert.equal(glass.segments[0].appliedCameraPrerollFrames,old.segments[0].appliedCameraPrerollFrames+POST_EXIT_BREATH_FRAMES);
  assert.equal(glass.segments[0].appliedEntranceLeadFrames,old.segments[0].appliedEntranceLeadFrames+POST_EXIT_BREATH_FRAMES);
  const episodeProps={fps:60,segments:[{id:"opener",segmentType:"opener",startFrame:0,durationInFrames:320},
    {id:"B001",segmentType:"body",startFrame:325,durationInFrames:300}],audioTracks:[],
    preview:{fromFrame:0,toFrame:500,segmentIds:["opener"]}};
  assert.equal(buildSegmentPreviewProps({episodeProps,segmentType:"opener"}).preview.toFrame,500,
    "片头预览应保留正文首句，不能停在配音开始前");
});
