import {isExplainerTemplateId} from '../../packages/explainer-template-selection.mjs';
import path from "node:path";
import { episodeReferenceVideos } from "../../packages/reference-program.mjs";
import { readAcceptedNarrationEvidence } from "../p1-revision-materials.mjs";
import { authorSegmentId, getEpisodePaths } from "../../packages/workspace-paths.mjs";
import { hashObject } from "../../packages/program-utils.mjs";
import {
  cueSlice,
  projectAuthorBeat,
  projectAuthorUnitDirection,
  projectAuthorUnitBeats,
  projectAuthorUnitSemantics
} from "../../packages/modules/author-beat/projection.mjs";
import { projectAcceptedOpenerBodyDependencies } from "../../packages/modules/author-bookend/dependency-projection.mjs";
import { fullframeTransitionHandoffForAuthorUnit } from "../../packages/templates/fullframe-narrative/camera/author-transition-handoff.mjs";
import { assemblyResources } from ".././assembly.mjs";
import {
  P3_BODY_REDESIGN_SCOPE,
  authorUnitsForStoryboard,
  businessContent,
  completedBodySlice,
  enabledFeatureIdsForNode,
  openerAlbumDirection,
  producerInputsWithSelectedSources,
  requireDirectorAcceptanceDigest,
  staticBodyBeat
} from "./storyboard.mjs";
import { importModule, relative } from "./files.mjs";
import { controllerSpecFor, featureAdapter, soleImplementationId } from "./implementations.mjs";
import { aiTask } from "./tasks.mjs";
import { authorVisualContext, sourceAssetsDigest } from "./visual-inputs.mjs";
import { collectQuoteRequests, quoteBatchInputs, resolveQuoteDecisions, retainedQuoteEvidence } from "../../packages/templates/fullframe-narrative/callout/batch.mjs";
import { restartPending } from "./stage-restart.mjs";
const assertProjectedTemplateContext = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须返回对象`);
  }
  return value;
};

const templateAuthorContextFromAssembly = async ({ root, assembly, input }) => {
  const entries = assemblyResources(assembly, { kind: "template", role: "authorContextEntry" });
  if (entries.length === 0) return null;
  if (entries.length !== 1) {
    throw new Error(
      `当前Author节点必须至多装配一个模板 authorContextEntry，实际 ${entries.length}`
    );
  }
  const adapter = await importModule(path.resolve(root, entries[0].source));
  if (typeof adapter.projectAuthorContext !== "function") {
    throw new Error(`${entries[0].packageId} authorContextEntry 必须导出 projectAuthorContext`);
  }
  return assertProjectedTemplateContext(
    await adapter.projectAuthorContext(input),
    `${entries[0].packageId}.projectAuthorContext`
  );
};

const featureAuthorContextsFromAssembly = async ({root, assembly, input}) => Object.fromEntries(
  await Promise.all(assemblyResources(assembly, {kind:'feature', role:'authorContextEntry'}).map(async entry => {
    const adapter = await importModule(path.resolve(root, entry.source));
    if (typeof adapter.projectAuthorContext !== 'function')
      throw new Error(`${entry.packageId} authorContextEntry 必须导出 projectAuthorContext`);
    return [entry.packageId, assertProjectedTemplateContext(await adapter.projectAuthorContext(input),
      `${entry.packageId}.projectAuthorContext`)];
  }))
);

const projectAdjacentTreatmentForAuthor = async ({
  root,
  model,
  treatment,
  cameraRuntimeEvidence = {}
}) => {
  const projected = businessContent(treatment);
  const defaultProjection = {
    templateId: projected?.templateId,
    continuity: projected?.continuity ?? null
  };
  const record = model.packages.get(projected?.templateId);
  const entry = record?.manifest?.authorContextEntry;
  if (!entry) return defaultProjection;
  const adapter = await importModule(path.resolve(record.directory, entry));
  if (typeof adapter.projectAdjacentTreatment !== "function") return defaultProjection;
  return assertProjectedTemplateContext(
    await adapter.projectAdjacentTreatment(projected, cameraRuntimeEvidence),
    `${record.manifest.id}.projectAdjacentTreatment`
  );
};

const authorPreviousTreatmentProducerInputsForResult = ({ result, previousTreatmentInput }) => {
  if (!previousTreatmentInput) return [];
  const hashes = [];
  const previousContinuity = previousTreatmentInput.continuity ?? null;
  const physicalInput = {};
  if (result.continuity?.continuesPreviousScene === true) {
    if (!previousTreatmentInput.exitPicture) throw Object.assign(
      new Error("同场景承接缺少上一末张场景"), { code: "author-previous-input-missing" });
    const { motion: _motion, ...picture } = previousTreatmentInput.exitPicture;
    physicalInput.exitPicture = previousTreatmentInput.templateId === "fullframe-narrative"
      ? picture : previousTreatmentInput.exitPicture;
  }
  const currentSubjects = new Set(result.continuity?.subjects ?? []);
  const currentProps = new Set(result.continuity?.props ?? []);
  const consumedCarry = {
    subjects: (previousContinuity?.carryToNext?.subjects ?? []).filter((item) =>
      currentSubjects.has(item)
    ),
    props: (previousContinuity?.carryToNext?.props ?? []).filter((item) => currentProps.has(item))
  };
  if (consumedCarry.subjects.length > 0 || consumedCarry.props.length > 0) {
    physicalInput.carryToNext = consumedCarry;
  }
  if (Object.keys(physicalInput).length > 0) {
    hashes.push(
      hashObject({
        templateId: previousTreatmentInput.templateId,
        continuity: physicalInput
      })
    );
  }
  const cameraRelation = result.assetRequests?.[0]?.cameraRelation;
  if (new Set(["continue", "motivated-reverse", "visual-match"]).has(cameraRelation)) {
    if (!previousTreatmentInput.cameraState) {
      throw Object.assign(new Error(`${cameraRelation} 缺少紧邻上一全画幅相机状态`),
        { code: "author-previous-input-missing" });
    }
    hashes.push(
      hashObject({
        templateId: previousTreatmentInput.templateId,
        exitFrameId: previousTreatmentInput.exitFrameId,
        cameraState: previousTreatmentInput.cameraState
      })
    );
  }
  return hashes;
};

const previousTreatmentInputForAuthorUnit = async ({ root, model, previousAuthorUnit, authorUnit, authorUnits, storyboard, cues, programForm, openerTemplate, includeCamera = true }) => {
  if (!previousAuthorUnit?.treatment || authorUnit.templateId !== "fullframe-narrative"
    || previousAuthorUnit.templateId !== "fullframe-narrative"
    || !authorSegmentId(authorUnit) || authorSegmentId(previousAuthorUnit) !== authorSegmentId(authorUnit)) return null;
  const transitionHandoff = includeCamera ? fullframeTransitionHandoffForAuthorUnit({
    previousAuthorUnit, currentAuthorUnit: authorUnit, authorUnits, storyboard, cues, programForm, openerTemplate
  }) : null;
  return projectAdjacentTreatmentForAuthor({
    root, model, treatment: previousAuthorUnit.treatment,
    cameraRuntimeEvidence: transitionHandoff ? { transitionHandoff } : {}
  });
};

const controllerInputs = ({
  record,
  projections,
  scope = null,
  controlInputs = {},
  controlContext = {},
  controlInputHashes = [],
  controlProducerInputHashes = controlInputHashes
}) => {
  const inputs = {};
  const context = {};
  const inputHashes = [];
  const producerInputHashes = [];
  const addValues = (target, values, label, kind) => {
    for (const [key, value] of Object.entries(values ?? {})) {
      if (Object.hasOwn(target, key))
        throw new Error(
          `${record.manifest.id} 的 controller reads 重复投递${kind} ${key}: ${label}`
        );
      target[key] = value;
    }
  };
  for (const { role, whenScope } of controllerSpecFor(record).reads) {
    if (whenScope && whenScope !== scope) continue;
    const projection = projections[role];
    if (!projection)
      throw new Error(`${record.manifest.id} 的 controller reads 没有底座投影: ${role}`);
    addValues(inputs, projection.inputs, role, "输入");
    addValues(context, projection.context, role, "运行上下文");
    inputHashes.push(...(projection.inputHashes ?? []));
    producerInputHashes.push(...(projection.producerInputHashes ?? projection.inputHashes ?? []));
  }
  addValues(inputs, controlInputs, "workflow-control", "输入");
  addValues(context, controlContext, "workflow-control", "运行上下文");
  inputHashes.push(...controlInputHashes);
  producerInputHashes.push(...controlProducerInputHashes);
  return {
    inputs,
    context,
    inputHashes: [...new Set(inputHashes)],
    producerInputHashes: [...new Set(producerInputHashes)]
  };
};

const projectAuthorInputs = async ({
  root,
  workspaceRoot = root,
  episodeId,
  model,
  inspected,
  understanding,
  storyboard,
  node,
  assembly,
  authorUnit,
  programPlan,
  visualPackage,
  previousAuthorUnit = null,
  nextAuthorUnit = null,
  p3Revision = null,
  repairFeatureIds = []
}) => {
  const authorUnits = authorUnitsForStoryboard(storyboard);
  const record = model.packages.get(node.moduleId);
  const templateId = soleImplementationId(assembly, "template", `${node.id}/${authorUnit.id}`);
  const templateRecord = model.packages.get(templateId);
  if (
    !templateRecord ||
    templateRecord.manifest.kind !== "template" ||
    !model.bodyTemplateIds.includes(authorUnit.templateId) ||
    templateId !== authorUnit.templateId
  ) {
    throw new Error(
      `${authorUnit.id} 引用了当前 Workflow 未登记的正文模板: ${authorUnit.templateId}`
    );
  }
  const activeFeatureIds = enabledFeatureIdsForNode({ assembly, features: storyboard.features });
  const currentFeatureResults = {};
  if (repairFeatureIds.length || p3Revision?.revisionScope === P3_BODY_REDESIGN_SCOPE) {
    for (const featureId of activeFeatureIds) {
      const adapter = await featureAdapter({ root, assembly, featureId });
      const result = adapter.readResult({ storyboard,
        scope: { featureId, authorUnitId: authorUnit.id, unitId: authorUnit.id, beatId: authorUnit.id } });
      if (result) currentFeatureResults[featureId] = businessContent(result);
    }
  }
  const unitBeats = authorUnit.beats;
  const firstBeat = unitBeats[0];
  const lastBeat = unitBeats.at(-1);
  const authorUnitInput = businessContent({
    id: authorUnit.id,
    kind: authorUnit.kind,
    templateId: authorUnit.templateId,
    beatIds: authorUnit.beatIds,
    cueRange: [firstBeat.cueRange[0], lastBeat.cueRange[1]]
  });
  const authorUnitBeats = projectAuthorUnitBeats({
    beats: unitBeats.map((member) => businessContent(member)),
    cues: inspected.cues
  });
  const semanticContext = projectAuthorUnitSemantics({
    understanding: businessContent(understanding),
    beats: unitBeats,
    cues: inspected.cues
  });
  const directionContext = projectAuthorUnitDirection({
    albumPlan: businessContent(storyboard.albumPlan),
    beats: unitBeats
  });
  const unitCues = cueSlice(inspected.cues, authorUnitInput.cueRange);
  const featureContexts = await featureAuthorContextsFromAssembly({root, assembly, input:{
    episodeId, authorUnit:authorUnitInput, authorUnits, episodeCues:inspected.cues,
    acceptedFeatures:storyboard.features, sourceAssets:inspected.sourceAssets
  }});
  const professionalContext = await templateAuthorContextFromAssembly({
    root,
    assembly,
    input: {
      programPlan,
      visualPackage,
      episodeId,
      authorUnit: authorUnitInput,
      authorUnits,
      cues: unitCues,
      episodeCues: inspected.cues,
      albumPlan: businessContent(storyboard.albumPlan),
      acceptedBeats: storyboard.beats,
      acceptedFeatures: storyboard.features,
      beforeBeatId: firstBeat.id
    }
  });
  const templateContext = authorUnit.templateId === "vox-explainer" ? professionalContext
    : { ...professionalContext, visual: { ...authorVisualContext(visualPackage, authorUnit.templateId), ...professionalContext?.visual } };
  const beatInput =
    authorUnit.kind === "beat" ? projectAuthorBeat(businessContent(firstBeat)) : null;
  const templateRunInput =
    authorUnit.kind === "template-run"
      ? businessContent({ ...authorUnit.templateRun, treatment: null })
      : null;
  const previousTreatmentInput = await previousTreatmentInputForAuthorUnit({
    root, model, previousAuthorUnit, authorUnit, authorUnits, storyboard,
    cues: inspected.cues, programForm: programPlan?.programForm, openerTemplate: programPlan?.openerTemplate
  });
  const previousCameraInput =
    authorUnit.templateId === "fullframe-narrative" &&
    previousTreatmentInput?.cameraState
      ? {
          templateId: previousTreatmentInput.templateId,
          exitFrameId: previousTreatmentInput.exitFrameId,
          cameraState: previousTreatmentInput.cameraState
        }
      : null;
  const initialPreviousTreatmentInput = previousCameraInput
    ? {
        templateId: previousTreatmentInput.templateId,
        continuity: previousTreatmentInput.continuity,
        exitPicture: previousTreatmentInput.exitPicture
      }
    : previousTreatmentInput;
  const adjacentUnitInput = (unit) =>
    unit
      ? businessContent({
          id: unit.id,
          kind: unit.kind,
          templateId: unit.templateId,
          beatIds: unit.beatIds
        })
      : null;
  const previousAuthorUnitInput = adjacentUnitInput(previousAuthorUnit);
  const nextAuthorUnitInput = adjacentUnitInput(nextAuthorUnit);
  const nextBeatInput = nextAuthorUnit
    ? businessContent(
        (({ treatment: _treatment, _producer, ...skeleton }) => skeleton)(nextAuthorUnit.beats[0])
      )
    : null;
  const directorAcceptanceDigest = requireDirectorAcceptanceDigest(storyboard);
  const projected = controllerInputs({
    record,
    projections: {
      "beat-semantic-context": {
        inputs: { semanticContext },
        context: { semanticContext },
        inputHashes: [hashObject(semanticContext)]
      },
      "storyboard-visual-plan": {
        inputs: { directionContext },
        context: { directionContext },
        inputHashes: [hashObject(directionContext)]
      },
      "template-author-context": templateContext
        ? {
            inputs: { templateContext },
            context: { templateContext },
            inputHashes: [hashObject(templateContext)]
          }
        : { inputs: {}, context: {}, inputHashes: [] },
      "storyboard-template-selection": {
        inputs: {
          authorUnit: authorUnitInput,
          authorUnitBeats,
          beat: beatInput,
          previousTreatment: initialPreviousTreatmentInput,
          ...(previousCameraInput
            ? { previousCameraStateSha256: hashObject(previousCameraInput) }
            : {}),
          previousAuthorUnit: previousAuthorUnitInput,
          nextAuthorUnit: nextAuthorUnitInput,
          nextBeat: nextBeatInput,
          templateRun: templateRunInput
        },
        context: {
          authorUnit: authorUnitInput,
          authorUnitBeats,
          beat: beatInput,
          previousTreatment: previousTreatmentInput,
          previousAuthorUnit: previousAuthorUnitInput,
          nextAuthorUnit: nextAuthorUnitInput,
          nextBeat: nextBeatInput,
          templateRun: templateRunInput,
          selectedTemplate: authorUnit.templateId
        },
        inputHashes: [
          hashObject(authorUnitInput),
          hashObject(authorUnitBeats),
          hashObject(beatInput),
          hashObject(initialPreviousTreatmentInput),
          ...(previousCameraInput ? [hashObject(previousCameraInput)] : []),
          hashObject(previousAuthorUnitInput),
          hashObject(nextAuthorUnitInput),
          hashObject(nextBeatInput),
          hashObject(templateRunInput)
        ],
        producerInputHashes: [
          hashObject(authorUnitInput),
          hashObject(authorUnitBeats),
          hashObject(beatInput),
          hashObject(previousAuthorUnitInput),
          hashObject(nextAuthorUnitInput),
          hashObject(templateRunInput)
        ]
      },
      "storyboard-features": {
        inputs: { enabledFeatureIds: activeFeatureIds, ...(Object.keys(featureContexts).length ? {featureContexts} : {}) },
        context: { enabledFeatureIds: activeFeatureIds, ...(Object.keys(featureContexts).length ? {featureContexts} : {}) },
        inputHashes: [hashObject(activeFeatureIds)]
      },
      "narration-package": {
        inputs: { cues: unitCues },
        context: { cues: unitCues },
        inputHashes: [hashObject(unitCues)]
      },
      "source-assets": {
        inputs: { sourceAssets: inspected.sourceAssets },
        context: { sourceAssets: inspected.sourceAssets },
        inputHashes: [sourceAssetsDigest(inspected)],
        producerInputHashes: []
      }
    },
    controlInputs: {
      ...((repairFeatureIds.length || p3Revision) && authorUnit.treatment ? { repairFeatureIds, currentTreatment: businessContent(authorUnit.treatment), currentFeatureResults } : {}),
      ...(p3Revision?.revisionScope === P3_BODY_REDESIGN_SCOPE
        ? { p3BodyRedesign: businessContent(p3Revision), currentTreatment: businessContent(authorUnit.treatment), currentFeatureResults, repairBeatIds: p3Revision.selectedBeatIds?.filter(id => authorUnit.beatIds.includes(id)) ?? [] }
        : {})
    },
    controlContext: {
      ...((repairFeatureIds.length || p3Revision) && authorUnit.treatment ? { repairFeatureIds, currentTreatment: businessContent(authorUnit.treatment), currentFeatureResults } : {}),
      ...(p3Revision?.revisionScope === P3_BODY_REDESIGN_SCOPE
        ? { p3BodyRedesign: businessContent(p3Revision), currentTreatment: businessContent(authorUnit.treatment), currentFeatureResults, repairBeatIds: p3Revision.selectedBeatIds?.filter(id => authorUnit.beatIds.includes(id)) ?? [] } : {})
    },
    controlInputHashes: [
      directorAcceptanceDigest,
      ...(p3Revision ? [hashObject(businessContent(p3Revision))] : [])
    ],
    controlProducerInputHashes: [...(p3Revision ? [hashObject(businessContent(p3Revision))] : [])]
  });
  return { record, templateRecord, activeFeatureIds, previousTreatmentInput, authorUnits, projected };
};

const buildAuthorTask = async (options) => {
  const { root, workspaceRoot = root, episodeId, model, node, assembly, inspected, authorUnit,
    programPlan, authorBatch = [] } = options;
  const { record, templateRecord, activeFeatureIds, previousTreatmentInput, authorUnits, projected }
    = await projectAuthorInputs(options);
  if (authorBatch.length > 1) {
    const members = [];
    for (const unit of authorBatch) {
      const at = authorUnits.findIndex(item => item.id === unit.id);
      const member = unit.id === authorUnit.id ? projected : (await projectAuthorInputs({
        ...options, authorUnit: unit, previousAuthorUnit: authorUnits[at - 1] ?? null,
        nextAuthorUnit: authorUnits[at + 1] ?? null
      })).projected;
      if (member !== projected) projected.producerInputHashes.push(...member.producerInputHashes);
      const { episodeContext: _episode, priorVisuals: _prior, paragraph: _paragraph, visual: _visual,
        ...localContext } = member.context.templateContext;
      const inputs = Object.fromEntries(["authorUnit", "authorUnitBeats", "beat", "cues", "semanticContext",
        "directionContext", "previousAuthorUnit", "nextAuthorUnit", "nextBeat"]
        .map(key => [key, member.context[key]]));
      members.push({ beatId: unit.id, inputs: { ...inputs, templateContext: localContext } });
    }
    const batch = { id: authorUnit.paragraph.id, programForm: programPlan.programForm, openerTemplate: programPlan.openerTemplate, members };
    projected.inputs.authorBatch = batch;
    projected.context.authorBatch = batch;
    projected.inputHashes.push(hashObject(batch));
    projected.producerInputHashes.push(hashObject(batch));
  }
  return aiTask({
    root,
    model,
    workspaceRoot,
    episodeId,
    segmentId: authorSegmentId(authorUnit),
    node,
    record,
    assembly,
    ...projected,
    outputRecord: templateRecord,
    templateRecord,
    producerInputHashesForResult: (result) =>
      producerInputsWithSelectedSources({
        base: [
          ...projected.producerInputHashes,
          ...authorPreviousTreatmentProducerInputsForResult({ result, previousTreatmentInput })
        ],
        result,
        sourceAssets: inspected.sourceAssets
      }),
    featureInputHashesForResult: Object.fromEntries(
      activeFeatureIds.map((featureId) => [
        featureId,
        (result) =>
          producerInputsWithSelectedSources({
            base: projected.producerInputHashes,
            result,
            sourceAssets: inspected.sourceAssets
          })
      ])
    ),
    outputSchemaPath: path.join(root, "contracts", authorBatch.length > 1 ? "author-batch-result.schema.json" : "author-result.schema.json"),
    outputPath: getEpisodePaths(workspaceRoot, episodeId).storyboard,
    allowedWrite: authorBatch.length > 1
      ? authorBatch.map(unit => `${relative(workspaceRoot, getEpisodePaths(workspaceRoot, episodeId).storyboard)}#beats.${unit.id}.treatment + features#${unit.id} + ${relative(workspaceRoot, path.join(getEpisodePaths(workspaceRoot, episodeId).p3, "assets", unit.id))}`).join("; ")
      : `${relative(workspaceRoot, getEpisodePaths(workspaceRoot, episodeId).storyboard)}#${authorUnit.kind === "template-run" ? `templateRuns.${authorUnit.id}` : `beats.${authorUnit.id}`}.treatment${activeFeatureIds.length ? ` + features[${activeFeatureIds.join(",")}]#${authorUnit.id}` : ""} + ${relative(workspaceRoot, path.join(getEpisodePaths(workspaceRoot, episodeId).p3, 'assets', authorUnit.id))}`,
    taskId: `${episodeId}/${authorUnit.id}/author`,
    mode: "treatment",
    context: projected.context,
    object: {
      authorUnitId: authorUnit.id,
      ...(authorBatch.length > 1 ? { authorBatchIds: authorBatch.map(unit => unit.id) } : {}),
      ...(authorUnit.kind === "template-run"
        ? { templateRunId: authorUnit.id }
        : { beatId: authorUnit.id })
    }
  });
};

const buildAuthorQuoteTask = async ({ root, workspaceRoot, episodeId, model, inspected, storyboard, node, assembly, programPlan, quoteRevision = null }) => {
  const notebookId = programPlan?.researchLibrary?.notebookId;
  const resolved = resolveQuoteDecisions(storyboard, { notebookId, cues: inspected.cues });
  if (restartPending(model, storyboard.authorQuotes)) resolved.clear();
  for (const id of quoteRevision?.selectedBeatIds ?? []) resolved.delete(id);
  const quoteRequests = collectQuoteRequests(storyboard).filter(item => !resolved.has(item.id)).map(({ id, request, cueRange }) => ({ id, request, cueRange }));
  if (!quoteRequests.length) throw new Error("引文收口没有当前预留请求");
  const referenceVideos = await episodeReferenceVideos(programPlan, episodeId);
  const narrationEvidence = await readAcceptedNarrationEvidence({ workspaceRoot, episodeId });
  const inputs = quoteBatchInputs({ notebookId, referenceVideos, narrationEvidence, retainedQuoteEvidence: retainedQuoteEvidence(storyboard), quoteRequests, cues: inspected.cues, quoteRevision });
  // Keep full source provenance and the exact request/Cue projection consumed by reuse.
  const reuseInputs = quoteBatchInputs({ notebookId, quoteRequests, cues: inspected.cues });
  const packageRoot = path.join(root, "packages/templates/fullframe-narrative/callout");
  return aiTask({
    root, workspaceRoot, episodeId, model, node, assembly,
    record: model.packages.get(node.moduleId),
    inputs, context: inputs, inputHashes: [hashObject(inputs)],
    producerInputHashes: [hashObject(inputs), hashObject(reuseInputs)],
    outputSchemaPath: path.join(packageRoot, "batch-result.schema.json"),
    validatorPath: path.join(packageRoot, "batch.mjs"),
    ruleFiles: [path.join(root, "packages/modules/author-beat/SKILL.md"), path.join(packageRoot, "AUTHOR.md")],
    outputPath: getEpisodePaths(workspaceRoot, episodeId).storyboard,
    allowedWrite: `${relative(workspaceRoot, getEpisodePaths(workspaceRoot, episodeId).storyboard)}#authorQuotes`,
    taskId: `${episodeId}/${node.id}/quotes`,
    mode: "author-quotes", object: { authorPhase: "quotes" }
  });
};

const buildSegmentTask = async ({
  root,
  workspaceRoot = root,
  episodeId,
  model,
  inspected,
  understanding,
  storyboard,
  node,
  assembly,
  segmentType,
  programPlan = null,
  openerNarration = null,
  previousTreatment = null,
  adjacentBeat = null,
  returnRequest = null
}) => {
  const record = model.packages.get(node.moduleId);
  const templateId = soleImplementationId(assembly, "template", node.id);
  const templateRecord = model.packages.get(templateId);
  const understandingInput = businessContent(understanding);
  const templateContext = await templateAuthorContextFromAssembly({
    root, assembly, input: { programPlan, episodeId }
  });
  const directionContext = {
    albumPlan: openerAlbumDirection(storyboard.albumPlan),
    firstBeat: storyboard.beats?.[0] ? staticBodyBeat(storyboard.beats[0]) : null
  };
  const bodyStoryboard = completedBodySlice(storyboard);
  const adjacentBeatInput = adjacentBeat ? staticBodyBeat(adjacentBeat) : null;
  const previousTreatmentInput = previousTreatment
    ? await projectAdjacentTreatmentForAuthor({ root, model, treatment: previousTreatment })
    : null;
  const directorAcceptanceDigest = requireDirectorAcceptanceDigest(storyboard);
  const projected = controllerInputs({
    record,
    scope: segmentType,
    projections: {
      "template-author-context": templateContext
        ? {
            inputs: { templateContext },
            context: { templateContext },
            inputHashes: [hashObject(templateContext)]
          }
        : { inputs: {}, context: {}, inputHashes: [] },
      "storyboard-understanding-section": {
        inputs: { understanding: understandingInput },
        context: { understanding: understandingInput },
        inputHashes: [hashObject(understandingInput)]
      },
      "storyboard-visual-plan": {
        inputs: { directionContext },
        context: { directionContext },
        inputHashes: [hashObject(directionContext)]
      },
      storyboard: {
        inputs: {
          segmentType,
          bodyStoryboard,
          previousTreatment: previousTreatmentInput,
          adjacentBeat: adjacentBeatInput
        },
        context: {
          bodyStoryboard,
          previousTreatment: previousTreatmentInput,
          adjacentBeat: adjacentBeatInput
        },
        inputHashes: [
          hashObject(bodyStoryboard),
          hashObject(previousTreatmentInput),
          hashObject(adjacentBeatInput)
        ],
        producerInputHashes: [hashObject(previousTreatmentInput), hashObject(adjacentBeatInput)]
      },
      ...(segmentType === "opener"
        ? {
            "opener-narration": {
              ...(openerNarration
                ? {
                    inputs: { openerNarration },
                    context: { openerNarration },
                    inputHashes: [hashObject({ openerNarration })]
                  }
                : { inputs: {}, context: {}, inputHashes: [], producerInputHashes: [] })
            }
          }
        : {}),
      "narration-package": {
        inputs: { narration: inspected.narration, cues: inspected.cues },
        context: { narration: inspected.narration, cues: inspected.cues },
        inputHashes: [
          inspected.narrationPackage.files.narration.sha256,
          hashObject(inspected.cues)
        ],
        producerInputHashes: []
      },
      "source-assets": {
        inputs: { sourceAssets: inspected.sourceAssets },
        context: { sourceAssets: inspected.sourceAssets },
        inputHashes: [sourceAssetsDigest(inspected)],
        producerInputHashes: []
      }
    },
    controlInputs: {
      ...(returnRequest ? { returnRequest, ...(storyboard[segmentType] ? {currentTreatment:businessContent(storyboard[segmentType])} : {}) } : {})
    },
    controlContext: { nodeId: node.id, segmentType, selectedTemplate: templateId },
    controlInputHashes: [
      directorAcceptanceDigest,
      ...(returnRequest ? [hashObject(businessContent(returnRequest))] : [])
    ],
    controlProducerInputHashes: [
      ...(returnRequest ? [hashObject(businessContent(returnRequest))] : [])
    ]
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
    outputRecord: templateRecord,
    templateRecord,
    producerInputHashesForResult: (result) =>
      producerInputsWithSelectedSources({
        base: [
          ...projected.producerInputHashes,
          hashObject(projectAcceptedOpenerBodyDependencies({ bodyStoryboard, result }))
        ],
        result,
        sourceAssets: inspected.sourceAssets
      }),
    outputPath: getEpisodePaths(workspaceRoot, episodeId).episodePackage,
    allowedWrite: `${relative(workspaceRoot, getEpisodePaths(workspaceRoot, episodeId).episodePackage)}#${segmentType} + ${relative(workspaceRoot,path.join(getEpisodePaths(workspaceRoot,episodeId).p4,"assets",segmentType))}`,
    taskId: `${episodeId}/${segmentType}`,
    mode: "segment",
    context: projected.context,
    object: { segmentType }
  });
};

export {
  authorPreviousTreatmentProducerInputsForResult,
  previousTreatmentInputForAuthorUnit,
  buildAuthorTask,
  buildAuthorQuoteTask,
  buildSegmentTask,
  controllerInputs
};
