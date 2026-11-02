import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { runtimeCommand, runtimeEnvironment } from "../../runtime-config.mjs";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWriteData, hashObject, readData } from "../../program-utils.mjs";

const exec = promisify(execFile);
const nodeId = (key) => `node_${hashObject(key).slice(0, 10)}`;
const publicError = (result) => {
  const error = result.error ?? {};
  return Object.fromEntries(Object.entries({ code: error.code, class: error.class, message: error.message,
    reason: error.reason, serviceCode: error.serviceCode, requiredAction: error.requiredAction,
    validation: error.validation, requestId: result.meta?.requestId ?? error.requestId, traceId: error.traceId,
    projectId: error.projectId, operationRef: error.operationRef }).filter(([, value]) => value !== undefined));
};

export const canvasCall = async (args, { readOnly = false } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    let stdout, failure;
    try {
      ({ stdout } = await exec(runtimeCommand('DREAMINA_BIN', 'dreamina-canvas'), ["--format", "json", "--non-interactive", ...args],
        { timeout: readOnly ? 180000 : 900000, maxBuffer: 4 * 1024 * 1024, env: runtimeEnvironment() }));
    } catch (error) { stdout = error.stdout; failure = error; }
    let result;
    try { result = JSON.parse(stdout || failure?.stderr); } catch { /* Preserve an unknown write instead of replaying it. */ }
    if (result?.ok === true && !failure) return result;
    const details = result ? publicError(result) : { code: failure?.code ?? "cli.invalid_response",
      message: failure?.killed ? "即梦画布命令超时" : "即梦画布命令没有返回有效JSON" };
    if (readOnly && result?.error?.retryable && failure?.code === 21 && attempt < 2) {
      await delay(2000 * (attempt + 1));
      continue;
    }
    throw Object.assign(new Error(`${details.message}（${details.code}${details.requestId ? `；requestId=${details.requestId}` : ""}）`),
      { code: details.code, cliError: details, partialData: result?.partialData });
  }
};

// Called under the module's existing episode lock. Allocate before creating remotely.
export const canvasFor = async ({ directory, episodeId, call = canvasCall }) => {
  const file = path.join(directory, "canvas.json");
  let canvas;
  try { canvas = await readData(file); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    canvas = { projectId: randomUUID() };
    await atomicWriteData(file, canvas);
  }
  if (!canvas.webUrl) {
    const result = await call(["canvas", "create", episodeId, "--project-id", canvas.projectId]);
    canvas = result.data.project;
    await atomicWriteData(file, canvas);
    process.stderr.write(`${JSON.stringify({ canvasUrl: canvas.webUrl })}\n`);
  }
  return canvas;
};

export const canvasReceipt = ({ request, requestDigest, projectId, inputFile }) => ({
  requestDigest, request, state: "submitting", submitId: randomUUID(),
  canvas: { projectId, nodeId: nodeId([requestDigest, "generation"]), updateId: randomUUID(),
    ...(request.previousGeneration ? {
      inputNodeId: request.previousGeneration.nodeId, inputResourceId: request.previousGeneration.resourceId,
      inputUploaded: true, inputSaved: true
    } : {
    inputNodeId: nodeId([requestDigest, "input"]), inputUpdateId: randomUUID(), inputSubmitId: randomUUID(),
    inputResourceId: randomUUID(), inputFile }) }
});

const prepareCanvasSource = async ({ receipt, save, call }) => {
  const canvas = receipt.canvas;
  const continuing = receipt.request.partIndex > 1;
  const type = continuing ? "video" : "image";
  const project = ["--project-id", canvas.projectId];
  const update = async (fields) => { Object.assign(canvas, fields); await save(receipt); };
  if (!canvas.model) {
    const [release, catalog] = await Promise.all([
      call(["version"], { readOnly: true }),
      call(["model", "find", receipt.request.model, "--type", "video"], { readOnly: true })
    ]);
    const models = catalog.data.items;
    if (models?.length !== 1) throw new Error("当前目录未唯一解析本次视频模型");
    await update({ model: models[0].model, version: release.data.version });
  }
  if (!canvas.inputUploaded) {
    await call(["resource", "upload", ...project, "--resource-id", canvas.inputResourceId,
      "--file", canvas.inputFile, "--type", type]);
    await update({ inputUploaded: true });
  }
  if (!canvas.inputSaved) {
    await call(["node", "create", type, ...project, "--node-id", canvas.inputNodeId,
      "--update-id", canvas.inputUpdateId, "--submit-id", canvas.inputSubmitId,
      "--resource-id", canvas.inputResourceId, "--import-kind", "local_upload", "--title", continuing ? "前组剪定视频" : "剧情首图"]);
    await update({ inputSaved: true });
  }
  if (!canvas.nodeSaved) {
    const prompt = continuing ? receipt.request.prompt.replaceAll("@Video 1", `{{node:${canvas.inputNodeId}}}`) : receipt.request.prompt;
    await call(["node", "create", "video", ...project, "--node-id", canvas.nodeId, "--update-id", canvas.updateId,
      "--title", `${receipt.request.spanId} 第${receipt.request.partIndex}次`, "--mode", continuing ? "m2v" : "first_last_frame",
      "--model", canvas.model, "--resolution", receipt.request.resolution, "--ratio", "16:9",
      "--duration", String(receipt.request.seconds), "--count", "1", "--ref", `node:${canvas.inputNodeId}`, "--prompt", prompt]);
    await update({ nodeSaved: true });
  }
  return receipt;
};

export const submitCanvasSource = async ({ receipt, save, authorizePaidGeneration, call = canvasCall }) => {
  if (receipt.canvas.submissionStarted) return receipt;
  if (!authorizePaidGeneration && receipt.canvas.creditCeiling === undefined) throw new Error("首次视频运行仍需当前P4的付费授权标记");
  await prepareCanvasSource({ receipt, save, call });
  const project = ["--project-id", receipt.canvas.projectId, "--node-id", receipt.canvas.nodeId];
  const quote = (await call(["node", "quote", ...project], { readOnly: true })).data;
  if (!Number.isInteger(quote.totalMaxCredits) || quote.items?.length !== 1 || quote.items[0].error)
    throw new Error("当前视频无法取得完整积分报价，不提交生成");
  if (receipt.canvas.creditCeiling !== undefined && quote.totalMaxCredits > receipt.canvas.creditCeiling)
    throw new Error("最新报价超过本次已授权积分上限，保留原节点与提交编号");
  receipt.canvas.creditCeiling ??= quote.totalMaxCredits;
  await save(receipt);
  process.stderr.write(`${JSON.stringify({ spanId: receipt.request.spanId, part: receipt.request.partIndex,
    maxCredits: quote.totalMaxCredits, submitId: receipt.submitId })}\n`);
  const confirmation = (await call(["node", "confirm", ...project, "--credit-ceiling", String(receipt.canvas.creditCeiling)])).data;
  // The token remains in memory. Mark the paid boundary before dispatching.
  receipt.canvas.submissionStarted = true;
  receipt.state = "pending";
  await save(receipt);
  const result = await call(["node", "run", ...project, "--submit-id", receipt.submitId,
    "--credit-token", confirmation.creditConfirmationToken]);
  const item = result.data.items?.find(({ nodeId: id }) => id === receipt.canvas.nodeId);
  if (item?.error) receipt.error = { ...item.error, requestId: result.meta?.requestId };
  if (["rejected", "failed", "canceled", "cancelled"].includes(item?.state?.toLowerCase())) {
    receipt.state = "failed";
    receipt.error ??= { code: item.state, message: "原画布运行已终止", requestId: result.meta?.requestId };
  }
  receipt.canvas.requestId = result.meta?.requestId;
  await save(receipt);
  return receipt;
};

export const canvasSourceStatus = async ({ receipt, call = canvasCall }) => {
  if (!receipt.canvas?.projectId) throw new Error(`原任务${receipt.submitId ?? "无编号"}没有画布身份，保留原记录，不创建替代任务`);
  let result;
  try {
    result = await call(["operation", "status", receipt.submitId, "--project-id", receipt.canvas.projectId], { readOnly: true });
  } catch (error) {
    if (error.cliError?.class === "operation_incomplete") return { pending: true, error: error.cliError, queueStatus: null };
    throw error;
  }
  const data = result.data;
  const state = data.state?.toLowerCase();
  if (["failed", "rejected", "canceled", "cancelled"].includes(state) || data.submissionError) {
    return { failed: true, error: data.submissionError ?? { ...data.resources?.find(({ state }) => ["failed", "canceled"].includes(state?.toLowerCase())),
      code: state, message: "原画布操作已终止" }, requestId: result.meta?.requestId };
  }
  const resources = (data.resources ?? []).filter(({ state: resourceState }) => ["success", "succeeded"].includes(resourceState?.toLowerCase()));
  if (["success", "succeeded", "completed"].includes(state)) {
    if (resources.length !== 1) return { failed: true,
      error: { code: "VIDEO_SOURCE_INVALID", message: "原操作已完成，但没有唯一成功视频，保留原编号" }, requestId: result.meta?.requestId };
    return { resourceId: resources[0].resourceId, requestId: result.meta?.requestId };
  }
  return { pending: true, queueStatus: ["running", "pending", "in_progress"].includes(state) ? state : null,
    error: data.awaitingConfirmation ? { code: "cli.generation_confirmation_required", requiredAction: "confirm" } : undefined,
    requestId: result.meta?.requestId };
};

export const downloadCanvasSource = async ({ receipt, resourceId, output, call = canvasCall }) => {
  const project = ["--project-id", receipt.canvas.projectId];
  const resource = (await call(["resource", "get", resourceId, ...project], { readOnly: true })).data;
  if (resource.type !== "video" || resource.status !== "success") throw new Error("原操作尚无成功的视频资源，保留原编号");
  return (await call(["resource", "download", resourceId, ...project, "--output", output], { readOnly: true })).data;
};
