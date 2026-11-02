import path from "node:path";
import { assemblyImplementations, assemblyResources, resolveAssembly } from ".././assembly.mjs";
import { importModule } from "./files.mjs";
const scopesByPrimitive = {
  "ai-program-plan": ["subject"],
  "ai-narration": ["subject"],
  "program-narration-synthesize": ["subject"],
  "ai-subtitles": ["subject"],
  "program-narration-finalize": ["subject"],
  "ai-understanding": ["subject"],
  "ai-visual-director": ["subject"],
  "ai-beat-treatment": ["each-author-unit"],
  "ai-segment": ["opener"],
  "ai-video-plan": ["subject"],
  "ai-video-assets": ["subject"],
  "program-render": ["subject"],
  "program-covers": ["subject"]
};

const assertWorkflowNodeContracts = ({ nodes, packages }) => {
  for (const node of nodes) {
    const record = packages.get(node.moduleId);
    if (!record || record.manifest.kind !== "module") {
      throw new Error(`Workflow 节点 ${node.id} 缺少 Module Package: ${node.moduleId}`);
    }
    const controller = controllerSpecFor(record);
    const controllerRunner = controller.primitive.startsWith("ai-") ? "ai" : "program";
    if (record.manifest.runner !== controllerRunner) {
      throw new Error(
        `${record.manifest.id} 的 runner=${record.manifest.runner} 与 controller primitive=${controller.primitive} 不兼容`
      );
    }
    if (!scopesByPrimitive[controller.primitive]?.includes(node.scope)) {
      throw new Error(
        `Workflow 节点 ${node.id} 的 scope=${node.scope} 与 controller primitive=${controller.primitive} 不兼容`
      );
    }
    const controllerWrites = new Set(controller.writes);
    for (const slot of record.manifest.slots ?? [])
      for (const target of slot.writeTargets ?? []) {
        if (!controllerWrites.has(target)) {
          throw new Error(
            `插槽 ${record.manifest.id}/${slot.id} writeTarget 未由 controller writes 声明: ${target}`
          );
        }
      }
  }
};

const assemblyForNode = ({ model, node, storyboard = {}, selection = {} }) =>
  resolveAssembly({
    packages: model.packages,
    visualPackages: model.visualPackages,
    workflowNode: node,
    storyboard,
    selection
  });

const controllerSpecFor = (record) => {
  const resource = record.resourcesByPath?.get(record.manifest.controllerEntry);
  if (
    !resource ||
    !resource.content ||
    typeof resource.content !== "object" ||
    Array.isArray(resource.content)
  ) {
    throw new Error(`${record.manifestPath} 缺少已校验的声明式 controllerEntry`);
  }
  return resource.content;
};

const controllerDescriptorForNode = ({ record, node }) => {
  const spec = controllerSpecFor(record);
  const returnTo = spec.returnTo
    .filter((policy) => !policy.whenScope || policy.whenScope === node.scope)
    .map(({ whenScope: _whenScope, ...policy }) => policy);
  return {
    primitive: spec.primitive,
    returnTo,
    ...(spec.segmentTypeFromScope ? { segmentType: node.scope } : {}),
    ...(spec.templateSlotFromScope ? { templateSlotId: `${node.scope}-template` } : {})
  };
};

const projectControllerResult = ({
  spec,
  result,
  featureResults = {},
  scope = {}
}) => {
  if (spec.projection === "artifact") return { kind: "artifact", artifact: result };
  if (spec.projection === "understanding")
    return { kind: "understanding", section: result.understanding };
  if (spec.projection === "visual-plan") return { kind: "visual-plan", visualPlan: result };
  if (spec.projection === "treatment") {
    if (scope.authorPhase === "quotes") return { kind: "author-quotes", quotes: result };
    return {
      kind: "treatment",
      authorUnitId: scope.authorUnitId,
      treatment: result,
      featureResults
    };
  }
  if (spec.projection === "segment")
    return { kind: "segment", segmentType: scope.segmentType, segment: result };
  throw new Error(`未知 controller projection: ${spec.projection}`);
};

const prepareNodeAssembly = async ({ model, node, storyboard = {}, selection = {} }) => {
  const record = model.packages.get(node.moduleId);
  const controller = controllerSpecFor(record);
  const descriptor = controllerDescriptorForNode({ record, node });
  if (!descriptor || typeof descriptor.primitive !== "string" || !descriptor.primitive) {
    throw new Error(`${record.manifestPath} 的 controllerEntry 缺少 primitive`);
  }
  const activeSlotIds = descriptor.templateSlotId
    ? [descriptor.templateSlotId]
    : selection.activeSlotIds;
  const assembly = assemblyForNode({
    model,
    node,
    storyboard,
    selection: { ...selection, ...(activeSlotIds ? { activeSlotIds } : {}) }
  });
  return { record, controller, descriptor, assembly };
};

const findBeat = (storyboard, beatId) => {
  const beat = storyboard.beats.find((item) => item.id === beatId);
  if (beat) return beat;
  throw new Error(`未知 Beat: ${beatId}`);
};

const catalogsFromAssembly = (assembly, kind) =>
  assemblyResources(assembly, { kind, role: "catalog" })
    .map(({ packageId, source, sha256: digest, content }) => ({
      source,
      sha256: digest,
      content: { id: packageId, ...content }
    }))
    .sort((left, right) => left.content.id.localeCompare(right.content.id));

const implementationIds = (assembly, kind) =>
  [
    ...new Set(
      assemblyImplementations(assembly, { kind }).map((implementation) => implementation.packageId)
    )
  ].sort();

const soleImplementationId = (assembly, kind, label) => {
  const ids = implementationIds(assembly, kind);
  if (ids.length !== 1) throw new Error(`${label} 必须恰好装配一个 ${kind}，实际 ${ids.length}`);
  return ids[0];
};

const implementationFor = (assembly, packageId, kind = null, role = null) => {
  const implementation = assembly.slots
    .flatMap((slot) => slot.implementations)
    .find(
      (item) =>
        item.packageId === packageId &&
        (!kind || item.kind === kind) &&
        (!role || item.resources.some((resource) => resource.role === role))
    );
  if (!implementation) throw new Error(`当前装配缺少 ${packageId}`);
  return implementation;
};

const implementationResource = (implementation, role) => {
  const resource = implementation.resources.find((item) => item.role === role);
  if (!resource) throw new Error(`${implementation.packageId} 缺少装配资源 ${role}`);
  return resource;
};

const featureAdapter = async ({ root, assembly, featureId }) => {
  const implementation = implementationFor(assembly, featureId, "feature", "validator");
  return importModule(
    path.resolve(root, implementationResource(implementation, "validator").source)
  );
};

const templatePolicyFromAssembly = async ({ root, assembly }) => {
  const policies = assemblyResources(assembly, { kind: "template", role: "cuePolicy" });
  if (policies.length === 0) return null;
  if (policies.length !== 1)
    throw new Error(`当前节点必须至多装配一个模板 cuePolicy，实际 ${policies.length}`);
  return importModule(path.resolve(root, policies[0].source));
};

export {
  assertWorkflowNodeContracts,
  catalogsFromAssembly,
  controllerDescriptorForNode,
  controllerSpecFor,
  featureAdapter,
  findBeat,
  implementationFor,
  implementationIds,
  implementationResource,
  prepareNodeAssembly,
  projectControllerResult,
  soleImplementationId,
  templatePolicyFromAssembly
};
