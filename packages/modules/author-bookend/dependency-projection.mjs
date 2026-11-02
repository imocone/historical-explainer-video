const openerShots = (result) => (
  ["episode-opener", "crossfire-opener", "opposed-opener", "glass-opener"].includes(result?.templateId)
    ? result.flashbackShots
    : result?.templateId === "documentary-opener"
      ? [...(result.memoryShots ?? []), ...(result.hero ? [result.hero] : [])]
      : []
);

export const openerBodyRefs = (result) => [...new Set(
  (openerShots(result) ?? []).flatMap((shot) => shot.bodyRefs ?? [])
)];

export const projectAcceptedOpenerBodyDependencies = ({ bodyStoryboard, result }) => {
  const selectedBeatIds = new Set(openerBodyRefs(result));
  const beats = (bodyStoryboard?.beats ?? []).filter((beat) => selectedBeatIds.has(beat.id));
  const templateRuns = (bodyStoryboard?.templateRuns ?? []).filter((run) => (
    run.templateId !== "fullframe-narrative" && (run.beatIds ?? []).some((beatId) => selectedBeatIds.has(beatId))
  ));
  return { beats, templateRuns };
};
