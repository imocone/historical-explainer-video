export const crossfireCopyErrors = value => {
  const text = String(value ?? ""), errors = [];
  const units = Array.from(text.replace(/[\s\p{P}\p{S}]/gu, "")).length;
  if (units < 1 || units > 30) errors.push("交叉对冲片头需要1—30个可读单位");
  const endings = text.match(/[。！？!?]/gu) ?? [];
  if (!/[。！？!?]$/u.test(text) || endings.length !== 1) errors.push("片头必须是一句完整口语，最多一个问题");
  return errors;
};
