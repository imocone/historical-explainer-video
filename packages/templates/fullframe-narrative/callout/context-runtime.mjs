const locateBoundary = ({ beats, beforeBeatId }) => {
  const boundary = (beats ?? []).findIndex((beat) => beat.id === beforeBeatId);
  if (boundary < 0) throw new Error(`全画幅解说框上下文找不到当前 Beat: ${beforeBeatId}`);
  return boundary;
};

const projectPriorCueIndex = ({ beats, beforeBeatId, episodeCues }) => {
  const boundary = locateBoundary({ beats, beforeBeatId });
  const firstCueId = beats[boundary]?.cueRange?.[0];
  const cueBoundary = (episodeCues ?? []).findIndex((cue) => String(cue.id) === String(firstCueId));
  if (cueBoundary < 0) throw new Error(`全画幅解说框上下文找不到当前 Beat 首条字幕: ${firstCueId}`);
  return episodeCues.slice(0, cueBoundary).map((cue) => ({
    id: cue.id,
    text: cue.text
  }));
};

const calloutIdentity = ({ beatId, callout }) => {
  if (callout?.kind === "person-intro") {
    return {
      beatId,
      kind: callout.kind,
      people: (callout.people ?? []).map((person) => person.name)
    };
  }
  if (callout?.kind === "term-gloss") {
    return { beatId, kind: callout.kind, term: callout.term };
  }
  if (callout?.kind === "historical-quote") {
    return {
      beatId,
      kind: callout.kind,
      ...(callout.request
        ? { request: callout.request }
        : { text: callout.text, citation: callout.citation })
    };
  }
  return null;
};

const projectPriorCallouts = ({ beats, beforeBeatId }) => {
  const boundary = locateBoundary({ beats, beforeBeatId });
  return beats.slice(0, boundary).flatMap((beat) => {
    const treatment = beat.treatment;
    if (treatment?.templateId !== "fullframe-narrative") return [];
    return (treatment.assetRequests ?? []).flatMap((request) =>
      (request.callouts ?? [])
        .map((callout) => calloutIdentity({ beatId: beat.id, callout }))
        .filter(Boolean)
    );
  });
};

export const projectCalloutAuthorContext = ({
  programPlan,
  episodeCues,
  beats,
  beforeBeatId
}) => ({
  ...(programPlan?.researchLibrary?.notebookId
    ? { notebookId: programPlan.researchLibrary.notebookId }
    : {}),
  priorCueIndex: projectPriorCueIndex({
    episodeCues,
    beats,
    beforeBeatId
  }),
  priorCallouts: projectPriorCallouts({ beats, beforeBeatId })
});
