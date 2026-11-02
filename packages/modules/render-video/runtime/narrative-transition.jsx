import React, { useId } from "react";
import { Plane } from "./scene-view.jsx";
import { narrativePresentation } from "./narrative-presentation.mjs";

export const NarrativeTransition = ({ frame, design, durationInFrames, outgoing, incoming }) => {
  const id = `transition-${useId().replace(/[^a-z0-9_-]/gi, "")}`;
  const state = narrativePresentation({ frame, design, durationInFrames, id });
  return <Plane style={{ backgroundColor: "#000", isolation: "isolate" }}>
    <Plane style={{ isolation: "isolate", ...state.container }}>
      <Plane style={state.outgoing}>{outgoing}</Plane>
      <Plane style={state.incoming}>{incoming}</Plane>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }} dangerouslySetInnerHTML={{ __html: state.decoration }}/>
    </Plane>
  </Plane>;
};
