import { authorUnitsForStoryboard } from "../../../engine/runtime/storyboard.mjs";
import { isExplainerTemplateId } from "../../explainer-template-selection.mjs";
import { readData } from "../../program-utils.mjs";
import { getProgramPaths } from "../../workspace-paths.mjs";
import { bodyEditOverlapErrors, bodyEditWindows, bodyRuntimeTimingForAuthorUnits, explainerViewingWindow } from "../render-video/runtime/transitions.mjs";

// Existing work orders acquire this current planning reference without reissue.
export const directorOpenerTemplate = async ({ workspaceRoot, context }) => workspaceRoot
  ? (await readData(getProgramPaths(workspaceRoot).programPlan)).openerTemplate : context?.openerTemplate;

const FULLFRAME_TEMPLATE_ID = "fullframe-narrative";

export const directorAuthorUnits = (result = {}) => {
  const beats = result.beats ?? [];
  const beatsById = new Map(beats.map((beat) => [beat.id, beat]));
  const beatIndexes = new Map(beats.map((beat, index) => [beat.id, index]));
  return [
    ...beats
      .filter((beat) => beat.templateId === FULLFRAME_TEMPLATE_ID)
      .map((beat) => ({ id: beat.id, templateId: beat.templateId, cueRange: beat.cueRange,
        singlePicture: Object.hasOwn(beat, "incomingTransition") })),
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

export const inspectDirectorAuthorability = async ({ result, cues, openerTemplate, loadCuePolicy, includePlanning = false }) => {
  const inspections = [];
  const authorUnits = authorUnitsForStoryboard(result).map(({ id, templateId, beats }) => ({ id, templateId,
    beats }));
  let bodyTiming;
  for (const unit of directorAuthorUnits(result)) {
    try {
      const policy = await loadCuePolicy(unit.templateId);
      if (typeof policy?.inspectDirectorAuthorability !== "function") {
        throw new Error(`${unit.templateId} cuePolicy 缺少 inspectDirectorAuthorability`);
      }
      const inspection = policy.inspectDirectorAuthorability({
        includePlanning,
        singlePicture: unit.singlePicture,
        authorUnits,
        openerTemplate,
        cueRange: unit.cueRange,
        cues,
        label: unit.id,
        memberBeatCount: unit.memberBeatCount,
        previousTemplateId: unit.previousTemplateId,
        nextTemplateId: unit.nextTemplateId
      });
      let planning = inspection?.planning;
      if (includePlanning && inspection?.authorable && isExplainerTemplateId(unit.templateId)) {
        bodyTiming ??= bodyRuntimeTimingForAuthorUnits({ authorUnits, cues });
        const segment = bodyTiming.segments.find(item => item.id === unit.id);
        planning = { viewingWindow: explainerViewingWindow({ segment, transitions: bodyTiming.transitions }) };
      }
      inspections.push({
        id: unit.id,
        templateId: unit.templateId,
        authorable: inspection?.authorable === true,
        ...(includePlanning && planning ? { planning } : {}),
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
  const errors = directorAuthorabilityErrors(inspections);
  let editWindows = [];
  if (!errors.length) {
    try {
      bodyTiming ??= bodyRuntimeTimingForAuthorUnits({ authorUnits, cues });
      editWindows = bodyEditWindows(bodyTiming.transitions);
      errors.push(...bodyEditOverlapErrors(editWindows));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { units: inspections, editWindows, errors };
};

const directorAuthorabilityErrors = (inspections) => inspections.flatMap((inspection) => {
  if (inspection.error) {
    return [`${inspection.id} 的 ${inspection.templateId} 可创作性核验失败: ${inspection.error}`];
  }
  return inspection.authorable
    ? []
    : [`${inspection.id} 的真实字幕范围无法由 ${inspection.templateId} 创作${inspection.reason ? `: ${inspection.reason}` : ""}`];
});
