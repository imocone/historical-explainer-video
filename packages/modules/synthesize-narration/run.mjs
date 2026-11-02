import { access, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertProjectMutationTree,
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
import { createMiniMaxTtsService, miniMaxPayload } from "./minimax.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { ttsVoice } from '../../runtime-config.mjs';

const contractUrl = new URL("./tts-contract.json", import.meta.url);
const resultSchemaUrl = new URL("./tts-result.schema.json", import.meta.url);
const intentSchemaUrl = new URL("./tts-intent.schema.json", import.meta.url);
const exists = (file) => access(file).then(() => true, () => false);
const MAX_TTS_CHARACTERS = 9_999;
const TRAILING_CLOSERS = "\"”’」』》）》】";
const PARAGRAPH_END = new RegExp(`[。！？!?…](?:[${TRAILING_CLOSERS}]*)$`, "u");
const SPOKEN_SENTENCE_END = /[。！？!?…]+/gu;
const horizontalWhitespace = /[\p{Zs}\t\v\f\u00a0]/gu;
const invisibleControl = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export class AuthorizationRequiredError extends Error {
  constructor() {
    super("P2 合成需要明确的一次性付费授权");
    this.code = "authorization-required";
  }
}

export class UnknownRemoteResultError extends Error {
  constructor() {
    super("TTS 远端结果尚未确认，已锁定新的付费请求，禁止再次扣费");
    this.code = "unknown-remote-result";
  }
}

export class RemoteTaskNotCreatedError extends Error {
  constructor(message) {
    super(message);
    this.code = "remote-task-not-created";
  }
}

const commandFailure = ({ command }) => {
  throw new Error(`P2 付费前预检失败：${command} 不可用`);
};

const createP2PaidPreflight = ({
  spawnImpl = spawnSync
} = {}) => ({
  async assertReady() {
    for (const command of ["ffmpeg", "ffprobe"]) {
      const result = spawnImpl(command, ["-version"], { encoding: "utf8", timeout: 30_000 });
      if (result?.status !== 0) commandFailure({ command, result });
    }
  }
});

const pathsFor = ({ root, episodeId, task = {} }) => {
  const episodePaths = getEpisodePaths(root, episodeId);
  const p2 = episodePaths.p2;
  const work = getStageWorkPaths(episodePaths, "p2").work;
  const expectedResult = path.join(p2, "tts-result.yaml");
  const resultPath = task.outputPath
    ? (path.isAbsolute(task.outputPath)
        ? path.resolve(task.outputPath)
        : path.resolve(root, task.outputPath))
    : expectedResult;
  if (resultPath !== path.resolve(expectedResult)) {
    throw new Error("synthesize-narration 的 outputPath 不是当前剧集正式 TTS 回执");
  }
  return {
    p2,
    input: path.join(p2, "tts-input.txt"),
    raw: path.join(p2, "raw-narration.flac"),
    result: resultPath,
    intent: path.join(work, "tts-intent.yaml"),
    lock: path.join(work, ".tts-synthesis.lock")
  };
};

const contractFields = new Set([
  "schemaVersion", "provider", "model", "voice", "speechRate", "volume", "pitch",
  "emotion", "languageBoost", "sampleRate", "channels", "rawFormat", "subtitleGranularity"
]);

const validateTtsContract = (contract) => {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("TTS 合同必须是对象");
  }
  const unexpected = Object.keys(contract).filter((field) => !contractFields.has(field));
  const missing = [...contractFields].filter((field) => !Object.hasOwn(contract, field));
  if (unexpected.length || missing.length) {
    throw new Error(`TTS 合同字段不完整或包含未知字段: ${[...missing, ...unexpected].join(", ")}`);
  }
  if (contract.schemaVersion !== "2.0" || contract.provider !== "minimax") {
    throw new Error("TTS 合同只允许 schemaVersion 2.0 与 MiniMax 供应商");
  }
  if (typeof contract.model !== "string" || !contract.model.trim()
    || typeof contract.voice !== "string" || !contract.voice.trim()) {
    throw new Error("TTS 合同必须指定非空 model 与 voice");
  }
  if (!Number.isFinite(contract.speechRate) || contract.speechRate < 0.5 || contract.speechRate > 2) {
    throw new Error("TTS 合同 speechRate 必须在 0.5 到 2 之间");
  }
  if (!Number.isFinite(contract.volume) || contract.volume < 0 || contract.volume > 10) {
    throw new Error("TTS 合同 volume 必须在 0 到 10 之间");
  }
  if (!Number.isInteger(contract.pitch) || contract.pitch < -12 || contract.pitch > 12) {
    throw new Error("TTS 合同 pitch 必须是 -12 到 12 的整数");
  }
  if (typeof contract.emotion !== "string" || !contract.emotion.trim()) {
    throw new Error("TTS 合同 emotion 必须是非空字符串");
  }
  if (contract.languageBoost !== "Chinese" || contract.sampleRate !== 32000
    || contract.channels !== 1 || contract.rawFormat !== "flac"
    || contract.subtitleGranularity !== "word") {
    throw new Error("TTS 合同必须固定为 Chinese、32000Hz、单声道 FLAC 与 word 原生时间轴");
  }
  return contract;
};

export const loadTtsContract = async () => validateTtsContract({
  ...JSON.parse(await readFile(contractUrl, "utf8")), voice: ttsVoice()
});

const visibleSequence = (text) => [...text].filter((character) => !/\s/u.test(character)).join("");
const spokenSentenceCount = (text) => text.match(SPOKEN_SENTENCE_END)?.length ?? 0;

const mergeSingleSentenceParagraphs = (paragraphs) => {
  const merged = [];
  let pending = "";
  for (const paragraph of paragraphs) {
    pending += paragraph;
    if (spokenSentenceCount(pending) >= 2) {
      merged.push(pending);
      pending = "";
    }
  }
  if (pending) {
    if (merged.length) merged[merged.length - 1] += pending;
    else merged.push(pending);
  }
  return merged;
};

export const validatePreparedNarration = (text) => {
  if (typeof text !== "string" || !text.length) throw new Error("P2 口播稿不能为空");
  const hidden = [...text].find((character) => character !== "\n" && invisibleControl.test(character));
  if (hidden) {
    const codePoint = hidden.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new Error(`P2 口播稿包含不可见控制字符 U+${codePoint}，必须退回 P1 删除`);
  }
  if ([...text].length > MAX_TTS_CHARACTERS) {
    throw new Error("P2 口播稿超过同步 TTS 小于 10000 字符的供应商上限，必须退回 P1 缩短");
  }
  if (text.includes("\n\n") || horizontalWhitespace.test(text)) {
    horizontalWhitespace.lastIndex = 0;
    throw new Error("P2 清洗结果只能以单个自然段换行分隔，不能保留横向空白");
  }
  horizontalWhitespace.lastIndex = 0;
  for (const [index, paragraph] of text.split("\n").entries()) {
    if (!PARAGRAPH_END.test(paragraph)) {
      throw new Error(`第 ${index + 1} 个自然段缺少句末标点，必须退回 P1 修正`);
    }
  }
};

export const prepareNarrationText = (source) => {
  if (typeof source !== "string") throw new Error("P2 语音合成需要字符串口播稿");
  const canonical = source.replace(/\r\n?/gu, "\n");
  const sourceParagraphs = canonical
    .split(/\n[\p{Zs}\t\v\f\u00a0]*\n+/gu)
    .map((paragraph) => paragraph.replace(/[\n\r\p{Zs}\t\v\f\u00a0]/gu, ""))
    .filter(Boolean);
  const paragraphs = mergeSingleSentenceParagraphs(sourceParagraphs);
  const text = paragraphs.join("\n");
  if (visibleSequence(canonical) !== visibleSequence(text)) {
    throw new Error("P2 只能删除空白，拒绝改变任何可见字符或标点");
  }
  validatePreparedNarration(text);
  return text;
};

const textFromTask = async ({ paths, task }) => {
  const scriptPackage = task?.inputs?.scriptPackage ?? task?.context?.scriptPackage;
  if (scriptPackage && typeof scriptPackage === "object" && typeof scriptPackage.narration === "string") {
    return prepareNarrationText(scriptPackage.narration);
  }
  return prepareNarrationText(await readFile(paths.input, "utf8"));
};

const metadataFromTask = ({ episodeId, task }) => {
  const scriptPackage = task?.inputs?.scriptPackage ?? task?.context?.scriptPackage;
  const metadata = scriptPackage && typeof scriptPackage === "object"
    ? scriptPackage
    : (task?.context?.metadata ?? {});
  const result = { episodeId: metadata.episodeId ?? episodeId, seriesTitle: metadata.seriesTitle, language: metadata.language };
  if (!result.seriesTitle || result.language !== "zh-CN") {
    throw new Error("script-package 必须提供 seriesTitle 与 zh-CN language");
  }
  return result;
};

const paidAuthorized = (task) => task?.context?.paidTtsAuthorized === true
  || task?.authorization?.paidTts === true;

const contractSha256 = (contract) => hashObject(contract);

const synthesisFingerprint = ({ text, contract, restartId }) => {
  validateTtsContract(contract);
  return hashObject({
    provider: contract.provider,
    request: miniMaxPayload({ text, contract }),
    ...(restartId ? { restartId } : {})
  });
};

const validateDocumentSchema = async ({ schema, value, label }) => {
  const validate = new Ajv2020({ allErrors: true, strict: false })
    .compile(await readData(schema));
  if (!validate(value)) {
    const errors = (validate.errors ?? [])
      .map((item) => `${item.instancePath || "/"} ${item.message}`)
      .join("; ");
    throw new Error(`${label}合同失败: ${errors}`);
  }
};

const assertStoredProducer = ({ artifact, label }) => {
  const producer = artifact?._producer;
  const business = withoutProducer(artifact);
  if (producer?.moduleId !== "synthesize-narration"
    || producer?.nodeId !== "synthesize-narration"
    || producer?.outputSha256 !== hashObject(business)) {
    throw new Error(`${label}生产摘要不一致，拒绝复用或解除付费锁`);
  }
  return business;
};

const readStoredResult = async (file) => {
  const result = await readData(file);
  await validateDocumentSchema({
    schema: resultSchemaUrl,
    value: result,
    label: "TTS 结果"
  });
  assertStoredProducer({ artifact: result, label: "TTS 结果" });
  return result;
};

const readStoredIntent = async (file) => {
  const intent = await readData(file);
  await validateDocumentSchema({
    schema: intentSchemaUrl,
    value: intent,
    label: "TTS 提交意图"
  });
  assertStoredProducer({ artifact: intent, label: "TTS 提交意图" });
  if (intent.status === "succeeded" && !intent.rawAudioSha256) {
    throw new Error("TTS 提交意图 succeeded 状态缺少原始音频摘要");
  }
  if (intent.status !== "succeeded" && intent.rawAudioSha256) {
    throw new Error(`TTS 提交意图 ${intent.status} 状态不得携带原始音频摘要`);
  }
  return intent;
};

const currentSuccessfulResult = async ({
  paths,
  fingerprint,
  text,
  textSha256,
  currentContractSha256
}) => {
  if (!(await exists(paths.result)) || !(await exists(paths.raw))) return null;
  const result = await readStoredResult(paths.result);
  const currentContractMatches = result.fingerprint === fingerprint
    && result.contractSha256 === currentContractSha256;
  if (!currentContractMatches
    || result.ttsInput?.text !== text
    || result.ttsInput?.sha256 !== textSha256
    || result.rawAudio?.path !== "raw-narration.flac") return null;
  const actualHash = await fileSha256(paths.raw);
  if (actualHash !== result.rawAudio.sha256) throw new Error("已有 tts-result 与原始音频哈希不一致，拒绝复用");
  return { ...result, reused: true };
};

const priorUnresolvedIntent = async ({ paths, fingerprint }) => {
  if (!(await exists(paths.intent))) return false;
  const intent = await readStoredIntent(paths.intent);
  if (intent.status === "not-created") return false;
  if (intent.status === "succeeded" && intent.fingerprint !== fingerprint) return false;
  if (!(await exists(paths.result)) || !(await exists(paths.raw))) return true;
  const result = await readStoredResult(paths.result);
  const resultMatchesIntent = result.fingerprint === intent.fingerprint
    && result.ttsInput?.sha256 === intent.ttsInputSha256
    && result.contractSha256 === intent.contractSha256
    && (!intent.rawAudioSha256 || result.rawAudio?.sha256 === intent.rawAudioSha256);
  if (!resultMatchesIntent) return true;
  return await fileSha256(paths.raw) !== result.rawAudio.sha256;
};

const producerFor = ({ task, business }) => programProducer({
  task: {
    ...task,
    moduleId: task.moduleId ?? "synthesize-narration",
    nodeId: task.nodeId ?? "synthesize-narration",
    taskDigest: task.taskDigest ?? hashObject({ moduleId: "synthesize-narration", business }),
    inputHashes: task.inputHashes ?? []
  },
  business
});

const writeIntent = async ({ paths, task, business }) => {
  const intent = { ...business, _producer: producerFor({ task, business }) };
  await validateDocumentSchema({
    schema: intentSchemaUrl,
    value: intent,
    label: "TTS 提交意图"
  });
  await atomicWriteData(paths.intent, intent);
  return intent;
};

const metadataMatches = (result, metadata) => result.episodeId === metadata.episodeId
  && result.seriesTitle === metadata.seriesTitle
  && result.language === metadata.language;

const reuseOrRefreshResult = async ({
  existing,
  metadata,
  paths,
  task,
  text,
  textSha256
}) => {
  const { _producer, reused, ...businessWithoutProducer } = existing;
  const business = {
    ...businessWithoutProducer,
    ...metadata,
    ttsInput: { text, sha256: textSha256 }
  };
  const refreshed = { ...business, _producer: producerFor({ task, business }) };
  await atomicWriteData(paths.result, refreshed);
  if (await exists(paths.intent)) {
    const intent = await readStoredIntent(paths.intent);
    if ((intent.status === "submitting" || intent.status === "unknown")
      && intent.fingerprint === refreshed.fingerprint
      && intent.ttsInputSha256 === refreshed.ttsInput.sha256
      && intent.contractSha256 === refreshed.contractSha256) {
      await writeIntent({
        paths,
        task,
        business: {
          ...withoutProducer(intent),
          status: "succeeded",
          rawAudioSha256: refreshed.rawAudio.sha256
        }
      });
    }
  }
  return { ...refreshed, reused: true };
};

export async function inspect({ root, episodeId, task = {} }) {
  const paths = pathsFor({ root, episodeId, task });
  const text = await textFromTask({ paths, task });
  const metadata = metadataFromTask({ episodeId, task });
  const contract = await loadTtsContract();
  const fingerprint = synthesisFingerprint({ text, contract, restartId: task.context?.stageRestartId });
  if (!(await exists(paths.result)) || !(await exists(paths.raw))) {
    if (await priorUnresolvedIntent({ paths, fingerprint })) {
      return {
        valid: false,
        paidCallRequired: false,
        unknownExternal: true,
        reason: "TTS 远端结果尚未确认，禁止新的付费请求"
      };
    }
    return {
      valid: false,
      paidCallRequired: true,
      authorizationRequired: true,
      reason: "缺少 tts-result 或原始音频，需要本次明确付费授权"
    };
  }
  const textSha256 = sha256(text);
  const currentContractSha256 = contractSha256(contract);
  const result = await currentSuccessfulResult({
    paths,
    fingerprint,
    text,
    textSha256,
    currentContractSha256
  });
  if (!result) {
    if (await priorUnresolvedIntent({ paths, fingerprint })) {
      return {
        valid: false,
        paidCallRequired: false,
        unknownExternal: true,
        reason: "TTS 远端结果尚未确认，禁止新的付费请求"
      };
    }
    return {
      valid: false,
      paidCallRequired: true,
      authorizationRequired: true,
      reason: "tts-result 与当前输入或固定 TTS 合同不一致，需要本次明确付费授权"
    };
  }
  if (!metadataMatches(result, metadata)) {
    return { valid: false, paidCallRequired: false, reason: "tts-result 元数据需刷新，可复用现有原始音频" };
  }
  return { valid: true, paidCallRequired: false, result };
}

export async function run({ root, episodeId, task = {} }) {
  const paths = pathsFor({ root, episodeId, task });
  await assertProjectMutationTree({
    root,
    file: paths.p2,
    label: "P2 TTS 合成写入树"
  });
  const text = await textFromTask({ paths, task });
  const metadata = metadataFromTask({ episodeId, task });
  await atomicWrite(paths.input, `${text}\n`);
  const contract = await loadTtsContract();
  const textSha256 = sha256(text);
  const currentContractSha256 = contractSha256(contract);
  const fingerprint = synthesisFingerprint({ text, contract, restartId: task.context?.stageRestartId });
  const currentResult = () => currentSuccessfulResult({
    paths,
    fingerprint,
    text,
    textSha256,
    currentContractSha256
  });
  const existing = await currentResult();
  if (existing) {
    return reuseOrRefreshResult({
      existing,
      metadata,
      paths,
      task,
      text,
      textSha256
    });
  }
  if (await priorUnresolvedIntent({ paths, fingerprint })) throw new UnknownRemoteResultError();
  if (!paidAuthorized(task)) throw new AuthorizationRequiredError();

  const service = task?.context?.ttsService ?? createMiniMaxTtsService();
  if (typeof service.assertReady === "function") await service.assertReady();
  const paidPreflight = task?.context?.paidPreflight ?? createP2PaidPreflight();
  if (!paidPreflight || typeof paidPreflight.assertReady !== "function") {
    throw new Error("P2 合成缺少有效的付费前本地预检");
  }
  await paidPreflight.assertReady();
  await mkdir(path.dirname(paths.lock), { recursive: true });
  return withProjectLock({ root, lock: paths.lock, label: "当前 TTS 合成", execute: async () => {
    const raced = await currentResult();
    if (raced) {
      return reuseOrRefreshResult({
        existing: raced,
        metadata,
        paths,
        task,
        text,
        textSha256
      });
    }
    if (await priorUnresolvedIntent({ paths, fingerprint })) throw new UnknownRemoteResultError();
    const request = await writeIntent({
      paths,
      task,
      business: {
      schemaVersion: "1.0",
      fingerprint,
      ttsInputSha256: textSha256,
      contractSha256: currentContractSha256,
      status: "submitting"
      }
    });
    let response;
    try {
      response = await service.synthesize({ text, contract: structuredClone(contract), fingerprint });
    } catch (error) {
      if (error?.definitiveNoRemoteTask === true) {
        await writeIntent({
          paths,
          task,
          business: { ...withoutProducer(request), status: "not-created" }
        });
        throw new RemoteTaskNotCreatedError(error.message);
      }
      await writeIntent({
        paths,
        task,
        business: { ...withoutProducer(request), status: "unknown" }
      });
      throw new UnknownRemoteResultError();
    }
    const audio = response?.audio;
    if (!(Buffer.isBuffer(audio) || audio instanceof Uint8Array) || audio.length === 0) {
      await writeIntent({
        paths,
        task,
        business: { ...withoutProducer(request), status: "unknown" }
      });
      throw new UnknownRemoteResultError();
    }
    await atomicWrite(paths.raw, audio);
    const business = {
      schemaVersion: "1.0",
      ...metadata,
      fingerprint,
      ttsInput: { text, sha256: textSha256 },
      contractSha256: currentContractSha256,
      rawAudio: { path: "raw-narration.flac", sha256: await fileSha256(paths.raw) },
      remoteTaskId: typeof response.remoteTaskId === "string" ? response.remoteTaskId : null,
      nativeTiming: response?.nativeTiming ?? null
    };
    const result = { ...business, _producer: producerFor({ task, business }) };
    await validateDocumentSchema({
      schema: resultSchemaUrl,
      value: result,
      label: "TTS 结果"
    });
    await atomicWriteData(paths.result, result);
    await writeIntent({
      paths,
      task,
      business: {
        ...withoutProducer(request),
        status: "succeeded",
        rawAudioSha256: business.rawAudio.sha256
      }
    });
    return result;
  }});
}
