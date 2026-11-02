export const opposedCopyErrors = value =>
  /[\p{L}\p{N}]/u.test(String(value ?? "")) ? [] : ["片头口播缺少可听文字"];
