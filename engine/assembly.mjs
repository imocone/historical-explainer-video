import { hashObject } from "../packages/program-utils.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const PACKAGE_KINDS = new Set(["module", "template", "feature", "visual", "cover"]);
const CARDINALITIES = new Set(["one", "zero-or-one", "many"]);
const SELECTION_SOURCES = new Set([
  "catalog",
  "beat-template",
  "segment-template",
  "episode-features",
  "program-visual",
  "program-cover",
  "program-cover-vertical",
  "fixed"
]);

const fail = (message) => { throw new Error(message); };
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const slotKey = (moduleId, slotId) => `${moduleId}/${slotId}`;

const canonicalizeValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeValue(value[key])]));
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const mapValues = (value, label) => {
  if (value instanceof Map) return [...value.entries()].map(([id, record]) => ({ id, record }));
  if (Array.isArray(value)) return value.map((record) => ({ id: null, record }));
  if (value && typeof value === "object") return Object.entries(value).map(([id, record]) => ({ id, record }));
  fail(`${label} 必须是 Map、数组或对象`);
};

const normalizeRecord = ({ id: indexedId, record }, expectedKinds, label) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`${label} 包记录无效`);
  const manifest = record.manifest ?? record;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail(`${label} manifest 无效`);
  if (!PACKAGE_KINDS.has(manifest.kind) || !expectedKinds.has(manifest.kind)) {
    fail(`${label} 包 ${manifest.id ?? indexedId ?? "<unknown>"} kind 无效: ${manifest.kind}`);
  }
  if (typeof manifest.id !== "string" || !manifest.id) fail(`${label} 包缺少 id`);
  if (indexedId && indexedId !== manifest.id) fail(`${label} 索引 ${indexedId} 与 manifest.id ${manifest.id} 不一致`);
  return { ...record, manifest };
};

const collectRecords = ({ packages, visualPackages }) => {
  const records = [
    ...mapValues(packages, "packages").map((item) => normalizeRecord({ ...item }, new Set(["module", "template", "feature", "cover"]), "packages")),
    ...mapValues(visualPackages ?? [], "visualPackages").map((item) => normalizeRecord({ ...item }, new Set(["visual"]), "visualPackages"))
  ];
  const byId = new Map();
  for (const record of records) {
    const id = record.manifest.id;
    if (byId.has(id)) fail(`正式包 id 重复: ${id}`);
    byId.set(id, record);
  }
  return { records, byId };
};

const normalizedResource = (value, { role, packageId, packageKind, fallbackSource = null }) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${packageId}.${role} 资源证据必须是对象`);
  }
  const source = value.source ?? fallbackSource;
  if (typeof source !== "string" || !source) fail(`${packageId}.${role} 资源缺少 source`);
  if (packageKind === "template" && role === "examples") {
    return canonicalizeValue({ role, source });
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    fail(`${packageId}.${role} 资源 ${source} 缺少有效 sha256`);
  }
  return canonicalizeValue({
    role,
    source,
    sha256: value.sha256,
    ...(Object.hasOwn(value, "content") ? { content: value.content } : {})
  });
};

const propertyValue = (container, key) => container instanceof Map ? container.get(key) : container?.[key];

const evidenceForPath = (record, file, role) => {
  const packageId = record.manifest.id;
  const evidence = propertyValue(record.resourcesByPath, file)
    ?? propertyValue(record.resources, file);
  if (!evidence) fail(`${packageId}.${role} 缺少已加载资源证据: ${file}`);
  return normalizedResource(evidence, { role, packageId, packageKind: record.manifest.kind, fallbackSource: file });
};

const visualRoleResource = (record, role) => {
  const loaded = propertyValue(record.roleResources, role);
  if (!loaded) return [];
  return [normalizedResource(loaded, {
    role,
    packageId: record.manifest.id
  })];
};

const resourcesForRole = (record, role, { optional = false } = {}) => {
  const packageId = record.manifest.id;
  const supplied = propertyValue(record.resources, role);
  if (supplied != null) {
    return asArray(supplied).map((item) => normalizedResource(item, { role, packageId, packageKind: record.manifest.kind }));
  }
  if (record.manifest.kind === "visual") {
    const resources = visualRoleResource(record, role);
    if (resources.length || optional) return resources;
    fail(`${packageId}.${role} 缺少视觉资源`);
  }
  const declared = record.manifest[role];
  if (declared == null) {
    if (optional) return [];
    fail(`${packageId}.${role} 未在包清单中声明`);
  }
  if (role === "catalog" || role === "finalExample") {
    return [normalizedResource({
      source: `${record.manifestPath ?? `packages/${record.manifest.kind}s/${packageId}/package.yaml`}#${role}`,
      sha256: hashObject(declared),
      content: declared
    }, { role, packageId })];
  }
  if (typeof declared === "string" || Array.isArray(declared)) {
    return asArray(declared).map((file) => evidenceForPath(record, file, role));
  }
  fail(`${packageId}.${role} 不能解析为正式资源`);
};

const manifestResourceFor = (record) => {
  const supplied = record.manifestResource ?? propertyValue(record.resources, "manifest");
  if (supplied) return normalizedResource(supplied, { role: "manifest", packageId: record.manifest.id });
  return normalizedResource({
    source: record.manifestPath ?? `${record.manifest.kind}:${record.manifest.id}`,
    sha256: hashObject(record.manifest),
    content: record.manifest
  }, { role: "manifest", packageId: record.manifest.id });
};

const manifestSourceFor = (record) => (
  record.manifestResource?.source
  ?? propertyValue(record.resources, "manifest")?.source
  ?? record.manifestPath
  ?? `${record.manifest.kind}:${record.manifest.id}`
);

const moduleAssemblyManifestResourceFor = (record, activeSlots) => {
  const content = canonicalizeValue({ ...record.manifest, slots: activeSlots });
  return normalizedResource({
    source: `${manifestSourceFor(record)}#active-slots`,
    sha256: hashObject(content),
    content
  }, { role: "manifest", packageId: record.manifest.id });
};

const implementationManifestResourceFor = (record, implementation) => {
  const content = canonicalizeValue({
    kind: record.manifest.kind,
    id: record.manifest.id,
    ...(record.manifest.version ? { version: record.manifest.version } : {}),
    implements: {
      moduleId: implementation.moduleId,
      slotId: implementation.slotId,
      majorVersion: implementation.majorVersion,
      ...(implementation.defaultSelected ? { defaultSelected: true } : {})
    }
  });
  return normalizedResource({
    source: `${manifestSourceFor(record)}#implements:${implementation.moduleId}/${implementation.slotId}`,
    sha256: hashObject(content),
    content
  }, { role: "manifest", packageId: record.manifest.id });
};

const controllerResourceFor = (moduleRecord) => {
  const entry = moduleRecord.manifest.controllerEntry;
  if (typeof entry !== "string" || !entry) fail(`模块 ${moduleRecord.manifest.id} 缺少 controllerEntry`);
  const supplied = propertyValue(moduleRecord.resources, "controllerEntry");
  return supplied
    ? normalizedResource(supplied, { role: "controllerEntry", packageId: moduleRecord.manifest.id })
    : evidenceForPath(moduleRecord, entry, "controllerEntry");
};

const validateSlot = (moduleId, slot, slotIds) => {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) fail(`模块 ${moduleId} slot 无效`);
  if (typeof slot.id !== "string" || !slot.id) fail(`模块 ${moduleId} slot 缺少 id`);
  if (slotIds.has(slot.id)) fail(`模块 ${moduleId} slot id 重复: ${slot.id}`);
  slotIds.add(slot.id);
  if (!Number.isInteger(slot.majorVersion) || slot.majorVersion < 1) fail(`插槽 ${slotKey(moduleId, slot.id)} majorVersion 无效`);
  if (!["template", "feature", "visual", "cover"].includes(slot.accepts)) fail(`插槽 ${slotKey(moduleId, slot.id)} accepts 无效: ${slot.accepts}`);
  if (!CARDINALITIES.has(slot.cardinality)) fail(`插槽 ${slotKey(moduleId, slot.id)} cardinality 无效: ${slot.cardinality}`);
  if (!SELECTION_SOURCES.has(slot.selectionSource)) fail(`插槽 ${slotKey(moduleId, slot.id)} selectionSource 无效: ${slot.selectionSource}`);
  if (slot.selectionSource === "fixed" && (!Array.isArray(slot.fixedPackageIds) || slot.fixedPackageIds.length === 0)) {
    fail(`固定插槽 ${slotKey(moduleId, slot.id)} 缺少 fixedPackageIds`);
  }
  if (slot.selectionSource !== "fixed" && Object.hasOwn(slot, "fixedPackageIds")) {
    fail(`非固定插槽 ${slotKey(moduleId, slot.id)} 不得声明 fixedPackageIds`);
  }
  const requiredRoles = slot.readRoles ?? [];
  const optionalRoles = slot.optionalReadRoles ?? [];
  if (new Set(requiredRoles).size !== requiredRoles.length || new Set(optionalRoles).size !== optionalRoles.length) {
    fail(`插槽 ${slotKey(moduleId, slot.id)} 资源角色重复`);
  }
  if (optionalRoles.some((role) => requiredRoles.includes(role))) {
    fail(`插槽 ${slotKey(moduleId, slot.id)} 同一资源角色不得同时必填和可选`);
  }
  for (const role of [...requiredRoles, ...optionalRoles]) {
    if (typeof role !== "string" || !role) fail(`插槽 ${slotKey(moduleId, slot.id)} 包含无效资源角色`);
  }
};

const validateContracts = ({ records, byId }) => {
  const slots = new Map();
  for (const record of records.filter((item) => item.manifest.kind === "module")) {
    const slotIds = new Set();
    for (const slot of record.manifest.slots ?? []) {
      validateSlot(record.manifest.id, slot, slotIds);
      slots.set(slotKey(record.manifest.id, slot.id), { moduleRecord: record, slot });
    }
  }
  const implementors = new Map([...slots.keys()].map((key) => [key, []]));
  for (const record of records.filter((item) => item.manifest.kind !== "module")) {
    if (!Array.isArray(record.manifest.implements) || record.manifest.implements.length === 0) {
      fail(`包 ${record.manifest.id} 没有实现任何模块插槽`);
    }
    const seen = new Set();
    for (const implementation of record.manifest.implements ?? []) {
      const key = slotKey(implementation.moduleId, implementation.slotId);
      if (seen.has(key)) fail(`包 ${record.manifest.id} 重复实现插槽 ${key}`);
      seen.add(key);
      const contract = slots.get(key);
      if (!contract) fail(`包 ${record.manifest.id} 实现未知插槽 ${key}`);
      if (implementation.majorVersion !== contract.slot.majorVersion) {
        fail(`包 ${record.manifest.id} 实现 ${key} 主版本不符: ${implementation.majorVersion} != ${contract.slot.majorVersion}`);
      }
      if (record.manifest.kind !== contract.slot.accepts) {
        fail(`包 ${record.manifest.id} 类型 ${record.manifest.kind} 不符合 ${key} 的 ${contract.slot.accepts}`);
      }
      if (implementation.defaultSelected && contract.slot.selectionSource !== "episode-features") {
        fail(`包 ${record.manifest.id} 只能在 episode-features 插槽声明 defaultSelected`);
      }
      implementors.get(key).push({ record, implementation });
    }
  }
  for (const values of implementors.values()) values.sort((left, right) => left.record.manifest.id.localeCompare(right.record.manifest.id));
  for (const record of records.filter((item) => item.manifest.kind === "module")) {
    for (const slot of record.manifest.slots ?? []) {
      const candidates = new Set((implementors.get(slotKey(record.manifest.id, slot.id)) ?? [])
        .map((candidate) => candidate.record.manifest.id));
      for (const id of slot.fixedPackageIds ?? []) {
        if (!byId.has(id)) fail(`固定插槽 ${slotKey(record.manifest.id, slot.id)} 引用未知包 ${id}`);
        if (!candidates.has(id)) fail(`固定包 ${id} 未实现插槽 ${slotKey(record.manifest.id, slot.id)}`);
      }
      if (slot.selectionSource === "fixed") {
        const count = slot.fixedPackageIds.length;
        if (slot.cardinality === "one" && count !== 1) fail(`固定插槽 ${slotKey(record.manifest.id, slot.id)} cardinality=one，实际 ${count}`);
        if (slot.cardinality === "zero-or-one" && count > 1) fail(`固定插槽 ${slotKey(record.manifest.id, slot.id)} cardinality=zero-or-one，实际 ${count}`);
      }
    }
  }
  return { slots, implementors };
};

export const validateAssemblyModel = ({ packages, visualPackages = [] }) => {
  const { records, byId } = collectRecords({ packages, visualPackages });
  const { slots, implementors } = validateContracts({ records, byId });
  for (const record of records.filter((item) => item.manifest.kind === "module")) {
    controllerResourceFor(record);
    manifestResourceFor(record);
  }
  for (const [key, candidates] of implementors) {
    const { slot } = slots.get(key);
    for (const { record } of candidates) {
      for (const role of slot.readRoles ?? []) resourcesForRole(record, role);
      for (const role of slot.optionalReadRoles ?? []) resourcesForRole(record, role, { optional: true });
      manifestResourceFor(record);
    }
  }
  return deepFreeze(canonicalizeValue({
    moduleIds: records.filter((record) => record.manifest.kind === "module").map((record) => record.manifest.id).sort(),
    packageIds: records.filter((record) => record.manifest.kind !== "module").map((record) => record.manifest.id).sort(),
    slotIds: [...slots.keys()].sort()
  }));
};

const beatTemplateIds = (storyboard) => [...new Set((storyboard?.beats ?? [])
  .map((beat) => beat?.templateId)
  .filter(Boolean))];

const segmentTemplateIds = (storyboard) => {
  const segments = [storyboard?.opener];
  return [...new Set(segments.map((segment) => segment?.templateId).filter(Boolean))];
};

const uniqueIds = (ids, label) => {
  const normalized = ids.filter((id) => id != null);
  if (normalized.some((id) => typeof id !== "string" || !id)) fail(`${label} 包含无效包 id`);
  if (new Set(normalized).size !== normalized.length) fail(`${label} 包含重复包 id`);
  return [...normalized].sort();
};

const explicitIds = (selection, plural, singular) => {
  if (Array.isArray(selection?.[plural])) return selection[plural];
  if (selection?.[singular] != null) return [selection[singular]];
  return null;
};

const selectedIds = ({ slot, candidates, storyboard, selection, node, byId }) => {
  const candidateIds = new Set(candidates.map((item) => item.record.manifest.id));
  let ids;
  let ignoreNonImplementors = false;
  switch (slot.selectionSource) {
    case "catalog":
      ids = (
        slot.accepts === "template"
          ? explicitIds(selection, "templateCatalogIds", "templateCatalogId")
          : slot.accepts === "feature"
            ? explicitIds(selection, "featureCatalogIds", "featureCatalogId")
            : null
      ) ?? [...candidateIds];
      break;
    case "beat-template":
      ids = explicitIds(selection, "beatTemplateIds", "beatTemplateId")
        ?? (selection?.templateId ? [selection.templateId] : beatTemplateIds(storyboard));
      break;
    case "segment-template":
      ids = explicitIds(selection, "segmentTemplateIds", "segmentTemplateId")
        ?? (selection?.templateId ? [selection.templateId] : segmentTemplateIds(storyboard));
      break;
    case "episode-features":
      ids = explicitIds(selection, "featureIds", "featureId") ?? [...new Set([
        ...Object.entries(storyboard?.features ?? {}).filter(([,state])=>state?.enabled !== false).map(([id])=>id),
        ...candidates
          .filter((candidate) => candidate.implementation.defaultSelected
            && storyboard?.features?.[candidate.record.manifest.id]?.enabled !== false)
          .map((candidate) => candidate.record.manifest.id)
      ])];
      ignoreNonImplementors = true;
      break;
    case "program-visual":
      ids = [selection?.visualPackageId].filter(Boolean);
      break;
    case "program-cover":
      ids = [selection?.coverPackageId].filter(Boolean);
      break;
    case "program-cover-vertical":
      ids = [byId.get(selection?.coverPackageId)?.manifest?.verticalCoverPackageId].filter(Boolean);
      break;
    case "fixed":
      ids = slot.fixedPackageIds;
      break;
    default:
      fail(`不支持 selectionSource: ${slot.selectionSource}`);
  }
  const normalized = uniqueIds(ids ?? [], `${slot.selectionSource} 选择`);
  for (const id of normalized) {
    if (!byId.has(id) && !ignoreNonImplementors) {
      fail(`${slot.selectionSource} 选择引用未知包 ${id}`);
    }
  }
  return ignoreNonImplementors ? normalized.filter((id) => candidateIds.has(id)) : normalized.map((id) => {
    if (!candidateIds.has(id)) fail(`包 ${id} 未实现当前插槽`);
    return id;
  });
};

const assertCardinality = (slot, count, moduleId) => {
  const label = slotKey(moduleId, slot.id);
  if (slot.cardinality === "one" && count !== 1) fail(`插槽 ${label} cardinality=one，实际 ${count}`);
  if (slot.cardinality === "zero-or-one" && count > 1) fail(`插槽 ${label} cardinality=zero-or-one，实际 ${count}`);
};

const resolvedImplementation = ({ record, implementation, slot }) => {
  const required = (slot.readRoles ?? []).flatMap((role) => resourcesForRole(record, role));
  const optional = (slot.optionalReadRoles ?? []).flatMap((role) => resourcesForRole(record, role, { optional: true }));
  const resources = [...required, ...optional].sort((left, right) => (
    left.role.localeCompare(right.role) || left.source.localeCompare(right.source)
  ));
  return canonicalizeValue({
    packageId: record.manifest.id,
    kind: record.manifest.kind,
    majorVersion: implementation.majorVersion,
    ...(record.manifest.version ? { packageVersion: record.manifest.version } : {}),
    manifest: implementationManifestResourceFor(record, implementation),
    resources
  });
};

export const canonicalizeResolvedAssembly = (resolvedAssembly) => {
  if (!resolvedAssembly || typeof resolvedAssembly !== "object" || Array.isArray(resolvedAssembly)) {
    fail("resolvedAssembly 必须是对象");
  }
  const normalized = canonicalizeValue({
    ...resolvedAssembly,
    slots: [...(resolvedAssembly.slots ?? [])]
      .map((slot) => ({
        ...slot,
        readRoles: [...(slot.readRoles ?? [])].sort(),
        optionalReadRoles: [...(slot.optionalReadRoles ?? [])].sort(),
        writeTargets: [...(slot.writeTargets ?? [])].sort(),
        selection: {
          ...slot.selection,
          packageIds: [...(slot.selection?.packageIds ?? [])].sort()
        },
        implementations: [...(slot.implementations ?? [])]
          .map((implementation) => ({
            ...implementation,
            resources: [...(implementation.resources ?? [])].sort((left, right) => (
              left.role.localeCompare(right.role) || left.source.localeCompare(right.source)
            ))
          }))
          .sort((left, right) => left.packageId.localeCompare(right.packageId))
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
  return deepFreeze(normalized);
};

export const resolveAssembly = ({ packages, visualPackages = [], workflowNode, node, storyboard = {}, selection = {} }) => {
  const currentNode = workflowNode ?? node;
  if (!currentNode || typeof currentNode !== "object") fail("缺少 workflowNode");
  const { records, byId } = collectRecords({ packages, visualPackages });
  const moduleRecord = byId.get(currentNode.moduleId);
  if (!moduleRecord || moduleRecord.manifest.kind !== "module") fail(`节点 ${currentNode.id} 引用未知模块 ${currentNode.moduleId}`);
  const { implementors } = validateContracts({ records, byId });
  const declaredSlots = moduleRecord.manifest.slots ?? [];
  const activeSlotIds = selection.activeSlotIds == null
    ? null
    : new Set(uniqueIds(selection.activeSlotIds, "activeSlotIds"));
  if (activeSlotIds) {
    const declaredIds = new Set(declaredSlots.map((slot) => slot.id));
    for (const slotId of activeSlotIds) {
      if (!declaredIds.has(slotId)) fail(`模块 ${moduleRecord.manifest.id} 不存在活动插槽 ${slotId}`);
    }
  }
  const activeDeclaredSlots = declaredSlots.filter((slot) => !activeSlotIds || activeSlotIds.has(slot.id));
  const slots = activeDeclaredSlots.map((slot) => {
    const candidates = implementors.get(slotKey(moduleRecord.manifest.id, slot.id)) ?? [];
    const packageIds = selectedIds({ slot, candidates, storyboard, selection, node: currentNode, byId });
    assertCardinality(slot, packageIds.length, moduleRecord.manifest.id);
    const selected = new Set(packageIds);
    const implementations = candidates
      .filter((candidate) => selected.has(candidate.record.manifest.id))
      .map((candidate) => resolvedImplementation({ ...candidate, slot }));
    return {
      id: slot.id,
      majorVersion: slot.majorVersion,
      accepts: slot.accepts,
      cardinality: slot.cardinality,
      selectionSource: slot.selectionSource,
      readRoles: [...(slot.readRoles ?? [])],
      optionalReadRoles: [...(slot.optionalReadRoles ?? [])],
      writeTargets: [...(slot.writeTargets ?? [])],
      selection: { source: slot.selectionSource, packageIds },
      implementations
    };
  });
  return canonicalizeResolvedAssembly({
    schemaVersion: "1.0",
    node: { id: currentNode.id, moduleId: currentNode.moduleId },
    module: {
      id: moduleRecord.manifest.id,
      manifest: moduleAssemblyManifestResourceFor(moduleRecord, activeDeclaredSlots),
      controllerEntry: controllerResourceFor(moduleRecord),
      slotContractSha256: hashObject(activeDeclaredSlots)
    },
    slots
  });
};

export const projectAssemblyForProducer = (resolvedAssembly) => canonicalizeResolvedAssembly({
  ...resolvedAssembly,
  slots: (resolvedAssembly.slots ?? []).filter((slot) => slot.selectionSource !== "catalog")
});

export const assemblyImplementations = (resolvedAssembly, { kind = null, role = null } = {}) => {
  const matches = [];
  for (const slot of resolvedAssembly?.slots ?? []) {
    for (const implementation of slot.implementations ?? []) {
      if (kind && implementation.kind !== kind) continue;
      const resources = role
        ? (implementation.resources ?? []).filter((resource) => resource.role === role)
        : [...(implementation.resources ?? [])];
      if (role && resources.length === 0) continue;
      matches.push(deepFreeze(canonicalizeValue({
        slotId: slot.id,
        packageId: implementation.packageId,
        kind: implementation.kind,
        majorVersion: implementation.majorVersion,
        manifest: implementation.manifest,
        resources
      })));
    }
  }
  return matches.sort((left, right) => left.packageId.localeCompare(right.packageId) || left.slotId.localeCompare(right.slotId));
};

export const assemblyResources = (resolvedAssembly, query = {}) => assemblyImplementations(resolvedAssembly, query)
  .flatMap((implementation) => implementation.resources.map((resource) => ({
    slotId: implementation.slotId,
    packageId: implementation.packageId,
    kind: implementation.kind,
    ...resource
  })));
