const E={};for(const id of ['headline','moving-name','fixed-spin','redirect-spin','moving','moving-spin','moving-yoke','bucket-left','bucket-right','handle-left','handle-right','motion-measures','left-rise','right-rise','left-pull','right-pull','left-rise-text','right-rise-text','left-pull-text','right-pull-text','support','left-support','support-a','support-b','forces','force-left','force-a','force-b','conclusion'])E[id]=select('#'+id);
const C=v=>Math.max(0,Math.min(1,v));const ease=v=>{v=C(v);return v*v*(3-2*v)};
const set=(id,k,v)=>E[id].setAttribute(k,v);const path=(id,d)=>set(id,'d',d);const op=(id,v)=>set(id,'opacity',C(v));
const rope=(id,d)=>{for(const suffix of ['','-edge','-twist'])select('#'+id+suffix).setAttribute('d',d);select('#'+id+'-twist').setAttribute('stroke-dashoffset',0);};
const bracket=(id,x,a,b)=>{let d=`M${x-10} ${a}h20M${x} ${a}V${b}M${x-10} ${b}h20`;for(let k=100;k<Math.abs(b-a);k+=100)d+=`M${x-6} ${a+Math.sign(b-a)*k}h12`;path(id,d);};
onFrame(({time})=>{
 const s=cue('M001'),support=cue('M002'),force=cue('M003'),rewind=cue('M004'),length=cue('M005'),end=cue('M006');
 let uL=0,uR=0;
 if(time<rewind){const p=ease((time-s-2)/3.6);uL=200*p;uR=100*p;}
 else if(time<length){const p=1-ease((time-rewind-.2)/1.6);uL=200*p;uR=100*p;}
 else {const p=ease((time-length-.7)/4.4);uL=uR=150*p;}
 const vL=uL,vR=2*uR,yM=500-uR,yL=575-uL,yR=575-uR,endL=390+vL,endR=390+vR;
 set('moving','transform',`translate(1200 ${yM})`);set('moving-name','y',yM+10);set('moving-yoke','transform',`translate(0 ${-uR})`);
 set('fixed-spin','transform',`rotate(${vL/65*180/Math.PI})`);set('moving-spin','transform',`rotate(${-uR/65*180/Math.PI})`);set('redirect-spin','transform',`rotate(${vR/65*180/Math.PI})`);
 set('bucket-left','transform',`translate(470 ${yL})`);set('bucket-right','transform',`translate(1200 ${yR})`);
 rope('left-rope',`M470 ${yL}V300A65 65 0 0 1 600 300V${endL}`);
 rope('right-rope',`M1135 245V${yM}A65 65 0 0 0 1265 ${yM}V300A65 65 0 0 1 1395 300V${endR}`);
 set('handle-left','transform',`translate(600 ${endL})`);set('handle-right','transform',`translate(1395 ${endR})`);
 bracket('left-rise',350,575,yL);bracket('right-rise',1080,575,yR);bracket('left-pull',680,390,endL);bracket('right-pull',1490,390,endR);
 E['left-rise-text'].textContent=(uL/100).toFixed(1)+' 格';E['right-rise-text'].textContent=(uR/100).toFixed(1)+' 格';E['left-pull-text'].textContent=(vL/100).toFixed(1)+' 格';E['right-pull-text'].textContent=(vR/100).toFixed(1)+' 格';
 const sup=ease((time-support)/.7)*(1-ease((time-force)/.7)),f=ease((time-force)/.7)*(1-ease((time-rewind)/.4));op('support',sup);op('forces',f);op('motion-measures',1-Math.max(sup,f));
 path('left-support',`M470 306V${yL-15}`);path('support-a',`M1135 250V${yM}`);path('support-b',`M1265 306V${yM}`);
 path('force-left',`M435 ${yL-5}v-155`);path('force-a',`M1105 ${yM+15}v-80`);path('force-b',`M1295 ${yM+15}v-80`);
 op('conclusion',ease((time-end+.2)/.8));
 E.headline.textContent=time<support?'同样拉绳，桶为什么升得少？':time<force?'重量由几段绳承担？':time<rewind?'两段绳，各分担一半':time<length?'倒回起点，再换一种比较':time<end?'升到一样高，拉绳的路有多长？':'少一半力，多一倍路';
});
