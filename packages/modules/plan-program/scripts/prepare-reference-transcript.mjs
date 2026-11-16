import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toMs = stamp => {
  const [hours, minutes, seconds, milliseconds] = stamp.split(/[:,.]/u).map(Number);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
};

export function referenceTranscript(content) {
  const source = content.replace(/^\uFEFF/u, "");
  let segments, texts;
  if (source.trimStart().startsWith("{")) {
    const data = JSON.parse(source);
    if (typeof data.text === "string" && data.text.trim()) return { audioReviewed: false, ...data };
    if (Array.isArray(data.events)) {
      segments = data.events;
      texts = segments.map(event => (event.segs ?? []).map(segment => segment.utf8 ?? "").join(""));
    } else {
      const keys = Object.keys(data);
      if (!keys.length || keys.some(key => !/^\d+$/u.test(key))) {
        throw new Error("不支持的底稿JSON：需要完整text、JSON3 events或VideoCaptioner编号字幕");
      }
      segments = keys.sort((a, b) => Number(a) - Number(b)).map(key => data[key]);
      texts = segments.map(segment => segment.original_subtitle);
    }
  } else {
    segments = source.replace(/\r\n?/gu, "\n").trim().split(/\n[ \t]*\n/u).map(block => {
      const lines = block.split("\n");
      const timingIndex = lines[0]?.includes("-->") ? 0 : 1;
      const match = /^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})(?:[ \t]+.*)?$/u.exec(lines[timingIndex] ?? "");
      if (!match) throw new Error("SRT时间行无效，不能生成完整底稿");
      return { startMs: toMs(match[1]), endMs: toMs(match[2]), text: lines.slice(timingIndex + 1).join("\n") };
    });
    texts = segments.map(segment => segment.text);
  }
  if (texts.some(text => typeof text !== "string")) throw new Error("底稿片段缺少原始文字");
  const text = texts.filter(part => part.trim()).join("\n");
  if (!text.trim()) throw new Error("底稿没有可读取的完整文字");
  return { text, segments, audioReviewed: false };
}

export async function prepareReferenceTranscript(inputPath, outputPath) {
  const transcript = referenceTranscript(await readFile(inputPath, "utf8"));
  const content = `${JSON.stringify(transcript, null, 2)}\n`;
  // Raw inputs and existing transcripts remain intact; callers reuse completed outputs.
  await writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  return { path: path.resolve(outputPath), sha256: createHash("sha256").update(content).digest("hex") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  try {
    if (!inputPath || !outputPath || extra.length) {
      throw new Error("用法: node prepare-reference-transcript.mjs <字幕.srt或.json3或.json> <新底稿.json>");
    }
    console.log(JSON.stringify(await prepareReferenceTranscript(inputPath, outputPath)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
