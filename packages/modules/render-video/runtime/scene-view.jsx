import React, { createContext, useContext, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { visualFontEntries } from "../../../visual-fonts.mjs";

const SceneContext = createContext(null);
const fontLoads = new Map();
export const mediaUrl = file => window.__hyperframes.assetUrl(file.split("/").map(encodeURIComponent).join("/"));
export const fontFamily = value => Array.isArray(value) ? value.join(", ") : value;

export const loadSceneFonts = (visualStyle, scopes = null) => {
  const fonts = visualFontEntries(visualStyle, scopes).map(([, font]) => font);
  const subtitle = visualStyle.p4.subtitle ?? {};
  if (subtitle.fontPublicPath) fonts.push({ family: subtitle.fontName, publicPath: subtitle.fontPublicPath,
    format: subtitle.fontFormat, weight: subtitle.fontWeight, style: subtitle.fontStyle });
  return Promise.all(fonts.map(font => {
  const key = JSON.stringify([font.family, font.publicPath, font.format, font.weight, font.style]);
  if (!fontLoads.has(key)) {
    const face = new FontFace(font.family, `url("${mediaUrl(font.publicPath)}") format("${font.format}")`,
      { weight: String(font.weight), style: font.style });
    fontLoads.set(key, face.load().then(loaded => { document.fonts.add(loaded); }));
  }
  return fontLoads.get(key);
  }));
};

export const useScene = () => {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("画面缺少当前场景上下文");
  return scene;
};
export const useVisualStyle = () => useScene().segment.visualStyle;
export const Plane = ({ style, children, ...props }) => <div {...props} style={{
  position: "absolute", inset: 0, display: "flex", flexDirection: "column", ...style
}}>{children}</div>;

export const canvasStyle = (visualStyle, surfaceName = "canvas") => {
  const surface = visualStyle.p4.surfaces[surfaceName] ?? visualStyle.p4.surfaces.canvas;
  return { background: surface.background ?? visualStyle.p4.surfaces.canvas.background,
    color: visualStyle.shared.palette.textPrimary, fontFamily: fontFamily(visualStyle.shared.fontFamilies.sans) };
};

export const AssetMedia = ({ asset, frame = 0, fit = "cover", style = {} }) => {
  const scene = useScene();
  const host = useRef(null);
  const playback = asset?.playback;
  const moving = asset?.mediaType === "video" && frame >= playback?.startFrame && frame <= playback?.endFrame;
  useLayoutEffect(() => {
    if (!moving) return;
    const media = scene.media.get(playback.id);
    if (!media) throw new Error(`当前视频缺少HyperFrames媒体节点: ${playback.id}`);
    Object.assign(media.style, { width: "100%", height: "100%", objectFit: fit, ...style });
    const source = media.closest("[data-media-source]") ?? media;
    source.style.objectFit = fit;
    host.current.append(source);
    return () => scene.mediaParking.append(source);
  }, [moving, playback?.id, fit, scene]);
  if (!asset) throw new Error("画面缺少已交付素材");
  if (asset.mediaType !== "video" || asset.frozenStill) return <img src={mediaUrl(asset.frozenStill ?? asset.file)}
    style={{ width: "100%", height: "100%", backfaceVisibility: "hidden", objectFit: fit, ...style }}/>;
  if (!playback) throw new Error(`视频缺少已编译播放窗口: ${asset.requestId}`);
  if (moving) return <div ref={host} style={{ width: "100%", height: "100%", ...style }}/>;
  return <img src={mediaUrl(frame < playback.startFrame ? playback.firstStill : playback.lastStill)}
    style={{ width: "100%", height: "100%", objectFit: fit, ...style }}/>;
};

// Views receive the requested frame explicitly. HyperFrames alone advances time.
export const createViewRenderer = View => ({ element, segment, media, mediaParking, signal }) => {
  const pending = new Set();
  const commits = [];
  let failure, disposed = false;
  let rejectFailure;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  failed.catch(() => {});
  const fail = error => { failure ??= error; rejectFailure(failure); };
  const scene = { segment, media, mediaParking, ...VIDEO_SPEC,
    fail,
    commit: update => commits.push(update),
    wait: operation => {
      const promise = Promise.race([Promise.resolve(operation), failed]).catch(fail)
        .finally(() => pending.delete(promise));
      pending.add(promise);
      return promise;
    }
  };
  const root = createRoot(element, { onUncaughtError: scene.fail, onCaughtError: scene.fail });
  const ready = loadSceneFonts(segment.visualStyle);
  return {
    async seek(frame) {
      await ready;
      if (disposed || signal?.aborted) throw new Error("场景已取消");
      if (failure) throw failure;
      flushSync(() => root.render(<SceneContext.Provider value={scene}><View segment={segment} frame={frame}/></SceneContext.Provider>));
      while (pending.size || commits.length) {
        await Promise.all([...pending]);
        flushSync(() => { for (const commit of commits.splice(0)) commit(); });
      }
      if (failure) throw failure;
      // HyperFrames prepares its native video frame after scene projection.
      // Waiting for that injected image here would precede its media seek.
      await Promise.all([...element.querySelectorAll("img")].filter(image=>!image.closest('[data-media-source]'))
        .map(image=>image.decode().catch(cause=>{throw new Error(`图片无法解码: ${image.currentSrc||image.src}`,{cause});})));
    },
    dispose() { if (!disposed) { disposed = true; flushSync(() => root.unmount()); } }
  };
};
