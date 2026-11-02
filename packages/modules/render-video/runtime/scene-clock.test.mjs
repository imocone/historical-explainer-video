import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, stop } from "esbuild";
import { withBrowserSession, hyperframesCli } from "./browser-session.mjs";
import { sceneSourceWindow, sourceFrameAtTime, sceneFrameAtTime, hasAuthoredWindow } from "./scene-clock.mjs";

test("caption paint follows the visible native scene across cuts, edits and reverse seeks", { timeout: 30000 }, async () => {
  let bundle;
  try {
    bundle = await build({ entryPoints: [fileURLToPath(new URL("./browser.jsx", import.meta.url))], bundle: true, write: false,
      platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
      plugins: [{ name: "caption-paint", setup(build) {
        build.onResolve({ filter: /\/template-renderers\.mjs$/ }, () => ({ path: "caption-paint", namespace: "caption-paint" }));
        build.onLoad({ filter: /.*/, namespace: "caption-paint" }, () => ({ contents: `
          const factory=async()=>({createRenderer:()=>({seek(){},dispose(){}})});
          export const templateRendererLoaders={"fullframe-narrative":factory,"vox-explainer":factory};` }));
      } }] });
  } finally { await stop(); }
  const runtime = await readFile(new URL("../dist/hyperframe.runtime.iife.js", pathToFileURL(hyperframesCli)), "utf8");
  const visualStyle = { shared: { fonts: {} }, p4: { subtitle: {
    primaryColor: "#ffffff", outlineColor: "#000000", shadowColor: "#000000" } } };
  const segment = (id,templateId) => ({id,templateId,segmentType:"body",startFrame:id==="a"?0:60,
    appliedTransitionFrames:0,assetRefs:[],visualStyle,
    renderData:{voxExplainer:{appearance:{palette:{ink:"#30372f",paper:"#f7f1e3"}}}}});
  const metadata = {props:{fps:60,visualStyle,transitions:[],
    captions:[{startMs:0,endMs:2000,text:"原句与原时间保持"}]},
    timeline:{fromFrame:0,toFrame:120,scenes:[
      {id:"scene-a",role:"body",fromFrame:0,endFrame:60,segment:segment("a","vox-explainer")},
      {id:"scene-b",role:"body",fromFrame:60,endFrame:120,segment:segment("b","fullframe-narrative")}]}};
  const host=(id,start)=>`<div class="scene" id="scene-${id}" data-composition-id="${id}" data-no-timeline data-start="${start}" data-duration="1"><div class="presentation"><div class="scene-content"></div></div></div>`;
  await withBrowserSession(async session => {
    const page=await (await session.browser()).newPage();
    await page.setContent(`<div id="episode" data-composition-id="episode" data-no-timeline data-start="0" data-duration="2" data-width="1920" data-height="1080" data-fps="60"><div id="visual-stage">${host("a",0)}${host("b",1)}</div><div id="captions" data-composition-id="captions" data-no-timeline data-start="0" data-duration="2"><div id="caption-content"></div></div></div><script id="composition-data" type="application/json">${JSON.stringify(metadata)}</script>`);
    await page.addScriptTag({content:runtime});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>window.__playerReady&&window.__renderReady);
    const seek=time=>page.evaluate(async time=>{
      window.__player.seek(time);await window.__hfWaitForSeekCompletion();
      const node=document.querySelector('[data-caption-backing]').parentElement;
      return {text:node.textContent,color:getComputedStyle(node).color,
        stroke:getComputedStyle(node).webkitTextStrokeColor,size:getComputedStyle(node).fontSize};
    },time);
    assert.deepEqual(await seek(.5),{text:"原句与原时间保持",color:"rgb(48, 55, 47)",stroke:"rgb(247, 241, 227)",size:"68px"});
    assert.equal((await seek(1.5)).color,"rgb(255, 255, 255)","fullframe must not inherit a Vox paint payload");
    assert.equal((await seek(.5)).color,"rgb(48, 55, 47)","reverse seek restores the correct paint");
    await page.evaluate(()=>{Object.assign(document.getElementById('scene-a').dataset,{start:"1.2",duration:".4"});});
    assert.equal((await seek(.5)).color,"rgb(255, 255, 255)","hidden old metadata must not paint the caption");
    assert.equal((await seek(1.4)).color,"rgb(48, 55, 47)","paint follows the moved visible Vox host");
    assert.equal((await seek(1.8)).color,"rgb(255, 255, 255)","paint resets after the native trim");
  });
});

test("native source time retains preview offsets, boundary samples and frozen frames", () => {
  const timeline = { fromFrame: 300, toFrame: 600 };
  for (const scene of [
    { fromFrame: 240, endFrame: 480 },
    { fromFrame: 300, endFrame: 360, sampleOffset: 120, freezeAt: 139 },
    { fromFrame: 420, endFrame: 660, freezeAt: 119 }
  ]) {
    const window = sceneSourceWindow(scene, timeline);
    for (let global = window.startFrame; global < window.endFrame; global++) {
      assert.equal(sceneFrameAtTime(scene, window, (global - window.startFrame) / 60, 60),
        Math.min(global - scene.fromFrame + (scene.sampleOffset ?? 0), scene.freezeAt ?? Infinity));
    }
  }
  const video = { fromFrame: 240, endFrame: 600, freezeAt: 179 };
  const window = sceneSourceWindow(video, timeline);
  const trimmedTime = 0.5;
  assert.equal(sceneFrameAtTime(video, window, trimmedTime, 60) - 12 + 54, 132,
    "video head handles and semantic offsets follow the same native trim time");
  assert.equal(sourceFrameAtTime(2.5, 60, window.startFrame), 450, "the ending clock must keep advancing while the picture is frozen");
  const attributes = { start: "0", duration: "5" };
  assert.equal(hasAuthoredWindow(attributes, window, timeline, 60), true);
  const normalized = { start: "0", hfAuthoredDuration: "5" };
  assert.equal(hasAuthoredWindow(normalized, window, timeline, 60), true, "native duration normalization must preserve authored seams");
  assert.equal(hasAuthoredWindow({ ...normalized, duration: "4" }, window, timeline, 60), false, "an explicit trim takes precedence over native stored duration");
  for (const edit of [{ start: "1" }, { duration: "4" }, { playbackStart: "0.5" }, { playbackRate: "2" }, { automation: "{}" }]) {
    assert.equal(hasAuthoredWindow({ ...attributes, ...edit }, window, timeline, 60), false);
  }
  assert.equal(hasAuthoredWindow(attributes, window, timeline, 60), true, "restoring native attributes restores the authored seam");
});

test("Studio move and trim drive native scene, caption and video clocks", { timeout: 30000 }, async () => {
  let bundle;
  try {
    bundle = await build({ entryPoints: [fileURLToPath(new URL("./browser.jsx", import.meta.url))], bundle: true, write: false,
      platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
      plugins: [{ name: "clock-view", setup(build) {
        build.onResolve({ filter: /\/template-renderers\.mjs$/ }, () => ({ path: "clock-view", namespace: "clock-view" }));
        build.onLoad({ filter: /.*/, namespace: "clock-view" }, () => ({ contents: `
          export const templateRendererLoaders={"fullframe-narrative":async()=>({createRenderer:({element})=>{
            const id=element.closest(".scene").id;
            window.__clockTest.created.push(id);
            return{seek(frame){window.__clockTest.frames[id]=frame;},dispose(){window.__clockTest.disposed.push(id);}};
          }})};` }));
      } }] });
  } finally { await stop(); }
  const runtime = await readFile(new URL("../dist/hyperframe.runtime.iife.js", pathToFileURL(hyperframesCli)), "utf8");
  const visualStyle = { shared: { fonts: {} }, p4: { subtitle: {} } };
  const segment = id => ({ id, templateId: "fullframe-narrative", segmentType: "body", startFrame: id === "a" ? 0 : 120,
    appliedTransitionFrames: 0, assetRefs: [], visualStyle });
  const scenes = [{ id: "scene-a", role: "body", fromFrame: 0, endFrame: 180, segment: segment("a") },
    { id: "scene-b", role: "body", fromFrame: 66, endFrame: 240, freezeAt: 59, segment: segment("b") }];
  const metadata = { props: { fps: 60, visualStyle,
    transitions: [{ mode: "narrative", previousId: "a", nextId: "b", startFrame: 120, durationInFrames: 0 }],
    ending: { afterSegmentId: "b", holdFrames: 15 },
    captions: [{ startMs: 400, endMs: 600, text: "原轴字幕" }, { startMs: 900, endMs: 1100, text: "裁剪字幕" }] },
    timeline: { fromFrame: 0, toFrame: 240, endingStart: 180, endingEnd: 240, scenes } };
  const host = (id, start) => `<div class="scene" id="scene-${id}" data-composition-id="${id}" data-no-timeline data-start="${start}" data-duration="${id === "a" ? 3 : 2.9}"><div class="presentation"><div class="scene-content"></div></div><div class="media-parking">${id === "a" ? '<video id="clock-video" muted data-has-audio="false" data-start="0" data-duration="3" data-playback-start="0.25"></video>' : ""}</div></div>`;
  await withBrowserSession(async session => {
    const page = await (await session.browser()).newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent(`<div id="episode" data-composition-id="episode" data-no-timeline data-start="0" data-duration="4" data-width="320" data-height="180" data-fps="60"><div id="visual-stage">${host("a", 0)}${host("b", 1.1)}</div><div id="transition-decoration"></div><div id="ending"></div><div id="captions" data-composition-id="captions" data-no-timeline data-start="0" data-duration="4"><div id="caption-content"></div></div></div><script id="composition-data" type="application/json">${JSON.stringify(metadata)}</script>`);
    await page.evaluate(() => {
      window.__clockTest = { frames: {}, created: [], disposed: [] };
      const video = document.getElementById("clock-video");
      let time = 0;
      // Exercise HY's real media seek without decoding a test movie.
      Object.defineProperties(video, { currentTime: { get: () => time, set: value => { time = value; } },
        duration: { get: () => 10 }, readyState: { get: () => 4 } });
    });
    await page.addScriptTag({ content: runtime });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.__playerReady && window.__renderReady);
    const seek = time => page.evaluate(async time => {
      window.__player.seek(time);
      await window.__hfWaitForSeekCompletion();
      return { ...window.__clockTest, caption: document.getElementById("caption-content").textContent,
        videoTime: document.getElementById("clock-video").currentTime, opacityA: document.getElementById("scene-a").style.opacity,
        opacityB: document.getElementById("scene-b").style.opacity,
        ending: Number(document.getElementById("ending").style.opacity) };
    }, time);
    let result = await seek(0.5);
    assert.equal(result.frames["scene-a"], 30);
    assert.equal(result.caption, "原轴字幕");
    assert.equal(result.videoTime, 0.75);
    assert.equal(result.created.includes("scene-b"), false, "hidden scenes must not create renderers");
    result = await seek(1.5);
    assert.ok(result.created.includes("scene-b"), "the incoming fullframe must prepare inside its existing hidden lead");
    assert.equal(result.opacityB, "0", "preparation must not reveal the incoming picture before the cut");
    const creations = result.created.length;
    result = await seek(2);
    assert.equal(result.frames["scene-b"], 54, "the cut keeps all 54 hidden camera frames");
    assert.equal(result.opacityB, "1");
    assert.equal(result.created.length, creations, "the prepared renderer must survive the cut");
    await page.evaluate(() => {
      const root = document.getElementById("episode");
      root.dataset.hfAuthoredDuration = root.dataset.duration;
      delete root.dataset.duration;
      window.__player.getDuration = () => 0;
    });
    result = await seek(2.5);
    assert.equal(result.opacityA, "0", "the unedited cut still hides the outgoing handle");
    assert.equal(result.frames["scene-b"], 59, "export capture must use the declared duration when the native transport resets to zero");
    await page.evaluate(() => { document.getElementById("scene-a").dataset.start = "1"; });
    result = await seek(1.5);
    assert.equal(result.frames["scene-a"], 30, "moving a scene must restart its original content at the new host start");
    assert.equal(result.videoTime, 0.75);
    result = await seek(2.5);
    assert.equal(result.frames["scene-a"], 90);
    assert.equal(result.opacityA, "1", "the old authored cut must not hide a moved host");
    await page.evaluate(() => {
      Object.assign(document.getElementById("scene-a").dataset, { start: "1.5", duration: "1.5", playbackStart: "0.5" });
      Object.assign(document.getElementById("captions").dataset, { start: "1.5", duration: "2.5", playbackStart: "0.5" });
    });
    result = await seek(2);
    assert.equal(result.frames["scene-a"], 60, "start trim must include the native source offset once");
    assert.equal(result.caption, "裁剪字幕");
    assert.equal(result.videoTime, 1.25, "the view and native video must consume the same trimmed source time");
    result = await seek(3.5);
    assert.equal(result.frames["scene-b"], 59);
    assert.ok(result.disposed.includes("scene-a"));
    const ending = result.ending;
    assert.ok(ending > 0 && ending < 1);
    await page.evaluate(() => { document.getElementById("scene-b").dataset.start = "0.6"; });
    result = await seek(3);
    assert.equal(result.frames["scene-b"], 59);
    assert.equal(result.ending, ending, "the ending must move with the final body's source clock");
    await page.evaluate(() => {
      for (const id of ["scene-a", "captions"]) {
        const host = document.getElementById(id);
        Object.assign(host.dataset, { start: "0", duration: id === "captions" ? "4" : "3" });
        delete host.dataset.playbackStart;
      }
      document.getElementById("scene-b").dataset.start = "1.1";
    });
    result = await seek(0.5);
    assert.equal(result.frames["scene-a"], 30);
    assert.equal(result.caption, "原轴字幕");
    assert.equal(result.videoTime, 0.75);
    assert.deepEqual(errors, []);
  });
});
