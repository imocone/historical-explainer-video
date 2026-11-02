import { VIDEO_SPEC } from "../../../../video-spec.mjs";
import { fullframeFramingFor } from "../../camera/framing.mjs";
import { createRenderPolicy, renderData, assertActionTimingsForTreatment } from "../../render-plan.mjs";

export const EFFECT_STUDIES = [
  { id: "snow", name: "下雪", image: "winter-camp", effects: [{ type: "snow", direction: "left" }],
    narration: "风雪里的营地，仍在等待消息。" },
  { id: "foreground", name: "虚化前景", image: "winter-camp", effects: [{ type: "foreground", preset: "pine", side: "left" }],
    narration: "透过营地边的树枝，他攥着电报，望向远处。" },
  { id: "emotion", name: "人物聚焦与短时提示", image: "winter-camp", effects: [
    { type: "emotion", symbol: "focus", cueSecond: 1.8 },
    { type: "emotion", symbol: "question", cueSecond: 5.0 }],
    narration: "他攥着电报，对命令感到疑惑。" },
  { id: "fog", name: "雾", image: "winter-camp", effects: [{ type: "fog", region: "lower", direction: "right" }],
    narration: "低处的薄雾慢慢掠过营地。" },
  { id: "dust", name: "烟尘", image: "march", effects: [{ type: "dust", region: "lower", direction: "left" }],
    narration: "车队走上干燥的土路，尘土被风带向一旁。" },
  { id: "soft-light", name: "柔光", image: "office", effects: [{ type: "soft-light", source: "top-left", anchorFocus: "左侧窗户透光处" }],
    narration: "窗边的光缓缓落在这封信上。" },
  { id: "grain", name: "颗粒", image: "office", effects: [{ type: "grain" }],
    narration: "往事被留在纸上。" }
];

const imageViewing = {
  "winter-camp": { purpose: "保住脸、双手和电报，使攥着消息的停顿获得分量", landing: "军官的神情、双手与电报",
    change: "电报仍攥在手里，人迟迟没有给出答复", end: { x: .20, y: .075, width: .75, height: .75 } },
  office: { purpose: "沿来信、持信的手与思索的脸收紧，保留阅读关系", landing: "来信、持信的手与面部",
    change: "看清正在读信和思索的姿态", end: { x: .24, y: .10, width: .75, height: .75 } },
  march: { purpose: "让前后马车和相连道路获得分量，保住队列关系", landing: "前后马车与延伸道路",
    change: "沿道路读清车队的前后联系", end: { x: .23, y: .12, width: .75, height: .75 } }
};

const baseRequest = ({ image, requestId = "AR001", frameId = "A" }) => ({
  requestId, frameId, kind: "fullframe-image", required: true, cameraRelation: frameId === "A" ? "first" : "reset",
  purpose: imageViewing[image].purpose, sourceRefs: ["C001"], mustNotInvent: ["样片为虚构人物与场面，不作为史料"],
  sceneDescription: image === "winter-camp" ? "虚构的冬营中，军官拿着电报，远处是帐篷和雪山。"
    : image === "march" ? "虚构的军用马车走在干燥的土路上。" : "虚构的军官在窗边办公桌阅读来信。",
  acceptanceCriteria: [imageViewing[image].purpose],
  attentionPlan: { entryFocus: "完整场景中的主体及必要关系", landingFocus: imageViewing[image].landing,
    safeEndFocus: imageViewing[image].landing, viewerChange: imageViewing[image].change },
  motion: { type: "push-in", speedRatio: 1,
    startViewport: { x: 0, y: 0, width: 1, height: 1 }, routeWaypoints: [],
    semanticEndViewport: imageViewing[image].end, safeEndViewport: imageViewing[image].end }
});

const imageAsset = (request, image) => ({ requestId: request.requestId, kind: "fullframe-image", mediaType: "image",
  file: `packages/templates/fullframe-narrative/examples/effects/assets/${image}.png`,
  framing: fullframeFramingFor({ request: { spec: request } }),
  effectAnchors: Object.fromEntries((request.effects ?? []).flatMap((effect, index) => ["emotion", "soft-light"].includes(effect.type)
    ? [[index, { anchorFocus: effect.anchorFocus,
      x: effect.type === "soft-light" ? .19 : .58,
      y: effect.type === "soft-light" ? .12 : effect.symbol === "focus" ? .265 : .105 }]] : [])) });

const treatmentFor = (requests) => ({ templateId: "fullframe-narrative", incomingTransition: null,
  calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" },
  continuity: { period: "20世纪初虚构场面", location: "冬营、道路或办公室", continuesPreviousScene: false,
    subjects: ["虚构人物"], props: ["电报或来信"], carryToNext: { subjects: [], props: [] } },
  assetRequests: requests });

export const studySegment = ({ study, visualStyle, intensity = "medium", baseline = false }) => {
  const effects = baseline ? [] : study.effects.map(({ cueSecond, ...effect }) => ({ ...effect, intensity,
    timing: effect.type === "emotion" ? "cue" : "scene", reason: study.narration,
    ...(effect.type === "emotion" ? { durationMs: 1500, anchorFocus: effect.symbol === "focus" ? "手持电报的军官面部" : "手持电报的军官头顶" } : {}) }));
  const request = { ...baseRequest(study), ...(effects.length ? { effects } : {}) };
  const treatment = treatmentFor([request]);
  const actionTimings = [{ target: "AR001", action: "start-frame-motion", frame: 0 },
    ...effects.flatMap((effect, index) => effect.timing === "cue" ? [{ target: `AR001.effect.${index}`,
      action: "show-effect", frame: Math.round(study.effects[index].cueSecond * VIDEO_SPEC.fps) }] : [])];
  const durationInFrames = 10 * VIDEO_SPEC.fps;
  assertActionTimingsForTreatment({ treatment, actionTimings, durationInFrames, fps: VIDEO_SPEC.fps });
  const assetRefs = [imageAsset(request, study.image)];
  const policy = createRenderPolicy({ visualStyle, ...VIDEO_SPEC });
  return { id: `study-${study.id}`, visualStyle, templateId: "fullframe-narrative", treatment, actionTimings, assetRefs,
    durationInFrames, runtimeTiming: { visualFrameOffset: 0, semanticFrameOffset: 0 },
    renderData: renderData({ segmentId: `study-${study.id}`, treatment, actionTimings, assetRefs,
      targetDurationMs: 10000, durationInFrames, policy }) };
};

// Both images carry their effects through the real A/B transition component.
export const transitionStudySegment = ({ visualStyle }) => {
  const a = { ...baseRequest({ image: "winter-camp" }), effects: [
    { type: "snow", intensity: "low", timing: "scene", direction: "left", reason: "冬营风雪" },
    { type: "foreground", intensity: "low", timing: "scene", preset: "pine", reason: "近处松枝" },
    { type: "emotion", intensity: "medium", timing: "cue", durationMs: 1200,
      symbol: "question", anchorFocus: "手持电报的军官头顶", reason: "他对命令疑惑" } ] };
  const b = { ...baseRequest({ image: "office", requestId: "AR002", frameId: "B" }),
    incomingTransition: { type: "dissolve", durationMs: 1000, reason: "从冬营转到室内来信" },
    effects: [{ type: "soft-light", intensity: "low", timing: "scene", source: "top-left", anchorFocus: "左侧窗户透光处", reason: "窗边光源" },
      { type: "grain", intensity: "low", timing: "scene", reason: "轻微纸面质感" }] };
  const treatment = treatmentFor([a, b]);
  const actionTimings = [{ target: "AR001", action: "start-frame-motion", frame: 0 },
    { target: "AR001.effect.2", action: "show-effect", frame: 3 * VIDEO_SPEC.fps },
    { target: "AR002", action: "dissolve-in", frame: 8 * VIDEO_SPEC.fps }];
  const assetRefs = [imageAsset(a, "winter-camp"), imageAsset(b, "office")];
  const durationInFrames = 16 * VIDEO_SPEC.fps;
  const policy = createRenderPolicy({ visualStyle, ...VIDEO_SPEC });
  assertActionTimingsForTreatment({ treatment, actionTimings, durationInFrames, fps: VIDEO_SPEC.fps });
  return { id: "study-transition", templateId: "fullframe-narrative", visualStyle, treatment, actionTimings, assetRefs,
    durationInFrames, runtimeTiming: { visualFrameOffset: 0, semanticFrameOffset: 0 },
    renderData: renderData({ segmentId: "study-transition", treatment, actionTimings, assetRefs,
      targetDurationMs: 16000, durationInFrames, policy }) };
};
