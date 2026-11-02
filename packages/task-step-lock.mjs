import { lstat, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertProjectPath,
  atomicWriteData,
  hashObject,
  readData,
  resolveContainedPath
} from "./program-utils.mjs";

const LOCK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const lockPathFor = async ({ workspaceRoot, task, name }) => {
  if (!LOCK_NAME.test(name)) throw new Error(`步骤锁名称无效: ${String(name)}`);
  if (typeof task?.scratchPath !== "string" || !task.scratchPath || path.isAbsolute(task.scratchPath)) {
    throw new Error("当前工作单缺少任务级临时目录");
  }
  const scratch = resolveContainedPath({
    directory: workspaceRoot,
    relativePath: task.scratchPath,
    label: "工作单临时目录"
  });
  const target = resolveContainedPath({
    directory: scratch,
    relativePath: `step-locks/${name}.json`,
    label: "步骤锁路径"
  });
  await assertProjectPath({ root: workspaceRoot, file: target, label: "步骤锁路径" });
  return target;
};

export const writeTaskStepLock = async ({
  workspaceRoot,
  task,
  name,
  value,
  metadata = {}
}) => {
  if (typeof task?.taskDigest !== "string" || !/^[a-f0-9]{64}$/u.test(task.taskDigest)) {
    throw new Error("步骤锁缺少当前工作单 taskDigest");
  }
  const target = await lockPathFor({ workspaceRoot, task, name });
  const lock = {
    ...metadata,
    version: 1,
    taskDigest: task.taskDigest,
    valueSha256: hashObject(value)
  };
  await atomicWriteData(target, lock);
  return lock;
};

export const readTaskStepLock = async ({ workspaceRoot, task, name }) => {
  const target = await lockPathFor({ workspaceRoot, task, name });
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("步骤锁必须是普通文件");
  const lock = await readData(target);
  if (lock?.version !== 1 || lock?.taskDigest !== task?.taskDigest) {
    throw new Error("步骤锁不属于当前工作单");
  }
  if (typeof lock?.valueSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(lock.valueSha256)) {
    throw new Error("步骤锁缺少有效输入摘要");
  }
  return lock;
};

export const validateTaskStepLock = async ({ workspaceRoot, task, name, value, label }) => {
  try {
    const lock = await readTaskStepLock({ workspaceRoot, task, name });
    if (lock.valueSha256 !== hashObject(value)) {
      return [`${label}已改变，必须返回对应步骤重新执行`];
    }
    return [];
  } catch (error) {
    return [`${label}缺少当前任务的有效步骤锁: ${error.message}`];
  }
};

export const removeTaskStepLock = async ({ workspaceRoot, task, name }) => {
  const target = await lockPathFor({ workspaceRoot, task, name });
  await rm(target, { force: true });
};
