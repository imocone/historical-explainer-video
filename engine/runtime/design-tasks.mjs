import { projectVideoProduction } from "../../packages/templates/cinematic-video/production-projection.mjs";
import path from "node:path";
import { hashObject } from "../../packages/program-utils.mjs";
import { getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { relative } from "./files.mjs";
import {
  businessContent,
  directorResultSlice,
  producerInputsWithSelectedSources,
  requireDirectorAcceptanceDigest
} from "./storyboard.mjs";
import { aiTask, programTask } from "./tasks.mjs";
import { catalogsFromAssembly } from "./implementations.mjs";
import { sourceAssetsDigest, videoVisualContext } from "./visual-inputs.mjs";
import { controllerInputs } from "./author-tasks.mjs";
const buildUnderstandingTask = async ({
  node,
  assembly,
  model,
  inspected,
  workspaceRoot,
  returnRequests,
  root,
  episodeId,
  paths
}) => {
  const record = model.packages.get(node.moduleId);
  const narrationPackageProjection = {
    episodeId: inspected.narrationPackage.episodeId,
    language: inspected.narrationPackage.language,
    durationMs: inspected.narrationPackage.durationMs,
    narrationSha256: inspected.narrationPackage.files.narration.sha256,
    subtitlesSha256: inspected.narrationPackage.files.subtitles.sha256
  };
  const projected = controllerInputs({
    record,
    projections: {
      "narration-package": {
        inputs: {
          narrationPackage: {
            source: `${relative(workspaceRoot, inspected.narrationPackagePath)}#semantic-inputs`,
            sha256: hashObject(narrationPackageProjection),
            content: narrationPackageProjection
          },
          narration: {
            source: relative(workspaceRoot, inspected.filePaths.narration),
            sha256: inspected.narrationPackage.files.narration.sha256,
            content: inspected.narration
          },
          cues: inspected.cues
        },
        context: { cues: inspected.cues },
        inputHashes: [
          hashObject(narrationPackageProjection),
          inspected.narrationPackage.files.narration.sha256,
          inspected.narrationPackage.files.subtitles.sha256
        ]
      },
      "source-assets": {
        inputs: { sourceAssets: inspected.sourceAssets },
        context: { sourceAssets: inspected.sourceAssets },
        inputHashes: [sourceAssetsDigest(inspected)],
        producerInputHashes: []
      }
    },
    controlInputs: {
      ...(returnRequests.get(node.id) ? { returnRequest: returnRequests.get(node.id) } : {})
    },
    controlInputHashes: [
      ...(returnRequests.get(node.id)
        ? [hashObject(businessContent(returnRequests.get(node.id)))]
        : [])
    ]
  });
  const task = await aiTask({
    root,
    model,
    workspaceRoot,
    episodeId,
    node,
    record,
    assembly,
    ...projected,
    producerInputHashesForResult: (result) =>
      producerInputsWithSelectedSources({
        base: projected.producerInputHashes,
        result,
        sourceAssets: inspected.sourceAssets
      }),
    outputPath: paths.storyboard,
    allowedWrite: `${relative(workspaceRoot, paths.storyboard)}#understanding`,
    taskId: `${episodeId}/${node.id}`,
    mode: "understanding",
    context: projected.context
  });
  return task;
};

const buildVisualDirectorTask = async ({
  node,
  assembly,
  model,
  storyboard,
  returnRequests,
  workspaceRoot,
  inspected,
  paths,
  root,
  episodeId
}) => {
  const record = model.packages.get(node.moduleId);
  const understanding = storyboard.understanding;
  const understandingInput = businessContent(understanding);
  const returnRequest = returnRequests.get(node.id) ?? null;
  const currentVisualPlan = storyboard.albumPlan ? directorResultSlice(storyboard) : null;
  const availableTemplateCatalogs = catalogsFromAssembly(assembly, "template");
  const projected = controllerInputs({
    record,
    projections: {
      "source-assets": {
        inputs: { sourceAssets: inspected.sourceAssets },
        context: { sourceAssets: inspected.sourceAssets },
        inputHashes: [sourceAssetsDigest(inspected)],
        producerInputHashes: []
      },
      "narration-package": {
        inputs: {
          narration: {
            source: relative(workspaceRoot, inspected.filePaths.narration),
            sha256: inspected.narrationPackage.files.narration.sha256,
            content: inspected.narration
          },
          cues: inspected.cues
        },
        context: { narration: inspected.narration, cues: inspected.cues },
        inputHashes: [
          inspected.narrationPackage.files.narration.sha256,
          inspected.narrationPackage.files.subtitles.sha256
        ]
      },
      "storyboard-understanding-section": {
        inputs: {
          understanding: {
            source: `${relative(workspaceRoot, paths.storyboard)}#understanding`,
            sha256: hashObject(understandingInput),
            content: understandingInput
          }
        },
        context: { understanding: understandingInput },
        inputHashes: [hashObject(understandingInput)]
      },
      "template-catalog": {
        inputs: {
          templates: availableTemplateCatalogs.map((item) => item.content)
        },
        context: {
          templates: availableTemplateCatalogs.map((item) => item.content)
        },
        inputHashes: availableTemplateCatalogs.map((item) => item.sha256),
        producerInputHashes: []
      }
    },
    controlInputs: {
      ...(currentVisualPlan ? { currentVisualPlan } : {}),
      ...(returnRequest ? { returnRequest } : {})
    },
    controlContext: {
      ...(currentVisualPlan ? { currentVisualPlan } : {}),
      ...(returnRequest ? { returnRequest } : {})
    },
    controlInputHashes: [
      ...(currentVisualPlan
        ? [hashObject(currentVisualPlan), requireDirectorAcceptanceDigest(storyboard)]
        : []),
      ...(returnRequest ? [hashObject(businessContent(returnRequest))] : [])
    ],
    controlProducerInputHashes: []
  });
  return aiTask({
    root,
    model,
    workspaceRoot,
    episodeId,
    node,
    record,
    assembly,
    ...projected,
    outputPath: paths.storyboard,
    allowedWrite: relative(workspaceRoot, paths.storyboard),
    taskId: `${episodeId}/${node.id}`,
    mode: "visual-plan",
    context: projected.context
  });
};

const buildVideoTask = async ({ root, model, workspaceRoot, episodeId, paths, node, assembly,
  storyboard, inspected, visualPackage, videoPlan = null, currentVideoPlan = null,
  renderContext = null, returnRequest = null }) => {
  const record = model.packages.get(node.moduleId);
  const production = node.id === "video-assets";
  const resource = (name, content, source) => ({
    inputs: { [name]: { content, source, sha256: hashObject(content) } },
    context: { [name]: content }, inputHashes: [hashObject(content)]
  });
  const { opener, ...bodyStory } = businessContent(storyboard);
  const story = production ? businessContent(storyboard) : bodyStory;
  const visual = videoVisualContext(visualPackage);
  const storyResource = resource("storyboard", story, relative(workspaceRoot, paths.storyboard));
  if (!production) {
    storyResource.inputs.openerReference = { source: `${relative(workspaceRoot, paths.episodePackage)}#opener` };
    storyResource.context.storyboard = businessContent(storyboard);
  }
  const projected = controllerInputs({ record, projections: {
    storyboard: {
      ...storyResource,
      inputHashes: [hashObject(story), ...(production ? [hashObject(renderContext.storyboard)] : [])],
      inputs: { ...storyResource.inputs,
        ...(production ? { opener: renderContext.storyboard.opener ?? null, featureIds: renderContext.featureIds } : {}) }
    },
    "visual-package": { inputs: { visual, ...(production ? { renderVisualPackage: renderContext.visualPackage } : {}) },
      context: { visual }, inputHashes: [hashObject(visual), ...(production ? [hashObject(renderContext.visualPackage)] : [])] },
    "narration-package": {
      inputs: { cues: inspected.cues, narration: inspected.narration, ...(production ? { input: inspected.narrationPackage } : {}) },
      context: { cues: inspected.cues }, inputHashes: [inspected.narrationPackage.files.subtitles.sha256]
    },
    "source-assets": { inputs: { sourceAssets: inspected.sourceAssets }, context: { sourceAssets: inspected.sourceAssets }, inputHashes: [sourceAssetsDigest(inspected)] },
    ...(production ? {
      "video-plan": { ...resource("videoPlan", businessContent(videoPlan), relative(workspaceRoot, paths.videoPlan)),
        inputHashes: [hashObject(projectVideoProduction(videoPlan))] }
    } : {
      "video-plan": currentVideoPlan
        ? resource("currentVideoPlan", businessContent(currentVideoPlan), relative(workspaceRoot, paths.videoPlan))
        : { inputs: { currentVideoPlan: null }, context: {}, inputHashes: [] }
    })
  }, controlInputs: returnRequest ? { returnRequest } : {}, controlContext: { episodeId } });
  if (production && videoPlan.spans.length === 0) {
    const task = await programTask({ root, model, workspaceRoot, episodeId, node, record, assembly, ...projected,
      outputPath: paths.videoManifest, context: projected.context, programPhase: "empty-video",
      programEntryPath: path.join(record.directory, "generate.mjs"),
      ruleFiles: [path.join(record.directory, "delivery.mjs")] });
    if (returnRequest) task.returnRequestPath = getStageWorkPaths(paths, "p4").returnRequest(node.id);
    return task;
  }
  return aiTask({ root, model, workspaceRoot, episodeId, node, record, assembly, ...projected,
    ...(!production ? { producerInputHashesForResult: result => [
      ...projected.producerInputHashes,
      ...(opener && result?.spans?.some(span => span.beatIds?.[0] === story.beats?.[0]?.id)
        ? [hashObject(opener)] : [])
    ] } : {}),
    mode: production ? "video-assets" : "video-plan", taskId: `${episodeId}/${node.id}`,
    outputPath: production ? paths.videoManifest : paths.videoPlan,
    allowedWrite: `${relative(workspaceRoot, production ? paths.videoManifest : paths.videoPlan)}${production ? "" : ` + ${relative(workspaceRoot,path.join(paths.p4,"assets"))}`}`,
    ...(!production ? { templateRecord: model.packages.get("cinematic-video") } : {}),
    context: projected.context
  });
};

export { buildUnderstandingTask, buildVisualDirectorTask, buildVideoTask };
