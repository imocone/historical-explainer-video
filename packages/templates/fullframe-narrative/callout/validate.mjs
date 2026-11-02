import { createHash } from "node:crypto";

const normalized = (value) => String(value ?? "").replace(/\s+/gu, "").trim();
const normalizedSourceText = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\p{White_Space}\p{Punctuation}]+/gu, "")
  .trim();
const continuousQuoteText = (value) => String(value ?? "")
  .normalize("NFC")
  .replace(/(?:\r\n?|\n)[ \t]*/gu, "")
  .trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const documentaryCitation = /^\s*[^《》]*《[^《》]+》[^《》]*\s*$/u;

const CALLOUT_GATE_VALUES = Object.freeze({
  "historical-quote": new Set(["reserved", "required", "not-triggered", "deferred-no-source"]),
  "person-intro": new Set(["required", "not-triggered"]),
  "term-gloss": new Set(["required", "not-triggered"])
});

const validateCalloutGateValues = (result) => {
  const errors = [];
  const gate = result?.calloutGate;
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    return ["解说框判断必须形成完整calloutGate对象"];
  }
  const extras = Object.keys(gate).filter((kind) => !Object.hasOwn(CALLOUT_GATE_VALUES, kind));
  if (extras.length) errors.push(`解说框判断包含未知类型: ${extras.join(", ")}`);
  for (const [kind, allowed] of Object.entries(CALLOUT_GATE_VALUES)) {
    if (!Object.hasOwn(gate, kind) || !allowed.has(gate[kind])) {
      errors.push(`解说框判断缺少合法${kind}结论`);
    }
  }
  return errors;
};

export const validateFullframeCallouts = ({ result }) => {
  const errors = [...validateCalloutGateValues(result)];
  const requests = result.assetRequests ?? [];
  const callouts = requests.flatMap((request) => (
    (request.callouts ?? []).map((callout) => ({ request, callout }))
  ));
  if (callouts.filter(({ callout }) => callout.kind === "historical-quote").length > 1) {
    errors.push("同一全画幅Beat最多使用一条文献引文");
  }
  for (const [kind, allowed] of Object.entries(CALLOUT_GATE_VALUES)) {
    const outcome = result.calloutGate?.[kind];
    if (!allowed.has(outcome)) continue;
    const count = callouts.filter(({ callout }) => callout.kind === kind).length;
    if (outcome === "reserved" && count !== 1) {
      errors.push("historical-quote待查询时必须有一个已预留的引文位置");
    }
    if (outcome === "required" && count === 0) {
      errors.push(`解说框判断为required但没有完成${kind}`);
    }
    if (outcome === "not-triggered" && count > 0) {
      errors.push(`解说框判断为not-triggered但实际存在${kind}`);
    }
    if (outcome === "deferred-no-source" && count > 0) {
      errors.push("historical-quote延期时不得存在实际引文框");
    }
  }
  const explainedTerms = callouts.flatMap(({ callout }) => (
    callout.kind === "term-gloss" ? [normalized(callout.term)] : []
  ));
  if (new Set(explainedTerms).size !== explainedTerms.length) {
    errors.push("同一全画幅Beat不得重复解释同一专名");
  }
  for (const { request, callout } of callouts) {
    if (callout.anchorFocus !== request.attentionPlan?.entryFocus
      && callout.anchorFocus !== request.attentionPlan?.landingFocus) {
      errors.push(`解说框锚点必须等于当前entryFocus或landingFocus: ${request.requestId}`);
    }
    if (callout.kind === "historical-quote") {
      if (result.calloutGate?.["historical-quote"] === "reserved") {
        if (typeof callout.request !== "string" || !callout.request.trim()
          || Object.hasOwn(callout, "text") || Object.hasOwn(callout, "citation")) {
          errors.push("待查询引文只能记录查询意图，不得写入尚未取得的原文或出处");
        }
        if (request.callouts.at(-1) !== callout) {
          errors.push("预留引文必须放在所属画面callouts末项，取消时不得移动其它框的身份");
        }
        continue;
      }
      if (Object.hasOwn(callout, "request")) errors.push("已完成引文不得保留未收口查询意图");
      if (!documentaryCitation.test(callout.citation ?? "")) {
        errors.push(`${request.requestId}文献出处须含《书名》，可附实际作者和篇卷`);
      }
    } else if (callout.kind !== "person-intro" && callout.kind !== "term-gloss") {
      errors.push(`${request.requestId}解说框类型无效`);
    }
  }
  return errors;
};

export const validateFullframeCalloutPreparation = ({ result }) => {
  const outcome = result.calloutGate?.["historical-quote"];
  return outcome === "not-triggered" || outcome === "reserved"
    ? []
    : ["正文引文必须先预留；引文或取消决议由全部正文后的Author批量收口接纳"];
};

// Local evidence retains its own identity; it is not a NotebookLM response.
const quoteEvidence = (receipt) => receipt?.sourceType === "reference-program"
  ? {
    sources: (receipt.referenceVideos ?? []).map(({ id, title }) => ({ id, title })),
    references: (receipt.referenceVideos ?? []).map(({ id, transcript }) => ({
      source_id: id, cited_text: transcript.text
    }))
  }
  : { sources: receipt?.sources ?? [], references: receipt?.response?.references };

const sourceMatchesCitation = (source, citation) => {
  const bookTitle = String(citation ?? "").match(/《([^》]+)》/u)?.[1];
  return bookTitle && normalizedSourceText(source.title).toLowerCase()
    .includes(normalizedSourceText(bookTitle).toLowerCase());
};

export const completeQuoteEvidence = ({ receipt, quotes }) => {
  const { sources, references } = quoteEvidence(receipt);
  for (const quote of quotes) {
    const candidates = sources.filter(item => item.id === quote.sourceId
      && (Object.hasOwn(quote, "sourceTitle") ? item.title === quote.sourceTitle : sourceMatchesCitation(item, quote.citation)));
    if (new Set(candidates.map(item => item.title)).size > 1) {
      throw new Error(`引文来源${quote.sourceId}包含多个文献标题，请用已有sourceTitle选定本次实际来源标题`);
    }
    const source = candidates[0];
    const sourceReferences = (references ?? []).filter((item) => (
      item.source_id === quote.sourceId && typeof item.cited_text === "string"
      && item.cited_text.trim()
    ));
    const reference = sourceReferences.find((item) => continuousQuoteText(quote.text)
      && continuousQuoteText(item.cited_text).includes(continuousQuoteText(quote.text)))
      ?? (new Set(sourceReferences.map((item) => sha256(item.cited_text))).size === 1 ? sourceReferences[0] : null);
    if (source && !Object.hasOwn(quote, "sourceTitle")) quote.sourceTitle = source.title;
    if (!reference && sourceReferences.length > 1 && !Object.hasOwn(quote, "citedTextSha256")) {
      throw new Error(`引文来源${quote.sourceId}包含多段原文，请按引文方法选定对应原文的citedTextSha256，不得默认使用第一段`);
    }
    if (reference && !Object.hasOwn(quote, "citedTextSha256")) quote.citedTextSha256 = sha256(reference.cited_text);
  }
};

// Source identity is mechanical; the Author verifies the meaning of the Chinese display text.
export const validateQuoteEvidence = ({ receipt, quotes }) => {
  const errors = [];
  const { sources, references } = quoteEvidence(receipt);
  if (!Array.isArray(references) || references.length === 0) {
    return [...errors, "引文证据没有可逐字核对的来源正文"];
  }
  for (const quote of quotes) {
    if (!documentaryCitation.test(quote.citation ?? "")) {
      errors.push("文献出处须含《书名》，可附实际作者和篇卷");
    }
    const source = sources.find((item) => item?.id === quote.sourceId && item.title === quote.sourceTitle);
    if (!source) {
      errors.push("文献原文的sourceId或sourceTitle与当前真实来源清单不一致");
      continue;
    }
    if (!sourceMatchesCitation(source, quote.citation)) {
      errors.push(`文献出处书名与真实来源标题不一致: ${quote.citation}`);
      continue;
    }
    const reference = references.find((item) => (
      item?.source_id === quote.sourceId
      && typeof item?.cited_text === "string"
      && sha256(item.cited_text) === quote.citedTextSha256
    ));
    if (!reference) {
      errors.push("文献原文的sourceId或citedTextSha256与实际来源正文不一致");
      continue;
    }
  }
  return errors;
};
