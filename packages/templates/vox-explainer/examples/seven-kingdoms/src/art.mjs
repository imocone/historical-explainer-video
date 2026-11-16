import {C,N,g,at,P,R,L,tree,human,hall,house,coin,sack,furnace,saltpan,flag,castle,homestead} from '../../../artwork/art.mjs';

export function terrain(){return P('M0 690Q180 535 390 636Q590 447 823 605Q1060 471 1240 594Q1550 476 1920 615V970H0Z',C.pale,'none')+P('M0 775Q325 652 623 751Q987 625 1223 719Q1620 644 1920 738V970H0Z','#e4e5d7','none')+P('M0 882Q450 768 816 840Q1160 775 1520 853Q1770 791 1920 831V970H0Z',C.cream,'none');}
export function landscape(prefix){return g(prefix+'-ground',P('M0 290Q320 220 650 268Q1070 215 1500 270V560Q1180 576 850 567Q420 580 0 560Z',C.pale,'none')+P('M0 450Q300 370 660 425Q1100 365 1500 429V560Q1180 576 850 567Q420 580 0 560Z',C.cream,'none')+P('M0 510H1500','none',C.ink,2))+
 g(prefix+'-hall',at(hall({w:430}),440,365,.83))+
 g(prefix+'-homes',at(homestead(),818,438,.88)+at(homestead(1),1130,441,.92)+tree(1255,396,.74))+
 g(prefix+'-fields',N(4,i=>{const x=[680,800,1035,1155][i];return P(`M${x} 535l30-55h89l-30 55Z`,i%2?C.greenL:C.goldL,C.ink,1.5)+N(5,j=>L(x+10+j*16,528,x+35+j*16,486,C.green,1.2));}))+
 g(prefix+'-people',N(6,i=>at(human({robe:i%2?C.green:C.red,pose:i%3?'stand':'scroll',variant:i%3,flip:i===2||i===4}),[665,718,821,997,1103,1250][i],[429,474,477,444,480,474][i],.43)))+
 g(prefix+'-industry',at(furnace(),1350,335,.64)+at(saltpan(),1374,453,.53)+N(3,i=>at(sack(),1305+i*36,505,.6)))+
 tree(70,455,1.0)+tree(148,425,.8)+tree(686,337,.65)+tree(740,359,.45)+g(prefix+'-banner',at(flag(),237,385,.7));}
export function defs(){return `<defs><g id="art-person">${human()}</g><g id="art-clerk">${human({robe:C.green,pose:'scroll',hat:true})}</g><g id="art-worker">${human({robe:C.roof,pose:'work'})}</g><g id="art-guard">${human({robe:C.roof,pose:'guard',hat:true})}</g><g id="art-house">${house()}</g><g id="art-coin">${coin()}</g><g id="art-sack">${sack()}</g><g id="art-hall">${hall()}</g><g id="art-castle">${castle()}</g><clipPath id="art-stage">${R(0,0,1920,970,C.paper)}</clipPath><marker id="art-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>`;}
