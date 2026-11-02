// Programme selection is independent of the P0/P1 authoring form.
export const DEFAULT_OPENER_TEMPLATE_ID = "opposed-opener";

export const programOpenerTemplateId = (programPlan) => {
  if (typeof programPlan?.openerTemplate !== "string" || !programPlan.openerTemplate.trim()) {
    throw new Error("program.yaml 缺少正式 openerTemplate，请在P0确定节目片头");
  }
  return programPlan.openerTemplate;
};
