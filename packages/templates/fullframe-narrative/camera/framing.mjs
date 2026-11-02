import {
  routeCoverageRectFor,
  validateMotionGeometry
} from "./geometry.mjs";

/**
 * Derive rendering geometry from the author-owned final viewport route.
 */
export const fullframeFramingFor = ({ request }) => {
  const motion = request.spec?.motion;
  if (!motion || !new Set(["push-in", "pull-out", "traverse"]).has(motion.type)) {
    throw new Error(`${request.assetId} 缺少正文全画幅运镜设计`);
  }
  validateMotionGeometry({ motion, label: `${request.assetId} 全画幅` });
  return {
    coordinateSpace: "normalized",
    routeCoverageRect: routeCoverageRectFor(motion),
    startViewport: structuredClone(motion.startViewport),
    routeWaypoints: structuredClone(motion.routeWaypoints),
    semanticEndViewport: structuredClone(motion.semanticEndViewport),
    safeEndViewport: structuredClone(motion.safeEndViewport),
    source: "viewport-plan"
  };
};
