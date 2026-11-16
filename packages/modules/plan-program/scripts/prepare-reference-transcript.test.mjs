import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { readReferenceVideos } from "../../../reference-program.mjs";

const run = promisify(execFile);
const entry = fileURLToPath(new URL("./prepare-reference-transcript.mjs", import.meta.url));

test("真实字幕格式经本地入口转成P1可读取的完整底稿", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "p0-transcript-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = [
    { name: "srt", source: "1\r\n00:00:01,250 --> 00:00:03,000\r\n第一行\r\n仍属同一句。\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\nSecond line.\r\n",
      text: "第一行\n仍属同一句。\nSecond line.", times: [1250, 3000] },
    { name: "json3", source: JSON.stringify({ events: [{ tStartMs: 0 }, { tStartMs: 1250, dDurationMs: 1750, segs: [{ utf8: "原文" }, { utf8: "与细节。" }] },
      { tStartMs: 3000, dDurationMs: 500, segs: [{ utf8: "Next." }] }] }), text: "原文与细节。\nNext." },
    { name: "captioner.json", source: JSON.stringify({ "2": { start_time: 3000, end_time: 3500, original_subtitle: "Next.", translated_subtitle: "译文不冒充原文。" },
      "1": { start_time: 1250, end_time: 3000, original_subtitle: "原文与细节。", translated_subtitle: "" } }), text: "原文与细节。\nNext." }
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const input = path.join(directory, item.name);
    const output = path.join(directory, `${item.name}.transcript.json`);
    await writeFile(input, item.source);
    const { stdout } = await run(process.execPath, [entry, input, output]);
    const descriptor = JSON.parse(stdout);
    const manifest = path.join(directory, `${item.name}.manifest.json`);
    await writeFile(manifest, JSON.stringify({ videos: [{ id: item.name, transcript: descriptor }] }));
    const [video] = await readReferenceVideos({ path: manifest });
    assert.equal(video.transcript.text, item.text);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.audioReviewed, false);
    if (item.times) assert.deepEqual([saved.segments[0].startMs, saved.segments[0].endMs], item.times);
    if (item.name === "json3") assert.deepEqual(saved.segments, JSON.parse(item.source).events);
    if (item.name === "captioner.json") assert.deepEqual(saved.segments, [JSON.parse(item.source)["1"], JSON.parse(item.source)["2"]]);
    assert.equal(await readFile(input, "utf8"), item.source);
  });
});

test("转换失败不落伪底稿，也不覆盖已有底稿", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "p0-transcript-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "input.json3");
  const output = path.join(directory, "transcript.json");
  await writeFile(input, JSON.stringify({ events: [] }));
  await assert.rejects(run(process.execPath, [entry, input, output]), /没有可读取的完整文字/u);
  await assert.rejects(readFile(output), { code: "ENOENT" });
  await writeFile(input, JSON.stringify({ events: [{ segs: [{ utf8: "完整原文。" }] }] }));
  await writeFile(output, "已存在的校正底稿");
  await assert.rejects(run(process.execPath, [entry, input, output]), /EEXIST/u);
  assert.equal(await readFile(output, "utf8"), "已存在的校正底稿");
});
