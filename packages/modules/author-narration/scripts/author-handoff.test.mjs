import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hashObject } from "../../../program-utils.mjs";
import { authorHandoff } from "./author-handoff.mjs";
import { compactAcceptedNarrationMaterials } from "../../../../engine/p1-revision-materials.mjs";

test("获准只重试失败首稿，重复恢复且保留其它稿件和旧回包", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "author-route-retry-"));
  try {
    const base = "ep01/制作/p1/_work";
    const executionId = "a".repeat(64);
    const scratchPath = `${base}/attempt-${executionId}`;
    const scratch = path.join(root, scratchPath);
    await mkdir(scratch, { recursive: true });
    const task = { executionId, runner: "ai", workflowId: "narration", stageId: "p1",
      moduleId: "author-narration", nodeId: "author-narration", subject: { id: "ep01" },
      candidatePath: `${base}/candidate.yaml`, scratchPath };
    const taskDigest = hashObject(task);
    const work = path.join(root, base, "work-order.yaml");
    await writeFile(work, JSON.stringify({ ...task, taskDigest }));
    for (const route of [1, 2, 3]) await writeFile(path.join(scratch, `author-${route}.json`), JSON.stringify({
      taskDigest, phase: route === 2 ? "failed" : "received", result: route === 2 ? null : { narration: "保留" },
      factErrors: null, sessionId: route === 2 ? 42 : null, conversationId: null,
      ...(route === 2 ? { failure: "首稿机械交付失败" } : {}) }));
    const oldReceipt = path.join(scratch, "author-2.agy.json");
    await writeFile(oldReceipt, "原失败回包");
    const before = await Promise.all([1, 3].map(route => readFile(path.join(scratch, `author-${route}.json`), "utf8")));
    await assert.rejects(authorHandoff("retry", work, "2"), /明确授权/u);
    await assert.rejects(authorHandoff("retry", work, "1", "--authorize-retry"), /明确失败/u);
    const first = await authorHandoff("retry", work, "2", "--authorize-retry");
    assert.equal(first.started, true);
    assert.equal(first.receiptPath, path.join(scratch, "author-2.retry-1.agy.json"));
    const repeated = await authorHandoff("retry", work, "2", "--authorize-retry");
    assert.equal(repeated.started, false);
    assert.equal(repeated.receiptPath, first.receiptPath);
    assert.equal((await authorHandoff("start", work, "2")).receiptPath, first.receiptPath);
    await assert.rejects(authorHandoff("receive", work, "2", oldReceipt, "0"), /本次返回/u);
    const draft = JSON.parse(await readFile(path.join(scratch, "author-2.json"), "utf8"));
    assert.equal(draft.failures[0].failure, "首稿机械交付失败");
    assert.equal(draft.failures[0].sessionId, 42);
    assert.equal(await readFile(oldReceipt, "utf8"), "原失败回包");
    assert.deepEqual(await Promise.all([1, 3].map(route => readFile(path.join(scratch, `author-${route}.json`), "utf8"))), before);
    await writeFile(path.join(scratch, "author-2.json"), JSON.stringify({ ...draft, failures: [] }));
    await assert.rejects(authorHandoff("retry", work, "2", "--authorize-retry"), /全部结束/u);
    await writeFile(path.join(scratch, "author-2.json"), JSON.stringify(draft));
    await writeFile(path.join(scratch, "disposable.txt"), "临时文件");
    await compactAcceptedNarrationMaterials({ workspaceRoot: root, episodeId: "ep01", materialExecutionId: executionId });
    assert.equal(await readFile(oldReceipt, "utf8"), "原失败回包");
    assert.deepEqual(await Promise.all([1, 3].map(route => readFile(path.join(scratch, `author-${route}.json`), "utf8"))), before);
    await assert.rejects(readFile(path.join(scratch, "disposable.txt")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
