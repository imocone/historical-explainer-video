import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {compileSchema} from "../../../../engine/runtime/schema.mjs";
import {resolveCrossBeatRuntimeTiming, explainerHandoffContext, explainerPushPresentation} from "./transitions.mjs";
import {fullframeBoundaryFieldsFor} from "../../../templates/fullframe-narrative/camera/author-transition-handoff.mjs";
import {VOX_EXPLAINER_TIMING} from "../../../templates/vox-explainer/cue-policy.mjs";
import {resolveNarrativeTransition, narrativeVisibility, narrativeTransitionExposure, narrativeHandleFrames} from "./narrative-transition.mjs";
import {narrativePresentation} from "./narrative-presentation.mjs";
import {compositionTimeline} from "./timeline.mjs";
import {scenePreviewProps} from "./scene-preview.mjs";
import {fullframeTransitionCapacityFor} from "../../../templates/fullframe-narrative/timing-runtime.mjs";
import {fullframeMotionBudgetForCueOption} from "../../../templates/fullframe-narrative/cue-policy-runtime.mjs";
import {fullframeRuntimePlansForSegments} from "../../../templates/fullframe-narrative/camera/p3-preflight.mjs";
import {fullframeFramingFor} from "../../../templates/fullframe-narrative/camera/framing.mjs";
import {createRenderPolicy, renderData} from "../../../templates/fullframe-narrative/render-plan.mjs";
import {FULLFRAME_RENDER_POLICY} from "../../../templates/fullframe-narrative/render-policy.mjs";
import {measureCameraDesign} from "../../../templates/fullframe-narrative/camera/inspect-design.mjs";
import {videoWindow} from "../../../templates/cinematic-video/timing.mjs";
import {videoTransitionBoundaries, validateVideoTransitions} from "../../../templates/cinematic-video/boundary-transitions.mjs";

const design = type => ({type, durationMs: 800, reason: type === "dissolve"
  ? "前句货物到港，后句继续进入市场，保持同一观察" : "前句事件落定，留白后建立后句的新处境"});
const segment = (id, templateId, startFrame) => ({id, templateId, segmentType: "body", startFrame,
  startMs: startFrame / 60 * 1000, endMs: (startFrame + 600) / 60 * 1000, durationInFrames: 600, ...fullframeBoundaryFieldsFor(templateId)});

test("全画幅作者合同仅接纳叠化与闪黑，旧效果、方向和零时长不能继续执行", async () => {
  const schemas = await Promise.all(["fullframe-treatment", "cinematic-video-plan", "vox-explainer-treatment"].map(async name =>
    JSON.parse(await readFile(new URL(`../../../../contracts/${name}.schema.json`, import.meta.url)))));
  const shapes = [schemas[0].$defs.narrativeTransition, schemas[1].properties.incomingTransitions.additionalProperties];
  assert.equal(Object.hasOwn(schemas[2].properties, "incomingTransition"), false, "讲解不交通用转场字段");
  for (const [index, shape] of shapes.entries()) {
    const check = compileSchema(shape, `body-transition-${index}`);
    for (const type of ["dissolve", "dip-to-black"]) {
      assert.equal(check(design(type)), true);
      assert.equal(resolveNarrativeTransition(design(type)).durationInFrames, 48);
    }
    for (const invalid of [null, ...["cut", "wipe", "page-turn"].map(type => ({...design(type), durationMs: 0})),
      {...design("dissolve"), durationMs: 0}, {...design("dissolve"), direction: "from-left"},
      {...design("dip-to-black"), reason: " "}]) {
      assert.equal(check(invalid), false);
      if (invalid !== null) assert.throws(() => resolveNarrativeTransition(invalid));
    }
  }
  const validateKeys = compileSchema(schemas[1].properties.incomingTransitions, "video-transition-keys");
  assert.equal(validateKeys({TR001: design("dip-to-black")}), false);
  assert.equal(resolveNarrativeTransition(null).type, "none", "仅规划可保留尚未创作的边界");
});

test("四种全画幅媒体邻接均执行原作者选择，保留Cue间隙和固定活动余量", () => {
  for (const first of ["fullframe-narrative", "cinematic-video"])
    for (const second of ["fullframe-narrative", "cinematic-video"])
      for (const type of ["dissolve", "dip-to-black"]) {
        const input = [segment("a", first, 0), {...segment("b", second, 660), incomingTransition: design(type)}];
        const {segments, transitions} = resolveCrossBeatRuntimeTiming({segments: input});
        assert.equal(transitions[0].entryTransition.type, type);
        assert.equal(transitions[0].startFrame, 636);
        assert.equal(transitions[0].durationInFrames, 48);
        assert.equal(transitions[0].entranceLeadFrames, 54);
        assert.equal(transitions[0].exitTailFrames, 114);
        assert.equal(segments[1].startFrame, 660);
        assert.equal(segments[1].durationInFrames, 600);
        assert.equal(segments[1].appliedCameraPrerollFrames, 54);
        assert.equal(Object.hasOwn(transitions[0], "explainerPush"), false);
        const timeline = compositionTimeline({...resolveCrossBeatRuntimeTiming({segments: input}), fps: 60, durationMs: 21000});
        assert.ok(timeline.scenes[0].endFrame >= transitions[0].startFrame + 48, "视频与其它前景都保留到转场结束");
      }
});

test("闪黑有连续黑位且不共显；叠化保持共显权重，测量和呈现使用同一曲线", () => {
  for (const type of ["dissolve", "dip-to-black"]) {
    const edit = resolveNarrativeTransition(design(type));
    let blackFrames = 0;
    for (let frame = 0; frame < edit.durationInFrames; frame++) {
      const visibility = narrativeVisibility({...edit, frame});
      const state = narrativePresentation({design: edit, frame, durationInFrames: edit.durationInFrames, id: "test", visualStyle: {}});
      if (type === "dip-to-black") {
        assert.deepEqual([state.incoming.opacity, state.outgoing.opacity], [visibility.incoming, visibility.outgoing]);
        assert.ok(visibility.incoming === 0 || visibility.outgoing === 0);
        if (narrativeTransitionExposure({...edit, frame}).blackOnly) blackFrames++;
      } else {
        assert.equal(visibility.incoming + visibility.outgoing, 1);
        assert.deepEqual(narrativeTransitionExposure({...edit, frame}).blendWeights, visibility);
      }
    }
    assert.equal(blackFrames, type === "dip-to-black" ? 18 : 0, "800ms闪黑保留约300ms黑位");
  }
  const longer = resolveNarrativeTransition({...design("dip-to-black"), durationMs: 1200});
  const blackFrames = Array.from({length: longer.durationInFrames}, (_, frame) =>
    narrativeTransitionExposure({...longer, frame}).blackOnly).filter(Boolean).length;
  assert.equal(blackFrames, 28, "1200ms闪黑保留约467ms黑位，形成明确的停顿");
});

const fixtureFor = type => {
  const motion = {type: "traverse", speedRatio: 1, startViewport: {x: .005, y: .1, width: .8, height: .8},
    routeWaypoints: [], semanticEndViewport: {x: .195, y: .1, width: .8, height: .8},
    safeEndViewport: {x: .195, y: .1, width: .8, height: .8}};
  return {treatment: {templateId: "fullframe-narrative", incomingTransition: null,
    calloutGate: {"historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered"},
    assetRequests: ["A", "B"].map((frameId, index) => ({frameId, requestId: `AR00${index + 1}`,
      kind: "fullframe-image", cameraRelation: index ? "reset" : "first", callouts: [], motion: structuredClone(motion),
      ...(index ? {incomingTransition: design(type)} : {})}))},
    actionTimings: [{target: "AR001", action: "start-frame-motion", frame: 0}, {target: "AR002", action: "dissolve-in", frame: 360}]};
};

test("两种同Beat转场的P3测量、相机预算与P4真实运行轨迹一致", async () => {
  const visualStyle = JSON.parse(await readFile(new URL("../../../../visuals/meiji-state-machine/render/tokens.json", import.meta.url)));
  const policy = createRenderPolicy({visualStyle, fps: 60, width: 1920, height: 1080});
  for (const type of ["dissolve", "dip-to-black"]) {
    const fixture = fixtureFor(type);
    const assetRefs = fixture.treatment.assetRequests.map(request => ({requestId: request.requestId, kind: "fullframe-image",
      framing: fullframeFramingFor({request: {spec: {motion: request.motion}}})}));
    const final = renderData({...fixture, segmentId: "test", assetRefs, targetDurationMs: 12000, durationInFrames: 720, policy});
    const [p3] = fullframeRuntimePlansForSegments({segments: [{id: "test", ...fixture, durationInFrames: 720,
      cameraPrerollFrames: 0, exitTailFrames: 0}], fps: 60, motionPolicy: FULLFRAME_RENDER_POLICY.motion, maximumBoundaryFrames: 72});
    assert.deepEqual(final.frameTransitions, p3.transitions);
    for (const [index, item] of final.fullframe.entries())
      for (const key of ["startFrame", "endFrame", "runtimeEndFrame", "startCamera", "endCamera"])
        assert.deepEqual(item.motion[key], p3.frames[index].motion[key]);
    const cues = [{id: 1, startMs: 0, endMs: 6000}, {id: 2, startMs: 6000, endMs: 12000}];
    const featureResults = {"cue-sync": {items: fixture.actionTimings.map((item, index) =>
      ({target: item.target, action: item.action, cueId: index + 1, edge: "start"}))}};
    const frames = fullframeMotionBudgetForCueOption({durationInFrames: 720, switchFrame: 360, fps: 60});
    const measured = measureCameraDesign({treatment: fixture.treatment, cues, featureResults, templateContext: {
      incomingTransitionSupported: false, cueOptions: {frameA: [{cueId: 1, edge: "start"}], frameB: [{cueId: 2, edge: "start"}]},
      motionBudgets: {options: [{binding: {cueId: 2, edge: "start"}, frames}]}}});
    assert.equal(measured.ok, true);
    assert.equal(measured.motionBudgets[1].startFrame, final.fullframe[1].motion.startFrame);
    assert.ok(measured.targets[1].transitionReading.samples.length >= 5);
  }
  assert.equal(fullframeTransitionCapacityFor({durationInFrames: 282, switchFrame: 192, fps: 60}), null,
    "不能再以只有硬切可行的切点冒充双图转场容量");
});

test("视频接管不覆盖讲解专用进出，也不执行被覆盖成员内部接缝", () => {
  const storyboard = {beats: [{id: "B001", templateId: "fullframe-narrative", cueRange: [1, 1], treatment: {templateId: "fullframe-narrative"}},
    {id: "B002", templateId: "vox-explainer", cueRange: [2, 2], treatment: null}],
    templateRuns: [{id: "TR001", templateId: "vox-explainer", beatIds: ["B002"], treatment: {templateId: "vox-explainer"}}]};
  const videoPlan = {templateId: "cinematic-video", spans: [{id: "V001", beatIds: ["B001"]}], incomingTransitions: {TR001: design("dip-to-black")}};
  assert.deepEqual(videoTransitionBoundaries({storyboard, videoPlan}), []);
  assert.match(validateVideoTransitions({storyboard, videoPlan})[0], /TR001.*不属于/);
  videoPlan.incomingTransitions = {};
  assert.deepEqual(validateVideoTransitions({storyboard, videoPlan}), []);
});

test("视频接出到讲解保留原专用边界的素材窗口", () => {
  const cues = [{id: 1, startMs: 0, endMs: 6000, text: "前段活动"}, {id: 2, startMs: 7000, endMs: 13000, text: "后段讲解"}];
  const storyboard = {beats: [{id: "B001", templateId: "fullframe-narrative", cueRange: [1, 1], treatment: {templateId: "fullframe-narrative"}},
    {id: "B002", templateId: "vox-explainer", cueRange: [2, 2]}]};
  const span = {id: "V001", beatIds: ["B001"], firstFramePrompt: "虚构场面",
    shots: [{id: "S01", durationMs: 6000}], parts: [{shotIds: ["S01"], videoPrompt: "原活动持续"}]};
  const window = videoWindow({span, storyboard, cues});
  assert.equal(window.tailHandleFrames, 54);
  assert.equal(window.headHandleFrames, 54);
  assert.equal(window.deliveryDurationMs, 7800);
});


test("相邻讲解互接：保持原入场节奏，Cue与旁白时窗不动", () => {
  for (const [first, second] of [["vox-explainer", "vox-explainer"]]) {
    const input = [segment("a", first, 0), segment("b", second, 600)];
    const { segments, transitions } = resolveCrossBeatRuntimeTiming({ segments: input });
    const lead = 1;
    assert.equal(transitions[0].startFrame, 600 - lead);
    assert.equal(transitions[0].durationInFrames, 30);
    assert.equal(segments[1].startFrame, 600);
    assert.equal(segments[1].durationInFrames, 600);
    assert.equal(segments[1].appliedTransitionFrames, 0, "不叠加默认淡入");
    const { entryHandoff } = explainerHandoffContext({ segment: segments[1], transitions });
    assert.equal(entryHandoff.contentStartFrame - (-lead + 30), 0);
    const withGap = resolveCrossBeatRuntimeTiming({ segments: [input[0], { ...input[1], startFrame: 620 }] });
    assert.equal(withGap.segments[0].appliedExitTailFrames, 29, "段间停顿与Cue后的剩余推移须同时覆盖");
    assert.equal(withGap.segments[1].startFrame, 620);
  }
  for (const frame of [0, 6, 15, 24, 30]) {
    const { outgoing, incoming } = explainerPushPresentation({ frame, durationInFrames: 30 });
    assert.equal(outgoing.opacity, 1);
    assert.equal(incoming.opacity, 1);
    assert.equal(parseFloat(incoming.translate) - parseFloat(outgoing.translate), 100, "两幅画面始终相接");
  }
  assert.equal(parseFloat(explainerPushPresentation({ frame: 6, durationInFrames: 30 }).incoming.translate), 98.72,
    "使用官方 power3.inOut 四次曲线");
});

test("完整讲解保留至最后语义帧，再开始推移", () => {
  const {transitions,segments}=resolveCrossBeatRuntimeTiming({segments:[segment("a","vox-explainer",0),segment("b","vox-explainer",600)]});
  assert.equal(transitions[0].startFrame,599);
  assert.equal(transitions[0].durationInFrames,30);
  assert.equal(segments[0].appliedExitTailFrames,29);
});

test("讲解专用进出在有无Cue间隙时都保留前画面到推移结束", () => {
  for (const [first, next] of [["fullframe-narrative", "vox-explainer"], ["cinematic-video", "vox-explainer"],
    ["vox-explainer", "fullframe-narrative"], ["vox-explainer", "cinematic-video"], ["vox-explainer", "vox-explainer"]]) {
    for (const gap of [0, 20, 60]) {
      const timed = resolveCrossBeatRuntimeTiming({segments: [segment("a", first, 0), segment("b", next, 600 + gap)]});
      const boundary = timed.transitions[0];
      const timeline = compositionTimeline({...timed, fps: 60, durationMs: 22000});
      assert.equal(boundary.explainerPush, true);
      assert.ok(timeline.scenes[0].endFrame >= boundary.startFrame + boundary.durationInFrames,
        `${first}->${next} / gap=${gap}: 前画面不能在推出期间消失`);
    }
  }
});

test("全画幅与统一讲解统一进出场，预运镜和原Cue保留", () => {
  for (const template of ["vox-explainer"]) {
    const { transitions, segments } = resolveCrossBeatRuntimeTiming({ segments: [segment("a", "fullframe-narrative", 0),
      segment("b", template, 600), segment("c", "fullframe-narrative", 1200)] });
    const timing = VOX_EXPLAINER_TIMING;
    assert.equal(transitions[0].entranceLeadFrames, timing.entry.leadFrames);
    assert.equal(transitions[1].durationInFrames, 30);
    assert.equal(transitions[1].entranceLeadFrames, template === "vox-explainer" ? 1 : 30);
    assert.equal(segments[2].appliedCameraPrerollFrames, template === "vox-explainer" ? 1 : 30);
    assert.equal(segments[2].startFrame, 1200);
  }
});


test("单段预演复用正式三场景衔接，视频源持续到推移结束", () => {
  const input = segment("focus-preview", "vox-explainer", 0);
  input.visualStyle = {};
  input.renderData = { voxExplainer: { context: { previous: {
    durationInFrames:300, assetRef:{file:"image.png",mediaType:"image"}
  } } } };
  const preview = scenePreviewProps({segment:input, lead:188, tail:44,
    captions:[{startMs:0,endMs:1000,text:"原旁白"}]});
  assert.equal(preview.segments.length, 3);
  assert.equal(preview.transitions.length, 2);
  assert.equal(preview.transitions[0].durationInFrames, 30);
  assert.equal(preview.captions[0].startMs, 188/60*1000);
  input.renderData.voxExplainer.context.previous.assetRef={file:"source.mp4",mediaType:"video",trimBefore:12};
  const videoPreview=scenePreviewProps({segment:input,lead:188});
  assert.equal(videoPreview.segments[0].assetRefs[0].trimBefore,124);
  assert.equal(videoPreview.segments[2].assetRefs[0].freezeFrame,299);
  const parts = [segment("video", "cinematic-video",0),segment("map", "vox-explainer",600)]
    .map(s=>({...s,startMs:s.startFrame/60*1000,endMs:(s.startFrame+s.durationInFrames)/60*1000}));
  const resolved=resolveCrossBeatRuntimeTiming({segments:parts});
  const timeline=compositionTimeline({...resolved,fps:60,durationMs:20000,audioTracks:[]});
  assert.equal(timeline.scenes[0].endFrame,resolved.transitions[0].startFrame+30,
    "退出视频不能在推移开始时提前消失");
});
