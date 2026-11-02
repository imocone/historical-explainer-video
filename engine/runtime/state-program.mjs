import path from "node:path";
import { loadVisualPackagePlanningCatalog } from "../../packages/visual-package.mjs";
import { DEFAULT_OPENER_TEMPLATE_ID } from "../../packages/opener-template-selection.mjs";

import { getEpisodePaths, getProgramPaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { hashObject, readData } from "../../packages/program-utils.mjs";
import { REVISION_REQUEST_ID, assertProjectPaths, exists, relative } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import { loadStageModel } from "./model.mjs";
import { loadPackages } from "./packages.mjs";
import { prepareNodeAssembly } from "./implementations.mjs";
import { businessContent } from "./storyboard.mjs";
import { aiTask } from "./tasks.mjs";
import { controllerInputs } from "./author-tasks.mjs";
const assertProgramRevisionRequest = (request, nodeId) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("P0修订控制记录必须是对象");
  }
  if (request.target !== nodeId) {
    throw new Error(`P0修订控制记录必须唯一指向 ${nodeId}`);
  }
  if (typeof request.reason !== "string" || !request.reason.trim()) {
    throw new Error("P0修订控制记录缺少 reason");
  }
  if (!Array.isArray(request.cueRefs) || request.cueRefs.length !== 0) {
    throw new Error("P0修订不得指定字幕范围");
  }
  if (!REVISION_REQUEST_ID.test(request.revisionRequestId ?? "")) {
    throw new Error("P0修订缺少合法请求身份");
  }
  if (!/^[a-f0-9]{64}$/u.test(request.baselineProgramSha256 ?? "")) {
    throw new Error("P0修订缺少合法的现行节目摘要");
  }
  const state = request.state ?? "pending";
  if (!new Set(["pending", "accepting"]).has(state)) {
    throw new Error("P0修订控制记录状态非法");
  }
  if (state === "accepting" && !/^[a-f0-9]{64}$/u.test(request.expectedProgramSha256 ?? "")) {
    throw new Error("P0修订接纳中状态缺少预期节目摘要");
  }
  if (state === "pending" && request.expectedProgramSha256 != null) {
    throw new Error("P0修订尚未接纳时不得预写结果摘要");
  }
  return request;
};

const planningVisualPackageCatalog = async (root) => {
  const catalog = await loadVisualPackagePlanningCatalog(root);
  return catalog.sort((left, right) => left.visualPackageId.localeCompare(right.visualPackageId));
};

const planningOpenerTemplateCatalog = async (root, resourceCache) => {
  const packages = await loadPackages(root, {
    includeKinds: new Set(["template"]),
    moduleIds: new Set(["author-bookend"]),
    stageScoped: true,
    resourceCache
  });
  return [...packages.values()]
    .filter(({ manifest }) => manifest.implements.some((item) =>
      item.moduleId === "author-bookend" && item.slotId === "opener-template"))
    .map(({ manifest }) => ({
      templateId: manifest.id,
      ...manifest.catalog,
      defaultSelected: manifest.id === DEFAULT_OPENER_TEMPLATE_ID
    }))
    .sort((left, right) => left.templateId.localeCompare(right.templateId));
};

const planningCoverPackageCatalog = async (root, resourceCache) => {
  const packages = await loadPackages(root, {
    includeKinds: new Set(["cover"]),
    moduleIds: new Set(["produce-covers"]),
    stageScoped: true,
    resourceCache
  });
  return [...packages.values()]
    .filter(({ manifest }) => manifest.implements.some((item) =>
      item.moduleId === "produce-covers" && item.slotId === "cover-design"))
    .map(({ manifest }) => ({
      coverPackageId: manifest.id,
      version: manifest.version,
      ...manifest.catalog
    }))
    .sort((left, right) => left.coverPackageId.localeCompare(right.coverPackageId));
};

const resolveAcceptedProgramPlanCurrent = async ({
  root,
  workspaceRoot = root,
  programId,
  model
}) => {
  const paths = getProgramPaths(workspaceRoot);
  const workPaths = getStageWorkPaths(paths, "p0");
  await assertProjectPaths({
    root: workspaceRoot,
    label: "Program Workflow 正式路径",
    files: Object.values(paths)
  });
  if (await exists(paths.programPlan)) {
    const pending = await Promise.all(model.orderedNodes.map(node => exists(workPaths.returnRequest(node.id))));
    if (!pending.some(Boolean)) return { accepted: true, programPlan: await readData(paths.programPlan), paths };
  }
  const request = await readData(paths.request);
  await validateSchema(
    path.join(root, "contracts", "program-request.schema.json"),
    request,
    relative(workspaceRoot, paths.request)
  );
  if (request.programId !== programId)
    throw new Error("program-request 的 programId 与当前节目不一致");
  const planningRequest = request;
  const visualPackageCatalog = await planningVisualPackageCatalog(root);
  const coverPackageCatalog = await planningCoverPackageCatalog(root, model.resourceCache);
  const openerTemplateCatalog = await planningOpenerTemplateCatalog(root, model.resourceCache);
  const preparedByNodeId = new Map();
  const prepareFor = async (node) => {
    if (!preparedByNodeId.has(node.id)) {
      preparedByNodeId.set(
        node.id,
        await prepareNodeAssembly({
          model,
          node,
          storyboard: {},
          selection: {}
        })
      );
    }
    return preparedByNodeId.get(node.id);
  };
  let programPlan = null;
  let planNodeCount = 0;
  for (const node of model.orderedNodes) {
    if (
      ["historical-explainer", "historical-documentary"].includes(node.condition) &&
      node.condition !== planningRequest.programForm
    )
      continue;
    const prepared = await prepareFor(node);
    const primitive = prepared.descriptor.primitive;
    if (primitive !== "ai-program-plan") continue;
    planNodeCount += 1;
    const revisionPath = workPaths.returnRequest(node.id);
    const programRevision = (await exists(revisionPath))
      ? assertProgramRevisionRequest(await readData(revisionPath), node.id)
      : null;
    const programRevisionHash = programRevision ? hashObject(programRevision) : null;
    const projected = controllerInputs({
      record: prepared.record,
      projections: {
        "program-request": {
          inputs: { programRequest: planningRequest },
          context: { programRequest: planningRequest, programId },
          inputHashes: [hashObject(planningRequest)]
        },
        "visual-package-catalog": {
          inputs: { visualPackageCatalog },
          context: { visualPackageCatalog },
          inputHashes: [hashObject(visualPackageCatalog)]
        },
        "cover-package-catalog": {
          inputs: { coverPackageCatalog },
          context: { coverPackageCatalog },
          inputHashes: [hashObject(coverPackageCatalog)]
        },
        "template-catalog": {
          inputs: { openerTemplateCatalog },
          context: { openerTemplateCatalog },
          inputHashes: [hashObject(openerTemplateCatalog)]
        }
      },
      ...(programRevision
        ? {
            controlInputs: {
              programRevision,
              currentProgramPath: relative(workspaceRoot, paths.programPlan)
            },
            controlContext: { programRevision },
            controlInputHashes: [programRevisionHash]
          }
        : {})
    });
    const task = await aiTask({
      root,
      model,
      workspaceRoot,
      subjectId: programId,
      subjectPaths: paths,
      node,
      record: prepared.record,
      assembly: prepared.assembly,
      ...projected,
      producerInputHashesForResult: (result) => [
        hashObject(planningRequest),
        hashObject(result.visualPackage),
        hashObject(result.coverPackage),
        hashObject(result.openerTemplate)
      ],
      outputPath: paths.programPlan,
      allowedWrite: relative(workspaceRoot, paths.programPlan),
      taskId: programRevision
        ? `${programId}/${node.id}/${programRevision.revisionRequestId}`
        : `${programId}/${node.id}`,
      producerTaskId: `${programId}/${node.id}`,
      mode: "program-plan",
      context: projected.context
    });
    const currentTask = programRevision
      ? {
          ...task,
          returnRequestPath: revisionPath,
          reason: "用户明确要求修订现行P0"
        }
      : task;
    if (!(await exists(paths.programPlan))) {
      return {
        accepted: false,
        current: { ...currentTask, reason: "尚无正式 program.yaml" }
      };
    }
    const artifact = await readData(paths.programPlan);
    if (programRevision) {
      const state = programRevision.state ?? "pending";
      const artifactSha256 = hashObject(businessContent(artifact));
      if (state === "pending") {
        if (artifactSha256 !== programRevision.baselineProgramSha256) {
          throw new Error("P0修订期间现行节目已经变化，不能沿用当前修订请求");
        }
        return {
          accepted: false,
          current: { ...currentTask, reason: "用户明确要求从现行版本继续修订P0" }
        };
      }
      if (artifactSha256 !== programRevision.expectedProgramSha256) {
        if (artifactSha256 !== programRevision.baselineProgramSha256) {
          throw new Error("P0修订接纳期间正式节目出现非预期变化");
        }
        return {
          accepted: false,
          current: { ...currentTask, reason: "P0修订候选尚未完成原子替换，恢复同一接纳任务" }
        };
      }
    }
    programPlan = artifact;
  }
  if (planNodeCount !== 1 || !programPlan) {
    throw new Error(
      `Program Workflow 必须有且只有一个 ai-program-plan 节点，当前为 ${planNodeCount} 个`
    );
  }
  return {
    accepted: true,
    programPlan,
    paths
  };
};

const resolveProgramCurrent = async ({ root, workspaceRoot = root, programId, model = null }) => {
  model ??= await loadStageModel(root, { stageId: "p0" });
  const accepted = await resolveAcceptedProgramPlanCurrent({
    root,
    workspaceRoot,
    programId,
    model
  });
  if (!accepted.accepted) return accepted.current;
  const { programPlan, paths } = accepted;
  for (const episode of programPlan.episodes ?? []) {
    if (!(await exists(getEpisodePaths(workspaceRoot, episode.episodeId).episodeBrief))) {
      throw new Error(`P0 缺少单集交付: ${episode.episodeId}/episode-brief.yaml`);
    }
  }
  return {
    kind: "complete",
    programId,
    message: "当前 Workflow 全部完成",
    output: relative(workspaceRoot, paths.programPlan)
  };
};

export { assertProgramRevisionRequest, resolveAcceptedProgramPlanCurrent, resolveProgramCurrent };
