import { hashObject } from "../../packages/program-utils.mjs";
import { collectQuoteRequests } from "../../packages/templates/fullframe-narrative/callout/batch.mjs";
import { businessContent } from "./storyboard.mjs";

export const P3_QUOTE_REVISION_SCOPE = "historical-quotes";

export const assertP3QuoteRevisionRequest = (request, storyboard = null) => {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || request.target !== "author" || request.revisionScope !== P3_QUOTE_REVISION_SCOPE
    || typeof request.reason !== "string" || !request.reason.trim()
    || !Array.isArray(request.cueRefs) || request.cueRefs.length !== 0
    || !Array.isArray(request.selectedBeatIds) || request.selectedBeatIds.length < 1
    || new Set(request.selectedBeatIds).size !== request.selectedBeatIds.length
    || request.selectedBeatIds.some((id) => typeof id !== "string" || !id.trim())
    || !/^[a-f0-9]{64}$/u.test(request.baselineAuthorQuotesSha256 ?? "")) {
    throw new Error("P3引文定点重作请求无效");
  }
  if (storyboard) {
    const requests = new Set(collectQuoteRequests(storyboard).map(({ id }) => id));
    const decisions = new Set((storyboard.authorQuotes?.items ?? []).map(({ id }) => id));
    const unknown = request.selectedBeatIds.filter((id) => !requests.has(id) || !decisions.has(id));
    if (unknown.length) throw new Error(`P3引文定点重作选择了没有已接纳引文位置的Beat: ${unknown.join(", ")}`);
    if (request.baselineAuthorQuotesSha256 !== hashObject(businessContent(storyboard.authorQuotes))) {
      throw new Error("P3引文定点重作期间原引文决议已经变化");
    }
  }
  return request;
};

