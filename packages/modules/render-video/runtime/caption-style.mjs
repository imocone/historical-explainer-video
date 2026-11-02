export const CAPTION_STYLE = Object.freeze({
  fontSize: 68,
  maxWidth: "24em",
  letterSpacing: 0.5,
  lineHeight: 1.28,
  outline: 4,
  shadowNearOffsetY: 1,
  shadowNearBlur: 2,
  shadowOffsetY: 2,
  shadowBlur: 5,
  containerInsetX: 120,
  marginV: 72,
  backingOpacity: 0,
  backingInsetX: 16,
  backingInsetY: 4
});

// Paint follows the visible scene; text, clocks and layout keep their shared owners.
export const captionSubtitleForScene = (subtitle, segment) => {
  const palette = segment?.renderData?.voxExplainer?.appearance?.palette;
  if (segment?.templateId !== 'vox-explainer' || !palette) return subtitle;
  return {...subtitle, primaryColor: palette.ink, outlineColor: palette.paper,
    shadowColor: 'transparent'};
};
