import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const allowancePrefix = "--allow-protected-resource=";
const protectionRemovalAllowancePrefix = "--allow-protection-removal=";
const requestedAllowances = new Set();
const requestedProtectionRemovalAllowances = new Set();
const argumentErrors = [];
const exactAllowance = (argument, prefix, label, { allowDirectory = false } = {}) => {
  const allowance = argument.slice(prefix.length);
  const separator = allowance.indexOf(":");
  const owner = separator > 0 ? allowance.slice(0, separator) : "";
  const source = separator > 0 ? allowance.slice(separator + 1) : "";
  const normalizedSource = allowDirectory && source.endsWith("/") ? source.slice(0, -1) : source;
  const segments = normalizedSource.split("/");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(owner)
    || !normalizedSource
    || normalizedSource.startsWith("/")
    || (!allowDirectory && source.endsWith("/"))
    || normalizedSource.includes("\\")
    || /[*?\[\]]/u.test(normalizedSource)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || path.posix.normalize(normalizedSource) !== normalizedSource) {
    argumentErrors.push(`${label}必须精确写成 owner:实际变更文件路径: ${argument}`);
    return null;
  }
  return `${owner}:${source}`;
};
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith(protectionRemovalAllowancePrefix)) {
    const allowance = exactAllowance(argument, protectionRemovalAllowancePrefix, "保护条目删除放行", { allowDirectory: true });
    if (allowance) requestedProtectionRemovalAllowances.add(allowance);
    continue;
  }
  if (!argument.startsWith(allowancePrefix)) {
    argumentErrors.push(`未知参数: ${argument}`);
    continue;
  }
  const allowance = exactAllowance(argument, allowancePrefix, "受保护资源放行");
  if (allowance) requestedAllowances.add(allowance);
}

const gitPaths = (args) => {
  const output = execFileSync("git", args, { cwd: root, encoding: "utf8" });
  return output.split("\0").filter(Boolean);
};

const changed = new Set([
  ...gitPaths(["diff", "--no-renames", "--name-only", "-z", "HEAD"]),
  ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"])
]);

const manifestFiles = [];
for (const kind of ["modules", "templates", "features"]) {
  const base = path.join(root, "packages", kind);
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(base, entry.name, "package.yaml");
    if (existsSync(manifest)) manifestFiles.push(manifest);
  }
}

const resourceFields = [
  "rules", "authorRules", "copyRules", "acceptanceRules",
  "assetContractRules", "renderRules", "renderAssets", "examples", "runtimeResources"
];

const records = manifestFiles.map((manifestPath) => {
  const directory = path.dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const resources = resourceFields.flatMap((role) => (
    (manifest[role] ?? []).map((source) => ({ role, source, absolute: path.resolve(directory, source) }))
  ));
  const entryFields = [
    "authorContextEntry", "controllerEntry", "cuePolicy", "outputSchema", "validator",
    "assetContractEntry", "renderEntry", "renderPlanEntry", "renderer", "programEntry"
  ];
  for (const role of entryFields) {
    if (typeof manifest[role] === "string") {
      resources.push({ role, source: manifest[role], absolute: path.resolve(directory, manifest[role]) });
    }
  }
  const touched = [...changed].some((source) => {
    const absolute = path.resolve(root, source);
    return absolute.startsWith(`${directory}${path.sep}`)
      || absolute === manifestPath
      || resources.some((resource) => resource.absolute === absolute);
  });
  return { directory, manifestPath, manifest, resources, touched };
});

const touched = records.filter((record) => (
  record.touched
  && (record.manifest.runner === "ai" || (record.manifest.authorRules ?? []).length > 0)
));

const errors = [...argumentErrors];
const usedAllowances = new Set();
const protectionRegistryPath = "development/ai-responsibility-protection.json";
const parseProtectionRegistry = (content, label, { requireExistingTargets = false } = {}) => {
  let registry;
  try {
    registry = JSON.parse(content);
  } catch (error) {
    errors.push(`${label}不是合法JSON: ${error.message}`);
    return [];
  }
  if (registry?.version !== 1 || !Array.isArray(registry.resources)) {
    errors.push(`${label}必须包含version: 1和resources数组`);
    return [];
  }
  const resources = [];
  for (const [index, resource] of registry.resources.entries()) {
    const owner = resource?.owner;
    const source = resource?.path;
    const directory = typeof source === "string" && source.endsWith("/");
    const matchSource = typeof source === "string"
      ? (directory ? source.slice(0, -1) : source)
      : "";
    const segments = matchSource.split("/");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(owner ?? "")
      || !matchSource
      || matchSource.startsWith("/")
      || matchSource.includes("\\")
      || /[*?\[\]]/u.test(matchSource)
      || segments.some((segment) => !segment || segment === "." || segment === "..")
      || path.posix.normalize(matchSource) !== matchSource) {
      errors.push(`${label}的resources[${index}]必须使用合法owner和仓库相对精确路径`);
      continue;
    }
    if (requireExistingTargets) {
      const absolute = path.join(root, matchSource);
      if (!existsSync(absolute)) {
        errors.push(`${label}的resources[${index}]目标不存在: ${source}`);
        continue;
      }
      const stats = statSync(absolute);
      if (directory !== stats.isDirectory() || (!directory && !stats.isFile())) {
        errors.push(`${label}的resources[${index}]文件／目录类型与路径末尾斜杠不一致: ${source}`);
        continue;
      }
    }
    resources.push({ owner, source: matchSource, directory });
  }
  return resources;
};
const currentProtectionContent = existsSync(path.join(root, protectionRegistryPath))
  ? readFileSync(path.join(root, protectionRegistryPath), "utf8")
  : null;
const previousProtectionContent = (() => {
  try {
    return execFileSync("git", ["show", `HEAD:${protectionRegistryPath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
})();
if (currentProtectionContent === null) errors.push(`当前工作树缺少受保护路径唯一机器真源: ${protectionRegistryPath}`);
const previousProtectedResources = previousProtectionContent === null
  ? []
  : parseProtectionRegistry(previousProtectionContent, `HEAD:${protectionRegistryPath}`);
const currentProtectedResources = currentProtectionContent === null
  ? []
  : parseProtectionRegistry(currentProtectionContent, protectionRegistryPath, { requireExistingTargets: true });
if (!currentProtectedResources.some((resource) => (
  resource.owner === "system-control"
  && !resource.directory
  && resource.source === protectionRegistryPath
))) {
  errors.push(`${protectionRegistryPath}必须把自身登记为system-control受保护文件`);
}
const registryResourceKey = (resource) => `${resource.owner}:${resource.source}${resource.directory ? "/" : ""}`;
const currentProtectionKeys = new Set(currentProtectedResources.map(registryResourceKey));
const usedProtectionRemovalAllowances = new Set();
for (const resource of previousProtectedResources) {
  const key = registryResourceKey(resource);
  if (currentProtectionKeys.has(key)) continue;
  if (requestedProtectionRemovalAllowances.has(key)) {
    usedProtectionRemovalAllowances.add(key);
  } else {
    errors.push(`删除既有保护条目必须先取得本次具体用户授权，再精确重跑 --allow-protection-removal=${key}`);
  }
}
for (const allowance of requestedProtectionRemovalAllowances) {
  if (!usedProtectionRemovalAllowances.has(allowance)) {
    errors.push(`保护条目删除放行未命中当前删除，拒绝宽泛或遗留授权: ${allowance}`);
  }
}
const protectedResources = [
  ...previousProtectedResources,
  ...currentProtectedResources
].filter((resource, index, all) => all.findIndex((candidate) => (
  candidate.owner === resource.owner
  && candidate.source === resource.source
  && candidate.directory === resource.directory
)) === index);

for (const source of changed) {
  const owners = [...new Set(protectedResources
    .filter((resource) => source === resource.source
      || (resource.directory && source.startsWith(`${resource.source}/`)))
    .map((resource) => resource.owner))];
  if (!owners.length) continue;
  const matchingAllowance = owners
    .map((owner) => `${owner}:${source}`)
    .find((allowance) => requestedAllowances.has(allowance));
  if (matchingAllowance) {
    usedAllowances.add(matchingAllowance);
  } else {
    errors.push(
      `受保护文件发生差异，必须先取得本次具体用户授权，再逐文件重跑 ${owners.map((owner) => `--allow-protected-resource=${owner}:${source}`).join(" 或 ")}`
    );
  }
}
for (const allowance of requestedAllowances) {
  if (!usedAllowances.has(allowance)) {
    errors.push(`受保护资源放行未命中当前差异，拒绝宽泛或遗留授权: ${allowance}`);
  }
}
const entryCommand = /\bnode\s+((?:packages|development)\/[A-Za-z0-9._/-]+\.mjs)\b/gu;

const frontmatter = (content) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) return null;
  const fields = {};
  const lines = match[1].split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(lines[index]);
    if (!field) continue;
    let value = field[2].trim();
    if (/^[>|][+-]?$/u.test(value)) {
      const block = [];
      while (index + 1 < lines.length && /^(?:\s+|$)/u.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].trim());
      }
      value = block.join(" ").trim();
    }
    fields[field[1]] = value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, "$1$2").trim();
  }
  return fields;
};

for (const record of touched) {
  const { manifest, directory, resources } = record;
  const label = `${manifest.kind}/${manifest.id}`;
  const authorRules = manifest.authorRules ?? [];
  const acceptanceRules = new Set(manifest.acceptanceRules ?? []);

  if (manifest.runner !== "ai" && !authorRules.some((rule) => path.basename(rule) === "AUTHOR.md")) {
    errors.push(`${label}: ${manifest.kind}的authorRules没有登记真实入口 AUTHOR.md`);
  }

  for (const rule of authorRules) {
    if (acceptanceRules.has(rule)) errors.push(`${label}: authorRules 不得展开登记为 acceptanceRules 的确定性资源: ${rule}`);
  }
  const entryPath = manifest.runner === "ai"
    ? path.join(directory, "SKILL.md")
    : path.resolve(directory, authorRules.find((rule) => path.basename(rule) === "AUTHOR.md") ?? "AUTHOR.md");
  if (!existsSync(entryPath)) {
    errors.push(`${label}: 缺少真实人工智能入口 ${relative(entryPath)}`);
    continue;
  }
  const entry = readFileSync(entryPath, "utf8");
  if (manifest.runner === "ai") {
    const identity = frontmatter(entry);
    if (!identity) {
      errors.push(`${label}: SKILL.md 缺少发现身份 frontmatter`);
    } else {
      if (identity.name !== manifest.id) {
        errors.push(`${label}: SKILL.md frontmatter name 必须等于包 id: ${manifest.id}`);
      }
      if (!identity.description) {
        errors.push(`${label}: SKILL.md frontmatter description 不能为空`);
      }
    }
  }
  for (const match of entry.matchAll(entryCommand)) {
    const commandPath = path.resolve(root, match[1]);
    if (!existsSync(commandPath)) {
      errors.push(`${label}: 人工智能入口引用的命令不存在: ${match[1]}`);
    } else if (!resources.some((resource) => resource.absolute === commandPath)) {
      errors.push(`${label}: 人工智能入口引用的命令未在本包清单登记: ${match[1]}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${touched.map(({ manifest }) => manifest.id).sort().join("\n")}\n`);
}
