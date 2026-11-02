import { withoutProducer } from "../../../program-utils.mjs";
import { projectRhetoricalBoundaries } from "../../author-beat/projection.mjs";

export const featureIdsFromAssembly = (assembly) => [...new Set(
  (assembly?.slots ?? []).flatMap((slot) => slot.implementations ?? [])
    .filter((implementation) => implementation.kind === "feature")
    .map((implementation) => implementation.packageId)
)].sort();

export const projectRenderStoryboard = (storyboard, featureIds = []) => {
  const renderTreatment = (treatment, cueRange) => withoutProducer(treatment?.templateId === "vox-explainer"
    ? projectRhetoricalBoundaries(treatment, {semanticContext: storyboard.understanding, cueRange})
    : treatment);
  const features = Object.fromEntries(featureIds
    .filter((featureId) => Object.hasOwn(storyboard.features ?? {}, featureId))
    .map((featureId) => [featureId, withoutProducer(storyboard.features[featureId])]));
  return {
    beats: (storyboard.beats ?? []).map((beat) => ({
      id: beat.id,
      cueRange: withoutProducer(beat.cueRange),
      templateId: beat.templateId,
      treatment: renderTreatment(beat.treatment, beat.cueRange)
    })),
    templateRuns: (storyboard.templateRuns ?? []).filter(run => run.templateId !== "fullframe-narrative").map((run) => ({
      id: run.id,
      templateId: run.templateId,
      beatIds: [...run.beatIds],
      treatment: renderTreatment(run.treatment, [
        storyboard.beats.find(beat => beat.id === run.beatIds[0])?.cueRange[0],
        storyboard.beats.find(beat => beat.id === run.beatIds.at(-1))?.cueRange[1]
      ])
    })),
    ...(Object.keys(features).length ? { features } : {}),
    ...(Object.hasOwn(storyboard, "opener") ? { opener: withoutProducer(storyboard.opener) } : {})
  };
};
