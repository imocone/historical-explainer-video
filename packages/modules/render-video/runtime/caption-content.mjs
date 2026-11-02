import React from "react";
import { CAPTION_STYLE as geometry } from "./caption-style.mjs";

const words = new Intl.Segmenter("zh-CN", { granularity: "word" });

// Both the rendered caption and P2 layout inspection consume this exact markup.
export const CaptionContent = ({ text, subtitle }) => React.createElement("div", {
  style: {
    boxSizing: "border-box",
    width: `calc(100% - ${geometry.containerInsetX * 2}px)`,
    maxWidth: geometry.maxWidth,
    marginBottom: geometry.marginV,
    color: subtitle.primaryColor,
    fontFamily: subtitle.fontName,
    fontSize: geometry.fontSize,
    fontWeight: subtitle.fontWeight,
    fontStyle: subtitle.fontStyle,
    letterSpacing: `${geometry.letterSpacing}px`,
    lineHeight: geometry.lineHeight,
    textAlign: "center",
    textWrap: "balance",
    whiteSpace: "pre-wrap",
    overflowWrap: "normal",
    WebkitTextStroke: `${geometry.outline}px ${subtitle.outlineColor}`,
    paintOrder: "stroke fill",
    textShadow: `0 ${geometry.shadowNearOffsetY}px ${geometry.shadowNearBlur}px ${subtitle.shadowColor}, 0 ${geometry.shadowOffsetY}px ${geometry.shadowBlur}px ${subtitle.shadowColor}`
  }
}, React.createElement("span", {
  "data-caption-backing": "",
  style: {
    backgroundColor: `color-mix(in srgb, ${subtitle.outlineColor} ${geometry.backingOpacity * 100}%, transparent)`,
    padding: `${geometry.backingInsetY}px ${geometry.backingInsetX}px`,
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
    borderRadius: 3
  }
}, text.split("\n").map((line, lineIndex) => {
  const segments = [];
  for (const { segment } of words.segment(line)) {
    if (segments.length && (
      /^[，。！？、；：）》」』】”’…,.!?;:]+$/u.test(segment)
      || /[（《「『【“‘]$/u.test(segments.at(-1))
    )) segments[segments.length - 1] += segment;
    else segments.push(segment);
  }
  return React.createElement(React.Fragment, { key: lineIndex },
    lineIndex > 0 && React.createElement("br"),
    segments.map((segment, index) => React.createElement(React.Fragment, { key: index },
      index > 0 && React.createElement("wbr"),
      React.createElement("span", { "data-caption-word": "", style: { whiteSpace: "nowrap" } }, segment))));
})));
