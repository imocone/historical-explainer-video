import path from "node:path";
import { assertProjectPath, atomicWriteData, readData } from "../../packages/program-utils.mjs";
import { getEpisodePaths, getProgramPaths } from "../../packages/workspace-paths.mjs";
import { withWorkflowWrite } from "./acceptance-commit.mjs";
import { EPISODE_STAGES } from "./stage-restart.mjs";
import { deriveStatus } from "./status.mjs";
import { runNext } from "./next.mjs";
import { exists } from "./files.mjs";

const runPath = ({ workspaceRoot, episodeId }) => path.join(getEpisodePaths(workspaceRoot, episodeId).production, "run.yaml");
const readRun = async (options) => {
  const file = runPath(options);
  await assertProjectPath({ root: options.workspaceRoot, file, label: "单集执行范围" });
  return await exists(file) ? readData(file) : null;
};
const stageDone = (status) => ["complete", "stage-complete"].includes(status.kind);

export async function runRange(options) {
  const { workspaceRoot, episodeId, fromStage, toStage, pause = false, resume = false, advance = false } = options;
  if(options.video!==undefined&&!['on','off'].includes(options.video))throw new Error('--video 只能为 on 或 off');
  if ([pause, resume, advance, Boolean(fromStage || toStage)].filter(Boolean).length > 1)
    throw new Error("run 每次只选择新范围、暂停、恢复或阶段收尾推进");
  let run = await withWorkflowWrite(workspaceRoot, async () => {
    let value = await readRun(options);
    if (fromStage || toStage) {
      const first = EPISODE_STAGES.indexOf(fromStage);
      const last = EPISODE_STAGES.indexOf(toStage);
      if (first < 0 || last < first) throw new Error("run 必须提供按顺序的 --from 与 --to（p1…p4）");
      value = { from: fromStage, to: toStage, stage: fromStage, paused: false, ...(options.video ? {video:options.video} : {}) };
    }
    if (!value) throw new Error("尚无执行范围，先用 run --from <阶段> --to <阶段>");
    if(options.video!==undefined)value.video=options.video;
    if (![value.from, value.to, value.stage].every(stage => EPISODE_STAGES.includes(stage))
      || EPISODE_STAGES.indexOf(value.from) > EPISODE_STAGES.indexOf(value.stage)
      || EPISODE_STAGES.indexOf(value.to) < EPISODE_STAGES.indexOf(value.stage)) throw new Error("现有执行范围无效");
    if (pause) value.paused = true;
    if (resume) value.paused = false;
    let rewound = false;
    if (!value.paused) {
      // A saved cursor cannot hide actual repairs accepted after the last run.
      const end = EPISODE_STAGES.indexOf(value.stage) + (value.finished ? 1 : 0);
      for (const stageId of EPISODE_STAGES.slice(EPISODE_STAGES.indexOf(value.from), end)) {
        const status = await deriveStatus({ ...options, stageId, targetId: "release-main" });
        if (!stageDone(status)) { value.stage = stageId; value.finished = false; rewound = true; break; }
      }
    }
    if (advance && !value.paused && !rewound) {
      const status = await deriveStatus({ ...options, stageId: value.stage, targetId: "release-main" });
      if (!stageDone(status)) throw new Error("当前阶段尚未交付，继续原节点后再推进");
      if (value.stage === value.to) value.finished = true;
      else value.stage = EPISODE_STAGES[EPISODE_STAGES.indexOf(value.stage) + 1];
    }
    await atomicWriteData(runPath(options), value);
    return value;
  });
  if (run.paused || run.finished) return { kind: run.paused ? "run-paused" : "run-complete", episodeId, run };
  const result = await runNext({ ...options, stageId: run.stage, targetId: "release-main",
    video: run.stage === "p4" ? run.video : undefined,
    authorizePaidTts: run.stage === "p2" && options.authorizePaidTts === true });
  if(run.stage==='p4'&&run.video!==undefined) {
    run=await withWorkflowWrite(workspaceRoot,async()=>{
      const current=await readRun(options);
      if(current.video===run.video){delete current.video;await atomicWriteData(runPath(options),current);}
      return current;
    });
  }
  return { ...result, ...(stageDone(result) ? { kind: "stage-closeout",
    message: "完成当前阶段reference要求的本次收尾后，运行 run --advance；下一阶段首次付费沿已获范围授权传入原付费参数，无需用户再次确认" } : {}), run };
}

export async function projectStatus(options) {
  const { workspaceRoot, episodeId } = options;
  const programPaths = getProgramPaths(workspaceRoot);
  const plan = await exists(programPaths.programPlan) ? await readData(programPaths.programPlan) : null;
  const request = !plan && await exists(programPaths.request) ? await readData(programPaths.request) : null;
  const programId = options.programId ?? plan?.programId ?? request?.programId;
  let program;
  try { program = await deriveStatus({ ...options, stageId: "p0", programId }); }
  catch (error) { program = { kind: "blocked", reason: error.message }; }
  const episodes = episodeId ? [{ episodeId }] : plan?.episodes ?? [];
  const result = [];
  for (const episode of episodes) {
    const stages = [];
    for (const stageId of EPISODE_STAGES) {
      try {
        const status = await deriveStatus({ ...options, episodeId: episode.episodeId, stageId, targetId: "release-main" });
        stages.push({ stageId, kind: status.kind, nodeId: status.nodeId, reason: status.reason, queue: status.queue });
      } catch (error) { stages.push({ stageId, kind: "blocked", reason: error.message }); }
    }
    result.push({ episodeId: episode.episodeId, title: episode.episodeTitle, stages,
      run: await readRun({ ...options, episodeId: episode.episodeId }) });
  }
  return { kind: "project-status", programId, program, episodes: result };
}
