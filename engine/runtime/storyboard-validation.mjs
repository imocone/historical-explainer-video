import { inspectP3Input } from "../p3-input.mjs";
import { enabledFeatureIdsForNode } from "./storyboard.mjs";
import { featureAdapter } from "./implementations.mjs";

export const inspectP3Inputs = (root, workspaceRoot, episodeId) => inspectP3Input({ root: workspaceRoot, episodeId });

export const missingAuthorFeatures = async ({ root, assembly, storyboard, authorUnit }) => {
  const missing = [];
  for (const featureId of enabledFeatureIdsForNode({ assembly, features: storyboard.features })) {
    const adapter = await featureAdapter({ root, assembly, featureId });
    const result = adapter.readResult({ storyboard, scope: { featureId, authorUnitId: authorUnit.id, unitId: authorUnit.id, beatId: authorUnit.id } });
    if (!result) missing.push(featureId);
  }
  return missing;
};
