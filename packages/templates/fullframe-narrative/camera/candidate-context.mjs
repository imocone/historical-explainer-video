import { frameForTime } from "../../../cue-boundaries.mjs";
import { frameSpanForMs, VIDEO_SPEC } from "../../../video-spec.mjs";
import { fullframeMotionBudgetForCueOption } from "../cue-policy-runtime.mjs";

const sameBinding = (left, right) => (
  String(left?.cueId) === String(right?.cueId) && left?.edge === right?.edge
);

const selectedMotionBudgetOption = ({ requests, featureResults, templateContext }) => {
  const frameIds = requests.map((request) => request?.frameId);
  const expectedFrameIds = requests.length === 1 ? ["A"] : requests.length === 2 ? ["A", "B"] : null;
  if (!expectedFrameIds || JSON.stringify(frameIds) !== JSON.stringify(expectedFrameIds)) {
    throw new Error("全画幅相机设计只接受顺序完整的A或A/B画面集合");
  }
  const requestIds = new Set(requests.map((request) => request?.requestId));
  if (requestIds.size !== requests.length || requestIds.has(undefined)) {
    throw new Error("全画幅相机设计画面缺少唯一requestId");
  }
  const motionBindings = (featureResults?.["cue-sync"]?.items ?? []).filter((item) => (
    requestIds.has(item?.target)
    && new Set(["start-frame-motion", "dissolve-in"]).has(item?.action)
  ));
  if (motionBindings.length !== requests.length) {
    throw new Error("全画幅相机设计必须为每张A/B画面提供且只提供一个正式运镜Cue绑定");
  }
  const bindingFor = (request, action) => {
    const matches = motionBindings.filter((item) => item.target === request.requestId && item.action === action);
    if (matches.length !== 1) {
      throw new Error(`${request.requestId} 缺少唯一 ${action} Cue绑定`);
    }
    return matches[0];
  };
  const firstBinding = bindingFor(requests[0], "start-frame-motion");
  const frameAOptions = templateContext?.cueOptions?.frameA ?? [];
  if (!frameAOptions.some((binding) => sameBinding(binding, firstBinding))) {
    throw new Error("全画幅A起始Cue没有消费工作单frameA正式选项");
  }
  const options = templateContext?.motionBudgets?.options ?? [];
  let option;
  if (requests.length === 1) {
    option = options.find((item) => item.binding === null);
  } else {
    const secondBinding = bindingFor(requests[1], "dissolve-in");
    const frameBOptions = templateContext?.cueOptions?.frameB ?? [];
    if (!frameBOptions.some((binding) => sameBinding(binding, secondBinding))) {
      throw new Error("全画幅B进入Cue没有消费工作单frameB正式选项");
    }
    option = options.find((item) => sameBinding(item.binding, secondBinding));
  }
  if (!option) throw new Error("全画幅候选找不到与完整A/B Cue绑定一致的正式运镜预算");
  return option;
};

export const fullframeDesignItemsForCandidate = ({ treatment, featureResults, templateContext, cues, planningOnly = false }) => {
  const requests = treatment?.assetRequests ?? [];
  const option = selectedMotionBudgetOption({ requests, featureResults, templateContext });
  let frames = option.frames;
  let cutFrame = null;
  if (!planningOnly) {
    if (!cues?.length || (requests.length > 1 && !requests[1].incomingTransition)) throw new Error("全画幅实际运镜预算需要当前字幕与B的转场设计");
    const startMs = cues[0].startMs;
    const endMs = cues.at(-1).endMs;
    if (requests.length > 1) {
      const cue = cues.find((item) => String(item.id) === String(option.binding.cueId));
      if (!cue) throw new Error("全画幅实际运镜预算找不到B的字幕边界");
      cutFrame = frameForTime({ timeMs: option.binding.edge === "start" ? cue.startMs : cue.endMs,
        segmentStartMs: startMs, segmentEndMs: endMs, fps: VIDEO_SPEC.fps });
    }
    frames = fullframeMotionBudgetForCueOption({
      durationInFrames: frameSpanForMs({ startMs, endMs, fps: VIDEO_SPEC.fps }),
      switchFrame: cutFrame, transitionDesign: requests[1]?.incomingTransition ?? null,
      speedRatios: requests.map((request) => request.motion?.speedRatio),
      motions: requests.map((request) => request.motion),
      runtimeTiming: { cameraPrerollFrames: option.frames[0].cameraPrerollFrames,
        exitTailFrames: option.frames.at(-1).exitTailFrames }, fps: VIDEO_SPEC.fps
    });
  }
  const budgets = new Map((frames ?? []).map((budget) => [budget.frameId, budget]));
  if (budgets.size !== requests.length) {
    throw new Error("全画幅正式运镜预算没有逐帧完整覆盖当前A/B画面");
  }
  return requests.map((request) => ({
    id: request.requestId,
    motion: request.motion,
    cutFrame,
    budget: (() => {
      const budget = budgets.get(request.frameId);
      if (!budget) throw new Error(`${request.requestId} 缺少所选时窗的正式运镜预算`);
      return budget;
    })()
  }));
};

