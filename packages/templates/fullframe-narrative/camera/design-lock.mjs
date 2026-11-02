import {
  removeTaskStepLock,
  validateTaskStepLock,
  writeTaskStepLock
} from "../../../task-step-lock.mjs";
import { fullframeDesignItemsForCandidate } from "./candidate-context.mjs";

const CAMERA_FINAL_LOCK = "fullframe-camera-final";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const DESIGN_REQUEST_FIELDS = Object.freeze([
  "requestId",
  "kind",
  "frameId",
  "cameraRelation",
  "purpose",
  "sourceRefs",
  "mustNotInvent",
  "required",
  "acceptanceCriteria",
  "attentionPlan",
  "sceneDescription",
  "motion"
]);

const assertAllowedKeys = ({ value, allowed, label }) => {
  if (!isObject(value)) throw new Error(`${label} 必须是对象`);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) {
    throw new Error(`当前步骤不接受${label}中的未知字段: ${extras.join(", ")}`);
  }
};

const assertNonEmptyUniqueTexts = ({ value, label, pattern = null }) => {
  if (!Array.isArray(value) || value.length < 1) throw new Error(`${label} 必须是非空数组`);
  if (value.some((item) => typeof item !== "string" || !item.trim() || (pattern && !pattern.test(item)))) {
    throw new Error(`${label} 包含无效值`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} 不得重复`);
};

const assertFrameCueItems = ({ candidateResult, allowedActions, label }) => {
  const featureResults = candidateResult.featureResults;
  // Optional Feature results belong to author-beat, not this picture lock.
  if (!featureResults || typeof featureResults !== 'object' || Array.isArray(featureResults))
    throw new Error('featureResults须为对象');
  const cueSync = featureResults["cue-sync"];
  assertAllowedKeys({ value: cueSync, allowed: new Set(["items"]), label: "featureResults.cue-sync" });
  if (!Array.isArray(cueSync.items)) throw new Error(`${label}缺少Cue运动绑定`);
  for (const [index, item] of cueSync.items.entries()) {
    assertAllowedKeys({
      value: item,
      allowed: new Set(["target", "action", "cueId", "edge"]),
      label: `featureResults.cue-sync.items[${index}]`
    });
    if (!allowedActions.has(item.action)) {
      throw new Error(`${label}不接受Cue动作: ${String(item.action)}`);
    }
  }
};

export const assertFullframeDesignStage = (candidateResult) => {
  assertAllowedKeys({
    value: candidateResult,
    allowed: new Set(["treatment", "featureResults"]),
    label: "candidate.result"
  });
  const treatment = candidateResult.treatment;
  assertAllowedKeys({
    value: treatment,
    allowed: new Set(["templateId", "assetRequests", "continuity", "incomingTransition", "calloutGate"]),
    label: "treatment"
  });
  if (!Object.hasOwn(treatment, "incomingTransition")) throw new Error("联合设计缺少incomingTransition，首拍及讲解交界写null");
  if (!isObject(treatment.continuity)) throw new Error("联合画面／相机设计缺少continuity");
  if (!Array.isArray(treatment.assetRequests) || treatment.assetRequests.length < 1) {
    throw new Error("联合画面／相机设计缺少全画幅画面");
  }
  for (const [index, request] of treatment.assetRequests.entries()) {
    const label = `treatment.assetRequests[${index}]`;
    assertAllowedKeys({
      value: request,
      allowed: new Set([...DESIGN_REQUEST_FIELDS, "exactTexts", "incomingTransition", "callouts", "effects", "asset", "effectAnchors"]),
      label
    });
    const missing = DESIGN_REQUEST_FIELDS.filter((field) => !Object.hasOwn(request, field));
    if (missing.length) throw new Error(`联合画面／相机设计缺少${label}字段: ${missing.join(", ")}`);
    if (!/^AR[0-9]{3}$/u.test(request.requestId ?? "")) throw new Error(`${label}.requestId 无效`);
    if (request.kind !== "fullframe-image" || request.required !== true) {
      throw new Error(`${label} 必须是 required=true 的 fullframe-image`);
    }
    if (!["A", "B"].includes(request.frameId)) throw new Error(`${label}.frameId 无效`);
    if (typeof request.purpose !== "string" || !request.purpose.trim()) throw new Error(`${label}.purpose 缺少观看职责`);
    assertNonEmptyUniqueTexts({ value: request.sourceRefs, label: `${label}.sourceRefs`,
      pattern: /^(?:C[0-9]{3,}|(?:F|R|E|SA)[0-9]{3})$/u });
    assertNonEmptyUniqueTexts({ value: request.mustNotInvent, label: `${label}.mustNotInvent` });
    for (const field of ["entryFocus", "landingFocus", "viewerChange"]) {
      if (typeof request.attentionPlan?.[field] !== "string" || !request.attentionPlan[field].trim()) {
        throw new Error(`${label}.attentionPlan.${field} 缺失`);
      }
    }
    if (index > 0 && !request.incomingTransition) throw new Error(`${label} 缺少进入本图的转场设计`);
    if (index === 0 && Object.hasOwn(request, "incomingTransition")) throw new Error("首图入场只写 treatment.incomingTransition，不能重复保存");
    if (Object.hasOwn(request, "exactTexts")) {
      assertNonEmptyUniqueTexts({ value: request.exactTexts, label: `${label}.exactTexts` });
    }
  }
  assertFrameCueItems({
    candidateResult,
    allowedActions: new Set(["start-frame-motion", "dissolve-in", "show-callout", "show-effect"]),
    label: "联合画面／相机设计"
  });
};

const frameBindingsForLock = ({ featureResults, requestIds }) => (
  (featureResults?.["cue-sync"]?.items ?? [])
    .filter((item) => requestIds.has(item?.target)
      && new Set(["start-frame-motion", "dissolve-in"]).has(item?.action))
    .map((item) => ({
      target: item.target,
      action: item.action,
      cueId: item.cueId,
      edge: item.edge
    }))
    .sort((left, right) => (
      String(left.target).localeCompare(String(right.target))
      || String(left.action).localeCompare(String(right.action))
    ))
);

const fullframeDesignInputForLock = ({ candidateResult, templateContext }) => {
  const treatment = candidateResult?.treatment;
  const featureResults = candidateResult?.featureResults;
  const requests = treatment?.assetRequests ?? [];
  if (requests.length < 1) throw new Error("联合设计缺少全画幅画面选择");
  const designItems = fullframeDesignItemsForCandidate({
    treatment,
    featureResults,
    templateContext,
    planningOnly: true
  });
  const budgetByRequest = new Map(designItems.map((item) => [item.id, item.budget]));
  const requestIds = new Set(requests.map((request) => request.requestId));
  return {
    frames: requests.map((request) => {
      if (!request.requestId || !request.frameId || !request.purpose || !request.attentionPlan) {
        throw new Error("联合设计要求每张画面已有requestId、frameId、purpose与attentionPlan");
      }
      const budget = budgetByRequest.get(request.requestId);
      if (!budget) throw new Error(`${request.requestId} 缺少所选时窗的正式运镜预算`);
      return {
        requestId: request.requestId,
        kind: request.kind,
        frameId: request.frameId,
        purpose: request.purpose,
        sourceRefs: structuredClone(request.sourceRefs),
        mustNotInvent: structuredClone(request.mustNotInvent),
        required: request.required,
        attentionPlan: {
          entryFocus: request.attentionPlan.entryFocus,
          landingFocus: request.attentionPlan.landingFocus,
          viewerChange: request.attentionPlan.viewerChange
        },
        budget: structuredClone(budget)
      };
    }),
    frameBindings: frameBindingsForLock({ featureResults, requestIds })
  };
};

const requestDesignForLock = ({ request }) => Object.fromEntries(
  [...DESIGN_REQUEST_FIELDS, "exactTexts", "incomingTransition", "effects", "asset", "effectAnchors"]
    .filter((field) => Object.hasOwn(request, field))
    .map((field) => [field, structuredClone(request[field])])
);

export const fullframeFinalDesignForLock = ({ candidateResult, templateContext }) => {
  const treatment = candidateResult?.treatment;
  const effectBindings = (candidateResult.featureResults?.["cue-sync"]?.items ?? [])
    .filter((item) => item.action === "show-effect")
    .map((item) => structuredClone(item)).sort((a, b) => a.target.localeCompare(b.target));
  return {
    designInput: fullframeDesignInputForLock({ candidateResult, templateContext }),
    continuity: structuredClone(treatment?.continuity ?? null),
    incomingTransition: structuredClone(treatment?.incomingTransition ?? null),
    ...(effectBindings.length ? { effectBindings } : {}),
    frames: (treatment?.assetRequests ?? []).map((request) => requestDesignForLock({
      request
    }))
  };
};

export const writeFullframeCameraFinalLock = ({ workspaceRoot, task, candidateResult, templateContext }) => {
  assertFullframeDesignStage(candidateResult);
  return writeTaskStepLock({
    workspaceRoot,
    task,
    name: CAMERA_FINAL_LOCK,
    value: fullframeFinalDesignForLock({ candidateResult, templateContext })
  });
};

export const validateFullframeCameraFinalLock = ({ workspaceRoot, task, candidateResult, templateContext }) => (
  validateTaskStepLock({
    workspaceRoot,
    task,
    name: CAMERA_FINAL_LOCK,
    value: fullframeFinalDesignForLock({ candidateResult, templateContext }),
    label: "最终锁定的画面与相机"
  })
);

export const removeFullframeCameraFinalLock = ({ workspaceRoot, task }) => (
  removeTaskStepLock({ workspaceRoot, task, name: CAMERA_FINAL_LOCK })
);
