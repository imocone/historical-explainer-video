import { anchoredFrameForMs, anchoredFrameSpanForMs } from "../../../video-spec.mjs";
import { endingDurationInFrames } from "./ending.mjs";
import { boundaryOverlayRuntimeTiming, preEnteredSegmentTiming } from "./transitions.mjs";
import { isExplainerTemplateId } from "../../../explainer-template-selection.mjs";

export const bodyTimelineStartMsFor = ({segments=[],audioTracks=[]}) => {
  const narrationStart = audioTracks.find(track=>track.id==="body-narration")?.startMs;
  if (Number.isFinite(narrationStart)) return narrationStart;
  const starts = segments.filter(segment=>segment.segmentType==="body").map(segment=>segment.startMs);
  return starts.length ? Math.min(...starts) : 0;
};

export const compositionTimeline = props => {
  const anchorMs = bodyTimelineStartMsFor(props);
  const frameAt = milliseconds => anchoredFrameForMs({ milliseconds, anchorMs, fps: props.fps });
  // Retain the former scene consumer's timing checks at the new compiler entry.
  const segments=props.segments.map(segment=>{
    if(!Number.isInteger(segment.startFrame)||segment.startFrame!==frameAt(segment.startMs))
      throw new Error(`${segment.id} 成片片段起始帧与已解析计划不一致`);
    for(const [label,value] of [['entranceLead',segment.appliedEntranceLeadFrames],['exitTail',segment.appliedExitTailFrames],
      ['transition',segment.appliedTransitionFrames],['visualFrameOffset',segment.appliedVisualFrameOffset],['cameraPreroll',segment.appliedCameraPrerollFrames]])
      if(!Number.isInteger(value)||(label!=='visualFrameOffset'&&value<0))throw new Error(`${segment.id} 缺少已解析的${label}运行计时`);
    if(typeof segment.appliedHoldIncomingVisualAtStart!=='boolean')throw new Error(`${segment.id} 缺少已解析的入场画面保持状态`);
    return {...segment,durationInFrames:Number.isInteger(segment.durationInFrames)?segment.durationInFrames
      :anchoredFrameSpanForMs({startMs:segment.startMs,endMs:segment.endMs,anchorMs,fps:props.fps})};
  });
  if(!Array.isArray(props.transitions))throw new Error('P4 缺少已解析的跨片段转场计划');
  const durationFrames = Math.max(1, Math.round(props.durationMs * props.fps / 1000));
  const fromFrame = props.preview?.fromFrame ?? 0;
  const toFrame = props.preview?.toFrame ?? durationFrames;
  const endingStart = props.ending ? frameAt(props.ending.startMs) : null;
  const endingEnd = props.ending ? endingStart + endingDurationInFrames(props.ending) : null;
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  if(props.ending&&!byId.has(props.ending.afterSegmentId))throw new Error(`整集结尾找不到最终片段: ${props.ending.afterSegmentId}`);
  const scenes = segments.map(segment => {
    const timing = preEnteredSegmentTiming({ startFrame: segment.startFrame, durationInFrames: segment.durationInFrames,
      entranceLeadFrames: segment.appliedEntranceLeadFrames, exitTailFrames: segment.appliedExitTailFrames });
    const handoff = segment.templateId === "cinematic-video" ? props.transitions.find(transition =>
      transition.previousId === segment.id && isExplainerTemplateId(byId.get(transition.nextId)?.templateId)) : null;
    const endFrame = handoff ? handoff.startFrame + (handoff.explainerPush ? handoff.durationInFrames : 0) : Math.max(timing.from + timing.durationInFrames,
      segment.id === props.ending?.afterSegmentId ? endingEnd : 0);
    return { id: `scene-${scenesId(segment.id)}`, role: "body", fromFrame: timing.from, endFrame,
      freezeAt: segment.id === props.ending?.afterSegmentId ? timing.durationInFrames - 1 : null,
      segment: { ...segment, runtimeTiming: { semanticFrameOffset: timing.semanticFrameOffset,
        visualFrameOffset: segment.appliedVisualFrameOffset, cameraPrerollFrames: segment.appliedCameraPrerollFrames,
        exitTailFrames: segment.appliedExitTailFrames } } };
  });
  for (const transition of props.transitions) {
    if (["pre-entry", "narrative"].includes(transition.mode)) continue;
    const previous = byId.get(transition.previousId);
    scenes.push({ id: `boundary-${scenesId(transition.boundaryId)}`, role: "boundary", transition,
      fromFrame: transition.startFrame, endFrame: transition.startFrame + transition.transitionFrames,
      sampleOffset: transition.startFrame - previous.startFrame,
      freezeAt: previous.templateId === "fullframe-narrative" ? null : previous.durationInFrames - 1,
      segment: { ...previous, runtimeTiming: { semanticFrameOffset: 0,
        ...boundaryOverlayRuntimeTiming({ cameraPrerollFrames: previous.appliedCameraPrerollFrames }),
        exitTailFrames: previous.appliedExitTailFrames } } });
  }
  for (const segment of props.overlays ?? []) {
    const start = segment.startFrame ?? frameAt(segment.startMs);
    const duration = segment.durationInFrames ?? anchoredFrameSpanForMs({ startMs: segment.startMs, endMs: segment.endMs, anchorMs, fps: props.fps });
    scenes.push({ id: `overlay-${scenesId(segment.id)}`, role: "overlay", fromFrame: start, endFrame: start + duration,
      segment: { ...segment, durationInFrames: duration, runtimeTiming: { semanticFrameOffset: 0, visualFrameOffset: 0, cameraPrerollFrames: 0, exitTailFrames: 0 } } });
  }
  return { scenes, fromFrame, toFrame, endingStart, endingEnd, anchorMs };
};
export const scenesId = id => [...id].map(char => /[a-z0-9_-]/i.test(char) ? char : `_${char.codePointAt(0).toString(16)}_`).join("");
