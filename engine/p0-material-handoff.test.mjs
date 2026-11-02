import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { atomicWrite, atomicWriteData, fileSha256, hashObject, readData } from "../packages/program-utils.mjs";
import { expectedEpisodeBrief, materializeEpisodeBriefs, narrationEpisodeProjection } from "../packages/program-brief.mjs";
import { getProgramPaths, getEpisodePaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../packages/publication-paths.mjs";
import { validate, validateCommon, validateAcceptance } from "../packages/modules/plan-program/validate.mjs";
import { validateSchema } from "./runtime/schema.mjs";
import { resolveNarrationCurrent } from "./runtime/state-narration.mjs";
import { loadStageModel } from "./runtime/model.mjs";
import { runNext } from "./runtime.mjs";
import { prepareNarrationReplacement } from "./runtime/revise-narration.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const researchLibrary = { notebookId: "notebook", requiredSourceIds: ["source"] };
const episode = { episodeId: "ep01", episodeTitle: "局面为何改变", episodeQuestion: "什么使局面改变？",
  episodeAnswer: "关键条件改变了各方的选择。", episodeCreativeBrief: "解释条件与行动。材料：报道 https://example.com/report，正文第二节。",
  episodeScope: "本次事件", episodeBenefit: "理解选择改变的原因。" };
const basePlan = { schemaVersion: "7.3", programId: "test-program", programForm: "historical-explainer", explainerType: "general",
  seriesTitle: "测试节目", audience: "普通观众", editorialDirection: "解释真实变化", viewerBenefit: "理解原因",
  narrativeTone: "平实", seriesFramework: "围绕条件变化展开", openerTemplate: "episode-opener",
  visualPackage: { visualPackageId: "meiji-state-machine", version: "1.0.0" },
  coverPackage: { coverPackageId: "type-first-editorial", version: "1.0.0" }, episodes: [episode] };
const requestFor = planningBasis => ({ schemaVersion: "3.0", programId: basePlan.programId,
  programForm: basePlan.programForm, idea: "本次节目", constraints: [], planningBasis });
const contextFor = programRequest => ({ programRequest, visualPackageCatalog: [basePlan.visualPackage],
  coverPackageCatalog: [basePlan.coverPackage], openerTemplateCatalog: [{ templateId: "episode-opener" }] });

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p0-handoff-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const transcript = path.join(workspaceRoot, "transcript.json");
  await atomicWriteData(transcript, { text: "参考节目的完整底稿。" });
  const referenceProgram = { path: path.join(workspaceRoot, "references.json") };
  await atomicWriteData(referenceProgram.path, { videos: [{ id: "video", title: "参考节目", url: "https://example.com/video",
    transcript: { path: transcript, sha256: await fileSha256(transcript) }, quotes: [] }] });
  return { workspaceRoot, referenceProgram };
}

test("P0来源组合通过实际合同、接纳检查并投递到P1", async (t) => {
  for (const kind of ["web", "book", "video", "query", "video-query"]) await t.test(kind, async (t) => {
    const { workspaceRoot, referenceProgram } = await fixture(t);
    const video = kind.startsWith("video"), query = kind.includes("query");
    const plan = { ...structuredClone(basePlan), explainerType: video ? "current-affairs" : "general" };
    const planningBasis = video ? { kind: "video-led", referenceProgram }
      : kind === "book" ? { kind: "book-led", book: { path: "/local/book.txt", sha256: "c".repeat(64) } } : { kind: "topic-led" };
    if (kind === "book") plan.episodes[0].episodeCreativeBrief = "解释原指定书的中心关系。材料：指定书 /local/book.txt，第2章，摘要 " + "c".repeat(64);
    if (video) { plan.referenceProgram = referenceProgram; plan.episodes[0].referenceVideoIds = ["video"]; }
    if (query) plan.researchLibrary = researchLibrary;
    const request = {...requestFor(planningBasis),openerTemplate:plan.openerTemplate};
    if (query) request.researchLibrary = { notebookId: researchLibrary.notebookId };
    await validateSchema(path.join(root, "contracts/program-request.schema.json"), request, "委托");
    await validateSchema(path.join(root, "packages/modules/plan-program/result.schema.json"), plan, "P0");
    const context = contextFor(request);
    assert.deepEqual(validate({ result: plan, context }), []);
    const calls = [];
    assert.deepEqual(await validateAcceptance({ result: plan, context, services: { nlm: async args => {
      calls.push(args);
      return args[0] === "notebook" ? { notebook_id: "notebook" } : [{ id: "source", status: 2 }];
    } } }), []);
    assert.equal(calls.length, query ? 2 : 0);
    const accepted = { ...plan, _producer: { moduleId: "plan-program", nodeId: "plan-program", taskDigest: "a".repeat(64),
      inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
    await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, accepted);
    await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: accepted });
    const current = await resolveNarrationCurrent({ root, workspaceRoot, episodeId: "ep01", model: await loadStageModel(root, { stageId: "p1" }) });
    assert.equal(current.kind, "task", JSON.stringify(current));
    const workOrder = current.createWorkOrder(current.allowedReturnTargets);
    assert.equal(workOrder.moduleId, "author-narration");
    const inputs = workOrder.inputs;
    assert.equal((await readData(getEpisodePaths(workspaceRoot, "ep01").episodeBrief)).explainerType, plan.explainerType);
    assert.equal(inputs.episodeBrief.explainerType, plan.explainerType);
    assert.equal(inputs.episodeBrief.episodeTitle, plan.episodes[0].episodeTitle);
    assert.equal(inputs.episodeBrief.episodeCreativeBrief, plan.episodes[0].episodeCreativeBrief);
    assert.deepEqual(inputs.programPlan.researchLibrary, query ? { notebookId: "notebook" } : undefined);
    assert.equal(inputs.programPlan.referenceVideos?.[0].transcript.text, video ? "参考节目的完整底稿。" : undefined);
  });
});

test("纪录片P0正式标题进入P1作者工作单", async (t) => {
  const { workspaceRoot } = await fixture(t);
  const { seriesFramework, explainerType, ...shared } = structuredClone(basePlan);
  const { episodeQuestion, episodeAnswer, ...documentaryEpisode } = shared.episodes[0];
  const plan = { ...shared, schemaVersion: "8.1", programForm: "historical-documentary",
    openerTemplate: "documentary-opener", researchLibrary,
    documentaryContract: "沿有据的劳动过程理解历史生活。", seriesConcept: "条件与生活",
    artisticApproach: "从具体行动进入。", seriesNarrativeStrategy: "每集跟随一个完整过程。",
    storyWorld: { worldFrame: "港口的一日", recurringElements: [{ id: "harbor", kind: "place", function: "货物流转的场所" }],
      continuityPrinciple: "沿物件流转展开。", episodeGrammar: ["进入现场", "跟随行动", "抵达结果"], reconstructionBoundary: "不虚构历史结论。" },
    episodes: [{ ...documentaryEpisode, episodeConcept: "搬运与等待", episodeThroughline: "跟随一批货物离港。",
      storyOutline: { storyMode: "物件旅程", viewpoint: "搬运过程", centralProcess: "货物离港",
        actionChain: ["船靠岸", "货卸岸", "货离港"], meaningReveals: ["条件影响流转"], environment: "港口",
        ending: "货物离港", continuityLinks: [], reconstruction: "只连接有据过程。" } }] };
  await validateSchema(path.join(root, "packages/modules/plan-historical-documentary/result.schema.json"), plan, "纪录片P0");
  const accepted = { ...plan, _producer: { moduleId: "plan-historical-documentary", nodeId: "plan-historical-documentary",
    taskDigest: "a".repeat(64), inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
  await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, accepted);
  await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: accepted });
  const current = await resolveNarrationCurrent({ root, workspaceRoot, episodeId: "ep01", model: await loadStageModel(root, { stageId: "p1" }) });
  assert.equal(current.kind, "task", JSON.stringify(current));
  const workOrder = current.createWorkOrder(current.allowedReturnTargets);
  assert.equal(workOrder.moduleId, "author-documentary-narration");
  assert.equal(Object.hasOwn(workOrder.inputs.episodeBrief, "explainerType"), false);
  const brief = await readData(getEpisodePaths(workspaceRoot, "ep01").episodeBrief);
  await assert.rejects(validateSchema(path.join(root, "contracts/episode-brief.schema.json"),
    { ...brief, explainerType: "current-affairs" }, "纪录片单集"), /explainerType/u);
  assert.equal(workOrder.inputs.episodeBrief.episodeTitle, documentaryEpisode.episodeTitle);
});

test("并用时两边均核对；书源与纪录片原约束保留", async (t) => {
  const { referenceProgram } = await fixture(t);
  const plan = { ...structuredClone(basePlan), referenceProgram, researchLibrary,
    episodes: [{ ...episode, referenceVideoIds: ["missing-video"] }] };
  const errors = await validateAcceptance({ result: plan, services: { nlm: async args =>
    args[0] === "notebook" ? { notebook_id: "notebook" } : [{ id: "source", status: 1 }] } });
  assert.ok(errors.some(error => error.includes("missing-video")));
  assert.ok(errors.some(error => error.includes("未明确就绪")));
  const request = requestFor({ kind: "book-led", book: { path: "/local/book.txt", sha256: "c".repeat(64) } });
  const context = contextFor(request);
  assert.deepEqual(validateCommon({ result: basePlan, context }), []);
  assert.ok(validateCommon({ result: { ...basePlan, researchLibrary: { ...researchLibrary, baseBookSourceId: "missing" } }, context })
    .some(error => error.includes("必须属于")));
  request.programForm = "historical-documentary";
  assert.ok(validateCommon({ result: { ...basePlan, programForm: "historical-documentary" }, context })
    .some(error => error.includes("必须声明")));
  await assert.rejects(validateSchema(path.join(root, "packages/modules/plan-historical-documentary/result.schema.json"),
    { ...basePlan, programForm: "historical-documentary", schemaVersion: "8.1" }, "纪录片"), /researchLibrary/u);
});


test("完整重跑按实际Query尝试记录恢复原因，使用新材料目录", async (t) => {
  for (const mode of ["web", "unused-notebook", "known-query", "unknown-query"]) await t.test(mode, async (t) => {
    const { workspaceRoot } = await fixture(t);
    const plan = structuredClone(basePlan);
    if (mode !== "web") plan.researchLibrary = researchLibrary;
    const accepted = { ...plan, _producer: { moduleId: "plan-program", nodeId: "plan-program", taskDigest: "a".repeat(64),
      inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
    await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, accepted);
    await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: accepted });
    const options = { root, workspaceRoot, episodeId: "ep01", stageId: "p1" };
    await runNext(options);
    const replacement = { ...options, rerunNarration: true, replaceFullRerun: true };
    await runNext(replacement);
    const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, "ep01"), "p1");
    const previous = await readData(work.workOrder);
    const scratch = path.resolve(workspaceRoot, previous.scratchPath);
    const materials = { documents: [{ title: "原文", source: "https://example.com/report", text: "测试原文。" }] };
    await atomicWriteData(path.join(scratch, "reference-materials.json"), materials);
    if (mode.endsWith("query")) {
      await atomicWrite(path.join(scratch, "notebook-query.txt"), "本次查询");
      if (mode === "known-query") await atomicWriteData(path.join(scratch, "notebook-query.json"), {
        answer: "已完成", conversation_id: "query-id", citations: {},
        references: [{ source_id: "source", citation_number: 1, cited_text: "原始引文。" }]
      });
      else await atomicWrite(path.join(scratch, "notebook-query.json"), "");
    }
    await runNext(replacement);
    const current = await readData(work.workOrder);
    assert.notEqual(current.executionId, previous.executionId);
    assert.deepEqual(current.inputs.programPlan.researchLibrary, previous.inputs.programPlan.researchLibrary);
    assert.deepEqual(await readData(getProgramPaths(workspaceRoot).programPlan), accepted);
    await assert.rejects(readData(path.join(workspaceRoot, current.scratchPath, "reference-materials.json")), { code: "ENOENT" });
    const expected = mode === "known-query" ? /完整主Query终态/u
      : mode === "unknown-query" ? /NotebookLM结果未知/u : /未使用NotebookLM Query/u;
    assert.match(current.inputs.returnRequest.reason, expected);
  });
});

test("已放弃的正文候选可重试，同一工作单的旧稿与固定材料保留", async (t) => {
  for (const interrupted of [false, true]) await t.test(interrupted ? "重签中断后恢复" : "正常重签", async (t) => {
    const { workspaceRoot } = await fixture(t);
    const plan = structuredClone(basePlan);
    const acceptedPlan = { ...plan, _producer: { moduleId: "plan-program", nodeId: "plan-program", taskDigest: "a".repeat(64),
      inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
    await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, acceptedPlan);
    await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: acceptedPlan });
    const paths = getEpisodePaths(workspaceRoot, "ep01");
    const work = getStageWorkPaths(paths, "p1");
    const published = getPublicationPaths(workspaceRoot, "ep01", "release-main");
    const materialId = "c".repeat(64);
    const source = path.join(work.work, `attempt-${materialId}`);
    const originalScript = { episodeId: "ep01", narration: "旧正式正文。", _producer: { materialExecutionId: materialId } };
    const originalOpener = { episodeId: "ep01", openerNarration: "原片头。" };
    const originalPublication = { episodeId: "ep01", title: "保留的平台文案和封面构思" };
    await atomicWriteData(paths.scriptPackage, originalScript);
    await atomicWriteData(paths.openerNarration, originalOpener);
    await atomicWriteData(published.publicationDocument, originalPublication);
    for (const file of [published.publicationText, published.coverYoutube, published.coverVertical, published.coverReceipt]) {
      await atomicWrite(file, "保留的正式交付");
    }
    await atomicWriteData(path.join(source, "reference-materials.json"), {
      documents: [{ title: "原文", source: "https://example.com/report", text: "固定材料正文。" }]
    });
    await atomicWrite(path.join(source, "author-task.md"), "原作者任务");
    await atomicWrite(path.join(source, "agy-conversation-id.txt"), "11111111-1111-4111-8111-111111111111");
    const options = { root, workspaceRoot, episodeId: "ep01", stageId: "p1" };
    const revision = { ...options, reviseNarration: true, openerText: "原片头。" };
    await runNext(revision);
    const previous = await readData(work.workOrder);
    const oldScratch = path.resolve(workspaceRoot, previous.scratchPath);
    await atomicWrite(path.join(oldScratch, "author-task.md"), "已放弃返工的原任务");
    const oldCandidate = { taskDigest: previous.taskDigest, result: { narration: "被放弃的候选正文。" } };
    await atomicWriteData(work.candidate, oldCandidate);
    const requestPath = work.returnRequest("author-narration");
    const request = await readData(requestPath);
    const replacement = { ...revision, replaceNarrationRevision: true };

    await runNext(options);
    assert.equal((await readData(work.workOrder)).taskDigest, previous.taskDigest);
    assert.deepEqual(await readData(work.candidate), oldCandidate);
    await assert.rejects(runNext({ ...replacement, openerText: "不相同的片头。" }), /不能改写原正文返工锁定的片头原句/u);
    assert.deepEqual(await readData(work.candidate), oldCandidate);
    await atomicWriteData(work.candidate, { ...oldCandidate, taskDigest: "f".repeat(64) });
    await assert.rejects(runNext(replacement), /只能放弃绑定现行工作单的完整候选/u);
    assert.deepEqual(await readData(requestPath), request);
    assert.equal((await readData(work.workOrder)).taskDigest, previous.taskDigest);
    assert.equal((await readData(work.candidate)).taskDigest, "f".repeat(64));
    await atomicWriteData(work.candidate, oldCandidate);

    if (interrupted) {
      await prepareNarrationReplacement({ ...options, openerText: "原片头。", replaceNarrationRevision: true,
        rerunNarration: false, replaceFullRerun: false });
      await runNext(options);
    } else await runNext(replacement);

    const current = await readData(work.workOrder);
    assert.notEqual(current.taskDigest, previous.taskDigest);
    assert.notEqual(current.scratchPath, previous.scratchPath);
    assert.deepEqual(current.inputs.reusedNarrationMaterials, previous.inputs.reusedNarrationMaterials);
    assert.equal(current.inputs.returnRequest.exactOpenerNarration, "原片头。");
    const held = await readData(path.join(work.work, "held-work", `${previous.taskDigest}.json`));
    assert.deepEqual(held.workOrder, previous);
    assert.deepEqual(held.candidate, oldCandidate);
    assert.equal(await readFile(path.join(oldScratch, "author-task.md"), "utf8"), "已放弃返工的原任务");
    await assert.rejects(readData(work.candidate), { code: "ENOENT" });
    assert.deepEqual(await readData(paths.scriptPackage), originalScript);
    assert.deepEqual(await readData(paths.openerNarration), originalOpener);
    assert.deepEqual(await readData(published.publicationDocument), originalPublication);
    assert.equal(await readFile(published.coverYoutube, "utf8"), "保留的正式交付");
    assert.equal(await readFile(published.coverVertical, "utf8"), "保留的正式交付");
    await runNext(options);
    assert.equal((await readData(work.workOrder)).taskDigest, current.taskDigest);
  });
});


test("P0采用用户指定类型；未指定时允许P0判断，正式结果与单集必须交清", async () => {
  const request = requestFor({ kind: "topic-led" });
  const planSchema = path.join(root, "packages/modules/plan-program/result.schema.json");
  const requestSchema = path.join(root, "contracts/program-request.schema.json");
  const briefSchema = path.join(root, "contracts/episode-brief.schema.json");
  for (const explainerType of ["general", "current-affairs"]) {
    const plan = { ...structuredClone(basePlan), explainerType };
    await validateSchema(planSchema, plan, "P0");
    assert.deepEqual(validate({ result: plan, context: contextFor(request) }), []);
    const explicit = { ...request, explainerType };
    await validateSchema(requestSchema, explicit, "指定类型");
    assert.deepEqual(validate({ result: plan, context: contextFor(explicit) }), []);
    const opposite = { ...plan, explainerType: explainerType === "general" ? "current-affairs" : "general" };
    assert.ok(validate({ result: opposite, context: contextFor(explicit) }).some(error => error.includes("用户明确指定")));
    const { brief } = expectedEpisodeBrief({ plan, episodeId: "ep01" });
    await validateSchema(briefSchema, brief, "单集类型");
    for (const value of [undefined, "unknown"]) {
      const invalidPlan = { ...plan, explainerType: value };
      const invalidBrief = { ...brief, explainerType: value };
      if (value === undefined) { delete invalidPlan.explainerType; delete invalidBrief.explainerType; }
      await assert.rejects(validateSchema(planSchema, invalidPlan, "缺失或非法类型"), /explainerType/u);
      await assert.rejects(validateSchema(briefSchema, invalidBrief, "缺失或非法类型"), /explainerType/u);
    }
  }
  await assert.rejects(validateSchema(requestSchema, { ...request, explainerType: "unknown" }, "非法指定"), /explainerType/u);
  await assert.rejects(validateSchema(requestSchema,
    { ...request, programForm: "historical-documentary", explainerType: "current-affairs" }, "纪录片委托"), /explainerType/u);
});

test("只改正文类型也更新正式单集与P1输入，保留六项内容任务", async (t) => {
  const { workspaceRoot } = await fixture(t);
  const model = await loadStageModel(root, { stageId: "p1" });
  const briefs = [];
  for (const explainerType of ["general", "current-affairs"]) {
    const plan = { ...structuredClone(basePlan), explainerType };
    const accepted = { ...plan, _producer: { moduleId: "plan-program", nodeId: "plan-program", taskDigest: "a".repeat(64),
      inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
    await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, accepted);
    await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: accepted });
    const brief = await readData(getEpisodePaths(workspaceRoot, "ep01").episodeBrief);
    briefs.push(brief);
    const current = await resolveNarrationCurrent({ root, workspaceRoot, episodeId: "ep01", model });
    assert.equal(current.kind, "task", JSON.stringify(current));
    const input = current.createWorkOrder(current.allowedReturnTargets).inputs.episodeBrief;
    assert.equal(input.explainerType, explainerType);
    assert.deepEqual(input, narrationEpisodeProjection(brief));
  }
  // 原P0接纳以单集业务差异通知P1；类型必须参与该差异。
  assert.notEqual(briefs[0]._producer.outputSha256, briefs[1]._producer.outputSha256);
  const stripType = ({ explainerType, _producer, ...content }) => content;
  assert.deepEqual(stripType(briefs[0]), stripType(briefs[1]));
});
