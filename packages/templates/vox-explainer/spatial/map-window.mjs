import * as maplibre from 'maplibre-gl';
import {mapStyle} from './map-style.mjs';
import {mapPaperMarkup, mapPaperSize, layoutMapPaper} from './map-paper.mjs';
import {SURFACE_PALETTE, VOX_TEXT_STYLES} from '../appearance.mjs';

const emptyRegions = {type: 'FeatureCollection', features: []};
const regionPaint = {fill: '#af806a', fillOpacity: .35, opacity: 1,
  stroke: '#6b6557', strokeOpacity: .8, strokeWidth: 1.5};
// Split paint from source geometry so a fade does not rebuild GeoJSON tiles.
const regionFrame = regions => {
  if (regions?.type !== 'FeatureCollection' || !Array.isArray(regions.features))
    throw new Error('地图regions需要GeoJSON FeatureCollection');
  const ids = new Set(), states = [];
  const features = regions.features.map(feature => {
    const {id, geometry} = feature;
    if (!(typeof id === 'string' && id.length || Number.isInteger(id)) || ids.has(String(id)))
      throw new Error('地图区域需要稳定且唯一的Feature.id');
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type))
      throw new Error('地图区域只接受Polygon或MultiPolygon');
    ids.add(String(id));
    const properties = feature.properties ?? {}, state = {};
    for (const [name, fallback] of Object.entries(regionPaint)) {
      state[name] = properties[name] ?? fallback;
    }
    states.push({id, state});
    // Consume only drawing inputs; GSAP attaches a circular _gsap cache to targets.
    return {type: 'Feature', id, properties: {dashed: properties.dashed === true, __voxRegionId: id},
      geometry: {type: geometry.type, coordinates: geometry.coordinates}};
  });
  const data = {type: 'FeatureCollection', features};
  return {data, states, geometryKey: JSON.stringify(data), paintKey: JSON.stringify(states)};
};

// No controls, network style, glyphs, sprites or autonomous camera animation.
// One nested shadow root also scopes SVG gradient/clip ids for multiple maps.
export function createMapWindow({element, data, camera, box, paper, workerUrl, regions = data?.regions ?? emptyRegions}) {
  if (!data?.land?.features || !camera?.center || !Number.isFinite(camera.zoom)) throw new Error('地图缺少已准备的数据或镜头');
  const initialRegions = regionFrame(regions);
  let lastGeometry = initialRegions.geometryKey, lastPaint = initialRegions.paintKey;
  maplibre.setWorkerUrl(workerUrl);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;transform-origin:center';
  if (paper) host.style.filter = 'drop-shadow(2px 7px 6px #50452e30)';
  host.style.setProperty('--vox-text-ink', SURFACE_PALETTE.ink);
  host.style.setProperty('--vox-text-paper', SURFACE_PALETTE.paper);
  element.append(host);
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    *,*::before,*::after{box-sizing:border-box}
    #paper-frame,#paper-overlay{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
    #map-aperture{position:absolute;overflow:hidden;outline:.8px solid #756e505e}
    #map,#geo-art{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}
    #map-frame{display:block;width:100%;height:100%}
    #map-render{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none}
    .maplibregl-canvas{position:absolute;left:0;top:0}
    .maplibregl-control-container{display:none}
    #geo-art{pointer-events:none}
    ${VOX_TEXT_STYLES}
  </style>${paper ? mapPaperMarkup : '<div id="map"></div><svg id="geo-art"></svg>'}`;
  let size, currentBox, lastKey, disposed = false, failure;
  const pending = new Set(), jobs = [], channel = new MessageChannel();
  channel.port1.onmessage = () => jobs.shift()?.();
  const afterData = callback => { jobs.push(callback); channel.port2.postMessage(null); };
  const overlay = root.querySelector('#geo-art');
  const frame = document.createElement('canvas');
  frame.id = 'map-frame';
  root.querySelector('#map').append(frame);
  const frameContext = frame.getContext('2d');
  const renderTarget = document.createElement('div');
  renderTarget.id = 'map-render';
  root.append(renderTarget);
  const defaultRotate = paper ? .8 : 0;
  const viewportSize = value => {
    if (![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width < 64 || value.height < 64)
      throw new Error('地图窗口需要有效位置与不小于64的尺寸；退场用opacity');
    return paper ? mapPaperSize(value.width, value.height)
      : {width: Math.round(value.width), height: Math.round(value.height), pad: 0};
  };
  const layout = (value, dimensions) => {
    size = dimensions;
    currentBox = {...value, rotate: value.rotate ?? defaultRotate};
    Object.assign(host.style, {width: value.width + 'px', height: value.height + 'px',
      opacity: String(value.opacity ?? 1), transform: `translate(${value.x}px,${value.y}px) rotate(${currentBox.rotate}deg)`});
    if (paper) layoutMapPaper(root, value.width, value.height, size);
    else overlay.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  };
  const sizeRenderTarget = ({width, height}) => {
    Object.assign(renderTarget.style, {width: width + 'px', height: height + 'px'});
  };
  layout(box, viewportSize(box));
  sizeRenderTarget(size);
  // loadJSON defers style creation to RAF in MapLibre. A local Blob uses its
  // asynchronous loader instead, so even the first frame works with RAF frozen.
  const style = mapStyle({...data, regions: initialRegions.data});
  const styleUrl = URL.createObjectURL(new Blob([JSON.stringify(style)], {type: 'application/json'}));
  const map = new maplibre.Map({container: renderTarget, style: styleUrl,
    center: camera.center, zoom: camera.zoom, bearing: camera.bearing ?? 0, pitch: 0,
    interactive: false, attributionControl: false, trackResize: false,
    renderWorldCopies: data.bounds?.[0]?.[0] < -180 || data.bounds?.[1]?.[0] > 180, fadeDuration: 0,
    canvasContextAttributes: {preserveDrawingBuffer: true, antialias: true},
    transformRequest: url => { if (url === styleUrl) return {url}; throw new Error(`地图渲染不得联网取资源：${url}`); }});
  map.on('error', event => { failure = event.error ?? new Error('地图绘制失败'); for (const reject of [...pending]) reject(failure); });
  // Resizing a WebGL canvas clears it before MapLibre has redrawn the tiles.
  // Keep the last completed pixels and paper layout visible until that work finishes.
  const present = () => {
    if (disposed || failure) throw failure ?? new Error('地图已释放');
    const source = map.getCanvas();
    if (frame.width !== source.width) frame.width = source.width;
    if (frame.height !== source.height) frame.height = source.height;
    frameContext.globalCompositeOperation = 'copy';
    frameContext.drawImage(source, 0, 0);
  };
  const rendered = action => new Promise((resolve, reject) => {
    if (disposed || failure) return reject(failure ?? new Error('地图已释放'));
    let timer, active = true, scheduled = false;
    const cleanup = () => { active = false; clearTimeout(timer); map.off('idle', done); map.off('data', schedule); pending.delete(fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = error => { cleanup(); reject(error); };
    // HyperFrames may suspend RAF while awaiting this frame. Explicit redraws
    // consume the current camera and worker results without another clock.
    const schedule = () => {
      if (!active || scheduled) return;
      scheduled = true;
      afterData(() => {
        scheduled = false;
        if (!active) return;
        try {
          map.redraw();
          // A zoom change can mark style evaluation dirty for one extra pass.
          if (active) map.redraw();
          if (active && map.loaded()) done();
        } catch (error) { fail(error); }
      });
    };
    pending.add(fail); map.on('idle', done); map.on('data', schedule);
    timer = setTimeout(() => fail(new Error('地图等待数据/绘制完成超时')), 20000);
    try { action?.(); schedule(); } catch (error) { fail(error); }
  });
  const paintRegions = states => {
    // Complete replacement, including keys omitted after a reverse seek.
    map.removeFeatureState({source: 'regions'});
    for (const {id, state} of states) map.setFeatureState({source: 'regions', id}, state);
  };
  const ready = rendered().then(() => initialRegions.states.length
    ? rendered(() => paintRegions(initialRegions.states)) : undefined).then(present);
  // Observe eagerly so a cancelled scene cannot leave an unhandled rejection.
  ready.catch(() => {});
  const project = coordinate => { const p = map.project(coordinate); return [p.x, p.y]; };
  return {
    ready, overlay, host,
    get size() { return {...size}; },
    project,
    // Coordinates in the parent scene, including map placement and rotation.
    screenPoint(coordinate) {
      const p = project(coordinate), b = currentBox, a = b.rotate * Math.PI / 180;
      const x = p[0] + size.pad - b.width / 2, y = p[1] + size.pad - b.height / 2;
      return [b.x + b.width / 2 + x * Math.cos(a) - y * Math.sin(a), b.y + b.height / 2 + x * Math.sin(a) + y * Math.cos(a)];
    },
    path(coordinates) { return coordinates.map((point, i) => `${i ? 'L' : 'M'}${project(point).join(' ')}`).join(' '); },
    async seek({box: nextBox = box, camera: nextCamera = camera, regions: nextRegions = regions}) {
      await ready;
      if (disposed || failure) throw failure ?? new Error('地图已释放');
      // Animation libraries attach bookkeeping (including circular references)
      // to their targets. Only the values consumed by this view identify a frame.
      const regional = regionFrame(nextRegions);
      const key = JSON.stringify([nextBox.x, nextBox.y, nextBox.width, nextBox.height,
        nextBox.opacity ?? 1, nextBox.rotate ?? defaultRotate, nextCamera.center[0], nextCamera.center[1],
        nextCamera.zoom, nextCamera.bearing ?? 0, regional.geometryKey, regional.paintKey]);
      if (key === lastKey) return;
      const nextSize = viewportSize(nextBox);
      await rendered(() => {
        if (regional.geometryKey !== lastGeometry) map.getSource('regions').setData(regional.data);
        if (regional.geometryKey !== lastGeometry || regional.paintKey !== lastPaint) paintRegions(regional.states);
        if (size.width !== nextSize.width || size.height !== nextSize.height) {
          sizeRenderTarget(nextSize);
          map.resize();
        }
        map.jumpTo({center: nextCamera.center, zoom: nextCamera.zoom, bearing: nextCamera.bearing ?? 0, pitch: 0});
      });
      present();
      layout(nextBox, nextSize);
      lastGeometry = regional.geometryKey; lastPaint = regional.paintKey;
      lastKey = key;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const reject of [...pending]) reject(new Error('地图已释放'));
      channel.port1.close(); channel.port2.close(); jobs.length = 0;
      frame.width = 0;
      frame.remove();
      map.remove(); URL.revokeObjectURL(styleUrl); host.remove();
    }
  };
}
