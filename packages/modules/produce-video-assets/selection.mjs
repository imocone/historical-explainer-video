import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { runMediaProcess } from "../render-video/runtime/media-process.mjs";
import { assertProjectMutationTree, hashObject } from "../../program-utils.mjs";
import { VIDEO_SPEC, frameForMs } from "../../video-spec.mjs";
import { cutsFor } from "./delivery.mjs";

const fps = VIDEO_SPEC.fps;
const frameAt = (milliseconds) => frameForMs({ milliseconds, fps });

export const selectionTokenFor = ({ task, spanId, partPlan, receipt }) => hashObject({
  taskDigest: task.taskDigest, spanId, part: partPlan.index,
  requestDigest: receipt.requestDigest, source: receipt.source
});

export const selectionCuts = ({ cuts, partPlan, sourceFrameCount }) => {
  if (!Array.isArray(cuts)) throw new Error("cuts须为本组实际取材范围");
  const normalized = cuts.map((cut) => {
    const seconds = Object.hasOwn(cut, "sourceStartSeconds") || Object.hasOwn(cut, "sourceEndSeconds");
    if (seconds && (Object.hasOwn(cut, "sourceStartFrame") || Object.hasOwn(cut, "sourceEndFrame")
      || !Number.isFinite(cut.sourceStartSeconds) || !Number.isFinite(cut.sourceEndSeconds)
      || cut.sourceStartSeconds < 0 || cut.sourceEndSeconds < 0)) throw new Error("取材起止须同时使用有效秒数或帧号，不能混用");
    return { shotId: cut.shotId,
      sourceStartFrame: seconds ? frameAt(cut.sourceStartSeconds * 1000) : cut.sourceStartFrame,
      sourceEndFrame: seconds ? frameAt(cut.sourceEndSeconds * 1000) : cut.sourceEndFrame };
  });
  cutsFor({ partPlan, cuts: normalized, sourceFrameCount });
  return normalized;
};

// Normal delivery preserves the planned continuous window; it makes no visual judgment.
export const plannedSelectionCuts = ({ partPlan, sourceFrameCount }) => {
  let cursor = partPlan.headHandleFrames;
  return selectionCuts({ partPlan, sourceFrameCount, cuts: partPlan.shots.map((shot) => {
    const sourceStartFrame = cursor;
    cursor += shot.frameCount;
    return { shotId: shot.id, sourceStartFrame, sourceEndFrame: cursor };
  }) });
};

// Only project known timing for an explicitly requested edit.
export const selectionTimeline = ({ window, partPlan, cues, cuts = null }) => {
  const base = frameAt(window.startMs) + window.parts.filter(({ index }) => index < partPlan.index)
    .reduce((sum, part) => sum + part.bodyFrameCount, 0);
  const cueRows = cues.filter((cue) => frameAt(cue.startMs) < base + partPlan.bodyFrameCount && frameAt(cue.endMs) > base)
    .map((cue) => ({ id: cue.id, text: cue.text,
      startFrame: frameAt(cue.startMs) - base, endFrame: frameAt(cue.endMs) - base }));
  let planned = 0;
  let selected = 0;
  return { fps, narrationStartMs: base * 1000 / fps, frameCount: partPlan.bodyFrameCount,
    deliveryFrameCount: partPlan.frameCount,
    handles: { headFrames: partPlan.headHandleFrames, tailFrames: partPlan.tailHandleFrames,
      note: "cuts和下列位置只表示正文；程序连续保留第一镜前、末镜后的余量。" },
    cues: cueRows,
    shots: partPlan.shots.map((shot, index) => {
      const plannedStartFrame = planned;
      planned += shot.frameCount;
      const cut = cuts?.[index];
      const placement = cut ? { outputStartFrame: selected,
        outputEndFrame: selected + cut.sourceEndFrame - cut.sourceStartFrame } : null;
      if (placement) selected = placement.outputEndFrame;
      return { ...shot, plannedStartFrame, plannedEndFrame: planned,
        ...(placement ? { ...placement, sourceStartFrame: cut.sourceStartFrame, sourceEndFrame: cut.sourceEndFrame,
          overlappingCueIds: cueRows.filter((cue) => cue.startFrame < placement.outputEndFrame && cue.endFrame > placement.outputStartFrame).map(({ id }) => id) } : {}) };
    }) };
};

export const selectionView = async ({ root, task, spanId, partPlan, receipt, startFrame = 0, endFrame = receipt.source.frameCount }) => {
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0
    || endFrame <= startFrame || endFrame > receipt.source.frameCount) throw new Error("取材查看范围须为来源内有效的[startFrame,endFrame)");
  const count = Math.min(12, endFrame - startFrame);
  const frames = Array.from({ length: count }, (_, i) => startFrame + (count === 1 ? 0 : Math.round(i * (endFrame - startFrame - 1) / (count - 1))));
  const directory = path.resolve(root, task.scratchPath, "video-selection", spanId, `part-${partPlan.index}`);
  await assertProjectMutationTree({ root, file: directory, label: "当前视频取材图" });
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${hashObject({ source: receipt.source, frames })}.jpg`);
  let cached = false;
  try { cached = (await stat(file)).size > 0; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!cached) {
    const temporary = await mkdtemp(path.join(directory, ".frames-"));
    try {
      const columns = Math.min(4, count), rows = Math.ceil(count / columns);
      const output = path.join(temporary, "view.jpg");
      const labels = frames.map((frame, i) => `drawtext=text='frame ${frame} | ${(frame / fps).toFixed(3)}s':fontsize=18:fontcolor=white:x=${i % columns * 480 + 8}:y=${Math.floor(i / columns) * 298 + 276}`);
      await runMediaProcess("ffmpeg", ["-v", "error", "-threads", "2", "-i", path.resolve(root, receipt.source.file), "-filter_threads", "2", "-vf",
        [`fps=${fps},select=${frames.map((frame) => `eq(n\\,${frame})`).join("+")},scale=480:270,pad=480:298:0:0:color=black,tile=${columns}x${rows}`, ...labels].join(","),
        "-frames:v", "1", "-q:v", "3", "-threads", "2", output], { timeoutMs: 120000 });
      await rename(output, file);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return { file, frames, fps, startFrame, endFrame, note: "帧号对应60fps剪辑时间轴；原片查看时同源换算，稀疏帧只供定位。" };
};
