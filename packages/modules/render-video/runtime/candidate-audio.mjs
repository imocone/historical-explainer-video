import {featureRenderEntryLoaders} from './feature-render-entries.mjs';
import {contribute as music, musicPlaybackContext} from '../../../features/background-music/render-entry.mjs';
import {audioTracksForWindow} from './scene-preview.mjs';
import {readData} from '../../../program-utils.mjs';
import {getEpisodePaths} from '../../../workspace-paths.mjs';

const soundSelected = workOrder => workOrder?.resolvedAssembly.slots.some(slot =>
  slot.implementations.some(item => item.packageId === 'sound-effects'));

export const candidateAudioContext = async ({workspaceRoot,workOrder,sourceAssets}) => {
  if (soundSelected(workOrder)) {
    const {readAuthorContext} = await import('../../../features/sound-effects/author-context.mjs');
    return readAuthorContext({workspaceRoot,workOrder,sourceAssets});
  }
  const storyboard = await readData(getEpisodePaths(workspaceRoot,workOrder.subject.id).storyboard);
  return {music:musicPlaybackContext({featureData:storyboard.features?.['background-music'],
    sourceAssets,episodeId:workOrder.subject.id}), acceptedUnits:[]};
};

const referenceSegment = unit => ({id:unit.unitId, templateId:unit.templateId, segmentType:'body',
  ...unit.timing, assetRefs:[{}], renderData:{eventTimings:unit.timing.eventTimings}});

// Picture edits do not inherit sound fitted to an older picture. Feature-only
// repairs inherit the unchanged picture's timing without copying it back.
export const previewFeatureResults = ({inputs, result}) => ({
  ...(inputs.repairFeatureIds?.length ? inputs.currentFeatureResults ?? {} : {}),
  ...(result.featureResults ?? {})
});

export const candidateEffectTracks = async ({workOrder, result, segment, fps, durationMs, audioContext}) => {
  const results = previewFeatureResults({inputs:workOrder.inputs, result});
  const selected = new Set(workOrder.resolvedAssembly.slots.flatMap(slot => slot.implementations)
    .filter(item => item.kind === 'feature').map(item => item.packageId));
  const tracks = [];
  for (const id of selected) {
    if (!featureRenderEntryLoaders[id]) continue;
    const entry = await featureRenderEntryLoaders[id]();
    if (entry.previewAudioTracks && results[id]) tracks.push(...entry.previewAudioTracks({result:results[id],
      segment:{...segment,sourceStartMs:workOrder.inputs.cues?.[0]?.startMs ?? 0}, fps, durationMs}));
    if (id === 'sound-effects' && entry.previewAudioTracks) for (const unit of audioContext?.acceptedUnits ?? []) {
      const reference = referenceSegment(unit);
      tracks.push(...entry.previewAudioTracks({result:unit.result, fps, durationMs,
        segment:{...reference, sourceStartMs:reference.startMs,
          startMs:reference.startMs - workOrder.inputs.cues[0].startMs}}));
    }
  }
  return tracks;
};

// Defaults to the actual episode choice. An explicit source is a playback-only comparison.
export const specifiedMusicForWindow = ({sourceAssetId, sourceAssets, episodeId,
  fromFrame, toFrame, fps, bodyEndMs, workOrder, result, segment, muteEffects = false, audioContext}) => {
  const playback = sourceAssetId ? {enabled:true,sourceAssetId}
    : audioContext?.music ?? workOrder?.inputs.featureContexts?.['sound-effects']?.music;
  if (!playback?.enabled) return [];
  const selected = !muteEffects && soundSelected(workOrder);
  const soundResult = selected ? previewFeatureResults({inputs:workOrder.inputs, result})['sound-effects'] : null;
  const references = selected ? audioContext?.acceptedUnits ?? [] : [];
  const segments = [...references.map(referenceSegment), ...(segment ? [{...segment, segmentType:'body', assetRefs:segment.assetRefs ?? [{}],
    startMs:Math.round(workOrder.inputs.cues[0].startMs * fps / 1000) / fps * 1000}] : [])];
  const units = Object.fromEntries(references.map(unit => [unit.unitId, unit.result]));
  if (soundResult && segment) units[segment.id] = soundResult;
  const tracks = music({phase:'audio-tracks', featureData:playback.sourceAssetId ? {sourceAssetId:playback.sourceAssetId} : {}, sourceAssets,
    episodeId, bodyOffsetMs:0, bodyEndMs, fps, segments,
    storyboard:{features:{'sound-effects':{units}}}}).audioTracks;
  return audioTracksForWindow({tracks, fromFrame, toFrame, fps});
};
