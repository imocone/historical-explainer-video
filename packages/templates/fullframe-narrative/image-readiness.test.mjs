import test from "node:test";
import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { fileURLToPath } from "node:url";
import { withBrowserSession } from "../../modules/render-video/runtime/browser-session.mjs";

test("叠化后镜在首次显露前完成解码，显露后延续原相机时钟", { timeout: 30000 }, async () => {
  let bundle;
  try {
    bundle = await build({ stdin: { contents: 'export { createRenderer } from "./index.jsx";',
      resolveDir: fileURLToPath(new URL("./render/", import.meta.url)) }, bundle: true, write: false,
      platform: "browser", format: "iife", globalName: "fullframe", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' } });
  } finally { await stop(); }
  const camera = { scale: 1.25, left: 0, top: -.1 };
  const end = { ...camera, left: -.25 };
  const motion = startFrame => ({ type: "traverse", speedRatio: 1, startFrame, endFrame: 120,
    runtimeEndFrame: 120, fps: 60, startCamera: camera, endCamera: end,
    cameraPath: { cameras: [camera, end], segmentLengths: [.25], travelDistance: .05 } });
  const segment = { assetRefs: ["a", "b"].map((id, index) => ({ requestId: `AR00${index + 1}`,
    kind: "fullframe-image", mediaType: "image", file: `${id}.svg` })),
    visualStyle: { shared: { fonts: {}, palette: { textPrimary: "#fff" }, fontFamilies: { sans: ["sans-serif"] } },
      p4: { subtitle: {}, surfaces: { canvas: { background: "#000" }, fullframe: { background: "#000" } } } },
    renderData: { fullframe: [0, 1].map(index => ({ requestId: `AR00${index + 1}`, effects: [], motion: motion(index ? 61 : 0) })),
      frameTransitions: [{ startFrame: 60, endFrame: 96, design: { type: "dissolve", durationInFrames: 36 } }] } };
  await withBrowserSession(async session => {
    const page = await (await session.browser()).newPage();
    const requests = [];
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const id = new URL(request.url()).pathname.slice(1);
      requests.push(id);
      if (id === "b.svg") await new Promise(resolve => setTimeout(resolve, 150));
      await request.respond({ status: 200, contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="${id === "a.svg" ? "red" : "blue"}" d="M0 0h320v180H0z"/></svg>` });
    });
    await page.setContent('<div id="stage" style="position:relative;width:320px;height:180px"></div>');
    await page.evaluate(() => {
      window.__hyperframes = { assetUrl: file => `http://image-fixture.local/${file}` };
      window.decodedImages = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        return decode.call(this).then(() => { window.decodedImages.push(this.src); });
      };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(segment => {
      window.view = window.fullframe.createRenderer({ element: document.getElementById("stage"), segment,
        media: new Map(), mediaParking: document.createElement("div") });
    }, segment);
    await page.evaluate(() => window.view.seek(58));
    assert.deepEqual([...requests].sort(), ["a.svg", "b.svg"], "the next image must already be decoded before the transition");
    assert.ok(await page.evaluate(() => window.decodedImages.some(file => file.endsWith("/b.svg"))),
      "starting a request is insufficient: the delayed next image must finish decoding before the transition");
    assert.equal(await page.$eval("#stage img", image => image.src.endsWith("/a.svg")), true);
    const at = frame => page.evaluate(async frame => {
      await window.view.seek(frame);
      const image = document.querySelector('#stage img[src$="/b.svg"]');
      return { file: image.src, width: image.naturalWidth, camera: image.parentElement.style.translate };
    }, frame);
    const first = await at(61), next = await at(62);
    assert.ok(first.file.endsWith("/b.svg"));
    assert.equal(first.width, 320);
    assert.notEqual(first.camera, next.camera, "the prepared image keeps its authored camera clock");
    assert.equal(requests.length, 2, "preparation must not reload either image at the transition");
    await page.evaluate(() => window.view.dispose());
    assert.equal(await page.$eval("#stage", stage => stage.childElementCount), 0);
    await page.close();
  });
});
