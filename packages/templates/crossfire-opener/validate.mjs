import { crossfireCopyErrors } from "./copy-policy.mjs";
import { CROSS_FIRE } from "./render-policy.mjs";
import { sha256 } from "../../program-utils.mjs";
import { canUseSourceForExternalProduction } from "../../source-rights.mjs";
export { spokenSentencesForTreatment, openerNarrationText } from "../episode-opener/validate.mjs";
export const validateOpenerNarration = crossfireCopyErrors;
export const completeCandidate = ({ result, context }) => {
  if (!Object.hasOwn(result, "flashbackLine")) result.flashbackLine = context.openerNarration;
  if (!Object.hasOwn(result, "episodeTitle")) result.episodeTitle = context.templateContext?.episodeTitle;
};

export function validate({ result, context = {} }) {
  const errors = crossfireCopyErrors(result.flashbackLine);
  if (result.templateId !== "crossfire-opener") errors.push("片头必须使用crossfire-opener");
  if (result.flashbackLine !== context.openerNarration) errors.push("片头必须逐字保留P1正式原句");
  if (!context.templateContext?.episodeTitle || result.episodeTitle !== context.templateContext.episodeTitle) errors.push("片头标题必须使用正式本集标题");
  const n = result.narration;
  if (n) {
    if (n.textSha256 !== sha256(result.flashbackLine.replace(/\s+/gu, ""))) errors.push("片头口播摘要不符");
    if (!Number.isInteger(n.durationMs) || n.durationMs > CROSS_FIRE.maxNarrationMs) errors.push("交叉对冲片头口播必须在5.38秒内说完；返回P1修订，不加速或延长模板");
    const cue = n.sentenceCues?.[0];
    if (n.sentenceCues?.length !== 1 || cue?.target !== "flashbackLine" || !Number.isInteger(cue.startMs)
      || !Number.isInteger(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > n.durationMs + 100) errors.push("片头口播卡点无效");
  }
  const body = context.bodyStoryboard ?? context.storyboard ?? {};
  const beats = new Map((body.beats ?? []).map(beat => [beat.id, beat]));
  const runByBeat = new Map((body.templateRuns ?? []).flatMap(run => (run.beatIds ?? []).map(id => [id, run])));
  const semantics = context.semanticContext ?? context.understanding ?? {};
  const refs = new Set([...(context.cues ?? []).map(cue => `C${String(cue.id).padStart(3,"0")}`),
    ...[...(semantics.facts ?? []), ...(semantics.relations ?? []), ...(semantics.evidence ?? [])].map(item => item.id)]);
  const sources = new Map((context.sourceAssets ?? []).map(item => [item.id, item]));
  const shots = result.flashbackShots ?? [];
  if (shots.length !== 3) errors.push("片头需要三个观察面");
  for (const [i, shot] of shots.entries()) {
    if (shot.id !== `O0${i+1}`) errors.push("片头观察面必须按O01/O02/O03排列");
    const label = shot.screenLines?.[0] ?? "";
    if (shot.screenLines?.length !== 1 || !label || Array.from(label).length > 10 || !result.flashbackLine?.includes(label)) errors.push(`${shot.id}短标签必须摘自正式原句，单行最多10字`);
    if (shot.highlight && (label.split(shot.highlight).length !== 2)) errors.push(`${shot.id}强调文字必须在标签中出现一次`);
    if (shot.foreground && i !== 1) errors.push("只有O02可以交付独立前景");
    for (const id of shot.bodyRefs ?? []) if (beats.size && (!beats.has(id) || !(beats.get(id).treatment ?? runByBeat.get(id)?.treatment))) errors.push(`${shot.id}引用的正文尚未完成: ${id}`);
    for (const id of shot.sourceRefs ?? []) {
      if (id.startsWith("SA")) {
        if (!canUseSourceForExternalProduction(sources.get(id)?.rightsStatus)) errors.push(`${shot.id}来源资产权利不可用: ${id}`);
      } else if (!refs.has(id)) errors.push(`${shot.id}引用未知来源: ${id}`);
    }
  }
  if (new Set(shots.map(shot => shot.screenLines?.join(""))).size !== shots.length) errors.push("三个观察面不能重复同一标签");
  return errors;
}
