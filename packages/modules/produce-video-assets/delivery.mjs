import { projectVideoProduction } from "../../templates/cinematic-video/production-projection.mjs";
import path from "node:path";
import { copyFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { runMediaProcess } from "../render-video/runtime/media-process.mjs";
import { assertProjectPath, hashObject, readData, withoutProducer } from "../../program-utils.mjs";
import { getEpisodePaths } from "../../workspace-paths.mjs";
import { VIDEO_SPEC } from "../../video-spec.mjs";
import { videoWindow } from "../../templates/cinematic-video/timing.mjs";
import { videoRequestFor, videoRequestBusinessKey } from "../../templates/cinematic-video/asset-contract.mjs";

export const probe = async (file) => JSON.parse((await runMediaProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { timeoutMs: 15000, capture: true, maxBuffer: 2 * 1024 * 1024 })).stdout);

export const assertVideoFilePresent = async (file) => {
  const info = await stat(file);
  if (!info.isFile() || !info.size) throw new Error(`视频交付不是非空文件: ${file}`);
};

export const assertVideoFile = async ({ file, durationMs, frameCount = Math.round(durationMs * VIDEO_SPEC.fps / 1000), media = null }) => {
  media ??= await probe(file);
  const videos = media.streams.filter(({ codec_type }) => codec_type === "video");
  const video = videos[0];
  const [numerator, denominator] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  if (videos.length !== 1 || media.streams.some(({ codec_type }) => codec_type === "audio")
    || video.width !== VIDEO_SPEC.width || video.height !== VIDEO_SPEC.height
    || video.codec_name !== VIDEO_SPEC.videoAsset.codec || video.pix_fmt !== VIDEO_SPEC.videoAsset.pixelFormat
    || numerator / denominator !== VIDEO_SPEC.fps || Number(video.nb_frames) !== frameCount
    || Math.abs(Number(video.duration ?? media.format.duration) * 1000 - durationMs) > 1000 / VIDEO_SPEC.fps)
    throw new Error("视频须满足正式画幅、帧率、帧数、无声H.264与完整时长，不能循环或冻结延长动作");
};

const encodeArgs = ["-c:v", VIDEO_SPEC.videoAsset.ffmpegCodec, "-pix_fmt", VIDEO_SPEC.videoAsset.pixelFormat, "-crf", "18", "-threads", "2", "-movflags", "+faststart"];
const runFfmpeg = (args) => runMediaProcess("ffmpeg", ["-v", "error", "-y", "-threads", "2", "-filter_threads", "2", "-filter_complex_threads", "2", ...args], { timeoutMs: 300000 });

export const inspectSource = async ({ file, request }) => {
  const media = await probe(file);
  const video = media.streams.find(({ codec_type }) => codec_type === "video");
  const duration = Number(video?.duration ?? media.format.duration);
  if (!video || Math.abs(video.width / video.height - 16 / 9) > .01
    || !Number.isFinite(duration) || duration + .05 < request.seconds)
    throw Object.assign(new Error("原视频画幅或时长不足，不能拉伸、循环或冻结填满"), { code: "VIDEO_SOURCE_INVALID" });
  const frameCount = Math.floor(duration * VIDEO_SPEC.fps + 1e-6);
  if (frameCount < request.frameCount) throw Object.assign(new Error("原生成来源帧数不足设计时窗，不能填帧延长"), { code: "VIDEO_SOURCE_INVALID" });
  return { frameCount };
};

export const cutsFor = ({ partPlan, cuts, sourceFrameCount }) => {
  if (!Array.isArray(cuts) || cuts.length !== partPlan.shots.length) throw new Error("须为本组每个镜头选择实际来源范围");
  let previousEnd = 0;
  const selected = cuts.map((cut, index) => {
    const shot = partPlan.shots[index];
    if (cut.shotId !== shot.id || !Number.isInteger(cut.sourceStartFrame)
      || !Number.isInteger(cut.sourceEndFrame) || cut.sourceEndFrame <= cut.sourceStartFrame
      || cut.sourceStartFrame < previousEnd || cut.sourceEndFrame > sourceFrameCount)
      throw new Error(`${shot.id} 来源起止须为有效帧，按镜头顺序、不重叠且不超出原片；不能冻结或变速填长`);
    previousEnd = cut.sourceEndFrame;
    return { shotId: shot.id, sourceStartFrame: cut.sourceStartFrame, frameCount: cut.sourceEndFrame - cut.sourceStartFrame };
  });
  if (selected.reduce((sum, cut) => sum + cut.frameCount, 0) !== partPlan.bodyFrameCount)
    throw new Error("实际镜头总帧数须精确覆盖本次正文窗口；只调整切点，不改变旁白时长");
  // The body range comes from the plan or an explicitly requested edit. Handles are contiguous footage,
  // never another cut, retimed action, duplicated frame or generated filler.
  if (selected[0].sourceStartFrame < partPlan.headHandleFrames
    || previousEnd + partPlan.tailHandleFrames > sourceFrameCount)
    throw new Error("正文取材前后缺少真实运动余量；在原来源重选有效范围，素材不足返回原生产问题，不能冻结或变速补齐");
  selected[0].sourceStartFrame -= partPlan.headHandleFrames;
  selected[0].frameCount += partPlan.headHandleFrames;
  selected.at(-1).frameCount += partPlan.tailHandleFrames;
  return selected;
};

export const editDigestFor = ({ sourceSha256, cuts }) => hashObject({ sourceSha256, cuts });

export const editPart = async ({ source, cuts, file }) => {
  const inputs = cuts.map((_, index) => `[s${index}]`).join("");
  const filters = [`[0:v]setpts=PTS-STARTPTS,fps=${VIDEO_SPEC.fps},scale=${VIDEO_SPEC.width}:${VIDEO_SPEC.height}:flags=lanczos,setsar=1,setpts=N/(${VIDEO_SPEC.fps}*TB)[normalized]`,
    ...(cuts.length > 1 ? [`[normalized]split=${cuts.length}${inputs}`] : [])];
  cuts.forEach((cut, index) => filters.push(
    `${cuts.length > 1 ? `[s${index}]` : "[normalized]"}trim=start_frame=${cut.sourceStartFrame}:end_frame=${cut.sourceStartFrame + cut.frameCount},setpts=PTS-STARTPTS[v${index}]`));
  filters.push(`${cuts.map((_, index) => `[v${index}]`).join("")}concat=n=${cuts.length}:v=1:a=0[out]`);
  await runFfmpeg(["-i", source, "-filter_complex", filters.join(";"), "-map", "[out]", "-an", ...encodeArgs, file]);
  const frameCount = cuts.reduce((sum, cut) => sum + cut.frameCount, 0);
  await assertVideoFile({ file, frameCount, durationMs: frameCount * 1000 / VIDEO_SPEC.fps });
};

export const integrateParts = async ({ files, parts, file }) => {
  if (files.length !== parts.length || !parts.length) throw new Error("只能整合本段实际完成的有序生成组");
  if (parts.length === 1) await copyFile(files[0], file);
  else {
    // All parts are already frame-exact outputs of editPart with the same encoding contract.
    const list = path.join(path.dirname(file), "parts.concat.txt");
    if (files.some((source) => /[\r\n]/u.test(source))) throw new Error("视频路径不能包含换行符");
    await writeFile(list, files.map((source) => `file '${path.resolve(source).replace(/'/gu, "'\\''")}'`).join("\n") + "\n");
    try {
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", file]);
    } finally { await rm(list, { force: true }); }
  }
  const frameCount = parts.reduce((sum, part) => sum + part.frameCount, 0);
  await assertVideoFile({ file, frameCount, durationMs: frameCount * 1000 / VIDEO_SPEC.fps });
};

export const deliveryDigestFor = ({ spanId, firstFrameSha256, parts }) => hashObject({ spanId, firstFrameSha256, parts });

export const firstFrameFor = ({span, clip = null}) => {
  if (!span.asset?.file || !span.asset.sha256) throw new Error(`${span.id} 缺少作者交付的实际首图`);
  if (clip?.firstFrame) {
    if (clip.firstFrame.parentSha256 !== span.asset.sha256 || clip.firstFrame.sha256 !== clip.firstFrameSha256)
      throw new Error(`${span.id} 实际首图未绑定原图片及视频来源`);
    return clip.firstFrame;
  }
  return span.asset;
};

export const generationReferenceFor = (receipt) => {
  const { projectId, nodeId, resourceId } = receipt?.canvas ?? {};
  if (!["generated", "complete"].includes(receipt?.state) || !projectId || !nodeId || !resourceId)
    throw new Error("前组尚无可引用的成功原生成对象");
  return { projectId, nodeId, resourceId };
};

export const readPartReceipts = async ({ root, directory }) => {
  await assertProjectPath({ root, file: directory, label: "分次任务目录" });
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const receipts = [];
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/u.test(entry.name)) continue;
    const file = path.join(directory, entry.name, "generation.json");
    await assertProjectPath({ root, file, label: "原分次任务" });
    let receipt;
    try { receipt = await readData(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (hashObject(receipt.request) !== entry.name || receipt.requestDigest !== entry.name)
      throw new Error("原分次提交记录不完整，保持现场，禁止重投");
    receipts.push(receipt);
  }
  return receipts;
};

// Recovery, generation and acceptance must agree before retiring an original.
export const replacementChildrenFor = (receipts) => {
  const children = new Map();
  for (const receipt of receipts.filter(({ request }) => request.replacesRequestDigest)) {
    const parent = receipts.find(({ requestDigest }) => requestDigest === receipt.request.replacesRequestDigest);
    if (!parent || !["complete", "generated", "failed", "pending"].includes(parent.state) || !parent.submitId || children.has(parent.requestDigest))
      throw new Error("分次替换关系不完整或有分叉，保持现场，禁止重投");
    const { replacesRequestDigest, ...payload } = receipt.request;
    const { replacesRequestDigest: _oldReplacement, ...parentPayload } = parent.request;
    // Explicit replacement may rebind the previous video, but cannot rewrite the design.
    const content = ({ previousPartSha256, previousGeneration, previousPartRequestDigest, ...request }) => request;
    if (hashObject(content(payload)) !== hashObject(content(parentPayload))
      || (payload.partIndex === 1 && hashObject(payload) !== hashObject(parentPayload)))
      throw new Error("定点重生只能更新实际前段依赖，不能改变原设计或其它请求内容");
    children.set(parent.requestDigest, receipt);
  }
  return children;
};

// Generation and acceptance resolve the same explicit replacement chain, never file dates.
const sourceContentKey = ({ frameCount, seconds, previousPartSha256, previousGeneration,
  previousPartRequestDigest, replacesRequestDigest, prompt, ...input }) => {
  const lines = (prompt ?? "").split("\n");
  lines[0] = lines[0].replace(/^将@Video 1向后延长\d+秒，/u, "将@Video 1向后延长，");
  if (lines[1]?.startsWith("时间安排："))
    lines[1] = lines[1].replace(/；其后至\d+(?:\.\d+)?秒继续末镜已有活动和运镜，作为接出余量/u, "");
  return hashObject({ ...input, prompt: lines.join("\n") });
};

export const selectPartRequest = ({ receipts, proposedRequest, previousReceipt = null, regenerateFrom = null, allowPendingReplacement = false }) => {
  // A changed predecessor is still the same paid continuation, not permission for a new root.
  const designKey = (request) => hashObject({
    business: videoRequestBusinessKey({ ...request, previousPartSha256: undefined, previousGeneration: undefined }),
    restartId: request.stageRestartId ?? null
  });
  // A shorter exit handle can reuse a successful source of the same activity and body clock.
  // Keep the original paid identity; only the local cut changes.
  const reusable = (receipt, request) => ["complete", "generated"].includes(receipt.state)
    && (receipt.state === "generated" || receipt.source?.frameCount >= request.frameCount)
    && receipt.request.frameCount >= request.frameCount && receipt.request.seconds >= request.seconds
    && sourceContentKey(receipt.request) === sourceContentKey(request);
  const exact = receipts.filter((receipt) => designKey(receipt.request) === designKey(proposedRequest));
  const reusableDesigns = new Set(receipts.filter((receipt) => reusable(receipt, proposedRequest))
    .map(({ request }) => designKey(request)));
  // A reusable replacement still belongs to its original paid chain.
  const matching = exact.length ? exact : receipts.filter(({ request }) => reusableDesigns.has(designKey(request)));
  if (receipts.some((receipt) => !matching.includes(receipt) && !["complete", "generated", "failed"].includes(receipt.state)))
    throw new Error("本次已有未收口或结果未知的原任务，不能另建任务");
  const roots = matching.filter(({ request }) => !request.replacesRequestDigest);
  const children = replacementChildrenFor(matching);
  if (matching.length && roots.length !== 1) throw new Error("同一实际输入存在多个原任务或替换环，保持现场");
  let current = roots[0] ?? null;
  let visited = current ? 1 : 0;
  while (current && children.has(current.requestDigest) && visited <= matching.length) {
    current = children.get(current.requestDigest);
    visited += 1;
  }
  if (visited !== matching.length) throw new Error("分次替换链不能确定唯一当前任务");
  if (current?.request.previousPartSha256 && previousReceipt && !previousReceipt.part)
    return { receipt: current, request: current.request, needsPreviousEdit: true };
  const reference = current?.request.previousPartSha256 && previousReceipt
    ? { previousGeneration: undefined, previousPartSha256: previousReceipt.part.sha256 } : {};
  const proposed = { ...proposedRequest, ...reference,
    ...(previousReceipt ? { previousPartRequestDigest: previousReceipt.requestDigest } : {}) };
  const sameInput = (request) => (videoRequestBusinessKey(request) === videoRequestBusinessKey(proposed)
    || (current?.request === request && reusable(current, proposed)
      && request.previousPartSha256 === proposed.previousPartSha256
      && hashObject(request.previousGeneration ?? null) === hashObject(proposed.previousGeneration ?? null)))
    && request.previousPartRequestDigest === proposed.previousPartRequestDigest;
  if (regenerateFrom) {
    const original = matching.find(({ requestDigest }) => requestDigest === regenerateFrom);
    if (!original || !original.submitId)
      throw new Error("定点重生须指向当前输入下已有编号的原分次任务；无编号任务不得替换");
    const replacement = children.get(regenerateFrom);
    if (replacement) {
      if (replacement !== current || !sameInput(replacement.request)) throw new Error("该重生命令已被后续任务或前段修改替代；须明确当前受影响任务后再授权");
      return { receipt: replacement, request: replacement.request };
    }
    if (!["complete", "generated", "failed"].includes(original.state) && !(original.state === "pending" && allowPendingReplacement))
      throw new Error("结果未知的原任务只能恢复；替换须取得该组重复付费风险的明确授权及标记");
    if (current !== original) throw new Error("只能替换当前分次任务，不能从旧回执另开分支");
    return { receipt: null, request: { ...(sameInput(original.request) ? original.request : {
      ...original.request, previousPartSha256: proposed.previousPartSha256, previousGeneration: proposed.previousGeneration,
      previousPartRequestDigest: proposed.previousPartRequestDigest
    }), replacesRequestDigest: regenerateFrom } };
  }
  if (current && !sameInput(current.request))
    throw new Error(`前段视频或任务已改变，已付费接续${current.requestDigest}须单独授权定点重生；禁止自动再次付费`);
  return { receipt: current, request: current?.request ?? proposed };
};

export const validateDelivery = async ({ root, episodeId, videoPlan, videoManifest, storyboard, cues = null, spanIds = null }) => {
  if (videoManifest?.episodeId !== episodeId || videoPlan?.episodeId !== episodeId
    || videoManifest.videoPlanSha256 !== hashObject(projectVideoProduction(videoPlan))) throw new Error("视频交付没有绑定当前设计");
  if (!Array.isArray(videoManifest.clips) || (!spanIds && videoManifest.clips.length !== videoPlan.spans.length)
    || new Set(videoManifest.clips.map(({ id }) => id)).size !== videoManifest.clips.length)
    throw new Error("视频交付数量或身份与设计不一致");
  for (const span of videoPlan.spans) {
    if (spanIds && !spanIds.has(span.id)) continue;
    const clip = videoManifest.clips.find(({ id }) => id === span.id);
    if (!clip) throw new Error(`${span.id} 视频交付缺失`);
    const window = videoWindow({ span, storyboard, cues });
    if (clip.durationMs !== window.deliveryDurationMs || clip.parts?.length !== window.parts.length
      || clip.parts.some((part, index) => part.index !== index + 1 || part.frameCount !== window.parts[index].frameCount)
      || clip.requestDigest !== deliveryDigestFor({ spanId: span.id, firstFrameSha256: clip.firstFrameSha256, parts: clip.parts }))
      throw new Error(`${span.id} 视频时长、分组或交付身份与正文不一致`);
    if (clip.review && (clip.parts.length > 1 ? typeof clip.review.join !== "string" || !clip.review.join.trim() : clip.review.join !== null))
      throw new Error(`${span.id} 多组生成记录接缝观察，单组生成为null`);
    const expectedDirectory = path.join(getEpisodePaths(root, episodeId ).p4, "video", span.id, clip.requestDigest);
    const file = path.resolve(root, clip.file);
    if (file !== path.join(expectedDirectory, "video.mp4")) throw new Error(`${span.id} 视频必须来自本段生产目录`);
    await assertProjectPath({ root, file, label: "视频交付" });
    await assertVideoFilePresent(file);
    const receiptFile = path.join(expectedDirectory, "generation.json");
    await assertProjectPath({ root, file: receiptFile, label: "视频整合回执" });
    const receipt = await readData(receiptFile);
    const { review, ...businessClip } = clip;
    if (receipt.state !== "complete" || hashObject(receipt.clip) !== hashObject(businessClip)) throw new Error(`${span.id} 候选与实际剪辑交付不一致`);
    if (firstFrameFor({ span, clip }).sha256 !== clip.firstFrameSha256) throw new Error(`${span.id} 首帧已发生实际修改`);
  }
};

export const validateProductionReceipts = async ({ root, episodeId, result, videoPlan, storyboard, cues, visual, stageRestartId }) => {
  for (const clip of result.clips) {
    const span = videoPlan.spans.find(({ id }) => id === clip.id);
    const window = videoWindow({ span, storyboard, cues });
    let previousReceipt = null;
    for (const [index, part] of clip.parts.entries()) {
      const plan = window.parts[index];
      const continuing = plan.index > 1;
      const directory = path.join(getEpisodePaths(root, episodeId ).p4, "video", clip.id, `part-${plan.index}`, part.requestDigest);
      const receipts = await readPartReceipts({ root, directory: path.dirname(directory) });
      const recorded = receipts.find(receipt => receipt.requestDigest === part.requestDigest);
      const expected = { ...videoRequestFor({ episodeId, span, part: plan,
        firstFrameSha256: firstFrameFor({ span, clip }).sha256,
        ...(continuing ? recorded?.request.previousGeneration
          ? { previousGeneration: generationReferenceFor(previousReceipt) }
          : { previousPartSha256: previousReceipt.part.sha256 } : {}), visual }),
        ...(stageRestartId ? { stageRestartId } : {}) };
      const selected = selectPartRequest({ receipts,
        proposedRequest: expected, previousReceipt: continuing ? previousReceipt : null });
      const receipt = selected.receipt;
      if (receipt?.requestDigest !== part.requestDigest || receipt.state !== "complete"
        || receipt.submitId !== part.submitId || receipt.source?.sha256 !== part.sourceSha256
        || !receipt.edits?.[part.editDigest] || hashObject(receipt.edits[part.editDigest]) !== hashObject(part)
        || receipt.request.firstFrameSha256 !== part.firstFrameSha256)
        throw new Error(`${clip.id} 第${plan.index}组未绑定当前真实首图、原任务或来源`);
      if (index === 0 && clip.firstFrame) {
        if (hashObject(receipt.importedSource?.firstFrame) !== hashObject(clip.firstFrame))
          throw new Error("实际首图没有绑定原导入记录");
        const imageFile = path.resolve(root, clip.firstFrame.file);
        await assertProjectPath({ root, file: imageFile, label: "实际导入首图" });
        await assertVideoFilePresent(imageFile);
      }
      const source = path.resolve(root, receipt.source.file);
      if (source !== path.join(directory, "source.mp4")) throw new Error("原生成来源位置不一致");
      await assertProjectPath({ root, file: source, label: "原生成来源" });
      await assertVideoFilePresent(source);
      const cuts = cutsFor({ partPlan: plan, cuts: part.cuts, sourceFrameCount: receipt.source.frameCount });
      if (part.editDigest !== editDigestFor({ sourceSha256: part.sourceSha256, cuts })) throw new Error("实际剪辑选择与交付不一致");
      const file = path.resolve(root, part.file);
      if (file !== path.join(directory, "edits", part.editDigest, "part.mp4")) throw new Error("分组剪辑媒体位置不一致");
      await assertProjectPath({ root, file, label: "实际分组剪辑" });
      await assertVideoFilePresent(file);
      previousReceipt = { ...receipt, part };
    }
  }
};
