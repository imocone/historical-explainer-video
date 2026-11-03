import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,stop} from 'esbuild';
import {assetFile} from '../../../../runtime-config.mjs';
import {makeFilm} from './src/scenes.mjs';

const source=path.dirname(fileURLToPath(import.meta.url));
const system=path.resolve(source,'../../../../..');
if(process.argv.length>3 || process.argv[2]?.startsWith('-')) throw new Error('用法: node build.mjs [输出目录]');
const dest=path.resolve(process.argv[2]??path.join(system,'tmp/vox-seven-kingdoms'));
if(dest===source || dest.startsWith(source+path.sep) || source.startsWith(dest+path.sep))
 throw new Error('输出目录不能覆盖案例源码或其父目录');
const D=JSON.parse(await readFile(path.join(source,'timing.json'),'utf8'));
const data=JSON.parse(await readFile(path.join(source,'assets/map-data.json'),'utf8'));
for(const dir of ['assets/fonts','compositions'])await mkdir(path.join(dest,dir),{recursive:true});
await copyFile(assetFile(path.join(source,'assets/mix.wav')),path.join(dest,'assets/mix.wav'));
await copyFile(path.join(system,'node_modules/gsap/dist/gsap.min.js'),path.join(dest,'assets/gsap.min.js'));
for(const name of ['NotoSansSC-Medium.ttf','NotoSansCJKsc-Black.otf','Noto-OFL.txt'])
 await copyFile(path.join(source,'../../fonts',name),path.join(dest,'assets/fonts',name));

const fontStyle=prefix=>`@font-face{font-family:VoxBody;src:url('${prefix}assets/fonts/NotoSansSC-Medium.ttf');font-weight:500;font-display:block}@font-face{font-family:VoxTitle;src:url('${prefix}assets/fonts/NotoSansCJKsc-Black.otf');font-weight:900;font-display:block}`;
const sceneStyle=`html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f1e8}#root{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}.body{font-family:VoxBody;font-weight:500}.title{font-family:VoxTitle;font-weight:900}text{font-kerning:normal}#scenes>g{opacity:0}`;
const bundle=async entry=>(await build({entryPoints:[path.join(source,entry)],bundle:true,format:'iife',globalName:'SevenWarm',write:false,target:'chrome120'})).outputFiles[0].text;
const animation=await bundle('src/animate.js');
await stop();
const film=makeFilm(D,data);
const mount=js=>`<script>${js}\nSevenWarm.mountFilm(${JSON.stringify(D)});</script>`;
const scene=`<!doctype html><html lang="zh-CN"><body><template><style>${fontStyle('')}${sceneStyle}</style><div id="root" data-composition-id="seven-warm-film" data-width="1920" data-height="1080" data-duration="${D.duration}">${film}</div>${mount(animation)}</template></body></html>`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>七国之乱 · 全 SVG</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f1e8}#root{width:100%;height:100%;position:relative}.clip{position:absolute;inset:0;width:100%;height:100%}</style><script src="assets/gsap.min.js"></script></head><body><div id="root" data-composition-id="seven-warm" data-width="1920" data-height="1080" data-duration="${D.duration}" data-fps="60"><div id="seven-warm-film" class="clip" data-composition-id="seven-warm-film" data-composition-src="compositions/film.html" data-start="0" data-duration="${D.duration}" data-width="1920" data-height="1080" data-track-kind="graphics" data-track-index="0"></div><audio id="narration-mix" src="assets/mix.wav" data-start="0" data-duration="${D.duration}" data-volume="1" data-track-index="1"></audio></div><script>window.__timelines=window.__timelines||{};window.__timelines['seven-warm']=gsap.timeline({paused:true}).to({progress:0},{progress:1,duration:${D.duration},ease:'none'});</script></body></html>`;
await writeFile(path.join(dest,'index.html'),html);
await writeFile(path.join(dest,'compositions/film.html'),scene);
await writeFile(path.join(dest,'hyperframes.json'),JSON.stringify({media:{autoProxy:false}},null,2)+'\n');
await writeFile(path.join(dest,'meta.json'),JSON.stringify({id:'vox-seven-kingdoms',name:'七国之乱 · 全 SVG'},null,2)+'\n');
await writeFile(path.join(dest,'package.json'),JSON.stringify({private:true,type:'module',scripts:{preview:'npx --yes hyperframes@0.8.223 preview --background'}},null,2)+'\n');
console.log(JSON.stringify({projectDirectory:dest,duration:D.duration}));
