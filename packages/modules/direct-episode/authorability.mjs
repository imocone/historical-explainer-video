const FULLFRAME_TEMPLATE_ID = "fullframe-narrative";

export const directorAuthorUnits = (result = {}) => {
  const beats = result.beats ?? [];
  const beatsById = new Map(beats.map((beat) => [beat.id, beat]));
  const beatIndexes = new Map(beats.map((beat, index) => [beat.id, index]));
  return [
    ...beats
      .filter((beat) => beat.templateId === FULLFRAME_TEMPLATE_ID)
      .map((beat) => ({ id: beat.id, templateId: beat.templateId, cueRange: beat.cueRange })),
    ...(result.templateRuns ?? []).filter(run => run.templateId !== FULLFRAME_TEMPLATE_ID).map((run) => {
      const first = beatsById.get(run.beatIds?.[0]);
      const last = beatsById.get(run.beatIds?.at(-1));
      const firstIndex = beatIndexes.get(first?.id);
      const lastIndex = beatIndexes.get(last?.id);
      return {
        id: run.id,
        templateId: run.templateId,
        cueRange: first && last ? [first.cueRange[0], last.cueRange[1]] : null,
        memberBeatCount: run.beatIds?.length ?? 0,
        previousTemplateId: Number.isInteger(firstIndex) ? beats[firstIndex - 1]?.templateId ?? null : null,
        nextTemplateId: Number.isInteger(lastIndex) ? beats[lastIndex + 1]?.templateId ?? null : null
      };
    })
  ];
};

export const inspectDirectorAuthorability = async ({ result, cues, loadCuePolicy, includePlanning = false }) => {
  const inspections = [];
  for (const unit of directorAuthorUnits(result)) {
    try {
      const policy = await loadCuePolicy(unit.templateId);
      if (typeof policy?.inspectDirectorAuthorability !== "function") {
        throw new Error(`${unit.templateId} cuePolicy 缺少 inspectDirectorAuthorability`);
      }
      const inspection = policy.inspectDirectorAuthorability({
        includePlanning,
        cueRange: unit.cueRange,
        cues,
        label: unit.id,
        memberBeatCount: unit.memberBeatCount,
        previousTemplateId: unit.previousTemplateId,
        nextTemplateId: unit.nextTemplateId
      });
      inspections.push({
        id: unit.id,
        templateId: unit.templateId,
        authorable: inspection?.authorable === true,
        ...(includePlanning && inspection?.planning ? { planning: inspection.planning } : {}),
        ...(typeof inspection?.reason === "string" && inspection.reason.trim()
          ? { reason: inspection.reason.trim() }
          : {})
      });
    } catch (error) {
      inspections.push({
        id: unit.id,
        templateId: unit.templateId,
        authorable: false,
        error: error.message
      });
    }
  }
  return inspections;
};

export const directorAuthorabilityErrors = (inspections) => inspections.flatMap((inspection) => {
  if (inspection.error) {
    return [`${inspection.id} 的 ${inspection.templateId} 可创作性核验失败: ${inspection.error}`];
  }
  return inspection.authorable
    ? []
    : [`${inspection.id} 的真实字幕范围无法由 ${inspection.templateId} 创作${inspection.reason ? `: ${inspection.reason}` : ""}`];
});
