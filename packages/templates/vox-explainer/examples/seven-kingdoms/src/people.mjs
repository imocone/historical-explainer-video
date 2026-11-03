import {C,P,E,L,R,g,at,N} from './drawing.mjs';
const S=(d,c)=>P(d,c,'none');
const line=(d,c=C.ink,w=1.3)=>P(d,'none',c,w);
const part=(name,s,tr='')=>`<g data-part="${name}" ${tr?`transform="${tr}"`:''}>${s}</g>`;
const skins=[['#e6bc96','#d7ab82','#b98562'],['#d5a47e','#be8c66','#a07152'],['#ebc6a1','#d8b18d','#b98a69']];
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
const fmt=v=>+v.toFixed(3);
export function rotatePoint(p,a,o=[0,0]){const r=a*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return [(p[0]-o[0])*c-(p[1]-o[1])*s+o[0],(p[0]-o[0])*s+(p[1]-o[1])*c+o[1]];}
function head({x=0,y=0,tilt=0,cap=false,royal=false,front=false,variant=0,mature=false}={}){
 const [light,skin,shade]=skins[variant%3];let s=S('M-8-15L-10 3Q-1 10 12 6L9-16Z',shade);
 if(front){
  s+=S('M-16-40Q-15-55 1-55Q19-54 20-38L17-14Q10-4 1-4Q-10-6-14-17Z',light)+S('M-15-37L-8-33-7-15 2-5Q-8-5-14-17Z',skin)+E(-15,-26,4,6,skin)+E(18,-26,3,5,skin);
  s+=S('M-16-30Q-22-47-9-55Q5-63 17-50L20-34Q8-33 1-41L-10-34-12-27Z',C.ink)+line('M-8-28l5-1m11 0 5 1',C.ink,1.3)+E(-5,-25,1,1,C.ink)+E(10,-25,1,1,C.ink)+line('M3-24l-1 6 3 1M-1-12h7',shade,1);
 }else{
  s+=S('M-15-36Q-16-53 1-54Q18-54 20-39L19-28 24-22Q25-20 20-19L19-10Q14-2 2-5L-10-14Z',light)+S('M-15-36L-9-36-7-23Q-8-15 1-8L11-5Q-1-1-10-12Z',skin);
  s+=S('M-16-27Q-22-42-12-52Q1-63 15-53Q24-47 20-36Q8-36 2-42L-7-35-8-24Z',C.ink)+E(-10,-26,4.5,6,skin)+line('M-11-29q4-1 3 5',shade,.8)+line('M10-28l5 1',C.ink,1.35)+E(14,-25.5,1,1.1,C.ink)+line('M17-13l-5 .7',shade,1.1);
 }
 if(mature)s+=S(front?'M-7-10Q2-3 12-11L9 1 3 7-3 1Z':'M4-9Q13-4 19-11L15 1 7 5Z',C.ink);
 if(cap)s+=S('M-21-46L-18-64Q-4-69 9-67L15-47Z',C.ink)+S('M-18-63L-7-66-8-47-19-46Z','#35555b')+line('M-23-46L18-43',C.ink,3.2);
 else s+=S('M-14-51Q-26-56-21-62Q-16-67-10-63L-5-54Z',C.ink)+line('M-20-57l12 3',C.wood,1.4);
 if(royal)s+=S('M-29-68L24-66 24-60-29-62Z',C.ink)+N(5,i=>line(`M${-23+i*10}-61v15`,C.gold,1.1)+E(-23+i*10,-46,1.3,1.6,C.gold));
 return g('',part('head',s,`rotate(${tilt})`),`translate(${x} ${y})`,`data-head-tilt="${tilt}"`);
}
function wrap(id,role,s,extra=''){return `<g ${id?`id="${id}" data-actor="${role}"`:''} ${extra}>${s}</g>`;}
const shadow=(rx=40)=>E(0,3,rx,5,'#203b4312');
function robeBody(robe=C.green,dark='#386a5b'){
 return S('M-23-194Q-13-204 8-200L27-184 23-133Q29-75 42-16Q9-4-44-16Q-36-67-31-123Z',robe)+S('M-23-194Q-31-166-22-136L-25-95-33-20-44-16Q-38-62-31-123Z',dark)+S('M6-131Q9-83 25-14L42-16Q28-72 23-133Z',dark)+S('M-19-199L-8-207Q0-196 20-184L15-171Q-7-185-19-199Z',C.cream)+S('M11-202L20-194Q14-180-4-163L-17-157Q-2-181 11-202Z','#d7dfc8')+S('M7-194L15-188Q8-178-4-166L-10-163Z',robe)+S('M-28-136Q-2-128 25-138L26-130Q-1-120-30-128Z',C.ink)+S('M4-128L9-129 13-92 8-94Z',C.gold)+S('M-19-123L-25-29-21-24-14-102Z',robe===C.green?'#719986':robe===C.red?'#df8061':'#53727a')+line('M-42-17Q-5-6 40-17',dark,1.4);
}
function robeFeet(){return S('M-25-23L-28-7Q-41-5-43 0H-11L-7-23Z',C.ink)+S('M14-24L17-7Q29-8 35-1L35 2H6L2-25Z',C.ink);}
export function official({id='',robe=C.green,royal=false,variant=0,plain=false}={}){
 const dark=robe===C.red?C.redD:robe===C.green?'#386a5b':'#294a55',skin=skins[variant%3];
 let arms='';
 if(plain){arms=S('M-20-194Q-36-193-40-177L-45-145Q-43-128-24-128L0-136-3-151-21-147-17-174Z',robe)+S('M17-190Q32-189 36-172L40-146Q35-129 17-130L-4-137 1-152 20-148 14-174Z',dark)+S('M-4-152L5-151 8-135-2-135Z',C.cream)+S('M3-144Q11-149 18-144L18-138 8-135Z',skin[0]);}
 else{
  arms=S('M16-190Q26-190 32-173L42-157 31-142Q16-146 13-164L9-178Z',dark)+S('M33-158L47-163 52-155 36-146Z',skin[1]);
  arms+=S('M-20-194Q-38-195-41-177L-45-153Q-39-133-22-135L11-151 6-165-22-159-18-180Z',robe)+S('M-43-157Q-38-139-25-141L8-157 11-151-22-135Q-39-133-45-153Z',dark)+S('M4-166L13-169 18-154 10-150Z',C.cream);
  arms+=g('',R(12,-174,43,32,'#e6cf9c','none',0,1)+N(8,i=>L(15+i*5,-172,15+i*5,-145,'#b28b59',.75))+L(12,-166,55,-166,'#8a714f',1)+L(12,-151,55,-151,'#8a714f',1)+E(13,-158,3,16,'#efdfb6')+E(56,-158,3,16,'#bc9866'),'rotate(10 33 -158)');
  arms+=S('M10-160Q16-164 22-160L23-154 16-151 11-153Z',skin[0])+line('M16-158l5 1',skin[2],.8)+S('M44-157Q48-161 54-160L57-154 52-150 46-151Z',skin[0]);
 }
 const s=shadow()+robeFeet()+part('body',robeBody(robe,dark)+head({x:-1,y:-204,tilt:plain?0:8,cap:true,royal,front:royal,variant,mature:variant===1})+part('arms',arms));
 return wrap(id,royal?'royal':'official',s,`data-variant="${variant}"`);
}
// Two-link limbs keep knees and soles attached while the body moves.
function knee(hip,ankle,L1=54,L2=55){
 const dx=ankle[0]-hip[0],dy=ankle[1]-hip[1],dist=Math.max(.001,Math.hypot(dx,dy)),d=Math.min(dist,L1+L2-.01);
 const a=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-a*a));
 return [hip[0]+dx/dist*a+dy/dist*h,hip[1]+dy/dist*a-dx/dist*h];
}
export function limbPath(a,b,c,wa=13,wb=12,wc=7){
 const normal=(p,q)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);return [-(q[1]-p[1])/d,(q[0]-p[0])/d]};
 const n0=normal(a,b),n1=normal(b,c),n=[(n0[0]+n1[0])/2,(n0[1]+n1[1])/2],d=Math.hypot(...n)||1;n[0]/=d;n[1]/=d;
 const v=(p,n,w,k)=>`${fmt(p[0]+n[0]*w*k)} ${fmt(p[1]+n[1]*w*k)}`;
 return `M${v(a,n0,wa,1)}Q${v(b,n,wb,1)} ${v(c,n1,wc,1)}L${v(c,n1,wc,-1)}Q${v(b,n,wb,-1)} ${v(a,n0,wa,-1)}Q${a.join(' ')} ${v(a,n0,wa,1)}Z`;
}
function bootPath(x,y,angle=0){const q=[[-8,-8],[-6,-1],[14,-1],[23,4],[20,6],[-12,6],[-14,2],[-12,-9]].map(p=>rotatePoint([p[0]+x,p[1]+y],angle,[x,y]));return 'M'+q.map(p=>p.map(fmt).join(' ')).join('L')+'Z';}
export function gait(distance=0,amount=0,seed=0){
 const phase=((distance/80+seed)%1+1)%1,bob=-2.2*(1-Math.cos(phase*Math.PI*4))*.5*amount;
 const legs=[0,.5].map((o,i)=>{const q=(phase+o)%1;let x,lift;
  if(q<.6){x=24-q*80;lift=0;}else{let a=(q-.6)/.4;x=-24+48*ease(a);lift=17*Math.sin(Math.PI*a);}
  x=lerp(i?17:-20,x,amount);lift*=amount;const ankle=[x,-6-lift],hip=[-10+(i?5:-4),-105+bob],kn=knee(hip,ankle);
  return {d:limbPath(hip,kn,ankle,13,10,7),shoe:bootPath(x,-6-lift,amount*(q>.6?-8*Math.sin(Math.PI*(q-.6)/.4):0))};
 });return {legs,bob,phase};
}
const lerp=(a,b,p)=>a+(b-a)*p;
export function traveller({id='',robe=C.red,variant=0,pack=true,push=false}={}){
 const dark=robe===C.red?C.redD:robe===C.green?'#386a5b':'#294a55',skin=skins[variant%3],pose=gait(0,0,0);
 let s=shadow(56)+P(pose.legs[0].d,'#81553d','none',0,'data-part="leg-back"')+P(pose.legs[0].shoe,C.ink,'none',0,'data-part="shoe-back"')+P(pose.legs[1].d,'#b88b62','none',0,'data-part="leg-front"')+P(pose.legs[1].shoe,C.ink,'none',0,'data-part="shoe-front"');
 let body='';if(pack)body+=part('pack',S('M-31-194Q-60-200-74-181L-83-144Q-83-123-64-115L-36-116Q-22-137-22-163Z',C.goldD)+S('M-36-192Q-64-194-70-176L-77-145Q-78-127-64-122L-39-123Q-29-141-31-166Z','#d0b47e')+S('M-48-197L-37-204-29-197-27-185-40-180Z','#e4cc9a')+line('M-73-149Q-58-139-34-144','#ab8753',1.5)+line('M-50-185Q-58-165-55-145','#e7d3a4',1.2));
 body+=S('M-7-200Q-29-197-33-179L-30-142-48-94Q-17-74 16-89L23-120 18-164 26-184Z',robe)+S('M-25-190Q-31-173-20-153L-25-126-40-91-48-94-30-142-33-179Q-30-190-25-190Z',dark)+S('M-7-144L9-138 16-89Q7-83-2-83L0-122Z',dark)+S('M-29-141Q-4-134 22-144L24-137Q-1-125-31-132Z',C.ink)+head({x:17,y:-204,tilt:pack?9:2,variant});
 body+=S('M-3-201L7-205 22-184 15-177Q1-189-3-201Z',C.cream)+S('M25-199L32-193 8-163-2-161 9-178Z','#dfc9ab');
 if(pack)body+=line('M-44-190Q-9-215 17-188L-15-123','#dbc59d',5)+line('M-44-191Q-9-215 17-188L-15-123','#a58b64',1);
 if(push){
  body+=P(limbPath([-17,-182],[3,-153],[58,-148],14,12,6),dark,'none',0,'data-part="push-far"')+P(limbPath([17,-182],[31,-151],[65,-150],17,13,6),robe,'none',0,'data-part="push-near"')+part('push-hand0',hand([0,0],0,skin[0]),'translate(58 -148)')+part('push-hand1',hand([0,0],0,skin[0]),'translate(65 -150)');
 }else{
 body+=part('arm-back',S('M-20-185Q-36-180-39-162L-35-134-20-126-12-139-20-157-9-175Z',dark)+S('M-22-141L-13-140-10-132-16-126-24-131Z',skin[1]));
 body+=part('arm-front',S('M18-188Q31-189 36-175L38-154Q38-144 29-142L6-151 10-166 23-163 18-174Z',robe)+S('M29-184Q39-174 38-154Q38-144 29-142L6-151 9-156 29-152Z',dark)+S('M6-169L14-166 9-150 1-153Z',C.cream)+S('M6-167L7-176Q11-182 15-179L18-173 14-164 10-162Z',skin[0])+line('M10-174l4 1',skin[2],.8));
 }
 body+=line('M-44-94Q-15-78 15-89',dark,1.4);
 s+=part('body',body);return wrap(id,push?'pusher':'traveller',s,`data-variant="${variant}"`);
}
export function workingPose(angle=0,kind='ladle',reach=0){
 const pivot=[60,-130],end=kind==='rake'?[300,-220]:[139,-176];
 const cup=rotatePoint(end,angle,pivot),base=rotatePoint([56,-128],angle,pivot);
 const unit=[cup[0]-base[0],cup[1]-base[1]],len=Math.hypot(...unit);unit[0]/=len;unit[1]/=len;
 const hands=[8,42].map(v=>[base[0]+unit[0]*v,base[1]+unit[1]*v]);
 const near=limbPath([2,-169],[5,-123+reach],hands[0],19,16,7),far=limbPath([31,-169],[52,-132-reach],hands[1],14,12,6);
 return {near,far,hands,cup,base,angle:Math.atan2(unit[1],unit[0])*180/Math.PI};
}
function hand(p,angle,skin){return g('',E(0,0,7,5,skin)+line('M-3-1l6 1','#b98562',.8),`translate(${p}) rotate(${angle})`);}
export function worker({id='',kind='ladle',variant=1}={}){
 const pose=workingPose(0,kind),skin=skins[variant%3];let s=shadow(59);
 s+=S('M-27-108L-5-97Q-14-68-30-43L-48-9-63-11Q-58-35-47-58Z','#294a55')+S('M-52-15L-48-5-39-1Q-37 3-44 3H-72Q-77 0-71-5L-63-16Z',C.ink)+S('M-6-111L13-99 15-62 9-17-8-17-12-65-30-95Z',C.roof)+S('M11-92L15-62 9-17H1L0-64Z','#294a55')+S('M-8-20L8-20 11-6Q25-7 32 0L31 3H-9Q-13-1-8-9Z',C.ink);
 let body=S('M12-185Q-8-183-24-161L-45-119Q-38-99-13-88L21-96Q13-124 20-145L42-164 37-180Z',C.roof)+S('M12-185Q-11-165-13-145L-28-112-13-88Q-37-99-45-119L-24-161Q-8-183 12-185Z','#294a55')+S('M-34-123Q-16-108 17-111L20-103Q-8-99-37-114Z',C.woodD)+S('M-17-111L-30-93 10-80 21-96 17-107Z','#b99a70')+line('M-22-100L9-89','#dfc9a4',1.4)+head({x:36,y:-188,tilt:19,variant})+S('M16-190L29-190 42-173 34-165Q18-174 16-190Z',C.cream)+S('M33-183L41-177 31-166 20-162 15-167Z','#91b1ad');
 body+=P(pose.far,'#294a55','none',0,'data-part="arm-far"')+P(pose.near,C.roof,'none',0,'data-part="arm-near"');
 let tool=kind==='rake'?line('M56-128L300-220',C.woodD,4.8)+line('M60-128L300-219','#b58d5e',1.1)+S('M290-224L309-232 315-217 297-210Z',C.woodD):line('M56-128L139-176',C.woodD,4.8)+line('M60-128L139-175','#b58d5e',1.1)+S('M123-178Q143-186 158-174L153-164Q137-160 126-169Z',C.ink)+E(141,-176,16,4,C.gold);
 body+=part('tool',tool)+part('hand-near',hand([0,0],0,skin[0]),`translate(${pose.hands[0]}) rotate(${pose.angle})`)+part('hand-far',hand([0,0],0,skin[0]),`translate(${pose.hands[1]}) rotate(${pose.angle})`)+P('M156-174V-140','none',C.gold,3,'data-part="pour" opacity="0"');
 s+=part('body',body);return wrap(id,'worker',s,`data-tool="${kind}"`);
}
export function guard({id='',variant=0}={}){
 const skin=skins[variant%3];let body=S('M-24-195Q0-207 25-193L30-137 38-87Q1-73-37-87L-28-138Z',C.roof)+S('M-24-194L-31-139-37-87-15-82-14-142Z','#294a55')+S('M-22-188L-7-198 4-178 18-198 27-187 18-150-18-150Z',C.ink)+N(4,i=>line(`M-18 ${-182+i*8}Q0 ${-174+i*8} 19 ${-182+i*8}`,'#638385',1.3))+R(-29,-142,59,8,C.woodD)+head({x:0,y:-205,tilt:0,cap:true,front:variant===1,variant});
 body+=part('spear',line('M57 0V-278',C.woodD,4)+S('M57-299L48-276 57-280 66-276Z','#8da9a7')+S('M57-299V-280L66-276Z',C.ink));
 body+=S('M-22-189Q-37-187-39-166L-32-130-18-135-20-169Z',C.roof)+S('M23-188L37-169 52-181 60-169 38-151Q26-151 20-165Z',C.roof)+S('M51-182Q57-188 62-181L61-173 55-170Z',skin[0]);
 body+=S('M-41-145Q-24-151-12-140L-11-100Q-25-89-41-102Z',C.woodD)+line('M-27-141V-103',C.gold,2)+E(-27,-121,4,4,C.gold);
 return wrap(id,'guard',shadow(43)+S('M-29-93L-27-14-36-5H-8L-4-91Z',C.ink)+S('M6-91L9-13 24-4Q29 3 20 3H1L-8-87Z',C.ink)+part('body',body));
}
export function person({role='civilian',id='',robe=C.red,variant=0,flip=false,royal=false,pack=false}={}){
 let s=role==='official'?official({id,robe,variant}):role==='royal'||royal?official({id,robe,royal:true,variant,plain:true}):role==='worker'?worker({id,variant}):role==='guard'?guard({id,variant}):role==='pusher'?traveller({id,robe,variant,pack:false,push:true}):role==='traveller'?traveller({id,robe,variant,pack:true}):traveller({id,robe,variant,pack});
 return flip?g('',s,'scale(-1 1)'):s;
}
