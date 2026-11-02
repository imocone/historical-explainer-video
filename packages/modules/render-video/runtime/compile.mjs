import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, stop } from "esbuild";
import { visualFontEntries } from "../../../visual-fonts.mjs";
import { fileSha256, hashObject } from "../../../program-utils.mjs";
import { compositionTimeline } from "./timeline.mjs";
import { sceneSourceWindow } from "./scene-clock.mjs";
import { mixCompositionAudio } from "./audio-mix.mjs";
import { withMediaResources, runMediaProcess } from "./media-process.mjs";

const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const attribute = text => String(text).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const url = file => file.split("/").map(encodeURIComponent).join("/");

export const compileComposition = options => withMediaResources(async () => {
  try { return await compile(options); }
  finally { await stop(); }
}, { directory: options.projectDirectory });

async function compile({ props: input, projectDirectory, audio = true }) {
  const props = structuredClone(input);
  const timeline = compositionTimeline(props);
  await rm(path.join(projectDirectory, "compositions"), { recursive: true, force: true });
  // Preserve the exact frame-derived number: rounding a 60 fps boundary to
  // nine decimals can make HyperFrames seek a few billionths into a video,
  // which FFprobe rejects when that offset is formatted in scientific notation.
  const seconds = frames => frames / props.fps;
  const sourceDurations = new Map(), stills = new Map();
  await Promise.all([mkdir(path.join(projectDirectory, "frames"), { recursive: true }), mkdir(path.join(projectDirectory, "capture"), { recursive: true }), mkdir(path.join(projectDirectory, "compositions"), { recursive: true })]);
  const still = async (asset, frame) => {
    const key = hashObject({ file: asset.file, sha256: asset.sha256, frame, fps: props.fps });
    const relative = `frames/${key}.png`;
    if (!stills.has(key)) stills.set(key, (async () => {
      const source = path.join(projectDirectory, asset.file);
      await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", source, "-ss", String(frame / props.fps), "-frames:v", "1", "-threads", "2", path.join(projectDirectory, relative)]);
      await stat(path.join(projectDirectory, relative));
      return relative;
    })());
    return stills.get(key);
  };
  const hostHtml = [];
  for (const scene of timeline.scenes) {
    // Body, boundary and context instances own separate media nodes.
    scene.segment = structuredClone(scene.segment);
    const segment = scene.segment, videoHtml = [];
    const { startFrame: hostStart, endFrame: hostEnd, sampleFrame } = sceneSourceWindow(scene, timeline);
    if (hostEnd <= hostStart) continue;
    const video = async (asset, frameOffset, maximumFrame = Infinity) => {
      if (asset.mediaType !== "video") return;
      delete asset.playback;
      delete asset.frozenStill;
      if (Number.isInteger(asset.freezeFrame)) {
        asset.frozenStill = await still(asset, asset.freezeFrame + (asset.trimBefore ?? 0));
        return;
      }
      if (!sourceDurations.has(asset.file)) {
        const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", path.join(projectDirectory, asset.file)], { timeout: 15000 });
        sourceDurations.set(asset.file, Number(JSON.parse(stdout).format.duration));
      }
      const startFrame = 0, trim = asset.trimBefore ?? 0;
      const sampleStart = sampleFrame;
      const endFrame = Math.min(maximumFrame, scene.freezeAt == null ? Infinity : scene.freezeAt + frameOffset,
        Math.round(sourceDurations.get(asset.file) * props.fps) - 1 - trim);
      if (endFrame < 0) throw new Error(`${segment.id} 视频没有可播放帧`);
      if (scene.freezeAt != null && sampleStart >= scene.freezeAt) {
        asset.frozenStill = await still(asset, endFrame + trim);
        return;
      }
      const id = `${scene.id}-media-${videoHtml.length}`;
      asset.playback = { id, startFrame, endFrame,
        firstStill: await still(asset, trim), lastStill: await still(asset, endFrame + trim) };
      const sourceAtStart = sampleStart + frameOffset;
      const localStart = Math.max(0, -sourceAtStart);
      const availableFrames = Math.min(hostEnd - hostStart - localStart, endFrame - Math.max(0, sourceAtStart) + 1);
      if (availableFrames <= 0) return;
      const holdStart = localStart + availableFrames, holdFrames = hostEnd - hostStart - holdStart;
      const hold = holdFrames > 0 ? `<img class="clip" src="${attribute(url(asset.playback.lastStill))}" data-start="${seconds(holdStart)}" data-duration="${seconds(holdFrames)}" data-track-index="0" style="position:absolute;inset:0;width:100%;height:100%;object-fit:inherit">` : "";
      videoHtml.push(`<div data-media-source style="position:absolute;inset:0"><video id="${id}" class="clip" src="${attribute(url(asset.file))}" muted playsinline data-has-audio="false" data-start="${seconds(localStart)}" data-duration="${seconds(availableFrames)}" data-playback-start="${seconds(trim + Math.max(0, sourceAtStart))}" data-track-index="0" style="width:100%;height:100%;object-fit:cover"></video>${hold}</div>`);
    };
    if (segment.templateId === "cinematic-video") await video(segment.assetRefs[0],
      segment.runtimeTiming.semanticFrameOffset + segment.renderData.headHandleFrames);
    else if (segment.renderMode === "asset-media") await video(segment.assetRefs[0], 0);
    else {
      for (const asset of segment.assetRefs) if (Number.isInteger(asset.freezeFrame)) await video(asset, 0);

    }
    const content = `<template><div data-composition-id="${scene.id}" data-no-timeline data-duration="${seconds(hostEnd-hostStart)}" data-width="${props.width}" data-height="${props.height}" data-fps="${props.fps}" style="position:absolute;inset:0;width:100%;height:100%"><div class="presentation"><div class="scene-content"></div></div><div class="media-parking">${videoHtml.join("")}</div></div></template>`;
    await writeFile(path.join(projectDirectory,"compositions",`${scene.id}.html`),content);
    hostHtml.push({role:scene.role,html:`<div id="${scene.id}" data-composition-id="${scene.id}" data-composition-src="compositions/${scene.id}.html" data-no-timeline data-start="${seconds(hostStart-timeline.fromFrame)}" data-duration="${seconds(hostEnd-hostStart)}" data-track-index="${scene.role === "overlay" ? 2 : 0}" data-track-kind="graphics" class="scene"></div>`});
  }
  const fonts = visualFontEntries(props.visualStyle).map(([, font]) => font);
  const subtitle = props.visualStyle.p4.subtitle;
  if (subtitle.fontPublicPath) fonts.push({ family: subtitle.fontName, publicPath: subtitle.fontPublicPath, format: subtitle.fontFormat, weight: subtitle.fontWeight, style: subtitle.fontStyle });
  const fontCss = [...new Map(fonts.map(font => [JSON.stringify(font), font])).values()].map(font =>
    `@font-face{font-family:${JSON.stringify(font.family)};src:url("${url(font.publicPath)}") format("${font.format}");font-weight:${font.weight};font-style:${font.style};font-display:block}`).join("\n");
  // The same PCM mix feeds live playback and P4's single AAC encode.
  if (audio) try {
    await mixCompositionAudio({ props, timeline, projectDirectory });
  } catch (error) {
    error.audioPlaybackFailure = true;
    throw error;
  }
  const duration = seconds(timeline.toFrame - timeline.fromFrame);
  await writeFile(path.join(projectDirectory,"compositions","captions.html"),`<template><div data-composition-id="captions" data-no-timeline data-duration="${duration}" data-width="${props.width}" data-height="${props.height}" style="position:absolute;inset:0;width:100%;height:100%"><div id="caption-content" style="position:absolute;inset:0"></div></div></template>`);
  let rendererSha256;
  const html = includeAudio => `<!doctype html><html><head><meta charset="utf-8"><meta name="renderer-sha256" content="${rendererSha256}"><style>${fontCss}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#episode{position:relative;width:100%;height:100%;overflow:hidden}.scene,.presentation,.scene-content,#visual-stage,#captions,#ending,#transition-decoration{position:absolute;inset:0}.scene{opacity:0}.presentation{isolation:isolate}.media-parking{position:absolute;left:-10000px;top:0;width:${props.width}px;height:${props.height}px;pointer-events:none}#visual-stage{isolation:isolate}#transition-decoration{z-index:2;pointer-events:none}#ending{z-index:4;background:#000;opacity:0;pointer-events:none}#captions{z-index:5;pointer-events:none}</style></head><body><div id="episode" data-composition-id="episode" data-no-timeline data-start="0" data-duration="${duration}" data-width="${props.width}" data-height="${props.height}" data-fps="${props.fps}"><div id="visual-stage">${hostHtml.filter(host=>host.role!=="overlay").map(host=>host.html).join("")}</div><div id="transition-decoration"></div>${hostHtml.filter(host=>host.role==="overlay").map(host=>host.html).join("")}<div id="ending"></div><div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-no-timeline data-start="0" data-duration="${duration}" data-track-index="3" data-track-kind="captions"></div>${includeAudio && audio ? `<audio id="programme-audio" src="audio.wav" data-start="0" data-duration="${duration}" data-track-index="4"></audio>` : ""}</div><script id="composition-data" type="application/json">${JSON.stringify({ props, timeline }).replace(/</g, "\\u003c")}</script><script src="scene.js" defer></script></body></html>`;
  await build({ entryPoints: [path.join(directory, "browser.jsx")], outfile: path.join(projectDirectory, "scene.js"), bundle: true,
    platform: "browser", format: "iife", target: "chrome120", define: { "process.env.NODE_ENV": '"production"' }, minify: true,
    loader: { ".woff2": "file", ".ttf": "file" }, logLevel: "silent" });
  // HY hashes the compiled HTML for segment recovery; external scripts remain
  // URLs there. Include the actual code so changed renderers cannot reuse old frames.
  rendererSha256=hashObject([await fileSha256(path.join(projectDirectory, 'scene.js'))]);
  await Promise.all([writeFile(path.join(projectDirectory, "index.html"), html(true)),
    writeFile(path.join(projectDirectory, "capture", "index.html"), html(false)),
    writeFile(path.join(projectDirectory, "hyperframes.json"), JSON.stringify({ name: props.episodeId ?? "preview", width: props.width, height: props.height, fps: props.fps }))]);
  return { projectDirectory, props, timeline, durationInFrames: timeline.toFrame - timeline.fromFrame };
}
