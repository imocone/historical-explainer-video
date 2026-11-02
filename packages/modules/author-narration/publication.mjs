import { isDeepStrictEqual } from "node:util";
import { chapterPositionsFor } from "./youtube-description.mjs";

// Chapters are the author's navigation for the description, not a separate revision scope.
const selectedField = (request, platform, field) => request.publicationFields?.includes(`${platform}.${field}`)
  || (platform === "youtube" && field === "chapters" && request.publicationFields?.includes("youtube.description"));

const coverTextEditFor = (result, request) => {
  const changed = Object.keys(request.baselineCoverImages ?? {}).filter((variant) =>
    request.publicationFields?.includes(`covers.${variant}.visibleText`)
    && !isDeepStrictEqual(result.covers?.[variant]?.visibleText, request.baselineCovers[variant].visibleText));
  return changed.length ? {
    baselinePublicationSha256: request.baselinePublicationSha256,
    sources: Object.fromEntries(changed.map((variant) => [variant, request.baselineCoverImages?.[variant]?.sha256]))
  } : null;
};

// Fill only locked values. Authored fields and supplied mismatches still face the original contract.
export function completeCandidate({ result, context = {} }) {
  for (const [field, value] of Object.entries({
    schemaVersion: "7.0", episodeId: context.episodeId, targetId: context.targetId
  })) {
    if (!Object.hasOwn(result, field) && value !== undefined) result[field] = value;
  }
  const request = context.returnRequest;
  if (request?.revisionScope === "publication-copy") {
    if (!Object.hasOwn(result, "covers")) result.covers = {};
    if (result.covers && typeof result.covers === "object" && !Array.isArray(result.covers)) {
      for (const [variant, baseline] of Object.entries(request.baselineCovers)) {
        if (!Object.hasOwn(result.covers, variant)) result.covers[variant] = {};
        const cover = result.covers[variant];
        if (!cover || typeof cover !== "object" || Array.isArray(cover)) continue;
        for (const [field, value] of Object.entries(baseline)) {
          if (!request.publicationFields?.includes(`covers.${variant}.${field}`) && !Object.hasOwn(cover, field)) {
            cover[field] = structuredClone(value);
          }
        }
      }
    }
    const coverTextEdit = coverTextEditFor(result, request);
    if (coverTextEdit) {
      if (!Object.hasOwn(result, "coverTextEdit")) result.coverTextEdit = coverTextEdit;
    } else if (request.baselineCoverImages && !Object.hasOwn(result, "coverReuse")) {
      result.coverReuse = { baselinePublicationSha256: request.baselinePublicationSha256 };
    }
    if (request.publicationFields) {
      if (!Object.hasOwn(result, "platforms")) result.platforms = {};
      if (result.platforms && typeof result.platforms === "object" && !Array.isArray(result.platforms)) {
        for (const [platform, baseline] of Object.entries(request.baselinePlatforms)) {
          if (!Object.hasOwn(result.platforms, platform)) result.platforms[platform] = {};
          const target = result.platforms[platform];
          if (!target || typeof target !== "object" || Array.isArray(target)) continue;
          for (const [field, value] of Object.entries(baseline)) {
            if ((field === "chapters" || !selectedField(request, platform, field)) && !Object.hasOwn(target, field)) {
              target[field] = structuredClone(value);
            }
          }
        }
      }
    }
  } else if (request?.revisionScope === "cover-content" && !Object.hasOwn(result, "platforms")) {
    result.platforms = structuredClone(request.baselinePlatforms);
  }
}

const trimmed = (value) => typeof value === "string" && value.trim() === value;
const normalizedUnique = (values = []) => (
  new Set(values.map((value) => value.trim().toLowerCase())).size === values.length
);
const youtubeTagCharacters = (values = []) => Array.from(
  values
    .map((value) => value.includes(" ") ? `"${value}"` : value)
    .join(",")
).length;
export function validate({ result, context = {} }) {
  const errors = [];
  const returnRequest = context.returnRequest ?? null;
  const brief = context.episodeBrief ?? {};
  const script = context.scriptPackage ?? {};
  const opener = context.openerNarration ?? {};
  if (context.episodeId && result.episodeId !== context.episodeId) {
    errors.push("publication episodeId 与发布包不一致");
  }
  if (context.targetId && result.targetId !== context.targetId) {
    errors.push("publication targetId 与发布包不一致");
  }
  if (script.episodeId && result.episodeId !== script.episodeId) {
    errors.push("publication episodeId 与正式口播不一致");
  }
  if (brief.episodeId && result.episodeId !== brief.episodeId) {
    errors.push("publication episodeId 与正式单集任务不一致");
  }
  if (typeof opener.openerNarration !== "string" || !opener.openerNarration.trim()) {
    errors.push("P1作者工作单缺少P1正式片头口播");
  }
  const textFields = [
    result.platforms?.youtube?.title,
    result.platforms?.youtube?.description,
    result.platforms?.douyin?.title,
    result.platforms?.douyin?.body,
    result.platforms?.xiaohongshu?.title,
    result.platforms?.xiaohongshu?.body,
    result.covers?.youtube?.posterConcept,
    result.covers?.youtube?.heroVisual,
    result.covers?.vertical?.posterConcept,
    result.covers?.vertical?.heroVisual
  ].filter((value) => typeof value === "string");
  if (textFields.some((value) => !trimmed(value))) errors.push("平台文案与封面描述不得包含首尾空白");
  const collections = [
    result.platforms?.youtube?.tags,
    result.platforms?.douyin?.topics,
    result.platforms?.xiaohongshu?.topics,
    result.covers?.youtube?.visibleText,
    result.covers?.vertical?.visibleText
  ].filter(Array.isArray);
  if (collections.some((values) => values.some((value) => !trimmed(value)))) {
    errors.push("标签、话题和封面可见文字不得包含首尾空白");
  }
  if (collections.some((values) => !normalizedUnique(values))) {
    errors.push("标签、话题和封面可见文字不得在归一化后重复");
  }
  const youtubeTags = result.platforms?.youtube?.tags;
  if (Array.isArray(youtubeTags) && youtubeTagCharacters(youtubeTags) > 500) {
    errors.push("YouTube 标签按逗号和含空格标签引号计数后不得超过500字符");
  }
  const title = result.platforms?.youtube?.title;
  if (typeof title === "string" && !title.replace(/#[^\s#]+/gu, "").trim()) {
    errors.push("YouTube须有标题文字，不能只有话题");
  }
  if (result.platforms?.youtube?.chapters?.length && typeof script.narration === "string") {
    try { chapterPositionsFor(result.platforms.youtube.chapters, script.narration); }
    catch (error) { errors.push(error.message); }
  }
  if (returnRequest?.revisionScope === "publication-copy") {
    for (const [variant, baseline] of Object.entries(returnRequest.baselineCovers)) {
      for (const [field, value] of Object.entries(baseline)) {
        if (!returnRequest.publicationFields?.includes(`covers.${variant}.${field}`)
          && !isDeepStrictEqual(result.covers?.[variant]?.[field], value)) {
          errors.push(`P1定点文案修改必须保留未选封面内容 covers.${variant}.${field}`);
        }
      }
    }
    const coverTextEdit = coverTextEditFor(result, returnRequest);
    if (coverTextEdit && (!isDeepStrictEqual(result.coverTextEdit, coverTextEdit) || result.coverReuse != null)) {
      errors.push("P1封面换字必须绑定当前成图，不得声明直接复用旧字成品");
    }
    if (!coverTextEdit && returnRequest.baselineCoverImages && (result.coverReuse?.baselinePublicationSha256 !== returnRequest.baselinePublicationSha256
      || result.coverTextEdit != null)) {
      errors.push("P1平台文案返工缺少当前已接受封面的正式复用绑定");
    }
    if (returnRequest.publicationFields) {
      for (const [platform, baseline] of Object.entries(returnRequest.baselinePlatforms)) {
        for (const [field, value] of Object.entries(baseline)) {
          const key = `${platform}.${field}`;
          if (!selectedField(returnRequest, platform, field)
            && !isDeepStrictEqual(result.platforms?.[platform]?.[field], value)) {
            errors.push(`P1定点文案修改必须保留未选字段 ${key}`);
          }
        }
      }
      if (!selectedField(returnRequest, "youtube", "chapters")
        && !isDeepStrictEqual(result.platforms?.youtube?.chapters, returnRequest.baselinePlatforms.youtube?.chapters)) {
        errors.push("P1定点文案修改必须保留未选YouTube简介的chapters");
      }
    }
  } else if (returnRequest?.revisionScope === "cover-content") {
    if (!isDeepStrictEqual(result.platforms, returnRequest.baselinePlatforms)) {
      errors.push("P1封面内容返工必须逐字段保留已接受的平台文案");
    }
    if (result.coverReuse != null) {
      errors.push("P1封面内容返工必须生产新封面，不得声明复用旧封面");
    }
    if (returnRequest.coverExampleAdoption) {
      for (const [variant, example] of Object.entries(returnRequest.coverExampleAdoption.variants ?? {})) {
        if (!isDeepStrictEqual(result.covers?.[variant]?.visibleText, example.visibleText)) {
          errors.push(`P1样图接纳必须让 covers.${variant}.visibleText 与所选成品样图一致`);
        }
      }
    }
  } else if (result.coverReuse != null) {
    errors.push("只有P1平台文案返工可以声明复用已接受封面");
  }
  if (result.coverTextEdit != null && returnRequest?.revisionScope !== "publication-copy") {
    errors.push("只有定点封面文字修改可以绑定现图换字");
  }
  return errors;
}
