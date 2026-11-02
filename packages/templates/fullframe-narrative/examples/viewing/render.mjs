import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { compileComposition } from "../../../../modules/render-video/runtime/compile.mjs";
import { scenePreviewProps } from "../../../../modules/render-video/runtime/scene-preview.mjs";
import { launchComposition, renderComposition, snapshotComposition } from "../../../../modules/render-video/runtime/hyperframes.mjs";
import { withVisualFontPaths } from "../../../../visual-fonts.mjs";
import { prepareRenderPublic } from "../../../../modules/render-video/runtime/public-files.mjs";
import { runMediaProcess, withMediaResources } from "../../../../modules/render-video/runtime/media-process.mjs";
import { cameraAtFrame } from "../../camera/runtime-layer.mjs";
import { viewportForCamera } from "../../camera/geometry.mjs";
import { viewingStudies } from "./data.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const systemRoot = path.resolve(directory, "../../../../..");
const output = path.resolve(process.argv[2] ?? path.join(directory, "output"));
const mode = process.argv[3] ?? "preview";
const requested = process.env.VIEWING_STUDY_IDS?.split(",");
const run = async (command, args) => (await runMediaProcess(command, args, { capture: true })).stdout;
const visualStyle = withVisualFontPaths(JSON.parse(await readFile(path.join(systemRoot, "visuals/modern-editorial/render/tokens.json"))), "modern-editorial");
const subtitleFont = visualStyle.p4.subtitle.font;
visualStyle.p4.subtitle = { ...visualStyle.p4.subtitle, fontName: subtitleFont.family,
  fontPublicPath: `visuals/modern-editorial/${subtitleFont.file}`, fontFormat: subtitleFont.format,
  fontWeight: subtitleFont.weight, fontStyle: subtitleFont.style };
const jobs = viewingStudies(visualStyle);
const schema = JSON.parse(await readFile(path.join(systemRoot, "contracts/fullframe-treatment.schema.json")));
// Local teaching inputs have no episode image-production receipt; all other fields use the real contract.
schema.$defs.fullframeRequest.required = schema.$defs.fullframeRequest.required.filter(key => key !== "asset");
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
for (const job of jobs) if (!validate(job.segment.treatment)) throw new Error(`${job.id}: ${JSON.stringify(validate.errors)}`);
await mkdir(path.join(output, "audio"), { recursive: true });

const audioFor = async job => {
  const key = createHash("sha256").update(JSON.stringify(job.speech)).digest("hex").slice(0, 12);
  const audio = `audio/${key}.wav`;
  if (existsSync(path.join(output, audio))) return audio;
  const args = [];
  for (const [index, cue] of job.speech.entries()) {
    const raw = path.join(output, "audio", `${key}-${index}.aiff`);
    await run("/usr/bin/say", ["-v", "Tingting", "-r", "180", "-o", raw, cue.text]);
    const seconds = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw])).trim());
    if (seconds * 1000 > cue.endMs - cue.startMs) throw new Error(`${job.id} 配音超出Cue，需调整教学节奏，不能截断语音`);
    args.push("-i", raw);
  }
  const chains = job.speech.map((cue, index) => `[${index}:a]adelay=${cue.startMs}:all=1[a${index}]`);
  const inputs = job.speech.map((_, index) => `[a${index}]`).join("");
  chains.push(`${inputs}amix=inputs=${job.speech.length}:normalize=0,apad[audio]`);
  const temporary = path.join(output, "audio", `.mix-${key}-${process.pid}.wav`);
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", ...args, "-filter_complex_threads", "2", "-filter_complex", chains.join(";"),
      "-map", "[audio]", "-t", String(job.segment.durationInFrames / 60), "-ar", "48000", "-ac", "1", "-threads", "2", temporary]);
    await rename(temporary, path.join(output, audio));
  } finally { await rm(temporary, { force: true }); }
  return audio;
};
for (const job of jobs) job.audio = await withMediaResources(() => audioFor(job), { directory: output });
await writeFile(path.join(output, "render-inputs.json"), JSON.stringify(jobs, null, 2));
const samples = jobs.map(({ id, segment }) => ({ id, frames: segment.renderData.fullframe.map(({ motion }) => ({
  startFrame: motion.startFrame, runtimeEndFrame: motion.runtimeEndFrame,
  samples: Array.from({ length: motion.runtimeEndFrame - motion.startFrame + 1 }, (_, offset) => {
    const frame = motion.startFrame + offset;
    return { frame, viewport: viewportForCamera(cameraAtFrame({ motion, frame })) };
  })
})) }));
const end = id => samples.find(job => job.id === id).frames[0].samples.at(-1).viewport;
if (Math.abs(end("corridor-constant").x - end("corridor-rhythm").x) > 1e-9) throw new Error("节奏对照的实际末框不同");
await writeFile(path.join(output, "camera-samples.json"), JSON.stringify(samples, null, 2));

for (const job of jobs.filter(({id}) => !requested || requested.includes(id))) {
  const projectDirectory = await withMediaResources(async () => {
    const props = scenePreviewProps({segment:job.segment,captions:job.speech,audioFile:job.audio});
    const projectDirectory = await prepareRenderPublic({workspaceRoot:output,systemRoot,renderPlan:props,
      publicDirectory:path.join(output,"projects",job.id)});
    await compileComposition({props,projectDirectory});
    return projectDirectory;
  }, { directory: output });
  if (mode === "stills") await snapshotComposition({projectDirectory,
      frames:job.id.startsWith("joint") ? [0,432,480,504,528,959] : [0,210,270,360,job.segment.durationInFrames-1],
      outputDirectory:path.join(output,job.id)});
  else if (mode === "video") await renderComposition({projectDirectory,output:path.join(output,`${job.id}.mp4`)});
  if (mode !== "stills" && mode !== "video") await launchComposition(projectDirectory);
}
if (mode === "video") await writeFile(path.join(output,"index.html"),await readFile(path.join(directory,"preview.html")));
