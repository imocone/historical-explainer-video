import {C,N,g,at,P,R,L,E,T,U,trace,title,tag,tree,human,roof,hall,house,coin,sack,furnace,saltpan,flag,castle,terrain,landscape,defs,residence} from './art.mjs';
import {person,worker,official,traveller,guard} from './people.mjs';
import {mapDefs,mapBase,mapDot,mapText,mapFooter,geo,city,GP,point} from './map.mjs';
const actor=(role,id,x,y,k=1,opts={})=>at(person({role,id,...opts}),x,y,k);
const cm=(s,x,y,c=C.ink,size=35)=>T(s,x,y,size,c,'body','middle');
const framed=(s,x,y,c=C.ink,size=36)=>T(s,x,y,size,c,'title','start',`paint-order="stroke" stroke="${C.paper}" stroke-width="9" stroke-linejoin="round"`);
function question(){return g('s-question',
 g('q-type',T('七国之乱',120,205,32,C.muted)+T('汉景帝',116,348,96,C.ink,'title')+T('削的是什么？',112,474,96,C.red,'title')+T('公元前 154 年',120,558,32,C.muted))+
 g('q-world',g('q-scenery',landscape('q-land')))+
 g('q-flag',at(flag('王'),1270,730,1.25))+
 g('q-seven','')+
 g('q-choice',T('王号？',1338,362,44,C.goldD,'title','middle')+L(1338,383,1338,413,C.goldD,2))+
 g('q-open',T('封地里的力量',120,160,64,C.ink,'title'))
 );}

function system(){return g('s-system',title('sys-title','一个帝国，两套治理关系')+
 g('sys-ground',P('M0 787Q420 736 960 779Q1460 730 1920 787V970H0Z',C.pale,'none')+L(120,821,1800,821,C.ink,2))+
 g('sys-court',R(871,252,178,75,C.ink,C.ink,2,3)+T('天子',960,305,44,C.paper,'title','middle'))+
 trace('sys-left-link','M890 328V397H478V551',C.green,5)+trace('sys-right-link','M1030 328V345H1434V367',C.gold,5)+
 g('sys-left',at(hall({w:440,label:'郡府'}),477,815,.75)+T('郡',477,892,44,C.green,'title','middle')+cm('朝廷置官',477,940,C.muted,32))+
 g('sys-right',g('sys-right-building',at(hall({w:440}),1420,815,.75))+g('sys-right-caption',T('诸侯国',1420,892,44,C.goldD,'title','middle')+cm('诸侯王治理',1420,940,C.muted,32)))+
 g('sys-king',actor('royal','sys-king-person',1434,497,.49,{robe:C.red})+T('诸侯王',1508,451,36,C.goldD,'title'))+
 trace('sys-king-link','M1434 507V552',C.gold,5)
 );}

function offices(){let interior=R(196,345,1528,462,C.cream,C.ink,3)+R(225,369,1470,394,C.ink)+N(3,i=>R(248+i*492,390,438,356,C.pale))+N(4,i=>R(205+i*499,328,18,478,C.red,C.ink,2))+R(180,795,1560,24,C.woodD,C.ink,2)+N(3,i=>R(152-i*19,819+i*17,1616+i*38,17,C.cream,C.ink,2));
 const desk=(x,y)=>R(x-110,y-32,220,14,C.woodD,C.ink,2)+R(x-94,y-18,12,71,C.woodD)+R(x+80,y-18,12,71,C.woodD)+R(x-69,y-57,58,22,C.cream,C.woodD,1)+N(4,i=>L(x-62+i*12,y-52,x-62+i*12,y-40,C.woodD,1));
 return g('s-offices',g('off-outer',at(hall({w:520}),960,760,1.4))+
 g('off-inside',interior+
 g('off-area0',actor('official','off-chancellor',480,738,.69,{robe:C.green,variant:1})+actor('official','off-aide0',327,746,.55,{robe:C.green,variant:2})+actor('official','off-aide1',620,746,.55,{robe:C.green,variant:0,flip:true})+desk(485,712)+T('丞相',473,449,50,C.ink,'title','middle')+cm('统领众官',473,500,C.muted,34))+
 g('off-area1',actor('official','off-registrar',978,738,.69,{robe:C.green,variant:2,flip:true})+g('off-visitor-move',actor('civilian','off-visitor',805,746,.62,{robe:C.red,variant:1}))+desk(978,713)+T('内史',964,449,50,C.ink,'title','middle')+cm('管理民政',964,500,C.muted,34))+
 g('off-area2',actor('guard','off-guard0',1371,745,.73,{variant:1})+actor('guard','off-guard1',1543,745,.73,{variant:0,flip:true})+T('中尉',1455,449,50,C.ink,'title','middle')+cm('掌管武职',1455,500,C.muted,34))+
 g('off-shutters',N(3,i=>{let x=248+i*492;return N(2,j=>g('off-door'+i+'-'+j,R(0,0,219,356,C.woodD,C.ink,2)+N(8,k=>L(15+k*26,8,15+k*26,346,C.goldL,1.3))+L(4,112,215,112,C.ink,4)+L(4,258,215,258,C.ink,4),'translate('+(x+j*219)+' 390)'));}))+g('off-roof',at(roof(1540,160),960,332)))+
 g('off-intro',T('王国的官署',120,160,64,C.ink,'title'))+
 g('off-summary',T('组织人口、财力与军事力量',120,160,64,C.ink,'title'))+
 g('off-limits',T('诸侯王仍受皇帝约束',120,160,64,C.ink,'title'))
 );}
function wealth(){
 let mountain=P('M-180 667L-67 517-19 473 68 496 146 390 202 344 256 239 301 251 346 288 399 273 464 355 510 376 579 491 623 517 687 667Z','#98aaa0',C.ink,2.4)+
 P('M256 239L274 370 233 413 278 459 330 487 374 586 424 667H687L623 517 579 491 510 376 464 355 399 273 346 288 301 251Z','#68897e','none')+
 P('M301 251L346 288 399 273 377 352 315 400 274 370Z','#bbcab8','none')+
 P('M-67 517L-19 473 68 496 101 563 66 611-180 667Z','#abc1aa','none')+
 P('M146 390L202 344 182 425 233 413 278 459 204 482 150 457 101 563 68 496Z','#b8c6b0','none')+
 P('M377 352L399 273 464 355 510 376 492 428 434 408 402 453 315 400Z','#7b9a8b','none')+
 P('M316 545L374 586 424 667H326L289 609Z','#4f7469','none')+
 P('M-27 525L28 559 4 595M148 391L132 433 162 453M274 370L233 413 278 459M377 352L315 400M434 408L467 468 514 489M331 487L352 548M541 527L582 581','none','#d7dfca',2.5)+
 P('M191 667V564Q200 502 254 503Q306 506 312 564V667Z',C.ink,C.ink,2)+
 P('M181 666V561Q195 490 253 489Q319 495 324 565V667','none',C.woodD,13)+
 P('M194 665V563M312 563V666M196 556H311','none',C.wood,5)+P('M198 582L221 557M286 557L309 582','none',C.woodD,5)+
 P('M208 667Q237 697 309 727L365 756','none','#d3c4a5',39)+
 N(4,i=>{const x=-10+i*117,y=549+i%2*42;return P(`M${x} ${y}l18-14 19 5 13 17-24 16-26-7Z`,C.goldD,C.ink,1.2)+P(`M${x} ${y}l18-14 19 5-17 14Z`,C.gold,'none');});
 let sea=P('M-1000 403Q960 335 2800 403V826H-1000Z',C.water,'none')+N(9,i=>P(`M${1160+(i%2)*70} ${424+i*35}q75-13 146 0t146 0t146 0`,'none',i%2?C.waterD:C.paper,2))+P('M1050 612Q1250 548 1421 632Q2100 692 2800 581V1100H1080Z',C.cream,'none');
 return g('s-wealth',g('wealth-title',T('吴国',120,160,64,C.ink,'title'))+
 g('wealth-stage',g('wealth-sea',sea)+g('wealth-mountain',mountain)+P('M-1000 760Q350 661 750 743Q1090 650 1440 737Q2100 660 2800 740V1100H-1000Z',C.cream,'none')+
 g('wealth-works',at(furnace(),586,760,1.14)+R(741,727,216,20,C.woodD,C.ink,3)+R(756,747,13,83,C.woodD)+R(930,747,13,83,C.woodD)+R(767,704,143,20,C.cream,C.ink,2)+N(4,i=>U('art-coin',789+i*31,710,.3))+at(worker({id:'copper-caster',variant:1}),675,824,.85)+g('copper-carrier-move',actor('pusher','copper-carrier',275,755,.57,{robe:C.roof,variant:2}))+
 g('wealth-cart',P('M300 636H321L337 667','none',C.woodD,5)+R(337,641,109,53,C.wood,C.ink,2)+N(3,i=>P(`M${351+i*27} 640l14-26 18 23Z`,C.goldD,C.ink,1.5))+g('cart-wheel0',E(358,704,17,17,C.woodD,C.ink,3)+N(6,i=>{const a=i*Math.PI/3;return L(358,704,358+15*Math.cos(a),704+15*Math.sin(a),C.goldL,1.4)})+E(358,704,3,3,C.ink))+g('cart-wheel1',E(427,704,17,17,C.woodD,C.ink,3)+N(6,i=>{const a=i*Math.PI/3;return L(427,704,427+15*Math.cos(a),704+15*Math.sin(a),C.goldL,1.4)})+E(427,704,3,3,C.ink))+L(440,667,498,651,C.woodD,5)))+
 g('wealth-salt',at(saltpan(),1386,784,1.11)+at(worker({id:'salt-stirrer',kind:'rake',variant:0}),1198,832,.70)+N(3,i=>g('wealth-steam'+i,P(`M${1314+i*70} 633q-18-26 0-51t0-51`,'none',C.white,6)))+R(1569,758,152,9,C.woodD,C.ink,2)+R(1581,767,8,60,C.woodD)+R(1701,767,8,60,C.woodD)+P('M1592 757l30-54 48 54Z',C.white,C.ink,1.5)+N(3,i=>U('art-sack',1580+i*61,842,.9)))+
 g('wealth-mine-ground',''))+
 g('wealth-copper-label',T('铜山铸钱',120,160,64,C.ink,'title'))+g('wealth-salt-label',T('煮海取盐',120,160,64,C.ink,'title'))+
 g('wealth-flight',U('art-coin'))+g('wealth-result',P('M0 819Q375 721 808 790Q1320 702 1920 795V970H0Z',C.pale,'none')+
 g('wealth-store',R(150,413,608,363,C.cream,C.ink,3)+R(182,438,544,299,C.ink)+R(191,443,526,285,C.woodD)+N(3,i=>R(191,532+i*92,526,11,C.wood,C.ink,1.5))+N(12,i=>g('wealth-coin'+i,U('art-coin',238+(i%6)*78,510-Math.floor(i/6)*28,.53)))+N(8,i=>U('art-sack',236+(i%4)*91,722-Math.floor(i/4)*95,.85))+R(170,419,15,358,C.red,C.ink,1)+R(722,419,15,358,C.red,C.ink,1)+at(roof(656,98),454,409)+R(393,439,123,39,C.red,C.ink,2)+T('铜 · 盐',454,468,25,C.paper,'title','middle')+actor('official','wealth-stock-clerk',797,820,.52,{robe:C.green,variant:1}))+
 g('wealth-town',at(residence(),1104,584,.92)+at(residence(),1438,568,.8)+at(residence(),1277,656,.8)+tree(1630,634,.9)+P('M1870 874Q1514 823 1322 768Q1167 727 966 735','none',C.cream,99)+P('M1870 899Q1502 848 1305 795Q1161 757 967 760','none',C.wood,1.5)+
 actor('civilian','settled-person0',1010,769,.53,{robe:C.green,variant:1,flip:true})+actor('civilian','settled-person1',1148,741,.47,{robe:C.red,variant:2})+actor('official','settled-person2',1270,724,.44,{robe:C.green,variant:0,flip:true})+
 N(6,i=>{const xy=[[1065,805],[1197,811],[1325,827],[1447,841],[1560,859],[1683,875]][i];return g('wealth-person'+i,actor('traveller','arrival'+i,xy[0],xy[1],.48+(i%3)*.025,{robe:[C.green,C.red,C.roof][i%3],variant:i%3,flip:true}));}))+
 g('wealth-gather',T('铜盐之利',454,254,44,C.goldD,'title','middle')+L(668,238,998,238,C.gold,4)+P('M984 228L998 238 984 248','none',C.gold,4)+T('招聚人众',1290,254,44,C.ink,'title','middle')))+
 g('wealth-overview',at(landscape('wealth-land'),80,230,1.15)+T('人口、财源与治理',120,160,64,C.ink,'title'))
 );}
function edict(){return g('s-edict',g('edict-head',T('削减封地',120,160,64,C.ink,'title'))+
 g('edict-strips',N(3,i=>{const y=345+i*208;return g('edict-row'+i,
  T(['楚','胶西','吴'][i],120,y+24,44,C.ink,'title')+
  P(`M388 ${y+58}Q528 ${y+26} 748 ${y+47}Q1037 ${y+17} 1275 ${y+41}Q1519 ${y+12} 1785 ${y+38}V${y+76}H388Z`,C.pale,'none')+
  P(`M388 ${y+76}Q744 ${y+47} 1124 ${y+66}Q1435 ${y+39} 1785 ${y+65}V${y+89}H388Z`,C.cream,'none')+
  at(residence(),637,y+66,.38)+at(residence(),1010,y+65,.32)+at(residence(),1535,y+65,.36)+tree(1703,y+65,.42)+
  P(`M787 ${y+80}l20-35h82l-20 35Z`,C.goldL,C.woodD,1)+N(4,j=>L(802+j*17,y+74,817+j*17,y+48,C.goldD,1))+
  g('edict-old'+i,L(388,y-48,1785,y-48,C.gold,6)+L(388,y-57,388,y-34,C.gold,4))+
  g('edict-target'+i,R(1300,y-35,485,124,'#4c8b7915')+T(['东海郡','六县','会稽等郡'][i],1320,y+131,40,C.red,'title'))+
  g('edict-cut'+i,L(1300,y-57,1300,y+89,C.red,3))+
  g('edict-note'+i,T(i===2?'决定削':'已削',1785,y+129,32,C.muted,'body','end'))
 );}))+g('edict-land',at(landscape('ed-land'),80,230,1.15))+
 g('edict-last',T('王号仍在，辖地缩小',120,160,64,C.ink,'title'))+
 trace('edict-border','M80 880V303H1805V880',C.gold,5)
 );}

function meaning(){return g('s-meaning',g('meaning-land',at(landscape('meaning-area'),80,230,1.15))+
 g('meaning-head',T('归属改变，土地不动',120,160,64,C.ink,'title'))+
 g('meaning-king',T('诸侯王的治理范围',170,271,36,C.goldD,'title'))+
 trace('meaning-bound','M80 880V303H1185V880',C.gold,5)+
 g('meaning-other',P('M1185 313H1805V883H1185Z','#4c8b790A','none')+L(1185,303,1805,303,C.green,5)+L(1805,303,1805,880,C.green,5)+T('划出原王国',1486,271,36,C.green,'title','middle'))+
 g('meaning-next',P('M850 303V510M850 776V886','none',C.red,3,'stroke-dasharray="9 12"'))+
 g('meaning-question',T('下一次，会削到哪里？',120,160,64,C.ink,'title'))
 );}
function mapLabels(prefix){return g(prefix+'-changan',mapDot('长安','changan',C.ink,-42,48,34))+
 g(prefix+'-wu',mapDot('吴','wu',C.red,22,36))+
 g(prefix+'-chu',mapDot('楚','chu',C.red,20,44))+
 g(prefix+'-zhao',mapDot('赵','zhao',C.red,-61,-17))+
 g(prefix+'-sd',P('M1292 369Q1370 280 1495 295','none',C.red,1.8)+
 T('山东四国',1500,288,32,C.muted)+N(4,i=>g(prefix+'-sd'+i,T(['胶西','胶东','淄川','济南'][i],1500+(i%2)*166,357+Math.floor(i/2)*65,40,C.red,'title'))))+
 g(prefix+'-liang',at(castle(),...GP('liang'),.22)+mapText('梁',GP('liang')[0]-21,GP('liang')[1]+51,C.green,44))+
 '';}
function mapcommon(prefix){return g(prefix+'-map',mapBase()+mapLabels(prefix)+mapFooter());}
function rebellion(){const [lx,ly]=GP('liang');return g('s-rebellion',title('reb-title','七国起兵')+mapcommon('reb')+
 g('reb-limit',T('七国，并非全部诸侯',120,160,64,C.ink,'title'))+
 g('reb-loyal',mapText('站在朝廷一边',lx,ly+141,C.green,36,'middle','body'))+
 trace('reb-to-liang',`M${lx} ${ly+67}V${ly+100}`,C.green,2)
 );}
function fronts(){const [wx,wy]=GP('wu'),[cx,cy]=GP('chu'),[lx,ly]=GP('liang'),[zx,zy]=GP('zhao'),[qx,qy]=GP('linzi'),[ax,ay]=GP('changan');return g('s-fronts',title('front-title','七国起兵，分成三路')+g('front-map',mapBase()+mapFooter())+
 trace('front-wu-route',`M${wx} ${wy}Q${wx-60} ${wy-55} ${cx} ${cy}Q${cx-50} ${cy-35} ${lx+34} ${ly}`,C.red,7,'marker-end="url(#art-arrow)"')+
 trace('front-sd-route',`M${qx+177} ${qy+42}Q${qx+112} ${qy+106} ${qx+42} ${qy+53}`,C.red,5,'marker-end="url(#art-arrow)"')+
 trace('front-zhao-route',`M${zx} ${zy+14}Q${zx-25} ${zy+50} ${zx-9} ${zy+85}`,C.red,5,'marker-end="url(#art-arrow)"')+
 g('front-linzi',mapDot('临淄','linzi',C.ink,-83,-33,34))+
 trace('front-surround',`M${qx+3} ${qy-25}C${qx+48} ${qy-38} ${qx+64} ${qy+26} ${qx+22} ${qy+35}C${qx-20} ${qy+46} ${qx-31} ${qy-16} ${qx+3} ${qy-25}`,C.red,3)+
 trace('front-response0',`M${ax+18} ${ay+6}Q${ax+195} ${ay+85} ${lx-52} ${ly+14}`,C.green,4,'marker-end="url(#art-arrow)"')+
 trace('front-response1',`M${ax+18} ${ay-12}Q${ax+198} ${ay-200} ${zx-36} ${zy+6}`,C.green,4,'marker-end="url(#art-arrow)"')+
 trace('front-response2',`M${ax+18} ${ay-17}Q${ax+300} ${ay-345} ${qx-50} ${qy-13}`,C.green,4,'marker-end="url(#art-arrow)"')+
 g('front-block',L(lx+35,ly-36,lx+35,ly+36,C.ink,8)+mapText('西进受阻',lx,ly+145,C.ink,44,'middle'))+
 g('front-label-clarity',mapLabels('front'))
 );}
function reform(){return g('s-reform',g('reform-dates',
 title('reform-separate','从削地，到收回治国权')+
 g('reform-date154',T('公元前',220,375,32,C.muted)+T('154',210,543,176,C.red,'title')+T('削减封地',220,628,44,C.ink,'title'))+
 g('reform-date145',T('公元前',1110,375,32,C.muted)+T('145',1100,543,176,C.ink,'title')+T('不得复治国',1110,628,44,C.ink,'title'))+
 trace('reform-years','M220 716H1655',C.gold,4)+g('reform-dot154',E(420,716,9,9,C.red))+g('reform-dot145',E(1310,716,9,9,C.ink)))+
 g('reform-stage',P('M0 824Q436 746 962 822Q1482 734 1920 824V970H0Z',C.pale,'none')+
 g('reform-palace',at(hall({w:500}),960,774,1.15)+T('王国官署',960,914,44,C.ink,'title','middle'))+
 g('reform-king',at(flag(),325,742,1)+actor('royal','reform-king-person',455,782,.67,{robe:C.red})+T('诸侯王',421,857,44,C.goldD,'title','middle'))+
 g('reform-court',at(flag('汉',C.green),1496,742,1)+actor('royal','reform-emperor',1628,782,.67,{robe:C.ink,variant:1})+T('天子',1592,857,44,C.green,'title','middle'))+
 trace('reform-old','M527 520H713',C.gold,5,'marker-end="url(#art-arrow)"')+trace('reform-new','M1490 520H1210',C.green,5,'marker-end="url(#art-arrow)"')+
 g('reform-official-move',actor('official','reform-appointee',1154,820,.53,{robe:C.green,variant:2,flip:true}))+
 g('reform-kept',T('王号仍在',421,914,32,C.muted,'body','middle'))+
 g('reform-appointed',T('天子置官',1350,470,36,C.green,'title','middle'))+
 g('reform-year',T('前145年 · 不得复治国',120,160,64,C.ink,'title')))
 );}

function answer(){return g('s-answer',g('answer-view',at(landscape('answer-area'),80,230,1.15))+
 g('answer-head',T('从封地，深入到治国权',120,160,64,C.ink,'title'))+
 g('answer-landmark',L(80,880,80,303,C.gold,5)+L(80,303,1185,303,C.gold,5)+L(1185,303,1185,880,C.gold,5))+
 g('answer-labels',g('answer-governance-label',T('治理',586,922,44,C.ink,'title','middle'))+g('answer-population-label',T('人口',1120,922,44,C.green,'title','middle'))+g('answer-income-label',T('财源',1640,922,44,C.goldD,'title','middle')))+
 trace('answer-authority','M1648 342V297H642V330',C.green,4,'marker-end="url(#art-arrow)"')+
 g('answer-court',tag('汉',1648,330,C.green))+
 g('answer-final',T('谁来组织',116,412,96,C.ink,'title')+T('帝国的力量？',112,538,96,C.ink,'title')+L(120,584,704,584,C.red,4)+T('削地 → 收回治国权',120,650,36,C.muted))+
 g('answer-final-authority',tag('汉',1178,345,C.green)+T('天子置官',1260,315,40,C.green,'title')+trace('answer-final-link','M1178 360V440',C.green,4,'marker-end="url(#art-arrow)"'))
 );}
export function makeFilm(D,data){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="七国之乱全 SVG 讲解">${defs()}${mapDefs(data)}${R(0,0,1920,1080,C.paper)}<g id="scenes" clip-path="url(#art-stage)" data-layout-allow-overflow="true">${question()+system()+offices()+wealth()+edict()+meaning()+rebellion()+fronts()+reform()+answer()}</g><g id="wipe">${R(0,0,1920,970,C.ink)}</g><g id="captions">${R(0,978,1920,102,C.paper)}<text id="caption-text" x="960" y="1037" text-anchor="middle" font-size="36" class="body" fill="${C.ink}"></text></g></svg>`;}
