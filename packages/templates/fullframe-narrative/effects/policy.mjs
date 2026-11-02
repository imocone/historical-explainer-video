export const EFFECT_TYPES = Object.freeze(["snow", "foreground", "emotion", "fog", "dust", "soft-light", "grain"]);
export const EFFECT_INTENSITIES = Object.freeze(["low", "medium", "high"]);
export const FOREGROUND_FILES = Object.freeze({
  pine: "packages/templates/fullframe-narrative/effects/assets/pine.png",
  foliage: "packages/templates/fullframe-narrative/effects/assets/foliage.png"
});

// Author-selected strength controls density, drift, coverage and contrast.
export const EFFECT_STRENGTH = Object.freeze({
  low: { density: 0.55, size: 0.8, drift: 0.7, atmosphere: 0.6, edgeCoverage: 28, blur: 10, symbolSize: 46, focusShade: 0.18 },
  medium: { density: 1, size: 1, drift: 1, atmosphere: 1, edgeCoverage: 42, blur: 12, symbolSize: 54, focusShade: 0.30 },
  high: { density: 1.5, size: 1.2, drift: 1.3, atmosphere: 1.35, edgeCoverage: 52, blur: 16, symbolSize: 64, focusShade: 0.42 }
});
