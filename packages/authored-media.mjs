import {imageDescriptors} from './authored-images.mjs';
import {resolveCueRange} from './cue-boundaries.mjs';

// Ephemeral render input, derived from the only author-owned media results.
export async function collectAuthoredMedia({storyboard, cues, videoPlan = null, bodyDurationMs, segmentIds = null, assetReferences = []}) {
  const requests = [], items = [];
  const append = async ({treatment, segmentId, segmentType, targetDurationMs = null, requestIds = null, ...context}) => {
    if (!treatment) throw new Error(`${segmentId} 尚未交付画面`);
    if (['vox-explainer'].includes(treatment.templateId)) return;
    const descriptors = requestIds
      ? (treatment.assetRequests ?? []).filter(request => requestIds.has(request.requestId)).map(target => ({ request: target, target }))
      : await imageDescriptors({treatment, targetDurationMs, ...context});
    for (const {request, target} of descriptors) {
      const asset = target?.asset;
      if (!asset?.file || !asset.sha256) throw Object.assign(new Error(`${segmentId}/${request.requestId} 尚未交付实际图片`),
        {upstreamStageId:segmentType === "body" ? "p3" : "p4",nodeId:segmentType === "body" ? "author" : "opener"});
      const identity = {segmentId, segmentType, templateId:treatment.templateId, requestId:request.requestId,
        assetId:`${segmentId.toLowerCase()}-${request.requestId.toLowerCase()}`, kind:request.kind};
      requests.push({...identity, ...request, targetDurationMs, spec:request.spec ?? request});
      items.push({...identity, ...asset, mediaType:'image', status:'accepted',
        framing:request.production?.framing,
        ...(target.effectAnchors ? {effectAnchors:target.effectAnchors} : {})});
    }
  };
  const covered = new Set(videoPlan?.spans.flatMap(span => span.beatIds) ?? []);
  for (const [index, beat] of (storyboard.beats ?? []).entries()) {
    const requestIds = segmentIds && !segmentIds.has(beat.id)
      ? new Set(assetReferences.filter(reference => reference.segmentId === beat.id).map(reference => reference.sourceRequestId)) : null;
    if (requestIds && !requestIds.size) continue;
    if (covered.has(beat.id) || ['vox-explainer'].includes(beat.templateId)) continue;
    await append({treatment:beat.treatment,segmentId:beat.id,segmentType:'body',
      requestIds,
      targetDurationMs:resolveCueRange({cueRange:beat.cueRange,cues}).durationMs,
      previousBeat:storyboard.beats[index-1] ?? null});
  }
  if (storyboard.opener && (!segmentIds || segmentIds.has('opener')))
    await append({treatment:storyboard.opener,segmentId:'opener',segmentType:'opener'});
  return {requests,items,bodyDurationMs};
}
