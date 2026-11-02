import { validate as validateSubtitles } from "../author-subtitles/validate.mjs";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMediaProcess, withMediaResources } from "../render-video/runtime/media-process.mjs";
import {
  assertProjectMutationTree,
  atomicWrite,
  atomicWriteData,
  fileSha256,
  hashObject,
  programProducer,
  readData,
  sha256
} from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import {
  contentLength,
  nativeWordCues,
  projectSpeechCues,
  withoutWhitespace
} from "../author-subtitles/subtitle-timing.mjs";

const audioContractUrl = new URL("./audio-delivery-contract.json", import.meta.url);
const subtitleContractUrl = new URL("./subtitle-contract.json", import.meta.url);
const exists = (file) => access(file).then(() => true, () => false);
const MAX_SUBTITLE_END_OVERRUN_MS = 5;

const runCommand = (command, args, directory, timeoutMs = 10 * 60_000) => withMediaResources(
  () => runMediaProcess(command, args, { capture: true, timeoutMs }), { directory }
);
const ffmpegOptions = ["-hide_banner", "-nostdin", "-nostats", "-threads", "2", "-filter_threads", "1"];

const pathsFor = ({ root, episodeId, task = {} }) => {
  const episodePaths = getEpisodePaths(root, episodeId);
  const p2 = episodePaths.p2;
  const expectedPackage = path.join(p2, "narration-package.yaml");
  const packagePath = task.outputPath
    ? (path.isAbsolute(task.outputPath) ? path.resolve(task.outputPath) : path.resolve(root, task.outputPath))
    : expectedPackage;
  if (packagePath !== path.resolve(expectedPackage)) {
    throw new Error("finalize-narration 的 outputPath 不是当前剧集正式口播交接包");
  }
  return {
    p2,
    scriptPackage: episodePaths.scriptPackage,
    ttsResult: path.join(p2, "tts-result.yaml"),
    subtitleCorrection: path.join(p2, "subtitle-correction.yaml"),
    raw: path.join(p2, "raw-narration.flac"),
    package: packagePath,
    work: getStageWorkPaths(episodePaths, "p2").work
  };
};

const canonicalText = (text) => {
  if (typeof text !== "string") throw new Error("tts-result.ttsInput.text 必须是文本");
  const canonical = text.replace(/\r\n?/gu, "\n").replace(/\n$/u, "");
  if (!canonical) throw new Error("tts-result.ttsInput.text 不能为空");
  return canonical;
};

const resultFromTask = async ({ paths, task }) => {
  const supplied = task?.inputs?.ttsResult ?? task?.context?.ttsResult;
  return supplied && typeof supplied === "object" ? supplied : readData(paths.ttsResult);
};

const correctionFromTask = async ({ paths, task }) => {
  const supplied = task?.inputs?.subtitleCorrection ?? task?.context?.subtitleCorrection;
  return supplied && typeof supplied === "object" ? supplied : readData(paths.subtitleCorrection);
};

const scriptFromTask = async ({ paths, task }) => {
  const supplied = task?.inputs?.scriptPackage ?? task?.context?.scriptPackage;
  return supplied && typeof supplied === "object" ? supplied : readData(paths.scriptPackage);
};

const assertClosedFields = (value, label, fields) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unexpected.length || missing.length) {
    throw new Error(`${label}字段不完整或包含未知字段: ${[...missing, ...unexpected].join(", ")}`);
  }
};

const finiteRange = (value, { minimum, maximum, label, integer = false }) => {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
    throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的${integer ? "整数" : "有限数"}`);
  }
};

const validateAudioContract = (contract) => {
  assertClosedFields(contract, "音频合同", [
    "schemaVersion", "outputFormat", "sampleRate", "channels", "maxDurationDriftSeconds",
    "maxLoudnessDriftLu", "maxTruePeakDbTp", "cleanupFilter"
  ]);
  if (contract.schemaVersion !== "1.0" || contract.outputFormat !== "mp3"
    || contract.sampleRate !== 32000 || contract.channels !== 1) {
    throw new Error("音频合同必须固定为 schemaVersion 1.0、MP3、32000Hz、单声道");
  }
  finiteRange(contract.maxDurationDriftSeconds, { minimum: 0, maximum: 5, label: "音频合同 maxDurationDriftSeconds" });
  finiteRange(contract.maxLoudnessDriftLu, { minimum: 0, maximum: 12, label: "音频合同 maxLoudnessDriftLu" });
  finiteRange(contract.maxTruePeakDbTp, { minimum: -20, maximum: 0, label: "音频合同 maxTruePeakDbTp" });
  if (typeof contract.cleanupFilter !== "string" || !contract.cleanupFilter.trim()) {
    throw new Error("音频合同 cleanupFilter 必须是非空字符串");
  }
  return contract;
};

const validateSubtitleContract = (contract) => {
  assertClosedFields(contract, "字幕合同", ["schemaVersion", "maxContentChars"]);
  if (contract.schemaVersion !== "6.0") throw new Error("字幕合同 schemaVersion 必须为 6.0");
  finiteRange(contract.maxContentChars, { minimum: 1, maximum: 100, label: "字幕合同 maxContentChars", integer: true });
  return contract;
};

export const loadAudioContract = async () => validateAudioContract(JSON.parse(await readFile(audioContractUrl, "utf8")));
export const loadSubtitleContract = async () => validateSubtitleContract(JSON.parse(await readFile(subtitleContractUrl, "utf8")));

const defaultAudioCodec = {
  async encode({ inputPath, outputPath, contract }) {
    await runCommand("ffmpeg", [...ffmpegOptions, "-y", "-i", inputPath, "-vn",
      "-ac", String(contract.channels), "-ar", String(contract.sampleRate),
      "-af", contract.cleanupFilter, "-c:a", "libmp3lame", "-b:a", "128k", "-threads", "2", outputPath],
      path.dirname(outputPath));
  },
  async inspect({ audioPath }) {
    const directory = path.dirname(audioPath);
    const probe = JSON.parse((await runCommand("ffprobe", ["-v", "error", "-show_streams",
      "-show_format", "-of", "json", audioPath], directory, 15000)).stdout);
    const stream = probe.streams?.find((item) => item.codec_type === "audio");
    if (!stream) throw new Error("ffprobe 未找到音频流");
    const { stderr } = await runCommand("ffmpeg", [...ffmpegOptions, "-i", audioPath,
      "-af", "loudnorm=I=-18:TP=-2:LRA=9:print_format=json", "-threads", "2", "-f", "null", "-"], directory);
    const matches = stderr.match(/\{\s*"input_i"[\s\S]*?\}/gu);
    if (!matches?.length) throw new Error("ffmpeg 未返回响度测量值");
    const measurement = JSON.parse(matches.at(-1));
    return {
      durationSeconds: Number(probe.format?.duration),
      sampleRate: Number(stream.sample_rate),
      channels: Number(stream.channels),
      integratedLufs: Number(measurement.input_i),
      truePeakDbTp: Number(measurement.input_tp),
      codecName: stream.codec_name,
      formatName: probe.format?.format_name
    };
  }
};

export const verifySubtitleCorrection = ({
  correction, narration, sourceNarration = narration, sourceEpisodeId = null, contract, ttsResult = null
}) => {
  if (correction?.schemaVersion !== "3.0" || correction?.language !== "zh-CN"
    || correction?.maxContentChars !== contract.maxContentChars) throw new Error("author-subtitles 字幕校正成果合同无效");
  if (withoutWhitespace(sourceNarration) !== withoutWhitespace(narration)) throw new Error("字幕与TTS正文不一致");
  const errors = validateSubtitles({ result: correction, context: {
    scriptPackage: { narration: sourceNarration, episodeId: sourceEpisodeId ?? ttsResult?.episodeId }, ttsResult
  } });
  if (errors.length) throw new Error(errors.join("；"));
  const timing = correction.evidence.timingSource;
  const speechCues = projectSpeechCues({narration, cues: correction.cues,
    wordCues: timing.kind === 'provider-native' ? nativeWordCues(ttsResult.nativeTiming) : timing.wordCues,
    allowRecognitionDifferences: timing.kind === 'video-captioner-asr'});
  return { cues: correction.cues, speechCues, semantic: { provider: "author-subtitles", adapter: "author-subtitles",
    operations: [...correction.evidence.operations], timingSource: structuredClone(correction.evidence.timingSource) } };
};

export const verifySubtitleWindow = ({ cues, durationMs }) => {
  if (!Array.isArray(cues) || !cues.length || !Number.isInteger(durationMs) || durationMs <= 0) {
    throw new Error("字幕与音频时长门缺少有效输入");
  }
  if (cues[0].startMs > 500) throw new Error(`字幕起点 ${cues[0].startMs}ms 未覆盖音频开头`);
  const finalGap = durationMs - cues.at(-1).endMs;
  if (finalGap < -MAX_SUBTITLE_END_OVERRUN_MS || finalGap > 1000) {
    throw new Error(`字幕结尾与音频时长不匹配，尾差 ${finalGap}ms`);
  }
};

const srtTimestamp = (milliseconds) => {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(total % 1000).padStart(3, "0")}`;
};

export const srt = (cues) => cues.map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}`).join("\n\n") + "\n";
const formatNames = (value) => new Set(value.split(",").map((name) => name.trim()).filter(Boolean));

const audioDeliveryCheck = ({ raw, encoded, contract }) => {
  const durationDriftSeconds = Math.abs(encoded.durationSeconds - raw.durationSeconds);
  const loudnessDriftLu = Math.abs(encoded.integratedLufs - raw.integratedLufs);
  const failures = [];
  if (raw.codecName !== "flac" || !formatNames(raw.formatName).has("flac")) failures.push("原始音频不是 FLAC");
  if (encoded.codecName !== contract.outputFormat || !formatNames(encoded.formatName).has(contract.outputFormat)) failures.push(`成品音频不是 ${contract.outputFormat}`);
  if (encoded.sampleRate !== contract.sampleRate || encoded.channels !== contract.channels) failures.push("编码规格不符合音频合同");
  if (durationDriftSeconds > contract.maxDurationDriftSeconds) failures.push("音频时长漂移超限");
  if (loudnessDriftLu > contract.maxLoudnessDriftLu) failures.push("响度漂移超限");
  if (encoded.truePeakDbTp > contract.maxTruePeakDbTp) failures.push("真峰值超限");
  return { status: failures.length ? "fail" : "pass", raw, encoded, durationDriftSeconds, loudnessDriftLu, failures };
};

const validateAudioMetrics = (metrics, label) => {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error(`${label}音频测量结果无效`);
  if (!Number.isFinite(metrics.durationSeconds) || metrics.durationSeconds <= 0) throw new Error(`${label}音频时长必须是正有限数`);
  if (!Number.isInteger(metrics.sampleRate) || metrics.sampleRate <= 0) throw new Error(`${label}音频采样率必须是正整数`);
  if (!Number.isInteger(metrics.channels) || metrics.channels <= 0) throw new Error(`${label}音频声道数必须是正整数`);
  if (!Number.isFinite(metrics.integratedLufs) || !Number.isFinite(metrics.truePeakDbTp)) throw new Error(`${label}音频响度与真峰值必须是有限数`);
  if (typeof metrics.codecName !== "string" || !metrics.codecName.trim()
    || typeof metrics.formatName !== "string" || !metrics.formatName.trim()) {
    throw new Error(`${label}音频必须提供真实编码与容器格式`);
  }
};

const producerFor = ({ task, business }) => programProducer({
  task: {
    ...task,
    moduleId: task.moduleId ?? "finalize-narration",
    nodeId: task.nodeId ?? "finalize-narration",
    taskDigest: task.taskDigest ?? hashObject({ moduleId: "finalize-narration", business }),
    inputHashes: task.inputHashes ?? []
  },
  business
});

const verifyTtsResult = async ({ paths, result }) => {
  const text = canonicalText(result?.ttsInput?.text);
  if (!(await exists(paths.raw))) throw new Error("原始口播音频缺失");
  if (await fileSha256(paths.raw) !== result?.rawAudio?.sha256) {
    throw new Error("原始口播音频摘要与TTS结果不一致");
  }
  return text;
};

const deliveryNames = ["narration.txt", "narration.mp3", "narration.srt", "subtitle-quality.yaml", "narration-package.yaml"];
const transactionPath = (paths) => path.join(paths.work, "finalize-transaction.yaml");

const safeTransactionDirectory = ({ paths, name, prefix }) => {
  if (typeof name !== "string" || path.basename(name) !== name || !name.startsWith(prefix)) throw new Error("finalize 事务记录包含不安全的临时目录");
  const directory = path.resolve(paths.work, name);
  if (!directory.startsWith(`${path.resolve(paths.work)}${path.sep}`)) throw new Error("finalize 事务目录越界");
  return directory;
};

const recoverFinalizationTransaction = async ({ paths }) => {
  const marker = transactionPath(paths);
  if (!(await exists(marker))) return;
  const transaction = await readData(marker);
  const stage = safeTransactionDirectory({ paths, name: transaction.stage, prefix: ".finalize-narration-stage-" });
  const backup = safeTransactionDirectory({ paths, name: transaction.backup, prefix: ".finalize-narration-backup-" });
  if (!Array.isArray(transaction.entries) || transaction.entries.length !== deliveryNames.length
    || transaction.entries.some((entry, index) => entry?.name !== deliveryNames[index] || typeof entry.hadOriginal !== "boolean")) {
    throw new Error("finalize 事务记录不完整，拒绝猜测恢复范围");
  }
  if (transaction.phase === "committed") {
    await rm(stage, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
    await rm(marker, { force: true });
    return;
  }
  if (transaction.phase !== "prepared" && transaction.phase !== "promoting") throw new Error("finalize 事务记录状态无效");
  for (const entry of transaction.entries) {
    const target = entry.name === "narration-package.yaml" ? paths.package : path.join(paths.p2, entry.name);
    const backupFile = path.join(backup, entry.name);
    if (entry.hadOriginal) {
      if (!(await exists(backupFile))) throw new Error(`finalize 事务缺少旧文件备份: ${entry.name}`);
      await atomicWrite(target, await readFile(backupFile));
    } else await rm(target, { force: true });
  }
  await rm(stage, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await rm(marker, { force: true });
};

const transactionalPromote = async ({ paths, stage, promoteFile = rename }) => {
  const backup = await mkdtemp(path.join(paths.work, ".finalize-narration-backup-"));
  const entries = [];
  try {
    for (const name of deliveryNames) {
      const target = name === "narration-package.yaml" ? paths.package : path.join(paths.p2, name);
      const hadOriginal = await exists(target);
      if (hadOriginal) await atomicWrite(path.join(backup, name), await readFile(target));
      entries.push({ name, hadOriginal });
    }
    const transaction = { schemaVersion: "1.0", phase: "prepared", stage: path.basename(stage), backup: path.basename(backup), entries };
    await atomicWriteData(transactionPath(paths), transaction);
    await atomicWriteData(transactionPath(paths), { ...transaction, phase: "promoting" });
    for (const [index, entry] of entries.entries()) {
      const source = path.join(stage, entry.name);
      const target = entry.name === "narration-package.yaml" ? paths.package : path.join(paths.p2, entry.name);
      await promoteFile(source, target, { name: entry.name, index });
    }
    await atomicWriteData(transactionPath(paths), { ...transaction, phase: "committed" });
    await rm(backup, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    await rm(transactionPath(paths), { force: true });
  } catch (error) {
    if (await exists(transactionPath(paths))) await recoverFinalizationTransaction({ paths });
    else await rm(backup, { recursive: true, force: true });
    throw error;
  }
};

const readDeliveryManifest = async ({ directory, paths }) => {
  const manifest = await readData(path.join(directory, "narration-package.yaml"));
  const expectedDescriptors = {
    narration: ["files", "narration", "narration.txt"],
    audio: ["files", "audio", "narration.mp3"],
    subtitles: ["files", "subtitles", "narration.srt"],
    subtitleQuality: ["evidence", "subtitleQuality", "subtitle-quality.yaml"]
  };
  for (const [name, [section, key, expectedPath]] of Object.entries(expectedDescriptors)) {
    const descriptor = manifest[section]?.[key];
    if (!descriptor) throw new Error(`narration-package 缺少 ${name}`);
    if (descriptor.path !== expectedPath) throw new Error(`narration-package 的 ${name} 路径无效`);
    const file = path.resolve(directory, descriptor.path);
    if (!file.startsWith(`${path.resolve(directory)}${path.sep}`) || !(await exists(file))
      || await fileSha256(file) !== descriptor.sha256) throw new Error("narration-package 文件缺失或哈希不一致");
  }
  if (directory === paths.p2 && path.resolve(path.join(directory, "narration-package.yaml")) !== paths.package) {
    throw new Error("正式口播交接包路径无效");
  }
  return manifest;
};

export async function inspect({ root, episodeId, task = {} }) {
  const paths = pathsFor({ root, episodeId, task });
  if (await exists(transactionPath(paths))) return { valid: false, readyToRun: true, reason: "存在未完成的finalize事务，需要恢复" };
  if (!(await exists(paths.package))) return { valid: false, readyToRun: true, reason: "缺少narration-package，需要封装已校正字幕" };
  try {
    const scriptPackage = await scriptFromTask({ paths, task });
    const ttsResult = await resultFromTask({ paths, task });
    const narration = await verifyTtsResult({ paths, result: ttsResult });
    const correction = await correctionFromTask({ paths, task });
    const subtitleContract = await loadSubtitleContract();
    const { cues, semantic, speechCues } = verifySubtitleCorrection({
      correction,
      narration,
      sourceNarration: scriptPackage.narration,
      sourceEpisodeId: scriptPackage.episodeId,
      contract: subtitleContract,
      ttsResult
    });
    const manifest = await readDeliveryManifest({ directory: paths.p2, paths });
    verifySubtitleWindow({ cues, durationMs: manifest.durationMs });
    if (await readFile(path.join(paths.p2, "narration.txt"), "utf8") !== `${narration}\n`
      || await readFile(path.join(paths.p2, "narration.srt"), "utf8") !== srt(cues)) {
      throw new Error("正式口播文本或SRT不是当前已校正字幕的精确投影");
    }
    const quality = await readData(path.join(paths.p2, "subtitle-quality.yaml"));
    if (quality.schemaVersion !== "6.0" || quality.status !== "accepted"
      || quality.cueCount !== cues.length
      || quality.maximumContentChars !== Math.max(...cues.map((cue) => contentLength(cue.text)))
      || quality.contractSha256 !== sha256(JSON.stringify(subtitleContract))
      || hashObject(quality.semantic) !== hashObject(semantic)) {
      throw new Error("subtitle-quality不是当前字幕创作的已接纳状态");
    }
    if (quality.speechTiming && (quality.speechTiming.audioSha256 !== manifest.files.audio.sha256
      || hashObject(quality.speechTiming.cues) !== hashObject(speechCues))) {
      throw new Error('短语时间不是当前旁白及字幕的实测投影');
    }
    return { valid: true, manifest };
  } catch (error) {
    return { valid: false, readyToRun: true, reason: `${error.message}，需要重新封装已校正字幕` };
  }
}

export async function run({ root, episodeId, task = {} }) {
  const paths = pathsFor({ root, episodeId, task });
  await Promise.all([
    assertProjectMutationTree({ root, file: paths.p2, label: "P2 音频收口写入树" }),
    assertProjectMutationTree({ root, file: paths.package, label: "P2 口播交接包写入路径" }),
    assertProjectMutationTree({ root, file: paths.work, label: "P2 音频收口工作目录" })
  ]);
  await mkdir(paths.work, { recursive: true });
  await recoverFinalizationTransaction({ paths });
  const scriptPackage = await scriptFromTask({ paths, task });
  const ttsResult = await resultFromTask({ paths, task });
  const narration = await verifyTtsResult({ paths, result: ttsResult });
  const correction = await correctionFromTask({ paths, task });
  const audioContract = await loadAudioContract();
  const subtitleContract = await loadSubtitleContract();
  const { cues, semantic, speechCues } = verifySubtitleCorrection({
    correction,
    narration,
    sourceNarration: scriptPackage.narration,
    sourceEpisodeId: scriptPackage.episodeId,
    contract: subtitleContract,
    ttsResult
  });
  const codec = task?.context?.audioCodec ?? defaultAudioCodec;
  const stage = await mkdtemp(path.join(paths.work, ".finalize-narration-stage-"));
  try {
    const stagedAudio = path.join(stage, "narration.mp3");
    await codec.encode({ inputPath: paths.raw, outputPath: stagedAudio, contract: structuredClone(audioContract) });
    if (!(await stat(stagedAudio)).isFile()) throw new Error("音频编码器没有产生成品");
    const rawMetrics = await codec.inspect({ audioPath: paths.raw });
    const encodedMetrics = await codec.inspect({ audioPath: stagedAudio });
    validateAudioMetrics(rawMetrics, "原始");
    validateAudioMetrics(encodedMetrics, "成品");
    const audioDelivery = audioDeliveryCheck({ raw: rawMetrics, encoded: encodedMetrics, contract: audioContract });
    if (audioDelivery.status !== "pass") throw new Error(`音频技术门禁失败: ${audioDelivery.failures.join("；")}`);
    const durationMs = Math.round(encodedMetrics.durationSeconds * 1000);
    verifySubtitleWindow({ cues, durationMs });

    const stagedNarration = path.join(stage, "narration.txt");
    const stagedSubtitles = path.join(stage, "narration.srt");
    const stagedSubtitleQuality = path.join(stage, "subtitle-quality.yaml");
    await writeFile(stagedNarration, `${narration}\n`);
    await writeFile(stagedSubtitles, srt(cues));
    await atomicWriteData(stagedSubtitleQuality, {
      schemaVersion: "6.0",
      status: "accepted",
      cueCount: cues.length,
      maximumContentChars: Math.max(...cues.map((cue) => contentLength(cue.text))),
      semantic,
      speechTiming: {audioSha256: await fileSha256(stagedAudio), cues: speechCues},
      contractSha256: sha256(JSON.stringify(subtitleContract))
    });
    const files = {
      narration: { path: "narration.txt", sha256: await fileSha256(stagedNarration) },
      audio: { path: "narration.mp3", sha256: await fileSha256(stagedAudio) },
      subtitles: { path: "narration.srt", sha256: await fileSha256(stagedSubtitles) }
    };
    const evidence = { subtitleQuality: { path: "subtitle-quality.yaml", sha256: await fileSha256(stagedSubtitleQuality) } };
    const business = {
      schemaVersion: "1.1",
      episodeId: ttsResult.episodeId,
      seriesTitle: ttsResult.seriesTitle,
      language: ttsResult.language,
      durationMs,
      files,
      evidence
    };
    const manifest = { ...business, _producer: producerFor({ task, business }) };
    await atomicWriteData(path.join(stage, "narration-package.yaml"), manifest);
    await transactionalPromote({ paths, stage, promoteFile: task?.context?.promoteFile });
    // 事务已清理自身临时文件；Engine仍需公共_work中的锁、日志和返工请求。
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
