import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { authorSegmentId, getEpisodePaths, getStageWorkPaths, listAuthorWorkPaths } from "../../packages/workspace-paths.mjs";
import { atomicWriteData, hashObject, readData } from "../../packages/program-utils.mjs";
import { assertProjectPaths, exists } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import {
  P3_BODY_REDESIGN_SCOPE,
  P3_BODY_REDESIGN_STATE,
  assertP3BodyRedesignPreservesVisualPlan,
  assertP3BodyRedesignRequest,
  assertP3DirectorRevisionRequest,
  authorUnitsForStoryboard,
  directorResultSlice
} from "./storyboard.mjs";
import { resolveStageCurrent } from "./status.mjs";
import { commitAcceptance } from "./acceptance-commit.mjs";
import { assertTaskContinuity } from "./tasks.mjs";
import { assertStageSettled } from "./stage-restart.mjs";

export const cancelDirectorRevision = async ({ workspaceRoot, episodeId }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const workPaths = getStageWorkPaths(paths, "p3");
  const requestPath = workPaths.returnRequest("director");
  const bodyPath = workPaths.returnRequest("author");
  const files = [paths.storyboard, workPaths.workOrder, workPaths.candidate, requestPath, bodyPath];
  await assertProjectPaths({ root: workspaceRoot, label: "撤销导演局部修订", files });
  const values = new Map(await Promise.all(files.map(async (file) => [file,
    await exists(file) ? await readData(file) : undefined])));
  const result = { kind: "revision-cancelled", subject: { kind: "episode", id: episodeId }, stageId: "p3" };
  const request = values.get(requestPath);
  if (request === undefined) return { ...result, cancelled: false, message: "当前没有待撤销的导演局部修订" };
  if (request?.revisionScope !== "director-revision") throw new Error("只能撤销用户发起的导演局部修订，不能取消上游正式退回");
  if (!values.get(paths.storyboard)) throw new Error("缺少已接纳故事板，保留现场");
  assertP3DirectorRevisionRequest(request, directorResultSlice(values.get(paths.storyboard)));
  const saved = values.get(workPaths.workOrder);
  let scratchPath = null;
  if (saved !== undefined) {
    if (!saved || typeof saved !== "object") throw new Error("当前工作单无效，无法确认待撤销任务归属");
    const { taskDigest, ...base } = saved;
    const ownsDirector = saved.nodeId === "director" && hashObject(saved.inputs?.returnRequest ?? null) === hashObject(request);
    const ownsAbandonedBody = saved.nodeId === "author" && taskDigest === request.replacesTaskDigest
      && hashObject(saved.inputs?.p3BodyRedesign ?? null) === request.replacesBodyRedesignSha256;
    if (hashObject(base) !== taskDigest || saved.stageId !== "p3" || saved.subject?.id !== episodeId
      || (!ownsDirector && !ownsAbandonedBody)) throw new Error("当前工作单不属于待撤销的导演修订，保留现场");
    scratchPath = path.join(workPaths.work, `attempt-${saved.executionId}`);
    if (!/^[a-f0-9]{64}$/u.test(saved.executionId ?? "")
      || saved.scratchPath !== path.relative(workspaceRoot, scratchPath).split(path.sep).join("/")) {
      throw new Error("待撤销的临时目录与工作单不一致");
    }
    await assertProjectPaths({ root: workspaceRoot, label: "撤销导演临时材料", files: [scratchPath] });
  } else if (values.get(workPaths.candidate) !== undefined) throw new Error("候选缺少所属工作单，保留现场");
  const cleanup = [workPaths.workOrder, workPaths.candidate, requestPath];
  if (values.get(bodyPath) !== undefined) {
    if (hashObject(values.get(bodyPath)) !== request.replacesBodyRedesignSha256) {
      throw new Error("另有未被放弃的正文请求，不能随导演修订清理");
    }
    cleanup.push(bodyPath);
  }
  const snapshot = async (file) => await exists(file) ? hashObject(await readData(file)) : null;
  const baselines = new Map([...values].map(([file, value]) => [file, value === undefined ? null : hashObject(value)]));
  return commitAcceptance({ workspaceRoot, workPaths, writes: new Map(), cleanup, scratchPath,
    result: { ...result, cancelled: true, message: "已撤销未接纳的导演修订，保留全部已接纳成果" },
    verify: async () => {
      for (const [file, before] of baselines) {
        if (before !== await snapshot(file)) throw new Error("撤销期间工作现场已变化，保留现场");
      }
    }
  });
};

// The persisted director request also identifies the explicitly abandoned body task.
// Ordinary next completes this transition after interruption; accepted results are never removed here.
export const prepareDirectorRevision = async ({ root, workspaceRoot, episodeId, model,
  reviseDirector, replaceBodyRedesign, selectedBeatIds, revisionReason }) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const work = getStageWorkPaths(paths, "p3");
  const requestPath = work.returnRequest("director");
  const bodyPath = work.returnRequest("author");
  await assertProjectPaths({ root: workspaceRoot, label: "P3导演修订请求", files: [requestPath] });
  const existing = await exists(requestPath) ? await readData(requestPath) : null;
  if (!reviseDirector && existing?.revisionScope !== "director-revision") return;
  const returnPaths = model.orderedNodes.map(({ id }) => work.returnRequest(id));
  await assertProjectPaths({ root: workspaceRoot, label: "P3导演局部修订路径",
    files: [paths.storyboard, work.work, work.workOrder, work.candidate, ...returnPaths] });
  const storyboard = await readData(paths.storyboard);
  if (!storyboard?.understanding || !storyboard.albumPlan || !storyboard.beats?.length) {
    throw new Error("没有已接纳的导演计划；请用普通 next --stage p3 创作");
  }
  const visualPlan = directorResultSlice(storyboard);
  let request = existing;
  if (request) {
    if (request.revisionScope !== "director-revision") {
      throw new Error("已有上游退回的导演任务，请先用普通 next --stage p3 完成该任务");
    }
    assertP3DirectorRevisionRequest(request, visualPlan);
    if (reviseDirector && (hashObject([...selectedBeatIds].sort()) !== hashObject([...request.selectedBeatIds].sort())
      || revisionReason.trim() !== request.reason)) {
      throw new Error("已有导演修订范围；请用普通 next --stage p3 续跑，不能覆盖进行中的意见");
    }
  } else {
    for (const file of returnPaths.filter((file) => file !== bodyPath && file !== requestPath)) {
      if (await exists(file)) throw new Error("P3仍有其它返工请求，不能发起导演局部修订");
    }
    const known = new Set(visualPlan.beats.map(({ id }) => id));
    if (selectedBeatIds.some((id) => !known.has(id))) throw new Error("导演修订选择了不存在的 Beat");
    const body = await exists(bodyPath) ? assertP3BodyRedesignRequest(await readData(bodyPath)) : null;
    const saved = await exists(work.workOrder) ? await readData(work.workOrder) : null;
    if (body && !replaceBodyRedesign) throw new Error("已有正文重作；明确放弃未接纳任务后须使用 --replace-body-redesign");
    if (replaceBodyRedesign && !body) throw new Error("没有可替代的正文重作请求");
    if (!body && (saved || await exists(work.candidate))) throw new Error("P3仍有未收口工作单或候选，不能发起导演修订");
    for (const segmentWork of await listAuthorWorkPaths(paths)) {
      if (!await exists(segmentWork.workOrder) && !await exists(segmentWork.candidate)) continue;
      if (!body || !replaceBodyRedesign || !await exists(segmentWork.workOrder))
        throw new Error("P3仍有未收口分段工作，先完成或明确放弃对应正文重作");
      const signed = await readData(segmentWork.workOrder), revision = signed.inputs?.p3BodyRedesign;
      const { taskDigest, ...base } = signed;
      if (hashObject(base) !== taskDigest || !revision || revision.reason !== body.reason
        || revision.baselineVisualPlanSha256 !== body.baselineVisualPlanSha256)
        throw new Error("分段工作不属于所要替代的正文重作，保留现场");
      await assertStageSettled(workspaceRoot, segmentWork.work);
    }
    if (body) {
      assertP3BodyRedesignPreservesVisualPlan({ baselineSha256: body.baselineVisualPlanSha256,
        candidateSha256: hashObject(visualPlan) });
      if (saved) {
        const { taskDigest, ...base } = saved;
        if (hashObject(base) !== taskDigest || saved.stageId !== "p3" || saved.nodeId !== "author"
          || hashObject(saved.inputs?.p3BodyRedesign ?? null) !== hashObject(body)) {
          throw new Error("当前工作单不是所要替代的正文重作，保留现场");
        }
      } else if (await exists(work.candidate)) throw new Error("正文候选缺少所属工作单，保留现场");
    }
    const selected = visualPlan.beats.filter(({ id }) => selectedBeatIds.includes(id));
    request = {
      target: "director", reason: revisionReason.trim(), revisionScope: "director-revision",
      selectedBeatIds: selected.map(({ id }) => id),
      cueRefs: selected.flatMap(({ cueRange: [first, last] }) =>
        Array.from({ length: last - first + 1 }, (_, index) => first + index)),
      baselineVisualPlanSha256: hashObject(visualPlan),
      ...(body ? { replacesBodyRedesignSha256: hashObject(body) } : {}),
      ...(saved ? { replacesTaskDigest: saved.taskDigest } : {})
    };
    assertP3DirectorRevisionRequest(request, visualPlan);
    await mkdir(work.work, { recursive: true });
    await atomicWriteData(requestPath, request);
    try {
      const current = await resolveStageCurrent({ root, workspaceRoot, episodeId, stageId: "p3", model });
      if (current.kind !== "task" || current.workOrder?.nodeId !== "director") {
        throw new Error("局部修订没有形成唯一 Director 工作单");
      }
      await validateSchema(path.join(root, "contracts/work-order.schema.json"), current.workOrder, "work-order");
    } catch (error) {
      await rm(requestPath, { force: true });
      throw error;
    }
  }
  if (await exists(bodyPath)) {
    if (hashObject(await readData(bodyPath)) !== request.replacesBodyRedesignSha256) {
      throw new Error("待替代的正文请求已变化，保留现场");
    }
    // Preserve each explicitly abandoned draft before removing its active identity.
    for (const segmentWork of await listAuthorWorkPaths(paths)) {
      if (!await exists(segmentWork.workOrder)) continue;
      const signed = await readData(segmentWork.workOrder);
      await assertStageSettled(workspaceRoot, segmentWork.work);
      const candidate = await exists(segmentWork.candidate) ? await readData(segmentWork.candidate) : null;
      await atomicWriteData(path.join(segmentWork.work, "held-work", `${signed.taskDigest}.json`),
        { workOrder: signed, candidate });
      await rm(segmentWork.candidate, { force: true });
      await rm(segmentWork.workOrder, { force: true });
    }
    await rm(bodyPath);
  }
};
const prepareBodyRedesign = async ({
  root,
  workspaceRoot,
  episodeId,
  programId,
  targetId,
  stageId,
  redesignBody,
  redesignBeatIds,
  revisionReason = null,
  model,
  current
}) => {
  if (redesignBody) {
    const paths = getEpisodePaths(workspaceRoot, episodeId);
    const workPaths = getStageWorkPaths(paths, "p3");
    const requestPath = workPaths.returnRequest("author");
    if (await exists(workPaths.returnRequest("director"))) {
      throw new Error("P3仍有导演修订请求；请先沿普通 next --stage p3 完成导演修订");
    }
    let createdP3RevisionRequest = false;
    const makeP3RevisionRequest = (storyboard) => {
      const units = authorUnitsForStoryboard(storyboard);
      const knownBeatIds = new Set(units.flatMap((unit) => unit.beatIds));
      const unknownBeatIds = redesignBeatIds.filter((id) => !knownBeatIds.has(id));
      if (unknownBeatIds.length) throw new Error(`P3正文不存在 Beat: ${unknownBeatIds.join(", ")}`);
      const selectedUnits = redesignBeatIds.length
        ? units.filter((unit) => unit.beatIds.some((id) => redesignBeatIds.includes(id)))
        : units;
      return {
        target: "author",
        reason: revisionReason?.trim() || (redesignBeatIds.length
          ? `用户要求局部修订 Beat ${redesignBeatIds.join(", ")}；以 ${selectedUnits.map(unit => unit.id).join(", ")} 为上下文，只修改指定内容及实际依赖`
          : "用户明确要求在保持视觉导演计划不变的前提下重做现行P3正文画面与运镜"),
        cueRefs: [],
        revisionScope: P3_BODY_REDESIGN_SCOPE,
        redesignState: P3_BODY_REDESIGN_STATE,
        baselineVisualPlanSha256: hashObject(directorResultSlice(storyboard)),
        selectedBeatIds: [...redesignBeatIds],
        pendingAuthorUnitIds: selectedUnits.map((unit) => unit.id)
      };
    };
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P3正文重作路径",
      files: [
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        requestPath,
        paths.storyboard
      ]
    });
    if (await exists(requestPath)) {
      if (redesignBeatIds.length) {
        throw new Error(
          "P3正文已有返工范围；请使用普通 next --stage p3 续跑，不能在进行中重新指定 --beat"
        );
      }
      const request = assertP3BodyRedesignRequest(await readData(requestPath));
      if (revisionReason !== null && revisionReason.trim() !== request.reason) {
        throw new Error("P3正文已有返工意见；请使用普通 next --stage p3 续跑，不能改写进行中的意见");
      }
      const storyboard = await readData(paths.storyboard);
      assertP3BodyRedesignPreservesVisualPlan({
        baselineSha256: request.baselineVisualPlanSha256,
        candidateSha256: hashObject(directorResultSlice(storyboard))
      });
    } else {
      const storyboard = await readData(paths.storyboard);
      const request = makeP3RevisionRequest(storyboard);
      const units = authorUnitsForStoryboard(storyboard);
      const segmentIds = [...new Set(units.filter(unit => request.pendingAuthorUnitIds.includes(unit.id))
        .map(authorSegmentId).filter(Boolean))];
      const affectedWork = [workPaths, ...segmentIds.map(id => getStageWorkPaths(paths, "p3", id))];
      for (const work of affectedWork) {
        if (await exists(work.workOrder)) {
          const saved = await readData(work.workOrder);
          const active = work.segmentId ? await resolveStageCurrent({ root, workspaceRoot, episodeId, stageId, model,
            segmentId: work.segmentId }) : current;
          const { taskDigest, ...base } = saved;
          if (!redesignBeatIds.length || hashObject(base) !== taskDigest
            || saved.stageId !== "p3" || saved.subject?.id !== episodeId
            || saved.moduleId !== "author-beat" || saved.runner !== "ai"
            || !saved.inputs?.authorUnit || saved.inputs.p3BodyRedesign
            || saved.inputs.authorPhase === "quotes" || active.kind !== "task"
            || active.runner !== "ai") {
            throw new Error("只有指定范围的正文重作可以停放同集普通正文工作单，保留现场");
          }
          assertTaskContinuity(saved, active.workOrder);
          if (await exists(work.candidate)
            && (await readData(work.candidate)).taskDigest !== taskDigest) {
            throw new Error("当前候选不属于待停放工作单，保留现场");
          }
          await assertStageSettled(workspaceRoot, work.segmentId ? work.work : paths.p3);
        } else if (await exists(work.candidate)) {
          throw new Error("P3候选缺少所属工作单，保留现场");
        }
      }
      assertP3BodyRedesignRequest(request);
      await mkdir(workPaths.work, { recursive: true });
      await atomicWriteData(requestPath, request);
      createdP3RevisionRequest = true;
    }
    try {
      current = await resolveStageCurrent({
        root,
        workspaceRoot,
        episodeId,
        programId,
        targetId,
        stageId,
        model
      });
      if (current.kind !== "task" || current.runner !== "ai") {
        throw new Error("P3正文重作没有形成唯一人工智能工作单");
      }
      if (createdP3RevisionRequest && current.workOrder?.nodeId !== "author") {
        throw new Error("P3正文重作没有从正文 Author 开始");
      }
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        current.workOrder,
        "work-order"
      );
    } catch (error) {
      if (createdP3RevisionRequest) await rm(requestPath, { force: true });
      throw error;
    }
  }
  return { current };
};

export { prepareBodyRedesign };
