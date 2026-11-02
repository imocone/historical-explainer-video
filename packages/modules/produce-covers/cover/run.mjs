import { access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { runMediaProcess, withMediaResources } from "../../render-video/runtime/media-process.mjs";
import { imageBackend } from '../../../image-generation.mjs';

import {
  assertProjectMutationTree,
  assertProjectPath,
  atomicWrite,
  atomicWriteData,
  fileSha256,
  hashObject,
  programProducer,
  readData,
  sha256,
  withProjectLock,
  withoutProducer
} from "../../../program-utils.mjs";
import { getPublicationPaths } from "../../../publication-paths.mjs";
const BUILTIN_PROVIDER = "imagegen";
const imageProviders = new Set([BUILTIN_PROVIDER, 'openai-images']);
const selectedImageProvider = () => imageBackend() === 'openai' ? 'openai-images' : BUILTIN_PROVIDER;
const variants = Object.freeze({
  youtube: Object.freeze({
    width: 2048,
    height: 1152,
    aspectWidth: 16,
    aspectHeight: 9,
    generationSize: "16:9",
    label: "YouTube 横版"
  }),
  vertical: Object.freeze({
    width: 1536,
    height: 2048,
    aspectWidth: 3,
    aspectHeight: 4,
    generationSize: "3:4",
    label: "抖音竖版（小红书复用）"
  })
});
const unresolvedStatuses = new Set(["tool-intent"]);
const retryableStatuses = new Set(["local-rejected"]);
const terminalStatuses = new Set(["completed", "superseded", ...retryableStatuses]);
const exists = (file) => access(file).then(() => true, () => false);
const slash = (value) => value.split(path.sep).join("/");
const runProcess = (command, args, timeoutMs = 60000) => runMediaProcess(command, args, {
  capture: true, encoding: null, maxBuffer: 64 * 1024 * 1024, timeoutMs,
  env: { ...process.env, MAGICK_THREAD_LIMIT: "2" }
}).then(result => result.stdout);

const pathsFor = ({ root, episodeId, targetId, task }) => {
  const paths = getPublicationPaths(root, episodeId, targetId);
  const expected = path.resolve(paths.coverReceipt);
  const requested = path.isAbsolute(task.outputPath ?? "")
    ? path.resolve(task.outputPath)
    : path.resolve(root, task.outputPath ?? "");
  if (requested !== expected) {
    throw new Error("produce-covers 封面相位的 outputPath 不是当前发布包正式回执位置");
  }
  return {
    base: paths.publication,
    work: path.join(paths.workRoot, "_work", "covers"),
    receipt: paths.coverReceipt,
    youtube: paths.coverYoutube,
    vertical: paths.coverVertical
  };
};


const promptForVariant = ({ publication, visualPackage, coverPackage, variant, editReferenceIndex = null, revisionReason = null, replaceText = false }) => {
  const cover = publication.covers[variant];
  const exactTexts = cover.visibleText;
  const isYoutube = variant === "youtube";
  if (!Array.isArray(exactTexts) || exactTexts.length < 1 || exactTexts.length > 3) {
    throw new Error(`${variant} 封面文字数量不符合当前画幅合同`);
  }
  const heroVisual = cover.heroVisual?.trim();
  if (!heroVisual) throw new Error(`${variant} 封面缺少合格的 heroVisual`);
  const spec = variants[variant];
  const concept = typeof cover.posterConcept === "string" ? cover.posterConcept.trim() : "";
  const textLabels = exactTexts.map((text, index) => `${index + 1}「${text}」`).join("；");
  const layoutReferences = coverPackage.references;
  const editing = editReferenceIndex !== null;
  const layoutReferenceNumbers = layoutReferences.map((_, index) => visualPackage.references.length + index + 1).join("、");
  return [
    `【任务】${spec.label}，${spec.generationSize}；文字与图像一次生成，返回一张完整成品。`,
    replaceText
      ? `在第${editReferenceIndex}张现有封面上换字：移除旧字，换成下列原文，采用当前Visual的封面字体，按Cover重排新字及必要暗衬。保留全部场景、构图、光线、画风和人物外形、神情、姿态；不重画场景，不为维持旧行数或字框缩小长句。`
      : editing
      ? `编辑第${editReferenceIndex}张现有封面。只修正本次点名的问题，保留其余正确内容；被指出的字体、排版或画风偏差须改正，不受旧图约束。场景画法与字体用Visual，文字材质、配色、层级、排版及配图的视觉强弱用Cover；保留已接纳的本集内容和下列原文。`
      : "全新创作本集视频缩略图。按本集设计独立安排主体、行动、环境、景别和视角，只保留读懂本集关系必需的环境，与Cover文字联合构图；参考附件只示范画法或文字呈现。主体可为人物、群体、器物、建筑、场景或意象，以本集设计为准。落实写明的主体身份、衣着及关键物件的材质、形态和状态；准确呈现必要形态与身份，在当前Cover的明暗对比和细节分配内有选择地刻画，不为华丽而替换内容或让配图抢过文字。未写明的部分只补足形体与空间成立所需的内容，不按题材惯例添加华服、毛皮、雕饰或陈设。",
    ...(editing && revisionReason ? [`【本次具体修改：仅执行属于${spec.label}的意见】${revisionReason}`] : []),
    `【文字原文】${textLabels}。每项完整、准确、只出现一次，不增删或改写。`,
    "按上列顺序组织阅读，第一项先读；序号不绘入成图，不从位置推定系列名。字号、断行与强调依当前Cover及本集看点。仅绘制列出的原文，不自动添加系列名、集号或参考图文字。",
    `【封面主题${editing ? "：仅确认内容" : ""}】${concept}`,
    `【本集画面设计${editing ? "：仅确认内容" : ""}】${heroVisual}`,
    ...(!editing ? ["【环境信息的表现】不承担信息的牌面、屏幕、书脊和文书，以不可读的形状、色块、侧背面或虚焦光色呈现，由器物形态和位置交代环境。本图需要辨读的文字只来自上列原文，不补造其它可辨读文字或具体数据。"] : []),
    "【参考分工】Visual示范人物与环境的线条、色面、形体、用色和材质，并由下列字体说明提供封面字形；Cover示范文字材质与配色、断行、强调、图文比例，以及配图相对文字的明暗对比和细节分配，不继承其字体或人物画法。两类样图均不提供本集人物外貌、身份、服饰、道具或事件；动作、持物与可见状态按作者设计，不为强化主题补造武器、伤口或已经发生的行动。通用文字位置和图文关系按Cover，本集场面按作者设计。",
    "【Visual参考图：只学场景画法】",
    ...visualPackage.references.map(({ instruction }) => instruction),
    `参考图${layoutReferenceNumbers}（Cover）：读取与下列现行规则一致的文字外观、版式及配图的视觉强弱；不继承样图的具体文字、系列栏、人物画法或场面内容。`,
    ...(replaceText ? [] : [`【Visual场景画法${editing ? "：仅用于本次允许修改的场景" : ""}】\n${visualPackage.stylePrompt}`]),
    `【Visual封面字体】\n${visualPackage.fontPrompt}`,
    `【当前封面包设计语言】\n${coverPackage.rules.designLanguage}`,
    `【当前封面包文字呈现与层级】\n${coverPackage.rules.typography}`,
    `【当前画幅构图】\n${isYoutube ? coverPackage.rules.youtubeComposition : coverPackage.rules.verticalComposition}`,
    "【输出】简体中文横排，保留安全边距，缩小后清楚可读。不添加其它宣传字、徽标、水印或未经指定的可辨读文书、匾额。"
  ].join("\n");
};

const assertCoverPackage = async (coverPackage, variant) => {
  const rules = coverPackage?.rules;
  if (!coverPackage || typeof coverPackage.id !== "string"
    || typeof coverPackage.version !== "string"
    || !/^[a-f0-9]{64}$/u.test(coverPackage.coverDigest ?? "")
    || !rules || rules.schemaVersion !== "1.0"
    || ["designLanguage", "typography", `${variant}Composition`]
      .some((field) => typeof rules[field] !== "string" || !rules[field].trim())) {
    throw new Error("P1 封面任务缺少已装配Cover规则");
  }
  if (!Array.isArray(coverPackage.references) || coverPackage.references.length < 1) {
    throw new Error("P1 封面任务缺少已装配的版式参考图");
  }
  for (const reference of coverPackage.references) {
    if (!path.isAbsolute(reference.absolutePath ?? "")
      || !(await exists(reference.absolutePath))
      || await fileSha256(reference.absolutePath) !== reference.sha256) {
      throw new Error("P1 封面版式参考图缺失或摘要不一致");
    }
  }
};

const inspectRaster = file => withMediaResources(async () => {
  if (!(await exists(file))) throw new Error(`图片文件缺失: ${file}`);
  const probe = JSON.parse((await runProcess("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "json",
    file
  ], 15000)).toString("utf8"));
  const stream = probe.streams?.[0];
  if (!stream || !Number.isInteger(stream.width) || !Number.isInteger(stream.height)) {
    throw new Error(`图片无法解码: ${file}`);
  }
  await runProcess("magick", [file, "null:"], 30000);
  return stream;
});

const statePathsFor = ({ work, variant, fingerprint }) => {
  const directory = path.join(work, variant, fingerprint);
  return {
    directory,
    state: path.join(directory, "generation.json"),
    prompt: path.join(directory, "prompt.txt"),
    source: path.join(directory, "source.png")
  };
};
const generationStateFor = async ({ work, variant, fingerprint }) => {
  const paths = statePathsFor({ work, variant, fingerprint });
  return { paths, state: await exists(paths.state) ? await readData(paths.state) : null };
};
const resolveGenerationInput = async ({ work, variant, input }) => {
  let current = await generationStateFor({ work, variant, fingerprint: input.fingerprint });
  if (!current.state && await exists(path.join(work, variant))) {
    const matching = [];
    for (const entry of await readdir(path.join(work, variant), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
      const candidate = await generationStateFor({ work, variant, fingerprint: entry.name });
      if (candidate.state?.request?.businessFingerprint === input.request.businessFingerprint
        && candidate.state.status !== "superseded") matching.push(candidate);
    }
    if (matching.length > 1) throw new Error(`${variant}存在多项相同内容的封面记录，请核对原任务`);
    if (matching.length) [current] = matching;
  }
  const visited = new Set();
  while (current.state?.replacedBy) {
    if (visited.has(current.state.inputFingerprint)
      || !/^[a-f0-9]{64}$/u.test(current.state.replacedBy)) throw new Error("封面替换记录链无效");
    visited.add(current.state.inputFingerprint);
    const next = await generationStateFor({ work, variant, fingerprint: current.state.replacedBy });
    if (next.state?.replaces !== current.state.inputFingerprint) throw new Error("封面替换记录缺失或不匹配");
    current = next;
  }
  if (!current.state) return input;
  if (current.state.inputFingerprint !== path.basename(current.paths.directory)) throw new Error(`${variant}封面记录指纹不一致`);
  // The replacement has not been submitted; use the current prompt and reference assembly.
  if (current.state.status === "prepared") return { ...input, fingerprint: current.state.inputFingerprint };
  const prompt = await readFile(current.paths.prompt, "utf8").then((value) => value.replace(/\n$/u, ""), (error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return { ...input, prompt: prompt ?? input.prompt,
    promptInvalid: prompt === null || sha256(prompt) !== current.state.promptSha256,
    fingerprint: current.state.inputFingerprint,
    stableFingerprint: current.state.request?.stableFingerprint ?? input.stableFingerprint,
    request: current.state.request ?? input.request };
};
const unresolvedOtherGenerationFor = async ({ work, variant, fingerprint }) => {
  const directory = path.join(work, variant);
  if (!(await exists(directory))) return null;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === fingerprint) continue;
    const stateFile = path.join(directory, entry.name, "generation.json");
    if (!(await exists(stateFile))) continue;
    const state = await readData(stateFile);
    if (imageProviders.has(state.provider) && !terminalStatuses.has(state.status)) return stateFile;
  }
  return null;
};

const assertVisualPackage = async (visualPackage) => {
  if (!visualPackage || typeof visualPackage !== "object"
    || typeof visualPackage.id !== "string"
    || typeof visualPackage.version !== "string"
    || !/^[a-f0-9]{64}$/u.test(visualPackage.coverDigest ?? "")
    || typeof visualPackage.profileId !== "string"
    || typeof visualPackage.stylePrompt !== "string"
    || !visualPackage.stylePrompt.trim()
    || typeof visualPackage.fontPrompt !== "string"
    || !visualPackage.fontPrompt.trim()
    || !Array.isArray(visualPackage.references)
    || visualPackage.references.length < 1
    || visualPackage.references.length > 16) {
    throw new Error("P1 封面任务缺少已装配视觉包");
  }
  const identities = new Set();
  const files = new Set();
  for (const reference of visualPackage.references) {
    if (typeof reference?.id !== "string" || !reference.id
      || typeof reference?.absolutePath !== "string" || !path.isAbsolute(reference.absolutePath)
      || !/^[a-f0-9]{64}$/u.test(reference?.sha256 ?? "")
      || typeof reference?.instruction !== "string" || !reference.instruction.trim()
      || identities.has(reference.id)
      || files.has(reference.absolutePath)
      || !(await exists(reference.absolutePath))
      || await fileSha256(reference.absolutePath) !== reference.sha256) {
      throw new Error("P1 封面任务的正式画风参考图缺失、重复或摘要不一致");
    }
    identities.add(reference.id);
    files.add(reference.absolutePath);
  }
};

const coverRegenerationFor = (value) => {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.target !== "produce-covers"
    || value.revisionScope !== "cover-visual"
    || typeof value.regenerationRequestId !== "string"
    || !value.regenerationRequestId.trim()
    || !Array.isArray(value.variants)
    || value.variants.length < 1
    || value.variants.length > 2
    || new Set(value.variants).size !== value.variants.length
    || value.variants.some((variant) => !Object.hasOwn(variants, variant))) {
    throw new Error("P1 封面任务携带的定点重生请求无效");
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new Error("P1 封面定点重生缺少本次修订意见");
  }
  return value;
};

const generationInputsFor = ({ publication, visualPackage, coverPackages, coverRegeneration, paths, restartId }) => Object.fromEntries(
  Object.keys(variants).map((variant) => {
    const coverPackage = coverPackages[variant];
    const basePrompt = promptForVariant({ publication, visualPackage, coverPackage, variant });
    const regenerationRequestId = coverRegeneration?.variants.includes(variant)
      ? coverRegeneration.regenerationRequestId
      : null;
    const textSourceSha256 = coverRegeneration ? null : publication.coverTextEdit?.sources?.[variant];
    const editId = regenerationRequestId ?? (textSourceSha256 ? hashObject({
      baselinePublicationSha256: publication.coverTextEdit.baselinePublicationSha256,
      sourceSha256: textSourceSha256
    }) : null);
    const stableFingerprint = hashObject({
      variant,
      prompt: basePrompt,
      coverContent: publication.covers[variant],
      coverDigest: visualPackage.coverDigest,
      coverPackageDigest: coverPackage.coverDigest,
      provider: BUILTIN_PROVIDER,
      generationSize: variants[variant].generationSize
    });
    const request = {
      businessFingerprint: hashObject({ variant, coverContent: publication.covers[variant],
        visualId: visualPackage.id, visualVersion: visualPackage.version, profileId: visualPackage.profileId,
        coverId: coverPackage.id, coverVersion: coverPackage.version, editId, restartId: restartId ?? null }),
      stableFingerprint,
      visual: { packageId: visualPackage.id, version: visualPackage.version,
        profileId: visualPackage.profileId, coverDigest: visualPackage.coverDigest },
      cover: { packageId: coverPackage.id, version: coverPackage.version, coverDigest: coverPackage.coverDigest }
    };
    const referenceFiles = [...visualPackage.references, ...coverPackage.references]
      .map(({ absolutePath }) => absolutePath);
    const prompt = editId
      ? promptForVariant({
          publication, visualPackage, coverPackage, variant,
          editReferenceIndex: referenceFiles.length + 1,
          revisionReason: coverRegeneration?.reason,
          replaceText: Boolean(textSourceSha256)
        })
      : basePrompt;
    return [variant, {
      prompt,
      referenceFiles: editId ? [...referenceFiles, paths[variant]] : referenceFiles,
      editing: Boolean(editId),
      textSourceSha256,
      restartId,
      stableFingerprint,
      request,
      fingerprint: hashObject({
        stableFingerprint,
        regenerationRequestId: editId,
        ...(restartId ? { restartId } : {}),
        ...(editId ? { editPrompt: prompt } : {})
      })
    }];
  })
);

const readinessFor = async ({ work, variant, input }) => {
  const current = await generationStateFor({ work, variant, fingerprint: input.fingerprint });
  if (input.promptInvalid) return { blocked: { stateFile: current.paths.state, reason: `${variant}原封面提示词缺失或被改动` } };
  if (current.state && current.state.inputFingerprint !== input.fingerprint) {
    return { unknown: { stateFile: current.paths.state, reason: `${variant} 封面缓存指纹不一致` } };
  }
  if (imageProviders.has(current.state?.provider)) {
    if (current.state.status === "completed") {
      const valid = current.state.promptSha256 === sha256(input.prompt)
        && await exists(current.paths.source)
        && await fileSha256(current.paths.source) === current.state.sourceSha256
        && await inspectRaster(current.paths.source).then(() => true, error => {
          if (["MEDIA_CANCELLED", "MEDIA_RESOURCE_STOPPED"].includes(error.code)) throw error;
          return false;
        });
      return valid ? { recoverable: true }
        : { blocked: { stateFile: current.paths.state, reason: "自带生图结果缺失或不可读取，保留原记录" } };
    }
    if (current.state.status === "tool-intent") return { unknown: {
      stateFile: current.paths.state, reason: "自带生图已开始但尚未交回；只恢复原工具结果" } };
    if (current.state.status === "prepared") return { generate: true };
    return { blocked: { stateFile: current.paths.state, reason: "自带生图失败，须明确修订或替换原记录" } };
  }
  if (current.state) return { blocked: { stateFile: current.paths.state,
    reason: "当前封面缺少自带生图结果，保留原记录与已交付成品" } };
  const other = await unresolvedOtherGenerationFor({ work, variant, fingerprint: input.fingerprint });
  if (other) return { unknown: { stateFile: other, reason: `${variant} 存在另一项未决封面任务` } };
  return { generate: true };
};

const renderFinalCover = options => withMediaResources(() => normalizeCover(options));

async function normalizeCover({ source, output, variant }) {
  const spec = variants[variant];
  const sourceStream = await inspectRaster(source);
  const aspectRoundingError = Math.abs(
    sourceStream.width * spec.aspectHeight - sourceStream.height * spec.aspectWidth
  );
  if (aspectRoundingError > Math.max(spec.aspectWidth, spec.aspectHeight)) {
    const error = new Error(`${spec.label}成图画幅不是${spec.generationSize}，禁止裁切冒充正式封面；再次生成须明确修订，不自动重投`);
    error.code = "local-rejected";
    throw error;
  }
  const png = await runProcess("magick", [
    source,
    "-auto-orient",
    "-resize", `${spec.width}x${spec.height}!`,
    "-colorspace", "sRGB",
    "png:-"
  ]);
  await atomicWrite(output, png);
  const stream = await inspectRaster(output);
  const info = await stat(output);
  if (stream.codec_name !== "png"
    || stream.width !== spec.width
    || stream.height !== spec.height
    || info.size < 1
    || info.size > 20 * 1024 * 1024) {
    throw new Error(`${spec.label}完整封面本地规格归一失败`);
  }
  return info;
}

const imageRecordFor = async ({ root, output, source, variant, byteLength }) => ({
  path: slash(path.relative(root, output)),
  sha256: await fileSha256(source),
  mediaType: "image/png",
  byteLength,
  width: variants[variant].width,
  height: variants[variant].height
});

const expectedPaths = ({ root, paths }) => ({
  youtube: slash(path.relative(root, paths.youtube)),
  vertical: slash(path.relative(root, paths.vertical))
});
const acceptedReceiptMatches = ({
  receipt,
  episodeId,
  targetId,
  visualPackage
}) => {
  return receipt?.schemaVersion === "11.0"
    && receipt?.episodeId === episodeId
    && receipt?.targetId === targetId
    && receipt?.visual?.packageId === visualPackage.id
    && receipt?.visual?.version === visualPackage.version
    && receipt?.visual?.profileId === visualPackage.profileId
    && receipt?._producer?.moduleId === "produce-covers"
    && receipt?._producer?.nodeId === "produce-covers"
    && receipt?._producer?.outputSha256 === hashObject(withoutProducer(receipt));
};

const validFinalImageRecord = async ({ root, paths, receipt, variant }) => {
  const record = receipt?.files?.[variant];
  const expected = expectedPaths({ root, paths })[variant];
  if (!record || record.path !== expected || !(await exists(paths[variant]))) return null;
  const info = await stat(paths[variant]);
  if (info.size !== record.byteLength || await fileSha256(paths[variant]) !== record.sha256) return null;
  const stream = await inspectRaster(paths[variant]);
  const spec = variants[variant];
  if (stream.codec_name !== "png" || stream.width !== spec.width || stream.height !== spec.height) return null;
  return record;
};
const reusableFinalImageRecords = async ({
  root,
  receipt,
  paths,
  publicationSha256,
  baselinePublicationSha256,
  generationInputs,
  coverPackages,
  coverRegeneration
}) => {
  const records = {};
  const publicationMatches = receipt.publicationSha256 === publicationSha256
    || (baselinePublicationSha256 != null && receipt.publicationSha256 === baselinePublicationSha256);
  for (const variant of Object.keys(variants)) {
    const source = variant === "youtube" ? receipt?.cover : receipt?.verticalCover;
    if (source?.packageId !== coverPackages[variant].id
      || source?.version !== coverPackages[variant].version) continue;
    if (!publicationMatches
      && receipt.generation?.[variant]?.stableFingerprint !== generationInputs[variant].stableFingerprint) continue;
    if ((generationInputs[variant].restartId || coverRegeneration?.variants.includes(variant)
      || (generationInputs[variant].textSourceSha256 && receipt.publicationSha256 !== publicationSha256))
      && receipt?.generation?.[variant]?.inputFingerprint !== generationInputs[variant].fingerprint) continue;
    const record = await validFinalImageRecord({ root, receipt, paths, variant });
    if (record) records[variant] = record;
  }
  return records;
};

const inspectInputs = async ({ root, episodeId, targetId, task }) => {
  const paths = pathsFor({ root, episodeId, targetId, task });
  await Promise.all([paths.receipt, paths.youtube, paths.vertical]
    .map((file) => assertProjectPath({ root, file, label: "P1 封面路径" })));
  const publication = task.inputs?.publication ?? task.context?.publication;
  const visualPackage = task.context?.visualPackage;
  const coverPackages = task.context?.coverPackages;
  if (!publication) throw new Error("produce-covers 封面相位缺少 publication");
  await assertVisualPackage(visualPackage);
  for (const variant of Object.keys(variants)) {
    await assertCoverPackage(coverPackages?.[variant], variant);
  }
  const publicationBusiness = withoutProducer(publication);
  const coverRegeneration = coverRegenerationFor(
    task.inputs?.coverRegeneration ?? task.context?.coverRegeneration ?? null
  );
  const generationInputs = generationInputsFor({
    publication: publicationBusiness,
    visualPackage,
    coverPackages,
    coverRegeneration,
    paths,
    restartId: task.context?.stageRestartId
  });
  const coverExampleAdoption = task.inputs?.coverExampleAdoption
    ?? task.context?.coverExampleAdoption ?? null;
  if (!coverExampleAdoption) {
    for (const variant of Object.keys(variants)) {
      generationInputs[variant] = await resolveGenerationInput({ work: paths.work, variant, input: generationInputs[variant] });
    }
  }
  if (coverExampleAdoption) {
    if (coverExampleAdoption.mode !== "selected-cover-final-examples"
      || hashObject(Object.keys(coverExampleAdoption.variants ?? {}).sort()) !== hashObject(Object.keys(variants).sort())) {
      throw new Error("P1样图接纳请求必须完整选择当前横竖Cover成品样图");
    }
    for (const variant of Object.keys(variants)) {
      const selected = coverExampleAdoption.variants[variant];
      const coverPackage = coverPackages[variant];
      const example = coverPackage.finalExample;
      if (!example || selected.packageId !== coverPackage.id || selected.version !== coverPackage.version
        || selected.source !== example.source || selected.sha256 !== example.sha256
        || hashObject(selected.visibleText) !== hashObject(example.visibleText)) {
        throw new Error(`${variant}样图接纳请求与当前Cover登记成品不一致`);
      }
      if (hashObject(publicationBusiness.covers?.[variant]?.visibleText ?? null)
        !== hashObject(example.visibleText)) {
        throw new Error(`${variant}正式封面文字尚未与所选样图对齐`);
      }
      if (!(await exists(example.absolutePath)) || await fileSha256(example.absolutePath) !== example.sha256) {
        throw new Error(`${variant}登记成品样图缺失或摘要不一致`);
      }
    }
  }
  return {
    paths,
    publication,
    publicationBusiness,
    publicationSha256: hashObject(publicationBusiness),
    visualPackage,
    coverPackages,
    generationInputs,
    coverRegeneration,
    coverExampleAdoption
  };
};

export async function inspect({ root, episodeId, targetId, task }) {
  const input = await inspectInputs({ root, episodeId, targetId, task });
  const {
    paths,
    publicationBusiness,
    publicationSha256,
    visualPackage,
    coverPackages,
    generationInputs,
    coverRegeneration,
    coverExampleAdoption
  } = input;
  const receipt = await exists(paths.receipt) ? await readData(paths.receipt) : null;
  const receiptMatches = acceptedReceiptMatches({
    receipt,
    episodeId,
    targetId,
    visualPackage
  });
  if (coverExampleAdoption) {
    let ready = receiptMatches && receipt.publicationSha256 === publicationSha256;
    if (ready) for (const variant of Object.keys(variants)) {
      const selected = coverExampleAdoption.variants[variant];
      const source = receipt.generation?.[variant];
      ready = source?.provider === "package-example"
        && source.packageId === selected.packageId
        && source.version === selected.version
        && source.source === selected.source
        && source.sourceSha256 === selected.sha256
        && source.inputFingerprint === generationInputs[variant].fingerprint
        && source.stableFingerprint === generationInputs[variant].stableFingerprint
        && Boolean(await validFinalImageRecord({ root, receipt, paths, variant }));
      if (!ready) break;
    }
    return ready
      ? { valid: true, result: receipt }
      : { valid: false, readyToRun: true, reason: "用户已选择当前Cover成品样图，等待本地规格化复制并写入真实来源回执" };
  }
  const reusableFinal = receiptMatches
    ? await reusableFinalImageRecords({
        root,
        receipt,
        paths,
        publicationSha256,
        baselinePublicationSha256: publicationBusiness.coverReuse?.baselinePublicationSha256
          ?? publicationBusiness.coverTextEdit?.baselinePublicationSha256 ?? null,
        generationInputs,
        coverPackages,
        coverRegeneration
      })
    : {};
  const missingVariants = Object.keys(variants).filter((variant) => !reusableFinal[variant]);
  if (missingVariants.length > 0) {
    const readiness = {};
    for (const variant of missingVariants) readiness[variant] = await readinessFor({
      work: paths.work, variant, input: generationInputs[variant]
    });
    const blocked = Object.entries(readiness).find(([, value]) => value.unknown || value.blocked);
    const fresh = missingVariants.filter((variant) => readiness[variant].generate);
    if (fresh.length) return { valid: false, readyToRun: true,
      reason: "P1封面随阶段制作；等待同批自带生图，完整提示与参考由原模块提供" };
    if (blocked) {
      const [variant, value] = blocked;
      const detail = value.unknown ?? value.blocked;
      return {
        valid: false,
        code: value.unknown ? "unknown-remote-result" : "remote-task-failed",
        unknownExternal: Boolean(value.unknown),
        hardFailure: Boolean(value.blocked),
        reason: `${variant}: ${detail.reason}；禁止自动重投；请核对 ${detail.stateFile}`
      };
    }
    return {
      valid: false,
      readyToRun: true,
      reason: "待生成画幅已有工具结果，只需本地规格归一并交付"
    };
  }
  if (receipt.publicationSha256 !== publicationSha256) {
    return {
      valid: false,
      readyToRun: true,
      reason: "平台文案或正式发布摘要已变化；只更新封面回执，不重新生图"
    };
  }
  return { valid: true, result: receipt };
}

export async function replaceGeneration({ root, episodeId, targetId, task, variant, record }) {
  const { paths, generationInputs } = await inspectInputs({ root, episodeId, targetId, task });
  const input = generationInputs[variant];
  if (!input || !/^[a-f0-9]{64}$/u.test(record ?? "")) throw new Error("封面替换必须点名画幅与原记录指纹");
  if (input.promptInvalid) throw new Error("原封面提示词缺失或被改动，不能替换");
  await assertProjectMutationTree({ root, file: paths.work, label: "封面原任务替换" });
  return withProjectLock({ root, lock: path.join(paths.work, "produce-cover.lock"), label: "封面原任务替换", execute: async () => {
    const original = await generationStateFor({ work: paths.work, variant, fingerprint: record });
    const state = original.state;
    if (!state || !imageProviders.has(state.provider) || state.inputFingerprint !== record || state.variant !== variant) {
      throw new Error("所选自带生图记录不存在或身份不符");
    }
    if (record !== input.fingerprint && state.replacedBy !== input.fingerprint) throw new Error("所选记录不是当前封面任务，保留现场");
    if (state.replacedBy) return;
    if (!retryableStatuses.has(state.status) && !unresolvedStatuses.has(state.status)) throw new Error("只能替换失败或未知的封面记录");
    const fingerprint = hashObject({ replaces: record });
    const replacement = statePathsFor({ work: paths.work, variant, fingerprint });
    await mkdir(replacement.directory, { recursive: true });
    if (!await exists(replacement.state)) {
      await atomicWrite(replacement.prompt, `${input.prompt}\n`);
      await atomicWriteData(replacement.state, { schemaVersion: "2.0", variant,
        inputFingerprint: fingerprint, replaces: record, request: input.request,
        status: "prepared", provider: state.provider,
        referenceFiles: input.referenceFiles, generationSize: variants[variant].generationSize,
        promptSha256: sha256(input.prompt) });
    }
    await atomicWriteData(original.paths.state, { ...state, originalStatus: state.status, status: "superseded", replacedBy: fingerprint });
  } });
}

export async function run({ root, systemRoot = process.cwd(), episodeId, targetId, task = {} }) {
  const input = await inspectInputs({ root, episodeId, targetId, task });
  const {
    paths,
    publication,
    publicationBusiness,
    publicationSha256,
    visualPackage,
    coverPackages,
    generationInputs,
    coverRegeneration,
    coverExampleAdoption
  } = input;
  if (publication.episodeId !== episodeId || publication.targetId !== targetId) {
    throw new Error("produce-covers 封面相位输入身份不一致");
  }
  await Promise.all([
    assertProjectMutationTree({ root, file: paths.base, label: "P1 封面回执写入树" }),
    assertProjectMutationTree({ root, file: paths.work, label: "P1 封面工作目录" }),
    assertProjectMutationTree({ root, file: path.dirname(paths.youtube), label: "P1 最终交付目录" })
  ]);
  await Promise.all([
    mkdir(paths.base, { recursive: true }),
    mkdir(paths.work, { recursive: true }),
    mkdir(path.dirname(paths.youtube), { recursive: true })
  ]);
  return withProjectLock({
    root,
    lock: path.join(paths.work, "produce-cover.lock"),
    label: "当前 P1 封面生产",
    execute: async () => {
      const existingReceipt = await exists(paths.receipt) ? await readData(paths.receipt) : null;
      const finishDelivery = async ({ visual, cover, verticalCover, generation, imageRecords }) => {
        const business = {
          schemaVersion: "11.0",
          episodeId,
          targetId,
          publicationSha256,
          visual,
          cover,
          verticalCover,
          generation,
          files: {
            youtube: imageRecords.youtube,
            vertical: imageRecords.vertical
          }
        };
        const receipt = { ...business, _producer: programProducer({ task, business }) };
        await atomicWriteData(paths.receipt, receipt);
        return receipt;
      };
      if (coverExampleAdoption) {
        const imageRecords = {};
        const generation = {};
        const normalizedCovers = {};
        for (const variant of Object.keys(variants)) {
          const selected = coverExampleAdoption.variants[variant];
          const example = coverPackages[variant].finalExample;
          const directory = path.join(paths.work, "adopted-package-example", variant, generationInputs[variant].fingerprint);
          const normalized = path.join(directory, "cover.png");
          await mkdir(directory, { recursive: true });
          const info = await renderFinalCover({ source: example.absolutePath, output: normalized, variant });
          normalizedCovers[variant] = normalized;
          imageRecords[variant] = await imageRecordFor({
            root, output: paths[variant], source: normalized, variant, byteLength: info.size
          });
          generation[variant] = {
            provider: "package-example",
            packageId: selected.packageId,
            version: selected.version,
            source: selected.source,
            sourceSha256: selected.sha256,
            inputFingerprint: generationInputs[variant].fingerprint,
            stableFingerprint: generationInputs[variant].stableFingerprint
          };
        }
        for (const variant of Object.keys(variants)) {
          await atomicWrite(paths[variant], await readFile(normalizedCovers[variant]));
        }
        return finishDelivery({
          visual: {
            packageId: visualPackage.id,
            version: visualPackage.version,
            profileId: visualPackage.profileId,
            coverDigest: visualPackage.coverDigest
          },
          cover: {
            packageId: coverPackages.youtube.id,
            version: coverPackages.youtube.version,
            coverDigest: coverPackages.youtube.coverDigest
          },
          verticalCover: {
            packageId: coverPackages.vertical.id,
            version: coverPackages.vertical.version,
            coverDigest: coverPackages.vertical.coverDigest
          },
          generation,
          imageRecords
        });
      }
      const receiptMatches = acceptedReceiptMatches({
        receipt: existingReceipt,
        episodeId,
        targetId,
        visualPackage
      });
      const imageRecords = receiptMatches
        ? await reusableFinalImageRecords({
            root,
            receipt: existingReceipt,
            paths,
            publicationSha256,
            baselinePublicationSha256: publicationBusiness.coverReuse?.baselinePublicationSha256
              ?? publicationBusiness.coverTextEdit?.baselinePublicationSha256 ?? null,
            generationInputs,
            coverPackages,
            coverRegeneration
          })
        : {};
      const generation = Object.fromEntries(Object.keys(imageRecords).map((variant) => [
        variant,
        structuredClone(existingReceipt.generation[variant])
      ]));
      const missingVariants = Object.keys(variants).filter((variant) => !imageRecords[variant]);
      if (missingVariants.length > 0) {
        const readiness = {};
        for (const variant of missingVariants) readiness[variant] = await readinessFor({
          work: paths.work, variant, input: generationInputs[variant]
        });
        const blocked = Object.entries(readiness).find(([, value]) => value.unknown || value.blocked);
        let blockedError = null;
        if (blocked) {
          const [variant, value] = blocked;
          const detail = value.unknown ?? value.blocked;
          blockedError = new Error(`${variant}: ${detail.reason}；禁止自动重投；请核对 ${detail.stateFile}`);
          blockedError.code = value.unknown ? "unknown-remote-result" : "remote-task-failed";
        }
        const generated = Object.fromEntries(await Promise.all(missingVariants
          .filter((variant) => readiness[variant].recoverable)
          .map(async (variant) => {
            const { paths: files, state } = await generationStateFor({
              work: paths.work, variant, fingerprint: generationInputs[variant].fingerprint });
            return [variant, { ...files, state }];
          })));
        const fresh = missingVariants.filter((variant) => readiness[variant].generate);
        if (fresh.length) {
          const requests = [];
          let visualBoard = null;
          for (const variant of fresh) {
            const item = generationInputs[variant];
            if (item.editing && (!receiptMatches || !await validFinalImageRecord({ root, receipt: existingReceipt, paths, variant })
              || (item.textSourceSha256 && item.textSourceSha256 !== existingReceipt.files[variant].sha256))) {
              throw new Error(`${variant}待编辑成图与当前回执不一致，保留现场`);
            }
            const files = statePathsFor({ work: paths.work, variant, fingerprint: item.fingerprint });
            const {state: prepared} = await generationStateFor({work: paths.work, variant, fingerprint: item.fingerprint});
            const provider = prepared?.provider ?? selectedImageProvider();
            await mkdir(files.directory, { recursive: true });
            let toolPrompt = item.prompt;
            let toolReferences = item.referenceFiles;
            if (visualPackage.references.length > 1 || toolReferences.length > 5) {
              // Preserve every selected Visual sample on a native-tool reference board.
              const visuals = visualPackage.references.map(({ absolutePath }) => absolutePath);
              const columns = Math.ceil(Math.sqrt(visuals.length));
              if (!visualBoard) {
                visualBoard = path.join(files.directory, "visual-reference-board.png");
                const rows = [];
                for (let index = 0; index < visuals.length; index += columns) {
                  rows.push("(", ...visuals.slice(index, index + columns), "+append", ")");
                }
                const bytes = await runProcess("magick", ["-background", "#05090D", ...rows, "-append", "png:-"]);
                await atomicWrite(visualBoard, bytes);
              }
              toolReferences = [visualBoard, ...item.referenceFiles.slice(visuals.length)];
              if (toolReferences.length > 5) throw new Error("所选Cover参考与编辑原图超过自带工具容量；保留全部输入并停止");
              toolPrompt = `【实际附件映射】附件1为画风参考板，按${columns}列从左到右、从上到下排列原Visual参考图1至${visuals.length}，每格只读原画法。附件2起依序对应下文原参考图${visuals.length + 1}至${item.referenceFiles.length}，分别是Cover样图${item.editing ? "及最后一张当前编辑原图" : ""}。下文图号指原参考身份；不把参考板作为新场景或四宫格封面。\n${item.prompt}`;
            }
            await atomicWrite(files.prompt, `${toolPrompt}\n`);
            await atomicWriteData(files.state, { schemaVersion: "2.0", variant,
              inputFingerprint: item.fingerprint, status: "prepared", provider,
              generationSize: variants[variant].generationSize, promptSha256: sha256(toolPrompt),
              request: item.request, referenceFiles: toolReferences });
            requests.push({ variant, record: item.fingerprint, prompt: toolPrompt, backend:provider === BUILTIN_PROVIDER ? 'builtin' : 'openai',
              referencedImagePaths: toolReferences, generationSize: variants[variant].generationSize,
              statePath: files.state });
          }
          return { kind: "image-generation-batch", episodeId, targetId,
            moduleId: "produce-covers", instructionsPath: path.resolve(systemRoot, "packages/modules/produce-covers/cover/builtin.md"),
            requests };
        }
        if (blockedError) throw blockedError;
        const normalizedCovers = {};
        for (const variant of missingVariants) {
          const normalized = path.join(generated[variant].directory, "cover.png");
          const info = await renderFinalCover({
            source: generated[variant].source,
            output: normalized,
            variant
          }).catch(async (error) => {
            if (error.code === "local-rejected") {
              const statePath = statePathsFor({
                work: paths.work, variant, fingerprint: generationInputs[variant].fingerprint
              }).state;
              await atomicWriteData(statePath, {
                ...generated[variant].state,
                status: "local-rejected",
                error: error.message
              });
            }
            throw error;
          });
          imageRecords[variant] = await imageRecordFor({
            root, output: paths[variant], source: normalized, variant, byteLength: info.size
          });
          generation[variant] = {
            provider: generated[variant].state.provider,
            tool: generated[variant].state.provider === BUILTIN_PROVIDER ? 'image_gen.imagegen' : 'openai.images',
            ...(generated[variant].state.generation?.model ? {model:generated[variant].state.generation.model} : {}),
            generationSize: variants[variant].generationSize,
            inputFingerprint: generationInputs[variant].fingerprint,
            stableFingerprint: generationInputs[variant].stableFingerprint,
            promptSha256: generated[variant].state.promptSha256,
            sourceSha256: generated[variant].state.sourceSha256
          };
          normalizedCovers[variant] = normalized;
        }
        for (const variant of missingVariants) {
          await atomicWrite(paths[variant], await readFile(normalizedCovers[variant]));
        }
      }
      const visual = missingVariants.length === 0
        ? existingReceipt.visual : generationInputs[missingVariants[0]].request.visual;
      const coverSources = Object.fromEntries(Object.keys(coverPackages).map((variant) => [
        variant,
        missingVariants.includes(variant)
          ? generationInputs[variant].request.cover
          : (variant === "youtube" ? existingReceipt.cover : existingReceipt.verticalCover)
      ]));
      return finishDelivery({
        visual,
        cover: coverSources.youtube,
        verticalCover: coverSources.vertical,
        generation,
        imageRecords
      });
    }
  });
}
