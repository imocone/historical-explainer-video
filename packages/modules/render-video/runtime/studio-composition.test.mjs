import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hyperframesCli } from "./browser-session.mjs";
import { prepareStudioComposition } from "./studio-composition.mjs";
import { sceneSourceWindow, sceneFrameAtTime, sourceFrameAtTime } from "./scene-clock.mjs";

const directory = path.resolve(path.dirname(hyperframesCli), "../dist");
const compiler = (await readdir(directory)).find(file => /^compiler-.*\.js$/u.test(file));
const { extractStandaloneEntryFromIndex, parseHTMLContent, prepareFlattenedInnerRoot } = await import(pathToFileURL(path.join(directory, compiler)));
const native = { extractStandaloneEntryFromIndex, prepareFlattenedInnerRoot,
  parseSourceDocument: html => ({ document: parseHTMLContent(html) }) };
const scene = { id: "scene-alpha", role: "body", fromFrame: 300, endFrame: 600, freezeAt: 239, segment: { id: "alpha" } };
const metadata = { props: { fps: 60, transitions: [{ previousId: "alpha", nextId: "beta" }], captions: [{ text: "原字幕" }] },
  timeline: { fromFrame: 120, toFrame: 720, scenes: [scene, { id: "scene-beta", fromFrame: 600, endFrame: 720 }] } };
const indexHtml = `<!doctype html><html><head><style>.scene{opacity:0}</style></head><body><div id="episode" data-composition-id="episode" data-start="0" data-duration="10"><div id="scene-alpha" data-composition-id="scene-alpha" data-composition-src="compositions/scene-alpha.html" data-start="6" data-duration="2" data-playback-start="1"></div><div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="4" data-duration="3" data-playback-start="2"></div></div><script id="composition-data" type="application/json">${JSON.stringify(metadata)}</script><script src="scene.js" defer></script></body></html>`;
const entryHtml = '<template><div data-composition-id="scene-alpha" data-no-timeline data-duration="5"><div class="scene-content"></div></div></template>';
const previewHtml = '<!doctype html><html><head><base href="/api/projects/test/preview/"><style>.scene{opacity:0}</style><script data-hyperframes-preview-runtime="1" src="/api/runtime.js"></script></head><body><script>window.__timelines=window.__timelines||{};</script><div data-composition-id="scene-alpha" data-composition-file="compositions/scene-alpha.html" data-duration="5"><div class="presentation"><div class="scene-content"></div></div><div class="media-parking"></div></div><script data-scene-script type="text/hf-after-fonts">window.__timelines["scene-alpha"]=null;</script></body></html>';
const read = html => {
  const document = parseHTMLContent(html);
  return { document, metadata: JSON.parse(document.getElementById("composition-data").textContent) };
};

test("a trimmed standalone scene retains its native host offset and original source window", () => {
  const html = prepareStudioComposition({ indexHtml, entryHtml, composition: "compositions/scene-alpha.html", ...native });
  const { document, metadata: projected } = read(html);
  const root = document.getElementById("episode"), host = document.getElementById("scene-alpha");
  assert.equal(root.getAttribute("data-duration"), "2");
  assert.equal(host.getAttribute("data-start"), "0");
  assert.equal(host.getAttribute("data-duration"), "2");
  assert.equal(host.getAttribute("data-playback-start"), "1");
  assert.deepEqual(projected.timeline, { fromFrame: 300, toFrame: 600, scenes: [scene] });
  assert.deepEqual(projected.props.transitions, []);
  assert.equal(sceneFrameAtTime(scene, sceneSourceWindow(scene, projected.timeline), 1, 60), 60,
    "the native start trim is applied once, without the original host position");
  assert.equal(document.querySelectorAll('script[src="scene.js"]').length, 1);
  assert.equal(document.querySelectorAll("#composition-data").length, 1);
  assert.equal(document.getElementById("captions"), null);
});

test("drill-down uses the same scene projection with the native preview runtime and base", () => {
  const html = prepareStudioComposition({ indexHtml, entryHtml, composition: "compositions/scene-alpha.html", previewHtml, ...native });
  const { document, metadata: projected } = read(html);
  assert.equal(document.querySelector("base").getAttribute("href"), "/api/projects/test/preview/");
  assert.equal(document.querySelector("script[data-hyperframes-preview-runtime]").getAttribute("src"), "/api/runtime.js");
  assert.equal(document.getElementById("episode").getAttribute("data-duration"), "2");
  assert.deepEqual(projected.timeline, { fromFrame: 300, toFrame: 600, scenes: [scene] });
  assert.equal(document.querySelectorAll('script[src="scene.js"]').length, 1);
  const host = document.getElementById("scene-alpha");
  assert.equal(host.getAttribute("data-composition-src"), null, "the preview must not asynchronously reload an already prepared native scene");
  assert.equal(host.getAttribute("data-composition-file"), "compositions/scene-alpha.html");
  assert.equal(host.getAttribute("data-playback-start"), "1");
  assert.ok(host.querySelector('[data-hf-inner-root="true"] .scene-content'));
  assert.equal(document.querySelector("[data-scene-script]").textContent, 'window.__timelines["scene-alpha"]=null;');
});

test("caption drill-down keeps the programme source origin and delegates ordinary compositions", () => {
  const captionPreview = previewHtml.replaceAll("scene-alpha", "captions")
    .replace('data-duration="5"', 'data-duration="10"').replace('class="scene-content"', 'id="caption-content"');
  const html = prepareStudioComposition({ indexHtml, entryHtml: '<template><div data-composition-id="captions" data-duration="10"><div id="caption-content"></div></div></template>',
    composition: "compositions/captions.html", previewHtml: captionPreview, ...native });
  const { document, metadata: projected } = read(html);
  assert.equal(document.getElementById("episode").getAttribute("data-duration"), "3");
  assert.equal(document.getElementById("captions").getAttribute("data-playback-start"), "2");
  assert.deepEqual(projected.timeline, { fromFrame: 120, toFrame: 720, scenes: [] });
  assert.deepEqual(projected.props.captions, metadata.props.captions);
  assert.equal(sourceFrameAtTime(2, 60, projected.timeline.fromFrame), 240);
  assert.ok(document.getElementById("caption-content"));
  assert.equal(prepareStudioComposition({ indexHtml, entryHtml, composition: "index.html", ...native }), null);
  assert.equal(prepareStudioComposition({ indexHtml, entryHtml, composition: "compositions/ordinary.html", ...native }), null);
});
