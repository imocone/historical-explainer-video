import { OPPOSED_POLICY, openerTimelineForTreatment as defaultTimeline } from "../opposed-opener/render-policy.mjs";

// Keep the existing 18-frame kick, then give the revealed first body shot a
// short breath before its narration begins.
export const POST_EXIT_BREATH_FRAMES = 21;
export const GLASS_POLICY = Object.freeze({
  ...OPPOSED_POLICY,
  exitTransition:Object.freeze({...OPPOSED_POLICY.exitTransition,
    durationInFrames:OPPOSED_POLICY.exitTransition.durationInFrames+POST_EXIT_BREATH_FRAMES})
});

export const openerTimelineForTreatment = treatment => {
  const timeline = defaultTimeline(treatment);
  return {...timeline,durationFrames:timeline.durationFrames+POST_EXIT_BREATH_FRAMES};
};
