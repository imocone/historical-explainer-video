import path from "node:path";
import {
  loadProgramVisualPackage,
  loadVisualPackageCatalog
} from "../../packages/visual-package.mjs";
import { hashObject, stableStringify } from "../../packages/program-utils.mjs";
import { validateAssemblyModel } from ".././assembly.mjs";
import { validateReadContracts } from ".././read-contracts.mjs";
import { assertStaticAssembly } from ".././static-assembly.mjs";
import { loadWorkflowModel, workflowForStage } from ".././workflows.mjs";
import { readObjectResource, relative } from "./files.mjs";
import { assertPackageResources, hydratePackageResources, loadPackageController, loadPackages } from "./packages.mjs";
import { assertWorkflowNodeContracts, controllerSpecFor } from "./implementations.mjs";
const selectWorkflowModel = (globalModel, workflowRecord, root) => ({
  ...globalModel,
  workflow: workflowRecord.document,
  workflowPath: path.join(root, workflowRecord.source),
  workflowRecord,
  nodeById: workflowRecord.nodeById,
  orderedNodes: workflowRecord.orderedNodes,
  rankByNodeId: workflowRecord.rankByNodeId,
  ancestorsByNodeId: workflowRecord.ancestorsByNodeId,
  afterEachByParent: workflowRecord.afterEachByParent
});

const loadModel = async (root) => {
  const workflowModel = await loadWorkflowModel({ root });
  const packages = await loadPackages(root);
  for (const record of packages.values()) {
    await assertPackageResources(root, record);
    await hydratePackageResources(root, record);
  }
  const visualPackages = await loadVisualPackageCatalog(root);
  const duplicateIds = [...visualPackages.keys()].filter((id) => packages.has(id));
  if (duplicateIds.length) throw new Error(`正式责任包 id 重复: ${duplicateIds.join(", ")}`);
  validateAssemblyModel({ packages, visualPackages });
  for (const record of [...packages.values()].filter(
    (candidate) =>
      ["template", "feature"].includes(candidate.manifest.kind) &&
      (candidate.manifest.authorRules ?? []).length > 0
  )) {
    if (!record.manifest.authorRules.includes("AUTHOR.md")) {
      throw new Error(`${record.manifest.id} 的 authorRules 必须登记包根入口 AUTHOR.md`);
    }
  }
  for (const featureRecord of [...packages.values()].filter(
    (record) => record.manifest.kind === "feature"
  )) {
    const featureId = featureRecord.manifest.id;
    const authorImplementations = (featureRecord.manifest.implements ?? []).filter(
      (implementation) => {
        const moduleRecord = packages.get(implementation.moduleId);
        const slot = (moduleRecord?.manifest.slots ?? []).find(
          (item) => item.id === implementation.slotId
        );
        return (
          moduleRecord?.manifest.runner === "ai" &&
          slot?.readRoles?.includes("authorRules") &&
          slot.writeTargets.some((target) =>
            controllerSpecFor(moduleRecord).writes.includes(target)
          )
        );
      }
    );
    const hasAuthorRules = (featureRecord.manifest.authorRules ?? []).length > 0;
    if (hasAuthorRules && !authorImplementations.length) {
      throw new Error(`${featureId} 声明了 authorRules，但没有装配到真实 AI 创作插槽`);
    }
    if (!hasAuthorRules && !Object.hasOwn(featureRecord.manifest.catalog ?? {}, "initialState")) {
      throw new Error(`${featureId} 没有人工智能作者时必须声明确定性 initialState`);
    }
  }
  const allWorkflowNodes = workflowModel.workflows.flatMap((item) => item.orderedNodes);
  assertWorkflowNodeContracts({ nodes: allWorkflowNodes, packages });
  const referencedModules = [...new Set(allWorkflowNodes.map((node) => node.moduleId))].sort();
  const registeredModules = [...packages.values()]
    .filter((record) => record.manifest.kind === "module")
    .map((record) => record.manifest.id)
    .sort();
  if (stableStringify(registeredModules) !== stableStringify(referencedModules))
    throw new Error("正式 Module Package 必须全部由 Workflow 直接调用");

  validateReadContracts({
    modules: registeredModules.map((id) => {
      const controller = controllerSpecFor(packages.get(id));
      return { id, reads: controller.reads, writes: controller.writes };
    }),
    workflows: workflowModel.workflows.map((item) => ({ id: item.id, nodes: item.orderedNodes }))
  });

  const workflowNodesByModule = new Map();
  for (const currentWorkflow of workflowModel.workflows) {
    for (const node of currentWorkflow.orderedNodes) {
      if (!workflowNodesByModule.has(node.moduleId)) workflowNodesByModule.set(node.moduleId, []);
      workflowNodesByModule.get(node.moduleId).push({ workflow: currentWorkflow, node });
    }
  }
  const finalFeatureSlots = [...packages.values()]
    .filter(
      (record) =>
        record.manifest.kind === "module" &&
        controllerSpecFor(record).primitive === "program-render"
    )
    .flatMap((moduleRecord) =>
      (moduleRecord.manifest.slots ?? [])
        .filter(
          (slot) =>
            slot.accepts === "feature" &&
            slot.cardinality === "many" &&
            slot.selectionSource === "episode-features" &&
            slot.readRoles?.includes("renderRules") &&
            slot.readRoles?.includes("renderEntry") &&
            slot.writeTargets?.includes("final-video")
        )
        .map((slot) => ({ moduleRecord, slot }))
    );
  if (finalFeatureSlots.length !== 1) {
    throw new Error(`系统必须恰有一个最终成片功能插槽，实际 ${finalFeatureSlots.length}`);
  }
  const [finalFeatureContract] = finalFeatureSlots;
  for (const featureRecord of [...packages.values()].filter(
    (record) => record.manifest.kind === "feature"
  )) {
    const authorImplementations = (featureRecord.manifest.implements ?? []).filter(
      (implementation) => {
        const moduleRecord = packages.get(implementation.moduleId);
        const slot = (moduleRecord?.manifest.slots ?? []).find(
          (item) => item.id === implementation.slotId
        );
        return (
          moduleRecord?.manifest.runner === "ai" &&
          slot?.readRoles?.includes("authorRules") &&
          slot.writeTargets.some((target) =>
            controllerSpecFor(moduleRecord).writes.includes(target)
          )
        );
      }
    );
    const authorOccurrences = authorImplementations.flatMap(
      (implementation) => workflowNodesByModule.get(implementation.moduleId) ?? []
    );
    const implementsFinalFeatureSlot = (featureRecord.manifest.implements ?? []).some(
      (implementation) =>
        implementation.moduleId === finalFeatureContract.moduleRecord.manifest.id &&
        implementation.slotId === finalFeatureContract.slot.id
    );
    const renderOccurrences =
      workflowNodesByModule.get(finalFeatureContract.moduleRecord.manifest.id) ?? [];
    const finalRenderFollowsAuthor = authorOccurrences.every(
      ({ workflow: authorWorkflow, node: authorNode }) =>
        renderOccurrences.some(
          ({ workflow: renderWorkflow, node: renderNode }) =>
            renderWorkflow.id === authorWorkflow.id &&
            renderWorkflow.rankByNodeId.get(renderNode.id) >
              authorWorkflow.rankByNodeId.get(authorNode.id)
        )
    );
    if (!implementsFinalFeatureSlot || !finalRenderFollowsAuthor) {
      throw new Error(`${featureRecord.manifest.id} 功能包缺少最终成片功能插槽`);
    }
  }

  const templateSlotContracts = [...packages.values()]
    .filter((record) => record.manifest.kind === "module")
    .flatMap((moduleRecord) =>
      (moduleRecord.manifest.slots ?? [])
        .filter((slot) => slot.accepts === "template")
        .map((slot) => ({
          key: `${moduleRecord.manifest.id}/${slot.id}`,
          moduleRecord,
          slot
        }))
    );
  const bodyCatalogSlots = templateSlotContracts.filter(
    ({ slot }) => slot.selectionSource === "catalog"
  );
  const beatLifecycleSlots = templateSlotContracts.filter(
    ({ slot }) => slot.selectionSource === "beat-template"
  );
  const segmentLifecycleSlots = templateSlotContracts.filter(
    ({ moduleRecord, slot }) =>
      slot.selectionSource === "segment-template" &&
      !(
        moduleRecord.manifest.runner === "ai" &&
        slot.readRoles.includes("authorRules") &&
        slot.writeTargets.some((target) => controllerSpecFor(moduleRecord).writes.includes(target))
      )
  );
  const segmentAuthorSlots = templateSlotContracts.filter(
    ({ moduleRecord, slot }) =>
      slot.id !== "video-template" &&
      ["fixed", "segment-template"].includes(slot.selectionSource) &&
      moduleRecord.manifest.runner === "ai" &&
      slot.readRoles.includes("authorRules") &&
      slot.writeTargets.some((target) => controllerSpecFor(moduleRecord).writes.includes(target))
  );
  if (
    !bodyCatalogSlots.length ||
    !beatLifecycleSlots.length ||
    !segmentLifecycleSlots.length ||
    !segmentAuthorSlots.length
  ) {
    throw new Error("模板生命周期插槽拓扑不完整");
  }
  const bodyKeys = new Set([...bodyCatalogSlots, ...beatLifecycleSlots].map(({ key }) => key));
  const videoLifecycleSlots = templateSlotContracts.filter(
    ({ slot }) => slot.id === "video-template" && slot.selectionSource === "fixed"
  );
  const videoKeys = new Set(videoLifecycleSlots.map(({ key }) => key));
  const segmentKeys = new Set(
    [...segmentLifecycleSlots, ...segmentAuthorSlots].map(({ key }) => key)
  );
  const knownTemplateKeys = new Set([
    ...bodyKeys,
    ...segmentKeys,
    ...videoKeys,
    ...templateSlotContracts
      .filter(({ slot }) => slot.writeTargets.length === 0)
      .map(({ key }) => key)
  ]);
  const missingKeys = (required, actual) =>
    required.filter(({ key }) => !actual.has(key)).map(({ key }) => key);
  for (const templateRecord of [...packages.values()].filter(
    (record) => record.manifest.kind === "template"
  )) {
    const templateId = templateRecord.manifest.id;
    const implemented = new Set(
      (templateRecord.manifest.implements ?? []).map(
        (implementation) => `${implementation.moduleId}/${implementation.slotId}`
      )
    );
    const fixedRenderKeys = new Set(templateSlotContracts
      .filter(({ moduleRecord, slot }) =>
        slot.selectionSource === "fixed" &&
        slot.fixedPackageIds.includes(templateId) &&
        slot.readRoles.includes("renderRules") &&
        slot.writeTargets.every((target) => controllerSpecFor(moduleRecord).writes.includes(target)))
      .map(({ key }) => key));
    const unknown = [...implemented].filter((key) =>
      !knownTemplateKeys.has(key) && !fixedRenderKeys.has(key));
    if (unknown.length)
      throw new Error(`${templateId} 模板实现了未分类生命周期插槽: ${unknown.join(", ")}`);
    const touchesBody = [...implemented].some((key) => bodyKeys.has(key));
    const touchesSegment = [...implemented].some((key) => segmentKeys.has(key));
    if ([...implemented].some((key) => videoKeys.has(key))) {
      const missing = missingKeys(videoLifecycleSlots, implemented);
      if (touchesBody || touchesSegment || missing.length || videoLifecycleSlots.some(({ slot }) => !slot.fixedPackageIds.includes(templateId)))
        throw new Error(`${templateId} 视频模板须独立贯通设计、首帧编译、视频生产与渲染插槽: ${missing.join(", ")}`);
      continue;
    }
    if (touchesBody && touchesSegment)
      throw new Error(`${templateId} 模板混合实现了正文与片段生命周期`);
    if (touchesBody) {
      const missing = missingKeys([...bodyCatalogSlots, ...beatLifecycleSlots], implemented);
      if (missing.length)
        throw new Error(`${templateId} 正文模板生命周期不完整，缺少插槽: ${missing.join(", ")}`);
      continue;
    }
    if (touchesSegment) {
      const missing = missingKeys(segmentLifecycleSlots, implemented);
      const implementedAuthors = segmentAuthorSlots.filter(({ key }) => implemented.has(key));
      const activeAuthors = implementedAuthors.filter(
        ({ slot }) =>
          slot.selectionSource === "segment-template" || slot.fixedPackageIds.includes(templateId)
      );
      if (missing.length || implementedAuthors.length !== 1 || activeAuthors.length !== 1) {
        const details = [
          ...(missing.length ? [`缺少插槽: ${missing.join(", ")}`] : []),
          ...(implementedAuthors.length !== 1
            ? [`必须且只能实现一个片段作者插槽，实际 ${implementedAuthors.length}`]
            : []),
          ...(implementedAuthors.length === 1 && activeAuthors.length !== 1
            ? ["片段作者插槽没有选择当前模板"]
            : [])
        ];
        throw new Error(`${templateId} 片段模板生命周期不完整，${details.join("；")}`);
      }
      continue;
    }
    throw new Error(`${templateId} 模板没有可归类的正文或片段生命周期`);
  }
  const bodyCatalogSlotKeys = new Set(bodyCatalogSlots.map(({ key }) => key));
  const registeredTemplates = [...packages.values()].filter(
    (record) => record.manifest.kind === "template"
  );
  const bodyTemplateIds = registeredTemplates
    .filter((record) =>
      (record.manifest.implements ?? []).some((implementation) =>
        bodyCatalogSlotKeys.has(`${implementation.moduleId}/${implementation.slotId}`)
      )
    )
    .map((record) => record.manifest.id)
    .sort();
  if (!bodyTemplateIds.length) throw new Error("正文模板目录插槽没有实现");
  for (const templateId of bodyTemplateIds) {
    const record = packages.get(templateId);
    if (!record.manifest.cuePolicy) throw new Error(`${templateId} 正文模板缺少 cuePolicy`);
    if (record.manifest.authorRules.includes(record.manifest.cuePolicy)) {
      throw new Error(`${templateId} 的确定性 cuePolicy 不得作为 authorRules 全文投递`);
    }
    if (!record.manifest.renderRules.includes(record.manifest.cuePolicy)) {
      throw new Error(`${templateId} 的 renderRules 必须包含 cuePolicy`);
    }
  }
  await assertStaticAssembly({ root, packages });
  const featureIds = [...packages.values()]
    .filter((record) => record.manifest.kind === "feature")
    .map((record) => record.manifest.id)
    .sort();
  return {
    workflowModel,
    packages,
    visualPackages,
    bodyTemplateIds,
    featureIds
  };
};

const stageWorkflowRecord = ({ workflowRecord, stage }) => {
  const stageNodeIds = new Set(stage.nodeIds);
  const orderedNodes = workflowRecord.orderedNodes.filter((node) => stageNodeIds.has(node.id));
  const nodeIds = new Set(orderedNodes.map((node) => node.id));
  return {
    ...workflowRecord,
    document: {
      ...workflowRecord.document,
      nodes: orderedNodes
    },
    nodeById: new Map(orderedNodes.map((node) => [node.id, node])),
    orderedNodes,
    rankByNodeId: new Map(orderedNodes.map((node, index) => [node.id, index])),
    ancestorsByNodeId: new Map(
      orderedNodes.map((node) => [
        node.id,
        new Set(
          [...(workflowRecord.ancestorsByNodeId.get(node.id) ?? [])].filter((ancestorId) =>
            nodeIds.has(ancestorId)
          )
        )
      ])
    ),
    afterEachByParent: new Map(
      [...workflowRecord.afterEachByParent].filter(
        ([parentId, follower]) => nodeIds.has(parentId) && nodeIds.has(follower.id)
      )
    )
  };
};

const projectImplementationsToModules = ({ root, record, moduleIds, packages = null }) => {
  if (record.manifest.kind === "module") return record;
  const implementations = (record.manifest.implements ?? []).filter((implementation) =>
    moduleIds.has(implementation.moduleId)
  );
  if (implementations.length === 0) return null;
  let manifest = { ...record.manifest, implements: implementations };
  if (packages && ["template", "feature", "cover"].includes(record.manifest.kind)) {
    const roles = new Set();
    for (const implementation of implementations) {
      const moduleRecord = packages.get(implementation.moduleId);
      const slot = (moduleRecord?.manifest?.slots ?? []).find(
        (item) => item.id === implementation.slotId
      );
      if (!slot) {
        throw new Error(
          `${record.manifest.id} 实现未知插槽 ${implementation.moduleId}/${implementation.slotId}`
        );
      }
      for (const role of [...(slot.readRoles ?? []), ...(slot.optionalReadRoles ?? [])]) {
        roles.add(role);
      }
    }
    manifest = {
      kind: record.manifest.kind,
      id: record.manifest.id,
      ...(record.manifest.version ? { version: record.manifest.version } : {}),
      ...(record.manifest.kind === "cover" && record.manifest.verticalCoverPackageId
        ? { verticalCoverPackageId: record.manifest.verticalCoverPackageId }
        : {}),
      implements: implementations,
      ...Object.fromEntries(
        [...roles]
          .filter((role) => Object.hasOwn(record.manifest, role))
          .map((role) => [role, record.manifest[role]])
      )
    };
  }
  return {
    ...record,
    manifest,
    ...(record.manifest.kind === "feature"
      ? { featureInitialState: structuredClone(record.manifest.catalog?.initialState ?? null) }
      : {}),
    stageProjected: record.manifest.kind !== "visual",
    manifestResource: {
      source: relative(root, record.manifestPath),
      sha256: hashObject(manifest),
      content: manifest
    }
  };
};

const loadStageModel = async (root, { stageId, resourceCache = new Map(), resourceScope = "stage" }) => {
  if (!["stage", "controllers"].includes(resourceScope)) {
    throw new Error(`无效阶段资源范围: ${stageId}/${resourceScope}`);
  }
  const workflowModel = await loadWorkflowModel({ root, stageId });
  const fullWorkflowRecord = workflowForStage(workflowModel, stageId);
  const stage = workflowModel.stageById.get(stageId);
  const workflowRecord = stageWorkflowRecord({
    workflowRecord: fullWorkflowRecord,
    stage
  });
  const moduleIds = new Set(workflowRecord.orderedNodes.map((node) => node.moduleId));
  const includeKinds =
    resourceScope === "controllers"
      ? new Set(["module"])
      : fullWorkflowRecord.id === "video"
      ? new Set(["module", "template", "feature", "cover"])
      : stageId === "p1"
        ? new Set(["module", "template", "cover"])
        : new Set(["module"]);
  const loaded = await loadPackages(root, {
    moduleIds,
    includeKinds,
    resourceCache,
    stageScoped: true
  });
  const packages = new Map();
  for (const record of loaded.values()) {
    const projected = projectImplementationsToModules({
      root,
      record,
      moduleIds,
      packages: loaded
    });
    if (!projected) continue;
    if (resourceScope === "stage") {
      await assertPackageResources(root, projected, resourceCache);
      await hydratePackageResources(root, projected, resourceCache);
    } else if (projected.manifest.kind === "module") {
      projected.resourcesByPath = new Map([[projected.manifest.controllerEntry,
        await loadPackageController(root, projected, resourceCache)]]);
      projected.manifestResource = await readObjectResource(root, projected.manifestPath, resourceCache);
    }
    packages.set(projected.manifest.id, projected);
  }
  assertWorkflowNodeContracts({ nodes: workflowRecord.orderedNodes, packages });
  const visualPackages = new Map();
  if (resourceScope === "stage") validateAssemblyModel({ packages, visualPackages });
  const bodyCatalogSlotKeys = new Set(
    [...packages.values()]
      .filter((record) => record.manifest.kind === "module")
      .flatMap((record) =>
        (record.manifest.slots ?? [])
          .filter(
            (slot) =>
              slot.accepts === "template" &&
              (slot.selectionSource === "catalog" || slot.id === "body-template")
          )
          .map((slot) => `${record.manifest.id}/${slot.id}`)
      )
  );
  const bodyTemplateIds = [...packages.values()]
    .filter((record) => record.manifest.kind === "template")
    .filter((record) =>
      (record.manifest.implements ?? []).some((implementation) =>
        bodyCatalogSlotKeys.has(`${implementation.moduleId}/${implementation.slotId}`)
      )
    )
    .map((record) => record.manifest.id)
    .sort();
  const featureIds = [...packages.values()]
    .filter((record) => record.manifest.kind === "feature")
    .map((record) => record.manifest.id)
    .sort();
  return selectWorkflowModel(
    {
      workflowModel,
      packages,
      visualPackages,
      bodyTemplateIds,
      featureIds,
      stageId,
      resourceScope,
      resourceCache
    },
    workflowRecord,
    root
  );
};

const selectedVisualLoadPlan = (model) => {
  const roles = new Set();
  for (const node of model.orderedNodes) {
    const record = model.packages.get(node.moduleId);
    for (const slot of record?.manifest?.slots ?? []) {
      if (slot.selectionSource !== "program-visual") continue;
      for (const role of slot.readRoles ?? []) roles.add(role);
      for (const role of slot.optionalReadRoles ?? []) roles.add(role);
    }
  }
  const profileKinds = roles.has("productionProfiles")
    ? model.stageId === "p1"
      ? ["cover-image"]
      : model.stageId === "p4" ? ["fullframe-image", "bookend-image"]
      : model.stageId === "p3" ? ["fullframe-image"] : null
    : null;
  return {
    roles: [...roles],
    profileKinds
  };
};

const loadSelectedVisualForModel = async ({ root, workspaceRoot, model, storyboard = {} }) => {
  const plan = selectedVisualLoadPlan(model);
  const visualPackage = await loadProgramVisualPackage(root, workspaceRoot, {
    ...(model.stageId ? {} : { catalog: model.visualPackages }),
    roles: plan.roles,
    profileKinds: plan.profileKinds
  });
  const moduleIds = new Set(
    [...model.packages.values()]
      .filter((record) => record.manifest.kind === "module")
      .map((record) => record.manifest.id)
  );
  const projected = projectImplementationsToModules({
    root,
    record: visualPackage,
    moduleIds
  });
  if (!projected) {
    throw new Error(`${visualPackage.id} 没有实现当前阶段的视觉插槽`);
  }
  model.visualPackages.set(projected.id, projected);
  return projected;
};

export { loadModel, loadSelectedVisualForModel, loadStageModel, selectWorkflowModel };
