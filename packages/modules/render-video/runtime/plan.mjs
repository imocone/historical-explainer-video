import {assetPath} from '../../../runtime-config.mjs';
import { withVisualFontPaths } from "../../../visual-fonts.mjs";
import path from "node:path";
import { collectAuthoredMedia } from "../../../authored-media.mjs";
import { resolveCueBoundary, resolveCueRange, validateCues } from "../../../cue-boundaries.mjs";
import { withoutProducer } from "../../../program-utils.mjs";
import { anchoredFrameForMs, anchoredFrameSpanForMs, VIDEO_SPEC } from "../../../video-spec.mjs";
import { buildEpisodeEnding } from "./ending.mjs";
import { bodySegmentDescriptorsFor } from "./body-segments.mjs";
import { featureRenderEntryLoaders } from "./feature-render-entries.mjs";
import { templateRenderPlanLoaders } from "./template-render-plans.mjs";
import { crossBeatTransitionPlan, resolveCrossBeatRuntimeTiming, explainerHandoffContext } from "./transitions.mjs";
import { fullframeBoundaryFieldsFor } from "../../../templates/fullframe-narrative/camera/author-transition-handoff.mjs";
import { assertRealizedCameraRelations } from "../../../templates/fullframe-narrative/camera/transition.mjs";
import { isNarrativeMedia } from "./narrative-transition.mjs";
import { videoWindow } from "../../../templates/cinematic-video/timing.mjs";
import { isExplainerTemplateId } from "../../../explainer-template-selection.mjs";
import {
  assertAnnotationOverlaySchedule,
  assertAudioTracks,
  assertEnabledFeaturesContributed,
  assertFeatureContributionOutput,
  splitTemplateRenderResult,
  validateActionTimings
} from "./render-contracts.mjs";
const normalize = (value) => value.split(path.sep).join("/");

const requestKey = ({ segmentId, requestId }) => `${segmentId}/${requestId}`;

const millisecondsForFrame = ({ frame, fps }) => (frame / fps) * 1000;

const assetReference = (item) => ({
  requestId: item.requestId,
  kind: item.kind,
  file: item.file,
  sha256: item.sha256,
  mediaType: item.mediaType,
  mimeType: item.mimeType,
  width: item.width,
  height: item.height,
  durationMs: item.durationMs,
  framing: item.framing ?? null,
  ...(item.effectAnchors ? { effectAnchors: item.effectAnchors } : {}),
  ...(item.explainerPlacement ? { explainerPlacement: item.explainerPlacement } : {})
});

const localBodyTimes = ({ id, cueRange, cues }) => {
  try {
    const { startMs, endMs } = resolveCueRange({ cueRange, cues });
    return { startMs, endMs };
  } catch (error) {
    throw new Error(`${id} cueRange 无法解析到正文 cue: ${error.message}`);
  }
};

const templateRenderPlanCache = new Map();

const featureRenderEntryCache = new Map();

const templateRenderPlanFor = async (templateId) => {
  const loader = templateRenderPlanLoaders[templateId];
  if (!loader) throw new Error(`P4 缺少模板成片计划入口: ${templateId}`);
  if (!templateRenderPlanCache.has(templateId)) templateRenderPlanCache.set(templateId, loader());
  const entry = await templateRenderPlanCache.get(templateId);
  for (const method of [
    "createRenderPolicy",
    "defaultActionTimingsForTreatment",
    "assertActionTimingsForTreatment",
    "renderData"
  ]) {
    if (typeof entry[method] !== "function")
      throw new Error(`${templateId} 成片计划入口缺少 ${method}`);
  }
  return entry;
};

const featureRenderEntryFor = async (featureId) => {
  const loader = featureRenderEntryLoaders[featureId];
  if (!loader) throw new Error(`P4 缺少功能成片贡献入口: ${featureId}`);
  if (!featureRenderEntryCache.has(featureId)) featureRenderEntryCache.set(featureId, loader());
  const entry = await featureRenderEntryCache.get(featureId);
  if (typeof entry.contribute !== "function")
    throw new Error(`P4 功能成片贡献入口缺少 contribute: ${featureId}`);
  return entry;
};

const renderDataFor = async ({ templateId, policy, ...context }) =>
  (await templateRenderPlanFor(templateId)).renderData({ ...context, policy });

async function buildRenderPlan({
  root,
  episodeId,
  storyboard,
  videoPlan = null,
  videoManifest = null,
  previewSegmentIds: selectedSegmentIds = null,
  previewPart = null,
  input,
  cues,
  sourceAssets = [],
  visualPackage,
  featureIds = []
}) {
  if (typeof input?.seriesTitle !== "string" || !input.seriesTitle.trim())
    throw new Error("P4 缺少剧集输入 seriesTitle");
  const cueErrors = validateCues(cues);
  if (cueErrors.length > 0) throw new Error(`P4 正式字幕 cue 无效: ${cueErrors.join("; ")}`);
  if (!visualPackage || typeof visualPackage !== "object")
    throw new Error("P4 缺少工作单装配的视觉包");
  if (
    typeof visualPackage.subtitleFont?.family !== "string" ||
    typeof visualPackage.subtitleFont?.path !== "string" ||
    !/^[a-f0-9]{64}$/u.test(visualPackage.subtitleFont?.sha256 ?? "") ||
    visualPackage.subtitleFont.family !== visualPackage.renderTokens?.p4?.subtitle?.fontName
  )
    throw new Error("P4 视觉包缺少已核验的正式字幕字体");
  const assetPreview = selectedSegmentIds ? {segmentIds:selectedSegmentIds} : null;
  const previewSegmentIds = assetPreview
    ? new Set(assetPreview.segmentIds)
    : null;
  const selected = (id) => !previewSegmentIds || previewSegmentIds.has(id)
    || (storyboard.templateRuns?.find((run) => run.id === id)?.beatIds.every((beatId) => previewSegmentIds.has(beatId)) ?? false)
    || (videoPlan?.spans.find((span) => span.id === id)?.beatIds.every((beatId) => previewSegmentIds.has(beatId)) ?? false);
  const videoSpanByBeat = new Map();
  const videoWindows = new Map();
  for (const span of videoPlan?.spans ?? []) {
    videoWindows.set(span.id, videoWindow({ span, storyboard, cues }));
    for (const id of span.beatIds) {
      if (videoSpanByBeat.has(id)) throw new Error(`${id} 被多个视频段重复覆盖`);
      videoSpanByBeat.set(id, span);
    }
  }
  const bodySegmentDescriptors = bodySegmentDescriptorsFor(storyboard, videoPlan, selected);
  const contextSegmentIds = new Set();
  let bodyAssetReferences = [];
  if (assetPreview) {
    let previousMedia = null;
    for (const segment of bodySegmentDescriptors) {
      if (["fullframe-narrative", "cinematic-video"].includes(segment.templateId)) previousMedia = segment.id;
      if (selected(segment.id) && isExplainerTemplateId(segment.templateId) && previousMedia)
        contextSegmentIds.add(previousMedia);
    }
    if (selected('opener') && storyboard.opener) {
      const entry = await templateRenderPlanFor(storyboard.opener.templateId);
      bodyAssetReferences = entry.bodyAssetReferencesForTreatment?.({ treatment: storyboard.opener }) ?? [];
    }
    // A complete opener window includes the body's visible entrance beneath its exit.
    if (previewPart === "opener" && bodySegmentDescriptors[0]) contextSegmentIds.add(bodySegmentDescriptors[0].id);
  }
  const required = (id) => selected(id) || contextSegmentIds.has(id);
  if (assetPreview && videoPlan?.spans.some((span) => span.beatIds.some(selected) && !selected(span.id)))
    throw new Error("视频段小样须包含该段全部Beat，避免从中间重新播放视频");
  const sequenceIds = [
    ...(Object.hasOwn(storyboard, "opener") ? ["opener"] : []),
    ...bodySegmentDescriptors.map(({ id }) => id)
  ];
  const selectedIndexes = sequenceIds.flatMap((id, index) => (selected(id) ? [index] : []));
  if (
    assetPreview &&
    (!selectedIndexes.length ||
      selectedIndexes.some(
        (index, position) => position > 0 && index !== selectedIndexes[position - 1] + 1
      ))
  )
    throw new Error("Studio 小样只能播放连续片段；非相邻样本请分别打开");
  const media = await collectAuthoredMedia({storyboard, cues, videoPlan, bodyDurationMs:input.durationMs,
    assetReferences: bodyAssetReferences,
    segmentIds: assetPreview ? new Set(['opener', ...bodySegmentDescriptors.map(segment => segment.id)].filter(required)) : null});
  const { fps, width, height } = VIDEO_SPEC;
  const visualStyle = withVisualFontPaths(visualPackage.renderTokens, visualPackage.id);
  visualStyle.p4.subtitle = {
    ...visualStyle.p4.subtitle,
    fontPublicPath: assetPath(`visuals/${visualPackage.id}/${visualPackage.subtitleFont.path}`),
    fontSha256: visualPackage.subtitleFont.sha256
  };
  const renderAssets = media;
  const requestById = new Map(media.requests.map((request) => [requestKey(request), request]));
  const itemByRequest = new Map(renderAssets.items.map((item) => [requestKey(item), item]));
  if (
    requestById.size !== media.requests.length ||
    itemByRequest.size !== renderAssets.items.length
  )
    throw new Error("作者图片 requestId 重复");
  for (const request of media.requests.filter((request) => selected(request.segmentId)
    && !videoSpanByBeat.has(request.segmentId) && request.segmentType !== "video")) {
    const item = itemByRequest.get(requestKey(request));
    if (!item) throw new Error(`作者缺少图片: ${requestKey(request)}`);

  }

  const openerEnabled = Object.hasOwn(storyboard, "opener");
  if (openerEnabled && storyboard.opener === null) throw new Error("片头已启用但尚未完成");
  const openerNarrationEnabled = openerEnabled && storyboard.opener.templateId !== "documentary-opener";
  const segmentDurationMs = async ({ treatment, label }) => {
    const templateId = treatment?.templateId;
    if (!templateId) throw new Error(`${label} 缺少 templateId`);
    const entry = await templateRenderPlanFor(templateId);
    if (typeof entry.durationMs !== "function") throw new Error(`${templateId} 缺少片段时长方法`);
    const durationMs = entry.durationMs({ treatment, fps });
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw new Error(`${templateId} 返回无效片段时长`);
    return durationMs;
  };
  const openerDurationMs = openerEnabled
    ? await segmentDurationMs({ treatment: storyboard.opener, label: "片头" })
    : 0;
  const bodyOffsetMs = openerDurationMs;
  const bodyEndMs = bodyOffsetMs + media.bodyDurationMs;
  const contentEndMs = bodyEndMs;
  const ending = buildEpisodeEnding({
    contentEndMs,
    afterSegmentId: bodySegmentDescriptors.at(-1)?.id,
    afterSegmentType: "body",
    fps
  });
  const durationMs = contentEndMs + ending.durationMs;

  const assetsFor = ({
    segmentId,
    treatment = null,
    templateId = null,
    targetDurationMs = null
  }) => {
    const requests =
      treatment?.assetRequests ??
      media.requests.filter((request) => request.segmentId === segmentId);
    return requests.map((request) => {
      const key = requestKey({ segmentId, requestId: request.requestId });
      const planned = requestById.get(key);
      if (!planned) throw new Error(`${segmentId} 引用了未登记素材请求: ${request.requestId}`);
      if (templateId && planned.templateId !== templateId)
        throw new Error(`${segmentId} 素材请求模板不一致: ${request.requestId}`);
      if (targetDurationMs !== null && planned.targetDurationMs !== targetDurationMs)
        throw new Error(`${segmentId}/${request.requestId} 素材计划时长不一致`);
      const item = itemByRequest.get(key);
      if (!item) throw new Error(`Studio 小样缺少片段必需素材: ${key}`);
      return assetReference(item);
    });
  };

  const activeFeatures = await Promise.all(
    [...new Set(featureIds)]
      // Video owns its timed shots; only remaining template actions consume P3 cue-sync bindings.
      .filter((featureId) => featureId !== "cue-sync"
        || bodySegmentDescriptors.some((segment) => segment.templateId !== "cinematic-video" && required(segment.id)))
      .map(async (featureId) => {
      const entry = await featureRenderEntryFor(featureId);
      const featureData = Object.hasOwn(storyboard.features ?? {}, featureId)
        ? storyboard.features[featureId]
        : {};
      if (featureData === null) throw new Error(`${featureId} 已启用但尚未完成`);
      return { featureId, featureData, entry };
    })
  );
  const contributedFeatureIds = new Set();

  const contributeFeatures = async (phase, context = {}) => {
    const contributions = [];
    for (const feature of activeFeatures) {
      const output = assertFeatureContributionOutput({
        featureId: feature.featureId,
        phase,
        output: await feature.entry.contribute({
          phase,
          featureId: feature.featureId,
          featureData: feature.featureData,
          root,
          episodeId,
          storyboard,
          cues,
          sourceAssets,
          fps,
          width,
          height,
          visualStyle,
          bodyOffsetMs,
          bodyEndMs,
          durationMs,
          ...context
        })
      });
      if (output === null) continue;
      contributedFeatureIds.add(feature.featureId);
      contributions.push({ featureId: feature.featureId, output });
    }
    return contributions;
  };

  const policyCache = new Map();
  const renderPolicyFor = async (templateId) => {
    if (!policyCache.has(templateId)) {
      policyCache.set(
        templateId,
        (await templateRenderPlanFor(templateId)).createRenderPolicy({
          visualStyle,
          fps,
          width,
          height
        })
      );
    }
    return policyCache.get(templateId);
  };

  const templateAudioTracks = [];
  const templateOverlays = [];
  const localOverlaysBySegmentId = new Map();
  const appendTemplateOverlays = ({ segment, localOverlays }) => {
    const segmentStartFrame = segment.startFrame;
    for (const localOverlay of localOverlays) {
      if (!localOverlay || typeof localOverlay !== "object" || Array.isArray(localOverlay)) {
        throw new Error(`${segment.templateId} 模板覆盖轨必须是对象`);
      }
      if (
        typeof localOverlay.id !== "string" ||
        !localOverlay.id ||
        !Number.isInteger(localOverlay.startFrame) ||
        !Number.isInteger(localOverlay.endFrame) ||
        localOverlay.startFrame < 0 ||
        localOverlay.endFrame <= localOverlay.startFrame
      ) {
        throw new Error(
          `${segment.templateId}/${localOverlay.id ?? "unknown"} 模板覆盖轨局部帧无效`
        );
      }
      if (localOverlay.overlayLayer !== "annotation") {
        throw new Error(`${segment.templateId}/${localOverlay.id} 模板覆盖轨必须使用全局注释层`);
      }
      if (typeof localOverlay.exclusiveLane !== "string" || !localOverlay.exclusiveLane) {
        throw new Error(`${segment.templateId}/${localOverlay.id} 模板覆盖轨缺少互斥轨道`);
      }
      if (
        !localOverlay.renderData ||
        typeof localOverlay.renderData !== "object" ||
        Array.isArray(localOverlay.renderData)
      ) {
        throw new Error(`${segment.templateId}/${localOverlay.id} 模板覆盖轨缺少完整渲染数据`);
      }
      const transitionOverlap = localOverlay.transitionOverlap ?? null;
      if (
        transitionOverlap &&
        (transitionOverlap.mode !== "crossfade" ||
          !Number.isInteger(transitionOverlap.enterDurationInFrames) ||
          transitionOverlap.enterDurationInFrames < 1 ||
          !Number.isInteger(transitionOverlap.exitDurationInFrames) ||
          transitionOverlap.exitDurationInFrames < 1)
      ) {
        throw new Error(`${segment.templateId}/${localOverlay.id} 模板覆盖轨交叉溶解参数无效`);
      }
      const startFrame = segmentStartFrame + localOverlay.startFrame;
      const endFrame = segmentStartFrame + localOverlay.endFrame;
      templateOverlays.push({
        id: localOverlay.id,
        sourceSegmentId: segment.id,
        segmentType: "overlay",
        templateId: segment.templateId,
        startMs: segment.startMs + millisecondsForFrame({ frame: localOverlay.startFrame, fps }),
        endMs: segment.startMs + millisecondsForFrame({ frame: localOverlay.endFrame, fps }),
        startFrame,
        durationInFrames: endFrame - startFrame,
        overlayLayer: localOverlay.overlayLayer,
        exclusiveLane: localOverlay.exclusiveLane,
        transitionOverlap,
        treatment: {},
        actionTimings: [],
        assetRefs: [],
        renderData: localOverlay.renderData,
        visualStyle
      });
    }
  };
  const actionTimingsFor = async ({ id, segmentType, templateId, treatment: cleanTreatment,
    localStartMs, localEndMs, durationInFrames }) => {
    const templateEntry = await templateRenderPlanFor(templateId);
    const contributedTimings = await contributeFeatures("action-timings", {
      segment: { id, segmentType, templateId, localStartMs, localEndMs, treatment: cleanTreatment }
    });
    if (contributedTimings.length > 1) {
      throw new Error(
        `${id} 动作时间存在多个功能写入者: ${contributedTimings.map(({ featureId }) => featureId).join(", ")}`
      );
    }
    const actionTimings = contributedTimings.length
      ? contributedTimings[0].output.actionTimings
      : templateEntry.defaultActionTimingsForTreatment({
          treatment: cleanTreatment,
          durationInFrames,
          fps
        });
    validateActionTimings({ actionTimings, durationInFrames, label: id });
    templateEntry.assertActionTimingsForTreatment({
      treatment: cleanTreatment,
      actionTimings,
      durationInFrames,
      fps,
      label: id
    });
    return actionTimings;
  };
  const segmentFor = async ({
    id,
    segmentType,
    templateId,
    treatment,
    startMs,
    endMs,
    localStartMs = 0,
    localEndMs = null,
    beatIds = null,
    templateRunId = null
  }) => {
    const cleanTreatment = withoutProducer(treatment);
    const targetDurationMs = endMs - startMs;
    const durationInFrames = anchoredFrameSpanForMs({
      startMs,
      endMs,
      anchorMs: bodyOffsetMs,
      fps
    });
    if (!required(id)) {
      // Only boundary metadata participates in the original timeline. Never render a missing asset.
      return {
        id,
        segmentType,
        templateId,
        startMs,
        endMs,
        durationInFrames,
        startFrame: anchoredFrameForMs({ milliseconds: startMs, anchorMs: bodyOffsetMs, fps }),
        assetRefs: [],
        ...fullframeBoundaryFieldsFor(templateId),
        // Unselected scenes contribute timing, not an authored effect to this window.
        incomingTransition: null,
        ...(segmentType === "opener"
          ? { exitTransition: (await renderPolicyFor(templateId)).exitTransition }
          : {})
      };
    }
    const templateEntry = await templateRenderPlanFor(templateId);
    const bodyAssetReferences = templateEntry.bodyAssetReferencesForTreatment?.({ treatment: cleanTreatment });
    const assetRefs = templateEntry.authoredAssetsForTreatment
      ? await templateEntry.authoredAssetsForTreatment({treatment: cleanTreatment, workspaceRoot: root, episodeId, segmentId: id})
      : assetsFor({
      segmentId: id,
      treatment: segmentType === "body" ? cleanTreatment : null,
      templateId,
      targetDurationMs: segmentType === "body" ? targetDurationMs : null
    });
    if (bodyAssetReferences) {
      assetRefs.push(...await Promise.all(bodyAssetReferences.map(async ({ requestId, segmentId, sourceRequestId }) => {
        const key = requestKey({ segmentId, requestId: sourceRequestId });
        const span = videoSpanByBeat.get(segmentId);
        if (span) {
          const source = storyboard.beats.find(({ id }) => id === segmentId);
          const window = videoWindows.get(span.id);
          const clip = videoManifest?.clips.find(({ id }) => id === span.id);
          if (!clip || clip.durationMs !== window.deliveryDurationMs)
            throw new Error(`${id}/${requestId} 缺少所引正文的完整视频交付: ${span.id}`);
          // An existing opener reference retains its Cue instant, never the replaced image's camera or layout.
          const binding = storyboard.features?.["cue-sync"]?.bindings?.[source.id]?.items.find((item) =>
            item.target === sourceRequestId && ["start-frame-motion", "dissolve-in"].includes(item.action));
          if (!binding) throw new Error(`${id}/${requestId} 缺少所引正文画面的Cue时刻`);
          const { timeMs } = resolveCueBoundary({ cueId: binding.cueId, edge: binding.edge, cues });
          const freezeFrame = anchoredFrameForMs({ milliseconds: timeMs, anchorMs: 0, fps })
            - anchoredFrameForMs({ milliseconds: window.startMs, anchorMs: 0, fps });
          if (freezeFrame < 0 || freezeFrame >= window.bodyFrameCount)
            throw new Error(`${id}/${requestId} 所引正文画面超出视频窗口`);
          return { ...assetReference({ ...clip, requestId, kind: "cinematic-video", mediaType: "video", mimeType: "video/mp4" }), freezeFrame: freezeFrame + window.headHandleFrames };
        }
        const planned = requestById.get(key);
        const item = itemByRequest.get(key);
        if (planned?.segmentType !== "body" || planned.kind !== "fullframe-image" || !item) {
          throw new Error(`${id}/${requestId} 缺少当前正文完整场景交付: ${key}`);
        }
        return { ...assetReference(item), requestId };
      })));
    }
    if (!assetRefs.length && !isExplainerTemplateId(templateId))
      throw new Error(`${id} 没有可渲染叶子素材`);
    const actionTimings = await actionTimingsFor({ id, segmentType, templateId,
      treatment: cleanTreatment, localStartMs, localEndMs, durationInFrames });
    const templateResult = await renderDataFor({
      segmentId: id,
      segmentType,
      templateId,
      treatment: cleanTreatment,
      actionTimings,
      assetRefs,
      targetDurationMs,
      durationInFrames,
      fps,
      cues:segmentType==='body'?cues.filter(cue=>cue.startMs>=localStartMs&&cue.endMs<=localEndMs):[],
      cueStartMs:localStartMs??0,
      allowPendingEffectAnchors: Boolean(assetPreview),
      policy: await renderPolicyFor(templateId)
    });
    const {
      renderData,
      entranceLeadFrames,
      incomingTransition,
      exitTransition,
      overlays: localOverlays,
      audioTracks: localAudioTracks
    } = splitTemplateRenderResult({ templateId, result: templateResult });
    if (segmentType === "opener" && exitTransition === null) {
      throw new Error(`${templateId} 片头模板必须提供非零正文入场转场`);
    }
    const segmentStartFrame = anchoredFrameForMs({
      milliseconds: startMs,
      anchorMs: bodyOffsetMs,
      fps
    });
    localOverlaysBySegmentId.set(id, localOverlays);
    for (const localTrack of localAudioTracks) {
      if (!localTrack || typeof localTrack !== "object" || Array.isArray(localTrack)) {
        throw new Error(`${templateId} 模板音轨必须是对象`);
      }
      const openerSoundMayTail = segmentType === "opener" && localTrack.kind === "sound-effect";
      if (
        !Number.isInteger(localTrack.startFrame) ||
        !Number.isInteger(localTrack.endFrame) ||
        localTrack.startFrame < 0 ||
        localTrack.startFrame >= durationInFrames ||
        localTrack.endFrame <= localTrack.startFrame ||
        (localTrack.endFrame > durationInFrames && !openerSoundMayTail)
      ) {
        throw new Error(`${templateId}/${localTrack.id ?? "unknown"} 模板音轨帧超出片段`);
      }
      if (localTrack.segmentType !== segmentType) {
        throw new Error(`${templateId}/${localTrack.id ?? "unknown"} 模板音轨片段身份不一致`);
      }
      const { startFrame, endFrame, ...globalTrack } = localTrack;
      templateAudioTracks.push({
        ...globalTrack,
        startMs: startMs + millisecondsForFrame({ frame: startFrame, fps }),
        endMs: startMs + millisecondsForFrame({ frame: endFrame, fps })
      });
    }
    const seriesTitle = segmentType === "opener" ? input.seriesTitle : null;
    return {
      id,
      segmentType,
      templateId,
      startMs,
      endMs,
      startFrame: segmentStartFrame,
      durationInFrames,
      treatment: cleanTreatment,
      actionTimings,
      assetRefs,
      ...(Array.isArray(beatIds) ? { beatIds: [...beatIds] } : {}),
      ...(templateRunId ? { templateRunId } : {}),
      ...(seriesTitle ? { seriesTitle } : {}),
      ...(entranceLeadFrames > 0 ? { entranceLeadFrames } : {}),
      ...(incomingTransition ? { incomingTransition } : {}),
      ...(exitTransition ? { exitTransition } : {}),
      renderData,
      visualStyle
    };
  };

  const videoSegments = new Map();
  if (videoPlan) {
    const loader = templateRenderPlanLoaders[videoPlan.templateId];
    const entry = loader ? await loader() : null;
    if (typeof entry?.createVideoSegments !== "function") throw new Error("当前视频模板缺少正文片段计划入口");
    for (const segment of entry.createVideoSegments({
      videoPlan, videoManifest, storyboard, cues, bodyOffsetMs, fps, visualStyle,
      previewSpanIds: assetPreview ? new Set(videoPlan.spans.filter((span) => required(span.id)).map((span) => span.id)) : null
    })) videoSegments.set(segment.id, segment);
  }
  const segments = [];
  if (openerEnabled) {
    segments.push(
      await segmentFor({
        id: "opener",
        segmentType: "opener",
        templateId: storyboard.opener.templateId,
        treatment: storyboard.opener,
        startMs: 0,
        endMs: openerDurationMs
      })
    );
  }
  for (const descriptor of bodySegmentDescriptors) {
    if (descriptor.templateId === "cinematic-video") {
      segments.push(videoSegments.get(descriptor.id));
      continue;
    }
    const local = localBodyTimes({ id: descriptor.id, cueRange: descriptor.cueRange, cues });
    segments.push(
      await segmentFor({
        id: descriptor.id,
        segmentType: "body",
        templateId: descriptor.templateId,
        treatment: descriptor.treatment,
        startMs: local.startMs + bodyOffsetMs,
        endMs: local.endMs + bodyOffsetMs,
        localStartMs: local.startMs,
        localEndMs: local.endMs,
        beatIds: descriptor.templateRunId ? descriptor.beatIds : null,
        templateRunId: descriptor.templateRunId ?? null
      })
    );
  }

  for (const segment of segments) {
    if (required(segment.id) && Object.hasOwn(videoPlan?.incomingTransitions ?? {}, segment.id)) {
      segment.incomingTransition = structuredClone(videoPlan.incomingTransitions[segment.id]);
    }
  }

  const selectedSegment = selected;
  ending.afterSegmentId = segments.at(-1).id;
  for (const [index, segment] of segments.entries()) {
    if (index > 0 && required(segment.id) && isNarrativeMedia(segments[index - 1]) && isNarrativeMedia(segment)
      && !segment.incomingTransition) throw new Error(segment.id + " 缺少作者按前后字幕语义选择的全画幅入场转场");
  }
  const transitionResolution = resolveCrossBeatRuntimeTiming({
    segments,
    transitions: crossBeatTransitionPlan(segments)
  });
  segments.splice(0, segments.length, ...transitionResolution.segments);

  for (const segment of segments) {
    if (!required(segment.id) || segment.templateId !== "fullframe-narrative") continue;
    const finalizedResult = splitTemplateRenderResult({
      templateId: segment.templateId,
      result: await renderDataFor({
        segmentId: segment.id,
        segmentType: segment.segmentType,
        templateId: segment.templateId,
        treatment: segment.treatment,
        actionTimings: segment.actionTimings,
        assetRefs: segment.assetRefs,
        targetDurationMs: segment.endMs - segment.startMs,
        durationInFrames: segment.durationInFrames,
        fps,
        allowPendingEffectAnchors: Boolean(assetPreview),
        policy: await renderPolicyFor(segment.templateId),
        runtimeTiming: {
          cameraPrerollFrames: segment.appliedCameraPrerollFrames,
          exitTailFrames: segment.appliedExitTailFrames
        }
      })
    });
    const stableBoundaryContract =
      finalizedResult.entranceLeadFrames === (segment.entranceLeadFrames ?? 0) &&
      JSON.stringify(finalizedResult.incomingTransition) ===
        JSON.stringify(segment.treatment.incomingTransition ?? null) &&
      JSON.stringify(finalizedResult.exitTransition) ===
        JSON.stringify(segment.exitTransition ?? null);
    if (!stableBoundaryContract || finalizedResult.audioTracks.length) {
      throw new Error(`${segment.id} 全画幅真实时窗收口改变了片段边界合同`);
    }
    segment.renderData = finalizedResult.renderData;
    localOverlaysBySegmentId.set(segment.id, finalizedResult.overlays);
  }

  const fullframeEndContext = ({ segment, label }) => {
    if (segment?.templateId === "cinematic-video") return {
      segmentId: segment.id,
      durationInFrames: segment.durationInFrames,
      assetRef: { ...segment.assetRefs[0], trimBefore: segment.renderData.headHandleFrames }
    };
    if (segment?.templateId !== "fullframe-narrative") {
      throw new Error(`${label} 必须是全画幅片段`);
    }
    const frames = segment.renderData?.fullframe ?? [];
    const frameData = frames.at(-1);
    if (!frameData?.motion?.startCamera || !frameData.motion.endCamera) {
      throw new Error(`${label} 缺少已派生全画幅相机状态`);
    }
    const assetRef = segment.assetRefs.find((asset) => asset.requestId === frameData.requestId);
    if (!assetRef || assetRef.kind !== "fullframe-image") {
      throw new Error(`${label} 缺少已接纳全画幅素材`);
    }
    return {
      segmentId: segment.id,
      durationInFrames: segment.durationInFrames,
      assetRef: { ...assetRef },
      motion: structuredClone(frameData.motion)
    };
  };
  let latestFullframeContext = null;
  for (const [index, segment] of segments.entries()) {
    if (!required(segment.id)) {
      if (["fullframe-narrative", "cinematic-video"].includes(segment.templateId)) latestFullframeContext = null;
      continue;
    }
    if (["fullframe-narrative", "cinematic-video"].includes(segment.templateId)) {
      latestFullframeContext = fullframeEndContext({
        segment,
        label: `${segment.id} 全画幅上下文`
      });
      continue;
    }
    if (!isExplainerTemplateId(segment.templateId)) continue;
    if (!latestFullframeContext) {
      throw new Error(`${segment.id} 前置上下文必须能追溯到正文媒体片段`);
    }
    const explainer = segment.renderData.voxExplainer;
    const handoff = explainerHandoffContext({ segment, transitions: transitionResolution.transitions });
    explainer.context = {
      previous: structuredClone(latestFullframeContext),
      ...handoff,
      continuesFromExplainer: isExplainerTemplateId(segments[index - 1]?.templateId),
      entranceLeadFrames: segment.appliedEntranceLeadFrames,
      continuesToExplainer: isExplainerTemplateId(segments[index + 1]?.templateId)
    };
    // The background is also a real asset dependency in a selected Studio window.
    segment.assetRefs.push({ ...latestFullframeContext.assetRef, requestId: "context-background" });
  }

  for (const segment of segments) {
    appendTemplateOverlays({
      segment,
      localOverlays: localOverlaysBySegmentId.get(segment.id) ?? []
    });
  }

  const overlayContributions = await contributeFeatures("overlays");
  const overlayDescriptors = overlayContributions.flatMap(({ featureId, output }) => {
    if (!Array.isArray(output.overlays)) throw new Error(`${featureId} overlays 贡献必须是数组`);
    return output.overlays.map((overlay) => ({ ...overlay, featureId }));
  });
  const previewStartMs = assetPreview ? segments.find(({ id }) => selectedSegment(id)).startMs : 0;
  const selectedPreviewEndMs = assetPreview
    ? segments.filter(({ id }) => selectedSegment(id)).at(-1).endMs
    : durationMs;
  const openerTailEndMs = previewPart === "opener" ? Math.max(selectedPreviewEndMs,
    ...templateAudioTracks.filter(track => track.segmentType === "opener" && track.kind === "sound-effect")
      .map(track => track.endMs)) : selectedPreviewEndMs;
  const firstBody = segments.find(segment => segment.id === bodySegmentDescriptors[0]?.id);
  const openerTimeline = segments.find(segment=>segment.segmentType === "opener")?.renderData?.openerTimeline;
  const previewHasPostExitBreath = previewPart === "opener"
    && Number.isInteger(openerTimeline?.durationFrames) && Number.isInteger(openerTimeline?.releaseFrame)
    && Number.isInteger(openerTimeline?.exitFrames)
    && openerTimeline.durationFrames > openerTimeline.releaseFrame + openerTimeline.exitFrames;
  const previewEndMs = (openerTailEndMs > selectedPreviewEndMs || previewHasPostExitBreath) && firstBody
    ? Math.min(firstBody.endMs, Math.max(openerTailEndMs, bodyOffsetMs + (cues[0]?.endMs ?? 0)))
    : selectedPreviewEndMs;
  const featureOverlays = overlayDescriptors
    .filter(
      (descriptor) =>
        !assetPreview || (descriptor.startMs < previewEndMs && descriptor.endMs > previewStartMs)
    )
    .map((descriptor) => {
      const { assetContract, treatment, ...publicDescriptor } = descriptor;
      if (!assetContract || !Number.isInteger(assetContract.count) || assetContract.count < 1) {
        throw new Error(`${descriptor.featureId}/${descriptor.id} 缺少合法覆盖轨素材合同`);
      }
      if (!Array.isArray(assetContract.kinds) || !assetContract.kinds.length) {
        throw new Error(`${descriptor.featureId}/${descriptor.id} 缺少覆盖轨素材类型`);
      }
      const targetDurationMs = descriptor.endMs - descriptor.startMs;
      const assetRefs = assetsFor({
        segmentId: descriptor.id,
        targetDurationMs: assetContract.durationMatchesSegment ? targetDurationMs : null
      });
      if (
        assetRefs.length !== assetContract.count ||
        assetRefs.some((asset) => !assetContract.kinds.includes(asset.kind))
      ) {
        throw new Error(`${descriptor.featureId}/${descriptor.id} 覆盖轨素材不符合功能合同`);
      }
      if (assetContract.durationMatchesSegment) {
        for (const asset of assetRefs) {
          if (!asset.durationMs || Math.abs(asset.durationMs - targetDurationMs) > 100) {
            throw new Error(`${descriptor.featureId}/${descriptor.id} 覆盖轨素材时长与目标不一致`);
          }
        }
      }
      return {
        ...publicDescriptor,
        segmentType: "overlay",
        templateId: null,
        overlayLayer: "media",
        treatment: withoutProducer(treatment ?? {}),
        actionTimings: [],
        assetRefs,
        visualStyle
      };
    });
  const overlays = [...featureOverlays, ...templateOverlays].sort(
    (left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id)
  );
  const bodyStartFrame = anchoredFrameForMs({
    milliseconds: bodyOffsetMs,
    anchorMs: bodyOffsetMs,
    fps
  });
  const bodyEndFrame = anchoredFrameForMs({ milliseconds: bodyEndMs, anchorMs: bodyOffsetMs, fps });
  if (overlays.some((overlay) => overlay.templateId === "fullframe-narrative")) {
    const entry = await templateRenderPlanFor("fullframe-narrative");
    entry.placeCalloutOverlays({ overlays, segments, policy: await renderPolicyFor("fullframe-narrative") });
  }
  assertAnnotationOverlaySchedule({ overlays, bodyStartFrame, bodyEndFrame });

  const audioTracks = [];
  audioTracks.push({
    id: "body-narration",
    kind: "narration",
    segmentType: "body",
    startMs: bodyOffsetMs,
    file: normalize(path.join(episodeId, "制作", "p2", input.files.audio.path)),
    sha256: input.files.audio.sha256,
    volume: 1,
    loop: false
  });
  if (openerNarrationEnabled) {
    const narration = storyboard.opener.narration;
    const narrationStartMs = (await renderPolicyFor(storyboard.opener.templateId)).narrationStartMs ?? 0;
    if (
      !Number.isInteger(narration?.durationMs) ||
      typeof narration?.audioSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(narration.audioSha256)
    ) {
      throw new Error("P4 片头缺少已核验的正式口播证据");
    }
    audioTracks.push({
      id: "opener-narration",
      kind: "narration",
      segmentType: "opener",
      startMs: narrationStartMs,
      endMs: narrationStartMs + narration.durationMs,
      file: normalize(path.join(episodeId, "制作", "p4", "opener-narration.mp3")),
      sha256: narration.audioSha256,
      volume: 1,
      loop: false
    });
  }
  audioTracks.push(...templateAudioTracks);
  const bodySegments = segments.filter(({ segmentType }) => segmentType === "body");
  const bodyAudioStartMs = Math.min(...bodySegments.map(({ startMs }) => startMs));
  const bodyAudioEndMs = Math.max(...bodySegments.map(({ endMs }) => endMs));
  const audioContributions = await contributeFeatures("audio-tracks", {
    segments,
    bodyOffsetMs: bodyAudioStartMs,
    bodyEndMs: bodyAudioEndMs,
    bodyEntranceLeadFrames: bodySegments[0]?.appliedEntranceLeadFrames ?? 0,
    episodeEnding: ending
  });
  for (const { featureId, output } of audioContributions) {
    if (!Array.isArray(output.audioTracks))
      throw new Error(`${featureId} audioTracks 贡献必须是数组`);
    audioTracks.push(...output.audioTracks);
  }
  const narrationTracks = audioTracks.filter((track) => track.kind === "narration");
  const expectedNarrationIds = openerNarrationEnabled
    ? ["body-narration", "opener-narration"]
    : ["body-narration"];
  if (
    narrationTracks
      .map(({ id }) => id)
      .sort()
      .join(",") !== expectedNarrationIds.sort().join(",")
  ) {
    throw new Error("P4 正式旁白轨集合与当前片段不一致");
  }
  assertEnabledFeaturesContributed({
    activeFeatureIds: activeFeatures.map((feature) => feature.featureId),
    contributedFeatureIds
  });
  assertAudioTracks({
    audioTracks,
    segments,
    durationMs,
    ending,
    bodyTimelineStartMs: bodyOffsetMs,
    fps
  });
  const bodyTimelineEndMs = Math.max(...bodySegments.map(({ endMs }) => endMs));
  const captions = cues.map((cue) => ({
    text: cue.text,
    startMs: bodyOffsetMs + cue.startMs,
    endMs: bodyOffsetMs + cue.endMs
  }));
  if (captions.at(-1).endMs > bodyTimelineEndMs) {
    throw new Error(`P4 正式字幕越过正文结束时间: ${captions.at(-1).endMs} > ${bodyTimelineEndMs}`);
  }

  const plan = {
    episodeId,
    fps,
    width,
    height,
    durationMs,
    visualPackage: {
      id: visualPackage.id,
      version: visualPackage.version
    },
    visualStyle,
    renderDigest: visualPackage.renderDigest,
    bodyTimelineStartMs: bodyOffsetMs,
    ending,
    audioTracks,
    captions,
    templateRuns: storyboard.templateRuns.map((run) => ({
      id: run.id,
      templateId: run.templateId,
      beatIds: [...run.beatIds]
    })),
    segments,
    transitions: transitionResolution.transitions,
    overlays
  };
  const allSegments = [...segments, ...overlays];
  if (new Set(allSegments.map((segment) => segment.id)).size !== allSegments.length)
    throw new Error("P4 segment id 重复");
  for (const segment of allSegments) {
    if (segment.endMs <= segment.startMs) throw new Error(`${segment.id} 时段长度无效`);
  }
  if (assetPreview) {
    const selectedSegments = segments.filter(({ id }) => selectedSegment(id));
    const visibleSegments = segments.filter(segment => selectedSegment(segment.id)
      || (previewPart === "opener" && segment.id === bodySegmentDescriptors[0]?.id));
    let fromFrame = selectedSegments[0].startFrame;
    let toFrame = selectedSegments.at(-1).startFrame + selectedSegments.at(-1).durationInFrames;
    if (previewPart === "opener" && previewEndMs > selectedPreviewEndMs)
      toFrame = anchoredFrameForMs({ milliseconds: previewEndMs, anchorMs: bodyOffsetMs, fps });
    if (previewPart === "body") toFrame = anchoredFrameForMs({ milliseconds: ending.startMs, anchorMs: bodyOffsetMs, fps })
      + ending.holdFrames + ending.fadeFrames;
    for (const boundary of previewPart ? [] : transitionResolution.transitions) {
      if (!selectedSegment(boundary.previousId) && selectedSegment(boundary.nextId)) {
        fromFrame = Math.max(fromFrame, boundary.startFrame + boundary.durationInFrames);
      }
      if (selectedSegment(boundary.previousId) && !selectedSegment(boundary.nextId)) {
        toFrame = Math.min(toFrame, boundary.startFrame);
      }
    }
    if (toFrame <= fromFrame) throw new Error("Studio 小样没有完整可见窗口，请补齐相邻片段素材");
    plan.preview = { fromFrame, toFrame, segmentIds: selectedSegments.map(({ id }) => id) };
    plan.segments = visibleSegments;
    plan.transitions = transitionResolution.transitions.filter(
      (boundary) => visibleSegments.some(segment => segment.id === boundary.previousId)
        && visibleSegments.some(segment => segment.id === boundary.nextId)
    );
    const fromMs = (fromFrame / fps) * 1000;
    const toMs = (toFrame / fps) * 1000;
    plan.audioTracks = audioTracks.filter(
      (track) => track.startMs < toMs && (track.endMs ?? durationMs) > fromMs
    );
    if (previewPart !== "body") plan.ending = null;
  }
  assertRealizedCameraRelations({ segments: plan.segments, transitions: plan.transitions, fps });
  return plan;
}

export { buildRenderPlan };
export { assertAnnotationOverlaySchedule } from "./render-contracts.mjs";
