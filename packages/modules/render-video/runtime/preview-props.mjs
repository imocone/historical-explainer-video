import { anchoredFrameForMs } from "../../../video-spec.mjs";
import { bodyTimelineStartMsFor } from "./timeline.mjs";
import { endingDurationInFrames } from "./ending.mjs";

export const buildSegmentPreviewProps = ({ episodeProps, segmentType }) => {
  if (!["body", "opener"].includes(segmentType)) throw new Error(`未知片段预览类型: ${segmentType}`);
  const segments = episodeProps.segments.filter(segment => segment.segmentType === segmentType);
  if (!segments.length) throw new Error(`当前没有已交付的${segmentType === "body" ? "正文" : "片头"}`);
  const anchorMs = bodyTimelineStartMsFor(episodeProps);
  const first = segments[0], last = segments.at(-1);
  const planned = episodeProps.preview;
  // The render plan can include the first body cue after an opener tail or
  // breath. Keep that window instead of cutting off as the narration begins.
  if (segmentType === "opener" && planned?.fromFrame === first.startFrame
    && planned.toFrame > last.startFrame + last.durationInFrames
    && planned.segmentIds?.length === segments.length
    && planned.segmentIds.every(id=>segments.some(segment=>segment.id === id))) {
    return {...episodeProps,preview:{...planned,segmentIds:[...planned.segmentIds]}};
  }
  const ending = episodeProps.ending?.afterSegmentId === last.id ? episodeProps.ending : null;
  return { ...episodeProps, preview: {
    fromFrame: first.startFrame,
    toFrame: ending ? anchoredFrameForMs({milliseconds:ending.startMs,anchorMs,fps:episodeProps.fps}) + endingDurationInFrames(ending)
      : last.startFrame + last.durationInFrames,
    segmentIds: segments.map(segment => segment.id)
  } };
};
