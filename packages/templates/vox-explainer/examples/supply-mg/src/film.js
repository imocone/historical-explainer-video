import * as G from './graphics.js';
import D from '../timing.json';
const {C,clamp,lerp,progress,linear,smooth,out,pop,path,line,rect,circle,ellipse,text,group,alpha,clipBox,arrow,curvedArrow,arcTravel,underline,title,datum,bag,bagOutline,cart,warehouse,camp,bridge,bowl,pot,grainPour,stockRack,dayStrip,calendar,world}=G;
const canvas=document.getElementById('mg-canvas'),ctx=canvas.getContext('2d',{alpha:false});G.setContext(ctx);
const duration=D.duration;
const globalMoment=id=>D.scenes.find(s=>s.id===id).start;
const note=(s,y=888)=>text(s,118,y,30,C.muted);
// A short compression at contact gives weight without an ornamental bounce.
const landing=(t,end)=>1-.085*Math.sin(Math.PI*linear(t,end-.12,end+.14));
function rollingNumber(before,after,p,x,y,size,color=C.ink,align='center'){
 clipBox(x-(align==='right'?size*2.8:size*1.55),y-size*1.12,size*3.2,size*1.24,()=>{
  alpha(1-p,()=>text(before,x,y-p*size*.74,size,color,'bold',align));
  alpha(p,()=>text(after,x,y+(1-p)*size*.74,size,color,'bold',align));
 });
}
function marker(x,y,s,t,color=C.red){alpha(progress(t,0,.35),()=>{circle(x,y,7,color);line(x,y,x+45,y,color,3);text(s,x+60,y+13,36,color,'bold');});}
function bridgeFocus(t,{wide=0,queued=4,labels=true,scale=.82}={}){
 const restore=world(1615,543,scale,t,{open:1,stock:3,labels,wide});
 for(let i=0;i<queued;i++)cart(1380-i*275,718,.65,0,{animal:true});
 const u=(t*.16)%1;cart(lerp(1640,2260,u),718,.65,u*620,{animal:true});restore();
}
function sceneQuestion(t){
 const pull=progress(t,2.8,5.2),zoom=lerp(1.45,.51,pull),cx=lerp(2925,1740,pull),cy=lerp(610,490,pull);
 const restore=world(cx,cy,zoom,t,{open:progress(t,4.3,5.5),stock:1,steam:false,labels:t>5.4});
 for(let i=0;i<5;i++)cart(720+i*340,718,.68,t*27+i*50,{animal:true});
 if(t<5.5){const stop=progress(t,1.7,2.6);arrow(2825,815,lerp(3030,3000,stop),815,C.red,9,24);line(3020,777,3020,851,C.red,10);}
 restore();
 if(t<3.7){title(t<2.2?'城就在前方':'军队却停了下来','',progress(t,0,.6));}
 else{title('粮在后方',t<6?'':'',progress(t,3.7,4.2));alpha(progress(t,5.8,6.3),()=>{text('为何前线断粮？',115,265,100,C.red,'bold');underline(119,285,868,progress(t,6.1,6.75));});}
 if(t>8.3){const p=progress(t,8.3,9.7);const a={x:445,y:660},b={x:1525,y:395};const v=arcTravel(a,b,p,130);bag(v.x,v.y,lerp(.46,1.48,p),{rotation:Math.sin(p*Math.PI)*-.3,shadow:true});alpha(progress(t,9.3,9.8),()=>{text('跟住这一车份粮',1525,453,34,C.ink,'normal','center');});}
 alpha(progress(t,11.5,12.0),()=>note('地形与数量均为假设模型 · 图示一袋代表一车份粮',902));
}
function sceneJourney(t){
 const travel=progress(t,2.55,6.65),carX=lerp(725,2460,travel),pull=progress(t,9.8,11.3);
 let cx=lerp(620,carX+80,progress(t,1.8,3.05));cx=lerp(cx,1740,pull);const s=lerp(1.4,.51,pull),cy=lerp(575,490,pull);
 const restore=world(cx,cy,s,t,{open:progress(t,0,1),stock:0,backStock:t<.5?12:11,steam:t>8,labels:t>11});
 cart(carX,718,.82,travel*1735,{loaded:false});
 const stockOrigin={x:521,y:558},loaded={x:carX-12,y:651},store={x:2790,y:713};
 if(t<2.8){const p=progress(t,.5,2.6),v=arcTravel(stockOrigin,{x:725-12,y:651},p,100);bag(v.x,v.y,.73,{rotation:Math.sin(p*Math.PI)*.18,stretch:landing(t,2.6)});}
 else if(t<6.9)bag(loaded.x,loaded.y,.73,{shadow:false});
 else{const p=progress(t,6.9,8.5),v=arcTravel(loaded,store,p,110);bag(v.x,v.y,.73,{rotation:Math.sin(p*Math.PI)*-.3,color:p===1?C.green:C.gold,stretch:landing(t,8.5)});}
 if(t>9.8){for(const xx of [1100,1600,2020])cart(xx,718,.57,t*20,{animal:true});}
 restore();title('出仓，只是第一步','',progress(t,0,.5));
 if(t>10.25){
  const p=progress(t,10.25,10.85);alpha(p,()=>{for(const [x,word,sub,color] of [[285,'存量','还在后方',C.goldDark],[950,'在途','尚未送达',C.ink],[1490,'储备','已经到手',C.green]]){text(word,x,817,58,color,'bold');text(sub,x,870,33,C.muted);}});
 }
 if(t>7.6&&t<10.1)alpha(progress(t,7.6,8.1)*(1-progress(t,9.5,10.1)),()=>{text('送达',1500,355,108,C.green,'bold');underline(1500,377,225,1,C.green);});
}
const demandPoint=i=>({x:935+(i%5)*176,y:481+Math.floor(i/5)*192});
const smallStockPoint=i=>({x:206+(i%5)*95,y:654+Math.floor(i/5)*63});
function demandBase({used=false,highlight=true}={}){
 text('今日口粮',900,304,49,C.ink,'bold');text('10',1715,315,100,C.ink,'bold','right');text('车份',1730,311,31,C.muted);
 for(let i=0;i<10;i++){const p=demandPoint(i);if(!used)bagOutline(p.x,p.y,.92,highlight&&i>=6?C.red:C.line);bowl(p.x,p.y+25,.92,used?1:0);}
}
function sourceBridge(t,{bridgeVisible=true}={}){if(bridgeVisible)bridge(404,454,.77,t);line(130,454,280,454,C.ink,3);line(528,454,760,454,C.ink,3);arrow(568,429,763,429,C.goldDark,5);text('每日到达',146,292,40,C.muted);text('6',146,402,126,C.ink,'bold');text('车份',258,400,34,C.muted);}
function stockArea(count=20,label='前线储备'){
 text(label,150,574,38,C.muted);text(count,660,588,90,count?C.green:C.red,'bold','right');text('车份',672,585,30,C.muted);
 stockRack(206,843,5,4,95,63);
}
function sceneBottleneck(t){
 const morph=progress(t,6.9,7.65),incoming=progress(t,7.22,7.8);
 if(t<7.22){alpha(1-progress(t,6.9,7.22),()=>{
  const p=progress(t,3.7,5.6);const restore=world(lerp(1740,1615,p),lerp(490,543,p),lerp(.51,.93,p),t,{open:1,stock:4,labels:t<6.65,showBridge:morph===0});for(let i=0;i<5;i++)cart(1360-i*295,718,.67,0);cart(1870+((t*50)%450),718,.67,t*50);restore();
  if(t<4.9){datum('20','后方每日可发',140,334,C.goldDark,114);datum('10','前线每日消耗',1500,334,C.red,114);}
  else{alpha(progress(t,5.8,6.3)*(1-progress(t,6.55,6.9)),()=>{text('一天只过',960,303,41,C.muted,'normal','center');text('6',960,446,155,C.red,'bold','center');text('车',1053,441,44,C.muted);});}
 });}
 if(incoming>0){alpha(incoming,()=>{
  sourceBridge(t,{bridgeVisible:false});demandBase({used:t>16.05,highlight:t<13.65});
  for(let i=0;i<6;i++){const end=demandPoint(i),finish=8.65+i*.07,p=progress(t,7.8+i*.07,finish),v=arcTravel({x:530,y:440},end,p,55);if(t>16.05)useUnit(end,t,16.05+i*.035,C.gold,.92);else if(p>0)bag(v.x,v.y,.92,{rotation:Math.sin(p*Math.PI)*.12,stretch:landing(t,finish)});}
  if(t>9.7)alpha(progress(t,9.7,10.3),()=>{line(1054,741,1683,741,C.red,3);line(1054,728,1054,741,C.red,3);line(1683,728,1683,741,C.red,3);text(t<13.65?'还差 4 份':'从储备补 4 份',1380,800,44,t<13.65?C.red:C.green,'bold','center');});
  if(t>12.1){
   let remaining=20;for(let i=16;i<20;i++){if(t>13.65+(i-16)*.14)remaining--;}
   stockArea(remaining);for(let i=0;i<20;i++){const from=smallStockPoint(i);if(i<16)bag(from.x,from.y,.55,{color:C.green});else{const p=progress(t,13.65+(i-16)*.14,15.25+(i-16)*.14),to=demandPoint(i-10),v=arcTravel(from,to,p,115);if(t>16.05)useUnit(to,t,16.05+(i-10)*.035,C.green,.92);else bag(v.x,v.y,lerp(.55,.92,p),{color:C.green,rotation:Math.sin(p*Math.PI)*-.2});}}
   if(t>15.8){rect(1020,723,720,110,C.paper);text('6 份送达 + 4 份储备',1380,780,41,C.ink,'bold','center');text('今日吃够，储备变少',1380,843,36,C.red,'normal','center');}
  }
 });}
 if(morph>0)bridge(lerp(960,404,morph),lerp(752.75,454,morph),lerp(.93,.77,morph),t);
 title('送得到的，才算数','',progress(t,0,.5));
}
const reservePoint=i=>({x:320+Math.floor(i/4)*215,y:716-(i%4)*111});
const lossStarts=[3.1,4.6,5.9,6.6,7.3];
function sceneReserve(t){
 title('储备，是在替缺口买时间','从最初的 20 车份算起',progress(t,0,.55));
 const toSix=progress(t,8.9,9.7);
 if(toSix<1)alpha(1-toSix,()=>{
  stockRack(320,716,5,4,215,111);let left=20;
  for(let i=0;i<20;i++){const col=Math.floor(i/4),start=lossStarts[col]+(i%4)*.045,p=progress(t,start,start+.69),a=reservePoint(i);if(p>0)left--;if(p<1){const v=arcTravel(a,{x:1595+(i%4-1.5)*25,y:708},p,110);bag(v.x,v.y,.88,{color:C.green,rotation:p*.34});}}
  datum(left,'车份剩余',1650,430,left?C.green:C.red,143,'center');pot(1650,725,1.5,t,t>3.2&&t<8.4?1:0);
  let day=0;for(const s of lossStarts)if(t>s+.5)day++;dayStrip(320,825,6,day,1325);
  text('每天从储备补出',1538,525,34,C.muted,'normal','center');text('4',1545,615,87,C.red,'bold','center');text('份',1610,610,33,C.muted);
  if(t>8)alpha(progress(t,8,8.35),()=>{text('第五天，见底',803,574,72,C.red,'bold','center');});
 });
 if(toSix>0)alpha(toSix,()=>{
  sourceBridge(t);demandBase();stockArea(0);for(let i=0;i<6;i++){const p=progress(t,9.6+i*.1,10.4+i*.1),q=arcTravel({x:535,y:445},demandPoint(i),p,55);if(p>0)bag(q.x,q.y,.92);}
  text('第六天',930,228,40,C.red,'bold');alpha(progress(t,11.3,12),()=>{curvedArrow([{x:632,y:719},{x:792,y:680},{x:875,y:777},{x:1058,y:694}],1,C.red,3);line(811,698,835,738,C.red,6);line(835,698,811,738,C.red,6);text('没有储备可补',1450,813,45,C.red,'bold','center');});
  if(t>14.5)text('前五天吃得够，是因为储备在减少',150,901,36,C.ink);
 });
}
function sceneMore(t){
 title('后方加粮，桥前加队','',progress(t,0,.5));
 const baseY=702;warehouse(274,baseY,.71,{open:1});camp(1655,baseY,.61,t,{stock:1,steam:true});
 rect(452,baseY,1004,20,C.cream);line(453,baseY,1458,baseY,C.ink,3);path('M960 702V903H1135V702Z',C.water,null);bridge(1047,baseY,1.12,t);
 const growth=progress(t,3.4,6.5),n=4+Math.floor(growth*8);
 for(let row=0;row<3;row++){const yy=689-row*102;path(`M452 ${yy}H828Q900 ${yy}925 702`,null,C.line,2);}
 for(let i=0;i<n;i++){const col=i%4,row=Math.floor(i/4),p=progress(t,3.25+Math.max(0,i-3)*.22,3.85+Math.max(0,i-3)*.22),xx=lerp(250,526+col*87,i<4?1:p),yy=634-row*102;cart(xx,yy+42,.55,xx,{loaded:false,animal:false});bag(xx,yy,.8,{rotation:Math.sin(p*Math.PI)*.1});}
 for(let i=0;i<6;i++){const phase=(t*.14+i/6)%1;const x=lerp(914,1458,phase);cart(x,baseY,.28,phase*544,{animal:false,amount:1});}
 text('前线每天仍收到',1500,296,37,C.muted,'normal','center');text('6',1500,438,151,C.ink,'bold','center');text('车份',1600,435,38,C.muted);
 alpha(progress(t,5.2,5.8),()=>{text('等候区越堆越满',653,242,43,C.red,'bold','center');underline(440,260,430,progress(t,5.5,6.1),C.red);});
 if(t>9.4){text('增加的是积压',497,819,44,C.red,'bold');text('到达量没有增加',1300,819,40,C.ink);}
 if(t>13.6){const p=progress(t,13.6,14.3);alpha(p,()=>{text('先改变这里',1047,402,49,C.red,'bold','center');arrow(1047,433,1047,568,C.red,4,16);});}
 note('假设：桥的通过能力保持六车份／日');
}
function loopPoint(q,left,right,top,bottom){
 const r=(bottom-top)/2,straight=right-left-2*r,circ=2*straight+2*Math.PI*r;let d=((q%1)+1)%1*circ;
 if(d<straight)return{x:left+r+d,y:top,back:false,loaded:true};d-=straight;
 if(d<Math.PI*r){const a=-Math.PI/2+d/r;return{x:right-r+Math.cos(a)*r,y:(top+bottom)/2+Math.sin(a)*r,back:a>0,loaded:d<Math.PI*r*.43};}d-=Math.PI*r;
 if(d<straight)return{x:right-r-d,y:bottom,back:true,loaded:false};d-=straight;const a=Math.PI/2+d/r;return{x:left+r+Math.cos(a)*r,y:(top+bottom)/2+Math.sin(a)*r,back:a<Math.PI,loaded:d>Math.PI*r*.6};
}
function drawLoop(left,right,top,bottom,color=C.cream,w=33){const r=(bottom-top)/2;path(`M${left+r} ${top}H${right-r}A${r} ${r} 0 0 1 ${right-r} ${bottom}H${left+r}A${r} ${r} 0 0 1 ${left+r} ${top}`,null,color,w);}
function sceneDistance(t){
 title('同一支车队，路越长，送得越少','',progress(t,0,.5));
 const enter=progress(t,3.6,4.5),stretch=progress(t,13.7,15.8),left=155,radius=105,initial=790;
 const initialLength=2*(initial-left-2*radius)+Math.PI*2*radius;const final=left+(initialLength*2-Math.PI*2*radius)/2+2*radius;
 const right=lerp(initial,final,stretch),top=455,bottom=665,outputX=lerp(1210,1710,stretch);
 if(enter<1)alpha(1-enter,()=>bridgeFocus(t,{wide:progress(t,0,1.15),queued:2,labels:false,scale:.69}));
 if(enter>0)alpha(enter,()=>{
  drawLoop(left,right,top,bottom);drawLoop(left,right,top,bottom,C.muted,1.5);
  // Keep road speed continuous while the same sixty vehicles spread over a longer route.
  let phase=Math.min(t,13.7)*.035;
  const span=clamp(t-13.7,0,2.1);
  for(let j=0;j<24;j++)phase+=span/24*.035/(1+progress(13.7+(j+.5)*span/24,13.7,15.8));
  phase+=Math.max(0,t-15.8)*.0175;
  for(let i=0;i<60;i++){const p=loopPoint(i/60+phase,left,right,top,bottom);group(p.x,p.y,.145,0,()=>{if(p.back)ctx.scale(-1,1);cart(0,0,1,phase*4000,{loaded:p.loaded,animal:false,amount:1});});}
  const countX=lerp(338,530,stretch),cycleX=lerp(600,1125,stretch);
  text('固定车队',countX,520,35,C.muted,'normal','center');text('60',countX,614,90,C.ink,'bold','center');text('辆',countX+93,607,31,C.muted);
  text('往返一次',cycleX,520,35,C.muted,'normal','center');if(t<10.45)text('—',cycleX,614,90,C.red,'bold','center');else rollingNumber('6','12',progress(t,14.85,15.85),cycleX,614,90,C.red);text('天',cycleX+89,607,31,C.muted);
  text('装粮出发',left+75,355,34,C.muted);text('前线卸粮',right-40,355,34,C.muted,'normal','center');arrow(left+95,408,right-130,408,C.goldDark,3,10);
  arrow(right-95,735,left+95,735,t>21.7?C.green:C.muted,t>21.7?5:3,10);text('空车返回，也占用车辆',(left+right)/2,793,34,t>21.7?C.green:C.muted,t>21.7?'bold':'normal','center');
  if(t>11.4){
   const split=progress(t,17.95,19.35);
   text('日均送到',outputX,294,35,C.muted,'normal','center');rollingNumber('10','5',split,outputX,402,117);
   for(let i=0;i<10;i++){
    const arrival=progress(t,11.4+i*.04,12.0+i*.04),a={x:outputX-33+(i%2)*66,y:490+Math.floor(i/2)*73},b={x:outputX+(i<5?-53:53),y:490+(i%5)*73},p=arcTravel(a,b,split,Math.abs(b.y-a.y)*.12);
    alpha(arrival*(i<5?1:1-split*.82),()=>bag(p.x,p.y-(1-arrival)*45,.62,{shadow:false}));
   }
   alpha(split,()=>{text('今天',outputX-53,842,29,C.ink,'bold','center');text('明天',outputX+53,842,29,C.muted,'normal','center');line(outputX,432,outputX,793,C.line,1.5);});
  }
  note('单看周转：均匀轮转，每车每次一车份，忽略损耗');
 });
}
function useUnit(p,t,consumeStart,color=C.gold,s=.9){
 const q=progress(t,consumeStart,consumeStart+1.1);
 if(q<1){
  const tilt=q*.9,bx=p.x-32*q,by=p.y-8*q,mouth={x:bx+s*(-2*Math.cos(tilt)+98*Math.sin(tilt)),y:by+s*(-2*Math.sin(tilt)-98*Math.cos(tilt))};
  alpha(1-progress(q,.82,1),()=>bag(bx,by,s,{color,rotation:tilt,fill:1-q,opened:progress(q,0,.16),shadow:false}));
  grainPour(mouth.x,mouth.y,p.x,p.y+16,q,14);
 }
 bowl(p.x,p.y+32,s,q>.7?1:0,t);
}
function sceneBalance(t){
 title('当天够吃，储备仍是零','',progress(t,0,.5));
 const crisis=progress(t,13.0,13.8);
 const emptyStoreX=340,emptyStoreY=765;
 warehouse(emptyStoreX,emptyStoreY,.8,{open:1,stocks:0});text('储备',emptyStoreX,852,40,C.muted,'normal','center');text('0',emptyStoreX,735,115,C.red,'bold','center');
 if(t<13.25){text('每日到达',650,300,36,C.muted);text('10',650,402,108,C.ink,'bold');text('车份',802,400,34,C.muted);}
 if(t<13.25){
  for(let i=0;i<10;i++){
   const p=demandPoint(i),enter=progress(t,3.3+i*.06,4.65+i*.06);if(t<8.5)bagOutline(p.x,p.y,.9,C.line);
   if(t<6.85+i*.05){if(enter>0){const q=arcTravel({x:615,y:360},p,enter,30);bag(q.x,q.y,.9);}}
   else useUnit(p,t,6.85+i*.05);
  }
  if(t>8.3){text('当天 10 份已吃完',1335,805,42,C.green,'bold','center');text('没有一份能留下',1335,866,34,C.red,'normal','center');}
  if(t>10.5){curvedArrow([{x:835,y:725},{x:725,y:815},{x:595,y:820},{x:500,y:738}],progress(t,10.5,11.2),C.line,3);line(625,778,657,810,C.red,5);line(657,778,625,810,C.red,5);}
 }else{
  alpha(crisis,()=>{calendar(784,548,'次日',.78,C.red);text('运输中断',791,354,42,C.red,'bold','center');line(791,385,791,443,C.red,6);line(760,414,820,414,C.red,6);
  for(let i=0;i<10;i++){const p=demandPoint(i);bagOutline(p.x,p.y,.9,C.red);bowl(p.x,p.y+32,.9,0);}
  text('没有当天到达',1334,803,42,C.red,'bold','center');text('也没有储备补上',1334,862,38,C.red,'normal','center');});
 }
 if(t>17){alpha(progress(t,17,17.5),()=>{rect(110,203,1695,96,C.paper);text('日供平衡',680,270,51,C.ink,'bold','center');text('≠',960,275,80,C.red,'bold','center');text('恢复储备',1240,270,51,C.ink,'bold','center');});}
}
const topUnit=i=>({x:196+i*139,y:438});
const storeUnit=i=>({x:760+i*135,y:779});
const gridUnit=i=>({x:320+(i%5)*250,y:425+Math.floor(i/5)*112});
function sceneRebuild(t){
 if(t<14.9)title('余粮留下，才重新有了储备','',progress(t,0,.5));
 else{const turn=progress(t,14.9,15.45);clipBox(104,53,1720,119,()=>{text('余粮留下，才重新有了储备',116,142-turn*125,76,C.ink,'bold');text('二十车份，也只能撑两天',116,267-turn*125,76,C.ink,'bold');});}
 if(t<10.85){
  const day2=t>=7.45;
  text('送到',116,310,38,C.muted);text('12',241,326,104,C.ink,'bold');text('车份',390,322,35,C.muted);
  text('先供当天',716,310,38,C.muted);text('10',908,326,104,C.ink,'bold');text('留下',1380,310,38,C.muted);text('2',1511,326,104,C.green,'bold');
  line(160,477,1527,477,C.line,2);line(1545,477,1794,477,C.green,3);
  const local=day2?t-7.45:t,start=day2?0:.15,finish=day2?.55:1.1,use=day2?.65:2.35,transfer=day2?1.36:5.0,end=day2?2.35:6.65;
  let stored=day2?2:0;
  // First-day retained units stay present while day two follows the same path.
  if(day2)for(let i=0;i<2;i++){const p=storeUnit(i);bag(p.x,p.y,.91,{color:C.green});}
  for(let i=0;i<12;i++){
   const p=topUnit(i),entry=progress(local,start+i*.025,finish+i*.025);
   if(i<10){
    const q=progress(local,use+i*.032,use+.85+i*.032);
    if(q<1&&entry>0){const pos=arcTravel({x:-90,y:520},p,entry,12);bag(pos.x,pos.y,.92,{fill:1-q,rotation:q*.65,opened:progress(q,0,.16)});grainPour(p.x+25,p.y-45,p.x,p.y+74,q,9);}
    if(q>.65)bowl(p.x,p.y+84,.56,1);
   }else{
    const q=progress(local,transfer+(i-10)*.12,end+(i-10)*.12),dest=storeUnit((day2?2:0)+i-10),origin=arcTravel({x:-90,y:520},p,entry,12),v=arcTravel(origin,dest,q,65);
    if(entry>0)bag(v.x,v.y,.92,{color:q===1?C.green:C.gold,rotation:Math.sin(q*Math.PI)*-.26,stretch:landing(local,end+(i-10)*.12)});if(q===1)stored++;
   }
  }
  line(654,789,1332,789,C.woodDark,4);line(654,795,1332,795,C.cream,5);text('前线储备',151,745,38,C.muted);text(stored,473,801,126,C.green,'bold','center');text('车份',476,852,32,C.muted,'normal','center');text(day2?'第二天':'第一天',1000,857,38,C.ink,'bold','center');
 }else{
  const shift=progress(t,10.85,11.4);
  stockRack(320,761,5,4,250,112);
  let count=4;
  for(let i=0;i<20;i++){
   const dest=gridUnit(i);
   if(i<4){const origin=storeUnit(i),v=arcTravel(origin,dest,shift,75);bag(v.x,v.y,lerp(.92,1.0,shift),{color:C.green});}
   else{
    const pair=Math.floor((i-4)/2),start=11.4+pair*.27+(i%2)*.04,p=progress(t,start,start+.28);
    if(p>0){const v=arcTravel({x:1750,y:310},dest,p,60);bag(v.x,v.y,1,{color:p===1?C.green:C.gold,rotation:Math.sin(p*Math.PI)*-.15});}
    if(p===1)count++;
   }
  }
  if(t<14.9){text(`第 ${Math.max(2,Math.floor(count/2))} 天`,1720,381,42,C.ink,'bold','center');text(count,1720,531,139,C.green,'bold','center');text('车份储备',1720,588,32,C.muted,'normal','center');text('每天留下 2 份',115,253,40,C.green,'bold');dayStrip(320,858,10,Math.max(2,Math.floor(count/2)),1250);}
  else{
   // Clear the grid's static units, then redraw exactly the remaining and travelling units.
   rect(232,303,1160,501,C.paper);stockRack(320,761,5,4,250,112);
   const p1=progress(t,16.05,17.515),p2=progress(t,18.0,19.465);let remain=20;
   for(let i=0;i<20;i++){const start=(i<10?16.05:18.0)+(i%10)*.035,p=progress(t,start,start+1.15),from=gridUnit(i);if(p>.85)remain--;if(p<1){const to={x:1660+(i%5-2)*11,y:772},v=arcTravel(from,to,p,80);alpha(1-progress(p,.85,1),()=>bag(v.x,v.y,1,{color:C.green,fill:1-clamp((p-.65)/.35),rotation:p*.6,opened:progress(p,.63,.78),shadow:p===0}));}}
   text('运输完全中断',119,254,40,C.red,'bold');pot(1670,793,1.65,t,p1>0&&p2<1?1:0);
   text('当前剩余',1690,344,36,C.muted,'normal','center');text(remain,1690,479,137,remain?C.green:C.red,'bold','center');text('车份',1690,531,33,C.muted,'normal','center');
   const day=t<18?1:2;calendar(879,845,day,.53,C.red);text('每天消耗 10 份',1670,893,33,C.muted,'normal','center');
  }
 }
}
function sceneDecision(t){
 const pull=progress(t,0,3.9);const restore=world(lerp(2610,1740,pull),lerp(515,490,pull),lerp(.91,.51,pull),t,{open:1,stock:t>12.9?7:2,steam:t>13.8,wide:progress(t,10.8,12),labels:true});
 for(let i=0;i<6;i++)cart(770+i*300+(t*30)%280,718,.64,t*30,{animal:true});
 if(t>10.8){for(let i=0;i<3;i++){const p=progress(t,12.6+i*.25,13.8+i*.25),v=arcTravel({x:2445,y:657},{x:2850+i*44,y:713},p,80);bag(v.x,v.y,.6,{color:p===1?C.green:C.gold});}}
 if(t>14.4){arrow(2890,822,lerp(2910,3170,progress(t,14.4,16.0)),822,C.green,9,20);}
 restore();
 if(t<16.9){title('进军之前，先把补给接上','',progress(t,0,.5));
  const items=[[5.3,140,'每天能到多少？',C.goldDark],[7.2,742,'多久回一趟？',C.ink],[9.0,1332,'还能撑几天？',C.green]];
  for(const [start,x,s,c] of items)alpha(progress(t,start,start+.5)*(1-progress(t,10.5,11)),()=>{text(s,x,843,43,c,'bold');});
  for(const [start,x,s,c] of [[10.9,775,'修路',C.red],[12.0,1125,'转运',C.ink],[12.8,1450,'积粮',C.green]])alpha(progress(t,start,start+.45),()=>{text(s,x,852,47,c,'bold');});
 }else{
  const p=progress(t,16.9,17.6);clipBox(110,65,1700,250,()=>{text('送到',117,213+(1-p)*160,130,C.red,'bold');text('才是前线的力量',440,213+(1-p)*160,82,C.ink,'bold');});underline(120,252,1645,progress(t,17.4,18.3),C.red);
 }
}
const scenes={question:sceneQuestion,journey:sceneJourney,bottleneck:sceneBottleneck,reserve:sceneReserve,more:sceneMore,distance:sceneDistance,balance:sceneBalance,rebuild:sceneRebuild,decision:sceneDecision};
function renderAt(time){
 const t=clamp(time,0,duration-1/60);const scene=D.scenes.findLast(s=>t>=s.start)||D.scenes[0];
 ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,1920,1080);G.backdrop();scenes[scene.id](Math.max(0,t-scene.start));
}
window.mgRenderAt=renderAt;
document.fonts.ready.then(()=>{
 const clock={t:0};const tl=gsap.timeline({paused:true});tl.to(clock,{t:duration,duration,ease:'none',onUpdate:()=>renderAt(clock.t)},0);
 window.__timelines['mg-story']=tl;window.addEventListener('hf-seek',e=>renderAt(e.detail.time));renderAt(0);
});
