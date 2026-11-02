export {
  assertActionTimingsForTreatment,
  cueSyncTargetsForTreatment,
  defaultActionTimingsForTreatment,
  validateCueBindingsForTreatment
} from "./cue-policy-runtime.mjs";

import { inspectFullframeAuthorability } from "./authorability.mjs";

export const inspectDirectorAuthorability = (args) => {
  const inspection = inspectFullframeAuthorability(args);
  return {
    ...inspection,
    authorable: true
  };
};
