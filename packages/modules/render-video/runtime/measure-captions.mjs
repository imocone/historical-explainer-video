import {assetFile} from '../../../runtime-config.mjs';
import path from "node:path";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withBrowserSession } from "./browser-session.mjs";
import { loadProgramVisualPackage } from "../../../visual-package.mjs";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { CaptionContent } from "./caption-content.mjs";

export const measureCaptions = async ({ systemRoot, workspaceRoot, cues }) => {
  const visual = await loadProgramVisualPackage(systemRoot, workspaceRoot, { roles: ["render"] });
  const font = visual.renderTokens.p4.subtitle.font;
  const appearance = visual.renderTokens.p4.subtitle;
  const subtitle = { fontName: font.family, fontWeight: font.weight, fontStyle: font.style,
    primaryColor: appearance.primaryColor, outlineColor: appearance.outlineColor, shadowColor: appearance.shadowColor };
  const markup = cues.map(({ text }) => renderToStaticMarkup(React.createElement(CaptionContent, { text, subtitle })));
  const fontData = (await readFile(assetFile(path.resolve(visual.directory, font.file)))).toString("base64");
  return withBrowserSession(async session => {
    const browser = await session.browser();
    const page = await browser.newPage();
    await page.setViewport({ width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, deviceScaleFactor: 1 });
    const layouts = await page.evaluate(async (html, font, fontData, spec) => {
      const face = new FontFace(font.family, `url(data:font/${font.format};base64,${fontData}) format("${font.format}")`,
        { weight: String(font.weight), style: font.style });
      document.fonts.add(await face.load());
      await document.fonts.ready;
      document.body.style.margin = "0";
      const container = document.createElement("div");
      Object.assign(container.style, { width: `${spec.width}px`, height: `${spec.height}px`,
        display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" });
      document.body.append(container);
      return html.map((content) => {
        container.innerHTML = content;
        const box = container.firstElementChild;
        const bounds = box.getBoundingClientRect();
        const lines = [];
        let overflow = bounds.top < 0 || bounds.bottom > spec.height;
        for (const span of box.querySelectorAll("[data-caption-word]")) {
          const node = span.firstChild;
          const rect = span.getBoundingClientRect();
          overflow ||= rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5;
          if (!node) continue;
          let line = lines.find((item) => Math.abs(item.top - rect.top) < 0.5);
          if (!line) { line = { top: rect.top, text: "" }; lines.push(line); }
          line.text += node.textContent;
        }
        return { lineCount: lines.length, lines: lines.map(({ text }) => text), overflow };
      });
    }, markup, font, fontData, { width: VIDEO_SPEC.width, height: VIDEO_SPEC.height });
    return { visualPackageId: visual.id, font: { family: font.family, sha256: font.sha256,
      weight: font.weight, style: font.style }, width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, layouts };
  });
};
