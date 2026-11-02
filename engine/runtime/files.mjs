import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EPISODE_ID_PATTERN,
  TARGET_ID_PATTERN,
  getEpisodePaths
} from "../../packages/workspace-paths.mjs";
import { assertProjectPath, sha256 } from "../../packages/program-utils.mjs";
const EPISODE_ID = EPISODE_ID_PATTERN;

const PROGRAM_ID = TARGET_ID_PATTERN;

const REVISION_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const EMPTY_SOURCE_ASSETS = {
  schemaVersion: "1.0",
  assets: []
};

const initializeMissingSourceAssets = async ({ workspaceRoot, episodeId }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  await assertProjectPath({
    root: workspaceRoot,
    file: paths.sourceAssets,
    label: "P3 缺省来源资产清单路径"
  });
  await mkdir(paths.input, { recursive: true });
  try {
    await writeFile(paths.sourceAssets, `${JSON.stringify(EMPTY_SOURCE_ASSETS, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
};

class WorkflowInputError extends Error {
  constructor({ workflowId, stageId, nodeId, upstreamStageId = null, cause }) {
    super(`${nodeId} 输入无法成立: ${cause.message}`, { cause });
    this.code = "workflow-input-invalid";
    this.workflowId = workflowId;
    this.stageId = stageId;
    this.nodeId = nodeId;
    this.upstreamStageId = upstreamStageId;
  }
}

const relative = (root, absolute) => path.relative(root, absolute).split(path.sep).join("/");

const exists = async (file) =>
  access(file).then(
    () => true,
    () => false
  );

const assertProjectPaths = async ({ root, label, files }) => {
  await Promise.all([...new Set(files)].map((file) => assertProjectPath({ root, file, label })));
};

const readResourceBytes = (file, resourceCache) => {
  if (!resourceCache) return readFile(file);
  const key = path.resolve(file);
  if (!resourceCache.has(key)) {
    const pending = readFile(key).catch((error) => {
      resourceCache.delete(key);
      throw error;
    });
    resourceCache.set(key, pending);
  }
  return resourceCache.get(key);
};

const readResourceData = async (file, resourceCache) => {
  const content = (await readResourceBytes(file, resourceCache)).toString("utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${file} 必须使用 JSON 兼容的 YAML 1.2 写法: ${error.message}`);
  }
};

const readTextResource = async (root, file, resourceCache) => {
  const content = (await readResourceBytes(file, resourceCache)).toString("utf8");
  return { source: relative(root, file), sha256: sha256(content), content };
};

const readObjectResource = async (root, file, resourceCache) => {
  const content = (await readResourceBytes(file, resourceCache)).toString("utf8");
  return { source: relative(root, file), sha256: sha256(content), content: JSON.parse(content) };
};

const importModule = async (file, resourceCache) =>
  import(`${pathToFileURL(file).href}?sha=${sha256(await readResourceBytes(file, resourceCache))}`);

const filesUnder = async (directory) => {
  if (!(await exists(directory))) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`正式包禁止符号链接: ${target}`);
    if (entry.isDirectory() && entry.name === "__pycache__") continue;
    if (entry.isFile() && /\.(?:pyc|pyo)$/iu.test(entry.name)) continue;
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`正式包包含不支持的文件类型: ${target}`);
  }
  return files.sort();
};

export {
  EPISODE_ID,
  PROGRAM_ID,
  REVISION_REQUEST_ID,
  WorkflowInputError,
  assertProjectPaths,
  exists,
  filesUnder,
  importModule,
  initializeMissingSourceAssets,
  readResourceBytes,
  readResourceData,
  readObjectResource,
  readTextResource,
  relative
};
