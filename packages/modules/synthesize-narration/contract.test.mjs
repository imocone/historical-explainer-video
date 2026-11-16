import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AuthorizationRequiredError,
  inspect,
  prepareNarrationText,
  replaceUnknown,
  run,
  savePronunciations,
  UnknownRemoteResultError
} from "./run.mjs";
import { readData } from "../../program-utils.mjs";
import { alignWordTimeline } from "../author-subtitles/subtitle-timing.mjs";
import { createMiniMaxTtsService } from "./minimax.mjs";

const task = (service, authorized = true) => ({
  moduleId: "synthesize-narration",
  nodeId: "synthesize-narration",
  taskDigest: "a".repeat(64),
  inputHashes: ["b".repeat(64)],
  context: {
    paidTtsAuthorized: authorized,
    paidPreflight: { async assertReady() {} },
    ttsService: service,
    scriptPackage: {
      episodeId: "ep01",
      seriesTitle: "测试系列",
      language: "zh-CN",
      narration: "甲。"
    }
  }
});
const setup = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synthesize-narration-"));
  const p2 = path.join(root, "ep01", "制作", "p2");
  await mkdir(p2, { recursive: true });
  await writeFile(path.join(p2, "tts-input.txt"), "甲。\n");
  return root;
};

test("清洗保留英文词间空格，原自然段处理和不可见字符拒绝不变", () => {
  assert.equal(prepareNarrationText("我们使用 Open AI。"), "我们使用 Open AI。");
  assert.equal(prepareNarrationText("他来了。\n\n大家沉默。\n\n后来，他走了。"), "他来了。大家沉默。后来，他走了。");
  for (const hidden of ["\u200b", "\ufeff"]) assert.throws(() => prepareNarrationText(`${hidden}甲。`), /不可见控制字符/);
});

test("音频先保存再取可选时间，中断后恢复原响应和时间地址而不再次合成", async () => {
  const root = await setup();
  try {
    let posts = 0; let downloads = 0; let reads = 0;
    const timingUrl = "https://timing.example/original";
    const subtitleText = JSON.stringify([{ text: "甲1180乙。", text_begin: 0, timestamped_words: [
      { word: "甲", word_begin: 0, word_end: 1, time_begin: 0, time_end: 550 },
      { word: "一", word_begin: 1, word_end: 5, time_begin: 500, time_end: 700 },
      { word: "一八零", word_begin: 1, word_end: 5, time_begin: 700, time_end: 900 },
      { word: "乙", word_begin: 5, word_end: 6, time_begin: 900, time_end: 1000 },
      { word: "。", word_begin: 6, word_end: 7, time_begin: 1000, time_end: 1100 }
    ] }, { text: "丙丁。", text_begin: 6, timestamped_words: [
      { word: "丙", word_begin: 6, word_end: 7, time_begin: 1100, time_end: 1300 },
      { word: "丁", word_begin: 7, word_end: 8, time_begin: 1300, time_end: 1500 },
      { word: "。", word_begin: 8, word_end: 9, time_begin: 1500, time_end: 1500 }
    ] }], null, 2) + "\n";
    const responsePath = path.join(root, "ep01/制作/p2/_work/tts-response.json");
    const service = createMiniMaxTtsService({ apiKey: "offline-test", environment: {}, envFile: path.join(root, "absent"),
      fetchImpl: async (url) => {
        if (url.endsWith("/v1/t2a_v2")) {
          posts++;
          return { ok: true, async text() { return JSON.stringify({ base_resp: { status_code: 0 },
            data: { status: 2, audio: Buffer.from("retained").toString("hex"), task_id: "original", subtitle_file: timingUrl } }); } };
        }
        assert.equal(url, timingUrl); downloads++;
        return new Response(subtitleText);
      } });
    const readNativeTiming = service.readNativeTiming.bind(service);
    service.readNativeTiming = async (source, options) => {
      const pending = await readData(responsePath);
      if (!pending.delivered) assert.equal(Buffer.from(pending.audioBase64, "base64").toString(), "retained");
      assert.equal(pending.nativeTimingSource.data.subtitle_file, timingUrl);
      if (++reads === 1) return readNativeTiming(source, { ...options, onDownloadedSubtitle: async (value) => {
        await options.onDownloadedSubtitle(value);
        assert.equal((await readData(responsePath)).downloadedSubtitle, subtitleText);
        throw new Error("模拟字幕文件落盘后、解析前进程中断");
      } });
      return readNativeTiming(source, options);
    };
    const current = task(service);
    current.context.scriptPackage.narration = "甲1180乙。丙丁。";
    await assert.rejects(run({ root, episodeId: "ep01", task: current }), /模拟字幕文件落盘后、解析前进程中断/);
    assert.equal((await inspect({ root, episodeId: "ep01", task: current })).paidCallRequired, false);
    current.context.paidTtsAuthorized = false;
    const result = await run({ root, episodeId: "ep01", task: current });
    assert.equal(posts, 1); assert.equal(downloads, 1);
    assert.equal(result.remoteTaskId, "original");
    const retained = await readData(responsePath);
    assert.equal(retained.delivered, true);
    assert.equal(retained.downloadedSubtitle, subtitleText);
    assert.equal(retained.result.rawAudio.sha256, result.rawAudio.sha256);
    const cues = result.nativeTiming.cues;
    assert.deepEqual(cues, [
      { text: "甲", startMs: 0, endMs: 550 },
      { text: "1180", startMs: 500, endMs: 900 },
      { text: "乙", startMs: 900, endMs: 1000 },
      { text: "。", startMs: 1000, endMs: 1100 },
      { text: "丙", startMs: 1100, endMs: 1300 },
      { text: "丁", startMs: 1300, endMs: 1500 }
    ]);
    const timeline = alignWordTimeline({ wordCues: cues, narration: current.context.scriptPackage.narration });
    assert.deepEqual(timeline.project(0, 6), { text: "甲1180乙。", startMs: 0, endMs: 1000 });
    assert.deepEqual(timeline.project(6, 8), { text: "丙丁。", startMs: 1100, endMs: 1500 });
    current.context.replayRetainedNativeTiming = true;
    assert.deepEqual((await run({ root, episodeId: "ep01", task: current })).nativeTiming, result.nativeTiming);
    assert.equal(posts, 1);
    assert.equal(downloads, 1);
    assert.equal(await readFile(path.join(root, "ep01/制作/p2/raw-narration.flac"), "utf8"), "retained");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("词级文件无法解析时保留原证据，已交付的配音仍可复用", async (t) => {
  const root = await setup();
  try {
    const warning = t.mock.method(console, "warn", () => {});
    const timingUrl = "https://timing.example/original";
    const downloadedSubtitle = [{ word: "甲", time_begin: 500, time_end: 0 }];
    let posts = 0;
    let downloads = 0;
    const service = createMiniMaxTtsService({ apiKey: "offline-test", environment: {}, envFile: path.join(root, "absent"),
      fetchImpl: async (url) => {
        if (url === timingUrl) {
          downloads++;
          return new Response(JSON.stringify(downloadedSubtitle));
        }
        posts++;
        return new Response(JSON.stringify({ base_resp: { status_code: 0 },
          data: { status: 2, audio: "0001", subtitle_file: timingUrl } }));
      } });
    const current = task(service);
    const result = await run({ root, episodeId: "ep01", task: current });
    assert.equal(result.nativeTiming, null);
    assert.match(warning.mock.calls[0].arguments[0], /第 1 条无效/u);
    const saved = await readData(path.join(root, "ep01/制作/p2/_work/tts-response.json"));
    assert.equal(saved.nativeTimingSource.data.subtitle_file, timingUrl);
    assert.deepEqual(JSON.parse(saved.downloadedSubtitle), downloadedSubtitle);
    assert.equal(saved.result.rawAudio.sha256, result.rawAudio.sha256);
    assert.equal((await inspect({ root, episodeId: "ep01", task: current })).valid, true);
    current.context.paidTtsAuthorized = false;
    assert.equal((await run({ root, episodeId: "ep01", task: current })).reused, true);
    assert.equal(posts, 1);
    assert.equal(downloads, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("明确替换未知TTS保留原记录、重复命令只恢复一次，替换再次未知仍停止", async () => {
  for (const outcome of ["succeeded", "unknown"]) {
    const root = await setup();
    try {
      let calls = 0;
      const current = task({ async synthesize() {
        calls++;
        if (calls === 1 || outcome === "unknown") throw new Error("response lost");
        return { audio: Buffer.from("real replacement audio") };
      } });
      await assert.rejects(run({ root, episodeId: "ep01", task: current }), UnknownRemoteResultError);
      const intentPath = path.join(root, "ep01/制作/p2/_work/tts-intent.yaml");
      const original = JSON.parse(await readFile(intentPath, "utf8"));
      await assert.rejects(replaceUnknown({ root, episodeId: "ep01", task: { ...current,
        context: { ...current.context, paidTtsAuthorized: false } }, fingerprint: original.fingerprint }), AuthorizationRequiredError);
      await assert.rejects(replaceUnknown({ root, episodeId: "ep01", task: current, fingerprint: "f".repeat(64) }), /不符/);
      const replace = () => replaceUnknown({ root, episodeId: "ep01", task: current, fingerprint: original.fingerprint });
      await replace();
      await replace();
      assert.deepEqual(JSON.parse(await readFile(intentPath, "utf8")).previousAttempt, original);
      assert.equal((await inspect({ root, episodeId: "ep01", task: current })).paidCallRequired, true);
      if (outcome === "unknown") {
        await assert.rejects(run({ root, episodeId: "ep01", task: current }), UnknownRemoteResultError);
        await replace();
        await assert.rejects(run({ root, episodeId: "ep01", task: current }), UnknownRemoteResultError);
      } else {
        await run({ root, episodeId: "ep01", task: current });
        await replace();
        assert.equal((await run({ root, episodeId: "ep01", task: current })).reused, true);
      }
      assert.equal(calls, 2);
      assert.deepEqual(JSON.parse(await readFile(intentPath, "utf8")).previousAttempt, original);
      current.context.scriptPackage.narration = "乙。";
      await assert.rejects(replace(), /不能改变原正文/);
      assert.equal(calls, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("成功响应写入正式音频或回执失败后，本地恢复不重调供应商", async (t) => {
  for (const blocked of ["raw-narration.flac", "tts-result.yaml"]) await t.test(blocked, async () => {
    const root = await setup();
    try {
      const p2 = path.join(root, "ep01", "制作", "p2");
      await mkdir(path.join(p2, blocked));
      let calls = 0;
      const current = task({ async synthesize() { calls++; return { audio: Buffer.from("retained"), remoteTaskId: "original", durationMs: 1234 }; } });
      await assert.rejects(run({ root, episodeId: "ep01", task: current }));
      const pending = await readData(path.join(p2, "_work", "tts-response.json"));
      assert.equal(pending.result.remoteTaskId, "original");
      assert.equal((await inspect({ root, episodeId: "ep01", task: current })).paidCallRequired, false);
      await rm(path.join(p2, blocked), { recursive: true });
      current.context.paidTtsAuthorized = false;
      const result = await run({ root, episodeId: "ep01", task: current });
      assert.equal(calls, 1);
      assert.equal(result.remoteTaskId, "original");
      assert.equal(result.durationMs, 1234);
      assert.equal(await readFile(path.join(p2, "raw-narration.flac"), "utf8"), "retained");
      await assert.rejects(readFile(path.join(p2, "_work", "tts-response.json")), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test("本集读音进入真实请求身份，改读音仍需要新合成授权", async () => {
  const root = await setup();
  try {
    const pronunciations = [{ text: "甲", reading: "(jia3)" }];
    await savePronunciations({ root, episodeId: "ep01", pronunciations });
    let calls = 0;
    const current = task({ async synthesize(request) { calls++; assert.deepEqual(request.pronunciations, pronunciations); return { audio: Buffer.from("a") }; } });
    const result = await run({ root, episodeId: "ep01", task: current });
    assert.deepEqual(result.pronunciations, pronunciations);
    await savePronunciations({ root, episodeId: "ep01", pronunciations: [{ text: "甲", reading: "(jia4)" }] });
    current.context.paidTtsAuthorized = false;
    assert.equal((await inspect({ root, episodeId: "ep01", task: current })).paidCallRequired, true);
    await assert.rejects(run({ root, episodeId: "ep01", task: current }), AuthorizationRequiredError);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("synthesize-narration 缺授权零供应商调用", async () => {
  const root = await setup();
  try {
    let calls = 0;
    await assert.rejects(
      run({
        root,
        episodeId: "ep01",
        task: task({
          async synthesize() {
            calls += 1;
            return { audio: Buffer.from("x") };
          }
        }, false)
      }),
      AuthorizationRequiredError
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("synthesize-narration 提交结果未知时禁止再次付费调用", async () => {
  const root = await setup();
  try {
    let uncertainCalls = 0;
    await assert.rejects(
      run({
        root,
        episodeId: "ep01",
        task: task({
          async synthesize() {
            uncertainCalls += 1;
            throw new Error("connection reset after submit");
          }
        })
      }),
      UnknownRemoteResultError
    );

    let retryCalls = 0;
    const changedTask = task({
      async synthesize() {
        retryCalls += 1;
        return { audio: Buffer.from("new") };
      }
    });
    changedTask.context.scriptPackage.narration = "乙。";
    await assert.rejects(
      run({
        root,
        episodeId: "ep01",
        task: changedTask
      }),
      UnknownRemoteResultError
    );
    changedTask.context.scriptPackage.narration = "甲。";
    await assert.rejects(
      run({ root, episodeId: "ep01", task: changedTask }),
      UnknownRemoteResultError
    );
    assert.equal(uncertainCalls, 1);
    assert.equal(retryCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧成功交付缺失只阻塞同一请求，新稿仍须付费授权", async () => {
  const root = await setup();
  try {
    let calls = 0;
    const current = task({ async synthesize() {
      calls += 1;
      return { audio: Buffer.from("audio") };
    } });
    await run({ root, episodeId: "ep01", task: current });
    const p2 = path.join(root, "ep01", "制作", "p2");
    await rm(path.join(p2, "raw-narration.flac"));
    await rm(path.join(p2, "tts-result.yaml"));
    assert.equal((await inspect({ root, episodeId: "ep01", task: current })).unknownExternal, true);
    await assert.rejects(run({ root, episodeId: "ep01", task: current }), UnknownRemoteResultError);
    current.context.scriptPackage.narration = "乙。";
    const state = await inspect({ root, episodeId: "ep01", task: current });
    assert.equal(state.paidCallRequired, true);
    assert.equal(state.unknownExternal, undefined);
    current.context.paidTtsAuthorized = false;
    await assert.rejects(run({ root, episodeId: "ep01", task: current }), AuthorizationRequiredError);
    assert.equal(calls, 1);
    current.context.paidTtsAuthorized = true;
    const result = await run({ root, episodeId: "ep01", task: current });
    assert.equal(result.ttsInput.text, "乙。");
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
