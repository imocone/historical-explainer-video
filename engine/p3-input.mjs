import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertProjectPath,
  hashObject,
  sha256
} from "../packages/program-utils.mjs";
import { getEpisodePaths } from "../packages/workspace-paths.mjs";

const toMs = (stamp) => {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(stamp);
  if (!match) throw new Error(`字幕时间格式错误: ${stamp}`);
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
};

export const parseSrt = (content) => {
  const blocks = content.trim().split(/\r?\n\s*\r?\n/u);
  const cues = blocks.map((block) => {
    const lines = block.split(/\r?\n/u);
    const id = Number(lines.shift());
    const timing = lines.shift()?.split(" --> ");
    if (!Number.isInteger(id) || !timing || timing.length !== 2 || lines.length === 0) {
      throw new Error(`字幕块格式错误: ${block.slice(0, 80)}`);
    }
    return { id, startMs: toMs(timing[0]), endMs: toMs(timing[1]), text: lines.join(" ").trim() };
  });
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue.id !== index + 1) throw new Error(`字幕编号必须从 1 连续递增，实际为 ${cue.id}`);
    if (!cue.text || cue.endMs <= cue.startMs) throw new Error(`字幕 ${cue.id} 的文本或时间无效`);
    if (index > 0 && cue.startMs < cues[index - 1].endMs) throw new Error(`字幕 ${cue.id} 与上一条时间重叠`);
  }
  return cues;
};

const safeRelativePath = (baseDir, relativePath) => {
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(`${path.resolve(baseDir)}${path.sep}`)) {
    throw new Error(`输入路径越界: ${relativePath}`);
  }
  return resolved;
};

export const inspectP3Input = async ({ root, episodeId, includeSpeechTiming = false }) => {
  const paths = getEpisodePaths(root, episodeId);
  await Promise.all([
    assertProjectPath({ root, file: paths.narrationPackage, label: "P3 口播交接包路径" }),
    assertProjectPath({ root, file: paths.sourceAssets, label: "P3 来源资产清单路径" })
  ]);
  const narrationPackageText = await readFile(paths.narrationPackage, "utf8");
  const narrationPackage = JSON.parse(narrationPackageText);
  const sourceAssetsText = await readFile(paths.sourceAssets, "utf8");
  const sourceAssetsDocument = JSON.parse(sourceAssetsText);
  const sourceAssets = sourceAssetsDocument.assets ?? [];
  const fileHashes = {};
  const filePaths = {};
  for (const [key, descriptor] of Object.entries(narrationPackage.files ?? {}).filter(([key]) => ["narration", "audio", "subtitles"].includes(key))) {
    const absolute = safeRelativePath(paths.p2, descriptor.path);
    await assertProjectPath({ root, file: absolute, label: "P3 口播输入路径" });
    const info = await stat(absolute);
    if (!info.isFile() || info.size === 0) throw new Error(`输入文件为空或不存在: ${descriptor.path}`);
    fileHashes[key] = descriptor.sha256;
    filePaths[key] = absolute;
  }
  const narration = await readFile(filePaths.narration, "utf8");
  const cues = parseSrt(await readFile(filePaths.subtitles, "utf8"));
  let speechTiming;
  if (includeSpeechTiming) {
    speechTiming = {available: false, reason: '当前P2交付没有实测短语时间；不据此宣称词级精卡'};
    const descriptor = narrationPackage.evidence?.subtitleQuality;
    if (descriptor) {
      const file = safeRelativePath(paths.p2, descriptor.path);
      await assertProjectPath({root, file, label: 'P3短语时间输入路径'});
      const quality = JSON.parse(await readFile(file, 'utf8'));
      if (quality.speechTiming) {
        if (quality.speechTiming.audioSha256 !== narrationPackage.files.audio.sha256)
          throw new Error('短语时间与当前正式旁白不同源');
        speechTiming = {available: true, source: quality.semantic?.timingSource?.kind,
          cues: quality.speechTiming.cues};
      }
    }
  }
  const narrationPackageSha256 = sha256(narrationPackageText);
  const sourceAssetsSha256 = sha256(sourceAssetsText);
  const inputDigest = hashObject({
    narrationPackage,
    narrationPackageSha256,
    sourceAssetsDocument,
    sourceAssetsSha256,
    fileHashes
  });
  return {
    narrationPackage,
    narrationPackagePath: paths.narrationPackage,
    narrationPackageSha256,
    sourceAssetsDocument,
    sourceAssetsPath: paths.sourceAssets,
    sourceAssetsSha256,
    filePaths,
    inputDigest,
    narration,
    cues,
    sourceAssets,
    ...(includeSpeechTiming ? {speechTiming} : {})
  };
};
