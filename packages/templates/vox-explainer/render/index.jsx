import {gsap} from 'gsap';
import * as THREE from 'three';
import {mediaUrl} from '../../../modules/render-video/runtime/scene-view.jsx';
import {markupAssetIds, resolveMarkupAssets, runAnimation} from '../scene.mjs';
import * as spatialTools from '../spatial/scene.mjs';
import {createMapWindow} from '../spatial/map-window.mjs';
import {MAP_WORKER_FILES} from '../spatial/map-style.mjs';
import {stageBackground, SURFACE_PALETTE} from '../appearance.mjs';

const fontLoads = new Map();
const loadFont = font => {
  const key = JSON.stringify(font);
  if (!fontLoads.has(key)) {
    const face = new FontFace(font.family, `url("${mediaUrl(font.publicPath)}") format("${font.format}")`,
      {weight: String(font.weight), style: font.style});
    fontLoads.set(key, face.load().then(loaded => document.fonts.add(loaded)));
  }
  return fontLoads.get(key);
};

export const createRenderer = ({element, segment, signal}) => {
  const data = segment.renderData.voxExplainer;
  const {width, height, fps} = data.policy;
  const host = document.createElement('div');
  Object.assign(host.style, {position: 'absolute', inset: '0', overflow: 'hidden',
    background: SURFACE_PALETTE.background, backgroundImage: stageBackground()});
  for (const [name, value] of Object.entries({...data.appearance.palette, ...SURFACE_PALETTE})) host.style.setProperty(`--${name}`, value);
  for (const [role, font] of Object.entries(data.appearance.fonts)) {
    host.style.setProperty(`--font-${role}`, font.family);
    host.style.setProperty(`--font-${role}-weight`, font.weight);
  }
  element.append(host);
  const root = host.attachShadow({mode: 'open'});
  const assets = new Map(segment.assetRefs.map(asset => [asset.requestId, asset]));
  root.innerHTML = `<style>:host{display:block;font-family:var(--font-body);font-weight:var(--font-body-weight);color:var(--ink);font-variant-numeric:tabular-nums}*,*::before,*::after{box-sizing:border-box}</style>`
    + resolveMarkupAssets(data.scene.markup, assets, asset => mediaUrl(asset.file));
  const updates = [], cleanups = [], maps = [];
  // getAnimations does not cross the map's shadow boundary.
  const animations = () => [...root.getAnimations(),
    ...maps.flatMap(map => map.host.shadowRoot.getAnimations())];
  const seekAnimations = time => {
    for (const animation of animations()) { animation.pause(); animation.currentTime = time * 1000; }
  };
  const spatial = {...spatialTools, createMapWindow(options) {
    const map = createMapWindow({...options, workerUrl: mediaUrl(MAP_WORKER_FILES[0])});
    maps.push(map); cleanups.push(() => map.dispose()); return map;
  }};
  const timeline = gsap.timeline({paused: true});
  const anchors = new Map(data.actionTimings.map(item => [item.target, item.frame / fps]));
  const select = selector => {
    const nodes = [...root.querySelectorAll(selector)];
    if (!nodes.length) throw new Error(`Vox动画找不到对象: ${selector}`);
    return nodes.length === 1 ? nodes[0] : nodes;
  };
  const cue = id => {
    if (!anchors.has(id)) throw new Error(`Vox动画没有真实Cue绑定: ${id}`);
    return anchors.get(id);
  };
  const pictureEvents = new Map((segment.renderData.eventTimings ?? []).map(event => [event.id, event.frame / fps]));
  const eventTime = id => {
    if (!pictureEvents.has(id)) throw new Error(`Vox动画没有动作事件: ${id}`);
    return pictureEvents.get(id);
  };
  let disposed = false;
  const imageUrls = new Set(markupAssetIds(data.scene.markup).map(id => mediaUrl(assets.get(id).file)));
  const ready = Promise.all([
    ...Object.values(data.appearance.fonts).map(loadFont),
    ...[...imageUrls].map(src => {
      const image = new Image();
      image.src = src;
      return image.decode();
    })
  ]).then(async () => {
    if (disposed || signal?.aborted) throw new Error('Vox场景已取消');
    runAnimation(data.scene.animation, {root, select, gsap, timeline, cue, eventTime, assets, spatial, THREE,
      onFrame: callback => updates.push(callback), onCleanup: callback => cleanups.push(callback),
      width, height, fps, duration: data.durationInFrames / fps});
    for (const animation of animations()) animation.pause();
    await Promise.all(maps.map(map => map.ready));
  });
  return {
    async seek(frame) {
      await ready;
      if (disposed || signal?.aborted) throw new Error('Vox场景已取消');
      const semanticFrame = frame + (segment.runtimeTiming?.semanticFrameOffset ?? 0);
      const current = Math.max(0, Math.min(data.durationInFrames - 1, semanticFrame));
      const time = current / fps;
      timeline.totalTime(time, false);
      seekAnimations(time);
      for (const update of updates) await update({frame: current, time, fps});
      // An update may have created a new annotation with a CSS/WAAPI animation.
      seekAnimations(time);
      await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timeline.kill();
      for (const animation of animations()) animation.cancel();
      for (const cleanup of cleanups) cleanup();
      host.remove();
    }
  };
};
export default createRenderer;
