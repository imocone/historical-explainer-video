import {assetFile} from '../../packages/runtime-config.mjs';
import { readResourceBytes, readResourceData } from "./files.mjs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { assertProjectPath, sha256 } from "../../packages/program-utils.mjs";
import { exists, filesUnder, readObjectResource, relative } from "./files.mjs";
import { compileSchema, validateSchema } from "./schema.mjs";
const packageDirectories = async (
  root,
  kind,
  { ids = null, ignoreUndeclaredRoots = false } = {}
) => {
  const base = path.join(root, "packages", kind);
  await assertProjectPath({
    root,
    file: base,
    label: `${relative(root, base)} 正式包根`
  });
  if (!(await exists(base))) return [];
  if (ids) {
    const baseReal = await realpath(base);
    const directories = [];
    for (const id of [...ids].sort()) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
        throw new Error(`非法正式包 id: ${id}`);
      }
      const directory = path.resolve(base, id);
      if (!directory.startsWith(`${path.resolve(base)}${path.sep}`)) {
        throw new Error(`非法正式包 id: ${id}`);
      }
      const info = await lstat(directory).catch(() => null);
      if (!info) throw new Error(`${relative(root, directory)} 不存在`);
      if (info.isSymbolicLink()) {
        throw new Error(`${relative(root, base)} 禁止符号链接: ${id}`);
      }
      if (!info.isDirectory()) {
        throw new Error(`${relative(root, directory)} 不是正式包目录`);
      }
      const actual = await realpath(directory);
      const actualRelative = path.relative(baseReal, actual);
      if (actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
        throw new Error(`${relative(root, directory)} 真实路径越出正式包根`);
      }
      if (!(await exists(path.join(directory, "package.yaml")))) {
        throw new Error(`${relative(root, directory)} 缺少 package.yaml`);
      }
      directories.push(directory);
    }
    return directories;
  }
  const directories = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    if (ignoreUndeclaredRoots) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(base, entry.name);
      const manifestInfo = await lstat(path.join(directory, "package.yaml")).catch(() => null);
      if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) continue;
      directories.push(directory);
      continue;
    }
    if (entry.isSymbolicLink())
      throw new Error(`${relative(root, base)} 禁止符号链接: ${entry.name}`);
    if (!entry.isDirectory())
      throw new Error(`${relative(root, base)} 包含根孤儿文件: ${entry.name}`);
    const directory = path.join(base, entry.name);
    if (!(await exists(path.join(directory, "package.yaml")))) {
      throw new Error(`${relative(root, directory)} 缺少 package.yaml`);
    }
    directories.push(directory);
  }
  return directories.sort();
};

const assertPackageTree = async (root, directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`正式包禁止符号链接: ${relative(root, target)}`);
    if (entry.isDirectory() && entry.name === "__pycache__") continue;
    if (entry.isFile() && /\.(?:pyc|pyo)$/iu.test(entry.name)) continue;
    if (entry.isDirectory()) await assertPackageTree(root, target);
    else if (!entry.isFile())
      throw new Error(`正式包包含不支持的文件类型: ${relative(root, target)}`);
  }
};

const assertPackageResourceFile = async ({ root, target, label }) => {
  const targetParts = path.resolve(target).split(path.sep);
  if (targetParts.includes("__pycache__") || /\.(?:pyc|pyo)$/iu.test(path.basename(target))) {
    throw new Error(`${label} 不得把 Python 运行缓存登记为正式业务资源`);
  }
  await assertProjectPath({ root, file: target, label });
  const resolvedRoot = await realpath(root);
  const info = await lstat(target).catch(() => null);
  if (!info) throw new Error(`${label} 缺少文件`);
  if (info.isSymbolicLink()) throw new Error(`${label} 禁止符号链接`);
  if (!info.isFile()) throw new Error(`${label} 必须是文件`);
  const actual = await realpath(target);
  const actualRelative = path.relative(resolvedRoot, actual);
  if (actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
    throw new Error(`${label} 真实路径越出项目根目录`);
  }
};

const loadPackages = async (
  root,
  {
    moduleIds = null,
    includeKinds = new Set(["module", "template", "feature", "cover"]),
    resourceCache,
    stageScoped = false
  } = {}
) => {
  const schema = path.join(root, "contracts", "package.schema.json");
  const records = [];
  for (const kind of ["modules", "templates", "features", "covers"]) {
    const expectedKind = kind.slice(0, -1);
    if (!includeKinds.has(expectedKind)) continue;
    const ids = expectedKind === "module" && moduleIds ? moduleIds : null;
    for (const directory of await packageDirectories(root, kind, {
      ids,
      ignoreUndeclaredRoots: stageScoped && ids == null
    })) {
      const manifestPath = path.join(directory, "package.yaml");
      if (!(await exists(manifestPath))) continue;
      await assertPackageResourceFile({
        root,
        target: manifestPath,
        label: `${relative(root, manifestPath)} 正式包清单`
      });
      const manifest = await readResourceData(manifestPath, resourceCache);
      if (
        stageScoped &&
        expectedKind !== "module" &&
        moduleIds &&
        !(manifest.implements ?? []).some((implementation) =>
          moduleIds.has(implementation?.moduleId)
        )
      ) {
        continue;
      }
      await validateSchema(schema, manifest, manifestPath, resourceCache);
      if (manifest.kind !== expectedKind) {
        throw new Error(`${manifestPath} 位于 packages/${kind}，kind 必须为 ${expectedKind}`);
      }
      if (manifest.id !== path.basename(directory))
        throw new Error(`${manifestPath} 的 id 必须等于目录名`);
      records.push({ manifest, manifestPath, directory });
    }
  }
  const ids = records.map((record) => record.manifest.id);
  if (new Set(ids).size !== ids.length) throw new Error(`包 id 重复: ${ids.join(", ")}`);
  return new Map(records.map((record) => [record.manifest.id, record]));
};

const loadPackageController = async (root, record, resourceCache) => {
  const { manifest, directory, manifestPath } = record;
  const controllerPath = path.resolve(directory, manifest.controllerEntry);
  if (!controllerPath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error(`${manifestPath} 的 controllerEntry 必须由当前 Module Package 拥有`);
  }
  if (path.extname(controllerPath) !== ".json") {
    throw new Error(
      `${manifestPath} 的 controllerEntry 必须是纯声明 JSON，禁止文件、网络、环境、时间、随机或任意代码能力`
    );
  }
  await assertPackageResourceFile({ root, target: controllerPath, label: `${manifestPath} 的 controllerEntry` });
  try {
    const resource = await readObjectResource(root, controllerPath, resourceCache);
    await validateSchema(path.join(root, "contracts", "module-controller.schema.json"),
      resource.content, controllerPath, resourceCache);
    return resource;
  } catch (error) {
    throw new Error(
      `${manifestPath} 的 controllerEntry 必须是纯声明 JSON，禁止文件、网络、环境、时间、随机或任意代码能力: ${error.message}`
    );
  }
};

const assertPackageResources = async (root, record, resourceCache) => {
  const { manifest, directory, manifestPath } = record;
  if (!record.stageProjected) await assertPackageTree(root, directory);
  for (const field of [
    "outputSchema",
    "validator",
    "controllerEntry",
    "programEntry",
    "authorContextEntry",
    "assetContractEntry",
    "renderEntry",
    "renderPlanEntry",
    "cuePolicy",
    "renderer"
  ]) {
    if (!manifest[field]) continue;
    const target = path.resolve(directory, manifest[field]);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
      throw new Error(`${manifestPath} 的 ${field} 越出项目根目录`);
    await assertPackageResourceFile({
      root,
      target,
      label: `${manifestPath} 的 ${field}: ${manifest[field]}`
    });
  }
  for (const [field, resources] of Object.entries({
    rules: manifest.rules ?? [],
    authorRules: manifest.authorRules ?? [],
    copyRules: manifest.copyRules ?? [],
    acceptanceRules: manifest.acceptanceRules ?? [],
    assetContractRules: manifest.assetContractRules ?? [],
    renderRules: manifest.renderRules ?? [],
    coverRules: manifest.coverRules ?? [],
    renderAssets: manifest.renderAssets ?? [],
    examples: manifest.examples ?? [],
    generatedResources: manifest.generatedResources ?? [],
    runtimeResources: manifest.runtimeResources ?? []
  })) {
    for (const resource of resources) {
      const target = path.resolve(directory, resource);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
        throw new Error(`${manifestPath} 的 ${field} 越出项目根目录: ${resource}`);
      await assertPackageResourceFile({
        root,
        target,
        label: `${manifestPath} 的 ${field}: ${resource}`
      });
    }
  }
  if (manifest.kind === "template") {
    if (
      manifest.assetContractEntry &&
      !manifest.assetContractRules?.includes(manifest.assetContractEntry)
    ) {
      throw new Error(`${manifestPath} 的 assetContractRules 必须包含 assetContractEntry`);
    }
    if (manifest.renderer && !manifest.renderRules?.includes(manifest.renderer)) {
      throw new Error(`${manifestPath} 的 renderRules 必须包含 renderer`);
    }
    if (manifest.renderRules) {
      const declared = new Set(
        manifest.renderRules.map((resource) => path.resolve(directory, resource))
      );
      const implementation = [
        ...(await filesUnder(path.join(directory, "render"))),
        ...(await filesUnder(path.join(directory, "components")))
      ];
      const missing = implementation.filter((file) => !declared.has(file));
      if (missing.length)
        throw new Error(
          `${manifestPath} 的 renderRules 未登记模板实现: ${relative(root, missing[0])}`
        );
    }
  }
  if (manifest.kind === "feature") {
    if (manifest.renderEntry && !manifest.renderRules?.includes(manifest.renderEntry)) {
      throw new Error(`${manifestPath} 的 renderRules 必须包含 renderEntry`);
    }
  }
  const declaredLocalFiles = new Set(["package.yaml"]);
  const declareLocal = (resource) => {
    if (!resource) return;
    const absolute = path.resolve(directory, resource);
    if (absolute === directory || !absolute.startsWith(`${directory}${path.sep}`)) return;
    declaredLocalFiles.add(path.relative(directory, absolute).split(path.sep).join("/"));
  };
  for (const field of [
    "outputSchema",
    "validator",
    "controllerEntry",
    "programEntry",
    "authorContextEntry",
    "assetContractEntry",
    "renderEntry",
    "renderPlanEntry",
    "cuePolicy",
    "renderer"
  ]) {
    declareLocal(manifest[field]);
  }
  for (const field of [
    "rules",
    "authorRules",
    "copyRules",
    "acceptanceRules",
    "assetContractRules",
    "renderRules",
    "coverRules",
    "renderAssets",
    "examples",
    "generatedResources",
    "runtimeResources"
  ]) {
    for (const resource of manifest[field] ?? []) declareLocal(resource);
  }
  if (!record.stageProjected) {
    const undeclared = (await filesUnder(directory))
      .map((file) => path.relative(directory, file).split(path.sep).join("/"))
      .filter(
        (file) =>
          !declaredLocalFiles.has(file) &&
          file !== "agents/openai.yaml" &&
          !file.endsWith(".test.mjs")
      );
    if (undeclared.length) {
      throw new Error(`${manifestPath} 包含未由清单声明的业务文件: ${undeclared[0]}`);
    }
  }
  if (manifest.outputSchema) {
    compileSchema(
      await readResourceData(path.resolve(directory, manifest.outputSchema), resourceCache),
      manifest.outputSchema
    );
  }
  if (manifest.kind === "module") {
    await loadPackageController(root, record, resourceCache);
  }
};

const hydratePackageResources = async (root, record, resourceCache) => {
  const paths = new Set();
  for (const field of [
    "outputSchema",
    "validator",
    "controllerEntry",
    "programEntry",
    "authorContextEntry",
    "assetContractEntry",
    "renderEntry",
    "renderPlanEntry",
    "cuePolicy",
    "renderer"
  ]) {
    if (record.manifest[field]) paths.add(record.manifest[field]);
  }
  for (const field of [
    "rules",
    "authorRules",
    "copyRules",
    "acceptanceRules",
    "assetContractRules",
    "renderRules",
    "coverRules",
    "runtimeResources"
  ]) {
    for (const resource of record.manifest[field] ?? []) paths.add(resource);
  }
  const resourcesByPath = new Map();
  // Template教材供作者按需读取；Cover示例仍是生产参考，保留字节身份。
  for (const resource of record.manifest.examples ?? []) {
    if (record.manifest.kind === "template") {
      resourcesByPath.set(resource, { source: relative(root, assetFile(path.resolve(record.directory, resource),{root})) });
    } else {
      paths.add(resource);
    }
  }
  for (const resource of [...paths].sort()) {
    const absolute = path.resolve(record.directory, resource);
    if (
      ((record.manifest.examples ?? []).includes(resource)
        || (record.manifest.runtimeResources ?? []).includes(resource)) &&
      /\.(png|jpe?g|webp)$/iu.test(resource)
    ) {
      resourcesByPath.set(resource, {
        source: relative(root, absolute),
        sha256: sha256(await readResourceBytes(absolute, resourceCache))
      });
      continue;
    }
    const content = (await readResourceBytes(absolute, resourceCache)).toString("utf8");
    const parsed = resource.endsWith(".json") ? JSON.parse(content) : content;
    resourcesByPath.set(resource, {
      source: relative(root, absolute),
      sha256: sha256(content),
      content: parsed
    });
  }
  for (const resource of [...(record.manifest.renderAssets ?? [])].sort()) {
    const absolute = path.resolve(record.directory, resource);
    const content = await readResourceBytes(absolute, resourceCache);
    resourcesByPath.set(resource, {
      source: relative(root, absolute),
      sha256: sha256(content)
    });
  }
  record.resourcesByPath = resourcesByPath;
  if (!record.stageProjected) {
    record.manifestResource = await readObjectResource(root, record.manifestPath, resourceCache);
  }
  return record;
};

export { assertPackageResources, hydratePackageResources, loadPackageController, loadPackages };
