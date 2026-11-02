import {
  validateTaskStepLock,
  writeTaskStepLock
} from "../../../task-step-lock.mjs";
import {
  fullframeFinalDesignForLock,
  validateFullframeCameraFinalLock
} from "../camera/design-lock.mjs";
import {
  validateFullframeCalloutPreparation,
  validateFullframeCallouts
} from "./validate.mjs";

const CALLOUT_CONTENT_LOCK = "fullframe-callout-content";

const calloutContentForLock = ({ candidateResult, templateContext }) => ({
  camera: fullframeFinalDesignForLock({ candidateResult, templateContext }),
  decision: structuredClone(candidateResult?.treatment?.calloutGate ?? null),
  frames: (candidateResult?.treatment?.assetRequests ?? []).map((request) => ({
    requestId: request.requestId,
    callouts: structuredClone(request.callouts ?? [])
  })),
  bindings: (candidateResult?.featureResults?.["cue-sync"]?.items ?? [])
    .filter((item) => item.action === "show-callout")
    .map(({ target, action, cueId, edge }) => ({ target, action, cueId, edge }))
    .sort((left, right) => left.target.localeCompare(right.target))
});

export const writeCalloutContentLock = async ({
  workspaceRoot,
  task,
  candidateResult,
  context
}) => {
  const errors = [
    ...validateFullframeCallouts({ result: candidateResult.treatment }),
    ...await validateFullframeCameraFinalLock({
      workspaceRoot,
      task,
      candidateResult,
      templateContext: context?.templateContext
    }),
    ...await validateFullframeCalloutPreparation({
      result: candidateResult.treatment,
      context,
      services: { workspaceRoot, task }
    })
  ];
  if (errors.length) throw new Error(errors.join("; "));
  return writeTaskStepLock({
    workspaceRoot,
    task,
    name: CALLOUT_CONTENT_LOCK,
    value: calloutContentForLock({ candidateResult, templateContext: context?.templateContext })
  });
};

export const validateCalloutContentLock = ({
  workspaceRoot,
  task,
  candidateResult,
  templateContext
}) => (
  validateTaskStepLock({
    workspaceRoot,
    task,
    name: CALLOUT_CONTENT_LOCK,
    value: calloutContentForLock({ candidateResult, templateContext }),
    label: "已完成的解说框判断、内容、引文预留与显示Cue"
  })
);
