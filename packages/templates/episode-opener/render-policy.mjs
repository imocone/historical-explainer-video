import { VIDEO_SPEC } from "../../video-spec.mjs";
import { OPENER_TIMING_POLICY } from "./timing-policy.mjs";

export const OPENER_RENDER_POLICY = Object.freeze({
  actions: Object.freeze({
    flashbackOne: Object.freeze({ id: "opener-flashback-one", target: "flashback-shot-1" }),
    flashbackTwo: Object.freeze({ id: "opener-flashback-two", target: "flashback-shot-2" }),
    flashbackThree: Object.freeze({ id: "opener-flashback-three", target: "flashback-shot-3" })
  }),
  narration: Object.freeze({ maxShareOfOpener: OPENER_TIMING_POLICY.maxNarrationShare }),
  strip: Object.freeze({
    left: -80,
    width: 2080,
    skewDegrees: 5,
    panelWidth: 1400,
    trackAnchorPanel: 5,
    exitTravelPx: 2008,
    assetObjectPositions: Object.freeze(["center 48%", "center 42%", "center 54%"]),
    lanes: Object.freeze([
      Object.freeze({ top: 76, height: 300, entryDirection: -1, assetCycle: Object.freeze([2, 1, 0]) }),
      Object.freeze({ top: 418, height: 244, entryDirection: 1, assetCycle: Object.freeze([0, 2, 1]) }),
      Object.freeze({ top: 704, height: 300, entryDirection: -1, assetCycle: Object.freeze([0, 1, 2]) })
    ])
  }),
  timingCapacity: Object.freeze({ maxDurationInFrames: OPENER_TIMING_POLICY.maxDurationInFrames }),
  exitTransition: Object.freeze({ type: "pull-reveal", direction: "right-to-left", durationInFrames: 57 })
});

export const openerVisibleStripPanels = ({ trackOffsetPx, assetCycle }) => {
  const strip = OPENER_RENDER_POLICY.strip;
  if (!Array.isArray(assetCycle) || assetCycle.length === 0) {
    throw new Error("片头横带缺少可循环的闪回图顺序");
  }
  const cycleWidthPx = strip.panelWidth * assetCycle.length;
  if (cycleWidthPx < strip.width + strip.panelWidth) {
    throw new Error("片头横带循环图数量不足以连续覆盖画面");
  }
  const anchoredTrackLeftPx = -strip.trackAnchorPanel * strip.panelWidth + trackOffsetPx;
  return {
    panels: assetCycle.map((assetIndex, panelIndex) => {
      const rawLeftPx = anchoredTrackLeftPx + panelIndex * strip.panelWidth;
      const leftPx = (((rawLeftPx + strip.panelWidth) % cycleWidthPx + cycleWidthPx) % cycleWidthPx) - strip.panelWidth;
      return { panelIndex, assetIndex, leftPx };
    })
  };
};

const frameAtStart = (milliseconds) => Math.floor(milliseconds / 1000 * VIDEO_SPEC.fps);
const frameAtEnd = (milliseconds) => Math.ceil(milliseconds / 1000 * VIDEO_SPEC.fps);

export const openerTimelineForTreatment = (treatment) => {
  const shots = treatment?.flashbackShots ?? [];
  const cues = treatment?.narration?.sentenceCues ?? [];
  if (shots.length !== 3 || cues.length !== 1) {
    throw new Error("片头动态时间线需要三张闪回图和唯一钩子口播卡点");
  }
  const cue = cues[0];
  if (cue.target !== "flashbackLine" || !Number.isInteger(cue.startMs)
    || !Number.isInteger(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) {
    throw new Error("片头唯一钩子口播卡点无效");
  }
  const start = frameAtStart(cue.startMs);
  const end = frameAtEnd(cue.endMs);
  const span = end - start;
  const firstCut = start + Math.max(1, Math.round(span * 0.4));
  const secondCut = start + Math.max(2, Math.round(span * 0.8));
  const flashbackCuts = [start, firstCut, secondCut, end];
  if (flashbackCuts.some((frame, index) => index > 0 && frame <= flashbackCuts[index - 1])) {
    throw new Error("片头钩子过短，无法容纳三个固定闪回画面");
  }
  const capacity = OPENER_TIMING_POLICY.maxDurationInFrames;
  const minStrip = OPENER_TIMING_POLICY.minStripDurationInFrames;
  const stripStart = Math.max(secondCut, Math.min(end + OPENER_TIMING_POLICY.stripDelayFrames, capacity - minStrip));
  const stripDuration = Math.min(OPENER_TIMING_POLICY.stripDurationInFrames, capacity - stripStart);
  if (stripDuration < minStrip) throw new Error("片头时间线超过 9 秒模板容量，必须重写钩子");
  return {
    flashbackCuts,
    flashbackCueEndFrame: end,
    flashes: [firstCut, secondCut, stripStart].map((at, index) => ({
      at: Math.max(1, at), intensity: [0.82, 0.82, 0.80][index]
    })),
    strip: { startFrame: stripStart, endFrame: stripStart + stripDuration },
    durationFrames: stripStart + stripDuration
  };
};

// Spend available time on the rush and braking; keep the release and breathing room intact.
export const openerStripChoreography = (timeline) => {
  const duration = timeline.strip.endFrame - timeline.strip.startFrame;
  const extra = duration - OPENER_TIMING_POLICY.minStripDurationInFrames;
  const rushExtra = Math.round(extra * 32 / 47);
  const brakeExtra = Math.round(extra * 9 / 47);
  const enter = timeline.strip.startFrame;
  const brake = enter + 45 + rushExtra;
  const stop = brake + 23 + brakeExtra;
  const release = stop + 18 + extra - rushExtra - brakeExtra;
  return { enter, brake, stop, release, end: release + 46 };
};

export const openerNarrationShareForTreatment = (treatment) => {
  const durationMs = treatment?.narration?.durationMs;
  if (!Number.isInteger(durationMs) || durationMs < 1) return null;
  const openerDurationMs = openerTimelineForTreatment(treatment).durationFrames / VIDEO_SPEC.fps * 1000;
  return durationMs / openerDurationMs;
};
