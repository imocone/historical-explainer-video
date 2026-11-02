import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteData, readData, sha256 } from "../../program-utils.mjs";
import { measureCaptions } from "../render-video/runtime/measure-captions.mjs";
import {
  alignWordTimeline,
  contentLength,
  nativeWordCues,
  narrationBreaks,
  normalizeWordTimeline,
  projectSubtitleCues,
  subtitleTimingErrors,
  withoutWhitespace
} from "./subtitle-timing.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_CONTENT_CHARS = 32;

const fail = (message) => { throw new Error(message); };

const relativeParts = (value, label) => {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) fail(`${label}缺失或不是相对路径`);
  const normalized = value.split("/");
  if (normalized.some((part) => !part || part === "." || part === "..") || normalized.join("/") !== value) {
    fail(`${label}不是规范相对路径`);
  }
  return normalized;
};

const loadContext = async (workOrderFile) => {
  const workOrderPath = path.resolve(workOrderFile);
  const info = await lstat(workOrderPath);
  if (!info.isFile() || info.isSymbolicLink() || path.basename(workOrderPath) !== "work-order.yaml") {
    fail("必须提供当前非符号链接work-order.yaml");
  }
  const workOrder = await readData(workOrderPath);
  const identity = [workOrder.runner, workOrder.workflowId, workOrder.stageId, workOrder.nodeId, workOrder.moduleId].join("/");
  if (identity !== "ai/narration/p2/author-subtitles/author-subtitles") fail("工作单不是当前P2字幕任务");
  if (!SHA256.test(workOrder.taskDigest ?? "") || !SHA256.test(workOrder.executionId ?? "")) {
    fail("工作单缺少合法任务身份");
  }
  const candidateParts = relativeParts(workOrder.candidatePath, "candidatePath");
  const scratchParts = relativeParts(workOrder.scratchPath, "scratchPath");
  if (candidateParts.at(-1) !== "candidate.yaml") fail("candidatePath必须指向candidate.yaml");
  const candidateParent = candidateParts.slice(0, -1);
  if (scratchParts.join("/") !== [...candidateParent, `attempt-${workOrder.executionId}`].join("/")) {
    fail("scratchPath没有绑定当前executionId");
  }
  let workspaceRoot = path.dirname(workOrderPath);
  for (const _ of candidateParent) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, ...candidateParent, "work-order.yaml") !== workOrderPath) {
    fail("工作单位置与candidatePath不一致");
  }
  const candidatePath = path.resolve(workspaceRoot, ...candidateParts);
  const scratchPath = path.resolve(workspaceRoot, ...scratchParts);
  let current = workspaceRoot;
  for (const part of scratchParts) {
    current = path.join(current, part);
    const currentInfo = await lstat(current).catch(() => null);
    if (currentInfo?.isSymbolicLink()) fail("scratchPath不得包含符号链接");
  }
  await mkdir(scratchPath, { recursive: true });
  const scriptPackage = workOrder.inputs?.scriptPackage;
  const ttsResult = workOrder.inputs?.ttsResult;
  const narration = scriptPackage?.narration;
  if (typeof narration !== "string" || !narration
    || withoutWhitespace(ttsResult?.ttsInput?.text) !== withoutWhitespace(narration)
    || scriptPackage.episodeId !== ttsResult?.episodeId) {
    fail("正式口播、TTS文字或剧集身份不一致");
  }
  const audioPath = path.join(workspaceRoot, ...candidateParent.slice(0, -1), ttsResult.rawAudio.path);
  if (sha256(await readFile(audioPath)) !== ttsResult.rawAudio.sha256) fail("音频摘要与TTS结果不一致");
  return { workOrder, workspaceRoot, candidatePath, scratchPath, scriptPackage, ttsResult, narration };
};

const srtMilliseconds = (value) => {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u.exec(value);
  if (!match) fail(`SRT时间无效: ${value}`);
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
};

const parseSrt = (text) => text.trim().split(/\r?\n\s*\r?\n/u).map((block, index) => {
  const lines = block.split(/\r?\n/u);
  const timing = lines[1]?.split(" --> ");
  const cueText = lines.slice(2).join("").trim();
  if (timing?.length !== 2 || !cueText) fail(`SRT第 ${index + 1} 条无效`);
  return { startMs: srtMilliseconds(timing[0]), endMs: srtMilliseconds(timing[1]), text: cueText };
});

const srtTimestamp = (milliseconds) => {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
};

const srt = (cues) => cues.map((cue, index) => (
  `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}`
)).join("\n\n") + "\n";

export const prepareSubtitleInput = async (workOrderPath) => {
  const context = await loadContext(workOrderPath);
  const reused = context.workOrder.inputs?.reusedSubtitleTiming;
  if (reused) {
    if (reused.audioSha256 !== context.ttsResult.rawAudio.sha256
      || reused.narrationSha256 !== sha256(context.narration)) fail("返工时间证据没有绑定当前正文与音频");
    const timing = reused.timingSource;
    if (timing?.kind === "video-captioner-asr") {
      if (timing.provider !== "video-captioner" || timing.granularity !== "word"
        || !["BIJIAN", "JIANYING"].includes(timing.requestedModel)
        || !["BIJIAN", "JIANYING"].includes(timing.actualModel)
        || !timing.nativeTimingIssue?.trim()) fail("返工云端时间证据无效");
      const cues = normalizeWordTimeline(timing.wordCues).all;
      alignWordTimeline({ wordCues: cues, narration: context.narration, allowRecognitionDifferences: true });
      const output = path.join(context.scratchPath, "raw-asr.srt");
      await writeFile(output, srt(cues));
      return { route: timing.kind, output, cueCount: cues.length, restored: true,
        nativeTimingIssue: timing.nativeTimingIssue,
        requestedModel: timing.requestedModel, actualModel: timing.actualModel };
    }
    if (timing?.kind !== "provider-native") fail("返工时间来源无效");
  }
  const cues = nativeWordCues(context.ttsResult?.nativeTiming);
  if (!cues) fail("当前TTS没有原生词级时间轴，应由VideoCaptioner ASR形成raw-asr.srt");
  const output = path.join(context.scratchPath, "raw-word.srt");
  await writeFile(output, srt(cues));
  return { route: "provider-native", output, cueCount: cues.length };
};

const parseMergeAfter = (value) => {
  if (!value) return [];
  return value.split(",").map((item) => Number(item.trim()));
};

// 这些数值只提示当前作者复核，不替作者判断语义，也不改动时间。
const readingInspection = (cues, narration, layouts) => {
  const sentenceEnds = new Set(narrationBreaks(narration));
  let offset = 0;
  return cues.map((cue, index) => {
    const contentStart = offset;
    const possibleBreaks = [];
    for (const character of cue.text) {
      offset += contentLength(character);
      if (/[，,；;：:]/u.test(character) && offset > contentStart
        && offset < contentStart + contentLength(cue.text)) possibleBreaks.push(offset);
    }
    const durationMs = cue.endMs - cue.startMs;
    const visibleChars = [...withoutWhitespace(cue.text)].length;
    const readingSpeed = visibleChars * 1000 / durationMs;
    const next = cues[index + 1];
    const hints = [];
    if (contentLength(cue.text) > MAX_CONTENT_CHARS) hints.push("超过正文上限，选择完整分句断点后重建");
    if (layouts[index].lineCount > 2) hints.push("当前字体和成片排版超过两行，选择完整分句断点后重建");
    if (layouts[index].overflow) hints.push("当前排版超出字幕显示范围，选择完整分句断点后重建");
    if (durationMs < 1000) hints.push("显示不足1秒，检查闪换及与邻句合并的可能");
    if (durationMs > 7000) hints.push("显示超过7秒，结合停顿检查是否需要分句");
    if (readingSpeed > 9) hints.push("超过9个可见字符/秒，复核可读性及真实声音同步");
    if (next && !sentenceEnds.has(offset)
      && contentLength(cue.text + next.text) <= MAX_CONTENT_CHARS
      && next.endMs - cue.startMs <= 7000 && next.startMs - cue.endMs < 1000) {
      hints.push("与下一条仍属同一句且合并未超长度/时长参考，优先复核是否应删去此断点");
    }
    return { cue: index + 1, text: cue.text, contentStart, contentEnd: offset,
      startMs: cue.startMs, endMs: cue.endMs, durationMs,
      visibleChars, charsPerSecond: Math.round(readingSpeed * 100) / 100,
      gapBeforeMs: index ? cue.startMs - cues[index - 1].endMs : cue.startMs,
      layout: layouts[index], possibleBreaks, hints };
  });
};

export const buildSubtitleCandidate = async ({
  workOrderPath,
  mergeAfter = [],
  breakAt = [],
  timingRoute = "native",
  nativeTimingIssue = "",
  inspect = false,
  requestedModel = "BIJIAN",
  actualModel = "BIJIAN"
}) => {
  if (!["BIJIAN", "JIANYING"].includes(requestedModel)
    || !["BIJIAN", "JIANYING"].includes(actualModel)) {
    fail("备用ASR模型只能是BIJIAN或JIANYING");
  }
  const context = await loadContext(workOrderPath);
  if (!["native", "asr"].includes(timingRoute)) fail("时间来源必须为native或asr");
  const native = timingRoute === "native" ? nativeWordCues(context.ttsResult?.nativeTiming) : null;
  if (timingRoute === "native" && !native) fail("原生时间无效，请说明原因并使用现有云端ASR");
  if (!native && !nativeTimingIssue.trim()) fail("云端路线必须说明原生时间缺失或不符音频的具体原因");
  const wordCues = native ?? parseSrt(await readFile(path.join(context.scratchPath, "raw-asr.srt"), "utf8"));
  const allowRecognitionDifferences = !native;
  const alignment = alignWordTimeline({ wordCues, narration: context.narration, allowRecognitionDifferences });
  if (inspect) {
    const candidate = await readData(context.candidatePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (candidate && (candidate.taskDigest !== context.workOrder.taskDigest
      || candidate.result?.narrationSha256 !== sha256(context.narration)
      || candidate.result?.evidence?.audioSha256 !== context.ttsResult.rawAudio.sha256)) {
      fail("当前候选不属于本工作单、正文或音频，不能复核");
    }
    const source = candidate ? "current-candidate" : "sentence-preview";
    let cues;
    let bindingErrors;
    try {
      cues = candidate ? candidate.result.cues : projectSubtitleCues({
        wordCues, narration: context.narration, maxContentChars: Infinity,
        mergeAfter, breakAt, allowRecognitionDifferences
      });
      bindingErrors = subtitleTimingErrors({ cues, wordCues, narration: context.narration, allowRecognitionDifferences });
    } catch (error) {
      return { source, differences: alignment.differences, wordCueCount: wordCues.length,
        bindingErrors: [error.message], cues: [] };
    }
    const { layouts, ...display } = await measureCaptions({
      systemRoot: fileURLToPath(new URL("../../../", import.meta.url)), workspaceRoot: context.workspaceRoot, cues
    });
    return { source, differences: alignment.differences, wordCueCount: wordCues.length,
      bindingErrors, display, cues: readingInspection(cues, context.narration, layouts) };
  }
  const cues = projectSubtitleCues({
    wordCues,
    narration: context.narration,
    maxContentChars: MAX_CONTENT_CHARS,
    mergeAfter,
    breakAt,
    allowRecognitionDifferences
  });
  const timingSource = native
    ? {
        kind: "provider-native",
        provider: context.ttsResult.nativeTiming.provider,
        granularity: "word"
      }
    : {
        kind: "video-captioner-asr",
        provider: "video-captioner",
        granularity: "word",
        requestedModel,
        actualModel,
        fallbackOccurred: requestedModel !== actualModel,
        wordCues,
        nativeTimingIssue
      };
  const operations = [
    "system:narration-segmentation",
    "system:narration-projection",
    "translation:disabled",
    ...(!native ? [`transcribe:${actualModel.toLowerCase()}`] : [])
  ];
  const candidate = {
    taskDigest: context.workOrder.taskDigest,
    result: {
      schemaVersion: "3.0",
      episodeId: context.scriptPackage.episodeId,
      language: "zh-CN",
      narrationSha256: sha256(context.narration),
      maxContentChars: MAX_CONTENT_CHARS,
      cues,
      evidence: { operations, timingSource, audioSha256: context.ttsResult.rawAudio.sha256 }
    }
  };
  await atomicWriteData(context.candidatePath, candidate);
  return { candidatePath: context.candidatePath, cueCount: cues.length, mergeAfter };
};

const main = async () => {
  const [command, workOrderPath, ...args] = process.argv.slice(2);
  if (!command || !workOrderPath || !["prepare", "build", "inspect"].includes(command)) {
    fail("用法: node build-candidate.mjs <prepare|build|inspect> <workOrderPath> [--merge-after 1,2] [--break-at 原文字位] [--timing-source native|asr] [--native-timing-issue 原因]");
  }
  if (command === "prepare") return prepareSubtitleInput(workOrderPath);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return buildSubtitleCandidate({
    workOrderPath,
    mergeAfter: parseMergeAfter(option("--merge-after")),
    breakAt: parseMergeAfter(option("--break-at")),
    timingRoute: option("--timing-source") ?? "native",
    nativeTimingIssue: option("--native-timing-issue") ?? "",
    inspect: command === "inspect",
    requestedModel: option("--requested-model") ?? "BIJIAN",
    actualModel: option("--actual-model") ?? "BIJIAN"
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
