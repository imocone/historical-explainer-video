import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { atomicWrite, atomicWriteData, hashObject, readData } from "../packages/program-utils.mjs";
import { getEpisodePaths, getProgramPaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { materializeEpisodeBriefs } from "../packages/program-brief.mjs";
import { EventEmitter } from "node:events";
import { writeSync } from "node:fs";
import { PassThrough } from "node:stream";
import { authorHandoff, applyFactEdits, callAuthor } from "../packages/modules/author-narration/scripts/author-handoff.mjs";
import { validate as validatePublication } from "../packages/modules/author-narration/publication.mjs";
import { validateAcceptance, validateCommon } from "../packages/modules/author-narration/validate.mjs";
import { compactAcceptedNarrationMaterials, resolveReusableNarrationMaterials, validateReusableNarrationMaterials } from "./p1-revision-materials.mjs";
import {getPublicationPaths} from '../packages/publication-paths.mjs';
import {assertPublicationRevisionHasNoRemoteActivity} from './runtime/publication-requests.mjs';
import {preparePublicationRevision} from './runtime/revise-publication.mjs';
import { canReviseRetainedPlatformCopy } from './runtime/publication-requests.mjs';
import { runNext, acceptCandidate, deriveStatus } from './runtime.mjs';

const oldAuthor = "11111111-1111-4111-8111-111111111111";
const newAuthor = "22222222-2222-4222-8222-222222222222";
const otherAuthor = "33333333-3333-4333-8333-333333333333";
const spoken = "片头\n舰队为何分散？\n\n正文\n旗舰转向后，各舰失去统一行动。";
const cover = { posterConcept: "旗舰转向，各舰在海面上分散航行。", heroVisual: "海上分散的舰队", visibleText: ["舰队转向", "为何分散", "测试节目"] };
const publication = {
  platforms: {
    youtube: { title: "舰队为何分散 #舰队 #航海 #海战 #历史 #指挥", description: "讲清舰队失序的经过。", tags: [] },
    douyin: { title: "舰队为何分散", body: "旗舰转向后，各舰失去统一行动。", topics: ["舰队", "航海", "海战", "历史"] },
    xiaohongshu: { title: "舰队为何分散", body: "旗舰转向后，各舰失去统一行动。", topics: ["舰队", "航海", "海战", "历史", "指挥"] }
  },
  covers: { youtube: cover, vertical: cover }
};
const completeResponse = (text = spoken, published = publication) => `${text}\n\n发布内容\n${JSON.stringify(published)}`;
const factList = (evidence, ...locations) => [{
  evidence, places: locations.map(([path, before], index) => ({ id: index + 1, path, before }))
}];

async function setup(t, { reference = true, documents = false, query = !reference && !documents, scope = "narration", moduleId = "author-narration" } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "p1-rewrite-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const episodeId = "ep01";
  const episodeBrief = { seriesTitle: "测试节目", programForm: moduleId === "author-narration"
    ? "historical-explainer" : "historical-documentary",
    ...(reference ? { referenceProgram: { id: "test-source" }, referenceVideoIds: ["test-video"] } : {}) };
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), "p1");
  const sourceId = "a".repeat(64), executionId = "b".repeat(64);
  const source = path.join(work.work, `attempt-${sourceId}`);
  const scratch = path.join(work.work, `attempt-${executionId}`);
  await mkdir(source, { recursive: true });
  await mkdir(scratch, { recursive: true });
  if (reference || documents) await atomicWriteData(path.join(source, "reference-materials.json"), {
    ...(reference ? { referenceProgram: episodeBrief.referenceProgram, referenceVideoIds: episodeBrief.referenceVideoIds, videos: [] } : {}),
    ...(documents ? { documents: [{ title: "原始报道", source: "https://example.com/report", text: "舰队曾统一航行。" }] } : {})
  });
  if (query) for (const suffix of ["", "-supplement"]) {
    await atomicWrite(path.join(source, `notebook-query${suffix}.txt`), `查询${suffix}`);
    await atomicWriteData(path.join(source, `notebook-query${suffix}.json`), {
      answer: "测试资料", conversation_id: "test-query", citations: {},
      references: [{ source_id: "test-source", citation_number: 1, cited_text: "舰队曾统一航行。" }]
    });
  }
  await atomicWrite(path.join(source, "agy-conversation-id.txt"), oldAuthor);
  await atomicWrite(path.join(source, "author-task.md"), "原作者任务");
  await atomicWrite(path.join(source, "publication-input.md"), "原发布调查");
  await atomicWrite(path.join(scratch, "author-task.md"), "本次独立重写任务");
  await atomicWrite(path.join(scratch, "publication-input.md"), "本次发布调查");
  const materials = await resolveReusableNarrationMaterials({ workspaceRoot, episodeId, episodeBrief, materialExecutionId: sourceId });
  const base = {
    runner: "ai", workflowId: "narration", stageId: "p1", moduleId, nodeId: moduleId,
    subject: { id: episodeId }, executionId,
    candidatePath: path.relative(workspaceRoot, work.candidate), scratchPath: path.relative(workspaceRoot, scratch),
    inputs: { episodeBrief, programPlan: reference ? { referenceVideos: [{ id: "test-video", transcript: { text: "视频原文。" } }] } : {},
      ...(scope ? { returnRequest: { revisionScope: scope } } : {}), reusedNarrationMaterials: materials },
    resolvedAssembly: { slots: [{ id: "opener-copy-template", implementations: [{ resources: [
      { role: "validator", source: "packages/templates/episode-opener/validate.mjs" }
    ] }] }] }
  };
  await atomicWriteData(work.workOrder, { ...base, taskDigest: hashObject(base) });
  const receipt = async (name, conversation_id, response = spoken) => {
    const file = path.join(scratch, `${name}.json`);
    await atomicWriteData(file, { status: "SUCCESS", conversation_id, response });
    return file;
  };
  return { workspaceRoot, episodeId, episodeBrief, work, source, scratch, executionId, materials, receipt };
}

test("解说三路先交正文片头，锁定后由同一作者补全封面文案再核对", async (t) => {
  for (const scope of [null, "full"]) await t.test(scope ?? "首次", async (t) => {
    const f = await setup(t, { scope });
    const authors = [oldAuthor, newAuthor, otherAuthor];
    for (const route of [1, 2, 3]) await authorHandoff("start", f.work.workOrder, route);
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", await f.receipt("incomplete", oldAuthor, "片头\n舰队为何分散？\n\n正文"), "0"), /没有完整口播/u);
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", await f.receipt("early-publication", oldAuthor, completeResponse()), "0"), /首稿只交正文和片头/u);
    await assert.rejects(authorHandoff("select", f.work.workOrder, "1"), /首稿选稿阶段/u);
    for (const route of [1, 2, 3]) {
      const receipt = await f.receipt(`spoken-${route}`, authors[route - 1], `${spoken}第${route}路。`);
      const raw = await readFile(receipt);
      await authorHandoff("receive", f.work.workOrder, String(route), receipt, "0");
      await authorHandoff("receive", f.work.workOrder, String(route), receipt, "0");
      assert.deepEqual(await readFile(receipt), raw);
      if (route === 2) await assert.rejects(authorHandoff("select", f.work.workOrder, "2"), /第3路.*首稿选稿阶段/u);
    }
    await assert.rejects(readData(f.work.candidate), { code: "ENOENT" });
    const selectedFile = path.join(f.scratch, "author-2.json");
    const original = (await readData(selectedFile)).result;
    await authorHandoff("select", f.work.workOrder, "2");
    assert.deepEqual((await readData(f.work.candidate)).result, original);
    assert.equal(original.publication, undefined);
    assert.match((await validateAcceptance({ result: original })).join("\n"), /未交付发布文案与封面构思/u);
    await assert.rejects(authorHandoff("select", f.work.workOrder, "1"), /其它作者/u);
    await rm(f.work.candidate);
    await rm(path.join(f.scratch, "agy-conversation-id.txt"));
    await authorHandoff("select", f.work.workOrder, "2");
    assert.deepEqual((await readData(f.work.candidate)).result, original);
    await assert.rejects(authorHandoff("package-start", f.work.workOrder, "1"), /已选作者/u);
    await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "reviewing"), /不能重置/u);
    const prompt = path.join(f.scratch, "publication-prompt.txt");
    await atomicWrite(prompt, "根据选定口播续写发布内容。");
    const receiptPath = path.join(f.scratch, "author-2.publication.agy.json");
    await assert.rejects(authorHandoff("call", f.work.workOrder, receiptPath, prompt, "--conversation", newAuthor), /仅所选原作者/u);
    const start = await authorHandoff("package-start", f.work.workOrder, "2");
    assert.equal(start.conversationId, newAuthor);
    assert.equal(start.receiptPath, receiptPath);
    assert.equal(start.started, true);
    await assert.rejects(authorHandoff("call", f.work.workOrder, receiptPath, prompt, "--conversation", oldAuthor), /仅所选原作者/u);
    await assert.rejects(authorHandoff("rebuild-context", f.work.workOrder, "原会话无法续接", "--previous-ended"), /须由所选原作者/u);
    assert.equal((await authorHandoff("package-start", f.work.workOrder, "2")).started, false);
    const pending = await readData(selectedFile);
    const submit = (file = start.receiptPath) => authorHandoff("package-receive", f.work.workOrder, "2", file, "0");
    const writePublication = (value, author = newAuthor) =>
      atomicWriteData(start.receiptPath, { status: "SUCCESS", conversation_id: author, response: JSON.stringify(value) });
    const common = "讲清舰队失序的经过。\n\n资料：https://example.com/report#section";
    const published = structuredClone(publication);
    published.platforms.youtube.description = common;
    published.platforms.youtube.visibleTopics = ["舰队", "海战"];
    delete published.platforms.xiaohongshu.body;
    const invalid = structuredClone(published);
    delete invalid.covers.vertical;
    await assert.rejects(submit(await f.receipt("wrong-packaging-path", newAuthor, JSON.stringify(published))), /原回包/u);
    await writePublication(published, oldAuthor);
    await assert.rejects(submit(), /原作者/u);
    await writePublication(invalid);
    await assert.rejects(submit(), /vertical/u);
    const locked = await readData(f.work.candidate);
    assert.deepEqual(locked.result, original);
    assert.deepEqual(await readData(selectedFile), pending);
    await writePublication(published);
    await atomicWriteData(f.work.candidate, { ...locked, result: { ...original, narration: "改写的正文。" } });
    await assert.rejects(submit(), /已锁定的正文和片头/u);
    await atomicWriteData(f.work.candidate, locked);
    await submit();
    const packaged = await readData(f.work.candidate);
    const { publication: finalPublication, ...finalSpoken } = packaged.result;
    assert.deepEqual(finalSpoken, original);
    assert.equal(finalPublication.platforms.youtube.description, `${common}\n\n#舰队 #海战`);
    assert.equal(finalPublication.platforms.youtube.visibleTopics, undefined);
    assert.equal(finalPublication.platforms.xiaohongshu.body, common);
    assert.deepEqual(finalPublication.platforms.xiaohongshu.topics, publication.platforms.xiaohongshu.topics);
    await atomicWriteData(selectedFile, pending);
    await writePublication({ ...published, covers: { ...published.covers, vertical: { ...cover, visibleText: ["不同原字"] } } });
    await assert.rejects(submit(), /只能恢复同一次发布内容回包/u);
    await writePublication(published);
    assert.equal((await submit()).phase, "packaged");
    assert.deepEqual(await readData(f.work.candidate), packaged);
    await authorHandoff("mark", f.work.workOrder, "2", "reviewing");
    const facts = path.join(f.scratch, "facts.json");
    const originalFacts = factList("只修本次已确认的事实错误", ["/narration", "第2路。"]);
    await atomicWriteData(facts, originalFacts);
    await authorHandoff("mark", f.work.workOrder, "2", "correcting", facts);
    await authorHandoff("session", f.work.workOrder, "2", "314");
    const correcting = await readData(selectedFile);
    await authorHandoff("mark", f.work.workOrder, "2", "correcting", facts);
    await authorHandoff("mark", f.work.workOrder, "2", "correcting");
    assert.deepEqual(await readData(selectedFile), correcting);
    for (const replacement of [[], ["另一份错误清单"]]) {
      await atomicWriteData(facts, replacement);
      await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "correcting", facts), /原事实清单.*不能覆盖/u);
      assert.deepEqual(await readData(selectedFile), correcting);
    }
    const corrected = JSON.stringify({ edits: [{ id: 1, after: "已纠正。" }] });
    await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("wrong-author", oldAuthor, corrected), "0"), /原作者/u);
    const receipt = await f.receipt("correct-suite", newAuthor, corrected);
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    assert.deepEqual((await readData(selectedFile)).result, original);
    assert.equal((await readData(selectedFile)).phase, "ready");
    assert.deepEqual((await readData(selectedFile)).factErrors, originalFacts);
    assert.deepEqual((await readData(f.work.candidate)).result.publication, finalPublication);
    const ready = await readData(selectedFile);
    await atomicWriteData(facts, originalFacts);
    await authorHandoff("mark", f.work.workOrder, "2", "ready", facts);
    await authorHandoff("mark", f.work.workOrder, "2", "ready");
    assert.deepEqual(await readData(selectedFile), ready);
    await atomicWriteData(facts, []);
    await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "ready", facts), /原事实清单.*不能覆盖/u);
    assert.deepEqual(await readData(selectedFile), ready);
    await atomicWriteData(selectedFile, { ...ready, factErrors: null });
    await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "ready", facts), /不能覆盖或重建/u);
    assert.equal((await readData(selectedFile)).factErrors, null);
    await atomicWriteData(selectedFile, ready);
    assert.equal((await readData(f.work.candidate)).result.narration, "旗舰转向后，各舰失去统一行动。已纠正。");
    await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "reviewing"), /不能重置/u);
  });
});

test("解说锁稿后由原作者补齐发布内容，正式接纳交给封面节点", async t => {
  const { workspaceRoot, episodeId, work } = await setup(t, { scope: null });
  await rm(work.workOrder);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const releases = getPublicationPaths(workspaceRoot, episodeId, "release-main");
  const plan = {
    schemaVersion: "7.3", programId: "test-program", programForm: "historical-explainer", explainerType: "general",
    seriesTitle: "测试节目", audience: "普通观众", editorialDirection: "解释舰队行动", viewerBenefit: "理解指挥关系",
    narrativeTone: "平实", seriesFramework: "围绕舰队行动展开", openerTemplate: "episode-opener",
    visualPackage: { visualPackageId: "meiji-state-machine", version: "1.0.0" },
    coverPackage: { coverPackageId: "type-first-editorial", version: "1.0.0" },
    episodes: [{ episodeId, episodeTitle: "舰队为何分散", episodeQuestion: "舰队为何分散？",
      episodeAnswer: "旗舰转向后失去统一行动。", episodeCreativeBrief: "解释舰队分散的经过。",
      episodeScope: "舰队行动", episodeBenefit: "理解指挥关系。" }]
  };
  const accepted = { ...plan, _producer: { moduleId: "plan-program", nodeId: "plan-program", taskDigest: "a".repeat(64),
    inputs: [], rules: [], contract: "b".repeat(64), outputSha256: hashObject(plan) } };
  await atomicWriteData(getProgramPaths(workspaceRoot).programPlan, accepted);
  await materializeEpisodeBriefs({ root: workspaceRoot, systemRoot: root, plan: accepted });
  const options = { root, workspaceRoot, episodeId, stageId: "p1", targetId: "release-main" };
  assert.equal((await runNext(options)).kind, "work-order");
  const order = await readData(work.workOrder);
  const scratch = path.resolve(workspaceRoot, order.scratchPath);
  await atomicWrite(path.join(scratch, "author-task.md"), "解释舰队分散的经过。");
  const source = path.join(scratch, "sources.json");
  await atomicWriteData(source, [{ title: "测试史料", source: "https://example.com/report",
    text: "舰队曾统一航行。旗舰转向后，各舰失去统一行动。" }]);
  await authorHandoff("prepare-reference", work.workOrder, source);
  for (const [index, author] of [oldAuthor, newAuthor, otherAuthor].entries()) {
    const route = String(index + 1);
    const { receiptPath } = await authorHandoff("start", work.workOrder, route);
    await atomicWriteData(receiptPath, { status: "SUCCESS", conversation_id: author, response: spoken });
    await authorHandoff("receive", work.workOrder, route, receiptPath, "0");
  }
  await authorHandoff("select", work.workOrder, "2");
  await assert.rejects(acceptCandidate(options), /未交付发布文案与封面构思/u);
  await assert.rejects(readFile(paths.scriptPackage), { code: "ENOENT" });
  const { receiptPath } = await authorHandoff("package-start", work.workOrder, "2");
  const title = "舰队为何分散？";
  const result = { ...publication, covers: { youtube: { ...cover, visibleText: [title] },
    vertical: { ...cover, visibleText: [title] } } };
  await atomicWrite(path.join(scratch, "publication-input.md"), "按锁定片头与正文构思封面。");
  await atomicWriteData(receiptPath, { status: "SUCCESS", conversation_id: newAuthor, response: JSON.stringify(result) });
  await authorHandoff("package-receive", work.workOrder, "2", receiptPath, "0");
  await authorHandoff("mark", work.workOrder, "2", "reviewing");
  const facts = path.join(scratch, "fact-errors.json");
  await atomicWriteData(facts, []);
  await authorHandoff("mark", work.workOrder, "2", "ready", facts);
  await acceptCandidate(options);
  assert.equal((await readData(paths.scriptPackage)).narration, spoken.split("\n").at(-1));
  assert.equal((await readData(paths.openerNarration)).openerNarration, title);
  assert.deepEqual((await readData(releases.publicationDocument)).covers, result.covers);
  assert.equal((await readFile(path.join(scratch, "agy-conversation-id.txt"), "utf8")).trim(), newAuthor);
  assert.equal((await deriveStatus(options)).nodeId, "produce-covers");
});

test("整套发布保留国内平台话题合同，接受无话题的YouTube自然标题及独立封面文案", async (t) => {
  const f = await setup(t, { scope: null });
  for (const [index, author] of [oldAuthor, newAuthor, otherAuthor].entries()) {
    const route = String(index + 1);
    const { receiptPath } = await authorHandoff("start", f.work.workOrder, route);
    await atomicWriteData(receiptPath, { status: "SUCCESS", conversation_id: author, response: spoken });
    await authorHandoff("receive", f.work.workOrder, route, receiptPath, "0");
  }
  await authorHandoff("select", f.work.workOrder, "1");
  const { receiptPath } = await authorHandoff("package-start", f.work.workOrder, "1");
  const locked = await readData(f.work.candidate);
  const submit = async (value) => {
    await atomicWriteData(receiptPath, { status: "SUCCESS", conversation_id: oldAuthor, response: JSON.stringify(value) });
    return authorHandoff("package-receive", f.work.workOrder, "1", receiptPath, "0");
  };
  const cases = [
    [(p) => { p.covers.vertical.visibleText = []; }, /P1发布内容/u],
    [(p) => { p.covers.youtube.visibleText.push("额外文字"); }, /P1发布内容/u],
    [(p) => { p.platforms.youtube.title = "#舰队 #航海 #海战 #历史 #指挥"; }, /须有标题文字/u],
    [(p) => { p.platforms.douyin.topics.pop(); }, /P1发布内容/u],
    [(p) => { p.platforms.douyin.topics.push("指挥"); }, /P1发布内容/u],
    [(p) => { p.platforms.xiaohongshu.topics.pop(); }, /P1发布内容/u],
    [(p) => { p.platforms.xiaohongshu.topics.push("海军"); }, /P1发布内容/u],
  ];
  for (const [change, expected] of cases) {
    const invalid = structuredClone(publication);
    // 单独改变竖版，保留横版作为比较基准。
    invalid.covers.vertical = structuredClone(invalid.covers.vertical);
    change(invalid);
    await assert.rejects(submit(invalid), expected);
    assert.deepEqual(await readData(f.work.candidate), locked);
  }
  const valid = structuredClone(publication);
  valid.platforms.youtube.title = "旗舰转向之后，舰队失去统一行动｜舰队指挥";
  valid.covers.youtube = { ...valid.covers.youtube, visibleText: ["转向之后"] };
  valid.covers.vertical = { ...valid.covers.vertical, visibleText: ["舰队为何", "失去指挥？"] };
  await submit(valid);
  assert.deepEqual((await readData(f.work.candidate)).result.publication.covers.vertical, valid.covers.vertical);
});

test("单画幅定点换字保留未选原文，不被整套一致性要求扩大范围", () => {
  const result = { ...structuredClone(publication), episodeId: "ep01", targetId: "release-main" };
  result.covers.youtube = { ...result.covers.youtube, visibleText: ["舰队转向", "各舰为何分散", "测试节目"] };
  const context = { episodeId: "ep01", targetId: "release-main", episodeBrief: { seriesTitle: "测试节目" },
    openerNarration: { openerNarration: "舰队为何分散？" },
    returnRequest: { revisionScope: "publication-copy", publicationFields: ["covers.youtube.visibleText"],
      baselineCovers: publication.covers, baselinePlatforms: publication.platforms } };
  assert.deepEqual(validatePublication({ result, context }), []);
  assert.deepEqual(result.covers.vertical, publication.covers.vertical);
  result.covers.vertical = { ...result.covers.vertical, visibleText: [...result.covers.youtube.visibleText] };
  assert.match(validatePublication({ result, context }).join("\n"), /保留未选封面内容/u);
});

test("发布换字采用当前P0节目名，仍锁住正文片头并拒绝其它名称", () => {
  const currentScriptPackage = { schemaVersion: "3.0", episodeId: "ep01", seriesTitle: "频道名",
    language: "zh-CN", narration: "已经接纳的正文。" };
  const context = { episodeId: "ep01", episodeBrief: { seriesTitle: "节目名" },
    currentScriptPackage, currentOpenerNarration: { openerNarration: "原片头。" },
    returnRequest: { revisionScope: "publication-copy" } };
  const result = { ...currentScriptPackage, seriesTitle: "节目名", openerNarration: "原片头。" };
  assert.deepEqual(validateCommon({ result, context }), []);
  assert.match(validateCommon({ result: { ...result, seriesTitle: "频道名" }, context }).join("\n"), /当前P0/u);
  assert.match(validateCommon({ result: { ...result, narration: "擅改正文。" }, context }).join("\n"), /不得修改正文 narration/u);
  assert.match(validateCommon({ result: { ...result, openerNarration: "擅改片头。" }, context }).join("\n"), /不得修改片头/u);
});

test("完全重复的口播回包只收同一稿，原回执保留；不同稿件仍拒绝", async (t) => {
  const f = await setup(t, { scope: null });
  for (const route of [1, 2]) await authorHandoff("start", f.work.workOrder, route);
  const single = spoken;
  const receipt = await f.receipt("repeated", oldAuthor, `${single}\n`.repeat(3));
  const raw = await readFile(receipt, "utf8");
  await authorHandoff("receive", f.work.workOrder, "1", receipt, "0");
  const result = (await readData(path.join(f.scratch, "author-1.json"))).result;
  assert.equal(result.narration, spoken.split("\n\n正文\n")[1]);
  assert.equal(result.publication, undefined);
  assert.equal(await readFile(receipt, "utf8"), raw);
  const changed = single.replace("失去统一行动", "各自行动");
  const ambiguous = await f.receipt("ambiguous", newAuthor, `${single}\n${changed}`);
  await assert.rejects(authorHandoff("receive", f.work.workOrder, "2", ambiguous, "0"), /多份不同稿件/u);
  assert.equal((await readData(path.join(f.scratch, "author-2.json"))).result, null);
});

test("口播标题支持一致的Markdown包装，正文和原回包保持原样", async t => {
  const narration = "旗舰转向后，各舰失去统一行动。\n\n文中提到发布内容，但它不是交付标题。";
  for (const heading of [text => text, text => `**${text}**`, text => `## ${text}`, text => `### **${text}**：`]) {
    const f = await setup(t, {scope: null});
    await authorHandoff("start", f.work.workOrder, "1");
    const response = `${heading("片头")}\n舰队为何分散？\n\n${heading("正文")}\n${narration}`;
    const receipt = await f.receipt("formatted", oldAuthor, response);
    const raw = await readFile(receipt, "utf8");
    await authorHandoff("receive", f.work.workOrder, "1", receipt, "0");
    const result = (await readData(path.join(f.scratch, "author-1.json"))).result;
    assert.equal(result.openerNarration, "舰队为何分散？");
    assert.equal(result.narration, narration);
    assert.equal(result.publication, undefined);
    assert.equal(await readFile(receipt, "utf8"), raw);
  }
});

test("首稿夹带发布段时保留回包，不把JSON混入正文", async t => {
  for (const tail of ["## 发布内容\n{}", "发布内容\n{}\n发布内容\n{}"]) {
    const f = await setup(t, {scope: null});
    await authorHandoff("start", f.work.workOrder, "1");
    const receipt = await f.receipt("bad-boundary", oldAuthor, `${spoken}\n\n${tail}`);
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", receipt, "0"), /首稿只交正文和片头/u);
    assert.equal((await readData(path.join(f.scratch, "author-1.json"))).result, null);
  }
});

test("成功首稿只从有同轮原生证据的工具前言中取回最终成稿", async t => {
  const f = await setup(t, { scope: null });
  const { receiptPath } = await authorHandoff("start", f.work.workOrder, "1");
  const prompt = "只读，返回本次完整成稿。";
  const promptFile = path.join(f.scratch, "prompt.txt");
  const home = path.join(f.workspaceRoot, "agy-home");
  const logs = path.join(home, ".gemini", "antigravity-cli", "brain", oldAuthor, ".system_generated", "logs");
  const preface = "现在读取正文取材。";
  const final = spoken;
  const nativeSteps = [
    { type: "USER_INPUT", source: "USER_EXPLICIT", content: prompt },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", content: preface, tool_calls: [{}] },
    { type: "GENERIC", source: "MODEL", status: "DONE" },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", content: final }
  ];
  await mkdir(logs, { recursive: true });
  await atomicWrite(path.join(logs, "transcript_full.jsonl"), nativeSteps.map(step => JSON.stringify(step)).join("\n"));
  await atomicWrite(promptFile, prompt);
  await atomicWrite(receiptPath.replace(/\.json$/u, ".stderr.log"), "");
  await atomicWrite(receiptPath.replace(/\.json$/u, ".exit.txt"), "0\n");
  const receipt = { status: "SUCCESS", conversation_id: oldAuthor, response: `${preface}\n${final}\n` };
  const receive = () => promisify(execFile)(process.execPath, [
    path.resolve("packages/modules/author-narration/scripts/author-handoff.mjs"),
    "receive", f.work.workOrder, "1", receiptPath, "0", "--recover-503", promptFile
  ], { env: { ...process.env, HOME: home } });
  await atomicWriteData(receiptPath, { ...receipt, response: `未经证明的前言\n${final}` });
  await assert.rejects(receive(), /不能唯一解析片头/u);
  await atomicWriteData(receiptPath, receipt);
  assert.equal(JSON.parse((await receive()).stdout).phase, "received");
  const { result } = await readData(path.join(f.scratch, "author-1.json"));
  assert.equal(result.narration, spoken.split("\n").at(-1));
  assert.deepEqual(await readData(receiptPath), receipt);
});

test("解说首次与full不因某路明确失败而减少口播候选数量", async (t) => {
  for (const scope of [null, "full"]) await t.test(scope ?? "首次", async (t) => {
    const f = await setup(t, { scope });
    for (const route of [1, 2, 3]) await authorHandoff("start", f.work.workOrder, route);
    for (const [route, author] of [["1", oldAuthor], ["2", newAuthor]]) {
      await authorHandoff("receive", f.work.workOrder, route,
        await f.receipt(`spoken-${route}`, author), "0");
    }
    await authorHandoff("mark", f.work.workOrder, "3", "failed", "作者进程明确失败");
    const files = [1, 2, 3].map(route => path.join(f.scratch, `author-${route}.json`));
    const drafts = await Promise.all(files.map(file => readData(file)));
    await assert.rejects(authorHandoff("select", f.work.workOrder, "2"), /第3路明确失败.*三路正文和片头/u);
    assert.deepEqual(await Promise.all(files.map(file => readData(file))), drafts);
    await assert.rejects(readData(f.work.candidate), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(f.scratch, "agy-conversation-id.txt")), { code: "ENOENT" });
  });
});

test("纪录片仍选正文与片头，再由原作者补齐发布内容", async (t) => {
  const f = await setup(t, { scope: "full", moduleId: "author-documentary-narration", reference: false });
  for (const [index, author] of [oldAuthor, newAuthor, otherAuthor].entries()) {
    const route = String(index + 1);
    await authorHandoff("start", f.work.workOrder, route);
    await authorHandoff("receive", f.work.workOrder, route, await f.receipt(`doc-${route}`, author, `\`\`\`text\n${spoken}\n\`\`\``), "0");
  }
  await authorHandoff("select", f.work.workOrder, "2");
  assert.equal((await readData(f.work.candidate)).result.publication, undefined);
  await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "reviewing"), /不能重置/u);
  assert.equal((await authorHandoff("package-start", f.work.workOrder, "2")).started, true);
  assert.equal((await authorHandoff("package-start", f.work.workOrder, "2")).started, false);
  await assert.rejects(authorHandoff("package-receive", f.work.workOrder, "2", await f.receipt("doc-wrong", oldAuthor, JSON.stringify(publication)), "0"), /原作者/u);
  const shared = structuredClone(publication);
  shared.platforms.youtube.description = "甲".repeat(1000);
  shared.platforms.youtube.visibleTopics = [];
  delete shared.platforms.xiaohongshu.body;
  const receipt = await f.receipt("doc-publication", newAuthor, JSON.stringify(shared));
  const packaged = await authorHandoff("package-receive", f.work.workOrder, "2", receipt, "0");
  assert.equal(packaged.phase, "packaged");
  assert.equal(Object.hasOwn(packaged, "publicationAdvisory"), false);
  await authorHandoff("package-receive", f.work.workOrder, "2", receipt, "0");
  await authorHandoff("mark", f.work.workOrder, "2", "reviewing");
  const result = (await readData(f.work.candidate)).result;
  assert.equal(result.narration, "旗舰转向后，各舰失去统一行动。");
  assert.equal(result.publication.platforms.youtube.description, shared.platforms.youtube.description);
  assert.equal(result.publication.platforms.xiaohongshu.body, shared.platforms.youtube.description);
  assert.deepEqual(result.publication.covers, publication.covers);
  const facts = path.join(f.scratch, "facts.json");
  await atomicWriteData(facts, []);
  await authorHandoff("mark", f.work.workOrder, "2", "ready", facts);
  const selectedFile = path.join(f.scratch, "author-2.json");
  const ready = await readData(selectedFile);
  await authorHandoff("mark", f.work.workOrder, "2", "ready", facts);
  assert.deepEqual(await readData(selectedFile), ready);
  await atomicWriteData(facts, ["不能事后替换空清单"]);
  await assert.rejects(authorHandoff("mark", f.work.workOrder, "2", "ready", facts), /原事实清单.*不能覆盖/u);
  assert.deepEqual(await readData(selectedFile), ready);
});

test("正文重写交接新作者；纠错、材料收口及下次修订仍定位到该稿", async (t) => {
  for (const options of [
    { reference: true }, { reference: false }, { reference: false, documents: true },
    { reference: true, documents: true }, { reference: true, query: true },
    { reference: false, documents: true, query: true }
  ]) await t.test(JSON.stringify(options), async (t) => {
    const f = await setup(t, options);
    await assert.rejects(authorHandoff("candidate", f.work.workOrder, await f.receipt("old", oldAuthor), "0"), /须开启新作者/u);
    // 已签发的旧会话返工现场可沿现行方法交接新稿，不改工作单或原材料。
    await atomicWrite(path.join(f.scratch, "agy-conversation-id.txt"), oldAuthor);
    await authorHandoff("candidate", f.work.workOrder, await f.receipt("new", newAuthor), "0");
    await assert.rejects(authorHandoff("candidate", f.work.workOrder, await f.receipt("other", otherAuthor), "0"), /原作者会话/u);
    await authorHandoff("publication", f.work.workOrder, await f.receipt("publication", newAuthor, JSON.stringify(publication)), "0");
    await atomicWriteData(path.join(f.scratch, "fact-errors.json"), factList("行动范围须收窄", ["/narration", "各舰"]));
    const corrected = JSON.stringify({ edits: [{ id: 1, after: "部分舰只" }] });
    await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("wrong-correction", oldAuthor, corrected), "0"), /新作者/u);
    await authorHandoff("correct", f.work.workOrder, await f.receipt("correction", newAuthor, corrected), "0");
    assert.equal((await readData(f.work.candidate)).result.narration, "旗舰转向后，部分舰只失去统一行动。");
    assert.equal((await readFile(path.join(f.source, "agy-conversation-id.txt"), "utf8")), oldAuthor);
    await compactAcceptedNarrationMaterials({ workspaceRoot: f.workspaceRoot, episodeId: f.episodeId, materialExecutionId: f.executionId });
    const retained = await resolveReusableNarrationMaterials({ workspaceRoot: f.workspaceRoot, episodeId: f.episodeId,
      episodeBrief: f.episodeBrief, materialExecutionId: f.executionId });
    assert.equal(retained.agyConversation.conversationId, newAuthor);
    for (const field of ["referenceMaterials", "notebookQueryPrompt", "notebookQuery", "notebookQuerySupplementPrompt", "notebookQuerySupplement"])
      if (f.materials[field]) assert.equal(retained[field].sha256, f.materials[field].sha256);
    assert.equal(await readFile(path.join(f.scratch, "author-task.md"), "utf8"), "本次独立重写任务");
    assert.equal(await readFile(path.join(f.scratch, "publication-input.md"), "utf8"), "本次发布调查");
    await assert.rejects(readFile(path.join(f.source, "agy-conversation-id.txt")), { code: "ENOENT" });
  });
});

test("恢复重试后被选中的原稿，按原作者最小纠错并可重复交接", async (t) => {
  const f = await setup(t);
  const { taskDigest, ...base } = await readData(f.work.workOrder);
  const openerNarration = "舰队为何分散？";
  const narration = "旗舰转向后，各舰失去统一行动。";
  base.inputs.returnRequest.exactOpenerNarration = openerNarration;
  await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });

  const draft = { phase: "ready", selectedOpener: 1, conversationId: oldAuthor, failures: [{ phase: "failed" }],
    result: { schemaVersion: "3.0", episodeId: f.episodeId, seriesTitle: "测试节目", language: "zh-CN",
      openerNarration, narration },
    publication: { ...publication, schemaVersion: "7.0", episodeId: f.episodeId, targetId: "release-main" } };
  const retry = { status: "SUCCESS", conversation_id: oldAuthor, response: spoken };
  const packaging = { status: "SUCCESS", conversation_id: oldAuthor, response: JSON.stringify(publication) };
  await atomicWriteData(path.join(f.source, "author-1.json"), draft);
  await atomicWriteData(path.join(f.source, "author-1.agy.json"), { status: "ERROR", response: "首次调用失败" });
  await atomicWriteData(path.join(f.source, "author-1.retry-1.agy.json"), retry);
  await atomicWriteData(path.join(f.source, "author-1.publication.agy.json"), packaging);
  await atomicWriteData(path.join(f.scratch, "fact-errors.json"), factList("舰只范围须收窄", ["/narration", "各舰"]));
  const receipt = await f.receipt("correction", oldAuthor, JSON.stringify({ edits: [{ id: 1, after: "部分舰只" }] }));

  const restore = () => authorHandoff("correct", f.work.workOrder, receipt, "0", "--restore-selected-draft", "1");
  assert.equal((await restore()).conversationId, oldAuthor);
  assert.deepEqual(await restore(), await restore());
  assert.deepEqual((await readData(f.work.candidate)).result,
    { ...draft.result, narration: "旗舰转向后，部分舰只失去统一行动。", publication: draft.publication });
  assert.deepEqual(await readData(path.join(f.scratch, "author-1.retry-1.agy.json")), retry);
  assert.deepEqual(await readData(path.join(f.scratch, "author-1.publication.agy.json")), packaging);
});

test("片头局部修订与纪录片正文修订继续使用固定作者", async (t) => {
  for (const options of [{ scope: "opener" }, { moduleId: "author-documentary-narration", reference: false }]) await t.test(JSON.stringify(options), async (t) => {
    const f = await setup(t, options);
    await assert.rejects(authorHandoff("candidate", f.work.workOrder, await f.receipt("new", newAuthor), "0"), /原作者会话/u);
    await authorHandoff("candidate", f.work.workOrder, await f.receipt("old", oldAuthor), "0");
    assert.equal((await readFile(path.join(f.scratch, "agy-conversation-id.txt"), "utf8")).trim(), oldAuthor);
  });
});


test("正文快照保存、追加及材料完整性沿原入口处理", async (t) => {
  for (const reference of [false, true]) await t.test(reference ? "视频与正文" : "纯正文", async (t) => {
    const f = await setup(t, { reference, documents: true });
    const { taskDigest, ...base } = await readData(f.work.workOrder);
    base.inputs.returnRequest = { revisionScope: "full" };
    await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });
    const documents = [{ title: "指定书", source: "/local/book.txt", locator: "第2章", text: "原书连续正文。" }];
    const input = path.join(f.scratch, "documents.json");
    await atomicWriteData(input, documents);
    const first = await authorHandoff("prepare-reference", f.work.workOrder, input);
    assert.equal(first.reused, false);
    const snapshot = await readData(first.referenceMaterials);
    assert.deepEqual(snapshot.documents, documents);
    assert.deepEqual(snapshot.videos, reference ? base.inputs.programPlan.referenceVideos : undefined);
    assert.equal((await authorHandoff("prepare-reference", f.work.workOrder)).reused, true);
    const added = { title: "补充网页", source: "https://example.com", text: "网页原文。" };
    await atomicWriteData(input, [...documents, added]);
    await authorHandoff("prepare-reference", f.work.workOrder, input);
    await atomicWriteData(input, [added]);
    await assert.rejects(authorHandoff("prepare-reference", f.work.workOrder, input), /不能删改/u);
    const source = await readData(path.join(f.source, "reference-materials.json"));
    await atomicWriteData(path.join(f.source, "reference-materials.json"), { ...source, documents });
    await assert.rejects(validateReusableNarrationMaterials({ ...f, materials: f.materials }), /摘要已经变化/u);
  });
});

test("正文不能掩盖残缺Query；纪录片仍要求引用", async (t) => {
  const f = await setup(t, { reference: false, documents: true });
  const resolve = () => resolveReusableNarrationMaterials({ ...f, materialExecutionId: f.materials.materialExecutionId });
  await atomicWrite(path.join(f.source, "notebook-query.txt"), "已进入Query调用");
  await assert.rejects(resolve(), /主Query结果不存在/u);
  await rm(path.join(f.source, "notebook-query.txt"));
  f.episodeBrief.programForm = "historical-documentary";
  await assert.rejects(resolve(), /主Query提示词不存在/u);
});

test('P1返工只读独立发布现场：未发布可改，已提交与已发布保留原交付', async t => {
  const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'p1-publish-boundary-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const paths=getPublicationPaths(workspaceRoot,'ep01','release-main');
  const release=path.join(workspaceRoot,'ep01','制作','p5','release-main');
  assert.equal(paths.release,release);
  await assertPublicationRevisionHasNoRemoteActivity(paths);
  const sessionFile=path.join(release,'_work','intents','douyin','browser.yaml');
  const session={state:'submitted',submittedAt:'2026-11-02T01:00:00.000Z',fingerprint:'original',executionId:'original-upload'};
  await atomicWriteData(sessionFile,session);
  await atomicWriteData(paths.episodeBrief,{programForm:'historical-explainer'});
  await assert.rejects(preparePublicationRevision({workspaceRoot,episodeId:'ep01',stageId:'p1',
    revisePublication:true,current:{kind:'complete'}}),/独立发布意图/);
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(paths),/独立发布意图/);
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(paths,{allowEditingCopy:true,platforms:['douyin']}),/独立发布意图/);
  assert.deepEqual(await readData(sessionFile),session);
  await atomicWriteData(sessionFile,{...session,state:'editing',submittedAt:session.submittedAt});
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(paths,{allowEditingCopy:true,platforms:['douyin']}),/独立发布意图/);
  const editing={state:'editing',fingerprint:'original',executionId:'original-upload'};
  await atomicWriteData(sessionFile,editing);
  await atomicWrite(path.join(path.dirname(sessionFile),'timing.jsonl'),'{"event":"session-open"}\n{"event":"block-end"}\n');
  await assertPublicationRevisionHasNoRemoteActivity(paths,{allowEditingCopy:true,platforms:['douyin']});
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(paths),/独立发布意图/);
  const receiptFile=path.join(release,'receipts','douyin.yaml'),receipt={remoteWorkId:'123456',fingerprint:'original'};
  await atomicWriteData(receiptFile,receipt);
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(paths,{allowEditingCopy:true,platforms:['douyin']}),/独立发布回执/);
  assert.deepEqual(await readData(receiptFile),receipt);
  assert.deepEqual(await readData(sessionFile),editing);
});

test('成片清理后仅平台文案经正式作者与接纳链修订，不重建正文缓存或改动原发布身份', async t => {
  const f = await setup(t, { scope: 'publication-copy', reference: false, documents: true });
  await rm(f.work.workOrder);
  await rm(f.source, { recursive: true });
  await rm(f.scratch, { recursive: true });
  const options = { root: fileURLToPath(new URL('..', import.meta.url)), workspaceRoot: f.workspaceRoot, episodeId: f.episodeId,
    stageId: 'p1', targetId: 'release-main' };
  const paths = getEpisodePaths(f.workspaceRoot, f.episodeId);
  const published = getPublicationPaths(f.workspaceRoot, f.episodeId, 'release-main');
  const accepted = (value, moduleId, nodeId = moduleId) => ({ ...value, _producer: {
    moduleId, nodeId, taskDigest: 'a'.repeat(64), inputs: [], rules: [], contract: 'b'.repeat(64),
    outputSha256: hashObject(value), ...(['author-narration'].includes(moduleId) ? { materialExecutionId: f.materials.materialExecutionId } : {}) } });
  await atomicWriteData(path.join(f.workspaceRoot, 'program.yaml'), {
    programForm: 'historical-explainer', seriesTitle: '测试节目', editorialDirection: '解释舰队行动',
    narrativeTone: '平实', openerTemplate: 'episode-opener',
    visualPackage: { visualPackageId: 'meiji-state-machine', version: '1.0.0' },
    coverPackage: { coverPackageId: 'type-first-editorial', version: '1.0.0' } });
  await atomicWriteData(paths.episodeBrief, { ...f.episodeBrief, schemaVersion:'7.3', programId:'test-program',
    episodeId:'ep01', audience:'普通观众', explainerType: 'general', seriesTitle: '测试节目',
    episodeTitle:'舰队为何分散',episodeQuestion:'舰队为何分散？',episodeAnswer:'旗舰转向后失去统一行动。',
    episodeCreativeBrief:'解释舰队分散的经过。',episodeScope:'舰队行动',episodeBenefit:'理解指挥关系。' });
  await atomicWriteData(paths.scriptPackage, accepted({schemaVersion:'3.0', episodeId:'ep01',
    seriesTitle:'测试节目', language:'zh-CN', narration:'旗舰转向后，各舰失去统一行动。'}, 'author-narration'));
  await atomicWriteData(paths.openerNarration, {schemaVersion:'3.0', openerNarration:'舰队为何分散？'});
  const currentPublication = { ...publication, schemaVersion:'7.0', episodeId:'ep01', targetId:'release-main' };
  await atomicWriteData(published.publicationDocument, accepted(currentPublication, 'author-narration'));
  await atomicWrite(published.publicationText, '保留的正式发布阅读稿');
  await atomicWrite(paths.finalVideo, 'retained final video fixture');
  const retained = accepted({episodeId:'ep01', output:'ep01/output/final.mp4',
    mediaRetention:'documents-and-release'}, 'render-video', 'render');
  await atomicWriteData(paths.renderReceipt, retained);
  const otherReceipt = path.join(published.receipts, 'youtube.yaml');
  const originalSession = path.join(published.release, '_work/intents/xiaohongshu/browser.yaml');
  await atomicWriteData(otherReceipt, {remoteWorkId:'original-youtube'});
  await atomicWriteData(originalSession, {state:'editing', executionId:'original-upload', fingerprint:'old'});
  const keep = [paths.scriptPackage, paths.openerNarration, paths.finalVideo, paths.renderReceipt, otherReceipt, originalSession];
  const before = await Promise.all(keep.map(file=>readFile(file)));
  const request = {revisionScope:'publication-copy', publicationFields:['xiaohongshu.body']};
  assert.equal(await canReviseRetainedPlatformCopy({...options,request}), true);
  assert.equal(await canReviseRetainedPlatformCopy({...options,request:{...request,publicationFields:['covers.vertical.visibleText']}}), false);
  await rm(paths.renderReceipt);
  await assert.rejects(preparePublicationRevision({...options,revisePublication:true,publicationFields:request.publicationFields,
    revisionReason:'只精简小红书正文',current:{kind:'stage-complete'}}), /材料尝试不存在/u);
  await atomicWriteData(paths.renderReceipt, retained);
  const task = await runNext({...options,revisePublication:true,publicationFields:request.publicationFields,
    revisionReason:'只精简小红书正文'});
  assert.equal(task.kind, 'work-order');
  const order = await readData(f.work.workOrder);
  assert.equal(order.inputs.reusedNarrationMaterials, undefined);
  assert.deepEqual(order.inputs.currentPublication, currentPublication);
  const scratch = path.resolve(f.workspaceRoot, order.scratchPath);
  await atomicWrite(path.join(scratch,'publication-input.md'),'只精简已接纳正文，不增加事实。');
  const receipt = path.join(scratch,'author.agy.json');
  await atomicWriteData(receipt,{status:'SUCCESS',conversation_id:newAuthor,response:JSON.stringify({
    platforms:{youtube:{description:'越出本次范围',visibleTopics:[]},xiaohongshu:{}}})});
  await assert.rejects(authorHandoff('candidate',f.work.workOrder,receipt,'0'), /同时修改YouTube简介与小红书正文/u);
  await assert.rejects(readData(f.work.candidate), { code: 'ENOENT' });
  await atomicWriteData(receipt,{status:'SUCCESS',conversation_id:newAuthor,response:JSON.stringify({
    platforms:{xiaohongshu:{body:'旗舰转向，舰队为何失序？'}}})});
  await authorHandoff('candidate',f.work.workOrder,receipt,'0');
  const candidate = await readData(f.work.candidate);
  assert.equal((await readFile(path.join(scratch,'agy-conversation-id.txt'),'utf8')).trim(),newAuthor);
  const bad = structuredClone(candidate);
  bad.result.publication.platforms.youtube.title='不应改变的标题';
  await atomicWriteData(f.work.candidate,bad);
  await assert.rejects(acceptCandidate(options), /未选字段 youtube.title/u);
  await atomicWriteData(f.work.candidate,candidate);
  await acceptCandidate(options);
  const revised = await readData(published.publicationDocument);
  const expected = structuredClone(currentPublication);
  expected.platforms.xiaohongshu.body='旗舰转向，舰队为何失序？';
  const {_producer,...business}=revised;
  assert.deepEqual(business,expected);
  assert.deepEqual(await Promise.all(keep.map(file=>readFile(file))),before);
  await assert.rejects(readFile(path.join(f.source,'publication-input.md')),{code:'ENOENT'});
  await assert.rejects(readFile(f.work.workOrder),{code:'ENOENT'});
  assert.equal((await deriveStatus(options)).nodeId,'produce-covers');
  await atomicWriteData(originalSession,{state:'submitted',submittedAt:'2026-11-06T00:00:00Z'});
  await assert.rejects(assertPublicationRevisionHasNoRemoteActivity(published,{allowEditingCopy:true,platforms:['xiaohongshu']}), /独立发布意图/u);
});

test("同时点名两平台正文时装配共用文案并保留其余字段", async (t) => {
  const f = await setup(t, { scope: "publication-copy" });
  const order = await readData(f.work.workOrder);
  const { taskDigest, ...base } = order;
  Object.assign(base.inputs, {
    currentScriptPackage: { schemaVersion: "3.0", episodeId: "ep01", language: "zh-CN", narration: "旗舰转向后，各舰失去统一行动。" },
    currentOpenerNarration: { openerNarration: "舰队为何分散？" },
    returnRequest: {
      revisionScope: "publication-copy", publicationFields: ["youtube.description", "xiaohongshu.body"],
      baselineCovers: publication.covers, baselinePlatforms: publication.platforms
    }
  });
  await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });
  const response = JSON.stringify({ platforms: {
    youtube: { description: "只修共用文案。", visibleTopics: ["舰队"] }
  } });
  await authorHandoff("candidate", f.work.workOrder, await f.receipt("joint-copy", oldAuthor, response), "0");
  const result = (await readData(f.work.candidate)).result;
  const expected = structuredClone(publication);
  expected.platforms.youtube.description = "只修共用文案。\n\n#舰队";
  expected.platforms.xiaohongshu.body = "只修共用文案。";
  assert.deepEqual(result.publication, { ...expected, schemaVersion: "7.0", episodeId: "ep01", targetId: "release-main" });
});

test("按编号纠错，从原清单取原句，拒绝整稿和歧义定位", () => {
  const baseline = { narration: "出其不意地登上。保留段\n保留段", openerNarration: "片头", publication };
  const facts = factList("原错误", ["/narration", "出其不意地登上"]);
  const patch = { edits: [{ id: 1, after: "夜间登上" }] };
  assert.equal(applyFactEdits(baseline, JSON.stringify(patch), facts).result.narration, "夜间登上。保留段\n保留段");
  assert.equal(baseline.narration, "出其不意地登上。保留段\n保留段");
  assert.throws(() => applyFactEdits(baseline, JSON.stringify(baseline), facts), /不接收整稿/u);
  for (const extra of [{ before: "出其意地登上" }, { id: 2 }, { path: "/episodeId" }])
    assert.throws(() => applyFactEdits(baseline, JSON.stringify({ edits: [{ ...patch.edits[0], ...extra }] }), facts));
  for (const before of ["保留段", "不存在"])
    assert.throws(() => applyFactEdits(baseline, JSON.stringify(patch), factList("原错误", ["/narration", before])), /不能唯一定位/u);
  const nearby = { narration: "甲先。乙后。" };
  const nearbyFacts = factList("两处用字", ["/narration", "甲"], ["/narration", "乙"]);
  const nearbyEdits = { edits: [{ id: 1, after: "乙" }, { id: 2, after: "丙" }] };
  assert.equal(applyFactEdits(nearby, JSON.stringify(nearbyEdits), nearbyFacts).result.narration, "乙先。丙后。");
});

test("同一共用文案纠错只提交一处，两边同步且保留独立话题", () => {
  const baseline = { publication: structuredClone(publication) };
  const { youtube, xiaohongshu } = baseline.publication.platforms;
  xiaohongshu.body = "旗舰向西。各舰随后失去统一行动。";
  youtube.description = xiaohongshu.body + "\n\n#舰队 #海战";
  const edit = { error: 1, path: "/publication/platforms/youtube/description", before: "向西", after: "向东" };
  const response = JSON.stringify({ edits: [{ id: 1, after: edit.after }] });
  const independentFacts = factList("原错误", [edit.path, edit.before]);
  const facts = [{ ...independentFacts[0], sharedDescription: true }];
  const { result, edits } = applyFactEdits(baseline, response, facts);
  assert.equal(result.publication.platforms.youtube.description, "旗舰向东。各舰随后失去统一行动。\n\n#舰队 #海战");
  assert.deepEqual(result.publication.platforms.xiaohongshu, { ...xiaohongshu, body: "旗舰向东。各舰随后失去统一行动。" });
  assert.deepEqual(edits, [edit, { ...edit, path: "/publication/platforms/xiaohongshu/body" }]);
  assert.throws(() => applyFactEdits(baseline, response, facts, { publicationFields: ["youtube.description"] }), /获准同时/u);
  xiaohongshu.body = "独立文案。旗舰向西。";
  assert.throws(() => applyFactEdits(baseline, response, facts), /逐字相同/u);
  assert.deepEqual(applyFactEdits(baseline, response, independentFacts).result.publication.platforms.xiaohongshu, xiaohongshu);
});

test("纪录片给作者的引文保留原字、出处和索引，略过无效引用与回执杂项", async (t) => {
  const f = await setup(t, { moduleId: "author-documentary-narration", reference: false, scope: "full" });
  const first = path.join(f.scratch, "notebook-query.json");
  const second = path.join(f.scratch, "notebook-query-supplement.json");
  await atomicWriteData(first, { question: "内部旧提问", answer: "内部总结", references: [
    { source_id: "无效", citation_number: null, cited_text: "不得投递" },
    { source_id: "甲", citation_number: 3, cited_text: "原文首段。\n\n  原文次段。  " }
  ] });
  await atomicWriteData(second, { references: [{ source_id: "乙", citation_number: 5, cited_text: "补充原文。" }] });
  assert.equal(await authorHandoff("documentary-quotes", f.work.workOrder, first, second),
    "\n\n## Query引用原文\n\n### notebook-query.json\n\n出处 甲 · 引用 3 · 原索引 1\n\n原文首段。\n\n  原文次段。  \n\n"
    + "### notebook-query-supplement.json\n\n出处 乙 · 引用 5 · 原索引 0\n\n补充原文。\n");
  await atomicWriteData(second, { references: [{ source_id: "", citation_number: 1, cited_text: "缺少出处" }] });
  await assert.rejects(authorHandoff("documentary-quotes", f.work.workOrder, first, second), /没有有效文字引用/u);
});

test("纠错章节校验失败不锁死回包，未落位的失败缓存可由完整回包恢复", async t => {
  for (const legacy of [false, true]) await t.test(legacy ? "恢复已有失败缓存" : "校验通过才保存缓存", async t => {
    const f = await setup(t, { scope: "opener" });
    const first = "旗舰转向后，各舰失去统一行动。";
    const corrected = "旗舰转向后，各舰暂时失去统一行动。";
    const published = structuredClone(publication);
    published.platforms.youtube.chapters = [
      { title: "转向", startText: first },
      { title: "信号", startText: "随后信号中断。" },
      { title: "分散", startText: "各舰分头航行。" }
    ];
    await authorHandoff("candidate", f.work.workOrder,
      await f.receipt("first", oldAuthor, completeResponse(`片头\n舰队为何分散？\n\n正文\n${first}随后信号中断。各舰分头航行。`, published)), "0");
    const candidate = await readData(f.work.candidate);
    const facts = factList("正文首句及章节定位须同步纠正",
      ["/narration", first], ["/publication/platforms/youtube/chapters/0/startText", first]);
    await atomicWriteData(path.join(f.scratch, "fact-errors.json"), facts);
    const edit = { id: 1, after: corrected };
    const incomplete = await f.receipt("incomplete-correction", oldAuthor, JSON.stringify({ edits: [edit] }));
    const journalFile = path.join(f.scratch, "correction-handoff.json");
    let failedJournal;
    if (legacy) {
      failedJournal = { taskDigest: candidate.taskDigest, receiptSha256: hashObject(await readData(incomplete)),
        beforeSha256: hashObject(candidate.result), ...applyFactEdits(candidate.result, JSON.stringify({ edits: [edit] }), facts) };
      await atomicWriteData(journalFile, failedJournal);
    }
    await assert.rejects(authorHandoff("correct", f.work.workOrder, incomplete, "0"), /正文定位缺失或不唯一/u);
    assert.deepEqual(await readData(f.work.candidate), candidate);
    if (legacy) assert.deepEqual(await readData(journalFile), failedJournal);
    else await assert.rejects(readData(journalFile), { code: "ENOENT" });
    const edits = [edit, { ...edit, id: 2 }];
    const receipt = await f.receipt("complete-correction", oldAuthor, JSON.stringify({ edits }));
    if (legacy) {
      await atomicWriteData(f.work.candidate, { ...candidate, result: { ...candidate.result, narration: candidate.result.narration + "另有改动。" } });
      await assert.rejects(authorHandoff("correct", f.work.workOrder, receipt, "0"), /只能恢复原回包及原候选/u);
      await atomicWriteData(f.work.candidate, candidate);
    }
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    const accepted = await readData(f.work.candidate);
    assert.equal(accepted.result.publication.platforms.youtube.chapters[0].startText, corrected);
    assert.equal(accepted.result.narration, candidate.result.narration.replace(first, corrected));
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    assert.deepEqual(await readData(f.work.candidate), accepted);
    await assert.rejects(authorHandoff("correct", f.work.workOrder,
      await f.receipt("different-return", oldAuthor, JSON.stringify({ edits }, null, 2)), "0"), /只能恢复原回包及原候选/u);
    assert.deepEqual(await readData(f.work.candidate), accepted);
  });
});

test("一体作者调用实时报告、立即保存回包或半稿，恢复不再次发起", async t => {
  for (const mode of ["正常", "需要核对的工具拒绝", "中断", "会话身份冲突"]) await t.test(mode, async t => {
    const f = await setup(t, { scope: null });
    const promptFile = path.join(f.scratch, "prompt.md");
    await atomicWrite(promptFile, "只读，不修改文件。测试提示");
    const receipt = { status: "SUCCESS", conversation_id: oldAuthor, response: spoken };
    const firstText = "片头\n舰队为何";
    let calls = 0, sendResult, finish, finished = false, reported = false, savedBeforeExit = false, textBeforeResult = false;
    const spawnImpl = (command, args, options) => {
      calls++;
      assert.equal(command, "agy");
      assert.equal(args[args.indexOf("--model") + 1], "gemini-3.8-flash-high");
      assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
      assert.ok(!args.includes("--conversation"));
      const child = new EventEmitter(); child.pid = 123456;
      child.stdout = new PassThrough();
      const emit = event => child.stdout.write(`${JSON.stringify(event)}\n`);
      emit({ event: "init", conversation_id: oldAuthor });
      const emitResponse = (state, text_delta) => emit({ event: "step_update", step_update: {
        conversation_id: oldAuthor, step_index: 1, step_type: "agent_response", state, text_delta } });
      emitResponse("ACTIVE", firstText);
      sendResult = () => {
        if (mode === "会话身份冲突") emit({ event: "step_update", step_update: {
          conversation_id: otherAuthor, step_type: "agent_response", text_delta: "其它会话原文" } });
        emitResponse("DONE", receipt.response.slice(firstText.length));
        emit({ event: "result", result: receipt });
      };
      const timeout = setTimeout(() => finish(), 500);
      finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (mode === "需要核对的工具拒绝") writeSync(options.stdio[2], mode);
        child.stdout.end();
        child.emit("close", mode === "中断" ? null : 0, mode === "中断" ? "SIGTERM" : null);
      };
      return child;
    };
    const report = message => {
      if (!reported && message.includes("正在返回正文")) {
        reported = true;
        if (mode === "中断") finish();
        else sendResult();
      } else if (message.includes("可先审阅")) {
        textBeforeResult = !savedBeforeExit;
      } else if (message.includes("原回包已保存")) {
        savedBeforeExit = !finished;
        finish();
      }
    };
    const result = await callAuthor({ workOrderFile: f.work.workOrder, route: "1", promptFile, spawnImpl, report, progressMs: 5 });
    assert.equal(reported, true);
    assert.equal(savedBeforeExit, mode !== "中断");
    assert.equal(textBeforeResult, mode !== "中断");
    if (mode !== "正常") {
      assert.equal(result.action, "inspect-call-result");
      assert.equal((await readData(path.join(f.scratch, "author-1.json"))).phase, "writing");
    } else assert.equal((await readData(path.join(f.scratch, "author-1.json"))).phase, "received");
    assert.equal((await callAuthor({ workOrderFile: f.work.workOrder, route: "1", promptFile, spawnImpl })).action, "recover-existing-call");
    assert.equal(calls, 1);
    if (mode === "中断") {
      assert.equal(await readFile(result.reviewPath, "utf8"), firstText);
      assert.equal((await readFile(result.exitPath, "utf8")).trim(), "SIGTERM");
    } else {
      assert.deepEqual(await readData(result.receiptPath), receipt);
      const [status, issue] = (await readFile(result.exitPath, "utf8")).trim().split("\n");
      assert.equal(status, "0");
      if (mode === "会话身份冲突") {
        assert.match(issue, /会话身份不一致/u);
        await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", result.receiptPath, "0"), /会话身份不一致/u);
      } else assert.equal(issue, undefined);
    }
  });
});

test("同一AGY会话换回包路径并发续接也只启动一次", async t => {
  const f = await setup(t);
  const bin = path.join(f.workspaceRoot, "fake-bin");
  const release = path.join(f.scratch, "release");
  const starts = path.join(f.scratch, "starts");
  const prompt = path.join(f.scratch, "prompt.txt");
  await mkdir(bin);
  await atomicWrite(prompt, "原作者续写");
  await writeFile(path.join(bin, "agy"), '#!/bin/sh\nprintf "start\\n" >> "$P1_AGY_TEST_STARTS"\n'
    + 'while [ ! -e "$P1_AGY_TEST_RELEASE" ]; do /bin/sleep 0.02; done\n', { mode: 0o755 });
  const handoff = fileURLToPath(new URL("../packages/modules/author-narration/scripts/author-handoff.mjs", import.meta.url));
  const args = name => [handoff, "call", f.work.workOrder, path.join(f.scratch, `${name}.agy.json`), prompt,
    "--conversation", newAuthor];
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    P1_AGY_TEST_STARTS: starts, P1_AGY_TEST_RELEASE: release };
  const first = spawn(process.execPath, args("first"), { env, stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise((resolve, reject) => { first.once("error", reject); first.once("close", resolve); });
  try {
    const initial = await Promise.race([new Promise(resolve => first.stderr.once("data", resolve)), exited]);
    assert.match(String(initial), /已启动/u);
    await assert.rejects(promisify(execFile)(process.execPath, args("second"), { env, timeout: 2_000 }), /同一AGY会话已有进程执行/u);
    await assert.rejects(readFile(path.join(f.scratch, "second.agy.json")), { code: "ENOENT" });
  } finally {
    await atomicWrite(release, "done");
    await exited;
  }
  assert.equal(await readFile(starts, "utf8"), "start\n");
});

test("补写发布内容时仍可收取沿用旧503的完整回复", async t => {
  const f = await setup(t);
  await authorHandoff("candidate", f.work.workOrder, await f.receipt("new", newAuthor), "0");
  const home = path.join(f.workspaceRoot, "agy-home");
  const logs = path.join(home, ".gemini", "antigravity-cli", "brain", newAuthor, ".system_generated", "logs");
  await mkdir(logs, { recursive: true });
  const error = "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
  const prompt = "请补写同稿的发布文案和封面构思。";
  const shared = structuredClone(publication);
  shared.platforms.youtube.visibleTopics = ["舰队"];
  delete shared.platforms.xiaohongshu.body;
  const response = JSON.stringify(shared);
  const steps = [
    { type: "USER_INPUT", source: "USER_EXPLICIT", content: "撰写首稿。" },
    { type: "ERROR_MESSAGE", source: "SYSTEM", error },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", content: spoken },
    { type: "USER_INPUT", source: "USER_EXPLICIT", content: prompt },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", content: response }
  ];
  await atomicWrite(path.join(logs, "transcript_full.jsonl"), steps.map((step, step_index) => JSON.stringify({ ...step, step_index })).join("\n"));
  const promptFile = path.join(f.scratch, "publication-prompt.txt");
  const receiptFile = path.join(f.scratch, "publication.agy.json");
  await atomicWrite(promptFile, prompt);
  await atomicWrite(receiptFile.replace(/\.json$/u, ".stderr.log"), "");
  await atomicWriteData(receiptFile, { conversation_id: newAuthor, status: "ERROR", finished_reason: "error", error, response });
  const handoff = fileURLToPath(new URL("../packages/modules/author-narration/scripts/author-handoff.mjs", import.meta.url));
  const receive = () => promisify(execFile)(process.execPath,
    [handoff, "publication", f.work.workOrder, receiptFile, "0", "--recover-503", promptFile],
    { env: { ...process.env, HOME: home } });
  const exitFile = receiptFile.replace(/\.json$/u, ".exit.txt");
  for (const status of ["", "SIGTERM\n"]) {
    await atomicWrite(exitFile, status);
    await assert.rejects(receive(), /退出记录尚未确认正常退出/u);
  }
  await atomicWrite(exitFile, "0\n");
  await receive();
  const result = (await readData(f.work.candidate)).result.publication;
  assert.deepEqual(result.covers, publication.covers);
  assert.equal(result.platforms.xiaohongshu.body, shared.platforms.youtube.description);
  assert.equal(result.platforms.youtube.description, `${shared.platforms.youtube.description}\n\n#舰队`);
  assert.equal((await readData(receiptFile)).status, "ERROR");
});

test("容量503后仅用同轮已完成的原稿恢复误标失败的首稿", async t => {
  const f = await setup(t, { scope: null });
  const home = path.join(f.workspaceRoot, "agy-home");
  const logs = path.join(home, ".gemini", "antigravity-cli", "brain", oldAuthor, ".system_generated", "logs");
  const transcript = path.join(logs, "transcript_full.jsonl");
  await mkdir(logs, { recursive: true });
  const prompt = "只读本单材料，返回完整原稿。";
  const promptFile = path.join(f.scratch, "author-prompt.txt");
  await atomicWrite(promptFile, prompt);
  const { receiptPath } = await authorHandoff("start", f.work.workOrder, "1");
  const stderr = receiptPath.replace(/\.json$/u, ".stderr.log");
  await atomicWrite(stderr, "");
  const response = spoken;
  const error = "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
  await atomicWriteData(receiptPath, { conversation_id: oldAuthor, status: "ERROR", finished_reason: "error", response: `${response}\n`, error });
  const originalReceipt = await readFile(receiptPath, "utf8");
  const input = { step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", content: `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>` };
  const retry = { step_index: 1, type: "ERROR_MESSAGE", source: "SYSTEM", error };
  const completed = { step_index: 2, type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", content: response };
  const saveSteps = (...steps) => atomicWrite(transcript, steps.map(step => JSON.stringify(step)).join("\n"));
  const handoff = fileURLToPath(new URL("../packages/modules/author-narration/scripts/author-handoff.mjs", import.meta.url));
  const receive = (exit = "0") => promisify(execFile)(process.execPath,
    [handoff, "receive", f.work.workOrder, "1", receiptPath, exit, "--recover-503", promptFile],
    { env: { ...process.env, HOME: home } });
  await authorHandoff("mark", f.work.workOrder, "1", "failed", "原回包带503");
  await saveSteps(input, completed, { ...retry, step_index: 3 });
  await assert.rejects(receive(), /未证明同轮重试后完整交稿/u);
  await saveSteps({ ...input, content: "其它任务" }, retry, completed);
  await assert.rejects(receive(), /最后一轮与本次原提示不符/u);
  await saveSteps(input, retry, completed);
  await assert.rejects(receive("3"), /调用未确认正常退出/u);
  await atomicWrite(stderr, "Permission denied");
  await assert.rejects(receive(), /须有可核对的空stderr/u);
  await atomicWrite(stderr, "");

  assert.equal(JSON.parse((await receive()).stdout).phase, "received");
  const draft = await readData(path.join(f.scratch, "author-1.json"));
  assert.equal(draft.conversationId, oldAuthor);
  assert.equal(draft.result.narration, "旗舰转向后，各舰失去统一行动。");
  assert.equal(await readFile(receiptPath, "utf8"), originalReceipt);
  assert.equal(JSON.parse((await receive()).stdout).phase, "received");
  await assert.rejects(readFile(f.work.candidate), { code: "ENOENT" });

  const published = structuredClone(publication);
  published.platforms.youtube.chapters = [
    { title: "开场", startText: "旗舰转向后" },
    { title: "队形", startText: "正文里不存在" },
    { title: "结局", startText: "战斗结束" }
  ];
  const body = `${spoken}队形从中间断开。战斗结束，舰队回港。`;
  const second = body;
  const draft2 = await authorHandoff("start", f.work.workOrder, "2");
  await authorHandoff("start", f.work.workOrder, "3");
  const third = await f.receipt("third", newAuthor);
  await authorHandoff("receive", f.work.workOrder, "3", third, "0");
  const failed = { conversation_id: otherAuthor, status: "ERROR", finished_reason: "error", error };
  await atomicWriteData(draft2.receiptPath, { ...failed, response: `${second}\n` });
  await atomicWrite(draft2.receiptPath.replace(/\.json$/u, ".stderr.log"), "");
  await authorHandoff("mark", f.work.workOrder, "2", "failed", "原回包带503");
  const replacement = await authorHandoff("retry", f.work.workOrder, "2", "--authorize-retry");
  await authorHandoff("session", f.work.workOrder, "2", `pid:${process.pid}`);
  const locationPrompt = path.join(f.scratch, "chapter-prompt.txt");
  const locationReceipt = path.join(f.scratch, "chapter.agy.json");
  const location = JSON.stringify({ chapterIndex: 1, startText: "队形从中间断开。" });
  const locationRequest = "只交原第二章在正文中的定位。";
  await atomicWrite(locationPrompt, locationRequest);
  await atomicWriteData(locationReceipt, { ...failed, response: `${location}\n` });
  await atomicWrite(locationReceipt.replace(/\.json$/u, ".stderr.log"), "");
  const secondLogs = logs.replace(oldAuthor, otherAuthor);
  await mkdir(secondLogs, { recursive: true });
  await atomicWrite(path.join(secondLogs, "transcript_full.jsonl"), [input, retry, { ...completed, content: second },
    { ...input, step_index: 3, content: locationRequest }, { ...completed, step_index: 4, content: location }
  ].map(step => JSON.stringify(step)).join("\n"));
  const restore = () => promisify(execFile)(process.execPath, [handoff, "receive", f.work.workOrder, "2",
    draft2.receiptPath, "0", "--use-original",
    "--recover-503", promptFile], { env: { ...process.env, HOME: home } });
  await assert.rejects(restore(), /重试调用尚未确认结束/u);
  const replacementBody = `${spoken}这是一份重试稿。`;
  await atomicWriteData(replacement.receiptPath, { conversation_id: newAuthor, status: "SUCCESS", response: replacementBody });
  await authorHandoff("receive", f.work.workOrder, "2", replacement.receiptPath, "0");
  assert.equal(JSON.parse((await restore()).stdout).phase, "received");
  const restored = await readData(draft2.draftPath);
  assert.equal(restored.conversationId, otherAuthor);
  assert.equal(restored.result.narration, body.split("\n").at(-1));
  assert.equal(restored.result.publication, undefined);
  assert.equal(restored.supersededRetry.conversationId, newAuthor);
  assert.equal((await readData(replacement.receiptPath)).response, replacementBody);
  assert.equal((await readData(draft2.receiptPath)).response, `${second}\n`);
  await authorHandoff("select", f.work.workOrder, "2");
  await assert.rejects(restore(), /选稿前才可/u);
  const { receiptPath: packagingReceipt } = await authorHandoff("package-start", f.work.workOrder, "2");
  const publicationReply = JSON.stringify(published);
  const publicationRequest = "只写所选稿的发布内容。";
  const publicationPrompt = path.join(f.scratch, "publication-prompt.txt");
  await atomicWrite(publicationPrompt, publicationRequest);
  await atomicWriteData(packagingReceipt, { ...failed, response: publicationReply });
  await atomicWrite(packagingReceipt.replace(/\.json$/u, ".stderr.log"), "");
  const handoffPublication = (...args) => promisify(execFile)(process.execPath, [handoff, "package-receive", f.work.workOrder, "2",
    packagingReceipt, "0", ...args, "--recover-503", publicationPrompt], { env: { ...process.env, HOME: home } });
  const publicationTurn = [input, retry, { ...completed, content: second },
    { ...input, step_index: 3, content: publicationRequest }, { ...completed, step_index: 4, content: publicationReply }];
  const secondTranscript = path.join(secondLogs, "transcript_full.jsonl");
  await atomicWrite(secondTranscript, publicationTurn.map(step => JSON.stringify(step)).join("\n"));
  await assert.rejects(handoffPublication(), /正文定位缺失或不唯一/u);
  await atomicWrite(secondTranscript, [...publicationTurn,
    { ...input, step_index: 5, content: locationRequest }, { ...completed, step_index: 6, content: location }
  ].map(step => JSON.stringify(step)).join("\n"));
  const packageOutput = await handoffPublication("--chapter-location", locationReceipt, "0", locationPrompt);
  assert.equal(JSON.parse(packageOutput.stdout).phase, "packaged");
  const result = (await readData(f.work.candidate)).result;
  assert.equal(result.narration, restored.result.narration);
  assert.deepEqual(result.publication.platforms.youtube.chapters,
    published.platforms.youtube.chapters.map((chapter, i) => i === 1 ? { ...chapter, startText: "队形从中间断开。" } : chapter));
  assert.equal((await readData(draft2.draftPath)).chapterLocationReceipt, locationReceipt);
  await compactAcceptedNarrationMaterials({ workspaceRoot: f.workspaceRoot, episodeId: f.episodeId, materialExecutionId: f.executionId });
  assert.deepEqual(await readData(packagingReceipt), { ...failed, response: publicationReply });
  assert.equal((await readData(locationReceipt)).response, `${location}\n`);
});

test("正文定点仅交新正文，锁定片头和发布内容由程序继承", async t => {
  const f = await setup(t);
  const { taskDigest, ...base } = await readData(f.work.workOrder);
  Object.assign(base.inputs, { currentScriptPackage: { narration: "旧正文。" },
    currentOpenerNarration: { openerNarration: "舰队为何分散？" },
    currentPublication: { ...publication, schemaVersion: "7.0", episodeId: "ep01", targetId: "release-main",
      coverReuse: { baselinePublicationSha256: "a".repeat(64) } } });
  await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });
  const receipt = await f.receipt("only-body", newAuthor, JSON.stringify({ narration: "旗舰转向后，各舰失去统一行动。" }));
  await authorHandoff("candidate", f.work.workOrder, receipt, "0", "--reuse-publication");
  const result = (await readData(f.work.candidate)).result;
  assert.equal(result.openerNarration, base.inputs.currentOpenerNarration.openerNarration);
  assert.deepEqual(result.publication, base.inputs.currentPublication);

  await atomicWriteData(path.join(f.scratch, "fact-errors.json"), factList("旗舰应为首舰", ["/narration", "旗舰"]));
  const correction = await f.receipt("correction", newAuthor, JSON.stringify({ edits: [{ id: 1, after: "首舰" }] }));
  await authorHandoff("correct", f.work.workOrder, correction, "0");
  await authorHandoff("correct", f.work.workOrder, correction, "0");
  const corrected = (await readData(f.work.candidate)).result;
  assert.deepEqual(corrected, { ...result, narration: "首舰转向后，各舰失去统一行动。" });
});

test("定点返工不以旧稿补齐漏交字段，实际交回原文仍可接纳", async t => {
  for (const scope of ["narration", "opener"]) await t.test(scope, async t => {
    const f = await setup(t, { scope });
    const { taskDigest, ...base } = await readData(f.work.workOrder);
    const body = "旗舰转向后，各舰失去统一行动。", opener = "舰队为何分散？";
    Object.assign(base.inputs, { currentScriptPackage: { narration: body },
      currentOpenerNarration: { openerNarration: opener },
      currentPublication: { ...publication, schemaVersion: "7.0", episodeId: "ep01", targetId: "release-main" } });
    await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });
    const author = scope === "narration" ? newAuthor : oldAuthor;
    for (const missing of [{}, { openerNarration: opener }, ...(scope === "opener" ? [{ narration: body }] : [])]) {
      await assert.rejects(authorHandoff("candidate", f.work.workOrder,
        await f.receipt("missing", author, JSON.stringify(missing)), "0", "--reuse-publication"));
      await assert.rejects(readFile(f.work.candidate), { code: "ENOENT" });
    }
    await authorHandoff("candidate", f.work.workOrder,
      await f.receipt("authored", author, JSON.stringify({ narration: body, ...(scope === "opener" ? { openerNarration: opener } : {}) })), "0", "--reuse-publication");
    assert.equal((await readData(f.work.candidate)).result.narration, body);
  });
});

test("事实纠错可删除封面完整文字项，其余内容与同次恢复保持一致", async t => {
  const f = await setup(t, { scope: "opener" });
  await authorHandoff("candidate", f.work.workOrder, await f.receipt("first", oldAuthor, completeResponse()), "0");
  const before = (await readData(f.work.candidate)).result;
  const field = "/publication/covers/youtube/visibleText/1";
  await atomicWriteData(path.join(f.scratch, "fact-errors.json"), factList("第二个字组没有依据", [field, "为何分散"]));
  const edit = { id: 1, after: null };
  assert.throws(() => applyFactEdits(before, JSON.stringify({ edits: [edit] }), factList("错误", [field, "分散"])), /完整原文/u);
  const firstField = "/publication/covers/youtube/visibleText/0";
  const multiFacts = factList("去掉前两项", [firstField, "舰队转向"], [field, "为何分散"]);
  const multiEdits = { edits: [edit, { id: 2, after: null }] };
  assert.deepEqual(applyFactEdits(before, JSON.stringify(multiEdits), multiFacts).result.publication.covers.youtube.visibleText, ["测试节目"]);
  const receipt = await f.receipt("remove", oldAuthor, JSON.stringify({ edits: [edit] }));
  await authorHandoff("correct", f.work.workOrder, receipt, "0");
  await authorHandoff("correct", f.work.workOrder, receipt, "0");
  const expected = structuredClone(before);
  expected.publication.covers.youtube.visibleText.splice(1, 1);
  assert.deepEqual((await readData(f.work.candidate)).result, expected);
});

test("封面纠错按最终文字重算换字与复用标记，并能恢复同次交接", async t => {
  for (const restore of [true, false]) await t.test(restore ? "恢复原字" : "纠正原字", async t => {
    const f = await setup(t, { scope: "publication-copy" });
    const { taskDigest, ...base } = await readData(f.work.workOrder);
    Object.assign(base.inputs, {
      currentScriptPackage: { schemaVersion: "3.0", episodeId: "ep01", language: "zh-CN", narration: "旗舰转向后，各舰失去统一行动。" },
      currentOpenerNarration: { openerNarration: "舰队为何分散？" },
      returnRequest: { revisionScope: "publication-copy", publicationFields: ["covers.youtube.visibleText"],
        baselineCovers: publication.covers, baselinePlatforms: publication.platforms,
        baselinePublicationSha256: "a".repeat(64), baselineCoverImages: { youtube: { sha256: "b".repeat(64) }, vertical: { sha256: "c".repeat(64) } } }
    });
    await atomicWriteData(f.work.workOrder, { ...base, taskDigest: hashObject(base) });
    const published = structuredClone(publication);
    if (restore) published.covers.youtube = { ...published.covers.youtube,
      visibleText: ["舰队覆灭", ...published.covers.youtube.visibleText.slice(1)] };
    await authorHandoff("candidate", f.work.workOrder, await f.receipt("first", oldAuthor, JSON.stringify(published)), "0");
    await atomicWriteData(path.join(f.scratch, "fact-errors.json"),
      factList("第一字组需要纠正", ["/publication/covers/youtube/visibleText/0", restore ? "舰队覆灭" : "舰队转向"]));
    const receipt = await f.receipt("correct", oldAuthor, JSON.stringify({ edits: [{ id: 1, after: restore ? "舰队转向" : "舰队分散" }] }));
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    const result = (await readData(f.work.candidate)).result.publication;
    assert.equal(result[restore ? "coverTextEdit" : "coverReuse"], undefined);
    assert.equal(result[restore ? "coverReuse" : "coverTextEdit"].baselinePublicationSha256, "a".repeat(64));
    assert.deepEqual(result.platforms, publication.platforms);
    assert.deepEqual(result.covers.vertical, publication.covers.vertical);
  });
});

test("失效会话重建保留当前稿与事实进度，只绑定一次新作者", async t => {
  const f = await setup(t, { scope: "opener" });
  await authorHandoff("candidate", f.work.workOrder, await f.receipt("first", oldAuthor, completeResponse()), "0");
  const original = (await readData(f.work.candidate)).result;
  await atomicWriteData(path.join(f.scratch, "fact-errors.json"), factList("旗舰应为首舰", ["/narration", "旗舰"]));
  await assert.rejects(authorHandoff("rebuild-context", f.work.workOrder, "会话失效"), /已结束/u);
  const recovery = await authorHandoff("rebuild-context", f.work.workOrder, "原进程已结束，续接明确返回会话不存在", "--previous-ended");
  assert.match(await readFile(recovery.promptPath, "utf8"), /旗舰应为首舰/u);
  const patch = JSON.stringify({ edits: [{ id: 1, after: "首舰" }] });
  const response = await f.receipt("recovered", newAuthor, patch);
  await authorHandoff("correct", f.work.workOrder, response, "0");
  await authorHandoff("correct", f.work.workOrder, response, "0");
  assert.equal((await readFile(path.join(f.scratch, "agy-conversation-id.txt"), "utf8")).trim(), newAuthor);
  assert.deepEqual((await readData(f.work.candidate)).result.publication, original.publication);
  assert.equal((await readData(path.join(f.scratch, "author-recovery.json"))).previousConversationId, oldAuthor);
  assert.equal((await authorHandoff("rebuild-context", f.work.workOrder, "同次恢复", "--previous-ended")).action, "recover-existing-call");
  await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("old", oldAuthor, patch), "0"), /原作者/u);
  await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("other", otherAuthor, patch), "0"), /原作者/u);
});
