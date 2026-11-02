import { fullframeDesignItemsForCandidate } from "./camera/candidate-context.mjs";
import {verifyAuthoredImage} from "../../authored-images.mjs";
import {assertEffectAnchors} from "./effects/runtime.mjs";
import { narrativeCameraSampleOffsets, resolveNarrativeTransition } from "../../modules/render-video/runtime/narrative-transition.mjs";
import { canUseSourceForExternalProduction } from "../../source-rights.mjs";
import { inspectFullframeAuthorability } from "./authorability.mjs";
import { fullframeCameraSampleFrames } from "./timing-runtime.mjs";
import { assertFullframeFramePolicy } from "./capacity-policy.mjs";
import {
  fullframeCameraRelationErrors,
  motionRouteViewportsAtFrames,
  motionSpeedRatioAtFrame,
  validateMotionGeometry
} from "./camera/index.mjs";
import {
  inspectFullframeDesigns
} from "./camera/p4-runtime.mjs";
import { FULLFRAME_RENDER_POLICY } from "./render-policy.mjs";
import { VIDEO_SPEC } from "../../video-spec.mjs";
import { effectDesignErrors } from "./effects/runtime.mjs";
import {
  validateFullframeCameraFinalLock
} from "./camera/design-lock.mjs";
import {
  validateCalloutContentLock
} from "./callout/step-locks.mjs";
import {
  validateFullframeCalloutPreparation,
  validateFullframeCallouts
} from "./callout/validate.mjs";
const normalized = (value) => String(value ?? "").replace(/\s+/gu, "").trim();
const cueSourceRef = (cueId) => `C${String(cueId).padStart(3, "0")}`;

const cueBounds = (cues) => {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  const startMs = cues[0]?.startMs;
  const endMs = cues.at(-1)?.endMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, durationMs: endMs - startMs };
};

const validateSources = (errors, requests, context) => {
  const semanticItems = [
    ...(context.semanticContext?.facts ?? []),
    ...(context.semanticContext?.relations ?? []),
    ...(context.semanticContext?.evidence ?? [])
  ];
  const semanticById = new Map(semanticItems.map((item) => [item.id, item]));
  const sources = new Map((context.sourceAssets ?? []).map((item) => [item.id, item]));
  const cuesByRef = new Map((context.cues ?? []).map((cue) => [cueSourceRef(cue.id), cue]));
  for (const request of requests) {
    for (const ref of request.sourceRefs ?? []) {
      if (ref.startsWith("C")) {
        const cue = cuesByRef.get(ref);
        if (!cue) errors.push(`素材需求引用当前创作单位之外的正文cue: ${ref}`);
      } else if (ref.startsWith("SA")) {
        const source = sources.get(ref);
        if (!source) errors.push(`素材需求引用未登记来源资产: ${ref}`);
        else if (!canUseSourceForExternalProduction(source.rightsStatus)) errors.push(`素材需求来源资产权利状态不可用: ${ref}`);
      } else {
        const item = semanticById.get(ref);
        if (!item) errors.push(`素材需求引用未知语义: ${ref}`);
      }
    }
  }
};

const validateContinuity = (errors, current, previous) => {
  const subjects = new Set(current?.subjects ?? []);
  const props = new Set(current?.props ?? []);
  for (const subject of current?.carryToNext?.subjects ?? []) {
    if (!subjects.has(subject)) errors.push(`carryToNext 主体必须已在当前拍出现: ${subject}`);
  }
  for (const prop of current?.carryToNext?.props ?? []) {
    if (!props.has(prop)) errors.push(`carryToNext 道具必须已在当前拍出现: ${prop}`);
  }
  if (current?.continuesPreviousScene === true) {
    if (previous?.templateId !== "fullframe-narrative") {
      errors.push("continuesPreviousScene 只允许承接同段紧邻上一正文全画幅 Beat");
    } else if (!previous.exitPicture) {
      errors.push("continuesPreviousScene 缺少上一全画幅末张场景输入");
    }
  }
};

const validateCameraRelations = (errors, requests, previousTreatment, continuity) => {
  for (const [index, request] of requests.entries()) {
    const relation = request.cameraRelation;
    if (index === 0) {
      if (!previousTreatment && relation !== "first") {
        errors.push(`${request.requestId} 本段没有上一画面，相机关系必须为 first`);
      }
      if (previousTreatment && relation === "first") {
        errors.push(`${request.requestId} 本段已有上一画面，相机关系不得为 first`);
      }
      if (new Set(["continue", "motivated-reverse", "visual-match"]).has(relation)
        && !previousTreatment?.cameraState) {
        errors.push(`${request.requestId} 的 ${relation} 缺少上一全画幅相机状态`);
      }
      if (new Set(["continue", "motivated-reverse"]).has(relation)
        && continuity?.continuesPreviousScene !== true) {
        errors.push(`${request.requestId} 的 ${relation} 必须承接同一物理场景，不能用于换场`);
      }
      continue;
    }
    if (relation === "first") {
      errors.push(`${request.requestId} 位于同一Beat的A画面之后，相机关系不得为 first`);
    }
  }
};

const validateExecutableCameraRelations = (errors, requests, context, incomingTransition) => {
  let items;
  try {
    items = fullframeDesignItemsForCandidate({
      treatment: { assetRequests: requests },
      featureResults: context.featureResults,
      templateContext: context.templateContext,
      cues: context.cues
    });
  } catch (error) {
    errors.push(`全画幅接镜检查无法取得正式路线预算: ${error.message}`);
    return;
  }
  for (const [index, request] of requests.entries()) {
    if (!new Set(["continue", "motivated-reverse"]).has(request.cameraRelation)) continue;
    let previousType;
    let previousSpeedRatio;
    let previousRouteViewports;
    let currentFrames;
    let previousHandoffIndex = 0;
    if (index === 0) {
      const handoff = context.previousTreatment?.cameraState?.transitionHandoff;
      previousType = handoff?.previousType;
      previousSpeedRatio = handoff?.previousMotion?.speedRatio;
      try {
        const offsets = narrativeCameraSampleOffsets(incomingTransition ?? null);
        const previousOffsets = narrativeCameraSampleOffsets(incomingTransition ?? null, VIDEO_SPEC.fps);
        currentFrames = offsets.map((offset) => handoff.currentFrameAtCut + offset);
        previousSpeedRatio = motionSpeedRatioAtFrame({ motion: handoff.previousMotion,
          frame: handoff.previousMotionFrameAtCut + previousOffsets[0] });
        previousRouteViewports = motionRouteViewportsAtFrames({
          motion: handoff.previousMotion, motionStartFrame: handoff.previousMotion.startFrame,
          frames: previousOffsets.map((offset) => handoff.previousMotionFrameAtCut + offset),
          fps: VIDEO_SPEC.fps, motionPolicy: FULLFRAME_RENDER_POLICY.motion,
          label: `${request.requestId} 实际转场的上一镜`
        });
      } catch (error) {
        errors.push(`${request.requestId} 无法计算所选转场的接镜: ${error.message}`);
        continue;
      }
    } else {
      previousType = requests[index - 1]?.motion?.type;
      previousSpeedRatio = requests[index - 1]?.motion?.speedRatio;
      try {
        const design = resolveNarrativeTransition(request.incomingTransition);
        const startFrame = items[index].cutFrame - Math.floor(design.durationInFrames / 2);
        const samples = fullframeCameraSampleFrames({ startFrame, endFrame: startFrame + design.durationInFrames, design });
        currentFrames = samples.current;
        previousHandoffIndex = samples.previousHandoffIndex;
        previousSpeedRatio = motionSpeedRatioAtFrame({ motion: items[index - 1].motion,
          motionStartFrame: items[index - 1].budget.startFrame,
          frame: samples.previous[0] + items[index - 1].budget.cameraPrerollFrames });
        previousRouteViewports = motionRouteViewportsAtFrames({
          motion: items[index - 1]?.motion,
          motionStartFrame: items[index - 1]?.budget?.startFrame,
          frames: samples.previous.map((at) => at + items[index - 1].budget.cameraPrerollFrames),
          fps: VIDEO_SPEC.fps,
          motionPolicy: FULLFRAME_RENDER_POLICY.motion,
          label: `${requests[index - 1]?.requestId}->${request.requestId} 上一同帧交接`
        });
      } catch (error) {
        errors.push(`${request.requestId} 接镜检查无法派生上一同帧交接路线: ${error.message}`);
        continue;
      }
    }
    let currentRouteViewports;
    try {
      currentRouteViewports = motionRouteViewportsAtFrames({
        motion: items[index]?.motion,
        motionStartFrame: items[index]?.budget?.startFrame,
        frames: currentFrames,
        fps: VIDEO_SPEC.fps,
        motionPolicy: FULLFRAME_RENDER_POLICY.motion,
        label: `${request.requestId} 当前同帧交接`
      });
    } catch (error) {
      errors.push(`${request.requestId} 接镜检查无法派生当前同帧交接路线: ${error.message}`);
      continue;
    }
    errors.push(...fullframeCameraRelationErrors({
      relation: request.cameraRelation,
      previousType,
      currentType: request.motion?.type,
      previousSpeedRatio,
      currentSpeedRatio: motionSpeedRatioAtFrame({ motion: request.motion,
        motionStartFrame: items[index].budget.startFrame, frame: currentFrames[0] }),
      previousRouteViewports,
      currentRouteViewports,
      previousHandoffIndex,
      label: `${request.requestId} ${request.cameraRelation}`
    }));
  }
};

const validateRequiredCueTiming = (errors, requests, context) => {
  const bounds = cueBounds(context.cues);
  if (!bounds) {
    errors.push("工作单缺少可解析的当前 Beat 字幕时长");
    return;
  }
  try {
    const frameIds = requests.map((request) => request.frameId);
    assertFullframeFramePolicy({
      targetDurationMs: bounds.durationMs,
      frameIds
    });
    const cues = context.cues;
    const inspection = inspectFullframeAuthorability({
      cueRange: [cues[0].id, cues.at(-1).id],
      cues,
      label: "当前全画幅 Beat"
    });
    const isAB = JSON.stringify(frameIds) === JSON.stringify(["A", "B"]);
    if (isAB && !inspection.allowsAB) {
      errors.push("当前真实字幕没有能让A/B各自保有可读时窗的边界");
    }
    if (!(context.enabledFeatureIds ?? []).includes("cue-sync")) {
      errors.push("正文全画幅每张画面都必须启用 cue-sync，并绑定真实字幕边界");
    }
  } catch (error) {
    errors.push(error.message);
  }
};

const validateMotionViewports = (errors, motion, requestId) => {
  try {
    validateMotionGeometry({ motion, label: requestId });
  } catch (error) {
    errors.push(error.message);
  }
};

const validateMotionBudgets = (errors, requests, context) => {
  if (requests.length < 1) return;
  try {
    const items = fullframeDesignItemsForCandidate({
      treatment: { assetRequests: requests },
      featureResults: context.featureResults,
      templateContext: context.templateContext,
      cues: context.cues
    });
    for (const inspection of inspectFullframeDesigns({ items })) {
      if (!inspection.ok) errors.push(`${inspection.id} 运镜预算失败: ${inspection.error}`);
    }
  } catch (error) {
    errors.push(error.message);
  }
};

export function validateFullframeDesignSemantics({ result, context }) {
  const errors = [];
  const requests = result.assetRequests ?? [];
  const requestIds = requests.map((item) => item.requestId);
  const frameIds = requests.map((item) => item.frameId);
  const orderedFrameIds = requests.map((_, index) => String.fromCharCode("A".charCodeAt(0) + index));
  if (new Set(requestIds).size !== requestIds.length) errors.push("全画幅素材 requestId 必须唯一");
  if (new Set(frameIds).size !== frameIds.length) errors.push("全画幅 frameId 必须唯一");
  if (JSON.stringify(frameIds) !== JSON.stringify(orderedFrameIds)) errors.push("全画幅素材必须从A开始按字母连续排列");
  if (Object.hasOwn(result, "cameraIntent")) errors.push("全画幅不得保留顶层 cameraIntent");
  if (Object.hasOwn(result, "frameTests")) errors.push("全画幅画面数必须由真实语义确定，不得保留 frameTests");
  for (const request of requests) {
    const attentionPlan = request.attentionPlan;
    errors.push(...effectDesignErrors(request));
    const motion = request.motion;
    if (!attentionPlan) {
      errors.push(`全画幅素材缺少独立 attentionPlan: ${request.requestId}`);
      continue;
    }
    if (!motion) {
      errors.push(`全画幅素材缺少独立 motion: ${request.requestId}`);
      continue;
    }
    if (!new Set(["push-in", "pull-out", "traverse"]).has(motion.type)) errors.push(`正文全画幅必须使用可见语义运镜: ${request.requestId}`);
    const semanticFocuses = [
      attentionPlan.entryFocus,
      ...(motion.routeWaypoints ?? []).map((waypoint) => waypoint?.focus),
      attentionPlan.landingFocus
    ].map(normalized);
    if (semanticFocuses.some((focus) => !focus)) {
      errors.push(`语义观看路线的每个焦点都必须说明观众看见什么: ${request.requestId}`);
    }
    if (!normalized(attentionPlan.safeEndFocus)) {
      errors.push(`安全终界必须说明仍在观看什么: ${request.requestId}`);
    }
    if (!normalized(attentionPlan.viewerChange)) {
      errors.push(`注意力编排必须说明本图的观看目的: ${request.requestId}`);
    }
  }
  validateCameraRelations(errors, requests, context.previousTreatment, result.continuity);
  validateRequiredCueTiming(errors, requests, context);
  validateSources(errors, requests, context);
  validateContinuity(errors, result.continuity, context.previousTreatment);
  try {
    resolveNarrativeTransition(result.incomingTransition ?? null);
    if (context.templateContext?.incomingTransitionSupported === true && result.incomingTransition == null) {
      errors.push("当前全画幅接缝必须按前后字幕语义显式设计叠化或闪黑；不能以null自动选择");
    }
    for (const [index, request] of requests.entries()) {
      if (index === 0 && Object.hasOwn(request, "incomingTransition")) throw new Error("A的入场只写treatment.incomingTransition");
      if (index > 0) {
        if (!request.incomingTransition) throw new Error(`${request.requestId} 缺少逐画面转场设计`);
        resolveNarrativeTransition(request.incomingTransition);
      }
    }
    if (context.templateContext?.incomingTransitionSupported === false && result.incomingTransition != null) {
      errors.push("当前首拍或讲解交界由对应模板拥有进出，incomingTransition须为null");
    }
  } catch (error) { errors.push(error.message); }
  validateExecutableCameraRelations(errors, requests, context, result.incomingTransition);
  return errors;
}

export function validate({ result, context }) {
  const errors = [
    ...validateFullframeCallouts({ result, context }),
    ...validateFullframeDesignSemantics({ result, context })
  ];
  const requests = result.assetRequests ?? [];
  validateMotionBudgets(errors, requests, context);
  for (const request of requests) {
    if (request.motion) validateMotionViewports(errors, request.motion, request.requestId);
  }
  return errors;
}

export async function validateAcceptance({ result, context, services }) {
  const imageErrors = [];
  for (const request of result.assetRequests ?? []) try {
    await verifyAuthoredImage({asset:request.asset,workspaceRoot:services.workspaceRoot,episodeId:services.episodeId,
      stageId:"p3",unitId:context.authorUnit.id});
    assertEffectAnchors({request,anchors:request.effectAnchors,required:true});
  } catch (error) { imageErrors.push(error.message); }
  const candidateResult = services?.candidateResult ?? { treatment: result, featureResults: {} };
  return [
    ...imageErrors,
    ...await validateFullframeCameraFinalLock({
      workspaceRoot: services?.workspaceRoot,
      task: services?.task,
      candidateResult,
      templateContext: context?.templateContext
    }),
    ...await validateCalloutContentLock({
      workspaceRoot: services?.workspaceRoot,
      task: services?.task,
      candidateResult,
      templateContext: context?.templateContext
    }),
    ...await validateFullframeCalloutPreparation({
      result,
      context,
      services
    })
  ];
}
