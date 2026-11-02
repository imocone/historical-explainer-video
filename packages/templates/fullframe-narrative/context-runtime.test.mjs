import assert from 'node:assert/strict';
import test from 'node:test';
import {projectAdjacentTreatment,projectAuthorContext,projectAuthorReferenceView} from './context-runtime.mjs';
import {hashObject} from '../../program-utils.mjs';

const cues=[{id:1,startMs:0,endMs:6000,text:'看院门。'},
  {id:2,startMs:6000,endMs:12000,text:'看屋内。'}];
const inputs=()=>({authorUnit:{id:'B002'},cues:[cues[1]],semanticContext:{mustNotInvent:['不添身份']},
  templateContext:{episodeContext:{cues,albumPlan:{intent:'等待'},beats:[],templateRuns:[],
    currentPosition:{beatId:'B002',index:2,total:3}},priorVisuals:[{unitId:'B001',pictures:[{
      purpose:'看等待',sceneDescription:'院门前有人等候。',motionIntent:{type:'push-in',speedRatio:1}}]}],
    cueOptions:{frameA:[{cueId:2,edge:'start'}]}}});
const project=(value,reuseReferences,extra={})=>projectAuthorReferenceView({inputs:value,
  workspaceRoot:'/tmp/current-program',episodeId:'ep01',reuseReferences,...extra});

test('前序画面投影在工作单落盘后保持摘要与实际数据',()=>{
  const request={requestId:'AR001',frameId:'A',purpose:'看等待',motion:{type:'push-in'},asset:{file:'picture.png'}};
  for(const description of [undefined,'院门前有人等待。']){
    const actual={...request,...(description===undefined?{}:{sceneDescription:description})};
    const projected=projectAdjacentTreatment({templateId:'fullframe-narrative',continuity:{subjects:[]},assetRequests:[actual]});
    assert.equal(hashObject(projected),hashObject(JSON.parse(JSON.stringify(projected))));
    assert.equal(Object.hasOwn(projected.exitPicture,'sceneDescription'),description!==undefined);
    assert.equal(projected.exitPicture.sceneDescription,description);
    assert.deepEqual(projected.exitPicture.asset,request.asset);
    assert.deepEqual(projected.exitPicture.motion,request.motion);
  }
});

test('完整参考可明确沿用，恢复取得全文，签发输入不变',()=>{
  const original=inputs(),before=structuredClone(original),full=project(original);
  const compact=project(original,full.referenceDigests);
  assert.equal(compact.reusedReferences.episodeContext,true);
  assert.deepEqual(compact.reusedReferences.priorVisuals,['B001']);
  assert.deepEqual(compact.inputs.templateContext.episodeContext,{currentPosition:before.templateContext.episodeContext.currentPosition});
  assert.deepEqual(compact.inputs.templateContext.priorVisuals,[]);
  assert.deepEqual(compact.inputs.cues,original.cues);
  assert.deepEqual(compact.inputs.semanticContext,original.semanticContext);
  assert.deepEqual(compact.inputs.templateContext.cueOptions,original.templateContext.cueOptions);
  assert.deepEqual(project(original).inputs,before);
  assert.deepEqual(original,before);
});

test('新增和变化参考完整交付，不同工作区或剧集不省略',()=>{
  const original=inputs(),known=project(original).referenceDigests,changed=structuredClone(original);
  changed.templateContext.episodeContext.currentPosition={beatId:'B003',index:3,total:3};
  changed.templateContext.priorVisuals.push({unitId:'B002',pictures:[{sceneDescription:'屋内仍无人回应。'}]});
  const increment=project(changed,known);
  assert.equal(increment.reusedReferences.episodeContext,true);
  assert.equal(increment.inputs.templateContext.episodeContext.currentPosition.beatId,'B003');
  assert.deepEqual(increment.inputs.templateContext.priorVisuals,[changed.templateContext.priorVisuals[1]]);
  changed.templateContext.priorVisuals[0].pictures[0].motionIntent.speedChanges=[{timeMs:1000,speedRatio:2}];
  assert.deepEqual(project(changed,known).inputs.templateContext.priorVisuals,changed.templateContext.priorVisuals);
  changed.templateContext.episodeContext.albumPlan.intent='等待后的失落';
  assert.deepEqual(project(changed,known).inputs.templateContext.episodeContext,changed.templateContext.episodeContext);
  for(const extra of [{workspaceRoot:'/tmp/another-program'},{episodeId:'ep02'}])
    assert.deepEqual(project(original,known,extra).inputs,original);
});

test('联合单只省略可从同单还原的副本，独有文本和签发输入保留',()=>{
  const original=inputs();
  original.templateContext.priorCueIndex=[{id:1,text:cues[0].text}];
  original.authorBatch={members:[{beatId:'B002',inputs:{cues:[cues[1]],
    authorUnitBeats:[{id:'B002',cues:[cues[1]],viewerOutcome:'看见等待'}],
    directionContext:{albumPlan:{intent:'等待'},beats:[{id:'B002'}]},
    semanticContext:{mustNotInvent:['只用于本拍的限定']},
    templateContext:{priorCueIndex:[{id:1,text:cues[0].text}],priorCallouts:[{kind:'term-gloss',term:'院门'}]}}}]};
  const before=structuredClone(original),full=project(original),member=full.inputs.authorBatch.members[0].inputs;
  assert.deepEqual(member.cues,[cues[1]]);
  assert.equal(member.authorUnitBeats[0].cues,undefined);
  assert.equal(member.directionContext.albumPlan,undefined);
  assert.deepEqual(member.templateContext.priorCueIndex,[{id:1}]);
  assert.deepEqual(full.inputs.templateContext.priorCueIndex,[{id:1}]);
  const restored=structuredClone(member);
  restored.authorUnitBeats[0].cues=restored.cues;
  restored.directionContext.albumPlan={intent:full.inputs.templateContext.episodeContext.albumPlan.intent};
  restored.templateContext.priorCueIndex=restored.templateContext.priorCueIndex.map(index=>({...index,
    text:full.inputs.templateContext.episodeContext.cues.find(cue=>cue.id===index.id).text}));
  assert.deepEqual(restored,before.authorBatch.members[0].inputs,'全部原输入可准确还原');
  assert.deepEqual(original,before);
  assert.ok(JSON.stringify(full.inputs).length<JSON.stringify(before).length);
  const reused=project(original,full.referenceDigests);
  assert.equal(reused.reusedReferences.episodeContext,true);
  assert.deepEqual(reused.inputs.authorBatch,full.inputs.authorBatch);
  const changed=structuredClone(original),local=changed.authorBatch.members[0].inputs;
  local.authorUnitBeats[0].cues[0]={...local.authorUnitBeats[0].cues[0],text:'另一份字幕'};
  local.directionContext.albumPlan.intent='本拍独有方向';
  local.templateContext.priorCueIndex[0].text='前文的独有说明';
  assert.deepEqual(project(changed).inputs.authorBatch,changed.authorBatch,'不把不同内容当作副本省略');
});

test('前序运动意图实际投递持续变速',()=>{
  const motion={type:'push-in',speedRatio:1,speedChanges:[{timeMs:1000,speedRatio:2}]};
  const request={requestId:'AR001',purpose:'等待',sceneDescription:'院门前有人等待。',
    attentionPlan:{entryFocus:'人',landingFocus:'门',viewerChange:'等待'},motion};
  const beats=cues.map(cue=>({id:`B00${cue.id}`,cueRange:[cue.id,cue.id],templateId:'fullframe-narrative'}));
  const paragraph={id:'TR001',templateId:'fullframe-narrative',beatIds:beats.map(beat=>beat.id)};
  const authorUnits=beats.map((beat,index)=>({id:beat.id,beat,beats:[beat],beatIds:[beat.id],
    templateId:beat.templateId,paragraph,...(index===0?{treatment:{templateId:beat.templateId,assetRequests:[request]}}:{})}));
  const context=projectAuthorContext({programPlan:{programForm:'historical-explainer',openerTemplate:'episode-opener'},authorUnits,episodeCues:cues,albumPlan:{intent:'等待'},
    acceptedBeats:beats,beforeBeatId:'B002'});
  const projected=context.priorVisuals[0].pictures[0].motionIntent;
  assert.deepEqual(projected.speedChanges,motion.speedChanges);
});
