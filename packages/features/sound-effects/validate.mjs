import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {assertProjectPath, fileSha256} from '../../program-utils.mjs';
import {resolveCueBindingsToFrames} from '../../cue-boundaries.mjs';
import {VIDEO_SPEC, frameSpanForMs} from '../../video-spec.mjs';
import {resolveSoundEvents} from './timing.mjs';
import {resolveMusicGestures} from '../background-music/dynamics.mjs';

export const validate = ({result, context}) => {
  try {
    const bindingSet = context.featureResults?.['cue-sync'] ?? context.currentFeatureResults?.['cue-sync'];
    if (!bindingSet) throw new Error('音效需要当前画面的cue-sync结果');
    const cues = context.cues;
    const startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
    const actionTimings = resolveCueBindingsToFrames({bindingSet, cues, segmentStartMs: startMs,
      segmentEndMs: endMs, fps: VIDEO_SPEC.fps});
    const durationInFrames = frameSpanForMs({startMs, endMs, fps: VIDEO_SPEC.fps});
    const eventTimings = context.templatePolicy?.eventTimingsForTreatment?.({treatment:context.treatment,
      actionTimings, durationInFrames, fps:VIDEO_SPEC.fps}) ?? [];
    resolveSoundEvents({result, actionTimings, eventTimings, fps: VIDEO_SPEC.fps, durationInFrames, segmentStartMs:startMs});
    resolveMusicGestures({result, actionTimings, eventTimings, fps: VIDEO_SPEC.fps, durationInFrames, segmentStartMs:startMs});
    return [];
  } catch (error) { return [error.message]; }
};

const unitId = scope => scope.authorUnitId ?? scope.unitId ?? scope.beatId;
export const readResult = ({storyboard, scope}) => storyboard.features?.[scope.featureId]?.units?.[unitId(scope)] ?? null;
export const projectResult = ({storyboard, scope, result, producer}) => {
  const feature = storyboard.features?.[scope.featureId];
  if (!feature) throw new Error('sound-effects未启用');
  feature.units ??= {};
  feature.units[unitId(scope)] = {...result, _producer: producer};
  return storyboard;
};
export const clearResult = ({storyboard, scope}) => {
  const units = storyboard.features?.[scope.featureId]?.units;
  if (units) delete units[unitId(scope)];
  return storyboard;
};

// The generated sound remains in the original P3 asset area after scratch cleanup.
export const validateRuntime = async ({result, services}) => {
  try {
    for (const {asset} of result.events) {
      if (!asset) continue;
      const root = services.workspaceRoot;
      const assets = path.join(root, services.episodeId, '制作/p3/assets/sound-effects');
      const file = path.resolve(root, asset.file);
      await assertProjectPath({root:assets, file, label:'本集程序音效'});
      if (await fileSha256(file) !== asset.sha256) throw new Error('声音资产字节与交付不一致');
      const bytes = await readFile(file);
      if (bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE') throw new Error('声音资产须为PCM WAV');
      let format, dataBytes;
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const size = bytes.readUInt32LE(offset+4), id = bytes.toString('ascii',offset,offset+4);
        if (id === 'fmt ') format = {codec:bytes.readUInt16LE(offset+8), channels:bytes.readUInt16LE(offset+10),
          sampleRate:bytes.readUInt32LE(offset+12), block:bytes.readUInt16LE(offset+20)};
        if (id === 'data') dataBytes = size;
        offset += 8 + size + size % 2;
      }
      if (!format || ![1,65534].includes(format.codec) || format.channels !== 2 || format.sampleRate !== 48000
        || !dataBytes || Math.abs(dataBytes/format.block/48000 - asset.durationSeconds) > 1/48000)
        throw new Error('声音资产格式或实测时长与交付不一致');
    }
    return [];
  } catch (error) { return [error.message]; }
};
