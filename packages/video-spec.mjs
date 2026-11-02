export const VIDEO_SPEC = Object.freeze({
  width: 1920,
  height: 1080,
  fps: 60,
  raster: Object.freeze({
    format: "png",
    colorSpace: "sRGB"
  }),
  videoAsset: Object.freeze({
    codec: "h264",
    ffmpegCodec: "libx264",
    pixelFormat: "yuv420p",
    container: "mp4",
    audio: false,
    backgroundColor: "#000000"
  }),
  finalOutput: Object.freeze({
    container: "mp4",
    video: Object.freeze({
      codec: "h264",
      pixelFormat: "yuv420p",
      colorRange: "tv",
      colorSpace: "bt709",
      colorTransfer: "bt709",
      colorPrimaries: "bt709",
      crf: 18,
      preset: "medium"
    }),
    audio: Object.freeze({
      codec: "aac",
      bitrate: "192k",
      sampleRate: 48000,
      channels: 2
    })
  }),
  safeMarginX: 96,
  safeMarginY: 64,
  subtitle: Object.freeze({
    fontSize: 54,
    fontWeight: 500,
    lineHeight: 1.22,
    bilingualEnglishFontSize: 34,
    bilingualEnglishLineHeight: 1.18,
    outline: 4,
    englishOutline: 3,
    shadowOffsetY: 2,
    shadowBlur: 4,
    englishShadowOffsetY: 1,
    englishShadowBlur: 2,
    safeAreaHeight: 260,
    containerInsetX: 96,
    bilingualGap: 8,
    marginV: 64,
    bilingualChineseMarginV: 82,
    bilingualEnglishMarginV: 44,
    bilingualEnglishLongMarginV: 32
  })
});

export const frameForMs = ({ milliseconds, fps = VIDEO_SPEC.fps }) => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error("毫秒转帧必须使用非负毫秒和正帧率");
  }
  return Math.round(milliseconds / 1000 * fps);
};

export const durationFramesForMs = ({ milliseconds, fps = VIDEO_SPEC.fps }) => Math.max(
  1,
  frameForMs({ milliseconds, fps })
);

export const frameSpanForMs = ({ startMs, endMs, fps = VIDEO_SPEC.fps }) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("帧区间必须使用递增的非负毫秒边界");
  }
  return Math.max(
    1,
    frameForMs({ milliseconds: endMs, fps }) - frameForMs({ milliseconds: startMs, fps })
  );
};

export const anchoredFrameForMs = ({ milliseconds, anchorMs = 0, fps = VIDEO_SPEC.fps }) => {
  if (!Number.isFinite(anchorMs) || anchorMs < 0) throw new Error("帧时间轴锚点必须是非负毫秒");
  if (milliseconds <= anchorMs) return frameForMs({ milliseconds, fps });
  return frameForMs({ milliseconds: anchorMs, fps })
    + frameForMs({ milliseconds: milliseconds - anchorMs, fps });
};

export const anchoredFrameSpanForMs = ({ startMs, endMs, anchorMs = 0, fps = VIDEO_SPEC.fps }) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("锚定帧区间必须使用递增的非负毫秒边界");
  }
  return Math.max(
    1,
    anchoredFrameForMs({ milliseconds: endMs, anchorMs, fps })
      - anchoredFrameForMs({ milliseconds: startMs, anchorMs, fps })
  );
};

const fpsOf = (video) => {
  const [numerator, denominator] = String(video?.r_frame_rate ?? "").split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return Number.NaN;
  return numerator / denominator;
};

export const validateFinalMedia = ({ inspected, renderPlan }) => {
  const { width, height, fps, finalOutput } = VIDEO_SPEC;
  if (renderPlan.width !== width || renderPlan.height !== height || renderPlan.fps !== fps) {
    throw new Error(`Render Plan 必须使用 ${width}×${height}、${fps}fps`);
  }
  const video = inspected.streams?.find((stream) => stream.codec_type === "video");
  const audio = inspected.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("最终成片缺少视频流或音频流");
  const actualFps = fpsOf(video);
  if (
    video.codec_name !== finalOutput.video.codec
    || video.width !== width
    || video.height !== height
    || actualFps !== fps
    || video.pix_fmt !== finalOutput.video.pixelFormat
  ) {
    throw new Error("最终成片视频技术合同失败");
  }
  if (
    video.color_range !== finalOutput.video.colorRange
    || video.color_space !== finalOutput.video.colorSpace
    || video.color_transfer !== finalOutput.video.colorTransfer
    || video.color_primaries !== finalOutput.video.colorPrimaries
  ) {
    throw new Error("最终成片色彩技术合同失败");
  }
  if (
    audio.codec_name !== finalOutput.audio.codec
    || Number(audio.sample_rate) !== finalOutput.audio.sampleRate
    || Number(audio.channels) !== finalOutput.audio.channels
  ) {
    throw new Error(`最终成片音频必须为 ${finalOutput.audio.codec} ${finalOutput.audio.sampleRate}Hz ${finalOutput.audio.channels}声道`);
  }
  const durationMs = Math.round(Number(inspected.format?.duration) * 1000);
  const toleranceMs = Math.ceil(1000 / fps);
  if (!Number.isFinite(durationMs) || Math.abs(durationMs - renderPlan.durationMs) > toleranceMs) {
    throw new Error(`最终成片时长偏差超过一帧: plan=${renderPlan.durationMs}ms actual=${durationMs}ms`);
  }
  return { video, audio, fps: actualFps, durationMs };
};
