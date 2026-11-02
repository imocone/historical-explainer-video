import React from "react";
import { interpolate } from "../../../modules/render-video/runtime/motion-math.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { Plane, AssetMedia, fontFamily, useVisualStyle, createViewRenderer } from "../../../modules/render-video/runtime/scene-view.jsx";
import { DOCUMENTARY_OPENER_RENDER_POLICY as POLICY, documentaryOpenerTimelineForTreatment } from "../render-policy.mjs";
import { documentaryOpenerShots, GENERATED_HERO_REQUEST_ID } from "../selection.mjs";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const at = (t, a, b) => interpolate(t, [a, b], [0, 1], CLAMP);
const smooth = (p) => p * p * (3 - 2 * p);
const imageStyle = { position: "absolute", width: "100%", height: "100%", objectFit: "cover" };

const Still = ({ asset, style }) => <AssetMedia asset={asset} style={style}/>;

const Picture = ({ time, index, shot, asset, starts, imageBrightness }) => {
  const start = starts[index], last = index === starts.length - 1, next = starts[index + 1] ?? 99;
  const from = start - .50, end = next + .36;
  if (time < from || time > end) return null;
  const t = time - start;
  // V11's continuous approach, softened by removing its end-of-shot surge.
  const scale = Math.exp(last && t >= 0
    ? .08 + .028 * t + .242 * .5 * (1 - Math.exp(-t / .5))
    : .08 + .18 * t);
  const opacity = (index === 0 ? 1 : smooth(at(time, from, last ? start + .10 : start - .15)))
    * (last ? 1 : 1 - smooth(at(time, next - .28, next + .36)));
  const focus = last ? smooth(at(time, 3, 5.6)) : 1;
  const arriving = 1 - smooth(at(time, from, start + .10));
  const passing = last ? 0 : smooth(at(time, next - .15, next + .36));
  const blur = last ? 72 * (1 - focus) : (index === 0 ? 2 : 7) * arriving + 8 * passing;
  const origin = shot.focus ?? { x: .48, y: .26 };
  const drift = last ? 0 : interpolate(time, [from, end], [-10, 10], CLAMP) * (index % 2 ? 1 : -1);
  return <Plane style={{ zIndex: 20 - index, opacity }}>
    <Plane style={{ transformOrigin: `${origin.x * 100}% ${origin.y * 100}%`, transform: `translateX(${drift}px) scale(${scale})` }}>
      <Still asset={asset} style={{ ...imageStyle, filter: `blur(${blur / scale}px) brightness(${imageBrightness})` }}/>
    </Plane>
  </Plane>;
};

export const TemplateView = ({ segment, frame }) => {
  const { fps, width } = VIDEO_SPEC;
  const visual = useVisualStyle();
  const surface = visual.p4.surfaces.documentary;
  const titleFamily = fontFamily(visual.shared.fontFamilies.bookend);
  const { treatment } = segment;
  const timeline = documentaryOpenerTimelineForTreatment(treatment);
  const shots = documentaryOpenerShots(treatment);
  const sources = shots.map((shot) => {
    const requestId = shot.visualBrief ? GENERATED_HERO_REQUEST_ID : shot.id;
    const asset = segment.assetRefs.find((item) => item.requestId === requestId);
    if (asset?.kind !== "fullframe-image" && !(asset?.kind === "cinematic-video"
      && asset.mediaType === "video" && Number.isInteger(asset.freezeFrame) && asset.freezeFrame >= 0))
      throw new Error(`${shot.id}缺少所选完整场景交付`);
    return asset;
  });
  const starts = POLICY.shotStarts.map((value) => value / fps);
  // Only display an original work when the formal programme title explicitly names it.
  const sourceTitle = /^《([^》]+)》\s*[：:]\s*走进《([^》]+)》/u.exec(segment.seriesTitle)?.[2];
  const bookIn = smooth(at(frame, POLICY.bookStartFrame, POLICY.bookReadyFrame));
  const sourceOut = smooth(at(frame, POLICY.sourceExitStartFrame, POLICY.sourceExitEndFrame));
  const titleIn = sourceTitle
    ? smooth(at(frame, POLICY.titleStartFrame, POLICY.titleReadyFrame)) : bookIn;
  const light = 1 - smooth(at(frame, timeline.blackStartFrame, timeline.blackFrame));
  const centeredTitle = (text, opacity, maximum) => <Plane style={{
    zIndex: 32, justifyContent: "center", alignItems: "center", opacity,
    fontFamily: titleFamily, fontWeight: visual.shared.fonts.bookend.weight, color: surface.titleColor,
    textShadow: visual.p4.shadows.documentaryTitle
  }}>
    <div style={{ maxWidth: width - 240, textAlign: "center", lineHeight: 1.25,
      fontSize: Math.min(maximum, (width - 280) / Math.max(1, Array.from(text).length) / 1.08),
      letterSpacing: 4 }}>{text}</div>
  </Plane>;
  return <Plane style={{ background: "#000", overflow: "hidden" }}>
    <Plane style={{ opacity: light }}>
      <Still asset={frame < POLICY.shotStarts.at(-1) ? sources[0] : sources.at(-1)} style={{ ...imageStyle, filter: `blur(40px) brightness(${surface.backgroundBrightness})`, transform: "scale(1.15)" }}/>
      {shots.map((shot, index) => <Picture key={shot.id} time={frame / fps} index={index} shot={shot} asset={sources[index]} starts={starts} imageBrightness={surface.imageBrightness}/>)}
      <Plane style={{ zIndex: 30, background: `radial-gradient(ellipse at 50% 44%, transparent 25%, ${surface.vignetteColor} 100%)` }}/>
      <Plane style={{ zIndex: 31, opacity: bookIn, backgroundColor: surface.tintColor }}/>
      {sourceTitle && centeredTitle(sourceTitle, bookIn * (1 - sourceOut), 216)}
      {centeredTitle(treatment.episodeTitle, titleIn, 136)}
    </Plane>
  </Plane>;
};
export const createRenderer = createViewRenderer(TemplateView);
