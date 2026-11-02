export const buildImageRequests = ({ treatment }) => {
  if (treatment.templateId !== "crossfire-opener" || treatment.flashbackShots?.length !== 3) throw new Error("交叉对冲需要三张完整图纸");
  const entries = treatment.flashbackShots.map((shot, i) => ({ shot, target: shot, requestId: `AR00${i + 1}`, foreground: false }));
  const middle = treatment.flashbackShots[1];
  if (middle.foreground) entries.push({ shot: middle, target: middle.foreground, requestId: "AR004", foreground: true });
  return entries.map(({ shot, target, requestId, foreground }) => {
    const visual = target.visualBrief;
    for (const field of ["subject", "actionOrState", "environment", "visibleResult", "composition"]) {
      if (!visual?.[field]?.trim()) throw new Error(`${shot.id}缺少visualBrief.${field}`);
    }
    const requirements = foreground ? [
      "16:9透明PNG，只有图纸规定的前景主体和道具；背景完全透明，不画阴影底板、文字或边框",
      "主体保留完整动作与器物，位于左半幅；从同一O02背景图继承时代、身份、视角、尺度和光照"
    ] : [
      "完整独立、均匀曝光的16:9历史场景，不预制燃边、文字、暗角、边框或拼贴",
      `主体与动作集中在${shot.id === "O02" ? "左侧" : "右侧"}，另一侧保留自然场景供程序排字`,
      "人物面部、动作和证据在画面高度35%—65%的中央带内，三幅对冲裁切后仍可辨认"
    ];
    return { target, request: {
      requestId, kind: "fullframe-image", required: true, purpose: `${visual.subject}：${visual.visibleResult}`,
      sourceRefs: structuredClone(shot.sourceRefs), mustNotInvent: structuredClone(shot.mustNotInvent),
      acceptanceCriteria: requirements,
      spec: { frameId: "A", shotId: shot.id, aspectRatio: "16:9", promptSpec: structuredClone(visual),
        motion: { type: "hold", startFocus: visual.subject, revealFocus: visual.visibleResult, rationale: "由片头模板执行燃边和交叉对冲" } },
      production: { outputProfile: foreground ? "transparent-fullframe-v1" : "opaque-fullframe-v1",
        groupRules: requirements,
        panel: { title: foreground ? "交叉片头独立前景" : "交叉片头完整画面",
          lines: [...Object.values(visual), ...requirements, `禁止补造：${shot.mustNotInvent.join("；")}`],
          requiredTokens: [visual.subject, visual.visibleResult, visual.composition] },
        framing: { coordinateSpace: "normalized", safeRect: { x: .08, y: .08, width: .84, height: .84 },
          startFocus: { x: .5, y: .5 }, revealFocus: { x: .5, y: .5 }, source: "region-map" }
      }
    } };
  });
};
export const compileOpenerRequests = options => buildImageRequests(options).map(({ request }) => request);
