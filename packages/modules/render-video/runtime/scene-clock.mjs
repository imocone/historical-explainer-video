export const sceneSourceWindow = (scene, timeline) => {
  const startFrame = Math.max(timeline.fromFrame, scene.fromFrame);
  const endFrame = Math.min(timeline.toFrame, scene.endFrame);
  return { startFrame, endFrame, sampleFrame: startFrame - scene.fromFrame + (scene.sampleOffset ?? 0) };
};

// HY supplies local source time after native trim, rate and automation handling.
export const sourceFrameAtTime = (time, fps, firstFrame = 0) => firstFrame + Math.round(time * fps);

export const sceneFrameAtTime = (scene, window, time, fps) =>
  Math.min(sourceFrameAtTime(time, fps, window.sampleFrame), scene.freezeAt ?? Infinity);

export const hasAuthoredWindow = (attributes, window, timeline, fps) => {
  const nonnegative = value => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const offset = nonnegative(attributes.playbackStart) ?? nonnegative(attributes.mediaStart) ?? 0;
  const rate = Number.parseFloat(attributes.playbackRate);
  const duration = Number(attributes.duration);
  const equal = (value, expected) => Math.abs(Number(value) - expected) < 1e-7;
  return equal(attributes.start, (window.startFrame - timeline.fromFrame) / fps)
    && equal(Number.isFinite(duration) && duration > 0 ? duration : attributes.hfAuthoredDuration,
      (window.endFrame - window.startFrame) / fps)
    && offset === 0 && (!Number.isFinite(rate) || rate <= 0 || rate === 1) && !attributes.automation;
};
