import library from './library/catalog.json' with {type: 'json'};

export const soundLibrary = library;

export const resolveSoundPosition = ({position, actionTimings, eventTimings = [], fps, durationInFrames, segmentStartMs = 0, allowEnd = false}) => {
  let frame;
  if (position.eventId) {
    frame = eventTimings.find(item => item.id === position.eventId)?.frame;
    if (!Number.isInteger(frame)) throw new Error(`找不到画面事件 ${position.eventId}`);
  } else {
    const {target, action, offsetSeconds} = position.anchor;
    const anchor = actionTimings.find(item => item.target === target && item.action === action);
    if (!Number.isInteger(anchor?.frame)) throw new Error(`找不到画面锚点 ${target}/${action}`);
    frame = anchor.frame + Math.round(offsetSeconds * fps);
  }
  if (!Number.isInteger(frame) || frame < -Math.round(segmentStartMs * fps / 1000)
    || frame > durationInFrames || (!allowEnd && frame === durationInFrames))
    throw new Error('声音落点超出本段');
  return frame;
};

// Lemo's EV: declare events once; picture and mix consume the same numbers.
export const resolveSoundEvents = ({result, actionTimings, eventTimings = [], fps, durationInFrames, segmentStartMs = 0}) => {
  if (!Array.isArray(result?.events)) throw new Error('音效缺少events交付，明确留白交events:[]');
  const seen = new Set();
  return result.events.map(event => {
    if (seen.has(event.id)) throw new Error(`音效事件重复: ${event.id}`);
    seen.add(event.id);
    const sound = event.asset ?? library[event.soundId];
    if (!sound) throw new Error(`未登记Lemo音效: ${event.soundId}`);
    if (!(sound.syncSeconds >= 0 && sound.syncSeconds < sound.durationSeconds)) throw new Error(`${event.id} 声音有效落点无效`);
    const frame = resolveSoundPosition({position:event, actionTimings, eventTimings, fps, durationInFrames, segmentStartMs});
    return {...event, frame, sound};
  });
};

export const isSoundDesignSegment = segment => segment.segmentType === 'body'
  && ['fullframe-narrative', 'vox-explainer'].includes(segment.templateId)
  // Boundary-only preview placeholders have no action clock.
  && Array.isArray(segment.actionTimings)
  && segment.renderData && (segment.assetRefs.length || segment.templateId === 'vox-explainer');

export const soundTracksForSegment = ({segment, result, fps, durationMs = Infinity, earliestMs = 0}) => {
  const events = resolveSoundEvents({result, actionTimings: segment.actionTimings,
    eventTimings:segment.renderData?.eventTimings, durationInFrames:segment.durationInFrames, fps,
    segmentStartMs:segment.sourceStartMs ?? segment.startMs});
  return events.flatMap(event => {
    const sync = Math.round(event.sound.syncSeconds * fps);
    const duration = Math.max(1, Math.ceil(event.sound.durationSeconds * fps));
    const minimum = Math.round((earliestMs - segment.startMs) * fps / 1000);
    const sourceStartFrame = Math.max(0, minimum - (event.frame - sync));
    const startFrame = Math.max(minimum, event.frame - sync);
    const endFrame = Math.min(Math.round((durationMs - segment.startMs) * fps / 1000), event.frame - sync + duration);
    if (endFrame <= startFrame) return [];
    return [{
      id: `sfx-${segment.id}-${event.id}`, kind: 'sound-effect', segmentType: 'body',
      sourceSegmentId: segment.id,
      startMs: segment.startMs + startFrame / fps * 1000,
      endMs: Math.min(durationMs, segment.startMs + endFrame / fps * 1000),
      sourceStartFrame, file: event.sound.file, sha256: event.sound.sha256,
      volume: event.gain ?? 1, pan: event.pan ?? 0, loop: false,
      fadeOutFrames: Math.min(2, Math.max(0, endFrame - startFrame - 1))
    }];
  });
};
