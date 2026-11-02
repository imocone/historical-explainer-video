import React from "react";
import { NarrativeTransition } from "../../../modules/render-video/runtime/narrative-transition.jsx";
import { Plane, AssetMedia, useVisualStyle } from "../../../modules/render-video/runtime/scene-view.jsx";
import { cameraStateAtRuntimeFrame } from "../camera/index.mjs";
import { EffectsLayer } from "../effects/render.jsx";
import { effectSampleFrame } from "../effects/runtime.mjs";

export const CameraLayer = ({ camera, asset }) => <div style={{
  position: "absolute",
  inset: 0,
  translate: `${camera.left * 100}% ${camera.top * 100}%`,
  scale: camera.scale,
  transformOrigin: "left top",
  willChange: "translate, scale"
}}>
  <AssetMedia asset={asset}/>
</div>;

export const Fullframe = ({ frame: fullframe, camera, sampleFrame, visualStyle }) => <Plane>
  <CameraLayer camera={camera} asset={fullframe.asset}/>
  <EffectsLayer effects={fullframe.effects} frame={sampleFrame} camera={camera} visualStyle={visualStyle}/>
</Plane>;

export const FullframeSequence = ({ frames, transitions, runtimeTiming, frame: localFrame }) => {
  const visualStyle = useVisualStyle();
  if (!frames.length) throw new Error("全画幅 renderer 缺少素材");
  const state = cameraStateAtRuntimeFrame({
    frames,
    transitions,
    localFrame,
    runtimeTiming,
    label: "P4 全画幅"
  });
  if (state.layers.length === 1) {
    return <Fullframe
      frame={frames[state.layers[0].index]}
      camera={state.layers[0].camera}
      sampleFrame={effectSampleFrame({ index: state.layers[0].index, localFrame, runtimeTiming })}
      visualStyle={visualStyle}
    />;
  }
  const [outgoing, incoming] = state.layers.map((layer) => <Fullframe
    key={frames[layer.index].requestId} frame={frames[layer.index]} camera={layer.camera}
    sampleFrame={effectSampleFrame({ index: layer.index, localFrame, runtimeTiming })} visualStyle={visualStyle}
  />);
  return <>
    <NarrativeTransition frame={localFrame - state.transition.localStartFrame} design={state.transition.design} durationInFrames={state.transition.design.durationInFrames}
      outgoing={outgoing} incoming={incoming} visualStyle={visualStyle}/>
  </>;
};
