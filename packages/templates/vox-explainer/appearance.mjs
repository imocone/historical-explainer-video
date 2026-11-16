// Default paper surface; a treatment can select a different surface and ink.
export const SURFACE_PALETTE = Object.freeze({background: '#e7dfce', paper: '#f7f1e3', ink: '#30372f'});
export const resolveVoxPalette = palette => ({...SURFACE_PALETTE, ...palette});

export const VOX_TEXT_STYLES = `
  :host {
    color: var(--vox-text-ink, var(--ink));
    font-family: var(--font-body);
    font-weight: var(--font-body-weight);
    font-variant-numeric: tabular-nums;
  }
  :where(.vox-title, .vox-heading, .vox-copy, .vox-label, .vox-number, .vox-note) {
    margin: 0;
    color: var(--vox-text-ink, var(--ink));
    font-family: var(--font-body);
    font-weight: var(--font-body-weight);
    font-synthesis: none;
  }
  :where(:is(.vox-title, .vox-heading, .vox-copy, .vox-label, .vox-number, .vox-note):not([fill])) {
    fill: currentColor;
  }
  :where(.vox-title, .vox-heading, .vox-number) {
    font-family: var(--font-title);
    font-weight: var(--font-title-weight);
  }
  /* Keep an explicit SVG font-size while applying the rest of the text style. */
  :where(.vox-title:not([font-size])) { font-size: 92px; }
  :where(.vox-heading:not([font-size])) { font-size: 64px; }
  :where(.vox-copy:not([font-size])) { font-size: 52px; }
  :where(.vox-label:not([font-size])) { font-size: 46px; }
  :where(.vox-number:not([font-size])) { font-size: 88px; }
  :where(.vox-note:not([font-size])) { font-size: 40px; }
  :where(.vox-title) { line-height: 1.12; }
  :where(.vox-heading) { line-height: 1.18; }
  :where(.vox-copy) { line-height: 1.42; }
  :where(.vox-label) { line-height: 1.22; }
  :where(.vox-number) { line-height: 1.08; font-variant-numeric: tabular-nums; }
  :where(.vox-note) { line-height: 1.3; }
  :where(.vox-text-group) { display: grid; gap: 16px; }
  :where(text.vox-text-outline) {
    stroke: var(--vox-text-paper, var(--paper));
    stroke-width: .13em;
    stroke-linejoin: round;
    paint-order: stroke fill;
  }
`;

export function createAppearance({palette = {}} = {}) {
  const font = (family, file, weight, format) => ({family, file, publicPath: file, weight: String(weight), style: 'normal', format});
  const base = 'packages/templates/vox-explainer/fonts/';
  return {
    source: 'vox-explainer', art: 'editorial-cutout', tone: 'neutral',
    palette: resolveVoxPalette(palette),
    fonts: {
      body: font('VoxBody', base + 'NotoSansSC-Medium.ttf', 500, 'truetype'),
      title: font('VoxTitle', base + 'NotoSansCJKsc-Black.otf', 900, 'opentype')
    }
  };
}

// The paper texture belongs to the default surface.
export function stageBackground(palette) {
  if (palette.background.toLowerCase() !== SURFACE_PALETTE.background
    || palette.paper.toLowerCase() !== SURFACE_PALETTE.paper) return 'none';
  const marks = Array.from({length: 28}, (_, i) => {
    const x = (i * 53 + 11) % 192, y = (i * 71 + 23) % 192;
    return `<path d="M${x} ${y}h${i % 3 + 1}"/>`;
  }).join('');
  const texture = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><g stroke="${palette.ink}" stroke-opacity=".055">${marks}</g></svg>`;
  return `radial-gradient(ellipse at 50% 38%, ${palette.paper}99, ${palette.background}00 74%), url("data:image/svg+xml,${encodeURIComponent(texture)}")`;
}
