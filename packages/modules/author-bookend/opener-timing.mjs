import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runMediaProcess } from "../render-video/runtime/media-process.mjs";
import { captionerRuntime } from '../../runtime-config.mjs';

const MODELS = ["JIANYING", "BIJIAN", "WHISPER_CPP"];

const spokenCharacters = (value) => Array.from(String(value ?? "").normalize("NFKC"))
  .filter((character) => /[\p{L}\p{N}]/u.test(character));

const rawCuesFrom = (value) => Object.entries(value ?? {})
  .sort(([left], [right]) => Number(left) - Number(right))
  .filter(([, cue]) => !/^[\p{P}\s]+$/u.test(String(cue?.original_subtitle ?? "")))
  .map(([, cue], index) => {
    const startMs = Math.round(Number(cue?.start_time));
    const endMs = Math.round(Number(cue?.end_time));
    const characters = spokenCharacters(cue?.original_subtitle);
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)
      || startMs < 0 || endMs <= startMs || characters.length === 0) {
      throw new Error(`VideoCaptioner 第 ${index + 1} 条词级时间无效`);
    }
    return { startMs, endMs, characters };
  });

const timedCharactersFrom = (rawCues) => rawCues.flatMap((cue) => {
  const durationMs = Math.max(cue.endMs - cue.startMs, cue.characters.length);
  return cue.characters.map((character, index) => ({
    character,
    startMs: cue.startMs + Math.floor(durationMs * index / cue.characters.length),
    endMs: cue.startMs + Math.floor(durationMs * (index + 1) / cue.characters.length)
  }));
});

const alignmentFor = ({ expected, actual }) => {
  const rows = expected.length + 1;
  const columns = actual.length + 1;
  const costs = Array.from({ length: rows }, () => new Uint16Array(columns));
  const moves = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (let row = 1; row < rows; row += 1) {
    costs[row][0] = row;
    moves[row][0] = 2;
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0][column] = column;
    moves[0][column] = 3;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const diagonal = costs[row - 1][column - 1]
        + (expected[row - 1].character === actual[column - 1].character ? 0 : 1);
      const deletion = costs[row - 1][column] + 1;
      const insertion = costs[row][column - 1] + 1;
      const best = Math.min(diagonal, deletion, insertion);
      costs[row][column] = best;
      moves[row][column] = diagonal === best ? 1 : deletion === best ? 2 : 3;
    }
  }
  const actualIndexByExpected = new Array(expected.length).fill(null);
  let row = expected.length;
  let column = actual.length;
  while (row > 0 || column > 0) {
    const move = moves[row][column];
    if (move === 1) {
      actualIndexByExpected[row - 1] = column - 1;
      row -= 1;
      column -= 1;
    } else if (move === 2) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return { actualIndexByExpected };
};

const sentenceCuesFromWordTimeline = ({
  rawCues,
  sentences
}) => {
  if (!Array.isArray(sentences) || !sentences.length
    || sentences.some(sentence => !sentence?.target || !spokenCharacters(sentence.text).length)
    || new Set(sentences.map(sentence => sentence.target)).size !== sentences.length) {
    throw new Error("片头真实卡点必须对应所选模板的有序口播段");
  }
  const expected = sentences.flatMap((sentence, sentenceIndex) => {
    const characters = spokenCharacters(sentence.text);
    if (!characters.length) throw new Error(`片头第 ${sentenceIndex + 1} 句没有可听文字`);
    return characters.map((character) => ({ character, sentenceIndex }));
  });
  const actual = timedCharactersFrom(rawCuesFrom(rawCues));
  const alignment = alignmentFor({ expected, actual });
  const sentenceCues = sentences.map((sentence, sentenceIndex) => {
    const expectedIndexes = expected
      .map((item, index) => item.sentenceIndex === sentenceIndex ? index : -1)
      .filter((index) => index >= 0);
    const actualIndexes = expectedIndexes
      .map((index) => alignment.actualIndexByExpected[index])
      .filter((index) => Number.isInteger(index));
    if (!actualIndexes.length) throw new Error(`VideoCaptioner 未定位片头第 ${sentenceIndex + 1} 句`);
    const firstActualIndex = Math.min(...actualIndexes);
    const lastActualIndex = Math.max(...actualIndexes);
    const first = actual[firstActualIndex];
    const last = actual[lastActualIndex];
    return {
      target: sentence.target,
      text: sentence.text,
      recognizedText: actual.slice(firstActualIndex, lastActualIndex + 1)
        .map(({ character }) => character)
        .join(""),
      startMs: first.startMs,
      endMs: last.endMs
    };
  });
  return sentenceCues;
};

// Whisper.cpp can stretch a word across a pause or give a final token zero
// duration. Use recognisable words as anchors and actual pauses for phrase
// boundaries rather than inventing times for individual characters.
const sentenceCuesFromPauses = async ({ rawCues, sentences, audioPath, durationMs }) => {
  if (!Number.isInteger(durationMs) || durationMs < 1) throw new Error("片头配音缺少实际时长");
  const words = Object.entries(rawCues ?? {}).sort(([a], [b]) => Number(a) - Number(b))
    .map(([, cue]) => ({ ...cue, characters: spokenCharacters(cue?.original_subtitle) }))
    .filter(cue => cue.characters.length);
  const actual = words.flatMap(cue => cue.characters.map(character => ({character,startMs:Math.round(Number(cue.start_time))})));
  const expected = sentences.flatMap((sentence,sentenceIndex) => spokenCharacters(sentence.text)
    .map(character => ({character,sentenceIndex})));
  const alignment = alignmentFor({expected,actual});
  const matched = sentences.map((_,sentenceIndex) => {
    const indices = expected.flatMap((item,index) => item.sentenceIndex === sentenceIndex ? [index] : []);
    const actualIndices = indices.map(index => alignment.actualIndexByExpected[index]).filter(Number.isInteger);
    const exactCount = indices.filter(index => {
      const actualIndex = alignment.actualIndexByExpected[index];
      return Number.isInteger(actualIndex) && expected[index].character === actual[actualIndex].character;
    }).length;
    if (!actualIndices.length || exactCount < Math.ceil(indices.length*.6))
      throw new Error(`本地转录无法可靠定位片头第 ${sentenceIndex+1} 段`);
    return {first:Math.min(...actualIndices),last:Math.max(...actualIndices)};
  });
  const detected = await runMediaProcess("ffmpeg", ["-hide_banner", "-nostats", "-i", audioPath,
    "-af", "silencedetect=noise=-40dB:d=0.15", "-f", "null", "-"], {capture:true, timeoutMs:30000});
  const events = [...String(detected.stderr).matchAll(/silence_(start|end):\s*([\d.]+)/gu)];
  const pauses = [];
  let start = null;
  for (const event of events) {
    const value = Math.max(0, Math.min(durationMs, Math.round(Number(event[2])*1000)));
    if (event[1] === "start") start = value;
    else if (start !== null && value > start) { pauses.push({start, end:value}); start = null; }
  }
  if (start !== null && durationMs > start) pauses.push({start, end:durationMs});
  const leading = pauses.find(pause => pause.start <= 30);
  const trailing = pauses.findLast(pause => pause.end >= durationMs - 30);
  const inner = pauses.filter(pause => pause !== leading && pause !== trailing);
  const selected = [];
  let previousIndex = -1;
  for (let i=0;i<sentences.length-1;i++) {
    const coarse = actual[matched[i+1].first]?.startMs;
    if (!Number.isInteger(coarse)) throw new Error(`本地转录无法定位第 ${i+2} 段`);
    const choices = inner.map((pause,index) => ({pause,index,
      distance:coarse < pause.start ? pause.start-coarse : coarse > pause.end ? coarse-pause.end : 0}))
      .filter(item => item.index > previousIndex).sort((a,b) => a.distance-b.distance);
    if (!choices.length || choices[0].distance > 400
      || (choices[1] && choices[1].distance === choices[0].distance))
      throw new Error(`片头第 ${i+1} 与第 ${i+2} 段之间没有可确认的真实停顿`);
    selected.push(choices[0].pause);
    previousIndex = choices[0].index;
  }
  return sentences.map((sentence,i) => {
    const recognizedText = actual.slice(matched[i].first,matched[i].last+1).map(item=>item.character).join("");
    const startMs = i === 0 ? (leading?.end ?? 0) : selected[i-1].end;
    const endMs = i === sentences.length-1 ? (trailing?.start ?? durationMs) : selected[i].start;
    if (endMs <= startMs) throw new Error(`片头第 ${i+1} 段没有可确认的有声区间`);
    return {target:sentence.target,text:sentence.text,recognizedText,startMs,endMs};
  });
};

const commandError = ({ model, error }) => {
  const detail = String(error?.message ?? "").trim().split(/\r?\n/u).at(-1);
  return `${model} 转录失败${detail ? `: ${detail}` : ""}`;
};

export const createOpenerTimingService = ({
  workDir,
  root,
  python,
  spawnImpl = spawnSync
} = {}) => {
  ({root, python} = captionerRuntime({root, python}));
  const assertReady = async () => {
    await access(root).catch(() => { throw new Error(`VideoCaptioner runtime 缺失: ${root}`); });
    await access(python).catch(() => { throw new Error(`VideoCaptioner Python 缺失: ${python}`); });
    const help = spawnImpl(
      python,
      ["-m", "videocaptioner", "transcribe", "--help"],
      { cwd: root, encoding: "utf8", timeout: 30_000 }
    );
    const usage = `${help?.stdout ?? ""}\n${help?.stderr ?? ""}`;
    if (help?.status !== 0 || !/jianying/iu.test(usage) || !/bijian/iu.test(usage)
      || !/--word-timestamps/iu.test(usage) || !/json/iu.test(usage)) {
      throw new Error("VideoCaptioner 未提供 JIANYING／BIJIAN 词级时间入口");
    }
  };
  return {
    assertReady,
    async time({
      audioPath,
      sentences,
      durationMs
    }) {
      await assertReady();
      await mkdir(workDir, { recursive: true });
      const failures = [];
      for (const model of MODELS) {
        const output = path.join(workDir, `opener-${model.toLowerCase()}-words.json`);
        try {
          await runMediaProcess(python, [
            "-m",
            "videocaptioner",
            "transcribe",
            audioPath,
            "-o",
            output,
            "--format",
            "json",
            "--asr",
            model.toLowerCase().replace("_", "-"),
            ...(model === "WHISPER_CPP" ? ["--whisper-model", "large-v3-turbo"] : []),
            "--language",
            "zh",
            "--word-timestamps",
            "--quiet"
          ], { cwd: root, capture: true, timeoutMs: 300_000 });
        } catch (error) {
          if (["MEDIA_CANCELLED", "MEDIA_RESOURCE_STOPPED"].includes(error?.code)) throw error;
          failures.push(commandError({ model, error }));
          continue;
        }
        try {
          const rawText = await readFile(output, "utf8");
          const raw = JSON.parse(rawText);
          let sentenceCues;
          if (model === "WHISPER_CPP" && sentences.every(sentence => /^O[0-9]{2,}$/u.test(sentence.target))) {
            try { sentenceCues = await sentenceCuesFromPauses({rawCues:raw, sentences, audioPath, durationMs}); }
            catch { sentenceCues = sentenceCuesFromWordTimeline({rawCues:raw, sentences}); }
          } else sentenceCues = sentenceCuesFromWordTimeline({rawCues:raw, sentences});
          return {
            sentenceCues,
            evidence: {
              provider: "video-captioner",
              actualModel: model,
              fallbackOccurred: model !== MODELS[0],
              wordTimelineSha256: createHash("sha256").update(rawText).digest("hex")
            }
          };
        } catch (error) {
          failures.push(`${model} 对齐失败: ${error.message}`);
        }
      }
      throw new Error(`VideoCaptioner 无法形成片头真实卡点：${failures.join("；")}`);
    }
  };
};
