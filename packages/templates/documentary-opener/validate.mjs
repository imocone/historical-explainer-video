import { documentaryOpenerCopyErrors } from "./copy-policy.mjs";
import { documentaryOpenerShots } from "./selection.mjs";
import { canUseSourceForExternalProduction } from "../../source-rights.mjs";

export const validateOpenerNarration = documentaryOpenerCopyErrors;
export function completeCandidate({ result, context }) {
  if (!Object.hasOwn(result, "episodeTitle")) result.episodeTitle = context.templateContext?.episodeTitle;
}

export function validate({ result, context = {} }) {
  const errors = [];
  if (result.templateId !== "documentary-opener") errors.push("纪录片片头 templateId 必须是 documentary-opener");
  if (!context.templateContext?.episodeTitle || result.episodeTitle !== context.templateContext.episodeTitle) errors.push("纪录片片头必须逐字使用现行本集标题");
  if (result.memoryShots?.length !== 5 || !result.hero) errors.push("纪录片回忆片头必须选五张正文图和一张宽景");
  if (result.narration !== undefined) errors.push("纪录片回忆片头不生成旁白或TTS证据");
  const beats = new Map(((context.bodyStoryboard ?? context.storyboard)?.beats ?? []).map((beat) => [beat.id, beat]));
  const runByBeat = new Map(((context.bodyStoryboard ?? context.storyboard)?.templateRuns ?? [])
    .flatMap((run) => (run.beatIds ?? []).map((id) => [id, run])));
  const treatmentFor = (id) => beats.get(id)?.treatment ?? runByBeat.get(id)?.treatment;
  const semantics = context.semanticContext ?? context.understanding ?? {};
  const semanticById = new Map([...(semantics.facts ?? []), ...(semantics.relations ?? []), ...(semantics.evidence ?? [])]
    .map((item) => [item.id, item]));
  const sources = new Map((context.sourceAssets ?? []).map((item) => [item.id, item]));
  const seen = new Set();
  for (const [index, shot] of documentaryOpenerShots(result).entries()) {
    if (shot.id !== `D0${index + 1}`) errors.push(`纪录片片头第${index + 1}图编号不一致`);
    if (index === 5 && !["wide", "panorama"].includes(shot.framing)) errors.push("末景必须选择宽景或全景并说明判断依据");
    if (shot.visualBrief) {
      if (index !== 5) errors.push("只有末景可以新增全景，前五张必须复用正文请求");
      const covered = new Set();
      for (const ref of shot.bodyRefs ?? []) {
        if (!beats.has(ref) || !treatmentFor(ref)) errors.push(`新增末景必须引用已完成的本集正文Beat: ${ref}`);
        for (const request of treatmentFor(ref)?.assetRequests ?? []) {
          for (const source of request.sourceRefs ?? []) {
            covered.add(source);
            for (const evidence of semanticById.get(source)?.evidenceRefs ?? []) covered.add(evidence);
          }
        }
      }
      for (const ref of shot.sourceRefs ?? []) {
        if (ref.startsWith("SA")) {
          if (!sources.has(ref)) errors.push(`新增末景引用未登记来源资产: ${ref}`);
          else if (!canUseSourceForExternalProduction(sources.get(ref).rightsStatus)) errors.push(`新增末景来源资产权利状态不可用: ${ref}`);
        } else if ((!ref.startsWith("C") && !semanticById.has(ref)) || !covered.has(ref)) {
          errors.push(`新增末景来源未被所引正文支持: ${ref}`);
        }
      }
      continue;
    }
    if (index === 5) errors.push("D06不得引用P3正文图片，必须依据节目世界设定新设计并在P4生成本期鸟瞰图");
    const beat = beats.get(shot.bodyRefs?.[0]);
    const request = beat?.treatment?.assetRequests?.find((item) => item.requestId === shot.requestId);
    if (shot.bodyRefs?.length !== 1 || !beat?.treatment || request?.kind !== "fullframe-image") errors.push(`${shot.id}必须引用已完成正文Beat中的完整场景图片请求`);
    const key = `${shot.bodyRefs?.[0]}/${shot.requestId}`;
    if (seen.has(key)) errors.push(`${shot.id}重复使用同一正文画面`);
    seen.add(key);
  }
  return errors;
}
