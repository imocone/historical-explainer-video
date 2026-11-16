import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../../program-utils.mjs";
import { buildSubtitleCandidate } from "./build-candidate.mjs";
import { alignWordTimeline } from "./subtitle-timing.mjs";
import { validate } from "./validate.mjs";

test("句界无法绑定时保留逐句位置、错误和其它句子的时间，作者可沿原入口合并", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "subtitle-inspection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = "ep01/制作/p2/_work", executionId = "a".repeat(64);
  await mkdir(path.join(root, parent), { recursive: true });
  const audio = Buffer.from("offline audio identity"), narration = "甲。乙。丙。";
  await writeFile(path.join(root, "ep01/制作/p2/raw-narration.flac"), audio);
  const inputs = {
    scriptPackage: { episodeId: "ep01", narration },
    ttsResult: { episodeId: "ep01", ttsInput: { text: narration },
      rawAudio: { path: "raw-narration.flac", sha256: sha256(audio) },
      nativeTiming: { source: "provider-native", provider: "minimax", granularity: "word",
        cues: [{ text: "甲乙", startMs: 0, endMs: 600 }, { text: "丙", startMs: 600, endMs: 1000 }] } }
  };
  const work = { runner: "ai", workflowId: "narration", stageId: "p2", nodeId: "author-subtitles",
    moduleId: "author-subtitles", taskDigest: "b".repeat(64), executionId,
    candidatePath: `${parent}/candidate.yaml`, scratchPath: `${parent}/attempt-${executionId}`, inputs };
  const workOrderPath = path.join(root, parent, "work-order.yaml");
  await writeFile(workOrderPath, JSON.stringify(work));
  const preview = await buildSubtitleCandidate({ workOrderPath, inspect: true });
  assert.equal(preview.bindingErrors.length, 1);
  assert.deepEqual(preview.sentencePreview.map(s => [s.sentence, s.text, s.contentStart, s.contentEnd]),
    [[1, "甲。", 0, 1], [2, "乙。", 1, 2], [3, "丙。", 2, 3]]);
  assert.match(preview.sentencePreview[0].bindingError, /同一词内部/);
  assert.equal(preview.sentencePreview[2].startMs, 600);
  assert.equal(preview.sentencePreview[2].endMs, 1000);
  await buildSubtitleCandidate({ workOrderPath, mergeAfter: [1] });
  const candidate = JSON.parse(await readFile(path.join(root, work.candidatePath), "utf8"));
  assert.deepEqual(candidate.result.cues, [
    { text: "甲。乙。", startMs: 0, endMs: 600 }, { text: "丙。", startMs: 600, endMs: 1000 }
  ]);
  // 夹具只验证正式接纳合同，不冒充实际作者复核。
  candidate.result.evidence.operations.push("codex:subtitle-review");
  assert.deepEqual(validate({ result: candidate.result, context: inputs }), []);
});

test("可用断点只包含真实词边界，排除识别词内部及跨条时间重叠", () => {
  const narration = "甲，乙丙。";
  const aligned = alignWordTimeline({ narration,
    wordCues: [{ text: "甲乙", startMs: 0, endMs: 500 }, { text: "丙", startMs: 500, endMs: 1000 }] });
  assert.deepEqual(aligned.timedBreaks, [2]);
  assert.throws(() => aligned.project(0, 1), /同一词内部/);
  const overlapping = alignWordTimeline({ narration: "甲乙。",
    wordCues: [{ text: "甲", startMs: 0, endMs: 520 }, { text: "乙", startMs: 500, endMs: 1000 }] });
  assert.deepEqual(overlapping.timedBreaks, []);
});
