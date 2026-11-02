import { resolveCueRange } from "../../cue-boundaries.mjs";
import { VIDEO_SPEC, frameForMs } from "../../video-spec.mjs";
import { narrativeExitTailFrames, narrativeHandleFrames } from "../../modules/render-video/runtime/narrative-transition.mjs";

export const videoWindow = ({ span, storyboard, cues }) => {
  const beats = storyboard?.beats ?? [];
  const indexes = (span.beatIds ?? []).map((id) => beats.findIndex((beat) => beat.id === id));
  if (!indexes.length || indexes.some((index, i) => index < 0 || (i > 0 && index !== indexes[i - 1] + 1)))
    throw new Error(`${span.id} 必须引用按正文顺序排列的连续完整Beat`);
  const members = indexes.map((index) => beats[index]);
  if (members.some((beat) => beat.templateId !== "fullframe-narrative" || beat.treatment?.templateId !== "fullframe-narrative"))
    throw new Error(`${span.id} 只能覆盖已接纳的全画幅Beat，不能跨讲解`);
  if ((storyboard.templateRuns ?? []).some((run) => run.templateId !== "fullframe-narrative"
    && run.beatIds.some((id) => span.beatIds.includes(id))))
    throw new Error(`${span.id} 不能占用讲解运行组中的Beat`);
  const range = resolveCueRange({ cueRange: [members[0].cueRange[0], members.at(-1).cueRange[1]], cues });
  if (range.durationMs < 4000 || range.durationMs > 60000)
    throw new Error(`${span.id} 真实正文时窗须为4—60秒，实际${range.durationMs}ms`);
  const shots = span.shots ?? [];
  if (!shots.length || shots.some((shot, index) => shot.id !== `S${String(index + 1).padStart(2, "0")}`
    || !Number.isInteger(shot.durationMs) || shot.durationMs <= 0)
    || shots.reduce((sum, shot) => sum + shot.durationMs, 0) !== range.durationMs)
    throw new Error(`${span.id} 镜头须从S01顺序编号，时长总和须等于真实正文窗口`);
  const groups = span.parts ?? [];
  if (!span.firstFramePrompt?.trim() || !groups.length
    || groups.flatMap((part) => part.shotIds ?? []).join() !== shots.map(({ id }) => id).join())
    throw new Error(`${span.id} 只用一张首图；生成组须按剧情顺序覆盖每个完整镜头一次`);
  const frameAt = (ms) => frameForMs({ milliseconds: ms, fps: VIDEO_SPEC.fps });
  const nextBeat = beats[indexes.at(-1) + 1];
  const nextStartMs = nextBeat?.templateId === "fullframe-narrative"
    ? resolveCueRange({ cueRange: nextBeat.cueRange, cues }).startMs : range.endMs;
  const spanTailFrames = narrativeExitTailFrames({
    previousEndFrame: frameAt(range.endMs), cutFrame: frameAt(nextStartMs)
  });
  let elapsedMs = 0;
  const parts = groups.map((group, index) => {
    if (!group.shotIds.length || !group.videoPrompt?.trim() || Object.hasOwn(group, "startFrame"))
      throw new Error(`${span.id} 第${index + 1}组只填写镜头与动态设计，不能另设起始图`);
    const partShots = group.shotIds.map((id) => shots.find((shot) => shot.id === id));
    const durationMs = partShots.reduce((sum, shot) => sum + shot.durationMs, 0);
    const bodyFrameCount = frameAt(range.startMs + elapsedMs + durationMs) - frameAt(range.startMs + elapsedMs);
    // Reserve real footage once per span. Editing the transition later does not
    // change the production request or shift any shot's narration clock.
    const headHandleFrames = index === 0 ? narrativeHandleFrames() : 0;
    const tailHandleFrames = index === groups.length - 1 ? spanTailFrames : 0;
    const frameCount = bodyFrameCount + headHandleFrames + tailHandleFrames;
    const generationSeconds = Math.max(4, Math.ceil(frameCount / VIDEO_SPEC.fps));
    if (durationMs < 4000 || durationMs > 15000 || frameCount < 1 || generationSeconds > 15)
      throw new Error(`${span.id} 第${index + 1}组正文须至少4秒，加首尾运动余量后不得超过15秒，请在自然动作交接处分界`);
    let shotElapsedMs = elapsedMs;
    const timedShots = partShots.map((shot) => {
      const count = frameAt(range.startMs + shotElapsedMs + shot.durationMs) - frameAt(range.startMs + shotElapsedMs);
      if (count < 1) throw new Error(`${span.id}/${shot.id} 不足一个视频帧`);
      shotElapsedMs += shot.durationMs;
      return { ...shot, frameCount: count };
    });
    const part = { index: index + 1, startMs: elapsedMs, durationMs, bodyFrameCount,
      headHandleFrames, tailHandleFrames, frameCount, generationSeconds,
      ...(group.connection ? { connection: group.connection } : {}),
      videoPrompt: group.videoPrompt, shots: timedShots };
    if (index === 0 && group.connection) throw new Error(`${span.id} 首组不填写前组连接`);
    elapsedMs += durationMs;
    return part;
  });
  const frameCount = parts.reduce((sum, part) => sum + part.frameCount, 0);
  return { ...range, parts, frameCount,
    bodyFrameCount: parts.reduce((sum, part) => sum + part.bodyFrameCount, 0),
    headHandleFrames: parts[0].headHandleFrames, tailHandleFrames: parts.at(-1).tailHandleFrames,
    deliveryDurationMs: Math.round(frameCount * 1000 / VIDEO_SPEC.fps), firstIndex: indexes[0], lastIndex: indexes.at(-1) };
};
