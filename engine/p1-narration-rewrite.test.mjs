import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWrite, atomicWriteData, hashObject, readData } from "../packages/program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../packages/workspace-paths.mjs";
import { authorHandoff } from "../packages/modules/author-narration/scripts/author-handoff.mjs";
import { validate as validatePublication } from "../packages/modules/author-narration/publication.mjs";
import { validateCommon } from "../packages/modules/author-narration/validate.mjs";
import { compactAcceptedNarrationMaterials, resolveReusableNarrationMaterials, validateReusableNarrationMaterials } from "./p1-revision-materials.mjs";
import {getPublicationPaths} from '../packages/publication-paths.mjs';
import {assertPublicationRevisionHasNoRemoteActivity} from './runtime/publication-requests.mjs';
import {preparePublicationRevision} from './runtime/revise-publication.mjs';

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

test("解说三路交齐整套方案再选，选后直接核对并恢复原稿", async (t) => {
  for (const scope of [null, "full"]) await t.test(scope ?? "首次", async (t) => {
    const f = await setup(t, { scope });
    const authors = [oldAuthor, newAuthor, otherAuthor];
    for (const route of [1, 2, 3]) await authorHandoff("start", f.work.workOrder, route);
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", await f.receipt("incomplete", oldAuthor), "0"), /发布文案与封面构思/u);
    const invalid = structuredClone(publication);
    delete invalid.covers.vertical;
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", await f.receipt("bad-cover", oldAuthor, completeResponse(spoken, invalid)), "0"), /vertical/u);
    await assert.rejects(authorHandoff("select", f.work.workOrder, "1"), /首稿选稿阶段/u);
    for (const route of [1, 2, 3]) {
      const published = structuredClone(publication);
      published.platforms.youtube.title = published.platforms.youtube.title.replace("舰队为何分散", `舰队为何分散第${route}路`);
      published.covers.youtube.posterConcept += `第${route}路构思。`;
      const receipt = await f.receipt(`complete-${route}`, authors[route - 1], completeResponse(`${spoken}第${route}路。`, published));
      await authorHandoff("receive", f.work.workOrder, String(route), receipt, "0");
      await authorHandoff("receive", f.work.workOrder, String(route), receipt, "0");
      if (route === 2) await assert.rejects(authorHandoff("select", f.work.workOrder, "2"), /第3路.*首稿选稿阶段/u);
    }
    await assert.rejects(readData(f.work.candidate), { code: "ENOENT" });
    const selectedFile = path.join(f.scratch, "author-2.json");
    const original = (await readData(selectedFile)).result;
    await authorHandoff("select", f.work.workOrder, "2");
    assert.deepEqual((await readData(f.work.candidate)).result, original);
    assert.match(original.publication.platforms.youtube.title, /第2路/u);
    assert.match(original.publication.covers.youtube.posterConcept, /第2路/u);
    await assert.rejects(authorHandoff("select", f.work.workOrder, "1"), /其它作者/u);
    await rm(f.work.candidate);
    await rm(path.join(f.scratch, "agy-conversation-id.txt"));
    await authorHandoff("select", f.work.workOrder, "2");
    assert.deepEqual((await readData(f.work.candidate)).result, original);
    await assert.rejects(authorHandoff("package-start", f.work.workOrder, "2"), /解说.*整套/u);
    await assert.rejects(authorHandoff("package-receive", f.work.workOrder, "2"), /解说.*整套/u);
    await authorHandoff("mark", f.work.workOrder, "2", "reviewing");
    const facts = path.join(f.scratch, "facts.json");
    const originalFacts = ["只修本次已确认的事实错误"];
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
    const corrected = completeResponse(`${spoken}已纠正。`);
    await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("wrong-author", oldAuthor, corrected), "0"), /原作者/u);
    const receipt = await f.receipt("correct-suite", newAuthor, corrected);
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    await authorHandoff("correct", f.work.workOrder, receipt, "0");
    assert.deepEqual((await readData(selectedFile)).result, original);
    assert.equal((await readData(selectedFile)).phase, "ready");
    assert.deepEqual((await readData(selectedFile)).factErrors, originalFacts);
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

test("整套发布保留国内平台话题合同，接受无话题的YouTube自然标题及独立封面文案", async (t) => {
  const f = await setup(t, { scope: null });
  await authorHandoff("start", f.work.workOrder, "1");
  const cases = [
    ["空封面文字", (p) => { p.covers.vertical.visibleText = []; }, /P1发布内容/u],
    ["封面过多项", (p) => { p.covers.youtube.visibleText.push("额外文字"); }, /P1发布内容/u],
    ["只有话题", (p) => { p.platforms.youtube.title = "#舰队 #航海 #海战 #历史 #指挥"; }, /须有标题文字/u],
    ["抖音过少", (p) => { p.platforms.douyin.topics.pop(); }, /P1发布内容/u],
    ["抖音过多", (p) => { p.platforms.douyin.topics.push("指挥"); }, /P1发布内容/u],
    ["小红书过少", (p) => { p.platforms.xiaohongshu.topics.pop(); }, /P1发布内容/u],
    ["小红书过多", (p) => { p.platforms.xiaohongshu.topics.push("海军"); }, /P1发布内容/u],
  ];
  for (const [name, change, expected] of cases) {
    const invalid = structuredClone(publication);
    // 单独改变竖版，保留横版作为比较基准。
    invalid.covers.vertical = structuredClone(invalid.covers.vertical);
    change(invalid);
    const receipt = await f.receipt(name, oldAuthor, completeResponse(spoken, invalid));
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", receipt, "0"), expected);
    await assert.rejects(readData(f.work.candidate), { code: "ENOENT" });
  }
  const valid = structuredClone(publication);
  valid.platforms.youtube.title = "旗舰转向之后，舰队失去统一行动｜舰队指挥";
  valid.covers.youtube = { ...valid.covers.youtube, visibleText: ["转向之后"] };
  valid.covers.vertical = { ...valid.covers.vertical, visibleText: ["舰队为何", "失去指挥？"] };
  await authorHandoff("receive", f.work.workOrder, "1", await f.receipt("valid", oldAuthor, completeResponse(spoken, valid)), "0");
  assert.deepEqual((await readData(path.join(f.scratch, "author-1.json"))).result.publication.covers.vertical, valid.covers.vertical);
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

test("完全重复的整套回包只收同一稿，原回执保留；不同稿件仍拒绝", async (t) => {
  const f = await setup(t, { scope: null });
  for (const route of [1, 2]) await authorHandoff("start", f.work.workOrder, route);
  const single = `${spoken}\n\n发布内容\n\`\`\`json\n${JSON.stringify(publication)}\n\`\`\``;
  const receipt = await f.receipt("repeated", oldAuthor, `${single}\n`.repeat(3));
  const raw = await readFile(receipt, "utf8");
  await authorHandoff("receive", f.work.workOrder, "1", receipt, "0");
  const result = (await readData(path.join(f.scratch, "author-1.json"))).result;
  assert.equal(result.narration, spoken.split("\n\n正文\n")[1]);
  assert.deepEqual(result.publication.platforms, publication.platforms);
  assert.equal(await readFile(receipt, "utf8"), raw);
  const changed = single.replace("失去统一行动", "各自行动");
  const ambiguous = await f.receipt("ambiguous", newAuthor, `${single}\n${changed}`);
  await assert.rejects(authorHandoff("receive", f.work.workOrder, "2", ambiguous, "0"), /多份不同稿件/u);
  assert.equal((await readData(path.join(f.scratch, "author-2.json"))).result, null);
});

test("整套标题支持一致的Markdown包装，正文和原回包保持原样", async t => {
  const narration = "旗舰转向后，各舰失去统一行动。\n\n文中提到发布内容，但它不是交付标题。";
  const published = structuredClone(publication);
  published.platforms.youtube.description = "第一行。\n第二行。";
  for (const heading of [text => text, text => `**${text}**`, text => `## ${text}`, text => `### **${text}**：`]) {
    const f = await setup(t, {scope: null});
    await authorHandoff("start", f.work.workOrder, "1");
    const response = `${heading("片头")}\n舰队为何分散？\n\n${heading("正文")}\n${narration}\n\n${heading("发布内容")}\n\`\`\`json\n${JSON.stringify(published)}\n\`\`\``;
    const receipt = await f.receipt("formatted", oldAuthor, response);
    const raw = await readFile(receipt, "utf8");
    await authorHandoff("receive", f.work.workOrder, "1", receipt, "0");
    const result = (await readData(path.join(f.scratch, "author-1.json"))).result;
    assert.equal(result.openerNarration, "舰队为何分散？");
    assert.equal(result.narration, narration);
    assert.deepEqual(result.publication.platforms, published.platforms);
    assert.equal(await readFile(receipt, "utf8"), raw);
  }
});

test("发布内容标题不明或重复时准确报错，不把JSON混入正文", async t => {
  for (const tail of ["发布资料\n{}", "发布内容\n{}\n发布内容\n{}"] ) {
    const f = await setup(t, {scope: null});
    await authorHandoff("start", f.work.workOrder, "1");
    const receipt = await f.receipt("bad-boundary", oldAuthor, `${spoken}\n\n${tail}`);
    await assert.rejects(authorHandoff("receive", f.work.workOrder, "1", receipt, "0"), /发布内容.*边界/u);
    assert.equal((await readData(path.join(f.scratch, "author-1.json"))).result, null);
  }
});

test("解说首次与full不因某路明确失败而减少完整方案数量", async (t) => {
  for (const scope of [null, "full"]) await t.test(scope ?? "首次", async (t) => {
    const f = await setup(t, { scope });
    for (const route of [1, 2, 3]) await authorHandoff("start", f.work.workOrder, route);
    for (const [route, author] of [["1", oldAuthor], ["2", newAuthor]]) {
      await authorHandoff("receive", f.work.workOrder, route,
        await f.receipt(`complete-${route}`, author, completeResponse()), "0");
    }
    await authorHandoff("mark", f.work.workOrder, "3", "failed", "作者进程明确失败");
    const files = [1, 2, 3].map(route => path.join(f.scratch, `author-${route}.json`));
    const drafts = await Promise.all(files.map(file => readData(file)));
    await assert.rejects(authorHandoff("select", f.work.workOrder, "2"), /第3路明确失败.*三路完整方案/u);
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
  const receipt = await f.receipt("doc-publication", newAuthor, JSON.stringify(publication));
  await authorHandoff("package-receive", f.work.workOrder, "2", receipt, "0");
  await authorHandoff("package-receive", f.work.workOrder, "2", receipt, "0");
  await authorHandoff("mark", f.work.workOrder, "2", "reviewing");
  const result = (await readData(f.work.candidate)).result;
  assert.equal(result.narration, "旗舰转向后，各舰失去统一行动。");
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
    const corrected = `${spoken}\n\n发布内容\n${JSON.stringify(publication)}`;
    await assert.rejects(authorHandoff("correct", f.work.workOrder, await f.receipt("wrong-correction", oldAuthor, corrected), "0"), /新作者/u);
    await authorHandoff("correct", f.work.workOrder, await f.receipt("correction", newAuthor, corrected), "0");
    assert.equal((await readData(f.work.candidate)).result.narration, "旗舰转向后，各舰失去统一行动。");
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
