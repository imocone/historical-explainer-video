import {getEpisodePaths,getStageWorkPaths} from '../../packages/workspace-paths.mjs';
import {readData} from '../../packages/program-utils.mjs';
import {assertProjectPaths,exists} from './files.mjs';
import {commitAcceptance} from './acceptance-commit.mjs';

export async function videoIsEnabled({workspaceRoot,episodeId}) {
  const file=getEpisodePaths(workspaceRoot,episodeId).videoSettings;
  await assertProjectPaths({root:workspaceRoot,files:[file],label:'剧情视频选择'});
  if(!await exists(file))return false;
  const settings=await readData(file);
  if(typeof settings.enabled!=='boolean')throw new Error('本集video-settings.yaml须明确enabled布尔值');
  return settings.enabled;
}

export async function configureVideo({workspaceRoot,episodeId,stageId,video}) {
  if(stageId!=='p4'||!['on','off'].includes(video))throw new Error('--video on/off只用于P4');
  const paths=getEpisodePaths(workspaceRoot,episodeId),enabled=video==='on';
  const work=getStageWorkPaths(paths,'p4');
  const repair=work.returnRequest('render');
  await assertProjectPaths({root:workspaceRoot,files:[paths.videoSettings,repair,work.work],label:'剧情视频选择'});
  const before=await videoIsEnabled({workspaceRoot,episodeId});
  if(before===enabled&&await exists(paths.videoSettings))return;
  const writes=new Map([[paths.videoSettings,{enabled}]]);
  if(before!==enabled&&await exists(paths.finalVideo)&&!await exists(repair))
    writes.set(repair,{target:'render',reason:'用户改变本集剧情视频选择',cueRefs:[]});
  return commitAcceptance({workspaceRoot,workPaths:work,writes,cleanup:[],
    result:{kind:'video-configured',enabled},workflowWriteHeld:true,
    verify:async()=>{
      if(await videoIsEnabled({workspaceRoot,episodeId})!==before)throw new Error('剧情视频选择已改变，保留当前选择');
    }});
}
