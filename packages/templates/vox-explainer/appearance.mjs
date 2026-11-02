// Fixed carrier and typography colors; objects keep their own material/role colors.
export const SURFACE_PALETTE = Object.freeze({background: '#e7dfce', paper: '#f7f1e3', ink: '#30372f'});

export function createAppearance({palette = {}} = {}) {
  const font = (family, file, weight, format) => ({family, file, publicPath: file, weight: String(weight), style: 'normal', format});
  const base = 'packages/templates/vox-explainer/fonts/';
  return {
    source: 'vox-explainer', art: 'editorial-cutout', tone: 'neutral',
    palette: {...palette, ...SURFACE_PALETTE},
    fonts: {
      body: font('VoxBody', base + 'NotoSansSC-Medium.ttf', 500, 'truetype'),
      title: font('VoxTitle', base + 'NotoSansCJKsc-Black.otf', 900, 'opentype')
    }
  };
}

// The shared carrier is independent of object colors and remains visible around the scene.
// Static SVG marks avoid a full-frame turbulence filter at playback time.
export function stageBackground() {
  const palette = SURFACE_PALETTE;
  const marks = Array.from({length: 28}, (_, i) => {
    const x = (i * 53 + 11) % 192, y = (i * 71 + 23) % 192;
    return `<path d="M${x} ${y}h${i % 3 + 1}"/>`;
  }).join('');
  const texture = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><g stroke="${palette.ink}" stroke-opacity=".055">${marks}</g></svg>`;
  return `radial-gradient(ellipse at 50% 38%, ${palette.paper}99, ${palette.background}00 74%), url("data:image/svg+xml,${encodeURIComponent(texture)}")`;
}
