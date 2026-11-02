import {resolveSoundPosition, isSoundDesignSegment} from '../sound-effects/timing.mjs';

// The sound designer supplies content intent; this package owns the resulting
// music envelope. It never changes the selected source or its playback clock.
export const resolveMusicGestures = ({result, holdEndFrame, ...timing}) => {
  const seen = new Set();
  return (result?.musicGestures ?? []).map(gesture => {
    if (seen.has(gesture.id)) throw new Error(`音乐收放重复: ${gesture.id}`);
    seen.add(gesture.id);
    const points = gesture.points.map(point => ({
      frame:resolveSoundPosition({position:point, ...timing, allowEnd:true}), gain:point.gain
    }));
    if (points.length < 2) throw new Error(`${gesture.id} 音乐收放至少需要两个时间点`);
    if (points.some((point, index) => !Number.isFinite(point.gain) || point.gain < 0 || point.gain > 1
      || index > 0 && point.frame <= points[index-1].frame))
      throw new Error(`${gesture.id} 音乐收放时间须递增，增益须在0至1之间`);
    // A deliberate quiet ending holds through this unit. It does not silently
    // become a permanent mute over later, independently authored chapters.
    const end = holdEndFrame ?? timing.durationInFrames;
    if (points.at(-1).gain !== 1 && points.at(-1).frame < end)
      points.push({frame:end, gain:points.at(-1).gain});
    return points;
  });
};

export const musicEnvelopesForSegments = ({soundDesign, segments = [], fps, trackStartMs, trackEndMs, bodyEndMs}) => {
  if (!soundDesign || soundDesign.enabled === false) return [];
  return segments.filter(isSoundDesignSegment).flatMap(segment =>
    resolveMusicGestures({result:soundDesign.units?.[segment.id], actionTimings:segment.actionTimings,
      eventTimings:segment.renderData?.eventTimings, durationInFrames:segment.durationInFrames,
      holdEndFrame:Number.isFinite(trackEndMs) && Number.isFinite(bodyEndMs)
        && segment.startMs + segment.durationInFrames / fps * 1000 >= bodyEndMs - 1000 / fps
        ? Math.max(segment.durationInFrames, Math.round((trackEndMs - segment.startMs) * fps / 1000)) : segment.durationInFrames,
      fps, segmentStartMs:segment.startMs}).map(points => points.map(point => ({...point,
      frame:point.frame + Math.round((segment.startMs - trackStartMs) * fps / 1000)}))));
};
