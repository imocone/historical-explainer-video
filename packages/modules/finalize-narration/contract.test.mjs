import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { executeProgramNode } from "../../../engine/runtime/program-execution.mjs";
import { atomicWriteData, fileSha256, readData, sha256 } from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { withMediaResources } from "../render-video/runtime/media-process.mjs";
import { inspect, run } from "./run.mjs";
import { projectSpeechCues } from '../author-subtitles/subtitle-timing.mjs';

const directory = fileURLToPath(new URL("./", import.meta.url));
const deliveries = ["narration.txt", "narration.mp3", "narration.srt", "subtitle-quality.yaml", "narration-package.yaml"];
const exists = (file) => access(file).then(() => true, () => false);
const snapshot = (p2) => Promise.all(deliveries.map(name => readFile(path.join(p2, name), "utf8")));

const fixture = async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "finalize-narration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = getEpisodePaths(root, "ep01");
  const work = getStageWorkPaths(paths, "p2");
  await mkdir(work.work, { recursive: true });
  const raw = Buffer.from("offline raw audio");
  await writeFile(paths.rawNarration, raw);
  const narration = "甲。";
  const audioSha256 = sha256(raw);
  const state = { encodes: 0, encoded: "offline encoded audio" };
  const task = {
    moduleId: "finalize-narration", nodeId: "finalize-narration", taskDigest: "a".repeat(64), inputHashes: [],
    inputs: {
      scriptPackage: { episodeId: "ep01", narration },
      ttsResult: { episodeId: "ep01", seriesTitle: "离线夹具", language: "zh-CN",
        ttsInput: { text: narration }, rawAudio: { path: "raw-narration.flac", sha256: audioSha256 },
        nativeTiming: { source: "provider-native", provider: "minimax", granularity: "word",
          cues: [{ text: "甲", startMs: 0, endMs: 1000 }] } },
      subtitleCorrection: { schemaVersion: "3.0", episodeId: "ep01", language: "zh-CN",
        narrationSha256: sha256(narration), maxContentChars: 32,
        cues: [{ text: narration, startMs: 0, endMs: 1000 }],
        evidence: { audioSha256, operations: ["system:narration-segmentation", "system:narration-projection",
          "translation:disabled", "codex:subtitle-review"],
          timingSource: { kind: "provider-native", provider: "minimax", granularity: "word" } } }
    },
    context: { audioCodec: {
      async encode({ inputPath, outputPath }) {
        state.encodes += 1;
        assert.equal(await fileSha256(inputPath), audioSha256);
        await writeFile(outputPath, state.encoded);
      },
      async inspect({ audioPath }) {
        const format = audioPath.endsWith(".flac") ? "flac" : "mp3";
        return { durationSeconds: 1, sampleRate: 32000, channels: 1, integratedLufs: -18,
          truePeakDbTp: -2, codecName: format, formatName: format };
      }
    } }
  };
  return { root, paths, work, task, state, episodeId: "ep01" };
};

const fakeAudioTools = async (t, root) => {
  const bin = path.join(root, "bin"), log = path.join(root, "audio-commands.jsonl");
  const failure = path.join(root, "fail-encoding");
  await mkdir(bin);
  const script = `#!${process.execPath}
const { appendFileSync, existsSync, writeFileSync } = require("node:fs"), path = require("node:path");
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, args }) + "\\n");
if (command === "ffprobe") {
  const codec = args.at(-1).endsWith(".flac") ? "flac" : "mp3";
  console.log(JSON.stringify({ streams: [{ codec_type: "audio", codec_name: codec, sample_rate: "32000", channels: 1 }],
    format: { duration: "1", format_name: codec } }));
} else if (args.at(-1) === "-") {
  process.stderr.write(JSON.stringify({ input_i: "-18", input_tp: "-2" }));
} else {
  if (existsSync(${JSON.stringify(failure)})) process.exit(2);
  writeFileSync(args.at(-1), "protected encoded audio");
}
`;
  for (const command of ["ffmpeg", "ffprobe"]) await writeFile(path.join(bin, command), script, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ""}`;
  t.after(() => { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath; });
  return { log, failure };
};

test("默认音频入口等待共享队列，限制线程，失败保留旧交付", async (t) => {
  const f = await fixture(t), tools = await fakeAudioTools(t, f.root);
  delete f.task.context.audioCodec;
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const holder = withMediaResources(async () => { entered(); await gate; }, { inspect: async () => {} });
  await Promise.race([ready, holder]);
  const pending = run(f);
  pending.catch(() => {});
  try {
    const deadline = Date.now() + 3000;
    while (!(await readdir(f.work.work)).some(name => name.startsWith(".finalize-narration-stage-"))) {
      assert.ok(Date.now() < deadline, "音频收口未进入临时交付目录");
      await delay(20);
    }
    await delay(100);
    assert.equal(await exists(tools.log), false, "队列占用期间不得启动音频进程");
  } finally {
    release();
    await Promise.allSettled([holder, pending]);
  }
  assert.equal((await pending).durationMs, 1000);
  assert.equal((await inspect(f)).valid, true);
  const commands = (await readFile(tools.log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(commands.map(item => item.command), ["ffmpeg", "ffprobe", "ffmpeg", "ffprobe", "ffmpeg"]);
  for (const { args } of commands.filter(item => item.command === "ffmpeg")) {
    assert.equal(args[args.indexOf("-threads") + 1], "2");
    assert.equal(args[args.lastIndexOf("-threads") + 1], "2");
    assert.equal(args[args.indexOf("-filter_threads") + 1], "1");
  }
  const before = await snapshot(f.paths.p2);
  await writeFile(tools.failure, "fail");
  await assert.rejects(run(f), /ffmpeg.*退出码 2/u);
  assert.deepEqual(await snapshot(f.paths.p2), before);
  assert.equal((await readdir(f.work.work)).some(name => name.startsWith(".finalize-") || name === "finalize-transaction.yaml"), false);
});

test("同源音频正常交付，模块不删除公共控制与恢复文件", async (t) => {
  const f = await fixture(t);
  const controls = [".program-execution.lock", "program-execution.yaml", "return-other.yaml", "tts-intent.yaml"];
  for (const name of controls) await writeFile(path.join(f.work.work, name), name);
  const result = await run(f);
  assert.equal(f.state.encodes, 1);
  assert.equal(result.schemaVersion, "1.1");
  assert.equal((await inspect(f)).valid, true);
  for (const name of controls) assert.equal(await readFile(path.join(f.work.work, name), "utf8"), name);
  assert.equal((await readdir(f.work.work)).some(name => name.startsWith(".finalize-") || name === "finalize-transaction.yaml"), false);
});

test('原生与ASR短语时间沿既有P2交付绑定最终音轨，重复词分别保留', async t => {
  for (const kind of ['provider-native', 'video-captioner-asr']) {
    await t.test(kind, async t => {
      const f = await fixture(t), text = '关门，再开门。';
      const words = [{text:'关',startMs:0,endMs:100},{text:'门',startMs:100,endMs:300},
        {text:'再',startMs:400,endMs:550},{text:'开',startMs:550,endMs:750},{text:'门',startMs:750,endMs:1000}];
      f.task.inputs.scriptPackage.narration = text;
      f.task.inputs.ttsResult.ttsInput.text = text;
      f.task.inputs.ttsResult.nativeTiming.cues = words;
      const correction = f.task.inputs.subtitleCorrection;
      correction.narrationSha256 = sha256(text);
      correction.cues = [{text,startMs:0,endMs:1000}];
      if (kind === 'video-captioner-asr') {
        delete f.task.inputs.ttsResult.nativeTiming;
        correction.evidence.operations.push('transcribe:bijian');
        correction.evidence.timingSource = {kind,provider:'video-captioner',granularity:'word',
          requestedModel:'BIJIAN',actualModel:'BIJIAN',fallbackOccurred:false,
          wordCues:words,nativeTimingIssue:'本例没有原生时间'};
      }
      const result = await run(f);
      const quality = await readData(path.join(f.paths.p2,'subtitle-quality.yaml'));
      assert.equal(quality.speechTiming.audioSha256, result.files.audio.sha256);
      assert.deepEqual(quality.speechTiming.cues[0].phrases.map(p=>[p.text,p.startMs,p.endMs]),
        [['关',0,100],['门，',100,300],['再',400,550],['开',550,750],['门。',750,1000]]);
      assert.equal((await inspect(f)).valid,true);
      if (kind === 'provider-native') {
        delete quality.speechTiming;
        const qualityFile=path.join(f.paths.p2,'subtitle-quality.yaml');
        await atomicWriteData(qualityFile,quality);
        const manifestFile=path.join(f.paths.p2,'narration-package.yaml');
        const manifest=await readData(manifestFile);
        manifest.evidence.subtitleQuality.sha256=await fileSha256(qualityFile);
        await atomicWriteData(manifestFile,manifest);
        assert.equal((await inspect(f)).valid,true,'缺少可选细时间不使已有有效交付失效');
      }
    });
  }
});

test('识别差异只映射实际可用的整块时间，不在一个词内均摊', () => {
  const text = '银行现钞并不等于全部资产。';
  const projected = projectSpeechCues({narration:text,cues:[{text,startMs:0,endMs:1200}],
    allowRecognitionDifferences:true, wordCues:[{text:'银行',startMs:0,endMs:200},
      {text:'现金',startMs:200,endMs:400},{text:'并不等于',startMs:400,endMs:800},
      {text:'全部资产',startMs:800,endMs:1200}]});
  assert.deepEqual(projected[0].phrases[1],{text:'现钞',startMs:200,endMs:400});
  assert.equal(projected[0].phrases.length,4);
});

test("缺失或改变的raw绑定在编码前停止，保留全部旧交付", async (t) => {
  for (const failure of ["missing-file", "missing-digest", "changed-audio"]) {
    await t.test(failure, async (t) => {
      const f = await fixture(t);
      await run(f);
      const before = await snapshot(f.paths.p2);
      f.state.encodes = 0;
      if (failure === "missing-file") await rm(f.paths.rawNarration);
      else if (failure === "missing-digest") delete f.task.inputs.ttsResult.rawAudio.sha256;
      else await writeFile(f.paths.rawNarration, "different raw audio");
      await assert.rejects(run(f), /原始口播音频(?:缺失|摘要与TTS结果不一致)/u);
      assert.equal(f.state.encodes, 0);
      assert.deepEqual(await snapshot(f.paths.p2), before);
    });
  }
});

test("正式Engine入口保留共享返工，收口后传播实际交付变化", async (t) => {
  const f = await fixture(t);
  await run(f);
  f.state.encoded = "updated offline audio";
  const requestPath = f.work.returnRequest("finalize-narration");
  const unrelatedRequest = f.work.returnRequest("author-subtitles");
  const request = { target: "finalize-narration", reason: "当前交付返工", cueRefs: [] };
  const unrelated = { target: "author-subtitles", reason: "独立待办", cueRefs: [] };
  await atomicWriteData(requestPath, request);
  await atomicWriteData(unrelatedRequest, unrelated);
  const controller = await readData(path.join(directory, "controller.json"));
  const current = {
    record: { directory, manifest: await readData(path.join(directory, "package.yaml")),
      resourcesByPath: new Map([["controller.json", { content: controller }]]) },
    node: { id: "finalize-narration" }, invocation: { episodeId: "ep01" },
    outputPath: f.paths.narrationPackage, returnRequestPath: requestPath,
    taskDigest: f.task.taskDigest, inputHashes: [], context: f.task.context,
    base: { stageId: "p2", resolvedAssembly: { slots: [] }, resolvedRules: [],
      outputContract: {source:"contracts/narration-package.schema.json",
        sha256:await fileSha256(path.resolve(directory,"../../../contracts/narration-package.schema.json"))},
      entry: { sha256: await fileSha256(path.join(directory, "run.mjs")) }, inputs: f.task.inputs }
  };
  const result = await executeProgramNode({ root: path.resolve(directory, "../../.."), workspaceRoot: f.root, current });
  assert.equal(result.files.audio.sha256, sha256(f.state.encoded));
  assert.deepEqual(await readData(unrelatedRequest), unrelated);
  assert.equal(await exists(requestPath), false);
  for (const [stage, node] of [["p3", "understand"], ["p4", "opener"], ["p4", "render"]]) {
    const repair = await readData(getStageWorkPaths(f.paths, stage).returnRequest(node));
    assert.equal(repair.target, node);
    assert.match(repair.reason, /口播交付发生实际修改/u);
  }
  assert.equal(await exists(path.join(f.work.work, ".program-execution.lock")), false);
  assert.equal(await exists(path.join(f.work.work, "program-execution.yaml")), false);
});

test("交付提升中断恢复旧文件，不删除公共控制", async (t) => {
  const f = await fixture(t);
  await run(f);
  const before = await snapshot(f.paths.p2);
  const marker = path.join(f.work.work, "return-other.yaml");
  await writeFile(marker, "保留原控制");
  f.state.encoded = "replacement offline audio";
  f.task.context.promoteFile = async (source, target, { index }) => {
    if (index === 2) throw new Error("离线提升中断");
    await rename(source, target);
  };
  await assert.rejects(run(f), /离线提升中断/u);
  assert.deepEqual(await snapshot(f.paths.p2), before);
  assert.equal(await readFile(marker, "utf8"), "保留原控制");
  assert.equal((await inspect(f)).valid, true);
  assert.equal((await readdir(f.work.work)).some(name => name.startsWith(".finalize-") || name === "finalize-transaction.yaml"), false);
});
