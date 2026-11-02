import {soundTracksForSegment, isSoundDesignSegment} from './timing.mjs';

export const contribute = ({phase, featureData, segments, fps, durationMs, bodyOffsetMs = 0}) => {
  if (phase !== 'audio-tracks') return null;
  const audioTracks = [];
  for (const segment of segments) {
    // Only actual body scenes sound: opener citations and replaced image Beats do not.
    if (!isSoundDesignSegment(segment)) continue;
    const result = featureData.units?.[segment.id];
    if (!result) throw new Error(`${segment.id} 缺少已启用音效交付`);
    audioTracks.push(...soundTracksForSegment({segment, result, fps, durationMs, earliestMs:bodyOffsetMs}));
  }
  return {audioTracks};
};

// Playback integration passes only picture/time and this Feature result. No music input.
export const previewAudioTracks = soundTracksForSegment;
