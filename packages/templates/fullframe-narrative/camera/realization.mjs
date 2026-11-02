import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { assertProjectPath, atomicWriteData, fileSha256, hashObject, readData } from "../../../program-utils.mjs";
import { prepareRenderPublic } from "../../../modules/render-video/runtime/public-files.mjs";
import { motionRouteViewports, viewportForCamera } from "./geometry.mjs";
import { cameraAtFrame } from "./runtime-layer.mjs";
import { VIDEO_SPEC, frameSpanForMs } from "../../../video-spec.mjs";
import { fullframeFrameWindows, fullframeTransitionsForTreatment } from "../timing-runtime.mjs";
import { runMediaProcess, withMediaResources } from "../../../modules/render-video/runtime/media-process.mjs";
import {previewFeatureResults, candidateEffectTracks, specifiedMusicForWindow, candidateAudioContext} from '../../../modules/render-video/runtime/candidate-audio.mjs';
import {readP3Sources} from '../../../p3-sources.mjs';
import {audioTracksForWindow} from '../../../modules/render-video/runtime/scene-preview.mjs';
import {getEpisodePaths} from '../../../workspace-paths.mjs';
import {frameForMs} from '../../../video-spec.mjs';

const routeFor = ({ props: { motion }, viewingWindow }) => {
  const { startFrame, endFrame } = viewingWindow;
  const at = (frame) => viewportForCamera(cameraAtFrame({ motion, frame }));
  return {
    points: motionRouteViewports(motion),
    samples: [startFrame, Math.floor((startFrame + endFrame) / 2), endFrame]
      .map((frame) => ({ frame, viewport: at(frame) }))
  };
};

// A diagram and direct image crops are enough to place a camera; no video renderer is needed.
const placeOnImage = async ({ view, sourceFile, assetDirectory }) => {
  const route = routeFor(view);
  const file = path.join(assetDirectory, `route-${hashObject(route)}.jpg`);
  // Reuse only the same source, camera and displayed viewing window.
  const cached = await readRouteMap(file, route);
  if (cached) return cached;
  return withMediaResources(async () => {
    // Another CLI may have finished this same image while we waited.
    const ready = await readRouteMap(file, route);
    return ready ?? drawRouteMap({ view, sourceFile, file, route });
  }, { directory: assetDirectory, inspection: true });
};

const readRouteMap = async (file, route) => {
  try { return { file, sha256: await fileSha256(file), ...route }; }
  catch (error) { if (error.code !== "ENOENT") throw error; return null; }
};

const drawRouteMap = async ({ view, sourceFile, file, route }) => {
  const colors = ["0x53d8ff", "0xffcf58", "0x70ed99"];
  const boxes = route.points.map((viewport, index) => ({ viewport, color: index ? colors[1] : colors[0] }));
  boxes.push({ viewport: route.samples.at(-1).viewport, color: colors[2] });
  const draw = boxes.flatMap(({ viewport: v, color }) => [
    `drawbox=x=${v.x * 960}:y=${v.y * 540}:w=${v.width * 960}:h=${v.height * 540}:color=black@0.8:t=5`,
    `drawbox=x=${v.x * 960}:y=${v.y * 540}:w=${v.width * 960}:h=${v.height * 540}:color=${color}:t=2`
  ]);
  // Centre positions trace a straight segment even when a zoom's parameter is nonlinear.
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1], b = route.points[i];
    for (let step = 1; step < 12; step += 1) {
      const t = step / 12;
      const x = (a.x + a.width / 2) * (1 - t) + (b.x + b.width / 2) * t;
      const y = (a.y + a.height / 2) * (1 - t) + (b.y + b.height / 2) * t;
      draw.push(`drawbox=x=${x * 960 - 2}:y=${y * 540 - 2}:w=4:h=4:color=${colors[1]}:t=fill`);
    }
  }
  for (const [i, v] of route.points.entries()) if (i > 0 && i < route.points.length - 1) draw.push(
    `drawtext=text='${i}':x=${(v.x + v.width / 2) * 960}:y=${(v.y + v.height / 2) * 540}:fontsize=16:fontcolor=${colors[1]}:box=1:boxcolor=black@0.7`
  );
  const filters = [
    "[0:v]split=4[source][crop0][crop1][crop2]",
    `[source]scale=960:540,${draw.join(",")},pad=960:570:0:30:color=0x10151c,`
      + `drawtext=text='${view.assetId} | BLUE=route start YELLOW=route GREEN=clear end | crops=clear start-mid-end':x=8:y=7:fontsize=15:fontcolor=white[map]`,
    ...route.samples.map(({ viewport: v }, index) => `[crop${index}]crop=iw*${v.width}:ih*${v.height}:iw*${v.x}:ih*${v.y},scale=320:180,`
      + `pad=320:184:0:4:color=${colors[index]}[tile${index}]`),
    "[tile0][tile1][tile2]hstack=inputs=3[strip]",
    "[map][strip]vstack=inputs=2[out]"
  ];
  const temporary = `${file}.tmp.jpg`;
  await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", sourceFile,
    "-filter_complex_threads", "1", "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "2", "-threads", "2", temporary]);
  await rename(temporary, file);
  return { file, sha256: await fileSha256(file), ...route };
};

// Static framing depends on the image and executed camera, not display overlays.
export const realizationMotionDigest = (view) => hashObject({
  file: view.file, sha256: view.sha256, motion: view.props.motion,
  width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, fps: VIDEO_SPEC.fps
});

// Include actual display resources as well as props when reusing a dynamic clip.
const clipInputDigest = async ({ workspaceRoot, systemRoot, view }) => {
  const files = new Set([view.file, ...(view.props.resourceFiles ?? []),
    ...(view.props.audioTracks ?? []).map(track => track.file),
    ...(view.props.overlays ?? []).flatMap((overlay) => overlay.assetRefs.map((asset) => asset.file))]);
  for (const font of Object.values(view.props.visualStyle?.shared?.fonts ?? {})) if (font?.publicPath) files.add(font.publicPath);
  const subtitleFont = view.props.visualStyle?.p4?.subtitle?.fontPublicPath;
  if (subtitleFont) files.add(subtitleFont);
  const resources = [];
  for (const relative of [...files].sort()) {
    const root = /^(visuals|packages\/(templates|features))\//.test(relative) ? systemRoot : workspaceRoot;
    const file = path.resolve(root, relative);
    let sha256;
    try {
      await assertProjectPath({ root, file, label: "动态预览资源" });
      sha256 = await fileSha256(file);
    } catch (error) {
      if (view.props.audioTracks?.some(track => track.file === relative)) error.audioPlaybackFailure = true;
      throw error;
    }
    if (relative === view.file && sha256 !== view.sha256) throw new Error(`${view.assetId} 成图字节已变化`);
    resources.push({ file: relative, sha256 });
  }
  const audioRuntimeSha256 = view.props.audioTracks?.length
    ? await fileSha256(path.join(systemRoot,'packages/modules/render-video/runtime/audio-mix.mjs')) : null;
  const {audioTracks = [], ...pictureProps} = view.props;
  const audioFiles = new Set(audioTracks.map(track => track.file));
  return {sha256:hashObject({ props: view.props, video: VIDEO_SPEC, resources, audioRuntimeSha256 }),
    pictureSha256:hashObject({props:pictureProps,video:VIDEO_SPEC,
      resources:resources.filter(resource => !audioFiles.has(resource.file))})};
};

export const renderFullframeRealization = options => realizeFullframe(options);

async function realizeFullframe({ workspaceRoot, systemRoot, directory, views, clipAssetId = null }) {
  const jobs = clipAssetId ? views.filter((view) => view.assetId === clipAssetId) : views;
  if (!jobs.length) throw new Error("缺少本次全画幅预览对象");
  if (!clipAssetId) {
    const items = [];
    for (const view of jobs) {
      const sourceFile = path.resolve(workspaceRoot, view.file);
      await assertProjectPath({ root: workspaceRoot, file: sourceFile, label: "成图文件" });
      if (await fileSha256(sourceFile) !== view.sha256) throw new Error(`${view.assetId} 成图字节已变化`);
      const assetDirectory = path.join(directory, view.assetId, realizationMotionDigest(view));
      await mkdir(assetDirectory, { recursive: true });
      const routeMap = await placeOnImage({ view, sourceFile, assetDirectory });
      if (await fileSha256(sourceFile) !== view.sha256) throw new Error(`${view.assetId} 成图在落框期间变化`);
      items.push({ assetId: view.assetId, motionSha256: realizationMotionDigest(view), routeMap });
    }
    return items;
  }
  const view = jobs[0];
  if (view.props.pendingEffectAnchors?.length) throw new Error(`${view.assetId} 先在当前请求填写人物或光源effectAnchors，再看动态预览`);
  const resourceSnapshot = await clipInputDigest({ workspaceRoot, systemRoot, view });
  const resourceSha256 = resourceSnapshot.sha256;
  const { compileComposition } = await import("../../../modules/render-video/runtime/compile.mjs");
  const { scenePreviewProps } = await import("../../../modules/render-video/runtime/scene-preview.mjs");
  const { renderComposition } = await import("../../../modules/render-video/runtime/hyperframes.mjs");
  const durationInFrames = view.props.motion.runtimeEndFrame - view.props.motion.startFrame + 1;
  const segment = {
    id: view.assetId,
    templateId: "fullframe-narrative",
    assetRefs: [view.props.asset],
    visualStyle: view.props.visualStyle,
    durationInFrames,
    renderData: { singleFrameView: view.props, resourceFiles: view.props.resourceFiles }
  };
  const props = scenePreviewProps({ segment, captions: view.props.captions, audioTracks: view.props.audioTracks });
  props.overlays = (view.props.overlays ?? []).map(overlay => ({
    ...overlay, startFrame: overlay.startFrame - view.props.absoluteFromFrame
  }));
  const projectDirectory = await prepareRenderPublic({
    workspaceRoot, systemRoot, renderPlan: props,
    publicDirectory: path.join(directory, view.assetId, resourceSha256, "project"), clear: false
  });
  await compileComposition({ props, projectDirectory });
  // Compile before reuse: props and media alone cannot identify the rendered picture.
  const compositions = (await readdir(path.join(projectDirectory, "compositions")))
    .sort().map(file => `compositions/${file}`);
  const compiledFiles = ["index.html", "capture/index.html", "scene.js", ...compositions];
  const compositionSha256 = hashObject(await Promise.all(
    compiledFiles.map(file => fileSha256(path.join(projectDirectory, file)))
  ));
  const inputSha256 = hashObject({ resourceSha256, compositionSha256 });
  const assetDirectory = path.join(directory, view.assetId, inputSha256);
  const file = path.join(assetDirectory, "motion.mp4");
  const receiptPath = path.join(assetDirectory, "motion.json");
  await assertProjectPath({ root: directory, file: receiptPath, label: "动态预览回执" });
  let receipt;
  try { receipt = await readData(receiptPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (receipt) {
    await assertProjectPath({ root: directory, file, label: "动态预览片段" });
    if (receipt.inputSha256 !== inputSha256 || receipt.assetId !== view.assetId || receipt.file !== file
      || receipt.durationInFrames !== durationInFrames
      || await fileSha256(file) !== receipt.sha256) throw new Error(`${view.assetId} 动态预览缓存已变化，保留现场`);
    return { ...receipt, reused: true };
  }
  await mkdir(assetDirectory, { recursive: true });
  const temporary = path.join(assetDirectory, "motion.tmp.mp4");
  await renderComposition({ projectDirectory, output: temporary });
  const currentResources = await clipInputDigest({ workspaceRoot, systemRoot, view });
  if (currentResources.sha256 !== resourceSha256) {
    const error = new Error(`${view.assetId} 资源在预览期间变化`);
    if (currentResources.pictureSha256 === resourceSnapshot.pictureSha256) error.audioPlaybackFailure = true;
    throw error;
  }
  await rename(temporary, file);
  const result = { assetId: view.assetId, file, sha256: await fileSha256(file),
    inputSha256, compositionSha256, durationInFrames };
  await atomicWriteData(receiptPath, result);
  return { ...result, reused: false };
}

export const candidateCameraViews = async ({ workOrder, candidate, visualStyle = null, includeEffects = false }) => {
  const { deriveMotionCameras } = await import("./p4-runtime.mjs");
  const { fullframeDesignItemsForCandidate } = await import("./candidate-context.mjs");
  const { FULLFRAME_RENDER_POLICY } = await import("../render-policy.mjs");
  const { prepareEffectsForFrame } = await import("../effects/runtime.mjs");
  const { resolveCueBindingsToFrames } = await import("../../../cue-boundaries.mjs");
  const { resolveNarrativeTransition } = await import("../../../modules/render-video/runtime/narrative-transition.mjs");
  const { treatment } = candidate.result;
  const featureResults = previewFeatureResults({inputs:workOrder.inputs, result:candidate.result});
  const { templateContext, cues, authorUnit } = workOrder.inputs;
  const items = fullframeDesignItemsForCandidate({ treatment, featureResults, templateContext, cues });
  const fps = VIDEO_SPEC.fps;
  const startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
  const durationInFrames = frameSpanForMs({ startMs, endMs, fps });
  const actionTimings = resolveCueBindingsToFrames({ bindingSet: featureResults["cue-sync"], cues,
    segmentStartMs: startMs, segmentEndMs: endMs, fps });
  const { firstMotion, transitions } = fullframeTransitionsForTreatment({ treatment, actionTimings, durationInFrames, fps });
  const windows = fullframeFrameWindows({ durationInFrames, transitions, firstMotionFrame: firstMotion.frame,
    runtimeTiming: { cameraPrerollFrames: items[0].budget.cameraPrerollFrames,
      exitTailFrames: items.at(-1).budget.exitTailFrames }, fps });
  return items.map(({ id, motion: design }, index) => {
    const request = treatment.assetRequests[index];
    const asset = { ...request.asset, requestId: id, kind: request.kind, effectAnchors: request.effectAnchors };
    const window = windows[index];
    const motion = { ...design, ...window.motion };
    Object.assign(motion, deriveMotionCameras({ motion, fps, motionPolicy: FULLFRAME_RENDER_POLICY.motion }));
    const { effects } = includeEffects ? prepareEffectsForFrame({ request, asset, actionTimings,
      visibleStartFrame: window.visibleStartFrame, visibleEndFrame: window.visibleEndFrame,
      sceneEndFrame: motion.runtimeEndFrame - motion.cameraFrameOffset,
      cameraFrameOffset: motion.cameraFrameOffset, fps }) : { effects: [] };
    const entranceEnd = request.frameId === "A" && treatment.incomingTransition
      ? Math.ceil(resolveNarrativeTransition(treatment.incomingTransition, fps).durationInFrames / 2) : 0;
    return {
      assetId: `${authorUnit.id.toLowerCase()}-${id.toLowerCase()}`,
      file: asset.file,
      sha256: asset.sha256,
      viewingWindow: {
        startFrame: Math.max(window.readableStartFrame, entranceEnd) + motion.cameraFrameOffset,
        endFrame: window.readableEndFrame - 1 + motion.cameraFrameOffset
      },
      props: { asset, motion, effects, resourceFiles: effects.flatMap(effect => effect.file ? [effect.file] : []),
        visualStyle, overlays: [], captions: [] }
    };
  });
};

// The current author sees the exact route on the actual image before callouts.
export const renderCandidateCamera = async ({workspaceRoot, systemRoot, workOrder, candidate, clipRequestId = null, bgmSourceAssetId = null, muteEffects = false}) => {
  const {loadProgramVisualPackage} = await import('../../../visual-package.mjs');
  const {withVisualFontPaths} = await import('../../../visual-fonts.mjs');
  const visual = clipRequestId ? await loadProgramVisualPackage(systemRoot,workspaceRoot,{roles:['render']}) : null;
  const views = await candidateCameraViews({workOrder,candidate,includeEffects:Boolean(clipRequestId),
    visualStyle:visual ? withVisualFontPaths(visual.renderTokens,visual.id) : null});
  if (clipRequestId) try {
    const {cues, authorUnit} = workOrder.inputs;
    const {resolveCueBindingsToFrames} = await import('../../../cue-boundaries.mjs');
    const fps = VIDEO_SPEC.fps, startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
    const actionTimings = resolveCueBindingsToFrames({bindingSet: previewFeatureResults({inputs:workOrder.inputs, result:candidate.result})['cue-sync'],
      cues, segmentStartMs: startMs, segmentEndMs: endMs, fps});
    const segment = {id:authorUnit.id, templateId:'fullframe-narrative', startMs:0, actionTimings,
      durationInFrames:frameSpanForMs({startMs,endMs,fps}), renderData:{}};
    const sourceAssets = await readP3Sources({workspaceRoot,workOrder});
    const audioContext = await candidateAudioContext({workspaceRoot,workOrder,sourceAssets});
    const tracks = muteEffects ? [] : await candidateEffectTracks({workOrder, result:candidate.result,
      segment, fps, audioContext, durationMs:segment.durationInFrames/fps*1000});
    const narration = await readData(getEpisodePaths(workspaceRoot, workOrder.subject.id).narrationPackage);
    const narrationFile = path.posix.join(workOrder.subject.id, '制作', 'p2', narration.files.audio.path);
    const sourceOrigin = frameForMs({milliseconds: startMs, fps});
    for (const view of views) {
      const fromFrame = view.props.motion.startFrame - view.props.motion.cameraFrameOffset;
      const toFrame = view.props.motion.runtimeEndFrame - view.props.motion.cameraFrameOffset + 1;
      const narrationStart = Math.max(fromFrame, -sourceOrigin);
      const narrationEnd = Math.min(toFrame, frameForMs({milliseconds: narration.durationMs ?? endMs, fps}) - sourceOrigin);
      view.props.audioTracks = audioTracksForWindow({tracks, fromFrame, toFrame, fps});
      view.props.audioTracks.push(...specifiedMusicForWindow({sourceAssetId:bgmSourceAssetId,
        workOrder, result:candidate.result, segment, muteEffects, audioContext, sourceAssets,
        episodeId:workOrder.subject.id, fromFrame:sourceOrigin+fromFrame, toFrame:sourceOrigin+toFrame,
        fps, bodyEndMs:narration.durationMs ?? endMs}));
      if (narrationEnd > narrationStart) view.props.audioTracks.unshift({id: 'preview-narration', kind:'narration',
        file: narrationFile, startMs: (narrationStart - fromFrame) / fps * 1000,
        endMs: (narrationEnd - fromFrame) / fps * 1000,
        sourceStartFrame: sourceOrigin + narrationStart, volume: 1, loop: false});
    }
  } catch (error) {
    error.audioPlaybackFailure = true;
    throw error;
  }
  const {authorUnit} = workOrder.inputs;
  const directory = path.resolve(workspaceRoot,workOrder.scratchPath,'camera');
  await assertProjectPath({root:workspaceRoot,file:directory,label:'当前作者镜头预览'});
  return renderFullframeRealization({workspaceRoot,systemRoot,directory,views,
    clipAssetId:clipRequestId ? `${authorUnit.id.toLowerCase()}-${clipRequestId.toLowerCase()}` : null});
};
