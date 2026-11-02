import { validate as validateSegmented } from "../opposed-opener/validate.mjs";

export { completeCandidate, openerNarrationText, spokenSentencesForTreatment, validateOpenerNarration } from "../opposed-opener/validate.mjs";

const audible = value => String(value ?? "").normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");

// Match the author's existing comma/sentence boundaries; numeric punctuation
// such as 1,000 and 3.14 belongs to the number, not a new picture.
const narrationSegments = value => {
  const text = String(value ?? "").normalize("NFKC");
  const segments = [];
  let part = "";
  for (let i=0; i<text.length; i++) {
    const character = text[i];
    part += character;
    const numericComma = character === "," && /\d/u.test(text[i-1] ?? "")
      && /^\d{3}(?:,\d{3})*(?!\d)/u.test(text.slice(i+1));
    const decimalPoint = character === "." && /\d/u.test(text[i-1] ?? "") && /\d/u.test(text[i+1] ?? "");
    if (/[，,。.!！?？]/u.test(character) && !numericComma && !decimalPoint) {
      if (audible(part)) segments.push(audible(part));
      part = "";
    }
  }
  if (audible(part)) segments.push(audible(part));
  return segments;
};

export const validate = options => {
  const errors = validateSegmented({...options, expectedTemplateId:"glass-opener"});
  const segments = narrationSegments(options.result.flashbackLine);
  const shots = (options.result.flashbackShots ?? []).map(shot => audible(shot.spokenText));
  if (segments.length !== shots.length || segments.some((segment,i) => segment !== shots[i]))
    errors.push("片头必须按原文逗号和句末标点分段，每段对应一张图");
  return errors;
};
