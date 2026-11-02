const visibleText = (text) => [...String(text ?? "")].filter((c) => !/\s/u.test(c)).join("");
const contentText = (text) => [...String(text ?? "").normalize("NFKC")]
  // ASR的百分号携带真实话语时间，不得当作无声标点丢弃。
  .filter((c) => /[\p{L}\p{N}%‰‱]/u.test(c)).join("");
export const contentLength = (text) => [...contentText(text)].length;
export const withoutWhitespace = visibleText;

export const normalizeWordTimeline = (cues, label = "词级时间轴") => {
  if (!Array.isArray(cues) || !cues.length) throw new Error(`${label}为空`);
  let previousEnd = -1;
  const all = cues.map((cue, index) => {
    const { text, startMs, endMs } = cue ?? {};
    if (typeof text !== "string" || !text.trim() || !Number.isInteger(startMs) || !Number.isInteger(endMs)
      || startMs < 0 || endMs < startMs || (endMs === startMs && contentLength(text)) || startMs < previousEnd) {
      throw new Error(`${label}第 ${index + 1} 项无效`);
    }
    previousEnd = endMs;
    return { text, startMs, endMs };
  });
  const spoken = all.map((cue) => ({ ...cue, content: contentText(cue.text) })).filter((cue) => cue.content);
  if (!spoken.length) throw new Error(`${label}没有可发音正文`);
  return { all, spoken };
};

export const nativeWordCues = (timing) => {
  if (timing?.source !== "provider-native" || timing?.granularity !== "word"
    || typeof timing.provider !== "string" || !timing.provider) return null;
  try {
    return normalizeWordTimeline(timing.cues, "TTS原生词级时间轴").all;
  } catch {
    return null;
  }
};

const narrationMap = (narration) => {
  const visible = [...visibleText(narration)];
  const boundaries = [0];
  let count = 0;
  for (let i = 0; i < visible.length; i += 1) {
    if (!contentLength(visible[i])) continue;
    if (count) {
      let start = i;
      // 前引号、书名号及左括号归随后正文；句末标点归前句。
      while (start > boundaries.at(-1) && /[“‘「『《〈（【\[(]/u.test(visible[start - 1])) start -= 1;
      boundaries.push(start);
    }
    count += contentLength(visible[i]);
  }
  boundaries.push(visible.length);
  if (boundaries.length !== count + 1) throw new Error("原文含无法直接切片的兼容字符");
  return { visible, boundaries, content: [...contentText(narration)] };
};

// 顺序编辑对齐只确定原文区间对应哪些实测词；从不插值或修改时间。
const alignContent = (source, target, allowRecognitionDifferences) => {
  const boundaries = new Map();
  if (source.join("") === target.join("")) {
    for (let i = 0; i <= source.length; i += 1) boundaries.set(i, i);
    return { boundaries, differences: [] };
  }
  if (!allowRecognitionDifferences) throw new Error("词级时间轴正文与正式口播不一致，不能按时间起点吞补漏字");
  const width = target.length + 1;
  const costs = new Uint32Array((source.length + 1) * width);
  for (let i = 0; i <= source.length; i += 1) costs[i * width] = i;
  for (let j = 0; j <= target.length; j += 1) costs[j] = j;
  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      costs[i * width + j] = Math.min(
        costs[(i - 1) * width + j - 1] + Number(source[i - 1] !== target[j - 1]),
        costs[(i - 1) * width + j] + 1, costs[i * width + j - 1] + 1
      );
    }
  }
  if (costs.at(-1) / Math.max(source.length, target.length) > 0.15) {
    throw new Error("云端识别与正文差异过大，不能可靠绑定当前音频");
  }
  const steps = [];
  let i = source.length; let j = target.length;
  while (i || j) {
    const value = costs[i * width + j];
    if (i && j && value === costs[(i - 1) * width + j - 1] + Number(source[i - 1] !== target[j - 1])) {
      steps.push({ equal: source[i - 1] === target[j - 1], i0: i - 1, i1: i, j0: j - 1, j1: j }); i -= 1; j -= 1;
    } else if (i && value === costs[(i - 1) * width + j] + 1) {
      steps.push({ equal: false, i0: i - 1, i1: i, j0: j, j1: j }); i -= 1;
    } else {
      steps.push({ equal: false, i0: i, i1: i, j0: j - 1, j1: j }); j -= 1;
    }
  }
  const groups = [];
  for (const step of steps.reverse()) {
    const last = groups.at(-1);
    if (last?.equal === step.equal) { last.i1 = step.i1; last.j1 = step.j1; }
    else groups.push({ ...step });
  }
  const differences = [];
  for (const group of groups) {
    if (group.equal) {
      for (let k = 0; k <= group.i1 - group.i0; k += 1) boundaries.set(group.i0 + k, group.j0 + k);
    } else {
      boundaries.set(group.i0, group.j0);
      boundaries.set(group.i1, group.j1);
      differences.push({ start: group.i0, end: group.i1, wordStart: group.j0, wordEnd: group.j1,
        narration: source.slice(group.i0, group.i1).join(""), recognized: target.slice(group.j0, group.j1).join("") });
    }
  }
  // 纯增删不能当成一句完整话的边界，必须连同两侧可靠文字一起核对。
  for (const group of groups.filter((g) => !g.equal && (g.i0 === g.i1 || g.j0 === g.j1))) {
    boundaries.delete(group.i0); boundaries.delete(group.i1);
  }
  return { boundaries, differences };
};

export const alignWordTimeline = ({ wordCues, narration, allowRecognitionDifferences = false }) => {
  const { spoken } = normalizeWordTimeline(wordCues);
  const map = narrationMap(narration);
  const offsets = [0];
  for (const cue of spoken) offsets.push(offsets.at(-1) + [...cue.content].length);
  const wordBoundaries = new Map(offsets.map((offset, index) => [offset, index]));
  const alignment = alignContent(map.content, [...spoken.map((cue) => cue.content).join("")], allowRecognitionDifferences);
  const wordIndex = (offset) => {
    const target = alignment.boundaries.get(offset);
    if (target === undefined || !wordBoundaries.has(target)) {
      throw new Error(`原文第 ${offset} 字后的断点位于识别差异或同一词内部，请合并相邻句或另选真实断点`);
    }
    return wordBoundaries.get(target);
  };
  const project = (start, end) => {
    const first = wordIndex(start); const after = wordIndex(end);
    if (after <= first) throw new Error("字幕没有对应的实际话语");
    return { text: map.visible.slice(map.boundaries[start], map.boundaries[end]).join(""),
      startMs: spoken[first].startMs, endMs: spoken[after - 1].endMs };
  };
  const projectPhrases = (start, end) => {
    wordIndex(start); wordIndex(end);
    const cuts = [start, ...[...alignment.boundaries]
      .filter(([offset, target]) => offset > start && offset < end && wordBoundaries.has(target))
      .map(([offset]) => offset).sort((a, b) => a - b), end];
    return cuts.slice(1).map((after, index) => project(cuts[index], after));
  };
  return { project, projectPhrases, differences: alignment.differences, contentCount: map.content.length };
};

// Preserve measured word boundaries; an ASR difference may form one indivisible phrase.
export const projectSpeechCues = ({ wordCues, narration, cues, allowRecognitionDifferences = false }) => {
  const alignment = alignWordTimeline({wordCues, narration, allowRecognitionDifferences});
  let start = 0;
  const result = cues.map((cue, index) => {
    const end = start + contentLength(cue.text);
    const phrases = alignment.projectPhrases(start, end);
    start = end;
    return {cueId: index + 1, phrases};
  });
  if (start !== alignment.contentCount) throw new Error('短语时间没有覆盖完整正式口播');
  return result;
};

export const narrationBreaks = (narration) => {
  const map = narrationMap(narration);
  const result = [];
  for (let i = 1; i < map.content.length; i += 1) {
    const between = map.visible.slice(map.boundaries[i - 1], map.boundaries[i]).join("");
    // 逗号、分号和冒号只提供可选分句位置，不自动切换字幕。
    if (/[。！？!?]/u.test(between)) result.push(i);
  }
  return result;
};

export const projectSubtitleCues = ({ wordCues, narration, maxContentChars, mergeAfter = [], breakAt = [], allowRecognitionDifferences = false }) => {
  const alignment = alignWordTimeline({ wordCues, narration, allowRecognitionDifferences });
  const sentenceBreaks = narrationBreaks(narration);
  if (breakAt.some((b) => !Number.isInteger(b) || b <= 0 || b >= alignment.contentCount)) throw new Error("原文断点无效");
  const merges = new Set(mergeAfter);
  if ([...merges].some((b) => !Number.isInteger(b) || b < 1 || b > sentenceBreaks.length)) throw new Error("相邻合并序号无效");
  // 合并序号始终指向原稿句末，不随新增断点漂移。
  const breaks = [...new Set([...sentenceBreaks.filter((_, index) => !merges.has(index + 1)), ...breakAt])].sort((a, b) => a - b);
  const ends = [...breaks, alignment.contentCount];
  let start = 0;
  return ends.map((end, index) => {
    const cue = alignment.project(start, end); start = end;
    if (!contentLength(cue.text) || contentLength(cue.text) > maxContentChars) {
      throw new Error(`字幕 ${index + 1} 超过 ${maxContentChars} 字，请按完整语义选择 --break-at 原文字位`);
    }
    return cue;
  });
};

export const subtitleTimingErrors = ({ cues, wordCues, narration, allowRecognitionDifferences = false }) => {
  try {
    const alignment = alignWordTimeline({ wordCues, narration, allowRecognitionDifferences });
    if (!Array.isArray(cues) || !cues.length) return ["字幕为空"];
    let start = 0;
    const errors = [];
    for (const [index, cue] of cues.entries()) {
      const end = start + contentLength(cue.text);
      const expected = alignment.project(start, end); start = end;
      if (cue.text !== expected.text) errors.push(`字幕 ${index + 1} 没有按正式正文切片，文字或标点归属错误`);
      if (cue.startMs !== expected.startMs || cue.endMs !== expected.endMs) {
        errors.push(`字幕 ${index + 1} 的文字应绑定 ${expected.startMs}-${expected.endMs}ms，实际 ${cue.startMs}-${cue.endMs}ms`);
      }
    }
    if (start !== alignment.contentCount || visibleText(cues.map((c) => c.text).join("")) !== visibleText(narration)) {
      errors.push("字幕必须消费完整时间轴并逐字保留正式正文和标点");
    }
    return errors;
  } catch (error) { return [error.message]; }
};
