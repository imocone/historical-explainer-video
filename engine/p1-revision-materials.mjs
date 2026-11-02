import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertProjectPath,
  atomicWrite,
  fileSha256,
  readData,
  stableStringify
} from "../packages/program-utils.mjs";
import {
  getEpisodePaths,
  getStageWorkPaths
} from "../packages/workspace-paths.mjs";

const EXECUTION_ID = /^[a-f0-9]{64}$/u;
const AGY_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const normalizeText = (value) => value.replaceAll("\r\n", "\n").trim();
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const readRegularFile = async ({ workspaceRoot, file, label, text = false }) => {
  await assertProjectPath({ root: workspaceRoot, file, label });
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label}不存在`);
    throw error;
  }
  if (!info.isFile() || info.size <= 0) throw new Error(`${label}必须是非空普通文件`);
  return text ? readFile(file, "utf8") : null;
};

const descriptorFor = async ({ workspaceRoot, file, label }) => {
  await readRegularFile({ workspaceRoot, file, label });
  return {
    source: relative(workspaceRoot, file),
    sha256: await fileSha256(file)
  };
};

const readJson = async ({ workspaceRoot, file, label }) => {
  const content = await readRegularFile({ workspaceRoot, file, label, text: true });
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${label}不是合法JSON: ${error.message}`);
  }
};

const optionalRegularFileExists = async ({ workspaceRoot, file, label }) => {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await assertProjectPath({ root: workspaceRoot, file, label });
  if (!info.isFile()) throw new Error(`${label}必须是普通文件`);
  return true;
};

const validateQueryResult = ({ result, label, conversationId = null, allowMissingCitations = false }) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${label}必须是对象`);
  }
  if (result.status === "error") throw new Error(`${label}返回错误`);
  if (!nonEmptyString(result.answer)) throw new Error(`${label}缺少answer`);
  if (!nonEmptyString(result.conversation_id)) throw new Error(`${label}缺少conversation_id`);
  if (conversationId !== null && result.conversation_id !== conversationId) {
    throw new Error(`${label}没有复用主Query会话`);
  }
  if (!result.citations || typeof result.citations !== "object" || Array.isArray(result.citations)) {
    throw new Error(`${label}缺少citations`);
  }
  if (result.references !== undefined && !Array.isArray(result.references)) {
    throw new Error(`${label}的references必须是数组`);
  }
  let citedTextCount = 0;
  for (const reference of result.references ?? []) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)
      || !nonEmptyString(reference.source_id)
      || reference.citation_number == null
      || !nonEmptyString(reference.cited_text)) continue;
    citedTextCount += 1;
  }
  if (citedTextCount === 0 && !allowMissingCitations) {
    throw new Error(`${label}没有可用的cited_text`);
  }
  return { conversationId: result.conversation_id };
};

const inspectAttempt = async ({
  workspaceRoot,
  attemptPath,
  materialExecutionId,
  episodeBrief
}) => {
  await assertProjectPath({ root: workspaceRoot, file: attemptPath, label: "P1材料尝试目录" });
  const attemptInfo = await lstat(attemptPath);
  if (!attemptInfo.isDirectory()) throw new Error("P1材料尝试不是普通目录");

  const files = {
    notebookQueryPrompt: path.join(attemptPath, "notebook-query.txt"),
    notebookQuery: path.join(attemptPath, "notebook-query.json"),
    notebookQuerySupplementPrompt: path.join(attemptPath, "notebook-query-supplement.txt"),
    notebookQuerySupplement: path.join(attemptPath, "notebook-query-supplement.json")
  };

  const isExplainer = episodeBrief.programForm === "historical-explainer";
  const materialDescriptors = {};
  const file = path.join(attemptPath, "reference-materials.json");
  if (isExplainer && (episodeBrief.referenceProgram
    || await optionalRegularFileExists({ workspaceRoot, file, label: "P1原材料" }))) {
    const source = await readJson({ workspaceRoot, file, label: "P1参考节目材料" });
    if (stableStringify(source.referenceProgram) !== stableStringify(episodeBrief.referenceProgram)
      || stableStringify(source.referenceVideoIds) !== stableStringify(episodeBrief.referenceVideoIds)) {
      throw new Error("P1参考材料与当前单集来源不一致");
    }
    if (source.documents !== undefined && (!Array.isArray(source.documents)
      || source.documents.some(document => !document
        || ["title", "source", "text"].some(key => !nonEmptyString(document[key]))))) {
      throw new Error("P1正文材料缺少标题、来源或实际正文");
    }
    if (!episodeBrief.referenceProgram && !source.documents?.length) throw new Error("P1没有可复用的正文依据");
    materialDescriptors.referenceMaterials = await descriptorFor({ workspaceRoot, file, label: "P1原材料" });
  }
  const queryFilesPresent = await Promise.all(Object.values(files).map(file =>
    optionalRegularFileExists({ workspaceRoot, file, label: "P1 Query材料" })));
  if (!isExplainer || queryFilesPresent.some(Boolean)) {
    await readRegularFile({
      workspaceRoot,
      file: files.notebookQueryPrompt,
      label: "P1材料主Query提示词",
      text: true
    });
    const queryResult = await readJson({
      workspaceRoot,
      file: files.notebookQuery,
      label: "P1材料主Query结果"
    });
    const query = validateQueryResult({
      result: queryResult,
      label: "P1材料主Query结果",
      allowMissingCitations: isExplainer
    });

    const supplementPromptExists = await optionalRegularFileExists({
      workspaceRoot,
      file: files.notebookQuerySupplementPrompt,
      label: "P1材料补充Query提示词"
    });
    const supplementExists = await optionalRegularFileExists({
      workspaceRoot,
      file: files.notebookQuerySupplement,
      label: "P1材料补充Query结果"
    });
    if (supplementPromptExists !== supplementExists) {
      throw new Error("P1材料补充Query提示词与结果必须同时存在或同时缺席");
    }
    let supplementDescriptors = {};
    if (supplementExists) {
      await readRegularFile({
        workspaceRoot,
        file: files.notebookQuerySupplementPrompt,
        label: "P1材料补充Query提示词",
        text: true
      });
      const supplementResult = await readJson({
        workspaceRoot,
        file: files.notebookQuerySupplement,
        label: "P1材料补充Query结果"
      });
      validateQueryResult({
        result: supplementResult,
        label: "P1材料补充Query结果",
        conversationId: query.conversationId,
        allowMissingCitations: isExplainer
      });
      supplementDescriptors = {
        notebookQuerySupplementPrompt: await descriptorFor({
          workspaceRoot,
          file: files.notebookQuerySupplementPrompt,
          label: "P1材料补充Query提示词"
        }),
        notebookQuerySupplement: await descriptorFor({
          workspaceRoot,
          file: files.notebookQuerySupplement,
          label: "P1材料补充Query结果"
        })
      };
    }

    Object.assign(materialDescriptors, {
      notebookQueryPrompt: await descriptorFor({ workspaceRoot, file: files.notebookQueryPrompt, label: "P1材料主Query提示词" }),
      notebookQuery: await descriptorFor({ workspaceRoot, file: files.notebookQuery, label: "P1材料主Query结果" }),
      ...supplementDescriptors
    });
  }
  if (!Object.keys(materialDescriptors).length) throw new Error("P1没有可复用的原文或Query材料");

  const authorIdentity = { workspaceRoot, file: path.join(attemptPath, "agy-conversation-id.txt"), label: "P1 AGY作者会话身份" };
  const conversationId = normalizeText(await readRegularFile({ ...authorIdentity, text: true }));
  if (!AGY_CONVERSATION_ID.test(conversationId)) throw new Error("P1 AGY作者会话身份非法");
  const publicationInput = { workspaceRoot, file: path.join(attemptPath, "publication-input.md"), label: "P1发布调查输入" };

  const descriptors = {
    materialExecutionId,
    sourceAttempt: relative(workspaceRoot, attemptPath),
    ...materialDescriptors,
    ...(isExplainer ? {
      authorTask: await descriptorFor({
        workspaceRoot,
        file: path.join(attemptPath, "author-task.md"),
        label: "P1原材料作者任务书"
      })
    } : {}),
    agyConversation: { ...(await descriptorFor(authorIdentity)), conversationId },
    ...(await optionalRegularFileExists(publicationInput)
      ? { publicationInput: await descriptorFor(publicationInput) } : {})
  };
  return descriptors;
};

export const compactAcceptedNarrationMaterials = async ({
  workspaceRoot,
  episodeId,
  materialExecutionId
}) => {
  if (!EXECUTION_ID.test(materialExecutionId ?? "")) {
    throw new Error("P1材料收口缺少现行正文绑定的材料尝试身份");
  }
  const workPath = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), "p1").work;
  await assertProjectPath({ root: workspaceRoot, file: workPath, label: "P1材料收口目录" });
  const retained = new Set([
    "notebook-query.txt",
    "notebook-query.json",
    "notebook-query-supplement.txt",
    "notebook-query-supplement.json",
    "agy-conversation-id.txt",
    "author-task.md",
    "reference-materials.json",
    "creative-outline.md",
    "publication-input.md"
  ]);
  const currentName = `attempt-${materialExecutionId}`;
  const heldAttempts = new Set();
  const heldPath = path.join(workPath, "held-work");
  await assertProjectPath({ root: workspaceRoot, file: heldPath, label: "P1保留工作" });
  for (const name of await readdir(heldPath).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error))) {
    const file = path.join(heldPath, name);
    await assertProjectPath({ root: workspaceRoot, file, label: "P1保留工作" });
    const order = (await readData(file).catch(() => null))?.workOrder;
    if (order?.stageId === "p1" && EXECUTION_ID.test(order.executionId ?? ""))
      heldAttempts.add(`attempt-${order.executionId}`);
  }
  for (const entry of await readdir(workPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === ".DS_Store") {
      await rm(path.join(workPath, entry.name), { force: true });
      continue;
    }
    if (!entry.isDirectory() || !entry.name.startsWith("attempt-")) continue;
    const attempt = path.join(workPath, entry.name);
    if (heldAttempts.has(entry.name)) continue;
    if (entry.name !== currentName) {
      await rm(attempt, { recursive: true, force: true });
      continue;
    }
    const children = await readdir(attempt, { withFileTypes: true });
    const retried = (await Promise.all([1, 2, 3].map(async route => {
      const file = path.join(attempt, `author-${route}.json`);
      const draft = await readData(file).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
      return Array.isArray(draft?.failures) && draft.failures.length > 0;
    }))).some(Boolean);
    for (const child of children) {
      if (child.isFile() && (retained.has(child.name) || (retried
        && /^author-[123](?:\.retry-\d+)?(?:\.agy\.json|\.stderr\.log|\.json)$/u.test(child.name)))) continue;
      await rm(path.join(attempt, child.name), { recursive: true, force: true });
    }
  }
};

export const resolveReusableNarrationMaterials = async ({
  workspaceRoot,
  episodeId,
  episodeBrief,
  materialExecutionId
}) => {
  if (!EXECUTION_ID.test(materialExecutionId ?? "")) {
    throw new Error("P1正文返工缺少现行正片绑定的材料尝试身份");
  }
  const workPath = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), "p1").work;
  await assertProjectPath({ root: workspaceRoot, file: workPath, label: "P1工作目录" });
  const attemptPath = path.join(workPath, `attempt-${materialExecutionId}`);
  try {
    await lstat(attemptPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`P1现行正片绑定的材料尝试不存在: ${materialExecutionId}`);
    }
    throw error;
  }
  return inspectAttempt({
    workspaceRoot,
    attemptPath,
    materialExecutionId,
    episodeBrief
  });
};

// The quote consumer needs retained source text, not the P1 author's process or session.
export const readAcceptedNarrationEvidence = async ({ workspaceRoot, episodeId }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  if (!await optionalRegularFileExists({ workspaceRoot, file: paths.scriptPackage, label: "P1正式正文" })) return null;
  const script = await readJson({ workspaceRoot, file: paths.scriptPackage, label: "P1正式正文" });
  const executionId = script._producer?.materialExecutionId;
  if (!EXECUTION_ID.test(executionId ?? "")) return null;
  const attempt = path.join(getStageWorkPaths(paths, "p1").work, `attempt-${executionId}`);
  const readOptional = async (name) => {
    const file = path.join(attempt, name);
    return await optionalRegularFileExists({ workspaceRoot, file, label: "P1已保留依据" })
      ? readJson({ workspaceRoot, file, label: "P1已保留依据" }) : null;
  };
  const materials = await readOptional("reference-materials.json");
  let hasRetainedMaterial = materials !== null;
  const queries = [];
  for (const name of ["notebook-query.json", "notebook-query-supplement.json"]) {
    const query = await readOptional(name);
    hasRetainedMaterial ||= query !== null;
    if (query?.references?.length) queries.push({ source: relative(workspaceRoot, path.join(attempt, name)),
      references: query.references });
  }
  if (!hasRetainedMaterial) throw new Error(`P1已保留依据缺失: ${relative(workspaceRoot, attempt)}`);
  const documents = materials?.documents ?? [];
  return documents.length || queries.length ? { documents, queries } : null;
};

export const validateReusableNarrationMaterials = async ({
  workspaceRoot,
  episodeId,
  episodeBrief,
  materials
}) => {
  if (!materials || typeof materials !== "object" || Array.isArray(materials)
    || !EXECUTION_ID.test(materials.materialExecutionId ?? "")
    || !nonEmptyString(materials.sourceAttempt)) {
    throw new Error("P1正文返工缺少已固定的旧创作材料描述符");
  }
  const workPath = getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), "p1").work;
  const attemptPath = path.join(workPath, `attempt-${materials.materialExecutionId}`);
  if (relative(workspaceRoot, attemptPath) !== materials.sourceAttempt) {
    throw new Error("P1正文返工固定的旧尝试路径非法");
  }
  const current = await inspectAttempt({
    workspaceRoot,
    attemptPath,
    materialExecutionId: materials.materialExecutionId,
    episodeBrief
  });
  if (stableStringify(current) !== stableStringify(materials)) {
    throw new Error("P1正文返工固定的旧创作材料路径或摘要已经变化");
  }
  return current;
};

export const copyReusableNarrationSources = async ({
  workspaceRoot, episodeId, episodeBrief, materials, executionId
}) => {
  await validateReusableNarrationMaterials({ workspaceRoot, episodeId, episodeBrief, materials });
  if (!EXECUTION_ID.test(executionId ?? "")) throw new Error("P1正文重写缺少本次尝试身份");
  const attempt = path.join(getStageWorkPaths(getEpisodePaths(workspaceRoot, episodeId), "p1").work,
    `attempt-${executionId}`);
  for (const field of ["referenceMaterials", "notebookQueryPrompt", "notebookQuery",
    "notebookQuerySupplementPrompt", "notebookQuerySupplement", "publicationInput"]) {
    const source = materials[field]?.source;
    if (!source) continue;
    const destination = path.join(attempt, path.basename(source));
    await assertProjectPath({ root: workspaceRoot, file: destination, label: "P1正文重写材料" });
    if (field === "publicationInput" && await optionalRegularFileExists({
      workspaceRoot, file: destination, label: "P1本次发布调查输入"
    })) continue;
    await atomicWrite(destination, await readFile(path.resolve(workspaceRoot, source)));
  }
};
