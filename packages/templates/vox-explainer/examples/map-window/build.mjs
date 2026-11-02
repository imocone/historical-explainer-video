import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {validate} from '../../validate.mjs';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {prepareMapData} from '../../spatial/prepare-map.mjs';
import {createAppearance} from '../../appearance.mjs';
import {renderData, createRenderPolicy} from '../../render-plan.mjs';
import {withVisualFontPaths} from '../../../../visual-fonts.mjs';
import {scenePreviewProps} from '../../../../modules/render-video/runtime/scene-preview.mjs';
import {prepareRenderPublic} from '../../../../modules/render-video/runtime/public-files.mjs';
import {compileComposition} from '../../../../modules/render-video/runtime/compile.mjs';
import {snapshotComposition, renderComposition} from '../../../../modules/render-video/runtime/hyperframes.mjs';
import {resolveCueBindingsToFrames} from '../../../../cue-boundaries.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), systemRoot = path.resolve(here, '../../../../..');
const action = process.argv[2] ?? 'build';
if (!['build', 'stills', 'render'].includes(action)) throw new Error('使用build、stills或render');
const output = path.resolve(process.argv[3] ?? path.join(systemRoot, 'tmp/vox-map-window'));
await mkdir(output, {recursive: true});
const data = await prepareMapData({bounds: [[129.5, 31.8], [135, 35.5]],
  cacheDirectory: path.join(output, 'dem-cache'), zoom: 8,
  terrainAttribution: '地形：Mapzen Terrain Tiles · USGS SRTM/GMTED2010'});
const A = Object.fromEntries(await Promise.all(['transport', 'warship'].map(async kind => [kind,
  (await readFile(path.join(here, '../../spatial/assets', `unit-${kind}.svg`), 'utf8'))
    .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')])));
const seconds = [0, 6, 11, 17, 24, 30];
const purposes = ['建立补给与消耗', '建立水道连接', '呈现阻断与停顿', '地图让位展示库存变化', '回到整体通路', '收束为到达条件'];
const treatment = {templateId: 'vox-explainer', objective: '虚构推演：通路阻断使补给不能抵达，库存仍持续消耗。',
  continuity: {period: '近代船型的虚构教学场景', location: '丰后水道', subjects: ['运输队', '拦截舰队'], props: ['货箱', '仓库']},
  appearance: createAppearance({palette: {accent: '#ae523e', secondary: '#b78a38'}}),
  moments: purposes.map((purpose, i) => ({id: `M00${i + 1}`, purpose, sourceRefs: [`C00${i + 1}`]})),
  scene: {markup: await readFile(path.join(here, 'scene.html'), 'utf8'),
    animation: `const mapData=${JSON.stringify(data)};\nconst A=${JSON.stringify(A)};\n` + await readFile(path.join(here, 'animation.js'), 'utf8')},
  assetRequests: []};
const cues = purposes.map((text, i) => ({id: i + 1, startMs: seconds[i] * 1000, endMs: (seconds[i + 1] ?? 36) * 1000, text}));
const schema = JSON.parse(await readFile(path.join(systemRoot, 'contracts/vox-explainer-treatment.schema.json'), 'utf8'));
const check = new Ajv2020({allErrors: true}).compile(schema);
if (!check(treatment)) throw new Error(JSON.stringify(check.errors));
const errors = validate({result: treatment, context: {cues, sourceAssets: []}});
if (errors.length) throw new Error(errors.join('；'));
const bindings = {items: treatment.moments.map((m, i) => ({target: m.id,
  action: 'advance-explainer', cueId: cues[i].id, edge: 'start'}))};
const actionTimings = resolveCueBindingsToFrames({bindingSet: bindings, cues,
  segmentStartMs: cues[0].startMs, segmentEndMs: cues.at(-1).endMs, fps: 60});
await writeFile(path.join(output, 'treatment.json'), JSON.stringify(treatment));
await writeFile(path.join(output, 'cues.json'), JSON.stringify(cues, null, 2));
await writeFile(path.join(output, 'bindings.json'), JSON.stringify(bindings, null, 2));
const tokens = JSON.parse(await readFile(path.join(systemRoot, 'visuals/modern-editorial/render/tokens.json'), 'utf8'));
const visualStyle = withVisualFontPaths(tokens, 'modern-editorial'), font = tokens.p4.subtitle.font;
visualStyle.p4.subtitle = {...visualStyle.p4.subtitle, fontName: font.family,
  fontPublicPath: `visuals/modern-editorial/${font.file}`, fontWeight: font.weight, fontFormat: font.format, fontStyle: font.style};
const segment = {id: 'map-window-study', templateId: 'vox-explainer', visualStyle, durationInFrames: 2160,
  entranceLeadFrames: 0, runtimeTiming: {semanticFrameOffset: 0}, assetRefs: [],
  renderData: renderData({treatment, actionTimings, assetRefs: [], durationInFrames: 2160,
    policy: createRenderPolicy({width: 1920, height: 1080, fps: 60})})};
const props = scenePreviewProps({segment}); // Silent study, not a narrated production episode.
const projectDirectory = path.join(output, 'project');
await prepareRenderPublic({workspaceRoot: output, systemRoot, episode: output, renderPlan: props, publicDirectory: projectDirectory});
await compileComposition({props, projectDirectory});
if (action === 'stills') {
  const times = process.argv.slice(4).map(Number);
  await snapshotComposition({projectDirectory, frames: (times.length ? times : [3, 9, 15.8, 21.5, 34]).map(t => Math.round(t * 60)),
    outputDirectory: path.join(output, 'stills'), fps: 60});
}
if (action === 'render') await renderComposition({projectDirectory, output: path.join(output, 'map-window.mp4')});
console.log(JSON.stringify({projectDirectory, treatment: path.join(output, 'treatment.json'), durationSeconds: 36}));
