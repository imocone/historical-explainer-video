import { randomUUID } from "node:crypto";
import path from "node:path";
import { getProgramPaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { atomicWriteData, hashObject, readData } from "../../packages/program-utils.mjs";
import { assertProgramRevisionRequest, resolveProgramCurrent } from "./state-program.mjs";
import { validateSchema } from "./schema.mjs";
import { assertProjectPaths, exists } from "./files.mjs";
import { controllerSpecFor } from "./implementations.mjs";
import { businessContent } from "./storyboard.mjs";
const prepareProgramRevision = async ({
  root,
  workspaceRoot,
  programId,
  stageId,
  reviseProgram,
  model
}) => {
  if (reviseProgram) {
    const paths = getProgramPaths(workspaceRoot);
    const workPaths = getStageWorkPaths(paths, "p0");
    const request = await readData(paths.request);
    const selectedNodes = model.orderedNodes.filter(
      (node) =>
        controllerSpecFor(model.packages.get(node.moduleId)).primitive === "ai-program-plan" &&
        (!node.condition || node.condition === request.programForm)
    );
    if (selectedNodes.length !== 1) {
      throw new Error(`P0修订必须唯一确定当前作者节点，实际为 ${selectedNodes.length} 个`);
    }
    const selectedNode = selectedNodes[0];
    const requestPath = workPaths.returnRequest(selectedNode.id);
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P0修订路径",
      files: [
        paths.request,
        paths.programPlan,
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        requestPath
      ]
    });
    if (await exists(requestPath)) {
      assertProgramRevisionRequest(await readData(requestPath), selectedNode.id);
    } else if (await exists(paths.programPlan)) {
      const baseline = await readData(paths.programPlan);
      if (baseline.programId !== programId || baseline.programForm !== request.programForm) {
        throw new Error("--revise-program需要同一节目与形式的正式P0");
      }
      await atomicWriteData(requestPath, {
        target: selectedNode.id,
        reason: "用户明确要求修订现行P0",
        cueRefs: [],
        revisionRequestId: randomUUID(),
        baselineProgramSha256: hashObject(businessContent(baseline)),
        state: "pending"
      });
    }
    // Explicit request changes adopt the existing draft, never an accepted baseline.
    if (await exists(workPaths.workOrder)) {
      const saved = await readData(workPaths.workOrder);
      const { taskDigest, ...base } = saved;
      if (hashObject(base) !== taskDigest) throw new Error("work-order.yaml 自身内容已被改写");
      if (saved.stageId !== "p0" || saved.nodeId !== selectedNode.id
        || saved.inputs?.programRequest?.programId !== programId
        || saved.inputs.programRequest.programForm !== request.programForm) {
        throw new Error("P0改要求只处理同一节目、同一形式的当前工作单");
      }
      const current = await resolveProgramCurrent({ root, workspaceRoot, programId, model });
      if (current.kind !== "task" || current.runner !== "ai") return {};
      const next = current.createWorkOrder(current.allowedReturnTargets);
      if (hashObject(saved.inputs.programRequest) === hashObject(next.inputs.programRequest)) return {};
      await validateSchema(path.join(root, "contracts", "work-order.schema.json"), next, "work-order");
      const backupPath = path.join(workPaths.work, `replaced-${taskDigest}.yaml`);
      await assertProjectPaths({ root: workspaceRoot, label: "P0换单恢复副本", files: [backupPath] });
      const candidate = await exists(workPaths.candidate) ? await readData(workPaths.candidate) : null;
      if (candidate && ![taskDigest, next.taskDigest].includes(candidate.taskDigest)) {
        throw new Error("P0候选不属于原工作单或本次新要求，保留现场");
      }
      if (!(await exists(backupPath))) {
        await atomicWriteData(backupPath, { workOrder: saved, candidate });
      }
      // Write the order last. Repeating --revise-program resumes an interrupted update.
      if (candidate) await atomicWriteData(workPaths.candidate, { ...candidate, taskDigest: next.taskDigest });
      await atomicWriteData(workPaths.workOrder, next);
    }
  }
  return {};
};

export { prepareProgramRevision };
