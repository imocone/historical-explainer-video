const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const epsilon = 1e-9;
const normalizedZero = (value) => Object.is(value, -0) ? 0 : value;
const finiteBetween = (value, minimum, maximum) => (
  Number.isFinite(value) && value >= minimum && value <= maximum
);

export class FullframeCameraDesignError extends Error {
  constructor(failureClass, message) {
    super(message);
    this.name = "FullframeCameraDesignError";
    this.failureClass = failureClass;
  }
}

const designError = (failureClass, message) => new FullframeCameraDesignError(failureClass, message);

const bodyFullframeMotionTypes = ["push-in", "pull-out", "traverse"];
export const FULLFRAME_VIEWPORT_POLICY = Object.freeze({
  maximumRenderScale: 1.5
});

export const cameraForViewport = (viewport) => ({
  scale: 1 / viewport.width,
  left: normalizedZero(-viewport.x / viewport.width),
  top: normalizedZero(-viewport.y / viewport.height)
});

export const viewportForCamera = (camera) => ({
  x: normalizedZero(-camera.left / camera.scale),
  y: normalizedZero(-camera.top / camera.scale),
  width: 1 / camera.scale,
  height: 1 / camera.scale
});

const validateViewport = (viewport, label) => {
  if (
    !viewport
    || !finiteBetween(viewport.x, 0, 1)
    || !finiteBetween(viewport.y, 0, 1)
    || !finiteBetween(viewport.width, 0, 1)
    || !finiteBetween(viewport.height, 0, 1)
    || viewport.width <= 0
    || viewport.height <= 0
    || viewport.x + viewport.width > 1 + epsilon
    || viewport.y + viewport.height > 1 + epsilon
    || Math.abs(viewport.width - viewport.height) > epsilon
  ) throw designError("framing-contract", `${label} 必须是完整位于成图内的16:9归一化取景框`);
};

const rectContains = (outer, inner) => (
  inner.x >= outer.x - epsilon
  && inner.y >= outer.y - epsilon
  && inner.x + inner.width <= outer.x + outer.width + epsilon
  && inner.y + inner.height <= outer.y + outer.height + epsilon
);

const viewportCenter = (viewport) => ({
  x: viewport.x + viewport.width / 2,
  y: viewport.y + viewport.height / 2
});

const sameViewport = (left, right) => Boolean(left && right) && [
  "x",
  "y",
  "width",
  "height"
].every((key) => Math.abs(left[key] - right[key]) <= epsilon);

export const motionRouteViewports = (motion) => {
  const route = [
    motion?.startViewport,
    ...(motion?.routeWaypoints ?? []).map((waypoint) => waypoint?.viewport),
    motion?.semanticEndViewport
  ];
  if (!sameViewport(route.at(-1), motion?.safeEndViewport)) route.push(motion?.safeEndViewport);
  return route;
};

export const coverageRectForViewports = (viewports) => {
  if (!Array.isArray(viewports) || viewports.length < 1) {
    throw new Error("全画幅路线覆盖范围缺少取景点");
  }
  return {
    x: Math.min(...viewports.map((viewport) => viewport.x)),
    y: Math.min(...viewports.map((viewport) => viewport.y)),
    width: Math.max(...viewports.map((viewport) => viewport.x + viewport.width))
      - Math.min(...viewports.map((viewport) => viewport.x)),
    height: Math.max(...viewports.map((viewport) => viewport.y + viewport.height))
      - Math.min(...viewports.map((viewport) => viewport.y))
  };
};

export const routeCoverageRectFor = (motion) => coverageRectForViewports(motionRouteViewports(motion));

const validateMaximumViewportScale = ({ maximumScale, label }) => {
  if (maximumScale > FULLFRAME_VIEWPORT_POLICY.maximumRenderScale + epsilon) {
    throw designError(
      "framing-contract",
      `${label} 的取景框会放大 ${maximumScale.toFixed(3)} 倍，超过全画幅允许的`
      + `${FULLFRAME_VIEWPORT_POLICY.maximumRenderScale.toFixed(3)}倍`
    );
  }
};

const validateMotionDefinition = ({ motion, label }) => {
  if (!bodyFullframeMotionTypes.includes(motion?.type)) {
    throw designError("route-definition", `${label} 不支持正文运镜: ${motion?.type ?? "missing"}`);
  }
  if (!Array.isArray(motion.routeWaypoints)) {
    throw designError("route-definition", `${label} routeWaypoints 必须是数组`);
  }
  for (const [index, waypoint] of motion.routeWaypoints.entries()) {
    if (typeof waypoint?.focus !== "string" || !waypoint.focus.trim()) {
      throw designError(
        "route-definition",
        `${label} routeWaypoints[${index}].focus 必须说明这个中间观看点告诉观众什么`
      );
    }
  }
  const route = motionRouteViewports(motion);
  for (const [index, viewport] of route.entries()) {
    validateViewport(viewport, `${label} 路线取景点${index + 1}`);
  }
  validateMaximumViewportScale({
    maximumScale: Math.max(...route.map((viewport) => 1 / viewport.width)),
    label
  });
  let previousCenterDelta = null;
  for (let index = 1; index < route.length; index += 1) {
    const previousCenter = viewportCenter(route[index - 1]);
    const currentCenter = viewportCenter(route[index]);
    const currentDelta = {
      x: currentCenter.x - previousCenter.x,
      y: currentCenter.y - previousCenter.y
    };
    if (Math.hypot(currentDelta.x, currentDelta.y) <= epsilon) continue;
    if (previousCenterDelta
      && previousCenterDelta.x * currentDelta.x + previousCenterDelta.y * currentDelta.y < -epsilon) {
      throw designError("direction-conflict", `${label} 的相邻中心方向不得反向折返`);
    }
    previousCenterDelta = currentDelta;
  }
  if (motion.type === "push-in") {
    for (let index = 1; index < route.length; index += 1) {
      if (!(route[index].width < route[index - 1].width - epsilon)
        || !rectContains(route[index - 1], route[index])) {
        throw designError(
          "motion-shape",
          `${label} push-in 的每个后续取景都必须位于前一取景内并继续推近`
        );
      }
    }
  } else if (motion.type === "pull-out") {
    for (let index = 1; index < route.length; index += 1) {
      if (!(route[index - 1].width < route[index].width - epsilon)
        || !rectContains(route[index], route[index - 1])) {
        throw designError(
          "motion-shape",
          `${label} pull-out 的每个后续取景都必须包含前一取景并继续拉远`
        );
      }
    }
  } else {
    for (let index = 1; index < route.length; index += 1) {
      if (Math.abs(route[index].width - route[0].width) > epsilon) {
        throw designError("motion-shape", `${label} traverse 的全部取景点必须等大`);
      }
      const previousCenter = viewportCenter(route[index - 1]);
      const currentCenter = viewportCenter(route[index]);
      const distance = Math.hypot(
        previousCenter.x - currentCenter.x,
        previousCenter.y - currentCenter.y
      );
      if (distance <= epsilon) {
        throw designError("motion-shape", `${label} traverse 不得包含重复取景点`);
      }
    }
  }
};

const validateCamera = (camera, label) => {
  if (
    !camera
    || !Number.isFinite(camera.scale)
    || !Number.isFinite(camera.left)
    || !Number.isFinite(camera.top)
    || camera.scale < 1
    || camera.left > epsilon
    || camera.top > epsilon
    || camera.left + camera.scale < 1 - epsilon
    || camera.top + camera.scale < 1 - epsilon
  ) throw new Error(`${label} 不能完整覆盖输出画布`);
};

const validateMotionCameras = ({ motion, label }) => {
  if (!motion.startCamera || !motion.endCamera) throw new Error(`${label} 起止相机必须同时存在`);
  validateCamera(motion.startCamera, `${label} 起始相机`);
  validateCamera(motion.endCamera, `${label} 结束相机`);
  for (const [index, camera] of (motion.cameraPath?.cameras ?? []).entries()) {
    validateCamera(camera, `${label} 路线相机${index + 1}`);
  }
  const maximumScale = Math.max(
    motion.startCamera.scale,
    motion.endCamera.scale,
    ...(motion.cameraPath?.cameras ?? []).map((camera) => camera.scale)
  );
  if (maximumScale > FULLFRAME_VIEWPORT_POLICY.maximumRenderScale + epsilon) {
    throw new Error(
      `${label} 实际相机超过全画幅取景上限`
      + `${FULLFRAME_VIEWPORT_POLICY.maximumRenderScale.toFixed(3)}倍`
    );
  }
};

export const cameraPositionAtDistance = ({ cameras, segmentLengths, distance }) => {
  let traversed = 0;
  let segmentIndex = 0;
  while (segmentIndex < segmentLengths.length - 1
    && traversed + segmentLengths[segmentIndex] < distance - epsilon) {
    traversed += segmentLengths[segmentIndex];
    segmentIndex += 1;
  }
  const segmentLength = segmentLengths[segmentIndex];
  const progress = segmentLength <= epsilon
    ? 1
    : clamp((distance - traversed) / segmentLength, 0, 1);
  const startCamera = cameras[segmentIndex];
  const endCamera = cameras[segmentIndex + 1];
  return {
    segmentIndex,
    camera: {
      scale: startCamera.scale + (endCamera.scale - startCamera.scale) * progress,
      left: startCamera.left + (endCamera.left - startCamera.left) * progress,
      top: startCamera.top + (endCamera.top - startCamera.top) * progress
    }
  };
};

export const cameraGeometryAtProgress = ({ motion, progress, label = "全画幅运镜" }) => {
  if (!bodyFullframeMotionTypes.includes(motion?.type)) {
    throw new Error(`${label} 不支持正文运镜: ${motion?.type ?? "missing"}`);
  }
  if (!Number.isFinite(progress)) throw new Error(`${label} 运镜进度必须为有限数值`);
  const cameraPath = motion.cameraPath;
  if (!cameraPath
    || !Array.isArray(cameraPath.cameras)
    || !Array.isArray(cameraPath.segmentLengths)
    || cameraPath.cameras.length !== cameraPath.segmentLengths.length + 1
    || !Number.isFinite(cameraPath.travelDistance)
    || cameraPath.travelDistance <= 0) {
    throw new Error(`${label} 缺少已派生分段相机路线`);
  }
  return cameraPositionAtDistance({
    cameras: cameraPath.cameras,
    segmentLengths: cameraPath.segmentLengths,
    distance: cameraPath.travelDistance * clamp(progress, 0, 1)
  }).camera;
};

export const projectImagePoint = ({ point, camera, label = "全画幅锚点" }) => {
  if (!point || !finiteBetween(point.x, 0, 1) || !finiteBetween(point.y, 0, 1)) {
    throw new Error(`${label} 必须是归一化画面点`);
  }
  const projected = {
    x: camera.left + point.x * camera.scale,
    y: camera.top + point.y * camera.scale
  };
  return projected;
};

export const validateMotionGeometry = ({ motion, label = "全画幅运镜" }) => {
  validateMotionDefinition({ motion, label });
  if (!motion.startCamera && !motion.endCamera) return;
  validateMotionCameras({ motion, label });
};

export const validateMotionFraming = ({ motion, framing, label = "全画幅路线交接" }) => {
  validateMotionDefinition({ motion, label });
  if (!framing || framing.source !== "viewport-plan" || framing.coordinateSpace !== "normalized") {
    throw new Error(`${label} framing 必须来自归一化 viewport-plan`);
  }
  if (!Array.isArray(framing.routeWaypoints)
    || framing.routeWaypoints.length !== motion.routeWaypoints.length) {
    throw new Error(`${label} 实图镜框不得增删P3观看点`);
  }
  for (const [index, waypoint] of motion.routeWaypoints.entries()) {
    const framingWaypoint = framing.routeWaypoints[index];
    if (framingWaypoint?.focus !== waypoint.focus) {
      throw new Error(`${label} 实图 routeWaypoints[${index}].focus 改变了P3中间语义焦点`);
    }
  }
  const realized = { ...framing, type: motion.type };
  validateMotionDefinition({ motion: realized, label: `${label} 实际取景` });
  if (sameViewport(motion.semanticEndViewport, motion.safeEndViewport)
    !== sameViewport(framing.semanticEndViewport, framing.safeEndViewport)) {
    throw new Error(`${label} 实图镜框不得增删P3末端安全延伸`);
  }
  // The model maps the authored viewing order onto real image positions.
  // The route's own direction, nesting and scale remain checked above.
  const expectedCoverage = routeCoverageRectFor(realized);
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(framing.routeCoverageRect?.[key])
      || Math.abs(framing.routeCoverageRect[key] - expectedCoverage[key]) > epsilon) {
      throw new Error(`${label} 实图覆盖范围没有由最终取景唯一推导`);
    }
  }
  return framing;
};

export const validateRuntimeSafeRange = ({
  actualEndViewport,
  actualRouteViewports,
  actualSafeRect,
  routeCoverageRect,
  label = "P4 全画幅实际安全范围"
}) => {
  validateViewport(actualEndViewport, `${label} actualEndViewport`);
  if (!Array.isArray(actualRouteViewports) || actualRouteViewports.length < 2) {
    throw new Error(`${label} 缺少P4实际经过的路线取景`);
  }
  for (const [index, viewport] of actualRouteViewports.entries()) {
    validateViewport(viewport, `${label} actualRouteViewports[${index}]`);
  }
  const expectedActualSafeRect = coverageRectForViewports(actualRouteViewports);
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(actualSafeRect?.[key])
      || Math.abs(actualSafeRect[key] - expectedActualSafeRect[key]) > epsilon) {
      throw new Error(`${label} 没有由实际起止取景唯一推导`);
    }
    if (!Number.isFinite(routeCoverageRect?.[key])) {
      throw new Error(`${label} 缺少实图完整路线覆盖范围`);
    }
  }
  if (!rectContains(routeCoverageRect, actualSafeRect)) {
    throw new Error(`${label} 超出实图完整路线覆盖范围`);
  }
  return actualSafeRect;
};
