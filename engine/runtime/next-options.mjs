import { COVER_VARIANTS, PUBLICATION_FIELDS } from "./publication-requests.mjs";
import { requireStageId } from "./status.mjs";
const validateNextOptions = async ({
  stageId,
  segmentId = null,
  claim = null,
  reviseProgram,
  reviseOpener,
  openerText,
  reviseNarration,
  reviseSubtitles,
  replaceNarrationRevision,
  rerunNarration,
  replaceFullRerun,
  redesignBody,
  reviseQuotes,
  reviseDirector,
  replaceBodyRedesign,
  cancelDirectorRevision,
  redesignBeatIds,
  revisePublication,
  reviseVideo,
  reviseCover,
  revisionReason = null,
  publicationFields = [],
  regenerateCover,
  replaceCoverTask = false,
  coverRecord = null,
  cancelCoverRegeneration,
  adoptCoverExamples,
  adoptCoverImages = null,
  coverVariants,
  authorizePaidTts,
}) => {
  requireStageId(stageId, "next");
  if (claim !== null && (stageId !== "p3" || !["fullframe", "explainer"].includes(claim)
    || segmentId || redesignBody || reviseDirector || reviseQuotes || cancelDirectorRevision))
    throw new Error("--claim 只用于P3领取 fullframe 或 explainer，不同时指定段或发起修订");
  if (replaceCoverTask && (stageId !== "p1" || !/^[a-f0-9]{64}$/u.test(coverRecord ?? "")
    || coverVariants?.length !== 1 || !COVER_VARIANTS.has(coverVariants[0])
    || regenerateCover || reviseCover || revisePublication || reviseVideo || adoptCoverExamples || adoptCoverImages
    || cancelCoverRegeneration || revisionReason !== null)) {
    throw new Error("封面替换只用于P1，须点名一个--cover-variant和--cover-record，不同时返工");
  }
  if (coverRecord !== null && !replaceCoverTask) throw new Error("--cover-record只用于替换自带生图原记录");
  if (cancelCoverRegeneration && (stageId !== "p1" || reviseVideo || revisePublication || reviseCover
    || regenerateCover || authorizePaidTts
    || adoptCoverExamples || adoptCoverImages || cancelDirectorRevision || revisionReason !== null || publicationFields.length || coverVariants?.length)) {
    throw new Error("--cancel-cover-regeneration 只用于单独撤销P1封面重生，不同时修订或授权生产");
  }
  if (reviseSubtitles && stageId !== "p2") {
    throw new Error("--revise-subtitles 只能用于 next --stage p2");
  }
  if (reviseSubtitles && authorizePaidTts) {
    throw new Error("字幕返工保留当前配音，不能同时授权TTS");
  }
  if (reviseProgram && stageId !== "p0") {
    throw new Error("--revise-program 只能用于 next --stage p0");
  }
  if (authorizePaidTts && stageId !== "p2") {
    throw new Error("--authorize-paid-tts 只能用于 next --stage p2");
  }
  if (reviseOpener && stageId !== "p1") {
    throw new Error("--revise-opener 只能用于 next --stage p1");
  }
  if (openerText !== null && !reviseOpener && !reviseNarration) {
    throw new Error("--opener-text 只能与 --revise-opener 或 --revise-narration 同时使用");
  }
  if (openerText !== null && (typeof openerText !== "string" || !openerText.trim())) {
    throw new Error("--opener-text 必须提供非空片头原句");
  }
  if (reviseNarration && stageId !== "p1") {
    throw new Error("--revise-narration 只能用于 next --stage p1");
  }
  if (replaceNarrationRevision && !reviseNarration) {
    throw new Error("--replace-narration-revision 只能与 --revise-narration 同时使用");
  }
  if (rerunNarration && stageId !== "p1") {
    throw new Error("--rerun-narration 只能用于 next --stage p1");
  }
  if (replaceFullRerun && !rerunNarration) {
    throw new Error("--replace-full-rerun 只能与 --rerun-narration 同时使用");
  }
  if ([reviseOpener, reviseNarration, rerunNarration].filter(Boolean).length > 1) {
    throw new Error("P1三个返工入口不能同时使用");
  }
  if (redesignBody && stageId !== "p3") {
    throw new Error("--redesign-body 只能用于 next --stage p3");
  }
  if (reviseQuotes && stageId !== "p3") {
    throw new Error("--revise-quotes 只能用于 next --stage p3");
  }
  if ([redesignBody, reviseDirector, reviseQuotes].filter(Boolean).length > 1) {
    throw new Error("P3正文重作、导演局部修订与引文定点重作不能同时发起");
  }
  if (reviseDirector && stageId !== "p3") throw new Error("--revise-director 只能用于 next --stage p3");
  if (replaceBodyRedesign && !reviseDirector) throw new Error("--replace-body-redesign 只能与 --revise-director 同时使用");
  if (cancelDirectorRevision && (stageId !== "p3" || reviseDirector || redesignBody || revisionReason !== null
    || redesignBeatIds?.length)) throw new Error("--cancel-director-revision 只用于单独撤销现行P3导演局部修订，不同时指定其它修订参数");
  if (
    !Array.isArray(redesignBeatIds) ||
    redesignBeatIds.some((id) => typeof id !== "string" || !id.trim() || id.startsWith("--")) ||
    new Set(redesignBeatIds.map((id) => id.trim())).size !== redesignBeatIds.length
  ) {
    throw new Error("--beat 必须提供非空且不重复的 Beat ID");
  }
  redesignBeatIds = redesignBeatIds.map((id) => id.trim());
  if (redesignBeatIds.length && !redesignBody && !reviseDirector && !reviseQuotes) {
    throw new Error("--beat 只能用于 P3 --redesign-body、--revise-director 或 --revise-quotes");
  }
  if (reviseQuotes && !redesignBeatIds.length) {
    throw new Error("--revise-quotes 必须至少提供一个 --beat <Beat ID>");
  }
  if (reviseDirector && (!redesignBeatIds.length || !revisionReason?.trim())) {
    throw new Error("导演局部修订必须用 --beat 指定范围，并用 --revision-reason 交接具体修改意见");
  }
  if (revisePublication && stageId !== "p1") {
    throw new Error("--revise-publication 只能用于 next --stage p1");
  }
  if (reviseVideo && stageId !== "p4") {
    throw new Error("--revise-video 只能用于 next --stage p4");
  }
  if (reviseCover && stageId !== "p1") {
    throw new Error("--revise-cover 只能用于 next --stage p1");
  }
  if (regenerateCover && stageId !== "p1") {
    throw new Error("--regenerate-cover 只能用于 next --stage p1");
  }
  if (adoptCoverExamples && stageId !== "p1") {
    throw new Error("--adopt-cover-examples 只能用于 next --stage p1");
  }
  if (adoptCoverImages !== null && (stageId !== "p1" || typeof adoptCoverImages !== "string"
    || !adoptCoverImages.trim() || reviseOpener || reviseNarration || rerunNarration)) {
    throw new Error("--adopt-cover-images 只用于P1指定双图接纳，须提供JSON路径且不同时重作正文或片头");
  }
  if (!Array.isArray(coverVariants)) {
    throw new Error("--cover-variant 参数集合无效");
  }
  if (
    regenerateCover &&
    (coverVariants.length < 1 ||
      coverVariants.length > 2 ||
      new Set(coverVariants).size !== coverVariants.length ||
      coverVariants.some((variant) => !COVER_VARIANTS.has(variant)))
  ) {
    throw new Error(
      "--regenerate-cover 必须用 --cover-variant 选择 youtube、vertical 中的一至两项"
    );
  }
  if (!regenerateCover && !replaceCoverTask && coverVariants.length > 0) {
    throw new Error("--cover-variant 只用于封面定点重生或自带生图原记录替换");
  }
  if ([reviseVideo, revisePublication || reviseCover, regenerateCover, adoptCoverExamples, adoptCoverImages].filter(Boolean).length > 1) {
    throw new Error("视频设计、发布内容返工、封面成图重生与样图接纳不能同时发起");
  }
  if (revisionReason !== null && (typeof revisionReason !== "string" || !revisionReason.trim()
    || !(revisePublication || reviseCover || regenerateCover || adoptCoverExamples || adoptCoverImages || reviseDirector || redesignBody || reviseQuotes))) {
    throw new Error("--revision-reason 必须是本次导演修订、正文重作、发布内容返工或封面重生的非空意见");
  }
  if (!Array.isArray(publicationFields)
    || new Set(publicationFields).size !== publicationFields.length
    || publicationFields.some((field) => !PUBLICATION_FIELDS.has(field))) {
    throw new Error("--publication-field 必须是不重复的现行平台字段，如 youtube.title、douyin.body");
  }
  if (publicationFields.length && (!revisePublication || reviseCover || !revisionReason?.trim())) {
    throw new Error("--publication-field 只用于 --revise-publication，并须用 --revision-reason 交接本次修改意见");
  }
  if (adoptCoverExamples && (publicationFields.length || coverVariants.length)) {
    throw new Error("--adopt-cover-examples 直接使用当前横竖Cover登记样图，不再指定文案字段或画幅");
  }
  if (adoptCoverImages && (publicationFields.length || coverVariants.length)) {
    throw new Error("--adopt-cover-images 从同一JSON指定完整横竖双图，不再指定文案字段或画幅");
  }
  return { redesignBeatIds };
};

export { validateNextOptions };
