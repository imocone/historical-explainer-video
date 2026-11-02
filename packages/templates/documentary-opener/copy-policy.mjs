import { DOCUMENTARY_OPENER_TIMING_POLICY } from "./timing-policy.mjs";

export const DOCUMENTARY_OPENER_COPY_POLICY = Object.freeze({
  maxReadableUnits: DOCUMENTARY_OPENER_TIMING_POLICY.maxReadableUnits,
  maxQuestionMarks: 0,
  maxSentenceEndings: 1,
  maxSemicolons: 0
});

const compact = (value) => String(value ?? "").replace(/\s+/gu, "").replace(/[\p{P}\p{S}]/gu, "");

export const documentaryOpenerCopyErrors = (value) => {
  const text = String(value ?? "");
  const errors = [];
  const units = Array.from(compact(text)).length;
  if (units === 0) errors.push("纪录片回忆片头缺少可听文字");
  if (units > DOCUMENTARY_OPENER_COPY_POLICY.maxReadableUnits) errors.push(`纪录片回忆片头最多 ${DOCUMENTARY_OPENER_COPY_POLICY.maxReadableUnits} 个可读单位`);
  const endings = text.match(/[。！？!?]/gu) ?? [];
  if (!/[。！!]$/u.test(text) || endings.length < 1 || endings.length > DOCUMENTARY_OPENER_COPY_POLICY.maxSentenceEndings) {
    errors.push("纪录片回忆片头必须是一句完整陈述");
  }
  if ((text.match(/[？?]/gu) ?? []).length > 0) errors.push("纪录片回忆片头不用提问句或知识问答钩子");
  if ((text.match(/[；;]/gu) ?? []).length > DOCUMENTARY_OPENER_COPY_POLICY.maxSemicolons) errors.push("纪录片回忆片头不用分号连接长句");
  return errors;
};
