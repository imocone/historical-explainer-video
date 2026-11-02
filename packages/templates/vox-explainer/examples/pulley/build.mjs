import {assetFile} from '../../../../runtime-config.mjs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {markup} from './art.mjs';


const root = path.dirname(fileURLToPath(import.meta.url));
const system = path.resolve(root, '../../../../..');
const action = process.argv[2] ?? 'build';
const actions = ['build', 'author', 'preview', 'render', 'stills', 'check'];
if (!actions.includes(action)) throw new Error(`Unknown action: ${action}`);
const output = path.resolve(process.argv[3] ?? path.join(system, 'tmp/vox-pulley-demo'));
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
const animation = source;
const treatment = {templateId: 'vox-explainer',
  objective: '以相同拉绳距离与相同上升高度的两次对照，解释动滑轮的两段承重和力与距离的交换。',
  continuity: {period: '理想物理示意', location: '纸面上的提水装置',
    subjects: ['同一水桶', '承重绳段'], props: ['定滑轮', '动滑轮', '拉绳握柄']},
  // This existing film owns its colors; they are not template defaults.
  appearance: createAppearance({palette: {background: '#e7dfce', ink: '#30372f', paper: '#f7f1e3',
    accent: '#ad513b', secondary: '#496b73', moss: '#737b57', stone: '#898b81',
    muted: '#a5a68e', contour: '#595c4b'}}),
  moments: timing.clips.map((clip, i) => ({id: `M${String(i + 1).padStart(3, '0')}`,
    purpose: clip.text, sourceRefs: [`C${String(cueStarts[i]).padStart(3, '0')}`]})),
  scene: {markup, animation}, assetRequests: [{requestId:'AR001',purpose:'同一水桶作为两次对照中的相同负载，材质保持完整，整件随真实位移状态移动。',sourceRefs:['C001'],mustNotInvent:['不增加额外装置或历史身份'],transparentBackground:true,visualBrief:{composition:'完整正面木桶、提手及顶部吊眼；精细材质沿共同画风。无绳、滑轮或环境；活动机构由代码另绘，按吊眼位置连接。'},exactTexts:[]}]};
const assetRefs=[{requestId:'AR001',kind:'explainer-visual',mediaType:'image',mimeType:'image/png',file:'assets/bucket.png',width:1024,height:1536,explainerPlacement:{contentBounds:{x:0,y:0,width:1,height:1}}}];
await validateSchema(path.join(system, 'contracts/vox-explainer-treatment.schema.json'), treatment, '动滑轮独立样片');
const errors = validate({result: treatment, context: {cues, sourceAssets: []}});
assert.deepEqual(errors, []);
const fps = 60, durationInFrames = Math.round(timing.duration * fps);
const actionTimings = resolveCueBindingsToFrames({cues, segmentStartMs: 0,
  segmentEndMs: Math.round(timing.duration * 1000), fps,
  bindingSet: {items: treatment.moments.map((moment, i) => ({target: moment.id,
    action: 'advance-explainer', cueId: cueStarts[i], edge: 'start'}))}});
const rendered = renderData({treatment, actionTimings, assetRefs, durationInFrames,
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
await copy(path.join(root, 'assets/bucket.png'), 'assets/bucket.png');
const segment = {id: 'pulley-motion-film', templateId: 'vox-explainer',
  visualStyle, durationInFrames, entranceLeadFrames: 0, runtimeTiming: {semanticFrameOffset: 0},
  assetRefs, renderData: rendered};
await writeFile(path.join(output, 'treatment.json'), JSON.stringify(treatment, null, 2));
await writeFile(path.join(output, 'cues.json'), JSON.stringify(cues, null, 2));
const data = {segment, cues, duration: timing.duration};
await writeFile(path.join(output, 'preview-data.json'), JSON.stringify(data));
const exec = promisify(execFile);
const cli = path.join(system, 'node_modules/hyperframes/bin/hyperframes.mjs');
if (action !== 'author') {
  await build({stdin:{contents:`import {mount} from ${JSON.stringify(path.join(root,'film.jsx'))}; mount(${JSON.stringify(data)});`,
    resolveDir:root,loader:'jsx'},outfile:path.join(projectDirectory,'film.js'),
    nodePaths:[path.join(system,'node_modules')],bundle:true,format:'iife',target:'chrome120',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await stop();
  await writeFile(path.join(projectDirectory,'hyperframes.json'),JSON.stringify({name:'pulley-motion-film',media:{autoProxy:false}}));
  await writeFile(path.join(projectDirectory,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>少一半力，多一倍路</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e7dfce}#pulley-film{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate}#picture,#captions{position:absolute;inset:0}#captions{z-index:5;pointer-events:none}
</style><body><div id="pulley-film" data-composition-id="pulley-film" data-no-timeline data-width="1920" data-height="1080" data-fps="60" data-duration="${timing.duration}"><div id="picture"></div><div id="captions"></div><audio id="narration" src="narration.wav" data-start="0" data-duration="${timing.duration}" data-track-index="1"></audio></div><script src="film.js" defer></script></body></html>`);
}
if (!['build', 'author'].includes(action)) {
  const commands = {
    preview:['preview',projectDirectory,'--background'],
    render:['render',projectDirectory,'--output',path.join(output,'pulley-film.mp4'),'--fps','60','--workers','1',
      '--low-memory-mode','--quality','standard','--crf','18','--video-frame-format','png','--experimental-fast-capture=false','--no-best-effort'],
    stills:['snapshot',projectDirectory,'--at',process.argv.slice(4).join(',') || '43.5','--no-end','--timeout','45000','--output',path.join(output,'review-stills')],
    check:['check',projectDirectory,'--at','3,6,11,19,26,33,40','--timeout','45000','--json']
  };
  console.log(`HyperFrames ${action} · ${timing.duration}s · 1920×1080 / 60fps`);
  const {stdout,stderr} = await exec(process.execPath,[cli,...commands[action]],{cwd:output,
    timeout:1800000,maxBuffer:8*1024*1024});
  await writeFile(path.join(output,`${action}.log`),stdout+'\n'+stderr);
  console.log(action === 'render' ? stdout.slice(-1400) : stdout);
}
console.log(JSON.stringify({projectDirectory, duration: timing.duration,
  moments: treatment.moments.length, captions: cues.length}));
