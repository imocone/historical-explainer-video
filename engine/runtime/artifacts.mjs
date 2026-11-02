import path from "node:path";
import { getEpisodePaths } from "../../packages/workspace-paths.mjs";
import { assertProjectPath, hashObject, readData, stableStringify } from "../../packages/program-utils.mjs";

import { assemblyResources } from ".././assembly.mjs";

import { validateSchema } from "./schema.mjs";
import { controllerSpecFor, projectControllerResult } from "./implementations.mjs";
import { assertCurrentProducerInputs, assertProducerSourceBindings, businessContent } from "./storyboard.mjs";
const producer = ({ task, result, featureId = null }) => ({
  moduleId: task.workOrder.moduleId,
  nodeId: task.workOrder.nodeId,
  taskDigest: featureId
    ? task.featureProducerDigestForResult(featureId, result)
    : task.producerDigestForResult(result),
  inputs: featureId
    ? task.featureProducerInputsForResult(featureId, result)
    : task.producerInputsForResult(result),
  rules: [
    ...new Set([
      ...task.workOrder.resolvedRules.map((rule) => rule.sha256),
      ...assemblyResources(task.workOrder.resolvedAssembly, { role: "examples" })
        .filter((resource) => resource.kind !== "template")
        .map((resource) => resource.sha256)
    ])
  ],
  contract: featureId
    ? assemblyResources(task.workOrder.resolvedAssembly, {
        kind: "feature",
        role: "outputSchema"
      }).find((resource) => resource.packageId === featureId)?.sha256
    : task.mode === "author-quotes"
      ? task.workOrder.outputContract.sha256
    : assemblyResources(task.workOrder.resolvedAssembly, { kind: "template", role: "outputSchema" })
          .length === 1
      ? assemblyResources(task.workOrder.resolvedAssembly, {
          kind: "template",
          role: "outputSchema"
        })[0].sha256
      : task.workOrder.outputContract.sha256,
  outputSha256: hashObject(result)
});

const pairedOpenerTaskDigest = ({ scriptProducer, openerProducer }) =>
  hashObject({
    kind: "p1-script-opener-pair-v1",
    scriptTaskDigest: scriptProducer.taskDigest,
    inputs: openerProducer.inputs,
    rules: openerProducer.rules,
    contract: openerProducer.contract,
    outputSha256: openerProducer.outputSha256
  });

const validateProgramArtifact = async (task, artifact) => {
  await validateSchema(
    task.outputSchemaPath ?? path.resolve(task.record.directory, task.record.manifest.outputSchema),
    artifact,
    task.outputPath
  );
  if (
    artifact._producer.moduleId !== task.record.manifest.id ||
    artifact._producer.nodeId !== task.node.id
  ) {
    throw new Error(`${task.outputPath} 的正式生产者身份不一致`);
  }
  const business = businessContent(artifact);
  if (artifact._producer.outputSha256 !== hashObject(business))
    throw new Error(`${task.outputPath} 的 outputSha256 不一致`);
  const sourceSelectionBasis = [business, task.context?.storyboard];
  assertProducerSourceBindings({
    producer: artifact._producer,
    business: sourceSelectionBasis,
    sourceAssets: task.context?.sourceAssets ?? [],
    label: task.outputPath
  });
  assertCurrentProducerInputs({
    producer: artifact._producer,
    expectedInputs: task.inputHashes,
    label: task.outputPath
  });
  const projection = projectControllerResult({
    spec: task.controllerSpec ?? controllerSpecFor(task.record),
    result: business,
    assembly: task.base?.resolvedAssembly ?? null
  });
  if (
    projection?.kind !== "artifact" ||
    stableStringify(projection.artifact) !== stableStringify(business)
  ) {
    throw new Error(`${task.record.manifest.id} controller.project 必须返回未改写的程序成果`);
  }
};

const readScriptPackage = async ({ workspaceRoot, episodeId }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  await assertProjectPath({ root: workspaceRoot, file: paths.scriptPackage, label: "P1正片路径" });
  return readData(paths.scriptPackage);
};

const readP1Delivery = async ({ workspaceRoot, episodeId }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  await assertProjectPath({ root: workspaceRoot, file: paths.openerNarration, label: "P1片头路径" });
  const [scriptPackage, openerNarration] = await Promise.all([
    readScriptPackage({ workspaceRoot, episodeId }),
    readData(paths.openerNarration)
  ]);
  return { scriptPackage, openerNarration };
};

export {
  pairedOpenerTaskDigest,
  producer,
  readP1Delivery,
  readScriptPackage,
  validateProgramArtifact
};
