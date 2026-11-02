import React from "react";
import { OPENER_RENDER_POLICY, openerStripChoreography, openerTimelineForTreatment, openerVisibleStripPanels } from "../render-policy.mjs";
import { Plane, mediaUrl, fontFamily, useVisualStyle, createViewRenderer } from "../../../modules/render-video/runtime/scene-view.jsx";

const W = 1920, H = 1080;
const clamp = x => Math.min(1, Math.max(0, x));
const p = (t, a, b) => clamp((t - a) / (b - a));
const out = x => 1 - (1 - x) ** 4;
const io = x => x < .5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2;
const mix = (a, b, q) => a + (b - a) * q;
const C = { ink: "#06101a", ivory: "#f1e8d4", gold: "#d5aa70", edge: "#ae794b" };
const positions = ["72% 47%", "29% 48%", "52% 46%"];
const still = asset => mediaUrl(asset.frozenStill ?? asset.file);

const Grade = () => <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
  <defs><filter id="folded-tone" colorInterpolationFilters="sRGB">
    <feColorMatrix type="saturate" values=".96"/>
    <feComponentTransfer>
      <feFuncR type="table" tableValues="0 .15 .38 .62 .83 1"/>
      <feFuncG type="table" tableValues=".006 .16 .39 .62 .82 .99"/>
      <feFuncB type="table" tableValues=".018 .18 .42 .64 .83 .98"/>
    </feComponentTransfer>
  </filter></defs>
</svg>;

const Image = ({ asset, index, style = {} }) => <img src={still(asset)} style={{
  position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
  objectPosition: positions[index], filter: "url(#folded-tone)", ...style
}}/>;

function ScreenCopy({ index, frame, fonts, shot, cuts }) {
  const start = index === 0 ? 0 : cuts[index];
  const right = index === 1;
  const lines = shot.screenLines;
  const longest = Math.max(...lines.map(line => Array.from(line).length));
  const size = Math.min(128, Math.floor(1040 / Math.max(1, longest) - 5));
  const textStart = start + (index === 0 ? 2 : 3);
  return <div style={{ position: "absolute", left: right ? undefined : 180, right: right ? 180 : undefined,
    bottom: 220, maxWidth: 1300, textAlign: right ? "right" : "left" }}>
    {lines.map((line, i) => {
      const q = out(p(frame, textStart + i * 3, textStart + 14 + i * 3));
      const at = shot.highlight ? line.indexOf(shot.highlight) : -1;
      const hierarchy = lines.length === 1 && at >= 0 && line !== shot.highlight && Array.from(line).length <= 6;
      const highlightColor = lines.length === 1 && line === shot.highlight && index !== 2 ? "#f3ede0" : "#dcc09c";
      return <div key={i} style={{ fontFamily: fonts.masthead, fontWeight: 400, fontSize: size, lineHeight: 1.3,
        letterSpacing: 5, color: "#f3ede0", whiteSpace: "pre", textShadow: "0 4px 18px #01060be0",
        opacity: q, transform: `translateY(${(1 - q) * 12}px)` }}>
        {at < 0 ? line : <><span style={{ fontSize: hierarchy ? ".90em" : "1em" }}>{line.slice(0, at)}</span>
          <span style={{ color: highlightColor }}>{shot.highlight}</span>
          <span style={{ fontSize: hierarchy ? ".90em" : "1em" }}>{line.slice(at + shot.highlight.length)}</span></>}
      </div>;
    })}
  </div>;
}

function FrontTypography({ index, frame, fonts, shot, cuts, stageEnd }) {
  const start = index === 0 ? 0 : cuts[index];
  const end = index < 2 ? cuts[index + 1] : stageEnd;
  const available = Math.max(1, end - start);
  const right = index === 1;
  const lines = shot.screenLines;
  const longest = Math.max(...lines.map(line => Array.from(line).length));
  const size = Math.min(126, Math.floor(1030 / Math.max(1, longest) - 4));
  const textDuration = Math.max(3, Math.min(14, Math.floor(available * .48)));
  const lineDuration = Math.max(4, Math.min(32, Math.floor(available * .78)));
  const lineProgress = p(frame, start, start + lineDuration);
  const draw = lineProgress * lineProgress * (3 - 2 * lineProgress);
  const streakPosition = right ? 1 - draw : draw;
  return <div style={{ position: "absolute", left: right ? undefined : 150, right: right ? 150 : undefined,
    bottom: 205, maxWidth: 1390, textAlign: right ? "right" : "left", pointerEvents: "none" }}>
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start", maxWidth: "100%" }}>
      {lines.map((line, i) => {
        const at = shot.highlight ? line.indexOf(shot.highlight) : -1;
        const accent = lines.length === 1 && line === shot.highlight && index !== 2 ? C.ivory : "#e7b575";
        const q = out(p(frame, start + 1 + i * 2, start + 1 + i * 2 + textDuration));
        return <div key={i} style={{ overflow: "hidden", padding: "7px 4px", margin: "-7px -4px" }}>
          <div style={{ fontFamily: fonts.title, fontWeight: 500, fontSize: size, lineHeight: 1.28, letterSpacing: 4,
            color: C.ivory, whiteSpace: "pre", textShadow: "0 5px 22px #01060bd9", opacity: q,
            transform: `translateY(${(1 - q) * 18}px)` }}>
            {at < 0 ? line : <>{line.slice(0, at)}<span style={{ color: accent }}>{shot.highlight}</span>{line.slice(at + shot.highlight.length)}</>}
          </div>
        </div>;
      })}
      <div style={{ position: "relative", width: "calc(100% + 100px)", maxWidth: "calc(100vw - 300px)", height: 12, marginTop: 15, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 3, left: 0, right: 0, height: 2,
          background: right ? "linear-gradient(270deg,#edc994 0%,#c59a668f 58%,transparent 100%)" : "linear-gradient(90deg,#edc994 0%,#c59a668f 58%,transparent 100%)",
          transform: `scaleX(${draw})`, transformOrigin: right ? "right" : "left" }}/>
        <div style={{ position: "absolute", top: 1, left: `calc(${streakPosition * 100}% - 95px)`, width: 190, height: 6,
          opacity: Math.sin(Math.PI * lineProgress),
          background: right ? "linear-gradient(270deg,transparent,#f6d6a3 54%,transparent)" : "linear-gradient(90deg,transparent,#f6d6a3 54%,transparent)" }}/>
        <div style={{ position: "absolute", top: 9, width: "35%", height: 1, left: right ? undefined : 0, right: right ? 0 : undefined,
          background: "linear-gradient(90deg,transparent,#d5ad79b0,transparent)",
          transform: `scaleX(${out(p(frame, start + Math.min(7, lineDuration / 3), start + lineDuration))})`,
          transformOrigin: right ? "right" : "left" }}/>
      </div>
    </div>
  </div>;
}

function Hero({ index, frame, asset, fonts, shot, cuts, stageEnd, showCopy = true }) {
  const start = index === 0 ? 0 : cuts[index];
  const end = index < 2 ? cuts[index + 1] + 28 : stageEnd;
  const travel = p(frame, start, Math.max(start + 1, end)) ** 1.12;
  const cam = {
    scale: mix([1.075, 1.30, 1.085][index], [1.29, 1.095, 1.31][index], travel),
    x: mix([22, -48, 18][index], [-48, 32, -42][index], travel),
    y: mix([12, 18, 14][index], [-12, -16, -18][index], travel),
    origin: ["72% 44%", "29% 48%", "54% 46%"][index]
  };
  const right = index === 1;
  return <Plane style={{ background: C.ink, overflow: "hidden" }}>
    <Image asset={asset} index={index} style={{ transformOrigin: cam.origin,
      transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.scale})` }}/>
    <Plane style={{ background: `linear-gradient(${right ? 278 : 82}deg,#03090df7 0%,#03090de8 24%,#03090da8 45%,#03090d18 71%,#03090d00 100%)` }}/>
    <Plane style={{ background: "linear-gradient(0deg,rgba(3,8,13,.52) 0%,rgba(3,8,13,0) 55%)" }}/>
    <Plane style={{ background: "radial-gradient(circle at 52% 44%,#02071000 237.6px,#020710bb 1080px)" }}/>
    {showCopy ? <ScreenCopy index={index} frame={frame} fonts={fonts} shot={shot} cuts={cuts}/> : null}
  </Plane>;
}

function Shutter({index,frame,asset,fonts,start,dir,shot,cuts,stageEnd}){
 const t=frame/60; start/=60;
 const count=7,w=W/count;
 return <Plane style={{perspective:1900,perspectiveOrigin:dir>0?'68% 50%':'32% 50%'}}>{Array.from({length:count},(_,i)=>{
  const order=dir>0?i:count-1-i;const q=io(p(t,start+order*.024,start+order*.024+.30));
  if(q===1)return null;
  return <div key={i} style={{position:'absolute',left:i*w,top:0,width:w+.8,height:H,transformOrigin:dir>0?'left center':'right center',transform:`translateX(${dir*q*36}px) rotateY(${dir*-94*q}deg)`,backfaceVisibility:'hidden',overflow:'hidden',boxShadow:q>0?'14px 0 28px #0008':'none'}}>
   <div style={{position:'absolute',left:-i*w,top:0,width:W,height:H}}><Hero index={index} frame={frame} asset={asset} fonts={fonts} shot={shot} cuts={cuts} stageEnd={stageEnd} showCopy={false}/></div>
   <div style={{position:'absolute',inset:0,background:`linear-gradient(${dir>0?90:270}deg,rgba(0,0,0,${Math.sin(q*Math.PI)*.48}),transparent 70%,rgba(243,201,136,${Math.sin(q*Math.PI)*.45}))`}}/>
   <div style={{position:'absolute',right:dir>0?0:undefined,left:dir<0?0:undefined,top:0,bottom:0,width:2,background:'#edc48c',opacity:Math.sin(q*Math.PI)}}/>
  </div>;
 })}</Plane>;
}


const stripPolicy=OPENER_RENDER_POLICY.strip;
const stripRows=[{top:0,height:397,bandTop:76},{top:397,height:287,bandTop:21},{top:684,height:396,bandTop:20}];
const easeOut3=q=>1-(1-q)**3;
function bandMotion(frame,lane,clock){
 const q=p(frame,clock.enter,clock.stop),speed=180,entryDistance=2100;
 const racingFrames=Math.min(Math.max(0,frame-clock.enter),clock.brake-clock.enter);
 const brakingFrames=Math.min(Math.max(0,frame-clock.brake),clock.stop-clock.brake);
 const brakeSpan=clock.stop-clock.brake,brakeProgress=brakingFrames/brakeSpan;
 // Cubic braking removes most speed early, then resolves to exactly zero.
 const distance=speed*(racingFrames+brakeSpan*(1-(1-brakeProgress)**3)/3);
 const brakeHit=Math.sin(Math.PI*p(frame,clock.brake,clock.brake+12));
 const lockHit=Math.sin(Math.PI*p(frame,clock.stop-9,clock.stop));
 return {q,velocity:(1-brakeProgress)**2,brakeHit,lockHit,
  entryOffsetPx:lane.entryDirection*Math.max(0,entryDistance-distance),
  trackOffsetPx:-lane.entryDirection*Math.max(0,distance-entryDistance)};
}
// The first impulse is strong, while the long tail keeps all three exits legible.
function bandRelease(frame,clock){const q=p(frame,clock.release,clock.end);return .22*(1-(1-q)**8)+.78*(1-(1-q)**1.28);}
function releaseVelocity(frame,clock){
 if(frame<=clock.release||frame>=clock.end)return 0;
 const q=p(frame,clock.release,clock.end);
 return (.22*8*(1-q)**7+.78*1.28*(1-q)**.28)/(.22*8+.78*1.28);
}
function SpeedMarks({frame,index,velocity,release,clock}){
 const row=stripRows[index],lane=stripPolicy.lanes[index];
 const exit=p(frame,clock.release,clock.release+3)*(1-p(frame,clock.end-10,clock.end));
 const alpha=Math.max(.32*velocity,.34*exit);
 if(alpha<=0)return null;
 const dir=release>0?lane.entryDirection:-lane.entryDirection;
 const local=frame-clock.enter;
 return <svg width={W} height={row.height} style={{position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none',opacity:alpha}}>
  {Array.from({length:9},(_,i)=>{
   const x=((i*311+index*173+local*(52+i*2.8)*dir)%2500+2500)%2500-290;
   const y=i%2?row.bandTop-9-(i%3)*5:row.bandTop+lane.height+10+(i%3)*5;
   const length=55+(i*37)%150;
   return <line key={i} x1={x} y1={y} x2={x+dir*length} y2={y} stroke={i%3?'#c08352':'#efd4a5'} strokeWidth={i%3?1.2:2} opacity={.32+(i%3)*.17}/>;
  })}
 </svg>;
}
function ImpactSparks({frame,index,motion,clock}){
 const row=stripRows[index],lane=stripPolicy.lanes[index];
 const visible=p(frame,clock.enter+2,clock.enter+6)*(1-p(frame,clock.enter+17,clock.enter+23))*motion.velocity;
 if(visible<=0)return null;
 const direction=-lane.entryDirection;
 const edge=stripPolicy.left+motion.entryOffsetPx+(direction>0?stripPolicy.width:0);
 const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
 return <svg width={W} height={row.height} style={{position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none',opacity:visible,mixBlendMode:'screen'}}>
  {Array.from({length:18},(_,i)=>{
   const depth=hash(i+index*37),x=edge+direction*(4+depth*85),y=row.bandTop+lane.height*(.08+hash(i+87+index*57)*.84);
   const length=14+hash(i+71)*85,drift=(hash(i+101)-.5)*length*.18;
   return <g key={i} opacity={.35+depth*.55}>
    <line x1={x} y1={y} x2={x-direction*length} y2={y+drift} stroke={i%3?'#d88b52':'#ffe0b0'} strokeWidth={i%4?1.2:2} strokeLinecap="round"/>
    <circle cx={x} cy={y} r={i%4?1:1.7} fill="#ffe3b6"/>
   </g>;
  })}
 </svg>;
}
function CrossingBand({frame,index,assets,motion,release,clock}){
 const lane=stripPolicy.lanes[index],row=stripRows[index];
 const {panels}=openerVisibleStripPanels({trackOffsetPx:motion.trackOffsetPx,assetCycle:lane.assetCycle});
 const travel=-lane.entryDirection,enter=out(p(frame,clock.enter,clock.enter+10));
 const glint=p(frame,clock.enter+3,clock.enter+11)*(1-p(frame,clock.enter+20,clock.enter+31))*motion.velocity;
 const shine=travel>0?mix(-300,2300,motion.q):mix(2300,-300,motion.q);
 const exitSpeed=releaseVelocity(frame,clock),smear=Math.max(motion.velocity,exitSpeed*.8);
 const afterimage=.17*smear,ghostDirection=exitSpeed>0?lane.entryDirection:travel;
 const scale=1.04+.055*easeOut3(motion.q)*(1-release),hit=Math.max(motion.brakeHit,motion.lockHit*.8);
 const bandTransform=`skewX(-${stripPolicy.skewDegrees}deg) scaleX(${1-.012*hit})`;
 return <>
  <div style={{position:'absolute',left:stripPolicy.left+motion.entryOffsetPx,top:row.bandTop+10,width:stripPolicy.width,height:lane.height,transform:bandTransform,background:'linear-gradient(180deg,#2c211f,#090e16 30%,#01060b)',borderTop:'1px solid #d1a47788',boxShadow:'0 14px 26px #000b',opacity:enter}}/>
  <div style={{position:'absolute',left:stripPolicy.left+motion.entryOffsetPx,top:row.bandTop,width:stripPolicy.width,height:lane.height,boxSizing:'border-box',transform:bandTransform,overflow:'hidden',borderTop:'4px solid #a94c3a',borderBottom:'1px solid #e8c99799',boxShadow:'0 12px 26px #000a, 0 1px 0 #ebbc8366',opacity:enter,backfaceVisibility:'hidden',contain:'paint'}}>
   {panels.map(({panelIndex,assetIndex,leftPx})=><React.Fragment key={`${index}-${panelIndex}`}>
    <img src={still(assets[assetIndex])} style={{position:'absolute',top:0,left:leftPx,width:stripPolicy.panelWidth,height:'100%',objectFit:'cover',objectPosition:stripPolicy.assetObjectPositions[assetIndex],transform:`skewX(${stripPolicy.skewDegrees}deg) scale(${scale})`,filter:'url(#folded-tone)',backfaceVisibility:'hidden'}}/>
    {afterimage>0?<img src={still(assets[assetIndex])} style={{position:'absolute',top:0,left:leftPx-ghostDirection*50*smear,width:stripPolicy.panelWidth,height:'100%',objectFit:'cover',objectPosition:stripPolicy.assetObjectPositions[assetIndex],transform:`skewX(${stripPolicy.skewDegrees}deg) scale(${scale})`,filter:'url(#folded-tone)',opacity:afterimage,backfaceVisibility:'hidden'}}/>:null}
    <div style={{position:'absolute',top:0,bottom:0,left:leftPx-22,width:48,transform:`skewX(${stripPolicy.skewDegrees}deg)`,background:'linear-gradient(90deg,rgba(3,7,11,.36),transparent 31%,rgba(240,181,115,.42) 49%,rgba(255,227,183,.36) 51%,transparent 69%)',mixBlendMode:'screen',pointerEvents:'none'}}/>
   </React.Fragment>)}
   <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(2,7,12,.30),transparent 19%,transparent 75%,rgba(2,7,12,.30))',pointerEvents:'none'}}/>
   <div style={{position:'absolute',inset:0,boxShadow:'inset 0 0 45px rgba(245,176,105,.58)',opacity:hit*.33,mixBlendMode:'screen',pointerEvents:'none'}}/>
   <div style={{position:'absolute',top:0,bottom:0,left:shine,width:230,background:'linear-gradient(90deg,transparent,rgba(255,201,133,.14) 43%,rgba(255,235,194,.4) 50%,rgba(255,201,133,.12) 57%,transparent)',opacity:glint*.8,mixBlendMode:'screen',transform:'skewX(-12deg)',pointerEvents:'none'}}/>
   <div style={{position:'absolute',left:0,right:0,top:0,height:1,background:'linear-gradient(90deg,#c98154,#f1cf96 45%,#a3533f)',opacity:.88}}/>
  </div>
 </>;
}
function ImpactRow({frame,index,assets,fonts,clock}){
 const row=stripRows[index],lane=stripPolicy.lanes[index],motion=bandMotion(frame,lane,clock);
 const release=bandRelease(frame,clock),x=lane.entryDirection*stripPolicy.exitTravelPx*release;
 const plate=p(frame,clock.enter,clock.enter+20);
 const edge=release>0?(lane.entryDirection<0?'linear-gradient(to right,#000 0,#000 calc(100% - 24px),transparent 100%)':'linear-gradient(to right,transparent 0,#000 24px,#000 100%)'):undefined;
 return <div style={{position:'absolute',left:0,top:row.top,width:W,height:row.height,overflow:'hidden',transform:`translateX(${x}px)`,maskImage:edge,WebkitMaskImage:edge,contain:'paint'}}>
  <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,#091520,#050b12 55%,#09121b)',opacity:plate}}/>
  <div style={{position:'absolute',left:0,right:0,top:row.bandTop-17,height:1,background:'linear-gradient(90deg,transparent,#8c5d3e99 18%,#d9ae7966 51%,transparent)',opacity:plate*.68}}/>
  <SpeedMarks frame={frame} index={index} velocity={motion.velocity} release={release} clock={clock}/>
  <CrossingBand frame={frame} index={index} assets={assets} motion={motion} release={release} clock={clock}/>
  <ImpactSparks frame={frame} index={index} motion={motion} clock={clock}/>
  {index===0?<div style={{position:'absolute',right:106,top:25,display:'flex',alignItems:'center',gap:16,color:'#e4d7c1',fontFamily:fonts.title,fontSize:19,letterSpacing:7,opacity:plate*.86}}>
   <span>结果</span><span style={{width:216,height:2,background:'linear-gradient(90deg,#a64a3a,#d1a06c)'}}/><span>原因</span>
  </div>:null}
 </div>;
}
function PressureMontage({frame,assets,fonts,shots,cuts,clock}){
 return <Plane style={{overflow:'hidden',background:'transparent'}}>
  {frame<clock.enter+21?<div style={{position:'absolute',inset:0}}><Hero index={2} frame={clock.enter} asset={assets[2]} fonts={fonts} shot={shots[2]} cuts={cuts} stageEnd={clock.enter}/></div>:null}
  {[0,1,2].map(index=><ImpactRow key={index} frame={frame} index={index} assets={assets} fonts={fonts} clock={clock}/>)}
 </Plane>;
}
export const TemplateView = ({ segment, frame }) => {
  const visual = useVisualStyle();
  const timeline = segment.renderData?.openerTimeline;
  const expected = openerTimelineForTreatment(segment.treatment);
  if (!timeline || JSON.stringify(timeline) !== JSON.stringify(expected)) {
    throw new Error("单句钩子三画面闪回片头动态时间线与正式句级卡点不一致");
  }
  const shots = segment.treatment.flashbackShots;
  const assets = segment.assetRefs.filter(asset => asset.kind === "fullframe-image")
    .sort((a, b) => a.requestId.localeCompare(b.requestId));
  if (shots.length !== 3 || assets.length !== 3) throw new Error("片头必须具有三张闪回图及三组屏幕文字");
  const fonts = { masthead: fontFamily(visual.shared.fontFamilies.masthead),
    title: fontFamily(visual.shared.fontFamilies.title) };
  const cuts = timeline.flashbackCuts;
  const clock = openerStripChoreography(timeline);
  if (frame >= clock.end) return null;
  const index = frame < cuts[1] ? 0 : frame < cuts[2] ? 1 : 2;
  return <Plane style={{ background: "transparent", overflow: "hidden" }}>
    <Grade/>
    {frame < clock.enter ? <>
      <Hero index={index} frame={frame} asset={assets[index]} fonts={fonts} shot={shots[index]} cuts={cuts} stageEnd={clock.enter} showCopy={false}/>
      {frame >= cuts[1] && frame < cuts[1] + 28 ?
        <Shutter index={0} frame={frame} asset={assets[0]} fonts={fonts} shot={shots[0]} cuts={cuts} stageEnd={clock.enter} start={cuts[1]} dir={1}/> : null}
      {frame >= cuts[2] && frame < cuts[2] + 28 ?
        <Shutter index={1} frame={frame} asset={assets[1]} fonts={fonts} shot={shots[1]} cuts={cuts} stageEnd={clock.enter} start={cuts[2]} dir={-1}/> : null}
      {/* Short flashbacks still need their copy visible as the outgoing shutters clear. */}
      <FrontTypography index={index} frame={frame} fonts={fonts} shot={shots[index]} cuts={cuts} stageEnd={clock.enter}/>
    </> : <PressureMontage frame={frame} assets={assets} fonts={fonts} shots={shots} cuts={cuts} clock={clock}/>}
  </Plane>;
};
export const createRenderer = createViewRenderer(TemplateView);
