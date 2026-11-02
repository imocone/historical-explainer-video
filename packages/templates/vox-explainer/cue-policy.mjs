import {resolveCueRange, resolveCueBindingsToFrames} from '../../cue-boundaries.mjs';
import {frameSpanForMs, VIDEO_SPEC} from '../../video-spec.mjs';
import {resolveSceneEvents} from './scene.mjs';
export const eventTimingsForTreatment = ({treatment, ...time}) => resolveSceneEvents({scene:treatment.scene, ...time});

export const VOX_EXPLAINER_TIMING = Object.freeze({
  entry: {leadFrames: 30, pushFrames: 30, breathFrames: 0, titleRevealFrames: 0},
  exit: {backgroundSwapLeadFrames: 30, tailFrames: 0, contentExitFrames: 0}
});

export const cueSyncTargetsForTreatment = treatment => (treatment.moments ?? [])
  .map(({id}) => ({target: id, action: 'advance-explainer'}));

export const validateCueBindingsForTreatment = ({treatment, bindings = []}) => {
  const targets = cueSyncTargetsForTreatment(treatment);
  return targets.length !== bindings.length || targets.some((item, i) =>
    item.target !== bindings[i]?.target || item.action !== bindings[i]?.action)
    ? ['每个观看变化须按顺序绑定一次真实Cue'] : [];
};

export const defaultActionTimingsForTreatment = () => { throw new Error('讲解动画须绑定真实Cue'); };

export const assertActionTimingsForTreatment = ({treatment, actionTimings, durationInFrames}) => {
  const errors = validateCueBindingsForTreatment({treatment, bindings: actionTimings});
  if (errors.length) throw new Error(errors.join('；'));
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1
    || actionTimings.some((item, i) => !Number.isInteger(item.frame) || item.frame < 0
      || item.frame >= durationInFrames || (i > 0 && item.frame < actionTimings[i - 1].frame)))
    throw new Error('讲解卡点须在本段内并按时间顺序排列');
  eventTimingsForTreatment({treatment, actionTimings, durationInFrames, fps: VIDEO_SPEC.fps});
  return actionTimings;
};

export const legalCueOptionsForTreatment = ({treatment, cues, cueRange, fixedBindings = [], fps = VIDEO_SPEC.fps}) => {
  const range = resolveCueRange({cueRange, cues});
  const targets = cueSyncTargetsForTreatment(treatment);
  const pool = range.cues.flatMap(cue => ['start', 'end'].map(edge => ({cueId: cue.id, edge})))
    .filter(item => (item.edge === 'start' ? cues.find(c => c.id === item.cueId).startMs
      : cues.find(c => c.id === item.cueId).endMs) < range.endMs);
  const toFrames = items => resolveCueBindingsToFrames({bindingSet: {items}, cues,
    segmentStartMs: range.startMs, segmentEndMs: range.endMs, fps});
  const valid = items => {
    if (items.length > targets.length || items.some((item, i) =>
      item.target !== targets[i].target || item.action !== targets[i].action)) return false;
    try {
      const timed = toFrames(items);
      return timed.every((item, i) => item.frame >= 0 && (!i || item.frame >= timed[i - 1].frame));
    } catch { return false; }
  };
  const nextTarget = targets[fixedBindings.length] ?? null;
  const good = targets.length > 0 && valid(fixedBindings);
  return {complete: good && !nextTarget, nextTarget,
    legalOptions: good && nextTarget ? pool.map(item => ({...nextTarget, ...item}))
      .filter(item => valid([...fixedBindings, item])) : [],
    cuePool: pool, recommendedPlan: [], diagnostics: good ? [] : ['先形成观看变化，并修正无效绑定']};
};

export const inspectDirectorAuthorability = ({cueRange, cues, previousTemplateId, fps = VIDEO_SPEC.fps}) => {
  const range = resolveCueRange({cueRange, cues});
  const context = ['fullframe-narrative', 'vox-explainer'].includes(previousTemplateId);
  const authorable = context && frameSpanForMs({startMs: range.startMs, endMs: range.endMs, fps}) > 0;
  return {authorable, durationMs: range.durationMs,
    ...(!authorable ? {reason: context ? '讲解段没有有效字幕时窗' : '第一个讲解连续段前必须有全画幅上下文'} : {})};
};
