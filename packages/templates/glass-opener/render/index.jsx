import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { loadSceneFonts, mediaUrl, fontFamily } from "../../../modules/render-video/runtime/scene-view.jsx";
import { OPPOSED_POLICY } from "../../opposed-opener/render-policy.mjs";
import { createGlassWorld } from "./three-glass.mjs";

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a,b,p) => a+(b-a)*p;
const out = p => 1-(1-clamp(p))**4;
const div = (parent, style) => {
  const element = document.createElement("div");
  Object.assign(element.style, style);
  parent.append(element);
  return element;
};

const makeTitle = (parent, shot, family, palette, size) => {
  // Leave the fracture visible below the lettering.
  const headline = div(parent, {position:"absolute", top:"345px", left:"130px", right:"90px",
    height:"270px", display:"flex", alignItems:"center", paddingLeft:"48px", pointerEvents:"none"});
  div(headline, {position:"absolute", left:"0", top:"28px", bottom:"28px", width:"7px",
    background:palette.cinnabar});
  const text = div(headline, {position:"relative", color:palette.textPrimary, fontFamily:family,
    fontWeight:"900", fontSize:`${size}px`, lineHeight:"1.2", letterSpacing:"5px",
    whiteSpace:"nowrap", textShadow:"0 4px 10px rgba(0,0,0,.95)"});
  let highlighted = false;
  for (const line of shot.screenLines) {
    const row = div(text, {display:"block"});
    const index = !highlighted && shot.highlight ? line.indexOf(shot.highlight) : -1;
    if (index < 0) { row.textContent = line; continue; }
    row.append(document.createTextNode(line.slice(0,index)));
    const accent = document.createElement("span");
    accent.textContent = shot.highlight;
    Object.assign(accent.style, {color:palette.textPrimary, background:`color-mix(in srgb, ${palette.cinnabar} 72%, ${palette.ink})`,
      padding:"0 .08em", marginLeft:".03em"});
    row.append(accent, document.createTextNode(line.slice(index+shot.highlight.length)));
    highlighted = true;
  }
  return headline;
};

const titleSize = (shot, family) => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `900 130px ${family}`;
  const width = Math.max(1, ...shot.screenLines.map(line =>
    context.measureText(line).width + Math.max(0,Array.from(line).length-1)*5));
  return Math.min(130, 130*1530/width, 270/(shot.screenLines.length*1.2));
};

export const createRenderer = ({element, segment}) => {
  const { treatment, visualStyle, renderData, assetRefs } = segment;
  const { cuts, releaseFrame, durationFrames } = renderData.openerTimeline;
  const finalVoiceEndFrame = Math.round(treatment.narration.sentenceCues.at(-1).endMs / 1000 * VIDEO_SPEC.fps);
  const family = fontFamily(visualStyle.shared.fontFamilies.bookend);
  const palette = visualStyle.shared.palette;
  const host = div(element, {position:"absolute", inset:"0", overflow:"hidden"});
  let disposed = false;
  let pairs = [];

  const ready = Promise.all([
    loadSceneFonts(visualStyle),
    (async()=>{const image=new Image(); image.src=mediaUrl("packages/templates/glass-opener/assets/window-glass-normal.png"); await image.decode(); return image;})(),
    (async()=>{const image=new Image(); image.src=mediaUrl("packages/templates/glass-opener/assets/window-glass-pbr.jpg"); await image.decode(); return image;})(),
    (async()=>{const image=new Image(); image.src=mediaUrl("packages/templates/glass-opener/assets/glass-cracks.png"); await image.decode(); return image;})(),
    (async()=>{const image=new Image(); image.src=mediaUrl("packages/templates/glass-opener/assets/glass-edge.png"); await image.decode(); return image;})(),
    ...treatment.flashbackShots.map(async (_,i) => {
      const id = `AR${String(i+1).padStart(3,"0")}`;
      const asset = assetRefs.find(ref => ref.requestId === id);
      if (!asset) throw new Error(`逐段片头缺少图片 ${id}`);
      const image = new Image();
      image.src = mediaUrl(asset.file);
      await image.decode();
      return image;
    })
  ]).then(([, normalImage, pbrImage, fractureImage, edgeImage, ...sources]) => {
    if (disposed) return;
    pairs = treatment.flashbackShots.map((shot,i) => {
      const down = i%2 === 0;
      const pair = div(host, {position:"absolute", inset:"0", overflow:"hidden", zIndex:String(i+1)});
      const size = titleSize(shot,family);
      const world=createGlassWorld(pair,sources[i],!down,normalImage,pbrImage,fractureImage,edgeImage);
      const movingTitle=makeTitle(pair,shot,family,palette,size);
      movingTitle.style.zIndex="4";
      const stableTitle = makeTitle(pair,shot,family,palette,size);
      stableTitle.style.zIndex = "4";
      return {pair,world,movingTitle,stableTitle};
    });
  });

  return {
    async seek(frame) {
      await ready;
      if (disposed) throw new Error("逐段片头已释放");
      for (let i=0;i<pairs.length;i++) {
        const {pair,world,movingTitle,stableTitle} = pairs[i];
        const start = cuts[i], end = i+1<cuts.length ? cuts[i+1]+OPPOSED_POLICY.arrivalFrames : durationFrames;
        const visible = frame>=start && frame<end;
        pair.style.display = visible ? "block" : "none";
        if (!visible) continue;
        const local = frame-start, direction = i%2 ? 1 : -1;
        const travel = i ? 1920 : 1500;
        // Cross in opposite directions from the first visible frame. Both
        // halves already overlap vertically; there is no opening/closing jaw.
        const slide = 1-(1-clamp(local/11))**2.1;
        const oldDrift = clamp((local-11)/Math.max(1,end-start-11));
        const arrivalDrift = clamp((OPPOSED_POLICY.arrivalFrames-11)/Math.max(1,end-start-11));
        const calmDrift = local <= OPPOSED_POLICY.arrivalFrames ? 28*oldDrift
          : 28*arrivalDrift+4*clamp((local-OPPOSED_POLICY.arrivalFrames)/
            Math.max(1,end-start-OPPOSED_POLICY.arrivalFrames));
        let x = local < 11 ? mix(direction*travel,0,slide)
          : -direction*calmDrift;
        const final = i===pairs.length-1;
        const preloadDistance=72;
        if (final && frame>=releaseFrame-OPPOSED_POLICY.preloadFrames && frame<releaseFrame)
          x = mix(x,-direction*preloadDistance,clamp((frame-(releaseFrame-OPPOSED_POLICY.preloadFrames))/OPPOSED_POLICY.preloadFrames)**2);
        if (final && frame>=releaseFrame)
          x = mix(-direction*preloadDistance,direction*2100,out((frame-releaseFrame)/OPPOSED_POLICY.exitFrames));
        const inflateStart = Math.max(start+OPPOSED_POLICY.arrivalFrames,Math.min(releaseFrame-1,finalVoiceEndFrame));
        const charge = clamp((frame-inflateStart)/Math.max(1,releaseFrame-inflateStart));
        const inflate = final ? charge**1.6*.075 : 0;
        pair.style.transform = `scale(${1+inflate})`;
        const settled = local>=OPPOSED_POLICY.arrivalFrames && (!final || frame<releaseFrame);
        stableTitle.style.opacity = settled ? "1" : "0";
        stableTitle.style.transform = final && frame>=releaseFrame-OPPOSED_POLICY.preloadFrames && frame<releaseFrame
          ? `translateX(${x}px)` : "";
        const progress = clamp(local/Math.max(1,end-start));
        const motionEnd=final ? releaseFrame : cuts[i+1];
        const motionProgress=clamp((local-OPPOSED_POLICY.arrivalFrames) /
          Math.max(1,motionEnd-start-OPPOSED_POLICY.arrivalFrames));
        world.draw({x,direction,local,motionProgress});
        movingTitle.style.opacity = settled ? "0" : "1";
        movingTitle.style.transform = `translateX(${x+direction*mix(50,24,progress)}px)`;
      }
    },
    dispose() { disposed=true; pairs.forEach(pair=>pair.world.dispose()); host.remove(); }
  };
};
