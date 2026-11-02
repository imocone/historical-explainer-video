import { copyFile, link, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { visualFontEntries } from "../../../visual-fonts.mjs";
import { withMediaResources } from "./media-process.mjs";

import {
  assertProjectMutationTree,
  assertProjectPath,
  fileSha256
} from "../../../program-utils.mjs";

const publicFiles = (renderPlan) => {
  const files = new Set();
  for (const segment of [...renderPlan.segments, ...renderPlan.overlays]) {
    for (const asset of segment.assetRefs) files.add(asset.file);
    for (const file of segment.renderData?.resourceFiles ?? []) files.add(file);
  }
  for (const track of renderPlan.audioTracks) files.add(track.file);
  for (const [, font] of visualFontEntries(renderPlan.visualStyle)) {
    if (font?.publicPath) files.add(font.publicPath);
  }
  const subtitleFont = renderPlan.visualStyle?.p4?.subtitle?.fontPublicPath;
  if (subtitleFont) files.add(subtitleFont);
  return [...files].sort();
};

const sourceRootFor = ({ workspaceRoot, systemRoot, relative }) => (
  relative.startsWith("visuals/")
    || (relative.startsWith('local-media/background-music/') || relative.startsWith('local-media/private-assets/'))
    || (relative.startsWith("node_modules/maplibre-gl/dist/") || relative === "node_modules/maplibre-gl/LICENSE.txt")
    || relative.startsWith("packages/templates/")
    || relative.startsWith("packages/features/")
    ? systemRoot
    : workspaceRoot
);

export const prepareRenderPublic = options => withMediaResources(() => preparePublic(options), { directory: options.workspaceRoot });

async function preparePublic({
  workspaceRoot,
  systemRoot,
  episode,
  renderPlan,
  publicDirectory = path.join(episode, "制作", "p4", "_work", "public"),
  clear = true
}) {
  await assertProjectMutationTree({
    root: workspaceRoot,
    file: publicDirectory,
    label: "P4 公开资源写入树"
  });
  if (clear) await rm(publicDirectory, { recursive: true, force: true });
  for (const relative of publicFiles(renderPlan)) {
    try {
      if (
        typeof relative !== "string"
        || !relative
        || path.isAbsolute(relative)
        || relative.includes("\\")
      ) throw new Error(`P4 公开资源路径无效: ${relative ?? "missing"}`);
      const sourceRoot = sourceRootFor({ workspaceRoot, systemRoot, relative });
      const source = path.resolve(sourceRoot, relative);
      await assertProjectPath({
        root: sourceRoot,
        file: source,
        label: "P4 公开资源来源"
      });
      const destination = path.join(publicDirectory, ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await link(source, destination);
      } catch (error) {
        if (error.code === "EEXIST") {
          await assertProjectPath({root: publicDirectory, file: destination, label: "已准备渲染资源"});
          if (await fileSha256(source) !== await fileSha256(destination)) throw new Error(`已准备渲染资源与来源不一致: ${relative}`);
          continue;
        }
        if (!["EXDEV", "EPERM", "EACCES", "EMLINK", "ENOSYS"].includes(error?.code)) throw error;
        await copyFile(source, destination);
      }
    } catch (error) {
      if (renderPlan.audioTracks.some(track => track.file === relative)) error.audioPlaybackFailure = true;
      throw error;
    }
  }
  return publicDirectory;
}
