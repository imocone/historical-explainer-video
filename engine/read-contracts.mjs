const READ_KINDS = new Set(["artifact", "external-input", "projection", "catalog"]);

const requireText = (value, label) => {
  if (typeof value !== "string" || !value) throw new Error(`${label} 必须是非空字符串`);
  return value;
};

const normalizedModules = (modules) => {
  if (!Array.isArray(modules)) throw new Error("模块读取合同必须提供 modules 数组");
  const ids = new Set();
  return modules.map((module) => {
    const id = requireText(module?.id, "模块 id");
    if (ids.has(id)) throw new Error(`模块读取合同包含重复模块 id: ${id}`);
    ids.add(id);
    if (!Array.isArray(module.reads)) throw new Error(`${id} 的 reads 必须是数组`);
    if (!Array.isArray(module.writes)) throw new Error(`${id} 的 writes 必须是数组`);
    return { id, reads: module.reads, writes: module.writes };
  });
};

const moduleWorkflowUsage = ({ modules, workflows }) => {
  if (!Array.isArray(workflows)) throw new Error("模块读取合同的 workflows 必须是数组");
  const moduleIds = new Set(modules.map((module) => module.id));
  const workflowIds = new Set();
  const usage = new Map(modules.map((module) => [module.id, new Set()]));
  const normalizedWorkflows = [];
  for (const workflow of workflows) {
    const workflowId = requireText(workflow?.id, "Workflow id");
    if (workflowIds.has(workflowId)) throw new Error(`模块读取合同包含重复 Workflow id: ${workflowId}`);
    workflowIds.add(workflowId);
    if (!Array.isArray(workflow.nodes)) throw new Error(`${workflowId} 的 nodes 必须是数组`);
    const nodes = [];
    for (const node of workflow.nodes) {
      const moduleId = requireText(node?.moduleId, `${workflowId} 节点 moduleId`);
      if (!moduleIds.has(moduleId)) throw new Error(`${workflowId} 引用了未知模块: ${moduleId}`);
      usage.get(moduleId).add(workflowId);
      nodes.push({ moduleId, condition: node.condition ?? "always" });
    }
    normalizedWorkflows.push({ id: workflowId, nodes });
  }
  return { usage, workflows: normalizedWorkflows };
};

const assertAcyclic = (edges) => {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  const visited = new Set();
  const visiting = new Set();
  const visit = (workflowId, trail = []) => {
    if (visiting.has(workflowId)) {
      const cycle = [...trail, workflowId];
      throw new Error(`内部 artifact 跨 Workflow 依赖成环: ${cycle.join(" → ")}`);
    }
    if (visited.has(workflowId)) return;
    visiting.add(workflowId);
    for (const edge of outgoing.get(workflowId) ?? []) visit(edge.to, [...trail, workflowId]);
    visiting.delete(workflowId);
    visited.add(workflowId);
  };
  for (const workflowId of outgoing.keys()) visit(workflowId);
};

// 这不是注册表：它只从当前 Module Package 的 reads/writes 与当前 Workflow
// 推导一次验证结果。调用方不能写回或长期保存该结果。
export const validateReadContracts = ({ modules, workflows = [] }) => {
  const normalized = normalizedModules(modules);
  const { usage, workflows: normalizedWorkflows } = moduleWorkflowUsage({
    modules: normalized,
    workflows
  });
  const roles = new Map();

  for (const module of normalized) {
    const readRoles = new Set();
    for (const read of module.reads) {
      const role = requireText(read?.role, `${module.id} 的 read role`);
      const kind = read?.kind;
      if (!READ_KINDS.has(kind)) throw new Error(`${module.id} 的 ${role} 使用未知读取分类: ${String(kind)}`);
      if (readRoles.has(role)) throw new Error(`${module.id} 重复声明读取角色: ${role}`);
      readRoles.add(role);
      const existing = roles.get(role);
      if (existing && existing.kind !== kind) {
        throw new Error(`读取角色 ${role} 分类冲突: ${existing.kind} != ${kind}`);
      }
      if (existing) existing.readers.add(module.id);
      else roles.set(role, { kind, readers: new Set([module.id]) });
    }
  }

  for (const [role, entry] of roles) {
    const producers = normalized.filter((module) => module.writes.includes(role)).map((module) => module.id);
    if (entry.kind !== "artifact") {
      if (producers.length) {
        throw new Error(`读取角色 ${role} 分类为 ${entry.kind}，不得由 Module writes 生产`);
      }
      continue;
    }
    if (producers.length > 1) {
      const producerUsages = producers.map((producer) => [...usage.get(producer)]);
      const workflowIds = new Set(producerUsages.flat());
      const onlyWorkflow = workflowIds.size === 1
        ? normalizedWorkflows.find((workflow) => workflow.id === [...workflowIds][0])
        : null;
      const conditions = producers.map((producer) => (
        onlyWorkflow?.nodes.find((node) => node.moduleId === producer)?.condition
      ));
      const mutuallyExclusive = onlyWorkflow
        && conditions.every((condition) => ["historical-explainer", "historical-documentary"].includes(condition))
        && new Set(conditions).size === conditions.length;
      if (!mutuallyExclusive) {
        throw new Error(`内部 artifact ${role} 有多个非互斥生产者: ${producers.join(", ")}`);
      }
    }
    if (producers.length === 0) {
      const readerWorkflows = normalizedWorkflows.filter((workflow) => (
        workflow.nodes.some((node) => entry.readers.has(node.moduleId))
      ));
      if (!readerWorkflows.length) {
        throw new Error(`外部 artifact ${role} 未由任何 Workflow 根模块接入`);
      }
      for (const workflow of readerWorkflows) {
        if (!entry.readers.has(workflow.nodes[0]?.moduleId)) {
          throw new Error(`外部 artifact ${role} 必须由 Workflow ${workflow.id} 根模块声明读取`);
        }
      }
    }
    if (producers.length >= 1) {
      for (const producer of producers) {
      const producerWorkflows = usage.get(producer);
      if (producerWorkflows.size > 1) {
        throw new Error(`内部 artifact ${role} 的生产模块 ${producer} 属于多个 Workflow: ${[...producerWorkflows].sort().join(", ")}`);
      }
      for (const workflow of normalizedWorkflows) {
        const producerRank = workflow.nodes.findIndex((node) => node.moduleId === producer);
        if (producerRank < 0) continue;
        const earlierReader = workflow.nodes.findIndex((node, index) => (
          index <= producerRank
          && entry.readers.has(node.moduleId)
          && !producers.includes(node.moduleId)
        ));
        if (earlierReader >= 0) {
          throw new Error(
            `内部 artifact ${role} 在 Workflow ${workflow.id} 中被消费者先于生产者读取`
          );
        }
      }
      }
      if (producers.length === 1) entry.producer = producers[0];
      else entry.producers = producers.sort();
    }
  }

  const edges = [];
  for (const [role, entry] of roles) {
    if (entry.kind !== "artifact" || (!entry.producer && !entry.producers)) continue;
    for (const producer of entry.producers ?? [entry.producer]) {
      for (const from of usage.get(producer)) {
        for (const reader of entry.readers) for (const to of usage.get(reader)) {
          if (from !== to) edges.push({ from, to, role });
        }
      }
    }
  }
  const uniqueEdges = [...new Map(edges
    .sort((left, right) => `${left.from}/${left.to}/${left.role}`.localeCompare(`${right.from}/${right.to}/${right.role}`))
    .map((edge) => [`${edge.from}/${edge.to}/${edge.role}`, edge]))
    .values()];
  assertAcyclic(uniqueEdges);

  return {
    roles: [...roles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([role, entry]) => ({
      role,
      kind: entry.kind,
      readers: [...entry.readers].sort(),
      ...(entry.producer ? { producer: entry.producer } : {}),
      ...(entry.producers ? { producers: entry.producers } : {})
    })),
    crossWorkflowEdges: uniqueEdges
  };
};
