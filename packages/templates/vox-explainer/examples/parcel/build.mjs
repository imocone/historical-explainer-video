import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {createExample} from './scene.mjs';
import {resolveMarkupAssets,runAnimation} from '../../scene.mjs';
import {createAppearance} from '../../appearance.mjs';

const source=path.dirname(fileURLToPath(import.meta.url));
const system=path.resolve(source,'../../../../..');
const output=path.resolve(process.argv[2]??path.join(system,'tmp/vox-parcel-example'));
// Preserve this example's authored colors without supplying a template-wide preset.
const example=createExample(),appearance=createAppearance({palette:{background:'#e7dfce',ink:'#30372f',
  paper:'#f7f1e3',accent:'#ad513b',secondary:'#496b73'}});
await mkdir(path.join(output,'assets'),{recursive:true});
await copyFile(path.join(source,'assets/parcel.png'),path.join(output,'assets/parcel.png'));
await copyFile(path.join(system,'node_modules/gsap/dist/gsap.min.js'),path.join(output,'assets/gsap.min.js'));
const fonts=[];
for(const [role,font] of Object.entries(appearance.fonts)){
  const file=path.basename(font.file);await copyFile(path.join(system,font.file),path.join(output,'assets',file));
  fonts.push(`@font-face{font-family:${font.family};src:url('assets/${file}');font-weight:${font.weight}}`);
}
const markup=resolveMarkupAssets(example.scene.markup,new Map([['AR001',{path:'assets/parcel.png'}]]),a=>a.path);
const runner=`const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML=${JSON.stringify(markup)};
const callbacks=[],select=s=>root.querySelector(s),cue=id=>(${JSON.stringify(example.cues)})[id],onFrame=fn=>callbacks.push(fn);
const parameters=['root','select','gsap','timeline','cue','onFrame','onCleanup','assets','width','height','fps','duration','spatial'];
const compileAnimation=source=>new Function(...parameters,source);
const timeline=gsap.timeline({paused:true});(${runAnimation.toString()})(${JSON.stringify(example.scene.animation)},{root,select,gsap,timeline,cue,onFrame});
const clock={time:0},paint=t=>callbacks.forEach(fn=>fn({time:t,frame:Math.round(t*30),fps:30}));timeline.to(clock,{time:${example.duration},duration:${example.duration},ease:'none',onUpdate:()=>paint(clock.time)});paint(0);window.__timelines=window.__timelines||{};window.__timelines['parcel-example']=timeline;`;
const vars=[...Object.entries(appearance.palette).map(([k,v])=>`--${k}:${v}`),`--font-body:${appearance.fonts.body.family}`,`--font-title:${appearance.fonts.title.family}`].join(';');
await writeFile(path.join(output,'index.html'),`<!doctype html><html><meta charset="utf-8"><style>${fonts.join('\n')}html,body{margin:0;width:100%;height:100%;overflow:hidden}#host{width:100%;height:100%;${vars}}</style><script src="assets/gsap.min.js"></script><div id="host" data-composition-id="parcel-example" data-duration="18" data-width="1920" data-height="1080" data-fps="30"></div><script>${runner}</script></html>`);
await writeFile(path.join(output,'hyperframes.json'),'{"media":{"autoProxy":false}}\n');
console.log(output);
