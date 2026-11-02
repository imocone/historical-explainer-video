import { resolveReusableNarrationMaterials } from "../p1-revision-materials.mjs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getProgramPaths, getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { getPublicationPaths } from "../../packages/publication-paths.mjs";
import { prepareProvidedCovers } from "../../packages/provided-covers.mjs";
import { atomicWriteData, fileSha256, hashObject, readData } from "../../packages/program-utils.mjs";
import { assertProjectPaths, exists, importModule, relative } from "./files.mjs";
import { validateSchema } from "./schema.mjs";
import { businessContent } from "./storyboard.mjs";
import {
  COVER_CONTENT_REVISION_SCOPE,
  COVER_VARIANTS,
  COVER_VISUAL_REGENERATION_SCOPE,
  PUBLICATION_ALL_REVISION_SCOPE,
  PUBLICATION_REVISION_SCOPE,
  assertCoverRegenerationRequest,
  assertPublicationRevisionHasNoRemoteActivity,
  assertPublicationRevisionRequest,
  sealedPublicationBusinessForRevision
} from "./publication-requests.mjs";
import { resolveStageCurrent } from "./status.mjs";
const preparePublicationRevision = async ({
  root,
  workspaceRoot,
  episodeId,
  programId,
  targetId = "release-main",
  stageId,
  revisePublication,
  reviseCover,
  revisionReason = null,
  publicationFields = [],
  regenerateCover,
  adoptCoverExamples,
  adoptCoverImages = null,
  coverVariants,
  model,
  current
}) => {
  const paths = getPublicationPaths(workspaceRoot, episodeId, targetId);
  const episodeBrief = businessContent(await readData(paths.episodeBrief));
  const authorNodeId = episodeBrief.programForm === "historical-documentary" ? "author-documentary-narration" : "author-narration";
  if (regenerateCover) {
    const workPaths = getStageWorkPaths(paths, "p1");
    const requestPath = path.join(workPaths.work, "cover-regeneration.yaml");
    const authorRevisionPath = workPaths.returnRequest(authorNodeId);
    await assertProjectPaths({
      root: workspaceRoot,
      label: "P1封面定点重生路径",
      files: [
        paths.publicationDocument,
        paths.coverReceipt,
        paths.receipts,
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        authorRevisionPath,
        requestPath
      ]
    });
    await assertPublicationRevisionHasNoRemoteActivity(paths);
    if (
      (await exists(authorRevisionPath)) ||
      (await exists(workPaths.workOrder)) ||
      (await exists(workPaths.candidate))
    ) {
      throw new Error("P1仍有未收口作者返工、工作单或候选，不能发起封面定点重生");
    }
    let createdRegenerationRequest = false;
    if (await exists(requestPath)) {
      const request = assertCoverRegenerationRequest(await readData(requestPath));
      if (hashObject(request.variants) !== hashObject(coverVariants)) {
        throw new Error(`P1已有另一范围的封面定点重生请求: ${request.variants.join(", ")}`);
      }
      if (revisionReason !== null && request.reason !== revisionReason) {
        throw new Error("现有封面重生请求的意见不能改变；请按原请求恢复");
      }
    } else {
      const coversCompleted = ["complete", "stage-complete"].includes(current.kind);
      if (!coversCompleted) {
        throw new Error("--regenerate-cover 只用于已经生成正式横竖封面、尚未发布的P1");
      }
      const publication = await readData(paths.publicationDocument);
      const coverReceipt = await readData(paths.coverReceipt);
      await mkdir(workPaths.work, { recursive: true });
      await atomicWriteData(requestPath, {
        target: "produce-covers",
        reason: revisionReason ?? "用户明确拒绝现行封面成图，只重生被点名画幅并保留已接受内容与另一画幅",
        revisionScope: COVER_VISUAL_REGENERATION_SCOPE,
        regenerationRequestId: randomUUID(),
        variants: [...coverVariants],
        baselinePublicationSha256: hashObject(businessContent(publication)),
        baselineCoverReceiptSha256: hashObject(businessContent(coverReceipt))
      });
      createdRegenerationRequest = true;
    }
    try {
      current = await resolveStageCurrent({
        root,
        workspaceRoot,
        episodeId,
        programId,
        targetId,
        stageId,
        model
      });
      if (
        current.kind !== "task" ||
        current.runner !== "program" ||
        current.programPhase !== "cover"
      ) {
        throw new Error("P1封面定点重生没有形成唯一封面程序任务");
      }
    } catch (error) {
      if (createdRegenerationRequest) await rm(requestPath, { force: true });
      throw error;
    }
  }
  if (revisePublication || reviseCover || adoptCoverExamples || adoptCoverImages) {
    const workPaths = getStageWorkPaths(paths, "p1");
    const requestPath = workPaths.returnRequest(authorNodeId);
    const coverRegenerationPath = path.join(workPaths.work, "cover-regeneration.yaml");
    const coverProductionLock = path.join(workPaths.work, "covers", "produce-cover.lock");
    const reviseAll = revisePublication && reviseCover;
    const revisionScope = reviseAll
      ? PUBLICATION_ALL_REVISION_SCOPE
      : (reviseCover || adoptCoverExamples || adoptCoverImages) ? COVER_CONTENT_REVISION_SCOPE : PUBLICATION_REVISION_SCOPE;
    const revisionLabel = adoptCoverImages ? "P1指定成图接纳" : adoptCoverExamples ? "P1样图接纳" : reviseAll ? "P1完整发布内容返工" : reviseCover ? "P1封面内容返工" : "P1文案返工";
    let createdRevisionRequest = false;
    let replacedCoverRegeneration = null;
    await assertProjectPaths({
      root: workspaceRoot,
      label: `${revisionLabel}路径`,
      files: [
        paths.publicationDocument,
        paths.receipts,
        workPaths.work,
        workPaths.workOrder,
        workPaths.candidate,
        requestPath,
        coverRegenerationPath,
        coverProductionLock
      ]
    });
    const storedRequest = await exists(requestPath) ? await readData(requestPath) : null;
    const pendingUpstreamReturn = storedRequest?.target === authorNodeId
      && storedRequest.revisionScope == null
      && typeof storedRequest.reason === "string" && storedRequest.reason.trim()
      && Array.isArray(storedRequest.cueRefs) && storedRequest.cueRefs.length === 0
      && storedRequest.exactOpenerNarration == null
      && storedRequest.reusedNarrationMaterials == null;
    if (pendingUpstreamReturn) {
      if (await exists(workPaths.candidate)) {
        throw new Error("P1上游退回已有候选，不能改签发布内容返工");
      }
      if (await exists(workPaths.workOrder)) {
        const saved = await readData(workPaths.workOrder);
        const { taskDigest, ...base } = saved;
        if (hashObject(base) !== taskDigest || saved.stageId !== "p1"
          || saved.nodeId !== authorNodeId || saved.moduleId !== authorNodeId
          || saved.runner !== "ai"
          || hashObject(saved.inputs?.returnRequest ?? null) !== hashObject(storedRequest)
          || !/^[a-f0-9]{64}$/u.test(saved.executionId ?? "")
          || saved.scratchPath !== relative(workspaceRoot,
            path.join(workPaths.work, `attempt-${saved.executionId}`))) {
          throw new Error("P1上游退回工作单与当前请求不一致");
        }
        const scratchPath = path.resolve(workspaceRoot, saved.scratchPath);
        await assertProjectPaths({ root: workspaceRoot, label: "P1上游退回临时目录", files: [scratchPath] });
        const scratchFiles = await readdir(scratchPath).catch(error =>
          error.code === "ENOENT" ? [] : Promise.reject(error));
        if (scratchFiles.length) throw new Error("P1上游退回已开始作者工作，不能改签发布内容返工");
      }
    }
    const existingRequest = storedRequest && !pendingUpstreamReturn
      ? assertPublicationRevisionRequest(storedRequest) : null;
    const revisionFields = existingRequest?.publicationFields ?? publicationFields;
    const editingCopy = revisionScope === PUBLICATION_REVISION_SCOPE
      && !revisionFields.some((field) => field.startsWith("covers."));
    const platforms = editingCopy && revisionFields.length
      ? [...new Set(revisionFields.map((field) => field.split(".")[0]))] : null;
    await assertPublicationRevisionHasNoRemoteActivity(paths, {
      allowUnresolvedCover: adoptCoverExamples, allowEditingCopy: editingCopy, platforms
    });
    if (await exists(coverProductionLock)) {
      throw new Error("P1封面生产仍在执行，不能切换为作者返工");
    }
    if (existingRequest) {
      const request = existingRequest;
      if (request.revisionScope !== revisionScope) {
        throw new Error(`P1已有另一范围的未收口返工请求: ${request.revisionScope}`);
      }
      if (adoptCoverImages) {
        const selected = await prepareProvidedCovers({ root: workspaceRoot,
          work: path.join(workPaths.work, "covers"), manifestPath: adoptCoverImages });
        if (hashObject(selected) !== hashObject(request.coverImageAdoption ?? null)) {
          throw new Error("已有另一组指定成图采用请求；请按原工作单恢复");
        }
      }
      if ((revisionReason !== null && request.reason !== revisionReason)
        || (publicationFields.length && hashObject(request.publicationFields ?? []) !== hashObject(publicationFields))) {
        throw new Error("现有发布内容返工的意见或字段范围不能改变；请按原工作单恢复");
      }
      await sealedPublicationBusinessForRevision({ paths, request });
    } else {
      if (!pendingUpstreamReturn && ((await exists(workPaths.workOrder)) || (await exists(workPaths.candidate)))) {
        throw new Error(`P1仍有未收口工作单或候选，不能发起${revisionLabel}`);
      }
      const currentPublication = await sealedPublicationBusinessForRevision({ paths });
      let coverExampleAdoption = null;
      const coverImageAdoption = adoptCoverImages ? await prepareProvidedCovers({ root: workspaceRoot,
        work: path.join(workPaths.work, "covers"), manifestPath: adoptCoverImages }) : null;
      if (adoptCoverExamples) {
        const programPlan = await readData(getProgramPaths(workspaceRoot).programPlan);
        const selectedCover = model.packages.get(programPlan.coverPackage?.coverPackageId);
        const verticalId = selectedCover?.manifest?.verticalCoverPackageId;
        const selections = {
          youtube: { id: programPlan.coverPackage?.coverPackageId, version: programPlan.coverPackage?.version },
          vertical: { id: verticalId, version: model.packages.get(verticalId)?.manifest?.version }
        };
        const variants = {};
        for (const [variant, selection] of Object.entries(selections)) {
          const record = model.packages.get(selection.id);
          const spec = record?.manifest?.finalExample;
          if (!record || record.manifest.version !== selection.version || !spec
            || !record.manifest.examples?.includes(spec.source)) {
            throw new Error(`${variant}当前Cover没有登记可直接接纳的成品样图`);
          }
          const sourceFile = path.resolve(record.directory, spec.source);
          await assertProjectPaths({ root, label: `${variant} Cover成品样图`, files: [sourceFile] });
          variants[variant] = {
            packageId: record.manifest.id,
            version: record.manifest.version,
            source: path.relative(root, sourceFile).split(path.sep).join("/"),
            sha256: await fileSha256(sourceFile),
            visibleText: [...spec.visibleText]
          };
        }
        coverExampleAdoption = { mode: "selected-cover-final-examples", variants };
      }
      const textVariants = [...COVER_VARIANTS].filter((variant) =>
        publicationFields.includes(`covers.${variant}.visibleText`));
      let baselineCoverImages;
      if (revisionScope === PUBLICATION_REVISION_SCOPE && await exists(paths.coverReceipt)) {
        const receipt = await readData(paths.coverReceipt);
        const matches = receipt.publicationSha256 === currentPublication.digest
          && receipt._producer?.outputSha256 === hashObject(businessContent(receipt));
        if (!matches && textVariants.length) {
          throw new Error("请先完成当前封面交付，再在现图上修改文字");
        }
        if (matches) baselineCoverImages = Object.fromEntries([...COVER_VARIANTS].map((variant) => [
          variant, {
            path: variant === "youtube" ? paths.coverYoutube : paths.coverVertical,
            sha256: receipt.files?.[variant]?.sha256
          }
        ]));
      }
      await mkdir(workPaths.work, { recursive: true });
      const script = await readData(paths.scriptPackage);
      const reusedNarrationMaterials = await resolveReusableNarrationMaterials({ workspaceRoot, episodeId,
        episodeBrief, materialExecutionId: script._producer?.materialExecutionId });
      await atomicWriteData(requestPath, {
        target: authorNodeId,
        revisionRequestId: randomUUID(),
        reusedNarrationMaterials,
        reason: revisionReason ?? (adoptCoverImages
          ? "用户明确指定横竖成图；保留正文、片头和平台文案，只将封面可见文字和场面说明忠实对齐所选原图，直接采用原图，不重新构思或生图"
          : adoptCoverExamples
          ? "用户明确选择当前横竖Cover包的本集成品样图；平台文案和封面场面说明保持，只把封面可见文字对齐样图并直接接纳样图"
          : reviseAll
          ? "用户明确要求一次联合重写三平台文案与横竖封面内容，完成整套发布内容交付"
          : reviseCover
            ? "用户明确要求按现行内容规则重写封面承诺并重新生产横竖封面"
            : "用户明确要求重写现行P1平台文案并保留已接受封面"),
        cueRefs: [],
        revisionScope,
        baselinePublicationSha256: currentPublication.digest,
        ...(coverExampleAdoption ? { coverExampleAdoption } : {}),
        ...(coverImageAdoption ? { coverImageAdoption } : {}),
        ...(publicationFields.length ? { publicationFields: [...publicationFields], baselinePlatforms: currentPublication.business.platforms } : {}),
        ...(baselineCoverImages ? { baselineCoverImages } : {}),
        ...(reviseAll ? {} : (reviseCover || adoptCoverExamples || adoptCoverImages)
          ? { baselinePlatforms: currentPublication.business.platforms }
          : { baselineCovers: currentPublication.business.covers })
      });
      createdRevisionRequest = true;
    }
    try {
      if (await exists(coverRegenerationPath)) {
        replacedCoverRegeneration = assertCoverRegenerationRequest(
          await readData(coverRegenerationPath)
        );
        await rm(coverRegenerationPath);
      }
      current = await resolveStageCurrent({
        root,
        workspaceRoot,
        episodeId,
        programId,
        targetId,
        stageId,
        model
      });
      if (
        current.kind !== "task" ||
        current.runner !== "ai" ||
        current.workOrder?.nodeId !== authorNodeId
      ) {
        throw new Error(`${revisionLabel}没有形成唯一P1作者工作单`);
      }
      await validateSchema(
        path.join(root, "contracts", "work-order.schema.json"),
        current.workOrder,
        "work-order"
      );
    } catch (error) {
      if (createdRevisionRequest) {
        await rm(requestPath, { force: true });
        if (pendingUpstreamReturn) await atomicWriteData(requestPath, storedRequest);
      }
      if (replacedCoverRegeneration) {
        await atomicWriteData(coverRegenerationPath, replacedCoverRegeneration);
      }
      throw error;
    }
  }
  return { current };
};

const cancelCoverRegeneration = async ({ workspaceRoot, episodeId, targetId }) => {
  const paths = getPublicationPaths(workspaceRoot, episodeId, targetId);
  const workPaths = getStageWorkPaths(paths, "p1");
  const requestPath = path.join(workPaths.work, "cover-regeneration.yaml");
  const blockers = [workPaths.workOrder, workPaths.candidate, workPaths.returnRequest("produce-covers"),
    path.join(workPaths.work, "acceptance-commit.yaml"), path.join(workPaths.work, "covers", "produce-cover.lock")];
  await assertProjectPaths({ root: workspaceRoot, label: "撤销封面重生", files: [requestPath, ...blockers,
    paths.publicationDocument, paths.coverReceipt] });
  for (const file of blockers) {
    if (await exists(file)) throw new Error("P1仍有活动作者、接纳或封面生产，不能撤销重生请求");
  }
  await assertPublicationRevisionHasNoRemoteActivity(paths);
  if (await exists(requestPath)) {
    const request = assertCoverRegenerationRequest(await readData(requestPath));
    const publication = await sealedPublicationBusinessForRevision({ paths, request });
    const receipt = businessContent(await readData(paths.coverReceipt));
    if (request.baselinePublicationSha256 !== publication.digest
      || request.baselineCoverReceiptSha256 !== hashObject(receipt)) {
      throw new Error("封面重生的正式基线已经变化，保留请求");
    }
    await rm(requestPath);
  }
  return { kind: "revision-cancelled", stageId: "p1", episodeId, targetId,
    message: "封面重生请求已撤销，现行双图与文案保留" };
};

export { preparePublicationRevision, cancelCoverRegeneration };
