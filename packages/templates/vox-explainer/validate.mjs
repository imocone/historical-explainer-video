import {canUseSourceForExternalProduction} from '../../source-rights.mjs';
import {compileAnimation, markupAssetIds} from './scene.mjs';
import {verifyAuthoredImage} from './images.mjs';

export function validate({result, context}) {
  const errors = [];
  if (result.templateId !== 'vox-explainer') errors.push('讲解模板身份无效');
  const allowed = new Set([
    ...(context.cues ?? []).map(cue => `C${String(cue.id).padStart(3, '0')}`),
    ...['facts', 'relations', 'evidence'].flatMap(key => (context.semanticContext?.[key] ?? []).map(item => item.id)),
    ...(context.sourceAssets ?? []).map(source => source.id)
  ]);
  for (const item of [...result.moments, ...result.assetRequests]) {
    for (const ref of item.sourceRefs) if (!allowed.has(ref)) errors.push(`${item.id ?? item.requestId} 来源不在当前输入内: ${ref}`);
    for (const ref of item.sourceRefs.filter(ref => ref.startsWith('SA'))) {
      const source = context.sourceAssets.find(source => source.id === ref);
      if (source && !canUseSourceForExternalProduction(source.rightsStatus)) errors.push(`${ref} 来源权利不可用`);
    }
  }
  if (new Set(result.moments.map(item => item.id)).size !== result.moments.length) errors.push('观看变化ID重复');
  const requests = new Map(result.assetRequests.map(item => [item.requestId, item]));
  if (requests.size !== result.assetRequests.length) errors.push('图片请求ID重复');
  for (const request of result.assetRequests) {
    if (request.referenceImageId && (!requests.has(request.referenceImageId)
      || request.referenceImageId === request.requestId || request.sourceAssetId))
      errors.push(`${request.requestId} 对象原图须为本段另一张图片，登记原件不重绘`);
  }
  const used = new Set(markupAssetIds(result.scene.markup));
  for (const id of used) if (!requests.has(id)) errors.push(`画面使用未声明图片: ${id}`);
  for (const id of used) {
    const reference = requests.get(id)?.referenceImageId;
    if (reference) used.add(reference);
  }
  for (const id of requests.keys()) if (!used.has(id)) errors.push(`图片没有进入画面: ${id}`);
  try { compileAnimation(result.scene.animation); }
  catch (error) { errors.push(`动画语法错误: ${error.message}`); }
  return errors;
}

export async function validateAcceptance({result, context, services}) {
  if (!services.task) return [];
  const errors = [];
  for (const request of result.assetRequests) {
    try {
      await verifyAuthoredImage({asset: request.asset, request, treatment: result, appearance: result.appearance,
        semanticContext: context.semanticContext, cues: context.cues,
        workspaceRoot: services.workspaceRoot, episodeId: services.episodeId,
        unitId: context.authorUnit.id, sourceAssets: context.sourceAssets});
    } catch (error) { errors.push(error.message); }
  }
  return errors;
}
