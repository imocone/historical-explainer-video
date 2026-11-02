import { resolveCueRange } from "../../cue-boundaries.mjs";

export const cueSlice = (cues, range) => resolveCueRange({
  cueRange: range,
  cues
}).cues;

export const projectAuthorBeat = (beat) => {
  const {
    treatment: _treatment,
    _producer,
    ...directorBeat
  } = beat;
  return directorBeat;
};

export const projectAuthorUnitBeats = ({ beats, cues }) => (beats ?? []).map((beat) => {
  const directorBeat = projectAuthorBeat(beat);
  return {
    ...directorBeat,
    cues: cueSlice(cues, directorBeat.cueRange)
  };
});

export const projectBeatSemantics = ({ understanding, beat, cues }) => {
  const cueIds = new Set(cueSlice(cues, beat.cueRange).map((cue) => String(cue.id)));
  const overlapsBeat = (cueRefs) => cueRefs.some((id) => cueIds.has(String(id)));
  const facts = understanding.facts.filter((item) => overlapsBeat(item.cueRefs));
  const relations = understanding.relations.filter((item) => overlapsBeat(item.cueRefs));
  const semanticReading = {
    underlyingMeaning: understanding.semanticReading.underlyingMeaning,
    audienceStartingPoint: understanding.semanticReading.audienceStartingPoint,
    targetUnderstanding: understanding.semanticReading.targetUnderstanding,
    speakerStances: understanding.semanticReading.speakerStances.filter((item) => overlapsBeat(item.cueRefs)),
    contextConstraints: understanding.semanticReading.contextConstraints.filter((item) => overlapsBeat(item.cueRefs)),
    rhetoricalReadings: understanding.semanticReading.rhetoricalReadings.filter((item) => overlapsBeat(item.cueRefs)),
    humanStakes: understanding.semanticReading.humanStakes.filter((item) => overlapsBeat(item.cueRefs))
  };
  const evidenceRefs = new Set([
    ...facts.flatMap((item) => item.evidenceRefs),
    ...relations.flatMap((item) => item.evidenceRefs),
    ...semanticReading.rhetoricalReadings.flatMap((item) => item.evidenceRefs),
    ...semanticReading.humanStakes.flatMap((item) => item.evidenceRefs)
  ]);
  return {
    episodeQuestion: understanding.episodeQuestion,
    thesis: understanding.thesis,
    narrativeArc: understanding.narrativeArc,
    semanticReading,
    facts,
    relations,
    evidence: understanding.evidence.filter((item) => evidenceRefs.has(item.id)),
    uncertainties: understanding.uncertainties,
    mustNotInvent: understanding.mustNotInvent
  };
};

export const projectAuthorUnitSemantics = ({ understanding, beats, cues }) => {
  if (!Array.isArray(beats) || beats.length < 1) {
    throw new Error("Author 创作单位至少需要一个正式 Beat");
  }
  const first = beats[0];
  const last = beats.at(-1);
  return projectBeatSemantics({
    understanding,
    cues,
    beat: { cueRange: [first.cueRange[0], last.cueRange[1]] }
  });
};

export const projectAuthorUnitDirection = ({ albumPlan, beats }) => {
  if (!albumPlan || !Array.isArray(albumPlan.recurringElements)) {
    throw new Error("Author 缺少已接纳的 albumPlan");
  }
  if (!Array.isArray(beats) || beats.length < 1) {
    throw new Error("Author 视觉投影至少需要一个正式 Beat");
  }
  const beatIds = new Set(beats.map((beat) => beat.id));
  const relevantRecurringElements = albumPlan.recurringElements.filter((element) => (
    (element.beatRefs ?? []).some((beatId) => beatIds.has(beatId))
  ));
  return {
    albumPlan: {
      intent: albumPlan.intent,
      openingState: albumPlan.openingState,
      progression: albumPlan.progression,
      endingState: albumPlan.endingState
    },
    beats: beats.map(({ id, viewerOutcome, directorBrief }) => ({
      id,
      viewerOutcome,
      directorBrief
    })),
    relevantRecurringElements
  };
};

// Derive production constraints without writing inherited text into the author's design.
export const projectRhetoricalBoundaries = (treatment, context) => {
  const semantic = context.semanticContext ?? {};
  const semanticById = new Map([
    ...(semantic.facts ?? []), ...(semantic.relations ?? []), ...(semantic.evidence ?? [])
  ].map((item) => [item.id, item]));
  const currentCues = new Set((context.cues ?? []).map((cue) => cue.id));
  const includesCue = (id) => Array.isArray(context.cues) ? currentCues.has(id)
    : Array.isArray(context.cueRange) && id >= context.cueRange[0] && id <= context.cueRange[1];
  const readings = (semantic.semanticReading?.rhetoricalReadings ?? [])
    .filter((reading) => (reading.cueRefs ?? []).some(includesCue));
  const assetRequests = treatment.assetRequests.map((request) => {
    const refs = new Set(request.sourceRefs);
    const cueRefs = new Set(request.sourceRefs.flatMap((ref) => (
      /^C[0-9]+$/u.test(ref) ? [Number(ref.slice(1))] : semanticById.get(ref)?.cueRefs ?? []
    )).filter(includesCue));
    const inherited = readings.filter((reading) => (
      (reading.cueRefs ?? []).some((ref) => cueRefs.has(ref))
      || (reading.evidenceRefs ?? []).some((ref) => refs.has(ref))
    )).map((reading) => reading.prohibitedLiteralization).filter(Boolean);
    return { ...request, mustNotInvent: [...new Set([...request.mustNotInvent, ...inherited])] };
  });
  return { ...treatment, assetRequests };
};
