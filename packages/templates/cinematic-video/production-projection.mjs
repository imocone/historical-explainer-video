import { withoutProducer } from "../../program-utils.mjs";

export const projectVideoProduction = (plan) => {
  if (!plan) return plan;
  const { incomingTransitions: _transitions, ...production } = withoutProducer(plan);
  return production;
};
