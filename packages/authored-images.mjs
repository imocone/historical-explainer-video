import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, readFile, copyFile} from 'node:fs/promises';
import {pythonCommand, runtimeEnvironment} from './runtime-config.mjs';
import {isGeneratedImage, imageGenerationMetadata} from './image-provenance.mjs';
import {assertProjectPath, atomicWriteData, hashObject, readData, sha256} from './program-utils.mjs';
import {loadProgramVisualPackage, productionProfileForKind, visualReferenceInstruction} from './visual-package.mjs';
import {authorTaskSegmentId, getEpisodePaths, getStageWorkPaths} from './workspace-paths.mjs';
import {assertSourceRightsForExternalProduction} from './source-rights.mjs';
import {deriveCandidateWorkspaceRoot} from './templates/fullframe-narrative/task-contract.mjs';
import {fullframeAuthorViews} from './templates/fullframe-narrative/author-batch.mjs';
import {projectRhetoricalBoundaries} from './modules/author-beat/projection.mjs';
import {runMediaProcess, withMediaResources} from './modules/render-video/runtime/media-process.mjs';

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pictureIdentity = (request) => hashObject({kind: request.kind, sourceRefs: request.sourceRefs,
  mustNotInvent: request.mustNotInvent, panel: request.production.panel,
  groupRules: request.production.groupRules});

// Template-owned picture specifications feed both the tool and the renderer.
export async function imageDescriptors({treatment, ...context}) {
  if (!/^[a-z][a-z0-9-]*$/u.test(treatment?.templateId ?? '')) throw new Error('图片缺少模板身份');
  const directory = path.join(systemRoot, 'packages/templates', treatment.templateId);
  const manifest = await readData(path.join(directory, 'package.yaml'));
  if (!manifest.assetContractEntry) return [];
  const entry = path.resolve(directory, manifest.assetContractEntry);
  await assertProjectPath({root: systemRoot, file: entry, label: '模板图片入口'});
  const {buildImageRequests} = await import(pathToFileURL(entry).href);
  if (typeof buildImageRequests !== 'function') throw new Error(`${treatment.templateId} 缺少图片交付方法`);
  return buildImageRequests({treatment, ...context});
}

export function authoredImageJob({request, profile, sourceAssets = [], sourceImages = [], previousImage = null, continuity = null, revision = null}) {
  // 修图由当前原图承接既定身份，不再叠加前序图。
  if (revision) previousImage = null;
  const sources = (request.sourceRefs ?? []).filter(id => id.startsWith('SA')).map(id => {
    const source = sourceAssets.find(item => item.id === id);
    if (!source) throw new Error(`图片引用未登记来源 ${id}`);
    assertSourceRightsForExternalProduction({rightsStatus: source.rightsStatus, label: id});
    return source;
  });
  const styleSlots = 5 - sourceImages.length - Number(Boolean(previousImage)) - Number(Boolean(revision));
  if (styleSlots < Math.min(1, profile.references.length))
    throw new Error('必要来源、连续性或修图参考与画风主参考合计超过5张');
  const styleReferences = profile.references.slice(0, styleSlots);
  const references = [...styleReferences.map(item => item.absolutePath), ...sourceImages];
  // main resolves source images in sourceRefs order; keep the same mapping in
  // the model-facing instructions so portraits and environments cannot swap roles.
  const imageSources = sources.filter(source => /\.(png|jpe?g|webp)$/iu.test(source.path));
  return {
    prompt: [profile.stylePrompt,
      ...styleReferences.map((reference, index) => visualReferenceInstruction(reference, index + 1)),
      '画风参考只提供画法，不复制其中人物、地点、事件或构图。',
      ...request.production.groupRules, ...request.production.panel.lines,
      ...(continuity ? [`连续性参考只约束图纸已经出现的身份，不把对象名录追加进本图：${JSON.stringify({
        subjects:continuity.subjects, props:continuity.props,
        ...(continuity.continuesPreviousScene ? {previousScene:continuity.previous?.exitPicture?.sceneDescription} : {})
      })}`] : []),
      ...(sources.length ? [`已授权来源：${JSON.stringify(sources)}`] : []),
      ...sourceImages.map((_, index) => `参考图 ${styleReferences.length + index + 1} 为来源原图${imageSources[index]
        ? ` ${imageSources[index].id}；对应对象、时期和用途：${imageSources[index].usageNotes}` : ''}。只采用其有据且适用于当前图纸的部分；本人面貌、服装与环境分别对应，不混脸，不把画像中的礼服或背景自动沿用到其它场合。实际衣装、年龄与场景按图纸及已说明的来源限定处理。`),
      ...(previousImage ? ['随后参考为实际前序画面，只继承当前设计明确要求延续的场景、人物和道具，不复制构图。'] : []),
      ...(revision ? [`最后一张参考为待修正原图。具体修正：${revision.reason}。保留原图中符合当前设计的部分。`] : []),
      '只交付本次图纸对应的一张16:9成品。画内结构依图纸，不附带说明、备选图或其它请求的画面。'].join('\n\n'),
    ...(references.length || previousImage || revision ? {referenced_image_paths: [...references, ...(previousImage ? [previousImage] : []), ...(revision ? [revision.file] : [])]} : {}),
    transparent_background: request.production.outputProfile === 'transparent-fullframe-v1'
  };
}

export async function verifyAuthoredImage({asset, workspaceRoot, episodeId, stageId, unitId}) {
  if (!isGeneratedImage(asset)) throw new Error(`${unitId} 尚未交付生成图片`);
  const root = path.join(getEpisodePaths(workspaceRoot, episodeId)[stageId], 'assets', unitId);
  for (const [fileKey, hashKey] of [['file', 'sha256'], ['promptFile', 'promptSha256']]) {
    const file = path.resolve(workspaceRoot, asset[fileKey]);
    await assertProjectPath({root, file, label: '作者图片交付'});
    if (sha256(await readFile(file)) !== asset[hashKey]) throw new Error(`${unitId} 图片交付 ${fileKey} 已变化`);
  }
  return asset;
}

export const importAuthoredImage = options => withMediaResources(() => importImage(options), {directory: options.workspaceRoot, inspection: true});

async function importImage({workspaceRoot, episodeId, stageId, unitId, request, profile, sourceFile, job, generationReceipt}) {
  if (!job?.prompt?.trim() || job.transparent_background !== (request.production.outputProfile === 'transparent-fullframe-v1')) throw new Error('须提供符合当前图纸背景要求的实际自带生图调用参数');
  const bytes = await readFile(sourceFile);
  const generation = await imageGenerationMetadata({job, sourceFile, receipt:generationReceipt});
  const {stdout} = await runMediaProcess(pythonCommand(),
    ['-c', "from PIL import Image\nimport json,sys\nim=Image.open(sys.argv[1]); im.load()\nprint(json.dumps(dict(width=im.width,height=im.height,format=im.format,transparent=('A' in im.getbands() and im.getchannel('A').getextrema()[0] < 255))))", sourceFile],
    {capture: true, timeoutMs: 30000, env: runtimeEnvironment()});
  const info = JSON.parse(stdout);
  if (!['PNG', 'JPEG', 'WEBP'].includes(info.format) || Math.abs(info.width / info.height - 16 / 9) > .025)
    throw new Error('图片须为完整16:9原图，不拉伸或裁去设计内容');
  if (job.transparent_background && (info.format !== 'PNG' || !info.transparent)) throw new Error('独立前景须交付实际带透明区域的PNG');
  const extension = {PNG:'png', JPEG:'jpg', WEBP:'webp'}[info.format];
  const digest = sha256(bytes);
  const visual = {packageId:profile.packageId, version:profile.version, profileId:profile.profileId,
    profileDigest:profile.profileDigest, referenceId:profile.referenceId};
  const prompt = {provider:generation.provider, ...(generation.model ? {model:generation.model,generation} : {}),
    requestId:request.requestId, drawingDigest:pictureIdentity(request), visual, ...job};
  const directory = path.join(getEpisodePaths(workspaceRoot, episodeId)[stageId], 'assets', unitId);
  await assertProjectPath({root: getEpisodePaths(workspaceRoot, episodeId)[stageId], file:directory, label:'作者图片目录'});
  await mkdir(directory, {recursive:true});
  const stem = `${request.requestId.toLowerCase()}-${digest.slice(0,16)}-${hashObject(prompt).slice(0,12)}`;
  const file = path.join(directory, `${stem}.${extension}`), promptFile = path.join(directory, `${stem}.json`);
  await copyFile(sourceFile, file);
  await atomicWriteData(promptFile, prompt);
  return {provider:generation.provider, ...(generation.model ? {model:generation.model} : {}), file:path.relative(workspaceRoot,file), sha256:digest,
    mimeType:`image/${extension === 'jpg' ? 'jpeg' : extension}`, width:info.width, height:info.height,
    drawingDigest:prompt.drawingDigest, visual, promptFile:path.relative(workspaceRoot,promptFile),
    promptSha256:sha256(await readFile(promptFile))};
}

async function main() {
  const args = process.argv.slice(2);
  const [command, workOrderFile, candidateFile, selection] = args;
  const sourceFile = command === 'import' ? args[4] : null;
  const revisionIndex = args.indexOf('--revision-reason');
  const revisionReason = revisionIndex >= 0 ? args[revisionIndex + 1]?.trim() : null;
  const retryAuthorized = args.includes('--retry-authorized');
  const generationIndex = args.indexOf('--generation-receipt');
  const generationReceipt = generationIndex >= 0 ? args[generationIndex+1] : undefined;
  if (generationIndex >= 0 && (!generationReceipt || command !== 'import')) throw new Error('API来源记录只用于导入实际生成结果');
  const referenceIndex = args.indexOf('--reference-image');
  const referenceSelection = referenceIndex >= 0 ? args[referenceIndex + 1]?.trim() : null;
  if (referenceIndex >= 0 && (!referenceSelection || command !== 'begin' || revisionReason))
    throw new Error('连续参考只在首次begin指定工作单上一末图或本单已成前图；修图沿用失败原图');
  if (revisionIndex >= 0 && !revisionReason) throw new Error('修图必须交接具体意见');
  if (command !== 'prepare' && !selection) throw new Error('调用或导入必须指定当前图片单位/AR编号');
  if (!['prepare','begin','import'].includes(command) || !workOrderFile || !candidateFile)
    throw new Error('用法: authored-images.mjs prepare|begin|import <工作单> <候选> [单位/AR编号] [实际成图路径]');
  const task = await readData(path.resolve(workOrderFile)), candidate = await readData(path.resolve(candidateFile));
  const workspaceRoot = deriveCandidateWorkspaceRoot({workOrder:task, candidatePath:path.resolve(candidateFile)});
  const {taskDigest, ...content} = task;
  if (hashObject(content) !== taskDigest || candidate.taskDigest !== taskDigest || candidate.returnTo
    || !['author-beat','author-bookend','author-video'].includes(task.moduleId)) throw new Error('需要当前作者工作单及同一候选');
  const expectedStage = task.moduleId === 'author-beat' ? 'p3' : 'p4';
  const slotId = {'author-beat':'body-template','author-bookend':'opener-template','author-video':'video-template'}[task.moduleId];
  const selected = task.resolvedAssembly?.slots?.find(slot => slot.id === slotId)?.implementations ?? [];
  const work = getStageWorkPaths(getEpisodePaths(workspaceRoot,task.subject.id),expectedStage,
    task.moduleId === 'author-beat' ? authorTaskSegmentId(task) : null,
    expectedStage === 'p4' ? (task.moduleId === 'author-video' ? 'video' : 'opener') : null);
  if (path.resolve(workOrderFile) !== work.workOrder || path.resolve(candidateFile) !== work.candidate || !task.scratchPath)
    throw new Error('图片入口只接收当前阶段的正式工作单和唯一候选');
  const scratch = path.resolve(workspaceRoot,task.scratchPath);
  await assertProjectPath({root:work.work,file:scratch,label:'当前作者临时目录'});
  const result = candidate.result;
  if (task.stageId !== expectedStage || selected.length !== 1
    || (task.inputs.authorBatch ? selected[0].packageId !== 'fullframe-narrative'
      : selected[0].packageId !== (result.treatment ?? result)?.templateId))
    throw new Error('图片必须由当前阶段唯一选中的作者模板交付');
  const unitId = task.inputs.authorUnit?.id ?? 'opener';
  const units = task.moduleId === 'author-beat' && selected[0].packageId === 'fullframe-narrative'
    ? (await fullframeAuthorViews({workspaceRoot,workOrder:task,candidate,includeCamera:false}))
      .map(view => ({id:view.item?.beatId ?? view.workOrder.inputs.authorUnit.id,
        treatment:view.candidate.result.treatment,task:view.workOrder}))
    : task.moduleId === 'author-video'
    ? result.spans.map(span => ({id:span.id, treatment:{...span,templateId:result.templateId}, target:span}))
    : [{id:unitId, treatment:result.treatment ?? result}];
  const visual = await loadProgramVisualPackage(systemRoot, workspaceRoot, {roles:['productionProfiles'],profileKinds:[task.moduleId === 'author-bookend' ? 'bookend-image' : 'fullframe-image']});
  const jobs = [];
  for (const unit of units) {
    const unitTask = unit.task ?? task;
    let treatment = unit.treatment;
    if (task.moduleId === 'author-beat') treatment = projectRhetoricalBoundaries(treatment,
      {semanticContext:unitTask.inputs.semanticContext,cues:unitTask.inputs.cues});
    const descriptors = await imageDescriptors({treatment, targetDurationMs:unitTask.inputs.cues?.length ? unitTask.inputs.cues.at(-1).endMs-unitTask.inputs.cues[0].startMs : null,
      includeFraming:false,
      previousTreatment:unitTask.inputs.previousTreatment,
      storyboard:unitTask.inputs.storyboard?.content, cues:unitTask.inputs.cues});
    for (const descriptor of descriptors) {
      const key = `${unit.id}/${descriptor.request.requestId}`;
      const target = unit.target ?? (unit.treatment.assetRequests?.find(item => item.requestId === descriptor.request.requestId)
        ?? descriptor.target);
      if (!target) throw new Error(`${key} 缺少原候选图片位置`);
      if (selection && selection !== key) continue;
      const segmentType = task.moduleId === 'author-bookend' ? 'opener' : task.moduleId === 'author-video' ? 'video' : 'body';
      const profile = productionProfileForKind(visual,'fullframe-image',segmentType);
      const directory = path.join(scratch, 'images', unit.id, descriptor.request.requestId);
      const recordFile = path.join(directory,'tool-call.json');
      await assertProjectPath({root:path.dirname(path.resolve(candidateFile)),file:recordFile,label:'图片工具恢复记录'});
      let record = null;
      try { record = await readData(recordFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!selection && record?.state !== 'calling' && target.asset?.drawingDigest === pictureIdentity(descriptor.request)
        && target.asset.visual.packageId === profile.packageId) continue;
      const previousTreatment = unitTask.inputs.previousTreatment;
      const carries = ['subjects','props'].some(kind =>
        previousTreatment?.continuity?.carryToNext?.[kind]?.some(value => treatment.continuity?.[kind]?.includes(value)));
      const index = unit.treatment.assetRequests?.findIndex(item => item.requestId === descriptor.request.requestId) ?? -1;
      const previousInUnit = index > 0 ? unit.treatment.assetRequests[index-1].asset : null;
      // 全画幅按同场景建立自动依赖，跨场景造型参考由作者显式选择。
      const needsPrevious = treatment.continuity?.continuesPreviousScene
        || (treatment.templateId !== 'fullframe-narrative' && carries);
      const inherited = needsPrevious ? previousTreatment?.exitPicture?.asset : null;
      let previous = previousInUnit ?? inherited;
      if (treatment.templateId === 'fullframe-narrative') previous = index === 0 ? inherited : null;
      if (referenceSelection) {
        const fromPrevious = referenceSelection === 'previous';
        const earlierUnit = task.inputs.authorBatch ? units.slice(0,units.indexOf(unit))
          .find(prior => prior.id === referenceSelection.split('/')[0]) : null;
        const reference = fromPrevious ? previousTreatment?.exitPicture
          : earlierUnit ? earlierUnit.treatment.assetRequests.find(item => `${earlierUnit.id}/${item.requestId}` === referenceSelection)
          : unit.treatment.assetRequests?.slice(0, index).find(item => `${unit.id}/${item.requestId}` === referenceSelection);
        const referenceUnitId = fromPrevious ? unitTask.inputs.previousAuthorUnit?.id : earlierUnit?.id ?? unit.id;
        if (treatment.templateId !== 'fullframe-narrative' || !reference?.asset || !referenceUnitId)
          throw new Error('连续参考必须是当前全画幅单位、联合成员已成前图或工作单上一末图');
        previous = await verifyAuthoredImage({asset:reference.asset,workspaceRoot,
          episodeId:task.subject.id,stageId:task.stageId,unitId:referenceUnitId});
      }
      const sourceImages = [];
      for (const id of descriptor.request.sourceRefs.filter(id => id.startsWith('SA'))) {
        const source = unitTask.inputs.sourceAssets?.find(item => item.id === id);
        if (!source) throw new Error(`未登记来源 ${id}`);
        assertSourceRightsForExternalProduction({rightsStatus:source.rightsStatus,label:id});
        const file = path.resolve(getEpisodePaths(workspaceRoot,task.subject.id).input,source.path);
        await assertProjectPath({root:workspaceRoot,file,label:`来源 ${id}`});
        if (sha256(await readFile(file)) !== source.sha256) throw new Error(`来源 ${id} 文件已变化`);
        if (/\.(png|jpe?g|webp)$/iu.test(file)) sourceImages.push(file);
      }
      if (revisionReason && !target.asset) throw new Error(`${key} 没有可修正的原图`);
      if (revisionReason) await verifyAuthoredImage({asset:target.asset,workspaceRoot,
        episodeId:task.subject.id,stageId:task.stageId,unitId:unit.id});
      const job = authoredImageJob({request:descriptor.request,profile,sourceAssets:unitTask.inputs.sourceAssets,sourceImages,
        revision:revisionReason ? {reason:revisionReason,file:path.resolve(workspaceRoot,target.asset.file)} : null,
        continuity:descriptor.continuity,
        previousImage:previous ? path.resolve(workspaceRoot,previous.file) : null});
      if (command === 'prepare') {
        jobs.push({key,asset:target.asset ?? null,record,
          ...(task.inputs.authorBatch && index === 0 && !previous
            && needsPrevious
            ? {dependsOn:unitTask.inputs.previousAuthorUnit.id} : {}),
          referenceImages:(record?.job ?? job).referenced_image_paths ?? []});
        continue;
      }
      if (command === 'begin') {
        if (record?.backend === 'openai' && record.state !== 'completed')
          throw new Error(`${key} 历史API调用只恢复原结果，不切换工具重投`);
        if (record?.state === 'calling' && !retryAuthorized) throw new Error(`${key} 工具结果未知，先恢复原调用，禁止再次提交`);
        if ((target.asset || record?.state === 'completed') && !revisionReason && !retryAuthorized)
          throw new Error(`${key} 已有完成图片，先导入原结果；重生需要明确修正意见与当前许可`);
        if (task.inputs.authorBatch && index === 0 && !revisionReason
          && needsPrevious && !previous) {
          throw new Error(`${key} 依赖 ${unitTask.inputs.previousAuthorUnit.id} 的末图，先完成其导入`);
        }
        await mkdir(directory,{recursive:true});
        if (record) await atomicWriteData(path.join(directory,`tool-call-${hashObject(record).slice(0,16)}.json`),record);
        await atomicWriteData(recordFile,{state:'calling',drawingDigest:pictureIdentity(descriptor.request),job,
          profile:{packageId:profile.packageId,version:profile.version,profileId:profile.profileId,
            profileDigest:profile.profileDigest,referenceId:profile.referenceId}});
        jobs.push({key,job,callPath:recordFile}); continue;
      }
      if (!selection || !sourceFile || !record || record.drawingDigest !== pictureIdentity(descriptor.request))
        throw new Error('导入须匹配原图片调用与当前图纸');
      if (((record.backend ?? 'builtin') === 'openai') !== Boolean(generationReceipt)) throw new Error('API图片须带原API结果记录，原生工具图片沿原交接');
      target.asset = await importAuthoredImage({workspaceRoot,episodeId:task.subject.id,stageId:task.stageId,
        unitId:unit.id,request:descriptor.request,profile:record.profile,sourceFile:path.resolve(sourceFile),job:record.job,generationReceipt});
      await atomicWriteData(path.resolve(candidateFile),candidate);
      await atomicWriteData(recordFile,{...record,state:'completed',asset:target.asset});
      jobs.push({key,asset:target.asset});
    }
  }
  if (selection && !jobs.length) throw new Error(`当前候选没有图片 ${selection}`);
  console.log(JSON.stringify(jobs,null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
