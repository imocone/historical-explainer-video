import { videoWindow } from "./timing.mjs";
import { validateVideoTransitions } from "./boundary-transitions.mjs";

export const validate = ({ result, context }) => {
  const errors = [];
  if (result.templateId !== "cinematic-video") errors.push("视频模板身份不一致");
  if (!Array.isArray(result.spans) || result.spans.length > 3) return [...errors, "每集视频最多3段，可选0段"];
  const sourceIds = new Set((context.sourceAssets ?? []).map(({ id }) => id));
  for (const cue of context.cues ?? []) sourceIds.add(`C${String(cue.id).padStart(3, "0")}`);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string" && /^(F|R|E)[0-9]{3}$/u.test(value.id)) sourceIds.add(value.id);
    for (const child of Object.values(value)) visit(child);
  };
  visit(context.storyboard?.understanding);
  let previousEnd = -1;
  for (const [index, span] of result.spans.entries()) {
    if (span.id !== `V${String(index + 1).padStart(3, "0")}`) errors.push("视频编号须按正文顺序从V001连续排列");
    try {
      const window = videoWindow({ span, storyboard: context.storyboard, cues: context.cues });
      if (window.firstIndex <= previousEnd) errors.push(`${span.id} 与前段重叠或顺序倒置`);
      previousEnd = window.lastIndex;
    } catch (error) { errors.push(error.message); }
    for (const ref of span.sourceRefs ?? []) if (!sourceIds.has(ref)) errors.push(`${span.id} 引用不存在的来源${ref}`);
  }
  try { errors.push(...validateVideoTransitions({ storyboard: context.storyboard, videoPlan: result,
    requireTreatment: context.preview ? () => false : undefined })); }
  catch (error) { errors.push(error.message); }
  return errors;
};
