// 虚构教学示范：批准改变文书，送达改变货物的位置与接收状态。
const art = (id, crop, width, height) => `<g id="${id}"><svg width="${width}" height="${height}" viewBox="${crop.join(' ')}" overflow="hidden"><defs><clipPath id="${id}-crop"><rect x="${crop[0]}" y="${crop[1]}" width="${crop[2]}" height="${crop[3]}"/></clipPath></defs><image href="asset:AR001" width="1536" height="1024" clip-path="url(#${id}-crop)"/></svg></g>`;

function animate({select, cue, onFrame}) {
  const clamp = v => Math.max(0, Math.min(1, v));
  const ease = v => {v=clamp(v);return v*v*(3-2*v)};
  const ramp = (t, start, length=.5) => ease((t-start)/length);
  const show = (id, opacity) => select(id).setAttribute('opacity', clamp(opacity));
  const pose = (id, {x=0,y=0,s=1,r=0}) => select(id).setAttribute('transform', `translate(${x} ${y}) rotate(${r}) scale(${s})`);
  const track = (keys, t) => {
    let a=keys[0];
    for (const b of keys.slice(1)) {
      if(t<=b.at){
        const p=b.linear?clamp((t-a.at)/(b.at-a.at)):ease((t-a.at)/(b.at-a.at));
        return Object.fromEntries(['x','y','s','r'].map(k=>[k,(a[k]??(k==='s'?1:0))+((b[k]??(k==='s'?1:0))-(a[k]??(k==='s'?1:0)))*p]));
      }
      a=b;
    }
    return a;
  };
  const stamp=cue('M001')+1.85, depart=cue('M002'), arrive=cue('M003');
  const stampKeys=[{at:0,x:640,y:250,r:5},{at:stamp-.35,x:630,y:225,r:7},
    {at:stamp,x:555,y:299,r:-4},{at:stamp+.13,x:555,y:309,r:-4},
    {at:stamp+.27,x:555,y:294,r:-3},{at:stamp+.7,x:865,y:230,r:12},
    {at:stamp+1.25,x:1150,y:290,s:.8,r:18}];
  const cargoKeys=[{at:0,x:135,y:590,r:-2},{at:depart,x:135,y:590,r:-2},
    {at:depart+.25,x:125,y:600,r:-4},{at:depart+1.05,x:520,y:690,s:.82,r:2},
    {at:arrive-1.65,x:1030,y:650,s:.66,linear:true},
    {at:arrive-.75,x:1410,y:436,s:.62,r:1},{at:arrive-.25,x:1410,y:449,s:.62,r:-1},
    {at:arrive,x:1410,y:446,s:.62}];
  // A shot is chosen from the action's world-space bounds, not a guessed zoom factor.
  const view={x:120,y:240,width:1680,height:720};
  const frame=(x,y,width,height)=>({x:x+width/2,y:y+height/2,s:Math.min(view.width/width,view.height/height),r:0});
  const wide=frame(100,230,1720,740),sealView=frame(505,405,360,250),
    cargoView=frame(110,560,590,390),travelView=frame(490,620,760,410),
    landingView=frame(1320,405,500,370);
  const cameraKeys=[{at:0,...wide},{at:stamp-.95,...wide},{at:stamp-.45,...sealView},
    {at:stamp+.8,...sealView},{at:stamp+1.4,...wide},
    {at:depart-.55,...wide},{at:depart-.15,...cargoView},
    {at:depart+1.2,...travelView},{at:arrive-.95,...landingView},
    {at:arrive+1.65,...landingView},{at:arrive+2.45,...wide}];
  const route=select('#route'), length=route.getTotalLength();
  onFrame(({time:t})=>{
    const approved=t>=stamp+.13, arrived=t>=arrive;
    const camera=track(cameraKeys,t);
    select('#camera').setAttribute('transform',`translate(${view.x+view.width/2} ${view.y+view.height/2}) scale(${camera.s}) translate(${-camera.x} ${-camera.y})`);
    pose('#document',{x:400,y:270,r:-4});
    pose('#stamp',track(stampKeys,t));
    show('#stamp',ramp(t,stamp-.95,.35)*(1-ramp(t,stamp+.7,.55)));
    show('#seal',approved?1:0);
    pose('#parcel',track(cargoKeys,t));
    pose('#desk',{x:1190,y:540});show('#desk',ramp(t,depart-1.5,.65));
    const head=ramp(t,depart-.65,.55), tail=ramp(t,depart,arrive-depart);
    route.setAttribute('stroke-dasharray',`${Math.max(0,head-tail)*length} ${length*2}`);
    route.setAttribute('stroke-dashoffset',-tail*length);
    show('#route',1-ramp(t,arrive-.3,.3));
    show('#question',1-ramp(t,stamp+.4,.5));
    show('#unmoved',ramp(t,stamp+1.05,.35)*(1-ramp(t,depart-.15,.15)));
    show('#shipping',ramp(t,depart-.05,.3)*(1-ramp(t,arrive-.1,.1)));
    show('#received',arrived?ramp(t,arrive+.25,.4)*(1-ramp(t,arrive+3.5,.4)):0);
    show('#tick',arrived?ramp(t,arrive+.15,.25):0);
    show('#ending',ramp(t,arrive+3.75,.45));
  });
}

export function createExample() {
  return {
    duration:18,
    cues:{M001:0,M002:5.1,M003:9.45},
    scene:{
      markup:`<style>:host{display:block;width:100%;height:100%;background:var(--background);color:var(--ink)}#canvas{width:100%;height:100%}text{fill:var(--ink);font-family:var(--font-body);font-weight:500;font-size:64px}.title{font-family:var(--font-title);font-weight:900;font-size:96px}.accent{fill:var(--accent)}</style>
<svg id="canvas" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="shot-window"><rect x="120" y="240" width="1680" height="720"/></clipPath></defs>
  <g clip-path="url(#shot-window)"><g id="camera">
  <path id="route" d="M530 875 Q945 920 1300 680" fill="none" stroke="#cec099" stroke-width="25" stroke-linecap="round"/>
  <g id="document">${art('paper',[125,10,585,510],460,401)}<g id="seal" opacity="0" fill="var(--accent)"><rect x="178" y="238" width="174" height="90" fill="none" stroke="var(--accent)" stroke-width="4"/><text x="195" y="308" class="accent" font-size="60">批准</text></g></g>
  ${art('desk',[785,520,740,495],610,408)}
  ${art('parcel',[35,525,720,485],500,337)}
  ${art('stamp',[900,5,475,515],225,244)}
  <path id="tick" d="M1595 650 L1613 663 L1646 628" fill="none" stroke="var(--accent)" stroke-width="9" opacity="0"/>
  </g></g>
  <text id="question" class="title" x="140" y="190">盖章，就送到了？</text>
  <text id="unmoved" class="accent" x="150" y="985" opacity="0">箱货未动</text>
  <text id="shipping" class="title accent" x="960" y="200" text-anchor="middle" opacity="0">上路</text>
  <text id="received" class="title accent" x="1510" y="340" text-anchor="middle" opacity="0">已送达</text>
  <g id="ending" opacity="0"><text class="title accent" x="960" y="190" text-anchor="middle">批准 ≠ 送达</text><text x="620" y="790" text-anchor="middle">已批准</text><text class="accent" x="1495" y="1010" text-anchor="middle">已送达</text></g>
</svg>`,
      animation:`(${animate.toString()})({select,cue,onFrame});`
    }
  };
}
