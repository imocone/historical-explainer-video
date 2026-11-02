import {assetFile} from '../../../../runtime-config.mjs';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=path.dirname(fileURLToPath(import.meta.url));
const system=path.resolve(source,'../../../../..');
const dir=path.resolve(process.argv[2]??path.join(system,'tmp/vox-salary-research'));
await mkdir(path.join(dir,'assets'),{recursive:true});
for(const name of ['NotoSansSC-Medium.ttf','NotoSansCJKsc-Black.otf'])
 await copyFile(path.join(source,'../../fonts',name),path.join(dir,'assets',name));
await copyFile(assetFile(path.join(source,'assets/narration.wav')),path.join(dir,'assets/narration.wav'));
await copyFile(path.join(system,'node_modules/gsap/dist/gsap.min.js'),path.join(dir,'assets/gsap.min.js'));
const timing=JSON.parse(await readFile(path.join(source,'timing.json'),'utf8'));
const scene=await readFile(path.join(source,'research-scene.js'),'utf8');
await writeFile(path.join(dir,'hyperframes.json'),JSON.stringify({media:{autoProxy:false}}));
await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><title>平均工资，藏住了谁？</title><style>
@font-face{font-family:Film;src:url('assets/NotoSansSC-Medium.ttf');font-weight:500}
@font-face{font-family:Film;src:url('assets/NotoSansCJKsc-Black.otf');font-weight:900}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#202b35}#root{position:relative;width:1920px;height:1080px;overflow:hidden}svg{display:block;width:1920px;height:1080px;font-family:Film,sans-serif;font-weight:500}text{fill:#f1eadc;text-anchor:middle}.heavy{font-weight:900}.ink{fill:#253a40}.muted{fill:#abbab6}.mint{fill:#b2d2b8}.coral{fill:#f18060}
</style><script src="assets/gsap.min.js"></script></head><body><div id="root" data-composition-id="salary-film" data-start="0" data-width="1920" data-height="1080" data-duration="${timing.duration}" data-fps="30">
<svg viewBox="0 0 1920 1080" id="stage" role="img" aria-label="八个人的工资重新分配，筹码转成收入阶梯，并显示中位数">
<defs>
<radialGradient id="backlight"><stop stop-color="#46544d"/><stop offset="1" stop-color="#202b35"/></radialGradient>
<linearGradient id="floorlight" x2="0" y2="1"><stop stop-color="#4c5b56"/><stop offset="1" stop-color="#2a353a"/></linearGradient>
<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff3d6"/><stop offset="1" stop-color="#d9d0b9"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e8d89d" stop-opacity=".14"/><stop offset="1" stop-color="#e8d89d" stop-opacity="0"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
<clipPath id="picture"><rect width="1920" height="958"/></clipPath>
</defs>
<rect width="1920" height="1080" fill="#202b35"/><ellipse cx="1040" cy="480" rx="1140" ry="760" fill="url(#backlight)"/>
<g clip-path="url(#picture)">
<g id="camera"><g id="room">
<path d="M-200 660L940 410L2200 720L2200 1100H-200Z" fill="url(#floorlight)"/>
<g stroke="#b4c4b4" stroke-opacity=".09" stroke-width="2"><path d="M-80 825L1130 535M210 990L1370 600M790 1080L1760 700M210 690L1550 1080M700 570L2020 950"/></g>
<g fill="#283d43" stroke="#758779" stroke-width="5"><path d="M170 292L650 190V449L170 552Z"/><path d="M1240 196L1740 310V560L1240 446Z"/></g>
<g stroke="#758779" stroke-width="4" opacity=".7"><path d="M330 258V517M490 225V484M170 422L650 319M1407 234V484M1573 272V522M1240 322L1740 436"/></g>
<g fill="#e9d9a4" opacity=".08"><path d="M200 330L600 240V420L200 510Z"/><path d="M1270 237L1700 335V520L1270 420Z"/></g>
<g id="lamps"><path d="M600 0V148M1320 0V148" stroke="#81928b" stroke-width="5"/><path d="M550 145Q600 84 650 145Z M1270 145Q1320 84 1370 145Z" fill="#d9caab"/><path d="M550 148L350 730H850L650 148Z M1270 148L1070 730H1570L1370 148Z" fill="url(#beam)"/></g>
<g transform="translate(830 440)"><path d="M-155 20L65-25L203 8L-17 56Z" fill="#b6af95"/><path d="M-155 20V35L-17 72V56Z" fill="#6d796a"/><path d="M-17 56L203 8V24L-17 72Z" fill="#8a937c"/><path d="M-135 40V142M-2 73V175M180 32V131" stroke="#7c8c7b" stroke-width="15"/><path d="M-80 5L48-20L110-4L-18 23Z" fill="#e8ddbc"/><path d="M-66 4L45-15M-53 11L58-8" stroke="#8b947c" stroke-width="3"/><path d="M115-28V-76L170-62V-15Z" fill="#293c40" stroke="#758779" stroke-width="4"/></g>
</g>
<g id="chartGround"><ellipse cx="960" cy="878" rx="850" ry="70" fill="#122029" opacity=".38"/><path d="M160 850H1790" stroke="#83998b" stroke-width="3"/><g id="rulerTicks"/></g>
<g id="meanRule"><path d="M250 762H1790" stroke="#e7d59e" stroke-width="4" stroke-dasharray="15 13"/><text x="162" y="780" font-size="52" fill="#e7d59e">8,000</text></g>
<g id="medianRule"><path d="M250 806H1790" stroke="#b2d2b8" stroke-width="5"/><text x="162" y="825" font-size="52" class="mint">4,000</text></g>
<g id="stations"/><g id="trails"/><g id="cash"/>
</g>
<g id="report">
<ellipse cx="15" cy="355" rx="490" ry="25" fill="#0e1b24" opacity=".5" filter="url(#soft)"/>
<path d="M-465-310H410L480-240V310H-465Z" fill="url(#paper)"/>
<path d="M410-310V-240H480" fill="#b7b299"/>
<path d="M-465 270H480V310H-465Z" fill="#c7bea5" opacity=".65"/>
<text x="-360" y="-225" text-anchor="start" font-size="38" class="ink">工资报告</text><text x="310" y="-225" font-size="32" class="ink">月度 / 示例</text>
<path d="M-390-184H398" stroke="#6f7d70" stroke-width="3"/>
<text x="-5" y="-70" font-size="65" class="ink">平均月薪</text><text x="-8" y="120" font-size="194" class="ink heavy">8,000</text><text x="330" y="110" font-size="42" class="ink">元</text>
<path d="M-300 177H290" stroke="#8e9885" stroke-width="2"/><text x="0" y="236" font-size="41" class="ink">你会拿到多少？</text>
<g id="stamp" transform="translate(325 180) rotate(-18)"><circle r="86" fill="none" stroke="#c55d43" stroke-width="7"/><circle r="73" fill="none" stroke="#c55d43" stroke-width="2"/><text y="17" font-size="47" style="fill:#c55d43" class="heavy">平均</text></g>
</g>
<g id="typeLayer">
<g id="headline"><text id="title" x="960" y="146" font-size="92" class="heavy"/></g>
<g id="subhead"><text id="subtitle" x="960" y="235" font-size="56" class="muted"/></g>
<g id="meanBadge"><rect x="598" y="275" width="724" height="142" rx="71" fill="#eadbb6"/><text x="960" y="371" font-size="77" class="ink heavy">平均数，仍是8,000</text></g>
<g id="medianBadge"><path d="M630 319H1290V438H630Z" fill="#b2d2b8"/><text x="960" y="405" font-size="76" class="ink heavy">中位数 4,000</text><path id="medianLeaders" stroke="#b2d2b8" stroke-width="4" fill="none"/></g>
<g id="finalType"><text x="580" y="492" font-size="240" class="heavy mint">7<tspan font-size="130"> / </tspan>8</text><text x="1240" y="355" font-size="66">月薪只有</text><text x="1240" y="500" font-size="144" class="heavy coral">4,000<tspan font-size="68">元</tspan></text></g>
</g>
</g>
<rect x="0" y="958" width="1920" height="122" fill="#1b252e"/><text id="caption" x="960" y="1036" font-size="62"/>
</svg>
<audio id="narration" class="clip" data-start="0" data-duration="${timing.duration}" data-track-index="1" src="assets/narration.wav"></audio></div>
<script>window.FILM_TIMING=${JSON.stringify(timing)};${scene}</script></body></html>`);
console.log(`Built ${timing.duration.toFixed(2)}s salary film`);
