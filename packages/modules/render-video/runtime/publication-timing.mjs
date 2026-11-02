import { hashObject } from "../../../program-utils.mjs";

// Keep the exact final clock before the temporary render plan is removed.
export const publicationTimingFor = renderPlan => ({
  captions: renderPlan.captions.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }))
});

// Restore a missing projection only from the exact plan and media already delivered.
export function restoreTimingReceipt({ receipt, renderPlan, videoSha256 }) {
  const { _producer, ...business } = receipt;
  if (receipt.episodeId !== renderPlan.episodeId
    || receipt.renderDigest !== renderPlan.renderDigest
    || receipt.renderPlanSha256 !== hashObject(renderPlan)
    || receipt.sha256 !== videoSha256
    || !_producer || _producer.outputSha256 !== hashObject(business)) {
    throw new Error("章节计时恢复要求原渲染计划、成片和回执完全同源；保留原交付");
  }
  const timing = publicationTimingFor(renderPlan);
  if (receipt.publicationTiming && hashObject(receipt.publicationTiming) !== hashObject(timing)) {
    throw new Error("原回执已有不同的章节计时；保留原交付，不覆盖");
  }
  const restored = { ...business, publicationTiming: timing };
  return { ...restored, _producer: { ..._producer, outputSha256: hashObject(restored) } };
}
