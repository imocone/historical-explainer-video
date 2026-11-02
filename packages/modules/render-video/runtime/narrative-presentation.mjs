import { narrativeVisibility } from "./narrative-transition.mjs";

const gamma = (id, exponent) => `<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${["R", "G", "B"].map(channel => `<feFunc${channel} type="gamma" exponent="${exponent}"/>`).join("")}</feComponentTransfer></filter>`;
const svg = (content, width = 0, height = 0) => `<svg width="${width}" height="${height}" viewBox="0 0 ${width || 1} ${height || 1}" style="position:absolute;pointer-events:none">${content}</svg>`;
export const narrativePresentation = ({ design, frame, durationInFrames, id }) => {
  const visibility = narrativeVisibility({ frame, durationInFrames, type: design.type });
  const result = { container: {}, outgoing: {}, incoming: {}, decoration: "" };
  if (design.type === "dissolve") {
    result.container.filter = `url(#${id}-display)`;
    result.outgoing = { opacity: visibility.outgoing, mixBlendMode: "plus-lighter", filter: `url(#${id}-light)` };
    result.incoming = { opacity: visibility.incoming, mixBlendMode: "plus-lighter", filter: `url(#${id}-light)` };
    result.decoration = svg(`<defs>${gamma(`${id}-display`, .5)}${gamma(`${id}-light`, 2)}</defs>`);
  } else if (design.type === "dip-to-black") {
    result.outgoing.opacity = visibility.outgoing;
    result.incoming.opacity = visibility.incoming;
  } else throw new Error(`未知正文转场: ${design.type}`);
  return result;
};
