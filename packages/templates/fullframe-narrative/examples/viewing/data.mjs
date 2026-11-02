import { VIDEO_SPEC } from "../../../../video-spec.mjs";
import { fullframeFramingFor } from "../../camera/framing.mjs";
import { createRenderPolicy, renderData, assertActionTimingsForTreatment } from "../../render-plan.mjs";
import { studySegment } from "../effects/data.mjs";
import { fullframeSpeedSecondsAt } from "../../render-policy.mjs";

const viewport = (x, y, width) => ({ x, y, width, height: width });
const route = (type, start, end, rhythm = {}) => ({ type, speedRatio: 1.1,
  startViewport: start, routeWaypoints: [], semanticEndViewport: end, safeEndViewport: end, ...rhythm });
const room = { image: "room", purpose: "使手与信的间隙获得分量，体会迟迟不接的犹豫",
  scene: "虚构房间中，桌前人面对平放的信，手悬停在信前，另一手静放桌上；空座、地板与后墙相连。",
  entry: "桌前人、停手与信", landing: "同一停手和信的间隙", change: "信已在面前，手却迟迟未接" };
const corridor = { image: "corridor", purpose: "先读关门，再沿相连廊地发现仍在等候的人",
  scene: "虚构外廊中，左侧木门关闭，右侧匿名送信人空手停立，面向门；人门之间地面连续。",
  entry: "关闭的门及廊地", landing: "空手等候者与关闭的门", change: "关门之外还有人一直等着" };
const harbor = { image: "transitions/harbor", purpose: "读清搬运者、货物与靠岸船只的联系",
  scene: "虚构河港中，左侧两名搬运者与中央木箱相连，右侧货船靠岸。", entry: "搬运者与木箱",
  landing: "搬运者、木箱与船", change: "看清货物在岸边装卸" };
const market = { image: "transitions/market", purpose: "从货物顺着看到街道日常",
  scene: "虚构街市中，左侧摊位摆着布匹和菜蔬，右侧顾客与中央街道相连。", entry: "摊位与右侧顾客",
  landing: "摊位、顾客与完整街道", change: "货物进入日常生意" };
const supply = { image: "motion-transfer/supply", purpose: "沿器材与线缆读到接手的维修者",
  scene: "虚构灯塔旁的检修棚中，左侧搬运者扶着装有线缆的木箱，线缆沿同一工作台通向右侧维修者与灯具。",
  entry: "搬运者、木箱和器材", landing: "线缆、维修者的双手与灯具", change: "灯具维修由送来器材与接手检修共同完成" };
const height = { image: "motion-transfer/height", purpose: "从携带工具的工人沿阶梯读到高处灯室",
  scene: "虚构海岸灯塔外，工人在下方阶梯旁扶住栏杆，上方脚手架、阶梯和发亮灯室在同一仰视空间中连续相连。",
  entry: "携带工具的工人与阶梯", landing: "阶梯通向的高处灯室", change: "检修器材还须经过攀登才能抵达灯室" };
const wick = { image: "motion-transfer/wick", purpose: "让灯芯、火焰与调节轮的细小联系获得分量",
  scene: "虚构灯室内的近景中，戴手套的手指停在黄铜调节轮上，灯芯与稳定火焰清楚，玻璃外海面次要。",
  entry: "手指、调节轮与灯芯", landing: "稳定火焰、灯芯与调节轮", change: "远处能看见的灯光，仍取决于眼前细小的调节" };
const lighthouseContinuity = { period: "20世纪初原创虚构", location: "海岸灯塔、检修棚与灯室",
  subjects: ["器材搬运者", "灯塔维修者"], props: ["检修器材", "阶梯", "灯具"] };
const sceneImages = new Map([room, corridor, harbor, market, supply, height, wick].map(scene => [scene.scene, scene.image]));
const speech = {
  winter: [{ startMs: 600, endMs: 4000, text: "他攥着电报，望向远处。" },
    { startMs: 4800, endMs: 9500, text: "消息已经到了，答复却迟迟没有给出。" }],
  room: [{ startMs: 600, endMs: 3000, text: "信就在面前。" },
    { startMs: 3400, endMs: 7800, text: "他的手停住了，迟迟没有接过去。" }],
  corridor: [{ startMs: 500, endMs: 3500, text: "门始终没有打开。" },
    { startMs: 4500, endMs: 7900, text: "送信的人，还在廊下等着。" }],
  joint: [{ startMs: 600, endMs: 7400, text: "他看着桌上的信，手停住了。" },
    { startMs: 8300, endMs: 15500, text: "送信的人还在廊下等着，门始终没有打开。" }],
  march: [{ startMs: 600, endMs: 7400, text: "前后的马车，沿着同一条路向前。" }],
  ordinary: [{ startMs: 600, endMs: 7300, text: "货物在码头卸下。" },
    { startMs: 8400, endMs: 15500, text: "城里的摊位，摆出了各样货物。" }]
};

const request = (scene, motion, frameId = "A") => ({
  requestId: frameId === "A" ? "AR001" : "AR002", frameId, kind: "fullframe-image", required: true,
  cameraRelation: frameId === "A" ? "first" : "reset", purpose: scene.purpose, sceneDescription: scene.scene,
  sourceRefs: [frameId === "A" ? "C001" : "C002"], mustNotInvent: ["原创虚构教学，不作为史料", "不增加场面中没有的动作"],
  acceptanceCriteria: [scene.purpose], attentionPlan: { entryFocus: scene.entry, landingFocus: scene.landing,
    safeEndFocus: scene.landing, viewerChange: scene.change }, motion
});
const segmentFor = (id, requests, visualStyle, seconds = 8, continuity = {}) => {
  const treatment = { templateId: "fullframe-narrative", incomingTransition: null,
    calloutGate: { "historical-quote": "not-triggered", "person-intro": "not-triggered", "term-gloss": "not-triggered" },
    continuity: { period: "19世纪末原创虚构", location: "同一建筑的室内及外廊", continuesPreviousScene: false,
      subjects: ["匿名收信人", "匿名送信人"], props: ["来信", "关闭的门"], carryToNext: { subjects: [], props: [] }, ...continuity },
    assetRequests: requests };
  const actionTimings = requests.map((r, index) => ({ target: r.requestId,
    action: index ? "dissolve-in" : "start-frame-motion", frame: index ? 8 * VIDEO_SPEC.fps : 0 }));
  const assetRefs = requests.map(r => ({ requestId: r.requestId, kind: "fullframe-image", mediaType: "image",
    file: `packages/templates/fullframe-narrative/examples/viewing/assets/${sceneImages.get(r.sceneDescription)}.png`,
    framing: fullframeFramingFor({ request: { spec: r } }) }));
  const durationInFrames = seconds * VIDEO_SPEC.fps;
  assertActionTimingsForTreatment({ treatment, actionTimings, durationInFrames, fps: VIDEO_SPEC.fps });
  return { id, templateId: "fullframe-narrative", visualStyle, treatment, actionTimings, assetRefs, durationInFrames,
    runtimeTiming: { visualFrameOffset: 0, semanticFrameOffset: 0 },
    renderData: renderData({ segmentId: id, treatment, actionTimings, assetRefs, targetDurationMs: seconds * 1000,
      durationInFrames, policy: createRenderPolicy({ visualStyle, ...VIDEO_SPEC }) }) };
};

export const viewingStudies = visualStyle => {
  const winter = studySegment({ study: { id: "winter", image: "winter-camp", effects: [] }, visualStyle, baseline: true });
  // Snapshot of the previous teaching camera, retained only for the before/after comparison.
  const oldTreatment = structuredClone(winter.treatment);
  oldTreatment.assetRequests[0].motion = route("push-in", viewport(0, 0, 1), viewport(.21, .02, 2 / 3), { speedRatio: 1.25 });
  const oldAssets = winter.assetRefs.map(asset => ({ ...asset,
    framing: fullframeFramingFor({ request: { spec: oldTreatment.assetRequests[0] } }) }));
  const oldWinter = { ...winter, treatment: oldTreatment, assetRefs: oldAssets,
    renderData: renderData({ segmentId: "winter-before", treatment: oldTreatment, actionTimings: winter.actionTimings,
      assetRefs: oldAssets, targetDurationMs: 10000, durationInFrames: winter.durationInFrames,
      policy: createRenderPolicy({ visualStyle, ...VIDEO_SPEC }) }) };
  const roomPush = route("push-in", viewport(0, 0, 1), viewport(.20, .05, .75));
  const roomPan = route("traverse", viewport(.25, .02, .75), viewport(.05, .02, .75));
  const corridorRoute = route("traverse", viewport(0, .12, 2 / 3), viewport(1 / 3, .12, 2 / 3));
  const rhythm = { speedRatio: 1, speedChanges: [{ timeMs: 3000, speedRatio: 4.9 }, { timeMs: 5900, speedRatio: 1 }] };
  // Match the control clip's actual final crop; this is a comparison fixture, not production speed selection.
  const elapsed = 8 - 1 / VIDEO_SPEC.fps;
  const constantSpeed = fullframeSpeedSecondsAt({ motion: rhythm, elapsedSeconds: elapsed }) / elapsed;
  const waiting = { ...corridor, purpose: "以门外等待接住室内迟疑", entry: "空手等候者与关闭的门",
    change: "屋内迟迟不接，屋外迟迟未获回应" };
  const joint = type => segmentFor(`joint-${type}`, [request(room, roomPush),
    { ...request(waiting, route("traverse", viewport(.20, .09, .80), viewport(0, .09, .80)), "B"),
      incomingTransition: { type: "dissolve", durationMs: type === "short" ? 600 : 1600, reason: "室内停手接屋外等待，未完成的回应仍持续；比较共显时长对人物和门墙辨认的影响，不以闪黑强行制造结束" } }], visualStyle, 16);
  return [
    { id: "transfer-supply", name: "器材与接手：沿台面横移", segment: segmentFor("transfer-supply", [request(supply,
      route("traverse", viewport(0, .08, .72), viewport(.28, .08, .72), { speedRatio: 1.35,
        speedChanges: [{ timeMs: 4500, speedRatio: 2.2 }, { timeMs: 7000, speedRatio: 1 }] }))], visualStyle, 8, lighthouseContinuity),
      speech: [{ startMs: 300, endMs: 3100, text: "器材先从码头送来。" },
        { startMs: 3500, endMs: 7800, text: "再交到检修的双手之间。" }] },
    { id: "transfer-height", name: "工人与灯室：沿阶梯上移", segment: segmentFor("transfer-height", [request(height,
      route("traverse", viewport(.28, .30, .70), viewport(.28, .02, .70), { speedRatio: 1.8,
        speedChanges: [{ timeMs: 4500, speedRatio: 3 }, { timeMs: 6300, speedRatio: 1 }] }))], visualStyle, 9, lighthouseContinuity),
      speech: [{ startMs: 300, endMs: 3600, text: "检修台上完成的，只是第一步。" },
        { startMs: 4100, endMs: 8700, text: "这些器材，还要沿着阶梯送上灯室。" }] },
    { id: "transfer-wick", name: "细节获得分量：近景定向推近", segment: segmentFor("transfer-wick", [request(wick,
      route("push-in", viewport(0, 0, 1), viewport(.15, 0, .74), { speedRatio: 1.1 }))], visualStyle, 8, lighthouseContinuity),
      speech: [{ startMs: 300, endMs: 3600, text: "远处能看见的那束光，" },
        { startMs: 4000, endMs: 7800, text: "仍要从眼前这根灯芯调起。" }] },
    { id: "winter-before", name: "旧取景：手与电报被裁", segment: oldWinter, speech: speech.winter },
    { id: "winter-after", name: "修正：持续推近，保住动作", segment: winter, speech: speech.winter },
    { id: "room-push", name: "同题：靠近停手", segment: segmentFor("room-push", [request(room, roomPush)], visualStyle), speech: speech.room },
    { id: "room-pan", name: "同题：沿桌面移看", segment: segmentFor("room-pan", [request(room, roomPan)], visualStyle), speech: speech.room },
    { id: "room-pull", name: "同题：向房间展开", segment: segmentFor("room-pull", [request(room,
      route("pull-out", viewport(.20, .05, .75), viewport(0, 0, 1)))], visualStyle), speech: speech.room },
    { id: "corridor-constant", name: "恒速：持续移看", segment: segmentFor("corridor-constant", [request(corridor,
      { ...corridorRoute, speedRatio: constantSpeed })], visualStyle), speech: speech.corridor },
    { id: "corridor-rhythm", name: "调整：变速带出等候，持续移看", segment: segmentFor("corridor-rhythm", [request(corridor,
      { ...corridorRoute, ...rhythm })], visualStyle), speech: speech.corridor },
    { id: "joint-short", name: "等待承接：短叠化试制", segment: joint("short"), speech: speech.joint },
    { id: "joint-dissolve", name: "接镜：叠化", segment: joint("long"), speech: speech.joint },
    { id: "march-transfer", name: "另题迁移：车队与道路", segment: studySegment({
      study: { id: "march", image: "march", effects: [] }, visualStyle, baseline: true }), speech: speech.march },
    ...["dissolve", "dip-to-black"].map(type => ({ id: `ordinary-${type}`, name: type === "dissolve" ? "货物流转：叠化承接" : "段落收束：闪黑再起",
      speech: type === "dissolve" ? speech.ordinary : [
        {startMs: 600, endMs: 7300, text: "码头的装卸，到这里告一段落。"},
        {startMs: 8400, endMs: 15500, text: "接下来，再看城里的日常生意。"}],
      segment: segmentFor(`ordinary-${type}`, [harbor, market].map((scene, index) => ({
        ...request(scene, route("push-in", viewport(0, 0, 1), viewport(.06, .04, .75),
          { speedRatio: 1 }), index ? "B" : "A"),
        ...(index ? { incomingTransition: { type, durationMs: type === "dissolve" ? 800 : 1200, reason: type === "dissolve"
          ? "码头卸货顺接街市货物，继续观察货物流转；相近关注区域渐次接手"
          : "码头单元已告一段落，先留一口气，再独立起笔观看街市生活；两侧关键内容避开黑位" } } : {})
      })), visualStyle, 16, { location: "虚构河城的仓口、河岸与街市", subjects: ["搬运者", "摊主", "顾客"],
        props: ["木箱", "货船", "街市货物"] }) }))
  ];
};
