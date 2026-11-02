import { projectVideoProduction } from "../../templates/cinematic-video/production-projection.mjs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { assertProjectMutationTree, assertProjectPath, atomicWriteData, fileSha256, hashObject, programProducer, readData, withProjectLock, withoutProducer } from "../../program-utils.mjs";
import { getEpisodePaths, getStageWorkPaths } from "../../workspace-paths.mjs";
import { VIDEO_SPEC } from "../../video-spec.mjs";
import { videoWindow } from "../../templates/cinematic-video/timing.mjs";
import { inspectP3Input } from "../../../engine/p3-input.mjs";
import { assertVideoFilePresent, firstFrameFor, probe, inspectSource, generationReferenceFor, cutsFor, editDigestFor, editPart, integrateParts, deliveryDigestFor, readPartReceipts, replacementChildrenFor, selectPartRequest } from "./delivery.mjs";
import { selectionTokenFor, selectionCuts, plannedSelectionCuts, selectionTimeline, selectionView } from "./selection.mjs";
import { canvasCall, canvasFor, canvasReceipt, submitCanvasSource, canvasSourceStatus, downloadCanvasSource } from "./canvas.mjs";
const systemRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const loadVideoTask = async ({ workspace, workOrderPath }) => {
  const root = path.resolve(workspace);
  const task = await readData(workOrderPath);
  const episodeId = task.subject?.id;
  const paths = getEpisodePaths(root, episodeId);
  if (task.moduleId !== "produce-video-assets" || task.nodeId !== "video-assets" || task.stageId !== "p4" || task.runner !== "ai"
    || path.resolve(workOrderPath) !== getStageWorkPaths(paths, "p4", null, "video-assets").workOrder)
    throw new Error("只能使用当前P4 video-assets正式工作单");
  await assertProjectPath({ root, file: path.resolve(workOrderPath), label: "视频工作单" });
  const { taskDigest, ...unsigned } = task;
  if (hashObject(unsigned) !== taskDigest) throw new Error("工作单摘要不一致");
  const inputs = task.inputs;
  const videoPlan = inputs.videoPlan.content;
  for (const [file, value] of [[paths.videoPlan, videoPlan]]) {
    await assertProjectPath({ root, file, label: "当前视频输入" });
    if (hashObject(withoutProducer(await readData(file))) !== hashObject(value)) throw new Error("视频工作单业务输入已改变，请回正式next读取当前任务");
  }
  const currentNarration = await inspectP3Input({ root, episodeId });
  const currentStoryboard = await readData(paths.storyboard);
  if (hashObject(currentNarration.cues) !== hashObject(inputs.cues)
    || hashObject(videoPlan.spans.map((span) => videoWindow({ span, storyboard: currentStoryboard, cues: currentNarration.cues })))
      !== hashObject(videoPlan.spans.map((span) => videoWindow({ span, storyboard: inputs.storyboard.content, cues: inputs.cues }))))
    throw new Error("视频工作单的实际字幕或正文范围已改变，请回正式next读取当前任务");
  if (path.resolve(root, task.candidatePath) !== getStageWorkPaths(paths, "p4", null, "video-assets").candidate) throw new Error("候选须为当前P4唯一候选");
  return { root, task, paths, inputs, episodeId, videoPlan };
};

const exists = async (file) => {
  try { return (await stat(file)).isFile(); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
};

const isActiveQueue = (status) => ["pending", "running", "in_progress"].includes(status);
const mediaStopped = (error) => ["MEDIA_CANCELLED", "MEDIA_RESOURCE_STOPPED"].includes(error?.code);

// Recovery always uses the saved original request, including after a design changes.
export const recoverSourceOnce = async ({ root, receipt, directory, remoteOnly = false,
  call = canvasCall, statusFor = value => canvasSourceStatus({ ...value, call }),
  download = value => downloadCanvasSource({ ...value, call }) }) => {
  if (["complete", "failed"].includes(receipt.state) || (remoteOnly && receipt.state === "generated")) return { receipt };
  const receiptPath = path.join(directory, "generation.json");
  const status = receipt.state === "generated" ? { resourceId: receipt.canvas.resourceId } : await statusFor({ receipt });
  if (status.error || status.requestId || status.failed) {
    receipt = { ...receipt, ...(status.failed ? { state: "failed" } : {}), ...(status.error ? { error: status.error } : {}),
      canvas: { ...receipt.canvas, ...(status.requestId ? { requestId: status.requestId } : {}) } };
    await atomicWriteData(receiptPath, receipt);
  }
  if (status.failed) return { receipt };
  if (status.pending) return { receipt, pending: { state: "pending", part: receipt.request.partIndex,
    submitId: receipt.submitId, queueStatus: status.queueStatus, error: status.error,
    message: status.queueStatus ? "原画布视频仍在生成，继续查询同一操作。" : "原操作状态尚未确认，保留编号，不重新运行。" } };
  if (!status.resourceId || (receipt.canvas.resourceId && receipt.canvas.resourceId !== status.resourceId))
    throw new Error("原生成资源身份无法确定，保留原对象");
  const { error: _recoveredError, ...recovered } = receipt;
  receipt = { ...recovered, state: "generated", canvas: { ...receipt.canvas, resourceId: status.resourceId } };
  await atomicWriteData(receiptPath, receipt);
  if (remoteOnly) return { receipt };
  const file = path.join(directory, "source.mp4");
  await assertProjectMutationTree({ root, file, label: "原生成来源" });
  const saved = receipt.download;
  const savedFile = saved && path.resolve(root, saved.file);
  if (savedFile) await assertProjectPath({ root, file: savedFile, label: "已下载原视频" });
  const reusable = savedFile && await exists(savedFile) && (await stat(savedFile)).size === saved.size
    && await fileSha256(savedFile) === saved.sha256;
  let downloaded = reusable ? saved : null;
  if (reusable) {
    if (savedFile !== file) await copyFile(savedFile, file);
  } else {
    const temporary = path.join(directory, `download-${randomUUID()}.mp4`);
    await assertProjectMutationTree({ root, file: temporary, label: "原视频下载临时文件" });
    try {
      downloaded = await download({ receipt, resourceId: status.resourceId, output: temporary });
      if (path.resolve(downloaded.path) !== temporary || (await stat(temporary)).size !== downloaded.size
        || await fileSha256(temporary) !== downloaded.sha256) throw new Error("原视频下载交付与CLI回执不一致，只恢复该资源");
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
  receipt = { ...receipt, download: { file: path.relative(root, file).split(path.sep).join("/"),
    size: downloaded.size, sha256: downloaded.sha256 } };
  await atomicWriteData(receiptPath, receipt);
  let source;
  try { source = await inspectSource({ file, request: receipt.request }); }
  catch (error) {
    if (error.code === "VIDEO_SOURCE_INVALID") await atomicWriteData(receiptPath, { ...receipt, state: "failed", error: { code: error.code, message: error.message } });
    throw error;
  }
  const completed = { ...receipt, state: "complete", source: {
    file: path.relative(root, file).split(path.sep).join("/"), sha256: downloaded.sha256, frameCount: source.frameCount
  } };
  await atomicWriteData(receiptPath, completed);
  return { receipt: completed };
};

const recoverSource = async ({ root, receipt, directory, wait = false, remoteOnly = false, call = canvasCall }) => {
  const deadline = Date.now() + 20 * 60 * 1000;
  let previousStatus;
  for (;;) {
    const result = await recoverSourceOnce({ root, receipt, directory, remoteOnly, call });
    if (!wait || !isActiveQueue(result.pending?.queueStatus) || Date.now() >= deadline) return result;
    const status = JSON.stringify(result.pending);
    if (status !== previousStatus) {
      process.stderr.write(`${status}\n`);
      previousStatus = status;
    }
    receipt = result.receipt;
    await delay(Math.max(0, Math.min(60000, deadline - Date.now())));
  }
};

// Adopt an explicitly selected, already successful first-part submission. Never submit here.
const importFirstSource = async ({ root, context, span, part, template, spanDirectory, candidate, candidatePath, input }) => {
  const readEvidence = async (file) => {
    const absolute = path.resolve(root, file);
    await assertProjectPath({ root, file: absolute, label: "既有提交证据" });
    return readData(absolute);
  };
  const evidence = await readEvidence(input.request);
  const submitted = evidence.request;
  const submission = await readEvidence(input.submission);
  const item = submission.data?.items?.find(({ nodeId }) => nodeId === evidence.canvas?.nodeId);
  if (!submitted || !evidence.canvas?.projectId || !item?.submitId || !input.edit?.trim())
    throw new Error("接入须提供画布原请求记录、对应node run回执及实际首图编辑说明");
  const imageFile = path.resolve(root, evidence.canvas.inputFile);
  await assertProjectPath({ root, file: imageFile, label: "实际提交首图" });
  const firstFrame = { file: path.relative(root, imageFile).split(path.sep).join("/"), sha256: await fileSha256(imageFile),
    parentSha256: firstFrameFor({ span }).sha256, edit: input.edit };
  const media = (await probe(imageFile)).streams.find(({ codec_type }) => codec_type === "video");
  if (!media || Math.abs(media.width / media.height - 16 / 9) > .01) throw new Error("实际首图须保持16:9画幅");
  if (submitted.firstFrameSha256 !== firstFrame.sha256) throw new Error("原画布请求与实际首图摘要不一致");
  const proposed = { ...template.videoRequestFor({ episodeId: context.episodeId, span, part,
    firstFrameSha256: firstFrame.sha256, visual: context.inputs.visual }),
    ...(context.inputs.stageRestartId ? { stageRestartId: context.inputs.stageRestartId } : {}) };
  if (submitted.model !== proposed.model || submitted.seconds !== proposed.seconds
    || ![part.videoPrompt, proposed.prompt].includes(submitted.prompt))
    throw new Error("既有请求的模型、时长或提示词不属于当前视频设计");
  const request = { ...proposed, prompt: submitted.prompt };
  const requestDigest = hashObject(request);
  const partDirectory = path.join(spanDirectory, "part-1");
  const receipts = await readPartReceipts({ root, directory: partDirectory });
  const current = selectPartRequest({ receipts, proposedRequest: request }).receipt;
  if (current && (current.submitId !== item.submitId || current.requestDigest !== requestDigest))
    throw new Error("当前输入已绑定其它远端对象，不能借接入改写原记录");
  const directory = path.join(partDirectory, requestDigest);
  await assertProjectMutationTree({ root, file: directory, label: "既有视频接入目录" });
  if (!current) {
    const imported = { requestDigest, request, state: "pending", submitId: item.submitId,
      canvas: { ...evidence.canvas, submissionStarted: true }, importedSource: { request: evidence, submission, firstFrame } };
    const remote = await canvasSourceStatus({ receipt: imported });
    const shown = (await canvasCall(["node", "show", "--project-id", evidence.canvas.projectId,
      "--node-id", evidence.canvas.nodeId], { readOnly: true })).data.nodes?.find(({ nodeId }) => nodeId === evidence.canvas.nodeId)?.node;
    if (!remote.resourceId || shown?.generation?.prompt !== submitted.prompt)
      throw new Error("接入只接受已确认成功且提示一致的原画布对象");
    await mkdir(directory, { recursive: true });
    await atomicWriteData(path.join(directory, "generation.json"), imported);
  } else if (hashObject(current.importedSource?.firstFrame) !== hashObject(firstFrame)) {
    throw new Error("重复接入须保留原首图来源及编辑说明");
  }
  const prior = candidate.result.clips.find(({ id }) => id === span.id);
  if (prior?.firstFrameSha256 !== firstFrame.sha256 || !prior.firstFrame) {
    candidate.result.clips = [...candidate.result.clips.filter(({ id }) => id !== span.id),
      { id: span.id, firstFrameSha256: firstFrame.sha256, firstFrame, parts: [] }];
    await atomicWriteData(candidatePath, candidate);
  }
};

const generateSpan = async ({ context, spanId, regenerateFrom = null, authorizePaidGeneration = false,
  wait = false, apply = null, inspect = null, importSource = null }) => {
  const { root, task, paths, inputs, episodeId, videoPlan, call } = context;
  const span = videoPlan.spans.find(({ id }) => id === spanId);
  if (!span) throw new Error("只能生产当前设计实际选定的视频段");
  const window = videoWindow({ span, storyboard: inputs.storyboard.content, cues: inputs.cues });
  if (apply && inspect) throw new Error("同次调用只能写入选择或查看局部");
  const selectionOperation = apply ?? inspect;
  if (selectionOperation && (!Number.isInteger(selectionOperation.part)
    || !window.parts.some(({ index }) => index === selectionOperation.part)
    || ((apply || selectionOperation.selectionToken !== undefined)
      && typeof selectionOperation.selectionToken !== "string"))) throw new Error("编辑须指定part；apply须引用inspect返回的selectionToken");
  if (selectionOperation && regenerateFrom) throw new Error("取材操作不能同时替换远端请求");
  const resources = task.resolvedAssembly.slots.flatMap((slot) => slot.implementations)
    .filter((implementation) => implementation.packageId === videoPlan.templateId)
    .flatMap((implementation) => implementation.resources).filter(({ role }) => role === "assetContractEntry");
  if (resources.length !== 1) throw new Error("视频生产缺少唯一模板素材合同");
  const entry = path.resolve(systemRoot, resources[0].source);
  await assertProjectPath({ root: systemRoot, file: entry, label: "视频模板素材合同" });
  const template = await import(pathToFileURL(entry).href);
  const spanDirectory = path.join(paths.p4, "video", spanId);
  await assertProjectMutationTree({ root, file: spanDirectory, label: "视频生产目录" });
  await mkdir(spanDirectory, { recursive: true });
  const relative = (file) => path.relative(root, file).split(path.sep).join("/");
  const candidatePath = path.resolve(root, task.candidatePath);
  await assertProjectMutationTree({ root, file: candidatePath, label: "当前视频候选" });
  const candidateExists = await exists(candidatePath);
  if (selectionOperation && !candidateExists) throw new Error("先由生成入口返回当前来源，再进行取材");
  const candidate = candidateExists ? await readData(candidatePath) : {
    taskDigest: task.taskDigest, result: { episodeId, videoPlanSha256: hashObject(projectVideoProduction(videoPlan)), clips: [] }
  };
  if (candidate.taskDigest !== task.taskDigest || candidate.result?.episodeId !== episodeId
    || candidate.result?.videoPlanSha256 !== hashObject(projectVideoProduction(videoPlan)) || !Array.isArray(candidate.result.clips))
    throw new Error("剪辑选择须在当前工作单、当前设计的唯一候选中");
  if (!candidateExists) await atomicWriteData(candidatePath, candidate);
  const saveClip = async (clip) => {
    const previous = candidate.result.clips.find(({ id }) => id === spanId);
    const value = { ...clip, ...(previous?.requestDigest === clip.requestDigest && previous?.review ? { review: previous.review } : {}) };
    candidate.result.clips = [...candidate.result.clips.filter(({ id }) => id !== spanId), value]
      .sort((a, b) => videoPlan.spans.findIndex(({ id }) => id === a.id) - videoPlan.spans.findIndex(({ id }) => id === b.id));
    await atomicWriteData(candidatePath, candidate);
    return { state: "complete", clip: value, candidatePath: task.candidatePath };
  };
  if (importSource) await importFirstSource({ root, context, span, part: window.parts[0], template,
    spanDirectory, candidate, candidatePath, input: importSource });
  // Include removed groups: a newly grouped plan must not bypass an unresolved old task.
  for (const name of selectionOperation ? [] : (await readdir(spanDirectory)).filter((name) => /^part-[1-9][0-9]*$/u.test(name))) {
    const directory = path.join(spanDirectory, name);
    const receipts = await readPartReceipts({ root, directory });
    const replacements = replacementChildrenFor(receipts);
    for (const receipt of receipts) {
      if (["complete", "generated", "failed"].includes(receipt.state) || (receipt.canvas && !receipt.canvas.submissionStarted)) continue;
      // Validate the replacement even for groups removed from the current plan.
      if (replacements.has(receipt.requestDigest)) continue;
      const { receipt: recovered, pending } = await recoverSource({ root, receipt, directory: path.join(directory, receipt.requestDigest),
        wait: wait && regenerateFrom !== receipt.requestDigest, remoteOnly: true, call });
      if (!["complete", "generated", "failed"].includes(recovered.state)
        && !(regenerateFrom === receipt.requestDigest && authorizePaidGeneration && recovered.submitId))
        return pending;
    }
  }
  const candidateClip = candidate.result.clips.find(({ id }) => id === spanId);
  const partReceipts = new Map();
  for (const part of window.parts) partReceipts.set(part.index, await readPartReceipts({ root, directory: path.join(spanDirectory, `part-${part.index}`) }));
  const replacementPart = regenerateFrom && window.parts.find((part) => partReceipts.get(part.index).some(({ requestDigest }) => requestDigest === regenerateFrom));
  if (regenerateFrom && (!/^[a-f0-9]{64}$/u.test(regenerateFrom) || !replacementPart)) throw new Error("重生必须指向本段已有的原分组请求摘要");
  const parts = [];
  let previousReceipt = null;
  const image = firstFrameFor({ span, clip: candidateClip });
  const firstFrameFile = path.resolve(root, image.file);
  await assertProjectPath({ root, file: firstFrameFile, label: "剧情唯一首图" });
  const frameSha = await fileSha256(firstFrameFile);
  if (frameSha !== image.sha256) throw new Error("已接纳首图摘要不一致");
  const frameMedia = (await probe(firstFrameFile)).streams.find(({ codec_type }) => codec_type === "video");
  // Authored images keep their native size and import tolerance; VIDEO_SPEC describes the delivered video.
  const ratioTolerance = candidateClip?.firstFrame ? .01 : .025;
  if (!frameMedia || Math.abs(frameMedia.width / frameMedia.height - 16 / 9) > ratioTolerance)
    throw new Error("首图画幅不符合生产来源合同");
  const deliverPart = async ({ partPlan, receipt }) => {
    receipt = await readData(path.join(spanDirectory, `part-${partPlan.index}`, receipt.requestDigest, "generation.json"));
    if (receipt.state !== "complete") {
      const recovered = await recoverSource({ root, receipt,
        directory: path.join(spanDirectory, `part-${partPlan.index}`, receipt.requestDigest), call });
      receipt = recovered.receipt;
      if (receipt.state !== "complete") throw new Error("原视频尚未完成，不能剪接");
    }
    const requestDigest = receipt.requestDigest;
    const directory = path.join(spanDirectory, `part-${partPlan.index}`, requestDigest);
    const receiptPath = path.join(directory, "generation.json");
    const sourceFile = path.resolve(root, receipt.source?.file ?? "");
    if (sourceFile !== path.join(directory, "source.mp4")) throw new Error("当前来源媒体位置不一致，保持原对象");
    await assertProjectPath({ root, file: sourceFile, label: "已完成原素材" });
    await assertVideoFilePresent(sourceFile);
    let selection = candidate.result.clips.find(({ id }) => id === spanId)?.parts?.find(({ index }) => index === partPlan.index);
    const selectionToken = selectionTokenFor({ task, spanId, partPlan, receipt });
    const saveSelection = async (cuts) => {
      if (selection?.sourceSha256 === receipt.source.sha256 && hashObject(selection.cuts ?? null) === hashObject(cuts)) return;
      const currentClip = candidate.result.clips.find(({ id }) => id === spanId);
      const clip = { id: spanId, ...(currentClip?.firstFrame ? { firstFrame: currentClip.firstFrame, firstFrameSha256: frameSha } : {}), parts: [...(currentClip?.parts ?? []).filter(({ index }) => index !== partPlan.index),
        { index: partPlan.index, sourceSha256: receipt.source.sha256, cuts }].sort((a, b) => a.index - b.index) };
      candidate.result.clips = [...candidate.result.clips.filter(({ id }) => id !== spanId), clip];
      await atomicWriteData(candidatePath, candidate);
    };
    if (selectionOperation?.part === partPlan.index) {
      if (selectionOperation.selectionToken !== undefined && selectionOperation.selectionToken !== selectionToken)
        throw new Error("取材来源或工作单已改变，请取得当前来源后重新选择");
      if (apply) {
        const cuts = selectionCuts({ cuts: apply.cuts, partPlan, sourceFrameCount: receipt.source.frameCount });
        await saveSelection(cuts);
        return { selectionResult: { state: "selection-saved", spanId, part: partPlan.index, selectionToken,
          timeline: selectionTimeline({ window, partPlan, cues: inputs.cues, cuts }), candidatePath: task.candidatePath,
          message: "选择已保存；继续运行原生成入口完成剪接交付。" } };
      }
      return { selectionResult: { state: "needs-edit", spanId, part: partPlan.index, selectionToken, source: receipt.source,
        view: await selectionView({ root, task, spanId, partPlan, receipt,
          startFrame: inspect.startFrame, endFrame: inspect.endFrame }),
        timeline: selectionTimeline({ window, partPlan, cues: inputs.cues }) } };
    }
    if (!selection?.cuts?.length || selection.sourceSha256 !== receipt.source.sha256) {
      if (selectionOperation) throw new Error(`先完成第${partPlan.index}组取材，不能越组操作`);
      const plannedCuts = plannedSelectionCuts({ partPlan, sourceFrameCount: receipt.source.frameCount });
      await saveSelection(plannedCuts);
      selection = { index: partPlan.index, sourceSha256: receipt.source.sha256, cuts: plannedCuts };
    }
    const cuts = cutsFor({ partPlan, cuts: selection.cuts, sourceFrameCount: receipt.source.frameCount });
    const editDigest = editDigestFor({ sourceSha256: receipt.source.sha256, cuts });
    const editDirectory = path.join(directory, "edits", editDigest);
    await assertProjectMutationTree({ root, file: editDirectory, label: "实际镜头剪辑" });
    await mkdir(editDirectory, { recursive: true });
    const file = path.join(editDirectory, "part.mp4");
    const newlyEdited = !receipt.edits?.[editDigest];
    let part = receipt.edits?.[editDigest];
    if (newlyEdited) {
      if (selectionOperation) throw new Error(`前组${partPlan.index}尚未剪定，请从原生成入口继续`);
      await editPart({ source: sourceFile, cuts, file });
      part = { index: partPlan.index, requestDigest, firstFrameSha256: frameSha, submitId: receipt.submitId,
        sourceSha256: receipt.source.sha256, editDigest, cuts: selection.cuts,
        file: relative(file), sha256: await fileSha256(file), frameCount: partPlan.frameCount };
      receipt = { ...receipt, edits: { ...receipt.edits, [editDigest]: part } };
      await atomicWriteData(receiptPath, receipt);
    } else {
      if (part.file !== relative(file) || part.requestDigest !== requestDigest || part.firstFrameSha256 !== frameSha
        || part.sourceSha256 !== receipt.source.sha256 || part.frameCount !== partPlan.frameCount
        || hashObject(part.cuts) !== hashObject(selection.cuts)) throw new Error("原剪辑身份与当前选择不一致");
      await assertVideoFilePresent(file);
    }
    return { receipt: { ...receipt, part }, part };
  };
  const generated = [];
  for (const partPlan of window.parts) {
    const continuing = partPlan.index > 1;
    if (continuing && partPlan.connection?.trimReason && !previousReceipt.part) {
      const delivered = await deliverPart({ partPlan: window.parts[partPlan.index - 2], receipt: previousReceipt });
      previousReceipt = delivered.receipt;
    }
    const proposedRequest = { ...template.videoRequestFor({ episodeId, span, part: partPlan, firstFrameSha256: frameSha,
      ...(continuing ? partPlan.connection?.trimReason
        ? { previousPartSha256: previousReceipt.part.sha256 }
        : { previousGeneration: generationReferenceFor(previousReceipt) } : {}), visual: inputs.visual }),
      ...(inputs.stageRestartId ? { stageRestartId: inputs.stageRestartId } : {}) };
    const select = () => selectPartRequest({ receipts: partReceipts.get(partPlan.index), proposedRequest,
      previousReceipt: continuing ? previousReceipt : null, regenerateFrom: replacementPart?.index === partPlan.index ? regenerateFrom : null,
      allowPendingReplacement: authorizePaidGeneration && replacementPart?.index === partPlan.index });
    let selected = select();
    if (selected.needsPreviousEdit) {
      previousReceipt = (await deliverPart({ partPlan: window.parts[partPlan.index - 2], receipt: previousReceipt })).receipt;
      selected = select();
    }
    const { request, receipt: matchingReceipt } = selected;
    if (regenerateFrom && partPlan.index < replacementPart.index && !matchingReceipt) throw new Error("原前组不符合当前输入，不能借后组定点重生创建另一前组");
    const requestDigest = hashObject(request);
    const directory = path.join(spanDirectory, `part-${partPlan.index}`, requestDigest);
    await assertProjectMutationTree({ root, file: directory, label: "分组请求目录" });
    await mkdir(directory, { recursive: true });
    const receiptPath = path.join(directory, "generation.json");
    let receipt = matchingReceipt;
    if (receipt?.state === "failed") throw new Error(`第${partPlan.index}组原任务已失败：${receipt.error?.message ?? receipt.error?.code ?? "平台未提供详情"}；保留已完成部分`);
    if (receipt && !receipt.submitId) throw new Error("原提交结果未知，禁止再次提交；先核实原远端身份");
    if (!receipt || (receipt.canvas && !receipt.canvas.submissionStarted)) {
      if (selectionOperation) throw new Error("本组尚无当前来源，取材操作不提交生成");
      if (!authorizePaidGeneration && receipt?.canvas.creditCeiling === undefined)
        throw new Error(request.replacesRequestDigest ? "定点重生需要此次再次付费的明确授权及标记" : "首次生成需要当前P4首次付费授权标记");
      const inputFile = continuing && request.previousPartSha256 ? path.resolve(root, previousReceipt.part.file) : firstFrameFile;
      if (continuing && request.previousPartSha256) {
        await assertProjectPath({ root, file: inputFile, label: "前次实际剪定视频" });
        if (await fileSha256(inputFile) !== previousReceipt.part.sha256) throw new Error("接续输入视频与前次实际剪辑交付不一致");
        const media = await probe(inputFile);
        const seconds = Number(media.streams.find(({ codec_type }) => codec_type === "video")?.duration ?? media.format.duration);
        if (!Number.isFinite(seconds) || seconds < 2 || seconds > 15) throw new Error("接续参考只能使用2—15秒的前次剪定视频，不能上传累计整片");
      }
      if (!receipt) {
        const projectId = request.previousGeneration?.projectId
          ?? (await canvasFor({ directory: path.join(paths.p4, "video"), episodeId, call })).projectId;
        receipt = canvasReceipt({ requestDigest, request, projectId, inputFile });
        await atomicWriteData(receiptPath, receipt);
      }
      const save = (value) => atomicWriteData(receiptPath, value);
      try { receipt = await submitCanvasSource({ receipt, save, authorizePaidGeneration, call }); }
      catch (error) {
        if (mediaStopped(error)) throw error;
        if (error.cliError) { receipt.error = error.cliError; await save(receipt); }
        if (!receipt.canvas.submissionStarted) throw error;
      }
    }
    if (!["complete", "generated"].includes(receipt.state)) {
      const recovered = await recoverSource({ root, receipt, directory, wait, remoteOnly: true, call });
      receipt = recovered.receipt;
      if (receipt.state === "failed") throw new Error(`第${partPlan.index}组原任务失败：${receipt.error?.message ?? receipt.error?.code ?? "平台未提供详情"}；停止再次付费`);
      if (!["complete", "generated"].includes(receipt.state)) return recovered.pending;
    }
    if (selectionOperation) {
      const delivered = await deliverPart({ partPlan, receipt });
      if (delivered.selectionResult) return delivered.selectionResult;
      receipt = delivered.receipt;
    } else {
      const savedPart = candidate.result.clips.find(({ id }) => id === spanId)?.parts?.find(part =>
        part.index === partPlan.index && part.requestDigest === requestDigest && receipt.edits?.[part.editDigest]);
      if (savedPart) receipt = { ...receipt, part: savedPart };
    }
    generated.push({ partPlan, receipt });
    previousReceipt = receipt;
  }
  for (const item of generated) {
    const delivered = await deliverPart(item);
    if (delivered.selectionResult) return delivered.selectionResult;
    parts.push(delivered.part);
  }
  const firstFrameSha256 = parts[0].firstFrameSha256;
  const requestDigest = deliveryDigestFor({ spanId, firstFrameSha256, parts });
  const directory = path.join(spanDirectory, requestDigest);
  await assertProjectMutationTree({ root, file: directory, label: "整合视频目录" });
  await mkdir(directory, { recursive: true });
  const receiptFile = path.join(directory, "generation.json");
  const file = path.join(directory, "video.mp4");
  if (await exists(receiptFile)) {
    const completed = await readData(receiptFile);
    if (completed.state !== "complete" || completed.clip?.requestDigest !== requestDigest
      || completed.clip.file !== relative(file) || hashObject(completed.clip.parts) !== hashObject(parts)) throw new Error("原整合视频身份不一致");
    await assertProjectPath({ root, file, label: "原整合视频" });
    await assertVideoFilePresent(file);
    return saveClip(completed.clip);
  }
  await integrateParts({ files: parts.map((part) => path.resolve(root, part.file)), parts, file });
  const clip = { id: spanId, requestDigest, firstFrameSha256, ...(candidateClip?.firstFrame ? { firstFrame: candidateClip.firstFrame } : {}), parts, file: relative(file),
    sha256: await fileSha256(file), width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, durationMs: window.deliveryDurationMs };
  await atomicWriteData(receiptFile, { state: "complete", clip });
  return saveClip(clip);
};

// The caller owns the generation lock and supplies the existing span operation.
export const generateBatch = async ({ context, authorizePaidGeneration = false, wait = false, produce }) => {
  const { task, videoPlan } = context;
  if (!videoPlan.spans.length) throw new Error("空选设计由正式next交付，不进入批次生视频");
  const deadline = Date.now() + 20 * 60 * 1000;
  const results = new Map();
  let previousStatus;
  for (;;) {
    // Start each independent chain before waiting; the caller owns candidate writes.
    for (const span of videoPlan.spans) {
      if (results.get(span.id)?.state === "complete") continue;
      try {
        const result = await produce({ context, spanId: span.id, authorizePaidGeneration });
        results.set(span.id, { ...result, spanId: span.id });
      } catch (error) {
        if (mediaStopped(error)) throw error;
        results.set(span.id, { spanId: span.id, state: "blocked", message: error.message });
      }
    }
    const spans = [...results.values()];
    const waiting = spans.filter(({ state }) => state === "pending");
    if (!wait || !waiting.length || spans.some(({ state, queueStatus }) =>
      state !== "complete" && !(state === "pending" && isActiveQueue(queueStatus))) || Date.now() >= deadline)
      return { spans, candidatePath: task.candidatePath };
    const status = JSON.stringify(waiting);
    if (status !== previousStatus) {
      process.stderr.write(`${status}\n`);
      previousStatus = status;
    }
    await delay(Math.max(0, Math.min(60000, deadline - Date.now())));
  }
};

export const generate = async ({ workspace, workOrderPath, spanId, all = false, regenerateFrom = null,
  authorizePaidGeneration = false, wait = false, apply = null, inspect = null, importSource = null, call = canvasCall }) => {
  if (importSource && (all || regenerateFrom || apply || inspect || authorizePaidGeneration))
    throw new Error("既有来源接入只指定span与原提交证据，不混用生成或取材参数");
  if (all && (spanId || regenerateFrom || apply || inspect))
    throw new Error("批次推进不能混用单段、取材或定点重生参数；取材与替换仍须指定span");
  if (!all && !spanId) throw new Error("请使用all推进全部独立视频段，或指定span处理单段");
  const context = { ...await loadVideoTask({ workspace, workOrderPath }), call };
  const { root, paths } = context;
  const directory = path.join(paths.p4, "video");
  await assertProjectMutationTree({ root, file: directory, label: "视频生产目录" });
  await mkdir(directory, { recursive: true });
  return withProjectLock({ root, lock: path.join(directory, "generation.lock"), label: "当前视频生产与候选归集", execute: async () => {
    if (!all) return generateSpan({ context, spanId, regenerateFrom, authorizePaidGeneration, wait, apply, inspect, importSource });
    return generateBatch({ context, authorizePaidGeneration, wait, produce: generateSpan });
  } });
};

// The existing node owns the empty delivery; there is no material for AI to select.
export const run = async ({ root, episodeId, task }) => {
  const videoPlan = task.context?.videoPlan;
  if (task.moduleId !== "produce-video-assets" || task.nodeId !== "video-assets"
    || videoPlan?.episodeId !== episodeId || !Array.isArray(videoPlan.spans) || videoPlan.spans.length)
    throw new Error("确定性视频交付只用于当前已接纳的空选设计");
  const paths = getEpisodePaths(root, episodeId);
  await assertProjectPath({ root, file: paths.videoPlan, label: "空选视频设计" });
  if (hashObject(withoutProducer(await readData(paths.videoPlan))) !== hashObject(videoPlan))
    throw new Error("空选视频设计已改变，请回正式next读取当前任务");
  const business = { episodeId, videoPlanSha256: hashObject(projectVideoProduction(videoPlan)), clips: [] };
  await assertProjectMutationTree({ root, file: paths.videoManifest, label: "空选视频交付" });
  await atomicWriteData(paths.videoManifest, { ...business, _producer: {
    ...programProducer({ task, business }),
    rules: [...new Set(task.resolvedRules.map(rule => rule.sha256))],
    contract: task.outputContract.sha256
  } });
  return business;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, "work-order": { type: "string" }, span: { type: "string" },
    all: { type: "boolean", default: false },
    "regenerate-from": { type: "string" }, "authorize-paid-generation": { type: "boolean", default: false },
    "import-source": { type: "string" }, wait: { type: "boolean", default: false }, apply: { type: "string" }, inspect: { type: "string" } } });
  const selectionArgument = (value) => {
    if (value === undefined) return null;
    const result = JSON.parse(value);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("编辑参数须为JSON对象；inspect指定part，apply同时指定selectionToken");
    return result;
  };
  generate({ workspace: values.workspace, workOrderPath: values["work-order"], spanId: values.span, all: values.all,
    regenerateFrom: values["regenerate-from"], authorizePaidGeneration: values["authorize-paid-generation"], wait: values.wait,
    apply: selectionArgument(values.apply), inspect: selectionArgument(values.inspect), importSource: selectionArgument(values["import-source"]) })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.spans?.some(({ state }) => state === "blocked")) process.exitCode = 1;
    })
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
