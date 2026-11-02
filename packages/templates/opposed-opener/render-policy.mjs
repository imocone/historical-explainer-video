import { VIDEO_SPEC, frameForMs } from "../../video-spec.mjs";

export const OPPOSED_POLICY = Object.freeze({
  narrationStartMs: 0,
  approachLeadMs: 0,
  finalApproachLeadMs: 350,
  maximumFinalApproachLeadMs: 600,
  minimumPauseBeforeFinalMs: 200,
  targetPauseBeforeFinalMs: 500,
  holdAfterLastMs: 1000,
  finalHoldExtraMs: 250,
  arrivalFrames: 16,
  preloadFrames: 12,
  exitFrames: 18,
  exitTransition: Object.freeze({type:"dissolve", durationInFrames:18})
});

export const openerTimelineForTreatment = (treatment) => {
  const shots = treatment?.flashbackShots ?? [];
  const narration = treatment?.narration;
  const cues = narration?.sentenceCues ?? [];
  if (!shots.length || cues.length !== shots.length || !Number.isInteger(narration?.durationMs) || narration.durationMs < 1)
    throw new Error("逐段片头缺少与各画面对应的真实配音卡点");
  let previousEnd = 0;
  const cuts = cues.map((cue, i) => {
    if (cue.target !== shots[i].id || !Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs)
      || cue.startMs < previousEnd || cue.endMs <= cue.startMs || cue.endMs > narration.durationMs + 100)
      throw new Error(`逐段片头第 ${i + 1} 段卡点无效`);
    const priorEnd = previousEnd;
    previousEnd = cue.endMs;
    const final = i === cues.length - 1;
    // Keep a breath after the previous line and use the remaining pause for the last shot.
    const gapMs = cue.startMs - priorEnd;
    const breathMs = final ? Math.min(gapMs, OPPOSED_POLICY.minimumPauseBeforeFinalMs) : 0;
    const leadMs = final ? OPPOSED_POLICY.finalApproachLeadMs : OPPOSED_POLICY.approachLeadMs;
    const preferredMs = final ? Math.min(cue.startMs - leadMs,
      priorEnd + OPPOSED_POLICY.targetPauseBeforeFinalMs) : cue.startMs - leadMs;
    const leadLimitMs = final ? cue.startMs - OPPOSED_POLICY.maximumFinalApproachLeadMs : 0;
    const startMs = i === 0 ? 0 : Math.max(priorEnd + breathMs, preferredMs, leadLimitMs);
    return frameForMs({milliseconds:startMs});
  });
  // Compare the final charge with every earlier breath, not just the one
  // immediately before it: the last beat must read differently in A-A-B.
  const longestPriorPauseMs = cuts.slice(1).reduce((longest, cut, i) =>
    Math.max(longest, cut / VIDEO_SPEC.fps * 1000 - cues[i].endMs), 0);
  const finalHoldMs = Math.max(OPPOSED_POLICY.holdAfterLastMs,
    longestPriorPauseMs + OPPOSED_POLICY.finalHoldExtraMs);
  const releaseFrame = Math.max(
    frameForMs({milliseconds:previousEnd + finalHoldMs}),
    frameForMs({milliseconds:narration.durationMs})
  );
  const durationFrames = releaseFrame + OPPOSED_POLICY.exitFrames;
  return { cuts, releaseFrame, durationFrames, exitFrames: OPPOSED_POLICY.exitFrames, fps: VIDEO_SPEC.fps };
};

export const opposedNarrationShareForTreatment = treatment => {
  if (!treatment?.narration?.durationMs) return null;
  return treatment.narration.durationMs / (openerTimelineForTreatment(treatment).durationFrames / VIDEO_SPEC.fps * 1000);
};
