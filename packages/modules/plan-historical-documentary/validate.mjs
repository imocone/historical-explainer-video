import {
  validateCommon,
  validateAcceptance as validateSharedAcceptance
} from "../plan-program/validate.mjs";

export function validate(options) {
  const errors = validateCommon(options);
  if (options.context?.programRequest?.programForm !== "historical-documentary"
    || options.result?.programForm !== "historical-documentary") {
    errors.push("plan-historical-documentary 只接纳 historical-documentary 节目");
  }
  for (const field of ["documentaryContract", "seriesConcept", "artisticApproach", "seriesNarrativeStrategy"]) {
    if (typeof options.result?.[field] !== "string" || !options.result[field].trim()) {
      errors.push(`历史纪录片节目必须明确 ${field}`);
    }
  }
  const recurringIds = (options.result?.storyWorld?.recurringElements ?? []).map(({ id }) => id);
  if (new Set(recurringIds).size !== recurringIds.length) {
    errors.push("历史纪录片 storyWorld.recurringElements 的 id 必须唯一");
  }
  for (const episode of options.result?.episodes ?? []) {
    if ((episode.storyOutline?.actionChain ?? []).some((item) => !String(item).trim())) {
      errors.push(`${episode.episodeId} storyOutline.actionChain 不得包含空动作`);
    }
  }
  return errors;
}

export const validateAcceptance = validateSharedAcceptance;
