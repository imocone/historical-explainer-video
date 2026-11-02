import { GENERATED_HERO_REQUEST_ID } from "./selection.mjs";

const ACCEPTANCE = Object.freeze([
  "交付一张完整独立的16:9鸟瞰或俯视历史空间全景，有清楚的空间纵深与缓慢推进余量",
  "地点、时代和空间身份服从本期图纸中的节目正式世界设定，不替换为其它节目或一般化场景",
  "时代、环境、主体和可见状态服从本集已定图纸与来源，不拼成多个时空或图表",
  "完整均匀曝光，不预制片名、字幕、边框、水印、虚化、暗部或黑场；合焦、标题和转场由P4完成",
  "关键主体位于安全观看区域，前中后景共同组成可进入的真实场景"
]);

// The five memory shots reference body assets. D06 always contributes one new,
// episode-specific programme-world overview request to the current author image delivery.
export const compileOpenerRequests = ({ treatment }) => {
  if (treatment?.templateId !== "documentary-opener") throw new Error("纪录片片头素材合同只能编译 documentary-opener");
  const hero = treatment.hero;
  if (!hero?.visualBrief) throw new Error("纪录片片头D06必须提供依据节目世界设定新设计的鸟瞰图纸");
  const visual = hero.visualBrief;
  for (const field of ["subject", "actionOrState", "environment", "visibleResult", "composition"]) {
    if (typeof visual[field] !== "string" || !visual[field].trim()) {
      throw new Error(`末景 visualBrief.${field} 必须在P4完成`);
    }
  }
  return [{
    requestId: GENERATED_HERO_REQUEST_ID,
    kind: "fullframe-image",
    required: true,
    purpose: `${visual.subject}：${visual.visibleResult}`,
    sourceRefs: structuredClone(hero.sourceRefs),
    mustNotInvent: structuredClone(hero.mustNotInvent),
    acceptanceCriteria: [...ACCEPTANCE],
    spec: {
      frameId: "A", shotId: hero.id, aspectRatio: "16:9",
      motion: {
        type: "hold", startFocus: visual.subject, revealFocus: visual.visibleResult,
        rationale: "原图保留宽景纵深，片头模板在P4执行合焦与连续推进。"
      },
      promptSpec: structuredClone(visual)
    },
    production: {
      outputProfile: "opaque-fullframe-v1",
      groupRules: ["只生成图纸规定的一张独立宽景，不分格、拼接或复制其它画面。"],
      panel: {
        title: "回忆画流片头全景",
        lines: [
          `本图任务：${visual.subject}：${visual.visibleResult}`,
          `环境：${visual.environment}`,
          `主体：${visual.subject}`,
          `动作与状态：${visual.actionOrState}`,
          "世界身份：服从本期图纸承接的节目正式设定；每集重新选择鸟瞰位置、观看角度和构图，不复用历集设计或成图",
          `构图：${visual.composition}`,
          `景别：${hero.framing}；本集俯瞰选择理由：${hero.selectionReason}`,
          `禁止补造：${hero.mustNotInvent.join("；")}`,
          `成图必须满足：${ACCEPTANCE.join("；")}`
        ],
        requiredTokens: [visual.subject, visual.visibleResult, visual.composition]
      },
      framing: {
        coordinateSpace: "normalized",
        safeRect: { x: .08, y: .08, width: .84, height: .84 },
        startFocus: structuredClone(hero.focus), revealFocus: structuredClone(hero.focus),
        source: "region-map"
      }
    }
  }];
};
export const buildImageRequests = ({ treatment }) => (
  compileOpenerRequests({ treatment }).map((request) => ({ request, target: treatment.hero }))
);
