import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertProjectPath, atomicWrite, atomicWriteData, hashObject, readData, stableStringify } from "../../../program-utils.mjs";
import { completeCandidate as completePublication } from "../publication.mjs";
import { validateSchema } from "../../../../engine/runtime/schema.mjs";
import { copyReusableNarrationSources } from "../../../../engine/p1-revision-materials.mjs";

const systemRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const conversationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = message => { throw new Error(message); };

async function readOptional(file) {
  try { return await readData(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function loadContext(workOrderFile) {
  const workOrderPath = path.resolve(workOrderFile);
  const info = await lstat(workOrderPath);
  if (!info.isFile() || info.isSymbolicLink() || path.basename(workOrderPath) !== "work-order.yaml") fail("必须提供当前普通工作单文件");
  const task = await readData(workOrderPath);
  const { taskDigest, ...base } = task;
  if (hashObject(base) !== taskDigest) fail("工作单自身摘要不一致");
  if (task.runner !== "ai" || task.workflowId !== "narration" || task.stageId !== "p1"
    || !["author-narration", "author-documentary-narration"].includes(task.moduleId)
    || task.nodeId !== task.moduleId) fail("不是当前P1作者工作单");
  const candidate = task.candidatePath;
  if (typeof candidate !== "string" || path.isAbsolute(candidate) || candidate.includes("\\")
    || candidate.split("/").some(part => !part || part === "." || part === "..")
    || path.basename(candidate) !== "candidate.yaml"
    || !/^[a-f0-9]{64}$/u.test(task.executionId ?? "")) fail("P1工作路径或执行身份无效");
  const parent = path.dirname(candidate);
  let workspaceRoot = path.dirname(workOrderPath);
  for (const _ of parent.split("/")) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, parent, "work-order.yaml") !== workOrderPath
    || task.scratchPath !== `${parent}/attempt-${task.executionId}`) fail("工作目录未绑定当前工作单");
  const scratch = path.resolve(workspaceRoot, task.scratchPath);
  const candidatePath = path.resolve(workspaceRoot, candidate);
  for (const file of [scratch, candidatePath]) await assertProjectPath({ root: workspaceRoot, file, label: "P1交接路径" });
  if (!(await lstat(scratch)).isDirectory()) fail("P1材料目录不存在");
  return { task, workspaceRoot, scratch, candidatePath, scope: task.inputs?.returnRequest?.revisionScope };
}

async function safeFile(context, file) {
  await assertProjectPath({ root: context.workspaceRoot, file, label: "P1交接文件" });
  return file;
}

async function draftFile(context, route) {
  if (!["1", "2", "3"].includes(String(route))) fail("作者路号必须为1至3");
  if (["opener", "narration", "publication-copy", "publication-all", "cover-content"].includes(context.scope)) fail("定点返工不建立三路工作稿");
  return safeFile(context, path.join(context.scratch, `author-${route}.json`));
}

async function loadDraft(context, route) {
  const file = await draftFile(context, route);
  const draft = await readData(file);
  if (draft.taskDigest !== context.task.taskDigest) fail("作者工作稿不属于当前工作单");
  return { file, draft };
}

function receiptPath(context, route, draft) {
  const suffix = draft.failures?.length ? `.retry-${draft.failures.length}` : "";
  return path.join(context.scratch, `author-${route}${suffix}.agy.json`);
}

// Only remove the declared response envelope; never rewrite narration contents.
const headingPattern = names => new RegExp(`^(?:#{1,6}[ \\t]+)?(?:\\*\\*)?(${names})(?:\\*\\*)?[ \\t]*[:：]?[ \\t]*\\r?$`, "gmu");

export function parseAuthorResponse(response) {
  if (typeof response !== "string" || !response.trim()) fail("作者回包缺少response");
  let text = response.trim();
  const fenced = /^```[^\r\n]*\r?\n([\s\S]*)\r?\n```$/u.exec(text);
  if (fenced) text = fenced[1].trim();
  const headings = [...text.matchAll(headingPattern("片头|正文"))];
  const expected = "片头,正文";
  if (headings.map(match => match[1]).join(",") !== expected || text.slice(0, headings[0].index).trim()) {
    fail("不能唯一解析片头/正文边界；保留原回包，由执行者辨认交付问题，不猜测或删改文字");
  }
  const openerNarration = text.slice(headings[0].index + headings[0][0].length, headings[1]?.index).trim();
  const narration = text.slice(headings[1].index + headings[1][0].length).trim();
  if (!openerNarration || !narration) fail("作者回包没有完整口播");
  return { openerNarration, narration };
}

export function parsePublication(response) {
  const text = response.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, "$1");
  const result = JSON.parse(text);
  if (!result || Array.isArray(result) || typeof result !== "object") fail("发布内容回包须为JSON对象");
  return result;
}

function parseCompleteResponse(response, requirePublication = false) {
  const text = response.trim();
  const starts = [...text.matchAll(headingPattern("片头"))];
  if (starts[0]?.index === 0 && starts.length > 1) {
    const copies = starts.map((start, index) => text.slice(start.index, starts[index + 1]?.index).trim());
    if (!copies.every(copy => copy === copies[0])) fail("作者回包含多份不同稿件，不能自动取舍");
    response = copies[0];
  }
  const boundaries = [...response.matchAll(headingPattern("发布内容"))];
  if (boundaries.length > 1) fail("不能唯一解析发布内容边界；保留原回包，不猜测或删改文字");
  if (!boundaries.length && requirePublication) fail("缺少发布内容边界；须交付发布文案与封面构思");
  const boundary = boundaries[0];
  const spoken = boundary ? response.slice(0, boundary.index).trim() : response;
  const publication = boundary
    ? parsePublication(response.slice(boundary.index + boundary[0].length)) : undefined;
  return { ...parseAuthorResponse(spoken), ...(publication ? { publication } : {}) };
}

function completeResult(context, spoken) {
  const { task } = context;
  return {
    schemaVersion: "3.0",
    episodeId: task.subject.id,
    seriesTitle: task.inputs.episodeBrief.seriesTitle,
    language: "zh-CN",
    ...spoken
  };
}

async function validateResult(context, result, draftOnly = false) {
  if (result.publication) completePublication({ result: result.publication,
    context: { ...context.task.inputs, episodeId: context.task.subject.id, targetId: "release-main" } });
  const moduleDirectory = path.join(systemRoot, "packages/modules", context.task.moduleId);
  const manifest = await readData(path.join(moduleDirectory, "package.yaml"));
  await validateSchema(path.join(moduleDirectory, manifest.outputSchema), result, "P1作者交付");
  const validator = await import(pathToFileURL(path.join(moduleDirectory, manifest.validator)).href);
  const args = { result, context: { ...context.task.inputs, episodeId: context.task.subject.id },
    services: { task: context.task, systemRoot, draftOnly } };
  const errors = [...await validator.validate(args), ...await validator.validateAcceptance(args)];
  if (errors.length) fail(errors.join("；"));
}

async function readReceipt(context, receiptFile, exitCode) {
  if (exitCode !== "0") fail("调用未确认正常退出；保留状态，由执行者判断明确失败或恢复原调用");
  const file = path.resolve(receiptFile);
  await safeFile(context, file);
  if (!file.startsWith(`${context.scratch}${path.sep}`)) fail("原始回包须保存在本单材料目录");
  const receipt = JSON.parse(await readFile(file, "utf8"));
  if (receipt.status !== "SUCCESS") fail("回包未确认SUCCESS；不能将未知结果自动标为失败");
  if (!conversationPattern.test(receipt.conversation_id ?? "")) fail("回包缺少合法作者会话身份");
  return receipt;
}

export async function authorHandoff(command, workOrderFile, ...args) {
  const context = await loadContext(workOrderFile);
  const { task, scratch, scope } = context;
  if (command === "select") {
    const selected = Number(args[0]);
    await draftFile(context, args[0]);
    const records = await Promise.all([1, 2, 3].map(route => loadDraft(context, route)));
    const conversations = new Set();
    let locked;
    for (const [index, { draft }] of records.entries()) {
      const route = index + 1;
      if (task.moduleId === "author-narration" && draft.phase === "failed") {
        fail(`第${route}路明确失败；解说必须收齐三路完整方案后选稿，保留现场并报告`);
      }
      if (!["received", "failed"].includes(draft.phase)) fail(`第${route}路不在首稿选稿阶段；恢复原调用或选后进度`);
      if (draft.phase === "failed" && !draft.failure?.trim()) fail(`第${route}路缺少明确失败原因`);
      if (draft.conversationId != null) {
        if (!conversationPattern.test(draft.conversationId)) fail(`第${route}路会话身份非法`);
        const identity = draft.conversationId.toLowerCase();
        if (conversations.has(identity)) fail("初始作者会话必须互不相同");
        conversations.add(identity);
      }
      if (draft.phase === "received" && (!draft.conversationId || draft.factErrors !== null
        || !draft.result || Array.isArray(draft.result) || "_producer" in draft.result
        || ["narration", "openerNarration"].some(field => typeof draft.result[field] !== "string" || !draft.result[field].trim()))) {
        fail(`第${route}路没有完整未审首稿与作者身份`);
      }
      if (draft.phase === "received" && task.moduleId === "author-narration") {
        await validateResult(context, draft.result);
      }
      if (Object.hasOwn(draft, "selectedOpener")) {
        if (draft.selectedOpener !== route || locked !== undefined) fail("选择记录必须唯一绑定同一路完整作品");
        locked = route;
      }
    }
    const { file, draft } = records[selected - 1];
    if (draft.phase !== "received") fail("不能选择失败稿");
    if (locked !== undefined && locked !== selected) fail("已锁定其它作者，只能恢复原选择");
    const identityFile = await safeFile(context, path.join(scratch, "agy-conversation-id.txt"));
    const identity = await readFile(identityFile, "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const existing = await readData(context.candidatePath).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const candidate = { taskDigest: task.taskDigest, result: draft.result };
    if (identity !== null && identity.trim() !== draft.conversationId) fail("已锁定其它作者，只能恢复原选择");
    if (existing !== undefined && stableStringify(existing) !== stableStringify(candidate)) fail("当前候选与选定稿不一致，保留现场");
    if (locked === undefined) {
      if (identity !== null || existing !== undefined) fail("已有交接缺少整稿选择记录，保留现场");
      // Persist the choice first so interrupted identity/candidate writes resume it.
      draft.selectedOpener = selected;
      await atomicWriteData(file, draft);
    }
    if (identity === null) await atomicWrite(identityFile, `${draft.conversationId}\n`);
    if (existing === undefined) await atomicWriteData(context.candidatePath, candidate);
    return { selectedAuthor: selected, selectedOpener: selected,
      conversationId: draft.conversationId, candidatePath: task.candidatePath };
  }
  if (command === "prepare-reference") {
    if (["opener", "narration", "publication-copy", "publication-all", "cover-content"].includes(scope)) fail("定点返工只消费工作单已固定材料");
    const brief = task.inputs.episodeBrief;
    if (task.moduleId !== "author-narration") fail("正文材料快照用于解说取材，纪录片沿原Query交接");
    if (brief.referenceProgram && !Array.isArray(task.inputs.programPlan.referenceVideos)) fail("当前工作单没有参考节目原文输入");
    const base = brief.referenceProgram ? { referenceProgram: brief.referenceProgram,
      referenceVideoIds: brief.referenceVideoIds, videos: task.inputs.programPlan.referenceVideos } : {};
    const file = await safeFile(context, path.join(scratch, "reference-materials.json"));
    const existing = await readOptional(file);
    const { documents: previousDocuments = [], ...previousBase } = existing ?? {};
    if (existing && stableStringify(previousBase) !== stableStringify(base)) fail("已有原材料不同，保留现场，不能覆盖本次取材依据");
    const documents = args[0]
      ? await readData(await safeFile(context, path.resolve(args[0]))) : previousDocuments;
    if (!Array.isArray(documents) || documents.some(document =>
      !document || ["title", "source", "text"].some(key => typeof document[key] !== "string" || !document[key].trim()))) {
      fail("正文材料须为含title、source和实际text的数组");
    }
    if (!brief.referenceProgram && !documents.length) fail("没有可保存的参考节目或正文材料");
    if (previousDocuments.some(previous => !documents.some(document => stableStringify(document) === stableStringify(previous)))) {
      fail("不能删改已保存的正文依据；补充材料须保留原文");
    }
    const result = { ...base, ...(documents.length ? { documents } : {}) };
    const reused = existing !== null && stableStringify(existing) === stableStringify(result);
    if (!reused) await atomicWriteData(file, result);
    return { referenceMaterials: file, reused };
  }
  if (command === "publication") {
    if (!["opener", "narration"].includes(scope)) fail("单路发布补写只用于口播定点返工");
    const receipt = await readReceipt(context, args[0], args[1]);
    const conversationId = (await readFile(path.join(scratch, "agy-conversation-id.txt"), "utf8")).trim();
    if (receipt.conversation_id !== conversationId) fail("发布内容必须续接当前原作者");
    const candidate = await readData(context.candidatePath);
    if (candidate.taskDigest !== task.taskDigest) fail("候选不属于当前工作单");
    const result = { ...candidate.result, publication: parsePublication(receipt.response) };
    await validateResult(context, result);
    if (candidate.result.publication && stableStringify(candidate.result) !== stableStringify(result)) fail("只能恢复同一次发布内容回包");
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    return { candidatePath: context.candidatePath, conversationId };
  }
  if (command === "package-start" || command === "package-receive") {
    if (task.moduleId === "author-narration") fail("解说首稿已交整套方案，选后直接核对，不再补写发布内容");
    const [route, receiptFile, exitCode] = args;
    const { file, draft } = await loadDraft(context, route);
    if (draft.selectedOpener !== Number(route)) fail("发布内容只由已选作者续写");
    if (command === "package-start") {
      if (!["received", "packaging", "packaged"].includes(draft.phase)) fail("当前不在发布内容创作步骤");
      const started = draft.phase === "received";
      if (started) { draft.phase = "packaging"; draft.sessionId = null; await atomicWriteData(file, draft); }
      return { started, phase: draft.phase, sessionId: draft.sessionId, conversationId: draft.conversationId,
        receiptPath: path.join(scratch, `author-${route}.publication.agy.json`) };
    }
    if (!["packaging", "packaged"].includes(draft.phase)) fail("先进入原作者发布内容续写步骤");
    const receipt = await readReceipt(context, receiptFile, exitCode);
    if (receipt.conversation_id !== draft.conversationId) fail("发布内容必须续接所选原作者会话");
    const publication = parsePublication(receipt.response);
    completePublication({ result: publication, context: { ...task.inputs, episodeId: task.subject.id, targetId: "release-main" } });
    const candidate = await readData(context.candidatePath);
    const result = { ...candidate.result, publication };
    await validateResult(context, result);
    if (draft.phase === "packaged" && stableStringify(candidate.result) !== stableStringify(result)) fail("只能恢复同一次发布内容回包");
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    draft.phase = "packaged";
    await atomicWriteData(file, draft);
    return { candidatePath: context.candidatePath, phase: draft.phase };
  }
  if (["candidate", "correct"].includes(command)) {
    const [receiptFile, exitCode] = args;
    const receipt = await readReceipt(context, receiptFile, exitCode);
    const identityFile = await safeFile(context, path.join(scratch, "agy-conversation-id.txt"));
    let selected;
    if (!["opener", "narration", "publication-copy", "publication-all", "cover-content"].includes(scope)) {
      for (const route of [1, 2, 3]) {
        const record = await loadDraft(context, route);
        if (record.draft.selectedOpener === route) selected = record;
      }
      if (command !== "correct" || !selected || !["correcting", "ready"].includes(selected.draft.phase)) fail("普通创作只从选中稿的纠错步骤更新候选");
    }
    const previousConversation = await readFile(identityFile, "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const rewriteNarration = scope === "narration" && task.moduleId === "author-narration";
    const sourceConversation = task.inputs.reusedNarrationMaterials?.agyConversation?.conversationId;
    const currentConversation = previousConversation?.trim();
    const expectedConversation = selected?.draft.conversationId
      ?? (rewriteNarration
        ? (currentConversation !== sourceConversation ? currentConversation : null)
        : sourceConversation ?? currentConversation);
    if (rewriteNarration && receipt.conversation_id === sourceConversation) fail("正文整篇重写须开启新作者会话");
    if (command === "correct" && !expectedConversation) fail("纠错缺少原作者会话");
    if (expectedConversation && expectedConversation !== receipt.conversation_id) fail("必须使用原作者会话");
    let result;
    if (["publication-copy", "publication-all", "cover-content"].includes(scope)) {
      result = completeResult(context, { narration: task.inputs.currentScriptPackage.narration,
        openerNarration: task.inputs.currentOpenerNarration.openerNarration,
        publication: parsePublication(receipt.response) });
    } else {
      result = completeResult(context, parseCompleteResponse(receipt.response));
    }
    // Documentary corrections delegate mechanical validation to the existing accept path.
    if (!(command === "correct" && task.moduleId === "author-documentary-narration")) await validateResult(context, result, command === "candidate" && ["opener", "narration"].includes(scope));
    if (selected?.draft.phase === "ready") {
      const existing = await readData(context.candidatePath);
      if (stableStringify(existing) !== stableStringify({ taskDigest: task.taskDigest, result })) fail("已交接纠错结果，只能恢复同一次返回");
    }
    if (command === "candidate" && rewriteNarration) await copyReusableNarrationSources({
      workspaceRoot: context.workspaceRoot, episodeId: task.subject.id,
      episodeBrief: task.inputs.episodeBrief, materials: task.inputs.reusedNarrationMaterials,
      executionId: task.executionId
    });
    if (!previousConversation || rewriteNarration) await atomicWrite(identityFile, `${receipt.conversation_id}\n`);
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    if (selected) {
      selected.draft.phase = "ready";
      await atomicWriteData(selected.file, selected.draft);
    }
    return { candidatePath: context.candidatePath, conversationId: receipt.conversation_id };
  }
  const [route, value, extra] = args;
  const file = await draftFile(context, route);
  if (command === "retry") {
    if (task.moduleId !== "author-narration" || value !== "--authorize-retry") fail("解说首稿重试须有用户明确授权并提供--authorize-retry");
    const { draft } = await loadDraft(context, route);
    if (draft.phase === "writing" && draft.failures?.length) {
      return { started: false, draftPath: file, phase: draft.phase, sessionId: draft.sessionId,
        receiptPath: receiptPath(context, route, draft) };
    }
    const records = await Promise.all([1, 2, 3].map(id => loadDraft(context, id)));
    if (records.some(({ draft: other }) => !["received", "failed"].includes(other.phase)
      || Object.hasOwn(other, "selectedOpener")) || await readOptional(context.candidatePath)) fail("原首稿调用须全部结束且尚未选稿");
    if (draft.phase !== "failed" || !draft.failure?.trim() || draft.result !== null
      || draft.factErrors !== null) fail("只重试明确失败且未交付的首稿，未知或已交付稿件保持原状");
    const { failures = [], ...previous } = draft;
    const previousReceipt = receiptPath(context, route, draft);
    const next = { taskDigest: task.taskDigest, phase: "writing", conversationId: null,
      result: null, factErrors: null, sessionId: null,
      failures: [...failures, { ...previous, receiptPath: previousReceipt }] };
    await atomicWriteData(file, next);
    return { started: true, draftPath: file, phase: next.phase, sessionId: null,
      receiptPath: receiptPath(context, route, next) };
  }
  if (command === "start") {
    const existing = await readOptional(file);
    if (existing && existing.taskDigest !== task.taskDigest) fail("已有作者记录属于其它任务");
    const draft = existing ?? { taskDigest: task.taskDigest, phase: "writing", conversationId: null,
      result: null, factErrors: null, sessionId: null };
    if (!existing) await atomicWriteData(file, draft);
    return { started: !existing, draftPath: file, phase: draft.phase, sessionId: draft.sessionId,
      conversationId: draft.conversationId, receiptPath: receiptPath(context, route, draft) };
  }
  const { draft } = await loadDraft(context, route);
  if (command === "session") {
    if (!["writing", "packaging", "correcting"].includes(draft.phase) || !value) fail("只有writing/packaging/correcting可记录原终端会话");
    if (draft.sessionId !== null && String(draft.sessionId) !== String(value)) fail("已有终端会话，只能恢复原调用");
    draft.sessionId = /^\d+$/u.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
  } else if (command === "receive") {
    if (!["writing", "received"].includes(draft.phase)) fail("本路已失败或进入核对，不能重新接收首稿");
    if (draft.failures?.length && path.resolve(value) !== receiptPath(context, route, draft)) fail("重试只能接收本次返回的新回包路径，原失败回包保留");
    const receipt = await readReceipt(context, value, extra);
    const fullExplainer = task.moduleId === "author-narration";
    const result = completeResult(context, fullExplainer
      ? parseCompleteResponse(receipt.response, true) : parseAuthorResponse(receipt.response));
    await validateResult(context, result, !fullExplainer);
    if (draft.result && (stableStringify(draft.result) !== stableStringify(result)
      || draft.conversationId !== receipt.conversation_id)) fail("首稿已经保存，不能替换原稿或作者");
    draft.conversationId = receipt.conversation_id;
    draft.result = result;
    draft.phase = "received";
  } else if (command === "mark") {
    if (!["reviewing", "correcting", "ready", "failed"].includes(value)) fail("未知的现有作者进度");
    if (value === "failed") {
      if (!extra?.trim()) fail("明确失败须提供原因；未知结果保持原状态");
      draft.failure = extra;
    } else {
      if (draft.selectedOpener !== Number(route)) fail("只更新已选稿的事实核对进度");
      const next = { received: task.moduleId === "author-narration" ? ["reviewing"] : [],
        packaged: ["reviewing"], reviewing: ["correcting", "ready"], correcting: [], ready: [] };
      if (value !== draft.phase && !next[draft.phase]?.includes(value)) fail("不能重置已执行的事实核对或纠错进度");
      if (extra) {
        const facts = await readData(await safeFile(context, path.resolve(extra)));
        if (!Array.isArray(facts)) fail("事实清单必须为执行者实际给出的数组");
        if (draft.factErrors === null && draft.phase === "reviewing" && ["correcting", "ready"].includes(value)) {
          draft.factErrors = facts;
        } else if (!Array.isArray(draft.factErrors) || stableStringify(draft.factErrors) !== stableStringify(facts)) {
          fail("原事实清单只能恢复，不能覆盖或重建");
        }
      }
      if (["correcting", "ready"].includes(value) && !Array.isArray(draft.factErrors)) fail("先交接本次实际事实清单");
      if (value === "correcting" && draft.phase !== "correcting") draft.sessionId = null;
    }
    draft.phase = value;
  } else fail("动作须为prepare-reference/start/retry/session/receive/select/package-start/package-receive/publication/mark/candidate/correct");
  await atomicWriteData(file, draft);
  return { draftPath: file, phase: draft.phase, conversationId: draft.conversationId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorHandoff(...process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
