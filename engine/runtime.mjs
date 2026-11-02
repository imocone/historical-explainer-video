export {
  atomicWriteData,
  hashObject,
  readData,
  sha256,
  stableStringify
} from "../packages/program-utils.mjs";
export {
  enabledFeatureIdsForNode,
  assertP3BodyRedesignRequest,
  assertP3BodyRedesignPreservesVisualPlan
} from "./runtime/storyboard.mjs";
export { programInvocationTask } from "./runtime/tasks.mjs";
export {
  assertPublicationRevisionRequest,
  assertCoverRegenerationRequest
} from "./runtime/publication-requests.mjs";
export { assertP3QuoteRevisionRequest } from "./runtime/quote-revision-contract.mjs";
export { authorPreviousTreatmentProducerInputsForResult } from "./runtime/author-tasks.mjs";
import { resolveProgramCurrent as resolveProgramState } from "./runtime/state-program.mjs";
export const resolveProgramCurrent = async (options) =>
  materializeCurrent(await resolveProgramState(options));
import { resolvePublicationCurrent as resolvePublicationState } from "./runtime/state-publication.mjs";
export const resolvePublicationCurrent = async (options) =>
  materializeCurrent(await resolvePublicationState(options));
export { resolveRenderInputs } from "./runtime/state-video.mjs";
export { deriveStatus } from "./runtime/status.mjs";
export { runNext } from "./runtime/next.mjs";
export { acceptCandidate } from "./runtime/accept.mjs";
export { checkProject } from "./runtime/check.mjs";
export { resetStage } from "./runtime/stage-restart.mjs";
export { runRange, projectStatus } from "./runtime/stage-control.mjs";

const materializeCurrent = (current) => {
  if (current.kind === "task" && current.runner === "ai")
    current.workOrder = current.createWorkOrder(current.allowedReturnTargets);
  return current;
};
