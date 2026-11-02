import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { loadSceneFonts, mediaUrl, fontFamily } from "../../../modules/render-video/runtime/scene-view.jsx";
import { OPPOSED_POLICY } from "../render-policy.mjs";

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a,b,p) => a+(b-a)*p;
const out = p => 1-(1-clamp(p))**4;
const backOut = p => { const q=clamp(p)-1; return 1+2.4*q*q*q+1.4*q*q; };
const div = (parent, style) => {
  const element = document.createElement("div");
  Object.assign(element.style, style);
  parent.append(element);
  return element;
};

const makeTitle = (parent, shot, family, palette, size) => {
  const headline = div(parent, {position:"absolute", top:"405px", left:"130px", right:"90px",
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
    ...treatment.flashbackShots.map(async (_,i) => {
      const id = `AR${String(i+1).padStart(3,"0")}`;
      const asset = assetRefs.find(ref => ref.requestId === id);
      if (!asset) throw new Error(`逐段片头缺少图片 ${id}`);
      const image = new Image();
      image.src = mediaUrl(asset.file);
      await image.decode();
      return image.src;
    })
  ]).then(([, ...sources]) => {
    if (disposed) return;
    pairs = treatment.flashbackShots.map((shot,i) => {
      const down = i%2 === 0;
      const pair = div(host, {position:"absolute", inset:"0", overflow:"hidden", zIndex:String(i+1)});
      const size = titleSize(shot,family);
      const halves = ["top","bottom"].map(which => {
        const isTop = which === "top";
        const clipPath = down
          ? (isTop ? "polygon(0 0,100% 0,100% 64%,0 58%)" : "polygon(0 58%,100% 64%,100% 100%,0 100%)")
          : (isTop ? "polygon(0 0,100% 0,100% 58%,0 64%)" : "polygon(0 64%,100% 58%,100% 100%,0 100%)");
        const half = div(pair, {position:"absolute", inset:"0", overflow:"hidden", clipPath});
        const plane = div(half, {position:"absolute", inset:"0", overflow:"hidden"});
        const image = document.createElement("img");
        image.src = sources[i];
        Object.assign(image.style, {position:"absolute", left:"0", top:"0", width:"1920px", height:"1080px",
          objectFit:"cover", backfaceVisibility:"hidden", transformOrigin:"50% 50%"});
        plane.append(image);
        div(plane, {position:"absolute", inset:"0",
          background:"linear-gradient(90deg,rgba(4,10,16,.73),rgba(4,10,16,.45) 51%,rgba(4,10,16,.10) 90%)"});
        div(plane, {position:"absolute", left:"-35px", top:"651px", width:"1990px", height:"16px",
          background:"linear-gradient(to bottom,rgba(235,197,156,.78) 0%,rgba(26,30,33,.90) 22%,rgba(5,10,15,.83) 76%,rgba(5,10,15,.25) 100%)",
          boxShadow:"0 10px 24px rgba(0,0,0,.72)", transform:`rotate(${down?1.932:-1.932}deg)`});
        const title = makeTitle(plane,shot,family,palette,size);
        return {plane,image,title};
      });
      const stableTitle = makeTitle(pair,shot,family,palette,size);
      return {pair,halves,stableTitle};
    });
  });

  return {
    async seek(frame) {
      await ready;
      if (disposed) throw new Error("逐段片头已释放");
      for (let i=0;i<pairs.length;i++) {
        const {pair,halves,stableTitle} = pairs[i];
        const start = cuts[i], end = i+1<cuts.length ? cuts[i+1]+OPPOSED_POLICY.arrivalFrames : durationFrames;
        const visible = frame>=start && frame<end;
        pair.style.display = visible ? "block" : "none";
        if (!visible) continue;
        const local = frame-start, direction = i%2 ? 1 : -1;
        const travel = i ? 1920 : 1500;
        let x = local < 11 ? mix(direction*travel,-direction*18,out(local/11))
          : mix(-direction*18,0,backOut((local-11)/5));
        const final = i===pairs.length-1;
        if (final && frame>=releaseFrame-OPPOSED_POLICY.preloadFrames && frame<releaseFrame)
          x = mix(0,-direction*72,clamp((frame-(releaseFrame-OPPOSED_POLICY.preloadFrames))/OPPOSED_POLICY.preloadFrames)**2);
        if (final && frame>=releaseFrame)
          x = mix(-direction*72,direction*2100,out((frame-releaseFrame)/OPPOSED_POLICY.exitFrames));
        const inflateStart = Math.max(start+OPPOSED_POLICY.arrivalFrames,Math.min(releaseFrame-1,finalVoiceEndFrame));
        const charge = clamp((frame-inflateStart)/Math.max(1,releaseFrame-inflateStart));
        const inflate = final ? charge**1.6*.075 : 0;
        pair.style.transform = `scale(${1+inflate})`;
        const settled = local>=OPPOSED_POLICY.arrivalFrames && (!final || frame<releaseFrame);
        stableTitle.style.opacity = settled ? "1" : "0";
        stableTitle.style.transform = final && frame>=releaseFrame-OPPOSED_POLICY.preloadFrames && frame<releaseFrame
          ? `translateX(${x}px)` : "";
        const progress = clamp(local/Math.max(1,end-start));
        halves.forEach(({plane,image,title},side) => {
          const sign = side===0 ? 1 : -1;
          plane.style.transform = `translateX(${x*sign}px)`;
          const cameraX = direction*sign*mix(84,side===0?50:52,progress);
          const cameraY = sign*mix(-30,-16,progress);
          const scale = side===0 ? mix(1.18,1.215,progress) : mix(1.20,1.17,progress);
          const angle = direction*sign*mix(3,1.5,progress);
          image.style.transform = `perspective(2400px) translate3d(${cameraX}px,${cameraY}px,0) rotateY(${angle}deg) scale(${scale})`;
          title.style.opacity = settled ? "0" : "1";
        });
      }
    },
    dispose() { disposed=true; host.remove(); }
  };
};
