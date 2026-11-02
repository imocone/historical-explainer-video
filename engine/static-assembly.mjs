import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readData } from "../packages/program-utils.mjs";

const GENERATED = [
  {
    resource: "runtime/template-renderers.mjs",
    exportName: "templateRendererLoaders",
    kind: "template",
    field: "renderer"
  },
  {
    resource: "runtime/template-render-plans.mjs",
    exportName: "templateRenderPlanLoaders",
    kind: "template",
    field: "renderPlanEntry"
  },
  {
    resource: "runtime/feature-render-entries.mjs",
    exportName: "featureRenderEntryLoaders",
    kind: "feature",
    field: "renderEntry"
  }
];

const posixRelative = (from, to) => {
  const relative = path.relative(from, to).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const generatedOwnerFor = (packages) => {
  const resources = GENERATED.map(({ resource }) => resource).sort();
  const owners = [...packages.values()].filter((record) => (
    record.manifest.kind === "module"
    && resources.every((resource) => (record.manifest.generatedResources ?? []).includes(resource))
  ));
  if (owners.length !== 1) throw new Error(`静态装配生成资源必须恰有一个 Module owner，实际 ${owners.length}`);
  const [owner] = owners;
  const declared = [...(owner.manifest.generatedResources ?? [])].sort();
  if (JSON.stringify(declared) !== JSON.stringify(resources)) {
    throw new Error(`${owner.manifest.id} generatedResources 必须与静态装配输出集合完全一致`);
  }
  return owner;
};

const slotIdsFor = ({ owner, kind, field }) => {
  const slotIds = (owner.manifest.slots ?? [])
    .filter((slot) => slot.accepts === kind && slot.readRoles?.includes(field))
    .map((slot) => slot.id);
  if (!slotIds.length) throw new Error(`${owner.manifest.id} 缺少读取 ${field} 的 ${kind} 插槽`);
  return slotIds;
};

const implementsOwnerSlot = ({ record, owner, slotIds }) => (record.manifest.implements ?? [])
  .some((implementation) => (
    implementation.moduleId === owner.manifest.id && slotIds.includes(implementation.slotId)
  ));

const entries = ({ packages, owner, kind, field }) => {
  const slotIds = slotIdsFor({ owner, kind, field });
  return [...packages.values()]
    .filter((record) => (
      record.manifest.kind === kind
      && record.manifest[field]
      && implementsOwnerSlot({ record, owner, slotIds })
    ))
  .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
};

export const generateStaticAssembly = ({ root, packages }) => {
  const owner = generatedOwnerFor(packages);
  const mapFile = (exportName, values) => `export const ${exportName} = {\n${values.join(",\n")}\n};\n`;
  return new Map(GENERATED.map((spec) => {
    const target = path.resolve(owner.directory, spec.resource);
    const outputRoot = path.dirname(target);
    const records = entries({ packages, owner, kind: spec.kind, field: spec.field });
    const values = records.map((record) => {
      const imported = posixRelative(outputRoot, path.resolve(record.directory, record.manifest[spec.field]));
      const loader = `import("${imported}")`;
      return `  "${record.manifest.id}": () => ${loader}`;
    });
    return [target, mapFile(spec.exportName, values)];
  }));
};

export const assertStaticAssembly = async ({ root, packages }) => {
  const generated = generateStaticAssembly({ root, packages });
  for (const [target, expected] of generated) {
    const actual = await readFile(target, "utf8");
    if (actual !== expected) {
      throw new Error(`${path.relative(root, target)} 与正式包清单生成结果不一致`);
    }
  }
};

export const loadStaticAssemblyPackages = async (root) => {
  const packages = new Map();
  for (const kind of ["modules", "templates", "features", "covers"]) {
    const base = path.join(root, "packages", kind);
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(base, entry.name);
      const manifestPath = path.join(directory, "package.yaml");
      const manifest = await readData(manifestPath);
      packages.set(manifest.id, { directory, manifestPath, manifest });
    }
  }
  return packages;
};

export const writeStaticAssembly = async ({ root, packages }) => {
  const generated = generateStaticAssembly({ root, packages });
  for (const [target, content] of generated) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return [...generated.keys()].map((target) => path.relative(root, target));
};
