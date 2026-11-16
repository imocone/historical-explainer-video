import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {hashObject} from '../../program-utils.mjs';
import {compileVisualStylePrompt, productionProfileForKind, visualReferenceInstruction} from '../../visual-package.mjs';

export function imageRolePalette({background, paper, ink, ...roles}, visualBrief) {
  const references = JSON.stringify(visualBrief).matchAll(/var\(\s*--([\w-]+)\s*\)/gu);
  const usedRoles = new Set(Array.from(references, match => match[1]));
  return Object.fromEntries([...usedRoles].sort().map(role => {
    if (!Object.hasOwn(roles, role)) throw new Error(`图片蓝图引用了未定义的图文角色色 ${role}`);
    return [role, roles[role].toLowerCase()];
  }));
}

export const imageAppearanceDigest = ({source, art, tone, palette}) => hashObject({source, art, tone, palette});

export function programDrawingFor(visualPackage) {
  const profile = productionProfileForKind(visualPackage, 'fullframe-image');
  const references = profile.references.map(reference => ({
    ...reference, styleScopes: reference.styleScopes.filter(scope => scope !== 'palette' && scope !== 'typography-shape')
  })).filter(reference => reference.styleScopes.length);
  return {id: visualPackage.id, profileId: profile.profileId,
    stylePrompt: compileVisualStylePrompt(profile.style, {includeTypography: false, artworkOnly: true}),
    references: references.map((reference, index) => ({id: reference.id,
      absolutePath: reference.absolutePath, sha256: reference.sha256,
      instruction: visualReferenceInstruction(reference, index + 1, {artworkOnly: true})}))};
}

// The signed work order may still hold the drawing input used for an existing call.
// Use it only to recover that call, and only while the actual Visual and references agree.
export function recordedProgramDrawingFor(visualPackage, recorded) {
  const profile = productionProfileForKind(visualPackage, 'fullframe-image');
  if (recorded?.id !== visualPackage.id || recorded.profileId !== profile.profileId
    || typeof recorded.stylePrompt !== 'string' || !recorded.stylePrompt || recorded.references?.length !== profile.references.length
    || !profile.references.every((ref, i) => ['id', 'absolutePath', 'sha256'].every(key => ref[key] === recorded.references[i]?.[key]))) return null;
  return recorded;
}

export async function imageProfileFor(appearance, programDrawing) {
  if (appearance?.source !== 'vox-explainer' || appearance.art !== 'editorial-cutout')
    throw new Error('图片需要当前Vox讲解外观');
  const parts = (await readFile(new URL('./references/art.md', import.meta.url), 'utf8')).split(/(?=^## )/m);
  const choices = {general: '人物、器物与普通情境', terrain: '空间地形'};
  const sectionFor = title => {
    const section = parts.find(part => part.startsWith(`## ${title}\n`));
    if (!section) throw new Error(`Vox画法缺少${title}`);
    return section.trim();
  };
  if (programDrawing) {
    return {...appearance, digest: imageAppearanceDigest(appearance), visualPackageId: programDrawing.id,
      styles: Object.fromEntries(Object.entries(choices).map(([kind, title]) => [kind, {
        references: programDrawing.references,
        stylePrompt: [`节目画风：${programDrawing.id}`, programDrawing.stylePrompt,
          ...programDrawing.references.map(reference => reference.instruction),
          '独立图件按蓝图自然收口，不从画风参考补整屏场景或底板；需要运动时保留活动部件与随后露出的结构。画风图不提供地理证据。',
          sectionFor(title).split('\n\n').filter(part => !part.startsWith('[人物与器物实图]')).join('\n\n')
        ].join('\n\n')
      }]))};
  }
  // This profile is only used to verify and recover a pre-existing API call.
  const headers = Object.values(choices).map(title => `## ${title}\n`);
  const common = parts.filter(part => !headers.some(header => part.startsWith(header))
    && !part.startsWith('## 节目画风参考\n')
    && !part.startsWith('## SVG、标注与排字\n'));
  const styles = Object.fromEntries(Object.entries(choices).map(([kind, title]) => {
    const section = sectionFor(title);
    return [kind, {
      references: ['comic-terrain.png', ...(kind === 'general' ? ['comic-figures.png'] : [])]
        .map(file => ({absolutePath: fileURLToPath(new URL(`./references/${file}`, import.meta.url))})),
      stylePrompt: [...common, section,
        ...(kind === 'general' ? [
          '第1张参考图提供共同画风。第2张参考图只补充人物、器物的比例、体块、衣物结构与手物接触；不继承其中的人物身份、时代衣装、厚纸边、背景环境、站姿或静态构图。主体、姿态与构图按本件蓝图，纯器物图不因参考中有人而增加人物。'
        ] : [])].map(part => part.trim()).join('\n\n')
    }];
  }));
  return {...appearance, digest: imageAppearanceDigest(appearance), styles};
}
