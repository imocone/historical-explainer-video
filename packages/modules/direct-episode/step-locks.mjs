import {
  removeTaskStepLock,
  validateTaskStepLock,
  writeTaskStepLock
} from "../../task-step-lock.mjs";

const BOUNDARY_INSPECTION_LOCK = "director-boundary-inspection";
const BOUNDARIES_LOCK = "director-boundaries";
const AUTHORABILITY_LOCK = "director-authorability";

export const directorBoundariesForLock = (result) => structuredClone(result);

export const writeDirectorBoundaryInspectionLock = ({ workspaceRoot, task, result }) => (
  writeTaskStepLock({
    workspaceRoot,
    task,
    name: BOUNDARY_INSPECTION_LOCK,
    value: directorBoundariesForLock(result)
  })
);

export const validateDirectorBoundaryInspectionLock = ({ workspaceRoot, task, result }) => (
  validateTaskStepLock({
    workspaceRoot,
    task,
    name: BOUNDARY_INSPECTION_LOCK,
    value: directorBoundariesForLock(result),
    label: "最近一次枚举的整集画册与Beat边界"
  })
);

export const writeDirectorBoundariesLock = ({ workspaceRoot, task, result }) => (
  writeTaskStepLock({
    workspaceRoot,
    task,
    name: BOUNDARIES_LOCK,
    value: directorBoundariesForLock(result)
  })
);

export const validateDirectorBoundariesLock = ({ workspaceRoot, task, result }) => (
  validateTaskStepLock({
    workspaceRoot,
    task,
    name: BOUNDARIES_LOCK,
    value: directorBoundariesForLock(result),
    label: "已封存且未漂移的整集画册与Beat边界"
  })
);

export const writeDirectorAuthorabilityLock = ({ workspaceRoot, task, result }) => (
  writeTaskStepLock({
    workspaceRoot,
    task,
    name: AUTHORABILITY_LOCK,
    value: result
  })
);

export const validateDirectorAuthorabilityLock = ({ workspaceRoot, task, result }) => (
  validateTaskStepLock({
    workspaceRoot,
    task,
    name: AUTHORABILITY_LOCK,
    value: result,
    label: "已通过锁前可创作性检查的完整导演候选"
  })
);

export const removeDirectorAuthorabilityLock = ({ workspaceRoot, task }) => (
  removeTaskStepLock({ workspaceRoot, task, name: AUTHORABILITY_LOCK })
);
