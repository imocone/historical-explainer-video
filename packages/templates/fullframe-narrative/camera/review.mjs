import { motionRouteViewports } from "./geometry.mjs";

const epsilon = 1e-9;
const viewportCenter = (viewport) => ({
  x: viewport.x + viewport.width / 2,
  y: viewport.y + viewport.height / 2
});

const movementDirectionFor = (start, end) => {
  const startCenter = viewportCenter(start);
  const endCenter = viewportCenter(end);
  const dx = endCenter.x - startCenter.x;
  const dy = endCenter.y - startCenter.y;
  const horizontal = Math.abs(dx) < epsilon ? "" : dx > 0 ? "right" : "left";
  const vertical = Math.abs(dy) < epsilon ? "" : dy > 0 ? "down" : "up";
  return [horizontal, vertical].filter(Boolean).join("-") || "centered";
};

const routeSegmentsFor = (route) => route.slice(1).map((viewport, index) => ({
  movement: movementDirectionFor(route[index], viewport),
  scale: viewport.width < route[index].width
    ? "push-in"
    : viewport.width > route[index].width ? "pull-out" : "hold-scale"
}));

const focusSequenceFor = (request) => [
  request.attentionPlan?.entryFocus ?? "",
  ...(request.motion?.routeWaypoints ?? []).map((waypoint) => waypoint.focus),
  request.attentionPlan?.landingFocus ?? "",
  request.attentionPlan?.safeEndFocus ?? ""
];

export const adjacentMotionSummaryForTreatment = (
  treatment,
  { transitionHandoff = null } = {}
) => {
  if (treatment?.templateId !== "fullframe-narrative") return null;
  const request = treatment.assetRequests?.at(-1);
  const motion = request?.motion;
  if (!request || !motion) throw new Error("全画幅相邻运动摘要缺少末张画面或路线");
  return {
    type: motion.type,
    speedRatio: motion.speedRatio,
    ...(motion.speedChanges ? { speedChanges: structuredClone(motion.speedChanges) } : {}),
    routeSegments: routeSegmentsFor(motionRouteViewports(motion)),
    focusSequence: focusSequenceFor(request),
    startViewport: structuredClone(motion.startViewport),
    semanticEndViewport: structuredClone(motion.semanticEndViewport),
    safeEndViewport: structuredClone(motion.safeEndViewport),
    attentionPlan: structuredClone(request.attentionPlan),
    sceneDescription: request.sceneDescription,
    ...(transitionHandoff
      ? { transitionHandoff: structuredClone(transitionHandoff) }
      : {})
  };
};
