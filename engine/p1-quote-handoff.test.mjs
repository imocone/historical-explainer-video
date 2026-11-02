import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hashObject, readData, sha256, withoutProducer } from "../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths, getProgramPaths } from "../packages/workspace-paths.mjs";
import { runNext, acceptCandidate, deriveStatus } from "./runtime.mjs";
import { submitAuthorCandidate } from "../packages/modules/author-beat/submit.mjs";
import { authorHandoff } from "../packages/modules/author-narration/scripts/author-handoff.mjs";
import { compactAcceptedNarrationMaterials, readAcceptedNarrationEvidence } from "./p1-revision-materials.mjs";
import { loadStageModel } from "./runtime/model.mjs";
import { buildAuthorQuoteTask } from "./runtime/author-tasks.mjs";
import { projectP3TaskView } from "../packages/p3-task-view.mjs";
import { completeCandidate, validateAcceptance, projectResolvedQuotes, resolveQuoteDecisions } from "../packages/templates/fullframe-narrative/callout/batch.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
};

test("P1集中补读经原快照及收口进入P3，引文直接接纳且不改正文音频", async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p1-quote-handoff-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const episodeId = "ep01", executionId = "a".repeat(64);
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const work = getStageWorkPaths(paths, "p1");
  const scratch = path.join(work.work, `attempt-${executionId}`);
  const source = { source: "https://example.test/edict", title: "测试诏令", text: "此前获免。此后有犯，严加惩治。", locator: "第二段" };
  const querySource = { source: "primary-source", title: "测试奏议", text: "不可发兵。" };
  const base = { runner: "ai", workflowId: "narration", stageId: "p1", nodeId: "author-narration", moduleId: "author-narration",
    subject: { id: episodeId }, executionId, candidatePath: path.relative(workspaceRoot, work.candidate),
    scratchPath: path.relative(workspaceRoot, scratch), inputs: { episodeBrief: { programForm: "historical-explainer" }, programPlan: {} } };
  await write(work.workOrder, { ...base, taskDigest: hashObject(base) });
  const documentsFile = path.join(scratch, "documents.json");
  await write(documentsFile, [source, querySource]);
  await authorHandoff("prepare-reference", work.workOrder, documentsFile);
  await write(path.join(scratch, "notebook-query.json"), { references: [
    { source_id: "primary-source", citation_number: 1, cited_text: "不可发兵。" }
  ] });
  await write(paths.scriptPackage, { episodeId, narration: "此后再犯要受处罚。", _producer: { materialExecutionId: executionId } });
  await write(paths.narrationText, "此后再犯要受处罚。");
  await write(paths.narrationAudio, "existing-audio-fixture");
  const before = await Promise.all([paths.scriptPackage, paths.narrationText, paths.narrationAudio].map(file => readFile(file)));
  await compactAcceptedNarrationMaterials({ workspaceRoot, episodeId, materialExecutionId: executionId });
  await assert.rejects(readFile(documentsFile), { code: "ENOENT" });
  // An unrelated attempt must never become the material source.
  await write(path.join(work.work, `attempt-${"b".repeat(64)}`, "reference-materials.json"), { documents: [{ ...source, text: "错误来源。" }] });
  const model = await loadStageModel(root, { stageId: "p3" });
  const node = model.orderedNodes.find(item => item.id === "author");
  const manifest = await readData(path.join(root, "packages/modules/author-beat/package.yaml"));
  const controller = await readData(path.join(root, "packages/modules/author-beat/controller.json"));
  const assembly = { node, module: { id: "author-beat", manifest: {
    source: "packages/modules/author-beat/package.yaml", sha256: hashObject(manifest), content: manifest
  }, controllerEntry: { source: "packages/modules/author-beat/controller.json", sha256: hashObject(controller) } }, slots: [] };
  const binding = { target: "AR001.callout.0", action: "show-callout", cueId: 1, edge: "start" };
  const storyboard = { beats: [{ id: "B001", cueRange: [1, 1], treatment: {
    templateId: "fullframe-narrative", calloutGate: { "historical-quote": "reserved" },
    assetRequests: [{ requestId: "AR001", callouts: [{ kind: "historical-quote", request: "诏令如何处罚后来再犯者", anchorFocus: "文书" }] }]
  } }], features: { "cue-sync": { bindings: { B001: { items: [binding] } } } } };
  const task = await buildAuthorQuoteTask({ root, workspaceRoot, episodeId, model, node, assembly, storyboard,
    inspected: { cues: [{ id: 1, text: "此后再犯要受处罚。" }] }, programPlan: { researchLibrary: { notebookId: "test-notebook" } } });
  const order = task.createWorkOrder([]);
  const view = projectP3TaskView(order);
  assert.deepEqual(view.inputs.narrationEvidence.documents, [source, querySource]);
  assert.equal(view.inputs.narrationEvidence.queries[0].references[0].cited_text, "不可发兵。");
  const services = { workspaceRoot, task: order };
  for (const quote of [
    { kind: "historical-quote", text: "此后有犯，严加惩治。", citation: "《测试诏令》", sourceId: source.source },
    { kind: "historical-quote", text: "不可发兵。", citation: "《测试奏议》", sourceId: "primary-source" }
  ]) {
    const result = { items: [{ id: "B001", quote }] };
    await completeCandidate({ result, services });
    assert.deepEqual(await validateAcceptance({ result, context: order.inputs, services }), []);
    const projected = projectResolvedQuotes({ ...storyboard, authorQuotes: result });
    assert.equal(projected.beats[0].treatment.assetRequests[0].callouts[0].text, quote.text);
    assert.deepEqual(projected.features, storyboard.features);
    const forged = structuredClone(result);
    forged.items[0].quote.citedTextSha256 = "0".repeat(64);
    assert.notDeepEqual(await validateAcceptance({ result: forged, context: order.inputs, services }), []);
  }
  assert.deepEqual(await Promise.all([paths.scriptPackage, paths.narrationText, paths.narrationAudio].map(file => readFile(file))), before);
  const cancelled = { items: [{ id: "B001", quote: null }] };
  await completeCandidate({ result: cancelled, services });
  cancelled._producer = { moduleId: "author-beat", nodeId: "author", inputs: task.producerInputsForResult(cancelled), outputSha256: hashObject(cancelled) };
  const recut = structuredClone(storyboard);
  recut.authorQuotes = cancelled;
  recut.beats[0].id = "B002";
  recut.features["cue-sync"].bindings = { B002: { items: [binding] } };
  assert.equal(resolveQuoteDecisions(recut, order.inputs).get("B002")?.item.quote, null);
  assert.equal(resolveQuoteDecisions(recut, { ...order.inputs, notebookId: "other-notebook" }).has("B002"), false);
  assert.equal(resolveQuoteDecisions(recut, { ...order.inputs, cues: [{ id: 1, text: "已经改变的口播。" }] }).has("B002"), false);
  const changedRequest = structuredClone(recut);
  changedRequest.beats[0].treatment.assetRequests[0].callouts[0].request = "另一个事件的文书";
  assert.equal(resolveQuoteDecisions(changedRequest, order.inputs).has("B002"), false);
  const widened = structuredClone(recut);
  widened.beats[0].cueRange = [1, 2];
  assert.equal(resolveQuoteDecisions(widened, order.inputs).has("B002"), false);
  const revised = { items: [{ id: "B001", quote: { kind: "historical-quote", text: source.text,
    citation: "《测试诏令》", sourceId: source.source } }] };
  await completeCandidate({ result: revised, services });
  revised._producer = { moduleId: "author-beat", nodeId: "author", inputs: task.producerInputsForResult(revised), outputSha256: hashObject(revised) };
  recut.authorQuotes = { items: [], batches: [cancelled, revised] };
  assert.equal(resolveQuoteDecisions(recut, order.inputs).has("B002"), false, "后接纳的非空引文不能被旧取消决议盖过");
  // The signed source snapshot is consumed even after the retained file is no longer available.
  await rm(path.join(scratch, "reference-materials.json"));
  const result = { items: [{ id: "B001", quote: { kind: "historical-quote", text: "此后有犯，严加惩治。", citation: "《测试诏令》", sourceId: source.source } }] };
  await completeCandidate({ result, services });
  assert.deepEqual(await validateAcceptance({ result, context: order.inputs, services }), []);
});

test("正式引文接纳、局部重切保留原文与取消决议并交给P4", async t => {
  for (const [mode, existingQuote] of [
    ["documents", false], ["notebook", false], ["reference", false], ["reference+notebook", false],
    ["documents", true], ["notebook", true]
  ]) await t.test(`${mode}/${existingQuote ? "已有引文" : "取消决议"}`, async t => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "quote-engine-recovery-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const episodeId = "ep01", paths = getEpisodePaths(workspaceRoot, episodeId);
    const options = { root, workspaceRoot, episodeId, stageId: "p3" };
    const work = getStageWorkPaths(paths, "p3"), materialId = "c".repeat(64);
    const source = { source: "https://example.test/edict", title: "测试诏令", text: "此后有犯，严加惩治。" };
    const p1Sources = path.join(getStageWorkPaths(paths, "p1").work, `attempt-${materialId}`, "reference-materials.json");
    const visual = await readData(path.join(root, "visuals/meiji-state-machine/visual-package.json"));
    const program = { programForm: "historical-explainer", openerTemplate: "episode-opener",
      visualPackage: { visualPackageId: visual.id, version: visual.version },
      ...(mode.includes("notebook") ? { researchLibrary: { notebookId: "test-notebook" } } : {}) };
    if (mode.startsWith("reference")) {
      const transcript = path.join(workspaceRoot, "reference-transcript.json"), text = JSON.stringify({ text: "参考讲述。" });
      await write(transcript, text);
      program.referenceProgram = { path: path.join(workspaceRoot, "reference.json") };
      program.episodes = [{ episodeId, referenceVideoIds: ["reference-1"] }];
      await write(program.referenceProgram.path, { videos: [{ id: "reference-1", title: "测试参考节目",
        transcript: { path: transcript, sha256: sha256(text) } }] });
    }
    await write(getProgramPaths(workspaceRoot).programPlan, program);
    const narration = "第一段口播。\n第二段口播。";
    const subtitles = "1\n00:00:00,000 --> 00:00:06,000\n第一段口播。\n\n2\n00:00:06,000 --> 00:00:12,000\n第二段口播。\n";
    await write(paths.narrationText, narration);
    await write(paths.narrationSubtitles, subtitles);
    await write(paths.narrationPackage, { episodeId, durationMs: 12000, files: {
      narration: { path: "narration.txt", sha256: sha256(narration) }, subtitles: { path: "narration.srt", sha256: sha256(subtitles) } } });
    await write(paths.scriptPackage, { narration, _producer: { materialExecutionId: materialId } });
    await write(p1Sources, { documents: [source] });
    await write(paths.openerNarration, { openerNarration: "变化意味着什么？" });
    await write(paths.sourceAssets, { schemaVersion: "1.0", assets: [] });
    const beat = (id, cue, reserved) => ({ id, cueRange: [cue, cue], templateId: "fullframe-narrative", treatment: {
      templateId: "fullframe-narrative", calloutGate: { "historical-quote": reserved ? "reserved" : "not-triggered" },
      assetRequests: [{ requestId: "AR001", ...(reserved ? { callouts: [
        { kind: "historical-quote", request: `第${cue}段的史料记载`, anchorFocus: "文书" }
      ] } : {}) }] } });
    const bindings = id => ({ items: [{ target: "AR001.callout.0", action: "show-callout", cueId: id, edge: "start" }] });
    await write(paths.storyboard, { understanding: {}, albumPlan: {},
      beats: [beat("B001", 1, true), beat("B003", 2, false)],
      templateRuns: [{ id: "TR001", templateId: "fullframe-narrative", beatIds: ["B001", "B003"] }],
      features: { "cue-sync": { bindings: { B001: bindings(1), B003: { items: [] } } } } });
    const p3Source = { source: mode === "notebook" ? "primary-p3-source" : "https://example.test/p3-primary",
      title: "测试原典", text: "后有再犯，依法惩治。" };
    const acceptQuote = async (quote, source = null) => {
      await runNext(options);
      const order = await readData(work.workOrder);
      if (source) {
        const scratch = path.join(workspaceRoot, order.scratchPath);
        if (mode === "notebook") await write(path.join(scratch, "historical-quote-query.json"), {
          taskDigest: order.taskDigest, notebookId: order.inputs.notebookId, requests: order.inputs.quoteRequests,
          outcome: "completed", sources: [{ id: source.source, title: source.title }],
          response: { references: [{ source_id: source.source, cited_text: source.text }] }
        });
        else await write(path.join(scratch, "historical-quote-sources.json"), {
          sources: [{ url: source.source, title: source.title, text: source.text }]
        });
      }
      await write(work.candidate, { taskDigest: order.taskDigest, result: { items: [quote] } });
      await submitAuthorCandidate({ workOrderPath: work.workOrder, candidatePath: work.candidate, workspace: workspaceRoot, episode: episodeId });
      await acceptCandidate(options);
    };
    const reuseQuote = id => ({ id, quote: { kind: "historical-quote", text: p3Source.text,
      citation: "《测试原典》", sourceId: p3Source.source } });
    await acceptQuote(existingQuote ? reuseQuote("B001") : { id: "B001", quote: null }, existingQuote ? p3Source : null);
    // Model the existing Director acceptance: changed IDs retain their signed original batch.
    let story = await readData(paths.storyboard);
    const originalBatch = structuredClone(story.authorQuotes);
    story.beats[0].id = "B002";
    story.templateRuns[0].beatIds[0] = "B002";
    story.features["cue-sync"].bindings = { B002: bindings(1), B003: { items: [] } };
    story.authorQuotes.items = [];
    story.authorQuotes.batches = [originalBatch];
    story.authorQuotes._producer.outputSha256 = hashObject(withoutProducer(story.authorQuotes));
    await write(paths.storyboard, story);
    if (existingQuote) {
      // The author must judge the new display, using the already accepted original text.
      await runNext(options);
      const order = await readData(work.workOrder);
      assert.deepEqual(order.inputs.quoteRequests.map(item => item.id), ["B002"]);
      const view = projectP3TaskView(order);
      assert.ok(view.inputs.retainedQuoteEvidence.sources.some(item => item.id === p3Source.source && item.title === p3Source.title));
      assert.ok(view.inputs.retainedQuoteEvidence.references.some(item => item.source_id === p3Source.source && item.cited_text === p3Source.text));
      for (const name of ["historical-quote-sources.json", "historical-quote-query.json"]) {
        await assert.rejects(readFile(path.join(workspaceRoot, order.scratchPath, name)), { code: "ENOENT" });
      }
      await acceptQuote(reuseQuote("B002"));
      story = await readData(paths.storyboard);
      assert.ok(story.authorQuotes.batches.some(batch => hashObject(batch) === hashObject(originalBatch)));
      assert.equal(story.authorQuotes.items.find(item => item.id === "B002").quote.sourceTitle, p3Source.title);
      const priorBatches = structuredClone(story.authorQuotes.batches);
      // Correct the title for this same source through the existing quote-revision entry.
      const corrected = { ...p3Source, title: "测试原典核实本" };
      await runNext({ ...options, reviseQuotes: true, redesignBeatIds: ["B002"], revisionReason: "纠正本条引文的实际文献书名" });
      await acceptQuote({ id: "B002", quote: { ...reuseQuote("B002").quote, citation: `《${corrected.title}》`,
        ...(mode === "notebook" ? { sourceTitle: corrected.title } : {}) } }, corrected);
      story = await readData(paths.storyboard);
      assert.equal(story.authorQuotes.items.find(item => item.id === "B002").quote.sourceTitle, corrected.title);
      assert.deepEqual(story.authorQuotes.batches.slice(0, priorBatches.length), priorBatches);
      assert.ok(story.authorQuotes.receipt.sources.some(item => item.id === corrected.source && item.title === corrected.title));
      assert.ok(story.authorQuotes.receipt.sources.some(item => item.id === p3Source.source && item.title === p3Source.title));
      assert.equal(projectResolvedQuotes(story, { notebookId: program.researchLibrary?.notebookId, cues: [
        { id: 1, text: "第一段口播。" }, { id: 2, text: "第二段口播。" }
      ] }).beats[0].treatment.assetRequests[0].callouts[0].citation, `《${corrected.title}》`);
    }
    assert.equal((await deriveStatus(options)).kind, "stage-complete");
    // The next stage consumes the accepted source proof without P1 files or P1 revalidation.
    await rm(paths.scriptPackage);
    await rm(p1Sources);
    assert.equal((await deriveStatus({ ...options, stageId: "p4" })).nodeId, "opener");
    await write(paths.scriptPackage, { narration, _producer: { materialExecutionId: materialId } });
    await write(p1Sources, { documents: [source] });
    story.beats[1] = beat("B003", 2, true);
    story.features["cue-sync"].bindings.B003 = bindings(2);
    await write(paths.storyboard, story);
    await runNext(options);
    assert.deepEqual((await readData(work.workOrder)).inputs.quoteRequests.map(item => item.id), ["B003"]);
    await acceptQuote({ id: "B003", quote: { kind: "historical-quote", text: source.text, citation: "《测试诏令》", sourceId: source.source } });
    story = await readData(paths.storyboard);
    assert.ok(story.authorQuotes.batches.some(batch => batch._producer.outputSha256 === originalBatch._producer.outputSha256));
    assert.equal((await deriveStatus(options)).kind, "stage-complete");
    assert.equal((await deriveStatus({ ...options, stageId: "p4" })).nodeId, "opener");
    if (existingQuote) {
      // Even a later cancellation must keep the original source and its acceptance intact.
      story.beats[0].id = "B004";
      story.templateRuns[0].beatIds[0] = "B004";
      story.features["cue-sync"].bindings = { B004: bindings(1), B003: bindings(2) };
      story.authorQuotes.items = story.authorQuotes.items.filter(item => item.id !== "B002");
      story.authorQuotes._producer.outputSha256 = hashObject(withoutProducer(story.authorQuotes));
      await write(paths.storyboard, story);
      await acceptQuote({ id: "B004", quote: null });
      story = await readData(paths.storyboard);
      assert.ok(story.authorQuotes.batches.some(batch => hashObject(batch) === hashObject(originalBatch)));
      assert.equal(story.authorQuotes.receipt.response.references.filter(item => item.source_id === p3Source.source).length, 1);
      assert.equal((await deriveStatus(options)).kind, "stage-complete");
      assert.equal((await deriveStatus({ ...options, stageId: "p4" })).nodeId, "opener");
      story.beats[0].id = "B005";
      story.templateRuns[0].beatIds[0] = "B005";
      story.features["cue-sync"].bindings.B005 = story.features["cue-sync"].bindings.B004;
      delete story.features["cue-sync"].bindings.B004;
      story.authorQuotes.items = story.authorQuotes.items.filter(item => item.id !== "B004");
      story.authorQuotes._producer.outputSha256 = hashObject(withoutProducer(story.authorQuotes));
      await write(paths.storyboard, story);
      assert.equal((await deriveStatus(options)).kind, "stage-complete");
      assert.equal((await deriveStatus({ ...options, stageId: "p4" })).nodeId, "opener");
    }
    const p2Work = getStageWorkPaths(paths, "p2");
    await assert.rejects(readFile(p2Work.returnRequest("synthesize-narration")), { code: "ENOENT" });
    assert.equal(await readFile(paths.narrationText, "utf8"), narration);
  });
});

test("缺失P1依据不猜选，缺少书名的Query不伪造引文身份", async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p1-quote-boundary-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const episodeId = "ep01", paths = getEpisodePaths(workspaceRoot, episodeId);
  await write(paths.scriptPackage, { _producer: { materialExecutionId: "../outside" } });
  assert.equal(await readAcceptedNarrationEvidence({ workspaceRoot, episodeId }), null);
  await write(paths.scriptPackage, { _producer: { materialExecutionId: "a".repeat(64) } });
  await assert.rejects(readAcceptedNarrationEvidence({ workspaceRoot, episodeId }), /P1已保留依据缺失/u);
  const services = { workspaceRoot, task: { taskDigest: "test", scratchPath: ".", inputs: {
    quoteRequests: [{ id: "B001" }], narrationEvidence: { documents: [], queries: [{ references: [
      { source_id: "unknown-book", cited_text: "不可发兵。" }
    ] }] }
  } } };
  await assert.rejects(completeCandidate({ result: { items: [{ id: "B001", quote: null }] }, services }), /先取得史料原文/u);
});
