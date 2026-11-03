export const C={paper:'#f4f1e8',ink:'#203b43',muted:'#657c7c',line:'#b7c0b6',gold:'#e3ae4f',goldDark:'#b87b31',goldLight:'#f2cf80',red:'#c9563c',redLight:'#edd0bc',green:'#4c8b79',greenLight:'#a5c5ae',water:'#b6d5d5',waterInk:'#689aab',wood:'#b78960',woodDark:'#775b44',cream:'#e6dec9',pale:'#e7ebe1',roof:'#3d6570',white:'#fffdf5'};
export let ctx;
export const setContext=c=>ctx=c;
export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const lerp=(a,b,p)=>a+(b-a)*p;
export const smooth=p=>{p=clamp(p);return p*p*p*(p*(p*6-15)+10)};
export const progress=(t,a,b)=>smooth((t-a)/(b-a));
export const linear=(t,a,b)=>clamp((t-a)/(b-a));
export const out=p=>1-Math.pow(1-clamp(p),3);
export const pop=p=>{p=clamp(p);return 1+2.25*Math.pow(p-1,3)+1.25*Math.pow(p-1,2)};
const paths=new Map();
function cached(d){if(!paths.has(d))paths.set(d,new Path2D(d));return paths.get(d);}
export function path(d,fill=null,stroke=C.ink,width=3){const p=typeof d==='string'?cached(d):d;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.stroke(p);}}
export function line(x1,y1,x2,y2,color=C.ink,w=3,dash=[]){ctx.save();ctx.beginPath();ctx.setLineDash(dash);ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=w;ctx.lineCap='round';ctx.stroke();ctx.restore();}
export function rect(x,y,w,h,color=C.paper,stroke=null,r=0,lw=3){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(color){ctx.fillStyle=color;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}}
export function circle(x,y,r,color=C.ink,stroke=null,lw=3){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(color){ctx.fillStyle=color;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}}
export function ellipse(x,y,rx,ry,color=C.ink,stroke=null,lw=3){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(color){ctx.fillStyle=color;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}}
export function text(s,x,y,size=40,color=C.ink,weight='normal',align='left'){ctx.fillStyle=color;ctx.font=`${size}px ${weight==='bold'?'MGBlack':'MG'}`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(String(s),x,y);}
export function group(x,y,s=1,r=0,fn=()=>{},a=1){if(a<=0)return;ctx.save();ctx.globalAlpha*=a;ctx.translate(x,y);ctx.rotate(r);ctx.scale(s,s);fn();ctx.restore();}
export function alpha(a,fn){if(a<=0)return;ctx.save();ctx.globalAlpha*=clamp(a);fn();ctx.restore();}
export function clipBox(x,y,w,h,fn){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();fn();ctx.restore();}
export function arrow(x1,y1,x2,y2,color=C.ink,w=4,head=12){line(x1,y1,x2,y2,color,w);const a=Math.atan2(y2-y1,x2-x1);group(x2,y2,1,a,()=>path(`M${-head} ${-head*.6}L0 0 ${-head} ${head*.6}`,null,color,w));}
export function curvedArrow(points,p=1,color=C.ink,w=3){const [a,b,c,d]=points;const q=new Path2D();q.moveTo(a.x,a.y);const steps=50,end=clamp(p);let prev=a,last=a;for(let i=1;i<=steps;i++){const f=end*i/steps;last=bezier(a,b,c,d,f);q.lineTo(last.x,last.y);if(i===steps-1)prev=last;}path(q,null,color,w);if(p>.01){const ang=Math.atan2(last.y-prev.y,last.x-prev.x);group(last.x,last.y,1,ang,()=>path('M-13 -7L0 0 -13 7',null,color,w));}}
export function bezier(a,b,c,d,p){const q=1-p;return{x:q*q*q*a.x+3*q*q*p*b.x+3*q*p*p*c.x+p*p*p*d.x,y:q*q*q*a.y+3*q*q*p*b.y+3*q*p*p*c.y+p*p*p*d.y};}
export function arcTravel(a,b,p,lift=80){return{x:lerp(a.x,b.x,p),y:lerp(a.y,b.y,p)-Math.sin(Math.PI*p)*lift};}
export function underline(x,y,w,p=1,color=C.red){path(`M${x} ${y}Q${x+w*.45*clamp(p)} ${y+8} ${x+w*clamp(p)} ${y-2}`,null,color,7);}
export function title(first,second='',p=1){clipBox(104,53,1720,198,()=>{text(first,116,142+(1-out(p))*100,76,C.ink,'bold');if(second)text(second,120,203+(1-out(p))*100,34,C.muted);});}
export function badge(s,x,y,color=C.red,size=34){const w=s.length*size+36;rect(x-w/2,y-size-10,w,size+26,C.paper,color,2,2);text(s,x,y,size,color,'bold','center');}
export function datum(n,label,x,y,color=C.ink,size=136,align='left'){text(n,x,y,size,color,'bold',align);text(label,x,y+49,34,C.muted,'normal',align);}
export function bag(x,y,s=1,{color=C.gold,rotation=0,fill=1,mark=true,shadow=true,stretch=1,opened=0}={}){
 group(x,y,s,rotation,()=>{
  if(shadow)ellipse(1,4,39,7,'#203b4314');ctx.scale(1/stretch,stretch);
  path('M-31-14Q-43-30-34-58L-19-94 -23-103Q-13-100-10-106L2-100 14-104 17-95Q36-66 37-39Q41-14 25-9Q0-1-31-14Z',color,C.ink,2.6);
  path('M18-91Q28-61 26-35Q24-18 10-11Q38-10 37-39Q35-67 17-95Z',color===C.green?'#397461':C.goldDark,null);
  path('M-19-92Q-4-88 16-94M-20-88Q-3-84 18-90',null,C.ink,2.2);
  alpha(1-opened,()=>path('M-5-89Q-16-77-22-81Q-30-86-20-89Q-13-91-5-89Q10-83 14-73M-3-87L-7-72',null,C.woodDark,2.2));
  if(opened>0)alpha(opened,()=>{ellipse(-2,-98,18,5,C.woodDark,C.ink,2);path('M-18-91Q-30-80-30-69M13-91Q25-77 21-70',null,C.woodDark,2);});
  path('M-26-54Q-32-32-22-22M-18-19L-5-17M-27-65L-25-69',null,color===C.green?C.greenLight:C.goldLight,3);
  if(mark){group(-2,-48,.75,0,()=>{line(0,-20,0,20,color===C.green?C.white:C.ink,2);for(let j=0;j<4;j++){ellipse(-5,-15+j*8,4,2.2,color===C.green?C.white:C.ink);ellipse(5,-11+j*8,4,2.2,color===C.green?C.white:C.ink);}});}
  if(fill<1){clipBox(-48,-116,100,116*(1-fill),()=>{path('M-31-14Q-43-30-34-58L-19-94 -23-103Q-13-100-10-106L2-100 14-104 17-95Q36-66 37-39Q41-14 25-9Q0-1-31-14Z',C.paper,C.line,2.6);});}
 });
}
export function bagOutline(x,y,s=1,color=C.red){group(x,y,s,0,()=>{ctx.save();ctx.setLineDash([6,8]);path('M-30-12Q-43-31-33-58L-17-92H15Q36-62 36-33Q37-9 17-8H-13Z',null,color,2.6);ctx.restore();line(-19,8,24,8,color,2);});}
export function wheat(x,y,s=1,color=C.goldDark){group(x,y,s,0,()=>{path('M0 8Q3-14 0-37',null,color,2);for(let i=0;i<4;i++){path(`M0 ${-30+i*8}Q-13 ${-40+i*8}-9 ${-29+i*8}Q-6 ${-25+i*8}0 ${-23+i*8}`,color,null);path(`M1 ${-24+i*8}Q14 ${-35+i*8}10 ${-23+i*8}Q5 ${-19+i*8}1 ${-17+i*8}`,color,null);}});}
export function wheel(x,y,r=27,angle=0){group(x,y,1,angle,()=>{circle(0,0,r,C.paper,C.ink,3);circle(0,0,r-6,null,C.woodDark,3);for(let i=0;i<8;i++){const a=i*Math.PI/4;line(Math.cos(a)*5,Math.sin(a)*5,Math.cos(a)*(r-7),Math.sin(a)*(r-7),C.woodDark,3);}circle(0,0,6,C.gold,C.ink,2);});}
export function ox(x,y,s=1,phase=0){group(x,y,s,0,()=>{
  for(let i=0;i<4;i++){const hip=i<2?-28:48;const a=Math.sin(phase+(i%2)*Math.PI+(i>1?Math.PI:0))*.42;const knee={x:hip+Math.sin(a)*24,y:-27+Math.cos(a)*20},foot={x:knee.x+Math.sin(-a)*20,y:-7};line(hip,-43,knee.x,knee.y,i%2?C.woodDark:C.ink,10);line(knee.x,knee.y,foot.x,foot.y,i%2?C.woodDark:C.ink,7);line(foot.x-6,0,foot.x+6,0,C.ink,7);}
  path('M-55-70Q-42-91-12-83L33-83Q49-92 64-84L78-63Q91-61 94-47L74-36 60-49Q44-46 27-40H-21Q-48-43-55-70Z',C.wood,C.ink,3);
  path('M-47-70Q-61-66-65-48Q-68-34-76-37',null,C.ink,3);path('M53-80Q54-101 67-105Q62-92 70-88M69-82Q80-99 90-95Q80-88 81-78',C.cream,C.ink,2);
  path('M61-70Q44-83 45-69L58-62M73-71Q83-83 91-73L81-65',C.woodDark,C.ink,2);circle(75,-61,2.5,C.ink);path('M76-42L87-44',null,C.woodDark,2);line(50,-72,54,-47,C.red,6);path('M33-79Q24-66 29-51',null,C.goldLight,2);line(54,-55,93,-52,C.ink,2);
 });}
export function cart(x,y,s=1,travel=0,{loaded=true,animal=true,amount=1,highlight=false}={}){group(x,y,s,0,()=>{
 ellipse(6,7,93,8,'#203b4310');line(-73,-51,137,-33,C.woodDark,7);line(74,-52,151,-37,C.woodDark,5);
 if(animal){ox(187,0,.82,travel*.06);path('M140-38Q153-35 180-45',null,C.ink,2.2);}
 path('M-86-76H69L60-34H-77Z',C.wood,C.ink,3);rect(-80,-72,143,9,C.goldDark,C.ink,0,2);for(let j=0;j<4;j++)line(-67+j*35,-70,-64+j*34,-37,C.woodDark,3);line(-77,-48,64,-48,C.goldLight,2);
 if(loaded){for(let i=0;i<amount;i++)bag(-(amount-1)*19.5+i*39,-73,.55,{mark:true,shadow:false});}
 line(-90,-78,-87,-30,C.ink,5);line(71,-78,68,-30,C.ink,5);wheel(-48,-12,27,travel/27);wheel(41,-12,27,travel/27);
 if(highlight){path('M-85-114Q0-144 78-109',null,C.red,3);}
 });}
export function flag(x,y,s=1,t=0,color=C.red){group(x,y,s,0,()=>{line(0,0,0,-180,C.ink,5);circle(0,-184,5,C.gold);const w=Math.sin(t*1.7)*5;path(`M3-174Q43 ${-184+w} 93-167L84-126Q41 ${-137-w}3-127Z`,color,C.ink,2.5);path(`M15-164Q40 ${-169+w}67-158`,null,C.redLight,2);});}
export function warehouse(x,y,s=1,{open=0,stocks=12,label=false}={}){group(x,y,s,0,()=>{
 rect(-188,-10,376,18,C.cream,C.ink,1,3);rect(-162,-236,324,225,C.cream,C.ink,0,3);rect(-119,-202,238,183,C.ink);
 for(let i=0;i<stocks;i++){const col=i%4,row=Math.floor(i/4);bag(-83+col*56,-28-row*61,.62,{shadow:false,mark:row===0});}
 for(const side of [-1,1]){group(side*121,-201,1,0,()=>{ctx.scale(1-open*.93,1);rect(side===-1?0:-119,0,119,185,C.wood,C.ink,0,3);for(let j=1;j<5;j++)line((side===-1?0:-119)+j*24,4,(side===-1?0:-119)+j*24,179,C.woodDark,2);line(side===-1?6:-112,40,side===-1?112:-6,40,C.goldLight,4);line(side===-1?6:-112,142,side===-1?112:-6,142,C.goldLight,4);circle(side===-1?105:-105,97,4,C.ink);});}
 for(const xx of [-159,-127,127,159])rect(xx-5,-229,10,217,C.woodDark,C.ink,0,1.5);
 path('M-196-229Q-176-234-163-263L-8-313Q0-319 8-313L163-263Q176-234 196-229L174-218H-174Z',C.roof,C.ink,3.5);
 for(let j=0;j<18;j++){const xx=-169+j*20;const top=-302+Math.abs(xx)*.24;path(`M${xx} ${top}Q${xx-5} -253 ${xx-11} -229`,null,'#8cb0ad',2);}
 path('M-169-257Q0-295 169-257M-184-238Q0-253 184-238',null,'#8cb0ad',2);line(-10,-314,10,-314,C.ink,7);rect(-53,-220,106,44,C.red,C.ink,1,2);text('粮',0,-187,32,C.white,'bold','center');
 if(label)text('后方粮仓',0,68,47,C.ink,'bold','center');
 });}
export function tent(x,y,s=1,color=C.cream){group(x,y,s,0,()=>{
 path('M-115 0L-62-23 0-160 66-23 120 0Z',color,C.ink,3);path('M0-160L40-14 66-23Z',color===C.red?'#a84332':'#c4cbb9',null);path('M-28-3L0-93 28-3Z',C.ink,C.ink,2);line(0,-177,0,-153,C.ink,4);line(-62,-23,-138,-4,C.ink,2);line(66,-23,142,-4,C.ink,2);line(-140,-8,-140,5,C.woodDark,5);line(142,-8,142,5,C.woodDark,5);path('M-78-10L-13-139M63-10L15-139',null,color===C.red?C.redLight:C.white,2);
 });}
export function pot(x,y,s=1,t=0,food=1){group(x,y,s,0,()=>{
 path('M-53-54Q-48-3 0 0Q48-3 53-54Z',C.ink,C.ink,3);ellipse(0,-54,53,13,C.paper,C.ink,3);if(food>0)ellipse(0,-52,44,8,C.gold);path('M-51-48Q-75-56-72-35Q-68-24-51-26M51-48Q75-56 72-35Q68-24 51-26',null,C.ink,5);line(-26,-2,-34,14,C.ink,7);line(26,-2,34,14,C.ink,7);
 if(food>0){for(let j=0;j<3;j++){const p=(t*.42+j*.31)%1;alpha((1-p)*.6,()=>path(`M${-28+j*26} ${-69-p*55}Q${-42+j*26} ${-90-p*55} ${-24+j*26} ${-106-p*55}`,null,C.muted,3));}}
 });}
export function camp(x,y,s=1,t=0,{stock=4,steam=false,label=false}={}){group(x,y,s,0,()=>{
 tent(-173,-54,.86);tent(124,-50,.9);tent(-22,0,1.2,C.red);flag(218,-15,1.05,t);pot(-263,-5,.72,t,steam?1:0);for(let i=0;i<stock;i++)bag(244+(i%3)*40,-5-Math.floor(i/3)*56,.52,{shadow:false});
 path('M-341 16H348',null,C.ink,3);for(let i=0;i<9;i++){line(-315+i*76,12,-315+i*76,36,C.woodDark,3);}if(label)text('前线军营',5,96,47,C.ink,'bold','center');
 });}
export function city(x,y,s=1){group(x,y,s,0,()=>{
 rect(-170,-264,340,262,'#b9c9c4',C.ink,0,3);for(let i=0;i<9;i++)rect(-178+i*42,-294,29,45,C.roof,C.ink,0,2);path('M-44 0V-103Q-44-157 0-157Q44-157 44-103V0Z',C.ink,C.ink,3);line(0,-147,0,-5,C.wood,2);for(let row=0;row<6;row++){line(-169,-31-row*37,169,-31-row*37,'#8fa9a4',2);for(let col=0;col<7;col++)line(-166+col*54+(row%2)*27,-31-row*37,-166+col*54+(row%2)*27,-63-row*37,'#8fa9a4',2);}rect(-204,-334,77,334,C.roof,C.ink,0,3);rect(127,-334,77,334,C.roof,C.ink,0,3);for(const k of [-166,166]){path(`M${k-57}-333L${k}-390 ${k+57}-333Z`,C.red,C.ink,3);rect(k-13,-290,26,48,C.ink);}
 });}
export function bridge(x,y,s=1,t=0,{wide=0}={}){group(x,y,s,0,()=>{
 const h=1+wide*.45;ctx.scale(h,1);
 path('M-159 0V114H-104Q-99 30 0 28Q99 30 104 114H159V0Z',C.cream,C.ink,3);path('M-159 0V14H159V0Z',C.wood,C.ink,3);
 for(let j=0;j<12;j++){line(-150+j*27,0,-150+j*27,12,C.woodDark,2);}
 for(let i=0;i<7;i++){line(-150+i*50,-50,-150+i*50,-5,C.ink,5);circle(-150+i*50,-51,4,C.gold);}line(-152,-41,152,-41,C.woodDark,6);line(-152,-15,152,-15,C.woodDark,4);
 for(let k=0;k<8;k++){const a=Math.PI+(k+.5)*Math.PI/8;line(Math.cos(a)*104,106+Math.sin(a)*79,Math.cos(a)*123,105+Math.sin(a)*92,'#9ca89b',2);}
 });}
export function bowl(x,y,s=1,filled=0,t=0){group(x,y,s,0,()=>{
 path('M-40-16Q-32 18 0 21Q32 18 40-16Z',filled?C.roof:C.paper,filled?C.ink:C.line,2.4);ellipse(0,-16,40,10,filled?C.goldLight:C.paper,filled?C.ink:C.line,2.4);if(filled){for(let i=0;i<7;i++)ellipse(-23+i*8,-18+(i%2)*4,3.3,1.5,C.goldDark);line(-20,11,20,11,'#8aadb1',2);}
 });}
export function grainPour(x1,y1,x2,y2,p,amount=12){for(let i=0;i<amount;i++){const q=clamp(p*1.9-i*.055);if(q<=0||q>=1)continue;const x=lerp(x1,x2,q)+Math.sin(i*1.7)*12*Math.sin(q*Math.PI),y=lerp(y1,y2,q);group(x,y,1,i*.7,()=>ellipse(0,0,4,2,C.goldDark));}}
export function stockRack(x,y,cols=5,rows=4,gapX=130,gapY=88){const w=(cols-1)*gapX+90;for(let r=0;r<rows;r++){line(x-51,y-r*gapY+8,x+w-39,y-r*gapY+8,C.woodDark,4);line(x-51,y-r*gapY+14,x+w-39,y-r*gapY+14,C.cream,5);}for(const xx of [x-54,x+w-34])line(xx,y+21,xx,y-(rows-1)*gapY-102,C.woodDark,6);}
export function dayStrip(x,y,count=6,current=0,width=1200){const gap=width/(count-1);line(x,y,x+width,y,C.line,3);if(current>0)line(x,y,x+(Math.min(current,count)-1)*gap,y,C.red,5);for(let i=0;i<count;i++){circle(x+i*gap,y,i+1===current?10:6,i<current?C.red:C.line);text(String(i+1),x+i*gap,y+46,30,i+1===current?C.red:C.muted,i+1===current?'bold':'normal','center');}text('天',x+width+50,y+45,30,C.muted);}
export function calendar(x,y,day,s=1,color=C.ink){group(x,y,s,0,()=>{rect(-62,-83,124,124,C.white,color,5,3);rect(-62,-83,124,28,color);for(const xx of [-31,31])line(xx,-94,xx,-69,C.paper,6);text(day,0,13,68,color,'bold','center');});}
export function backdrop(){rect(0,0,1920,1080,C.paper);}
export function world(camX=1630,camY=510,scale=.54,t=0,{open=1,stock=4,backStock=12,steam=false,wide=0,labels=false,showBridge=true}={}){
 ctx.save();ctx.translate(960,590);ctx.scale(scale,scale);ctx.translate(-camX,-camY);
 // A flat, illustrated side-elevation world. Every object's ground is y=720.
 path('M-600 650Q-100 535 230 605T830 589Q1100 406 1350 563Q1460 642 1730 544Q1950 417 2180 575Q2460 445 2760 578Q3050 500 3620 610L3620 744H-600Z',C.pale,null);
 for(let k=0;k<8;k++){const xx=-100+k*480;path(`M${xx} 600Q${xx+80} 565 ${xx+170} 594`,null,'#d0d9ce',2);}
 path('M1510 656Q1560 610 1630 656L1710 938Q1583 976 1470 934Z',C.water,null);for(let j=0;j<8;j++){const yy=748+j*23,off=(t*13+j*17)%50;path(`M${1500+off} ${yy}q35 6 68 0`,null,C.waterInk,2);}
 rect(-600,718,4200,23,C.cream);line(-600,718,1460,718,C.ink,3);line(1770,718,3620,718,C.ink,3);line(-600,742,1460,742,'#b7baa7',2);line(1770,742,3620,742,'#b7baa7',2);
 warehouse(430,718,1.07,{open,stocks:backStock,label:labels});if(showBridge)bridge(1615,718,1,t,{wide});camp(2610,718,1,t,{stock,steam,label:labels});city(3320,718,.95);
 for(let j=0;j<4;j++){for(let i=0;i<11;i++)wheat(110+i*35,852+j*24,.57,C.goldDark);}
 for(const xx of [1070,1160,2040,2140,3010]){path(`M${xx} 717l-10-22m10 22 9-19m-9 19-2-30`,null,C.green,3);}
 if(labels)text('河上窄桥',1615,591,43,C.ink,'bold','center');
 return ()=>ctx.restore();
}
