import { anchoredFrameForMs, anchoredFrameSpanForMs } from "../../video-spec.mjs";
import { videoWindow } from "./timing.mjs";
import { validateVideoTransitions } from "./boundary-transitions.mjs";

export const createVideoSegments = ({ videoPlan, videoManifest, storyboard, cues, bodyOffsetMs, fps, visualStyle, previewSpanIds = null }) => {
  if (!videoPlan || (!previewSpanIds && !videoManifest)) throw new Error("P4缺少正式剧情视频设计或交付（空选也须有清单）");
  const boundaryErrors = validateVideoTransitions({ storyboard, videoPlan,
    requireTreatment: previewSpanIds ? () => false : undefined });
  if (boundaryErrors.length) throw new Error(boundaryErrors.join("；"));
  if (!previewSpanIds && videoManifest.clips.length !== videoPlan.spans.length) throw new Error("视频交付与设计数量不一致");
  return videoPlan.spans.map((span) => {
    const window = videoWindow({ span, storyboard, cues });
    const metadataOnly = previewSpanIds && !previewSpanIds.has(span.id);
    const clip = videoManifest?.clips.find(({ id }) => id === span.id);
    if (!metadataOnly && (!clip || clip.durationMs !== window.deliveryDurationMs)) throw new Error(`${span.id} 缺少完整视频交付`);
    const startMs = bodyOffsetMs + window.startMs;
    const contentEndMs = bodyOffsetMs + window.endMs;
    return {
      id: span.id, segmentType: "body", templateId: "cinematic-video", beatIds: [...span.beatIds],
      incomingTransition: videoPlan.incomingTransitions?.[span.id] ?? null,
      startMs, endMs: contentEndMs, startFrame: anchoredFrameForMs({ milliseconds: startMs, anchorMs: bodyOffsetMs, fps }),
      durationInFrames: anchoredFrameSpanForMs({ startMs, endMs: contentEndMs, anchorMs: bodyOffsetMs, fps }),
      treatment: {}, actionTimings: [], visualStyle,
      assetRefs: metadataOnly ? [] : [{ requestId: span.id, kind: "cinematic-video", mediaType: "video", mimeType: "video/mp4", file: clip.file, sha256: clip.sha256, width: clip.width, height: clip.height, durationMs: clip.durationMs }],
      renderData: { beatIds: [...span.beatIds], headHandleFrames: window.headHandleFrames }
    };
  });
};
