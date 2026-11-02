import {assetFile} from '../../../../runtime-config.mjs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFile, mkdir, cp} from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const system = path.resolve(here, '../../../../..');
const action = process.argv[2] ?? 'build';
if (!['build', 'stills', 'render'].includes(action)) throw new Error(`Unknown action: ${action}`);
const output = path.resolve(process.argv[3] ?? path.join(system, 'tmp/vox-supply-demo'));
const projectDirectory = path.join(output, 'project');
const props = JSON.parse(await readFile(path.join(here, 'source.json'), 'utf8'));
props.segments[0].renderData.voxExplainer.scene = {
  markup: await readFile(path.join(here, 'scene.html'), 'utf8'),
  animation: await readFile(path.join(here, 'animation.js'), 'utf8')
};
const load = file => import(pathToFileURL(path.join(system, file)));
const {visualFontEntries} = await load('packages/visual-fonts.mjs');
const {compileComposition} = await load('packages/modules/render-video/runtime/compile.mjs');
const {snapshotComposition, renderComposition} = await load('packages/modules/render-video/runtime/hyperframes.mjs');
const copy = async (source, relative) => {
  const target = path.join(projectDirectory, relative);
  await mkdir(path.dirname(target), {recursive: true});
  await cp(source, target);
};
await mkdir(projectDirectory, {recursive: true});
const resources = new Set(props.segments[0].renderData.resourceFiles);
for (const [, font] of visualFontEntries(props.visualStyle)) resources.add(font.publicPath);
resources.add(props.visualStyle.p4.subtitle.fontPublicPath);
for (const file of resources) await copy(path.join(system, file), file);
for (const asset of props.segments[0].assetRefs) await copy(path.join(here, asset.file), asset.file);
await copy(assetFile(path.join(here,'assets/narration.wav')), 'narration.wav');
await compileComposition({props, projectDirectory});
if (action === 'stills') {
  const seconds = process.argv.slice(4).map(Number);
  if (!seconds.length || seconds.some(t => !Number.isFinite(t) || t < 0 || t * 1000 >= props.durationMs))
    throw new Error('stills需要本段范围内的秒数');
  await snapshotComposition({projectDirectory, frames: seconds.map(t => Math.round(t * props.fps)),
    outputDirectory: path.join(output, 'stills'), fps: props.fps});
}
if (action === 'render') await renderComposition({projectDirectory, output: path.join(output, 'supply.mp4')});
console.log(JSON.stringify({projectDirectory, durationMs: props.durationMs}));
