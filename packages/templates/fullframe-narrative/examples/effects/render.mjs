import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compileComposition } from "../../../../modules/render-video/runtime/compile.mjs";
import { scenePreviewProps } from "../../../../modules/render-video/runtime/scene-preview.mjs";
import { launchComposition, renderComposition, snapshotComposition } from "../../../../modules/render-video/runtime/hyperframes.mjs";
import { withMediaResources } from "../../../../modules/render-video/runtime/media-process.mjs";
import Ajv2020 from "ajv/dist/2020.js";
import { withVisualFontPaths } from "../../../../visual-fonts.mjs";
import { prepareRenderPublic } from "../../../../modules/render-video/runtime/public-files.mjs";
import { cameraAtFrame } from "../../camera/runtime-layer.mjs";
import { EFFECT_STUDIES, studySegment, transitionStudySegment } from "./data.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const systemRoot = path.resolve(directory, "../../../../..");
const output = path.resolve(process.argv[2] ?? path.join(directory, "output"));
const mode = process.argv[3] ?? "preview";
const visualStyle = withVisualFontPaths(JSON.parse(await readFile(path.join(systemRoot, "visuals/modern-editorial/render/tokens.json"))), "modern-editorial");
const schema = JSON.parse(await readFile(path.join(systemRoot, "contracts/fullframe-treatment.schema.json")));
// Teaching images are local rendering inputs, not episode image-production receipts.
schema.$defs.fullframeRequest.required = schema.$defs.fullframeRequest.required.filter(key => key !== "asset");
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const jobs = [
  ...EFFECT_STUDIES.map((study) => ({ id: study.id, segment: studySegment({ study, visualStyle }) })),
  ...["winter-camp", "march", "office"].map((image) => ({ id: `base-${image}`,
    segment: studySegment({ study: { id: image, image, effects: [] }, visualStyle, baseline: true }) })),
  ...["low", "high"].map((intensity) => ({ id: `snow-${intensity}`,
    segment: studySegment({ study: EFFECT_STUDIES[0], visualStyle, intensity }) })),
  { id: "transition", segment: transitionStudySegment({ visualStyle }) }
];
for (const { id, segment } of jobs) if (!validate(segment.treatment)) throw new Error(`${id}: ${JSON.stringify(validate.errors)}`);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "render-inputs.json"), JSON.stringify(jobs, null, 2));
// Numerical evidence accompanies actual videos; it does not stand in for viewing them.
const reference = jobs.find(({ id }) => id === "base-winter-camp").segment.renderData.fullframe[0].motion;
for (const job of jobs.filter(({ id }) => ["snow", "foreground", "emotion", "fog", "snow-low", "snow-high"].includes(id))) {
  if (JSON.stringify(job.segment.renderData.fullframe[0].motion) !== JSON.stringify(reference)) throw new Error(`${job.id}改变了运镜`);
}
await writeFile(path.join(output, "camera-samples.json"), JSON.stringify({ fps: 60, motion: reference,
  frames: Array.from({ length: 600 }, (_, frame) => ({ frame, ...cameraAtFrame({ motion: reference, frame }) })) }, null, 2));
const requested = process.env.EFFECT_STUDY_IDS?.split(",");
for (const job of jobs.filter(({id}) => !requested || requested.includes(id))) {
  const projectDirectory = await withMediaResources(async () => {
    const props = scenePreviewProps({segment:job.segment});
    const projectDirectory = await prepareRenderPublic({workspaceRoot:output,systemRoot,renderPlan:props,
      publicDirectory:path.join(output,"projects",job.id)});
    await compileComposition({props,projectDirectory});
    return projectDirectory;
  }, { directory: output });
  if (mode === "stills") await snapshotComposition({projectDirectory,
      frames:[job.id === "emotion" ? 150 : job.id === "transition" ? 482 : 330],outputDirectory:path.join(output,job.id)});
  else if (mode === "video") await renderComposition({projectDirectory,output:path.join(output,`${job.id}.mp4`)});
  if (mode !== "stills" && mode !== "video") await launchComposition(projectDirectory);
}
