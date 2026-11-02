import React from "react";
import { Plane, AssetMedia, createViewRenderer } from "../../../modules/render-video/runtime/scene-view.jsx";

const TemplateView = ({ segment, frame }) => {
  if (segment.assetRefs.length !== 1) throw new Error(`${segment.id} 必须连续播放同一个视频源`);
  const sourceFrame = frame + (segment.runtimeTiming?.semanticFrameOffset ?? 0) + segment.renderData.headHandleFrames;
  return <Plane style={{ backgroundColor: "#000" }}><AssetMedia asset={segment.assetRefs[0]} frame={sourceFrame}/></Plane>;
};
export const createRenderer = createViewRenderer(TemplateView);
