import React from "react";
import { bezier, interpolate } from "../../../modules/render-video/runtime/motion-math.mjs";
import { Plane } from "../../../modules/render-video/runtime/scene-view.jsx";
import { useVisualStyle } from "../../../modules/render-video/runtime/scene-view.jsx";
import { resolveCalloutEntrySampleFrame } from "./layout.mjs";
import { CALLOUT_RENDER_POLICY, CALLOUT_EASING } from "./render-policy.mjs";
const calloutEasing = ({ x1, y1, x2, y2 }) => bezier(x1, y1, x2, y2);

const Callout = ({ callout, frame }) => {
  const visualStyle = useVisualStyle();
  if (!callout) return null;
  if (!["historical-quote", "person-intro", "term-gloss"].includes(callout.kind)) {
    throw new Error("P4 全画幅解说框类型无效");
  }
  const revealDurationFrames = callout.revealDurationFrames;
  const holdDurationFrames = callout.holdDurationFrames;
  const exitDurationFrames = callout.exitDurationFrames;
  for (const [label, value] of [
    ["进场", revealDurationFrames],
    ["清晰停留", holdDurationFrames],
    ["退场", exitDurationFrames]
  ]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`P4 全画幅解说框缺少模板${label}时长`);
    }
  }
  const revealFrame = callout.revealStartFrame;
  const holdStartFrame = callout.holdStartFrame;
  const exitStartFrame = callout.exitStartFrame;
  const endFrame = callout.endFrame;
  if (
    !Number.isInteger(revealFrame)
    || holdStartFrame !== revealFrame + revealDurationFrames
    || exitStartFrame !== holdStartFrame + holdDurationFrames
    || endFrame !== exitStartFrame + exitDurationFrames
  ) {
    throw new Error("P4 全画幅解说框缺少完整模板生命周期");
  }
  if (frame < revealFrame || frame >= endFrame) return null;
  if (!Number.isFinite(callout.textRevealSpread) || callout.textRevealSpread <= 0 || callout.textRevealSpread >= 1) {
    throw new Error("P4 全画幅解说框缺少逐字墨化扩散比例");
  }
  if (!Number.isFinite(callout.textBlurPx) || callout.textBlurPx <= 0) {
    throw new Error("P4 全画幅解说框缺少墨化模糊幅度");
  }
  if (!Number.isFinite(callout.backdropDimOpacity) || callout.backdropDimOpacity < 0 || callout.backdropDimOpacity > 1) {
    throw new Error("P4 全画幅解说框缺少合法背景压暗强度");
  }
  const { shared } = visualStyle;
  const rectangle = callout.screenRectangle;
  const layout = callout.layout;
  if (!rectangle || !Number.isFinite(rectangle.x) || !Number.isFinite(rectangle.y)) {
    throw new Error("P4 全画幅解说框缺少已验证屏幕矩形");
  }
  if (
    !layout
    || layout.kind !== callout.kind
    || layout.hasCitation !== (callout.kind === "historical-quote")
    || rectangle.width !== layout.width
    || rectangle.height !== layout.height
    || (layout.style === "quote" && !Array.isArray(layout.lines))
    || (layout.style === "identity" && !Array.isArray(layout.blocks))
  ) {
    throw new Error("P4 全画幅解说框缺少与屏幕矩形一致的派生文字布局");
  }
  const entrySampleFrame = resolveCalloutEntrySampleFrame({
    frame,
    revealStartFrame: revealFrame,
    revealDurationFrames,
    exitStartFrame,
    endFrame
  });
  const entryProgress = interpolate(entrySampleFrame, [revealFrame, holdStartFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: calloutEasing(CALLOUT_EASING.calloutEnter)
  });
  const backdropOpacity = entryProgress * callout.backdropDimOpacity;
  const spreadFrames = Math.max(1, Math.round(revealDurationFrames * callout.textRevealSpread));
  const glyphRevealFrames = Math.max(1, revealDurationFrames - spreadFrames);
  const glyphProgressFor = (glyphIndex, glyphCount) => {
    const glyphStartFrame = revealFrame + Math.round(
      spreadFrames * glyphIndex / Math.max(1, glyphCount - 1)
    );
    return interpolate(entrySampleFrame, [glyphStartFrame, glyphStartFrame + glyphRevealFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: calloutEasing(CALLOUT_EASING.calloutEnter)
    });
  };

  if (layout.style === "identity") {
    const isRight = rectangle.x + rectangle.width / 2 > 960;
    if (callout.kind === "person-intro" || callout.kind === "term-gloss") {
      const identityGlyphCount = Math.max(1, layout.blocks.reduce((total, block) => (
        total
        + [...block.heading].length
        + (block.bodyLines ?? [block.body]).reduce((sum, line) => sum + [...line].length, 0)
      ), 0));
      let identityGlyphOffset = 0;
      const inkText = (text) => {
        const glyphs = [...text];
        const startIndex = identityGlyphOffset;
        identityGlyphOffset += glyphs.length;
        return glyphs.map((glyph, glyphIndex) => {
          const absoluteIndex = startIndex + glyphIndex;
          const progress = glyphProgressFor(absoluteIndex, identityGlyphCount);
          return <span key={`${absoluteIndex}-${glyph}`} style={{
            opacity: progress,
            filter: `blur(${(1 - progress) * callout.textBlurPx}px)`,
            willChange: progress < 1 ? "opacity, filter" : undefined
          }}>{glyph}</span>;
        });
      };
      const frameInset = CALLOUT_RENDER_POLICY.identityFrame.inset;
      const frameThickness = CALLOUT_RENDER_POLICY.identityFrame.thickness;
      const topCapLength = Math.min(
        CALLOUT_RENDER_POLICY.identityFrame.topCapLength,
        layout.bodyMaxLineWidthPx
      );
      const bottomCapLength = CALLOUT_RENDER_POLICY.identityFrame.bottomCapLength;
      const edgeStyle = isRight ? { right: frameInset } : { left: frameInset };
      return <Plane style={{ pointerEvents: "none" }}>
        <div style={{
          position: "absolute",
          left: rectangle.x,
          top: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
          boxSizing: "border-box"
        }}>
          <div style={{
            position: "absolute",
            ...edgeStyle,
            top: frameInset,
            bottom: frameInset,
            width: frameThickness,
            backgroundColor: shared.palette.cinnabar,
            boxShadow: visualStyle.p4.shadows.badge,
            opacity: entryProgress * 0.96,
            filter: `blur(${(1 - entryProgress) * callout.textBlurPx * 0.7}px)`,
            willChange: entryProgress < 1 ? "opacity, filter" : undefined
          }}/>
          {[
            { top: frameInset, width: topCapLength },
            { top: rectangle.height - frameInset - frameThickness, width: bottomCapLength }
          ].map((cap) => <div key={cap.top} style={{
            position: "absolute",
            ...edgeStyle,
            top: cap.top,
            width: cap.width,
            height: frameThickness,
            backgroundColor: shared.palette.cinnabar,
            boxShadow: visualStyle.p4.shadows.badge,
            opacity: entryProgress * 0.96,
            filter: `blur(${(1 - entryProgress) * callout.textBlurPx * 0.7}px)`,
            willChange: entryProgress < 1 ? "opacity, filter" : undefined
          }}/>) }
          <div style={{
            position: "relative",
            height: "100%",
            boxSizing: "border-box",
            padding: `${layout.paddingBlock}px ${layout.paddingInline + frameInset}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: isRight ? "flex-end" : "flex-start",
            textAlign: isRight ? "right" : "left",
            textShadow: visualStyle.p4.shadows.personText
          }}>
            {layout.blocks.map((block, index) => <div key={`${block.heading}-${index}`} style={{
              width: "100%"
            }}>
              {index > 0 ? <div style={{
                height: layout.dividerThickness,
                margin: `${layout.blockGap}px 0`,
                backgroundColor: shared.palette.cinnabar,
                opacity: entryProgress * 0.72,
                filter: `blur(${(1 - entryProgress) * callout.textBlurPx * 0.7}px)`
              }}/> : null}
              <div style={{
                height: layout.headingLineHeightPx,
                color: shared.palette.textPrimary,
                ...layout.headingTypography,
                lineHeight: layout.headingTypography.lineHeight,
                whiteSpace: "nowrap"
              }}>{inkText(block.heading)}</div>
              <div style={{
                marginTop: layout.blockGap,
                color: shared.palette.textSecondary,
                ...layout.bodyTypography,
                lineHeight: layout.bodyTypography.lineHeight,
                letterSpacing: 1,
                whiteSpace: "nowrap"
              }}>{(block.bodyLines ?? [block.body]).map((line, lineIndex) => <div
                key={`${lineIndex}-${line}`}
                style={{ height: layout.bodyLineHeightPx }}
              >{inkText(line)}</div>)}</div>
            </div>)}
          </div>
        </div>
      </Plane>;
    }
  }

  const glyphCount = Math.max(1, layout.characterCount);
  const lineStartIndices = [];
  let glyphOffset = 0;
  for (const line of layout.lines) {
    lineStartIndices.push(glyphOffset);
    glyphOffset += [...line].length;
  }
  const citationProgress = layout.hasCitation
    ? (() => {
        const citationStartFrame = Math.min(
          revealFrame + revealDurationFrames - 1,
          revealFrame + callout.citationDelayFrames
        );
        return interpolate(entrySampleFrame, [citationStartFrame, revealFrame + revealDurationFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: calloutEasing(CALLOUT_EASING.calloutEnter)
        });
      })()
    : null;
  return <Plane style={{ pointerEvents: "none" }}>
    <Plane style={{
      backgroundColor: shared.palette.black,
      opacity: backdropOpacity
    }}/>
    <div style={{
      position: "absolute",
      left: rectangle.x,
      top: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
      boxSizing: "border-box",
      padding: `${layout.paddingBlock}px ${layout.paddingInline}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      color: shared.palette.textPrimary,
      background: "transparent",
      border: "none",
      boxShadow: "none",
      ...layout.typography,
      lineHeight: layout.typography.lineHeight,
      textShadow: visualStyle.p4.shadows.contextText
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start"
      }}>
        {layout.lines.map((line, index) => <div key={`${index}-${line}`} style={{
          width: "100%",
          height: layout.lineHeightPx,
          whiteSpace: "nowrap"
        }}>{line
          ? [...line].map((glyph, glyphIndex) => {
              const progress = glyphProgressFor(lineStartIndices[index] + glyphIndex, glyphCount);
              return <span key={`${glyphIndex}-${glyph}`} style={{
                opacity: progress,
                filter: `blur(${(1 - progress) * callout.textBlurPx}px)`,
                willChange: progress < 1 ? "opacity, filter" : undefined
              }}>{glyph}</span>;
            })
          : "\u00a0"}</div>)}
      </div>
      {layout.hasCitation ? <div style={{
        alignSelf: "flex-end",
        height: layout.citationLineHeightPx,
        marginTop: layout.citationGap,
        color: shared.palette.textSecondary,
        ...layout.citationTypography,
        lineHeight: layout.citationTypography.lineHeight,
        textAlign: "right",
        whiteSpace: "nowrap",
        opacity: citationProgress * callout.citationOpacity,
        filter: `blur(${(1 - citationProgress) * callout.textBlurPx * 0.55}px)`,
        textShadow: visualStyle.p4.shadows.citationText,
        willChange: citationProgress < 1 ? "opacity, filter" : undefined
      }}>{layout.citationDisplayText}</div> : null}
    </div>
  </Plane>;
};

export const CalloutGroupOverlay = ({ callouts, frame }) => {
  if (!Array.isArray(callouts) || callouts.length < 1 || callouts.length > 2) {
    throw new Error("P4 全画幅解说框显示组必须包含一至两个题签");
  }
  return <Plane>
    {callouts.map((callout) => <Callout
      key={`${callout.sourceRequestId}-${callout.sourceCalloutIndex}-${callout.sourcePersonIndex ?? "all"}`}
      callout={callout}
      frame={frame}
    />)}
  </Plane>;
};
