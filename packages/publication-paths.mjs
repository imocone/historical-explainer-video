import path from "node:path";

import { assertTargetId, getEpisodePaths } from "./workspace-paths.mjs";

export const getPublicationPaths = (workspaceRoot, episodeId, targetId) => {
  assertTargetId(targetId);
  if (targetId !== "release-main") {
    throw new Error(`唯一发布内容包必须是 release-main: ${targetId}`);
  }
  const episodePaths = getEpisodePaths(workspaceRoot, episodeId);
  const publication = path.join(episodePaths.p1, targetId);
  // Read-only observation of the standalone publisher's existing state. This
  // is not a production stage, and the Engine never creates publish intents.
  const release = path.join(episodePaths.production, 'p5', targetId);
  return {
    ...episodePaths,
    subjectRoot: publication,
    workRoot: episodePaths.p1,
    publication,
    release,
    targetRequest: path.join(release, "request.yaml"),
    publicationDocument: path.join(publication, "publication.yaml"),
    publicationText: path.join(episodePaths.output, "publication.txt"),
    coverYoutube: path.join(episodePaths.output, "cover-youtube.png"),
    coverVertical: path.join(episodePaths.output, "cover-vertical.png"),
    coverReceipt: path.join(publication, "cover-receipt.yaml"),
    receipts: path.join(release, "receipts")
  };
};
