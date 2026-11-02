import {readData, hashObject} from '../../packages/program-utils.mjs';
import {getEpisodePaths, getStageWorkPaths, listAuthorWorkPaths} from '../../packages/workspace-paths.mjs';
import {exists, assertProjectPaths} from './files.mjs';
import {commitAcceptance} from './acceptance-commit.mjs';

// System Control owns the user's selection; the Feature owns only sound units.
export const configureSoundEffects = async ({root, workspaceRoot, episodeId, stageId, soundEffects, ...options}) => {
  if (!['p3','p4'].includes(stageId) || !['on','off'].includes(soundEffects))
    throw new Error('--sound-effects on|off 只用于next --stage p3|p4');
  const conflicts=Object.entries(options).filter(([key,value])=>!['command','targetId','programId'].includes(key)
    && value !== undefined && value !== null && value !== false && (!Array.isArray(value) || value.length));
  if (conflicts.length) throw new Error('--sound-effects只更新音效选择，不与创作、返工或发布参数混用');
  const paths = getEpisodePaths(workspaceRoot,episodeId), work = getStageWorkPaths(paths,stageId);
  await assertProjectPaths({root:workspaceRoot,files:[paths.storyboard,work.work],label:'音效选择'});
  const storyboard = await readData(paths.storyboard);
  if (!storyboard.albumPlan || !storyboard.beats?.length || !storyboard.features)
    throw new Error('音效选择需要已形成的导演计划；不改写理解或画面');
  const enabled = soundEffects === 'on';
  const before = hashObject(storyboard);
  const current = storyboard.features['sound-effects'];
  const unchanged = Boolean(current) && (current.enabled !== false) === enabled;
  if (unchanged) return {kind:'feature-configured',featureId:'sound-effects',enabled,changed:false};
  // An actual author must finish or pause before its selected packages change.
  // This reuses the existing active-work boundary, rather than rebinding its
  // candidate or silently signing a different task while it is being written.
  for (const author of [getStageWorkPaths(paths,'p3'),...await listAuthorWorkPaths(paths)]) {
    if (await exists(author.workOrder)) {
      const order=await readData(author.workOrder);
      if (order.nodeId === 'author' && order.inputs?.authorPhase !== 'quotes')
        throw new Error('当前正文作者工作单尚未收口，先收口该作者再改变音效选择；原候选保留');
    }
  }
  const render = getStageWorkPaths(paths,'p4').returnRequest('render');
  const savedRequest = await exists(render) ? await readData(render) : null;
  storyboard.features['sound-effects'] = {...(current ?? {units:{}}),enabled};
  const result={kind:'feature-configured',featureId:'sound-effects',enabled,changed:true};
  const writes=new Map([[paths.storyboard,storyboard]]);
  if (!savedRequest) writes.set(render,{target:'render',reason:'用户改变本集音效选择，仅重新混音和交付',cueRefs:[]});
  return commitAcceptance({workspaceRoot,workPaths:work,writes,cleanup:[],result,workflowWriteHeld:true,
    verify:async()=>{if(hashObject(await readData(paths.storyboard))!==before)throw new Error('故事板已改变，保留当前选择');}});
};
