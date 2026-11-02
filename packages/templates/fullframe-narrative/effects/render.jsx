import React from "react";
import { Plane, mediaUrl } from "../../../modules/render-video/runtime/scene-view.jsx";
import { seededRandom } from "../../../modules/render-video/runtime/motion-math.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { EFFECT_STRENGTH } from "./policy.mjs";
import { Atmosphere } from "./atmosphere.jsx";
import { effectOpacityAtFrame, projectedEffectAnchor } from "./runtime.mjs";

const W = 1920, H = 1080;
const wrap = (value, size) => ((value % size) + size) % size;
const Svg = ({ children, style }) => <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
  style={{ position: "absolute", width: "100%", height: "100%", ...style }}>{children}</svg>;
const sample = (effect, index, key) => seededRandom(`${effect.seed}/${index}/${key}`);

const Snow = ({ effect, seconds, strength: s }) => <Svg>
  {[{ count: 88, radius: 2, speed: 31, opacity: 0.52, blur: 0 },
    { count: 45, radius: 4, speed: 58, opacity: 0.75, blur: 0.5 },
    { count: 13, radius: 10, speed: 100, opacity: 0.48, blur: 3.4 }].map((plane, layer) =>
    <g key={layer} style={{ filter: plane.blur ? `blur(${plane.blur}px)` : undefined }}>
      {Array.from({ length: Math.round(plane.count * s.density) }, (_, i) => {
        const index = layer * 1000 + i;
        const wind = effect.direction === "left" ? -27 : effect.direction === "right" ? 27 : 6;
        const x = wrap(sample(effect, index, "x") * (W + 160)
          + seconds * wind * s.drift * (layer + 1) + Math.sin(seconds * 0.6 + i) * 18, W + 160) - 80;
        const y = wrap(sample(effect, index, "y") * (H + 160)
          + seconds * plane.speed * (0.7 + sample(effect, index, "speed")), H + 160) - 80;
        return <circle key={i} cx={x} cy={y} r={plane.radius * s.size * (0.55 + sample(effect, index, "radius"))}
          fill="#f1f4f5" opacity={plane.opacity * (0.5 + sample(effect, index, "opacity") * 0.5)}/>;
      })}
    </g>)}
</Svg>;

const Foreground = ({ effect, seconds, strength: s, camera }) => {
  const right = effect.side === "right";
  const { width, height } = VIDEO_SPEC;
  return <Plane style={{
    translate: `${camera.left * width * 1.32 + Math.sin(seconds * .45) * 8}px ${camera.top * height * .7}px`,
    scale: 1.02 + (camera.scale - 1) * .65, transformOrigin: "left top",
    filter: `blur(${s.blur}px) brightness(.68)`,
    maskImage: `linear-gradient(to ${right ? "left" : "right"}, black 0%, black ${s.edgeCoverage - 6}%, transparent ${s.edgeCoverage + 10}%, transparent 100%)`
  }}><img src={mediaUrl(effect.file)} style={{ width: "100%", height: "100%", objectFit: "fill",
    scale: right ? "-1 1" : undefined }}/></Plane>;
};

const Emotion = ({ effect, strength: s, camera, color }) => {
  const point = projectedEffectAnchor({ anchor: effect.anchor, camera });
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  if (effect.symbol === "focus") return <Plane style={{
    background: `radial-gradient(ellipse 25% 44% at ${point.x * 100}% ${point.y * 100}%, transparent 45%, rgba(20,24,27,${s.focusShade}) 100%)`
  }}/>;
  return <div style={{ position: "absolute", left: `${point.x * 100}%`, top: `${point.y * 100}%`,
    translate: "-50% -100%", width: s.symbolSize, height: s.symbolSize * 1.15,
    filter: "drop-shadow(0 1px 2px rgba(255,249,231,.8))" }}>
    <svg viewBox="0 0 84 96" width="100%" height="100%" fill="none" stroke={color} strokeWidth="4"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M27 26 C27 6 66 5 67 28 C68 46 45 41 45 62"/>
      <circle cx="45" cy="80" r="3" fill={color} stroke="none"/>
    </svg>
  </div>;
};

export const EffectsLayer = ({ effects = [], frame, camera, visualStyle }) => {
  const { fps } = VIDEO_SPEC;
  const color = visualStyle?.shared?.palette?.copper ?? visualStyle?.shared?.palette?.ink ?? "#b28848";
  return <Plane style={{ pointerEvents: "none", overflow: "hidden" }}>
    {effects.map((effect) => {
      const opacity = effectOpacityAtFrame({ effect, frame, fps });
      if (opacity <= 0) return null;
      const props = { effect, frame, camera, color, strength: EFFECT_STRENGTH[effect.intensity],
        seconds: (frame - effect.startFrame) / fps };
      const components = { snow: Snow, foreground: Foreground, emotion: Emotion, fog: Atmosphere,
        dust: Atmosphere, "soft-light": Atmosphere, grain: Atmosphere };
      const Component = components[effect.type];
      if (!Component) throw new Error(`未知全画幅效果: ${effect.type}`);
      return <Plane key={effect.index} style={{ opacity }}><Component {...props}/></Plane>;
    })}
  </Plane>;
};
