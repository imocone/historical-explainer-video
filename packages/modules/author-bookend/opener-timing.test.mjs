import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenerTimingService } from "./opener-timing.mjs";

test("片头卡点忽略零时长标点，仍拒绝零时长有声字词", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "opener-timing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, "words.json");
  const python = path.join(root, "captioner");
  await writeFile(python, `#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("jianying bijian --word-timestamps json");
} else if (args[args.indexOf("--asr") + 1] === "jianying") {
  process.exit(1);
} else {
  writeFileSync(args[args.indexOf("-o") + 1], readFileSync(${JSON.stringify(fixture)}));
}
`, { mode: 0o755 });
  const words = {
    1: { start_time: 40, end_time: 240, original_subtitle: "俄军" },
    2: { start_time: 240, end_time: 240, original_subtitle: "，" },
    3: { start_time: 240, end_time: 560, original_subtitle: "增援" }
  };
  await writeFile(fixture, JSON.stringify(words));
  const service = createOpenerTimingService({ root, python, workDir: path.join(root, "timing") });
  const request = { audioPath: path.join(root, "audio.mp3"),
    sentences: [{ target: "flashbackLine", text: "俄军增援" }] };
  const result = await service.time(request);
  assert.equal(result.evidence.actualModel, "BIJIAN");
  assert.deepEqual(result.sentenceCues, [{ target: "flashbackLine", text: "俄军增援",
    recognizedText: "俄军增援", startMs: 40, endMs: 560 }]);

  words[3].end_time = words[3].start_time;
  await writeFile(fixture, JSON.stringify(words));
  await assert.rejects(service.time(request), /词级时间无效/u);
});
