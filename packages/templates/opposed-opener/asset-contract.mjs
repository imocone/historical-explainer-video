export const buildImageRequests = ({treatment, expectedTemplateId = "opposed-opener"}) => {
  if (treatment?.templateId !== expectedTemplateId || !treatment.flashbackShots?.length)
    throw new Error("逐段片头缺少已设计的画面");
  return treatment.flashbackShots.map((shot, i) => {
    const visual = shot.visualBrief;
    for (const key of ["subject", "actionOrState", "environment", "visibleResult", "composition"])
      if (!visual?.[key]?.trim()) throw new Error(`${shot.id}缺少visualBrief.${key}`);
    const requirements = [
      "完整独立、均匀曝光的16:9历史场景，不预制文字、暗带、分割线或转场",
      "上下错层裁切和轻微透视运镜时，人物脸、关键动作与证据仍可辨认"
    ];
    return {target:shot, request:{
      requestId:`AR${String(i+1).padStart(3,"0")}`, kind:"fullframe-image", required:true,
      purpose:`${visual.subject}：${visual.visibleResult}`,
      sourceRefs:structuredClone(shot.sourceRefs), mustNotInvent:structuredClone(shot.mustNotInvent),
      acceptanceCriteria:requirements,
      spec:{frameId:"A", shotId:shot.id, aspectRatio:"16:9", promptSpec:structuredClone(visual),
        motion:{type:"hold", startFocus:visual.subject, revealFocus:visual.visibleResult, rationale:"片头模板执行上下错层对冲与运镜"}},
      production:{outputProfile:"opaque-fullframe-v1", groupRules:requirements,
        panel:{title:"逐段片头完整画面", lines:[...Object.values(visual), ...requirements, `禁止补造：${shot.mustNotInvent.join("；")}`],
          requiredTokens:[visual.subject,visual.visibleResult,visual.composition]},
        framing:{coordinateSpace:"normalized", safeRect:{x:.08,y:.08,width:.84,height:.84},
          startFocus:{x:.5,y:.5}, revealFocus:{x:.5,y:.5}, source:"region-map"}}
    }};
  });
};
export const compileOpenerRequests = options => buildImageRequests(options).map(({request}) => request);
