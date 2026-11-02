import { VIDEO_SPEC } from "../../../video-spec.mjs";

const clampedProgress = (frame, durationInFrames) => Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)));
const softFade = (p) => p * p * (3 - 2 * p);
export const narrativeVisibility = ({ frame, durationInFrames, type }) => {
  const t = clampedProgress(frame, durationInFrames);
  if (type === "dissolve") {
    const incoming = softFade(t);
    return { incoming, outgoing: 1 - incoming };
  }
  if (type === "dip-to-black") {
    return { incoming: softFade(Math.max(0, (t - .7) / .3)), outgoing: 1 - softFade(Math.min(1, t / .3)) };
  }
  throw new Error(`未知正文转场 ${type}`);
};

export const narrativeTransitionExposure = ({ frame, durationInFrames, type }) => {
  const visibility = narrativeVisibility({ frame, durationInFrames, type });
  if (type === "dissolve") return { blendWeights: visibility };
  if (type === "dip-to-black") return { opacities: visibility, blackOnly: visibility.incoming === 0 && visibility.outgoing === 0 };
  throw new Error(`未知正文转场 ${type}`);
};

export const narrativeFirstVisibleFrame = (transition) => {
  for (let frame = 0; frame < transition.durationInFrames; frame++) {
    if (narrativeVisibility({ frame, ...transition }).incoming > 0) return frame;
  }
  return transition.durationInFrames;
};

export const narrativeLastVisibleFrame = (transition) => {
  for (let frame = transition.durationInFrames - 1; frame >= 0; frame--) {
    if (narrativeVisibility({ frame, ...transition }).outgoing > 0) return frame;
  }
  return -1;
};

// Stable camera handles, independent of the subsequently authored edit. Changing
// a boundary effect never changes either neighbour's accepted camera clock.
export const NARRATIVE_HANDLE_MS = 900;
export const narrativeHandleFrames = (fps = VIDEO_SPEC.fps) => Math.round(NARRATIVE_HANDLE_MS * fps / 1000);
// The outgoing source must bridge the silence before the next Cue as well as
// keep its fixed handle after that Cue. Effect choices do not change this clock.
export const narrativeExitTailFrames = ({ previousEndFrame, cutFrame, fps = VIDEO_SPEC.fps }) =>
  Math.max(0, cutFrame - previousEndFrame) + narrativeHandleFrames(fps);
export const isNarrativeMedia = (segment) => ["fullframe-narrative", "cinematic-video"].includes(segment?.templateId);

export const resolveNarrativeTransition = (design = null, fps = VIDEO_SPEC.fps) => {
  // An unauthored planning boundary has no effect yet; it is not an authored cut.
  if (design === null) return { type: "none", durationInFrames: 0, presentation: "story-designed" };
  const { type, durationMs, direction, reason } = design;
  if (!["dissolve", "dip-to-black"].includes(type)) {
    throw new Error(`未知正文转场 ${type}`);
  }
  if (typeof reason !== "string" || !reason.trim()) throw new Error("转场缺少前后内容与画面的选择理由");
  const durationInFrames = Math.round(durationMs * fps / 1000);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > NARRATIVE_HANDLE_MS * 2
    || durationInFrames < 2) {
    throw new Error("正文转场须至少2帧且不超过1800毫秒");
  }
  if (direction !== undefined) throw new Error(`${type} 不带转场方向`);
  return { ...design, durationInFrames, presentation: "story-designed" };
};

export const narrativeBoundary = ({ previous, next, fps = VIDEO_SPEC.fps }) => {
  const handle = narrativeHandleFrames(fps);
  const design = resolveNarrativeTransition(next.incomingTransition ?? null, fps);
  if (handle > previous.durationInFrames || handle > next.durationInFrames) {
    throw new Error(`${previous.id}->${next.id} 缺少已有相机边界余量`);
  }
  return {
    boundaryId: `${previous.id}->${next.id}`, previousId: previous.id, nextId: next.id,
    mode: "narrative", cutFrame: next.startFrame,
    startFrame: next.startFrame - Math.floor(design.durationInFrames / 2),
    entranceLeadFrames: handle,
    exitTailFrames: narrativeExitTailFrames({
      previousEndFrame: previous.startFrame + previous.durationInFrames, cutFrame: next.startFrame, fps
    }),
    transitionFrames: design.durationInFrames, durationInFrames: design.durationInFrames,
    holdIncomingVisualAtStart: false, entryTransition: design
  };
};

// Dissolves compare visible overlap; black transitions compare the latent
// cameras at the boundary, without claiming a visible overlap.
export const narrativeCameraSampleOffsets = (design = null, fps = VIDEO_SPEC.fps) => {
  const transition = resolveNarrativeTransition(design, fps);
  const first = transition.type === "dip-to-black" || transition.durationInFrames < 4
    ? 0 : -Math.floor(transition.durationInFrames / 2) + narrativeFirstVisibleFrame(transition);
  return [first, first + 1];
};
