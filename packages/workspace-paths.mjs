import path from "node:path";
import { readdir } from "node:fs/promises";

export const EPISODE_ID_PATTERN = /^ep[0-9]{2,}$/u;
export const TARGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const assertEpisodeId = (episodeId) => {
  if (!EPISODE_ID_PATTERN.test(episodeId ?? "")) {
    throw new Error(`episode 必须使用 epNN 编号: ${episodeId}`);
  }
};

export const assertTargetId = (targetId) => {
  if (!TARGET_ID_PATTERN.test(targetId ?? "")) {
    throw new Error(`target 必须是小写连字符编号: ${targetId}`);
  }
};

export const getEpisodePaths = (workspaceRoot, episodeId) => {
  assertEpisodeId(episodeId);
  const episode = path.join(workspaceRoot, episodeId);
  const production = path.join(episode, "制作");
  const output = path.join(episode, "output");
  const input = path.join(production, "input");
  const p0 = path.join(production, "p0");
  const p1 = path.join(production, "p1");
  const p2 = path.join(production, "p2");
  const p3 = path.join(production, "p3");
  const p4 = path.join(production, "p4");
  return {
    episode,
    production,
    output,
    input,
    p0,
    p1,
    p2,
    p3,
    p4,
    episodeBrief: path.join(p0, "episode-brief.yaml"),
    sourceAssets: path.join(input, "source-assets.yaml"),
    scriptPackage: path.join(p1, "script-package.yaml"),
    openerNarration: path.join(p1, "opener-narration.yaml"),
    ttsInput: path.join(p2, "tts-input.txt"),
    ttsResult: path.join(p2, "tts-result.yaml"),
    rawNarration: path.join(p2, "raw-narration.flac"),
    subtitleCorrection: path.join(p2, "subtitle-correction.yaml"),
    narrationText: path.join(p2, "narration.txt"),
    narrationAudio: path.join(p2, "narration.mp3"),
    narrationSubtitles: path.join(p2, "narration.srt"),
    subtitleQuality: path.join(p2, "subtitle-quality.yaml"),
    narrationPackage: path.join(p2, "narration-package.yaml"),
    episodePackage: path.join(p4, "episode-package.yaml"),
    videoPlan: path.join(p4, "video-plan.yaml"),
    videoSettings: path.join(p4,"video-settings.yaml"),
    videoManifest: path.join(p4, "video-manifest.yaml"),
    storyboard: path.join(p3, "storyboard.yaml"),
    renderReceipt: path.join(p4, "render-receipt.yaml"),
    finalVideo: path.join(output, "final.mp4")
  };
};

export const getProgramPaths = (workspaceRoot) => ({
  workRoot: path.join(workspaceRoot, "制作", "p0"),
  p0: path.join(workspaceRoot, "制作", "p0"),
  request: path.join(workspaceRoot, "request.yaml"),
  programPlan: path.join(workspaceRoot, "program.yaml")
});

export const getStageWorkPaths = (paths, stageId, segmentId = null, nodeId = null) => {
  if (!/^p[0-9]+$/u.test(stageId)) {
    throw new Error(`非法阶段工作目录: ${stageId}`);
  }
  const stageWork = paths.workRoot
    ? path.join(paths.workRoot, "_work")
    : path.join(paths.production, stageId, "_work");
  if (segmentId && (stageId !== "p3" || !/^TR[0-9]{3,}$/u.test(segmentId))) {
    throw new Error(`P3作者段编号无效: ${segmentId}`);
  }
  if (nodeId && (stageId !== "p4" || !["opener", "video", "video-assets", "render"].includes(nodeId)))
    throw new Error(`P4节点目录无效: ${nodeId}`);
  const work = nodeId ? path.join(stageWork, nodeId)
    : segmentId ? path.join(stageWork, "author", segmentId) : stageWork;
  return {
    work,
    segmentId,
    nodeId,
    workOrder: path.join(work, "work-order.yaml"),
    candidate: path.join(work, "candidate.yaml"),
    returnRequest: (nodeId, beatId = null) => path.join(
      stageWork,
      `return-${nodeId}${beatId ? `-${beatId}` : ""}.yaml`
    )
  };
};

export const authorSegmentId = (unit) => unit?.paragraph?.id ?? unit?.templateRun?.id
  ?? (unit?.kind === "template-run" ? unit.id : null);

export const authorTaskSegmentId = (task) => task.inputs?.authorBatch?.id
  ?? task.inputs?.templateContext?.paragraph?.id
  ?? (task.inputs?.authorUnit?.kind === "template-run" ? task.inputs.authorUnit.id : null);

export const listAuthorWorkPaths = async (paths) => {
  const directory = path.join(getStageWorkPaths(paths, "p3").work, "author");
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory() && /^TR[0-9]{3,}$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => getStageWorkPaths(paths, "p3", entry.name));
};

export const p4WorkPaths = (paths) => ["opener", "video", "video-assets", "render"]
  .map(nodeId => getStageWorkPaths(paths, "p4", null, nodeId));
