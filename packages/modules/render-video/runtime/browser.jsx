import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { templateRendererLoaders } from "./template-renderers.mjs";
import { createViewRenderer, AssetMedia, Plane, loadSceneFonts } from "./scene-view.jsx";
import { CaptionLayer } from "./captions.jsx";
import { captionSubtitleForScene } from "./caption-style.mjs";
import { narrativePresentation } from "./narrative-presentation.mjs";
import { explainerPushPresentation, centeredTransitionProgress, dipToBlackIncomingProgress, incomingPullRevealPresentation, transitionPresentation } from "./transitions.mjs";
import { interpolate } from "./motion-math.mjs";
import { isExplainerTemplateId } from "../../../explainer-template-selection.mjs";
import { sceneSourceWindow, sourceFrameAtTime, sceneFrameAtTime, hasAuthoredWindow } from "./scene-clock.mjs";
import { incomingCrossfirePresentation } from "../../../templates/crossfire-opener/render-policy.mjs";

const { props, timeline } = JSON.parse(document.getElementById("composition-data").textContent);
const root = document.getElementById("episode");
const stage = document.getElementById("visual-stage") ?? root;
const decoration = document.getElementById("transition-decoration");
const ending = document.getElementById("ending");
let captions;
const factories = new Map();
const mediaRenderer = createViewRenderer(({ segment, frame }) => {
  if(segment.assetRefs.length!==1)throw new Error(`${segment.id} 通用媒体覆盖轨必须只有一个素材`);
  return <Plane style={{ backgroundColor: "#000" }}><AssetMedia asset={segment.assetRefs[0]} frame={frame}/></Plane>;
});
if (props.previewNotice) {
  const notice = document.createElement("div");
  notice.textContent = props.previewNotice;
  Object.assign(notice.style, { position: "absolute", top: "25px", right: "80px", padding: "8px 16px", zIndex: "6",
    background: props.visualStyle.shared.palette.ink, color: props.visualStyle.shared.palette.surfaceLight,
    fontFamily: [].concat(props.visualStyle.shared.fontFamilies.sans).join(","), fontSize: "25px" });
  root.append(notice);
}
const ready = Promise.all([loadSceneFonts(props.visualStyle), ...[...new Set(timeline.scenes.map(scene => scene.segment.templateId).filter(Boolean))].map(async id => {
  const { createRenderer } = await templateRendererLoaders[id]();
  if (typeof createRenderer !== "function") throw new Error(`${id} 缺少正式 HY renderer`);
  factories.set(id, createRenderer);
})]);
const scenes = timeline.scenes.map(scene => ({ ...scene, window: sceneSourceWindow(scene, timeline),
  host: document.getElementById(scene.id), renderer: null, rendering: false, releaseRequested: false })).filter(scene => scene.host);
const style = (element, value) => { if (element) { element.removeAttribute("style"); Object.assign(element.style, value); } };
const basePresentation = (segment, frame) => {
  const transition = segment.appliedEntryTransition, duration = segment.appliedTransitionFrames;
  if (transition?.type === "crossfire-open") return incomingCrossfirePresentation({ frame, durationInFrames: duration });
  if (transition?.presentation === "story-designed" || segment.appliedHoldIncomingVisualAtStart && !transition
    || frame >= duration || duration <= 0 || transition?.type === "dissolve" && transition.presentation === "under-outgoing") return { opacity: 1 };
  if (transition?.type === "dip-to-black") return { opacity: dipToBlackIncomingProgress({ frame, durationInFrames: duration }) };
  if (transition?.type === "pull-reveal") return incomingPullRevealPresentation({ frame, durationInFrames: duration, transition });
  return { opacity: centeredTransitionProgress({ frame, durationInFrames: duration }) };
};
const boundaries = props.transitions.filter(item => item.mode === "narrative" || item.explainerPush);
const bodyScenes = new Map(scenes.filter(scene => scene.role === "body").map(scene => [scene.segment.id, scene]));
const nativeHidden = host => host.hasAttribute("data-hf-clip-hidden") || host.closest("[data-hidden]") !== null;
const releaseScene = scene => {
  scene.releaseRequested = true;
  if (!scene.rendering) { scene.renderer?.dispose(); scene.renderer = null; }
};
const releaseCaptions = () => { captions?.unmount(); captions = null; };
let frame, active, presentation, currentBoundaries = [];
const hasAuthoredBoundary = boundary => [boundary.previousId, boundary.nextId].every(id => {
  const scene = bodyScenes.get(id);
  return !scene || hasAuthoredWindow(scene.host.dataset, scene.window, timeline, props.fps);
});
const suppressedByBoundary = scene => scene.role === "boundary"
  ? hasAuthoredWindow(scene.host.dataset, scene.window, timeline, props.fps) && !hasAuthoredBoundary(scene.transition)
  : scene.role === "body" && currentBoundaries.some(item =>
    item.nextId === scene.segment.id && frame < item.startFrame
    || item.previousId === scene.segment.id && frame >= item.startFrame + item.durationInFrames);
const preparingIncoming = scene => scene.role === "body" && scene.segment.templateId === "fullframe-narrative"
  && currentBoundaries.some(item => item.nextId === scene.segment.id && frame < item.startFrame);
window.__hyperframes.registerFrameSource({ element: root, ready,
  render(time) {
    const duration = Number(root.dataset.duration ?? root.dataset.hfAuthoredDuration);
    frame = timeline.fromFrame + Math.min(Math.round(duration * props.fps) - 1, sourceFrameAtTime(time, props.fps));
    currentBoundaries = boundaries.filter(hasAuthoredBoundary);
    active = currentBoundaries.find(item => item.durationInFrames > 0 && frame >= item.startFrame && frame < item.startFrame + item.durationInFrames);
    presentation = active ? active.explainerPush
      ? explainerPushPresentation({ frame: frame - active.startFrame, durationInFrames: active.durationInFrames })
      : narrativePresentation({ design: active.entryTransition, frame: frame - active.startFrame,
        durationInFrames: active.durationInFrames, visualStyle: props.visualStyle, id: "boundary" }) : null;
    style(stage, presentation?.container ?? {});
    if (decoration) decoration.innerHTML = presentation?.decoration ?? "";
    for (const scene of scenes) if (nativeHidden(scene.host) || suppressedByBoundary(scene)) {
      scene.host.style.opacity = "0";
      if (nativeHidden(scene.host) || !preparingIncoming(scene)) releaseScene(scene);
    }
    if (ending) ending.style.opacity = "0";
    const captionHost = document.getElementById("captions");
    if (captionHost && nativeHidden(captionHost)) releaseCaptions();
    window.__hfStudioManualEditsApply?.();
  },
  dispose() { for (const scene of scenes) releaseScene(scene); releaseCaptions(); }
});
for (const scene of scenes) window.__hyperframes.registerFrameSource({ element: scene.host, ready,
  sourceRange: { start: 0, duration: (scene.window.endFrame - scene.window.startFrame) / props.fps, fps: props.fps },
  async render(time, signal) {
    const { segment, host } = scene;
    const suppressed = suppressedByBoundary(scene);
    if (nativeHidden(host) || suppressed && !preparingIncoming(scene)) {
      host.style.opacity = "0";
      releaseScene(scene);
      return;
    }
    scene.releaseRequested = false;
    scene.rendering = true;
    try {
      const local = sceneFrameAtTime(scene, scene.window, time, props.fps);
      const inBoundary = active && [active.previousId, active.nextId].includes(segment.id) && scene.role === "body";
      const projected = inBoundary ? presentation[active.previousId === segment.id ? "outgoing" : "incoming"]
        : scene.role === "boundary" ? transitionPresentation({ frame: sourceFrameAtTime(time, props.fps, scene.window.startFrame - scene.fromFrame),
          durationInFrames: scene.transition.transitionFrames, transition: scene.transition.exitTransition ?? null })
        : scene.role === "body" ? basePresentation(segment, local) : {};
      style(host.querySelector(".presentation"), projected);
      host.style.opacity = suppressed ? "0" : "1";
      host.style.zIndex = String(inBoundary ? (active.previousId === segment.id ? presentation.outgoing.zIndex ?? 0 : 0)
        : scene.role === "overlay" ? (segment.overlayLayer === "annotation" ? 3 : 2)
        : scene.role === "boundary" || isExplainerTemplateId(segment.templateId) || segment.segmentType === "opener"
        || segment.appliedEntryTransition?.type === "dip-to-black" && sourceFrameAtTime(time, props.fps, scene.window.startFrame) < segment.startFrame ? 1 : 0);
      scene.renderer ??= (segment.renderMode === "asset-media" ? mediaRenderer : factories.get(segment.templateId))({
        element: host.querySelector(".scene-content"), segment, mediaParking: host.querySelector(".media-parking"),
        media: new Map([...host.querySelectorAll("video")].map(video => [video.id, video])), signal
      });
      await scene.renderer.seek(local);
      if (ending && scene.role === "body" && segment.id === props.ending?.afterSegmentId && !scene.releaseRequested) {
        const endingFrame = sourceFrameAtTime(time, props.fps, scene.window.startFrame) - timeline.endingStart;
        ending.style.opacity = String(interpolate(endingFrame, [props.ending.holdFrames, timeline.endingEnd - timeline.endingStart - 1],
          [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
      }
      window.__hfStudioManualEditsApply?.();
    } finally {
      scene.rendering = false;
      if (scene.releaseRequested) releaseScene(scene);
    }
  },
  dispose() { releaseScene(scene); }
});
const captionHost = document.getElementById("captions");
if (captionHost) window.__hyperframes.registerFrameSource({ element: captionHost, ready,
  sourceRange: { start: 0, duration: (timeline.toFrame - timeline.fromFrame) / props.fps, fps: props.fps },
  render(time) {
    if (nativeHidden(captionHost)) { releaseCaptions(); return; }
    const content = document.getElementById("caption-content");
    if (content) {
      captions ??= createRoot(content);
      // Native visibility also reflects Studio moves, trims and reverse seeks.
      const visibleBody = !active?.explainerPush && Number(ending?.style.opacity ?? 0) < .3
        ? scenes.filter(scene => scene.role === "body" && !nativeHidden(scene.host)
          && !suppressedByBoundary(scene) && Number(scene.host.style.opacity) > 0)
          .sort((a,b) => Number(a.host.style.zIndex) - Number(b.host.style.zIndex)).at(-1) : null;
      const subtitle = captionSubtitleForScene(props.visualStyle.p4.subtitle, visibleBody?.segment);
      flushSync(() => captions.render(<CaptionLayer captions={props.captions} visualStyle={props.visualStyle}
        subtitle={subtitle}
        frame={sourceFrameAtTime(time, props.fps, timeline.fromFrame)} fps={props.fps}/>));
    }
    window.__hfStudioManualEditsApply?.();
  },
  dispose: releaseCaptions
});
