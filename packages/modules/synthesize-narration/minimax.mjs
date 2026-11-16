import { runtimeEnvironment, runtimeEnvFile } from '../../runtime-config.mjs';

const DEFAULT_API_HOST = 'https://api.minimaxi.com';
const API_HOSTS = new Set([DEFAULT_API_HOST, 'https://api.minimax.cn', 'https://api.minimax.io']);
const DEFINITIVE_SERVICE_CODES = new Set([2013, 2049, 20132]);
const DEFINITIVE_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

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

export const resolveMiniMaxApiKey = ({
  environment = process.env,
  envFile = runtimeEnvFile
} = {}) => {
  return String(runtimeEnvironment({environment, envFile}).MINIMAX_API_KEY ?? '').trim();
};

export const miniMaxApiUrl = value => {
  const host = String(value ?? '').trim().replace(/\/$/u, '') || DEFAULT_API_HOST;
  if (!API_HOSTS.has(host)) throw localPreflightError('MINIMAX_API_HOST 须为 https://api.minimaxi.com、https://api.minimax.cn 或 https://api.minimax.io');
  return `${host}/v1/t2a_v2`;
};

const audioFromHex = (value) => {
  if (typeof value !== "string" || !value || value.length % 2 !== 0 || !/^[a-f0-9]+$/iu.test(value)) {
    throw new Error("MiniMax TTS 返回了无效音频数据");
  }
  const audio = Buffer.from(value, "hex");
  if (!audio.length) throw new Error("MiniMax TTS 返回了空音频");
  return audio;
};

const numericValue = (value) => value === null || value === undefined || value === ""
  ? Number.NaN
  : Number(value);

const nativeWordCuesFrom = (value) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const hasSentenceContainers = value.some((cue) => Object.hasOwn(cue ?? {}, "timestamped_words"));
  const sections = hasSentenceContainers ? value : [{ timestamped_words: value }];
  if (!sections.every((section) => Array.isArray(section?.timestamped_words)
    && section.timestamped_words.every((cue) => typeof cue?.word === "string"))) return null;
  return sections.flatMap((section, sectionIndex) => section.timestamped_words.map((cue) => ({ cue, section, sectionIndex })));
};

const nativeTimingFrom = (value, sourceText) => {
  const wordCues = nativeWordCuesFrom(value);
  if (!wordCues) return null;
  const sourceCharacters = Array.from(sourceText ?? "");
  let previousSourceSpan = null;
  let lastRawStartMs = -1;
  let lastRawEndMs = -1;
  const cues = [];
  for (const [index, { cue, section, sectionIndex }] of wordCues.entries()) {
    const text = typeof cue?.word === "string" ? cue.word.trim() : "";
    if (!text) continue;
    const rawWordBegin = numericValue(cue?.word_begin);
    const rawWordEnd = numericValue(cue?.word_end);
    const sourceSpan = Number.isInteger(rawWordBegin) && rawWordBegin >= 0
      && Number.isInteger(rawWordEnd) && rawWordEnd > rawWordBegin
      ? `${sectionIndex}:${rawWordBegin}:${rawWordEnd}` : null;
    const rawStartMs = numericValue(cue?.time_begin ?? cue?.start_time ?? cue?.startMs);
    const rawEndMs = numericValue(cue?.time_end ?? cue?.end_time ?? cue?.endMs);
    const startMs = Math.round(rawStartMs);
    const endMs = Math.round(rawEndMs);
    const sameSourceSpan = sourceSpan && sourceSpan === previousSourceSpan;
    // A silent punctuation token carries no timing evidence and is restored from the narration.
    if (rawStartMs === rawEndMs && /^\p{P}+$/u.test(text) && !/[%‰‱]/u.test(text.normalize("NFKC"))) continue;
    // The subtitle consumer preserves measured overlaps between neighbouring words.
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)
      || rawStartMs < 0 || rawEndMs <= rawStartMs
      || rawStartMs < lastRawStartMs || rawEndMs < lastRawEndMs) {
      throw new Error(`MiniMax 原生时间轴第 ${index + 1} 条无效`);
    }
    lastRawStartMs = rawStartMs;
    lastRawEndMs = rawEndMs;
    if (sameSourceSpan) {
      const previous = cues.at(-1);
      if (previous.text !== text) {
        // The provider may split a normalized reading (such as a year) over one source span.
        const sectionStart = Number.isInteger(section.text_begin) && typeof section.text === "string"
          ? section.text_begin : 0;
        const characters = typeof section.text === "string" && Number.isInteger(section.text_begin)
          ? Array.from(section.text) : sourceCharacters;
        const original = rawWordBegin >= sectionStart && rawWordEnd <= sectionStart + characters.length
          ? characters.slice(rawWordBegin - sectionStart, rawWordEnd - sectionStart).join("").trim() : "";
        if (!original) throw new Error(`MiniMax 同一原文区间无法映射到合成输入: ${index + 1}`);
        previous.text = original;
      }
      previous.endMs = endMs;
      continue;
    }
    if (endMs <= startMs) throw new Error(`MiniMax 原生时间轴第 ${index + 1} 条无效`);
    cues.push({ text, startMs, endMs });
    previousSourceSpan = sourceSpan;
  }
  if (!cues.length) return null;
  return {
    source: "provider-native",
    provider: "minimax",
    granularity: "word",
    cues
  };
};

const nativeTimingCuesFrom = (value) => {
  if (Array.isArray(value)) return value;
  for (const candidate of [
    value?.subtitle,
    value?.subtitles,
    value?.data?.subtitle,
    value?.data?.subtitles,
    value?.data
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
};

const unavailableNativeTiming = (reason) => {
  console.warn(`MiniMax 未取得原生词级时间：${reason}`);
  return null;
};

const downloadNativeTiming = async ({ result, fetchImpl, sourceText, downloadedSubtitle, onDownloadedSubtitle }) => {
  const inline = nativeTimingCuesFrom(result?.data?.subtitle);
  let inlineIssue;
  if (inline?.length) {
    try {
      const nativeTiming = nativeTimingFrom(inline, sourceText);
      if (nativeTiming) return nativeTiming;
    } catch (error) {
      inlineIssue = error.message;
    }
  }
  const subtitleFile = result?.data?.subtitle_file;
  if (typeof subtitleFile !== "string" || !/^https?:\/\//iu.test(subtitleFile)) {
    return unavailableNativeTiming(inlineIssue ?? "响应没有可用的字幕下载链接或内嵌词级时间");
  }
  let subtitleText = downloadedSubtitle;
  if (subtitleText === undefined) {
    let response;
    try {
      response = await fetchImpl(subtitleFile, { signal: AbortSignal.timeout(30_000) });
    } catch {
      return unavailableNativeTiming("字幕文件下载连接失败或超时");
    }
    if (!response.ok) return unavailableNativeTiming(`字幕文件下载返回 HTTP ${response.status}`);
    try {
      subtitleText = await response.text();
    } catch {
      return unavailableNativeTiming("无法读取字幕文件内容");
    }
    await onDownloadedSubtitle?.(subtitleText);
  }
  try {
    const cues = nativeTimingCuesFrom(JSON.parse(subtitleText));
    return nativeTimingFrom(cues, sourceText) ?? unavailableNativeTiming("字幕文件不含词级时间");
  } catch (error) {
    return unavailableNativeTiming(error instanceof SyntaxError ? "字幕文件不是有效 JSON" : error.message);
  }
};

export const validatePronunciations = (pronunciations = []) => {
  if (!Array.isArray(pronunciations)) throw new Error("本集读音必须为数组");
  const seen = new Set();
  for (const item of pronunciations) {
    if (!item || Object.keys(item).sort().join() !== "reading,text"
      || [item.text, item.reading].some(value => typeof value !== "string" || !value.trim()
        || value !== value.trim() || /[\/\r\n]/u.test(value)) || seen.has(item.text)) {
      throw new Error("读音项须为不重复的text与reading，不能含斜杠或换行");
    }
    seen.add(item.text);
  }
  return [...pronunciations].sort((a, b) => a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
};

export const miniMaxPayload = ({ text, contract, pronunciations = [] }) => {
  const voiceSetting = {
    voice_id: contract.voice,
    speed: contract.speechRate,
    vol: contract.volume,
    pitch: contract.pitch
  };
  if (contract.emotion !== "auto") voiceSetting.emotion = contract.emotion;
  const payload = {
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
    output_format: "hex",
    aigc_watermark: false
  };
  // Explicit name readings prevent rare characters and compound surnames
  // from being guessed or omitted by the speech model. Keep the written text.
  const tone = validatePronunciations(pronunciations)
    .filter(item => text.includes(item.text))
    .map(item => `${item.text}/${item.reading}`);
  if (tone.length) payload.pronunciation_dict = { tone };
  if (contract.subtitleGranularity) {
    payload.subtitle_enable = true;
    payload.subtitle_type = contract.subtitleGranularity;
  } else {
    payload.subtitle_enable = false;
  }
  return payload;
};

export const createMiniMaxTtsService = (options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    environment = process.env,
    envFile = runtimeEnvFile
  } = options;
  const apiKey = Object.hasOwn(options, "apiKey")
    ? options.apiKey
    : resolveMiniMaxApiKey({ environment, envFile });
  const apiHost = runtimeEnvironment({environment, envFile}).MINIMAX_API_HOST;
  return {
    assertReady() {
      if (typeof apiKey !== "string" || !apiKey.trim()) throw localPreflightError("已获授权但缺少 MINIMAX_API_KEY，未发起远端请求");
      if (typeof fetchImpl !== "function") throw localPreflightError("当前运行时不支持 MiniMax 网络请求");
      miniMaxApiUrl(apiHost);
    },
    async readNativeTiming(source, { sourceText, downloadedSubtitle, onDownloadedSubtitle } = {}) {
      return downloadNativeTiming({ result: source, fetchImpl, sourceText, downloadedSubtitle, onDownloadedSubtitle });
    },
    async synthesize({ text, contract, pronunciations }) {
      this.assertReady();
      let response;
      try {
        response = await fetchImpl(miniMaxApiUrl(apiHost), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(miniMaxPayload({ text, contract, pronunciations }))
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
      const audio = audioFromHex(result?.data?.audio);
      const { subtitle, subtitle_file } = result.data;
      if (contract.subtitleGranularity && !subtitle && !subtitle_file) {
        unavailableNativeTiming("合成响应未返回字幕文件或内嵌时间");
      }
      return {
        audio,
        nativeTiming: null,
        ...(subtitle || subtitle_file ? {
          nativeTimingSource: { data: { subtitle, subtitle_file } }
        } : {}),
        ...(Number.isFinite(result?.extra_info?.audio_length) && result.extra_info.audio_length > 0
          ? { durationMs: Math.round(result.extra_info.audio_length) } : {}),
        remoteTaskId: typeof result?.data?.task_id === "string" ? result.data.task_id : null
      };
    }
  };
};
