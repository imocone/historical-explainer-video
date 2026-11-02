import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, link, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

export const stableStringify = (value) => Array.isArray(value)
  ? `[${value.map(stableStringify).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const hashObject = (value) => sha256(stableStringify(value));
export const readData = async (file) => {
  const content = await readFile(file, "utf8");
  try { return JSON.parse(content); }
  catch (error) { throw new Error(`${file} 必须使用 JSON 兼容的 YAML 1.2 写法: ${error.message}`); }
};
export const fileSha256 = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
export const resolveContainedPath = ({
  directory,
  relativePath,
  label = "相对路径"
}) => {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error(`${label}必须是非空相对路径: ${relativePath}`);
  }
  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(resolvedDirectory, relativePath);
  const relative = path.relative(resolvedDirectory, resolvedFile);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label}越界，越出允许目录: ${relativePath}`);
  }
  return resolvedFile;
};
export const assertProjectPath = async ({ root, file, label = "项目路径" }) => {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label}必须位于项目根目录内: ${file}`);
  }
  let current = resolvedRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`${label}不得包含符号链接: ${file}`);
  }
  return resolvedFile;
};
export const assertProjectMutationTree = async ({
  root,
  file,
  label = "项目写入树"
}) => {
  const resolved = await assertProjectPath({ root, file, label });
  const inspect = async (current) => {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`${label}不得包含符号链接: ${current}`);
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      await inspect(path.join(current, entry.name));
    }
  };
  await inspect(resolved);
  return resolved;
};
export const atomicWrite = async (file, content) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
};
export const atomicWriteData = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
};
export const withProjectLock = async ({
  root,
  lock,
  label = "当前任务",
  execute
}) => {
  await assertProjectPath({ root, file: lock, label: `${label}锁路径` });
  await mkdir(path.dirname(lock), { recursive: true });
  const owner = {
    schemaVersion: "1.0",
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString()
  };
  const candidate = `${lock}.candidate-${process.pid}-${owner.token}`;
  await assertProjectPath({ root, file: candidate, label: `${label}候选锁路径` });
  await atomicWriteData(candidate, owner);

  const acquire = async (remainingAttempts = 3) => {
    try {
      await link(candidate, lock);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let current;
    try {
      current = await readData(lock);
    } catch (error) {
      if (error?.code === "ENOENT" && remainingAttempts > 0) return acquire(remainingAttempts - 1);
      throw new Error(`${label}已有锁，但锁记录无效，必须人工确认`, { cause: error });
    }
    const validOwner = current?.schemaVersion === "1.0"
      && typeof current.token === "string"
      && Number.isInteger(current.pid)
      && current.pid > 0
      && typeof current.hostname === "string";
    if (!validOwner || current.hostname !== owner.hostname || processIsAlive(current.pid)) {
      throw new Error(`${label}已有进程执行`);
    }
    if (remainingAttempts <= 0) throw new Error(`${label}陈旧锁恢复冲突`);
    const staleToken = current.token;
    const recovery = `${lock}.recovery-${sha256(staleToken)}`;
    await assertProjectPath({ root, file: recovery, label: `${label}恢复锁路径` });
    try {
      await mkdir(recovery);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`${label}陈旧锁正在恢复或上次恢复未收口`);
      }
      throw error;
    }
    try {
      let confirmed;
      try {
        confirmed = await readData(lock);
      } catch (error) {
        if (error?.code === "ENOENT") return acquire(remainingAttempts - 1);
        throw new Error(`${label}陈旧锁恢复时无法重新核验锁记录`, { cause: error });
      }
      if (confirmed.token !== staleToken) {
        return acquire(remainingAttempts - 1);
      }
      const stillStale = confirmed?.schemaVersion === "1.0"
        && Number.isInteger(confirmed.pid)
        && confirmed.pid > 0
        && confirmed.hostname === owner.hostname
        && !processIsAlive(confirmed.pid);
      if (!stillStale) throw new Error(`${label}锁身份在恢复期间发生变化`);
      await rm(lock);
      return acquire(remainingAttempts - 1);
    } finally {
      await rm(recovery, { recursive: true, force: true });
    }
  };

  let acquired = false;
  try {
    await acquire();
    acquired = true;
    await rm(candidate, { force: true });
    return await execute();
  } finally {
    await rm(candidate, { force: true });
    if (acquired) {
      try {
        const current = await readData(lock);
        if (current.token === owner.token) await rm(lock, { force: true });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
};
export const withoutProducer = (value) => {
  if (Array.isArray(value)) return value.map(withoutProducer);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "_producer")
    .map(([key, child]) => [key, withoutProducer(child)]));
};
export const programProducer = ({ task, business }) => ({
  moduleId: task.moduleId,
  nodeId: task.nodeId,
  taskDigest: task.taskDigest,
  inputs: task.inputHashes,
  outputSha256: hashObject(business)
});
