import { calloutLifecyclePolicyFor, isPersonTermCalloutPair } from "./timing.mjs";
import { deriveCalloutTextLayout, calloutPlacementCandidates } from "./layout.mjs";
import { cameraGeometryAtProgress, projectImagePoint, motionProgressAtFrame } from "../camera/index.mjs";

const CALLOUT_KINDS = ["historical-quote", "person-intro", "term-gloss"];

export const assertCalloutGateForRender = ({ treatment, segmentId }) => {
  const callouts = (treatment.assetRequests ?? []).flatMap((request) => request.callouts ?? []);
  for (const kind of CALLOUT_KINDS) {
    const outcome = treatment.calloutGate?.[kind];
    const count = callouts.filter((callout) => callout.kind === kind).length;
    if (outcome === "required" && count > 0) continue;
    if (outcome === "not-triggered" && count === 0) continue;
    if (kind === "historical-quote" && outcome === "deferred-no-source" && count === 0) continue;
    throw new Error(`${segmentId} 解说框硬门与 ${kind} 实际结果不一致`);
  }
};

const viewportCenter = (viewport) => ({
  x: viewport.x + viewport.width / 2,
  y: viewport.y + viewport.height / 2
});

const timingFor = ({ actionTimings, target, action, label }) => {
  const timing = actionTimings.find((item) => item.target === target && item.action === action);
  if (!timing) throw new Error(`${label} 缺少 ${target}/${action} 动作时刻`);
  if (!Number.isInteger(timing.frame)) throw new Error(`${label} ${target}/${action} 缺少确定帧`);
  return timing;
};

const sameLifecycle = (left, right) => [
  "revealStartFrame",
  "holdStartFrame",
  "exitStartFrame",
  "endFrame",
  "durationInFrames"
].every((key) => left[key] === right[key]);

const expandDisplayCallouts = ({ group, policy, segmentId, requestId }) => {
  if (group.length !== 1 || group[0].kind !== "person-intro" || group[0].people?.length !== 2) {
    return group;
  }
  const semanticCallout = group[0];
  return semanticCallout.people.map((person, personIndex) => {
    const displayCallout = {
      ...semanticCallout,
      people: [person],
      sourcePersonIndex: personIndex
    };
    return {
      ...displayCallout,
      layout: deriveCalloutTextLayout({
        callout: displayCallout,
        policy,
        label: `${segmentId}/${requestId} 双人物解说框第${personIndex + 1}项`
      })
    };
  });
};

const groupCalloutsForDisplay = ({ callouts, item, segmentId, policy }) => {
  const groups = [];
  for (const callout of callouts) {
    const sameCue = groups.find((group) => group.length === 1
      && group[0].actionTiming.frame === callout.actionTiming.frame
      && isPersonTermCalloutPair(group[0], callout)
      && sameLifecycle(group[0], callout)
      && group[0].anchorFocus === callout.anchorFocus);
    if (sameCue) sameCue.push(callout);
    else groups.push([callout]);
  }
  return groups.map((rawGroup) => {
    const semanticGroup = [...rawGroup].sort((left, right) => (
      left.kind === "person-intro" ? -1 : right.kind === "person-intro" ? 1 : 0
    ));
    if (semanticGroup.length > 1) {
      const [person, term] = semanticGroup;
      if (semanticGroup.length !== 2
        || !isPersonTermCalloutPair(person, term)
        || !sameLifecycle(person, term)
        || person.anchorFocus !== term.anchorFocus) {
        throw new Error(`${segmentId}/${item.requestId} 同cue解说框不是合法的一名人物加一个专名显示组`);
      }
    }
    const group = expandDisplayCallouts({
      group: semanticGroup,
      policy,
      segmentId,
      requestId: item.requestId
    });
    const first = group[0];
    return {
      revealStartFrame: first.revealStartFrame,
      endFrame: first.endFrame,
      enterDurationInFrames: first.revealDurationFrames,
      exitDurationInFrames: first.exitDurationFrames,
      callouts: group
    };
  });
};

export const prepareCalloutsForFrame = ({ request, segmentId, actionTimings, policy }) => {
  return (request.callouts ?? []).map((callout, calloutIndex) => {
      const calloutLabel = `${segmentId}/${request.requestId} 解说框${calloutIndex + 1}`;
      const kindPolicy = calloutLifecyclePolicyFor({
        callout,
        policy: policy.callout,
        fps: policy.fps,
        label: calloutLabel
      });
      return {
        ...callout,
        sourceCalloutIndex: calloutIndex,
        actionTiming: timingFor({
          actionTimings,
          target: `${request.requestId}.callout.${calloutIndex}`,
          action: "show-callout",
          label: calloutLabel
        }),
        revealDurationFrames: kindPolicy.revealDurationFrames,
        preferredLeadFrames: kindPolicy.preferredLeadFrames,
        holdDurationFrames: kindPolicy.holdDurationFrames,
        exitDurationFrames: kindPolicy.exitDurationFrames,
        textRevealSpread: kindPolicy.textRevealSpread ?? null,
        textBlurPx: kindPolicy.textBlurPx,
        backdropDimOpacity: kindPolicy.backdropDimOpacity,
        ...(callout.kind === "historical-quote" ? {
          citationDelayFrames: kindPolicy.citation.delayFrames,
          citationOpacity: kindPolicy.citation.opacity
        } : {}),
        layout: deriveCalloutTextLayout({ callout, policy, label: calloutLabel })
      };
    });
};

export const createCalloutOverlays = ({ fullframe, segmentId, policy }) => {
  return fullframe.flatMap((item) => {
    const itemGroups = groupCalloutsForDisplay({ callouts: item.callouts, item, segmentId, policy });
    item.callouts = [];
    return itemGroups.map((group, groupIndex) => {
      const normalizedCallouts = group.callouts.map((itemCallout) => {
        const {
          actionTiming,
          revealStartFrame,
          holdStartFrame,
          exitStartFrame,
          endFrame,
          durationInFrames: overlayDurationInFrames,
          sourceCalloutIndex,
          ...callout
        } = itemCallout;
        return {
          ...callout,
          sourceSegmentId: segmentId,
          sourceRequestId: item.requestId,
          sourceCalloutIndex,
          cueFrame: actionTiming.frame - group.revealStartFrame,
          revealStartFrame: 0,
          holdStartFrame: holdStartFrame - group.revealStartFrame,
          exitStartFrame: exitStartFrame - group.revealStartFrame,
          endFrame: overlayDurationInFrames
        };
      });
      return {
        id: `${segmentId}.${item.requestId}.callout-group.${groupIndex}`,
        startFrame: group.revealStartFrame,
        endFrame: group.endFrame,
        overlayLayer: "annotation",
        exclusiveLane: "fullframe-callout",
        transitionOverlap: {
          mode: "crossfade",
          enterDurationInFrames: group.enterDurationInFrames,
          exitDurationInFrames: group.exitDurationInFrames
        },
        renderData: {
          calloutOverlayGroup: { callouts: normalizedCallouts }
        }
      };
    });
  });
};

// Camera coverage is a geometric hint, not detected subjects or semantic anchor coordinates.
const viewingPointsDuring = ({ segments, startFrame, endFrame, policy }) => {
  const points = [];
  for (const segment of segments) {
    for (const [imageIndex, item] of (segment.renderData?.fullframe ?? []).entries()) {
      const motion = item.motion;
      const offset = motion.cameraFrameOffset ?? 0;
      const incoming = segment.renderData.frameTransitions?.[imageIndex - 1];
      const visibleStart = motion.startFrame;
      const from = Math.max(startFrame, segment.startFrame + visibleStart - offset);
      const until = Math.min(endFrame, segment.startFrame + motion.runtimeEndFrame - offset + 1);
      if (from >= until) continue;
      const centres = [motion.startViewport, ...(motion.routeWaypoints ?? []).map((point) => point.viewport),
        motion.semanticEndViewport, motion.safeEndViewport].map(viewportCenter);
      for (let frame = from; frame < until; frame += 1) {
        const progress = motionProgressAtFrame({ motion, frame: frame - segment.startFrame + offset,
          label: `${segment.id}/${item.requestId} 解说框显示期间` });
        const camera = cameraGeometryAtProgress({ motion, progress });
        for (const centre of centres) {
          const point = projectImagePoint({ point: centre, camera });
          if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
            points.push({ x: point.x * policy.width, y: point.y * policy.height });
          }
        }
      }
    }
  }
  return points;
};

export const placeCalloutOverlays = ({ overlays, segments, policy }) => {
  const ordered = overlays.filter((overlay) => overlay.templateId === "fullframe-narrative"
    && overlay.overlayLayer === "annotation")
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  const entries = [];
  for (const overlay of ordered) {
    const callouts = overlay.renderData?.calloutOverlayGroup?.callouts;
    if (!callouts?.length) throw new Error(`${overlay.id} 缺少解说框显示组`);
    const firstEntry = entries.length;
    for (const [index, callout] of callouts.entries()) {
      const source = segments.find((segment) => segment.id === callout.sourceSegmentId);
      if (!source?.renderData?.fullframe?.some((frame) => frame.requestId === callout.sourceRequestId)) {
        throw new Error(`${overlay.id} 缺少解说框来源画面`);
      }
      const endFrame = overlay.startFrame + callout.endFrame;
      entries.push({
        callout,
        startFrame: overlay.startFrame,
        endFrame,
        layout: callout.layout,
        viewingPoints: viewingPointsDuring({ segments, startFrame: overlay.startFrame, endFrame, policy }),
        placementKey: `${overlay.id}:${index}`,
        preferredCorner: callouts.length === 2 && index === 0 ? { side: "left", vertical: "top" } : null,
        pairedWith: callouts.length === 2 && index === 1 ? firstEntry : null,
        label: `${overlay.id} 第${index + 1}框`
      });
    }
  }

  // Resolve each overlapping interval before playback. Keep the old first choice
  // whenever it works, but backtrack rather than strand a later, wider callout.
  const placements = new Map();
  let componentStart = 0;
  while (componentStart < entries.length) {
    let componentEnd = componentStart + 1;
    let endFrame = entries[componentStart].endFrame;
    while (componentEnd < entries.length && entries[componentEnd].startFrame < endFrame) {
      endFrame = Math.max(endFrame, entries[componentEnd].endFrame);
      componentEnd += 1;
    }
    const failedStates = new Set();
    let deepestFailure = componentStart;
    const place = (at, previous) => {
      if (at === componentEnd) return true;
      const entry = entries[at];
      const active = previous.filter((item) => entries[item.at].endFrame > entry.startFrame);
      const state = `${at}:${active.map((item) => `${item.at}@${item.rectangle.x},${item.rectangle.y}`).join(";")}`;
      if (failedStates.has(state)) return false;
      const candidates = calloutPlacementCandidates({
        ...entry,
        policy,
        excludedRectangles: active.map((item) => item.rectangle),
        preferFarFrom: entry.pairedWith === null ? null : placements.get(entry.pairedWith)
      });
      for (const rectangle of candidates) {
        placements.set(at, rectangle);
        if (place(at + 1, [...active, { at, rectangle }])) return true;
      }
      placements.delete(at);
      deepestFailure = Math.max(deepestFailure, at);
      failedStates.add(state);
      return false;
    };
    if (!place(componentStart, [])) {
      throw new Error(`${entries[deepestFailure].label} 四角候选框均与当前显示期间的观看几何或其它解说框冲突；这不是实图主体识别或任意位置无解证明`);
    }
    componentStart = componentEnd;
  }
  for (const [index, entry] of entries.entries()) {
    entry.callout.screenRectangle = placements.get(index);
  }
  return overlays;
};
