import { sha256 } from "../../program-utils.mjs";
import {
  contentLength,
  nativeWordCues,
  subtitleTimingErrors,
  withoutWhitespace
} from "./subtitle-timing.mjs";

const usableNativeTiming = (timing) => {
  const cues = nativeWordCues(timing);
  if (!cues) return null;
  try {
    return { ...timing, cues };
  } catch {
    return null;
  }
};

export function validate({ result, context = {} }) {
  const errors = [];
  const narration = context.scriptPackage?.narration;
  const ttsText = context.ttsResult?.ttsInput?.text;
  if (typeof narration !== "string" || !narration) errors.push("字幕校正缺少正式口播底稿");
  if (typeof ttsText !== "string"
    || typeof narration !== "string"
    || withoutWhitespace(ttsText) !== withoutWhitespace(narration)) {
    errors.push("TTS文字与正式口播底稿的可见正文不一致");
  }
  if (context.scriptPackage?.episodeId && result.episodeId !== context.scriptPackage.episodeId) {
    errors.push("字幕校正 episodeId 与正式口播不一致");
  }
  if (typeof narration === "string" && result.narrationSha256 !== sha256(narration)) {
    errors.push("字幕校正没有绑定完整正式口播底稿");
  }
  const cues = Array.isArray(result.cues) ? result.cues : [];
  if (cues.length && cues[0].startMs > 500) {
    errors.push(`字幕起点 ${cues[0].startMs}ms 未覆盖音频开头`);
  }
  let previousEnd = -1;
  for (const [index, cue] of cues.entries()) {
    if (typeof cue.text !== "string" || cue.text.trim() !== cue.text || /[\r\n]/u.test(cue.text)) {
      errors.push(`字幕 ${index + 1} 必须是无首尾空白的单行正文`);
    }
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs)
      || cue.startMs < 0 || cue.endMs <= cue.startMs || cue.startMs < previousEnd) {
      errors.push(`字幕 ${index + 1} 时间段无效或与前一条重叠`);
    }
    previousEnd = cue.endMs;
    if (typeof cue.text === "string" && contentLength(cue.text) > result.maxContentChars) {
      errors.push(`字幕 ${index + 1} 超过 ${result.maxContentChars} 个正文字符`);
    }
  }
  if (typeof narration === "string"
    && withoutWhitespace(cues.map((cue) => cue.text ?? "").join("")) !== withoutWhitespace(narration)) {
    errors.push("字幕全文必须与正式口播底稿逐字一致并保留全部标点");
  }
  const operations = new Set(result.evidence?.operations ?? []);
  for (const required of [
    "system:narration-segmentation",
    "system:narration-projection",
    "translation:disabled"
  ]) {
    if (!operations.has(required)) errors.push(`字幕校正证据缺少 ${required}`);
  }
  if (["agy:subtitle-review", "codex:subtitle-review", 'claude:subtitle-review'].filter((operation) => operations.has(operation)).length !== 1) {
    errors.push("字幕校正必须记录唯一实际复核执行者：agy、codex或claude的subtitle-review");
  }
  if (result.evidence?.audioSha256 !== context.ttsResult?.rawAudio?.sha256) errors.push("字幕时间证据没有绑定当前音频摘要");
  const timing = result.evidence?.timingSource;
  const nativeTiming = usableNativeTiming(context.ttsResult?.nativeTiming);
  if (timing?.kind === "provider-native") {
    if (!nativeTiming || timing.provider !== nativeTiming.provider || timing.granularity !== "word"
      || [...operations].some((operation) => operation.startsWith("transcribe:"))) errors.push("原生词级时间证据无效");
  } else if (timing?.kind !== "video-captioner-asr" || timing.provider !== "video-captioner"
    || timing.granularity !== "word" || !["BIJIAN", "JIANYING"].includes(timing.requestedModel)
    || !["BIJIAN", "JIANYING"].includes(timing.actualModel)
    || timing.fallbackOccurred !== (timing.actualModel !== timing.requestedModel)
    || typeof timing.nativeTimingIssue !== "string" || !timing.nativeTimingIssue.trim()
    || !Array.isArray(timing.wordCues) || !timing.wordCues.length
    || !operations.has(`transcribe:${timing.actualModel.toLowerCase()}`)) {
    errors.push("云端词级时间证据或原生时间弃用原因无效");
  }
  const wordCues = timing?.kind === "provider-native" ? nativeTiming?.cues : timing?.wordCues;
  if (wordCues) errors.push(...subtitleTimingErrors({ cues, wordCues, narration,
    allowRecognitionDifferences: timing?.kind === "video-captioner-asr" }));
  return errors;
}
