import path from "node:path";
import { readData } from "../../program-utils.mjs";
import { getEpisodePaths } from "../../workspace-paths.mjs";
import { authorUnitsForStoryboard } from "../../../engine/runtime/storyboard.mjs";
import { projectAdjacentTreatment, readPreviousTreatment } from "./context-runtime.mjs";
import { fullframeTransitionHandoffForAuthorUnit } from "./camera/author-transition-handoff.mjs";
import { completeFullframeRepresentation } from "./task-contract.mjs";
import { readP3Sources } from "../../p3-sources.mjs";

export const fullframeBatchItems = ({ workOrder, candidate }) => {
  const batch = workOrder.inputs?.authorBatch;
  if (!batch) return null;
  const items = candidate.result?.items;
  if (workOrder.inputs.authorUnit?.templateId !== "fullframe-narrative"
    || !Array.isArray(items) || Object.keys(candidate.result).some(key => key !== "items")
    || JSON.stringify(items.map(item => item.beatId)) !== JSON.stringify(batch.members.map(member => member.beatId))) {
    throw new Error("联合候选必须按工作单顺序完整交付所选全画幅Beat，不能增删或改写其它单位");
  }
  for (const item of items) {
    if (item.treatment?.templateId !== "fullframe-narrative"
      || Object.keys(item).some(key => !["beatId", "treatment", "featureResults"].includes(key))) {
      throw new Error(`${item.beatId} 缺少独立全画幅结果或包含越权字段`);
    }
  }
  return items;
};

// Views are derived from the one signed task and candidate. They are never
// persisted as extra work orders or candidates; locks and media retain Beat IDs.
export const fullframeAuthorViews = async ({ workspaceRoot, workOrder, candidate, includeCamera = true, beatIds = [] }) => {
  const items = fullframeBatchItems({ workOrder, candidate });
  const sourceAssets = await readP3Sources({ workspaceRoot, workOrder });
  if (!items) return [{ workOrder: { ...workOrder, inputs: { ...workOrder.inputs, sourceAssets } }, candidate }];
  for (const id of beatIds) {
    if (!items.some(item => item.beatId === id)) throw new Error(`联合候选没有Beat ${id}`);
  }
  const batch = workOrder.inputs.authorBatch;
  const storyboard = structuredClone(await readData(getEpisodePaths(workspaceRoot, workOrder.subject.id).storyboard));
  const shared = workOrder.inputs.templateContext;
  const cues = shared.episodeContext.cues;
  for (const item of items) {
    const beat = storyboard.beats.find(beat => beat.id === item.beatId);
    if (!beat || beat.templateId !== "fullframe-narrative") throw new Error(`联合候选引用未知全画幅Beat ${item.beatId}`);
    beat.treatment = item.treatment;
    storyboard.features["cue-sync"].bindings[item.beatId] = item.featureResults?.["cue-sync"];
  }
  const units = authorUnitsForStoryboard(storyboard);
  const views = [];
  const initialPrevious = includeCamera && (!beatIds.length || beatIds.includes(items[0].beatId))
    ? await readPreviousTreatment({ workspaceRoot, task: workOrder }) : workOrder.inputs.previousTreatment;
  for (const [index, item] of items.entries()) {
    if (beatIds.length && !beatIds.includes(item.beatId)) continue;
    const member = batch.members[index];
    const at = units.findIndex(unit => unit.id === item.beatId);
    const unit = units[at], previous = units[at - 1];
    let previousTreatment = index === 0 ? initialPrevious : null;
    if (index > 0 && previous?.templateId === "fullframe-narrative" && previous.treatment) {
      // Complete the camera reference in memory, without changing its candidate.
      const treatment = includeCamera
        ? completeFullframeRepresentation({ treatment: previous.treatment }).treatment : previous.treatment;
      const transitionHandoff = includeCamera ? fullframeTransitionHandoffForAuthorUnit({
        previousAuthorUnit: { ...previous, treatment }, currentAuthorUnit: unit, authorUnits: units,
        storyboard, cues, openerTemplate: batch.openerTemplate
      }) : null;
      previousTreatment = projectAdjacentTreatment(treatment, { transitionHandoff });
    }
    const { authorBatch: _batch, ...base } = workOrder.inputs;
    const inputs = { ...base, ...member.inputs, sourceAssets, previousTreatment,
      templateContext: { ...shared, ...member.inputs.templateContext,
        episodeContext: { ...shared.episodeContext, currentPosition: {
          beatId: item.beatId, index: storyboard.beats.findIndex(beat => beat.id === item.beatId) + 1,
          total: storyboard.beats.length
        } }
      } };
    delete inputs.previousCameraStateSha256;
    views.push({
      workOrder: { ...workOrder, inputs, scratchPath: path.posix.join(workOrder.scratchPath, "beats", item.beatId) },
      candidate: { taskDigest: candidate.taskDigest, result: { treatment: item.treatment, featureResults: item.featureResults ?? {} } },
      item
    });
  }
  return views;
};
