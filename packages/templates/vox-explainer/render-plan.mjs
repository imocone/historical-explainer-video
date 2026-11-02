import {MAP_WORKER_FILES} from './spatial/map-style.mjs';
import {VIDEO_SPEC} from '../../video-spec.mjs';
import {verifyAuthoredImage} from './images.mjs';
import {assertActionTimingsForTreatment, VOX_EXPLAINER_TIMING} from './cue-policy.mjs';
import {resolveSceneEvents} from './scene.mjs';
export {assertActionTimingsForTreatment, defaultActionTimingsForTreatment} from './cue-policy.mjs';

export const createRenderPolicy = ({fps, width, height}) => {
  if (fps !== VIDEO_SPEC.fps || width !== VIDEO_SPEC.width || height !== VIDEO_SPEC.height)
    throw new Error('Vox讲解使用项目正式视频规格');
  return {fps, width, height};
};

export async function authoredAssetsForTreatment({treatment, workspaceRoot, episodeId, segmentId}) {
  return Promise.all(treatment.assetRequests.map(async request => {
    const asset = await verifyAuthoredImage({asset: request.asset, request, treatment, appearance: treatment.appearance,
      workspaceRoot, episodeId, unitId: segmentId});
    return {...asset, requestId: request.requestId, kind: 'explainer-visual', mediaType: 'image', durationMs: null};
  }));
}

export const renderData = ({treatment, actionTimings, assetRefs, durationInFrames, policy}) => {
  assertActionTimingsForTreatment({treatment, actionTimings, durationInFrames});
  if (assetRefs.length !== treatment.assetRequests.length || treatment.assetRequests.some(request =>
    !assetRefs.some(asset => asset.requestId === request.requestId && asset.kind === 'explainer-visual'
      && ['image/png', ...(request.sourceAssetId ? ['image/jpeg'] : [])].includes(asset.mimeType))))
    throw new Error('Vox讲解缺少对应的P3图片交付');
  return {
    eventTimings: resolveSceneEvents({scene:treatment.scene, actionTimings, durationInFrames, fps:policy.fps}),
    resourceFiles: [...new Set([...Object.values(treatment.appearance.fonts).map(font => font.publicPath), ...MAP_WORKER_FILES])],
    entranceLeadFrames: VOX_EXPLAINER_TIMING.entry.leadFrames,
    voxExplainer: {scene: treatment.scene, appearance: treatment.appearance,
      actionTimings, durationInFrames, policy,
      transition: {incomingLeadFrames: VOX_EXPLAINER_TIMING.exit.backgroundSwapLeadFrames, exitTailFrames: 0}}
  };
};
