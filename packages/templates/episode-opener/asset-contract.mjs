const REQUEST_IDS = Object.freeze(["AR001", "AR002", "AR003"]);
const TEXT_SIDE = Object.freeze({ O01: "left", O02: "right", O03: "left" });
const ACCEPTANCE = Object.freeze([
  "每张交付图必须是一张完整独立、均匀曝光的 16:9 历史叙事画面，并对应唯一闪回观察面",
  "三张正式闪回图保持图纸顺序，各自独立生成；任何主体、道具、背景不得跨图",
  "三张画面必须共同把唯一钩子中的时代、主体、处境和可见结果变成可见事实",
  "O01/O03 的主体与关键证据位于右侧，O02 位于左侧；另一侧只留构图空间，不要求低细节或暗部",
  "供三层斜切横带复用的人物面部、主体中心与关键证据必须落在画面高度 35%—65% 的中央带内",
  "禁止把左右暗部、渐变阴影、黑块、暗角或大面积低照度留白预制进原图；文字可读性只由 P4 独立遮罩承担",
  "本片头只交付三张闪回图",
  "不得出现来源之外的答案、人物关系、文字、数字或水印",
  "主体与关键证据必须位于 16:9 安全观看区域"
]);

const clone = (value) => structuredClone(value);
const safeRect = Object.freeze({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
const framing = Object.freeze({
  coordinateSpace: "normalized",
  safeRect,
  startFocus: { x: 0.5, y: 0.5 },
  revealFocus: { x: 0.5, y: 0.5 },
  source: "region-map"
});

const visualFor = (shot) => {
  const visual = shot?.visualBrief;
  for (const field of ["subject", "actionOrState", "environment", "visibleResult", "composition"]) {
    if (typeof visual?.[field] !== "string" || !visual[field].trim()) {
      throw new Error(`${shot?.id ?? "unknown"} visualBrief.${field} 必须是非空文字`);
    }
  }
  return visual;
};

export const compileOpenerRequests = ({ treatment }) => {
  if (treatment?.templateId !== "episode-opener") throw new Error("片头素材合同只能编译 episode-opener");
  const shots = treatment.flashbackShots ?? [];
  if (shots.length !== 3) throw new Error("片头必须固定交付3张闪回全画幅图");
  return shots.map((shot, index) => {
    const visual = visualFor(shot);
    const textSide = TEXT_SIDE[shot.id];
    if (!textSide) throw new Error(`${shot.id} 缺少片头横带构图方向`);
    const subjectSide = textSide === "left" ? "右侧" : "左侧";
    const textSideLabel = textSide === "left" ? "左侧" : "右侧";
    const spec = {
      frameId: "A",
      shotId: shot.id,
      aspectRatio: "16:9",
      textSide,
      motion: {
        type: "hold",
        startFocus: visual.subject,
        revealFocus: visual.visibleResult,
        rationale: "P4以静态闪回图进入三层横带合成。"
      },
      promptSpec: clone(visual)
    };
    return {
      requestId: REQUEST_IDS[index],
      kind: "fullframe-image",
      required: true,
      purpose: `${visual.subject}：${visual.visibleResult}`,
      sourceRefs: clone(shot.sourceRefs),
      mustNotInvent: clone(shot.mustNotInvent),
      acceptanceCriteria: [...ACCEPTANCE],
      spec,
      production: {
        outputProfile: "opaque-fullframe-v1",
        groupRules: [
          "本片头三张闪回图按各自图纸的顺序共同兑现同一个片头钩子；不得交换、合并或复制，每图只服从自身图纸。",
          "各图是完整、均匀曝光的历史场景；不得预制文字暗部、横带、字幕、标题或水印。"
        ],
        panel: {
          title: "片头闪回图",
          lines: [
            `本图任务：${visual.subject}：${visual.visibleResult}`,
            `环境：${visual.environment}`,
            `主体：${visual.subject}`,
            `动作与结果：${visual.actionOrState}；${visual.visibleResult}`,
            `构图：${visual.composition}`,
            `片头合成构图：主体、动作与关键证据集中在${subjectSide}，${textSideLabel}只留自然构图空间但仍须是完整、均匀曝光的历史场景；不得生成文字或空白字板。`,
            "横带安全区：人物面部、主体中心与关键证据落在画面高度35%—65%的中央带内。",
            "原图禁止预制左右暗部、渐变阴影、黑块、暗角或大面积低照度留白；文字可读性由P4独立遮罩承担。",
            `禁止补造：${shot.mustNotInvent.join("；") || "无额外项"}`,
            `成图必须满足：${ACCEPTANCE.join("；")}`
          ],
          requiredTokens: [visual.subject, visual.visibleResult, visual.composition]
        },
        framing: clone(framing)
      }
    };
  });
};

export const buildImageRequests = ({ treatment }) => (
  compileOpenerRequests({ treatment }).map((request, index) => ({ request, target: treatment.flashbackShots[index] }))
);
