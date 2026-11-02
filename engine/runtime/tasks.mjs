import { readFile } from "node:fs/promises";

import path from "node:path";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { hashObject, sha256, stableStringify } from "../../packages/program-utils.mjs";
import {
  assemblyImplementations,
  assemblyResources,
  projectAssemblyForProducer
} from ".././assembly.mjs";
import { readObjectResource, readTextResource, readResourceBytes, relative } from "./files.mjs";
import { controllerSpecFor, implementationIds } from "./implementations.mjs";
import { sourcesExtend } from "../../packages/p3-sources.mjs";
import { restartToken } from "./stage-restart.mjs";
const workflowIdentityForNode = ({ model, node }) => {
  const registeredNode = model.workflowModel.nodeById.get(node.id);
  if (!registeredNode) throw new Error(`Workflow 节点未登记: ${node.id}`);
  const workflowRecord = model.workflowModel.workflowById.get(registeredNode.workflowId);
  const formalNode = workflowRecord.nodeById.get(node.id);
  if (stableStringify(formalNode) !== stableStringify(node)) {
    throw new Error(`Workflow 节点在任务生成期间发生变化: ${node.id}`);
  }
  const stageId = workflowRecord.stageByNodeId.get(node.id);
  if (!stageId) throw new Error(`Workflow 节点没有 Production Stage: ${node.id}`);
  const content = { id: workflowRecord.id, node };
  return {
    workflowId: workflowRecord.id,
    subjectKind: workflowRecord.subjectKind,
    stageId,
    workflow: {
      source: `${workflowRecord.source}#node:${node.id}`,
      sha256: hashObject(content),
      content
    }
  };
};

const aiTask = async ({
  root,
  model,
  workspaceRoot = root,
  episodeId,
  subjectId = episodeId,
  subjectPaths = null,
  segmentId = null,
  node,
  record,
  assembly,
  inputs,
  inputHashes,
  producerInputHashes = inputHashes,
  producerInputHashesForResult = null,
  featureInputHashes = {},
  featureInputHashesForResult = {},
  outputPath,
  allowedWrite,
  taskId,
  producerTaskId = taskId,
  mode,
  context,
  outputRecord = record,
  outputSchemaPath = null,
  validatorPath = null,
  ruleFiles = null,
  templateRecord = null,
  object = null,
  assemblyRuleRole = "authorRules"
}) => {
  const paths = subjectPaths ?? getEpisodePaths(workspaceRoot, episodeId);
  const identity = workflowIdentityForNode({ model, node });
  const restart = identity.stageId === model.stageId ? model.stageRestart : null;
  const restartInputs = restart ? [restartToken(restart)] : [];
  if (restart) {
    inputs = { ...inputs, stageRestartId: restart.id };
    context = { ...context, stageRestartId: restart.id };
  }
  const workPaths = getStageWorkPaths(paths, identity.stageId, segmentId, identity.stageId === "p4" ? node.id : null);
  const subject = { kind: identity.subjectKind, id: subjectId };
  const { workflow } = identity;
  const moduleManifest = {
    source: assembly.module.manifest.source,
    sha256: assembly.module.manifest.sha256,
    content: assembly.module.manifest.content
  };
  const moduleRuleFiles =
    ruleFiles ?? (record.manifest.rules ?? []).map((rule) => path.resolve(record.directory, rule));
  const moduleRules = await Promise.all(
    moduleRuleFiles.map((file) => readTextResource(root, file, model.resourceCache))
  );
  const moduleRuntimeResources = (record.manifest.runtimeResources ?? [])
    .map((resource) => record.resourcesByPath.get(resource))
    .map(({ source, sha256: digest }) => ({ source, sha256: digest }));
  const isPackageRootAuthorRule = (resource) =>
    ["template", "feature"].includes(resource.kind) &&
    resource.source ===
      path.posix.join("packages", `${resource.kind}s`, resource.packageId, "AUTHOR.md");
  const assemblyRules = assemblyResources(assembly, { role: assemblyRuleRole })
    .filter((resource) => typeof resource.content === "string")
    .filter((resource) => mode !== "author-quotes" || resource.source.endsWith("/callout/AUTHOR.md"))
    .filter(
      (resource) => !["treatment", "segment", "video-plan", "video-assets"].includes(mode) || isPackageRootAuthorRule(resource)
    )
    .map(({ source, sha256: digest, content }) => ({ source, sha256: digest, content }));
  const resolvedRules = [...moduleRules, ...assemblyRules]
    .filter(
      (resource, index, resources) =>
        resources.findIndex((item) => item.source === resource.source) === index
    )
    .sort((left, right) => left.source.localeCompare(right.source));
  const resolvedOutputSchemaPath =
    outputSchemaPath ?? path.resolve(outputRecord.directory, outputRecord.manifest.outputSchema);
  const resolvedValidatorPath =
    validatorPath ?? path.resolve(record.directory, record.manifest.validator);
  const outputContract = await readObjectResource(
    root,
    resolvedOutputSchemaPath,
    model.resourceCache
  );
  const validator = {
    source: relative(root, resolvedValidatorPath),
    sha256: sha256(await readResourceBytes(resolvedValidatorPath, model.resourceCache))
  };
  const uniqueInputHashes = [...new Set([...inputHashes, ...restartInputs])];
  const stableProducerInputs = [...new Set([...producerInputHashes, ...restartInputs])];
  const producerInputsForResult = (result) => [
    ...new Set(
      [...(producerInputHashesForResult ? producerInputHashesForResult(result) : stableProducerInputs), ...restartInputs]
    )
  ];
  const directionController =
    mode === "visual-plan" ? record.resourcesByPath.get(record.manifest.controllerEntry) : null;
  const directionResponsibility = directionController
    ? {
        moduleManifest: moduleManifest.sha256,
        controller: { source: directionController.source, sha256: directionController.sha256 },
        validator
      }
    : null;
  const producerDigestForInputs = (inputs) =>
    hashObject({
      subject,
      nodeId: node.id,
      moduleId: record.manifest.id,
      taskId: producerTaskId,
      workflow: workflow.sha256,
      inputs,
      moduleRules: moduleRules.map((rule) => rule.sha256),
      moduleRuntimeResources,
      assembly: projectAssemblyForProducer(assembly),
      contract: outputContract.sha256,
      ...(directionResponsibility ? { responsibility: directionResponsibility } : {})
    });
  const producerDigestForResult = (result) =>
    producerDigestForInputs(producerInputsForResult(result));
  const primaryProducerDigest = producerInputHashesForResult ? null : producerDigestForResult(null);
  const featureImplementations = assemblyImplementations(assembly, { kind: "feature" });
  const featureProducerInputHashes = Object.fromEntries(
    implementationIds(assembly, "feature").map((featureId) => [
      featureId,
      [...new Set([...(featureInputHashes[featureId] ?? stableProducerInputs), ...restartInputs])]
    ])
  );
  const featureProducerInputsForResult = (featureId, result) => [
    ...new Set(
      [...(featureInputHashesForResult[featureId]
        ? featureInputHashesForResult[featureId](result)
        : featureProducerInputHashes[featureId]), ...restartInputs]
    )
  ];
  const featureProducerResources = Object.fromEntries(
    implementationIds(assembly, "feature").map((featureId) => {
      const implementations = featureImplementations.filter(
        (implementation) => implementation.packageId === featureId
      );
      const resources = implementations
        .flatMap((implementation) => implementation.resources)
        .map(({ role, source, sha256: digest }) => ({ role, source, sha256: digest }))
        .filter(
          (resource, index, all) =>
            all.findIndex(
              (item) =>
                item.role === resource.role &&
                item.source === resource.source &&
                item.sha256 === resource.sha256
            ) === index
        )
        .sort(
          (left, right) =>
            left.role.localeCompare(right.role) || left.source.localeCompare(right.source)
        );
      return [featureId, { implementations, resources }];
    })
  );
  const featureProducerDigestForResult = (featureId, result) => {
    const { implementations, resources } = featureProducerResources[featureId];
    return hashObject({
      subject,
      nodeId: node.id,
      moduleId: record.manifest.id,
      taskId,
      workflow: workflow.sha256,
      inputs: featureProducerInputsForResult(featureId, result),
      moduleRules: moduleRules.map((rule) => rule.sha256),
      interfaces: implementations.map(({ slotId, majorVersion }) => ({ slotId, majorVersion })),
      resources
    });
  };
  const featureProducerDigests = Object.fromEntries(
    implementationIds(assembly, "feature").map((featureId) => [
      featureId,
      featureInputHashesForResult[featureId]
        ? null
        : featureProducerDigestForResult(featureId, null)
    ])
  );
  const createWorkOrder = (allowedReturnTargets = []) => {
    const executionId = hashObject({ taskId, allowedWrite, inputHashes: uniqueInputHashes, primaryProducerDigest, featureProducerDigests, assembly,
      ...(restart ? { stageRestartId: restart.id } : {}) });
    const scratchPath = [
      "ai-narration",
      "ai-subtitles",
      "understanding",
      "visual-plan",
      "treatment",
      "author-quotes",
      "video-plan",
      "video-assets",
      "segment"
    ].includes(mode)
      ? relative(workspaceRoot, path.join(workPaths.work, `attempt-${executionId}`))
      : null;
    const metadataOnlyAssemblyRoles = new Set([
      "acceptanceRules",
      "assetContractEntry",
      "assetContractRules",
      "authorRules",
      "authorContextEntry",
      "cuePolicy",
      "examples",
      "runtimeResources",
      "validator"
    ]);
    if (mode === "ai-narration") {
      metadataOnlyAssemblyRoles.add("copyRules");
      metadataOnlyAssemblyRoles.add("coverRules");
      metadataOnlyAssemblyRoles.add("finalExample");
    }
    const aiHiddenAssemblyRoles = mode === "visual-plan" ? new Set(["cuePolicy"]) : new Set();
    let workOrderAssembly = {
      ...assembly,
      slots: (assembly.slots ?? []).map((slot) => ({
        ...slot,
        optionalReadRoles: (slot.optionalReadRoles ?? []).filter(
          (role) => !aiHiddenAssemblyRoles.has(role)
        ),
        implementations: (slot.implementations ?? []).map((implementation) => ({
          ...implementation,
          resources: (implementation.resources ?? [])
            .filter((resource) => !aiHiddenAssemblyRoles.has(resource.role))
            .map((resource) => {
              if (!Object.hasOwn(resource, "content")) return resource;
              if (!metadataOnlyAssemblyRoles.has(resource.role))
                return resource;
              const metadata = { ...resource };
              delete metadata.content;
              return metadata;
            })
        }))
      }))
    };
    let workOrderModuleManifest = moduleManifest;
    if (mode === "visual-plan") {
      const content = {
        ...moduleManifest.content,
        slots: (moduleManifest.content.slots ?? []).map((slot) => ({
          ...slot,
          optionalReadRoles: (slot.optionalReadRoles ?? []).filter((role) => role !== "cuePolicy")
        }))
      };
      const projected = {
        source: `${moduleManifest.source}#ai-work-order`,
        sha256: hashObject(content),
        content
      };
      workOrderModuleManifest = projected;
      workOrderAssembly = {
        ...workOrderAssembly,
        module: {
          ...workOrderAssembly.module,
          manifest: { ...workOrderAssembly.module.manifest, ...projected }
        }
      };
    }
    const base = {
      executionId,
      taskId,
      subject,
      workflowId: identity.workflowId,
      stageId: identity.stageId,
      nodeId: node.id,
      moduleId: record.manifest.id,
      runner: "ai",
      workflowNode: node,
      workflow,
      moduleManifest: workOrderModuleManifest,
      inputArtifactHashes: uniqueInputHashes,
      inputs,
      resolvedRules,
      resolvedAssembly: workOrderAssembly,
      outputContract,
      validator,
      allowedWrite,
      allowedReturnTargets,
      candidatePath: relative(workspaceRoot, workPaths.candidate),
      ...(scratchPath ? { scratchPath } : {})
    };
    return { ...base, taskDigest: hashObject(base) };
  };
  return {
    kind: "task",
    runner: "ai",
    mode,
    createWorkOrder,
    subject,
    workflowId: identity.workflowId,
    stageId: identity.stageId,
    taskId,
    outputContract,
    resourceCache: model.resourceCache,
    root,
    workspaceRoot,
    paths,
    workPaths,
    inputHashes: stableProducerInputs,
    outputPath,
    record,
    outputRecord,
    outputSchemaPath: resolvedOutputSchemaPath,
    validatorPath: resolvedValidatorPath,
    templateRecord,
    node,
    context,
    object,
    resolvedAssembly: assembly,
    primaryProducerDigest,
    producerInputsForResult,
    producerDigestForInputs,
    producerDigestForResult,
    featureProducerInputHashes,
    featureProducerInputsForResult,
    featureProducerDigestForResult,
    featureProducerDigests
  };
};

const programTask = async ({
  root,
  model,
  workspaceRoot = root,
  episodeId,
  subjectId = episodeId,
  subjectPaths = null,
  invocation = null,
  taskId = null,
  node,
  record,
  assembly,
  inputs,
  inputHashes,
  producerInputHashes = inputHashes,
  outputPath,
  context = {},
  programPhase = null,
  programEntryPath = null,
  outputSchemaPath = null,
  ruleFiles = null,
  controllerSpec = null
}) => {
  const identity = workflowIdentityForNode({ model, node });
  const restart = identity.stageId === model.stageId ? model.stageRestart : null;
  const restartInputs = restart ? [restartToken(restart)] : [];
  if (restart) {
    inputs = { ...inputs, stageRestartId: restart.id };
    context = { ...context, stageRestartId: restart.id };
  }
  const subject = { kind: identity.subjectKind, id: subjectId };
  const { workflow } = identity;
  const manifest = {
    source: assembly.module.manifest.source,
    sha256: assembly.module.manifest.sha256,
    content: assembly.module.manifest.content
  };
  const entryPath =
    programEntryPath ?? path.resolve(record.directory, record.manifest.programEntry);
  const schemaPath =
    outputSchemaPath ?? path.resolve(record.directory, record.manifest.outputSchema);
  const uniqueInputHashes = [...new Set([...inputHashes, ...restartInputs])];
  const stableProducerInputs = [...new Set([...producerInputHashes, ...restartInputs])];
  const assemblyRuleResources = assemblyResources(assembly)
    .filter((resource) => ["assetContractRules", "renderRules"].includes(resource.role))
    .filter((resource) => typeof resource.content === "string")
    .map(({ source, sha256: digest, content }) => ({ source, sha256: digest, content }));
  const moduleRules = await Promise.all(
    (
      ruleFiles ?? (record.manifest.rules ?? []).map((rule) => path.resolve(record.directory, rule))
    ).map((file) => readTextResource(root, file, model.resourceCache))
  );
  const resolvedRules = [...moduleRules, ...assemblyRuleResources]
    .filter(
      (resource, index, resources) =>
        resources.findIndex((item) => item.source === resource.source) === index
    )
    .sort((left, right) => left.source.localeCompare(right.source));
  const base = {
    taskId: taskId ?? `${subjectId}/${node.id}`,
    subject,
    workflowId: identity.workflowId,
    stageId: identity.stageId,
    nodeId: node.id,
    moduleId: record.manifest.id,
    workflow,
    workflowNode: node,
    moduleManifest: manifest,
    inputArtifactHashes: uniqueInputHashes,
    inputs,
    resolvedAssembly: assembly,
    entry: { source: relative(root, entryPath), sha256: sha256(await readFile(entryPath)) },
    resolvedRules,
    outputContract: await readObjectResource(root, schemaPath),
    output: relative(workspaceRoot, outputPath)
  };
  return {
    kind: "task",
    runner: "program",
    taskId: base.taskId,
    node,
    record,
    outputPath,
    context,
    programPhase,
    entryPath,
    outputSchemaPath: schemaPath,
    controllerSpec,
    invocation: invocation ?? (episodeId ? { episodeId } : {}),
    subjectPaths: subjectPaths ?? (episodeId ? getEpisodePaths(workspaceRoot, episodeId) : null),
    workspaceRoot,
    taskDigest: hashObject(base),
    inputHashes: stableProducerInputs,
    base
  };
};

const programInvocationTask = (
  current,
  {
    authorizePaidTts = false
  } = {}
) => {
  const primitive = controllerSpecFor(current.record).primitive;
  if (authorizePaidTts && primitive !== "program-narration-synthesize") {
    throw new Error("--authorize-paid-tts 只能授权当前 P2 合成节点");
  }
  const implementations = assemblyImplementations(current.base.resolvedAssembly);
  const templates = [
    ...new Set(
      implementations.filter((item) => item.kind === "template").map((item) => item.packageId)
    )
  ].sort();
  const features = [
    ...new Set(
      implementations.filter((item) => item.kind === "feature").map((item) => item.packageId)
    )
  ].sort();
  const rules = current.base.resolvedRules.map(({ source, sha256: digest }) => ({
    source,
    sha256: digest
  }));
  const sharedRules = rules.filter(
    ({ source }) =>
      !templates.some((templateId) => source.startsWith(`packages/templates/${templateId}/`)) &&
      !features.some((featureId) => source.startsWith(`packages/features/${featureId}/`))
  );
  return {
    taskDigest: current.taskDigest,
    resolvedAssembly: current.base.resolvedAssembly,
    ruleDigest: hashObject({
      entry: current.base.entry.sha256,
      rules: sharedRules
    }),
    inputHashes: current.inputHashes,
    resolvedRules: rules,
    outputContract: {
      source: current.base.outputContract.source,
      sha256: current.base.outputContract.sha256
    },
    moduleId: current.record.manifest.id,
    nodeId: current.node.id,
    outputPath: current.outputPath,
    inputs: current.base.inputs,
    context:
      primitive === "program-narration-synthesize"
        ? { ...current.context, paidTtsAuthorized: authorizePaidTts === true }
        : current.context
  };
};

const continuityInputs = (workOrder) => {

  if (workOrder.stageId === "p3" && workOrder.moduleId === "direct-episode"
    && Array.isArray(workOrder.inputs?.templates)) {
    // Catalog prose is a live rule; package identities remain task inputs.
    return { ...workOrder.inputs, templates: workOrder.inputs.templates.map(({ id }) => ({ id })) };
  }
  if (workOrder.stageId === "p3" && workOrder.moduleId === "author-beat"
    && workOrder.inputs?.templateContext) {
    // Derived callout availability is no longer a business input or scheduling constraint.
    const templateContext = { ...workOrder.inputs.templateContext };
    delete templateContext.calloutAvailability;
    delete templateContext.episodeContext;
    if (workOrder.inputs.authorUnit?.templateId === "vox-explainer") {
      templateContext.renderContext = { ...templateContext.renderContext };
      // Caption appearance comes from the live renderer, not an authored business choice.
      delete templateContext.renderContext.subtitle;
      // A first focus treatment receives live defaults, not an authored style choice.
      if (!workOrder.inputs.currentTreatment) {
        delete templateContext.appearance;
        delete templateContext.renderContext.palette;
      }
    }
    // The task view refreshes visual references; actual adjacent inputs remain pinned below.
    delete templateContext.priorVisuals;
    delete templateContext.paragraph;
    const inputs = { ...workOrder.inputs, templateContext };
    // Selected Feature references refresh through the task view, like priorVisuals.
    // They are read-only context, not a new candidate identity or write scope.
    delete inputs.featureContexts;
    if (inputs.p3BodyRedesign) inputs.p3BodyRedesign = {
      ...inputs.p3BodyRedesign,
      pendingAuthorUnitIds: inputs.p3BodyRedesign.pendingAuthorUnitIds.filter(id => id === inputs.authorUnit.id),
      selectedBeatIds: inputs.p3BodyRedesign.selectedBeatIds.filter(id => inputs.authorUnit.beatIds.includes(id))
    };
    return inputs;
  }
  if (
    !["author-narration", "author-documentary-narration"].includes(workOrder.moduleId) ||
    !workOrder.inputs?.programPlan
  ) {
    return workOrder.inputs;
  }
  const programPlan = { ...workOrder.inputs.programPlan };
  delete programPlan.maxDurationSeconds;
  return { ...workOrder.inputs, programPlan };
};

const taskContinuity = (workOrder) => ({
  subject: workOrder.subject,
  workflowId: workOrder.workflowId,
  stageId: workOrder.stageId,
  taskId: workOrder.taskId,
  nodeId: workOrder.nodeId,
  moduleId: workOrder.moduleId,
  runner: workOrder.runner,
  candidatePath: workOrder.candidatePath,
  allowedReturnTargets: workOrder.allowedReturnTargets,
  allowedWrite: workOrder.allowedWrite,
  selections: workOrder.resolvedAssembly.slots.map(({ id, selection }) => ({ id, selection })),
  inputs: continuityInputs(workOrder)
});

export const isBodyHandoffReason = reason => /^前一单元 (?:B|TR)\d+ 的实际承接末态改变，修订 (?:B|TR)\d+ 的承接部分$/u.test(reason ?? "");

const assertTaskContinuity = (saved, currentWorkOrder) => {
  const savedContinuity = taskContinuity(saved);
  const currentContinuity = taskContinuity(currentWorkOrder);
  if (saved.stageId === "p3" && ["direct-episode", "author-beat"].includes(saved.moduleId)) {
    // New evidence does not replace the original task. Changed evidence still does.
    const preserveSources = (before, after) => {
      if (!before || !after || typeof before !== "object" || typeof after !== "object") return after;
      return Object.fromEntries(Object.entries(after).map(([key, value]) => [
        key, key === "sourceAssets" && sourcesExtend(before[key], value) ? before[key]
          : Array.isArray(value) ? value.map((item, index) => preserveSources(before[key]?.[index], item))
          : value && typeof value === "object" ? preserveSources(before[key], value) : value
      ]));
    };
    currentContinuity.inputs = preserveSources(savedContinuity.inputs, currentContinuity.inputs);
    const before = savedContinuity.inputs.p3BodyRedesign;
    const after = currentContinuity.inputs.p3BodyRedesign;
    // Automatic handoff notes do not replace the signed revision instructions.
    if (before && after && (isBodyHandoffReason(before.reason) || isBodyHandoffReason(after.reason))) {
      delete before.reason;
      delete after.reason;
    }
  }
  if (stableStringify(savedContinuity) !== stableStringify(currentContinuity)) {
    const changed = Object.keys(savedContinuity).filter(
      (field) =>
        stableStringify(savedContinuity[field]) !== stableStringify(currentContinuity[field])
    );
    throw new Error(
      `work-order.yaml 需要核对；原候选与锁已保留：当前生产对象、业务输入或任务身份已变化（${changed.join("、")}）`
    );
  }
};

export { aiTask, assertTaskContinuity, programInvocationTask, programTask };
