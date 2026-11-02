import { resolveCrossBeatRuntimeTiming, explainerHandoffContext } from "./transitions.mjs";
import { isExplainerTemplateId } from "../../../explainer-template-selection.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";

export const scenePreviewProps = ({ segment, lead = 0, tail = 0, captions = [], audioFile = null, audioStartFrame = 0,
  audioTracks = [], previewNotice = null, width = VIDEO_SPEC.width, height = VIDEO_SPEC.height }) => {
  const fps = VIDEO_SPEC.fps;
  const data = segment.renderData?.voxExplainer;
  const withContext = isExplainerTemplateId(segment.templateId) && data?.context?.previous
    && !data.previewContent;
  if (withContext) tail = Math.max(tail, fps * 1.5);
  const source = { ...segment, segmentType: "body", startFrame: lead, startMs: lead / fps * 1000,
    endMs: (lead + segment.durationInFrames) / fps * 1000,
    appliedEntranceLeadFrames: segment.entranceLeadFrames ?? 0, appliedExitTailFrames: tail,
    appliedTransitionFrames: 0, appliedVisualFrameOffset: 0, appliedCameraPrerollFrames: 0,
    appliedHoldIncomingVisualAtStart: false };
  let segments = [source], transitions = [];
  if (withContext) {
    const previous = data.context.previous;
    const contextScene = (id, startFrame, durationInFrames, sampleStart) => {
      const asset = { ...previous.assetRef, requestId: "context", kind: "fullframe-image" };
      if (asset.mediaType === "video") {
        if (sampleStart === previous.durationInFrames - 1) asset.freezeFrame = sampleStart;
        else asset.trimBefore = (asset.trimBefore ?? 0) + sampleStart;
      }
      const motion = previous.motion && { ...previous.motion,
        startFrame: previous.motion.startFrame - sampleStart,
        runtimeEndFrame: previous.motion.runtimeEndFrame - sampleStart };
      return { id, templateId: "fullframe-narrative", segmentType: "body", startFrame,
        startMs: startFrame / fps * 1000, endMs: (startFrame + durationInFrames) / fps * 1000,
        durationInFrames, visualStyle: segment.visualStyle, assetRefs: [asset],
        ...(motion?.cameraPath ? { renderData: { fullframe: [{ requestId: "context", motion }], frameTransitions: [] } }
          : { renderMode: "asset-media", renderData: {} }) };
    };
    const before = contextScene(`${segment.id}-before`, 0, lead, Math.max(0, previous.durationInFrames - lead));
    const after = contextScene(`${segment.id}-after`, lead + segment.durationInFrames, tail, previous.durationInFrames - 1);
    ({ segments, transitions } = resolveCrossBeatRuntimeTiming({ segments: [before, source, after] }));
    const explainer = structuredClone(data);
    explainer.context = { ...explainer.context, ...explainerHandoffContext({ segment: segments[1], transitions }) };
    const key = "voxExplainer";
    segments[1] = { ...segments[1], renderData: { ...source.renderData, [key]: explainer } };
  }
  return { episodeId: segment.id, width, height, fps, visualStyle: segment.visualStyle,
    durationMs: (lead + segment.durationInFrames + tail) / fps * 1000,
    segments, overlays: [], transitions, ending: null, previewNotice,
    captions: captions.map(caption => ({ ...caption, startMs: caption.startMs + lead / fps * 1000, endMs: caption.endMs + lead / fps * 1000 })),
    audioTracks: [...(audioFile ? [{ id: "preview-narration", kind:'narration', file: audioFile, startMs: lead / fps * 1000,
      endMs: (lead + segment.durationInFrames) / fps * 1000, sourceStartFrame: audioStartFrame, volume: 1, loop: false }] : []),
      ...audioTracks.map(track => ({...track, startMs: track.startMs + lead / fps * 1000,
        endMs: track.endMs + lead / fps * 1000}))] };
};

// Rebase actual source audio into an image's camera window without restarting a sound.
export const audioTracksForWindow = ({tracks, fromFrame, toFrame, fps}) => tracks.flatMap(track => {
  const a = Math.round(track.startMs * fps / 1000), b = Math.round(track.endMs * fps / 1000);
  const start = Math.max(a, fromFrame), end = Math.min(b, toFrame);
  if (end <= start) return [];
  return [{...track, startMs: (start - fromFrame) / fps * 1000,
    endMs: (end - fromFrame) / fps * 1000,
    sourceStartFrame: (track.sourceStartFrame ?? 0) + start - a,
    envelopeOffsetFrames: (track.envelopeOffsetFrames ?? 0) + start - a,
    envelopeDurationFrames: track.envelopeDurationFrames ?? b - a}];
});
