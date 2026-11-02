import path from "node:path";
import { anchoredFrameSpanForMs, VIDEO_SPEC } from "../../../video-spec.mjs";
const contributionFieldByPhase = new Map([
  ["action-timings", "actionTimings"],
  ["overlays", "overlays"],
  ["audio-tracks", "audioTracks"]
]);

const assertFeatureContributionOutput = ({ featureId, phase, output }) => {
  const field = contributionFieldByPhase.get(phase);
  if (!field) throw new Error(`P4 未知功能贡献阶段: ${phase}`);
  if (output === null || output === undefined) return null;
  if (typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${featureId} ${phase} 贡献必须返回对象或 null`);
  }
  const keys = Object.keys(output);
  if (keys.length !== 1 || keys[0] !== field) {
    throw new Error(`${featureId} ${phase} 贡献必须且只能返回 ${field}`);
  }
  return output;
};

const assertEnabledFeaturesContributed = ({ activeFeatureIds, contributedFeatureIds }) => {
  const missing = activeFeatureIds.filter((featureId) => !contributedFeatureIds.has(featureId));
  if (missing.length) throw new Error(`P4 已启用功能没有合法成片贡献: ${missing.join(", ")}`);
};

const validateActionTimings = ({ actionTimings, durationInFrames, label }) => {
  if (!Array.isArray(actionTimings)) throw new Error(`${label} 动作时间必须是数组`);
  const seen = new Set();
  for (const timing of actionTimings) {
    const key = `${timing.target}\u0000${timing.action}`;
    if (seen.has(key)) throw new Error(`${label} 动作时刻重复: ${timing.target}/${timing.action}`);
    seen.add(key);
    if (!Number.isInteger(timing.frame) || timing.frame < 0 || timing.frame >= durationInFrames) {
      throw new Error(`${label} 动作帧超出片段: ${timing.target}/${timing.action}`);
    }
  }
  return actionTimings;
};

const assertExitTransition = ({ templateId, exitTransition }) => {
  if (exitTransition === undefined) return null;
  if (!exitTransition || typeof exitTransition !== "object" || Array.isArray(exitTransition)) {
    throw new Error(`${templateId} exitTransition 必须是对象`);
  }
  if (!Number.isInteger(exitTransition.durationInFrames) || exitTransition.durationInFrames < 1) {
    throw new Error(`${templateId} exitTransition.durationInFrames 必须是正整数`);
  }
  if (["dissolve", "dip-to-black", "crossfire-open"].includes(exitTransition.type)) {
    return {
      type: exitTransition.type,
      durationInFrames: exitTransition.durationInFrames
    };
  }
  if (exitTransition.type !== "pull-reveal" || exitTransition.direction !== "right-to-left") {
    throw new Error(`${templateId} 不支持此片段离场类型或方向`);
  }
  return {
    type: exitTransition.type,
    direction: exitTransition.direction,
    durationInFrames: exitTransition.durationInFrames
  };
};

const splitTemplateRenderResult = ({ templateId, result }) => {
  if (result === null)
    return {
      renderData: null,
      entranceLeadFrames: 0,
      incomingTransition: null,
      exitTransition: null,
      overlays: [],
      audioTracks: []
    };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${templateId} 成片计划入口必须返回对象或 null`);
  }
  const {
    entranceLeadFrames = 0,
    incomingTransition,
    exitTransition,
    overlays = [],
    audioTracks = [],
    ...renderData
  } = result;
  if (!Number.isInteger(entranceLeadFrames) || entranceLeadFrames < 0) {
    throw new Error(`${templateId} entranceLeadFrames 必须是非负整数`);
  }
  if (!Array.isArray(audioTracks)) throw new Error(`${templateId} audioTracks 必须是数组`);
  if (!Array.isArray(overlays)) throw new Error(`${templateId} overlays 必须是数组`);
  return {
    renderData: Object.keys(renderData).length ? renderData : null,
    entranceLeadFrames,
    incomingTransition: incomingTransition ?? null,
    exitTransition: assertExitTransition({ templateId, exitTransition }),
    overlays,
    audioTracks
  };
};

const assertAnnotationOverlaySchedule = ({ overlays, bodyStartFrame, bodyEndFrame }) => {
  if (!Array.isArray(overlays)) throw new Error("P4 覆盖轨计划必须是数组");
  if (
    !Number.isInteger(bodyStartFrame) ||
    !Number.isInteger(bodyEndFrame) ||
    bodyEndFrame <= bodyStartFrame
  ) {
    throw new Error("P4 正文覆盖轨边界无效");
  }
  const previousByLane = new Map();
  let activeCallouts = [];
  for (const overlay of overlays) {
    if (overlay.overlayLayer !== "annotation") continue;
    if (
      !Number.isInteger(overlay.startFrame) ||
      !Number.isInteger(overlay.durationInFrames) ||
      overlay.durationInFrames < 1
    ) {
      throw new Error(`${overlay.id} 注释覆盖轨缺少确定全局帧`);
    }
    const endFrame = overlay.startFrame + overlay.durationInFrames;
    if (overlay.startFrame < bodyStartFrame || endFrame > bodyEndFrame) {
      throw new Error(`${overlay.id} 注释覆盖轨无法完整闭合在正文内`);
    }
    if (overlay.templateId === "fullframe-narrative") {
      activeCallouts = activeCallouts.filter((item) => item.endFrame > overlay.startFrame);
      const callouts = overlay.renderData?.calloutOverlayGroup?.callouts;
      if (!callouts?.length) throw new Error(`${overlay.id} 缺少解说框显示位置`);
      for (const callout of callouts) {
        const rectangle = callout.screenRectangle;
        if (!rectangle || !["x", "y", "width", "height"].every((key) => Number.isFinite(rectangle[key]))
          || rectangle.width <= 0 || rectangle.height <= 0) {
          throw new Error(`${overlay.id} 解说框显示位置无效`);
        }
        for (const previous of activeCallouts) {
          const other = previous.rectangle;
          if (!(rectangle.x + rectangle.width <= other.x || other.x + other.width <= rectangle.x
            || rectangle.y + rectangle.height <= other.y || other.y + other.height <= rectangle.y)) {
            throw new Error(`${previous.id} 与 ${overlay.id} 同时显示的解说框位置重叠`);
          }
        }
        activeCallouts.push({ id: overlay.id, endFrame, rectangle });
      }
      continue;
    }
    const previous = previousByLane.get(overlay.exclusiveLane);
    if (previous && previous.startFrame + previous.durationInFrames > overlay.startFrame) {
      const previousTransition = previous.transitionOverlap;
      const currentTransition = overlay.transitionOverlap;
      const overlapFrames = previous.startFrame + previous.durationInFrames - overlay.startFrame;
      const legalCrossfade =
        previousTransition?.mode === "crossfade" &&
        currentTransition?.mode === "crossfade" &&
        Number.isInteger(previousTransition.exitDurationInFrames) &&
        Number.isInteger(currentTransition.enterDurationInFrames) &&
        overlapFrames <= previousTransition.exitDurationInFrames &&
        overlapFrames <= currentTransition.enterDurationInFrames;
      if (!legalCrossfade) {
        throw new Error(`${previous.id} 与 ${overlay.id} 注释覆盖轨生命周期重叠`);
      }
    }
    previousByLane.set(overlay.exclusiveLane, overlay);
  }
  return overlays;
};

const assertRelativePublicFile = ({ file, label }) => {
  if (typeof file !== "string" || !file || file.includes("\\") || path.posix.isAbsolute(file)) {
    throw new Error(`${label} 文件必须是正斜杠相对路径`);
  }
  if (file.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`${label} 文件不得越出公共根目录`);
  }
};

const assertAudioTracks = ({
  audioTracks,
  segments,
  durationMs,
  ending = null,
  bodyTimelineStartMs = 0,
  fps = VIDEO_SPEC.fps
}) => {
  if (!Array.isArray(audioTracks)) throw new Error("P4 audioTracks 必须是数组");
  if (new Set(audioTracks.map((track) => track?.id)).size !== audioTracks.length) {
    throw new Error("P4 audio track id 重复");
  }
  const segmentByType = new Map();
  for (const segment of segments) {
    const existing = segmentByType.get(segment.segmentType);
    segmentByType.set(
      segment.segmentType,
      existing
        ? {
            startMs: Math.min(existing.startMs, segment.startMs),
            endMs: Math.max(existing.endMs, segment.endMs)
          }
        : { startMs: segment.startMs, endMs: segment.endMs }
    );
  }
  const openerEndMs = Math.max(
    0,
    ...segments.filter(({ segmentType }) => segmentType === "opener").map(({ endMs }) => endMs)
  );
  for (const track of audioTracks) {
    if (!track || typeof track !== "object" || Array.isArray(track))
      throw new Error("P4 音轨必须是对象");
    if (typeof track.id !== "string" || !track.id) throw new Error("P4 音轨缺少 id");
    if (!new Set(["narration", "background-music", "sound-effect"]).has(track.kind)) {
      throw new Error(`${track.id} 音轨 kind 无效`);
    }
    if (!new Set(["body", "opener"]).has(track.segmentType)) {
      throw new Error(`${track.id} 音轨 segmentType 无效`);
    }
    if (!Number.isFinite(track.startMs) || track.startMs < 0 || track.startMs >= durationMs) {
      throw new Error(`${track.id} 音轨开始时间无效`);
    }
    if (
      track.endMs !== undefined &&
      (!Number.isFinite(track.endMs) || track.endMs <= track.startMs || track.endMs > durationMs)
    ) {
      throw new Error(`${track.id} 音轨结束时间无效`);
    }
    assertRelativePublicFile({ file: track.file, label: track.id });
    if (typeof track.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(track.sha256)) {
      throw new Error(`${track.id} 音轨 sha256 无效`);
    }
    // Sound effects use the PCM mixer's linear gain, including amplification.
    if (!Number.isFinite(track.volume) || track.volume <= 0 || (track.kind !== "sound-effect" && track.volume > 1)) {
      throw new Error(`${track.id} 音轨音量无效`);
    }
    if (track.pan !== undefined && (track.kind !== 'sound-effect' || !Number.isFinite(track.pan) || Math.abs(track.pan) > 1)) {
      throw new Error(`${track.id} 音效声像无效`);
    }
    if (typeof track.loop !== "boolean") throw new Error(`${track.id} 音轨 loop 必须是布尔值`);
    if (track.gainEnvelopes !== undefined) {
      if (track.kind !== 'background-music' || !Array.isArray(track.gainEnvelopes))
        throw new Error(`${track.id} 音乐包络无效`);
      for (const points of track.gainEnvelopes) {
        if (!Array.isArray(points) || points.length < 2
          || points.some((point, index) => !Number.isInteger(point.frame) || !Number.isFinite(point.gain)
            || point.gain < 0 || point.gain > 1 || index > 0 && point.frame <= points[index-1].frame))
          throw new Error(`${track.id} 音乐包络时间或增益无效`);
      }
    }
    for (const field of ["fadeInFrames", "fadeOutFrames"]) {
      if (track[field] !== undefined && (!Number.isInteger(track[field]) || track[field] < 0)) {
        throw new Error(`${track.id} 音轨 ${field} 必须是非负整数`);
      }
    }
    if (
      track.kind === "narration" &&
      (track.fadeInFrames !== undefined || track.fadeOutFrames !== undefined)
    ) {
      throw new Error(`${track.id} 正式口播不得声明淡入淡出`);
    }
    if (track.endMs !== undefined) {
      const durationInFrames = anchoredFrameSpanForMs({
        startMs: track.startMs,
        endMs: track.endMs,
        anchorMs: bodyTimelineStartMs,
        fps
      });
      if ((track.fadeInFrames ?? 0) + (track.fadeOutFrames ?? 0) > durationInFrames) {
        throw new Error(`${track.id} 音轨淡入淡出超过自身时长`);
      }
    }
    const ownerSegment = segmentByType.get(track.segmentType);
    const validBodyNarrationLead =
      track.id === "body-narration" &&
      track.kind === "narration" &&
      track.segmentType === "body" &&
      !track.loop &&
      track.startMs >= openerEndMs &&
      track.startMs <= (ownerSegment?.startMs ?? -1);
    const validBodyEndingMusic =
      track.kind === "background-music" &&
      track.segmentType === "body" &&
      ending?.afterSegmentType === "body" &&
      ending.afterSegmentId === segments.at(-1)?.id &&
      track.endMs === ending.startMs + ending.durationMs;
    const validBodyEndingSound = track.kind === 'sound-effect' && track.segmentType === 'body'
      && ending?.afterSegmentType === 'body' && ending.afterSegmentId === segments.at(-1)?.id
      && segments.some(segment => segment.id === track.sourceSegmentId && segment.segmentType === 'body')
      && track.endMs <= ending.startMs + ending.durationMs;
    const bodyMusicFadeInMs = (track.fadeInFrames ?? 0) / fps * 1000;
    const validBodyMusicPreroll =
      track.kind === "background-music" &&
      track.segmentType === "body" &&
      track.startMs <= (ownerSegment?.startMs ?? -1) &&
      (ownerSegment?.startMs ?? -1) - track.startMs <= bodyMusicFadeInMs;
    const validOpenerSoundTail = track.kind === "sound-effect" && track.segmentType === "opener"
      && !track.loop && track.endMs !== undefined && track.startMs < (ownerSegment?.endMs ?? -1)
      && segments.some(segment => segment.segmentType === "body");
    if (
      !ownerSegment ||
      (!validBodyNarrationLead && !validBodyMusicPreroll && track.startMs < ownerSegment.startMs) ||
      (!validBodyEndingMusic && !validBodyEndingSound && !validOpenerSoundTail && (track.endMs ?? track.startMs) > ownerSegment.endMs)
    ) {
      throw new Error(`${track.id} 音轨超出 ${track.segmentType} 片段`);
    }
    if (track.kind === "narration") {
      const validBody =
        track.id === "body-narration" && track.segmentType === "body" && !track.loop;
      const validOpener =
        track.id === "opener-narration" &&
        track.segmentType === "opener" &&
        !track.loop &&
        track.endMs !== undefined;
      if (!validBody && !validOpener) {
        throw new Error("P4 narration 音轨只能是正文正式口播或片头正式口播");
      }
    }
    if (track.kind === "background-music") {
      if (track.segmentType === "body") {
        if (track.endMs === undefined)
          throw new Error(`${track.id} 正文背景音乐必须闭合在正文时段`);
      } else if (track.segmentType === "opener") {
        if (
          track.endMs === undefined ||
          track.loop ||
          (track.fadeInFrames ?? 0) < 1 ||
          (track.fadeOutFrames ?? 0) < 1
        ) {
          throw new Error(`${track.id} 片头背景音乐必须非循环、闭合并设置淡入淡出`);
        }
      } else {
        throw new Error(`${track.id} 背景音乐片段身份无效`);
      }
    }
    if (
      track.kind === "sound-effect" &&
      (track.endMs === undefined || track.loop)
    ) {
      throw new Error(`${track.id} 音效必须非循环并有结束时间`);
    }
  }
  return audioTracks;
};

export {
  assertAnnotationOverlaySchedule,
  assertAudioTracks,
  assertEnabledFeaturesContributed,
  assertFeatureContributionOutput,
  splitTemplateRenderResult,
  validateActionTimings
};
