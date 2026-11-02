import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { assertProjectPath, hashObject, readData, withoutProducer } from "../../../program-utils.mjs";
import { completeQuoteEvidence, validateQuoteEvidence } from "./validate.mjs";

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quoteSchemaPath = path.resolve(templateRoot, "../../../contracts/fullframe-treatment.schema.json");

export const collectQuoteRequests = (storyboard) => (storyboard.beats ?? []).flatMap((beat) => {
  if (beat.treatment?.templateId !== "fullframe-narrative"
    || beat.treatment.calloutGate?.["historical-quote"] !== "reserved") return [];
  return (beat.treatment.assetRequests ?? []).flatMap((request) =>
    (request.callouts ?? []).flatMap((callout, index) => {
      if (callout.kind !== "historical-quote" || typeof callout.request !== "string") return [];
      const target = `${request.requestId}.callout.${index}`;
      const bindings = storyboard.features?.["cue-sync"]?.bindings?.[beat.id]?.items ?? [];
      const binding = bindings.find((item) => item.target === target && item.action === "show-callout");
      if (!binding) throw new Error(`${beat.id}/${target} 预留引文缺少已接纳显示Cue`);
      return [{
        id: beat.id,
        beatId: beat.id,
        requestId: request.requestId,
        calloutIndex: index,
        request: callout.request,
        anchorFocus: callout.anchorFocus,
        cueRange: beat.cueRange,
        binding
      }];
    })
  );
});

const uniqueEvidence = (items) => [...new Map(items.map(item => [hashObject(item), item])).values()];

// Recutting changes display decisions, not the sources already accepted in this storyboard.
export const retainedQuoteEvidence = (storyboard) => {
  const quotes = storyboard.authorQuotes;
  const receipts = (quotes?.batches ?? (quotes ? [quotes] : [])).filter(batch =>
    batch._producer?.moduleId === "author-beat" && batch._producer.nodeId === "author"
    && batch._producer.outputSha256 === hashObject(withoutProducer(batch))
    && batch.receipt?.sourceType === "documentary-sources" && batch.receipt.outcome === "completed"
    && !batch.receipt.response?.error && !batch.receipt.items?.some(item => item.reason === "response-error")
  ).map(batch => batch.receipt);
  return receipts.length ? {
    sources: uniqueEvidence(receipts.flatMap(receipt => receipt.sources ?? [])),
    references: uniqueEvidence(receipts.flatMap(receipt => receipt.response?.references ?? []))
  } : null;
};

export const quoteBatchInputs = ({ notebookId, referenceVideos, narrationEvidence, retainedQuoteEvidence, quoteRequests, cues, quoteRevision = null }) => ({
  authorPhase: "quotes", ...(referenceVideos ? { referenceVideos } : {}), ...(notebookId ? { notebookId } : {}), quoteRequests,
  ...(narrationEvidence ? { narrationEvidence } : {}),
  ...(retainedQuoteEvidence ? { retainedQuoteEvidence } : {}),
  ...(quoteRevision ? { quoteRevision } : {}),
  cues: cues.filter((cue) => quoteRequests.some(({ cueRange }) =>
    cue.id >= cueRange[0] && cue.id <= cueRange[1]))
});

// Moving a cancelled display does not require another query. Its original acceptance stays intact.
export const resolveQuoteDecisions = (storyboard, { notebookId, cues = [] } = {}) => {
  const quotes = storyboard.authorQuotes;
  const batches = quotes?.batches ?? (quotes ? [quotes] : []);
  const resolved = new Map((quotes?.items ?? []).map((item) => [item.id, {
    item, batch: batches.find((batch) => batch.items.some((original) => hashObject(original) === hashObject(item)))
  }]));
  const pending = collectQuoteRequests(storyboard).filter(({ id }) => !resolved.has(id));
  if (!pending.length) return resolved;
  const reusable = batches.filter((batch) => {
    const receipt = batch.receipt;
    return receipt?.outcome === "completed" && receipt.notebookId === notebookId
      && !receipt.response?.error && !receipt.items?.some((item) => item.reason === "response-error")
      && Array.isArray(receipt.requests) && receipt.requests.length > 0
      && batch._producer?.moduleId === "author-beat" && batch._producer.nodeId === "author"
      && batch._producer?.outputSha256 === hashObject(withoutProducer(batch))
      && batch._producer.inputs?.includes(hashObject(quoteBatchInputs({ notebookId, quoteRequests: receipt.requests, cues })));
  });
  for (const request of pending) {
    // Retained evidence must not revive a superseded decision for the exact same input.
    const latest = new Map();
    for (const batch of reusable) {
      const grouped = new Map();
      for (const original of batch.receipt.requests.filter(original => original.request === request.request
        && original.cueRange[0] <= request.cueRange[0] && original.cueRange[1] >= request.cueRange[1])) {
        const key = hashObject({ request: original.request, cueRange: original.cueRange });
        grouped.set(key, [...(grouped.get(key) ?? []), { batch, item: batch.items.find(item => item.id === original.id) }]);
      }
      for (const [key, matches] of grouped) latest.set(key, matches);
    }
    const matches = [...latest.values()].flat();
    if (matches.length === 1 && matches[0].item?.quote === null) {
      resolved.set(request.id, { item: { id: request.id, quote: null }, batch: matches[0].batch });
    }
  }
  return resolved;
};

// Keep each real query and its accepted decisions together when closeouts are incremental.
export const mergeAcceptedQuotes = ({ previous, accepted }) => {
  const byId = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  for (const item of accepted.items) byId.set(item.id, item);
  const priorBatches = previous?.batches ?? (previous ? [previous] : []);
  const merged = structuredClone({
    ...accepted,
    _producer: { ...accepted._producer },
    items: [...byId.values()],
    ...(priorBatches.length ? { batches: [...priorBatches, accepted] } : {})
  });
  return merged;
};

export const validate = ({ result, context }) => {
  const expected = context.quoteRequests ?? [];
  const items = result.items ?? [];
  const errors = [];
  if (items.length !== expected.length || new Set(items.map((item) => item.id)).size !== items.length) {
    errors.push("引文收口必须逐项覆盖全部当前预留位置，不得遗漏、增加或重复");
  }
  const receipt = result.receipt;
  if (receipt?.outcome !== "completed") errors.push("引文取证尚未明确完成，不得收口");
  if (receipt?.response?.error || receipt?.items?.some((item) => item.reason === "response-error")) {
    errors.push("引文回执含服务错误，不能按无原文取消；保留并核对原查询");
  }
  if (receipt?.sourceType === "documentary-sources") {
    if (receipt.inputsSha256 !== hashObject(context)) errors.push("引文来源记录与当前工作单输入不一致");
  } else if (context.referenceVideos) {
    if (receipt?.sourceType !== "reference-program"
      || hashObject(receipt.referenceVideos ?? null) !== hashObject(context.referenceVideos)) {
      errors.push("引文证据与本集工作单的真实参考视频材料不一致");
    }
  } else if (receipt?.sourceType === "reference-program" || receipt?.notebookId !== context.notebookId) {
    errors.push("批量回执与当前NotebookLM不一致");
  }
  if (hashObject(receipt?.requests ?? null) !== hashObject(expected)) {
    errors.push("引文证据与当前预留引文请求不一致");
  }
  for (const item of items) {
    const request = expected.find((entry) => entry.id === item.id);
    if (!request) { errors.push(`未知引文位置: ${item.id}`); continue; }
    if (item.quote === null) continue;
    errors.push(...validateQuoteEvidence({
      receipt,
      quotes: [item.quote]
    }).map((error) => `${item.id}: ${error}`));
  }
  return errors;
};

export const validateStoredAcceptance = async ({ result, context }) => {
  const errors = validate({ result, context });
  const schema = await readData(quoteSchemaPath);
  const quoteDefinition = structuredClone(schema.$defs.historicalQuoteCallout);
  quoteDefinition.required = quoteDefinition.required.filter((field) => field !== "anchorFocus");
  delete quoteDefinition.properties.anchorFocus;
  const checkQuote = new Ajv2020({ allErrors: true, strict: false }).compile({
    $defs: schema.$defs, ...quoteDefinition
  });
  for (const item of result.items ?? []) {
    if (item.quote !== null && !checkQuote(item.quote)) {
      errors.push(`${item.id} 引文不满足原全画幅引文合同: ${JSON.stringify(checkQuote.errors)}`);
    }
  }
  return errors;
};

const readCurrentReceipt = async (services) => {
  const { inputs, taskDigest } = services.task;
  const readOptional = async (name) => {
    const file = path.resolve(services.workspaceRoot, services.task.scratchPath, name);
    await assertProjectPath({ root: services.workspaceRoot, file, label: "引文取证材料" });
    try { return await readData(file); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const query = await readOptional("historical-quote-query.json");
  if (query) {
    if (query.taskDigest !== taskDigest || query.notebookId !== inputs.notebookId
      || hashObject(query.requests) !== hashObject(inputs.quoteRequests)) {
      throw new Error("引文查询回执不属于当前工作单");
    }
    if (query.outcome !== "completed" || query.error || query.response?.error
      || query.items?.some((item) => item.reason === "response-error")) {
      throw new Error("原引文查询未完成或含服务错误；保留并恢复原查询，不得按无原文取消");
    }
  }
  const collected = await readOptional("historical-quote-sources.json");
  const documents = inputs.narrationEvidence?.documents ?? [];
  const references = (inputs.narrationEvidence?.queries ?? []).flatMap(item => item.references)
    .filter(item => item?.source_id && item.citation_number != null
      && typeof item.cited_text === "string" && item.cited_text.trim());
  const retainedSources = documents.map(({ source, title }) => ({ id: source, title }));
  const priorEvidence = inputs.retainedQuoteEvidence;
  if (!collected && !query && !retainedSources.length && !priorEvidence?.sources.length) throw new Error("请先取得史料原文，在当前scratch保存historical-quote-sources.json");
  const pages = collected?.sources ?? [];
  if (collected && !Array.isArray(collected.sources)) throw new Error("引文来源材料必须包含sources数组");
  for (const page of pages) {
    if (!page || typeof page.url !== "string" || !/^https?:\/\/\S+$/u.test(page.url)
      || typeof page.title !== "string" || !page.title.trim()
      || typeof page.text !== "string" || !page.text.trim()) {
      throw new Error("每份引文来源需保存实际打开的网址url、文献标题title和原始正文text");
    }
  }
  return {
    sourceType: "documentary-sources", taskDigest, inputsSha256: hashObject(inputs),
    outcome: "completed", requests: inputs.quoteRequests,
    ...(inputs.notebookId ? { notebookId: inputs.notebookId } : {}),
    sources: uniqueEvidence([...retainedSources, ...(priorEvidence?.sources ?? []), ...(query?.sources ?? []), ...pages.map(({ url, title }) => ({ id: url, title, url }))]),
    response: { references: uniqueEvidence([...(query?.response?.references ?? []), ...(priorEvidence?.references ?? []),
      ...documents.map(({ source, text }) => ({ source_id: source, cited_text: text })), ...references,
      ...pages.map(({ url, text }) => ({ source_id: url, cited_text: text }))]) },
    ...(query ? { notebookQuery: query } : {})
  };
};

export const completeCandidate = async ({ result, services }) => {
  const receipt = await readCurrentReceipt(services);
  if (Object.hasOwn(result, "receipt") && hashObject(result.receipt) !== hashObject(receipt)) {
    throw new Error("引文候选不得改写实际取得的来源记录");
  }
  result.receipt = receipt;
  completeQuoteEvidence({ receipt, quotes: (result.items ?? []).map((item) => item.quote).filter(Boolean) });
};

export const validateAcceptance = async ({ result, context, services }) => {
  const errors = await validateStoredAcceptance({ result, context });
  if (hashObject(await readCurrentReceipt(services)) !== hashObject(result.receipt)) {
    errors.push("引文候选必须绑定当前工作单实际取得的来源记录");
  }
  return errors;
};

// Read-only downstream view. Original body and cue-sync producers remain intact.
export const projectResolvedQuotes = (storyboard, context) => {
  const requests = collectQuoteRequests(storyboard);
  if (!requests.length) return storyboard;
  const resolutions = resolveQuoteDecisions(storyboard, context);
  const projected = structuredClone(storyboard);
  for (const request of requests) {
    const resolution = resolutions.get(request.id)?.item;
    if (!resolution || !Object.hasOwn(resolution, "quote")) throw new Error(`${request.id} 引文尚未收口`);
    const beat = projected.beats.find((entry) => entry.id === request.beatId);
    const asset = beat.treatment.assetRequests.find((entry) => entry.requestId === request.requestId);
    if (resolution.quote !== null) {
      asset.callouts[request.calloutIndex] = { ...structuredClone(resolution.quote), anchorFocus: request.anchorFocus };
      beat.treatment.calloutGate["historical-quote"] = "required";
    } else {
      if (request.calloutIndex !== asset.callouts.length - 1) throw new Error(`${request.id} 取消会改变其它框身份`);
      asset.callouts.splice(request.calloutIndex, 1);
      if (!asset.callouts.length) delete asset.callouts;
      beat.treatment.calloutGate["historical-quote"] = "deferred-no-source";
      const set = projected.features["cue-sync"].bindings[request.beatId];
      set.items = set.items.filter((item) => !(item.target === request.binding.target && item.action === "show-callout"));
    }
  }
  return projected;
};
