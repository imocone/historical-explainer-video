import path from "node:path";
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runtimePath, runtimeValue, systemRoot} from '../../runtime-config.mjs';
import { assertSourceRightsForExternalProduction } from "../../source-rights.mjs";
import { BACKGROUND_MUSIC_RENDER_POLICY } from "./render-policy.mjs";
import {musicEnvelopesForSegments} from './dynamics.mjs';

const normalize = (value) => value.split(path.sep).join("/");
const personalBackgroundMusic = () => {
  const file = runtimePath('BACKGROUND_MUSIC_FILE');
  if (!file) return null;
  const relative = normalize(path.relative(systemRoot,file));
  if (!relative.startsWith('local-media/background-music/'))
    throw new Error('个人默认配乐须放在 local-media/background-music/；节目专属音乐仍用来源登记');
  const sourceCitation = runtimeValue('BACKGROUND_MUSIC_SOURCE');
  if (!sourceCitation) throw new Error('请在本机.env填写 BACKGROUND_MUSIC_SOURCE，保留曲名、作者及许可依据');
  return {mediaType:'audio',file:relative,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),
    sourceCitation,rightsStatus:runtimeValue('BACKGROUND_MUSIC_RIGHTS'),
    usageNotes:'个人配置仅声明视频使用权利，不代表允许将音频随源码再分发。'};
};

// One source choice for author context, candidate playback and final rendering.
export const musicPlaybackContext = ({featureData, sourceAssets = [], episodeId}) => {
  if (featureData === undefined) return {enabled:false};
  if (featureData === null) throw new Error('background-music 已启用但尚未完成');
  if (featureData.enabled === false) return {enabled:false};
  const usesEpisodeSource = featureData.sourceAssetId !== undefined;
  const source = usesEpisodeSource ? sourceAssets.find(item => item.id === featureData.sourceAssetId)
    : personalBackgroundMusic();
  if (!usesEpisodeSource && !source) return {enabled:false};
  if (!source) throw new Error(`背景音乐引用未登记来源资产: ${featureData.sourceAssetId}`);
  if (source.mediaType !== 'audio') throw new Error(`背景音乐来源资产必须是音频: ${source.id}`);
  assertSourceRightsForExternalProduction({rightsStatus:source.rightsStatus,
    label:usesEpisodeSource ? `背景音乐来源资产 ${source.id}` : '固定默认背景音乐'});
  return {enabled:true, ...(usesEpisodeSource ? {sourceAssetId:source.id} : {}),
    source:{...source, file:usesEpisodeSource ? normalize(path.join(episodeId, '制作', 'input', source.path)) : source.file},
    playback:{...BACKGROUND_MUSIC_RENDER_POLICY, clock:'body',
      entrance:'正文时间轴；P4片头确定后的预入时窗由最终渲染计算'}};
};

export const contribute = ({
  phase,
  featureData,
  sourceAssets,
  episodeId,
  bodyOffsetMs,
  bodyEndMs,
  bodyEntranceLeadFrames = 0,
  episodeEnding = null,
  storyboard,
  segments = [],
  fps
}) => {
  if (phase !== "audio-tracks") return null;
  const playback = musicPlaybackContext({featureData, sourceAssets, episodeId});
  if (!playback.enabled) return {audioTracks:[]};
  const {source} = playback;
  const trackEndMs = episodeEnding?.afterSegmentType === "body"
    ? episodeEnding.startMs + episodeEnding.durationMs
    : bodyEndMs;
  const fadeInFrames = Math.round(BACKGROUND_MUSIC_RENDER_POLICY.fadeInSeconds * fps);
  const entryLeadFrames = Number.isInteger(bodyEntranceLeadFrames)
    ? Math.max(0, Math.min(bodyEntranceLeadFrames, fadeInFrames))
    : 0;
  const startMs = Math.max(0, bodyOffsetMs - entryLeadFrames / fps * 1000);
  return {
    audioTracks: [{
      id: "body-background-music",
      kind: "background-music",
      segmentType: "body",
      startMs,
      endMs: trackEndMs,
      file: source.file,
      sha256: source.sha256,
      sourceCitation: source.sourceCitation,
      rightsStatus: source.rightsStatus,
      usageNotes: source.usageNotes,
      volume: BACKGROUND_MUSIC_RENDER_POLICY.volume,
      loop: BACKGROUND_MUSIC_RENDER_POLICY.loop,
      gainEnvelopes: musicEnvelopesForSegments({soundDesign:storyboard?.features?.['sound-effects'],
        segments, fps, trackStartMs:startMs, trackEndMs, bodyEndMs}),
      fadeInFrames,
      fadeOutFrames: Math.round(BACKGROUND_MUSIC_RENDER_POLICY.fadeOutSeconds * fps)
    }]
  };
};
