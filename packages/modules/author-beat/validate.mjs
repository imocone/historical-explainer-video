export function validate({ result, context }) {
  const errors = [];
  if (result.templateId !== context.selectedTemplate) {
    errors.push(`author-beat 只能执行正式选中的模板: expected=${context.selectedTemplate ?? "missing"} actual=${result.templateId ?? "missing"}`);
  }

  const unit = context.authorUnit;
  if (!unit || !["beat", "template-run"].includes(unit.kind)) {
    return [...errors, "author-beat 缺少合法 Author 创作单位"];
  }
  if (unit.templateId !== context.selectedTemplate) {
    errors.push(`author-beat 创作单位模板与正式模板不一致: unit=${unit.templateId ?? "missing"} selected=${context.selectedTemplate ?? "missing"}`);
  }
  if (unit.kind === "beat") {
    if (!context.beat || unit.id !== context.beat.id || unit.beatIds?.length !== 1 || unit.beatIds[0] !== context.beat.id) {
      errors.push(`author-beat 单拍创作单位与正式 Beat 不一致: unit=${unit.id ?? "missing"} beat=${context.beat?.id ?? "missing"}`);
    }
    if (context.templateRun) errors.push("author-beat 单拍创作单位不得携带 templateRun");
    return errors;
  }
  const run = context.templateRun;
  if (!run || run.id !== unit.id || run.templateId !== unit.templateId) {
    errors.push(`author-beat 整段创作单位与 templateRun 不一致: unit=${unit.id ?? "missing"} run=${run?.id ?? "missing"}`);
  }
  if (JSON.stringify(run?.beatIds ?? []) !== JSON.stringify(unit.beatIds ?? [])) {
    errors.push(`author-beat 整段成员与 templateRun 不一致: ${unit.id}`);
  }
  if ((context.authorUnitBeats ?? []).length !== (unit.beatIds ?? []).length) {
    errors.push(`author-beat 整段工作单没有投递全部成员 Beat: ${unit.id}`);
  }
  return errors;
}
