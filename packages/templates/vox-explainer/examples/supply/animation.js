const $=s=>root.querySelector(s), clamp=v=>Math.max(0,Math.min(1,v)), ease=p=>p*p*(3-2*p);
const opacity=(s,a)=>$(s).setAttribute('opacity',clamp(a)), tr=(s,x,y,k=1)=>$(s).setAttribute('transform',`translate(${x} ${y}) scale(${k})`);
const mix=(a,b,p)=>a+(b-a)*p;
const pos=i=>({x:1210+(i%5)*130,y:386+Math.floor(i/5)*143});
const a=[null,...Array.from({length:8},(_,i)=>cue(`M${String(i+1).padStart(3,'0')}`))];
const enter=(t,s,d=.45)=>ease(clamp((t-s)/d));
function moveCart(id,x,y,k,rotation=0){tr(id,x,y,k);const wheels=$(id).querySelectorAll('.wheel');wheels.forEach((wheel,j)=>wheel.setAttribute('transform',`translate(${j?30:-30} 0) rotate(${rotation})`));}
onFrame(({time:t})=>{
 const stock=t>=a[4]&&t<a[5], upgraded=t>=a[6], close=t>=a[8], surplus=t>=a[7]+3.1&&t<a[8];
 const stockFade=stock?enter(t,a[4]+.18):0, netAlpha=stock?1-enter(t,a[4],.18):surplus?1-enter(t,a[7]+3.1,.25):t>=a[8]?enter(t,a[8],.35):t>=a[5]?enter(t,a[5],.45):1;
 opacity('#network',netAlpha);opacity('#inventory',stockFade);tr('#inventory',0,20*(1-stockFade));
 opacity('#surplus',surplus?enter(t,a[7]+3.25,.25):0);
 opacity('#closing',close?enter(t,a[8]+.4):0);
 opacity('#bridge',enter(t,4.8,.9));tr('#bridge',790,445+(1-enter(t,4.8,.9))*35,upgraded&&!close?1.1:1);
 opacity('#bridge-label',t>=a[3]&&!close?enter(t,a[3],.4):0);
 $('#capacity').textContent=upgraded?'改为 10 车/日':'最多 6 车/日';
 opacity('#send-label',!close&&t>=a[2]+2.7?enter(t,a[2]+2.7):0);
 opacity('#demand-name',!close&&t>=a[2]?enter(t,a[2]):0);opacity('#demand-num',!close&&t>=a[2]?enter(t,a[2]+.3):0);
 opacity('#depot-name',close?0:1);
 opacity('#reserve-label',t>=a[3]+3.9&&t<a[6]?enter(t,a[3]+3.9):0);
 opacity('#shortfall',t>=a[3]+4.05&&t<a[6]?enter(t,a[3]+4.05):0);
 opacity('#empty-reserve',t>=a[5]&&!close?enter(t,a[5]+.2):0);
 opacity('#extra',t>=a[5]&&t<a[6]?enter(t,a[5]+1,.8):0);tr('#extra',-30*(1-enter(t,a[5]+1,.8)),70);
 opacity('#extra-caption',t<a[5]+4?1:1-enter(t,a[5]+4,.5));
 opacity('#equation',t>=a[6]+5.7&&t<a[7]+3.1?enter(t,a[6]+5.7,.6):0);
 for(let i=0;i<10;i++){
  const index=(t>=a[6]&&t<a[7])?[4,3,2,1,0,9,8,7,6,5][i]:(t>=a[3]&&t<a[4]&&i<5)?4-i:i;
  const target=pos(index);let visible=0,x=target.x,y=target.y,rotation=0;
  let stateColor='#969f8d',fill='#d5cdbb';
  if(t>=a[3]&&t<a[4]){
   const raw=clamp((t-a[3]-.7-i*.42)/1.5),p=ease(raw),q=p<.5?p*2:(p-.5)*2;
   visible=i<6&&t>=a[3]+.7+i*.42?1:0;
   x=p<.5?mix(540,1005,q):mix(1005,target.x,q);y=p<.5?431:mix(431,target.y,q);rotation=raw<1?x*1.8:0;
   if(i<6&&raw===1){stateColor='#38766c';fill='#a5b9a4';}else if(i>=6&&t>a[3]+4){stateColor='#a34232';fill='#e6ccae';}
  }else if(t>=a[5]&&t<a[6]){visible=i<6?1:0;stateColor=i<6?'#38766c':'#a34232';fill=i<6?'#a5b9a4':'#e6ccae';}
  else if(t>=a[6]&&t<a[7]){
   const raw=clamp((t-a[6]-1-i*.36)/1.45),p=ease(raw),q=p<.5?p*2:(p-.5)*2;
   visible=t>=a[6]+1+i*.36?1:0;x=p<.5?mix(540,1005,q):mix(1005,target.x,q);y=p<.5?431:mix(431,target.y,q);rotation=raw<1?x*1.8:0;
   if(raw===1){stateColor='#38766c';fill='#a5b9a4';}
  }else if(t>=a[7]&&!surplus&&!close){
   const dt=t-a[7];
   if(dt<1.45){const p=enter(t,a[7]+.55,.6);visible=1-p;y+=28*p;}
   else if(dt<2.9){const p=enter(t,a[7]+1.7,.6);visible=p;y+=-28*(1-p);}
   else {const p=enter(t,a[7]+3,.6);visible=1-p;y+=28*p;}
   stateColor='#38766c';fill='#a5b9a4';
  }else if(close){visible=1;stateColor='#38766c';fill='#a5b9a4';}
  opacity(`#arrival-${i}`,visible);moveCart(`#arrival-${i}`,x,y,.82,rotation);
  const paths=$(`#slot-${index}`).querySelectorAll('path');paths[0].setAttribute('fill',fill);paths[0].setAttribute('stroke',stateColor);paths[1].setAttribute('stroke',stateColor);
  opacity(`#slot-${index}`,t<a[2]?1:enter(t,a[2]+i*.06,.3));
 }
 for(let i=0;i<4;i++){
  const p=ease(clamp((t-a[3]-5-i*.18)/1.2)),target=pos(i+6);
  opacity(`#borrow-${i}`,t>=a[3]+3.9&&t<a[4]?enter(t,a[3]+3.9):0);
  moveCart(`#borrow-${i}`,mix(1180+i*125,target.x,p),mix(736,target.y,p),.82,p*90);
  if(t>a[3]+6.8&&t<a[4]){const paths=$(`#slot-${i+6}`).querySelectorAll('path');paths[0].setAttribute('fill','#d4af73');paths[1].setAttribute('stroke','#b58335');}
 }
 const elapsed=t-a[4],day=Math.min(5,Math.max(0,Math.floor((elapsed-1.48)/.8)+1));
 for(let i=0;i<20;i++){const col=Math.floor(i/4),p=clamp((elapsed-1.1-col*.8)/.38);opacity(`#stock-${i}`,1-p);tr(`#stock-${i}`,0,-26*p,1);}
 $('#stock-count').textContent=`剩余 ${20-4*day} 车`;

 // Both days reuse the same grain-car unit. Retained cars never disappear when the next batch arrives.
 const refillStart=a[7]+3.1;
 const dayStarts=[refillStart+.2,refillStart+2.1];
 let stored=0;
 for(let d=0;d<2;d++){
  const ds=dayStarts[d];
  const incoming=enter(t,ds,.45), used=enter(t,ds+.8,.35), saved=enter(t,ds+1.2,.55);
  if(t>=ds+1.75)stored+=2;
  for(let i=0;i<12;i++){
   const id=`#refill-${d}-${i}`;
   const ox=180+i*135;
   let x=ox-190*(1-incoming),y=410,visible=incoming;
   if(i<10){y+=75*used;visible*=1-used;}
   else{
    const destination=780+(d*2+i-10)*150;
    x=mix(x,destination,saved);y=mix(y,695,saved);
   }
   tr(id,x,y,.78);opacity(id,surplus?visible:0);
  }
 }
 $('#refill-count').textContent=`前线储备 ${stored} 车`;
 $('#refill-day').textContent=t>=dayStarts[1]?'第2天':'第1天';

 let title='粮多，为什么仍会断粮？';
 if(t>=a[2])title='先比较两端的每日数量';
 if(t>=a[3])title=t<a[3]+4?'先看桥能过多少':'六车到达，还差四车';
 if(stock)title=day===5?'第5天，储备耗尽':'20车，能补几天？';
 if(t>=a[5])title='粮更多，桥还是六车';
 if(t>=a[6])title='假设：桥能过十车';
 if(t>=a[7])title='收支平衡，储备不增加';
 if(surplus)title='再假设：每天能送到12车';
 if(close)title='粮多，还要送得到';
 $('#heading').textContent=title;
});
