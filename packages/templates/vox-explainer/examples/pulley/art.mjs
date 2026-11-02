const bolt=(x,y,r=6)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="url(#iron)" stroke="#343b37" stroke-width="2"/><path d="M${x-r*.5} ${y}h${r}" stroke="#a6b0a4" stroke-width="2"/>`;
const beam=(x,y,w)=>`<g><path d="M${x} ${y}l17 -14h${w}v42l-17 18Z" fill="#68543b" stroke="#403d31" stroke-width="3"/><path d="M${x} ${y}h${w}v48H${x}Z" fill="url(#wood)" stroke="#403d31" stroke-width="3"/>${Array.from({length:7},(_,i)=>`<path d="M${x+5} ${y+6+i*6}q${w*.23} ${i%2?5:-4} ${w*.48} 1t${w*.49} -1" fill="none" stroke="${i%2?'#d3b57f':'#695437'}" stroke-width="1.4" opacity=".6"/>`).join('')}${[x+45,x+w-45].map(xx=>`<path d="M${xx-10} ${y}v48h22v-48" fill="url(#iron)" stroke="#343b37" stroke-width="2"/>${bolt(xx,y+10,4)}${bolt(xx,y+37,4)}`).join('')}</g>`;
const wheel=(id,x,y)=>`<g id="${id}" transform="translate(${x} ${y})"><circle r="66" cy="3" fill="#373f3a"/><g id="${id}-spin"><circle r="61" fill="url(#wheelwood)" stroke="#3b433a" stroke-width="7"/><circle r="52" fill="#d5bc8b" stroke="#8c805c" stroke-width="2"/><circle r="43" fill="#687469"/>${Array.from({length:6},(_,i)=>`<g transform="rotate(${i*60})"><path d="M-10 -10L-7 -50Q0 -55 7 -50L10 -10Z" fill="url(#wood)" stroke="#574d3c" stroke-width="2"/>${bolt(0,-48,3)}</g>`).join('')}<circle r="16" fill="url(#iron)" stroke="#394039" stroke-width="3"/><circle r="7" fill="#b0b29f"/><path d="M-4 -3l8 6" stroke="#3e4740" stroke-width="2"/></g><path d="M-53 -31A61 61 0 0 1 40 -47" fill="none" stroke="#d9d0af" stroke-width="3" opacity=".65"/></g>`;
const ropes=id=>`<path id="${id}-edge" fill="none" stroke="#3b3d32" stroke-width="14" stroke-linecap="round"/><path id="${id}" fill="none" stroke="#c7ad72" stroke-width="9" stroke-linecap="round"/><path id="${id}-twist" fill="none" stroke="#efe2b0" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>`;
const arrow=(id,color)=>`<path id="${id}" stroke="${color}" stroke-width="9" fill="none" marker-end="url(#${color==='#a94d34'?'redhead':'bluehead'})"/>`;
const bucket=id=>`<g id="${id}"><image href="asset:AR001" x="-83" y="-10" width="166" height="249"/></g>`;
export const markup=`<style>:host{background:var(--background)}svg{width:100%;height:100%;display:block}text{fill:var(--ink);font-family:var(--font-body);font-weight:500}.title{font-family:var(--font-title);font-weight:900;font-size:62px}.label{font-size:46px}.measure{font-size:46px;font-weight:700}.small{font-size:38px}</style><svg id="canvas" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d9bd86"/><stop offset=".3" stop-color="#b89761"/><stop offset=".78" stop-color="#937246"/><stop offset="1" stop-color="#6f5637"/></linearGradient>
<radialGradient id="wheelwood" cx=".3" cy=".2"><stop stop-color="#d9c18e"/><stop offset="1" stop-color="#89754b"/></radialGradient>
<linearGradient id="iron" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8f998d"/><stop offset=".2" stop-color="#58665e"/><stop offset=".6" stop-color="#404d47"/><stop offset="1" stop-color="#293b35"/></linearGradient>
<marker id="redhead" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto"><path d="M0 0L3 2L0 4Z" fill="#a94d34"/></marker><marker id="bluehead" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto"><path d="M0 0L3 2L0 4Z" fill="#486d72"/></marker>
</defs>

<text id="headline" class="title" x="100" y="105">同样拉绳，桶为什么升得少？</text>

${beam(260,178,550)}${beam(1060,178,550)}
<g id="fixed-mount"><path d="M520 226v75h30v-75" fill="url(#iron)" stroke="#35443b" stroke-width="3"/>${bolt(535,241,7)}</g>
<g id="redirect-mount"><path d="M1315 226v75h30v-75" fill="url(#iron)" stroke="#35443b" stroke-width="3"/>${bolt(1330,241,7)}</g>
<path d="M1124 224v25q11 18 22 0v-25" fill="none" stroke="#485b4f" stroke-width="8"/>
${wheel('fixed',535,300)}${wheel('redirect',1330,300)}${wheel('moving',1200,500)}
${ropes('left-rope')}${ropes('right-rope')}
<g id="moving-yoke"><path d="M1181 492v48q0 21 19 21q19 0 19-21v-48" fill="none" stroke="#384b41" stroke-width="11"/><path d="M1181 492v48q0 21 19 21q19 0 19-21v-48" fill="none" stroke="#8b9987" stroke-width="4"/><path d="M1200 560v13q0 10 8 10" fill="none" stroke="#405247" stroke-width="7"/></g>
${bucket('bucket-left')}${bucket('bucket-right')}
<g id="handles"><g id="handle-left"><rect x="-23" y="-5" width="46" height="21" rx="7" fill="url(#wood)" stroke="#504c37" stroke-width="3"/><path d="M-4 -8v26h8V-8" fill="#8d7751"/></g><g id="handle-right"><rect x="-23" y="-5" width="46" height="21" rx="7" fill="url(#wood)" stroke="#504c37" stroke-width="3"/><path d="M-4 -8v26h8V-8" fill="#8d7751"/></g></g>
<text class="label" x="260" y="285">定滑轮</text><text id="moving-name" class="label" x="940" y="500">动滑轮</text>
<g id="motion-measures">
<path id="left-rise" stroke="#486d72" stroke-width="4" fill="none"/><path id="right-rise" stroke="#486d72" stroke-width="4" fill="none"/>
<path id="left-pull" stroke="#a94d34" stroke-width="4" fill="none"/><path id="right-pull" stroke="#a94d34" stroke-width="4" fill="none"/>
<text id="left-rise-text" class="measure" x="180" y="585"></text><text id="right-rise-text" class="measure" x="900" y="585"></text>
<text id="left-pull-text" class="measure" x="705" y="490"></text><text id="right-pull-text" class="measure" x="1515" y="490"></text>
<text class="small" x="180" y="630">桶上升</text><text class="small" x="900" y="630">桶上升</text><text class="small" x="705" y="535">拉绳</text><text class="small" x="1515" y="535">拉绳</text>
</g>
<g id="support" opacity="0"><path id="left-support" fill="none" stroke="#486d72" stroke-width="13" stroke-linecap="round"/><path id="support-a" fill="none" stroke="#486d72" stroke-width="13" stroke-linecap="round"/><path id="support-b" fill="none" stroke="#a94d34" stroke-width="13" stroke-linecap="round"/>
<text class="measure" x="270" y="725">一段承重</text><text class="measure" x="1250" y="760">两段承重</text></g>
<g id="forces" opacity="0">${arrow('force-left','#486d72')}${arrow('force-a','#486d72')}${arrow('force-b','#a94d34')}
<text class="measure" x="165" y="450">全部重量</text><text class="measure" x="970" y="560">一半</text><text class="measure" x="1285" y="560">一半</text><text class="measure" x="1500" y="670">拉力减半</text></g>
<g id="conclusion" opacity="0"><text x="100" y="760" class="measure">省力的代价，藏在多走的绳长里。</text></g>
</svg>`;
