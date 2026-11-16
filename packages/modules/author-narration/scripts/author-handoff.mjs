import { lstat, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertProjectPath, atomicWrite, atomicWriteData, hashObject, readData, stableStringify, withProjectLock } from "../../../program-utils.mjs";
import { completeCandidate as completePublication } from "../publication.mjs";
import { chapterPositionsFor } from "../youtube-description.mjs";
import { validateSchema } from "../../../../engine/runtime/schema.mjs";
import { copyReusableNarrationSources } from "../../../../engine/p1-revision-materials.mjs";
import { runAgy } from "./agy-run.mjs";

const systemRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const conversationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const capacityErrorPattern = /^API error \(attempt \d+\): UNAVAILABLE \(code 503\): No capacity available for model gemini-3\.8-flash-high on the server$/u;
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

async function readCallPrompt(context, promptFile) {
  const file = await safeFile(context, path.resolve(promptFile));
  if (!file.startsWith(`${context.scratch}${path.sep}`)) fail("作者提示须保存在本单材料目录");
  const prompt = await readFile(file, "utf8");
  if (!prompt.trim()) fail("作者提示不能为空");
  return prompt;
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
  if (draft.originalReceipt) return draft.originalReceipt;
  const suffix = draft.failures?.length ? `.retry-${draft.failures.length}` : "";
  return path.join(context.scratch, `author-${route}${suffix}.agy.json`);
}

function confirmedLocalExit(sessionId) {
  const match = /^pid:([1-9]\d*)$/u.exec(sessionId ?? "");
  if (!match) return false;
  try { process.kill(Number(match[1]), 0); }
  catch (error) { return error.code === "ESRCH"; }
  return false;
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

const youtubeDescriptionPath = "/publication/platforms/youtube/description";
const xiaohongshuBodyPath = "/publication/platforms/xiaohongshu/body";

function factTextTarget(result, field) {
  const keys = field.split("/").slice(1);
  if (!field.startsWith("/") || !["narration", "openerNarration", "publication"].includes(keys[0])
    || keys.some(key => !key || ["__proto__", "constructor", "prototype"].includes(key))) fail("纠错只能定位现有创作字段");
  let target = result;
  for (const key of keys.slice(0, -1)) {
    if (!target || !Object.hasOwn(target, key)) fail(`纠错路径不存在: ${field}`);
    target = target[key];
  }
  const key = keys.at(-1);
  if (!target || !Object.hasOwn(target, key) || typeof target[key] !== "string") fail(`纠错路径须为现有文本: ${field}`);
  return { target, key };
}

export function applyFactEdits(baseline, response, factErrors, request) {
  const patch = parsePublication(response);
  if (Object.keys(patch).join() !== "edits" || !Array.isArray(patch.edits) || !patch.edits.length
    || !Array.isArray(factErrors) || !factErrors.length) fail("纠错只接收绑定原事实清单的edits，不接收整稿");
  const result = structuredClone(baseline);
  const locations = new Map();
  for (const [index, fact] of factErrors.entries()) {
    if (!Array.isArray(fact?.places) || !fact.places.length) fail("事实清单须为每处原文登记定位");
    for (const place of fact.places) {
      const { id, path: field, before } = place ?? {};
      if (!Number.isSafeInteger(id) || id < 1 || locations.has(id)
        || typeof field !== "string" || typeof before !== "string" || !before.length) fail("事实清单定位须含唯一编号、路径和原文");
      locations.set(id, { error: index + 1, path: field, before });
    }
  }
  const edits = [];
  const replacements = [];
  const removals = [];
  const removedPaths = new Set();
  for (const patchEdit of patch.edits) {
    const location = locations.get(patchEdit?.id);
    if (!location || Object.keys(patchEdit).sort().join() !== "after,id"
      || (typeof patchEdit.after !== "string" && patchEdit.after !== null)
      || location.before === patchEdit.after) fail("纠错只接收清单中每个编号的一处替换文字");
    locations.delete(patchEdit.id);
    const edit = { ...location, after: patchEdit.after };
    const { target, key } = factTextTarget(result, edit.path);
    edits.push(edit);
    const text = target[key];
    if (edit.after === null) {
      if (!Array.isArray(target) || !/^(0|[1-9][0-9]*)$/u.test(key) || text !== edit.before)
        fail("删除文字项须定位数组中的完整原文");
      if (removedPaths.has(edit.path)) fail(`纠错定位互相重叠: ${edit.path}`);
      removedPaths.add(edit.path);
      removals.push({ target, index: Number(key) });
      continue;
    }
    const start = text.indexOf(edit.before);
    if (start < 0 || text.indexOf(edit.before, start + 1) >= 0) fail(`纠错原文不能唯一定位: ${edit.path}`);
    if (edit.path === youtubeDescriptionPath && factErrors[edit.error - 1]?.sharedDescription === true) {
      const fields = request?.publicationFields;
      const xiaohongshu = result.publication.platforms.xiaohongshu;
      const body = xiaohongshu?.body;
      if (request?.revisionScope === "cover-content"
        || (fields && !["youtube.description", "xiaohongshu.body"].every(field => fields.includes(field)))
        || typeof body !== "string" || !body || !text.startsWith(body) || start + edit.before.length > body.length
        || !/^(?:\n\n#[^#\s]+(?: #[^#\s]+)*)?$/u.test(text.slice(body.length))) {
        fail("共用文案纠错须获准同时修改两边，并唯一定位逐字相同的正文");
      }
      const mirror = { ...edit, path: xiaohongshuBodyPath };
      edits.push(mirror);
      replacements.push({ target: xiaohongshu, key: "body", start, edit: mirror });
    }
    replacements.push({ target, key, start, edit });
  }
  replacements.sort((a, b) => a.edit.path.localeCompare(b.edit.path) || b.start - a.start);
  let previous;
  for (const replacement of replacements) {
    const { target, key, start, edit } = replacement;
    const end = start + edit.before.length;
    if (removedPaths.has(edit.path) || (previous?.edit.path === edit.path && end > previous.start))
      fail(`纠错定位互相重叠: ${edit.path}`);
    target[key] = target[key].slice(0, start) + edit.after + target[key].slice(end);
    previous = replacement;
  }
  removals.sort((a, b) => b.index - a.index);
  for (const { target, index } of removals) target.splice(index, 1);
  return { result, edits };
}

async function correctedResult(context, receipt, selected, retainedResult) {
  const candidate = await readOptional(context.candidatePath);
  if ((candidate && candidate.taskDigest !== context.task.taskDigest) || (!candidate && !retainedResult)) {
    fail("纠错候选不属于当前工作单");
  }
  const baseline = retainedResult ?? candidate.result;
  const file = await safeFile(context, path.join(context.scratch, "correction-handoff.json"));
  const saved = await readOptional(file);
  const receiptSha256 = hashObject(receipt);
  if (saved) {
    if (saved.taskDigest !== context.task.taskDigest
      || ![saved.beforeSha256, hashObject(saved.result)].includes(hashObject(candidate?.result ?? baseline))
      || (retainedResult && saved.beforeSha256 !== hashObject(baseline))) fail("纠错交接只能恢复原回包及原候选");
    if (saved.receiptSha256 === receiptSha256) {
      if (context.task.moduleId !== "author-documentary-narration") await validateResult(context, saved.result);
      return saved;
    }
    // A rejected result is not a committed handoff. Older calls saved this
    // journal before validation, so only an untouched baseline may recover it.
    if (context.task.moduleId === "author-documentary-narration" || selected?.draft.phase === "ready"
      || hashObject(candidate?.result ?? baseline) !== saved.beforeSha256) fail("纠错交接只能恢复原回包及原候选");
    let rejected = false;
    try { await validateResult(context, structuredClone(saved.result)); }
    catch { rejected = true; }
    if (!rejected) fail("纠错交接只能恢复原回包及原候选");
  }
  if (retainedResult && candidate && hashObject(candidate.result) !== hashObject(baseline)) {
    fail("原稿重新纠错不能覆盖其它候选");
  }
  const facts = selected?.draft.factErrors ?? await readOptional(path.join(context.scratch, "fact-errors.json"));
  const correction = applyFactEdits(baseline, receipt.response, facts, context.task.inputs.returnRequest);
  if (correction.result.publication
    && stableStringify(correction.result.publication) !== stableStringify(baseline.publication)) {
    // These bindings describe the final text, not the author's previous draft.
    delete correction.result.publication.coverTextEdit;
    delete correction.result.publication.coverReuse;
    completePublication({ result: correction.result.publication,
      context: { ...context.task.inputs, episodeId: context.task.subject.id, targetId: "release-main" } });
  }
  if (context.task.moduleId !== "author-documentary-narration") await validateResult(context, correction.result);
  const journal = { taskDigest: context.task.taskDigest, receiptSha256,
    beforeSha256: hashObject(baseline), ...correction };
  // This temporary write allows exact recovery if candidate or progress saving is interrupted.
  await atomicWriteData(file, journal);
  return journal;
}

async function readRetainedSelection(context, route) {
  const { task, scope, workspaceRoot, scratch } = context;
  const materials = task.inputs.reusedNarrationMaterials;
  if (task.moduleId !== "author-narration" || scope !== "narration" || !["1", "2", "3"].includes(route)
    || !materials?.sourceAttempt || !materials.authorTask?.source) fail("重新纠错须指定正文返工单所绑定的已选原稿");
  const source = await safeFile(context, path.resolve(workspaceRoot, materials.sourceAttempt));
  if (path.dirname(source) !== path.dirname(scratch) || path.basename(source) !== `attempt-${materials.materialExecutionId}`
    || source === scratch) fail("留存首稿路径未绑定本单原材料");
  const draft = await readData(await safeFile(context, path.join(source, `author-${route}.json`)));
  const receiptName = path.basename(receiptPath({ scratch: source }, route, draft));
  const originalPath = await safeFile(context, path.join(source, receiptName));
  const original = await readData(originalPath);
  const spoken = await parseAuthorReply(context, originalPath, original, parseCompleteResponse, { retained: true });
  if (draft.phase !== "ready" || draft.selectedOpener !== Number(route) || !draft.result
    || draft.conversationId !== materials.agyConversation?.conversationId || original.conversation_id !== draft.conversationId
    || draft.result.narration !== spoken.narration || draft.result.openerNarration !== spoken.openerNarration
    || draft.result.openerNarration !== task.inputs.returnRequest?.exactOpenerNarration) {
    fail("须使用现行材料的已选原稿、原作者及锁定片头");
  }
  const result = draft.publication ? { ...draft.result, publication: draft.publication } : draft.result;
  return { draft, result, source };
}

async function copyRetainedSelection(context, source) {
  const taskFile = await safeFile(context, path.resolve(context.workspaceRoot, context.task.inputs.reusedNarrationMaterials.authorTask.source));
  await atomicWrite(path.join(context.scratch, "author-task.md"), await readFile(taskFile));
  for (const name of await readdir(source)) {
    if (!/^author-[123](?:\.retry-\d+|\.publication)?(?:\.agy\.json|\.stderr\.log|\.json)$/u.test(name)) continue;
    const file = await safeFile(context, path.join(source, name));
    await atomicWrite(path.join(context.scratch, name), await readFile(file));
  }
}

function singleSpokenReply(response) {
  if (typeof response !== "string" || !response.trim()) fail("作者回包缺少response");
  const text = response.trim();
  const starts = [...text.matchAll(headingPattern("片头"))];
  if (starts[0]?.index === 0 && starts.length > 1) {
    const copies = starts.map((start, index) => text.slice(start.index, starts[index + 1]?.index).trim());
    if (!copies.every(copy => copy === copies[0])) fail("作者回包含多份不同稿件，不能自动取舍");
    return copies[0];
  }
  return text;
}

function parseSpokenDraft(response) {
  const spoken = singleSpokenReply(response);
  if (headingPattern("发布内容").test(spoken)) fail("解说首稿只交正文和片头；发布内容由所选作者续写");
  return parseAuthorResponse(spoken);
}

function parseCompleteResponse(response) {
  response = singleSpokenReply(response);
  const boundaries = [...response.matchAll(headingPattern("发布内容"))];
  if (boundaries.length > 1) fail("不能唯一解析发布内容边界；保留原回包，不猜测或删改文字");
  const boundary = boundaries[0];
  const spoken = boundary ? response.slice(0, boundary.index).trim() : response;
  const publication = boundary
    ? parsePublication(response.slice(boundary.index + boundary[0].length)) : undefined;
  return { ...parseAuthorResponse(spoken), ...(publication ? { publication } : {}) };
}

async function readAgyTranscript(conversationId) {
  const transcript = path.join(homedir(), ".gemini", "antigravity-cli", "brain",
    conversationId, ".system_generated", "logs", "transcript_full.jsonl");
  return (await readFile(transcript, "utf8")).trim().split("\n").map(line => JSON.parse(line));
}

function agyUserPrompt(content) {
  return /^<USER_REQUEST>\r?\n([\s\S]*?)\r?\n<\/USER_REQUEST>(?:\r?\n|$)/u.exec(content)?.[1] ?? content;
}

async function parseAuthorReply(context, file, receipt, parse, { prompt, retained = false, continuation = false, priorTurn = false } = {}) {
  try {
    return parse(receipt.response);
  } catch (error) {
    if (receipt.status !== "SUCCESS" || typeof receipt.response !== "string" || (!prompt && !retained)
      || !conversationPattern.test(receipt.conversation_id ?? "")) throw error;

    const diagnostic = await readFile(await safeFile(context, file.replace(/\.json$/u, ".stderr.log")), "utf8")
      .catch(() => null);
    const records = await readAgyTranscript(receipt.conversation_id).catch(() => null);
    if (diagnostic === null || diagnostic.trim() || !records) throw error;
    const isInput = step => step?.type === "USER_INPUT";
    const start = priorTurn ? records.findLastIndex(step => isInput(step) && typeof step.content === "string"
      && agyUserPrompt(step.content).trim() === prompt?.trim())
      : continuation ? records.findLastIndex(isInput) : records.findIndex(isInput);
    const next = records.findIndex((step, index) => index > start && isInput(step));
    const input = records[start];
    if (input?.source !== "USER_EXPLICIT" || typeof input.content !== "string"
      || (prompt && (next !== -1 || agyUserPrompt(input.content).trim() !== prompt.trim()))) throw error;

    const turn = records.slice(start + 1, next === -1 ? records.length : next);
    const responses = turn.filter(step => step?.type === "PLANNER_RESPONSE" && step.content);
    const final = responses.at(-1);
    // A successful AGY envelope can concatenate tool preambles with the final reply.
    // Use only the native final step when the entire original response matches.
    if (responses.length < 2 || final !== turn.at(-1) || final.tool_calls?.length
      || turn.some(step => step?.type === "ERROR_MESSAGE")
      || responses.some(step => step.source !== "MODEL" || step.status !== "DONE" || typeof step.content !== "string")
      || responses.slice(0, -1).some(step => !step.tool_calls?.length)
      || responses.map(step => step.content).join("\n").trimEnd() !== receipt.response.trimEnd()) throw error;
    return parse(final.content);
  }
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

function expandSharedDescription(publication, request) {
  const { platforms } = publication;
  const youtube = platforms?.youtube;
  if (!youtube || !Object.hasOwn(youtube, "visibleTopics")) return;
  const fields = request?.publicationFields;
  if (request?.revisionScope === "cover-content"
    || (fields && !["youtube.description", "xiaohongshu.body"].every(field => fields.includes(field)))) {
    fail("只有本次同时修改YouTube简介与小红书正文时才交共用文案");
  }
  const { description, visibleTopics } = youtube;
  const xiaohongshu = Object.hasOwn(platforms, "xiaohongshu") ? platforms.xiaohongshu : {};
  if (typeof description !== "string" || !description.trim() || !xiaohongshu
    || typeof xiaohongshu !== "object" || Array.isArray(xiaohongshu) || Object.hasOwn(xiaohongshu, "body")
    || !Array.isArray(visibleTopics) || visibleTopics.some(topic => typeof topic !== "string" || !/^[^#\s]+$/u.test(topic))) {
    fail("共用文案须放入YouTube description，visibleTopics交无井号的独立话题数组，小红书省略body");
  }
  xiaohongshu.body = description;
  platforms.xiaohongshu = xiaohongshu;
  if (visibleTopics.length) youtube.description += `\n\n${visibleTopics.map(topic => `#${topic}`).join(" ")}`;
  delete youtube.visibleTopics;
}

async function validateResult(context, result, draftOnly = false) {
  if (result.publication) {
    expandSharedDescription(result.publication, context.task.inputs.returnRequest);
    completePublication({ result: result.publication,
      context: { ...context.task.inputs, episodeId: context.task.subject.id, targetId: "release-main" } });
  }
  const moduleDirectory = path.join(systemRoot, "packages/modules", context.task.moduleId);
  const manifest = await readData(path.join(moduleDirectory, "package.yaml"));
  await validateSchema(path.join(moduleDirectory, manifest.outputSchema), result, "P1作者交付");
  const validator = await import(pathToFileURL(path.join(moduleDirectory, manifest.validator)).href);
  const args = { result, context: { ...context.task.inputs, episodeId: context.task.subject.id },
    services: { task: context.task, systemRoot, draftOnly } };
  const errors = [...await validator.validate(args), ...await validator.validateAcceptance(args)];
  if (errors.length) fail(errors.join("；"));
}

async function verifyRecoveredTurn(context, file, receipt, prompt, { priorTurn = false } = {}) {
  // Manual and managed calls have both used these stderr names. Any captured
  // diagnostic needs review before this recovery can be used.
  const diagnosticPaths = new Set([file.replace(/\.json$/u, ".stderr.log"), file.replace(/(?:\.agy)?\.json$/u, ".stderr.log")]);
  const diagnostics = await Promise.all([...diagnosticPaths].map(async name =>
    readFile(await safeFile(context, name), "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    })));
  if (diagnostics.every(value => value === null) || diagnostics.some(value => value?.trim())) {
    fail("原503回包须有可核对的空stderr；请保留原调用并核实诊断");
  }

  // The short AGY transcript truncates text. Check the native full log for
  // the same prompt and a completed response after the recorded API error.
  const records = await readAgyTranscript(receipt.conversation_id).catch(() =>
    fail("原503回包缺少可读的AGY完整会话记录；保留原调用"));
  let end = records.length;
  if (priorTurn) {
    const finish = records.findLastIndex((step, index) => typeof step?.content === "string"
      && [step.content, `${step.content}\n`].includes(receipt.response)
      && (index === records.length - 1 || records[index + 1]?.type === "USER_INPUT"));
    if (finish < 0) fail("原503会话未找到本次原稿所在的完整一轮");
    end = finish + 1;
  }
  const start = records.slice(0, end).findLastIndex(step => step?.type === "USER_INPUT");
  const input = records[start];
  if (input?.source !== "USER_EXPLICIT" || typeof input.content !== "string") fail("原503会话缺少本轮用户提示");
  const actualPrompt = agyUserPrompt(input.content);
  if (actualPrompt.trim() !== prompt.trim()) fail("原503会话的最后一轮与本次原提示不符");

  const turn = records.slice(start + 1, end);
  const final = turn.at(-1);
  const errors = turn.filter(step => step?.type === "ERROR_MESSAGE");
  const matchesCapacityError = (steps, response) => steps.some(step => step.error === receipt.error)
    && steps.every(step => step.source === "SYSTEM" && capacityErrorPattern.test(step.error) && step.step_index < response.step_index);
  let capacityConfirmed = matchesCapacityError(errors, final);
  if (!errors.length) {
    // The same 503 can remain in the envelope across completed resumptions.
    let previousEnd = start;
    while (previousEnd > 0) {
      const previousFinal = records[previousEnd - 1];
      const previousStart = records.slice(0, previousEnd).findLastIndex(step => step?.type === "USER_INPUT");
      if (previousStart < 0 || previousFinal?.type !== "PLANNER_RESPONSE" || previousFinal.source !== "MODEL"
        || previousFinal.status !== "DONE" || previousFinal.tool_calls?.length
        || typeof previousFinal.content !== "string" || !previousFinal.content.trim()) break;
      const previousErrors = records.slice(previousStart + 1, previousEnd).filter(step => step.type === "ERROR_MESSAGE");
      if (previousErrors.length) {
        capacityConfirmed = matchesCapacityError(previousErrors, previousFinal);
        break;
      }
      previousEnd = previousStart;
    }
  }
  if (final?.source !== "MODEL" || final.type !== "PLANNER_RESPONSE" || final.status !== "DONE"
    || final.tool_calls?.length || typeof final.content !== "string" || !final.content.trim()
    || ![final.content, `${final.content}\n`].includes(receipt.response)
    || !capacityConfirmed) {
    fail("原503会话未证明同轮重试后完整交稿；保留原回包");
  }
}

async function readReceipt(context, receiptFile, exitCode, recoveryPrompt, recoveryOptions) {
  if (exitCode !== "0") fail("调用未确认正常退出；保留状态，由执行者判断明确失败或恢复原调用");
  const file = path.resolve(receiptFile);
  await safeFile(context, file);
  if (!file.startsWith(`${context.scratch}${path.sep}`)) fail("原始回包须保存在本单材料目录");
  const exitPath = await safeFile(context, file.replace(/\.json$/u, ".exit.txt"));
  const recordedExit = exitPath !== file ? await readFile(exitPath, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  }) : null;
  if (recordedExit !== null) {
    const [status, streamIssue] = recordedExit.trim().split(/\r?\n/u);
    if (status !== "0") fail("原调用退出记录尚未确认正常退出；保留原文供审阅");
    if (streamIssue) fail(`${streamIssue}，原文保留供审阅`);
  }
  const receipt = JSON.parse(await readFile(file, "utf8"));
  if (!conversationPattern.test(receipt.conversation_id ?? "")) fail("回包缺少合法作者会话身份");
  if (receipt.status !== "SUCCESS") {
    if (!recoveryPrompt || receipt.status !== "ERROR" || receipt.finished_reason !== "error"
      || !capacityErrorPattern.test(receipt.error) || typeof receipt.response !== "string" || !receipt.response.trim()) {
      fail("回包未确认SUCCESS或重试后完成；保留原回包，核实具体状态");
    }
    await verifyRecoveredTurn(context, file, receipt, recoveryPrompt, recoveryOptions);
  }
  return receipt;
}

async function applyOriginalChapterLocation(context, result, author, [file, exitCode, promptFile]) {
  const receipt = await readReceipt(context, file, exitCode, await readCallPrompt(context, promptFile));
  if (receipt.conversation_id !== author) fail("只接收原作者的章节定位修复");
  const { chapterIndex, startText, ...rest } = parsePublication(receipt.response);
  const chapters = result.publication?.platforms?.youtube?.chapters;
  const chapter = Number.isInteger(chapterIndex) && chapterIndex >= 0 && chapters?.[chapterIndex];
  if (!chapter || Object.keys(rest).length || typeof startText !== "string" || !startText.trim()
    || !result.narration.includes(startText)) fail("章节修复只能交本章索引及正文中确有的连续原句");
  let originalError;
  try { chapterPositionsFor(chapters, result.narration); }
  catch (error) { originalError = error.message; }
  if (originalError !== `YouTube章节“${chapter.title}”的正文定位缺失或不唯一；返回P1作者修正startText`) {
    fail("只修原稿实际失效的章节定位");
  }
  chapter.startText = startText;
}

async function matchAuthor(context, receipt, expected) {
  const file = await safeFile(context, path.join(context.scratch, "author-recovery.json"));
  const recovery = await readOptional(file);
  if (!recovery && receipt.conversation_id === expected) return;
  if (!recovery || recovery.taskDigest !== context.task.taskDigest || recovery.previousCallEnded !== true
    || ![recovery.previousConversationId, recovery.conversationId].includes(expected)
    || receipt.conversation_id === recovery.previousConversationId
    || (recovery.conversationId && recovery.conversationId !== receipt.conversation_id)) fail("必须使用原作者会话或已登记的上下文恢复作者");
  if (!recovery.conversationId) await atomicWriteData(file, { ...recovery, conversationId: receipt.conversation_id });
  await atomicWrite(path.join(context.scratch, "agy-conversation-id.txt"), `${receipt.conversation_id}\n`);
}

// One invocation owns only start/session/receive. Selection and fact decisions remain with AI.
export async function callAuthor({ workOrderFile, route, promptFile, spawnImpl, progressMs, report }) {
  const context = await loadContext(workOrderFile);
  const prompt = await readCallPrompt(context, promptFile);
  const lock = path.join(context.scratch, `.author-${route}.lock`);
  await draftFile(context, route);
  return withProjectLock({ root: context.workspaceRoot, lock, label: "本路作者调用", execute: async () => {
    const start = await authorHandoff("start", workOrderFile, route);
    if (!start.started) return { ...start, action: "recover-existing-call" };
    const call = await runAgy({ cwd: systemRoot, prompt, receiptPath: start.receiptPath, spawnImpl, progressMs, report,
      onStart: pid => pid && authorHandoff("session", workOrderFile, route, `pid:${pid}`) });
    if (call.action === "inspect-call-result") return { ...start, started: false, ...call };
    try {
      const current = await loadContext(workOrderFile);
      if (current.task.taskDigest !== context.task.taskDigest) fail("作者调用期间工作单已变化");
      const received = await runHandoff(current, workOrderFile, "receive", [route, call.receiptPath, String(call.exitCode)], prompt);
      return { ...call, ...received, action: "received" };
    } catch (error) {
      fail(`AGY实际退出码 ${call.exitCode}，原回包 ${call.receiptPath}：${error.message}`);
    }
  } });
}

export async function authorHandoff(command, workOrderFile, ...args) {
  const context = await loadContext(workOrderFile);
  let recoveryPrompt;
  const flag = args.indexOf("--recover-503");
  if (flag !== -1) {
    if (!["receive", "publication", "package-receive", "candidate", "correct"].includes(command)
      || flag !== args.length - 2 || !args[flag + 1]) fail("--recover-503 后须提供本次原提示文件");
    recoveryPrompt = await readCallPrompt(context, args[flag + 1]);
    args = args.slice(0, flag);
  }
  const execute = () => runHandoff(context, workOrderFile, command, args, recoveryPrompt);
  if (command === "retry" || command === "receive" || (command === "mark" && args[1] === "failed")) {
    const route = args[0];
    await draftFile(context, route);
    return withProjectLock({ root: context.workspaceRoot, lock: path.join(context.scratch, `.author-${route}.lock`),
      label: "本路作者调用", execute });
  }
  if (context.task.moduleId === "author-narration" && ["select", "package-start", "package-receive"].includes(command)) {
    return withProjectLock({ root: context.workspaceRoot, lock: path.join(context.scratch, ".selected-author.lock"),
      label: "本次选稿与发布内容交接", execute });
  }
  return execute();
}

async function documentaryQuotes(context, queryPaths) {
  if (context.task.moduleId !== "author-documentary-narration" || !queryPaths.length) fail("须提供本单纪录片Query路径");
  const sections = [];
  for (const queryPath of queryPaths) {
    const file = await safeFile(context, path.resolve(queryPath));
    const { references } = await readData(file);
    const quotes = [];
    for (const [index, reference] of (Array.isArray(references) ? references : []).entries()) {
      if (typeof reference?.source_id !== "string" || !reference.source_id.trim() || reference.citation_number == null
        || typeof reference.cited_text !== "string" || !reference.cited_text.trim()) continue;
      quotes.push(`出处 ${reference.source_id} · 引用 ${reference.citation_number} · 原索引 ${index}\n\n${reference.cited_text}`);
    }
    if (!quotes.length) fail(`Query没有有效文字引用：${file}`);
    sections.push(`### ${path.basename(file)}\n\n${quotes.join("\n\n")}`);
  }
  return `\n\n## Query引用原文\n\n${sections.join("\n\n")}\n`;
}

async function runHandoff(context, workOrderFile, command, args, recoveryPrompt) {
  const { task, scratch, scope } = context;
  if (command === "call") {
    const [target, promptFile, flag, conversationId] = args;
    if (!target || !promptFile) fail("call须提供路号或原回包绝对路径，以及本次原提示文件");
    if (!path.isAbsolute(target)) {
      if (args.length !== 2) fail("三路首次调用不指定原会话");
      return callAuthor({ workOrderFile, route: target, promptFile });
    }
    if (args.length !== 2 && (args.length !== 4 || flag !== "--conversation" || !conversationPattern.test(conversationId))) {
      fail("续接原作者须提供--conversation及原会话ID");
    }
    const receiptPath = await safeFile(context, path.resolve(target));
    if (!receiptPath.startsWith(`${scratch}${path.sep}`) || !receiptPath.endsWith(".agy.json")) {
      fail("原回包须为本单材料目录内的.agy.json文件");
    }
    if (task.moduleId === "author-narration" && path.dirname(receiptPath) === scratch) {
      const packaging = /^author-([123])\.publication\.agy\.json$/u.exec(path.basename(receiptPath));
      if (packaging) {
        const route = Number(packaging[1]);
        const { draft } = await loadDraft(context, route);
        if (draft.phase !== "packaging" || draft.selectedOpener !== route || conversationId !== draft.conversationId) {
          fail("仅所选原作者可发起本次发布内容续写");
        }
      }
    }
    const prompt = await readCallPrompt(context, promptFile);
    const execute = () => runAgy({ cwd: systemRoot, prompt, receiptPath, conversationId });
    if (!conversationId) return execute();
    return withProjectLock({ root: context.workspaceRoot,
      lock: path.join(path.dirname(scratch), `.agy-${conversationId.toLowerCase()}.lock`),
      label: "同一AGY会话", execute });
  }
  if (command === "rebuild-context") {
    const [reason, ended] = args;
    if (ended !== "--previous-ended" || !reason?.trim()) fail("先确认原调用已结束且原会话无法续接，并交清具体原因");
    const file = await safeFile(context, path.join(scratch, "author-recovery.json"));
    const saved = await readOptional(file);
    if (saved) {
      if (saved.taskDigest !== task.taskDigest) fail("作者恢复记录不属于当前任务");
      return { recovery: saved, promptPath: path.join(scratch, "author-recovery.md"), action: "recover-existing-call" };
    }
    const previousConversationId = (await readFile(path.join(scratch, "agy-conversation-id.txt"), "utf8")
      .catch(error => { if (error.code === "ENOENT") return task.inputs.reusedNarrationMaterials?.agyConversation?.conversationId ?? ""; throw error; })).trim();
    if (!conversationPattern.test(previousConversationId)) fail("缺少可恢复的当前作者身份");
    const candidate = await readOptional(context.candidatePath);
    const drafts = [];
    for (const route of [1, 2, 3]) {
      const draft = await readOptional(path.join(scratch, `author-${route}.json`));
      if (draft?.selectedOpener === route) drafts.push({ route, phase: draft.phase, factErrors: draft.factErrors });
    }
    if ((!scope || scope === "full") && (drafts.length !== 1 || !["packaging", "correcting"].includes(drafts[0].phase)))
      fail("仅恢复所选稿待完成的续写或纠错，不能用会话重建重开首稿");
    if (task.moduleId === "author-narration" && drafts[0]?.phase === "packaging")
      fail("解说发布内容须由所选原作者续写，保留已锁定的正文和片头");
    const recovery = { taskDigest: task.taskDigest, previousConversationId, previousCallEnded: true,
      reason, conversationId: null };
    const promptPath = await safeFile(context, path.join(scratch, "author-recovery.md"));
    await atomicWrite(promptPath, `# 当前P1作者上下文恢复\n\n原调用已结束且无法续接：${reason}\n\n` +
      `读取工作单 ${path.resolve(workOrderFile)}，当前唯一候选 ${context.candidatePath}，本单目录 ${scratch}。\n` +
      `完整读取本次作者任务或短大纲、发布输入及当前所选专业方法；固定原文与Query仍按该作者包的投递边界读取，不扩大作者输入范围。路径相对节目根 ${context.workspaceRoot} 解析。原始正文、正式稿与唯一候选按当前任务用途区分。\n` +
      `本次仅继续已经允许的修改，原稿、未改字段、事实清单和核对次数保持；不重新选稿、不追加润色、不调用其它代理。你只返回本次交接要求的结果，不写项目或节目文件。\n\n` +
      `当前已选进度：\n${JSON.stringify(drafts, null, 2)}\n\n` +
      `当前候选／正式基线：\n${JSON.stringify(candidate?.result ?? { narration: task.inputs.currentScriptPackage?.narration,
        openerNarration: task.inputs.currentOpenerNarration?.openerNarration, publication: task.inputs.currentPublication }, null, 2)}\n\n` +
      `本单事实清单：\n${JSON.stringify(await readOptional(path.join(scratch, "fact-errors.json")), null, 2)}\n`);
    await atomicWriteData(file, recovery);
    return { recovery, promptPath, action: "continue-with-rebuilt-context" };
  }
  if (command === "select") {
    const selected = Number(args[0]);
    await draftFile(context, args[0]);
    const records = await Promise.all([1, 2, 3].map(route => loadDraft(context, route)));
    const conversations = new Set();
    let locked;
    for (const [index, { draft }] of records.entries()) {
      const route = index + 1;
      if (task.moduleId === "author-narration" && draft.phase === "failed") {
        fail(`第${route}路明确失败；解说必须收齐三路正文和片头后选稿，保留现场并报告`);
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
        await validateResult(context, draft.result, true);
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
  if (command === "documentary-quotes") return documentaryQuotes(context, args);
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
    const receipt = await readReceipt(context, args[0], args[1], recoveryPrompt);
    const conversationId = (await readFile(path.join(scratch, "agy-conversation-id.txt"), "utf8")).trim();
    await matchAuthor(context, receipt, conversationId);
    const candidate = await readData(context.candidatePath);
    if (candidate.taskDigest !== task.taskDigest) fail("候选不属于当前工作单");
    const result = { ...candidate.result, publication: parsePublication(receipt.response) };
    await validateResult(context, result);
    if (candidate.result.publication && stableStringify(candidate.result) !== stableStringify(result)) fail("只能恢复同一次发布内容回包");
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    return { candidatePath: context.candidatePath, conversationId };
  }
  if (command === "package-start" || command === "package-receive") {
    const [route, receiptFile, exitCode] = args;
    const { file, draft } = await loadDraft(context, route);
    if (draft.selectedOpener !== Number(route)) fail("发布内容只由已选作者续写");
    const starting = command === "package-start";
    const allowedPhases = starting ? ["received", "packaging", "packaged"] : ["packaging", "packaged"];
    if (!allowedPhases.includes(draft.phase)) fail("当前不在原作者发布内容续写步骤");
    const explainer = task.moduleId === "author-narration";
    const packagingReceipt = path.join(scratch, `author-${route}.publication.agy.json`);
    const candidate = await readData(context.candidatePath);
    if (candidate.taskDigest !== task.taskDigest) fail("发布内容候选不属于当前工作单");
    if (explainer) {
      const { publication, ...spoken } = candidate.result;
      if (stableStringify(spoken) !== stableStringify(draft.result)) fail("发布内容必须承接已锁定的正文和片头");
    }
    if (starting) {
      const started = draft.phase === "received";
      if (started) { draft.phase = "packaging"; draft.sessionId = null; await atomicWriteData(file, draft); }
      return { started, phase: draft.phase, sessionId: draft.sessionId, conversationId: draft.conversationId,
        receiptPath: packagingReceipt };
    }
    const chapterLocation = explainer && args[3] === "--chapter-location" && args.length === 7
      ? args.slice(4) : null;
    if (explainer && (args.length !== (chapterLocation ? 7 : 3) || path.resolve(receiptFile) !== packagingReceipt)) {
      fail("发布内容只收取所选作者本次续写的原回包");
    }
    const receipt = await readReceipt(context, receiptFile, exitCode, recoveryPrompt, { priorTurn: Boolean(chapterLocation) });
    if (explainer) {
      if (receipt.conversation_id !== draft.conversationId) fail("发布内容须由所选原作者会话交付");
    } else {
      await matchAuthor(context, receipt, draft.conversationId);
    }
    const publication = explainer
      ? await parseAuthorReply(context, packagingReceipt, receipt, parsePublication,
        { prompt: recoveryPrompt, continuation: true, priorTurn: Boolean(chapterLocation) })
      : parsePublication(receipt.response);
    const result = { ...candidate.result, publication };
    if (chapterLocation) await applyOriginalChapterLocation(context, result, receipt.conversation_id, chapterLocation);
    await validateResult(context, result);
    if ((draft.phase === "packaged" || (explainer && candidate.result.publication))
        && stableStringify(candidate.result) !== stableStringify(result)) fail("只能恢复同一次发布内容回包");
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    if (explainer) draft.publication = result.publication;
    if (chapterLocation) draft.chapterLocationReceipt = path.resolve(chapterLocation[0]);
    draft.phase = "packaged";
    await atomicWriteData(file, draft);
    return { candidatePath: context.candidatePath, phase: draft.phase };
  }
  if (["candidate", "correct"].includes(command)) {
    const [receiptFile, exitCode, reusePublication, retainedRoute] = args;
    const retained = command === "correct" && reusePublication === "--restore-selected-draft"
      ? await readRetainedSelection(context, retainedRoute) : null;
    const receipt = await readReceipt(context, receiptFile, exitCode, recoveryPrompt);
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
    const expectedConversation = retained?.draft.conversationId ?? selected?.draft.conversationId
      ?? (rewriteNarration
        ? (currentConversation !== sourceConversation ? currentConversation : null)
        : sourceConversation ?? currentConversation);
    if (retained && receipt.conversation_id !== expectedConversation) fail("重新纠错只接收留存首稿的原作者回包");
    if (rewriteNarration && !retained && receipt.conversation_id === sourceConversation) fail("正文整篇重写须开启新作者会话");
    if (command === "correct" && !expectedConversation) fail("纠错缺少原作者会话");
    if (expectedConversation) await matchAuthor(context, receipt, expectedConversation);
    let result, edits;
    if (command === "correct") {
      ({ result, edits } = await correctedResult(context, receipt, selected, retained?.result));
    } else if (["publication-copy", "publication-all", "cover-content"].includes(scope)) {
      result = completeResult(context, { narration: task.inputs.currentScriptPackage.narration,
        openerNarration: task.inputs.currentOpenerNarration.openerNarration,
        publication: parsePublication(receipt.response) });
    } else {
      const spoken = receipt.response.trim().startsWith("{") ? parsePublication(receipt.response) : parseCompleteResponse(receipt.response);
      if (["opener", "narration"].includes(scope)) {
        const allowed = ["openerNarration", "narration", "publication"];
        if (Object.keys(spoken).some(key => !allowed.includes(key))) fail("定点返工只返回本次创作字段");
        // Both scopes author the body (including an opener's necessary transition).
        // Only the explicitly locked opener may be inherited.
        if (typeof spoken.narration !== "string" || !spoken.narration.trim()) fail("定点返工缺少本次作者交付的正文 narration");
        const lockedOpener = task.inputs.returnRequest?.exactOpenerNarration
          ?? (scope === "narration" ? task.inputs.currentOpenerNarration?.openerNarration : undefined);
        if (lockedOpener !== undefined) spoken.openerNarration ??= lockedOpener;
        if (reusePublication === "--reuse-publication") {
          if (!task.inputs.currentPublication) fail("没有可继承的正式发布内容");
          if (spoken.publication && stableStringify(spoken.publication) !== stableStringify(task.inputs.currentPublication)) fail("锁定发布内容不得改写");
          spoken.publication = structuredClone(task.inputs.currentPublication);
        }
      }
      result = completeResult(context, spoken);
    }
    // Corrections validate before journaling; documentary corrections still
    // delegate mechanical validation to the existing accept path.
    if (command !== "correct") await validateResult(context, result, ["opener", "narration"].includes(scope));
    if (selected?.draft.phase === "ready") {
      const existing = await readData(context.candidatePath);
      if (stableStringify(existing) !== stableStringify({ taskDigest: task.taskDigest, result })) fail("已交接纠错结果，只能恢复同一次返回");
    }
    if (rewriteNarration && (command === "candidate" || retained)) await copyReusableNarrationSources({
      workspaceRoot: context.workspaceRoot, episodeId: task.subject.id,
      episodeBrief: task.inputs.episodeBrief, materials: task.inputs.reusedNarrationMaterials,
      executionId: task.executionId
    });
    if (retained) await copyRetainedSelection(context, retained.source);
    if (!previousConversation || rewriteNarration) await atomicWrite(identityFile, `${receipt.conversation_id}\n`);
    await atomicWriteData(context.candidatePath, { taskDigest: task.taskDigest, result });
    if (selected) {
      selected.draft.phase = "ready";
      await atomicWriteData(selected.file, selected.draft);
    }
    return { candidatePath: context.candidatePath, conversationId: receipt.conversation_id,
      ...(edits ? { edits } : {}) };
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
    const useOriginal = args[3] === "--use-original";
    if (args.length !== (useOriginal ? 4 : 3)) fail("首稿接收参数不完整或包含未知选项");
    const original = draft.failures?.[0];
    const originalPath = path.join(scratch, `author-${route}.agy.json`);
    const restoring = useOriginal && !draft.originalReceipt;
    if (useOriginal) {
      const records = await Promise.all([1, 2, 3].map(id => loadDraft(context, id)));
      if (task.moduleId !== "author-narration" || !recoveryPrompt || original?.receiptPath !== originalPath
        || path.resolve(value) !== originalPath || draft.factErrors !== null
        || records.some(({ draft: other }) => Object.hasOwn(other, "selectedOpener"))
        || await readOptional(context.candidatePath)) fail("选稿前才可从同工作单恢复有证据的原503首稿");
      if (draft.phase === "writing" && !confirmedLocalExit(draft.sessionId)) fail("重试调用尚未确认结束，先恢复该调用现场");
    }
    const recoverFailed = recoveryPrompt && draft.phase === "failed" && draft.result === null && draft.factErrors === null
      && !Object.hasOwn(draft, "selectedOpener") && !await readOptional(context.candidatePath);
    if (!recoverFailed && !["writing", "received"].includes(draft.phase)) fail("本路已失败或进入核对，不能重新接收首稿");
    if (!useOriginal && (recoveryPrompt || draft.failures?.length) && path.resolve(value) !== receiptPath(context, route, draft)) {
      fail("恢复或重试只能接收本次返回的原回包路径，其它回包保留");
    }
    const receipt = await readReceipt(context, value, extra, recoveryPrompt, { priorTurn: useOriginal });
    if ((recoverFailed || useOriginal) && receipt.status !== "ERROR") fail("已失败的首稿只从有完成证据的原503回包恢复");
    const result = completeResult(context, task.moduleId === "author-narration"
      ? await parseAuthorReply(context, path.resolve(value), receipt, parseSpokenDraft, { prompt: recoveryPrompt })
      : parseAuthorResponse(receipt.response));
    await validateResult(context, result, true);
    if (!restoring && draft.result && (stableStringify(draft.result) !== stableStringify(result)
      || draft.conversationId !== receipt.conversation_id)) fail("首稿已经保存，不能替换原稿或作者");
    if (restoring) {
      const { failures, ...retry } = draft;
      draft.supersededRetry = { ...retry, receiptPath: receiptPath(context, route, draft) };
      draft.originalReceipt = originalPath;
      draft.sessionId = original.sessionId;
      delete draft.failure;
    }
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
      const next = { packaged: ["reviewing"], reviewing: ["correcting", "ready"], correcting: [], ready: [] };
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
  } else fail("动作须为documentary-quotes/prepare-reference/start/retry/session/receive/select/package-start/package-receive/publication/mark/candidate/correct");
  await atomicWriteData(file, draft);
  return { draftPath: file, phase: draft.phase, conversationId: draft.conversationId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorHandoff(...process.argv.slice(2)).then(result => {
    if (typeof result === "string") process.stdout.write(result);
    else console.log(JSON.stringify(result));
  })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
