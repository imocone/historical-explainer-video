import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { completeCandidate, validateAcceptance, projectResolvedQuotes } from "./batch.mjs";
import { prepareCalloutsForFrame } from "./render-plan.mjs";
import { CALLOUT_RENDER_POLICY } from "./render-policy.mjs";
import { projectTreatmentWithoutCallouts } from "./projection.mjs";

// Synthetic source records exercise the real closeout and display consumers without production.
const sourceId = "https://example.test/translation-fixture";
const sourceTitle = "引文翻译测试文书";
const request = { id: "B001", request: "测试文书中的具体说法", cueRange: ["C001", "C001"] };
const binding = { target: "AR001.callout.0", action: "show-callout", cueId: "C001", edge: "start" };
const inputs = {
  authorPhase: "quotes", quoteRequests: [request],
  cues: [{ id: "C001", text: "这是一段测试口播。" }]
};
const policy = {
  width: 1920, height: 1080, fps: 60, safeMarginX: 96, safeMarginY: 64,
  subtitleSafeAreaHeight: 260, callout: CALLOUT_RENDER_POLICY
};

const fixture = async (t, { originalText, text, passages }) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fullframe-quote-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const services = { workspaceRoot, task: { taskDigest: "translation-fixture", scratchPath: ".", inputs } };
  if (passages) {
    services.task.inputs = { ...inputs, notebookId: "test-notebook" };
    await writeFile(path.join(workspaceRoot, "historical-quote-query.json"), JSON.stringify({
      taskDigest: services.task.taskDigest, notebookId: "test-notebook", outcome: "completed", requests: inputs.quoteRequests,
      sources: [{ id: sourceId, title: sourceTitle }],
      response: { references: passages.map(cited_text => ({ source_id: sourceId, cited_text })) }
    }));
  } else {
    await writeFile(path.join(workspaceRoot, "historical-quote-sources.json"), JSON.stringify({
      sources: [{ url: sourceId, title: sourceTitle, text: `前文。${originalText}后文。` }]
    }));
  }
  const result = { items: [{ id: request.id, quote: {
    kind: "historical-quote", text, citation: `《${sourceTitle}》`, sourceId
  } }] };
  return { result, services };
};

const storyboard = () => ({
  beats: [{ id: request.id, cueRange: request.cueRange, treatment: {
    templateId: "fullframe-narrative",
    calloutGate: { "historical-quote": "reserved", "person-intro": "not-triggered", "term-gloss": "not-triggered" },
    assetRequests: [{ requestId: "AR001", callouts: [{
      kind: "historical-quote", request: request.request, anchorFocus: "测试焦点"
    }] }]
  } }],
  features: { "cue-sync": { bindings: { B001: { items: [binding] } } } }
});

for (const example of [
  { name: "外语译为中文", originalText: "No tax shall be imposed without the consent of the assembly.", text: "未经议会同意，不得征税。" },
  { name: "中文原句照录", originalText: "民为贵，社稷次之，君为轻。", text: "民为贵，社稷次之，君为轻。" }
]) {
  test(`${example.name}：原接纳链保存原句，下游只排印中文`, async (t) => {
    const { result, services } = await fixture(t, example);
    await completeCandidate({ result, services });
    assert.deepEqual(await validateAcceptance({ result, context: inputs, services }), []);
    assert.equal(result.items[0].quote.sourceTitle, sourceTitle);
    assert.match(result.items[0].quote.citedTextSha256, /^[a-f0-9]{64}$/u);

    const original = { ...storyboard(), authorQuotes: result };
    const projected = projectResolvedQuotes(original);
    const asset = projected.beats[0].treatment.assetRequests[0];
    const [display] = prepareCalloutsForFrame({
      request: asset, segmentId: request.id, policy,
      actionTimings: [{ target: binding.target, action: binding.action, frame: 60 }]
    });
    assert.equal(display.layout.lines.join(""), example.text);
    assert.equal(display.layout.citationDisplayText, `——《${sourceTitle}》`);
    assert.ok(result.receipt.response.references[0].cited_text.includes(example.originalText));
    assert.deepEqual(projected.features, original.features);
    assert.deepEqual(projectTreatmentWithoutCallouts(projected.beats[0].treatment),
      projectTreatmentWithoutCallouts(original.beats[0].treatment));
    assert.equal(original.beats[0].treatment.calloutGate["historical-quote"], "reserved");
  });
}

test("中文译文仍须绑定真实来源及原文记录", async (t) => {
  const { result, services } = await fixture(t, {
    originalText: "No tax, without consent; no levy, without a vote.", text: "未经同意不得征税，未经表决不得征收。"
  });
  await completeCandidate({ result, services });
  for (const [name, change] of [
    ["来源身份伪造", quote => { quote.sourceId = "https://example.test/other"; }],
    ["来源标题伪造", quote => { quote.sourceTitle = "其它文书"; }],
    ["来源摘要伪造", quote => { quote.citedTextSha256 = "0".repeat(64); }]
  ]) {
    const changed = structuredClone(result);
    change(changed.items[0].quote);
    assert.notDeepEqual(await validateAcceptance({ result: changed, context: inputs, services }), [], name);
  }
});

test("同源书名纠正按本次选择绑定，保留旧来源且拒绝伪造或含糊选择", async (t) => {
  const { services } = await fixture(t, { originalText: "有犯必惩。", text: "有犯必惩。" });
  const oldTitle = "测试文书旧记录", newTitle = "测试文书核实本";
  const original = "前文。有犯必惩。后文。";
  services.task.inputs = { ...inputs, retainedQuoteEvidence: {
    sources: [{ id: sourceId, title: oldTitle }],
    references: [{ source_id: sourceId, cited_text: original }]
  } };
  await writeFile(path.join(services.workspaceRoot, "historical-quote-sources.json"), JSON.stringify({
    sources: [{ url: sourceId, title: newTitle, text: original }]
  }));
  for (const explicit of [false, true]) {
    const result = { items: [{ id: request.id, quote: {
      kind: "historical-quote", text: "有犯必惩。", citation: `《${newTitle}》`, sourceId,
      ...(explicit ? { sourceTitle: newTitle } : {})
    } }] };
    await completeCandidate({ result, services });
    assert.deepEqual(await validateAcceptance({ result, context: services.task.inputs, services }), []);
    assert.equal(result.items[0].quote.sourceTitle, newTitle);
    assert.deepEqual(result.receipt.sources.map(item => item.title), [oldTitle, newTitle]);
    const forged = structuredClone(result);
    forged.items[0].quote.sourceTitle = "没有取得的文献";
    assert.notDeepEqual(await validateAcceptance({ result: forged, context: services.task.inputs, services }), []);
  }
  const ambiguous = { items: [{ id: request.id, quote: {
    kind: "historical-quote", text: "有犯必惩。", citation: "《测试文书》", sourceId
  } }] };
  await assert.rejects(completeCandidate({ result: ambiguous, services }), /多个文献标题.*sourceTitle/u);
  ambiguous.items[0].quote.sourceTitle = newTitle;
  await completeCandidate({ result: ambiguous, services });
  assert.deepEqual(await validateAcceptance({ result: ambiguous, context: services.task.inputs, services }), []);
  services.task.inputs = { ...inputs, retainedQuoteEvidence: {
    sources: ambiguous.receipt.sources, references: ambiguous.receipt.response.references
  } };
  await rm(path.join(services.workspaceRoot, "historical-quote-sources.json"));
  const reused = { items: [{ id: request.id, quote: {
    kind: "historical-quote", text: "有犯必惩。", citation: `《${newTitle}》`, sourceId
  } }] };
  await completeCandidate({ result: reused, services });
  assert.deepEqual(await validateAcceptance({ result: reused, context: services.task.inputs, services }), []);
  assert.equal(reused.items[0].quote.sourceTitle, newTitle);
  assert.deepEqual(reused.receipt.sources, ambiguous.receipt.sources);
});

test("同源多段译文按作者选定的原文绑定，不能默认取首段", async (t) => {
  const relevant = "No tax shall be imposed without the consent of the assembly.";
  const { result, services } = await fixture(t, {
    text: "未经议会同意，不得征税。", passages: ["The meeting was held on Monday.", relevant]
  });
  await assert.rejects(completeCandidate({ result, services }), /多段原文.*citedTextSha256/u);
  assert.equal(result.items[0].quote.citedTextSha256, undefined);

  // Execute the author's actual read-only selection command from the method.
  const method = await readFile(new URL("./references/historical-quote-method.md", import.meta.url), "utf8");
  const selectionCode = method.split("```javascript\n").map(block => block.split("\n```")[0])
    .find(block => block.includes("historical-quote-query.json或historical-quote-sources.json"));
  assert.ok(selectionCode);
  const list = execFileSync(process.execPath, ["--input-type=module", "-",
    path.join(services.workspaceRoot, "historical-quote-query.json"), sourceId],
  { input: selectionCode, encoding: "utf8" }).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(list.length, 2);
  const selected = list.find(item => item.text === relevant);
  result.items[0].quote.citedTextSha256 = selected.citedTextSha256;
  await completeCandidate({ result, services });
  assert.deepEqual(await validateAcceptance({ result, context: services.task.inputs, services }), []);
  assert.equal(result.items[0].quote.citedTextSha256, createHash("sha256").update(relevant).digest("hex"));
  const projected = projectResolvedQuotes({ ...storyboard(), authorQuotes: result });
  const [display] = prepareCalloutsForFrame({ request: projected.beats[0].treatment.assetRequests[0],
    segmentId: request.id, policy, actionTimings: [{ target: binding.target, action: binding.action, frame: 60 }] });
  assert.equal(display.layout.lines.join(""), "未经议会同意，不得征税。");
});

test("同源多段中文原句自动定位；重复的同一原文不要求重复选择", async (t) => {
  for (const example of [
    { text: "民为贵，社稷次之，君为轻。", passages: ["这是其它段落。", "前文。民为贵，社稷次之，君为轻。后文。"] },
    { text: "未经议会同意，不得征税。", passages: ["No tax without consent.", "No tax without consent."] }
  ]) {
    const { result, services } = await fixture(t, example);
    await completeCandidate({ result, services });
    assert.deepEqual(await validateAcceptance({ result, context: services.task.inputs, services }), []);
    assert.equal(result.items[0].quote.citedTextSha256,
      createHash("sha256").update(example.passages[1]).digest("hex"));
  }
});

test("取消引文保留其它框、正文和其它Cue绑定", async (t) => {
  const { result, services } = await fixture(t, { originalText: "测试原句。", text: "测试原句。" });
  result.items[0].quote = null;
  await writeFile(path.join(services.workspaceRoot, "historical-quote-sources.json"), JSON.stringify({ sources: [] }));
  await completeCandidate({ result, services });
  assert.deepEqual(await validateAcceptance({ result, context: inputs, services }), []);
  const original = { ...storyboard(), authorQuotes: result };
  const person = { kind: "person-intro", people: [{ name: "测试人物", brief: "参与当前事件" }], anchorFocus: "测试焦点" };
  original.beats[0].treatment.assetRequests[0].callouts.unshift(person);
  original.beats[0].treatment.calloutGate["person-intro"] = "required";
  const personBinding = { ...binding };
  original.features["cue-sync"].bindings.B001.items = [personBinding, { ...binding, target: "AR001.callout.1" }];
  const projected = projectResolvedQuotes(original);
  assert.deepEqual(projected.beats[0].treatment.assetRequests[0].callouts, [person]);
  assert.deepEqual(projected.features["cue-sync"].bindings.B001.items, [personBinding]);
  assert.deepEqual(projectTreatmentWithoutCallouts(projected.beats[0].treatment),
    projectTreatmentWithoutCallouts(original.beats[0].treatment));
});
