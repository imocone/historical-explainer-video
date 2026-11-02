import {assetFile} from '../../../../runtime-config.mjs';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAnimation} from '../../scene.mjs';
import {createTrafficModel} from './model.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const system=path.resolve(source,'../../../../..');
const dir=path.resolve(process.argv[2]??path.join(system,'tmp/vox-braess-research'));
await mkdir(path.join(dir,'assets'),{recursive:true});
for(const name of ['NotoSansSC-Medium.ttf','NotoSansCJKsc-Black.otf'])
 await copyFile(path.join(source,'../../fonts',name),path.join(dir,'assets',name));
await copyFile(assetFile(path.join(source,'assets/narration.wav')),path.join(dir,'assets/narration.wav'));
await copyFile(path.join(system,'node_modules/gsap/dist/gsap.min.js'),path.join(dir,'assets/gsap.min.js'));
const timing=JSON.parse(await readFile(path.join(source,'timing.json'),'utf8'));
const markup=await readFile(path.join(source,'scene.html'),'utf8');
const animation=`const createTrafficModel=${createTrafficModel.toString()};\n`+await readFile(path.join(source,'animation.js'),'utf8');
const scene={markup,animation};
await writeFile(path.join(dir,'scene.json'),JSON.stringify(scene));
await writeFile(path.join(dir,'hyperframes.json'),JSON.stringify({media:{autoProxy:false}}));
await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><title>一条近路，为什么让全城更堵？</title><style>
@font-face{font-family:Film;src:url('assets/NotoSansSC-Medium.ttf');font-weight:500}@font-face{font-family:Film;src:url('assets/NotoSansCJKsc-Black.otf');font-weight:900}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e9eade}#composition{position:relative;width:1920px;height:1080px}#host{width:1920px;height:1080px;--background:#e9eade;--ink:#243e46;--font-body:Film;--font-title:Film}#caption-layer{position:absolute;inset:0;width:1920px;height:1080px;pointer-events:none;font-family:Film,sans-serif;font-weight:500}
</style><script src="assets/gsap.min.js"></script></head><body><div id="composition" data-composition-id="braess-film" data-start="0" data-width="1920" data-height="1080" data-duration="${timing.duration}" data-fps="30"><div id="host"></div><svg id="caption-layer" viewBox="0 0 1920 1080"><rect y="938" width="1920" height="142" fill="#243e46"/><text id="caption" x="960" y="1028" text-anchor="middle" fill="#f5f0df" font-size="62"></text></svg><audio id="narration" class="clip" data-start="0" data-duration="${timing.duration}" data-track-index="1" src="assets/narration.wav"></audio></div>
<script>
const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML=${JSON.stringify(markup)};
const scene=${JSON.stringify(scene)},timing=${JSON.stringify(timing)},updates=[];
const select=selector=>{const nodes=[...root.querySelectorAll(selector)];if(!nodes.length)throw Error(selector);return nodes.length===1?nodes[0]:nodes;};
const anchors=Object.fromEntries(timing.clips.map(c=>[c.id,c.start]));
const timeline=gsap.timeline({paused:true});
const runAnimation=${runAnimation.toString()};
const parameters=['root','select','gsap','timeline','cue','onFrame','onCleanup','assets','width','height','fps','duration','spatial'];
const compileAnimation=source=>new Function(...parameters,'"use strict";\\n'+source);
document.fonts.ready.then(()=>{
runAnimation(scene.animation,{root,select,gsap,timeline,cue:id=>anchors[id],onFrame:fn=>updates.push(fn),onCleanup:()=>{},assets:new Map(),width:1920,height:1080,fps:30,duration:timing.duration,spatial:{}});
const caption=document.querySelector('#caption'),clock={time:0};
function paint(time){for(const update of updates)update({time,frame:Math.round(time*30),fps:30});const c=timing.clips.find(c=>time>=c.start&&time<c.start+c.duration+.2);if(!c){caption.textContent='';return;}
const parts=c.text.length>26?(c.text.match(/[^。？；]+[。？；]?/g)||[c.text]):[c.text];const weights=parts.map(p=>p.length+2),total=weights.reduce((a,b)=>a+b,0);let p=(time-c.start)/c.duration*total,index=0;for(let i=0;i<parts.length;i++){p-=weights[i];index=i;if(p<=0)break;}caption.textContent=parts[index];}
timeline.to(clock,{time:timing.duration,duration:timing.duration,ease:'none',onUpdate:()=>paint(clock.time)});paint(0);window.__timelines=window.__timelines||{};window.__timelines['braess-film']=timeline;
});</script></body></html>`);
console.log(`Built ${timing.duration.toFixed(2)}s, using unchanged vox-explainer runAnimation`);
