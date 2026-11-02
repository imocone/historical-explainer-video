import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fileSha256, hashObject, sha256 } from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { parseSrt } from "../../../engine/p3-input.mjs";
import { generate, generateBatch, recoverSourceOnce } from "./generate.mjs";
import { assertVideoFile, probe, selectPartRequest, validateProductionReceipts } from "./delivery.mjs";
import { videoPromptFor, videoRequestFor } from "../../templates/cinematic-video/asset-contract.mjs";
import { validate as validateVideoPlan } from "../../templates/cinematic-video/validate.mjs";

const systemRoot = fileURLToPath(new URL("../../../", import.meta.url));
const write = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};

const fixture = async (t, width, height, changedImage = false, { split = false, connection, spanCount = 1 } = {}) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "video-first-frame-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const paths = getEpisodePaths(workspace, "ep01"), work = getStageWorkPaths(paths, "p4", null, "video-assets");
  const lines = Array.from({ length: spanCount }, () => "来客站在门外等待。");
  const text = lines.join("\n");
  const timestamp = seconds => "00:00:" + String(seconds).padStart(2, "0") + ",000";
  const subtitles = lines.map((line, index) =>
    (index + 1) + "\n" + timestamp(index * (split ? 14 : 6)) + " --> " + timestamp((index + 1) * (split ? 14 : 6)) + "\n" + line + "\n").join("\n");
  await write(paths.narrationText, text);
  await write(paths.narrationSubtitles, subtitles);
  await write(paths.narrationPackage, { files: {
    narration: { path: "narration.txt", sha256: sha256(text) },
    subtitles: { path: "narration.srt", sha256: sha256(subtitles) }
  } });
  await write(paths.sourceAssets, { assets: [] });
  const storyboard = { beats: lines.map((_, index) => ({
    id: "B" + String(index + 1).padStart(3, "0"), cueRange: [index + 1, index + 1],
    templateId: "fullframe-narrative", treatment: { templateId: "fullframe-narrative" }
  })) };
  await write(paths.storyboard, storyboard);
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=2x2",
    "-vf", `scale=${width}:${height},format=rgb24`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"]);
  const spans = await Promise.all(lines.map(async (line, index) => {
    const id = "V" + String(index + 1).padStart(3, "0");
    const file = path.join(paths.p4, "assets", id, "start.png");
    await write(file, bytes);
    return { id, beatIds: [storyboard.beats[index].id], firstFramePrompt: line, mustNotInvent: [],
      shots: split ? [{ id: "S01", durationMs: 5000 }, { id: "S02", durationMs: 9000 }] : [{ id: "S01", durationMs: 6000 }],
      parts: [{ shotIds: ["S01"], videoPrompt: "来客留在门外，等待中望向院门。" },
        ...(split ? [{ shotIds: ["S02"], videoPrompt: "来客继续在门外等待。", ...(connection ? { connection } : {}) }] : [])],
      asset: { file: path.relative(workspace, file), sha256: changedImage ? "0".repeat(64) : sha256(bytes), width, height }
    };
  }));
  const videoPlan = { episodeId: "ep01", templateId: "cinematic-video", spans };
  await write(paths.videoPlan, videoPlan);
  const source = "packages/templates/cinematic-video/asset-contract.mjs";
  const task = { subject: { id: "ep01" }, moduleId: "produce-video-assets", nodeId: "video-assets", stageId: "p4", runner: "ai",
    candidatePath: path.relative(workspace, work.candidate), inputs: { videoPlan: { content: videoPlan },
      storyboard: { content: storyboard }, cues: parseSrt(subtitles), visual: { id: "test", stylePrompt: "清楚墨线" } },
    resolvedAssembly: { slots: [{ implementations: [{ packageId: "cinematic-video",
      resources: [{ role: "assetContractEntry", source, sha256: sha256(await readFile(path.join(systemRoot, source))) }] }] }] }
  };
  await write(work.workOrder, { ...task, taskDigest: hashObject(task) });
  return { workspace, workOrderPath: work.workOrder, spanId: "V001" };
};

test("删除前段保留原视频ID，重复编号和正文倒序仍拒绝", async t => {
  const input = await fixture(t, 1672, 941, false, { spanCount: 2 });
  const task = JSON.parse(await readFile(input.workOrderPath, "utf8"));
  const plan = task.inputs.videoPlan.content;
  const context = { storyboard: task.inputs.storyboard.content, cues: task.inputs.cues, preview: true };
  const transition = { type: "dissolve", durationMs: 400, reason: "沿正文承接保留的视频" };
  const retained = { ...plan, spans: [plan.spans[1]], incomingTransitions: { V002: transition } };
  assert.deepEqual(validateVideoPlan({ result: retained, context }), []);
  const duplicate = { ...plan, spans: [plan.spans[0], { ...plan.spans[1], id: "V001" }] };
  assert.ok(validateVideoPlan({ result: duplicate, context }).some(error => error.includes("视频编号重复")));
  const reversed = { ...plan, spans: [...plan.spans].reverse() };
  assert.ok(validateVideoPlan({ result: reversed, context }).some(error => error.includes("顺序倒置")));
});

test("原尺寸16:9首图进入授权检查，不要求成片尺寸且不创建远端请求", async t => {
  for (const [width, height] of [[1672, 941], [1920, 1080], [1788, 1000]]) {
    const input = await fixture(t, width, height);
    await assert.rejects(generate(input), /首次生成需要当前P4首次付费授权标记/);
    const paths = getEpisodePaths(input.workspace, "ep01");
    await assert.rejects(readFile(path.join(paths.p4, "video/canvas.json")), { code: "ENOENT" });
  }
});

test("错误画幅和被替换的首图仍在提交前拒绝", async t => {
  await assert.rejects(generate(await fixture(t, 640, 640)), /首图画幅不符合生产来源合同/);
  await assert.rejects(generate(await fixture(t, 1672, 941, true)), /已接纳首图摘要不一致/);
});

const sourceVideo = async (directory, seconds = 4) => {
  const file = path.join(directory, `source-${seconds}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24',
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-an', file]);
  return file;
};

const provider = async (directory) => {
  const files = new Map();
  for (const seconds of [6, 10]) files.set(seconds, await sourceVideo(directory, seconds));
  const nodes = new Map(), resources = new Map(), submissions = new Map(), events = [];
  const value = (args, flag) => args[args.indexOf(flag) + 1];
  const call = async (args) => {
    const command = args.slice(0, 2).join(' ');
    events.push({ command, args });
    if (args[0] === 'version') return { data: { version: 'test' } };
    if (command === 'model find') return { data: { items: [{ model: 'seedance_2.0_fast_vip' }] } };
    if (command === 'canvas create') return { data: { project: { projectId: value(args, '--project-id'), webUrl: 'https://example.invalid/test' } } };
    if (command === 'resource upload') return { data: {} };
    if (command === 'node create') {
      if (args[2] === 'video' && args.includes('--mode')) {
        const id = value(args, '--node-id');
        const node = { id, ref: value(args, '--ref'), seconds: Number(value(args, '--duration')), resourceId: randomUUID() };
        nodes.set(id, node); resources.set(node.resourceId, node);
      }
      return { data: {} };
    }
    if (command === 'node quote') return { data: { totalMaxCredits: 1, items: [{ nodeId: value(args, '--node-id'), maxCredits: 1 }] } };
    if (command === 'node confirm') return { data: { creditConfirmationToken: 'test-only' } };
    if (command === 'node run') {
      const id = value(args, '--node-id'), submitId = value(args, '--submit-id');
      submissions.set(submitId, nodes.get(id));
      return { data: { items: [{ nodeId: id, submitId, state: 'accepted' }] } };
    }
    if (command === 'operation status') return { data: { state: 'completed', resources: [{ state: 'success', resourceId: submissions.get(args[2]).resourceId }] } };
    if (command === 'resource get') return { data: { type: 'video', status: 'success' } };
    if (command === 'resource download') {
      const output = value(args, '--output');
      await assert.rejects(stat(output), { code: 'ENOENT' });
      await copyFile(files.get(resources.get(args[2]).seconds), output);
      return { data: { path: output, size: (await stat(output)).size, sha256: await fileSha256(output) } };
    }
    throw new Error(`Unexpected external command: ${command}`);
  };
  return { call, events, nodes };
};

for (const trimmed of [false, true]) test(trimmed ? '剪后参考例外只提前处理和上传对应前组' : '普通链先原节点续接，全部生成后下载，单次编码交付', async t => {
  const input = await fixture(t, 1672, 941, false, { split: true,
    ...(trimmed ? { connection: { type: 'continue', trimReason: '前组剪点必须承接下一动作' } } : {}) });
  const remote = await provider(input.workspace);
  const output = await generate({ ...input, call: remote.call, authorizePaidGeneration: true });
  assert.equal(output.state, 'complete');
  const runs = remote.events.map((event, index) => event.command === 'node run' ? index : -1).filter(index => index >= 0);
  const downloads = remote.events.map((event, index) => event.command === 'resource download' ? index : -1).filter(index => index >= 0);
  const uploads = remote.events.filter(event => event.command === 'resource upload');
  assert.equal(runs.length, 2);
  assert.equal(downloads.length, 2);
  assert.equal(uploads.length, trimmed ? 2 : 1);
  if (trimmed) assert.ok(downloads[0] < runs[1]);
  else {
    assert.ok(downloads[0] > runs[1]);
    const [first, second] = [...remote.nodes.values()];
    assert.equal(second.ref, `node:${first.id}`);
  }
  await assertVideoFile({ file: path.join(input.workspace, output.clip.file), frameCount: 948, durationMs: 15800 });
  const task = JSON.parse(await readFile(input.workOrderPath));
  const candidate = JSON.parse(await readFile(path.join(input.workspace, task.candidatePath)));
  await validateProductionReceipts({ root: input.workspace, episodeId: 'ep01', result: candidate.result,
    videoPlan: task.inputs.videoPlan.content, storyboard: task.inputs.storyboard.content, cues: task.inputs.cues, visual: task.inputs.visual });
  const first = output.clip.parts[0];
  const receipt = JSON.parse(await readFile(path.join(input.workspace, 'ep01/制作/p4/video/V001/part-1', first.requestDigest, 'generation.json')));
  const media = await probe(path.join(input.workspace, receipt.source.file));
  assert.equal(media.streams[0].width, 1280);
  assert.equal(media.streams[0].avg_frame_rate, '24/1');
  const second = output.clip.parts[1];
  const nextReceipt = JSON.parse(await readFile(path.join(input.workspace, 'ep01/制作/p4/video/V001/part-2', second.requestDigest, 'generation.json')));
  const changedEdit = { ...receipt, part: { ...first, sha256: 'f'.repeat(64) } };
  const select = () => selectPartRequest({ receipts: [nextReceipt], proposedRequest: nextReceipt.request, previousReceipt: changedEdit });
  if (trimmed) assert.throws(select, /须单独授权/);
  else {
    assert.equal(select().receipt.submitId, nextReceipt.submitId);
    assert.throws(() => selectPartRequest({ receipts: [nextReceipt],
      proposedRequest: { ...nextReceipt.request, previousGeneration: { ...nextReceipt.request.previousGeneration, resourceId: randomUUID() } },
      previousReceipt: changedEdit }), /须单独授权/);
  }
});

test('下载已落位但记录丢失仍恢复同一资源；有完整记录时不再下载', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-download-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sample = await sourceVideo(root);
  const directory = path.join(root, 'part');
  await mkdir(directory);
  await copyFile(sample, path.join(directory, 'source.mp4'));
  let calls = 0;
  const download = async ({ resourceId, output }) => {
    assert.equal(resourceId, 'resource-1');
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await copyFile(sample, output); calls++;
    return { path: output, size: (await stat(output)).size, sha256: await fileSha256(output) };
  };
  const original = { state: 'generated', request: { partIndex: 1, seconds: 4, frameCount: 240 }, canvas: { resourceId: 'resource-1' } };
  const restored = await recoverSourceOnce({ root, directory, receipt: original, download });
  assert.equal(restored.receipt.state, 'complete');
  assert.equal(calls, 1);
  const retry = { ...restored.receipt, state: 'generated' };
  const repeated = await recoverSourceOnce({ root, directory, receipt: retry, download });
  assert.equal(repeated.receipt.state, 'complete');
  assert.equal(calls, 1);
});

test('续接已接入画布的原节点，不另建画布或跨画布引用', async t => {
  const input = await fixture(t, 1672, 941, false, { split: true });
  const remote = await provider(input.workspace);
  const stopped = new Error('已核对续接画布，在模拟付费前停止');
  let pending = true, sourceProject;
  const call = async (args, options) => {
    if (args[0] === 'operation' && pending) {
      pending = false;
      return { data: { state: 'running' } };
    }
    if (args[0] === 'node' && args[1] === 'create' && args[2] === 'video' && remote.nodes.size) {
      assert.equal(args[args.indexOf('--project-id') + 1], sourceProject);
      assert.equal(args[args.indexOf('--ref') + 1], `node:${[...remote.nodes.keys()][0]}`);
      throw stopped;
    }
    return remote.call(args, options);
  };
  assert.equal((await generate({ ...input, call, authorizePaidGeneration: true })).state, 'pending');
  const canvasFile = path.join(getEpisodePaths(input.workspace, 'ep01').p4, 'video/canvas.json');
  sourceProject = JSON.parse(await readFile(canvasFile)).projectId;
  // 接入来源保有原分次身份，不要求本集canvas.json与它同属一个画布。
  await rm(canvasFile);
  await assert.rejects(generate({ ...input, call, authorizePaidGeneration: true }), error => error === stopped);
  assert.equal(remote.events.filter(({ command }) => command === 'canvas create').length, 1);
  assert.equal(remote.events.filter(({ command }) => command === 'node run').length, 1);
});

test('换场提示不强迫沿用旧人物，同场提示仍保持动作续接', () => {
  const part = { index: 2, generationSeconds: 5, bodyFrameCount: 300, headHandleFrames: 0, tailHandleFrames: 0, videoPrompt: '进入新院落。' };
  const visual = { id: 'test', stylePrompt: '墨线' };
  assert.match(videoPromptFor({}, part, visual), /人物外观与动作方向/);
  const cut = videoPromptFor({}, { ...part, connection: { type: 'cut' } }, visual);
  assert.match(cut, /明确剪切/);
  assert.doesNotMatch(cut, /沿用该视频的.*人物/);
});

test('接出余量缩短只重剪已完成原片，动作、正文时钟和真实前片仍须一致', () => {
  const visual = { id: 'test', stylePrompt: '墨线' };
  const part = { index: 2, generationSeconds: 7, bodyFrameCount: 300, headHandleFrames: 0,
    tailHandleFrames: 90, videoPrompt: '来客继续在门外等待。' };
  const request = { episodeId: 'ep01', spanId: 'V001', partIndex: 2, firstFrameSha256: 'image',
    prompt: videoPromptFor({}, part, visual), designDigest: 'original-description', frameCount: 390,
    seconds: 7, model: 'test', resolution: '720p', previousPartSha256: 'previous', previousPartRequestDigest: 'parent' };
  const receipt = { requestDigest: 'original', submitId: 'paid-original', state: 'complete', request,
    source: { frameCount: 420 } };
  const proposedRequest = { ...request, frameCount: 354, seconds: 6,
    prompt: videoPromptFor({}, { ...part, generationSeconds: 6, tailHandleFrames: 54 }, visual) };
  const previousReceipt = { requestDigest: 'parent', part: { sha256: 'previous' } };
  const select = (proposed = proposedRequest, original = receipt) => selectPartRequest({
    receipts: [original], proposedRequest: proposed, previousReceipt });
  assert.equal(select().receipt.submitId, 'paid-original');
  assert.equal(select().request, request);
  const generated = { ...receipt, state: 'generated', source: undefined };
  assert.equal(select(proposedRequest, generated).receipt?.submitId, 'paid-original');
  assert.equal(select({ ...proposedRequest, prompt: proposedRequest.prompt.replace('继续在门外等待', '推开院门') }).receipt, null);
  assert.equal(select({ ...proposedRequest, prompt: videoPromptFor({}, { ...part, bodyFrameCount: 299 }, visual) }).receipt, null);
  assert.equal(select(proposedRequest, { ...receipt, source: { frameCount: 353 } }).receipt, null);
  assert.throws(() => selectPartRequest({ receipts: [receipt], proposedRequest,
    previousReceipt: { ...previousReceipt, part: { sha256: 'changed' } } }), /须单独授权/);
  for (const state of ['failed', 'pending']) {
    const replacementRequest = { ...request, replacesRequestDigest: receipt.requestDigest };
    const replacement = { ...receipt, request: replacementRequest,
      requestDigest: hashObject(replacementRequest), submitId: 'paid-replacement' };
    const selected = selectPartRequest({ receipts: [{ ...receipt, state, source: undefined }, replacement],
      proposedRequest, previousReceipt });
    assert.equal(selected.receipt.submitId, 'paid-replacement');
    assert.equal(selected.request, replacementRequest);
  }
});

test('只缩短余量可复用；禁造、画风或镜头设计变化不能复用旧片', () => {
  const visual = { id: 'test', stylePrompt: '墨线' }, span = { id: 'V001', mustNotInvent: [] };
  const part = { index: 1, generationSeconds: 7, bodyFrameCount: 300, headHandleFrames: 0,
    tailHandleFrames: 90, frameCount: 390, videoPrompt: '来客等待。',
    shots: [{ id: 'S01', durationMs: 5000, frameCount: 300, purpose: '看清等待' }] };
  const input = { episodeId: 'ep01', span, part, firstFrameSha256: 'a'.repeat(64), visual };
  const request = videoRequestFor(input);
  const receipt = { state: 'complete', request, requestDigest: hashObject(request),
    submitId: 'paid-original', source: { frameCount: 420 } };
  const shortened = { ...part, generationSeconds: 6, tailHandleFrames: 54, frameCount: 354 };
  const propose = changes => videoRequestFor({ ...input, part: shortened, ...changes });
  const select = proposedRequest => selectPartRequest({ receipts: [receipt], proposedRequest });
  assert.equal(request.designDigest, propose({}).designDigest);
  assert.equal(select(propose({})).receipt.submitId, 'paid-original');
  for (const changes of [{ span: { ...span, mustNotInvent: ['不能出现火炮'] } },
    { visual: { ...visual, stylePrompt: '纸拼贴' } },
    { part: { ...shortened, shots: [{ ...part.shots[0], purpose: '看清递交信件' }] } }]) {
    assert.equal(select(propose(changes)).receipt, null);
  }
});

test('远端未知只保留原编号，不下载或重投', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-unknown-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receipt = { state: 'pending', submitId: 'original-submit', request: { partIndex: 1 }, canvas: {} };
  const result = await recoverSourceOnce({ root, directory: root, receipt, remoteOnly: true,
    statusFor: async () => ({ pending: true, queueStatus: null }),
    download: async () => { throw new Error('Unknown generation must not download'); } });
  assert.equal(result.pending.submitId, 'original-submit');
  assert.equal(result.receipt.state, 'pending');
});

const batchContext = () => ({ task: { candidatePath: "candidate.json" },
  videoPlan: { spans: [{ id: "V001" }, { id: "V002" }] } });

for (const code of ["MEDIA_CANCELLED", "MEDIA_RESOURCE_STOPPED"]) {
  test("视频批次遇" + code + "立即退出，不推进下一段", async () => {
    const calls = [], stopped = Object.assign(new Error("本次媒体任务停止"), { code });
    await assert.rejects(generateBatch({ context: batchContext(), authorizePaidGeneration: true,
      produce: async ({ spanId }) => { calls.push(spanId); throw stopped; }
    }), error => error === stopped);
    assert.deepEqual(calls, ["V001"]);
  });
}

test("普通单段故障仍独立推进，保留后段原远端身份与授权范围", async () => {
  const calls = [];
  const result = await generateBatch({ context: batchContext(), produce: async ({ spanId, authorizePaidGeneration }) => {
    calls.push([spanId, authorizePaidGeneration]);
    if (spanId === "V001") throw new Error("原段已有技术故障");
    return { state: "pending", queueStatus: "running", submitId: "existing-submit" };
  } });
  assert.deepEqual(calls, [["V001", false], ["V002", false]]);
  assert.deepEqual(result.spans, [
    { spanId: "V001", state: "blocked", message: "原段已有技术故障" },
    { spanId: "V002", state: "pending", queueStatus: "running", submitId: "existing-submit" }
  ]);
  assert.equal(result.candidatePath, "candidate.json");
});

test("无付费授权的实际批次逐段blocked，不创建画布；单段参数边界保留", async t => {
  const { spanId, ...input } = await fixture(t, 1672, 941, false, { spanCount: 2 });
  const result = await generate({ ...input, all: true });
  assert.deepEqual(result.spans.map(({ spanId, state }) => [spanId, state]), [["V001", "blocked"], ["V002", "blocked"]]);
  assert(result.spans.every(({ message }) => message.includes("首次生成需要当前P4首次付费授权标记")));
  const paths = getEpisodePaths(input.workspace, "ep01");
  await assert.rejects(readFile(path.join(paths.p4, "video/canvas.json")), { code: "ENOENT" });
  await assert.rejects(generate({ ...input, all: true, spanId }), /批次推进不能混用单段/);
  await assert.rejects(generate(input), /请使用all推进全部独立视频段/);
});
