import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import { inspectFullframeAuthorability } from "../authorability.mjs";
import { FULLFRAME_RENDER_POLICY } from "../render-policy.mjs";
import { fullframeMotionBudgetForCueOption } from "../cue-policy-runtime.mjs";
import { projectAssetPlanTreatment } from "../production-projection.mjs";
import { createRenderPolicy, renderData } from "../render-plan.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { withVisualFontPaths } from "../../../visual-fonts.mjs";
import { fullframeFramingFor } from "./framing.mjs";
import { cameraAtFrame } from "./runtime-layer.mjs";
import { viewportForCamera } from "./geometry.mjs";
import { deriveMotionCameras, motionRouteViewportsAtFrames, motionSpeedRatioAtFrame } from "./p4-runtime.mjs";
import { measureCameraDesign } from "./inspect-design.mjs";
import { projectAuthorContext } from "../context-runtime.mjs";
import { inspectDirectorAuthorability } from "../../../modules/direct-episode/authorability.mjs";
import { projectDirectorInspection } from "../../../modules/direct-episode/inspect-authorability.mjs";
import { authorUnitsForStoryboard } from "../../../../engine/runtime/storyboard.mjs";
import * as fullframeCuePolicy from "../cue-policy.mjs";
import * as explainerCuePolicy from "../../vox-explainer/cue-policy.mjs";
import { fullframeRuntimeTimingForAuthorUnits } from "./author-transition-handoff.mjs";
import { fullframeRuntimePlansForSegments } from "./p3-preflight.mjs";
import { fullframeCameraRelationErrors } from "./transition.mjs";
import { candidateCameraViews } from "./realization.mjs";
import { incomingCameraPrerollFrames, openerEntranceLeadFramesFor } from "../../../modules/render-video/runtime/transitions.mjs";
import { OPENER_RENDER_POLICY } from "../../episode-opener/render-policy.mjs";
import { DOCUMENTARY_OPENER_RENDER_POLICY } from "../../documentary-opener/render-policy.mjs";
import { CROSS_FIRE } from "../../crossfire-opener/render-policy.mjs";

const policy = FULLFRAME_RENDER_POLICY.motion;

test("未选速规划只有真实时窗与行程范围，不把最低速或其它档位当成作者答案",()=>{
  const args={durationInFrames:480,fps:60,runtimeTiming:{cameraPrerollFrames:54,exitTailFrames:54}};
  const [frame]=fullframeMotionBudgetForCueOption(args);
  for(const key of ["speedRatio","runtimeCameraTravel","visibleCameraTravel","maximumRuntimeCameraTravel"])
    assert.equal(Object.hasOwn(frame,key),false,key);
  close(frame.runtimeDurationMs,(479+108)/60*1000);
  for(const [family,base] of [["zoom",policy.zoomScaleSpeedPerSecond],["traverse",policy.traverseNormalizedSpeedPerSecond]]){
    close(frame.runtimeTravelRange[family].minimum,base*frame.runtimeDurationMs/1000*policy.minimumSpeedRatio);
    close(frame.runtimeTravelRange[family].maximum,base*frame.runtimeDurationMs/1000*policy.maximumSpeedRatio);
  }
  assert.throws(()=>fullframeMotionBudgetForCueOption({...args,speedRatios:[undefined]}),/必须在/);
  assert.throws(()=>fullframeMotionBudgetForCueOption({...args,motions:[{}]}),/必须在/);
  assert.throws(()=>fullframeMotionBudgetForCueOption({...args,speedRatios:[1.2],motions:[{speedRatio:1.3}]}),/一致/);
  assert.throws(()=>fullframeMotionBudgetForCueOption({...args,speedRatios:[]}),/逐图/);
});

test("无预填规划进入测量与P4后，作者任意恒速和短时高速均原样执行",async()=>{
  const cues=[{id:1,startMs:0,endMs:8000,text:"让重点逐渐取得分量。"}];
  const plans=fullframeMotionBudgetForCueOption({durationInFrames:480,fps:60,
    runtimeTiming:{cameraPrerollFrames:54,exitTailFrames:54}});
  const templateContext={cueOptions:{frameA:[{cueId:1,edge:"start"}]},motionBudgets:{options:[{binding:null,frames:plans}]}};
  const style=withVisualFontPaths(JSON.parse(await readFile(new URL("../../../../visuals/wet-watercolor/render/tokens.json",import.meta.url))),"wet-watercolor");
  for(const selection of [{speedRatio:1.27},{speedRatio:1,speedChanges:[{timeMs:500,speedRatio:3},{timeMs:1000,speedRatio:1}]}]){
    const motion={type:"push-in",...selection,startViewport:{x:0,y:0,width:1,height:1},routeWaypoints:[],
      semanticEndViewport:{x:.15,y:.1,width:2/3,height:2/3},safeEndViewport:{x:.15,y:.1,width:2/3,height:2/3}};
    const treatment={templateId:"fullframe-narrative",assetRequests:[{requestId:"AR001",frameId:"A",motion}],
      calloutGate:{"historical-quote":"not-triggered","person-intro":"not-triggered","term-gloss":"not-triggered"}};
    const featureResults={"cue-sync":{items:[{target:"AR001",action:"start-frame-motion",cueId:1,edge:"start"}]}};
    const before=structuredClone({treatment,featureResults,templateContext,cues});
    const result=measureCameraDesign({treatment,featureResults,templateContext,cues});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.targets[0].speedRatio,selection.speedRatio);
    assert.deepEqual(result.targets[0].speedChanges,selection.speedChanges);
    const data=renderData({segmentId:"B001",treatment,actionTimings:[{target:"AR001",action:"start-frame-motion",frame:0}],
      assetRefs:[{requestId:"AR001",kind:"fullframe-image",framing:fullframeFramingFor({request:{spec:treatment.assetRequests[0]}})}],
      targetDurationMs:8000,durationInFrames:480,policy:createRenderPolicy({visualStyle:style,...VIDEO_SPEC}),
      runtimeTiming:{cameraPrerollFrames:54,exitTailFrames:54}});
    const actual=data.fullframe[0].motion;
    assert.equal(actual.runtimeEndFrame,587);
    assert.equal(actual.speedRatio,selection.speedRatio);assert.deepEqual(actual.speedChanges,selection.speedChanges);
    close(actual.travelDistance,result.motionBudgets[0].runtimeCameraTravel.zoom);
    const frames=[0,67,279,480,587];
    const measured=motionRouteViewportsAtFrames({motion,motionStartFrame:0,frames,fps:60,motionPolicy:policy});
    frames.forEach((frame,index)=>{
      const rendered=viewportForCamera(cameraAtFrame({motion:actual,frame}));
      for(const key of ["x","y","width","height"])close(rendered[key],measured[index][key]);
    });
    assert.deepEqual({treatment,featureResults,templateContext,cues},before);
    delete motion.speedRatio;
    assert.throws(()=>measureCameraDesign({treatment,featureResults,templateContext,cues}),/必须在/);
  }
});

test("Director与作者在片头、模板邻接、Cue间隔及A/B参考上共享无预选速度的真实规划",async()=>{
  const cues=Array.from({length:8},(_,i)=>({id:i+1,startMs:Math.floor(i/2)*9500+i%2*4000,
    endMs:Math.floor(i/2)*9500+(i%2+1)*4000,text:"当前观看任务。"}));
  const beats=Array.from({length:4},(_,i)=>({id:`B00${i+1}`,cueRange:[i*2+1,i*2+2],templateId:i===1?"vox-explainer":"fullframe-narrative"}));
  const result={beats,templateRuns:[{id:"TR001",templateId:"fullframe-narrative",beatIds:["B001"]},
    {id:"TR002",templateId:"vox-explainer",beatIds:["B002"]},{id:"TR003",templateId:"fullframe-narrative",beatIds:["B003","B004"]}]};
  for(const openerTemplate of ["episode-opener","documentary-opener","crossfire-opener","opposed-opener","glass-opener"]){
    const inspection=await inspectDirectorAuthorability({result,cues,openerTemplate,includePlanning:true,
      loadCuePolicy:async id=>id==="fullframe-narrative"?fullframeCuePolicy:explainerCuePolicy});
    assert.deepEqual(inspection.errors, []);
    const published=projectDirectorInspection(inspection);
    for(const id of ["B001","B003","B004"]){
      const director=published.units.find(unit=>unit.id===id).planning;
      const author=projectAuthorContext({programPlan:{openerTemplate},authorUnits:authorUnitsForStoryboard(result),episodeCues:cues,
        albumPlan:{},acceptedBeats:beats,beforeBeatId:id});
      assert.ok(director.options.some(option=>option.binding));
      for(const option of director.options){
        const original=author.motionBudgets.options.find(item=>JSON.stringify(item.binding)===JSON.stringify(option.binding));
        if(option.binding)assert.deepEqual(option.transitionCapacity,original.transitionCapacity);
        for(const [i,d] of option.frames.entries()){
          const a=original.frames[i];
          for(const key of ["runtimeDurationMs","cameraPrerollFrames","exitTailFrames"])close(d[key],a[key]);
          assert.deepEqual(d.runtimeTravelRange,a.runtimeTravelRange);
          assert.equal(Object.hasOwn(a,"speedRatio"),false);assert.equal(Object.hasOwn(d,"speedRatio"),false);
        }
      }
      assert.equal(director.maximumRenderScale,1.5);
      assert.deepEqual(director.motionTypes,["push-in","pull-out","traverse"]);
    }
  }
});
const motionFor = () => ({ type: "push-in", speedRatio: 1,
  speedChanges: [{ timeMs: 2000, speedRatio: 3 }, { timeMs: 4000, speedRatio: 1 }],
  startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
  semanticEndViewport: { x: .15, y: .1, width: 2 / 3, height: 2 / 3 },
  safeEndViewport: { x: .15, y: .1, width: 2 / 3, height: 2 / 3 } });
const timed = (motion, startFrame = 0, endFrame = 479, runtimeEndFrame = 539) => {
  const value = { ...motion, startFrame, endFrame, runtimeEndFrame };
  return { ...value, ...deriveMotionCameras({ motion: value, fps: 60, motionPolicy: policy }) };
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("长Beat同时提供单A与可读A/B，图数交给创作", () => {
  const cues = [{ id: 1, startMs: 0, endMs: 6000, text: "来客停在院门前。" },
    { id: 2, startMs: 6040, endMs: 14000, text: "他继续等候，院门仍没有打开。" }];
  const result = inspectFullframeAuthorability({ cueRange: [1, 2], cues, includePlanning: true });
  assert.ok(result.planning.options.some(option => option.binding === null));
  assert.ok(result.planning.options.some(option => option.binding?.cueId === 2));
  assert.equal(result.allowsAB, true);
});

test("合同与执行使用同一上下限，区间内自由选速并连续变速", async () => {
  const schema = JSON.parse(await readFile(new URL("../../../../contracts/fullframe-treatment.schema.json", import.meta.url)));
  const validate = new Ajv().compile({ $defs: schema.$defs, $ref: "#/$defs/motion" });
  assert.equal(validate(motionFor()), true, JSON.stringify(validate.errors));
  for (const speedRatio of [policy.minimumSpeedRatio, 1.37, 2.42, policy.maximumSpeedRatio]) {
    assert.equal(validate({ ...motionFor(), speedRatio, speedChanges: undefined }), true);
    assert.doesNotThrow(() => timed({ ...motionFor(), speedRatio, speedChanges: undefined }, 0, 59, 119));
  }
  for (const speedRatio of [.9, 3.01, 20]) {
    assert.equal(validate({ ...motionFor(), speedRatio }), false);
    assert.equal(validate({ ...motionFor(), speedChanges: [{ timeMs: 1000, speedRatio }] }), false);
    assert.throws(() => timed({ ...motionFor(), speedRatio }), /必须在 1—3/);
    assert.throws(() => timed({ ...motionFor(), speedChanges: [{ timeMs: 1000, speedRatio }] }), /必须在 1—3/);
  }
  assert.throws(() => timed({ ...motionFor(), speedChanges: [{ timeMs: 2000, speedRatio: 2 }, { timeMs: 1000, speedRatio: 3 }] }), /严格递增/);
  assert.equal(validate({ ...motionFor(), holdAfterMs: 6000 }), false);
  assert.throws(() => timed({ ...motionFor(), holdAfterMs: 6000 }), /必须持续运动/);
  assert.throws(() => timed({ ...motionFor(), speedRatio: 3, speedChanges: undefined }), /路线会/);
  // This route covered the old six-second hold, but cannot cover the full moving window.
  const shortEnd = { x: .15, y: .1, width: .75, height: .75 };
  assert.throws(() => timed({ ...motionFor(), semanticEndViewport: shortEnd, safeEndViewport: shortEnd }), /路线会/);
  assert.doesNotThrow(() => timed(motionFor()), "调整路线后覆盖完整时窗");
  const maximum = { ...motionFor(), speedRatio: policy.maximumSpeedRatio, speedChanges: undefined };
  for (const frame of [0, 101, 539]) {
    const sampled = motionSpeedRatioAtFrame({ motion: maximum, motionStartFrame: 0, frame });
    assert.ok(sampled <= policy.maximumSpeedRatio);
    close(sampled, policy.maximumSpeedRatio);
  }
});

test("变速积分、全程持续运动及乱序取帧沿同一相机时钟", () => {
  const motion = timed(motionFor());
  for (const [frame, weightedSeconds] of [[420, 11], [0, 0], [120, 4], [360, 10], [240, 8], [539, 4 + 539 / 60]]) {
    close(cameraAtFrame({ motion, frame }).scale, 1 + policy.zoomScaleSpeedPerSecond * weightedSeconds);
  }
  for (let frame = motion.startFrame + 1; frame <= motion.runtimeEndFrame; frame += 1) {
    assert.ok(cameraAtFrame({ motion, frame }).scale > cameraAtFrame({ motion, frame: frame - 1 }).scale);
  }
  const original = timed({ ...motionFor(), speedChanges: undefined });
  close(cameraAtFrame({ motion: original, frame: 120 }).scale, 1 + policy.zoomScaleSpeedPerSecond * 2);
  assert.ok(cameraAtFrame({ motion: original, frame: 420 }).scale > cameraAtFrame({ motion: original, frame: 360 }).scale);
});

test("叠化显露、P3预算和渲染取景共同消费速度变化", () => {
  const first = { ...motionFor(), speedChanges: undefined };
  const second = motionFor();
  const budgets = fullframeMotionBudgetForCueOption({ durationInFrames: 720, switchFrame: 360,
    transitionDesign: { type: "dissolve", durationMs: 600, reason: "在原Cue进入下一阶段" },
    runtimeTiming: { cameraPrerollFrames: 34, exitTailFrames: 45 },
    speedRatios: [first.speedRatio, second.speedRatio], motions: [first, second], fps: 60 });
  for (const [index, raw] of [first, second].entries()) {
    const budget = budgets[index];
    const motion = timed(raw, budget.startFrame, budget.visibleEndFrame, budget.runtimeEndFrame);
    close(motion.travelDistance, budget.runtimeCameraTravel.zoom);
    close(motion.visibleTravelDistance, budget.visibleCameraTravel.zoom);
    const frames = [Math.max(budget.startFrame, 360), budget.runtimeEndFrame];
    const measured = motionRouteViewportsAtFrames({ motion: raw, motionStartFrame: budget.startFrame,
      frames, fps: 60, motionPolicy: policy });
    frames.forEach((frame, at) => {
      const rendered = viewportForCamera(cameraAtFrame({ motion, frame }));
      for (const key of ["x", "y", "width", "height"]) close(rendered[key], measured[at][key]);
    });
  }
  assert.ok(budgets[1].startFrame < 360);
  assert.ok(budgets[1].runtimeCameraTravel.zoom > budgets[1].visibleCameraTravel.zoom);
});

test("只改变速度不改变静态图片生产输入", () => {
  const treatment = { templateId: "fullframe-narrative", assetRequests: [{ requestId: "AR001", motion: motionFor() }] };
  const other = structuredClone(treatment);
  Object.assign(other.assetRequests[0].motion, { speedRatio: 2, speedChanges: [{ timeMs: 1000, speedRatio: 3 }] });
  assert.deepEqual(projectAssetPlanTreatment(treatment), projectAssetPlanTreatment(other));
  other.assetRequests[0].motion.startViewport.x = .01;
  assert.notDeepEqual(projectAssetPlanTreatment(treatment), projectAssetPlanTreatment(other));
});

test("正式渲染投影保留作者变速，持续运动至末帧", async () => {
  const visualStyle = withVisualFontPaths(JSON.parse(await readFile(new URL("../../../../visuals/wet-watercolor/render/tokens.json", import.meta.url))), "wet-watercolor");
  const request = { requestId: "AR001", frameId: "A", motion: motionFor() };
  const treatment = { templateId: "fullframe-narrative", assetRequests: [request],
    calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" } };
  const input = { segmentId: "B001", treatment,
    actionTimings: [{ target: "AR001", action: "start-frame-motion", frame: 0 }],
    assetRefs: [{ requestId: "AR001", kind: "fullframe-image", framing: fullframeFramingFor({ request: { spec: request } }) }],
    targetDurationMs: 8000, durationInFrames: 480, policy: createRenderPolicy({ visualStyle, ...VIDEO_SPEC }) };
  const data = renderData(input);
  const motion = data.fullframe[0].motion;
  close(cameraAtFrame({ motion, frame: 120 }).scale, 1 + policy.zoomScaleSpeedPerSecond * 4);
  assert.ok(cameraAtFrame({ motion, frame: 479 }).scale > cameraAtFrame({ motion, frame: 360 }).scale);
  const stopped = structuredClone(input);
  stopped.treatment.assetRequests[0].motion.holdAfterMs = 6000;
  assert.throws(() => renderData(stopped), /必须持续运动/);
});


test("正文全画幅不接受静止模式，原有重点运镜仍可执行", () => {
  assert.throws(() => timed({ ...motionFor(), type: "hold", speedRatio: 0 }), /不支持|必须|正文运镜/);
  const motion = timed(motionFor());
  assert.notDeepEqual(cameraAtFrame({ motion, frame: 0 }), cameraAtFrame({ motion, frame: 240 }));
});

test("首镜预算消费所选片头，与节目形式无关", () => {
  const input = { authorUnits: [{ id: "B001", templateId: "fullframe-narrative", beats: [{ cueRange: [1, 1] }] }],
    cues: [{ id: 1, startMs: 0, endMs: 6000, text: "来客停在院门前。" }] };
  for (const [openerTemplate, { exitTransition }] of Object.entries({
    "episode-opener": OPENER_RENDER_POLICY,
    "documentary-opener": DOCUMENTARY_OPENER_RENDER_POLICY,
    "crossfire-opener": CROSS_FIRE
  })) {
    const entranceLeadFrames = openerEntranceLeadFramesFor({ exitTransition, visualGapFrames: 0 });
    const expected = incomingCameraPrerollFrames({ entranceLeadFrames, holdIncomingVisualAtStart: false, entryTransition: exitTransition });
    for (const programForm of ["historical-explainer", "historical-documentary"]) {
      const { segments } = fullframeRuntimeTimingForAuthorUnits({ ...input, programForm, openerTemplate });
      assert.equal(segments[0].appliedCameraPrerollFrames, expected, `${programForm}/${openerTemplate}`);
    }
  }
  assert.throws(() => fullframeRuntimeTimingForAuthorUnits({ ...input, programForm: "historical-explainer" }), /片头选择/);
});

test("导演可读时间按讲解实际推入和推出计算，字幕间隙可容纳推移", () => {
  const authorUnits = ["fullframe-narrative", "vox-explainer", "fullframe-narrative"].map((templateId, index) => ({
    id: `B00${index + 1}`, templateId, beats: [{ cueRange: [index + 1, index + 1] }]
  }));
  const viewing = gap => {
    const cues = [[0, 3000], [3000 + gap, 9000 + gap], [9000 + 2 * gap, 12000 + 2 * gap]]
      .map(([startMs, endMs], index) => ({ id: index + 1, startMs, endMs, text: `观察第${index + 1}处变化` }));
    return [0, 2].map(index => inspectFullframeAuthorability({
      label: authorUnits[index].id, authorUnits, cues, cueRange: authorUnits[index].beats[0].cueRange,
      openerTemplate: "episode-opener", includePlanning: true, singlePicture: true
    }).planning.clearViewingMs);
  };
  const [beforePush, afterPush] = viewing(0);
  close(beforePush, 2500);
  close(afterPush, 3000 - 29 * 1000 / VIDEO_SPEC.fps);
  for (const value of viewing(500)) close(value, 3000);
});

test("偏心幅度不改变同方向推近的接镜判定，反向仍被拒绝", () => {
  const sample = offset => motionRouteViewportsAtFrames({ motion: {
    type: "push-in", speedRatio: 1, startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
    semanticEndViewport: { x: .125 + offset, y: .125, width: .75, height: .75 },
    safeEndViewport: { x: .125 + offset, y: .125, width: .75, height: .75 }
  }, motionStartFrame: 0, frames: [100, 101], fps: 60, motionPolicy: policy });
  const errors = (previousRouteViewports, currentRouteViewports) => fullframeCameraRelationErrors({
    relation: "continue", previousType: "push-in", currentType: "push-in",
    previousSpeedRatio: 1, currentSpeedRatio: 1, previousRouteViewports, currentRouteViewports });
  for (const offset of [0, .0001, .001, .1]) assert.deepEqual(errors(sample(offset), sample(offset)), []);
  const previous = sample(.001);
  const reversed = structuredClone(previous);
  reversed[1].x -= 2 * ((previous[1].x + previous[1].width / 2) - (previous[0].x + previous[0].width / 2));
  assert.ok(errors(previous, reversed).some(error => error.includes("中心方向没有延续")));
});

test("预算、候选、交接和P4共用单A及两种A/B转场的实际时窗", async () => {
  const visualStyle = withVisualFontPaths(JSON.parse(await readFile(new URL("../../../../visuals/wet-watercolor/render/tokens.json", import.meta.url))), "wet-watercolor");
  const renderPolicy = createRenderPolicy({ visualStyle, ...VIDEO_SPEC });
  const transitions = [null,
    { type: "dissolve", durationMs: 600 },
    { type: "dip-to-black", durationMs: 600 }
  ];
  for (const transition of transitions) {
    const count = transition ? 2 : 1;
    const motion = { ...motionFor(), speedChanges: undefined };
    const requests = Array.from({ length: count }, (_, index) => ({ requestId: `AR00${index + 1}`, frameId: index ? "B" : "A", motion,
      ...(index ? { incomingTransition: { ...transition, reason: "口播进入下一状态" } } : {}) }));
    const treatment = { templateId: "fullframe-narrative", assetRequests: requests,
      calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" } };
    const actionTimings = requests.map((request, index) => ({ target: request.requestId, action: index ? "dissolve-in" : "start-frame-motion", frame: index * 240 }));
    const durationInFrames = 480;
    // The 180-frame tail includes a Cue gap longer than the normal handle.
    const runtimeTiming = { cameraPrerollFrames: 69, exitTailFrames: 180 };
    const budgets = fullframeMotionBudgetForCueOption({ durationInFrames, switchFrame: count === 2 ? 240 : null,
      transitionDesign: requests[1]?.incomingTransition, runtimeTiming,
      speedRatios: requests.map(() => 1), motions: requests.map(() => motion), fps: 60 });
    const [handoff] = fullframeRuntimePlansForSegments({ segments: [{ id: "B001", treatment, actionTimings, durationInFrames, ...runtimeTiming }],
      fps: 60, motionPolicy: policy, maximumBoundaryFrames: 120 });
    const rendered = renderData({ segmentId: "B001", treatment, actionTimings, runtimeTiming,
      assetRefs: requests.map(request => ({ requestId: request.requestId, kind: "fullframe-image", framing: fullframeFramingFor({ request: { spec: request } }) })),
      targetDurationMs: 8000, durationInFrames, policy: renderPolicy });
    const bindings = requests.map((request, index) => ({ target: request.requestId, action: actionTimings[index].action, cueId: index + 1, edge: "start" }));
    const views = await candidateCameraViews({ workOrder: { inputs: {
      authorUnit: { id: "B001" }, cues: [{ id: 1, startMs: 0, endMs: 4000 }, { id: 2, startMs: 4000, endMs: 8000 }],
      templateContext: { cueOptions: { frameA: [bindings[0]], frameB: bindings.slice(1) },
        motionBudgets: { options: [{ binding: count === 2 ? bindings[1] : null, frames: budgets }] } }
    } }, candidate: { result: { treatment, featureResults: { "cue-sync": { items: bindings } } } } });
    for (const [index, budget] of budgets.entries()) {
      const expected = viewportForCamera(cameraAtFrame({ motion: rendered.fullframe[index].motion, frame: budget.visibleEndFrame }));
      for (const result of [handoff.frames[index].motion, rendered.fullframe[index].motion, views[index].props.motion]) {
        assert.equal(result.startFrame, budget.startFrame);
        assert.equal(result.endFrame, budget.visibleEndFrame);
        assert.equal(result.runtimeEndFrame, budget.runtimeEndFrame);
        assert.equal(result.cameraFrameOffset, index === 0 ? runtimeTiming.cameraPrerollFrames : 0);
        for (const key of ["x", "y", "width", "height"]) close(result.visibleEndViewport[key], expected[key]);
        close(result.visibleTravelDistance, budget.visibleCameraTravel.zoom);
        close(result.travelDistance, budget.runtimeCameraTravel.zoom);
      }
    }
  }
});
