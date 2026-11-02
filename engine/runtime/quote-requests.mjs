import { P3_QUOTE_REVISION_SCOPE, assertP3QuoteRevisionRequest } from "./quote-revision-contract.mjs";
import { collectQuoteRequests } from "../../packages/templates/fullframe-narrative/callout/batch.mjs";
import { businessContent } from "./storyboard.mjs";
import { mkdir, rm } from "node:fs/promises";
import { getEpisodePaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { atomicWriteData, hashObject, readData } from "../../packages/program-utils.mjs";
import { assertProjectPaths, exists } from "./files.mjs";
import { resolveStageCurrent } from "./status.mjs";

export const prepareQuoteRevision = async ({
  root,
  workspaceRoot,
  episodeId,
  model,
  reviseQuotes,
  selectedBeatIds,
  revisionReason
}) => {
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const work = getStageWorkPaths(paths, "p3");
  const requestPath = work.returnRequest("author");
  await assertProjectPaths({
    root: workspaceRoot,
    label: "P3引文定点重作路径",
    files: [paths.storyboard, work.work, work.workOrder, work.candidate, requestPath]
  });
  const existing = await exists(requestPath) ? await readData(requestPath) : null;
  if (!reviseQuotes && existing?.revisionScope !== P3_QUOTE_REVISION_SCOPE) return;
  const storyboard = await readData(paths.storyboard);
  let request = existing;
  let created = false;
  if (request) {
    assertP3QuoteRevisionRequest(request, storyboard);
    if (reviseQuotes && (hashObject(request.selectedBeatIds) !== hashObject(selectedBeatIds)
      || (revisionReason !== null && request.reason !== revisionReason.trim()))) {
      throw new Error("已有P3引文重作范围；请用普通 next --stage p3 续跑，不能覆盖进行中的范围或意见");
    }
  } else {
    if ((await exists(work.workOrder)) || (await exists(work.candidate))) {
      throw new Error("P3仍有未收口工作单或候选，不能发起引文定点重作");
    }
    for (const node of model.orderedNodes) {
      const other = work.returnRequest(node.id);
      if (other !== requestPath && await exists(other)) {
        throw new Error("P3仍有其它返工请求，不能发起引文定点重作");
      }
    }
    const currentRequests = new Set(collectQuoteRequests(storyboard).map(({ id }) => id));
    const currentDecisions = new Set((storyboard.authorQuotes?.items ?? []).map(({ id }) => id));
    const unknown = selectedBeatIds.filter((id) => !currentRequests.has(id) || !currentDecisions.has(id));
    if (unknown.length) throw new Error(`P3引文定点重作选择了没有已接纳引文位置的Beat: ${unknown.join(", ")}`);
    request = {
      target: "author",
      reason: revisionReason?.trim() || `按现行史料原文方法重新核实并替换 ${selectedBeatIds.join(", ")} 的引文与真实出处，其它正文和画面不变`,
      cueRefs: [],
      revisionScope: P3_QUOTE_REVISION_SCOPE,
      selectedBeatIds: [...selectedBeatIds],
      baselineAuthorQuotesSha256: hashObject(businessContent(storyboard.authorQuotes))
    };
    assertP3QuoteRevisionRequest(request, storyboard);
    await mkdir(work.work, { recursive: true });
    await atomicWriteData(requestPath, request);
    created = true;
  }
  try {
    const current = await resolveStageCurrent({ root, workspaceRoot, episodeId, stageId: "p3", model });
    if (current.kind !== "task" || current.runner !== "ai" || current.mode !== "author-quotes") {
      throw new Error("P3引文定点重作没有形成唯一Author引文工作单");
    }
  } catch (error) {
    if (created) await rm(requestPath, { force: true });
    throw error;
  }
};
