import {makePeopleAnimator} from './animate-people.js';
export function mountFilm(D){
 const act=makePeopleAnimator();
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,document.getElementById(id));return nodes.get(id)};
 const C=v=>Math.max(0,Math.min(1,v)),lerp=(a,b,v)=>a+(b-a)*v;
 const ease=v=>{v=C(v);return v*v*v*(v*(v*6-15)+10)},P=(t,a,b)=>ease((t-a)/(b-a)),O=(t,a,b)=>1-(1-C((t-a)/(b-a)))**4;
 const A=(id,v)=>{if($(id))$(id).style.opacity=C(v).toFixed(4)};
 const M=(id,x=0,y=0,s=1,cx=0,cy=0)=>$(id)?.setAttribute('transform',`translate(${x} ${y}) translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`);
 const path=(id,v)=>{const el=$(id);if(el){el.setAttribute('stroke-dasharray','1');el.setAttribute('stroke-dashoffset',1-C(v));A(id,v>0?1:0)}};
 const shape=(id,d)=>$(id)?.setAttribute('d',d);
 const enter=(id,t,at,d=.65,x=0,y=26)=>{const p=O(t,at,at+d);A(id,p);M(id,x*(1-p),y*(1-p));return p};
 const show=(id,t,a,b=.6)=>A(id,P(t,a,a+b));
 function question(t){let open=P(t,9.5,13.7);A('q-type',1-P(t,9.5,10.3));M('q-type',-200*open,70);A('q-choice',P(t,5.2,5.9)*(1-P(t,9,9.6)));A('q-flag',1-P(t,8.9,10.3));M('q-flag',0,-60*P(t,8.9,10.3));A('q-seven',1-P(t,7.6,8.5));for(let i=0;i<7;i++)enter('q-small-'+i,t,1.5+i*.18,.65,0,38);A('q-world',1);M('q-world',lerp(750,80,open),lerp(340,230,open),lerp(.7,1.15,open));show('q-open',t,10.5,.8);}
 function system(t){act('sys-king-person',{nod:2*P(t,7.0,7.7)*(1-P(t,10.0,10.8))});A('sys-ground',1);let zoom=P(t,14.7,17.15);A('sys-title',1-P(t,13.7,14.5));show('sys-court',t,.2);path('sys-left-link',P(t,2,3.3));path('sys-right-link',P(t,6,7.15));enter('sys-left',t,3.1,.9);enter('sys-right',t,7.1,.95);enter('sys-king',t,6.9,.8);path('sys-king-link',P(t,7.7,8.3));show('sys-town',t,9.2,.7);show('sys-limit',t,10.6,.8);
 for(const id of ['sys-court','sys-left-link','sys-right-link','sys-left','sys-king','sys-king-link','sys-town','sys-limit','sys-ground'])A(id,(parseFloat($(id)?.style.opacity)||0)*(1-P(t,13.7,14.5)));
 A('sys-right',O(t,7.1,8.05));M('sys-right');M('sys-right-building',-460*zoom,-55*zoom,lerp(1,2.206,zoom),1420,815);A('sys-right-caption',1-P(t,13.7,14.4));
 }
 function offices(t){
  const open=P(t,1.1,2.8),close=P(t,2.7,3.4)*(1-P(t,8.1,9.4));
  A('off-outer',1-open);A('off-inside',open);
  const pan=(610*(1-P(t,4.7,5.4))-620*P(t,6.2,6.9))*close;
  M('off-inside',pan,0,.9+.225*close,960,540);M('off-roof');A('off-intro',1-P(t,1.6,2.3));
  const p=[P(t,2.9,3.6),P(t,5.1,5.7),P(t,6.4,7.0)];
  for(let i=0;i<3;i++){A('off-area'+i,1);M('off-area'+i);for(let j=0;j<2;j++){const x=248+i*492+j*219,pivot=j?x+219:x;$('off-door'+i+'-'+j)?.setAttribute('transform',`translate(${pivot} 390) scale(${1-p[i]*.96} 1) translate(${j?-219:0} 0)`);}}
  const read=P(t,3.3,3.9)*(1-P(t,4.4,4.9));
  act('off-chancellor',{nod:5*read,read:-4*read});
  act('off-aide0',{nod:2*P(t,3.1,3.9),read:-2*read});
  act('off-aide1',{nod:4*P(t,3.7,4.2)*(1-P(t,4.7,5.1))});
  const approach=P(t,5.1,6.5),step=P(t,5.1,5.4)*(1-P(t,6.15,6.55));
  M('off-visitor-move',40*approach);act('off-visitor',{distance:40*approach/.62,walk:step,nod:4*P(t,6.4,6.8)});
  act('off-registrar',{nod:5*P(t,5.3,5.9)*(1-P(t,7.1,7.7)),read:-3*P(t,5.6,6.2)});
  act('off-guard0',{nod:-2*P(t,6.5,7.1),spear:3*P(t,6.55,7.1)*(1-P(t,7.5,8.1))});
  act('off-guard1',{nod:2*P(t,6.9,7.5),spear:-2*P(t,7.0,7.5)*(1-P(t,8,8.6))});
  A('off-summary',P(t,8.7,9.3)*(1-P(t,12,12.4)));show('off-limits',t,12.4,.65);
 }
 function wealth(t){
  const result=P(t,5.85,6.75),wide=P(t,11.2,12.6);
  A('wealth-title',1-P(t,1.1,1.4));A('wealth-stage',1-result);
  const left=P(t,.85,1.8)*(1-P(t,3.5,4.1)),right=P(t,3.5,4.2)*(1-P(t,5.05,5.8));
  M('wealth-stage',300*left-400*right-220*result,40*(left+right),1+.20*(left+right)-.18*result,960,650);
  A('wealth-sea',1);show('wealth-salt',t,3.6,.6);A('wealth-salt-label',P(t,3.85,4.15)*(1-P(t,5.55,5.85)));A('wealth-copper-label',P(t,1.55,1.85)*(1-P(t,3.35,3.65)));show('wealth-works',t,1.3,.5);
  const cart=64*P(t,.55,2.15),cartWalk=P(t,.55,.8)*(1-P(t,1.9,2.25));M('wealth-cart',cart,34);M('copper-carrier-move',cart);
  act('copper-carrier',{distance:cart/.57,walk:cartWalk,nod:2});
  for(let i=0;i<2;i++)$('cart-wheel'+i)?.setAttribute('transform',`rotate(${cart/17*180/Math.PI} ${i?427:358} 704)`);
  const lift=P(t,1.45,2.15),tip=P(t,2.1,2.7),recover=P(t,3.2,3.85);
  act('copper-caster',{angle:-16*lift+26*tip-8*recover,reach:2*tip,nod:4*tip,lean:-2*lift+3.5*tip-1.5*recover,weight:1.8*tip,pour:P(t,2.45,2.65)*(1-P(t,3.3,3.5)),target:[151,-141]});
  const stir=P(t,3.65,4.1)*(1-P(t,5.5,5.9));
  act('salt-stirrer',{angle:Math.sin((t-3.65)*3.6)*3.5*stir,reach:2*Math.sin((t-3.65)*3.6)*stir,nod:3*stir,lean:1.5*Math.sin((t-3.65)*3.6)*stir});
  for(let i=0;i<3;i++){const phase=((t*.32+i*.31)%1+1)%1;A('wealth-steam'+i,Math.sin(phase*Math.PI)*.42);M('wealth-steam'+i,Math.sin(phase*Math.PI)*5,-30*phase);}
  const flight=P(t,5.75,6.75);A('wealth-flight',(t>=5.75&&t<6.75)?1:0);M('wealth-flight',lerp(789,238,flight),lerp(710,510,flight)-Math.sin(Math.PI*flight)*170,lerp(.3,.85,flight));
  A('wealth-result',result*(1-wide));M('wealth-result',160*(1-result),0);
  for(let i=0;i<12;i++)enter('wealth-coin'+i,t,6.0+i*.045,.5,0,-30);
  act('wealth-stock-clerk',{nod:3*P(t,7.0,7.6),read:-4*P(t,7.4,8.0)*(1-P(t,8.8,9.3))});
  act('settled-person0',{nod:-3});act('settled-person1',{nod:2});act('settled-person2',{nod:3,read:-2});
  for(let i=0;i<6;i++){
   const start=7.35+i*.22,end=9.8+i*.16,v=P(t,start,end),scale=.48+(i%3)*.025;
   A('wealth-person'+i,1);M('wealth-person'+i,190*(1-v),8*(1-v));
   act('arrival'+i,{distance:190*v/scale,walk:P(t,start,start+.2)*(1-P(t,end-.32,end)),phase:i*.14,nod:2*(1-v)});
  }
  show('wealth-town',t,7.25,.5);M('wealth-town',0,-80);show('wealth-gather',t,6.15,.5);
  A('wealth-overview',wide);M('wealth-overview',1920*(1-wide));
 }
 function edict(t){const wide=P(t,11.7,13.1);A('edict-head',1-wide);A('edict-strips',1-wide);M('edict-strips',0,-300*wide);for(let i=0;i<3;i++){let at=[2.8,4.9,7.7][i];enter('edict-row'+i,t,at,.55,50,0);let p=P(t,at+.65,at+1.7);A('edict-target'+i,p);A('edict-cut'+i,p);A('edict-note'+i,p);let l=$('edict-old'+i)?.querySelector('path');if(l)l.setAttribute('d',`M388 ${297+i*208}H${1785-485*p}`);}
 A('edict-land',wide);M('edict-land',0,150*(1-wide));A('edict-last',wide);A('edict-border',wide);const shrink=P(t,14.0,17.1);shape('edict-border',`M80 880V303H${1805-620*shrink}V880`);}
 function meaning(t){
  const close=P(t,5.5,7)*(1-P(t,12.5,14.1));A('meaning-land',1);M('meaning-land',-220*close,0,1+.55*close,1270,650);A('meaning-head',(1-close)*(1-P(t,15.0,15.45)));A('meaning-king',1-close);shape('meaning-bound','M80 880V303H1185V880');A('meaning-bound',1-close);A('meaning-other',1-close);A('meaning-link',0);A('meaning-resources',P(t,3.4,4.1)*(1-close));show('meaning-next',t,15.3,.9);show('meaning-question',t,15.5,.6);
 }
 const mapState=prefix=>{for(const id of ['map','changan','wu','chu','zhao','sd','liang'])A(prefix+'-'+id,1);for(let i=0;i<4;i++)A(prefix+'-sd'+i,1)};
 function rebellion(t){mapState('reb');A('reb-title',1-P(t,11.9,12.6));show('reb-wu',t,1.3,.65);show('reb-chu',t,3.3,.55);show('reb-zhao',t,4.2,.55);show('reb-sd',t,4.8,.7);for(let i=0;i<4;i++)enter('reb-sd'+i,t,5.0+i*.7,.5,0,12);show('reb-seven',t,8.6,.8);A('reb-seven',P(t,8.6,9.4)*(1-P(t,11.9,12.6)));show('reb-limit',t,11.9,.7);show('reb-liang',t,14.8,.8);show('reb-loyal',t,15.1,.8);path('reb-to-liang',P(t,15.8,16.8));}
 function fronts(t){mapState('front');A('front-title',1);path('front-wu-route',P(t,2.5,4.6));path('front-sd-route',P(t,5.7,7.4));path('front-surround',P(t,6.8,8.1));show('front-linzi',t,6.2,.6);path('front-zhao-route',P(t,8.9,10.0));for(let i=0;i<3;i++)path('front-response'+i,P(t,10.9+i*.35,12.2+i*.35));show('front-block',t,14.7,.7);show('front-focus',t,14.4,.8);}
 function reform(t){act('reform-king-person',{nod:2*P(t,12,13)});act('reform-emperor',{nod:-2*P(t,14,15)});act('reform-appointee',{nod:3*P(t,15,16),read:-3*P(t,15.4,16.0)});const arrival=P(t,14.7,16);A('reform-official-move',arrival);M('reform-official-move',55*(1-arrival));let change=P(t,10.6,11.7);A('reform-dates',1-change);A('reform-date154',1);M('reform-date154',430*(1-P(t,6.1,7.8)));show('reform-date145',t,8.1,.8);path('reform-years',P(t,6.5,9.0));show('reform-dot154',t,6.5,.4);show('reform-dot145',t,8.1,.6);A('reform-stage',change);M('reform-stage',0,50*(1-change));A('reform-king',1);A('reform-palace',1);show('reform-court',t,13.1,.7);path('reform-old',1-P(t,11.7,13.1));path('reform-new',P(t,14,15.4));show('reform-appointed',t,14.8,.7);show('reform-kept',t,16.5,.7);}
 function answer(t){let end=P(t,12.3,14.1);A('answer-view',1);M('answer-view',820*end,155*end,lerp(1,.55,end),80,230);A('answer-head',1-end);A('answer-landmark',(1-P(t,8,9))*(1-end));A('answer-labels',P(t,4.4,5.1)*(1-end));show('answer-population-label',t,6.25,.4);show('answer-income-label',t,7.0,.4);show('answer-governance-label',t,7.75,.4);path('answer-authority',P(t,9.6,11.2)*(1-end));A('answer-court',(t>=9?1:0)*(1-end));M('answer-court',0,-30*(1-O(t,9,9.7)));A('answer-final',P(t,14.1,14.8));A('answer-final-authority',P(t,14.6,15.2));path('answer-final-link',P(t,15.0,15.6));}
 const r={question,system,offices,wealth,edict,meaning,rebellion,fronts,reform,answer};
 function render(time){let idx=D.scenes.findIndex((s,i)=>time<(D.scenes[i+1]?.start??D.duration));if(idx<0)idx=9;let scene=D.scenes[idx],t=Math.max(0,time-scene.start);for(const key of Object.keys(r)){A('s-'+key,key===scene.id?1:0);M('s-'+key);}r[scene.id](t);
 // Lateral handoffs preserve travel direction; short editorial cuts stay on a settled state.
 for(const i of [1,3,4,6]){let seam=D.scenes[i].start;if(Math.abs(time-seam)<.48){let v=P(time,seam-.48,seam+.48);let prev=D.scenes[i-1],next=D.scenes[i];r[prev.id](Math.max(0,time-prev.start));r[next.id](Math.max(0,time-next.start));A('s-'+prev.id,1);A('s-'+next.id,1);M('s-'+prev.id,-1920*v);M('s-'+next.id,1920*(1-v));}}
 const seam=D.scenes[8].start,w=P(time,seam-.44,seam+.44);A('wipe',Math.abs(time-seam)<.44?1:0);M('wipe',lerp(-1920,1920,w));
 $('caption-text').textContent=D.captions.find(c=>time>=c.start&&time<c.end)?.text||'';document.documentElement.dataset.filmTime=time.toFixed(3);document.documentElement.dataset.filmScene=scene.id;
 }
 const clock={t:0},tl=gsap.timeline({paused:true});tl.to(clock,{t:D.duration,duration:D.duration,ease:'none',onUpdate:()=>render(clock.t)},0);window.__timelines=window.__timelines||{};window.__timelines['seven-warm-film']=tl;window.__sevenWarm={render,duration:D.duration};render(0);
}
