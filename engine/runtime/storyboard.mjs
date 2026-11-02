import path from "node:path";
import { hashObject, withoutProducer } from "../../packages/program-utils.mjs";
import { isExplainerTemplateId } from "../../packages/explainer-template-selection.mjs";
import { importModule } from "./files.mjs";
const enabledFeatureIdsForNode = ({ assembly = null, features = {} }) => {
  if (!assembly) return [];
  const implemented = new Set(
    assembly.slots
      .flatMap((slot) => slot.implementations)
      .filter((item) => item.kind === "feature")
      .map((item) => item.packageId)
  );
  return Object.keys(features)
    .filter((featureId) => implemented.has(featureId))
    .sort();
};

const businessContent = withoutProducer;

const requireDirectorAcceptanceDigest = (storyboard) => hashObject(directorResultSlice(storyboard));

const initialFeatureStateForModel = ({ model }) => {
  const featureIds = new Set(model.featureIds);
  return Object.fromEntries(
    [...featureIds]
      .sort()
      .map((featureId) => [
        featureId,
        structuredClone(model.packages.get(featureId)?.featureInitialState ?? null)
      ])
  );
};

const directorResultSlice = (storyboard) => ({
  albumPlan: businessContent(storyboard.albumPlan),
  beats: businessContent(storyboard.beats ?? []).map(({ treatment: _treatment, ...beat }) => beat),
  templateRuns: businessContent(storyboard.templateRuns ?? []).map(
    ({ treatment: _treatment, ...run }) => run
  )
});

const staticBodyBeat = (value) => {
  const { treatment: _treatment, ...beat } = businessContent(value);
  return beat;
};

const completedBodySlice = (storyboard) => ({
  beats: businessContent(storyboard.beats ?? []),
  templateRuns: businessContent(storyboard.templateRuns ?? [])
});

const directorAlbumDirection = (albumPlan) => ({
  intent: albumPlan?.intent ?? null,
  openingState: albumPlan?.openingState ?? null,
  progression: albumPlan?.progression ?? null,
  endingState: albumPlan?.endingState ?? null
});

const openerAlbumDirection = (albumPlan) => ({
  intent: albumPlan?.intent ?? null,
  openingState: albumPlan?.openingState ?? null
});

const recurringElementsForBeat = (albumPlan, beatId) =>
  (albumPlan?.recurringElements ?? []).filter((element) =>
    (element.beatRefs ?? []).includes(beatId)
  );

const sourceAssetIdsIn = (value, found = new Set()) => {
  if (Array.isArray(value)) {
    for (const item of value) sourceAssetIdsIn(item, found);
    return found;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /^SA[0-9]{3}$/u.test(value)) found.add(value);
    return found;
  }
  for (const child of Object.values(value)) sourceAssetIdsIn(child, found);
  return found;
};

const producerInputsWithSelectedSources = ({ base, result, sourceAssets }) => {
  const selected = selectedSourceAssetHashes({ value: result, sourceAssets });
  return [...new Set([...base, ...selected])];
};

const selectedSourceAssetHashes = ({ value, sourceAssets }) => {
  const assetsById = new Map((sourceAssets ?? []).map((asset) => [asset.id, asset]));
  return [...sourceAssetIdsIn(value)]
    .map((assetId) => assetsById.get(assetId)?.sha256)
    .filter(Boolean);
};

const assertProducerSourceBindings = ({ producer, business, sourceAssets, label }) => {
  const selectedSourceIds = [...sourceAssetIdsIn(business)];
  if (!selectedSourceIds.length) return;
  const assetsById = new Map((sourceAssets ?? []).map((asset) => [asset.id, asset]));
  const unknown = selectedSourceIds.filter((assetId) => !assetsById.has(assetId));
  if (unknown.length) throw new Error(`${label} 引用了未知来源资产: ${unknown.join(", ")}`);
  const producerInputs = new Set(producer?.inputs ?? []);
  const preciselyBound = selectedSourceIds.every((assetId) =>
    producerInputs.has(assetsById.get(assetId).sha256)
  );
  if (!preciselyBound) {
    throw new Error(`${label} 没有绑定实际选择的来源资产文件摘要`);
  }
};

const assertCurrentProducerInputs = ({ producer, expectedInputs, label }) => {
  const producerInputs = new Set(producer?.inputs ?? []);
  const missing = [...new Set(expectedInputs)].filter((digest) => !producerInputs.has(digest));
  if (!missing.length) return;
  throw new Error(`${label} 的直接业务输入已变化`);
};

const directorBeat = (beat) => {
  const business = businessContent(beat);
  return {
    id: business.id,
    cueRange: business.cueRange,
    viewerOutcome: business.viewerOutcome,
    directorBrief: business.directorBrief,
    templateId: business.templateId
  };
};

const templateRunPlan = (run) => {
  const business = businessContent(run);
  return {
    id: business.id,
    templateId: business.templateId,
    beatIds: business.beatIds
  };
};

const templateRunMembership = (storyboard) => {
  const memberships = new Map();
  for (const run of storyboard?.templateRuns ?? []) {
    for (const [memberIndex, beatId] of (run.beatIds ?? []).entries()) {
      memberships.set(beatId, { run: templateRunPlan(run), memberIndex });
    }
  }
  return memberships;
};

const authorUnitsForStoryboard = (storyboard) => {
  const beats = storyboard?.beats ?? [];
  const beatsById = new Map(beats.map((beat) => [beat.id, beat]));
  const runByBeatId = new Map();
  for (const run of storyboard?.templateRuns ?? []) {
    for (const beatId of run.beatIds ?? []) runByBeatId.set(beatId, run);
  }
  const emittedRuns = new Set();
  const units = [];
  for (const beat of beats) {
    const run = runByBeatId.get(beat.id) ?? null;
    if (!run || run.templateId === "fullframe-narrative") {
      units.push({
        id: beat.id,
        kind: "beat",
        templateId: beat.templateId,
        beatIds: [beat.id],
        beats: [beat],
        beat,
        ...(run ? { paragraph: templateRunPlan(run) } : {}),
        treatment: beat.treatment ?? null
      });
      continue;
    }
    if (emittedRuns.has(run.id)) continue;
    emittedRuns.add(run.id);
    const members = (run.beatIds ?? []).map((beatId) => {
      const member = beatsById.get(beatId);
      if (!member) throw new Error(`${run.id} 引用了不存在的 Beat: ${beatId}`);
      return member;
    });
    units.push({
      id: run.id,
      kind: "template-run",
      templateId: run.templateId,
      beatIds: [...run.beatIds],
      beats: members,
      templateRun: run,
      treatment: run.treatment ?? null
    });
  }
  return units;
};

const changedDirectorBeatIds = (existing, result) => {
  const oldBeats = new Map((existing?.beats ?? []).map((beat) => [beat.id, beat]));
  const newBeats = new Map((result?.beats ?? []).map((beat) => [beat.id, beat]));
  const oldMembership = templateRunMembership(existing);
  const newMembership = templateRunMembership(result);
  const recurringBeatIds = new Set([
    ...(existing?.albumPlan?.recurringElements ?? []).flatMap((element) => element.beatRefs ?? []),
    ...(result?.albumPlan?.recurringElements ?? []).flatMap((element) => element.beatRefs ?? [])
  ]);
  return [...new Set([...oldBeats.keys(), ...newBeats.keys(), ...recurringBeatIds])].filter(
    (beatId) => {
      const previous = oldBeats.get(beatId);
      const next = newBeats.get(beatId);
      return (
        !previous ||
        !next ||
        hashObject(directorBeat(previous)) !== hashObject(directorBeat(next)) ||
        (next?.templateId !== "fullframe-narrative" && hashObject(oldMembership.get(beatId) ?? null) !==
          hashObject(newMembership.get(beatId) ?? null)) ||
        hashObject(recurringElementsForBeat(existing?.albumPlan, beatId)) !==
          hashObject(recurringElementsForBeat(result?.albumPlan, beatId))
      );
    }
  );
};

const changedDirectorRunIds = (existing, result, changedBeatIds) => {
  const oldRuns = new Map((existing?.templateRuns ?? []).map((run) => [run.id, run]));
  const newRuns = new Map((result?.templateRuns ?? []).map((run) => [run.id, run]));
  const changedBeats = new Set(changedBeatIds);
  return [...new Set([...oldRuns.keys(), ...newRuns.keys()])].filter((runId) => {
    const previous = oldRuns.get(runId);
    const next = newRuns.get(runId);
    return (
      !previous ||
      !next ||
      hashObject(templateRunPlan(previous)) !== hashObject(templateRunPlan(next)) ||
      [...(previous.beatIds ?? []), ...(next.beatIds ?? [])].some((beatId) =>
        changedBeats.has(beatId)
      )
    );
  });
};

const clearChangedBeatFeatureResults = async ({ model, storyboard, beatIds }) => {
  if (beatIds.length === 0) return;
  for (const featureId of Object.keys(storyboard.features ?? {})) {
    const record = model.packages.get(featureId);
    const authorScopes = new Set(
      (record?.manifest.implements ?? []).flatMap((implementation) => {
        const moduleRecord = model.packages.get(implementation.moduleId);
        const slot = (moduleRecord?.manifest.slots ?? []).find(
          (item) => item.id === implementation.slotId
        );
        if (!slot?.writeTargets?.includes("storyboard-feature-result")) return [];
        return model.workflow.nodes
          .filter((node) => node.moduleId === implementation.moduleId)
          .map((node) => node.scope);
      })
    );
    if (authorScopes.size === 0) continue;
    const adapter = await importModule(path.resolve(record.directory, record.manifest.validator));
    if (typeof adapter.clearResult !== "function") {
      throw new Error(`${featureId} 写入按 Beat 功能结果，但 validator 没有导出 clearResult`);
    }
    for (const beatId of beatIds) {
      adapter.clearResult({
        storyboard,
        scope: { featureId, authorUnitId: beatId, unitId: beatId, beatId }
      });
    }
  }
};

const mergeDirectorResult = ({
  model,
  assembly,
  existing,
  result,
  directorProducer,
  changedBeatIds = [],
  changedRunIds = []
}) => {
  const oldBeats = new Map((existing?.beats ?? []).map((beat) => [beat.id, beat]));
  const changed = new Set(changedBeatIds);
  const beats = result.beats.map((beat) => {
    const previous = oldBeats.get(beat.id);
    if (isExplainerTemplateId(beat.templateId)) return { ...beat, treatment: null };
    if (!previous || changed.has(beat.id)) return { ...beat, treatment: null };
    return { ...beat, treatment: previous.treatment ?? null };
  });
  const oldRuns = new Map((existing?.templateRuns ?? []).map((run) => [run.id, run]));
  const changedRuns = new Set(changedRunIds);
  const templateRuns = (result.templateRuns ?? []).map((run) => {
    const previous = oldRuns.get(run.id);
    return {
      ...businessContent(run),
      treatment: previous && !changedRuns.has(run.id) ? (previous.treatment ?? null) : null
    };
  });
  const features = existing?.features ?? initialFeatureStateForModel({ model });
  return {
    ...(existing?.understanding ? { understanding: existing.understanding } : {}),
    ...(existing?.authorQuotes ? { authorQuotes: existing.authorQuotes } : {}),
    albumPlan: businessContent(result.albumPlan),
    features,
    beats,
    templateRuns,
    _producer: directorProducer
  };
};

const P3_BODY_REDESIGN_SCOPE = "body-redesign";

export const assertP3DirectorRevisionRequest = (request, visualPlan) => {
  if (request?.target !== "director" || request.revisionScope !== "director-revision"
    || typeof request.reason !== "string" || !request.reason.trim()
    || !/^[a-f0-9]{64}$/u.test(request.baselineVisualPlanSha256 ?? "")
    || !Array.isArray(request.selectedBeatIds) || !request.selectedBeatIds.length
    || request.selectedBeatIds.some((id) => !/^B[0-9]{3}$/u.test(id))
    || new Set(request.selectedBeatIds).size !== request.selectedBeatIds.length
    || !Array.isArray(request.cueRefs) || !request.cueRefs.length
    || request.cueRefs.some((id) => !Number.isInteger(id) || id < 1)
    || new Set(request.cueRefs).size !== request.cueRefs.length
    || [request.replacesTaskDigest, request.replacesBodyRedesignSha256].some(
      (digest) => digest != null && !/^[a-f0-9]{64}$/u.test(digest))) {
    throw new Error("P3导演局部修订请求无效");
  }
  if (visualPlan && hashObject(visualPlan) !== request.baselineVisualPlanSha256) {
    throw new Error("导演局部修订的正式基线已变化，不能套用原修改范围");
  }
  return request;
};

const P3_BODY_REDESIGN_STATE = "pending-author";

const assertP3BodyRedesignRequest = (request) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("P3正文设计返工控制记录必须是对象");
  }
  if (request.target !== "author" || request.revisionScope !== P3_BODY_REDESIGN_SCOPE) {
    throw new Error("P3正文设计返工控制记录必须唯一指向 author");
  }
  if (typeof request.reason !== "string" || !request.reason.trim()) {
    throw new Error("P3正文设计返工控制记录缺少 reason");
  }
  if (!Array.isArray(request.cueRefs) || request.cueRefs.length !== 0) {
    throw new Error("P3正文设计返工不得预先指定字幕范围");
  }
  if (request.redesignState !== P3_BODY_REDESIGN_STATE) {
    throw new Error("P3正文设计返工控制记录的 redesignState 非法");
  }
  if (!/^[a-f0-9]{64}$/u.test(request.baselineVisualPlanSha256 ?? "")) {
    throw new Error("P3正文设计返工缺少合法的视觉导演基线");
  }
  if (
    !Array.isArray(request.pendingAuthorUnitIds) ||
    request.pendingAuthorUnitIds.length < 1 ||
    new Set(request.pendingAuthorUnitIds).size !== request.pendingAuthorUnitIds.length ||
    request.pendingAuthorUnitIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("P3正文设计返工缺少合法的待重作作者单元");
  }
  return request;
};

const assertP3BodyRedesignPreservesVisualPlan = ({ baselineSha256, candidateSha256 }) => {
  if (baselineSha256 !== candidateSha256) {
    throw new Error("P3正文设计返工候选改变了既有视觉导演计划、功能或片头边界");
  }
};

export {
  P3_BODY_REDESIGN_SCOPE,
  P3_BODY_REDESIGN_STATE,
  assertCurrentProducerInputs,
  assertP3BodyRedesignPreservesVisualPlan,
  assertP3BodyRedesignRequest,
  assertProducerSourceBindings,
  authorUnitsForStoryboard,
  businessContent,
  changedDirectorBeatIds,
  changedDirectorRunIds,
  clearChangedBeatFeatureResults,
  completedBodySlice,
  directorAlbumDirection,
  directorResultSlice,
  enabledFeatureIdsForNode,
  mergeDirectorResult,
  openerAlbumDirection,
  producerInputsWithSelectedSources,
  requireDirectorAcceptanceDigest,
  selectedSourceAssetHashes,
  staticBodyBeat
};
