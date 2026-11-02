import { platePose } from '../render-policy.mjs';
const W=1920,H=1080,MW=480,MH=270;
const clamp=x=>Math.min(1,Math.max(0,x));
const mix=(a,b,p)=>a+(b-a)*p;
const phase=(t,a,b)=>clamp((t-a)/(b-a));
const ease=(t,a,b)=>{const p=phase(t,a,b);return p*p*(3-2*p)};
const out=(t,a,b)=>1-(1-phase(t,a,b))**4;
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};
function noise(x,y){const a=Math.floor(x),b=Math.floor(y),u=ease(x-a,0,1),v=ease(y-b,0,1);return mix(mix(hash(a+b*157),hash(a+1+b*157),u),mix(hash(a+(b+1)*157),hash(a+1+(b+1)*157),u),v)}
function canvas(w=W,h=H){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function cover(c,img,scale=1,x=0,y=0){const s=Math.max(W/img.width,H/img.height)*scale;c.drawImage(img,(W-img.width*s)/2+x,(H-img.height*s)/2+y,img.width*s,img.height*s)}
function sprite(color){const c=canvas(96,96),g=c.getContext('2d'),r=g.createRadialGradient(48,48,0,48,48,48);r.addColorStop(0,'#fff9e7');r.addColorStop(.08,color);r.addColorStop(.30,color+'65');r.addColorStop(1,color+'00');g.fillStyle=r;g.fillRect(0,0,96,96);return c}

export function createImpactRenderer(target,images,config){
 const ctx=target.getContext('2d',{alpha:true}),layer=canvas(),lc=layer.getContext('2d');
 const matte=canvas(MW,MH),mc=matte.getContext('2d'),rim=canvas(MW,MH),rc=rim.getContext('2d'),char=canvas(MW,MH),cc=char.getContext('2d');
 const mp=mc.createImageData(MW,MH),rp=rc.createImageData(MW,MH),cp=cc.createImageData(MW,MH);
 const end=config.introSeconds,bodyStart=config.body.reveal,starts=config.beats.map(b=>b.start).concat(bodyStart);
 const strength=config.motion.intensity,warm=sprite(config.colors.ember),cold=sprite('#97d1e9');
 const grain=canvas(192,108),gc=grain.getContext('2d'),gp=gc.createImageData(192,108);
 for(let i=0;i<192*108;i++){const n=hash(i)*255;gp.data.set([n,n,n,255],i*4)}gc.putImageData(gp,0,0);const paper=ctx.createPattern(grain,'repeat');
 const dust=canvas(256,256),dc=dust.getContext('2d'),dp=dc.createImageData(256,256);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const nx=(x-128)/128,ny=(y-128)/128,d=Math.hypot(nx,ny),n=noise(x*.040,y*.040)*.7+noise(x*.14,y*.14)*.3,j=(y*256+x)*4;
  dp.data[j]=10;dp.data[j+1]=16;dp.data[j+2]=23;dp.data[j+3]=Math.round(clamp((1-d)*2.2)*clamp((n-.25)*2.8)*210);
 }dc.putImageData(dp,0,0);
 const fields=starts.map((_,cut)=>{
  const f=new Float32Array(MW*MH),cx=cut===1?.64:cut===3?.36:.52,cy=cut===1?.41:.48;
  for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
   const nx=x/MW,ny=y/MH,n=noise(x*.025+cut*8,y*.025)*.11+noise(x*.092,y*.092+cut*4)*.035+hash(x+y*MW)*.008;
   f[y*MW+x]=cut===2?nx*.71+ny*.13+n:Math.hypot((nx-cx)*1.05,(ny-cy)*.88)*1.05+n;
  }
  return f;
 });

 const inverseEase=v=>{let a=0,b=1;for(let i=0;i<14;i++){const m=(a+b)/2;if(m*m*(3-2*m)<v)a=m;else b=m}return (a+b)/2};
 const edgeSeeds=fields.map((field,cut)=>{
  if(!cut)return [];
  const duration=cut===3?end-bodyStart:cut===1?.48:.43;
  return Array.from({length:510},(_,i)=>{
   const x=2+Math.floor(hash(i+cut*819)* (MW-4)),y=2+Math.floor(hash(i+cut*479+93)*(MH-4)),v=field[y*MW+x];
   const gx=field[y*MW+x+1]-field[y*MW+x-1],gy=field[(y+1)*MW+x]-field[(y-1)*MW+x];
   return {x:x/MW*W,y:y/MH*H,at:starts[cut]+inverseEase(clamp((v+.085)/1.245))*duration,angle:Math.atan2(gy,gx)+(hash(i+47)-.5)*1.65,speed:80+hash(i+71)*620,size:1.1+hash(i+62)*2.9,life:.23+hash(i+38)*.58};
  });
 });
 function rimEmbers(t){
  const exit=1-ease(t,end-.18,end+.08);if(exit<=0)return;
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const seeds of edgeSeeds)for(const s of seeds){
   const age=t-s.at;if(age<0||age>s.life)continue;
   const travel=s.speed*(1-Math.exp(-age*3.3))*.42,fade=(1-age/s.life)**1.4*exit;
   const vx=Math.cos(s.angle),vy=Math.sin(s.angle),x=s.x+vx*travel,y=s.y+vy*travel*.72-age*age*40,tail=3+s.speed*.018*(1-age/s.life);
   ctx.globalAlpha=fade*.85;ctx.drawImage(warm,x-s.size*4,y-s.size*4,s.size*8,s.size*8);
   ctx.globalAlpha=fade;ctx.strokeStyle='#ffd89a';ctx.lineWidth=s.size*.6;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-vx*tail,y-vy*tail*.72);ctx.stroke();
  }ctx.restore();
 }
 function grade(c){c.filter='saturate(.94) contrast(1.10) brightness(.99)'}
 function bottom(c,amount=.52){const g=c.createLinearGradient(0,H*.45,0,H);g.addColorStop(0,'#03080d00');g.addColorStop(1,`rgba(3,8,13,${amount})`);c.fillStyle=g;c.fillRect(0,0,W,H)}
 function scenery(index,t){
  lc.globalAlpha=1;lc.globalCompositeOperation='source-over';lc.filter='none';lc.clearRect(0,0,W,H);
  {
   const b=config.beats[index],local=Math.max(0,t-b.start),settle=out(local,0,index===0?.62:.48),drift=Math.max(0,local-.48),kick=Math.exp(-local*19)*Math.sin(local*85)*13*strength;
   grade(lc);
   cover(lc,images[b.image],mix(index===0?1.40:1.30,1.065,settle)+drift*.016,mix(index===0?-105:90,0,settle)-drift*10+kick,kick*.33);
   if(b.foreground){lc.filter='saturate(.85) contrast(1.16) brightness(.84)';cover(lc,images[b.foreground],mix(1.70,1.09,settle)+drift*.026,mix(255,-12,settle)-drift*20,kick*.4)}
   lc.filter='none';bottom(lc);
   const right=index===1,g=lc.createLinearGradient(right?W:0,H*.55,right?0:W,H*.42);
   g.addColorStop(0,'#03090df7');g.addColorStop(.24,'#03090de8');g.addColorStop(.45,'#03090da8');g.addColorStop(.71,'#03090d18');g.addColorStop(1,'#03090d00');
   lc.fillStyle=g;lc.fillRect(0,0,W,H);
  }
 }
 function burn(cut,p){
  const threshold=mix(-.085,1.16,p),field=fields[cut];
  for(let i=0;i<field.length;i++){
   const j=i*4,d=threshold-field[i],a=clamp(d/.010+.5),core=Math.max(0,1-Math.abs(d)/.0028),halo=Math.max(0,1-Math.abs(d)/.019),scorch=Math.max(0,1-Math.abs(d+.014)/.019);
   mp.data[j]=mp.data[j+1]=mp.data[j+2]=255;mp.data[j+3]=Math.round(a*255);
   rp.data[j]=255;rp.data[j+1]=Math.round(70+core*172);rp.data[j+2]=Math.round(12+core*175);rp.data[j+3]=Math.round(Math.min(1,core+halo*.38)*255);
   cp.data[j]=25;cp.data[j+1]=13;cp.data[j+2]=9;cp.data[j+3]=Math.round(scorch*200);
  }
  mc.putImageData(mp,0,0);rc.putImageData(rp,0,0);cc.putImageData(cp,0,0);
  ctx.drawImage(char,0,0,W,H);
  lc.globalCompositeOperation='destination-in';lc.drawImage(matte,0,0,W,H);lc.globalCompositeOperation='source-over';ctx.drawImage(layer,0,0);
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.74;ctx.filter='blur(14px)';ctx.drawImage(rim,0,0,W,H);ctx.filter='none';ctx.globalAlpha=.95;ctx.drawImage(rim,0,0,W,H);ctx.restore();
 }
 function flare(t){
  for(const [i,start] of starts.entries()){
   const age=t-start;if(age<0||age>.42||i===3)continue;
   const p=out(age,0,.32),x=mix(-500,2500,p);
   ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=(1-p)*.8*strength;ctx.translate(x,H*.5);ctx.rotate(-.35);
   const g=ctx.createLinearGradient(-140,0,140,0);g.addColorStop(0,'#ffb65d00');g.addColorStop(.46,'#ffc16b66');g.addColorStop(.50,'#fff4d7');g.addColorStop(.54,'#ffc16b66');g.addColorStop(1,'#ffb65d00');ctx.fillStyle=g;ctx.fillRect(-140,-1500,280,3000);ctx.restore();
   if(age<.055){ctx.save();ctx.globalAlpha=(1-phase(age,0,.055))*(i===0?.25:.33)*strength;ctx.fillStyle='#ffe8be';ctx.fillRect(0,0,W,H);ctx.restore()}
  }
 }
 function embers(t){
  const exit=1-ease(t,5.5,6.15);if(exit<=0)return;
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let i=0;i<155;i++){
   const z=.25+hash(i+61)*1.75,speed=32+z*72,x=(hash(i+8)*2400+t*speed+4800)%2400-220,y=(hash(i+87)*1400-t*speed*.64+2800)%1400-140;
   const r=3+z*4,a=(.18+hash(i+3)*.7)*exit;
   ctx.globalAlpha=a;ctx.drawImage(i%5?warm:cold,x-r*3,y-r*3,r*6,r*6);
   ctx.lineWidth=.8+z*.8;ctx.strokeStyle=i%5?'#ffd6a1':'#aee0f4';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-z*6,y+z*3);ctx.stroke();
  }
  for(const [cut,start] of starts.slice(0,3).entries()){
   const age=t-start;if(age<0||age>1.0)continue;
   const fade=(1-ease(age,.19,1))*exit,ox=cut===1?W*.66:W*.52,oy=H*.46;
   for(let i=0;i<90;i++){
    const a=hash(i+cut*919)*Math.PI*2,speed=(220+hash(i+25)*1600)*strength,drag=1-Math.exp(-age*3.0),x=ox+Math.cos(a)*speed*drag,y=oy+Math.sin(a)*speed*drag*.66+age*age*110;
    const tail=(1-ease(age,.05,.65))*(14+hash(i+9)*52),r=2+hash(i+42)*4;
    ctx.globalAlpha=fade*(.35+hash(i+8)*.65);ctx.drawImage(warm,x-r*4,y-r*4,r*8,r*8);
    ctx.strokeStyle='#ffe8b4';ctx.lineWidth=.9+hash(i+6)*2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(a)*tail,y-Math.sin(a)*tail*.66);ctx.stroke();
   }
  }
  ctx.restore();
 }
 function powder(t){
  const age=t-config.beats[2].start;if(age<0||age>.78)return;
  const p=out(age,0,.5),fade=(1-ease(age,.25,.78))*phase(age,0,.05);
  ctx.save();ctx.globalAlpha=fade*.48;
  for(let i=0;i<12;i++){
   const angle=-Math.PI/2+(hash(i+19)-.5)*2.7,reach=(100+hash(i+8)*440)*p;
   const x=W*.62+Math.cos(angle)*reach,y=H*.57+Math.sin(angle)*reach;
   const size=mix(55,160+hash(i+44)*240,p);ctx.save();ctx.translate(x,y);ctx.rotate(angle+Math.PI/2);ctx.drawImage(dust,-size/2,-size*.85,size,size*1.7);ctx.restore();
  }ctx.restore();
 }
 function speedLines(t){
  for(const start of starts.slice(0,3)){
   const age=t-start;if(age<0||age>.32)continue;
   const p=out(age,0,.32);ctx.save();ctx.globalAlpha=(1-p)*.28*strength;ctx.lineWidth=1.2;
   for(let i=0;i<44;i++){
    const a=hash(i+44)*6.28,r=480+hash(i+3)*600,len=100+hash(i+61)*450;ctx.strokeStyle=i%4?'#f5e2c0':'#84c5de';
    ctx.beginPath();ctx.moveTo(W*.56+Math.cos(a)*r,H*.45+Math.sin(a)*r*.75);ctx.lineTo(W*.56+Math.cos(a)*(r+len),H*.45+Math.sin(a)*(r+len)*.75);ctx.stroke();
   }ctx.restore();
  }
 }
 // The whole picture accelerates into the closing beat; depth persists through the release.
 const oldPaint=canvas(),oc=oldPaint.getContext('2d');scenery(2,5.48);oc.drawImage(layer,0,0);
 const ground=ctx.createRadialGradient(950,520,90,980,540,1100);ground.addColorStop(0,'#12202a');ground.addColorStop(1,'#07101a');
 const strokes=[
  {image:'O01',x:975,y:440,w:1570,h:350,angle:18,from:-1,delay:0,fy:.36},
  {image:'O02',x:965,y:530,w:1640,h:360,angle:-25,from:1,delay:.025,fy:.46},
  {image:'O03',x:990,y:835,w:1700,h:330,angle:-3,from:1,delay:.05,fy:.62}
 ];
 function strokePath(c,w,h,open=0,left=-w/2,right=w/2){
  const cut=Math.min(28,h*.085)*Math.max(0,1-open);
  c.beginPath();c.moveTo(Math.max(left,-w/2+cut),-h/2);c.lineTo(Math.min(right,w/2),-h/2);
  c.lineTo(Math.min(right,w/2-cut),h/2);c.lineTo(Math.max(left,-w/2),h/2);c.closePath();
 }
 function photo(c,spec,w,h,shift=0){
  const img=images[spec.image],scale=Math.max(w/img.width,h/img.height)*1.06;
  c.save();c.beginPath();c.rect(-w/2+shift,-h/2,w,h);c.clip();grade(c);
  c.drawImage(img,-img.width*scale/2+shift,(h-img.height*scale)*spec.fy-h/2,img.width*scale,img.height*scale);c.filter='none';
  const shade=c.createLinearGradient(0,-h/2,0,h/2);shade.addColorStop(0,'#06101a00');shade.addColorStop(1,'#06101a40');c.fillStyle=shade;c.fillRect(-w/2+shift,-h/2,w,h);
  if(spec.image!=='O01'){c.fillStyle=spec.image==='O02'?'#07101a10':'#07101a08';c.fillRect(-w/2+shift,-h/2,w,h)}c.restore();
 }
 function contact(w,h,open,left=-w/2,pressure=0){
  if(w/2-left<32)return;
  const lift=1-ease(open,.5,1);
  ctx.save();ctx.shadowColor='rgba(0,0,0,.54)';ctx.shadowBlur=mix(16,5,pressure)*lift;ctx.shadowOffsetY=mix(7,1.8,pressure)*lift;ctx.shadowOffsetX=-3*lift;
  strokePath(ctx,w,h,open,left);ctx.fillStyle='#050b10';ctx.fill();ctx.restore();
 }
 function printEdge(w,h,open){
  const stock=Math.max(0,1-open),cut=Math.min(28,h*.085)*stock;
  ctx.save();ctx.globalAlpha=stock;
  ctx.strokeStyle='#02060988';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(-w/2,h/2-1);ctx.lineTo(w/2-cut,h/2-1);ctx.stroke();
  ctx.strokeStyle='#b9ab9460';ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(-w/2+cut,-h/2+.7);ctx.lineTo(w/2,-h/2+.7);ctx.stroke();
  ctx.strokeStyle='#ddd0b044';ctx.lineWidth=.65;
  for(let i=0;i<w/9;i++){
   const x=-w/2+cut+i*9;if(x>w/2)break;
   ctx.beginPath();ctx.moveTo(x,-h/2+.3);ctx.lineTo(x+2+hash(i+41)*4,-h/2+1.1);ctx.stroke();
  }
  ctx.restore();
 }
 function plate(t,i,body,foreground=false){
  const p=platePose(t,i),{x,y,angle,w,h,open,drive}=p,spec=strokes[i];
  if(foreground&&drive<=0)return;
  ctx.save();ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);
  const track=w*(1-drive);
  if(i!==1||foreground)contact(w,h,open,foreground?-w/2+track:-w/2,ease(t,6.26,6.42)*(1-open));
  ctx.save();strokePath(ctx,w,h,open);ctx.clip();
  if(i!==1)photo(ctx,spec,w,h);
  else if(foreground){
   ctx.beginPath();ctx.rect(-w/2+track,-h/2,w,h);ctx.clip();ctx.globalCompositeOperation='destination-out';ctx.fillRect(-W/2+track,-H/2,W,H);ctx.globalCompositeOperation='source-over';
  }else{
   ctx.beginPath();ctx.rect(-w/2-w*drive,-h/2,w,h);ctx.clip();photo(ctx,spec,w,h,-w*drive);
  }
  printEdge(w,h,open);ctx.restore();ctx.restore();
 }
 function finale(t){
  const body=null;
  ctx.fillStyle=ground;ctx.fillRect(0,0,W,H);
  ctx.save();ctx.globalAlpha=1-ease(t,5.48,5.86);ctx.drawImage(oldPaint,0,-65*ease(t,5.48,5.86));ctx.restore();
  ctx.save();ctx.globalAlpha=.025;ctx.fillStyle=paper;ctx.fillRect(0,0,W,H);ctx.restore();
  // The arriving body alone occludes the other paintings; the outgoing harbour stays behind.
  plate(t,1,body);plate(t,0,body);plate(t,2,body);plate(t,1,body,true);
 }
 return t=>{
  ctx.clearRect(0,0,W,H);if(t>=7.16)return;
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.fillStyle=config.colors.ink;ctx.fillRect(0,0,W,H);
  let index=0;for(let i=1;i<starts.length;i++)if(t>=starts[i])index=i;
  if(t>=5.48)finale(t);
  else if(index===0){scenery(0,t);ctx.drawImage(layer,0,0)}
  else{
   const duration=index===starts.length-1?end-bodyStart:index===1?.48:.43,p=ease(t,starts[index],starts[index]+duration);
   if(p<1){scenery(index-1,t);ctx.drawImage(layer,0,0);scenery(index,t);burn(index,p)}
   else{scenery(index,t);ctx.drawImage(layer,0,0)}
  }
  const finish=1-ease(t,5.48,5.72);
  ctx.save();ctx.globalAlpha=.08*finish;ctx.globalCompositeOperation='soft-light';ctx.translate(Math.floor(t*18)%3*13,Math.floor(t*13)%3*7);ctx.fillStyle=paper;ctx.fillRect(-40,-40,W+80,H+80);ctx.restore();
  powder(t);embers(t);if(t<5.48)rimEmbers(t);speedLines(t);flare(t);
  ctx.save();ctx.globalAlpha=finish;const v=ctx.createRadialGradient(W*.52,H*.44,H*.22,W*.5,H*.5,H);v.addColorStop(0,'#02071000');v.addColorStop(1,'#020710bb');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);ctx.restore();
  const bar=36*finish;ctx.fillStyle='#03070c';ctx.fillRect(0,0,W,bar);ctx.fillRect(0,H-bar,W,bar);
 };
}
