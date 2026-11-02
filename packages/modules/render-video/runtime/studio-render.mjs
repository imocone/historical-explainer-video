import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { prepareStudioComposition } from './studio-composition.mjs';

export const installStudioCompositionPreview = (adapter, { extractStandaloneEntryFromIndex, parseHTMLContent, prepareFlattenedInnerRoot }) => {
  const transform = adapter.transformPreviewHtml;
  adapter.transformPreviewHtml = async input => {
    let html = input.html;
    const composition = input.activeCompositionPath;
    if (composition && composition !== 'index.html') {
      const [indexHtml, entryHtml] = await Promise.all([
        readFile(path.join(input.project.dir, 'index.html'), 'utf8'),
        readFile(path.join(input.project.dir, composition), 'utf8')
      ]);
      html = prepareStudioComposition({ indexHtml, entryHtml, composition, previewHtml: html,
        extractStandaloneEntryFromIndex, prepareFlattenedInnerRoot,
        parseSourceDocument: source => ({ document: parseHTMLContent(source) }) }) ?? html;
    }
    return transform.call(adapter, { ...input, html });
  };
};

export const createStudioProject = (runtime, projectDirectory) => {
  const native = runtime.createStudioServer({ projectDir: projectDirectory, projectName: path.basename(projectDirectory) });
  installStudioCompositionPreview(native.adapter, runtime);
  return native;
};
