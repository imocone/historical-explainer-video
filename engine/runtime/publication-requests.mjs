import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hashObject, readData } from "../../packages/program-utils.mjs";
import { REVISION_REQUEST_ID, exists, filesUnder, relative } from "./files.mjs";
import { businessContent } from "./storyboard.mjs";
const PUBLICATION_REVISION_SCOPE = "publication-copy";

const PUBLICATION_ALL_REVISION_SCOPE = "publication-all";

const COVER_CONTENT_REVISION_SCOPE = "cover-content";

const COVER_VISUAL_REGENERATION_SCOPE = "cover-visual";

const COVER_VARIANTS = new Set(["youtube", "vertical"]);
const PUBLICATION_FIELDS = new Set([
  "youtube.title", "youtube.description", "youtube.tags",
  "douyin.title", "douyin.body", "douyin.topics",
  "xiaohongshu.title", "xiaohongshu.body", "xiaohongshu.topics",
  "covers.youtube.visibleText", "covers.vertical.visibleText"
]);

const TERMINAL_COVER_GENERATION_STATES = new Set([
  "completed",
  "superseded",
  "local-rejected"
]);

const assertPublicationRevisionRequest = (request) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("P1文案返工控制记录必须是对象");
  }
  if (
    !["author-narration", "author-documentary-narration"].includes(request.target) ||
    !new Set([PUBLICATION_REVISION_SCOPE, COVER_CONTENT_REVISION_SCOPE, PUBLICATION_ALL_REVISION_SCOPE]).has(request.revisionScope)
  ) {
    throw new Error("P1返工控制记录必须唯一指向P1作者的已支持范围");
  }
  if (typeof request.reason !== "string" || !request.reason.trim()) {
    throw new Error("P1文案返工控制记录缺少 reason");
  }
  if (request.publicationFields != null && (
    request.revisionScope !== PUBLICATION_REVISION_SCOPE
    || !Array.isArray(request.publicationFields) || !request.publicationFields.length
    || new Set(request.publicationFields).size !== request.publicationFields.length
    || request.publicationFields.some((field) => !PUBLICATION_FIELDS.has(field))
    || !request.baselinePlatforms || typeof request.baselinePlatforms !== "object"
    || Array.isArray(request.baselinePlatforms)
  )) {
    throw new Error("P1定点文案修改缺少合法字段范围或当前平台文案基线");
  }
  if (!Array.isArray(request.cueRefs) || request.cueRefs.length !== 0) {
    throw new Error("P1文案返工不得指定字幕范围");
  }
  for (const variant of COVER_VARIANTS) {
    if (request.baselineCoverImages && request.publicationFields?.includes(`covers.${variant}.visibleText`)
      && (typeof request.baselineCoverImages?.[variant]?.path !== "string"
        || !request.baselineCoverImages[variant].path.trim()
        || !/^[a-f0-9]{64}$/u.test(request.baselineCoverImages?.[variant]?.sha256 ?? ""))) {
      throw new Error(`P1封面换字缺少${variant}当前成图来源`);
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(request.baselinePublicationSha256 ?? "")) {
    throw new Error("P1文案返工缺少合法的原正式文案摘要");
  }
  if (
    request.revisionScope === PUBLICATION_REVISION_SCOPE &&
    (!request.baselineCovers ||
      typeof request.baselineCovers !== "object" ||
      Array.isArray(request.baselineCovers))
  ) {
    throw new Error("P1文案返工缺少用户已接受的封面内容合同");
  }
  if (
    request.revisionScope === COVER_CONTENT_REVISION_SCOPE &&
    (!request.baselinePlatforms ||
      typeof request.baselinePlatforms !== "object" ||
      Array.isArray(request.baselinePlatforms))
  ) {
    throw new Error("P1封面内容返工缺少已接受的平台文案");
  }
  return request;
};

const assertCoverRegenerationRequest = (request) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("P1封面定点重生控制记录必须是对象");
  }
  if (
    request.target !== "produce-covers" ||
    request.revisionScope !== COVER_VISUAL_REGENERATION_SCOPE
  ) {
    throw new Error("P1封面定点重生必须唯一指向 produce-covers");
  }
  if (!REVISION_REQUEST_ID.test(request.regenerationRequestId ?? "")) {
    throw new Error("P1封面定点重生缺少请求身份");
  }
  if (typeof request.reason !== "string" || !request.reason.trim()) {
    throw new Error("P1封面定点重生缺少本次修订意见");
  }
  if (
    !Array.isArray(request.variants) ||
    request.variants.length < 1 ||
    request.variants.length > 2 ||
    new Set(request.variants).size !== request.variants.length ||
    request.variants.some((variant) => !COVER_VARIANTS.has(variant))
  ) {
    throw new Error("P1封面定点重生必须选择 youtube、vertical 中的一至两项");
  }
  if (
    !/^[a-f0-9]{64}$/u.test(request.baselinePublicationSha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(request.baselineCoverReceiptSha256 ?? "")
  ) {
    throw new Error("P1封面定点重生缺少正式发布包与封面回执基线");
  }
  return request;
};

const sealedPublicationBusinessForRevision = async ({ paths, request = null }) => {
  if (!(await exists(paths.publicationDocument))) {
    throw new Error("--revise-publication 只用于现行P1文案");
  }
  const artifact = await readData(paths.publicationDocument);
  const business = businessContent(artifact);
  if (
    !["author-narration", "author-documentary-narration"].includes(artifact?._producer?.moduleId) ||
    artifact?._producer?.nodeId !== artifact?._producer?.moduleId ||
    artifact?._producer?.outputSha256 !== hashObject(business) ||
    business?.episodeId == null ||
    business?.targetId !== "release-main"
  ) {
    throw new Error("当前 publication.yaml 不是可返工的正式P1作者成果");
  }
  const digest = hashObject(business);
  if (request && request.baselinePublicationSha256 !== digest) {
    throw new Error("P1文案返工期间原正式文案已经变化，不能继续旧工作单");
  }
  if (
    request?.revisionScope === PUBLICATION_REVISION_SCOPE &&
    !isDeepStrictEqual(request.baselineCovers, business.covers)
  ) {
    throw new Error("P1文案返工期间用户已接受的封面内容合同已经变化");
  }
  if (
    (request?.revisionScope === COVER_CONTENT_REVISION_SCOPE || request?.publicationFields) &&
    !isDeepStrictEqual(request.baselinePlatforms, business.platforms)
  ) {
    throw new Error("P1返工期间已接受的平台文案已经变化");
  }
  return { artifact, business, digest };
};

const assertPublicationRevisionHasNoRemoteActivity = async (paths, { allowUnresolvedCover = false, allowEditingCopy = false, platforms = null } = {}) => {
  const selectedPlatforms = allowEditingCopy ? platforms : null;
  const receiptFiles = (await filesUnder(paths.receipts)).filter((file) =>
    !selectedPlatforms || selectedPlatforms.includes(path.basename(file, ".yaml")));
  if (receiptFiles.length > 0) {
    throw new Error("本次修订涉及的平台已有P4发布回执，不能改写为另一份发布文案");
  }
  const intentRoot = path.join(paths.release, "_work", "intents");
  for (const file of await filesUnder(intentRoot)) {
    if (selectedPlatforms && !selectedPlatforms.includes(path.relative(intentRoot, file).split(path.sep)[0])) continue;
    const intent = businessContent(await readData(file));
    if (intent.status !== "not-created"
      && !(allowEditingCopy && intent.state === "editing" && !("submittedAt" in intent))) {
      throw new Error("本次修订涉及的平台已有P4发布意图或未知远端结果，不能返工文案");
    }
  }
  const coverWork = path.join(paths.workRoot, "_work", "covers");
  for (const file of (await filesUnder(coverWork)).filter(
    (item) => path.basename(item) === "generation.json"
  )) {
    const generation = await readData(file);
    if (!allowUnresolvedCover && ['imagegen','openai-images'].includes(generation.provider)
      && !TERMINAL_COVER_GENERATION_STATES.has(generation.status)) {
      throw new Error(`P1仍有未收口封面生图调用，不能返工文案: ${relative(paths.workRoot, file)}`);
    }
  }
};

export {
  COVER_CONTENT_REVISION_SCOPE,
  COVER_VARIANTS,
  COVER_VISUAL_REGENERATION_SCOPE,
  PUBLICATION_ALL_REVISION_SCOPE,
  PUBLICATION_REVISION_SCOPE,
  PUBLICATION_FIELDS,
  assertCoverRegenerationRequest,
  assertPublicationRevisionHasNoRemoteActivity,
  assertPublicationRevisionRequest,
  sealedPublicationBusinessForRevision
};
