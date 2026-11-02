import path from 'node:path';
import {readData} from '../../program-utils.mjs';
import {authorSegmentId, getEpisodePaths} from '../../workspace-paths.mjs';
import {authorUnitsForStoryboard, businessContent} from '../../../engine/runtime/storyboard.mjs';
import {deriveAuthorWorkspaceRoot} from '../../modules/author-beat/candidate-validation.mjs';
import {inspectP3Input} from '../../../engine/p3-input.mjs';
import {resolveCueBindingsToFrames} from '../../cue-boundaries.mjs';
import {VIDEO_SPEC, frameSpanForMs} from '../../video-spec.mjs';
import {resolveSceneEvents} from '../../templates/vox-explainer/scene.mjs';
import {musicPlaybackContext} from '../background-music/render-entry.mjs';

export const projectAuthorContext = ({episodeId, authorUnit, authorUnits, episodeCues,
  acceptedFeatures, sourceAssets}) => {
  const current = authorUnits.find(unit => unit.id === authorUnit.id);
  if (!current) throw new Error(`声音上下文找不到当前作者单位: ${authorUnit.id}`);
  const chapterId = authorSegmentId(current);
  const {fps} = VIDEO_SPEC;
  const acceptedUnits = authorUnits.filter(unit => unit.id !== current.id && chapterId
    && authorSegmentId(unit) === chapterId && unit.treatment
    && acceptedFeatures?.['sound-effects']?.units?.[unit.id]).map(unit => {
      const cues = episodeCues.filter(cue => cue.id >= unit.beats[0].cueRange[0]
        && cue.id <= unit.beats.at(-1).cueRange[1]);
      const startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
      const durationInFrames = frameSpanForMs({startMs, endMs, fps});
      const actionTimings = resolveCueBindingsToFrames({bindingSet:acceptedFeatures['cue-sync'].bindings[unit.id],
        cues, segmentStartMs:startMs, segmentEndMs:endMs, fps});
      const eventTimings = unit.templateId === 'vox-explainer'
        ? resolveSceneEvents({scene:unit.treatment.scene, actionTimings, durationInFrames, fps}) : [];
      return {unitId:unit.id, templateId:unit.templateId, cues,
        timing:{startMs,endMs,durationInFrames,actionTimings,eventTimings},
        result:businessContent(acceptedFeatures['sound-effects'].units[unit.id])};
    });
  return {chapterId, music:musicPlaybackContext({featureData:acceptedFeatures?.['background-music'], sourceAssets, episodeId}),
    acceptedUnits};
};

export const readAuthorContext = async ({workspaceRoot, workOrder, sourceAssets}) => {
  const episodeId = workOrder.subject.id;
  const [storyboard, inspected] = await Promise.all([
    readData(getEpisodePaths(workspaceRoot,episodeId).storyboard), inspectP3Input({root:workspaceRoot,episodeId})]);
  return projectAuthorContext({episodeId, authorUnit:workOrder.inputs.authorUnit,
    authorUnits:authorUnitsForStoryboard(storyboard), episodeCues:inspected.cues,
    acceptedFeatures:storyboard.features, sourceAssets:sourceAssets ?? inspected.sourceAssets});
};

export const refreshAuthorReferences = async ({workOrder,workOrderPath,sourceAssets}) => readAuthorContext({workOrder,sourceAssets,
  workspaceRoot:deriveAuthorWorkspaceRoot({workOrder,
    candidatePath:path.join(path.dirname(path.resolve(workOrderPath)),path.basename(workOrder.candidatePath))})});
