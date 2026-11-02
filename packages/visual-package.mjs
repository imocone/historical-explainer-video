import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {assetFile} from './runtime-config.mjs';
import Ajv2020 from "ajv/dist/2020.js";

import { assertProjectPath, fileSha256, hashObject, readData, sha256 } from "./program-utils.mjs";
import { visualFontEntries } from "./visual-fonts.mjs";
import { runMediaProcess } from "./modules/render-video/runtime/media-process.mjs";

const shaPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const imageKinds = [
  "fullframe-image",
  "bookend-image"
];
const allProfileKinds = [...imageKinds, "cover-image"];
const allRoles = new Set([
  "productionProfiles",
  "render"
]);
const styleScopeLabels = Object.freeze({
  palette: "配色与白平衡",
  linework: "轮廓线与内部线条",
  "fill-finish": "填色收束与非底材绘画质感",
  "surface-treatment": "画纸底材、纸纤维与吸墨质感",
  "environment-rendering": "环境形体与绘制方式",
  "character-proportion": "人体自身比例与造型画法，不含人物在画幅中的大小",
  "typography-shape": "文字字形外观"
});
const masterReferenceSpec = Object.freeze({
  artifactSpec: "fullframe-style-master-v1",
  styleScopes: Object.freeze([
    "palette",
    "linework",
    "fill-finish",
    "surface-treatment",
    "environment-rendering",
    "character-proportion"
  ]),
  width: 1536,
  height: 864
});
const styleValueLabels = Object.freeze({
  "historical-illustration": "历史叙事插画",
  "historical-comic": "历史漫画",
  "edo-ukiyo-e-warrior-print": "江户浮世绘武者绘木版画",
  "cinematic-ink-color-comic": "电影化国潮国漫水墨彩",
  "animated-scene-illustration": "有空间与自然光影的二维动画场景插画",
  "youth-manga": "青年向漫画",
  "mineral-ink-mural": "矿物墨彩壁画",
  "matte-flat-color": "哑光平涂",
  "layered-matte-color": "哑光色块结合克制的手绘色阶与材质层次",
  "controlled-matte-color": "受控哑光色面；以完整大色块为主，只用两至三级克制色阶塑造形体，不做单层赛璐璐平涂或连续写实渐变",
  "matte-mineral-ink": "哑光矿物墨彩",
  "clean-matte-fill": "纯净哑光色面",
  "subtle-painted-material": "色面干净，木石、金属、玻璃与植被用少量手绘细节区分材质",
  "subtle-bokashi-flat-fill": "鲜明但哑光的木版套色平涂与轻微bokashi晕染；保持稳定的色块与过渡画法，实际明暗服从当前场景光照",
  "subtle-mineral-pigment-variation": "轻微矿物色料颗粒层次",
  "minimal-planar": "少量平面明暗",
  "natural-cel-lighting": "按当前场景已定光照表达块面受光、投影与柔和环境光，保留明暗层次",
  "cinematic-block-chiaroscuro": "电影化大块冷暖明暗",
  "restrained-ink-wash": "克制墨彩明暗",
  none: "无纸张、画布或旧介质纹理",
  "washi-woodblock-grain": "冷白和纸纤维、细密低对比木版浮纹与轻微套色边缘；所有画面保持相同纸色与纹理尺度，不得随场景改变成高对比颗粒、污渍或破损裂纹",
  "neutral-xuan-paper": "中性灰白宣纸纤维、吸墨毛边与克制水痕；禁止暖黄纸底、旧纸污渍和破损裂纹",
  medium: "粗细适中",
  fine: "细而清楚",
  "medium-bold": "中等偏粗",
  "bold-graphic": "粗黑且清晰的图形主轮廓",
  "stable-deep-ink": "稳定深墨线",
  "stable-soft-deep-ink": "稳定且不过度锐利的深墨线",
  "light-responsive-colored": "与物体固有色及当前光照相融的彩色结构线，不统一围成黑边",
  "essential-only": "只保留辨识所需内部线",
  "restrained-structural": "节制的结构概括线",
  "natural-taper": "线端自然收束",
  "slight-hand-drawn-variation": "轻微手绘起伏",
  "dry-ink-edge-variation": "轻微干墨边缘变化",
  neutral: "中性白平衡",
  "warm-controlled": "受控暖色白平衡",
  "cool-controlled": "受控冷色白平衡",
  "yellow-brown-wash": "整幅黄褐罩染",
  "old-photo-sepia": "旧照片式棕黄色偏色",
  photorealism: "照片写实",
  "commercial-anime": "商业动漫",
  "ukiyo-e-imitation": "浮世绘仿作",
  "war-game-art": "战争游戏美术",
  "xianxia-art": "仙侠美术",
  "moe-large-eyes": "萌系大眼",
  "high-gloss-3d-rendering": "高光三维渲染",
  "plastic-gloss-rendering": "塑料高光渲染",
  "adult-semi-q-3.0-3.4-heads": "约3.0—3.4头身的成熟半Q成人比例",
  "adult-cartoon-5.0-5.5-heads": "约5—5.5头身的成熟轻Q成人比例：头明显略大、颈肩较窄，躯干与四肢适度缩短，保持成年人而非幼儿化",
  "adult-natural": "正常成年比例",
  "natural-individual-differences": "脸型、五官、发式和年龄特征保持自然差异",
  "mature-animated-illustration": "二维动画插画的成年人物，脸型与五官概括而有年龄和个体差异",
  "refined-japanese-musha-e": "参考母版式刀刻武者绘成年人物：青年男性整体英俊精悍，女性端庄灵动，年长者保留年龄与威严；英俊只约束成年比例、神态和造型完成度，不指定共同脸型或共同五官。每个不同人物独立设计，从脸型、五官间距、眉眼、鼻形、下颌、发际线、发式、胡须、年龄和体型中随机组合，至少三项明显不同；不得复用同一底脸再只换服装、发式或表情。面部仅一至两级平面明暗，不做大眼幼态、柔滑立体皮肤、亮面头发或商业动漫美型",
  "mature-chinese-comic": "成熟中国漫画脸型",
  "mature-guochao-guoman": "成熟国潮国漫人物，使用成年中国骨相、清楚眉眼鼻梁与下颌，禁止幼态仙侠脸和日式大眼动漫脸",
  "matte-flat": "哑光平涂",
  "cel-lit-matte": "哑光块面塑造人物，受光与阴影有克制的色阶，不做照片皮肤",
  "controlled-matte-tonal-planes": "受控哑光色阶；用两至三级清楚块面塑造人物，不做单层赛璐璐阴影、照片皮肤或连续写实渐变",
  "crisp-bokashi-flat": "鲜明木版套色平涂，所有形体以大色块完成，bokashi只作局部柔和过渡；边缘清楚，不做赛璐璐多层渐变、水彩或灰褐厚涂",
  "matte-mineral": "哑光矿物色面",
  "cinematic-cel-matte": "国漫赛璐璐大色块与克制半厚涂结合的哑光上色",
  "shared-linework": "沿用共享轮廓与结构线",
  "cinematic-everyday-scene": "二维手绘场景的可信透视、遮挡与空间层次，按既定内容概括建筑、自然形体及日常器物",
  "rounded-block-historical-comic": "略圆且粗块化的历史漫画形体",
  "cinematic-historical-comic": "电影化历史国漫画面体块",
  "xuan-paper-ink-wash-scene": "中性灰青宣纸细线淡彩水墨场景；按既定空间区分近中远层，人物与承重环境保持清透而密实的哑光色面，远层可用淡墨概括，不把近中景洗成灰白；衣袍和器物保留任务所需的可辨淡彩，木石用掺冷灰的中性灰褐，不铺全局暖黄旧纸滤镜；不用油画厚涂或照片式散景",
  "ukiyo-e-woodblock-scene": "浮世绘木版画的墨线、套色色块与局部晕染；建筑、船只和器物以有限平涂概括材质，保留既定历史结构、透视、遮挡和空间层次，不改写构图，不做照片式材质建模或散景",
  "digital-ukiyo-e-scene": "现代数字浮世绘的清晰墨线与完整哑光色面；建筑、船只和器物用少量必要结构线概括，保留既定历史结构、透视、遮挡和空间层次，不改写构图；不使用木刻排线、纸纹、颗粒、照片式材质建模或散景",
  "foreground-component-assembly": "与全画幅保持同等绘制完成度的前景讲解组件：人物群组、地图、剖面、文书、器物、局部建筑和局部事件都保留可辨造型、材质与必要内部空间，组件轮廓自然收口，不能画成悬空贴纸、同形图标或单薄人物剪贴",
  "shared-matte": "与人物共享哑光色面",
  "shared-ink-color-matte": "与人物共享干净哑光块面，水墨彩只用于环境大气和远景笔触",
  "shared-mineral-matte": "与人物共享矿物墨彩和哑光材质",
  "plain-print": "清楚平整的印刷字形",
  "modern-sans": "现代中文黑体外观",
  "brush-kai": "端正可读的毛笔楷书字形，保留字体本身的起收笔与字腔，不改成行草或挤扁拉长",
  "modern-bold-block": "端正规整、粗重醒目的现代中文无衬线黑体；字形方正独立、重心稳定、笔画完整清晰；禁止毛笔书法、狂草、行草、飞白、连笔、断笔和夸张艺术变形",
  regular: "常规字重",
  bold: "粗体",
  heavy: "特粗体",
  "flat-ink": "平面墨色质感"
});

const formatAjvErrors = (errors = []) => errors
  .map((error) => `${error.instancePath || "/"} ${error.message}`)
  .join("; ");

const assertObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
};

const assertExactKeys = (value, keys, label) => {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`${label} 含未声明字段: ${unexpected.join(", ")}`);
  }
};

const normalizeRelativePath = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 路径不能为空`);
  if (path.isAbsolute(value) || value.includes("\0")) throw new Error(`${label} 路径越界: ${value}`);
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    throw new Error(`${label} 路径越界: ${value}`);
  }
  return parts.filter((part) => part !== ".").join("/");
};

const ensureInside = (base, target, label) => {
  const relative = path.relative(base, target);
  if (relative === "") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 路径越界`);
  }
};

const resolveExistingFile = async (baseReal, relativePath, label) => {
  const normalized = normalizeRelativePath(relativePath, label);
  const resolved = path.resolve(baseReal, normalized);
  ensureInside(baseReal, resolved, label);
  await assertProjectPath({ root: baseReal, file: resolved, label });
  const actual = await realpath(resolved);
  ensureInside(baseReal, actual, label);
  const info = await stat(actual);
  if (!info.isFile() || info.size < 1) throw new Error(`${label} 不是非空文件: ${normalized}`);
  return { absolute: actual, relative: normalized };
};

const assertNoSymlinks = async (directory, prefix = "") => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`视觉包禁止符号链接: ${relative}`);
    if (entry.isDirectory()) await assertNoSymlinks(absolute, relative);
    else if (!entry.isFile()) throw new Error(`视觉包包含不支持的文件类型: ${relative}`);
  }
};

const readJson = async (file, label) => {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`${label} 无法读取: ${error.message}`);
  }
  try {
    return { value: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON: ${error.message}`);
  }
};

const schemaValidator = async (root, name, { requiredRootKeys = null } = {}) => {
  const file = path.join(root, "contracts", name);
  await assertProjectPath({ root, file, label: name });
  const { value: schema } = await readJson(file, name);
  const selectedSchema = requiredRootKeys
    ? { ...schema, required: requiredRootKeys }
    : schema;
  try {
    return new Ajv2020({
      allErrors: true,
      strict: false,
      allowUnionTypes: true
    }).compile(selectedSchema);
  } catch (error) {
    throw new Error(`${name} 不是可编译的 JSON Schema: ${error.message}`);
  }
};

const assertSchema = (validate, value, label) => {
  if (!validate(value)) {
    throw new Error(`${label} 合同失败: ${formatAjvErrors(validate.errors)}`);
  }
};

const styleLabel = (value, label) => {
  const resolved = styleValueLabels[value];
  if (!resolved) throw new Error(`${label} 含未登记画风值: ${value}`);
  return resolved;
};
const styleList = (values, label) => values
  .map((value) => styleLabel(value, label))
  .join("、");
const colorList = (colors) => colors
  .map((hex) => hex.toUpperCase())
  .join("、");

export const compileVisualStylePrompt = ({ shared, profile }, {
  includeTypography = true,
  includeBoundaries = true
} = {}) => {
  if (
    !Array.isArray(shared.artDirection)
    || shared.artDirection.length < 2
    || shared.artDirection.length > 4
    || shared.artDirection.some((line) => (
      typeof line !== "string"
      || line.trim() !== line
      || line.length < 12
      || line.length > 180
      || /[\r\n]/u.test(line)
    ))
  ) {
    throw new Error("artDirection 必须是2—4条无换行的短画法指令");
  }
  const character = profile.characterRendering;
  const environment = profile.environmentRendering;
  const typography = profile.typographyRendering;
  const foregroundProfile = environment.shapeLanguage === "foreground-component-assembly";
  const environmentLabel = foregroundProfile
    ? "局部环境绘制"
    : "环境绘制";
  const surfaceTreatmentLabel = foregroundProfile
    ? "前景部件表面质感"
    : "画面基底";
  const surfaceTreatmentBoundary = foregroundProfile
    ? "；只作用于人物、器物、准确文字载体和局部环境部件本身，不生成画布底、纸张底板、卡片底板或场景背景"
    : "";
  const environmentFinish = (
    environment.shapeLanguage === "foreground-component-assembly"
    && environment.finish === "shared-ink-color-matte"
  )
    ? "与人物共享干净哑光块面，水墨彩只用于随讲解主体收口的局部环境笔触"
    : styleLabel(environment.finish, "environmentRendering.finish");
  const prompt = [
    ...(includeBoundaries ? ["以下只决定既定内容的绘制外观；不得新增、删除、移动、合并或改写人物、物件、环境、文字与事实，也不得改变画面组织、镜头、光线方向或版式。"] : []),
    "包内艺术指导：",
    ...shared.artDirection.map((line, index) => `${index + 1}. ${line}`),
    ...(foregroundProfile ? [
      "讲解前景边界：上述艺术指导中的场景、大面积色面和底材都只描述前景部件怎样画，不得解释为铺满画布的背景或矩形底板。"
    ] : []),
    `媒介：${styleList(shared.mediumFamilies, "mediumFamilies")}`,
    `上色：${styleLabel(shared.fill, "fill")}`,
    `填色收束：${styleLabel(shared.fillFinish, "fillFinish")}`,
    `明暗：${styleLabel(shared.shading, "shading")}`,
    `轮廓线：${styleLabel(shared.linework.contourWeight, "contourWeight")}、${styleLabel(shared.linework.contourCharacter, "contourCharacter")}`,
    `内部线：${styleLabel(shared.linework.interiorDetail, "interiorDetail")}`,
    `线条收束：${styleLabel(shared.linework.finish, "linework.finish")}`,
    `${surfaceTreatmentLabel}：${styleLabel(shared.surfaceTreatment, "surfaceTreatment")}${surfaceTreatmentBoundary}`,
    `白平衡：${styleLabel(shared.palette.whiteBalance, "whiteBalance")}`,
    `基础色：${colorList(shared.palette.baseColors)}`,
    `强调色：${colorList(shared.palette.accentColors)}；只能局部点缀，不得作为背景底色或全局调色`,
    `禁止色偏：${styleList(shared.palette.forbiddenCasts, "forbiddenCasts")}`,
    "上述白平衡只约束内容没有明确指定综合色调的画面；不得覆盖P3明确要求的黄昏、烛光或其它有叙事依据的局部光色。",
    `人物绘制：${styleLabel(character.proportion, "characterRendering.proportion")}、${styleLabel(character.faceTreatment, "characterRendering.faceTreatment")}、${styleLabel(character.colorTreatment, "characterRendering.colorTreatment")}、${styleLabel(character.lineTreatment, "characterRendering.lineTreatment")}`,
    "同一画面中，不同且清晰可辨的人物应具有自然、可辨认的面部差异，不能只靠服装、发型或表情区分。差异应符合既定年龄、身份和人物设定；同一人物跨画面保持身份一致。画风统一不等于脸型与五官模板相同。",
    `${environmentLabel}：${styleLabel(environment.shapeLanguage, "environmentRendering.shapeLanguage")}、${environmentFinish}`,
    ...(includeTypography ? [
      `文字外观：只绘制任务明确提供的准确文字；${styleLabel(typography.glyphStyle, "typographyRendering.glyphStyle")}、${styleLabel(typography.weight, "typographyRendering.weight")}、${styleLabel(typography.finish, "typographyRendering.finish")}`
    ] : []),
    `禁止绘制外观：${styleList(shared.renderExclusions, "renderExclusions")}`,
    ...(includeBoundaries ? ["画风参考共同边界：以下只适用于标有绘制职责的画风参考图，不改写登记来源或连续性参考的用途。逐图只读取所列职责，继承整组共同证明且本视觉包声明的画法；单图天气、光向、色偏或纹理不升级为全局画风。人物造型比例只指人体自身比例，人物占画幅的大小、景别与周围空间服从本槽P3构图，不复制参考图的近景或大人物。时代、国家／地区、族群、肤色、发式、衣装形制、装备与建筑形制属于本槽内容；画风名称与参考图题材不提供这些身份，未写明也不得照搬。具体脸型、五官、年龄与胡须服从任务及连续性。不复制参考图的动作、物件、文字、布局或视点。底材、颗粒、磨损、排线和做旧由结构化画风决定，只有列明表面处理职责的参考图参与表达。"] : [])
  ].join("\n");
  if (prompt.length > 1800) {
    throw new Error(`结构化画风编译结果过长: ${prompt.length} > 1800`);
  }
  return prompt;
};

export const visualReferenceInstruction = (reference, index) => {
  if (!reference || !Array.isArray(reference.styleScopes) || reference.styleScopes.length === 0) {
    throw new Error(`视觉参考图 ${reference?.id ?? "unknown"} 缺少 styleScopes`);
  }
  const scopes = reference.styleScopes.map((scope) => {
    const label = styleScopeLabels[scope];
    if (!label) throw new Error(`视觉参考图 ${reference.id} 含未知 styleScope: ${scope}`);
    return label;
  });
  return `参考图 ${index} 只读取：${scopes.join("、")}。`;
};

const normalizeSha = (value, label) => {
  const normalized = typeof value === "string" && value.startsWith("sha256:")
    ? value.slice("sha256:".length)
    : value;
  if (typeof normalized !== "string" || !shaPattern.test(normalized)) {
    throw new Error(`${label} sha256 无效`);
  }
  return normalized;
};

const readResource = async (rootDir, relativePath, label, { json = false } = {}) => {
  const file = await resolveExistingFile(rootDir, relativePath, label);
  const bytes = await readFile(file.absolute);
  const digest = sha256(bytes);
  if (!json) {
    return {
      path: file.relative,
      sha256: digest,
      content: bytes.toString("utf8")
    };
  }
  let content;
  try {
    content = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON: ${error.message}`);
  }
  return {
    path: file.relative,
    sha256: digest,
    content
  };
};

const normalizeRoles = (roles) => {
  if (roles == null) return new Set(allRoles);
  const normalized = new Set(roles);
  const unknown = [...normalized].filter((role) => !allRoles.has(role));
  if (unknown.length) throw new Error(`视觉包包含未知读取角色: ${unknown.join(", ")}`);
  return normalized;
};

const normalizeProfileKinds = ({ roles, profileKinds }) => {
  if (profileKinds != null) {
    const normalized = [...new Set(profileKinds)];
    const unknown = normalized.filter((kind) => !allProfileKinds.includes(kind));
    if (unknown.length) throw new Error(`视觉包包含未知生产方案: ${unknown.join(", ")}`);
    return normalized;
  }
  if (!roles.has("productionProfiles")) return [];
  return [...imageKinds];
};

export const visualProfileKindForAsset = (kind, segmentType = "body") => {
  const profileKind = kind === "fullframe-image" && segmentType !== "body" && segmentType !== "video"
    ? "bookend-image"
    : kind;
  if (!allProfileKinds.includes(profileKind)) {
    throw new Error(`视觉包不支持素材 kind: ${profileKind}`);
  }
  return profileKind;
};

export const drawingStyleForTemplate = (renderTokens, templateId) => {
  return renderTokens.shared.drawing;
};

const loadRenderTokens = async ({
  systemRoot,
  rootDir,
  manifest,
  needsRender
}) => {
  const rawRecord = await readResource(rootDir, manifest.render.tokens, "视觉包 render tokens", {
    json: true
  });
  const renderTokens = {
    schemaVersion: rawRecord.content.schemaVersion,
    shared: rawRecord.content.shared,
    ...(needsRender ? { p4: rawRecord.content.p4 } : {})
  };
  const requiredRootKeys = [
    "schemaVersion",
    "shared",
    ...(needsRender ? ["p4"] : [])
  ];
  const validate = await schemaValidator(
    systemRoot,
    "visual-render-tokens.schema.json",
    { requiredRootKeys }
  );
  assertSchema(validate, renderTokens, rawRecord.path);
  if(needsRender){
    const originalFile = 'render/fonts/MiSans-Semibold.woff2';
    const logical=path.resolve(rootDir,originalFile);
    if(assetFile(logical,{root:systemRoot})!==logical) renderTokens.p4.subtitle.font={
      family:'MiSans',file:originalFile,sha256:'78227c6ec59566785c65ac0b5312328bfa2f879918f3d7403725785615a9a8f6',
      format:'woff2',weight:'520',style:'normal'
    };
  }
  const selectedFonts = [
    ...visualFontEntries(renderTokens),
    ...(needsRender ? [["subtitle", renderTokens.p4.subtitle.font]] : [])
  ];
  const fontDigests = new Map();
  for (const [role, font] of selectedFonts) {
    const logical=path.resolve(rootDir,font.file),local=assetFile(logical,{root:systemRoot});
    const file=local===logical ? await resolveExistingFile(rootDir,font.file,`视觉包字体 ${role}`)
      : (await assertProjectPath({root:systemRoot,file:local,label:`本机字体 ${role}`}),{absolute:local,relative:font.file});
    if (!fontDigests.has(file.absolute)) fontDigests.set(file.absolute, await fileSha256(file.absolute));
    const actual = fontDigests.get(file.absolute);
    if (actual !== normalizeSha(font.sha256, `视觉包字体 ${role}`)) {
      throw new Error(`视觉包字体 ${role} 哈希不一致: ${file.relative}`);
    }
  }
  return renderTokens;
};

const inspectReferencePng = async (file, label) => {
  const { stdout: output } = await runMediaProcess("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height",
    "-of", "json",
    file
  ], { inspection: true, timeoutMs: 15000, capture: true, maxBuffer: 2 * 1024 * 1024 }).catch(error => {
    throw new Error(`${label} 无法解码: ${error.message}`, { cause: error });
  });
  let probe;
  try {
    probe = JSON.parse(output);
  } catch {
    throw new Error(`${label} ffprobe 未返回有效 JSON`);
  }
  const stream = probe.streams?.[0];
  if (
    probe.streams?.length !== 1
    || stream?.codec_name !== "png"
    || !Number.isInteger(stream.width)
    || !Number.isInteger(stream.height)
    || stream.width < 1
    || stream.height < 1
  ) {
    throw new Error(`${label} 必须是可完整解码的标准 PNG 画风样张`);
  }
  return {
    width: stream.width,
    height: stream.height
  };
};

const normalizeMasterReference = async ({ rootDir, raw }) => {
  assertObject(raw, "视觉包 masterReference");
  assertExactKeys(raw, ["id", "path"], "视觉包 masterReference");
  if (typeof raw.id !== "string" || !idPattern.test(raw.id)) {
    throw new Error("视觉包 masterReference.id 无效");
  }
  const file = await resolveExistingFile(rootDir, raw.path, `masterReference.${raw.id}`);
  const raster = await inspectReferencePng(file.absolute, `masterReference.${raw.id}`);
  if (raster.width !== masterReferenceSpec.width || raster.height !== masterReferenceSpec.height) {
    throw new Error(
      `视觉包母版 ${raw.id} 必须是 ${masterReferenceSpec.width}×${masterReferenceSpec.height} PNG，`
      + `实际 ${raster.width}×${raster.height}`
    );
  }
  return {
    id: raw.id,
    path: file.relative,
    absolutePath: file.absolute,
    sha256: await fileSha256(file.absolute),
    referenceKind: "master-style",
    artifactSpec: masterReferenceSpec.artifactSpec,
    styleScopes: [...masterReferenceSpec.styleScopes]
  };
};

const normalizeProfile = async ({
  kind,
  raw,
  masterReference,
  references,
  renderTokens,
  packageId,
  version,
  styleDocument
}) => {
  const profileReferences = references.map((sourceReference) => {
    if (!raw.referenceStyleScopes) return sourceReference;
    const available = new Set(sourceReference.styleScopes);
    for (const scope of raw.referenceStyleScopes) {
      if (!available.has(scope)) {
        throw new Error(`productionProfiles.${kind}.referenceStyleScopes 超出母图正式职责: ${scope}`);
      }
    }
    return {
      ...sourceReference,
      styleScopes: [...raw.referenceStyleScopes]
    };
  });
  const style = {
    shared: structuredClone(styleDocument.shared),
    profile: structuredClone(styleDocument.profiles[kind])
  };
  const stylePrompt = compileVisualStylePrompt(style);
  const fonts = kind === "cover-image" ? {
    cover: renderTokens.shared.fonts.cover
  } : null;
  const fontPrompt = fonts
    ? `封面字体由当前Visual提供：${fonts.cover.family}；${styleLabel(style.profile.typographyRendering.glyphStyle, "typographyRendering.glyphStyle")}，${styleLabel(style.profile.typographyRendering.weight, "typographyRendering.weight")}。字形服从该字体，不从Cover样图继承另一套字体；字号层级、字效、文字材质、文字配色与排版服从Cover。`
    : null;
  const profileDigest = hashObject({
    packageId,
    version,
    kind,
    profileId: raw.profileId,
    style,
    stylePrompt,
    ...(fonts ? { fonts } : {}),
    references: profileReferences.map((reference) => ({
      id: reference.id,
      sha256: reference.sha256,
      referenceKind: reference.referenceKind,
      artifactSpec: reference.artifactSpec,
      styleScopes: reference.styleScopes
    }))
  });
  return {
    profileId: raw.profileId,
    profileDigest,
    referenceId: masterReference.id,
    style,
    stylePrompt,
    ...(fonts ? { fonts } : {}),
    ...(fontPrompt ? { fontPrompt } : {}),
    references: profileReferences
  };
};

const manifestProjection = ({
  raw,
  roles,
  profileKinds
}) => {
  const needsImages = profileKinds.some((kind) => imageKinds.includes(kind));
  const needsRender = roles.has("render") || profileKinds.includes("cover-image");
  const needsSharedProfile = profileKinds.some(kind => !raw.productionProfiles?.[kind]?.style);
  return {
    kind: raw.kind,
    id: raw.id,
    version: raw.version,
    catalog: raw.catalog,
    implements: raw.implements,
    ...(needsSharedProfile ? { style: raw.style } : {}),
    productionProfiles: Object.fromEntries(profileKinds.map((kind) => [
      kind,
      raw.productionProfiles?.[kind]
    ])),
    ...(needsRender ? { render: raw.render } : {}),
    ...(needsSharedProfile ? {
      masterReference: raw.masterReference,
      ...(raw.supplementaryReferences ? {
        supplementaryReferences: raw.supplementaryReferences
      } : {})
    } : {})
  };
};

const roleResource = ({ id, role, sha256: digest, content }) => ({
  source: `visuals/${id}/visual-package.json#${role}`,
  sha256: digest,
  content
});

const loadVisualPackageDirectory = async ({
  systemRoot,
  rootDir,
  directoryName,
  validateManifest,
  roles: requestedRoles = null,
  profileKinds: requestedProfileKinds = null,
  fullAudit = false
}) => {
  const manifestPath = path.join(rootDir, "visual-package.json");
  await assertProjectPath({
    root: rootDir,
    file: manifestPath,
    label: "视觉包清单"
  });
  const { value: rawManifest, text: manifestText } = await readJson(
    manifestPath,
    "visual-package.json"
  );
  const roles = normalizeRoles(requestedRoles);
  const profileKinds = normalizeProfileKinds({
    roles,
    profileKinds: requestedProfileKinds
  });
  const manifest = fullAudit
    ? rawManifest
    : manifestProjection({
        raw: rawManifest,
        roles,
        profileKinds
      });
  assertSchema(validateManifest, manifest, manifestPath);
  if (manifest.id !== directoryName) {
    throw new Error(`${manifestPath} 的 id 必须等于目录名 ${directoryName}`);
  }
  if (fullAudit) {
    for (const field of ["style", "render", "masterReference"]) {
      if (!Object.hasOwn(manifest, field)) {
        throw new Error(`${manifestPath} 全局审计缺少 ${field}`);
      }
    }
    for (const kind of allProfileKinds) {
      if (!manifest.productionProfiles?.[kind]) {
        throw new Error(`${manifestPath} 全局审计缺少 productionProfiles.${kind}`);
      }
    }
    await assertNoSymlinks(rootDir);
  }

  const needsImages = profileKinds.some((kind) => imageKinds.includes(kind));
  const needsRender = roles.has("render");
  const needsTokens = needsRender || profileKinds.includes("cover-image");
  const needsSharedProfile = profileKinds.some(kind => !manifest.productionProfiles[kind].style);
  const styleRecord = needsSharedProfile
    ? await readResource(rootDir, manifest.style, "视觉包 style", { json: true })
    : null;
  if (styleRecord) {
    const validateStyle = await schemaValidator(systemRoot, "visual-style.schema.json");
    const selectedStyle = {
      schemaVersion: styleRecord.content?.schemaVersion,
      shared: styleRecord.content?.shared,
      profiles: Object.fromEntries(profileKinds.filter(kind => !manifest.productionProfiles[kind].style).map((kind) => [
        kind,
        styleRecord.content?.profiles?.[kind]
      ]))
    };
    assertSchema(validateStyle, selectedStyle, styleRecord.path);
  }
  const renderTokens = needsTokens
    ? await loadRenderTokens({
        systemRoot,
        rootDir,
        manifest,
              needsRender
      })
    : null;
  const masterReference = needsSharedProfile || fullAudit
    ? await normalizeMasterReference({ rootDir, raw: manifest.masterReference })
    : null;
  const supplementaryReferences = masterReference
    ? await Promise.all((manifest.supplementaryReferences ?? []).map((raw) => (
        normalizeMasterReference({ rootDir, raw })
      )))
    : [];
  const references = masterReference
    ? [masterReference, ...supplementaryReferences]
    : [];
  if (new Set(references.map(({ id }) => id)).size !== references.length) {
    throw new Error("视觉包固定母图组含重复 id");
  }
  if (new Set(references.map(({ path }) => path)).size !== references.length) {
    throw new Error("视觉包固定母图组含重复文件");
  }
  const productionProfiles = {};
  for (const kind of profileKinds) {
    const raw = manifest.productionProfiles[kind];
    const ownStyle = raw.style ? await readResource(rootDir, raw.style, `视觉包 ${kind} style`, {json: true}) : styleRecord;
    const ownReferences = raw.references
      ? await Promise.all(raw.references.map(reference => normalizeMasterReference({rootDir, raw: reference})))
      : references;
    if (raw.style) {
      const validateStyle = await schemaValidator(systemRoot, "visual-style.schema.json");
      assertSchema(validateStyle, ownStyle.content, ownStyle.path);
    }
    productionProfiles[kind] = await normalizeProfile({
      kind,
      raw,
      masterReference: ownReferences[0],
      references: ownReferences,
      renderTokens,
      packageId: manifest.id,
      version: manifest.version,
      styleDocument: ownStyle.content
    });
  }
  const selectedImageKinds = profileKinds.filter((kind) => imageKinds.includes(kind));
  const productionDigest = selectedImageKinds.length > 0
    ? hashObject({
        profiles: Object.fromEntries(selectedImageKinds.map((kind) => [
          kind,
          {
            profileDigest: productionProfiles[kind].profileDigest
          }
        ]))
      })
    : null;
  const renderDigest = roles.has("render")
    ? hashObject({
        shared: renderTokens.shared,
        p4: renderTokens.p4
      })
    : null;
  const profilesDigest = profileKinds.length
    ? hashObject(Object.fromEntries(profileKinds.map((kind) => [
      kind,
      {
        profileDigest: productionProfiles[kind].profileDigest
      }
    ])))
    : null;
  const roleResources = new Map();
  if (roles.has("productionProfiles")) {
    roleResources.set("productionProfiles", roleResource({
      id: manifest.id,
      role: "productionProfiles",
      sha256: profilesDigest,
      content: structuredClone(productionProfiles)
    }));
  }
  if (roles.has("render")) {
    roleResources.set("render", roleResource({
      id: manifest.id,
      role: "render",
      sha256: renderDigest,
      content: structuredClone(renderTokens)
    }));
  }

  return {
    kind: manifest.kind,
    id: manifest.id,
    version: manifest.version,
    directory: rootDir,
    manifestPath,
    manifest,
    manifestResource: {
      source: `visuals/${manifest.id}/visual-package.json`,
      sha256: fullAudit ? sha256(manifestText) : hashObject(manifest),
      content: manifest
    },
    productionDigest,
    renderTokens,
    renderDigest,
    masterReference,
    references,
    productionProfiles,
    roleResources
  };
};

const visualsRootFor = async (root) => {
  const rootReal = await realpath(root);
  const requested = path.join(rootReal, "visuals");
  await assertProjectPath({ root: rootReal, file: requested, label: "visuals 正式根" });
  const visualsRoot = await realpath(requested);
  ensureInside(rootReal, visualsRoot, "visuals");
  return visualsRoot;
};

const visualDirectoryFor = async (visualsRoot, id) => {
  if (typeof id !== "string" || !idPattern.test(id)) {
    throw new Error(`视觉包 id 无效: ${id}`);
  }
  const requested = path.resolve(visualsRoot, id);
  ensureInside(visualsRoot, requested, `视觉包 ${id}`);
  await assertProjectPath({ root: visualsRoot, file: requested, label: `视觉包 ${id}` });
  const rootDir = await realpath(requested);
  ensureInside(visualsRoot, rootDir, `视觉包 ${id}`);
  return rootDir;
};

export async function loadVisualPackageCatalog(root) {
  const validateManifest = await schemaValidator(root, "visual-package.schema.json");
  const visualsRoot = await visualsRootFor(root);
  const entries = await readdir(visualsRoot, { withFileTypes: true });
  const catalog = new Map();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".DS_Store") continue;
    if (entry.isSymbolicLink()) throw new Error(`visuals 禁止符号链接: ${entry.name}`);
    if (!entry.isDirectory()) throw new Error(`visuals 包含孤儿文件: ${entry.name}`);
    const rootDir = await visualDirectoryFor(visualsRoot, entry.name);
    const context = await loadVisualPackageDirectory({
      systemRoot: root,
      rootDir,
      directoryName: entry.name,
      validateManifest,
      roles: allRoles,
      profileKinds: allProfileKinds,
      fullAudit: true
    });
    if (catalog.has(context.id)) throw new Error(`视觉包 id 重复: ${context.id}`);
    catalog.set(context.id, context);
  }
  if (catalog.size === 0) throw new Error("visuals 至少需要一个正式 Visual Package");
  return catalog;
}

export async function loadVisualPackagePlanningCatalog(root) {
  const validateManifest = await schemaValidator(root, "visual-package.schema.json");
  const visualsRoot = await visualsRootFor(root);
  const entries = await readdir(visualsRoot, { withFileTypes: true });
  const catalog = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".DS_Store") continue;
    if (entry.isSymbolicLink()) throw new Error(`visuals 禁止符号链接: ${entry.name}`);
    if (!entry.isDirectory()) throw new Error(`visuals 包含孤儿文件: ${entry.name}`);
    const rootDir = await visualDirectoryFor(visualsRoot, entry.name);
    const manifestPath = path.join(rootDir, "visual-package.json");
    await assertProjectPath({ root: rootDir, file: manifestPath, label: "视觉包清单" });
    const { value: manifest } = await readJson(manifestPath, "visual-package.json");
    assertSchema(validateManifest, manifest, manifestPath);
    if (manifest.id !== entry.name) {
      throw new Error(`${manifestPath} 的 id 必须等于目录名 ${entry.name}`);
    }
    catalog.push({
      visualPackageId: manifest.id,
      version: manifest.version,
      ...manifest.catalog
    });
  }
  if (catalog.length === 0) throw new Error("visuals 至少需要一个正式 Visual Package");
  return catalog;
}

export async function loadProgramVisualPackage(
  systemRoot,
  workspaceRoot,
  {
    catalog = null,
    roles = null,
    profileKinds = null
  } = {}
) {
  const programPath = path.join(workspaceRoot, "program.yaml");
  await assertProjectPath({
    root: workspaceRoot,
    file: programPath,
    label: "节目视觉包选择路径"
  });
  let program;
  try {
    program = await readData(programPath);
  } catch (error) {
    throw new Error(`节目视觉包选择无法读取: ${error.message}`);
  }
  const selection = program.visualPackage;
  const validateSelection = await schemaValidator(
    systemRoot,
    "visual-package-selection.schema.json"
  );
  assertSchema(validateSelection, selection, `${programPath}#visualPackage`);

  let base = null;
  if (catalog && roles == null && profileKinds == null) {
    base = catalog.get(selection.visualPackageId) ?? null;
  } else if (catalog && Array.isArray(roles) && roles.length === 0) {
    const full = catalog.get(selection.visualPackageId) ?? null;
    if (full) {
      base = {
        ...full,
        productionDigest: null,
        renderTokens: null,
        renderDigest: null,
        references: [],
        productionProfiles: {},
        roleResources: new Map()
      };
    }
  }
  if (!base) {
    let visualsRoot;
    try {
      visualsRoot = await visualsRootFor(systemRoot);
    } catch (error) {
      throw new Error(`节目视觉包选择无法加载: ${error.message}`);
    }
    let rootDir;
    try {
      rootDir = await visualDirectoryFor(visualsRoot, selection.visualPackageId);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`节目视觉包选择引用未知 Visual Package: ${selection.visualPackageId}`);
      }
      throw new Error(`节目视觉包选择无法加载: ${error.message}`, { cause: error });
    }
    const validateManifest = await schemaValidator(
      systemRoot,
      "visual-package.schema.json"
    );
    base = await loadVisualPackageDirectory({
      systemRoot,
      rootDir,
      directoryName: selection.visualPackageId,
      validateManifest,
      roles,
      profileKinds,
      fullAudit: false
    });
  }
  return {
    ...base,
    selection
  };
}

export function productionProfileForKind(context, kind, segmentType = "body") {
  const profiles = context?.productionProfiles;
  if (!profiles) throw new Error("视觉包 context 不是 loadProgramVisualPackage 的结果");
  const profileKind = visualProfileKindForAsset(kind, segmentType);
  const profile = profiles[profileKind];
  if (!profile) throw new Error(`视觉包不支持素材 kind: ${profileKind}`);
  return {
    packageId: context.id,
    version: context.version,
    profileKind,
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    referenceId: profile.referenceId,
    style: structuredClone(profile.style),
    stylePrompt: profile.stylePrompt,
    ...(profileKind === "cover-image" ? { fonts: structuredClone(profile.fonts), fontPrompt: profile.fontPrompt } : {}),
    references: profile.references.map((reference) => ({
      ...reference,
      styleScopes: [...reference.styleScopes]
    }))
  };
}
