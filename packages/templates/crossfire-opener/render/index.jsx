import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { loadSceneFonts, mediaUrl, fontFamily } from "../../../modules/render-video/runtime/scene-view.jsx";
import { createImpactRenderer } from "./draw.mjs";
import { CROSS_FIRE, phase } from "../render-policy.mjs";

const out = (t, a, b) => 1 - (1 - phase(t, a, b)) ** 4;
export const createRenderer = ({ element, segment }) => {
  const { width, height, fps } = VIDEO_SPEC, { treatment, visualStyle } = segment;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  element.append(canvas);
  const family = fontFamily(visualStyle.shared.fontFamilies.bookend);
  const words = treatment.flashbackShots.map((shot, i) => {
    const word = document.createElement("div");
    const text = shot.screenLines[0], size = Math.min([202,144,148][i], 1400 / Math.max(1, Array.from(text).length));
    Object.assign(word.style, { position: "absolute", [i === 1 ? "right" : "left"]: "128px", top: [572,616,598][i] + "px",
      fontFamily: family, fontSize: size + "px", letterSpacing: "5px", lineHeight: "1.1", whiteSpace: "nowrap",
      textAlign: i === 1 ? "right" : "left", color: "#fff0d6", textShadow: "0 5px 24px #01060bd9" });
    const letters = Array.from(text).map((letter, j) => {
      const span = document.createElement("span"); span.textContent = letter;
      Object.assign(span.style, { display: "inline-block", transformOrigin: "left bottom", color: j === Array.from(text).length - 1 ? "#eaa557" : "inherit" });
      word.append(span); return span;
    });
    const rule = document.createElement("div");
    Object.assign(rule.style, { height: "5px", width: "140px", marginTop: "24px", background: "#c25332",
      marginLeft: i === 1 ? "auto" : "0", transformOrigin: i === 1 ? "right" : "left" });
    word.append(rule); element.append(word); return { word, letters, rule };
  });
  const header = document.createElement("div");
  Object.assign(header.style, { position: "absolute", left: "88px", right: "88px", top: "80px", display: "flex",
    justifyContent: "space-between", fontFamily: family, fontSize: "24px", letterSpacing: "5px", color: "#ecc797" });
  const title = document.createElement("span"); title.textContent = [segment.seriesTitle, treatment.episodeTitle].filter(Boolean).join("　/　");
  const stamp = document.createElement("span"); stamp.textContent = treatment.stamp ?? "";
  header.append(title, stamp); element.append(header);
  const ready = Promise.all([loadSceneFonts(visualStyle), ...segment.assetRefs.map(async asset => {
    const image = new Image(); image.src = mediaUrl(asset.file); await image.decode(); return [asset.requestId, image];
  })]).then(([, ...assets]) => {
    const loaded = Object.fromEntries(assets), images = Object.fromEntries(["O01","O02","O03"].map((id,i) => {
      const image = loaded[`AR00${i+1}`]; if (!image) throw new Error(`${id}缺少实图`); return [id,image];
    }));
    if (loaded.AR004) images.foreground = loaded.AR004;
    return createImpactRenderer(canvas, images, { introSeconds: 8, body: { reveal: 6.78 }, motion: { intensity: 1.18 },
      beats: CROSS_FIRE.cuts.map((start, i) => ({ start, image: `O0${i+1}`, ...(i === 1 && loaded.AR004 ? { foreground: "foreground" } : {}) })),
      colors: { ink: "#06101a", ember: "#ffb24d" } });
  });
  let disposed = false;
  return { async seek(frame) {
    const draw = await ready; if (disposed) throw new Error("片头已释放");
    const t = frame / fps; draw(t);
    words.forEach(({ word, letters, rule }, i) => {
      const start = CROSS_FIRE.cuts[i], next = CROSS_FIRE.cuts[i+1] ?? 5.48, local = t - start;
      word.style.display = t >= start && t < next ? "block" : "none";
      word.style.opacity = String(1 - phase(t, next - .14, next + .02));
      word.style.transform = i === 2 ? `translate(${-28 * phase(t, 5.30, 5.48)}px,0)` : "none";
      letters.forEach((letter, j) => {
        const p = out(local, .20 + j*.025, .43 + j*.025), kick = Math.sin(phase(local, .20+j*.025, .52+j*.025)*Math.PI)*.07;
        letter.style.opacity = String(phase(local, .20+j*.025, .245+j*.025));
        letter.style.transform = `translate(${15*(1-p)}px,${36*(1-p)}px) scale(${1+.65*(1-p)+kick})`;
        letter.style.filter = `blur(${3*(1-p)}px)`;
      });
      rule.style.transform = `scaleX(${phase(local,.4,.58)})`;
    });
    header.style.opacity = String(.8 * (1 - phase(t, 5.32, 5.55)));
  }, dispose() { disposed = true; element.replaceChildren(); } };
};
