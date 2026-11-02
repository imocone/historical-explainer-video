import path from "node:path";

import { assertTargetId, getEpisodePaths } from "./workspace-paths.mjs";

export const getPublicationPaths = (workspaceRoot, episodeId, targetId) => {
  assertTargetId(targetId);
  if (targetId !== "release-main") {
    throw new Error(`P4 唯一发布包必须是 release-main: ${targetId}`);
  }
  const episodePaths = getEpisodePaths(workspaceRoot, episodeId);
  const publication = path.join(episodePaths.p1, targetId);
  const release = path.join(episodePaths.p4, targetId);
  return {
    ...episodePaths,
    subjectRoot: publication,
    workRoot: episodePaths.p1,
    publication,
    release,
    platformWorkRoots: Object.fromEntries(["youtube", "xiaohongshu", "douyin"].map((platform) =>
      [platform, path.join(release, platform)])),
    targetRequest: path.join(release, "request.yaml"),
    publicationDocument: path.join(publication, "publication.yaml"),
    publicationText: path.join(episodePaths.output, "publication.txt"),
    coverYoutube: path.join(episodePaths.output, "cover-youtube.png"),
    coverVertical: path.join(episodePaths.output, "cover-vertical.png"),
    coverReceipt: path.join(publication, "cover-receipt.yaml"),
    receipts: path.join(release, "receipts")
  };
};
