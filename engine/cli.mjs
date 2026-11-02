#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptCandidate,
  checkProject,
  deriveStatus,
  resetStage,
  runRange,
  projectStatus,
  runNext
} from "./runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commands = new Set(["check", "status", "next", "accept", "reset", "run"]);

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (!commands.has(command)) throw new Error("公共命令只能是 check / status / next / accept / reset / run");
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--episode") options.episodeId = rest[++index];
    else if (flag === "--workspace") options.workspaceRoot = path.resolve(rest[++index]);
    else if (flag === "--program") options.programId = rest[++index];
    else if (flag === "--target") options.targetId = rest[++index];
    else if (flag === "--claim" && command === "next") {
      options.claim = rest[++index];
      if (!["fullframe", "explainer"].includes(options.claim)) throw new Error("--claim 必须为 fullframe 或 explainer");
    }
    else if (flag === "--node" && ["status", "next", "accept"].includes(command)) {
      options.nodeId = rest[++index];
      if (!["opener", "video", "video-assets", "render"].includes(options.nodeId)) throw new Error("--node 必须为 opener / video / video-assets / render");
    }
    else if (flag === "--segment" && ["status", "next", "accept"].includes(command)) {
      options.segmentId = rest[++index];
      if (!/^TR[0-9]{3,}$/u.test(options.segmentId ?? "")) throw new Error("--segment 必须为TR段编号");
    }
    else if (flag === "--stage" && command !== "check") options.stageId = rest[++index];
    else if(flag==='--video'&&['next','run'].includes(command)){options.video=rest[++index];if(!['on','off'].includes(options.video))throw new Error('--video须为on或off');}
    else if (flag === '--sound-effects' && command === 'next') {
      options.soundEffects = rest[++index];
      if (!['on','off'].includes(options.soundEffects)) throw new Error('--sound-effects 必须为 on 或 off');
    }
    else if (flag === "--from" && command === "run") options.fromStage = rest[++index];
    else if (flag === "--to" && command === "run") options.toStage = rest[++index];
    else if (flag === "--pause" && command === "run") options.pause = true;
    else if (flag === "--resume" && command === "run") options.resume = true;
    else if (flag === "--advance" && command === "run") options.advance = true;
    else if (flag === "--revise-program" && command === "next") options.reviseProgram = true;
    else if (flag === "--revise-opener" && command === "next") options.reviseOpener = true;
    else if (flag === "--opener-text" && command === "next") options.openerText = rest[++index];
    else if (flag === "--revise-narration" && command === "next") options.reviseNarration = true;
    else if (flag === "--revise-subtitles" && command === "next") options.reviseSubtitles = true;
    else if (flag === "--replace-narration-revision" && command === "next") options.replaceNarrationRevision = true;
    else if (flag === "--rerun-narration" && command === "next") options.rerunNarration = true;
    else if (flag === "--replace-full-rerun" && command === "next") options.replaceFullRerun = true;
    else if (flag === "--redesign-body" && command === "next") options.redesignBody = true;
    else if (flag === "--revise-quotes" && command === "next") options.reviseQuotes = true;
    else if (flag === "--revise-director" && command === "next") options.reviseDirector = true;
    else if (flag === "--replace-body-redesign" && command === "next") options.replaceBodyRedesign = true;
    else if (flag === "--cancel-director-revision" && command === "next") options.cancelDirectorRevision = true;
    else if (flag === "--beat" && command === "next") {
      options.redesignBeatIds ??= [];
      options.redesignBeatIds.push(rest[++index]);
    }
    else if (flag === "--revise-publication" && command === "next") options.revisePublication = true;
    else if (flag === "--revise-video" && command === "next") options.reviseVideo = true;
    else if (flag === "--revise-cover" && command === "next") options.reviseCover = true;
    else if (flag === "--revision-reason" && command === "next") {
      options.revisionReason = rest[++index];
      if (!options.revisionReason || options.revisionReason.startsWith("--")) throw new Error("--revision-reason 缺少本次具体修改意见");
    }
    else if (flag === "--publication-field" && command === "next") {
      options.publicationFields ??= [];
      options.publicationFields.push(rest[++index]);
    }
    else if (flag === "--regenerate-cover" && command === "next") options.regenerateCover = true;
    else if (flag === "--replace-cover-task" && command === "next") options.replaceCoverTask = true;
    else if (flag === "--cover-record" && command === "next") options.coverRecord = rest[++index] ?? "";
    else if (flag === "--cancel-cover-regeneration" && command === "next") options.cancelCoverRegeneration = true;
    else if (flag === "--adopt-cover-examples" && command === "next") options.adoptCoverExamples = true;
    else if (flag === "--adopt-cover-images" && command === "next") {
      const selection = rest[++index];
      if (!selection || selection.startsWith("--")) throw new Error("--adopt-cover-images 缺少指定双图JSON路径");
      options.adoptCoverImages = path.resolve(selection);
    }
    else if (flag === "--cover-variant" && command === "next") {
      options.coverVariants ??= [];
      options.coverVariants.push(rest[++index]);
    }
    else if (flag === "--authorize-paid-tts" && ["next", "accept", "run"].includes(command)) options.authorizePaidTts = true;
    else if (flag === "--explain" && command === "check") options.explain = rest[index + 1]?.startsWith("--") ? true : rest[++index] ?? true;
    else throw new Error(`未知参数: ${flag}`);
  }
  if (options.nodeId && options.stageId !== "p4") throw new Error("--node 只用于P4节点");
  if (options.segmentId && options.stageId !== "p3") throw new Error("--segment 只用于P3正文作者");
  if (!["check", "run", "status"].includes(command) && !options.stageId) {
    throw new Error(`${command} 必须提供 --stage <stage>`);
  }
  // Parse and normalize once; business combinations belong to validateNextOptions.
  if (typeof options.openerText === "string") options.openerText = options.openerText.trim();
  if (command !== "check" && !options.workspaceRoot) {
    throw new Error(`${command} 必须提供 --workspace <节目工作区>`);
  }
  if (command !== "check" && options.stageId === "p0" && !options.programId) {
    throw new Error(`${command} --stage p0 必须提供 --program <program>`);
  }
  options.targetId ??= "release-main";
  if (command !== "check" && !(command === "status" && !options.stageId) && options.stageId !== "p0" && !options.episodeId) {
    throw new Error(`${command} --stage ${options.stageId} 必须提供 --episode <episode>`);
  }
  return options;
};

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.workspaceRoot === root) {
    throw new Error("节目工作区必须位于系统代码仓之外");
  }
  let result;
  if (options.command === "check") {
    result = await checkProject({
      root,
      workspaceRoot: options.workspaceRoot,
      episodeId: options.episodeId,
      programId: options.programId,
      explain: options.explain
    });
    if (!result.ok) process.exitCode = 1;
  } else if (options.command === "status") {
    result = await (options.stageId ? deriveStatus : projectStatus)({ root, ...options });
  } else if (options.command === "next") {
    result = await runNext({ root, ...options });
  } else if (options.command === "reset") {
    result = await resetStage({ root, ...options });
  } else if (options.command === "run") {
    result = await runRange({ root, ...options });
  } else {
    result = await acceptCandidate({
      root,
      workspaceRoot: options.workspaceRoot,
      episodeId: options.episodeId,
      programId: options.programId,
      targetId: options.targetId,
      stageId: options.stageId,
      segmentId: options.segmentId,
      nodeId: options.nodeId,
      acceptanceServices: {
        authorizePaidTts: options.authorizePaidTts === true
      }
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
