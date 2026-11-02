import { validateSchema } from "../../../engine/runtime/schema.mjs";
import { completeCandidate as completePublication, validate as validatePublication } from "./publication.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function validateCommon({ result, context = {} }) {
  const errors = [];
  if (context.episodeId && result.episodeId !== context.episodeId) {
    errors.push("口播 episodeId 与当前工作单不一致");
  }
  if (context.episodeBrief?.seriesTitle
    && result.seriesTitle !== context.episodeBrief.seriesTitle) {
    errors.push("口播 seriesTitle 必须与当前P0单集任务一致");
  }
  if (["opener", "narration"].includes(context.returnRequest?.revisionScope)
    && typeof context.returnRequest.exactOpenerNarration === "string"
    && result.openerNarration !== context.returnRequest.exactOpenerNarration) {
    errors.push("口播返工必须逐字使用用户指定片头原句");
  }
  if (["publication-copy", "publication-all", "cover-content"].includes(context.returnRequest?.revisionScope)) {
    // Display metadata follows current P0; the spoken delivery remains locked.
    for (const key of ["schemaVersion", "episodeId", "language", "narration"]) {
      if (result[key] !== context.currentScriptPackage?.[key]) errors.push(`发布内容修订不得修改正文 ${key}`);
    }
    if (result.openerNarration !== context.currentOpenerNarration?.openerNarration) errors.push("发布内容修订不得修改片头");
  }
  const spokenFields = [
    ["openerNarration", result.openerNarration],
    ["narration", result.narration]
  ];
  const escapedFields = spokenFields
    .filter(([, value]) => /\\(?:n|r|t|")/.test(String(value ?? "")))
    .map(([name]) => name);
  if (escapedFields.length > 0) {
    errors.push(`${escapedFields.join("、")} 不得包含字面转义序列；请写入真实换行、引号或制表字符`);
  }
  const machineReferencePatterns = [
    /[\[【]\s*\^?\d+(?:\s*[,，、-]\s*\d+)*\s*[\]】]/u,
    /\b(?:source_id|citation_number|cited_text)\b/iu,
    /(?:^|\n)\s*(?:参考文献|references)\s*(?:(?:[:：]).*)?(?:\n|$)/iu,
    /[（(]\s*注\s*\d+\s*[）)]/u
  ];
  const machineReferenceFields = spokenFields
    .filter(([, value]) => machineReferencePatterns.some((pattern) => pattern.test(String(value ?? ""))))
    .map(([name]) => name);
  if (machineReferenceFields.length > 0) {
    errors.push(`${machineReferenceFields.join("、")} 不得包含脚注、引用编号、参考文献清单或机器来源字段`);
  }
  return errors;
}

export function validate(options) {
  const errors = validateCommon(options);
  if (options.context?.episodeBrief?.programForm !== "historical-explainer") {
    errors.push("author-narration 只接纳 historical-explainer 单集");
  }
  return errors;
}

export async function validateAcceptance({ result, context = {}, services = {} }) {
  if (!services.draftOnly) {
    if (!result.publication) return ["P1作者还未交付发布文案与封面构思"];
    await validateSchema(path.join(services.systemRoot, "contracts/publication.schema.json"), result.publication, "P1发布内容");
    const errors = validatePublication({ result: result.publication, context: { ...context,
      episodeId: result.episodeId, targetId: "release-main", scriptPackage: result,
      openerNarration: { openerNarration: result.openerNarration } } });
    if (errors.length) return errors;
  }
  if (typeof result?.openerNarration !== "string" || !result.openerNarration.trim()) {
    return ["P1必须同时提交片头口播 openerNarration 与正片口播 narration"];
  }
  const slot = services.task?.resolvedAssembly?.slots
    ?.find((item) => item.id === "opener-copy-template");
  const implementations = slot?.implementations ?? [];
  const validatorResource = implementations.length === 1
    ? implementations[0].resources?.find((resource) => resource.role === "validator")
    : null;
  if (!validatorResource?.source || !services.systemRoot) {
    return ["P1工作单没有装配唯一片头模板容量校验器"];
  }
  const templateValidator = await import(pathToFileURL(
    path.resolve(services.systemRoot, validatorResource.source)
  ).href);
  if (typeof templateValidator.validateOpenerNarration !== "function") {
    return ["当前片头模板没有导出片头口播容量校验"];
  }
  return templateValidator.validateOpenerNarration(result.openerNarration);
}

export function completeCandidate({ result, context = {} }) {
  if (result.publication) completePublication({ result: result.publication,
    context: { ...context, episodeId: result.episodeId, targetId: "release-main" } });
}
