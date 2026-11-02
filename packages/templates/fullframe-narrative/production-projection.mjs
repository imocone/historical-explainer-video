import { projectTreatmentWithoutCallouts } from "./callout/projection.mjs";

export const projectAssetPlanTreatment = (treatment) => {
  const { incomingTransition: _transition, ...projected } = projectTreatmentWithoutCallouts(treatment);
  return {
    ...projected,
    assetRequests: (projected.assetRequests ?? []).map(({
      cameraRelation: _cameraRelation,
      incomingTransition: _incomingTransition,
      effects: _effects,
      effectAnchors: _effectAnchors,
      asset: _asset,
      ...request
    }) => {
      const { speedRatio: _speedRatio, speedChanges: _speedChanges, ...motion } = request.motion;
      return { ...request, motion };
    }),
  };
};
