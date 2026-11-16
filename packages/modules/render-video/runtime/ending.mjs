import { anchoredFrameForMs, frameForMs, VIDEO_SPEC } from "../../../video-spec.mjs";

export const EPISODE_ENDING_POLICY = Object.freeze({ fadeSeconds: 2, blackSeconds: 0.5 });

// P2 permits up to one second past the last subtitle. Leave one frame for rounding.
export const episodeEndingReserveFrames = (fps = VIDEO_SPEC.fps) =>
  Math.ceil(fps) + Math.round(EPISODE_ENDING_POLICY.fadeSeconds * fps) + 1;

// Round outward: the first frame of the fade must follow the last audio sample.
// All of these frame counts are relative to the body, independent of the opener.
const episodeEndingTiming = ({ narrationDurationMs, lastCueEndMs, fps }) => {
  const fadeStartFrame = Math.ceil(Math.max(narrationDurationMs + 0.5, lastCueEndMs) * fps / 1000);
  const fadeFrames = Math.round(EPISODE_ENDING_POLICY.fadeSeconds * fps);
  const blackFrames = Math.round(EPISODE_ENDING_POLICY.blackSeconds * fps);
  const fadeEndFrame = fadeStartFrame + fadeFrames;
  const endFrame = fadeEndFrame + blackFrames;
  return { fadeStartFrame, fadeFrames, fadeEndFrame, endFrame,
    motionTailFrames: fadeEndFrame - frameForMs({ milliseconds: lastCueEndMs, fps }) };
};

export const buildEpisodeEnding = ({
  bodyOffsetMs,
  narrationDurationMs,
  lastCueEndMs,
  afterSegmentId,
  afterSegmentType,
  fps
}) => {
  if (!Number.isFinite(narrationDurationMs) || narrationDurationMs <= 0
    || !Number.isFinite(lastCueEndMs) || lastCueEndMs <= 0) {
    throw new Error("整集结尾缺少合法内容结束时间");
  }
  if (typeof afterSegmentId !== "string" || !afterSegmentId) {
    throw new Error("整集结尾缺少最终片段身份");
  }
  if (afterSegmentType !== "body") {
    throw new Error("整集结尾最终片段类型无效");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("整集结尾缺少合法帧率");
  }
  const timing = episodeEndingTiming({ narrationDurationMs, lastCueEndMs, fps });
  return {
    afterSegmentId,
    afterSegmentType,
    startMs: bodyOffsetMs + timing.fadeStartFrame / fps * 1000,
    fadeEndMs: bodyOffsetMs + timing.fadeEndFrame / fps * 1000,
    endMs: bodyOffsetMs + timing.endFrame / fps * 1000,
    fadeFrames: timing.fadeFrames,
    motionTailFrames: timing.motionTailFrames
  };
};

export const endingWindowForSegment = ({ ending, startFrame, anchorMs, fps }) => {
  const fadeEndFrame = anchoredFrameForMs({ milliseconds: ending.fadeEndMs, anchorMs, fps }) - startFrame;
  return {
    fadeStartSeconds: (fadeEndFrame - ending.fadeFrames) / fps,
    fadeEndSeconds: fadeEndFrame / fps,
    motionTailFrames: ending.motionTailFrames
  };
};
