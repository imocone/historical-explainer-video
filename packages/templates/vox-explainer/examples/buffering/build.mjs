import {assetFile} from '../../../../runtime-config.mjs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {markup} from './art.mjs';
import {arrivals, schedule, playback} from './model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const system = path.resolve(root, '../../../../..');
const action = process.argv[2] ?? 'build';
const actions = ['build', 'author', 'preview', 'render', 'stills', 'check'];
if (!actions.includes(action)) throw new Error(`Unknown action: ${action}`);
const output = path.resolve(process.argv[3] ?? path.join(system, 'tmp/vox-buffering-demo'));
const load = relative => import(pathToFileURL(path.join(system, relative)));
const [{createAppearance}, {createRenderPolicy, renderData}, {validate}, {validateSchema},
  {resolveCueBindingsToFrames}, {withVisualFontPaths, visualFontEntries}, {build, stop}] = await Promise.all([
  'packages/templates/vox-explainer/appearance.mjs', 'packages/templates/vox-explainer/render-plan.mjs',
  'packages/templates/vox-explainer/validate.mjs', 'engine/runtime/schema.mjs',
  'packages/cue-boundaries.mjs', 'packages/visual-fonts.mjs', 'node_modules/esbuild/lib/main.js'
].map(load));
const timing = JSON.parse(await readFile(path.join(root, 'timing.json'), 'utf8'));
let nextCue = 1;
const cueStarts = [];
const cues = timing.clips.flatMap(clip => {
  cueStarts.push(nextCue);
  let cursor = clip.start;
  const weight = clip.captions.reduce((sum, text) => sum + text.length + 1.4, 0);
  return clip.captions.map(text => {
    const startMs = Math.round(cursor * 1000);
    cursor += (text.length + 1.4) / weight * clip.voiceDuration;
    return {id: nextCue++, text, startMs, endMs: Math.round(cursor * 1000)};
  });
});
const source = await readFile(path.join(root, 'animation.js'), 'utf8');
const animation = source.replace('__TIMING__', JSON.stringify(timing))
  .replace('__ARRIVALS__', JSON.stringify(arrivals))
  .replace('__SCHEDULE__', schedule.toString())
  .replace('__PLAYBACK__', playback.toString());
const treatment = {templateId: 'vox-explainer',
  objective: '用卡顿、拆时、倒回、储存和同源对照，解释缓冲如何吸收短期到达波动以及等待代价。',
  continuity: {period: '当代概念演示', location: '纸面电影与时间空间',
    subjects: ['骑行者', '分批到达的视频时间片'], props: ['播放器', '缓冲胶片']},
  // This existing film owns its colors; they are not template defaults.
  appearance: createAppearance({palette: {background: '#e7dfce', ink: '#30372f', paper: '#f7f1e3',
    accent: '#ad513b', secondary: '#496b73', moss: '#737b57', stone: '#898b81',
    muted: '#a5a68e', contour: '#595c4b'}}),
  moments: timing.clips.map((clip, i) => ({id: `M${String(i + 1).padStart(3, '0')}`,
    purpose: clip.text, sourceRefs: [`C${String(cueStarts[i]).padStart(3, '0')}`]})),
  scene: {markup, animation}, assetRequests: []};
await validateSchema(path.join(system, 'contracts/vox-explainer-treatment.schema.json'), treatment, '缓冲样片');
const errors = validate({result: treatment, context: {cues, sourceAssets: []}});
assert.deepEqual(errors, []);
assert(playback(2.5, 0).stalled);
assert.equal(playback(2.5, 2).stalled, false);
for (let t = 2; t <= 14; t += .01) assert.equal(playback(t, 2).stalled, false);
const fps = 60, durationInFrames = Math.round(timing.duration * fps);
const actionTimings = resolveCueBindingsToFrames({cues, segmentStartMs: 0,
  segmentEndMs: Math.round(timing.duration * 1000), fps,
  bindingSet: {items: treatment.moments.map((moment, i) => ({target: moment.id,
    action: 'advance-explainer', cueId: cueStarts[i], edge: 'start'}))}});
const rendered = renderData({treatment, actionTimings, assetRefs: [], durationInFrames,
  policy: createRenderPolicy({width: 1920, height: 1080, fps})});
const tokens = JSON.parse(await readFile(path.join(system, 'visuals/modern-editorial/render/tokens.json'), 'utf8'));
const visualStyle = withVisualFontPaths(tokens, 'modern-editorial');
const subtitle = tokens.p4.subtitle.font;
visualStyle.p4.subtitle = {...visualStyle.p4.subtitle, fontName: subtitle.family,
  fontPublicPath: `visuals/modern-editorial/${subtitle.file}`, fontWeight: subtitle.weight,
  fontFormat: subtitle.format, fontStyle: subtitle.style};
const projectDirectory = path.join(output, 'project');
const copy = async (source, relative) => {
  const target = path.join(projectDirectory, relative);
  await mkdir(path.dirname(target), {recursive: true});
  await cp(source, target);
};
await mkdir(projectDirectory, {recursive: true});
for (const file of rendered.resourceFiles) await copy(path.join(system, file), file);
for (const [, entry] of visualFontEntries(tokens))
  await copy(path.join(system, 'visuals/modern-editorial', entry.file), `visuals/modern-editorial/${entry.file}`);
await copy(path.join(system, 'visuals/modern-editorial', subtitle.file), visualStyle.p4.subtitle.fontPublicPath);
await copy(assetFile(path.join(root,'assets/narration.wav')), 'narration.wav');
const segment = {id: 'buffer-motion-film', templateId: 'vox-explainer',
  visualStyle, durationInFrames, entranceLeadFrames: 0, runtimeTiming: {semanticFrameOffset: 0},
  assetRefs: [], renderData: rendered};
await writeFile(path.join(output, 'treatment.json'), JSON.stringify(treatment, null, 2));
await writeFile(path.join(output, 'cues.json'), JSON.stringify(cues, null, 2));
const data = {segment, cues, duration: timing.duration};
await writeFile(path.join(output, 'preview-data.json'), JSON.stringify(data));
const exec = promisify(execFile);
const cli = path.join(system, 'node_modules/hyperframes/bin/hyperframes.mjs');
if (action !== 'author') {
  await build({stdin:{contents:`import {mount} from ${JSON.stringify(path.join(root,'film.jsx'))}; mount(${JSON.stringify(data)});`,
    resolveDir:root,loader:'jsx'},outfile:path.join(projectDirectory,'film.js'),
    bundle:true,format:'iife',target:'chrome120',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await stop();
  await writeFile(path.join(projectDirectory,'hyperframes.json'),JSON.stringify({name:'buffer-motion-film',media:{autoProxy:false}}));
  await writeFile(path.join(projectDirectory,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>流畅，可以攒出来</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e7dfce}#buffer-film{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate}#picture,#captions{position:absolute;inset:0}#captions{z-index:5;pointer-events:none}
</style><body><div id="buffer-film" data-composition-id="buffer-film" data-no-timeline data-width="1920" data-height="1080" data-fps="60" data-duration="${timing.duration}"><div id="picture"></div><div id="captions"></div><audio id="narration" src="narration.wav" data-start="0" data-duration="${timing.duration}" data-track-index="1"></audio></div><script src="film.js" defer></script></body></html>`);
}
if (!['build', 'author'].includes(action)) {
  const commands = {
    preview:['preview',projectDirectory,'--background'],
    render:['render',projectDirectory,'--output',path.join(output,'buffer-film.mp4'),'--fps','60','--workers','1',
      '--low-memory-mode','--quality','standard','--crf','18','--video-frame-format','png','--experimental-fast-capture=false','--no-best-effort'],
    stills:['snapshot',projectDirectory,'--at',process.argv.slice(4).join(',') || '43.5','--no-end','--timeout','45000','--output',path.join(output,'review-stills')],
    check:['check',projectDirectory,'--at','2.8,18.2,31.1,42.5,54.4,66.4,76.4','--timeout','45000','--json']
  };
  console.log(`HyperFrames ${action} · ${timing.duration}s · 1920×1080 / 60fps`);
  const {stdout,stderr} = await exec(process.execPath,[cli,...commands[action]],{cwd:output,
    timeout:1800000,maxBuffer:8*1024*1024});
  await writeFile(path.join(output,`${action}.log`),stdout+'\n'+stderr);
  console.log(action === 'render' ? stdout.slice(-1400) : stdout);
}
console.log(JSON.stringify({projectDirectory, duration: timing.duration,
  moments: treatment.moments.length, captions: cues.length}));
