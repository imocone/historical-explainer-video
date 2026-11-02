import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AuthorizationRequiredError,
  inspect,
  run,
  UnknownRemoteResultError
} from "./run.mjs";

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
