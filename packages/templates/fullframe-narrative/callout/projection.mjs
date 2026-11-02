export const projectTreatmentWithoutCallouts = (treatment) => {
  const { calloutGate: _calloutGate, ...projected } = treatment;
  return {
    ...projected,
    assetRequests: (treatment.assetRequests ?? []).map(({ callouts: _callouts, ...request }) => request)
  };
};
