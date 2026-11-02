import {
  validateCommon,
  validateAcceptance
} from "../author-narration/validate.mjs";

export function validate(options) {
  const errors = validateCommon(options);
  if (options.context?.episodeBrief?.programForm !== "historical-documentary") {
    errors.push("author-documentary-narration 只接纳 historical-documentary 单集");
  }
  return errors;
}

export { validateAcceptance };
export { completeCandidate } from "../author-narration/validate.mjs";
