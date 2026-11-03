import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  assertProjectMutationTree,
  atomicWriteData,
  fileSha256,
  hashObject,
  programProducer,
  readData
} from "../../program-utils.mjs";
import { VIDEO_SPEC, validateFinalMedia } from "../../video-spec.mjs";
import { assertRenderPlanFiles, buildEpisodeProps } from "./runtime/episode-props.mjs";
import { compileComposition } from "./runtime/compile.mjs";
import { renderComposition } from "./runtime/hyperframes.mjs";
import { runMediaProcess } from "./runtime/media-process.mjs";
import { buildRenderPlan } from "./runtime/plan.mjs";
import { featureIdsFromAssembly } from "./runtime/projection.mjs";
import { prepareRenderPublic } from "./runtime/public-files.mjs";
import { publicationTimingFor, restoreTimingReceipt } from "./runtime/publication-timing.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";

const probe = async (root, file) => {
  const inspected = JSON.parse((await runMediaProcess("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_name,codec_type,width,height,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,sample_rate,channels,duration,nb_frames",
    "-of", "json",
    file
  ], { cwd: root, timeoutMs: 15000, capture: true, maxBuffer: 2 * 1024 * 1024 })).stdout);
  const video = inspected.streams?.find((stream) => stream.codec_type === "video");
  const [numerator, denominator] = String(video?.r_frame_rate ?? "").split("/").map(Number);
  const frameCount = Number(video?.nb_frames);
  if (Number.isInteger(frameCount) && frameCount > 0 && denominator > 0 && numerator > 0) {
    inspected.format.duration = String(frameCount * denominator / numerator);
  }
  return inspected;
};

export const runModule = options => renderVideo(options);

async function renderVideo({ root, systemRoot = root, episodeId, task, restoreTimingOnly = false }) {
  const outputSpec = VIDEO_SPEC.finalOutput;
  const paths = getEpisodePaths(root, episodeId);
  const episode = paths.episode;
  const expectedReceipt = paths.renderReceipt;
  const requestedReceipt = path.isAbsolute(task.outputPath ?? "")
    ? path.resolve(task.outputPath)
    : path.resolve(root, task.outputPath ?? "");
  if (requestedReceipt !== path.resolve(expectedReceipt)) {
    throw new Error("render-video 的 outputPath 不是当前剧集正式渲染回执");
  }
  task = { ...task, outputPath: expectedReceipt };
  const work = getStageWorkPaths(paths, "p4").work;
  await Promise.all([
    assertProjectMutationTree({
      root,
      file: work,
      label: "P4 成片工作写入树"
    }),
    assertProjectMutationTree({
      root,
      file: paths.p4,
      label: "P4 成片输出写入树"
    }),
    assertProjectMutationTree({
      root,
      file: paths.output,
      label: "P4 最终交付写入树"
    }),
    assertProjectMutationTree({
      root,
      file: task.outputPath,
      label: "P4 渲染回执写入路径"
    })
  ]);
  const storyboard = task.context.storyboard;
  const input = task.context.input;
  const cues = task.context.cues;
  const sourceAssets = task.context.sourceAssets;
  const visualPackage = task.context.visualPackage;
  if (!storyboard || typeof storyboard !== "object") throw new Error("P4 工作单缺少 storyboard 投影");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("P4 工作单缺少已核验 narration-package 口播交接包");
  if (!Array.isArray(cues) || cues.length === 0) throw new Error("P4 工作单缺少已核验 cues");
  if (!Array.isArray(sourceAssets)) throw new Error("P4 工作单缺少已核验 sourceAssets");
  const renderPlan = await buildRenderPlan({
    root,
    episodeId,
    storyboard,
    videoPlan: task.context.videoPlan,
    videoManifest: task.context.videoManifest,
    input,
    cues,
    sourceAssets,
    visualPackage,
    featureIds: featureIdsFromAssembly(task.resolvedAssembly)
  });
  await assertRenderPlanFiles({ root, systemRoot, renderPlan });

  if (restoreTimingOnly) {
    const receipt = await readData(expectedReceipt);
    const restored = restoreTimingReceipt({ receipt, renderPlan, videoSha256: await fileSha256(paths.finalVideo) });
    if (hashObject(restored) !== hashObject(receipt)) await atomicWriteData(expectedReceipt, restored);
    return { receiptPath: expectedReceipt, restored: hashObject(restored) !== hashObject(receipt),
      captions: restored.publicationTiming.captions.length };
  }

  const propsDirectory = path.join(work, "props");
  const outputDirectory = paths.output;
  await mkdir(work, { recursive: true });
  await rm(propsDirectory, { recursive: true, force: true });
  await mkdir(propsDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const episodeProps = buildEpisodeProps({ renderPlan });
  const renderPlanPath = path.join(work, "render-plan.json");
  const episodePropsPath = path.join(propsDirectory, "episode.json");
  await atomicWriteData(renderPlanPath, renderPlan);
  await atomicWriteData(episodePropsPath, episodeProps);
  const publicDirectory = await prepareRenderPublic({
    workspaceRoot: root,
    systemRoot,
    episode,
    renderPlan,
    publicDirectory: path.join(work, "hyperframes", hashObject(renderPlan)),
    clear: false
  });
  await compileComposition({ props: episodeProps, projectDirectory: publicDirectory });
  const temporaryOutput = path.join(work, `episode-${process.pid}.mp4`);
  const final = path.join(outputDirectory, `final.${outputSpec.container}`);
  await rm(temporaryOutput, { force: true });
  try {
    await renderComposition({ projectDirectory: publicDirectory, output: temporaryOutput, fps: renderPlan.fps });
    const inspected = await probe(root, temporaryOutput);
    const technical = validateFinalMedia({ inspected, renderPlan });
    await rename(temporaryOutput, final);

    const business = {
      mediaRetention: "documents-and-release",
      episodeId,
      visualPackage: renderPlan.visualPackage,
      renderDigest: renderPlan.renderDigest,
      renderPlanSha256: hashObject(renderPlan),
      renderPlanDurationMs: renderPlan.durationMs,
      output: path.relative(root, final).split(path.sep).join("/"),
      sha256: await fileSha256(final),
      durationMs: technical.durationMs,
      publicationTiming: publicationTimingFor(renderPlan),
      video: {
        codec: technical.video.codec_name,
        width: technical.video.width,
        height: technical.video.height,
        fps: technical.fps,
        pixelFormat: technical.video.pix_fmt,
        colorRange: technical.video.color_range,
        colorSpace: technical.video.color_space,
        colorTransfer: technical.video.color_transfer,
        colorPrimaries: technical.video.color_primaries
      },
      audio: {
        codec: technical.audio.codec_name,
        sampleRate: Number(technical.audio.sample_rate),
        channels: Number(technical.audio.channels)
      }
    };
    await atomicWriteData(task.outputPath, { ...business, _producer: programProducer({ task, business }) });
    // Engine closeout runs media cleanup after recording this completed delivery.
    // It retains its own execution journal and lock until that cleanup succeeds.
  } finally {
    await rm(temporaryOutput, { force: true });
  }
}

export { runModule as run };
