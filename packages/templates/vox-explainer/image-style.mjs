import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {hashObject} from '../../program-utils.mjs';

export const imageRolePalette = ({background, paper, ink, ...roles}) => roles;

export const imageAppearanceDigest = ({source, art, tone, palette}) => hashObject({source, art, tone, palette});

export async function imageProfileFor(appearance) {
  if (appearance?.source !== 'vox-explainer' || appearance.art !== 'editorial-cutout')
    throw new Error('图片需要当前Vox讲解外观');
  const roleColors = imageRolePalette(appearance.palette);
  const parts = (await readFile(new URL('./references/art.md', import.meta.url), 'utf8')).split(/(?=^## )/m);
  const choices = {general: '人物、器物与普通情境', terrain: '空间地形'};
  const headers = Object.values(choices).map(title => `## ${title}\n`);
  const common = parts.filter(part => !headers.some(header => part.startsWith(header))
    && !part.startsWith('## SVG、标注与排字\n'));
  const styles = Object.fromEntries(Object.entries(choices).map(([kind, title]) => {
    const section = parts.find(part => part.startsWith(`## ${title}\n`));
    if (!section) throw new Error(`Vox画法缺少${title}`);
    return [kind, {
      references: ['comic-terrain.png', ...(kind === 'general' ? ['comic-figures.png'] : [])]
        .map(file => ({absolutePath: fileURLToPath(new URL(`./references/${file}`, import.meta.url))})),
      stylePrompt: [...common, section,
        ...(kind === 'general' ? [
          '第1张参考图提供共同画风。第2张参考图只补充人物、器物的比例、体块、衣物结构与手物接触；不继承其中的人物身份、时代衣装、厚纸边、背景环境、站姿或静态构图。主体、姿态与构图按本件蓝图，纯器物图不因参考中有人而增加人物。'
        ] : [])].map(part => part.trim()).join('\n\n')
        + `\n图文角色色：${JSON.stringify(roleColors)}；仅用于对应角色和图形，实物材质保留本色。模板底板颜色不作为物体配色，也不画入透明图件。`
    }];
  }));
  return {...appearance, digest: imageAppearanceDigest(appearance), styles};
}
