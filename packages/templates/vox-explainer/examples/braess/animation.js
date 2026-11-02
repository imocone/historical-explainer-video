const ns='http://www.w3.org/2000/svg',doc=root.ownerDocument;
const $=id=>select('#'+id);
const clamp=x=>Math.max(0,Math.min(1,x));
const lerp=(a,b,p)=>a+(b-a)*p;
const phase=(t,a,d)=>clamp((t-a)/d);
const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const out=x=>1-Math.pow(1-clamp(x),4);
const number=n=>Number.isInteger(n)?String(n):n.toFixed(1);
const env=(t,a,b,d=.55)=>ease(phase(t,a,d))*(1-ease(phase(t,b,d)));
const set=(el,attrs)=>Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));
const node=(tag,attrs,parent)=>{const el=doc.createElementNS(ns,tag);set(el,attrs);parent.append(el);return el;};
const rgb=(a,b,p)=>'#'+[0,2,4].map(i=>Math.round(lerp(parseInt(a.slice(i+1,i+3),16),parseInt(b.slice(i+1,i+3),16),p)).toString(16).padStart(2,'0')).join('');
const ids=['hook','setup','balance','open','tempt','crowd','slow','trap','return','ending'];
const cues=Object.fromEntries(ids.map(id=>[id,cue(id)]));
const model=createTrafficModel(cues,duration);
const base={S:{x:280,y:520},U:{x:870,y:305},D:{x:870,y:730},T:{x:1470,y:520}};
const chain={S:{x:300,y:650},U:{x:940,y:650},D:{x:940,y:650},T:{x:1580,y:650}};
const edges=[['SU','S','U',true],['UT','U','T',false],['SD','S','D',false],['DT','D','T',true]];
const roads=edges.map(([id,a,b,variable])=>{
  const g=node('g',{},$('roads'));
  const shadow=node('path',{fill:'none',stroke:'#60776a','stroke-width':82,'stroke-linecap':'round',opacity:.18,transform:'translate(0 9)'},g);
  const border=node('path',{fill:'none',stroke:'#4a625c','stroke-width':76,'stroke-linecap':'round'},g);
  const surface=node('path',{fill:'none','stroke-width':64,'stroke-linecap':'round'},g);
  const line=node('path',{fill:'none',stroke:'#e8edda','stroke-width':2.5,'stroke-dasharray':'13 15',opacity:.7},g);
  return {g,shadow,border,surface,line,a,b,variable,id};
});
const junctions=Object.keys(base).map(id=>({id,outer:node('circle',{r:43,fill:'#4a625c'},$('junctions')),inner:node('circle',{r:33,fill:'#dce4ce',stroke:'#ecf1df','stroke-width':3},$('junctions'))}));
const clockSpec=[{id:'SU',x:540,y:309,variable:true},{id:'UT',x:1190,y:309,variable:false},{id:'SD',x:540,y:737,variable:false},{id:'DT',x:1190,y:737,variable:true}];
const clocks=clockSpec.map(spec=>{
  const g=node('g',{},$('clocks'));
  g.innerHTML='<rect x="-120" y="-52" width="240" height="108" rx="10" fill="#f5f1df" stroke="#a7bba5" stroke-width="3"/><text class="name" y="-15" font-size="33"/><text class="value heavy" y="46" font-size="67"/>';
  g.querySelector('.name').textContent=spec.variable?'车流变化段':'固定耗时段';
  return {...spec,g,value:g.querySelector('.value'),name:g.querySelector('.name')};
});
// Small buildings occupy actual clear ground outside the four road corridors.
const buildings=[];
const candidates=[[175,390,58,86],[280,330,58,96],[420,300,52,57],[520,520,62,69],[585,545,42,51],[1250,525,64,82],[1570,365,64,105],[1650,425,52,66],[1550,725,68,90],[1635,795,51,66],[1260,802,62,55],[380,770,58,83],[240,760,53,60],[665,815,48,55],[1015,820,55,48]];
for(let i=0;i<candidates.length;i++) {
  const [x,y,w,h]=candidates[i],g=node('g',{},$('buildings'));
  const top=i%3===0?'#e9d8b8':i%3===1?'#c1cbb7':'#bdc9c6';
  g.innerHTML=`<ellipse cx="${x+12}" cy="${y+6}" rx="${w*.8}" ry="11" fill="#6b8b78" opacity=".16"/><path d="M${x-w/2} ${y-h}H${x+w/2}V${y}H${x-w/2}Z" fill="${top}"/><path d="M${x+w/2} ${y-h}L${x+w/2+20} ${y-h-13}V${y-13}L${x+w/2} ${y}Z" fill="#8ca494"/><path d="M${x-w/2} ${y-h}L${x-w/2+20} ${y-h-13}H${x+w/2+20}L${x+w/2} ${y-h}Z" fill="#eef0de"/><path d="M${x-w/2+10} ${y-h-5}H${x+w/2-4}" stroke="#a2b19a" stroke-width="3"/>`;
  for(let row=0;row<Math.floor(h/22);row++)for(let col=0;col<2;col++)node('rect',{x:x-w/2+10+col*(w-26),y:y-h+13+row*20,width:7,height:9,rx:1,fill:'#789a90'},g);
  node('path',{d:`M${x-4} ${y}v-17h12v17`,fill:'#708e81'},g);
  buildings.push(g);
}
for(const [x,y] of [[170,650],[225,650],[740,330],[1010,334],[1520,625],[1600,610],[320,835],[1400,820],[1145,795],[645,690]]){
  const g=node('g',{},$('trees'));
  g.innerHTML=`<ellipse cx="${x+8}" cy="${y+9}" rx="17" ry="6" fill="#6a8f75" opacity=".2"/><path d="M${x} ${y}v-25" stroke="#8e9275" stroke-width="6"/><ellipse cx="${x+3}" cy="${y-33}" rx="19" ry="25" fill="#9eb694"/><ellipse cx="${x-4}" cy="${y-39}" rx="14" ry="21" fill="#b2c3a0"/>`;
}
const cars=[];
for(let side=0;side<2;side++)for(let i=0;i<40;i++){
  const g=node('g',{},$('cars'));
  const el=node('use',{href:'#car',x:-12,y:-7,width:24,height:14,style:`color:${side===0?'#f1e6bc':'#bdcfbd'}`},g);
  cars.push({g,el,side,i});
}
const roundPath=points=>{
  const samples=[points[0]],commands=[`M${points[0].x} ${points[0].y}`];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    const l1=Math.hypot(b.x-a.x,b.y-a.y),l2=Math.hypot(c.x-b.x,c.y-b.y);
    const r=Math.min(32,l1*.16,l2*.16);
    const p=l1?{x:b.x-(b.x-a.x)/l1*r,y:b.y-(b.y-a.y)/l1*r}:b;
    const q=l2?{x:b.x+(c.x-b.x)/l2*r,y:b.y+(c.y-b.y)/l2*r}:b;
    commands.push(`L${p.x} ${p.y}Q${b.x} ${b.y} ${q.x} ${q.y}`);samples.push(p);
    for(let n=1;n<=10;n++){const t=n/10,u=1-t;samples.push({x:u*u*p.x+2*u*t*b.x+t*t*q.x,y:u*u*p.y+2*u*t*b.y+t*t*q.y});}
  }
  samples.push(points.at(-1));commands.push(`L${points.at(-1).x} ${points.at(-1).y}`);
  const dist=[0];for(let i=1;i<samples.length;i++)dist.push(dist.at(-1)+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y));
  return {d:commands.join(''),samples,dist,length:dist.at(-1)};
};
const pointOn=(route,p)=>{
  const distance=clamp(p)*route.length;
  let i=1;while(i<route.dist.length-1&&route.dist[i]<distance)i++;
  const a=route.samples[i-1],b=route.samples[i],span=route.dist[i]-route.dist[i-1];
  const f=span?(distance-route.dist[i-1])/span:0;
  return {x:lerp(a.x,b.x,f),y:lerp(a.y,b.y,f),angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
};
const headlines=[
 ['hook','多修一条路，反而更堵？','布雷斯悖论 · 一个简化路网'],
 ['setup','4,000辆车，只有两种走法','绿色段：耗时（分钟）＝车数 ÷ 100'],
 ['balance','平均分流，两边都要65分钟','2,000辆 + 2,000辆，总车数不变'],
 ['open','打开中间这条近路','通道本身的用时，设为0'],
 ['tempt','站在一个司机的角度看','眼下的选择：20 + 0 + 20'],
 ['crowd','人人改道，瓶颈却叠加了','两个拥堵段，开始承载同一批车'],
 ['slow','路增加了，时间也增加了','把同一条路，展开成耗时长度'],
 ['trap','为什么没人愿意先退出？','原来的旧路，此时反而要85分钟'],
 ['return','关闭近路，车流重新分开','改变的是分配，总量仍是4,000辆'],
 ['ending','局部的捷径，可能是全局的瓶颈','布雷斯悖论：个人选择会改变整个系统'],
];
onFrame(({time:t})=>{
  const state=model(t),r=state.share;
  const m=env(t,cues.slow+.25,cues.trap-.15,1.35);
  const finale=ease(phase(t,cues.ending+.1,1.2));
  const macro=env(t,cues.open+.1,cues.tempt-.4,.8);
  const scan=lerp(95,-65,ease(phase(t,cues.open+1.2,2.4)));
  const zoom=lerp(1+.52*macro,.65,finale);
  const panX=140*macro;
  const panY=lerp(scan*macro,200,finale);
  $('camera').setAttribute('transform',`translate(${960+panX} ${540+panY}) scale(${zoom}) translate(-960 -540)`);
  const reveal=out(phase(t,cues.setup-.6,.9));
  const cityOpacity=(1-m)*(1-finale*.3)*lerp(.16,1,reveal);
  $('city').setAttribute('opacity',cityOpacity);
  for(let i=0;i<buildings.length;i++){const p=out(phase(t,cues.setup-.4+i*.035,.65));buildings[i].setAttribute('transform',`translate(0 ${20*(1-p)})`);}
  const pts=Object.fromEntries(Object.keys(base).map(id=>[id,{x:lerp(base[id].x,chain[id].x,m),y:lerp(base[id].y,chain[id].y,m)}]));
  const color=rgb('#4d8b76','#d66345',r);
  for(const road of roads){
    const a=pts[road.a],b=pts[road.b],d=`M${a.x} ${a.y}L${b.x} ${b.y}`;
    for(const p of [road.shadow,road.border,road.surface,road.line]){p.setAttribute('d',d);p.setAttribute('stroke-linecap',m>.85?'butt':'round');}
    road.surface.setAttribute('stroke',road.variable?color:'#8d9d97');
    road.g.setAttribute('opacity',reveal*(road.variable?1:1-m));
  }
  for(const j of junctions){for(const el of [j.outer,j.inner])set(el,{cx:pts[j.id].x,cy:pts[j.id].y,opacity:reveal*(1-m)});}
  const open=ease(phase(t,cues.open+.5,1.5));
  const closed=t>cues.return&&r===0?ease(phase(t,cues.return+6.4,.7)):0;
  const bridgeOpen=open*(1-closed);
  const bridgeD=`M${pts.U.x} ${pts.U.y}L${pts.D.x} ${pts.D.y}`;
  for(const id of ['bridgeShadow','bridgeSurface','bridgeDashes'])$(id).setAttribute('d',bridgeD);
  set($('bridgeClipTop'),{height:215*open});set($('bridgeClipBottom'),{y:730-215*open,height:215*open});
  $('bridge').setAttribute('opacity',open*(1-m)*(1-closed*.7));
  $('gate').setAttribute('opacity',reveal*(1-m)*(1-finale));
  $('gateArm').setAttribute('transform',`rotate(${-86*bridgeOpen} 830 348)`);
  $('gateLight').setAttribute('fill',bridgeOpen>.5?'#438e6c':'#cc573e');
  $('bridgeLabel').setAttribute('opacity',env(t,cues.open+1.8,cues.slow-.3,.45)*(1-m)*(1-macro));
  const routes=[roundPath([pts.S,pts.U,pts.T]),roundPath([pts.S,pts.D,pts.T]),roundPath([pts.S,pts.U,pts.D,pts.T])];
  for(const car of cars){
    const p=(state.cycle+(car.i+.5)/40+car.side*.0125)%1;
    const shortcut=state.shortcut[car.i];
    const point=pointOn(routes[shortcut?2:car.side],p);
    set(car.g,{transform:`translate(${point.x} ${point.y}) rotate(${point.angle})`,opacity:reveal*clamp(Math.min(p,1-p)/.025)});
  }
  const tryNew=env(t,cues.tempt+.2,cues.crowd-.2,.4);
  const tryOld=env(t,cues.trap+1.3,cues.return-.5,.5);
  const trace=tryNew>0?routes[2]:routes[0];
  const traceProgress=tryNew>0?out(phase(t,cues.tempt+.4,5.1)):ease(phase(t,cues.trap+1.5,4.2));
  const hero=pointOn(trace,traceProgress);
  set($('tracer'),{d:trace.d,'stroke-dasharray':`${traceProgress*trace.length} ${trace.length*2}`,opacity:Math.max(tryNew,tryOld)*.7});
  set($('heroCar'),{transform:`translate(${hero.x} ${hero.y}) rotate(${hero.angle})`,opacity:Math.max(tryNew,tryOld)});
  for(const clock of clocks){
    let x=clock.x,y=clock.y;
    if(clock.id==='SU'){x=lerp(x,620,m);y=lerp(y,570,m);}
    if(clock.id==='DT'){x=lerp(x,1260,m);y=lerp(y,570,m);}
    const opacity=reveal*(clock.variable?1:1-m)*(1-finale)*(1-macro);
    set(clock.g,{transform:`translate(${x} ${y})`,opacity});
    clock.value.innerHTML=`${clock.variable?number(state.variable):45}<tspan font-size="38">分</tspan>`;
    clock.value.setAttribute('fill',clock.variable?color:'#344e53');
    clock.name.textContent=clock.variable?`${Math.round(state.flow).toLocaleString('en-US')}辆`:'固定耗时段';
  }
  $('reference').setAttribute('opacity',m);
  $('nodeLabels').setAttribute('opacity',reveal*(1-m)*(1-finale)*(1-macro));
  const calc=$('calc');
  if(t<cues.balance)calc.textContent='';
  else if(t<cues.open)calc.textContent='20 + 45 = 65 分钟';
  else if(t<cues.tempt)calc.textContent='新通道开启，车流暂未改变';
  else if(t<cues.crowd)calc.textContent='20 + 0 + 20 ≈ 40 分钟';
  else if(t<cues.slow)calc.textContent=`${number(state.variable)} + ${number(state.variable)} = ${number(state.new)} 分钟`;
  else if(t<cues.trap)calc.textContent='40 + 40 = 80 分钟';
  else if(t<cues.return)calc.textContent='独自走旧路：40 + 45 = 85 分钟';
  else calc.textContent=r===0?'20 + 45 = 65 分钟':`重新分流中 · 捷径选择 ${Math.round(r*100)}%`;
  $('calculation').setAttribute('opacity',out(phase(t,cues.balance-.2,.6))*(1-finale));
  $('hook').setAttribute('opacity',(1-ease(phase(t,cues.setup-.6,.6)))*out(phase(t,.2,.6)));
  $('hook').setAttribute('transform',`translate(0 ${25*(1-out(phase(t,.2,.7)))})`);
  $('finish').setAttribute('opacity',finale);
  const current=headlines.findLast(h=>t>=cues[h[0]]-.15)||headlines[0];
  const index=headlines.indexOf(current),next=headlines[index+1];
  const alpha=out(phase(t,cues[current[0]]-.15,.45))*(next?1-ease(phase(t,cues[next[0]]-.4,.25)):1);
  $('title').textContent=current[1];$('subtitle').textContent=current[2];
  $('title').setAttribute('font-size',current[1].length>16?79:88);
  $('headline').setAttribute('opacity',alpha);
});
