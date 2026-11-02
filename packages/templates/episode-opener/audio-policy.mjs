import { OPENER_AUDIO_ASSETS } from "./audio/sources.mjs";
import { openerStripChoreography, openerTimelineForTreatment } from "./render-policy.mjs";

const soundEffectTrack = ({ id, asset, startFrame, volume, endFrame, fadeOutFrames }) => ({
  id,
  kind: "sound-effect",
  segmentType: "opener",
  startFrame,
  endFrame: endFrame ?? startFrame + asset.durationFrames,
  file: asset.file,
  sha256: asset.sha256,
  volume,
  loop: false,
  ...(fadeOutFrames ? { fadeOutFrames } : {})
});

export const OPENER_BACKGROUND_MUSIC_POLICY = Object.freeze({
  startFrame: 0, fadeInFrames: 8, fadeOutFrames: 58, volume: 1
});

export const openerAudioTracksForTreatment = ({ treatment }) => {
  const timeline = openerTimelineForTreatment(treatment);
  const clock = openerStripChoreography(timeline);
  const inertiaStart = clock.enter + Math.min(23, Math.floor((clock.stop - clock.enter) * 0.22));
  const tracks = [
    soundEffectTrack({ id: "opener-opening-flash", asset: OPENER_AUDIO_ASSETS.openingFlash,
      startFrame: timeline.flashbackCuts[0], volume: 0.522 }),
    soundEffectTrack({ id: "opener-cut-one", asset: OPENER_AUDIO_ASSETS.cutOne,
      startFrame: timeline.flashbackCuts[1], volume: 0.558 }),
    soundEffectTrack({ id: "opener-cut-two", asset: OPENER_AUDIO_ASSETS.cutTwo,
      startFrame: timeline.flashbackCuts[2], volume: 0.594 }),
    soundEffectTrack({ id: "opener-strips-pass", asset: OPENER_AUDIO_ASSETS.stripsPass,
      startFrame: clock.enter, volume: 0.55 }),
    soundEffectTrack({ id: "opener-strips-inertia", asset: OPENER_AUDIO_ASSETS.stripsInertia,
      startFrame: inertiaStart, endFrame: Math.min(inertiaStart + OPENER_AUDIO_ASSETS.stripsInertia.durationFrames, clock.stop),
      fadeOutFrames: 6, volume: 2.8 }),
    soundEffectTrack({ id: "opener-brake-hit", asset: OPENER_AUDIO_ASSETS.stripsImpact,
      startFrame: clock.brake - 4, volume: 0.28 }),
    soundEffectTrack({ id: "opener-strips-impact", asset: OPENER_AUDIO_ASSETS.stripsImpact,
      startFrame: clock.stop - 5, volume: 0.62 }),
    soundEffectTrack({ id: "opener-exit-reveal", asset: OPENER_AUDIO_ASSETS.exitRevealExtended,
      startFrame: clock.release, volume: 0.68 }),
    { id: "opener-background-music", kind: "background-music", segmentType: "opener",
      startFrame: OPENER_BACKGROUND_MUSIC_POLICY.startFrame, endFrame: timeline.durationFrames,
      file: OPENER_AUDIO_ASSETS.backgroundBed.file, sha256: OPENER_AUDIO_ASSETS.backgroundBed.sha256,
      volume: OPENER_BACKGROUND_MUSIC_POLICY.volume, loop: false,
      fadeInFrames: OPENER_BACKGROUND_MUSIC_POLICY.fadeInFrames,
      fadeOutFrames: OPENER_BACKGROUND_MUSIC_POLICY.fadeOutFrames }
  ];
  if (OPENER_AUDIO_ASSETS.backgroundBed.durationFrames < timeline.durationFrames) {
    throw new Error("片头背景音乐母版短于实际片头时段");
  }
  for (const item of tracks) {
    if (item.startFrame < 0 || item.endFrame > timeline.durationFrames || item.endFrame <= item.startFrame) {
      throw new Error(`${item.id} 音效超出片头时段`);
    }
  }
  return tracks;
};
