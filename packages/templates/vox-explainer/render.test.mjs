import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build, stop} from 'esbuild';
import {withBrowserSession} from '../../modules/render-video/runtime/browser-session.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('Three.js与SVG共用Cue和定位时间，真实像素可重放且资源随段释放', async () => {
  const bundle = await build({entryPoints: [path.join(directory, 'render/index.jsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'VoxRenderer',
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'silent'});
  await stop();
  await withBrowserSession(async session => {
    const browser = await session.browser(), page = await browser.newPage();
    try {
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({content: bundle.outputFiles[0].text});
      const result = await page.evaluate(async () => {
        const element = document.querySelector('#root');
        window.released = {geometry: 0, material: 0, renderer: 0};
        const animation = `
          const canvas = select('canvas');
          const renderer = new THREE.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true});
          renderer.setSize(64, 64, false);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.setClearColor('#ffffff');
          const scene3 = new THREE.Scene();
          const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
          camera.position.z = 3;
          const geometry = new THREE.BoxGeometry(.6, .6, .6);
          const material = new THREE.MeshBasicMaterial({color: '#ff0000'});
          const model = new THREE.Mesh(geometry, material);
          scene3.add(model);
          geometry.addEventListener('dispose', () => window.released.geometry++);
          material.addEventListener('dispose', () => window.released.material++);
          onCleanup(() => {
            geometry.dispose(); material.dispose(); renderer.dispose();
            renderer.forceContextLoss(); window.released.renderer++;
          });
          timeline.to(model.position, {x: .8, duration: 1, ease: 'none'}, cue('M001'));
          timeline.to(camera.position, {x: .25, duration: 1, ease: 'none'}, cue('M001'));
          timeline.to(model.position, {x: 2, duration: .4, ease: 'none'}, cue('M001') + 1.1);
          const leader = select('line');
          const local = new THREE.Vector3(.125, 0, .3), world = new THREE.Vector3();
          onFrame(({time}) => {
            select('#timed-label').textContent = String(time);
            const point = spatial.projectAnchor(model.localToWorld(world.copy(local)), camera,
              {x: 100, y: 60, width: 64, height: 64});
            leader.setAttribute('visibility', point ? 'visible' : 'hidden');
            leader.setAttribute('x1', point?.x ?? 0);
            leader.setAttribute('y1', point?.y ?? 0);
            renderer.render(scene3, camera);
          });
        `;
        const segment = {assetRefs: [], runtimeTiming: {semanticFrameOffset: 3},
          renderData: {voxExplainer: {policy: {width: 1920, height: 1080, fps: 60},
            appearance: {palette: {background: '#243440', paper: '#172431', ink: '#f8efe0'}, fonts: {}},
            actionTimings: [{target: 'M001', frame: 3}], durationInFrames: 120,
            scene: {markup: `<canvas></canvas><svg><line x2="190" y2="40" stroke="black"/>
              <text id="timed-label" class="vox-label vox-text-outline"></text>
              <text id="small-label" class="vox-label" font-size="20">北陆</text>
              <text id="short-title" class="vox-title" font-size="40">不止一路</text>
              </svg>`, animation}}}};
        const read = () => {
          const root = element.firstChild.shadowRoot, canvas = root.querySelector('canvas');
          const gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4);
          gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const surface = getComputedStyle(element.firstChild), label = root.querySelector('#timed-label');
          const style = getComputedStyle(label), leader = root.querySelector('line');
          return {background: surface.backgroundColor, texture: surface.backgroundImage, image: canvas.toDataURL(),
            label: label.textContent, textStyle: [style.fontSize, style.fill, style.stroke], pixel: [...pixel],
            authoredFontSizes: ['#small-label', '#short-title'].map(id => getComputedStyle(root.querySelector(id)).fontSize),
            anchor: ['visibility', 'x1', 'y1'].map(attr => leader.getAttribute(attr))};
        };
        let renderer = VoxRenderer.createRenderer({element, segment});
        await renderer.seek(-20); const before = read();
        await renderer.seek(200); const after = read();
        await renderer.seek(0); const first = read();
        await renderer.seek(60); const later = read();
        await renderer.seek(0); const reverse = read();
        renderer.dispose(); renderer.dispose();
        const removed = element.childElementCount === 0;
        renderer = VoxRenderer.createRenderer({element, segment});
        await renderer.seek(0); const remount = read();
        renderer.dispose();
        return {before, after, first, later, reverse, remount, removed, released: window.released};
      });
      assert.equal(result.before.label, '0', '转场预进入保持首态，不提前推进Cue');
      assert.equal(result.after.label, String(119 / 60), '转场接出保持末态，不重复播放');
      assert.equal(result.first.background, 'rgb(36, 52, 64)', '渲染选定的底色');
      assert.equal(result.first.texture, 'none', '自选底色不叠加默认纸纹');
      assert.deepEqual(result.first.textStyle, ['46px', 'rgb(248, 239, 224)', 'rgb(23, 36, 49)']);
      assert.deepEqual(result.first.authoredFontSizes, ['20px', '40px'], 'SVG自定字号优先于模板默认字号');
      assert.deepEqual(result.first.pixel, [255, 0, 0, 255], '首帧有真实三维像素');
      assert.deepEqual(result.later.pixel, [255, 255, 255, 255], 'Cue驱动的主体确实移开');
      assert.equal(result.first.label, '0.05', 'SVG包含相同语义帧偏移');
      assert.equal(result.later.label, '1.05');
      assert.deepEqual(result.first.anchor, ['visible', '136', '92']);
      assert.deepEqual(result.later.anchor, ['visible', '153.6', '92'], '局部画布中的引线随模型和相机一起更新');
      assert.deepEqual(result.after.anchor, ['hidden', '0', '0'], '部件出画时隐藏引线');
      assert.notEqual(result.first.image, result.later.image);
      assert.deepEqual(result.first, result.reverse, '逆序定位复原三维与SVG');
      assert.deepEqual(result.first, result.remount, '重进得到相同画面');
      assert.equal(result.removed, true);
      assert.deepEqual(result.released, {geometry: 2, material: 2, renderer: 2});
    } finally { await page.close(); }
  });
});

test('讲解首帧等待SVG、HTML与CSS图片，缺图使seek失败', async t => {
  const bundle = await build({entryPoints: [path.join(directory, 'render/index.jsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'VoxRenderer',
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'silent'});
  await stop();
  const picture = new PNG({width: 2, height: 2});
  picture.data.fill(255);
  const png = PNG.sync.write(picture);
  await withBrowserSession(async session => {
    const browser = await session.browser();
    for (const [kind, missing] of [['svg', false], ['html', false], ['css', false], ['svg', true]]) {
      await t.test(`${kind}${missing ? '缺图' : '等待图片响应'}`, async () => {
        const page = await browser.newPage();
        try {
          let requests = 0;
          await page.setRequestInterception(true);
          page.on('request', request => { if (!request.url().startsWith('data:')) requests++; });
          await page.setContent('<div id="root"></div>');
          await page.addScriptTag({content: bundle.outputFiles[0].text});
          const requested = page.waitForRequest(request => request.url().endsWith('/picture.png'));
          await page.evaluate(kind => {
            window.__hyperframes = {assetUrl: file => `https://vox.test/${file}`};
            const markup = kind === 'svg'
              ? '<svg width="100" height="100"><image href="asset:AR001" width="100" height="100"/></svg>'
              : kind === 'html' ? '<img src="asset:AR001">'
              : '<div style="width:100px;height:100px;background-image:url(asset:AR001)"></div>';
            window.renderer = VoxRenderer.createRenderer({element: document.querySelector('#root'), segment: {
              assetRefs: [{requestId: 'AR001', file: 'picture.png', mediaType: 'image'},
                {requestId: 'AR002', file: 'picture.png', mediaType: 'image'},
                {requestId: 'context-background', file: 'previous.mp4', mediaType: 'video'}],
              renderData: {voxExplainer: {policy: {width: 1920, height: 1080, fps: 60},
                appearance: {palette: {background: '#fff'}, fonts: {}}, actionTimings: [],
                scene: {markup, animation: ''}, durationInFrames: 60}}
            }});
            window.settled = false;
            window.firstFrame = window.renderer.seek(0).then(() => ({ok: true}), error => ({error: error.message}))
              .then(result => { window.settled = true; return result; });
          }, kind);
          const request = await requested;
          const settledBeforeResponse = await page.evaluate(() => window.settled);
          await request.respond(missing ? {status: 404, body: 'missing'}
            : {status: 200, contentType: 'image/png', body: png});
          const result = await page.evaluate(() => window.firstFrame);
          if (missing) assert.ok(result.error, '缺图不能交付成功的首帧');
          else {
            assert.equal(settledBeforeResponse, false, '图片响应前不能交付首帧');
            assert.deepEqual(result, {ok: true});
            await page.evaluate(async () => { await window.renderer.seek(30); await window.renderer.seek(0); });
          }
          assert.equal(requests, 1, '相同图片只加载一次，不预解码前序视频或逐帧重新请求');
        } finally {
          if (!page.isClosed()) {
            await page.evaluate(() => window.renderer?.dispose()).catch(() => {});
            await page.close();
          }
        }
      });
    }
  });
});
