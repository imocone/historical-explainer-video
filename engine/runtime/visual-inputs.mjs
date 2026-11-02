import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  compileVisualStylePrompt,
  drawingStyleForTemplate,
  productionProfileForKind,
  visualReferenceInstruction
} from "../../packages/visual-package.mjs";
import { getStageWorkPaths } from "../../packages/workspace-paths.mjs";
import { assertProjectPath, hashObject, readData, sha256 } from "../../packages/program-utils.mjs";
import { businessContent } from "./storyboard.mjs";
const sourceAssetsDigest = (inspected) => hashObject(inspected.sourceAssets ?? []);

const videoVisualContext = (visualPackage) => {
  const profile = productionProfileForKind(visualPackage, "fullframe-image");
  return { id: visualPackage.id, profileId: profile.profileId,
    stylePrompt: compileVisualStylePrompt(profile.style, { includeTypography: false }) };
};


const coverVisualContext = (visualPackage) => {
  const profile = productionProfileForKind(visualPackage, "cover-image");
  return {
    id: visualPackage.id,
    version: visualPackage.version,
    coverDigest: profile.profileDigest,
    profileId: profile.profileId,
    stylePrompt: compileVisualStylePrompt(profile.style, { includeTypography: false }),
    fontPrompt: profile.fontPrompt,
    references: profile.references.map((reference, index) => ({
      id: reference.id,
      absolutePath: reference.absolutePath,
      sha256: reference.sha256,
      instruction: visualReferenceInstruction(reference, index + 1)
    }))
  };
};

const renderSubtitleFont = (visualPackage) => {
  const subtitle = visualPackage.renderTokens.p4.subtitle.font;
  if (!subtitle) throw new Error(`${visualPackage.id} 缺少 P4 正式字幕字体资源`);
  return {
    family: subtitle.family,
    path: subtitle.file,
    sha256: subtitle.sha256,
    weight: subtitle.weight,
    format: subtitle.format,
    style: subtitle.style
  };
};

const renderVisualContext = (visualPackage) => {
  const subtitleFont = renderSubtitleFont(visualPackage);
  return {
    id: visualPackage.id,
    version: visualPackage.version,
    renderDigest: visualPackage.renderDigest,
    subtitleFont,
    renderTokens: {
      shared: visualPackage.renderTokens.shared,
      p4: {
        ...visualPackage.renderTokens.p4,
        subtitle: {
          primaryColor: visualPackage.renderTokens.p4.subtitle.primaryColor,
          outlineColor: visualPackage.renderTokens.p4.subtitle.outlineColor,
          shadowColor: visualPackage.renderTokens.p4.subtitle.shadowColor,
          fontName: subtitleFont.family,
          fontWeight: subtitleFont.weight,
          fontFormat: subtitleFont.format,
          fontStyle: subtitleFont.style
        }
      }
    }
  };
};

const authorVisualContext = (visualPackage, templateId) => ({
  id: visualPackage.id,
  drawingStyle: structuredClone(drawingStyleForTemplate(visualPackage.renderTokens, templateId))
});

export {
  videoVisualContext,
  authorVisualContext,
  coverVisualContext,
  renderVisualContext,
  sourceAssetsDigest
};
