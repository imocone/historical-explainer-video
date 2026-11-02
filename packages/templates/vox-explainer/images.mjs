import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir, readFile, copyFile} from 'node:fs/promises';
import {pythonCommand, runtimeEnvironment} from '../../runtime-config.mjs';
import {imageBackend, isGeneratedImage, imageGenerationMetadata} from '../../image-generation.mjs';
import {assertProjectPath, atomicWriteData, hashObject, readData, sha256, stableStringify} from '../../program-utils.mjs';
import {readP3Sources} from '../../p3-sources.mjs';
import {imageProfileFor,imageAppearanceDigest,imageRolePalette} from './image-style.mjs';
import {getEpisodePaths} from '../../workspace-paths.mjs';
import {validateExplainerPlacement} from './image-geometry.mjs';
import {projectRhetoricalBoundaries} from '../../modules/author-beat/projection.mjs';
import {assertSourceRightsForExternalProduction} from '../../source-rights.mjs';
import {runMediaProcess} from '../../modules/render-video/runtime/media-process.mjs';

const deriveCandidateWorkspaceRoot = ({ workOrder, candidatePath }) => {
  const relativeCandidate = workOrder?.candidatePath;
  if (typeof relativeCandidate !== "string" || !relativeCandidate || path.isAbsolute(relativeCandidate)) {
    throw new Error("工作单 candidatePath 必须是节目工作区内的相对路径");
  }
  let workspaceRoot = path.resolve(candidatePath);
  for (const _part of relativeCandidate.split("/").filter(Boolean)) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, relativeCandidate) !== path.resolve(candidatePath)) {
    throw new Error("候选路径与工作单 candidatePath 不一致");
  }
  return workspaceRoot;
};

export const drawingDigest = ({asset, ...request}) => hashObject(request);
export const loadImageProfile = imageProfileFor;

// Compare the effective drawing input with the original tool call. The request
// digest records provenance; source citation IDs and layout are not drawing content.
const drawingPrompt = (request, treatment) => [
  `本段解释目标：${treatment.objective}`,
  `本件图片用途：${request.purpose}`,
  `时代与地点：${JSON.stringify({period:treatment.continuity.period,location:treatment.continuity.location})}`,
  `本件图片设计：${JSON.stringify(request.visualBrief)}`,
  `仅允许的图内文字：${JSON.stringify(request.exactTexts)}。其余文字由程序排印，不画伪字。`,
  `禁止虚构：${request.mustNotInvent.join('；')}`,
  request.transparentBackground !== false ? '背景真实透明。' : '背景不透明。'
].join('\n\n');

export function imageJob({request, treatment, profile, referenceImages = []}) {
  const transparentBackground = request.transparentBackground !== false;
  const style = profile.styles[request.visualBrief.styleReference ?? 'general'];
  if (!style) throw new Error('图片参考用途须为general或terrain');
  return {
    prompt: [style.stylePrompt,
      '画风参考提供画法，内容与构图以本件图片设计为准。',
      ...referenceImages.map(({kind, source}, index) => `第${style.references.length + index + 1}张参考图是${kind === 'revision'
        ? '本件待修改的原图。只按当前蓝图和修正意见改变所需部分，保留其余有效形象、结构与画法。'
        : source ? `登记原件 ${source.id}。对应对象、时期和用途：${source.usageNotes}。只参考其有据且适用于本件的部分；本人面貌、服装与环境分别对应，不混脸，不把画像中的礼服或背景自动沿用到其它场合。当前年龄、衣装、姿态及场景按蓝图与来源限定处理。原图不提供画风。`
        : '本件内容的参考原图。保持同一人物的面貌、衣装和装备，或同一器物的结构与材质；参考为地理骨架时，保留蓝图指定的海陆轮廓、地点、方向与连通关系，不把骨架当画风参考。姿态、视角和构图按本件蓝图调整。'}`),
      drawingPrompt(request, treatment)
    ].join('\n\n'),
    referenced_image_paths: [...style.references.map(reference => reference.absolutePath),
      ...referenceImages.map(reference => reference.file)],
    transparent_background: transparentBackground
  };
}

async function imageReferences({request, treatment, ...workspace}) {
  const references = [];
  if (request.referenceImageId) {
    const original = treatment.assetRequests.find(item => item.requestId === request.referenceImageId);
    if (!original || original.requestId === request.requestId || request.sourceAssetId)
      throw new Error(`${request.requestId} 须引用本段另一张已完成图片`);
    await verifyAuthoredImage({...workspace, treatment, request: original, asset: original.asset, appearance: treatment.appearance});
    references.push({kind: 'identity', file: path.resolve(workspace.workspaceRoot, original.asset.file),
      ...(original.asset.provider === 'source-asset' ? {source: original.asset.source} : {})});
  }
  if (request.asset) {
    if (!isGeneratedImage(request.asset)) throw new Error('登记原件不能作为重绘结果修改');
    await verifyImageFiles({...workspace, asset: request.asset});
    references.push({kind: 'revision', file: path.resolve(workspace.workspaceRoot, request.asset.file)});
  }
  return references;
}

async function readImagePrompt(asset, {workspaceRoot,episodeId,unitId}) {
  const file=path.resolve(workspaceRoot,asset.promptFile);
  await assertProjectPath({root:path.join(getEpisodePaths(workspaceRoot,episodeId).p3,'assets',unitId),file,label:'P3讲解原提示'});
  const bytes=await readFile(file);
  if(sha256(bytes)!==asset.promptSha256)throw new Error('讲解图片原提示内容已变化');
  return JSON.parse(bytes);
}

// Normalize only structured design data for comparison; preserve the actual call verbatim.
const normalizedDrawingPrompt = prompt => prompt.replace(/^本件图片设计：([^\n]+)$/gmu,
  (_, json) => `本件图片设计：${stableStringify(JSON.parse(json))}`);

// A retained image belongs to its own design, not a segment's rewritten
// explanation or scene-wide time/place description. Its own era-sensitive
// requirements remain in the drawing brief and evidence. Importing a new
// result still checks the complete, actual generation input.
const normalizedReusePrompt = prompt => normalizedDrawingPrompt(prompt)
  .replace(/^本段解释目标：[\s\S]*?(?=^本件图片用途：)/mu, '')
  .replace(/^时代与地点：[^\n]+\n?/gmu, '');

function matchesDrawingPrompt(job, request, treatment, {reuse = false} = {}) {
  if (typeof job?.prompt !== 'string'
    || job.transparent_background !== (request.transparentBackground !== false)) return false;
  try {
    const normalize = reuse ? normalizedReusePrompt : normalizedDrawingPrompt;
    return normalize(job.prompt).endsWith(normalize(drawingPrompt(request, treatment)));
  } catch { return false; }
}

function matchesPromptPalette(prompt, palette) {
  const colors = prompt?.match(/^图文角色色：(\{[^\n]+\})；/mu);
  if (!colors) return false;
  try { return hashObject(imageRolePalette(JSON.parse(colors[1]))) === hashObject(imageRolePalette(palette)); }
  catch { return false; }
}

async function matchesImageDrawing(asset, request, treatment, workspace) {
  return matchesDrawingPrompt(await readImagePrompt(asset, workspace), request, treatment, {reuse: true});
}

// A provenance digest may include typesetting. The saved tool prompt remains
// the evidence of the image's actual colors; never rewrite it to match a layout.
async function matchesImageAppearance(asset, profile, workspace = {}) {
  if(!workspace.workspaceRoot||!workspace.episodeId||!workspace.unitId||!asset.promptFile
    || ['source','art','tone'].some(key=>asset.appearance?.[key]!==profile[key]))return false;
  const {prompt}=await readImagePrompt(asset,workspace);
  return matchesPromptPalette(prompt, profile.palette);
}

const savedIdentityReference = (job, original) => {
  if (!Array.isArray(job.referenced_image_paths)) return null;
  // The saved call owns its reference order; live style references may change.
  const instructions = job.prompt.split(/^本段解释目标：/mu, 1)[0];
  const identities = [...instructions.matchAll(
    /^第(\d+)张参考图是(?:本件内容的参考原图。|登记原件 (SA\d+)。对应对象、时期和用途：)/gmu
  )];
  if (identities.length !== 1) return null;
  const [, number, sourceId] = identities[0], index = Number(number) - 1;
  const expectedSourceId = original.asset.provider === 'source-asset' ? original.asset.source?.id ?? null : undefined;
  if (!Number.isSafeInteger(index) || index < 0 || index >= job.referenced_image_paths.length
    || sourceId !== expectedSourceId) return null;
  const reference = job.referenced_image_paths[index];
  return typeof reference === 'string' && reference ? reference : null;
};

function imageFreshness({treatment, profile, ...workspace}) {
  const known = new Map();
  return async function current(request, ancestors = new Set()) {
    if (known.has(request.requestId)) return known.get(request.requestId);
    if (ancestors.has(request.requestId)) throw new Error('讲解图片不能循环引用');
    const {asset} = request;
    let fresh = Boolean(asset) && (Boolean(request.sourceAssetId)
      || (isGeneratedImage(asset) && await matchesImageDrawing(asset, request, treatment, workspace)
        && await matchesImageAppearance(asset, profile, workspace)));
    if (fresh && request.referenceImageId) {
      const original = treatment.assetRequests.find(item => item.requestId === request.referenceImageId);
      if (!original || original.requestId === request.requestId || request.sourceAssetId)
        throw new Error(`${request.requestId} 须引用本段另一张已完成图片`);
      fresh = await current(original, new Set([...ancestors, request.requestId]));
      if (fresh) {
        const prompt = await readImagePrompt(asset, workspace);
        const reference = savedIdentityReference(prompt, original);
        fresh = Boolean(reference);
        if (fresh) {
          // Imported originals stay beside the call record, including in workspace copies.
          const root = path.join(getEpisodePaths(workspace.workspaceRoot, workspace.episodeId).p3, 'assets', workspace.unitId);
          const file = path.join(root, path.basename(reference));
          await assertProjectPath({root, file, label: 'P3讲解引用原图'});
          fresh = sha256(await readFile(file)) === original.asset.sha256;
        }
      }
    }
    known.set(request.requestId, fresh);
    return fresh;
  };
}

export async function imageJobs({treatment, profile, semanticContext, cues, ...workspace}) {
  treatment = projectRhetoricalBoundaries(treatment, {semanticContext, cues});
  const current = imageFreshness({treatment, profile, ...workspace});
  const pending=[];
  for(const request of treatment.assetRequests){
    if(request.sourceAssetId)continue;
    if(!await current(request))pending.push(request);
  }
  const pendingIds = new Set(pending.map(request => request.requestId));
  const jobs = [], waiting = [];
  for (const request of pending) {
    if (request.referenceImageId) {
      const original = treatment.assetRequests.find(item => item.requestId === request.referenceImageId);
      if (!original || original.requestId === request.requestId) throw new Error(`${request.requestId} 须引用本段另一张图片`);
      if (!original.asset || pendingIds.has(original.requestId)) {
        waiting.push(`${request.requestId} 等待 ${original.requestId}`);
        continue;
      }
    }
    const referenceImages = await imageReferences({request, treatment, ...workspace});
    jobs.push({requestId: request.requestId, job: imageJob({request, treatment, profile, referenceImages})});
  }
  if (!jobs.length && waiting.length) throw new Error(`先完成引用原图，不能循环引用：${waiting.join('；')}`);
  return jobs;
}

export async function inspectImage(file, {transparentBackground = true} = {}) {
  const script = `import json,sys
from PIL import Image
original=Image.open(sys.argv[1])
mime=Image.MIME.get(original.format)
im=original.convert('RGBA')
a=im.getchannel('A')
b=a.point(lambda p: 255 if p>16 else 0).getbbox()
if not b: raise ValueError('讲解图片需要有实际可见内容')
if sys.argv[2]=='true' and a.getextrema()[0]==255: raise ValueError('透明讲解部件需要有真实透明区域')
w,h=im.size
print(json.dumps(dict(width=w,height=h,mimeType=mime,contentBounds=dict(x=b[0]/w,y=b[1]/h,width=(b[2]-b[0])/w,height=(b[3]-b[1])/h))))`;
  const {stdout} = await runMediaProcess(pythonCommand(),
    ['-c', script, file, String(transparentBackground)], {inspection: true, capture: true, timeoutMs: 30000, env: runtimeEnvironment()});
  return JSON.parse(stdout);
}

export async function verifyAuthoredImage({asset, request, treatment, appearance, semanticContext, cues,
  workspaceRoot, episodeId, unitId, sourceAssets}) {
  treatment = projectRhetoricalBoundaries(treatment, {semanticContext, cues});
  request = treatment.assetRequests.find(item => item.requestId === request.requestId);
  if (!asset) throw new Error(`${request.requestId} 尚未在P3完成图片交付与实际构图`);
  if (request.sourceAssetId) {
    if (asset.provider !== 'source-asset' || asset.source?.id !== request.sourceAssetId
      || !request.sourceRefs.includes(request.sourceAssetId) || asset.sha256 !== asset.source.sha256)
      throw new Error(`${request.requestId} 原始图片与所选来源不一致`);
    assertSourceRightsForExternalProduction({rightsStatus: asset.source.rightsStatus, label: request.sourceAssetId});
    if (sourceAssets && !sourceAssets.some(source => hashObject(source) === hashObject(asset.source)))
      throw new Error(`${request.requestId} 原始图片与当前来源登记不一致`);
  } else {
    if (!isGeneratedImage(asset) || !await matchesImageDrawing(asset, request, treatment,
      {workspaceRoot, episodeId, unitId}))
      throw new Error(`${request.requestId} 图片与当前图片设计不一致`);
    if(appearance&&!await matchesImageAppearance(asset,{...appearance,digest:imageAppearanceDigest(appearance)},
      {workspaceRoot,episodeId,unitId})) throw new Error(`${request.requestId}图片与当前讲解样式不一致`);
  }
  await verifyImageFiles({asset, workspaceRoot, episodeId, unitId});
  if (request.referenceImageId) {
    const current = imageFreshness({treatment, profile: await loadImageProfile(appearance), workspaceRoot, episodeId, unitId});
    if (!await current(request)) throw new Error(`${request.requestId} 引用原图已变化，沿原图片入口修正`);
  }
  return asset;
}

async function verifyImageFiles({asset, workspaceRoot, episodeId, unitId}) {
  const root = path.join(getEpisodePaths(workspaceRoot, episodeId).p3, 'assets', unitId);
  for (const [fileKey, hashKey] of [['file', 'sha256'], ...(isGeneratedImage(asset) ? [['promptFile', 'promptSha256']] : [])]) {
    const file = path.resolve(workspaceRoot, asset[fileKey]);
    await assertProjectPath({root, file, label: 'P3讲解素材'});
    if (sha256(await readFile(file)) !== asset[hashKey]) throw new Error(`讲解图片 ${fileKey} 内容已变化`);
  }
  validateExplainerPlacement(asset.explainerPlacement);
}

export async function importAuthoredImage({workspaceRoot, episodeId, unitId, request, treatment, profile, semanticContext, cues,
  sourceAssets, sourceFile, job, anchors = {}, generationReceipt}) {
  if (request.sourceAssetId) throw new Error('已选原始图片须用 import-source 导入，不得生图替换');
  const authorRequest = request;
  treatment = projectRhetoricalBoundaries(treatment, {semanticContext, cues});
  request = treatment.assetRequests.find(item => item.requestId === request.requestId);
  const transparentBackground = request.transparentBackground !== false;
  if (!job || typeof job.prompt !== 'string' || !job.prompt.trim() || job.transparent_background !== transparentBackground)
    throw new Error('导入须带本次自带生图实际使用的完整参数JSON');
  const referenceImages = await imageReferences({request, treatment, workspaceRoot, episodeId, unitId, sourceAssets});
  const expected = imageJob({request, treatment, profile, referenceImages}).referenced_image_paths;
  if (JSON.stringify(job.referenced_image_paths) !== JSON.stringify(expected))
    throw new Error('生图调用须原样携带画风参考与所选原图；缺失或变更时不能导入');
  if (!matchesDrawingPrompt(job, request, treatment))
    throw new Error(`${request.requestId} 实际生图参数与当前绘图输入不一致，沿原图片入口修正`);
  if (!matchesPromptPalette(job.prompt, profile.palette))
    throw new Error(`${request.requestId} 实际生图配色与当前讲解样式不一致，沿原图片入口修正`);
  const image = await readFile(sourceFile);
  const generation = await imageGenerationMetadata({job, sourceFile, receipt:generationReceipt});
  if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('自带生图结果须为PNG原图');
  const inspected = await inspectImage(sourceFile, {transparentBackground});
  const explainerPlacement = validateExplainerPlacement({contentBounds: inspected.contentBounds, anchors});
  const digest = sha256(image);
  const prompt = {provider:generation.provider, ...(generation.model ? {model:generation.model,generation} : {}),
    requestId: request.requestId, drawingDigest: drawingDigest(authorRequest), ...job,
    appearance:{source:profile.source,art:profile.art,tone:profile.tone,digest:profile.digest}};
  const directory = path.join(getEpisodePaths(workspaceRoot, episodeId).p3, 'assets', unitId);
  await assertProjectPath({root: getEpisodePaths(workspaceRoot, episodeId).p3, file: directory, label: 'P3讲解素材目录'});
  await mkdir(directory, {recursive: true});
  const stem = `${request.requestId.toLowerCase()}-${digest.slice(0, 16)}-${hashObject(prompt).slice(0, 12)}`;
  const file = path.join(directory, `${stem}.png`), promptFile = path.join(directory, `${stem}.json`);
  await copyFile(sourceFile, file);
  await atomicWriteData(promptFile, prompt);
  return {provider:generation.provider, ...(generation.model ? {model:generation.model} : {}), file: path.relative(workspaceRoot, file), sha256: digest,
    mimeType: 'image/png', width: inspected.width, height: inspected.height, explainerPlacement,
    drawingDigest: drawingDigest(authorRequest), appearance: prompt.appearance,
    promptFile: path.relative(workspaceRoot, promptFile), promptSha256: sha256(await readFile(promptFile))};
}

export async function importSourceImage({workspaceRoot, episodeId, unitId, request, sourceAssets, anchors = {}}) {
  const source = sourceAssets.find(item => item.id === request.sourceAssetId);
  if (!source || !request.sourceRefs.includes(source.id)) throw new Error('原始图片须选择当前 sourceAssets，并在 sourceRefs 引用');
  assertSourceRightsForExternalProduction({rightsStatus: source.rightsStatus, label: source.id});
  const sourceFile = path.resolve(getEpisodePaths(workspaceRoot, episodeId).input, source.path);
  await assertProjectPath({root: workspaceRoot, file: sourceFile, label: source.id});
  const bytes = await readFile(sourceFile);
  if (sha256(bytes) !== source.sha256) throw new Error(`${source.id} 来源文件已变化`);
  const inspected = await inspectImage(sourceFile, {transparentBackground: false});
  if (!['image/png', 'image/jpeg'].includes(inspected.mimeType)) throw new Error('原始图片须为 PNG 或 JPEG；其它材料先在来源取得环节交付可读图片');
  const directory = path.join(getEpisodePaths(workspaceRoot, episodeId).p3, 'assets', unitId);
  await assertProjectPath({root: getEpisodePaths(workspaceRoot, episodeId).p3, file: directory, label: 'P3讲解素材目录'});
  await mkdir(directory, {recursive: true});
  const file = path.join(directory, `${request.requestId.toLowerCase()}-${source.sha256.slice(0, 16)}.${inspected.mimeType === 'image/png' ? 'png' : 'jpg'}`);
  await copyFile(sourceFile, file);
  return {provider: 'source-asset', source: structuredClone(source), file: path.relative(workspaceRoot, file),
    sha256: source.sha256, mimeType: inspected.mimeType, width: inspected.width, height: inspected.height,
    explainerPlacement: validateExplainerPlacement({contentBounds: inspected.contentBounds, anchors})};
}

async function main() {
  const [command, workOrderFile, candidateFile, requestId, sourceFile, jobFile, anchorsFile] = process.argv.slice(2);
  if (!workOrderFile || !candidateFile || !['prepare', 'import', 'import-source'].includes(command)
    || (command === 'prepare' && requestId) || (command === 'import' && (!requestId || !sourceFile || !jobFile))
    || (command === 'import-source' && (!requestId || jobFile)))
    throw new Error('用法: prepare <工作单> <候选>；import <工作单> <候选> <AR编号> <PNG> <调用JSON> [锚点JSON]；import-source <工作单> <候选> <AR编号> [锚点JSON]');
  const task = await readData(path.resolve(workOrderFile)), candidate = await readData(path.resolve(candidateFile));
  const workspaceRoot = deriveCandidateWorkspaceRoot({workOrder: task, candidatePath: path.resolve(candidateFile)});
  const {taskDigest, ...taskContent} = task;
  if (task.stageId !== 'p3' || hashObject(taskContent) !== taskDigest
    || task.moduleId !== 'author-beat' || task.inputs.authorUnit?.templateId !== "vox-explainer"
    || candidate.result?.treatment?.templateId !== task.inputs.authorUnit.templateId
    || candidate.taskDigest !== task.taskDigest || candidate.returnTo) throw new Error('需要当前图片讲解作者工作单及同一候选');
  const treatment = candidate.result.treatment;
  const sourceAssets = await readP3Sources({workspaceRoot, workOrder: task});
  if (command === 'prepare') {
    const profile = await loadImageProfile(treatment.appearance);
    const {semanticContext, cues} = task.inputs;
    const jobs = await imageJobs({treatment,profile,semanticContext,cues,sourceAssets,
      workspaceRoot,episodeId:task.subject.id,unitId:task.inputs.authorUnit.id});
    console.log(JSON.stringify(jobs.map(item => ({...item,backend:imageBackend()})),null,2));
    return;
  }
  const request = treatment.assetRequests.find(item => item.requestId === requestId);
  if (!request) throw new Error(`候选没有图片请求 ${requestId}`);
  const common = {workspaceRoot, episodeId: task.subject.id, unitId: task.inputs.authorUnit.id, request};
  const call = command === 'import' ? await readData(path.resolve(jobFile)) : null;
  request.asset = command === 'import-source'
    ? await importSourceImage({...common, sourceAssets,
      anchors: sourceFile ? await readData(path.resolve(sourceFile)) : {}})
    : await importAuthoredImage({...common, treatment, sourceAssets,
      semanticContext: task.inputs.semanticContext, cues: task.inputs.cues,
      profile: await loadImageProfile(treatment.appearance),
      sourceFile: path.resolve(sourceFile), job:call.job ?? call,
      generationReceipt:call.provider === 'openai-images' ? call : undefined,
      anchors: anchorsFile ? await readData(path.resolve(anchorsFile)) : {}});
  await atomicWriteData(path.resolve(candidateFile), candidate);
  console.log(JSON.stringify(request.asset, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
