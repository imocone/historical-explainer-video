const assetReference = /\basset:(AR\d{3})\b/g;
export const markupAssetIds = markup => [...new Set([...markup.matchAll(assetReference)].map(match => match[1]))];
export const resolveMarkupAssets = (markup, assets, urlFor) => markup.replace(assetReference, (_, id) => {
  const asset = assets.get(id);
  if (!asset) throw new Error(`讲解画面缺少图片 ${id}`);
  return urlFor(asset).replace(/[\s"'()<>]/g, char => encodeURIComponent(char)
    .replace(/['()]/g, value => `%${value.charCodeAt(0).toString(16)}`));
});

const parameters = ['root', 'select', 'gsap', 'timeline', 'cue', 'onFrame', 'onCleanup', 'assets', 'width', 'height', 'fps', 'duration', 'spatial', 'THREE', 'eventTime'];
export const compileAnimation = source => new Function(...parameters, `"use strict";\n${source}`);
export const runAnimation = (source, api) => compileAnimation(source)(...parameters.map(key => api[key]));

// Picture events remain available when the optional sound layer is silent or disabled.
export const resolveSceneEvents = ({scene, actionTimings, fps, durationInFrames}) => {
  const seen = new Set();
  return (scene?.events ?? []).map(event => {
    if (seen.has(event.id)) throw new Error(`讲解动作事件重复: ${event.id}`);
    seen.add(event.id);
    const anchor = actionTimings.find(item => item.target === event.target && item.action === 'advance-explainer');
    if (!anchor) throw new Error(`${event.id} 找不到讲解moment: ${event.target}`);
    const frame = anchor.frame + Math.round(event.offsetSeconds * fps);
    if (!Number.isInteger(frame) || frame < 0 || frame >= durationInFrames) throw new Error(`${event.id} 讲解动作事件超出本段`);
    return {id:event.id, frame};
  });
};
