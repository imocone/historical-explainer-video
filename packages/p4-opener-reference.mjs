import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertProjectPath, atomicWriteData, hashObject, readData, withoutProducer } from "./program-utils.mjs";
import { deriveCandidateWorkspaceRoot } from "./templates/fullframe-narrative/task-contract.mjs";
import { getEpisodePaths, getStageWorkPaths } from "./workspace-paths.mjs";
import { withWorkflowWrite } from "../engine/runtime/acceptance-commit.mjs";
import { readStageRestart, restartPending } from "../engine/runtime/stage-restart.mjs";

const optional = async file => {
  try { return await readData(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const requiresOpener = (workOrder, result) => {
  const first = workOrder.inputs?.storyboard?.content?.beats?.[0]?.id;
  return Boolean(first && Array.isArray(result?.spans) && result.spans.some(span => span.beatIds?.[0] === first));
};
const bindingPath = async ({ workspaceRoot, workOrder }) => {
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot, workOrder.subject.id), "p4", null, "video");
  const scratch = path.join(work.work, `attempt-${workOrder.executionId}`);
  if (!/^[a-f0-9]{64}$/u.test(workOrder.executionId ?? "")
    || path.resolve(workspaceRoot, workOrder.scratchPath ?? "") !== scratch)
    throw new Error("视频片头交接的scratch与当前工作单不一致");
  return assertProjectPath({ root: workspaceRoot, file: path.join(scratch, "opener-reference.json"), label: "视频片头输入绑定" });
};

// Bind the real input at its existing V2 consumption point, never a claim that the model reviewed it.
export const readVideoOpenerInput = async ({ workOrderPath }) => {
  const workOrder = await readData(workOrderPath);
  const workspaceRoot = deriveCandidateWorkspaceRoot({ workOrder,
    candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath ?? "")) });
  return withWorkflowWrite(workspaceRoot, async () => {
    const { taskDigest, ...base } = workOrder;
    const paths = getEpisodePaths(workspaceRoot, workOrder.subject?.id);
    const work = getStageWorkPaths(paths, "p4", null, "video");
    for (const file of [workOrderPath, work.candidate, paths.episodePackage])
      await assertProjectPath({ root: workspaceRoot, file: path.resolve(file), label: "片头交接输入" });
    if (hashObject(base) !== taskDigest || workOrder.stageId !== "p4" || workOrder.nodeId !== "video"
      || workOrder.moduleId !== "author-video" || workOrder.runner !== "ai"
      || path.resolve(workOrderPath) !== work.workOrder
      || path.resolve(workspaceRoot, workOrder.candidatePath) !== work.candidate
      || hashObject(await readData(workOrderPath)) !== hashObject(workOrder))
      throw new Error("片头交接只接受当前正式video工作单");
    const candidate = await readData(work.candidate);
    if (candidate.taskDigest !== taskDigest) throw new Error("片头交接候选与当前工作单不一致");
    if (!requiresOpener(workOrder, candidate.result)) return { kind: "not-required" };
    const source = `${path.relative(workspaceRoot, paths.episodePackage).split(path.sep).join("/")}#opener`;
    if (workOrder.inputs.openerReference?.source !== source) throw new Error("正式片头引用与当前节目不一致");
    const request = getStageWorkPaths(paths, "p4").returnRequest("opener");
    await assertProjectPath({ root: workspaceRoot, file: request });
    const opener = (await readData(paths.episodePackage)).opener;
    const stageRestart = await readStageRestart({ workspaceRoot, episodeId: workOrder.subject.id, stageId: "p4" });
    if (await optional(request) || restartPending({ stageRestart }, opener)
      || opener?._producer?.moduleId !== "author-bookend" || opener._producer.nodeId !== "opener"
      || opener._producer.outputSha256 !== hashObject(withoutProducer(opener)))
      throw new Error("等待本次片头正式接纳后，再读取首幕接镜输入");
    const content = withoutProducer(opener);
    const binding = { taskDigest, source, sha256: hashObject(content) };
    await atomicWriteData(await bindingPath({ workspaceRoot, workOrder }), binding);
    return { kind: "opener-input", ...binding, opener: content };
  });
};

export const assertVideoOpenerInput = async ({ workspaceRoot, workOrder, result, opener }) => {
  if (!requiresOpener(workOrder, result)) return;
  const binding = await optional(await bindingPath({ workspaceRoot, workOrder }));
  if (!binding || binding.taskDigest !== workOrder.taskDigest
    || binding.source !== workOrder.inputs.openerReference?.source
    || binding.sha256 !== hashObject(withoutProducer(opener ?? null)))
    throw new Error("首幕视频缺少当前片头版本的输入交接；沿原读取入口取得正式片头，只修受影响接镜，保留其它设计和素材");
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await readVideoOpenerInput({ workOrderPath: process.argv[2] }))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
