import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertProjectMutationTree, assertProjectPath, atomicWriteData, hashObject, readData } from "../../program-utils.mjs";
import { loadVideoTask } from "./generate.mjs";
import { validateDelivery, validateProductionReceipts } from "./delivery.mjs";
import { buildRenderPlan } from "../render-video/runtime/plan.mjs";
import { assertRenderPlanFiles, buildEpisodeProps } from "../render-video/runtime/episode-props.mjs";
import { prepareRenderPublic } from "../render-video/runtime/public-files.mjs";
import { compileComposition } from "../render-video/runtime/compile.mjs";
import { launchComposition, renderComposition } from "../render-video/runtime/hyperframes.mjs";
import { withMediaResources } from "../render-video/runtime/media-process.mjs";
const systemRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const preview = async options => {
  const { projectDirectory, ...result } = await withMediaResources(() => preparePreview(options), { directory: options.workspace });
  if (options.exportVideo) await renderComposition({ projectDirectory, output: result.file });
  else await launchComposition(projectDirectory);
  return { ...(!options.exportVideo ? { projectDirectory } : {}), ...result };
};

const preparePreview = async ({ workspace, workOrderPath, spanId, exportVideo = false }) => {
  const { root, task, inputs, episodeId, videoPlan } = await loadVideoTask({ workspace, workOrderPath });
  const candidatePath = path.resolve(root, task.candidatePath);
  await assertProjectPath({ root, file: candidatePath, label: "当前视频候选" });
  const candidate = await readData(candidatePath);
  if (candidate.taskDigest !== task.taskDigest) throw new Error("预览只读取当前唯一候选");
  const span = videoPlan.spans.find(({ id }) => id === spanId);
  if (!span) throw new Error("预览只能选择当前视频段");
  const storyboard = { ...inputs.storyboard.content, ...(inputs.opener ? { opener: inputs.opener } : {}) };
  await validateDelivery({ root, episodeId, videoPlan, videoManifest: candidate.result,
    storyboard: inputs.storyboard.content, cues: inputs.cues });
  await validateProductionReceipts({ root, episodeId, result: candidate.result,
    videoPlan, storyboard: inputs.storyboard.content, cues: inputs.cues, visual: inputs.visual,
    stageRestartId: inputs.stageRestartId });
  const renderPlan = await buildRenderPlan({ root, episodeId, storyboard,
    videoPlan, videoManifest: candidate.result,
    input: inputs.input, cues: inputs.cues, sourceAssets: inputs.sourceAssets,
    visualPackage: inputs.renderVisualPackage, featureIds: inputs.featureIds });
  const index = renderPlan.segments.findIndex(({ id }) => id === spanId);
  if (index < 0) throw new Error("当前视频段没有进入正式渲染计划");
  const neighbors = renderPlan.segments.slice(Math.max(0, index - 1), index + 2);
  const last = neighbors.at(-1);
  // Keep the full scene graph: callouts can start earlier and remain visible in this window.
  renderPlan.preview = { fromFrame: neighbors[0].startFrame,
    toFrame: last.startFrame + last.durationInFrames + (last.id === renderPlan.ending?.afterSegmentId
      ? renderPlan.ending.holdFrames + renderPlan.ending.fadeFrames : 0),
    segmentIds: neighbors.map(({ id }) => id) };
  await assertRenderPlanFiles({ root, systemRoot, renderPlan });
  const directory = path.resolve(root, task.scratchPath, "video-preview", spanId, hashObject(renderPlan));
  await assertProjectMutationTree({ root, file: directory, label: "P4视频上下文预览" });
  await mkdir(directory, { recursive: true });
  const props = path.join(directory, "props.json");
  await atomicWriteData(props, buildEpisodeProps({ renderPlan }));
  const publicDirectory = await prepareRenderPublic({ workspaceRoot: root, systemRoot,
    renderPlan, publicDirectory: path.join(directory, "public"), clear: false });
  await compileComposition({ props: buildEpisodeProps({renderPlan}), projectDirectory: publicDirectory });
  const output = path.join(directory, "preview.mp4");
  return { projectDirectory: publicDirectory, ...(exportVideo ? {file:output} : {}), spanId, segmentIds: renderPlan.preview.segmentIds,
    fromFrame: renderPlan.preview.fromFrame, toFrame: renderPlan.preview.toFrame, fps: renderPlan.fps };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, "work-order": { type: "string" }, span: { type: "string" }, export: {type:"boolean"} } });
  preview({ workspace: values.workspace, workOrderPath: values["work-order"], spanId: values.span, exportVideo:values.export })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
