import {MAP_WORKER_FILES} from './spatial/map-style.mjs';
import {frameForMs, VIDEO_SPEC} from '../../video-spec.mjs';
import {verifyAuthoredImage} from './images.mjs';
import {assertActionTimingsForTreatment, VOX_EXPLAINER_TIMING} from './cue-policy.mjs';
import {resolveSceneEvents} from './scene.mjs';
export {assertActionTimingsForTreatment, defaultActionTimingsForTreatment} from './cue-policy.mjs';

export const createRenderPolicy = ({fps, width, height}) => {
  if (fps !== VIDEO_SPEC.fps || width !== VIDEO_SPEC.width || height !== VIDEO_SPEC.height)
    throw new Error('Vox讲解使用项目正式视频规格');
  return {fps, width, height};
};

export async function authoredAssetsForTreatment({treatment, workspaceRoot, episodeId, segmentId, visualPackageId}) {
  const appearance = {...treatment.appearance, visualPackageId};
  return Promise.all(treatment.assetRequests.map(async request => {
    const asset = await verifyAuthoredImage({asset: request.asset, request, treatment, appearance,
      workspaceRoot, episodeId, unitId: segmentId});
    return {...asset, requestId: request.requestId, kind: 'explainer-visual', mediaType: 'image', durationMs: null};
  }));
}

export const renderData = ({treatment, actionTimings, assetRefs, durationInFrames, policy, shots = [], cues = [], cueStartMs = 0}) => {
  assertActionTimingsForTreatment({treatment, actionTimings, durationInFrames});
  if (assetRefs.length !== treatment.assetRequests.length || treatment.assetRequests.some(request =>
    !assetRefs.some(asset => asset.requestId === request.requestId && asset.kind === 'explainer-visual'
      && ['image/png', ...(request.sourceAssetId ? ['image/jpeg'] : [])].includes(asset.mimeType))))
    throw new Error('Vox讲解缺少对应的P3图片交付');
  const {fps} = policy;
  const eventTimings = resolveSceneEvents({scene:treatment.scene, actionTimings, durationInFrames, fps});
  const cueById = new Map(cues.map(cue => [cue.id, cue]));
  for (const shot of shots.slice(1)) {
    if (!Object.hasOwn(shot, 'incomingTransition')) continue;
    const cue = cueById.get(shot.cueRange[0]);
    if (!cue) throw new Error(`${shot.id} 找不到导演切点的正式Cue`);
    const frame = frameForMs({milliseconds: cue.startMs, fps}) - frameForMs({milliseconds: cueStartMs, fps});
    if (!Number.isInteger(frame) || frame <= 0 || frame >= durationInFrames)
      throw new Error(`${shot.id} 讲解切点超出本章`);
    if (eventTimings.some(event => event.id === shot.id)) throw new Error(`${shot.id} 与导演切点重名`);
    eventTimings.push({id: shot.id, frame});
  }
  return {
    eventTimings,
    resourceFiles: [...new Set([...Object.values(treatment.appearance.fonts).map(font => font.publicPath), ...MAP_WORKER_FILES])],
    entranceLeadFrames: VOX_EXPLAINER_TIMING.entry.leadFrames,
    voxExplainer: {scene: treatment.scene, appearance: treatment.appearance,
      actionTimings, durationInFrames, policy,
      transition: {incomingLeadFrames: VOX_EXPLAINER_TIMING.exit.backgroundSwapLeadFrames, exitTailFrames: 0}}
  };
};
