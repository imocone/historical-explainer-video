import { readdir } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { readData } from "../packages/program-utils.mjs";

const fail = (message) => { throw new Error(message); };
const relative = (root, absolute) => path.relative(root, absolute).split(path.sep).join("/");
const formatAjvErrors = (errors = []) => errors
  .map((error) => `${error.instancePath || "/"} ${error.message}`)
  .join("; ");

const validateWorkflow = (schema, workflow, source) => {
  const validate = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema);
  if (!validate(workflow)) fail(`${source} 合同失败: ${formatAjvErrors(validate.errors)}`);
};

export const compileWorkflowGraph = (workflow) => {
  const nodeById = new Map();
  for (const node of workflow.nodes) {
    if (nodeById.has(node.id)) fail(`Workflow ${workflow.id} 节点 id 重复: ${node.id}`);
    nodeById.set(node.id, node);
  }
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, []]));
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const predecessorByNodeId = new Map();
  const afterEachByParent = new Map();
  for (const node of workflow.nodes) {
    const hasAfter = node.after !== undefined;
    const hasAfterEach = node.afterEach !== undefined;
    if (hasAfter && hasAfterEach) fail(`Workflow ${workflow.id} 节点 ${node.id} 不得同时声明 after 与 afterEach`);
    if (hasAfter && Array.isArray(node.after) && node.after.length === 0) {
      fail(`Workflow ${workflow.id} 节点 ${node.id} 的 after 至少需要一个前序节点`);
    }
    const predecessors = hasAfter
      ? (Array.isArray(node.after) ? node.after : [node.after])
      : (hasAfterEach ? [node.afterEach] : []);
    if (new Set(predecessors).size !== predecessors.length) {
      fail(`Workflow ${workflow.id} 节点 ${node.id} 的 after 前序节点不得重复`);
    }
    for (const predecessor of predecessors) {
      if (!nodeById.has(predecessor)) fail(`Workflow ${workflow.id} 节点 ${node.id} 引用了未知前序节点: ${predecessor}`);
      if (predecessor === node.id) fail(`Workflow ${workflow.id} 节点 ${node.id} 不得依赖自身`);
      outgoing.get(predecessor).push(node.id);
      indegree.set(node.id, indegree.get(node.id) + 1);
    }
    if (predecessors.length > 0) predecessorByNodeId.set(node.id, predecessors);
    if (node.afterEach) {
      const parent = nodeById.get(node.afterEach);
      if (!parent.scope.startsWith("each-")) fail(`Workflow ${workflow.id} 节点 ${node.id} 的 afterEach 必须引用逐项节点`);
      if (node.scope !== parent.scope) fail(`Workflow ${workflow.id} 节点 ${node.id} 的 afterEach 跟随节点必须与父节点使用相同逐项 scope`);
      if (afterEachByParent.has(parent.id)) fail(`Workflow ${workflow.id} foreach 节点 ${parent.id} 只能有一个 afterEach 跟随节点`);
      afterEachByParent.set(parent.id, node);
    }
  }
  const orderedNodes = [];
  let ready = workflow.nodes.filter((node) => indegree.get(node.id) === 0);
  if (ready.length !== 1) {
    fail(`Workflow ${workflow.id} 必须有唯一根节点，当前为: ${ready.map((node) => node.id).join(", ") || "<none>"}`);
  }
  const terminals = workflow.nodes.filter((node) => outgoing.get(node.id).length === 0);
  if (terminals.length !== 1) {
    fail(`Workflow ${workflow.id} 必须有唯一终点节点，当前为: ${terminals.map((node) => node.id).join(", ") || "<none>"}`);
  }
  while (ready.length) {
    const nextReady = [];
    for (const node of ready) {
      orderedNodes.push(node);
      for (const nextId of outgoing.get(node.id)) {
        const nextDegree = indegree.get(nextId) - 1;
        indegree.set(nextId, nextDegree);
        if (nextDegree === 0) nextReady.push(nodeById.get(nextId));
      }
    }
    ready = nextReady;
  }
  if (orderedNodes.length !== workflow.nodes.length) {
    const blocked = workflow.nodes
      .filter((node) => !orderedNodes.some((item) => item.id === node.id))
      .map((node) => node.id);
    fail(`Workflow ${workflow.id} 存在环或不可达节点: ${blocked.join(", ")}`);
  }
  const rankByNodeId = new Map(orderedNodes.map((node, index) => [node.id, index]));
  const ancestorsByNodeId = new Map();
  for (const node of orderedNodes) {
    const ancestors = new Set();
    for (const predecessor of predecessorByNodeId.get(node.id) ?? []) {
      ancestors.add(predecessor);
      for (const ancestor of ancestorsByNodeId.get(predecessor) ?? []) ancestors.add(ancestor);
    }
    ancestorsByNodeId.set(node.id, ancestors);
  }
  return { nodeById, orderedNodes, rankByNodeId, ancestorsByNodeId, afterEachByParent };
};

const stagesForWorkflow = ({ workflow, source, graph }) => {
  const starts = Object.entries(workflow.stages).map(([id, startNodeId]) => {
    if (!graph.nodeById.has(startNodeId)) fail(`${source} 阶段 ${id} 引用了未知起点节点: ${startNodeId}`);
    return { id, startNodeId, rank: graph.rankByNodeId.get(startNodeId) };
  });
  const startNodeIds = starts.map((stage) => stage.startNodeId);
  if (new Set(startNodeIds).size !== startNodeIds.length) fail(`${source} 多个阶段不得共享同一起点节点`);
  if (starts[0].rank !== 0) fail(`${source} 第一个阶段必须从 Workflow 唯一根节点开始`);
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index].rank <= starts[index - 1].rank) {
      fail(`${source} 阶段起点必须按 Workflow 拓扑递增: ${starts[index - 1].id} → ${starts[index].id}`);
    }
  }
  const stageByNodeId = new Map();
  const stages = starts.map((stage, index) => {
    const endRank = starts[index + 1]?.rank ?? graph.orderedNodes.length;
    if (endRank <= stage.rank) fail(`${source} 阶段起点拓扑顺序非法: ${stage.id}`);
    const nodeIds = graph.orderedNodes.slice(stage.rank, endRank).map((node) => node.id);
    for (const nodeId of nodeIds) stageByNodeId.set(nodeId, stage.id);
    return { id: stage.id, startNodeId: stage.startNodeId, nodeIds };
  });
  for (const [parentId, follower] of graph.afterEachByParent) {
    if (stageByNodeId.get(parentId) !== stageByNodeId.get(follower.id)) {
      fail(`${source} afterEach 配对不得跨阶段: ${parentId} → ${follower.id}`);
    }
  }
  return { stages, stageByNodeId };
};

export const loadWorkflowModel = async ({ root, stageId = null }) => {
  const stageScoped = typeof stageId === "string" && stageId.length > 0;
  const workflowDirectory = path.join(root, "workflow");
  const entries = await readdir(workflowDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    if (stageScoped && (!entry.isFile() || !entry.name.endsWith(".yaml"))) continue;
    if (entry.isSymbolicLink()) fail(`workflow/ 禁止符号链接: ${entry.name}`);
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) fail(`workflow/ 包含非 Workflow 文件: ${entry.name}`);
    files.push(entry.name);
  }
  files.sort();
  if (files.length === 0) fail("workflow/ 中至少需要一个 .yaml Workflow 文件");
  const schema = await readData(path.join(root, "contracts", "workflow.schema.json"));
  const workflowById = new Map();
  const stageById = new Map();
  const nodeById = new Map();
  const workflows = [];
  const unreadable = [];
  for (const file of files) {
    const absolute = path.join(workflowDirectory, file);
    const source = relative(root, absolute);
    let document;
    try {
      document = await readData(absolute);
    } catch (error) {
      if (!stageScoped) throw error;
      unreadable.push(source);
      continue;
    }
    if (stageScoped && !(
      document?.stages
      && typeof document.stages === "object"
      && Object.hasOwn(document.stages, stageId)
    )) continue;
    validateWorkflow(schema, document, source);
    if (workflowById.has(document.id)) fail(`Workflow id 全局重复: ${document.id}`);
    const graph = compileWorkflowGraph(document);
    const { stages, stageByNodeId } = stagesForWorkflow({ workflow: document, source, graph });
    for (const stage of stages) {
      if (stageById.has(stage.id)) fail(`阶段 id 全局重复: ${stage.id}`);
      stageById.set(stage.id, { ...stage, workflowId: document.id, workflowSource: source });
    }
    for (const node of graph.orderedNodes) {
      if (nodeById.has(node.id)) fail(`Workflow 节点 id 全局重复: ${node.id}`);
      nodeById.set(node.id, { ...node, workflowId: document.id, workflowSource: source });
    }
    const workflow = { id: document.id, subjectKind: document.subjectKind, source, document, stages, stageByNodeId, ...graph };
    workflowById.set(workflow.id, workflow);
    workflows.push(workflow);
  }
  if (stageScoped && !stageById.has(stageId)) {
    const unreadableNote = unreadable.length
      ? `；另有不可解析的无关 Workflow，运行全局 check 查看: ${unreadable.join(", ")}`
      : "";
    fail(`未知阶段: ${stageId}${unreadableNote}`);
  }
  return { workflows, workflowById, stageById, nodeById };
};

export const workflowForStage = (model, stageId) => {
  const stage = model.stageById.get(stageId);
  if (!stage) fail(`未知阶段: ${stageId}`);
  return model.workflowById.get(stage.workflowId);
};

export const stageRangeFor = (model, stageId) => {
  const stage = model.stageById.get(stageId);
  if (!stage) fail(`未知阶段: ${stageId}`);
  return stage;
};

export const classifyStageProgress = ({
  model,
  stageId,
  currentNodeId = null,
  workflowComplete = false
}) => {
  const workflow = workflowForStage(model, stageId);
  const stage = stageRangeFor(model, stageId);
  if (workflowComplete) {
    return { kind: workflow.stages.at(-1).id === stageId ? "complete" : "stage-complete" };
  }
  const currentRank = workflow.rankByNodeId.get(currentNodeId);
  if (currentRank === undefined) {
    fail(`节点 ${currentNodeId ?? "<missing>"} 不属于阶段 ${stageId} 所在 Workflow`);
  }
  const startRank = workflow.rankByNodeId.get(stage.startNodeId);
  const endRank = startRank + stage.nodeIds.length - 1;
  if (currentRank < startRank) {
    return {
      kind: "blocked-upstream",
      upstreamStageId: workflow.stageByNodeId.get(currentNodeId),
      nodeId: currentNodeId
    };
  }
  if (currentRank > endRank) return { kind: "stage-complete" };
  return { kind: "in-stage" };
};
