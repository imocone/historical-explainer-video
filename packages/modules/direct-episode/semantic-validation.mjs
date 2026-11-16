const RESULT_KEYS = new Set(["understanding"]);
const UNDERSTANDING_KEYS = new Set([
  "episodeQuestion",
  "thesis",
  "narrativeArc",
  "semanticReading",
  "facts",
  "relations",
  "evidence",
  "uncertainties",
  "mustNotInvent"
]);
const NARRATIVE_ARC_KEYS = new Set(["start", "turn", "end"]);
const SEMANTIC_KEYS = new Set([
  "underlyingMeaning",
  "audienceStartingPoint",
  "targetUnderstanding",
  "speakerStances",
  "contextConstraints",
  "rhetoricalReadings",
  "humanStakes"
]);
const FACT_KEYS = new Set(["id", "cueRefs", "claim", "evidenceRefs"]);
const RELATION_KEYS = new Set(["id", "cueRefs", "from", "relation", "to", "evidenceRefs"]);
const EVIDENCE_KEYS = new Set(["id", "cueRefs", "source", "text", "sourceAssetRefs"]);
const SPEAKER_STANCE_KEYS = new Set(["cueRefs", "voice", "stance", "claimBoundary"]);
const CONTEXT_CONSTRAINT_KEYS = new Set(["cueRefs", "kind", "constraint"]);
const RHETORICAL_READING_KEYS = new Set([
  "cueRefs",
  "expression",
  "intendedMeaning",
  "evidenceRefs",
  "prohibitedLiteralization"
]);
const HUMAN_STAKE_KEYS = new Set([
  "cueRefs",
  "bearer",
  "pressure",
  "visibleConsequence",
  "evidenceRefs"
]);
const SPEAKER_VOICES = new Set(["narrator", "quoted-source", "reported-actor"]);
const CONSTRAINT_KINDS = new Set(["historical", "institutional", "cultural", "source"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const asArray = (value) => Array.isArray(value) ? value : [];
const normalizeNarration = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\p{White_Space}\p{Punctuation}]+/gu, "");

const checkExactKeys = ({ value, allowed, label, errors }) => {
  if (!isObject(value)) {
    errors.push(`${label}必须是对象`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}不得包含 ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}缺少字段 ${key}`);
  }
  return true;
};

const checkText = (value, label, errors) => {
  if (!hasText(value)) errors.push(`${label}必须是非空文本`);
};

const checkTextArray = (value, label, errors) => {
  if (!Array.isArray(value)) {
    errors.push(`${label}必须是数组`);
    return;
  }
  value.forEach((item, index) => checkText(item, `${label}[${index}]`, errors));
  if (new Set(value).size !== value.length) errors.push(`${label}不得重复`);
};

const checkCueRefs = ({ value, label, cueIds, errors }) => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label}必须是非空数组`);
    return;
  }
  const seen = new Set();
  for (const [index, cueRef] of value.entries()) {
    const key = String(cueRef);
    if (!Number.isInteger(cueRef) || cueRef < 1) errors.push(`${label}只能包含正整数cue ID`);
    if (seen.has(key)) errors.push(`${label}不得重复引用cue ${String(cueRef)}`);
    if (!cueIds.has(key)) errors.push(`${label}引用了不存在的cue ${String(cueRef)}`);
    if (index > 0 && cueRef <= value[index - 1]) errors.push(`${label}必须按正文严格升序排列`);
    seen.add(key);
  }
};

const checkEvidenceRefs = ({ value, label, evidenceIds, errors }) => {
  if (!Array.isArray(value)) {
    errors.push(`${label}必须是数组`);
    return;
  }
  const seen = new Set();
  for (const ref of value) {
    if (typeof ref !== "string" || !/^E[0-9]{3}$/u.test(ref)) {
      errors.push(`${label}含有格式非法的证据引用 ${String(ref)}`);
    } else if (!evidenceIds.has(ref)) {
      errors.push(`${label}引用了不存在的登记来源证据 ${ref}`);
    }
    if (seen.has(ref)) errors.push(`${label}不得重复引用 ${String(ref)}`);
    seen.add(ref);
  }
};

const checkIdCollection = ({ collection, label, pattern, errors }) => {
  if (!Array.isArray(collection)) {
    errors.push(`${label}必须是数组`);
    return new Set();
  }
  const ids = new Set();
  for (const [index, item] of collection.entries()) {
    if (!isObject(item)) continue;
    if (typeof item.id !== "string" || !pattern.test(item.id)) {
      errors.push(`${label}[${index}].id格式无效`);
      continue;
    }
    if (ids.has(item.id)) errors.push(`${label}存在重复id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
};

export function validate({ result, context } = {}) {
  const errors = [];
  if (!checkExactKeys({ value: result, allowed: RESULT_KEYS, label: "Understand候选", errors })) return errors;
  if (Object.hasOwn(result, "_producer")) errors.push("候选稿不得写 _producer");
  const understanding = result.understanding;
  if (!checkExactKeys({ value: understanding, allowed: UNDERSTANDING_KEYS, label: "understanding", errors })) {
    return errors;
  }
  if (Object.hasOwn(understanding, "_producer")) errors.push("候选 understanding 不得写 _producer");

  const cues = Array.isArray(context?.cues) ? context.cues : [];
  if (cues.length === 0) errors.push("Understanding工作单缺少正式cues");
  const cueIds = new Set(cues.map((cue) => String(cue?.id)));
  if (cueIds.size !== cues.length || cues.some((cue) => !Number.isInteger(cue?.id) || cue.id < 1)) {
    errors.push("Understanding工作单cues缺少唯一正整数id");
  }
  const cueText = new Map(cues.map((cue) => [String(cue?.id), cue?.text]));
  checkText(understanding.episodeQuestion, "episodeQuestion", errors);
  checkText(understanding.thesis, "thesis", errors);
  if (checkExactKeys({ value: understanding.narrativeArc, allowed: NARRATIVE_ARC_KEYS, label: "narrativeArc", errors })) {
    for (const key of NARRATIVE_ARC_KEYS) checkText(understanding.narrativeArc[key], `narrativeArc.${key}`, errors);
  }
  checkTextArray(understanding.uncertainties, "uncertainties", errors);
  checkTextArray(understanding.mustNotInvent, "mustNotInvent", errors);

  const evidenceIds = checkIdCollection({
    collection: understanding.evidence,
    label: "evidence",
    pattern: /^E[0-9]{3}$/u,
    errors
  });
  const sourceAssets = Array.isArray(context?.sourceAssets) ? context.sourceAssets : [];
  const sourceAssetIds = new Set(sourceAssets.map((item) => item?.id));
  for (const [index, evidence] of asArray(understanding.evidence).entries()) {
    const label = `evidence[${index}]`;
    if (!checkExactKeys({ value: evidence, allowed: EVIDENCE_KEYS, label, errors })) continue;
    checkCueRefs({ value: evidence.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
    if (evidence.source !== "registered-source") errors.push(`${label}.source必须是 registered-source`);
    checkText(evidence.text, `${label}.text`, errors);
    if (!Array.isArray(evidence.sourceAssetRefs) || evidence.sourceAssetRefs.length === 0) {
      errors.push(`${label}.sourceAssetRefs必须是非空数组`);
    } else {
      if (new Set(evidence.sourceAssetRefs).size !== evidence.sourceAssetRefs.length) {
        errors.push(`${label}.sourceAssetRefs不得重复`);
      }
      for (const ref of evidence.sourceAssetRefs) {
        if (typeof ref !== "string" || !/^SA[0-9]{3}$/u.test(ref)) {
          errors.push(`${label}.sourceAssetRefs含有格式非法的来源资产 ${String(ref)}`);
        } else if (!sourceAssetIds.has(ref)) {
          errors.push(`${label}引用了未登记来源资产 ${ref}`);
        }
      }
    }
  }

  checkIdCollection({ collection: understanding.facts, label: "facts", pattern: /^F[0-9]{3}$/u, errors });
  checkIdCollection({ collection: understanding.relations, label: "relations", pattern: /^R[0-9]{3}$/u, errors });
  for (const [collectionName, collection, allowed, textKeys] of [
    ["facts", understanding.facts, FACT_KEYS, ["claim"]],
    ["relations", understanding.relations, RELATION_KEYS, ["from", "relation", "to"]]
  ]) {
    for (const [index, item] of asArray(collection).entries()) {
      const label = `${collectionName}[${index}]`;
      if (!checkExactKeys({ value: item, allowed, label, errors })) continue;
      checkCueRefs({ value: item.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
      textKeys.forEach((key) => checkText(item[key], `${label}.${key}`, errors));
      checkEvidenceRefs({ value: item.evidenceRefs, label: `${label}.evidenceRefs`, evidenceIds, errors });
    }
  }

  const semantic = understanding.semanticReading;
  if (!checkExactKeys({ value: semantic, allowed: SEMANTIC_KEYS, label: "semanticReading", errors })) return errors;
  for (const key of ["underlyingMeaning", "audienceStartingPoint", "targetUnderstanding"]) {
    checkText(semantic[key], `semanticReading.${key}`, errors);
  }
  for (const key of ["speakerStances", "contextConstraints", "rhetoricalReadings", "humanStakes"]) {
    if (!Array.isArray(semantic[key])) errors.push(`semanticReading.${key}必须是数组`);
  }
  for (const [index, item] of asArray(semantic.speakerStances).entries()) {
    const label = `semanticReading.speakerStances[${index}]`;
    if (!checkExactKeys({ value: item, allowed: SPEAKER_STANCE_KEYS, label, errors })) continue;
    checkCueRefs({ value: item.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
    if (!SPEAKER_VOICES.has(item.voice)) errors.push(`${label}.voice无效`);
    checkText(item.stance, `${label}.stance`, errors);
    checkText(item.claimBoundary, `${label}.claimBoundary`, errors);
  }
  for (const [index, item] of asArray(semantic.contextConstraints).entries()) {
    const label = `semanticReading.contextConstraints[${index}]`;
    if (!checkExactKeys({ value: item, allowed: CONTEXT_CONSTRAINT_KEYS, label, errors })) continue;
    checkCueRefs({ value: item.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
    if (!CONSTRAINT_KINDS.has(item.kind)) errors.push(`${label}.kind无效`);
    checkText(item.constraint, `${label}.constraint`, errors);
  }
  for (const [index, item] of asArray(semantic.rhetoricalReadings).entries()) {
    const label = `semanticReading.rhetoricalReadings[${index}]`;
    if (!checkExactKeys({ value: item, allowed: RHETORICAL_READING_KEYS, label, errors })) continue;
    checkCueRefs({ value: item.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
    for (const key of ["expression", "intendedMeaning", "prohibitedLiteralization"]) {
      checkText(item[key], `${label}.${key}`, errors);
    }
    checkEvidenceRefs({ value: item.evidenceRefs, label: `${label}.evidenceRefs`, evidenceIds, errors });
    const sourceText = asArray(item.cueRefs).map((id) => cueText.get(String(id)) ?? "").join("");
    if (hasText(item.expression) && !normalizeNarration(sourceText).includes(normalizeNarration(item.expression))) {
      errors.push(`${label}.expression不在所引cue中`);
    }
  }
  for (const [index, item] of asArray(semantic.humanStakes).entries()) {
    const label = `semanticReading.humanStakes[${index}]`;
    if (!checkExactKeys({ value: item, allowed: HUMAN_STAKE_KEYS, label, errors })) continue;
    checkCueRefs({ value: item.cueRefs, label: `${label}.cueRefs`, cueIds, errors });
    for (const key of ["bearer", "pressure", "visibleConsequence"]) {
      checkText(item[key], `${label}.${key}`, errors);
    }
    checkEvidenceRefs({ value: item.evidenceRefs, label: `${label}.evidenceRefs`, evidenceIds, errors });
  }

  const evidenceById = new Map(asArray(understanding.evidence).map((item) => [item?.id, item]));
  const evidenceConsumers = [
    ...asArray(understanding.facts),
    ...asArray(understanding.relations),
    ...asArray(semantic.rhetoricalReadings),
    ...asArray(semantic.humanStakes)
  ];
  const consumedEvidence = new Set();
  for (const item of evidenceConsumers) {
    for (const evidenceRef of asArray(item?.evidenceRefs)) {
      const evidence = evidenceById.get(evidenceRef);
      if (evidence) consumedEvidence.add(evidenceRef);
      if (evidence && !asArray(item?.cueRefs).some((cueRef) => asArray(evidence.cueRefs).includes(cueRef))) {
        errors.push(`${item.id ?? "语义读法"}的登记来源证据 ${evidenceRef} 与cueRefs无交集`);
      }
    }
  }
  for (const evidenceId of evidenceIds) {
    if (!consumedEvidence.has(evidenceId)) errors.push(`登记来源证据 ${evidenceId} 没有下游语义消费者`);
  }
  return errors;
}

export async function validateAcceptance() {
  return [];
}
