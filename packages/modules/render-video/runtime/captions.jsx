import React from "react";
import { Plane } from "./scene-view.jsx";
import { CaptionContent } from "./caption-content.mjs";

export const CaptionLayer = ({ captions = [], visualStyle, subtitle, frame, fps }) => {
  const timeMs = frame / fps * 1000;
  const caption = captions.find(item => item.startMs <= timeMs && item.endMs > timeMs);
  if (!caption) return null;
  return <Plane style={{ pointerEvents: "none", justifyContent: "flex-end", alignItems: "center", zIndex: 5 }}>
    <CaptionContent text={caption.text} subtitle={subtitle ?? visualStyle.p4.subtitle}/>
  </Plane>;
};
