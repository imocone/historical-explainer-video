const map=spatial.createMapWindow({element:select('#map-slot'),data:mapData,box:{x:840,y:550,width:230,height:145,opacity:0},camera:{center:[132.05,33.35],zoom:5}});
const overlayStyle='<style>text{font-family:VoxBody;font-weight:500;fill:#30372f}.mapname{font-family:VoxTitle;font-weight:900;fill:#51534d;paint-order:stroke;stroke:#f1e9d6;stroke-width:4;stroke-linejoin:round}.geowater{fill:#416174;paint-order:stroke;stroke:#c6d7df;stroke-width:5;stroke-linejoin:round}.geolabel{fill:#485653;paint-order:stroke;stroke:#eff0e5;stroke-width:6;stroke-linejoin:round}.detail-label{font-family:VoxTitle;font-weight:900;paint-order:stroke;stroke:#d9e3e4;stroke-width:6;stroke-linejoin:round}</style>';
const $=s=>root.querySelector(s),clamp=x=>Math.min(1,Math.max(0,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)},lerp=(a,b,u)=>a+(b-a)*u;
const opacity=(id,x)=>$(id).style.opacity=x;

const P=c=>{return map.project(c)},L=c=>c.map((p,i)=>(i?'L':'M')+P(p).map(v=>v.toFixed(2)).join(' ')).join(' ');
const txt=(s,c,cls,size,dx=0,dy=0,color='')=>{const[x,y]=P(c);return `<text x="${x+dx}" y="${y+dy}" text-anchor="middle" class="${cls}" font-size="${size}" ${color?`style="fill:${color}"`:''}>${s}</text>`};
function ship(c,kind,col,scale){const[x,y]=P(c);return `<g transform="translate(${x} ${y})"><ellipse cx="0" cy="${30*scale}" rx="${83*scale}" ry="${8*scale}" fill="#53758a" opacity=".16"/><path d="M${-106*scale} ${32*scale}q${75*scale} ${13*scale} ${129*scale} ${-3*scale}m${-110*scale} ${14*scale}q${55*scale} ${8*scale} ${101*scale} ${-3*scale}" stroke="#7292a6" fill="none" stroke-width="1.7"/><g transform="scale(${scale}) translate(-85 -105)" style="--ink:#30372f;--paper:#f7f1e3">${A[kind].replaceAll('currentColor',col)}</g></g>`}
// Each event owns its related objects; offsets describe choreography within that event.
const T={intro:cue('M001'),map:cue('M002'),block:cue('M003'),stock:cue('M004'),return:cue('M005'),end:cue('M006')};
async function draw(t){
 const opening=smooth((t-T.map)/1.25),dock=smooth((t-T.stock)/1.2)*(1-smooth((t-T.return)/1.2)),close=smooth((t-T.end)/1.15);
 const w=lerp(230,1600,opening)-720*dock-990*close,h=lerp(145,690,opening)-135*dock-350*close;
 const x=lerp(840,160,opening)+730*dock+925*close,y=lerp(550,255,opening)+65*dock+5*close;
 const pad=15+9*clamp((w-540)/1060),iw=Math.round(w-2*pad),ih=Math.round(h-2*pad);
 opacity('#intro',1-smooth((t-(T.map-.35))/.8));
 opacity('#ledger',smooth((t-(T.stock+.65))/.6)*(1-smooth((t-(T.return-.55))/.5)));opacity('#ending',smooth((t-(T.end+.6))/.8));
 $('#intro-boat').style.transform=`translateX(${30*Math.sin(Math.max(0,Math.min(t-T.intro,T.map-T.intro-1))*.65)}px)`;
 for(let i=0;i<5;i++)opacity('#box-'+i,1-smooth((t-(T.stock+1.5+i*.8))/.6));
 const remaining=6-Array.from({length:5},(_,i)=>t>=T.stock+1.8+i*.8?1:0).reduce((a,b)=>a+b,0);$('#stock-count').textContent=String(remaining);
 $('#depletion').style.transformOrigin='146px 804px';$('#depletion').style.transform=`scaleX(${lerp(1,.12,smooth((t-(T.stock+1.5))/4.3))})`;
 let title='补给，必须不断送达',sub='货物从海上来，消耗在岸上发生。';
 if(t>=T.map&&t<T.block){title='一条水道，连接内海与外洋';sub='九州与四国之间，丰后水道连接内海与外洋。'}
 if(t>=T.block&&t<T.stock){title='水道被占住，运输队停下来';sub='运输队接近，拦截舰队占住通路。'}
 if(t>=T.stock&&t<T.return){title='地图上的停顿，带来岸上的消耗';sub='船没有抵达，仓库还在不断支出。'}
 if(t>=T.return&&t<T.end){title='狭窄水道，牵动整条补给线';sub='控制水道，影响的是两端之间的连接。'}
 if(t>=T.end){title='能不能抵达，比有多少货更关键';sub='一处通路的变化，改变整条链条。'}
 $('#title').textContent=title;$('#subline').textContent=sub;
 const focus=smooth((t-T.block)/2)*(1-smooth((t-(T.return+.2))/2));
 const center=[lerp(132.05,132.11,focus),lerp(33.35,33.08,focus)];
 const zoom=lerp(7.75,9.1,focus)+Math.log2(Math.min(iw/1548,ih/638));
 await map.seek({box:{x,y,width:w,height:h,opacity:smooth((t-(T.map-.1))/.28)},camera:{center,zoom}});
 const move=smooth((t-(T.block+1.2))/3),block=smooth((t-(T.block+3.2))/1.0),small=clamp((1000-iw)/500);
 const transport=[132.15,lerp(32.75,32.96,move)],guard=[lerp(132.36,132.10,smooth((t-(T.block+2))/2)),33.17];
 const route=[[132.15,32.68],[132.15,32.94],[132.12,33.16],[131.93,33.36],[131.99,33.62],[132.15,33.8]];
 const unitScale=lerp(.68,1.42,focus)*(1-.22*dock)*(1-.32*close);
 let svg=`<defs><marker id="map-arrow" markerWidth="15" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1L13 7L1 13L5 7Z" fill="#a77e36"/></marker></defs>`;
 svg+=`<path d="${L(route)}" fill="none" stroke="#f5dc9d" stroke-width="${lerp(27,17,small)}" stroke-opacity=".60" stroke-linecap="round"/><path d="${L(route)}" fill="none" stroke="#936d32" stroke-width="${lerp(3.6,2.8,small)}" stroke-dasharray="9 9" opacity="${1-.4*block}" marker-end="url(#map-arrow)"/>`;
 const nameSize=lerp(39,27,small),waterSize=lerp(26,19,small);
 svg+=`<g opacity="${1-focus}">`+txt('九 州',[131.35,33.08],'mapname',nameSize)+txt('四 国',[132.95,33.56],'mapname',nameSize)+`<g opacity="${1-close}">`+txt('濑户内海',[132.13,33.91],'geowater',waterSize)+txt('太平洋',[132.88,32.7],'geowater',waterSize)+txt('丰后水道',[132.12,33.19],'geolabel',lerp(30,21,small),lerp(110,70,small),10)+`</g></g>`;
 svg+=`<g opacity="${smooth((t-(T.block+.8))/.5)}">`+ship(transport,'transport','#b78a38',unitScale)+`</g>`;
 svg+=`<g opacity="${smooth((t-(T.block+2))/.5)}">`+ship(guard,'warship','#ae523e',unitScale*1.08)+`</g>`;
 svg+=`<path d="${L([[131.98,33.075],[132.29,33.095]])}" stroke="#a94f3b" stroke-width="${lerp(7,5,small)}" stroke-dasharray="15 9" opacity="${block}" fill="none"/>`;
 svg+=`<g opacity="${focus}">`+txt('运输队',transport,'detail-label',lerp(36,29,small),lerp(215,155,dock),48,'#71552b')+txt('拦截舰队',guard,'detail-label',lerp(36,29,small),0,lerp(-142,-115,dock),'#903e31')+`</g>`;
 svg+=`<g transform="translate(${lerp(37,26,small)} ${ih-lerp(54,39,small)})" opacity="${opening}"><path d="M0 22V-7M-8 4L0 -10L8 4" fill="none" stroke="#4c5557" stroke-width="2"/><text x="0" y="-18" text-anchor="middle" font-size="${lerp(20,16,small)}">北</text></g>`;
 const target=map.overlay;
 target.innerHTML=overlayStyle+svg;

}

onFrame(({time}) => draw(time));
