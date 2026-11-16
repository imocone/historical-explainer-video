#!/usr/bin/env node
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {assertProjectPath, atomicWriteData, hashObject, readData, sha256, withProjectLock} from '../../../program-utils.mjs';
import {getEpisodePaths} from '../../../workspace-paths.mjs';
import {readP3Sources, registerP3Source} from '../../../p3-sources.mjs';
import {assertSourceRightsForExternalProduction} from '../../../source-rights.mjs';
import {validateSchema} from '../../../../engine/runtime/schema.mjs';
import {assertCurrentDirectorInputs} from '../inspect-boundaries.mjs';
import {validate as validateDirector} from '../validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceSchema = path.resolve(here, '../../../../contracts/source-assets.schema.json');
const marker = /^【历史视觉依据 (SA\d{3})】适用Cue (\d+)—(\d+)(?:（分配Cue (\d+)—(\d+)）)?[^\n]*(?:\n|$)/gmu;
const image = file => /\.(png|jpe?g|webp)$/iu.test(file);
const fail = message => { throw new Error(message); };
const cueIds = (range, cues) => {
  const first = cues.findIndex(cue => cue.id === range[0]);
  const last = cues.findIndex(cue => cue.id === range[1]);
  if (first < 0 || last < first) fail(`考据cue范围不存在或倒置：${range.join('-')}`);
  return cues.slice(first, last + 1).map(cue => cue.id);
};
const findings = context => [
  ...context.people.flatMap(person => [person.likeness, person.clothing]), ...context.environment
];
const editable = task => task.inputs.returnRequest?.revisionScope === 'director-revision'
  ? new Set(task.inputs.returnRequest.cueRefs) : new Set(task.inputs.cues.map(cue => cue.id));

function contiguousCueGroups(ids) {
  const groups = [];
  let start = 0;
  for (let end = 1; end <= ids.length; end++) {
    if (ids[end] === ids[end - 1] + 1) continue;
    groups.push(ids.slice(start, end));
    start = end;
  }
  return groups;
}

async function loadTask(workOrderPath) {
  const file = path.resolve(workOrderPath);
  const task = await readData(file);
  const candidatePath = path.join(path.dirname(file), path.basename(task.candidatePath));
  const candidate = await readData(candidatePath);
  const workspaceRoot = assertCurrentDirectorInputs({workOrder: task, candidate, candidatePath});
  if (file !== path.join(workspaceRoot, path.dirname(task.candidatePath), 'work-order.yaml'))
    fail('考据组件只接受当前正式导演工作单路径');
  await assertProjectPath({root: workspaceRoot, file: candidatePath, label: '导演唯一候选'});
  const assets = await readP3Sources({workspaceRoot, workOrder: task});
  const errors = validateDirector({result: candidate.result, context: {...task.inputs, sourceAssets: assets}, chapterDraft: true});
  if (errors.length) fail(`导演候选尚不能交接：${errors.join('; ')}`);
  return {file, task, candidate, candidatePath, workspaceRoot, assets,
    input: getEpisodePaths(workspaceRoot, task.subject.id).input};
}

function validateRanges(contexts, task) {
  const allowed = editable(task);
  for (const context of contexts) {
    if (cueIds(context.cueRange, task.inputs.cues).some(id => !allowed.has(id)))
      fail('考据范围超出本次导演修订授权；保留既有资料与候选');
  }
}

function boundContexts(beats, baseline = []) {
  const previous = new Map(baseline.map(beat => [beat.id, beat]));
  return beats.flatMap(beat => [...beat.directorBrief.mustShow.matchAll(marker)].map(match => {
    const [line, sourceId, start, end, assignedStart, assignedEnd] = match;
    const contextRange = [Number(start), Number(end)];
    const prior = previous.get(beat.id);
    // The original hints only stored the context range. Recover their
    // effective assignment from the accepted beat when it is available.
    const assignedRange = assignedStart ? [Number(assignedStart), Number(assignedEnd)]
      : prior?.directorBrief.mustShow.includes(line.trimEnd())
        ? [Math.max(contextRange[0], prior.cueRange[0]), Math.min(contextRange[1], prior.cueRange[1])]
        : contextRange;
    return {sourceId, contextRange, assignedRange};
  }));
}

function mapSubtitleCues(previous, current) {
  const spans = cues => {
    let offset = 0;
    return cues.map(({id, text}) => {
      const content = text.replace(/\s/gu, '');
      const span = {id, start: offset, end: offset + content.length, content};
      offset = span.end;
      return span;
    });
  };
  const before = spans(previous);
  const after = spans(current);
  if (before.map(cue => cue.content).join('') !== after.map(cue => cue.content).join(''))
    fail('考据对应口播已改变；回导演考据处理实际范围');
  const byId = new Map(before.map(cue => [cue.id, cue]));
  return ([first, last], [trimStart, trimEnd] = [0, 0]) => {
    const start = byId.get(first).start + trimStart;
    const end = byId.get(last).end - trimEnd;
    const covered = after.filter(cue => cue.end > start && cue.start < end);
    // Keep a context's precise text span if a new cue combines two contexts.
    // A later split can then recover the right range for each context.
    return {ids: covered.map(cue => cue.id),
      offsets: [start - covered[0].start, covered.at(-1).end - end]};
  };
}

async function sourceBytes(asset, state) {
  const file = path.join(state.input, asset.path);
  await assertProjectPath({root: state.workspaceRoot, file, label: '历史视觉原件'});
  const bytes = await readFile(file);
  if (sha256(bytes) !== asset.sha256) fail(`${asset.id} 原件内容与登记不一致`);
  return bytes;
}

function dossierCues(contexts, cues) {
  const selected = new Set(contexts.flatMap(context => cueIds(context.cueRange, cues)));
  return cues.filter(cue => selected.has(cue.id)).map(({id, text}) => ({id, text}));
}

async function registerDossier(state, dossier) {
  const file = path.join(state.workspaceRoot, state.task.scratchPath, 'historical-context',
    `registered-context-${hashObject(dossier)}.json`);
  await assertProjectPath({root: state.workspaceRoot, file, label: '考据登记输入'});
  await atomicWriteData(file, dossier);
  return registerP3Source({workOrderPath: state.file, source: {file, mediaType: 'document',
    sourceCitation: dossier.title, creator: 'direct-episode', date: null, rightsStatus: 'permission-granted',
    usageNotes: '本集历史视觉考据资料；阅读contexts的适用范围、人物样貌与衣装、环境和限制。原图按sources独立权利使用。'}});
}

// AI selects evidence and writes findings. This operation only preserves that
// input, resolves source identities and publishes through the existing registry.
export async function publishHistoricalContext({workOrderPath, researchPath}) {
  const state = await loadTask(workOrderPath);
  const {task, workspaceRoot} = state;
  await assertProjectPath({root: path.join(workspaceRoot, task.scratchPath),
    file: path.resolve(researchPath), label: '历史视觉研究输入'});
  const research = await readData(path.resolve(researchPath));
  await validateSchema(path.join(here, 'research.schema.json'), research, '历史视觉研究输入');
  if (research.taskDigest !== task.taskDigest) fail('研究输入不属于当前导演工作单');
  validateRanges(research.contexts, task);
  const materials = new Map();
  for (const material of research.materials) {
    if (materials.has(material.key)) fail(`材料key重复：${material.key}`);
    if (material.sourceAssetId) {
      const asset = state.assets.find(item => item.id === material.sourceAssetId);
      if (!asset) fail(`未登记来源：${material.sourceAssetId}`);
      await sourceBytes(asset, state);
      materials.set(material.key, {asset});
    } else {
      const {key, file, ...metadata} = material;
      const absolute = path.resolve(path.dirname(researchPath), file);
      await assertProjectPath({root: path.join(workspaceRoot, task.scratchPath), file: absolute, label: '考据原件'});
      const bytes = await readFile(absolute);
      if (!bytes.length) fail(`材料为空：${key}`);
      const extension = path.extname(absolute).toLowerCase();
      if (!/^\.[a-z0-9]{1,8}$/u.test(extension)) fail(`材料缺少有效扩展名：${key}`);
      await validateSchema(sourceSchema, {schemaVersion: '1.0', assets: [{...metadata,
        id: 'SA001', path: `sources/check${extension}`, sha256: sha256(bytes)}]}, '考据来源');
      materials.set(key, {source: {...metadata, file: absolute}});
    }
  }
  // Resolve every reference before the first registry write. These are reference
  // and file contracts, not judgments that the claimed history is correct.
  const used = new Set();
  for (const context of research.contexts) {
    for (const finding of findings(context)) {
      for (const key of finding.evidence) {
        const item = materials.get(key);
        if (!item) fail(`考据引用不存在的材料：${key}`);
        used.add(key);
        const source = item.asset ?? item.source;
        if (image(source.path ?? source.file))
          assertSourceRightsForExternalProduction({rightsStatus: source.rightsStatus, label: key});
      }
    }
    for (const person of context.people) {
      if (['portrait', 'photo', 'later-depiction'].includes(person.likeness.basis)
        && !person.likeness.evidence.some(key => {
          const material = materials.get(key);
          return material && image(material.asset?.path ?? material.source?.file ?? '');
        })) fail(`${person.subject} 已选择图像依据但没有可交接原图`);
    }
  }
  if ([...materials.keys()].some(key => !used.has(key))) fail('材料未被当前研究使用；只交接本次实际依据');
  const resolved = new Map();
  for (const [key, item] of materials) resolved.set(key, item.asset ??
    await registerP3Source({workOrderPath, source: item.source}));
  const contexts = structuredClone(research.contexts);
  for (const context of contexts) for (const finding of findings(context))
    finding.evidence = finding.evidence.map(key => resolved.get(key).id);
  if (!contexts.length) return {source: null, contexts: [], reason: research.notApplicableReason};
  const dossier = {kind: 'historical-context', title: research.title,
    cues: dossierCues(contexts, task.inputs.cues),
    contexts, sources: [...resolved.values()]};
  const source = await registerDossier(state, dossier);
  return {source, contexts, sourceAssets: [...resolved.values()]};
}

async function readDossier(state, sourceId) {
  const source = state.assets.find(item => item.id === sourceId);
  if (!source) fail(`未登记历史视觉资料：${sourceId}`);
  const dossier = JSON.parse((await sourceBytes(source, state)).toString('utf8'));
  if (dossier.kind !== 'historical-context' || !Array.isArray(dossier.contexts) || !Array.isArray(dossier.sources)
    || !Array.isArray(dossier.cues))
    fail('指定来源不是历史视觉组件交付');
  return dossier;
}

async function prepareBindings({state, sourceId, assignments, previous, mapping, allowed}) {
  const dossier = await readDossier(state, sourceId);
  const cues = state.task.inputs.cues;
  const sourceCues = previous ?? cues;
  const placements = [];
  for (const context of dossier.contexts) {
    const {cueRange, cueTextOffsets = [0, 0]} = context;
    const contextAssignments = assignments?.filter(assignment =>
      assignment.contextRange[0] === cueRange[0] && assignment.contextRange[1] === cueRange[1]);
    if (contextAssignments && !contextAssignments.length) continue;
    const originalIds = cueIds(context.cueRange, sourceCues);
    const assignedIds = contextAssignments ? originalIds.filter(id =>
      contextAssignments.some(({assignedRange: [start, end]}) => id >= start && id <= end)) : originalIds;
    if (!mapping) {
      const selectedIds = assignedIds.filter(id => allowed.has(id));
      if (selectedIds.length) placements.push({context, selectedIds, cueIds: new Set(selectedIds)});
      continue;
    }
    // Translate only the piece still assigned to this source. An older
    // context can span an area already replaced by a local revision.
    for (const selectedIds of contiguousCueGroups(assignedIds)) {
      const first = selectedIds[0], last = selectedIds.at(-1);
      const {ids, offsets} = mapping([first, last], [
        first === cueRange[0] ? cueTextOffsets[0] : 0,
        last === cueRange[1] ? cueTextOffsets[1] : 0
      ]);
      const currentIds = ids.filter(id => allowed.has(id));
      if (!currentIds.length) continue;
      const mappedContext = {...context, cueRange: [ids[0], ids.at(-1)]};
      delete mappedContext.cueTextOffsets;
      if (offsets.some(offset => offset > 0)) mappedContext.cueTextOffsets = offsets;
      placements.push({context: mappedContext, selectedIds, cueIds: new Set(currentIds)});
    }
  }
  const sourceTexts = new Map(sourceCues.map(({id, text}) => [id, text]));
  const recordedTexts = new Map(dossier.cues.map(({id, text}) => [id, text]));
  for (const id of new Set(placements.flatMap(item => item.selectedIds))) {
    if (recordedTexts.get(id) !== sourceTexts.get(id))
      fail('考据对应口播已改变；回导演考据处理实际范围');
  }
  const contexts = placements.map(item => item.context);
  const sourceIds = new Set(contexts.flatMap(context => findings(context).flatMap(item => item.evidence)));
  for (const original of dossier.sources.filter(item => sourceIds.has(item.id))) {
    const current = state.assets.find(item => item.id === original.id);
    if (!current || hashObject(current) !== hashObject(original)) fail(`考据原来源已改变：${original.id}`);
    await sourceBytes(current, state);
  }
  const remapped = previous && contexts.length
    ? {...dossier, cues: dossierCues(contexts, cues), contexts, sources: dossier.sources.filter(item => sourceIds.has(item.id))}
    : null;
  return {sourceId, placements, remapped: remapped && hashObject(remapped) !== hashObject(dossier) ? remapped : null};
}

export async function bindHistoricalContext({workOrderPath, sourceId}) {
  const state = await loadTask(workOrderPath);
  const {task, workspaceRoot, candidate, candidatePath} = state;
  const allowed = editable(task);
  const cues = task.inputs.cues;
  const baseline = task.inputs.currentVisualPlan?.beats ?? [];
  const assigned = boundContexts(candidate.result.beats, baseline);
  const previous = task.inputs.returnRequest?.cueRebinding?.previousCues;
  const previousSources = new Set(boundContexts(baseline).map(item => item.sourceId));
  const reuse = !sourceId || assigned.some(item => item.sourceId === sourceId) || previousSources.has(sourceId);
  const selected = reuse ? new Map() : new Map([[sourceId, null]]);
  if (reuse) {
    for (const item of assigned) {
      if (!selected.has(item.sourceId)) selected.set(item.sourceId, []);
      selected.get(item.sourceId).push(item);
    }
    // A caller can still re-apply a registered snapshot that has not been bound.
    if (sourceId && !selected.size) selected.set(sourceId, null);
  }
  if (!selected.size) return {sourceId, candidatePath, bindings: []};
  const cueLayoutChanged = previous && (previous.length !== cues.length
    || previous.some((cue, index) => cue.id !== cues[index].id || cue.text !== cues[index].text));
  const remap = cueLayoutChanged && reuse && [...selected.keys()].some(id => previousSources.has(id))
    ? mapSubtitleCues(previous, cues) : null;
  const research = [];
  for (const [id, assignments] of selected) {
    const mapping = reuse && previousSources.has(id) ? remap : null;
    if (assignments && !assignments.some(({assignedRange}) => {
      const ids = mapping ? mapping(assignedRange).ids : cueIds(assignedRange, cues);
      return ids.some(id => allowed.has(id));
    })) continue;
    research.push(await prepareBindings({state, sourceId: id, assignments, previous: mapping ? previous : null, mapping, allowed}));
  }
  for (const item of research) {
    if (item.remapped) item.sourceId = (await registerDossier(state, item.remapped)).id;
  }
  const result = structuredClone(candidate.result);
  const bindings = [];
  for (const beat of result.beats) {
    const ids = cueIds(beat.cueRange, cues);
    if (!ids.every(id => allowed.has(id))) continue;
    const clean = beat.directorBrief.mustShow.replace(marker, '').trimEnd();
    const lines = [];
    for (const item of research) {
      const cueRanges = [];
      for (const placement of item.placements) {
        const {context} = placement;
        const inBeat = ids.filter(id => placement.cueIds.has(id));
        if (!inBeat.length) continue;
        const refs = [...new Set(findings(context).flatMap(finding => finding.evidence))];
        const subjects = [...context.people.map(person => person.subject), ...context.environment.map(entry => entry.subject)];
        const range = context.cueRange.join('—');
        for (const group of contiguousCueGroups(inBeat)) {
          const assigned = [group[0], group.at(-1)].join('—');
          const assignment = assigned === range ? '' : `（分配Cue ${assigned}）`;
          lines.push(`【历史视觉依据 ${item.sourceId}】适用Cue ${range}${assignment}；${context.period}，${context.place}，${context.occasion}；对象：${subjects.join('、')}；材料：${refs.join('、') || '资料内明确的合理复原'}。读取对应context的样貌、衣装、环境及限制，只采用本镜实际表现部分。`);
        }
        cueRanges.push(context.cueRange);
      }
      if (cueRanges.length) bindings.push({beatId: beat.id, sourceId: item.sourceId, cueRanges});
    }
    beat.directorBrief.mustShow = [clean, ...lines].filter(Boolean).join('\n');
  }
  const errors = validateDirector({result, context: {...task.inputs, sourceAssets: await readP3Sources({workspaceRoot, workOrder: task})}, chapterDraft: true});
  if (errors.length) fail(`考据交接不能改变导演合同：${errors.join('; ')}`);
  await withProjectLock({root: workspaceRoot, lock: path.join(workspaceRoot, '制作/.workflow-write.lock'),
    label: '导演历史视觉交接', execute: async () => {
      if (hashObject(await readData(state.file)) !== hashObject(task)
        || hashObject(await readData(candidatePath)) !== hashObject(candidate)) fail('工作单或候选正在变化，保留现场后重读');
      if (hashObject(result) !== hashObject(candidate.result)) await atomicWriteData(candidatePath, {...candidate, result});
    }});
  return {sourceId, candidatePath, bindings};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, workOrderPath, input] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (command === 'publish' && workOrderPath && input)
      return publishHistoricalContext({workOrderPath, researchPath: path.resolve(input)});
    if (command === 'bind' && workOrderPath) return bindHistoricalContext({workOrderPath, sourceId: input});
    fail('用法: handoff.mjs publish <工作单> <scratch研究JSON> | bind <工作单> [本次新登记的资料SA编号]');
  }).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
}
