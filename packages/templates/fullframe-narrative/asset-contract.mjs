import { assertFullframeFramePolicy } from "./capacity-policy.mjs";
import { projectAssetPlanTreatment } from "./production-projection.mjs";
import { fullframeFramingFor } from "./camera/index.mjs";
import { projectAdjacentTreatment } from "./camera/context-runtime.mjs";

export { projectAssetPlanTreatment } from "./production-projection.mjs";

const textList = (value, fallback = "无") => Array.isArray(value) && value.length
  ? value.join("；")
  : fallback;

const requiredText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`全画幅 ${label} 必须由 P3 提供`);
  return value;
};

const panelContractFor = ({ request, continuity }) => {
  const scene = requiredText(request.sceneDescription, `${request.frameId} 完整场面`);
  const exactTexts = request.exactTexts ?? [];
  const textInstruction = exactTexts.length
    ? `图内文字：按图纸的位置和作用逐字生成——${exactTexts.join("；")}。重复与组织依图纸，不添加未设计的文字或乱码。`
    : "图内文字：本图没有文字任务；可能承载文字的表面只保留材质和结构，不生成可辨文字、字母、数字、伪字、错字或乱码。";
  // Beat-wide entity inventories drive cross-panel continuity, not each image's cast.
  const timeGuardrail = continuity?.period || continuity?.location
    ? `段落背景：时代=${continuity.period || "未声明"}；地点=${continuity.location || "未声明"}。本图内容与布局只按本图蓝图；不合并其它画面，不把已定隐喻改成写实现场。`
    : null;
  const lines = [
    timeGuardrail,
    scene,
    textInstruction,
    `禁止补造：${textList(request.mustNotInvent)}`
  ].filter(Boolean);
  return {
    title: `画面 ${request.frameId}`,
    lines,
    requiredTokens: [
      scene,
      ...(timeGuardrail ? [timeGuardrail] : []),
      `禁止补造：${textList(request.mustNotInvent)}`
    ]
  };
};

export const buildImageRequests = ({ treatment, targetDurationMs, previousBeat = null, previousTreatment = null, includeFraming = true }) => {
  const projected = projectAssetPlanTreatment(treatment);
  const prior = previousBeat?.treatment?.templateId === "fullframe-narrative" ? previousBeat.treatment : null;
  const sameScene = projected.continuity?.continuesPreviousScene === true;
  if (sameScene && !prior && !previousTreatment) throw new Error("同场景素材编译缺少原分镜紧邻上一全画幅设计");
  const previous = prior && sameScene
    ? { beatId: previousBeat.id, exitPicture: projectAdjacentTreatment(prior).exitPicture }
    : previousTreatment;
  assertFullframeFramePolicy({
    targetDurationMs,
    frameIds: projected.assetRequests.map((request) => request.frameId),
    label: "全画幅"
  });
  return projected.assetRequests.map((request, index) => ({
    // 本图原文确定出场对象，同场时额外交接上一镜场景原文。
    continuity: index === 0 && sameScene ? {
      continuesPreviousScene: true,
      previous
    } : null,
    target: treatment.assetRequests[index],
    request: {
      ...request,
      production: {
        outputProfile: "opaque-fullframe-v1",
        groupRules: [
          "按当前图纸生成一张完整16:9画面，不做拼贴或拼图。忠实保留已定内容、景别、主体分量与空间层次，不自行补人物、全身或宽阔环境。"
        ],
        panel: panelContractFor({ request, continuity: projected.continuity ?? null }),
        ...(includeFraming ? { framing: fullframeFramingFor({
          request: {
            assetId: request.requestId,
            spec: { motion: request.motion }
          }
        }) } : {})
      }
    }
  }));
};
