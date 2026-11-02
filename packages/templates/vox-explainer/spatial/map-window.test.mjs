import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {build, stop} from 'esbuild';
import {withBrowserSession} from '../../../modules/render-video/runtime/browser-session.mjs';
import {MAP_WORKER_FILES} from './map-style.mjs';
import {prepareMapData} from './prepare-map.mjs';

test('数据地图经正式Renderer离线及冻结RAF绘制、双图隔离、逆序定位及释放', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    if (req.url === '/') { res.end('<div id="root"></div>'); return; }
    if (!MAP_WORKER_FILES.includes(req.url.slice(1))) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(req.url.slice(1)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const bundle = await build({entryPoints: ['packages/templates/vox-explainer/render/index.jsx'],
    bundle: true, write: false, format: 'iife', globalName: 'VoxRenderer', platform: 'browser',
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'silent'});
  await stop();
  const data = await prepareMapData({bounds: [[130, 31], [134, 35]], relief: false});
  assert.ok(data.land.features.length > 0);
  const crossingData = await prepareMapData({bounds: [[170, -22], [190, -12]], relief: false});
  await withBrowserSession(async session => {
    const page = await (await session.browser()).newPage();
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.addScriptTag({content: bundle.outputFiles[0].text});
      const result = await page.evaluate(async ({data, crossingData}) => {
        window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};
        window.__hyperframes = {assetUrl: file => new URL(file, location.href).href};
        const element = document.querySelector('#root');
        const animation = `
          const data = ${JSON.stringify(data)};
          const camera = {center: [132, 33.3], zoom: 6.5};
          const box = {x: 20, y: 30, width: 640, height: 400};
          const map = spatial.createMapWindow({element: select('#map'), data, camera, box});
          const second = spatial.createMapWindow({element: select('#map'), data, camera,
            box: {...box, x: 900, width: 350, height: 250}});
          const crossing = spatial.createMapWindow({element: select('#map'), data: ${JSON.stringify(crossingData)},
            camera: {center: [181, -17], zoom: 5}, box: {x: 0, y: 600, width: 300, height: 200},
            regions: {type: 'FeatureCollection', features: [{type: 'Feature', id: 0,
              properties: {fill: '#4477cc', fillOpacity: 1, strokeWidth: 0},
              geometry: {type: 'Polygon', coordinates: [[[180.6,-17.5],[181.5,-17.5],
                [181.5,-16.5],[180.6,-16.5],[180.6,-17.5]]]}}]}});
          window.maps = [map, second, crossing];
          map.overlay.innerHTML = '<circle r="8" fill="red"/><text y="-15">锚点</text>';
          const view = {...box};
          timeline.to(view, {x: 140, width: 520, duration: 1, ease: 'none'}, cue('M001'));
          const state = {progress: 0};
          window.zonePaint = {opacity: 0};
          timeline.to(window.zonePaint, {opacity: 1, duration: 1}, cue('M001'));
          timeline.to(state, {progress: 1, duration: 1, ease: 'none'}, cue('M001'));
          onFrame(async () => {
            const u = state.progress;
            await map.seek({box: view,
              camera: {center: [132 + .4*u, 33.3], zoom: 6.5 + u}});
            if (!window.annotationAnimation) window.annotationAnimation = map.overlay.querySelector('circle')
              .animate([{opacity: 0}, {opacity: 1}], {duration: 2000, fill: 'both'});
            const p = map.project([132, 33.3]);
            map.overlay.querySelector('circle').setAttribute('cx', p[0]);
            map.overlay.querySelector('circle').setAttribute('cy', p[1]);
            window.anchor = map.screenPoint([132, 33.3]);
          });`;
        const segment = {assetRefs: [], renderData: {voxExplainer: {policy: {width: 1920, height: 1080, fps: 60},
          appearance: {palette: {}, fonts: {}}, actionTimings: [{target: 'M001', frame: 0}], durationInFrames: 120,
          scene: {markup: '<div id="map"></div>', animation}}}};
        const read = () => {
          const map = window.maps[0], circle = map.overlay.querySelector('circle');
          const rect = circle.getBoundingClientRect();
          return {image: map.host.shadowRoot.querySelector('canvas').toDataURL(),
            anchor: window.anchor, centre: [rect.x + rect.width/2, rect.y + rect.height/2],
            svg: map.overlay.outerHTML, animationTime: window.annotationAnimation.currentTime,
            animationState: window.annotationAnimation.playState,
            crossing: window.maps[2].project([181,-17])[0] - window.maps[2].size.width/2, second: window.maps[1].host.shadowRoot.querySelector('canvas').toDataURL()};
        };
        let renderer = VoxRenderer.createRenderer({element, segment});
        await renderer.seek(0).catch(error => { throw new Error(error.stack ?? String(error)); }); const first = read();
        await renderer.seek(60); const later = read();
        await renderer.seek(0); const reverse = read();
        const map = window.maps[0], empty = {type: 'FeatureCollection', features: []};
        const ring = [[131.5,32.8],[132.7,32.8],[132.7,33.9],[131.5,33.9],[131.5,32.8]];
        const hole = [[131.9,33.2],[132.1,33.2],[132.1,33.4],[131.9,33.4],[131.9,33.2]];
        const square = y => [[132.9,y],[133.2,y],[133.2,y+.2],[132.9,y+.2],[132.9,y]];
        const regions = {type: 'FeatureCollection', features: [
          {type: 'Feature', id: 'enclosing', properties: {fill: '#b90000', fillOpacity: 1, strokeWidth: 0},
            geometry: {type: 'Polygon', coordinates: [ring, hole]}},
          {type: 'Feature', id: 'islands', properties: {fill: '#0044bb', fillOpacity: 1, dashed: true},
            geometry: {type: 'MultiPolygon', coordinates: [[square(33.1)], [square(33.6)]]}}
        ]};
        const pixels = () => {
          const source = map.host.shadowRoot.querySelector('canvas');
          const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
          const context = copy.getContext('2d'); context.drawImage(source, 0, 0);
          return [[132,33.3],[132.35,33.5],[133.05,33.2],[133.05,33.7]].map(point => {
            const [x,y] = map.project(point), ratio = source.width / map.size.width;
            return [...context.getImageData(Math.round(x*ratio), Math.round(y*ratio), 1, 1).data];
          });
        };
        const crossingCanvas = window.maps[2].host.shadowRoot.querySelector('canvas');
        const crossingCopy = document.createElement('canvas');
        crossingCopy.width = crossingCanvas.width; crossingCopy.height = crossingCanvas.height;
        const crossingContext = crossingCopy.getContext('2d'); crossingContext.drawImage(crossingCanvas,0,0);
        const crossingPixel = [...crossingContext.getImageData(Math.floor(crossingCopy.width/2),
          Math.floor(crossingCopy.height/2),1,1).data];
        const base = pixels(), isolated = read().second;
        await map.seek({regions}); const coloured = pixels(), colouredImage = read().image;
        const changed = structuredClone(regions);
        changed.features[0].properties.fill = '#00aa00';
        changed.features[0].properties = {...window.zonePaint, ...changed.features[0].properties, opacity: 1};
        await map.seek({regions: changed}); const recoloured = pixels();
        changed.features.forEach(feature => feature.properties.opacity = 0);
        await map.seek({regions: changed}); const hidden = pixels();
        await map.seek({regions}); const restoredImage = read().image;
        const joined = structuredClone(regions); joined.features[0].geometry.coordinates = [ring];
        await map.seek({regions: joined}); const changedBoundary = pixels();
        await map.seek({regions: empty}); const removed = pixels();
        const regionsIsolated = read().second === isolated;
        await renderer.seek(0); const defaultRestored = read().image === first.image;
        const regionChecks = {base, coloured, recoloured, hidden, changedBoundary, removed,
          reverseEqual: colouredImage === restoredImage, regionsIsolated, defaultRestored, crossingPixel};
        const hosts = window.maps.map(map => map.host);
        renderer.dispose(); renderer.dispose();
        const released = hosts.every(host => !host.isConnected && !host.shadowRoot.querySelector('canvas'));
        window.annotationAnimation = null;
        renderer = VoxRenderer.createRenderer({element, segment});
        await renderer.seek(0); const remount = read(); renderer.dispose();
        return {first, later, reverse, remount, released, regionChecks};
      }, {data, crossingData});
      assert.ok(Math.abs(result.first.crossing) < .1, '跨日期线镜头不被强制夹回单个世界边界');
      assert.notEqual(result.first.image, result.later.image);
      assert.deepEqual(result.first, result.reverse);
      assert.deepEqual(result.first, result.remount);
      assert.equal(result.first.second, result.later.second, '另一地图与SVG渐变不受影响');
      assert.equal(result.first.animationTime, 0);
      assert.equal(result.later.animationTime, 1000);
      assert.equal(result.later.animationState, 'paused');
      // Body has its default 8px margin; parent renderer fills the viewport.
      for (const frame of [result.first, result.later]) for (let i = 0; i < 2; i++)
        assert.ok(Math.abs(frame.centre[i] - frame.anchor[i]) < .1, '纸张旋转与移动后锚点同源');
      assert.equal(result.released, true);
      const area = result.regionChecks;
      assert.deepEqual(area.crossingPixel,[68,119,204,255], '创建时区域与数字id=0在日期线另一侧正确绘制');
      assert.deepEqual(area.coloured[0], area.base[0], 'Polygon内环保留底图');
      assert.deepEqual(area.coloured[1], [185,0,0,255], '区域实色确实绘入离线画布');
      assert.deepEqual(area.coloured[2], [0,68,187,255], 'MultiPolygon第一地块');
      assert.deepEqual(area.coloured[3], [0,68,187,255], 'MultiPolygon离散地块');
      assert.deepEqual(area.recoloured[1], [0,170,0,255], '同一镜头只改颜色不能被seek缓存略过');
      assert.deepEqual(area.hidden, area.base, 'opacity零时填色及轮廓都退出');
      assert.deepEqual(area.changedBoundary[0], [185,0,0,255], '范围变化更新同一地理源');
      assert.deepEqual(area.removed, area.base, '移除区域不残留旧色面');
      assert.equal(area.reverseEqual, true, '逆序回到同一完整区域状态');
      assert.equal(area.regionsIsolated, true, '另一地图不串色');
      assert.equal(area.defaultRestored, true, '未传regions恢复创建时的区域状态');
      assert.deepEqual(errors, []);
      assert.ok(requests.every(url => url === '/' || url === '/favicon.ico' || MAP_WORKER_FILES.includes(url.slice(1))), '只加载本地worker依赖');
    } finally { await page.close(); }
  });
});
