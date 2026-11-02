import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashObject } from "../../program-utils.mjs";
import {
  directorAuthorabilityErrors,
  inspectDirectorAuthorability
} from "./authorability.mjs";
import {
  validateDirectorAuthorabilityLock,
  validateDirectorBoundariesLock
} from "./step-locks.mjs";

const FULLFRAME_TEMPLATE_ID = "fullframe-narrative";
import { EXPLAINER_TEMPLATE_IDS, isExplainerTemplateId } from "../../explainer-template-selection.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const expectedId = (prefix, index) => `${prefix}${String(index + 1).padStart(3, "0")}`;
const cueKey = (value) => String(value);
const isPackageId = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
const isBeatId = (value) => typeof value === "string" && /^B[0-9]{3}$/u.test(value);

export const renumberDirectorResult = (result) => {
  const next = structuredClone(result);
  const changes = [];
  const renumber = (items, prefix) => {
    const mapping = new Map();
    for (const [index, item] of (items ?? []).entries()) {
      const from = item?.id;
      if (typeof from !== "string" || !new RegExp(`^${prefix}[0-9]{3}$`, "u").test(from)
        || mapping.has(from)) throw new Error(`${prefix} 编号缺失、无效或重复，不能确定引用归属`);
      const to = expectedId(prefix, index);
      mapping.set(from, to);
      if (from !== to) changes.push({ from, to });
      item.id = to;
    }
    return mapping;
  };
  const beatIds = renumber(next.beats, "B");
  const remap = (refs) => refs?.map((ref) => {
    if (!beatIds.has(ref)) throw new Error(`编号整理不能猜测不存在的 Beat 引用: ${ref}`);
    return beatIds.get(ref);
  });
  for (const element of next.albumPlan?.recurringElements ?? []) element.beatRefs = remap(element.beatRefs);
  for (const run of next.templateRuns ?? []) run.beatIds = remap(run.beatIds);
  renumber(next.albumPlan?.recurringElements, "RE");
  renumber(next.templateRuns, "TR");
  return { result: next, changes };
};

function checkKeys(value, allowed, label, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} 不得包含额外字段 ${key}`);
  }
}

function checkText(value, label, errors) {
  if (!hasText(value)) errors.push(`${label} 必须是非空文本`);
}

function checkUniqueArray(value, label, predicate, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} 必须是数组`);
    return [];
  }
  const seen = new Set();
  for (const item of value) {
    if (!predicate(item)) errors.push(`${label} 含有格式非法的引用 ${String(item)}`);
    if (seen.has(item)) errors.push(`${label} 不得重复引用 ${String(item)}`);
    seen.add(item);
  }
  return value;
}

function rejectForbidden(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbidden(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (["_producer", "treatment", "features", "opener"].includes(key)) {
      errors.push(`${path}.${key} 不属于 Visual Director 候选`);
    }
    rejectForbidden(child, `${path}.${key}`, errors);
  }
}

function cueIndexMap(cues, errors) {
  if (!Array.isArray(cues) || cues.length === 0) {
    errors.push("context.cues 必须是非空数组");
    return new Map();
  }
  const byId = new Map();
  for (const [index, cue] of cues.entries()) {
    if (!isObject(cue)) {
      errors.push(`context.cues[${index}] 必须是对象`);
      continue;
    }
    const key = cueKey(cue.id);
    if (key === "undefined" || key === "null") errors.push(`context.cues[${index}] 缺少 id`);
    else if (byId.has(key)) errors.push(`context.cues id 重复: ${String(cue.id)}`);
    else byId.set(key, index);
  }
  return byId;
}

function resolveBeatRange(beat, label, cues, cueIndexes, errors) {
  if (!Array.isArray(beat?.cueRange) || beat.cueRange.length !== 2) {
    errors.push(`${label}.cueRange 必须恰好包含首尾两个 cue ID`);
    return null;
  }
  const [first, last] = beat.cueRange;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < 1) {
    errors.push(`${label}.cueRange 只能包含正整数 cue ID`);
    return null;
  }
  const firstIndex = cueIndexes.get(cueKey(first));
  const lastIndex = cueIndexes.get(cueKey(last));
  if (!Number.isInteger(firstIndex)) errors.push(`${label}.cueRange 起点引用不存在的 cue ${first}`);
  if (!Number.isInteger(lastIndex)) errors.push(`${label}.cueRange 终点引用不存在的 cue ${last}`);
  if (!Number.isInteger(firstIndex) || !Number.isInteger(lastIndex)) return null;
  if (firstIndex > lastIndex) {
    errors.push(`${label}.cueRange 首尾顺序错误: ${first} -> ${last}`);
    return null;
  }
  return {
    firstIndex,
    lastIndex
  };
}

function validateAlbumPlan(albumPlan, beatIds, errors) {
  if (!isObject(albumPlan)) {
    errors.push("albumPlan 必须是对象");
    return;
  }
  checkKeys(
    albumPlan,
    new Set(["intent", "openingState", "progression", "endingState", "recurringElements"]),
    "albumPlan",
    errors
  );
  for (const key of ["intent", "openingState", "progression", "endingState"]) {
    checkText(albumPlan[key], `albumPlan.${key}`, errors);
  }
  if (!Array.isArray(albumPlan.recurringElements)) {
    errors.push("albumPlan.recurringElements 必须是数组");
    return;
  }
  const seen = new Set();
  const beatIndex = new Map(beatIds.map((id, index) => [id, index]));
  for (const [index, element] of albumPlan.recurringElements.entries()) {
    const label = `albumPlan.recurringElements[${index}]`;
    if (!isObject(element)) {
      errors.push(`${label} 必须是对象`);
      continue;
    }
    checkKeys(element, new Set(["id", "subject", "purpose", "progression", "beatRefs"]), label, errors);
    if (!/^RE[0-9]{3}$/u.test(element.id ?? "")) errors.push(`${label}.id 必须是 RE 加三位数字`);
    if (seen.has(element.id)) errors.push(`${label}.id 重复: ${String(element.id)}`);
    seen.add(element.id);
    checkText(element.subject, `${label}.subject`, errors);
    checkText(element.purpose, `${label}.purpose`, errors);
    checkText(element.progression, `${label}.progression`, errors);
    const refs = checkUniqueArray(element.beatRefs, `${label}.beatRefs`, isBeatId, errors);
    if (refs.length < 2) errors.push(`${label}.beatRefs 必须跨至少两个 Beat，才能成为 recurringElement`);
    let previousIndex = -1;
    for (const beatId of refs) {
      if (!beatIndex.has(beatId)) {
        errors.push(`${label}.beatRefs 引用了不存在的 Beat ${String(beatId)}`);
        continue;
      }
      const currentIndex = beatIndex.get(beatId);
      if (currentIndex <= previousIndex) errors.push(`${label}.beatRefs 必须按正文顺序登记`);
      previousIndex = currentIndex;
    }
  }
}

function validateTemplateAssembly(context, errors) {
  const templates = context?.templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    errors.push("context.templates 必须是非空的模板装配投影");
    return;
  }
  const ids = new Set();
  for (const [index, template] of templates.entries()) {
    const id = isObject(template) ? template.id : template;
    if (!isPackageId(id)) errors.push(`context.templates[${index}] 缺少有效模板 id`);
    else ids.add(id);
  }
  if (!ids.has(FULLFRAME_TEMPLATE_ID)) errors.push("模板装配投影缺少默认模板 fullframe-narrative");
  for (const id of EXPLAINER_TEMPLATE_IDS) if (!ids.has(id)) errors.push(`模板装配投影缺少讲解模板 ${id}`);
}

function validateBeats({ beats, cues, cueIndexes, errors }) {
  if (!Array.isArray(beats) || beats.length === 0) {
    errors.push("beats 必须是非空数组");
    return { beatIds: [] };
  }
  const beatIds = [];
  let expectedCueIndex = 0;
  for (const [index, beat] of beats.entries()) {
    const label = `beats[${index}]`;
    if (!isObject(beat)) {
      errors.push(`${label} 必须是对象`);
      continue;
    }
    const allowedKeys = ["id", "cueRange", "viewerOutcome", "directorBrief", "templateId"];
    checkKeys(beat, new Set(allowedKeys), label, errors);
    if (!isBeatId(beat.id)) errors.push(`${label}.id 必须是 B 加三位数字`);
    if (beatIds.includes(beat.id)) errors.push(`${label}.id 重复: ${String(beat.id)}`);
    beatIds.push(beat.id);

    const range = resolveBeatRange(beat, label, cues, cueIndexes, errors);
    if (range) {
      if (range.firstIndex !== expectedCueIndex) {
        errors.push(`${label}.cueRange 未与前一 Beat 连续覆盖正文 cue`);
      }
      expectedCueIndex = range.lastIndex + 1;
    }

    checkText(beat.viewerOutcome, `${label}.viewerOutcome`, errors);
    const brief = beat.directorBrief;
    if (!isObject(brief)) {
      errors.push(`${label}.directorBrief 必须是对象`);
    } else {
      checkKeys(brief, new Set(["roleInAlbum", "mustShow", "relationFromPrevious"]), `${label}.directorBrief`, errors);
      checkText(brief.roleInAlbum, `${label}.directorBrief.roleInAlbum`, errors);
      checkText(brief.mustShow, `${label}.directorBrief.mustShow`, errors);
      if (index === 0) {
        if (brief.relationFromPrevious !== null) errors.push("首 Beat 的 relationFromPrevious 必须为 null");
      } else if (!hasText(brief.relationFromPrevious)) {
        errors.push(`${label}.directorBrief.relationFromPrevious 必须是非空文本`);
      }
    }
    if (!isPackageId(beat.templateId)) errors.push(`${label}.templateId 必须是有效模板 ID`);
    else if (beat.templateId !== FULLFRAME_TEMPLATE_ID && !isExplainerTemplateId(beat.templateId)) {
      errors.push(`${label}.templateId 只能是 ${FULLFRAME_TEMPLATE_ID} 或 ${EXPLAINER_TEMPLATE_IDS.join("、")}`);
    }
  }
  if (expectedCueIndex !== cues.length) errors.push("正文 Beat 未连续覆盖全部 cue");
  return { beatIds };
}

function validateTemplateRuns({ templateRuns, beats, beatIds, errors }) {
  if (!Array.isArray(templateRuns)) {
    errors.push("templateRuns 必须是数组");
    return;
  }
  const beatIndex = new Map(beatIds.map((id, index) => [id, index]));
  const membership = new Map();
  let previousLastIndex = -1;
  const seenRunIds = new Set();
  for (const [index, run] of templateRuns.entries()) {
    const label = `templateRuns[${index}]`;
    if (!isObject(run)) {
      errors.push(`${label} 必须是对象`);
      continue;
    }
    checkKeys(run, new Set(["id", "templateId", "beatIds"]), label, errors);
    if (!/^TR[0-9]{3}$/u.test(run.id ?? "")) errors.push(`${label}.id 必须是 TR 加三位数字`);
    if (seenRunIds.has(run.id)) errors.push(`${label}.id 重复: ${String(run.id)}`);
    seenRunIds.add(run.id);
    if (run.templateId !== FULLFRAME_TEMPLATE_ID && !isExplainerTemplateId(run.templateId)) {
      errors.push(`${label}.templateId 必须是 ${[FULLFRAME_TEMPLATE_ID, ...EXPLAINER_TEMPLATE_IDS].join("、")}`);
    }
    const memberIds = checkUniqueArray(run.beatIds, `${label}.beatIds`, isBeatId, errors);
    if (memberIds.length === 0) errors.push(`${label}.beatIds 必须至少包含一个 Beat`);
    const indexes = [];
    for (const beatId of memberIds) {
      if (!beatIndex.has(beatId)) {
        errors.push(`${label}.beatIds 引用了不存在的 Beat ${String(beatId)}`);
        continue;
      }
      const currentIndex = beatIndex.get(beatId);
      indexes.push(currentIndex);
      if (membership.has(beatId)) errors.push(`${beatId} 同时属于 ${membership.get(beatId)} 和 ${run.id}`);
      else membership.set(beatId, run.id);
      if (beats[currentIndex]?.templateId !== run.templateId) {
        errors.push(`${label}/${beatId} 的 Beat 模板与运行组模板不一致`);
      }
    }
    for (let memberIndex = 1; memberIndex < indexes.length; memberIndex += 1) {
      if (indexes[memberIndex] !== indexes[memberIndex - 1] + 1) {
        errors.push(`${label}.beatIds 必须按正文顺序连续排列`);
      }
    }
    if (indexes.length > 0) {
      if (indexes[0] <= previousLastIndex) errors.push(`${label} 与前一运行组乱序或重叠`);
      previousLastIndex = indexes.at(-1);
    }
  }
  for (const beat of beats) {
    const inRun = membership.has(beat.id);
    if (!inRun) errors.push(`${beat.id} 必须进入唯一连续段 templateRun`);
  }
}

const validateDirectorCore = ({ result, context }) => {
  const errors = [];
  if (!isObject(result)) return { errors: ["候选稿必须是对象"], beatIds: [], beats: [] };
  checkKeys(result, new Set(["albumPlan", "beats", "templateRuns"]), "候选稿", errors);

  const cues = Array.isArray(context?.cues) ? context.cues : [];
  const cueIndexes = cueIndexMap(cues, errors);
  const beats = Array.isArray(result.beats) ? result.beats : [];
  validateAlbumPlan(result.albumPlan, beats.map((beat) => beat?.id), errors);
  const beatValidation = validateBeats({
    beats,
    cues,
    cueIndexes,
    errors
  });
  return { errors, beatIds: beatValidation.beatIds, beats };
};

function validateLocalRevision(result, context, errors) {
  const request = context?.returnRequest;
  if (request?.revisionScope !== "director-revision") return;
  const baseline = context.currentVisualPlan;
  if (!baseline?.beats || hashObject(baseline) !== request.baselineVisualPlanSha256) {
    errors.push("导演局部修订缺少与请求一致的正式基线");
    return;
  }
  const selected = new Set(request.selectedBeatIds ?? []);
  const originals = new Map(baseline.beats.map((beat) => [beat.id, beat]));
  if (!selected.size || [...selected].some((id) => !originals.has(id))) {
    errors.push("导演局部修订的原 Beat 范围无效");
    return;
  }
  const cueIds = (beats) => beats.flatMap(({ cueRange: [first, last] }) =>
    Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i));
  const editableCues = new Set(cueIds(baseline.beats.filter(({ id }) => selected.has(id))));
  if (hashObject([...editableCues]) !== hashObject(request.cueRefs)) errors.push("导演修订 cue 范围与所选原 Beat 不一致");
  const successors = new Set(baseline.beats.flatMap((beat, index) =>
    selected.has(beat.id) && baseline.beats[index + 1] && !selected.has(baseline.beats[index + 1].id)
      ? [baseline.beats[index + 1].id] : []));
  const newLocalIds = new Set();
  for (const beat of result.beats ?? []) {
    const original = originals.get(beat.id);
    if (original && !selected.has(beat.id)) {
      const comparable = structuredClone(beat);
      if (successors.has(beat.id) && comparable.directorBrief) {
        comparable.directorBrief.relationFromPrevious = original.directorBrief.relationFromPrevious;
      }
      if (hashObject(comparable) !== hashObject(original)) errors.push(`局部修订不得改变范围外页面 ${beat.id}`);
    } else {
      newLocalIds.add(beat.id);
      const cues = Array.isArray(beat.cueRange) ? cueIds([beat]) : [];
      if (!cues.length || cues.some((id) => !editableCues.has(id))) errors.push(`${beat.id} 超出所选原 Beat 的 cue 范围`);
      if (original && !cues.some((id) => id >= original.cueRange[0] && id <= original.cueRange[1])) {
        errors.push(`${beat.id} 不得把已有身份移给无关页面`);
      }
    }
  }
  for (const beat of baseline.beats) {
    if (!selected.has(beat.id) && !result.beats?.some(({ id }) => id === beat.id)) {
      errors.push(`局部修订不得删除范围外页面 ${beat.id}`);
    }
  }
  for (const key of ["intent", "openingState", "progression", "endingState"]) {
    if (result.albumPlan?.[key] !== baseline.albumPlan[key]) errors.push(`局部修订不得改写整集方向 albumPlan.${key}`);
  }
  // Explainers are shared author units; fullframe runs only organize Beat results.
  const oldRuns = new Map(baseline.templateRuns.map((run) => [run.id, run]));
  for (const run of result.templateRuns ?? []) {
    const old = oldRuns.get(run.id);
    const touchesOutside = [...(old?.beatIds ?? []), ...(run.beatIds ?? [])]
      .some((id) => !selected.has(id) && !newLocalIds.has(id));
    const fullframeLocalChange = old?.templateId === FULLFRAME_TEMPLATE_ID && run.templateId === FULLFRAME_TEMPLATE_ID
      && hashObject(old.beatIds.filter(id => !selected.has(id)))
        === hashObject(run.beatIds.filter(id => !selected.has(id) && !newLocalIds.has(id)));
    if (touchesOutside && !fullframeLocalChange && hashObject(run) !== hashObject(old ?? null)) {
      errors.push(`${run.id} 调整运行组成员须明确选择全部受影响页面`);
    }
  }
  for (const run of baseline.templateRuns) {
    if (run.beatIds.some((id) => !selected.has(id))
      && !(result.templateRuns ?? []).some(({ id }) => id === run.id)) errors.push(`不得删除范围外运行组 ${run.id}`);
  }
  const oldElements = new Map(baseline.albumPlan.recurringElements.map((element) => [element.id, element]));
  for (const element of result.albumPlan?.recurringElements ?? []) {
    const old = oldElements.get(element.id);
    const outsideRefs = (refs) => (refs ?? []).filter((id) => !selected.has(id) && !newLocalIds.has(id));
    if (outsideRefs(old?.beatRefs).length || outsideRefs(element.beatRefs).length) {
      if (!old || hashObject({ ...element, beatRefs: outsideRefs(element.beatRefs) })
        !== hashObject({ ...old, beatRefs: outsideRefs(old.beatRefs) })) {
        errors.push(`${element.id} 不得改变范围外重复元素的内容或引用`);
      }
    }
  }
  for (const element of baseline.albumPlan.recurringElements) {
    if (element.beatRefs.some((id) => !selected.has(id))
      && !(result.albumPlan?.recurringElements ?? []).some(({ id }) => id === element.id)) {
      errors.push(`不得删除范围外重复元素 ${element.id}`);
    }
  }
}

function validateStableIdentities(result, context, errors) {
  const baseline = context?.currentVisualPlan;
  if (!baseline) return;
  for (const [oldItems, newItems] of [
    [baseline.beats, result.beats], [baseline.templateRuns, result.templateRuns],
    [baseline.albumPlan?.recurringElements, result.albumPlan?.recurringElements]
  ]) {
    const contentHash = ({ id, ...content }) => hashObject(content);
    for (const item of newItems ?? []) {
      const unchanged = (oldItems ?? []).filter((old) => contentHash(old) === contentHash(item));
      if (unchanged.length && !unchanged.some(({ id }) => id === item.id)) {
        errors.push(`内容未改的 ${unchanged.map(({ id }) => id).join("/")} 必须保留既有身份，不能改为 ${item.id}`);
      }
    }
  }
}

export function validate({ result, context } = {}) {
  const core = validateDirectorCore({ result, context });
  if (!isObject(result)) return core.errors;
  const errors = core.errors;
  rejectForbidden(result, "候选稿", errors);
  validateTemplateAssembly(context, errors);
  validateTemplateRuns({
    templateRuns: result.templateRuns,
    beats: core.beats,
    beatIds: core.beatIds,
    errors
  });
  if (!errors.length) {
    validateStableIdentities(result, context, errors);
    validateLocalRevision(result, context, errors);
  }
  return errors;
}

const cuePolicyResources = (resolvedAssembly) => new Map(
  (resolvedAssembly?.slots ?? []).flatMap((slot) => (
    (slot.implementations ?? []).flatMap((implementation) => {
      const resource = (implementation.resources ?? []).find((item) => item.role === "cuePolicy");
      return resource ? [[implementation.packageId, resource]] : [];
    })
  ))
);

const moduleSystemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const validateTemplateAuthorability = async ({ result, context, systemRoot, resolvedAssembly }) => {
  const resources = cuePolicyResources(resolvedAssembly);
  const inspections = await inspectDirectorAuthorability({
    result,
    cues: context?.cues ?? [],
    loadCuePolicy: async (templateId) => {
      const resource = resources.get(templateId);
      if (!systemRoot || !resource?.source) throw new Error(`${templateId} 缺少正式 cuePolicy`);
      return import(pathToFileURL(path.resolve(systemRoot, resource.source)).href);
    }
  });
  return directorAuthorabilityErrors(inspections);
};

export async function validateAcceptance({ result, context, services } = {}) {
  const lockErrors = [
    ...await validateDirectorBoundariesLock({
      workspaceRoot: services?.workspaceRoot,
      task: services?.task,
      result
    }),
    ...await validateDirectorAuthorabilityLock({
      workspaceRoot: services?.workspaceRoot,
      task: services?.task,
      result
    })
  ];
  if (lockErrors.length) return lockErrors;
  return validateTemplateAuthorability({
    result,
    context,
    systemRoot: services?.systemRoot,
    resolvedAssembly: services?.resolvedAssembly ?? services?.task?.resolvedAssembly
  });
}

export async function validateStoredAcceptance({ result, context, services } = {}) {
  return validateTemplateAuthorability({
    result,
    context,
    systemRoot: moduleSystemRoot,
    resolvedAssembly: services?.resolvedAssembly ?? services?.task?.resolvedAssembly
  });
}
