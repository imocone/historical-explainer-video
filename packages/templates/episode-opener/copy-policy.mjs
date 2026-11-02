import { OPENER_TIMING_POLICY } from "./timing-policy.mjs";

export const OPENER_COPY_POLICY = Object.freeze({
  maxReadableUnits: OPENER_TIMING_POLICY.maxReadableUnits,
  maxQuestionMarks: 1,
  maxSentenceEndings: 1
});

const compact = (value) => String(value ?? "")
  .replace(/\s+/gu, "")
  .replace(/[\p{P}\p{S}]/gu, "");

export const openerCopyErrors = (value) => {
  const text = String(value ?? "");
  const errors = [];
  const units = Array.from(compact(text)).length;
  if (units === 0) errors.push("片头唯一口播缺少可听文字");
  if (units > OPENER_COPY_POLICY.maxReadableUnits) {
    errors.push(`片头唯一口播最多 ${OPENER_COPY_POLICY.maxReadableUnits} 个可读单位`);
  }
  const sentenceEndings = text.match(/[。！？!?]/gu) ?? [];
  if (!/[。！？!?]$/u.test(text)
    || sentenceEndings.length < 1
    || sentenceEndings.length > OPENER_COPY_POLICY.maxSentenceEndings) {
    errors.push("片头唯一口播必须是一句完整、能一口气说完的话");
  }
  const questions = text.match(/[？?]/gu) ?? [];
  if (questions.length > OPENER_COPY_POLICY.maxQuestionMarks) {
    errors.push("片头唯一口播最多只能提出一个问题");
  }
  return errors;
};
