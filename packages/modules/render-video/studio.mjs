import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  resolveRenderInputs
} from "../../../engine/runtime.mjs";
import {
  assertProjectMutationTree,
  atomicWriteData,
  hashObject
} from "../../program-utils.mjs";
import { assertRenderPlanFiles, buildEpisodeProps } from "./runtime/episode-props.mjs";
import { compileComposition } from "./runtime/compile.mjs";
import { launchComposition, stopComposition } from "./runtime/hyperframes.mjs";
import { buildSegmentPreviewProps } from "./runtime/preview-props.mjs";
import { buildRenderPlan } from "./runtime/plan.mjs";
import { featureIdsFromAssembly } from "./runtime/projection.mjs";
import { prepareRenderPublic } from "./runtime/public-files.mjs";
import { withMediaResources } from "./runtime/media-process.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";

const defaultSystemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const episodePattern = /^ep[0-9]{2,}$/u;

export const prepareStudioPublic = ({
  root,
  systemRoot = root,
  episode,
  renderPlan,
  publicDirectory = path.join(episode, "制作", "p4", "_work", "studio", "public")
}) => prepareRenderPublic({
  workspaceRoot: root,
  systemRoot,
  episode,
  renderPlan,
  publicDirectory,
  clear: false
});

const assertEpisode = (episodeId) => {
  if (!episodePattern.test(episodeId ?? "")) {
    throw new Error("用法: node packages/modules/render-video/studio.mjs --episode <episode-id>");
  }
};

const loadRenderInputs = async ({ systemRoot, workspaceRoot, episodeId, previewSegmentIds, part }) => {
  try {
    return await resolveRenderInputs({
      root: systemRoot,
      workspaceRoot,
      episodeId,
      previewSegmentIds,
      previewPart: part
    });
  } catch (error) {
    throw new Error(
      `Studio 无法读取所需渲染材料（${error.message}）`,
      { cause: error }
    );
  }
};

export async function prepareStudio({
  episodeId,
  workspaceRoot,
  systemRoot = defaultSystemRoot,
  previewSegmentIds = null,
  part = null
}) {
  assertEpisode(episodeId);
  if (part && (!["body", "opener"].includes(part) || previewSegmentIds))
    throw new Error("--part 只能选择 body 或 opener，不能与 --beat 混用");
  if (!workspaceRoot) throw new Error("Studio 必须提供节目工作区");
  workspaceRoot = path.resolve(workspaceRoot);
  const task = await loadRenderInputs({ systemRoot, workspaceRoot, episodeId, previewSegmentIds, part });
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const episode = paths.episode;
  await assertProjectMutationTree({
    root: workspaceRoot,
    file: paths.p4,
    label: "P4 Studio 写入树"
  });
  const storyboard = task.context.storyboard;
  previewSegmentIds = task.context.previewSegmentIds ?? null;
  const input = task.context.input;
  const cues = task.context.cues;
  const sourceAssets = task.context.sourceAssets;
  const visualPackage = task.context.visualPackage;
  if (!storyboard || typeof storyboard !== "object") throw new Error("Studio 工作单缺少 storyboard 投影");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Studio 工作单缺少已核验 narration-package 口播交接包");
  if (!Array.isArray(cues) || cues.length === 0) throw new Error("Studio 工作单缺少已核验 cues");
  if (!Array.isArray(sourceAssets)) throw new Error("Studio 工作单缺少已核验 sourceAssets");
  const renderPlan = await buildRenderPlan({
    root: workspaceRoot,
    episodeId,
    storyboard,
    videoPlan: task.context.videoPlan,
    videoManifest: task.context.videoManifest,
    previewSegmentIds,
    previewPart: part,
    input,
    cues,
    sourceAssets,
    visualPackage,
    featureIds: featureIdsFromAssembly(task.resolvedAssembly)
  });
  await assertRenderPlanFiles({ root: workspaceRoot, systemRoot, renderPlan });
  const episodeProps = buildEpisodeProps({ renderPlan });
  const props = part ? buildSegmentPreviewProps({ episodeProps, segmentType: part }) : episodeProps;

  const stageWork = getStageWorkPaths(paths, "p4").work;
  const work = part ? path.join(stageWork, "studio", part)
    : previewSegmentIds ? path.join(stageWork, "previews", hashObject(previewSegmentIds))
      : path.join(stageWork, "studio", "episode");
  const propsDirectory = path.join(work, "props");
  const renderPlanPath = path.join(work, "render-plan.json");
  const propsPath = path.join(propsDirectory, "episode.json");
  const publicDirectory = await withMediaResources(async () => {
    await mkdir(propsDirectory, { recursive: true });
    await atomicWriteData(renderPlanPath, renderPlan);
    await atomicWriteData(propsPath, props);
    const projectDirectory = await prepareStudioPublic({
      root: workspaceRoot,
      systemRoot,
      episode,
      renderPlan,
      publicDirectory: path.join(work, "projects", hashObject(props))
    });
    await compileComposition({ props, projectDirectory });
    return projectDirectory;
  }, { directory: workspaceRoot });
  return {
    projectDirectory: publicDirectory,
    root: workspaceRoot,
    systemRoot,
    publicDirectory,
    propsPath,
    renderPlanPath,
    preview: props.preview ?? null,
    compositionId: "episode",
    renderPlan
  };
}

export async function launchStudio({
  episodeId,
  workspaceRoot,
  systemRoot = defaultSystemRoot,
  previewSegmentIds = null,
  prepareOnly = false,
  part = null,
  open = false
}) {
  const prepared = await prepareStudio({ episodeId, workspaceRoot, systemRoot, previewSegmentIds, part });
  if (prepareOnly) {
    process.stdout.write(`${JSON.stringify({ projectDirectory: prepared.projectDirectory, propsPath: prepared.propsPath, publicDirectory: prepared.publicDirectory, compositionId: prepared.compositionId, preview: prepared.preview })}\n`);
    return prepared;
  }
  const parent = path.dirname(prepared.projectDirectory);
  const work = path.dirname(parent);
  if ((await readdir(work, { withFileTypes: true })).some(entry => entry.name === 'public' && entry.isDirectory()))
    await stopComposition(path.join(work, 'public'));
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name) && entry.name !== path.basename(prepared.projectDirectory))
      await stopComposition(path.join(parent, entry.name));
  }
  await launchComposition(prepared.projectDirectory, { open });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    const { values } = parseArgs({ options: {
      workspace: { type: "string" }, episode: { type: "string" },
      beat: { type: "string", multiple: true }, part: { type: "string" },
      "prepare-only": { type: "boolean" }
    } });
    return launchStudio({ part: values.part, episodeId: values.episode, workspaceRoot: values.workspace,
      previewSegmentIds: values.beat?.length ? values.beat : null, prepareOnly: values["prepare-only"] });
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
