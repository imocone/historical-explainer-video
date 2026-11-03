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
  if (hasSentenceContainers) {
    if (!value.every((cue) => Array.isArray(cue?.timestamped_words))) return null;
    const words = value.flatMap((cue) => cue.timestamped_words);
    return words.length && words.every((cue) => typeof cue?.word === "string") ? words : null;
  }
  return value.every((cue) => typeof cue?.word === "string") ? value : null;
};

const nativeTimingFrom = (value) => {
  const wordCues = nativeWordCuesFrom(value);
  if (!wordCues) return null;
  let previousSourceSpan = null;
  let lastRawEndMs = -1;
  let lastEndMs = -1;
  const cues = [];
  for (const [index, cue] of wordCues.entries()) {
    const text = typeof cue?.word === "string" ? cue.word.trim() : "";
    if (!text) continue;
    const rawWordBegin = numericValue(cue?.word_begin);
    const rawWordEnd = numericValue(cue?.word_end);
    const sourceSpan = Number.isFinite(rawWordBegin) && Number.isFinite(rawWordEnd) && rawWordEnd > rawWordBegin
      ? `${rawWordBegin}:${rawWordEnd}` : null;
    const rawStartMs = numericValue(cue?.time_begin ?? cue?.start_time ?? cue?.startMs);
    const rawEndMs = numericValue(cue?.time_end ?? cue?.end_time ?? cue?.endMs);
    let startMs = Math.round(rawStartMs);
    const endMs = Math.round(rawEndMs);
    const sameSourceSpan = sourceSpan && sourceSpan === previousSourceSpan;
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)
      || rawStartMs < 0 || rawEndMs <= rawStartMs || (!sameSourceSpan && rawStartMs < lastRawEndMs)) {
      throw new Error(`MiniMax 原生时间轴第 ${index + 1} 条无效`);
    }
    if (sameSourceSpan) {
      if (cues.at(-1)?.text !== text || startMs < cues.at(-1).startMs || rawEndMs < lastRawEndMs) {
        throw new Error(`MiniMax 同一原文区间文字或顺序不一致: ${index + 1}`);
      }
      cues.at(-1).endMs = endMs;
      lastRawEndMs = rawEndMs;
      lastEndMs = endMs;
      continue;
    }
    if (startMs < lastEndMs) startMs = lastEndMs;
    if (endMs <= startMs) throw new Error(`MiniMax 原生时间轴第 ${index + 1} 条无效`);
    lastRawEndMs = rawEndMs;
    lastEndMs = endMs;
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

const downloadNativeTiming = async ({ result, fetchImpl }) => {
  const inline = nativeTimingCuesFrom(result?.data?.subtitle);
  if (inline?.length) {
    try {
      const nativeTiming = nativeTimingFrom(inline);
      if (nativeTiming) return nativeTiming;
    } catch {
      // 字幕只是同次 TTS 的可选证据，不能让已成功生成的付费音频变成未知结果。
    }
  }
  const subtitleFile = result?.data?.subtitle_file;
  if (typeof subtitleFile !== "string" || !/^https?:\/\//iu.test(subtitleFile)) return null;
  try {
    const response = await fetchImpl(subtitleFile, { signal: AbortSignal.timeout(30_000) });
    if (!response?.ok) return null;
    const body = typeof response.json === "function"
      ? await response.json()
      : JSON.parse(await response.text());
    const cues = nativeTimingCuesFrom(body);
    return cues ? nativeTimingFrom(cues) : null;
  } catch {
    return null;
  }
};

export const miniMaxPayload = ({ text, contract }) => {
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
  const nameReadings = [
    ["秦熺", "(qin2)(xi1)"],
    ["万俟卨", "(mo4)(qi2)(xie4)"]
  ];
  const tone = nameReadings
    .filter(([name]) => text.includes(name))
    .map(([name, reading]) => `${name}/${reading}`);
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
    async synthesize({ text, contract }) {
      this.assertReady();
      let response;
      try {
        response = await fetchImpl(miniMaxApiUrl(apiHost), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(miniMaxPayload({ text, contract }))
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
        nativeTiming: await downloadNativeTiming({ result, fetchImpl }),
        remoteTaskId: typeof result?.data?.task_id === "string" ? result.data.task_id : null
      };
    }
  };
};
