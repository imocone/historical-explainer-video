export const documentaryOpenerShots = (treatment) => [
  ...(treatment?.memoryShots ?? []),
  ...(treatment?.hero ? [treatment.hero] : [])
];

export const bodyAssetReferencesForTreatment = ({ treatment }) => (
  (treatment?.memoryShots ?? []).map((shot) => ({
    requestId: shot.id,
    segmentId: shot.bodyRefs[0],
    sourceRequestId: shot.requestId
  }))
);
export const GENERATED_HERO_REQUEST_ID = "AR001";
