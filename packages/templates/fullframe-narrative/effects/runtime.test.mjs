import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { VIDEO_SPEC, frameSpanForMs } from "../../../video-spec.mjs";
import { resolveCueBindingsToFrames } from "../../../cue-boundaries.mjs";
import { withVisualFontPaths } from "../../../visual-fonts.mjs";
import { createRenderPolicy, renderData } from "../render-plan.mjs";
import { fullframeFramingFor } from "../camera/framing.mjs";
import { cameraStateAtRuntimeFrame } from "../camera/runtime-layer.mjs";
import { candidateCameraViews } from "../camera/realization.mjs";
import { assertActionTimingStructureForTreatment, fullframeCueTargetsForTreatment } from "../timing-runtime.mjs";
import { fullframeMotionBudgetForCueOption, validateCueBindingsForTreatment } from "../cue-policy-runtime.mjs";
import { projectAssetPlanTreatment } from "../production-projection.mjs";
import { assertEffectAnchors, effectOpacityAtFrame, effectSampleFrame, projectedEffectAnchor, prepareEffectsForFrame } from "./runtime.mjs";

import { resolveCrossBeatRuntimeTiming } from "../../../modules/render-video/runtime/transitions.mjs";
import { narrativeVisibility } from "../../../modules/render-video/runtime/narrative-transition.mjs";

const tokens = JSON.parse(await readFile(new URL("../../../../visuals/modern-editorial/render/tokens.json", import.meta.url)));
const policy = createRenderPolicy({ visualStyle: withVisualFontPaths(tokens, "modern-editorial"), ...VIDEO_SPEC });
const emotion = { type: "emotion", intensity: "medium", timing: "cue", durationMs: 1200,
  symbol: "question", anchorFocus: "军官头顶", reason: "旁白表达疑惑" };
const request = (id, frameId = "A") => ({ requestId: id, frameId, kind: "fullframe-image", cameraRelation: frameId === "A" ? "first" : "reset",
  purpose: "从营地看向持电报的军官", sourceRefs: ["C001"], mustNotInvent: ["不增加事件"], required: true,
  acceptanceCriteria: ["人物与电报清楚"], sceneDescription: "冬营中的军官阅读电报，远处有帐篷。",
  attentionPlan: { entryFocus: "营地", landingFocus: "军官", safeEndFocus: "军官", viewerChange: "看清他与电报的关系" },
  motion: { type: "push-in", speedRatio: 1.25, startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
    semanticEndViewport: { x: 0.2, y: 0.1, width: 2 / 3, height: 2 / 3 },
    safeEndViewport: { x: 0.2, y: 0.1, width: 2 / 3, height: 2 / 3 } },
  ...(frameId === "B" ? { incomingTransition: { type: "dissolve", durationMs: 600, reason: "换场" } } : {}) });
const treatmentFor = (requests) => ({ templateId: "fullframe-narrative", incomingTransition: null,
  calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" }, assetRequests: requests });
const assetFor = (req) => ({ requestId: req.requestId, assetId: `b001-${req.requestId.toLowerCase()}`, segmentId: "B001",
  segmentType: "body", templateId: "fullframe-narrative", kind: "fullframe-image", file: "winter.png", sha256: "a".repeat(64), status: "produced",
  framing: fullframeFramingFor({ request: { spec: req } }) });
const start = { target: "AR001", action: "start-frame-motion", frame: 0 };

test("效果Cue混排仍保留A/B顺序，短反应不得越过所属图", () => {
  const a = { ...request("AR001"), effects: [emotion] }, b = request("AR002", "B");
  const treatment = treatmentFor([a, b]);
  const timings = [start, { target: "AR001.effect.0", action: "show-effect", frame: 120 }, { target: "AR002", action: "dissolve-in", frame: 330 }];
  assert.equal(fullframeCueTargetsForTreatment(treatment).length, 3);
  assert.deepEqual(validateCueBindingsForTreatment({ treatment, firstCue: { id: "1" },
    bindings: timings.map((item, i) => ({ ...item, cueId: String(i + 1), edge: "start" })) }), []);
  assertActionTimingStructureForTreatment({ treatment, actionTimings: timings, durationInFrames: 600, fps: 60 });
  assert.throws(() => assertActionTimingStructureForTreatment({ treatment, durationInFrames: 600, fps: 60,
    actionTimings: [start, { ...timings[1], frame: 300 }, timings[2]] }), /动作超出所属画面/);
});

test("开关七种效果不改变相机，也不改变静态生图投影", () => {
  const req = request("AR001"), asset = assetFor(req);
  const effects = [
    { type: "snow", direction: "left" }, { type: "foreground", preset: "pine" },
    { type: "fog", region: "lower" }, { type: "dust", region: "lower" },
    { type: "soft-light", source: "top-left", anchorFocus: "左上窗户" }, { type: "grain" }
  ].map((item) => ({ ...item, intensity: "low", timing: "scene", reason: "按场景呈现" }));
  effects.push(emotion);
  const withEffects = treatmentFor([{ ...req, effects }]), without = treatmentFor([req]);
  assert.deepEqual(projectAssetPlanTreatment(withEffects), projectAssetPlanTreatment(without));
  const args = { segmentId: "B001", durationInFrames: 600, targetDurationMs: 10000, policy,
    runtimeTiming: { cameraPrerollFrames: 24, exitTailFrames: 36 } };
  const baseline = renderData({ ...args, treatment: without, assetRefs: [asset], actionTimings: [start] });
  const executed = renderData({ ...args, treatment: withEffects,
    assetRefs: [{ ...asset, effectAnchors: { 4: {anchorFocus:"左上窗户",x:.19,y:.12}, 6: { anchorFocus: emotion.anchorFocus, x: 0.65, y: 0.24 } } }],
    actionTimings: [start, { target: "AR001.effect.6", action: "show-effect", frame: 180 }] });
  assert.deepEqual(executed.fullframe[0].motion, baseline.fullframe[0].motion);
  for (let localFrame = -24; localFrame <= 635; localFrame++) {
    const runtimeTiming = { visualFrameOffset: 24, semanticFrameOffset: 0 };
    assert.deepEqual(cameraStateAtRuntimeFrame({ frames: executed.fullframe, transitions: [], localFrame, runtimeTiming }),
      cameraStateAtRuntimeFrame({ frames: baseline.fullframe, transitions: [], localFrame, runtimeTiming }));
  }
  assert.equal(effectSampleFrame({ index: 0, localFrame: 180, runtimeTiming: { visualFrameOffset: 24 } }), 204);
  assert.equal(executed.fullframe[0].effects.at(-1).startFrame, 204);
  assert.equal(executed.resourceFiles.length, 1);
});

test("实图锚点交接与旧生图字节分开；缺锚点先给材料，接纳与成片明确失败", () => {
  const req = { ...request("AR001"), effects: [emotion] }, asset = assetFor(req);
  assert.throws(() => assertEffectAnchors({request:req,required:true}), /缺少匹配/);
  const anchors = {0:{anchorFocus:emotion.anchorFocus,x:0.65,y:0.24}};
  const result = {...asset,effectAnchors:assertEffectAnchors({request:req,anchors,required:true})};
  assert.deepEqual(result.effectAnchors,anchors);
  assert.equal(result.sha256,asset.sha256);
  const args = { request: req, asset, actionTimings: [{ target: "AR001.effect.0", action: "show-effect", frame: 120 }],
    visibleStartFrame: 0, visibleEndFrame: 599, fps: 60 };
  assert.equal(prepareEffectsForFrame({ ...args, allowPendingAnchors: true }).pendingAnchors.length, 1);
  assert.throws(() => prepareEffectsForFrame(args), /缺少匹配/);
  assert.throws(() => prepareEffectsForFrame({ ...args, asset: { ...asset,
    effectAnchors: { 0: { ...anchors[0], anchorFocus: "另一人物" } } } }), /缺少匹配/);
  const effect = prepareEffectsForFrame({ ...args, asset: result }).effects[0];
  assert.deepEqual(projectedEffectAnchor({ anchor: effect.anchor, camera: { left: -0.1, top: -0.05, scale: 1.5 } }), { x: 0.8750000000000001, y: 0.31 });
  assert.equal(effectOpacityAtFrame({ effect, frame: effect.endFrame, fps: 60 }), 0);
  assert.equal(effectOpacityAtFrame({ effect, frame: 119, fps: 60 }), 0);
  assert.equal(effectOpacityAtFrame({ effect, frame: 150, fps: 60 }), 1);
});

test("作者与素材合同接受效果字段，拒绝表情缺失目标或时长", async () => {
  const schema = JSON.parse(await readFile(new URL("../../../../contracts/fullframe-treatment.schema.json", import.meta.url)));
  const validate = new Ajv2020({ strict: false }).compile({ ...schema.$defs.effect, $defs: schema.$defs });
  assert.equal(validate(emotion), true);
  assert.equal(validate({ ...emotion, timing: "scene" }), false);
  assert.equal(validate({ ...emotion, anchorFocus: undefined }), false);
  for (const file of ["../../../../contracts/fullframe-treatment.schema.json"]) {
    const contract = JSON.parse(await readFile(new URL(file, import.meta.url)));
    const accepts = new Ajv2020({ strict: false }).compile(contract.$defs.effectAnchors);
    assert.equal(accepts({ 0: { anchorFocus: "军官头顶", x: 0.5, y: 0.2 } }), true);
    assert.equal(accepts({ 0: { anchorFocus: "军官头顶", x: 1.5, y: 0.2 } }), false);
  }
});

// Exercise the real transition clock: scene overlays inherit image visibility.
test("跨Beat预入与A/B叠化中，场景效果不再二次淡入淡出", () => {
  const snow = { type: "snow", intensity: "medium", timing: "scene", reason: "持续风雪" };
  const req = { ...request("AR001"), effects: [snow] };
  const incomingTransition = { type: "dissolve", durationMs: 1000, reason: "换景" };
  const timed = resolveCrossBeatRuntimeTiming({ segments: [
    { id: "B001", templateId: "fullframe-narrative", startFrame: 0, durationInFrames: 600 },
    { id: "B002", templateId: "fullframe-narrative", startFrame: 600, durationInFrames: 600, incomingTransition }
  ] });
  const segment = timed.segments[1];
  const data = renderData({ segmentId: segment.id, treatment: treatmentFor([req]), assetRefs: [assetFor(req)],
    actionTimings: [start], durationInFrames: 600, targetDurationMs: 10000, policy,
    runtimeTiming: { cameraPrerollFrames: segment.appliedCameraPrerollFrames, exitTailFrames: segment.appliedExitTailFrames } });
  const effect = data.fullframe[0].effects[0];
  assert.ok(segment.appliedCameraPrerollFrames > 0);
  assert.equal(effectOpacityAtFrame({ effect, frame: effect.startFrame - 20, fps: 60 }), 1,
    "新图在正文Cue前已经可见，场景效果必须同时存在");
  const b = { ...request("AR002", "B"), incomingTransition, effects: [snow] };
  const ab = renderData({ segmentId: "B001", treatment: treatmentFor([req, b]), assetRefs: [assetFor(req), assetFor(b)],
    actionTimings: [start, { target: "AR002", action: "dissolve-in", frame: 480 }],
    durationInFrames: 960, targetDurationMs: 16000, policy });
  const transition = ab.frameTransitions[0];
  for (let frame = transition.startFrame; frame < transition.endFrame; frame++) {
    const weights = narrativeVisibility({ ...transition.design, frame: frame - transition.startFrame });
    for (const [index, key] of ["outgoing", "incoming"].entries()) {
      const opacity = effectOpacityAtFrame({ effect: ab.fullframe[index].effects[0], frame, fps: 60 });
      assert.equal(weights[key] * opacity, weights[key], "效果与所属图片只使用一次转场权重");
    }
  }
});

test("作者可选择聚焦、前景侧别和真实光源，旧卡通符号不再接纳", async () => {
  const schema = JSON.parse(await readFile(new URL("../../../../contracts/fullframe-treatment.schema.json", import.meta.url)));
  const validate = new Ajv2020({ strict: false }).compile({ ...schema.$defs.effect, $defs: schema.$defs });
  assert.equal(validate({ ...emotion, symbol: "focus" }), true);
  assert.equal(validate({ ...emotion, symbol: "sweat" }), false);
  const light = { type: "soft-light", intensity: "low", timing: "scene", source: "top-right", anchorFocus: "右窗", reason: "窗光" };
  assert.equal(validate(light), true);
  assert.equal(validate({ ...light, anchorFocus: undefined }), false);
  assert.throws(() => assertEffectAnchors({ request: { requestId: "AR001", effects: [light] }, required: true }), /右窗/);
  assert.equal(validate({ type: "foreground", intensity: "high", timing: "scene", preset: "pine", side: "right", reason: "右侧枝叶" }), true);
});

test("P3动态预演与P4在非整帧Cue起点使用相同效果时窗", async () => {
  const cues = [
    { id: 1, startMs: 109, endMs: 5101, text: "营地中的人物" },
    { id: 2, startMs: 5101, endMs: 5601, text: "雪卷过营地" },
    { id: 3, startMs: 5601, endMs: 10109, text: "进入另一完整场景" }
  ];
  const bindings = { items: [
    { target: "AR001", action: "start-frame-motion", cueId: 1, edge: "start" },
    { target: "AR001.effect.0", action: "show-effect", cueId: 2, edge: "start" },
    { target: "AR002", action: "dissolve-in", cueId: 3, edge: "start" }
  ] };
  const a = { ...request("AR001"), effects: [{ type: "snow", intensity: "low", timing: "cue", durationMs: 500,
    direction: "left", reason: "风雪在该Cue出现并在切点结束" }] };
  const b = request("AR002", "B"), treatment = treatmentFor([a, b]);
  const durationInFrames = frameSpanForMs({ startMs: cues[0].startMs, endMs: cues.at(-1).endMs, fps: 60 });
  const actionTimings = resolveCueBindingsToFrames({ bindingSet: bindings, cues,
    segmentStartMs: cues[0].startMs, segmentEndMs: cues.at(-1).endMs, fps: 60 });
  assert.deepEqual(actionTimings.map(({ frame }) => frame), [0, 299, 329]);
  const frames = fullframeMotionBudgetForCueOption({ durationInFrames, switchFrame: actionTimings[2].frame,
    transitionDesign: b.incomingTransition, speedRatios: [a.motion.speedRatio, b.motion.speedRatio],
    motions: [a.motion, b.motion], fps: 60 });
  const workOrder = { inputs: { authorUnit: { id: "B001" }, cues, templateContext: {
    cueOptions: { frameA: [{ cueId: 1, edge: "start" }], frameB: [{ cueId: 3, edge: "start" }] },
    motionBudgets: { options: [{ binding: { cueId: 3, edge: "start" }, frames }] }
  } } };
  const candidate = { result: { treatment, featureResults: { "cue-sync": bindings } } };
  const [view] = await candidateCameraViews({ workOrder, candidate, includeEffects: true });
  const formal = renderData({ segmentId: "B001", treatment, actionTimings, assetRefs: [assetFor(a), assetFor(b)],
    targetDurationMs: 10000, durationInFrames, policy });
  assert.deepEqual(view.props.effects, formal.fullframe[0].effects);
  assert.equal(view.props.effects[0].startFrame, 299);
  assert.equal(view.props.effects[0].endFrame, 329);
});


test("叠化B的场景效果从实际可见帧开始，候选与成片一致", async () => {
  const cues = [{ id: 1, startMs: 0, endMs: 5000 }, { id: 2, startMs: 5000, endMs: 10000 }];
  const a = request("AR001"), b = request("AR002", "B");
  b.incomingTransition = { type: "dissolve", durationMs: 600, reason: "口播进入下一场面" };
  b.effects = [{ type: "snow", intensity: "low", timing: "scene", reason: "雪地场景" }];
  const treatment = treatmentFor([a, b]);
  const bindings = { items: [
    { target: a.requestId, action: "start-frame-motion", cueId: 1, edge: "start" },
    { target: b.requestId, action: "dissolve-in", cueId: 2, edge: "start" }
  ] };
  const frames = fullframeMotionBudgetForCueOption({ durationInFrames: 600, switchFrame: 300,
    transitionDesign: b.incomingTransition, motions: [a.motion, b.motion],
    speedRatios: [a.motion.speedRatio, b.motion.speedRatio], fps: 60 });
  const workOrder = { inputs: { authorUnit: { id: "B001" }, cues, templateContext: {
    cueOptions: { frameA: [bindings.items[0]], frameB: [bindings.items[1]] },
    motionBudgets: { options: [{ binding: bindings.items[1], frames }] }
  } } };
  const views = await candidateCameraViews({ workOrder,
    candidate: { result: { treatment, featureResults: { "cue-sync": bindings } } }, includeEffects: true });
  const actionTimings = resolveCueBindingsToFrames({ bindingSet: bindings, cues,
    segmentStartMs: 0, segmentEndMs: 10000, fps: 60 });
  const formal = renderData({ segmentId: "B001", treatment, actionTimings, assetRefs: [assetFor(a), assetFor(b)],
    targetDurationMs: 10000, durationInFrames: 600, policy });
  assert.ok(views[1].props.motion.startFrame < 300);
  assert.equal(views[1].props.effects[0].startFrame, 283, "场景效果跟随叠化首次正显露，而非Cue中点");
  assert.deepEqual(views[1].props.effects, formal.fullframe[1].effects);
});
