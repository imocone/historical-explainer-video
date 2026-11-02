import { readReferenceVideos } from "../../reference-program.mjs";
import { hashObject } from "../../program-utils.mjs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_OPENER_TEMPLATE_ID } from "../../opener-template-selection.mjs";
import { notebookCommand, runtimeEnvironment } from "../../runtime-config.mjs";

const execFile = promisify(execFileCallback);
const idsFor = (episodes) => (episodes ?? []).map((episode) => episode.episodeId);
const parseNlmJson = (value) => {
  if (typeof value === "string") return JSON.parse(value);
  if (value && typeof value === "object" && typeof value.stdout === "string") {
    return JSON.parse(value.stdout);
  }
  return value;
};
const runNlm = async (args) => {
  const { stdout } = await execFile(notebookCommand(), args, {
    env: runtimeEnvironment(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000
  });
  return parseNlmJson(stdout);
};

export function validateCommon({ result, context = {} }) {
  const errors = [];
  const request = context.programRequest;
  const isExplainer = result.programForm === "historical-explainer";
  if (context.programId && result.programId !== context.programId) {
    errors.push("节目策划 programId 与当前节目不一致");
  }
  if (!request) return errors;
  if (result.programId !== request.programId) errors.push("节目策划 programId 与 program-request 不一致");
  if (isExplainer && request.explainerType !== undefined
    && result.explainerType !== request.explainerType) {
    errors.push("节目策划 explainerType 必须采用用户明确指定的解说类型");
  }
  if (request.researchLibrary?.notebookId
    && (!isExplainer || result.researchLibrary)
    && result.researchLibrary?.notebookId !== request.researchLibrary.notebookId) {
    errors.push("节目策划必须使用用户已交付的 NotebookLM 资料库");
  }
  const planningKind = request.planningBasis?.kind;
  if (planningKind === "video-led") {
    if (!isExplainer
      || hashObject(result.referenceProgram ?? null) !== hashObject(request.planningBasis.referenceProgram)) {
      errors.push("video-led 必须使用委托指定的参考节目材料");
    }
    if ((result.episodes ?? []).some(episode => !episode.referenceVideoIds?.length)) {
      errors.push("参考节目路线每集须交接实际使用的视频编号");
    }
  } else if (result.referenceProgram || (result.episodes ?? []).some(episode => episode.referenceVideoIds)) {
    errors.push("只有 video-led 使用参考节目材料");
  }
  const baseBookSourceId = result.researchLibrary?.baseBookSourceId;
  const requiredSourceIds = result.researchLibrary?.requiredSourceIds ?? [];
  if (planningKind === "book-led" && !isExplainer
    && (typeof baseBookSourceId !== "string" || !baseBookSourceId.trim())) {
    errors.push("book-led 节目策划必须声明 NotebookLM 基础书来源编号");
  }
  if (planningKind === "book-led"
    && typeof baseBookSourceId === "string"
    && !requiredSourceIds.includes(baseBookSourceId)) {
    errors.push("book-led 基础书来源必须属于本次最小充分材料来源");
  }
  if (planningKind === "topic-led" && baseBookSourceId !== undefined) {
    errors.push("topic-led 节目策划不得声明基础书来源编号");
  }
  if (typeof result.editorialDirection !== "string" || !result.editorialDirection.trim()) {
    errors.push("节目策划必须确定 editorialDirection");
  }
  if (typeof result.viewerBenefit !== "string" || !result.viewerBenefit.trim()) {
    errors.push("节目策划必须明确 viewerBenefit");
  }
  if (typeof result.narrativeTone !== "string" || !result.narrativeTone.trim()) {
    errors.push("节目策划必须确定 narrativeTone");
  }
  if (request.maxDurationSeconds !== undefined
    && result.maxDurationSeconds !== request.maxDurationSeconds) {
    errors.push("节目策划的最长时长与 program-request 不一致");
  }
  if (request.maxDurationSeconds === undefined
    && result.maxDurationSeconds !== undefined) {
    errors.push("program-request 未规定最长时长时，节目策划必须省略 maxDurationSeconds");
  }
  const visualCatalog = context.visualPackageCatalog ?? [];
  if (!visualCatalog.length) {
    errors.push("节目策划缺少可选视觉包目录");
  } else {
    const selected = visualCatalog.find((item) => (
      item.visualPackageId === result.visualPackage?.visualPackageId
      && item.version === result.visualPackage?.version
    ));
    if (!selected) errors.push("节目策划选择了当前视觉目录中不存在或版本不一致的视觉包");
  }
  const episodeIds = idsFor(result.episodes);
  const coverCatalog = context.coverPackageCatalog ?? [];
  if (!coverCatalog.length) {
    errors.push("节目策划缺少可选封面包目录");
  } else if (!coverCatalog.some((item) => (
    item.coverPackageId === result.coverPackage?.coverPackageId
    && item.version === result.coverPackage?.version
  ))) {
    errors.push("节目策划选择了当前封面目录中不存在或版本不一致的封面包");
  }
  if (!(context.openerTemplateCatalog ?? []).some((item) => item.templateId === result.openerTemplate)) {
    errors.push("节目策划必须从当前片头目录选择一个 openerTemplate");
  }
  if (new Set(episodeIds).size !== episodeIds.length) errors.push("节目策划 episodeId 必须唯一");
  for (const [index, episode] of (result.episodes ?? []).entries()) {
    const expectedId = `ep${String(index + 1).padStart(2, "0")}`;
    if (episode.episodeId !== expectedId) {
      errors.push(`第 ${index + 1} 集必须使用编号 ${expectedId}`);
    }
  }
  return errors;
}

export function validate(options) {
  const errors = validateCommon(options);
  if (options.context?.programRequest?.programForm !== "historical-explainer"
    || options.result?.programForm !== "historical-explainer") {
    errors.push("plan-program 只接纳 historical-explainer 节目");
  }
  return errors;
}

export async function validateAcceptance({ result, context = {}, services = {} }) {
  const errors = [];
  if (!context.programRevision) {
    const requestedOpener = context.programRequest?.openerTemplate ?? DEFAULT_OPENER_TEMPLATE_ID;
    if (result.openerTemplate !== requestedOpener) {
      errors.push(`首次P0必须使用用户指定或默认片头 ${requestedOpener}`);
    }
  }
  if (result.referenceProgram) {
    try {
      const videos = await readReferenceVideos(result.referenceProgram);
      const ids = new Set(videos.map(video => video.id));
      for (const episode of result.episodes ?? []) {
        for (const id of episode.referenceVideoIds ?? []) {
          if (!ids.has(id)) errors.push(`参考节目缺少 ${episode.episodeId} 使用的视频 ${id}`);
        }
      }
    } catch (error) { errors.push(error.message); }
  }
  if (!result.researchLibrary && result.programForm === "historical-explainer") return errors;
  const nlm = services.nlm ?? runNlm;
  const notebookId = result.researchLibrary?.notebookId;
  try {
    const notebook = parseNlmJson(await nlm(["notebook", "get", notebookId, "--json"]));
    if (notebook?.notebook_id !== notebookId) {
      errors.push("NotebookLM 实时返回的资料库编号与P0候选不一致");
    }
  } catch (error) {
    errors.push(`NotebookLM 资料库身份读取失败: ${error.message}`);
  }
  try {
    const sources = parseNlmJson(await nlm(["source", "list", notebookId, "--json"]));
    const sourceById = new Map((Array.isArray(sources) ? sources : [])
      .filter((item) => typeof item?.id === "string")
      .map((item) => [item.id, item]));
    const requiredSourceIds = result.researchLibrary?.requiredSourceIds ?? [];
    const missing = requiredSourceIds.filter((sourceId) => !sourceById.has(sourceId));
    const notReady = requiredSourceIds.filter((sourceId) => (
      sourceById.has(sourceId) && sourceById.get(sourceId)?.status !== 2
    ));
    if (missing.length) {
      errors.push(`NotebookLM 缺少本次必要材料来源: ${missing.join(", ")}`);
    }
    if (notReady.length) {
      errors.push(`NotebookLM 本次必要材料来源尚未明确就绪: ${notReady.join(", ")}`);
    }
  } catch (error) {
    errors.push(`NotebookLM 必要材料来源状态读取失败: ${error.message}`);
  }

  return errors;
}
