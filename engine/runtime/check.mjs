import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadProgramVisualPackage } from "../../packages/visual-package.mjs";
import { getEpisodePaths, getProgramPaths } from "../../packages/workspace-paths.mjs";
import { readData, sha256 } from "../../packages/program-utils.mjs";
import {
  EPISODE_ID,
  PROGRAM_ID,
  assertProjectPaths,
  exists,
  relative
} from "./files.mjs";
import { compileSchema } from "./schema.mjs";
import { loadModel, selectWorkflowModel } from "./model.mjs";
import { resolverForWorkflow } from "./status.mjs";
const listEpisodeIds = async (root, requested) => {
  if (requested) return [requested];
  if (!(await exists(root))) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && EPISODE_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const assertWorkspaceRootLayout = async (root) => {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`节目工作区不得包含符号链接: ${entry.name}`);
    }
    if (entry.name === "request.yaml" || entry.name === "program.yaml") {
      if (!entry.isFile()) throw new Error(`节目工作区 ${entry.name} 必须是文件`);
      continue;
    }
    if (entry.name === "制作") {
      if (!entry.isDirectory()) throw new Error("节目工作区 制作 必须是 P0 工作目录");
      continue;
    }
    if (EPISODE_ID.test(entry.name)) {
      if (!entry.isDirectory()) throw new Error(`节目剧集 ${entry.name} 必须是目录`);
      continue;
    }
    throw new Error(`节目工作区包含未知项目: ${entry.name}`);
  }
};

const assertEpisodeRootLayout = async (episodeRoot) => {
  const entries = await readdir(episodeRoot, { withFileTypes: true });
  const names = new Set();
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    if (!["制作", "output"].includes(entry.name) || !entry.isDirectory()) {
      throw new Error(`剧集根目录只允许 制作 与 output: ${entry.name}`);
    }
    names.add(entry.name);
  }
  for (const required of ["制作", "output"]) {
    if (!names.has(required)) throw new Error(`剧集根目录缺少 ${required}`);
  }
};

const listProgramIds = async (root, requested) => {
  if (requested) return [requested];
  const request = path.join(root, "request.yaml");
  if (!(await exists(request))) return [];
  const value = await readData(request);
  return typeof value.programId === "string" ? [value.programId] : [];
};

async function checkProject({ root, workspaceRoot = null, episodeId, programId, explain } = {}) {
  const errors = [];
  const notes = [];
  let model = null;
  let visualPackages = new Map();
  let visualPackageCount = 0;
  try {
    const names = [
      "package.schema.json",
      "module-controller.schema.json",
      "workflow.schema.json",
      "work-order.schema.json",
      "candidate.schema.json",
      "program-request.schema.json",
      "episode-brief.schema.json",
      "source-assets.schema.json",
      "narration-package.schema.json",
      "opener-narration.schema.json",
      "visual-package.schema.json",
      "visual-render-tokens.schema.json",
      "visual-package-selection.schema.json"
    ];
    for (const name of names)
      compileSchema(await readData(path.join(root, "contracts", name)), name);
    model = await loadModel(root);
    visualPackages = model.visualPackages;
    visualPackageCount = visualPackages.size;
    const duplicateIds = [...visualPackages.keys()].filter((id) => model.packages.has(id));
    if (duplicateIds.length > 0) {
      throw new Error(`正式责任包 id 重复: ${duplicateIds.join(", ")}`);
    }
    for (const workflow of model.workflowModel.workflows) {
      notes.push(
        `Workflow ${workflow.id} [${workflow.stages.map((stage) => stage.id).join(" → ")}]: ${workflow.orderedNodes.map((node) => node.id).join(" → ")}`
      );
    }
    if (explain) {
      const normalized = String(explain).split(path.sep).join("/");
      const refs = model.workflowModel.workflows
        .flatMap((workflow) => workflow.document.nodes)
        .filter((node) => JSON.stringify(node).includes(normalized))
        .map((node) => `node:${node.id}`);
      for (const record of model.packages.values())
        if (
          JSON.stringify(record.manifest).includes(normalized) ||
          normalized.includes(record.manifest.id)
        )
          refs.push(`package:${record.manifest.id}`);
      for (const record of visualPackages.values())
        if (JSON.stringify(record.manifest).includes(normalized) || normalized.includes(record.id))
          refs.push(`package:${record.id}`);
      notes.push(`explain ${explain}: ${refs.length ? refs.join(", ") : "无正式引用"}`);
    }
  } catch (error) {
    errors.push(error.message);
  }

  if (workspaceRoot) {
    try {
      await assertWorkspaceRootLayout(workspaceRoot);
      const programPaths = getProgramPaths(workspaceRoot);
      await assertProjectPaths({
        root: workspaceRoot,
        label: "节目工作区正式路径",
        files: [programPaths.request, programPaths.programPlan]
      });
    } catch (error) {
      errors.push(`节目工作区: ${error.message}`);
    }
  }

  const programIds =
    !workspaceRoot || (episodeId && !programId)
      ? []
      : await listProgramIds(workspaceRoot, programId);
  for (const id of programIds) {
    if (!PROGRAM_ID.test(id)) {
      errors.push(`非法 programId: ${id}`);
      continue;
    }
    if (!model) break;
    try {
      const workflowRecord = model.workflowModel.workflowById.get("program");
      if (!workflowRecord) throw new Error("缺少 Program Workflow");
      await loadProgramVisualPackage(root, workspaceRoot, {
        catalog: visualPackages,
        roles: []
      });
      const current = await resolverForWorkflow(workflowRecord.id)({
        root,
        workspaceRoot,
        programId: id,
        model: selectWorkflowModel(model, workflowRecord, root)
      });
      if (
        current.kind === "task" &&
        /过期|变化|不一致|缺失|合同失败|仍未通过/u.test(current.reason ?? "")
      ) {
        errors.push(`${id}/program: ${current.reason}`);
      }
    } catch (error) {
      errors.push(`${id}/program: ${error.message}`);
    }
  }

  const ids =
    !workspaceRoot || (programId && !episodeId)
      ? []
      : await listEpisodeIds(workspaceRoot, episodeId);
  for (const id of ids) {
    if (!EPISODE_ID.test(id)) {
      errors.push(`非法 episode 目录名: ${id}`);
      continue;
    }
    if (!model) break;
    const paths = getEpisodePaths(workspaceRoot, id);
    try {
      await assertEpisodeRootLayout(paths.episode);
      for (const workflowRecord of model.workflowModel.workflows) {
        if (workflowRecord.subjectKind !== "episode") continue;
        const selectedModel = selectWorkflowModel(model, workflowRecord, root);
        try {
          const current = await resolverForWorkflow(workflowRecord.id)({
            root,
            workspaceRoot,
            episodeId: id,
            model: selectedModel
          });
          if (current.kind === "blocked")
            errors.push(`${id}/${workflowRecord.id}: ${current.reason}`);
          if (
            current.kind === "task" &&
            /过期|变化|不一致|缺失|合同失败|仍未通过/.test(current.reason ?? "")
          ) {
            errors.push(`${id}/${workflowRecord.id}: ${current.reason}`);
          }
        } catch (error) {
          if (error?.code === "workflow-input-invalid") {
            notes.push(`${id}/${workflowRecord.id}: blocked-upstream (${error.nodeId})`);
          } else {
            errors.push(`${id}/${workflowRecord.id}: ${error.message}`);
          }
        }
      }
      for (const prohibited of [
        "status.yaml",
        "status.json",
        "storyboard.html",
        "storyboard.xlsx",
        "P4-report.json"
      ]) {
        const locations = [path.join(paths.p3, prohibited), path.join(paths.episode, prohibited)];
        for (const file of locations)
          if (await exists(file))
            errors.push(`${id}: 禁止人工状态或投影文件 ${relative(workspaceRoot, file)}`);
      }
      if (await exists(paths.renderReceipt)) {
        const receipt = await readData(paths.renderReceipt);
        const file = path.join(workspaceRoot, receipt.output);
        if (!(await exists(file))) errors.push(`${id}: 最终成片缺失 ${receipt.output}`);
        else if (sha256(await readFile(file)) !== receipt.sha256)
          errors.push(`${id}: 最终成片哈希不一致`);
      }
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    notes,
    packageCount: model ? model.packages.size + visualPackageCount : 0,
    programCount: programIds.length,
    episodeCount: ids.length
  };
}

export { checkProject };
