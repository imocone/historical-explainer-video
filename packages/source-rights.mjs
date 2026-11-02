export const EXTERNAL_PRODUCTION_RIGHTS = Object.freeze([
  "public-domain",
  "licensed",
  "permission-granted"
]);

const externalProductionRights = new Set(EXTERNAL_PRODUCTION_RIGHTS);

export const canUseSourceForExternalProduction = (rightsStatus) => (
  externalProductionRights.has(rightsStatus)
);

export const assertSourceRightsForExternalProduction = ({ rightsStatus, label = "来源资产" }) => {
  if (!canUseSourceForExternalProduction(rightsStatus)) {
    throw new Error(`${label} 权利状态不可用于外部生产: ${rightsStatus ?? "missing"}`);
  }
  return rightsStatus;
};
