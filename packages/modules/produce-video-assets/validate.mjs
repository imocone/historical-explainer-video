import { projectVideoProduction } from "../../templates/cinematic-video/production-projection.mjs";
import { validateDelivery, validateProductionReceipts } from "./delivery.mjs";
import { hashObject } from "../../program-utils.mjs";

export const validate = ({ result, context }) => {
  const errors = [];
  if (result.episodeId !== context.episodeId) errors.push("视频交付剧集身份不一致");
  if (result.videoPlanSha256 !== hashObject(projectVideoProduction(context.videoPlan))) errors.push("视频交付未绑定当前设计");
  if (result.clips.length !== context.videoPlan.spans.length) errors.push("选定的视频必须逐段交付，空选须交付空清单");
  return errors;
};

export const validateAcceptance = async ({ result, context, services }) => {
  try {
    await validateDelivery({ root: services.workspaceRoot, episodeId: services.episodeId, videoPlan: context.videoPlan,
      videoManifest: result, storyboard: context.storyboard, cues: context.cues });
    await validateProductionReceipts({ root: services.workspaceRoot, episodeId: services.episodeId, result,
      videoPlan: context.videoPlan, storyboard: context.storyboard, cues: context.cues,
      visual: context.visual, stageRestartId: context.stageRestartId });
    return [];
  } catch (error) { return [error.message]; }
};
