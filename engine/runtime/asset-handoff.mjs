import path from 'node:path';
import {exists} from './files.mjs';
import {collectAuthoredMedia} from '../../packages/authored-media.mjs';

export async function resolveRenderAssetHandoff({workspaceRoot, storyboard, cues, videoPlan, bodyDurationMs}) {
  try {
    const media = await collectAuthoredMedia({storyboard,cues,videoPlan,bodyDurationMs});
    for (const image of media.items) {
      if (!await exists(path.resolve(workspaceRoot,image.file)))
        return {kind:'blocked-upstream',upstreamStageId:image.segmentType === 'body' ? 'p3' : 'p4',
          nodeId:image.segmentType === 'body' ? 'author' : image.segmentType === 'video' ? 'video' : 'opener',
          reason:`作者图片缺失: ${image.file}`};
    }
    return {media};
  } catch (error) {
    return {kind:'blocked-upstream',upstreamStageId:error.upstreamStageId ?? 'p3',nodeId:error.nodeId ?? 'author',reason:error.message};
  }
}
