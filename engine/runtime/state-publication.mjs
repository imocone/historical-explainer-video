import { assertProvidedCovers } from "../../packages/provided-covers.mjs";
import { access, stat } from "node:fs/promises";
import { readStageRestart, restartPending } from "./stage-restart.mjs";
import { constants } from "node:fs";
import path from "node:path";
import { getProgramPaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../../packages/publication-paths.mjs";
import { hashObject, readData } from "../../packages/program-utils.mjs";
import {
  WorkflowInputError,
  assertProjectPaths,
  exists,
  importModule
} from "./files.mjs";
import "./schema.mjs";
import { loadSelectedVisualForModel, loadStageModel } from "./model.mjs";
import { controllerSpecFor, prepareNodeAssembly } from "./implementations.mjs";
import { businessContent } from "./storyboard.mjs";
import { programInvocationTask, programTask } from "./tasks.mjs";
import {
  readP1Delivery,
  validateProgramArtifact
} from "./artifacts.mjs";
import { assertCoverRegenerationRequest } from "./publication-requests.mjs";
import { coverVisualContext } from "./visual-inputs.mjs";
import { assemblyImplementations } from "../assembly.mjs";
const resolvePublicationCurrent = async ({
  root,
  workspaceRoot = root,
  episodeId,
  targetId = "release-main",
  model = null
}) => {
  model ??= await loadStageModel(root, { stageId: "p1" }), model = { ...model, stageRestart: await readStageRestart({ workspaceRoot, episodeId, stageId: "p1" }) };
  const paths = getPublicationPaths(workspaceRoot, episodeId, targetId), workPaths = getStageWorkPaths(paths, "p1"), publicationRevisionPath = workPaths.returnRequest("produce-covers"), coverRegenerationPath = path.join(workPaths.work, "cover-regeneration.yaml");
  await assertProjectPaths({
    root: workspaceRoot,
    label: "Publication Workflow \u5F53\u524D\u9636\u6BB5\u8DEF\u5F84",
    files: [
      paths.targetRequest,
      paths.scriptPackage,
      paths.openerNarration,
      paths.renderReceipt,
      paths.publicationDocument,
      paths.publicationText,
      paths.coverYoutube,
      paths.coverVertical,
      paths.coverReceipt,
      paths.receipts,
      workPaths.work,
      workPaths.workOrder,
      workPaths.candidate,
      publicationRevisionPath,
      coverRegenerationPath
    ]
  });
  let publicationRevision = null;
  if (await exists(publicationRevisionPath) && (publicationRevision = await readData(publicationRevisionPath), publicationRevision.revisionScope))
    throw new Error("\u5C01\u9762\u7A0B\u5E8F\u4E0D\u63A5\u6536\u4F5C\u8005\u4FEE\u8BA2\u8303\u56F4");
  const coverRegeneration = await exists(coverRegenerationPath) ? assertCoverRegenerationRequest(await readData(coverRegenerationPath)) : null;
  if (publicationRevision && coverRegeneration)
    throw new Error("P1\u4F5C\u8005\u8FD4\u5DE5\u4E0E\u5C01\u9762\u5B9A\u70B9\u91CD\u751F\u4E0D\u80FD\u540C\u65F6\u8FDB\u884C");
  const deliveryState = await Promise.all(
    [paths.publicationDocument, paths.publicationText, paths.coverYoutube, paths.coverVertical, paths.coverReceipt].map(async (file) => {
      try {
        const info = await stat(file);
        return !info.isFile() || info.size === 0 ? !1 : (await access(file, constants.R_OK), !0);
      } catch (error) {
        if (["ENOENT", "EACCES"].includes(error.code)) return !1;
        throw error;
      }
    })
  ), publicationDocumentExists = await exists(paths.publicationDocument), coverReceiptExists = await exists(paths.coverReceipt), historicalCoverReceipt = model.stageRestart && !publicationDocumentExists && coverReceiptExists && restartPending(model, await readData(paths.coverReceipt));
  if (!deliveryState[0] && !historicalCoverReceipt && (deliveryState.slice(1).some(Boolean) || publicationDocumentExists || coverReceiptExists))
    throw new Error(`P1\u6B63\u5F0F\u6587\u6848\u7F3A\u5931\u3001\u4E3A\u7A7A\u6216\u4E0D\u53EF\u8BFB\u53D6: ${paths.publicationDocument}\uFF1B\u4FDD\u7559\u5DF2\u6709\u4EA4\u4ED8\uFF0C\u4E0D\u81EA\u52A8\u91CD\u5199\u53D1\u5E03\u6587\u6848`);
  if (publicationDocumentExists && !deliveryState[1])
    throw new Error(`P1\u4F5C\u8005\u9605\u8BFB\u7A3F\u7F3A\u5931\u3001\u4E3A\u7A7A\u6216\u4E0D\u53EF\u8BFB\u53D6: ${paths.publicationText}\uFF1B\u8BF7\u6062\u590D\u4F5C\u8005\u4EA4\u4ED8\uFF0C\u5C01\u9762\u7A0B\u5E8F\u4E0D\u91CD\u5199\u6587\u6848`);
  const deliverablesReady = deliveryState.every(Boolean);
  if (!model.stageRestart && !publicationRevision && !coverRegeneration && deliverablesReady)
    return { kind: "complete", episodeId, targetId, message: "\u5F53\u524D\u9636\u6BB5\u4EA4\u4ED8\u9F50\u5907" };
  try {
    const { scriptPackage } = await readP1Delivery({
      root,
      workspaceRoot,
      episodeId
    });
    if (scriptPackage.episodeId !== episodeId)
      throw new Error(`script-package.yaml \u7684 episodeId \u5E94\u4E3A ${episodeId}`);
  } catch (error) {
    throw new WorkflowInputError({
      workflowId: model.workflowRecord.id,
      stageId: "p1",
      nodeId: "produce-covers",
      upstreamStageId: "p1",
      cause: error
    });
  }
  let visualPackage = null, coverSelection = null, program = null;
  if (program = await readData(getProgramPaths(workspaceRoot).programPlan), coverSelection = program.coverPackage, !coverSelection?.coverPackageId || !coverSelection?.version)
    throw new Error("program.yaml \u7F3A\u5C11\u6B63\u5F0F coverPackage \u9009\u62E9");
  const preparedByNode = /* @__PURE__ */ new Map(), prepareFor = async (node, { activeSlotIds = null } = {}) => {
    if (!preparedByNode.has(node.id)) {
      const record = model.packages.get(node.moduleId), needsVisual = activeSlotIds?.some(
        (slotId) => (record?.manifest?.slots ?? []).some(
          (slot) => slot.id === slotId && slot.selectionSource === "program-visual"
        )
      ), needsCover = activeSlotIds?.some(
        (slotId) => (record?.manifest?.slots ?? []).some(
          (slot) => slot.id === slotId && ["program-cover", "program-cover-vertical"].includes(slot.selectionSource)
        )
      );
      needsVisual && !visualPackage && (visualPackage = await loadSelectedVisualForModel({
        root,
        workspaceRoot,
        model
      })), preparedByNode.set(
        node.id,
        await prepareNodeAssembly({
          model,
          node,
          storyboard: {},
          selection: {
            ...activeSlotIds ? { activeSlotIds } : {},
            ...visualPackage ? { visualPackageId: visualPackage.id } : {},
            ...needsCover ? { coverPackageId: coverSelection.coverPackageId } : {}
          }
        })
      );
    }
    return preparedByNode.get(node.id);
  }, buildCoverTask = async ({ node, publication: publication2 }) => {
    const prepared = await prepareFor(node, { activeSlotIds: ["visual", "cover-design", "vertical-cover-design"] });
    if (!visualPackage) throw new Error(`${node.id} \u7F3A\u5C11\u5F53\u524D\u8282\u76EE\u89C6\u89C9\u5305`);
    const coverImplementations = assemblyImplementations(prepared.assembly, { kind: "cover" }), coverPackages = Object.fromEntries(Object.entries({
      youtube: "cover-design",
      vertical: "vertical-cover-design"
    }).map(([variant, slotId]) => {
      const implementations = coverImplementations.filter((entry) => entry.slotId === slotId);
      if (implementations.length !== 1 || implementations[0].resources.filter(({ role }) => role === "coverRules").length !== 1)
        throw new Error(`${node.id}/${slotId} \u5FC5\u987B\u6070\u597D\u88C5\u914D\u4E00\u4E2A\u542B\u552F\u4E00\u89C4\u5219\u8D44\u6E90\u7684Cover`);
      const implementation = implementations[0], rule = implementation.resources.find(({ role }) => role === "coverRules"), rules = rule.content, version = implementation.manifest?.content?.version;
      if (variant === "youtube" && version !== coverSelection.version)
        throw new Error(`\u8282\u76EECover\u7248\u672C\u4E0D\u4E00\u81F4: ${coverSelection.coverPackageId}@${coverSelection.version}`);
      const variantExamples = rule.content.examplesByVariant?.[variant], manifestDirectory = path.posix.dirname(implementation.manifest.source.split("#", 1)[0]), selectedExamples = variantExamples?.map((source) => path.posix.join(manifestDirectory, source)), references = implementation.resources.filter(({ role }) => role === "examples").filter(({ source }) => /\.(png|jpe?g|webp)$/iu.test(source)).filter(({ source }) => !selectedExamples || selectedExamples.includes(source)).map(({ source, sha256 }) => ({ source, absolutePath: path.resolve(root, source), sha256 })), finalExampleSpec = (implementation.resources.find(({ role }) => role === "finalExample") ?? null)?.content ?? null;
      let finalExample = null;
      if (finalExampleSpec) {
        const manifestSource = implementation.manifest.source.split("#", 1)[0], source = path.posix.join(path.posix.dirname(manifestSource), finalExampleSpec.source), reference = references.find((item) => item.source === source);
        if (!reference) throw new Error(`${implementation.packageId}\u7684finalExample\u5FC5\u987B\u5C5E\u4E8E\u5DF2\u88C5\u914Dexamples`);
        finalExample = {
          source,
          absolutePath: reference.absolutePath,
          sha256: reference.sha256,
          visibleText: [...finalExampleSpec.visibleText]
        };
      }
      return [variant, {
        id: implementation.packageId,
        version,
        coverDigest: hashObject({
          rules: rule.sha256,
          references: references.map(({ sha256 }) => sha256),
          finalExample
        }),
        rules,
        references,
        ...finalExample ? { finalExample } : {}
      }];
    })), publicationBusiness = businessContent(publication2), coverVisual = coverVisualContext(visualPackage), coverAuthorDigest = publicationBusiness.coverReuse ? null : publication2?._producer?.taskDigest ?? null, coverExampleAdoption = publicationRevision?.coverExampleAdoption ?? null;
    const coverImageAdoption = publicationRevision?.coverImageAdoption ?? null;
    if (coverImageAdoption) await assertProvidedCovers({ root: workspaceRoot, adoption: coverImageAdoption });
    if (coverExampleAdoption)
      for (const [variant, selected] of Object.entries(coverExampleAdoption.variants ?? {})) {
        const current = coverPackages[variant];
        if (!current?.finalExample || selected.packageId !== current.id || selected.version !== current.version || selected.source !== current.finalExample.source || selected.sha256 !== current.finalExample.sha256 || hashObject(selected.visibleText) !== hashObject(current.finalExample.visibleText))
          throw new Error(`${variant}\u6837\u56FE\u63A5\u7EB3\u8BF7\u6C42\u4E0E\u5F53\u524D\u88C5\u914DCover\u6210\u54C1\u6837\u56FE\u4E0D\u4E00\u81F4`);
      }
    const inputs = {
      publication: publicationBusiness,
      visualPackage: {
        id: coverVisual.id,
        version: coverVisual.version,
        coverDigest: coverVisual.coverDigest
      },
      coverPackages: Object.fromEntries(Object.entries(coverPackages).map(([variant, cover]) => [
        variant,
        { id: cover.id, version: cover.version, coverDigest: cover.coverDigest }
      ])),
      ...coverAuthorDigest ? { coverAuthorDigest } : {},
      ...coverRegeneration ? { coverRegeneration } : {},
      ...coverExampleAdoption ? { coverExampleAdoption } : {},
      ...coverImageAdoption ? { coverImageAdoption } : {}
    }, context = {
      publication: publicationBusiness,
      visualPackage: coverVisual,
      coverPackages,
      ...coverAuthorDigest ? { coverAuthorDigest } : {},
      ...coverRegeneration ? { coverRegeneration } : {},
      ...coverExampleAdoption ? { coverExampleAdoption } : {},
      ...coverImageAdoption ? { coverImageAdoption } : {}
    }, inputHashes = [
      hashObject(publicationBusiness),
      coverVisual.coverDigest,
      ...Object.values(coverPackages).map(({ coverDigest }) => coverDigest),
      ...coverAuthorDigest ? [coverAuthorDigest] : [],
      ...coverRegeneration ? [hashObject(coverRegeneration)] : [],
      ...coverExampleAdoption ? [hashObject(coverExampleAdoption)] : [],
      ...coverImageAdoption ? [hashObject(coverImageAdoption)] : []
    ], manifest = prepared.record.manifest;
    if (!manifest.programEntry || !manifest.outputSchema || !(manifest.rules ?? []).length)
      throw new Error(`${prepared.record.manifestPath} \u7F3A\u5C11\u5C01\u9762\u7A0B\u5E8F\u5165\u53E3\u3001\u7ED3\u679C\u5408\u540C\u6216\u89C4\u5219`);
    const task = await programTask({
      root,
      model,
      workspaceRoot,
      episodeId,
      subjectId: episodeId,
      subjectPaths: paths,
      invocation: { episodeId, targetId },
      taskId: `${episodeId}/${targetId}/${node.id}/cover`,
      node,
      record: prepared.record,
      assembly: prepared.assembly,
      inputs,
      inputHashes,
      outputPath: paths.coverReceipt,
      context,
      programPhase: "cover",
      programEntryPath: path.resolve(prepared.record.directory, manifest.programEntry),
      outputSchemaPath: path.resolve(prepared.record.directory, manifest.outputSchema),
      ruleFiles: manifest.rules.map(
        (rule) => path.resolve(prepared.record.directory, rule)
      ),
      controllerSpec: controllerSpecFor(prepared.record)
    });
    return coverRegeneration ? task.returnRequestPath = coverRegenerationPath : publicationRevision && (task.returnRequestPath = publicationRevisionPath), { prepared, task };
  }, inspectCoverTask = async ({ node, publication: publication2 }) => {
    const { task } = await buildCoverTask({ node, publication: publication2 }), inspection = await (await importModule(task.entryPath)).inspect({
      root: workspaceRoot,
      systemRoot: root,
      episodeId,
      targetId,
      task: programInvocationTask(task)
    });
    return { task, inspection };
  };
  let publication = null, coverReceipt = null;
  for (const node of model.orderedNodes.filter(
    (node2) => node2.moduleId === "produce-covers"
  )) {
    const primitive = (await prepareFor(node, { activeSlotIds: ["visual", "cover-design", "vertical-cover-design"] })).descriptor.primitive;
    if (primitive === "program-covers") {
      if (!await exists(paths.publicationDocument)) return {
        kind: "blocked-upstream",
        upstreamStageId: "p1",
        nodeId: node.id,
        reason: "P1\u4F5C\u8005\u5C1A\u672A\u4EA4\u4ED8\u53D1\u5E03\u6587\u6848\u4E0E\u5C01\u9762\u6784\u601D\uFF0C\u8BF7\u5B8C\u6210\u5F53\u524D\u4F5C\u8005\u4EFB\u52A1"
      };
      if (publication = await readData(paths.publicationDocument), coverRegeneration) {
        const publicationBusiness = businessContent(publication);
        if (coverRegeneration.baselinePublicationSha256 !== hashObject(publicationBusiness))
          throw new Error("P1\u5C01\u9762\u5B9A\u70B9\u91CD\u751F\u671F\u95F4\u6B63\u5F0F\u53D1\u5E03\u5185\u5BB9\u5DF2\u7ECF\u53D8\u5316");
        if (!await exists(paths.coverReceipt))
          throw new Error("P1\u5C01\u9762\u5B9A\u70B9\u91CD\u751F\u7F3A\u5C11\u73B0\u884C\u6B63\u5F0F\u5C01\u9762\u56DE\u6267");
        const baselineReceipt = await readData(paths.coverReceipt);
        if (coverRegeneration.baselineCoverReceiptSha256 !== hashObject(businessContent(baselineReceipt)))
          throw new Error("P1\u5C01\u9762\u5B9A\u70B9\u91CD\u751F\u671F\u95F4\u6B63\u5F0F\u5C01\u9762\u56DE\u6267\u5DF2\u7ECF\u53D8\u5316");
      }
      if (!model.stageRestart && !publicationRevision && !coverRegeneration && deliverablesReady)
        continue;
      const inspectedCover = await inspectCoverTask({ node, publication });
      if (!inspectedCover.inspection?.valid)
        return {
          ...inspectedCover.task,
          reason: inspectedCover.inspection?.reason ?? "\u5E73\u53F0\u5C01\u9762\u5C1A\u672A\u751F\u6210",
          authorizationRequired: inspectedCover.inspection?.authorizationRequired === !0,
          paidCallRequired: inspectedCover.inspection?.paidCallRequired === !0,
          unknownExternal: inspectedCover.inspection?.unknownExternal === !0,
          waitingExternal: inspectedCover.inspection?.waitingExternal === !0,
          readyToRun: inspectedCover.inspection?.readyToRun === !0,
          hardFailure: inspectedCover.inspection?.hardFailure === !0
        };
      if (publicationRevision) return {
        ...inspectedCover.task,
        readyToRun: !0,
        paidCallRequired: !1,
        reason: "\u73B0\u6709\u5C01\u9762\u53EF\u590D\u7528\uFF0C\u6536\u53E3\u672C\u6B21\u4EA4\u4ED8\u8BF7\u6C42"
      };
      try {
        await validateProgramArtifact(inspectedCover.task, inspectedCover.inspection.result);
      } catch (error) {
        return { ...inspectedCover.task, reason: error.message };
      }
      coverReceipt = inspectedCover.inspection.result;
      continue;
    }
    throw new Error(`Publication Workflow \u539F\u8BED\u6CA1\u6709\u8FD0\u884C\u65F6\u5904\u7406\u903B\u8F91: ${primitive}`);
  }
  return {
    kind: "complete",
    episodeId,
    targetId,
    message: "\u5F53\u524D Workflow \u5168\u90E8\u5B8C\u6210",
    publication,
    coverReceipt
  };
};
export {
  resolvePublicationCurrent
};
