import {C,N,g,at,P,R,L,E,T,U,trace,title,tag} from './drawing.mjs';
export {C,N,g,at,P,R,L,E,T,U,trace,title,tag} from './drawing.mjs';
import {person} from './people.mjs';
export function tree(x=0,y=0,k=1){return at(P('M-5 0L-2-80H5L8 0Z',C.woodD,'none')+P('M0-21L-23-45M2-43L25-62','none',C.woodD,4)+P('M-41-57Q-50-80-28-90Q-25-121 0-116Q30-121 34-92Q57-79 39-55Q19-37 2-48Q-24-34-41-57Z',C.green,'none')+P('M-38-76Q-34-54-14-53Q1-56 8-67Q27-54 41-75Q48-52 24-46L2-47Q-22-34-41-57Q-47-66-38-76Z','#376c5e','none')+P('M-20-91Q-9-110 9-99M14-86Q26-83 29-75','none',C.greenL,3),x,y,k);}
export function human({robe=C.red,pose='stand',hat=false,flip=false,royal=false,variant=0}={}){
 const role=royal?'royal':pose==='scroll'?'official':pose==='work'?'worker':pose==='guard'?'guard':hat?'official':'civilian';
 return at(person({role,robe,flip,royal,variant}),0,0,.64);
}
export function roof(w=480,h=105){
 const r=w*.28;let s=P(`M${-w/2-24} 15Q${-w/2+3} 4 ${-w/2+18} -19L${-r} ${-h}H${r}L${w/2-18} -19Q${w/2-3} 4 ${w/2+24} 15L${w/2+12} 29H${-w/2-12}Z`,C.roof,C.ink,2.3);
 s+=P(`M${r} ${-h}L${w/2-18}-19Q${w/2-3} 4 ${w/2+24} 15L${w/2+12} 29H${w*.30}Z`,'#294c58','none');
 s+=N(Math.floor(w/32),i=>{let x=-w/2+15+i*32;return P(`M${x*.57} ${-h+5}Q${x*.82} ${-h*.45} ${x} 13`,'none','#719294',1.25);});
 s+=N(4,i=>{let v=(i+1)/5,yy=-h+h*v,ww=r+(w/2-r)*v;return P(`M${-ww} ${yy}Q0 ${yy-5} ${ww} ${yy}`,'none','#719294',1.15);});
 s+=L(-r-6,-h-5,r+6,-h-5,C.ink,6)+L(-r,-h-8,r,-h-8,C.water,1.3)+P(`M${-w/2-18} 18Q0 27 ${w/2+18} 18`,'none',C.ink,6)+P(`M${-w/2-18} 12Q0 20 ${w/2+18} 12`,'none','#a5c4b9',1.8);
 s+=N(Math.floor(w/27),i=>E(-w/2+12+i*27,24,3,2,C.cream));return s;}
export function hall({w=520,roofId='',cutaway=false,label='王国官署'}={}){
 const h=210;let s=R(-w/2-30,-18,w+60,18,C.ink)+R(-w/2-18,-38,w+36,20,C.cream,C.ink,2)+R(-w/2,-h,w,h-38,C.cream,C.ink,2)+R(-w/2+12,-h+10,w-24,h-61,C.ink);
 for(let i=0;i<3;i++){const x=-w/2+25+i*w/3;s+=R(x,-h+12,w/3-50,h-60,cutaway?C.pale:C.woodD);if(!cutaway)s+=N(5,j=>L(x+8+j*(w/3-62)/4,-h+18,x+8+j*(w/3-62)/4,-55,C.goldL,1.2));}
 s+=N(4,i=>R(-w/2+10+i*(w-20)/3,-h-13,10,h-25,C.red,C.ink,1))+R(-w/2-7,-h-13,w+14,18,C.woodD,C.ink,2)+N(11,i=>P(`M${-w/2+15+i*(w-30)/10} ${-h}v16h15v-16`,'none',C.gold,3));
 s+=g(roofId,at(roof(w+50,110),0,-h-12));s+=R(-65,-h+32,130,41,C.red,C.ink,2)+T(label,0,-h+61,25,C.paper,'title','middle');
 s+=N(4,i=>R(-67-i*17,-18+i*12,134+i*34,12,C.cream,C.ink,1.5));return s;
}
export function house(k=1){return g('',R(-48,-97,96,94,C.cream,C.ink,2)+R(-48,-97,23,94,'#d0c7af')+R(-12,-57,26,54,C.woodD,C.ink,2)+R(-35,-64,17,25,C.paper,C.ink,2)+N(3,i=>L(-32+i*5,-61,-32+i*5,-42,C.ink,1))+at(roof(106,38),0,-104)+L(-60,0,62,0,C.ink,3),'scale('+k+')');}
export function coin(){return E(0,0,31,31,C.goldD,C.ink,2)+E(-2,-3,29,29,C.gold,C.ink,1.8)+E(-2,-3,23,23,'none',C.goldL,2)+R(-10,-11,16,16,C.paper,C.ink,1.3)+P('M-4-22v5m-18 12h5M-4 13v5m13-23h5','none',C.woodD,2);}
export function sack(){return P('M-22-5Q-35-19-26-47L-12-69-17-78 0-74 16-78 13-68Q33-44 28-20Q27-3 13-3Z',C.gold,C.ink,2)+P('M12-66Q29-34 16-7Q29-4 29-25Q27-47 13-68Z',C.goldD,'none')+L(-13,-68,14,-68,C.woodD,3)+P('M-19-39Q-22-21-15-16','none',C.goldL,3);}
export function furnace(){return R(-70,-8,140,18,C.woodD,C.ink,2)+P('M-58-8V-103Q-51-139-31-141V-178H28V-143Q53-138 58-103V-8Z',C.red,C.ink,3)+P('M20-174V-141Q42-127 43-99V-8H58V-104Q50-135 28-143V-178Z',C.redD,'none')+P('M-29-9V-45A29 29 0 0 1 29-45V-9Z',C.ink,C.ink,2)+P('M-19-16Q-29-32-8-49Q-12-27 2-35L9-57Q32-28 18-16Z',C.gold,'none')+P('M-54-100H52M-56-78H55M-44-124H40','none','#e89567',2)+L(-21,-170,-21,-146,C.goldL,2);}
export function saltpan(){return R(-110,-12,220,20,C.woodD,C.ink,2)+P('M-94-12V-76H94V-12Z',C.red,C.ink,2)+P('M-30-12V-39A30 30 0 0 1 30-39V-12Z',C.ink,C.ink,2)+P('M-17-19L-7-52 5-33 17-53 24-19Z',C.gold,'none')+P('M-132-96Q0-63 132-96L110-67Q0-42-110-67Z',C.ink,C.ink,2)+E(0,-96,132,27,C.water,C.ink,3)+P('M-105-97Q-34-114 65-98M-60-85Q0-75 84-89','none',C.paper,3);}
export function flag(word='王',color=C.gold){return L(0,0,0,-250,C.ink,5)+E(0,-254,6,6,C.gold)+P('M3-240Q48-253 112-235L106-145Q53-162 3-148Z',color,C.ink,2.5)+P('M15-228Q62-236 97-223','none',C.paper,1.5)+T(word,54,-177,44,C.ink,'title','middle');}
export function castle(){return R(-160,-165,320,165,C.roof,C.ink,3)+R(-176,-211,85,211,C.ink)+R(91,-211,85,211,C.ink)+N(7,i=>R(-155+i*47,-185,27,26,C.roof,C.ink,2))+P('M-43 0V-70A43 43 0 0 1 43-70V0Z',C.woodD,C.ink,2)+N(5,i=>L(-31+i*15,-71,-31+i*15,-3,C.gold,1.5))+N(5,i=>L(-86,-143+i*27,86,-143+i*27,'#92b6b2',1.3))+at(roof(86,39),-133,-222)+at(roof(86,39),133,-222)+R(-150,-184,34,48,C.roof)+R(116,-184,34,48,C.roof);}
export function terrain(){return P('M0 690Q180 535 390 636Q590 447 823 605Q1060 471 1240 594Q1550 476 1920 615V970H0Z',C.pale,'none')+P('M0 775Q325 652 623 751Q987 625 1223 719Q1620 644 1920 738V970H0Z','#e4e5d7','none')+P('M0 882Q450 768 816 840Q1160 775 1520 853Q1770 791 1920 831V970H0Z',C.cream,'none');}
export function residence(){return P('M-120-112H116L143-92V0H-120Z',C.cream,C.ink,2)+P('M116-112L143-92V0H116Z','#d2c9b2','none')+R(-117,-12,234,12,C.woodD)+R(32,-67,42,67,C.woodD,C.ink,2)+R(39,-60,28,60,C.ink)+N(3,i=>R(-96+i*39,-72,27,34,C.paper,C.ink,1.5)+N(3,j=>L(-90+i*39+j*7,-67,-90+i*39+j*7,-42,C.woodD,1.3)))+
 P('M-142-116L-95-172H91L138-116 130-107H-133Z','#53797b',C.ink,2.3)+P('M91-172H117L164-116 156-107H130L138-116Z','#345762',C.ink,2)+
 N(12,i=>L(-90+i*16,-166,-131+i*23,-116,'#8ca8a0',1.1))+N(3,i=>L(-105-i*10,-153+i*13,103+i*11,-153+i*13,'#8ca8a0',1))+
 L(-96,-174,118,-174,C.ink,5)+L(-140,-114,163,-114,C.ink,5)+L(-133,-108,156,-108,C.wood,2)+L(-128,1,150,1,C.ink,3);}
export function homestead(variant=0){return P('M-121-104H102L132 20H-126Z','#d9d1ba',C.woodD,1.5)+
 at(residence(),-5,-97,.79)+
 P('M-123-98L-98-81V14H-123Z','#c8c0a8',C.woodD,1.5)+L(-121,-97,-97,-80,C.roof,4)+
 at(residence(),variant?86:89,-21,variant?.35:.39)+
 P('M17-43L-4 18H27L41-43Z','#ebe2cb','none')+
 R(-126,8,110,22,C.cream,C.woodD,1.5)+R(29,8,105,22,C.cream,C.woodD,1.5)+
 L(-128,7,-16,7,C.roof,4)+L(29,7,136,7,C.roof,4)+
 R(-21,-6,6,38,C.woodD)+R(28,-6,6,38,C.woodD)+L(-26,-7,40,-7,C.woodD,5)+
 E(-56,-33,14,8,'#c4b89b')+P('M-68-36v-12q12-7 24 0v12q-12 8-24 0Z',C.wood,C.woodD,1.2)+
 L(-126,32,136,32,C.ink,1.5);}
export function landscape(prefix){return g(prefix+'-ground',P('M0 290Q320 220 650 268Q1070 215 1500 270V560Q1180 576 850 567Q420 580 0 560Z',C.pale,'none')+P('M0 450Q300 370 660 425Q1100 365 1500 429V560Q1180 576 850 567Q420 580 0 560Z',C.cream,'none')+P('M0 510H1500','none',C.ink,2))+
 g(prefix+'-hall',at(hall({w:430}),440,365,.83))+
 g(prefix+'-homes',at(homestead(),818,438,.88)+at(homestead(1),1130,441,.92)+tree(1255,396,.74))+
 g(prefix+'-fields',N(4,i=>{const x=[680,800,1035,1155][i];return P(`M${x} 535l30-55h89l-30 55Z`,i%2?C.greenL:C.goldL,C.ink,1.5)+N(5,j=>L(x+10+j*16,528,x+35+j*16,486,C.green,1.2));}))+
 g(prefix+'-people',N(6,i=>at(human({robe:i%2?C.green:C.red,pose:i%3?'stand':'scroll',variant:i%3,flip:i===2||i===4}),[665,718,821,997,1103,1250][i],[429,474,477,444,480,474][i],.43)))+
 g(prefix+'-industry',at(furnace(),1350,335,.64)+at(saltpan(),1374,453,.53)+N(3,i=>at(sack(),1305+i*36,505,.6)))+
 tree(70,455,1.0)+tree(148,425,.8)+tree(686,337,.65)+tree(740,359,.45)+g(prefix+'-banner',at(flag(),237,385,.7));}
export function defs(){return `<defs><g id="art-person">${human()}</g><g id="art-clerk">${human({robe:C.green,pose:'scroll',hat:true})}</g><g id="art-worker">${human({robe:C.roof,pose:'work'})}</g><g id="art-guard">${human({robe:C.roof,pose:'guard',hat:true})}</g><g id="art-house">${house()}</g><g id="art-coin">${coin()}</g><g id="art-sack">${sack()}</g><g id="art-hall">${hall()}</g><g id="art-castle">${castle()}</g><clipPath id="art-stage">${R(0,0,1920,970,C.paper)}</clipPath><marker id="art-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>`;}
