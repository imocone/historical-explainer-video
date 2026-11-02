(() => {
  const ns='http://www.w3.org/2000/svg';
  const $=id=>document.getElementById(id);
  const clamp=x=>Math.max(0,Math.min(1,x));
  const lerp=(a,b,p)=>a+(b-a)*p;
  const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
  const out=x=>1-Math.pow(1-clamp(x),4);
  const phase=(t,a,d)=>clamp((t-a)/d);
  const envelope=(t,a,b,d=.45)=>ease(phase(t,a,d))*(1-ease(phase(t,b,d)));
  const set=(el,attrs)=>Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));
  const node=(tag,attrs,parent)=>{const el=document.createElementNS(ns,tag);set(el,attrs);parent.append(el);return el;};
  const rgb=(a,b,p)=>'#'+[0,2,4].map(i=>Math.round(lerp(parseInt(a.slice(i+1,i+3),16),parseInt(b.slice(i+1,i+3),16),p)).toString(16).padStart(2,'0')).join('');
  const cues=Object.fromEntries(window.FILM_TIMING.clips.map(c=>[c.id,c]));
  const S=id=>cues[id].start;
  const transferStart=S('transfer')+.9;
  const transferEnd=transferStart+6*.29+1.35;
  const moveStart=S('stairs')+.05;
  const duration=window.FILM_TIMING.duration;
  const office=[{x:405,y:625,s:.83},{x:735,y:625,s:.83},{x:1065,y:625,s:.83},{x:1395,y:625,s:.83},{x:260,y:870,s:1},{x:650,y:870,s:1},{x:1040,y:870,s:1},{x:1430,y:870,s:1}];
  const row=Array.from({length:8},(_,i)=>({x:300+i*200,y:850,s:1}));
  const skin=['#dca77c','#a87459','#e8b48a','#bb8867','#e8c097','#9e6b52','#d6a786','#bc855d'];
  const shirts=['#e8d9ba','#9db8b1','#b7b9ca','#e2b27e','#a5b3aa','#d0b5a3','#cfb991','#bbc2b3'];
  const hair=['#473b34','#242e30','#50463a','#292d30','#423c36','#30332e','#433c31','#2c3332'];
  const stations=[];
  for(let i=0;i<8;i++) {
    const g=node('g',{},$('stations'));
    g.innerHTML=`<ellipse class="shadow" cx="7" cy="12" rx="88" ry="18" fill="#0e1d25" opacity=".4"/>
    <g class="seat"><path d="M-77 8L50-14L97 3L-29 29Z" fill="#677f75"/><path d="M-77 8V17L-29 39V29Z" fill="#3c5653"/><path d="M-29 29L97 3V12L-29 39Z" fill="#526b60"/></g>
    <g class="person">
      <ellipse cx="0" cy="2" rx="44" ry="8" fill="#16262c" opacity=".4"/>
      <g class="legL"><path d="M-28-64H-5L-8-10H-28Z" fill="#3b4850"/><path d="M-29-13H-8L-6 0H-41Q-43-8-29-13Z" fill="#17282e"/></g>
      <g class="legR"><path d="M4-64H28L30-10H9Z" fill="#46555b"/><path d="M8-13H30Q43-9 43 0H8Z" fill="#17282e"/></g>
      <g class="torso"><path d="M-32-126Q0-141 32-126L37-59Q0-50-37-59Z" fill="${shirts[i]}"/><path d="M-27-126L-9-113L0-125L9-113L28-126" fill="none" stroke="#f1eadc" stroke-width="5"/><path d="M0-120V-60" stroke="#5b726a" stroke-width="2" opacity=".5"/><circle cx="5" cy="-93" r="2" fill="#5b726a"/><circle cx="5" cy="-78" r="2" fill="#5b726a"/><path d="M17-110V-91" stroke="#405e59" stroke-width="3"/><rect x="12" y="-93" width="15" height="19" rx="2" fill="#e9dfc9"/><path d="M15-82H24" stroke="#668779" stroke-width="2"/></g>
      <g class="armL"><path d="M-31-123Q-46-124-48-105L-52-71L-38-65L-29-104Z" fill="${shirts[i]}"/><path d="M-52-73L-38-68L-39-55Q-48-47-54-58Z" fill="${skin[i]}"/></g>
      <g class="armR"><path d="M30-123Q45-124 48-105L53-71L39-65L29-104Z" fill="${shirts[i]}"/><path d="M39-68L53-73L55-58Q49-47 40-55Z" fill="${skin[i]}"/></g>
      <rect x="-9" y="-143" width="18" height="24" rx="7" fill="${skin[i]}"/>
      <g class="head"><ellipse cx="0" cy="-162" rx="28" ry="31" fill="${skin[i]}"/><ellipse cx="-27" cy="-160" rx="5" ry="8" fill="${skin[i]}"/><ellipse cx="27" cy="-160" rx="5" ry="8" fill="${skin[i]}"/>
      <path d="${i%3===0?'M-28-163Q-34-200 0-201Q32-201 28-161L17-178Q-9-172-18-184Z':i%3===1?'M-28-165Q-31-197 0-197Q33-194 28-160L18-176L-18-180Z':'M-28-162Q-33-190-11-196Q15-208 29-182L28-160L18-179Q-1-173-16-184Z'}" fill="${hair[i]}"/>
      <path d="M-15-166L-7-168M7-168L15-166" stroke="${hair[i]}" stroke-width="2.5" stroke-linecap="round"/><circle cx="-10" cy="-160" r="2" fill="#263034"/><circle cx="10" cy="-160" r="2" fill="#263034"/><path d="M1-158L-1-150H3" fill="none" stroke="#8f604d" stroke-width="1.8" stroke-linecap="round"/><path class="mouth" d="M-6-144Q0-139 6-144" fill="none" stroke="#7b5143" stroke-width="2" stroke-linecap="round"/>
      ${i===2||i===6?'<g fill="none" stroke="#354b4b" stroke-width="2"><rect x="-20" y="-167" width="17" height="13" rx="4"/><rect x="3" y="-167" width="17" height="13" rx="4"/><path d="M-3-161H3"/></g>':''}</g>
    </g><text class="salary heavy" x="0" y="90" font-size="55">8,000</text>
    <g class="selected"><circle cx="0" cy="-116" r="110" stroke="#b2d2b8" stroke-width="4" fill="none" stroke-dasharray="4 11"/><path d="M-32-236H32L0-205Z" fill="#b2d2b8"/></g>`;
    const select=s=>g.querySelector(s);
    stations.push({g,person:select('.person'),salary:select('.salary'),seat:select('.seat'),shadow:select('.shadow'),selected:select('.selected'),armL:select('.armL'),armR:select('.armR'),head:select('.head'),legL:select('.legL'),legR:select('.legR')});
  }
  const cash=[];
  for(let group=0;group<8;group++)for(let index=0;index<2;index++) {
    const el=node('g',{},$('cash'));
    el.innerHTML='<path class="top"/><path class="front"/><path class="side"/><g class="print"><path class="rim" fill="none" stroke="#e3edcf" stroke-width="1.4"/><path d="M-13-31L2-36L13-30V-3H-13Z" fill="#e8e2c3"/><path d="M-38-24H-23M-40-20H-26M24-24H39M26-20H40" stroke="#417669" stroke-width="2"/><ellipse cx="-30" cy="-12" rx="7" ry="4" fill="none" stroke="#417669" stroke-width="1.4"/><text x="30" y="-9" font-size="12" style="fill:#345f54">4k</text></g>';
    const moved=group<7&&index===1;
    const trail=moved?node('path',{fill:'none',stroke:'#b2d2b8','stroke-width':4,'stroke-linecap':'round'},$('trails')):null;
    cash.push({el,group,index,moved,trail,top:el.querySelector('.top'),front:el.querySelector('.front'),side:el.querySelector('.side'),print:el.querySelector('.print'),rim:el.querySelector('.rim')});
  }
  for(let i=0;i<33;i++)node('path',{d:`M${170+i*50} 850v${i%4===0?15:7}`,stroke:'#82968a','stroke-width':2,opacity:.5},$('rulerTicks'));
  const cubic=(a,b,c,d,t)=>{const q=1-t;return {x:q*q*q*a.x+3*q*q*t*b.x+3*q*t*t*c.x+t*t*t*d.x,y:q*q*q*a.y+3*q*q*t*b.y+3*q*t*t*c.y+t*t*t*d.y};};
  const groupAt=(i,p)=>({x:lerp(office[i].x,row[i].x,p),y:lerp(office[i].y,row[i].y,p),s:lerp(office[i].s,1,p)});
  function headline(t) {
    const states=[
      {at:5.5,title:'八个人，一份工资总额',sub:'假设总工资 64,000 元'},
      {at:S('equal')-.15,title:'平均分，每人8,000元',sub:'每捆代表 4,000 元'},
      {at:S('change')-.15,title:'总额不变，分法变了',sub:'还是64,000元，还是8个人'},
      {at:S('transfer')-.1,title:'七个人4,000，一人36,000',sub:'16捆工资，一捆也没有增加'},
      {at:S('mean')-.1,title:'同一笔钱，两种处境',sub:'64,000 ÷ 8 = 8,000'},
      {at:S('stairs')-.1,title:'平均线上，只有一个人',sub:'7个人的工资都低于8,000元'},
      {at:S('median')-.1,title:'看看队列最中间的两个人',sub:'按工资从低到高排列'},
      {at:S('ending')-.1,title:'平均数没错，处境却不同',sub:''},
    ];
    const current=states.findLast(s=>t>=s.at);
    if(!current){$('headline').setAttribute('opacity',0);$('subhead').setAttribute('opacity',0);return;}
    const next=states.find(s=>s.at>t);
    const alpha=out(phase(t,current.at,.5))*(next?1-ease(phase(t,next.at-.22,.22)):1);
    $('title').textContent=current.title;$('subtitle').textContent=current.sub;
    $('title').setAttribute('font-size',current.title.length>16?83:92);
    $('headline').setAttribute('opacity',alpha);$('subhead').setAttribute('opacity',alpha);
    $('headline').setAttribute('transform',`translate(0 ${16*(1-alpha)})`);
  }
  function caption(t) {
    const clip=window.FILM_TIMING.clips.find(c=>t>=c.start&&t<c.start+c.duration+.18);
    if(!clip){$('caption').textContent='';return;}
    const parts=clip.text.length>27?clip.text.match(/[^。？：]+[。？：]?/g):[clip.text];
    const weights=parts.map(p=>p.length+2);
    const total=weights.reduce((a,b)=>a+b,0);
    const p=clamp((t-clip.start)/clip.duration)*total;
    let sum=0,index=0;
    for(let i=0;i<parts.length;i++){sum+=weights[i];if(p<=sum){index=i;break;}index=i;}
    $('caption').textContent=parts[index];
  }
  function paint(t) {
    const assembly=ease(phase(t,moveStart,2.7));
    const morph=ease(phase(t,moveStart+.65,2.25));
    const finale=ease(phase(t,S('ending')+.3,1.5));
    const selected=envelope(t,S('median')+1.1,S('ending')+.1,.65);
    const cameraPush=envelope(t,S('change'),S('mean')-.6,1.5);
    const medianPush=envelope(t,S('median')+.1,S('ending')-.5,1.25);
    const zoom=lerp(1+.4*cameraPush+.05*medianPush,.72,finale);
    const panX=-300*cameraPush;
    const panY=lerp(-70*cameraPush,130,finale);
    $('camera').setAttribute('transform',`translate(${960+panX} ${700+panY}) scale(${zoom}) translate(-960 -700)`);
    const roomAlpha=(1-ease(phase(t,moveStart,1.5)))*out(phase(t,3.8,1.4));
    $('room').setAttribute('opacity',roomAlpha);
    $('chartGround').setAttribute('opacity',assembly);
    $('meanRule').setAttribute('opacity',out(phase(t,moveStart+2.5,.65))*(1-finale));
    $('medianRule').setAttribute('opacity',out(phase(t,S('median')+3.2,.7))*(1-finale));
    const medianA=960+panX+(row[3].x-960)*zoom;
    const medianB=960+panX+(row[4].x-960)*zoom;
    const medianY=700+panY+(570-700)*zoom;
    $('medianLeaders').setAttribute('d',`M805 438L${medianA} ${medianY}M1115 438L${medianB} ${medianY}`);
    $('meanBadge').setAttribute('opacity',envelope(t,S('mean')+.25,moveStart-.15,.55));
    $('meanBadge').setAttribute('transform',`translate(0 ${20*(1-out(phase(t,S('mean')+.25,.5)))})`);
    $('medianBadge').setAttribute('opacity',envelope(t,S('median')+3.25,S('ending')-.3,.55));
    $('finalType').setAttribute('opacity',finale);
    $('finalType').setAttribute('transform',`translate(0 ${30*(1-finale)})`);
    const reveal=out(phase(t,4.7,1.1));
    $('stations').setAttribute('opacity',reveal);
    $('cash').setAttribute('opacity',reveal);
    let pReport=ease(phase(t,4.7,1.1));
    const reportScale=lerp(.98,.28,pReport);
    const reportY=lerp(495,105,pReport);
    const reportX=lerp(960,1660,pReport);
    const intro=out(phase(t,.12,.6));
    const reportOpacity=intro*(1-ease(phase(t,5.45,.55)));
    $('report').setAttribute('opacity',reportOpacity);
    $('report').setAttribute('transform',`translate(${reportX} ${reportY+35*(1-intro)}) rotate(${lerp(-5,9,pReport)}) scale(${reportScale*lerp(.93,1,intro)})`);
    const stamp=out(phase(t,1.6,.32));
    $('stamp').setAttribute('opacity',stamp);
    $('stamp').setAttribute('transform',`translate(325 180) rotate(-18) scale(${1+.35*(1-stamp)})`);
    for(let i=0;i<8;i++) {
      const station=stations[i],pos=groupAt(i,assembly);
      const salary=i===7?(t>transferEnd?36000:8000):(t>transferStart+i*.29?4000:8000);
      const n=i===7?9:1;
      const height=n*44*morph;
      const walk=Math.sin(phase(t,moveStart+i*.045,2.2)*Math.PI*5)*(1-assembly)*assembly*18;
      const characterX=lerp(-28,0,morph);
      const characterY=-height-8*morph+walk;
      const pop=out(phase(t,4.8+i*.055,.6));
      set(station.g,{transform:`translate(${pos.x} ${pos.y+25*(1-pop)}) scale(${pos.s*lerp(.94,1,pop)})`,opacity:pop});
      set(station.person,{transform:`translate(${characterX} ${characterY})`});
      station.seat.setAttribute('opacity',1-morph);
      station.shadow.setAttribute('rx',lerp(88,76,morph));
      station.salary.textContent=salary.toLocaleString('en-US');
      const moneyHidden=1-envelope(t,S('change')+.1,S('mean')+.9,.25);
      const backLabels=i<4?(1-ease(phase(t,S('change')+.1,.35)) + ease(phase(t,moveStart+2.1,.45))):1;
      station.salary.setAttribute('opacity',moneyHidden*backLabels*(1-finale));
      station.salary.setAttribute('y',lerp(i<4?-235:65,78,morph));
      station.salary.setAttribute('fill',i===7&&t>transferEnd?'#f18060':'#f1eadc');
      const select=(i===3||i===4)?selected:0;
      set(station.selected,{opacity:select,transform:`translate(0 ${-height}) scale(${lerp(.96,1,select)})`});
      const gesture=i===7?envelope(t,transferEnd-.4,S('mean')+.1,.5):envelope(t,S('equal')+i*.09,S('equal')+1.1+i*.09,.3);
      station.armL.setAttribute('transform',`rotate(${-18*gesture} -33 -119)`);
      station.armR.setAttribute('transform',`rotate(${24*gesture} 33 -119)`);
      const stride=walk*.8;
      station.legL.setAttribute('transform',`rotate(${stride} -15 -58)`);
      station.legR.setAttribute('transform',`rotate(${-stride} 15 -58)`);
      station.head.setAttribute('transform',`rotate(${i<7?-3*cameraPush:3*cameraPush} 0 -143)`);
    }
    for(const unit of cash) {
      const {group,index,moved,el}=unit;
      const finalGroup=moved?7:group;
      const finalIndex=moved?2+group:index;
      const source=groupAt(group,assembly),dest=groupAt(finalGroup,assembly);
      const start={x:source.x+44*source.s,y:source.y-index*36*source.s-8*source.s};
      const end={x:dest.x+44*dest.s,y:dest.y-finalIndex*36*dest.s-8*dest.s};
      let xy=start,scale=source.s;
      if(moved) {
        const flight=phase(t,transferStart+group*.29,1.35);
        const p=ease(flight);
        const c1={x:lerp(start.x,end.x,.35),y:Math.min(start.y,end.y)-220-(group%3)*30};
        const c2={x:lerp(start.x,end.x,.8),y:Math.min(start.y,end.y)-190};
        xy=cubic(start,c1,c2,end,p);scale=lerp(source.s,dest.s,p);
        unit.trail.setAttribute('d',`M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`);
        unit.trail.setAttribute('opacity',Math.sin(Math.PI*flight)*.22*(1-morph));
      }
      const barX=dest.x,barY=dest.y-finalIndex*44;
      xy={x:lerp(xy.x,barX,morph),y:lerp(xy.y,barY,morph)};
      scale=lerp(scale,1,morph);
      const w=lerp(52,62,morph),h=lerp(28,44.5,morph),depth=lerp(10,7,morph);
      const base=finalGroup===7?'#ef916b':'#b2d2b8';
      const face=rgb('#6caa92',base,morph);
      set(el,{transform:`translate(${xy.x} ${xy.y}) scale(${scale})`});
      set(unit.top,{d:`M${-w} ${-h}L${-w+16} ${-h-depth}H${w+16}L${w} ${-h}Z`,fill:rgb('#d1e1b7',finalGroup===7?'#f3b58f':'#d3e3ca',morph)});
      set(unit.front,{d:`M${-w} ${-h}H${w}V0H${-w}Z`,fill:face});
      set(unit.side,{d:`M${w} ${-h}L${w+16} ${-h-depth}V${-depth}L${w} 0Z`,fill:rgb('#46796c',finalGroup===7?'#bd684e':'#6e9b88',morph)});
      unit.print.setAttribute('opacity',1-morph);
      unit.rim.setAttribute('d',`M${-w+5} ${-h+4}H${w-5}V-4H${-w+5}Z`);
    }
    const order=t>transferEnd?[...cash].sort((a,b)=>{
      const ga=a.moved?7:a.group,gb=b.moved?7:b.group;
      return ga-gb||(a.moved?2+a.group:a.index)-(b.moved?2+b.group:b.index);
    }):cash;
    for(const unit of order)$('cash').append(unit.el);
    headline(t);caption(t);
  }
  document.fonts.ready.then(()=>{
    const clock={time:0};
    const timeline=gsap.timeline({paused:true});
    timeline.to(clock,{time:duration,duration,ease:'none',onUpdate:()=>paint(clock.time)});
    paint(0);window.__timelines=window.__timelines||{};window.__timelines['salary-film']=timeline;
  });
})();
