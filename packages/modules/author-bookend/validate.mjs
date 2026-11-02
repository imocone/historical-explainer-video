import {imageDescriptors, verifyAuthoredImage} from "../../authored-images.mjs";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWrite,
  atomicWriteData,
  fileSha256,
  hashObject,
  programProducer,
  readData,
  sha256,
  withProjectLock,
  withoutProducer
} from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import {
  normalizeProviderSentence,
  openerNarrationText,
  spokenSentencesForTreatment
} from "../../templates/episode-opener/validate.mjs";
import {
  OPENER_RENDER_POLICY,
  openerNarrationShareForTreatment
} from "../../templates/episode-opener/render-policy.mjs";
import { createOpenerTimingService } from "./opener-timing.mjs";
import { runMediaProcess } from "../render-video/runtime/media-process.mjs";
import { resolveMiniMaxApiKey } from '../synthesize-narration/minimax.mjs';
import { runtimeEnvFile, ttsVoice } from '../../runtime-config.mjs';

const exists = (file) => access(file).then(() => true, () => false);
const contractUrl = new URL("./opener-tts-contract.json", import.meta.url);
const MINIMAX_API_URL = "https://api.minimaxi.com/v1/t2a_v2";
const DEFINITIVE_SERVICE_CODES = new Set([2013, 2049, 20132]);
const DEFINITIVE_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);
const mediaStopped = error => ["MEDIA_CANCELLED", "MEDIA_RESOURCE_STOPPED"].includes(error?.code);
const usesSegmentedOpenerTiming = id => ["opposed-opener", "glass-opener"].includes(id);

const openerAdapterFor = async (result) => {
  if (result?.templateId === "episode-opener") return {
    requiresNarration: true,
    spokenSentencesForTreatment,
    openerNarrationText,
    narrationShareForTreatment: openerNarrationShareForTreatment,
    maxNarrationShare: OPENER_RENDER_POLICY.narration.maxShareOfOpener
  };
  if (result?.templateId === "documentary-opener") return {
    requiresNarration: false
  };
  if (result?.templateId === "crossfire-opener") {
    const { CROSS_FIRE } = await import("../../templates/crossfire-opener/render-policy.mjs");
    return {
      requiresNarration: true, spokenSentencesForTreatment, openerNarrationText,
      narrationShareForTreatment: treatment => treatment.narration?.durationMs / 8000,
      maxNarrationShare: CROSS_FIRE.maxNarrationMs / 8000
    };
  }
  if (usesSegmentedOpenerTiming(result?.templateId)) {
    const template = await import("../../templates/opposed-opener/validate.mjs");
    const { opposedNarrationShareForTreatment } = await import("../../templates/opposed-opener/render-policy.mjs");
    return {
      requiresNarration:true, spokenSentencesForTreatment:template.spokenSentencesForTreatment,
      openerNarrationText:template.openerNarrationText,
      narrationShareForTreatment:opposedNarrationShareForTreatment, maxNarrationShare:1
    };
  }
  throw new Error(`未知片头模板: ${result?.templateId ?? "missing"}`);
};

const localPreflightError = (message) => {
  const error = new Error(message);
  error.code = "local-preflight-failed";
  return error;
};

const remoteFailure = (message, { definitiveNoRemoteTask = false } = {}) => {
  const error = new Error(message);
  error.code = definitiveNoRemoteTask
    ? "remote-task-not-created"
    : "remote-result-unknown";
  error.definitiveNoRemoteTask = definitiveNoRemoteTask;
  return error;
};

const audioFromHex = (value) => {
  if (typeof value !== "string" || !value || value.length % 2 !== 0 || !/^[a-f0-9]+$/iu.test(value)) {
    throw new Error("MiniMax TTS 返回了无效音频数据");
  }
  const audio = Buffer.from(value, "hex");
  if (!audio.length) throw new Error("MiniMax TTS 返回了空音频");
  return audio;
};

export const openerMiniMaxPayload = ({ text, contract }) => {
  const voiceSetting = {
    voice_id: contract.voice,
    speed: contract.speechRate,
    vol: contract.volume,
    pitch: contract.pitch
  };
  if (contract.emotion !== "auto") voiceSetting.emotion = contract.emotion;
  return {
    model: contract.model,
    text,
    stream: false,
    voice_setting: voiceSetting,
    audio_setting: {
      sample_rate: contract.sampleRate,
      format: contract.rawFormat,
      channel: contract.channels
    },
    language_boost: contract.languageBoost,
    subtitle_enable: false,
    output_format: "hex",
    aigc_watermark: false
  };
};

export const createOpenerMiniMaxTtsService = (options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    environment = process.env,
    envFile = runtimeEnvFile
  } = options;
  const apiKey = Object.hasOwn(options, "apiKey")
    ? options.apiKey
    : resolveMiniMaxApiKey({ environment, envFile });
  return {
    assertReady() {
      if (typeof apiKey !== "string" || !apiKey.trim()) {
        throw localPreflightError("已获授权但缺少 MINIMAX_API_KEY，未发起片头远端请求");
      }
      if (typeof fetchImpl !== "function") throw localPreflightError("当前运行时不支持 MiniMax 网络请求");
    },
    async synthesize({ text, contract }) {
      this.assertReady();
      let response;
      try {
        response = await fetchImpl(MINIMAX_API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(openerMiniMaxPayload({ text, contract }))
        });
      } catch (error) {
        throw remoteFailure(`MiniMax 请求连接失败，远端结果未知: ${error.message}`);
      }
      let body;
      try {
        body = await response.text();
      } catch (error) {
        throw remoteFailure(`MiniMax HTTP 响应正文读取失败，远端结果未知: ${error.message}`);
      }
      if (!response.ok) {
        throw remoteFailure(
          `MiniMax HTTP 响应异常: HTTP ${response.status}: ${body.slice(0, 500)}`,
          { definitiveNoRemoteTask: DEFINITIVE_HTTP_STATUSES.has(response.status) }
        );
      }
      let result;
      try {
        result = JSON.parse(body);
      } catch {
        throw remoteFailure("MiniMax 响应无法解析，远端结果未知");
      }
      const serviceCode = Number(result?.base_resp?.status_code);
      if (serviceCode !== 0) {
        throw remoteFailure(
          `MiniMax 服务结果异常: ${result?.base_resp?.status_code}: ${result?.base_resp?.status_msg ?? "unknown"}`,
          { definitiveNoRemoteTask: DEFINITIVE_SERVICE_CODES.has(serviceCode) }
        );
      }
      if (Number(result?.data?.status) !== 2) {
        throw remoteFailure(`MiniMax 合成尚未明确完成，远端结果未知: status=${String(result?.data?.status)}`);
      }
      return {
        audio: audioFromHex(result?.data?.audio),
        remoteTaskId: typeof result?.data?.task_id === "string" ? result.data.task_id : null
      };
    }
  };
};

const loadOpenerTtsContract = async () => {
  const contract = { ...JSON.parse(await readFile(contractUrl, "utf8")), voice: ttsVoice() };
  if (contract?.schemaVersion !== "2.0"
    || contract.provider !== "minimax"
    || typeof contract.model !== "string"
    || !contract.model.trim()
    || typeof contract.voice !== "string"
    || !contract.voice.trim()
    || contract.speechRate !== 1.1
    || contract.volume !== 1
    || contract.pitch !== 0
    || contract.emotion !== "auto"
    || contract.languageBoost !== "Chinese"
    || contract.sampleRate !== 32000
    || contract.channels !== 1
    || contract.rawFormat !== "mp3"
    || contract.subtitleEnable !== false
    || Object.hasOwn(contract, "sentenceAlignment")
    || contract.timingProvider !== "video-captioner"
    || contract.timingPrimaryModel !== "JIANYING"
    || contract.timingFallbackModel !== "BIJIAN") {
    throw new Error("片头合同必须固定为 1.1 倍速单声道 MP3，并以 VideoCaptioner 主备接口取得真实卡点");
  }
  return contract;
};

const openerFingerprint = ({ text, contract }) => hashObject({
  provider: contract.provider,
  request: openerMiniMaxPayload({ text, contract })
});

const openerPaths = ({ root, episodeId }) => {
  const episode = getEpisodePaths(root, episodeId);
  const work = getStageWorkPaths(episode, "p4").work;
  return {
    input: path.join(episode.p4, "opener-tts-input.txt"),
    result: path.join(episode.p4, "opener-tts-result.yaml"),
    audio: path.join(episode.p4, "opener-narration.mp3"),
    intent: path.join(work, "opener-tts-intent.yaml"),
    timingDir: path.join(work, "opener-timing"),
    intentArchive: (fingerprint) => path.join(work, `opener-tts-intent-${fingerprint}.yaml`),
    lock: path.join(work, ".opener-tts.lock")
  };
};

const probeDurationMs = async (file) => {
  const probed = await runMediaProcess("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "format=duration,format_name:stream=codec_name",
    "-of", "json",
    file
  ], { capture: true, timeoutMs: 30_000 });
  let metadata;
  try {
    metadata = JSON.parse(probed.stdout);
  } catch {
    throw new Error("ffprobe 无法解析片头 MP3 元数据");
  }
  if (!String(metadata?.format?.format_name ?? "").split(",").includes("mp3")
    || metadata?.streams?.[0]?.codec_name !== "mp3") {
    throw new Error("片头正式音频必须是真实 MP3，不能只修改扩展名");
  }
  let durationMs = Math.round(Number(metadata?.format?.duration) * 1000);
  if (!Number.isFinite(durationMs)) {
    const decoded = await runMediaProcess("ffmpeg", [
      "-v", "error",
      "-threads", "2",
      "-i", file,
      "-threads", "2",
      "-f", "null",
      "-",
      "-progress", "pipe:1",
      "-nostats"
    ], { capture: true, timeoutMs: 30_000 });
    const outTimeUs = [...decoded.stdout.matchAll(/^out_time_us=(\d+)$/gmu)].at(-1)?.[1];
    if (!outTimeUs) {
      throw new Error(`ffmpeg 无法计算片头口播时长: ${(decoded.stderr || decoded.stdout).trim()}`);
    }
    durationMs = Math.round(Number(outTimeUs) / 1000);
  }
  if (!Number.isInteger(durationMs) || durationMs < 1) {
    throw new Error(`片头口播缺少有效实际时长，当前为 ${durationMs} 毫秒`);
  }
  return durationMs;
};

const sentenceCuesFor = ({
  providerCues,
  sentences,
  durationMs = null
}) => {
  if (!Array.isArray(providerCues) || providerCues.length !== sentences.length) {
    throw new Error(`片头真实卡点必须返回 ${sentences.length} 句，当前为 ${providerCues?.length ?? 0} 句`);
  }
  return providerCues.map((cue, index) => {
    const expected = sentences[index];
    if (normalizeProviderSentence(cue?.text) !== normalizeProviderSentence(expected.text)) {
      throw new Error(`片头第 ${index + 1} 句卡点文字与屏幕句不一致`);
    }
    if (typeof cue?.recognizedText !== "string" || !normalizeProviderSentence(cue.recognizedText)) {
      throw new Error(`片头第 ${index + 1} 句缺少真实识别文字`);
    }
    if (cue?.target !== undefined && cue.target !== expected.target) {
      throw new Error(`片头第 ${index + 1} 句卡点目标与句序不一致`);
    }
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs)
      || cue.startMs < 0 || cue.endMs <= cue.startMs
      || (index > 0 && cue.startMs < providerCues[index - 1].endMs)
      || (Number.isInteger(durationMs) && cue.endMs > durationMs + 100)) {
      throw new Error(`片头第 ${index + 1} 句卡点时间无效`);
    }
    return {
      target: expected.target,
      text: expected.text,
      recognizedText: cue.recognizedText,
      startMs: cue.startMs,
      endMs: cue.endMs
    };
  });
};

const sameSentenceUnits = (cues, sentences) => Array.isArray(cues) && cues.length === sentences.length
  && cues.every((cue, i) => cue?.target === sentences[i]?.target
    && normalizeProviderSentence(cue?.text) === normalizeProviderSentence(sentences[i]?.text));

const timingEvidenceFor = (value) => {
  if (value?.provider !== "video-captioner"
    || !["JIANYING", "BIJIAN", "WHISPER_CPP"].includes(value?.actualModel)
    || typeof value?.fallbackOccurred !== "boolean"
    || !/^[a-f0-9]{64}$/u.test(String(value?.wordTimelineSha256 ?? ""))) {
    throw new Error("片头真实卡点缺少 VideoCaptioner 词级时间证据");
  }
  return {
    provider: value.provider,
    actualModel: value.actualModel,
    fallbackOccurred: value.fallbackOccurred,
    wordTimelineSha256: value.wordTimelineSha256
  };
};

const narrationEvidence = ({ textSha256, receipt }) => ({
  textSha256,
  durationMs: receipt.audio.durationMs,
  audioSha256: receipt.audio.sha256,
  ttsFingerprint: receipt.fingerprint,
  sentenceCues: receipt.sentenceCues.map(({ target, startMs, endMs }) => ({
    target,
    startMs,
    endMs
  }))
});

const producerFor = ({ task, business }) => programProducer({
  task: {
    moduleId: "author-bookend",
    nodeId: "opener",
    taskDigest: task.taskDigest,
    inputHashes: task.inputArtifactHashes ?? task.inputHashes ?? []
  },
  business
});

const writeOwnedDocument = async ({ file, task, business }) => {
  const document = { ...business, _producer: producerFor({ task, business }) };
  await atomicWriteData(file, document);
  return document;
};

const assertOwnedDocument = ({ document, label }) => {
  const business = withoutProducer(document);
  if (document?._producer?.moduleId !== "author-bookend"
    || document?._producer?.nodeId !== "opener"
    || document?._producer?.outputSha256 !== hashObject(business)) {
    throw new Error(`${label}生产摘要不一致`);
  }
  return business;
};

const readIntent = async (file) => assertOwnedDocument({
  document: await readData(file),
  label: "片头 TTS 提交意图"
});

const currentResult = async ({
  paths,
  text,
  textSha256,
  fingerprint,
  contractSha256,
  sentences,
  restartId = null,
  allowRetiming = false
}) => {
  if (!(await exists(paths.result)) || !(await exists(paths.audio))) return null;
  const document = await readData(paths.result);
  if (restartId && !document._producer?.inputs?.includes(hashObject({ stageRestart: restartId }))) return null;
  const result = assertOwnedDocument({ document, label: "片头 TTS 回执" });
  if (result.schemaVersion !== "2.0"
    || result.kind !== "opener-narration"
    || result.fingerprint !== fingerprint
    || result.ttsInput?.text !== text
    || result.ttsInput?.sha256 !== textSha256
    || result.contractSha256 !== contractSha256
    || result.audio?.path !== "opener-narration.mp3") return null;
  const actualSha256 = await fileSha256(paths.audio);
  if (actualSha256 !== result.audio.sha256) throw new Error("片头 TTS 回执与正式音频摘要不一致");
  const actualDurationMs = await probeDurationMs(paths.audio);
  if (Math.abs(actualDurationMs - result.audio.durationMs) > 50) {
    throw new Error("片头 TTS 回执与正式音频时长不一致");
  }
  if (allowRetiming && !sameSentenceUnits(result.sentenceCues, sentences)) return null;
  sentenceCuesFor({
    providerCues: result.sentenceCues,
    sentences,
    durationMs: actualDurationMs
  });
  timingEvidenceFor(result.timing);
  return result;
};

const blockingIntent = async ({ paths, fingerprint, restartId }) => {
  if (!(await exists(paths.intent))) return null;
  const document = await readData(paths.intent);
  const intent = assertOwnedDocument({ document, label: "片头 TTS 提交意图" });
  if (restartId && intent.status === "rejected"
    && !document._producer.inputs?.includes(hashObject({ stageRestart: restartId }))) return null;
  if (intent.fingerprint === fingerprint
    && ["submitting", "unknown", "rejected"].includes(intent.status)) return intent;
  return null;
};

const archiveMismatchedIntent = async ({ paths, fingerprint }) => {
  if (!(await exists(paths.intent))) return;
  const document = await readData(paths.intent);
  const intent = assertOwnedDocument({ document, label: "片头 TTS 提交意图" });
  if (intent.fingerprint === fingerprint) return;
  const archive = paths.intentArchive(intent.fingerprint);
  if (!(await exists(archive))) await atomicWriteData(archive, document);
};

const recoverCompletedLocalAudio = async ({
  paths,
  episodeId,
  text,
  textSha256,
  fingerprint,
  contractSha256,
  sentences,
  task,
  timingService,
  allowRetiming = false
}) => {
  const hasInput = await exists(paths.input);
  const hasAudio = await exists(paths.audio);
  let intent;
  if (await exists(paths.intent)) {
    intent = await readIntent(paths.intent);
  }
  let prior = null;
  if (allowRetiming && await exists(paths.result) && !task.inputs?.stageRestartId) {
    const candidate = assertOwnedDocument({document:await readData(paths.result), label:"片头 TTS 回执"});
    if (candidate.schemaVersion === "2.0" && candidate.kind === "opener-narration"
      && candidate.fingerprint === fingerprint && candidate.ttsInput?.text === text
      && candidate.ttsInput?.sha256 === textSha256 && candidate.contractSha256 === contractSha256
      && candidate.audio?.path === "opener-narration.mp3") prior = candidate;
  }
  if (allowRetiming && !hasAudio && (prior || (intent?.fingerprint === fingerprint
    && ["awaiting-timing", "received", "succeeded"].includes(intent.status)))) {
    throw new Error("已有同一片头配音回执，但本地音频缺失，不能重复提交");
  }
  if (!hasAudio || (!hasInput && !allowRetiming)) return null;
  if (!intent && prior) {
    if (prior.audio?.sha256 !== await fileSha256(paths.audio))
      throw new Error("片头 TTS 回执与正式音频摘要不一致");
    intent = {schemaVersion:"2.0", kind:"opener-narration", fingerprint,
      ttsInputSha256:textSha256, contractSha256, status:"succeeded",
      audioSha256:prior.audio.sha256, remoteTaskId:prior.remoteTaskId ?? null};
  }
  if (!intent) return null;
  if (!hasInput && !prior && intent.fingerprint === fingerprint
    && ["awaiting-timing", "received", "succeeded"].includes(intent.status)) {
    throw new Error("已有同一片头配音，但输入记录缺失，不能重复提交");
  }
  if (allowRetiming && hasInput && intent.fingerprint === fingerprint
    && ["awaiting-timing", "received", "succeeded"].includes(intent.status)
    && (await readFile(paths.input, "utf8")).trim() !== text) {
    throw new Error("已有同一片头配音，但输入记录不一致，不能重复提交");
  }
  if (!["awaiting-timing", "received", "succeeded"].includes(intent.status)
    || intent.fingerprint !== fingerprint
    || intent.ttsInputSha256 !== textSha256
    || intent.contractSha256 !== contractSha256
    || (hasInput ? (await readFile(paths.input, "utf8")).trim() !== text : !prior)) return null;
  if (prior && prior.audio.sha256 !== await fileSha256(paths.audio))
    throw new Error("片头 TTS 回执与正式音频摘要不一致");
  if (task.inputs?.stageRestartId && !(await readData(paths.intent))._producer?.inputs
    ?.includes(hashObject({ stageRestart: task.inputs.stageRestartId }))) return null;
  let durationMs;
  try {
    durationMs = await probeDurationMs(paths.audio);
  } catch (error) {
    if (mediaStopped(error)) throw error;
    if (allowRetiming) throw new Error(`已有片头配音无法读取，不能重复提交: ${error.message}`);
    return null;
  }
  let timed;
  if (allowRetiming && intent.audioSha256 && intent.audioSha256 !== await fileSha256(paths.audio))
    throw new Error("片头 TTS 意图与正式音频摘要不一致");
  if (intent.status === "received" && Array.isArray(intent.sentenceCues)
    && (!allowRetiming || sameSentenceUnits(intent.sentenceCues, sentences))) {
    timed = { sentenceCues: intent.sentenceCues, evidence: intent.timing ?? null };
  } else {
    try {
      timed = await timingService.time({
        audioPath: paths.audio,
        sentences,
        durationMs
      });
    } catch (error) {
      await writeOwnedDocument({
        file: paths.intent,
        task,
        business: { ...intent, status: "awaiting-timing", reason: error.message, durationMs }
      });
      throw new Error(`片头音频已安全保存，真实卡点尚未完成: ${error.message}`);
    }
  }
  const sentenceCues = sentenceCuesFor({
    providerCues: timed.sentenceCues,
    sentences,
    durationMs
  });
  const timing = timingEvidenceFor(timed.evidence ?? intent.timing);
  const audioSha256 = await fileSha256(paths.audio);
  const business = {
    schemaVersion: "2.0",
    kind: "opener-narration",
    episodeId,
    fingerprint,
    ttsInput: { text, sha256: textSha256 },
    contractSha256,
    audio: {
      path: "opener-narration.mp3",
      sha256: audioSha256,
      durationMs
    },
    sentenceCues,
    remoteTaskId: intent.remoteTaskId ?? null,
    timing
  };
  await writeOwnedDocument({ file: paths.result, task, business });
  await writeOwnedDocument({
    file: paths.intent,
    task,
    business: {
      ...intent,
      status: "succeeded",
      audioSha256,
      durationMs,
      sentenceCues,
      timing: business.timing,
      contractSha256
    }
  });
  return business;
};

const materializeOpenerNarration = async ({
  root,
  episodeId,
  result,
  task,
  authorizePaidTts,
  ttsService,
  timingService
}) => {
  const paths = openerPaths({ root, episodeId });
  const adapter = await openerAdapterFor(result);
  const sentences = adapter.spokenSentencesForTreatment(result);
  const text = adapter.openerNarrationText(result);
  if (!sentences.length || sentences.some(sentence => !sentence?.target || !sentence.text)
    || new Set(sentences.map(sentence => sentence.target)).size !== sentences.length) {
    throw new Error("片头必须提供所选模板定义的有序口播段");
  }
  const textSha256 = sha256(text);
  const contract = await loadOpenerTtsContract();
  const contractSha256 = hashObject(contract);
  const fingerprint = openerFingerprint({ text, contract });
  const service = ttsService ?? createOpenerMiniMaxTtsService();
  const timer = timingService ?? createOpenerTimingService({ workDir: paths.timingDir });
  const reusable = await currentResult({
    paths,
    text,
    textSha256,
    fingerprint,
    contractSha256,
    sentences,
    restartId: task.inputs?.stageRestartId,
    allowRetiming:usesSegmentedOpenerTiming(result.templateId)
  });
  if (reusable) {
    result.narration = narrationEvidence({ textSha256, receipt: reusable });
    return;
  }
  const recovered = await recoverCompletedLocalAudio({
    paths,
    episodeId,
    text,
    textSha256,
    fingerprint,
    contractSha256,
    sentences,
    task,
    timingService: timer,
    allowRetiming:usesSegmentedOpenerTiming(result.templateId)
  });
  if (recovered) {
    result.narration = narrationEvidence({ textSha256, receipt: recovered });
    return;
  }
  await archiveMismatchedIntent({ paths, fingerprint });
  const blocked = await blockingIntent({ paths, fingerprint, restartId: task.inputs?.stageRestartId });
  if (blocked) {
    if (blocked.status === "rejected") {
      throw new Error(blocked.reason ?? "同一片头 TTS 结果不符合正式合同，必须修改片头句子后再提交");
    }
    throw new Error("片头 TTS 远端或本地接纳结果未闭合，已锁定本次请求，禁止重复付费提交");
  }
  if (authorizePaidTts !== true) {
    throw new Error("片头接纳需要本次明确的付费 TTS 授权");
  }
  if (typeof service.assertReady === "function") await service.assertReady();
  if (typeof timer.assertReady === "function") await timer.assertReady();
  for (const command of ["ffmpeg", "ffprobe"]) {
    const checked = spawnSync(command, ["-version"], { encoding: "utf8", timeout: 30_000 });
    if (checked.status !== 0) throw new Error(`片头 TTS 付费前预检失败：${command} 不可用`);
  }
  await mkdir(path.dirname(paths.lock), { recursive: true });
  await withProjectLock({
    root,
    lock: paths.lock,
    label: "当前片头 TTS 合成",
    execute: async () => {
      const raced = await currentResult({
        restartId: task.inputs?.stageRestartId,
        paths,
        text,
        textSha256,
        fingerprint,
        contractSha256,
        sentences,
        allowRetiming:usesSegmentedOpenerTiming(result.templateId)
      });
      if (raced) {
        result.narration = narrationEvidence({ textSha256, receipt: raced });
        return;
      }
      const racedBlock = await blockingIntent({ paths, fingerprint, restartId: task.inputs?.stageRestartId });
      if (racedBlock) {
        throw new Error(racedBlock.status === "rejected"
          ? (racedBlock.reason ?? "同一片头 TTS 结果不符合正式合同，必须修改片头句子")
          : "片头 TTS 远端结果未知，禁止新的付费请求");
      }
      const intentBusiness = {
        schemaVersion: "2.0",
        kind: "opener-narration",
        fingerprint,
        ttsInputSha256: textSha256,
        contractSha256,
        status: "submitting"
      };
      await writeOwnedDocument({ file: paths.intent, task, business: intentBusiness });
      let response;
      try {
        response = await service.synthesize({
          text,
          contract: structuredClone(contract),
          fingerprint
        });
      } catch (error) {
        await writeOwnedDocument({
          file: paths.intent,
          task,
          business: {
            ...intentBusiness,
            status: error?.definitiveNoRemoteTask === true ? "not-created" : "unknown",
            reason: error.message
          }
        });
        if (error?.definitiveNoRemoteTask === true) throw error;
        throw new Error(`片头 TTS 远端结果未知，禁止重复付费提交: ${error.message}`);
      }
      if (!(Buffer.isBuffer(response?.audio) || response?.audio instanceof Uint8Array)
        || response.audio.length === 0) {
        await writeOwnedDocument({
          file: paths.intent,
          task,
          business: { ...intentBusiness, status: "unknown", reason: "MiniMax 返回了无效音频数据" }
        });
        throw new Error("片头 TTS 返回内容无效，远端结果未知，禁止重复付费提交");
      }
      const audioIntent = {
        ...intentBusiness,
        status: "awaiting-timing",
        remoteTaskId: typeof response.remoteTaskId === "string" ? response.remoteTaskId : null
      };
      await atomicWrite(paths.input, `${text}\n`);
      await atomicWrite(paths.audio, response.audio);
      let durationMs;
      let audioSha256;
      try {
        durationMs = await probeDurationMs(paths.audio);
        audioSha256 = await fileSha256(paths.audio);
      } catch (error) {
        await writeOwnedDocument({
          file: paths.intent,
          task,
          business: {
            ...audioIntent,
            status: mediaStopped(error) ? "awaiting-timing" : "rejected",
            reason: error.message
          }
        });
        throw error;
      }
      await writeOwnedDocument({
        file: paths.intent,
        task,
        business: { ...audioIntent, audioSha256, durationMs }
      });
      let timed;
      let sentenceCues;
      try {
        timed = await timer.time({
          audioPath: paths.audio,
          sentences,
          durationMs
        });
        sentenceCues = sentenceCuesFor({
          providerCues: timed.sentenceCues,
          sentences,
          durationMs
        });
        timed.evidence = timingEvidenceFor(timed.evidence);
      } catch (error) {
        await writeOwnedDocument({
          file: paths.intent,
          task,
          business: {
            ...audioIntent,
            status: "awaiting-timing",
            reason: error.message,
            audioSha256,
            durationMs
          }
        });
        throw new Error(`片头音频已安全保存，真实卡点尚未完成: ${error.message}`);
      }
      const receivedIntent = {
        ...audioIntent,
        status: "received",
        sentenceCues,
        timing: timed.evidence ?? null,
        audioSha256,
        durationMs
      };
      await writeOwnedDocument({ file: paths.intent, task, business: receivedIntent });
      const business = {
        schemaVersion: "2.0",
        kind: "opener-narration",
        episodeId,
        fingerprint,
        ttsInput: { text, sha256: textSha256 },
        contractSha256,
        audio: {
          path: "opener-narration.mp3",
          sha256: audioSha256,
          durationMs
        },
        sentenceCues,
        remoteTaskId: receivedIntent.remoteTaskId,
        timing: receivedIntent.timing
      };
      await writeOwnedDocument({ file: paths.result, task, business });
      await writeOwnedDocument({
        file: paths.intent,
        task,
        business: {
          ...intentBusiness,
          status: "succeeded",
          audioSha256,
          durationMs,
          sentenceCues,
          timing: receivedIntent.timing,
          remoteTaskId: receivedIntent.remoteTaskId
        }
      });
      result.narration = narrationEvidence({ textSha256, receipt: business });
    }
  });
};

export function validate({ result, context }) {
  const errors = [];
  const nodeId = context.nodeId ?? context.segmentRole ?? context.segmentType;
  if (typeof context.selectedTemplate !== "string" || !context.selectedTemplate) errors.push(`${nodeId ?? "片头"}节点缺少当前装配的模板身份`);
  if (result.templateId !== context.selectedTemplate) {
    errors.push(`author-bookend 只能执行工作单已选模板: ${context.selectedTemplate ?? "missing"}`);
  }
  return errors;
}

export async function validateAcceptance({
  result,
  context = {},
  services = {}
}) {
  if (context.segmentType !== "opener") return [];
  try {
    for (const {target} of await imageDescriptors({treatment:result})) await verifyAuthoredImage({
      asset:target.asset,workspaceRoot:services.workspaceRoot,episodeId:services.episodeId,stageId:"p4",unitId:"opener"});
    const adapter = await openerAdapterFor(result);
    if (!adapter.requiresNarration) {
      if (result.narration !== undefined) throw new Error("无旁白片头不得携带TTS证据");
      return [];
    }
    await materializeOpenerNarration({
      root: services.workspaceRoot,
      episodeId: services.episodeId,
      result,
      task: services.task,
      authorizePaidTts: services.authorizePaidTts,
      ttsService: services.ttsService,
      timingService: services.timingService
    });
    const narrationShare = adapter.narrationShareForTreatment(result);
    if (narrationShare === null
      || narrationShare > adapter.maxNarrationShare + Number.EPSILON) {
      throw new Error("片头TTS不得超过所选模板允许的实际片头时段占比");
    }
    return [];
  } catch (error) {
    return [`片头口播接纳失败: ${error.message}`];
  }
}

export async function validateStoredAcceptance({
  result,
  root,
  episodeId,
  services = {}
}) {
  if (!["episode-opener", "documentary-opener", "crossfire-opener", "opposed-opener", "glass-opener"].includes(result.templateId)) return [];
  try {
    const adapter = await openerAdapterFor(result);
    if (!adapter.requiresNarration) {
      return result.narration === undefined ? [] : ["无旁白片头不得保存TTS证据"];
    }
    const workspaceRoot = root ?? services.workspaceRoot;
    const subjectEpisodeId = episodeId ?? services.episodeId;
    const contract = await loadOpenerTtsContract();
    const sentences = adapter.spokenSentencesForTreatment(result);
    const text = adapter.openerNarrationText(result);
    const textSha256 = sha256(text);
    const fingerprint = openerFingerprint({ text, contract });
    const current = await currentResult({
      paths: openerPaths({ root: workspaceRoot, episodeId: subjectEpisodeId }),
      text,
      textSha256,
      fingerprint,
      contractSha256: hashObject(contract),
      sentences
    });
    if (!current || hashObject(narrationEvidence({ textSha256, receipt: current }))
      !== hashObject(result.narration)) {
      return ["片头正式口播、TTS 回执或 episode-package 音频证据不一致"];
    }
    return [];
  } catch (error) {
    return [`片头正式口播证据无效: ${error.message}`];
  }
}
