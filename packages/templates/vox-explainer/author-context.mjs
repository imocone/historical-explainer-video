import path from 'node:path';
import {inspectP3Input} from '../../../engine/p3-input.mjs';
import {authorUnitsForStoryboard} from '../../../engine/runtime/storyboard.mjs';
import {deriveAuthorWorkspaceRoot} from '../../modules/author-beat/candidate-validation.mjs';
import {hashObject, readData} from '../../program-utils.mjs';
import {getEpisodePaths} from '../../workspace-paths.mjs';
import {VIDEO_SPEC, frameSpanForMs} from '../../video-spec.mjs';
import {frameForTime} from '../../cue-boundaries.mjs';
import {CAPTION_STYLE} from '../../modules/render-video/runtime/caption-style.mjs';
import {bodyRuntimeTimingForAuthorUnits, explainerViewingWindow} from '../../modules/render-video/runtime/transitions.mjs';
import {createAppearance} from './appearance.mjs';
import {programDrawingFor} from './image-style.mjs';

export const projectAuthorContext = ({cues, treatment, visualPackage}) => ({
  appearance: treatment?.appearance ?? createAppearance(),
  visual: programDrawingFor(visualPackage),
  renderContext: {
    width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, fps: VIDEO_SPEC.fps,
    safeArea: {x: VIDEO_SPEC.safeMarginX, y: VIDEO_SPEC.safeMarginY,
      width: VIDEO_SPEC.width - 2 * VIDEO_SPEC.safeMarginX,
      height: VIDEO_SPEC.height - VIDEO_SPEC.safeMarginY - VIDEO_SPEC.subtitle.safeAreaHeight},
    subtitle: {...CAPTION_STYLE, safeAreaHeight: VIDEO_SPEC.subtitle.safeAreaHeight},
    time: {startMs: cues[0].startMs, endMs: cues.at(-1).endMs,
      durationInFrames: frameSpanForMs({startMs: cues[0].startMs, endMs: cues.at(-1).endMs, fps: VIDEO_SPEC.fps})}
  },
  designReferences: {method: 'packages/templates/vox-explainer/references/vox.md',
    art: 'packages/templates/vox-explainer/references/art.md',
    spatial: 'packages/templates/vox-explainer/references/spatial.md'}
});

export const readAuthorNarration = async ({workspaceRoot, workOrder}) => {
  const input = await inspectP3Input({root: workspaceRoot, episodeId: workOrder.subject.id, includeSpeechTiming: true});
  const expected = workOrder.inputs.cues;
  const cues = input.cues.filter(cue => cue.id >= expected[0].id && cue.id <= expected.at(-1).id);
  if (hashObject(cues) !== hashObject(expected)) throw new Error('本单字幕与当前正式原声交接不一致');
  if (!input.filePaths.audio) throw new Error('当前口播交接缺少正式原声');
  return {
    cues,
    episodeCues: input.cues,
    narrationDurationMs: input.narrationPackage.durationMs,
    audio: {file: input.filePaths.audio, sha256: input.narrationPackage.files.audio.sha256,
      startMs: cues[0].startMs, endMs: cues.at(-1).endMs,
      speechTiming: projectSpeechTiming({speechTiming: input.speechTiming, cues})}
  };
};

export const refreshAuthorReferences = async ({workOrder, workOrderPath, visualPackage}) => {
  const workspaceRoot = deriveAuthorWorkspaceRoot({workOrder,
    candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath))});
  const [{cues, episodeCues, audio}, storyboard] = await Promise.all([
    readAuthorNarration({workspaceRoot, workOrder}),
    readData(getEpisodePaths(workspaceRoot, workOrder.subject.id).storyboard)
  ]);
  const unit = workOrder.inputs.authorUnit;
  const authorUnits = authorUnitsForStoryboard(storyboard);
  const index = authorUnits.findIndex(item => item.id === unit.id && item.templateId === unit.templateId);
  if (index < 0) throw new Error(`${unit.id} 已不在正式讲解计划中`);
  const {segments, transitions} = bodyRuntimeTimingForAuthorUnits({
    authorUnits: authorUnits.slice(Math.max(0, index - 1), index + 2), cues: episodeCues
  });
  const segment = segments.find(item => item.id === unit.id);
  if (segment.cueRange.some((id, index) => id !== unit.cueRange[index])) {
    throw new Error(`${unit.id} 的正式讲解段界与本单不一致`);
  }
  return {templateContext: {
    ...projectAuthorContext({cues, treatment: workOrder.inputs.currentTreatment, visualPackage}),
    viewingWindow: explainerViewingWindow({segment, transitions}),
    audio
  }};
};

export const projectSpeechTiming = ({speechTiming, cues, fps = VIDEO_SPEC.fps}) => {
  if (!speechTiming?.available) return speechTiming ?? {available: false, reason: '没有实测短语时间'};
  if (!Array.isArray(speechTiming.cues)) throw new Error('P2短语时间缺少Cue投影');
  const frameAt = timeMs => frameForTime({timeMs, segmentStartMs:cues[0].startMs,
    segmentEndMs:cues.at(-1).endMs, fps});
  return {available: true, source: speechTiming.source, cues: cues.map(cue => {
    const matches = speechTiming.cues.filter(item => item.cueId === cue.id);
    if (matches.length !== 1 || !Array.isArray(matches[0].phrases) || !matches[0].phrases.length)
      throw new Error(`Cue ${cue.id} 缺少唯一实测短语时间`);
    const origin = frameAt(cue.startMs);
    let previousStart = cue.startMs;
    let previousEnd = cue.startMs;
    return {cueId: cue.id, phrases: matches[0].phrases.map((phrase, index) => {
      if (!phrase.text || !Number.isInteger(phrase.startMs) || !Number.isInteger(phrase.endMs)
        || phrase.startMs < previousStart || phrase.endMs < previousEnd
        || phrase.endMs <= phrase.startMs || phrase.endMs > cue.endMs)
        throw new Error(`Cue ${cue.id} 短语 ${index + 1} 的实测时段无效`);
      previousStart = phrase.startMs;
      previousEnd = phrase.endMs;
      return {index: index + 1, text: phrase.text,
        startOffsetSeconds: (frameAt(phrase.startMs) - origin) / fps,
        endOffsetSeconds: (frameAt(phrase.endMs) - origin) / fps};
    })};
  })};
};
