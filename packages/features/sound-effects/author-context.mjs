import path from 'node:path';
import {readData} from '../../program-utils.mjs';
import {authorSegmentId, getEpisodePaths, getStageWorkPaths} from '../../workspace-paths.mjs';
import {authorUnitsForStoryboard, businessContent} from '../../../engine/runtime/storyboard.mjs';
import {deriveAuthorWorkspaceRoot} from '../../modules/author-beat/candidate-validation.mjs';
import {inspectP3Input} from '../../../engine/p3-input.mjs';
import {resolveCueBindingsToFrames} from '../../cue-boundaries.mjs';
import {VIDEO_SPEC, frameSpanForMs} from '../../video-spec.mjs';
import {resolveSceneEvents} from '../../templates/vox-explainer/scene.mjs';
import {musicPlaybackContext} from '../background-music/render-entry.mjs';

const soundReference = ({unitId, templateId, cues, treatment, bindings, result}) => {
  const {fps} = VIDEO_SPEC;
  const startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
  const durationInFrames = frameSpanForMs({startMs, endMs, fps});
  const actionTimings = resolveCueBindingsToFrames({bindingSet:bindings, cues,
    segmentStartMs:startMs, segmentEndMs:endMs, fps});
  const eventTimings = templateId === 'vox-explainer'
    ? resolveSceneEvents({scene:treatment.scene, actionTimings, durationInFrames, fps}) : [];
  return {unitId, templateId, cues,
    timing:{startMs,endMs,durationInFrames,actionTimings,eventTimings}, result:businessContent(result)};
};

export const projectAuthorContext = ({episodeId, authorUnit, authorUnits, episodeCues,
  acceptedFeatures, sourceAssets, p3BodyRedesign, skipAcceptedUnitIds}) => {
  const current = authorUnits.find(unit => unit.id === authorUnit.id);
  if (!current) throw new Error(`声音上下文找不到当前作者单位: ${authorUnit.id}`);
  const chapterId = authorSegmentId(current);
  // Retained designs await rebinding; their old Cue clock is not current timing.
  const pending = new Set(p3BodyRedesign?.cueRebinding ? p3BodyRedesign.pendingAuthorUnitIds : []);
  const acceptedUnits = authorUnits.filter(unit => unit.id !== current.id && chapterId
    && !pending.has(unit.id) && !skipAcceptedUnitIds?.has(unit.id)
    && authorSegmentId(unit) === chapterId && unit.treatment
    && acceptedFeatures?.['sound-effects']?.units?.[unit.id]).map(unit => {
      const cues = episodeCues.filter(cue => cue.id >= unit.beats[0].cueRange[0]
        && cue.id <= unit.beats.at(-1).cueRange[1]);
      return soundReference({unitId:unit.id, templateId:unit.templateId, cues, treatment:unit.treatment,
        bindings:acceptedFeatures['cue-sync'].bindings[unit.id], result:acceptedFeatures['sound-effects'].units[unit.id]});
    });
  return {chapterId, music:musicPlaybackContext({featureData:acceptedFeatures?.['background-music'], sourceAssets, episodeId}),
    acceptedUnits};
};

export const readAuthorContext = async ({workspaceRoot, workOrder, sourceAssets, batch}) => {
  const episodeId = workOrder.subject.id;
  const paths = getEpisodePaths(workspaceRoot,episodeId);
  const [storyboard, inspected, p3BodyRedesign] = await Promise.all([
    readData(paths.storyboard), inspectP3Input({root:workspaceRoot,episodeId}),
    readData(getStageWorkPaths(paths,'p3').returnRequest('author')).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })]);
  const authorUnit = workOrder.inputs.authorUnit;
  const context = projectAuthorContext({episodeId, authorUnit,
    authorUnits:authorUnitsForStoryboard(storyboard), episodeCues:inspected.cues,
    acceptedFeatures:storyboard.features, sourceAssets:sourceAssets ?? inspected.sourceAssets, p3BodyRedesign,
    skipAcceptedUnitIds:batch && new Set(batch.members.map(member => member.beatId))});
  if (!batch) return context;

  // Each member's preview uses the current chapter candidate. An old accepted
  // result fitted to a member's replaced picture cannot fill a draft omission.
  const previewUnits = [...context.acceptedUnits];
  for (const [index, member] of batch.members.entries()) {
    if (member.beatId === authorUnit.id) continue;
    const item = batch.items[index];
    const result = item.featureResults?.['sound-effects'];
    if (!result?.events?.length && !result?.musicGestures?.length) continue;
    previewUnits.push(soundReference({unitId:member.beatId, templateId:member.inputs.authorUnit.templateId,
      cues:member.inputs.cues, treatment:item.treatment, bindings:item.featureResults['cue-sync'], result}));
  }
  return {...context, previewUnits};
};

export const refreshAuthorReferences = async ({workOrder,workOrderPath,sourceAssets}) => readAuthorContext({workOrder,sourceAssets,
  workspaceRoot:deriveAuthorWorkspaceRoot({workOrder,
    candidatePath:path.join(path.dirname(path.resolve(workOrderPath)),path.basename(workOrder.candidatePath))})});
