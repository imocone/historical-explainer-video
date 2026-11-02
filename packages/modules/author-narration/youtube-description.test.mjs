import assert from "node:assert/strict";
import test from "node:test";
import { chapterPositionsFor, youtubeDescriptionFor } from "./youtube-description.mjs";
import { completeCandidate, validate } from "./publication.mjs";
import { publicationTextFor } from "./publication-text.mjs";
import { publicationTimingFor, restoreTimingReceipt } from "../render-video/runtime/publication-timing.mjs";
import { hashObject } from "../../program-utils.mjs";
import { validateSchema } from "../../../engine/runtime/schema.mjs";

const chapters = [
  { title: "开战之前", startText: "战事开始以前，各方准备不同。" },
  { title: "补给中断", startText: "补给道路被切断，前线开始缺粮。" },
  { title: "战后谈判", startText: "最终各方回到谈判桌。" }
];
const captions = [
  { text: "战事开始以前，各方准备不同。", startMs: 8000, endMs: 18000 },
  { text: "补给道路被切断", startMs: 28120, endMs: 33000 },
  { text: "前线开始缺粮。", startMs: 33000, endMs: 39000 },
  { text: "最终各方回到谈判桌。", startMs: 50950, endMs: 61000 }
];
const narration = chapters.map(chapter => chapter.startText).join("\n");
const youtube = { title: "补给中断之后，战局改变｜战争史", description: "本集讲述补给与战局。\n\n参考资料\n测试档案馆：已核实原页\n\n素材出处\n自制示意图", tags: ["战争史"], chapters };
const description = "本集讲述补给与战局。\n\n时间章节\n00:00 开战之前\n00:28 补给中断\n00:50 战后谈判\n\n参考资料\n测试档案馆：已核实原页\n\n素材出处\n自制示意图";

test("成片时钟含片头偏移，跨字幕定位形成完整简介，保留资料原文", () => {
  const timing = publicationTimingFor({ captions });
  assert.deepEqual(timing, { captions });
  assert.equal(youtubeDescriptionFor({ youtube, timing, durationMs: 65000 }), description);
  assert.equal(youtube.description.includes("00:28"), false);
  assert.equal(youtubeDescriptionFor({ youtube: { ...youtube, chapters: [] } }), youtube.description);
});

test("正文定位缺失、重复、倒序、缺首章与最终章节过短返回真实责任方", () => {
  assert.throws(() => chapterPositionsFor(chapters, narration + chapters[1].startText), /不唯一/u);
  assert.throws(() => chapterPositionsFor(chapters, narration.replace("前线开始缺粮", "前线开始进军")), /缺失/u);
  assert.throws(() => chapterPositionsFor([chapters[1], chapters[0], chapters[2]], narration), /正文开头/u);
  assert.throws(() => chapterPositionsFor([chapters[0], chapters[2], chapters[1]], narration), /正文顺序/u);
  assert.throws(() => youtubeDescriptionFor({ youtube, durationMs: 65000 }), /成片.*计时/u);
  assert.throws(() => youtubeDescriptionFor({ youtube, timing: { captions }, durationMs: 61000 - 2000 }), /计时/u);
  assert.throws(() => youtubeDescriptionFor({ youtube, timing: { captions: captions.map((cue, index) => index === 3 ? { ...cue, endMs: 59000 } : cue) }, durationMs: 59000 }), /不足10秒/u);
  assert.throws(() => youtubeDescriptionFor({ youtube: { ...youtube, description: "文".repeat(4990) }, timing: { captions }, durationMs: 65000 }), /超过5000/u);
});

test("章节随简介定点修订，标题修订继承章节且锁定封面及另外两平台", () => {
  const baseline = { youtube: structuredClone(youtube), douyin: { title: "国内原题", body: "国内原文", topics: [] }, xiaohongshu: { title: "笔记原题", body: "笔记原文", topics: [] } };
  const covers = { youtube: { visibleText: ["横版原字"] }, vertical: { visibleText: ["竖版原字"] } };
  const context = { episodeId: "ep01", targetId: "release-main", scriptPackage: { narration }, openerNarration: { openerNarration: "片头原文" }, returnRequest: {
    revisionScope: "publication-copy", publicationFields: ["youtube.title"], baselinePlatforms: baseline, baselineCovers: covers
  } };
  const result = { platforms: { youtube: { title: "补给道路被切断以后，战局如何变化" } } };
  completeCandidate({ result, context });
  assert.deepEqual(validate({ result, context }), []);
  assert.deepEqual(result.covers, covers);
  for (const platform of ["douyin", "xiaohongshu"]) assert.deepEqual(result.platforms[platform], baseline[platform]);
  result.platforms.youtube.chapters[1].title = "未经授权改章";
  assert.match(validate({ result, context }).join("\n"), /未选.*chapters/u);
  context.returnRequest.publicationFields = ["youtube.description"];
  const edited = { platforms: { youtube: { description: "新简介", chapters: structuredClone(chapters) } } };
  edited.platforms.youtube.chapters[1].title = "粮道被截断以后";
  completeCandidate({ result: edited, context });
  assert.deepEqual(validate({ result: edited, context }), []);
  assert.equal(edited.platforms.youtube.title, youtube.title);
  delete baseline.youtube.chapters;
  context.returnRequest.publicationFields = ["youtube.title"];
  assert.match(validate({ result, context }).join("\n"), /未选.*chapters/u);
});

test("旧成片仅从完全同源计划恢复计时，保留原生产身份且不同源不写回", () => {
  const renderPlan = { episodeId: "ep01", renderDigest: "a".repeat(64), captions };
  const business = { episodeId: "ep01", renderDigest: renderPlan.renderDigest,
    renderPlanSha256: hashObject(renderPlan), sha256: "b".repeat(64), durationMs: 65000 };
  const receipt = { ...business, _producer: { moduleId: "render-video", nodeId: "render",
    taskDigest: "c".repeat(64), inputs: ["d".repeat(64)], outputSha256: hashObject(business) } };
  const original = structuredClone(receipt);
  const restore = (value = receipt, plan = renderPlan, videoSha256 = business.sha256) =>
    restoreTimingReceipt({ receipt: value, renderPlan: plan, videoSha256 });
  const restored = restore();
  assert.deepEqual(receipt, original);
  assert.deepEqual(restored.publicationTiming, { captions });
  assert.deepEqual(restored._producer.inputs, receipt._producer.inputs);
  assert.equal(restored._producer.taskDigest, receipt._producer.taskDigest);
  const { _producer, ...restoredBusiness } = restored;
  assert.equal(_producer.outputSha256, hashObject(restoredBusiness));
  assert.deepEqual(restore(restored), restored);
  assert.throws(() => restore(receipt, { ...renderPlan, captions: captions.slice(1) }), /同源/u);
  assert.throws(() => restore(receipt, renderPlan, "e".repeat(64)), /同源/u);
  assert.throws(() => restore({ ...receipt, durationMs: 66000 }), /同源/u);
  const wrongBusiness = { ...business, publicationTiming: { captions: captions.slice(1) } };
  const wrong = { ...wrongBusiness, _producer: { ...receipt._producer, outputSha256: hashObject(wrongBusiness) } };
  assert.throws(() => restore(wrong), /已有不同/u);
});
