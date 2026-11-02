import {verifyAuthoredImage} from "../../authored-images.mjs";
export const validate = ({ result, context }) => result.episodeId === context.episodeId
  ? [] : ["视频设计剧集身份不一致"];

export async function validateAcceptance({result,services}) {
  const errors=[];
  for (const span of result.spans) try {
    await verifyAuthoredImage({asset:span.asset,workspaceRoot:services.workspaceRoot,episodeId:services.episodeId,stageId:"p4",unitId:span.id});
  } catch (error) {errors.push(error.message);}
  return errors;
}
