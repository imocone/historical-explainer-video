import { adjacentMotionSummaryForTreatment } from "./index.mjs";

export const projectAdjacentTreatment = (
  treatment,
  { transitionHandoff = null } = {}
) => {
  const exitRequest = treatment.assetRequests?.at(-1);
  if (!exitRequest) throw new Error("全画幅相邻投影缺少末张画面");
  return {
    templateId: treatment.templateId,
    continuity: treatment.continuity,
    exitPicture: {
      requestId: exitRequest.requestId,
      frameId: exitRequest.frameId,
      purpose: exitRequest.purpose,
      ...(exitRequest.sceneDescription === undefined ? {} : { sceneDescription: exitRequest.sceneDescription }),
      motion: exitRequest.motion,
      ...(exitRequest.asset ? { asset: exitRequest.asset } : {})
    },
    ...(transitionHandoff ? {
      exitFrameId: exitRequest.frameId,
      cameraState: adjacentMotionSummaryForTreatment(treatment, { transitionHandoff })
    } : {})
  };
};
