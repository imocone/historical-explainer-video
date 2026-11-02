const assertDuration = (targetDurationMs) => {
  if (!Number.isInteger(targetDurationMs) || targetDurationMs < 1) {
    throw new Error("全画幅 targetDurationMs 必须为正整数");
  }
};

const singleA = ["A"];
const pairedAB = ["A", "B"];
const sameFrames = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const assertFullframeFramePolicy = ({
  targetDurationMs,
  frameIds,
  label = "全画幅 Beat"
}) => {
  assertDuration(targetDurationMs);
  if (!sameFrames(frameIds, singleA) && !sameFrames(frameIds, pairedAB)) {
    throw new Error(`${label} 只允许单A或A/B`);
  }
  // P3 checks the actual cue boundaries; downstream consumers preserve its frame choice.
};
