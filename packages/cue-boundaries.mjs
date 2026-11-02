import { frameForMs, frameSpanForMs } from "./video-spec.mjs";

const cueKey = (value) => String(value);

export const validateCues = (cues = []) => {
  if (!Array.isArray(cues)) return ["cues 必须是数组"];
  const errors = [];
  const ids = new Set();
  let previousEndMs = -1;
  for (const [index, cue] of cues.entries()) {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
      errors.push(`cue ${index + 1} 必须是对象`);
      continue;
    }
    const id = cueKey(cue.id);
    if (!id || id === "undefined" || id === "null") errors.push(`cue ${index + 1} 缺少 id`);
    else if (ids.has(id)) errors.push(`cue id 重复: ${cue.id}`);
    else ids.add(id);
    if (typeof cue.text !== "string" || !cue.text.trim()) errors.push(`cue ${cue.id} 文字为空`);
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.endMs <= cue.startMs) {
      errors.push(`cue ${cue.id} 起止时间无效`);
      continue;
    }
    if (cue.startMs < previousEndMs) errors.push(`cue ${cue.id} 与前项重叠或乱序`);
    previousEndMs = cue.endMs;
  }
  return errors;
};

export const resolveCueBoundary = ({ cueId, edge, cues = [] }) => {
  if (edge !== "start" && edge !== "end") throw new Error(`cue edge 只允许 start/end: ${edge}`);
  const matches = cues.filter((cue) => cueKey(cue.id) === cueKey(cueId));
  if (matches.length !== 1) throw new Error(`cueId 必须唯一存在: ${cueId}（实际 ${matches.length} 项）`);
  const cue = matches[0];
  const timeMs = edge === "start" ? cue.startMs : cue.endMs;
  if (!Number.isInteger(timeMs)) throw new Error(`cue ${cueId}.${edge} 不是整数毫秒`);
  return { cue, timeMs };
};

export const resolveCueRange = ({ cueRange, cues = [] }) => {
  if (!Array.isArray(cueRange) || cueRange.length !== 2) {
    throw new Error("cueRange 必须恰好包含首尾两个 cueId");
  }
  const cueErrors = validateCues(cues);
  if (cueErrors.length > 0) throw new Error(`cues 无法解析范围: ${cueErrors.join("; ")}`);
  const [firstCueId, lastCueId] = cueRange;
  const firstMatches = cues.filter((cue) => cueKey(cue.id) === cueKey(firstCueId));
  const lastMatches = cues.filter((cue) => cueKey(cue.id) === cueKey(lastCueId));
  if (firstMatches.length !== 1) {
    throw new Error(`cueRange 起点必须唯一存在: ${firstCueId}（实际 ${firstMatches.length} 项）`);
  }
  if (lastMatches.length !== 1) {
    throw new Error(`cueRange 终点必须唯一存在: ${lastCueId}（实际 ${lastMatches.length} 项）`);
  }
  const firstCue = firstMatches[0];
  const lastCue = lastMatches[0];
  const firstIndex = cues.indexOf(firstCue);
  const lastIndex = cues.indexOf(lastCue);
  if (firstIndex > lastIndex) throw new Error(`cueRange 首尾顺序错误: ${firstCueId} -> ${lastCueId}`);
  const startMs = firstCue.startMs;
  const endMs = lastCue.endMs;
  const durationMs = endMs - startMs;
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || durationMs <= 0) {
    throw new Error(`cueRange 时间范围无效: ${firstCueId} -> ${lastCueId}`);
  }
  return {
    firstCue,
    lastCue,
    cues: cues.slice(firstIndex, lastIndex + 1),
    startMs,
    endMs,
    durationMs
  };
};

export const frameForTime = ({ timeMs, segmentStartMs, segmentEndMs, fps }) => {
  if (![timeMs, segmentStartMs, segmentEndMs, fps].every(Number.isFinite)) {
    throw new Error("时间转帧参数必须是有限数字");
  }
  if (segmentEndMs <= segmentStartMs || fps <= 0) throw new Error("片段时间或帧率无效");
  if (timeMs < segmentStartMs || timeMs > segmentEndMs) throw new Error("cue 边界超出当前片段");
  const durationInFrames = frameSpanForMs({ startMs: segmentStartMs, endMs: segmentEndMs, fps });
  const frame = frameForMs({ milliseconds: timeMs, fps })
    - frameForMs({ milliseconds: segmentStartMs, fps });
  return Math.max(0, Math.min(durationInFrames - 1, frame));
};

export const resolveCueBindingsToFrames = ({
  bindingSet,
  cues,
  segmentStartMs,
  segmentEndMs,
  fps
}) => (bindingSet?.items ?? []).map((binding) => {
  const { timeMs } = resolveCueBoundary({
    cueId: binding.cueId,
    edge: binding.edge,
    cues
  });
  return {
    target: binding.target,
    action: binding.action,
    frame: frameForTime({ timeMs, segmentStartMs, segmentEndMs, fps })
  };
});
