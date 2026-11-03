import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {assetFile} from '../../../../runtime-config.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const system=path.resolve(source,'../../../../..');
if(process.argv.length>3 || process.argv[2]?.startsWith('-')) throw new Error('用法: node build.mjs [输出目录]');
const root=path.resolve(process.argv[2]??path.join(system,'tmp/vox-supply-mg'));
if(root===source || root.startsWith(source+path.sep) || source.startsWith(root+path.sep))
 throw new Error('输出目录不能覆盖案例源码或其父目录');
for(const dir of ['assets/fonts','assets/sfx','compositions']) await fs.mkdir(path.join(root,dir),{recursive:true});
for(const name of ['narration.wav','music-original.mp3'])
 await fs.copyFile(assetFile(path.join(source,'assets',name)),path.join(root,'assets',name));
for(const [from,to] of [['NotoSansSC-Medium.ttf','sans.ttf'],['NotoSansCJKsc-Black.otf','black.otf'],['Noto-OFL.txt','OFL.txt']])
 await fs.copyFile(path.join(source,'../../fonts',from),path.join(root,'assets/fonts',to));
for(const name of ['wood-tap','thump','whoosh'])
 await fs.copyFile(path.join(system,'packages/features/sound-effects/library',name+'.wav'),path.join(root,'assets/sfx',name+'.wav'));
await fs.copyFile(path.join(system,'packages/features/sound-effects/lemo/LICENSE'),path.join(root,'assets/sfx-LICENSE.txt'));
await fs.copyFile(path.join(system,'node_modules/gsap/dist/gsap.min.js'),path.join(root,'assets/gsap.min.js'));
await fs.writeFile(path.join(root,'hyperframes.json'),JSON.stringify({media:{autoProxy:false}},null,2)+'\n');
await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'vox-supply-mg',private:true,scripts:{dev:'npx --yes hyperframes@0.8.223 preview',check:'npx --yes hyperframes@0.8.223 check'}},null,2)+'\n');
const data=JSON.parse(await fs.readFile(path.join(source,'timing.json'),'utf8'));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const audio=JSON.parse(await fs.readFile(path.join(source,'audio.json'),'utf8'));
const bedAttrs=Object.entries(audio.bed).map(([k,v])=>`${k}="${esc(JSON.stringify(v))}"`).join(' ');
const audioMarkup=`<audio id="mg-narration" src="assets/narration.wav" data-start="0" data-duration="${data.duration}" data-volume="1" data-track-index="3"></audio>
<audio id="mg-music" src="assets/music-original.mp3" data-start="0" data-duration="${data.duration}" data-volume="1" data-track-index="4" ${bedAttrs}></audio>
${audio.cues.map((c,i)=>`<audio id="mg-sfx-${i}" src="assets/sfx/${c.sound}.wav" data-start="${c.at}" data-duration="${c.duration}" data-volume="${c.gain}" data-track-index="5"></audio>`).join('\n')}`;
const caps=data.captions.map((c,i)=>`<div id="mg-caption-${i}" class="clip" data-start="${c.start}" data-duration="${c.end-c.start}" data-track-index="2"><span>${esc(c.text)}</span></div>`).join('\n');
await fs.writeFile(path.join(root,'compositions/story.html'),`<template><style>#root{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}#mg-canvas{position:absolute;inset:0;width:100%;height:100%}</style><div id="root" data-composition-id="mg-story" data-width="1920" data-height="1080" data-duration="${data.duration}"><canvas id="mg-canvas" width="1920" height="1080" data-layout-allow-overflow data-layout-allow-overlap></canvas></div><script src="assets/film.js"></script></template>`);
await fs.writeFile(path.join(root,'index.html'),`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>粮在后方，前线为何断粮 · 二维MG</title><script src="assets/gsap.min.js"></script><style>
@font-face{font-family:MG;src:url(assets/fonts/sans.ttf)}@font-face{font-family:MGBlack;src:url(assets/fonts/black.otf)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f1e8}#root{position:relative;width:100%;height:100%}.clip{position:absolute;inset:0}#mg-captions{position:absolute;inset:0;z-index:10;pointer-events:none}#mg-captions .clip{display:flex;align-items:flex-end;justify-content:center;padding-bottom:64px}#mg-captions span{font:42px MG;line-height:1.35;color:#203b43;background:#f4f1e8f5;padding:7px 20px;border-radius:0}
</style></head><body><div id="root" data-composition-id="mg-film" data-width="1920" data-height="1080" data-start="0" data-duration="${data.duration}" data-fps="60"><div id="mg-story" class="clip" data-composition-id="mg-story" data-composition-src="compositions/story.html" data-start="0" data-duration="${data.duration}" data-width="1920" data-height="1080" data-track-index="0" data-track-kind="graphics"></div><div id="mg-captions" data-track-kind="captions">${caps}</div>${audioMarkup}</div><script>window.__timelines['mg-film']=gsap.timeline({paused:true});</script></body></html>`);
await build({entryPoints:[path.join(source,'src/film.js')],outfile:path.join(root,'assets/film.js'),bundle:true,format:'iife',target:'chrome120',minify:false});
console.log(JSON.stringify({projectDirectory:root,duration:data.duration,chapters:data.scenes.length,captions:data.captions.length}));
