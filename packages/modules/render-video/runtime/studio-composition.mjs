import { sceneSourceWindow } from "./scene-clock.mjs";

export const prepareStudioComposition = ({ indexHtml, entryHtml, composition, previewHtml,
  extractStandaloneEntryFromIndex, parseSourceDocument, prepareFlattenedInnerRoot }) => {
  if (!composition || composition === "index.html") return null;
  const index = parseSourceDocument(indexHtml).document;
  const data = index.getElementById("composition-data");
  if (!data) return null;
  const metadata = JSON.parse(data.textContent);
  const normalize = file => file.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const sourcePath = normalize(composition);
  const host = [...index.querySelectorAll("[data-composition-src]")]
    .find(element => normalize(element.getAttribute("data-composition-src")) === sourcePath);
  const scene = metadata.timeline.scenes.find(scene => scene.id === host?.id
    || sourcePath === `compositions/${scene.id}.html`);
  const captions = host?.id === "captions" || sourcePath === "compositions/captions.html";
  if (!scene && !captions) return null;
  const html = extractStandaloneEntryFromIndex(indexHtml, composition, entryHtml);
  if (!html) throw new Error(`Studio子场景未挂载到当前项目: ${composition}`);
  const document = parseSourceDocument(html).document;
  const duration = host?.getAttribute("data-duration");
  if (Number.isFinite(Number(duration)) && Number(duration) > 0)
    document.querySelector("body > [data-composition-id]")?.setAttribute("data-duration", duration);
  if (previewHtml) {
    const preview = parseSourceDocument(previewHtml).document;
    const source = preview.body.querySelector("[data-composition-id]");
    const mounted = document.getElementById(host.id);
    if (!source || !mounted) throw new Error(`Studio子场景缺少原生内容: ${composition}`);
    document.head.innerHTML = preview.head.innerHTML;
    mounted.innerHTML = prepareFlattenedInnerRoot(source).outerHTML;
    mounted.setAttribute("data-composition-file", composition);
    mounted.removeAttribute("data-composition-src");
    for (const child of preview.body.children) {
      if (child !== source && !child.contains(source)) document.body.append(child.cloneNode(true));
    }
  }
  if (scene) {
    const window = sceneSourceWindow(scene, metadata.timeline);
    metadata.timeline.fromFrame = window.startFrame;
    metadata.timeline.toFrame = window.endFrame;
  }
  metadata.timeline.scenes = scene ? [scene] : [];
  metadata.props.transitions = [];
  // Outer trim stays in HY's host attributes; the source window must not add it again.
  const script = document.createElement("script");
  script.id = "composition-data";
  script.type = "application/json";
  script.textContent = JSON.stringify(metadata).replace(/</gu, "\\u003c");
  document.body.append(script);
  return document.toString();
};
