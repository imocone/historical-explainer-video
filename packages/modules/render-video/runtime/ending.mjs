export const EPISODE_ENDING_POLICY = Object.freeze({
  holdSeconds: 0.5,
  fadeSeconds: 2.5
});

export const buildEpisodeEnding = ({
  contentEndMs,
  afterSegmentId,
  afterSegmentType,
  fps
}) => {
  if (!Number.isFinite(contentEndMs) || contentEndMs <= 0) {
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
  const holdFrames = Math.round(EPISODE_ENDING_POLICY.holdSeconds * fps);
  const fadeFrames = Math.round(EPISODE_ENDING_POLICY.fadeSeconds * fps);
  const durationInFrames = holdFrames + fadeFrames;
  return {
    afterSegmentId,
    afterSegmentType,
    startMs: contentEndMs,
    holdFrames,
    fadeFrames,
    durationMs: durationInFrames / fps * 1000
  };
};

export const endingDurationInFrames = (ending) => {
  if (!ending || !Number.isInteger(ending.holdFrames) || ending.holdFrames < 0
    || !Number.isInteger(ending.fadeFrames) || ending.fadeFrames < 1) {
    throw new Error("整集结尾帧数无效");
  }
  return ending.holdFrames + ending.fadeFrames;
};
