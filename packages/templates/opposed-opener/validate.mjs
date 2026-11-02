import { sha256 } from "../../program-utils.mjs";
import { canUseSourceForExternalProduction } from "../../source-rights.mjs";
import { opposedCopyErrors } from "./copy-policy.mjs";
import { openerTimelineForTreatment } from "./render-policy.mjs";

const audible = value => String(value ?? "").normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const compact = value => String(value ?? "").replace(/\s+/gu, "").trim();
export const validateOpenerNarration = opposedCopyErrors;
export const openerNarrationText = treatment => compact(treatment?.flashbackLine);
export const spokenSentencesForTreatment = treatment =>
  (treatment?.flashbackShots ?? []).map(shot => ({target:shot.id, text:compact(shot.spokenText)}));

export const completeCandidate = ({result, context}) => {
  if (!Object.hasOwn(result, "flashbackLine")) result.flashbackLine = context.openerNarration;
};

export function validate({result, context = {}, expectedTemplateId = "opposed-opener"}) {
  const errors = opposedCopyErrors(result.flashbackLine);
  if (result.templateId !== expectedTemplateId) errors.push(`片头必须使用${expectedTemplateId}`);
  if (context.openerNarration && result.flashbackLine !== context.openerNarration)
    errors.push("逐段片头必须逐字保留P1正式口播");
  const shots = result.flashbackShots ?? [];
  if (!shots.length) errors.push("逐段片头缺少画面");
  if (audible(shots.map(shot => shot.spokenText).join("")) !== audible(result.flashbackLine))
    errors.push("各段口播必须按原顺序覆盖正式片头的全部有声文字");
  const body = context.bodyStoryboard ?? context.storyboard ?? {};
  const beats = new Map((body.beats ?? []).map(beat => [beat.id,beat]));
  const runs = new Map((body.templateRuns ?? []).flatMap(run => (run.beatIds ?? []).map(id => [id,run])));
  const semantics = context.semanticContext ?? context.understanding ?? {};
  const refs = new Set([...(context.cues ?? []).map(cue => `C${String(cue.id).padStart(3,"0")}`),
    ...[...(semantics.facts ?? []), ...(semantics.relations ?? []), ...(semantics.evidence ?? [])].map(item => item.id)]);
  const sources = new Map((context.sourceAssets ?? []).map(item => [item.id,item]));
  for (const [i, shot] of shots.entries()) {
    const id = `O${String(i+1).padStart(2,"0")}`;
    if (shot.id !== id) errors.push(`片头第 ${i+1} 段必须使用${id}`);
    if (!audible(shot.spokenText) || audible((shot.screenLines ?? []).join("")) !== audible(shot.spokenText))
      errors.push(`${id}屏幕文字必须完整表达本段原文`);
    if (shot.highlight && (shot.screenLines ?? []).join("").split(shot.highlight).length !== 2)
      errors.push(`${id}强调文字必须在本段文字中出现一次`);
    for (const ref of shot.bodyRefs ?? [])
      if (beats.size && (!beats.has(ref) || !(beats.get(ref).treatment ?? runs.get(ref)?.treatment)))
        errors.push(`${id}引用的正文尚未完成: ${ref}`);
    for (const ref of shot.sourceRefs ?? []) {
      if (ref.startsWith("SA")) {
        if (!canUseSourceForExternalProduction(sources.get(ref)?.rightsStatus))
          errors.push(`${id}来源资产权利不可用: ${ref}`);
      } else if (!refs.has(ref)) errors.push(`${id}引用未知来源: ${ref}`);
    }
  }
  if (result.narration) {
    if (result.narration.textSha256 !== sha256(openerNarrationText(result)))
      errors.push("片头口播摘要不符");
    try { openerTimelineForTreatment(result); } catch (error) { errors.push(error.message); }
  }
  return errors;
}
