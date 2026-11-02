import React from "react";
import { Plane, canvasStyle, createViewRenderer, mediaUrl } from "../../../modules/render-video/runtime/scene-view.jsx";
import { Fullframe, FullframeSequence } from "../components/ab-dissolve.jsx";
import { cameraAtFrame } from "../camera/runtime-layer.mjs";
import { CalloutGroupOverlay } from "../callout/render.jsx";

export const TemplateView = ({ segment, frame }) => {
  if (segment.renderData?.singleFrameView) {
    const {asset,motion,effects} = segment.renderData.singleFrameView;
    const sampleFrame = motion.startFrame + frame;
    return <Plane style={canvasStyle(segment.visualStyle,"fullframe")}>
      <Fullframe frame={{asset,effects}} sampleFrame={sampleFrame}
        camera={cameraAtFrame({motion,frame:sampleFrame})} visualStyle={segment.visualStyle}/>
    </Plane>;
  }
  if (segment.renderData?.calloutOverlayGroup) {
    return <CalloutGroupOverlay frame={frame} callouts={segment.renderData.calloutOverlayGroup.callouts}/>;
  }
  const assets = segment.assetRefs.filter((item) => item.kind === "fullframe-image");
  const renderData = new Map((segment.renderData?.fullframe ?? []).map((item) => [item.requestId, item]));
  const frames = assets.map((asset) => {
    const data = renderData.get(asset.requestId);
    if (!data) throw new Error(`全画幅素材缺少 P4 renderData: ${asset.requestId}`);
    return { asset, ...data };
  });
  return <Plane style={canvasStyle(segment.visualStyle, "fullframe")}>
    <FullframeSequence
      frame={frame}
      frames={frames}
      transitions={segment.renderData?.frameTransitions ?? []}
      runtimeTiming={segment.runtimeTiming}
    />
  </Plane>;
};

export const createRenderer = options => {
  const images = options.segment.assetRefs.filter(asset => asset.kind === "fullframe-image").map(asset => {
    const image = new Image();
    image.src = mediaUrl(asset.file);
    return image;
  });
  const ready = Promise.all(images.map(image => image.decode().catch(cause => {
    throw new Error(`图片无法解码: ${image.src}`, { cause });
  })));
  ready.catch(() => {});
  const renderer = createViewRenderer(TemplateView)(options);
  return {
    async seek(frame) { await ready; return renderer.seek(frame); },
    dispose() { renderer.dispose(); images.length = 0; }
  };
};
